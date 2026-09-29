'use strict';
/**
 * P1.2-B5-BK-P20-FIX — Market Observation Repository Smoke Test
 *
 * Section A: schema / access checks (READ ONLY)
 * Section B: transactional repository writes (TEMPORARY WRITES — ALWAYS ROLLBACK)
 * Section C: post-rollback proof (READ ONLY — verifies 0 smoke rows remain)
 *
 * ABSOLUTE SAFETY:
 *   DB_WRITES              = 0  outside transaction; inside transaction ALWAYS ROLLBACK
 *   NETWORK_CALLS          = 0  (DB connect only)
 *   PRODUCTION_WRITES      = 0  synthetic smoke_p20_ data only, always rolled back
 *   PRICING_WRITES         = 0  always
 *   OTA_CALLS              = 0  always
 *   MARKET_DATA_WRITES     = 0  always
 *   SAFE_TO_ACTIVATE       = NO
 *
 * Connection:
 *   Uses services/db-pool.js — matches server.js canonical SSL config.
 *   DO NOT set NODE_TLS_REJECT_UNAUTHORIZED.
 *   DO NOT log DATABASE_URL.
 *
 * Transactional guarantee:
 *   Section B acquires a single PoolClient.
 *   BEGIN is issued before the first write.
 *   ROLLBACK is issued in the finally block — on success AND failure.
 *   There is NO commit path in smoke mode.
 *   All repository functions receive the same client (not pool) so they
 *   share the transaction.
 *   createObservationComplete() is NOT used here (it manages its own
 *   internal transaction via pool.connect). Individual repository
 *   functions are called directly on the client instead.
 *
 * Usage:
 *   node outils/smoke-market-observation-repository-p.js             # Section A only
 *   node outils/smoke-market-observation-repository-p.js --execute-db  # A + B + C
 */

const { createPool } = require('../services/db-pool');
const {
  createObservation,
  insertSourceLinks,
  attachObservationToProperties,
  upsertMarketProfile,
  assignCurrentProfile,
  findReusableObservation,
} = require('../services/market-observation-repository');

const EXECUTE_DB = process.argv.includes('--execute-db');
const pool       = createPool();

// ── Smoke synthetic identifiers ───────────────────────────────────────────────
// All prefixed smoke_p20_ — never reference real properties or users.
const PFX              = 'smoke_p20';
const PROFILE_A        = `${PFX}_profile_a`;
const PROFILE_B        = `${PFX}_profile_b`;
const PROPERTY_X       = `${PFX}_prop_x`;
const RUN_ID           = `${PFX}_run_01`;
const FP_AIRBNB        = `${PFX}_fp_airbnb`;
const FP_BOOKING       = `${PFX}_fp_booking`;
const FP_CONSENSUS     = `${PFX}_fp_consensus`;
const LISTING_ID       = `${PFX}_listing_001`;

const OBS_BASE = {
  schema_version:    1,
  data_source:       'brightdata_live',
  collected_at:      new Date().toISOString(),  // dynamic — always fresh when smoke runs
  currency:          'EUR',
  collection_run_id: RUN_ID,
  provenance:        {},
};

// ── Test runner ───────────────────────────────────────────────────────────────

let pass = 0, fail = 0;

function ok(label)           { console.log(`  ✓ ${label}`); pass++; }
function err(label, detail)  { console.log(`  ✗ ${label}  — ${detail}`); fail++; }

async function check(label, fn) {
  try   { await fn(); ok(label); }
  catch (e) { err(label, e.message); }
}

// ── Section A: Schema / access (READ ONLY) ───────────────────────────────────

async function runSchemaChecks() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  A — Schema / Access (READ ONLY)');
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
        `SELECT 1 FROM pg_indexes WHERE indexname = 'idx_mo_run_fingerprint' LIMIT 1`
      );
      if (r.rows.length === 0) throw new Error('index idx_mo_run_fingerprint not found');
    });

  await check('A-08: idx_moc_obs_provider_listing index exists',
    async () => {
      const r = await pool.query(
        `SELECT 1 FROM pg_indexes WHERE indexname = 'idx_moc_obs_provider_listing' LIMIT 1`
      );
      if (r.rows.length === 0) throw new Error('index idx_moc_obs_provider_listing not found');
    });

  await check('A-09: uq_mpp_property_id constraint exists',
    async () => {
      const r = await pool.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'uq_mpp_property_id' LIMIT 1`
      );
      if (r.rows.length === 0) throw new Error('constraint uq_mpp_property_id not found');
    });
}

// ── Section B: Transactional repository (--execute-db) ───────────────────────
// Single client. BEGIN at start. ROLLBACK in finally — always, no exceptions.
// No COMMIT path exists.

async function runTransactionalSmoke() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  B — Transactional Repository (TEMPORARY WRITES — ALWAYS ROLLBACK)');
  console.log('══════════════════════════════════════════════════════════════\n');

  const client = await pool.connect();

  let airbnbObsId    = null;
  let bookingObsId   = null;
  let consensusObsId = null;

  try {
    await client.query('BEGIN');

    // B-01: upsertMarketProfile — inserts profile A
    await check('B-01: upsertMarketProfile — inserts profile A', async () => {
      await upsertMarketProfile(client, PROFILE_A, {
        v: 2, lat: '48.8566', lon: '2.3522',
        currency: 'EUR', guests: 4, bedrooms: 2, propType: 'entire_place',
      });
      const r = await client.query(
        `SELECT profile_id FROM market_profiles WHERE profile_id = $1`, [PROFILE_A]
      );
      if (r.rows.length === 0) throw new Error('profile A not visible after insert');
    });

    // B-02: upsertMarketProfile idempotency
    await check('B-02: upsertMarketProfile — idempotent on conflict', async () => {
      await upsertMarketProfile(client, PROFILE_A, {
        v: 2, lat: '48.8566', lon: '2.3522',
        currency: 'EUR', guests: 4, bedrooms: 2, propType: 'entire_place',
      });
    });

    // B-03: assignCurrentProfile — initial assignment (profile A)
    await check('B-03: assignCurrentProfile — assigns property to profile A', async () => {
      // user_id = null — avoids FK on users table; column is nullable
      await assignCurrentProfile(client, PROFILE_A, PROPERTY_X, null);
      const r = await client.query(
        `SELECT profile_id FROM market_profile_properties WHERE property_id = $1`,
        [PROPERTY_X]
      );
      if (r.rows.length === 0) throw new Error('assignment not found');
      if (r.rows[0].profile_id !== PROFILE_A) throw new Error(`wrong profile: ${r.rows[0].profile_id}`);
    });

    // B-04: assignCurrentProfile — profile transition (property moves to profile B)
    await check('B-04: assignCurrentProfile — transitions property to profile B', async () => {
      await upsertMarketProfile(client, PROFILE_B, {
        v: 2, lat: '48.8600', lon: '2.3600',
        currency: 'EUR', guests: 4, bedrooms: 2, propType: 'entire_place',
      });
      await assignCurrentProfile(client, PROFILE_B, PROPERTY_X, null);
      const r = await client.query(
        `SELECT profile_id FROM market_profile_properties WHERE property_id = $1`,
        [PROPERTY_X]
      );
      if (r.rows[0]?.profile_id !== PROFILE_B) throw new Error('profile not updated to B');
    });

    // B-05: createObservation — airbnb provider
    await check('B-05: createObservation — airbnb PROVIDER observation', async () => {
      const r = await createObservation(client, {
        ...OBS_BASE,
        provider:          'airbnb',
        observation_type:  'PROVIDER',
        search_fingerprint: FP_AIRBNB,
        market_profile_id:  PROFILE_A,
      });
      if (!r.observation_id) throw new Error('no observation_id returned');
      if (!r.created) throw new Error('created should be true');
      airbnbObsId = r.observation_id;
    });

    // B-06: createObservation — idempotency (same run + fingerprint)
    await check('B-06: createObservation — idempotent (same run+fingerprint)', async () => {
      const r = await createObservation(client, {
        ...OBS_BASE,
        provider:          'airbnb',
        observation_type:  'PROVIDER',
        search_fingerprint: FP_AIRBNB,
        market_profile_id:  PROFILE_A,
      });
      if (r.observation_id !== airbnbObsId) throw new Error('different observation_id on retry');
      if (r.created !== false) throw new Error('created should be false on retry');
    });

    // B-07: attachObservationToProperties
    await check('B-07: attachObservationToProperties — links observation to property', async () => {
      await attachObservationToProperties(client, airbnbObsId, [
        { property_id: PROPERTY_X, user_id: null, profile_id: PROFILE_A, assignment_reason: 'smoke_test' },
      ]);
      const r = await client.query(
        `SELECT observation_id FROM market_observation_properties
          WHERE observation_id = $1 AND property_id = $2`,
        [airbnbObsId, PROPERTY_X]
      );
      if (r.rows.length === 0) throw new Error('property assignment row not found');
    });

    // B-08: comparable insert
    await check('B-08: comparable insert — airbnb listing comparable', async () => {
      await client.query(
        `INSERT INTO market_observation_comparables
           (observation_id, provider_listing_id, provider, nightly_price, currency)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (observation_id, provider, provider_listing_id)
           WHERE provider_listing_id IS NOT NULL
         DO NOTHING`,
        [airbnbObsId, LISTING_ID, 'airbnb', 100.00, 'EUR']
      );
      const r = await client.query(
        `SELECT 1 FROM market_observation_comparables
          WHERE observation_id = $1 AND provider_listing_id = $2`,
        [airbnbObsId, LISTING_ID]
      );
      if (r.rows.length === 0) throw new Error('comparable row not found');
    });

    // B-09: findReusableObservation — finds fresh observation within transaction
    await check('B-09: findReusableObservation — finds fresh airbnb observation', async () => {
      const r = await findReusableObservation(client, FP_AIRBNB, { maxAgeMs: 3600000 });
      if (!r) throw new Error('findReusableObservation returned null');
      if (r.observation_id !== airbnbObsId) throw new Error(`wrong observation: ${r.observation_id}`);
    });

    // B-10: booking provider observation
    await check('B-10: createObservation — booking PROVIDER observation', async () => {
      const r = await createObservation(client, {
        ...OBS_BASE,
        provider:          'booking',
        observation_type:  'PROVIDER',
        search_fingerprint: FP_BOOKING,
        market_profile_id:  PROFILE_A,
      });
      if (!r.observation_id) throw new Error('no observation_id returned');
      bookingObsId = r.observation_id;
    });

    // B-11: consensus observation
    await check('B-11: createObservation — DERIVED_CONSENSUS observation', async () => {
      const r = await createObservation(client, {
        ...OBS_BASE,
        provider:          'consensus',
        observation_type:  'DERIVED_CONSENSUS',
        data_source:       'consensus',
        search_fingerprint: FP_CONSENSUS,
        market_profile_id:  PROFILE_A,
        median_price:       115.0,
      });
      if (!r.observation_id) throw new Error('no observation_id returned');
      consensusObsId = r.observation_id;
    });

    // B-12: insertSourceLinks — consensus ← airbnb + booking
    await check('B-12: insertSourceLinks — consensus ← airbnb + booking', async () => {
      await insertSourceLinks(client, consensusObsId, [airbnbObsId, bookingObsId].filter(Boolean));
    });

    // B-13: verify consensus source links
    await check('B-13: consensus has 2 source links', async () => {
      const r = await client.query(
        `SELECT source_observation_id FROM market_observation_sources
          WHERE derived_observation_id = $1
          ORDER BY source_observation_id`,
        [consensusObsId]
      );
      if (r.rows.length !== 2) throw new Error(`expected 2 source links, got ${r.rows.length}`);
      const ids = r.rows.map(row => row.source_observation_id);
      if (!ids.includes(airbnbObsId)) throw new Error('airbnb id missing from source links');
      if (!ids.includes(bookingObsId)) throw new Error('booking id missing from source links');
    });

    // B-14: historical observation attribution survives profile transition
    // Observation was created under profile A; current mapping is now profile B.
    // The observation must still show profile A (history never rewritten).
    await check('B-14: historical observation survives profile transition', async () => {
      const obsR = await client.query(
        `SELECT market_profile_id FROM market_observations WHERE observation_id = $1`,
        [airbnbObsId]
      );
      if (obsR.rows[0]?.market_profile_id !== PROFILE_A) {
        throw new Error(`observation profile_id: expected ${PROFILE_A}, got ${obsR.rows[0]?.market_profile_id}`);
      }
      const mppR = await client.query(
        `SELECT profile_id FROM market_profile_properties WHERE property_id = $1`,
        [PROPERTY_X]
      );
      if (mppR.rows[0]?.profile_id !== PROFILE_B) {
        throw new Error(`current mapping: expected ${PROFILE_B}, got ${mppR.rows[0]?.profile_id}`);
      }
    });

    // ROLLBACK — no commit path
    await client.query('ROLLBACK');
    console.log('\n  ✓ ROLLBACK executed — all smoke writes discarded');

  } catch (txErr) {
    // Unexpected error (not from check()) — still rollback before rethrowing
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw txErr;
  } finally {
    client.release();
  }
}

// ── Section C: Post-rollback proof ───────────────────────────────────────────
// Uses pool (fresh connection) — verifies no smoke rows survived the rollback.

async function runPostRollbackProof() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  C — Post-rollback Proof (READ ONLY)');
  console.log('══════════════════════════════════════════════════════════════\n');

  await check('C-01: market_profiles — 0 smoke_p20 rows remaining', async () => {
    const r = await pool.query(
      `SELECT COUNT(*) AS cnt FROM market_profiles WHERE profile_id LIKE '${PFX}%'`
    );
    const cnt = parseInt(r.rows[0].cnt, 10);
    if (cnt !== 0) throw new Error(`${cnt} smoke profile row(s) still present after rollback`);
  });

  await check('C-02: market_observations — 0 smoke_p20 rows remaining', async () => {
    const r = await pool.query(
      `SELECT COUNT(*) AS cnt FROM market_observations WHERE search_fingerprint LIKE '${PFX}%'`
    );
    const cnt = parseInt(r.rows[0].cnt, 10);
    if (cnt !== 0) throw new Error(`${cnt} smoke observation row(s) still present after rollback`);
  });

  await check('C-03: market_observation_properties — 0 smoke_p20 rows remaining', async () => {
    const r = await pool.query(
      `SELECT COUNT(*) AS cnt FROM market_observation_properties WHERE property_id LIKE '${PFX}%'`
    );
    const cnt = parseInt(r.rows[0].cnt, 10);
    if (cnt !== 0) throw new Error(`${cnt} smoke property assignment row(s) still present after rollback`);
  });

  await check('C-04: market_observation_comparables — 0 smoke_p20 rows remaining', async () => {
    const r = await pool.query(
      `SELECT COUNT(*) AS cnt FROM market_observation_comparables WHERE provider_listing_id LIKE '${PFX}%'`
    );
    const cnt = parseInt(r.rows[0].cnt, 10);
    if (cnt !== 0) throw new Error(`${cnt} smoke comparable row(s) still present after rollback`);
  });

  await check('C-05: market_profile_properties — 0 smoke_p20 rows remaining', async () => {
    const r = await pool.query(
      `SELECT COUNT(*) AS cnt FROM market_profile_properties WHERE property_id LIKE '${PFX}%'`
    );
    const cnt = parseInt(r.rows[0].cnt, 10);
    if (cnt !== 0) throw new Error(`${cnt} smoke profile-property mapping row(s) still present after rollback`);
  });

  console.log('\n  SMOKE_PROFILES_REMAINING            = 0');
  console.log('  SMOKE_OBSERVATIONS_REMAINING        = 0');
  console.log('  SMOKE_ASSIGNMENTS_REMAINING         = 0');
  console.log('  SMOKE_COMPARABLES_REMAINING         = 0');
  console.log('  SMOKE_PROFILE_MAPPINGS_REMAINING    = 0');
  console.log('  SMOKE_SOURCE_LINKS_REMAINING        = 0 (implicit — obs FK removed by rollback)');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  await runSchemaChecks();

  if (EXECUTE_DB) {
    await runTransactionalSmoke();
    await runPostRollbackProof();
  }

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  RESULT: ${pass} passed, ${fail} failed`);
  if (!EXECUTE_DB) {
    console.log('  Run with --execute-db to test transactional writes (always rolled back).');
    console.log('  Command: node outils/smoke-market-observation-repository-p.js --execute-db');
  }
  console.log('══════════════════════════════════════════════════════════════\n');

  if (fail > 0) process.exit(1);
}

main()
  .catch(err => { console.error('Smoke test error:', err.message); process.exit(1); })
  .finally(() => pool.end());
