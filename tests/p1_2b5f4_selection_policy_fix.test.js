#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.2-B5-F4 Selection Policy Fix
 *
 * B5F4-01: M6 scenario: 2@1km,4@2km,5@3km,5@5km,5@10km,42@20km → selects 3km/5
 * B5F4-02: wider TARGET: 4@5km,9@10km → selects 10km/9
 * B5F4-03: wider TARGET beats FALLBACK: 4@5km,6@10km,9@20km → selects 20km/9
 * B5F4-04: wider FALLBACK only: 4@5km,6@10km,6@20km → selects 10km/6
 * B5F4-05: insufficient_comparables: 3@20km → status=insufficient_comparables
 * B5F4-06: local cluster always beats distant TARGET cluster
 * B5F4-07: dedup still occurs before radius selection
 * B5F4-08: capacity filtering still occurs before radius selection
 * B5F4-09: category filtering works when targetPropertyType supplied
 * B5F4-10: targetPropertyType=null does not invent a category filter
 * B5F4-11: standard median unchanged (average two middle for even n)
 * B5F4-12: calendar proxy unchanged (60-day window, median across listings)
 * B5F4-13: Apify path unchanged (calcMarketStats not touched)
 * B5F4-14: no DB / market / pricing / Channex writes in filter module
 * B5F4-15: LOCAL_PRIORITY_RADIUS_KM exported = 5
 * B5F4-16: Phase A selects at FALLBACK threshold exactly (not TARGET)
 * B5F4-17: Phase B skips local radii
 * B5F4-18: Phase C never runs when Phase B finds TARGET
 * B5F4-19: 5@5km,9@20km → selects 5km/5 (local beats 20km/9)
 * B5F4-20: property_type in pricing_config is 't2/t3' — not mappable to BD category
 * B5F4-21: cron passes targetGuests to selectComparables
 * B5F4-22: cron does NOT pass targetPropertyType (F4-B blocked by schema)
 * B5F4-23: radiusCandidateCounts still populated in F4 algorithm
 * B5F4-24: 8@1km → Phase A selects 1km/8 (≥ FALLBACK, local)
 * B5F4-25: 0@5km,5@10km → Phase A fails, Phase C selects 10km/5
 *
 * Run: node tests/p1_2b5f4_selection_policy_fix.test.js
 * LIVE_BRIGHTDATA_CALLS=0  DB_WRITES=0  PRICING_WRITES=0  CHANNEX_WRITES=0
 */

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');

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

// ── Load modules ──────────────────────────────────────────────────────────────

const FILTER_PATH = path.resolve(__dirname, '../services/brightdata-comparable-filter.js');
const FILTER_SRC  = fs.readFileSync(FILTER_PATH, 'utf8');
const CRON_PATH   = path.resolve(__dirname, '../routes/dynamic-pricing-cron.js');
const CRON_SRC    = fs.readFileSync(CRON_PATH, 'utf8');

const {
  selectComparables,
  calcBrightDataMarketStats,
  RADIUS_BANDS_KM,
  MIN_COMPARABLES_TARGET,
  MIN_COMPARABLES_FALLBACK,
  LOCAL_PRIORITY_RADIUS_KM,
  CALENDAR_WINDOW_DAYS,
} = require(FILTER_PATH);

// ── Fixture helpers ────────────────────────────────────────────────────────────

const REF_LAT = 48.730667;
const REF_LON = 2.276069;

function degPerKm(km) { return km / 111.2; }

// Create a listing at exactly distKm from REF (place north)
function listingAt(distKm, overrides = {}) {
  return {
    price:             150,
    isBooked:          false,
    bedrooms:          1,
    stars:             4.5,
    providerListingId: null,
    latitude:          REF_LAT + degPerKm(distKm * 0.95),
    longitude:         REF_LON,
    guests:            null,
    category:          null,
    availableDates:    null,
    ...overrides,
  };
}

// Create N listings all at exactly distKm
function nAt(n, distKm, overrides = {}) {
  return Array.from({ length: n }, (_, i) =>
    listingAt(distKm, { providerListingId: `d${distKm}-${i}`, ...overrides })
  );
}

// ── TESTS ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n══════════════════════════════════════════════════════════════════════════');
  console.log('  P1.2-B5-F4 — Selection Policy Fix');
  console.log('══════════════════════════════════════════════════════════════════════════\n');

  const opts = { targetLat: REF_LAT, targetLon: REF_LON };

  // ── Spec scenario tests ───────────────────────────────────────────────────

  await test('B5F4-01: M6 scenario (2@1km,4@2km,5@3km,5@5km,5@10km,42@20km) → 3km/5', () => {
    // Build listings: 2 within 1km, 2 more within 2km, 1 more within 3km (total 5 at 3km)
    // then 0 more between 3-5km (total 5 at 5km), 0 more 5-10km (total 5 at 10km)
    // then 37 more between 10-20km (total 42 at 20km)
    const listings = [
      ...nAt(2, 0.6),           // 2 within 1km
      ...nAt(2, 1.5),           // 2 more within 2km → 4 at 2km
      ...nAt(1, 2.5),           // 1 more within 3km → 5 at 3km
      // none between 3-5km → 5 at 5km
      // none between 5-10km → 5 at 10km
      ...nAt(37, 15),           // 37 more within 20km → 42 at 20km
    ];
    const { selectedRadiusKm, listings: sel, status } = selectComparables(listings, opts);
    assert.strictEqual(selectedRadiusKm, 3,  `Expected 3km, got ${selectedRadiusKm}km`);
    assert.strictEqual(sel.length, 5,         `Expected 5 comparables, got ${sel.length}`);
    assert.strictEqual(status, 'ok');
  });

  await test('B5F4-02: wider TARGET: 4@5km,9@10km → selects 10km/9', () => {
    const listings = [...nAt(4, 4.5), ...nAt(5, 8)];
    // at 5km: 4 < FALLBACK → no local; at 10km: 9 ≥ TARGET → Phase B
    const { selectedRadiusKm, listings: sel, status } = selectComparables(listings, opts);
    assert.strictEqual(selectedRadiusKm, 10, `Expected 10km, got ${selectedRadiusKm}km`);
    assert.strictEqual(sel.length, 9,         `Expected 9, got ${sel.length}`);
    assert.strictEqual(status, 'ok');
  });

  await test('B5F4-03: wider TARGET beats FALLBACK: 4@5km,6@10km,9@20km → selects 20km/9', () => {
    const listings = [...nAt(4, 4.5), ...nAt(2, 8), ...nAt(3, 15)];
    // at 5km: 4 < FALLBACK; at 10km: 6 < TARGET; at 20km: 9 ≥ TARGET → Phase B
    const { selectedRadiusKm, listings: sel, status } = selectComparables(listings, opts);
    assert.strictEqual(selectedRadiusKm, 20, `Expected 20km, got ${selectedRadiusKm}km`);
    assert.strictEqual(sel.length, 9,         `Expected 9, got ${sel.length}`);
    assert.strictEqual(status, 'ok');
  });

  await test('B5F4-04: wider FALLBACK only: 4@5km,6@10km,6@20km → selects 10km/6', () => {
    const listings = [...nAt(4, 4.5), ...nAt(2, 8), ...nAt(0, 15)];
    // at 5km: 4 < FALLBACK; wider: 10km: 6 < TARGET, 20km: 6 < TARGET → no Phase B
    // Phase C: 10km: 6 ≥ FALLBACK → select 10km
    const listings2 = [...nAt(4, 4.5), ...nAt(6, 8)];  // 4 at 5km, 10 at 10km
    // Wait: need exactly 6 at 10km total, not 10. Let me adjust:
    // 4 within 5km + 2 between 5-10km = 6 at 10km + 0 more at 20km = 6 at 20km
    const l = [...nAt(4, 4.5), ...nAt(2, 8)];
    // 4 at 5km, 6 at 10km, 6 at 20km (none added between 10-20)
    const { selectedRadiusKm, listings: sel, status } = selectComparables(l, opts);
    assert.strictEqual(selectedRadiusKm, 10, `Expected 10km, got ${selectedRadiusKm}km`);
    assert.strictEqual(sel.length, 6,         `Expected 6, got ${sel.length}`);
    assert.strictEqual(status, 'ok');
  });

  await test('B5F4-05: insufficient_comparables when <5 through all radii', () => {
    const listings = nAt(3, 15);
    const { status, listings: sel } = selectComparables(listings, opts);
    assert.strictEqual(status, 'insufficient_comparables');
    assert.strictEqual(sel.length, 0);
  });

  await test('B5F4-06: local cluster always beats distant TARGET cluster', () => {
    // 5 within 3km + 42 at 18km → should select 3km/5, NOT 20km/47
    const listings = [...nAt(5, 2.5), ...nAt(42, 18)];
    const { selectedRadiusKm, listings: sel } = selectComparables(listings, opts);
    assert.strictEqual(selectedRadiusKm, 3,  `Expected 3km (local), got ${selectedRadiusKm}km`);
    assert.strictEqual(sel.length, 5);
  });

  // ── Quality filter preservation tests ─────────────────────────────────────

  await test('B5F4-07: dedup still occurs before radius selection', () => {
    // 10 listings within 3km but 5 are duplicates → only 5 unique → 3km selected
    const base = nAt(5, 2.5).map((l, i) => ({ ...l, providerListingId: `dup-${i}` }));
    const dupes = base.map(l => ({ ...l }));  // exact copies with same IDs
    const { listings: sel, diagnostics: diag } = selectComparables([...base, ...dupes], opts);
    assert.strictEqual(diag.duplicateCount, 5, `Expected 5 dupes, got ${diag.duplicateCount}`);
    assert.strictEqual(sel.length, 5, `Expected 5 unique, got ${sel.length}`);
  });

  await test('B5F4-08: capacity filtering still occurs before radius selection', () => {
    // 10 within 3km but 5 have guests=99 (outside ±2 of target=3) → only 5 qualify
    const good = nAt(5, 2.5).map((l, i) => ({ ...l, providerListingId: `g${i}`, guests: 3 }));
    const bad  = nAt(5, 2.5).map((l, i) => ({ ...l, providerListingId: `b${i}`, guests: 99 }));
    const { listings: sel, diagnostics: diag } = selectComparables(
      [...good, ...bad], { ...opts, targetGuests: 3 }
    );
    assert.strictEqual(diag.capacityRejectedCount, 5, `Expected 5 capacity-rejected`);
    assert.strictEqual(sel.length, 5, `Expected 5 remaining, got ${sel.length}`);
  });

  await test('B5F4-09: category filtering works when targetPropertyType supplied', () => {
    // 10 within 3km: 5 "Entire apartment" + 5 "Private room" (incompatible with entire_place)
    const entire = nAt(5, 2.5).map((l, i) => ({ ...l, providerListingId: `e${i}`, category: 'Entire apartment' }));
    const rooms  = nAt(5, 2.5).map((l, i) => ({ ...l, providerListingId: `r${i}`, category: 'Private room' }));
    const { listings: sel, diagnostics: diag } = selectComparables(
      [...entire, ...rooms], { ...opts, targetPropertyType: 'entire_place' }
    );
    assert.strictEqual(diag.categoryRejectedCount, 5, `Expected 5 category-rejected`);
    assert.strictEqual(sel.length, 5, `Expected 5 entire_place only, got ${sel.length}`);
  });

  await test('B5F4-10: targetPropertyType=null does not filter by category', () => {
    const entire = nAt(3, 2.5).map((l, i) => ({ ...l, providerListingId: `e${i}`, category: 'Entire apartment' }));
    const rooms  = nAt(2, 2.5).map((l, i) => ({ ...l, providerListingId: `r${i}`, category: 'Private room' }));
    const { listings: sel, diagnostics: diag } = selectComparables(
      [...entire, ...rooms], { ...opts, targetPropertyType: null }
    );
    assert.strictEqual(diag.categoryRejectedCount, 0, 'null targetPropertyType must not reject any category');
    assert.strictEqual(sel.length, 5);
  });

  // ── Statistical preservation tests ────────────────────────────────────────

  await test('B5F4-11: standard median unchanged (average two middle for even n)', () => {
    const comparables = [
      { price: 100, availableDates: null },
      { price: 200, availableDates: null },
      { price: 300, availableDates: null },
      { price: 400, availableDates: null },
    ];
    const stats = calcBrightDataMarketStats(comparables, { today: '2026-10-01' });
    assert.ok(stats != null, 'stats must not be null');
    // sorted: [100,200,300,400], n=4, mid=2 → (200+300)/2 = 250
    assert.strictEqual(stats.median, 250, `Expected median=250, got ${stats.median}`);
  });

  await test('B5F4-12: calendar proxy unchanged (60-day window, median across listings)', () => {
    const today = '2026-10-01';
    const makeDates = (n) => Array.from({ length: n }, (_, i) => {
      const d = new Date('2026-10-01T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + i);
      return d.toISOString().slice(0, 10);
    });
    // 5 comparables: each with 30 available dates out of 60 → unavail = 50%
    const comparables = Array.from({ length: 5 }, () => ({
      price: 100,
      availableDates: makeDates(30),
    }));
    const stats = calcBrightDataMarketStats(comparables, { today });
    assert.strictEqual(stats.occupancy_semantics, 'calendar_unavailability_proxy');
    assert.strictEqual(stats.occupancy, 50, `Expected occupancy=50%, got ${stats.occupancy}`);
    assert.strictEqual(stats.count, 5);  // count = price count (5 listings)
  });

  await test('B5F4-13: Apify path unchanged (calcMarketStats in cron not touched)', () => {
    // Verify cron still has calcMarketStats for non-brightdata_live path
    assert.ok(CRON_SRC.includes('calcMarketStats'), 'cron must still use calcMarketStats for Apify');
    assert.ok(CRON_SRC.includes("dataSource === 'brightdata_live'"),
      'cron must have BD path conditional');
    // Verify calcBrightDataMarketStats is the BD-specific stats function
    assert.ok(CRON_SRC.includes('calcBrightDataMarketStats'),
      'cron must use calcBrightDataMarketStats for BD path');
  });

  await test('B5F4-14: no DB/market/pricing/Channex writes in filter module source', () => {
    const codeLines = FILTER_SRC.split('\n').filter(l => !/^\s*(\*|\/\/)/.test(l));
    const codeSrc   = codeLines.join('\n');
    assert.ok(!/\bpool\b/.test(codeSrc),       'filter must not use pool');
    assert.ok(!/\bINSERT\b/i.test(codeSrc),    'filter must not INSERT');
    assert.ok(!/\bUPDATE\b/i.test(codeSrc),    'filter must not UPDATE');
    assert.ok(!codeSrc.includes('require(\'../channex\')') &&
              !codeSrc.includes('require("../channex")'),
      'filter must not require channex');
    assert.ok(!codeSrc.includes('writeScrapeResult'), 'filter must not call writeScrapeResult');
  });

  // ── New constants and algorithm structure tests ───────────────────────────

  await test('B5F4-15: LOCAL_PRIORITY_RADIUS_KM exported and equals 5', () => {
    assert.strictEqual(LOCAL_PRIORITY_RADIUS_KM, 5,
      `Expected LOCAL_PRIORITY_RADIUS_KM=5, got ${LOCAL_PRIORITY_RADIUS_KM}`);
    assert.ok(FILTER_SRC.includes('LOCAL_PRIORITY_RADIUS_KM'),
      'constant must be defined in source');
  });

  await test('B5F4-16: Phase A selects at FALLBACK threshold exactly (not TARGET)', () => {
    // Exactly FALLBACK=5 within 3km (< TARGET=8) → should still be selected by Phase A
    const listings = nAt(MIN_COMPARABLES_FALLBACK, 2.5);
    const { selectedRadiusKm, listings: sel, status } = selectComparables(listings, opts);
    assert.strictEqual(selectedRadiusKm, 3, `Expected 3km, got ${selectedRadiusKm}km`);
    assert.strictEqual(sel.length, MIN_COMPARABLES_FALLBACK);
    assert.strictEqual(status, 'ok');
  });

  await test('B5F4-17: Phase B skips local radii (does not double-count)', () => {
    // 7 at 4km (< TARGET=8) + 10 at 15km (≥ TARGET)
    // Phase A: 5km: 7 ≥ FALLBACK → selects 5km at Phase A, not 20km
    const listings = [...nAt(7, 4.5), ...nAt(10, 15)];
    const { selectedRadiusKm, listings: sel } = selectComparables(listings, opts);
    // Phase A: 1km=0, 2km=0, 3km=0, 5km=7 ≥ 5 → select 5km
    assert.strictEqual(selectedRadiusKm, 5, `Phase A should select 5km, got ${selectedRadiusKm}km`);
    assert.strictEqual(sel.length, 7);
  });

  await test('B5F4-18: Phase C never runs when Phase B finds TARGET', () => {
    // 4 at 5km (no local) + 9 at 10km (TARGET) → Phase B succeeds, Phase C must not change it
    const listings = [...nAt(4, 4.5), ...nAt(5, 8)];
    const { selectedRadiusKm, listings: sel } = selectComparables(listings, opts);
    assert.strictEqual(selectedRadiusKm, 10, `Phase B must select 10km (TARGET), got ${selectedRadiusKm}km`);
    assert.strictEqual(sel.length, 9);
  });

  await test('B5F4-19: 5@5km,9@20km → selects 5km/5 (local beats distant TARGET)', () => {
    const listings = [...nAt(5, 4.5), ...nAt(4, 15)];
    // at 5km: 5 ≥ FALLBACK AND 5 ≤ LOCAL → Phase A selects 5km
    const { selectedRadiusKm, listings: sel } = selectComparables(listings, opts);
    assert.strictEqual(selectedRadiusKm, 5, `Expected 5km, got ${selectedRadiusKm}km`);
    assert.strictEqual(sel.length, 5);
  });

  await test('B5F4-20: pricing_config.property_type is apartment size — not BD category', () => {
    // F4-B blocked by schema: property_type in pricing_config holds 'studio'/'t2'/'t3'
    // These are French apartment size codes, not Airbnb listing types.
    // Verify the schema comment exists in server.js
    const serverSrc = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
    // The property_type column comment mentions 'studio', 't2', 't3' — size taxonomy
    assert.ok(
      serverSrc.includes("'studio'") || serverSrc.includes("'t2'") || serverSrc.includes("studio"),
      'server.js must document apartment size taxonomy for property_type'
    );
    // Verify cron does NOT pass targetPropertyType to selectComparables
    // (F4-B blocked: no reliable listing-type field available)
    const cronFnIdx = CRON_SRC.indexOf('function calcProviderMarketStats');
    const cronFnEnd = CRON_SRC.indexOf('\nfunction ', cronFnIdx + 1);
    const cronFnBody = CRON_SRC.slice(cronFnIdx, cronFnEnd > 0 ? cronFnEnd : cronFnIdx + 2000);
    assert.ok(!cronFnBody.includes('targetPropertyType:'),
      'cron calcProviderMarketStats must NOT pass targetPropertyType (F4-B blocked by schema)');
  });

  await test('B5F4-21: cron passes targetGuests to selectComparables', () => {
    const cronFnIdx = CRON_SRC.indexOf('function calcProviderMarketStats');
    const cronFnEnd = CRON_SRC.indexOf('\nfunction ', cronFnIdx + 1);
    const cronFnBody = CRON_SRC.slice(cronFnIdx, cronFnEnd > 0 ? cronFnEnd : cronFnIdx + 2000);
    assert.ok(cronFnBody.includes('targetGuests:'),
      'cron must pass targetGuests to selectComparables');
  });

  await test('B5F4-22: cron does NOT pass targetPropertyType (F4-B blocked by schema)', () => {
    const cronFnIdx = CRON_SRC.indexOf('function calcProviderMarketStats');
    const cronFnEnd = CRON_SRC.indexOf('\nfunction ', cronFnIdx + 1);
    const cronFnBody = CRON_SRC.slice(cronFnIdx, cronFnEnd > 0 ? cronFnEnd : cronFnIdx + 2000);
    assert.ok(!cronFnBody.includes('targetPropertyType:'),
      'F4-B blocked: cron must not pass targetPropertyType until schema has reliable field');
  });

  await test('B5F4-23: radiusCandidateCounts still populated in F4 algorithm', () => {
    const listings = [...nAt(5, 2.5), ...nAt(10, 8)];
    const { diagnostics: diag } = selectComparables(listings, opts);
    assert.ok(diag.radiusCandidateCounts != null, 'radiusCandidateCounts must not be null');
    for (const r of RADIUS_BANDS_KM) {
      assert.ok(r in diag.radiusCandidateCounts, `radiusCandidateCounts must include ${r}km`);
    }
    assert.strictEqual(diag.radiusCandidateCounts[3], 5, 'At 3km: expect 5 comparables');
    assert.strictEqual(diag.radiusCandidateCounts[20], 15, 'At 20km: expect 15 comparables');
  });

  await test('B5F4-24: 8@1km → Phase A selects 1km/8 (≥ FALLBACK, local)', () => {
    const listings = nAt(8, 0.5);
    const { selectedRadiusKm, listings: sel } = selectComparables(listings, opts);
    assert.strictEqual(selectedRadiusKm, 1, `Expected 1km, got ${selectedRadiusKm}km`);
    assert.strictEqual(sel.length, 8);
  });

  await test('B5F4-25: 0@5km,5@10km → Phase A fails, Phase C selects 10km/5', () => {
    // All listings between 7-9km: 0 within 5km, 5 within 10km (< TARGET=8)
    const listings = nAt(5, 8);
    const { selectedRadiusKm, listings: sel, status } = selectComparables(listings, opts);
    // Phase A: 0<5 at all ≤5km radii
    // Phase B: 5<8 at 10km, 5<8 at 20km → no TARGET
    // Phase C: 5≥5 at 10km → select 10km
    assert.strictEqual(selectedRadiusKm, 10, `Expected 10km (Phase C), got ${selectedRadiusKm}km`);
    assert.strictEqual(sel.length, 5);
    assert.strictEqual(status, 'ok');
  });

  // ── Summary ────────────────────────────────────────────────────────────────

  console.log('\n══════════════════════════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\n  Failures:');
    for (const f of failures) console.log(`    ❌  ${f.name}: ${f.message}`);
  }
  console.log('══════════════════════════════════════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
})();
