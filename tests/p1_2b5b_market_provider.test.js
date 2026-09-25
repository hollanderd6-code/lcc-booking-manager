#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.2-B5-B Market Provider Abstraction
 *
 * Verifies:
 *   MP-01 : parseApifyItem produces identical NormalizedListing output as cron
 *   MP-02 : parseApifyItem returns null for items with no valid price
 *   MP-03 : parseApifyItem supports all price shape variants
 *   MP-04 : scrapeZoneApify returns isMock=true / dataSource='mock' without APIFY_TOKEN
 *   MP-05 : scrapeZoneApify returns provider='apify' in all cases
 *   MP-06 : scrapeZoneApify dataSource='apify_live' on live success
 *   MP-07 : scrapeZoneApify falls back to mock on Apify HTTP error
 *   MP-08 : requestedCurrency reaches Apify request body unchanged
 *   MP-09 : scrapeApify throws when requestedCurrency is absent
 *   MP-10 : scrapeApify throws when APIFY_TOKEN absent
 *   MP-11 : marketProvider.scrape throws when requestedCurrency is absent
 *   MP-12 : marketProvider.scrape delegates to Apify in mock mode
 *   MP-13 : calcMarketStats output unchanged for identical fixtures (regression)
 *   MP-14 : no Bright Data network path reachable (source analysis)
 *   MP-15 : providers/apify.js declares no DB connection (no pool, no INSERT)
 *   MP-16 : market-provider.js declares no DB connection
 *   MP-17 : providers/apify.js imports no channex module
 *   MP-18 : market-provider.js imports no channex module
 *   MP-19 : pricing engine (pricing-apply.js) does not import market-provider
 *   MP-20 : dynamic-pricing-cron.js does not import market-provider (cron unchanged)
 *
 * Run: node tests/p1_2b5b_market_provider.test.js
 * BRIGHTDATA_CALLS = 0  DB_WRITES = 0  CHANNEX_CALLS = 0  APIFY_CALLS = 0
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
const APIFY_PATH    = path.resolve(__dirname, '../services/providers/apify.js');
const PROVIDER_PATH = path.resolve(__dirname, '../services/market-provider.js');
const CRON_PATH     = path.resolve(__dirname, '../routes/dynamic-pricing-cron.js');
const APPLY_PATH    = path.resolve(__dirname, '../routes/pricing-apply.js');

const APIFY_SRC    = fs.readFileSync(APIFY_PATH,    'utf8');
const PROVIDER_SRC = fs.readFileSync(PROVIDER_PATH, 'utf8');
const CRON_SRC     = fs.readFileSync(CRON_PATH,     'utf8');
const APPLY_SRC    = fs.readFileSync(APPLY_PATH,    'utf8');

const {
  parseApifyItem,
  getMockListings,
  scrapeApify,
  scrapeZoneApify,
  APIFY_ACTOR_ID,
} = require(APIFY_PATH);

const marketProvider = require(PROVIDER_PATH);
const { calcMarketStats } = require(CRON_PATH);

// ── Tests ─────────────────────────────────────────────────────────────────────

(async () => {

// ── MP-01 : parseApifyItem output matches cron parseApifyItem ─────────────────
console.log('\n── MP-01 : parseApifyItem output matches cron parseApifyItem ──');

await test('MP-01 parseApifyItem produces identical output for standard item shape', async () => {
  const item = {
    price:        85,
    isAvailable:  true,
    bedrooms:     2,
    stars:        4.7,
    bookingDates: [],
  };
  const result = parseApifyItem(item);
  assert.ok(result !== null, 'must return a listing');
  assert.strictEqual(result.price,    85,   'price = 85');
  assert.strictEqual(result.isBooked, false, 'isBooked = false');
  assert.strictEqual(result.bedrooms, 2,    'bedrooms = 2');
  assert.strictEqual(result.stars,    4.7,  'stars = 4.7');
});

// ── MP-02 : parseApifyItem null for no price ──────────────────────────────────
console.log('\n── MP-02 : parseApifyItem returns null for no valid price ──');

await test('MP-02 parseApifyItem returns null when item has no valid price', async () => {
  assert.strictEqual(parseApifyItem({}),               null, 'empty item → null');
  assert.strictEqual(parseApifyItem({ price: 0 }),     null, 'price=0 → null');
  assert.strictEqual(parseApifyItem({ price: -5 }),    null, 'negative price → null');
  assert.strictEqual(parseApifyItem({ price: null }),  null, 'price=null → null');
  assert.strictEqual(parseApifyItem({ bedrooms: 2 }),  null, 'bedrooms but no price → null');
});

// ── MP-03 : parseApifyItem supports all price shape variants ──────────────────
console.log('\n── MP-03 : parseApifyItem supports all price shape variants ──');

await test('MP-03 parseApifyItem handles all documented price shapes', async () => {
  assert.strictEqual(parseApifyItem({ price: 90 })?.price,                              90, 'numeric price');
  assert.strictEqual(parseApifyItem({ price: { rate: { amount: '75' } } })?.price,      75, 'price.rate.amount');
  assert.strictEqual(parseApifyItem({ price: { total: { amount: '110' } } })?.price,   110, 'price.total.amount');
  assert.strictEqual(parseApifyItem({ pricing: { rate: '65' } })?.price,                65, 'pricing.rate');
  assert.strictEqual(parseApifyItem({ nightly_price: '80' })?.price,                    80, 'nightly_price');
});

// ── MP-04 : mock mode when no APIFY_TOKEN ─────────────────────────────────────
console.log('\n── MP-04 : scrapeZoneApify returns mock without APIFY_TOKEN ──');

await test('MP-04 scrapeZoneApify returns isMock=true and dataSource=mock when APIFY_TOKEN absent', async () => {
  const saved = process.env.APIFY_TOKEN;
  delete process.env.APIFY_TOKEN;
  try {
    const result = await scrapeZoneApify('Massy, France', 10, 'EUR', 80);
    assert.strictEqual(result.isMock,     true,   'isMock must be true');
    assert.strictEqual(result.dataSource, 'mock', 'dataSource must be "mock"');
    assert.ok(Array.isArray(result.listings) && result.listings.length > 0, 'listings must be non-empty array');
  } finally {
    if (saved !== undefined) process.env.APIFY_TOKEN = saved;
  }
});

// ── MP-05 : provider='apify' in all cases ─────────────────────────────────────
console.log('\n── MP-05 : provider field is always "apify" ──');

await test('MP-05 scrapeZoneApify always returns provider="apify"', async () => {
  const saved = process.env.APIFY_TOKEN;
  delete process.env.APIFY_TOKEN;
  try {
    const result = await scrapeZoneApify('Paris, France', 10, 'EUR', 80);
    assert.strictEqual(result.provider, 'apify', 'provider must be "apify"');
  } finally {
    if (saved !== undefined) process.env.APIFY_TOKEN = saved;
  }
});

// ── MP-06 : dataSource='apify_live' on live success ───────────────────────────
console.log('\n── MP-06 : dataSource=apify_live on successful live scrape ──');

await test('MP-06 scrapeZoneApify returns dataSource=apify_live on live success', async () => {
  const FAKE_TOKEN = 'fake-apify-token-mp06';
  const saved = process.env.APIFY_TOKEN;
  process.env.APIFY_TOKEN = FAKE_TOKEN;
  try {
    const mockFetch = async (url, opts) => {
      if (url.includes('/runs')) {
        return { ok: true, json: async () => ({ data: { id: 'run-1', defaultDatasetId: 'ds-1' } }) };
      }
      if (url.includes('/actor-runs/')) {
        return { ok: true, json: async () => ({ data: { status: 'SUCCEEDED' } }) };
      }
      if (url.includes('/datasets/')) {
        return {
          ok:   true,
          json: async () => [
            { price: 80, isAvailable: true, bedrooms: 1, stars: 4.5 },
            { price: 95, isAvailable: false, bedrooms: 2, stars: 4.8 },
          ],
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };
    const result = await scrapeZoneApify('Massy, France', 10, 'EUR', 80, mockFetch);
    assert.strictEqual(result.isMock,     false,        'isMock must be false on live success');
    assert.strictEqual(result.dataSource, 'apify_live', 'dataSource must be "apify_live"');
    assert.strictEqual(result.provider,   'apify',      'provider must be "apify"');
    assert.ok(result.listings.length >= 2,              'listings must contain parsed items');
  } finally {
    if (saved !== undefined) process.env.APIFY_TOKEN = saved;
    else delete process.env.APIFY_TOKEN;
  }
});

// ── MP-07 : Apify error → mock fallback ───────────────────────────────────────
console.log('\n── MP-07 : scrapeZoneApify falls back to mock on Apify error ──');

await test('MP-07 scrapeZoneApify returns isMock=true when Apify HTTP call fails', async () => {
  const saved = process.env.APIFY_TOKEN;
  process.env.APIFY_TOKEN = 'fake-token-mp07';
  try {
    const failFetch = async () => ({ ok: false, status: 500, text: async () => 'internal error' });
    const result = await scrapeZoneApify('Lyon, France', 10, 'EUR', 80, failFetch);
    assert.strictEqual(result.isMock,     true,   'isMock must be true on error fallback');
    assert.strictEqual(result.dataSource, 'mock', 'dataSource must be "mock" on fallback');
    assert.ok(Array.isArray(result.listings) && result.listings.length > 0,
      'listings must be non-empty mock data');
  } finally {
    if (saved !== undefined) process.env.APIFY_TOKEN = saved;
    else delete process.env.APIFY_TOKEN;
  }
});

// ── MP-08 : requestedCurrency reaches Apify body ──────────────────────────────
console.log('\n── MP-08 : requestedCurrency reaches Apify request body ──');

await test('MP-08 scrapeApify sends requestedCurrency in Apify request body', async () => {
  const saved = process.env.APIFY_TOKEN;
  process.env.APIFY_TOKEN = 'fake-token-mp08';
  const capturedBodies = [];
  const mockFetch = async (url, opts) => {
    if (url.includes('/runs')) {
      if (opts?.body) capturedBodies.push(JSON.parse(opts.body));
      return { ok: true, json: async () => ({ data: { id: 'run-1', defaultDatasetId: 'ds-1' } }) };
    }
    if (url.includes('/actor-runs/')) return { ok: true, json: async () => ({ data: { status: 'SUCCEEDED' } }) };
    if (url.includes('/datasets/'))   return { ok: true, json: async () => [] };
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    await scrapeApify('Massy, France', 10, 'GBP', mockFetch);
    assert.ok(capturedBodies.length > 0, 'must have captured the trigger body');
    assert.strictEqual(capturedBodies[0].currency, 'GBP',
      `requestedCurrency must be 'GBP' in body, got: ${capturedBodies[0].currency}`);
    assert.ok(capturedBodies[0].locationQueries?.includes('Massy, France'),
      'location must be in locationQueries');
  } finally {
    if (saved !== undefined) process.env.APIFY_TOKEN = saved;
    else delete process.env.APIFY_TOKEN;
  }
});

// ── MP-09 : scrapeApify throws on missing requestedCurrency ───────────────────
console.log('\n── MP-09 : scrapeApify throws when requestedCurrency missing ──');

await test('MP-09 scrapeApify throws when requestedCurrency is null or empty', async () => {
  const saved = process.env.APIFY_TOKEN;
  process.env.APIFY_TOKEN = 'fake-token-mp09';
  try {
    await assert.rejects(
      () => scrapeApify('Massy, France', 10, null),
      /requestedCurrency|EUR/,
      'must throw on null requestedCurrency'
    );
    await assert.rejects(
      () => scrapeApify('Massy, France', 10, ''),
      /requestedCurrency|EUR/,
      'must throw on empty requestedCurrency'
    );
  } finally {
    if (saved !== undefined) process.env.APIFY_TOKEN = saved;
    else delete process.env.APIFY_TOKEN;
  }
});

// ── MP-10 : scrapeApify throws when APIFY_TOKEN absent ────────────────────────
console.log('\n── MP-10 : scrapeApify throws when APIFY_TOKEN absent ──');

await test('MP-10 scrapeApify throws when APIFY_TOKEN environment variable is not set', async () => {
  const saved = process.env.APIFY_TOKEN;
  delete process.env.APIFY_TOKEN;
  try {
    await assert.rejects(
      () => scrapeApify('Massy, France', 10, 'EUR'),
      /APIFY_TOKEN/,
      'must throw mentioning APIFY_TOKEN'
    );
  } finally {
    if (saved !== undefined) process.env.APIFY_TOKEN = saved;
  }
});

// ── MP-11 : marketProvider.scrape throws on missing requestedCurrency ─────────
console.log('\n── MP-11 : marketProvider.scrape throws when requestedCurrency missing ──');

await test('MP-11 marketProvider.scrape throws when requestedCurrency is absent', async () => {
  await assert.rejects(
    () => marketProvider.scrape('Massy, France', 10, null),
    /requestedCurrency|EUR/,
    'must throw on null requestedCurrency'
  );
  await assert.rejects(
    () => marketProvider.scrape('Massy, France', 10, ''),
    /requestedCurrency|EUR/,
    'must throw on empty requestedCurrency'
  );
});

// ── MP-12 : marketProvider.scrape delegates to Apify in mock mode ─────────────
console.log('\n── MP-12 : marketProvider.scrape delegates to Apify (mock mode) ──');

await test('MP-12 marketProvider.scrape returns provider=apify and valid result in mock mode', async () => {
  const saved = process.env.APIFY_TOKEN;
  delete process.env.APIFY_TOKEN;
  try {
    const result = await marketProvider.scrape('Paris, France', 10, 'EUR', { medianFallback: 90 });
    assert.strictEqual(result.provider,   'apify', 'provider must be "apify"');
    assert.strictEqual(result.isMock,     true,    'isMock must be true without token');
    assert.strictEqual(result.dataSource, 'mock',  'dataSource must be "mock"');
    assert.ok(Array.isArray(result.listings),       'listings must be an array');
    assert.ok(result.listings.length > 0,           'listings must be non-empty');
    result.listings.forEach((l, i) => {
      assert.ok(typeof l.price    === 'number' && l.price    > 0, `listing ${i}: price must be > 0`);
      assert.ok(typeof l.isBooked === 'boolean',                  `listing ${i}: isBooked must be boolean`);
      assert.ok(typeof l.bedrooms === 'number',                   `listing ${i}: bedrooms must be number`);
      assert.ok(typeof l.stars    === 'number',                   `listing ${i}: stars must be number`);
    });
  } finally {
    if (saved !== undefined) process.env.APIFY_TOKEN = saved;
  }
});

// ── MP-13 : calcMarketStats output unchanged (regression) ─────────────────────
console.log('\n── MP-13 : calcMarketStats output unchanged (regression) ──');

await test('MP-13 calcMarketStats from cron.js produces identical output for known fixture', async () => {
  const listings = [
    { price: 60,  isBooked: false, bedrooms: 1, stars: 4.2 },
    { price: 70,  isBooked: true,  bedrooms: 1, stars: 4.5 },
    { price: 80,  isBooked: false, bedrooms: 2, stars: 4.8 },
    { price: 90,  isBooked: true,  bedrooms: 2, stars: 4.0 },
    { price: 100, isBooked: false, bedrooms: 1, stars: 4.6 },
    { price: 110, isBooked: true,  bedrooms: 2, stars: 4.9 },
    { price: 120, isBooked: false, bedrooms: 1, stars: 4.3 },
    { price: 130, isBooked: false, bedrooms: 3, stars: 4.7 },
  ];
  const stats = calcMarketStats(listings);
  assert.ok(stats !== null, 'stats must not be null');
  // Prices sorted: [60,70,80,90,100,110,120,130] — median at index 4 = 100
  assert.strictEqual(stats.median, 100, `median must be 100, got ${stats.median}`);
  // Booked: 70,90,110 → 3/8 = 37.5% → Math.round = 38
  assert.strictEqual(stats.occupancy, 38, `occupancy must be 38, got ${stats.occupancy}`);
  assert.strictEqual(stats.count, 8, 'count must be 8');
  assert.ok(typeof stats.tensionLevel === 'string', 'tensionLevel must be a string');
  assert.ok(stats.p25 < stats.median, 'p25 must be < median');
  assert.ok(stats.p75 > stats.median, 'p75 must be > median');
});

// ── MP-14 : providers/apify.js isolation + B5-D brightdata integration ────────
console.log('\n── MP-14 : providers/apify.js isolation; market-provider.js requires brightdata (B5-D) ──');

await test('MP-14 providers/apify.js has no brightdata refs; market-provider.js requires brightdata (B5-D active)', async () => {
  // apify.js must have zero brightdata references (not even in comments)
  assert.ok(!APIFY_SRC.includes('brightdata.com'),     'apify.js must not reference brightdata.com');
  assert.ok(!APIFY_SRC.includes('BRIGHTDATA_API_KEY'), 'apify.js must not use BRIGHTDATA_API_KEY');
  assert.ok(!APIFY_SRC.includes('brightdata_live'),    'apify.js must not reference brightdata_live');

  // market-provider.js orchestrates both providers — must NOT reference brightdata.com directly
  // (that lives inside providers/brightdata.js), but MUST require the brightdata provider (B5-D).
  const nonComment = src => src.split('\n')
    .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');

  const providerCode = nonComment(PROVIDER_SRC);
  assert.ok(!providerCode.includes('BRIGHTDATA_API_KEY'),
    'market-provider.js non-comment code must not directly use BRIGHTDATA_API_KEY');
  assert.ok(!providerCode.includes('brightdata.com'),
    'market-provider.js non-comment code must not directly call brightdata.com');
  assert.ok(
    providerCode.includes("require('./providers/brightdata')") ||
    providerCode.includes("require('../services/providers/brightdata')"),
    'market-provider.js must require the brightdata provider (B5-D integration active)'
  );
});

// ── MP-15 : providers/apify.js has no DB connection ──────────────────────────
console.log('\n── MP-15 : providers/apify.js has no DB write ──');

await test('MP-15 providers/apify.js does not import pg, Pool, or call INSERT/UPDATE', async () => {
  assert.ok(!APIFY_SRC.includes("require('pg')"),      'no pg import');
  assert.ok(!APIFY_SRC.includes('require("pg")'),      'no pg import (double quotes)');
  assert.ok(!APIFY_SRC.includes('new Pool('),          'no Pool instantiation');
  assert.ok(!APIFY_SRC.includes('INSERT INTO'),        'no INSERT INTO');
  assert.ok(!APIFY_SRC.includes('UPDATE '),            'no UPDATE');
  assert.ok(!APIFY_SRC.includes('pool.query'),         'no pool.query');
  assert.ok(!APIFY_SRC.includes('client.query'),       'no client.query');
});

// ── MP-16 : market-provider.js has no DB connection ──────────────────────────
console.log('\n── MP-16 : market-provider.js has no DB write ──');

await test('MP-16 market-provider.js does not import pg, Pool, or call INSERT/UPDATE', async () => {
  assert.ok(!PROVIDER_SRC.includes("require('pg')"),   'no pg import');
  assert.ok(!PROVIDER_SRC.includes('new Pool('),       'no Pool instantiation');
  assert.ok(!PROVIDER_SRC.includes('INSERT INTO'),     'no INSERT INTO');
  assert.ok(!PROVIDER_SRC.includes('pool.query'),      'no pool.query');
  assert.ok(!PROVIDER_SRC.includes('DATABASE_URL'),    'no DATABASE_URL reference');
});

// ── MP-17 : providers/apify.js imports no channex ─────────────────────────────
console.log('\n── MP-17 : providers/apify.js imports no channex ──');

await test('MP-17 providers/apify.js does not import channex or call channex functions', async () => {
  assert.ok(!APIFY_SRC.includes("require('../channex')"),     'no channex import (../channex)');
  assert.ok(!APIFY_SRC.includes("require('./channex')"),      'no channex import (./channex)');
  assert.ok(!APIFY_SRC.includes('triggerChannexRatesSync'),   'no triggerChannexRatesSync');
  assert.ok(!APIFY_SRC.includes('sendBookingMessage'),        'no sendBookingMessage');
});

// ── MP-18 : market-provider.js imports no channex ────────────────────────────
console.log('\n── MP-18 : market-provider.js imports no channex ──');

await test('MP-18 market-provider.js does not import channex', async () => {
  assert.ok(!PROVIDER_SRC.includes("require('../channex')"),  'no channex import (../channex)');
  assert.ok(!PROVIDER_SRC.includes("require('./channex')"),   'no channex import (./channex)');
  assert.ok(!PROVIDER_SRC.includes('triggerChannexRatesSync'),'no triggerChannexRatesSync');
});

// ── MP-19 : pricing engine does not import market-provider ───────────────────
console.log('\n── MP-19 : pricing-apply.js does not import market-provider ──');

await test('MP-19 pricing-apply.js does not import market-provider or providers/apify', async () => {
  assert.ok(!APPLY_SRC.includes('market-provider'), 'pricing-apply.js must not import market-provider');
  assert.ok(!APPLY_SRC.includes('providers/apify'),  'pricing-apply.js must not import providers/apify');
});

// ── MP-20 : cron imports market-provider (B5-D wired) ────────────────────────
console.log('\n── MP-20 : dynamic-pricing-cron.js imports market-provider (B5-D wired) ──');

await test('MP-20 dynamic-pricing-cron.js imports market-provider (B5-D wired); cron functions intact', async () => {
  assert.ok(CRON_SRC.includes('market-provider'),    'cron must import market-provider in B5-D');
  assert.ok(!CRON_SRC.includes('providers/apify'),   'cron must not directly import providers/apify');
  // Verify cron structure is still intact (source-analysis tests require these)
  assert.ok(/async function scrapeWithApify/.test(CRON_SRC), 'scrapeWithApify must still exist in cron');
  assert.ok(/async function scrapeBestZone/.test(CRON_SRC),  'scrapeBestZone must still exist in cron');
  assert.ok(/async function scrapeZone/.test(CRON_SRC),      'scrapeZone must still exist in cron');
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
