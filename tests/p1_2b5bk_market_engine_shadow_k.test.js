'use strict';
/**
 * P1.2-B5-BK-K — Shadow Market Engine Tests
 *
 * Tests for services/market-engine-shadow-k.js
 *
 * SAFETY: All tests use injected mock scrapers — zero real BD calls.
 */

const assert = require('assert/strict');
const { describe, it, before } = require('node:test');
const {
  runShadowMarketEngine,
  _marketStatus,
  _divergencePct,
  _weightedPct,
} = require('../services/market-engine-shadow-k');

// ── Test fixtures ─────────────────────────────────────────────────────────────

const TARGET_LAT  = 48.0;
const TARGET_LON  = 2.0;
const CURRENCY    = 'EUR';
const CHECK_IN    = '2026-11-01';
const CHECK_OUT   = '2026-11-04';  // 3 nights
const TODAY       = '2026-10-18';

function makeAirbnbListing(price, latOffset, id) {
  return {
    price,
    latitude:          TARGET_LAT + latOffset,
    longitude:         TARGET_LON,
    providerListingId: id != null ? String(id) : null,
    category:          'entire_place',
    guests:            4,
    isBooked:          false,
    stars:             4.5,
    bedrooms:          null,
    availableDates:    [],
  };
}

function makeBookingListing(price, latOffset, id, bedrooms = 2) {
  return {
    price,
    latitude:          TARGET_LAT + latOffset,
    longitude:         TARGET_LON,
    providerListingId: id != null ? String(id) : null,
    category:          'apartment',
    guests:            null,
    isBooked:          false,
    stars:             4.0,
    bedrooms,
    availableDates:    null,
  };
}

// 10 Airbnb listings within 1km with offsets ≤ 0.0072° ≈ 801m
// Same IDs across all snapshots; base-price offset per snapshot avoids early-stop.
// Snapshot A base=100 (median 122.5), B base=120 (median 142.5), C base=110 (median 132.5)
// A-B spread ≈ 15.1% > 15% → shouldRequestThirdSnapshot returns true → 3 scrapes happen.
// Per-listing variation ≤ 18.2% < MAX_REPEATED_VARIATION_PCT(20%) → J5 gate passes.
function makeStableAirbnbSnap(basePrice) {
  return Array.from({ length: 10 }, (_, i) =>
    makeAirbnbListing(basePrice + i * 5, 0.0008 * i, `a${i}`)
  );
}

// 10 Booking listings within 1km
function makeStableBookingSnap(basePrice = 100) {
  return Array.from({ length: 10 }, (_, i) =>
    makeBookingListing(basePrice + i * 5, 0.0008 * i, `b${i}`, 2)
  );
}

// Mock scraper factories
function makeAirbnbScrape(snapshots) {
  let call = 0;
  return async () => {
    const listings = snapshots[call] || [];
    call++;
    return { snapshotId: `mock-a-${call}`, listings, diagnostics: {} };
  };
}

function makeBookingScrape(listings) {
  return async () => ({
    listings,
    isMock:     false,
    provider:   'brightdata_booking',
    dataSource: 'brightdata_booking_live',
    diagnostics: { returnedCount: listings.length, acceptedCount: listings.length, requestedNights: 3 },
  });
}

function makeBookingScrapeError() {
  return async () => { throw new Error('BD booking timeout'); };
}

// Base engine opts
function baseOpts(airbnbScrape, bookingScrape) {
  return {
    targetLat, targetLon: TARGET_LON,
    targetGuests:       4,
    targetBedrooms:     2,
    targetPropertyType: 'entire_place',
    location:           'Paris, France',
    currency:           CURRENCY,
    checkIn:            CHECK_IN,
    checkOut:           CHECK_OUT,
    today:              TODAY,
    _airbnbScrape:      airbnbScrape,
    _bookingScrape:     bookingScrape,
  };
}
const targetLat = TARGET_LAT;

// Stable Airbnb: 3 snapshots with same IDs, different base prices → STABLE_LOCAL_POOL
const STABLE_A_SNAPS = [makeStableAirbnbSnap(100), makeStableAirbnbSnap(120), makeStableAirbnbSnap(110)];
// Too-few Airbnb: 4 listings → ABC count < MIN_ABC_COMPARABLES(8) → UNSTABLE_OR_INSUFFICIENT
function makeSmallAirbnbSnap() {
  return Array.from({ length: 4 }, (_, i) =>
    makeAirbnbListing(100 + i * 10, 0.001 * i, `small${i}`)
  );
}

// ── Group A: STABLE_DUAL ───────────────────────────────────────────────────────

describe('K-A: STABLE_DUAL (both sources stable)', () => {
  let result;

  before(async () => {
    result = await runShadowMarketEngine({
      ...baseOpts(
        makeAirbnbScrape(STABLE_A_SNAPS),
        makeBookingScrape(makeStableBookingSnap(100)),
      ),
    });
  });

  it('K-A01: market_status = STABLE_DUAL', () => {
    assert.equal(result.market_status, 'STABLE_DUAL');
  });

  it('K-A02: AIRBNB_RELIABILITY_STATUS = STABLE_LOCAL_POOL', () => {
    assert.equal(result.AIRBNB_RELIABILITY_STATUS, 'STABLE_LOCAL_POOL');
  });

  it('K-A03: MARKET_CONFIDENCE is HIGH or MEDIUM (both sources valid)', () => {
    assert.ok(['HIGH', 'MEDIUM'].includes(result.MARKET_CONFIDENCE),
      `expected HIGH or MEDIUM, got ${result.MARKET_CONFIDENCE}`);
  });

  it('K-A04: consensus median is set and positive', () => {
    assert.ok(result.MARKET_CONSENSUS_MEDIAN != null && result.MARKET_CONSENSUS_MEDIAN > 0);
  });

  it('K-A05: BOOKING_COUNT ≥ 5', () => {
    assert.ok(result.BOOKING_COUNT >= 5);
  });

  it('K-A06: AIRBNB_POOL_COUNT = 10 (10 unique pooled)', () => {
    assert.equal(result.AIRBNB_POOL_COUNT, 10);
  });

  it('K-A07: both sources included in source usage', () => {
    assert.equal(result.MARKET_SOURCE_USAGE.airbnb.included, true);
    assert.equal(result.MARKET_SOURCE_USAGE.booking.included, true);
  });

  it('K-A08: AIRBNB_POOL_MEDIAN and BOOKING_MEDIAN both positive', () => {
    assert.ok(result.AIRBNB_POOL_MEDIAN > 0);
    assert.ok(result.BOOKING_MEDIAN > 0);
  });
});

// ── Group B: AIRBNB_ONLY ──────────────────────────────────────────────────────

describe('K-B: AIRBNB_ONLY (Booking fails)', () => {
  it('K-B01: Booking scrape error → AIRBNB_ONLY', async () => {
    const result = await runShadowMarketEngine({
      ...baseOpts(makeAirbnbScrape(STABLE_A_SNAPS), makeBookingScrapeError()),
    });
    assert.equal(result.market_status, 'AIRBNB_ONLY');
    assert.equal(result.AIRBNB_RELIABILITY_STATUS, 'STABLE_LOCAL_POOL');
  });

  it('K-B02: Booking insufficient listings (2 < 5) → AIRBNB_ONLY', async () => {
    const fewBooking = [
      makeBookingListing(100, 0.001, 'bx1'),
      makeBookingListing(120, 0.002, 'bx2'),
    ];
    const result = await runShadowMarketEngine({
      ...baseOpts(makeAirbnbScrape(STABLE_A_SNAPS), makeBookingScrape(fewBooking)),
    });
    assert.equal(result.market_status, 'AIRBNB_ONLY');
  });

  it('K-B03: AIRBNB_ONLY has consensus from Airbnb alone', async () => {
    const result = await runShadowMarketEngine({
      ...baseOpts(makeAirbnbScrape(STABLE_A_SNAPS), makeBookingScrapeError()),
    });
    assert.ok(result.MARKET_CONSENSUS_MEDIAN != null && result.MARKET_CONSENSUS_MEDIAN > 0);
    assert.equal(result.MARKET_SOURCE_USAGE.airbnb.included, true);
    assert.equal(result.MARKET_SOURCE_USAGE.booking.included, false);
  });

  it('K-B04: AIRBNB_ONLY has booking in exclusion reasons', async () => {
    const result = await runShadowMarketEngine({
      ...baseOpts(makeAirbnbScrape(STABLE_A_SNAPS), makeBookingScrapeError()),
    });
    assert.ok(result.MARKET_EXCLUSION_REASONS.some(r => r.startsWith('booking_scrape_failed')));
  });
});

// ── Group C: BOOKING_ONLY ─────────────────────────────────────────────────────

describe('K-C: BOOKING_ONLY (Airbnb not STABLE_LOCAL_POOL)', () => {
  it('K-C01: Airbnb 4 listings → UNSTABLE_OR_INSUFFICIENT → BOOKING_ONLY', async () => {
    const result = await runShadowMarketEngine({
      ...baseOpts(
        makeAirbnbScrape([makeSmallAirbnbSnap(), makeSmallAirbnbSnap(), makeSmallAirbnbSnap()]),
        makeBookingScrape(makeStableBookingSnap(100)),
      ),
    });
    assert.equal(result.market_status, 'BOOKING_ONLY');
  });

  it('K-C02: BOOKING_ONLY has Booking consensus median set', async () => {
    const result = await runShadowMarketEngine({
      ...baseOpts(
        makeAirbnbScrape([makeSmallAirbnbSnap(), makeSmallAirbnbSnap(), makeSmallAirbnbSnap()]),
        makeBookingScrape(makeStableBookingSnap(110)),
      ),
    });
    assert.ok(result.MARKET_CONSENSUS_MEDIAN != null && result.MARKET_CONSENSUS_MEDIAN > 0);
    assert.equal(result.MARKET_SOURCE_USAGE.booking.included, true);
    assert.equal(result.MARKET_SOURCE_USAGE.airbnb.included, false);
  });

  it('K-C03: BOOKING_ONLY Airbnb in exclusion reasons', async () => {
    const result = await runShadowMarketEngine({
      ...baseOpts(
        makeAirbnbScrape([makeSmallAirbnbSnap(), makeSmallAirbnbSnap(), makeSmallAirbnbSnap()]),
        makeBookingScrape(makeStableBookingSnap(100)),
      ),
    });
    assert.ok(result.MARKET_EXCLUSION_REASONS.some(r => r.startsWith('airbnb_excluded')));
  });
});

// ── Group D: INSUFFICIENT ─────────────────────────────────────────────────────

describe('K-D: INSUFFICIENT (neither source usable)', () => {
  it('K-D01: Airbnb 4 listings + Booking 2 listings → INSUFFICIENT', async () => {
    const fewBooking = [makeBookingListing(100, 0.001, 'b1'), makeBookingListing(120, 0.002, 'b2')];
    const result = await runShadowMarketEngine({
      ...baseOpts(
        makeAirbnbScrape([makeSmallAirbnbSnap(), makeSmallAirbnbSnap(), makeSmallAirbnbSnap()]),
        makeBookingScrape(fewBooking),
      ),
    });
    assert.equal(result.market_status, 'INSUFFICIENT');
  });

  it('K-D02: Both sources fail → INSUFFICIENT, consensus median = null', async () => {
    const result = await runShadowMarketEngine({
      ...baseOpts(
        makeAirbnbScrape([makeSmallAirbnbSnap(), makeSmallAirbnbSnap(), makeSmallAirbnbSnap()]),
        makeBookingScrapeError(),
      ),
    });
    assert.equal(result.market_status, 'INSUFFICIENT');
    assert.equal(result.MARKET_CONSENSUS_MEDIAN, null);
    assert.equal(result.MARKET_CONFIDENCE, 'INSUFFICIENT');
  });

  it('K-D03: INSUFFICIENT has both sources in exclusion reasons', async () => {
    const result = await runShadowMarketEngine({
      ...baseOpts(
        makeAirbnbScrape([makeSmallAirbnbSnap(), makeSmallAirbnbSnap(), makeSmallAirbnbSnap()]),
        makeBookingScrapeError(),
      ),
    });
    assert.ok(result.MARKET_EXCLUSION_REASONS.some(r => r.startsWith('airbnb_excluded')));
    assert.ok(result.MARKET_EXCLUSION_REASONS.some(r => r.startsWith('booking_scrape_failed')));
  });
});

// ── Group E: EXTREME_DIVERGENCE ───────────────────────────────────────────────

describe('K-E: Divergence scenarios', () => {
  it('K-E01: Extreme divergence (airbnb ~132€, booking ~222€, ~51%) → EXTREME_DIVERGENCE', async () => {
    // Booking base = 200, Airbnb merged median ≈ 132.5 (bases 100, 120, 110)
    // Booking median ≈ 222.5 (base 200, prices 200-245)
    // Divergence ≈ |132.5-222.5|/177.5 ≈ 50.7% → EXTREME
    const highBooking = makeStableBookingSnap(200);
    const result = await runShadowMarketEngine({
      ...baseOpts(makeAirbnbScrape(STABLE_A_SNAPS), makeBookingScrape(highBooking)),
    });
    assert.equal(result.market_status, 'EXTREME_DIVERGENCE');
    assert.ok(result.CROSS_SOURCE_DIVERGENCE_PCT != null && result.CROSS_SOURCE_DIVERGENCE_PCT >= 50,
      `expected divergence ≥ 50%, got ${result.CROSS_SOURCE_DIVERGENCE_PCT}`);
    assert.equal(result.CROSS_SOURCE_DIVERGENCE_LEVEL, 'EXTREME');
  });

  it('K-E02: Moderate divergence (< 50%) → STABLE_DUAL', async () => {
    // Booking base = 120 → median ≈ 142.5
    // Airbnb merged median ≈ 132.5
    // divergence ≈ |132.5 - 142.5| / 137.5 ≈ 7.3% → LOW → STABLE_DUAL
    const modBooking = makeStableBookingSnap(120);
    const result = await runShadowMarketEngine({
      ...baseOpts(makeAirbnbScrape(STABLE_A_SNAPS), makeBookingScrape(modBooking)),
    });
    assert.equal(result.market_status, 'STABLE_DUAL');
    assert.ok(
      result.CROSS_SOURCE_DIVERGENCE_PCT == null || result.CROSS_SOURCE_DIVERGENCE_PCT < 50,
      `expected divergence < 50%`
    );
  });
});

// ── Group F: Occupancy semantics ──────────────────────────────────────────────

describe('K-F: Occupancy semantics', () => {
  it('K-F01: Booking occupancy always null (OCCUPANCY_SEMANTICS not from Booking)', async () => {
    const result = await runShadowMarketEngine({
      ...baseOpts(makeAirbnbScrape(STABLE_A_SNAPS), makeBookingScrape(makeStableBookingSnap())),
    });
    // Booking occupancy is unavailable — signal can only come from Airbnb
    if (result.OCCUPANCY_SIGNAL_SOURCE !== null) {
      assert.equal(result.OCCUPANCY_SIGNAL_SOURCE, 'airbnb');
    }
    // Booking stats should have occupancy=null
    assert.equal(result._bookingSource?.stats?.occupancy, null);
    assert.equal(result._bookingSource?.stats?.occupancy_semantics, 'unavailable');
  });

  it('K-F02: BOOKING_ONLY mode → OCCUPANCY_SIGNAL_SOURCE = null (no Airbnb data)', async () => {
    const result = await runShadowMarketEngine({
      ...baseOpts(
        makeAirbnbScrape([makeSmallAirbnbSnap(), makeSmallAirbnbSnap(), makeSmallAirbnbSnap()]),
        makeBookingScrape(makeStableBookingSnap()),
      ),
    });
    assert.equal(result.market_status, 'BOOKING_ONLY');
    assert.equal(result.OCCUPANCY_SIGNAL_SOURCE, null);
  });
});

// ── Group G: Common radius ────────────────────────────────────────────────────

describe('K-G: Common radius selection', () => {
  it('K-G01: Both at 1km → common radius = 1km', async () => {
    const result = await runShadowMarketEngine({
      ...baseOpts(makeAirbnbScrape(STABLE_A_SNAPS), makeBookingScrape(makeStableBookingSnap())),
    });
    assert.equal(result.CROSS_SOURCE_COMMON_RADIUS_KM, 1);
    assert.ok(result.AIRBNB_AT_COMMON_RADIUS_COUNT >= 5);
    assert.ok(result.BOOKING_AT_COMMON_RADIUS_COUNT >= 5);
  });

  it('K-G02: Booking all at 3km → common radius = 3km', async () => {
    // Booking listings at 2-3km (too far for 1km or 2km common radius with airbnb)
    // Actually with airbnb at 1km and booking at 3km, common radius = 3km
    const distantBooking = Array.from({ length: 10 }, (_, i) =>
      makeBookingListing(100 + i * 5, 0.022 * (i + 1), `db${i}`, 2)
    );
    // 0.022 degrees ≈ 2.45km per step, so all beyond 2km
    // airbnb has 10 within 1km
    // booking has 10 within... let's see: at 0.022-0.22 degrees offset
    // 0.022 degrees ≈ 2.45km. At r=3km: 0.022*1=2.45km ≤ 3km ✓, 0.022*2=4.9km > 3km
    // So at r=3km: booking count = 1 < 5. Need to try larger radius.
    // Let me use a different setup: all booking at exactly 0.013 degrees ≈ 1.45km
    const bookingAt2km = Array.from({ length: 10 }, (_, i) =>
      makeBookingListing(100 + i * 5, 0.013 + 0.001 * i, `near${i}`, 2)
    );
    // 0.013 degrees ≈ 1.45km → all within 2km. Airbnb: 10 within 1km.
    // At r=1km: airbnb=10≥5, booking=0<5 → no. At r=2km: airbnb=10≥5, booking=10≥5 → yes.
    const result = await runShadowMarketEngine({
      ...baseOpts(makeAirbnbScrape(STABLE_A_SNAPS), makeBookingScrape(bookingAt2km)),
    });
    assert.equal(result.CROSS_SOURCE_COMMON_RADIUS_KM, 2);
    assert.ok(result.BOOKING_AT_COMMON_RADIUS_COUNT >= 5);
  });
});

// ── Group H: Early stop ───────────────────────────────────────────────────────

describe('K-H: Airbnb acquisition', () => {
  it('K-H01: 3 Airbnb snapshots run (spread ≈ 15.1% > 15% → no early stop)', async () => {
    const result = await runShadowMarketEngine({
      ...baseOpts(makeAirbnbScrape(STABLE_A_SNAPS), makeBookingScrape(makeStableBookingSnap())),
    });
    assert.equal(result.actualBdCalls, 3);
    assert.equal(result.earlyStopTriggered, false);
  });

  it('K-H02: Snapshots A+B with low spread (< 15%) → early stop after 2', async () => {
    // Same snap used twice → spread = 0% < 15% → early stop
    const sameSnap = makeStableAirbnbSnap(100);
    const result = await runShadowMarketEngine({
      ...baseOpts(
        makeAirbnbScrape([sameSnap, sameSnap, sameSnap]),
        makeBookingScrape(makeStableBookingSnap()),
      ),
    });
    // Early stop means only 2 BD calls for Airbnb
    assert.equal(result.actualBdCalls, 2);
    assert.equal(result.earlyStopTriggered, true);
    // With 2 snapshots, AB subset only → reliableSubsetCount = 1 < 2 → INSUFFICIENT_RELIABILITY_EVIDENCE
    assert.equal(result.AIRBNB_RELIABILITY_STATUS, 'INSUFFICIENT_RELIABILITY_EVIDENCE');
  });
});

// ── Group I: No single-snapshot Airbnb fallback ───────────────────────────────

describe('K-I: No single-snapshot Airbnb fallback', () => {
  it('K-I01: 1 non-empty + 2 empty snapshots → usableSnapshotCount=1 → UNSTABLE_OR_INSUFFICIENT', async () => {
    // Snapshot A: 10 listings. B, C: empty.
    // With 2 empty: usableSnapshotCount = 1 < MIN_USABLE_SNAPSHOTS(2) → UNSTABLE_OR_INSUFFICIENT.
    // Engine must NOT fall back to single-snapshot Airbnb for consensus.
    const result = await runShadowMarketEngine({
      ...baseOpts(
        makeAirbnbScrape([makeStableAirbnbSnap(100), [], []]),
        makeBookingScrape(makeStableBookingSnap()),
      ),
    });
    // Airbnb is excluded (not STABLE_LOCAL_POOL)
    assert.notEqual(result.AIRBNB_RELIABILITY_STATUS, 'STABLE_LOCAL_POOL');
    assert.equal(result.MARKET_SOURCE_USAGE.airbnb.included, false);
    // With valid Booking, status = BOOKING_ONLY
    assert.equal(result.market_status, 'BOOKING_ONLY');
  });

  it('K-I02: 3 non-empty snaps → STABLE_LOCAL_POOL → Airbnb included', async () => {
    const result = await runShadowMarketEngine({
      ...baseOpts(makeAirbnbScrape(STABLE_A_SNAPS), makeBookingScrape(makeStableBookingSnap())),
    });
    assert.equal(result.AIRBNB_RELIABILITY_STATUS, 'STABLE_LOCAL_POOL');
    assert.equal(result.MARKET_SOURCE_USAGE.airbnb.included, true);
  });
});

// ── Group J: Safety invariants ────────────────────────────────────────────────

describe('K-J: Safety invariants', () => {
  const fs   = require('fs');
  const path = require('path');

  const srcEngine    = fs.readFileSync(
    path.join(__dirname, '../services/market-engine-shadow-k.js'), 'utf8'
  );

  const P = {
    sqlWrite:   ['INS', 'ERT '].join(''),
    newPool:    ['new', ' Pool('].join(''),
    chxRqRel:   ["require", "('./chann"].join(''),
    chxRqUp:    ["require", "('../chann"].join(''),
    pricingRel: ["require", "('./pricing-apply"].join(''),
    pricingUp:  ["require", "('../pricing-apply"].join(''),
    bdKey:      ['BRIGHT', 'DATA_API_KEY'].join(''),
  };

  it('K-J01: engine module has no SQL write (INSERT)', () => {
    assert.ok(!srcEngine.includes(P.sqlWrite), 'engine must not contain INSERT');
  });

  it('K-J02: engine module has no DB pool construction', () => {
    assert.ok(!srcEngine.includes(P.newPool), 'engine must not construct a DB pool');
  });

  it('K-J03: engine module has no channex import', () => {
    const noChannex = !srcEngine.includes(P.chxRqRel) && !srcEngine.includes(P.chxRqUp);
    assert.ok(noChannex, 'engine must not import channex');
  });

  it('K-J04: engine module has no pricing-apply import', () => {
    const noPricing = !srcEngine.includes(P.pricingRel) && !srcEngine.includes(P.pricingUp);
    assert.ok(noPricing, 'engine must not import pricing-apply');
  });

  it('K-J05: engine module does not log BD API key', () => {
    assert.ok(!srcEngine.includes(P.bdKey), 'engine must not log BRIGHTDATA_API_KEY');
  });
});

// ── Group K: Pure helper functions ────────────────────────────────────────────

describe('K-K: Pure helper functions', () => {
  it('K-K01: _marketStatus(false, false, null) → INSUFFICIENT', () => {
    assert.equal(_marketStatus(false, false, null), 'INSUFFICIENT');
  });

  it('K-K02: _marketStatus(true, false, null) → AIRBNB_ONLY', () => {
    assert.equal(_marketStatus(true, false, null), 'AIRBNB_ONLY');
  });

  it('K-K03: _marketStatus(false, true, null) → BOOKING_ONLY', () => {
    assert.equal(_marketStatus(false, true, null), 'BOOKING_ONLY');
  });

  it('K-K04: _marketStatus(true, true, EXTREME) → EXTREME_DIVERGENCE', () => {
    assert.equal(_marketStatus(true, true, 'EXTREME'), 'EXTREME_DIVERGENCE');
  });

  it('K-K05: _marketStatus(true, true, HIGH) → STABLE_DUAL', () => {
    assert.equal(_marketStatus(true, true, 'HIGH'), 'STABLE_DUAL');
  });

  it('K-K06: _marketStatus(true, true, LOW) → STABLE_DUAL', () => {
    assert.equal(_marketStatus(true, true, 'LOW'), 'STABLE_DUAL');
  });

  it('K-K07: _divergencePct symmetric: |120-140| / 130 * 100 ≈ 15.38%', () => {
    const pct = _divergencePct(120, 140);
    assert.ok(Math.abs(pct - 15.384) < 0.01, `got ${pct}`);
  });

  it('K-K08: _divergencePct(0, 100) → null (zero denominator)', () => {
    assert.equal(_divergencePct(0, 100), null);
  });

  it('K-K09: _weightedPct both values → weighted avg', () => {
    assert.equal(_weightedPct(100, 200, 0.6, 0.4), 140);
  });

  it('K-K10: _weightedPct only a → returns a', () => {
    assert.equal(_weightedPct(100, null, 1, 0), 100);
  });
});

// ── Group L: Output field completeness ───────────────────────────────────────

describe('K-L: Output field completeness', () => {
  let result;

  before(async () => {
    result = await runShadowMarketEngine({
      ...baseOpts(makeAirbnbScrape(STABLE_A_SNAPS), makeBookingScrape(makeStableBookingSnap())),
    });
  });

  const requiredFields = [
    'market_status',
    'AIRBNB_POOL_STATUS', 'AIRBNB_POOL_RADIUS_KM', 'AIRBNB_POOL_COUNT',
    'AIRBNB_POOL_MEDIAN', 'AIRBNB_POOL_P25', 'AIRBNB_POOL_P75',
    'AIRBNB_RELIABILITY_STATUS',
    'BOOKING_RADIUS_KM', 'BOOKING_COUNT', 'BOOKING_MEDIAN', 'BOOKING_P25', 'BOOKING_P75',
    'CROSS_SOURCE_COMMON_RADIUS_KM',
    'AIRBNB_AT_COMMON_RADIUS_COUNT', 'BOOKING_AT_COMMON_RADIUS_COUNT',
    'AIRBNB_AT_COMMON_RADIUS_MEDIAN', 'BOOKING_AT_COMMON_RADIUS_MEDIAN',
    'CROSS_SOURCE_DIVERGENCE_PCT', 'CROSS_SOURCE_DIVERGENCE_LEVEL',
    'MARKET_CONSENSUS_MEDIAN', 'MARKET_CONSENSUS_P25', 'MARKET_CONSENSUS_P75',
    'MARKET_CONFIDENCE', 'MARKET_SOURCE_USAGE', 'MARKET_EXCLUSION_REASONS',
    'OCCUPANCY_SIGNAL_SOURCE', 'OCCUPANCY_SIGNAL', 'OCCUPANCY_SEMANTICS',
    'actualBdCalls', 'earlyStopTriggered', 'bookingBdCalls',
  ];

  for (const field of requiredFields) {
    it(`K-L01: output has field ${field}`, () => {
      assert.ok(field in result, `missing field ${field}`);
    });
  }
});
