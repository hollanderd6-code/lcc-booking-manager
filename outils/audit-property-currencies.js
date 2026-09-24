#!/usr/bin/env node
'use strict';
require('dotenv').config();
/**
 * P1.2-B3C — Property Currency Reconciliation Audit
 *
 * READ-ONLY. No DB writes. No Channex writes.
 * REAL Channex GETs are allowed (rate plan currency read).
 * REAL DB SELECTs are allowed.
 *
 * Usage: DATABASE_URL=... CHANNEX_API_KEY=... node outils/audit-property-currencies.js
 *   --user <userId>   restrict to one user (optional)
 *   --json            emit machine-readable JSON summary at the end (optional)
 *
 * Output privacy:
 *   - Property IDs are truncated to last 8 chars
 *   - Rate plan IDs are truncated to last 8 chars
 *   - No API keys, no DATABASE_URL in output
 */

const { Pool }                      = require('pg');
const { getChannexRatePlanCurrency } = require('../channex');
const { reconcilePropertyCurrency, SEGMENT, STATUS } = require('../routes/property-currency-reconciler');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let filterUserId = null;
let emitJson     = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--user' && args[i + 1]) { filterUserId = args[++i]; }
  if (args[i] === '--json')                { emitJson = true; }
}

// ── Bounded concurrency ───────────────────────────────────────────────────────
const MAX_CHANNEX_CONCURRENT = 3;

async function withConcurrency(tasks, maxConcurrent, processor) {
  if (tasks.length === 0) return [];
  const results = new Array(tasks.length);
  let nextIdx = 0;

  async function worker() {
    while (true) {
      const idx = nextIdx++;          // safe: JS is single-threaded, this is atomic
      if (idx >= tasks.length) break;
      results[idx] = await processor(tasks[idx], idx);
    }
  }

  const workerCount = Math.min(maxConcurrent, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

// ── DB ────────────────────────────────────────────────────────────────────────
function makePool() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required');
  }
  return new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
}

async function fetchProperties(pool, userId) {
  const sql = `
    SELECT
      id, name, internal_name, currency,
      channex_enabled, channex_rate_plan_id,
      channex_property_id, channex_room_type_id, channex_property_id_ext,
      external_pricing, boost_price_active,
      user_id
    FROM properties
    ${userId ? 'WHERE user_id = $1' : ''}
    ORDER BY user_id, id
  `;
  const params = userId ? [userId] : [];
  const res = await pool.query(sql, params);
  return res.rows;
}

// ── Per-property processing ───────────────────────────────────────────────────
async function processProperty(property) {
  let channexResult = null;

  if (property.channex_rate_plan_id) {
    channexResult = await getChannexRatePlanCurrency(property.channex_rate_plan_id);
  }

  return reconcilePropertyCurrency(property, channexResult);
}

// ── Sanitized ID (last 8 chars) ───────────────────────────────────────────────
function tail(id) {
  if (!id) return '(none)';
  return '…' + String(id).slice(-8);
}

// ── Report line ───────────────────────────────────────────────────────────────
function formatLine(rec) {
  const name  = (rec.propertyName || rec.propertyId || '?').slice(0, 40);
  const idTag = tail(rec.propertyId);
  const flags = [
    rec.channexEnabled          ? 'chx✓' : 'chx✗',
    rec.externalPricing         ? 'extP' : null,
    rec.boostPriceActive        ? 'boost' : null,
    rec.requiresHumanReview     ? '⚠ HUMAN' : null,
  ].filter(Boolean).join(' ');

  const localCur   = rec.localCurrency   || 'NULL';
  const channexCur = rec.channexCurrency || '—';

  return `  [${rec.reconciliationStatus.padEnd(24)}] ${idTag}  ${name.padEnd(40)}  local:${localCur}  chx:${channexCur}  ${flags}`;
}

// ── Aggregate counters ────────────────────────────────────────────────────────
function makeCounters() {
  const counters = {
    total: 0,
    bySegment: {},
    byStatus: {},
    requiresHumanReview: 0,
    wouldSet: 0,
    alreadySet: 0,
    conflict: 0,
    channexUnavailable: 0,
    localCurrencyNull: 0,
    localCurrencySet: 0,
    channexEUR: 0,
    channexGBP: 0,
    channexUSD: 0,
    channexOther: 0,
    externalPricingCount: 0,
    boostPriceActiveCount: 0,
    b3dSafeAutoSetIds: [],      // truncated suffixes (last 8 chars)
  };
  for (const s of Object.values(SEGMENT)) counters.bySegment[s] = 0;
  for (const s of Object.values(STATUS))  counters.byStatus[s]  = 0;
  return counters;
}

function tally(counters, rec) {
  counters.total++;
  counters.bySegment[rec.segment]               = (counters.bySegment[rec.segment]   || 0) + 1;
  counters.byStatus[rec.reconciliationStatus]   = (counters.byStatus[rec.reconciliationStatus] || 0) + 1;
  if (rec.requiresHumanReview) counters.requiresHumanReview++;
  if (rec.reconciliationStatus === STATUS.WOULD_SET)           counters.wouldSet++;
  if (rec.reconciliationStatus === STATUS.ALREADY_SET)         counters.alreadySet++;
  if (rec.reconciliationStatus === STATUS.CONFLICT)            counters.conflict++;
  if (rec.reconciliationStatus === STATUS.CHANNEX_UNAVAILABLE) counters.channexUnavailable++;

  if (rec.localCurrency === null) counters.localCurrencyNull++;
  else                            counters.localCurrencySet++;

  if (rec.channexCurrency === 'EUR')        counters.channexEUR++;
  else if (rec.channexCurrency === 'GBP')   counters.channexGBP++;
  else if (rec.channexCurrency === 'USD')   counters.channexUSD++;
  else if (rec.channexCurrency !== null)    counters.channexOther++;

  if (rec.externalPricing)  counters.externalPricingCount++;
  if (rec.boostPriceActive) counters.boostPriceActiveCount++;

  if (rec.reconciliationStatus === STATUS.WOULD_SET) {
    counters.b3dSafeAutoSetIds.push(tail(rec.propertyId));
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  P1.2-B3C — Property Currency Reconciliation Audit');
  console.log('  READ-ONLY. No writes. No Channex mutations.');
  if (filterUserId) console.log(`  Filter: user_id = …${filterUserId.slice(-8)}`);
  console.log('═══════════════════════════════════════════════════════\n');

  const pool = makePool();

  let properties;
  try {
    properties = await fetchProperties(pool, filterUserId);
  } finally {
    await pool.end();
  }

  console.log(`  Loaded ${properties.length} propert${properties.length === 1 ? 'y' : 'ies'} from DB.\n`);

  if (properties.length === 0) {
    console.log('  Nothing to audit.\n');
    process.exit(0);
  }

  // Split: those that need a Channex call vs those that don't
  const withRatePlan    = properties.filter(p => !!p.channex_rate_plan_id);
  const withoutRatePlan = properties.filter(p => !p.channex_rate_plan_id);

  console.log(`  ${withRatePlan.length} with rate_plan_id → Channex GETs (max ${MAX_CHANNEX_CONCURRENT} concurrent)`);
  console.log(`  ${withoutRatePlan.length} without rate_plan_id → local classification only\n`);

  // Process properties WITH rate plan (bounded Channex concurrency)
  let channexResults = [];
  if (withRatePlan.length > 0) {
    process.stdout.write('  Fetching from Channex ');
    let done = 0;
    channexResults = await withConcurrency(withRatePlan, MAX_CHANNEX_CONCURRENT, async (property) => {
      const rec = await processProperty(property);
      done++;
      if (done % 5 === 0 || done === withRatePlan.length) {
        process.stdout.write(`${done}/${withRatePlan.length} `);
      }
      return rec;
    });
    console.log('✓\n');
  }

  // Process properties WITHOUT rate plan (pure local, no I/O)
  const localResults = withoutRatePlan.map(p => reconcilePropertyCurrency(p, null));

  // Combine and restore original order
  const allResults = [];
  let ci = 0, li = 0;
  for (const p of properties) {
    if (p.channex_rate_plan_id) {
      allResults.push(channexResults[ci++]);
    } else {
      allResults.push(localResults[li++]);
    }
  }

  // ── Tally ──
  const counters = makeCounters();
  for (const rec of allResults) tally(counters, rec);

  // ── Per-property report, grouped by status ──────────────────────────────────
  const grouped = {};
  for (const rec of allResults) {
    const k = rec.reconciliationStatus;
    if (!grouped[k]) grouped[k] = [];
    grouped[k].push(rec);
  }

  const statusOrder = [
    STATUS.CONFLICT,
    STATUS.MISSING_CHANNEX_CURRENCY,
    STATUS.INVALID_CHANNEX_CURRENCY,
    STATUS.CHANNEX_UNAVAILABLE,
    STATUS.WOULD_SET,
    STATUS.ALREADY_SET,
    STATUS.PARTIAL_CHANNEX,
    STATUS.RATE_PLAN_NOT_FOUND,
    STATUS.NO_CHANNEX,
  ];

  for (const status of statusOrder) {
    const group = grouped[status];
    if (!group || group.length === 0) continue;
    console.log(`── ${status} (${group.length}) ${'─'.repeat(Math.max(0, 48 - status.length - String(group.length).length - 5))}`);
    for (const rec of group) {
      console.log(formatLine(rec));
    }
    console.log();
  }

  // ── Aggregate summary ────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════');
  console.log('  AGGREGATE SUMMARY');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Total properties:          ${counters.total}`);
  console.log();
  console.log('  By segment:');
  for (const [seg, count] of Object.entries(counters.bySegment)) {
    if (count > 0) console.log(`    ${seg.padEnd(30)} ${count}`);
  }
  console.log();
  console.log('  By reconciliation status:');
  for (const [st, count] of Object.entries(counters.byStatus)) {
    if (count > 0) {
      const flag = (st === STATUS.CONFLICT || st === STATUS.MISSING_CHANNEX_CURRENCY || st === STATUS.INVALID_CHANNEX_CURRENCY)
        ? '  ⚠'
        : '';
      console.log(`    ${st.padEnd(30)} ${count}${flag}`);
    }
  }
  console.log();
  console.log('  Key indicators:');
  console.log(`    Requires human review:     ${counters.requiresHumanReview}`);
  console.log(`    WOULD_SET (B3D eligible):  ${counters.wouldSet}`);
  console.log(`    ALREADY_SET:               ${counters.alreadySet}`);
  console.log(`    CONFLICT:                  ${counters.conflict}`);
  console.log(`    CHANNEX_UNAVAILABLE:       ${counters.channexUnavailable}`);
  console.log();

  if (counters.requiresHumanReview > 0) {
    console.log('  ⚠  HUMAN REVIEW REQUIRED before B3D can proceed.');
  } else if (counters.channexUnavailable > 0) {
    console.log('  ℹ  Some Channex reads failed — re-run to confirm before B3D.');
  } else {
    console.log('  ✓  No human-review flags raised.');
  }
  console.log('═══════════════════════════════════════════════════════\n');

  // ── Optional JSON output ─────────────────────────────────────────────────────
  if (emitJson) {
    const json = {
      runAt: new Date().toISOString(),
      totalProperties: counters.total,
      withRatePlan: withRatePlan.length,
      withoutRatePlan: withoutRatePlan.length,
      bySegment: counters.bySegment,
      byStatus: counters.byStatus,
      localCurrencyNull: counters.localCurrencyNull,
      localCurrencySet: counters.localCurrencySet,
      channexEUR: counters.channexEUR,
      channexGBP: counters.channexGBP,
      channexUSD: counters.channexUSD,
      channexOther: counters.channexOther,
      externalPricingCount: counters.externalPricingCount,
      boostPriceActiveCount: counters.boostPriceActiveCount,
      requiresHumanReview: counters.requiresHumanReview,
      wouldSet: counters.wouldSet,
      alreadySet: counters.alreadySet,
      conflict: counters.conflict,
      channexUnavailable: counters.channexUnavailable,
      b3dSafeAutoSetCount: counters.b3dSafeAutoSetIds.length,
      b3dSafeAutoSetIds: counters.b3dSafeAutoSetIds,
    };
    console.log('JSON:' + JSON.stringify(json));
  }

  process.exit(counters.requiresHumanReview > 0 ? 2 : 0);
})();
