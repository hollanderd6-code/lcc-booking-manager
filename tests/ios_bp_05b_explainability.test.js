/**
 * IOS-BP-05B — BoostPrice nightly explainability + agency-safe schedule
 *
 * Tests §17 Explainability, §18 Authorization, §19 Date Filtering.
 * Pure static analysis + inline replica logic — no DB, no network.
 *
 * Factor numbers use the actual pricing-engine.js exports so the test
 * assertions describe real engine output, not approximations.
 */
'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const {
  buildSchedule,
  computeNightPrice,
  DEFAULTS,
  marketMult,
  eventMult,
  isOrphanGap,
} = require('../routes/pricing-engine');

const ENGINE_SRC   = fs.readFileSync(path.join(__dirname, '../routes/pricing-engine.js'), 'utf8');
const APPLY_SRC    = fs.readFileSync(path.join(__dirname, '../routes/pricing-apply.js'), 'utf8');
const CAL_SRC      = fs.readFileSync(path.join(__dirname, '../routes/pricing-calendars.js'), 'utf8');
const ROUTES_SRC   = fs.readFileSync(path.join(__dirname, '../routes/dynamic-pricing-routes.js'), 'utf8');

// ── Shared fixture ─────────────────────────────────────────────────────────
const TODAY = new Date('2026-10-01T00:00:00Z');

function makeSched(opts = {}) {
  return buildSchedule({
    today:          TODAY,
    basePrice:      opts.basePrice      ?? 100,
    weekendPrice:   opts.weekendPrice   ?? 130,
    priceMin:       opts.priceMin       ?? 60,
    priceMax:       opts.priceMax       ?? 300,
    bookedDates:    opts.bookedDates    ?? [],
    market:         opts.market         ?? { median: 110, comparable_count: 30, tension_level: 'elevated' },
    events:         opts.events         ?? [],
    schoolHolidays: opts.schoolHolidays ?? [],
    cfg:            opts.cfg            ?? { aggressiveness: 0.85 },
  });
}

// Pick a non-booked night on a specific date
function night(sched, dateStr) {
  return sched.find(n => n.date === dateStr && !n.booked);
}


// ════════════════════════════════════════════════════════════════════════════
// §17 EXPLAINABILITY — Tests 1-17
// ════════════════════════════════════════════════════════════════════════════

// ── [01] freshly calculated night has a breakdown (= explainability) object ─

{
  const sched = makeSched();
  const n = sched.find(n => !n.booked);
  assert.ok(n, '[01] schedule produced at least one unboooked night');
  assert.ok(n.breakdown !== null && typeof n.breakdown === 'object',
    '[01] night has a breakdown object');
}

// ── [02] price and factors originate from same engine result ─────────────

{
  const sched = makeSched({ basePrice: 100 });
  for (const n of sched.filter(nb => !nb.booked).slice(0, 5)) {
    const computed = n.breakdown.base
      * n.breakdown.season
      * n.breakdown.dow
      * n.breakdown.lead
      * n.breakdown.pacing
      * n.breakdown.strategy
      * n.breakdown.market
      * n.breakdown.event
      * n.breakdown.gap;
    // rawBeforeClamp should match the unclamped product (within rounding)
    assert.ok(Math.abs(computed - n.breakdown.rawBeforeClamp) < 1.5,
      `[02] price factors × base ≈ rawBeforeClamp for date ${n.date} (diff: ${Math.abs(computed - n.breakdown.rawBeforeClamp).toFixed(2)})`);
  }
}

// ── [03] season factor preserved ───────────────────────────────────────────

{
  const sched = makeSched();
  // Oct → season ~1.02 (from DEFAULTS.seasonByMonth[9]=1.02)
  const n = night(sched, '2026-10-15');
  assert.ok(n, '[03] night 2026-10-15 exists');
  assert.ok(n.breakdown.season > 0.5 && n.breakdown.season < 1.5,
    `[03] season factor in plausible range: ${n.breakdown.season}`);
  assert.strictEqual(typeof n.breakdown.season, 'number', '[03] season is a number');
}

// ── [04] DOW factor preserved ──────────────────────────────────────────────

{
  const sched = makeSched();
  // 2026-10-10 is a Saturday (dow=6) — weekend premium
  const sat = night(sched, '2026-10-10');
  assert.ok(sat, '[04] Saturday 2026-10-10 exists');
  // 2026-10-12 is Monday (dow=1) — lower rate
  const mon = night(sched, '2026-10-12');
  assert.ok(mon, '[04] Monday 2026-10-12 exists');
  assert.ok(sat.breakdown.dow > mon.breakdown.dow,
    `[04] Saturday DOW (${sat.breakdown.dow}) > Monday DOW (${mon.breakdown.dow})`);
}

// ── [05] lead factor preserved ─────────────────────────────────────────────

{
  const sched = makeSched();
  // Near date (3 days out) should have lower lead factor than far date (60+ days)
  const nearDate = new Date('2026-10-01T00:00:00Z');
  nearDate.setUTCDate(nearDate.getUTCDate() + 3);
  const nearStr = nearDate.toISOString().slice(0, 10);
  const farDate = new Date('2026-10-01T00:00:00Z');
  farDate.setUTCDate(farDate.getUTCDate() + 60);
  const farStr = farDate.toISOString().slice(0, 10);

  const nearN = night(sched, nearStr);
  const farN  = night(sched, farStr);
  assert.ok(nearN && farN, '[05] near and far nights exist');
  assert.ok(nearN.breakdown.lead < farN.breakdown.lead,
    `[05] near lead (${nearN.breakdown.lead}) < far lead (${farN.breakdown.lead})`);
}

// ── [06] pacing factor preserved ───────────────────────────────────────────

{
  // With many bookings nearby, pacing should be > 1 (ahead of ideal → premium)
  // Create a bookedSet that saturates the pacing window
  const bookedDates = [];
  const d0 = new Date('2026-10-01T00:00:00Z');
  for (let i = 0; i < 30; i++) {
    const d = new Date(d0.getTime() + i * 86400000);
    bookedDates.push(d.toISOString().slice(0, 10));
  }
  const schedHeavy = makeSched({ bookedDates });
  const schedEmpty = makeSched({ bookedDates: [] });

  // Find nights that are not booked (heavy schedule may have all booked — use a far date)
  const farStr = '2026-11-15';
  const nHeavy = schedHeavy.find(n => n.date === farStr);
  const nEmpty = schedEmpty.find(n => n.date === farStr);
  assert.ok(nHeavy && nEmpty, '[06] 2026-11-15 exists in both schedules');
  assert.ok(typeof nHeavy.breakdown.pacing === 'number', '[06] pacing is a number');
  assert.ok(typeof nEmpty.breakdown.pacing === 'number', '[06] empty pacing is a number');
}

// ── [07] market factor preserved when available ───────────────────────────

{
  const schedWithMarket    = makeSched({ market: { median: 130, comparable_count: 40, tension_level: 'high' } });
  // buildSchedule directly to pass market:null (makeSched uses ?? so null would fall back to default)
  const schedWithoutMarket = buildSchedule({
    today: TODAY, basePrice: 100, weekendPrice: 130, priceMin: 60, priceMax: 300,
    bookedDates: [], market: null, events: [], schoolHolidays: [], cfg: { aggressiveness: 0.85 },
  });

  const nWith    = night(schedWithMarket, '2026-10-15');
  const nWithout = night(schedWithoutMarket, '2026-10-15');
  assert.ok(nWith && nWithout, '[07] nights exist in both schedules');
  // With market, factor should differ from 1 when median differs from computed price
  assert.ok(typeof nWith.breakdown.market === 'number', '[07] market factor is numeric');
  // Without market, factor should be 1
  assert.strictEqual(nWithout.breakdown.market, 1, '[07] no-market factor = 1');
}

// ── [08] event factor preserved when available ───────────────────────────

{
  const events = [{ start: '2026-10-15', end: '2026-10-17', mult: 1.25, label: 'TestEvent' }];
  const schedWithEvent    = makeSched({ events });
  const schedWithoutEvent = makeSched({ events: [] });

  const nWith    = night(schedWithEvent, '2026-10-15');
  const nWithout = night(schedWithoutEvent, '2026-10-15');
  assert.ok(nWith && nWithout, '[08] nights exist');
  assert.ok(nWith.breakdown.event > 1, `[08] event factor > 1 on event date: ${nWith.breakdown.event}`);
  assert.strictEqual(nWith.breakdown.eventLabel, 'TestEvent', '[08] eventLabel preserved');
  assert.strictEqual(nWithout.breakdown.event, 1, '[08] no-event factor = 1');
  assert.strictEqual(nWithout.breakdown.eventLabel, null, '[08] no-event eventLabel is null');
}

// ── [09] gap factor preserved ──────────────────────────────────────────────

{
  // Create an orphan gap: book the days around a 1-night gap
  const bookedDates = ['2026-10-14', '2026-10-16'];  // gap on 2026-10-15
  const sched = makeSched({ bookedDates });
  const orphan = sched.find(n => n.date === '2026-10-15');
  assert.ok(orphan, '[09] gap night 2026-10-15 exists');
  assert.ok(orphan.breakdown.gap < 1, `[09] gap factor < 1 for orphan night: ${orphan.breakdown.gap}`);
  assert.strictEqual(orphan.breakdown.gap, DEFAULTS.gapFillMult, '[09] gap factor equals gapFillMult');
}

// ── [10] neutral factors remain truthful ──────────────────────────────────

{
  // A non-orphan night with no market, no event, aggressiveness=0 → factors close to 1
  const sched = buildSchedule({
    today: TODAY,
    basePrice: 100,
    priceMin: 60,
    priceMax: 300,
    bookedDates: [],
    market: null,
    events: [],
    schoolHolidays: [],
    cfg: { aggressiveness: 0, strategy: 50 },
  });
  const n = sched.find(nb => !nb.booked && nb.date > '2026-10-10');
  assert.ok(n, '[10] unboooked night exists');
  assert.strictEqual(n.breakdown.event, 1, '[10] event factor = 1 (no event)');
  assert.strictEqual(n.breakdown.market, 1, '[10] market factor = 1 (no market)');
  assert.strictEqual(n.breakdown.gap, 1, '[10] gap factor = 1 (not orphan)');
}

// ── [11] missing optional factor safe (marketConfidence null) ─────────────

{
  // Market with too few comparables → confidence=0 → marketMult returns mult:1, no confidence
  const result = marketMult(100, { median: 130, comparable_count: 2, tension_level: 'medium' }, {
    ...DEFAULTS,
    marketMinComps: 8,
    marketFullComps: 40,
  });
  assert.strictEqual(result.mult, 1, '[11] low-confidence market mult = 1');
  assert.strictEqual(result.applied, false, '[11] low-confidence market applied=false');
  // In the breakdown, marketConfidence will be null when not applied
  const sched = makeSched({ market: { median: 130, comparable_count: 2, tension_level: 'medium' } });
  const n = sched.find(nb => !nb.booked);
  assert.ok(n, '[11] night exists');
  // confidence=0 so market factor=1, marketConfidence=undefined which maps to null
  assert.strictEqual(n.breakdown.market, 1, '[11] engine breakdown market=1 for low-confidence market');
}

// ── [12] explainability version present ───────────────────────────────────

{
  const sched = makeSched();
  const n = sched.find(nb => !nb.booked);
  assert.ok(n, '[12] night exists');
  assert.strictEqual(n.breakdown.version, 1, '[12] breakdown.version = 1');
}

// ── [13] no PII persisted ─────────────────────────────────────────────────

{
  const sched = makeSched();
  const n = sched.find(nb => !nb.booked);
  assert.ok(n, '[13] night exists');
  const breakdownKeys = Object.keys(n.breakdown);

  // None of these PII-adjacent keys should be present
  const forbiddenKeys = ['guestName', 'guestEmail', 'guestPhone', 'reservationId',
    'propertyName', 'hostName', 'hostEmail', 'apiKey', 'token', 'secret'];
  for (const key of forbiddenKeys) {
    assert.ok(!breakdownKeys.includes(key), `[13] no PII key '${key}' in breakdown`);
  }
}

// ── [14] no raw market payload persisted ──────────────────────────────────

{
  const sched = makeSched();
  const n = sched.find(nb => !nb.booked);
  assert.ok(n, '[14] night exists');
  // breakdown.market is a multiplicative number, not an object with raw competitor data
  assert.strictEqual(typeof n.breakdown.market, 'number',
    '[14] breakdown.market is a number (factor), not a raw payload object');
  // marketConfidence is also a number or null, not a nested object
  assert.ok(
    n.breakdown.marketConfidence === null ||
    n.breakdown.marketConfidence === undefined ||
    typeof n.breakdown.marketConfidence === 'number',
    '[14] marketConfidence is numeric or null, not a raw object'
  );
  // No raw comparables list
  assert.ok(!Array.isArray(n.breakdown.comparables), '[14] no comparables array in breakdown');
  assert.ok(!n.breakdown.rawApiResponse,             '[14] no rawApiResponse in breakdown');
}

// ── [15] existing NULL explainability row safe ────────────────────────────

{
  // Simulate what the schedule endpoint does for a row with null breakdown
  function mapScheduleRow(r) {
    return {
      ...r,
      minStay:        r.min_stay,
      explainability: r.breakdown || null,
    };
  }

  const nullRow = { date: '2026-10-15', price: '120.00', min_stay: 2, reason: 'High season', status: 'pending', breakdown: null };
  const mapped  = mapScheduleRow(nullRow);
  assert.strictEqual(mapped.explainability, null, '[15] null breakdown maps to null explainability');
  assert.strictEqual(mapped.breakdown, null, '[15] breakdown field preserved as null');

  const emptyRow = { ...nullRow, breakdown: {} };
  const mappedEmpty = mapScheduleRow(emptyRow);
  assert.ok(mappedEmpty.explainability !== null, '[15] empty object {} is truthy, not mapped to null');
}

// ── [16] no fake historical backfill ─────────────────────────────────────

{
  // Source analysis: no backfill UPDATE/INSERT touching existing rows' breakdown
  const backfillPatterns = [
    /UPDATE\s+pricing_schedule\s+SET\s+breakdown/i,
    /backfill.*breakdown/i,
    /breakdown.*backfill/i,
  ];
  for (const pattern of backfillPatterns) {
    assert.ok(!pattern.test(APPLY_SRC), `[16] no backfill pattern '${pattern}' in pricing-apply.js`);
    assert.ok(!pattern.test(CAL_SRC),   `[16] no backfill pattern '${pattern}' in pricing-calendars.js`);
    assert.ok(!pattern.test(ROUTES_SRC),`[16] no backfill pattern '${pattern}' in dynamic-pricing-routes.js`);
  }
}

// ── [17] manual weekly acceptance does not fabricate nightly factors ──────

{
  // _applyDecision writes a truthful marker breakdown, not per-night engine factors
  const applyDecisionIdx = ROUTES_SRC.indexOf('_applyDecision');
  assert.ok(applyDecisionIdx >= 0, '[17] _applyDecision found in routes source');

  // Find the pricing_schedule INSERT within _applyDecision (occurs within 2000 chars)
  const decisionBlock = ROUTES_SRC.slice(applyDecisionIdx, applyDecisionIdx + 2500);

  // The breakdown for manual_accept must contain manual_accept:true
  assert.ok(/manual_accept.*true/.test(decisionBlock),
    '[17] manual acceptance breakdown contains manual_accept:true');

  // Must NOT contain per-night factor keys (season, dow, lead, etc.)
  const perNightKeys = ['season', 'dow', 'lead', 'pacing', 'fSeason', 'fDow'];
  for (const k of perNightKeys) {
    // Check the breakdown literal only (not the rest of the function logic)
    // The breakdown JSON literal is the string between JSON.stringify({ and })
    const jsonStart = decisionBlock.indexOf('JSON.stringify({');
    const jsonEnd   = decisionBlock.indexOf('})', jsonStart) + 2;
    const jsonLiteral = decisionBlock.slice(jsonStart, jsonEnd);
    assert.ok(!jsonLiteral.includes(`'${k}'`) && !jsonLiteral.includes(`"${k}"`),
      `[17] manual acceptance breakdown does not fabricate per-night factor '${k}'`);
  }
  // Must have version: 1
  assert.ok(/version.*1/.test(decisionBlock.slice(decisionBlock.indexOf('JSON.stringify({'),
    decisionBlock.indexOf('})', decisionBlock.indexOf('JSON.stringify({')) + 2)),
    '[17] manual acceptance breakdown includes version:1');
}


// ════════════════════════════════════════════════════════════════════════════
// §18 AUTHORIZATION — Tests 18-23
// ════════════════════════════════════════════════════════════════════════════

// ── [18-23] Source analysis: schedule endpoint uses resolvePricingOwner ───

{
  const schedIdx = CAL_SRC.indexOf("/api/pricing/schedule/:propertyId");
  assert.ok(schedIdx >= 0, '[18] schedule route found in pricing-calendars.js');

  const schedBlock = CAL_SRC.slice(schedIdx, schedIdx + 4000);

  // [18] resolvePricingOwner called
  assert.ok(/resolvePricingOwner/.test(schedBlock),
    '[18] resolvePricingOwner called in schedule endpoint');

  // [19] Agency authorization: resolvePricingOwner handles account_delegations
  const resolverIdx = CAL_SRC.indexOf('async function resolvePricingOwner');
  assert.ok(resolverIdx >= 0, '[19] resolvePricingOwner defined in pricing-calendars.js');
  const resolverBlock = CAL_SRC.slice(resolverIdx, resolverIdx + 1200);
  assert.ok(/account_delegations/.test(resolverBlock),
    '[19] resolvePricingOwner checks account_delegations (agency authorization)');

  // [20] Sub-account / delegate path handled
  assert.ok(/isSubAccount/.test(resolverBlock) || /subAccountId/.test(resolverBlock),
    '[20] resolvePricingOwner handles sub-account path');

  // [21] Unrelated user returns null → 403
  assert.ok(/return res\.status\(403\)/.test(schedBlock),
    '[21] 403 returned when resolvePricingOwner returns null (unrelated user)');

  // [22] Property ownership verified via properties table JOIN
  assert.ok(/FROM properties/.test(resolverBlock),
    '[22] resolvePricingOwner queries properties table (ownership verification)');

  // [23] Schedule query uses ownerId (resolved), NOT req.user.id
  // The SQL uses $1 for user_id which must be ownerId
  const sqlInBlock = schedBlock.indexOf('FROM pricing_schedule');
  assert.ok(sqlInBlock >= 0, '[23] pricing_schedule SELECT found in schedule block');
  // req.user.id must not appear as a SQL parameter in the schedule block
  // (it's replaced by ownerId which is the agency-resolved owner)
  // We verify ownerId is declared and used
  assert.ok(/const ownerId/.test(schedBlock), '[23] ownerId declared in schedule endpoint');
  assert.ok(!/req\.user\.id/.test(schedBlock.slice(schedBlock.indexOf('const ownerId'), schedBlock.indexOf('FROM pricing_schedule') + 200)),
    '[23] req.user.id not used as SQL parameter after ownerId is declared');
}


// ════════════════════════════════════════════════════════════════════════════
// §19 DATE FILTERING — Tests 24-28
// ════════════════════════════════════════════════════════════════════════════

// Inline replica of the date range validation logic from the endpoint
function validateDateRange(from, to) {
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (from != null && !DATE_RE.test(from))
    return { valid: false, error: 'invalid_from' };
  if (to != null && !DATE_RE.test(to))
    return { valid: false, error: 'invalid_to' };
  const resolvedFrom = from || new Date('2026-10-01').toISOString().slice(0, 10);
  const resolvedTo   = to || (() => {
    const d = new Date(resolvedFrom + 'T00:00:00Z');
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    return d.toISOString().slice(0, 10);
  })();
  if (resolvedTo < resolvedFrom)
    return { valid: false, error: 'range_reversed' };
  return { valid: true, from: resolvedFrom, to: resolvedTo };
}

// ── [24] exact single date ────────────────────────────────────────────────

{
  const r = validateDateRange('2026-10-15', '2026-10-15');
  assert.strictEqual(r.valid, true,         '[24] single date is valid');
  assert.strictEqual(r.from, '2026-10-15',  '[24] from preserved');
  assert.strictEqual(r.to,   '2026-10-15',  '[24] to preserved');
}

// ── [25] valid date range ─────────────────────────────────────────────────

{
  const r = validateDateRange('2026-10-01', '2026-10-31');
  assert.strictEqual(r.valid, true,         '[25] valid range accepted');
  assert.strictEqual(r.from, '2026-10-01',  '[25] from correct');
  assert.strictEqual(r.to,   '2026-10-31',  '[25] to correct');
}

// ── [26] invalid date rejected ───────────────────────────────────────────

{
  const badFormats = ['20261015', '2026/10/15', '15-10-2026', 'abc', ''];
  for (const bad of badFormats) {
    const r = validateDateRange(bad, '2026-10-31');
    assert.strictEqual(r.valid, false, `[26] invalid from '${bad}' rejected`);
    assert.strictEqual(r.error, 'invalid_from', `[26] error=invalid_from for '${bad}'`);
  }
  for (const bad of badFormats) {
    const r = validateDateRange('2026-10-01', bad);
    assert.strictEqual(r.valid, false, `[26] invalid to '${bad}' rejected`);
    assert.strictEqual(r.error, 'invalid_to', `[26] error=invalid_to for '${bad}'`);
  }
}

// ── [27] reversed range rejected ─────────────────────────────────────────

{
  const r = validateDateRange('2026-10-31', '2026-10-01');
  assert.strictEqual(r.valid, false,          '[27] reversed range rejected');
  assert.strictEqual(r.error, 'range_reversed', '[27] error=range_reversed');
}

// ── [28] omitted range uses legacy ?days= behaviour (backwards compat) ────

{
  // Source: when neither from nor to is present, the endpoint uses LIMIT $3 with ?days
  const schedBlock = CAL_SRC.slice(
    CAL_SRC.indexOf("/api/pricing/schedule/:propertyId"),
    CAL_SRC.indexOf("/api/pricing/schedule/:propertyId") + 4000
  );
  assert.ok(/req\.query\.days/.test(schedBlock),
    '[28] legacy ?days= query parameter still handled');
  assert.ok(/LIMIT \$3/.test(schedBlock),
    '[28] legacy LIMIT clause preserved for backwards compat');
  assert.ok(/parseInt\(req\.query\.days\)/.test(schedBlock),
    '[28] days parsed via parseInt as before');
}

// ── Source: from/to filter uses date range SQL (not LIMIT) ───────────────

{
  const schedBlock = CAL_SRC.slice(
    CAL_SRC.indexOf("/api/pricing/schedule/:propertyId"),
    CAL_SRC.indexOf("/api/pricing/schedule/:propertyId") + 4000
  );
  assert.ok(/date >= \$3::date AND date <= \$4::date/.test(schedBlock),
    '[28b] date range filter uses parameterized from/to dates');
}

// ── [EX-01] version field in engine source ────────────────────────────────

{
  // Verify version:1 is in computeNightPrice return statement
  const breakdownIdx = ENGINE_SRC.indexOf('breakdown: {');
  assert.ok(breakdownIdx >= 0, '[EX-01] breakdown object found in engine source');
  const breakdownBlock = ENGINE_SRC.slice(breakdownIdx, breakdownIdx + 400);
  assert.ok(/version\s*:\s*1/.test(breakdownBlock),
    '[EX-01] version:1 present in engine breakdown');
}

// ── [EX-02] explainability field in schedule response ─────────────────────

{
  const schedIdx = CAL_SRC.indexOf("/api/pricing/schedule/:propertyId");
  const schedBlock = CAL_SRC.slice(schedIdx, schedIdx + 4000);
  assert.ok(/explainability\s*:/.test(schedBlock),
    '[EX-02] explainability field in schedule response');
  assert.ok(/r\.breakdown/.test(schedBlock),
    '[EX-02] explainability wired to r.breakdown (the DB column)');
}

// ── [EX-03] minStay camelCase alias added ─────────────────────────────────

{
  const schedIdx = CAL_SRC.indexOf("/api/pricing/schedule/:propertyId");
  const schedBlock = CAL_SRC.slice(schedIdx, schedIdx + 4000);
  assert.ok(/minStay\s*:/.test(schedBlock),
    '[EX-03] minStay camelCase alias in schedule response');
}

// ── [EX-04] breakdown column already exists — no new column migration needed

{
  // Verify the ensureScheduleTable CREATE TABLE includes breakdown JSONB
  assert.ok(/breakdown\s+JSONB/.test(APPLY_SRC),
    '[EX-04] breakdown JSONB column defined in ensureScheduleTable — no migration needed');
}

// ── [EX-05] upsertSchedule persists n.breakdown from engine result ─────────

{
  // upsertSchedule receives nights array and persists n.breakdown
  assert.ok(/n\.breakdown/.test(APPLY_SRC) || /breakdown/.test(APPLY_SRC),
    '[EX-05] pricing-apply.js persists breakdown in upsertSchedule');
  // The INSERT includes breakdown in its column list
  assert.ok(/INSERT INTO pricing_schedule[\s\S]{0,200}breakdown/.test(APPLY_SRC),
    '[EX-05] INSERT INTO pricing_schedule includes breakdown column');
}

// ── [EX-06] all write paths go through applyDynamicPricingForProperty ─────

{
  // recalc-trigger calls applyDynamicPricingForProperty
  const RECALC_SRC = fs.readFileSync(
    path.join(__dirname, '../routes/pricing-recalc-trigger.js'), 'utf8'
  );
  assert.ok(/applyDynamicPricingForProperty/.test(RECALC_SRC),
    '[EX-06] recalc-trigger calls applyDynamicPricingForProperty (all write paths covered)');

  // cron also calls applyDynamicPricingForProperty
  const CRON_SRC = fs.readFileSync(
    path.join(__dirname, '../routes/dynamic-pricing-cron.js'), 'utf8'
  );
  assert.ok(/applyDynamicPricingForProperty/.test(CRON_SRC),
    '[EX-06] cron calls applyDynamicPricingForProperty');
}

console.log('✅  IOS-BP-05B: all tests passed');
