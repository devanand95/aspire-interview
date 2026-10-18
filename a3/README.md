# A3 — Payment retry test coverage

This folder contains the proposed payment-retry test scenarios. The tests are **not runnable as-is**: they depend on a payment implementation, mock provider/notifier, and Jest/TypeScript configuration that are not included here.

## Behavior under test

The assignment's core rule is one initial payment attempt plus up to three retries, with a five-second delay between attempts. A successful attempt completes the payment and stops retries; four explicit declines result in a failed payment and owner notification.

## Assumptions to confirm

- **Retry cap:** at most four provider calls total (initial attempt + three retries), with five seconds between calls.
- **Decline vs. timeout:** only an explicit provider decline is treated as a definitive payment failure. A timeout means the provider may have processed the request but the response did not arrive.
- **Unreachable vs. no response:** unreachable means the connection failed before the provider received the request; no response means the outcome may be unknown. Both consume a retry slot in these tests.
- **Final uncertain outcome:** if the final call is not an explicit decline, the tests expect `errored` rather than `failed` and one owner notification. Confirm this terminal-state and reconciliation policy with the product owner.
- **Duplicate submission:** resubmitting an in-flight payment is expected to reuse the original processing/retry chain and resolve with its current state.
- **Notification:** “notify” means notifying the business owner.

## Required mock surface

The test file assumes the following provider/notifier behavior. These are requirements for a test harness, not implementations included in this repository.

| Mock API | Expected behavior |
|---|---|
| `mockPaymentProvider.failTimes(n)` | The first `n` calls return explicit declines; later calls succeed. |
| `mockPaymentProvider.script(outcomes)` | Controls per-call outcomes: `decline`, `unreachable`, `no-response`, or `success`; calls after the script succeed. |
| `mockPaymentProvider.reset()` | Clears provider call history and configured behavior between tests. |
| `mockPaymentProvider.callCount` | Counts calls the application attempts to make, including connection attempts that never reach the provider. |
| `mockPaymentProvider.calls` | Records each call's payment ID, amount, and idempotency key. |
| `mockNotifier.reset()` | Clears notification history between tests. |
| `mockNotifier.wasCalled()` | Indicates whether an owner notification was sent. |
| `mockNotifier.callCount` / `mockNotifier.calls` | Exposes notification count and details, including payment ID. |
| `getPaymentStatus(id)` | Reads a payment's persisted/in-progress status while retries are still running. |

In the scripted mock, `unreachable` simulates a connection refusal before the provider receives the request; `no-response` simulates a timeout where the provider might already have processed it. Tests also assume the same idempotency key is reused on every retry.

## Priority rationale

Priorities reflect assumed business impact, not just the presence of an assertion. The added idempotency, duplicate-submission, and uncertain-outcome scenarios go beyond the brief retry specification and should be confirmed against the product contract.

| Test | Priority | Scenario | Business impact |
|---|---|---|---|
| #1 | P0 | Initial attempt succeeds | If a valid payment cannot complete on the primary path, the core payment flow is broken. |
| #2–#3 | P1 | Success on retry one or two | Important recovery paths, but they have less severe direct impact than duplicate charges or incorrect terminal states. |
| #4 | P0 | Success on the final retry | A payment that actually succeeded must not be marked failed, potentially prompting another collection attempt. |
| #5 | P1 | Exhausted retries | The retry cap must be respected; one extra call after explicit declines is usually less directly harmful than a duplicate charge or incorrect payment state. |
| #6 | P0 | Notify only after final decline | A premature alert cannot be recalled and may trigger unnecessary manual intervention even if the payment later succeeds. |
| #7 | P1 | Retry timing | The five-second interval is required, but an isolated timing deviation generally affects delay or provider load rather than payment correctness. |
| #8 | P0 | Duplicate submission during retry wait | A second processing chain for the same payment could submit it again and charge the customer twice. |
| #9–#12 | P1 | Unreachable and mixed provider outcomes | These cases check resilience and error reporting; terminal-state behavior for ambiguous outcomes needs product agreement. |
| #13 | P0 | Timeout followed by success | The initial request may already have been processed; reusing the idempotency key helps prevent a duplicate charge. |
| #14 | P0 | Every attempt times out | The final outcome is uncertain and needs safe status handling and reconciliation, not an unsupported claim that the payment definitely failed. |
| #15 | P0 | Payment identity and idempotency stay consistent | Changing the payment ID, amount, or key across retries could create duplicate or inconsistent transactions. |
| #16 | P2 / skipped | Invalid input | This remains skipped until the product contract defines which inputs are invalid and how rejection should work. |

**Priority guide:** P0 covers risks to core payment correctness, integrity, duplicate charging, or consequential false alerts. P1 covers important requirements with lower direct impact when isolated; P2 covers lower-priority or not-yet-specified behavior.

## What I would ship first, and what remains exposed

Before release, I would prioritize the core payment contract and duplicate-payment risks: **#1, #4, #5, and #6**, followed by **#8 and #13–#15** for duplicate submissions, idempotency, and uncertain provider outcomes. 

If time is limited, I would knowingly leave lower-priority gaps around the exact retry-delay boundary (**#7**), success specifically on retries one and two (**#2–#3**), and combinations of unreachable-provider and mixed outcomes (**#9–#12**) for the next iteration. That leaves some risk of defects in intermediate retry paths but the user will not face with irreversible impact, although it might be a bad experience
