'use strict';
/**
 * P1.2-B5-BK-M — Test fixtures for adaptive collection tests.
 *
 * All fixtures are pure data — no network, no DB, no BD calls.
 * Dates are anchored to 2026-09-27 (today in this session).
 *
 * SAFETY: 0 BD credits consumed.
 */

// ── Listing factories ─────────────────────────────────────────────────────────

function makeAirbnbListing(id, price, lat, lon, guests = 2, overrides = {}) {
  return {
    providerListingId: `airbnb-${id}`,
    price,
    latitude:  lat,
    longitude: lon,
    guests,
    category:  'apartment',
    availableDates: [],
    ...overrides,
  };
}

function makeBookingListing(id, price, lat, lon, bedrooms = 1, overrides = {}) {
  return {
    providerListingId: `booking-${id}`,
    price,
    latitude:  lat,
    longitude: lon,
    bedrooms,
    category:  'apartment',
    ...overrides,
  };
}

// ── Target property (Paris 11ème) ─────────────────────────────────────────────

const TARGET = {
  targetLat:           48.855,
  targetLon:           2.347,
  targetGuests:        2,
  targetBedrooms:      1,
  targetPropertyType:  'entire_place',
  location:            'Paris, France',
  currency:            'EUR',
};

// ── Airbnb snapshots (within ~1 km of TARGET) ─────────────────────────────────
// Three snapshot variants with different price levels.
// S1 (low) and S2 (high) intentionally diverge >15% so K's shouldRequestThirdSnapshot
// returns true — ensuring K collects all 3 and the reliability gate reaches STABLE_LOCAL_POOL.

// Each snapshot uses UNIQUE listing IDs so the reliability gate finds no
// repeated-listing price variation (repeatedMax = 0 → passes).
// S1 and S2 diverge >15% in median → shouldRequestThirdSnapshot returns true
// (K makes all 3 calls). With 3 snapshots and stable individual pools,
// computePooledReliabilityGate → STABLE_LOCAL_POOL.

// S1: snapshot-1 listings (median ~115), IDs: as1-as8
const AIRBNB_LISTINGS_S1 = [
  makeAirbnbListing('as1-1', 110, 48.856, 2.348),
  makeAirbnbListing('as1-2', 118, 48.854, 2.346),
  makeAirbnbListing('as1-3', 113, 48.857, 2.350),
  makeAirbnbListing('as1-4', 108, 48.853, 2.345),
  makeAirbnbListing('as1-5', 120, 48.858, 2.351),
  makeAirbnbListing('as1-6', 115, 48.855, 2.344),
  makeAirbnbListing('as1-7', 111, 48.856, 2.352),
  makeAirbnbListing('as1-8', 117, 48.854, 2.343),
];

// S2: snapshot-2 listings (median ~152), IDs: bs1-bs8 — diverges ~28% from S1 → 3rd call
const AIRBNB_LISTINGS_S2 = [
  makeAirbnbListing('bs2-1', 148, 48.856, 2.348),
  makeAirbnbListing('bs2-2', 155, 48.854, 2.346),
  makeAirbnbListing('bs2-3', 150, 48.857, 2.350),
  makeAirbnbListing('bs2-4', 145, 48.853, 2.345),
  makeAirbnbListing('bs2-5', 158, 48.858, 2.351),
  makeAirbnbListing('bs2-6', 152, 48.855, 2.344),
  makeAirbnbListing('bs2-7', 148, 48.856, 2.352),
  makeAirbnbListing('bs2-8', 155, 48.854, 2.343),
];

// S3: snapshot-3 listings (median ~116), IDs: cs1-cs8
const AIRBNB_LISTINGS_S3 = [
  makeAirbnbListing('cs3-1', 112, 48.856, 2.348),
  makeAirbnbListing('cs3-2', 118, 48.854, 2.346),
  makeAirbnbListing('cs3-3', 114, 48.857, 2.350),
  makeAirbnbListing('cs3-4', 110, 48.853, 2.345),
  makeAirbnbListing('cs3-5', 122, 48.858, 2.351),
  makeAirbnbListing('cs3-6', 116, 48.855, 2.344),
  makeAirbnbListing('cs3-7', 113, 48.856, 2.352),
  makeAirbnbListing('cs3-8', 119, 48.854, 2.343),
];

// Backward-compat alias used in M6 anomaly tests (uses S3 as "stable" baseline)
const AIRBNB_LISTINGS_STABLE = AIRBNB_LISTINGS_S3;

const BOOKING_LISTINGS_STABLE = [
  makeBookingListing('b1',  115, 48.856, 2.348),
  makeBookingListing('b2',  125, 48.854, 2.346),
  makeBookingListing('b3',  118, 48.857, 2.350),
  makeBookingListing('b4',  108, 48.853, 2.345),
  makeBookingListing('b5',  130, 48.858, 2.351),
  makeBookingListing('b6',  120, 48.855, 2.344),
  makeBookingListing('b7',  117, 48.856, 2.352),
  makeBookingListing('b8',  128, 48.854, 2.343),
];

// Divergent booking listings (>50% above airbnb) — triggers EXTREME_DIVERGENCE
const BOOKING_LISTINGS_EXTREME = [
  makeBookingListing('bx1', 210, 48.856, 2.348),
  makeBookingListing('bx2', 225, 48.854, 2.346),
  makeBookingListing('bx3', 215, 48.857, 2.350),
  makeBookingListing('bx4', 205, 48.853, 2.345),
  makeBookingListing('bx5', 230, 48.858, 2.351),
];

// ── Snapshot shapes ───────────────────────────────────────────────────────────

function makeAirbnbSnapshot(id, listings, overrides = {}) {
  return {
    snapshotId: `snap-airbnb-${id}`,
    listings,
    ...overrides,
  };
}

function makeBookingResult(listings) {
  return {
    snapshotId: 'snap-booking-1',
    listings,
  };
}

// ── FIXTURE: J14 — STABLE_DUAL ────────────────────────────────────────────────
// checkIn J+14 from 2026-09-27 → 2026-10-11, 3-night stay
//
// S1 (median ~100) and S2 (median ~130) diverge ~26% → K requests 3rd snapshot.
// With 3 snapshots, computePooledReliabilityGate → STABLE_LOCAL_POOL → STABLE_DUAL.

const FIXTURE_M6_STABLE_DUAL = {
  ...TARGET,
  checkIn:   '2026-10-11',
  checkOut:  '2026-10-14',
  today:     '2026-09-27',

  airbnbSnapshots: [
    makeAirbnbSnapshot('j14-s1', AIRBNB_LISTINGS_S1),  // low  (~100)
    makeAirbnbSnapshot('j14-s2', AIRBNB_LISTINGS_S2),  // high (~130)
    makeAirbnbSnapshot('j14-s3', AIRBNB_LISTINGS_S3),  // mid  (~116)
  ],

  bookingResult: makeBookingResult(BOOKING_LISTINGS_STABLE),

  expectedMarketStatus: 'STABLE_DUAL',
};

// ── FIXTURE: J14 — Multidate BAD (inconsistent snapshots) ────────────────────
// S1 normal, S2 spiked 3× (anomalous), S3 normal — M6 detects HIGH severity spike.

const FIXTURE_M6_MULTIDATE_J14_BAD = {
  ...TARGET,
  checkIn:   '2026-10-11',
  checkOut:  '2026-10-14',
  today:     '2026-09-27',

  airbnbSnapshots: [
    makeAirbnbSnapshot('j14bad-s1', AIRBNB_LISTINGS_S3),
    makeAirbnbSnapshot('j14bad-s2', AIRBNB_LISTINGS_S3.map(l => ({ ...l, price: l.price * 3 }))),
    makeAirbnbSnapshot('j14bad-s3', AIRBNB_LISTINGS_S3.map(l => ({ ...l, price: l.price + 5 }))),
  ],

  bookingResult: makeBookingResult(BOOKING_LISTINGS_STABLE),

  expectedAnomalySeverity: 'HIGH',
};

// ── FIXTURE: J30 ──────────────────────────────────────────────────────────────
// Uses divergent S1/S2 to trigger 3rd call → STABLE_LOCAL_POOL.

const FIXTURE_M6_J30 = {
  ...TARGET,
  checkIn:   '2026-10-27',
  checkOut:  '2026-10-30',
  today:     '2026-09-27',

  airbnbSnapshots: [
    makeAirbnbSnapshot('j30-s1', AIRBNB_LISTINGS_S1),
    makeAirbnbSnapshot('j30-s2', AIRBNB_LISTINGS_S2),
    makeAirbnbSnapshot('j30-s3', AIRBNB_LISTINGS_S3),
  ],

  bookingResult: makeBookingResult(BOOKING_LISTINGS_STABLE),

  expectedMarketStatus: 'STABLE_DUAL',
};

// ── FIXTURE: J60 ──────────────────────────────────────────────────────────────

const FIXTURE_M6_J60 = {
  ...TARGET,
  checkIn:   '2026-11-26',
  checkOut:  '2026-11-29',
  today:     '2026-09-27',

  airbnbSnapshots: [
    makeAirbnbSnapshot('j60-s1', AIRBNB_LISTINGS_S1),
    makeAirbnbSnapshot('j60-s2', AIRBNB_LISTINGS_S2),
    makeAirbnbSnapshot('j60-s3', AIRBNB_LISTINGS_S3),
  ],

  bookingResult: makeBookingResult(BOOKING_LISTINGS_STABLE),

  expectedMarketStatus: 'STABLE_DUAL',
};

// ── PRODUCTION_FIXTURE — simulated market_data DB row ────────────────────────

const PRODUCTION_FIXTURE = {
  id:               999,
  property_id:      'prop-test-1',
  median_price:     118,
  price_p25:        110,
  price_p75:        125,
  comparable_count: 8,
  occupancy_rate:   0.62,
  tension_level:    'medium',
  data_source:      'brightdata_live',
  scraped_at:       '2026-09-27T08:00:00.000Z',
  currency:         'EUR',
};

// ── Snapshot reuse request ────────────────────────────────────────────────────

const REUSE_REQUEST = {
  location:     TARGET.location,
  checkIn:      FIXTURE_M6_STABLE_DUAL.checkIn,
  checkOut:     FIXTURE_M6_STABLE_DUAL.checkOut,
  currency:     TARGET.currency,
  targetGuests: TARGET.targetGuests,
};

// A cached snapshot matching REUSE_REQUEST
const CACHED_SNAPSHOT_VALID = {
  snapshotId:  'snap-cached-1',
  listings:    AIRBNB_LISTINGS_STABLE,
  fingerprint: null, // will be computed in test via buildSnapshotFingerprint
  createdAt:   new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 min ago
  location:     TARGET.location,
  checkIn:      FIXTURE_M6_STABLE_DUAL.checkIn,
  checkOut:     FIXTURE_M6_STABLE_DUAL.checkOut,
  currency:     TARGET.currency,
  targetGuests: TARGET.targetGuests,
};

// A cached snapshot for a different stay window
const CACHED_SNAPSHOT_WRONG_WINDOW = {
  ...CACHED_SNAPSHOT_VALID,
  snapshotId: 'snap-cached-wrong',
  checkIn:    '2026-10-20',
  checkOut:   '2026-10-23',
};

module.exports = {
  TARGET,
  AIRBNB_LISTINGS_S1,
  AIRBNB_LISTINGS_S2,
  AIRBNB_LISTINGS_S3,
  AIRBNB_LISTINGS_STABLE,
  BOOKING_LISTINGS_STABLE,
  BOOKING_LISTINGS_EXTREME,
  FIXTURE_M6_STABLE_DUAL,
  FIXTURE_M6_MULTIDATE_J14_BAD,
  FIXTURE_M6_J30,
  FIXTURE_M6_J60,
  PRODUCTION_FIXTURE,
  REUSE_REQUEST,
  CACHED_SNAPSHOT_VALID,
  CACHED_SNAPSHOT_WRONG_WINDOW,
  makeAirbnbListing,
  makeBookingListing,
  makeAirbnbSnapshot,
  makeBookingResult,
};
