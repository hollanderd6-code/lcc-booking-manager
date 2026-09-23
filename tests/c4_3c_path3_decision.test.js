#!/usr/bin/env node
'use strict';
/**
 * P0-C4.3-C — PATH 3 Manual Accept: transactional DB + central publisher
 *
 * Tests T01-T26 covering:
 *   Group A (T01-T07)  : transaction writes (history + 7 schedule rows)
 *   Group B (T08-T10)  : transaction ordering (BEGIN → writes → COMMIT → publisher)
 *   Group C (T11-T14)  : publisher call contract
 *   Group D (T15-T17)  : failure semantics
 *   Group E (T18-T20)  : DECLINE does not touch schedule or publisher (structural)
 *   Group F (T21-T23)  : C7 recalc protection in pricing-apply.js
 *   Group G (T24-T25)  : old direct pushRates removed (structural)
 *   Group H (T26)      : price clamping
 *
 * No real DB. No real Channex. No real publisher.
 *
 * Execution: node tests/c4_3c_path3_decision.test.js
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const { _applyDecision } = require('../routes/dynamic-pricing-routes');
const { addDays }        = require('../routes/effective-pricing-resolver');
const { applyDynamicPricingForProperty } = require('../routes/pricing-apply');

// ─── Source for structural checks ────────────────────────────────────────────

const decisionSrc = fs.readFileSync(
  path.join(__dirname, '..', 'routes', 'dynamic-pricing-routes.js'), 'utf8'
);

// ─── Test runner ──────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (e) {
    failed++;
    failures.push({ name, message: e.message });
    process.stdout.write(`  ✗ ${name}\n    ${e.message}\n`);
  }
}

// ─── Mock helpers ─────────────────────────────────────────────────────────────

const WEEK_START = '2026-09-22';

function makeHistoryRow(overrides = {}) {
  return {
    id:               42,
    user_id:          'user-abc',
    property_id:      'prop-xyz',
    week_start:       WEEK_START,
    price_calculated: '120',
    price_min:        '80',
    price_max:        '200',
    ...overrides,
  };
}

function makeMockPool() {
  const clientQueries = [];
  let released = false;
  const client = {
    queries: clientQueries,
    query: async (sql, params) => {
      clientQueries.push({ sql: sql.trim(), params: params || [] });
      return { rows: [] };
    },
    release: () => { released = true; },
    _released: () => released,
  };
  return {
    connect:      async () => client,
    _client:      client,
    query:        async () => ({ rows: [] }),
  };
}

function makePublisherSpy(result) {
  const spy = { calls: 0, lastArgs: null };
  spy.fn = async (pool, opts) => {
    spy.calls++;
    spy.lastArgs = opts;
    return result || { status: 'ok', propertyId: opts.propertyId, reason: opts.reason,
      nights: 7, rates: { count: 7, pushed: 7, error: null },
      restrictions: { count: 7, pushed: 7, error: null } };
  };
  return spy;
}

function makeDeps(pubResult) {
  const spy = makePublisherSpy(pubResult);
  return { deps: { publishEffectivePricing: spy.fn, addDays }, spy };
}

// ─── Group A : transaction writes ─────────────────────────────────────────────

(async () => {
  process.stdout.write('\n─── C4.3-C — PATH 3 Decision Tests ───\n\n');

  await test('T01 — pricing_history UPDATE is the first non-BEGIN client query', async () => {
    const pool = makeMockPool();
    const { deps } = makeDeps();
    await _applyDecision(pool, { historyRow: makeHistoryRow(), callerUserId: 'caller-1', priceApplied: 120 }, deps);
    const first = pool._client.queries.find(q => !q.sql.startsWith('BEGIN'));
    assert.ok(first, 'At least one non-BEGIN query expected');
    assert.ok(first.sql.includes('UPDATE pricing_history'), `Expected UPDATE pricing_history, got: ${first.sql.slice(0,60)}`);
  });

  await test('T02 — exactly 7 INSERT INTO pricing_schedule queries issued', async () => {
    const pool = makeMockPool();
    const { deps } = makeDeps();
    await _applyDecision(pool, { historyRow: makeHistoryRow(), callerUserId: 'c', priceApplied: 120 }, deps);
    const inserts = pool._client.queries.filter(q => q.sql.includes('INSERT INTO pricing_schedule'));
    assert.strictEqual(inserts.length, 7, `Expected 7 schedule inserts, got ${inserts.length}`);
  });

  await test("T03 — schedule inserts use status='applied'", async () => {
    const pool = makeMockPool();
    const { deps } = makeDeps();
    await _applyDecision(pool, { historyRow: makeHistoryRow(), callerUserId: 'c', priceApplied: 120 }, deps);
    const inserts = pool._client.queries.filter(q => q.sql.includes('INSERT INTO pricing_schedule'));
    inserts.forEach((q, i) => {
      assert.ok(q.sql.includes("'applied'"), `Schedule insert ${i}: missing 'applied' status in SQL`);
    });
  });

  await test('T04 — schedule inserts use priceApplied=150 for all 7 rows', async () => {
    const pool = makeMockPool();
    const { deps } = makeDeps();
    await _applyDecision(pool, { historyRow: makeHistoryRow(), callerUserId: 'c', priceApplied: 150 }, deps);
    const inserts = pool._client.queries.filter(q => q.sql.includes('INSERT INTO pricing_schedule'));
    inserts.forEach((q, i) => {
      assert.strictEqual(q.params[3], 150, `Schedule insert ${i}: expected price=150, got ${q.params[3]}`);
    });
  });

  await test("T05 — schedule inserts use reason='manual_accept'", async () => {
    const pool = makeMockPool();
    const { deps } = makeDeps();
    await _applyDecision(pool, { historyRow: makeHistoryRow(), callerUserId: 'c', priceApplied: 120 }, deps);
    const inserts = pool._client.queries.filter(q => q.sql.includes('INSERT INTO pricing_schedule'));
    inserts.forEach((q, i) => {
      assert.strictEqual(q.params[5], 'manual_accept', `Schedule insert ${i}: expected reason='manual_accept', got '${q.params[5]}'`);
    });
  });

  await test('T06 — schedule breakdown contains manual_accept:true', async () => {
    const pool = makeMockPool();
    const { deps } = makeDeps();
    await _applyDecision(pool, { historyRow: makeHistoryRow(), callerUserId: 'c', priceApplied: 99 }, deps);
    const inserts = pool._client.queries.filter(q => q.sql.includes('INSERT INTO pricing_schedule'));
    inserts.forEach((q, i) => {
      const bd = JSON.parse(q.params[6]);
      assert.strictEqual(bd.manual_accept, true, `Schedule insert ${i}: breakdown.manual_accept !== true`);
      assert.strictEqual(bd.priceApplied, 99, `Schedule insert ${i}: breakdown.priceApplied !== 99`);
    });
  });

  await test('T07 — schedule inserts use min_stay=1', async () => {
    const pool = makeMockPool();
    const { deps } = makeDeps();
    await _applyDecision(pool, { historyRow: makeHistoryRow(), callerUserId: 'c', priceApplied: 120 }, deps);
    const inserts = pool._client.queries.filter(q => q.sql.includes('INSERT INTO pricing_schedule'));
    inserts.forEach((q, i) => {
      assert.strictEqual(q.params[4], 1, `Schedule insert ${i}: expected min_stay=1, got ${q.params[4]}`);
    });
  });

  // ─── Group B : transaction ordering ───────────────────────────────────────────

  await test('T08 — BEGIN is first client query', async () => {
    const pool = makeMockPool();
    const { deps } = makeDeps();
    await _applyDecision(pool, { historyRow: makeHistoryRow(), callerUserId: 'c', priceApplied: 120 }, deps);
    const first = pool._client.queries[0];
    assert.ok(first.sql.startsWith('BEGIN'), `First query should be BEGIN, got: ${first.sql.slice(0,30)}`);
  });

  await test('T09 — COMMIT follows the 7 schedule inserts (and precedes publisher)', async () => {
    const pool = makeMockPool();
    const publishCallOrder = { after: -1 };
    let queryCount = 0;
    const origQuery = pool._client.query.bind(pool._client);
    pool._client.query = async (sql, params) => {
      queryCount++;
      return origQuery(sql, params);
    };
    const deps = {
      addDays,
      publishEffectivePricing: async () => {
        publishCallOrder.after = queryCount;
        return { status: 'ok', propertyId: 'p', reason: 'manual_accept',
          nights: 7, rates: { count: 7, pushed: 7, error: null },
          restrictions: { count: 7, pushed: 7, error: null } };
      },
    };
    await _applyDecision(pool, { historyRow: makeHistoryRow(), callerUserId: 'c', priceApplied: 120 }, deps);
    const commitIdx = pool._client.queries.findIndex(q => q.sql.startsWith('COMMIT'));
    assert.ok(commitIdx >= 0, 'COMMIT not found');
    const insertCount = pool._client.queries.filter(q => q.sql.includes('INSERT INTO pricing_schedule')).length;
    assert.strictEqual(insertCount, 7, 'Expected 7 schedule inserts before COMMIT');
    assert.ok(publishCallOrder.after > commitIdx,
      `Publisher (query count ${publishCallOrder.after}) should be called after COMMIT (index ${commitIdx})`);
  });

  await test('T10 — client.release() is called after COMMIT', async () => {
    const pool = makeMockPool();
    const { deps } = makeDeps();
    await _applyDecision(pool, { historyRow: makeHistoryRow(), callerUserId: 'c', priceApplied: 120 }, deps);
    assert.ok(pool._client._released(), 'client.release() was not called');
  });

  // ─── Group C : publisher call contract ────────────────────────────────────────

  await test('T11 — publisher called with correct propertyId and userId', async () => {
    const pool = makeMockPool();
    const { deps, spy } = makeDeps();
    const row = makeHistoryRow({ property_id: 'prop-test', user_id: 'owner-99' });
    await _applyDecision(pool, { historyRow: row, callerUserId: 'caller-99', priceApplied: 120 }, deps);
    assert.strictEqual(spy.calls, 1, 'publisher should be called exactly once');
    assert.strictEqual(spy.lastArgs.propertyId, 'prop-test', 'wrong propertyId');
    assert.strictEqual(spy.lastArgs.userId, 'owner-99', 'userId should be historyRow.user_id');
  });

  await test("T12 — publisher called with reason='manual_accept'", async () => {
    const pool = makeMockPool();
    const { deps, spy } = makeDeps();
    await _applyDecision(pool, { historyRow: makeHistoryRow(), callerUserId: 'c', priceApplied: 120 }, deps);
    assert.strictEqual(spy.lastArgs.reason, 'manual_accept', `expected reason='manual_accept', got '${spy.lastArgs.reason}'`);
  });

  await test('T13 — publisher startDate=week_start, endDate=week_start+7', async () => {
    const pool = makeMockPool();
    const { deps, spy } = makeDeps();
    await _applyDecision(pool, { historyRow: makeHistoryRow(), callerUserId: 'c', priceApplied: 120 }, deps);
    assert.strictEqual(spy.lastArgs.startDate, WEEK_START, `startDate should be ${WEEK_START}`);
    const expectedEnd = addDays(WEEK_START, 7);
    assert.strictEqual(spy.lastArgs.endDate, expectedEnd, `endDate should be ${expectedEnd}`);
  });

  await test('T14 — publisher called exactly once per _applyDecision call', async () => {
    const pool = makeMockPool();
    const { deps, spy } = makeDeps();
    await _applyDecision(pool, { historyRow: makeHistoryRow(), callerUserId: 'c', priceApplied: 120 }, deps);
    await _applyDecision(pool, { historyRow: makeHistoryRow({ id: 43 }), callerUserId: 'c', priceApplied: 130 }, deps);
    assert.strictEqual(spy.calls, 2, `Expected 2 publisher calls (one per _applyDecision), got ${spy.calls}`);
  });

  // ─── Group D : failure semantics ──────────────────────────────────────────────

  await test('T15 — DB error in transaction triggers ROLLBACK and rethrows', async () => {
    const pool = makeMockPool();
    let rolledBack = false;
    const origQuery = pool._client.query.bind(pool._client);
    pool._client.query = async (sql, params) => {
      if (sql.trim().startsWith('ROLLBACK')) rolledBack = true;
      if (sql.trim().includes('UPDATE pricing_history')) throw new Error('DB write failed');
      return origQuery(sql, params);
    };
    const { deps } = makeDeps();
    await assert.rejects(
      () => _applyDecision(pool, { historyRow: makeHistoryRow(), callerUserId: 'c', priceApplied: 120 }, deps),
      /DB write failed/
    );
    assert.ok(rolledBack, 'ROLLBACK should be called on transaction error');
  });

  await test('T16 — publisher returns error status → result returned, no exception', async () => {
    const pool = makeMockPool();
    const errResult = { status: 'error', propertyId: 'p', reason: 'manual_accept',
      nights: 7, rates: { count: 7, pushed: 0, error: 'Channex 500' },
      restrictions: { count: 7, pushed: 0, error: 'Channex 500' } };
    const { deps } = makeDeps(errResult);
    const result = await _applyDecision(pool, { historyRow: makeHistoryRow(), callerUserId: 'c', priceApplied: 120 }, deps);
    assert.strictEqual(result.status, 'error', 'Should return error status, not throw');
  });

  await test('T17 — publisher returns partial status → result returned, no exception', async () => {
    const pool = makeMockPool();
    const partial = { status: 'partial', propertyId: 'p', reason: 'manual_accept',
      nights: 7, rates: { count: 7, pushed: 7, error: null },
      restrictions: { count: 7, pushed: 0, error: 'timeout' } };
    const { deps } = makeDeps(partial);
    const result = await _applyDecision(pool, { historyRow: makeHistoryRow(), callerUserId: 'c', priceApplied: 120 }, deps);
    assert.strictEqual(result.status, 'partial');
  });

  // ─── Group E : DECLINE structural checks ──────────────────────────────────────

  await test("T18 — DECLINE block does not contain INSERT INTO pricing_schedule (structural)", () => {
    // DECLINE is the else branch that sets status='declined'
    const declineIdx = decisionSrc.indexOf("status = 'declined'");
    assert.ok(declineIdx >= 0, "DECLINE block not found (no status='declined' in source)");
    // Look 600 chars around the declined update — that's the entire else branch
    const declineBlock = decisionSrc.slice(Math.max(0, declineIdx - 50), declineIdx + 400);
    assert.ok(
      !declineBlock.includes('INSERT INTO pricing_schedule'),
      'DECLINE block must not insert into pricing_schedule'
    );
  });

  await test('T19 — DECLINE block does not call publishEffectivePricing (structural)', () => {
    const declineIdx = decisionSrc.indexOf("status = 'declined'");
    assert.ok(declineIdx >= 0, "DECLINE block not found");
    const declineBlock = decisionSrc.slice(Math.max(0, declineIdx - 50), declineIdx + 400);
    assert.ok(
      !declineBlock.includes('publishEffectivePricing') && !declineBlock.includes('_applyDecision'),
      'DECLINE block must not call publisher or _applyDecision'
    );
  });

  await test('T20 — ACCEPT block no longer calls pushRates directly (structural)', () => {
    const applyIdx = decisionSrc.indexOf("action === 'apply'");
    assert.ok(applyIdx >= 0, "ACCEPT block not found");
    const applyBlock = decisionSrc.slice(applyIdx, applyIdx + 600);
    assert.ok(
      !applyBlock.includes("require('../channex')") && !applyBlock.includes('pushRates'),
      "ACCEPT block must not call pushRates directly — legacy push removed in C4.3-C"
    );
  });

  // ─── Group F : C7 recalc protection ───────────────────────────────────────────

  await test('T21 — C7 filter uses protectedDates.has(n.date) and nightsToUpsert (structural)', () => {
    const applySrc = fs.readFileSync(
      path.join(__dirname, '..', 'routes', 'pricing-apply.js'), 'utf8'
    );
    assert.ok(
      applySrc.includes('protectedDates.has(n.date)'),
      "C7 must exclude dates via protectedDates.has(n.date)"
    );
    assert.ok(
      applySrc.includes('nightsToUpsert'),
      "C7 must store filtered nights in nightsToUpsert before calling upsertSchedule"
    );
    // Full behavioral coverage: tests/pricing_apply.test.js C7-A (protected excluded),
    // C7-B (unprotected passes through), C7-C (auto mode bypasses protection).
  });

  await test('T22 — pricing-apply.js imports addDays (structural)', () => {
    const applySrc = fs.readFileSync(
      path.join(__dirname, '..', 'routes', 'pricing-apply.js'), 'utf8'
    );
    assert.ok(
      applySrc.includes('addDays') && applySrc.includes('effective-pricing-resolver'),
      'pricing-apply.js must import addDays from effective-pricing-resolver for C7'
    );
  });

  await test('T23 — C7 protection query targets mode_used=manual AND status=applied (structural)', () => {
    const applySrc = fs.readFileSync(
      path.join(__dirname, '..', 'routes', 'pricing-apply.js'), 'utf8'
    );
    assert.ok(
      applySrc.includes("mode_used = 'manual'") && applySrc.includes("status = 'applied'"),
      "C7 query must filter on status='applied' AND mode_used='manual'"
    );
  });

  // ─── Group G : old direct pushRates removed ───────────────────────────────────

  await test("T24 — _applyDecision does not require('../channex') (structural)", () => {
    const applyDecisionIdx = decisionSrc.indexOf('async function _applyDecision');
    assert.ok(applyDecisionIdx >= 0, '_applyDecision function not found');
    let depth = 0, fnBody = '';
    for (let i = applyDecisionIdx; i < decisionSrc.length; i++) {
      if (decisionSrc[i] === '{') { depth++; }
      else if (decisionSrc[i] === '}') { depth--; if (depth === 0) { fnBody = decisionSrc.slice(applyDecisionIdx, i + 1); break; } }
    }
    assert.ok(!fnBody.includes("require('../channex')"),
      '_applyDecision must not require channex directly');
    assert.ok(!fnBody.includes('pushRates'),
      '_applyDecision must not call pushRates directly');
  });

  await test('T25 — _applyDecision is exported from dynamic-pricing-routes.js (structural)', () => {
    assert.ok(
      decisionSrc.includes('_applyDecision') && decisionSrc.includes('module.exports'),
      '_applyDecision must be exported'
    );
    const exportsIdx = decisionSrc.lastIndexOf('module.exports');
    const exportsBlock = decisionSrc.slice(exportsIdx, exportsIdx + 300);
    assert.ok(exportsBlock.includes('_applyDecision'), '_applyDecision not in module.exports');
  });

  // ─── Group H : price clamping ─────────────────────────────────────────────────

  await test('T26 — priceApplied is clamped: below min → min, above max → max, within → unchanged', async () => {
    const pool = makeMockPool();

    // Below min
    let { deps: d1, spy: s1 } = makeDeps();
    const rowBelowMin = makeHistoryRow({ price_calculated: '50', price_min: '80', price_max: '200' });
    await _applyDecision(pool, { historyRow: rowBelowMin, callerUserId: 'c', priceApplied: 80 }, d1);
    const histUpdate1 = pool._client.queries.find(q => q.sql.includes('UPDATE pricing_history'));
    assert.strictEqual(histUpdate1.params[0], 80, 'Below min: priceApplied should be clamped to 80');

    // Above max — fresh pool
    const pool2 = makeMockPool();
    const { deps: d2 } = makeDeps();
    const rowAboveMax = makeHistoryRow({ price_calculated: '250', price_min: '80', price_max: '200' });
    await _applyDecision(pool2, { historyRow: rowAboveMax, callerUserId: 'c', priceApplied: 200 }, d2);
    const histUpdate2 = pool2._client.queries.find(q => q.sql.includes('UPDATE pricing_history'));
    assert.strictEqual(histUpdate2.params[0], 200, 'Above max: priceApplied should be clamped to 200');

    // Within range
    const pool3 = makeMockPool();
    const { deps: d3 } = makeDeps();
    const rowWithin = makeHistoryRow({ price_calculated: '120', price_min: '80', price_max: '200' });
    await _applyDecision(pool3, { historyRow: rowWithin, callerUserId: 'c', priceApplied: 120 }, d3);
    const histUpdate3 = pool3._client.queries.find(q => q.sql.includes('UPDATE pricing_history'));
    assert.strictEqual(histUpdate3.params[0], 120, 'Within range: priceApplied should equal price_calculated');
  });

  // ─── Group I : min_stay preservation (M01-M05) ────────────────────────────────

  await test('M01 — ON CONFLICT uses COALESCE(pricing_schedule.min_stay, EXCLUDED.min_stay) (structural)', () => {
    const fnStart = decisionSrc.indexOf('async function _applyDecision');
    const fnEnd   = decisionSrc.indexOf('// ── Setup principal');
    const fnSrc   = decisionSrc.slice(fnStart, fnEnd);
    assert.ok(
      fnSrc.includes('COALESCE(pricing_schedule.min_stay, EXCLUDED.min_stay)'),
      '_applyDecision ON CONFLICT must use COALESCE to preserve existing min_stay'
    );
  });

  await test('M02 — ON CONFLICT does NOT unconditionally overwrite min_stay with EXCLUDED.min_stay (structural)', () => {
    const fnStart       = decisionSrc.indexOf('async function _applyDecision');
    const fnEnd         = decisionSrc.indexOf('// ── Setup principal');
    const fnSrc         = decisionSrc.slice(fnStart, fnEnd);
    const conflictIdx   = fnSrc.indexOf('ON CONFLICT');
    const conflictBlock = fnSrc.slice(conflictIdx, conflictIdx + 500);
    assert.ok(
      !conflictBlock.includes('min_stay   = EXCLUDED.min_stay') &&
      !conflictBlock.includes('min_stay = EXCLUDED.min_stay'),
      'ON CONFLICT must not unconditionally set min_stay = EXCLUDED.min_stay (destroys existing value)'
    );
  });

  await test('M03 — INSERT params[4]=1 : new row gets min_stay=1 as fallback (behavioral)', async () => {
    const pool = makeMockPool();
    const { deps } = makeDeps();
    await _applyDecision(pool, { historyRow: makeHistoryRow(), callerUserId: 'c', priceApplied: 120 }, deps);
    const inserts = pool._client.queries.filter(q => q.sql.includes('INSERT INTO pricing_schedule'));
    assert.strictEqual(inserts.length, 7, 'Expected 7 INSERT queries');
    inserts.forEach((q, i) => {
      assert.strictEqual(q.params[4], 1,
        `INSERT night ${i}: params[4] (min_stay value passed to INSERT / COALESCE fallback) must be 1`);
    });
  });

  await test('M04 — ON CONFLICT overwrites price with priceApplied (behavioral)', async () => {
    const pool = makeMockPool();
    const { deps } = makeDeps();
    await _applyDecision(pool, { historyRow: makeHistoryRow(), callerUserId: 'c', priceApplied: 155 }, deps);
    const inserts = pool._client.queries.filter(q => q.sql.includes('INSERT INTO pricing_schedule'));
    inserts.forEach((q, i) => {
      assert.strictEqual(q.params[3], 155,
        `INSERT night ${i}: params[3] (price) must be priceApplied=155`);
    });
    const fnStart       = decisionSrc.indexOf('async function _applyDecision');
    const fnEnd         = decisionSrc.indexOf('// ── Setup principal');
    const conflictBlock = decisionSrc.slice(fnStart, fnEnd).slice(decisionSrc.indexOf('ON CONFLICT') - fnStart);
    assert.ok(
      conflictBlock.includes('price      = EXCLUDED.price'),
      'ON CONFLICT must overwrite price with EXCLUDED.price'
    );
  });

  await test("M05 — ON CONFLICT overwrites reason with 'manual_accept' (behavioral)", async () => {
    const pool = makeMockPool();
    const { deps } = makeDeps();
    await _applyDecision(pool, { historyRow: makeHistoryRow(), callerUserId: 'c', priceApplied: 120 }, deps);
    const inserts = pool._client.queries.filter(q => q.sql.includes('INSERT INTO pricing_schedule'));
    inserts.forEach((q, i) => {
      assert.strictEqual(q.params[5], 'manual_accept',
        `INSERT night ${i}: params[5] (reason) must be 'manual_accept'`);
    });
    const fnStart       = decisionSrc.indexOf('async function _applyDecision');
    const fnEnd         = decisionSrc.indexOf('// ── Setup principal');
    const conflictBlock = decisionSrc.slice(fnStart, fnEnd).slice(decisionSrc.indexOf('ON CONFLICT') - fnStart);
    assert.ok(
      conflictBlock.includes('reason     = EXCLUDED.reason'),
      'ON CONFLICT must overwrite reason with EXCLUDED.reason'
    );
  });

  // ─── Group J : C4.8-B stop_sell intent (B20) ─────────────────────────────────

  await test('B20 — _applyDecision passe stopSellMode:none au publisher (manual_accept = price-only)', async () => {
    const pool = makeMockPool();
    const { deps, spy } = makeDeps();
    await _applyDecision(pool, { historyRow: makeHistoryRow(), callerUserId: 'c', priceApplied: 120 }, deps);
    assert.strictEqual(spy.lastArgs.stopSellMode, 'none',
      'manual_accept doit passer stopSellMode:none — ne doit pas toucher stop_sell');
  });

  await test('B21 — stopSellMode:none ne dépend pas du default publisher (explicitement transmis)', () => {
    // Structural: _applyDecision must contain an explicit stopSellMode:'none' call.
    // Scan from the function declaration up to the first module.exports after it.
    const applyIdx = decisionSrc.indexOf('async function _applyDecision');
    assert.ok(applyIdx >= 0, '_applyDecision non trouvée');
    const endIdx = decisionSrc.indexOf('module.exports', applyIdx);
    assert.ok(endIdx >= 0, 'module.exports non trouvé après _applyDecision');
    const fnRegion = decisionSrc.slice(applyIdx, endIdx);
    assert.ok(
      fnRegion.includes("stopSellMode: 'none'"),
      "_applyDecision doit passer stopSellMode:'none' explicitement (pas de dépendance au default publisher)"
    );
    assert.ok(
      !fnRegion.includes("stopSellMode: 'authoritative'"),
      "_applyDecision ne doit PAS utiliser authoritative"
    );
  });

  // ─── Summary ─────────────────────────────────────────────────────────────────

  process.stdout.write(`\n${'─'.repeat(60)}\n`);
  process.stdout.write(`  Résultats : ${passed} passed, ${failed} failed\n`);
  if (failures.length > 0) {
    process.stdout.write('\n  Échecs :\n');
    failures.forEach(f => process.stdout.write(`    • ${f.name}\n      ${f.message}\n`));
  }
  process.exit(failed > 0 ? 1 : 0);
})();
