#!/usr/bin/env node
'use strict';
require('dotenv').config();
/**
 * P1.2-B3D — Final Post-Apply Verification
 *
 * READ-ONLY. No DB writes. No Channex writes.
 *
 * Sections:
 *   1 — Connected property currency counts (channex_enabled=true)
 *   2 — B3D idempotency (eligible population must be 0)
 *   3 — St-Ouen state verification
 *   4 — Full currency distribution across all 48 properties
 *
 * Usage:
 *   node outils/verify-b3d-final.js
 */

const { Pool } = require('pg');

function makePool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  return new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
}

function tf(v) { return v === true ? 'true' : v === false ? 'false' : 'NULL'; }
function pres(v) { return v ? 'PRESENT' : 'NULL/absent'; }

(async () => {
  const pool = makePool();

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  P1.2-B3D — Final Post-Apply Verification');
  console.log('  READ-ONLY. DB_WRITES = 0. CHANNEX_WRITES = 0.');
  console.log('═══════════════════════════════════════════════════════\n');

  try {
    // ── Section 1: Connected property currency counts ──────────────────────────
    console.log('  ── SECTION 1: CONNECTED PROPERTY CURRENCIES ──────────────────\n');

    const s1 = await pool.query(`
      SELECT
        COUNT(*)                                                                                 AS total,
        COUNT(*) FILTER (WHERE channex_enabled = true)                                          AS enabled_true,
        COUNT(*) FILTER (WHERE channex_enabled = false OR channex_enabled IS NULL)              AS enabled_false_or_null,
        COUNT(*) FILTER (WHERE channex_enabled = true AND currency = 'EUR')                     AS enabled_eur,
        COUNT(*) FILTER (WHERE channex_enabled = true AND currency = 'GBP')                     AS enabled_gbp,
        COUNT(*) FILTER (WHERE channex_enabled = true AND currency = 'USD')                     AS enabled_usd,
        COUNT(*) FILTER (WHERE channex_enabled = true AND currency IS NOT NULL
                          AND currency NOT IN ('EUR','GBP','USD'))                              AS enabled_other,
        COUNT(*) FILTER (WHERE channex_enabled = true AND currency IS NULL)                     AS enabled_null,
        COUNT(*) FILTER (WHERE channex_enabled = true AND channex_rate_plan_id IS NOT NULL)     AS enabled_with_rate_plan,
        COUNT(*) FILTER (WHERE channex_enabled = true AND channex_rate_plan_id IS NULL)         AS enabled_without_rate_plan
      FROM properties
    `);
    const c1 = s1.rows[0];

    console.log(`    TOTAL_PROPERTIES            = ${c1.total}`);
    console.log(`    CHANNEX_ENABLED_TRUE         = ${c1.enabled_true}`);
    console.log(`    CHANNEX_ENABLED_FALSE_OR_NULL= ${c1.enabled_false_or_null}`);
    console.log();
    console.log(`    CONNECTED_CURRENCY_EUR       = ${c1.enabled_eur}`);
    console.log(`    CONNECTED_CURRENCY_GBP       = ${c1.enabled_gbp}`);
    console.log(`    CONNECTED_CURRENCY_USD       = ${c1.enabled_usd}`);
    console.log(`    CONNECTED_CURRENCY_OTHER     = ${c1.enabled_other}`);
    console.log(`    CONNECTED_CURRENCY_NULL      = ${c1.enabled_null}`);
    console.log();
    console.log(`    ENABLED_WITH_RATE_PLAN       = ${c1.enabled_with_rate_plan}`);
    console.log(`    ENABLED_WITHOUT_RATE_PLAN    = ${c1.enabled_without_rate_plan}`);

    if (parseInt(c1.enabled_null, 10) > 0) {
      console.log(`\n    ⚠  ${c1.enabled_null} connected propertie(s) still have currency=NULL`);
      const nullProps = await pool.query(`
        SELECT id, COALESCE(internal_name, name, id) AS display_name,
               channex_rate_plan_id IS NOT NULL AS has_rate_plan
        FROM properties
        WHERE channex_enabled = true AND currency IS NULL
        ORDER BY display_name
      `);
      for (const r of nullProps.rows) {
        console.log(`      …${String(r.id).slice(-8)}  ${String(r.display_name).slice(0,40)}  has_rate_plan=${r.has_rate_plan}`);
      }
    } else {
      console.log(`\n    ✓ CONNECTED_CURRENCY_NULL = 0 — all connected properties have currency set`);
    }

    // ── Section 2: B3D idempotency check ──────────────────────────────────────
    console.log('\n  ── SECTION 2: B3D IDEMPOTENCY (eligible population) ───────────\n');

    const s2 = await pool.query(`
      SELECT COUNT(*) AS eligible
      FROM properties
      WHERE channex_enabled = true
        AND currency IS NULL
        AND channex_rate_plan_id IS NOT NULL
    `);
    const eligible = parseInt(s2.rows[0].eligible, 10);
    console.log(`    B3D_ELIGIBLE_AFTER_APPLY     = ${eligible}`);
    if (eligible === 0) {
      console.log(`    B3D_IDEMPOTENT               = YES ✓`);
    } else {
      console.log(`    B3D_IDEMPOTENT               = NO ⚠  — ${eligible} propertie(s) still eligible`);
      const stillElig = await pool.query(`
        SELECT id, COALESCE(internal_name, name, id) AS display_name
        FROM properties
        WHERE channex_enabled = true AND currency IS NULL AND channex_rate_plan_id IS NOT NULL
        ORDER BY display_name
      `);
      for (const r of stillElig.rows) {
        console.log(`      …${String(r.id).slice(-8)}  ${String(r.display_name).slice(0,40)}`);
      }
    }

    // ── Section 3: St-Ouen state ───────────────────────────────────────────────
    console.log('\n  ── SECTION 3: ST-OUEN STATE ────────────────────────────────────\n');

    const s3 = await pool.query(`
      SELECT
        id,
        COALESCE(internal_name, name, id) AS display_name,
        channex_enabled,
        channex_property_id,
        channex_property_id_ext,
        channex_room_type_id,
        channex_rate_plan_id,
        channex_markup_rate_plans,
        currency,
        (channex_enabled = true
         AND currency IS NULL
         AND channex_rate_plan_id IS NOT NULL) AS b3d_eligible
      FROM properties
      WHERE LOWER(COALESCE(internal_name, name, '')) LIKE '%st-ouen%'
    `);

    console.log(`    SEARCH "st-ouen" → ${s3.rows.length} result(s)`);

    if (s3.rows.length === 0) {
      console.log('    ⚠  No St-Ouen property found — verify name/search term');
    } else {
      for (const r of s3.rows) {
        console.log(`\n    …${String(r.id).slice(-8)}  ${String(r.display_name).slice(0,40)}`);
        console.log(`      channex_enabled:           ${tf(r.channex_enabled)}`);
        console.log(`      channex_property_id:       ${pres(r.channex_property_id)}`);
        console.log(`      channex_property_id_ext:   ${pres(r.channex_property_id_ext)}`);
        console.log(`      channex_room_type_id:      ${pres(r.channex_room_type_id)}`);
        console.log(`      channex_rate_plan_id:      ${pres(r.channex_rate_plan_id)}`);
        console.log(`      channex_markup_rate_plans: ${pres(r.channex_markup_rate_plans)}`);
        console.log(`      currency:                  ${r.currency || 'NULL'}`);
        console.log(`      B3D_ELIGIBLE:              ${r.b3d_eligible ? 'YES ⚠' : 'no ✓'}`);

        const expected = (
          r.channex_enabled === false &&
          r.channex_property_id === null &&
          r.channex_room_type_id === null &&
          r.channex_rate_plan_id === null
        );
        console.log(`\n      ST_OUEN_RESET_VERIFIED:    ${expected ? 'YES ✓' : 'NO ⚠  — some IDs still present or enabled=true'}`);
      }
    }

    // ── Section 4: Full currency distribution ─────────────────────────────────
    console.log('\n  ── SECTION 4: FULL CURRENCY DISTRIBUTION (all properties) ─────\n');

    const s4 = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE currency IS NULL)                                       AS currency_null,
        COUNT(*) FILTER (WHERE currency = 'EUR')                                       AS currency_eur,
        COUNT(*) FILTER (WHERE currency = 'GBP')                                       AS currency_gbp,
        COUNT(*) FILTER (WHERE currency = 'USD')                                       AS currency_usd,
        COUNT(*) FILTER (WHERE currency IS NOT NULL AND currency NOT IN ('EUR','GBP','USD')) AS currency_other,
        COUNT(*)                                                                        AS total
      FROM properties
    `);
    const c4 = s4.rows[0];

    console.log(`    ALL_PROPERTIES_TOTAL         = ${c4.total}`);
    console.log(`    ALL_PROPERTIES_CURRENCY_NULL = ${c4.currency_null}`);
    console.log(`    ALL_PROPERTIES_CURRENCY_EUR  = ${c4.currency_eur}`);
    console.log(`    ALL_PROPERTIES_CURRENCY_GBP  = ${c4.currency_gbp}`);
    console.log(`    ALL_PROPERTIES_CURRENCY_USD  = ${c4.currency_usd}`);
    console.log(`    ALL_PROPERTIES_CURRENCY_OTHER= ${c4.currency_other}`);

    const disabledWithCurrency = await pool.query(`
      SELECT
        COALESCE(internal_name, name, id) AS display_name,
        '…' || RIGHT(id::text, 8) AS id_suffix,
        currency,
        channex_enabled
      FROM properties
      WHERE currency IS NOT NULL
        AND (channex_enabled = false OR channex_enabled IS NULL)
      ORDER BY display_name
    `);

    console.log(`\n    DISABLED_WITH_CURRENCY       = ${disabledWithCurrency.rows.length}`);
    if (disabledWithCurrency.rows.length === 0) {
      console.log('    ✓ No disabled property has a non-NULL currency');
    } else {
      console.log('    ⚠  Disabled properties with currency set (read-only visibility):');
      for (const r of disabledWithCurrency.rows) {
        console.log(`      ${r.id_suffix}  ${String(r.display_name).slice(0,40).padEnd(40)}  currency=${r.currency}  channex_enabled=${tf(r.channex_enabled)}`);
      }
    }

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  DB_WRITES = 0  |  CHANNEX_WRITES = 0');
    console.log('═══════════════════════════════════════════════════════\n');

  } finally {
    await pool.end();
  }
})();
