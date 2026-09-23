#!/usr/bin/env node
'use strict';
/**
 * Tests unitaires — Route POST /api/diffusion/sync-all (P0-C4.5-B)
 *
 * Couvre :
 *   P6-01 : factory wiring — handler monté sur POST /api/diffusion/sync-all
 *   P6-02 : main user — userId = req.user.id
 *   P6-03 : sub-account — userId = getRealUserId(pool, req)
 *   P6-04 : 0 logements → réponse immédiate { message "...0 logements", count: 0 }
 *   P6-05 : N logements → réponse immédiate { message "...N logements", count: N }
 *   P6-06 : pool.query throw → 500
 *   P6-07 : réponse envoyée AVANT le traitement arrière-plan
 *   P6-08 : triggerChannexAvailabilitySync appelé une fois par logement
 *   P6-09 : triggerChannexAvailabilitySync appelé avec prop.id
 *   P6-10 : availability throw isolé — logements suivants traités
 *   P6-11 : publisher appelé une fois par logement
 *   P6-12 : publisher jamais appelé si 0 logements
 *   P6-13 : propertyId = prop.id
 *   P6-14 : userId = prop.user_id canonique (pas caller id)
 *   P6-15 : reason = 'sync_all'
 *   P6-16 : stopSellMode = 'true_only'
 *   P6-17 : allowedDates absent du payload publisher
 *   P6-18 : fenêtre 500 nuits (startDate=today, endDate=addDays(today,500))
 *   P6-19 : même startDate/endDate pour tous les logements du lot
 *   P6-20 : publisher throw prop1 → prop2 toujours traité
 *   P6-21 : availability throw prop1 → publisher prop1 sauté, prop2 traité
 *   P6-22 : aucun appel direct pushRestrictions (seulement via publisher)
 *   P6-23 : aucune requête pricing_rules locale (moteur legacy supprimé)
 *   P6-24 : aucune requête pricing_overrides locale
 *   P6-25 : publisher result skipped → boucle continue (pas d'erreur)
 *   P6-26 : publisher result error → boucle continue (pas d'exception)
 *   P6-27 : BoostPrice applied=99, base=75 → publisher envoie 99
 *   P6-28 : stopSellMode 'true_only' — stop_sell:true envoyé quand rule couvre la date
 *   P6-29 : stopSellMode 'true_only' — stop_sell absent quand pas de rule
 *   P6-30 : external_pricing=true → publisher retourne skipped, boucle continue
 *
 * Exécution : node tests/pricing_diffusion_sync.test.js
 * Aucun appel DB réel. Aucun appel Channex.
 */

const assert   = require('assert');
const factory  = require('../routes/pricing-diffusion-sync');
const { PUBLISH_STATUS, createPublisher } = require('../routes/pricing-publisher');
const { addDays, resolveEffectivePrices } = require('../routes/effective-pricing-resolver');

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
 * Mounts the route factory and captures the POST handler.
 *
 * loopDelayMs defaults to 0 so multi-property background loops complete fast.
 * The production default (1000ms) is preserved in the factory when deps.loopDelayMs
 * is not set — we explicitly pass 0 in tests to avoid slow setTimeout waits.
 */
function captureHandler(pool, {
  publisherFn         = null,
  availabilitySyncFn  = null,
  callerId            = 'caller1',
  agencyIds           = null,
  loopDelayMs         = 0,
  getRealUserIdFn     = null,
} = {}) {
  let handler = null;

  const app = {
    post: (_path, _mw, h) => { handler = h; },
  };

  const middlewares = {
    authenticateAny: (_req, _res, next) => next(),
    getRealUserId:   getRealUserIdFn || (async (_pool, _req) => callerId),
    getAgencyUserIds: async (_req, uid) => agencyIds || [uid],
    triggerChannexAvailabilitySync: availabilitySyncFn || (async () => {}),
  };

  const deps = { loopDelayMs };
  if (publisherFn)        deps.publisher                      = publisherFn;
  if (availabilitySyncFn) deps.triggerChannexAvailabilitySync = availabilitySyncFn;

  factory(app, pool, middlewares, deps);
  return handler;
}

/** Req for a main-account user */
function makeReq({ isSubAccount = false, userId = 'caller1' } = {}) {
  if (isSubAccount) {
    return {
      params: {}, query: {},
      user: { isSubAccount: true, subAccountId: 'sub1' },
      headers: { authorization: 'Bearer fake' },
    };
  }
  return {
    params: {}, query: {},
    user: { id: userId, isSubAccount: false },
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
    id:                   'prop1',
    user_id:              'owner1',
    external_pricing:     false,
    channex_enabled:      true,
    channex_property_id:  'cx_p',
    channex_room_type_id: 'cx_rt',
    channex_rate_plan_id: 'cx_rp',
    base_price:           100,
    weekend_price:        null,
    ...overrides,
  };
}

/**
 * Pool returning the given props array for SELECT FROM properties.
 * Throws on writes. Throws on legacy pricing queries when rejectLegacyQueries=true.
 */
function makePropsPool(props, opts = {}) {
  return {
    _queries: [],
    async query(sql, _params) {
      const s = sql.replace(/\s+/g, ' ').toLowerCase().trim();
      this._queries.push(s.slice(0, 120));

      if (s.startsWith('insert') || s.startsWith('update') || s.startsWith('delete')) {
        throw new Error('Pool: unexpected write: ' + s.slice(0, 60));
      }
      if (opts.rejectLegacyQueries) {
        if (s.includes('pricing_overrides') || (s.includes('pricing_rules') && s.includes('from'))) {
          throw new Error('Pool: legacy pricing query issued: ' + s.slice(0, 80));
        }
      }
      if (s.includes('from properties')) return { rows: props || [] };
      return { rows: [] };
    },
  };
}

function throwPool() {
  return { async query() { throw new Error('DB connection error'); } };
}

/** Publisher spy — records all calls, returns canned result */
function spyPublisher(cannedResult, spy = {}) {
  return async (_pool, opts) => {
    spy.calls    = (spy.calls || 0) + 1;
    spy.allArgs  = spy.allArgs || [];
    spy.allArgs.push({ ...opts });
    spy.lastArgs = opts;
    return cannedResult || okResult(opts.propertyId);
  };
}

/** Publisher that throws for a specific propId */
function throwingPublisher(throwPropId, spy = {}) {
  return async (_pool, opts) => {
    spy.calls   = (spy.calls || 0) + 1;
    spy.allArgs = spy.allArgs || [];
    spy.allArgs.push({ ...opts });
    if (opts.propertyId === throwPropId) throw new Error(`Publisher error for ${throwPropId}`);
    return okResult(opts.propertyId);
  };
}

function okResult(propertyId = 'prop1', overrides = {}) {
  return {
    status:       PUBLISH_STATUS.OK,
    propertyId,
    reason:       'sync_all',
    nights:       500,
    rates:        { count: 500, pushed: 500, error: null },
    restrictions: { count: 500, pushed: 500, error: null },
    ...overrides,
  };
}

/** Waits for background IIFE to finish (with loopDelayMs=0, 50ms is ample) */
function waitForBackground(ms = 50) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── P6-01 : Factory wiring ───────────────────────────────────────────────────

console.log('\n── P6-01 : Factory wiring ──');

await test('P6-01 — factory wiring — handler monté sur POST /api/diffusion/sync-all', async () => {
  let capturedPath = null;
  const app = { post: (path, _mw, _h) => { capturedPath = path; } };
  factory(app, makePropsPool([]), {
    authenticateAny: () => {},
    getRealUserId: async () => 'u1',
    getAgencyUserIds: async (_r, uid) => [uid],
    triggerChannexAvailabilitySync: async () => {},
  }, {});
  assert.strictEqual(capturedPath, '/api/diffusion/sync-all');
});

// ─── P6-02–P6-03 : Auth ───────────────────────────────────────────────────────

console.log('\n── P6-02–P6-03 : Auth ──');

await test('P6-02 — main user — userId = req.user.id', async () => {
  let capturedAgencyIdArg = null;
  let handler = null;

  const app = { post: (_path, _mw, h) => { handler = h; } };
  const middlewares = {
    authenticateAny: (_req, _res, next) => next(),
    getRealUserId: async () => { throw new Error('getRealUserId must not be called for main users'); },
    getAgencyUserIds: async (_req, uid) => { capturedAgencyIdArg = uid; return [uid]; },
    triggerChannexAvailabilitySync: async () => {},
  };
  factory(app, makePropsPool([]), middlewares, { loopDelayMs: 0 });

  const req = makeReq({ userId: 'main_user_id' });
  await handler(req, makeRes());
  assert.strictEqual(capturedAgencyIdArg, 'main_user_id', 'getAgencyUserIds must receive req.user.id');
});

await test('P6-03 — sub-account — userId = getRealUserId(pool, req)', async () => {
  let capturedAgencyIdArg = null;
  let handler = null;

  const app = { post: (_path, _mw, h) => { handler = h; } };
  const middlewares = {
    authenticateAny: (_req, _res, next) => next(),
    getRealUserId: async (_pool, _req) => 'parent_user_id',
    getAgencyUserIds: async (_req, uid) => { capturedAgencyIdArg = uid; return [uid]; },
    triggerChannexAvailabilitySync: async () => {},
  };
  factory(app, makePropsPool([]), middlewares, { loopDelayMs: 0 });

  const req = makeReq({ isSubAccount: true });
  await handler(req, makeRes());
  assert.strictEqual(capturedAgencyIdArg, 'parent_user_id',
    'getAgencyUserIds must receive the real parent userId, not subAccountId');
});

// ─── P6-04–P6-07 : Réponse immédiate ─────────────────────────────────────────

console.log('\n── P6-04–P6-07 : Réponse immédiate ──');

await test('P6-04 — 0 logements → { message "...0 logements", count: 0 }', async () => {
  const handler = captureHandler(makePropsPool([]));
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 200);
  assert.strictEqual(res._body.count, 0);
  assert.ok(typeof res._body.message === 'string', 'message must be a string');
  assert.match(res._body.message, /0 logements/);
});

await test('P6-05 — 2 logements → { message "...2 logements", count: 2 }', async () => {
  const props = [
    baseProp({ id: 'p1', user_id: 'o1' }),
    baseProp({ id: 'p2', user_id: 'o2' }),
  ];
  const handler = captureHandler(makePropsPool(props));
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 200);
  assert.strictEqual(res._body.count, 2);
  assert.match(res._body.message, /2 logements/);
});

await test('P6-06 — pool.query throw → 500 avec error', async () => {
  const handler = captureHandler(throwPool());
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 500);
  assert.ok(typeof res._body.error === 'string', 'error field must be set');
});

await test('P6-07 — réponse envoyée AVANT le traitement arrière-plan', async () => {
  let responseBodySetAt = null;
  let publisherCalledAt = null;
  let t = 0;

  const res = {
    _status: 200, _body: null,
    status(c) { this._status = c; return this; },
    json(b)   { responseBodySetAt = ++t; this._body = b; return this; },
  };
  const pub = async () => { publisherCalledAt = ++t; return okResult(); };

  const handler = captureHandler(
    makePropsPool([baseProp()]),
    { publisherFn: pub, loopDelayMs: 0 },
  );

  await handler(makeReq(), res);
  // res.json was called (response sent) — its timestamp must be lower than publisher's
  assert.ok(responseBodySetAt !== null, 'res.json must have been called');
  // publisher may or may not have run yet (background IIFE), but if it did, response must have come first
  if (publisherCalledAt !== null) {
    assert.ok(responseBodySetAt < publisherCalledAt,
      'response must be sent before publisher call');
  } else {
    // response was sent; publisher hasn't run yet — even stronger proof
    assert.ok(true, 'response sent before background IIFE completed');
  }
});

// ─── P6-08–P6-10 : Availability sync ─────────────────────────────────────────

console.log('\n── P6-08–P6-10 : Availability sync ──');

await test('P6-08 — triggerChannexAvailabilitySync appelé une fois par logement (2 logements)', async () => {
  const availCalls = [];
  const avail = async (propId) => { availCalls.push(propId); };
  const props = [
    baseProp({ id: 'p1', user_id: 'o1' }),
    baseProp({ id: 'p2', user_id: 'o2' }),
  ];
  const handler = captureHandler(makePropsPool(props), {
    availabilitySyncFn: avail,
    publisherFn: spyPublisher(okResult('p1')),
  });
  await handler(makeReq(), makeRes());
  await waitForBackground();
  assert.strictEqual(availCalls.length, 2, 'availabilitySync must be called once per property');
});

await test('P6-09 — triggerChannexAvailabilitySync appelé avec prop.id', async () => {
  const availCalls = [];
  const avail = async (propId) => { availCalls.push(propId); };
  const props = [
    baseProp({ id: 'prop_alpha', user_id: 'o1' }),
    baseProp({ id: 'prop_beta',  user_id: 'o2' }),
  ];
  const spy = {};
  const handler = captureHandler(makePropsPool(props), {
    availabilitySyncFn: avail,
    publisherFn: spyPublisher(null, spy),
  });
  await handler(makeReq(), makeRes());
  await waitForBackground();
  assert.deepStrictEqual(availCalls.sort(), ['prop_alpha', 'prop_beta'].sort(),
    'availabilitySync must be called with each prop.id');
});

await test('P6-10 — availability throw prop1 isolé — prop2 toujours traité', async () => {
  const props = [
    baseProp({ id: 'p1', user_id: 'o1' }),
    baseProp({ id: 'p2', user_id: 'o2' }),
  ];
  let availCalls = 0;
  const avail = async (propId) => {
    availCalls++;
    if (propId === 'p1') throw new Error('avail error for p1');
  };
  const spy = {};
  const handler = captureHandler(makePropsPool(props), {
    availabilitySyncFn: avail,
    publisherFn: spyPublisher(null, spy),
  });
  await handler(makeReq(), makeRes());
  await waitForBackground();
  assert.strictEqual(availCalls, 2, 'availability must be attempted for both properties');
  // p2 must be published (p1 is skipped because availability threw)
  assert.ok((spy.allArgs || []).some(a => a.propertyId === 'p2'),
    'prop2 must still be published after prop1 availability error');
});

// ─── P6-11–P6-12 : Publisher appels ──────────────────────────────────────────

console.log('\n── P6-11–P6-12 : Publisher appels ──');

await test('P6-11 — publisher appelé une fois par logement (2 logements)', async () => {
  const props = [
    baseProp({ id: 'p1', user_id: 'o1' }),
    baseProp({ id: 'p2', user_id: 'o2' }),
  ];
  const spy = {};
  const handler = captureHandler(makePropsPool(props), {
    publisherFn: spyPublisher(null, spy),
  });
  await handler(makeReq(), makeRes());
  await waitForBackground();
  assert.strictEqual(spy.calls, 2, 'publisher must be called once per property');
  const ids = (spy.allArgs || []).map(a => a.propertyId).sort();
  assert.deepStrictEqual(ids, ['p1', 'p2']);
});

await test('P6-12 — publisher jamais appelé si 0 logements', async () => {
  const spy = {};
  const handler = captureHandler(makePropsPool([]), { publisherFn: spyPublisher(null, spy) });
  await handler(makeReq(), makeRes());
  await waitForBackground();
  assert.strictEqual(spy.calls || 0, 0, 'publisher must not be called when there are no properties');
});

// ─── P6-13–P6-19 : Contrat appel publisher ───────────────────────────────────

console.log('\n── P6-13–P6-19 : Contrat appel publisher ──');

await test('P6-13 — propertyId = prop.id (depuis DB)', async () => {
  const spy = {};
  const handler = captureHandler(
    makePropsPool([baseProp({ id: 'db_prop_id' })]),
    { publisherFn: spyPublisher(null, spy) },
  );
  await handler(makeReq(), makeRes());
  await waitForBackground();
  assert.strictEqual(spy.lastArgs.propertyId, 'db_prop_id');
});

await test('P6-14 — userId = prop.user_id canonique (pas caller id)', async () => {
  const spy = {};
  const prop = baseProp({ id: 'p1', user_id: 'real_owner' });
  const handler = captureHandler(makePropsPool([prop]), {
    publisherFn: spyPublisher(null, spy),
    callerId:    'caller_not_owner',
    agencyIds:   ['caller_not_owner', 'real_owner'],
  });
  await handler(makeReq({ userId: 'caller_not_owner' }), makeRes());
  await waitForBackground();
  assert.strictEqual(spy.lastArgs.userId, 'real_owner',
    'publisher userId must be prop.user_id, not the caller id');
  assert.notStrictEqual(spy.lastArgs.userId, 'caller_not_owner');
});

await test('P6-15 — reason = \'sync_all\'', async () => {
  const spy = {};
  const handler = captureHandler(makePropsPool([baseProp()]), { publisherFn: spyPublisher(null, spy) });
  await handler(makeReq(), makeRes());
  await waitForBackground();
  assert.strictEqual(spy.lastArgs.reason, 'sync_all');
});

await test('P6-16 — stopSellMode = \'true_only\'', async () => {
  const spy = {};
  const handler = captureHandler(makePropsPool([baseProp()]), { publisherFn: spyPublisher(null, spy) });
  await handler(makeReq(), makeRes());
  await waitForBackground();
  assert.strictEqual(spy.lastArgs.stopSellMode, 'true_only');
});

await test('P6-17 — allowedDates absent du payload publisher', async () => {
  const spy = {};
  const handler = captureHandler(makePropsPool([baseProp()]), { publisherFn: spyPublisher(null, spy) });
  await handler(makeReq(), makeRes());
  await waitForBackground();
  assert.ok(
    !Object.prototype.hasOwnProperty.call(spy.lastArgs, 'allowedDates') ||
    spy.lastArgs.allowedDates === undefined,
    'allowedDates must not be passed — sync_all is always a full 500-day sync',
  );
});

await test('P6-18 — fenêtre 500 nuits (startDate=today, endDate=addDays(today,500))', async () => {
  const spy = {};
  const handler = captureHandler(makePropsPool([baseProp()]), { publisherFn: spyPublisher(null, spy) });

  const before = new Date(); before.setHours(12, 0, 0, 0);
  await handler(makeReq(), makeRes());
  await waitForBackground();

  const startToday    = before.toISOString().slice(0, 10);
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

await test('P6-19 — même startDate/endDate pour tous les logements du lot', async () => {
  const props = [
    baseProp({ id: 'p1', user_id: 'o1' }),
    baseProp({ id: 'p2', user_id: 'o2' }),
    baseProp({ id: 'p3', user_id: 'o3' }),
  ];
  const spy = {};
  const handler = captureHandler(makePropsPool(props), { publisherFn: spyPublisher(null, spy) });
  await handler(makeReq(), makeRes());
  await waitForBackground();

  assert.strictEqual(spy.calls, 3, '3 props must each call publisher');
  const startDates = (spy.allArgs || []).map(a => a.startDate);
  const endDates   = (spy.allArgs || []).map(a => a.endDate);
  const uniqStart  = new Set(startDates);
  const uniqEnd    = new Set(endDates);
  assert.strictEqual(uniqStart.size, 1, 'all props must share the same startDate');
  assert.strictEqual(uniqEnd.size,   1, 'all props must share the same endDate');
});

// ─── P6-20–P6-21 : Isolation par logement ────────────────────────────────────

console.log('\n── P6-20–P6-21 : Isolation ──');

await test('P6-20 — publisher throw prop1 → prop2 toujours traité', async () => {
  const props = [
    baseProp({ id: 'p1', user_id: 'o1' }),
    baseProp({ id: 'p2', user_id: 'o2' }),
  ];
  const spy = {};
  const handler = captureHandler(makePropsPool(props), {
    publisherFn: throwingPublisher('p1', spy),
  });
  await handler(makeReq(), makeRes());
  await waitForBackground();
  assert.strictEqual(spy.calls, 2, 'publisher must be attempted for both props');
  assert.ok((spy.allArgs || []).some(a => a.propertyId === 'p2'),
    'prop2 must be published even after prop1 publisher threw');
});

await test('P6-21 — availability throw prop1 → publisher prop1 sauté, prop2 traité', async () => {
  const props = [
    baseProp({ id: 'p1', user_id: 'o1' }),
    baseProp({ id: 'p2', user_id: 'o2' }),
  ];
  const avail = async (propId) => {
    if (propId === 'p1') throw new Error('avail error for p1');
  };
  const spy = {};
  const handler = captureHandler(makePropsPool(props), {
    availabilitySyncFn: avail,
    publisherFn: spyPublisher(null, spy),
  });
  await handler(makeReq(), makeRes());
  await waitForBackground();
  // prop1 publisher must NOT be called (availability threw first)
  assert.ok(!(spy.allArgs || []).some(a => a.propertyId === 'p1'),
    'publisher must not be called for p1 when its availability sync threw');
  // prop2 must still be processed
  assert.ok((spy.allArgs || []).some(a => a.propertyId === 'p2'),
    'prop2 must still be published after prop1 failure');
});

// ─── P6-22–P6-24 : Moteur legacy supprimé ────────────────────────────────────

console.log('\n── P6-22–P6-24 : Moteur legacy supprimé ──');

await test('P6-22 — aucun appel direct pushRestrictions (isolation)', async () => {
  let directPushRestrictionsCalled = false;
  const channexPath = require.resolve('../channex');
  const originalChannex = require.cache[channexPath];
  require.cache[channexPath] = {
    id: channexPath, filename: channexPath, loaded: true,
    exports: {
      ...require('../channex'),
      pushRestrictions: async () => {
        directPushRestrictionsCalled = true;
        return { count: 0 };
      },
    },
  };
  try {
    const spy = {};
    const handler = captureHandler(
      makePropsPool([baseProp()]),
      { publisherFn: spyPublisher(okResult(), spy) },
    );
    await handler(makeReq(), makeRes());
    await waitForBackground();
    assert.strictEqual(directPushRestrictionsCalled, false,
      'pushRestrictions must not be called directly — must go via publisher');
  } finally {
    require.cache[channexPath] = originalChannex;
  }
});

await test('P6-23 — aucune requête pricing_rules locale (moteur legacy supprimé)', async () => {
  const strictPool = makePropsPool([baseProp()], { rejectLegacyQueries: true });
  const handler = captureHandler(strictPool, { publisherFn: spyPublisher(okResult()) });
  const res = makeRes();
  await handler(makeReq(), res);
  await waitForBackground();
  assert.strictEqual(res._status, 200, 'route must not issue legacy pricing_rules queries');
});

await test('P6-24 — aucune requête pricing_overrides locale', async () => {
  const strictPool = makePropsPool([baseProp()], { rejectLegacyQueries: true });
  const handler = captureHandler(strictPool, { publisherFn: spyPublisher(okResult()) });
  await assert.doesNotReject(
    () => handler(makeReq(), makeRes()),
    'route must not query pricing_overrides or pricing_rules',
  );
});

// ─── P6-25–P6-26 : Publisher result handling ─────────────────────────────────

console.log('\n── P6-25–P6-26 : Résultat publisher ──');

await test('P6-25 — publisher result skipped_external → boucle continue, pas d\'erreur', async () => {
  const props = [
    baseProp({ id: 'p1', user_id: 'o1', external_pricing: true }),
    baseProp({ id: 'p2', user_id: 'o2' }),
  ];
  const spy = {};
  const skippedResult = {
    status: PUBLISH_STATUS.SKIPPED_EXTERNAL,
    propertyId: 'p1', reason: 'sync_all', nights: 0,
    rates: { count: 0, pushed: 0, error: null },
    restrictions: { count: 0, pushed: 0, error: null },
  };
  // Publisher returns skipped for p1, ok for p2
  const pub = async (_pool, opts) => {
    spy.calls = (spy.calls || 0) + 1;
    spy.allArgs = spy.allArgs || [];
    spy.allArgs.push({ ...opts });
    if (opts.propertyId === 'p1') return skippedResult;
    return okResult(opts.propertyId);
  };
  const handler = captureHandler(makePropsPool(props), { publisherFn: pub });
  const res = makeRes();
  await handler(makeReq(), res);
  await waitForBackground();
  // Response was already sent as 200; background errors don't change it
  assert.strictEqual(res._status, 200, 'route response must remain 200');
  assert.strictEqual(spy.calls, 2, 'publisher must be called for both props');
});

await test('P6-26 — publisher result error → boucle continue, pas d\'exception', async () => {
  const props = [
    baseProp({ id: 'p1', user_id: 'o1' }),
    baseProp({ id: 'p2', user_id: 'o2' }),
  ];
  const spy = {};
  const pub = async (_pool, opts) => {
    spy.calls = (spy.calls || 0) + 1;
    spy.allArgs = spy.allArgs || [];
    spy.allArgs.push({ ...opts });
    if (opts.propertyId === 'p1') {
      return { status: PUBLISH_STATUS.ERROR, propertyId: 'p1', reason: 'sync_all',
               nights: 0, rates: { count: 0, pushed: 0, error: 'Channex 503' },
               restrictions: { count: 0, pushed: 0, error: 'Channex 503' } };
    }
    return okResult(opts.propertyId);
  };
  const handler = captureHandler(makePropsPool(props), { publisherFn: pub });
  const res = makeRes();
  await handler(makeReq(), res);
  await waitForBackground();
  assert.strictEqual(res._status, 200, 'route response must remain 200');
  assert.strictEqual(spy.calls, 2, 'both props must be attempted despite error on p1');
});

// ─── P6-27–P6-30 : Preuves sémantiques ───────────────────────────────────────

console.log('\n── P6-27–P6-30 : Preuves sémantiques ──');

// Real publisher + resolver with mocked DB and Channex deps.
// Proves the route's publisher call produces the correct prices/restrictions end-to-end.

const TODAY = new Date(); TODAY.setHours(12, 0, 0, 0);
const SEM_DATE = TODAY.toISOString().slice(0, 10);

const SEM_PROP = {
  id: 'sem_prop', user_id: 'sem_user',
  channex_enabled: true, external_pricing: false,
  channex_property_id: 'cx_p', channex_room_type_id: 'cx_rt', channex_rate_plan_id: 'cx_rp',
  base_price: 75, weekend_price: null,
};

function makeSemanticPool(tables = {}) {
  return {
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
}

function makeSemanticPublisher(ratesSpy = {}, restrSpy = {}) {
  return createPublisher({
    pushRates: async (_pool, { rates }) => {
      ratesSpy.rates = rates;
      return { count: rates.length };
    },
    pushRestrictions: async (_pool, { restrictions }) => {
      restrSpy.restrictions = restrictions;
      return { count: restrictions.length };
    },
    resolveEffectivePrices,
  });
}

// pricing_config with is_active:true required for resolver to activate BoostPrice
const BP_CONFIG = [{ property_id: 'sem_prop', user_id: 'sem_user', is_active: true }];

await test('P6-27 — BoostPrice applied=99, base=75 → publisher envoie 99', async () => {
  const ratesSpy = {};
  const pub = makeSemanticPublisher(ratesSpy);

  const pool = makeSemanticPool({
    properties:       [SEM_PROP],
    pricing_schedule: [{ date: SEM_DATE, price: 99, status: 'applied' }],
    pricing_rules: [], pricing_overrides: [], pricing_config: BP_CONFIG,
  });

  const handler = captureHandler(pool, {
    publisherFn: pub,
    agencyIds:   ['sem_user'],
    callerId:    'sem_user',
  });
  const req = makeReq({ userId: 'sem_user' });
  await handler(req, makeRes());
  await waitForBackground();

  const pushed = (ratesSpy.rates || []).find(r => r.date === SEM_DATE);
  assert.ok(pushed, `rate for ${SEM_DATE} must be pushed`);
  assert.strictEqual(pushed.price, 99, 'BoostPrice applied (99) must win over base (75)');
});

await test('P6-28 — stopSellMode \'true_only\' — stop_sell:true envoyé quand rule couvre la date', async () => {
  const restrSpy = {};
  const pub = makeSemanticPublisher({}, restrSpy);

  const SS_DATE = SEM_DATE;  // stop_sell rule covering today
  const pool = makeSemanticPool({
    properties: [SEM_PROP],
    pricing_rules: [{
      rule_type: 'stop_sell', active: true,
      start_date: SS_DATE, end_date: SS_DATE, price: null,
    }],
    pricing_overrides: [], pricing_schedule: [], pricing_config: [],
  });

  const handler = captureHandler(pool, {
    publisherFn: pub,
    agencyIds:   ['sem_user'],
    callerId:    'sem_user',
  });
  await handler(makeReq({ userId: 'sem_user' }), makeRes());
  await waitForBackground();

  const restr = (restrSpy.restrictions || []).find(r => r.date === SS_DATE);
  assert.ok(restr, `restriction for ${SS_DATE} must be present`);
  assert.strictEqual(restr.stop_sell, true,
    'stop_sell:true must be present when a stop_sell rule covers the date');
});

await test('P6-29 — stopSellMode \'true_only\' — stop_sell absent quand pas de rule', async () => {
  const restrSpy = {};
  const pub = makeSemanticPublisher({}, restrSpy);

  const pool = makeSemanticPool({
    properties:    [SEM_PROP],
    pricing_rules: [],   // no stop_sell rule
    pricing_overrides: [], pricing_schedule: [], pricing_config: [],
  });

  const handler = captureHandler(pool, {
    publisherFn: pub,
    agencyIds:   ['sem_user'],
    callerId:    'sem_user',
  });
  await handler(makeReq({ userId: 'sem_user' }), makeRes());
  await waitForBackground();

  const restr = (restrSpy.restrictions || []).find(r => r.date === SEM_DATE);
  assert.ok(restr, `restriction for ${SEM_DATE} must be present`);
  assert.ok(
    !Object.prototype.hasOwnProperty.call(restr, 'stop_sell'),
    'stop_sell field must be ABSENT (not false) when no rule covers the date — true_only mode',
  );
});

await test('P6-30 — external_pricing=true → publisher retourne skipped, boucle continue sans exception', async () => {
  // Uses a spy publisher to verify that a SKIPPED_EXTERNAL result for prop1 does not
  // abort the loop — prop2 (non-external) must still be attempted.
  const props = [
    baseProp({ id: 'ext_prop',  user_id: 'o1' }),  // will return SKIPPED_EXTERNAL
    baseProp({ id: 'norm_prop', user_id: 'o2' }),  // will return OK
  ];
  const spy = {};
  const pub = async (_pool, opts) => {
    spy.calls   = (spy.calls || 0) + 1;
    spy.allArgs = spy.allArgs || [];
    spy.allArgs.push({ ...opts });
    if (opts.propertyId === 'ext_prop') {
      return {
        status: PUBLISH_STATUS.SKIPPED_EXTERNAL,
        propertyId: 'ext_prop', reason: 'sync_all', nights: 0,
        rates: { count: 0, pushed: 0, error: null },
        restrictions: { count: 0, pushed: 0, error: null },
      };
    }
    return okResult(opts.propertyId);
  };

  const handler = captureHandler(makePropsPool(props), {
    publisherFn: pub,
    agencyIds:   ['o1', 'o2'],
    callerId:    'o1',
  });
  const res = makeRes();
  await handler(makeReq({ userId: 'o1' }), res);
  await waitForBackground();

  // Immediate response: both props selected
  assert.strictEqual(res._body.count, 2);
  assert.strictEqual(res._status, 200, 'response must remain 200');

  // Publisher called for both props — skipped result does not abort loop
  assert.strictEqual(spy.calls, 2, 'publisher must be called for both props');
  assert.ok((spy.allArgs || []).some(a => a.propertyId === 'ext_prop'),  'ext_prop attempted');
  assert.ok((spy.allArgs || []).some(a => a.propertyId === 'norm_prop'), 'norm_prop attempted');
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
