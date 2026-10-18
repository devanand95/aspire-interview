import { processPayment, getPaymentStatus } from "../src/payments"; // assumed paths
import { mockPaymentProvider, mockNotifier } from "./mocks"; // assumed paths

/**
 * Assumptions
 * A1: Maximum 4 provider calls (call #1 + retries #1-#3), 5s between calls.
 * A2: "Attempted" = the provider received the request and answered; failed = final attempt explicitly declined.
 * A3: Unreached / no-response calls count toward the retry cap. If the final call was not a decline, the
 *     payment ends as errored (never failed) and the owner is notified once.
 * A4: A refused re-trigger resolves with the current in-flight state, without an error.
 * A5: "Notify" means notify the business owner.
 *
 * Mock surface
 * Already in the suite:
 *   mockPaymentProvider.failTimes(n)  first n calls are declined; later calls succeed
 *   mockPaymentProvider.callCount     every call the code makes to the provider, including unreached ones
 *   mockNotifier.wasCalled()          owner notified at least once
 * To add:
 *   mockPaymentProvider.reset(), mockNotifier.reset()
 *   mockPaymentProvider.script([...]) per-call outcomes; calls after the script succeed:
 *                                      "decline" | "unreachable" | "no-response" | "success"
 *                                      unreachable -> throws ECONNREFUSED; provider never saw the request
 *                                      no-response -> throws ETIMEDOUT; provider may have charged
 *   mockPaymentProvider.calls         [{ id, amount, idempotencyKey }], one entry per call
 *   mockNotifier.callCount, mockNotifier.calls [{ paymentId }], one entry per notification
 *   getPaymentStatus(id)               stored status, readable while retries are still running

 *
 * Priority rationale (business impact)
 * P0 is for cases that could break the payment flow, leave money in the wrong state, or risk a
 * duplicate charge. P1 covers important behavior where the direct financial risk is lower.
 * The timeout/idempotency and duplicate-submission cases add assumptions beyond the short spec,
 * so those expectations should be confirmed with the product owner.
 *
 * | Test | Priority | Scenario                      | Business impact |
 * |------|----------|-------------------------------|-----------------|
 * | #1   | P0       | Initial success               | If a valid payment cannot complete on the first try, the main payment flow is broken. |
 * | #5   | P1       | Exhausted retries             | The retry cap must be respected, but one extra call after explicit declines is usually less directly harmful than an incorrect payment state or a duplicate charge. |
 * | #7   | P1       | Retry timing                  | The 5-second interval is part of the spec, but an isolated timing deviation usually affects delay or provider load rather than payment correctness. |
 * | #4   | P0       | Success on final retry        | If a successful payment is marked failed, the business may treat it as unpaid and try to collect again. |
 * | #13  | P0       | Timeout, then retry succeeds  | A missing response does not prove the first request failed; reusing the same key helps avoid a second charge. |
 * | #14  | P0       | All attempts time out         | The outcome is unknown, not necessarily failed. The business needs an explicit alert and reconciliation rather than a misleading final status. |
 * | #15  | P0       | Payment identity/idempotency | Every retry must refer to the same payment and amount; changing the details or key can duplicate or alter the transaction. |
 * | #8   | P0       | Duplicate submission in wait  | A second processing chain for the same payment could submit it again and charge the customer twice. |
 * | #6   | P0       | Notify only after final decline | Once sent, a premature alert cannot be recalled and may prompt unnecessary manual action even if the payment later succeeds. |
 *
 * A P0 label means a failure could directly compromise payment correctness or integrity; P1 means
 * the behavior still matters but has lower direct impact when considered on its own.
 */

const RETRY_DELAY_MS = 5000;
const MAX_RETRIES = 3;
const TOTAL_CALLS = 1 + MAX_RETRIES; // 4

// Keeps a rejection from turning into an unhandled rejection if an assertion throws before we await it.
const track = <T>(p: Promise<T>): Promise<T> => {
  p.catch(() => {});
  return p;
};

// Runs a payment to its end, stepping through every retry delay.
async function settled<T>(p: Promise<T>): Promise<T> {
  track(p);
  await jest.runAllTimersAsync(); // Vitest: vi.runAllTimersAsync()
  return p;
}

async function expectNoFurtherCalls(expectedCalls: number) {
  await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS * 10);
  expect(mockPaymentProvider.callCount).toBe(expectedCalls);
}

// Mid-retry the payment is neither done nor dead. Deliberately does not pin the in-progress status name.
async function expectUnsettled(id: string) {
  const status = await getPaymentStatus(id);
  expect(status).not.toBe("completed");
  expect(status).not.toBe("failed");
}

describe("payment retry", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockPaymentProvider.reset();
    mockNotifier.reset();
  });

  afterEach(async () => {
    await jest.advanceTimersByTimeAsync(0); // let any in-flight continuation finish while the clock is still fake
    jest.clearAllTimers(); // then drop retry timers it scheduled: nothing can fire into the next test
    jest.useRealTimers();
    mockPaymentProvider.reset();
    mockNotifier.reset();
  });

  describe("success path", () => {
    it("[P0 #1] completes on call #1 and never retries", async () => {
      const result = await settled(processPayment({ id: "p1", amount: 100 }));
      expect(result.status).toBe("completed");
      expect(mockPaymentProvider.callCount).toBe(1);
      expect(mockNotifier.wasCalled()).toBe(false);
      await expectNoFurtherCalls(1);
    });

    it("[P1 #2] completes on retry #1", async () => {
      mockPaymentProvider.failTimes(1);
      const pending = track(processPayment({ id: "p2", amount: 100 }));

      await jest.advanceTimersByTimeAsync(0);
      expect(mockPaymentProvider.callCount).toBe(1);
      await expectUnsettled("p2");

      await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS);
      expect((await pending).status).toBe("completed");
      expect(mockPaymentProvider.callCount).toBe(2);
      expect(mockNotifier.wasCalled()).toBe(false);
      await expectNoFurtherCalls(2);
    });

    it("[P1 #3] completes on retry #2", async () => {
      mockPaymentProvider.failTimes(2);
      const pending = track(processPayment({ id: "p3", amount: 100 }));

      await jest.advanceTimersByTimeAsync(0);
      expect(mockPaymentProvider.callCount).toBe(1);
      await expectUnsettled("p3");

      await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS);
      expect(mockPaymentProvider.callCount).toBe(2);
      await expectUnsettled("p3");

      await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS);
      expect((await pending).status).toBe("completed");
      expect(mockPaymentProvider.callCount).toBe(3);
      expect(mockNotifier.wasCalled()).toBe(false);
      await expectNoFurtherCalls(3);
    });

    it("[P0 #4] completes on the last retry (retry #3, call #4) and is never marked failed", async () => {
      mockPaymentProvider.failTimes(MAX_RETRIES);
      const result = await settled(processPayment({ id: "p4", amount: 100 }));
      expect(result.status).toBe("completed");
      expect(mockPaymentProvider.callCount).toBe(TOTAL_CALLS);
      expect(mockNotifier.wasCalled()).toBe(false);
      await expectNoFurtherCalls(TOTAL_CALLS);
    });
  });

  describe("exhaustion and owner notification", () => {
    it("[P1 #5] marks failed after call #4 is declined: exactly 3 retries, no call #5", async () => {
      mockPaymentProvider.failTimes(TOTAL_CALLS + 1); // a 5th call would also decline, so over-retrying shows in callCount
      const result = await settled(processPayment({ id: "p5", amount: 100 }));
      expect(result.status).toBe("failed");
      expect(mockPaymentProvider.callCount).toBe(TOTAL_CALLS);
      await expectNoFurtherCalls(TOTAL_CALLS);
    });

    it("[P0 #6] notifies the owner exactly once, only after the final decline", async () => {
      mockPaymentProvider.failTimes(TOTAL_CALLS + 1);
      const pending = track(processPayment({ id: "p6", amount: 100 }));

      await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS * (MAX_RETRIES - 1)); // through call #3
      expect(mockPaymentProvider.callCount).toBe(TOTAL_CALLS - 1);
      expect(mockNotifier.wasCalled()).toBe(false); // nothing during the retries

      await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS); // call #4
      await pending;
      expect(mockNotifier.wasCalled()).toBe(true);
      expect(mockNotifier.callCount).toBe(1);
      expect(mockNotifier.calls[0]).toMatchObject({ paymentId: "p6" });
    });
  });

  describe("timing", () => {
    it("[P1 #7] waits exactly 5s between calls: first call immediate, no retry early, no wait after the last", async () => {
      mockPaymentProvider.failTimes(TOTAL_CALLS + 1);
      const pending = track(processPayment({ id: "p7", amount: 100 }));
      let finished = false;
      pending.then(() => { finished = true; }, () => { finished = true; });

      await jest.advanceTimersByTimeAsync(0);
      expect(mockPaymentProvider.callCount).toBe(1);

      for (let call = 2; call <= TOTAL_CALLS; call++) {
        await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS - 1);
        expect(mockPaymentProvider.callCount).toBe(call - 1); // 1ms before the deadline: still no retry
        await jest.advanceTimersByTimeAsync(1);
        expect(mockPaymentProvider.callCount).toBe(call); // fires at exactly 5000ms
      }

      expect(finished).toBe(true); // no extra 5s wait after the final decline before settling
      expect((await pending).status).toBe("failed");
    });

    it("[P0 #8] re-submitting the same payment during the 5s retry wait does not trigger another provider call", async () => {
      mockPaymentProvider.failTimes(1);
      const pending = track(processPayment({ id: "p8", amount: 100 }));
      await jest.advanceTimersByTimeAsync(0);
      expect(mockPaymentProvider.callCount).toBe(1);

      await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS / 2);
      const forced = track(processPayment({ id: "p8", amount: 100 })); // same payment, re-submitted mid-window
      await jest.advanceTimersByTimeAsync(0);
      expect(mockPaymentProvider.callCount).toBe(1); // no extra provider call

      await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS / 2 - 1);
      expect(mockPaymentProvider.callCount).toBe(1); // the original schedule was not pulled forward
      await jest.advanceTimersByTimeAsync(1);
      expect(mockPaymentProvider.callCount).toBe(2); // and not reset: it still fires at the original 5000ms

      expect((await pending).status).toBe("completed");
      await expectNoFurtherCalls(2); // the forced call did not start a second retry chain
      expect((await forced).status).not.toBe("failed"); // A4: resolves, no throw, never reports failed
    });
  });

  describe("payment never reached the provider", () => {
    it("[P1 #9] unreached on call #1 is not a failure; retries stay on schedule", async () => {
      mockPaymentProvider.script(["unreachable", "success"]);
      const pending = track(processPayment({ id: "p9", amount: 100 }));

      await jest.advanceTimersByTimeAsync(0);
      expect(mockPaymentProvider.callCount).toBe(1);
      await expectUnsettled("p9");
      expect(mockNotifier.wasCalled()).toBe(false);

      await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS - 1);
      expect(mockPaymentProvider.callCount).toBe(1);
      await jest.advanceTimersByTimeAsync(1);
      expect((await pending).status).toBe("completed");
      expect(mockPaymentProvider.callCount).toBe(2);
    });

    it("[P1 #10] unreached on every call ends errored, never failed, owner notified once", async () => {
      mockPaymentProvider.script(Array(TOTAL_CALLS).fill("unreachable"));
      const result = await settled(processPayment({ id: "p10", amount: 100 }));
      expect(result.status).toBe("errored");
      expect(mockPaymentProvider.callCount).toBe(TOTAL_CALLS);
      expect(mockNotifier.callCount).toBe(1);
      await expectNoFurtherCalls(TOTAL_CALLS);
    });

    it("[P1 #11] unreached on a retry after a decline is not a failure", async () => {
      mockPaymentProvider.script(["decline", "unreachable", "success"]);
      const pending = track(processPayment({ id: "p11", amount: 100 }));

      await jest.advanceTimersByTimeAsync(0); // call #1 declined
      await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS); // call #2 never reaches the provider
      expect(mockPaymentProvider.callCount).toBe(2);
      await expectUnsettled("p11");
      expect(mockNotifier.wasCalled()).toBe(false);

      await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS);
      expect((await pending).status).toBe("completed");
      expect(mockPaymentProvider.callCount).toBe(3);
    });

    it("[P1 #12] three declines then an unreached final retry ends errored, not failed", async () => {
      mockPaymentProvider.script(["decline", "decline", "decline", "unreachable"]);
      const result = await settled(processPayment({ id: "p12", amount: 100 }));
      expect(result.status).toBe("errored"); // the final call was not a decline
      expect(mockPaymentProvider.callCount).toBe(TOTAL_CALLS);
      expect(mockNotifier.callCount).toBe(1);
    });

    it("[P0 #13] no response on call #1: not failed, and the resend reuses the same idempotency key", async () => {
      mockPaymentProvider.script(["no-response", "success"]);
      const pending = track(processPayment({ id: "p13", amount: 100 }));

      await jest.advanceTimersByTimeAsync(0);
      await expectUnsettled("p13"); // money may already have moved: never failed

      await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS);
      const result = await pending;
      expect(result.status).toBe("completed");
      expect(mockPaymentProvider.callCount).toBe(2);

      const [first, second] = mockPaymentProvider.calls;
      expect(first.idempotencyKey).toBeTruthy();
      expect(second.idempotencyKey).toBe(first.idempotencyKey);
    });

    it("[P0 #14] no response on every call ends errored, never failed, one key throughout", async () => {
      mockPaymentProvider.script(Array(TOTAL_CALLS).fill("no-response"));
      const result = await settled(processPayment({ id: "p14", amount: 100 }));
      expect(result.status).toBe("errored");
      expect(mockPaymentProvider.callCount).toBe(TOTAL_CALLS);
      expect(mockNotifier.callCount).toBe(1); // someone has to reconcile what the provider actually did

      const keys = new Set(mockPaymentProvider.calls.map((c) => c.idempotencyKey));
      expect(keys.size).toBe(1);
    });
  });

  describe("integrity", () => {
    it("[P0 #15] every call carries the same payment: id, amount and idempotency key", async () => {
      mockPaymentProvider.failTimes(MAX_RETRIES);
      await settled(processPayment({ id: "p15", amount: 100 }));

      expect(mockPaymentProvider.calls).toHaveLength(TOTAL_CALLS);
      for (const call of mockPaymentProvider.calls) {
        expect(call).toMatchObject({ id: "p15", amount: 100 });
      }
      // If the provider has no idempotency key, a missing key here is the gap to raise, not a test to loosen.
      const keys = new Set(mockPaymentProvider.calls.map((c) => c.idempotencyKey));
      expect(keys.size).toBe(1);
      expect([...keys][0]).toBeTruthy();
    });

    // Enable once the spec says which inputs are invalid (amount <= 0? empty id?).
    it.skip("[P2 #16] input rejected before the provider is never failed and never notifies", async () => {
      let status: string | undefined;
      try {
        status = (await settled(processPayment({ id: "p16", amount: -5 }))).status;
      } catch {
        /* rejecting is an acceptable way to refuse */
      }
      expect(mockPaymentProvider.callCount).toBe(0);
      expect(status).not.toBe("failed");
      expect(mockNotifier.wasCalled()).toBe(false);
    });
  });

  // Parked: needs a per-payment mock script to verify independent retry counters.
  it.todo("[P1] concurrent payments keep independent retry counters");
});
