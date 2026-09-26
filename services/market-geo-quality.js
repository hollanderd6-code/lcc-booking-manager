'use strict';
/**
 * P1.2-B5-BK-J — Geo Coverage Quality Gate
 *
 * Pure functions for measuring and classifying the geographic quality of a
 * comparable pool relative to the target property location.
 *
 * SAFETY:
 *   DB_WRITES        = 0  — no pool, no INSERT/UPDATE
 *   CHANNEX_CALLS    = 0  — no channex import
 *   PRICING_WRITES   = 0  — no pricing-apply import
 *   NETWORK_CALLS    = 0  — pure functions
 *
 * DESIGN:
 *   A comparable pool that has 0 listings within a local radius is NOT a reliable
 *   market signal for a target property — it captures a different (wider) market
 *   segment that may have different pricing dynamics. The geo coverage score
 *   reflects HOW LOCAL the selected comparables are, independently of:
 *     • radiusScore (which scores the selected radius, not the local density)
 *     • countScore  (which scores the total count, not the local density)
 *
 *   The two may correlate (a source with 0 local listings usually selects a wide
 *   radius), but they capture DIFFERENT failure modes:
 *     • A source with 0 local listings within 5km but 12 at 20km:
 *       radiusScore(20) = 0.55  (penalizes wide radius)
 *       geoCoverageScore = 0.00 (penalizes absence of local comparable)
 *       → quality = 0.00 → UNUSABLE
 *     • A source with 6 listings within 5km:
 *       radiusScore(5) = 0.90
 *       geoCoverageScore = 0.85
 *       → quality = countScore × 0.90 × ... × 0.85
 *
 * GEO COVERAGE SCORE FORMULA:
 *   Primary reference: within 5 km
 *     ≥ 8 within 5 km → 1.00  (GOOD)
 *     ≥ 5 within 5 km → 0.85  (GOOD)
 *     ≥ 3 within 5 km → 0.60  (DEGRADED)
 *     ≥ 1 within 5 km → 0.30  (DEGRADED)
 *     = 0 within 5 km → secondary reference: within 10 km
 *       ≥ 5 within 10 km → 0.20  (POOR)
 *       ≥ 1 within 10 km → 0.10  (POOR)
 *       = 0 within 10 km → 0.00  (UNUSABLE)
 *
 * RATIONALE for not lowering threshold below 5 km:
 *   M6 (Massy) is a suburban market. Valid local comparables do exist within 2-5 km.
 *   Allowing scores > 0 only when ≥1 within 10 km avoids treating a 12-listing pool
 *   all at 15-20 km as equivalent to a 12-listing pool within 3 km.
 *
 * SOURCE EXCLUSION:
 *   UNUSABLE (score = 0.00) → usableForConsensus = false
 *   Any other status → usableForConsensus = true
 *   Callers (aggregateMarketSourcesCalibrated) respect this flag.
 */

const { haversineKm } = require('./brightdata-comparable-filter');

// Reference radii for geo coverage scoring
const GEO_LOCAL_RADIUS_KM    = 5;   // primary local reference
const GEO_EXTENDED_RADIUS_KM = 10;  // secondary (only used if 0 within GEO_LOCAL_RADIUS_KM)

// Geo coverage score tiers
// Evaluated in order: first matching tier wins.
const GEO_COVERAGE_TIERS = [
  { minWithin5km: 8, score: 1.00 },
  { minWithin5km: 5, score: 0.85 },
  { minWithin5km: 3, score: 0.60 },
  { minWithin5km: 1, score: 0.30 },
  // Fallback tiers — reached only when within5km = 0
  { minWithin5km: 0, minWithin10km: 5, score: 0.20 },
  { minWithin5km: 0, minWithin10km: 1, score: 0.10 },
  { minWithin5km: 0, minWithin10km: 0, score: 0.00 },
];

// Status classification
const GEO_SCORE_GOOD      = 0.85;  // score >= 0.85
const GEO_SCORE_DEGRADED  = 0.30;  // score >= 0.30 and < 0.85
// POOR: score > 0.00 and < 0.30
// UNUSABLE: score = 0.00

// ── calculateGeoCoverageQuality ───────────────────────────────────────────────

/**
 * Compute raw geo coverage metrics for a comparable pool.
 *
 * Does not classify quality or compute a score — returns raw counts and distances.
 * Call evaluateSourceGeoQuality() for classification.
 *
 * Listings without valid coordinates are counted but excluded from distance metrics.
 *
 * @param {Array}       listings      — NormalizedListing[]
 * @param {number|null} targetLat
 * @param {number|null} targetLon
 *
 * @returns {{
 *   inputCount:       number,
 *   geoListingCount:  number,   — listings with finite lat/lon
 *   noGeoCount:       number,
 *   within1km:        number,
 *   within2km:        number,
 *   within3km:        number,
 *   within5km:        number,
 *   within10km:       number,
 *   within20km:       number,
 *   beyond20km:       number,
 *   nearestDistanceKm: number|null,
 *   medianDistanceKm:  number|null,
 *   p25DistanceKm:     number|null,
 *   p75DistanceKm:     number|null,
 *   hasTargetCoords:   boolean,
 * }}
 */
function calculateGeoCoverageQuality(listings, targetLat, targetLon) {
  const inputCount = listings.length;
  const hasTargetCoords = Number.isFinite(targetLat) && Number.isFinite(targetLon);

  const withGeo    = hasTargetCoords
    ? listings.filter(l => Number.isFinite(l.latitude) && Number.isFinite(l.longitude))
    : [];
  const noGeoCount = inputCount - withGeo.length;

  if (!hasTargetCoords || !withGeo.length) {
    return {
      inputCount,
      geoListingCount:   withGeo.length,
      noGeoCount,
      within1km:         0,
      within2km:         0,
      within3km:         0,
      within5km:         0,
      within10km:        0,
      within20km:        0,
      beyond20km:        0,
      nearestDistanceKm: null,
      medianDistanceKm:  null,
      p25DistanceKm:     null,
      p75DistanceKm:     null,
      hasTargetCoords,
    };
  }

  const distances = withGeo
    .map(l => haversineKm(targetLat, targetLon, l.latitude, l.longitude))
    .filter(d => Number.isFinite(d) && d >= 0)
    .sort((a, b) => a - b);

  const n = distances.length;
  if (n === 0) {
    return {
      inputCount,
      geoListingCount:   withGeo.length,
      noGeoCount,
      within1km:  0, within2km:  0, within3km: 0,
      within5km:  0, within10km: 0, within20km: 0, beyond20km: 0,
      nearestDistanceKm: null, medianDistanceKm: null,
      p25DistanceKm: null, p75DistanceKm: null,
      hasTargetCoords,
    };
  }

  const mid    = Math.floor(n / 2);
  const median = n % 2 === 1 ? distances[mid] : (distances[mid - 1] + distances[mid]) / 2;

  return {
    inputCount,
    geoListingCount:   n,
    noGeoCount:        inputCount - n,
    within1km:         distances.filter(d => d <= 1).length,
    within2km:         distances.filter(d => d <= 2).length,
    within3km:         distances.filter(d => d <= 3).length,
    within5km:         distances.filter(d => d <= 5).length,
    within10km:        distances.filter(d => d <= 10).length,
    within20km:        distances.filter(d => d <= 20).length,
    beyond20km:        distances.filter(d => d > 20).length,
    nearestDistanceKm: distances[0],
    medianDistanceKm:  median,
    p25DistanceKm:     distances[Math.floor(n * 0.25)],
    p75DistanceKm:     distances[Math.floor(n * 0.75)],
    hasTargetCoords,
  };
}

// ── computeGeoCoverageScore ───────────────────────────────────────────────────

/**
 * Compute a geo coverage score from within-5km and within-10km counts.
 * Deterministic and monotone: more local listings → higher score.
 */
function computeGeoCoverageScore(within5km, within10km) {
  const w5  = within5km  || 0;
  const w10 = within10km || 0;

  for (const tier of GEO_COVERAGE_TIERS) {
    if (w5 >= tier.minWithin5km) {
      if (tier.minWithin10km == null) return tier.score; // primary tier
      if (w10 >= tier.minWithin10km)  return tier.score; // secondary tier
    }
  }
  return 0.00; // safety fallback
}

// ── evaluateSourceGeoQuality ──────────────────────────────────────────────────

/**
 * Classify the geographic quality of a comparable pool for consensus usage.
 *
 * Combines calculateGeoCoverageQuality() metrics with the scoring tiers
 * to produce a GEO_QUALITY_STATUS and usableForConsensus flag.
 *
 * @param {Array}       listings   — NormalizedListing[] (quality pool after non-geo filters)
 * @param {number|null} targetLat
 * @param {number|null} targetLon
 *
 * @returns {{
 *   usableForConsensus: boolean,
 *   geoCoverageScore:   number,
 *   status:             'GOOD'|'DEGRADED'|'POOR'|'UNUSABLE',
 *   reason:             string,
 *   localComparableCount: number,
 *   localRadiusKm:      number|null,
 *   nearestDistanceKm:  number|null,
 *   medianDistanceKm:   number|null,
 *   p75DistanceKm:      number|null,
 *   metrics:            object,  — raw output from calculateGeoCoverageQuality
 * }}
 */
function evaluateSourceGeoQuality(listings, targetLat, targetLon) {
  const metrics = calculateGeoCoverageQuality(listings, targetLat, targetLon);

  if (!metrics.hasTargetCoords) {
    return {
      usableForConsensus: true,  // no coords → cannot determine geo quality → allow conservatively
      geoCoverageScore:   1.00,  // no geo available → don't penalize (unknown != bad)
      status:             'GOOD',
      reason:             'no_target_coords',
      localComparableCount: metrics.inputCount,
      localRadiusKm:      null,
      nearestDistanceKm:  null,
      medianDistanceKm:   null,
      p75DistanceKm:      null,
      metrics,
    };
  }

  if (metrics.geoListingCount === 0) {
    return {
      usableForConsensus: false,
      geoCoverageScore:   0.00,
      status:             'UNUSABLE',
      reason:             'no_geo_listings',
      localComparableCount: 0,
      localRadiusKm:      null,
      nearestDistanceKm:  null,
      medianDistanceKm:   null,
      p75DistanceKm:      null,
      metrics,
    };
  }

  const score = computeGeoCoverageScore(metrics.within5km, metrics.within10km);

  const status = score >= GEO_SCORE_GOOD     ? 'GOOD'
               : score >= GEO_SCORE_DEGRADED  ? 'DEGRADED'
               : score > 0                    ? 'POOR'
               : 'UNUSABLE';

  const usableForConsensus = status !== 'UNUSABLE';

  // localComparableCount: count within the tightest non-zero radius band
  let localCount  = 0;
  let localRadius = null;
  for (const r of [1, 2, 3, 5, 10, 20]) {
    const key = `within${r}km`;
    if (metrics[key] > 0) { localCount = metrics[key]; localRadius = r; break; }
  }

  let reason;
  if (status === 'GOOD')       reason = metrics.within5km >= 8 ? 'strong_local_coverage' : 'adequate_local_coverage';
  else if (status === 'DEGRADED') reason = metrics.within5km > 0 ? 'limited_local_coverage' : 'extended_only_coverage';
  else if (status === 'POOR')     reason = 'no_local_within_5km_some_within_10km';
  else                            reason = 'no_local_within_10km';

  return {
    usableForConsensus,
    geoCoverageScore:    score,
    status,
    reason,
    localComparableCount: localCount,
    localRadiusKm:        localRadius,
    nearestDistanceKm:    metrics.nearestDistanceKm,
    medianDistanceKm:     metrics.medianDistanceKm,
    p75DistanceKm:        metrics.p75DistanceKm,
    metrics,
  };
}

// ── computeAttritionByDistance ────────────────────────────────────────────────

/**
 * For each radius band, show raw geo count → after category → after capacity counts.
 * Used by audit-airbnb-sample-stability.js Phase 6.
 *
 * @param {Array}       listings      — all adapter-accepted listings (before non-geo filters)
 * @param {number|null} targetLat
 * @param {number|null} targetLon
 * @param {number|null} targetGuests
 * @param {string|null} targetPropertyType
 *
 * @returns {Array<{
 *   radiusKm:       number,
 *   rawGeoCount:    number,
 *   afterCatCount:  number,
 *   afterCapCount:  number,
 *   catRejected:    number,
 *   capRejected:    number,
 * }>}
 */
function computeAttritionByDistance(listings, targetLat, targetLon, targetGuests, targetPropertyType) {
  const { isCategoryCompatible, isCapacityCompatible } = require('./brightdata-comparable-filter');
  const hasCoords = Number.isFinite(targetLat) && Number.isFinite(targetLon);

  const withDist = hasCoords
    ? listings
        .filter(l => Number.isFinite(l.latitude) && Number.isFinite(l.longitude))
        .map(l => ({
          l,
          dist: haversineKm(targetLat, targetLon, l.latitude, l.longitude),
        }))
    : [];

  const bands = [1, 2, 3, 5, 10, 20];
  return bands.map(r => {
    const inBand    = hasCoords ? withDist.filter(({ dist }) => dist <= r).map(({ l }) => l) : [];
    const afterCat  = inBand.filter(l => isCategoryCompatible(l.category, targetPropertyType) !== false);
    const afterCap  = afterCat.filter(l => isCapacityCompatible(l.guests, targetGuests) !== false);
    return {
      radiusKm:      r,
      rawGeoCount:   inBand.length,
      afterCatCount: afterCat.length,
      afterCapCount: afterCap.length,
      catRejected:   inBand.length   - afterCat.length,
      capRejected:   afterCat.length - afterCap.length,
    };
  });
}

// ── computeRankDistanceProfile ────────────────────────────────────────────────

/**
 * Measure rank/distance correlation: for each rank band, compute distance statistics.
 *
 * If BD returns results sorted by non-geographic criteria (popularity, price rank, etc.),
 * then low-rank results may be distant from the target, while local listings appear
 * only at high ranks.
 *
 * This is the key diagnostic for the 50-vs-100 instability: if rank 1-50 contains
 * mostly distant results while rank 51-100 contains local results, limit_per_input=50
 * is structurally dangerous for suburban markets.
 *
 * @param {Array}       listings   — raw adapter-accepted listings IN THEIR SNAPSHOT ORDER
 * @param {number|null} targetLat
 * @param {number|null} targetLon
 *
 * @returns {Array<{
 *   band:            string,   e.g. "rank 1-10"
 *   rankFrom:        number,
 *   rankTo:          number,
 *   count:           number,
 *   withGeo:         number,
 *   minDistanceKm:   number|null,
 *   medianDistanceKm: number|null,
 *   p25DistanceKm:   number|null,
 *   p75DistanceKm:   number|null,
 *   within2km:       number,
 *   within5km:       number,
 *   within10km:      number,
 *   within20km:      number,
 * }>}
 */
function computeRankDistanceProfile(listings, targetLat, targetLon) {
  const hasCoords = Number.isFinite(targetLat) && Number.isFinite(targetLon);
  const bands     = [
    { from: 1,  to: 10  },
    { from: 11, to: 25  },
    { from: 26, to: 50  },
    { from: 51, to: 75  },
    { from: 76, to: 100 },
  ];

  return bands.map(({ from, to }) => {
    const slice    = listings.slice(from - 1, to);
    const withGeo  = hasCoords
      ? slice.filter(l => Number.isFinite(l.latitude) && Number.isFinite(l.longitude))
      : [];

    const distances = withGeo
      .map(l => haversineKm(targetLat, targetLon, l.latitude, l.longitude))
      .filter(d => Number.isFinite(d) && d >= 0)
      .sort((a, b) => a - b);

    const n = distances.length;
    if (n === 0) {
      return {
        band:            `rank ${from}-${to}`,
        rankFrom: from,  rankTo: to,
        count:           slice.length,
        withGeo:         withGeo.length,
        minDistanceKm:   null,
        medianDistanceKm: null,
        p25DistanceKm:   null,
        p75DistanceKm:   null,
        within2km:       0,
        within5km:       0,
        within10km:      0,
        within20km:      0,
      };
    }

    const mid    = Math.floor(n / 2);
    const median = n % 2 === 1 ? distances[mid] : (distances[mid - 1] + distances[mid]) / 2;

    return {
      band:             `rank ${from}-${to}`,
      rankFrom: from,   rankTo: to,
      count:            slice.length,
      withGeo:          withGeo.length,
      minDistanceKm:    distances[0],
      medianDistanceKm: median,
      p25DistanceKm:    distances[Math.floor(n * 0.25)],
      p75DistanceKm:    distances[Math.floor(n * 0.75)],
      within2km:        distances.filter(d => d <= 2).length,
      within5km:        distances.filter(d => d <= 5).length,
      within10km:       distances.filter(d => d <= 10).length,
      within20km:       distances.filter(d => d <= 20).length,
    };
  });
}

// ── computeSampleOverlap ──────────────────────────────────────────────────────

/**
 * Measure ID overlap between two snapshots (e.g. limit=50 vs limit=100).
 *
 * Only uses providerListingId — NEVER uses geo proximity as identity.
 *
 * AIRBNB_RESULT_ORDERING classification:
 *   PREFIX_STABLE:     all IDs in set50 appear at the SAME rank position in set100
 *   PARTIALLY_STABLE:  most IDs overlap but rank order differs
 *   UNSTABLE:          low overlap (< 50%)
 *   UNKNOWN:           insufficient data (empty set50 or set100)
 *
 * @param {string[]} ids50   — providerListingIds from limit=50 call (in order)
 * @param {string[]} ids100  — providerListingIds from limit=100 call (in order)
 *
 * @returns {{
 *   uniqueIds50:      number,
 *   uniqueIds100:     number,
 *   idsCommon:        number,
 *   idsOnly50:        number,
 *   idsOnly100:       number,
 *   overlapPct50:     number,  — common / unique50 * 100
 *   overlapPct100:    number,  — common / unique100 * 100
 *   first50Of100MatchSet50: boolean,  — are the first 50 IDs of the 100-call the same set as the 50-call?
 *   first50Of100OrderMatch50: boolean, — same set AND same order?
 *   ordering:         'PREFIX_STABLE'|'PARTIALLY_STABLE'|'UNSTABLE'|'UNKNOWN',
 * }}
 */
function computeSampleOverlap(ids50, ids100) {
  const set50  = new Set(ids50.filter(id => id != null));
  const set100 = new Set(ids100.filter(id => id != null));

  if (!set50.size || !set100.size) {
    return {
      uniqueIds50:    set50.size,
      uniqueIds100:   set100.size,
      idsCommon:      0,
      idsOnly50:      set50.size,
      idsOnly100:     set100.size,
      overlapPct50:   0,
      overlapPct100:  0,
      first50Of100MatchSet50:    false,
      first50Of100OrderMatch50:  false,
      ordering:       'UNKNOWN',
    };
  }

  let common = 0;
  for (const id of set50) if (set100.has(id)) common++;

  const idsOnly50  = set50.size  - common;
  const idsOnly100 = set100.size - common;

  const overlapPct50  = Math.round(common / set50.size  * 10000) / 100;
  const overlapPct100 = Math.round(common / set100.size * 10000) / 100;

  // Do the first min(|50|, |100|) IDs of the 100-call form the same SET as the 50-call?
  const first50From100 = ids100.slice(0, set50.size).filter(id => id != null);
  const setFirst50Of100 = new Set(first50From100);
  let first50Of100MatchSet50 = setFirst50Of100.size === set50.size;
  if (first50Of100MatchSet50) {
    for (const id of set50) { if (!setFirst50Of100.has(id)) { first50Of100MatchSet50 = false; break; } }
  }

  // Same order?
  let first50Of100OrderMatch50 = false;
  if (first50Of100MatchSet50) {
    const arr50 = ids50.filter(id => id != null);
    first50Of100OrderMatch50 = arr50.every((id, i) => first50From100[i] === id);
  }

  // Ordering classification
  let ordering;
  if (!set50.size || !set100.size) {
    ordering = 'UNKNOWN';
  } else if (first50Of100OrderMatch50) {
    ordering = 'PREFIX_STABLE';
  } else if (overlapPct50 >= 70) {
    ordering = 'PARTIALLY_STABLE';
  } else if (overlapPct50 >= 50) {
    ordering = 'UNSTABLE';
  } else {
    ordering = 'UNSTABLE';
  }

  return {
    uniqueIds50:    set50.size,
    uniqueIds100:   set100.size,
    idsCommon:      common,
    idsOnly50:      idsOnly50,
    idsOnly100:     idsOnly100,
    overlapPct50:   overlapPct50,
    overlapPct100:  overlapPct100,
    first50Of100MatchSet50,
    first50Of100OrderMatch50,
    ordering,
  };
}

// ── determinePrimaryAttritionReason ──────────────────────────────────────────

/**
 * Determine the primary reason why a source has few local comparables.
 *
 * PRIMARY_LOCAL_ATTRITION_REASON:
 *   SEARCH_SAMPLE    — fewer than expected listings returned by BD (size problem)
 *   CATEGORY_FILTER  — category rejection removes most local listings
 *   CAPACITY_FILTER  — capacity rejection removes most local listings
 *   GEO_MISSING      — listings exist but lack geo coordinates
 *   MIXED            — multiple significant causes
 *   NONE             — sufficient local comparables, no problem
 *   UNKNOWN          — cannot determine from available data
 *
 * @param {object} attritionByDistance — from computeAttritionByDistance() at 5km band
 * @param {number} rawCount50          — total returned by BD at limit=50
 * @param {number} rawCount100         — total returned by BD at limit=100 (or null)
 * @param {number} noGeoCount          — listings without geo
 */
function determinePrimaryAttritionReason(attritionByDistance, rawCount50, rawCount100, noGeoCount) {
  const band5km = attritionByDistance.find(b => b.radiusKm === 5);
  if (!band5km) return 'UNKNOWN';

  const { rawGeoCount, catRejected, capRejected, afterCapCount } = band5km;

  // Sufficient local comparables → no problem
  if (afterCapCount >= 5) return 'NONE';

  // Count significant causes
  const causes = [];

  // Sample size issue: very few total listings returned AND local count is proportionally low
  const totalRaw = rawCount100 != null ? rawCount100 : rawCount50;
  if (rawGeoCount === 0 && totalRaw < 100) causes.push('SEARCH_SAMPLE');

  // Geo missing: many listings lack coordinates
  const noGeoPct = noGeoCount > 0 && rawCount50 > 0 ? noGeoCount / rawCount50 : 0;
  if (noGeoPct > 0.3) causes.push('GEO_MISSING');

  // Category filter causes significant loss
  const catPct = rawGeoCount > 0 ? catRejected / rawGeoCount : 0;
  if (catPct > 0.4) causes.push('CATEGORY_FILTER');

  // Capacity filter causes significant loss
  const afterCatCount = rawGeoCount - catRejected;
  const capPct = afterCatCount > 0 ? capRejected / afterCatCount : 0;
  if (capPct > 0.4) causes.push('CAPACITY_FILTER');

  if (causes.length === 0) return rawGeoCount === 0 ? 'SEARCH_SAMPLE' : 'UNKNOWN';
  if (causes.length === 1) return causes[0];
  return 'MIXED';
}

module.exports = {
  calculateGeoCoverageQuality,
  computeGeoCoverageScore,
  evaluateSourceGeoQuality,
  computeAttritionByDistance,
  computeRankDistanceProfile,
  computeSampleOverlap,
  determinePrimaryAttritionReason,
  GEO_LOCAL_RADIUS_KM,
  GEO_EXTENDED_RADIUS_KM,
  GEO_COVERAGE_TIERS,
  GEO_SCORE_GOOD,
  GEO_SCORE_DEGRADED,
};
