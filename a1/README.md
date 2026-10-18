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
- The default lookback is 30 days, and at most the latest 50 eligible runs are used.
- Skipped, aborted, unknown, malformed, invalid-timestamp, future-dated, and out-of-lookback records do not contribute to classification.
- Timeouts are excluded by default. Set `timeoutAsFailure: true` only if the CI system's timeout semantics justify counting them as test failures.
- Trend analysis compares two adjacent windows of eligible outcomes. Each window needs at least 3 runs, each is capped at 10 runs, and a failure-rate change of at least 40 percentage points is labelled `IMPROVING` or `DETERIORATING`.
- `recentFailureStreak` is true when the latest 3 valid outcomes are failures.

## Limitations

### History and thresholds
The 30-day lookback, 50-run cap, and 40-percentage-point trend threshold are starting heuristics; calibrate them against real CI history. Confidence reflects the number of valid runs, not statistical certainty.

### `NO_CLEAR_CHANGE`
This means the failure-rate change did not cross the threshold—not that behavior is unchanged. Small gradual regressions, short failure bursts, and environment-specific patterns may be missed.

### Ignored inputs
Ignored records are excluded, but the current output gives only aggregate counts and warnings; out-of-lookback records have no warning. A stronger version should report structured counts by exclusion reason and flag unexpectedly high data-quality issues.

### Root cause and integration
Pass/fail history alone cannot identify whether failures come from the product, tests, or infrastructure; error signatures and CI context would help investigation. The current tests validate unit logic, not integration with a real CI pipeline.
