#!/usr/bin/env node
'use strict';
/**
 * Tests unitaires — Effective Pricing Shadow (P0-B)
 *
 * Couvre :
 *   TC-S01–S03 : Feature flag (absent, false, true)
 *   TC-S04     : MATCH
 *   TC-S05     : EXPECTED_BOOSTPRICE_DIFFERENCE
 *   TC-S06     : MANUAL_OVERRIDE_PROTECTION
 *   TC-S07     : PENDING_IGNORED
 *   TC-S08     : UNEXPECTED_PRICE_DIFFERENCE
 *   TC-S09     : UNEXPECTED_MIN_STAY_DIFFERENCE
 *   TC-S10     : EXTERNAL_PRICING_CASE
 *   TC-S11     : LONG_STAY_DIFFERENCE
 *   TC-S12     : OTHER (price diff + min_stay diff, unexplained)
 *   TC-S13     : erreur resolver → legacy continue (shadow re-throw, caller catches)
 *   TC-S14     : erreur comparator → legacy continue
 *   TC-S15     : shadow output never used for rates (returns void, input unchanged)
 *   TC-S16     : shadow output never used for restrictions (input unchanged)
 *   TC-S17     : aucune écriture DB (mock pool rejette toute écriture)
 *   TC-S18     : aucun appel Channex (structural — pushRates/pushRestrictions absents)
 *   TC-S19     : maximum detail logging respecté (≤ MAX_DIFF_DETAIL lines)
 *   TC-S20     : 500 nuits identiques → résumé compact (pas 500 logs individuels)
 *
 * Exécution : node tests/effective_pricing_shadow.test.js
 * Aucun appel DB réel. Aucun appel Channex.
 */

const assert = require('assert');
const {
  classifyNight,
  isShadowEnabled,
  runPricingShadow,
  compareNights,
  logShadowSummary,
  CLASSIFICATION,
  MAX_DIFF_DETAIL,
} = require('../routes/effective-pricing-shadow');
const { SOURCE, addDays } = require('../routes/effective-pricing-resolver');

// ─── Test runner ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      result.then(() => {
        console.log(`  ✅  ${name}`);
        passed++;
      }).catch(err => {
        console.error(`  ❌  ${name}`);
        console.error(`       ${err.message}`);
        failures.push({ name, message: err.message });
        failed++;
      });
    } else {
      console.log(`  ✅  ${name}`);
      passed++;
    }
  } catch (err) {
    console.error(`  ❌  ${name}`);
    console.error(`       ${err.message}`);
    failures.push({ name, message: err.message });
    failed++;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MON = '2026-09-21'; // dow=1

function makeResolverNight(overrides = {}) {
  return {
    date:           MON,
    price:          100,
    priceValid:     true,
    minStayArrival: 1,
    minStayThrough: 1,
    source:         SOURCE.BASE_PRICE,
    sourceId:       null,
    locked:         false,
    breakdown:      null,
    calculatedAt:   null,
    ...overrides,
  };
}

// Minimal mock pool for shadow tests
// Tables:
//   properties, pricing_config, pricing_overrides, pricing_schedule, pricing_rules,
//   pricing_schedule_pending (for the extra pending query from shadow)
function makeShadowMockPool(tables = {}, opts = {}) {
  const { rejectWrites = false } = opts;
  return {
    queryLog: [],
    async query(sql, params = []) {
      this.queryLog.push(sql.trim().slice(0, 60));
      const s = sql.replace(/\s+/g, ' ').toLowerCase();

      // Reject any DB write if configured (check start of query to avoid false positives on 'updated_at')
      if (rejectWrites) {
        const normalized = s.trimStart();
        if (normalized.startsWith('insert') || normalized.startsWith('update') || normalized.startsWith('delete')) {
          throw new Error(`MockPool: DB write detected (TC-S17): ${sql.slice(0, 80)}`);
        }
      }

      if (s.includes('from properties')) {
        return { rows: tables.properties || [] };
      }
      if (s.includes('from pricing_config')) {
        return { rows: tables.pricing_config || [] };
      }
      if (s.includes('from pricing_overrides')) {
        const start = params[2], end = params[3];
        return {
          rows: (tables.pricing_overrides || []).filter(r => r.date >= start && r.date < end),
        };
      }
      if (s.includes('from pricing_schedule')) {
        if (s.includes("status = 'applied'") || s.includes('status = $') && params.includes?.('applied')) {
          const start = params[1], end = params[2];
          return {
            rows: (tables.pricing_schedule || [])
              .filter(r => r.date >= start && r.date < end && r.status === 'applied'),
          };
        }
        if (s.includes("status = 'pending'")) {
          const start = params[1], end = params[2];
          return {
            rows: (tables.pricing_schedule || [])
              .filter(r => r.date >= start && r.date < end && r.status === 'pending'),
          };
        }
        // Fallback: return all
        return { rows: tables.pricing_schedule || [] };
      }
      if (s.includes('from pricing_rules')) {
        const active = (tables.pricing_rules || []).filter(r => r.active !== false);
        active.sort((a, b) => (b.priority || 0) - (a.priority || 0));
        return { rows: active };
      }
      throw new Error(`MockPool: unrecognized query: ${sql.slice(0, 80)}`);
    },
  };
}

function prop(overrides = {}) {
  return { base_price: 100, weekend_price: null, external_pricing: false, ...overrides };
}

// ─── Section TC-S01–S03: Feature flag ────────────────────────────────────────

console.log('\n── TC-S01–S03 : Feature flag ──');

test('TC-S01 — flag absent → isShadowEnabled returns false', () => {
  const orig = process.env.EFFECTIVE_PRICING_SHADOW_ENABLED;
  delete process.env.EFFECTIVE_PRICING_SHADOW_ENABLED;
  const result = isShadowEnabled();
  if (orig !== undefined) process.env.EFFECTIVE_PRICING_SHADOW_ENABLED = orig;
  assert.strictEqual(result, false);
});

test('TC-S02 — flag=false → isShadowEnabled returns false', () => {
  const orig = process.env.EFFECTIVE_PRICING_SHADOW_ENABLED;
  process.env.EFFECTIVE_PRICING_SHADOW_ENABLED = 'false';
  const result = isShadowEnabled();
  process.env.EFFECTIVE_PRICING_SHADOW_ENABLED = orig || '';
  assert.strictEqual(result, false);
});

test('TC-S03 — flag absent → runPricingShadow returns early (resolver not called)', async () => {
  const orig = process.env.EFFECTIVE_PRICING_SHADOW_ENABLED;
  delete process.env.EFFECTIVE_PRICING_SHADOW_ENABLED;

  let resolverCalled = false;
  const fakePool = {
    async query(sql) {
      resolverCalled = true; // any query = resolver was reached
      return { rows: [] };
    },
  };

  await runPricingShadow(fakePool, {
    propertyId: 'p1', userId: 'u1',
    startDate: MON, endDate: addDays(MON, 1),
    legacyRates: [], legacyRestrictions: [],
    longStayRule: null, isExternalPricing: false,
  });

  if (orig !== undefined) process.env.EFFECTIVE_PRICING_SHADOW_ENABLED = orig;
  assert.strictEqual(resolverCalled, false, 'resolver must not be called when flag is absent');
});

// ─── Section TC-S04–S12: Classification ──────────────────────────────────────

console.log('\n── TC-S04–S12 : Classifications ──');

test('TC-S04 — MATCH: prices and min_stay identical, no override/pending', () => {
  const cl = classifyNight({
    legacyPrice: 100, legacyMinArr: 1, legacyMinThru: 1,
    resolverNight: makeResolverNight({ price: 100, source: SOURCE.BASE_PRICE }),
    longStayRule: null, isExternalPricing: false, hasPending: false,
  });
  assert.strictEqual(cl, CLASSIFICATION.MATCH);
});

test('TC-S05 — EXPECTED_BOOSTPRICE_DIFFERENCE: resolver=boostprice, legacy=base_price', () => {
  const cl = classifyNight({
    legacyPrice: 100, legacyMinArr: 1, legacyMinThru: 1,
    resolverNight: makeResolverNight({ price: 180, source: SOURCE.BOOSTPRICE }),
    longStayRule: null, isExternalPricing: false, hasPending: false,
  });
  assert.strictEqual(cl, CLASSIFICATION.EXPECTED_BOOSTPRICE_DIFFERENCE);
});

test('TC-S06 — MANUAL_OVERRIDE_PROTECTION: prices match, resolver used override', () => {
  // Both legacy and resolver use same override price → MATCH in values,
  // but classified as MANUAL_OVERRIDE_PROTECTION for reporting
  const cl = classifyNight({
    legacyPrice: 250, legacyMinArr: 1, legacyMinThru: 1,
    resolverNight: makeResolverNight({ price: 250, source: SOURCE.MANUAL_OVERRIDE, locked: true }),
    longStayRule: null, isExternalPricing: false, hasPending: false,
  });
  assert.strictEqual(cl, CLASSIFICATION.MANUAL_OVERRIDE_PROTECTION);
});

test('TC-S07 — PENDING_IGNORED: pending entry exists, prices match, not classified as override', () => {
  const cl = classifyNight({
    legacyPrice: 100, legacyMinArr: 1, legacyMinThru: 1,
    resolverNight: makeResolverNight({ price: 100, source: SOURCE.BASE_PRICE }),
    longStayRule: null, isExternalPricing: false, hasPending: true,
  });
  assert.strictEqual(cl, CLASSIFICATION.PENDING_IGNORED);
});

test('TC-S08 — UNEXPECTED_PRICE_DIFFERENCE: prices differ, no known explanation', () => {
  const cl = classifyNight({
    legacyPrice: 100, legacyMinArr: 1, legacyMinThru: 1,
    resolverNight: makeResolverNight({ price: 130, source: SOURCE.PERIOD_RULE }),
    longStayRule: null, isExternalPricing: false, hasPending: false,
  });
  assert.strictEqual(cl, CLASSIFICATION.UNEXPECTED_PRICE_DIFFERENCE);
});

test('TC-S09 — UNEXPECTED_MIN_STAY_DIFFERENCE: prices match but min_stay differs', () => {
  const cl = classifyNight({
    legacyPrice: 100, legacyMinArr: 1, legacyMinThru: 2,
    resolverNight: makeResolverNight({ price: 100, minStayThrough: 3 }),
    longStayRule: null, isExternalPricing: false, hasPending: false,
  });
  assert.strictEqual(cl, CLASSIFICATION.UNEXPECTED_MIN_STAY_DIFFERENCE);
});

test('TC-S10 — EXTERNAL_PRICING_CASE: isExternalPricing=true → first check, short-circuits all', () => {
  const cl = classifyNight({
    legacyPrice: 100, legacyMinArr: 1, legacyMinThru: 1,
    resolverNight: makeResolverNight({ price: 180, source: SOURCE.BOOSTPRICE }),
    longStayRule: null, isExternalPricing: true, hasPending: false,
  });
  assert.strictEqual(cl, CLASSIFICATION.EXTERNAL_PRICING_CASE);
});

test('TC-S11 — LONG_STAY_DIFFERENCE: legacy applied 10% discount, resolver did not', () => {
  // resolver price = 100, legacy should be 90 (100 * 0.9)
  const cl = classifyNight({
    legacyPrice: 90, legacyMinArr: 1, legacyMinThru: 1,
    resolverNight: makeResolverNight({ price: 100, source: SOURCE.BASE_PRICE }),
    longStayRule: { discount_pct: 10, discount_after_nights: 7 },
    isExternalPricing: false, hasPending: false,
  });
  assert.strictEqual(cl, CLASSIFICATION.LONG_STAY_DIFFERENCE);
});

test('TC-S12 — OTHER: price diff + min_stay diff with no known explanation', () => {
  // price differs (not boostprice, not long_stay) AND min_stay differs → OTHER
  const cl = classifyNight({
    legacyPrice: 100, legacyMinArr: 1, legacyMinThru: 1,
    resolverNight: makeResolverNight({ price: 130, minStayThrough: 3, source: SOURCE.PERIOD_RULE }),
    longStayRule: null, isExternalPricing: false, hasPending: false,
  });
  assert.strictEqual(cl, CLASSIFICATION.OTHER);
});

// ─── Section TC-S13–S14: Error isolation ─────────────────────────────────────

console.log('\n── TC-S13–S14 : Isolation d\'erreur ──');

test('TC-S13 — resolver error → runPricingShadow rejects (caller must catch)', async () => {
  const orig = process.env.EFFECTIVE_PRICING_SHADOW_ENABLED;
  process.env.EFFECTIVE_PRICING_SHADOW_ENABLED = 'true';

  const brokenPool = {
    async query() { throw new Error('DB connection lost'); },
  };

  let threw = false;
  try {
    await runPricingShadow(brokenPool, {
      propertyId: 'p1', userId: 'u1',
      startDate: MON, endDate: addDays(MON, 1),
      legacyRates: [], legacyRestrictions: [],
      longStayRule: null, isExternalPricing: false,
    });
  } catch (err) {
    threw = true;
    assert.ok(err.message.includes('DB connection lost'));
  }

  process.env.EFFECTIVE_PRICING_SHADOW_ENABLED = orig || '';
  assert.strictEqual(threw, true, 'runPricingShadow must re-throw so caller try/catch can handle it');
});

test('TC-S14 — error in classification does not silently swallow (propagates)', () => {
  // classifyNight itself should throw if given null resolver night
  let threw = false;
  try {
    classifyNight({
      legacyPrice: 100, legacyMinArr: 1, legacyMinThru: 1,
      resolverNight: null, // will throw accessing .price
      longStayRule: null, isExternalPricing: false, hasPending: false,
    });
  } catch (err) {
    threw = true;
  }
  assert.strictEqual(threw, true, 'classification error must propagate');
});

// ─── Section TC-S15–S16: Shadow output not used for rates/restrictions ────────

console.log('\n── TC-S15–S16 : Shadow output non utilisé ──');

test('TC-S15 — runPricingShadow returns void (not rates)', async () => {
  const orig = process.env.EFFECTIVE_PRICING_SHADOW_ENABLED;
  process.env.EFFECTIVE_PRICING_SHADOW_ENABLED = 'true';

  const pool = makeShadowMockPool({ properties: [prop()] });
  const result = await runPricingShadow(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: MON, endDate: addDays(MON, 1),
    legacyRates: [{ date: MON, price: 100 }],
    legacyRestrictions: [{ date: MON, min_stay_arrival: 1, min_stay_through: 1 }],
    longStayRule: null, isExternalPricing: false,
  });

  process.env.EFFECTIVE_PRICING_SHADOW_ENABLED = orig || '';
  assert.strictEqual(result, undefined, 'runPricingShadow must return void');
});

test('TC-S16 — legacyRates array is not mutated by shadow', async () => {
  const orig = process.env.EFFECTIVE_PRICING_SHADOW_ENABLED;
  process.env.EFFECTIVE_PRICING_SHADOW_ENABLED = 'true';

  const pool = makeShadowMockPool({ properties: [prop()] });
  const legacyRates = [{ date: MON, price: 100 }];
  const snapshot = JSON.stringify(legacyRates);

  await runPricingShadow(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: MON, endDate: addDays(MON, 1),
    legacyRates,
    legacyRestrictions: [{ date: MON, min_stay_arrival: 1, min_stay_through: 1 }],
    longStayRule: null, isExternalPricing: false,
  });

  process.env.EFFECTIVE_PRICING_SHADOW_ENABLED = orig || '';
  assert.strictEqual(JSON.stringify(legacyRates), snapshot, 'legacyRates must not be mutated');
});

// ─── Section TC-S17: No DB writes ────────────────────────────────────────────

console.log('\n── TC-S17 : Aucune écriture DB ──');

test('TC-S17 — pool never receives INSERT/UPDATE/DELETE from shadow', async () => {
  const orig = process.env.EFFECTIVE_PRICING_SHADOW_ENABLED;
  process.env.EFFECTIVE_PRICING_SHADOW_ENABLED = 'true';

  const pool = makeShadowMockPool({ properties: [prop()] }, { rejectWrites: true });

  let threw = false;
  try {
    await runPricingShadow(pool, {
      propertyId: 'p1', userId: 'u1',
      startDate: MON, endDate: addDays(MON, 1),
      legacyRates: [{ date: MON, price: 100 }],
      legacyRestrictions: [{ date: MON, min_stay_arrival: 1, min_stay_through: 1 }],
      longStayRule: null, isExternalPricing: false,
    });
  } catch (err) {
    threw = true;
    console.error('  [TC-S17 write detected]:', err.message);
  }

  process.env.EFFECTIVE_PRICING_SHADOW_ENABLED = orig || '';
  assert.strictEqual(threw, false, 'Shadow must not perform any DB writes');
});

// ─── Section TC-S18: No Channex calls (structural) ────────────────────────────

console.log('\n── TC-S18 : Aucun appel Channex ──');

test('TC-S18 — shadow module source does not import channex.js', () => {
  const fs = require('fs');
  const src = fs.readFileSync(
    require('path').join(__dirname, '../routes/effective-pricing-shadow.js'), 'utf-8'
  );
  assert.ok(!src.includes("require('./channex')") && !src.includes('require("./channex")'),
    'Shadow must not import channex.js');
  assert.ok(!src.includes('pushRates') && !src.includes('pushRestrictions'),
    'Shadow must not call pushRates or pushRestrictions');
});

// ─── Section TC-S19–S20: Log compactness ─────────────────────────────────────

console.log('\n── TC-S19–S20 : Logging compact ──');

test('TC-S19 — maximum detail logging: at most MAX_DIFF_DETAIL diff lines logged', () => {
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  // Build 50 divergent comparisons (more than MAX_DIFF_DETAIL)
  const comparisons = Array.from({ length: 50 }, (_, i) => ({
    propertyId: 'p1',
    date: addDays(MON, i),
    legacy:   { price: 100, minStayArrival: 1, minStayThrough: 1, source: null },
    resolver: { price: 150, minStayArrival: 1, minStayThrough: 1, source: SOURCE.BASE_PRICE, locked: false },
    differences: { price: true, minStayArrival: false, minStayThrough: false, source: false },
    classification: CLASSIFICATION.UNEXPECTED_PRICE_DIFFERENCE,
  }));

  logShadowSummary(comparisons, { propertyId: 'p1', startDate: MON, endDate: addDays(MON, 50) });

  console.log = origLog;

  // Count how many lines look like diff detail lines (contain '|' with a date)
  const diffLines = logs.filter(l => l.includes(CLASSIFICATION.UNEXPECTED_PRICE_DIFFERENCE));
  assert.ok(
    diffLines.length <= MAX_DIFF_DETAIL,
    `Expected at most ${MAX_DIFF_DETAIL} detail lines, got ${diffLines.length}`
  );
});

test('TC-S20 — 500 matching nights → summary only (no per-night log lines)', async () => {
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  // Build 500 MATCH comparisons
  const comparisons = Array.from({ length: 500 }, (_, i) => ({
    propertyId: 'p1',
    date: addDays(MON, i),
    legacy:   { price: 100, minStayArrival: 1, minStayThrough: 1, source: null },
    resolver: { price: 100, minStayArrival: 1, minStayThrough: 1, source: SOURCE.BASE_PRICE, locked: false },
    differences: { price: false, minStayArrival: false, minStayThrough: false, source: false },
    classification: CLASSIFICATION.MATCH,
  }));

  logShadowSummary(comparisons, { propertyId: 'p1', startDate: MON, endDate: addDays(MON, 500) });

  console.log = origLog;

  // With 500 MATCHes, no diff detail lines should appear
  const detailLines = logs.filter(l =>
    l.includes('MATCH') && l.includes('|') && l.includes(MON)
  );
  assert.strictEqual(detailLines.length, 0, '500 matching nights must produce no per-night detail lines');

  // Summary should be compact (≤ 20 log lines total)
  assert.ok(logs.length <= 20, `Expected compact summary (≤20 lines), got ${logs.length}`);
});

// ─── Additional integration: compareNights ────────────────────────────────────

console.log('\n── TC-S21–S23 : compareNights ──');

test('TC-S21 — compareNights returns correct comparison structure', () => {
  const resolverNight = makeResolverNight({ date: MON, price: 100 });
  const comparisons = compareNights({
    resolverNights: [resolverNight],
    legacyRateMap:  new Map([[MON, 100]]),
    legacyRestMap:  new Map([[MON, { min_stay_arrival: 1, min_stay_through: 1 }]]),
    pendingSet:     new Set(),
    longStayRule:   null,
    isExternalPricing: false,
    propertyId:     'p1',
  });
  assert.strictEqual(comparisons.length, 1);
  assert.strictEqual(comparisons[0].classification, CLASSIFICATION.MATCH);
  assert.strictEqual(comparisons[0].date, MON);
  assert.strictEqual(comparisons[0].propertyId, 'p1');
  assert.strictEqual(comparisons[0].differences.price, false);
});

test('TC-S22 — compareNights: legacy price null (missing from rates) vs resolver none', () => {
  const resolverNight = makeResolverNight({ price: null, source: SOURCE.NONE, priceValid: false });
  const comparisons = compareNights({
    resolverNights: [resolverNight],
    legacyRateMap:  new Map(), // date not in legacy rates (no price)
    legacyRestMap:  new Map([[MON, { min_stay_arrival: 1, min_stay_through: 1 }]]),
    pendingSet:     new Set(),
    longStayRule:   null,
    isExternalPricing: false,
    propertyId:     'p1',
  });
  // legacy.price = null, resolver.price = null → MATCH
  assert.strictEqual(comparisons[0].classification, CLASSIFICATION.MATCH);
  assert.strictEqual(comparisons[0].legacy.price, null);
});

test('TC-S23 — LONG_STAY_DIFFERENCE: override bypasses long_stay (manual_override + long_stay rule → no long_stay diff)', () => {
  // When resolver source = manual_override, long_stay should NOT explain the diff
  // (legacy also doesn't apply long_stay to overrides)
  // → If prices differ and source=manual_override, it's UNEXPECTED_PRICE_DIFFERENCE
  const cl = classifyNight({
    legacyPrice: 250, legacyMinArr: 1, legacyMinThru: 1,
    resolverNight: makeResolverNight({ price: 300, source: SOURCE.MANUAL_OVERRIDE, locked: true }),
    longStayRule: { discount_pct: 10, discount_after_nights: 7 },
    isExternalPricing: false, hasPending: false,
  });
  // 300 * 0.9 = 270 ≠ 250, so long_stay doesn't explain it
  // Also source=manual_override prevents long_stay classification
  assert.strictEqual(cl, CLASSIFICATION.UNEXPECTED_PRICE_DIFFERENCE,
    'manual_override with price diff should not be classified as LONG_STAY_DIFFERENCE');
});

// ─── Summary ──────────────────────────────────────────────────────────────────

setImmediate(() => {
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`  Résultats : ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\n  Échecs :');
    failures.forEach(f => console.log(`    • ${f.name}\n      ${f.message}`));
  }
  process.exit(failed > 0 ? 1 : 0);
});
