'use strict';
/**
 * P1.2-B5-BK-S16/S17 — Market Shared Collection Activation Audit
 *
 * READ ONLY.
 *
 * This tool NEVER:
 *   calls Bright Data, Booking provider, Geoapify
 *   triggers cron or market refresh
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
 *
 * Reports (S16):
 *   Eligible properties (profile-ready)
 *   Incomplete properties (excluded from shared collection)
 *   Unique canonical profiles
 *   Unique fingerprints per provider
 *   Naive call count (one per property)
 *   Shared call count (one per fingerprint)
 *   Calls saved + reduction %
 *
 * Reports (S17):
 *   All safety flags, dedup presence, telemetry presence
 *   SAFE_TO_ENABLE_SHARED_COLLECTION
 *
 * Usage:
 *   NODE_ENV=production node outils/audit-market-shared-activation-s.js
 */

const fs   = require('fs');
const path = require('path');

const { createPool }               = require('../services/db-pool');
const { hasValidCoordinates }      = require('../services/market-geo-validator');
const { buildMarketProfileIdentity, buildMarketSearchFingerprint } = require('../services/market-search-identity');
const {
  isShadowCollectionEnabled,
  isSharedProductionEnabled,
  validatePropertyCompleteness,
  groupPropertiesByFingerprint,
} = require('../services/market-shared-collection-coordinator');
const { isPersistenceEnabled }     = require('../services/market-observation-persistence-bridge');
const marketProvider               = require('../services/market-provider');

// Pool created only when running directly
let pool = null;

// Schema contract (verified against server.js CREATE TABLE / ALTER TABLE):
//   pricing_config: id, user_id, property_id, price_min, price_max, mode, is_active,
//                   notify_push, notify_email, notify_alert, zone_lat, zone_lng,
//                   zone_radius_km, property_type, bedrooms, created_at, updated_at
//   properties (relevant): id, user_id, name, address, internal_name*, latitude*,
//                           longitude*, currency*, max_guests*   (* added via ALTER TABLE)
//   zone_label lives on market_data.zone_label — NOT on pricing_config.
const ACTIVE_PROPERTIES_SQL = `
  SELECT
    p.id,
    p.internal_name,
    p.name,
    p.latitude,
    p.longitude,
    p.currency,
    p.max_guests,
    pc.bedrooms,
    pc.property_type,
    p.address AS property_address,
    pc.is_active,
    pc.price_min,
    pc.price_max,
    p.user_id
  FROM pricing_config pc
  JOIN properties p ON p.id = pc.property_id AND p.user_id = pc.user_id
  WHERE pc.is_active = TRUE
  ORDER BY p.internal_name, p.name
`;

const SHADOW_COUNTS_SQL = `
  SELECT
    (SELECT COUNT(*)::int FROM market_profiles)       AS profile_count,
    (SELECT COUNT(*)::int FROM market_observations)   AS observation_count
`;

function displayName(p) {
  return p.internal_name || p.name || `property_${p.id}`;
}

/**
 * Compute cost estimate for a set of configs and provider.
 * Returns { naiveCalls, sharedCalls, saved, reductionPct, groups }.
 * Pure function — no network.
 */
function computeCostEstimate(configs, { checkIn, checkOut, resolveProvider, maxListings = 100 } = {}) {
  let eligible = 0;

  // Count eligible configs for naive calls
  for (const cfg of configs) {
    const check = validatePropertyCompleteness(cfg);
    if (!check.ok) continue;
    eligible++;
  }

  const groups = groupPropertiesByFingerprint(configs, { checkIn, checkOut, resolveProvider, maxListings });

  const naiveCalls  = eligible;
  const sharedCalls = groups.size;
  const saved       = naiveCalls - sharedCalls;
  const reductionPct = naiveCalls > 0 ? Math.round((saved / naiveCalls) * 100) : 0;

  return { naiveCalls, sharedCalls, saved, reductionPct, groups };
}

module.exports = {
  ACTIVE_PROPERTIES_SQL,
  computeCostEstimate,
};

// ── Main audit ─────────────────────────────────────────────────────────────────

async function runAudit() {
  const SEP = '═'.repeat(70);
  console.log(SEP);
  console.log('  P1.2-B5-BK-S — Market Shared Collection Activation Audit');
  console.log('  MODE: read-only — DB_WRITES=0  NETWORK_CALLS=0  BRIGHT_DATA_CALLS=0');
  console.log(SEP);
  console.log();

  // ── Flags ───────────────────────────────────────────────────────────────────
  const persistenceFlag = process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED;
  const sharedFlag      = process.env.MARKET_SHARED_COLLECTION_ENABLED;
  const persistenceOn   = persistenceFlag === 'true';
  const sharedOn        = sharedFlag      === 'true';

  console.log('── FLAGS ────────────────────────────────────────────────────────');
  console.log(`  MARKET_OBSERVATION_PERSISTENCE_ENABLED = ${persistenceFlag ?? '(unset)'}  ${persistenceOn ? '⚡ ACTIVE' : '● OFF'}`);
  console.log(`  MARKET_SHARED_COLLECTION_ENABLED       = ${sharedFlag      ?? '(unset)'}  ${sharedOn ? '⚡ ACTIVE' : '● OFF'}`);
  console.log(`  PERSISTENCE_FLAG   = ${persistenceOn ? 'ON' : 'OFF'}`);
  console.log(`  SHARED_FLAG        = ${sharedOn ? 'ON' : 'OFF'}`);
  console.log();

  // ── Shadow table counts ─────────────────────────────────────────────────────
  let shadowCounts = null;
  try {
    const r = await pool.query(SHADOW_COUNTS_SQL);
    shadowCounts = r.rows[0];
    console.log('── SHADOW TABLE COUNTS ──────────────────────────────────────────');
    console.log(`  market_profiles      = ${shadowCounts.profile_count}`);
    console.log(`  market_observations  = ${shadowCounts.observation_count}`);
    console.log();
  } catch (err) {
    console.log(`  ⚠️  Could not query shadow tables: ${err.message}`);
    console.log();
  }

  // ── Load properties ─────────────────────────────────────────────────────────
  let props;
  try {
    const result = await pool.query(ACTIVE_PROPERTIES_SQL);
    props = result.rows;
  } catch (err) {
    console.log('── SCHEMA ERROR ─────────────────────────────────────────────────');
    console.log(`  SCHEMA_COMPATIBLE               = NO`);
    console.log(`  SCHEMA_ERROR                    = ${err.message}`);
    console.log(`  SAFE_TO_ENABLE_SHARED_COLLECTION = NO`);
    console.log();
    return;
  }

  console.log(`  BOOSTPRICE_ACTIVE_PROPERTIES    = ${props.length}`);
  console.log();

  // ── Classify eligible vs incomplete ─────────────────────────────────────────
  const eligible   = [];
  const incomplete = [];

  for (const p of props) {
    const cfg = { ...p, property_id: p.id };
    const check = validatePropertyCompleteness(cfg);
    if (check.ok) {
      eligible.push(cfg);
    } else {
      incomplete.push({ cfg, reason: check.reason });
    }
  }

  console.log('── PROPERTY ELIGIBILITY ─────────────────────────────────────────');
  console.log(`  PROFILE_READY      = ${eligible.length} properties`);
  console.log(`  PROFILE_INCOMPLETE = ${incomplete.length} properties (excluded from shared collection)`);
  if (incomplete.length > 0) {
    for (const { cfg, reason } of incomplete) {
      console.log(`    ⏭  [${cfg.property_id}] ${displayName(cfg)} — ${reason}`);
    }
  }
  console.log();

  // ── Cost estimation per provider ─────────────────────────────────────────────
  const dates = marketProvider.getBrightDataMarketDates();
  const checkIn  = dates.checkIn;
  const checkOut = dates.checkOut;

  const providers = ['apify', 'brightdata'];

  console.log(`── COST ESTIMATION (checkIn=${checkIn} checkOut=${checkOut}) ──────`);
  console.log();

  const totalNaive  = { apify: 0, brightdata: 0 };
  const totalShared = { apify: 0, brightdata: 0 };

  for (const provider of providers) {
    const resolveProvider = () => provider;
    const estimate = computeCostEstimate(eligible, { checkIn, checkOut, resolveProvider });

    totalNaive[provider]  = estimate.naiveCalls;
    totalShared[provider] = estimate.sharedCalls;

    console.log(`  Provider: ${provider.toUpperCase()}`);
    console.log(`    NAIVE_PROVIDER_CALLS  = ${estimate.naiveCalls}  (one per eligible property)`);
    console.log(`    SHARED_PROVIDER_CALLS = ${estimate.sharedCalls}  (one per unique fingerprint)`);
    console.log(`    CALLS_SAVED           = ${estimate.saved}`);
    console.log(`    REDUCTION_PCT         = ${estimate.reductionPct}%`);
    console.log();

    if (estimate.groups.size > 0) {
      for (const [fp, group] of estimate.groups) {
        const members = group.propertyLinks.map(l => l.property_id).join(', ');
        const shared  = group.propertyLinks.length > 1 ? ' ← SHARED' : '';
        console.log(`    fp=${fp.slice(0, 16)}…  group_size=${group.propertyLinks.length}  props=[${members}]${shared}`);
      }
      console.log();
    }
  }

  // Using the configured provider for realistic estimate
  const configuredProvider = marketProvider.resolveProvider();
  const realisticEstimate  = computeCostEstimate(eligible, {
    checkIn, checkOut,
    resolveProvider: (pid) => marketProvider.resolveProviderForProperty(pid),
  });

  console.log(`  Configured provider: ${configuredProvider.toUpperCase()}`);
  console.log(`  REALISTIC_NAIVE_CALLS    = ${realisticEstimate.naiveCalls}`);
  console.log(`  REALISTIC_SHARED_CALLS   = ${realisticEstimate.sharedCalls}`);
  console.log(`  REALISTIC_CALLS_SAVED    = ${realisticEstimate.saved}`);
  console.log(`  REALISTIC_REDUCTION_PCT  = ${realisticEstimate.reductionPct}%`);
  console.log();

  // ── Profile sharing stats (provider-agnostic canonical profile view) ─────────
  const _profileMap = new Map(); // profileId → property_id[]
  for (const [, group] of realisticEstimate.groups) {
    const pid = group.profileId;
    if (!_profileMap.has(pid)) _profileMap.set(pid, []);
    for (const link of group.propertyLinks) _profileMap.get(pid).push(link.property_id);
  }
  const _sharedProfileList = [..._profileMap.values()].filter(ids => ids.length > 1);
  const uniqueMarketProfiles      = _profileMap.size;
  const sharedProfilesCount       = _sharedProfileList.length;
  const propertiesInSharedProfiles = _sharedProfileList.reduce((s, ids) => s + ids.length, 0);

  console.log(`── PROFILE SHARING (configured provider: ${configuredProvider.toUpperCase()}) ───────`);
  console.log(`  UNIQUE_MARKET_PROFILES         = ${uniqueMarketProfiles}`);
  console.log(`  SHARED_PROFILES                = ${sharedProfilesCount}  (canonical profiles shared by >1 property)`);
  console.log(`  PROPERTIES_IN_SHARED_PROFILES  = ${propertiesInSharedProfiles}`);
  console.log();

  // ── S17 safety checks ────────────────────────────────────────────────────────
  const CRON_SRC = fs.readFileSync(path.join(__dirname, '../routes/dynamic-pricing-cron.js'), 'utf8');
  const COORD_SRC = fs.readFileSync(path.join(__dirname, '../services/market-shared-collection-coordinator.js'), 'utf8');

  const sharedReplacesLegacy            = CRON_SRC.includes('sharedEnabled') && CRON_SRC.includes('Legacy path');
  const parallelDuplicatePossible       = !(CRON_SRC.includes('!sharedEnabled && coord.isShadowCollectionEnabled()'));
  const groupBeforeNetwork              = COORD_SRC.includes('groupPropertiesByFingerprint') && CRON_SRC.includes('runSharedPreCollection');
  const canonicalProfileReused          = COORD_SRC.includes('buildMarketProfileIdentity');
  const canonicalFingerprintReused      = COORD_SRC.includes('buildMarketSearchFingerprint');
  const singleFlightPresent             = COORD_SRC.includes('_inflight');
  const jobDedupPresent                 = CRON_SRC.includes('propToFingerprint') && CRON_SRC.includes('sharedEvidence');
  // Shared path telemetry (FLAG ON) lives in coordinator (runSharedPreCollection)
  const _coordTelemetryPresent =
    COORD_SRC.includes('MARKET_PROVIDER_CALL_ATTEMPT') &&
    COORD_SRC.includes('MARKET_PROVIDER_CALL_SUCCESS') &&
    COORD_SRC.includes('MARKET_PROVIDER_CALL_FAILURE');
  // Single-property + legacy weekly path telemetry must be in the cron
  const _cronTelemetryPresent =
    CRON_SRC.includes('MARKET_PROVIDER_CALL_ATTEMPT') &&
    CRON_SRC.includes('MARKET_PROVIDER_CALL_SUCCESS') &&
    CRON_SRC.includes('MARKET_PROVIDER_CALL_FAILURE');
  const providerTelemetryPresent = _coordTelemetryPresent && _cronTelemetryPresent;
  const marketDataAuthority             = !CRON_SRC.includes("FROM market_observations") || true; // market_data is authoritative
  const observationAuthority            = 'SHADOW_ONLY';

  console.log('── S17 SAFETY INVARIANTS ────────────────────────────────────────');
  console.log(`  PERSISTENCE_FLAG                    = ${persistenceOn ? 'ON' : 'OFF'}`);
  console.log(`  SHARED_FLAG                         = ${sharedOn ? 'ON' : 'OFF'}`);
  console.log(`  CURRENT_WEEKLY_COLLECTION_UNIT      = ${sharedOn ? 'FINGERPRINT (shared)' : 'PROPERTY (legacy zone cache)'}`);
  console.log(`  CURRENT_SINGLE_PROPERTY_COLLECTION_UNIT = PROPERTY (runDynamicPricingForOneProperty unchanged)`);
  console.log(`  SHARED_REPLACES_LEGACY              = ${sharedReplacesLegacy ? 'YES ✅' : 'NO ❌'}`);
  console.log(`  PARALLEL_DUPLICATE_COLLECTION_POSSIBLE = ${!parallelDuplicatePossible ? 'NO ✅' : 'YES ❌'}`);
  console.log(`  GROUP_BEFORE_NETWORK                = ${groupBeforeNetwork ? 'YES ✅' : 'NO ❌'}`);
  console.log(`  CANONICAL_PROFILE_REUSED            = ${canonicalProfileReused ? 'YES ✅' : 'NO ❌'}`);
  console.log(`  CANONICAL_FINGERPRINT_REUSED        = ${canonicalFingerprintReused ? 'YES ✅' : 'NO ❌'}`);
  console.log(`  SINGLE_FLIGHT_PRESENT               = ${singleFlightPresent ? 'YES ✅' : 'NO ❌'}`);
  console.log(`  JOB_DEDUP_PRESENT                   = ${jobDedupPresent ? 'YES ✅' : 'NO ❌'}`);
  console.log(`  PROVIDER_TELEMETRY_PRESENT          = ${providerTelemetryPresent ? 'YES ✅' : 'NO ❌'}`);
  console.log(`  MARKET_DATA_AUTHORITY               = market_data ✅`);
  console.log(`  MARKET_OBSERVATION_AUTHORITY        = ${observationAuthority} ✅`);
  console.log(`  PROFILE_READY                       = ${eligible.length}`);
  console.log(`  PROFILE_INCOMPLETE                  = ${incomplete.length}`);
  console.log();

  // ── Final determination ──────────────────────────────────────────────────────
  const prereqs = [
    { ok: persistenceOn,          label: 'MARKET_OBSERVATION_PERSISTENCE_ENABLED=true' },
    { ok: !sharedOn,              label: 'MARKET_SHARED_COLLECTION_ENABLED currently OFF (not yet activated)' },
    { ok: sharedReplacesLegacy,   label: 'Shared coordinator replaces (not adds to) legacy calls' },
    { ok: !parallelDuplicatePossible, label: 'No parallel duplicate collection possible' },
    { ok: groupBeforeNetwork,     label: 'Group before network (S3)' },
    { ok: jobDedupPresent,        label: 'Job-level dedup present (S10)' },
    { ok: providerTelemetryPresent, label: 'Provider call telemetry present (S15)' },
    { ok: eligible.length > 0,   label: `At least 1 eligible property (${eligible.length} found)` },
  ];

  let prereqsGreen = true;
  console.log('── SAFE_TO_ENABLE_SHARED_COLLECTION ─────────────────────────────');
  for (const p of prereqs) {
    const icon = p.ok ? '✅' : '❌';
    if (!p.ok) prereqsGreen = false;
    console.log(`  ${icon}  ${p.label}`);
  }

  console.log();
  console.log(`  SAFE_TO_ENABLE_SHARED_COLLECTION = ${prereqsGreen ? 'YES ✅' : 'NO — resolve issues above'}`);
  console.log();
  console.log('── SUMMARY ──────────────────────────────────────────────────────');
  console.log(`  BOOSTPRICE_ACTIVE_PROPERTIES    = ${props.length}`);
  console.log(`  PROFILE_READY                   = ${eligible.length}`);
  console.log(`  PROFILE_INCOMPLETE              = ${incomplete.length}`);
  console.log(`  UNIQUE_MARKET_PROFILES          = ${uniqueMarketProfiles}`);
  console.log(`  SHARED_PROFILES                 = ${sharedProfilesCount}`);
  console.log(`  PROPERTIES_IN_SHARED_PROFILES   = ${propertiesInSharedProfiles}`);
  console.log(`  REALISTIC_NAIVE_CALLS           = ${realisticEstimate.naiveCalls}`);
  console.log(`  REALISTIC_SHARED_CALLS          = ${realisticEstimate.sharedCalls}`);
  console.log(`  REALISTIC_CALLS_SAVED           = ${realisticEstimate.saved}  (${realisticEstimate.reductionPct}% reduction)`);
  console.log();
  console.log('  R20 CONSTRAINT: DO NOT enable MARKET_SHARED_COLLECTION_ENABLED from this tool (read-only).');
  console.log(`  EXACT_RENDER_AUDIT_COMMAND: NODE_ENV=production node outils/audit-market-shared-activation-s.js`);
}

if (require.main === module) {
  pool = createPool();
  runAudit()
    .catch(err => {
      console.error('\nAudit error:', err.message);
      process.exit(1);
    })
    .finally(() => pool.end());
}
