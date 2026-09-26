'use strict';
/**
 * P1.2-B5-BK-J — Airbnb Geo Stability Tests
 *
 * Covers:
 *   - calculateGeoCoverageQuality: counts by band, distance stats, no-geo edge cases
 *   - computeGeoCoverageScore: tier boundaries
 *   - evaluateSourceGeoQuality: GOOD/DEGRADED/POOR/UNUSABLE classification
 *   - computeSampleOverlap: ID overlap, prefix stability, ordering classification
 *   - computeRankDistanceProfile: rank bands
 *   - computeAttritionByDistance: attrition per band
 *   - determinePrimaryAttritionReason
 *   - qualityScoreCalibrated: geoCoverageScore integration (BK-J)
 *   - aggregateMarketSourcesCalibrated: geo gate, sourceUsage, M6 protection case
 *   - Safety: no DB writes, no pricing writes, no Channex
 */

const assert = require('assert');
const test   = require('node:test');

const {
  calculateGeoCoverageQuality,
  computeGeoCoverageScore,
  evaluateSourceGeoQuality,
  computeAttritionByDistance,
  computeRankDistanceProfile,
  computeSampleOverlap,
  determinePrimaryAttritionReason,
  GEO_LOCAL_RADIUS_KM,
  GEO_EXTENDED_RADIUS_KM,
  GEO_SCORE_GOOD,
  GEO_SCORE_DEGRADED,
} = require('../services/market-geo-quality');

const {
  qualityScoreCalibrated,
  aggregateMarketSourcesCalibrated,
  isSourceValid,
} = require('../services/market-multi-source-aggregator');

// ── Helpers ───────────────────────────────────────────────────────────────────

// M6 target: 48.730667, 2.276069 (Massy, France)
const TARGET_LAT = 48.730667;
const TARGET_LON = 2.276069;

let _lid = 0;
function mkL(overrides = {}) {
  _lid++;
  return {
    providerListingId: `id-${_lid}`,
    latitude:  TARGET_LAT,
    longitude: TARGET_LON,
    category:  'apartment',
    guests:    4,
    bedrooms:  2,
    price:     100,
    currency:  'EUR',
    ...overrides,
  };
}

// Place listing at exactly ~km distance north of target (1 deg ≈ 111 km)
function mkAtKm(km, overrides = {}) {
  const latOffset = km / 111;
  return mkL({ latitude: TARGET_LAT + latOffset, longitude: TARGET_LON, ...overrides });
}

function makeAirbnbStats(opts = {}) {
  const median = opts.median ?? 120;
  const p25    = opts.p25   ?? Math.round(median * 0.75);
  const p75    = opts.p75   ?? Math.round(median * 1.30);
  return { median, p25, p75, occupancy: 55, occupancy_semantics: 'calendar_unavailability_proxy', tensionLevel: 'medium', count: 10 };
}

function makeBookingStats(opts = {}) {
  const median = opts.median ?? 100;
  const p25    = opts.p25   ?? Math.round(median * 0.75);
  const p75    = opts.p75   ?? Math.round(median * 1.30);
  return { median, p25, p75, occupancy: null, occupancy_semantics: 'unavailable', tensionLevel: null, count: 10 };
}

// ── BKJ-01..06: calculateGeoCoverageQuality ───────────────────────────────────

test('BKJ-01 calculateGeoCoverageQuality: correct within-radius counts', () => {
  const listings = [
    mkAtKm(0.5), mkAtKm(0.8), // within 1km
    mkAtKm(1.5), mkAtKm(1.8), // within 2km (not 1km)
    mkAtKm(4.0),               // within 5km (not 2km)
    mkAtKm(8.0),               // within 10km
    mkAtKm(15.0),              // within 20km
    mkAtKm(25.0),              // beyond 20km
  ];
  const r = calculateGeoCoverageQuality(listings, TARGET_LAT, TARGET_LON);
  assert.strictEqual(r.within1km,  2);
  assert.strictEqual(r.within2km,  4);
  assert.strictEqual(r.within5km,  5);
  assert.strictEqual(r.within10km, 6);
  assert.strictEqual(r.within20km, 7);
  assert.strictEqual(r.beyond20km, 1);
  assert.strictEqual(r.geoListingCount, 8);
  assert.strictEqual(r.inputCount, 8);
});

test('BKJ-02 calculateGeoCoverageQuality: no-geo listings counted but excluded from distances', () => {
  const listings = [
    mkAtKm(0.5),
    mkL({ latitude: null, longitude: null }),
    mkL({ latitude: undefined }),
  ];
  const r = calculateGeoCoverageQuality(listings, TARGET_LAT, TARGET_LON);
  assert.strictEqual(r.inputCount, 3);
  assert.strictEqual(r.geoListingCount, 1);
  assert.strictEqual(r.noGeoCount, 2);
  assert.strictEqual(r.within1km, 1);
});

test('BKJ-03 calculateGeoCoverageQuality: no target coords → hasTargetCoords=false, all counts 0', () => {
  const listings = [mkAtKm(0.5), mkAtKm(1.0)];
  const r = calculateGeoCoverageQuality(listings, null, null);
  assert.strictEqual(r.hasTargetCoords, false);
  assert.strictEqual(r.within5km, 0);
  assert.strictEqual(r.geoListingCount, 0);
  assert.strictEqual(r.inputCount, 2);
});

test('BKJ-04 calculateGeoCoverageQuality: nearest/median/p75 distances computed', () => {
  const listings = [mkAtKm(1.0), mkAtKm(3.0), mkAtKm(5.0)];
  const r = calculateGeoCoverageQuality(listings, TARGET_LAT, TARGET_LON);
  assert.ok(r.nearestDistanceKm != null && r.nearestDistanceKm < 2);
  assert.ok(r.medianDistanceKm  != null && r.medianDistanceKm  > r.nearestDistanceKm);
  assert.ok(r.p75DistanceKm     != null && r.p75DistanceKm     >= r.medianDistanceKm);
});

test('BKJ-05 calculateGeoCoverageQuality: empty listings → all zeros, no error', () => {
  const r = calculateGeoCoverageQuality([], TARGET_LAT, TARGET_LON);
  assert.strictEqual(r.inputCount, 0);
  assert.strictEqual(r.geoListingCount, 0);
  assert.strictEqual(r.within5km, 0);
  assert.strictEqual(r.nearestDistanceKm, null);
});

test('BKJ-06 calculateGeoCoverageQuality: no NaN, no Infinity in output', () => {
  const listings = [mkAtKm(1.0), mkAtKm(2.5), mkAtKm(7.0)];
  const r = calculateGeoCoverageQuality(listings, TARGET_LAT, TARGET_LON);
  for (const [k, v] of Object.entries(r)) {
    if (v == null) continue;
    assert.ok(!Number.isNaN(v),      `${k} is NaN`);
    assert.ok(Number.isFinite(v) || typeof v === 'boolean', `${k}=${v} is non-finite non-bool`);
  }
});

// ── BKJ-07..11: computeGeoCoverageScore ──────────────────────────────────────

test('BKJ-07 computeGeoCoverageScore: >=8 within 5km → 1.00', () => {
  assert.strictEqual(computeGeoCoverageScore(8,  0), 1.00);
  assert.strictEqual(computeGeoCoverageScore(10, 0), 1.00);
});

test('BKJ-08 computeGeoCoverageScore: >=5 and <8 within 5km → 0.85', () => {
  assert.strictEqual(computeGeoCoverageScore(5, 0), 0.85);
  assert.strictEqual(computeGeoCoverageScore(7, 0), 0.85);
});

test('BKJ-09 computeGeoCoverageScore: 3-4 within 5km → 0.60', () => {
  assert.strictEqual(computeGeoCoverageScore(3, 0), 0.60);
  assert.strictEqual(computeGeoCoverageScore(4, 0), 0.60);
});

test('BKJ-10 computeGeoCoverageScore: 1-2 within 5km → 0.30', () => {
  assert.strictEqual(computeGeoCoverageScore(1, 0), 0.30);
  assert.strictEqual(computeGeoCoverageScore(2, 0), 0.30);
});

test('BKJ-11 computeGeoCoverageScore: 0 within 5km → secondary tiers', () => {
  assert.strictEqual(computeGeoCoverageScore(0, 0),  0.00); // UNUSABLE
  assert.strictEqual(computeGeoCoverageScore(0, 1),  0.10); // POOR
  assert.strictEqual(computeGeoCoverageScore(0, 4),  0.10); // POOR
  assert.strictEqual(computeGeoCoverageScore(0, 5),  0.20); // POOR
  assert.strictEqual(computeGeoCoverageScore(0, 10), 0.20); // POOR
});

// ── BKJ-12..17: evaluateSourceGeoQuality ─────────────────────────────────────

test('BKJ-12 evaluateSourceGeoQuality: 8+ within 5km → GOOD, usable', () => {
  const listings = Array.from({ length: 8 }, () => mkAtKm(2.0));
  const r = evaluateSourceGeoQuality(listings, TARGET_LAT, TARGET_LON);
  assert.strictEqual(r.status,             'GOOD');
  assert.strictEqual(r.usableForConsensus, true);
  assert.strictEqual(r.geoCoverageScore,   1.00);
});

test('BKJ-13 evaluateSourceGeoQuality: 1-2 within 5km → DEGRADED, usable', () => {
  const listings = [mkAtKm(2.0), mkAtKm(3.0)];
  const r = evaluateSourceGeoQuality(listings, TARGET_LAT, TARGET_LON);
  assert.strictEqual(r.status,             'DEGRADED');
  assert.strictEqual(r.usableForConsensus, true);
  assert.strictEqual(r.geoCoverageScore,   0.30);
});

test('BKJ-14 evaluateSourceGeoQuality: 0 within 5km, 3 within 10km → POOR, usable', () => {
  const listings = Array.from({ length: 3 }, () => mkAtKm(7.0));
  const r = evaluateSourceGeoQuality(listings, TARGET_LAT, TARGET_LON);
  assert.strictEqual(r.status,             'POOR');
  assert.strictEqual(r.usableForConsensus, true);
  assert.strictEqual(r.geoCoverageScore,   0.10);
});

test('BKJ-15 evaluateSourceGeoQuality: 0 within 10km → UNUSABLE, NOT usable', () => {
  // M6 B5-BK-I case: 12 listings all at 15-20km
  const listings = Array.from({ length: 12 }, () => mkAtKm(15.0));
  const r = evaluateSourceGeoQuality(listings, TARGET_LAT, TARGET_LON);
  assert.strictEqual(r.status,             'UNUSABLE');
  assert.strictEqual(r.usableForConsensus, false);
  assert.strictEqual(r.geoCoverageScore,   0.00);
});

test('BKJ-16 evaluateSourceGeoQuality: no target coords → GOOD (cannot determine)', () => {
  const listings = [mkAtKm(2.0), mkAtKm(3.0)];
  const r = evaluateSourceGeoQuality(listings, null, null);
  assert.strictEqual(r.status,             'GOOD');
  assert.strictEqual(r.usableForConsensus, true);
  assert.strictEqual(r.geoCoverageScore,   1.00);
  assert.strictEqual(r.reason,             'no_target_coords');
});

test('BKJ-17 evaluateSourceGeoQuality: all listings have no geo → UNUSABLE', () => {
  const listings = [mkL({ latitude: null }), mkL({ latitude: null })];
  const r = evaluateSourceGeoQuality(listings, TARGET_LAT, TARGET_LON);
  assert.strictEqual(r.status,             'UNUSABLE');
  assert.strictEqual(r.usableForConsensus, false);
  assert.strictEqual(r.reason,             'no_geo_listings');
});

// ── BKJ-18..22: computeSampleOverlap ─────────────────────────────────────────

test('BKJ-18 computeSampleOverlap: prefix stable when same IDs in same order', () => {
  const ids50  = ['a', 'b', 'c', 'd', 'e'];
  const ids100 = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  const r = computeSampleOverlap(ids50, ids100);
  assert.strictEqual(r.idsCommon, 5);
  assert.strictEqual(r.overlapPct50, 100);
  assert.strictEqual(r.first50Of100MatchSet50,    true);
  assert.strictEqual(r.first50Of100OrderMatch50,  true);
  assert.strictEqual(r.ordering, 'PREFIX_STABLE');
});

test('BKJ-19 computeSampleOverlap: partially stable when same IDs different order', () => {
  const ids50  = ['a', 'b', 'c', 'd', 'e'];
  const ids100 = ['b', 'a', 'c', 'e', 'd', 'f', 'g', 'h'];  // same set, different order
  const r = computeSampleOverlap(ids50, ids100);
  assert.strictEqual(r.first50Of100MatchSet50,   true);
  assert.strictEqual(r.first50Of100OrderMatch50, false);
  assert.ok(r.ordering !== 'PREFIX_STABLE'); // PARTIALLY_STABLE at least
});

test('BKJ-20 computeSampleOverlap: unstable when low overlap', () => {
  const ids50  = ['a', 'b', 'c', 'd', 'e'];
  const ids100 = ['x', 'y', 'z', 'w', 'v', 'a', 'f', 'g', 'h', 'i'];
  const r = computeSampleOverlap(ids50, ids100);
  assert.ok(r.idsCommon === 1);
  assert.ok(r.overlapPct50 < 50);
  assert.strictEqual(r.ordering, 'UNSTABLE');
});

test('BKJ-21 computeSampleOverlap: empty ids → UNKNOWN', () => {
  const r = computeSampleOverlap([], ['a', 'b']);
  assert.strictEqual(r.ordering, 'UNKNOWN');
});

test('BKJ-22 computeSampleOverlap: IDs_ONLY_100 = IDs exclusive to 100', () => {
  const ids50  = ['a', 'b', 'c'];
  const ids100 = ['a', 'b', 'c', 'd', 'e'];
  const r = computeSampleOverlap(ids50, ids100);
  assert.strictEqual(r.idsOnly100, 2);
  assert.strictEqual(r.idsOnly50,  0);
  assert.strictEqual(r.idsCommon,  3);
});

// ── BKJ-23..26: computeRankDistanceProfile ───────────────────────────────────

test('BKJ-23 computeRankDistanceProfile: bands respect rank slicing', () => {
  const listings = Array.from({ length: 60 }, (_, i) => mkAtKm(i * 0.5 + 0.1));
  const profile  = computeRankDistanceProfile(listings, TARGET_LAT, TARGET_LON);
  const band1_10  = profile.find(b => b.rankFrom === 1);
  const band11_25 = profile.find(b => b.rankFrom === 11);
  assert.strictEqual(band1_10.count,  10);
  assert.strictEqual(band11_25.count, 15);
  // Early bands should be closer (smaller distances) than later bands
  assert.ok(band1_10.medianDistanceKm < band11_25.medianDistanceKm);
});

test('BKJ-24 computeRankDistanceProfile: local listings in later bands → size_sensitive', () => {
  // Simulate: first 50 are far, listings 51-60 are local
  const farListings   = Array.from({ length: 50 }, () => mkAtKm(15.0));
  const localListings = Array.from({ length: 10 }, () => mkAtKm(1.0));
  const all = [...farListings, ...localListings];
  const profile = computeRankDistanceProfile(all, TARGET_LAT, TARGET_LON);
  const band51_75 = profile.find(b => b.rankFrom === 51);
  // Local listings should show within 2km in band 51-75
  assert.ok(band51_75.within2km > 0);
  // Early band should have larger distances
  const band1_10 = profile.find(b => b.rankFrom === 1);
  assert.ok(band1_10.within2km === 0);
});

test('BKJ-25 computeRankDistanceProfile: no NaN values', () => {
  const listings = [mkAtKm(1.0), mkAtKm(5.0), mkAtKm(12.0)];
  const profile  = computeRankDistanceProfile(listings, TARGET_LAT, TARGET_LON);
  for (const band of profile) {
    for (const [k, v] of Object.entries(band)) {
      if (typeof v === 'number') {
        assert.ok(!Number.isNaN(v), `${k} is NaN`);
        assert.ok(Number.isFinite(v), `${k} is non-finite`);
      }
    }
  }
});

test('BKJ-26 computeRankDistanceProfile: listings beyond rank 100 not counted', () => {
  const listings = Array.from({ length: 120 }, (_, i) => mkAtKm(i * 0.1 + 0.1));
  const profile  = computeRankDistanceProfile(listings, TARGET_LAT, TARGET_LON);
  const totalCounted = profile.reduce((s, b) => s + b.count, 0);
  assert.ok(totalCounted <= 100);
});

// ── BKJ-27..29: computeAttritionByDistance ───────────────────────────────────

test('BKJ-27 computeAttritionByDistance: produces band for each radius in [1,2,3,5,10,20]', () => {
  const listings = [mkAtKm(1.0), mkAtKm(3.0), mkAtKm(8.0)];
  const bands    = computeAttritionByDistance(listings, TARGET_LAT, TARGET_LON, 4, 'entire_place');
  assert.deepStrictEqual(bands.map(b => b.radiusKm), [1, 2, 3, 5, 10, 20]);
});

test('BKJ-28 computeAttritionByDistance: category rejected counts correctly', () => {
  const listings = [
    mkAtKm(1.0, { category: 'hostel' }),  // incompatible
    mkAtKm(1.5, { category: 'apartment' }), // compatible
    mkAtKm(1.8, { category: 'apartment' }), // compatible
  ];
  const bands   = computeAttritionByDistance(listings, TARGET_LAT, TARGET_LON, null, 'entire_place');
  const band2km = bands.find(b => b.radiusKm === 2);
  assert.strictEqual(band2km.rawGeoCount,   3);
  assert.strictEqual(band2km.catRejected,   1); // hostel rejected
  assert.strictEqual(band2km.afterCatCount, 2);
});

test('BKJ-29 computeAttritionByDistance: cumulative counts (wider bands include narrower)', () => {
  const listings = [mkAtKm(0.5), mkAtKm(1.5), mkAtKm(4.0)];
  const bands    = computeAttritionByDistance(listings, TARGET_LAT, TARGET_LON, null, null);
  const b1  = bands.find(b => b.radiusKm === 1);
  const b5  = bands.find(b => b.radiusKm === 5);
  assert.strictEqual(b1.rawGeoCount, 1);
  assert.strictEqual(b5.rawGeoCount, 3);
});

// ── BKJ-30..33: determinePrimaryAttritionReason ──────────────────────────────

test('BKJ-30 determinePrimaryAttritionReason: NONE when sufficient local', () => {
  const attrition = [{ radiusKm: 5, rawGeoCount: 10, catRejected: 0, capRejected: 0, afterCatCount: 10, afterCapCount: 8 }];
  const r = determinePrimaryAttritionReason(attrition, 50, 100, 0);
  assert.strictEqual(r, 'NONE');
});

test('BKJ-31 determinePrimaryAttritionReason: SEARCH_SAMPLE when 0 local and small total', () => {
  const attrition = [{ radiusKm: 5, rawGeoCount: 0, catRejected: 0, capRejected: 0, afterCatCount: 0, afterCapCount: 0 }];
  const r = determinePrimaryAttritionReason(attrition, 30, 50, 0);
  assert.strictEqual(r, 'SEARCH_SAMPLE');
});

test('BKJ-32 determinePrimaryAttritionReason: CATEGORY_FILTER when high rejection rate', () => {
  const attrition = [{ radiusKm: 5, rawGeoCount: 10, catRejected: 8, capRejected: 0, afterCatCount: 2, afterCapCount: 2 }];
  const r = determinePrimaryAttritionReason(attrition, 50, 100, 2);
  assert.strictEqual(r, 'CATEGORY_FILTER');
});

test('BKJ-33 determinePrimaryAttritionReason: CAPACITY_FILTER when high rejection after cat', () => {
  const attrition = [{ radiusKm: 5, rawGeoCount: 10, catRejected: 0, capRejected: 8, afterCatCount: 10, afterCapCount: 2 }];
  const r = determinePrimaryAttritionReason(attrition, 50, 100, 0);
  assert.strictEqual(r, 'CAPACITY_FILTER');
});

// ── BKJ-34..36: qualityScoreCalibrated with geoCoverageScore ─────────────────

test('BKJ-34 qualityScoreCalibrated: geoCoverageScore=0 → quality=0 (BKJ gate)', () => {
  const q = qualityScoreCalibrated(12, 20, 0.85, 0.00);
  assert.strictEqual(q, 0.00);
});

test('BKJ-35 qualityScoreCalibrated: geoCoverageScore null defaults to 1.0', () => {
  const withNull    = qualityScoreCalibrated(10, 2, 0.90, null);
  const withDefault = qualityScoreCalibrated(10, 2, 0.90, 1.0);
  assert.ok(Math.abs(withNull - withDefault) < 1e-10);
});

test('BKJ-36 qualityScoreCalibrated: BKJ reduces BKI quality proportionally', () => {
  const bkiQuality  = qualityScoreCalibrated(12, 20, 0.85, null);  // no geo gate
  const bkjQuality  = qualityScoreCalibrated(12, 20, 0.85, 0.20);  // POOR geo
  assert.ok(bkjQuality < bkiQuality);
  assert.ok(Math.abs(bkjQuality - bkiQuality * 0.20) < 1e-10);
});

// ── BKJ-37..45: aggregateMarketSourcesCalibrated with geo gate ────────────────

function makeSrc(stats, count = 8, radius = 2, meta = 0.90, geo = 1.00, geoQuality = null) {
  return { stats, comparableCount: count, selectedRadiusKm: radius, metadataScore: meta, geoCoverageScore: geo, geoQuality };
}

test('BKJ-37 aggregateMarketSourcesCalibrated: M6 protection — UNUSABLE Airbnb geo → excluded', () => {
  // Simulate M6 B5-BK-I: Airbnb 12 listings all at 15-20km, Booking 19 local
  const airbnbGeoQ  = { usableForConsensus: false, status: 'UNUSABLE', reason: 'no_local_within_10km' };
  const bookingGeoQ = { usableForConsensus: true,  status: 'GOOD',     reason: 'adequate_local_coverage' };

  const r = aggregateMarketSourcesCalibrated({
    airbnb:  { stats: makeAirbnbStats({ median: 248 }), comparableCount: 12, selectedRadiusKm: 20, metadataScore: 0.85, geoQuality: airbnbGeoQ },
    booking: { stats: makeBookingStats({ median: 100 }), comparableCount: 19, selectedRadiusKm: 2,  metadataScore: 0.90, geoQuality: bookingGeoQ },
    commonRadiusKm: 20,
  });

  // Airbnb excluded → single source (Booking)
  assert.strictEqual(r.diagnostics.validSourceCount, 1);
  assert.strictEqual(r.consensus.weights.airbnb,  0.00);
  assert.strictEqual(r.consensus.weights.booking, 1.00);
  assert.strictEqual(r.consensus.median, 100); // Booking only
  assert.strictEqual(r.consensus.confidenceLevel, 'LOW'); // single source
  assert.strictEqual(r.sourceUsage.airbnb.included,       false);
  assert.strictEqual(r.sourceUsage.airbnb.exclusionReason, 'no_local_within_10km');
  assert.strictEqual(r.sourceUsage.booking.included, true);
});

test('BKJ-38 aggregateMarketSourcesCalibrated: OLD M6 weight was 47.37%, NEW weight=0 after BKJ', () => {
  const airbnbGeoQ  = { usableForConsensus: false, status: 'UNUSABLE', reason: 'no_local_within_10km' };
  const r = aggregateMarketSourcesCalibrated({
    airbnb:  { stats: makeAirbnbStats({ median: 248 }), comparableCount: 12, selectedRadiusKm: 20, geoQuality: airbnbGeoQ },
    booking: { stats: makeBookingStats({ median: 100 }), comparableCount: 19, selectedRadiusKm: 2 },
  });
  assert.strictEqual(r.consensus.weights.airbnb, 0.00); // was 47.37% in BKI without geo gate
});

test('BKJ-39 aggregateMarketSourcesCalibrated: Booking unusable, Airbnb good → Airbnb only', () => {
  const bookingGeoQ = { usableForConsensus: false, status: 'UNUSABLE', reason: 'no_local_within_10km' };
  const r = aggregateMarketSourcesCalibrated({
    airbnb:  { stats: makeAirbnbStats({ median: 120 }), comparableCount: 8, selectedRadiusKm: 2 },
    booking: { stats: makeBookingStats({ median: 80 }),  comparableCount: 7, selectedRadiusKm: 20, geoQuality: bookingGeoQ },
  });
  assert.strictEqual(r.consensus.weights.airbnb,  1.00);
  assert.strictEqual(r.consensus.weights.booking, 0.00);
  assert.strictEqual(r.sourceUsage.booking.included, false);
});

test('BKJ-40 aggregateMarketSourcesCalibrated: both sources good → normal consensus', () => {
  const r = aggregateMarketSourcesCalibrated({
    airbnb:  makeSrc(makeAirbnbStats({ median: 120 }), 8, 2, 0.90, 0.85),
    booking: makeSrc(makeBookingStats({ median: 100 }), 8, 2, 0.90, 1.00),
  });
  assert.strictEqual(r.diagnostics.validSourceCount, 2);
  assert.ok(r.consensus.weights.airbnb  > 0);
  assert.ok(r.consensus.weights.booking > 0);
  assert.ok(Math.abs(r.consensus.weights.airbnb + r.consensus.weights.booking - 1.0) < 1e-9);
});

test('BKJ-41 aggregateMarketSourcesCalibrated: both unusable → 0 valid sources', () => {
  const geoQ = { usableForConsensus: false, status: 'UNUSABLE', reason: 'no_local_within_10km' };
  const r = aggregateMarketSourcesCalibrated({
    airbnb:  { stats: makeAirbnbStats(), comparableCount: 5, selectedRadiusKm: 20, geoQuality: geoQ },
    booking: { stats: makeBookingStats(), comparableCount: 5, selectedRadiusKm: 20, geoQuality: geoQ },
  });
  assert.strictEqual(r.diagnostics.validSourceCount, 0);
  assert.strictEqual(r.consensus, null);
  assert.strictEqual(r.sourceUsage.airbnb.included,  false);
  assert.strictEqual(r.sourceUsage.booking.included, false);
});

test('BKJ-42 aggregateMarketSourcesCalibrated: degraded Airbnb (score=0.30) kept but lower weight', () => {
  // Booking: score=1.00; Airbnb: score=0.30 (DEGRADED)
  const rDegraded = aggregateMarketSourcesCalibrated({
    airbnb:  makeSrc(makeAirbnbStats({ median: 120 }), 8, 2, 0.90, 0.30),
    booking: makeSrc(makeBookingStats({ median: 100 }), 8, 2, 0.90, 1.00),
  });
  const rGood = aggregateMarketSourcesCalibrated({
    airbnb:  makeSrc(makeAirbnbStats({ median: 120 }), 8, 2, 0.90, 1.00),
    booking: makeSrc(makeBookingStats({ median: 100 }), 8, 2, 0.90, 1.00),
  });
  // Degraded airbnb has lower weight than when geo=1.0
  assert.ok(rDegraded.consensus.weights.airbnb < rGood.consensus.weights.airbnb);
});

test('BKJ-43 aggregateMarketSourcesCalibrated: sourceUsage includes effectiveQuality', () => {
  const r = aggregateMarketSourcesCalibrated({
    airbnb:  makeSrc(makeAirbnbStats(), 8, 2, 0.90, 0.85),
    booking: makeSrc(makeBookingStats(), 8, 2, 0.90, 1.00),
  });
  assert.ok(r.sourceUsage.airbnb.effectiveQuality  > 0);
  assert.ok(r.sourceUsage.booking.effectiveQuality > 0);
});

test('BKJ-44 aggregateMarketSourcesCalibrated: market signal from Airbnb only, never Booking', () => {
  const r = aggregateMarketSourcesCalibrated({
    airbnb:  makeSrc(makeAirbnbStats({ median: 120 }), 8, 2, 0.90, 0.85),
    booking: makeSrc(makeBookingStats(), 8, 2, 0.90, 1.00),
  });
  assert.strictEqual(r.marketSignal.source, 'airbnb');

  const bookingHasOccupancy = { ...makeBookingStats(), occupancy: 90 };
  const r2 = aggregateMarketSourcesCalibrated({
    airbnb:  null,
    booking: makeSrc(bookingHasOccupancy, 8, 2, 0.90, 1.00),
  });
  assert.strictEqual(r2.marketSignal.source,    null); // Booking occupancy never in signal
  assert.strictEqual(r2.marketSignal.occupancy, null);
});

test('BKJ-45 aggregateMarketSourcesCalibrated: geo_score in diagnostics', () => {
  const r = aggregateMarketSourcesCalibrated({
    airbnb:  makeSrc(makeAirbnbStats(), 8, 2, 0.90, 0.85),
    booking: makeSrc(makeBookingStats(), 8, 2, 0.90, 1.00),
  });
  assert.strictEqual(r.diagnostics.airbnbGeoScore,  0.85);
  assert.strictEqual(r.diagnostics.bookingGeoScore, 1.00);
  assert.strictEqual(r.diagnostics.calibrated,      true);
});

// ── BKJ-46..48: geo quality constants ────────────────────────────────────────

test('BKJ-46 GEO constants are reasonable', () => {
  assert.strictEqual(GEO_LOCAL_RADIUS_KM,    5);
  assert.strictEqual(GEO_EXTENDED_RADIUS_KM, 10);
  assert.strictEqual(GEO_SCORE_GOOD,         0.85);
  assert.strictEqual(GEO_SCORE_DEGRADED,     0.30);
});

test('BKJ-47 geoCoverageScore is monotone: more local → higher score', () => {
  assert.ok(computeGeoCoverageScore(0, 0) < computeGeoCoverageScore(0, 5));
  assert.ok(computeGeoCoverageScore(0, 5) < computeGeoCoverageScore(1, 0));
  assert.ok(computeGeoCoverageScore(1, 0) < computeGeoCoverageScore(3, 0));
  assert.ok(computeGeoCoverageScore(3, 0) < computeGeoCoverageScore(5, 0));
  assert.ok(computeGeoCoverageScore(5, 0) < computeGeoCoverageScore(8, 0));
});

test('BKJ-48 evaluateSourceGeoQuality: immutable — does not modify input listings', () => {
  const listings = [mkAtKm(1.0), mkAtKm(3.0)];
  const origLen  = listings.length;
  evaluateSourceGeoQuality(listings, TARGET_LAT, TARGET_LON);
  assert.strictEqual(listings.length, origLen);
  assert.ok(!('_dist' in listings[0]), 'listing should not have _dist added');
});

// ── BKJ-49..50: Safety ────────────────────────────────────────────────────────

test('BKJ-49 market-geo-quality.js: no DB writes, no Channex, no pricing-apply', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../services/market-geo-quality.js'), 'utf8'
  );
  assert.ok(!/\bINSERT\s+INTO\b/i.test(src),       'no INSERT INTO');
  assert.ok(!/\bpool\.query\b/i.test(src),          'no pool.query');
  assert.ok(!/require.*channex/i.test(src),         'no channex import');
  assert.ok(!/require.*pricing-apply/i.test(src),   'no pricing-apply import');
  assert.ok(!/BRIGHTDATA_API_KEY/i.test(src),       'no API key logging');
  assert.ok(!/MARKET_PRIMARY_PROVIDER/i.test(src),  'does not modify routing');
});

test('BKJ-50 aggregateMarketSourcesCalibrated: never concatenates raw listings', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../services/market-multi-source-aggregator.js'), 'utf8'
  );
  const calibStart = src.indexOf('function aggregateMarketSourcesCalibrated');
  const calibEnd   = src.indexOf('\nmodule.exports', calibStart);
  const calibSrc   = calibEnd > 0 ? src.slice(calibStart, calibEnd) : src.slice(calibStart);
  assert.ok(!/\[\s*\.\.\.airbnb.*listing/i.test(calibSrc),   'no naive merge');
  assert.ok(!/\[\s*\.\.\.booking.*listing/i.test(calibSrc),  'no naive merge');
});
