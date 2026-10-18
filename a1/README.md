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

## Limitations and interpretation

### Lookback and thresholds need real history

These defaults are starting heuristics, not universal thresholds or statistically calibrated guarantees. A 30-day lookback may be useful for a frequently executed test, but it might contain very few runs for a rarely executed test. Conversely, older failures may still be relevant for a test that runs infrequently. The 50-run history cap can also give two tests different effective time ranges when their execution frequencies differ.

The confidence value is based only on the number of eligible runs. It is **not** a statistical confidence interval and does not account for sample independence, execution frequency, or how representative those runs are. Ten runs from one short-lived environment may provide less useful evidence than ten runs spread across different days, workers, or deployments.

The 40-percentage-point trend threshold, three-run minimum per window, and maximum window of ten runs are configurable design choices. They should be reviewed against historical CI data: compare alerts with known regressions and known flaky periods, then tune the values to balance missed changes against noisy alerts. Avoid tuning only to make the current sample data look good.

### What `NO_CLEAR_CHANGE` does—and does not—mean

`NO_CLEAR_CHANGE` means the difference between the two measured failure rates did not reach the configured positive or negative threshold. It does **not** prove that behavior is unchanged, that the test is stable, or that there is no regression.

For example, if the failure rate moves from 10% to 35%, the increase is 25 percentage points, below the default 40-point threshold. The result is `NO_CLEAR_CHANGE`, even though the failure rate rose materially. Several small increases across successive windows may also go unflagged, because this implementation compares only two adjacent windows at a time.

The current trend calculation can miss:
- gradual deterioration or improvement made up of changes smaller than the threshold;
- short bursts of failures that fall outside the most recent window;
- periodic or environment-specific failures that get averaged together;
- a changed failure mode when the overall pass/fail rate stays similar;
- differences tied to branch, deployment, browser, worker, test data, or other execution context.

The overall classification is also intentionally simple: any mixture of passes and failures is labelled `FLAKY`. It does not distinguish one isolated failure from repeated intermittent failures, or a test that used to fail but has recently recovered, except for the separate trend and failure-streak signals.

### Ignored inputs should be observable, not invisible

Some records should not count as pass/fail evidence. For example, a skipped test was not evaluated, and a future-dated record should not influence a historical result. Excluding these records from the rate calculation is reasonable; silently losing the information about them is not.

The current implementation returns an aggregate `ignoredRuns` count and warning strings for several cases, but it does not return a structured count for every ignore reason. In particular, records outside the lookback window are excluded without a warning. This can hide upstream problems such as a changed CI status name, missing timestamps, broken imports, or incorrectly normalized records.

A stronger production version would:
- return structured counts by reason, such as `skipped`, `aborted`, `unknown_status`, `missing_timestamp`, `invalid_timestamp`, `future_timestamp`, and `outside_lookback`;
- distinguish expected exclusions (for example, skipped/aborted runs) from data-quality problems (for example, unknown statuses or malformed records);
- include the original test/run identifiers in diagnostics where appropriate, while avoiding sensitive data;
- expose the percentage of records ignored and warn or fail in a strict mode if it exceeds an agreed threshold;
- map statuses explicitly for each CI provider rather than treating every unfamiliar status as simply non-evaluable.

The principle is to **exclude unsuitable records from the classification, but report clearly why they were excluded**. A classifier should not convert incomplete or broken input into a reassuring-looking `STABLE` result without making the data-quality problem visible.

### The classifier cannot diagnose root cause

The implementation sees pass/fail status and timestamps; it does not inspect stack traces, error messages, environment metadata, code changes, or resource metrics. It therefore cannot determine whether a failure was caused by a product defect, a flaky assertion, a test-data race, a slow worker, a network issue, or a dependency outage. It can distinguish infrastructure failures from test failures only when the input encodes a distinct status.

Useful future extensions include grouping failures by normalized error signature, adding execution context (CI provider, branch, commit, worker, browser, environment), detecting failure bursts, and correlating changes with deployments. Such signals can help investigation, but should be presented as evidence or hypotheses rather than certain root-cause conclusions.

## Assumptions and validation boundary

The `asOf` option makes lookback behavior reproducible in tests and historical analysis. The current suite validates unit-level classifier behavior; it does not verify integration with a particular CI provider or production execution-history pipeline. Before using the outputs for release decisions, calibrate the defaults on real historical data and monitor the quality and completeness of the input history.
