'use strict';
/**
 * P1.2-B5-BK-O-FIX — Static Migration Validator
 *
 * Reads migrations/004_market_observations.sql and verifies all expected
 * tables, constraints, indexes, and safety properties are present.
 *
 * ABSOLUTE SAFETY:
 *   DB_WRITES              = 0  pure static analysis
 *   NETWORK_CALLS          = 0  pure static analysis
 *   PRODUCTION_WRITES      = 0  read-only file analysis
 *   SAFE_TO_ACTIVATE       = NO (validates migration, does not apply it)
 *
 * Usage:
 *   node outils/validate-market-observation-migration-o.js
 */

const fs   = require('fs');
const path = require('path');

// ── Load migration ────────────────────────────────────────────────────────────

const MIGRATION_PATH = path.join(__dirname, '../migrations/004_market_observations.sql');
const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');

// ── Test runner ───────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;

function check(label, cond, hint = '') {
  if (cond) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.log(`  ✗ ${label}${hint ? '  — ' + hint : ''}`);
    fail++;
  }
}

function has(pattern) {
  if (typeof pattern === 'string') return sql.includes(pattern);
  return pattern.test(sql);
}

// ── A. Table presence ─────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  A — Table presence (6 tables expected)');
console.log('══════════════════════════════════════════════════════════════');

check('A-01: market_profiles table',
  has('CREATE TABLE IF NOT EXISTS market_profiles'));

check('A-02: market_profile_properties table',
  has('CREATE TABLE IF NOT EXISTS market_profile_properties'));

check('A-03: market_observations table',
  has('CREATE TABLE IF NOT EXISTS market_observations'));

check('A-04: market_observation_sources table (O-FIX — replaces UUID[])',
  has('CREATE TABLE IF NOT EXISTS market_observation_sources'));

check('A-05: market_observation_properties table',
  has('CREATE TABLE IF NOT EXISTS market_observation_properties'));

check('A-06: market_observation_comparables table',
  has('CREATE TABLE IF NOT EXISTS market_observation_comparables'));

// ── B. O-FIX: source_observation_ids removed ─────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  B — O-FIX: source_observation_ids UUID[] removed');
console.log('══════════════════════════════════════════════════════════════');

check('B-01: source_observation_ids UUID[] column NOT defined (may appear in comments)',
  // Column definitions appear indented; comments start with --
  !/^\s+source_observation_ids\s+UUID/m.test(sql),
  'UUID[] column definition must be gone; use market_observation_sources');

check('B-02: market_observation_sources has derived_observation_id FK',
  has('derived_observation_id'));

check('B-03: market_observation_sources has source_observation_id FK',
  has('source_observation_id'));

check('B-04: self-reference prevention constraint present',
  has('chk_mos_no_self_reference'));

check('B-05: source_observation_id uses ON DELETE RESTRICT',
  /source_observation_id\s+UUID NOT NULL\s+REFERENCES market_observations\(observation_id\) ON DELETE RESTRICT/.test(sql));

// ── C. market_profile_properties cardinality fix ──────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  C — market_profile_properties cardinality (UNIQUE property_id)');
console.log('══════════════════════════════════════════════════════════════');

check('C-01: UNIQUE constraint on property_id present',
  has('uq_mpp_property_id'));

check('C-02: UNIQUE (property_id) — one active profile per property',
  has('CONSTRAINT uq_mpp_property_id UNIQUE (property_id)'));

// ── D. market_observations FK for market_profile_id ──────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  D — market_observations.market_profile_id FK');
console.log('══════════════════════════════════════════════════════════════');

check('D-01: market_profile_id references market_profiles',
  has('REFERENCES market_profiles(profile_id) ON DELETE RESTRICT'));

check('D-02: FK uses ON DELETE RESTRICT (immutable profile guard)',
  /market_profile_id\s+TEXT\s+REFERENCES market_profiles\(profile_id\) ON DELETE RESTRICT/.test(sql));

// ── E. Provider/type consistency constraint ───────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  E — Provider/type bidirectional consistency');
console.log('══════════════════════════════════════════════════════════════');

check('E-01: chk_mo_provider_type_consistency constraint present',
  has('chk_mo_provider_type_consistency'));

check('E-02: consistency uses biconditional = operator',
  has("(provider = 'consensus') = (observation_type = 'DERIVED_CONSENSUS')"));

// ── F. Statistical ordering constraints ──────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  F — Statistical ordering constraints (null-tolerant)');
console.log('══════════════════════════════════════════════════════════════');

check('F-01: chk_mo_p25_le_median present',
  has('chk_mo_p25_le_median'));

check('F-02: chk_mo_median_le_p75 present',
  has('chk_mo_median_le_p75'));

check('F-03: chk_mo_min_le_max present',
  has('chk_mo_min_le_max'));

check('F-04: chk_mo_min_le_median present',
  has('chk_mo_min_le_median'));

check('F-05: chk_mo_max_ge_median present',
  has('chk_mo_max_ge_median'));

check('F-06: p25_le_median is null-tolerant',
  has('p25_price IS NULL OR median_price IS NULL OR p25_price <= median_price'));

check('F-07: median_le_p75 is null-tolerant',
  has('median_price IS NULL OR p75_price IS NULL OR median_price <= p75_price'));

// ── G. Count constraints ──────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  G — Count constraints');
console.log('══════════════════════════════════════════════════════════════');

check('G-01: chk_mo_raw_count_nonneg present',
  has('chk_mo_raw_count_nonneg'));

check('G-02: chk_mo_accepted_count_nonneg present',
  has('chk_mo_accepted_count_nonneg'));

check('G-03: chk_mo_comparable_nonneg present',
  has('chk_mo_comparable_nonneg'));

check('G-04: chk_mo_accepted_le_raw present',
  has('chk_mo_accepted_le_raw'));

check('G-05: accepted_le_raw is null-tolerant',
  has('accepted_count IS NULL OR raw_count IS NULL OR accepted_count <= raw_count'));

// ── H. Geo range guards ───────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  H — Geo range guards');
console.log('══════════════════════════════════════════════════════════════');

check('H-01: chk_mp_geo_lat present in market_profiles',
  has('chk_mp_geo_lat'));

check('H-02: chk_mp_geo_lon present in market_profiles',
  has('chk_mp_geo_lon'));

check('H-03: CAST(geo_lat AS NUMERIC) BETWEEN -90 AND 90',
  has('CAST(geo_lat AS NUMERIC) BETWEEN -90 AND 90'));

check('H-04: CAST(geo_lon AS NUMERIC) BETWEEN -180 AND 180',
  has('CAST(geo_lon AS NUMERIC) BETWEEN -180 AND 180'));

check('H-05: chk_mo_target_lat present in market_observations',
  has('chk_mo_target_lat'));

check('H-06: chk_mo_target_lon present in market_observations',
  has('chk_mo_target_lon'));

check('H-07: chk_moc_lat present in market_observation_comparables',
  has('chk_moc_lat'));

check('H-08: chk_moc_lon present in market_observation_comparables',
  has('chk_moc_lon'));

// ── I. Comparables retry dedup index ─────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  I — Comparables retry deduplication index');
console.log('══════════════════════════════════════════════════════════════');

check('I-01: idx_moc_obs_provider_listing partial unique index present',
  has('idx_moc_obs_provider_listing'));

check('I-02: index is UNIQUE',
  has('CREATE UNIQUE INDEX IF NOT EXISTS idx_moc_obs_provider_listing'));

check('I-03: index is partial (WHERE provider_listing_id IS NOT NULL)',
  has('WHERE provider_listing_id IS NOT NULL'));

// ── J. Retention and safety ───────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  J — Retention and safety properties');
console.log('══════════════════════════════════════════════════════════════');

check('J-01: RETENTION: INDEFINITE mentioned',
  has('RETENTION: INDEFINITE'));

check('J-02: STALE_FOR_PRICING != USELESS_FOR_HISTORY mentioned',
  has('STALE_FOR_PRICING != USELESS_FOR_HISTORY'));

check('J-03: DO NOT APPLY AUTOMATICALLY warning present',
  has('DO NOT APPLY AUTOMATICALLY'));

check('J-04: No DROP statement (additive only)',
  !has(/^\s*DROP\s+/im));

check('J-05: No destructive ALTER (no DROP COLUMN)',
  !has('DROP COLUMN'));

check('J-06: No DELETE statement',
  !has(/^\s*DELETE\s+FROM/im));

check('J-07: No DML operation on market_data (may appear in safety comments)',
  // Allow "No mutation of market_data" in comments; forbid actual DML
  !(/\b(INSERT INTO|UPDATE|ALTER TABLE|DROP TABLE)\s+market_data\b/i.test(sql)));

check('J-08: market_observation_properties.profile_id has no FK (intentional — historical)',
  (() => {
    // Extract only the market_observation_properties table block
    const mopBlock = sql.match(
      /CREATE TABLE IF NOT EXISTS market_observation_properties[\s\S]+?(?=CREATE TABLE|CREATE (UNIQUE )?INDEX|--\s*══)/
    )?.[0] ?? '';
    return mopBlock.length > 0 && !/profile_id\s+TEXT[^,\n]*REFERENCES/.test(mopBlock);
  })());

// ── K. Idempotency ────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  K — Idempotency (all statements IF NOT EXISTS)');
console.log('══════════════════════════════════════════════════════════════');

check('K-01: idx_mo_run_fingerprint unique index present',
  has('idx_mo_run_fingerprint'));

check('K-02: run_fingerprint index is partial (WHERE collection_run_id IS NOT NULL)',
  /idx_mo_run_fingerprint[\s\S]{0,200}WHERE collection_run_id IS NOT NULL/.test(sql));

check('K-03: all CREATE TABLE use IF NOT EXISTS',
  (() => {
    const tables = sql.match(/CREATE TABLE[^;]+;/g) || [];
    return tables.every(t => t.includes('IF NOT EXISTS'));
  })());

check('K-04: all CREATE INDEX use IF NOT EXISTS',
  (() => {
    const indexes = sql.match(/CREATE (UNIQUE )?INDEX[^;]+;/g) || [];
    return indexes.every(i => i.includes('IF NOT EXISTS'));
  })());

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log(`  RESULT: ${pass} passed, ${fail} failed`);
console.log('══════════════════════════════════════════════════════════════\n');

if (fail > 0) process.exit(1);
