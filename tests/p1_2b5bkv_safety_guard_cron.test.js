#!/usr/bin/env node
'use strict';
/**
 * Tests — Safety Guard P1.2-B5-BK-V (cron level)
 *
 * TEST D: propertyIds=[M6,M7] filters out Ti Junot; only 2 configs processed
 * TEST E: M6+M7 same geo/guests/bedrooms/currency/provider → 1 shared fingerprint group
 * TEST F: runSharedPreCollection calls scrapeFn exactly once for M6+M7 group
 * TEST G: MAX_LISTINGS=100 (static) and shared collection passes maxListings=100 to scrapeFn
 * TEST H: suppressNotifications=true → sendEmail 0 calls, sendPushNotification forwarded as null
 * TEST I: opts omitted → all 3 configs processed, no suppression flags set
 * TEST J: propertyIds with no matching config → 0 apply calls, safe return
 *
 * DB_WRITES = 0  NETWORK_CALLS = 0  BRIGHT_DATA = 0
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

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

// ── Property fixtures ─────────────────────────────────────────────────────────
const CHECK_IN  = '2026-10-15';
const CHECK_OUT = '2026-10-16';

const M6_ID = 'u_mmj5c6hq-m6';
const M7_ID = 'u_mmj5c6hq-m7';
const TI_ID = 'u_mmj5c6hq-ti';

// M6 and M7 share identical geo/guests/bedrooms/currency
const M6_CFG = {
  property_id: M6_ID, user_id: 'u1',
  property_address: '12 rue Test 95300 Pontoise', zone_label: null,
  latitude: 49.0503, longitude: 2.0773, currency: 'EUR',
  max_guests: 4, bedrooms: 2, property_type: 'entire_place',
  price_min: '50', price_max: '120',
};
const M7_CFG = {
  property_id: M7_ID, user_id: 'u1',
  property_address: '14 rue Test 95300 Pontoise', zone_label: null,
  latitude: 49.0503, longitude: 2.0773, currency: 'EUR',
  max_guests: 4, bedrooms: 2, property_type: 'entire_place',
  price_min: '60', price_max: '130',
};
// Ti Junot: missing geo → excluded from shared collection
const TI_JUNOT_CFG = {
  property_id: TI_ID, user_id: 'u1',
  property_address: '1 rue Ti Junot Paris', zone_label: null,
  latitude: null, longitude: null, currency: 'EUR',
  max_guests: 2, bedrooms: 1, property_type: 'entire_place',
  price_min: '40', price_max: '80',
};

(async () => {

// ────────────────────────────────────────────────────────────────────────────
// Tests E, F — use the REAL coordinator (before mock injection)
//
// groupPropertiesByFingerprint(configs, { checkIn, checkOut, resolveProvider, maxListings })
//   → Map<fingerprint_string, group>  where group.propertyLinks = [{ property_id, user_id }]
//
// runSharedPreCollection(configs, { checkIn, checkOut, resolveProvider, scrapeFn,
//                                   getFallbackZonesFn, priceFallbackFn, maxListings })
//   → { sharedEvidence, propToFingerprint, groupCount, callCount }
// ────────────────────────────────────────────────────────────────────────────
const {
  groupPropertiesByFingerprint,
  runSharedPreCollection,
} = require('../services/market-shared-collection-coordinator');

console.log('\n── TEST E: M6+M7 share one fingerprint group ────────────────────────────');

await test('E1 — M6+M7 same geo/guests/bedrooms/currency/provider → exactly 1 fingerprint group', async () => {
  const groups = groupPropertiesByFingerprint([M6_CFG, M7_CFG], {
    checkIn: CHECK_IN, checkOut: CHECK_OUT,
    resolveProvider: () => 'brightdata',
    maxListings: 100,
  });

  assert.strictEqual(groups.size, 1, 'M6 and M7 must be grouped into exactly 1 fingerprint group');

  const [, group] = [...groups.entries()][0];
  const propIds = group.propertyLinks.map(l => l.property_id);
  assert.ok(propIds.includes(M6_ID), 'M6 must be in the shared group');
  assert.ok(propIds.includes(M7_ID), 'M7 must be in the shared group');
});

await test('E2 — Ti Junot (invalid geo) excluded; M6+M7 remain in single group', async () => {
  const groups = groupPropertiesByFingerprint([M6_CFG, M7_CFG, TI_JUNOT_CFG], {
    checkIn: CHECK_IN, checkOut: CHECK_OUT,
    resolveProvider: () => 'brightdata',
    maxListings: 100,
  });

  assert.strictEqual(groups.size, 1, 'Only 1 group — Ti Junot excluded due to invalid geo');
  const allIds = [...groups.values()].flatMap(g => g.propertyLinks.map(l => l.property_id));
  assert.ok(!allIds.includes(TI_ID), 'Ti Junot must not appear in any fingerprint group');
});

console.log('\n── TEST F: scrapeFn called exactly once for M6+M7 group ─────────────────');

await test('F — runSharedPreCollection: scrapeFn called once; receives maxListings=100', async () => {
  let scrapeCalls = 0;
  let capturedMaxListings;

  // scrapeFn signature: (zones, priceFallback, maxListings, bedrooms, currency, propertyId)
  const result = await runSharedPreCollection([M6_CFG, M7_CFG], {
    checkIn:         CHECK_IN,
    checkOut:        CHECK_OUT,
    resolveProvider: () => 'brightdata',
    scrapeFn: async (zones, priceFallback, maxListings, bedrooms, currency, propertyId) => {
      scrapeCalls++;
      capturedMaxListings = maxListings;
      return { listings: [], isMock: false, zoneUsed: zones[0] || 'France', dataSource: 'brightdata_live', diagnostics: {} };
    },
    priceFallbackFn: cfg => (parseFloat(cfg.price_min) + parseFloat(cfg.price_max)) / 2,
    maxListings: 100,
  });

  assert.strictEqual(scrapeCalls, 1, 'scrapeFn must be called exactly once for M6+M7 (1 fingerprint group)');
  assert.strictEqual(result.callCount, 1, 'result.callCount must equal 1');
  assert.strictEqual(result.groupCount, 1, 'result.groupCount must equal 1');
  assert.strictEqual(capturedMaxListings, 100, 'scrapeFn must receive maxListings=100');
});

console.log('\n── TEST G: MAX_LISTINGS=100 static invariant ─────────────────────────────');

await test('G — MAX_LISTINGS=100 in cron; passed to shared collection as maxListings', async () => {
  const cronSource = fs.readFileSync(path.join(__dirname, '../routes/dynamic-pricing-cron.js'), 'utf8');
  assert.ok(cronSource.includes('const MAX_LISTINGS    = 100'), 'MAX_LISTINGS must be defined as 100');
  // Allow any whitespace between ':' and 'MAX_LISTINGS' (source uses alignment spaces)
  assert.ok(/maxListings\s*:\s*MAX_LISTINGS/.test(cronSource),
    'shared collection call must pass maxListings: MAX_LISTINGS');
});

// ────────────────────────────────────────────────────────────────────────────
// Mock injection — done BEFORE requiring the cron module
// ────────────────────────────────────────────────────────────────────────────

const enginePath = require.resolve('../routes/pricing-engine');
require.cache[enginePath] = {
  id: enginePath, filename: enginePath, loaded: true,
  exports: {
    priceProperty: async (pool, opts) => ({
      propertyId: opts.property?.id, mode: 'auto', isActive: true, market: {},
      rates: [], restrictions: [],
      schedule: [{
        date: '2026-11-01', price: 100, minStay: 1, booked: false,
        breakdown: { version: 1, market: 0.5, pacing: 0.3, season: 0.2 },
      }],
    }),
    SCHOOL_HOLIDAYS_IDF_2025_2026: [],
    EVENTS_PARIS_2026: [],
  },
};

const publisherPath = require.resolve('../routes/pricing-publisher');
require.cache[publisherPath] = {
  id: publisherPath, filename: publisherPath, loaded: true,
  exports: {
    publishEffectivePricing: async () => ({ status: 'ok', rates: { count: 0, pushed: 0, error: null }, restrictions: { count: 0, pushed: 0, error: null } }),
  },
};

// Spy on pricing-apply — captures each call for verification
const applyCalls = [];
function resetApplyCalls() { applyCalls.length = 0; }

const pricingApplyPath = require.resolve('../routes/pricing-apply');
require.cache[pricingApplyPath] = {
  id: pricingApplyPath, filename: pricingApplyPath, loaded: true,
  exports: {
    applyDynamicPricingForProperty: async (pool, opts) => {
      applyCalls.push({
        property_id:          opts.cfg?.property_id,
        suppressExternalPush: opts.suppressExternalPush,
        sendPushNotification: opts.sendPushNotification,
      });
      return {
        status: 'pending', mode: opts.cfg?.mode || 'auto',
        priceBefore: 100, priceApplied: null, priceCalculated: 100,
        nights: 7, pushed: 0, publishStatus: 'skipped_no_push',
      };
    },
    ensureScheduleTable: async () => {},
    upsertSchedule: async () => {},
  },
};

const dynRoutesPath = require.resolve('../routes/dynamic-pricing-routes');
require.cache[dynRoutesPath] = {
  id: dynRoutesPath, filename: dynRoutesPath, loaded: true,
  exports: {
    calcRecommendedPrice: () => 100,
    calcTensionLevel:     () => 0,
    tensionLabel:         () => 'low',
    getSelfOccupancy:     async () => 0,
    buildWeeklyEmailHtml: () => '<html>mock</html>',
  },
};

function mockIfAbsent(relPath, exports) {
  const abs = require.resolve(relPath);
  if (!require.cache[abs]) {
    require.cache[abs] = { id: abs, filename: abs, loaded: true, exports };
  }
}

mockIfAbsent('../routes/market-data-resolver',
  { resolveMarketData: async () => ({ status: 'missing', trusted: false, row: null, market: null }) });
mockIfAbsent('../routes/market-context-key',
  { computeMarketContextKey: () => 'test-ctx-key' });
mockIfAbsent('../services/brightdata-comparable-filter',
  { selectComparables: () => [], calcBrightDataMarketStats: () => null });
mockIfAbsent('../services/market-geo-validator',
  { hasValidCoordinates: () => true });

// Overwrite coordinator (was loaded real above; now mock for cron tests)
const coordPath = require.resolve('../services/market-shared-collection-coordinator');
require.cache[coordPath] = {
  id: coordPath, filename: coordPath, loaded: true,
  exports: {
    isSharedProductionEnabled:    () => false,
    isShadowCollectionEnabled:    () => false,
    groupPropertiesByFingerprint: () => new Map(),
    runSharedPreCollection:       async () => ({ sharedEvidence: new Map(), propToFingerprint: new Map(), groupCount: 0, callCount: 0 }),
    validatePropertyCompleteness: () => ({ ok: false, reason: 'test' }),
  },
};

const bridgePath = require.resolve('../services/market-observation-persistence-bridge');
require.cache[bridgePath] = {
  id: bridgePath, filename: bridgePath, loaded: true,
  exports: {
    isPersistenceEnabled:            () => false,
    generateBridgeRunId:             () => 'bridge-test',
    bridgePersistProductionEvidence: async () => {},
  },
};

const mpPath = require.resolve('../services/market-provider');
require.cache[mpPath] = {
  id: mpPath, filename: mpPath, loaded: true,
  exports: {
    resolveProvider:            () => 'apify',
    resolveProviderForProperty: () => 'apify',
    getBrightDataMarketDates:   () => ({ checkIn: CHECK_IN, checkOut: CHECK_OUT }),
  },
};

// Load cron AFTER all mocks in place
const { runDynamicPricingJob } = require('../routes/dynamic-pricing-cron');

// ── Pool factory — null currency → unknown-currency path → no scraping ────────
function makeCronCfg(propertyId, overrides = {}) {
  return {
    user_id: 'u1', property_id: propertyId,
    property_name: `Prop-${propertyId}`, property_address: '12 rue Test 95300 Pontoise',
    zone_label: null, latitude: 49.05, longitude: 2.07,
    currency: null,          // null → normalizeMarketCurrency returns null → no scraping
    max_guests: 4, bedrooms: 2, property_type: 'entire_place',
    country_code: 'FR', timezone: 'Europe/Paris', is_active: true, mode: 'auto',
    notify_push: false, notify_email: false,
    user_email: 'test@test.fr', user_first_name: 'Test',
    price_min: '50', price_max: '120', created_at: new Date(),
    ...overrides,
  };
}

function makeCronPool(configs) {
  return {
    async query(sql) {
      const s = (sql || '').toLowerCase().trim();
      if (s.includes('from pricing_config') || (s.includes('is_active') && s.includes('pricing_config')))
        return { rows: configs };
      return { rows: [] };
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
console.log('\n── TEST D: propertyIds filter ────────────────────────────────────────────');

await test('D1 — propertyIds=[M6,M7]: only M6+M7 processed; Ti Junot excluded', async () => {
  resetApplyCalls();
  const configs = [makeCronCfg(M6_ID), makeCronCfg(M7_ID), makeCronCfg(TI_ID)];
  await runDynamicPricingJob(makeCronPool(configs), async () => {}, null, {
    propertyIds: [M6_ID, M7_ID],
    suppressExternalPush: true,
    suppressNotifications: true,
  });

  assert.strictEqual(applyCalls.length, 2, `expected 2 apply calls (M6+M7), got ${applyCalls.length}`);
  const ids = applyCalls.map(c => c.property_id);
  assert.ok(ids.includes(M6_ID), 'M6 must be processed');
  assert.ok(ids.includes(M7_ID), 'M7 must be processed');
  assert.ok(!ids.includes(TI_ID), 'Ti Junot must NOT be processed');
});

await test('D2 — propertyIds=[M6,M7]: suppressExternalPush=true propagated to both apply calls', async () => {
  resetApplyCalls();
  const configs = [makeCronCfg(M6_ID), makeCronCfg(M7_ID), makeCronCfg(TI_ID)];
  await runDynamicPricingJob(makeCronPool(configs), async () => {}, null, {
    propertyIds: [M6_ID, M7_ID],
    suppressExternalPush: true,
    suppressNotifications: true,
  });

  for (const call of applyCalls) {
    assert.strictEqual(call.suppressExternalPush, true,
      `suppressExternalPush must be true for ${call.property_id}`);
  }
});

// ────────────────────────────────────────────────────────────────────────────
console.log('\n── TEST H: suppressNotifications=true ────────────────────────────────────');

await test('H1 — suppressNotifications=true: sendEmail never called', async () => {
  resetApplyCalls();
  let emailCalls = 0;
  const configs = [makeCronCfg(M6_ID, { notify_email: true, user_email: 'test@test.fr' })];

  await runDynamicPricingJob(makeCronPool(configs), async () => { emailCalls++; }, null, {
    suppressNotifications: true,
    suppressExternalPush: true,
  });

  assert.strictEqual(emailCalls, 0, 'sendEmail must not be called when suppressNotifications=true');
});

await test('H2 — suppressNotifications=true: sendPushNotification forwarded as null to apply', async () => {
  resetApplyCalls();
  const pushSpy = async () => {};
  const configs = [makeCronCfg(M6_ID, { notify_push: true })];

  await runDynamicPricingJob(makeCronPool(configs), async () => {}, pushSpy, {
    suppressNotifications: true,
    suppressExternalPush: true,
  });

  assert.ok(applyCalls.length > 0, 'applyDynamicPricingForProperty must still be called');
  assert.strictEqual(applyCalls[0].sendPushNotification, null,
    'sendPushNotification must be null when suppressNotifications=true');
});

// ────────────────────────────────────────────────────────────────────────────
console.log('\n── TEST I: opts omitted → exact legacy behavior ──────────────────────────');

await test('I1 — opts omitted: all 3 active configs processed', async () => {
  resetApplyCalls();
  const configs = [makeCronCfg(M6_ID), makeCronCfg(M7_ID), makeCronCfg(TI_ID)];
  await runDynamicPricingJob(makeCronPool(configs), async () => {}, null);

  assert.strictEqual(applyCalls.length, 3, `expected 3 apply calls (legacy), got ${applyCalls.length}`);
});

await test('I2 — opts omitted: suppressExternalPush defaults to false in each apply call', async () => {
  resetApplyCalls();
  const configs = [makeCronCfg(M6_ID)];
  await runDynamicPricingJob(makeCronPool(configs), async () => {}, null);

  assert.ok(applyCalls.length > 0, 'at least one apply call expected');
  assert.strictEqual(applyCalls[0].suppressExternalPush, false,
    'suppressExternalPush must default to false when opts omitted');
});

await test('I3 — opts omitted: sendPushNotification forwarded unchanged', async () => {
  resetApplyCalls();
  const pushSpy = async () => {};
  const configs = [makeCronCfg(M6_ID)];
  await runDynamicPricingJob(makeCronPool(configs), async () => {}, pushSpy);

  assert.ok(applyCalls.length > 0, 'at least one apply call expected');
  assert.strictEqual(applyCalls[0].sendPushNotification, pushSpy,
    'sendPushNotification must be forwarded unchanged when suppressNotifications not set');
});

// ────────────────────────────────────────────────────────────────────────────
console.log('\n── TEST J: propertyIds no match → safe zero-op ──────────────────────────');

await test('J — propertyIds with no matching config: 0 apply calls, no throw', async () => {
  resetApplyCalls();
  const configs = [makeCronCfg(M6_ID), makeCronCfg(M7_ID)];

  let threw = false;
  try {
    await runDynamicPricingJob(makeCronPool(configs), async () => {}, null, {
      propertyIds: ['non-existent-id'],
      suppressExternalPush: true,
      suppressNotifications: true,
    });
  } catch {
    threw = true;
  }

  assert.strictEqual(threw, false, 'must not throw when propertyIds has no match');
  assert.strictEqual(applyCalls.length, 0, 'no apply calls must occur when no configs match');
});

// ── Summary ────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════════════');
if (failed === 0) {
  console.log(`✅  All ${passed} tests passed\n`);
} else {
  console.log(`❌  ${failed} failed, ${passed} passed`);
  for (const f of failures) console.error(`   • ${f.name}: ${f.message}`);
  process.exit(1);
}

})();
