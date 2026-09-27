'use strict';
/**
 * P1.2-B5-BK-M10F-4 — Historical Market Anomaly Classifier
 *
 * Pure module — no network, no DB, no Channex.
 *
 * Given a historical baseline (from M10F-2) and a stay-window compatibility
 * result (from M10F-3), classifies the latest market_data row as:
 *
 *   NONE         — no statistically significant deviation
 *   LOW          — minor deviation worth noting
 *   HIGH         — meaningful deviation requiring investigation
 *   CRITICAL     — extreme deviation (ratio ≥ CRITICAL_RATIO)
 *   INCONCLUSIVE — not enough history to classify
 *
 * Thresholds (constants, never hardcoded per-property):
 *   CRITICAL_SPIKE_RATIO =  2.0  (latest ≥ 2× history median → CRITICAL)
 *   HIGH_SPIKE_RATIO     =  1.5  (latest ≥ 1.5× → HIGH)
 *   LOW_SPIKE_RATIO      =  1.2  (latest ≥ 1.2× → LOW)
 *   CRITICAL_DROP_RATIO  =  0.5  (latest ≤ 0.5× → CRITICAL)
 *   HIGH_DROP_RATIO      =  0.67 (latest ≤ 0.67× → HIGH)
 *   LOW_DROP_RATIO       =  0.85 (latest ≤ 0.85× → LOW)
 *   COUNT_SPIKE_RATIO    =  2.5  (comparable_count ≥ 2.5× history median → flag)
 *   COUNT_DROP_RATIO     =  0.4  (comparable_count ≤ 0.4× history median → flag)
 *
 * SAFETY:
 *   DB_WRITES        = 0  always
 *   PRICING_WRITES   = 0  always
 *   CHANNEX_CALLS    = 0  always
 *   NETWORK_CALLS    = 0  pure function
 */

// ── Thresholds ─────────────────────────────────────────────────────────────────

const CRITICAL_SPIKE_RATIO = 2.0;
const HIGH_SPIKE_RATIO     = 1.5;
const LOW_SPIKE_RATIO      = 1.2;
const CRITICAL_DROP_RATIO  = 0.5;
const HIGH_DROP_RATIO      = 0.67;
const LOW_DROP_RATIO       = 0.85;
const COUNT_SPIKE_RATIO    = 2.5;
const COUNT_DROP_RATIO     = 0.4;

// ── Private helpers ───────────────────────────────────────────────────────────

const SEVERITY_ORDER = { NONE: 0, LOW: 1, HIGH: 2, CRITICAL: 3 };

function _maxSeverity(a, b) {
  return SEVERITY_ORDER[a] >= SEVERITY_ORDER[b] ? a : b;
}

// ── classifyHistoricalAnomaly ─────────────────────────────────────────────────

/**
 * Classify a market_data anomaly relative to its historical baseline.
 *
 * @param {object} baseline          — result of buildHistoricalBaseline (M10F-2)
 * @param {object} windowCompat      — result of checkStayWindowCompatibility (M10F-3)
 * @returns {{
 *   severity:               'NONE'|'LOW'|'HIGH'|'CRITICAL'|'INCONCLUSIVE',
 *   reasons:                string[],
 *   warnings:               string[],
 *   metrics:                object,
 * }}
 */
function classifyHistoricalAnomaly(baseline, windowCompat) {
  const warnings = [];
  const reasons  = [];

  // Guard: insufficient history
  if (!baseline || baseline.status === 'INSUFFICIENT_HISTORY') {
    return {
      severity: 'INCONCLUSIVE',
      reasons:  ['insufficient_history'],
      warnings: [],
      metrics:  {
        historyCount:            baseline?.historyCount ?? 0,
        latestMedian:            baseline?.latestMedian ?? null,
        historyMedian:           null,
        ratioVsHistoryMedian:    null,
        deltaVsHistoryMedianPct: null,
        windowCompatStatus:      windowCompat?.status ?? null,
      },
    };
  }

  const {
    latestMedian,
    historyMedian,
    ratioVsHistoryMedian,
    deltaVsHistoryMedianPct,
    historyCount,
    historyMin,
    historyMax,
    iqrLow,
    iqrHigh,
    mad,
    latestCount,
    historyCountMedian,
  } = baseline;

  const windowStatus = windowCompat?.status ?? 'UNKNOWN_WINDOW';

  // Warn when window comparability is unknown
  if (windowStatus === 'UNKNOWN_WINDOW') {
    warnings.push('window_comparability_unknown');
  }

  const metrics = {
    historyCount,
    latestMedian,
    historyMedian,
    historyMin,
    historyMax,
    iqrLow,
    iqrHigh,
    mad,
    ratioVsHistoryMedian,
    deltaVsHistoryMedianPct,
    latestCount,
    historyCountMedian,
    windowCompatStatus: windowStatus,
  };

  // Guard: missing latest median
  if (latestMedian == null || latestMedian <= 0) {
    return {
      severity: 'INCONCLUSIVE',
      reasons:  ['no_latest_median'],
      warnings,
      metrics,
    };
  }

  // Guard: missing history median
  if (historyMedian == null || historyMedian <= 0) {
    return {
      severity: 'INCONCLUSIVE',
      reasons:  ['no_history_median'],
      warnings,
      metrics,
    };
  }

  const ratio = ratioVsHistoryMedian;
  let priceSeverity = 'NONE';

  // Spike detection (ratio > 1)
  if (ratio >= CRITICAL_SPIKE_RATIO) {
    priceSeverity = 'CRITICAL';
    reasons.push(`price_spike_critical: ratio=${ratio.toFixed(3)} ≥ ${CRITICAL_SPIKE_RATIO}`);
  } else if (ratio >= HIGH_SPIKE_RATIO) {
    priceSeverity = 'HIGH';
    reasons.push(`price_spike_high: ratio=${ratio.toFixed(3)} ≥ ${HIGH_SPIKE_RATIO}`);
  } else if (ratio >= LOW_SPIKE_RATIO) {
    priceSeverity = 'LOW';
    reasons.push(`price_spike_low: ratio=${ratio.toFixed(3)} ≥ ${LOW_SPIKE_RATIO}`);
  }

  // Drop detection (ratio < 1)
  if (ratio <= CRITICAL_DROP_RATIO) {
    priceSeverity = _maxSeverity(priceSeverity, 'CRITICAL');
    reasons.push(`price_drop_critical: ratio=${ratio.toFixed(3)} ≤ ${CRITICAL_DROP_RATIO}`);
  } else if (ratio <= HIGH_DROP_RATIO) {
    priceSeverity = _maxSeverity(priceSeverity, 'HIGH');
    reasons.push(`price_drop_high: ratio=${ratio.toFixed(3)} ≤ ${HIGH_DROP_RATIO}`);
  } else if (ratio <= LOW_DROP_RATIO) {
    priceSeverity = _maxSeverity(priceSeverity, 'LOW');
    reasons.push(`price_drop_low: ratio=${ratio.toFixed(3)} ≤ ${LOW_DROP_RATIO}`);
  }

  // Count spike / drop (informational flag — escalates to LOW minimum when triggered)
  let countSeverity = 'NONE';
  if (latestCount != null && historyCountMedian != null && historyCountMedian > 0) {
    const countRatio = latestCount / historyCountMedian;
    if (countRatio >= COUNT_SPIKE_RATIO) {
      countSeverity = 'LOW';
      warnings.push(`count_spike: latestCount=${latestCount} is ${countRatio.toFixed(2)}× historyCountMedian=${historyCountMedian}`);
    } else if (countRatio <= COUNT_DROP_RATIO) {
      countSeverity = 'LOW';
      warnings.push(`count_drop: latestCount=${latestCount} is ${countRatio.toFixed(2)}× historyCountMedian=${historyCountMedian}`);
    }
  }

  const severity = _maxSeverity(priceSeverity, countSeverity);

  return {
    severity,
    reasons,
    warnings,
    metrics,
  };
}

module.exports = {
  classifyHistoricalAnomaly,
  CRITICAL_SPIKE_RATIO,
  HIGH_SPIKE_RATIO,
  LOW_SPIKE_RATIO,
  CRITICAL_DROP_RATIO,
  HIGH_DROP_RATIO,
  LOW_DROP_RATIO,
  COUNT_SPIKE_RATIO,
  COUNT_DROP_RATIO,
};
