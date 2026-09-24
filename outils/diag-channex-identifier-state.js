#!/usr/bin/env node
'use strict';
require('dotenv').config();
/**
 * P1.2-B3C-R2 — Channex Identifier State Diagnostic
 *
 * READ-ONLY. No DB writes. No Channex writes.
 *
 * Reports:
 *   - Counts by channex_enabled + presence of each Channex identifier
 *   - Properties with stale identifiers (disabled + IDs present)
 *   - St-Ouen or any named property inspection (via --name)
 *
 * Usage:
 *   node outils/diag-channex-identifier-state.js
 *   node outils/diag-channex-identifier-state.js --name "St-Ouen"
 */

const { Pool } = require('pg');

const args        = process.argv.slice(2);
const nameFilter  = args[args.indexOf('--name') + 1] || null;

function makePool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  return new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
}

function tf(v) { return v ? 'true' : 'false'; }
function pres(v) { return v ? 'PRESENT' : 'absent'; }

(async () => {
  const pool = makePool();

  try {
    // ── 1. Aggregate counts ────────────────────────────────────────────────────
    const counts = await pool.query(`
      SELECT
        COUNT(*)                                                        AS total,
        COUNT(*) FILTER (WHERE channex_enabled = true)                  AS enabled_true,
        COUNT(*) FILTER (WHERE channex_enabled = false OR channex_enabled IS NULL) AS enabled_false,
        COUNT(*) FILTER (WHERE channex_enabled = true  AND channex_rate_plan_id IS NOT NULL) AS enabled_with_rate_plan,
        COUNT(*) FILTER (WHERE (channex_enabled = false OR channex_enabled IS NULL) AND channex_rate_plan_id IS NOT NULL) AS disabled_with_rate_plan,
        COUNT(*) FILTER (WHERE (channex_enabled = false OR channex_enabled IS NULL) AND channex_property_id IS NOT NULL) AS disabled_with_property_id,
        COUNT(*) FILTER (WHERE (channex_enabled = false OR channex_enabled IS NULL) AND channex_room_type_id IS NOT NULL) AS disabled_with_room_type_id,
        COUNT(*) FILTER (WHERE (channex_enabled = false OR channex_enabled IS NULL) AND channex_markup_rate_plans IS NOT NULL AND channex_markup_rate_plans::text <> '{}') AS disabled_with_markup_rate_plans
      FROM properties
    `);

    const c = counts.rows[0];
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  P1.2-B3C-R2 — Channex Identifier State Diagnostic');
    console.log('  READ-ONLY. No writes.');
    console.log('═══════════════════════════════════════════════════════\n');

    console.log('  AGGREGATE COUNTS:');
    console.log(`    total                         ${c.total}`);
    console.log(`    channex_enabled = true        ${c.enabled_true}`);
    console.log(`    channex_enabled = false/null  ${c.enabled_false}`);
    console.log();
    console.log(`    ENABLED + rate_plan           ${c.enabled_with_rate_plan}`);
    console.log(`    DISABLED + rate_plan          ${c.disabled_with_rate_plan}  ← stale candidates`);
    console.log(`    DISABLED + property_id        ${c.disabled_with_property_id}`);
    console.log(`    DISABLED + room_type_id       ${c.disabled_with_room_type_id}`);
    console.log(`    DISABLED + markup_rate_plans  ${c.disabled_with_markup_rate_plans}`);

    // ── 2. Disabled properties with rate_plan_id (stale candidates) ────────────
    if (parseInt(c.disabled_with_rate_plan, 10) > 0) {
      const stale = await pool.query(`
        SELECT
          id,
          COALESCE(internal_name, name, id) AS display_name,
          channex_enabled,
          (channex_property_id IS NOT NULL)     AS has_property_id,
          (channex_property_id_ext IS NOT NULL) AS has_property_id_ext,
          (channex_room_type_id IS NOT NULL)    AS has_room_type_id,
          (channex_rate_plan_id IS NOT NULL)    AS has_rate_plan_id,
          (channex_markup_rate_plans IS NOT NULL AND channex_markup_rate_plans::text <> '{}') AS has_markup_rate_plans,
          currency
        FROM properties
        WHERE (channex_enabled = false OR channex_enabled IS NULL)
          AND channex_rate_plan_id IS NOT NULL
        ORDER BY display_name
      `);

      console.log('\n  DISABLED WITH RATE_PLAN (stale candidates):');
      for (const row of stale.rows) {
        const idSuffix = '…' + String(row.id).slice(-8);
        const name     = String(row.display_name).slice(0, 40);
        console.log(`\n    [${idSuffix}] ${name}`);
        console.log(`      channex_enabled:        ${tf(row.channex_enabled)}`);
        console.log(`      channex_property_id:    ${pres(row.has_property_id)}`);
        console.log(`      channex_property_id_ext:${pres(row.has_property_id_ext)}`);
        console.log(`      channex_room_type_id:   ${pres(row.has_room_type_id)}`);
        console.log(`      channex_rate_plan_id:   ${pres(row.has_rate_plan_id)}`);
        console.log(`      channex_markup_rate_plans: ${pres(row.has_markup_rate_plans)}`);
        console.log(`      properties.currency:    ${row.currency || 'NULL'}`);
      }
    }

    // ── 3. Named property inspection ─────────────────────────────────────────
    if (nameFilter) {
      const named = await pool.query(`
        SELECT
          id,
          COALESCE(internal_name, name, id) AS display_name,
          channex_enabled,
          (channex_property_id IS NOT NULL)     AS has_property_id,
          (channex_property_id_ext IS NOT NULL) AS has_property_id_ext,
          (channex_room_type_id IS NOT NULL)    AS has_room_type_id,
          (channex_rate_plan_id IS NOT NULL)    AS has_rate_plan_id,
          (channex_markup_rate_plans IS NOT NULL AND channex_markup_rate_plans::text <> '{}') AS has_markup_rate_plans,
          currency
        FROM properties
        WHERE LOWER(COALESCE(internal_name, name, '')) LIKE LOWER($1)
        ORDER BY display_name
      `, [`%${nameFilter}%`]);

      console.log(`\n  NAMED SEARCH: "${nameFilter}" → ${named.rows.length} result(s)`);
      for (const row of named.rows) {
        const idSuffix = '…' + String(row.id).slice(-8);
        const name     = String(row.display_name).slice(0, 40);
        console.log(`\n    [${idSuffix}] ${name}`);
        console.log(`      channex_enabled:           ${tf(row.channex_enabled)}`);
        console.log(`      channex_property_id:       ${pres(row.has_property_id)}`);
        console.log(`      channex_property_id_ext:   ${pres(row.has_property_id_ext)}`);
        console.log(`      channex_room_type_id:      ${pres(row.has_room_type_id)}`);
        console.log(`      channex_rate_plan_id:      ${pres(row.has_rate_plan_id)}`);
        console.log(`      channex_markup_rate_plans: ${pres(row.has_markup_rate_plans)}`);
        console.log(`      properties.currency:       ${row.currency || 'NULL'}`);
      }
    }

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  DB_WRITES = 0  |  CHANNEX_WRITES = 0');
    console.log('═══════════════════════════════════════════════════════\n');

  } finally {
    await pool.end();
  }
})();
