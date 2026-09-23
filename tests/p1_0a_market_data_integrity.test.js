#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.0-A Market Data Integrity
 *
 * Groupes :
 *   MD-01–MD-05 : applyDynamicPricingForProperty — isMock blocks auto push
 *   MD-06–MD-09 : runDailyPricingRefresh — isMock derived from data_source
 *
 * Exécution : node tests/p1_0a_market_data_integrity.test.js
 * Aucun appel DB réel. Aucun appel Channex.
 */

const assert = require('assert');

// ── Résolution de chemins ─────────────────────────────────────────────────────
const enginePath    = require.resolve('../routes/pricing-engine');
const publisherPath = require.resolve('../routes/pricing-publisher');
const applyPath     = require.resolve('../routes/pricing-apply');
const dpRoutesPath  = require.resolve('../routes/dynamic-pricing-routes');
const cronPath      = require.resolve('../routes/dynamic-pricing-cron');

// ── Mocks globaux — injectés AVANT tout require de modules testés ─────────────

let _pricePropertyImpl = null;
let _publishCalled     = false;
let _publishImpl       = null;

// Mock pricing-engine
require.cache[enginePath] = {
  id: enginePath, filename: enginePath, loaded: true,
  exports: {
    priceProperty:                (pool, opts) => _pricePropertyImpl(pool, opts),
    SCHOOL_HOLIDAYS_IDF_2025_2026: [],
    EVENTS_PARIS_2026:             [],
  },
};

// Mock pricing-publisher
require.cache[publisherPath] = {
  id: publisherPath, filename: publisherPath, loaded: true,
  exports: {
    publishEffectivePricing: (pool, opts) => {
      _publishCalled = true;
      return _publishImpl
        ? _publishImpl(pool, opts)
        : Promise.resolve({ status: 'ok', rates: { count: 1, pushed: 1, error: null }, restrictions: { count: 1, pushed: 1, error: null } });
    },
  },
};

// Require the REAL pricing-apply (avec les mocks ci-dessus)
const { applyDynamicPricingForProperty } = require('../routes/pricing-apply');

// ── Test runner ───────────────────────────────────────────────────────────────
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

// Retourne une implémentation priceProperty avec une nuit valide
function makeOnNight() {
  return async (pool, opts) => ({
    propertyId: opts.property.id,
    mode: 'auto',
    isActive: true,
    market: {},
    rates:        [{ date: '2026-11-01', price: 100 }],
    restrictions: [{ date: '2026-11-01', min_stay: 1 }],
    schedule:     [{ date: '2026-11-01', price: 100, minStayArrival: 1, minStayThrough: 1, stopSell: false, booked: false, priceValid: true, breakdown: {} }],
  });
}

// ── MD-01 à MD-05 : applyDynamicPricingForProperty ────────────────────────────

(async () => {

console.log('\n── MD-01–MD-05 : applyDynamicPricingForProperty isMock guard ──');

await test('MD-01 isMock=true + mode=auto → publisher NOT called, status=pending', async () => {
  _pricePropertyImpl = makeOnNight();
  _publishCalled = false;
  const result = await applyDynamicPricingForProperty(makeMockPool(), {
    cfg: makeCfg({ mode: 'auto' }),
    marketStats: { median: 100, occupancy: 0.7, tensionLevel: 'medium' },
    isMock: true,
    sendPushNotification: null,
  });
  assert.strictEqual(_publishCalled, false, 'publishEffectivePricing ne doit PAS être appelé avec isMock=true');
  assert.strictEqual(result.status, 'pending');
});

await test('MD-02 isMock=false + mode=auto → publisher called, status=applied', async () => {
  _pricePropertyImpl = makeOnNight();
  _publishCalled = false;
  const result = await applyDynamicPricingForProperty(makeMockPool(), {
    cfg: makeCfg({ mode: 'auto' }),
    marketStats: { median: 100, occupancy: 0.7, tensionLevel: 'medium' },
    isMock: false,
    sendPushNotification: null,
  });
  assert.strictEqual(_publishCalled, true, 'publishEffectivePricing DOIT être appelé avec isMock=false');
  assert.strictEqual(result.status, 'applied');
});

await test('MD-03 isMock=true + mode=manual → status=pending (manual déjà bloqué)', async () => {
  _pricePropertyImpl = makeOnNight();
  _publishCalled = false;
  const result = await applyDynamicPricingForProperty(makeMockPool(), {
    cfg: makeCfg({ mode: 'manual' }),
    marketStats: { median: 100, occupancy: 0.7, tensionLevel: 'medium' },
    isMock: true,
    sendPushNotification: null,
  });
  assert.strictEqual(_publishCalled, false, 'mode=manual ne doit jamais appeler le publisher');
  assert.strictEqual(result.status, 'pending');
});

await test('MD-04 isMock=false + channex_enabled=false → publisher NOT called (canPush=false)', async () => {
  _pricePropertyImpl = makeOnNight();
  _publishCalled = false;
  const propNoChannex = { ...BASE_PROP, channex_enabled: false };
  const result = await applyDynamicPricingForProperty(makeMockPool(propNoChannex), {
    cfg: makeCfg({ mode: 'auto' }),
    marketStats: { median: 100, occupancy: 0.7, tensionLevel: 'medium' },
    isMock: false,
    sendPushNotification: null,
  });
  assert.strictEqual(_publishCalled, false, 'channex_enabled=false doit bloquer le publisher');
  assert.strictEqual(result.status, 'pending');
});

await test('MD-05 isMock=true + mode=auto + channex_enabled=true → warn log émis', async () => {
  _pricePropertyImpl = makeOnNight();
  _publishCalled = false;
  const warnMessages = [];
  const origWarn = console.warn;
  console.warn = (...args) => warnMessages.push(args.join(' '));
  try {
    await applyDynamicPricingForProperty(makeMockPool(), {
      cfg: makeCfg({ mode: 'auto' }),
      marketStats: { median: 100, occupancy: 0.7, tensionLevel: 'medium' },
      isMock: true,
      sendPushNotification: null,
    });
  } finally {
    console.warn = origWarn;
  }
  const warnFired = warnMessages.some(m => m.includes('auto push bloqué') || m.includes('non live'));
  assert.strictEqual(warnFired, true, 'Un warn doit être émis quand isMock=true bloque un push auto');
});

// ── MD-06–MD-09 : runDailyPricingRefresh — dérivation isMock depuis data_source ──

console.log('\n── MD-06–MD-09 : runDailyPricingRefresh isMock derivation ──');

// Remplacer pricing-apply dans le cache par un espion AVANT de requérir le module cron
let _capturedIsMock = undefined;

require.cache[applyPath] = {
  id: applyPath, filename: applyPath, loaded: true,
  exports: {
    applyDynamicPricingForProperty: async (pool, opts) => {
      _capturedIsMock = opts.isMock;
      return { status: 'pending', pushed: 0 };
    },
  },
};

// Mock dynamic-pricing-routes (requis au top-level du cron)
require.cache[dpRoutesPath] = {
  id: dpRoutesPath, filename: dpRoutesPath, loaded: true,
  exports: {
    calcRecommendedPrice: () => 100,
    calcTensionLevel:     () => 'medium',
    tensionLabel:         () => 'Modérée',
    getSelfOccupancy:     async () => 0,
    buildWeeklyEmailHtml: () => '',
  },
};

// Requérir le module cron APRÈS les mocks (pricing-apply + dynamic-pricing-routes)
const { runDailyPricingRefresh } = require('../routes/dynamic-pricing-cron');

// Pool mock pour runDailyPricingRefresh :
//   1. SELECT pricing_config JOIN properties → retourne une config
//   2. SELECT market_data WHERE property_id → retourne la ligne sous test
function makeCronPool(mdRow) {
  const cfg = {
    user_id: 'user-1',
    property_id: 'prop-1',
    property_name: 'Test Property',
    mode: 'auto',
    notify_push: false,
    is_active: true,
  };
  return {
    async query(sql, params) {
      const s = sql.toLowerCase().trim();
      if (s.includes('from pricing_config')) return { rows: [cfg] };
      if (s.includes('from market_data'))    return { rows: mdRow ? [mdRow] : [] };
      if (s.startsWith('insert') || s.startsWith('update')) return { rows: [], rowCount: 1 };
      throw new Error('CronPool inattendu: ' + sql.slice(0, 80));
    },
  };
}

await test('MD-06 data_source=apify_live → isMock=false (push autorisé)', async () => {
  _capturedIsMock = undefined;
  await runDailyPricingRefresh(makeCronPool({
    median_price: 120, occupancy_rate: 0.75, tension_level: 'high', data_source: 'apify_live',
  }));
  assert.strictEqual(_capturedIsMock, false, 'apify_live doit donner isMock=false');
});

await test('MD-07 data_source=mock → isMock=true (push bloqué)', async () => {
  _capturedIsMock = undefined;
  await runDailyPricingRefresh(makeCronPool({
    median_price: 120, occupancy_rate: 0.75, tension_level: 'medium', data_source: 'mock',
  }));
  assert.strictEqual(_capturedIsMock, true, 'data_source=mock doit donner isMock=true');
});

await test('MD-08 data_source=unknown → isMock=true (fail-closed — legacy rows bloqués)', async () => {
  _capturedIsMock = undefined;
  await runDailyPricingRefresh(makeCronPool({
    median_price: 100, occupancy_rate: 0.6, tension_level: 'medium', data_source: 'unknown',
  }));
  assert.strictEqual(_capturedIsMock, true, 'data_source=unknown (legacy) doit bloquer le push');
});

await test('MD-09 aucune ligne market_data → isMock=false (absence ≠ mock, pricing neutre)', async () => {
  _capturedIsMock = undefined;
  await runDailyPricingRefresh(makeCronPool(null));
  assert.strictEqual(_capturedIsMock, false, 'absence de market_data ne doit PAS bloquer le push');
});

await test('MD-10 data_source arbitraire (ex: "live", "foo", "") → isMock=true (fail-closed)', async () => {
  for (const badValue of ['live', 'apify', 'foo', '', 'APIFY_LIVE']) {
    _capturedIsMock = undefined;
    await runDailyPricingRefresh(makeCronPool({
      median_price: 100, occupancy_rate: 0.6, tension_level: 'medium', data_source: badValue,
    }));
    assert.strictEqual(_capturedIsMock, true,
      `data_source="${badValue}" doit donner isMock=true (seul 'apify_live' est trusted)`);
  }
});

// ── Résumé ────────────────────────────────────────────────────────────────────
console.log(`\n── Résultats : ${passed} passés / ${passed + failed} (10 tests) ──`);
if (failures.length > 0) {
  console.error('\nÉchecs :');
  for (const f of failures) console.error(`  ✗ ${f.name}: ${f.message}`);
  process.exit(1);
}
process.exit(0);

})();
