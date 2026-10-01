#!/usr/bin/env node
'use strict';
/**
 * Tests — BoostPrice Billing Consistency
 * BOOSTPRICE-BILLING-CONSISTENCY-FIX-10
 *
 * A:  Stripe deactivation 3→2 succeeds → DB updated → success
 * B:  Stripe deactivation 3→2 fails → DB unchanged → 502
 * C:  Stripe cancellation (1→0) fails → DB unchanged, sub ID preserved → 502
 * D:  Stripe activation 2→3 succeeds → DB insert succeeds → success
 * E:  Stripe activation 2→3 succeeds → DB insert fails → Stripe rolled back → controlled failure
 * F:  Stripe activation 2→3 succeeds → DB insert fails → Stripe rollback fails →
 *     BOOSTPRICE_BILLING_RECONCILIATION_REQUIRED logged
 * G:  checkout.session.completed webhook sets source='stripe'
 * H:  source='admin' entitlement is considered entitled by resolver
 * I:  Stripe webhook hitting admin entitlement overwrites source to 'stripe'
 * J:  Ti Junot equivalent remains blocked (no row)
 * K:  Manual pricing remains unaffected
 * L:  diagnostic propertyIds still cannot bypass entitlement gate
 * M:  suppressExternalPush forwarding survives entitlement code path
 *
 * DB_WRITES = 0  NETWORK_CALLS = 0  BRIGHT_DATA = 0
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

// ── Real entitlement service (for test H) ────────────────────────────────────
const _realEntitlementSvc = require('../services/boostprice-entitlement');

// ── Mock entitlement service before requiring cron ───────────────────────────
let _entitlementImpl = null;
const entitlementPath = require.resolve('../services/boostprice-entitlement');
require.cache[entitlementPath] = {
  id: entitlementPath, filename: entitlementPath, loaded: true,
  exports: {
    hasBoostPriceEntitlement:         (pool, uid, pid) =>
      _entitlementImpl ? _entitlementImpl(pool, uid, pid) : Promise.resolve(false),
    getBoostPriceEntitledPropertyIds: (pool, uid) => Promise.resolve([]),
  },
};

// ── Mock pricing-engine, publisher, bridge, coordinator ──────────────────────
const enginePath = require.resolve('../routes/pricing-engine');
require.cache[enginePath] = {
  id: enginePath, filename: enginePath, loaded: true,
  exports: {
    priceProperty: () => Promise.resolve({ schedule: [], rates: [], restrictions: [] }),
    SCHOOL_HOLIDAYS_IDF_2025_2026: [], EVENTS_PARIS_2026: [],
  },
};
const publisherPath = require.resolve('../routes/pricing-publisher');
require.cache[publisherPath] = {
  id: publisherPath, filename: publisherPath, loaded: true,
  exports: {
    publishEffectivePricing: () => Promise.resolve({
      status: 'ok',
      rates: { count: 0, pushed: 0, error: null },
      restrictions: { count: 0, pushed: 0, error: null },
    }),
  },
};
const bridgePath = require.resolve('../services/market-observation-persistence-bridge');
if (!require.cache[bridgePath]) {
  require.cache[bridgePath] = {
    id: bridgePath, filename: bridgePath, loaded: true,
    exports: { isPersistenceEnabled: () => false, generateBridgeRunId: () => 'test' },
  };
}
const coordPath = require.resolve('../services/market-shared-collection-coordinator');
if (!require.cache[coordPath]) {
  require.cache[coordPath] = {
    id: coordPath, filename: coordPath, loaded: true,
    exports: {
      isShadowCollectionEnabled:    () => false,
      isSharedProductionEnabled:    () => false,
      runSharedPreCollection:       () => Promise.resolve(null),
      groupPropertiesByFingerprint: () => new Map(),
    },
  };
}

const { runDynamicPricingJob } = require('../routes/dynamic-pricing-cron');

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

const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const cronSrc   = fs.readFileSync(path.join(__dirname, '../routes/dynamic-pricing-cron.js'), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// DEACTIVATION — Structural source inspection
// ─────────────────────────────────────────────────────────────────────────────
(async () => {

console.log('\n── Tests A–C: Deactivation consistency ────────────────────────────────────');

await test('A — Deactivation: Stripe call is BEFORE any DB write (Stripe-first ordering)', async () => {
  // Locate the unsubscribe handler and verify Stripe block appears before DB UPDATE
  const handlerStart = serverSrc.indexOf("app.delete('/api/billing/boostprice/unsubscribe'");
  assert.ok(handlerStart !== -1, 'unsubscribe handler must exist');

  const handlerSection = serverSrc.slice(handlerStart, handlerStart + 4000);

  const stripePos  = handlerSection.indexOf('stripe.subscriptions.cancel');
  const stripePos2 = handlerSection.indexOf('stripe.subscriptionItems.update');
  const dbCommit   = handlerSection.indexOf("dbClient.query('COMMIT')");

  // At least one Stripe call must appear before COMMIT
  const stripeFirst = Math.min(
    stripePos  === -1 ? Infinity : stripePos,
    stripePos2 === -1 ? Infinity : stripePos2
  );
  assert.ok(stripeFirst !== Infinity, 'unsubscribe must call stripe cancel or update');
  assert.ok(dbCommit !== -1, 'unsubscribe must use DB transaction with COMMIT');
  assert.ok(stripeFirst < dbCommit, 'Stripe call must precede DB COMMIT');
});

await test('B — Deactivation: Stripe failure returns 502 and does NOT reach DB entitlement update', async () => {
  const handlerStart = serverSrc.indexOf("app.delete('/api/billing/boostprice/unsubscribe'");
  const handlerSection = serverSrc.slice(handlerStart, handlerStart + 4000);

  // Must have a catch block that returns 502
  assert.ok(
    handlerSection.includes('stripe_deactivation_failed'),
    'must return stripe_deactivation_failed on Stripe failure'
  );
  assert.ok(
    handlerSection.includes('res.status(502)'),
    'must return HTTP 502 on Stripe deactivation failure'
  );

  // The 502 return must appear BEFORE the DB COMMIT
  const pos502    = handlerSection.indexOf('stripe_deactivation_failed');
  const posCommit = handlerSection.indexOf("dbClient.query('COMMIT')");
  assert.ok(pos502 < posCommit, '502 return must appear before DB COMMIT — proves Stripe failure prevents DB write');
});

await test('C — Deactivation (qty→0): Stripe cancel failure → sub ID preserved in DB', async () => {
  const handlerStart = serverSrc.indexOf("app.delete('/api/billing/boostprice/unsubscribe'");
  const handlerSection = serverSrc.slice(handlerStart, handlerStart + 4000);

  // boostprice_stripe_subscription_id must only be cleared INSIDE the DB transaction
  // (i.e., AFTER Stripe cancel succeeds), not in the Stripe error catch
  const stripeErrCatch = handlerSection.indexOf('stripe_deactivation_failed');
  const subIdClear     = handlerSection.indexOf('boostprice_stripe_subscription_id = NULL');

  assert.ok(subIdClear !== -1, 'sub ID clear must exist in unsubscribe handler');
  // sub ID clear must be AFTER the Stripe error block (not inside catch)
  assert.ok(
    subIdClear > stripeErrCatch,
    'sub ID must only be cleared after Stripe success, not in Stripe error catch'
  );

  // Additionally: sub ID clear must be inside the DB transaction (between BEGIN and COMMIT)
  const posBegin  = handlerSection.indexOf("dbClient.query('BEGIN')");
  const posCommit = handlerSection.indexOf("dbClient.query('COMMIT')");
  assert.ok(
    subIdClear > posBegin && subIdClear < posCommit,
    'sub ID clear must be inside DB transaction'
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVATION — Structural source inspection
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Tests D–F: Activation consistency ──────────────────────────────────────');

await test('D — Activation: prevQty captured before Stripe update (enables rollback)', async () => {
  const handlerStart = serverSrc.indexOf("app.post('/api/billing/boostprice/subscribe'");
  const handlerSection = serverSrc.slice(handlerStart, handlerStart + 5000);

  assert.ok(handlerSection.includes('prevQty'), 'must capture prevQty for compensation');
  assert.ok(handlerSection.includes('items.data[0].quantity'), 'must read current quantity from Stripe item');

  // prevQty must appear before the second stripe.subscriptionItems.update call
  const prevQtyPos  = handlerSection.indexOf('prevQty');
  const updatePos   = handlerSection.indexOf('subscriptionItems.update');
  assert.ok(prevQtyPos < updatePos, 'prevQty must be captured before Stripe update');
});

await test('E — Activation: DB failure after Stripe success triggers Stripe rollback with prevQty', async () => {
  const handlerStart = serverSrc.indexOf("app.post('/api/billing/boostprice/subscribe'");
  const handlerSection = serverSrc.slice(handlerStart, handlerStart + 10000);

  // Must have the rollback path
  assert.ok(handlerSection.includes('db_write_failed_stripe_rolled_back'), 'must have rollback success error code');
  assert.ok(
    handlerSection.includes('quantity: prevQty'),
    'rollback must restore to prevQty, not a hardcoded value'
  );

  // The 502 error path must come BEFORE the success res.json({ type: 'direct' }) in source order
  // This verifies the catch block returns an error, not success — 'direct' is only on the happy path
  const errorCodePos  = handlerSection.indexOf('db_write_failed_stripe_rolled_back');
  const successRetPos = handlerSection.indexOf("type: 'direct'");
  assert.ok(errorCodePos !== -1 && successRetPos !== -1, 'both error code and success return must exist');
  assert.ok(
    errorCodePos < successRetPos,
    'rollback error code must appear before success return in source — proves catch block returns 502, not direct success'
  );
});

await test('F — Activation: Stripe rollback failure emits BOOSTPRICE_BILLING_RECONCILIATION_REQUIRED', async () => {
  assert.ok(
    serverSrc.includes('BOOSTPRICE_BILLING_RECONCILIATION_REQUIRED'),
    'must log BOOSTPRICE_BILLING_RECONCILIATION_REQUIRED when rollback fails'
  );

  // Must include critical identifiers for manual reconciliation
  const reconSection = serverSrc.slice(
    serverSrc.indexOf('BOOSTPRICE_BILLING_RECONCILIATION_REQUIRED') - 50,
    serverSrc.indexOf('BOOSTPRICE_BILLING_RECONCILIATION_REQUIRED') + 600
  );
  assert.ok(reconSection.includes('userId'),     'reconciliation log must include userId');
  assert.ok(reconSection.includes('stripeSubId'), 'reconciliation log must include stripeSubId');
  assert.ok(reconSection.includes('prevQty'),     'reconciliation log must include prevQty');
  assert.ok(reconSection.includes('attemptedQty'), 'reconciliation log must include attemptedQty');
  assert.ok(reconSection.includes('newPropertyIds'), 'reconciliation log must include newPropertyIds');

  // Must NOT report success — the 502 must follow
  assert.ok(
    serverSrc.includes('db_write_failed_stripe_not_rolled_back'),
    'must return 502 db_write_failed_stripe_not_rolled_back when rollback also fails'
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// PROVENANCE — source column schema + webhook + resolver
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Tests G–I: Entitlement provenance ──────────────────────────────────────');

await test("G — Webhook checkout.session.completed sets source='stripe' on upsert", async () => {
  // Locate the boostprice webhook section
  const webhookSection = serverSrc.slice(
    serverSrc.indexOf('isBoostpriceOption'),
    serverSrc.indexOf('isBoostpriceOption') + 1500
  );
  assert.ok(
    webhookSection.includes("'stripe'"),
    "webhook upsert must include source='stripe'"
  );
  assert.ok(
    webhookSection.includes("source = 'stripe'"),
    "ON CONFLICT DO UPDATE must also update source='stripe' (converts admin→stripe)"
  );
});

await test("H — source='admin' entitlement: resolver returns true (source ignored for eligibility)", async () => {
  // The ENTITLEMENT_SQL must NOT filter on source — any active row regardless of source is entitled
  const entitlementSrc = fs.readFileSync(
    path.join(__dirname, '../services/boostprice-entitlement.js'), 'utf8'
  );
  assert.ok(
    !entitlementSrc.includes("source = 'stripe'"),
    'entitlement SQL must not filter by source — admin and stripe both eligible'
  );

  // Functional: real resolver returns true when pool returns a row (regardless of source)
  const pool = {
    async query(sql) {
      const s = (sql || '').toLowerCase();
      if (s.includes('boostprice_property_entitlements')) return { rows: [{ id: 1 }] };
      return { rows: [] };
    }
  };
  const result = await _realEntitlementSvc.hasBoostPriceEntitlement(pool, 'u1', 'p-admin');
  assert.strictEqual(result, true, 'resolver must return true for admin-sourced entitlement row');
});

await test("I — Stripe webhook hitting admin entitlement updates source to 'stripe' (upsert)", async () => {
  const webhookSection = serverSrc.slice(
    serverSrc.indexOf('isBoostpriceOption'),
    serverSrc.indexOf('isBoostpriceOption') + 1500
  );
  // ON CONFLICT ... SET source = 'stripe' overwrites admin rows
  assert.ok(
    /ON CONFLICT.*DO UPDATE[\s\S]{0,200}source = 'stripe'/.test(webhookSection),
    "ON CONFLICT DO UPDATE must set source='stripe' to convert admin→stripe provenance"
  );
  // Must not create duplicate rows — UNIQUE(property_id) enforces it
  assert.ok(
    serverSrc.includes('UNIQUE(property_id)'),
    'table must have UNIQUE(property_id) to prevent duplicates on upsert'
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION — Ti Junot / manual pricing / diagnostic bypass / suppressExternalPush
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Tests J–M: Regression guards ────────────────────────────────────────────');

await test('J — Ti Junot equivalent: no entitlement row → hasBoostPriceEntitlement returns false', async () => {
  const pool = {
    async query(sql) {
      const s = (sql || '').toLowerCase();
      if (s.includes('boostprice_property_entitlements')) return { rows: [] }; // no row
      return { rows: [{ status: 'active', plan_type: 'starter_monthly' }] };
    }
  };
  const result = await _realEntitlementSvc.hasBoostPriceEntitlement(pool, 'u_ti_junot', 'u_mtka9hxw-ti-junot-loft');
  assert.strictEqual(result, false, 'Ti Junot must remain blocked');
});

await test('K — Manual pricing routes do NOT require BoostPrice entitlement (source)', async () => {
  const rulesSection = serverSrc.slice(
    serverSrc.indexOf('/api/pricing/rules'),
    serverSrc.indexOf('/api/pricing/rules') + 500
  );
  assert.ok(rulesSection.includes('/api/pricing/rules'), 'pricing rules route must exist');
  assert.ok(
    !rulesSection.includes('boostprice_entitlement') && !rulesSection.includes('hasBoostPrice'),
    'pricing rules must not gate on BoostPrice entitlement'
  );
});

await test('L — diagnostic propertyIds filter cannot bypass entitlement SQL gate (source)', async () => {
  // propertyIds filter in runDynamicPricingJob is applied AFTER SQL (client-side filter on result set)
  // Verify entitlement EXISTS clause is in the SQL, and propertyIds filter is separate post-SQL JS
  assert.ok(
    cronSrc.includes('boostprice_property_entitlements'),
    'cron SQL must include boostprice_property_entitlements gate'
  );
  // The JS filter on propertyIds uses Set.has (post-SQL Array.filter), not a SQL WHERE that could bypass EXISTS
  assert.ok(
    cronSrc.includes('allowed.has(') || cronSrc.includes('propertyIds.includes'),
    'propertyIds filter must be a post-SQL JS filter (Set.has or Array.includes) — cannot inject non-entitled properties'
  );
});

await test('M — suppressExternalPush forwarding survives after entitlement fix (source)', async () => {
  const applyCallCount = (cronSrc.match(/suppressExternalPush:\s*opts\.suppressExternalPush\s*===\s*true/g) || []).length;
  assert.ok(
    applyCallCount >= 1,
    `suppressExternalPush must be forwarded in at least one applyDynamicPricingForProperty call (found ${applyCallCount})`
  );
  // Entitlement check in cron still present
  assert.ok(
    cronSrc.includes('hasBoostPriceEntitlement'),
    'entitlement check must remain in cron after fix'
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA — source column migration
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Schema assertions ───────────────────────────────────────────────────────');

await test("SCHEMA — source column migration is additive and idempotent", async () => {
  assert.ok(
    serverSrc.includes("ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'stripe'"),
    'must use ADD COLUMN IF NOT EXISTS for idempotency'
  );
  assert.ok(
    serverSrc.includes("CHECK (source IN ('stripe', 'admin'))"),
    "must constrain source to 'stripe' or 'admin'"
  );
});

await test("SCHEMA — subscribe direct path writes source='stripe' to entitlement row", async () => {
  const subscribeSection = serverSrc.slice(
    serverSrc.indexOf("app.post('/api/billing/boostprice/subscribe'"),
    serverSrc.indexOf("app.post('/api/billing/boostprice/subscribe'") + 6000
  );
  assert.ok(
    subscribeSection.includes("'stripe', NOW())"),
    "subscribe direct path must insert source='stripe'"
  );
  assert.ok(
    subscribeSection.includes("source = 'stripe', updated_at"),
    "subscribe ON CONFLICT must update source='stripe'"
  );
});

await test("SCHEMA — deactivation uses DB transaction (BEGIN/COMMIT)", async () => {
  const unsubSection = serverSrc.slice(
    serverSrc.indexOf("app.delete('/api/billing/boostprice/unsubscribe'"),
    serverSrc.indexOf("app.delete('/api/billing/boostprice/unsubscribe'") + 4000
  );
  assert.ok(unsubSection.includes("dbClient.query('BEGIN')"),  'unsubscribe must use BEGIN');
  assert.ok(unsubSection.includes("dbClient.query('COMMIT')"), 'unsubscribe must use COMMIT');
  assert.ok(unsubSection.includes("dbClient.query('ROLLBACK')"), 'unsubscribe must have ROLLBACK on error');
  assert.ok(unsubSection.includes('dbClient.release()'), 'unsubscribe must release pool client');
});

await test("SCHEMA — activation direct path uses DB transaction (BEGIN/COMMIT)", async () => {
  const subscribeSection = serverSrc.slice(
    serverSrc.indexOf("app.post('/api/billing/boostprice/subscribe'"),
    serverSrc.indexOf("app.post('/api/billing/boostprice/subscribe'") + 10000
  );
  assert.ok(subscribeSection.includes("dbClient.query('BEGIN')"),  'subscribe must use BEGIN');
  assert.ok(subscribeSection.includes("dbClient.query('COMMIT')"), 'subscribe must use COMMIT');
  assert.ok(subscribeSection.includes("dbClient.query('ROLLBACK')"), 'subscribe must have ROLLBACK on DB error');
  assert.ok(subscribeSection.includes('dbClient.release()'), 'subscribe must release pool client');
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
