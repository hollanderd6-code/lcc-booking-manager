#!/usr/bin/env node
'use strict';
require('dotenv').config();
/**
 * P1.2-B3D — Property Currency Backfill
 *
 * Sets properties.currency from Channex rate plan currency for
 * eligible properties. Eligibility is READ FRESH from production —
 * do not reuse any prior audit snapshot.
 *
 * Eligibility (WHERE clause for both SELECT and CAS UPDATE):
 *   channex_enabled = true   AND
 *   currency IS NULL          AND
 *   channex_rate_plan_id IS NOT NULL
 *
 * CAS guard ensures the mutation is safe even if state changes
 * between the Channex GET and the UPDATE:
 *   WHERE id = $propertyId
 *     AND user_id = $userId
 *     AND currency IS NULL
 *     AND channex_enabled = true
 *     AND channex_rate_plan_id = $capturedRatePlanId
 *
 * 0 rows returned → SKIPPED_RACE_OR_CHANGED_STATE (safe — no partial write)
 *
 * ONLY properties.currency is ever mutated.
 * channex_*, platform_markups, channex_markup_rate_plans are never touched.
 *
 * Usage:
 *   node outils/backfill-property-currency.js            (dry-run, default)
 *   node outils/backfill-property-currency.js --dry-run  (explicit)
 *   node outils/backfill-property-currency.js --apply    (WRITES — requires explicit flag)
 *   node outils/backfill-property-currency.js --apply --json
 *   node outils/backfill-property-currency.js --user <userId>  (restrict)
 *
 * Exit codes:
 *   0 — completed, no errors or skips worth noting
 *   1 — some Channex errors (SKIPPED_CHANNEX_ERROR > 0)
 *   2 — some CAS races detected (SKIPPED_RACE_OR_CHANGED_STATE > 0)
 */

const { Pool }                      = require('pg');
const { getChannexRatePlanCurrency } = require('../channex');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args        = process.argv.slice(2);
const applyMode   = args.includes('--apply');
const dryRun      = !applyMode;
const emitJson    = args.includes('--json');
const filterUser  = args.includes('--user') ? args[args.indexOf('--user') + 1] : null;

// ── Concurrency ───────────────────────────────────────────────────────────────
const MAX_CHANNEX_CONCURRENT = 3;

async function withConcurrency(tasks, maxConcurrent, processor) {
  if (tasks.length === 0) return [];
  const results = new Array(tasks.length);
  let nextIdx = 0;
  async function worker() {
    while (true) {
      const idx = nextIdx++;
      if (idx >= tasks.length) break;
      results[idx] = await processor(tasks[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(maxConcurrent, tasks.length) }, worker));
  return results;
}

// ── DB ────────────────────────────────────────────────────────────────────────
function makePool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  return new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
}

// ── Eligibility SELECT ────────────────────────────────────────────────────────
// Re-reads from production. Never reuses a prior B3C snapshot.
async function fetchEligibleProperties(pool, userId) {
  const sql = `
    SELECT id, user_id, channex_rate_plan_id,
           COALESCE(internal_name, name, id) AS display_name
    FROM properties
    WHERE channex_enabled = true
      AND currency IS NULL
      AND channex_rate_plan_id IS NOT NULL
      ${userId ? 'AND user_id = $1' : ''}
    ORDER BY id
  `;
  const params = userId ? [userId] : [];
  const res = await pool.query(sql, params);
  return res.rows;
}

// ── CAS UPDATE ────────────────────────────────────────────────────────────────
// Mutates ONLY properties.currency.
// All five conditions must hold at write time — any state change → 0 rows.
async function applyPropertyCurrency(pool, { propertyId, userId, capturedRatePlanId, currency }) {
  const res = await pool.query(`
    UPDATE properties
       SET currency = $1, updated_at = NOW()
     WHERE id = $2
       AND user_id = $3
       AND currency IS NULL
       AND channex_enabled = true
       AND channex_rate_plan_id = $4
    RETURNING id
  `, [currency, propertyId, userId, capturedRatePlanId]);
  return res.rowCount;
}

// ── Per-property processing ───────────────────────────────────────────────────
// getCurrency is injectable for tests (defaults to the real Channex reader).
async function processProperty(pool, property, { dryRun: isDryRun, getCurrency } = {}) {
  const reader     = getCurrency || getChannexRatePlanCurrency;
  const ratePlanId = property.channex_rate_plan_id;

  const channexResult = await reader(ratePlanId);

  if (!channexResult.ok) {
    return {
      outcome:   'SKIPPED_CHANNEX_ERROR',
      errorCode: channexResult.error,
      property,
    };
  }

  const currency = channexResult.currency;

  if (isDryRun) {
    return { outcome: 'WOULD_SET', currency, property };
  }

  const rowCount = await applyPropertyCurrency(pool, {
    propertyId:       property.id,
    userId:           property.user_id,
    capturedRatePlanId: ratePlanId,
    currency,
  });

  return {
    outcome:  rowCount > 0 ? 'APPLIED' : 'SKIPPED_RACE_OR_CHANGED_STATE',
    currency,
    property,
  };
}

// ── Output helpers ────────────────────────────────────────────────────────────
function tail(id) {
  return id ? ('…' + String(id).slice(-8)) : '(none)';
}

function formatResult(r) {
  const name     = String(r.property.display_name || r.property.id).slice(0, 38);
  const idTag    = tail(r.property.id);
  const currency = r.currency || '—';
  const note     = r.errorCode ? `(${r.errorCode})` : '';
  return `  [${r.outcome.padEnd(30)}] ${idTag}  ${name.padEnd(38)}  ${currency}  ${note}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  P1.2-B3D — Property Currency Backfill');
  if (dryRun) {
    console.log('  MODE: DRY-RUN (no writes). Pass --apply to write.');
  } else {
    console.log('  MODE: APPLY — writing properties.currency');
    console.log('  Only properties.currency is mutated.');
    console.log('  CAS guard active: 5-condition WHERE.');
  }
  if (filterUser) console.log(`  Filter: user_id = …${filterUser.slice(-8)}`);
  console.log('═══════════════════════════════════════════════════════\n');

  const pool = makePool();

  let properties;
  try {
    properties = await fetchEligibleProperties(pool, filterUser);
  } catch (e) {
    await pool.end();
    throw e;
  }

  console.log(`  Eligible properties (fresh read): ${properties.length}\n`);

  if (properties.length === 0) {
    console.log('  Nothing to do.\n');
    await pool.end();
    return;
  }

  process.stdout.write(`  ${dryRun ? 'Validating via' : 'Processing with'} Channex `);
  let done = 0;
  const results = await withConcurrency(properties, MAX_CHANNEX_CONCURRENT, async (property) => {
    const r = await processProperty(pool, property, { dryRun, getCurrency: getChannexRatePlanCurrency });
    done++;
    if (done % 5 === 0 || done === properties.length) process.stdout.write(`${done}/${properties.length} `);
    return r;
  });
  console.log('✓\n');

  await pool.end();

  // ── Per-property output ────────────────────────────────────────────────────
  const byOutcome = {};
  for (const r of results) {
    if (!byOutcome[r.outcome]) byOutcome[r.outcome] = [];
    byOutcome[r.outcome].push(r);
  }

  const printOrder = dryRun
    ? ['WOULD_SET', 'SKIPPED_CHANNEX_ERROR']
    : ['APPLIED', 'SKIPPED_RACE_OR_CHANGED_STATE', 'SKIPPED_CHANNEX_ERROR'];

  for (const outcome of printOrder) {
    const group = byOutcome[outcome];
    if (!group || group.length === 0) continue;
    console.log(`── ${outcome} (${group.length}) ${'─'.repeat(Math.max(0, 48 - outcome.length - String(group.length).length - 5))}`);
    for (const r of group) console.log(formatResult(r));
    console.log();
  }

  // ── Aggregate ──────────────────────────────────────────────────────────────
  const counts = {
    total:                       results.length,
    wouldSet:                    (byOutcome['WOULD_SET']                    || []).length,
    applied:                     (byOutcome['APPLIED']                      || []).length,
    skippedRaceOrChangedState:   (byOutcome['SKIPPED_RACE_OR_CHANGED_STATE']|| []).length,
    skippedChannexError:         (byOutcome['SKIPPED_CHANNEX_ERROR']        || []).length,
  };

  console.log('═══════════════════════════════════════════════════════');
  if (dryRun) {
    console.log(`  DRY-RUN SUMMARY`);
    console.log(`  Total eligible (fresh read): ${counts.total}`);
    console.log(`  WOULD_SET:                   ${counts.wouldSet}`);
    console.log(`  SKIPPED_CHANNEX_ERROR:       ${counts.skippedChannexError}`);
    console.log();
    if (counts.wouldSet === counts.total) {
      console.log('  ✓ All candidates validated. Safe to run --apply.');
    } else if (counts.skippedChannexError > 0) {
      console.log(`  ⚠  ${counts.skippedChannexError} Channex error(s). Re-run or investigate before --apply.`);
    }
  } else {
    console.log(`  APPLY SUMMARY`);
    console.log(`  Total eligible (fresh read): ${counts.total}`);
    console.log(`  APPLIED:                     ${counts.applied}`);
    console.log(`  SKIPPED_RACE_OR_CHANGED_STATE: ${counts.skippedRaceOrChangedState}`);
    console.log(`  SKIPPED_CHANNEX_ERROR:       ${counts.skippedChannexError}`);
  }
  console.log('═══════════════════════════════════════════════════════\n');

  if (emitJson) {
    const json = {
      runAt:   new Date().toISOString(),
      mode:    dryRun ? 'dry-run' : 'apply',
      ...counts,
      wouldSetIds:  (byOutcome['WOULD_SET']  || []).map(r => tail(r.property.id)),
      appliedIds:   (byOutcome['APPLIED']    || []).map(r => tail(r.property.id)),
      skippedIds:   (byOutcome['SKIPPED_RACE_OR_CHANGED_STATE'] || []).map(r => tail(r.property.id)),
      errorIds:     (byOutcome['SKIPPED_CHANNEX_ERROR'] || []).map(r => ({
        id:    tail(r.property.id),
        error: r.errorCode,
      })),
    };
    console.log('JSON:' + JSON.stringify(json));
  }

  const exitCode = counts.skippedChannexError > 0 ? 1
    : counts.skippedRaceOrChangedState > 0 ? 2
    : 0;
  process.exit(exitCode);
}

// ── Exports (for unit testing) ────────────────────────────────────────────────
module.exports = { fetchEligibleProperties, applyPropertyCurrency, processProperty };

if (require.main === module) {
  main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
}
