# Aspire interview — take-home exercise

Solutions and tests for the Senior QA Engineer take-home assignment.

## A1 — Flaky-test classifier

The A1 solution contains a dependency-free JavaScript classifier and unit tests using Node.js's built-in test runner. See the [A1 README](./a1/README.md) for classification rules, defaults, assumptions, and test scope.

### Run A1 tests

From the repository root:

```bash
npm --prefix a1 test
```

Or run from the A1 directory:

```bash
cd a1
npm test
```

Requires Node.js 18 or later. No third-party package installation is required.

### Coverage overview

The A1 tests cover the core classifications (`STABLE`, `FLAKY`, and `CONSISTENTLY_FAILING`), confidence bands, ignored or invalid execution records, trend detection, recent failure streaks, history limits, and input/configuration validation.

A qualitative coverage review and prioritized follow-up test ideas are recorded as a comment at the top of [the A1 test file](./a1/test/flaky_test_classifier.test.js). These ratings are reviewer judgment, not measured line or branch coverage. The tests are unit tests and do not currently exercise integration with a real CI provider.
