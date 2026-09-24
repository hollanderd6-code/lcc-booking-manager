#!/usr/bin/env node
'use strict';
/**
 * P0-C4.1i-bis — Property identity for BoostPrice config writers
 *
 * Vérifie que tous les writers pricing_config utilisent l'identité canonique
 * du pricing (properties.user_id), jamais l'identité de l'acteur (delegate,
 * sous-compte). La contrainte DB est maintenant UNIQUE(property_id) : une
 * seule config par logement, dont le user_id = properties.user_id.
 *
 * Couverture :
 *   TC-I01 : Source — ON CONFLICT (property_id) dans dynamic-pricing-routes
 *   TC-I02 : Source — user_id = EXCLUDED.user_id dans DO UPDATE
 *   TC-I03 : POST /config owner → UPSERT user_id = properties.user_id
 *   TC-I04 : POST /config delegate → UPSERT user_id = owner (pas delegate)
 *   TC-I05 : POST /config acteur sans accès → 403, pas d'UPSERT
 *   TC-I06 : Source — PUT /zone n'utilise plus req.user.id dans WHERE UPDATE
 *   TC-I07 : Source — PUT /mode n'utilise plus req.user.id dans WHERE UPDATE
 *   TC-I08 : PUT /api/pricing/zone owner → UPDATE user_id = owner
 *   TC-I09 : PUT /api/pricing/zone delegate → UPDATE user_id = owner (pas delegate)
 *   TC-I10 : PUT /api/pricing/zone acteur sans accès → 403
 *   TC-I11 : PUT /api/pricing/mode delegate → UPDATE user_id = owner
 *   TC-I12 : PUT /api/pricing/mode acteur sans accès → 403
 *
 * Exécution : node tests/c4_1i_bis_property_identity.test.js
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

const { setupDynamicPricingRoutes }  = require('../routes/dynamic-pricing-routes');
const { setupPricingCalendarRoutes } = require('../routes/pricing-calendars');

function captureHandlers(setupFn, pool) {
  const handlers = {};
  const mockApp  = {
    get:    (p, ...mws) => { handlers['GET:'    + p] = mws[mws.length - 1]; },
    post:   (p, ...mws) => { handlers['POST:'   + p] = mws[mws.length - 1]; },
    patch:  (p, ...mws) => { handlers['PATCH:'  + p] = mws[mws.length - 1]; },
    put:    (p, ...mws) => { handlers['PUT:'    + p] = mws[mws.length - 1]; },
    delete: (p, ...mws) => { handlers['DELETE:' + p] = mws[mws.length - 1]; },
  };
  setupFn(mockApp, pool, () => {});
  return handlers;
}

// ── Mock pool factory ──────────────────────────────────────────────────────────
//
// properties   : { [propId]: { user_id, delegates?: userId[], name? } }
// subAccounts  : { [subAcctId]: { parent_user_id } }
// onInsert     : cb(sql, params) — déclenché sur INSERT INTO pricing_config
// onUpdate     : cb(sql, params) — déclenché sur UPDATE pricing_config

function makeMockPool({ properties = {}, subAccounts = {}, onInsert = null, onUpdate = null } = {}) {
  return {
    async query(sql, params = []) {
      const s = sql.toLowerCase().replace(/\s+/g, ' ').trim();

      // DDL + seed school_holidays — silently succeed
      if (s.startsWith('create table') || s.startsWith('create index') ||
          s.startsWith('alter table')  || s.startsWith('create unique') ||
          s.startsWith('insert into school_holidays')) return { rows: [] };

      // school_holidays seed guard (count)
      if (s.includes('count(*)') && s.includes('from school_holidays')) {
        return { rows: [{ n: 1 }] }; // non-vide → skip seed
      }

      // Sub-account parent lookup
      if (s.includes('from sub_accounts')) {
        const sa = subAccounts[params[0]];
        return { rows: sa ? [{ parent_user_id: sa.parent_user_id }] : [] };
      }

      // Property access + canonical owner resolution
      // Pattern utilisé dans POST /config et resolvePricingOwner :
      //   WHERE id=$1 AND (user_id=$2 OR EXISTS (... account_delegations ...))
      if (s.includes('from properties') && s.includes('account_delegations')) {
        const propId   = params[0];
        const callerId = params[1];
        const prop     = properties[propId];
        if (!prop) return { rows: [] };
        const hasAccess = prop.user_id === callerId || (prop.delegates || []).includes(callerId);
        if (!hasAccess) return { rows: [] };
        return { rows: [{ id: propId, pricing_owner_id: prop.user_id }] };
      }

      // Property existence check (branche 404 dans POST /config)
      if (s.includes('from properties where id =')) {
        const prop = properties[params[0]];
        return { rows: prop ? [{ id: params[0] }] : [] };
      }

      // C3D pre-read — old activation state
      if (s.startsWith('select is_active from pricing_config')) return { rows: [] };

      // INSERT INTO pricing_config (UPSERT)
      if (s.startsWith('insert into pricing_config')) {
        if (onInsert) onInsert(sql, params);
        return { rows: [{
          id: 99, user_id: params[0], property_id: params[1],
          price_min: params[2], price_max: params[3],
          mode: params[4], is_active: params[5],
        }] };
      }

      // UPDATE pricing_config
      if (s.startsWith('update pricing_config')) {
        if (onUpdate) onUpdate(sql, params);
        return { rowCount: 1 };
      }

      // Lectures annexes (pricing_history, market_data, etc.)
      if (s.includes('from pricing_history')) return { rows: [] };
      if (s.includes('from market_data'))     return { rows: [] };
      if (s.includes('from user_devices'))    return { rows: [] };

      throw new Error('MockPool SQL inattendu : ' + sql.slice(0, 100));
    },
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const OWNER_ID   = 'u_owner';
const DELEGATE_A = 'u_delegate_a';
const STRANGER   = 'u_stranger';
const PROP_ID    = 'prop-m7';

const BASE_PROPS = {
  [PROP_ID]: { user_id: OWNER_ID, delegates: [DELEGATE_A], name: 'M7' },
};

const CONFIG_BODY = {
  propertyId: PROP_ID, priceMin: 80, priceMax: 250,
  mode: 'auto', isActive: true,
  notifyPush: true, notifyEmail: false, notifyAlert: false,
  propertyType: 'apartment', bedrooms: 1, strategy: 50,
};

function makeReq({ userId = OWNER_ID, params = {}, body = {}, isSubAccount = false, subAccountId = null } = {}) {
  return {
    user: isSubAccount
      ? { id: null, subAccountId, isSubAccount: true }
      : { id: userId, isSubAccount: false },
    params,
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

// ── Source code audits ────────────────────────────────────────────────────────

await test('TC-I01 Source — ON CONFLICT (property_id) dans dynamic-pricing-routes', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../routes/dynamic-pricing-routes.js'), 'utf8');
  assert.ok(
    src.includes('ON CONFLICT (property_id)'),
    'ON CONFLICT (property_id) introuvable dans dynamic-pricing-routes.js'
  );
  assert.ok(
    !src.includes('ON CONFLICT (user_id, property_id)'),
    'ON CONFLICT (user_id, property_id) encore présent — doit être remplacé'
  );
});

await test('TC-I02 Source — user_id = EXCLUDED.user_id présent dans DO UPDATE', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../routes/dynamic-pricing-routes.js'), 'utf8');
  assert.ok(
    src.includes('user_id') && src.includes('EXCLUDED.user_id'),
    'user_id = EXCLUDED.user_id introuvable dans le bloc DO UPDATE'
  );
});

await test('TC-I06 Source — PUT /zone ne contient plus req.user.id dans WHERE UPDATE', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../routes/pricing-calendars.js'), 'utf8');
  const zoneIdx = src.indexOf("app.put('/api/pricing/zone'");
  assert.ok(zoneIdx !== -1, "handler PUT /api/pricing/zone introuvable dans pricing-calendars.js");
  const slice = src.slice(zoneIdx, zoneIdx + 700);
  assert.ok(
    !slice.includes('req.user.id'),
    "PUT /zone contient encore req.user.id — doit utiliser ownerId canonique"
  );
  assert.ok(
    slice.includes('resolvePricingOwner') || slice.includes('ownerId'),
    "PUT /zone ne résout pas l'identité canonique (resolvePricingOwner / ownerId manquant)"
  );
});

await test('TC-I07 Source — PUT /mode ne contient plus req.user.id dans WHERE UPDATE', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../routes/pricing-calendars.js'), 'utf8');
  const modeIdx = src.indexOf("app.put('/api/pricing/mode/");
  assert.ok(modeIdx !== -1, "handler PUT /api/pricing/mode introuvable dans pricing-calendars.js");
  const slice = src.slice(modeIdx, modeIdx + 700);
  assert.ok(
    !slice.includes('req.user.id'),
    "PUT /mode contient encore req.user.id — doit utiliser ownerId canonique"
  );
  assert.ok(
    slice.includes('resolvePricingOwner') || slice.includes('ownerId'),
    "PUT /mode ne résout pas l'identité canonique (resolvePricingOwner / ownerId manquant)"
  );
});

// ── UPSERT — POST /config ─────────────────────────────────────────────────────

await test('TC-I03 POST /config owner → UPSERT user_id = properties.user_id (owner)', async () => {
  let insertedUserId = null;
  const pool = makeMockPool({
    properties: BASE_PROPS,
    onInsert: (sql, params) => { insertedUserId = params[0]; },
  });
  const handlers = captureHandlers(
    (app, p, auth) => setupDynamicPricingRoutes(app, p, auth),
    pool
  );
  const handler = handlers['POST:/api/dynamic-pricing/config'];
  assert.ok(handler, 'handler POST /api/dynamic-pricing/config introuvable');

  const res = makeRes();
  await handler(makeReq({ userId: OWNER_ID, body: CONFIG_BODY }), res);

  assert.strictEqual(res._status, 200, `HTTP ${res._status} : ${JSON.stringify(res._body)}`);
  assert.strictEqual(insertedUserId, OWNER_ID,
    `UPSERT user_id attendu ${OWNER_ID}, reçu ${insertedUserId}`);
});

await test('TC-I04 POST /config delegate → UPSERT user_id = owner (pas delegate)', async () => {
  let insertedUserId = null;
  const pool = makeMockPool({
    properties: BASE_PROPS,
    onInsert: (sql, params) => { insertedUserId = params[0]; },
  });
  const handlers = captureHandlers(
    (app, p, auth) => setupDynamicPricingRoutes(app, p, auth),
    pool
  );
  const handler = handlers['POST:/api/dynamic-pricing/config'];

  const res = makeRes();
  await handler(makeReq({ userId: DELEGATE_A, body: CONFIG_BODY }), res);

  assert.strictEqual(res._status, 200, `HTTP ${res._status} : ${JSON.stringify(res._body)}`);
  assert.notStrictEqual(insertedUserId, DELEGATE_A,
    "UPSERT user_id ne doit PAS être le delegate — il crée une config orpheline");
  assert.strictEqual(insertedUserId, OWNER_ID,
    `UPSERT user_id attendu ${OWNER_ID} (owner), reçu ${insertedUserId}`);
});

await test('TC-I05 POST /config acteur sans accès → 403, pas d\'UPSERT', async () => {
  let insertCalled = false;
  const pool = makeMockPool({
    properties: BASE_PROPS,
    onInsert: () => { insertCalled = true; },
  });
  const handlers = captureHandlers(
    (app, p, auth) => setupDynamicPricingRoutes(app, p, auth),
    pool
  );
  const handler = handlers['POST:/api/dynamic-pricing/config'];

  const res = makeRes();
  await handler(makeReq({ userId: STRANGER, body: CONFIG_BODY }), res);

  assert.strictEqual(res._status, 403, `attendu 403, reçu ${res._status}`);
  assert.ok(!insertCalled, 'UPSERT ne doit pas être déclenché pour un acteur non autorisé');
});

// ── PUT /api/pricing/zone ──────────────────────────────────────────────────────

await test('TC-I08 PUT /api/pricing/zone owner → UPDATE user_id = owner', async () => {
  let updateUserId = null;
  const pool = makeMockPool({
    properties: BASE_PROPS,
    onUpdate: (sql, params) => {
      if (sql.toLowerCase().includes('school_zone')) updateUserId = params[1];
    },
  });
  const handlers = captureHandlers(
    (app, p, auth) => setupPricingCalendarRoutes(app, p, auth),
    pool
  );
  const handler = handlers['PUT:/api/pricing/zone'];
  assert.ok(handler, 'handler PUT /api/pricing/zone introuvable');

  const res = makeRes();
  await handler(makeReq({ userId: OWNER_ID, body: { propertyId: PROP_ID, zone: 'C' } }), res);

  assert.strictEqual(res._status, 200, `HTTP ${res._status} : ${JSON.stringify(res._body)}`);
  assert.strictEqual(updateUserId, OWNER_ID,
    `UPDATE user_id attendu ${OWNER_ID}, reçu ${updateUserId}`);
});

await test('TC-I09 PUT /api/pricing/zone delegate → UPDATE user_id = owner (pas delegate)', async () => {
  let updateUserId = null;
  const pool = makeMockPool({
    properties: BASE_PROPS,
    onUpdate: (sql, params) => {
      if (sql.toLowerCase().includes('school_zone')) updateUserId = params[1];
    },
  });
  const handlers = captureHandlers(
    (app, p, auth) => setupPricingCalendarRoutes(app, p, auth),
    pool
  );
  const handler = handlers['PUT:/api/pricing/zone'];

  const res = makeRes();
  await handler(makeReq({ userId: DELEGATE_A, body: { propertyId: PROP_ID, zone: 'A' } }), res);

  assert.strictEqual(res._status, 200, `HTTP ${res._status} : ${JSON.stringify(res._body)}`);
  assert.notStrictEqual(updateUserId, DELEGATE_A,
    "UPDATE user_id ne doit PAS être le delegate");
  assert.strictEqual(updateUserId, OWNER_ID,
    `UPDATE user_id attendu ${OWNER_ID} (owner), reçu ${updateUserId}`);
});

await test('TC-I10 PUT /api/pricing/zone acteur sans accès → 403', async () => {
  let updateCalled = false;
  const pool = makeMockPool({
    properties: BASE_PROPS,
    onUpdate: () => { updateCalled = true; },
  });
  const handlers = captureHandlers(
    (app, p, auth) => setupPricingCalendarRoutes(app, p, auth),
    pool
  );
  const handler = handlers['PUT:/api/pricing/zone'];

  const res = makeRes();
  await handler(makeReq({ userId: STRANGER, body: { propertyId: PROP_ID, zone: 'B' } }), res);

  assert.strictEqual(res._status, 403, `attendu 403, reçu ${res._status}`);
  assert.ok(!updateCalled, 'UPDATE ne doit pas être déclenché pour un acteur non autorisé');
});

// ── PUT /api/pricing/mode ──────────────────────────────────────────────────────

await test('TC-I11 PUT /api/pricing/mode delegate → UPDATE user_id = owner', async () => {
  let updateUserId = null;
  const pool = makeMockPool({
    properties: BASE_PROPS,
    onUpdate: (sql, params) => {
      if (sql.toLowerCase().includes('set mode')) updateUserId = params[1];
    },
  });
  const handlers = captureHandlers(
    (app, p, auth) => setupPricingCalendarRoutes(app, p, auth),
    pool
  );
  const handler = handlers['PUT:/api/pricing/mode/:propertyId'];
  assert.ok(handler, 'handler PUT /api/pricing/mode/:propertyId introuvable');

  const res = makeRes();
  await handler(makeReq({ userId: DELEGATE_A, params: { propertyId: PROP_ID }, body: { mode: 'manual' } }), res);

  assert.strictEqual(res._status, 200, `HTTP ${res._status} : ${JSON.stringify(res._body)}`);
  assert.strictEqual(updateUserId, OWNER_ID,
    `UPDATE user_id attendu ${OWNER_ID}, reçu ${updateUserId}`);
});

await test('TC-I12 PUT /api/pricing/mode acteur sans accès → 403', async () => {
  let updateCalled = false;
  const pool = makeMockPool({
    properties: BASE_PROPS,
    onUpdate: () => { updateCalled = true; },
  });
  const handlers = captureHandlers(
    (app, p, auth) => setupPricingCalendarRoutes(app, p, auth),
    pool
  );
  const handler = handlers['PUT:/api/pricing/mode/:propertyId'];

  const res = makeRes();
  await handler(makeReq({ userId: STRANGER, params: { propertyId: PROP_ID }, body: { mode: 'auto' } }), res);

  assert.strictEqual(res._status, 403, `attendu 403, reçu ${res._status}`);
  assert.ok(!updateCalled, 'UPDATE ne doit pas être déclenché pour un acteur non autorisé');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('');
if (failed === 0) {
  console.log(`✅  Tous les tests passent (${passed}/${passed + failed})`);
} else {
  console.log(`❌  ${failed} test(s) en échec sur ${passed + failed}`);
  for (const f of failures) {
    console.log(`   • ${f.name}`);
    console.log(`     ${f.message}`);
  }
  process.exit(1);
}

})();
