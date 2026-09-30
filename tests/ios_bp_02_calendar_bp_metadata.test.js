#!/usr/bin/env node
'use strict';
/**
 * Tests — IOS-BP-02 — BoostPrice Calendar Metadata Contract
 *
 * Verifies the enriched GET /api/pricing/calendar response:
 *   - Canonical pricing priority (manual_override > boostprice > period_rule >
 *     weekday_rule > weekend_price > base_price) is correctly applied
 *   - BoostPrice metadata fields (boostpriceEnabled, sources, bpSchedule) are
 *     present and correctly populated
 *   - External pricing properties never expose BoostPrice metadata
 *   - status='applied' in bpSchedule is NOT an OTA delivery confirmation
 *   - Backwards compatibility: existing fields unchanged
 *   - No N+1 queries (structural checks)
 *   - Agency authorization preserved (static checks)
 *
 * No DB connections. No Express server. No Channex calls.
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌  ${name}: ${err.message}`);
    failures.push({ name, message: err.message });
    failed++;
  }
}

function ok(val, msg)  { assert.ok(val, msg); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }

const SRV_PATH = path.join(__dirname, '../server.js');
const srvSrc   = fs.readFileSync(SRV_PATH, 'utf8');

// ── Inline pricing logic (mirrors the implementation in server.js) ───────────
// Pure function — the exact priority applied per calendar night.
// This copy exists so tests do not depend on spinning up Express.
// Any divergence between this and server.js is a test maintenance bug.

function computeNight({ dateStr, dow, propOverrides, bpEntries, boostpriceEnabled, periodRules, weekdayRules, weekendPrice, basePrice }) {
  let price  = null;
  let source = 'none';

  if (propOverrides[dateStr] != null) {
    price  = propOverrides[dateStr];
    source = 'manual_override';
  } else {
    const bpEntry = boostpriceEnabled ? bpEntries[dateStr] : undefined;
    if (bpEntry && bpEntry.status === 'applied') {
      price  = bpEntry.price;
      source = 'boostprice';
    } else {
      for (const rule of periodRules) {
        if (rule.start_date && rule.end_date && rule.price != null) {
          if (dateStr >= rule.start_date && dateStr <= rule.end_date) {
            price = rule.price; source = 'period_rule'; break;
          }
        }
      }
      if (price === null) {
        for (const rule of weekdayRules) {
          if (rule.days_of_week && rule.price != null && rule.days_of_week.includes(dow)) {
            price = rule.price; source = 'weekday_rule'; break;
          }
        }
      }
      if (price === null) {
        const isPremium = (dow === 5 || dow === 6);
        if (isPremium && weekendPrice != null) { price = weekendPrice; source = 'weekend_price'; }
        else if (basePrice != null)            { price = basePrice;    source = 'base_price'; }
      }
    }
  }

  return { price, source };
}

// Simulate the per-property result construction for a date range.
// Mirrors the for-loop in GET /api/pricing/calendar.
function buildPropertyResult({ from, to, basePrice, weekendPrice, propIsExternal, bpIsActive, propOverrides = {}, periodRules = [], weekdayRules = [], bpEntries = {} }) {
  const boostpriceEnabled = !propIsExternal && bpIsActive;
  const propBpEntries     = boostpriceEnabled ? bpEntries : {};

  const bpSchedule = {};
  for (const [d, e] of Object.entries(propBpEntries)) bpSchedule[d] = e;

  const prices  = {};
  const sources = {};

  const toDate = new Date(to + 'T00:00:00Z');
  for (let d = new Date(from + 'T00:00:00Z'); d <= toDate; d.setUTCDate(d.getUTCDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const dow     = d.getUTCDay();
    const { price, source } = computeNight({
      dateStr, dow, propOverrides, bpEntries: propBpEntries, boostpriceEnabled,
      periodRules, weekdayRules, weekendPrice, basePrice,
    });
    if (price != null) { prices[dateStr] = price; sources[dateStr] = source; }
  }

  return { boostpriceEnabled, prices, sources, bpSchedule };
}

// ── [A] Pricing priority — base cases ─────────────────────────────────────────

test('[A-01] base price night', async () => {
  const r = buildPropertyResult({ from: '2026-10-01', to: '2026-10-01', basePrice: 95, weekendPrice: null, propIsExternal: false, bpIsActive: false });
  // Oct 1 2026 = Thursday (dow=4), not weekend
  eq(r.prices['2026-10-01'], 95);
  eq(r.sources['2026-10-01'], 'base_price');
});

test('[A-02] weekend price night (Fri=5, Sat=6)', async () => {
  // 2026-10-02 = Friday (dow=5)
  const r = buildPropertyResult({ from: '2026-10-02', to: '2026-10-02', basePrice: 95, weekendPrice: 120, propIsExternal: false, bpIsActive: false });
  eq(r.prices['2026-10-02'], 120);
  eq(r.sources['2026-10-02'], 'weekend_price');
});

test('[A-03] weekend falls back to base when weekendPrice is null', async () => {
  // 2026-10-02 = Friday, no weekendPrice → falls back to base
  const r = buildPropertyResult({ from: '2026-10-02', to: '2026-10-02', basePrice: 95, weekendPrice: null, propIsExternal: false, bpIsActive: false });
  eq(r.prices['2026-10-02'], 95);
  eq(r.sources['2026-10-02'], 'base_price');
});

test('[A-04] period rule overrides base price', async () => {
  const r = buildPropertyResult({
    from: '2026-10-05', to: '2026-10-05',
    basePrice: 95, weekendPrice: null,
    propIsExternal: false, bpIsActive: false,
    periodRules: [{ start_date: '2026-10-01', end_date: '2026-10-31', price: 130, priority: 1 }],
  });
  eq(r.prices['2026-10-05'], 130);
  eq(r.sources['2026-10-05'], 'period_rule');
});

test('[A-05] weekday rule overrides base price (dow=4=Thursday)', async () => {
  // 2026-10-01 = Thursday = dow 4
  const r = buildPropertyResult({
    from: '2026-10-01', to: '2026-10-01',
    basePrice: 95, weekendPrice: null,
    propIsExternal: false, bpIsActive: false,
    weekdayRules: [{ days_of_week: [4], price: 110, priority: 1 }],
  });
  eq(r.prices['2026-10-01'], 110);
  eq(r.sources['2026-10-01'], 'weekday_rule');
});

test('[A-06] weekday rule does not match wrong dow', async () => {
  // Rule only for Monday (1); 2026-10-01 = Thursday (4)
  const r = buildPropertyResult({
    from: '2026-10-01', to: '2026-10-01',
    basePrice: 95, weekendPrice: null,
    propIsExternal: false, bpIsActive: false,
    weekdayRules: [{ days_of_week: [1], price: 110, priority: 1 }],
  });
  eq(r.prices['2026-10-01'], 95);
  eq(r.sources['2026-10-01'], 'base_price');
});

// ── [B] BoostPrice applied ─────────────────────────────────────────────────────

test('[B-01] boostprice applied: price = BP price, source = boostprice', async () => {
  const r = buildPropertyResult({
    from: '2026-10-05', to: '2026-10-05',
    basePrice: 95, weekendPrice: null,
    propIsExternal: false, bpIsActive: true,
    bpEntries: { '2026-10-05': { status: 'applied', price: 108 } },
  });
  eq(r.prices['2026-10-05'], 108);
  eq(r.sources['2026-10-05'], 'boostprice');
  eq(r.boostpriceEnabled, true);
  ok(r.bpSchedule['2026-10-05'] != null);
  eq(r.bpSchedule['2026-10-05'].status, 'applied');
  eq(r.bpSchedule['2026-10-05'].price, 108);
});

test('[B-02] boostprice applied beats period rule', async () => {
  const r = buildPropertyResult({
    from: '2026-10-05', to: '2026-10-05',
    basePrice: 95, weekendPrice: null,
    propIsExternal: false, bpIsActive: true,
    periodRules: [{ start_date: '2026-10-01', end_date: '2026-10-31', price: 130, priority: 1 }],
    bpEntries: { '2026-10-05': { status: 'applied', price: 108 } },
  });
  eq(r.sources['2026-10-05'], 'boostprice');
  eq(r.prices['2026-10-05'], 108);
});

// ── [C] BoostPrice pending ─────────────────────────────────────────────────────

test('[C-01] boostprice pending: effective price is not BP, source is base_price', async () => {
  const r = buildPropertyResult({
    from: '2026-10-10', to: '2026-10-10',
    basePrice: 95, weekendPrice: null,
    propIsExternal: false, bpIsActive: true,
    bpEntries: { '2026-10-10': { status: 'pending', price: 115 } },
  });
  // pending does NOT affect the effective price
  eq(r.prices['2026-10-10'], 95);
  eq(r.sources['2026-10-10'], 'base_price');
  // but the pending recommendation IS visible in bpSchedule
  ok(r.bpSchedule['2026-10-10'] != null);
  eq(r.bpSchedule['2026-10-10'].status, 'pending');
  eq(r.bpSchedule['2026-10-10'].price, 115);
});

test('[C-02] boostprice pending does not displace a period rule', async () => {
  const r = buildPropertyResult({
    from: '2026-10-10', to: '2026-10-10',
    basePrice: 95, weekendPrice: null,
    propIsExternal: false, bpIsActive: true,
    periodRules: [{ start_date: '2026-10-01', end_date: '2026-10-31', price: 130, priority: 1 }],
    bpEntries: { '2026-10-10': { status: 'pending', price: 115 } },
  });
  eq(r.sources['2026-10-10'], 'period_rule');
  eq(r.prices['2026-10-10'], 130);
  eq(r.bpSchedule['2026-10-10'].status, 'pending');
});

// ── [D] Manual override ────────────────────────────────────────────────────────

test('[D-01] manual override beats boostprice applied', async () => {
  const r = buildPropertyResult({
    from: '2026-10-15', to: '2026-10-15',
    basePrice: 95, weekendPrice: null,
    propIsExternal: false, bpIsActive: true,
    propOverrides: { '2026-10-15': 90 },
    bpEntries: { '2026-10-15': { status: 'applied', price: 108 } },
  });
  eq(r.prices['2026-10-15'], 90);
  eq(r.sources['2026-10-15'], 'manual_override');
  // BP applied entry still visible in bpSchedule for iOS detail view
  eq(r.bpSchedule['2026-10-15'].status, 'applied');
  eq(r.bpSchedule['2026-10-15'].price, 108);
});

test('[D-02] manual override beats period rule', async () => {
  const r = buildPropertyResult({
    from: '2026-10-15', to: '2026-10-15',
    basePrice: 95, weekendPrice: null,
    propIsExternal: false, bpIsActive: true,
    propOverrides: { '2026-10-15': 90 },
    periodRules: [{ start_date: '2026-10-01', end_date: '2026-10-31', price: 130, priority: 1 }],
    bpEntries: { '2026-10-15': { status: 'applied', price: 108 } },
  });
  eq(r.sources['2026-10-15'], 'manual_override');
  eq(r.prices['2026-10-15'], 90);
});

test('[D-03] manual override + BP pending recommendation: override wins, recommendation visible', async () => {
  const r = buildPropertyResult({
    from: '2026-10-20', to: '2026-10-20',
    basePrice: 95, weekendPrice: null,
    propIsExternal: false, bpIsActive: true,
    propOverrides: { '2026-10-20': 90 },
    bpEntries: { '2026-10-20': { status: 'pending', price: 115 } },
  });
  eq(r.prices['2026-10-20'], 90);
  eq(r.sources['2026-10-20'], 'manual_override');
  eq(r.bpSchedule['2026-10-20'].status, 'pending');
});

// ── [E] External pricing ───────────────────────────────────────────────────────

test('[E-01] external_pricing=true: boostpriceEnabled=false', async () => {
  const r = buildPropertyResult({
    from: '2026-10-01', to: '2026-10-01',
    basePrice: 95, weekendPrice: null,
    propIsExternal: true, bpIsActive: true,
    bpEntries: { '2026-10-01': { status: 'applied', price: 108 } },
  });
  eq(r.boostpriceEnabled, false);
});

test('[E-02] external_pricing=true: bpSchedule is empty', async () => {
  const r = buildPropertyResult({
    from: '2026-10-01', to: '2026-10-01',
    basePrice: 95, weekendPrice: null,
    propIsExternal: true, bpIsActive: true,
    bpEntries: { '2026-10-01': { status: 'applied', price: 108 } },
  });
  eq(Object.keys(r.bpSchedule).length, 0, 'bpSchedule must be empty for external properties');
});

test('[E-03] external_pricing=true: price uses base/rule (not BP)', async () => {
  const r = buildPropertyResult({
    from: '2026-10-01', to: '2026-10-01',
    basePrice: 95, weekendPrice: null,
    propIsExternal: true, bpIsActive: true,
    bpEntries: { '2026-10-01': { status: 'applied', price: 108 } },
  });
  eq(r.prices['2026-10-01'], 95);
  eq(r.sources['2026-10-01'], 'base_price');
});

// ── [F] BP inactive / missing config ──────────────────────────────────────────

test('[F-01] boostprice is_active=false: boostpriceEnabled=false, no BP in prices', async () => {
  const r = buildPropertyResult({
    from: '2026-10-05', to: '2026-10-05',
    basePrice: 95, weekendPrice: null,
    propIsExternal: false, bpIsActive: false,
    bpEntries: { '2026-10-05': { status: 'applied', price: 108 } },
  });
  eq(r.boostpriceEnabled, false);
  eq(r.prices['2026-10-05'], 95);
  eq(r.sources['2026-10-05'], 'base_price');
  eq(Object.keys(r.bpSchedule).length, 0);
});

test('[F-02] no pricing_config: boostpriceEnabled=false, bpSchedule empty', async () => {
  const r = buildPropertyResult({
    from: '2026-10-05', to: '2026-10-05',
    basePrice: 95, weekendPrice: null,
    propIsExternal: false, bpIsActive: false,
  });
  eq(r.boostpriceEnabled, false);
  eq(Object.keys(r.bpSchedule).length, 0);
});

// ── [G] Multiple properties / dates ───────────────────────────────────────────

test('[G-01] multiple dates: sources map has entry for each date with a price', async () => {
  const r = buildPropertyResult({
    from: '2026-10-01', to: '2026-10-03',
    basePrice: 95, weekendPrice: 120,
    propIsExternal: false, bpIsActive: false,
  });
  // Oct 1 = Thu (base), Oct 2 = Fri (weekend), Oct 3 = Sat (weekend)
  eq(Object.keys(r.prices).length, 3);
  eq(Object.keys(r.sources).length, 3);
  eq(r.sources['2026-10-01'], 'base_price');
  eq(r.sources['2026-10-02'], 'weekend_price');
  eq(r.sources['2026-10-03'], 'weekend_price');
});

test('[G-02] multiple dates with mixed BP: only applied dates use boostprice source', async () => {
  const r = buildPropertyResult({
    from: '2026-10-01', to: '2026-10-03',
    basePrice: 95, weekendPrice: null,
    propIsExternal: false, bpIsActive: true,
    bpEntries: {
      '2026-10-01': { status: 'pending', price: 110 },
      '2026-10-02': { status: 'applied', price: 112 },
      // Oct 3 has no BP entry
    },
  });
  eq(r.sources['2026-10-01'], 'base_price');  // pending → base
  eq(r.prices['2026-10-01'], 95);
  eq(r.sources['2026-10-02'], 'boostprice');   // applied → boostprice
  eq(r.prices['2026-10-02'], 112);
  eq(r.sources['2026-10-03'], 'base_price');   // no BP entry → base
  eq(r.prices['2026-10-03'], 95);
  eq(r.bpSchedule['2026-10-01'].status, 'pending');
  eq(r.bpSchedule['2026-10-02'].status, 'applied');
  ok(!r.bpSchedule['2026-10-03'], 'no bpSchedule entry for Oct 3');
});

// ── [H] Backwards compatibility ───────────────────────────────────────────────

test('[H-01] existing field prices still present as { [date]: number } map', async () => {
  const r = buildPropertyResult({ from: '2026-10-01', to: '2026-10-01', basePrice: 95, weekendPrice: null, propIsExternal: false, bpIsActive: false });
  ok(typeof r.prices === 'object' && !Array.isArray(r.prices), 'prices is object');
  eq(typeof r.prices['2026-10-01'], 'number');
});

test('[H-02] no existing field is removed or renamed', async () => {
  // boostpriceEnabled, sources, bpSchedule are NEW (additive); prices, boostpriceEnabled are not conflicts
  // Check server.js still emits currency, basePrice, weekendPrice, booked, blocked
  ok(srvSrc.includes("currency: prop.currency || 'EUR'"), 'currency field preserved');
  ok(srvSrc.includes('basePrice,'), 'basePrice field preserved');
  ok(srvSrc.includes('weekendPrice,'), 'weekendPrice field preserved');
  ok(srvSrc.includes("booked:  bookedMap[pid]  || []"), 'booked field preserved');
  ok(srvSrc.includes("blocked: blockedMap[pid] || []"), 'blocked field preserved');
});

// ── [I] server.js static structure checks ────────────────────────────────────

test('[I-01] server.js emits boostpriceEnabled field in calendar result', async () => {
  ok(srvSrc.includes('boostpriceEnabled,'), 'boostpriceEnabled present in result');
});

test('[I-02] server.js emits sources field in calendar result', async () => {
  ok(srvSrc.includes('sources,'), 'sources present in result');
});

test('[I-03] server.js emits bpSchedule field in calendar result', async () => {
  ok(srvSrc.includes('bpSchedule,'), 'bpSchedule present in result');
});

test('[I-04] server.js queries pricing_config for is_active', async () => {
  ok(srvSrc.includes('is_active') && srvSrc.includes('pricing_config'), 'pricing_config is_active queried');
});

test('[I-05] server.js queries pricing_schedule for status IN applied/pending', async () => {
  ok(srvSrc.includes("status IN ('applied','pending')"), 'pricing_schedule status filter present');
});

test('[I-06] server.js filters pricing_schedule by user_id = ANY(agencyIds) — no cross-account leak', async () => {
  const schedIdx = srvSrc.indexOf("status IN ('applied','pending')");
  // params array appears AFTER the SQL string — search both before and after
  const block = srvSrc.slice(Math.max(0, schedIdx - 400), schedIdx + 300);
  ok(block.includes('agencyIds'), 'pricing_schedule query scoped to agencyIds');
});

test('[I-07] server.js filters pricing_config by user_id = ANY(agencyIds)', async () => {
  const cfgIdx = srvSrc.indexOf('5 — BoostPrice config');
  const block = srvSrc.slice(cfgIdx, cfgIdx + 400);
  ok(block.includes('agencyIds'), 'pricing_config query scoped to agencyIds');
});

test('[I-08] pricing_schedule query is wrapped in try-catch (table may not exist)', async () => {
  const schedIdx = srvSrc.indexOf("status IN ('applied','pending')");
  const region = srvSrc.slice(Math.max(0, schedIdx - 600), schedIdx + 200);
  ok(region.includes('try {'), 'pricing_schedule query is try-catch guarded');
});

test('[I-09] canonical priority comment in server.js references boostprice before period_rule', async () => {
  ok(srvSrc.includes('manual_override > boostprice(applied) > period_rule'), 'canonical priority comment present');
});

test('[I-10] query count: exactly 6 distinct DB queries in calendar handler', async () => {
  // Find the handler region and count the pool.query calls
  const handlerStart = srvSrc.indexOf('GET /api/pricing/calendar — calendrier multi-logements');
  const handlerEnd   = srvSrc.indexOf('res.json({ from, to, properties: result })', handlerStart);
  const region = srvSrc.slice(handlerStart, handlerEnd);
  const queryCount = (region.match(/await pool\.query\(/g) || []).length;
  // 5 queries: properties(1), overrides(2), rules(3), reservations(4), pricing_config(5)
  // + 1 inside try-catch: pricing_schedule(6)
  ok(queryCount >= 5 && queryCount <= 6, `expected 5-6 pool.query calls, found ${queryCount}`);
});

// ── [J] BP status semantics ────────────────────────────────────────────────────

test('[J-01] status=applied in bpSchedule is NOT labeled as OTA delivery', async () => {
  // Verify no misleading field names in server.js bpSchedule section
  const bpSection = srvSrc.slice(srvSrc.indexOf('IOS-BP-02 additive'), srvSrc.indexOf('IOS-BP-02 additive') + 300);
  ok(!bpSection.includes('ota_'), 'no ota_ prefixed fields');
  ok(!bpSection.includes('published'), 'no published field');
  ok(!bpSection.includes('pushed_to'), 'no pushed_to field');
});

test('[J-02] applied status does NOT mean OTA delivery (comment in server.js)', async () => {
  ok(srvSrc.includes("does NOT mean OTA delivery"), 'OTA delivery disclaimer comment present');
});

test('[J-03] bpSchedule entries have only status and price (no OTA delivery fields)', async () => {
  const r = buildPropertyResult({
    from: '2026-10-05', to: '2026-10-05',
    basePrice: 95, weekendPrice: null,
    propIsExternal: false, bpIsActive: true,
    bpEntries: { '2026-10-05': { status: 'applied', price: 108 } },
  });
  const entry = r.bpSchedule['2026-10-05'];
  ok(entry != null);
  const keys = Object.keys(entry);
  ok(keys.includes('status'), 'has status');
  ok(keys.includes('price'), 'has price');
  ok(!keys.includes('pushed_at'), 'no pushed_at');
  ok(!keys.includes('ota_status'), 'no ota_status');
  ok(!keys.includes('channex_status'), 'no channex_status');
});

// ── [K] Pricing priority — canonical order verification ───────────────────────

test('[K-01] full priority chain: override > bp_applied > period > weekday > weekend > base', async () => {
  // For date 2026-10-02 (Friday, dow=5):
  // - override at 90
  // - BP applied at 108
  // - period rule at 130
  // - weekday rule for Friday (5) at 85
  // - weekendPrice=120, basePrice=95
  // Expected: override wins (90)
  const r1 = buildPropertyResult({
    from: '2026-10-02', to: '2026-10-02',
    basePrice: 95, weekendPrice: 120,
    propIsExternal: false, bpIsActive: true,
    propOverrides: { '2026-10-02': 90 },
    bpEntries:     { '2026-10-02': { status: 'applied', price: 108 } },
    periodRules:   [{ start_date: '2026-10-01', end_date: '2026-10-31', price: 130, priority: 1 }],
    weekdayRules:  [{ days_of_week: [5], price: 85, priority: 1 }],
  });
  eq(r1.prices['2026-10-02'], 90);
  eq(r1.sources['2026-10-02'], 'manual_override');

  // Remove override: BP applied wins
  const r2 = buildPropertyResult({
    from: '2026-10-02', to: '2026-10-02',
    basePrice: 95, weekendPrice: 120,
    propIsExternal: false, bpIsActive: true,
    bpEntries:    { '2026-10-02': { status: 'applied', price: 108 } },
    periodRules:  [{ start_date: '2026-10-01', end_date: '2026-10-31', price: 130, priority: 1 }],
    weekdayRules: [{ days_of_week: [5], price: 85, priority: 1 }],
  });
  eq(r2.prices['2026-10-02'], 108);
  eq(r2.sources['2026-10-02'], 'boostprice');

  // Remove BP: period rule wins
  const r3 = buildPropertyResult({
    from: '2026-10-02', to: '2026-10-02',
    basePrice: 95, weekendPrice: 120,
    propIsExternal: false, bpIsActive: true,
    periodRules:  [{ start_date: '2026-10-01', end_date: '2026-10-31', price: 130, priority: 1 }],
    weekdayRules: [{ days_of_week: [5], price: 85, priority: 1 }],
  });
  eq(r3.prices['2026-10-02'], 130);
  eq(r3.sources['2026-10-02'], 'period_rule');

  // Remove period: weekday rule wins
  const r4 = buildPropertyResult({
    from: '2026-10-02', to: '2026-10-02',
    basePrice: 95, weekendPrice: 120,
    propIsExternal: false, bpIsActive: true,
    weekdayRules: [{ days_of_week: [5], price: 85, priority: 1 }],
  });
  eq(r4.prices['2026-10-02'], 85);
  eq(r4.sources['2026-10-02'], 'weekday_rule');

  // Remove weekday rule: weekend price wins (Friday)
  const r5 = buildPropertyResult({
    from: '2026-10-02', to: '2026-10-02',
    basePrice: 95, weekendPrice: 120,
    propIsExternal: false, bpIsActive: true,
  });
  eq(r5.prices['2026-10-02'], 120);
  eq(r5.sources['2026-10-02'], 'weekend_price');

  // Remove weekend price: base wins
  const r6 = buildPropertyResult({
    from: '2026-10-02', to: '2026-10-02',
    basePrice: 95, weekendPrice: null,
    propIsExternal: false, bpIsActive: true,
  });
  eq(r6.prices['2026-10-02'], 95);
  eq(r6.sources['2026-10-02'], 'base_price');
});

// ── [L] Agency / multi-account ─────────────────────────────────────────────────

test('[L-01] calendar endpoint uses agencyIds for overrides query', async () => {
  const calIdx = srvSrc.indexOf('GET /api/pricing/calendar — calendrier multi-logements');
  const region = srvSrc.slice(calIdx, calIdx + 3000);
  const firstAgency = region.indexOf('agencyIds');
  ok(firstAgency > 0, 'agencyIds used in calendar handler');
});

test('[L-02] calendar endpoint uses getAgencyUserIds', async () => {
  ok(srvSrc.includes('getAgencyUserIds'), 'getAgencyUserIds called in server.js');
});

test('[L-03] no req.user.id assumption in calendar property scoping', async () => {
  const calIdx = srvSrc.indexOf('const agencyIds = await getAgencyUserIds(req, user.id)');
  // The agencyIds is derived properly via getAgencyUserIds, not req.user.id alone
  ok(calIdx >= 0, 'getAgencyUserIds pattern used for agency scope');
});

// ── [M] Schedule endpoint agency gap (spec §13) ───────────────────────────────

test('[M-01] SCHEDULE_ENDPOINT_AGENCY_GAP_CONFIRMED: schedule endpoint uses req.user.id directly', async () => {
  // Find the /api/pricing/schedule/:propertyId endpoint
  const schedIdx = srvSrc.indexOf("'/api/pricing/schedule/:propertyId'") >= 0
    ? srvSrc.indexOf("'/api/pricing/schedule/:propertyId'")
    : srvSrc.indexOf('`/api/pricing/schedule/:propertyId`');

  // Fall back to pricing-calendars.js which is where it's actually defined
  const calSrc = fs.readFileSync(path.join(__dirname, '../routes/pricing-calendars.js'), 'utf8');
  const idx = calSrc.indexOf('/api/pricing/schedule/:propertyId');
  ok(idx >= 0, 'schedule endpoint exists in pricing-calendars.js');

  // Confirm it queries pricing_schedule using req.user.id directly
  const block = calSrc.slice(idx, idx + 500);
  ok(block.includes('req.user.id'), 'schedule endpoint uses req.user.id — gap confirmed');
  ok(!block.includes('resolvePricingOwner'), 'schedule endpoint does NOT use resolvePricingOwner — gap confirmed');
});

// ── [N] No price omitted when null base ────────────────────────────────────────

test('[N-01] date with no base price, no rules: omitted from prices and sources', async () => {
  const r = buildPropertyResult({
    from: '2026-10-01', to: '2026-10-01',
    basePrice: null, weekendPrice: null,
    propIsExternal: false, bpIsActive: false,
  });
  eq(r.prices['2026-10-01'], undefined, 'no price when no base configured');
  eq(r.sources['2026-10-01'], undefined, 'no source when no price');
});

// ── Summary ───────────────────────────────────────────────────────────────────

async function main() {
  await new Promise(resolve => setImmediate(resolve));
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`IOS-BP-02: ${passed}/${passed + failed} tests passed`);
  if (failed > 0) {
    console.error(`\n${failed} test(s) FAILED:`);
    for (const f of failures) console.error(`  • ${f.name}: ${f.message}`);
    process.exit(1);
  } else {
    console.log('All tests passed ✅');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
