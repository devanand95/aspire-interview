# A1 — Flaky-test classifier

A dependency-free JavaScript implementation of the A1 take-home exercise.

## Run

Requires Node.js with the built-in test runner (Node 18+ recommended).

```bash
node --test
```

Run the command from this `a1` directory.

## Classification rules

- All eligible runs pass: `STABLE`.
- All eligible runs fail: `CONSISTENTLY_FAILING`.
- A mixture of passes and failures: `FLAKY`.
- No eligible runs: `classification: null`.
- Confidence reflects valid history size: 0 = `NONE`, 1–4 = `LOW`, 5–9 = `MEDIUM`, 10+ = `HIGH`.
- Skipped, aborted, unknown, malformed, invalid-timestamp, future-dated, and out-of-lookback records are excluded from valid history.
- Timeouts are excluded by default because the status alone may not reveal whether the cause was the test or infrastructure. Set `timeoutAsFailure: true` when the CI reporting semantics justify treating timeouts as test failures.
- Trends compare two adjacent windows of valid outcomes. Window size is capped at 10 and each window needs at least 3 runs. A failure-rate change of at least 40 percentage points is classified as `IMPROVING` or `DETERIORATING`.
- `recentFailureStreak` is true when the latest 3 valid outcomes are failures.

## Assumptions and limitations

The classifier cannot infer the cause of a generic failure. It can distinguish infrastructure failures from test failures only when the input contains a distinct status. The `asOf` option makes lookback behavior reproducible in tests and historical analysis.
