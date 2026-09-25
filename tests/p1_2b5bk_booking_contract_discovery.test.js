'use strict';
/**
 * P1.2-B5-BK-A — Booking.com Contract Discovery Tests
 *
 * Validates:
 *   - Contract constants (dataset ID, endpoints, confidence levels)
 *   - parseBookingItem field mapping and rejection logic
 *   - toISO8601Timestamp date conversion
 *   - analyzeFieldPresence schema analysis
 *   - previewMode (0 BD calls, 0 DB writes)
 *   - Safety source-text checks
 *
 * SAFETY:
 *   LIVE_BRIGHTDATA_CALLS = 0
 *   LIVE_DB_CALLS         = 0 (mock pool)
 *   PRICING_WRITES        = 0
 *   CHANNEX_CALLS         = 0
 */

const { test } = require('node:test');
const assert   = require('assert');
const path     = require('path');
const fs       = require('fs');

const {
  parseBookingItem,
  analyzeFieldPresence,
  toISO8601Timestamp,
  normalizeBookingCurrency,
  previewMode,
  BOOKING_DATASET_ID,
  BOOKING_TRIGGER_BASE,
  BOOKING_PROGRESS_BASE,
  BOOKING_SNAPSHOT_BASE,
  BOOKING_DISCOVERY_TYPE,
  BOOKING_DISCOVER_BY,
  CONTRACT_CONFIDENCE,
  MAX_RECORDS,
} = require('../outils/diag-brightdata-booking');

// ── Helper: temp env override ──────────────────────────────────────────────────
function withEnv(overrides, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  try {
    const r = fn();
    if (r && typeof r.then === 'function') return r.finally(restore);
    restore();
    return r;
  } catch (e) { restore(); throw e; }
}

// ── Mock property row ──────────────────────────────────────────────────────────
const MOCK_PROPERTY = {
  id:            'prop-bk-test-0001',
  user_id:       'user-test-001',
  name:          'M6-booking-test',
  internal_name: 'M6',
  address:       '123 Rue de la Paix, Paris',
  latitude:      '48.87',
  longitude:     '2.33',
  country_code:  'FR',
  timezone:      'Europe/Paris',
  currency:      'EUR',
  max_guests:    4,
  bedrooms:      2,
};

function makeMockPool(rows = [MOCK_PROPERTY]) {
  return { query: async () => ({ rows }) };
}

// ── Sample Booking.com item (matches observed HuggingFace schema) ──────────────
const SAMPLE_BOOKING_ITEM = {
  id:             12345678,
  url:            'https://www.booking.com/hotel/fr/test.html',
  title:          'Hotel Test Paris',
  location:       'Paris',
  city:           'Paris',
  address:        '10 Rue Test, Paris',
  full_location:  null,
  final_price:    89,
  original_price: 110,
  currency:       'EUR',
  review_score:   8.6,
  review_count:   234,
  check_in:       '2026-10-09T00:00:00.000Z',
  check_out:      '2026-10-10T00:00:00.000Z',
  adults:         2,
  children:       0,
  rooms:          1,
  nb_bedrooms:    2,
  nb_bathrooms:   1,
  nb_kitchens:    1,
  nb_livingrooms: 1,
  nb_all_beds:    3,
  map_coordinates: null,  // CONFIRMED null in observed data
  free_cancellation: true,
  no_prepayment:  false,
};

(async () => {

  // ── Phase 2 contract constants ──────────────────────────────────────────────

  await test('BK-01 BOOKING_DATASET_ID has gd_ prefix and non-trivial length', async () => {
    assert.ok(
      typeof BOOKING_DATASET_ID === 'string' && BOOKING_DATASET_ID.startsWith('gd_') && BOOKING_DATASET_ID.length > 8,
      `BOOKING_DATASET_ID="${BOOKING_DATASET_ID}" should start with gd_`
    );
  });

  await test('BK-02 BOOKING_TRIGGER_BASE points to BD datasets v3 trigger', async () => {
    assert.ok(BOOKING_TRIGGER_BASE.includes('api.brightdata.com/datasets/v3/trigger'),
      `Expected BD trigger endpoint, got: ${BOOKING_TRIGGER_BASE}`);
  });

  await test('BK-03 BOOKING_PROGRESS_BASE and BOOKING_SNAPSHOT_BASE point to BD v3', async () => {
    assert.ok(BOOKING_PROGRESS_BASE.includes('api.brightdata.com/datasets/v3/progress'));
    assert.ok(BOOKING_SNAPSHOT_BASE.includes('api.brightdata.com/datasets/v3/snapshot'));
  });

  await test('BK-04 BOOKING_DISCOVERY_TYPE is discover_new', async () => {
    assert.strictEqual(BOOKING_DISCOVERY_TYPE, 'discover_new');
  });

  await test('BK-05 BOOKING_DISCOVER_BY is location', async () => {
    assert.strictEqual(BOOKING_DISCOVER_BY, 'location');
  });

  await test('BK-06 MAX_RECORDS is 10 (discovery hard cap)', async () => {
    assert.strictEqual(MAX_RECORDS, 10);
  });

  // ── toISO8601Timestamp ──────────────────────────────────────────────────────

  await test('BK-07 toISO8601Timestamp converts YYYY-MM-DD to ISO8601 full timestamp', async () => {
    assert.strictEqual(toISO8601Timestamp('2026-10-09'), '2026-10-09T00:00:00.000Z');
  });

  await test('BK-08 toISO8601Timestamp appends T00:00:00.000Z suffix', async () => {
    const result = toISO8601Timestamp('2026-12-25');
    assert.ok(result.endsWith('T00:00:00.000Z'), `Expected ISO8601 suffix, got: ${result}`);
    assert.ok(result.startsWith('2026-12-25'), `Expected date prefix, got: ${result}`);
  });

  // ── parseBookingItem ────────────────────────────────────────────────────────

  await test('BK-09 parseBookingItem returns listing for valid item', async () => {
    const { listing, reason } = parseBookingItem(SAMPLE_BOOKING_ITEM, 'EUR');
    assert.ok(listing != null, 'Expected listing, got null');
    assert.strictEqual(reason, null);
    assert.strictEqual(listing.price, 89);
  });

  await test('BK-10 parseBookingItem currency mismatch → reason=currency', async () => {
    const item = { ...SAMPLE_BOOKING_ITEM, currency: 'USD' };
    const { listing, reason } = parseBookingItem(item, 'EUR');
    assert.strictEqual(listing, null);
    assert.strictEqual(reason, 'currency');
  });

  await test('BK-11 parseBookingItem missing final_price → reason=price', async () => {
    const item = { ...SAMPLE_BOOKING_ITEM };
    delete item.final_price;
    const { listing, reason } = parseBookingItem(item, 'EUR');
    assert.strictEqual(listing, null);
    assert.strictEqual(reason, 'price');
  });

  await test('BK-12 parseBookingItem zero final_price → reason=price', async () => {
    const item = { ...SAMPLE_BOOKING_ITEM, final_price: 0 };
    const { listing, reason } = parseBookingItem(item, 'EUR');
    assert.strictEqual(listing, null);
    assert.strictEqual(reason, 'price');
  });

  await test('BK-13 parseBookingItem nb_bedrooms extracted correctly', async () => {
    const { listing } = parseBookingItem(SAMPLE_BOOKING_ITEM, 'EUR');
    assert.strictEqual(listing.bedrooms, 2, 'Expected nb_bedrooms=2');
  });

  await test('BK-14 parseBookingItem nb_bedrooms=0 → bedrooms=null', async () => {
    const item = { ...SAMPLE_BOOKING_ITEM, nb_bedrooms: 0 };
    const { listing } = parseBookingItem(item, 'EUR');
    assert.strictEqual(listing.bedrooms, null);
  });

  await test('BK-15 parseBookingItem review_score normalized to 0-5 scale', async () => {
    const { listing } = parseBookingItem(SAMPLE_BOOKING_ITEM, 'EUR');
    // review_score=8.6 → stars=4.3
    assert.ok(Math.abs(listing.stars - 4.3) < 0.001, `Expected stars=4.3, got ${listing.stars}`);
  });

  await test('BK-16 parseBookingItem review_score=0 → stars=0', async () => {
    const item = { ...SAMPLE_BOOKING_ITEM, review_score: null };
    const { listing } = parseBookingItem(item, 'EUR');
    assert.strictEqual(listing.stars, 0);
  });

  await test('BK-17 parseBookingItem isBooked always false (discovery = available)', async () => {
    const { listing } = parseBookingItem(SAMPLE_BOOKING_ITEM, 'EUR');
    assert.strictEqual(listing.isBooked, false, 'Discovery results must have isBooked=false');
  });

  await test('BK-18 parseBookingItem availableDates always null (no calendar)', async () => {
    const { listing } = parseBookingItem(SAMPLE_BOOKING_ITEM, 'EUR');
    assert.strictEqual(listing.availableDates, null,
      'Booking.com has no available_dates → occupancy proxy NOT FEASIBLE');
  });

  await test('BK-19 parseBookingItem lat/lon null when map_coordinates absent', async () => {
    const { listing } = parseBookingItem(SAMPLE_BOOKING_ITEM, 'EUR');
    assert.strictEqual(listing.latitude, null,
      'map_coordinates=null in observed schema → latitude must be null');
    assert.strictEqual(listing.longitude, null);
  });

  await test('BK-20 parseBookingItem extracts lat/lon from map_coordinates when present', async () => {
    const item = {
      ...SAMPLE_BOOKING_ITEM,
      map_coordinates: { latitude: 48.87, longitude: 2.33 },
    };
    const { listing } = parseBookingItem(item, 'EUR');
    assert.strictEqual(listing.latitude, 48.87);
    assert.strictEqual(listing.longitude, 2.33);
  });

  await test('BK-21 parseBookingItem extracts lat/lon from full_location JSON string', async () => {
    const item = {
      ...SAMPLE_BOOKING_ITEM,
      full_location: JSON.stringify({ latitude: 48.85, longitude: 2.35 }),
    };
    const { listing } = parseBookingItem(item, 'EUR');
    assert.strictEqual(listing.latitude, 48.85);
    assert.strictEqual(listing.longitude, 2.35);
  });

  await test('BK-22 parseBookingItem adults echoed as guests', async () => {
    const { listing } = parseBookingItem(SAMPLE_BOOKING_ITEM, 'EUR');
    assert.strictEqual(listing.guests, 2);
  });

  await test('BK-23 parseBookingItem category always null (no Booking.com equivalent)', async () => {
    const { listing } = parseBookingItem(SAMPLE_BOOKING_ITEM, 'EUR');
    assert.strictEqual(listing.category, null);
  });

  // ── analyzeFieldPresence ────────────────────────────────────────────────────

  await test('BK-24 analyzeFieldPresence counts presence correctly', async () => {
    const items = [
      { final_price: 100, currency: 'EUR', review_score: 8.0, map_coordinates: null },
      { final_price: 150, currency: 'EUR', review_score: null, map_coordinates: null },
    ];
    const result = analyzeFieldPresence(items);
    assert.strictEqual(result.final_price.present, 2);
    assert.strictEqual(result.final_price.pct, 100);
    assert.strictEqual(result.map_coordinates.present, 0);
    assert.strictEqual(result.map_coordinates.pct, 0);
  });

  await test('BK-25 analyzeFieldPresence returns 0% for absent fields', async () => {
    const items = [{ final_price: 89, currency: 'EUR' }];
    const result = analyzeFieldPresence(items);
    assert.strictEqual(result.availability.present, 0,
      'availability field should be absent from Booking.com discovery results');
    assert.strictEqual(result.available_dates.present, 0,
      'available_dates field should be absent — no occupancy proxy possible');
    assert.strictEqual(result.pricing_details.present, 0,
      'pricing_details is Airbnb-specific — should be absent from Booking.com');
  });

  // ── CONTRACT_CONFIDENCE levels ──────────────────────────────────────────────

  await test('BK-26 CONTRACT_CONFIDENCE LAT_LON_AVAILABLE is CONFIRMED false', async () => {
    assert.strictEqual(CONTRACT_CONFIDENCE.LAT_LON_AVAILABLE, 'CONFIRMED',
      'lat/lon absence is CONFIRMED from HuggingFace schema (map_coordinates=null)');
  });

  await test('BK-27 CONTRACT_CONFIDENCE OCCUPANCY_PROXY is CONFIRMED not feasible', async () => {
    assert.strictEqual(CONTRACT_CONFIDENCE.OCCUPANCY_PROXY, 'CONFIRMED',
      'No available_dates in schema → occupancy proxy is CONFIRMED not feasible');
  });

  await test('BK-28 CONTRACT_CONFIDENCE CROSS_PLATFORM_DEDUP is CONFIRMED not feasible', async () => {
    assert.strictEqual(CONTRACT_CONFIDENCE.CROSS_PLATFORM_DEDUP, 'CONFIRMED');
  });

  // ── previewMode (mock DB, 0 BD calls) ──────────────────────────────────────

  await test('BK-29 previewMode returns ok=true with valid property', async () => {
    const pool   = makeMockPool([MOCK_PROPERTY]);
    const result = await withEnv(
      { MARKET_PRIMARY_PROVIDER: undefined },
      () => previewMode({ name: 'M6', pool, _now: new Date('2026-09-25T12:00:00Z') })
    );
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.propertyId, MOCK_PROPERTY.id);
    assert.strictEqual(result.currency, 'EUR');
    assert.ok(result.checkIn, 'Expected checkIn to be set');
    assert.ok(result.checkOut, 'Expected checkOut to be set');
    assert.ok(result.zones && result.zones.length > 0, 'Expected zones array');
  });

  await test('BK-30 previewMode returns ok=false when property not found', async () => {
    const pool   = makeMockPool([]);
    const result = await previewMode({ name: 'NonExistent', pool });
    assert.strictEqual(result.ok, false);
  });

  await test('BK-31 previewMode triggerUrl contains BOOKING_DATASET_ID', async () => {
    const pool   = makeMockPool([MOCK_PROPERTY]);
    const result = await previewMode({ name: 'M6', pool });
    assert.ok(result.triggerUrl && result.triggerUrl.includes(BOOKING_DATASET_ID),
      `Expected triggerUrl to contain ${BOOKING_DATASET_ID}`);
  });

  // ── Safety source-text checks ───────────────────────────────────────────────

  await test('BK-32 diagnostic tool does not reference writeScrapeResult', async () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../outils/diag-brightdata-booking.js'), 'utf8'
    );
    assert.ok(!src.includes('writeScrapeResult'),
      'diag-brightdata-booking must not call writeScrapeResult (no market_data writes)');
  });

  await test('BK-33 diagnostic tool does not reference pricing engine', async () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../outils/diag-brightdata-booking.js'), 'utf8'
    );
    assert.ok(!src.includes('applyDynamicPricingForProperty'),
      'diagnostic tool must never call applyDynamicPricingForProperty');
    assert.ok(!src.includes('pricing-apply'),
      'diagnostic tool must not import pricing-apply module');
  });

  await test('BK-34 diagnostic tool does not reference Channex', async () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../outils/diag-brightdata-booking.js'), 'utf8'
    );
    assert.ok(!src.toLowerCase().includes("require('../channex")
           && !src.toLowerCase().includes("require('./channex"),
      'diagnostic tool must not import channex module');
  });

  await test('BK-35 diagnostic tool does not activate Booking.com production adapter', async () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../outils/diag-brightdata-booking.js'), 'utf8'
    );
    assert.ok(!src.includes('resolveProvider(') && !src.includes('resolveProviderForProperty('),
      'diagnostic tool must not call production provider resolution functions');
    assert.ok(!src.includes("scrape(location"),
      'diagnostic tool must not call market-provider scrape() (production path)');
  });

})();
