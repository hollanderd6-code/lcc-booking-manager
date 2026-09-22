#!/usr/bin/env node
'use strict';
/**
 * P0-C4.1f — Canonical access scope for BoostPrice read/action routes
 *
 * Vérifie que toutes les routes BoostPrice autres que POST /config
 * utilisent le scope canonique :
 *   ACTOR       = utilisateur authentifié (owner, delegate, sub_account)
 *   PRICING OWNER = properties.user_id
 *   CONFIG VISIBLE = config canonique du propriétaire (pc.user_id = p.user_id)
 *
 * Couverture :
 *   TC-F01 : GET dashboard — owner voit ses configs canoniques
 *   TC-F02 : GET dashboard — delegate voit la config de l'owner (pas la sienne orpheline)
 *   TC-F03 : GET dashboard — user sans accès → liste vide (pas 403)
 *   TC-F04 : GET config — owner voit ses configs canoniques
 *   TC-F05 : GET config — delegate voit la config de l'owner
 *   TC-F06 : GET config — sub_account voit la config de son parent owner
 *   TC-F07 : POST decision — owner accepte sa suggestion → applied_by = owner
 *   TC-F08 : POST decision — delegate accepte la suggestion owner → applied_by = delegate
 *   TC-F09 : POST decision — user sans accès → 404
 *   TC-F10 : POST decision — suggestion inexistante → 404
 *   TC-F11 : GET history — owner voit l'historique canonique
 *   TC-F12 : GET history — delegate voit l'historique de l'owner (pas orphelin)
 *   TC-F13 : GET market — owner accède aux données de son logement
 *   TC-F14 : GET market — delegate accède aux données du logement de l'owner
 *   TC-F15 : GET market — user sans accès → 403
 *   TC-F16 : requirePermission présent sur les routes (inspection structurelle)
 *
 * Exécution : node tests/c4_1f_access_scope.test.js
 * Aucun appel DB réel.
 */

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');

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

// ── Handler capture ────────────────────────────────────────────────────────────

const { setupDynamicPricingRoutes } = require('../routes/dynamic-pricing-routes');

function captureHandlers(pool) {
  const handlers = {};
  const mockApp = {
    get:   (path, ...mws) => { handlers['GET:' + path]   = mws[mws.length - 1]; },
    post:  (path, ...mws) => { handlers['POST:' + path]  = mws[mws.length - 1]; },
    patch: (path, ...mws) => { handlers['PATCH:' + path] = mws[mws.length - 1]; },
  };
  setupDynamicPricingRoutes(mockApp, pool, () => {});
  return handlers;
}

// ── Mock pool factory ──────────────────────────────────────────────────────────
//
// properties: { [propId]: { user_id, delegates: [userId, ...] } }
// pricingConfigs: [{ user_id, property_id, mode, is_active, price_min, price_max }]
// pricingHistory: [{ id, user_id, property_id, week_start, status, price_before, price_calculated, ... }]
// subAccounts: { [subAccountId]: { parent_user_id } }
// marketData: [{ property_id, week_start, ... }]
// onUpdate: cb(sql, params)

function makeMockPool({
  properties = {},
  pricingConfigs = [],
  pricingHistory = [],
  subAccounts = {},
  marketData = [],
  onUpdate = null,
} = {}) {
  return {
    async query(sql, params = []) {
      const s = sql.toLowerCase().replace(/\s+/g, ' ').trim();

      // Sub_account lookup
      if (s.includes('from sub_accounts')) {
        const sa = subAccounts[params[0]];
        return { rows: sa ? [{ parent_user_id: sa.parent_user_id }] : [] };
      }

      // Canonical config read (JOIN properties p ON p.user_id = pc.user_id)
      if (s.includes('from pricing_config pc') && s.includes('join properties p on') && s.includes('pc.user_id') && !s.includes('update')) {
        const callerId = params[0];
        const filtered = pricingConfigs.filter(pc => {
          const prop = properties[pc.property_id];
          if (!prop) return false;
          if (prop.user_id !== pc.user_id) return false; // only canonical
          return prop.user_id === callerId || (prop.delegates || []).includes(callerId);
        });
        return { rows: filtered.map(pc => ({
          ...pc,
          property_name: properties[pc.property_id]?.name || pc.property_id,
          address: '',
        })) };
      }

      // History single row lookup for decision — must come BEFORE generic history read
      // (decision SQL also joins pricing_config pc; history read does not)
      if (s.includes('from pricing_history ph') && s.includes('join pricing_config pc') && s.includes('join properties p')) {
        const histId   = params[0];
        const callerId = params[1];
        const ph = pricingHistory.find(h => h.id === histId && h.status === 'pending');
        if (!ph) return { rows: [] };
        const prop = properties[ph.property_id];
        if (!prop || prop.user_id !== ph.user_id) return { rows: [] };
        const hasAccess = prop.user_id === callerId || (prop.delegates || []).includes(callerId);
        if (!hasAccess) return { rows: [] };
        const pc = pricingConfigs.find(c => c.property_id === ph.property_id && c.user_id === ph.user_id);
        return { rows: [{ ...ph, price_min: pc?.price_min || 50, price_max: pc?.price_max || 300, mode: pc?.mode || 'manual' }] };
      }

      // Canonical history read (no pricing_config join, only properties join for canonical filter)
      if (s.includes('from pricing_history ph') && s.includes('join properties p') && !s.includes('join pricing_config') && !s.includes('count(*)')) {
        const callerId = params[0];
        const filtered = pricingHistory.filter(ph => {
          const prop = properties[ph.property_id];
          if (!prop) return false;
          if (prop.user_id !== ph.user_id) return false; // canonical only
          return prop.user_id === callerId || (prop.delegates || []).includes(callerId);
        });
        return { rows: filtered.map(ph => ({
          ...ph,
          property_name: properties[ph.property_id]?.name || ph.property_id,
        })) };
      }

      // Count for history pagination
      if (s.includes('count(*)') && s.includes('from pricing_history ph') && s.includes('join properties p')) {
        const callerId = params[0];
        const count = pricingHistory.filter(ph => {
          const prop = properties[ph.property_id];
          if (!prop || prop.user_id !== ph.user_id) return false;
          return prop.user_id === callerId || (prop.delegates || []).includes(callerId);
        }).length;
        return { rows: [{ total: count }] };
      }

      // Property access check (market route)
      if (s.includes('from properties') && s.includes('account_delegations') && !s.includes('pricing_config')) {
        const propId   = params[0];
        const callerId = params[1];
        const prop = properties[propId];
        if (!prop) return { rows: [] };
        const hasAccess = prop.user_id === callerId || (prop.delegates || []).includes(callerId);
        return { rows: hasAccess ? [{ id: propId }] : [] };
      }

      // market_data read
      if (s.includes('from market_data')) {
        const propId = params[0];
        const weeks  = params[1] || 8;
        return { rows: marketData.filter(m => m.property_id === propId).slice(0, weeks) };
      }

      // UPDATE pricing_history (decision)
      if (s.startsWith('update pricing_history')) {
        if (onUpdate) onUpdate(sql, params);
        return { rowCount: 1 };
      }

      // Properties channex lookup (decision → pushRates)
      if (s.includes('from properties where id =')) {
        const prop = properties[params[0]];
        return { rows: prop ? [{ channex_enabled: false }] : [] };
      }

      // ALTER TABLE — silently succeed
      if (s.startsWith('alter table')) return { rows: [] };

      throw new Error('MockPool unexpected SQL: ' + sql.slice(0, 80));
    },
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const OWNER_ID    = 'u_owner';
const DELEGATE_A  = 'u_delegate_a';
const ORPHAN_CFG_USER = 'u_delegate_a'; // delegate who created an orphan config
const SUB_ACCT_ID = 'sa-cleaner';
const PROP_ID     = 'prop-m7';

const BASE_PROPS = {
  [PROP_ID]: { user_id: OWNER_ID, delegates: [DELEGATE_A], name: 'M7' },
};

const CANONICAL_CONFIG = {
  id: 3, user_id: OWNER_ID, property_id: PROP_ID,
  mode: 'auto', is_active: true, price_min: 75, price_max: 200,
  notify_push: true, notify_email: true, notify_alert: true,
  created_at: new Date(), updated_at: new Date(),
};

const ORPHAN_CONFIG = {
  id: 9, user_id: DELEGATE_A, property_id: PROP_ID,
  mode: 'manual', is_active: true, price_min: 60, price_max: 180,
  notify_push: true, notify_email: false, notify_alert: false,
  created_at: new Date(), updated_at: new Date(),
};

const CANONICAL_HISTORY = {
  id: 101, user_id: OWNER_ID, property_id: PROP_ID,
  week_start: '2026-09-21', status: 'pending',
  price_before: 100, price_calculated: 115, price_applied: null,
  mode_used: 'auto', reason: 'test',
  factor_market: 1.15, factor_self: 1.0, factor_season: 1.0,
  market_occupancy: 70, tension_level: 'elevated',
  created_at: new Date(),
};

const ORPHAN_HISTORY = {
  id: 201, user_id: DELEGATE_A, property_id: PROP_ID,
  week_start: '2026-09-21', status: 'pending',
  price_before: 90, price_calculated: 100, price_applied: null,
  mode_used: 'manual', reason: 'orphan',
  factor_market: 1.0, factor_self: 1.0, factor_season: 1.0,
  market_occupancy: 70, tension_level: 'elevated',
  created_at: new Date(),
};

const BASE_SUB_ACCOUNTS = {
  [SUB_ACCT_ID]: { parent_user_id: OWNER_ID },
};

function makeReq({ userId = OWNER_ID, params = {}, query = {}, body = {}, isSubAccount = false, subAccountId = null } = {}) {
  return {
    user: isSubAccount
      ? { id: null, subAccountId, isSubAccount: true }
      : { id: userId, isSubAccount: false },
    params,
    query,
    body,
  };
}

function makeRes() {
  const res = { _status: 200, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json   = (body)  => { res._body  = body; return res; };
  return res;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

(async () => {

// ── Dashboard ────────────────────────────────────────────────────────────────

await test('TC-F01 GET dashboard — owner voit la config canonique', async () => {
  const pool = makeMockPool({
    properties: BASE_PROPS,
    pricingConfigs: [CANONICAL_CONFIG, ORPHAN_CONFIG],
    pricingHistory: [CANONICAL_HISTORY, ORPHAN_HISTORY],
    marketData: [],
  });
  const handlers = captureHandlers(pool);
  const handler = handlers['GET:/api/dynamic-pricing/dashboard'];
  assert.ok(handler, 'handler dashboard introuvable');

  const req = makeReq({ userId: OWNER_ID, query: {} });
  const res = makeRes();
  await handler(req, res);

  assert.strictEqual(res._status, 200, `HTTP ${res._status}: ${JSON.stringify(res._body)}`);
  assert.ok(Array.isArray(res._body?.properties), 'réponse.properties doit être un tableau');
  assert.strictEqual(res._body.properties.length, 1, `attendu 1 logement, reçu ${res._body.properties.length}`);
  assert.strictEqual(res._body.properties[0].propertyId, PROP_ID);
  assert.strictEqual(res._body.properties[0].mode, 'auto', 'doit afficher la config canonique (mode=auto)');
});

await test('TC-F02 GET dashboard — delegate voit la config owner (pas config orpheline)', async () => {
  const pool = makeMockPool({
    properties: BASE_PROPS,
    pricingConfigs: [CANONICAL_CONFIG, ORPHAN_CONFIG],
    pricingHistory: [CANONICAL_HISTORY, ORPHAN_HISTORY],
    marketData: [],
  });
  const handlers = captureHandlers(pool);
  const handler = handlers['GET:/api/dynamic-pricing/dashboard'];

  const req = makeReq({ userId: DELEGATE_A });
  const res = makeRes();
  await handler(req, res);

  assert.strictEqual(res._status, 200);
  assert.strictEqual(res._body.properties.length, 1);
  assert.strictEqual(res._body.properties[0].mode, 'auto', 'delegate doit voir config owner (auto), pas orpheline (manual)');
});

await test('TC-F03 GET dashboard — user sans accès → liste vide', async () => {
  const pool = makeMockPool({
    properties: BASE_PROPS,
    pricingConfigs: [CANONICAL_CONFIG],
    pricingHistory: [],
    marketData: [],
  });
  const handlers = captureHandlers(pool);
  const handler = handlers['GET:/api/dynamic-pricing/dashboard'];

  const req = makeReq({ userId: 'u_stranger' });
  const res = makeRes();
  await handler(req, res);

  assert.strictEqual(res._status, 200);
  assert.strictEqual(res._body.properties.length, 0, 'user sans accès doit voir 0 logements');
});

// ── Config GET ────────────────────────────────────────────────────────────────

await test('TC-F04 GET config — owner voit la config canonique', async () => {
  const pool = makeMockPool({
    properties: BASE_PROPS,
    pricingConfigs: [CANONICAL_CONFIG, ORPHAN_CONFIG],
  });
  const handlers = captureHandlers(pool);
  const handler = handlers['GET:/api/dynamic-pricing/config'];

  const req = makeReq({ userId: OWNER_ID });
  const res = makeRes();
  await handler(req, res);

  assert.strictEqual(res._status, 200);
  assert.ok(Array.isArray(res._body?.configs));
  assert.strictEqual(res._body.configs.length, 1);
  assert.strictEqual(res._body.configs[0].mode, 'auto', 'config canonique doit être mode=auto');
});

await test('TC-F05 GET config — delegate voit la config owner (pas orpheline)', async () => {
  const pool = makeMockPool({
    properties: BASE_PROPS,
    pricingConfigs: [CANONICAL_CONFIG, ORPHAN_CONFIG],
  });
  const handlers = captureHandlers(pool);
  const handler = handlers['GET:/api/dynamic-pricing/config'];

  const req = makeReq({ userId: DELEGATE_A });
  const res = makeRes();
  await handler(req, res);

  assert.strictEqual(res._status, 200);
  assert.strictEqual(res._body.configs.length, 1);
  assert.strictEqual(res._body.configs[0].mode, 'auto', 'delegate doit voir config owner (auto)');
});

await test('TC-F06 GET config — sub_account voit la config du parent owner', async () => {
  const pool = makeMockPool({
    properties: BASE_PROPS,
    pricingConfigs: [CANONICAL_CONFIG, ORPHAN_CONFIG],
    subAccounts: BASE_SUB_ACCOUNTS,
  });
  const handlers = captureHandlers(pool);
  const handler = handlers['GET:/api/dynamic-pricing/config'];

  const req = makeReq({ isSubAccount: true, subAccountId: SUB_ACCT_ID });
  const res = makeRes();
  await handler(req, res);

  assert.strictEqual(res._status, 200);
  assert.strictEqual(res._body.configs.length, 1);
  assert.strictEqual(res._body.configs[0].mode, 'auto');
});

// ── Decision ──────────────────────────────────────────────────────────────────

await test('TC-F07 POST decision — owner accepte sa suggestion → applied_by = owner', async () => {
  let updateParams = null;
  const pool = makeMockPool({
    properties: BASE_PROPS,
    pricingConfigs: [CANONICAL_CONFIG],
    pricingHistory: [CANONICAL_HISTORY],
    onUpdate: (sql, params) => { updateParams = params; },
  });
  const handlers = captureHandlers(pool);
  const handler = handlers['POST:/api/dynamic-pricing/decision/:historyId'];

  const req = makeReq({ userId: OWNER_ID, params: { historyId: '101' }, body: { action: 'apply' } });
  const res = makeRes();
  await handler(req, res);

  assert.strictEqual(res._status, 200, `HTTP ${res._status}: ${JSON.stringify(res._body)}`);
  assert.ok(res._body?.success);
  assert.ok(updateParams, 'UPDATE pricing_history non appelé');
  assert.strictEqual(updateParams[1], OWNER_ID, `applied_by attendu ${OWNER_ID}, reçu ${updateParams[1]}`);
});

await test('TC-F08 POST decision — delegate accepte → applied_by = delegate (pas owner)', async () => {
  let updateParams = null;
  const pool = makeMockPool({
    properties: BASE_PROPS,
    pricingConfigs: [CANONICAL_CONFIG],
    pricingHistory: [CANONICAL_HISTORY],
    onUpdate: (sql, params) => { updateParams = params; },
  });
  const handlers = captureHandlers(pool);
  const handler = handlers['POST:/api/dynamic-pricing/decision/:historyId'];

  const req = makeReq({ userId: DELEGATE_A, params: { historyId: '101' }, body: { action: 'apply' } });
  const res = makeRes();
  await handler(req, res);

  assert.strictEqual(res._status, 200, `HTTP ${res._status}: ${JSON.stringify(res._body)}`);
  assert.ok(updateParams, 'UPDATE non appelé');
  assert.strictEqual(updateParams[1], DELEGATE_A, `applied_by doit être l'acteur delegate ${DELEGATE_A}, reçu ${updateParams[1]}`);
  assert.notStrictEqual(updateParams[1], OWNER_ID, 'applied_by ne doit pas être owner');
});

await test('TC-F09 POST decision — user sans accès → 404', async () => {
  const pool = makeMockPool({
    properties: BASE_PROPS,
    pricingConfigs: [CANONICAL_CONFIG],
    pricingHistory: [CANONICAL_HISTORY],
  });
  const handlers = captureHandlers(pool);
  const handler = handlers['POST:/api/dynamic-pricing/decision/:historyId'];

  const req = makeReq({ userId: 'u_stranger', params: { historyId: '101' }, body: { action: 'apply' } });
  const res = makeRes();
  await handler(req, res);

  assert.strictEqual(res._status, 404, `HTTP attendu 404, reçu ${res._status}`);
});

await test('TC-F10 POST decision — suggestion inexistante → 404', async () => {
  const pool = makeMockPool({
    properties: BASE_PROPS,
    pricingConfigs: [CANONICAL_CONFIG],
    pricingHistory: [],
  });
  const handlers = captureHandlers(pool);
  const handler = handlers['POST:/api/dynamic-pricing/decision/:historyId'];

  const req = makeReq({ userId: OWNER_ID, params: { historyId: '999' }, body: { action: 'apply' } });
  const res = makeRes();
  await handler(req, res);

  assert.strictEqual(res._status, 404);
});

// ── History ───────────────────────────────────────────────────────────────────

await test('TC-F11 GET history — owner voit l\'historique canonique', async () => {
  const pool = makeMockPool({
    properties: BASE_PROPS,
    pricingConfigs: [CANONICAL_CONFIG],
    pricingHistory: [CANONICAL_HISTORY, ORPHAN_HISTORY],
  });
  const handlers = captureHandlers(pool);
  const handler = handlers['GET:/api/dynamic-pricing/history'];

  const req = makeReq({ userId: OWNER_ID, query: {} });
  const res = makeRes();
  await handler(req, res);

  assert.strictEqual(res._status, 200, `HTTP ${res._status}`);
  assert.ok(Array.isArray(res._body?.history));
  assert.strictEqual(res._body.history.length, 1, `attendu 1 ligne canonique, reçu ${res._body.history.length}`);
  assert.strictEqual(res._body.history[0].modeUsed, 'auto', 'doit afficher l\'historique canonique');
});

await test('TC-F12 GET history — delegate voit l\'historique owner (pas orphelin)', async () => {
  const pool = makeMockPool({
    properties: BASE_PROPS,
    pricingConfigs: [CANONICAL_CONFIG],
    pricingHistory: [CANONICAL_HISTORY, ORPHAN_HISTORY],
  });
  const handlers = captureHandlers(pool);
  const handler = handlers['GET:/api/dynamic-pricing/history'];

  const req = makeReq({ userId: DELEGATE_A, query: {} });
  const res = makeRes();
  await handler(req, res);

  assert.strictEqual(res._status, 200);
  assert.strictEqual(res._body.history.length, 1, `delegate doit voir 1 ligne (canonique), reçu ${res._body.history.length}`);
  assert.strictEqual(res._body.history[0].modeUsed, 'auto', 'doit voir l\'historique canonique (auto), pas orphelin (manual)');
});

// ── Market ────────────────────────────────────────────────────────────────────

await test('TC-F13 GET market — owner accède aux données de son logement', async () => {
  const pool = makeMockPool({
    properties: BASE_PROPS,
    marketData: [{ property_id: PROP_ID, week_start: '2026-09-21', median_price: 120, price_p25: 90, price_p75: 150, occupancy_rate: 65, comparable_count: 10, tension_level: 'elevated', scraped_at: new Date() }],
  });
  const handlers = captureHandlers(pool);
  const handler = handlers['GET:/api/dynamic-pricing/market/:propertyId'];

  const req = makeReq({ userId: OWNER_ID, params: { propertyId: PROP_ID }, query: { weeks: '8' } });
  const res = makeRes();
  await handler(req, res);

  assert.strictEqual(res._status, 200, `HTTP ${res._status}: ${JSON.stringify(res._body)}`);
  assert.ok(Array.isArray(res._body?.snapshots));
});

await test('TC-F14 GET market — delegate accède aux données du logement de l\'owner', async () => {
  const pool = makeMockPool({
    properties: BASE_PROPS,
    marketData: [{ property_id: PROP_ID, week_start: '2026-09-21', median_price: 120, price_p25: 90, price_p75: 150, occupancy_rate: 65, comparable_count: 10, tension_level: 'elevated', scraped_at: new Date() }],
  });
  const handlers = captureHandlers(pool);
  const handler = handlers['GET:/api/dynamic-pricing/market/:propertyId'];

  const req = makeReq({ userId: DELEGATE_A, params: { propertyId: PROP_ID }, query: { weeks: '8' } });
  const res = makeRes();
  await handler(req, res);

  assert.strictEqual(res._status, 200, `HTTP ${res._status}`);
  assert.ok(Array.isArray(res._body?.snapshots));
});

await test('TC-F15 GET market — user sans accès → 403', async () => {
  const pool = makeMockPool({ properties: BASE_PROPS, marketData: [] });
  const handlers = captureHandlers(pool);
  const handler = handlers['GET:/api/dynamic-pricing/market/:propertyId'];

  const req = makeReq({ userId: 'u_stranger', params: { propertyId: PROP_ID }, query: {} });
  const res = makeRes();
  await handler(req, res);

  assert.strictEqual(res._status, 403, `HTTP attendu 403, reçu ${res._status}`);
});

// ── Inspection structurelle des requirePermission ─────────────────────────────

await test('TC-F16 requirePermission présent sur les routes read/action', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'dynamic-pricing-routes.js'),
    'utf8'
  );

  const routesToCheck = [
    { path: "get('/api/dynamic-pricing/dashboard'",  perm: 'can_view_pricing' },
    { path: "get('/api/dynamic-pricing/config'",     perm: 'can_view_pricing' },
    { path: "get('/api/dynamic-pricing/history'",    perm: 'can_view_pricing' },
    { path: "get('/api/dynamic-pricing/market/",     perm: 'can_view_pricing' },
    { path: "post('/api/dynamic-pricing/decision/",  perm: 'can_manage_pricing' },
  ];

  for (const { path: routePath, perm } of routesToCheck) {
    const idx = src.indexOf(routePath);
    assert.ok(idx >= 0, `Route ${routePath} introuvable`);
    const decl = src.slice(idx, idx + 200);
    assert.ok(
      new RegExp(`requirePermission\\s*\\(\\s*pool\\s*,\\s*['"]${perm}['"]`).test(decl),
      `requirePermission(pool, '${perm}') absent de ${routePath}`
    );
  }

  // Pause and notifications
  for (const file of ['pricing-pause-routes.js', 'pricing-notifications-routes.js']) {
    const fileSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', file), 'utf8');
    assert.ok(
      /require\(['"]\.\.\/sub-accounts-middleware['"]\)/.test(fileSrc),
      `sub-accounts-middleware non importé dans ${file}`
    );
    assert.ok(
      /requirePermission\s*\(\s*pool\s*,\s*['"]can_manage_pricing['"]/.test(fileSrc),
      `requirePermission(pool, 'can_manage_pricing') absent de ${file}`
    );
  }
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n── P0-C4.1f access scope ─────────────────────────────────────────────────────');
console.log(`   ${passed} passed  ${failed} failed`);
if (failures.length) {
  console.log('\nÉCHECS :');
  failures.forEach(f => console.log(`  ✗ ${f.name}\n    ${f.message}`));
  process.exit(1);
}
process.exit(0);

})();
