'use strict';
/**
 * P1.2-B5-BK-P12 — Market Shared Profiles Audit (READ ONLY)
 *
 * Queries market_profiles and market_profile_properties to show the current
 * state of the profile/property mapping. No writes. No network. No pricing.
 *
 * ABSOLUTE SAFETY:
 *   DB_WRITES              = 0  read-only SELECT queries only
 *   NETWORK_CALLS          = 0  (DB connect only)
 *   PRODUCTION_WRITES      = 0  read-only
 *   PRICING_WRITES         = 0  always
 *   CHANNEX_CALLS          = 0  always
 *   SAFE_TO_ACTIVATE       = NO (audit only, does not activate anything)
 *
 * Usage:
 *   node outils/audit-market-shared-profiles-p.js
 */

const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  P12 — Market Shared Profiles Audit (READ ONLY)');
  console.log('══════════════════════════════════════════════════════════════\n');

  // ── A. Profile count ───────────────────────────────────────────────────────
  const profileCount = (await pool.query(
    `SELECT COUNT(*) AS cnt FROM market_profiles`
  )).rows[0].cnt;

  console.log(`  market_profiles rows: ${profileCount}`);

  // ── B. Profile → property mapping count ───────────────────────────────────
  const mappingCount = (await pool.query(
    `SELECT COUNT(*) AS cnt FROM market_profile_properties`
  )).rows[0].cnt;

  console.log(`  market_profile_properties rows: ${mappingCount}`);

  // ── C. Profiles with multiple properties (shared market) ──────────────────
  const shared = (await pool.query(
    `SELECT profile_id, COUNT(*) AS prop_count
       FROM market_profile_properties
      GROUP BY profile_id
      HAVING COUNT(*) > 1
      ORDER BY prop_count DESC
      LIMIT 20`
  )).rows;

  if (shared.length > 0) {
    console.log(`\n  Profiles shared by multiple properties (top ${shared.length}):`);
    for (const row of shared) {
      console.log(`    ${row.profile_id}  →  ${row.prop_count} properties`);
    }
  } else {
    console.log('  No profiles shared by multiple properties yet.');
  }

  // ── D. Recent profiles ─────────────────────────────────────────────────────
  const recent = (await pool.query(
    `SELECT mp.profile_id, mp.geo_lat, mp.geo_lon, mp.currency,
            mp.target_guests, mp.target_bedrooms, mp.target_property_type,
            mp.created_at
       FROM market_profiles mp
      ORDER BY mp.created_at DESC
      LIMIT 10`
  )).rows;

  if (recent.length > 0) {
    console.log('\n  Most recent market_profiles (up to 10):');
    for (const r of recent) {
      console.log(
        `    ${r.profile_id}  lat=${r.geo_lat} lon=${r.geo_lon}` +
        ` cur=${r.currency} guests=${r.target_guests ?? '?'}` +
        ` bed=${r.target_bedrooms ?? '?'} type=${r.target_property_type}` +
        `  created=${r.created_at?.toISOString().slice(0, 19)}`
      );
    }
  } else {
    console.log('\n  No market_profiles rows yet (table empty — P not yet activated).');
  }

  // ── E. Properties without a profile assignment ─────────────────────────────
  const unassigned = (await pool.query(
    `SELECT p.id, p.name
       FROM properties p
       LEFT JOIN market_profile_properties mpp ON mpp.property_id = p.id::TEXT
      WHERE mpp.property_id IS NULL
      LIMIT 20`
  )).rows;

  if (unassigned.length > 0) {
    console.log(`\n  Properties without a market profile assignment (up to 20):`);
    for (const r of unassigned) {
      console.log(`    property_id=${r.id}  name="${r.name}"`);
    }
  } else {
    console.log('\n  All properties that have profiles are assigned (or table is empty).');
  }

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  Audit complete — no writes performed.');
  console.log('══════════════════════════════════════════════════════════════\n');
}

run()
  .catch(err => { console.error('Audit error:', err.message); process.exit(1); })
  .finally(() => pool.end());
