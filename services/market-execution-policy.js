'use strict';
/**
 * P1.2-B5-BK-L5 — Market Execution Policy
 *
 * Pure module — no network, no DB, no Channex.
 * Evaluates historical window results to recommend an execution policy.
 *
 * SAFETY:
 *   DB_WRITES        = 0  always
 *   PRICING_WRITES   = 0  always
 *   CHANNEX_CALLS    = 0  always
 *   NETWORK_CALLS    = 0  pure function
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/** Minimum window runs before issuing a policy recommendation */
const MIN_EVIDENCE_RUNS = 2;

/** earlyStopRate required for TWO_SNAPSHOT_EARLY_STOP */
const MIN_EARLY_STOP_RATE_FOR_TWO_SNAP = 0.75;

/** threeCallRate required for THREE_SNAPSHOT_REQUIRED */
const MIN_THREE_CALL_RATE_FOR_THREE_SNAP = 0.5;

/** Minimum total runs for SINGLE_SNAPSHOT_ALLOWED */
const MIN_RUNS_FOR_SINGLE_SNAP = 3;

// ── evaluateExecutionPolicy ───────────────────────────────────────────────────

/**
 * Evaluate the recommended Airbnb BD execution policy given a history of
 * per-window run results.
 *
 * @param {Array<WindowResult>} windowResults
 *   Each element: {
 *     earlyStopTriggered: boolean,
 *     actualBdCalls:      number,
 *     airbnbReliabilityStatus: string,
 *     airbnbGeoStatuses:  string[],
 *   }
 *
 * @returns {{ policy: string, reason: string, evidence: EvidenceObject }}
 */
function evaluateExecutionPolicy(windowResults = []) {
  const total = windowResults.length;

  // Rule 1: insufficient evidence
  if (total < MIN_EVIDENCE_RUNS) {
    return {
      policy:   'INSUFFICIENT_EVIDENCE',
      reason:   `fewer than ${MIN_EVIDENCE_RUNS} runs (got ${total})`,
      evidence: {
        totalRuns:       total,
        earlyStopRuns:   0,
        threeCallRuns:   0,
        stableRuns:      0,
        degradedGeoRuns: 0,
        earlyStopRate:   null,
        threeCallRate:   null,
        stableRate:      null,
      },
    };
  }

  let earlyStopRuns   = 0;
  let threeCallRuns   = 0;
  let stableRuns      = 0;
  let degradedGeoRuns = 0;

  for (const w of windowResults) {
    if (w.earlyStopTriggered)                              earlyStopRuns++;
    if (w.actualBdCalls >= 3)                              threeCallRuns++;
    if (w.airbnbReliabilityStatus === 'STABLE_LOCAL_POOL') stableRuns++;

    const hasDegraded = Array.isArray(w.airbnbGeoStatuses) &&
      w.airbnbGeoStatuses.some(s => s !== 'STABLE' && s !== 'USABLE');
    if (hasDegraded) degradedGeoRuns++;
  }

  const earlyStopRate = earlyStopRuns / total;
  const threeCallRate = threeCallRuns / total;
  const stableRate    = stableRuns    / total;

  const evidence = {
    totalRuns:       total,
    earlyStopRuns,
    threeCallRuns,
    stableRuns,
    degradedGeoRuns,
    earlyStopRate,
    threeCallRate,
    stableRate,
  };

  // Rule 4: SINGLE_SNAPSHOT_ALLOWED (most restrictive — check first)
  if (
    earlyStopRate === 1.0 &&
    stableRate    === 1.0 &&
    degradedGeoRuns === 0 &&
    total >= MIN_RUNS_FOR_SINGLE_SNAP
  ) {
    return {
      policy:  'SINGLE_SNAPSHOT_ALLOWED',
      reason:  `all ${total} runs triggered early-stop with stable geo`,
      evidence,
    };
  }

  // Rule 5: TWO_SNAPSHOT_EARLY_STOP
  if (earlyStopRate >= MIN_EARLY_STOP_RATE_FOR_TWO_SNAP && stableRate === 1.0) {
    return {
      policy:  'TWO_SNAPSHOT_EARLY_STOP',
      reason:  `earlyStopRate=${(earlyStopRate * 100).toFixed(0)}% >= ${MIN_EARLY_STOP_RATE_FOR_TWO_SNAP * 100}% with stable reliability`,
      evidence,
    };
  }

  // Rule 6: THREE_SNAPSHOT_REQUIRED
  if (threeCallRate >= MIN_THREE_CALL_RATE_FOR_THREE_SNAP) {
    return {
      policy:  'THREE_SNAPSHOT_REQUIRED',
      reason:  `threeCallRate=${(threeCallRate * 100).toFixed(0)}% >= ${MIN_THREE_CALL_RATE_FOR_THREE_SNAP * 100}%`,
      evidence,
    };
  }

  // Rule 7: fallback
  return {
    policy:  'INSUFFICIENT_EVIDENCE',
    reason:  'no policy criteria met',
    evidence,
  };
}

module.exports = {
  evaluateExecutionPolicy,
  MIN_EVIDENCE_RUNS,
  MIN_EARLY_STOP_RATE_FOR_TWO_SNAP,
  MIN_THREE_CALL_RATE_FOR_THREE_SNAP,
  MIN_RUNS_FOR_SINGLE_SNAP,
};
