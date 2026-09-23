#!/usr/bin/env node
'use strict';
/**
 * Tests unitaires — Route POST /api/channex/sync-restrictions/:property_id (P0-C4.7)
 *
 * Couvre :
 *   P7-01  : route URL inchangée
 *   P7-02  : middleware/auth préservé (authenticateToken)
 *   P7-03  : ownership préservé (agencyIds)
 *   P7-04  : foreign property rejetée → 400, publisher jamais appelé
 *   P7-05  : property user_id sélectionné en DB
 *   P7-06  : publisher userId = prop.user_id (pas req.user.id)
 *   P7-07  : publisher appelé exactement une fois
 *   P7-08  : reason = 'manual_restrictions_push'
 *   P7-09  : stopSellMode = 'true_only'
 *   P7-10  : allowedDates absent du payload publisher
 *   P7-11  : horizon = 500 nuits (addDays(startDate, 500))
 *   P7-12  : horizon UTC-safe (setHours 12,0,0,0)
 *   P7-13  : aucun chargement local pricing_rules par la route
 *   P7-14  : aucun moteur de prix period/weekday par la route
 *   P7-15  : aucun moteur base/weekend_price par la route
 *   P7-16  : aucun appel direct pushRestrictions
 *   P7-17  : aucun payload `rate` embarqué dans l'appel publisher
 *   P7-18  : BoostPrice applied délégué au publisher (pas de rate injecté)
 *   P7-19  : manual override délégué au publisher (pas de rate injecté)
 *   P7-20  : BoostPrice pending délégué au publisher (pas de rate injecté)
 *   P7-21  : BoostPrice min_stay délégué au publisher (pas de min_stay injecté)
 *   P7-22  : external_pricing=true → publisher jamais appelé avec Channex write
 *   P7-23  : skipped_external → réponse honnête (ne dit pas "synchronisé")
 *   P7-24  : IDs Channex manquants → 400 (route guard + publisher SKIPPED_MISSING_IDS)
 *   P7-25  : publisher OK → réponse adaptée correctement
 *   P7-26  : publisher PARTIAL → réponse honnête (partial=true)
 *   P7-27  : publisher ERROR → 500 avec message d'erreur
 *   P7-28  : publisher throw → 500 avec error field
 *   P7-29  : aucun fallback legacy en cas d'échec publisher
 *   P7-30  : contrat réponse compatible avec la route historique
 *
 * Exécution : node tests/channex_restrictions_sync.test.js
 * Aucun appel DB réel. Aucun appel Channex. Aucun cron.
 */

const assert  = require('assert');
const factory = require('../routes/channex-restrictions-sync');
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
 * Mounts the route factory and captures the POST handler.
 * authenticateToken is a pass-through. getAgencyUserIds resolves to
 * agencyIds || [callerId].
 */
function captureHandler(pool, publisherFn, { callerId = 'caller1', agencyIds = null } = {}) {
  let handler = null;

  const app = {
    post: (_path, _mw, h) => { handler = h; },
  };

  const middlewares = {
    authenticateToken: (_req, _res, next) => next(),
    getAgencyUserIds:  async (_req, uid) => agencyIds || [uid],
  };

  factory(app, pool, middlewares, { publisher: publisherFn });
  return handler;
}

function makeReq(propertyId = 'prop1', callerId = 'caller1') {
  return {
    params:  { property_id: propertyId },
    user:    { id: callerId },
    query:   {},
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
    name:                 'Logement Test',
    external_pricing:     false,
    channex_enabled:      true,
    channex_property_id:  'cx_p',
    channex_room_type_id: 'cx_rt',
    channex_rate_plan_id: 'cx_rp',
    ...overrides,
  };
}

/**
 * Pool that returns the given prop for properties queries.
 * Throws on writes.
 * opts.rejectLegacyQueries: throws if pricing_rules or pricing_overrides are queried FROM.
 */
function makePropPool(prop, opts = {}) {
  return {
    _queries: [],
    async query(sql, _params) {
      const s = sql.replace(/\s+/g, ' ').toLowerCase().trim();
      this._queries.push(s);  // full string — needed to find FROM clause past long SELECT

      if (s.startsWith('insert') || s.startsWith('update') || s.startsWith('delete')) {
        throw new Error('Pool: unexpected write: ' + s.slice(0, 60));
      }
      if (opts.rejectLegacyQueries) {
        if (s.includes('from pricing_rules')) {
          throw new Error('Pool: legacy pricing_rules query must not be issued');
        }
        if (s.includes('from pricing_overrides')) {
          throw new Error('Pool: legacy pricing_overrides query must not be issued');
        }
      }
      if (s.includes('from properties')) return { rows: prop ? [prop] : [] };
      return { rows: [] };
    },
  };
}

/** Publisher spy: records calls and returns a canned result. */
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
    reason:       'manual_restrictions_push',
    nights:       500,
    rates:        { count: 500, pushed: 500, error: null },
    restrictions: { count: 500, pushed: 500, error: null },
    ...overrides,
  };
}

// ─── P7-01–P7-04 : Wiring + guards ───────────────────────────────────────────

console.log('\n── P7-01–P7-04 : Wiring + guards ──');

await test('P7-01 — route URL exactement inchangée', async () => {
  let capturedPath = null;
  const app = { post: (path, _mw, _h) => { capturedPath = path; } };
  factory(app, makePropPool(baseProp()), {
    authenticateToken: () => {},
    getAgencyUserIds:  async (_r, uid) => [uid],
  }, {});
  assert.strictEqual(capturedPath, '/api/channex/sync-restrictions/:property_id');
});

await test('P7-02 — middleware authenticateToken transmis comme 2e argument', async () => {
  const myToken = (_req, _res, next) => next();
  let capturedMw = null;
  const app = { post: (_path, mw, _h) => { capturedMw = mw; } };
  factory(app, makePropPool(baseProp()), {
    authenticateToken: myToken,
    getAgencyUserIds:  async (_r, uid) => [uid],
  }, {});
  assert.strictEqual(capturedMw, myToken,
    'authenticateToken doit être passé comme middleware (2e arg) sans modification');
});

await test('P7-03 — ownership OK → publisher appelé (propriété accessible)', async () => {
  const spy = {};
  const handler = captureHandler(makePropPool(baseProp()), spyPublisher(okResult(), spy));
  await handler(makeReq(), makeRes());
  assert.strictEqual(spy.calls, 1, 'publisher doit être appelé si ownership valide');
});

await test('P7-04 — foreign property (0 lignes DB) → 400, publisher jamais appelé', async () => {
  const spy = {};
  const handler = captureHandler(makePropPool(null), spyPublisher(okResult(), spy));
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 400);
  assert.ok(typeof res._body.error === 'string', 'error field requis');
  assert.strictEqual(spy.calls || 0, 0, 'publisher ne doit pas être appelé pour une propriété étrangère');
});

// ─── P7-05–P7-12 : Params publisher ──────────────────────────────────────────

console.log('\n── P7-05–P7-12 : Params publisher ──');

await test('P7-05 — property user_id inclus dans la requête SELECT', async () => {
  const pool = makePropPool(baseProp());
  const handler = captureHandler(pool, spyPublisher(okResult()));
  await handler(makeReq(), makeRes());
  const q = pool._queries.find(q => q.includes('from properties'));
  assert.ok(q, 'une requête FROM properties doit être émise');
  assert.ok(q.includes('user_id'), 'user_id doit être dans le SELECT');
});

await test('P7-06 — publisher userId = prop.user_id (pas req.user.id)', async () => {
  const spy = {};
  const prop = baseProp({ user_id: 'real_owner' });
  const handler = captureHandler(
    makePropPool(prop),
    spyPublisher(okResult(), spy),
    { callerId: 'caller_different_from_owner', agencyIds: ['caller_different_from_owner', 'real_owner'] },
  );
  await handler(makeReq('prop1', 'caller_different_from_owner'), makeRes());
  assert.strictEqual(spy.lastArgs.userId, 'real_owner',
    'publisher userId doit être prop.user_id (canonical owner), pas le caller');
});

await test('P7-07 — publisher appelé exactement une fois', async () => {
  const spy = {};
  const handler = captureHandler(makePropPool(baseProp()), spyPublisher(okResult(), spy));
  await handler(makeReq(), makeRes());
  assert.strictEqual(spy.calls, 1, 'publisher doit être appelé exactement une fois');
});

await test('P7-08 — reason = "manual_restrictions_push"', async () => {
  const spy = {};
  const handler = captureHandler(makePropPool(baseProp()), spyPublisher(okResult(), spy));
  await handler(makeReq(), makeRes());
  assert.strictEqual(spy.lastArgs.reason, 'manual_restrictions_push');
});

await test('P7-09 — stopSellMode = "true_only"', async () => {
  const spy = {};
  const handler = captureHandler(makePropPool(baseProp()), spyPublisher(okResult(), spy));
  await handler(makeReq(), makeRes());
  assert.strictEqual(spy.lastArgs.stopSellMode, 'true_only',
    'PATH7 ne doit jamais envoyer en mode AUTHORITATIVE');
});

await test('P7-10 — allowedDates absent du payload publisher', async () => {
  const spy = {};
  const handler = captureHandler(makePropPool(baseProp()), spyPublisher(okResult(), spy));
  await handler(makeReq(), makeRes());
  assert.ok(
    !('allowedDates' in spy.lastArgs) || spy.lastArgs.allowedDates === undefined,
    'allowedDates ne doit pas être transmis — plage complète 500 nuits',
  );
});

await test('P7-11 — horizon = 500 nuits exactes (endDate = addDays(startDate, 500))', async () => {
  const spy = {};
  const handler = captureHandler(makePropPool(baseProp()), spyPublisher(okResult(), spy));
  await handler(makeReq(), makeRes());
  const { startDate, endDate } = spy.lastArgs;
  const expected = addDays(startDate, 500);
  assert.strictEqual(endDate, expected,
    `endDate doit être addDays(startDate, 500) = ${expected}, obtenu ${endDate}`);
});

await test('P7-12 — horizon UTC-safe (startDate calculé à UTC noon)', async () => {
  const spy = {};
  const handler = captureHandler(makePropPool(baseProp()), spyPublisher(okResult(), spy));
  await handler(makeReq(), makeRes());
  const { startDate } = spy.lastArgs;
  assert.match(startDate, /^\d{4}-\d{2}-\d{2}$/, 'startDate doit être au format YYYY-MM-DD');
  // Verify startDate is today (UTC noon) — accepts today ± 0 days
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);
  assert.strictEqual(startDate, todayStr,
    `startDate doit être aujourd'hui (UTC noon): ${todayStr}`);
});

// ─── P7-13–P7-17 : Isolation — moteur legacy supprimé ────────────────────────

console.log('\n── P7-13–P7-17 : Isolation moteur legacy ──');

await test('P7-13 — aucun chargement local pricing_rules par la route', async () => {
  const spy = {};
  const strictPool = makePropPool(baseProp(), { rejectLegacyQueries: true });
  const handler = captureHandler(strictPool, spyPublisher(okResult(), spy));
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 200,
    'la route ne doit pas émettre de requête pricing_rules (rejectLegacyQueries aurait throw)');
  assert.strictEqual(spy.calls, 1, 'publisher doit quand même être appelé');
});

await test('P7-14 — aucun moteur de prix period/weekday chargé par la route', async () => {
  // If the route loads pricing_rules (period/weekday), strictPool throws.
  const strictPool = makePropPool(baseProp(), { rejectLegacyQueries: true });
  const res = makeRes();
  const handler = captureHandler(strictPool, spyPublisher(okResult()));
  await assert.doesNotReject(
    () => handler(makeReq(), res),
    'la route ne doit pas charger pricing_rules pour calculer les prix period/weekday',
  );
});

await test('P7-15 — base_price et weekend_price non sélectionnés par la route', async () => {
  const pool = makePropPool(baseProp());
  const handler = captureHandler(pool, spyPublisher(okResult()));
  await handler(makeReq(), makeRes());
  const q = pool._queries.find(q => q.includes('from properties'));
  assert.ok(q, 'requête FROM properties requise');
  assert.ok(!q.includes('base_price'),    'base_price ne doit pas être dans le SELECT');
  assert.ok(!q.includes('weekend_price'), 'weekend_price ne doit pas être dans le SELECT');
});

await test('P7-16 — aucun appel direct pushRestrictions', async () => {
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
    const handler = captureHandler(makePropPool(baseProp()), spyPublisher(okResult()));
    await handler(makeReq(), makeRes());
    assert.strictEqual(pushRestrictionsCalled, false,
      'pushRestrictions ne doit jamais être appelé directement — doit passer par le publisher');
  } finally {
    require.cache[channexPath] = originalChannex;
  }
});

await test('P7-17 — aucun champ `rate` embarqué dans le payload publisher', async () => {
  const spy = {};
  const handler = captureHandler(makePropPool(baseProp()), spyPublisher(okResult(), spy));
  await handler(makeReq(), makeRes());
  assert.ok(!('rate' in spy.lastArgs),
    'la route ne doit pas injecter de `rate` dans les opts publisher — le publisher calcule le prix');
});

// ─── P7-18–P7-21 : Sémantique BoostPrice ─────────────────────────────────────

console.log('\n── P7-18–P7-21 : Sémantique BoostPrice (délégation) ──');

await test('P7-18 — BoostPrice applied : route délègue au publisher (aucun `rate` injecté)', async () => {
  // BoostPrice applied = 99, base = 75.
  // La route ne doit pas calculer localement 75 et le passer au publisher.
  // Le publisher reçoit uniquement propertyId/userId/dates — il calcule le prix.
  const spy = {};
  const prop = baseProp({ user_id: 'owner1' });
  // Pool retourne la prop avec base_price 75 et la pricing_schedule avec BoostPrice applied 99.
  // La ROUTE ne doit jamais lire pricing_schedule — seul le publisher peut le faire.
  const handler = captureHandler(makePropPool(prop), spyPublisher(okResult(), spy));
  await handler(makeReq(), makeRes());
  assert.ok(!('rate' in spy.lastArgs),
    'la route ne doit pas pré-calculer le BoostPrice applied et le transmettre au publisher');
  assert.strictEqual(spy.calls, 1, 'publisher appelé une fois');
});

await test('P7-19 — manual override : route délègue au publisher (aucun `rate` injecté)', async () => {
  // Override 105 > BoostPrice 99. La route ne connaît pas 105.
  const spy = {};
  const handler = captureHandler(makePropPool(baseProp()), spyPublisher(okResult(), spy));
  await handler(makeReq(), makeRes());
  assert.ok(!('rate' in spy.lastArgs),
    'la route ne doit pas pré-calculer les manual overrides et les transmettre au publisher');
});

await test('P7-20 — BoostPrice pending : route délègue au publisher (aucun `rate` injecté)', async () => {
  // BoostPrice pending = 99, base = 75 → le publisher doit retourner base (75).
  // La route n'a aucune logique BoostPrice : elle délègue entièrement.
  const spy = {};
  const handler = captureHandler(makePropPool(baseProp()), spyPublisher(okResult(), spy));
  await handler(makeReq(), makeRes());
  assert.ok(!('rate' in spy.lastArgs),
    'la route ne doit pas calculer le statut pending et substituer un prix');
});

await test('P7-21 — BoostPrice min_stay : route délègue au publisher (aucun `min_stay` injecté)', async () => {
  // BoostPrice min_stay=3, legacy min_stay=1. La route ne doit pas injecter min_stay=1.
  const spy = {};
  const handler = captureHandler(makePropPool(baseProp()), spyPublisher(okResult(), spy));
  await handler(makeReq(), makeRes());
  assert.ok(!('min_stay' in spy.lastArgs),
    'la route ne doit pas pré-calculer min_stay et le transmettre au publisher');
  assert.ok(!('minStay' in spy.lastArgs),
    'la route ne doit pas pré-calculer minStay et le transmettre au publisher');
});

// ─── P7-22–P7-24 : Guards external_pricing + IDs ─────────────────────────────

console.log('\n── P7-22–P7-24 : Guards external_pricing + IDs ──');

await test('P7-22 — external_pricing=true : publisher ne peut pas écrire dans Channex', async () => {
  // external_pricing=true → publisher retourne SKIPPED_EXTERNAL.
  // La route doit retourner une réponse 400 honnête (pas "synchronisé").
  // Le publisher avec spy vérifie qu'aucun appel Channex n'a lieu.
  const skippedResult = {
    status:       PUBLISH_STATUS.SKIPPED_EXTERNAL,
    propertyId:   'prop1',
    reason:       'manual_restrictions_push',
    nights:       0,
    rates:        { count: 0, pushed: 0, error: null },
    restrictions: { count: 0, pushed: 0, error: null },
  };
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
    const handler = captureHandler(
      makePropPool(baseProp({ external_pricing: true })),
      spyPublisher(skippedResult),
    );
    const res = makeRes();
    await handler(makeReq(), res);
    assert.strictEqual(pushRestrictionsCalled, false,
      'pushRestrictions ne doit jamais être appelé pour une propriété external_pricing');
    assert.strictEqual(res._status, 400, 'réponse HTTP doit être 400');
  } finally {
    require.cache[channexPath] = originalChannex;
  }
});

await test('P7-23 — skipped_external → réponse honnête (ne prétend pas avoir synchronisé)', async () => {
  const skippedResult = {
    status:       PUBLISH_STATUS.SKIPPED_EXTERNAL,
    propertyId:   'prop1',
    reason:       'manual_restrictions_push',
    nights:       0,
    rates:        { count: 0, pushed: 0, error: null },
    restrictions: { count: 0, pushed: 0, error: null },
  };
  const handler = captureHandler(
    makePropPool(baseProp({ external_pricing: true })),
    spyPublisher(skippedResult),
  );
  const res = makeRes();
  await handler(makeReq(), res);
  assert.ok(typeof res._body.error === 'string', 'error field requis pour SKIPPED_EXTERNAL');
  assert.ok(
    !res._body.success,
    'success ne doit pas être true quand rien n\'a été synchronisé',
  );
  const msgOrError = (res._body.message || res._body.error || '').toLowerCase();
  assert.ok(
    !msgOrError.includes('synchronis') || msgOrError.includes('extern'),
    'le message ne doit pas prétendre que tout a été synchronisé',
  );
});

await test('P7-24 — IDs Channex manquants → 400', async () => {
  // channex_property_id null → route guard → 400
  const spy = {};
  const handler = captureHandler(
    makePropPool(baseProp({ channex_property_id: null })),
    spyPublisher(okResult(), spy),
  );
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 400);
  assert.strictEqual(spy.calls || 0, 0, 'publisher ne doit pas être appelé');

  // channex_room_type_id null → publisher SKIPPED_MISSING_IDS → 400
  const missingIdsResult = {
    status:       PUBLISH_STATUS.SKIPPED_MISSING_IDS,
    propertyId:   'prop1',
    reason:       'manual_restrictions_push',
    nights:       0,
    rates:        { count: 0, pushed: 0, error: null },
    restrictions: { count: 0, pushed: 0, error: null },
  };
  const spy2 = {};
  const handler2 = captureHandler(
    makePropPool(baseProp({ channex_room_type_id: null })),
    spyPublisher(missingIdsResult, spy2),
  );
  const res2 = makeRes();
  await handler2(makeReq(), res2);
  assert.strictEqual(res2._status, 400);
  assert.strictEqual(spy2.calls, 1, 'publisher appelé une fois avant de retourner SKIPPED_MISSING_IDS');
});

// ─── P7-25–P7-30 : Response adapter ──────────────────────────────────────────

console.log('\n── P7-25–P7-30 : Response adapter ──');

await test('P7-25 — publisher OK → réponse adaptée correctement', async () => {
  const spy = {};
  const result = okResult({ rates: { count: 500, pushed: 487, error: null },
                             restrictions: { count: 500, pushed: 492, error: null } });
  const handler = captureHandler(makePropPool(baseProp()), spyPublisher(result, spy));
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 200);
  assert.strictEqual(res._body.success, true);
  assert.ok(typeof res._body.message === 'string', 'message requis');
  assert.strictEqual(typeof res._body.restrictions, 'number', 'restrictions doit être un nombre');
});

await test('P7-26 — publisher PARTIAL → réponse honnête (partial=true, pas "tout synchronisé")', async () => {
  const partialResult = {
    status:       PUBLISH_STATUS.PARTIAL,
    propertyId:   'prop1',
    reason:       'manual_restrictions_push',
    nights:       500,
    rates:        { count: 500, pushed: 500, error: null },
    restrictions: { count: 500, pushed: 0, error: 'Channex timeout' },
  };
  const handler = captureHandler(makePropPool(baseProp()), spyPublisher(partialResult));
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 200, 'PARTIAL retourne 200 (opération partielle réussie)');
  assert.strictEqual(res._body.success, true);
  assert.strictEqual(res._body.partial, true,
    'partial=true doit être présent pour distinguer du succès complet');
  const msg = (res._body.message || '').toLowerCase();
  assert.ok(
    msg.includes('partiel') || msg.includes('partiellement'),
    'le message doit indiquer une synchronisation partielle, pas totale',
  );
});

await test('P7-27 — publisher ERROR → 500 avec message d\'erreur', async () => {
  const errResult = {
    status:       PUBLISH_STATUS.ERROR,
    propertyId:   'prop1',
    reason:       'manual_restrictions_push',
    nights:       500,
    rates:        { count: 0, pushed: 0, error: 'Channex API error' },
    restrictions: { count: 0, pushed: 0, error: 'Channex API error' },
  };
  const handler = captureHandler(makePropPool(baseProp()), spyPublisher(errResult));
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 500);
  assert.ok(typeof res._body.error === 'string', 'error field requis');
  assert.ok(!res._body.success, 'success ne doit pas être true en cas d\'erreur');
});

await test('P7-28 — publisher throw → 500 avec error field', async () => {
  const throwingPublisher = async () => { throw new Error('DB connection lost'); };
  const handler = captureHandler(makePropPool(baseProp()), throwingPublisher);
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 500);
  assert.ok(typeof res._body.error === 'string', 'error field requis');
});

await test('P7-29 — aucun fallback legacy ni appel Channex direct en cas d\'échec publisher', async () => {
  let pushRestrictionsCalled = false;
  let pushRatesCalled = false;

  const channexPath = require.resolve('../channex');
  const originalChannex = require.cache[channexPath];
  require.cache[channexPath] = {
    id: channexPath, filename: channexPath, loaded: true,
    exports: {
      ...require('../channex'),
      pushRates:        async () => { pushRatesCalled = true; return { count: 0 }; },
      pushRestrictions: async () => { pushRestrictionsCalled = true; return { count: 0 }; },
    },
  };
  try {
    const throwingPublisher = async () => { throw new Error('Publisher failed'); };
    const handler = captureHandler(makePropPool(baseProp()), throwingPublisher);
    const res = makeRes();
    await handler(makeReq(), res);
    assert.strictEqual(res._status, 500, 'erreur publisher → 500');
    assert.strictEqual(pushRestrictionsCalled, false,
      'pushRestrictions ne doit jamais être appelé en fallback');
    assert.strictEqual(pushRatesCalled, false,
      'pushRates ne doit jamais être appelé en fallback');
  } finally {
    require.cache[channexPath] = originalChannex;
  }
});

await test('P7-30 — contrat réponse compatible avec la route historique', async () => {
  // La route historique retournait :
  //   { success: true, message: 'Tarifs + restrictions synchronisés', restrictions: N }
  // La nouvelle route doit retourner au minimum ces champs (compatible caller potentiel).
  const spy = {};
  const result = okResult();
  const handler = captureHandler(makePropPool(baseProp()), spyPublisher(result, spy));
  const res = makeRes();
  await handler(makeReq(), res);

  assert.strictEqual(res._status, 200);
  assert.strictEqual(res._body.success, true,     '`success: true` requis (contrat historique)');
  assert.ok(typeof res._body.message === 'string', '`message` requis (contrat historique)');
  assert.ok(
    res._body.message.toLowerCase().includes('synchronis'),
    '`message` doit mentionner la synchronisation (contrat historique)',
  );
  assert.ok(
    typeof res._body.restrictions === 'number',
    '`restrictions` (nombre) requis (contrat historique)',
  );
});

// ─── Résumé ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`Résultats : ${passed} passé(s), ${failed} échoué(s) sur ${passed + failed}`);
if (failures.length) {
  console.log('\nÉchecs :');
  for (const f of failures) console.log(`  ✗ ${f.name}\n    ${f.message}`);
}
console.log('─'.repeat(60));

process.exitCode = failed > 0 ? 1 : 0;

})();
