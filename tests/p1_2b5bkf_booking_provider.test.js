'use strict';
/**
 * P1.2-B5-BK-F — Booking.com Production Provider Tests
 *
 * Validates:
 *   - parseBrightDataBookingItem: price normalization (STAY_TOTAL/nights),
 *     field mapping, rejection logic, requestedNights validation
 *   - calcBrightDataBookingMarketStats: median, percentiles, occupancy null/unavailable
 *   - scrapeWithBrightDataBooking: url_collection contract, trigger body,
 *     requestedNights propagation, timeout snapshotId, safety invariants
 *   - Source-text safety: 0 DB writes, 0 pricing writes, 0 Channex calls,
 *     BRIGHTDATA_API_KEY never logged
 *
 * SAFETY:
 *   LIVE_BRIGHTDATA_CALLS = 0
 *   LIVE_DB_CALLS         = 0
 *   PRICING_WRITES        = 0
 *   CHANNEX_CALLS         = 0
 */

const { test } = require('node:test');
const assert   = require('assert');
const path     = require('path');
const fs       = require('fs');

const {
  parseBrightDataBookingItem,
  scrapeWithBrightDataBooking,
  BOOKING_DATASET_ID,
  BOOKING_TRIGGER_BASE,
  BOOKING_INPUT_URL,
  BOOKING_DEFAULT_ADULTS,
  BOOKING_DEFAULT_ROOMS,
} = require('../services/providers/brightdata-booking');

const {
  calcBrightDataBookingMarketStats,
  selectComparables,
  MIN_COMPARABLES_FALLBACK,
  LOCAL_PRIORITY_RADIUS_KM,
} = require('../services/brightdata-comparable-filter');

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

// ── Sample items ───────────────────────────────────────────────────────────────

const ITEM_3N = {
  id: 54238,
  url: 'https://www.booking.com/hotel/fr/test.html',
  title: 'Test Apartment Paris',
  location: 'Paris',
  final_price: 147,
  original_price: 165,
  currency: 'EUR',
  review_score: 8.6,
  check_in:  '2026-10-10T00:00:00.000Z',
  check_out: '2026-10-13T00:00:00.000Z',
  adults: 2,
  rooms: 1,
  nb_bedrooms: 2,
  map_coordinates: { lat: 48.87, lon: 2.33 },
  property_type: 'Apartment',
};

const ITEM_1N = {
  id: 54238,
  url: 'https://www.booking.com/hotel/fr/test.html',
  title: 'Test Apartment Paris',
  location: 'Paris',
  final_price: 72,
  original_price: 80,
  currency: 'EUR',
  review_score: 8.6,
  check_in:  '2026-10-10T00:00:00.000Z',
  check_out: '2026-10-11T00:00:00.000Z',
  adults: 2,
  rooms: 1,
  nb_bedrooms: 2,
  map_coordinates: { lat: 48.87, lon: 2.33 },
  property_type: 'Apartment',
};

// ── Mock fetch builder ─────────────────────────────────────────────────────────

function buildMockFetch(items = [ITEM_3N], snapshotId = 'snap-bkf-test') {
  return async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (url.includes('trigger') && method === 'POST') {
      return {
        ok:     true,
        status: 200,
        text:   async () => JSON.stringify({ snapshot_id: snapshotId }),
        headers: { get: () => 'application/json' },
      };
    }
    if (url.includes('progress')) {
      return { ok: true, status: 200, json: async () => ({ status: 'ready' }) };
    }
    if (url.includes('snapshot')) {
      return { ok: true, status: 200, json: async () => items };
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  };
}

(async () => {

  // ── Phase 1: Constants ────────────────────────────────────────────────────────

  await test('BKF-01 BOOKING_DATASET_ID is gd_m4bf7a917zfezv9d5', async () => {
    assert.strictEqual(BOOKING_DATASET_ID, 'gd_m4bf7a917zfezv9d5',
      'Dataset ID must be gd_m4bf7a917zfezv9d5 (BD Listings Search)');
  });

  await test('BKF-02 BOOKING_INPUT_URL is https://www.booking.com', async () => {
    assert.strictEqual(BOOKING_INPUT_URL, 'https://www.booking.com',
      'url_collection body must use the Booking.com homepage URL');
  });

  // ── Phase 2: parseBrightDataBookingItem — price normalization ─────────────────

  await test('BKF-03 price = final_price / requestedNights for 3-night stay (147/3=49)', async () => {
    const { listing, reason } = parseBrightDataBookingItem(ITEM_3N, 'EUR', 3);
    assert.strictEqual(reason, null, 'Expected accepted listing');
    assert.ok(listing != null, 'Expected listing object');
    assert.ok(Math.abs(listing.price - 49) < 0.001,
      `Expected nightly=49 (147/3), got ${listing.price}`);
  });

  await test('BKF-04 price = final_price / 1 for 1-night stay (72/1=72)', async () => {
    const { listing } = parseBrightDataBookingItem(ITEM_1N, 'EUR', 1);
    assert.ok(listing != null);
    assert.ok(Math.abs(listing.price - 72) < 0.001,
      `Expected nightly=72 (72/1), got ${listing.price}`);
  });

  await test('BKF-05 requestedNights=0 throws (not a positive integer)', async () => {
    assert.throws(
      () => parseBrightDataBookingItem(ITEM_3N, 'EUR', 0),
      /requestedNights/,
      'requestedNights=0 must throw'
    );
  });

  await test('BKF-06 requestedNights=-1 throws (not a positive integer)', async () => {
    assert.throws(
      () => parseBrightDataBookingItem(ITEM_3N, 'EUR', -1),
      /requestedNights/,
      'Negative requestedNights must throw'
    );
  });

  await test('BKF-07 requestedNights=1.5 throws (must be integer)', async () => {
    assert.throws(
      () => parseBrightDataBookingItem(ITEM_3N, 'EUR', 1.5),
      /requestedNights/,
      'Non-integer requestedNights must throw'
    );
  });

  // ── Phase 3: parseBrightDataBookingItem — rejection logic ─────────────────────

  await test('BKF-08 null final_price → reason=price', async () => {
    const item = { ...ITEM_3N, final_price: null };
    const { listing, reason } = parseBrightDataBookingItem(item, 'EUR', 3);
    assert.strictEqual(listing, null);
    assert.strictEqual(reason, 'price');
  });

  await test('BKF-09 NaN final_price → reason=price', async () => {
    const item = { ...ITEM_3N, final_price: 'not_a_price' };
    const { listing, reason } = parseBrightDataBookingItem(item, 'EUR', 3);
    assert.strictEqual(listing, null);
    assert.strictEqual(reason, 'price');
  });

  await test('BKF-10 negative final_price → reason=price', async () => {
    const item = { ...ITEM_3N, final_price: -50 };
    const { listing, reason } = parseBrightDataBookingItem(item, 'EUR', 3);
    assert.strictEqual(listing, null);
    assert.strictEqual(reason, 'price');
  });

  await test('BKF-11 currency mismatch → reason=currency', async () => {
    const item = { ...ITEM_3N, currency: 'USD' };
    const { listing, reason } = parseBrightDataBookingItem(item, 'EUR', 3);
    assert.strictEqual(listing, null);
    assert.strictEqual(reason, 'currency');
  });

  // ── Phase 4: parseBrightDataBookingItem — field mapping ───────────────────────

  await test('BKF-12 lat/lon extracted from map_coordinates.lat/.lon (confirmed live field names)', async () => {
    const item = { ...ITEM_3N, map_coordinates: { lat: 48.87, lon: 2.33 } };
    const { listing } = parseBrightDataBookingItem(item, 'EUR', 3);
    assert.strictEqual(listing.latitude,  48.87, 'Expected latitude from .lat field');
    assert.strictEqual(listing.longitude, 2.33,  'Expected longitude from .lon field');
  });

  await test('BKF-13 lat/lon extracted from map_coordinates.latitude/.longitude (variant field names)', async () => {
    const item = { ...ITEM_3N, map_coordinates: { latitude: 48.85, longitude: 2.35 } };
    const { listing } = parseBrightDataBookingItem(item, 'EUR', 3);
    assert.strictEqual(listing.latitude,  48.85);
    assert.strictEqual(listing.longitude, 2.35);
  });

  await test('BKF-14 missing map_coordinates → lat/lon null, listing still accepted', async () => {
    const item = { ...ITEM_3N, map_coordinates: null };
    const { listing, reason } = parseBrightDataBookingItem(item, 'EUR', 3);
    assert.strictEqual(reason, null,  'Missing geo must not cause rejection');
    assert.strictEqual(listing.latitude,  null, 'latitude must be null when map_coordinates absent');
    assert.strictEqual(listing.longitude, null);
  });

  await test('BKF-15 nb_bedrooms > 0 → bedrooms set correctly', async () => {
    const item = { ...ITEM_3N, nb_bedrooms: 3 };
    const { listing } = parseBrightDataBookingItem(item, 'EUR', 3);
    assert.strictEqual(listing.bedrooms, 3);
  });

  await test('BKF-16 nb_bedrooms absent → bedrooms null', async () => {
    const item = { ...ITEM_3N };
    delete item.nb_bedrooms;
    const { listing } = parseBrightDataBookingItem(item, 'EUR', 3);
    assert.strictEqual(listing.bedrooms, null);
  });

  await test('BKF-17 adults NOT mapped to guests — guests always null (adults = input echo)', async () => {
    const item = { ...ITEM_3N, adults: 6 };
    const { listing } = parseBrightDataBookingItem(item, 'EUR', 3);
    assert.strictEqual(listing.guests, null,
      'guests must be null — adults echoes our input, NOT listing capacity');
  });

  await test('BKF-18 property_type → category lowercase', async () => {
    const item = { ...ITEM_3N, property_type: 'Entire apartment' };
    const { listing } = parseBrightDataBookingItem(item, 'EUR', 3);
    assert.strictEqual(listing.category, 'entire apartment');
  });

  await test('BKF-19 property_type absent → category null', async () => {
    const item = { ...ITEM_3N };
    delete item.property_type;
    const { listing } = parseBrightDataBookingItem(item, 'EUR', 3);
    assert.strictEqual(listing.category, null);
  });

  await test('BKF-20 review_score 0-10 → stars = score/2', async () => {
    const item = { ...ITEM_3N, review_score: 9.0 };
    const { listing } = parseBrightDataBookingItem(item, 'EUR', 3);
    assert.ok(Math.abs(listing.stars - 4.5) < 0.001, `Expected stars=4.5, got ${listing.stars}`);
  });

  await test('BKF-21 review_score absent → stars = 0', async () => {
    const item = { ...ITEM_3N };
    delete item.review_score;
    const { listing } = parseBrightDataBookingItem(item, 'EUR', 3);
    assert.strictEqual(listing.stars, 0);
  });

  await test('BKF-22 availableDates always null (no available_dates in Booking.com dataset)', async () => {
    const { listing } = parseBrightDataBookingItem(ITEM_3N, 'EUR', 3);
    assert.strictEqual(listing.availableDates, null,
      'availableDates must be null — occupancy proxy NOT FEASIBLE for Booking.com');
  });

  await test('BKF-23 isBooked always false (discovery = available for requested dates)', async () => {
    const { listing } = parseBrightDataBookingItem(ITEM_3N, 'EUR', 3);
    assert.strictEqual(listing.isBooked, false);
  });

  // ── Phase 5: calcBrightDataBookingMarketStats ─────────────────────────────────

  await test('BKF-24 calcBrightDataBookingMarketStats returns null for empty array', async () => {
    const result = calcBrightDataBookingMarketStats([]);
    assert.strictEqual(result, null);
  });

  await test('BKF-25 calcBrightDataBookingMarketStats returns null when no positive prices', async () => {
    const comparables = [{ price: 0 }, { price: -10 }];
    const result = calcBrightDataBookingMarketStats(comparables);
    assert.strictEqual(result, null);
  });

  await test('BKF-26 standard median for odd count (3 items → middle value)', async () => {
    const comparables = [{ price: 50 }, { price: 100 }, { price: 150 }];
    const result = calcBrightDataBookingMarketStats(comparables);
    assert.strictEqual(result.median, 100, 'Median of [50,100,150] must be 100');
  });

  await test('BKF-27 standard median for even count (4 items → avg of two middle)', async () => {
    const comparables = [{ price: 50 }, { price: 100 }, { price: 120 }, { price: 150 }];
    const result = calcBrightDataBookingMarketStats(comparables);
    assert.strictEqual(result.median, 110, 'Median of [50,100,120,150] must be (100+120)/2=110');
  });

  await test('BKF-28 occupancy is null — never a number (no available_dates)', async () => {
    const comparables = [{ price: 80 }, { price: 90 }, { price: 100 }, { price: 110 }, { price: 120 }];
    const result = calcBrightDataBookingMarketStats(comparables);
    assert.strictEqual(result.occupancy, null,
      'occupancy must be null for Booking.com — never 0 (would imply empty market)');
  });

  await test('BKF-29 occupancy_semantics = "unavailable"', async () => {
    const comparables = [{ price: 80 }, { price: 90 }, { price: 100 }];
    const result = calcBrightDataBookingMarketStats(comparables);
    assert.strictEqual(result.occupancy_semantics, 'unavailable',
      'occupancy_semantics must be "unavailable" for Booking.com');
  });

  await test('BKF-30 tensionLevel is null (no occupancy signal for Booking.com)', async () => {
    const comparables = [{ price: 80 }, { price: 90 }, { price: 100 }];
    const result = calcBrightDataBookingMarketStats(comparables);
    assert.strictEqual(result.tensionLevel, null,
      'tensionLevel must be null — cannot compute without occupancy signal');
  });

  await test('BKF-31 p10/p25/p75/p90 percentiles computed for a 10-item set', async () => {
    const comparables = [10,20,30,40,50,60,70,80,90,100].map(p => ({ price: p }));
    const result = calcBrightDataBookingMarketStats(comparables);
    assert.ok(result.p10 !== undefined, 'p10 must be present');
    assert.ok(result.p25 !== undefined, 'p25 must be present');
    assert.ok(result.p75 !== undefined, 'p75 must be present');
    assert.ok(result.p90 !== undefined, 'p90 must be present');
    assert.ok(result.min === 10, `min must be 10, got ${result.min}`);
    assert.ok(result.max === 100, `max must be 100, got ${result.max}`);
    assert.ok(result.p25 < result.median && result.median < result.p75,
      'p25 < median < p75 ordering');
  });

  await test('BKF-32 count, mean, min, max all present in result', async () => {
    const comparables = [{ price: 60 }, { price: 80 }, { price: 100 }];
    const result = calcBrightDataBookingMarketStats(comparables);
    assert.strictEqual(result.count, 3);
    assert.ok(result.mean > 0, 'mean must be positive');
    assert.strictEqual(result.min, 60);
    assert.strictEqual(result.max, 100);
  });

  // ── Phase 6: scrapeWithBrightDataBooking — contract ───────────────────────────

  await test('BKF-33 trigger body has url=BOOKING_INPUT_URL', async () => {
    let capturedBody;
    const mockFetch = async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase();
      if (method === 'POST') {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 200, text: async () => JSON.stringify({ snapshot_id: 'snap-bkf33' }), headers: { get: () => 'application/json' } };
      }
      if (url.includes('progress')) return { ok: true, status: 200, json: async () => ({ status: 'ready' }) };
      if (url.includes('snapshot')) return { ok: true, status: 200, json: async () => [ITEM_3N] };
    };
    await withEnv({ BRIGHTDATA_API_KEY: 'test-key-bkf33' }, () =>
      scrapeWithBrightDataBooking('Paris', 10, 'EUR', {
        checkIn: '2026-10-10', checkOut: '2026-10-13', fetchImpl: mockFetch,
      })
    );
    assert.ok(Array.isArray(capturedBody), 'trigger body must be an array');
    assert.strictEqual(capturedBody[0].url, BOOKING_INPUT_URL, 'body.url must be BOOKING_INPUT_URL');
  });

  await test('BKF-34 trigger URL has no type= or discover_by= (url_collection implicit)', async () => {
    let capturedUrl = '';
    const mockFetch = async (url, opts = {}) => {
      if ((opts.method || 'GET').toUpperCase() === 'POST') {
        capturedUrl = url;
        return { ok: true, status: 200, text: async () => JSON.stringify({ snapshot_id: 'snap-bkf34' }), headers: { get: () => 'application/json' } };
      }
      if (url.includes('progress')) return { ok: true, status: 200, json: async () => ({ status: 'ready' }) };
      if (url.includes('snapshot')) return { ok: true, status: 200, json: async () => [ITEM_3N] };
    };
    await withEnv({ BRIGHTDATA_API_KEY: 'test-key-bkf34' }, () =>
      scrapeWithBrightDataBooking('Paris', 10, 'EUR', {
        checkIn: '2026-10-10', checkOut: '2026-10-13', fetchImpl: mockFetch,
      })
    );
    assert.ok(!capturedUrl.includes('type='),        'type= must not appear in trigger URL');
    assert.ok(!capturedUrl.includes('discover_new'), 'discover_new must not appear in trigger URL');
    assert.ok(!capturedUrl.includes('discover_by'),  'discover_by must not appear in trigger URL');
  });

  await test('BKF-35 checkIn missing → throws', async () => {
    await assert.rejects(
      () => scrapeWithBrightDataBooking('Paris', 10, 'EUR', { checkOut: '2026-10-13' }),
      /checkIn/,
      'Missing checkIn must throw'
    );
  });

  await test('BKF-36 checkOut missing → throws', async () => {
    await assert.rejects(
      () => scrapeWithBrightDataBooking('Paris', 10, 'EUR', { checkIn: '2026-10-10' }),
      /checkOut/,
      'Missing checkOut must throw'
    );
  });

  await test('BKF-37 checkOut <= checkIn → throws', async () => {
    await assert.rejects(
      () => scrapeWithBrightDataBooking('Paris', 10, 'EUR', {
        checkIn: '2026-10-10', checkOut: '2026-10-09',
      }),
      /strictement/,
      'checkOut before checkIn must throw'
    );
  });

  await test('BKF-38 diagnostics.requestedNights reflects computed nights from checkIn/checkOut', async () => {
    const result = await withEnv({ BRIGHTDATA_API_KEY: 'test-key-bkf38' }, () =>
      scrapeWithBrightDataBooking('Paris', 10, 'EUR', {
        checkIn: '2026-10-10', checkOut: '2026-10-13',
        fetchImpl: buildMockFetch([ITEM_3N]),
      })
    );
    assert.strictEqual(result.diagnostics.requestedNights, 3,
      'requestedNights must be 3 for 3-night span');
  });

  await test('BKF-39 price in returned listings = final_price / requestedNights', async () => {
    const result = await withEnv({ BRIGHTDATA_API_KEY: 'test-key-bkf39' }, () =>
      scrapeWithBrightDataBooking('Paris', 10, 'EUR', {
        checkIn: '2026-10-10', checkOut: '2026-10-13',
        fetchImpl: buildMockFetch([ITEM_3N]),
      })
    );
    assert.ok(result.listings.length > 0, 'Expected at least 1 listing');
    assert.ok(Math.abs(result.listings[0].price - 49) < 0.001,
      `Expected nightly price 147/3=49, got ${result.listings[0].price}`);
  });

  await test('BKF-40 timeout exposes snapshotId on the thrown error', async () => {
    const mockFetch = async (url, opts = {}) => {
      if ((opts.method || 'GET').toUpperCase() === 'POST')
        return { ok: true, status: 200, text: async () => JSON.stringify({ snapshot_id: 'snap-timeout-bkf40' }), headers: { get: () => 'application/json' } };
      if (url.includes('progress'))
        return { ok: true, status: 200, json: async () => ({ status: 'pending' }) };
      throw new Error(`BKF-40 unexpected: ${url}`);
    };
    const err = await withEnv({ BRIGHTDATA_API_KEY: 'test-key-bkf40' }, async () => {
      try {
        await scrapeWithBrightDataBooking('Paris', 10, 'EUR', {
          checkIn: '2026-10-10', checkOut: '2026-10-13',
          fetchImpl: mockFetch, maxWaitMs: 0, pollIntervalMs: 1,
        });
      } catch (e) { return e; }
    });
    assert.ok(err instanceof Error, 'Expected Error to be thrown on timeout');
    assert.strictEqual(err.snapshotId, 'snap-timeout-bkf40',
      'snapshotId must be exposed on the timeout error object');
  });

  await test('BKF-41 trigger URL contains BOOKING_DATASET_ID and limit_per_input', async () => {
    let capturedUrl = '';
    const mockFetch = async (url, opts = {}) => {
      if ((opts.method || 'GET').toUpperCase() === 'POST') {
        capturedUrl = url;
        return { ok: true, status: 200, text: async () => JSON.stringify({ snapshot_id: 'snap-bkf41' }), headers: { get: () => 'application/json' } };
      }
      if (url.includes('progress')) return { ok: true, status: 200, json: async () => ({ status: 'ready' }) };
      if (url.includes('snapshot')) return { ok: true, status: 200, json: async () => [] };
    };
    await withEnv({ BRIGHTDATA_API_KEY: 'test-key-bkf41' }, () =>
      scrapeWithBrightDataBooking('Paris', 50, 'EUR', {
        checkIn: '2026-10-10', checkOut: '2026-10-13', fetchImpl: mockFetch,
      })
    );
    assert.ok(capturedUrl.includes(BOOKING_DATASET_ID),
      'trigger URL must contain BOOKING_DATASET_ID');
    assert.ok(capturedUrl.includes('limit_per_input=50'),
      'trigger URL must contain limit_per_input matching maxListings');
  });

  await test('BKF-42 returns provider="brightdata_booking" and dataSource="brightdata_booking_live"', async () => {
    const result = await withEnv({ BRIGHTDATA_API_KEY: 'test-key-bkf42' }, () =>
      scrapeWithBrightDataBooking('Paris', 10, 'EUR', {
        checkIn: '2026-10-10', checkOut: '2026-10-13',
        fetchImpl: buildMockFetch([ITEM_3N]),
      })
    );
    assert.strictEqual(result.provider,   'brightdata_booking',      'provider must be brightdata_booking');
    assert.strictEqual(result.dataSource, 'brightdata_booking_live', 'dataSource must be brightdata_booking_live');
    assert.strictEqual(result.isMock,     false,                     'isMock must be false');
  });

  await test('BKF-43 check_in/check_out sent as ISO8601 timestamps in trigger body', async () => {
    let capturedBody;
    const mockFetch = async (url, opts = {}) => {
      if ((opts.method || 'GET').toUpperCase() === 'POST') {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 200, text: async () => JSON.stringify({ snapshot_id: 'snap-bkf43' }), headers: { get: () => 'application/json' } };
      }
      if (url.includes('progress')) return { ok: true, status: 200, json: async () => ({ status: 'ready' }) };
      if (url.includes('snapshot')) return { ok: true, status: 200, json: async () => [] };
    };
    await withEnv({ BRIGHTDATA_API_KEY: 'test-key-bkf43' }, () =>
      scrapeWithBrightDataBooking('Paris', 10, 'EUR', {
        checkIn: '2026-10-10', checkOut: '2026-10-13', fetchImpl: mockFetch,
      })
    );
    const b = capturedBody[0];
    assert.ok(b.check_in.includes('T00:00:00.000Z'),  'check_in must be ISO8601 timestamp');
    assert.ok(b.check_out.includes('T00:00:00.000Z'), 'check_out must be ISO8601 timestamp');
  });

  await test('BKF-44 trigger body has adults and rooms with numeric defaults', async () => {
    let capturedBody;
    const mockFetch = async (url, opts = {}) => {
      if ((opts.method || 'GET').toUpperCase() === 'POST') {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 200, text: async () => JSON.stringify({ snapshot_id: 'snap-bkf44' }), headers: { get: () => 'application/json' } };
      }
      if (url.includes('progress')) return { ok: true, status: 200, json: async () => ({ status: 'ready' }) };
      if (url.includes('snapshot')) return { ok: true, status: 200, json: async () => [] };
    };
    await withEnv({ BRIGHTDATA_API_KEY: 'test-key-bkf44' }, () =>
      scrapeWithBrightDataBooking('Paris', 10, 'EUR', {
        checkIn: '2026-10-10', checkOut: '2026-10-13', fetchImpl: mockFetch,
      })
    );
    const b = capturedBody[0];
    assert.strictEqual(b.adults, BOOKING_DEFAULT_ADULTS, `adults must be ${BOOKING_DEFAULT_ADULTS}`);
    assert.strictEqual(b.rooms,  BOOKING_DEFAULT_ROOMS,  `rooms must be ${BOOKING_DEFAULT_ROOMS}`);
  });

  await test('BKF-45 no rejection reason="availability" — Booking.com has no availability field', async () => {
    // parseBrightDataBookingItem must not reject for availability reason
    const item = { ...ITEM_3N };
    delete item.availability;
    const { listing, reason } = parseBrightDataBookingItem(item, 'EUR', 3);
    assert.ok(reason !== 'availability',
      'availability rejection must not occur — Booking.com has no availability field');
    assert.ok(listing != null, 'Item must be accepted even without an availability field');
  });

  // ── Phase 7: Source-text safety ───────────────────────────────────────────────

  await test('BKF-46 provider source: 0 DB writes (no pool, INSERT, UPDATE)', async () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../services/providers/brightdata-booking.js'), 'utf8'
    );
    assert.ok(!src.includes('INSERT INTO'),   'provider must not INSERT — DB_WRITES=0');
    assert.ok(!src.includes('UPDATE '),       'provider must not UPDATE — DB_WRITES=0');
    assert.ok(!src.match(/new Pool\b/) && !src.includes('pool.query'),
      'provider must not use a DB pool — DB_WRITES=0');
  });

  await test('BKF-47 provider source: 0 pricing engine calls', async () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../services/providers/brightdata-booking.js'), 'utf8'
    );
    assert.ok(!src.includes('applyDynamicPricingForProperty'),
      'provider must not call pricing engine');
    assert.ok(!/require\(['"][^'"]*pricing-apply/i.test(src),
      'provider must not require() pricing-apply module');
  });

  await test('BKF-48 provider source: 0 Channex calls', async () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../services/providers/brightdata-booking.js'), 'utf8'
    );
    assert.ok(!src.toLowerCase().includes("require('../channex") &&
              !src.toLowerCase().includes("require('./channex"),
      'provider must not import channex module');
    assert.ok(!src.includes('sendBookingMessage'),
      'provider must not call sendBookingMessage');
  });

  await test('BKF-49 provider source: BRIGHTDATA_API_KEY never logged/printed', async () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../services/providers/brightdata-booking.js'), 'utf8'
    );
    // Ensure the key is only accessed (process.env.BRIGHTDATA_API_KEY) not printed
    const lines = src.split('\n');
    for (const [i, line] of lines.entries()) {
      // Allow reading the env var, but not console.log/error of the key value itself
      if (/console\.(log|error|warn).*BRIGHTDATA_API_KEY/i.test(line)) {
        assert.fail(`Line ${i + 1}: BRIGHTDATA_API_KEY appears in a console statement — must never be logged`);
      }
    }
  });

  await test('BKF-50 provider source: BOOKING_PRODUCTION_ROUTING_ENABLED=NO stated in header', async () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../services/providers/brightdata-booking.js'), 'utf8'
    );
    assert.ok(src.includes('BOOKING_PRODUCTION_ROUTING_ENABLED'),
      'Provider header must document BOOKING_PRODUCTION_ROUTING_ENABLED=NO safety flag');
    assert.ok(!src.includes("require('../services/market-provider") &&
              !src.includes("require('./market-provider"),
      'Provider must not import market-provider (not yet wired in — B5-BK-F scope)');
  });

})();
