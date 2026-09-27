'use strict';
/**
 * P1.2-B5-BK-L2 — Market Actionability Gate
 *
 * Pure module — no network, no DB, no Channex.
 * Evaluates whether a shadow market result can be acted upon.
 *
 * SAFETY:
 *   DB_WRITES        = 0  always
 *   PRICING_WRITES   = 0  always
 *   CHANNEX_CALLS    = 0  always
 *   NETWORK_CALLS    = 0  pure function
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Maximum absolute production-vs-candidate delta (%) allowed before
 * flagging LARGE_PRODUCTION_DEVIATION.
 *
 * NOTE: This is a safety rollout guard only — NOT an assertion about economic truth.
 * A 78% delta (as in M6) reflects a stale production signal, not a bad market signal.
 */
const MAX_UNVALIDATED_PRODUCTION_DELTA_PCT = 35;

/** All known marketStatus values */
const KNOWN_MARKET_STATUSES = new Set([
  'STABLE_DUAL',
  'EXTREME_DIVERGENCE',
  'AIRBNB_ONLY',
  'BOOKING_ONLY',
  'INSUFFICIENT',
]);

// ── evaluateMarketActionability ───────────────────────────────────────────────

/**
 * Evaluate whether the shadow market result is actionable.
 *
 * Fail-closed: all matching rules accumulate reasons; any reason → NOT_ACTIONABLE.
 *
 * @param {object} opts
 * @param {string}        opts.marketStatus         — e.g. 'BOOKING_ONLY'
 * @param {string}        opts.marketConfidence      — 'HIGH'|'MEDIUM'|'LOW'|'INSUFFICIENT'
 * @param {object}        [opts.sourceUsage]         — { airbnb: { included }, booking: { included } }
 * @param {object}        [opts.crossSourceDiagnostic] — { divergenceLevel }
 * @param {string}        [opts.airbnbReliability]   — e.g. 'STABLE_LOCAL_POOL'
 * @param {number|null}   [opts.candidateMedian]     — consensus median price
 * @param {number|null}   [opts.productionMedian]    — current DB production signal
 *
 * @returns {{ actionable: boolean, status: string, reasons: string[], warnings: string[] }}
 */
function evaluateMarketActionability({
  marketStatus,
  marketConfidence,
  sourceUsage         = null,
  crossSourceDiagnostic = null,
  airbnbReliability   = null,
  candidateMedian     = null,
  productionMedian    = null,
} = {}) {
  const reasons  = [];
  const warnings = [];

  // Rule 1: LOW_CONFIDENCE
  if (marketConfidence === 'LOW' || marketConfidence === 'INSUFFICIENT') {
    reasons.push('LOW_CONFIDENCE');
  }

  // Rule 2: SINGLE_SOURCE_BOOKING_ONLY
  if (marketStatus === 'BOOKING_ONLY') {
    reasons.push('SINGLE_SOURCE_BOOKING_ONLY');
  }

  // Rule 3: AIRBNB_ONLY_UNSTABLE_RELIABILITY
  if (marketStatus === 'AIRBNB_ONLY' && airbnbReliability !== 'STABLE_LOCAL_POOL') {
    reasons.push('AIRBNB_ONLY_UNSTABLE_RELIABILITY');
  }

  // Rule 4: NO_VALID_SOURCE — if INSUFFICIENT and not already caught by LOW_CONFIDENCE
  if (marketStatus === 'INSUFFICIENT' && !reasons.includes('LOW_CONFIDENCE')) {
    reasons.push('NO_VALID_SOURCE');
  }

  // Rule 5: INVALID_CANDIDATE_MEDIAN
  if (candidateMedian == null || !Number.isFinite(candidateMedian) || candidateMedian <= 0) {
    reasons.push('INVALID_CANDIDATE_MEDIAN');
  }

  // Rule 6: LARGE_PRODUCTION_DEVIATION
  if (
    productionMedian != null &&
    Number.isFinite(productionMedian) &&
    productionMedian > 0 &&
    candidateMedian != null &&
    Number.isFinite(candidateMedian) &&
    candidateMedian > 0
  ) {
    const deltaPct = Math.abs((candidateMedian - productionMedian) / productionMedian) * 100;
    if (deltaPct > MAX_UNVALIDATED_PRODUCTION_DELTA_PCT) {
      reasons.push('LARGE_PRODUCTION_DEVIATION');
      warnings.push(
        `production_deviation=${deltaPct.toFixed(2)}% (threshold=${MAX_UNVALIDATED_PRODUCTION_DELTA_PCT}%)`
      );
    }
  }

  // Rule 7: EXTREME_CROSS_SOURCE_DIVERGENCE
  if (
    crossSourceDiagnostic?.divergenceLevel === 'EXTREME' &&
    sourceUsage?.airbnb?.included === true &&
    sourceUsage?.booking?.included === true
  ) {
    reasons.push('EXTREME_CROSS_SOURCE_DIVERGENCE');
  }

  // Rule 8: UNKNOWN_MARKET_STATUS
  if (marketStatus != null && !KNOWN_MARKET_STATUSES.has(marketStatus)) {
    reasons.push('UNKNOWN_MARKET_STATUS');
  }

  const actionable = reasons.length === 0;
  return {
    actionable,
    status:   actionable ? 'ACTIONABLE' : 'NOT_ACTIONABLE',
    reasons,
    warnings,
  };
}

module.exports = {
  evaluateMarketActionability,
  MAX_UNVALIDATED_PRODUCTION_DELTA_PCT,
  KNOWN_MARKET_STATUSES,
};
