#!/usr/bin/env node
'use strict';
require('dotenv').config();
/**
 * ST-OUEN — Controlled Local Channex Hard Reset
 *
 * One-off cleanup script. Clears stale Channex connection metadata for the
 * property whose name contains "st-ouen" (case-insensitive).
 *
 * SCOPE — only these four columns may be mutated:
 *   channex_enabled       → false
 *   channex_property_id   → NULL
 *   channex_room_type_id  → NULL
 *   channex_rate_plan_id  → NULL
 *
 * NO remote Channex call. NO currency write. NO pricing write.
 * CHANNEX_WRITES = 0  |  CURRENCY_WRITES = 0  |  PRICING_WRITES = 0
 *
 * Usage:
 *   node outils/reset-stouen-channex.js              ← preview only (default)
 *   node outils/reset-stouen-channex.js --execute    ← performs the UPDATE
 *
 * Safe to rerun: if already clean the script detects and exits with 0 writes.
 *
 * Exit codes:
 *   0 — success or already clean
 *   1 — aborted (zero matches, multiple matches, shared property, or CAS race)
 */

const { Pool } = require('pg');

const executeMode = process.argv.includes('--execute');

function makePool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  return new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
}

function pres(v) { return v ? 'PRESENT' : 'NULL/absent'; }
function tf(v)   { return v ? 'true' : 'false'; }

// ── Phase 1: Find and validate the target ─────────────────────────────────────
async function findTarget(pool) {
  const res = await pool.query(`
    SELECT
      id, user_id,
      COALESCE(internal_name, name, id)   AS display_name,
      channex_enabled,
      channex_property_id,
      channex_room_type_id,
      channex_rate_plan_id,
      (channex_property_id_ext IS NOT NULL)                                               AS has_property_id_ext,
      (channex_markup_rate_plans IS NOT NULL AND channex_markup_rate_plans::text <> '{}') AS has_markup_rate_plans,
      currency,
      platform_markups
    FROM properties
    WHERE LOWER(COALESCE(internal_name, name, '')) LIKE '%st-ouen%'
  `);
  return res.rows;
}

// ── Phase 2: Sharing check ────────────────────────────────────────────────────
async function checkSharing(pool, channexPropertyId, ownId) {
  if (!channexPropertyId) return 0;
  const res = await pool.query(`
    SELECT COUNT(*)::int AS cnt
    FROM properties
    WHERE channex_property_id = $1
      AND id <> $2
  `, [channexPropertyId, ownId]);
  return res.rows[0].cnt;
}

// ── Phase 3: Post-state verification ─────────────────────────────────────────
async function readPostState(pool, propertyId) {
  const res = await pool.query(`
    SELECT
      channex_enabled,
      channex_property_id,
      channex_room_type_id,
      channex_rate_plan_id,
      channex_property_id_ext,
      (channex_markup_rate_plans IS NOT NULL AND channex_markup_rate_plans::text <> '{}') AS has_markup_rate_plans,
      currency,
      platform_markups
    FROM properties
    WHERE id = $1
  `, [propertyId]);
  return res.rows[0] || null;
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  ST-OUEN — Controlled Local Channex Hard Reset');
  console.log(executeMode
    ? '  MODE: EXECUTE — will write to DB'
    : '  MODE: PREVIEW — no writes (pass --execute to mutate)');
  console.log('  CHANNEX_WRITES = 0  |  CURRENCY_WRITES = 0');
  console.log('═══════════════════════════════════════════════════════\n');

  const pool = makePool();

  try {
    // ── Phase 1: Find target ───────────────────────────────────────────────────
    const rows = await findTarget(pool);

    console.log(`  TARGET SEARCH "st-ouen" → ${rows.length} result(s)`);

    if (rows.length === 0) {
      console.log('  ABORT: No property matching "st-ouen" found.');
      console.log('  TARGET_PROPERTY_COUNT = 0');
      process.exit(1);
    }
    if (rows.length > 1) {
      console.log('  ABORT: Multiple properties match "st-ouen". Narrow the search.');
      console.log(`  TARGET_PROPERTY_COUNT = ${rows.length}`);
      for (const r of rows) console.log(`    …${String(r.id).slice(-8)}  ${r.display_name}`);
      process.exit(1);
    }

    const t = rows[0];
    console.log(`  TARGET_PROPERTY_COUNT = 1`);
    console.log(`  Target: …${String(t.id).slice(-8)}  ${t.display_name}`);

    // ── Phase 2: Pre-state report ──────────────────────────────────────────────
    console.log('\n  PRE-STATE:');
    console.log(`    channex_enabled:           ${tf(t.channex_enabled)}`);
    console.log(`    channex_property_id:       ${pres(t.channex_property_id)}`);
    console.log(`    channex_room_type_id:      ${pres(t.channex_room_type_id)}`);
    console.log(`    channex_rate_plan_id:      ${pres(t.channex_rate_plan_id)}`);
    console.log(`    channex_property_id_ext:   ${pres(t.has_property_id_ext ? 'x' : null)}`);
    console.log(`    channex_markup_rate_plans: ${pres(t.has_markup_rate_plans ? 'x' : null)}`);
    console.log(`    currency:                  ${t.currency || 'NULL'}`);
    console.log(`    platform_markups:          ${JSON.stringify(t.platform_markups) || 'NULL'}`);

    // ── Already clean check (idempotent) ──────────────────────────────────────
    const alreadyClean = (
      t.channex_enabled === false &&
      t.channex_property_id === null &&
      t.channex_room_type_id === null &&
      t.channex_rate_plan_id === null
    );
    if (alreadyClean) {
      console.log('\n  ✓ Property is already clean. No writes needed.');
      console.log('  DB_ROWS_UPDATED = 0 (already clean)');
      process.exit(0);
    }

    // ── Phase 3: Sharing check ─────────────────────────────────────────────────
    const sharedCount = await checkSharing(pool, t.channex_property_id, t.id);
    console.log(`\n  SHARED_CHECK_BEFORE_WRITE: ${sharedCount} other propert(ies) share channex_property_id`);

    if (sharedCount > 0) {
      console.log('  ABORT_SHARED_CHANNEX_PROPERTY');
      console.log('  SHARED_CHECK_BEFORE_WRITE = SHARED — local clear unsafe for this channex_property_id');
      process.exit(1);
    }
    console.log('  SHARED_CHECK_BEFORE_WRITE = exclusive — safe to proceed');

    if (!executeMode) {
      console.log('\n  PREVIEW mode — no write performed.');
      console.log('  Would execute guarded UPDATE with:');
      console.log(`    WHERE id = '…${String(t.id).slice(-8)}'`);
      console.log(`      AND user_id = '…${String(t.user_id).slice(-8)}'`);
      console.log(`      AND channex_enabled = true`);
      console.log(`      AND channex_property_id = <captured>`);
      console.log(`      AND channex_room_type_id = <captured>`);
      console.log(`      AND channex_rate_plan_id = <captured>`);
      console.log('\n  Pass --execute to perform the actual update.');
      process.exit(0);
    }

    // ── Phase 4: Guarded UPDATE ────────────────────────────────────────────────
    console.log('\n  Executing guarded UPDATE…');

    const updateRes = await pool.query(`
      UPDATE properties
         SET channex_enabled     = false,
             channex_property_id  = NULL,
             channex_room_type_id = NULL,
             channex_rate_plan_id = NULL,
             updated_at           = NOW()
       WHERE id                  = $1
         AND user_id             = $2
         AND channex_enabled     = true
         AND channex_property_id  = $3
         AND channex_room_type_id = $4
         AND channex_rate_plan_id = $5
      RETURNING id, channex_enabled, channex_property_id,
                channex_room_type_id, channex_rate_plan_id, updated_at
    `, [t.id, t.user_id, t.channex_property_id, t.channex_room_type_id, t.channex_rate_plan_id]);

    console.log(`  DB_ROWS_UPDATED = ${updateRes.rowCount}`);

    if (updateRes.rowCount !== 1) {
      console.log('  ABORT_CHANGED_STATE: UPDATE returned 0 rows — state changed between SELECT and UPDATE.');
      console.log('  No partial writes. Safe to investigate and retry.');
      process.exit(1);
    }

    console.log('  ✓ UPDATE succeeded — 1 row modified.');

    // ── Phase 5: Post-state verification ──────────────────────────────────────
    const post = await readPostState(pool, t.id);

    console.log('\n  POST-STATE (fresh SELECT):');
    console.log(`    channex_enabled:           ${tf(post.channex_enabled)}`);
    console.log(`    channex_property_id:       ${pres(post.channex_property_id)}`);
    console.log(`    channex_room_type_id:      ${pres(post.channex_room_type_id)}`);
    console.log(`    channex_rate_plan_id:      ${pres(post.channex_rate_plan_id)}`);
    console.log(`    channex_property_id_ext:   ${pres(post.channex_property_id_ext)}`);
    console.log(`    channex_markup_rate_plans: ${pres(post.has_markup_rate_plans ? 'x' : null)}`);
    console.log(`    currency:                  ${post.currency || 'NULL'}`);
    console.log(`    platform_markups:          ${JSON.stringify(post.platform_markups) || 'NULL'}`);

    // Verify expected post-state
    const postOk = (
      post.channex_enabled     === false &&
      post.channex_property_id  === null  &&
      post.channex_room_type_id === null  &&
      post.channex_rate_plan_id === null  &&
      post.currency             === null
    );

    if (!postOk) {
      console.log('\n  ⚠  POST-STATE UNEXPECTED — manual verification required.');
      process.exit(1);
    }

    console.log('\n  ✓ Post-state verified: all four Channex fields cleared, currency untouched.');

    // Verify no other property was touched
    const otherModified = await pool.query(`
      SELECT COUNT(*)::int AS cnt
      FROM properties
      WHERE updated_at > NOW() - INTERVAL '10 seconds'
        AND id <> $1
    `, [t.id]);
    const otherCount = otherModified.rows[0].cnt;
    console.log(`  OTHER_PROPERTIES_CHANGED = ${otherCount === 0 ? '0 ✓' : otherCount + ' ⚠  INVESTIGATE'}`);

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  CLEANUP COMPLETE');
    console.log('  CHANNEX_WRITES = 0  |  CURRENCY_WRITES = 0');
    console.log('═══════════════════════════════════════════════════════\n');
    process.exit(0);

  } finally {
    await pool.end();
  }
})();
