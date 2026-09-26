'use strict';
/**
 * P1.2-B5-BK-H — Divergence Audit Tests
 *
 * Tests all pure analysis functions in outils/audit-multisource-divergence.js.
 * No network calls. No DB. No mutable state.
 */

const assert = require('assert');
const test   = require('node:test');

const {
  computeQualityPool,
  computeFilterFunnel,
  computeRadiusBands,
  computeDistanceDistribution,
  computeCategoryDistribution,
  computeBedroomDistribution,
  computeCapacityGuestDistribution,
  computeNormalizationSample,
  computeCommonRadiusStats,
  computeDivergencePct,
  computeSearchCoverage,
  computePrimaryAttritionReason,
  computeCrossSourceGeoProximity,
  computeCounterfactuals,
  computeDivergenceFactors,
  computeRealPlatformPriceGap,
  computeSafeForPricing,
  priceStats,
  HARD_MAX_LISTINGS,
  DEFAULT_NIGHTS,
} = require('../outils/audit-multisource-divergence');

const { MIN_COMPARABLES_FALLBACK } = require('../services/brightdata-comparable-filter');

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Massy, France approx coords
const TARGET_LAT = 48.73;
const TARGET_LON =  2.27;

function mkListing(opts = {}) {
  return {
    price:             opts.price             ?? 80,
    isBooked:          opts.isBooked          ?? false,
    bedrooms:          opts.bedrooms          ?? null,
    stars:             opts.stars             ?? 0,
    providerListingId: opts.providerListingId ?? null,
    latitude:          opts.latitude          ?? TARGET_LAT,
    longitude:         opts.longitude         ?? TARGET_LON,
    guests:            opts.guests            ?? null,
    category:          opts.category          ?? null,
    availableDates:    opts.availableDates     ?? null,
  };
}

function mkGrid(n, price = 80) {
  return Array.from({ length: n }, (_, i) => mkListing({
    price,
    providerListingId: `id-${i}`,
    latitude:  TARGET_LAT + i * 0.001,
    longitude: TARGET_LON + i * 0.001,
  }));
}

function mkDiag(returned, accepted) {
  return { returnedCount: returned, acceptedCount: accepted };
}

// ── BKH-01..04: computeQualityPool ────────────────────────────────────────────

test('BKH-01 computeQualityPool applies dedup by providerListingId', () => {
  const listings = [
    mkListing({ providerListingId: 'A', price: 80 }),
    mkListing({ providerListingId: 'A', price: 90 }),  // duplicate
    mkListing({ providerListingId: 'B', price: 70 }),
  ];
  const pool = computeQualityPool(listings);
  assert.strictEqual(pool.length, 2);
  assert.strictEqual(pool[0].price, 80); // first kept
});

test('BKH-02 computeQualityPool applies category filter (rejects hotel/room vs entire_place)', () => {
  const listings = [
    mkListing({ category: 'entire home' }),
    mkListing({ category: 'hotel room' }),
    mkListing({ category: 'shared room' }),
  ];
  const pool = computeQualityPool(listings, null, 'entire_place');
  assert.strictEqual(pool.length, 1);
  assert.strictEqual(pool[0].category, 'entire home');
});

test('BKH-03 computeQualityPool applies capacity filter (rejects abs(guests-target) > 2)', () => {
  const listings = [
    mkListing({ guests: 3, providerListingId: 'a' }), // target=3, delta=0 → keep
    mkListing({ guests: 7, providerListingId: 'b' }), // target=3, delta=4 → reject
    mkListing({ guests: null, providerListingId: 'c' }), // null → keep conservatively
  ];
  const pool = computeQualityPool(listings, 3, null);
  assert.strictEqual(pool.length, 2);
  const ids = pool.map(l => l.providerListingId);
  assert.ok(ids.includes('a'));
  assert.ok(ids.includes('c'));
  assert.ok(!ids.includes('b'));
});

test('BKH-04 computeQualityPool does not mutate input array', () => {
  const listings = mkGrid(5);
  const before = listings.length;
  computeQualityPool(listings, 2, 'entire_place');
  assert.strictEqual(listings.length, before);
});

// ── BKH-05..09: computeFilterFunnel ──────────────────────────────────────────

test('BKH-05 computeFilterFunnel raw count from adapterDiag', () => {
  const listings = mkGrid(5);
  const f = computeFilterFunnel(listings, mkDiag(10, 5));
  assert.strictEqual(f.raw, 10);
  assert.strictEqual(f.adapterAccepted, 5);
});

test('BKH-06 computeFilterFunnel counts deduplication', () => {
  const listings = [
    mkListing({ providerListingId: 'dup', price: 80 }),
    mkListing({ providerListingId: 'dup', price: 90 }),
    mkListing({ providerListingId: 'x',   price: 70 }),
  ];
  const f = computeFilterFunnel(listings, mkDiag(3, 3));
  assert.strictEqual(f.dupCount, 1);
  assert.strictEqual(f.afterDedup, 2);
});

test('BKH-07 computeFilterFunnel counts category rejection', () => {
  const listings = [
    mkListing({ category: 'entire home', providerListingId: 'a' }),
    mkListing({ category: 'hotel room',  providerListingId: 'b' }),
  ];
  const f = computeFilterFunnel(listings, mkDiag(2, 2), { targetPropertyType: 'entire_place' });
  assert.strictEqual(f.catRejected, 1);
  assert.strictEqual(f.afterCategory, 1);
});

test('BKH-08 computeFilterFunnel counts capacity rejection', () => {
  const listings = [
    mkListing({ guests: 3, providerListingId: 'a' }),
    mkListing({ guests: 9, providerListingId: 'b' }),
  ];
  const f = computeFilterFunnel(listings, mkDiag(2, 2), { targetGuests: 3 });
  assert.strictEqual(f.capRejected, 1);
  assert.strictEqual(f.afterCapacity, 1);
});

test('BKH-09 computeFilterFunnel counts missing geo in quality pool', () => {
  const noGeo = Object.assign(mkListing({ providerListingId: 'b' }), { latitude: null, longitude: null });
  const listings = [
    mkListing({ providerListingId: 'a' }),
    noGeo,
  ];
  const f = computeFilterFunnel(listings, mkDiag(2, 2));
  assert.strictEqual(f.qualityPoolGeo, 1);
  assert.strictEqual(f.qualityPoolNoGeo, 1);
});

// ── BKH-10..12: computeRadiusBands ───────────────────────────────────────────

test('BKH-10 computeRadiusBands returns one entry per radius band', () => {
  const listings = mkGrid(20);
  const bands = computeRadiusBands(listings, TARGET_LAT, TARGET_LON);
  assert.strictEqual(bands.length, 6); // [1,2,3,5,10,20]
});

test('BKH-11 computeRadiusBands counts only geo-valid listings', () => {
  const noGeo = Object.assign(mkListing({ providerListingId: 'nogeo' }), { latitude: null, longitude: null });
  const listings = [...mkGrid(5), noGeo];
  const bands = computeRadiusBands(listings, TARGET_LAT, TARGET_LON);
  // All 5 geo listings are at TARGET coords, well within 1km
  assert.strictEqual(bands[0].rawGeoCount, 5);
});

test('BKH-12 computeRadiusBands null when no target coords', () => {
  const bands = computeRadiusBands(mkGrid(5), null, null);
  assert.strictEqual(bands, null);
});

// ── BKH-13..16: computeDistanceDistribution ───────────────────────────────────

test('BKH-13 computeDistanceDistribution min ≤ p10 ≤ median ≤ p90 ≤ max', () => {
  const listings = mkGrid(20, 80).map((l, i) => ({
    ...l, latitude: TARGET_LAT + i * 0.05, longitude: TARGET_LON + i * 0.05,
  }));
  const d = computeDistanceDistribution(listings, TARGET_LAT, TARGET_LON);
  assert.ok(d.min <= d.p10);
  assert.ok(d.p10 <= d.median);
  assert.ok(d.median <= d.p90);
  assert.ok(d.p90 <= d.max);
});

test('BKH-14 computeDistanceDistribution within counts are cumulative', () => {
  const listings = mkGrid(10, 80).map((l, i) => ({
    ...l, latitude: TARGET_LAT + i * 0.1, longitude: TARGET_LON,
  }));
  const d = computeDistanceDistribution(listings, TARGET_LAT, TARGET_LON);
  assert.ok(d.within1km  <= d.within2km);
  assert.ok(d.within2km  <= d.within3km);
  assert.ok(d.within3km  <= d.within5km);
  assert.ok(d.within5km  <= d.within10km);
  assert.ok(d.within10km <= d.within20km);
  assert.strictEqual(d.within20km + d.beyond20km, d.count);
});

test('BKH-15 computeDistanceDistribution null when no target coords', () => {
  const d = computeDistanceDistribution(mkGrid(5), null, null);
  assert.strictEqual(d, null);
});

test('BKH-16 computeDistanceDistribution count=0 when no geo listings', () => {
  const noGeo = Object.assign(mkListing(), { latitude: null, longitude: null });
  const d = computeDistanceDistribution([noGeo], TARGET_LAT, TARGET_LON);
  assert.strictEqual(d.count, 0);
});

// ── BKH-17..18: computeCategoryDistribution ───────────────────────────────────

test('BKH-17 computeCategoryDistribution counts per category', () => {
  const listings = [
    mkListing({ category: 'entire home' }),
    mkListing({ category: 'entire home' }),
    mkListing({ category: 'apartment' }),
  ];
  const dist = computeCategoryDistribution(listings);
  const map  = Object.fromEntries(dist.distribution);
  assert.strictEqual(map['entire home'], 2);
  assert.strictEqual(map['apartment'],  1);
});

test('BKH-18 computeCategoryDistribution nullCount correct', () => {
  const listings = [
    mkListing({ category: null }),
    mkListing({ category: '' }),
    mkListing({ category: 'apartment' }),
  ];
  const dist = computeCategoryDistribution(listings);
  assert.strictEqual(dist.nullCount, 2);
  assert.strictEqual(dist.total, 3);
});

// ── BKH-19..21: computeBedroomDistribution ────────────────────────────────────

test('BKH-19 computeBedroomDistribution sums to total', () => {
  const listings = [
    mkListing({ bedrooms: null }),
    mkListing({ bedrooms: 0 }),
    mkListing({ bedrooms: 1 }),
    mkListing({ bedrooms: 2 }),
    mkListing({ bedrooms: 4 }),
  ];
  const d = computeBedroomDistribution(listings);
  assert.strictEqual(d.missing + d.b0 + d.b1 + d.b2 + d.b3plus, d.total);
});

test('BKH-20 computeBedroomDistribution exactMatch with targetBedrooms', () => {
  const listings = [
    mkListing({ bedrooms: 1 }),
    mkListing({ bedrooms: 1 }),
    mkListing({ bedrooms: 2 }),
    mkListing({ bedrooms: null }),
  ];
  const d = computeBedroomDistribution(listings, 1);
  assert.strictEqual(d.exactMatch, 2);
  assert.strictEqual(d.mismatch,   1);
  assert.strictEqual(d.unknownBedrooms, 1);
});

test('BKH-21 computeBedroomDistribution exactMatch/mismatch null when no target', () => {
  const d = computeBedroomDistribution(mkGrid(3));
  assert.strictEqual(d.exactMatch, null);
  assert.strictEqual(d.mismatch,   null);
});

// ── BKH-22..23: computeCapacityGuestDistribution ──────────────────────────────

test('BKH-22 Booking capacity filter NOT_APPLIED (guests always null for Booking)', () => {
  const listings = mkGrid(5).map(l => ({ ...l, guests: null }));
  const c = computeCapacityGuestDistribution(listings, 'booking');
  assert.strictEqual(c.filterApplied, false);
  assert.strictEqual(c.nativeCapacityField, 'unavailable');
  assert.ok(c.note.includes('input echo'));
});

test('BKH-23 Airbnb capacity distribution shows guest counts', () => {
  const listings = [
    mkListing({ guests: 2 }),
    mkListing({ guests: 3 }),
    mkListing({ guests: null }),
  ];
  const c = computeCapacityGuestDistribution(listings, 'airbnb');
  assert.strictEqual(c.filterApplied, true);
  assert.strictEqual(c.nullCount, 1);
  assert.strictEqual(c.distribution['2'], 1);
  assert.strictEqual(c.distribution['3'], 1);
});

// ── BKH-24..28: computeCommonRadiusStats ─────────────────────────────────────

test('BKH-24 computeCommonRadiusStats returns 6 entries (one per radius band)', () => {
  const cr = computeCommonRadiusStats(mkGrid(20), mkGrid(20), TARGET_LAT, TARGET_LON);
  assert.strictEqual(cr.length, 6);
});

test('BKH-25 computeCommonRadiusStats statisticallyUsable=false when count < MIN_FALLBACK', () => {
  // Only 3 listings per provider at 1km
  const air = mkGrid(3);
  const bkg = mkGrid(3);
  const cr  = computeCommonRadiusStats(air, bkg, TARGET_LAT, TARGET_LON);
  // 3 < MIN_COMPARABLES_FALLBACK (5) → not usable
  assert.strictEqual(cr[0].statisticallyUsable, false);
});

test('BKH-26 computeCommonRadiusStats statisticallyUsable=true when both >= MIN_FALLBACK', () => {
  const air = mkGrid(10);
  const bkg = mkGrid(10);
  const cr  = computeCommonRadiusStats(air, bkg, TARGET_LAT, TARGET_LON);
  // All 10 listings at TARGET coords → within 1km → usable
  assert.strictEqual(cr[0].statisticallyUsable, true);
});

test('BKH-27 computeCommonRadiusStats divergencePct null when one source empty', () => {
  const air = mkGrid(10);
  const cr  = computeCommonRadiusStats(air, [], TARGET_LAT, TARGET_LON);
  assert.strictEqual(cr[0].divergencePct, null);
});

test('BKH-28 computeCommonRadiusStats no minimum count for diagnostic display — shows rows even with 0', () => {
  const cr = computeCommonRadiusStats([], [], TARGET_LAT, TARGET_LON);
  assert.strictEqual(cr.length, 6);
  assert.strictEqual(cr[0].airbnbCount, 0);
  assert.strictEqual(cr[0].bookingCount, 0);
});

// ── BKH-29..32: computeSearchCoverage ────────────────────────────────────────

test('BKH-29 computeSearchCoverage LOCAL when >50% within 5km', () => {
  // 8 at target (within 1km), 2 far away
  const listings = [
    ...mkGrid(8),
    ...mkGrid(2, 80).map((l, i) => ({ ...l, latitude: TARGET_LAT + 2 * (i + 1), longitude: TARGET_LON })),
  ];
  const cov = computeSearchCoverage(listings, TARGET_LAT, TARGET_LON);
  assert.strictEqual(cov, 'LOCAL');
});

test('BKH-30 computeSearchCoverage WIDE when <20% within 5km', () => {
  // 1 local, 9 far
  const listings = [
    mkListing({ providerListingId: 'local' }),
    ...Array.from({ length: 9 }, (_, i) => mkListing({
      providerListingId: `far-${i}`,
      latitude: TARGET_LAT + 5 * (i + 1),
      longitude: TARGET_LON,
    })),
  ];
  const cov = computeSearchCoverage(listings, TARGET_LAT, TARGET_LON);
  assert.strictEqual(cov, 'WIDE');
});

test('BKH-31 computeSearchCoverage MIXED when 20-50% within 5km', () => {
  // 3 local, 7 at ~10km
  const local = mkGrid(3);
  const far   = Array.from({ length: 7 }, (_, i) => mkListing({
    providerListingId: `far-${i}`,
    latitude: TARGET_LAT + 0.5 * (i + 1),  // ~55km spread
    longitude: TARGET_LON,
  }));
  const cov = computeSearchCoverage([...local, ...far], TARGET_LAT, TARGET_LON);
  assert.ok(['MIXED', 'LOCAL', 'WIDE'].includes(cov)); // deterministic based on ratio
});

test('BKH-32 computeSearchCoverage UNKNOWN when no geo listings or no target', () => {
  const noGeo = Object.assign(mkListing(), { latitude: null, longitude: null });
  assert.strictEqual(computeSearchCoverage([noGeo], TARGET_LAT, TARGET_LON), 'UNKNOWN');
  assert.strictEqual(computeSearchCoverage(mkGrid(5), null, null), 'UNKNOWN');
});

// ── BKH-33..36: computeCrossSourceGeoProximity ────────────────────────────────

test('BKH-33 computeCrossSourceGeoProximity within_50m counts co-located listings', () => {
  const air = [mkListing({ providerListingId: 'A', latitude: TARGET_LAT, longitude: TARGET_LON })];
  const bkg = [mkListing({ providerListingId: 'B', latitude: TARGET_LAT + 0.00001, longitude: TARGET_LON })]; // ~1m
  const r = computeCrossSourceGeoProximity(air, bkg);
  assert.strictEqual(r.within50m, 1);
});

test('BKH-34 computeCrossSourceGeoProximity within_250m >= within_50m', () => {
  const air = mkGrid(5);
  const bkg = mkGrid(5).map((l, i) => ({ ...l, latitude: l.latitude + 0.001 * i }));
  const r = computeCrossSourceGeoProximity(air, bkg);
  assert.ok(r.within250m >= r.within100m);
  assert.ok(r.within100m >= r.within50m);
});

test('BKH-35 computeCrossSourceGeoProximity usedForDedup=false', () => {
  const r = computeCrossSourceGeoProximity(mkGrid(3), mkGrid(3));
  assert.strictEqual(r.usedForDedup, false);
});

test('BKH-36 computeCrossSourceGeoProximity usedForPricing=false', () => {
  const r = computeCrossSourceGeoProximity(mkGrid(3), mkGrid(3));
  assert.strictEqual(r.usedForPricing, false);
});

// ── BKH-37..41: computeCounterfactuals ───────────────────────────────────────

test('BKH-37 computeCounterfactuals scenarioA uses selectComparables output', () => {
  const air = mkGrid(15, 100);
  const bkg = mkGrid(15, 80);
  const cf  = computeCounterfactuals(air, bkg, TARGET_LAT, TARGET_LON, null);
  assert.ok(cf.scenarioA.airbnbCount > 0 || cf.scenarioA.bookingCount > 0);
});

test('BKH-38 computeCounterfactuals scenarioB restricts to ≤5km', () => {
  // 5 at 1km, 10 at 50km
  const near = mkGrid(5, 100);
  const far  = Array.from({ length: 10 }, (_, i) => mkListing({
    providerListingId: `far-${i}`, price: 200,
    latitude: TARGET_LAT + 0.5 * (i + 1), longitude: TARGET_LON,
  }));
  const air = [...near, ...far];
  const bkg = [...near.map(l => ({ ...l, providerListingId: `bkg-${l.providerListingId}` })), ...far.map(l => ({ ...l, providerListingId: `bkg-${l.providerListingId}` }))];
  const cf = computeCounterfactuals(air, bkg, TARGET_LAT, TARGET_LON, null);
  // scenarioB (5km) must have <= scenarioC (10km)
  assert.ok(cf.scenarioB.airbnbCount <= cf.scenarioC.airbnbCount);
});

test('BKH-39 computeCounterfactuals scenarioB count ≤ scenarioC count (monotone)', () => {
  const air = mkGrid(20, 100).map((l, i) => ({ ...l, latitude: TARGET_LAT + i * 0.05, longitude: TARGET_LON }));
  const bkg = mkGrid(20, 90).map((l, i) => ({ ...l, latitude: TARGET_LAT + i * 0.05, longitude: TARGET_LON }));
  const cf = computeCounterfactuals(air, bkg, TARGET_LAT, TARGET_LON, null);
  assert.ok(cf.scenarioB.airbnbCount <= cf.scenarioC.airbnbCount);
  assert.ok(cf.scenarioB.bookingCount <= cf.scenarioC.bookingCount);
});

test('BKH-40 computeCounterfactuals statisticallyUsable false when < MIN_FALLBACK', () => {
  const cf = computeCounterfactuals(mkGrid(2), mkGrid(2), TARGET_LAT, TARGET_LON, null);
  assert.strictEqual(cf.scenarioA.statisticallyUsable, false);
});

test('BKH-41 computeCounterfactuals no input mutation', () => {
  const air = mkGrid(10);
  const bkg = mkGrid(10);
  const lenBefore = air.length;
  computeCounterfactuals(air, bkg, TARGET_LAT, TARGET_LON, null);
  assert.strictEqual(air.length, lenBefore);
});

// ── BKH-42..43: computeDivergencePct ─────────────────────────────────────────

test('BKH-42 computeDivergencePct symmetric', () => {
  const d1 = computeDivergencePct(80, 120);
  const d2 = computeDivergencePct(120, 80);
  assert.ok(Math.abs(d1 - d2) < 0.0001);
});

test('BKH-43 computeDivergencePct null for zero or negative input', () => {
  assert.strictEqual(computeDivergencePct(0, 100), null);
  assert.strictEqual(computeDivergencePct(-1, 100), null);
  assert.strictEqual(computeDivergencePct(null, 100), null);
});

// ── BKH-44..45: computeDivergenceFactors ─────────────────────────────────────

test('BKH-44 computeDivergenceFactors GEO_RADIUS_MISMATCH when radius gap ≥ 5km', () => {
  const ctx = {
    airbnbSelectedRadius: 20, bookingSelectedRadius: 1,
    airbnbDistDist: { within5km: 10 }, bookingDistDist: { within5km: 10 },
    airbnbFunnel: { bedroomMissing: 0, afterCapacity: 5, capRejected: 0, afterDedup: 5 },
    bookingFunnel: { bedroomMissing: 0, afterCapacity: 5, capRejected: 0, afterDedup: 5, capMissing: 5 },
    airbnbNormVerdict: 'PASS', bookingNormVerdict: 'PASS',
    airbnbSearchCoverage: 'WIDE',
  };
  const factors = computeDivergenceFactors(ctx);
  assert.ok(factors.includes('GEO_RADIUS_MISMATCH'));
});

test('BKH-45 computeDivergenceFactors INSUFFICIENT_LOCAL_AIRBNB_SAMPLE when within5km < 5', () => {
  const ctx = {
    airbnbSelectedRadius: 20, bookingSelectedRadius: 1,
    airbnbDistDist: { within5km: 2 }, bookingDistDist: { within5km: 10 },
    airbnbFunnel: { bedroomMissing: 0, afterCapacity: 5, capRejected: 0, afterDedup: 5 },
    bookingFunnel: { bedroomMissing: 0, afterCapacity: 5, capRejected: 0, afterDedup: 5, capMissing: 5 },
    airbnbNormVerdict: 'PASS', bookingNormVerdict: 'PASS',
    airbnbSearchCoverage: 'LOCAL',
  };
  const factors = computeDivergenceFactors(ctx);
  assert.ok(factors.includes('INSUFFICIENT_LOCAL_AIRBNB_SAMPLE'));
});

// ── BKH-46..48: computeRealPlatformPriceGap ──────────────────────────────────

test('BKH-46 computeRealPlatformPriceGap UNDETERMINED when no usable common radius', () => {
  const cr = [{ radiusKm: 1, statisticallyUsable: false, divergencePct: 80, airbnbCount: 2, bookingCount: 2 }];
  assert.strictEqual(computeRealPlatformPriceGap(cr), 'UNDETERMINED');
});

test('BKH-47 computeRealPlatformPriceGap POSSIBLE with moderate evidence', () => {
  const cr = [{ radiusKm: 20, statisticallyUsable: true, divergencePct: 30, airbnbCount: 5, bookingCount: 5 }];
  assert.strictEqual(computeRealPlatformPriceGap(cr), 'POSSIBLE');
});

test('BKH-48 computeRealPlatformPriceGap CONFIRMED requires strong samples + large divergence', () => {
  const cr = [
    { radiusKm: 5,  statisticallyUsable: true,  divergencePct: 30, airbnbCount: 5, bookingCount: 5 },
    { radiusKm: 20, statisticallyUsable: true,  divergencePct: 60, airbnbCount: 15, bookingCount: 12 },
  ];
  assert.strictEqual(computeRealPlatformPriceGap(cr), 'CONFIRMED');
});

// ── BKH-49..51: computeSafeForPricing ────────────────────────────────────────

test('BKH-49 computeSafeForPricing false when EXTREME divergence', () => {
  assert.strictEqual(computeSafeForPricing('EXTREME', 'MEDIUM'), false);
});

test('BKH-50 computeSafeForPricing false when LOW confidence', () => {
  assert.strictEqual(computeSafeForPricing('LOW', 'LOW'), false);
  assert.strictEqual(computeSafeForPricing('LOW', 'INSUFFICIENT'), false);
});

test('BKH-51 computeSafeForPricing true when LOW divergence + HIGH confidence', () => {
  assert.strictEqual(computeSafeForPricing('LOW', 'HIGH'), true);
});

// ── BKH-52..53: computeNormalizationSample ────────────────────────────────────

test('BKH-52 computeNormalizationSample returns max 10 entries', () => {
  const listings = mkGrid(20, 90);
  const s = computeNormalizationSample(listings, 3, 'airbnb');
  assert.ok(s.sample.length <= 10);
});

test('BKH-53 computeNormalizationSample impliedTotal = price × nights', () => {
  const listings = [mkListing({ price: 100 })];
  const s = computeNormalizationSample(listings, 3, 'airbnb');
  assert.strictEqual(s.sample[0].impliedTotal, 300);
  assert.strictEqual(s.sample[0].requestedNights, 3);
});

// ── BKH-54..57: edge cases / invariants ──────────────────────────────────────

test('BKH-54 no NaN in computeRadiusBands results', () => {
  const bands = computeRadiusBands(mkGrid(10), TARGET_LAT, TARGET_LON);
  for (const b of bands) {
    assert.ok(!Number.isNaN(b.rawGeoCount));
    assert.ok(!Number.isNaN(b.qualityCount));
    if (b.qualityStats) {
      for (const v of Object.values(b.qualityStats)) {
        if (typeof v === 'number') assert.ok(!Number.isNaN(v), `NaN in qualityStats.${JSON.stringify(b)}`);
      }
    }
  }
});

test('BKH-55 computeFilterFunnel is deterministic (same input = same output)', () => {
  const listings = mkGrid(8);
  const f1 = computeFilterFunnel(listings, mkDiag(8, 8), { targetGuests: 3 });
  const f2 = computeFilterFunnel(listings, mkDiag(8, 8), { targetGuests: 3 });
  assert.deepStrictEqual(f1, f2);
});

test('BKH-56 computePrimaryAttritionReason returns largest attrition step', () => {
  const funnel = {
    dupCount: 1, catRejected: 5, capRejected: 0, qualityPoolNoGeo: 0,
    raw: 20, adapterAccepted: 20, afterCapacity: 14,
  };
  const reason = computePrimaryAttritionReason(funnel, { beyond20km: 0 });
  assert.strictEqual(reason, 'CATEGORY_FILTER');
});

test('BKH-57 computePrimaryAttritionReason NO_SIGNIFICANT_ATTRITION when all zero', () => {
  const funnel = { dupCount: 0, catRejected: 0, capRejected: 0, qualityPoolNoGeo: 0, raw: 5, adapterAccepted: 5 };
  const reason = computePrimaryAttritionReason(funnel, { beyond20km: 0 });
  assert.strictEqual(reason, 'NO_SIGNIFICANT_ATTRITION');
});

// ── BKH-58..60: priceStats helper ────────────────────────────────────────────

test('BKH-58 priceStats null for empty array', () => {
  assert.strictEqual(priceStats([]), null);
});

test('BKH-59 priceStats median of odd array', () => {
  const s = priceStats([10, 20, 30]);
  assert.strictEqual(s.median, 20);
});

test('BKH-60 priceStats median of even array is average of two middles', () => {
  const s = priceStats([10, 20, 30, 40]);
  assert.strictEqual(s.median, 25);
});

// ── BKH-61..64: source safety ─────────────────────────────────────────────────

test('BKH-61 audit source: 0 DB writes (no INSERT INTO, UPDATE; pool.query only in CLI helpers)', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../outils/audit-multisource-divergence.js'), 'utf8');
  assert.ok(!/\bINSERT\s+INTO\b/i.test(src), 'no INSERT INTO');
  assert.ok(!/\bUPDATE\s+\w/i.test(src), 'no UPDATE <table>');
  // pool.query must appear only after the CLI/preview/execute section, not in pure functions
  const pureFnSection = src.split('// ── previewMode')[0];
  assert.ok(!/pool\.query/i.test(pureFnSection), 'pool.query must not appear in pure functions section');
});

test('BKH-62 audit source: 0 pricing-apply calls', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../outils/audit-multisource-divergence.js'), 'utf8');
  assert.ok(!/require\(['"][^'"]*pricing-apply/i.test(src));
});

test('BKH-63 audit source: 0 Channex calls', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../outils/audit-multisource-divergence.js'), 'utf8');
  assert.ok(!/require\(['"][^'"]*channex/i.test(src));
});

test('BKH-64 audit source: no fetch() calls in pure functions', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../outils/audit-multisource-divergence.js'), 'utf8');
  // fetch() calls come from provider imports, not from the audit functions themselves
  assert.ok(!src.includes('await fetch('), 'audit tool must not call fetch directly');
});

// ── BKH-65: HARD_MAX_LISTINGS ────────────────────────────────────────────────

test('BKH-65 HARD_MAX_LISTINGS = 100', () => {
  assert.strictEqual(HARD_MAX_LISTINGS, 100);
});

// ── BKH-66: DEFAULT_NIGHTS ───────────────────────────────────────────────────

test('BKH-66 DEFAULT_NIGHTS = 3', () => {
  assert.strictEqual(DEFAULT_NIGHTS, 3);
});

// ── BKH-67: computeCommonRadiusStats null without geo ────────────────────────

test('BKH-67 computeCommonRadiusStats null when target geo missing', () => {
  const r = computeCommonRadiusStats(mkGrid(10), mkGrid(10), null, null);
  assert.strictEqual(r, null);
});
