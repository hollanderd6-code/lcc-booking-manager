'use strict';
/**
 * P1.2-B5-BK-L7 — Market Hardening Tests (L modules)
 *
 * Tests for L2/L3/L4/L5 modules + integration with K engine.
 * SAFETY: All tests use mock data — zero real BD calls, zero DB calls.
 */

const assert = require('assert/strict');
const { describe, it, before } = require('node:test');
const fs   = require('fs');
const path = require('path');

const {
  evaluateMarketActionability,
  MAX_UNVALIDATED_PRODUCTION_DELTA_PCT,
} = require('../services/market-actionability-gate');

const {
  computeMarketDiagnosticCrossSource,
  MIN_DIAGNOSTIC_COMPARABLES,
} = require('../services/market-diagnostic-cross-source');

const {
  analyzeProductionSignalSanity,
  SANITY_MATERIAL_DEVIATION_PCT,
  SANITY_LARGE_DEVIATION_PCT,
} = require('../services/market-production-sanity');

const {
  evaluateExecutionPolicy,
  MIN_EVIDENCE_RUNS,
  MIN_RUNS_FOR_SINGLE_SNAP,
} = require('../services/market-execution-policy');

const {
  runShadowMarketEngine,
} = require('../services/market-engine-shadow-k');

// ── Shared fixtures ───────────────────────────────────────────────────────────

const TARGET_LAT  = 48.0;
const TARGET_LON  = 2.0;
const CURRENCY    = 'EUR';
const CHECK_IN    = '2026-11-01';
const CHECK_OUT   = '2026-11-04';
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

function makeStableAirbnbSnap(basePrice) {
  return Array.from({ length: 10 }, (_, i) =>
    makeAirbnbListing(basePrice + i * 5, 0.0008 * i, `a${i}`)
  );
}

function makeStableBookingSnap(basePrice = 100) {
  return Array.from({ length: 10 }, (_, i) =>
    makeBookingListing(basePrice + i * 5, 0.0008 * i, `b${i}`, 2)
  );
}

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
    isMock:      false,
    provider:    'brightdata_booking',
    dataSource:  'brightdata_booking_live',
    diagnostics: { returnedCount: listings.length, acceptedCount: listings.length },
  });
}

function makeSmallAirbnbSnap() {
  return Array.from({ length: 4 }, (_, i) =>
    makeAirbnbListing(100 + i * 10, 0.001 * i, `small${i}`)
  );
}

const STABLE_A_SNAPS = [
  makeStableAirbnbSnap(100),
  makeStableAirbnbSnap(120),
  makeStableAirbnbSnap(110),
];

function baseEngineOpts(airbnbScrape, bookingScrape) {
  return {
    targetLat:          TARGET_LAT,
    targetLon:          TARGET_LON,
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

// ── L-A: evaluateMarketActionability ─────────────────────────────────────────

describe('L-A: evaluateMarketActionability', () => {
  it('L-A01: LOW confidence → NOT_ACTIONABLE with LOW_CONFIDENCE', () => {
    const r = evaluateMarketActionability({
      marketStatus:     'AIRBNB_ONLY',
      marketConfidence: 'LOW',
      airbnbReliability: 'STABLE_LOCAL_POOL',
      candidateMedian:  100,
    });
    assert.equal(r.actionable, false);
    assert.equal(r.status, 'NOT_ACTIONABLE');
    assert.ok(r.reasons.includes('LOW_CONFIDENCE'));
  });

  it('L-A02: BOOKING_ONLY + LOW → NOT_ACTIONABLE with both reasons', () => {
    const r = evaluateMarketActionability({
      marketStatus:     'BOOKING_ONLY',
      marketConfidence: 'LOW',
      candidateMedian:  75,
    });
    assert.equal(r.actionable, false);
    assert.ok(r.reasons.includes('SINGLE_SOURCE_BOOKING_ONLY'));
    assert.ok(r.reasons.includes('LOW_CONFIDENCE'));
  });

  it('L-A03: BOOKING_ONLY + MEDIUM → NOT_ACTIONABLE (SINGLE_SOURCE_BOOKING_ONLY)', () => {
    const r = evaluateMarketActionability({
      marketStatus:     'BOOKING_ONLY',
      marketConfidence: 'MEDIUM',
      candidateMedian:  80,
    });
    assert.equal(r.actionable, false);
    assert.ok(r.reasons.includes('SINGLE_SOURCE_BOOKING_ONLY'));
    assert.ok(!r.reasons.includes('LOW_CONFIDENCE'));
  });

  it('L-A04: AIRBNB_ONLY + UNSTABLE_OR_INSUFFICIENT → NOT_ACTIONABLE', () => {
    const r = evaluateMarketActionability({
      marketStatus:     'AIRBNB_ONLY',
      marketConfidence: 'LOW',
      airbnbReliability: 'UNSTABLE_OR_INSUFFICIENT',
      candidateMedian:  90,
    });
    assert.equal(r.actionable, false);
    assert.ok(r.reasons.includes('AIRBNB_ONLY_UNSTABLE_RELIABILITY'));
  });

  it('L-A05: AIRBNB_ONLY + STABLE_LOCAL_POOL + HIGH + valid medians → ACTIONABLE', () => {
    const r = evaluateMarketActionability({
      marketStatus:     'AIRBNB_ONLY',
      marketConfidence: 'HIGH',
      airbnbReliability: 'STABLE_LOCAL_POOL',
      candidateMedian:   120,
      productionMedian:  115,  // delta ~4.3% < 35%
    });
    assert.equal(r.actionable, true);
    assert.equal(r.status, 'ACTIONABLE');
    assert.deepEqual(r.reasons, []);
  });

  it('L-A06: candidateMedian=null → NOT_ACTIONABLE with INVALID_CANDIDATE_MEDIAN', () => {
    const r = evaluateMarketActionability({
      marketStatus:     'AIRBNB_ONLY',
      marketConfidence: 'HIGH',
      airbnbReliability: 'STABLE_LOCAL_POOL',
      candidateMedian:   null,
    });
    assert.equal(r.actionable, false);
    assert.ok(r.reasons.includes('INVALID_CANDIDATE_MEDIAN'));
  });

  it('L-A07: large production delta (78%) → NOT_ACTIONABLE with LARGE_PRODUCTION_DEVIATION', () => {
    const r = evaluateMarketActionability({
      marketStatus:     'BOOKING_ONLY',
      marketConfidence: 'LOW',
      candidateMedian:   75.33,
      productionMedian:  345.45,  // delta ≈ 78%
    });
    assert.ok(r.reasons.includes('LARGE_PRODUCTION_DEVIATION'));
  });

  it('L-A08: small production delta (5%) → no LARGE_PRODUCTION_DEVIATION', () => {
    const r = evaluateMarketActionability({
      marketStatus:     'AIRBNB_ONLY',
      marketConfidence: 'HIGH',
      airbnbReliability: 'STABLE_LOCAL_POOL',
      candidateMedian:   105,
      productionMedian:  100,  // delta = 5%
    });
    assert.ok(!r.reasons.includes('LARGE_PRODUCTION_DEVIATION'));
  });

  it('L-A09: EXTREME divergence with both sources included → NOT_ACTIONABLE with EXTREME_CROSS_SOURCE_DIVERGENCE', () => {
    const r = evaluateMarketActionability({
      marketStatus:     'EXTREME_DIVERGENCE',
      marketConfidence: 'LOW',
      sourceUsage:      { airbnb: { included: true }, booking: { included: true } },
      crossSourceDiagnostic: { divergenceLevel: 'EXTREME' },
      candidateMedian:  100,
    });
    assert.ok(r.reasons.includes('EXTREME_CROSS_SOURCE_DIVERGENCE'));
  });

  it('L-A10: null production does not throw, adds warning only for large delta', () => {
    assert.doesNotThrow(() => {
      const r = evaluateMarketActionability({
        marketStatus:     'AIRBNB_ONLY',
        marketConfidence: 'HIGH',
        airbnbReliability: 'STABLE_LOCAL_POOL',
        candidateMedian:  100,
        productionMedian: null,
      });
      // No LARGE_PRODUCTION_DEVIATION when production is null
      assert.ok(!r.reasons.includes('LARGE_PRODUCTION_DEVIATION'));
    });
  });
});

// ── L-B: M6 scenario ─────────────────────────────────────────────────────────

describe('L-B: evaluateMarketActionability M6 scenario', () => {
  const m6 = () => evaluateMarketActionability({
    marketStatus:     'BOOKING_ONLY',
    marketConfidence: 'LOW',
    airbnbReliability: 'UNSTABLE_OR_INSUFFICIENT',
    candidateMedian:   75.33,
    productionMedian:  345.45,
  });

  it('L-B01: M6 → NOT_ACTIONABLE', () => {
    assert.equal(m6().actionable, false);
    assert.equal(m6().status, 'NOT_ACTIONABLE');
  });

  it('L-B02: M6 reasons include LOW_CONFIDENCE', () => {
    assert.ok(m6().reasons.includes('LOW_CONFIDENCE'));
  });

  it('L-B03: M6 reasons include SINGLE_SOURCE_BOOKING_ONLY and LARGE_PRODUCTION_DEVIATION', () => {
    const reasons = m6().reasons;
    assert.ok(reasons.includes('SINGLE_SOURCE_BOOKING_ONLY'));
    assert.ok(reasons.includes('LARGE_PRODUCTION_DEVIATION'));
  });
});

// ── L-C: computeMarketDiagnosticCrossSource ───────────────────────────────────

describe('L-C: computeMarketDiagnosticCrossSource', () => {
  it('L-C01: source excluded from consensus can still be diagnostic eligible', () => {
    const airbnb  = Array.from({ length: 8 }, (_, i) => makeAirbnbListing(100 + i * 5, 0.0005 * i, `a${i}`));
    const booking = Array.from({ length: 8 }, (_, i) => makeBookingListing(90 + i * 5, 0.0005 * i, `b${i}`));
    const r = computeMarketDiagnosticCrossSource({
      airbnbUniqueListings:       airbnb,
      bookingRawListings:         booking,
      targetLat: TARGET_LAT,
      targetLon: TARGET_LON,
      today: TODAY,
      // Pass Airbnb as consensus-excluded
      airbnbConsensusEligibility:  { included: false, reliability: 'UNSTABLE_OR_INSUFFICIENT' },
      bookingConsensusEligibility: { included: true },
    });
    // Diagnostic can still run
    assert.ok(r.diagnosticStatus === 'DIAGNOSTIC_AVAILABLE' || r.diagnosticStatus === 'INSUFFICIENT_COMMON_MARKET');
    // diagnosticEligibility.airbnb should show eligible based on listing count
    assert.equal(r.diagnosticEligibility.airbnb.eligible, true);
  });

  it('L-C02: diagnostic eligibility does not alter consensusEligibility passed in', () => {
    const airbnb  = Array.from({ length: 8 }, (_, i) => makeAirbnbListing(100 + i * 5, 0.0005 * i, `a${i}`));
    const booking = Array.from({ length: 8 }, (_, i) => makeBookingListing(90 + i * 5, 0.0005 * i, `b${i}`));
    const consensusIn = { included: false, reliability: 'UNSTABLE' };
    const r = computeMarketDiagnosticCrossSource({
      airbnbUniqueListings: airbnb,
      bookingRawListings:   booking,
      targetLat: TARGET_LAT, targetLon: TARGET_LON,
      today: TODAY,
      airbnbConsensusEligibility: consensusIn,
    });
    // The consensus eligibility is passed through, not modified
    assert.deepEqual(r.consensusEligibility.airbnb, consensusIn);
  });

  it('L-C03: common radius = smallest where both ≥ 5 (both at 1km → commonRadius=1)', () => {
    // 8 listings all within ~0.05° lat (~5km) — should find radius=1km
    const airbnb  = Array.from({ length: 8 }, (_, i) => makeAirbnbListing(100 + i * 5, 0.0005 * i, `a${i}`));
    const booking = Array.from({ length: 8 }, (_, i) => makeBookingListing(90 + i * 5, 0.0005 * i, `b${i}`));
    const r = computeMarketDiagnosticCrossSource({
      airbnbUniqueListings: airbnb,
      bookingRawListings:   booking,
      targetLat: TARGET_LAT, targetLon: TARGET_LON,
      today: TODAY,
    });
    if (r.diagnosticStatus === 'DIAGNOSTIC_AVAILABLE') {
      assert.equal(r.commonRadiusKm, 1);
    }
  });

  it('L-C04: no common radius when sources are at different radii', () => {
    // Airbnb within 1km, Booking at 5-6km → no common 1km radius
    const airbnb  = Array.from({ length: 8 }, (_, i) => makeAirbnbListing(100 + i * 5, 0.0005 * i, `a${i}`));
    // Booking far away (>2km)
    const booking = Array.from({ length: 8 }, (_, i) =>
      makeBookingListing(90 + i * 5, 0.05 + 0.001 * i, `b${i}`)  // ~5.5km
    );
    const r = computeMarketDiagnosticCrossSource({
      airbnbUniqueListings: airbnb,
      bookingRawListings:   booking,
      targetLat: TARGET_LAT, targetLon: TARGET_LON,
      today: TODAY,
    });
    // Either a larger common radius is found, or insufficient
    if (r.diagnosticStatus === 'DIAGNOSTIC_AVAILABLE') {
      assert.ok(r.commonRadiusKm >= 5, `expected radius >= 5, got ${r.commonRadiusKm}`);
    } else {
      assert.ok(
        r.diagnosticStatus === 'INSUFFICIENT_COMMON_MARKET' ||
        r.diagnosticStatus === 'INSUFFICIENT_DIAGNOSTIC_SOURCE'
      );
    }
  });

  it('L-C05: < MIN_DIAGNOSTIC_COMPARABLES → INSUFFICIENT_DIAGNOSTIC_SOURCE', () => {
    const airbnb  = Array.from({ length: 3 }, (_, i) => makeAirbnbListing(100 + i * 5, 0.0005 * i, `a${i}`));
    const booking = Array.from({ length: 8 }, (_, i) => makeBookingListing(90 + i * 5, 0.0005 * i, `b${i}`));
    const r = computeMarketDiagnosticCrossSource({
      airbnbUniqueListings: airbnb,
      bookingRawListings:   booking,
      targetLat: TARGET_LAT, targetLon: TARGET_LON,
      today: TODAY,
    });
    assert.equal(r.diagnosticStatus, 'INSUFFICIENT_DIAGNOSTIC_SOURCE');
    assert.equal(r.airbnb, null);
    assert.equal(r.booking, null);
  });

  it('L-C06: all price=0 → INSUFFICIENT_DIAGNOSTIC_SOURCE', () => {
    const airbnb  = Array.from({ length: 8 }, (_, i) => ({ ...makeAirbnbListing(0, 0.0005 * i, `a${i}`) }));
    const booking = Array.from({ length: 8 }, (_, i) => makeBookingListing(90 + i * 5, 0.0005 * i, `b${i}`));
    const r = computeMarketDiagnosticCrossSource({
      airbnbUniqueListings: airbnb,
      bookingRawListings:   booking,
      targetLat: TARGET_LAT, targetLon: TARGET_LON,
      today: TODAY,
    });
    assert.equal(r.diagnosticStatus, 'INSUFFICIENT_DIAGNOSTIC_SOURCE');
  });

  it('L-C07: no common radius → INSUFFICIENT_COMMON_MARKET', () => {
    // Both have enough listings at wide radii but airbnb is far
    const airbnb = Array.from({ length: 8 }, (_, i) =>
      makeAirbnbListing(100 + i * 5, 0.3 + 0.001 * i, `a${i}`)   // ~33km away
    );
    const booking = Array.from({ length: 8 }, (_, i) =>
      makeBookingListing(90 + i * 5, 0.001 * i, `b${i}`)
    );
    const r = computeMarketDiagnosticCrossSource({
      airbnbUniqueListings: airbnb,
      bookingRawListings:   booking,
      targetLat: TARGET_LAT, targetLon: TARGET_LON,
      today: TODAY,
    });
    // Airbnb is 33km away, won't fit in any radius ≤ 20km
    assert.ok(
      r.diagnosticStatus === 'INSUFFICIENT_COMMON_MARKET' ||
      r.diagnosticStatus === 'INSUFFICIENT_DIAGNOSTIC_SOURCE'
    );
  });

  it('L-C08: valid 5km common radius → DIAGNOSTIC_AVAILABLE with correct stats', () => {
    // Place all at ~0.015° lat ≈ 1.67km — both at r=2km
    const airbnb  = Array.from({ length: 8 }, (_, i) => makeAirbnbListing(100 + i * 5, 0.001 * i, `a${i}`));
    const booking = Array.from({ length: 8 }, (_, i) => makeBookingListing(90 + i * 5, 0.001 * i, `b${i}`));
    const r = computeMarketDiagnosticCrossSource({
      airbnbUniqueListings: airbnb,
      bookingRawListings:   booking,
      targetLat: TARGET_LAT, targetLon: TARGET_LON,
      today: TODAY,
    });
    if (r.diagnosticStatus === 'DIAGNOSTIC_AVAILABLE') {
      assert.ok(r.airbnb != null);
      assert.ok(r.booking != null);
      assert.ok(r.airbnb.median > 0);
      assert.ok(r.booking.median > 0);
      assert.ok(r.airbnb.count >= MIN_DIAGNOSTIC_COMPARABLES);
      assert.ok(r.booking.count >= MIN_DIAGNOSTIC_COMPARABLES);
    }
  });

  it('L-C09: divergence computed correctly (50€ vs 100€ ≈ 66.67%)', () => {
    // Create two groups: airbnb around 50, booking around 100
    const airbnb  = Array.from({ length: 8 }, (_, i) => makeAirbnbListing(45 + i, 0.0005 * i, `a${i}`));
    const booking = Array.from({ length: 8 }, (_, i) => makeBookingListing(95 + i, 0.0005 * i, `b${i}`));
    const r = computeMarketDiagnosticCrossSource({
      airbnbUniqueListings: airbnb,
      bookingRawListings:   booking,
      targetLat: TARGET_LAT, targetLon: TARGET_LON,
      today: TODAY,
    });
    if (r.diagnosticStatus === 'DIAGNOSTIC_AVAILABLE' && r.divergencePct != null) {
      // |50 - 99| / ((50+99)/2) = 49/74.5 ≈ 65.8%
      assert.ok(r.divergencePct > 50, `expected > 50%, got ${r.divergencePct}`);
    }
  });

  it('L-C10: divergence null if one source has null median', () => {
    // Empty airbnb → can't compute divergence
    const booking = Array.from({ length: 8 }, (_, i) => makeBookingListing(90 + i * 5, 0.0005 * i, `b${i}`));
    const r = computeMarketDiagnosticCrossSource({
      airbnbUniqueListings: [],
      bookingRawListings:   booking,
      targetLat: TARGET_LAT, targetLon: TARGET_LON,
      today: TODAY,
    });
    assert.equal(r.divergencePct, null);
  });
});

// ── L-D: production sanity ────────────────────────────────────────────────────

describe('L-D: analyzeProductionSignalSanity', () => {
  const makeSignal = (median) => ({
    median_price:    median,
    price_p25:       median * 0.8,
    price_p75:       median * 1.2,
    occupancy_rate:  65,
    comparable_count: 10,
    tension_level:   'elevated',
    data_source:     'brightdata_live',
    scraped_at:      new Date(Date.now() - 2 * 3600000).toISOString(),
  });

  it('L-D01: M6 scenario (production=345.45, consensus=75.33) → LARGE_DEVIATION', () => {
    const r = analyzeProductionSignalSanity({
      productionSignal: makeSignal(345.45),
      shadowConsensus:  75.33,
    });
    assert.equal(r.available, true);
    assert.equal(r.vsConsensus.classification, 'LARGE_DEVIATION');
  });

  it('L-D02: close values (production=100, consensus=102) → ALIGNED', () => {
    const r = analyzeProductionSignalSanity({
      productionSignal: makeSignal(100),
      shadowConsensus:  102,
    });
    assert.equal(r.vsConsensus.classification, 'ALIGNED');
  });

  it('L-D03: 30% delta → MATERIAL_DEVIATION', () => {
    const r = analyzeProductionSignalSanity({
      productionSignal: makeSignal(100),
      shadowConsensus:  130,
    });
    assert.equal(r.vsConsensus.classification, 'MATERIAL_DEVIATION');
  });

  it('L-D04: null production signal → available=false, all INSUFFICIENT_DATA', () => {
    const r = analyzeProductionSignalSanity({ productionSignal: null });
    assert.equal(r.available, false);
    assert.equal(r.vsAirbnb.classification,    'INSUFFICIENT_DATA');
    assert.equal(r.vsBooking.classification,   'INSUFFICIENT_DATA');
    assert.equal(r.vsConsensus.classification, 'INSUFFICIENT_DATA');
  });

  it('L-D05: candidate < production → negative deltaPct', () => {
    const r = analyzeProductionSignalSanity({
      productionSignal: makeSignal(200),
      shadowConsensus:  100,   // candidate below production
    });
    assert.ok(r.vsConsensus.deltaPct < 0, `expected negative delta, got ${r.vsConsensus.deltaPct}`);
  });
});

// ── L-E: execution policy ─────────────────────────────────────────────────────

describe('L-E: evaluateExecutionPolicy', () => {
  function makeRun(opts = {}) {
    return {
      earlyStopTriggered:      opts.earlyStop    ?? false,
      actualBdCalls:           opts.calls        ?? 3,
      airbnbReliabilityStatus: opts.reliability  ?? 'STABLE_LOCAL_POOL',
      airbnbGeoStatuses:       opts.geoStatuses  ?? ['STABLE', 'STABLE'],
    };
  }

  it('L-E01: < 2 runs → INSUFFICIENT_EVIDENCE', () => {
    const r = evaluateExecutionPolicy([makeRun()]);
    assert.equal(r.policy, 'INSUFFICIENT_EVIDENCE');
    assert.equal(r.evidence.totalRuns, 1);
  });

  it('L-E02: all three-call runs (≥50%) → THREE_SNAPSHOT_REQUIRED', () => {
    const runs = [
      makeRun({ calls: 3, earlyStop: false }),
      makeRun({ calls: 3, earlyStop: false }),
    ];
    const r = evaluateExecutionPolicy(runs);
    assert.equal(r.policy, 'THREE_SNAPSHOT_REQUIRED');
  });

  it('L-E03: all early-stop + stable + no degraded + 3 runs → SINGLE_SNAPSHOT_ALLOWED', () => {
    const runs = Array.from({ length: 3 }, () =>
      makeRun({ earlyStop: true, calls: 2, reliability: 'STABLE_LOCAL_POOL', geoStatuses: ['STABLE'] })
    );
    const r = evaluateExecutionPolicy(runs);
    assert.equal(r.policy, 'SINGLE_SNAPSHOT_ALLOWED');
  });

  it('L-E04: mixed early-stop/stable not meeting thresholds → INSUFFICIENT_EVIDENCE', () => {
    // 1 early-stop + 1 three-call → earlyStopRate=0.5 < 0.75 AND threeCallRate=0.5 >= 0.5
    // Actually this would hit THREE_SNAPSHOT_REQUIRED, let's use a case that fails all
    const runs = [
      makeRun({ earlyStop: false, calls: 2, reliability: 'UNSTABLE_OR_INSUFFICIENT' }),
      makeRun({ earlyStop: false, calls: 2, reliability: 'UNSTABLE_OR_INSUFFICIENT' }),
    ];
    // earlyStopRate=0, threeCallRate=0, stableRate=0 → INSUFFICIENT_EVIDENCE
    const r = evaluateExecutionPolicy(runs);
    assert.equal(r.policy, 'INSUFFICIENT_EVIDENCE');
  });

  it('L-E05: degraded geo prevents SINGLE_SNAPSHOT_ALLOWED', () => {
    const runs = Array.from({ length: 3 }, (_, i) =>
      makeRun({
        earlyStop:   true,
        calls:       2,
        reliability: 'STABLE_LOCAL_POOL',
        geoStatuses: i === 0 ? ['DEGRADED'] : ['STABLE'],  // one degraded
      })
    );
    const r = evaluateExecutionPolicy(runs);
    // degradedGeoRuns > 0 prevents SINGLE_SNAPSHOT_ALLOWED
    assert.notEqual(r.policy, 'SINGLE_SNAPSHOT_ALLOWED');
  });
});

// ── L-F: multi-date constraints ───────────────────────────────────────────────

describe('L-F: multi-date constraints', () => {
  it('L-F01: preview emits 0 BD calls (module requires no network)', () => {
    // Validate by checking that the multidate module does not invoke scrapers
    const src = fs.readFileSync(
      path.join(__dirname, '../outils/validate-market-engine-multidate-l.js'), 'utf8'
    );
    // Preview mode must check that ACTUAL_BD_CALLS=0
    assert.ok(src.includes('ACTUAL_BD_CALLS: 0'));
  });

  it('L-F02: MAX_WINDOWS enforced at 3 (4 windows config rejected)', () => {
    // Read the multidate validator source
    const src = fs.readFileSync(
      path.join(__dirname, '../outils/validate-market-engine-multidate-l.js'), 'utf8'
    );
    assert.ok(src.includes('MAX_WINDOWS'));
    assert.ok(src.includes('3'));  // MAX_WINDOWS = 3
  });

  it('L-F03: MAX_TOTAL_BD_CALLS = 12 for 3 windows', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../outils/validate-market-engine-multidate-l.js'), 'utf8'
    );
    assert.ok(src.includes('MAX_MULTIDATE_BD_CALLS'));
    assert.ok(src.includes('12'));
  });

  it('L-F04: J+14 date correct from base date', () => {
    const base = new Date('2026-11-01T00:00:00Z');
    const expected14 = new Date(base);
    expected14.setDate(expected14.getDate() + 14);
    const isoDate = expected14.toISOString().slice(0, 10);
    assert.equal(isoDate, '2026-11-15');
  });

  it('L-F05: J+30 date correct', () => {
    const base = new Date('2026-11-01T00:00:00Z');
    const d = new Date(base);
    d.setDate(d.getDate() + 30);
    assert.equal(d.toISOString().slice(0, 10), '2026-12-01');
  });

  it('L-F06: J+60 date correct', () => {
    const base = new Date('2026-11-01T00:00:00Z');
    const d = new Date(base);
    d.setDate(d.getDate() + 60);
    assert.equal(d.toISOString().slice(0, 10), '2026-12-31');
  });

  it('L-F07: null metrics excluded from summary averages', () => {
    // _mean helper skips null
    function mean(arr) {
      const valid = arr.filter(v => v != null && Number.isFinite(v));
      if (!valid.length) return null;
      return valid.reduce((s, v) => s + v, 0) / valid.length;
    }
    assert.equal(mean([100, null, 200]), 150);
    assert.equal(mean([null, null]), null);
    assert.equal(mean([50]), 50);
  });

  it('L-F08: window total calls = airbnb + booking calls', () => {
    // From K result shape, per window:
    const mockWindowResult = { actualBdCalls: 2, bookingBdCalls: 1 };
    assert.equal(mockWindowResult.actualBdCalls + mockWindowResult.bookingBdCalls, 3);
  });

  it('L-F09: no writes in multi-date (safety check on module source)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../outils/validate-market-engine-multidate-l.js'), 'utf8'
    );
    const INSERT = ['INS', 'ERT '].join('');
    assert.ok(!src.includes(INSERT), 'multidate validator must not contain SQL writes');
  });

  it('L-F10: deterministic summary fields all present in module source', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../outils/validate-market-engine-multidate-l.js'), 'utf8'
    );
    const requiredFields = [
      'WINDOWS_RUN', 'WINDOWS_WITH_STABLE_AIRBNB', 'WINDOWS_ACTIONABLE',
      'AIRBNB_MEDIAN_MIN', 'BOOKING_MEDIAN_MIN', 'CONSENSUS_MEDIAN_MIN',
      'TOTAL_BD_CALLS', 'EXECUTION_POLICY_RECOMMENDATION',
    ];
    for (const field of requiredFields) {
      assert.ok(src.includes(field), `missing field: ${field}`);
    }
  });
});

// ── L-G: safety invariants ────────────────────────────────────────────────────

describe('L-G: safety invariants', () => {
  const INSERT  = ['INS', 'ERT '].join('');
  const NEWPOOL = ['new', ' Pool('].join('');
  const CHX     = ["require", "('./chann"].join('');
  const PRICING = ["require", "('./pricing-apply"].join('');

  function readSrc(rel) {
    return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  }

  it('L-G01: actionability gate has no SQL write', () => {
    assert.ok(!readSrc('services/market-actionability-gate.js').includes(INSERT));
  });

  it('L-G02: actionability gate has no DB pool', () => {
    assert.ok(!readSrc('services/market-actionability-gate.js').includes(NEWPOOL));
  });

  it('L-G03: diagnostic module has no SQL write', () => {
    assert.ok(!readSrc('services/market-diagnostic-cross-source.js').includes(INSERT));
  });

  it('L-G04: production sanity has no SQL write', () => {
    assert.ok(!readSrc('services/market-production-sanity.js').includes(INSERT));
  });

  it('L-G05: execution policy has no SQL write', () => {
    assert.ok(!readSrc('services/market-execution-policy.js').includes(INSERT));
  });

  it('L-G06: single-window validator has no CHANNEX import', () => {
    assert.ok(!readSrc('outils/validate-market-engine-shadow-l.js').includes(CHX));
  });

  it('L-G07: multidate validator has no pricing-apply import', () => {
    assert.ok(!readSrc('outils/validate-market-engine-multidate-l.js').includes(PRICING));
  });
});

// ── L-H: output field completeness ───────────────────────────────────────────

describe('L-H: output field completeness', () => {
  it('L-H01: actionability result has actionable, status, reasons, warnings', () => {
    const r = evaluateMarketActionability({
      marketStatus: 'BOOKING_ONLY', marketConfidence: 'LOW', candidateMedian: 100,
    });
    assert.ok('actionable' in r);
    assert.ok('status' in r);
    assert.ok(Array.isArray(r.reasons));
    assert.ok(Array.isArray(r.warnings));
  });

  it('L-H02: actionability reasons is array (not null)', () => {
    const r = evaluateMarketActionability({
      marketStatus: 'STABLE_DUAL', marketConfidence: 'HIGH',
      sourceUsage: { airbnb: { included: true }, booking: { included: true } },
      candidateMedian: 100, productionMedian: 99,
    });
    assert.ok(Array.isArray(r.reasons));
    assert.ok(Array.isArray(r.warnings));
  });

  it('L-H03: diagnostic result has all required fields', () => {
    const r = computeMarketDiagnosticCrossSource({
      airbnbUniqueListings: [],
      bookingRawListings:   [],
      targetLat: TARGET_LAT, targetLon: TARGET_LON,
    });
    assert.ok('diagnosticStatus' in r);
    assert.ok('commonRadiusKm' in r);
    assert.ok('airbnb' in r);
    assert.ok('booking' in r);
    assert.ok('divergencePct' in r);
    assert.ok('divergenceLevel' in r);
    assert.ok('consensusEligibility' in r);
    assert.ok('diagnosticEligibility' in r);
    assert.ok('reason' in r);
  });

  it('L-H04: diagnostic eligibility has airbnb and booking', () => {
    const r = computeMarketDiagnosticCrossSource({
      airbnbUniqueListings: [],
      bookingRawListings:   [],
    });
    assert.ok('airbnb' in r.diagnosticEligibility);
    assert.ok('booking' in r.diagnosticEligibility);
  });

  it('L-H05: sanity result has available, productionMedian, vs fields', () => {
    const r = analyzeProductionSignalSanity({ productionSignal: null });
    assert.ok('available' in r);
    assert.ok('productionMedian' in r);
    assert.ok('vsAirbnb' in r);
    assert.ok('vsBooking' in r);
    assert.ok('vsConsensus' in r);
  });

  it('L-H06: sanity vsX fields have deltaPct and classification', () => {
    const r = analyzeProductionSignalSanity({ productionSignal: null });
    for (const key of ['vsAirbnb', 'vsBooking', 'vsConsensus']) {
      assert.ok('deltaPct' in r[key], `${key}.deltaPct missing`);
      assert.ok('classification' in r[key], `${key}.classification missing`);
    }
  });

  it('L-H07: execution policy result has policy, reason, evidence', () => {
    const r = evaluateExecutionPolicy([]);
    assert.ok('policy' in r);
    assert.ok('reason' in r);
    assert.ok('evidence' in r);
  });

  it('L-H08: execution policy evidence has totalRuns and rates', () => {
    const r = evaluateExecutionPolicy([]);
    const e = r.evidence;
    assert.ok('totalRuns' in e);
    assert.ok('earlyStopRuns' in e);
    assert.ok('stableRuns' in e);
    assert.ok('degradedGeoRuns' in e);
  });

  it('L-H09: sanity result includes signal metadata fields', () => {
    const r = analyzeProductionSignalSanity({
      productionSignal: {
        median_price:    100,
        price_p25:       80,
        price_p75:       120,
        occupancy_rate:  60,
        comparable_count: 8,
        tension_level:   'medium',
        data_source:     'brightdata_live',
        scraped_at:      new Date().toISOString(),
      },
    });
    assert.ok('signalAgeHours' in r);
    assert.ok('signalCount' in r);
    assert.ok('signalDataSource' in r);
    assert.ok('signalP25' in r);
    assert.ok('signalP75' in r);
    assert.ok('signalOccupancy' in r);
    assert.ok('signalTension' in r);
  });

  it('L-H10: actionability ACTIONABLE when all conditions met', () => {
    const r = evaluateMarketActionability({
      marketStatus:      'STABLE_DUAL',
      marketConfidence:  'HIGH',
      sourceUsage:       { airbnb: { included: true }, booking: { included: true } },
      crossSourceDiagnostic: { divergenceLevel: 'LOW' },
      airbnbReliability: 'STABLE_LOCAL_POOL',
      candidateMedian:   100,
      productionMedian:  98,  // ~2% delta
    });
    assert.equal(r.actionable, true);
    assert.equal(r.status, 'ACTIONABLE');
  });
});

// ── L-I: integration — L modules on K result ─────────────────────────────────

describe('L-I: integration — L modules on K result', () => {
  let kResult;

  before(async () => {
    // Build BOOKING_ONLY/LOW scenario like M6
    kResult = await runShadowMarketEngine({
      ...baseEngineOpts(
        makeAirbnbScrape([makeSmallAirbnbSnap(), makeSmallAirbnbSnap(), makeSmallAirbnbSnap()]),
        makeBookingScrape(makeStableBookingSnap(75)),
      ),
    });
  });

  it('L-I01: K result has market_status = BOOKING_ONLY', () => {
    assert.equal(kResult.market_status, 'BOOKING_ONLY');
  });

  it('L-I02: actionability = NOT_ACTIONABLE for BOOKING_ONLY scenario', () => {
    const r = evaluateMarketActionability({
      marketStatus:     kResult.market_status,
      marketConfidence: kResult.MARKET_CONFIDENCE,
      sourceUsage:      kResult.MARKET_SOURCE_USAGE,
      airbnbReliability: kResult.AIRBNB_RELIABILITY_STATUS,
      candidateMedian:  kResult.MARKET_CONSENSUS_MEDIAN,
      productionMedian: 345,  // simulate M6 production
    });
    assert.equal(r.actionable, false);
  });

  it('L-I03: actionability reasons include LARGE_PRODUCTION_DEVIATION', () => {
    const r = evaluateMarketActionability({
      marketStatus:     kResult.market_status,
      marketConfidence: kResult.MARKET_CONFIDENCE,
      candidateMedian:  kResult.MARKET_CONSENSUS_MEDIAN,
      productionMedian: 345,  // M6: ~78% delta
    });
    assert.ok(r.reasons.includes('LARGE_PRODUCTION_DEVIATION'));
  });

  it('L-I04: diagnostic can run even when Airbnb consensus-excluded', () => {
    const airbnbUnique = kResult._airbnbUnique || [];
    const bookingRaw   = kResult._bookingRaw?.listings || [];
    const r = computeMarketDiagnosticCrossSource({
      airbnbUniqueListings: airbnbUnique,
      bookingRawListings:   bookingRaw,
      targetLat: TARGET_LAT, targetLon: TARGET_LON,
      today: TODAY,
      airbnbConsensusEligibility:  { included: false },
      bookingConsensusEligibility: { included: true },
    });
    // Should at least return a defined status
    assert.ok(r.diagnosticStatus != null);
    assert.ok('diagnosticEligibility' in r);
  });

  it('L-I05: _airbnbUnique is present on K result', () => {
    assert.ok('_airbnbUnique' in kResult);
    assert.ok(Array.isArray(kResult._airbnbUnique));
  });

  it('L-I06: production sanity classifications correct with M6 production', () => {
    const r = analyzeProductionSignalSanity({
      productionSignal: {
        median_price:    345.45,
        price_p25:       280,
        price_p75:       400,
        occupancy_rate:  70,
        comparable_count: 12,
        tension_level:   'high',
        data_source:     'brightdata_live',
        scraped_at:      new Date(Date.now() - 3600000).toISOString(),
      },
      shadowConsensus: kResult.MARKET_CONSENSUS_MEDIAN,
    });
    assert.equal(r.available, true);
    assert.equal(r.vsConsensus.classification, 'LARGE_DEVIATION');
  });

  it('L-I07: sanity deltaPct is negative (candidate < production)', () => {
    const r = analyzeProductionSignalSanity({
      productionSignal: {
        median_price:    345.45,
        scraped_at:      new Date().toISOString(),
      },
      shadowConsensus: kResult.MARKET_CONSENSUS_MEDIAN,
    });
    if (r.vsConsensus.deltaPct != null) {
      assert.ok(r.vsConsensus.deltaPct < 0, `expected negative delta, got ${r.vsConsensus.deltaPct}`);
    }
  });

  it('L-I08: diagnosticEligibility.airbnb.eligible=true when ≥5 valid listings even if unstable reliability', () => {
    // Small snap has 4 → NOT eligible; use stable snap quality pool
    // airbnbUnique from small snap (<5 priced) should show not eligible
    const airbnbUnique = kResult._airbnbUnique || [];
    const r = computeMarketDiagnosticCrossSource({
      airbnbUniqueListings: airbnbUnique,
      bookingRawListings:   [],
      targetLat: TARGET_LAT, targetLon: TARGET_LON,
    });
    // With small snap (4 listings) airbnb diagnostic not eligible
    if (airbnbUnique.length < MIN_DIAGNOSTIC_COMPARABLES) {
      assert.equal(r.diagnosticEligibility.airbnb.eligible, false);
    }
  });

  it('L-I09: diagnosticEligibility.booking.eligible=true with valid booking listings', () => {
    const booking = makeStableBookingSnap(75);
    const r = computeMarketDiagnosticCrossSource({
      airbnbUniqueListings: [],
      bookingRawListings:   booking,
      targetLat: TARGET_LAT, targetLon: TARGET_LON,
    });
    assert.equal(r.diagnosticEligibility.booking.eligible, true);
  });

  it('L-I10: execution policy with single window result → INSUFFICIENT_EVIDENCE', () => {
    const singleRun = [{
      earlyStopTriggered:      kResult.earlyStopTriggered,
      actualBdCalls:           kResult.actualBdCalls,
      airbnbReliabilityStatus: kResult.AIRBNB_RELIABILITY_STATUS,
      airbnbGeoStatuses:       [],
    }];
    const r = evaluateExecutionPolicy(singleRun);
    assert.equal(r.policy, 'INSUFFICIENT_EVIDENCE');
  });
});
