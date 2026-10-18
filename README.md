# Aspire interview — take-home exercise

Solutions and test scenarios for the Senior QA Engineer take-home assignment.

## A1 — Flaky-test classifier

A dependency-free JavaScript classifier with unit tests using Node.js's built-in test runner.

See the [A1 README](./a1/README.md) for the classification rules, defaults, assumptions, and test scope.

### Run A1 tests

From the repository root:

```bash
npm --prefix a1 test
```

Or from the A1 directory:

```bash
cd a1
npm test
```

Requires Node.js 18 or later. No third-party package installation is required.

### Test output map

The [A1 test file](./a1/test/flaky_test_classifier.test.js) begins with a table mapping each test scenario to its expected `classification`, `confidence`, and `trend.classification`. Where a test does not assert every field, the table notes that values are inferred from the implementation.

The suite covers classification, confidence bands, trend detection, ignored or invalid execution records, recent failure streaks, history limits, and input/configuration validation. These are unit tests; they do not exercise integration with a real CI provider.

## A3 — Payment retry test coverage

The [A3 test file](./a3/payment_retry.test.ts) reviews the payment-retry behavior described in the assignment: one initial attempt, up to three retries, five seconds between attempts, completion if an attempt succeeds, and a failed status plus owner notification after repeated explicit declines.

### Priority rationale

The priorities are based on potential business impact, not just whether a test checks a stated requirement.

| Test | Priority | Scenario | Business impact |
|---|---|---|---|
| #1 | P0 | Initial attempt succeeds | A valid payment must complete through the primary path; otherwise the core payment flow is broken. |
| #4 | P0 | Success on the final retry | A payment that succeeded must not be marked failed, which could lead to unnecessary follow-up or another payment attempt. |
| #6 | P0 | Notify only after final decline | A premature alert cannot be recalled and may prompt unnecessary manual intervention even if a later retry succeeds. |
| #8 | P0 | Duplicate submission during retry wait | A second processing chain for the same payment could submit it again and charge the customer twice. |
| #13 | P0 | Timeout followed by success | The provider may have processed the first request despite no response; using the same idempotency key helps avoid a duplicate charge. |
| #14 | P0 | All attempts time out | The outcome is uncertain and needs appropriate status handling and reconciliation rather than a misleading definitive failure. |
| #15 | P0 | Payment identity and idempotency stay consistent | Changing the payment ID, amount, or idempotency key across retries could cause duplicate or inconsistent transactions. |
| #2, #3 | P1 | Success on the first or second retry | Retry recovery should work, though the later-retry and terminal-state cases carry greater release risk. |
| #5 | P1 | Exhausted retries | The retry limit must be respected; an extra call after explicit declines is usually less directly harmful than a duplicate charge or incorrect payment state. |
| #7 | P1 | Retry timing | The five-second interval is required, but an isolated timing deviation usually affects delay or provider load rather than payment correctness. |
| #9–#12 | P1 | Unreachable provider and mixed decline/connection-error outcomes | These cases matter for resilience and correct error reporting; the precise terminal-state policy should be confirmed with the product owner. |
| #16 | P2 / skipped | Invalid input | The test is intentionally skipped until the product contract defines which inputs are invalid and how rejection should work. |

P0 is reserved for scenarios that could directly compromise payment correctness, payment integrity, or trigger consequential false alerts. P1 covers important behavior with comparatively lower direct impact when considered in isolation. The P0 classifications for idempotency, duplicate submission, and uncertain provider outcomes are risk-based extensions beyond the short retry specification and should be confirmed against the intended product contract.

### Important outcome distinction

The test assumptions distinguish three provider outcomes:

- **Decline:** The provider explicitly rejects the payment. If the final permitted attempt is explicitly declined, the expected status is `failed` and the owner is notified.
- **Unreachable:** The connection fails before the provider receives the request. In this test model, the request was not processed; the call still uses a retry slot.
- **Timeout / no response:** The request may have reached and been processed by the provider, but the response did not arrive. The actual payment outcome is unknown, so retries must reuse the same idempotency key and the terminal-state/reconciliation behavior must follow the product contract.

The current A3 file is a test specification, not a standalone runnable suite: the payment implementation, mock implementation, and Jest/TypeScript test configuration are not included in the repository. Its assumed `errored` status and notification/reconciliation behavior need confirmation against the real product contract before implementation and execution.

## AI usage

AI was used as a reviewer, to enhance ideas and identify edge cases, and as a coding aid, particularly for learning Jest and fake timers in A3. Suggestions were reviewed and refined against the assignment requirements.
