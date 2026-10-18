# A1 — Flaky-test classifier

A dependency-free JavaScript implementation of the A1 take-home exercise, with unit tests using Node.js's built-in test runner.

## Run the tests

Requires Node.js 18 or later. From this directory:

```bash
npm test
```

To run only the classifier test file:

```bash
npm run test:classifier
```

You can also run the tests directly with `node --test`.

## What the tests cover

- **Classification:** all-pass (`STABLE`), all-fail (`CONSISTENTLY_FAILING`), mixed outcomes (`FLAKY`), and empty eligible history.
- **Confidence:** run-count bands (`NONE`, `LOW`, `MEDIUM`, `HIGH`).
- **Eligibility and data quality:** skipped/aborted/unknown statuses, timeout policy, lookback window, future/invalid/missing timestamps, and malformed records.
- **Trend:** `IMPROVING`, `DETERIORATING`, `NO_CLEAR_CHANGE`, and `INSUFFICIENT_HISTORY`.
- **Recent failures:** the configured consecutive-failure streak, excluding non-evaluable runs.
- **History and input validation:** `maxHistory`, invalid input, invalid reference date, and invalid configuration.

A per-test expected-output matrix is included as a block comment at the top of `test/flaky_test_classifier.test.js`. It maps each scenario to the returned `classification`, `confidence`, and `trend.classification`. Some table cells are inferred from the implementation where the corresponding test does not assert that specific field.

## Classification rules and defaults

- All eligible runs pass: `STABLE`.
- All eligible runs fail: `CONSISTENTLY_FAILING`.
- A mixture of passes and failures: `FLAKY`.
- No eligible runs: `classification: null`.
- Confidence reflects valid history size: 0 = `NONE`, 1–4 = `LOW`, 5–9 = `MEDIUM`, 10+ = `HIGH`.
- Defaults use a 30-day lookback and cap the history at the latest 50 eligible runs.
- Skipped, aborted, unknown, malformed, invalid-timestamp, future-dated, and out-of-lookback records are excluded from valid history.
- Timeouts are excluded by default. Set `timeoutAsFailure: true` when the source system's semantics justify treating timeouts as failures.
- Trends compare two adjacent windows of eligible outcomes. Each window needs at least 3 runs, window size is capped at 10, and a failure-rate change of at least 40 percentage points indicates improvement or deterioration.
- `recentFailureStreak` is true when the latest 3 valid outcomes are failures.

## Assumptions and limitations

The classifier cannot infer the cause of a generic failure. It can distinguish infrastructure failures from test failures only when the input provides a distinct status. The `asOf` option makes lookback behavior reproducible in tests and historical analysis.

The tests validate the classifier's unit-level behavior; they do not verify integration with a particular CI provider or production execution-history pipeline.
