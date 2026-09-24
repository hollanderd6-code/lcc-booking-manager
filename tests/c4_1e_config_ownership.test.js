#!/usr/bin/env node
'use strict';
/**
 * P0-C4.1e — Canonical ownership of pricing_config
 *
 * Vérifie que POST /api/dynamic-pricing/config utilise toujours
 * properties.user_id comme identité du pricing, jamais l'userId
 * de l'appelant (delegate, sub_account, ou body client).
 *
 * Couverture :
 *   TC-C01 : owner configure → pricing_config.user_id = owner
 *   TC-C02 : owner reconfigure → même config mise à jour (ON CONFLICT)
 *   TC-C03 : delegate configurant le logement du delegator → config owner mise à jour
 *   TC-C04 : delegate → aucun INSERT avec user_id = delegate
 *   TC-C05 : user sans accès → 403, aucun write
 *   TC-C06 : property inexistante → 404, aucun write
 *   TC-C07 : userId/pricingOwnerId dans le body → ignoré, identité issue de DB
 *   TC-C08 : requirePermission(can_manage_pricing) présent dans la chaîne POST /config
 *   TC-C09 : sub_account autorisé → écrit sous l'owner canonique
 *   TC-C10 : M7 simulé — owner + deux delegates → même (ownerId, propertyId) ciblés
 *
 * Exécution : node tests/c4_1e_config_ownership.test.js
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
// Mounts setupDynamicPricingRoutes with a mock app and captures the POST /config
// handler (last middleware in the chain).

const { setupDynamicPricingRoutes } = require('../routes/dynamic-pricing-routes');

function captureConfigHandler(pool) {
  let handler = null;
  const mockApp = {
    get:    () => {},
    post:   (path, ...mws) => {
      if (path === '/api/dynamic-pricing/config') handler = mws[mws.length - 1];
    },
  };
  setupDynamicPricingRoutes(mockApp, pool, () => {});
  return handler;
}

// ── Mock pool factory ─────────────────────────────────────────────────────────
//
// properties map: { [propertyId]: { user_id, delegates: [userId, ...] } }
// subAccounts map: { [subAccountId]: { parent_user_id } }
// onInsert cb: called with the params array when pricing_config is written

function makeMockPool({ properties = {}, subAccounts = {}, onInsert = null } = {}) {
  return {
    async query(sql, params = []) {
      const s = sql.toLowerCase().replace(/\s+/g, ' ').trim();

      // ALTER TABLE — silently succeed
      if (s.startsWith('alter table')) return { rows: [] };

      // Sub_account lookup
      if (s.includes('from sub_accounts')) {
        const saId = params[0];
        const sa   = subAccounts[saId];
        return { rows: sa ? [{ parent_user_id: sa.parent_user_id }] : [] };
      }

      // Property access + owner resolution (has account_delegations EXISTS clause)
      if (s.includes('from properties') && s.includes('account_delegations')) {
        const propId   = params[0];
        const callerId = params[1];
        const prop     = properties[propId];
        if (!prop) return { rows: [] };
        const isOwner    = prop.user_id === callerId;
        const isDelegate = Array.isArray(prop.delegates) && prop.delegates.includes(callerId);
        if (isOwner || isDelegate) {
          return { rows: [{ id: propId, pricing_owner_id: prop.user_id }] };
        }
        return { rows: [] };
      }

      // Existence check (SELECT 1 FROM properties WHERE id = $1)
      if (s.includes('select 1 from properties') || (s.includes('from properties') && !s.includes('account_delegations'))) {
        const propId = params[0];
        return { rows: properties[propId] ? [{ id: propId }] : [] };
      }

      // C3D pre-read — old activation state
      if (s.startsWith('select is_active from pricing_config')) return { rows: [] };

      // INSERT INTO pricing_config
      if (s.startsWith('insert into pricing_config')) {
        if (onInsert) onInsert(params);
        const row = {
          id: 999, user_id: params[0], property_id: params[1],
          mode: params[4], is_active: params[5],
        };
        return { rows: [row] };
      }

      throw new Error('MockPool unexpected SQL: ' + sql.slice(0, 80));
    },
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const OWNER_ID    = 'u_owner';
const DELEGATE_A  = 'u_delegate_a';
const DELEGATE_B  = 'u_delegate_b';
const PROP_ID     = 'prop-m7';
const SUB_ACCT_ID = 'sa-cleaner';

const BASE_PROPS = {
  [PROP_ID]: { user_id: OWNER_ID, delegates: [DELEGATE_A, DELEGATE_B] },
};

const BASE_SUB_ACCOUNTS = {
  [SUB_ACCT_ID]: { parent_user_id: OWNER_ID },
};

function makeReq({ userId = OWNER_ID, body = {}, isSubAccount = false, subAccountId = null } = {}) {
  return {
    user: isSubAccount
      ? { id: null, subAccountId, isSubAccount: true }
      : { id: userId, isSubAccount: false },
    body,
  };
}

function makeRes() {
  const res = { _status: 200, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json   = (body)  => { res._body  = body; return res; };
  return res;
}

const VALID_BODY = {
  propertyId: PROP_ID, priceMin: 75, priceMax: 200, mode: 'auto',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

(async () => {

// TC-C01 : owner configure sa propre property
await test('TC-C01 owner configure → user_id = owner dans pricing_config', async () => {
  let insertedUserId = null;
  const pool = makeMockPool({
    properties: BASE_PROPS,
    onInsert: (params) => { insertedUserId = params[0]; },
  });
  const handler = captureConfigHandler(pool);
  const req = makeReq({ userId: OWNER_ID, body: VALID_BODY });
  const res = makeRes();

  await handler(req, res);

  assert.strictEqual(res._status, 200, `HTTP ${res._status}: ${JSON.stringify(res._body)}`);
  assert.ok(res._body?.success, 'réponse success manquante');
  assert.strictEqual(insertedUserId, OWNER_ID, `user_id INSERT = ${insertedUserId}, attendu ${OWNER_ID}`);
  assert.strictEqual(res._body.config?.user_id, OWNER_ID, 'réponse config.user_id ≠ owner');
});

// TC-C02 : owner reconfigure → ON CONFLICT → mise à jour (même params INSERT)
await test('TC-C02 owner reconfigure → même paire (ownerId, propertyId)', async () => {
  const insertions = [];
  const pool = makeMockPool({
    properties: BASE_PROPS,
    onInsert: (params) => insertions.push({ userId: params[0], propId: params[1] }),
  });
  const handler = captureConfigHandler(pool);

  for (const mode of ['manual', 'auto']) {
    const req = makeReq({ userId: OWNER_ID, body: { ...VALID_BODY, mode } });
    await handler(req, makeRes());
  }

  assert.strictEqual(insertions.length, 2, 'attendu 2 appels INSERT');
  assert.ok(insertions.every(i => i.userId === OWNER_ID), 'user_id doit toujours être owner');
  assert.ok(insertions.every(i => i.propId === PROP_ID),  'property_id doit être constant');
});

// TC-C03 : delegate autorisé → config owner mise à jour
await test('TC-C03 delegate configure → user_id INSERT = owner (pas delegate)', async () => {
  let insertedUserId = null;
  const pool = makeMockPool({
    properties: BASE_PROPS,
    onInsert: (params) => { insertedUserId = params[0]; },
  });
  const handler = captureConfigHandler(pool);
  const req = makeReq({ userId: DELEGATE_A, body: VALID_BODY });
  const res = makeRes();

  await handler(req, res);

  assert.strictEqual(res._status, 200, `HTTP ${res._status}`);
  assert.strictEqual(insertedUserId, OWNER_ID,
    `user_id INSERT = ${insertedUserId}, attendu owner ${OWNER_ID}`);
});

// TC-C04 : delegate → aucun INSERT avec user_id = delegate
await test('TC-C04 delegate → user_id delegate jamais écrit en DB', async () => {
  const insertedUserIds = [];
  const pool = makeMockPool({
    properties: BASE_PROPS,
    onInsert: (params) => insertedUserIds.push(params[0]),
  });
  const handler = captureConfigHandler(pool);

  for (const caller of [DELEGATE_A, DELEGATE_B]) {
    const req = makeReq({ userId: caller, body: VALID_BODY });
    await handler(req, makeRes());
  }

  const delegateWrites = insertedUserIds.filter(id => id === DELEGATE_A || id === DELEGATE_B);
  assert.strictEqual(delegateWrites.length, 0,
    `Delegate user_ids trouvés en DB : ${delegateWrites}`);
});

// TC-C05 : user sans ownership ni délégation → 403, aucun write
await test('TC-C05 user non autorisé → 403, aucun INSERT', async () => {
  let insertCalled = false;
  const pool = makeMockPool({
    properties: BASE_PROPS,
    onInsert: () => { insertCalled = true; },
  });
  const handler = captureConfigHandler(pool);
  const req = makeReq({ userId: 'u_stranger', body: VALID_BODY });
  const res = makeRes();

  await handler(req, res);

  assert.strictEqual(res._status, 403, `HTTP attendu 403, reçu ${res._status}`);
  assert.ok(!insertCalled, 'INSERT ne doit pas être appelé');
});

// TC-C06 : property inexistante → 404, aucun write
await test('TC-C06 property inexistante → 404, aucun INSERT', async () => {
  let insertCalled = false;
  const pool = makeMockPool({
    properties: {},  // empty
    onInsert: () => { insertCalled = true; },
  });
  const handler = captureConfigHandler(pool);
  const req = makeReq({ userId: OWNER_ID, body: { ...VALID_BODY, propertyId: 'no-such-prop' } });
  const res = makeRes();

  await handler(req, res);

  assert.strictEqual(res._status, 404, `HTTP attendu 404, reçu ${res._status}`);
  assert.ok(!insertCalled, 'INSERT ne doit pas être appelé');
});

// TC-C07 : userId/pricingOwnerId envoyés dans le body → ignorés
await test('TC-C07 userId dans body → ignoré, identité issue de properties.user_id', async () => {
  let insertedUserId = null;
  const pool = makeMockPool({
    properties: BASE_PROPS,
    onInsert: (params) => { insertedUserId = params[0]; },
  });
  const handler = captureConfigHandler(pool);

  // Caller = delegate, body contient userId = 'u_injected_by_client'
  const req = makeReq({
    userId: DELEGATE_A,
    body: { ...VALID_BODY, userId: 'u_injected_by_client', pricingOwnerId: 'u_injected_by_client' },
  });
  const res = makeRes();

  await handler(req, res);

  assert.strictEqual(res._status, 200, `HTTP ${res._status}`);
  assert.notStrictEqual(insertedUserId, 'u_injected_by_client',
    'userId client ne doit jamais être utilisé');
  assert.strictEqual(insertedUserId, OWNER_ID,
    `user_id INSERT attendu = owner ${OWNER_ID}, reçu ${insertedUserId}`);
});

// TC-C08 : requirePermission(can_manage_pricing) présent dans la chaîne POST /config
await test('TC-C08 requirePermission(can_manage_pricing) dans la chaîne de middlewares', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'dynamic-pricing-routes.js'),
    'utf8'
  );
  // Vérifier que requirePermission est importé
  assert.ok(
    /require\(['"]\.\.\/sub-accounts-middleware['"]\)/.test(src),
    'sub-accounts-middleware non importé dans dynamic-pricing-routes.js'
  );
  // Vérifier qu'il est utilisé sur la route POST /config
  const configRouteIdx = src.indexOf("post('/api/dynamic-pricing/config'");
  assert.ok(configRouteIdx >= 0, "Route POST /api/dynamic-pricing/config introuvable");
  // Extraire les ~200 caractères de la déclaration de route (avant le handler)
  const routeDecl = src.slice(configRouteIdx, configRouteIdx + 300);
  assert.ok(
    /requirePermission\s*\(\s*pool\s*,\s*['"]can_manage_pricing['"]/.test(routeDecl),
    "requirePermission(pool, 'can_manage_pricing') absent de la déclaration POST /config"
  );
});

// TC-C09 : sub_account autorisé → écrit sous l'owner canonique
await test('TC-C09 sub_account → INSERT user_id = parent owner, jamais sub_account id', async () => {
  let insertedUserId = null;
  const pool = makeMockPool({
    properties: BASE_PROPS,
    subAccounts: BASE_SUB_ACCOUNTS,
    onInsert: (params) => { insertedUserId = params[0]; },
  });
  const handler = captureConfigHandler(pool);
  const req = makeReq({ isSubAccount: true, subAccountId: SUB_ACCT_ID, body: VALID_BODY });
  const res = makeRes();

  await handler(req, res);

  assert.strictEqual(res._status, 200, `HTTP ${res._status}: ${JSON.stringify(res._body)}`);
  assert.strictEqual(insertedUserId, OWNER_ID,
    `user_id INSERT = ${insertedUserId}, attendu owner ${OWNER_ID}`);
  assert.notStrictEqual(insertedUserId, SUB_ACCT_ID,
    'sub_account id ne doit jamais apparaître dans pricing_config.user_id');
});

// TC-C10 : cas M7 — owner + deux delegates → même (ownerId, propertyId) ciblés
await test('TC-C10 M7 simulé : owner + 2 delegates → même paire (ownerId, propId)', async () => {
  const insertions = [];
  const pool = makeMockPool({
    properties: BASE_PROPS,
    onInsert: (params) => insertions.push({ userId: params[0], propId: params[1] }),
  });
  const handler = captureConfigHandler(pool);

  // Simule 3 appels séquentiels : owner + 2 delegates (comme en production M7)
  for (const caller of [OWNER_ID, DELEGATE_A, DELEGATE_B]) {
    const req = makeReq({ userId: caller, body: VALID_BODY });
    const res = makeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 200, `HTTP ${res._status} pour caller ${caller}`);
  }

  assert.strictEqual(insertions.length, 3, 'attendu 3 appels INSERT');

  const uniquePairs = new Set(insertions.map(i => `${i.userId}|${i.propId}`));
  assert.strictEqual(uniquePairs.size, 1,
    `Paires (userId, propId) distinctes : ${[...uniquePairs].join(', ')} — attendu 1 seule`);

  const [pair] = uniquePairs;
  const [insertedOwner, insertedProp] = pair.split('|');
  assert.strictEqual(insertedOwner, OWNER_ID, `owner attendu ${OWNER_ID}, reçu ${insertedOwner}`);
  assert.strictEqual(insertedProp,  PROP_ID,  `property attendu ${PROP_ID}, reçu ${insertedProp}`);
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n── P0-C4.1e config ownership ────────────────────────────────────────────────');
console.log(`   ${passed} passed  ${failed} failed`);
if (failures.length) {
  console.log('\nÉCHECS :');
  failures.forEach(f => console.log(`  ✗ ${f.name}\n    ${f.message}`));
  process.exit(1);
}
process.exit(0);

})();
