'use strict';
/**
 * P1.2-B5-BK-M10F-3 — Stay-Window Compatibility Check
 *
 * Pure module — no network, no DB, no Channex.
 *
 * Determines whether historical market_data rows are comparable to the latest
 * row in terms of the stay window used during scraping. Because market_data
 * has no check_in / check_out / nights columns at the schema level, this module
 * tries to extract window metadata from raw_data JSONB. When that metadata is
 * absent it returns UNKNOWN_WINDOW — callers must factor this uncertainty into
 * any anomaly classification.
 *
 * Return values:
 *   SAME_WINDOW           — all rows used the same stay window (exact match)
 *   COMPATIBLE_WINDOW     — windows differ by ≤ MAX_NIGHTS_DELTA nights (minor)
 *   UNKNOWN_WINDOW        — insufficient metadata to determine comparability
 *   INSUFFICIENT_HISTORY  — fewer than MIN_HISTORY_ROWS rows provided
 *
 * SAFETY:
 *   DB_WRITES        = 0  always
 *   PRICING_WRITES   = 0  always
 *   CHANNEX_CALLS    = 0  always
 *   NETWORK_CALLS    = 0  pure function
 */

const MIN_HISTORY_ROWS = 2;   // must match M10F-2
const MAX_NIGHTS_DELTA = 1;   // ≤ 1-night difference → COMPATIBLE_WINDOW

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Extract stay-window metadata from a market_data row.
 * Tries raw_data.checkIn / checkOut / nights, then raw_data.check_in / check_out.
 * Returns { checkIn, checkOut, nights } or null when no metadata found.
 */
function _extractWindow(row) {
  if (!row) return null;
  const rd = row.raw_data || {};

  const checkIn  = rd.checkIn  || rd.check_in  || null;
  const checkOut = rd.checkOut || rd.check_out || null;
  const nights   = rd.nights   != null ? Number(rd.nights) : null;

  if (!checkIn && !checkOut && nights == null) return null;

  // Derive nights from dates when not explicit
  let resolvedNights = nights;
  if (resolvedNights == null && checkIn && checkOut) {
    const msIn  = new Date(checkIn).getTime();
    const msOut = new Date(checkOut).getTime();
    if (!isNaN(msIn) && !isNaN(msOut) && msOut > msIn) {
      resolvedNights = Math.round((msOut - msIn) / 86_400_000);
    }
  }

  return { checkIn, checkOut, nights: resolvedNights };
}

// ── checkStayWindowCompatibility ─────────────────────────────────────────────

/**
 * Check whether historical rows are comparable to the latest row by stay window.
 *
 * @param {object}  latestRow       — the market_data row being analysed
 * @param {Array}   historicalRows  — rows strictly BEFORE latestRow (same property_id)
 * @returns {{ status: string, details: object }}
 */
function checkStayWindowCompatibility(latestRow, historicalRows = []) {
  const validHistorical = (historicalRows || []).filter(r => r != null);

  if (validHistorical.length < MIN_HISTORY_ROWS) {
    return {
      status:  'INSUFFICIENT_HISTORY',
      details: {
        historyCount:   validHistorical.length,
        latestWindow:   _extractWindow(latestRow),
        historyWindows: [],
        reason:         `fewer than ${MIN_HISTORY_ROWS} historical rows`,
      },
    };
  }

  const latestWindow   = _extractWindow(latestRow);
  const historyWindows = validHistorical.map(_extractWindow);

  // If any metadata is missing we cannot determine comparability
  if (!latestWindow) {
    return {
      status:  'UNKNOWN_WINDOW',
      details: {
        historyCount:   validHistorical.length,
        latestWindow:   null,
        historyWindows,
        reason:         'latest row has no stay-window metadata in raw_data',
      },
    };
  }

  const withWindow    = historyWindows.filter(w => w !== null);
  const withoutWindow = historyWindows.filter(w => w === null).length;

  if (withoutWindow > 0 || withWindow.length < MIN_HISTORY_ROWS) {
    return {
      status:  'UNKNOWN_WINDOW',
      details: {
        historyCount:       validHistorical.length,
        latestWindow,
        historyWindows,
        missingWindowCount: withoutWindow,
        reason:             `${withoutWindow} historical row(s) have no stay-window metadata`,
      },
    };
  }

  // All rows have metadata — compare nights
  const latestNights = latestWindow.nights;
  if (latestNights == null) {
    return {
      status:  'UNKNOWN_WINDOW',
      details: {
        historyCount: validHistorical.length,
        latestWindow,
        historyWindows,
        reason:       'cannot derive nights from latest row window metadata',
      },
    };
  }

  const nightDeltas = withWindow.map(w => {
    if (w.nights == null) return null;
    return Math.abs(w.nights - latestNights);
  });

  const hasNullDelta = nightDeltas.some(d => d === null);
  if (hasNullDelta) {
    return {
      status:  'UNKNOWN_WINDOW',
      details: {
        historyCount: validHistorical.length,
        latestWindow,
        historyWindows,
        nightDeltas,
        reason:       'some historical windows have no nights field',
      },
    };
  }

  const maxDelta = Math.max(...nightDeltas);

  if (maxDelta === 0) {
    return {
      status:  'SAME_WINDOW',
      details: {
        historyCount:  validHistorical.length,
        latestWindow,
        historyWindows,
        nightDeltas,
        maxDelta,
        latestNights,
      },
    };
  }

  if (maxDelta <= MAX_NIGHTS_DELTA) {
    return {
      status:  'COMPATIBLE_WINDOW',
      details: {
        historyCount:  validHistorical.length,
        latestWindow,
        historyWindows,
        nightDeltas,
        maxDelta,
        latestNights,
      },
    };
  }

  return {
    status:  'UNKNOWN_WINDOW',
    details: {
      historyCount:  validHistorical.length,
      latestWindow,
      historyWindows,
      nightDeltas,
      maxDelta,
      latestNights,
      reason:        `max night delta (${maxDelta}) exceeds MAX_NIGHTS_DELTA (${MAX_NIGHTS_DELTA})`,
    },
  };
}

module.exports = {
  checkStayWindowCompatibility,
  MIN_HISTORY_ROWS,
  MAX_NIGHTS_DELTA,
};
