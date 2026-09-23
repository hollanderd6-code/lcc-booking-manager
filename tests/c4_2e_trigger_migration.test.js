#!/usr/bin/env node
'use strict';
/**
 * Tests unitaires — C4.2e Trigger Migration (P0-C2)
 *
 * Vérifie que triggerChannexRatesSync délègue entièrement à publishEffectivePricing
 * via la factory createTriggerSync.
 *
 * Couvre :
 *   T01 : publisher appelé une seule fois, propertyId/userId/reason corrects
 *   T02 : pool forwarded au publisher
 *   T03 : startDate = aujourd'hui (YYYY-MM-DD)
 *   T04 : endDate = startDate + 500 jours (exclusif)
 *   T05 : external_pricing skip → publisher appelé, pas de throw
 *   T06 : channex disabled   → publisher appelé, pas de throw
 *   T07 : property not found → publisher appelé, pas de throw
 *   T08 : IDs Channex manquants → publisher appelé, pas de throw
 *   T09 : publisher throw → capturé, loggué, pas de propagation
 *   T10 : statut ok → log inclut propertyId et 'ok'
 *   T11 : statut partial → trigger complète sans throw
 *   T12 : statut error   → trigger complète sans throw
 *   T13 : pushRates n'est jamais appelé directement par le trigger
 *   T14 : N appels indépendants → publisher appelé N fois, une fois par appel
 *
 * Exécution : node tests/c4_2e_trigger_migration.test.js
 * Aucun appel DB réel. Aucun appel Channex.
 */

const assert = require('assert');
const { createTriggerSync } = require('../routes/trigger-sync');
const { addDays } = require('../routes/effective-pricing-resolver');

// ─── Test runner ──────────────────────────────────────────────────────────────

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

// ─── Mock helpers ─────────────────────────────────────────────────────────────

const mockPool = { __mock: true };

function okResult(propertyId) {
  return {
    status: 'ok',
    propertyId,
    reason: 'trigger_sync',
    nights: 500,
    rates:        { count: 500, pushed: 500, error: null },
    restrictions: { count: 500, pushed: 500, error: null },
  };
}

function skipResult(status, propertyId) {
  return {
    status,
    propertyId,
    reason: 'trigger_sync',
    nights: 0,
    rates:        { count: 0, pushed: 0, error: null },
    restrictions: { count: 0, pushed: 0, error: null },
  };
}

function makeSpy(returnValue) {
  const spy = { calls: 0, pool: null, opts: null };
  spy.fn = async (pool, opts) => {
    spy.calls++;
    spy.pool = pool;
    spy.opts = opts;
    if (returnValue === undefined) return okResult(opts.propertyId);
    return typeof returnValue === 'function' ? returnValue(opts) : returnValue;
  };
  return spy;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n─── C4.2e — Trigger Migration Tests ───\n');

  await test('T01 — publisher appelé une seule fois avec propertyId/userId/reason corrects', async () => {
    const spy = makeSpy(okResult('prop-abc'));
    const sync = createTriggerSync({ publishEffectivePricing: spy.fn });
    await sync(mockPool, 'prop-abc', 'user-123');
    assert.strictEqual(spy.calls, 1,           'publisher appelé exactement une fois');
    assert.strictEqual(spy.opts.propertyId, 'prop-abc',      'propertyId transmis');
    assert.strictEqual(spy.opts.userId,     'user-123',      'userId transmis');
    assert.strictEqual(spy.opts.reason,     'trigger_sync',  'reason = trigger_sync');
  });

  await test('T02 — pool forwarded au publisher', async () => {
    const sentinelPool = { __sentinel: 'test-pool-42' };
    const spy = makeSpy();
    const sync = createTriggerSync({ publishEffectivePricing: spy.fn });
    await sync(sentinelPool, 'p', 'u');
    assert.strictEqual(spy.pool, sentinelPool, 'pool exact transmis au publisher');
  });

  await test("T03 — startDate = aujourd'hui (YYYY-MM-DD)", async () => {
    const today = new Date().toISOString().split('T')[0];
    const spy = makeSpy();
    const sync = createTriggerSync({ publishEffectivePricing: spy.fn });
    await sync(mockPool, 'p', 'u');
    assert.strictEqual(spy.opts.startDate, today, `startDate doit être ${today}`);
  });

  await test('T04 — endDate = startDate + 500 jours (exclusif)', async () => {
    const today       = new Date().toISOString().split('T')[0];
    const expectedEnd = addDays(today, 500);
    const spy = makeSpy();
    const sync = createTriggerSync({ publishEffectivePricing: spy.fn });
    await sync(mockPool, 'p', 'u');
    assert.strictEqual(spy.opts.endDate, expectedEnd, `endDate doit être ${expectedEnd}`);
  });

  await test('T05 — external_pricing skip → publisher appelé, trigger ne throw pas', async () => {
    const spy = makeSpy(skipResult('skipped_external_pricing', 'p'));
    const sync = createTriggerSync({ publishEffectivePricing: spy.fn });
    await assert.doesNotReject(() => sync(mockPool, 'p', 'u'));
    assert.strictEqual(spy.calls, 1, 'publisher appelé même pour external_pricing');
  });

  await test('T06 — channex disabled → publisher appelé, pas de throw', async () => {
    const spy = makeSpy(skipResult('skipped_channex_disabled', 'p'));
    const sync = createTriggerSync({ publishEffectivePricing: spy.fn });
    await assert.doesNotReject(() => sync(mockPool, 'p', 'u'));
    assert.strictEqual(spy.calls, 1);
  });

  await test('T07 — property not found → publisher appelé, pas de throw', async () => {
    const spy = makeSpy(skipResult('skipped_property_not_found', 'p'));
    const sync = createTriggerSync({ publishEffectivePricing: spy.fn });
    await assert.doesNotReject(() => sync(mockPool, 'p', 'u'));
    assert.strictEqual(spy.calls, 1);
  });

  await test('T08 — IDs Channex manquants → publisher appelé, pas de throw', async () => {
    const spy = makeSpy(skipResult('skipped_missing_channex_ids', 'p'));
    const sync = createTriggerSync({ publishEffectivePricing: spy.fn });
    await assert.doesNotReject(() => sync(mockPool, 'p', 'u'));
    assert.strictEqual(spy.calls, 1);
  });

  await test('T09 — publisher throw → capturé, loggué, pas de propagation', async () => {
    const errSpy = { calls: 0, lastMsg: '' };
    const origErr = console.error;
    console.error = (...args) => { errSpy.calls++; errSpy.lastMsg = args.join(' '); };

    const throwingPublish = async () => { throw new Error('DB connection lost'); };
    const sync = createTriggerSync({ publishEffectivePricing: throwingPublish });

    await assert.doesNotReject(() => sync(mockPool, 'p', 'u'));
    assert.ok(errSpy.calls > 0,                             'erreur doit être loggée');
    assert.ok(errSpy.lastMsg.includes('DB connection lost'), 'message d\'erreur présent dans le log');

    console.error = origErr;
  });

  await test("T10 — statut ok → log inclut propertyId et 'ok'", async () => {
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    const spy = makeSpy(okResult('prop-xyz'));
    const sync = createTriggerSync({ publishEffectivePricing: spy.fn });
    await sync(mockPool, 'prop-xyz', 'u');

    console.log = origLog;
    const found = logs.some(l => l.includes('prop-xyz') && l.includes('ok'));
    assert.ok(found, 'log attendu avec propertyId et statut ok');
  });

  await test('T11 — statut partial → trigger complète sans throw', async () => {
    const partialResult = {
      status: 'partial', propertyId: 'p', reason: 'trigger_sync',
      nights: 500,
      rates:        { count: 500, pushed: 500, error: null },
      restrictions: { count: 500, pushed:   0, error: 'Channex timeout' },
    };
    const sync = createTriggerSync({ publishEffectivePricing: makeSpy(partialResult).fn });
    await assert.doesNotReject(() => sync(mockPool, 'p', 'u'));
  });

  await test('T12 — statut error → trigger complète sans throw', async () => {
    const errResult = {
      status: 'error', propertyId: 'p', reason: 'trigger_sync',
      nights: 500,
      rates:        { count: 500, pushed: 0, error: 'Network error' },
      restrictions: { count: 500, pushed: 0, error: 'Network error' },
    };
    const sync = createTriggerSync({ publishEffectivePricing: makeSpy(errResult).fn });
    await assert.doesNotReject(() => sync(mockPool, 'p', 'u'));
  });

  await test("T13 — pushRates n'est jamais appelé directement par le trigger", async () => {
    const pushRatesSpy = { calls: 0 };
    const publishSpy   = makeSpy(okResult('p'));
    const sync = createTriggerSync({
      publishEffectivePricing: publishSpy.fn,
      pushRates: async () => { pushRatesSpy.calls++; },
    });
    await sync(mockPool, 'p', 'u');
    assert.strictEqual(pushRatesSpy.calls, 0, 'pushRates ne doit jamais être appelé par le trigger');
    assert.strictEqual(publishSpy.calls,   1, 'seul publishEffectivePricing est appelé');
  });

  await test('T14 — N appels indépendants → publisher appelé N fois', async () => {
    const spy = makeSpy();
    const sync = createTriggerSync({ publishEffectivePricing: spy.fn });

    await sync(mockPool, 'prop-1', 'user-A');
    await sync(mockPool, 'prop-2', 'user-B');
    await sync(mockPool, 'prop-3', 'user-C');

    assert.strictEqual(spy.calls, 3, '3 appels → publisher appelé 3 fois');
    assert.strictEqual(spy.opts.propertyId, 'prop-3', 'dernier appel = prop-3');
    assert.strictEqual(spy.opts.userId,     'user-C', 'dernier userId = user-C');
  });

  // ─── C4.8-B — stopSellMode contract ─────────────────────────────────────────

  console.log('\n── C4.8-B — stopSellMode contract (T15–T23) ──');

  await test('T15 (B-T01) — default (no options) → stopSellMode:none transmis au publisher', async () => {
    const spy = makeSpy();
    const sync = createTriggerSync({ publishEffectivePricing: spy.fn });
    await sync(mockPool, 'p', 'u');
    assert.strictEqual(spy.opts.stopSellMode, 'none', 'default doit être none');
  });

  await test('T16 (B-T02) — options.stopSellMode:none → none propagé', async () => {
    const spy = makeSpy();
    const sync = createTriggerSync({ publishEffectivePricing: spy.fn });
    await sync(mockPool, 'p', 'u', { stopSellMode: 'none' });
    assert.strictEqual(spy.opts.stopSellMode, 'none');
  });

  await test('T17 (B-T03) — options.stopSellMode:authoritative → authoritative propagé', async () => {
    const spy = makeSpy();
    const sync = createTriggerSync({ publishEffectivePricing: spy.fn });
    await sync(mockPool, 'p', 'u', { stopSellMode: 'authoritative' });
    assert.strictEqual(spy.opts.stopSellMode, 'authoritative');
  });

  await test('T18 (B-T04) — options.stopSellMode invalide → fail-safe none', async () => {
    const spy = makeSpy();
    const sync = createTriggerSync({ publishEffectivePricing: spy.fn });
    await sync(mockPool, 'p', 'u', { stopSellMode: 'true_only' });
    assert.strictEqual(spy.opts.stopSellMode, 'none', 'valeur non autorisée doit tomber sur none');
  });

  await test('T19 (B-T04b) — options={} (objet vide) → fail-safe none', async () => {
    const spy = makeSpy();
    const sync = createTriggerSync({ publishEffectivePricing: spy.fn });
    await sync(mockPool, 'p', 'u', {});
    assert.strictEqual(spy.opts.stopSellMode, 'none');
  });

  await test('T20 (B-T05) — stopSellMode:none → rates publiées (publisher appelé)', async () => {
    const spy = makeSpy(okResult('p'));
    const sync = createTriggerSync({ publishEffectivePricing: spy.fn });
    await sync(mockPool, 'p', 'u', { stopSellMode: 'none' });
    assert.strictEqual(spy.calls, 1, 'publisher doit être appelé même avec none');
    assert.ok(spy.opts.startDate, 'startDate transmis');
    assert.ok(spy.opts.endDate,   'endDate transmis');
  });

  await test('T21 (B-T06) — stopSellMode:none → min_stay encore transmis (publisher appelé)', async () => {
    const spy = makeSpy();
    const sync = createTriggerSync({ publishEffectivePricing: spy.fn });
    await sync(mockPool, 'p', 'u', { stopSellMode: 'none' });
    // publisher reçoit none — le resolver calculera min_stay indépendamment de stop_sell
    assert.strictEqual(spy.opts.stopSellMode, 'none');
    assert.strictEqual(spy.calls, 1);
  });

  await test('T22 (B-T07) — stopSellMode:none → publisher reçoit none (champ stop_sell absent côté publisher)', async () => {
    const spy = makeSpy();
    const sync = createTriggerSync({ publishEffectivePricing: spy.fn });
    await sync(mockPool, 'p', 'u', { stopSellMode: 'none' });
    assert.strictEqual(spy.opts.stopSellMode, 'none',
      'publisher doit recevoir none pour que stop_sell soit absent des restrictions');
  });

  await test('T23 (B-T08) — stopSellMode:authoritative → publisher reçoit authoritative', async () => {
    const spy = makeSpy();
    const sync = createTriggerSync({ publishEffectivePricing: spy.fn });
    await sync(mockPool, 'p', 'u', { stopSellMode: 'authoritative' });
    assert.strictEqual(spy.opts.stopSellMode, 'authoritative',
      'publisher doit recevoir authoritative pour envoyer true/false');
  });

  // ─── Summary ────────────────────────────────────────────────────────────────

  console.log(`\n${'─'.repeat(55)}`);
  console.log(`  Résultats : ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\n  Échecs :');
    failures.forEach(f => console.log(`    • ${f.name}\n      ${f.message}`));
  }
  process.exit(failed > 0 ? 1 : 0);
})();
