'use strict';
/**
 * P1.2-B5-BK-J2 — Repeated Snapshot Stability Analysis
 *
 * Pure functions for measuring Airbnb Bright Data repeated-snapshot stability.
 * Used by outils/audit-airbnb-repeated-stability.js.
 *
 * SAFETY:
 *   DB_WRITES        = 0  — no pool, no INSERT/UPDATE
 *   CHANNEX_CALLS    = 0  — no channex import
 *   PRICING_WRITES   = 0  — no pricing-apply import
 *   NETWORK_CALLS    = 0  — pure functions
 *   BOOKING_ROUTING_UNCHANGED
 *
 * DESIGN PRINCIPLES (Phase 15 — do not overvalue ID churn):
 *   Low ID overlap alone MUST NOT produce a VOLATILE verdict.
 *   Pricing-relevant stability is measured by LOCAL PRICE DISTRIBUTION,
 *   not by provider listing rotation.
 *
 *   evaluateRepeatedSampleStability() does NOT accept ID overlap as input.
 *   It uses only: queryFingerprint, geoQuality, selectedMarket.
 *
 * STABILITY POLICY VERDICTS:
 *   STABLE               — all usable, spread ≤ STABILITY_SPREAD_STABLE (10%)
 *   ACCEPTABLE_VARIATION — all/most usable, spread ≤ STABILITY_SPREAD_ACCEPTABLE (20%)
 *   VOLATILE             — usable but spread > 20%, or some geo-unusable
 *   UNUSABLE             — majority of snapshots fail geo quality gate
 *   INCONCLUSIVE         — fingerprints differ, no data, insufficient comparables
 */

const { haversineKm } = require('./brightdata-comparable-filter');

// ── Thresholds ────────────────────────────────────────────────────────────────

const STABILITY_SPREAD_STABLE     = 10;   // % spread ≤ this → STABLE (all geo-usable)
const STABILITY_SPREAD_ACCEPTABLE = 20;   // % spread ≤ this → ACCEPTABLE_VARIATION
const STABILITY_MIN_USABLE_COUNT  = 2;    // minimum snapshots that must be geo-usable (out of 3)

const POLICY_ONE_CALL   = 'ONE_CALL_100_WITH_GEO_GATE';
const POLICY_RETRY      = 'ONE_CALL_100_THEN_RETRY_IF_GEO_FAILS';
const POLICY_MULTI      = 'MULTI_SNAPSHOT_CONSENSUS';
const POLICY_UNRELIABLE = 'AIRBNB_UNRELIABLE_FOR_AUTOMATED_PRICING';

// ── generateQueryFingerprint ──────────────────────────────────────────────────

/**
 * Deterministic fingerprint from all market-relevant request parameters.
 * All three snapshots in a stability run must produce identical fingerprints
 * before results can be interpreted.
 *
 * @param {object} params
 * @returns {string}
 */
function generateQueryFingerprint(params) {
  const {
    provider           = 'brightdata',
    dataset            = 'gd_ld7ll037kqy322v05',
    location           = '',
    currency           = '',
    checkIn            = '',
    checkOut           = '',
    maxListings,
    targetLat          = null,
    targetLon          = null,
    targetGuests       = null,
    targetPropertyType = null,
  } = params || {};

  return [
    provider,
    dataset,
    (location || '').trim().toLowerCase(),
    (currency || '').trim().toUpperCase(),
    checkIn  || '',
    checkOut || '',
    maxListings != null ? String(maxListings) : 'null',
    targetLat  != null ? Number(targetLat).toFixed(6)  : 'null',
    targetLon  != null ? Number(targetLon).toFixed(6)  : 'null',
    targetGuests       != null ? String(targetGuests)       : 'null',
    targetPropertyType != null ? String(targetPropertyType) : 'null',
  ].join('|');
}

// ── computeOverlapMatrix ──────────────────────────────────────────────────────

/**
 * Compute pairwise and triple ID overlap for 3 snapshots.
 *
 * Uses providerListingId ONLY — never geo proximity as identity.
 *
 * @param {string[]} rawIdsA
 * @param {string[]} rawIdsB
 * @param {string[]} rawIdsC
 */
function computeOverlapMatrix(rawIdsA, rawIdsB, rawIdsC) {
  const setA = new Set((rawIdsA || []).filter(id => id != null));
  const setB = new Set((rawIdsB || []).filter(id => id != null));
  const setC = new Set((rawIdsC || []).filter(id => id != null));

  const intersect = (s1, s2) => new Set([...s1].filter(id => s2.has(id)));

  const AB  = intersect(setA, setB);
  const AC  = intersect(setA, setC);
  const BC  = intersect(setB, setC);
  const ABC = intersect(AB, setC);

  const pct = (n, d) => d > 0 ? Math.round(n / d * 10000) / 100 : 0;

  return {
    rawIdsA:  setA.size,
    rawIdsB:  setB.size,
    rawIdsC:  setC.size,
    commonAB:  AB.size,
    commonAC:  AC.size,
    commonBC:  BC.size,
    commonABC: ABC.size,
    // Overlap % uses first set of each pair as reference denominator
    overlapABpct: pct(AB.size,  setA.size),
    overlapACpct: pct(AC.size,  setA.size),
    overlapBCpct: pct(BC.size,  setB.size),
  };
}

// ── computeLocalOverlapMatrix ─────────────────────────────────────────────────

/**
 * Compute per-radius ID overlap for quality-pool listings.
 *
 * Motivation: global ID overlap may be low while the LOCAL market remains
 * stable. This function isolates listings within each radius band so that
 * distant listing churn does not mask local stability.
 *
 * @param {Array}       listingsA  — quality-pool listings from snapshot A
 * @param {Array}       listingsB
 * @param {Array}       listingsC
 * @param {number|null} targetLat
 * @param {number|null} targetLon
 * @param {number[]}    radii       — e.g. [2, 5, 10]
 *
 * @returns {Array<{
 *   radiusKm: number,
 *   aCount: number, bCount: number, cCount: number,
 *   commonAB: number, commonAC: number, commonBC: number, commonABC: number,
 * }>}
 */
function computeLocalOverlapMatrix(listingsA, listingsB, listingsC, targetLat, targetLon, radii) {
  const hasCoords = Number.isFinite(targetLat) && Number.isFinite(targetLon);

  const filterLocal = (listings, r) => {
    if (!hasCoords) return listings;
    return listings.filter(l =>
      Number.isFinite(l.latitude) && Number.isFinite(l.longitude) &&
      haversineKm(targetLat, targetLon, l.latitude, l.longitude) <= r
    );
  };

  return (radii || []).map(r => {
    const lA = filterLocal(listingsA || [], r);
    const lB = filterLocal(listingsB || [], r);
    const lC = filterLocal(listingsC || [], r);

    const setA = new Set(lA.map(l => l.providerListingId).filter(Boolean));
    const setB = new Set(lB.map(l => l.providerListingId).filter(Boolean));
    const setC = new Set(lC.map(l => l.providerListingId).filter(Boolean));

    const AB  = new Set([...setA].filter(id => setB.has(id)));
    const AC  = new Set([...setA].filter(id => setC.has(id)));
    const BC  = new Set([...setB].filter(id => setC.has(id)));
    const ABC = new Set([...AB].filter(id => setC.has(id)));

    return {
      radiusKm: r,
      aCount:    setA.size,
      bCount:    setB.size,
      cCount:    setC.size,
      commonAB:  AB.size,
      commonAC:  AC.size,
      commonBC:  BC.size,
      commonABC: ABC.size,
    };
  });
}

// ── computeLocalPriceStability ────────────────────────────────────────────────

function _calcBasicStats(listings) {
  const prices = listings.map(l => l.price).filter(p => p > 0).sort((a, b) => a - b);
  if (prices.length < 2) return null;
  const n   = prices.length;
  const mid = Math.floor(n / 2);
  return {
    count:  n,
    p25:    prices[Math.floor(n * 0.25)],
    median: n % 2 === 1 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2,
    p75:    prices[Math.floor(n * 0.75)],
  };
}

/**
 * For each radius band, compute per-snapshot price statistics and spread.
 *
 * Uses quality-pool listings (after dedup + category + capacity filters).
 * Geographic filtering is applied fresh per radius for each snapshot.
 *
 * @returns {Array<{
 *   radiusKm: number,
 *   A: {count, p25, median, p75} | null,
 *   B: {count, p25, median, p75} | null,
 *   C: {count, p25, median, p75} | null,
 *   medianMin: number|null,
 *   medianMax: number|null,
 *   medianSpreadAbs: number|null,
 *   medianSpreadPct: number|null,
 * }>}
 */
function computeLocalPriceStability(listingsA, listingsB, listingsC, targetLat, targetLon, radii) {
  const hasCoords = Number.isFinite(targetLat) && Number.isFinite(targetLon);

  const filterLocal = (listings, r) => {
    if (!hasCoords) return listings;
    return listings.filter(l =>
      Number.isFinite(l.latitude) && Number.isFinite(l.longitude) &&
      haversineKm(targetLat, targetLon, l.latitude, l.longitude) <= r
    );
  };

  return (radii || []).map(r => {
    const statsA = _calcBasicStats(filterLocal(listingsA || [], r));
    const statsB = _calcBasicStats(filterLocal(listingsB || [], r));
    const statsC = _calcBasicStats(filterLocal(listingsC || [], r));

    const validMedians = [statsA, statsB, statsC].filter(s => s != null).map(s => s.median);

    let medianMin = null, medianMax = null, medianSpreadAbs = null, medianSpreadPct = null;
    if (validMedians.length >= 2) {
      medianMin = Math.min(...validMedians);
      medianMax = Math.max(...validMedians);
      medianSpreadAbs = Math.round((medianMax - medianMin) * 100) / 100;
      const avg = (medianMax + medianMin) / 2;
      medianSpreadPct = avg > 0 ? Math.round((medianMax - medianMin) / avg * 10000) / 100 : null;
    }

    return { radiusKm: r, A: statsA, B: statsB, C: statsC, medianMin, medianMax, medianSpreadAbs, medianSpreadPct };
  });
}

// ── computeSelectedMarketVolatility ───────────────────────────────────────────

/**
 * Measure price and radius spread across snapshots' production-selected market.
 *
 * Uses each snapshot's own selectComparables result — the real production signal.
 *
 * @param {Array<{ selectedMedian: number|null, selectedRadiusKm: number|null }>} snapshots
 *
 * @returns {{
 *   selectedMedianMin:       number|null,
 *   selectedMedianMax:       number|null,
 *   selectedMedianMean:      number|null,
 *   selectedMedianSpreadAbs: number|null,
 *   selectedMedianSpreadPct: number|null,
 *   selectedRadiusMin:       number|null,
 *   selectedRadiusMax:       number|null,
 * }}
 */
function computeSelectedMarketVolatility(snapshots) {
  const validMedians = (snapshots || [])
    .filter(s => s.selectedMedian != null && Number.isFinite(s.selectedMedian))
    .map(s => s.selectedMedian);
  const validRadii = (snapshots || [])
    .filter(s => s.selectedRadiusKm != null && Number.isFinite(s.selectedRadiusKm))
    .map(s => s.selectedRadiusKm);

  if (validMedians.length < 2) {
    return {
      selectedMedianMin:       validMedians[0] ?? null,
      selectedMedianMax:       validMedians[0] ?? null,
      selectedMedianMean:      validMedians[0] ?? null,
      selectedMedianSpreadAbs: null,
      selectedMedianSpreadPct: null,
      selectedRadiusMin: validRadii[0] ?? null,
      selectedRadiusMax: validRadii[0] ?? null,
    };
  }

  const min  = Math.min(...validMedians);
  const max  = Math.max(...validMedians);
  const mean = validMedians.reduce((s, v) => s + v, 0) / validMedians.length;
  const avg  = (max + min) / 2;

  return {
    selectedMedianMin:       min,
    selectedMedianMax:       max,
    selectedMedianMean:      Math.round(mean * 100) / 100,
    selectedMedianSpreadAbs: Math.round((max - min) * 100) / 100,
    selectedMedianSpreadPct: avg > 0 ? Math.round((max - min) / avg * 10000) / 100 : null,
    selectedRadiusMin:       validRadii.length ? Math.min(...validRadii) : null,
    selectedRadiusMax:       validRadii.length ? Math.max(...validRadii) : null,
  };
}

// ── computeCrossSnapshotLocalDifferenceReason ─────────────────────────────────

/**
 * Classify WHY local comparable counts differ between two snapshots (e.g. A vs B).
 *
 * Used in B5-BK-J diagnostic to explain cross-snapshot local attrition
 * (distinct from per-snapshot PRIMARY_LOCAL_ATTRITION_REASON).
 *
 * Reasons:
 *   SOURCE_SAMPLE_VOLATILITY — two calls return completely different populations
 *                              (low/zero ID overlap, no size-effect explanation)
 *   SAMPLE_SIZE_EFFECT        — bigger limit finds more local listings because
 *                              BD ranks local listings beyond position 50
 *   FILTER_ATTRITION          — cat/cap filters remove local listings
 *   GEO_MISSING               — listings lack geo coordinates
 *   MIXED                     — multiple causes
 *   NONE                      — both snapshots have adequate local coverage
 *   INCONCLUSIVE              — insufficient data to determine
 *
 * @param {object} geoQA     — from evaluateSourceGeoQuality for snapshot A
 * @param {object} geoQB     — from evaluateSourceGeoQuality for snapshot B
 * @param {object} overlap   — from computeSampleOverlap (50 vs 100)
 */
function computeCrossSnapshotLocalDifferenceReason(geoQA, geoQB, overlap) {
  const localA = (geoQA && geoQA.localComparableCount) || 0;
  const localB = (geoQB && geoQB.localComparableCount) || 0;

  if (localA >= 5 && localB >= 5) return 'NONE';

  if (!overlap) return 'INCONCLUSIVE';

  const overlapPct = overlap.overlapPct50 ?? 0;

  // Completely different populations → provider volatile, not just size effect
  if (overlapPct < 10) return 'SOURCE_SAMPLE_VOLATILITY';

  // Good overlap + larger limit found more local → classic size-sensitive pattern
  if (overlapPct >= 50 && localB > localA && overlap.ordering === 'PREFIX_STABLE') {
    return 'SAMPLE_SIZE_EFFECT';
  }

  // Some overlap, larger limit found more local — mixed (size + some volatility)
  if (overlapPct >= 10 && localB > localA) return 'MIXED';

  if (localA === 0 && localB === 0) return 'SOURCE_SAMPLE_VOLATILITY';

  return 'INCONCLUSIVE';
}

// ── evaluateRepeatedSampleStability ──────────────────────────────────────────

/**
 * Determine the stability verdict and production policy from N repeated snapshots.
 *
 * INPUT DOES NOT INCLUDE ID OVERLAP (Phase 15 requirement):
 *   Low ID overlap alone must not produce VOLATILE.
 *   The verdict is based on geo quality + price distribution only.
 *
 * @param {Array<{
 *   queryFingerprint: string,
 *   geoQuality: { usableForConsensus: boolean, status: string, geoCoverageScore: number },
 *   selectedMarket: {
 *     status: string,
 *     selectedRadiusKm: number|null,
 *     stats: { median: number, p25: number, p75: number } | null
 *   } | null,
 * }>} snapshots
 *
 * @returns {{
 *   fingerprintsIdentical: boolean,
 *   fingerprints: string[],
 *   verdict: 'STABLE'|'ACCEPTABLE_VARIATION'|'VOLATILE'|'UNUSABLE'|'INCONCLUSIVE',
 *   verdictReason: string,
 *   geoStatuses: string[],
 *   usableCount: number,
 *   selectedMedians: number[],
 *   selectedRadii: number[],
 *   selectedMedianMin: number|null,
 *   selectedMedianMax: number|null,
 *   selectedMedianMean: number|null,
 *   selectedMedianSpreadAbs: number|null,
 *   selectedMedianSpreadPct: number|null,
 *   selectedRadiusMin: number|null,
 *   selectedRadiusMax: number|null,
 *   policyRecommendation: string,
 *   policyReason: string,
 * }}
 */
function evaluateRepeatedSampleStability(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return {
      fingerprintsIdentical: false,
      fingerprints: [],
      verdict: 'INCONCLUSIVE',
      verdictReason: 'no_snapshots',
      geoStatuses: [],
      usableCount: 0,
      selectedMedians: [],
      selectedRadii: [],
      selectedMedianMin: null, selectedMedianMax: null, selectedMedianMean: null,
      selectedMedianSpreadAbs: null, selectedMedianSpreadPct: null,
      selectedRadiusMin: null, selectedRadiusMax: null,
      policyRecommendation: 'INCONCLUSIVE',
      policyReason: 'no_snapshots',
    };
  }

  // 1. Fingerprint check — all queries must be identical
  const fingerprints = snapshots.map(s => s.queryFingerprint).filter(Boolean);
  const fingerprintsIdentical =
    fingerprints.length === snapshots.length &&
    new Set(fingerprints).size === 1;

  // 2. Geo quality
  const geoStatuses = snapshots.map(s => s.geoQuality?.status || 'UNKNOWN');
  const usableCount = snapshots.filter(s => s.geoQuality?.usableForConsensus === true).length;
  const n = snapshots.length;

  // 3. Price volatility
  const volatility = computeSelectedMarketVolatility(
    snapshots.map(s => ({
      selectedMedian:   s.selectedMarket?.stats?.median   ?? null,
      selectedRadiusKm: s.selectedMarket?.selectedRadiusKm ?? null,
    }))
  );

  const spread         = volatility.selectedMedianSpreadPct;
  const validMedians   = snapshots.filter(s => s.selectedMarket?.stats?.median != null)
                                  .map(s => s.selectedMarket.stats.median);
  const validRadii     = snapshots.filter(s => s.selectedMarket?.selectedRadiusKm != null)
                                  .map(s => s.selectedMarket.selectedRadiusKm);

  let verdict, verdictReason, policyRecommendation, policyReason;

  if (!fingerprintsIdentical) {
    verdict              = 'INCONCLUSIVE';
    verdictReason        = 'fingerprints_differ';
    policyRecommendation = 'INCONCLUSIVE';
    policyReason         = 'Query parameters differ — stability result is invalid';

  } else if (usableCount === 0) {
    verdict              = 'UNUSABLE';
    verdictReason        = 'all_snapshots_geo_unusable';
    policyRecommendation = POLICY_UNRELIABLE;
    policyReason         = 'All snapshots failed the geo quality gate — no reliable local market signal';

  } else if (usableCount < STABILITY_MIN_USABLE_COUNT) {
    verdict              = 'VOLATILE';
    verdictReason        = 'majority_snapshots_geo_unusable';
    policyRecommendation = POLICY_UNRELIABLE;
    policyReason         = 'Majority of snapshots fail geo quality — provider is unreliable for this location';

  } else if (validMedians.length < 2) {
    verdict              = 'INCONCLUSIVE';
    verdictReason        = 'insufficient_comparable_data';
    policyRecommendation = POLICY_ONE_CALL;
    policyReason         = 'Insufficient comparable data to evaluate price stability';

  } else if (usableCount === n && spread != null && spread <= STABILITY_SPREAD_STABLE) {
    verdict              = 'STABLE';
    verdictReason        = 'all_usable_spread_le_10pct';
    policyRecommendation = POLICY_ONE_CALL;
    policyReason         = 'All snapshots geo-usable with price spread ≤10% — one call with geo gate is sufficient';

  } else if (usableCount === n && spread != null && spread <= STABILITY_SPREAD_ACCEPTABLE) {
    verdict              = 'ACCEPTABLE_VARIATION';
    verdictReason        = 'all_usable_spread_le_20pct';
    policyRecommendation = POLICY_ONE_CALL;
    policyReason         = 'All snapshots geo-usable with moderate spread (≤20%) — one call acceptable';

  } else if (usableCount === n && spread != null && spread > STABILITY_SPREAD_ACCEPTABLE) {
    verdict              = 'VOLATILE';
    verdictReason        = 'all_usable_spread_gt_20pct';
    policyRecommendation = POLICY_MULTI;
    policyReason         = 'Price spread > 20% even with good geo — multi-snapshot consensus required';

  } else if (usableCount === n && spread == null) {
    verdict              = 'INCONCLUSIVE';
    verdictReason        = 'no_valid_medians';
    policyRecommendation = POLICY_ONE_CALL;
    policyReason         = 'No valid price medians — cannot evaluate stability';

  } else if (usableCount < n && spread != null && spread <= STABILITY_SPREAD_STABLE) {
    // Mostly usable (≥ STABILITY_MIN_USABLE_COUNT), occasional geo failure, stable prices
    verdict              = 'ACCEPTABLE_VARIATION';
    verdictReason        = 'some_geo_unusable_spread_le_10pct';
    policyRecommendation = POLICY_RETRY;
    policyReason         = 'Occasional geo failure with stable prices — retry on geo-unusable result is sufficient';

  } else if (usableCount < n && spread != null && spread <= STABILITY_SPREAD_ACCEPTABLE) {
    verdict              = 'VOLATILE';
    verdictReason        = 'some_geo_unusable_spread_le_20pct';
    policyRecommendation = POLICY_RETRY;
    policyReason         = 'Geo failures and elevated spread — retry may recover an acceptable signal';

  } else if (usableCount < n && spread != null && spread > STABILITY_SPREAD_ACCEPTABLE) {
    verdict              = 'VOLATILE';
    verdictReason        = 'some_geo_unusable_spread_gt_20pct';
    policyRecommendation = POLICY_UNRELIABLE;
    policyReason         = 'Geo failures and high price spread — provider is unreliable for this location';

  } else {
    // usableCount < n, spread == null
    verdict              = 'VOLATILE';
    verdictReason        = 'some_geo_unusable_spread_unknown';
    policyRecommendation = POLICY_RETRY;
    policyReason         = 'Geo failures with unknown price stability — retry and geo gate required';
  }

  return {
    fingerprintsIdentical,
    fingerprints,
    verdict,
    verdictReason,
    geoStatuses,
    usableCount,
    selectedMedians: validMedians,
    selectedRadii:   validRadii,
    ...volatility,
    policyRecommendation,
    policyReason,
  };
}

module.exports = {
  generateQueryFingerprint,
  computeOverlapMatrix,
  computeLocalOverlapMatrix,
  computeLocalPriceStability,
  computeSelectedMarketVolatility,
  computeCrossSnapshotLocalDifferenceReason,
  evaluateRepeatedSampleStability,
  STABILITY_SPREAD_STABLE,
  STABILITY_SPREAD_ACCEPTABLE,
  STABILITY_MIN_USABLE_COUNT,
  POLICY_ONE_CALL,
  POLICY_RETRY,
  POLICY_MULTI,
  POLICY_UNRELIABLE,
};
