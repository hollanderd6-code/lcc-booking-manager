#!/usr/bin/env node
'use strict';
/**
 * Tests — P0-C3B : BoostPrice restrictions min_stay field mapping
 *
 * Couvre :
 *   TC-A01 : minStay=1 → min_stay_arrival=1, min_stay_through=1
 *   TC-A02 : minStay=2 → min_stay_arrival=2, min_stay_through=2
 *   TC-A03 : minStay=3 → min_stay_arrival=3, min_stay_through=3
 *   TC-A04 : 3 nuits distinctes — valeurs individuelles conservées
 *   TC-A05 : payload rates inchangé par la correction
 *   TC-A06 : mode=manual → pushRestrictions non appelé, status=pending
 *   TC-A07 : external_pricing=true → pushRestrictions non appelé
 *   TC-A08 : erreur pushRates → pushRestrictions non appelé (comportement actuel)
 *
 * Exécution : node tests/pricing_apply.test.js
 * Aucun appel DB réel. Aucun appel Channex.
 */

const assert = require('assert');

// ── Mocks injectés AVANT le require de pricing-apply ──────────────────────────
// pricing-apply.js destructure priceProperty au top-level (require au chargement)
// → le cache doit être pré-rempli avant le premier require('../routes/pricing-apply').

let _pricePropertyImpl    = null;
let _pushRatesImpl        = null;
let _pushRestrictionsImpl = null;

// Mock pricing-engine (bound au chargement de pricing-apply.js)
const enginePath = require.resolve('../routes/pricing-engine');
require.cache[enginePath] = {
  id: enginePath, filename: enginePath, loaded: true,
  exports: {
    priceProperty:               (pool, opts) => _pricePropertyImpl(pool, opts),
    SCHOOL_HOLIDAYS_IDF_2025_2026: [],
    EVENTS_PARIS_2026:             [],
  },
};

// Mock channex (lazy require à l'intérieur de willPush)
const channexPath = require.resolve('../channex');
require.cache[channexPath] = {
  id: channexPath, filename: channexPath, loaded: true,
  exports: {
    pushRates:        (pool, opts) => _pushRatesImpl(pool, opts),
    pushRestrictions: (pool, opts) => _pushRestrictionsImpl(pool, opts),
  },
};

// require pricing-apply uniquement après avoir préparé le cache
const { applyDynamicPricingForProperty } = require('../routes/pricing-apply');

// ── Test runner ────────────────────────────────────────────────────────────────

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

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_PROP = {
  id: 'prop-1',
  name: 'Test Property',
  base_price: 100,
  weekend_price: null,
  channex_enabled: true,
  channex_property_id: 'cx-prop',
  channex_room_type_id: 'cx-rt',
  channex_rate_plan_id: 'cx-rp',
  external_pricing: false,
};

function makeCfg(overrides = {}) {
  return {
    user_id: 'user-1',
    property_id: 'prop-1',
    property_name: 'Test Property',
    mode: 'auto',
    notify_push: false,
    ...overrides,
  };
}

// Pool mock — gère le DDL, la lookup properties, et les écritures schedule/history
function makeMockPool(prop = BASE_PROP) {
  return {
    async query(sql) {
      const s = sql.toLowerCase().trim();
      if (s.startsWith('create table') || s.startsWith('create index')) return { rows: [] };
      if (s.includes('from properties'))      return { rows: [prop] };
      if (s.includes('from pricing_history')) return { rows: [] };
      if (s.startsWith('insert') || s.startsWith('update')) return { rows: [], rowCount: 1 };
      throw new Error('MockPool inattendu: ' + sql.slice(0, 80));
    },
  };
}

// Construit un résultat de priceProperty à partir d'un tableau de nuits
// Chaque nuit : { date, price, minStay, booked? }
function makePriceProperty(nights) {
  return async (pool, opts) => ({
    propertyId: opts.property.id,
    mode: 'auto',
    isActive: true,
    market: {},
    rates:        nights.filter(n => !n.booked).map(n => ({ date: n.date, price: n.price })),
    restrictions: nights.filter(n => !n.booked).map(n => ({ date: n.date, min_stay: n.minStay })),
    schedule:     nights.map(n => ({
      ...n,
      booked: n.booked || false,
      breakdown: { market: 1, pacing: 1, season: 1 },
    })),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

(async () => {

// ── TC-A01 : minStay = 1 ──────────────────────────────────────────────────────
await test('TC-A01 minStay=1 → min_stay_arrival=1, min_stay_through=1', async () => {
  _pricePropertyImpl    = makePriceProperty([{ date: '2026-11-01', price: 100, minStay: 1 }]);
  _pushRatesImpl        = () => ({ success: true, count: 1 });

  let captured = null;
  _pushRestrictionsImpl = (pool, opts) => { captured = opts; return { success: true, count: 1 }; };

  await applyDynamicPricingForProperty(makeMockPool(), {
    cfg: makeCfg(), marketStats: {}, isMock: false, sendPushNotification: null,
  });

  assert.ok(captured,                          'pushRestrictions doit être appelé');
  assert.strictEqual(captured.restrictions.length, 1);
  const r = captured.restrictions[0];
  assert.strictEqual(r.date,             '2026-11-01');
  assert.strictEqual(r.min_stay_arrival, 1,            'min_stay_arrival doit être 1');
  assert.strictEqual(r.min_stay_through, 1,            'min_stay_through doit être 1');
  assert.strictEqual(r.min_stay,         undefined,    'le champ min_stay ne doit pas être transmis');
});

// ── TC-A02 : minStay = 2 ──────────────────────────────────────────────────────
await test('TC-A02 minStay=2 → min_stay_arrival=2, min_stay_through=2', async () => {
  _pricePropertyImpl    = makePriceProperty([{ date: '2026-11-02', price: 120, minStay: 2 }]);
  _pushRatesImpl        = () => ({ success: true, count: 1 });

  let captured = null;
  _pushRestrictionsImpl = (pool, opts) => { captured = opts; return { success: true, count: 1 }; };

  await applyDynamicPricingForProperty(makeMockPool(), {
    cfg: makeCfg(), marketStats: {}, isMock: false, sendPushNotification: null,
  });

  const r = captured.restrictions[0];
  assert.strictEqual(r.min_stay_arrival, 2);
  assert.strictEqual(r.min_stay_through, 2);
  assert.strictEqual(r.min_stay,         undefined);
});

// ── TC-A03 : minStay = 3 ──────────────────────────────────────────────────────
await test('TC-A03 minStay=3 → min_stay_arrival=3, min_stay_through=3', async () => {
  _pricePropertyImpl    = makePriceProperty([{ date: '2026-11-03', price: 140, minStay: 3 }]);
  _pushRatesImpl        = () => ({ success: true, count: 1 });

  let captured = null;
  _pushRestrictionsImpl = (pool, opts) => { captured = opts; return { success: true, count: 1 }; };

  await applyDynamicPricingForProperty(makeMockPool(), {
    cfg: makeCfg(), marketStats: {}, isMock: false, sendPushNotification: null,
  });

  const r = captured.restrictions[0];
  assert.strictEqual(r.min_stay_arrival, 3);
  assert.strictEqual(r.min_stay_through, 3);
  assert.strictEqual(r.min_stay,         undefined);
});

// ── TC-A04 : 3 nuits avec valeurs distinctes ──────────────────────────────────
await test('TC-A04 3 nuits minStay 3/2/1 → valeurs individuelles conservées', async () => {
  const nights = [
    { date: '2026-10-01', price: 100, minStay: 3 },
    { date: '2026-10-02', price: 110, minStay: 2 },
    { date: '2026-10-03', price: 120, minStay: 1 },
  ];
  _pricePropertyImpl    = makePriceProperty(nights);
  _pushRatesImpl        = () => ({ success: true, count: 3 });

  let captured = null;
  _pushRestrictionsImpl = (pool, opts) => { captured = opts; return { success: true, count: 3 }; };

  await applyDynamicPricingForProperty(makeMockPool(), {
    cfg: makeCfg(), marketStats: {}, isMock: false, sendPushNotification: null,
  });

  assert.ok(captured, 'pushRestrictions doit être appelé');
  assert.strictEqual(captured.restrictions.length, 3);
  assert.deepStrictEqual(captured.restrictions[0], { date: '2026-10-01', min_stay_arrival: 3, min_stay_through: 3 });
  assert.deepStrictEqual(captured.restrictions[1], { date: '2026-10-02', min_stay_arrival: 2, min_stay_through: 2 });
  assert.deepStrictEqual(captured.restrictions[2], { date: '2026-10-03', min_stay_arrival: 1, min_stay_through: 1 });
});

// ── TC-A05 : payload rates inchangé ───────────────────────────────────────────
await test('TC-A05 la correction ne modifie pas le payload envoyé à pushRates', async () => {
  const nights = [
    { date: '2026-11-10', price: 95,  minStay: 2 },
    { date: '2026-11-11', price: 130, minStay: 3 },
  ];
  _pricePropertyImpl = makePriceProperty(nights);

  let capturedRates = null;
  _pushRatesImpl        = (pool, opts) => { capturedRates = opts; return { success: true, count: 2 }; };
  _pushRestrictionsImpl = () => ({ success: true, count: 2 });

  await applyDynamicPricingForProperty(makeMockPool(), {
    cfg: makeCfg(), marketStats: {}, isMock: false, sendPushNotification: null,
  });

  assert.ok(capturedRates, 'pushRates doit être appelé');
  assert.deepStrictEqual(capturedRates.rates, [
    { date: '2026-11-10', price: 95  },
    { date: '2026-11-11', price: 130 },
  ]);
});

// ── TC-A06 : mode = manual ────────────────────────────────────────────────────
await test('TC-A06 mode=manual → pushRestrictions non appelé, status=pending', async () => {
  _pricePropertyImpl = makePriceProperty([{ date: '2026-11-20', price: 100, minStay: 2 }]);

  let ratesCalled = false, restrictionsCalled = false;
  _pushRatesImpl        = () => { ratesCalled        = true; return { success: true }; };
  _pushRestrictionsImpl = () => { restrictionsCalled = true; return { success: true }; };

  const result = await applyDynamicPricingForProperty(makeMockPool(), {
    cfg: makeCfg({ mode: 'manual' }), marketStats: {}, isMock: false, sendPushNotification: null,
  });

  assert.ok(!ratesCalled,        'pushRates ne doit pas être appelé en mode manual');
  assert.ok(!restrictionsCalled, 'pushRestrictions ne doit pas être appelé en mode manual');
  assert.strictEqual(result.status, 'pending');
});

// ── TC-A07 : external_pricing = true ─────────────────────────────────────────
await test('TC-A07 external_pricing=true → pushRestrictions non appelé', async () => {
  _pricePropertyImpl = makePriceProperty([{ date: '2026-11-21', price: 100, minStay: 2 }]);

  let restrictionsCalled = false;
  _pushRatesImpl        = () => ({ success: true });
  _pushRestrictionsImpl = () => { restrictionsCalled = true; return { success: true }; };

  const extProp = { ...BASE_PROP, external_pricing: true };
  await applyDynamicPricingForProperty(makeMockPool(extProp), {
    cfg: makeCfg(), marketStats: {}, isMock: false, sendPushNotification: null,
  });

  assert.ok(!restrictionsCalled,
    'pushRestrictions ne doit pas être appelé si external_pricing=true');
});

// ── TC-A08 : erreur pushRates → pushRestrictions non appelé ──────────────────
await test('TC-A08 erreur pushRates → pushRestrictions non appelé, fonction ne jette pas', async () => {
  _pricePropertyImpl = makePriceProperty([{ date: '2026-11-22', price: 100, minStay: 3 }]);

  let restrictionsCalled = false;
  _pushRatesImpl        = () => { throw new Error('Channex 500'); };
  _pushRestrictionsImpl = () => { restrictionsCalled = true; return { success: true }; };

  const result = await applyDynamicPricingForProperty(makeMockPool(), {
    cfg: makeCfg(), marketStats: {}, isMock: false, sendPushNotification: null,
  });

  assert.ok(!restrictionsCalled,
    'pushRestrictions ne doit pas être appelé si pushRates a échoué');
  assert.strictEqual(result.pushed, 0,
    'pushed doit rester 0 si pushRates a échoué');
  // La fonction doit se terminer normalement (l'erreur est absorbée par le catch)
  assert.ok(result.status != null, 'la fonction doit retourner un résultat valide');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n── P0-C3B pricing-apply restrictions mapping ────────────────────────────────');
console.log(`   ${passed} passed  ${failed} failed`);
if (failures.length) {
  console.log('\nÉCHECS :');
  failures.forEach(f => console.log(`  ✗ ${f.name}\n    ${f.message}`));
  process.exit(1);
}
process.exit(0);

})();
