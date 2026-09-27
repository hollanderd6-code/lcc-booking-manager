'use strict';
/**
 * P1.2-B5-BK-J5 — Airbnb Pooled Snapshot Reliability Gate
 *
 * Given the output of buildAirbnbPooledMarket, classifies whether the pooled
 * market signal is reliable enough to be trusted, by examining each pair/trio
 * subset (AB/AC/BC) at the SAME radius as ABC — without inflating any subset's
 * own radius.
 *
 * Key insight: a subset with too few comparables at the ABC radius is simply
 * excluded from the deviation analysis; it cannot invalidate a market that
 * has enough reliable pair evidence.
 *
 * SAFETY:
 *   DB_WRITES              = 0  always
 *   PRICING_WRITES         = 0  always
 *   CHANNEX_CALLS          = 0  always
 *   MARKET_PROVIDER_UNCHANGED
 *   PRODUCTION_DISABLED
 */

const { MIN_COMPARABLES_FALLBACK } = require('./airbnb-pooled-snapshot-market');

// ── Gate thresholds ───────────────────────────────────────────────────────────

const MIN_ABC_COMPARABLES        = 8;   // ABC pool needs ≥ 8 local comparables
const MAX_ABC_RADIUS_KM          = 5;   // ABC selected radius must be ≤ 5 km
const MIN_RELIABLE_SUBSETS       = 2;   // need ≥ 2 reliable subsets to evaluate deviation
const MAX_RELIABLE_DEVIATION_PCT = 15;  // reliable subset medians must be ≤ 15% from ABC
const MAX_IQR_PCT                = 30;  // (P75-P25)/median ≤ 30% signals a tight market
const MAX_REPEATED_VARIATION_PCT = 20;  // repeated listing price variation ≤ 20%
const MIN_USABLE_SNAPSHOTS       = 2;   // ≥ 2 source snapshots with non-UNUSABLE geo quality

// A snapshot is "usable" for snapshot-count purposes if its geo quality is not UNUSABLE.
const USABLE_GEO_STATUSES = new Set(['GOOD', 'DEGRADED', 'POOR']);

// Snapshot indices (A=0, B=1, C=2) within perSnapshotQuality for each subset key.
const SUBSET_INDICES  = { AB: [0, 1], AC: [0, 2], BC: [1, 2] };
const SNAPSHOT_LABELS = ['A', 'B', 'C'];

// ── calcIqrPct ────────────────────────────────────────────────────────────────

function calcIqrPct(pooledStats) {
  if (!pooledStats) return null;
  const { p25, p75, median } = pooledStats;
  if (p25 == null || p75 == null || median == null || median === 0) return null;
  return (p75 - p25) / median * 100;
}

// ── evaluateSubsetReliability ─────────────────────────────────────────────────

/**
 * Determine whether a subset (AB/AC/BC) is reliable for deviation analysis.
 *
 * A subset is reliable iff:
 *   1. countAtAbcRadius >= MIN_COMPARABLES_FALLBACK (same radius as ABC — never inflated)
 *   2. at least one snapshot in the subset is not UNUSABLE
 *
 * deviationFromABC is only populated for reliable subsets with a valid ABC median.
 *
 * @param {'AB'|'AC'|'BC'} subsetKey
 * @param {object}  sensitivity        — sensitivity map from buildAirbnbPooledMarket
 * @param {Array}   perSnapshotQuality — perSnapshotQuality array from buildAirbnbPooledMarket
 * @param {number|null} abcMedian
 */
function evaluateSubsetReliability(subsetKey, sensitivity, perSnapshotQuality, abcMedian) {
  const indices = SUBSET_INDICES[subsetKey];
  if (!indices) return null;

  const subsetData       = sensitivity?.[subsetKey] ?? {};
  const countAtAbcRadius = subsetData.countAtRadius ?? 0;
  const median           = subsetData.median        ?? null;

  // Map each snapshot in the subset to its geo status
  const geoStatuses = {};
  let eligibleSnapshotCount = 0;
  for (const idx of indices) {
    const label  = SNAPSHOT_LABELS[idx];
    const status = perSnapshotQuality?.[idx]?.geoQuality?.status ?? 'UNUSABLE';
    geoStatuses[label] = status;
    if (USABLE_GEO_STATUSES.has(status)) eligibleSnapshotCount++;
  }

  let subsetReliable    = false;
  let reliabilityReason = 'ok';

  if (countAtAbcRadius < MIN_COMPARABLES_FALLBACK) {
    reliabilityReason = `insufficient_count_at_radius (${countAtAbcRadius}<${MIN_COMPARABLES_FALLBACK})`;
  } else if (eligibleSnapshotCount === 0) {
    reliabilityReason = 'all_snapshots_unusable';
  } else {
    subsetReliable = true;
  }

  // Deviation is meaningful only for reliable subsets with a valid ABC reference
  let deviationFromABC = null;
  if (subsetReliable && abcMedian != null && abcMedian !== 0 && median != null) {
    deviationFromABC = Math.abs(median - abcMedian) / abcMedian * 100;
  }

  return {
    subsetReliable,
    reliabilityReason,
    countAtAbcRadius,
    geoStatuses,
    eligibleSnapshotCount,
    median,
    deviationFromABC,
  };
}

// ── computePooledReliabilityGate ──────────────────────────────────────────────

/**
 * Apply the reliability gate to a pooledResult from buildAirbnbPooledMarket.
 *
 * POOLED_RELIABILITY_STATUS values:
 *   STABLE_LOCAL_POOL              — all rules pass, pool is trustworthy
 *   UNSTABLE_OR_INSUFFICIENT       — one or more stability rules fail
 *   INSUFFICIENT_RELIABILITY_EVIDENCE — fewer than MIN_RELIABLE_SUBSETS reliable subsets
 *   POOL_UNAVAILABLE               — pooledResult.status !== 'ok'
 *
 * @param {object} pooledResult — return value of buildAirbnbPooledMarket
 */
function computePooledReliabilityGate(pooledResult) {
  if (!pooledResult || pooledResult.status !== 'ok') {
    return {
      POOLED_RELIABILITY_STATUS:            'POOL_UNAVAILABLE',
      POOLED_RELIABILITY_REASONS:           [pooledResult?.reason ?? 'pool_not_ok'],
      RELIABLE_SUBSET_COUNT:                0,
      RELIABLE_MAX_DEVIATION_PCT:           null,
      UNRELIABLE_SUBSETS:                   [],
      ABC_LOCAL_COUNT:                      pooledResult?.comparableCount ?? 0,
      ABC_SELECTED_RADIUS:                  pooledResult?.selectedRadiusKm ?? null,
      ABC_IQR_PCT:                          null,
      REPEATED_LISTING_PRICE_MAX_VARIATION: null,
      subsets:                              {},
      usableSnapshotCount:                  0,
      reliableSubsets:                      [],
    };
  }

  const perSnapshotQuality = pooledResult.perSnapshotQuality || [];
  const sensitivity        = pooledResult.sensitivity        || {};
  const abcMedian          = pooledResult.pooledStats?.median    ?? null;
  const abcLocalCount      = pooledResult.comparableCount        ?? 0;
  const abcSelectedRadius  = pooledResult.selectedRadiusKm       ?? null;
  const iqrPct             = calcIqrPct(pooledResult.pooledStats);
  const repeatedMax        = pooledResult.priceVariation?.max     ?? 0;

  const usableSnapshotCount = perSnapshotQuality.filter(
    q => USABLE_GEO_STATUSES.has(q?.geoQuality?.status)
  ).length;

  // Subsets: AB always present; AC + BC only when 3 snapshots ran
  const has3       = 'ABC' in sensitivity;
  const subsetKeys = has3 ? ['AB', 'AC', 'BC'] : ['AB'];

  const subsets           = {};
  const reliableSubsets   = [];
  const unreliableSubsets = [];

  for (const key of subsetKeys) {
    const ev = evaluateSubsetReliability(key, sensitivity, perSnapshotQuality, abcMedian);
    subsets[key] = ev;
    if (ev?.subsetReliable) reliableSubsets.push(key);
    else unreliableSubsets.push(key);
  }

  const reliableSubsetCount = reliableSubsets.length;

  // Fail-closed: need ≥ MIN_RELIABLE_SUBSETS before checking other stability rules.
  // With only 2 snapshots (1 subset max), this always fires → INSUFFICIENT.
  if (reliableSubsetCount < MIN_RELIABLE_SUBSETS) {
    return {
      POOLED_RELIABILITY_STATUS:  'INSUFFICIENT_RELIABILITY_EVIDENCE',
      POOLED_RELIABILITY_REASONS: [
        `reliable_subset_count (${reliableSubsetCount}) < ${MIN_RELIABLE_SUBSETS}`,
      ],
      RELIABLE_SUBSET_COUNT:                reliableSubsetCount,
      RELIABLE_MAX_DEVIATION_PCT:           null,
      UNRELIABLE_SUBSETS:                   unreliableSubsets,
      ABC_LOCAL_COUNT:                      abcLocalCount,
      ABC_SELECTED_RADIUS:                  abcSelectedRadius,
      ABC_IQR_PCT:                          iqrPct,
      REPEATED_LISTING_PRICE_MAX_VARIATION: repeatedMax,
      subsets,
      usableSnapshotCount,
      reliableSubsets,
    };
  }

  // Max deviation among RELIABLE subsets only — unreliable subsets excluded.
  const devs = reliableSubsets
    .map(k => subsets[k].deviationFromABC)
    .filter(d => d != null);
  const reliableMaxDeviationPct = devs.length > 0 ? Math.max(...devs) : 0;

  // Check stability rules in order
  const reasons = [];

  if (abcLocalCount < MIN_ABC_COMPARABLES)
    reasons.push(`abc_count_below_${MIN_ABC_COMPARABLES} (${abcLocalCount})`);

  if (abcSelectedRadius != null && abcSelectedRadius > MAX_ABC_RADIUS_KM)
    reasons.push(`radius_exceeds_${MAX_ABC_RADIUS_KM}km (${abcSelectedRadius})`);

  if (reliableMaxDeviationPct > MAX_RELIABLE_DEVIATION_PCT)
    reasons.push(`reliable_deviation_exceeds_${MAX_RELIABLE_DEVIATION_PCT}pct (${reliableMaxDeviationPct.toFixed(2)}%)`);

  if (repeatedMax > MAX_REPEATED_VARIATION_PCT)
    reasons.push(`repeated_variation_exceeds_${MAX_REPEATED_VARIATION_PCT}pct (${repeatedMax.toFixed(2)}%)`);

  if (iqrPct != null && iqrPct > MAX_IQR_PCT)
    reasons.push(`iqr_exceeds_${MAX_IQR_PCT}pct (${iqrPct.toFixed(2)}%)`);

  if (usableSnapshotCount < MIN_USABLE_SNAPSHOTS)
    reasons.push(`usable_snapshots_below_${MIN_USABLE_SNAPSHOTS} (${usableSnapshotCount})`);

  const status = reasons.length === 0 ? 'STABLE_LOCAL_POOL' : 'UNSTABLE_OR_INSUFFICIENT';

  return {
    POOLED_RELIABILITY_STATUS:            status,
    POOLED_RELIABILITY_REASONS:           reasons,
    RELIABLE_SUBSET_COUNT:                reliableSubsetCount,
    RELIABLE_MAX_DEVIATION_PCT:           reliableMaxDeviationPct,
    UNRELIABLE_SUBSETS:                   unreliableSubsets,
    ABC_LOCAL_COUNT:                      abcLocalCount,
    ABC_SELECTED_RADIUS:                  abcSelectedRadius,
    ABC_IQR_PCT:                          iqrPct,
    REPEATED_LISTING_PRICE_MAX_VARIATION: repeatedMax,
    subsets,
    usableSnapshotCount,
    reliableSubsets,
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  computePooledReliabilityGate,
  evaluateSubsetReliability,
  calcIqrPct,
  USABLE_GEO_STATUSES,
  SUBSET_INDICES,
  SNAPSHOT_LABELS,
  MIN_ABC_COMPARABLES,
  MAX_ABC_RADIUS_KM,
  MIN_RELIABLE_SUBSETS,
  MAX_RELIABLE_DEVIATION_PCT,
  MAX_IQR_PCT,
  MAX_REPEATED_VARIATION_PCT,
  MIN_USABLE_SNAPSHOTS,
};
