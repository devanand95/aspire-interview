# Aspire interview — take-home exercise

## A1 — Flaky-test classifier

- **Implementation:** [`a1/flaky_test_classifier.js`](./a1/flaky_test_classifier.js)
- **Tests:** [`a1/test/flaky_test_classifier.test.js`](./a1/test/flaky_test_classifier.test.js)
- **Run tests** (requires Node.js 18+): `npm --prefix a1 test`
- **Rules, assumptions, and limitations:** [`a1/README.md`](./a1/README.md)

A1 includes a runnable classifier and unit tests. Its README documents the behavior, defaults, and limitations.

## A3 — Payment retry test coverage

- **Test scenarios:** [`a3/payment_retry.test.ts`](./a3/payment_retry.test.ts)

A3 currently contains the test scenarios only; it is not runnable as-is. It needs the payment implementation, a mock provider/notifier service, and Jest/TypeScript test configuration before the tests can execute.
