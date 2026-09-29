'use strict';
/**
 * P1.2-B5-BK-P14 — Market Observations Audit (READ ONLY)
 *
 * Queries the market observation tables to show the current state:
 *   market_observations, market_observation_sources,
 *   market_observation_properties, market_observation_comparables
 *
 * ABSOLUTE SAFETY:
 *   DB_WRITES              = 0  read-only SELECT queries only
 *   NETWORK_CALLS          = 0  (DB connect only)
 *   PRODUCTION_WRITES      = 0  read-only
 *   PRICING_WRITES         = 0  always
 *   CHANNEX_CALLS          = 0  always
 *   SAFE_TO_ACTIVATE       = NO (audit only)
 *
 * Usage:
 *   node outils/audit-market-observations-p.js
 */

const { createPool } = require('../services/db-pool');

const pool = createPool();

async function run() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  P14 — Market Observations Audit (READ ONLY)');
  console.log('══════════════════════════════════════════════════════════════\n');

  // ── A. Row counts ──────────────────────────────────────────────────────────
  const counts = (await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM market_observations)            AS observations,
      (SELECT COUNT(*) FROM market_observation_sources)     AS sources,
      (SELECT COUNT(*) FROM market_observation_properties)  AS properties,
      (SELECT COUNT(*) FROM market_observation_comparables) AS comparables
  `)).rows[0];

  console.log('  Row counts:');
  console.log(`    market_observations:            ${counts.observations}`);
  console.log(`    market_observation_sources:     ${counts.sources}`);
  console.log(`    market_observation_properties:  ${counts.properties}`);
  console.log(`    market_observation_comparables: ${counts.comparables}`);

  // ── B. Observations by provider ────────────────────────────────────────────
  const byProvider = (await pool.query(`
    SELECT provider, observation_type, COUNT(*) AS cnt
      FROM market_observations
     GROUP BY provider, observation_type
     ORDER BY provider, observation_type
  `)).rows;

  if (byProvider.length > 0) {
    console.log('\n  Observations by provider + type:');
    for (const r of byProvider) {
      console.log(`    ${r.provider.padEnd(12)} ${r.observation_type.padEnd(20)} ${r.cnt}`);
    }
  } else {
    console.log('\n  No observations yet (table empty — P not yet activated).');
  }

  // ── C. Observations by market_status (quality_status) ─────────────────────
  const byStatus = (await pool.query(`
    SELECT quality_status, COUNT(*) AS cnt
      FROM market_observations
     GROUP BY quality_status
     ORDER BY cnt DESC
  `)).rows;

  if (byStatus.length > 0) {
    console.log('\n  Observations by quality_status:');
    for (const r of byStatus) {
      console.log(`    ${(r.quality_status ?? 'NULL').padEnd(25)} ${r.cnt}`);
    }
  }

  // ── D. Recent observations ─────────────────────────────────────────────────
  const recent = (await pool.query(`
    SELECT observation_id, provider, observation_type, quality_status,
           median_price, currency, check_in, collected_at, collection_run_id
      FROM market_observations
     ORDER BY collected_at DESC
     LIMIT 10
  `)).rows;

  if (recent.length > 0) {
    console.log('\n  Most recent observations (up to 10):');
    for (const r of recent) {
      console.log(
        `    ${r.observation_id.slice(0, 8)}…` +
        ` provider=${r.provider.padEnd(9)}` +
        ` type=${r.observation_type.padEnd(18)}` +
        ` median=${r.median_price ?? '?'} ${r.currency ?? '?'}` +
        ` check_in=${r.check_in ?? '?'}` +
        ` run=${r.collection_run_id ?? '?'}`
      );
    }
  }

  // ── E. Consensus source links ──────────────────────────────────────────────
  const sourceLinks = (await pool.query(`
    SELECT mos.derived_observation_id,
           COUNT(*) AS source_count
      FROM market_observation_sources mos
     GROUP BY mos.derived_observation_id
     ORDER BY source_count DESC
     LIMIT 10
  `)).rows;

  if (sourceLinks.length > 0) {
    console.log('\n  Consensus source links (top 10 by source count):');
    for (const r of sourceLinks) {
      console.log(`    derived=${r.derived_observation_id.slice(0, 8)}…  sources=${r.source_count}`);
    }
  }

  // ── F. Comparables by provider ─────────────────────────────────────────────
  const compByProvider = (await pool.query(`
    SELECT provider, COUNT(*) AS cnt
      FROM market_observation_comparables
     GROUP BY provider
     ORDER BY cnt DESC
  `)).rows;

  if (compByProvider.length > 0) {
    console.log('\n  Comparables by provider:');
    for (const r of compByProvider) {
      console.log(`    ${(r.provider ?? 'NULL').padEnd(12)} ${r.cnt}`);
    }
  }

  // ── G. Collection runs ─────────────────────────────────────────────────────
  const runs = (await pool.query(`
    SELECT collection_run_id, COUNT(*) AS obs_count,
           MIN(collected_at) AS first_at,
           MAX(collected_at) AS last_at
      FROM market_observations
     WHERE collection_run_id IS NOT NULL
     GROUP BY collection_run_id
     ORDER BY first_at DESC
     LIMIT 10
  `)).rows;

  if (runs.length > 0) {
    console.log('\n  Collection runs (top 10):');
    for (const r of runs) {
      console.log(
        `    run=${r.collection_run_id.padEnd(22)}` +
        ` obs=${r.obs_count}` +
        ` from=${r.first_at?.toISOString().slice(0, 19)}`
      );
    }
  }

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  Audit complete — no writes performed.');
  console.log('══════════════════════════════════════════════════════════════\n');
}

run()
  .catch(err => { console.error('Audit error:', err.message); process.exit(1); })
  .finally(() => pool.end());
