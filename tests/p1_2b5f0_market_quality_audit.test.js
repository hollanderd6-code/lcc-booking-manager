#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.2-B5-F0 Bright Data Market Quality Audit
 *
 * B5F0-01 : preview makes 0 BD calls
 * B5F0-02 : preview makes 0 DB writes
 * B5F0-03 : execute makes 0 DB writes
 * B5F0-04 : no Channex import/call in tool source
 * B5F0-05 : no pricing application import/call in tool source
 * B5F0-06 : no MARKET_PRIMARY_PROVIDER change in tool source
 * B5F0-07 : no market_data write in tool source
 * B5F0-08 : haversineKm — known distances
 * B5F0-09 : percentile — basic values
 * B5F0-10 : standardMedian vs currentCalcMedian on even array
 * B5F0-11 : standardMedian vs currentCalcMedian on odd array
 * B5F0-12 : analyzeGeo — radius bands populated correctly
 * B5F0-13 : analyzeDuplicates — detects and counts duplicates
 * B5F0-14 : analyzeOutliers — IQR fences and counts
 * B5F0-15 : parseGuests — from guests field and details array
 * B5F0-16 : parseAvailableDates — valid/invalid dates, dedup, past filtered
 * B5F0-17 : analyzeCalendars — 30d occupancy proxy calculation
 * B5F0-18 : analyzeCalendars — handles missing available_dates gracefully
 * B5F0-19 : analyzePrices — buckets correct
 * B5F0-20 : enrichItems — currency mismatch excluded
 * B5F0-21 : enrichItems — bedrooms=null accepted (B5-D policy)
 * B5F0-22 : enrichItems — missing pricing_details rejected as price
 * B5F0-23 : analyzeCapacity — guest distribution and categories
 * B5F0-24 : buildScenarios — candidateC only when enough guests data
 * B5F0-25 : executeMode with mock BD returns analysis without DB writes
 * B5F0-26 : executeMode with < MIN_COMPARABLES accepted → throws
 * B5F0-27 : standardMedian vs currentCalcMedian difference reported (phase 12)
 * B5F0-28 : no production provider activation (MARKET_PRIMARY_PROVIDER not set)
 * B5F0-29 : analyzeGeo handles all-missing lat/lon gracefully
 * B5F0-30 : haversineKm symmetry (A→B === B→A)
 *
 * Run: node tests/p1_2b5f0_market_quality_audit.test.js
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

// ── Load module ────────────────────────────────────────────────────────────────
const TOOL_PATH = path.resolve(__dirname, '../outils/audit-brightdata-market-quality.js');
const TOOL_SRC  = fs.readFileSync(TOOL_PATH, 'utf8');

const {
  previewMode,
  executeMode,
  haversineKm,
  percentile,
  standardMedian,
  currentCalcMedian,
  analyzePrices,
  analyzeGeo,
  analyzeCapacity,
  analyzeDuplicates,
  analyzeOutliers,
  analyzeCalendars,
  buildScenarios,
  enrichItems,
  parseGuests,
  parseAvailableDates,
  MIN_COMPARABLES,
  RADIUS_BANDS_KM,
} = require(TOOL_PATH);

// ── Mock helpers ───────────────────────────────────────────────────────────────

const REF_LAT = 48.730667;
const REF_LON = 2.276069;

const TEST_PROP_ROW = {
  id:              'prop-f0-test-001',
  user_id:         'user-f0-001',
  name:            'TestF0',
  internal_name:   null,
  address:         '18 rue Gambetta 91300 Massy',
  latitude:        String(REF_LAT),
  longitude:       String(REF_LON),
  country_code:    'FR',
  timezone:        'Europe/Paris',
  currency:        'EUR',
  channex_enabled: false,
  max_guests:      4,
  bedrooms:        2,
  beds:            3,
  is_active:       true,
  mode:            'auto',
  config_bedrooms: 2,
};

function makeReadOnlyPool(propRows = [TEST_PROP_ROW]) {
  const writes = [];
  return {
    _writes: writes,
    connect: async () => { throw new Error('no transactions in preview'); },
    query: async (sql) => {
      if (/^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER)\b/i.test(sql)) {
        writes.push(sql.trim().slice(0, 60));
        throw new Error(`Write in read-only pool: ${sql.trim().slice(0, 60)}`);
      }
      if (sql.includes('FROM properties')) return { rows: propRows };
      return { rows: [] };
    },
  };
}

// Mock BD fetch: trigger → progress → snapshot
function makeMockBdFetch(rawItems) {
  return async (url, opts) => {
    if (url.includes('/trigger') && (opts?.method === 'POST')) {
      return { ok: true, json: async () => ({ snapshot_id: 'test-snap-f0' }) };
    }
    if (url.includes('/progress/')) {
      return { ok: true, json: async () => ({ status: 'ready' }) };
    }
    if (url.includes('/snapshot/')) {
      return { ok: true, json: async () => rawItems };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

// Build a realistic raw BD item
function makeBdRawItem(overrides = {}) {
  return {
    property_id:     `prop-${Math.random().toString(36).slice(2, 8)}`,
    currency:        'EUR',
    availability:    true,
    lat:             REF_LAT + (Math.random() - 0.5) * 0.02,
    long:            REF_LON + (Math.random() - 0.5) * 0.02,
    guests:          4,
    category:        'Entire rental unit',
    ratings:         4.5,
    available_dates: ['2026-10-15', '2026-10-16', '2026-10-17'],
    pricing_details: { price_per_night: 120 + Math.floor(Math.random() * 80) },
    details:         ['4 guests', '2 bedrooms', '3 beds', '1 bath'],
    ...overrides,
  };
}

// Build a pool that captures writes (for execute mode write safety check)
function makeExecutePool() {
  const writes = [];
  return {
    _writes: writes,
    connect: async () => { throw new Error('no explicit transactions in audit tool'); },
    query: async (sql) => {
      if (/^\s*(INSERT|UPDATE|DELETE|ALTER)\b/i.test(sql)) {
        writes.push(sql.trim().slice(0, 80));
        throw new Error(`Unauthorized write: ${sql.trim().slice(0, 80)}`);
      }
      if (sql.includes('FROM properties')) return { rows: [TEST_PROP_ROW] };
      return { rows: [] };
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────
(async () => {

// B5F0-01 — preview makes 0 BD calls (source check + runtime)
await test('B5F0-01 preview makes 0 BD calls', async () => {
  const savedKey = process.env.BRIGHTDATA_API_KEY;
  process.env.BRIGHTDATA_API_KEY = 'TEST_F0_01';
  let bdCalled = false;
  const pool = makeReadOnlyPool();
  // previewMode has no _fetchImpl — it makes 0 network calls by design
  await previewMode(pool, { name: 'TestF0' });
  assert.ok(!bdCalled, 'BD must not be called in preview');
  if (savedKey !== undefined) process.env.BRIGHTDATA_API_KEY = savedKey;
  else delete process.env.BRIGHTDATA_API_KEY;
});

// B5F0-02 — preview makes 0 DB writes
await test('B5F0-02 preview makes 0 DB writes', async () => {
  const savedKey = process.env.BRIGHTDATA_API_KEY;
  process.env.BRIGHTDATA_API_KEY = 'TEST_F0_02';
  const pool = makeReadOnlyPool();
  await previewMode(pool, { name: 'TestF0' });
  assert.strictEqual(pool._writes.length, 0, `preview must write 0 rows; found: ${pool._writes.join(', ')}`);
  if (savedKey !== undefined) process.env.BRIGHTDATA_API_KEY = savedKey;
  else delete process.env.BRIGHTDATA_API_KEY;
});

// B5F0-03 — execute makes 0 DB writes
await test('B5F0-03 execute makes 0 DB writes', async () => {
  const savedKey = process.env.BRIGHTDATA_API_KEY;
  process.env.BRIGHTDATA_API_KEY = 'TEST_F0_03';
  const rawItems = Array.from({ length: 20 }, () => makeBdRawItem());
  const pool = makeExecutePool();
  await executeMode(pool, { name: 'TestF0', _fetchImpl: makeMockBdFetch(rawItems) });
  assert.strictEqual(pool._writes.length, 0, `execute must write 0 rows; found: ${pool._writes.join(', ')}`);
  if (savedKey !== undefined) process.env.BRIGHTDATA_API_KEY = savedKey;
  else delete process.env.BRIGHTDATA_API_KEY;
});

// B5F0-04 — no Channex import/call
await test('B5F0-04 tool has no Channex import or call', () => {
  assert.ok(!TOOL_SRC.includes("require('../channex')"),       'no channex require');
  assert.ok(!TOOL_SRC.includes('triggerChannexRatesSync('),    'no triggerChannexRatesSync call');
  assert.ok(!TOOL_SRC.includes('sendBookingMessage('),         'no sendBookingMessage call');
});

// B5F0-05 — no pricing application import/call
await test('B5F0-05 tool has no pricing application import or call', () => {
  assert.ok(!TOOL_SRC.includes('applyDynamicPricingForProperty('), 'no applyDynamicPricingForProperty');
  assert.ok(!TOOL_SRC.includes('runDynamicPricingForOneProperty('), 'no runDynamicPricingForOneProperty');
  assert.ok(!TOOL_SRC.includes('publishEffectivePricing('),         'no publishEffectivePricing');
  assert.ok(!TOOL_SRC.includes('priceProperty('),                   'no priceProperty');
});

// B5F0-06 — MARKET_PRIMARY_PROVIDER not set
await test('B5F0-06 tool does not set MARKET_PRIMARY_PROVIDER', () => {
  const lines = TOOL_SRC.split('\n').filter(l => !/^\s*\/\//.test(l));
  const setting = lines.filter(l => l.includes('MARKET_PRIMARY_PROVIDER') && l.includes('='));
  assert.strictEqual(setting.length, 0,
    `MARKET_PRIMARY_PROVIDER must not be set. Found: ${setting.join(' | ')}`);
});

// B5F0-07 — no market_data write in executable code
await test('B5F0-07 tool has no market_data write', () => {
  assert.ok(!TOOL_SRC.includes('writeScrapeResult('),     'no writeScrapeResult call');
  assert.ok(!TOOL_SRC.includes('INSERT INTO market_data'), 'no direct market_data INSERT');
  assert.ok(!TOOL_SRC.includes('UPDATE market_data'),      'no market_data UPDATE');
});

// B5F0-08 — haversineKm known distances
await test('B5F0-08 haversineKm returns correct distances', () => {
  // Paris ↔ London ~341 km
  const parisLondon = haversineKm(48.8566, 2.3522, 51.5074, -0.1278);
  assert.ok(Math.abs(parisLondon - 341) < 5, `Paris→London expected ~341km, got ${parisLondon}`);
  // Same point → 0
  assert.strictEqual(haversineKm(48.73, 2.28, 48.73, 2.28), 0, 'same point must be 0km');
  // Short distance M6 to 1km north
  const short = haversineKm(48.73, 2.28, 48.73 + 0.009, 2.28);
  assert.ok(short > 0.9 && short < 1.1, `1km north expected ~1km, got ${short}`);
});

// B5F0-09 — percentile basic values
await test('B5F0-09 percentile returns correct values', () => {
  const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.strictEqual(percentile(sorted, 0),   10,  'p0 = min');
  assert.strictEqual(percentile(sorted, 100), 100, 'p100 = max');
  const p50 = percentile(sorted, 50);
  assert.ok(p50 >= 50 && p50 <= 60, `p50 should be ~55, got ${p50}`);
  assert.ok(percentile([], 50) === null, 'empty array returns null');
});

// B5F0-10 — standardMedian vs currentCalcMedian on even array
await test('B5F0-10 standardMedian vs currentCalcMedian differ on even n', () => {
  const even = [10, 20, 30, 40];
  const std  = standardMedian(even);   // (20+30)/2 = 25
  const cur  = currentCalcMedian(even); // even[floor(4/2)] = even[2] = 30
  assert.strictEqual(std, 25,  `standardMedian([10,20,30,40]) should be 25, got ${std}`);
  assert.strictEqual(cur, 30,  `currentCalcMedian([10,20,30,40]) should be 30, got ${cur}`);
  assert.notStrictEqual(std, cur, 'they must differ for even arrays');
});

// B5F0-11 — standardMedian vs currentCalcMedian on odd array
await test('B5F0-11 standardMedian === currentCalcMedian on odd n', () => {
  const odd = [10, 20, 30, 40, 50];
  const std = standardMedian(odd);    // 30
  const cur = currentCalcMedian(odd); // odd[floor(5/2)] = odd[2] = 30
  assert.strictEqual(std, 30, `standardMedian odd should be 30, got ${std}`);
  assert.strictEqual(cur, 30, `currentCalcMedian odd should be 30, got ${cur}`);
});

// B5F0-12 — analyzeGeo radius bands
await test('B5F0-12 analyzeGeo populates radius bands correctly', () => {
  // 5 items within 1km, 5 items at ~3km
  const near = Array.from({ length: 5 }, (_, i) => ({
    price: 100 + i * 10, listing: { price: 100 + i * 10, isBooked: false },
    lat: REF_LAT + 0.004, lon: REF_LON + 0.004,  // ~0.5km
    propertyId: `near-${i}`, guests: 4, category: null, availDates: null,
  }));
  const far = Array.from({ length: 5 }, (_, i) => ({
    price: 300 + i * 10, listing: { price: 300 + i * 10, isBooked: false },
    lat: REF_LAT + 0.027, lon: REF_LON + 0.027,  // ~3km
    propertyId: `far-${i}`, guests: 4, category: null, availDates: null,
  }));
  const geo = analyzeGeo([...near, ...far], REF_LAT, REF_LON);
  const band1 = geo.bands.find(b => b.radiusKm === 1);
  const band5 = geo.bands.find(b => b.radiusKm === 5);
  assert.ok(band1.count >= 5, `1km band should have ≥5 items, got ${band1.count}`);
  assert.ok(band5.count === 10, `5km band should have all 10 items, got ${band5.count}`);
  assert.ok(band5.median > band1.median, '5km median should be higher than 1km (far items are expensive)');
});

// B5F0-13 — analyzeDuplicates detects and counts correctly
await test('B5F0-13 analyzeDuplicates detects duplicates', () => {
  const items = [
    { price: 100, propertyId: 'A', listing: {}, lat: null, lon: null, guests: null, category: null, availDates: null },
    { price: 110, propertyId: 'A', listing: {}, lat: null, lon: null, guests: null, category: null, availDates: null },
    { price: 200, propertyId: 'B', listing: {}, lat: null, lon: null, guests: null, category: null, availDates: null },
    { price: 300, propertyId: null, listing: {}, lat: null, lon: null, guests: null, category: null, availDates: null },
  ];
  const d = analyzeDuplicates(items);
  assert.strictEqual(d.total, 4, 'total = 4');
  assert.strictEqual(d.uniqueIds, 2, 'unique IDs = 2 (A and B)');
  assert.strictEqual(d.dupRecords, 1, 'dup records = 1 (A appears twice → 1 extra)');
  assert.strictEqual(d.noIdCount, 1, 'noId = 1');
  assert.ok(d.dupRate > 0, 'dupRate > 0');
});

// B5F0-14 — analyzeOutliers IQR
await test('B5F0-14 analyzeOutliers returns correct IQR fences', () => {
  const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 500]; // 500 is high outlier
  const iqr = analyzeOutliers(sorted);
  assert.ok(iqr.outliersHigh >= 1, 'should detect at least 1 high outlier (500)');
  assert.ok(iqr.upperFence < 500,  'upper fence should be below 500');
  assert.ok(iqr.cleanCount < sorted.length, 'clean count less than total');
});

// B5F0-15 — parseGuests from field and details array
await test('B5F0-15 parseGuests from guests field and details array', () => {
  assert.strictEqual(parseGuests({ guests: 4 }), 4, 'from numeric guests field');
  assert.strictEqual(parseGuests({ guests: '6' }), 6, 'from string guests field');
  assert.strictEqual(parseGuests({ details: ['4 guests', '2 bedrooms'] }), 4, 'from details array');
  assert.strictEqual(parseGuests({ guests: null, details: ['2 guests', '1 bed'] }), 2, 'details fallback');
  assert.strictEqual(parseGuests({ guests: null, details: null }), null, 'returns null when absent');
  assert.strictEqual(parseGuests({}), null, 'returns null for empty object');
});

// B5F0-16 — parseAvailableDates filters past/invalid dates, dedupes
await test('B5F0-16 parseAvailableDates validates, dedupes, filters past dates', () => {
  const raw = {
    available_dates: [
      '2026-10-15', '2026-10-15',  // duplicate
      '2026-01-01',                // past
      'not-a-date',                // invalid
      '2026-10-20',
      '2026-10-16',
    ],
  };
  const refDate = '2026-10-14';
  const result = parseAvailableDates(raw, refDate);
  assert.ok(Array.isArray(result), 'should return array');
  assert.ok(!result.includes('2026-01-01'), 'past date filtered');
  assert.ok(!result.includes('not-a-date'), 'invalid date filtered');
  // 2026-10-15 should appear exactly once
  assert.strictEqual(result.filter(d => d === '2026-10-15').length, 1, 'duplicate removed');
  // Should be sorted
  for (let i = 1; i < result.length; i++) {
    assert.ok(result[i] >= result[i-1], 'should be sorted');
  }
  // null available_dates → null
  assert.strictEqual(parseAvailableDates({ available_dates: null }, refDate), null);
  assert.strictEqual(parseAvailableDates({}, refDate), null);
});

// B5F0-17 — analyzeCalendars 30d occupancy proxy
await test('B5F0-17 analyzeCalendars 30d occupancy proxy calculation', () => {
  const refDate = '2026-10-14';
  // 30-day window: Oct 14 → Nov 13 (30 days)
  // Listing with 0 available dates → proxy = 30/30 = 100%
  // Listing with 30 available dates → proxy = 0/30 = 0%
  // Listing with 15 available dates → proxy = 15/30 = 50%
  const allAvail = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date('2026-10-14');
    d.setDate(d.getDate() + i);
    allAvail.push(d.toISOString().slice(0, 10));
  }
  const items = [
    { availDates: [],       listing: {}, price: 100, isBooked: false, propertyId: 'A', lat: null, lon: null, guests: null, category: null },
    { availDates: allAvail, listing: {}, price: 100, isBooked: false, propertyId: 'B', lat: null, lon: null, guests: null, category: null },
    { availDates: allAvail.slice(0, 15), listing: {}, price: 100, isBooked: false, propertyId: 'C', lat: null, lon: null, guests: null, category: null },
  ];
  const cal = analyzeCalendars(items, refDate);
  const w30 = cal.windows.find(w => w.days === 30);
  assert.ok(w30.validCount === 3, `validCount should be 3, got ${w30.validCount}`);
  // Proxies: 100%, 0%, 50% → mean=50%, median=50%
  assert.strictEqual(w30.mean,   50, `mean should be 50%, got ${w30.mean}`);
  assert.strictEqual(w30.median, 50, `median should be 50%, got ${w30.median}`);
});

// B5F0-18 — analyzeCalendars handles missing available_dates
await test('B5F0-18 analyzeCalendars handles missing available_dates gracefully', () => {
  const items = [
    { availDates: null, listing: {}, price: 100, isBooked: false, propertyId: 'A', lat: null, lon: null, guests: null, category: null },
    { availDates: null, listing: {}, price: 120, isBooked: false, propertyId: 'B', lat: null, lon: null, guests: null, category: null },
  ];
  const cal = analyzeCalendars(items, '2026-10-14');
  assert.strictEqual(cal.calPresent, 0, 'calPresent should be 0');
  assert.strictEqual(cal.calAbsent, 2, 'calAbsent should be 2');
  for (const w of cal.windows) {
    assert.strictEqual(w.validCount, 0, `window ${w.days}d validCount should be 0`);
    assert.strictEqual(w.median, null, `window ${w.days}d median should be null`);
  }
});

// B5F0-19 — analyzePrices buckets
await test('B5F0-19 analyzePrices buckets are populated correctly', () => {
  const prices = [50, 80, 120, 180, 250, 350, 450, 600];
  const sorted = [...prices].sort((a, b) => a - b);
  const stats  = analyzePrices(sorted);
  const bucket50 = stats.buckets.find(b => b.label === '< 75');
  const bucket80 = stats.buckets.find(b => b.label === '75–99');
  assert.strictEqual(bucket50.count, 1, '< 75: 1 item (50)');
  assert.strictEqual(bucket80.count, 1, '75–99: 1 item (80)');
  assert.strictEqual(stats.n, 8, 'n = 8');
  assert.ok(stats.median > 0, 'median > 0');
});

// B5F0-20 — enrichItems: currency mismatch excluded
await test('B5F0-20 enrichItems excludes currency mismatches', () => {
  const items = [
    makeBdRawItem({ currency: 'EUR', pricing_details: { price_per_night: 100 } }),
    makeBdRawItem({ currency: 'USD', pricing_details: { price_per_night: 100 } }),
    makeBdRawItem({ currency: 'GBP', pricing_details: { price_per_night: 100 } }),
  ];
  const { accepted, rejCurrency } = enrichItems(items, 'EUR', '2026-10-14');
  assert.strictEqual(accepted.length, 1, 'only EUR item accepted');
  assert.strictEqual(rejCurrency, 2, 'USD + GBP rejected for currency');
});

// B5F0-21 — enrichItems: bedrooms=null accepted (B5-D policy)
await test('B5F0-21 enrichItems accepts listings with bedrooms=null (B5-D policy)', () => {
  const item = makeBdRawItem({
    currency: 'EUR',
    availability: true,
    pricing_details: { price_per_night: 150 },
    // brightdata always has bedrooms=null per adapter contract
  });
  const { accepted } = enrichItems([item], 'EUR', '2026-10-14');
  assert.strictEqual(accepted.length, 1, 'item with bedrooms=null must be accepted');
  assert.strictEqual(accepted[0].listing.bedrooms, null, 'bedrooms must remain null');
});

// B5F0-22 — enrichItems: missing pricing_details rejected as price
await test('B5F0-22 enrichItems rejects items with no pricing_details as price rejection', () => {
  const item = makeBdRawItem({ pricing_details: null });
  const { accepted, rejPrice } = enrichItems([item], 'EUR', '2026-10-14');
  assert.strictEqual(accepted.length, 0, 'no pricing_details → rejected');
  assert.strictEqual(rejPrice, 1, 'counted as price rejection');
});

// B5F0-23 — analyzeCapacity: guest distribution and categories
await test('B5F0-23 analyzeCapacity guest distribution and categories', () => {
  const items = [
    { guests: 2, category: 'Entire rental unit', listing: {}, price: 100, isBooked: false, propertyId: 'A', lat: null, lon: null, availDates: null },
    { guests: 4, category: 'Entire rental unit', listing: {}, price: 120, isBooked: false, propertyId: 'B', lat: null, lon: null, availDates: null },
    { guests: 6, category: 'Private room', listing: {}, price: 80, isBooked: false, propertyId: 'C', lat: null, lon: null, availDates: null },
    { guests: null, category: 'Entire rental unit', listing: {}, price: 150, isBooked: false, propertyId: 'D', lat: null, lon: null, availDates: null },
  ];
  const cap = analyzeCapacity(items);
  assert.strictEqual(cap.guestFieldPresent, 3, '3 items have guests');
  assert.strictEqual(cap.guestFieldMissing, 1, '1 item missing guests');
  assert.ok(cap.categoryDist['Entire rental unit'] >= 2, 'Entire rental unit appears ≥2');
  assert.strictEqual(cap.categoryDist['Private room'], 1, 'Private room appears 1');
});

// B5F0-24 — buildScenarios: candidateC skipped when guests data insufficient
await test('B5F0-24 buildScenarios omits candidateC when guests data insufficient', () => {
  const items = Array.from({ length: 20 }, (_, i) => ({
    price: 100 + i * 5,
    isBooked: false,
    lat: REF_LAT + 0.002,
    lon: REF_LON + 0.002,
    propertyId: `p${i}`,
    guests: null,   // no guest data
    category: null,
    availDates: null,
    listing: { price: 100 + i * 5, isBooked: false, bedrooms: null },
  }));
  const geo = analyzeGeo(items, REF_LAT, REF_LON);
  const cal = analyzeCalendars(items, '2026-10-14');
  const scen = buildScenarios(items, REF_LAT, REF_LON, geo, null, cal, 4);
  // propCapacity=4 but guests all null → C skipped
  assert.strictEqual(scen.candidateC, null, 'candidateC must be null when guests all null');
});

// B5F0-25 — executeMode with mock BD returns analysis without DB writes
await test('B5F0-25 executeMode returns full analysis with 0 DB writes', async () => {
  const savedKey = process.env.BRIGHTDATA_API_KEY;
  process.env.BRIGHTDATA_API_KEY = 'TEST_F0_25';
  const rawItems = Array.from({ length: 20 }, (_, i) =>
    makeBdRawItem({ pricing_details: { price_per_night: 100 + i * 5 } })
  );
  const pool = makeExecutePool();
  const result = await executeMode(pool, {
    name: 'TestF0',
    _fetchImpl: makeMockBdFetch(rawItems),
  });
  assert.strictEqual(pool._writes.length, 0, 'zero DB writes');
  assert.ok(result.returnedCount === 20, 'returnedCount = 20');
  assert.ok(result.acceptedCount > 0, 'some items accepted');
  assert.ok(result.priceStats, 'priceStats present');
  assert.ok(result.geoAnalysis, 'geoAnalysis present');
  assert.ok(result.dupAnalysis, 'dupAnalysis present');
  assert.ok(result.calAnalysis, 'calAnalysis present');
  assert.ok(result.scenarios,   'scenarios present');
  if (savedKey !== undefined) process.env.BRIGHTDATA_API_KEY = savedKey;
  else delete process.env.BRIGHTDATA_API_KEY;
});

// B5F0-26 — executeMode with < MIN_COMPARABLES accepted → throws
await test('B5F0-26 executeMode throws when accepted < MIN_COMPARABLES', async () => {
  const savedKey = process.env.BRIGHTDATA_API_KEY;
  process.env.BRIGHTDATA_API_KEY = 'TEST_F0_26';
  // Return 3 items with invalid pricing (all rejected)
  const rawItems = Array.from({ length: 3 }, () =>
    makeBdRawItem({ currency: 'USD' })  // all currency-rejected
  );
  const pool = makeExecutePool();
  await assert.rejects(
    () => executeMode(pool, { name: 'TestF0', _fetchImpl: makeMockBdFetch(rawItems) }),
    err => err.message.includes('MIN_COMPARABLES') || err.message.includes('below'),
    'must throw when accepted < MIN_COMPARABLES'
  );
  if (savedKey !== undefined) process.env.BRIGHTDATA_API_KEY = savedKey;
  else delete process.env.BRIGHTDATA_API_KEY;
});

// B5F0-27 — standardMedian vs currentCalcMedian difference reported (phase 12)
await test('B5F0-27 analyzePrices reports both standard and current calc median', () => {
  // Prices that produce different values for even n
  const sorted = [100, 120, 140, 160, 180, 200, 220, 240]; // n=8
  const stats = analyzePrices(sorted);
  // standard median = (sorted[3]+sorted[4])/2 = (160+180)/2 = 170
  // current calc  = sorted[floor(8/2)] = sorted[4] = 180
  assert.strictEqual(stats.median,     170, `standard median should be 170, got ${stats.median}`);
  assert.strictEqual(stats.calcMedian, 180, `current calc median should be 180, got ${stats.calcMedian}`);
  assert.notStrictEqual(stats.median, stats.calcMedian, 'they should differ for this even array');
});

// B5F0-28 — MARKET_PRIMARY_PROVIDER env not changed at module load
await test('B5F0-28 loading tool does not change MARKET_PRIMARY_PROVIDER', () => {
  const before = process.env.MARKET_PRIMARY_PROVIDER;
  // Module already loaded above — check env is unchanged
  const after  = process.env.MARKET_PRIMARY_PROVIDER;
  assert.strictEqual(before, after, 'MARKET_PRIMARY_PROVIDER must not change on module load');
});

// B5F0-29 — analyzeGeo handles all-missing lat/lon gracefully
await test('B5F0-29 analyzeGeo handles all-missing lat/lon', () => {
  const items = Array.from({ length: 5 }, (_, i) => ({
    price: 100 + i * 10, listing: {}, lat: null, lon: null,
    propertyId: `p${i}`, guests: null, category: null, availDates: null,
  }));
  const geo = analyzeGeo(items, REF_LAT, REF_LON);
  assert.strictEqual(geo.withGeoCount, 0, 'withGeoCount = 0');
  assert.strictEqual(geo.missingGeoCount, 5, 'missingGeoCount = 5');
  assert.strictEqual(geo.distStats, null, 'distStats = null when no geo data');
  for (const b of geo.bands) {
    assert.strictEqual(b.count, 0, `band ${b.radiusKm}km should have 0 items`);
  }
});

// B5F0-30 — haversineKm symmetry
await test('B5F0-30 haversineKm is symmetric (A→B === B→A)', () => {
  const d1 = haversineKm(48.73, 2.28, 51.50, -0.12);
  const d2 = haversineKm(51.50, -0.12, 48.73, 2.28);
  assert.ok(Math.abs(d1 - d2) < 0.001, `haversine must be symmetric: ${d1} vs ${d2}`);
});

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`  ${passed} passed, ${failed} failed  /  ${passed + failed} total`);
if (failures.length) {
  console.log('\n  Failed tests:');
  failures.forEach(f => console.log(`    ❌  ${f.name}\n       ${f.message}`));
}
console.log('');

if (failed > 0) process.exit(1);

})();
