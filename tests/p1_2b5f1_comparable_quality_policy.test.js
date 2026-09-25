#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.2-B5-F1 Bright Data Comparable Quality Policy
 *
 * B5F1-01 : brightdata-comparable-filter has no pool / no DB writes
 * B5F1-02 : no Channex import/call in filter module
 * B5F1-03 : no pricing apply import/call in filter module
 * B5F1-04 : cron imports from brightdata-comparable-filter
 * B5F1-05 : cron has brightdata_live branch calling selectComparables
 * B5F1-06 : cron has brightdata_live branch calling calcBrightDataMarketStats
 * B5F1-07 : parseBrightDataItem preserves providerListingId
 * B5F1-08 : parseBrightDataItem preserves latitude / longitude
 * B5F1-09 : parseBrightDataItem preserves guests (number)
 * B5F1-10 : parseBrightDataItem preserves guests (string)
 * B5F1-11 : parseBrightDataItem preserves category
 * B5F1-12 : parseBrightDataItem preserves availableDates (validated, deduped, sorted)
 * B5F1-13 : selectComparables deduplicates by providerListingId (keeps first)
 * B5F1-14 : listings with null providerListingId all kept
 * B5F1-15 : category filter rejects room/hotel/hostel for entire_place target
 * B5F1-16 : category filter accepts "Entire apartment" for entire_place target
 * B5F1-17 : category filter keeps listing with missing category (conservative)
 * B5F1-18 : capacity filter rejects listings outside ±MIN_GUEST_DELTA
 * B5F1-19 : capacity filter keeps listing with missing guests (conservative)
 * B5F1-20 : capacity filter passes all when targetGuests is null
 * B5F1-21 : adaptive radius selects 1km when ≥ MIN_COMPARABLES_TARGET at 1km
 * B5F1-22 : adaptive radius falls back to 2km when <8 at 1km but ≥8 at 2km
 * B5F1-23 : adaptive radius falls back to fallback band (≥5) when target not met
 * B5F1-24 : insufficient_comparables status when <5 in any radius
 * B5F1-25 : no coords → returns all qualified, selectedRadiusKm=null, status ok
 * B5F1-26 : diagnostics.duplicateCount is accurate
 * B5F1-27 : diagnostics.categoryRejectedCount is accurate
 * B5F1-28 : calcBrightDataMarketStats standard median — even n averages two middles
 * B5F1-29 : calcBrightDataMarketStats standard median — odd n returns middle value
 * B5F1-30 : standard median differs from floor(n/2) for even-n array
 * B5F1-31 : p25 and p75 computed with floor formula
 * B5F1-32 : calendar unavailability proxy calculated correctly
 * B5F1-33 : occupancy_semantics='calendar_unavailability_proxy' when ≥5 calendars
 * B5F1-34 : occupancy_semantics='insufficient_calendars' when <5 calendars
 * B5F1-35 : listings without availableDates excluded from proxy
 * B5F1-36 : tensionLevel derived from occupancy
 * B5F1-37 : cron job query includes p.max_guests and p.timezone
 * B5F1-38 : cron one-property query includes p.max_guests and p.timezone
 * B5F1-39 : MARKET_PRIMARY_PROVIDER not changed in cron source
 * B5F1-40 : Phase 13 audit tool printScenario uses s.label not call-site label
 *
 * Run: node tests/p1_2b5f1_comparable_quality_policy.test.js
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

const FILTER_PATH = path.resolve(__dirname, '../services/brightdata-comparable-filter.js');
const FILTER_SRC  = fs.readFileSync(FILTER_PATH, 'utf8');

const CRON_PATH = path.resolve(__dirname, '../routes/dynamic-pricing-cron.js');
const CRON_SRC  = fs.readFileSync(CRON_PATH, 'utf8');

const BD_PATH = path.resolve(__dirname, '../services/providers/brightdata.js');

const AUDIT_PATH = path.resolve(__dirname, '../outils/audit-brightdata-market-quality.js');
const AUDIT_SRC  = fs.readFileSync(AUDIT_PATH, 'utf8');

const {
  selectComparables,
  calcBrightDataMarketStats,
  haversineKm,
  isCategoryCompatible,
  isCapacityCompatible,
  addDaysToDate,
  RADIUS_BANDS_KM,
  MIN_COMPARABLES_TARGET,
  MIN_COMPARABLES_FALLBACK,
  MIN_GUEST_DELTA,
  CALENDAR_WINDOW_DAYS,
  MIN_CALENDAR_COMPARABLES,
} = require(FILTER_PATH);

const { parseBrightDataItem } = require(BD_PATH);

// ── Fixture helpers ────────────────────────────────────────────────────────────

const REF_LAT = 48.8566;
const REF_LON = 2.3522;

// Build listing with coords exactly r km from REF
function listingAt(distKm, overrides = {}) {
  // Approx: 1 deg lat ≈ 111.2 km
  const lat = REF_LAT + distKm / 111.2;
  return {
    price:             120,
    isBooked:          false,
    bedrooms:          null,
    stars:             4.5,
    providerListingId: `id-dist-${distKm}`,
    latitude:          lat,
    longitude:         REF_LON,
    guests:            4,
    category:          'Entire apartment',
    availableDates:    null,
    ...overrides,
  };
}

function makeListing(overrides = {}) {
  return {
    price:             100,
    isBooked:          false,
    bedrooms:          null,
    stars:             4,
    providerListingId: null,
    latitude:          null,
    longitude:         null,
    guests:            null,
    category:          null,
    availableDates:    null,
    ...overrides,
  };
}

// Minimal Bright Data raw item for parseBrightDataItem
function rawItem(overrides = {}) {
  return {
    currency:       'EUR',
    pricing_details: { price_per_night: 100 },
    availability:   true,
    ratings:        4.5,
    property_id:    'prop-001',
    lat:            48.8566,
    long:           2.3522,
    guests:         4,
    category:       'Entire apartment',
    available_dates: ['2026-10-01', '2026-10-02', '2026-10-03'],
    ...overrides,
  };
}

// ── TESTS ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  P1.2-B5-F1 — Bright Data Comparable Quality Policy');
  console.log('══════════════════════════════════════════════════════════════\n');

  // ── Safety: module contracts ──────────────────────────────────────────────

  await test('B5F1-01: brightdata-comparable-filter has no pool / no DB writes', () => {
    assert.ok(!FILTER_SRC.includes('require(\'pg\')') && !FILTER_SRC.includes('require("pg")'),
      'must not import pg');
    assert.ok(!FILTER_SRC.includes('new Pool('), 'must not instantiate Pool');
    const writeMatch = /\bpool\.(query|end)\s*\(/.test(FILTER_SRC);
    assert.ok(!writeMatch, 'must not call pool.query or pool.end');
  });

  await test('B5F1-02: no Channex import/call in filter module', () => {
    assert.ok(!FILTER_SRC.includes("require('../channex')") &&
              !FILTER_SRC.includes('require("../channex")'),
      'must not require channex');
    assert.ok(!FILTER_SRC.includes('triggerChannexRatesSync('), 'must not call channex sync');
  });

  await test('B5F1-03: no pricing apply import/call in filter module', () => {
    // Check require() calls only — exclude comments (lines starting with * or //)
    const codeLines = FILTER_SRC.split('\n')
      .filter(l => !/^\s*(\*|\/\/)/.test(l));
    const codeSrc = codeLines.join('\n');
    assert.ok(!codeSrc.includes("require('./pricing-apply')") &&
              !codeSrc.includes('require("./pricing-apply")') &&
              !codeSrc.includes("require('../pricing-apply')"),
      'must not require pricing-apply');
    assert.ok(!codeSrc.includes('applyDynamicPricingForProperty('),
      'must not call applyDynamicPricingForProperty');
  });

  await test('B5F1-04: cron imports from brightdata-comparable-filter', () => {
    assert.ok(CRON_SRC.includes('brightdata-comparable-filter'),
      'cron must require brightdata-comparable-filter');
    assert.ok(CRON_SRC.includes('selectComparables'), 'cron must reference selectComparables');
    assert.ok(CRON_SRC.includes('calcBrightDataMarketStats'), 'cron must reference calcBrightDataMarketStats');
  });

  await test('B5F1-05: cron has brightdata_live branch calling selectComparables', () => {
    assert.ok(CRON_SRC.includes("dataSource === 'brightdata_live'"),
      "cron must branch on dataSource === 'brightdata_live'");
    assert.ok(CRON_SRC.includes('selectComparables(listings,') ||
              CRON_SRC.includes('selectComparables(listings,') ||
              CRON_SRC.includes('selectComparables('),
      'cron must call selectComparables');
  });

  await test('B5F1-06: cron has brightdata_live branch calling calcBrightDataMarketStats', () => {
    assert.ok(CRON_SRC.includes('calcBrightDataMarketStats('),
      'cron must call calcBrightDataMarketStats');
  });

  // ── parseBrightDataItem metadata ──────────────────────────────────────────

  await test('B5F1-07: parseBrightDataItem preserves providerListingId', () => {
    const { listing } = parseBrightDataItem(rawItem({ property_id: 'abc-123' }), 'EUR');
    assert.ok(listing !== null, 'listing must be parsed');
    assert.strictEqual(listing.providerListingId, 'abc-123');
  });

  await test('B5F1-08: parseBrightDataItem preserves latitude / longitude', () => {
    const { listing } = parseBrightDataItem(rawItem({ lat: 43.2965, long: 5.3698 }), 'EUR');
    assert.strictEqual(listing.latitude,  43.2965);
    assert.strictEqual(listing.longitude, 5.3698);
  });

  await test('B5F1-09: parseBrightDataItem preserves guests (number)', () => {
    const { listing } = parseBrightDataItem(rawItem({ guests: 6 }), 'EUR');
    assert.strictEqual(listing.guests, 6);
  });

  await test('B5F1-10: parseBrightDataItem preserves guests (string)', () => {
    const { listing } = parseBrightDataItem(rawItem({ guests: '3' }), 'EUR');
    assert.strictEqual(listing.guests, 3);
  });

  await test('B5F1-11: parseBrightDataItem preserves category', () => {
    const { listing } = parseBrightDataItem(rawItem({ category: '  Private room in villa  ' }), 'EUR');
    assert.strictEqual(listing.category, 'Private room in villa');
  });

  await test('B5F1-12: parseBrightDataItem preserves availableDates (validated, deduped, sorted)', () => {
    const { listing } = parseBrightDataItem(rawItem({
      available_dates: ['2026-10-05', 'bad-date', '2026-10-03', '2026-10-05', '2026-10-01'],
    }), 'EUR');
    assert.deepStrictEqual(listing.availableDates, ['2026-10-01', '2026-10-03', '2026-10-05']);
  });

  // ── selectComparables: deduplication ─────────────────────────────────────

  await test('B5F1-13: selectComparables deduplicates by providerListingId (keeps first)', () => {
    const listings = [
      makeListing({ providerListingId: 'X', price: 100 }),
      makeListing({ providerListingId: 'X', price: 200 }),
      makeListing({ providerListingId: 'Y', price: 150 }),
    ];
    const { listings: out, diagnostics } = selectComparables(listings, {});
    assert.strictEqual(diagnostics.duplicateCount, 1);
    assert.strictEqual(out.length, 2);
    const prices = out.map(l => l.price);
    assert.ok(prices.includes(100), 'first occurrence kept');
    assert.ok(!prices.includes(200), 'duplicate dropped');
  });

  await test('B5F1-14: listings with null providerListingId all kept', () => {
    const listings = [
      makeListing({ providerListingId: null, price: 100 }),
      makeListing({ providerListingId: null, price: 110 }),
      makeListing({ providerListingId: null, price: 120 }),
    ];
    const { diagnostics } = selectComparables(listings, {});
    assert.strictEqual(diagnostics.duplicateCount, 0);
    assert.strictEqual(diagnostics.uniqueCount, 3);
  });

  // ── selectComparables: category filter ────────────────────────────────────

  await test('B5F1-15: category filter rejects room/hotel/hostel for entire_place target', () => {
    const toReject = ['Private room', 'Hotel room', 'Hostel bed', 'Shared room'];
    for (const cat of toReject) {
      const r = isCategoryCompatible(cat, 'entire_place');
      assert.strictEqual(r, false, `"${cat}" should be rejected for entire_place`);
    }
  });

  await test('B5F1-16: category filter accepts "Entire apartment" for entire_place target', () => {
    const r = isCategoryCompatible('Entire apartment', 'entire_place');
    assert.strictEqual(r, true);
  });

  await test('B5F1-17: category filter keeps listing with missing category (conservative)', () => {
    const r = isCategoryCompatible(null, 'entire_place');
    assert.strictEqual(r, null, 'null category → conservative keep (returns null)');
    // selectComparables treats null as "keep"
    const listings = [makeListing({ category: null })];
    const { listings: out } = selectComparables(listings, { targetPropertyType: 'entire_place' });
    assert.strictEqual(out.length, 1);
  });

  // ── selectComparables: capacity filter ────────────────────────────────────

  await test('B5F1-18: capacity filter rejects listings outside ±MIN_GUEST_DELTA', () => {
    const target = 4;
    assert.strictEqual(isCapacityCompatible(2, target), true,  '4-2=2 ≤ delta');
    assert.strictEqual(isCapacityCompatible(6, target), true,  '6-4=2 ≤ delta');
    assert.strictEqual(isCapacityCompatible(1, target), false, '4-1=3 > delta');
    assert.strictEqual(isCapacityCompatible(7, target), false, '7-4=3 > delta');
  });

  await test('B5F1-19: capacity filter keeps listing with missing guests (conservative)', () => {
    const r = isCapacityCompatible(null, 4);
    assert.strictEqual(r, null);
    const listings = [makeListing({ guests: null })];
    const { listings: out } = selectComparables(listings, { targetGuests: 4 });
    assert.strictEqual(out.length, 1);
  });

  await test('B5F1-20: capacity filter passes all when targetGuests is null', () => {
    const listings = [
      makeListing({ guests: 2 }),
      makeListing({ guests: 8 }),
      makeListing({ guests: null }),
    ];
    const { diagnostics } = selectComparables(listings, { targetGuests: null });
    assert.strictEqual(diagnostics.capacityRejectedCount, 0);
  });

  // ── selectComparables: adaptive radius ────────────────────────────────────

  await test('B5F1-21: adaptive radius selects 1km when ≥ MIN_COMPARABLES_TARGET at 1km', () => {
    // 10 listings all within 0.5 km
    const listings = Array.from({ length: 10 }, (_, i) =>
      listingAt(0.4, { providerListingId: `near-${i}` })
    );
    const { selectedRadiusKm, status } = selectComparables(listings, {
      targetLat: REF_LAT, targetLon: REF_LON,
    });
    assert.strictEqual(selectedRadiusKm, 1);
    assert.strictEqual(status, 'ok');
  });

  await test('B5F1-22: adaptive radius falls back to 2km when <8 at 1km but ≥8 at 2km', () => {
    // 3 within 0.5 km + 8 within 1.5 km
    const near  = Array.from({ length: 3 }, (_, i) => listingAt(0.4, { providerListingId: `n${i}` }));
    const farther = Array.from({ length: 8 }, (_, i) => listingAt(1.3, { providerListingId: `f${i}` }));
    const { selectedRadiusKm, status } = selectComparables([...near, ...farther], {
      targetLat: REF_LAT, targetLon: REF_LON,
    });
    assert.strictEqual(selectedRadiusKm, 2);
    assert.strictEqual(status, 'ok');
  });

  await test('B5F1-23: adaptive radius falls back to fallback band (≥5) when target not met', () => {
    // 6 listings at 4 km — below MIN_COMPARABLES_TARGET=8, above MIN_COMPARABLES_FALLBACK=5
    const listings = Array.from({ length: 6 }, (_, i) =>
      listingAt(3.5, { providerListingId: `fb-${i}` })
    );
    const { selectedRadiusKm, status } = selectComparables(listings, {
      targetLat: REF_LAT, targetLon: REF_LON,
    });
    assert.strictEqual(selectedRadiusKm, 5);
    assert.strictEqual(status, 'ok');
  });

  await test('B5F1-24: insufficient_comparables status when <5 in any radius', () => {
    // Only 3 listings anywhere
    const listings = Array.from({ length: 3 }, (_, i) =>
      listingAt(0.3, { providerListingId: `tiny-${i}` })
    );
    const { status } = selectComparables(listings, {
      targetLat: REF_LAT, targetLon: REF_LON,
    });
    assert.strictEqual(status, 'insufficient_comparables');
  });

  await test('B5F1-25: no coords → returns all qualified, selectedRadiusKm=null, status ok', () => {
    const listings = Array.from({ length: 7 }, (_, i) =>
      makeListing({ providerListingId: `nc-${i}`, price: 100 + i })
    );
    const { listings: out, selectedRadiusKm, status } = selectComparables(listings, {});
    assert.strictEqual(selectedRadiusKm, null);
    assert.strictEqual(out.length, 7);
    assert.strictEqual(status, 'ok');
  });

  // ── selectComparables: diagnostics ────────────────────────────────────────

  await test('B5F1-26: diagnostics.duplicateCount is accurate', () => {
    const listings = [
      makeListing({ providerListingId: 'A' }),
      makeListing({ providerListingId: 'A' }),
      makeListing({ providerListingId: 'A' }),
      makeListing({ providerListingId: 'B' }),
    ];
    const { diagnostics } = selectComparables(listings, {});
    assert.strictEqual(diagnostics.duplicateCount, 2);
  });

  await test('B5F1-27: diagnostics.categoryRejectedCount is accurate', () => {
    const listings = [
      makeListing({ category: 'Entire apartment' }),
      makeListing({ category: 'Private room' }),
      makeListing({ category: 'Hotel room' }),
      makeListing({ category: null }),
    ];
    const { diagnostics } = selectComparables(listings, { targetPropertyType: 'entire_place' });
    assert.strictEqual(diagnostics.categoryRejectedCount, 2);
    assert.strictEqual(diagnostics.categoryMissingCount, 1);
  });

  // ── calcBrightDataMarketStats: median ─────────────────────────────────────

  await test('B5F1-28: standard median — even n averages two middles', () => {
    // Sorted: [100,110,120,130,140,150] — mid=3 → (120+130)/2 = 125
    const listings = [100, 110, 120, 130, 140, 150].map(p => makeListing({ price: p }));
    const stats = calcBrightDataMarketStats(listings);
    assert.strictEqual(stats.median, 125);
  });

  await test('B5F1-29: standard median — odd n returns middle value', () => {
    // Sorted: [100,110,120,130,140] — mid=2 → 120
    const listings = [100, 110, 120, 130, 140].map(p => makeListing({ price: p }));
    const stats = calcBrightDataMarketStats(listings);
    assert.strictEqual(stats.median, 120);
  });

  await test('B5F1-30: standard median differs from floor(n/2) for even-n array', () => {
    // [100,110,120,130] — standard=(110+120)/2=115, floor(4/2)=sorted[2]=120
    const sorted = [100, 110, 120, 130];
    const listings = sorted.map(p => makeListing({ price: p }));
    const stats = calcBrightDataMarketStats(listings);
    const floorMedian = sorted[Math.floor(sorted.length / 2)];  // 120
    assert.notStrictEqual(stats.median, floorMedian,
      `standard median (${stats.median}) must differ from floor(n/2) median (${floorMedian})`);
    assert.strictEqual(stats.median, 115);
  });

  // ── calcBrightDataMarketStats: p25/p75 ────────────────────────────────────

  await test('B5F1-31: p25 and p75 computed with floor formula', () => {
    // [100,110,120,130,140,150,160,170] n=8
    // p25 = sorted[floor(8*0.25)] = sorted[2] = 120
    // p75 = sorted[floor(8*0.75)] = sorted[6] = 160
    const prices = [100, 110, 120, 130, 140, 150, 160, 170];
    const listings = prices.map(p => makeListing({ price: p }));
    const stats = calcBrightDataMarketStats(listings);
    assert.strictEqual(stats.p25, 120);
    assert.strictEqual(stats.p75, 160);
  });

  // ── calcBrightDataMarketStats: calendar proxy ─────────────────────────────

  await test('B5F1-32: calendar unavailability proxy calculated correctly', () => {
    // Window = 60 days from today
    const today = '2026-10-01';
    const windowEnd = addDaysToDate(today, 60); // '2026-11-30'
    // Build 6 listings, each with 30 available dates in the window → unavail = 30/60 = 0.5
    const availDates = Array.from({ length: 30 }, (_, i) =>
      addDaysToDate(today, i)
    );
    const listings = Array.from({ length: 6 }, () =>
      makeListing({ availableDates: availDates })
    );
    const stats = calcBrightDataMarketStats(listings, { today, calendarWindow: 60 });
    // All 6 have unavail=0.5, median=0.5, occupancy=50%
    assert.strictEqual(stats.occupancy, 50);
  });

  await test('B5F1-33: occupancy_semantics=calendar_unavailability_proxy when ≥5 calendars', () => {
    const today = '2026-10-01';
    const availDates = Array.from({ length: 20 }, (_, i) => addDaysToDate(today, i));
    const listings = Array.from({ length: 6 }, () => makeListing({ availableDates: availDates }));
    const stats = calcBrightDataMarketStats(listings, { today });
    assert.strictEqual(stats.occupancy_semantics, 'calendar_unavailability_proxy');
  });

  await test('B5F1-34: occupancy_semantics=insufficient_calendars when <5 calendars', () => {
    const today = '2026-10-01';
    const availDates = Array.from({ length: 20 }, (_, i) => addDaysToDate(today, i));
    // 4 with calendars (below MIN_CALENDAR_COMPARABLES=5), 4 without
    const withCal    = Array.from({ length: 4 }, () => makeListing({ availableDates: availDates }));
    const withoutCal = Array.from({ length: 4 }, () => makeListing({ availableDates: null }));
    const stats = calcBrightDataMarketStats([...withCal, ...withoutCal], { today });
    assert.strictEqual(stats.occupancy_semantics, 'insufficient_calendars');
    assert.strictEqual(stats.occupancy, 0);
  });

  await test('B5F1-35: listings without availableDates excluded from proxy', () => {
    const today = '2026-10-01';
    // 5 listings with full calendar (all 60 days available → unavail=0%)
    // 5 listings with no calendar — must be excluded
    const full = Array.from({ length: 60 }, (_, i) => addDaysToDate(today, i));
    const withCal    = Array.from({ length: 5 }, () => makeListing({ availableDates: full }));
    const withoutCal = Array.from({ length: 5 }, () => makeListing({ availableDates: null }));
    const stats = calcBrightDataMarketStats([...withCal, ...withoutCal], { today, calendarWindow: 60 });
    assert.strictEqual(stats.occupancy, 0, 'all available → 0% unavailability');
    assert.strictEqual(stats.occupancy_semantics, 'calendar_unavailability_proxy');
  });

  // ── calcBrightDataMarketStats: tensionLevel ───────────────────────────────

  await test('B5F1-36: tensionLevel derived from occupancy correctly', () => {
    const today = '2026-10-01';
    // Make occupancy high via calendar: listing with 0 available dates → 100% unavail
    const listings = Array.from({ length: 6 }, () =>
      makeListing({ price: 100, availableDates: [] })
    );
    const stats = calcBrightDataMarketStats(listings, { today });
    assert.strictEqual(stats.occupancy, 100);
    assert.strictEqual(stats.tensionLevel, 'high');
  });

  // ── Cron query columns ────────────────────────────────────────────────────

  await test('B5F1-37: cron job query includes p.max_guests and p.timezone', () => {
    // The runDynamicPricingJob SELECT should fetch max_guests and timezone
    assert.ok(CRON_SRC.includes('p.max_guests'),
      'runDynamicPricingJob query must select p.max_guests');
    assert.ok(CRON_SRC.includes('p.timezone'),
      'runDynamicPricingJob query must select p.timezone');
  });

  await test('B5F1-38: cron one-property query includes p.max_guests and p.timezone', () => {
    // runDynamicPricingForOneProperty's SELECT must include both columns
    // Check they appear in the vicinity of pricing_config / properties join
    const onePropertySection = CRON_SRC.slice(
      CRON_SRC.indexOf('runDynamicPricingForOneProperty'),
      CRON_SRC.indexOf('runDynamicPricingForOneProperty') + 800
    );
    assert.ok(onePropertySection.includes('p.max_guests'),
      'runDynamicPricingForOneProperty query must select p.max_guests');
    assert.ok(onePropertySection.includes('p.timezone'),
      'runDynamicPricingForOneProperty query must select p.timezone');
  });

  await test('B5F1-39: MARKET_PRIMARY_PROVIDER not changed in cron source', () => {
    // Must not assign to MARKET_PRIMARY_PROVIDER
    assert.ok(!CRON_SRC.includes('MARKET_PRIMARY_PROVIDER ='),
      'cron must not assign MARKET_PRIMARY_PROVIDER');
    assert.ok(!CRON_SRC.includes("process.env['MARKET_PRIMARY_PROVIDER']"),
      'cron must not set MARKET_PRIMARY_PROVIDER via env');
  });

  // ── Phase 13 fix ──────────────────────────────────────────────────────────

  await test('B5F1-40: Phase 13 audit tool printScenario uses s.label not call-site label', () => {
    // The bug: label.includes('30d') — bare call-site param, not scenario's own label
    // The fix:  s.label.includes('30d') — scenario's label
    // Use regex lookbehind to detect the unqualified form (not preceded by a word char + '.')
    const badPattern = /(?<![.\w])label\.includes\('30d'\)/;
    assert.ok(!badPattern.test(AUDIT_SRC),
      'audit tool must NOT use bare label.includes("30d") without s. prefix');
    assert.ok(AUDIT_SRC.includes("s.label.includes('30d')"),
      'audit tool MUST use s.label.includes("30d")');
  });

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\n  Failures:');
    for (const f of failures) console.log(`    ❌  ${f.name}: ${f.message}`);
  }
  console.log('══════════════════════════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
})();
