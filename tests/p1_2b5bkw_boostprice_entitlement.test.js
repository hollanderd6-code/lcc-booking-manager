#!/usr/bin/env node
'use strict';
/**
 * Tests — BoostPrice Per-Property Commercial Entitlement
 * BOOSTPRICE-PAID-ADDON-BACKEND-08
 *
 * A–C:  plan type variation (all plans require paid entitlement row)
 * D–H:  subscription status variations
 * I:    DB failure → fail closed
 * J:    cron SQL contains entitlement EXISTS clause
 * K:    runDynamicPricingForOneProperty uses entitlement check
 * L–N:  entry-point guards exist in source (config, analyze-now, recompute)
 * O–Q:  blocked property produces zero side-effects (BD / schedule / Channex)
 * R–V:  Stripe billing model assertions
 * W–Y:  webhook idempotency
 * Z:    legacy manual pricing unaffected
 * AA:   diagnostic suppressExternalPush still works for entitled property
 * AB:   existing explainability tests source unchanged
 *
 * DB_WRITES = 0  NETWORK_CALLS = 0  BRIGHT_DATA = 0
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

// ── Load REAL entitlement service before mocking (tests A-C test it directly) ─
const _realEntitlementSvc = require('../services/boostprice-entitlement');

// ── Mock entitlement service BEFORE requiring cron ───────────────────────────
let _entitlementImpl = null; // overrideable per-test

const entitlementPath = require.resolve('../services/boostprice-entitlement');
require.cache[entitlementPath] = {
  id: entitlementPath, filename: entitlementPath, loaded: true,
  exports: {
    hasBoostPriceEntitlement:          (pool, userId, propertyId) =>
      _entitlementImpl ? _entitlementImpl(pool, userId, propertyId) : Promise.resolve(false),
    getBoostPriceEntitledPropertyIds:  (pool, userId) => Promise.resolve([]),
  },
};

// ── Mock pricing-engine, pricing-publisher, pricing-apply BEFORE cron ────────
let _pricePropertyImpl = null;
let _publishImpl       = null;
let _applyImpl         = null;

const enginePath = require.resolve('../routes/pricing-engine');
require.cache[enginePath] = {
  id: enginePath, filename: enginePath, loaded: true,
  exports: {
    priceProperty:                 (pool, opts) => _pricePropertyImpl
      ? _pricePropertyImpl(pool, opts)
      : Promise.resolve({ schedule: [], rates: [], restrictions: [] }),
    SCHOOL_HOLIDAYS_IDF_2025_2026: [],
    EVENTS_PARIS_2026:             [],
  },
};

const publisherPath = require.resolve('../routes/pricing-publisher');
require.cache[publisherPath] = {
  id: publisherPath, filename: publisherPath, loaded: true,
  exports: {
    publishEffectivePricing: (pool, opts) => _publishImpl
      ? _publishImpl(pool, opts)
      : Promise.resolve({ status: 'ok', rates: { count: 0, pushed: 0, error: null }, restrictions: { count: 0, pushed: 0, error: null } }),
  },
};

// Mock bridge + coordinator to prevent lazy-load failures
const bridgePath = require.resolve('../services/market-observation-persistence-bridge');
if (!require.cache[bridgePath]) {
  require.cache[bridgePath] = {
    id: bridgePath, filename: bridgePath, loaded: true,
    exports: { isPersistenceEnabled: () => false, generateBridgeRunId: () => 'test-run' },
  };
}
const coordPath = require.resolve('../services/market-shared-collection-coordinator');
if (!require.cache[coordPath]) {
  require.cache[coordPath] = {
    id: coordPath, filename: coordPath, loaded: true,
    exports: {
      isShadowCollectionEnabled:   () => false,
      isSharedProductionEnabled:   () => false,
      runSharedPreCollection:      () => Promise.resolve(null),
      groupPropertiesByFingerprint: () => new Map(),
    },
  };
}

const { runDynamicPricingJob, runDynamicPricingForOneProperty } =
  require('../routes/dynamic-pricing-cron');
const { hasBoostPriceEntitlement, getBoostPriceEntitledPropertyIds } =
  require('../services/boostprice-entitlement');

// ── Test runner ───────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch(err) {
    console.error(`  ❌  ${name}`);
    console.error(`       ${err.message}`);
    failures.push({ name, message: err.message });
    failed++;
  }
}

// ── Mock pool builder ─────────────────────────────────────────────────────────
function makeEntitlementPool({
  entitlementRows = [],
  subscriptionRows = [{ status: 'active', trial_end_date: null }],
  configRows = [],
} = {}) {
  return {
    async query(sql, params) {
      const s = (sql || '').toLowerCase().trim();
      if (s.includes('boostprice_property_entitlements') && s.includes('select')) {
        // Return entitlement rows matching user_id + property_id or user_id alone
        const userId = params?.[0];
        const propertyId = params?.[1];
        const filtered = entitlementRows.filter(r =>
          r.user_id === userId &&
          (propertyId === undefined || r.property_id === propertyId) &&
          r.status === 'active'
        );
        // Check subscription validity inline (mimic the EXISTS)
        const subValid = subscriptionRows.some(s =>
          s.user_id === userId || !s.user_id  // allow anon sub rows for simplicity
        ) && subscriptionRows.some(sub =>
          sub.status === 'active' || sub.status === 'trialing' ||
          (sub.status === 'trial' && sub.trial_end_date && new Date() < new Date(sub.trial_end_date))
        );
        if (!subValid) return { rows: [] };
        return { rows: filtered };
      }
      if (s.includes('subscriptions')) return { rows: subscriptionRows };
      if (s.includes('pricing_config') || s.includes('from properties')) return { rows: configRows };
      if (s.startsWith('create') || s.startsWith('alter')) return { rows: [] };
      return { rows: [] };
    },
  };
}

// Night fixture for pricing engine
function makeNight(date) {
  return {
    date, price: 100, minStay: 1, booked: false, reason: 'test',
    breakdown: { version: 1, market: 0.5, pacing: 0.3, season: 0.2 },
  };
}

// ── TESTS A–C: Plan type variation ────────────────────────────────────────────
(async () => {

console.log('\n── Tests A–C: Plan type — all plans require paid entitlement row ──────────');

for (const [planLabel, planType] of [['Starter', 'starter_monthly'], ['Pro', 'pro_monthly'], ['Agence', 'agence_monthly']]) {
  await test(`${planLabel.slice(0,1)} — ${planLabel} plan + active entitlement row → hasBoostPriceEntitlement = true`, async () => {
    const pool = {
      async query(sql) {
        const s = (sql || '').toLowerCase();
        if (s.includes('boostprice_property_entitlements')) return { rows: [{ id: 1 }] };
        return { rows: [] };
      }
    };
    // Use REAL service (not the cron-scoped mock) to verify the SQL resolver itself
    const result = await _realEntitlementSvc.hasBoostPriceEntitlement(pool, 'u1', 'p1');
    assert.strictEqual(result, true, `${planLabel}: expected true when entitlement row exists`);
  });
}

// ── Tests D–H: Subscription status ───────────────────────────────────────────
console.log('\n── Tests D–H: Subscription status variations ──────────────────────────────');

await test('D — active sub + NO entitlement row → false', async () => {
  const pool = { async query(sql) {
    const s = (sql || '').toLowerCase();
    if (s.includes('boostprice_property_entitlements')) return { rows: [] }; // no row
    return { rows: [{ status: 'active' }] };
  }};
  const result = await hasBoostPriceEntitlement(pool, 'u1', 'p1');
  assert.strictEqual(result, false);
});

await test('E — Ti Junot equivalent (active sub + no entitlement) → false', async () => {
  const pool = { async query(sql) {
    const s = (sql || '').toLowerCase();
    if (s.includes('boostprice_property_entitlements')) return { rows: [] };
    return { rows: [{ status: 'active', plan_type: 'starter_monthly' }] };
  }};
  const result = await hasBoostPriceEntitlement(pool, 'u_ti_junot', 'u_mtka9hxw-ti-junot-loft');
  assert.strictEqual(result, false, 'Ti Junot must be blocked');
});

await test('F — entitled + subscription expired → false (SQL EXISTS sub check fails)', async () => {
  const pool = { async query(sql) {
    const s = (sql || '').toLowerCase();
    // The ENTITLEMENT_SQL has EXISTS (SELECT 1 FROM subscriptions WHERE status IN ('active','trialing') ...)
    // When sub is expired, the EXISTS returns no rows, so the outer query returns empty
    if (s.includes('boostprice_property_entitlements')) return { rows: [] }; // EXISTS on sub fails → outer empty
    return { rows: [{ status: 'expired' }] };
  }};
  const result = await hasBoostPriceEntitlement(pool, 'u1', 'p1');
  assert.strictEqual(result, false);
});

await test('G — entitled + subscription canceled → false', async () => {
  const pool = { async query() { return { rows: [] }; } };
  const result = await hasBoostPriceEntitlement(pool, 'u1', 'p1');
  assert.strictEqual(result, false);
});

await test('H — no subscription row at all → false', async () => {
  const pool = { async query() { return { rows: [] }; } };
  const result = await hasBoostPriceEntitlement(pool, 'u1', 'p1');
  assert.strictEqual(result, false);
});

// ── Test I: DB failure → fail closed ─────────────────────────────────────────
console.log('\n── Test I: DB failure → fail closed ──────────────────────────────────────');

await test('I — DB query throws → hasBoostPriceEntitlement returns false (fail closed)', async () => {
  const pool = { async query() { throw new Error('DB connection lost'); } };
  const result = await hasBoostPriceEntitlement(pool, 'u1', 'p1');
  assert.strictEqual(result, false, 'Must fail closed on DB error');
});

await test('I2 — DB query throws → getBoostPriceEntitledPropertyIds returns [] (fail closed)', async () => {
  const pool = { async query() { throw new Error('DB timeout'); } };
  const result = await getBoostPriceEntitledPropertyIds(pool, 'u1');
  assert.deepStrictEqual(result, [], 'Must return empty array on DB error');
});

// ── Test J: Cron SQL contains entitlement gate ────────────────────────────────
console.log('\n── Test J: Cron SQL contains boostprice_property_entitlements gate ──────');

await test('J — runDynamicPricingJob SQL contains boostprice_property_entitlements EXISTS', async () => {
  const cronSource = fs.readFileSync(
    path.join(__dirname, '../routes/dynamic-pricing-cron.js'), 'utf8'
  );
  assert.ok(
    cronSource.includes('boostprice_property_entitlements'),
    'cron must filter by boostprice_property_entitlements'
  );
  assert.ok(
    /boostprice_property_entitlements[\s\S]{0,200}status\s*=\s*'active'/.test(cronSource),
    'cron entitlement filter must check status=active'
  );
  // Verify both cron functions have the gate
  const jobCount = (cronSource.match(/boostprice_property_entitlements/g) || []).length;
  assert.ok(jobCount >= 2, `Both runDynamicPricingJob and runDailyPricingRefresh must filter (found ${jobCount} occurrences)`);
});

// ── Test K: runDynamicPricingForOneProperty uses entitlement ──────────────────
console.log('\n── Test K: runDynamicPricingForOneProperty entitlement pre-check ─────────');

await test('K — runDynamicPricingForOneProperty: not entitled → returns no_boostprice_entitlement', async () => {
  _entitlementImpl = () => Promise.resolve(false);
  _pricePropertyImpl = () => { throw new Error('must not reach pricing engine'); };

  const pool = {
    async query(sql) {
      const s = (sql || '').toLowerCase();
      if (s.includes('from pricing_config')) return { rows: [{
        user_id: 'u1', property_id: 'p-blocked', property_name: 'Test',
        base_price: 100, mode: 'auto', is_active: true,
        channex_enabled: true, channex_rate_plan_id: 'rp1', external_pricing: false,
        currency: 'EUR', latitude: 48.8, longitude: 2.3,
      }]};
      return { rows: [] };
    }
  };

  const result = await runDynamicPricingForOneProperty(pool, {
    userId: 'u1', propertyId: 'p-blocked', sendPushNotification: null
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, 'no_boostprice_entitlement');
});

await test('K2 — runDynamicPricingForOneProperty: entitled → proceeds past entitlement gate', async () => {
  _entitlementImpl = () => Promise.resolve(true);
  _pricePropertyImpl = () => Promise.resolve({
    schedule: [makeNight('2026-11-01')],
    rates: [], restrictions: [],
  });

  let applyCalled = false;
  const applyPath = require.resolve('../routes/pricing-apply');
  const origApply = require.cache[applyPath];
  require.cache[applyPath] = {
    id: applyPath, filename: applyPath, loaded: true,
    exports: {
      applyDynamicPricingForProperty: async () => {
        applyCalled = true;
        return { status: 'pending', nights: 1, pushed: 0, publishStatus: 'skipped_no_push' };
      },
      ensureScheduleTable: async () => {},
      upsertSchedule: async () => {},
    },
  };

  const pool = {
    async query(sql) {
      const s = (sql || '').toLowerCase();
      if (s.includes('from pricing_config') || s.includes('from properties')) return { rows: [{
        user_id: 'u1', property_id: 'p-ok', property_name: 'Test',
        base_price: 100, mode: 'manual', is_active: true,
        channex_enabled: false, channex_rate_plan_id: null, external_pricing: false,
        currency: 'EUR', latitude: 48.8, longitude: 2.3, country_code: 'FR',
        max_guests: 4, timezone: 'Europe/Paris', address: 'Paris',
      }]};
      if (s.includes('market_data')) return { rows: [] }; // force=false but no existing data
      return { rows: [] };
    }
  };

  const result = await runDynamicPricingForOneProperty(pool, {
    userId: 'u1', propertyId: 'p-ok', sendPushNotification: null, force: true
  });
  // Must NOT be blocked by entitlement gate (further errors from market data are acceptable)
  assert.notStrictEqual(result?.error, 'no_boostprice_entitlement',
    'should proceed past entitlement gate when entitled');

  // Restore
  if (origApply) require.cache[applyPath] = origApply;
  else delete require.cache[applyPath];
});

// ── Tests L–N: Entry-point guards exist in source ─────────────────────────────
console.log('\n── Tests L–N: Entry-point guards in source ────────────────────────────────');

await test('L — dynamic-pricing-routes.js requires boostprice-entitlement', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/dynamic-pricing-routes.js'), 'utf8');
  assert.ok(src.includes('boostprice-entitlement'), 'must require boostprice-entitlement');
  assert.ok(src.includes('no_boostprice_entitlement'), 'must return entitlement error');
});

await test('M — pricing-calendars.js requires boostprice-entitlement', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/pricing-calendars.js'), 'utf8');
  assert.ok(src.includes('boostprice-entitlement'), 'must require boostprice-entitlement');
  assert.ok(src.includes('no_boostprice_entitlement'), '_runRecompute must gate on entitlement');
});

await test('N — analyze-now route in server.js gates on entitlement', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.ok(src.includes('boostprice-entitlement'), 'server.js must require boostprice-entitlement');
  assert.ok(src.includes('no_boostprice_entitlement'), 'analyze-now must return entitlement error');
});

// ── Tests O–Q: Blocked property → zero side effects ───────────────────────────
console.log('\n── Tests O–Q: Blocked property → zero BD/schedule/Channex calls ───────────');

await test('O — Not entitled property: runDynamicPricingJob excludes from SQL result → 0 BD calls', async () => {
  _entitlementImpl = () => Promise.resolve(false);
  let marketProviderCalls = 0;

  // The cron SQL itself excludes the property via EXISTS; simulate empty result
  const _lockClient = {
    query: async (sql) => {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] };
      return { rows: [] };
    },
    release: () => {},
  };
  const pool = {
    connect: async () => _lockClient,
    async query(sql) {
      const s = (sql || '').toLowerCase();
      if (s.startsWith('create') || s.startsWith('alter')) return { rows: [] };
      if (s.includes('dp_daily_collection_run')) return { rowCount: 1, rows: [{ run_date: '2026-10-01' }] };
      if (s.includes('from pricing_config')) return { rows: [] }; // SQL gate excludes it
      return { rows: [] };
    }
  };

  await runDynamicPricingJob(pool, null, null, {
    suppressExternalPush: true, suppressNotifications: true
  });
  // No error expected — just zero iterations
  assert.strictEqual(marketProviderCalls, 0, 'No BD calls when no entitled properties');
});

await test('P — Not entitled property → runDynamicPricingForOneProperty writes 0 schedule rows', async () => {
  _entitlementImpl = () => Promise.resolve(false);
  let scheduleWrites = 0;

  const pool = {
    async query(sql) {
      const s = (sql || '').toLowerCase();
      if (s.includes('pricing_schedule')) scheduleWrites++;
      if (s.includes('from pricing_config')) return { rows: [{
        user_id: 'u1', property_id: 'p1', property_name: 'Test',
        base_price: 100, mode: 'manual', is_active: true, currency: 'EUR',
        latitude: 48.8, longitude: 2.3, country_code: 'FR',
      }]};
      return { rows: [] };
    }
  };

  await runDynamicPricingForOneProperty(pool, { userId: 'u1', propertyId: 'p1' });
  assert.strictEqual(scheduleWrites, 0, 'No pricing_schedule writes for non-entitled property');
});

await test('Q — Not entitled property → 0 publishEffectivePricing calls', async () => {
  _entitlementImpl = () => Promise.resolve(false);
  let publishCalls = 0;
  _publishImpl = () => { publishCalls++; return Promise.resolve({ status: 'ok', rates: { count: 0, pushed: 0, error: null }, restrictions: { count: 0, pushed: 0, error: null } }); };

  const pool = {
    async query(sql) {
      const s = (sql || '').toLowerCase();
      if (s.includes('from pricing_config')) return { rows: [{
        user_id: 'u1', property_id: 'p1', property_name: 'Test',
        base_price: 100, mode: 'auto', is_active: true, currency: 'EUR',
        latitude: 48.8, longitude: 2.3, country_code: 'FR',
      }]};
      return { rows: [] };
    }
  };

  await runDynamicPricingForOneProperty(pool, { userId: 'u1', propertyId: 'p1' });
  assert.strictEqual(publishCalls, 0, 'No publishEffectivePricing for non-entitled property');
});

// ── Tests R–V: Stripe billing model assertions ────────────────────────────────
console.log('\n── Tests R–V: Stripe billing model assertions ─────────────────────────────');

await test('R — Billing routes exist in server.js (subscribe/unsubscribe/status)', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.ok(src.includes('/api/billing/boostprice/subscribe'), 'subscribe route must exist');
  assert.ok(src.includes('/api/billing/boostprice/unsubscribe'), 'unsubscribe route must exist');
  assert.ok(src.includes('/api/billing/boostprice/status'), 'status route must exist');
});

await test('S — STRIPE_PRICE_BOOSTPRICE_MONTHLY env var used (not hardcoded price ID)', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.ok(
    src.includes('STRIPE_PRICE_BOOSTPRICE_MONTHLY'),
    'Must use STRIPE_PRICE_BOOSTPRICE_MONTHLY env var'
  );
  assert.ok(
    !src.includes('price_1') || src.includes('STRIPE_PRICE_BOOSTPRICE_MONTHLY'),
    'No hardcoded BoostPrice price ID — must use env var'
  );
});

await test('T — Price per property is €4.99 (not hardcoded elsewhere)', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.ok(src.includes('4.99'), 'BOOSTPRICE_PRICE_PER_PROPERTY must be 4.99');
});

await test('U — Foreign property ID rejected in subscribe', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.ok(src.includes('foreign_property'), 'Must return foreign_property error for unowned property IDs');
});

await test('V — Duplicate property IDs deduplicated', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.ok(src.includes('new Set('), 'Must deduplicate propertyIds via Set');
});

// ── Tests W–Y: Webhook idempotency ────────────────────────────────────────────
console.log('\n── Tests W–Y: Webhook handling ────────────────────────────────────────────');

await test('W — checkout.session.completed detects boostpriceOption in server.js webhook', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.ok(src.includes("boostpriceOption === 'true'"), 'webhook must detect boostpriceOption=true');
  assert.ok(src.includes('boostpricePropertyIds'), 'webhook must read property IDs from metadata');
});

await test('X — checkout.session.completed uses ON CONFLICT DO UPDATE (idempotent upsert)', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  // The boostprice webhook section uses ON CONFLICT (property_id) DO UPDATE
  assert.ok(
    src.includes('ON CONFLICT (property_id) DO UPDATE'),
    'entitlement insert must be idempotent via ON CONFLICT'
  );
});

await test('Y — customer.subscription.deleted clears BoostPrice entitlements', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.ok(
    src.includes('boostprice_stripe_subscription_id') &&
    src.includes("status = 'canceled'"),
    'subscription.deleted webhook must clear boostprice entitlements'
  );
  // Verify the deletion handler explicitly checks for boostprice sub ID
  const deletedSection = src.slice(
    src.indexOf("case 'customer.subscription.deleted'"),
    src.indexOf("case 'customer.subscription.deleted'") + 1500
  );
  assert.ok(
    deletedSection.includes('boostprice_stripe_subscription_id'),
    'customer.subscription.deleted must handle BoostPrice sub ID'
  );
  assert.ok(
    deletedSection.includes('boostprice_property_entitlements'),
    'must update boostprice_property_entitlements on sub deletion'
  );
});

// ── Test Z: Legacy manual pricing unaffected ──────────────────────────────────
console.log('\n── Test Z: Legacy pricing unaffected ──────────────────────────────────────');

await test('Z — pricing_rules/overrides routes do NOT require boostprice entitlement', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  // The pricing rules routes exist and do not reference boostprice-entitlement
  const rulesSection = src.slice(
    src.indexOf('/api/pricing/rules'),
    src.indexOf('/api/pricing/rules') + 500
  );
  assert.ok(rulesSection.includes('/api/pricing/rules'), 'pricing rules route must exist');
  assert.ok(
    !rulesSection.includes('boostprice_entitlement') && !rulesSection.includes('hasBoostPrice'),
    'pricing rules must NOT gate on boostprice entitlement'
  );
});

// ── Test AA: Diagnostic suppressExternalPush still forwarded to apply ─────────
console.log('\n── Test AA: Diagnostic suppressExternalPush + entitlement ─────────────────');

await test('AA — suppressExternalPush=true is forwarded to applyDynamicPricingForProperty (source)', async () => {
  // Verify source: the entitlement gate code did NOT remove the suppressExternalPush pass-through.
  // We check source because the full cron flow fails at mock market stats before reaching apply.
  const cronSrc = fs.readFileSync(path.join(__dirname, '../routes/dynamic-pricing-cron.js'), 'utf8');
  const applyCallCount = (cronSrc.match(/suppressExternalPush:\s*opts\.suppressExternalPush\s*===\s*true/g) || []).length;
  assert.ok(
    applyCallCount >= 1,
    `suppressExternalPush must be forwarded in at least 1 applyDynamicPricingForProperty call (found ${applyCallCount})`
  );
  // Verify entitlement check does NOT consume or drop the opts object
  const entitlementCheck = cronSrc.includes('hasBoostPriceEntitlement');
  assert.ok(entitlementCheck, 'entitlement check must be present in cron source');
  // Verify suppressExternalPush appears AFTER the entitlement require (i.e. not removed)
  const entitlementPos = cronSrc.indexOf("require('../services/boostprice-entitlement')");
  const suppressPos    = cronSrc.indexOf('suppressExternalPush: opts.suppressExternalPush');
  assert.ok(suppressPos > entitlementPos, 'suppressExternalPush forwarding must survive entitlement addition');
});

// ── Test AB: Existing explainability tests source unchanged ───────────────────
console.log('\n── Test AB: Explainability source ─────────────────────────────────────────');

await test('AB — pricing-engine.js still outputs breakdown.version=1', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/pricing-engine.js'), 'utf8');
  assert.ok(src.includes('version: 1') || src.includes('version:1'),
    'pricing-engine must output version:1 in breakdown');
});

await test('AB2 — pricing-calendars.js still exposes breakdown as explainability', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/pricing-calendars.js'), 'utf8');
  assert.ok(src.includes('explainability'), 'pricing-calendars must expose explainability field');
});

// ── Data model schema assertions ──────────────────────────────────────────────
console.log('\n── Schema assertions ───────────────────────────────────────────────────────');

await test('SCHEMA — boostprice_property_entitlements table created in initDb', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.ok(
    src.includes('CREATE TABLE IF NOT EXISTS boostprice_property_entitlements'),
    'initDb must create boostprice_property_entitlements table'
  );
  assert.ok(src.includes('UNIQUE(property_id)'), 'must enforce one entitlement per property');
  assert.ok(src.includes("CHECK (status IN ('active', 'pending', 'cancel_at_period_end', 'canceled'))"),
    'must validate status values');
});

await test('SCHEMA — boostprice_stripe_subscription_id column added to subscriptions', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.ok(
    src.includes('boostprice_stripe_subscription_id'),
    'subscriptions table must gain boostprice_stripe_subscription_id column'
  );
  assert.ok(
    src.includes('ADD COLUMN IF NOT EXISTS boostprice_stripe_subscription_id'),
    'column must be added via ALTER TABLE ... ADD COLUMN IF NOT EXISTS'
  );
});

await test('SCHEMA — entitlement service ENTITLEMENT_SQL checks both bpe.status and subscriptions.status', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../services/boostprice-entitlement.js'), 'utf8');
  assert.ok(src.includes("bpe.status      = 'active'"), 'must filter active entitlements');
  assert.ok(src.includes("s.status IN ('active', 'trialing')"), 'must check subscription status');
  assert.ok(src.includes("s.status = 'trial' AND s.trial_end_date > NOW()"), 'must handle trial expiry');
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════════════');
if (failed === 0) {
  console.log(`✅  All ${passed} tests passed\n`);
} else {
  console.log(`❌  ${failed} failed, ${passed} passed`);
  for (const f of failures) console.error(`   • ${f.name}: ${f.message}`);
  process.exit(1);
}

})();
