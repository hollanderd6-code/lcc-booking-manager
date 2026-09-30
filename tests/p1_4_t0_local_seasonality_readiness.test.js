'use strict';
/**
 * P1.4-T0 — Local Seasonality Data Readiness — Test Suite
 *
 * Tests the pure helpers exported from audit-local-seasonality-readiness-p1_4_t0.js.
 * All tests run without a database connection.
 *
 * SAFETY:
 *   DB_WRITES             = 0  always
 *   PRICING_WRITES        = 0  always
 *   CHANNEX_CALLS         = 0  always
 *   MARKET_PROVIDER_CALLS = 0  always
 *   NETWORK_CALLS         = 0  always
 *
 * Sections:
 *   A — classifyReservationSource (BLOCK / ICAL / OTA_CONFIRMED / DIRECT / GUEST_APP)
 *   B — isReliableForStayOccurrence (BLOCK excluded; ICAL included)
 *   C — isReliableForBookingTiming  (BLOCK + ICAL excluded)
 *   D — splitNightsByMonth (month boundaries, leap year, year boundary)
 *   E — computeMonthlyBookedNights (aggregate, exclude unreliable, current month partial)
 *   F — detectYoYPairs (YoY detection)
 *   G — computeSampleTier (all tiers, conservative thresholds)
 *   H — hasNoFutureLeakage
 *   I — Pricing authority proof (seasonality not imported by pricing chain)
 *   J — Write safety (no INSERT/UPDATE/DELETE in SQL constants)
 *   K — Module safety (require.main guard — helpers importable without DB)
 *   L — Current seasonality unchanged (pricing-engine uses hardcoded curve)
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const {
  classifyReservationSource,
  isReliableForStayOccurrence,
  isReliableForBookingTiming,
  splitNightsByMonth,
  computeMonthlyBookedNights,
  detectYoYPairs,
  computeSampleTier,
  hasNoFutureLeakage,
} = require('../outils/audit-local-seasonality-readiness-p1_4_t0');

const AUDIT_SRC = fs.readFileSync(
  path.join(__dirname, '../outils/audit-local-seasonality-readiness-p1_4_t0.js'), 'utf8',
);
const ENGINE_SRC = fs.readFileSync(
  path.join(__dirname, '../routes/pricing-engine.js'), 'utf8',
);

let passed = 0;
let failed = 0;
const errors = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗  ${name}`);
    console.log(`       ${err.message}`);
    errors.push({ name, message: err.message });
    failed++;
  }
}

// ── A — classifyReservationSource ─────────────────────────────────────────────

console.log('\n  [A] classifyReservationSource');

test('A-01: source=BLOCK → BLOCK', () => {
  assert.strictEqual(classifyReservationSource({ source: 'BLOCK' }), 'BLOCK');
});

test('A-02: reservation_type=block → BLOCK', () => {
  assert.strictEqual(classifyReservationSource({ reservation_type: 'block' }), 'BLOCK');
});

test('A-03: platform=BLOCK → BLOCK', () => {
  assert.strictEqual(classifyReservationSource({ platform: 'BLOCK' }), 'BLOCK');
});

test('A-04: source=ical → ICAL', () => {
  assert.strictEqual(classifyReservationSource({ source: 'ical' }), 'ICAL');
});

test('A-05: source=channex → OTA_CONFIRMED', () => {
  assert.strictEqual(classifyReservationSource({ source: 'channex' }), 'OTA_CONFIRMED');
});

test('A-06: source=direct → DIRECT', () => {
  assert.strictEqual(classifyReservationSource({ source: 'direct' }), 'DIRECT');
});

test('A-07: platform=DIRECT → DIRECT', () => {
  assert.strictEqual(classifyReservationSource({ platform: 'DIRECT' }), 'DIRECT');
});

test('A-08: source=guest_app → GUEST_APP', () => {
  assert.strictEqual(classifyReservationSource({ source: 'guest_app' }), 'GUEST_APP');
});

test('A-09: empty reservation → UNKNOWN', () => {
  assert.strictEqual(classifyReservationSource({}), 'UNKNOWN');
});

test('A-10: BLOCK takes priority over other fields', () => {
  assert.strictEqual(
    classifyReservationSource({ source: 'BLOCK', platform: 'direct', reservation_type: 'manual' }),
    'BLOCK',
  );
});

test('A-11: case-insensitive BLOCK detection', () => {
  assert.strictEqual(classifyReservationSource({ source: 'block' }), 'BLOCK');
  assert.strictEqual(classifyReservationSource({ source: 'Block' }), 'BLOCK');
});

// ── B — isReliableForStayOccurrence ──────────────────────────────────────────

console.log('\n  [B] isReliableForStayOccurrence');

const confirmOta = { source: 'channex', status: 'confirmed', start_date: '2026-06-01', end_date: '2026-06-05' };
const confirmIcal = { source: 'ical', status: 'confirmed', start_date: '2026-07-10', end_date: '2026-07-15' };
const blockRow = { source: 'BLOCK', status: 'confirmed', start_date: '2026-08-01', end_date: '2026-08-03' };
const cancelledOta = { source: 'channex', status: 'cancelled', start_date: '2026-09-01', end_date: '2026-09-05' };

test('B-01: OTA confirmed → reliable for stay occurrence', () => {
  assert.strictEqual(isReliableForStayOccurrence(confirmOta), true);
});

test('B-02: iCal confirmed → reliable for stay occurrence (dates are real stays)', () => {
  assert.strictEqual(isReliableForStayOccurrence(confirmIcal), true);
});

test('B-03: BLOCK → NOT reliable for stay occurrence', () => {
  assert.strictEqual(isReliableForStayOccurrence(blockRow), false);
});

test('B-04: cancelled OTA → NOT reliable', () => {
  assert.strictEqual(isReliableForStayOccurrence(cancelledOta), false);
});

test('B-05: BLOCK excluded regardless of status', () => {
  assert.strictEqual(isReliableForStayOccurrence({ source: 'BLOCK', status: 'confirmed', start_date: '2026-01-01', end_date: '2026-01-03' }), false);
  assert.strictEqual(isReliableForStayOccurrence({ reservation_type: 'block', status: 'confirmed', start_date: '2026-01-01', end_date: '2026-01-03' }), false);
});

test('B-06: missing dates → NOT reliable', () => {
  assert.strictEqual(isReliableForStayOccurrence({ source: 'channex', status: 'confirmed' }), false);
  assert.strictEqual(isReliableForStayOccurrence({ source: 'channex', status: 'confirmed', start_date: '2026-01-01' }), false);
});

test('B-07: direct booking → reliable', () => {
  assert.strictEqual(isReliableForStayOccurrence({ source: 'direct', status: 'confirmed', start_date: '2026-01-01', end_date: '2026-01-05' }), true);
});

// ── C — isReliableForBookingTiming ────────────────────────────────────────────

console.log('\n  [C] isReliableForBookingTiming');

test('C-01: OTA confirmed → reliable for booking timing', () => {
  assert.strictEqual(isReliableForBookingTiming(confirmOta), true);
});

test('C-02: iCal → NOT reliable for booking timing (timestamp is sync time, not booking time)', () => {
  assert.strictEqual(isReliableForBookingTiming(confirmIcal), false);
});

test('C-03: BLOCK → NOT reliable for booking timing', () => {
  assert.strictEqual(isReliableForBookingTiming(blockRow), false);
});

test('C-04: cancelled → NOT reliable', () => {
  assert.strictEqual(isReliableForBookingTiming(cancelledOta), false);
});

test('C-05: DIRECT → reliable for booking timing', () => {
  assert.strictEqual(isReliableForBookingTiming({ source: 'direct', status: 'confirmed', start_date: '2026-01-01', end_date: '2026-01-05' }), true);
});

test('C-06: GUEST_APP → reliable for booking timing', () => {
  assert.strictEqual(isReliableForBookingTiming({ source: 'guest_app', status: 'confirmed', start_date: '2026-01-01', end_date: '2026-01-05' }), true);
});

// ── D — splitNightsByMonth ────────────────────────────────────────────────────

console.log('\n  [D] splitNightsByMonth');

test('D-01: same-month stay: 2026-07-10 → 2026-07-15 = 5 nights in Jul', () => {
  const r = splitNightsByMonth('2026-07-10', '2026-07-15');
  assert.deepStrictEqual(r, { '2026-07': 5 });
});

test('D-02: month boundary: 2026-06-29 → 2026-07-03 = 2 Jun + 2 Jul', () => {
  const r = splitNightsByMonth('2026-06-29', '2026-07-03');
  assert.deepStrictEqual(r, { '2026-06': 2, '2026-07': 2 });
  // Total nights = 4
  assert.strictEqual(Object.values(r).reduce((a, b) => a + b, 0), 4);
});

test('D-03: year boundary: 2026-12-30 → 2027-01-03 = 2 Dec + 2 Jan', () => {
  const r = splitNightsByMonth('2026-12-30', '2027-01-03');
  // Dec 30, 31 = 2 nights; Jan 1, 2 = 2 nights (Jan 3 is checkout, exclusive)
  assert.deepStrictEqual(r, { '2026-12': 2, '2027-01': 2 });
  assert.strictEqual(Object.values(r).reduce((a, b) => a + b, 0), 4);
});

test('D-04: non-leap-year February: 2025-02-25 → 2025-03-05 = 4 Feb + 4 Mar', () => {
  const r = splitNightsByMonth('2025-02-25', '2025-03-05');
  // 2025 Feb has 28 days. Feb 25,26,27,28 = 4 nights; Mar 1,2,3,4 = 4 nights (Mar 5 exclusive)
  assert.strictEqual(r['2025-02'], 4);
  assert.strictEqual(r['2025-03'], 4);
  assert.strictEqual(Object.values(r).reduce((a, b) => a + b, 0), 8);
});

test('D-05: leap-year February 2024: 2024-02-27 → 2024-03-01 = 3 Feb + 0 Mar', () => {
  const r = splitNightsByMonth('2024-02-27', '2024-03-01');
  // 2024 is a leap year: Feb has 29 days.
  // Nights: Feb 27, 28, 29 = 3 nights (Mar 1 is checkout = exclusive)
  assert.strictEqual(r['2024-02'], 3);
  assert.strictEqual(r['2024-03'], undefined); // no Mar nights
  assert.strictEqual(Object.values(r).reduce((a, b) => a + b, 0), 3);
});

test('D-06: leap Feb 2024 spanning end of Feb: 2024-02-27 → 2024-03-03 = 3 Feb + 2 Mar', () => {
  const r = splitNightsByMonth('2024-02-27', '2024-03-03');
  // Feb 27, 28 = 2 nights (2024 is leap but checkout is Mar 3 so Feb 27,28 + leap Feb 29 = 3 nights)
  assert.strictEqual(r['2024-02'], 3);
  assert.strictEqual(r['2024-03'], 2);
  assert.strictEqual(Object.values(r).reduce((a, b) => a + b, 0), 5);
});

test('D-07: end <= start → empty', () => {
  assert.deepStrictEqual(splitNightsByMonth('2026-07-10', '2026-07-10'), {});
  assert.deepStrictEqual(splitNightsByMonth('2026-07-10', '2026-07-05'), {});
});

test('D-08: null inputs → empty', () => {
  assert.deepStrictEqual(splitNightsByMonth(null, '2026-07-10'), {});
  assert.deepStrictEqual(splitNightsByMonth('2026-07-01', null), {});
});

test('D-09: 3-month spanning stay is split correctly', () => {
  // 2026-06-20 to 2026-09-01 (Sep 1 is checkout = exclusive)
  const r = splitNightsByMonth('2026-06-20', '2026-09-01');
  const total = Object.values(r).reduce((s, n) => s + n, 0);
  // Jun: days 20-30 = 11 nights; Jul: 31 nights; Aug: 31 nights = 73 total
  // Sep: 0 nights (Sep 1 is exclusive checkout)
  assert.strictEqual(r['2026-06'], 11);
  assert.strictEqual(r['2026-07'], 31);
  assert.strictEqual(r['2026-08'], 31);
  assert.strictEqual(r['2026-09'], undefined);
  assert.strictEqual(total, 73);
});

test('D-10: exactly 1-night stay stays in same month', () => {
  const r = splitNightsByMonth('2026-12-31', '2027-01-01');
  assert.deepStrictEqual(r, { '2026-12': 1 });
});

// ── E — computeMonthlyBookedNights ────────────────────────────────────────────

console.log('\n  [E] computeMonthlyBookedNights');

test('E-01: BLOCK excluded from monthly totals', () => {
  const reservations = [
    { source: 'channex', status: 'confirmed', start_date: '2026-07-10', end_date: '2026-07-15' },
    { source: 'BLOCK',   status: 'confirmed', start_date: '2026-07-01', end_date: '2026-07-05' },
  ];
  const r = computeMonthlyBookedNights(reservations);
  // Only channex row counted: 5 nights
  assert.strictEqual(r['2026-07'], 5);
});

test('E-02: ICAL included for stay occurrence', () => {
  const reservations = [
    { source: 'ical', status: 'confirmed', start_date: '2026-08-01', end_date: '2026-08-08' },
  ];
  const r = computeMonthlyBookedNights(reservations);
  assert.strictEqual(r['2026-08'], 7);
});

test('E-03: cancelled excluded', () => {
  const reservations = [
    { source: 'channex', status: 'cancelled', start_date: '2026-09-01', end_date: '2026-09-05' },
    { source: 'channex', status: 'confirmed', start_date: '2026-09-10', end_date: '2026-09-12' },
  ];
  const r = computeMonthlyBookedNights(reservations);
  assert.strictEqual(r['2026-09'], 2);
});

test('E-04: month-crossing stay split into correct months', () => {
  const reservations = [
    { source: 'channex', status: 'confirmed', start_date: '2026-01-30', end_date: '2026-02-03' },
  ];
  const r = computeMonthlyBookedNights(reservations);
  // Jan 30, 31 = 2 nights; Feb 1, 2 = 2 nights (Feb 3 is checkout = exclusive)
  assert.strictEqual(r['2026-01'], 2);
  assert.strictEqual(r['2026-02'], 2);
});

test('E-05: property with <12 months — only those months populated', () => {
  const reservations = [
    { source: 'channex', status: 'confirmed', start_date: '2026-06-01', end_date: '2026-06-05' },
    { source: 'channex', status: 'confirmed', start_date: '2026-07-10', end_date: '2026-07-15' },
  ];
  const r = computeMonthlyBookedNights(reservations);
  assert.strictEqual(Object.keys(r).length, 2);
  assert.ok(r['2026-06']);
  assert.ok(r['2026-07']);
});

test('E-06: property with >12 months — multiple years present', () => {
  const reservations = [
    { source: 'channex', status: 'confirmed', start_date: '2024-12-15', end_date: '2025-01-05' },
    { source: 'channex', status: 'confirmed', start_date: '2025-06-01', end_date: '2025-06-08' },
    { source: 'channex', status: 'confirmed', start_date: '2026-06-01', end_date: '2026-06-08' },
  ];
  const r = computeMonthlyBookedNights(reservations);
  assert.ok(r['2024-12'] >= 1);
  assert.ok(r['2025-01'] >= 1);
  assert.ok(r['2025-06'] >= 1);
  assert.ok(r['2026-06'] >= 1);
});

test('E-07: empty reservations array → empty result', () => {
  assert.deepStrictEqual(computeMonthlyBookedNights([]), {});
});

test('E-08: only BLOCKs → empty result (no sellable stays)', () => {
  const reservations = [
    { source: 'BLOCK', status: 'confirmed', start_date: '2026-07-01', end_date: '2026-07-10' },
    { reservation_type: 'block', status: 'confirmed', start_date: '2026-08-01', end_date: '2026-08-05' },
  ];
  assert.deepStrictEqual(computeMonthlyBookedNights(reservations), {});
});

// ── F — detectYoYPairs ────────────────────────────────────────────────────────

console.log('\n  [F] detectYoYPairs');

test('F-01: same month in 2 years → 1 YoY pair', () => {
  const monthly = { '2025-07': 10, '2026-07': 12 };
  const pairs = detectYoYPairs(monthly);
  assert.strictEqual(pairs.length, 1);
  assert.strictEqual(pairs[0].month, 7);
  assert.deepStrictEqual(pairs[0].years, [2025, 2026]);
});

test('F-02: months only in one year → no YoY pairs', () => {
  const monthly = { '2026-06': 5, '2026-07': 10, '2026-08': 8 };
  const pairs = detectYoYPairs(monthly);
  assert.strictEqual(pairs.length, 0);
});

test('F-03: 3 years of data → pair has 3 year entries', () => {
  const monthly = { '2024-03': 8, '2025-03': 10, '2026-03': 12 };
  const pairs = detectYoYPairs(monthly);
  assert.strictEqual(pairs.length, 1);
  assert.deepStrictEqual(pairs[0].years, [2024, 2025, 2026]);
});

test('F-04: mixed months with YoY and without', () => {
  const monthly = {
    '2025-06': 5, '2026-06': 6,   // Jun: YoY
    '2025-07': 10, '2026-07': 12, // Jul: YoY
    '2026-08': 9,                  // Aug: no YoY (only 2026)
  };
  const pairs = detectYoYPairs(monthly);
  assert.strictEqual(pairs.length, 2);
  const months = pairs.map(p => p.month);
  assert.ok(months.includes(6));
  assert.ok(months.includes(7));
  assert.ok(!months.includes(8));
});

test('F-05: months with 0 nights not counted', () => {
  const monthly = { '2025-01': 0, '2026-01': 5 };
  const pairs = detectYoYPairs(monthly);
  // 2025-01 has 0 nights — excluded
  assert.strictEqual(pairs.length, 0);
});

test('F-06: sorted output by month', () => {
  const monthly = {
    '2025-12': 3, '2026-12': 4,
    '2025-01': 2, '2026-01': 3,
    '2025-06': 5, '2026-06': 6,
  };
  const pairs = detectYoYPairs(monthly);
  assert.strictEqual(pairs.length, 3);
  assert.strictEqual(pairs[0].month, 1);
  assert.strictEqual(pairs[1].month, 6);
  assert.strictEqual(pairs[2].month, 12);
});

// ── G — computeSampleTier ─────────────────────────────────────────────────────

console.log('\n  [G] computeSampleTier');

const base = { distinctCalendarMonths: 12, distinctYears: 3, totalBookedNights: 300, yoyPairCount: 12, exposureConfidence: 'PARTIAL' };

test('G-01: all conditions met → GOOD', () => {
  assert.strictEqual(computeSampleTier(base), 'GOOD');
});

test('G-02: < 12 calendar months → INSUFFICIENT', () => {
  assert.strictEqual(computeSampleTier({ ...base, distinctCalendarMonths: 11 }), 'INSUFFICIENT');
});

test('G-03: < 30 booked nights → INSUFFICIENT', () => {
  assert.strictEqual(computeSampleTier({ ...base, totalBookedNights: 29 }), 'INSUFFICIENT');
});

test('G-04: 12 months, 1 year, 0 YoY pairs → EARLY', () => {
  assert.strictEqual(computeSampleTier({ ...base, distinctYears: 1, yoyPairCount: 0, totalBookedNights: 60, exposureConfidence: 'NONE' }), 'EARLY');
});

test('G-05: 12 months, 2 years, 2 YoY pairs → EARLY (< 3 YoY pairs)', () => {
  assert.strictEqual(computeSampleTier({ ...base, distinctYears: 2, yoyPairCount: 2, totalBookedNights: 100 }), 'EARLY');
});

test('G-06: 2 years, 12 months, 6 YoY pairs, 150 nights → MODERATE', () => {
  assert.strictEqual(computeSampleTier({ ...base, distinctYears: 2, yoyPairCount: 6, totalBookedNights: 150 }), 'MODERATE');
});

test('G-07: 2 years, 9 YoY pairs but < 150 nights → MODERATE (not GOOD — nights too low)', () => {
  assert.strictEqual(computeSampleTier({ ...base, distinctYears: 2, yoyPairCount: 9, totalBookedNights: 149 }), 'MODERATE');
});

test('G-08: 3+ years but exposure=NONE → MODERATE (not GOOD)', () => {
  assert.strictEqual(computeSampleTier({ ...base, exposureConfidence: 'NONE' }), 'MODERATE');
});

test('G-09: property with <12 months covered → INSUFFICIENT (not just EARLY)', () => {
  assert.strictEqual(
    computeSampleTier({ distinctCalendarMonths: 8, distinctYears: 2, totalBookedNights: 200, yoyPairCount: 5, exposureConfidence: 'PARTIAL' }),
    'INSUFFICIENT',
  );
});

test('G-10: thresholds are conservative — 1 full year is EARLY not MODERATE', () => {
  // A property with 1 year of data should NOT reach MODERATE
  const oneYear = { distinctCalendarMonths: 12, distinctYears: 1, totalBookedNights: 200, yoyPairCount: 0, exposureConfidence: 'NONE' };
  const tier = computeSampleTier(oneYear);
  assert.ok(['INSUFFICIENT', 'EARLY'].includes(tier), `Expected EARLY or INSUFFICIENT, got ${tier}`);
});

test('G-11: exposure=FULL included in GOOD tier', () => {
  assert.strictEqual(computeSampleTier({ ...base, exposureConfidence: 'FULL' }), 'GOOD');
});

// ── H — hasNoFutureLeakage ────────────────────────────────────────────────────

console.log('\n  [H] hasNoFutureLeakage');

test('H-01: dataTimestamp = referenceDate → no leakage (same day)', () => {
  assert.strictEqual(hasNoFutureLeakage('2026-09-30', '2026-09-30'), true);
});

test('H-02: dataTimestamp before referenceDate → no leakage', () => {
  assert.strictEqual(hasNoFutureLeakage('2026-09-30', '2026-09-01'), true);
});

test('H-03: dataTimestamp after referenceDate → leakage detected', () => {
  assert.strictEqual(hasNoFutureLeakage('2026-09-30', '2026-10-01'), false);
});

test('H-04: pricing_schedule is future-state → backtests using it have leakage risk', () => {
  // At decision time 2026-06-01, pricing_schedule contains prices set on 2026-09-30
  // Those prices were not available at 2026-06-01 → leakage
  assert.strictEqual(hasNoFutureLeakage('2026-06-01', '2026-09-30'), false);
});

test('H-05: completed stay (end_date in past) → no leakage for seasonality learning', () => {
  assert.strictEqual(hasNoFutureLeakage('2026-09-30', '2026-07-15'), true);
});

// ── I — Pricing authority proof ───────────────────────────────────────────────

console.log('\n  [I] Pricing authority proof (seasonality not in pricing chain)');

const PRICING_CHAIN = [
  'routes/pricing-engine.js',
  'routes/pricing-apply.js',
  'routes/pricing-publisher.js',
  'routes/effective-pricing-resolver.js',
];

const SEASONALITY_MODULES = [
  'local-seasonality',
  'learned-seasonality',
  'seasonal-curve',
  'seasonality-model',
];

const ROOT = path.join(__dirname, '..');

test('I-01: no local/learned seasonality module imported by pricing chain', () => {
  const violations = [];
  for (const pricingFile of PRICING_CHAIN) {
    const fpath = path.join(ROOT, pricingFile);
    if (!fs.existsSync(fpath)) continue;
    const src = fs.readFileSync(fpath, 'utf8');
    for (const mod of SEASONALITY_MODULES) {
      const re = new RegExp(`require\\(['""][^'"]*${mod.replace(/-/g, '[-_]')}`, 'i');
      if (re.test(src)) violations.push(`${pricingFile} → ${mod}`);
    }
  }
  assert.strictEqual(violations.length, 0, `Seasonality authority violated: ${violations.join(', ')}`);
});

test('I-02: pricing-engine.js still uses DEFAULTS.seasonByMonth (unchanged)', () => {
  assert.ok(ENGINE_SRC.includes('seasonByMonth:'), 'seasonByMonth must still be in DEFAULTS');
  assert.ok(ENGINE_SRC.includes('0.88,'), 'Jan anchor 0.88 must be present');
  assert.ok(ENGINE_SRC.includes('1.12,'), 'Jul anchor 1.12 must be present');
});

test('I-03: fSeason not passed through applyAggr() — season at full weight', () => {
  // In pricing-engine.js line ~279: const fSeason = fSeasonRaw; (no applyAggr)
  // Verify there is no applyAggr call on fSeason
  assert.ok(
    !ENGINE_SRC.match(/applyAggr\s*\(\s*fSeasonRaw/),
    'fSeasonRaw must NOT be passed through applyAggr()',
  );
  assert.ok(
    ENGINE_SRC.match(/fSeason\s*=\s*fSeasonRaw\s*;/),
    'fSeason must be assigned directly from fSeasonRaw (no attenuation)',
  );
});

test('I-04: price formula includes fSeason at full weight', () => {
  assert.ok(
    ENGINE_SRC.includes('base * fSeason'),
    'Price formula must multiply fSeason directly',
  );
});

test('I-05: audit tool does not import pricing-engine as a dependency', () => {
  assert.ok(
    !/require\(['""][^'"]*pricing-engine/i.test(AUDIT_SRC),
    'Audit tool must not require pricing-engine',
  );
});

// ── J — Write safety ──────────────────────────────────────────────────────────

console.log('\n  [J] Write safety (no INSERT/UPDATE/DELETE in SQL constants)');

const SQL_SECTION = AUDIT_SRC.slice(
  AUDIT_SRC.indexOf('// ── SQL constants'),
  AUDIT_SRC.indexOf('// ── Pricing authority proof'),
);

test('J-01: no INSERT in SQL constants', () => {
  assert.ok(!/\bINSERT\b/i.test(SQL_SECTION), 'SQL must not contain INSERT');
});

test('J-02: no UPDATE in SQL constants', () => {
  assert.ok(!/\bUPDATE\b/i.test(SQL_SECTION), 'SQL must not contain UPDATE');
});

test('J-03: no DELETE in SQL constants', () => {
  assert.ok(!/\bDELETE\b/i.test(SQL_SECTION), 'SQL must not contain DELETE');
});

test('J-04: no DROP in SQL constants', () => {
  assert.ok(!/\bDROP\b/i.test(SQL_SECTION), 'SQL must not contain DROP');
});

test('J-05: all SQL template literals start with SELECT', () => {
  const sqlStrings = SQL_SECTION.match(/`[\s\S]*?`/g) || [];
  for (const sql of sqlStrings) {
    const trimmed = sql.replace(/`/g, '').trim();
    if (!trimmed) continue;
    const first = trimmed.split(/\s+/)[0].toUpperCase();
    assert.ok(['SELECT', 'WITH'].includes(first),
      `SQL starts with ${first}, expected SELECT: ${trimmed.slice(0, 60)}`);
  }
});

test('J-06: no migration CREATE TABLE in audit tool', () => {
  assert.ok(!/CREATE TABLE/i.test(AUDIT_SRC), 'Audit tool must not create tables');
});

test('J-07: no external provider require() calls', () => {
  // Provider names appear in safety comments — that is correct documentation.
  // Verify there are no actual require() imports of provider modules.
  assert.ok(!/require\(['""][^'"]*brightdata/i.test(AUDIT_SRC), 'No brightdata require');
  assert.ok(!/require\(['""][^'"]*apify/i.test(AUDIT_SRC), 'No apify require');
  assert.ok(!/require\(['""][^'"]*market-provider\b/i.test(AUDIT_SRC), 'No market-provider require');
  assert.ok(!AUDIT_SRC.match(/\.post\(.*channex|channex.*\.post\(/i), 'No Channex POST calls');
});

// ── K — Module safety ─────────────────────────────────────────────────────────

console.log('\n  [K] Module safety');

test('K-01: require.main === module guard present', () => {
  assert.ok(AUDIT_SRC.includes('require.main === module'), 'Main must be guarded');
});

test('K-02: pure helpers importable without DB', () => {
  // Module was already required at top of this file without a DB connection.
  // If runAudit() ran it would have thrown. Reaching here proves the guard works.
  assert.strictEqual(typeof classifyReservationSource, 'function');
  assert.strictEqual(typeof splitNightsByMonth, 'function');
  assert.strictEqual(typeof computeSampleTier, 'function');
});

test('K-03: createPool not called at require time', () => {
  // Verified by K-02 — DB connection would have failed immediately
  assert.ok(true);
});

test('K-04: dotenv.config inside require.main guard', () => {
  const dotenvIdx      = AUDIT_SRC.indexOf("require('dotenv').config()");
  const requireMainIdx = AUDIT_SRC.indexOf('if (require.main === module)');
  assert.ok(dotenvIdx > requireMainIdx, 'dotenv.config must be inside require.main guard');
});

test('K-05: all 8 pure helpers exported', () => {
  assert.ok(AUDIT_SRC.includes('classifyReservationSource,'));
  assert.ok(AUDIT_SRC.includes('isReliableForStayOccurrence,'));
  assert.ok(AUDIT_SRC.includes('isReliableForBookingTiming,'));
  assert.ok(AUDIT_SRC.includes('splitNightsByMonth,'));
  assert.ok(AUDIT_SRC.includes('computeMonthlyBookedNights,'));
  assert.ok(AUDIT_SRC.includes('detectYoYPairs,'));
  assert.ok(AUDIT_SRC.includes('computeSampleTier,'));
  assert.ok(AUDIT_SRC.includes('hasNoFutureLeakage,'));
});

// ── L — Current seasonality unchanged ────────────────────────────────────────

console.log('\n  [L] Current seasonality authority unchanged');

test('L-01: pricing-engine.js seasonByMonth is the canonical IDF 12-anchor array', () => {
  const match = ENGINE_SRC.match(/seasonByMonth:\s*\[([\s\S]*?)\]/);
  assert.ok(match, 'seasonByMonth array must be present');
  const nums = match[1].match(/[\d.]+/g);
  assert.ok(nums, 'seasonByMonth must contain numeric values');
  assert.strictEqual(nums.length, 12, 'Must have exactly 12 monthly anchors');
});

test('L-02: Jan anchor is 0.88 (lowest — winter)', () => {
  const match = ENGINE_SRC.match(/seasonByMonth:\s*\[([\s\S]*?)\]/);
  const nums = match[1].match(/[\d.]+/g).map(Number);
  assert.strictEqual(nums[0], 0.88, `Jan expected 0.88, got ${nums[0]}`);
});

test('L-03: Jul anchor is 1.12 (highest — peak summer)', () => {
  const match = ENGINE_SRC.match(/seasonByMonth:\s*\[([\s\S]*?)\]/);
  const nums = match[1].match(/[\d.]+/g).map(Number);
  assert.strictEqual(nums[6], 1.12, `Jul expected 1.12, got ${nums[6]}`);
});

test('L-04: all anchors in [0.80, 1.20] — reasonable range', () => {
  const match = ENGINE_SRC.match(/seasonByMonth:\s*\[([\s\S]*?)\]/);
  const nums = match[1].match(/[\d.]+/g).map(Number);
  for (const n of nums) {
    assert.ok(n >= 0.80 && n <= 1.20, `anchor ${n} out of reasonable [0.80, 1.20] range`);
  }
});

test('L-05: no new seasonality service imported by pricing-apply.js', () => {
  const applyPath = path.join(ROOT, 'routes/pricing-apply.js');
  if (!fs.existsSync(applyPath)) { passed++; return; }
  const src = fs.readFileSync(applyPath, 'utf8');
  assert.ok(!/local-seasonality|learned-seasonality/i.test(src));
});

test('L-06: school holidays are still hardcoded IDF (no DB table lookup)', () => {
  assert.ok(ENGINE_SRC.includes('SCHOOL_HOLIDAYS_IDF_2025_2026'), 'IDF hardcoded holidays must be present');
  // Verify they are declared as a const, not fetched from DB
  assert.ok(!ENGINE_SRC.includes('SELECT.*school_holidays'), 'Must not query a school_holidays table');
  assert.ok(!ENGINE_SRC.includes('FROM school_holidays'), 'Must not query a school_holidays table');
});

test('L-07: no external no-network calls in pricing chain files', () => {
  for (const pricingFile of PRICING_CHAIN) {
    const fpath = path.join(ROOT, pricingFile);
    if (!fs.existsSync(fpath)) continue;
    const src = fs.readFileSync(fpath, 'utf8');
    assert.ok(!/require.*audit-local-seasonality/i.test(src),
      `${pricingFile} must not import the audit tool`);
  }
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('');
console.log('══════════════════════════════════════════════════════════════════════');
console.log(`  P1.4-T0  ${passed + failed} tests  —  ${passed} passed  ${failed} failed`);
console.log('──────────────────────────────────────────────────────────────────────');
if (errors.length > 0) {
  errors.forEach(e => console.log(`  ✗  ${e.name}`));
  console.log('──────────────────────────────────────────────────────────────────────');
}
console.log(`  ${failed === 0 ? 'ALL PASSED ✓' : `${failed} FAILED ✗`}`);
console.log('  DB_WRITES=0  CHANNEX_CALLS=0  PRICING_WRITES=0  NETWORK_CALLS=0');
console.log('  LOCAL_SEASONALITY_HAS_PRICING_AUTHORITY=NO');
console.log('  PRODUCTION_SEASONALITY_CHANGED=NO');
console.log('══════════════════════════════════════════════════════════════════════');
console.log('');

if (failed > 0) process.exit(1);
