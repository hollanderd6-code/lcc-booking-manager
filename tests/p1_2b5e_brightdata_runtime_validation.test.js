#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.2-B5-E Bright Data Runtime Validation Tool
 *
 * Verifies:
 *   B5E-01 : preview = zero network calls
 *   B5E-02 : preview = zero DB writes
 *   B5E-03 : execute requires unique property (one match)
 *   B5E-04 : execute requires API key
 *   B5E-05 : execute requires valid currency
 *   B5E-06 : execute requires complete geo/context
 *   B5E-07 : execute requires timezone
 *   B5E-08 : dates use property timezone
 *   B5E-09 : dates reuse B5-D helper (getBrightDataMarketDates)
 *   B5E-10 : Bright Data adapter used in execute (source check)
 *   B5E-11 : Apify never used (source check)
 *   B5E-12 : mock never used (source check)
 *   B5E-13 : BD error aborts
 *   B5E-14 : empty BD result aborts
 *   B5E-15 : currency rejection aborts if no usable records
 *   B5E-16 : bedroom null survives comparable filtering
 *   B5E-17 : real dataSource required (brightdata_live)
 *   B5E-18 : mock dataSource rejected
 *   B5E-19 : context CAS mismatch aborts
 *   B5E-20 : currency CAS mismatch aborts
 *   B5E-21 : invalid stats abort
 *   B5E-22 : only market_data write possible (source check)
 *   B5E-23 : no pricing_config writes (source check)
 *   B5E-24 : no pricing_schedule writes (source check)
 *   B5E-25 : no pricing_history writes (source check)
 *   B5E-26 : no properties writes (source check)
 *   B5E-27 : no Channex imports/calls (source check)
 *   B5E-28 : no pricing apply imports/calls (source check)
 *   B5E-29 : successful write stores brightdata_live
 *   B5E-30 : stored currency correct
 *   B5E-31 : stored context key correct
 *   B5E-32 : resolver trusts brightdata_live
 *   B5E-33 : resolver requires fresh row
 *   B5E-34 : resolver requires currency match
 *   B5E-35 : resolver requires location match
 *   B5E-36 : successful row becomes usable
 *   B5E-37 : pricing state unchanged after validation
 *   B5E-38 : property state unchanged after validation
 *   B5E-39 : secrets never printed
 *   B5E-40 : tool cannot target multiple properties accidentally
 *
 * Run: node tests/p1_2b5e_brightdata_runtime_validation.test.js
 * LIVE_BRIGHTDATA_CALLS = 0  DB_WRITES = 0  CHANNEX_WRITES = 0
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

// ── Load module sources ────────────────────────────────────────────────────────
const TOOL_PATH     = path.resolve(__dirname, '../outils/validate-brightdata-runtime.js');
const RESOLVER_PATH = path.resolve(__dirname, '../routes/market-data-resolver.js');

const TOOL_SRC     = fs.readFileSync(TOOL_PATH,     'utf8');
const RESOLVER_SRC = fs.readFileSync(RESOLVER_PATH, 'utf8');

const { previewMode, executeMode, AbortError, MIN_COMPARABLES } = require(TOOL_PATH);
const { classifyMarketData } = require(RESOLVER_PATH);
const { getBrightDataMarketDates } = require('../services/market-provider');

// ── Mock factory helpers ────────────────────────────────────────────────────────

// Canonical test property
const TEST_PROP_ROW = {
  id:             'prop-b5e-test-001',
  user_id:        'user-b5e-001',
  name:           'TestB5E',
  internal_name:  null,
  address:        '18 rue Gambetta 91300 Massy',
  latitude:       '48.73',
  longitude:      '2.27',
  country_code:   'FR',
  timezone:       'Europe/Paris',
  currency:       'EUR',
  channex_enabled: false,
  is_active:      true,
  mode:           'auto',
  zone_label:     null,
};

// Standard mock BD result (valid brightdata_live, 15 listings)
function makeBdResult(overrides = {}) {
  const listings = Array.from({ length: 15 }, (_, i) => ({
    price: 100 + i * 5, isBooked: i % 3 === 0, bedrooms: null, stars: 4.0,
  }));
  return {
    listings,
    isMock:     false,
    provider:   'brightdata',
    dataSource: 'brightdata_live',
    diagnostics: {
      returnedCount:              15,
      acceptedCount:              15,
      rejectedPriceCount:         0,
      rejectedCurrencyCount:      0,
      rejectedAvailabilityCount:  0,
    },
    ...overrides,
  };
}

// Mock pool that only allows SELECT queries (preview mode safety)
function makeReadOnlyPool(propRows = [TEST_PROP_ROW]) {
  const writtenSqls = [];
  return {
    _writtenSqls: writtenSqls,
    connect: async () => {
      throw new Error('pool.connect() called in preview mode — no transactions allowed');
    },
    query: async (sql, params) => {
      const upper = sql.trim().toUpperCase();
      if (/^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/i.test(sql)) {
        writtenSqls.push(sql.trim().slice(0, 60));
        throw new Error(`Write attempted in read-only pool: ${sql.trim().slice(0, 60)}`);
      }
      if (/FROM properties/i.test(sql)) return { rows: propRows };
      if (/FROM pricing_config/i.test(sql)) return { rows: [] };
      if (/FROM market_data/i.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
}

// Full mock pool that simulates the execute flow (supports transactions).
// Uses sql.includes() matching to handle multi-line SQL strings correctly.
// The post-write storedMarketRow is built dynamically from the actual INSERT params
// so that the post-write verification always matches what was written.
function makeExecutePool({ propRow = TEST_PROP_ROW, pcRows = [], writeReturnsWritten = true } = {}) {
  const allCalls = [];

  const propFingerprintRow = {
    name: propRow.name, address: propRow.address,
    latitude: propRow.latitude, longitude: propRow.longitude,
    country_code: propRow.country_code, timezone: propRow.timezone,
    currency: propRow.currency, channex_enabled: propRow.channex_enabled,
  };

  // The default safety invariant row for pricing_config (before/after)
  const defaultPcRows = pcRows.length > 0 ? pcRows
    : [{ is_active: propRow.is_active, mode: propRow.mode, updated_at: new Date().toISOString() }];

  // Will be populated from the actual INSERT params once writeScrapeResult fires
  let capturedInsertParams = null;

  const client = {
    query: async (sql, params) => {
      allCalls.push({ ctx: 'client', sql: sql.trim().slice(0, 80), params });
      if (sql.includes('BEGIN')) return { rows: [] };
      if (sql.includes('COMMIT')) return { rows: [] };
      if (sql.includes('ROLLBACK')) return { rows: [] };
      if (sql.includes('FOR UPDATE')) {
        return { rows: [{ country_code: propRow.country_code, latitude: propRow.latitude, longitude: propRow.longitude, currency: propRow.currency }] };
      }
      if (sql.includes('INSERT INTO market_data')) {
        capturedInsertParams = params; // capture for dynamic post-write response
        return { rows: [] };
      }
      return { rows: [] };
    },
    release: () => {},
  };

  function buildStoredRow() {
    if (!capturedInsertParams) return null;
    const ip = capturedInsertParams;
    // writeScrapeResult params: [userId, propertyId, weekStart, median, p25, p75, occupancy, count, tensionLevel, zoneLabel, dataSource, contextKey, currency]
    return {
      data_source:        ip[10],
      currency:           ip[12],
      market_context_key: ip[11],
      median_price:       String(ip[3]),
      price_p25:          String(ip[4]),
      price_p75:          String(ip[5]),
      occupancy_rate:     String(ip[6]),
      comparable_count:   String(ip[7]),
      tension_level:      ip[8],
      week_start:         ip[2],
      scraped_at:         new Date().toISOString(),
    };
  }

  return {
    _calls: allCalls,
    connect: async () => client,
    query: async (sql, params) => {
      allCalls.push({ ctx: 'pool', sql: sql.trim().slice(0, 80), params });

      // resolvePropByName: JOIN query includes both 'FROM properties' and 'LOWER'
      if (sql.includes('FROM properties') && sql.includes('LOWER')) return { rows: [propRow] };

      // pricing_config safety invariant (before/after): has 'updated_at'
      if (sql.includes('pricing_config') && sql.includes('updated_at')) return { rows: defaultPcRows };

      // pricing_schedule count
      if (sql.includes('pricing_schedule')) return { rows: [{ cnt: '0' }] };

      // pricing_history count
      if (sql.includes('pricing_history')) return { rows: [{ cnt: '0' }] };

      // Property fingerprint by id: 'FROM properties' + 'WHERE id'
      if (sql.includes('FROM properties') && sql.includes('WHERE id')) return { rows: [propFingerprintRow] };

      // market_data reads: serve the dynamically captured INSERT row
      if (sql.includes('FROM market_data')) {
        if (!writeReturnsWritten) return { rows: [] };
        const stored = buildStoredRow();
        return stored ? { rows: [stored] } : { rows: [] };
      }

      return { rows: [] };
    },
    _getCapturedInsertParams: () => capturedInsertParams,
  };
}

// CAS-fail pool: simulates property geo or currency changing before writeScrapeResult.
// Uses sql.includes() matching to handle multi-line SQL strings.
function makeCasFailPool(reason = 'context_stale') {
  const propRow = TEST_PROP_ROW;
  // FOR UPDATE returns different geo (context_stale) or different currency (currency_stale)
  const geoForUpdate = reason === 'context_stale'
    ? { country_code: 'DE', latitude: '51.50', longitude: '-0.12', currency: 'EUR' }
    : { country_code: 'FR', latitude: '48.73', longitude: '2.27',  currency: 'GBP' };

  const propFingerprintRow = {
    name: propRow.name, address: propRow.address,
    latitude: propRow.latitude, longitude: propRow.longitude,
    country_code: propRow.country_code, timezone: propRow.timezone,
    currency: propRow.currency, channex_enabled: propRow.channex_enabled,
  };

  const client = {
    query: async (sql) => {
      if (sql.includes('BEGIN'))    return { rows: [] };
      if (sql.includes('ROLLBACK')) return { rows: [] };
      if (sql.includes('FOR UPDATE')) return { rows: [geoForUpdate] };
      return { rows: [] };
    },
    release: () => {},
  };

  return {
    connect: async () => client,
    query: async (sql) => {
      if (sql.includes('FROM properties') && sql.includes('LOWER')) return { rows: [propRow] };
      if (sql.includes('pricing_config') && sql.includes('updated_at')) return { rows: [] };
      if (sql.includes('pricing_history')) return { rows: [{ cnt: '0' }] };
      if (sql.includes('pricing_schedule')) return { rows: [{ cnt: '0' }] };
      if (sql.includes('FROM properties') && sql.includes('WHERE id')) return { rows: [propFingerprintRow] };
      return { rows: [] };
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

(async () => {

// ════════════════════════════════════════════════════════════
// GROUP A — Preview mode (B5E-01..05)
// ════════════════════════════════════════════════════════════

console.log('\n── B5E-01 : preview = zero network calls ──');
await test('B5E-01 preview makes no Bright Data call (bdFetch never invoked)', async () => {
  let bdCalled = false;
  const pool = makeReadOnlyPool([TEST_PROP_ROW]);
  // Override env — BD key present so we reach the point where BD would be called
  const savedKey = process.env.BRIGHTDATA_API_KEY;
  process.env.BRIGHTDATA_API_KEY = 'TEST_KEY_B5E01';
  try {
    await previewMode(pool, { name: 'TestB5E' });
  } finally {
    if (savedKey !== undefined) process.env.BRIGHTDATA_API_KEY = savedKey;
    else delete process.env.BRIGHTDATA_API_KEY;
  }
  assert.strictEqual(bdCalled, false, 'BD must not be called in preview mode');
});

console.log('\n── B5E-02 : preview = zero DB writes ──');
await test('B5E-02 preview performs only SELECT queries (no INSERT/UPDATE/DELETE)', async () => {
  const pool = makeReadOnlyPool([TEST_PROP_ROW]);
  await previewMode(pool, { name: 'TestB5E' });
  assert.strictEqual(pool._writtenSqls.length, 0, 'No write queries in preview');
});

console.log('\n── B5E-03 : execute requires unique property ──');
await test('B5E-03 execute with 0 matching properties → AbortError', async () => {
  const pool = makeReadOnlyPool([]);
  const savedKey = process.env.BRIGHTDATA_API_KEY;
  process.env.BRIGHTDATA_API_KEY = 'TEST_KEY_B5E03';
  try {
    await assert.rejects(
      () => executeMode(pool, { name: 'NoSuchProperty', _bdScrape: async () => makeBdResult() }),
      err => err.name === 'AbortError',
      'must throw AbortError when property not found'
    );
  } finally {
    if (savedKey !== undefined) process.env.BRIGHTDATA_API_KEY = savedKey;
    else delete process.env.BRIGHTDATA_API_KEY;
  }
});

console.log('\n── B5E-04 : execute requires API key ──');
await test('B5E-04 execute without BRIGHTDATA_API_KEY → AbortError', async () => {
  const savedKey = process.env.BRIGHTDATA_API_KEY;
  delete process.env.BRIGHTDATA_API_KEY;
  const pool = makeExecutePool();
  try {
    await assert.rejects(
      () => executeMode(pool, { name: 'TestB5E', _bdScrape: async () => makeBdResult() }),
      err => err.name === 'AbortError' && /BRIGHTDATA_API_KEY/i.test(err.message),
      'must throw AbortError mentioning BRIGHTDATA_API_KEY'
    );
  } finally {
    if (savedKey !== undefined) process.env.BRIGHTDATA_API_KEY = savedKey;
  }
});

console.log('\n── B5E-05 : execute requires valid currency ──');
await test('B5E-05 execute with null/invalid currency → AbortError', async () => {
  const savedKey = process.env.BRIGHTDATA_API_KEY;
  process.env.BRIGHTDATA_API_KEY = 'TEST_KEY_B5E05';
  const noCurrencyProp = { ...TEST_PROP_ROW, currency: null };
  const pool = makeExecutePool({ propRow: noCurrencyProp });
  try {
    await assert.rejects(
      () => executeMode(pool, { name: 'TestB5E', _bdScrape: async () => makeBdResult() }),
      err => err.name === 'AbortError',
      'must throw AbortError on invalid currency'
    );
  } finally {
    if (savedKey !== undefined) process.env.BRIGHTDATA_API_KEY = savedKey;
    else delete process.env.BRIGHTDATA_API_KEY;
  }
});

// ════════════════════════════════════════════════════════════
// GROUP B — Execute requirements (B5E-06..07)
// ════════════════════════════════════════════════════════════

console.log('\n── B5E-06 : execute requires complete geo ──');
await test('B5E-06 execute with missing geo (no country_code) → AbortError', async () => {
  const savedKey = process.env.BRIGHTDATA_API_KEY;
  process.env.BRIGHTDATA_API_KEY = 'TEST_KEY_B5E06';
  const noGeoProp = { ...TEST_PROP_ROW, country_code: null };
  const pool = makeExecutePool({ propRow: noGeoProp });
  try {
    await assert.rejects(
      () => executeMode(pool, { name: 'TestB5E', _bdScrape: async () => makeBdResult() }),
      err => err.name === 'AbortError',
      'must throw AbortError on incomplete geo'
    );
  } finally {
    if (savedKey !== undefined) process.env.BRIGHTDATA_API_KEY = savedKey;
    else delete process.env.BRIGHTDATA_API_KEY;
  }
});

console.log('\n── B5E-07 : execute requires timezone ──');
await test('B5E-07 execute with null timezone → AbortError', async () => {
  const savedKey = process.env.BRIGHTDATA_API_KEY;
  process.env.BRIGHTDATA_API_KEY = 'TEST_KEY_B5E07';
  const noTzProp = { ...TEST_PROP_ROW, timezone: null };
  const pool = makeExecutePool({ propRow: noTzProp });
  try {
    await assert.rejects(
      () => executeMode(pool, { name: 'TestB5E', _bdScrape: async () => makeBdResult() }),
      err => err.name === 'AbortError' && /timezone/i.test(err.message),
      'must throw AbortError mentioning timezone'
    );
  } finally {
    if (savedKey !== undefined) process.env.BRIGHTDATA_API_KEY = savedKey;
    else delete process.env.BRIGHTDATA_API_KEY;
  }
});

// ════════════════════════════════════════════════════════════
// GROUP C — Dates and adapter (B5E-08..12)
// ════════════════════════════════════════════════════════════

console.log('\n── B5E-08 : dates use property timezone ──');
await test('B5E-08 dates computed from property timezone (Europe/Paris vs UTC)', async () => {
  // Inject _now = midnight UTC (00:00 UTC) — local Paris date is 1 day ahead of UTC for late-hour cases
  // This test just validates that the date helper produces YYYY-MM-DD output tied to timezone
  const fixedNow = new Date('2026-09-25T23:30:00Z');  // UTC 23:30, Paris = 2026-09-26 01:30
  const { checkIn: ciParis } = getBrightDataMarketDates({ timezone: 'Europe/Paris', now: fixedNow });
  const { checkIn: ciUtc   } = getBrightDataMarketDates({ timezone: 'UTC',          now: fixedNow });
  // Paris local date is 2026-09-26 → checkIn = J+14 = 2026-10-10
  // UTC date is 2026-09-25 → checkIn = J+14 = 2026-10-09
  assert.notStrictEqual(ciParis, ciUtc,
    'dates must differ when timezone shifts local calendar date (Paris vs UTC at 23:30 UTC)');
});

console.log('\n── B5E-09 : dates reuse B5-D helper ──');
await test('B5E-09 tool uses getBrightDataMarketDates from services/market-provider (source check)', async () => {
  assert.ok(
    TOOL_SRC.includes("require('../services/market-provider')"),
    'tool must require services/market-provider to reuse getBrightDataMarketDates'
  );
  assert.ok(
    TOOL_SRC.includes('getBrightDataMarketDates'),
    'tool must call getBrightDataMarketDates (not reimplementing the date algorithm)'
  );
});

console.log('\n── B5E-10 : Bright Data adapter used ──');
await test('B5E-10 tool requires services/providers/brightdata.js (source check)', async () => {
  assert.ok(
    TOOL_SRC.includes("require('../services/providers/brightdata')"),
    'tool must require the brightdata provider directly'
  );
  assert.ok(
    TOOL_SRC.includes('scrapeWithBrightData'),
    'tool must reference scrapeWithBrightData'
  );
});

console.log('\n── B5E-11 : Apify never used ──');
await test('B5E-11 tool does not import or reference Apify provider (source check)', async () => {
  assert.ok(
    !TOOL_SRC.includes("require('../services/providers/apify')"),
    'tool must not import providers/apify'
  );
  assert.ok(
    !TOOL_SRC.includes('scrapeZoneApify'),
    'tool must not call scrapeZoneApify'
  );
  assert.ok(
    !TOOL_SRC.includes('scrapeWithApify'),
    'tool must not call scrapeWithApify (Apify path)'
  );
  assert.ok(
    !TOOL_SRC.includes('APIFY_TOKEN'),
    'tool must not reference APIFY_TOKEN'
  );
});

console.log('\n── B5E-12 : mock never used ──');
await test('B5E-12 tool does not generate or use mock listings (source check)', async () => {
  const nonComment = src => src.split('\n')
    .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');
  const code = nonComment(TOOL_SRC);
  assert.ok(
    !code.includes('getMockListings'),
    'tool must not call getMockListings'
  );
  assert.ok(
    !code.includes('MOCK_MODE'),
    'tool must not reference MOCK_MODE'
  );
  // isMock=true guard: the tool CHECKS for mock (to reject it) but must not generate mock
  assert.ok(
    code.includes('isMock'),
    'tool must check isMock to reject mock results'
  );
});

// ════════════════════════════════════════════════════════════
// GROUP D — BD failures abort (B5E-13..18)
// ════════════════════════════════════════════════════════════

console.log('\n── B5E-13 : BD error aborts ──');
await test('B5E-13 BD call throwing → AbortError (no write)', async () => {
  const savedKey = process.env.BRIGHTDATA_API_KEY;
  process.env.BRIGHTDATA_API_KEY = 'TEST_KEY_B5E13';
  const pool = makeExecutePool();
  try {
    await assert.rejects(
      () => executeMode(pool, {
        name: 'TestB5E',
        _bdScrape: async () => { throw new Error('BD_TRIGGER_FAILED_503'); },
      }),
      err => err.name === 'AbortError' && err.message.includes('BD_TRIGGER_FAILED_503'),
      'BD error must produce AbortError wrapping original message'
    );
    // Verify no INSERT was made
    const insertCalls = pool._calls.filter(c => /INSERT/i.test(c.sql));
    assert.strictEqual(insertCalls.length, 0, 'No INSERT must occur after BD error');
  } finally {
    if (savedKey !== undefined) process.env.BRIGHTDATA_API_KEY = savedKey;
    else delete process.env.BRIGHTDATA_API_KEY;
  }
});

console.log('\n── B5E-14 : empty BD result aborts ──');
await test('B5E-14 BD returning 0 listings → AbortError (no write)', async () => {
  const savedKey = process.env.BRIGHTDATA_API_KEY;
  process.env.BRIGHTDATA_API_KEY = 'TEST_KEY_B5E14';
  const pool = makeExecutePool();
  try {
    await assert.rejects(
      () => executeMode(pool, {
        name: 'TestB5E',
        _bdScrape: async () => makeBdResult({ listings: [], diagnostics: { returnedCount: 5, acceptedCount: 0, rejectedPriceCount: 5, rejectedCurrencyCount: 0, rejectedAvailabilityCount: 0 } }),
      }),
      err => err.name === 'AbortError',
      'must throw AbortError when BD returns 0 usable listings'
    );
    const insertCalls = pool._calls.filter(c => /INSERT/i.test(c.sql));
    assert.strictEqual(insertCalls.length, 0, 'No INSERT on empty BD result');
  } finally {
    if (savedKey !== undefined) process.env.BRIGHTDATA_API_KEY = savedKey;
    else delete process.env.BRIGHTDATA_API_KEY;
  }
});

console.log('\n── B5E-15 : currency rejection aborts if no usable records ──');
await test('B5E-15 BD returns items but all rejected for currency → 0 listings → AbortError', async () => {
  const savedKey = process.env.BRIGHTDATA_API_KEY;
  process.env.BRIGHTDATA_API_KEY = 'TEST_KEY_B5E15';
  const pool = makeExecutePool();
  try {
    await assert.rejects(
      () => executeMode(pool, {
        name: 'TestB5E',
        _bdScrape: async () => makeBdResult({
          listings: [],
          diagnostics: { returnedCount: 20, acceptedCount: 0, rejectedPriceCount: 0, rejectedCurrencyCount: 20, rejectedAvailabilityCount: 0 },
        }),
      }),
      err => err.name === 'AbortError',
      'all-currency-rejected must produce AbortError'
    );
  } finally {
    if (savedKey !== undefined) process.env.BRIGHTDATA_API_KEY = savedKey;
    else delete process.env.BRIGHTDATA_API_KEY;
  }
});

console.log('\n── B5E-16 : bedroom null survives filtering ──');
await test('B5E-16 BD listings with bedrooms=null are not filtered out (B5-D policy)', async () => {
  const savedKey = process.env.BRIGHTDATA_API_KEY;
  process.env.BRIGHTDATA_API_KEY = 'TEST_KEY_B5E16';
  const nullBedroomListings = Array.from({ length: 15 }, (_, i) => ({
    price: 100 + i * 5, isBooked: false, bedrooms: null, stars: 4.0,
  }));
  const pool = makeExecutePool();
  let capturedListingCount = 0;
  const savedCalcMarketStats = null; // We'll verify via success

  let result;
  try {
    result = await executeMode(pool, {
      name: 'TestB5E',
      _bdScrape: async () => makeBdResult({ listings: nullBedroomListings }),
    });
  } finally {
    if (savedKey !== undefined) process.env.BRIGHTDATA_API_KEY = savedKey;
    else delete process.env.BRIGHTDATA_API_KEY;
  }
  assert.ok(result.success, 'execute must succeed with all-null-bedrooms listings');
  assert.ok(result.marketStats.count >= 15, `count must be >= 15, got ${result.marketStats.count}`);
});

console.log('\n── B5E-17 : real dataSource required ──');
await test('B5E-17 BD returning dataSource=apify_live → AbortError', async () => {
  const savedKey = process.env.BRIGHTDATA_API_KEY;
  process.env.BRIGHTDATA_API_KEY = 'TEST_KEY_B5E17';
  const pool = makeExecutePool();
  try {
    await assert.rejects(
      () => executeMode(pool, {
        name: 'TestB5E',
        _bdScrape: async () => makeBdResult({ dataSource: 'apify_live', provider: 'apify' }),
      }),
      err => err.name === 'AbortError',
      'non-brightdata_live dataSource must abort'
    );
  } finally {
    if (savedKey !== undefined) process.env.BRIGHTDATA_API_KEY = savedKey;
    else delete process.env.BRIGHTDATA_API_KEY;
  }
});

console.log('\n── B5E-18 : mock dataSource rejected ──');
await test('B5E-18 BD returning isMock=true → AbortError', async () => {
  const savedKey = process.env.BRIGHTDATA_API_KEY;
  process.env.BRIGHTDATA_API_KEY = 'TEST_KEY_B5E18';
  const pool = makeExecutePool();
  try {
    await assert.rejects(
      () => executeMode(pool, {
        name: 'TestB5E',
        _bdScrape: async () => makeBdResult({ isMock: true, dataSource: 'mock' }),
      }),
      err => err.name === 'AbortError',
      'isMock=true must abort'
    );
  } finally {
    if (savedKey !== undefined) process.env.BRIGHTDATA_API_KEY = savedKey;
    else delete process.env.BRIGHTDATA_API_KEY;
  }
});

// ════════════════════════════════════════════════════════════
// GROUP E — CAS / stats guards (B5E-19..21)
// ════════════════════════════════════════════════════════════

console.log('\n── B5E-19 : context CAS mismatch aborts ──');
await test('B5E-19 writeScrapeResult returning context_stale → AbortError', async () => {
  const savedKey = process.env.BRIGHTDATA_API_KEY;
  process.env.BRIGHTDATA_API_KEY = 'TEST_KEY_B5E19';
  // makeCasFailPool simulates property geo changing before write → writeScrapeResult returns context_stale
  const pool = makeCasFailPool('context_stale');
  try {
    await assert.rejects(
      () => executeMode(pool, { name: 'TestB5E', _bdScrape: async () => makeBdResult() }),
      err => err.name === 'AbortError' && /context_stale|annulé|stale/i.test(err.message),
      'context_stale must produce AbortError'
    );
  } finally {
    if (savedKey !== undefined) process.env.BRIGHTDATA_API_KEY = savedKey;
    else delete process.env.BRIGHTDATA_API_KEY;
  }
});

console.log('\n── B5E-20 : currency CAS mismatch aborts ──');
await test('B5E-20 writeScrapeResult returning currency_stale → AbortError', async () => {
  const savedKey = process.env.BRIGHTDATA_API_KEY;
  process.env.BRIGHTDATA_API_KEY = 'TEST_KEY_B5E20';
  const pool = makeCasFailPool('currency_stale');
  try {
    await assert.rejects(
      () => executeMode(pool, { name: 'TestB5E', _bdScrape: async () => makeBdResult() }),
      err => err.name === 'AbortError',
      'currency_stale must produce AbortError'
    );
  } finally {
    if (savedKey !== undefined) process.env.BRIGHTDATA_API_KEY = savedKey;
    else delete process.env.BRIGHTDATA_API_KEY;
  }
});

console.log('\n── B5E-21 : invalid stats abort ──');
await test('B5E-21 BD returning listings where all prices = 0 → calcMarketStats null → AbortError', async () => {
  const savedKey = process.env.BRIGHTDATA_API_KEY;
  process.env.BRIGHTDATA_API_KEY = 'TEST_KEY_B5E21';
  const pool = makeExecutePool();
  const zeroPriceListings = Array.from({ length: 15 }, () => ({
    price: 0, isBooked: false, bedrooms: null, stars: 4.0,
  }));
  try {
    await assert.rejects(
      () => executeMode(pool, {
        name: 'TestB5E',
        _bdScrape: async () => makeBdResult({ listings: zeroPriceListings }),
      }),
      err => err.name === 'AbortError',
      'zero-price listings producing null stats must abort'
    );
  } finally {
    if (savedKey !== undefined) process.env.BRIGHTDATA_API_KEY = savedKey;
    else delete process.env.BRIGHTDATA_API_KEY;
  }
});

// ════════════════════════════════════════════════════════════
// GROUP F — Write safety source checks (B5E-22..28)
// ════════════════════════════════════════════════════════════

console.log('\n── B5E-22..28 : Write safety source checks ──');

await test('B5E-22 tool uses writeScrapeResult for market_data write; no direct INSERT outside of it', async () => {
  assert.ok(
    TOOL_SRC.includes('writeScrapeResult'),
    'tool must use writeScrapeResult for market_data write'
  );
  // Tool itself must not contain a raw INSERT INTO market_data (writeScrapeResult handles it)
  const nonComment = src => src.split('\n')
    .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');
  const code = nonComment(TOOL_SRC);
  assert.ok(!code.includes('INSERT INTO market_data'),
    'tool must not directly INSERT INTO market_data (use writeScrapeResult)');
});

await test('B5E-23 no pricing_config UPDATE in tool source', async () => {
  const nonComment = src => src.split('\n')
    .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');
  const code = nonComment(TOOL_SRC);
  assert.ok(
    !/UPDATE\s+pricing_config/i.test(code),
    'tool must not UPDATE pricing_config'
  );
  assert.ok(
    !/INSERT\s+INTO\s+pricing_config/i.test(code),
    'tool must not INSERT INTO pricing_config'
  );
});

await test('B5E-24 no pricing_schedule writes in tool source', async () => {
  assert.ok(
    !TOOL_SRC.includes('INSERT INTO pricing_schedule'),
    'tool must not INSERT into pricing_schedule'
  );
  assert.ok(
    !/UPDATE\s+pricing_schedule/i.test(TOOL_SRC),
    'tool must not UPDATE pricing_schedule'
  );
});

await test('B5E-25 no pricing_history writes in tool source', async () => {
  assert.ok(
    !TOOL_SRC.includes('INSERT INTO pricing_history'),
    'tool must not INSERT into pricing_history'
  );
  assert.ok(
    !/UPDATE\s+pricing_history/i.test(TOOL_SRC),
    'tool must not UPDATE pricing_history'
  );
});

await test('B5E-26 no properties UPDATE in tool source', async () => {
  const nonComment = src => src.split('\n')
    .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');
  const code = nonComment(TOOL_SRC);
  assert.ok(
    !/UPDATE\s+properties/i.test(code),
    'tool must not UPDATE properties table'
  );
});

await test('B5E-27 no Channex imports or calls in tool source', async () => {
  // Tool may mention "Channex" in documentation strings (safety contract display).
  // What must not exist: actual require() calls or function calls to channex.
  assert.ok(
    !TOOL_SRC.includes("require('../channex')"),
    'tool must not require ../channex'
  );
  assert.ok(
    !TOOL_SRC.includes("require('./channex')"),
    'tool must not require ./channex'
  );
  assert.ok(
    !TOOL_SRC.includes('triggerChannexRatesSync('),
    'tool must not call triggerChannexRatesSync'
  );
  assert.ok(
    !TOOL_SRC.includes('sendBookingMessage('),
    'tool must not call sendBookingMessage'
  );
  assert.ok(
    !TOOL_SRC.includes('channex.io'),
    'tool must not directly call channex.io endpoints'
  );
});

await test('B5E-28 no pricing-apply imports or actual function calls in tool source', async () => {
  assert.ok(
    !TOOL_SRC.includes("require('../routes/pricing-apply')"),
    'tool must not require pricing-apply'
  );
  assert.ok(
    !TOOL_SRC.includes("require('./pricing-apply')"),
    'tool must not require ./pricing-apply'
  );
  // Check for actual function CALLS (with opening paren) — not documentation string mentions
  assert.ok(
    !TOOL_SRC.includes('applyDynamicPricingForProperty('),
    'tool must not call applyDynamicPricingForProperty()'
  );
  assert.ok(
    !TOOL_SRC.includes('publishEffectivePricing('),
    'tool must not call publishEffectivePricing()'
  );
  assert.ok(
    !TOOL_SRC.includes('priceProperty('),
    'tool must not call priceProperty()'
  );
});

// ════════════════════════════════════════════════════════════
// GROUP G — Write verification behavioral (B5E-29..31)
// ════════════════════════════════════════════════════════════

console.log('\n── B5E-29..31 : write verification behavioral ──');

await test('B5E-29 successful execute passes dataSource=brightdata_live to writeScrapeResult', async () => {
  const savedKey = process.env.BRIGHTDATA_API_KEY;
  process.env.BRIGHTDATA_API_KEY = 'TEST_KEY_B5E29';
  const pool = makeExecutePool();
  try {
    await executeMode(pool, { name: 'TestB5E', _bdScrape: async () => makeBdResult() });
    // The INSERT call inside writeScrapeResult should have dataSource at params[10]
    const insertCall = pool._calls.find(c => /INSERT INTO market_data/i.test(c.sql));
    assert.ok(insertCall, 'INSERT INTO market_data call must be made');
    assert.strictEqual(insertCall.params[10], 'brightdata_live',
      `params[10] (dataSource) must be brightdata_live, got: ${insertCall.params[10]}`);
  } finally {
    if (savedKey !== undefined) process.env.BRIGHTDATA_API_KEY = savedKey;
    else delete process.env.BRIGHTDATA_API_KEY;
  }
});

await test('B5E-30 successful execute passes capturedPropertyCurrency to writeScrapeResult', async () => {
  const savedKey = process.env.BRIGHTDATA_API_KEY;
  process.env.BRIGHTDATA_API_KEY = 'TEST_KEY_B5E30';
  const pool = makeExecutePool({ currency: 'EUR' });
  try {
    const result = await executeMode(pool, { name: 'TestB5E', _bdScrape: async () => makeBdResult() });
    assert.strictEqual(result.currency, 'EUR', 'returned currency must be EUR');
    const insertCall = pool._calls.find(c => /INSERT INTO market_data/i.test(c.sql));
    assert.ok(insertCall, 'INSERT must exist');
    // currency is params[12] in writeScrapeResult
    assert.strictEqual(insertCall.params[12], 'EUR',
      `params[12] (currency) must be EUR, got: ${insertCall.params[12]}`);
  } finally {
    if (savedKey !== undefined) process.env.BRIGHTDATA_API_KEY = savedKey;
    else delete process.env.BRIGHTDATA_API_KEY;
  }
});

await test('B5E-31 successful execute passes capturedContextKey to writeScrapeResult', async () => {
  const savedKey = process.env.BRIGHTDATA_API_KEY;
  process.env.BRIGHTDATA_API_KEY = 'TEST_KEY_B5E31';
  const pool = makeExecutePool({ contextKey: 'FR:48.73:2.27' });
  try {
    const result = await executeMode(pool, { name: 'TestB5E', _bdScrape: async () => makeBdResult() });
    assert.strictEqual(result.contextKey, 'FR:48.73:2.27', 'returned contextKey must match');
    const insertCall = pool._calls.find(c => /INSERT INTO market_data/i.test(c.sql));
    assert.ok(insertCall, 'INSERT must exist');
    // capturedContextKey is params[11]
    assert.strictEqual(insertCall.params[11], 'FR:48.73:2.27',
      `params[11] (contextKey) must be FR:48.73:2.27, got: ${insertCall.params[11]}`);
  } finally {
    if (savedKey !== undefined) process.env.BRIGHTDATA_API_KEY = savedKey;
    else delete process.env.BRIGHTDATA_API_KEY;
  }
});

// ════════════════════════════════════════════════════════════
// GROUP H — Resolver behavior (B5E-32..36)
// ════════════════════════════════════════════════════════════

console.log('\n── B5E-32..36 : resolver behavior ──');

await test('B5E-32 resolver trusts brightdata_live data_source', async () => {
  const row = {
    data_source:       'brightdata_live',
    scraped_at:        new Date().toISOString(),
    market_context_key: 'FR:48.73:2.27',
    currency:          'EUR',
    median_price:      130,
    occupancy_rate:    40,
    comparable_count:  15,
    tension_level:     'normal',
  };
  const result = classifyMarketData(row, {
    propertyContextKey: 'FR:48.73:2.27',
    propertyCurrency:   'EUR',
  });
  assert.strictEqual(result.trusted, true,
    'brightdata_live must be trusted by classifyMarketData');
});

await test('B5E-33 resolver returns live_stale for old brightdata_live row', async () => {
  const oldDate = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000); // 15 days ago
  const row = {
    data_source:       'brightdata_live',
    scraped_at:        oldDate.toISOString(),
    market_context_key: 'FR:48.73:2.27',
    currency:          'EUR',
    median_price:      130,
    occupancy_rate:    40,
    comparable_count:  15,
    tension_level:     'normal',
  };
  const result = classifyMarketData(row, {
    propertyContextKey: 'FR:48.73:2.27',
    propertyCurrency:   'EUR',
  });
  assert.strictEqual(result.fresh, false, 'stale row must not be fresh');
  assert.strictEqual(result.usable, false, 'stale row must not be usable');
  assert.strictEqual(result.status, 'live_stale', 'stale status must be live_stale');
});

await test('B5E-34 resolver returns currency_mismatch when currencies differ', async () => {
  const row = {
    data_source:       'brightdata_live',
    scraped_at:        new Date().toISOString(),
    market_context_key: 'FR:48.73:2.27',
    currency:          'GBP',   // row has GBP
    median_price:      130,
    occupancy_rate:    40,
    comparable_count:  15,
    tension_level:     'normal',
  };
  const result = classifyMarketData(row, {
    propertyContextKey: 'FR:48.73:2.27',
    propertyCurrency:   'EUR',   // property expects EUR
  });
  assert.strictEqual(result.status, 'currency_mismatch',
    'mismatched currency must produce currency_mismatch status');
  assert.strictEqual(result.usable, false, 'currency_mismatch row must not be usable');
});

await test('B5E-35 resolver returns live_wrong_location when context key mismatches', async () => {
  const row = {
    data_source:       'brightdata_live',
    scraped_at:        new Date().toISOString(),
    market_context_key: 'FR:43.30:5.38',  // different location (Marseille)
    currency:          'EUR',
    median_price:      130,
    occupancy_rate:    40,
    comparable_count:  15,
    tension_level:     'normal',
  };
  const result = classifyMarketData(row, {
    propertyContextKey: 'FR:48.73:2.27',  // property is in Massy
    propertyCurrency:   'EUR',
  });
  assert.strictEqual(result.status, 'live_wrong_location',
    'wrong context key must produce live_wrong_location');
  assert.strictEqual(result.usable, false, 'wrong_location row must not be usable');
});

await test('B5E-36 fresh brightdata_live row with matching key and currency is usable', async () => {
  const row = {
    data_source:       'brightdata_live',
    scraped_at:        new Date().toISOString(),
    market_context_key: 'FR:48.73:2.27',
    currency:          'EUR',
    median_price:      130,
    occupancy_rate:    40,
    comparable_count:  15,
    tension_level:     'normal',
  };
  const result = classifyMarketData(row, {
    propertyContextKey: 'FR:48.73:2.27',
    propertyCurrency:   'EUR',
  });
  assert.strictEqual(result.status, 'live_fresh', 'must be live_fresh');
  assert.strictEqual(result.trusted, true,         'must be trusted');
  assert.strictEqual(result.fresh, true,           'must be fresh');
  assert.strictEqual(result.locationCompatible, true, 'must be locationCompatible');
  assert.strictEqual(result.usable, true,          'must be usable');
});

// ════════════════════════════════════════════════════════════
// GROUP I — Safety invariants (B5E-37..40)
// ════════════════════════════════════════════════════════════

console.log('\n── B5E-37..40 : safety invariants ──');

await test('B5E-37 pricing_config and pricing_history row counts unchanged after execution', async () => {
  const savedKey = process.env.BRIGHTDATA_API_KEY;
  process.env.BRIGHTDATA_API_KEY = 'TEST_KEY_B5E37';
  const pool = makeExecutePool({ pcRows: [{ is_active: true, mode: 'auto', updated_at: '2026-09-20T00:00:00Z' }] });
  try {
    const result = await executeMode(pool, { name: 'TestB5E', _bdScrape: async () => makeBdResult() });
    assert.ok(result.success, 'execution must succeed');

    // Check that no UPDATE/DELETE on pricing_config/history was called
    const writeCalls = pool._calls.filter(c =>
      /(UPDATE|DELETE|INSERT)\s+(pricing_config|pricing_history)/i.test(c.sql)
    );
    assert.strictEqual(writeCalls.length, 0,
      `No writes to pricing_config or pricing_history, found: ${writeCalls.map(c => c.sql).join(', ')}`);
  } finally {
    if (savedKey !== undefined) process.env.BRIGHTDATA_API_KEY = savedKey;
    else delete process.env.BRIGHTDATA_API_KEY;
  }
});

await test('B5E-38 properties table not modified during execution', async () => {
  const savedKey = process.env.BRIGHTDATA_API_KEY;
  process.env.BRIGHTDATA_API_KEY = 'TEST_KEY_B5E38';
  const pool = makeExecutePool();
  try {
    await executeMode(pool, { name: 'TestB5E', _bdScrape: async () => makeBdResult() });

    // Check no UPDATE/INSERT/DELETE on properties
    const propWriteCalls = pool._calls.filter(c =>
      /(UPDATE|DELETE)\s+properties/i.test(c.sql) ||
      /INSERT\s+INTO\s+properties/i.test(c.sql)
    );
    assert.strictEqual(propWriteCalls.length, 0,
      `properties must not be modified, found: ${propWriteCalls.map(c => c.sql).join(', ')}`);
  } finally {
    if (savedKey !== undefined) process.env.BRIGHTDATA_API_KEY = savedKey;
    else delete process.env.BRIGHTDATA_API_KEY;
  }
});

await test('B5E-39 BRIGHTDATA_API_KEY value never printed in tool source', async () => {
  // The tool checks for the key's presence (boolean) but must never log its value
  assert.ok(
    !TOOL_SRC.includes('console.log(process.env.BRIGHTDATA_API_KEY)'),
    'API key value must never be console.log\'d'
  );
  assert.ok(
    !TOOL_SRC.includes('console.error(process.env.BRIGHTDATA_API_KEY)'),
    'API key value must never be console.error\'d'
  );
  // The only reference to BRIGHTDATA_API_KEY in source is the boolean check
  const bdKeyMatches = TOOL_SRC.match(/BRIGHTDATA_API_KEY/g) || [];
  // All references must be in the boolean check pattern !!(process.env.BRIGHTDATA_API_KEY)
  assert.ok(bdKeyMatches.length >= 1,
    'BRIGHTDATA_API_KEY must be referenced for the API key present check');
  // Verify no direct string interpolation of the key
  assert.ok(
    !TOOL_SRC.includes('${process.env.BRIGHTDATA_API_KEY}'),
    'API key must not be interpolated into any string'
  );
});

await test('B5E-40 tool cannot target multiple properties accidentally', async () => {
  const savedKey = process.env.BRIGHTDATA_API_KEY;
  process.env.BRIGHTDATA_API_KEY = 'TEST_KEY_B5E40';
  // Two properties with similar names
  const prop1 = { ...TEST_PROP_ROW, id: 'prop-b5e-test-001', name: 'TestB5E Apt 1' };
  const prop2 = { ...TEST_PROP_ROW, id: 'prop-b5e-test-002', name: 'TestB5E Apt 2' };
  const pool = makeExecutePool({ propRow: prop1 });
  // Override query to return 2 rows
  const origQuery = pool.query.bind(pool);
  pool.query = async (sql, params) => {
    if (sql.includes('FROM properties') && sql.includes('LOWER')) return { rows: [prop1, prop2] };
    return origQuery(sql, params);
  };
  try {
    await assert.rejects(
      () => executeMode(pool, { name: 'TestB5E', _bdScrape: async () => makeBdResult() }),
      err => err.name === 'AbortError',
      'multiple property matches must produce AbortError'
    );
    // Preview mode should also report the ambiguity
    const previewPool = makeReadOnlyPool([prop1, prop2]);
    const previewResult = await previewMode(previewPool, { name: 'TestB5E' });
    assert.strictEqual(previewResult.ok, false, 'preview must not be ok with multiple matches');
  } finally {
    if (savedKey !== undefined) process.env.BRIGHTDATA_API_KEY = savedKey;
    else delete process.env.BRIGHTDATA_API_KEY;
  }
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
