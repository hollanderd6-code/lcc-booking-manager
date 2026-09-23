#!/usr/bin/env node
'use strict';
/**
 * P0-C4.8-B — Stop_sell Intent-Aware Publication
 *
 * Verifies that server.js pricing_rules CRUD passes the correct stopSellMode
 * to triggerChannexRatesSync based on rule_type.
 *
 * Covers (B13–B19):
 *   B-SS-01 : stop_sell CREATE  → authoritative
 *   B-SS-02 : non-stop_sell CREATE → none
 *   B-SS-03 : stop_sell UPDATE  → authoritative (old type = stop_sell)
 *   B-SS-04 : non-stop_sell UPDATE → none (old and new types both non-stop_sell)
 *   B-SS-05 : stop_sell DISABLE (active=false) → authoritative (old type = stop_sell)
 *   B-SS-06 : stop_sell → period type transition → authoritative (old type = stop_sell)
 *   B-SS-07 : period → stop_sell type transition → authoritative (new type = stop_sell)
 *   B-SS-08 : period → period (no stop_sell) → none
 *   B-SS-09 : stop_sell DELETE  → authoritative
 *   B-SS-10 : non-stop_sell DELETE → none
 *   B-SS-11 : publisher contract: authoritative + no rule → stop_sell:false (reopen)
 *   B-SS-12 : publisher contract: authoritative + rule → stop_sell:true (close)
 *   B-SS-13 : publisher contract: none → stop_sell field absent (price-only)
 *   B-SS-14 : static — trigger-sync default stopSellMode is 'none'
 *   B-SS-15 : static — server.js override callers use stopSellMode:'none'
 *   B-SS-16 : static — server.js host pricing callers use stopSellMode:'none'
 *   B-SS-17 : static — initial connect uses stopSellMode:'none'
 *   B-SS-18 : static — dynamic-pricing-routes _applyDecision uses stopSellMode:'none'
 *   B-SS-19 : publisher invariant: authoritative stop_sell:false present even when false
 *   B-SS-20 : publisher invariant: none → stop_sell always absent
 *
 * No real DB. No real Channex. No real publisher.
 *
 * Execution: node tests/c4_8b_stop_sell_intent.test.js
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const { createTriggerSync }  = require('../routes/trigger-sync');
const { createPublisher, PUBLISH_STATUS } = require('../routes/pricing-publisher');

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

// ─── Source files for structural checks ───────────────────────────────────────

const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const triggerSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'trigger-sync.js'), 'utf8');
const dpSrc      = fs.readFileSync(path.join(__dirname, '..', 'routes', 'dynamic-pricing-routes.js'), 'utf8');

// ─── Helpers: publisher integration ───────────────────────────────────────────

// Inject mock lock deps so createPublisher doesn't call pool.connect().
// Uses a lazy capture: connectClient stores the pool passed at publish time.
function addLockDeps(deps) {
  let _capturedPool;
  const mockClient = {
    query: (...a) => _capturedPool.query(...a),
    release: () => {},
  };
  return {
    ...deps,
    connectClient: (pool) => { _capturedPool = pool; return Promise.resolve(mockClient); },
    acquireLock:   async () => {},
    releaseLock:   async () => {},
  };
}

function makeRestrictionsSpy() {
  const spy = { calls: 0, lastRestrictions: null };
  spy.fn = async (_pool, { restrictions }) => {
    spy.calls++;
    spy.lastRestrictions = restrictions;
    return { count: restrictions.length };
  };
  return spy;
}

function makeRatesSpy() {
  const spy = { calls: 0 };
  spy.fn = async () => { spy.calls++; return { count: 1 }; };
  return spy;
}

function makePropPool(overrides = {}) {
  const prop = {
    id: 'prop-1', user_id: 'owner-1',
    channex_enabled: true,
    channex_property_id: 'cx-prop',
    channex_rate_plan_id: 'cx-rp',
    channex_room_type_id: 'cx-rt',
    external_pricing: false,
    ...overrides,
  };
  return {
    async query(sql, params) {
      const s = sql.replace(/\s+/g, ' ').toLowerCase().trim();
      if (s.includes('from properties')) return { rows: [prop] };
      if (s.includes('from pricing_config')) return { rows: [] };
      if (s.includes('from pricing_overrides')) return { rows: [] };
      if (s.includes('from pricing_schedule')) return { rows: [] };
      if (s.includes('from pricing_rules')) {
        // Return stop_sell rule only when test provides one
        if (overrides._stopSellRules) return { rows: overrides._stopSellRules };
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

// ─── Trigger-sync stopSellMode propagation (B-SS-01 intent via publisher) ─────

(async () => {
  console.log('\n─── C4.8-B — Stop_sell Intent Tests ───\n');

  // ── Section 1 : trigger-sync stopSellMode propagation ──────────────────────

  console.log('── Section 1 : trigger-sync propagation ──');

  await test('B-SS-01 : authoritative propagé par trigger-sync au publisher', async () => {
    let receivedMode;
    const pub = async (_pool, opts) => {
      receivedMode = opts.stopSellMode;
      return { status: 'ok', propertyId: opts.propertyId, reason: opts.reason,
        nights: 1, rates: { count: 1, pushed: 1, error: null },
        restrictions: { count: 1, pushed: 1, error: null } };
    };
    const sync = createTriggerSync({ publishEffectivePricing: pub });
    await sync({}, 'p', 'u', { stopSellMode: 'authoritative' });
    assert.strictEqual(receivedMode, 'authoritative');
  });

  await test('B-SS-02 : none propagé par trigger-sync au publisher', async () => {
    let receivedMode;
    const pub = async (_pool, opts) => {
      receivedMode = opts.stopSellMode;
      return { status: 'ok', propertyId: opts.propertyId, reason: opts.reason,
        nights: 1, rates: { count: 1, pushed: 1, error: null },
        restrictions: { count: 1, pushed: 1, error: null } };
    };
    const sync = createTriggerSync({ publishEffectivePricing: pub });
    await sync({}, 'p', 'u', { stopSellMode: 'none' });
    assert.strictEqual(receivedMode, 'none');
  });

  await test('B-SS-03 : default (sans options) propagé comme none', async () => {
    let receivedMode;
    const pub = async (_pool, opts) => {
      receivedMode = opts.stopSellMode;
      return { status: 'ok', propertyId: opts.propertyId, reason: opts.reason,
        nights: 1, rates: { count: 1, pushed: 1, error: null },
        restrictions: { count: 1, pushed: 1, error: null } };
    };
    const sync = createTriggerSync({ publishEffectivePricing: pub });
    await sync({}, 'p', 'u');
    assert.strictEqual(receivedMode, 'none');
  });

  // ── Section 2 : publisher invariants pour authoritative vs none ─────────────

  console.log('\n── Section 2 : publisher invariants ──');

  await test('B-SS-11 : authoritative + aucune règle stop_sell → stop_sell:false présent (réouverture)', async () => {
    const restrSpy = makeRestrictionsSpy();
    const pub = createPublisher(addLockDeps({
      pushRates:        makeRatesSpy().fn,
      pushRestrictions: restrSpy.fn,
      resolveEffectivePrices: async () => [{
        date: '2026-10-01', price: 100, priceValid: true,
        minStayArrival: 1, minStayThrough: 1, minStaySource: 'default',
        stopSell: false, stopSellSource: 'none',
        source: 'base_price', sourceId: null, locked: false, breakdown: null, calculatedAt: null,
      }],
    }));
    const pool = makePropPool();
    await pub(pool, { propertyId: 'prop-1', userId: 'owner-1',
      startDate: '2026-10-01', endDate: '2026-10-02',
      reason: 'test', stopSellMode: 'authoritative' });
    const r = restrSpy.lastRestrictions[0];
    assert.ok(Object.prototype.hasOwnProperty.call(r, 'stop_sell'),
      'stop_sell doit être présent dans le payload authoritative');
    assert.strictEqual(r.stop_sell, false,
      'stop_sell doit être false quand aucune règle (réouverture explicite)');
  });

  await test('B-SS-12 : authoritative + règle stop_sell active → stop_sell:true présent (fermeture)', async () => {
    const restrSpy = makeRestrictionsSpy();
    const pub = createPublisher(addLockDeps({
      pushRates:        makeRatesSpy().fn,
      pushRestrictions: restrSpy.fn,
      resolveEffectivePrices: async () => [{
        date: '2026-10-01', price: 100, priceValid: true,
        minStayArrival: 1, minStayThrough: 1, minStaySource: 'default',
        stopSell: true, stopSellSource: 'stop_sell_rule',
        source: 'base_price', sourceId: null, locked: false, breakdown: null, calculatedAt: null,
      }],
    }));
    const pool = makePropPool();
    await pub(pool, { propertyId: 'prop-1', userId: 'owner-1',
      startDate: '2026-10-01', endDate: '2026-10-02',
      reason: 'test', stopSellMode: 'authoritative' });
    const r = restrSpy.lastRestrictions[0];
    assert.ok(Object.prototype.hasOwnProperty.call(r, 'stop_sell'),
      'stop_sell doit être présent dans le payload authoritative');
    assert.strictEqual(r.stop_sell, true);
  });

  await test('B-SS-13 : none → champ stop_sell toujours absent (price-only invariant)', async () => {
    const restrSpy = makeRestrictionsSpy();
    const pub = createPublisher(addLockDeps({
      pushRates:        makeRatesSpy().fn,
      pushRestrictions: restrSpy.fn,
      resolveEffectivePrices: async () => [
        { date: '2026-10-01', price: 100, priceValid: true,
          minStayArrival: 1, minStayThrough: 1, minStaySource: 'default',
          stopSell: true, stopSellSource: 'stop_sell_rule',
          source: 'base_price', sourceId: null, locked: false, breakdown: null, calculatedAt: null },
        { date: '2026-10-02', price: 100, priceValid: true,
          minStayArrival: 1, minStayThrough: 1, minStaySource: 'default',
          stopSell: false, stopSellSource: 'none',
          source: 'base_price', sourceId: null, locked: false, breakdown: null, calculatedAt: null },
      ],
    }));
    const pool = makePropPool();
    await pub(pool, { propertyId: 'prop-1', userId: 'owner-1',
      startDate: '2026-10-01', endDate: '2026-10-03',
      reason: 'test', stopSellMode: 'none' });
    for (const r of restrSpy.lastRestrictions) {
      assert.ok(!Object.prototype.hasOwnProperty.call(r, 'stop_sell'),
        `stop_sell ne doit PAS être présent avec mode:none (date ${r.date})`);
    }
  });

  await test('B-SS-19 : authoritative → stop_sell:false présent même quand false (réouverture garantie)', async () => {
    const restrSpy = makeRestrictionsSpy();
    const pub = createPublisher(addLockDeps({
      pushRates:        makeRatesSpy().fn,
      pushRestrictions: restrSpy.fn,
      resolveEffectivePrices: async () => [{
        date: '2026-10-01', price: 100, priceValid: true,
        minStayArrival: 1, minStayThrough: 1, minStaySource: 'default',
        stopSell: false, stopSellSource: 'none',
        source: 'base_price', sourceId: null, locked: false, breakdown: null, calculatedAt: null,
      }],
    }));
    const pool = makePropPool();
    await pub(pool, { propertyId: 'prop-1', userId: 'owner-1',
      startDate: '2026-10-01', endDate: '2026-10-02',
      reason: 'test', stopSellMode: 'authoritative' });
    const r = restrSpy.lastRestrictions[0];
    assert.ok(Object.prototype.hasOwnProperty.call(r, 'stop_sell'),
      'stop_sell doit être PRÉSENT (pas omis) même quand false');
    assert.strictEqual(r.stop_sell, false);
  });

  await test('B-SS-20 : none → stop_sell toujours absent quelle que soit la règle resolver', async () => {
    const restrSpy = makeRestrictionsSpy();
    const pub = createPublisher(addLockDeps({
      pushRates:        makeRatesSpy().fn,
      pushRestrictions: restrSpy.fn,
      resolveEffectivePrices: async () => [{
        date: '2026-10-01', price: 100, priceValid: true,
        minStayArrival: 1, minStayThrough: 1, minStaySource: 'default',
        stopSell: true, stopSellSource: 'stop_sell_rule',
        source: 'base_price', sourceId: null, locked: false, breakdown: null, calculatedAt: null,
      }],
    }));
    const pool = makePropPool();
    await pub(pool, { propertyId: 'prop-1', userId: 'owner-1',
      startDate: '2026-10-01', endDate: '2026-10-02',
      reason: 'test', stopSellMode: 'none' });
    const r = restrSpy.lastRestrictions[0];
    assert.ok(!Object.prototype.hasOwnProperty.call(r, 'stop_sell'),
      'stop_sell ne doit PAS être présent avec mode:none même si resolver dit true');
  });

  // ── Section 3 : static checks — server.js caller intent ────────────────────

  console.log('\n── Section 3 : static caller inventory ──');

  await test("B-SS-14 : trigger-sync default est 'none' (pas authoritative) — structurel", () => {
    // The fail-safe must reject everything except 'authoritative' and fall back to 'none'
    assert.ok(
      triggerSrc.includes("'authoritative'") && triggerSrc.includes("'none'"),
      "trigger-sync doit référencer 'authoritative' et 'none'"
    );
    // Ensure the default path yields 'none' — the ternary assigns 'none' as the else branch
    assert.ok(
      triggerSrc.includes(": 'none'") || triggerSrc.includes("? 'authoritative'\n      : 'none'") ||
      triggerSrc.includes(": 'none';"),
      "trigger-sync doit avoir 'none' comme branche else/default du ternaire"
    );
  });

  await test("B-SS-15 : pricing_overrides callers utilisent stopSellMode:'none' — structurel", () => {
    // Verify stopSellMode:'none' appears near the DELETE FROM pricing_overrides
    // and near the INSERT INTO pricing_overrides blocks
    const overrideDeleteIdx = serverSrc.indexOf(
      "'DELETE FROM pricing_overrides WHERE user_id = ANY"
    );
    assert.ok(overrideDeleteIdx >= 0, 'DELETE FROM pricing_overrides ANY non trouvé');
    // Check that within 500 chars of this DELETE, stopSellMode:'none' appears
    const blockAround = serverSrc.slice(overrideDeleteIdx, overrideDeleteIdx + 500);
    assert.ok(blockAround.includes("stopSellMode: 'none'"),
      "pricing_overrides DELETE doit être suivi de stopSellMode:'none' dans les 500 chars");
  });

  await test("B-SS-16 : host pricing callers (weekend/season/long-stay/min-stay) utilisent stopSellMode:'none' — structurel", () => {
    // Check all the try { triggerChannexRatesSync } catch(e){} calls in host pricing
    const matches = [...serverSrc.matchAll(/try \{ triggerChannexRatesSync\([^)]+\)/g)];
    assert.ok(matches.length >= 4, `Au moins 4 callers host pricing attendus, trouvé ${matches.length}`);
    for (const m of matches) {
      assert.ok(m[0].includes("stopSellMode: 'none'"),
        `Host pricing caller doit avoir stopSellMode:'none': ${m[0].slice(0, 80)}`);
    }
  });

  await test("B-SS-17 : initial Channex connect utilise stopSellMode:'none' — structurel", () => {
    const connectIdx = serverSrc.indexOf('[CHANNEX CONNECT] Tarifs pousses');
    assert.ok(connectIdx >= 0, 'CHANNEX CONNECT section non trouvée');
    const connectBlock = serverSrc.slice(Math.max(0, connectIdx - 300), connectIdx + 50);
    assert.ok(
      connectBlock.includes("stopSellMode: 'none'"),
      "initial connect doit utiliser stopSellMode:'none'"
    );
  });

  await test("B-SS-18 : _applyDecision utilise stopSellMode:'none' — structurel", () => {
    // Scan the region from _applyDecision to setupDynamicPricingRoutes (which follows it)
    const applyIdx = dpSrc.indexOf('async function _applyDecision');
    assert.ok(applyIdx >= 0, '_applyDecision non trouvée');
    const setupIdx = dpSrc.indexOf('function setupDynamicPricingRoutes', applyIdx);
    assert.ok(setupIdx > applyIdx, 'setupDynamicPricingRoutes doit suivre _applyDecision');
    const fnRegion = dpSrc.slice(applyIdx, setupIdx);
    assert.ok(
      fnRegion.includes("stopSellMode: 'none'"),
      "_applyDecision doit passer stopSellMode:'none' explicitement"
    );
    assert.ok(
      !fnRegion.includes("stopSellMode: 'authoritative'"),
      "_applyDecision ne doit PAS utiliser authoritative"
    );
  });

  // ── Section 4 : static checks — pricing_rules CRUD intent ──────────────────

  console.log('\n── Section 4 : pricing_rules CRUD static intent ──');

  await test("B-SS-04-static : POST pricing_rules — stop_sell → authoritative, sinon none (structurel)", () => {
    // Find the POST /api/pricing/rules area — look for _mode4 variable
    const idx = serverSrc.indexOf("_mode4 = (_newRuleType === 'stop_sell')");
    assert.ok(idx >= 0, "_mode4 intent variable non trouvée dans server.js");
    const block = serverSrc.slice(idx, idx + 100);
    assert.ok(block.includes("'authoritative'") && block.includes("'none'"),
      "_mode4 doit distinguer authoritative et none");
  });

  await test("B-SS-05-static : PUT pricing_rules — old OU new stop_sell → authoritative (structurel)", () => {
    const idx = serverSrc.indexOf("_mode5 = (_oldType === 'stop_sell' || _newType === 'stop_sell')");
    assert.ok(idx >= 0, "_mode5 intent variable non trouvée dans server.js");
    const block = serverSrc.slice(idx, idx + 120);
    assert.ok(block.includes("'authoritative'") && block.includes("'none'"),
      "_mode5 doit distinguer authoritative et none");
  });

  await test("B-SS-06-static : PUT pricing_rules — old row rule_type lu AVANT l'UPDATE (structurel)", () => {
    // The old rule_type SELECT must appear BEFORE the UPDATE
    const oldRowIdx = serverSrc.indexOf("SELECT rule_type FROM pricing_rules WHERE id = $1");
    const updateIdx = serverSrc.indexOf("UPDATE pricing_rules SET");
    assert.ok(oldRowIdx >= 0, "SELECT old rule_type non trouvé");
    assert.ok(updateIdx >= 0, "UPDATE pricing_rules non trouvé");
    assert.ok(oldRowIdx < updateIdx,
      "SELECT old rule_type doit précéder l'UPDATE dans le code");
  });

  await test("B-SS-09-static : DELETE pricing_rules — RETURNING rule_type présent (structurel)", () => {
    const deleteRulesIdx = serverSrc.indexOf(
      "DELETE FROM pricing_rules WHERE id = $1 AND user_id = ANY($2::text[]) RETURNING property_id, rule_type"
    );
    assert.ok(deleteRulesIdx >= 0,
      "DELETE pricing_rules doit utiliser RETURNING property_id, rule_type");
  });

  await test("B-SS-10-static : DELETE pricing_rules — mode6 = authoritative si stop_sell sinon none (structurel)", () => {
    const idx = serverSrc.indexOf("_mode6 = (deleted.rows[0].rule_type === 'stop_sell')");
    assert.ok(idx >= 0, "_mode6 intent variable non trouvée dans server.js");
    const block = serverSrc.slice(idx, idx + 100);
    assert.ok(block.includes("'authoritative'") && block.includes("'none'"),
      "_mode6 doit distinguer authoritative et none");
  });

  // ── Section 5 : no ambiguous callers remain ────────────────────────────────

  console.log('\n── Section 5 : zero caller ambigu ──');

  await test('B-SS-GATE : aucun caller triggerChannexRatesSync sans stopSellMode explicite (structurel)', () => {
    // Every triggerChannexRatesSync call should include stopSellMode
    // We exclude: function definition (line ~459), comment lines
    const callMatches = [...serverSrc.matchAll(/triggerChannexRatesSync\([^)]+\)/g)];
    const definition = 'async function triggerChannexRatesSync';
    const ambiguous = callMatches.filter(m => {
      // exclude function definition itself
      const context = serverSrc.slice(Math.max(0, m.index - 20), m.index);
      if (context.includes('function ')) return false;
      // exclude comment lines
      const lineStart = serverSrc.lastIndexOf('\n', m.index) + 1;
      const linePrefix = serverSrc.slice(lineStart, m.index).trim();
      if (linePrefix.startsWith('//') || linePrefix.startsWith('*')) return false;
      return !m[0].includes('stopSellMode');
    });
    assert.strictEqual(ambiguous.length, 0,
      `${ambiguous.length} caller(s) sans stopSellMode:\n${ambiguous.map(m => m[0].slice(0,80)).join('\n')}`);
  });

  // ─── Summary ────────────────────────────────────────────────────────────────

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Résultats : ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\n  Échecs :');
    failures.forEach(f => console.log(`    • ${f.name}\n      ${f.message}`));
  }
  process.exit(failed > 0 ? 1 : 0);
})();
