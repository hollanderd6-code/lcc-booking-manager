#!/usr/bin/env node
'use strict';
/**
 * Tests unitaires — Route POST /api/properties/:id/push-rates (P0-C2)
 *
 * Couvre :
 *   TC-C01–C03  : accès (autorisé, non autorisé, logement absent)
 *   TC-C04–C07  : paramètres transmis au publisher (propertyId, userId, reason, force)
 *   TC-C08–C11  : plage de dates (500 nuits, start inclusif, end exclusif, format)
 *   TC-C12–C17  : isolation (pas de SELECT pricing_schedule, pas de rates[] local,
 *                  pas d'appel direct pushRates/pushRestrictions)
 *   TC-C18–C20  : HTTP mapping publisher ok / partial / error
 *   TC-C21–C24  : guards pré-publisher (external, channex_disabled, missing IDs, base_price)
 *   TC-C25–C27  : robustesse (publisher throw, pas de données sensibles, skipped défensif)
 *   TC-C28–C32  : parité min-stay resolver vs legacy (calcMinStay)
 *
 * Exécution : node tests/push_tarifs_route.test.js
 * Aucun appel DB réel. Aucun appel Channex.
 */

const assert      = require('assert');
const routeFactory = require('../routes/push-tarifs-routes');
const { PUBLISH_STATUS }                          = require('../routes/pricing-publisher');
const { addDays, calcMinStay, resolveEffectivePrices } = require('../routes/effective-pricing-resolver');

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
 * Mounts the route factory with a mock app that captures the POST handler.
 * auth is irrelevant for unit tests (req.user is set directly on the mock req).
 */
function captureHandler(pool, deps = {}) {
  let handler = null;
  const app = { post: (_path, _auth, h) => { handler = h; } };
  routeFactory(app, pool, () => {}, deps);
  return handler;
}

function makeReq(id = 'p1', userId = 'u1') {
  return { params: { id }, user: { id: userId } };
}

function makeRes() {
  const r = { _status: 200, _body: null };
  r.status = (code) => { r._status = code; return r; };
  r.json   = (body) => { r._body = body; return r; };
  return r;
}

/**
 * Pool that returns the given property for any 'FROM properties' query.
 * Throws on any INSERT/UPDATE/DELETE or on pricing_schedule/pricing_overrides
 * when opts.rejectPricingQueries is true.
 */
function makePropPool(prop, opts = {}) {
  const pool = {
    _queries: [],
    async query(sql, _params) {
      const s = sql.replace(/\s+/g, ' ').toLowerCase().trim();
      pool._queries.push(s.slice(0, 100));

      if (s.startsWith('insert') || s.startsWith('update') || s.startsWith('delete')) {
        throw new Error('Pool: unexpected write: ' + s.slice(0, 60));
      }
      if (opts.rejectPricingQueries) {
        if (s.includes('pricing_schedule') || s.includes('pricing_overrides')) {
          throw new Error('Pool: unexpected pricing query: ' + s.slice(0, 60));
        }
      }

      if (s.includes('from properties')) return { rows: prop ? [prop] : [] };
      return { rows: [] };
    },
  };
  return pool;
}

function baseProp(overrides = {}) {
  return {
    id:                  'p1',
    name:                'Logement Test',
    internal_name:       null,
    base_price:          100,
    channex_enabled:     true,
    channex_rate_plan_id:'rp1',
    external_pricing:    false,
    ...overrides,
  };
}

/** Publisher spy: records calls, returns canned result */
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
    propertyId:   'p1',
    reason:       'manual_push',
    nights:       500,
    rates:        { count: 500, pushed: 500, error: null },
    restrictions: { count: 500, pushed: 500, error: null },
    ...overrides,
  };
}

// ─── TC-C01–C03 : Accès ───────────────────────────────────────────────────────

console.log('\n── TC-C01–C03 : Accès ──');

await test('TC-C01 — utilisateur autorisé → publisher appelé une fois', async () => {
  const spy = {};
  const handler = captureHandler(
    makePropPool(baseProp()),
    { publisher: spyPublisher(okResult(), spy) },
  );
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(spy.calls, 1, 'publisher must be called exactly once');
  assert.strictEqual(res._status, 200);
  assert.ok(res._body.ok, 'response must be ok');
});

await test('TC-C02 — utilisateur non autorisé (pool retourne 0 lignes) → publisher jamais appelé', async () => {
  const spy = {};
  const handler = captureHandler(
    makePropPool(null),  // ownership check fails → no rows
    { publisher: spyPublisher(okResult(), spy) },
  );
  const res = makeRes();
  await handler(makeReq('p1', 'u_evil'), res);
  assert.strictEqual(spy.calls || 0, 0, 'publisher must not be called');
  assert.strictEqual(res._status, 404);
});

await test('TC-C03 — property introuvable → 404, publisher jamais appelé', async () => {
  const spy = {};
  const handler = captureHandler(
    makePropPool(null),
    { publisher: spyPublisher(okResult(), spy) },
  );
  const res = makeRes();
  await handler(makeReq('unknown'), res);
  assert.strictEqual(spy.calls || 0, 0);
  assert.strictEqual(res._status, 404);
  assert.ok(res._body.error, 'must return error message');
});

// ─── TC-C04–C07 : Paramètres transmis au publisher ───────────────────────────

console.log('\n── TC-C04–C07 : Paramètres publisher ──');

await test('TC-C04 — propertyId transmis = p.id (depuis DB, pas params bruts)', async () => {
  const spy = {};
  const handler = captureHandler(
    makePropPool(baseProp({ id: 'p1' })),
    { publisher: spyPublisher(okResult(), spy) },
  );
  await handler(makeReq('p1', 'u1'), makeRes());
  assert.strictEqual(spy.lastArgs.propertyId, 'p1');
});

await test('TC-C05 — userId transmis = req.user.id', async () => {
  const spy = {};
  const handler = captureHandler(
    makePropPool(baseProp()),
    { publisher: spyPublisher(okResult(), spy) },
  );
  await handler(makeReq('p1', 'user-42'), makeRes());
  assert.strictEqual(spy.lastArgs.userId, 'user-42');
});

await test('TC-C06 — reason=\'manual_push\' transmis au publisher', async () => {
  const spy = {};
  const handler = captureHandler(
    makePropPool(baseProp()),
    { publisher: spyPublisher(okResult(), spy) },
  );
  await handler(makeReq(), makeRes());
  assert.strictEqual(spy.lastArgs.reason, 'manual_push');
});

await test('TC-C07 — force=true transmis au publisher', async () => {
  const spy = {};
  const handler = captureHandler(
    makePropPool(baseProp()),
    { publisher: spyPublisher(okResult(), spy) },
  );
  await handler(makeReq(), makeRes());
  assert.strictEqual(spy.lastArgs.force, true);
});

// ─── TC-C08–C11 : Plage de dates ─────────────────────────────────────────────

console.log('\n── TC-C08–C11 : Plage de dates ──');

await test('TC-C08 — horizon exact : endDate = addDays(startDate, 500)', async () => {
  const spy = {};
  const handler = captureHandler(
    makePropPool(baseProp()),
    { publisher: spyPublisher(okResult(), spy) },
  );
  await handler(makeReq(), makeRes());
  const { startDate, endDate } = spy.lastArgs;
  assert.strictEqual(endDate, addDays(startDate, 500),
    `endDate must be addDays(startDate, 500) — got startDate=${startDate} endDate=${endDate}`);
});

await test('TC-C09 — startDate = aujourd\'hui (YYYY-MM-DD)', async () => {
  const spy = {};
  const handler = captureHandler(
    makePropPool(baseProp()),
    { publisher: spyPublisher(okResult(), spy) },
  );
  // Compute expected "today" the same way the route does
  const d0 = new Date(); d0.setHours(12, 0, 0, 0);
  const expectedToday = d0.toISOString().slice(0, 10);
  await handler(makeReq(), makeRes());
  assert.strictEqual(spy.lastArgs.startDate, expectedToday,
    `startDate must be today ${expectedToday}, got ${spy.lastArgs.startDate}`);
});

await test('TC-C10 — endDate exclusif : couvre exactement 500 nuits', async () => {
  const spy = {};
  const handler = captureHandler(
    makePropPool(baseProp()),
    { publisher: spyPublisher(okResult(), spy) },
  );
  await handler(makeReq(), makeRes());
  const { startDate, endDate } = spy.lastArgs;
  // addDays(startDate, 500) is exclusive — adding 499 to startDate gives last night
  assert.notStrictEqual(endDate, addDays(startDate, 499),
    'endDate must NOT be startDate+499 (that would be inclusive last night)');
  assert.strictEqual(endDate, addDays(startDate, 500),
    'endDate must be startDate+500 (exclusive)');
});

await test('TC-C11 — format startDate YYYY-MM-DD sans corruption timezone', async () => {
  const spy = {};
  const handler = captureHandler(
    makePropPool(baseProp()),
    { publisher: spyPublisher(okResult(), spy) },
  );
  await handler(makeReq(), makeRes());
  const { startDate } = spy.lastArgs;
  assert.match(startDate, /^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD');
  // Must be within 1 day of today (guard against timezone off-by-one)
  const today = Date.now();
  const parsed = new Date(startDate + 'T12:00:00Z').getTime();
  const diffDays = Math.abs(today - parsed) / 86400000;
  assert.ok(diffDays < 2, `startDate ${startDate} must be within 1 day of now`);
});

// ─── TC-C12–C17 : Isolation — la route ne résout plus les prix ───────────────

console.log('\n── TC-C12–C17 : Isolation pricing ──');

await test('TC-C12 — BoostPrice applied : publisher délégué, pas résolu par la route', async () => {
  // The route calls the publisher; pricing logic lives in publisher/resolver.
  // We verify publisher is called regardless of DB pricing_schedule state.
  const spy = {};
  const handler = captureHandler(
    makePropPool(baseProp()),
    { publisher: spyPublisher(okResult(), spy) },
  );
  await handler(makeReq(), makeRes());
  assert.strictEqual(spy.calls, 1, 'publisher must be called — pricing is delegated');
});

await test('TC-C13 — route ne SELECT jamais pricing_schedule', async () => {
  // Pool throws if pricing_schedule is queried; spy publisher doesn't query the pool
  const spy = {};
  const pool = makePropPool(baseProp(), { rejectPricingQueries: true });
  const handler = captureHandler(pool, { publisher: spyPublisher(okResult(), spy) });
  // Must complete without the pool throwing a pricing_schedule query
  await handler(makeReq(), makeRes());
  const pricingQueries = pool._queries.filter(q => q.includes('pricing_schedule'));
  assert.strictEqual(pricingQueries.length, 0,
    'route must never query pricing_schedule directly');
});

await test('TC-C14 — route ne SELECT jamais pricing_overrides', async () => {
  const pool = makePropPool(baseProp(), { rejectPricingQueries: true });
  const spy  = {};
  const handler = captureHandler(pool, { publisher: spyPublisher(okResult(), spy) });
  await handler(makeReq(), makeRes());
  const ovQueries = pool._queries.filter(q => q.includes('pricing_overrides'));
  assert.strictEqual(ovQueries.length, 0,
    'route must never query pricing_overrides directly');
});

await test('TC-C15 — route ne construit pas rates[] elle-même', async () => {
  // Verified structurally: the only pool queries the route makes are the properties
  // ownership check. Any rates[] construction would require more queries.
  const pool = makePropPool(baseProp(), { rejectPricingQueries: true });
  const spy  = {};
  const handler = captureHandler(pool, { publisher: spyPublisher(okResult(), spy) });
  await handler(makeReq(), makeRes());
  // Only one query expected: the properties ownership check
  // Exactly one DB query expected: the properties ownership check.
  // The spy publisher doesn't query the pool, so any additional query
  // would mean the route is resolving pricing itself.
  assert.strictEqual(pool._queries.length, 1,
    `route must issue exactly 1 query (properties ownership); got ${pool._queries.length}: ${JSON.stringify(pool._queries)}`);
});

await test('TC-C16 — route n\'appelle pas pushRates directement (pas de require channex)', async () => {
  // The route must not import channex directly — any pushRates call requires that import.
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../routes/push-tarifs-routes.js'), 'utf8'
  );
  const hasChannexImport = src.includes("require('../channex')") ||
                           src.includes('require("../channex")');
  assert.ok(!hasChannexImport,
    'route must not require channex directly — pushRates must only be called via publisher');
});

await test('TC-C17 — route n\'appelle pas pushRestrictions directement', async () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../routes/push-tarifs-routes.js'), 'utf8'
  );
  const codeLines = src.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  const hasPushRestrictions = codeLines.some(l => l.includes('pushRestrictions('));
  assert.ok(!hasPushRestrictions,
    'route must not call pushRestrictions directly after migration');
});

// ─── TC-C18–C20 : HTTP mapping publisher status ───────────────────────────────

console.log('\n── TC-C18–C20 : HTTP mapping publisher ──');

await test('TC-C18 — publisher status=ok → HTTP 200 avec ok:true', async () => {
  const handler = captureHandler(
    makePropPool(baseProp()),
    { publisher: spyPublisher(okResult()) },
  );
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 200);
  assert.strictEqual(res._body.ok, true);
  assert.ok(res._body.nuits > 0);
  assert.ok(res._body.depuis);
  assert.ok(res._body.jusqu_au);
});

await test('TC-C19 — publisher status=partial → réponse avec partial:true', async () => {
  const handler = captureHandler(
    makePropPool(baseProp()),
    { publisher: spyPublisher(okResult({
        status: PUBLISH_STATUS.PARTIAL,
        rates:        { count: 500, pushed: 500, error: null },
        restrictions: { count: 500, pushed:   0, error: 'timeout' },
      }))
    },
  );
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._body.partial, true, 'partial must be true');
  assert.strictEqual(res._body.ok, false, 'ok must be false on partial');
  assert.ok(res._body.message && res._body.message.toLowerCase().includes('partiel'),
    'message must mention partial sync');
});

await test('TC-C20 — publisher status=error → HTTP 500', async () => {
  const handler = captureHandler(
    makePropPool(baseProp()),
    { publisher: spyPublisher(okResult({
        status: PUBLISH_STATUS.ERROR,
        rates:        { count: 500, pushed: 0, error: 'rates failed' },
        restrictions: { count: 500, pushed: 0, error: 'restrictions failed' },
      }))
    },
  );
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 500);
  assert.ok(res._body.error, 'must return error field');
});

// ─── TC-C21–C24 : Guards pré-publisher ───────────────────────────────────────

console.log('\n── TC-C21–C24 : Guards pré-publisher ──');

await test('TC-C21 — external_pricing=true → HTTP 400 avant publisher', async () => {
  const spy = {};
  const handler = captureHandler(
    makePropPool(baseProp({ external_pricing: true })),
    { publisher: spyPublisher(okResult(), spy) },
  );
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 400);
  assert.strictEqual(spy.calls || 0, 0, 'publisher must not be called for external pricing');
  assert.ok(res._body.error.includes('externe') || res._body.error.includes('PriceLabs'));
});

await test('TC-C22 — channex_enabled=false → HTTP 400 avant publisher', async () => {
  const spy = {};
  const handler = captureHandler(
    makePropPool(baseProp({ channex_enabled: false })),
    { publisher: spyPublisher(okResult(), spy) },
  );
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 400);
  assert.strictEqual(spy.calls || 0, 0);
});

await test('TC-C23 — channex_rate_plan_id=null → HTTP 400 avant publisher', async () => {
  const spy = {};
  const handler = captureHandler(
    makePropPool(baseProp({ channex_rate_plan_id: null })),
    { publisher: spyPublisher(okResult(), spy) },
  );
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 400);
  assert.strictEqual(spy.calls || 0, 0);
});

await test('TC-C24 — base_price=null → HTTP 400 avant publisher', async () => {
  const spy = {};
  const handler = captureHandler(
    makePropPool(baseProp({ base_price: null })),
    { publisher: spyPublisher(okResult(), spy) },
  );
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 400);
  assert.strictEqual(spy.calls || 0, 0);
  assert.ok(res._body.error.includes('prix de base'));
});

// ─── TC-C25–C27 : Robustesse ─────────────────────────────────────────────────

console.log('\n── TC-C25–C27 : Robustesse ──');

await test('TC-C25 — publisher throw → catch route, HTTP 500', async () => {
  const handler = captureHandler(
    makePropPool(baseProp()),
    { publisher: async () => { throw new Error('Channex timeout'); } },
  );
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 500);
  assert.ok(res._body.error, 'must return error field');
});

await test('TC-C26 — erreur interne : pas de détail sensible dans la réponse', async () => {
  const handler = captureHandler(
    makePropPool(baseProp()),
    { publisher: async () => { throw new Error('DB_SECRET_TOKEN_xyz'); } },
  );
  const res = makeRes();
  await handler(makeReq(), res);
  const body = JSON.stringify(res._body);
  assert.ok(!body.includes('DB_SECRET_TOKEN_xyz'),
    'error response must not expose internal error details');
});

await test('TC-C27 — publisher status=skipped_not_found → 404 défensif', async () => {
  // This should not happen in practice (route pre-checks ownership) but defensive mapping must work.
  const handler = captureHandler(
    makePropPool(baseProp()),
    { publisher: spyPublisher(okResult({ status: PUBLISH_STATUS.SKIPPED_NOT_FOUND, nights: 0 })) },
  );
  const res = makeRes();
  await handler(makeReq(), res);
  assert.strictEqual(res._status, 404);
});

// ─── TC-C28–C32 : Parité min-stay resolver vs legacy ─────────────────────────
// Vérifie que resolveEffectivePrices produit les mêmes restrictions que
// buildMinStayFields (server.js). Les deux utilisent le même algorithme.

console.log('\n── TC-C28–C32 : Parité min-stay ──');

// Reproduce legacy buildMinStayFields inline for comparison
function legacyCalcMinStay(rules, dateStr, dow, scope) {
  const toStr = d => new Date(d).toISOString().split('T')[0];
  const filtered = rules.filter(r => (r.min_stay_scope || 'through') === scope);

  let result = null, minSpan = Infinity;
  for (const rule of filtered) {
    if (rule.min_nights == null || !rule.start_date || !rule.end_date) continue;
    const rs = toStr(rule.start_date), re = toStr(rule.end_date);
    if (dateStr >= rs && dateStr <= re) {
      const span = new Date(re) - new Date(rs);
      if (span < minSpan) { minSpan = span; result = rule.min_nights; }
    }
  }
  if (result != null) return result;

  for (const rule of filtered) {
    if (rule.min_nights == null || !rule.days_of_week) continue;
    if (!rule.start_date && !rule.end_date && rule.days_of_week.includes(dow)) return rule.min_nights;
  }

  for (const rule of filtered) {
    if (rule.min_nights == null) continue;
    if (!rule.start_date && !rule.end_date && !rule.days_of_week) return rule.min_nights;
  }
  return null;
}

function legacyBuildMinStay(rules, dateStr, dow) {
  return {
    min_stay_arrival: legacyCalcMinStay(rules, dateStr, dow, 'arrival') ?? 1,
    min_stay_through: legacyCalcMinStay(rules, dateStr, dow, 'through') ?? 1,
  };
}

// Helpers for resolver parity test
// DOW matching in resolver uses utcDow (UTC noon) — for these tests we use fixed dates
// so DOW is unambiguous.
const { utcDow } = require('../routes/effective-pricing-resolver');

// Inline resolver calcMinStay for direct comparison
function checkParity(rules, dateStr) {
  const dow = utcDow(dateStr);
  const legacy   = legacyBuildMinStay(rules, dateStr, dow);
  const resolver = {
    min_stay_arrival: calcMinStay(rules, dateStr, dow, 'arrival') ?? 1,
    min_stay_through: calcMinStay(rules, dateStr, dow, 'through') ?? 1,
  };
  if (legacy.min_stay_arrival !== resolver.min_stay_arrival ||
      legacy.min_stay_through !== resolver.min_stay_through) {
    throw new Error(
      `PARITY FAILURE on ${dateStr} (dow=${dow})\n` +
      `  legacy  : arrival=${legacy.min_stay_arrival} through=${legacy.min_stay_through}\n` +
      `  resolver: arrival=${resolver.min_stay_arrival} through=${resolver.min_stay_through}\n` +
      `  rules   : ${JSON.stringify(rules)}`,
    );
  }
  return resolver;
}

const DATE_MON = '2026-09-21';  // dow=1
const DATE_FRI = '2026-09-25';  // dow=5
const DATE_SUN = '2026-09-27';  // dow=0

await test('TC-C28 — sans règle min_stay : arrival=1, through=1 (legacy = resolver)', async () => {
  const rules = [];
  const r = checkParity(rules, DATE_MON);
  assert.strictEqual(r.min_stay_arrival, 1);
  assert.strictEqual(r.min_stay_through, 1);
});

await test('TC-C29 — règle globale min_stay=3 (through) : resolver = legacy', async () => {
  const rules = [{
    id: 1, rule_type: 'min_stay', active: true, priority: 0,
    min_nights: 3, min_stay_scope: 'through',
    days_of_week: null, start_date: null, end_date: null,
  }];
  const r = checkParity(rules, DATE_MON);
  assert.strictEqual(r.min_stay_through, 3);
  assert.strictEqual(r.min_stay_arrival, 1, 'arrival scope not set → default 1');

  const r2 = checkParity(rules, DATE_FRI);
  assert.strictEqual(r2.min_stay_through, 3);
});

await test('TC-C30 — règle DOW min_stay=2 vendredi (arrival) : resolver = legacy', async () => {
  const rules = [{
    id: 1, rule_type: 'min_stay', active: true, priority: 0,
    min_nights: 2, min_stay_scope: 'arrival',
    days_of_week: [5],  // Friday
    start_date: null, end_date: null,
  }];
  // On Friday → rule applies
  const rFri = checkParity(rules, DATE_FRI);
  assert.strictEqual(rFri.min_stay_arrival, 2);
  assert.strictEqual(rFri.min_stay_through, 1, 'through scope not set → default 1');

  // On Monday → rule does not apply
  const rMon = checkParity(rules, DATE_MON);
  assert.strictEqual(rMon.min_stay_arrival, 1, 'rule does not apply on Monday');
});

await test('TC-C31 — règle date-range min_stay=4 : resolver = legacy', async () => {
  const rules = [{
    id: 1, rule_type: 'min_stay', active: true, priority: 0,
    min_nights: 4, min_stay_scope: 'through',
    days_of_week: null,
    start_date: '2026-09-20', end_date: '2026-09-26',
  }];
  // DATE_MON (2026-09-21) is inside range
  const rIn = checkParity(rules, DATE_MON);
  assert.strictEqual(rIn.min_stay_through, 4);

  // DATE_SUN (2026-09-27) is outside range
  const rOut = checkParity(rules, DATE_SUN);
  assert.strictEqual(rOut.min_stay_through, 1, 'outside range → default 1');
});

await test('TC-C32 — date-range bat règle globale (même scope) : resolver = legacy', async () => {
  // Date-range rule is narrower → must win over global rule
  const rules = [
    {
      id: 1, rule_type: 'min_stay', active: true, priority: 0,
      min_nights: 3, min_stay_scope: 'through',
      days_of_week: null, start_date: null, end_date: null, // global
    },
    {
      id: 2, rule_type: 'min_stay', active: true, priority: 0,
      min_nights: 7, min_stay_scope: 'through',
      days_of_week: null,
      start_date: '2026-09-20', end_date: '2026-09-24', // date-range
    },
  ];
  // Inside date-range → 7 wins
  const rIn = checkParity(rules, DATE_MON);
  assert.strictEqual(rIn.min_stay_through, 7, 'date-range rule (7) must beat global (3)');

  // Outside date-range → global 3 applies
  const rOut = checkParity(rules, DATE_SUN);
  assert.strictEqual(rOut.min_stay_through, 3, 'global rule (3) applies outside range');
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(55)}`);
console.log(`  Résultats : ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\n  Échecs :');
  failures.forEach(f => console.log(`    • ${f.name}\n      ${f.message}`));
  if (failures.some(f => f.name.includes('Parité') || f.name.includes('TC-C2'))) {
    console.log('\n  ⚠️  STOP : divergence min-stay détectée — ne pas merger avant investigation.');
  }
}
process.exit(failed > 0 ? 1 : 0);

})();
