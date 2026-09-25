#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.2-B5-F2 Bright Data Live Quality Validation Tool
 *
 * B5F2-01 : source — previewMode calls no BD scrape function
 * B5F2-02 : source — executeMode calls bdScrape exactly once
 * B5F2-03 : source — no Apify import or fallback
 * B5F2-04 : source — no mock fallback construction
 * B5F2-05 : source — imports selectComparables + calcBrightDataMarketStats from filter
 * B5F2-06 : source — no local haversine / median reimplementation
 * B5F2-07 : source — no INSERT/UPDATE/DELETE in non-comment code (0 DB writes)
 * B5F2-08 : source — no Channex import/call
 * B5F2-09 : source — no pricing apply import/call
 * B5F2-10 : behavioral — preview returns ok=false when property not found
 * B5F2-11 : behavioral — preview returns ok=true when property resolved and API key present
 * B5F2-12 : behavioral — execute aborts when BRIGHTDATA_API_KEY absent
 * B5F2-13 : behavioral — execute aborts when 0 accepted listings from adapter
 * B5F2-14 : behavioral — insufficient comparables (< 5) → CHECK_1 fails → verdict FAIL
 * B5F2-15 : behavioral — valid BD result with close-by listings → verdict PASS
 * B5F2-16 : behavioral — 0-listings from adapter (all currency rejected) → abort
 * B5F2-17 : behavioral — safety snapshots unchanged → pool receives 0 writes
 * B5F2-18 : behavioral — calendar_unavailability_proxy correctly labelled
 * B5F2-19 : behavioral — occupancy_semantics=insufficient_calendars handled correctly
 * B5F2-20 : source — no per-listing PII (providerListingId / url) in console.log
 * B5F2-21 : behavioral — selectComparables called with targetLat/targetLon/targetGuests
 * B5F2-22 : behavioral — CHECK_7 fails when a comparable has price = 0
 * B5F2-23 : behavioral — verdict includes failedChecks list on FAIL
 * B5F2-24 : source — resolvePropF2 query includes p.max_guests
 * B5F2-25 : behavioral — execute uses property timezone for calcBrightDataMarketStats today
 *
 * Run: node tests/p1_2b5f2_quality_runtime_validation.test.js
 * BRIGHTDATA_LIVE_CALLS = 0  DB_WRITES = 0  CHANNEX_WRITES = 0  PRICING_WRITES = 0
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

// ── Load sources ───────────────────────────────────────────────────────────────

const TOOL_PATH   = path.resolve(__dirname, '../outils/validate-brightdata-quality-runtime.js');
const TOOL_SRC    = fs.readFileSync(TOOL_PATH, 'utf8');
const FILTER_PATH = path.resolve(__dirname, '../services/brightdata-comparable-filter.js');

const { previewMode, executeMode, AbortError, MAX_LISTINGS } = require(TOOL_PATH);
const {
  selectComparables, calcBrightDataMarketStats,
  RADIUS_BANDS_KM, MIN_COMPARABLES_FALLBACK,
} = require(FILTER_PATH);

// ── Fixture helpers ────────────────────────────────────────────────────────────

const REF_LAT = 48.730667;
const REF_LON = 2.276069;

const TEST_PROP_ROW = {
  id:             'prop-f2-test-001',
  user_id:        'user-f2-001',
  name:           'TestF2',
  internal_name:  null,
  address:        '18 rue Gambetta 91300 Massy',
  latitude:       String(REF_LAT),
  longitude:      String(REF_LON),
  country_code:   'FR',
  timezone:       'Europe/Paris',
  currency:       'EUR',
  channex_enabled: false,
  max_guests:     4,
  is_active:      true,
  mode:           'auto',
};

function propFingerprintRow(p = TEST_PROP_ROW) {
  return {
    name: p.name, address: p.address,
    latitude: p.latitude, longitude: p.longitude,
    country_code: p.country_code, timezone: p.timezone,
    currency: p.currency, channex_enabled: p.channex_enabled,
  };
}

// Read-only pool — throws on any write attempt
function makeReadOnlyPool(propRows = [TEST_PROP_ROW]) {
  const writtenSqls = [];
  return {
    _writtenSqls: writtenSqls,
    connect: async () => { throw new Error('pool.connect() not allowed in preview'); },
    query: async (sql) => {
      if (/^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/i.test(sql)) {
        writtenSqls.push(sql.trim().slice(0, 60));
        throw new Error(`Write in read-only pool: ${sql.trim().slice(0, 60)}`);
      }
      if (sql.includes('FROM properties')) return { rows: propRows };
      if (sql.includes('FROM pricing_config')) return { rows: [] };
      if (sql.includes('FROM market_data')) return { rows: [] };
      return { rows: [] };
    },
  };
}

// Execute pool — allows reads, throws on writes
function makeF2ExecutePool(propRow = TEST_PROP_ROW) {
  const writtenSqls = [];
  const pcRow = { is_active: propRow.is_active, mode: propRow.mode, updated_at: '2026-01-01T00:00:00Z' };
  return {
    _writtenSqls: writtenSqls,
    query: async (sql, params) => {
      if (/^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/i.test(sql)) {
        writtenSqls.push(sql.trim().slice(0, 60));
        throw new Error(`Write in F2 pool: ${sql.trim().slice(0, 60)}`);
      }
      if (sql.includes('FROM properties') && sql.includes('LOWER')) return { rows: [propRow] };
      if (sql.includes('pricing_config') && sql.includes('updated_at')) return { rows: [pcRow] };
      if (sql.includes('pricing_schedule')) return { rows: [{ cnt: '0' }] };
      if (sql.includes('pricing_history')) return { rows: [{ cnt: '0' }] };
      if (sql.includes('FROM properties') && sql.includes('WHERE id')) return { rows: [propFingerprintRow(propRow)] };
      return { rows: [] };
    },
  };
}

// Generate N listings all within distKm of REF, with valid metadata
function makeCloseListings(count, distKm = 0.4) {
  return Array.from({ length: count }, (_, i) => ({
    price:             100 + i * 5,
    isBooked:          false,
    bedrooms:          null,
    stars:             4.5,
    providerListingId: `close-${i}`,
    latitude:          REF_LAT + distKm / 111.2 * (i % 2 === 0 ? 1 : -1) * 0.5,
    longitude:         REF_LON + distKm / 111.2 * (i % 2 === 0 ? -1 : 1) * 0.5,
    guests:            4,
    category:          'Entire apartment',
    availableDates:    Array.from({ length: 20 }, (__, d) => {
      const dt = new Date('2026-10-01T00:00:00Z');
      dt.setUTCDate(dt.getUTCDate() + d);
      return dt.toISOString().slice(0, 10);
    }),
  }));
}

// Stub getFallbackZones — avoids Jest circular-dep issue (cron → routes → trigger → cron).
// Real production path is tested end-to-end by node invocation; tests only need a valid zone string.
function testFallbackZones(address) {
  const pcMatch = (address || '').match(/\b(\d{5})\b/);
  const city    = pcMatch ? 'Test City, France' : 'France';
  return [city];
}

// Standard mock BD result — valid brightdata_live with close-by listings
function makeBdResult(listings = makeCloseListings(10), overrides = {}) {
  return {
    listings,
    isMock:     false,
    provider:   'brightdata',
    dataSource: 'brightdata_live',
    diagnostics: {
      returnedCount:             listings.length,
      acceptedCount:             listings.length,
      rejectedPriceCount:        0,
      rejectedCurrencyCount:     0,
      rejectedAvailabilityCount: 0,
    },
    ...overrides,
  };
}

// ── TESTS ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n══════════════════════════════════════════════════════════════════════════');
  console.log('  P1.2-B5-F2 — Bright Data Live Quality Validation');
  console.log('══════════════════════════════════════════════════════════════════════════\n');

  // ── Source checks ─────────────────────────────────────────────────────────

  await test('B5F2-01: previewMode calls no BD scrape function', () => {
    // Extract previewMode body from source
    const fnIdx  = TOOL_SRC.indexOf('async function previewMode');
    const fnEnd  = TOOL_SRC.indexOf('\nasync function executeMode');
    const fnBody = TOOL_SRC.slice(fnIdx, fnEnd);
    assert.ok(!fnBody.includes('bdScrape') && !fnBody.includes('scrapeWithBrightData('),
      'previewMode must not call any BD scrape function');
  });

  await test('B5F2-02: executeMode calls bdScrape exactly once', () => {
    const fnIdx  = TOOL_SRC.indexOf('async function executeMode');
    const fnEnd  = TOOL_SRC.indexOf('\nmodule.exports');
    const fnBody = TOOL_SRC.slice(fnIdx, fnEnd);
    const callCount = (fnBody.match(/\bawait bdScrape\b/g) || []).length;
    assert.strictEqual(callCount, 1, `executeMode must call bdScrape exactly once, found ${callCount}`);
  });

  await test('B5F2-03: no Apify import or fallback', () => {
    assert.ok(!TOOL_SRC.includes("require('./providers/apify')") &&
              !TOOL_SRC.includes('require("./providers/apify")') &&
              !TOOL_SRC.includes("require('../services/providers/apify')"),
      'tool must not require apify provider');
    assert.ok(!TOOL_SRC.includes('scrapeZoneApify(') && !TOOL_SRC.includes('scrapeWithApify('),
      'tool must not call Apify scrape functions');
  });

  await test('B5F2-04: no mock fallback construction', () => {
    // The tool must not construct mock data or call getMockListings
    assert.ok(!TOOL_SRC.includes('getMockListings('), 'must not call getMockListings');
    assert.ok(!TOOL_SRC.includes('isMock: true'), 'must not construct mock result');
    assert.ok(!TOOL_SRC.includes("dataSource: 'mock'"), "must not set dataSource: 'mock'");
  });

  await test('B5F2-05: imports selectComparables + calcBrightDataMarketStats from filter', () => {
    assert.ok(TOOL_SRC.includes('brightdata-comparable-filter'),
      'tool must require brightdata-comparable-filter');
    assert.ok(TOOL_SRC.includes('selectComparables'), 'tool must reference selectComparables');
    assert.ok(TOOL_SRC.includes('calcBrightDataMarketStats'), 'tool must reference calcBrightDataMarketStats');
    assert.ok(TOOL_SRC.includes('haversineKm'), 'tool must import haversineKm from filter');
    assert.ok(TOOL_SRC.includes('isCategoryCompatible'), 'tool must import isCategoryCompatible');
    assert.ok(TOOL_SRC.includes('isCapacityCompatible'), 'tool must import isCapacityCompatible');
  });

  await test('B5F2-06: no local haversine or median reimplementation', () => {
    // Check that the tool does not define its own haversine or median function
    assert.ok(!/function haversine/i.test(TOOL_SRC), 'must not define local haversine');
    assert.ok(!/function.*[Mm]edian/.test(TOOL_SRC), 'must not define local median');
    // The haversineKm used in the checks section is the imported one
    assert.ok(TOOL_SRC.includes('haversineKm(capturedLat'), 'must use imported haversineKm for checks');
  });

  await test('B5F2-07: no INSERT/UPDATE/DELETE in non-comment code (0 DB writes)', () => {
    const codeLines = TOOL_SRC.split('\n').filter(l => !/^\s*(\*|\/\/)/.test(l));
    const codeSrc = codeLines.join('\n');
    assert.ok(!/\bpool\.query\s*\(\s*[`'"]\s*(INSERT|UPDATE|DELETE)\b/i.test(codeSrc),
      'executeMode must not call pool.query with INSERT/UPDATE/DELETE');
    assert.ok(!codeSrc.includes('writeScrapeResult('),
      'tool must not call writeScrapeResult — MARKET_DATA_WRITES = 0');
  });

  await test('B5F2-08: no Channex import/call', () => {
    const codeLines = TOOL_SRC.split('\n').filter(l => !/^\s*(\*|\/\/)/.test(l));
    const codeSrc = codeLines.join('\n');
    assert.ok(!codeSrc.includes("require('../channex')") && !codeSrc.includes('require("../channex")'),
      'must not require channex');
    assert.ok(!codeSrc.includes('triggerChannexRatesSync('), 'must not call channex sync');
  });

  await test('B5F2-09: no pricing apply import/call', () => {
    const codeLines = TOOL_SRC.split('\n').filter(l => !/^\s*(\*|\/\/)/.test(l));
    const codeSrc = codeLines.join('\n');
    assert.ok(!codeSrc.includes("require('./pricing-apply')") &&
              !codeSrc.includes("require('../pricing-apply')") &&
              !codeSrc.includes("require('./routes/pricing-apply')"),
      'must not require pricing-apply');
    assert.ok(!codeSrc.includes('applyDynamicPricingForProperty('),
      'must not call applyDynamicPricingForProperty');
  });

  // ── Behavioral: preview ───────────────────────────────────────────────────

  await test('B5F2-10: preview returns ok=false when property not found', async () => {
    const pool = makeReadOnlyPool([]);
    const result = await previewMode(pool, { name: 'NONEXISTENT' });
    assert.strictEqual(result.ok, false);
    assert.ok(result.abort.includes('no_target'));
  });

  await test('B5F2-11: preview returns ok=true when property resolved and API key present', async () => {
    const pool = makeReadOnlyPool([TEST_PROP_ROW]);
    const savedKey = process.env.BRIGHTDATA_API_KEY;
    process.env.BRIGHTDATA_API_KEY = 'test-key-f2';
    try {
      const result = await previewMode(pool, { name: 'TestF2', _getFallbackZones: testFallbackZones });
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.propertyId, TEST_PROP_ROW.id);
    } finally {
      if (savedKey === undefined) delete process.env.BRIGHTDATA_API_KEY;
      else process.env.BRIGHTDATA_API_KEY = savedKey;
    }
  });

  // ── Behavioral: execute ───────────────────────────────────────────────────

  await test('B5F2-12: execute aborts when BRIGHTDATA_API_KEY absent', async () => {
    const pool    = makeF2ExecutePool();
    const savedKey = process.env.BRIGHTDATA_API_KEY;
    delete process.env.BRIGHTDATA_API_KEY;
    try {
      await executeMode(pool, { name: 'TestF2', _getFallbackZones: testFallbackZones, _bdScrape: async () => { throw new Error('should not reach BD'); } });
      assert.fail('should have thrown AbortError');
    } catch (err) {
      assert.ok(err instanceof AbortError, `expected AbortError, got ${err.constructor.name}`);
      assert.ok(err.message.includes('BRIGHTDATA_API_KEY'), `message: ${err.message}`);
    } finally {
      if (savedKey !== undefined) process.env.BRIGHTDATA_API_KEY = savedKey;
    }
  });

  await test('B5F2-13: execute aborts when BD returns 0 accepted listings', async () => {
    const pool = makeF2ExecutePool();
    process.env.BRIGHTDATA_API_KEY = 'test-key-f2';
    try {
      await executeMode(pool, {
        name: 'TestF2',
        _getFallbackZones: testFallbackZones,
        _bdScrape: async () => makeBdResult([]),
      });
      assert.fail('should have thrown AbortError');
    } catch (err) {
      assert.ok(err instanceof AbortError);
      assert.ok(err.message.toLowerCase().includes('0') || err.message.toLowerCase().includes('aucun'),
        `expected abort message about empty result, got: ${err.message}`);
    }
  });

  await test('B5F2-14: insufficient comparables (< 5) → CHECK_1 fails → verdict FAIL', async () => {
    // 3 listings all ~50 km from REF — outside all radius bands → 0 comparables after selection
    const farListings = Array.from({ length: 3 }, (_, i) => ({
      price:             150 + i * 10,
      isBooked:          false,
      bedrooms:          null,
      stars:             4.0,
      providerListingId: `far-${i}`,
      latitude:          REF_LAT + 0.5,  // ~55 km north
      longitude:         REF_LON,
      guests:            4,
      category:          'Entire apartment',
      availableDates:    null,
    }));
    const pool = makeF2ExecutePool();
    process.env.BRIGHTDATA_API_KEY = 'test-key-f2';
    const result = await executeMode(pool, {
      name: 'TestF2',
      _getFallbackZones: testFallbackZones,
      _bdScrape: async () => makeBdResult(farListings),
    });
    assert.strictEqual(result.verdict, 'FAIL');
    assert.ok(result.failedChecks.includes('CHECK_1'), `CHECK_1 must fail, got: ${result.failedChecks}`);
  });

  await test('B5F2-15: valid BD result with close-by listings → verdict PASS', async () => {
    const pool = makeF2ExecutePool();
    process.env.BRIGHTDATA_API_KEY = 'test-key-f2';
    const result = await executeMode(pool, {
      name: 'TestF2',
      _getFallbackZones: testFallbackZones,
      _bdScrape: async () => makeBdResult(makeCloseListings(10)),
    });
    assert.strictEqual(result.verdict, 'PASS', `Expected PASS, got FAIL on: ${result.failedChecks?.join(', ')}`);
    assert.deepStrictEqual(result.failedChecks, []);
    assert.ok(result.comparableCount >= MIN_COMPARABLES_FALLBACK);
    assert.strictEqual(result.dataSource, 'brightdata_live');
  });

  await test('B5F2-16: BD returns isMock=true → abort (no mock fallback)', async () => {
    const pool = makeF2ExecutePool();
    process.env.BRIGHTDATA_API_KEY = 'test-key-f2';
    try {
      await executeMode(pool, {
        name: 'TestF2',
        _getFallbackZones: testFallbackZones,
        _bdScrape: async () => ({
          listings: makeCloseListings(5), isMock: true,
          provider: 'mock', dataSource: 'mock',
        }),
      });
      assert.fail('should have thrown AbortError');
    } catch (err) {
      assert.ok(err instanceof AbortError);
      assert.ok(err.message.toLowerCase().includes('mock'), `message: ${err.message}`);
    }
  });

  await test('B5F2-17: safety snapshots unchanged → pool receives 0 writes', async () => {
    const pool = makeF2ExecutePool();
    process.env.BRIGHTDATA_API_KEY = 'test-key-f2';
    await executeMode(pool, {
      name: 'TestF2',
      _getFallbackZones: testFallbackZones,
      _bdScrape: async () => makeBdResult(makeCloseListings(10)),
    });
    assert.strictEqual(pool._writtenSqls.length, 0,
      `Pool received write calls: ${pool._writtenSqls.join(', ')}`);
  });

  await test('B5F2-18: calendar_unavailability_proxy correctly labelled', async () => {
    const pool = makeF2ExecutePool();
    process.env.BRIGHTDATA_API_KEY = 'test-key-f2';
    // makeCloseListings includes availableDates — should produce calendar_unavailability_proxy
    const result = await executeMode(pool, {
      name: 'TestF2',
      _getFallbackZones: testFallbackZones,
      _bdScrape: async () => makeBdResult(makeCloseListings(10)),
    });
    assert.strictEqual(result.stats?.occupancy_semantics, 'calendar_unavailability_proxy');
    assert.ok(Number.isFinite(result.stats?.occupancy));
    assert.ok(result.stats.occupancy >= 0 && result.stats.occupancy <= 100);
  });

  await test('B5F2-19: occupancy_semantics=insufficient_calendars when no available_dates', async () => {
    // Listings without availableDates → insufficient calendars
    const noCalListings = makeCloseListings(10).map(l => ({ ...l, availableDates: null }));
    const pool = makeF2ExecutePool();
    process.env.BRIGHTDATA_API_KEY = 'test-key-f2';
    const result = await executeMode(pool, {
      name: 'TestF2',
      _getFallbackZones: testFallbackZones,
      _bdScrape: async () => makeBdResult(noCalListings),
    });
    assert.strictEqual(result.stats?.occupancy_semantics, 'insufficient_calendars');
    assert.strictEqual(result.stats?.occupancy, 0);
    // CHECK_9 should still pass (occupancy=0 and semantics=insufficient_calendars)
    assert.ok(!result.failedChecks?.includes('CHECK_9'), `CHECK_9 should pass for insufficient_calendars`);
  });

  await test('B5F2-20: no per-listing PII (providerListingId / url) in console.log', () => {
    // Allow aggregate expressions like `accepted.filter(l => l.providerListingId != null).length`
    // Disallow direct string interpolation of individual listing ID values like `${l.providerListingId}`
    const consoleLines = TOOL_SRC.split('\n').filter(l => l.includes('console.log'));
    for (const line of consoleLines) {
      assert.ok(!/\$\{[^}]*\.providerListingId[^}]*\}/.test(line) ||
                line.includes('.filter(') || line.includes('.length'),
        `console.log must not interpolate individual providerListingId values: ${line.trim()}`);
      assert.ok(!line.includes('host_name') && !line.includes('host_url'),
        `console.log must not print host info: ${line.trim()}`);
    }
  });

  await test('B5F2-21: selectComparables called with targetLat/targetLon/targetGuests', () => {
    // Verify source — selectComparables call includes all three parameters
    const fnIdx  = TOOL_SRC.indexOf('async function executeMode');
    const fnEnd  = TOOL_SRC.indexOf('\nmodule.exports');
    const fnBody = TOOL_SRC.slice(fnIdx, fnEnd);
    assert.ok(fnBody.includes('targetLat:'), 'selectComparables call must include targetLat');
    assert.ok(fnBody.includes('targetLon:'), 'selectComparables call must include targetLon');
    assert.ok(fnBody.includes('targetGuests:'), 'selectComparables call must include targetGuests');
    assert.ok(fnBody.includes('capturedLat'), 'targetLat must use capturedLat');
    assert.ok(fnBody.includes('capturedLon'), 'targetLon must use capturedLon');
    assert.ok(fnBody.includes('capturedMaxGuests'), 'targetGuests must use capturedMaxGuests');
  });

  await test('B5F2-22: CHECK_7 fails when a comparable has price = 0', async () => {
    // Inject a listing with price=0 — parseBrightDataItem would reject it, but we inject directly
    const badPriceListings = [
      ...makeCloseListings(9),
      {
        price:             0,   // invalid — price must be > 0
        isBooked:          false,
        bedrooms:          null,
        stars:             4.0,
        providerListingId: 'bad-price',
        latitude:          REF_LAT + 0.002,
        longitude:         REF_LON,
        guests:            4,
        category:          'Entire apartment',
        availableDates:    null,
      },
    ];
    const pool = makeF2ExecutePool();
    process.env.BRIGHTDATA_API_KEY = 'test-key-f2';
    const result = await executeMode(pool, {
      name: 'TestF2',
      _getFallbackZones: testFallbackZones,
      _bdScrape: async () => makeBdResult(badPriceListings),
    });
    assert.strictEqual(result.verdict, 'FAIL');
    assert.ok(result.failedChecks.includes('CHECK_7'), `CHECK_7 must fail, got: ${result.failedChecks}`);
  });

  await test('B5F2-23: verdict includes failedChecks list on FAIL', async () => {
    // Any FAIL should come with a non-empty failedChecks array
    const farListings = Array.from({ length: 3 }, (_, i) => ({
      price: 100 + i * 10, isBooked: false, bedrooms: null, stars: 4,
      providerListingId: `f${i}`, latitude: REF_LAT + 0.5, longitude: REF_LON,
      guests: 4, category: 'Entire apartment', availableDates: null,
    }));
    const pool = makeF2ExecutePool();
    process.env.BRIGHTDATA_API_KEY = 'test-key-f2';
    const result = await executeMode(pool, {
      name: 'TestF2',
      _getFallbackZones: testFallbackZones,
      _bdScrape: async () => makeBdResult(farListings),
    });
    assert.strictEqual(result.verdict, 'FAIL');
    assert.ok(Array.isArray(result.failedChecks) && result.failedChecks.length > 0,
      'FAIL verdict must include non-empty failedChecks');
  });

  await test('B5F2-24: resolvePropF2 query includes p.max_guests', () => {
    // resolvePropF2 function source must select max_guests
    const fnIdx = TOOL_SRC.indexOf('async function resolvePropF2');
    const fnBody = TOOL_SRC.slice(fnIdx, fnIdx + 600);
    assert.ok(fnBody.includes('p.max_guests'), 'resolvePropF2 must select p.max_guests');
  });

  await test('B5F2-25: execute uses property timezone for calcBrightDataMarketStats today', () => {
    // Source: the today computation must use capturedTimezone / toLocaleString('sv-SE')
    const fnIdx  = TOOL_SRC.indexOf('async function executeMode');
    const fnEnd  = TOOL_SRC.indexOf('\nmodule.exports');
    const fnBody = TOOL_SRC.slice(fnIdx, fnEnd);
    assert.ok(fnBody.includes('capturedTimezone'), 'must use capturedTimezone for today computation');
    assert.ok(fnBody.includes("toLocaleString('sv-SE'") || fnBody.includes('toLocaleString("sv-SE"'),
      'must use toLocaleString sv-SE for timezone-aware date');
  });

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log('\n══════════════════════════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\n  Failures:');
    for (const f of failures) console.log(`    ❌  ${f.name}: ${f.message}`);
  }
  console.log('══════════════════════════════════════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
})();
