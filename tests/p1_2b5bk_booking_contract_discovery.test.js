'use strict';
/**
 * P1.2-B5-BK-A/B/C — Booking.com Contract Discovery Tests
 *
 * Validates:
 *   - Contract constants (dataset ID, endpoints, confidence levels)
 *   - parseBookingItem field mapping and rejection logic
 *   - toISO8601Timestamp date conversion
 *   - analyzeFieldPresence schema analysis
 *   - previewMode (0 BD calls, 0 DB writes)
 *   - Safety source-text checks
 *   - B5-BK-B: sanitizeErrorBody, redactSecrets
 *   - B5-BK-C: url_collection contract (no discover_new, no discover_by=location,
 *              body url=BOOKING_INPUT_URL, executeMode blocked by default)
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
  executeMode,
  snapshotResumeMode,
  sanitizeErrorBody,
  redactSecrets,
  BOOKING_DATASET_ID,
  BOOKING_TRIGGER_BASE,
  BOOKING_PROGRESS_BASE,
  BOOKING_SNAPSHOT_BASE,
  BOOKING_INPUT_URL,
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

  await test('BK-04 BOOKING_INPUT_URL is https://www.booking.com (B5-BK-C corrected contract)', async () => {
    assert.strictEqual(BOOKING_INPUT_URL, 'https://www.booking.com',
      'url_collection body must use the Booking.com homepage URL (CONFIRMED from official BD docs)');
  });

  await test('BK-05 triggerUrl does NOT contain discover_new (unsupported for this dataset)', async () => {
    const pool   = makeMockPool([MOCK_PROPERTY]);
    const result = await withEnv(
      { MARKET_PRIMARY_PROVIDER: undefined },
      () => previewMode({ name: 'M6', pool, _now: new Date('2026-09-25T12:00:00Z') })
    );
    assert.ok(!result.triggerUrl.includes('discover_new'),
      'discover_new must NOT appear in trigger URL — dataset returned HTTP 400 for this type');
    assert.ok(!result.triggerUrl.includes('discover_by'),
      'discover_by must NOT appear in trigger URL — unsupported for url_collection');
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

  // ── B5-BK-B: sanitizeErrorBody ─────────────────────────────────────────────

  await test('BK-36 sanitizeErrorBody JSON body extracts ERROR_USEFUL_KEYS only', async () => {
    const body   = '{"error":"unauthorized","message":"bad api key","code":401,"extra":"ignored"}';
    const result = sanitizeErrorBody(body, 'application/json', 'dummy_key');
    const parsed = JSON.parse(result);
    assert.ok(parsed.error   !== undefined, 'Expected "error" key');
    assert.ok(parsed.message !== undefined, 'Expected "message" key');
    assert.ok(parsed.code    !== undefined, 'Expected "code" key');
    assert.strictEqual(parsed.extra, undefined, '"extra" is not in ERROR_USEFUL_KEYS — must be filtered out');
  });

  await test('BK-37 sanitizeErrorBody text/plain body returns non-empty string', async () => {
    const body   = 'Error: invalid request — unexpected field';
    const result = sanitizeErrorBody(body, 'text/plain', undefined);
    assert.strictEqual(typeof result, 'string');
    assert.ok(result.includes('Error'), 'Expected text content preserved');
    assert.ok(result.length > 0);
  });

  await test('BK-38 sanitizeErrorBody HTML body returns string without crashing', async () => {
    const body   = '<html><body><h1>403 Forbidden</h1></body></html>';
    const result = sanitizeErrorBody(body, 'text/html', undefined);
    assert.strictEqual(typeof result, 'string');
    assert.ok(result.includes('403'), 'Expected HTML content preserved');
  });

  await test('BK-39 sanitizeErrorBody empty/null/undefined body → (empty response body)', async () => {
    assert.strictEqual(sanitizeErrorBody('',        'application/json', undefined), '(empty response body)');
    assert.strictEqual(sanitizeErrorBody(null,      'application/json', undefined), '(empty response body)');
    assert.strictEqual(sanitizeErrorBody(undefined, 'application/json', undefined), '(empty response body)');
  });

  await test('BK-40 sanitizeErrorBody malformed JSON falls back to raw text', async () => {
    const body   = '{bad json here';
    const result = sanitizeErrorBody(body, 'application/json', undefined);
    assert.strictEqual(typeof result, 'string');
    assert.ok(result.includes('bad json'), 'Expected raw text fallback on JSON parse failure');
  });

  // ── B5-BK-B: redactSecrets ─────────────────────────────────────────────────

  await test('BK-41 redactSecrets redacts literal API key passed as apiKey param', async () => {
    const key    = 'sk-test-abc12345-secretval';
    const text   = `Authorization failed for key value: ${key}`;
    const result = redactSecrets(text, key);
    assert.ok(!result.includes(key),         'API key must not appear in output');
    assert.ok(result.includes('[REDACTED]'), 'Expected [REDACTED] marker');
  });

  await test('BK-42 redactSecrets redacts Bearer token', async () => {
    const text   = 'Bearer eyJhbGciOiJIUzI1NiJ9.abc123xyz';
    const result = redactSecrets(text);
    assert.ok(!result.includes('eyJhbGciOiJIUzI1NiJ9'), 'Bearer value must be redacted');
    assert.strictEqual(result, 'Bearer [REDACTED]');
  });

  await test('BK-43 redactSecrets redacts "authorization" JSON field value', async () => {
    const text   = '{"authorization": "Bearer mysecrettoken"}';
    const result = redactSecrets(text);
    assert.ok(!result.includes('mysecrettoken'), 'authorization value must be redacted');
    assert.ok(result.includes('[REDACTED]'));
  });

  await test('BK-44 redactSecrets redacts "api_key" JSON field value', async () => {
    const text   = '{"api_key": "myprivatekey123"}';
    const result = redactSecrets(text);
    assert.ok(!result.includes('myprivatekey123'), 'api_key value must be redacted');
    assert.ok(result.includes('[REDACTED]'));
  });

  await test('BK-45 redactSecrets redacts "token" JSON field value', async () => {
    const text   = '{"token": "secrettoken456"}';
    const result = redactSecrets(text);
    assert.ok(!result.includes('secrettoken456'), 'token value must be redacted');
    assert.ok(result.includes('[REDACTED]'));
  });

  await test('BK-46 redactSecrets redacts api_key= URL query param', async () => {
    const text   = 'https://api.brightdata.com/datasets/v3/trigger?dataset_id=gd_xyz&api_key=secretkey123&format=json';
    const result = redactSecrets(text);
    assert.ok(!result.includes('secretkey123'),      'api_key value must be redacted from URL');
    assert.ok(result.includes('api_key=[REDACTED]'), 'Expected api_key=[REDACTED] in URL');
  });

  // ── B5-BK-B: previewMode safety ────────────────────────────────────────────

  await test('BK-47 previewMode makes 0 network (fetch) calls', async () => {
    const pool          = makeMockPool([MOCK_PROPERTY]);
    const originalFetch = global.fetch;
    let fetchCallCount  = 0;
    global.fetch        = async () => { fetchCallCount++; return {}; };
    try {
      await withEnv(
        { MARKET_PRIMARY_PROVIDER: undefined },
        () => previewMode({ name: 'M6', pool, _now: new Date('2026-09-25T12:00:00Z') })
      );
    } finally {
      global.fetch = originalFetch;
    }
    assert.strictEqual(fetchCallCount, 0, 'previewMode must not call fetch — BD_CALLS=0');
  });

  await test('BK-48 previewMode issues 0 DB write queries', async () => {
    const queries = [];
    const pool    = {
      query: async (sql) => {
        queries.push(sql.trim().toUpperCase());
        return { rows: [MOCK_PROPERTY] };
      },
    };
    await withEnv(
      { MARKET_PRIMARY_PROVIDER: undefined },
      () => previewMode({ name: 'M6', pool, _now: new Date('2026-09-25T12:00:00Z') })
    );
    const writeQueries = queries.filter(q => /^(INSERT|UPDATE|DELETE|TRUNCATE)/.test(q));
    assert.strictEqual(writeQueries.length, 0,
      'previewMode must not issue INSERT/UPDATE/DELETE queries — DB_WRITES=0');
  });

  // ── B5-BK-B: executeMode safety ────────────────────────────────────────────

  await test('BK-49 executeMode triggers exactly 1 POST to Bright Data trigger endpoint', async () => {
    let postCount   = 0;
    const mockFetch = async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase();
      if (url.includes('trigger') && method === 'POST') {
        postCount++;
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify({ snapshot_id: 'snap-bk49-test' }),
          headers: { get: () => 'application/json' },
        };
      }
      if (url.includes('progress')) {
        return { ok: true, status: 200, json: async () => ({ status: 'ready' }) };
      }
      if (url.includes('snapshot')) {
        return { ok: true, status: 200, json: async () => [SAMPLE_BOOKING_ITEM] };
      }
      throw new Error(`BK-49 unexpected fetch: ${method} ${url}`);
    };
    const pool = makeMockPool([MOCK_PROPERTY]);
    await withEnv(
      { BRIGHTDATA_API_KEY: 'test-key-bk49', MARKET_PRIMARY_PROVIDER: undefined },
      () => executeMode({
        name: 'M6', pool, _bdFetchImpl: mockFetch,
        _now: new Date('2026-09-25T12:00:00Z'),
      })
    );
    assert.strictEqual(postCount, 1, 'executeMode must trigger exactly 1 POST to BD trigger endpoint');
  });

  // ── B5-BK-B: additional source text safety ─────────────────────────────────

  await test('BK-50 diagnostic tool does not write to market_data table', async () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../outils/diag-brightdata-booking.js'), 'utf8'
    );
    assert.ok(!src.includes('INSERT INTO market_data'),
      'diag-brightdata-booking must not write to market_data table');
  });

  await test('BK-51 diagnostic tool does not call runDynamicPricingForOneProperty', async () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../outils/diag-brightdata-booking.js'), 'utf8'
    );
    assert.ok(!src.includes('runDynamicPricingForOneProperty'),
      'diag-brightdata-booking must not call runDynamicPricingForOneProperty');
  });

  await test('BK-52 diagnostic tool does not call sendBookingMessage (Channex)', async () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../outils/diag-brightdata-booking.js'), 'utf8'
    );
    assert.ok(!src.includes('sendBookingMessage'),
      'diag-brightdata-booking must not call Channex sendBookingMessage');
  });

  // ── B5-BK-B: request contract unchanged ────────────────────────────────────

  // ── B5-BK-C: url_collection contract ───────────────────────────────────────

  await test('BK-54 CONTRACT_CONFIDENCE.URL_COLLECTION_SUPPORTED is CONFIRMED', async () => {
    assert.strictEqual(CONTRACT_CONFIDENCE.URL_COLLECTION_SUPPORTED, 'CONFIRMED',
      'url_collection is CONFIRMED supported (real API error + official BD docs)');
  });

  await test('BK-55 CONTRACT_CONFIDENCE.INPUT_URL_FIELD is CONFIRMED', async () => {
    assert.strictEqual(CONTRACT_CONFIDENCE.INPUT_URL_FIELD, 'CONFIRMED',
      'url field in body is CONFIRMED from official BD Listings Search documentation');
  });

  await test('BK-56 CONTRACT_CONFIDENCE.BOOKING_DATASET_ID is CONFIRMED (was INFERRED in B5-BK-A)', async () => {
    assert.strictEqual(CONTRACT_CONFIDENCE.BOOKING_DATASET_ID, 'CONFIRMED',
      'Dataset ID confirmed as "Listings Search" on official Bright Data product page');
  });

  await test('BK-57 snapshotResumeMode makes 0 trigger POSTs (B5-BK-D)', async () => {
    let postCount = 0;
    const mockFetch = async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase();
      if (method === 'POST') { postCount++; return { ok: true, status: 200 }; }
      if (url.includes('progress')) {
        return { ok: true, status: 200, json: async () => ({ status: 'ready' }) };
      }
      if (url.includes('snapshot')) {
        return { ok: true, status: 200, json: async () => [SAMPLE_BOOKING_ITEM] };
      }
      throw new Error(`BK-57 unexpected: ${method} ${url}`);
    };
    await withEnv(
      { BRIGHTDATA_API_KEY: 'test-key-bk57' },
      () => snapshotResumeMode('snap-bk57-test', { _bdFetchImpl: mockFetch })
    );
    assert.strictEqual(postCount, 0, 'snapshotResumeMode must not POST to trigger endpoint');
  });

  await test('BK-58 triggerBookingJob timeout exposes snapshotId on the thrown error (B5-BK-D)', async () => {
    let postCount = 0;
    const mockFetch = async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase();
      if (method === 'POST') {
        postCount++;
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify({ snapshot_id: 'snap-timeout-test' }),
          headers: { get: () => 'application/json' },
        };
      }
      if (url.includes('progress')) {
        return { ok: true, status: 200, json: async () => ({ status: 'pending' }) };
      }
      throw new Error(`BK-58 unexpected: ${method} ${url}`);
    };
    const pool = makeMockPool([MOCK_PROPERTY]);
    const result = await withEnv(
      { BRIGHTDATA_API_KEY: 'test-key-bk58', MARKET_PRIMARY_PROVIDER: undefined },
      () => executeMode({
        name: 'M6', pool, _bdFetchImpl: mockFetch,
        _now: new Date('2026-09-25T12:00:00Z'),
        _bdMaxWaitMs: 0,
      })
    );
    assert.strictEqual(result.ok,      false, 'timeout must return ok=false');
    assert.strictEqual(result.timeout, true,  'timeout must set timeout=true');
    assert.strictEqual(result.snapshotId, 'snap-timeout-test', 'snapshotId must be exposed on timeout');
  });

  // ── B5-BK-D: url_collection body field assertions ──────────────────────────

  await test('BK-59 executeMode trigger body has url=BOOKING_INPUT_URL', async () => {
    let capturedBody;
    const mockFetch = async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase();
      if (method === 'POST') {
        capturedBody = JSON.parse(opts.body);
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify({ snapshot_id: 'snap-bk59' }),
          headers: { get: () => 'application/json' },
        };
      }
      if (url.includes('progress')) return { ok: true, status: 200, json: async () => ({ status: 'ready' }) };
      if (url.includes('snapshot')) return { ok: true, status: 200, json: async () => [SAMPLE_BOOKING_ITEM] };
      throw new Error(`BK-59 unexpected: ${url}`);
    };
    const pool = makeMockPool([MOCK_PROPERTY]);
    await withEnv(
      { BRIGHTDATA_API_KEY: 'test-key-bk59', MARKET_PRIMARY_PROVIDER: undefined },
      () => executeMode({ name: 'M6', pool, _bdFetchImpl: mockFetch, _now: new Date('2026-09-25T12:00:00Z') })
    );
    assert.ok(Array.isArray(capturedBody), 'trigger body must be an array');
    assert.strictEqual(capturedBody[0].url, BOOKING_INPUT_URL, 'body[0].url must be BOOKING_INPUT_URL');
  });

  await test('BK-60 executeMode trigger body has location, adults, rooms, currency, check_in, check_out', async () => {
    let capturedBody;
    const mockFetch = async (url, opts = {}) => {
      if ((opts.method || 'GET').toUpperCase() === 'POST') {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 200, text: async () => JSON.stringify({ snapshot_id: 'snap-bk60' }), headers: { get: () => 'application/json' } };
      }
      if (url.includes('progress')) return { ok: true, status: 200, json: async () => ({ status: 'ready' }) };
      if (url.includes('snapshot')) return { ok: true, status: 200, json: async () => [SAMPLE_BOOKING_ITEM] };
    };
    const pool = makeMockPool([MOCK_PROPERTY]);
    await withEnv(
      { BRIGHTDATA_API_KEY: 'test-key-bk60', MARKET_PRIMARY_PROVIDER: undefined },
      () => executeMode({ name: 'M6', pool, _bdFetchImpl: mockFetch, _now: new Date('2026-09-25T12:00:00Z') })
    );
    const b = capturedBody[0];
    assert.ok(typeof b.location === 'string' && b.location, 'body.location must be non-empty string');
    assert.strictEqual(typeof b.adults,   'number', 'body.adults must be a number');
    assert.strictEqual(typeof b.rooms,    'number', 'body.rooms must be a number');
    assert.ok(typeof b.currency === 'string' && b.currency, 'body.currency must be non-empty string');
    assert.ok(b.check_in  && b.check_in.includes('T00:00:00.000Z'),  'check_in must be ISO8601');
    assert.ok(b.check_out && b.check_out.includes('T00:00:00.000Z'), 'check_out must be ISO8601');
  });

  await test('BK-61 source has no type=discover_new query param construction (B5-BK-D)', async () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../outils/diag-brightdata-booking.js'), 'utf8'
    );
    // The old broken contract used type=discover_new in the trigger URL — confirmed HTTP 400.
    // Check the dangerous pattern that caused the error is absent.
    assert.ok(!src.includes('type=discover_new'),
      'type=discover_new must not appear in source — this exact param caused HTTP 400');
    assert.ok(!src.includes('BOOKING_DISCOVERY_TYPE'),
      'BOOKING_DISCOVERY_TYPE constant must be absent — was removed in B5-BK-C');
    assert.ok(!src.includes('BOOKING_DISCOVER_BY'),
      'BOOKING_DISCOVER_BY constant must be absent — was removed in B5-BK-C');
  });

  await test('BK-62 executeMode limit_per_input equals MAX_RECORDS (10)', async () => {
    let capturedUrl = '';
    const mockFetch = async (url, opts = {}) => {
      if ((opts.method || 'GET').toUpperCase() === 'POST') {
        capturedUrl = url;
        return { ok: true, status: 200, text: async () => JSON.stringify({ snapshot_id: 'snap-bk62' }), headers: { get: () => 'application/json' } };
      }
      if (url.includes('progress')) return { ok: true, status: 200, json: async () => ({ status: 'ready' }) };
      if (url.includes('snapshot')) return { ok: true, status: 200, json: async () => [SAMPLE_BOOKING_ITEM] };
    };
    const pool = makeMockPool([MOCK_PROPERTY]);
    await withEnv(
      { BRIGHTDATA_API_KEY: 'test-key-bk62', MARKET_PRIMARY_PROVIDER: undefined },
      () => executeMode({ name: 'M6', pool, _bdFetchImpl: mockFetch, _now: new Date('2026-09-25T12:00:00Z') })
    );
    assert.ok(capturedUrl.includes(`limit_per_input=${MAX_RECORDS}`),
      `trigger URL must include limit_per_input=${MAX_RECORDS}`);
  });

  await test('BK-63 snapshotResumeMode returns ok=true and returnedCount when snapshot ready', async () => {
    const mockFetch = async (url) => {
      if (url.includes('progress')) return { ok: true, status: 200, json: async () => ({ status: 'ready' }) };
      if (url.includes('snapshot')) return { ok: true, status: 200, json: async () => [SAMPLE_BOOKING_ITEM, SAMPLE_BOOKING_ITEM] };
      throw new Error(`BK-63 unexpected: ${url}`);
    };
    const result = await withEnv(
      { BRIGHTDATA_API_KEY: 'test-key-bk63' },
      () => snapshotResumeMode('snap-bk63', { _bdFetchImpl: mockFetch })
    );
    assert.strictEqual(result.ok,            true,          'must return ok=true');
    assert.strictEqual(result.returnedCount, 2,             'must return correct item count');
    assert.strictEqual(result.snapshotId,    'snap-bk63',   'must echo snapshotId');
  });

  await test('BK-64 executeMode trigger body has no type= or discover_new in trigger URL', async () => {
    let capturedUrl = '';
    const mockFetch = async (url, opts = {}) => {
      if ((opts.method || 'GET').toUpperCase() === 'POST') {
        capturedUrl = url;
        return { ok: true, status: 200, text: async () => JSON.stringify({ snapshot_id: 'snap-bk64' }), headers: { get: () => 'application/json' } };
      }
      if (url.includes('progress')) return { ok: true, status: 200, json: async () => ({ status: 'ready' }) };
      if (url.includes('snapshot')) return { ok: true, status: 200, json: async () => [SAMPLE_BOOKING_ITEM] };
    };
    const pool = makeMockPool([MOCK_PROPERTY]);
    await withEnv(
      { BRIGHTDATA_API_KEY: 'test-key-bk64', MARKET_PRIMARY_PROVIDER: undefined },
      () => executeMode({ name: 'M6', pool, _bdFetchImpl: mockFetch, _now: new Date('2026-09-25T12:00:00Z') })
    );
    assert.ok(!capturedUrl.includes('type='),        'type= must not appear in trigger URL');
    assert.ok(!capturedUrl.includes('discover_new'), 'discover_new must not appear in trigger URL');
    assert.ok(!capturedUrl.includes('discover_by'),  'discover_by must not appear in trigger URL');
  });

  await test('BK-53 previewMode requestBody uses B5-BK-C url_collection contract', async () => {
    const pool   = makeMockPool([MOCK_PROPERTY]);
    const result = await withEnv(
      { MARKET_PRIMARY_PROVIDER: undefined },
      () => previewMode({ name: 'M6', pool, _now: new Date('2026-09-25T12:00:00Z') })
    );
    assert.ok(result.ok, 'previewMode must succeed');
    // triggerUrl: has dataset_id but NO discover_new / discover_by (B5-BK-C correction)
    assert.ok(result.triggerUrl.includes(BOOKING_DATASET_ID),
      'triggerUrl must include BOOKING_DATASET_ID');
    assert.ok(!result.triggerUrl.includes('discover_new'),
      'discover_new must NOT be in trigger URL (HTTP 400 confirmed it is unsupported)');
    assert.ok(!result.triggerUrl.includes('discover_by'),
      'discover_by must NOT be in trigger URL');
    // Request body must include url=BOOKING_INPUT_URL (url_collection contract)
    const body = result.requestBody[0];
    assert.strictEqual(body.url, BOOKING_INPUT_URL,
      'body.url must be BOOKING_INPUT_URL ("https://www.booking.com")');
    // ISO8601 timestamps (CONFIRMED in official BD examples)
    assert.ok(body.check_in.includes('T00:00:00.000Z'),
      'check_in must be ISO8601 timestamp');
    assert.ok(body.check_out.includes('T00:00:00.000Z'),
      'check_out must be ISO8601 timestamp');
    // Mandatory body fields
    assert.ok(typeof body.location === 'string' && body.location,
      'body.location must be a non-empty string');
    assert.ok(typeof body.currency === 'string' && body.currency,
      'body.currency must be a non-empty string');
    assert.strictEqual(typeof body.adults, 'number', 'body.adults must be a number');
    assert.strictEqual(typeof body.rooms,  'number', 'body.rooms must be a number');
  });

})();
