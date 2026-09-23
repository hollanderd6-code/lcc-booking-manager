#!/usr/bin/env node
'use strict';
/**
 * P0-C4.9-C — Advisory Lock & Publisher Serialization
 *
 * LOCK-01–LOCK-05 : advisory lock helper unit tests
 * L01–L14        : publisher lock integration (serialization, failure release, queue)
 * L10b           : unlock success → release(undefined) (connexion recyclée)
 * L14            : queue recovery after unlock failure (UNLOCK_FAILURE_POISONS_QUEUE=false)
 * C11            : stop-sell regression (stopSellMode preserved through locked publish)
 *
 * No DB. No Channex. All deps injected.
 * Execution: node tests/c4_9c_publish_lock.test.js
 */

const assert = require('assert');
const {
  acquirePropertyLock,
  releasePropertyLock,
  LOCK_NAMESPACE,
  ACQUIRE_TIMEOUT_MS,
} = require('../routes/pricing-publish-lock');
const { createPublisher, PUBLISH_STATUS } = require('../routes/pricing-publisher');

// ─── Runner ───────────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, message: e.message });
    console.log(`  ✗ ${name}: ${e.message}`);
  }
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const D1 = '2026-10-01';
const D2 = '2026-10-02';

function addDays(d, n) {
  const dt = new Date(d + 'T00:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function makeNight(date, overrides = {}) {
  return {
    date, price: 100, priceValid: true,
    minStayArrival: 1, minStayThrough: 1, minStaySource: 'default',
    stopSell: false, stopSellSource: 'none',
    source: 'base_price', sourceId: null, locked: false, breakdown: null, calculatedAt: null,
    ...overrides,
  };
}

function baseProp(overrides = {}) {
  return {
    id: 'p1', user_id: 'u1',
    channex_enabled: true,
    channex_property_id: 'cx_p1',
    channex_room_type_id: 'cx_rt1',
    channex_rate_plan_id: 'cx_rp1',
    external_pricing: false,
    ...overrides,
  };
}

// Publisher's only query against the DB: SELECT … FROM properties WHERE id = $1
// We inject resolveEffectivePrices so the resolver never touches this pool.
function makeMockPool(propertiesList = []) {
  const byId = Object.fromEntries(propertiesList.map(p => [p.id, p]));
  return {
    async query(sql, params = []) {
      if (/from properties/i.test(sql)) {
        const row = byId[params[0]];
        return { rows: row ? [row] : [] };
      }
      throw new Error('MockPool: unrecognized: ' + sql.slice(0, 80));
    },
  };
}

// Build a publisher with injectable deps.
// opts.resolveImpl always injected (default: one night); real resolver never called.
// opts.onRelease: callback placed on every client.release() via default connectClient.
function makePub(propertiesList, opts = {}) {
  const pool = makeMockPool(propertiesList);
  const defaultResolve = async (_c, o) => [makeNight(o.startDate)];
  const publish = createPublisher({
    pushRates:             opts.pushRates        ?? (async (_c, { rates })        => ({ count: rates.length })),
    pushRestrictions:      opts.pushRestrictions ?? (async (_c, { restrictions }) => ({ count: restrictions.length })),
    resolveEffectivePrices: opts.resolveImpl      ?? defaultResolve,
    connectClient: opts.connectClient ?? ((_pool) => {
      const client = { query: (...a) => pool.query(...a), release: opts.onRelease ?? (() => {}) };
      return Promise.resolve(client);
    }),
    acquireLock: opts.acquireLock ?? (async () => {}),
    releaseLock: opts.releaseLock ?? (async () => {}),
  });
  return { publish, pool };
}

function oneNight(propertyId = 'p1', date = D1) {
  return { propertyId, userId: 'u1', startDate: date, endDate: addDays(date, 1) };
}

// ─── LOCK-01–LOCK-05 : advisory lock helper unit tests ────────────────────────

(async () => {

console.log('\n── LOCK-01–LOCK-05 : advisory lock helper ──');

await test('LOCK-01 — acquirePropertyLock résout immédiatement quand pg_try_advisory_lock=true', async () => {
  let queryCalled = false;
  const client = {
    async query(sql, params) {
      queryCalled = true;
      assert.ok(sql.includes('pg_try_advisory_lock'), 'doit appeler pg_try_advisory_lock');
      assert.strictEqual(params[0], LOCK_NAMESPACE, `namespace doit être ${LOCK_NAMESPACE}`);
      return { rows: [{ acquired: true }] };
    },
  };
  await acquirePropertyLock(client, 'prop-01');
  assert.ok(queryCalled, 'client.query doit avoir été appelé');
});

await test('LOCK-02 — acquirePropertyLock réessaie puis acquiert (2 appels)', async () => {
  let calls = 0;
  const client = {
    async query() {
      calls++;
      return { rows: [{ acquired: calls === 2 }] }; // false au 1er, true au 2e
    },
  };
  await acquirePropertyLock(client, 'prop-02');
  assert.strictEqual(calls, 2, 'doit avoir fait exactement 2 appels client.query');
});

await test('LOCK-03 — acquirePropertyLock lance PRICING_PUBLISH_LOCK_TIMEOUT après deadline', async () => {
  // Manipuler Date.now pour forcer le dépassement de délai immédiatement.
  // 1er appel (deadline init) → baseTime ; 2e appel (check) → past deadline
  const savedNow = Date.now.bind(Date);
  let callCount = 0;
  const baseTime = savedNow();
  Date.now = () => {
    callCount++;
    return callCount === 1 ? baseTime : baseTime + ACQUIRE_TIMEOUT_MS + 1;
  };
  const client = { async query() { return { rows: [{ acquired: false }] }; } };
  try {
    await assert.rejects(
      () => acquirePropertyLock(client, 'prop-03'),
      (err) => {
        assert.strictEqual(err.code, 'PRICING_PUBLISH_LOCK_TIMEOUT', 'err.code doit être PRICING_PUBLISH_LOCK_TIMEOUT');
        return true;
      },
    );
  } finally {
    Date.now = savedNow;
  }
});

await test('LOCK-04 — releasePropertyLock appelle pg_advisory_unlock avec les bons params', async () => {
  let capturedSql, capturedParams;
  const client = {
    async query(sql, params) {
      capturedSql = sql;
      capturedParams = params;
    },
  };
  await releasePropertyLock(client, 'prop-04');
  assert.ok(capturedSql && capturedSql.includes('pg_advisory_unlock'),
    'doit appeler pg_advisory_unlock');
  assert.strictEqual(capturedParams[0], LOCK_NAMESPACE, `namespace doit être ${LOCK_NAMESPACE}`);
  assert.strictEqual(capturedParams[1], 'prop-04', 'propertyId doit être passé comme deuxième param');
});

await test('LOCK-05 — namespace 1002 utilisé dans acquire ET release', async () => {
  const namespaces = [];
  const client = {
    async query(_sql, params) {
      namespaces.push(params[0]);
      return { rows: [{ acquired: true }] };
    },
  };
  await acquirePropertyLock(client, 'prop-05');
  await releasePropertyLock(client, 'prop-05');
  assert.strictEqual(namespaces.length, 2, 'deux appels attendus (acquire + release)');
  assert.ok(namespaces.every(ns => ns === 1002), 'les deux doivent utiliser namespace 1002');
});

// ─── L01–L04 : Serialization & ordering ──────────────────────────────────────

console.log('\n── L01–L04 : Sérialisation et ordre ──');

await test('L01 — même propriété : B attend que A soit terminé (sérialisation locale)', async () => {
  let resolverCount = 0;
  let resumeA;
  const aReadyResolve = { fn: null };
  const aReady = new Promise(r => { aReadyResolve.fn = r; });
  const pauseA = new Promise(r => { resumeA = r; });

  const { publish, pool } = makePub(
    [baseProp()],
    {
      resolveImpl: async (_c, o) => {
        resolverCount++;
        return [makeNight(o.startDate)];
      },
      pushRates: async (_c, { rates }) => {
        if (resolverCount === 1) {
          aReadyResolve.fn(); // A a atteint pushRates
          await pauseA;       // A se suspend ici
        }
        return { count: rates.length };
      },
    },
  );

  const promA = publish(pool, oneNight('p1', D1));
  await aReady; // attendre que A soit dans pushRates

  const promB = publish(pool, oneNight('p1', D2));

  // A est suspendu dans pushRates; B est en queue, son resolver n'a pas encore tourné
  assert.strictEqual(resolverCount, 1, 'le resolver de B ne doit pas encore avoir été appelé');

  resumeA(); // libérer A
  const [resA, resB] = await Promise.all([promA, promB]);

  assert.strictEqual(resA.status, PUBLISH_STATUS.OK, 'A doit être ok');
  assert.strictEqual(resB.status, PUBLISH_STATUS.OK, 'B doit être ok');
  assert.strictEqual(resolverCount, 2, 'les deux resolvers doivent avoir été appelés en tout');
});

await test('L02 — propriétés différentes : P2 s\'exécute sans attendre P1', async () => {
  let resumeP1;
  const p1ReadyResolve = { fn: null };
  const p1Ready = new Promise(r => { p1ReadyResolve.fn = r; });
  const p1Pause = new Promise(r => { resumeP1 = r; });

  const pool = makeMockPool([
    baseProp({ id: 'p1' }),
    baseProp({ id: 'p2', channex_property_id: 'cx_p2' }),
  ]);

  const publish = createPublisher({
    resolveEffectivePrices: async (_c, o) => [makeNight(o.startDate)],
    pushRates: async (_c, { property_id, rates }) => {
      if (property_id === 'p1') {
        p1ReadyResolve.fn(); // P1 est entré dans pushRates
        await p1Pause;       // P1 se suspend ici
      }
      return { count: rates.length };
    },
    pushRestrictions: async (_c, { restrictions }) => ({ count: restrictions.length }),
    connectClient: (_pool) => Promise.resolve({ query: (...a) => pool.query(...a), release: () => {} }),
    acquireLock: async () => {},
    releaseLock: async () => {},
  });

  const promP1 = publish(pool, oneNight('p1', D1));
  await p1Ready; // P1 est suspendu dans pushRates

  // P2 sur une propriété différente — ne partage pas la queue de P1
  const promP2 = publish(pool, oneNight('p2', D1));
  const resP2 = await promP2; // doit se terminer sans attendre P1

  assert.strictEqual(resP2.status, PUBLISH_STATUS.OK, 'P2 doit se terminer indépendamment de P1');

  resumeP1();
  const resP1 = await promP1;
  assert.strictEqual(resP1.status, PUBLISH_STATUS.OK, 'P1 doit aussi se terminer normalement');
});

await test('L03 — resolver appelé APRÈS acquireLock (jamais avant)', async () => {
  const events = [];
  const { publish, pool } = makePub(
    [baseProp()],
    {
      acquireLock: async () => { events.push('acquired'); },
      releaseLock: async () => { events.push('released'); },
      resolveImpl: async (_c, o) => { events.push('resolved'); return [makeNight(o.startDate)]; },
    },
  );
  await publish(pool, oneNight());
  const acqIdx = events.indexOf('acquired');
  const resIdx = events.indexOf('resolved');
  assert.ok(acqIdx >= 0, 'acquireLock doit avoir été appelé');
  assert.ok(resIdx >= 0, 'resolver doit avoir été appelé');
  assert.ok(acqIdx < resIdx, `acquireLock (idx ${acqIdx}) doit précéder le resolver (idx ${resIdx})`);
});

await test('L04 — releaseLock appelé APRÈS pushRates ET pushRestrictions', async () => {
  const events = [];
  const { publish, pool } = makePub(
    [baseProp()],
    {
      releaseLock:     async ()                    => { events.push('released'); },
      resolveImpl:     async (_c, o)               => [makeNight(o.startDate)],
      pushRates:       async (_c, { rates })        => { events.push('rates');        return { count: rates.length }; },
      pushRestrictions: async (_c, { restrictions }) => { events.push('restrictions'); return { count: restrictions.length }; },
    },
  );
  await publish(pool, oneNight());
  const relIdx  = events.indexOf('released');
  const ratesIdx = events.indexOf('rates');
  const restrIdx = events.indexOf('restrictions');
  assert.ok(ratesIdx  < relIdx, `pushRates (idx ${ratesIdx}) doit précéder releaseLock (idx ${relIdx})`);
  assert.ok(restrIdx  < relIdx, `pushRestrictions (idx ${restrIdx}) doit précéder releaseLock (idx ${relIdx})`);
});

// ─── L05–L10 : Failure release — every path releases lock + client ─────────────

console.log('\n── L05–L10 : Release sur chaque chemin d\'échec ──');

await test('L05 — resolver throw → lock libéré, client libéré', async () => {
  let lockReleased = false, clientReleased = false;
  const { publish, pool } = makePub(
    [baseProp()],
    {
      resolveImpl: async () => { throw new Error('DB gone'); },
      releaseLock: async () => { lockReleased = true; },
      onRelease:   ()        => { clientReleased = true; },
    },
  );
  await assert.rejects(() => publish(pool, oneNight()), /DB gone/,
    'resolver throw doit se propager');
  assert.ok(lockReleased,   'lock doit être libéré après resolver failure');
  assert.ok(clientReleased, 'client doit être libéré après resolver failure');
});

await test('L06 — pushRates throw → lock libéré, client libéré (résultat error/partial)', async () => {
  let lockReleased = false, clientReleased = false;
  const { publish, pool } = makePub(
    [baseProp()],
    {
      resolveImpl:  async (_c, o) => [makeNight(o.startDate)],
      pushRates:    async ()      => { throw new Error('Channex timeout'); },
      releaseLock:  async ()      => { lockReleased = true; },
      onRelease:    ()             => { clientReleased = true; },
    },
  );
  const res = await publish(pool, oneNight()); // pushRates err est collecté, pas propagé
  assert.ok(
    res.status === PUBLISH_STATUS.ERROR || res.status === PUBLISH_STATUS.PARTIAL,
    `status doit être error ou partial, reçu: ${res.status}`,
  );
  assert.ok(lockReleased,   'lock doit être libéré après pushRates failure');
  assert.ok(clientReleased, 'client doit être libéré après pushRates failure');
});

await test('L07 — pushRestrictions throw → lock libéré, client libéré (status partial)', async () => {
  let lockReleased = false, clientReleased = false;
  const { publish, pool } = makePub(
    [baseProp()],
    {
      resolveImpl:      async (_c, o) => [makeNight(o.startDate)],
      pushRestrictions: async ()      => { throw new Error('restrictions timeout'); },
      releaseLock:      async ()      => { lockReleased = true; },
      onRelease:        ()             => { clientReleased = true; },
    },
  );
  const res = await publish(pool, oneNight());
  assert.strictEqual(res.status, PUBLISH_STATUS.PARTIAL,
    'rates ok + restrictions fail → PARTIAL');
  assert.ok(lockReleased,   'lock doit être libéré après pushRestrictions failure');
  assert.ok(clientReleased, 'client doit être libéré après pushRestrictions failure');
});

await test('L08 — acquireLock LOCK_TIMEOUT → client libéré SANS erreur (connexion non détruite), lock NON releasé', async () => {
  let lockReleased = false;
  let releaseArg = 'NOT_CALLED';
  let releaseCalls = 0;
  const lockErr = Object.assign(
    new Error('PRICING_PUBLISH_LOCK_TIMEOUT: test'),
    { code: 'PRICING_PUBLISH_LOCK_TIMEOUT' },
  );
  const pool = makeMockPool([baseProp()]);
  const mockClient = {
    query: (...a) => pool.query(...a),
    release: (arg) => { releaseCalls++; releaseArg = arg; },
  };
  const publish = createPublisher({
    resolveEffectivePrices: async (_c, o) => [makeNight(o.startDate)],
    pushRates:     async (_c, { rates })        => ({ count: rates.length }),
    pushRestrictions: async (_c, { restrictions }) => ({ count: restrictions.length }),
    connectClient: (_pool) => Promise.resolve(mockClient),
    acquireLock: async () => { throw lockErr; },
    releaseLock: async () => { lockReleased = true; },
  });
  await assert.rejects(() => publish(pool, oneNight()), /PRICING_PUBLISH_LOCK_TIMEOUT/);
  assert.ok(!lockReleased,         'releaseLock ne doit PAS être appelé (lock jamais acquis)');
  assert.strictEqual(releaseCalls, 1, 'client.release doit être appelé exactement une fois');
  assert.strictEqual(releaseArg, undefined, 'release arg doit être undefined (connexion recyclée normalement)');
});

await test('L09 — pool.connect() throw → pas de lock, pas de push, erreur propagée', async () => {
  let lockCalled = false, pushCalled = false;
  const { publish, pool } = makePub(
    [baseProp()],
    {
      connectClient: async () => { throw new Error('pool exhausted'); },
      acquireLock:   async ()  => { lockCalled = true; },
      pushRates:     async ()  => { pushCalled = true; return { count: 0 }; },
    },
  );
  await assert.rejects(() => publish(pool, oneNight()), /pool exhausted/);
  assert.ok(!lockCalled, 'acquireLock ne doit pas être appelé si connect échoue');
  assert.ok(!pushCalled, 'pushRates ne doit pas être appelé si connect échoue');
});

await test('L10 — releaseLock throw → client.release(err) avec l\'erreur exacte, connexion détruite, publish rejette', async () => {
  const unlockErr = new Error('unlock failed');
  let releaseArg = 'NOT_CALLED';
  let releaseCalls = 0;
  let releaseLockCalled = false;

  const pool = makeMockPool([baseProp()]);
  const mockClient = {
    query: (...a) => pool.query(...a),
    release: (arg) => { releaseCalls++; releaseArg = arg; },
  };
  const publish = createPublisher({
    resolveEffectivePrices: async (_c, o) => [makeNight(o.startDate)],
    pushRates:     async (_c, { rates })        => ({ count: rates.length }),
    pushRestrictions: async (_c, { restrictions }) => ({ count: restrictions.length }),
    connectClient: (_pool) => Promise.resolve(mockClient),
    acquireLock:   async () => {},
    releaseLock:   async () => { releaseLockCalled = true; throw unlockErr; },
  });

  await assert.rejects(() => publish(pool, oneNight()), /unlock failed/,
    'publish doit rejeter avec l\'erreur d\'unlock');
  assert.ok(releaseLockCalled, 'releaseLock doit avoir été appelé');
  assert.strictEqual(releaseCalls, 1, 'client.release doit être appelé exactement une fois');
  assert.strictEqual(releaseArg, unlockErr,
    'client.release doit recevoir l\'erreur exacte (pg-pool détruira la connexion)');
});

await test('L10b — unlock réussit → client.release() sans argument (connexion recyclée normalement)', async () => {
  let releaseArg = 'NOT_CALLED';
  let releaseCalls = 0;

  const pool = makeMockPool([baseProp()]);
  const mockClient = {
    query: (...a) => pool.query(...a),
    release: (arg) => { releaseCalls++; releaseArg = arg; },
  };
  const publish = createPublisher({
    resolveEffectivePrices: async (_c, o) => [makeNight(o.startDate)],
    pushRates:     async (_c, { rates })        => ({ count: rates.length }),
    pushRestrictions: async (_c, { restrictions }) => ({ count: restrictions.length }),
    connectClient: (_pool) => Promise.resolve(mockClient),
    acquireLock:   async () => {},
    releaseLock:   async () => {}, // success
  });

  const res = await publish(pool, oneNight());
  assert.strictEqual(res.status, PUBLISH_STATUS.OK, 'publish doit réussir');
  assert.strictEqual(releaseCalls, 1, 'client.release doit être appelé exactement une fois');
  assert.strictEqual(releaseArg, undefined,
    'release arg doit être undefined sur succès (connexion retournée au pool)');
});

// ─── L11–L13 : Queue properties ───────────────────────────────────────────────

console.log('\n── L11–L13 : Propriétés de la queue ──');

await test('L11 — échec de A ne bloque pas B (queue avance malgré failure)', async () => {
  let resolverCount = 0;
  const { publish, pool } = makePub(
    [baseProp()],
    {
      resolveImpl: async (_c, o) => {
        resolverCount++;
        if (resolverCount === 1) throw new Error('A resolver failed');
        return [makeNight(o.startDate)];
      },
    },
  );
  const promA = publish(pool, oneNight('p1', D1));
  const promB = publish(pool, oneNight('p1', D2));

  const resA = await promA.catch(e => e);
  const resB = await promB;

  assert.ok(resA instanceof Error, 'A doit avoir produit une erreur');
  assert.strictEqual(resB.status, PUBLISH_STATUS.OK, 'B doit réussir malgré l\'échec de A');
  assert.strictEqual(resolverCount, 2, 'les deux resolvers doivent avoir été appelés');
});

await test('L12 — chaque appel s\'exécute exactement une fois (3 appels séquentiels)', async () => {
  let resolverCount = 0;
  const { publish, pool } = makePub(
    [baseProp()],
    {
      resolveImpl: async (_c, o) => {
        resolverCount++;
        return [makeNight(o.startDate)];
      },
    },
  );
  await Promise.all([
    publish(pool, oneNight('p1', D1)),
    publish(pool, oneNight('p1', D2)),
    publish(pool, oneNight('p1', addDays(D2, 1))),
  ]);
  assert.strictEqual(resolverCount, 3,
    'chaque publish doit appeler le resolver exactement une fois (3 total)');
});

await test('L13 — guard skip (external_pricing) → lock libéré, client libéré', async () => {
  let lockReleased = false, clientReleased = false;
  const { publish, pool } = makePub(
    [baseProp({ external_pricing: true })],
    {
      releaseLock: async () => { lockReleased = true; },
      onRelease:   ()        => { clientReleased = true; },
    },
  );
  const res = await publish(pool, oneNight());
  assert.strictEqual(res.status, PUBLISH_STATUS.SKIPPED_EXTERNAL);
  assert.ok(lockReleased,   'lock doit être libéré même sur guard skip');
  assert.ok(clientReleased, 'client doit être libéré même sur guard skip');
});

// ─── L14 : Queue recovery after unlock failure ────────────────────────────────

console.log('\n── L14 : Queue recovery après unlock failure ──');

await test('L14 — unlock failure de A ne poison pas la queue : B démarre, publie, release normal', async () => {
  const unlockErrA = new Error('unlock failed on A');
  let resolverCount = 0;
  // Track release args per call
  const releaseArgs = [];

  const pool = makeMockPool([baseProp()]);
  const publish = createPublisher({
    resolveEffectivePrices: async (_c, o) => { resolverCount++; return [makeNight(o.startDate)]; },
    pushRates:     async (_c, { rates })        => ({ count: rates.length }),
    pushRestrictions: async (_c, { restrictions }) => ({ count: restrictions.length }),
    connectClient: (_pool) => Promise.resolve({
      query: (...a) => pool.query(...a),
      release: (arg) => { releaseArgs.push(arg); },
    }),
    acquireLock: async () => {},
    releaseLock: async () => {
      if (resolverCount === 1) throw unlockErrA; // A unlock fails
      // B unlock succeeds
    },
  });

  const promA = publish(pool, oneNight('p1', D1));
  const promB = publish(pool, oneNight('p1', D2));

  const resA = await promA.catch(e => e);
  const resB = await promB;

  assert.ok(resA instanceof Error && resA.message === 'unlock failed on A',
    'A doit rejeter avec l\'erreur d\'unlock');
  assert.strictEqual(resB.status, PUBLISH_STATUS.OK,
    'B doit réussir normalement après unlock failure de A');
  assert.strictEqual(resolverCount, 2, 'les deux resolvers ont été appelés');
  assert.strictEqual(releaseArgs.length, 2, 'deux connexions libérées (une par publish)');
  assert.strictEqual(releaseArgs[0], unlockErrA,
    'release de A reçoit l\'erreur (connexion détruite)');
  assert.strictEqual(releaseArgs[1], undefined,
    'release de B est propre (connexion recyclée normalement)');
});

// ─── C11 : Stop-sell regression ───────────────────────────────────────────────

console.log('\n── C11 : Régression stop-sell ──');

await test('C11 — stopSellMode:none préservé à travers le publish verrouillé', async () => {
  let capturedRestrictions;
  const { publish, pool } = makePub(
    [baseProp()],
    {
      resolveImpl:      async (_c, o)              => [makeNight(o.startDate, { stopSell: true })],
      pushRestrictions: async (_c, { restrictions }) => {
        capturedRestrictions = restrictions;
        return { count: restrictions.length };
      },
    },
  );
  await publish(pool, { ...oneNight(), stopSellMode: 'none' });
  assert.ok(capturedRestrictions, 'pushRestrictions doit avoir été appelé');
  assert.ok(
    !Object.prototype.hasOwnProperty.call(capturedRestrictions[0], 'stop_sell'),
    "stopSellMode:'none' doit supprimer le champ stop_sell même quand stopSell=true",
  );
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
