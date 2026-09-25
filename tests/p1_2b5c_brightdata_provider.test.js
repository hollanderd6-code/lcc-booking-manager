#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.2-B5-C Bright Data Provider Adapter
 *
 * Verifies:
 *   BD5C-01 : Fixture A — valid EUR listing → correct NormalizedListing
 *   BD5C-02 : Fixture B — availability: false → isBooked: true
 *   BD5C-03 : Fixture C — availability: "true" (string) → isBooked: false
 *   BD5C-04 : Fixture C — availability: "false" (string) → isBooked: true
 *   BD5C-05 : Fixture D — wrong currency (GBP vs EUR) → rejected (reason=currency)
 *   BD5C-06 : Fixture E — missing currency → rejected
 *   BD5C-07 : Fixture F — null pricing_details → rejected (reason=price)
 *   BD5C-08 : Fixture G — price_per_night null → rejected
 *   BD5C-09 : Fixture H — total_price valid but price_per_night absent → rejected
 *   BD5C-10 : Fixture I — initial_price_per_night valid but price_per_night absent → rejected
 *   BD5C-11 : Fixture J — bedrooms absent → bedrooms: null (never 1)
 *   BD5C-12 : Fixture K — ratings missing → stars: 0
 *   BD5C-13 : Fixture L — no checkIn → throws before any network call
 *   BD5C-14 : Fixture M — checkOut ≤ checkIn OR invalid format → throws before network
 *   BD5C-15 : Full flow: trigger → running → ready → snapshot → NormalizedListings
 *   BD5C-16 : trigger non-2xx → throws
 *   BD5C-17 : malformed trigger JSON → throws
 *   BD5C-18 : missing snapshot_id in trigger response → throws
 *   BD5C-19 : progress non-2xx → throws
 *   BD5C-20 : snapshot status=failed → throws
 *   BD5C-21 : timeout (maxWaitMs=0) → throws before any progress call
 *   BD5C-22 : snapshot non-2xx → throws
 *   BD5C-23 : non-array snapshot → throws
 *   BD5C-24 : empty snapshot → returns empty listings with diagnostics
 *   BD5C-25 : diagnostics — all five counters correct across mixed fixture
 *   BD5C-26 : requestedCurrency missing → throws before network call
 *   BD5C-27 : BRIGHTDATA_API_KEY absent (no apiKey opt) → throws before network call
 *   BD5C-28 : API key value never appears in thrown error messages
 *   BD5C-29 : currency normalization — lowercase item.currency matches uppercase requestedCurrency
 *   BD5C-30 : providers/brightdata.js has no DB writes (no pg, no Pool, no INSERT/UPDATE)
 *   BD5C-31 : providers/brightdata.js imports no channex
 *   BD5C-32 : market-provider.js does not require brightdata provider (production still Apify-only)
 *   BD5C-33 : BRIGHTDATA_API_KEY presence alone does not activate Bright Data in marketProvider.scrape
 *   BD5C-34 : DATASET_ID matches the real observed Bright Data dataset
 *   BD5C-35 : market-data-resolver.js still does not trust brightdata_live (B5-D will add it)
 *
 * Run: node tests/p1_2b5c_brightdata_provider.test.js
 * LIVE_BRIGHTDATA_CALLS = 0  DB_WRITES = 0  CHANNEX_WRITES = 0  PRICING_WRITES = 0
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

let passed = 0, failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌  ${name}`);
    console.error(`       ${err.message}`);
    failures.push({ name, message: err.message });
    failed++;
  }
}

// ── Load modules ───────────────────────────────────────────────────────────────
const BD_PATH       = path.resolve(__dirname, '../services/providers/brightdata.js');
const PROVIDER_PATH = path.resolve(__dirname, '../services/market-provider.js');
const RESOLVER_PATH = path.resolve(__dirname, '../routes/market-data-resolver.js');

const BD_SRC       = fs.readFileSync(BD_PATH,       'utf8');
const PROVIDER_SRC = fs.readFileSync(PROVIDER_PATH, 'utf8');
const RESOLVER_SRC = fs.readFileSync(RESOLVER_PATH, 'utf8');

const { parseBrightDataItem, scrapeWithBrightData, DATASET_ID } = require(BD_PATH);
const marketProvider = require(PROVIDER_PATH);

// ── Mock fetch helpers ─────────────────────────────────────────────────────────

function okJson(data) {
  return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
}

function errRes(status) {
  return { ok: false, status, json: async () => { throw new Error('not json'); }, text: async () => '' };
}

// Sequential mock: each step is called in order; extra calls throw.
function makeSeqFetch(steps) {
  let i = 0;
  return async (url, _opts) => {
    const step = steps[i++];
    if (!step) throw new Error(`Unexpected fetch call #${i} to: ${url}`);
    return step(url, _opts);
  };
}

// Standard test opts — short timeouts, injectable fetch, no live calls
const T = {
  checkIn:       '2026-10-06',
  checkOut:      '2026-10-07',
  apiKey:        'TEST_BD_API_KEY_XXXX',
  pollIntervalMs: 0,
  maxWaitMs:      60_000,
};

// ── Tests ──────────────────────────────────────────────────────────────────────

(async () => {

// ════════════════════════════════════════════════════════════
// parseBrightDataItem — fixture tests (A–K)
// ════════════════════════════════════════════════════════════

console.log('\n── BD5C-01 : Fixture A — valid EUR listing → correct NormalizedListing ──');
await test('BD5C-01 Fixture A — valid EUR listing → correct NormalizedListing', async () => {
  const item = {
    currency:        'EUR',
    availability:    true,
    pricing_details: { price_per_night: 203.90, num_of_nights: 1 },
    ratings:         4.96,
  };
  const { listing, reason } = parseBrightDataItem(item, 'EUR');
  assert.strictEqual(reason,           null,    'reason must be null on success');
  assert.strictEqual(listing.price,    203.90,  'price = 203.90');
  assert.strictEqual(listing.isBooked, false,   'isBooked = false (availability: true)');
  assert.strictEqual(listing.bedrooms, null,    'bedrooms = null (no structured source)');
  assert.strictEqual(listing.stars,    4.96,    'stars = 4.96');
});

console.log('\n── BD5C-02 : Fixture B — availability: false → isBooked: true ──');
await test('BD5C-02 Fixture B — availability: false → isBooked: true', async () => {
  const item = {
    currency:        'EUR',
    availability:    false,
    pricing_details: { price_per_night: 150 },
    ratings:         4.0,
  };
  const { listing } = parseBrightDataItem(item, 'EUR');
  assert.ok(listing !== null, 'listing must not be null');
  assert.strictEqual(listing.isBooked, true, 'isBooked = true when availability: false');
});

console.log('\n── BD5C-03 : Fixture C — availability: "true" (string) → isBooked: false ──');
await test('BD5C-03 Fixture C — availability: "true" (string) → isBooked: false', async () => {
  const item = {
    currency:        'EUR',
    availability:    'true',
    pricing_details: { price_per_night: 100 },
    ratings:         4.0,
  };
  const { listing } = parseBrightDataItem(item, 'EUR');
  assert.ok(listing !== null, 'listing must not be null');
  assert.strictEqual(listing.isBooked, false, 'isBooked = false when availability: "true"');
});

console.log('\n── BD5C-04 : Fixture C — availability: "false" (string) → isBooked: true ──');
await test('BD5C-04 Fixture C — availability: "false" (string) → isBooked: true', async () => {
  const item = {
    currency:        'EUR',
    availability:    'false',
    pricing_details: { price_per_night: 100 },
    ratings:         4.0,
  };
  const { listing } = parseBrightDataItem(item, 'EUR');
  assert.ok(listing !== null, 'listing must not be null');
  assert.strictEqual(listing.isBooked, true, 'isBooked = true when availability: "false"');
});

console.log('\n── BD5C-05 : Fixture D — wrong currency (GBP vs EUR) → rejected ──');
await test('BD5C-05 Fixture D — wrong currency GBP → rejected (reason=currency)', async () => {
  const item = {
    currency:        'GBP',
    availability:    true,
    pricing_details: { price_per_night: 100 },
    ratings:         4.0,
  };
  const { listing, reason } = parseBrightDataItem(item, 'EUR');
  assert.strictEqual(listing, null,       'listing must be null on currency mismatch');
  assert.strictEqual(reason,  'currency', 'reason must be "currency"');
});

console.log('\n── BD5C-06 : Fixture E — missing currency → rejected ──');
await test('BD5C-06 Fixture E — missing item.currency → rejected (reason=currency)', async () => {
  const item = {
    availability:    true,
    pricing_details: { price_per_night: 100 },
    ratings:         4.0,
  };
  const { listing, reason } = parseBrightDataItem(item, 'EUR');
  assert.strictEqual(listing, null,       'listing must be null when currency absent');
  assert.strictEqual(reason,  'currency', 'reason must be "currency"');
});

console.log('\n── BD5C-07 : Fixture F — null pricing_details → rejected (reason=price) ──');
await test('BD5C-07 Fixture F — null pricing_details → rejected (reason=price)', async () => {
  const item = {
    currency:        'EUR',
    availability:    true,
    pricing_details: null,
    ratings:         4.0,
  };
  const { listing, reason } = parseBrightDataItem(item, 'EUR');
  assert.strictEqual(listing, null,    'listing must be null when pricing_details is null');
  assert.strictEqual(reason,  'price', 'reason must be "price"');
});

console.log('\n── BD5C-08 : Fixture G — price_per_night null → rejected ──');
await test('BD5C-08 Fixture G — price_per_night null → rejected (reason=price)', async () => {
  const item = {
    currency:        'EUR',
    availability:    true,
    pricing_details: { price_per_night: null, num_of_nights: 1 },
    ratings:         4.0,
  };
  const { listing, reason } = parseBrightDataItem(item, 'EUR');
  assert.strictEqual(listing, null,    'listing must be null when price_per_night is null');
  assert.strictEqual(reason,  'price', 'reason must be "price"');
});

console.log('\n── BD5C-09 : Fixture H — total_price valid, price_per_night absent → rejected ──');
await test('BD5C-09 Fixture H — total_price valid but price_per_night absent → rejected', async () => {
  const item = {
    currency:        'EUR',
    availability:    true,
    pricing_details: { total_price: 400, num_of_nights: 2 },
    ratings:         4.0,
  };
  const { listing, reason } = parseBrightDataItem(item, 'EUR');
  assert.strictEqual(listing, null,
    'total_price MUST NOT substitute price_per_night — listing must be null');
  assert.strictEqual(reason, 'price');
});

console.log('\n── BD5C-10 : Fixture I — initial_price_per_night only, price_per_night absent → rejected ──');
await test('BD5C-10 Fixture I — initial_price_per_night only → rejected', async () => {
  const item = {
    currency:        'EUR',
    availability:    true,
    pricing_details: { initial_price_per_night: 120 },
    ratings:         4.0,
  };
  const { listing, reason } = parseBrightDataItem(item, 'EUR');
  assert.strictEqual(listing, null,
    'initial_price_per_night MUST NOT substitute price_per_night — listing must be null');
  assert.strictEqual(reason, 'price');
});

console.log('\n── BD5C-11 : Fixture J — bedrooms absent → bedrooms: null ──');
await test('BD5C-11 Fixture J — bedrooms absent → bedrooms: null (never defaulted to 1)', async () => {
  const item = {
    currency:        'EUR',
    availability:    true,
    pricing_details: { price_per_night: 100 },
    ratings:         4.0,
    // no bedrooms, no bedroomsCount, no guests — none of these must be used
  };
  const { listing } = parseBrightDataItem(item, 'EUR');
  assert.ok(listing !== null, 'listing must not be null');
  assert.strictEqual(listing.bedrooms, null,
    'bedrooms must be null — never defaulted to 1 or inferred from guests/beds');
});

console.log('\n── BD5C-12 : Fixture K — ratings missing → stars: 0 ──');
await test('BD5C-12 Fixture K — ratings missing → stars: 0', async () => {
  const item = {
    currency:        'EUR',
    availability:    true,
    pricing_details: { price_per_night: 100 },
    // no ratings field
  };
  const { listing } = parseBrightDataItem(item, 'EUR');
  assert.ok(listing !== null, 'listing must not be null');
  assert.strictEqual(listing.stars, 0, 'stars must be 0 when ratings is missing');
});

// ════════════════════════════════════════════════════════════
// Pre-network validation — Fixtures L, M
// ════════════════════════════════════════════════════════════

console.log('\n── BD5C-13 : Fixture L — no checkIn → throws before any network call ──');
await test('BD5C-13 Fixture L — no checkIn → throws before network call', async () => {
  let fetchCalled = false;
  const fetchImpl = async () => { fetchCalled = true; return okJson({}); };
  await assert.rejects(
    () => scrapeWithBrightData('Lyon, France', 10, 'EUR', {
      checkOut: '2026-10-07',
      apiKey:   'dummy',
      fetchImpl,
    }),
    /checkIn/
  );
  assert.strictEqual(fetchCalled, false, 'No fetch call should occur before validation passes');
});

console.log('\n── BD5C-14 : Fixture M — invalid date range or format → throws before network ──');
await test('BD5C-14 Fixture M — checkOut ≤ checkIn → throws before network call', async () => {
  let fetchCalled = false;
  const fetchImpl = async () => { fetchCalled = true; return okJson({}); };

  // invalid range: checkOut === checkIn
  await assert.rejects(
    () => scrapeWithBrightData('Lyon, France', 10, 'EUR', {
      checkIn: '2026-10-07', checkOut: '2026-10-07',
      apiKey: 'dummy', fetchImpl,
    }),
    /postérieur/
  );
  assert.strictEqual(fetchCalled, false, 'No network call for equal dates');

  // invalid range: checkOut < checkIn
  await assert.rejects(
    () => scrapeWithBrightData('Lyon, France', 10, 'EUR', {
      checkIn: '2026-10-08', checkOut: '2026-10-07',
      apiKey: 'dummy', fetchImpl,
    }),
    /postérieur/
  );
  assert.strictEqual(fetchCalled, false, 'No network call for reversed dates');

  // invalid format
  await assert.rejects(
    () => scrapeWithBrightData('Lyon, France', 10, 'EUR', {
      checkIn: '06/10/2026', checkOut: '2026-10-07',
      apiKey: 'dummy', fetchImpl,
    }),
    /invalide/i
  );
  assert.strictEqual(fetchCalled, false, 'No network call for invalid date format');
});

// ════════════════════════════════════════════════════════════
// Network flow tests
// ════════════════════════════════════════════════════════════

console.log('\n── BD5C-15 : Full flow: trigger → running → ready → snapshot ──');
await test('BD5C-15 Full flow: trigger → running → ready → snapshot → correct listings', async () => {
  const fetchImpl = makeSeqFetch([
    () => okJson({ snapshot_id: 'snap_bd5c15' }),   // trigger
    () => okJson({ status: 'running' }),              // progress #1
    () => okJson({ status: 'ready' }),                // progress #2
    () => okJson([{                                   // snapshot
      currency:        'EUR',
      availability:    true,
      pricing_details: { price_per_night: 203.90 },
      ratings:         4.96,
    }]),
  ]);

  const result = await scrapeWithBrightData('Massy, France', 10, 'EUR', { ...T, fetchImpl });

  assert.strictEqual(result.provider,   'brightdata',      'provider must be "brightdata"');
  assert.strictEqual(result.dataSource, 'brightdata_live', 'dataSource must be "brightdata_live"');
  assert.strictEqual(result.isMock,     false,             'isMock must be false');
  assert.strictEqual(result.listings.length, 1,            'one listing accepted');
  assert.strictEqual(result.listings[0].price,    203.90,  'price = 203.90');
  assert.strictEqual(result.listings[0].isBooked, false,   'isBooked = false');
  assert.strictEqual(result.listings[0].bedrooms, null,    'bedrooms = null');
  assert.strictEqual(result.listings[0].stars,    4.96,    'stars = 4.96');
});

console.log('\n── BD5C-16 : trigger non-2xx → throws ──');
await test('BD5C-16 trigger non-2xx → throws with trigger mention', async () => {
  const fetchImpl = makeSeqFetch([() => errRes(403)]);
  await assert.rejects(
    () => scrapeWithBrightData('Lyon, France', 10, 'EUR', { ...T, fetchImpl }),
    /trigger/
  );
});

console.log('\n── BD5C-17 : malformed trigger JSON → throws ──');
await test('BD5C-17 malformed trigger JSON → throws', async () => {
  const fetchImpl = makeSeqFetch([
    () => ({ ok: true, status: 200, json: async () => { throw new Error('Unexpected token'); }, text: async () => '' }),
  ]);
  await assert.rejects(
    () => scrapeWithBrightData('Lyon, France', 10, 'EUR', { ...T, fetchImpl }),
    /malform|JSON/i
  );
});

console.log('\n── BD5C-18 : missing snapshot_id in trigger response → throws ──');
await test('BD5C-18 missing snapshot_id in trigger response → throws', async () => {
  const fetchImpl = makeSeqFetch([() => okJson({ status: 'ok' })]);
  await assert.rejects(
    () => scrapeWithBrightData('Lyon, France', 10, 'EUR', { ...T, fetchImpl }),
    /snapshot_id/
  );
});

console.log('\n── BD5C-19 : progress non-2xx → throws ──');
await test('BD5C-19 progress non-2xx → throws with progress mention', async () => {
  const fetchImpl = makeSeqFetch([
    () => okJson({ snapshot_id: 'snap_bd5c19' }),
    () => errRes(500),
  ]);
  await assert.rejects(
    () => scrapeWithBrightData('Lyon, France', 10, 'EUR', { ...T, fetchImpl }),
    /progress/
  );
});

console.log('\n── BD5C-20 : snapshot status=failed → throws ──');
await test('BD5C-20 snapshot status=failed → throws', async () => {
  const fetchImpl = makeSeqFetch([
    () => okJson({ snapshot_id: 'snap_bd5c20' }),
    () => okJson({ status: 'failed' }),
  ]);
  await assert.rejects(
    () => scrapeWithBrightData('Lyon, France', 10, 'EUR', { ...T, fetchImpl }),
    /erreur|failed/i
  );
});

console.log('\n── BD5C-21 : timeout (maxWaitMs=0) → throws before any progress call ──');
await test('BD5C-21 timeout (maxWaitMs=0) → throws before progress call', async () => {
  let progressCalled = false;
  const fetchImpl = makeSeqFetch([
    () => okJson({ snapshot_id: 'snap_bd5c21' }),                             // trigger
    () => { progressCalled = true; return okJson({ status: 'running' }); },   // should NOT reach this
  ]);
  await assert.rejects(
    () => scrapeWithBrightData('Lyon, France', 10, 'EUR', { ...T, fetchImpl, maxWaitMs: 0 }),
    /timeout/i
  );
  assert.strictEqual(progressCalled, false,
    'Progress endpoint must not be called when deadline is already past');
});

console.log('\n── BD5C-22 : snapshot non-2xx → throws ──');
await test('BD5C-22 snapshot fetch non-2xx → throws', async () => {
  const fetchImpl = makeSeqFetch([
    () => okJson({ snapshot_id: 'snap_bd5c22' }),
    () => okJson({ status: 'ready' }),
    () => errRes(503),
  ]);
  await assert.rejects(
    () => scrapeWithBrightData('Lyon, France', 10, 'EUR', { ...T, fetchImpl }),
    /snapshot/
  );
});

console.log('\n── BD5C-23 : non-array snapshot → throws ──');
await test('BD5C-23 non-array snapshot → throws', async () => {
  const fetchImpl = makeSeqFetch([
    () => okJson({ snapshot_id: 'snap_bd5c23' }),
    () => okJson({ status: 'ready' }),
    () => okJson({ items: 'not-an-array' }),
  ]);
  await assert.rejects(
    () => scrapeWithBrightData('Lyon, France', 10, 'EUR', { ...T, fetchImpl }),
    /non-tableau|array/i
  );
});

console.log('\n── BD5C-24 : empty snapshot → returns empty listings with zero diagnostics ──');
await test('BD5C-24 empty snapshot → empty listings + zero diagnostics', async () => {
  const fetchImpl = makeSeqFetch([
    () => okJson({ snapshot_id: 'snap_bd5c24' }),
    () => okJson({ status: 'ready' }),
    () => okJson([]),
  ]);
  const result = await scrapeWithBrightData('Lyon, France', 10, 'EUR', { ...T, fetchImpl });
  assert.strictEqual(result.listings.length,                  0, 'listings empty');
  assert.strictEqual(result.diagnostics.returnedCount,        0, 'returnedCount = 0');
  assert.strictEqual(result.diagnostics.acceptedCount,        0, 'acceptedCount = 0');
  assert.strictEqual(result.diagnostics.rejectedPriceCount,   0, 'rejectedPriceCount = 0');
  assert.strictEqual(result.diagnostics.rejectedCurrencyCount, 0, 'rejectedCurrencyCount = 0');
  assert.strictEqual(result.diagnostics.rejectedAvailabilityCount, 0, 'rejectedAvailabilityCount = 0');
});

// ════════════════════════════════════════════════════════════
// Diagnostics
// ════════════════════════════════════════════════════════════

console.log('\n── BD5C-25 : diagnostics — all five counters correct across mixed fixture ──');
await test('BD5C-25 diagnostics counters accurate across 4-item mixed fixture', async () => {
  const items = [
    // accepted (EUR, available, valid price)
    { currency: 'EUR', availability: true,    pricing_details: { price_per_night: 100 }, ratings: 4.0 },
    // currency reject
    { currency: 'GBP', availability: true,    pricing_details: { price_per_night: 100 }, ratings: 4.0 },
    // price reject (no pricing_details)
    { currency: 'EUR', availability: true,    pricing_details: null,                     ratings: 4.0 },
    // availability reject
    { currency: 'EUR', availability: 'maybe', pricing_details: { price_per_night: 100 }, ratings: 4.0 },
  ];
  const fetchImpl = makeSeqFetch([
    () => okJson({ snapshot_id: 'snap_bd5c25' }),
    () => okJson({ status: 'ready' }),
    () => okJson(items),
  ]);
  const result = await scrapeWithBrightData('Lyon, France', 4, 'EUR', { ...T, fetchImpl });

  assert.strictEqual(result.diagnostics.returnedCount,             4, 'returnedCount = 4');
  assert.strictEqual(result.diagnostics.acceptedCount,             1, 'acceptedCount = 1');
  assert.strictEqual(result.diagnostics.rejectedCurrencyCount,     1, 'rejectedCurrencyCount = 1');
  assert.strictEqual(result.diagnostics.rejectedPriceCount,        1, 'rejectedPriceCount = 1');
  assert.strictEqual(result.diagnostics.rejectedAvailabilityCount, 1, 'rejectedAvailabilityCount = 1');
});

// ════════════════════════════════════════════════════════════
// Pre-network validations (continued)
// ════════════════════════════════════════════════════════════

console.log('\n── BD5C-26 : requestedCurrency missing → throws before network ──');
await test('BD5C-26 requestedCurrency missing → throws before network call', async () => {
  let fetchCalled = false;
  await assert.rejects(
    () => scrapeWithBrightData('Lyon', 10, '', {
      ...T,
      fetchImpl: async () => { fetchCalled = true; return okJson({}); },
    }),
    /requestedCurrency/
  );
  assert.strictEqual(fetchCalled, false, 'No network call when requestedCurrency missing');
});

console.log('\n── BD5C-27 : BRIGHTDATA_API_KEY absent → throws before network call ──');
await test('BD5C-27 BRIGHTDATA_API_KEY absent (no apiKey opt) → throws before network', async () => {
  const saved = process.env.BRIGHTDATA_API_KEY;
  delete process.env.BRIGHTDATA_API_KEY;
  let fetchCalled = false;
  try {
    await assert.rejects(
      () => scrapeWithBrightData('Lyon', 10, 'EUR', {
        checkIn:  '2026-10-06',
        checkOut: '2026-10-07',
        fetchImpl: async () => { fetchCalled = true; return okJson({}); },
        pollIntervalMs: 0,
        // no apiKey — falls back to env var which is absent
      }),
      /BRIGHTDATA_API_KEY/
    );
    assert.strictEqual(fetchCalled, false, 'No network call when API key absent');
  } finally {
    if (saved !== undefined) process.env.BRIGHTDATA_API_KEY = saved;
  }
});

// ════════════════════════════════════════════════════════════
// Security — API key must never appear in error messages
// ════════════════════════════════════════════════════════════

console.log('\n── BD5C-28 : API key value never appears in thrown error messages ──');
await test('BD5C-28 API key value never appears in thrown error messages', async () => {
  const SECRET = 'SUPER_SECRET_BD_KEY_BD5C28_XYZW';
  const fetchImpl = makeSeqFetch([() => errRes(401)]);
  let errorMsg = '';
  try {
    await scrapeWithBrightData('Lyon', 10, 'EUR', { ...T, apiKey: SECRET, fetchImpl });
  } catch (e) {
    errorMsg = e.message;
  }
  assert.ok(
    !errorMsg.includes(SECRET),
    `Error message must not contain the API key. Got: "${errorMsg}"`
  );
});

// ════════════════════════════════════════════════════════════
// Currency normalization
// ════════════════════════════════════════════════════════════

console.log('\n── BD5C-29 : currency normalization — lowercase "eur" matches "EUR" ──');
await test('BD5C-29 lowercase item.currency "eur" matches requestedCurrency "EUR"', async () => {
  const item = {
    currency:        'eur',  // lowercase as sometimes returned by API
    availability:    true,
    pricing_details: { price_per_night: 100 },
    ratings:         4.0,
  };
  const { listing, reason } = parseBrightDataItem(item, 'EUR');
  assert.strictEqual(reason, null,  'reason must be null — currencies match after normalization');
  assert.ok(listing !== null,       'listing must not be null');
  assert.strictEqual(listing.price, 100);
});

// ════════════════════════════════════════════════════════════
// Safety / isolation assertions (source-code checks)
// ════════════════════════════════════════════════════════════

console.log('\n── BD5C-30 : providers/brightdata.js has no DB writes ──');
await test('BD5C-30 providers/brightdata.js has no DB writes (no pg, no Pool, no INSERT/UPDATE)', async () => {
  assert.ok(!BD_SRC.includes("require('pg')"),  'No pg import in brightdata.js');
  assert.ok(!BD_SRC.includes('new Pool'),        'No Pool instantiation in brightdata.js');
  assert.ok(!/INSERT\s+INTO/i.test(BD_SRC),      'No INSERT INTO in brightdata.js');
  assert.ok(!/UPDATE\s+\w/i.test(BD_SRC),        'No UPDATE statement in brightdata.js');
  assert.ok(!BD_SRC.includes('pool.query'),      'No pool.query in brightdata.js');
});

console.log('\n── BD5C-31 : providers/brightdata.js imports no channex ──');
await test('BD5C-31 providers/brightdata.js imports no channex', async () => {
  const nonComment = src => src.split('\n')
    .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');
  const code = nonComment(BD_SRC);
  assert.ok(!code.toLowerCase().includes('channex'),
    'brightdata.js must not reference channex in executable code');
});

console.log('\n── BD5C-32 : market-provider.js does not require brightdata ──');
await test('BD5C-32 market-provider.js does not require brightdata provider (Apify-only in production)', async () => {
  assert.ok(
    !PROVIDER_SRC.includes("require('./providers/brightdata')") &&
    !PROVIDER_SRC.includes("require('../services/providers/brightdata')"),
    'market-provider.js must not yet require the brightdata provider (B5-D integration point)'
  );
});

console.log('\n── BD5C-33 : BRIGHTDATA_API_KEY presence alone does not activate Bright Data ──');
await test('BD5C-33 BRIGHTDATA_API_KEY presence alone does not activate Bright Data in marketProvider.scrape', async () => {
  const savedBD    = process.env.BRIGHTDATA_API_KEY;
  const savedApify = process.env.APIFY_TOKEN;
  process.env.BRIGHTDATA_API_KEY = 'TEST_BD_SHOULD_NOT_ACTIVATE';
  delete process.env.APIFY_TOKEN;  // force Apify mock mode

  try {
    const result = await marketProvider.scrape('Lyon, France', 10, 'EUR', { medianFallback: 80 });
    assert.strictEqual(result.provider,   'apify', 'marketProvider.scrape must still return provider="apify"');
    assert.strictEqual(result.dataSource, 'mock',  'Apify mock mode expected (no APIFY_TOKEN)');
    assert.ok(!result.dataSource.includes('brightdata'),
      'dataSource must not include "brightdata" — Bright Data not activated');
  } finally {
    delete process.env.BRIGHTDATA_API_KEY;
    if (savedBD    !== undefined) process.env.BRIGHTDATA_API_KEY = savedBD;
    if (savedApify !== undefined) process.env.APIFY_TOKEN = savedApify;
  }
});

console.log('\n── BD5C-34 : DATASET_ID matches the real observed Bright Data dataset ──');
await test('BD5C-34 DATASET_ID matches gd_ld7ll037kqy322v05 (observed in B5-A3)', async () => {
  assert.strictEqual(DATASET_ID, 'gd_ld7ll037kqy322v05',
    'DATASET_ID must match the real dataset observed during B5-A3 diagnostics');
});

console.log('\n── BD5C-35 : market-data-resolver.js still does not trust brightdata_live ──');
await test('BD5C-35 market-data-resolver.js does not trust brightdata_live (B5-D will add it)', async () => {
  // Resolver currently hardcodes: const trusted = row.data_source === 'apify_live'
  assert.ok(
    !RESOLVER_SRC.includes("'brightdata_live'") &&
    !RESOLVER_SRC.includes('"brightdata_live"'),
    'brightdata_live must not appear as a trusted data_source in resolver — B5-D will add it'
  );
  // Confirm apify_live is still the only trusted source
  assert.ok(
    RESOLVER_SRC.includes("data_source === 'apify_live'"),
    'apify_live must remain the only trusted data_source in resolver'
  );
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`  ${passed} passed, ${failed} failed  /  ${passed + failed} total`);
if (failures.length) {
  console.log('\n  Failed tests:');
  failures.forEach(f => console.log(`    ❌  ${f.name}\n       ${f.message}`));
}
console.log('');

if (failed > 0) process.exit(1);

})();
