/*
 * Coverage review — qualitative assessment, not a measured line/branch coverage report.
 *
 * Area                         Rating       Assessment
 * ---------------------------  -----------  -----------------------------------------------
 * Classification / stability   9/10         Covers STABLE, FLAKY, and CONSISTENTLY_FAILING.
 * Confidence                   8/10         Covers LOW, MEDIUM, and HIGH run-count bands.
 * Trend detection              8/10         Covers improving, deteriorating, unchanged, and
 *                                           insufficient-history cases.
 * Input validation / filtering 8/10         Covers ignored statuses, malformed records, and
 *                                           invalid, future, or out-of-window timestamps.
 * Recent failure streak        7/10         Covers the default three-failure streak and an
 *                                           ignored skipped run within the streak.
 * History cap / ordering       7/10         Covers maxHistory; shuffled-input behavior could
 *                                           be asserted explicitly.
 * Configuration validation     6/10         Checks several invalid options; custom valid
 *                                           configurations and more boundaries need tests.
 * Real CI integration          Not covered  These are unit tests; CI adapters and real result
 *                                           payloads are not exercised here.
 *
 * Highest-value follow-up tests (not yet explicitly covered):
 * - Trend changes just below, exactly at, and just above +/- trendChangeThreshold.
 * - A timestamp exactly at the lookback cutoff and one just outside it.
 * - Identical timestamped history supplied in different input orders.
 * - Custom valid configuration values, including failureStreakLength and confidenceBands.
 * - Supported status aliases and uppercase/mixed-case statuses.
 *
 * Ratings are reviewer judgment, not percentages or test-runner coverage numbers.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyTest } = require("../flaky_test_classifier");

const asOf = "2026-10-16T00:00:00Z";

function makeRuns(statuses, start = "2026-10-15T10:00:00Z") {
  const startTime = new Date(start).getTime();
  return statuses.map((status, index) => ({
    status,
    timestamp: new Date(startTime + index * 60_000).toISOString()
  }));
}

test("all passing runs are stable", () => {
  assert.equal(classifyTest(makeRuns(["pass", "pass", "pass"]), { asOf }).classification, "STABLE");
});

test("all failing runs are consistently failing", () => {
  assert.equal(classifyTest(makeRuns(["fail", "fail", "fail"]), { asOf }).classification, "CONSISTENTLY_FAILING");
});

test("mixed pass/fail runs are flaky", () => {
  assert.equal(classifyTest(makeRuns(["pass", "fail", "pass"]), { asOf }).classification, "FLAKY");
});

test("one pass has low confidence", () => {
  const result = classifyTest(makeRuns(["pass"]), { asOf });
  assert.equal(result.classification, "STABLE");
  assert.equal(result.confidence, "LOW");
});

test("one failure has low confidence", () => {
  const result = classifyTest(makeRuns(["fail"]), { asOf });
  assert.equal(result.classification, "CONSISTENTLY_FAILING");
  assert.equal(result.confidence, "LOW");
});

test("confidence is based on valid run count", () => {
  assert.equal(classifyTest(makeRuns(["pass", "pass", "pass", "pass"]), { asOf }).confidence, "LOW");
  assert.equal(classifyTest(makeRuns(["pass", "pass", "pass", "pass", "pass"]), { asOf }).confidence, "MEDIUM");
  assert.equal(classifyTest(makeRuns(Array(10).fill("pass")), { asOf }).confidence, "HIGH");
});

test("empty history returns no classification and no confidence", () => {
  const result = classifyTest([], { asOf });
  assert.equal(result.classification, null);
  assert.equal(result.confidence, "NONE");
  assert.equal(result.trend.classification, "INSUFFICIENT_HISTORY");
});

test("skipped and aborted runs do not affect classification or confidence", () => {
  const result = classifyTest(makeRuns(["pass", "skipped", "pass", "aborted", "pass"]), { asOf });
  assert.equal(result.classification, "STABLE");
  assert.equal(result.confidence, "LOW");
  assert.equal(result.counts.validRuns, 3);
  assert.equal(result.counts.ignoredRuns, 2);
});

test("all non-evaluable statuses return no classification", () => {
  const result = classifyTest(makeRuns(["skipped", "aborted", "unknown"]), { asOf });
  assert.equal(result.classification, null);
  assert.equal(result.confidence, "NONE");
  assert.equal(result.counts.validRuns, 0);
  assert.equal(result.counts.ignoredRuns, 3);
});

test("unknown statuses are ignored with a warning", () => {
  const result = classifyTest(makeRuns(["pass", "mystery", "fail"]), { asOf });
  assert.equal(result.classification, "FLAKY");
  assert.equal(result.counts.validRuns, 2);
  assert.equal(result.counts.ignoredRuns, 1);
  assert.ok(result.warnings.some(warning => warning.includes("mystery")));
});

test("timeout is ignored by default", () => {
  const result = classifyTest(makeRuns(["pass", "timeout", "fail"]), { asOf });
  assert.equal(result.classification, "FLAKY");
  assert.equal(result.counts.validRuns, 2);
  assert.equal(result.counts.failures, 1);
});

test("timeout can be configured as a failure", () => {
  const result = classifyTest(makeRuns(["pass", "timeout", "fail"]), { asOf, timeoutAsFailure: true });
  assert.equal(result.counts.validRuns, 3);
  assert.equal(result.counts.failures, 2);
  assert.equal(result.classification, "FLAKY");
});

test("older runs outside lookback are excluded", () => {
  const oldRuns = makeRuns(["fail"], "2026-09-01T10:00:00Z");
  const recentRuns = makeRuns(["pass"]);
  const result = classifyTest([...oldRuns, ...recentRuns], { asOf, lookbackDays: 7 });
  assert.equal(result.classification, "STABLE");
  assert.equal(result.counts.validRuns, 1);
});

test("future and invalid timestamps are ignored", () => {
  const result = classifyTest([
    ...makeRuns(["pass"]),
    { status: "fail", timestamp: "2026-10-17T00:00:00Z" },
    { status: "fail", timestamp: "not-a-date" }
  ], { asOf });
  assert.equal(result.classification, "STABLE");
  assert.equal(result.counts.validRuns, 1);
  assert.equal(result.counts.ignoredRuns, 2);
});

test("missing timestamps and malformed records are ignored", () => {
  const result = classifyTest([
    { status: "pass" },
    null,
    "bad record",
    { status: "pass", timestamp: "2026-10-15T10:00:00Z" }
  ], { asOf });
  assert.equal(result.classification, "STABLE");
  assert.equal(result.counts.validRuns, 1);
  assert.equal(result.counts.ignoredRuns, 3);
});

test("trend detects deterioration", () => {
  const result = classifyTest(makeRuns(["pass", "pass", "pass", "pass", "fail", "fail", "fail", "fail"]), { asOf });
  assert.equal(result.trend.classification, "DETERIORATING");
  assert.equal(result.trend.change, 1);
});

test("trend detects improvement", () => {
  const result = classifyTest(makeRuns(["fail", "fail", "fail", "pass", "pass", "pass"]), { asOf });
  assert.equal(result.trend.classification, "IMPROVING");
  assert.equal(result.trend.change, -1);
});

test("all-pass and all-fail histories have no clear trend", () => {
  assert.equal(classifyTest(makeRuns(Array(6).fill("pass")), { asOf }).trend.classification, "NO_CLEAR_CHANGE");
  assert.equal(classifyTest(makeRuns(Array(6).fill("fail")), { asOf }).trend.classification, "NO_CLEAR_CHANGE");
});

test("mixed history without a significant rate change has no clear trend", () => {
  const result = classifyTest(makeRuns(["pass", "fail", "pass", "fail", "pass", "fail"]), { asOf });
  assert.equal(result.trend.classification, "NO_CLEAR_CHANGE");
});

test("trend is insufficient with fewer than six valid runs", () => {
  const result = classifyTest(makeRuns(["pass", "fail", "pass", "pass"]), { asOf });
  assert.equal(result.trend.classification, "INSUFFICIENT_HISTORY");
  assert.equal(result.trend.change, null);
});

test("skipped and aborted runs do not affect trend windows", () => {
  const result = classifyTest(makeRuns(["fail", "fail", "aborted", "fail", "pass", "skipped", "pass", "pass"]), { asOf });
  assert.equal(result.trend.classification, "IMPROVING");
});

test("three latest valid failures trigger a failure streak", () => {
  const result = classifyTest(makeRuns(["pass", "fail", "fail", "fail"]), { asOf });
  assert.equal(result.recentFailureStreak, true);
});

test("skipped run after failures does not break the valid failure streak", () => {
  const result = classifyTest(makeRuns(["fail", "fail", "skipped", "fail"]), { asOf });
  assert.equal(result.recentFailureStreak, true);
});

test("history is capped at the latest configured number of runs", () => {
  const result = classifyTest(makeRuns([...Array(50).fill("pass"), "fail"], "2026-10-15T10:00:00Z"), { asOf, maxHistory: 10 });
  assert.equal(result.counts.validRuns, 10);
  assert.equal(result.counts.passes, 9);
  assert.equal(result.counts.failures, 1);
});

test("non-array input throws", () => {
  assert.throws(() => classifyTest(null, { asOf }), /runs must be an array/);
});

test("invalid reference date throws", () => {
  assert.throws(() => classifyTest([], { asOf: "not-a-date" }), /asOf must be a valid date/);
});

test("invalid configuration throws", () => {
  assert.throws(() => classifyTest([], { asOf, maxHistory: 0 }), /maxHistory/);
  assert.throws(() => classifyTest([], { asOf, minTrendWindow: 4, maxTrendWindow: 3 }), /minTrendWindow/);
  assert.throws(() => classifyTest([], { asOf, trendChangeThreshold: 1.1 }), /trendChangeThreshold/);
  assert.throws(() => classifyTest([], { asOf, confidenceBands: [{ minRuns: 0, level: "LOW" }] }), /confidenceBands/);
});
