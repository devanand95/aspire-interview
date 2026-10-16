const DEFAULT_CONFIG = {
  lookbackDays: 30,
  maxHistory: 50,
  maxTrendWindow: 10,
  minTrendWindow: 3,
  trendChangeThreshold: 0.40,
  failureStreakLength: 3,
  confidenceBands: [
    { minRuns: 1, level: "LOW" },
    { minRuns: 5, level: "MEDIUM" },
    { minRuns: 10, level: "HIGH" }
  ],
  timeoutAsFailure: false
};

function classifyTest(runs, options = {}) {
  if (!Array.isArray(runs)) throw new TypeError("runs must be an array");

  const config = { ...DEFAULT_CONFIG, ...options };
  validateConfig(config);
  const asOf = options.asOf ? new Date(options.asOf) : new Date();
  if (Number.isNaN(asOf.getTime())) throw new TypeError("asOf must be a valid date");

  const cutoff = new Date(asOf);
  cutoff.setUTCDate(cutoff.getUTCDate() - config.lookbackDays);

  const warnings = [];
  const eligibleRuns = [];
  let ignoredRuns = 0;

  for (const run of runs) {
    if (!run || typeof run !== "object") {
      ignoredRuns++;
      warnings.push("Ignored a malformed run record.");
      continue;
    }

    const status = String(run.status ?? "").toLowerCase();
    let outcome = null;

    if (["pass", "passed", "success"].includes(status)) {
      outcome = "pass";
    } else if (["fail", "failed", "failure"].includes(status)) {
      outcome = "fail";
    } else if (
      config.timeoutAsFailure &&
      ["timeout", "timed_out", "timed out"].includes(status)
    ) {
      outcome = "fail";
    } else {
      ignoredRuns++;
      warnings.push(`Ignored non-evaluable status: "${status || "missing"}".`);
      continue;
    }

    if (!run.timestamp) {
      ignoredRuns++;
      warnings.push("Ignored a run with a missing timestamp.");
      continue;
    }

    const timestamp = new Date(run.timestamp);
    if (Number.isNaN(timestamp.getTime())) {
      ignoredRuns++;
      warnings.push("Ignored a run with an invalid timestamp.");
      continue;
    }
    if (timestamp > asOf) {
      ignoredRuns++;
      warnings.push("Ignored a run timestamped after asOf.");
      continue;
    }
    if (timestamp < cutoff) {
      ignoredRuns++;
      continue;
    }

    eligibleRuns.push({ outcome, timestamp });
  }

  eligibleRuns.sort((a, b) => a.timestamp - b.timestamp);
  const history = eligibleRuns.slice(-config.maxHistory);

  let passes = 0;
  let failures = 0;
  for (const run of history) {
    if (run.outcome === "pass") passes++;
    else failures++;
  }

  let classification = null;
  if (history.length > 0) {
    if (passes === history.length) classification = "STABLE";
    else if (failures === history.length) classification = "CONSISTENTLY_FAILING";
    else classification = "FLAKY";
  }

  const confidence = getConfidence(history.length, config.confidenceBands);
  const trend = getTrend(
    history,
    config.maxTrendWindow,
    config.minTrendWindow,
    config.trendChangeThreshold
  );

  const recentRuns = history.slice(-config.failureStreakLength);
  const recentFailureStreak =
    recentRuns.length === config.failureStreakLength &&
    recentRuns.every(run => run.outcome === "fail");

  return {
    classification,
    confidence,
    trend,
    recentFailureStreak,
    counts: { validRuns: history.length, passes, failures, ignoredRuns },
    warnings
  };
}

function getConfidence(totalRuns, confidenceBands) {
  if (totalRuns === 0) return "NONE";

  let confidence = "NONE";
  for (const band of confidenceBands) {
    if (totalRuns >= band.minRuns) confidence = band.level;
  }
  return confidence;
}

function getTrend(history, maxWindow, minWindow, changeThreshold) {
  const windowSize = Math.min(maxWindow, Math.floor(history.length / 2));

  if (windowSize < minWindow) {
    return {
      classification: "INSUFFICIENT_HISTORY",
      earlierFailureRate: null,
      recentFailureRate: null,
      change: null
    };
  }

  const earlier = history.slice(-(windowSize * 2), -windowSize);
  const recent = history.slice(-windowSize);
  const earlierFailureRate = getFailureRate(earlier);
  const recentFailureRate = getFailureRate(recent);
  const change = recentFailureRate - earlierFailureRate;

  let classification = "NO_CLEAR_CHANGE";
  if (change >= changeThreshold) classification = "DETERIORATING";
  else if (change <= -changeThreshold) classification = "IMPROVING";

  return { classification, earlierFailureRate, recentFailureRate, change };
}

function getFailureRate(runs) {
  return runs.filter(run => run.outcome === "fail").length / runs.length;
}

function validateConfig(config) {
  for (const key of [
    "lookbackDays",
    "maxHistory",
    "maxTrendWindow",
    "minTrendWindow",
    "failureStreakLength"
  ]) {
    if (!Number.isInteger(config[key]) || config[key] < 1) {
      throw new TypeError(`${key} must be a positive integer`);
    }
  }

  if (config.minTrendWindow > config.maxTrendWindow) {
    throw new TypeError("minTrendWindow cannot exceed maxTrendWindow");
  }

  if (
    typeof config.trendChangeThreshold !== "number" ||
    config.trendChangeThreshold < 0 ||
    config.trendChangeThreshold > 1
  ) {
    throw new TypeError("trendChangeThreshold must be between 0 and 1");
  }

  if (
    !Array.isArray(config.confidenceBands) ||
    config.confidenceBands.some(
      band =>
        !Number.isInteger(band.minRuns) ||
        band.minRuns < 1 ||
        typeof band.level !== "string"
    )
  ) {
    throw new TypeError("confidenceBands must contain valid minRuns and level values");
  }
}

module.exports = { classifyTest, DEFAULT_CONFIG };
