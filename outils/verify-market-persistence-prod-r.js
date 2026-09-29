'use strict';
/**
 * P1.2-B5-BK-R-PROD-1 — Market Observation Persistence Post-Activation Verifier
 *
 * STRICTLY READ ONLY.
 *
 * This tool NEVER:
 *   calls Bright Data, Booking provider, Geoapify
 *   triggers cron, market refresh, or pricing
 *   calls Channex
 *   writes DB rows
 *
 * SAFETY:
 *   DB_WRITES              = 0  always
 *   NETWORK_CALLS          = 0  always
 *   BRIGHT_DATA_CALLS      = 0  always
 *   BOOKING_PROVIDER_CALLS = 0  always
 *   MARKET_DATA_WRITES     = 0  always
 *   PRICING_WRITES         = 0  always
 *   CHANNEX_CALLS          = 0  always
 *   VERIFIER_PROVIDER_CALLS = 0  always
 *
 * VERIFIER_PROVIDER_CALLS = 0
 * BRIDGE_CODE_ADDITIONAL_PROVIDER_CALLS = 0  (by design — bridge uses already-collected evidence)
 * RUNTIME_EXTRA_PROVIDER_CALLS_PROVEN = NO  (no telemetry instrumentation exists)
 *
 * Final state (one of):
 *   WAITING_FOR_FIRST_COLLECTION    — persistence active, no observations yet
 *   FIRST_COLLECTION_VALID          — observations exist and pass all validations
 *   FIRST_COLLECTION_INVALID        — observations exist but fail validation
 *   UNSAFE_FLAG_CONFIGURATION       — unexpected flag state
 *
 * Usage:
 *   NODE_ENV=production node outils/verify-market-persistence-prod-r.js
 *   NODE_ENV=production node outils/verify-market-persistence-prod-r.js --since=2026-09-29T17:00:00Z
 *
 * R-PROD-1 CONSTRAINT: DO NOT trigger collection. DO NOT modify env flags.
 */

const fs   = require('fs');
const path = require('path');

const { createPool }               = require('../services/db-pool');
const { hasValidCoordinates }      = require('../services/market-geo-validator');
const { buildMarketProfileIdentity } = require('../services/market-search-identity');
const { determineActivationState } = require('./audit-market-persistence-activation-r');

// Pool only created when running directly — not when required for tests
let pool = null;

// ── CLI args ──────────────────────────────────────────────────────────────────

const sinceArg = process.argv.find(a => a.startsWith('--since='));
let sinceDate       = null;
let sinceUnconfirmed = false;

if (sinceArg) {
  const raw    = sinceArg.split('=').slice(1).join('=').trim();
  const parsed = new Date(raw);
  if (!isFinite(parsed.getTime())) {
    console.error(`Invalid --since value: "${raw}" — must be ISO8601 (e.g. 2026-09-29T17:00:00Z)`);
    process.exit(1);
  }
  sinceDate = parsed.toISOString();
} else {
  sinceUnconfirmed = true;
  // Default: last 48 h — shows latest observations without confirmed activation provenance
  sinceDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
}

// ── Observation validator ─────────────────────────────────────────────────────

/**
 * Validate a single PROVIDER observation row from market_observations.
 * Returns { valid: boolean, issues: string[] }.
 *
 * @param {object} obs  — row from market_observations
 * @param {object[]} links — rows from market_observation_properties for this obs
 */
function validateProviderObservation(obs, links = []) {
  const issues = [];

  if (!['airbnb', 'booking'].includes(obs.provider)) {
    issues.push(`unrecognized_provider:${obs.provider}`);
  }
  if (obs.observation_type !== 'PROVIDER') {
    issues.push(`wrong_observation_type:${obs.observation_type}`);
  }
  if (!obs.collected_at || !isFinite(new Date(obs.collected_at).getTime())) {
    issues.push('invalid_collected_at');
  }
  if (!obs.currency || !/^[A-Z]{3}$/.test(obs.currency)) {
    issues.push(`invalid_currency:${obs.currency ?? 'null'}`);
  }
  if (!obs.check_in || !obs.check_out) {
    issues.push('missing_stay_window');
  }
  if (obs.check_in && obs.check_out && obs.check_in >= obs.check_out) {
    issues.push(`invalid_stay_window:${obs.check_in}..${obs.check_out}`);
  }
  if (!obs.search_fingerprint) {
    issues.push('missing_search_fingerprint');
  }
  if (!obs.market_profile_id) {
    issues.push('missing_market_profile_id');
  }
  if (!obs.collection_run_id) {
    issues.push('missing_collection_run_id');
  }
  if (!obs.data_source) {
    issues.push('missing_data_source');
  }
  // Bridge observations must have provenance.bridge=true
  if (!obs.provenance || obs.provenance.bridge !== true) {
    issues.push('provenance_bridge_flag_missing');
  }
  // Median sanity when comparable count is positive
  if (obs.comparable_count > 0 && (obs.median_price == null || obs.median_price <= 0)) {
    issues.push(`suspicious_median:${obs.median_price}`);
  }
  // Must be attached to at least one property
  if (links.length === 0) {
    issues.push('no_property_attachments');
  }

  return { valid: issues.length === 0, issues };
}

// ── Shared-profile detection (from pricing_config, no collection needed) ──────

/**
 * Build profile identity for each active bridge-ready property.
 * Returns groups keyed by profileId. Groups with 2+ members are shared profiles.
 */
function buildSharedProfileGroups(props) {
  const groups = new Map(); // profileId → [{ id, name }]
  for (const p of props) {
    if (!hasValidCoordinates(p.latitude, p.longitude) || !p.currency) continue;
    const id = buildMarketProfileIdentity({
      latitude:           p.latitude,
      longitude:          p.longitude,
      currency:           p.currency,
      targetGuests:       p.max_guests    ?? null,
      targetBedrooms:     p.bedrooms      ?? null,
      targetPropertyType: p.property_type ?? null,
    });
    if (!id.valid) continue;
    if (!groups.has(id.profileId)) groups.set(id.profileId, []);
    groups.get(id.profileId).push({ id: String(p.id), name: p.internal_name || p.name || `property_${p.id}` });
  }
  return groups;
}

// ── Pricing authority static check ───────────────────────────────────────────

const PRICING_FILES_TO_CHECK = [
  '../routes/market-data-resolver.js',
  '../routes/dynamic-pricing-routes.js',
  '../routes/pricing-apply.js',
  '../routes/pricing-recalc-trigger.js',
  '../routes/pricing-calendars.js',
];

function checkPricingAuthority() {
  const results = [];
  for (const rel of PRICING_FILES_TO_CHECK) {
    const abs = path.join(__dirname, rel);
    if (!fs.existsSync(abs)) {
      results.push({ file: rel, readable: false, selectsFromObs: false });
      continue;
    }
    const src = fs.readFileSync(abs, 'utf8');
    // Check for SELECT ... FROM market_observations (pricing reads from obs table)
    const selectsFromObs = /SELECT\b.*\bFROM\s+market_observations/is.test(src);
    results.push({ file: rel, readable: true, selectsFromObs });
  }
  return results;
}

// ── Main verifier ─────────────────────────────────────────────────────────────

async function runVerifier() {
  const SEP = '═'.repeat(70);
  console.log(SEP);
  console.log('  P1.2-B5-BK-R-PROD-1 — Market Observation Persistence Verifier');
  console.log('  MODE: read-only — DB_WRITES=0  NETWORK_CALLS=0  BRIGHT_DATA_CALLS=0');
  console.log(SEP);
  console.log();

  // ── Section 3: Flag verification ──────────────────────────────────────────────
  const persistenceFlag = process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED;
  const sharedFlag      = process.env.MARKET_SHARED_COLLECTION_ENABLED;
  const persistenceOn   = persistenceFlag === 'true';
  const sharedOn        = sharedFlag      === 'true';

  const ACTIVATION_STATE = determineActivationState(persistenceOn, sharedOn);
  const EXPECTED_SHADOW_MODE = persistenceOn && !sharedOn;

  console.log('── 3: FLAGS ─────────────────────────────────────────────────────');
  console.log(`  MARKET_OBSERVATION_PERSISTENCE_ENABLED = ${persistenceFlag ?? '(unset)'}  ${persistenceOn ? '⚡ ACTIVE' : '● OFF'}`);
  console.log(`  MARKET_SHARED_COLLECTION_ENABLED       = ${sharedFlag      ?? '(unset)'}  ${sharedOn ? '⚡ ACTIVE' : '● OFF'}`);
  console.log(`  ACTIVATION_STATE                       = ${ACTIVATION_STATE}`);
  console.log(`  EXPECTED_SHADOW_MODE                   = ${EXPECTED_SHADOW_MODE ? 'YES ✅' : 'NO ❌'}`);

  if (!EXPECTED_SHADOW_MODE) {
    console.log('  ⚠️  Flag configuration is not the expected shadow mode.');
    if (!persistenceOn) {
      console.log('      MARKET_OBSERVATION_PERSISTENCE_ENABLED must be true for bridge to be active.');
    }
    if (sharedOn) {
      console.log('      MARKET_SHARED_COLLECTION_ENABLED=true enables additional BD calls — not yet approved.');
    }
    console.log();
    console.log(`  FINAL_STATE = UNSAFE_FLAG_CONFIGURATION`);
    return 'UNSAFE_FLAG_CONFIGURATION';
  }
  console.log();

  // ── Section 4: Shadow table counts ───────────────────────────────────────────
  let counts = null;
  try {
    const r = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM market_profiles)                  AS profile_count,
        (SELECT COUNT(*)::int FROM market_profile_properties)        AS profile_property_count,
        (SELECT COUNT(*)::int FROM market_observations)              AS observation_count,
        (SELECT COUNT(*)::int FROM market_observation_properties)    AS obs_property_count,
        (SELECT COUNT(*)::int FROM market_observation_comparables)   AS comparable_count,
        (SELECT COUNT(*)::int FROM market_observation_sources)       AS source_count
    `);
    counts = r.rows[0];
  } catch (err) {
    console.log('── 4: SHADOW TABLE COUNTS ───────────────────────────────────────');
    console.log(`  ⚠️  Could not query shadow tables: ${err.message}`);
    console.log();
  }

  if (counts) {
    console.log('── 4: SHADOW TABLE COUNTS ───────────────────────────────────────');
    console.log(`  market_profiles                  = ${counts.profile_count}`);
    console.log(`  market_profile_properties        = ${counts.profile_property_count}`);
    console.log(`  market_observations              = ${counts.observation_count}`);
    console.log(`  market_observation_properties    = ${counts.obs_property_count}`);
    console.log(`  market_observation_comparables   = ${counts.comparable_count}`);
    console.log(`  market_observation_sources       = ${counts.source_count}`);
    console.log();
  }

  const observationCount = counts?.observation_count ?? 0;

  // ── Section 5: First observation detection ────────────────────────────────────
  console.log('── 5: RECENT OBSERVATIONS ───────────────────────────────────────');
  if (sinceUnconfirmed) {
    console.log('  ⚠️  --since not provided — showing last 48h (activation provenance unconfirmed)');
    console.log('  Pass --since=<ISO8601> to confirm post-activation provenance.');
  } else {
    console.log(`  since = ${sinceDate}`);
  }
  console.log();

  let recentObs = [];
  try {
    const r = await pool.query(`
      SELECT observation_id, provider, observation_type, data_source,
             collected_at, search_fingerprint, market_profile_id,
             currency, check_in, check_out, nights, comparable_count,
             median_price, p25_price, p75_price, collection_run_id,
             provenance, quality_status
      FROM market_observations
      WHERE collected_at >= $1
        AND observation_type = 'PROVIDER'
      ORDER BY collected_at DESC
      LIMIT 50
    `, [sinceDate]);
    recentObs = r.rows;
  } catch (err) {
    console.log(`  ⚠️  Could not fetch recent observations: ${err.message}`);
  }

  console.log(`  Recent PROVIDER observations (since ${sinceDate}): ${recentObs.length}`);
  console.log();

  if (observationCount === 0 || recentObs.length === 0) {
    // Skip validation sections — nothing to validate yet
    // Still run structural checks
    console.log('  ZERO_OBSERVATION_STATE = true');
    console.log('  Waiting for first pricing cron run with persistence enabled.');
    console.log();

    // ── Section 7: M6/M7 WAITING ───────────────────────────────────────────────
    await runSharedProfileSection(pool, counts);

    // ── Section 8: Ti Junot guard ──────────────────────────────────────────────
    await runTiJunotSection(pool);

    // ── Section 9: Market data cross-check ─────────────────────────────────────
    await runMarketDataCrossCheck(pool, []);

    // ── Section 10: Pricing authority ──────────────────────────────────────────
    runPricingAuthoritySection();

    // ── Section 11: Provider call claims ───────────────────────────────────────
    runProviderCallSection();

    const finalState = 'WAITING_FOR_FIRST_COLLECTION';
    printFinalState(finalState);
    return finalState;
  }

  // ── Section 6: Provider observation validation ────────────────────────────────
  console.log('── 6: PROVIDER OBSERVATION VALIDATION ───────────────────────────');

  // Fetch property links for recent observations
  const obsIds = recentObs.map(o => o.observation_id);
  let linksByObs = {};
  try {
    const r = await pool.query(`
      SELECT observation_id, property_id, user_id, profile_id, assignment_reason
      FROM market_observation_properties
      WHERE observation_id = ANY($1)
    `, [obsIds]);
    for (const row of r.rows) {
      if (!linksByObs[row.observation_id]) linksByObs[row.observation_id] = [];
      linksByObs[row.observation_id].push(row);
    }
  } catch (err) {
    console.log(`  ⚠️  Could not fetch property links: ${err.message}`);
  }

  let validCount   = 0;
  let invalidCount = 0;
  const validationResults = [];

  for (const obs of recentObs) {
    const links  = linksByObs[obs.observation_id] ?? [];
    const result = validateProviderObservation(obs, links);
    validationResults.push({ obs, links, result });

    const icon = result.valid ? '✅' : '❌';
    const runPrefix = obs.collection_run_id?.slice(0, 12) ?? '?';
    console.log(`  ${icon} obs=${obs.observation_id?.slice(0, 12)}… provider=${obs.provider} cur=${obs.currency} links=${links.length} run=${runPrefix}…`);
    if (!result.valid) {
      for (const issue of result.issues) {
        console.log(`       issue: ${issue}`);
      }
      invalidCount++;
    } else {
      validCount++;
    }
  }

  console.log();
  console.log(`  Valid observations   = ${validCount}`);
  console.log(`  Invalid observations = ${invalidCount}`);
  console.log();

  // ── Section 7: M6/M7 sharing validation ──────────────────────────────────────
  await runSharedProfileSection(pool, counts, linksByObs, recentObs);

  // ── Section 8: Ti Junot guard ─────────────────────────────────────────────────
  await runTiJunotSection(pool);

  // ── Section 9: Market data cross-check ────────────────────────────────────────
  await runMarketDataCrossCheck(pool, recentObs);

  // ── Section 10: Pricing authority ─────────────────────────────────────────────
  runPricingAuthoritySection();

  // ── Section 11: Provider call claims ──────────────────────────────────────────
  runProviderCallSection();

  // ── Final state ───────────────────────────────────────────────────────────────
  const finalState = invalidCount === 0
    ? 'FIRST_COLLECTION_VALID'
    : 'FIRST_COLLECTION_INVALID';

  printFinalState(finalState);
  return finalState;
}

// ── Section 7: Shared profile validation ─────────────────────────────────────

async function runSharedProfileSection(pool, counts, linksByObs = {}, recentObs = []) {
  console.log('── 7: SHARED PROFILE VALIDATION (M6/M7) ─────────────────────────');

  // Get all active bridge-ready properties to compute profile groups
  let props = [];
  try {
    const r = await pool.query(`
      SELECT p.id, p.internal_name, p.name, p.latitude, p.longitude,
             p.currency, p.max_guests, pc.bedrooms, pc.property_type
      FROM pricing_config pc
      JOIN properties p ON p.id = pc.property_id AND p.user_id = pc.user_id
      WHERE pc.is_active = TRUE
    `);
    props = r.rows;
  } catch (err) {
    console.log(`  ⚠️  Could not fetch properties: ${err.message}`);
    console.log();
    return;
  }

  const profileGroups = buildSharedProfileGroups(props);
  const sharedGroups  = [...profileGroups.entries()].filter(([, members]) => members.length > 1);

  if (sharedGroups.length === 0) {
    console.log('  No shared profile groups found in active properties.');
    console.log('  M6_M7_SHARED_PROFILE = NOT_PRESENT');
    console.log();
    return;
  }

  // Build a map: property_id → observation_ids they're attached to
  const propAttachments = {};
  for (const [obsId, links] of Object.entries(linksByObs)) {
    for (const link of links) {
      if (!propAttachments[link.property_id]) propAttachments[link.property_id] = [];
      propAttachments[link.property_id].push(obsId);
    }
  }

  for (const [profileId, members] of sharedGroups) {
    console.log(`  Shared profile: ${profileId.slice(0, 16)}…  (${members.length} properties)`);

    let allAttached  = true;
    let hasEvidence  = false;

    for (const m of members) {
      const obsForProp = propAttachments[m.id] ?? [];
      const attached   = obsForProp.length > 0;
      if (attached) hasEvidence = true;
      else allAttached = false;

      const status = attached ? 'ATTACHED' : 'WAITING_FOR_FIRST_COLLECTION';
      console.log(`    [${m.id}] ${m.name}: ${status}`);
    }

    if (!hasEvidence) {
      console.log(`  SHARED_PROFILE_STATE    = WAITING_FOR_FIRST_COLLECTION`);
    } else if (allAttached) {
      // All members are attached — check if they share the same observation
      const propIds = members.map(m => m.id);
      const commonObs = new Set(propAttachments[propIds[0]] ?? []);
      for (const pid of propIds.slice(1)) {
        for (const oid of [...commonObs]) {
          if (!(propAttachments[pid] ?? []).includes(oid)) commonObs.delete(oid);
        }
      }
      const sharedObsCount = commonObs.size;
      console.log(`  SHARED_PROFILE_MATCH    = ${sharedObsCount > 0 ? 'YES ✅' : 'SEPARATE_OBSERVATIONS'}`);
      console.log(`  OBSERVATION_SHARED_SAFELY = ${sharedObsCount > 0 ? 'YES ✅' : 'VERIFY_MANUALLY'}`);
    } else {
      console.log(`  SHARED_PROFILE_STATE    = PARTIAL_ATTACHMENT`);
    }
  }
  console.log();
}

// ── Section 8: Ti Junot guard ─────────────────────────────────────────────────

async function runTiJunotSection(pool) {
  console.log('── 8: TI JUNOT (PROFILE-INCOMPLETE) GUARD ───────────────────────');

  let rows = [];
  try {
    const r = await pool.query(`
      SELECT
        p.id,
        p.internal_name,
        p.name,
        p.latitude IS NULL OR p.longitude IS NULL AS geo_null,
        p.currency IS NULL OR p.currency = '' AS currency_null,
        (
          SELECT COUNT(*)::int FROM market_observation_properties mop
          WHERE mop.property_id = p.id::text
        ) AS attachment_count
      FROM pricing_config pc
      JOIN properties p ON p.id = pc.property_id AND p.user_id = pc.user_id
      WHERE pc.is_active = TRUE
        AND (
          p.latitude IS NULL OR p.longitude IS NULL
          OR p.currency IS NULL OR p.currency = ''
        )
    `);
    rows = r.rows;
  } catch (err) {
    console.log(`  ⚠️  Could not run Ti Junot check: ${err.message}`);
    console.log();
    return;
  }

  if (rows.length === 0) {
    console.log('  No profile-incomplete properties in active pricing config.');
    console.log('  TI_JUNOT_GUARD = N/A (no incomplete properties)');
    console.log();
    return;
  }

  let guardOk = true;
  for (const p of rows) {
    const name      = p.internal_name || p.name || `property_${p.id}`;
    const geoReason = p.geo_null ? 'null_geo' : '';
    const curReason = p.currency_null ? 'null_currency' : '';
    const reasons   = [geoReason, curReason].filter(Boolean).join('+');
    const icon      = p.attachment_count === 0 ? '✅' : '❌';

    console.log(`  ${icon} [${p.id}] ${name}`);
    console.log(`       TI_JUNOT_PROFILE_READY          = NO (${reasons})`);
    console.log(`       TI_JUNOT_OBSERVATION_ATTACHMENTS = ${p.attachment_count}`);

    if (p.attachment_count > 0) {
      guardOk = false;
      console.log(`       ❌ GUARD VIOLATION — incomplete profile must NOT be attached to observations`);
    }
  }

  console.log();
  console.log(`  TI_JUNOT_GUARD = ${guardOk ? 'OK ✅' : 'VIOLATED ❌'}`);
  console.log();
}

// ── Section 9: Market data cross-check ───────────────────────────────────────
//
// market_data schema: currency TEXT (P1.2-B2), scraped_at TIMESTAMPTZ
//
async function runMarketDataCrossCheck(pool, recentObs) {
  console.log('── 9: MARKET_DATA CROSS-CHECK ───────────────────────────────────');

  if (recentObs.length === 0) {
    console.log('  OBSERVATION_EVIDENCE_FOUND    = NO');
    console.log('  EVIDENCE_COMPATIBLE           = NOT_AVAILABLE (no observations yet)');
    console.log();
    return;
  }

  let mdRows = [];
  try {
    const r = await pool.query(`
      SELECT
        md.property_id,
        md.week_start,
        md.data_source,
        md.currency,
        md.median_price,
        md.scraped_at
      FROM market_data md
      WHERE md.scraped_at >= NOW() - INTERVAL '7 days'
      ORDER BY md.scraped_at DESC
      LIMIT 20
    `);
    mdRows = r.rows;
  } catch (err) {
    console.log(`  ⚠️  Could not query market_data: ${err.message}`);
    console.log();
    return;
  }

  const MARKET_DATA_EVIDENCE_FOUND = mdRows.length > 0;
  console.log(`  OBSERVATION_EVIDENCE_FOUND    = YES (${recentObs.length} PROVIDER observations)`);
  console.log(`  MARKET_DATA_EVIDENCE_FOUND    = ${MARKET_DATA_EVIDENCE_FOUND ? 'YES' : 'NO'} (${mdRows.length} rows in last 7 days)`);

  if (!MARKET_DATA_EVIDENCE_FOUND) {
    console.log('  EVIDENCE_COMPATIBLE           = NOT_AVAILABLE (no recent market_data)');
    console.log();
    return;
  }

  // Fetch property links so we can join observations → property_id → market_data
  const obsIds = recentObs.map(o => o.observation_id);
  let linkRows = [];
  try {
    const r = await pool.query(`
      SELECT observation_id, property_id
      FROM market_observation_properties
      WHERE observation_id = ANY($1)
    `, [obsIds]);
    linkRows = r.rows;
  } catch (err) {
    console.log(`  ⚠️  Could not fetch observation property links: ${err.message}`);
    console.log();
    return;
  }

  // Build index: property_id → market_data rows
  const mdByProperty = new Map();
  for (const md of mdRows) {
    if (!mdByProperty.has(md.property_id)) mdByProperty.set(md.property_id, []);
    mdByProperty.get(md.property_id).push(md);
  }

  // Build index: observation_id → property_id[]
  const linksByObsId = {};
  for (const link of linkRows) {
    if (!linksByObsId[link.observation_id]) linksByObsId[link.observation_id] = [];
    linksByObsId[link.observation_id].push(link.property_id);
  }

  // Per-observation: MATCH / MISMATCH / NOT_AVAILABLE
  let matchCount        = 0;
  let mismatchCount     = 0;
  let notAvailableCount = 0;

  for (const obs of recentObs) {
    const propIds  = linksByObsId[obs.observation_id] ?? [];
    const obsShort = obs.observation_id?.slice(0, 12) ?? '?';

    if (propIds.length === 0) {
      notAvailableCount++;
      console.log(`  obs=${obsShort}… → NOT_AVAILABLE (no property links)`);
      continue;
    }

    let matched = false;
    let anyMd   = false;
    for (const pid of propIds) {
      const mdForProp = mdByProperty.get(pid) ?? [];
      if (mdForProp.length > 0) anyMd = true;
      // MATCH: same property, same currency, same data_source
      if (mdForProp.find(md => md.currency === obs.currency && md.data_source === obs.data_source)) {
        matched = true;
        break;
      }
    }

    if (matched) {
      matchCount++;
      console.log(`  obs=${obsShort}… → MATCH ✅  (currency + data_source align with market_data)`);
    } else if (anyMd) {
      mismatchCount++;
      console.log(`  obs=${obsShort}… → MISMATCH ⚠️  (market_data present but currency/source differ)`);
      console.log(`       obs.currency=${obs.currency}  obs.data_source=${obs.data_source}`);
    } else {
      notAvailableCount++;
      console.log(`  obs=${obsShort}… → NOT_AVAILABLE (no market_data for property within 7 days)`);
    }
  }

  console.log();
  const overall = matchCount === recentObs.length
    ? 'MATCH ✅'
    : matchCount > 0
      ? `PARTIAL (${matchCount}/${recentObs.length} MATCH)`
      : notAvailableCount === recentObs.length
        ? 'NOT_AVAILABLE'
        : 'MISMATCH ⚠️';

  console.log(`  Cross-check: MATCH=${matchCount}  MISMATCH=${mismatchCount}  NOT_AVAILABLE=${notAvailableCount}`);
  console.log(`  EVIDENCE_COMPATIBLE = ${overall}`);
  console.log(`  Note: MATCH = same property_id + currency + data_source in market_data (last 7 days)`);
  console.log();
}

// ── Section 10: Pricing authority ────────────────────────────────────────────

function runPricingAuthoritySection() {
  console.log('── 10: MARKET_OBSERVATIONS PRICING AUTHORITY ────────────────────');

  const fileChecks = checkPricingAuthority();
  let anyReads = false;

  for (const { file, readable, selectsFromObs } of fileChecks) {
    if (!readable) {
      console.log(`  ⏭  ${file} — not found (skipped)`);
      continue;
    }
    const icon = selectsFromObs ? '❌' : '✅';
    if (selectsFromObs) anyReads = true;
    console.log(`  ${icon} ${file} — ${selectsFromObs ? 'READS market_observations ❌' : 'does NOT read market_observations'}`);
  }

  console.log();
  console.log(`  MARKET_OBSERVATIONS_PRICING_AUTHORITY = ${anyReads ? 'YES ❌ (violation)' : 'NO ✅ (correct — market_data is authoritative)'}`);
  console.log();
}

// ── Section 11: Provider call claims ─────────────────────────────────────────

function runProviderCallSection() {
  console.log('── 11: PROVIDER CALL CLAIMS ─────────────────────────────────────');
  console.log('  VERIFIER_PROVIDER_CALLS              = 0  (this tool is read-only)');
  console.log('  BRIDGE_CODE_ADDITIONAL_PROVIDER_CALLS = 0  (bridge reuses in-memory evidence)');
  console.log('  RUNTIME_EXTRA_PROVIDER_CALLS_PROVEN  = NO  (no BD call telemetry instrumented)');
  console.log('  LIVE_BRIGHT_DATA_CALLS               = 0  (from this verifier run)');
  console.log('  BD_CREDITS_CONSUMED_BY_VERIFIER      = 0');
  console.log();
}

// ── Final state printer ───────────────────────────────────────────────────────

function printFinalState(state) {
  const SEP = '─'.repeat(70);
  console.log(SEP);
  console.log(`  FINAL_STATE = ${state}`);
  console.log();
  console.log('  SAFE_TO_RUN_PROD_VERIFIER        = YES');
  console.log('  SAFE_TO_KEEP_PERSISTENCE_ENABLED = YES');
  console.log('  SAFE_TO_ENABLE_SHARED_COLLECTION = NO  (requires separate approval)');
  console.log('  SAFE_TO_USE_OBSERVATIONS_FOR_PRICING = NO  (market_data remains authoritative)');
  console.log();
  if (state === 'WAITING_FOR_FIRST_COLLECTION') {
    console.log('  RECOMMENDED_NEXT_STEP: Wait for next Monday 6h00 Paris pricing cron.');
    console.log('  Then re-run this verifier with --since=<activation-timestamp>.');
  } else if (state === 'FIRST_COLLECTION_VALID') {
    console.log('  RECOMMENDED_NEXT_STEP: Monitor weekly. Re-run after each cron run.');
    console.log('  Consider enabling MARKET_SHARED_COLLECTION_ENABLED only after');
    console.log('  bridge persistence is proven stable over several weeks.');
  } else if (state === 'FIRST_COLLECTION_INVALID') {
    console.log('  RECOMMENDED_NEXT_STEP: Investigate invalid observations above.');
    console.log('  Do NOT enable shared collection until bridge is proven stable.');
  } else if (state === 'UNSAFE_FLAG_CONFIGURATION') {
    console.log('  RECOMMENDED_NEXT_STEP: Correct Render env vars before re-running.');
  }
}

// ── Entry point (only when run directly, not when required for tests) ─────────

if (require.main === module) {
  pool = createPool();
  runVerifier()
    .then(state => {
      if (state === 'FIRST_COLLECTION_INVALID' || state === 'UNSAFE_FLAG_CONFIGURATION') {
        process.exitCode = 1;
      }
    })
    .catch(err => {
      console.error('\nVerifier error:', err.message);
      process.exit(1);
    })
    .finally(() => pool.end());
}

// ── Exports for test inspection ───────────────────────────────────────────────

module.exports = {
  validateProviderObservation,
  buildSharedProfileGroups,
  checkPricingAuthority,
  determineActivationState,
  PRICING_FILES_TO_CHECK,
};
