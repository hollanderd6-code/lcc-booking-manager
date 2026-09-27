'use strict';
/**
 * P1.2-B5-BK-M10F-2 — Historical Market Baseline
 *
 * Pure module — no network, no DB, no Channex.
 *
 * Builds a robust price baseline from historical market_data rows for a
 * single property. Uses median-of-medians (not mean) as the primary reference
 * to resist outliers.
 *
 * Fail-closed: returns status='INSUFFICIENT_HISTORY' when fewer than
 * MIN_HISTORY_ROWS rows are available. Callers must check status before use.
 *
 * CRITICAL: NEVER compare rows from different properties (M6 ≠ M7).
 * The caller must pre-filter rows to a single property_id.
 *
 * SAFETY:
 *   DB_WRITES        = 0  always
 *   PRICING_WRITES   = 0  always
 *   CHANNEX_CALLS    = 0  always
 *   NETWORK_CALLS    = 0  pure function
 */

const MIN_HISTORY_ROWS    = 2;   // absolute minimum for any baseline
const MIN_ROBUST_ROWS     = 4;   // minimum for IQR/MAD robust baseline
const HISTORY_WINDOW_ROWS = 8;   // maximum historical rows used (most recent first)

// ── Private helpers ───────────────────────────────────────────────────────────

function _median(sorted) {
  const n = sorted.length;
  if (!n) return null;
  const m = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

function _mad(sorted, median) {
  const deviations = sorted.map(v => Math.abs(v - median)).sort((a, b) => a - b);
  return _median(deviations) ?? 0;
}

// ── buildHistoricalBaseline ───────────────────────────────────────────────────

/**
 * Build a historical price baseline for a property.
 *
 * @param {object}   latestRow       — the market_data row being analysed
 * @param {Array}    historicalRows  — rows strictly BEFORE latestRow (same property_id)
 *                                    caller must ensure they are sorted DESC by scraped_at
 * @returns {HistoricalBaseline}
 */
function buildHistoricalBaseline(latestRow, historicalRows = []) {
  const latestMedian = latestRow ? Number(latestRow.median_price) : null;

  // Guard: need at least MIN_HISTORY_ROWS valid historical medians
  const validRows = (historicalRows || [])
    .slice(0, HISTORY_WINDOW_ROWS)
    .filter(r => r.median_price != null && Number(r.median_price) > 0);

  if (validRows.length < MIN_HISTORY_ROWS) {
    return {
      status:                  'INSUFFICIENT_HISTORY',
      historyCount:            validRows.length,
      historyMedians:          validRows.map(r => Number(r.median_price)),
      historyMedian:           null,
      historyMin:              null,
      historyMax:              null,
      iqrLow:                  null,
      iqrHigh:                 null,
      mad:                     null,
      robustBaseline:          null,
      robustBaselineMethod:    null,
      latestMedian,
      deltaVsHistoryMedianPct: null,
      ratioVsHistoryMedian:    null,
      latestCount:             latestRow?.comparable_count != null ? Number(latestRow.comparable_count) : null,
      historyCountMedian:      null,
    };
  }

  const medians = validRows.map(r => Number(r.median_price));
  const sorted  = [...medians].sort((a, b) => a - b);
  const historyMedian = _median(sorted);
  const historyMin    = sorted[0];
  const historyMax    = sorted[sorted.length - 1];

  // IQR bounds
  const iqrLow  = sorted[Math.floor(sorted.length * 0.25)] ?? historyMin;
  const iqrHigh = sorted[Math.floor(sorted.length * 0.75)] ?? historyMax;

  // MAD for robust spread estimate (only when enough rows)
  const mad = validRows.length >= MIN_ROBUST_ROWS
    ? _mad(sorted, historyMedian)
    : null;

  // Robust baseline: median when ≥ MIN_ROBUST_ROWS, else simple median
  const robustBaseline = historyMedian;
  const robustBaselineMethod = validRows.length >= MIN_ROBUST_ROWS ? 'median_iqr' : 'median';

  // Delta / ratio vs robust baseline
  let deltaVsHistoryMedianPct = null;
  let ratioVsHistoryMedian    = null;
  if (latestMedian != null && latestMedian > 0 && historyMedian > 0) {
    deltaVsHistoryMedianPct = Math.round(
      (latestMedian - historyMedian) / historyMedian * 100 * 100
    ) / 100;
    ratioVsHistoryMedian = Math.round(latestMedian / historyMedian * 1000) / 1000;
  }

  // Comparable count history (for count-spike detection)
  const validCounts = validRows
    .filter(r => r.comparable_count != null && Number(r.comparable_count) > 0)
    .map(r => Number(r.comparable_count));
  const historyCountsSorted = [...validCounts].sort((a, b) => a - b);
  const historyCountMedian  = _median(historyCountsSorted);

  return {
    status:                  'OK',
    historyCount:            validRows.length,
    historyMedians:          medians,
    historyMedian,
    historyMin,
    historyMax,
    iqrLow,
    iqrHigh,
    mad,
    robustBaseline,
    robustBaselineMethod,
    latestMedian,
    deltaVsHistoryMedianPct,
    ratioVsHistoryMedian,
    latestCount:             latestRow?.comparable_count != null ? Number(latestRow.comparable_count) : null,
    historyCountMedian:      historyCountMedian ?? null,
  };
}

module.exports = {
  buildHistoricalBaseline,
  MIN_HISTORY_ROWS,
  MIN_ROBUST_ROWS,
  HISTORY_WINDOW_ROWS,
};
