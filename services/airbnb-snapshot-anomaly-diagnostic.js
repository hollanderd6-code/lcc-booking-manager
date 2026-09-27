'use strict';
/**
 * P1.2-B5-BK-M6 — Airbnb Snapshot Anomaly Diagnostic
 *
 * Pure module — no network, no DB, no Channex.
 *
 * Compares a set of Airbnb snapshots to detect price spikes, listing count
 * drops, and empty snapshots that would corrupt the pooled market signal.
 * Results are INFORMATIONAL — they never modify sourceUsage or block collection.
 *
 * Severity levels:
 *   NONE     — no anomalies
 *   LOW      — single minor irregularity
 *   HIGH     — price spike >100% or listing count drop >60%
 *   CRITICAL — empty snapshot or all prices zero
 *
 * SAFETY:
 *   DB_WRITES        = 0  always
 *   PRICING_WRITES   = 0  always
 *   CHANNEX_CALLS    = 0  always
 *   NETWORK_CALLS    = 0  pure function
 */

// ── Thresholds ─────────────────────────────────────────────────────────────────

const PRICE_SPIKE_RATIO         = 2.0;   // snapshot median > 2× global median → HIGH
const PRICE_DROP_RATIO          = 0.5;   // snapshot median < 0.5× global median → HIGH
const COUNT_DROP_RATIO          = 0.4;   // snapshot count < 40% of max count → HIGH
const MINOR_SPIKE_RATIO         = 1.5;   // 1.5×-2× → LOW
const MINOR_DROP_RATIO          = 0.67;  // 0.5×-0.67× → LOW

// ── Private helpers ───────────────────────────────────────────────────────────

function _median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function _snapshotMedianPrice(snapshot) {
  const prices = (snapshot.listings || []).map(l => l.price).filter(p => p > 0);
  return _median(prices);
}

// ── diagnoseSnapshotAnomalies ─────────────────────────────────────────────────

/**
 * Diagnose anomalies across a set of Airbnb snapshots.
 *
 * @param {Array}  snapshots  — [{ snapshotId, listings }]
 * @param {object} [context]  — optional context (unused currently, reserved for geo checks)
 *
 * @returns {{
 *   anomalies: Array<{ snapshotId, type, severity, detail }>,
 *   severity:  'NONE'|'LOW'|'HIGH'|'CRITICAL',
 *   safe:      boolean,
 * }}
 */
function diagnoseSnapshotAnomalies(snapshots = [], context = {}) {
  const anomalies = [];

  if (!snapshots.length) {
    return { anomalies: [], severity: 'NONE', safe: true };
  }

  // Per-snapshot checks
  const medians = [];
  const counts  = [];

  for (const snap of snapshots) {
    const listings = snap.listings || [];
    const priced   = listings.filter(l => l.price > 0);

    // CRITICAL: empty snapshot
    if (listings.length === 0) {
      anomalies.push({
        snapshotId: snap.snapshotId,
        type:       'EMPTY_SNAPSHOT',
        severity:   'CRITICAL',
        detail:     'snapshot has 0 listings',
      });
      continue;
    }

    // CRITICAL: all prices zero or missing
    if (priced.length === 0) {
      anomalies.push({
        snapshotId: snap.snapshotId,
        type:       'ALL_ZERO_PRICES',
        severity:   'CRITICAL',
        detail:     `${listings.length} listings, all price ≤ 0`,
      });
      continue;
    }

    const med = _snapshotMedianPrice(snap);
    if (med !== null) medians.push(med);
    counts.push(priced.length);
  }

  // Cross-snapshot checks (only when we have multiple valid medians)
  // Uses minMedian as the baseline to detect upward spikes.
  // Ratio = snapshot_median / min_snapshot_median:
  //   ≥ PRICE_SPIKE_RATIO (2.0) → HIGH
  //   ≥ MINOR_SPIKE_RATIO (1.5) → LOW
  if (medians.length >= 2) {
    const minMedian = Math.min(...medians);
    const maxCount  = Math.max(...counts);

    // Build a map from snapshotId → median for indexed lookup
    const snapMedians = new Map();
    for (const snap of snapshots) {
      const med = _snapshotMedianPrice(snap);
      if (med !== null) snapMedians.set(snap.snapshotId, med);
    }

    for (const snap of snapshots) {
      const med = snapMedians.get(snap.snapshotId);
      const cnt = (snap.listings || []).filter(l => l.price > 0).length;
      if (med == null) continue;

      // Price spike: how much higher is this snapshot vs the lowest?
      if (minMedian > 0) {
        const ratio = med / minMedian;
        if (ratio >= PRICE_SPIKE_RATIO) {
          anomalies.push({
            snapshotId: snap.snapshotId,
            type:       'PRICE_SPIKE',
            severity:   'HIGH',
            detail:     `median ${med} is ${ratio.toFixed(2)}× min baseline ${minMedian}`,
          });
        } else if (ratio >= MINOR_SPIKE_RATIO) {
          anomalies.push({
            snapshotId: snap.snapshotId,
            type:       'PRICE_SPIKE_MINOR',
            severity:   'LOW',
            detail:     `median ${med} is ${ratio.toFixed(2)}× min baseline ${minMedian}`,
          });
        }
      }

      // Listing count drop
      if (maxCount > 0 && cnt / maxCount < COUNT_DROP_RATIO) {
        anomalies.push({
          snapshotId: snap.snapshotId,
          type:       'COUNT_DROP',
          severity:   'HIGH',
          detail:     `${cnt} priced listings vs max ${maxCount} (${(cnt / maxCount * 100).toFixed(0)}%)`,
        });
      }
    }
  }

  // Aggregate severity
  let severity = 'NONE';
  for (const a of anomalies) {
    if (a.severity === 'CRITICAL') { severity = 'CRITICAL'; break; }
    if (a.severity === 'HIGH')     severity = 'HIGH';
    else if (a.severity === 'LOW' && severity === 'NONE') severity = 'LOW';
  }

  return {
    anomalies,
    severity,
    safe: severity === 'NONE' || severity === 'LOW',
  };
}

module.exports = {
  diagnoseSnapshotAnomalies,
  PRICE_SPIKE_RATIO,
  PRICE_DROP_RATIO,
  COUNT_DROP_RATIO,
};
