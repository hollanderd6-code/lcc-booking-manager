'use strict';
/**
 * P1.2-B5-BK-I — Cross-Source Comparability Tests
 *
 * Covers:
 *   - bookingCategoryCompatible (compatible/incompatible/null)
 *   - bookingBedroomFilter (tiered policy: exact / exact+missing / fail_open)
 *   - buildCrossSourceQualityPool (airbnb: cat+cap; booking: cat+bedroom)
 *   - computeMetadataScore (Airbnb vs Booking baseline + bonus)
 *   - selectCommonComparisonRadius (smallest viable common radius)
 *   - computeCrossSourceDivergenceLevel (calibrated thresholds 15/30/50)
 *   - aggregateMarketSourcesCalibrated (dual, single, metadata quality, market signal)
 *   - Safety (no DB writes, no pricing writes, no Channex, no env var logging)
 */

const assert = require('assert');
const test   = require('node:test');

const {
  bookingCategoryCompatible,
  bookingBedroomFilter,
  buildCrossSourceQualityPool,
  computeMetadataScore,
  selectCommonComparisonRadius,
  computeCrossSourceDivergenceLevel,
  CROSS_SOURCE_DIVERGENCE_LOW,
  CROSS_SOURCE_DIVERGENCE_MODERATE,
  CROSS_SOURCE_DIVERGENCE_HIGH,
  BOOKING_COMPATIBLE_CATEGORIES,
  BOOKING_INCOMPATIBLE_CATEGORIES,
} = require('../services/market-cross-source-policy');

const {
  aggregateMarketSourcesCalibrated,
  qualityScoreCalibrated,
  isSourceValid,
} = require('../services/market-multi-source-aggregator');

// ── Helpers ───────────────────────────────────────────────────────────────────

let _listingId = 0;
function mkListing(overrides = {}) {
  _listingId++;
  return {
    providerListingId:  `id-${_listingId}`,
    latitude:           48.725,
    longitude:          2.258,
    category:           'apartment',
    guests:             4,
    bedrooms:           2,
    nightly_price:      100,
    currency:           'EUR',
    ...overrides,
  };
}

function makeAirbnbStats({ median = 100, p25 = 75, p75 = 130, occupancy = 60 } = {}) {
  return {
    median, p25, p75,
    occupancy, occupancy_semantics: 'calendar_unavailability_proxy',
    tensionLevel: 'normal', count: 10,
  };
}

function makeBookingStats({ median = 95, p25 = 70, p75 = 125 } = {}) {
  return {
    median, p25, p75,
    occupancy: null, occupancy_semantics: 'unavailable',
    tensionLevel: null, count: 10,
  };
}

function makeSource(stats, comparableCount = 8, selectedRadiusKm = 2, metadataScore = null) {
  return { stats, comparableCount, selectedRadiusKm, metadataScore };
}

// ── BKI-01..05: bookingCategoryCompatible ─────────────────────────────────────

test('BKI-01 bookingCategoryCompatible: apartment/villa/cottage → true for entire_place', () => {
  assert.strictEqual(bookingCategoryCompatible('apartment',   'entire_place'), true);
  assert.strictEqual(bookingCategoryCompatible('villa',       'entire_place'), true);
  assert.strictEqual(bookingCategoryCompatible('cottage',     'entire_place'), true);
  assert.strictEqual(bookingCategoryCompatible('holiday home','entire_place'), true);
  assert.strictEqual(bookingCategoryCompatible('aparthotel',  'entire_place'), true);
});

test('BKI-02 bookingCategoryCompatible: hostel/hotel/guesthouse → false for entire_place', () => {
  assert.strictEqual(bookingCategoryCompatible('hostel',     'entire_place'), false);
  assert.strictEqual(bookingCategoryCompatible('hotel',      'entire_place'), false);
  assert.strictEqual(bookingCategoryCompatible('guest house','entire_place'), false);
  assert.strictEqual(bookingCategoryCompatible('guesthouse', 'entire_place'), false);
  assert.strictEqual(bookingCategoryCompatible('b&b',        'entire_place'), false);
});

test('BKI-03 bookingCategoryCompatible: null category → null (keep conservatively)', () => {
  assert.strictEqual(bookingCategoryCompatible(null, 'entire_place'), null);
  assert.strictEqual(bookingCategoryCompatible(undefined, 'entire_place'), null);
});

test('BKI-04 bookingCategoryCompatible: no target type → always true', () => {
  assert.strictEqual(bookingCategoryCompatible('hostel', null),        true);
  assert.strictEqual(bookingCategoryCompatible('hostel', undefined),   true);
  assert.strictEqual(bookingCategoryCompatible(null,     null),        true);
});

test('BKI-05 bookingCategoryCompatible: case-insensitive, whitespace-trimmed', () => {
  assert.strictEqual(bookingCategoryCompatible('  APARTMENT  ', 'entire_place'), true);
  assert.strictEqual(bookingCategoryCompatible('HOTEL',         'entire_place'), false);
  assert.strictEqual(bookingCategoryCompatible('Holiday Home',  'entire_place'), true);
});

// ── BKI-06..10: bookingBedroomFilter ─────────────────────────────────────────

test('BKI-06 bookingBedroomFilter: no target → policy=no_target_bedrooms, all listings kept', () => {
  const listings = [mkListing({ bedrooms: 1 }), mkListing({ bedrooms: 2 }), mkListing({ bedrooms: null })];
  const r = bookingBedroomFilter(listings, null);
  assert.strictEqual(r.policy, 'no_target_bedrooms');
  assert.strictEqual(r.listings.length, 3);
  assert.strictEqual(r.rejectedCount, 0);
});

test('BKI-07 bookingBedroomFilter: enough exact matches → policy=exact_match', () => {
  const listings = [
    mkListing({ bedrooms: 2 }), mkListing({ bedrooms: 2 }), mkListing({ bedrooms: 2 }),
    mkListing({ bedrooms: 2 }), mkListing({ bedrooms: 2 }), // 5 exact
    mkListing({ bedrooms: 3 }), mkListing({ bedrooms: null }),
  ];
  const r = bookingBedroomFilter(listings, 2);
  assert.strictEqual(r.policy, 'exact_match');
  assert.strictEqual(r.listings.length, 5);
  assert.strictEqual(r.rejectedCount, 1); // bedroom=3 rejected
});

test('BKI-08 bookingBedroomFilter: exact < 5 but exact+missing >= 5 → policy=exact_plus_missing', () => {
  const listings = [
    mkListing({ bedrooms: 2 }), mkListing({ bedrooms: 2 }), // 2 exact
    mkListing({ bedrooms: null }), mkListing({ bedrooms: null }), mkListing({ bedrooms: null }), // 3 missing
    mkListing({ bedrooms: 3 }), // wrong
  ];
  const r = bookingBedroomFilter(listings, 2);
  assert.strictEqual(r.policy, 'exact_plus_missing');
  assert.strictEqual(r.listings.length, 5);
  assert.strictEqual(r.rejectedCount, 1);
});

test('BKI-09 bookingBedroomFilter: not enough exact or exact+missing → policy=fail_open', () => {
  const listings = [
    mkListing({ bedrooms: 2 }), mkListing({ bedrooms: null }),
    mkListing({ bedrooms: 3 }), mkListing({ bedrooms: 3 }), mkListing({ bedrooms: 3 }),
  ];
  const r = bookingBedroomFilter(listings, 2);
  assert.strictEqual(r.policy, 'fail_open');
  assert.strictEqual(r.listings.length, 5); // all kept
});

test('BKI-10 bookingBedroomFilter: missing bedrooms never treated as mismatch', () => {
  const listings = [mkListing({ bedrooms: null }), mkListing({ bedrooms: null }), mkListing({ bedrooms: null })];
  const r = bookingBedroomFilter(listings, 2);
  // exact=0, missing=3 → combined=3 < 5 → fail_open
  assert.strictEqual(r.policy, 'fail_open');
  assert.strictEqual(r.listings.length, 3);
  assert.strictEqual(r.rejectedCount, 0); // null is not rejected
});

// ── BKI-11..15: buildCrossSourceQualityPool ───────────────────────────────────

test('BKI-11 buildCrossSourceQualityPool airbnb: applies dedup + category + capacity', () => {
  const listings = [
    mkListing({ providerListingId: 'a1', category: 'apartment', guests: 4 }),
    mkListing({ providerListingId: 'a1', category: 'apartment', guests: 4 }), // duplicate
    mkListing({ providerListingId: 'a2', category: 'hostel',    guests: 4 }), // incompatible cat
    mkListing({ providerListingId: 'a3', category: 'apartment', guests: 10 }), // too many guests
    mkListing({ providerListingId: 'a4', category: 'apartment', guests: 4 }),
  ];
  const r = buildCrossSourceQualityPool(listings, 'airbnb', { targetGuests: 4, targetPropertyType: 'entire_place' });
  // kept: a1 (deduped), a4; a1 dup rejected, a2 cat rejected, a3 cap rejected
  assert.ok(r.diagnostics.dedupRejected >= 1);
  assert.ok(r.diagnostics.catRejected >= 1);
  assert.ok(r.diagnostics.capRejected >= 1);
  assert.ok(r.listings.length <= 3);
});

test('BKI-12 buildCrossSourceQualityPool airbnb: bedroom filter NOT APPLIED', () => {
  const listings = [mkListing({ bedrooms: 1 }), mkListing({ bedrooms: 3 }), mkListing({ bedrooms: null })];
  const r = buildCrossSourceQualityPool(listings, 'airbnb', { targetBedrooms: 2 });
  assert.ok(r.diagnostics.bedroomNote.includes('FILTER_NOT_APPLIED'));
  assert.strictEqual(r.listings.length, 3); // no bedroom rejection
});

test('BKI-13 buildCrossSourceQualityPool booking: applies dedup + category + bedroom', () => {
  const listings = [
    mkListing({ providerListingId: 'b1', category: 'apartment', bedrooms: 2 }),
    mkListing({ providerListingId: 'b2', category: 'hotel',     bedrooms: 2 }), // incompatible
    mkListing({ providerListingId: 'b3', category: 'apartment', bedrooms: 2 }),
    mkListing({ providerListingId: 'b4', category: 'apartment', bedrooms: 2 }),
    mkListing({ providerListingId: 'b5', category: 'apartment', bedrooms: 2 }),
    mkListing({ providerListingId: 'b6', category: 'apartment', bedrooms: 2 }),
  ];
  const r = buildCrossSourceQualityPool(listings, 'booking', { targetBedrooms: 2, targetPropertyType: 'entire_place' });
  assert.ok(r.diagnostics.catRejected >= 1);
  assert.ok(r.diagnostics.bedroomPolicy !== undefined);
  assert.ok(r.listings.length <= 5);
});

test('BKI-14 buildCrossSourceQualityPool booking: capacity filter NOT APPLIED', () => {
  const listings = [mkListing({ guests: 2 }), mkListing({ guests: 8 }), mkListing({ guests: null })];
  const r = buildCrossSourceQualityPool(listings, 'booking', {});
  assert.ok(r.diagnostics.capacityNote.includes('FILTER_NOT_APPLIED'));
});

test('BKI-15 buildCrossSourceQualityPool: unknown provider throws', () => {
  assert.throws(
    () => buildCrossSourceQualityPool([], 'unknown', {}),
    /unknown provider/i
  );
});

// ── BKI-16..18: computeMetadataScore ─────────────────────────────────────────

test('BKI-16 computeMetadataScore airbnb: baseline 0.85, bonus when guests present', () => {
  const withGuests = [mkListing({ guests: 4 }), mkListing({ guests: 3 })]; // 100% guest pct
  const noGuests   = [mkListing({ guests: null }), mkListing({ guests: null })]; // 0% guest pct

  const s1 = computeMetadataScore(withGuests, 'airbnb');
  const s2 = computeMetadataScore(noGuests,   'airbnb');
  assert.ok(s1 > s2);
  assert.strictEqual(s1, 0.85 + 0.10 * 1.0); // 0.95
  assert.strictEqual(s2, 0.85 + 0.10 * 0.0); // 0.85
});

test('BKI-17 computeMetadataScore booking: baseline 0.85, bonus when bedrooms present', () => {
  const withBedrooms = [mkListing({ bedrooms: 2 }), mkListing({ bedrooms: 2 })]; // 100%
  const noBedrooms   = [mkListing({ bedrooms: null }), mkListing({ bedrooms: null })]; // 0%

  const s1 = computeMetadataScore(withBedrooms, 'booking');
  const s2 = computeMetadataScore(noBedrooms,   'booking');
  assert.ok(s1 > s2);
  assert.strictEqual(s1, 0.95);
  assert.strictEqual(s2, 0.85);
});

test('BKI-18 computeMetadataScore: empty pool → 0', () => {
  assert.strictEqual(computeMetadataScore([], 'airbnb'),  0);
  assert.strictEqual(computeMetadataScore([], 'booking'), 0);
});

// ── BKI-19..23: selectCommonComparisonRadius ──────────────────────────────────

// Build radius-positioned listings for a known center (48.725, 2.258 = Massy area)
function mkAtKm(km, idPrefix, n) {
  // Place listings slightly north of center at ≈km distance
  // 1 deg lat ≈ 111 km
  const latOffset = km / 111;
  return Array.from({ length: n }, (_, i) => mkListing({
    providerListingId: `${idPrefix}-${i}`,
    latitude:  48.725 + latOffset * (0.8 + 0.04 * i),
    longitude: 2.258,
  }));
}

test('BKI-19 selectCommonComparisonRadius: selects smallest radius where both >= 5', () => {
  // Airbnb: 5 listings within 1km, Booking: only 2 within 1km but 6 within 2km
  const airbnbListings  = mkAtKm(0.5, 'a', 5);  // 5 listings within 1km
  const bookingListings = [
    ...mkAtKm(0.5, 'b', 2),  // 2 within 1km
    ...mkAtKm(1.5, 'c', 4),  // 4 within 2km (total 6 at 2km)
  ];

  const r = selectCommonComparisonRadius(
    { listings: airbnbListings },
    { listings: bookingListings },
    48.725, 2.258,
    {}
  );
  // At 1km: airbnb=5 >= 5, booking=2 < 5 → not viable
  // At 2km: airbnb=5 >= 5, booking=6 >= 5 → viable → selected
  assert.strictEqual(r.found, true);
  assert.ok(r.radiusKm <= 2);
  assert.ok(r.airbnbCount  >= 5);
  assert.ok(r.bookingCount >= 5);
});

test('BKI-20 selectCommonComparisonRadius: both sources need minimum at common radius', () => {
  // Booking listings are placed far beyond the 20km max band → no viable common radius
  const airbnbListings  = mkAtKm(0.5, 'a', 5);  // near center (within 1km)
  const bookingListings = mkAtKm(25, 'b', 5);    // ~25km away — beyond all bands (max is 20km)

  const r = selectCommonComparisonRadius(
    { listings: airbnbListings },
    { listings: bookingListings },
    48.725, 2.258,
    {}
  );
  assert.strictEqual(r.found, false);
  assert.strictEqual(r.radiusKm, null);
  assert.strictEqual(r.reason, 'no_common_radius');
});

test('BKI-21 selectCommonComparisonRadius: no geo → falls back to quality pool', () => {
  const listings = Array.from({ length: 6 }, (_, i) => mkListing({ providerListingId: `x${i}` }));
  const r = selectCommonComparisonRadius(
    { listings },
    { listings },
    null, null,  // no coordinates
    {}
  );
  assert.ok(r.radiusKm == null);
  // Found depends on counts
  const expectedFound = r.airbnbCount >= 5 && r.bookingCount >= 5;
  assert.strictEqual(r.found, expectedFound);
});

test('BKI-22 selectCommonComparisonRadius: strips _dist from returned listings', () => {
  const listings = mkAtKm(0.5, 'strip', 5);
  const r = selectCommonComparisonRadius(
    { listings },
    { listings },
    48.725, 2.258, {}
  );
  if (r.found) {
    for (const l of [...r.airbnbListings, ...r.bookingListings]) {
      assert.ok(!('_dist' in l), 'listings should not contain _dist');
    }
  }
});

test('BKI-23 selectCommonComparisonRadius: includes per-source diagnostics in result', () => {
  const listings = mkAtKm(0.5, 'diag', 6);
  const r = selectCommonComparisonRadius(
    { listings },
    { listings },
    48.725, 2.258, {}
  );
  assert.ok(r.airbnbDiagnostics  != null);
  assert.ok(r.bookingDiagnostics != null);
});

// ── BKI-24..27: computeCrossSourceDivergenceLevel ────────────────────────────

test('BKI-24 computeCrossSourceDivergenceLevel: null → null', () => {
  assert.strictEqual(computeCrossSourceDivergenceLevel(null), null);
});

test('BKI-25 computeCrossSourceDivergenceLevel: < 15 → LOW', () => {
  assert.strictEqual(computeCrossSourceDivergenceLevel(0),  'LOW');
  assert.strictEqual(computeCrossSourceDivergenceLevel(10), 'LOW');
  assert.strictEqual(computeCrossSourceDivergenceLevel(14.9), 'LOW');
});

test('BKI-26 computeCrossSourceDivergenceLevel: 15..29 → MODERATE', () => {
  assert.strictEqual(computeCrossSourceDivergenceLevel(15), 'MODERATE');
  assert.strictEqual(computeCrossSourceDivergenceLevel(25), 'MODERATE');
  assert.strictEqual(computeCrossSourceDivergenceLevel(29.9), 'MODERATE');
});

test('BKI-27 computeCrossSourceDivergenceLevel: 30..49 → HIGH, ≥ 50 → EXTREME', () => {
  assert.strictEqual(computeCrossSourceDivergenceLevel(30),  'HIGH');
  assert.strictEqual(computeCrossSourceDivergenceLevel(49.9),'HIGH');
  assert.strictEqual(computeCrossSourceDivergenceLevel(50),  'EXTREME');
  assert.strictEqual(computeCrossSourceDivergenceLevel(80),  'EXTREME');
});

// ── BKI-28..30: qualityScoreCalibrated ───────────────────────────────────────

test('BKI-28 qualityScoreCalibrated: multiplies countScore × radiusScore × metadataScore', () => {
  // countScore(10)=0.90, radiusScore(2)=0.95, metadataScore=0.85
  const expected = 0.90 * 0.95 * 0.85;
  const result   = qualityScoreCalibrated(10, 2, 0.85);
  assert.ok(Math.abs(result - expected) < 1e-9);
});

test('BKI-29 qualityScoreCalibrated: null metadataScore → defaults to 1.0', () => {
  const withNull    = qualityScoreCalibrated(10, 2, null);
  const withDefault = qualityScoreCalibrated(10, 2, 1.0);
  assert.strictEqual(withNull, withDefault);
});

test('BKI-30 qualityScoreCalibrated: metadataScore = 0.85 < 1.0 → quality lower than qualityScore', () => {
  const { qualityScore } = require('../services/market-multi-source-aggregator');
  const base     = qualityScore(10, 2);          // no metadata factor
  const calibrated = qualityScoreCalibrated(10, 2, 0.85);
  assert.ok(calibrated < base);
});

// ── BKI-31..38: aggregateMarketSourcesCalibrated ─────────────────────────────

test('BKI-31 aggregateMarketSourcesCalibrated: dual-source builds calibrated consensus', () => {
  const r = aggregateMarketSourcesCalibrated({
    airbnb:  makeSource(makeAirbnbStats({ median: 120 }), 8, 2, 0.90),
    booking: makeSource(makeBookingStats({ median: 110 }), 7, 2, 0.95),
    commonRadiusKm: 2,
  });
  assert.strictEqual(r.consensus !== null, true);
  const con = r.consensus;
  assert.strictEqual(typeof con.median, 'number');
  assert.strictEqual(con.commonRadiusKm, 2);
  // weights must sum to 1
  assert.ok(Math.abs(con.weights.airbnb + con.weights.booking - 1.0) < 1e-9);
});

test('BKI-32 aggregateMarketSourcesCalibrated: uses calibrated divergence levels', () => {
  // medians 100 vs 110 → div ≈ 9.5% → LOW under calibrated (<15), would be LOW under BKG too
  // Let's test with medians that are between 10%-15% — LOW under calibrated, MODERATE under BKG
  // |100-114| / ((100+114)/2) = 14/107 ≈ 13.08% → calibrated=LOW, original=MODERATE
  const r = aggregateMarketSourcesCalibrated({
    airbnb:  makeSource(makeAirbnbStats({ median: 100, p25: 75, p75: 130 }), 8, 2, 0.90),
    booking: makeSource(makeBookingStats({ median: 114, p25: 80, p75: 150 }), 6, 2, 0.90),
  });
  assert.strictEqual(r.consensus.divergenceLevel, 'LOW'); // calibrated threshold
});

test('BKI-33 aggregateMarketSourcesCalibrated: MODERATE divergence for 15-29%', () => {
  // |100-120| / 110 ≈ 18.2% → calibrated MODERATE
  const r = aggregateMarketSourcesCalibrated({
    airbnb:  makeSource(makeAirbnbStats({ median: 100, p25: 75, p75: 130 }), 8, 2, 0.90),
    booking: makeSource(makeBookingStats({ median: 120, p25: 90, p75: 155 }), 6, 2, 0.90),
  });
  assert.strictEqual(r.consensus.divergenceLevel, 'MODERATE');
});

test('BKI-34 aggregateMarketSourcesCalibrated: metadataScore affects quality and weights', () => {
  // airbnb high metadata, booking low metadata → airbnb should have higher weight
  const airbnbStats  = makeAirbnbStats({ median: 100, p25: 75, p75: 130 });
  const bookingStats = makeBookingStats({ median: 100, p25: 75, p75: 130 });
  const r = aggregateMarketSourcesCalibrated({
    airbnb:  makeSource(airbnbStats,  10, 2, 0.95), // higher metadata
    booking: makeSource(bookingStats, 10, 2, 0.85), // lower metadata
  });
  assert.ok(r.consensus.weights.airbnb > r.consensus.weights.booking);
});

test('BKI-35 aggregateMarketSourcesCalibrated: market signal from Airbnb only', () => {
  const r = aggregateMarketSourcesCalibrated({
    airbnb:  makeSource(makeAirbnbStats({ occupancy: 70 }), 8, 2, 0.90),
    booking: makeSource(makeBookingStats(), 7, 2, 0.90),
  });
  assert.strictEqual(r.marketSignal.source, 'airbnb');
  assert.strictEqual(r.marketSignal.occupancy, 70);
  assert.strictEqual(r.marketSignal.occupancy_semantics, 'calendar_unavailability_proxy');
});

test('BKI-36 aggregateMarketSourcesCalibrated: Booking occupancy never in market signal', () => {
  // Even if booking source is valid, its occupancy must not appear in marketSignal
  const bookingStatsWithOccupancy = {
    median: 100, p25: 75, p75: 130,
    occupancy: 80,                    // should be ignored
    occupancy_semantics: 'unavailable',
    tensionLevel: null,
  };
  const r = aggregateMarketSourcesCalibrated({
    airbnb:  null, // no Airbnb
    booking: makeSource(bookingStatsWithOccupancy, 8, 2, 0.90),
  });
  assert.strictEqual(r.marketSignal.source,    null);
  assert.strictEqual(r.marketSignal.occupancy, null);
});

test('BKI-37 aggregateMarketSourcesCalibrated: single valid source → LOW confidence', () => {
  const r = aggregateMarketSourcesCalibrated({
    airbnb:  makeSource(makeAirbnbStats(), 8, 2, 0.90),
    booking: null,
  });
  assert.strictEqual(r.consensus.confidenceLevel, 'LOW');
  assert.strictEqual(r.consensus.weights.airbnb,  1.00);
  assert.strictEqual(r.consensus.weights.booking, 0.00);
});

test('BKI-38 aggregateMarketSourcesCalibrated: null inputs → INSUFFICIENT confidence', () => {
  const r = aggregateMarketSourcesCalibrated({});
  assert.strictEqual(r.consensus, null);
  assert.strictEqual(r.diagnostics.validSourceCount, 0);
  assert.strictEqual(r.marketSignal.source, null);
});

// ── BKI-39..41: diagnostics fields ───────────────────────────────────────────

test('BKI-39 aggregateMarketSourcesCalibrated: diagnostics includes metadataScore fields', () => {
  const r = aggregateMarketSourcesCalibrated({
    airbnb:  makeSource(makeAirbnbStats(), 8, 2, 0.88),
    booking: makeSource(makeBookingStats(), 7, 2, 0.93),
  });
  assert.strictEqual(r.diagnostics.airbnbMetadataScore,  0.88);
  assert.strictEqual(r.diagnostics.bookingMetadataScore, 0.93);
  assert.strictEqual(r.diagnostics.calibrated, true);
});

test('BKI-40 aggregateMarketSourcesCalibrated: consensus includes commonRadiusKm', () => {
  const r = aggregateMarketSourcesCalibrated({
    airbnb:  makeSource(makeAirbnbStats(), 8, 2, 0.90),
    booking: makeSource(makeBookingStats(), 7, 2, 0.90),
    commonRadiusKm: 3,
  });
  assert.strictEqual(r.consensus.commonRadiusKm, 3);
});

test('BKI-41 aggregateMarketSourcesCalibrated: sources summary includes metadataScore', () => {
  const r = aggregateMarketSourcesCalibrated({
    airbnb:  makeSource(makeAirbnbStats(), 8, 2, 0.92),
    booking: makeSource(makeBookingStats(), 7, 2, 0.87),
  });
  assert.strictEqual(r.sources.airbnb.metadataScore,  0.92);
  assert.strictEqual(r.sources.booking.metadataScore, 0.87);
});

// ── BKI-42..44: isSourceValid unchanged ──────────────────────────────────────

test('BKI-42 isSourceValid rejects source with comparableCount < 5', () => {
  const src = { stats: makeAirbnbStats(), comparableCount: 4, selectedRadiusKm: 2 };
  assert.strictEqual(isSourceValid(src), false);
});

test('BKI-43 isSourceValid rejects source with p25 > median', () => {
  const src = {
    stats: { median: 100, p25: 110, p75: 130, occupancy: 60, occupancy_semantics: 'calendar_unavailability_proxy' },
    comparableCount: 8, selectedRadiusKm: 2,
  };
  assert.strictEqual(isSourceValid(src), false);
});

test('BKI-44 isSourceValid accepts consistent source with metadataScore present', () => {
  const src = makeSource(makeAirbnbStats(), 8, 2, 0.90);
  assert.strictEqual(isSourceValid(src), true); // metadataScore is optional, should not break
});

// ── BKI-45..47: constant exports ─────────────────────────────────────────────

test('BKI-45 CROSS_SOURCE_DIVERGENCE constants are calibrated (more lenient)', () => {
  assert.strictEqual(CROSS_SOURCE_DIVERGENCE_LOW,      15);
  assert.strictEqual(CROSS_SOURCE_DIVERGENCE_MODERATE, 30);
  assert.strictEqual(CROSS_SOURCE_DIVERGENCE_HIGH,     50);
  // More lenient than BKG constants (10/25/50)
  const { DIVERGENCE_LOW, DIVERGENCE_MODERATE } = require('../services/market-multi-source-aggregator');
  assert.ok(CROSS_SOURCE_DIVERGENCE_LOW      > DIVERGENCE_LOW);
  assert.ok(CROSS_SOURCE_DIVERGENCE_MODERATE > DIVERGENCE_MODERATE);
});

test('BKI-46 BOOKING_COMPATIBLE_CATEGORIES contains expected types', () => {
  assert.ok(BOOKING_COMPATIBLE_CATEGORIES.has('apartment'));
  assert.ok(BOOKING_COMPATIBLE_CATEGORIES.has('villa'));
  assert.ok(BOOKING_COMPATIBLE_CATEGORIES.has('holiday home'));
});

test('BKI-47 BOOKING_INCOMPATIBLE_CATEGORIES contains hotel/hostel/guesthouse', () => {
  assert.ok(BOOKING_INCOMPATIBLE_CATEGORIES.has('hotel'));
  assert.ok(BOOKING_INCOMPATIBLE_CATEGORIES.has('hostel'));
  assert.ok(BOOKING_INCOMPATIBLE_CATEGORIES.has('guest house'));
});

// ── BKI-48..50: Safety ────────────────────────────────────────────────────────

test('BKI-48 market-cross-source-policy.js: no DB writes', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../services/market-cross-source-policy.js'),
    'utf8'
  );
  const pureSection = src.split('// ──')[0] + src.split('module.exports')[0];
  assert.ok(!/\bINSERT\s+INTO\b/i.test(pureSection), 'no INSERT INTO');
  assert.ok(!/\bpool\.query\b/i.test(pureSection),   'no pool.query');
});

test('BKI-49 market-cross-source-policy.js: no Channex, no pricing-apply', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../services/market-cross-source-policy.js'),
    'utf8'
  );
  assert.ok(!/require.*channex/i.test(src),        'no channex import');
  assert.ok(!/require.*pricing-apply/i.test(src),  'no pricing-apply import');
  assert.ok(!/BRIGHTDATA_API_KEY/i.test(src),      'no API key logging');
});

test('BKI-50 aggregateMarketSourcesCalibrated: never concatenates raw listings', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../services/market-multi-source-aggregator.js'),
    'utf8'
  );
  // Extract the calibrated function body
  const calibStart = src.indexOf('function aggregateMarketSourcesCalibrated');
  const calibEnd   = src.indexOf('\nfunction ', calibStart + 1);
  const calibSrc   = calibEnd > 0 ? src.slice(calibStart, calibEnd) : src.slice(calibStart);
  // Must not spread-merge listings arrays
  assert.ok(!/\[\s*\.\.\.airbnb.*listing/i.test(calibSrc), 'no naive listing merge');
  assert.ok(!/\[\s*\.\.\.booking.*listing/i.test(calibSrc), 'no naive listing merge');
});
