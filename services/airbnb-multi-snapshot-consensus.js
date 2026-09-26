'use strict';
/**
 * P1.2-B5-BK-J3 — Airbnb Multi-Snapshot Consensus
 *
 * Pure module: transforms multiple Bright Data Airbnb snapshots of the same
 * location/dates into a single consolidated market signal by finding a common
 * geographic radius, computing a weighted median, and classifying confidence.
 *
 * SAFETY:
 *   DB_WRITES        = 0  — no pool, no INSERT/UPDATE
 *   CHANNEX_CALLS    = 0  — no channex import
 *   PRICING_WRITES   = 0  — no pricing-apply import
 *   NETWORK_CALLS    = 0  — pure functions, no fetch
 *
 * DESIGN INVARIANTS (from B5-BK-J live evidence):
 *   1. Bright Data returns listings in internal order, not by distance.
 *      limit_per_input is a hard cap. Local comparables may appear beyond rank 50.
 *   2. Snapshots of the same query can return completely different listing populations
 *      (IDS_COMMON_ABC=0 observed for Massy). Consensus must NOT rely on ID overlap.
 *   3. A "weak" snapshot (1 comparable at 5km) must NOT force radius expansion —
 *      common radius requires ≥ 2 independently eligible snapshots.
 *   4. J3 eligibility: GOOD or DEGRADED only. POOR and UNUSABLE excluded.
 *      Within eligible: POOR → weight=0 (excluded from consensus arithmetic).
 *   5. Weighted median (not arithmetic mean) prevents an outlier snapshot from
 *      dragging the consensus disproportionately.
 *
 * SNAPSHOT INPUT FORMAT:
 *   {
 *     snapshotId:  string,
 *     listings:    NormalizedListing[],   // quality pool (dedup+category+capacity applied)
 *     geoQuality:  {                      // from evaluateSourceGeoQuality(qualityPool, lat, lon)
 *       status:             'GOOD'|'DEGRADED'|'POOR'|'UNUSABLE',
 *       geoCoverageScore:   number,
 *       usableForConsensus: boolean,
 *       ...
 *     }
 *   }
 *
 * The caller (validator or pricing layer) is responsible for building the quality
 * pool and evaluating geo quality before passing snapshots to this module.
 */

const { haversineKm, calcBrightDataMarketStats } = require('./brightdata-comparable-filter');
const { countScore }                              = require('./market-multi-source-aggregator');

// ── Constants ─────────────────────────────────────────────────────────────────

const RADIUS_BANDS_KM        = [1, 2, 3, 5, 10, 20];
const MIN_COMPARABLES_FALLBACK = 5;
const MIN_ELIGIBLE_FOR_COMMON  = 2;  // min snapshots with ≥ FALLBACK within radius

// Spread thresholds (symmetric % between min and max of contributing medians)
const SPREAD_VERY_STABLE = 10;
const SPREAD_STABLE      = 20;
const SPREAD_MODERATE    = 35;
// > SPREAD_MODERATE → VOLATILE

// Outlier thresholds (% deviation from robust center)
const OUTLIER_WARNING_PCT   = 20;
const OUTLIER_CANDIDATE_PCT = 35;

// Early stop: criteria for "2 snapshots are sufficient" verdict
const EARLY_STOP_MAX_SPREAD_PCT  = 15;
const EARLY_STOP_MIN_WITHIN_5KM  = 5;

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * J3 eligibility: GOOD or DEGRADED only.
 * POOR and UNUSABLE are excluded from consensus arithmetic.
 */
function isSnapshotJ3Eligible(snapshot) {
  const s = snapshot?.geoQuality?.status;
  return s === 'GOOD' || s === 'DEGRADED';
}

/**
 * Filter listings to those within `radiusKm` of target.
 * If target coords are absent or listing has no coords, the listing is excluded.
 */
function getListingsWithinRadius(listings, targetLat, targetLon, radiusKm) {
  if (!Number.isFinite(targetLat) || !Number.isFinite(targetLon)) return [];
  return (listings || []).filter(l =>
    Number.isFinite(l.latitude) && Number.isFinite(l.longitude) &&
    haversineKm(targetLat, targetLon, l.latitude, l.longitude) <= radiusKm
  );
}

function countListingsWithinRadius(listings, targetLat, targetLon, radiusKm) {
  return getListingsWithinRadius(listings, targetLat, targetLon, radiusKm).length;
}

// ── findCommonSnapshotRadius ──────────────────────────────────────────────────

/**
 * Find the smallest radius where at least `minEligible` (default 2) snapshots
 * each have ≥ `minComparables` (default 5) listings within that radius.
 *
 * Only GOOD and DEGRADED snapshots are considered eligible.
 * A weak snapshot (e.g. 1 comparable at 5km) must NOT force radius expansion.
 *
 * @param {Array}  snapshots      — array of snapshot objects (see module docblock)
 * @param {number} targetLat
 * @param {number} targetLon
 * @param {object} [opts]
 * @param {number} [opts.minComparables=5]   — min listings per snapshot
 * @param {number} [opts.minEligible=2]      — min snapshots required
 *
 * @returns {{
 *   commonRadiusKm:  number|null,
 *   reason:          string,
 *   eligiblePerRadius: object,   — { [radiusKm]: eligibleCount }
 *   countPerSnapshot:  object,   — { [snapshotIndex]: { [radiusKm]: count } }
 * }}
 */
function findCommonSnapshotRadius(snapshots, targetLat, targetLon, opts = {}) {
  const { minComparables = MIN_COMPARABLES_FALLBACK, minEligible = MIN_ELIGIBLE_FOR_COMMON } = opts;

  const eligiblePerRadius  = {};
  const countPerSnapshot   = {};

  if (!Number.isFinite(targetLat) || !Number.isFinite(targetLon)) {
    return { commonRadiusKm: null, reason: 'no_target_coords', eligiblePerRadius, countPerSnapshot };
  }

  if (!Array.isArray(snapshots) || snapshots.length < minEligible) {
    return { commonRadiusKm: null, reason: 'too_few_snapshots', eligiblePerRadius, countPerSnapshot };
  }

  const j3Eligible = snapshots.filter(s => isSnapshotJ3Eligible(s));
  if (j3Eligible.length < minEligible) {
    return { commonRadiusKm: null, reason: 'insufficient_eligible_snapshots', eligiblePerRadius, countPerSnapshot };
  }

  // Pre-compute per-snapshot counts at each radius
  j3Eligible.forEach((s, idx) => {
    countPerSnapshot[idx] = {};
    for (const r of RADIUS_BANDS_KM) {
      countPerSnapshot[idx][r] = countListingsWithinRadius(s.listings, targetLat, targetLon, r);
    }
  });

  for (const r of RADIUS_BANDS_KM) {
    const eligible = j3Eligible.filter((_, idx) => (countPerSnapshot[idx][r] ?? 0) >= minComparables);
    eligiblePerRadius[r] = eligible.length;
    if (eligible.length >= minEligible) {
      return { commonRadiusKm: r, reason: 'found', eligiblePerRadius, countPerSnapshot };
    }
  }

  return { commonRadiusKm: null, reason: 'no_common_radius', eligiblePerRadius, countPerSnapshot };
}

// ── calculateSnapshotConsensusWeight ─────────────────────────────────────────

/**
 * Compute the consensus weight for a single snapshot at the common radius.
 *
 * Weight = geoScore × countScore(countAtRadius).
 *   POOR or UNUSABLE → 0 (excluded from primary consensus).
 *   Count < MIN_COMPARABLES_FALLBACK at common radius → countScore = 0 → weight = 0.
 *
 * @param {object} snapshot     — snapshot object with geoQuality
 * @param {number} commonRadiusKm
 * @param {number} targetLat
 * @param {number} targetLon
 * @returns {number}  — weight in [0, 1]
 */
function calculateSnapshotConsensusWeight(snapshot, commonRadiusKm, targetLat, targetLon) {
  const status = snapshot?.geoQuality?.status;
  if (status === 'POOR' || status === 'UNUSABLE' || !isSnapshotJ3Eligible(snapshot)) return 0;

  const geoScore       = snapshot.geoQuality?.geoCoverageScore ?? 0;
  const countAtRadius  = countListingsWithinRadius(snapshot.listings, targetLat, targetLon, commonRadiusKm);
  const cScore         = countScore(countAtRadius);

  return geoScore * cScore;
}

// ── weightedMedian ────────────────────────────────────────────────────────────

/**
 * True weighted median.
 *
 * Algorithm:
 *   1. Sort (value, weight) pairs ascending by value.
 *   2. Walk from smallest, accumulating weight.
 *   3. Return the value at which cumulative weight first reaches totalWeight / 2.
 *
 * Pairs with weight ≤ 0 or non-finite value are ignored.
 *
 * @param {number[]} values
 * @param {number[]} weights
 * @returns {number|null}
 */
function weightedMedian(values, weights) {
  if (!Array.isArray(values) || !values.length) return null;

  const pairs = values
    .map((v, i) => ({ v, w: weights?.[i] ?? 0 }))
    .filter(p => Number.isFinite(p.v) && p.v > 0 && Number.isFinite(p.w) && p.w > 0)
    .sort((a, b) => a.v - b.v);

  if (!pairs.length) return null;
  if (pairs.length === 1) return pairs[0].v;

  const total  = pairs.reduce((s, p) => s + p.w, 0);
  const target = total / 2;
  let cumul    = 0;

  for (const { v, w } of pairs) {
    cumul += w;
    if (cumul >= target) return v;
  }
  return pairs[pairs.length - 1].v;
}

// ── calculateSnapshotSpread ───────────────────────────────────────────────────

/**
 * Measure the spread across a set of per-snapshot medians.
 *
 * Spread % = |max - min| / ((max + min) / 2) × 100  (symmetric divergence)
 *
 * @param {number[]} medians  — array of median values (one per snapshot)
 * @returns {{
 *   spreadAbs:      number|null,
 *   spreadPct:      number|null,
 *   stabilityLevel: 'VERY_STABLE'|'STABLE'|'MODERATE'|'VOLATILE'|'INCONCLUSIVE',
 *   min:            number|null,
 *   max:            number|null,
 * }}
 */
function calculateSnapshotSpread(medians) {
  const valid = (medians || []).filter(m => Number.isFinite(m) && m > 0);

  if (valid.length < 2) {
    return { spreadAbs: null, spreadPct: null, stabilityLevel: 'INCONCLUSIVE', min: valid[0] ?? null, max: valid[0] ?? null };
  }

  const min       = Math.min(...valid);
  const max       = Math.max(...valid);
  const spreadAbs = max - min;
  const spreadPct = spreadAbs / ((max + min) / 2) * 100;

  const stabilityLevel = spreadPct <= SPREAD_VERY_STABLE ? 'VERY_STABLE'
                       : spreadPct <= SPREAD_STABLE      ? 'STABLE'
                       : spreadPct <= SPREAD_MODERATE    ? 'MODERATE'
                       : 'VOLATILE';

  return { spreadAbs, spreadPct, stabilityLevel, min, max };
}

// ── detectSnapshotOutliers ────────────────────────────────────────────────────

/**
 * Detect outlier snapshots by measuring deviation from a robust center.
 *
 * Robust center = median of the provided medians (mean of two middle for even N).
 * Deviation % = |value - center| / center × 100.
 *
 * outlierStatus:
 *   NORMAL            — deviation ≤ OUTLIER_WARNING_PCT
 *   OUTLIER_WARNING   — deviation > OUTLIER_WARNING_PCT and ≤ OUTLIER_CANDIDATE_PCT
 *   OUTLIER_CANDIDATE — deviation > OUTLIER_CANDIDATE_PCT
 *   INCONCLUSIVE      — no valid median for this snapshot
 *
 * @param {Array<{ snapshotIndex: number, snapshotId: string, median: number|null }>} snapshotMedians
 * @returns {Array<{ snapshotIndex, snapshotId, median, deviationPct, center, outlierStatus }>}
 */
function detectSnapshotOutliers(snapshotMedians) {
  if (!Array.isArray(snapshotMedians)) return [];

  const valid   = snapshotMedians.filter(s => Number.isFinite(s.median) && s.median > 0);
  const sorted  = [...valid].sort((a, b) => a.median - b.median);
  const n       = sorted.length;

  let center = null;
  if (n === 1) {
    center = sorted[0].median;
  } else if (n >= 2) {
    const mid = Math.floor(n / 2);
    center = n % 2 === 1 ? sorted[mid].median : (sorted[mid - 1].median + sorted[mid].median) / 2;
  }

  return snapshotMedians.map(s => {
    if (!Number.isFinite(s.median) || s.median <= 0 || center === null) {
      return { ...s, deviationPct: null, center, outlierStatus: 'INCONCLUSIVE' };
    }
    const deviationPct  = Math.abs(s.median - center) / center * 100;
    const outlierStatus = deviationPct > OUTLIER_CANDIDATE_PCT ? 'OUTLIER_CANDIDATE'
                        : deviationPct > OUTLIER_WARNING_PCT   ? 'OUTLIER_WARNING'
                        : 'NORMAL';
    return { ...s, deviationPct, center, outlierStatus };
  });
}

// ── classifySnapshotConsensusConfidence ───────────────────────────────────────

/**
 * Classify the confidence level of the consensus result.
 *
 * HIGH requires:
 *   - contributingCount ≥ 2
 *   - no DEGRADED snapshot among contributors
 *   - commonRadiusKm ≤ 5
 *   - spread is VERY_STABLE (≤ 10%)
 *   - no OUTLIER_WARNING or OUTLIER_CANDIDATE among contributing snapshots
 *
 * UNUSABLE: contributingCount < 2
 * LOW:      spread VOLATILE or OUTLIER_CANDIDATE detected
 * MEDIUM:   everything else
 *
 * @param {object} inputs
 * @param {Array}  inputs.snapshots          — original snapshot array (for status check)
 * @param {number} inputs.commonRadiusKm
 * @param {number} inputs.contributingCount
 * @param {object} inputs.spread             — from calculateSnapshotSpread
 * @param {Array}  inputs.outliers           — from detectSnapshotOutliers
 * @param {number[]} inputs.contributingIndices — indices in snapshots[] that contribute
 * @returns {{ confidence: string, reasons: string[] }}
 */
function classifySnapshotConsensusConfidence({
  snapshots,
  commonRadiusKm,
  contributingCount,
  spread,
  outliers,
  contributingIndices = [],
}) {
  if (!contributingCount || contributingCount < 2) {
    return { confidence: 'UNUSABLE', reasons: ['insufficient_contributors'] };
  }

  const reasons = [];

  const hasDegraded = contributingIndices.some(i => snapshots[i]?.geoQuality?.status === 'DEGRADED');
  const radiusWide  = Number.isFinite(commonRadiusKm) && commonRadiusKm > 5;
  const hasOutlierCandidate = (outliers || []).some(o => o.outlierStatus === 'OUTLIER_CANDIDATE');
  const hasOutlierWarning   = (outliers || []).some(o => o.outlierStatus === 'OUTLIER_WARNING');

  if (hasDegraded)         reasons.push('degraded_snapshot_contributes');
  if (radiusWide)          reasons.push(`wide_radius_${commonRadiusKm}km`);
  if (hasOutlierCandidate) reasons.push('outlier_candidate');
  else if (hasOutlierWarning) reasons.push('outlier_warning');

  const sl = spread?.stabilityLevel;

  if (sl === 'VOLATILE' || sl === 'INCONCLUSIVE') {
    return { confidence: 'LOW', reasons: [...reasons, `spread_${sl?.toLowerCase()}`] };
  }
  if (hasOutlierCandidate) {
    return { confidence: 'LOW', reasons };
  }

  // HIGH: strict criteria
  if (!hasDegraded && !radiusWide && !hasOutlierWarning && sl === 'VERY_STABLE') {
    return { confidence: 'HIGH', reasons };
  }

  return { confidence: 'MEDIUM', reasons };
}

// ── shouldRequestThirdSnapshot ────────────────────────────────────────────────

/**
 * Determine whether a third snapshot is needed given the first two.
 *
 * Returns { shouldRequest: false } only when:
 *   - Both snapshots have geoQuality.status === 'GOOD'
 *   - Both have ≥ EARLY_STOP_MIN_WITHIN_5KM (5) listings within 5 km
 *   - Their spread at 5 km is ≤ EARLY_STOP_MAX_SPREAD_PCT (15%)
 *
 * Otherwise returns { shouldRequest: true } with a reason.
 *
 * @param {object} snapshotA    — snapshot object (see module docblock)
 * @param {object} snapshotB
 * @param {object} opts
 * @param {number} opts.targetLat
 * @param {number} opts.targetLon
 * @param {string} [opts.today]   — for calcBrightDataMarketStats
 * @returns {{ shouldRequest: boolean, reason: string, spreadPct?: number }}
 */
function shouldRequestThirdSnapshot(snapshotA, snapshotB, opts = {}) {
  const { targetLat, targetLon, today } = opts;

  if (!Number.isFinite(targetLat) || !Number.isFinite(targetLon)) {
    return { shouldRequest: true, reason: 'no_target_coords' };
  }

  // Both must be GOOD
  if (snapshotA?.geoQuality?.status !== 'GOOD') {
    return { shouldRequest: true, reason: 'snapshot_a_not_good', statusA: snapshotA?.geoQuality?.status };
  }
  if (snapshotB?.geoQuality?.status !== 'GOOD') {
    return { shouldRequest: true, reason: 'snapshot_b_not_good', statusB: snapshotB?.geoQuality?.status };
  }

  // Both must have ≥ 5 within 5km
  const countA = countListingsWithinRadius(snapshotA.listings, targetLat, targetLon, 5);
  const countB = countListingsWithinRadius(snapshotB.listings, targetLat, targetLon, 5);

  if (countA < EARLY_STOP_MIN_WITHIN_5KM) {
    return { shouldRequest: true, reason: 'insufficient_local_a', countA };
  }
  if (countB < EARLY_STOP_MIN_WITHIN_5KM) {
    return { shouldRequest: true, reason: 'insufficient_local_b', countB };
  }

  // Compute stats at 5km for each
  const listingsA5 = getListingsWithinRadius(snapshotA.listings, targetLat, targetLon, 5);
  const listingsB5 = getListingsWithinRadius(snapshotB.listings, targetLat, targetLon, 5);

  const statsA = calcBrightDataMarketStats(listingsA5, today ? { today } : {});
  const statsB = calcBrightDataMarketStats(listingsB5, today ? { today } : {});

  if (!statsA?.median || !statsB?.median) {
    return { shouldRequest: true, reason: 'insufficient_stats_for_spread' };
  }

  const spread = calculateSnapshotSpread([statsA.median, statsB.median]);
  if (spread.spreadPct == null || spread.spreadPct > EARLY_STOP_MAX_SPREAD_PCT) {
    return { shouldRequest: true, reason: 'spread_too_high', spreadPct: spread.spreadPct };
  }

  return { shouldRequest: false, reason: 'two_good_snapshots_agree', spreadPct: spread.spreadPct };
}

// ── buildAirbnbMultiSnapshotConsensus ─────────────────────────────────────────

/**
 * Main function. Combines multiple Airbnb snapshots into a single consensus signal.
 *
 * Steps:
 *   1. Find common radius (smallest radius with ≥ 2 eligible snapshots having ≥ 5 local)
 *   2. For each snapshot: filter to common radius, compute stats, assign weight
 *   3. Filter contributors (weight > 0, ≥ 5 local)
 *   4. Weighted median of contributing medians
 *   5. Spread analysis
 *   6. Outlier detection
 *   7. Consensus occupancy (weighted median of contributing occupancy values)
 *   8. Confidence classification
 *
 * Fails closed: returns status='insufficient_data' when ≥ 2 contributing snapshots
 * cannot be found.
 *
 * @param {Array}  snapshots  — array of ≥ 2 snapshot objects
 * @param {object} opts
 * @param {number} opts.targetLat
 * @param {number} opts.targetLon
 * @param {string} [opts.today]   — ISO YYYY-MM-DD for occupancy proxy calculation
 *
 * @returns {{
 *   status:                    'ok'|'insufficient_data',
 *   reason?:                   string,
 *   commonRadiusKm:            number|null,
 *   commonRadiusResult:        object,
 *   consensusMedian:           number|null,
 *   consensusOccupancy:        number|null,
 *   consensusOccupancySemantics: string,
 *   spread:                    object,
 *   confidence:                'HIGH'|'MEDIUM'|'LOW'|'UNUSABLE'|null,
 *   confidenceReasons:         string[],
 *   contributingCount:         number,
 *   snapshotDetails:           Array,
 *   outlierAnalysis:           Array,
 *   diagnostics:               object,
 * }}
 */
function buildAirbnbMultiSnapshotConsensus(snapshots, opts = {}) {
  const { targetLat, targetLon, today } = opts;

  const base = {
    commonRadiusKm:              null,
    commonRadiusResult:          null,
    consensusMedian:             null,
    consensusOccupancy:          null,
    consensusOccupancySemantics: 'insufficient_calendars',
    spread:                      { spreadAbs: null, spreadPct: null, stabilityLevel: 'INCONCLUSIVE', min: null, max: null },
    confidence:                  null,
    confidenceReasons:           [],
    contributingCount:           0,
    snapshotDetails:             [],
    outlierAnalysis:             [],
    diagnostics:                 {},
  };

  if (!Array.isArray(snapshots) || snapshots.length < 2) {
    return { ...base, status: 'insufficient_data', reason: 'too_few_snapshots' };
  }

  // ── Step 1: Common radius ─────────────────────────────────────────────────
  const radiusResult = findCommonSnapshotRadius(snapshots, targetLat, targetLon);
  if (radiusResult.commonRadiusKm == null) {
    return {
      ...base,
      status:             'insufficient_data',
      reason:             `no_common_radius_${radiusResult.reason}`,
      commonRadiusResult: radiusResult,
      diagnostics: {
        totalSnapshots:     snapshots.length,
        j3EligibleCount:    snapshots.filter(s => isSnapshotJ3Eligible(s)).length,
        eligiblePerRadius:  radiusResult.eligiblePerRadius,
      },
    };
  }
  const commonRadiusKm = radiusResult.commonRadiusKm;

  // ── Step 2: Per-snapshot stats at common radius ───────────────────────────
  const snapshotDetails = snapshots.map((s, idx) => {
    const eligible         = isSnapshotJ3Eligible(s);
    const listingsAtRadius = eligible
      ? getListingsWithinRadius(s.listings, targetLat, targetLon, commonRadiusKm)
      : [];
    const countAtRadius    = listingsAtRadius.length;
    const statsAtRadius    = countAtRadius >= 1
      ? calcBrightDataMarketStats(listingsAtRadius, today ? { today } : {})
      : null;
    const weight           = eligible
      ? calculateSnapshotConsensusWeight(s, commonRadiusKm, targetLat, targetLon)
      : 0;

    let contributionStatus;
    if (!eligible)                                       contributionStatus = 'excluded_geo_quality';
    else if (countAtRadius < MIN_COMPARABLES_FALLBACK)  contributionStatus = 'excluded_insufficient_local_count';
    else if (weight === 0)                               contributionStatus = 'excluded_zero_weight';
    else                                                 contributionStatus = 'contributing';

    return {
      snapshotId:       s.snapshotId,
      snapshotIndex:    idx,
      geoStatus:        s.geoQuality?.status ?? null,
      geoScore:         s.geoQuality?.geoCoverageScore ?? null,
      countAtRadius,
      statsAtRadius,
      weight,
      contributionStatus,
      outlierStatus:    null,  // filled below
    };
  });

  // ── Step 3: Filter contributors ───────────────────────────────────────────
  const contributing        = snapshotDetails.filter(d => d.contributionStatus === 'contributing');
  const contributingIndices = contributing.map(d => d.snapshotIndex);

  if (contributing.length < 2) {
    return {
      ...base,
      status:             'insufficient_data',
      reason:             'insufficient_contributors',
      commonRadiusKm,
      commonRadiusResult: radiusResult,
      snapshotDetails,
      diagnostics: {
        totalSnapshots:    snapshots.length,
        j3EligibleCount:   snapshots.filter(s => isSnapshotJ3Eligible(s)).length,
        contributingCount: contributing.length,
        commonRadiusKm,
      },
    };
  }

  // ── Step 4: Weighted median ───────────────────────────────────────────────
  const medians          = contributing.map(d => d.statsAtRadius?.median ?? null);
  const weights          = contributing.map(d => d.weight);
  const consensusMedian  = weightedMedian(medians, weights);

  // ── Step 5: Spread ────────────────────────────────────────────────────────
  const spread = calculateSnapshotSpread(medians.filter(m => m != null));

  // ── Step 6: Outlier analysis ──────────────────────────────────────────────
  const outlierInputs = snapshotDetails.map(d => ({
    snapshotIndex: d.snapshotIndex,
    snapshotId:    d.snapshotId,
    median:        d.statsAtRadius?.median ?? null,
  }));
  const outlierAnalysis = detectSnapshotOutliers(outlierInputs);

  // Attach outlier status back to snapshotDetails
  for (const detail of snapshotDetails) {
    const o = outlierAnalysis.find(x => x.snapshotIndex === detail.snapshotIndex);
    if (o) detail.outlierStatus = o.outlierStatus;
  }

  // ── Step 7: Consensus occupancy ───────────────────────────────────────────
  const contribWithOcc = contributing.filter(
    d => d.statsAtRadius?.occupancy_semantics === 'calendar_unavailability_proxy'
  );
  let consensusOccupancy          = null;
  let consensusOccupancySemantics = 'insufficient_calendars';
  if (contribWithOcc.length >= 2) {
    const occ     = contribWithOcc.map(d => d.statsAtRadius.occupancy);
    const oWeights = contribWithOcc.map(d => d.weight);
    consensusOccupancy          = Math.round(weightedMedian(occ, oWeights));
    consensusOccupancySemantics = 'calendar_unavailability_proxy';
  }

  // ── Step 8: Confidence ────────────────────────────────────────────────────
  const { confidence, reasons: confidenceReasons } = classifySnapshotConsensusConfidence({
    snapshots,
    commonRadiusKm,
    contributingCount:  contributing.length,
    spread,
    outliers:           outlierAnalysis,
    contributingIndices,
  });

  return {
    status:                      'ok',
    commonRadiusKm,
    commonRadiusResult:          radiusResult,
    consensusMedian,
    consensusOccupancy,
    consensusOccupancySemantics,
    spread,
    confidence,
    confidenceReasons,
    contributingCount:           contributing.length,
    snapshotDetails,
    outlierAnalysis,
    diagnostics: {
      totalSnapshots:    snapshots.length,
      j3EligibleCount:   snapshots.filter(s => isSnapshotJ3Eligible(s)).length,
      contributingCount: contributing.length,
      commonRadiusKm,
      consensusMedian,
    },
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  findCommonSnapshotRadius,
  calculateSnapshotConsensusWeight,
  weightedMedian,
  calculateSnapshotSpread,
  detectSnapshotOutliers,
  classifySnapshotConsensusConfidence,
  shouldRequestThirdSnapshot,
  buildAirbnbMultiSnapshotConsensus,
  // Constants (exported for tests)
  RADIUS_BANDS_KM,
  MIN_COMPARABLES_FALLBACK,
  SPREAD_VERY_STABLE,
  SPREAD_STABLE,
  SPREAD_MODERATE,
  OUTLIER_WARNING_PCT,
  OUTLIER_CANDIDATE_PCT,
  EARLY_STOP_MAX_SPREAD_PCT,
  EARLY_STOP_MIN_WITHIN_5KM,
};
