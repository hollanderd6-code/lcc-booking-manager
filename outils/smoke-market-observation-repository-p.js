'use strict';
/**
 * P1.2-B5-BK-P20 — Market Observation Repository Smoke Test
 *
 * Verifies the new observation tables exist and the repository functions work
 * end-to-end against the real database.
 *
 * SAFE BY DEFAULT — read-only probe unless --execute-db is passed.
 *
 * ABSOLUTE SAFETY:
 *   DB_WRITES              = 0  unless --execute-db flag provided
 *   NETWORK_CALLS          = 0  (DB connect only)
 *   PRODUCTION_WRITES      = 0  test data only, isolated by test UUIDs
 *   PRICING_WRITES         = 0  always
 *   CHANNEX_CALLS          = 0  always
 *   MARKET_DATA_WRITES     = 0  always
 *   SAFE_TO_ACTIVATE       = NO
 *
 * Usage:
 *   node outils/smoke-market-observation-repository-p.js           # read-only check
 *   node outils/smoke-market-observation-repository-p.js --execute-db  # write + verify + cleanup
 */

const { Pool } = require('pg');
const {
  createObservation,
  insertSourceLinks,
  attachObservationToProperties,
  upsertMarketProfile,
  assignCurrentProfile,
  createObservationComplete,
  findReusableObservation,
} = require('../services/market-observation-repository');

const EXECUTE_DB = process.argv.includes('--execute-db');
const pool       = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Helpers ────────────────────────────────────────────────────────────────────

let pass = 0, fail = 0;

function ok(label) {
  console.log(`  ✓ ${label}`);
  pass++;
}

function err(label, detail = '') {
  console.log(`  ✗ ${label}${detail ? '  — ' + detail : ''}`);
  fail++;
}

async function check(label, fn) {
  try {
    await fn();
    ok(label);
  } catch (e) {
    err(label, e.message);
  }
}

// Minimal valid observation for testing
const TEST_PROFILE_ID = 'mp2_smoke_test_profile_0000000000000000000';
const TEST_OBS_BASE = {
  schema_version:    1,
  provider:          'airbnb',
  observation_type:  'PROVIDER',
  data_source:       'brightdata_live',
  collected_at:      new Date().toISOString(),
  search_fingerprint:'ms2_smoke_test_fp_000000000000000000000000000000',
  market_profile_id: TEST_PROFILE_ID,
  currency:          'EUR',
  collection_run_id: 'crun_smoke_test_s0',
  provenance:        {},
};

// ── Read-only probes ───────────────────────────────────────────────────────────

async function runReadOnly() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  P20 — Repository Smoke Test (READ ONLY)');
  console.log('══════════════════════════════════════════════════════════════\n');

  await check('A-01: market_profiles table accessible',
    async () => { await pool.query('SELECT 1 FROM market_profiles LIMIT 0'); });

  await check('A-02: market_profile_properties table accessible',
    async () => { await pool.query('SELECT 1 FROM market_profile_properties LIMIT 0'); });

  await check('A-03: market_observations table accessible',
    async () => { await pool.query('SELECT 1 FROM market_observations LIMIT 0'); });

  await check('A-04: market_observation_sources table accessible',
    async () => { await pool.query('SELECT 1 FROM market_observation_sources LIMIT 0'); });

  await check('A-05: market_observation_properties table accessible',
    async () => { await pool.query('SELECT 1 FROM market_observation_properties LIMIT 0'); });

  await check('A-06: market_observation_comparables table accessible',
    async () => { await pool.query('SELECT 1 FROM market_observation_comparables LIMIT 0'); });

  await check('A-07: idx_mo_run_fingerprint index exists',
    async () => {
      const r = await pool.query(
        `SELECT 1 FROM pg_indexes
          WHERE indexname = 'idx_mo_run_fingerprint' LIMIT 1`
      );
      if (r.rows.length === 0) throw new Error('index idx_mo_run_fingerprint not found');
    });

  await check('A-08: idx_moc_obs_provider_listing index exists',
    async () => {
      const r = await pool.query(
        `SELECT 1 FROM pg_indexes
          WHERE indexname = 'idx_moc_obs_provider_listing' LIMIT 1`
      );
      if (r.rows.length === 0) throw new Error('index idx_moc_obs_provider_listing not found');
    });

  await check('A-09: uq_mpp_property_id constraint exists',
    async () => {
      const r = await pool.query(
        `SELECT 1 FROM pg_constraint
          WHERE conname = 'uq_mpp_property_id' LIMIT 1`
      );
      if (r.rows.length === 0) throw new Error('constraint uq_mpp_property_id not found');
    });
}

// ── Write + verify + cleanup (--execute-db) ───────────────────────────────────

async function runWithWrites() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  P20 — Repository Smoke Test (--execute-db)');
  console.log('══════════════════════════════════════════════════════════════\n');

  const cleanupIds = [];

  try {
    // B-01: upsertMarketProfile
    await check('B-01: upsertMarketProfile — inserts new profile',
      async () => {
        await upsertMarketProfile(pool, TEST_PROFILE_ID, {
          v: 2, lat: '48.8566', lon: '2.3522',
          currency: 'EUR', guests: null, bedrooms: null, propType: 'entire_place',
        });
        const r = await pool.query(
          `SELECT profile_id FROM market_profiles WHERE profile_id = $1`, [TEST_PROFILE_ID]
        );
        if (r.rows.length === 0) throw new Error('profile not found after upsert');
      });

    // B-02: upsertMarketProfile idempotency
    await check('B-02: upsertMarketProfile — idempotent on conflict',
      async () => {
        await upsertMarketProfile(pool, TEST_PROFILE_ID, {
          v: 2, lat: '48.8566', lon: '2.3522',
          currency: 'EUR', guests: null, bedrooms: null, propType: 'entire_place',
        });
      });

    // B-03: createObservation
    let obsId1;
    await check('B-03: createObservation — inserts and returns observation_id',
      async () => {
        const r = await createObservation(pool, TEST_OBS_BASE);
        if (!r.observation_id) throw new Error('no observation_id returned');
        if (!r.created) throw new Error('created should be true');
        obsId1 = r.observation_id;
        cleanupIds.push(obsId1);
      });

    // B-04: createObservation idempotency
    await check('B-04: createObservation — idempotent (same run+fingerprint)',
      async () => {
        const r = await createObservation(pool, TEST_OBS_BASE);
        if (r.observation_id !== obsId1) throw new Error('different observation_id returned');
        if (r.created !== false) throw new Error('created should be false on retry');
      });

    // B-05: insertSourceLinks
    let obs2Id;
    await check('B-05: insertSourceLinks — writes to market_observation_sources',
      async () => {
        // Create a second (derived_consensus) observation as the derived one
        const r2 = await createObservation(pool, {
          ...TEST_OBS_BASE,
          provider:          'consensus',
          observation_type:  'DERIVED_CONSENSUS',
          data_source:       'consensus',
          search_fingerprint:'ms2_smoke_test_fp_cons00000000000000000000000',
          collection_run_id: 'crun_smoke_test_s0',
        });
        obs2Id = r2.observation_id;
        cleanupIds.push(obs2Id);

        await insertSourceLinks(pool, obs2Id, [obsId1]);

        const s = await pool.query(
          `SELECT 1 FROM market_observation_sources
            WHERE derived_observation_id = $1 AND source_observation_id = $2`,
          [obs2Id, obsId1]
        );
        if (s.rows.length === 0) throw new Error('source link not found');
      });

    // B-06: findReusableObservation
    await check('B-06: findReusableObservation — returns fresh observation',
      async () => {
        const r = await findReusableObservation(
          pool, 'ms2_smoke_test_fp_cons00000000000000000000000', { maxAgeMs: 60 * 60 * 1000 }
        );
        if (!r) throw new Error('no reusable observation found');
      });

    // B-07: assignCurrentProfile
    const smokePropertyId = 'smoke_prop_' + Date.now();
    await check('B-07: assignCurrentProfile — writes to market_profile_properties',
      async () => {
        await assignCurrentProfile(pool, TEST_PROFILE_ID, smokePropertyId);
        const r = await pool.query(
          `SELECT profile_id FROM market_profile_properties WHERE property_id = $1`,
          [smokePropertyId]
        );
        if (r.rows.length === 0) throw new Error('profile assignment not found');
        if (r.rows[0].profile_id !== TEST_PROFILE_ID) throw new Error('wrong profile_id');
      });

    // B-08: assignCurrentProfile updates on conflict
    const altProfileId = 'mp2_smoke_test_profile_alt00000000000000000';
    await check('B-08: assignCurrentProfile — updates profile on conflict (property moved profiles)',
      async () => {
        // Insert the alt profile first (needed for FK)
        await upsertMarketProfile(pool, altProfileId, {
          v: 2, lat: '48.8600', lon: '2.3600',
          currency: 'EUR', guests: null, bedrooms: null, propType: 'entire_place',
        });
        await assignCurrentProfile(pool, altProfileId, smokePropertyId);
        const r = await pool.query(
          `SELECT profile_id FROM market_profile_properties WHERE property_id = $1`,
          [smokePropertyId]
        );
        if (r.rows[0].profile_id !== altProfileId) throw new Error('profile_id not updated');
      });

  } finally {
    // ── Cleanup ─────────────────────────────────────────────────────────────
    console.log('\n  Cleaning up smoke test data...');
    try {
      // Delete in FK order
      if (cleanupIds.length > 0) {
        await pool.query(
          `DELETE FROM market_observation_sources
            WHERE derived_observation_id = ANY($1::uuid[]) OR source_observation_id = ANY($1::uuid[])`,
          [cleanupIds]
        );
        await pool.query(
          `DELETE FROM market_observation_properties WHERE observation_id = ANY($1::uuid[])`,
          [cleanupIds]
        );
        await pool.query(
          `DELETE FROM market_observation_comparables WHERE observation_id = ANY($1::uuid[])`,
          [cleanupIds]
        );
        await pool.query(
          `DELETE FROM market_observations WHERE observation_id = ANY($1::uuid[])`,
          [cleanupIds]
        );
      }
      await pool.query(
        `DELETE FROM market_profile_properties WHERE profile_id IN ($1, $2)`,
        [TEST_PROFILE_ID, 'mp2_smoke_test_profile_alt00000000000000000']
      );
      await pool.query(
        `DELETE FROM market_profiles WHERE profile_id IN ($1, $2)`,
        [TEST_PROFILE_ID, 'mp2_smoke_test_profile_alt00000000000000000']
      );
      console.log('  Cleanup complete.');
    } catch (cleanupErr) {
      console.error('  Cleanup error (non-fatal):', cleanupErr.message);
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  await runReadOnly();
  if (EXECUTE_DB) await runWithWrites();

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  RESULT: ${pass} passed, ${fail} failed`);
  if (!EXECUTE_DB) {
    console.log('  Run with --execute-db to also test writes (and clean up after).');
  }
  console.log('══════════════════════════════════════════════════════════════\n');

  if (fail > 0) process.exit(1);
}

main()
  .catch(err => { console.error('Smoke test error:', err.message); process.exit(1); })
  .finally(() => pool.end());
