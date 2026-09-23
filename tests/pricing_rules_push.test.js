#!/usr/bin/env node
'use strict';
/**
 * Tests unitaires — Route POST /api/pricing/rules/push-channex/:id (P0-C4.4-B)
 *
 * Couvre :
 *   P2-01   : factory wiring — handler capturé correctement
 *   P2-02   : property inaccessible → 404
 *   P2-03   : channex_disabled → 400
 *   P2-04   : channex_property_id manquant → 400
 *   P2-05   : channex_room_type_id manquant → 400
 *   P2-06   : channex_rate_plan_id manquant → 400
 *   P2-07   : external_pricing=true → 400, publisher 0 appel
 *   P2-08   : publisher appelé exactement une fois
 *   P2-09   : propertyId = prop.id (depuis DB, pas params bruts)
 *   P2-10   : userId = prop.user_id canonique (pas req.user.id)
 *   P2-11   : reason = 'manual_push'
 *   P2-12   : fenêtre exacte 500 nuits (startDate=today, endDate=addDays(today,500))
 *   P2-13   : stopSellMode = 'true_only'
 *   P2-14   : allowedDates absent du payload publisher
 *   P2-15   : publisher ok → 200 avec message/ok/success compat
 *   P2-16   : publisher partial → 200 + partial=true + message vrai
 *   P2-17   : publisher error → 500
 *   P2-18   : publisher skipped_external → 400
 *   P2-19   : publisher skipped_channex_disabled → 400
 *   P2-20   : publisher skipped_missing_ids → 400
 *   P2-21   : publisher skipped_not_found → 404
 *   P2-22   : publisher throw → 500
 *   P2-23   : aucun appel direct pushRates
 *   P2-24   : aucun appel direct pushRestrictions
 *   P2-25   : aucune application locale long_stay
 *   P2-26   : aucune résolution locale du prix (pricing_overrides/rules non chargés)
 *   P2-27   : caller != prop.user_id avec agencyIds permissif → accès OK, userId publisher = prop.user_id
 *
 * B19 — Preuve sémantique BoostPrice :
 *   P2-BP01 : PATH2 délègue au resolver → prix 99 (BoostPrice applied) vs base 75
 *   P2-BP02 : override 105 > BoostPrice applied 99
 *   P2-BP03 : BoostPrice pending ignoré → base 75
 *
 * Exécution : node tests/pricing_rules_push.test.js
 * Aucun appel DB réel. Aucun appel Channex.
 */

const assert   = require('assert');
const factory  = require('../routes/pricing-rules-push');
const { PUBLISH_STATUS } = require('../routes/pricing-publisher');
const { addDays }        = require('../routes/effective-pricing-resolver');

// ─── Test runner ──────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
const failures = [];

(async () => {

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Mounts the route factory, captures the POST handler.
 * Middlewares are all mocked: authenticateAny + requirePermission are pass-through,
 * getUserFromRequest resolves to { id: callerId }, getAgencyUserIds resolves to agencyIds.
 */
function captureHandler(pool, publisherFn, { callerId = 'caller1', agencyIds = null } = {}) {
  let handler = null;

  const app = {
    post: (_path, _mw1, _mw2, h) => { handler = h; },
  };

  const middlewares = {
    authenticateAny:    (_req, _res, next) => next(),
    requirePermission:  () => (_req, _res, next) => next(),
    getUserFromRequest:  async (_req) => ({ id: callerId }),
    getAgencyUserIds:   async (_req, uid) => agencyIds || [uid],
  };

  factory(app, pool, middlewares, { publisher: publisherFn });
  return handler;
}

function makeReq(propertyId = 'prop1') {
  return {
    params: { property_id: propertyId },
    user:   { id: 'caller1' },
    query:  {},
    headers: { authorization: 'Bearer fake' },
  };
}

function makeRes() {
  const r = { _status: 200, _body: null };
  r.status = (code) => { r._status = code; return r; };
  r.json   = (body) => { r._body  = body; return r; };
  return r;
}

function baseProp(overrides = {}) {
  return {
    id:                  'prop1',
    user_id:             'owner1',
    name:                'Logement Test',
    base_price:          100,
    external_pricing:    false,
    channex_enabled:     true,
    channex_property_id: 'cx_p',
    channex_room_type_id:'cx_rt',
    channex_rate_plan_id:'cx_rp',
    ...overrides,
  };
}

/**
 * Pool that returns the given property for property queries.
 * Throws on any INSERT/UPDATE/DELETE, and on pricing_overrides/pricing_rules
 * when opts.rejectLegacyQueries is true (proves legacy engine was removed).
 */
function makePropPool(prop, opts = {}) {
  return {
    _queries: [],
    async query(sql, _params) {
      const s = sql.replace(/\s+/g, ' ').toLowerCase().trim();
      this._queries.push(s.slice(0, 100));

      if (s.startsWith('insert') || s.startsWith('update') || s.startsWith('delete')) {
        throw new Error('Pool: unexpected write: ' + s.slice(0, 60));
      }
      if (opts.rejectLegacyQueries) {
        if (s.includes('pricing_overrides') || (s.includes('pricing_rules') && s.includes('from'))) {
          throw new Error('Pool: legacy pricing query must not be issued: ' + s.slice(0, 60));
        }
      }
      if (s.includes('from properties')) return { rows: prop ? [prop] : [] };
      return { rows: [] };
    },
  };
}

/** Publisher spy that records calls and returns a canned result */
function spyPublisher(cannedResult, spy = {}) {
  return async (_pool, opts) => {
    spy.calls    = (spy.calls || 0) + 1;
    spy.lastArgs = opts;
    return cannedResult;
  };
}

function okResult(overrides = {}) {
  return {
    status:       PUBLISH_STATUS.OK,
    propertyId:   'prop1',
    reason:       'manual_push',
    nights:       500,
    rates:        { count: 500, pushed: 500, error: null },
    restrictions: { count: 500, pushed: 500, error: null },
    ...overrides,
  };
}

// ─── P2-01 — Factory wiring ───────────────────────────────────────────────────

console.log('\n── P2-01–P2-07 : Guards ──');

await test('P2-01 — factory wiring — handler monté sur POST /api/pricing/rules/push-channex/:property_id', async () => {
  let capturedPath = null;
  const app = { post: (path, _m1, _m2, _h) => { capturedPath = path; } };
  factory(app, makePropPool(baseProp()), {
    authenticateAny: () => {},
    requirePermission: () => () => {},
    getUserFromRequest: async () => ({ id: 'u1' }),
    getAgencyUserIds: async (_r, uid) => [uid],
  });
  assert.strictEqual(capturedPath, '/api/pricing/rules/push-channex/:property_id');
});

await test('P2-02 — property inaccessible (0 rows) → 404, publisher jamais appelé', async () => {
  const spy = {};
  const handler = captureHandler(makePropPool(null), spyPublisher(okResult(), spy));
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 404);
  assert.strictEqual(spy.calls || 0, 0, 'publisher must not be called');
});

await test('P2-03 — channex_enabled=false → 400, publisher jamais appelé', async () => {
  const spy = {};
  const handler = captureHandler(
    makePropPool(baseProp({ channex_enabled: false })),
    spyPublisher(okResult(), spy),
  );
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 400);
  assert.strictEqual(spy.calls || 0, 0);
});

await test('P2-04 — channex_property_id null → 400, publisher jamais appelé', async () => {
  const spy = {};
  const handler = captureHandler(
    makePropPool(baseProp({ channex_property_id: null })),
    spyPublisher(okResult(), spy),
  );
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 400);
  assert.strictEqual(spy.calls || 0, 0);
});

await test('P2-05 — channex_room_type_id null → 400, publisher jamais appelé', async () => {
  const spy = {};
  const handler = captureHandler(
    makePropPool(baseProp({ channex_room_type_id: null })),
    spyPublisher(okResult(), spy),
  );
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 400);
  assert.strictEqual(spy.calls || 0, 0);
});

await test('P2-06 — channex_rate_plan_id null → 400, publisher jamais appelé', async () => {
  const spy = {};
  const handler = captureHandler(
    makePropPool(baseProp({ channex_rate_plan_id: null })),
    spyPublisher(okResult(), spy),
  );
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 400);
  assert.strictEqual(spy.calls || 0, 0);
});

await test('P2-07 — external_pricing=true → 400, publisher jamais appelé', async () => {
  const spy = {};
  const handler = captureHandler(
    makePropPool(baseProp({ external_pricing: true })),
    spyPublisher(okResult(), spy),
  );
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 400);
  assert.match(res._body.error, /outil externe/i);
  assert.strictEqual(spy.calls || 0, 0, 'publisher must not be called for external_pricing');
});

// ─── P2-08–P2-14 : Publisher call contract ────────────────────────────────────

console.log('\n── P2-08–P2-14 : Contrat appel publisher ──');

await test('P2-08 — publisher appelé exactement une fois', async () => {
  const spy = {};
  const handler = captureHandler(makePropPool(baseProp()), spyPublisher(okResult(), spy));
  await handler(makeReq(), makeRes());
  assert.strictEqual(spy.calls, 1, 'publisher must be called exactly once');
});

await test('P2-09 — propertyId = prop.id (depuis DB, pas params bruts)', async () => {
  const spy = {};
  const prop = baseProp({ id: 'db_prop_id' });
  const handler = captureHandler(makePropPool(prop), spyPublisher(okResult(), spy));
  await handler(makeReq('db_prop_id'), makeRes());
  assert.strictEqual(spy.lastArgs.propertyId, 'db_prop_id');
});

await test('P2-10 — userId publisher = prop.user_id canonique (pas req.user.id)', async () => {
  const spy = {};
  // callerId = 'caller_not_owner', prop.user_id = 'real_owner'
  const prop = baseProp({ user_id: 'real_owner' });
  const handler = captureHandler(makePropPool(prop), spyPublisher(okResult(), spy), {
    callerId: 'caller_not_owner',
    agencyIds: ['caller_not_owner', 'real_owner'],
  });
  await handler(makeReq(), makeRes());
  assert.strictEqual(spy.lastArgs.userId, 'real_owner', 'userId must be prop.user_id, not caller id');
  assert.notStrictEqual(spy.lastArgs.userId, 'caller_not_owner');
});

await test('P2-11 — reason = \'manual_push\'', async () => {
  const spy = {};
  const handler = captureHandler(makePropPool(baseProp()), spyPublisher(okResult(), spy));
  await handler(makeReq(), makeRes());
  assert.strictEqual(spy.lastArgs.reason, 'manual_push');
});

await test('P2-12 — fenêtre 500 nuits : startDate=aujourd\'hui, endDate=addDays(start,500)', async () => {
  const spy = {};
  const handler = captureHandler(makePropPool(baseProp()), spyPublisher(okResult(), spy));
  const before = new Date(); before.setHours(12, 0, 0, 0);
  await handler(makeReq(), makeRes());
  const after = new Date();  after.setHours(12, 0, 0, 0);

  const startToday = before.toISOString().slice(0, 10);
  const startTomorrow = addDays(startToday, 1);
  assert.ok(
    spy.lastArgs.startDate >= startToday && spy.lastArgs.startDate <= startTomorrow,
    `startDate ${spy.lastArgs.startDate} must be today`,
  );
  assert.strictEqual(
    spy.lastArgs.endDate,
    addDays(spy.lastArgs.startDate, 500),
    'endDate must be addDays(startDate, 500)',
  );
});

await test('P2-13 — stopSellMode = \'true_only\'', async () => {
  const spy = {};
  const handler = captureHandler(makePropPool(baseProp()), spyPublisher(okResult(), spy));
  await handler(makeReq(), makeRes());
  assert.strictEqual(spy.lastArgs.stopSellMode, 'true_only');
});

await test('P2-14 — allowedDates absent du payload publisher', async () => {
  const spy = {};
  const handler = captureHandler(makePropPool(baseProp()), spyPublisher(okResult(), spy));
  await handler(makeReq(), makeRes());
  assert.ok(
    !Object.prototype.hasOwnProperty.call(spy.lastArgs, 'allowedDates') || spy.lastArgs.allowedDates === undefined,
    'allowedDates must not be passed (PATH2 is a full 500-day sync)',
  );
});

// ─── P2-15–P2-22 : HTTP mapping ───────────────────────────────────────────────

console.log('\n── P2-15–P2-22 : HTTP mapping ──');

await test('P2-15 — publisher ok → 200, ok:true, message compatible', async () => {
  const result = okResult({ rates: { count: 500, pushed: 500, error: null }, restrictions: { count: 500, pushed: 500, error: null } });
  const handler = captureHandler(makePropPool(baseProp()), spyPublisher(result));
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 200);
  assert.ok(res._body.ok === true || res._body.success === true, 'body must have ok or success=true');
  assert.ok(typeof res._body.message === 'string', 'message must be a string');
  assert.match(res._body.message, /^500 jours de tarifs \+ 500 jours de restrictions/);
});

await test('P2-16 — publisher partial → 200, partial:true, message honnête', async () => {
  const result = {
    status: PUBLISH_STATUS.PARTIAL,
    propertyId: 'prop1', reason: 'manual_push', nights: 500,
    rates:        { count: 500, pushed: 500, error: null },
    restrictions: { count: 500, pushed: 0,   error: 'timeout' },
  };
  const handler = captureHandler(makePropPool(baseProp()), spyPublisher(result));
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 200);
  assert.ok(res._body.partial === true, 'partial flag must be set');
  // rates pushed=500 but restrictions pushed=0
  assert.match(res._body.message, /500 jours de tarifs \+ 0 jours de restrictions/,
    'message must reflect actual pushed counts');
  assert.match(res._body.message, /partiel/i, 'message must mention partiel');
});

await test('P2-17 — publisher error → 500', async () => {
  const result = {
    status: PUBLISH_STATUS.ERROR,
    propertyId: 'prop1', reason: 'manual_push', nights: 500,
    rates:        { count: 500, pushed: 0, error: 'Channex 503' },
    restrictions: { count: 500, pushed: 0, error: 'Channex 503' },
  };
  const handler = captureHandler(makePropPool(baseProp()), spyPublisher(result));
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 500);
  assert.ok(typeof res._body.error === 'string', 'error message must be present');
});

await test('P2-18 — publisher skipped_external → 400', async () => {
  const result = { status: PUBLISH_STATUS.SKIPPED_EXTERNAL, propertyId: 'prop1', reason: 'manual_push',
    nights: 0, rates: { count: 0, pushed: 0, error: null }, restrictions: { count: 0, pushed: 0, error: null } };
  // Needs external_pricing=false to pass route guard, but publisher returns skipped
  const handler = captureHandler(makePropPool(baseProp()), spyPublisher(result));
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 400);
});

await test('P2-19 — publisher skipped_channex_disabled → 400', async () => {
  const result = { status: PUBLISH_STATUS.SKIPPED_CHANNEX_DISABLED, propertyId: 'prop1', reason: 'manual_push',
    nights: 0, rates: { count: 0, pushed: 0, error: null }, restrictions: { count: 0, pushed: 0, error: null } };
  const handler = captureHandler(makePropPool(baseProp()), spyPublisher(result));
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 400);
});

await test('P2-20 — publisher skipped_missing_ids → 400', async () => {
  const result = { status: PUBLISH_STATUS.SKIPPED_MISSING_IDS, propertyId: 'prop1', reason: 'manual_push',
    nights: 0, rates: { count: 0, pushed: 0, error: null }, restrictions: { count: 0, pushed: 0, error: null } };
  const handler = captureHandler(makePropPool(baseProp()), spyPublisher(result));
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 400);
});

await test('P2-21 — publisher skipped_not_found → 404', async () => {
  const result = { status: PUBLISH_STATUS.SKIPPED_NOT_FOUND, propertyId: 'prop1', reason: 'manual_push',
    nights: 0, rates: { count: 0, pushed: 0, error: null }, restrictions: { count: 0, pushed: 0, error: null } };
  const handler = captureHandler(makePropPool(baseProp()), spyPublisher(result));
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 404);
});

await test('P2-22 — publisher throw → 500 avec error générique', async () => {
  const throwPublisher = async () => { throw new Error('DB down'); };
  const handler = captureHandler(makePropPool(baseProp()), throwPublisher);
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 500);
  assert.ok(typeof res._body.error === 'string', 'error field must be present');
  // Stack/secret must not be exposed
  assert.ok(!res._body.error.includes('DB down'), 'internal error must not be exposed to frontend');
});

// ─── P2-23–P2-26 : Isolation ──────────────────────────────────────────────────

console.log('\n── P2-23–P2-26 : Isolation (legacy supprimé) ──');

await test('P2-23 — aucun appel direct pushRates (isolation)', async () => {
  let pushRatesCalled = false;
  // Inject pushRates tracker into require.cache
  const channexPath = require.resolve('../channex');
  const originalChannex = require.cache[channexPath];
  require.cache[channexPath] = {
    id: channexPath, filename: channexPath, loaded: true,
    exports: {
      ...require('../channex'),
      pushRates:        async () => { pushRatesCalled = true; return { count: 0 }; },
      pushRestrictions: async () => ({ count: 0 }),
    },
  };
  try {
    const spy = {};
    const handler = captureHandler(makePropPool(baseProp()), spyPublisher(okResult(), spy));
    await handler(makeReq(), makeRes());
    assert.strictEqual(pushRatesCalled, false, 'pushRates must not be called directly — must go via publisher');
  } finally {
    require.cache[channexPath] = originalChannex;
  }
});

await test('P2-24 — aucun appel direct pushRestrictions (isolation)', async () => {
  let pushRestrictionsCalled = false;
  const channexPath = require.resolve('../channex');
  const originalChannex = require.cache[channexPath];
  require.cache[channexPath] = {
    id: channexPath, filename: channexPath, loaded: true,
    exports: {
      ...require('../channex'),
      pushRates:        async () => ({ count: 0 }),
      pushRestrictions: async () => { pushRestrictionsCalled = true; return { count: 0 }; },
    },
  };
  try {
    const spy = {};
    const handler = captureHandler(makePropPool(baseProp()), spyPublisher(okResult(), spy));
    await handler(makeReq(), makeRes());
    assert.strictEqual(pushRestrictionsCalled, false, 'pushRestrictions must not be called directly');
  } finally {
    require.cache[channexPath] = originalChannex;
  }
});

await test('P2-25 — aucune application locale long_stay (prix non transformé par la route)', async () => {
  // The route must not load pricing_rules or apply any discount. We prove this
  // by rejecting pool queries that touch pricing_overrides or pricing_rules FROM.
  const spy = {};
  const strictPool = makePropPool(baseProp(), { rejectLegacyQueries: true });
  const handler = captureHandler(strictPool, spyPublisher(okResult(), spy));
  const res = makeRes();
  // Must not throw (rejectLegacyQueries would throw if those queries are issued)
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 200, 'route must not issue legacy pricing queries');
  assert.strictEqual(spy.calls, 1, 'publisher must still be called');
});

await test('P2-26 — aucune résolution locale du prix (pricing_overrides/rules non chargés)', async () => {
  const strictPool = makePropPool(baseProp(), { rejectLegacyQueries: true });
  const res = makeRes();
  const handler = captureHandler(strictPool, spyPublisher(okResult()));
  // Should complete without error — no legacy queries issued
  await assert.doesNotReject(
    () => handler(makeReq(), res),
    'route must not query pricing_overrides or pricing_rules',
  );
});

// ─── P2-27 : Delegated caller ─────────────────────────────────────────────────

console.log('\n── P2-27 : Caller délégué ──');

await test('P2-27 — caller != prop.user_id → accès accepté si agencyIds permet, userId publisher = prop.user_id', async () => {
  const spy = {};
  const prop = baseProp({ user_id: 'real_owner', id: 'prop1' });
  // caller is 'delegated_user', agencyIds includes the real owner (delegation)
  const handler = captureHandler(makePropPool(prop), spyPublisher(okResult(), spy), {
    callerId:  'delegated_user',
    agencyIds: ['delegated_user', 'real_owner'],
  });
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 200, 'delegated caller must be allowed access');
  assert.strictEqual(spy.calls, 1, 'publisher must be called');
  assert.strictEqual(spy.lastArgs.userId, 'real_owner',
    'publisher userId must be prop.user_id (canonical owner), not the delegated caller');
});

// ─── P2-BP : BoostPrice semantic proof (B19) ──────────────────────────────────
// These tests use a real publisher + resolver to prove that PATH 2, after migration,
// sends the BoostPrice-effective price (not the base/legacy price).

console.log('\n── P2-BP : Preuve sémantique BoostPrice ──');

const { createPublisher }          = require('../routes/pricing-publisher');
const { resolveEffectivePrices }   = require('../routes/effective-pricing-resolver');

const TODAY = new Date(); TODAY.setHours(12, 0, 0, 0);
const BP_DATE = TODAY.toISOString().slice(0, 10);

function makeBpPool(tables = {}) {
  const pool = {
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, ' ').toLowerCase();
      if (s.includes('from properties'))
        return { rows: tables.properties || [] };
      if (s.includes('from pricing_overrides'))
        return { rows: (tables.pricing_overrides || []).filter(r => r.date >= params[2] && r.date < params[3]) };
      if (s.includes('from pricing_schedule'))
        return { rows: (tables.pricing_schedule || []).filter(r =>
          r.date >= params[1] && r.date < params[2] &&
          (sql.includes("'pending'") ? r.status === 'pending' : r.status === 'applied')
        ) };
      if (s.includes('from pricing_rules'))
        return { rows: (tables.pricing_rules || []).filter(r => r.active !== false) };
      if (s.includes('from pricing_config'))
        return { rows: tables.pricing_config || [] };
      return { rows: [] };
    },
  };
  return pool;
}

function makeBpPublisher(ratesSpy = {}) {
  return createPublisher({
    pushRates: async (_pool, { rates }) => {
      ratesSpy.rates = rates;
      return { count: rates.length };
    },
    pushRestrictions: async (_pool, { restrictions }) => ({ count: restrictions.length }),
    resolveEffectivePrices,
  });
}

// pricing_config with is_active:true is required for the resolver to enable BoostPrice
const BP_CONFIG = [{ property_id: 'p1', user_id: 'u1', is_active: true }];
const BP_PROP   = { id: 'p1', user_id: 'u1', channex_enabled: true, external_pricing: false,
                    channex_property_id: 'cx_p', channex_room_type_id: 'cx_rt', channex_rate_plan_id: 'cx_rp',
                    base_price: 75, weekend_price: null };

await test('P2-BP01 — BoostPrice applied=99, base=75 → publisher envoie 99', async () => {
  const ratesSpy = {};
  const publish = makeBpPublisher(ratesSpy);
  const pool = makeBpPool({
    properties:       [BP_PROP],
    pricing_schedule: [{ date: BP_DATE, price: 99, status: 'applied' }],
    pricing_rules: [], pricing_overrides: [], pricing_config: BP_CONFIG,
  });
  await publish(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: BP_DATE, endDate: addDays(BP_DATE, 1),
    reason: 'bp_test', stopSellMode: 'true_only',
  });
  const pushed = ratesSpy.rates?.find(r => r.date === BP_DATE);
  assert.ok(pushed, `rate for ${BP_DATE} must be pushed`);
  assert.strictEqual(pushed.price, 99, 'BoostPrice applied (99) must win over base (75)');
});

await test('P2-BP02 — override=105, BoostPrice applied=99 → 105', async () => {
  const ratesSpy = {};
  const publish = makeBpPublisher(ratesSpy);
  const pool = makeBpPool({
    properties:       [BP_PROP],
    pricing_schedule: [{ date: BP_DATE, price: 99, status: 'applied' }],
    pricing_overrides: [{ date: BP_DATE, price: 105 }],
    pricing_rules: [], pricing_config: BP_CONFIG,
  });
  await publish(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: BP_DATE, endDate: addDays(BP_DATE, 1),
    reason: 'bp_test', stopSellMode: 'true_only',
  });
  const pushed = ratesSpy.rates?.find(r => r.date === BP_DATE);
  assert.strictEqual(pushed.price, 105, 'override (105) must win over BoostPrice (99)');
});

await test('P2-BP03 — BoostPrice pending=99, base=75 → 75 (pending ignoré)', async () => {
  const ratesSpy = {};
  const publish = makeBpPublisher(ratesSpy);
  const pool = makeBpPool({
    properties:       [{ id: 'p1', user_id: 'u1', channex_enabled: true, external_pricing: false,
                         channex_property_id: 'cx_p', channex_room_type_id: 'cx_rt', channex_rate_plan_id: 'cx_rp',
                         base_price: 75, weekend_price: null }],
    pricing_schedule: [{ date: BP_DATE, price: 99, status: 'pending' }],
    pricing_rules: [], pricing_overrides: [], pricing_config: [],
  });
  await publish(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: BP_DATE, endDate: addDays(BP_DATE, 1),
    reason: 'bp_test', stopSellMode: 'true_only',
  });
  const pushed = ratesSpy.rates?.find(r => r.date === BP_DATE);
  assert.ok(pushed, `rate for ${BP_DATE} must be pushed`);
  assert.strictEqual(pushed.price, 75, 'BoostPrice pending (99) must NOT override base (75)');
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(55)}`);
console.log(`  Résultats : ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\n  Échecs :');
  failures.forEach(f => console.log(`    • ${f.name}\n      ${f.message}`));
}
process.exit(failed > 0 ? 1 : 0);

})();
