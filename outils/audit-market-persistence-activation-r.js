'use strict';
/**
 * P1.2-B5-BK-R — Market Observation Persistence Activation Audit (READ ONLY)
 *
 * State-aware audit: reports the correct status for both PRE-ACTIVATION
 * and POST-ACTIVATION states. Section F adapts to the current flag state.
 *
 * Possible states (reported in section F):
 *   PRE_ACTIVATION            persistence=false, prerequisites pass → ready to activate
 *   PERSISTENCE_ACTIVE_SHADOW persistence=true, shared=false → EXPECTED PRODUCTION STATE ✅
 *   PERSISTENCE_AND_SHARED_ACTIVE persistence=true, shared=true → requires separate review
 *
 * Reports:
 *   A  Flag status (both persistence flags)
 *   B  Bridge-ready properties (valid geo + currency → profile can be built)
 *   C  Profile-incomplete properties (Ti Junot and similar — bridge will skip)
 *   D  Current shadow table state (market_profiles, market_observations counts)
 *   E  DataSource eligibility (which providers bridge will accept vs skip)
 *   F  State-aware status (PRE_ACTIVATION / PERSISTENCE_ACTIVE_SHADOW / PERSISTENCE_AND_SHARED_ACTIVE)
 *
 * SAFETY:
 *   DB_WRITES              = 0  always
 *   NETWORK_CALLS          = 0  always
 *   BRIGHT_DATA_CALLS      = 0  always
 *   MARKET_DATA_WRITES     = 0  always
 *   PRICING_WRITES         = 0  always
 *   CHANNEX_CALLS          = 0  always
 *
 * Usage:
 *   NODE_ENV=production node outils/audit-market-persistence-activation-r.js
 */

const { createPool }               = require('../services/db-pool');
const { hasValidCoordinates }      = require('../services/market-geo-validator');
const { buildMarketProfileIdentity } = require('../services/market-search-identity');
const { mapDataSourceToProvider }  = require('../services/market-observation-persistence-bridge');

// Pool only created when running directly — not when required for exports
let pool = null;

const ACTIVE_PROPERTIES_SQL = `
  SELECT
    p.id,
    p.internal_name,
    p.name,
    p.latitude,
    p.longitude,
    p.currency,
    p.max_guests,
    p.address IS NOT NULL AND p.address != '' AS has_address,
    p.timezone IS NOT NULL AS has_timezone,
    p.country_code,
    pc.bedrooms,
    pc.property_type,
    pc.is_active
  FROM pricing_config pc
  JOIN properties p ON p.id = pc.property_id AND p.user_id = pc.user_id
  WHERE pc.is_active = TRUE
  ORDER BY p.internal_name, p.name
`;

const SHADOW_COUNTS_SQL = `
  SELECT
    (SELECT COUNT(*)::int FROM market_profiles)       AS profile_count,
    (SELECT COUNT(*)::int FROM market_observations)   AS observation_count,
    (SELECT COUNT(*)::int FROM market_observation_properties) AS link_count
`;

function displayName(p) {
  return p.internal_name || p.name || `property_${p.id}`;
}

/**
 * Determine the activation state from flag values.
 * Pure function — exported for test inspection.
 *
 * @param {boolean} persistenceOn
 * @param {boolean} sharedOn
 * @returns {'PRE_ACTIVATION'|'PERSISTENCE_ACTIVE_SHADOW'|'PERSISTENCE_AND_SHARED_ACTIVE'|'SHARED_ONLY_NO_PERSISTENCE'}
 */
function determineActivationState(persistenceOn, sharedOn) {
  if (!persistenceOn && !sharedOn) return 'PRE_ACTIVATION';
  if (persistenceOn  && !sharedOn) return 'PERSISTENCE_ACTIVE_SHADOW';
  if (persistenceOn  && sharedOn)  return 'PERSISTENCE_AND_SHARED_ACTIVE';
  return 'SHARED_ONLY_NO_PERSISTENCE';
}

async function runAudit() {
  const SEP = '═'.repeat(70);
  console.log(SEP);
  console.log('  P1.2-B5-BK-R — Market Observation Persistence Activation Audit');
  console.log('  MODE: read-only');
  console.log('  DB_WRITES=0  NETWORK_CALLS=0  BRIGHT_DATA_CALLS=0');
  console.log(SEP);
  console.log();

  // ── A: Flag status ────────────────────────────────────────────────────────────
  const persistenceFlag  = process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED;
  const sharedFlag       = process.env.MARKET_SHARED_COLLECTION_ENABLED;
  const persistenceOn    = persistenceFlag === 'true';
  const sharedOn         = sharedFlag      === 'true';

  console.log('── A: FLAG STATUS ───────────────────────────────────────────────');
  console.log(`  MARKET_OBSERVATION_PERSISTENCE_ENABLED = ${persistenceFlag ?? '(unset)'}  ${persistenceOn ? '⚡ ACTIVE' : '● OFF'}`);
  console.log(`  MARKET_SHARED_COLLECTION_ENABLED       = ${sharedFlag      ?? '(unset)'}  ${sharedOn ? '⚡ ACTIVE' : '● OFF'}`);
  console.log();

  // ── D: Shadow table state ─────────────────────────────────────────────────────
  let profileCount = 0;
  let observationCount = 0;
  let linkCount = 0;
  try {
    const r = await pool.query(SHADOW_COUNTS_SQL);
    ({ profile_count: profileCount, observation_count: observationCount, link_count: linkCount } = r.rows[0]);
  } catch (err) {
    console.log(`── D: SHADOW TABLE STATE ─────────────────────────────────────────`);
    console.log(`  ⚠️  Could not query shadow tables: ${err.message}`);
    console.log(`     (Tables may not exist yet — run migrations first)`);
    console.log();
  }

  if (profileCount !== undefined) {
    console.log('── D: SHADOW TABLE STATE ────────────────────────────────────────');
    console.log(`  market_profiles                = ${profileCount}`);
    console.log(`  market_observations            = ${observationCount}`);
    console.log(`  market_observation_properties  = ${linkCount}`);
    console.log();
  }

  // ── Fetch active properties ───────────────────────────────────────────────────
  const result = await pool.query(ACTIVE_PROPERTIES_SQL);
  const props  = result.rows;

  console.log(`Active pricing-config properties: ${props.length}`);
  console.log();

  // ── B / C: Classify properties ────────────────────────────────────────────────
  const bridgeReady    = [];
  const profileInvalid = [];

  for (const p of props) {
    const name     = displayName(p);
    const validGeo = hasValidCoordinates(p.latitude, p.longitude);
    const hasCur   = !!(p.currency && /^[A-Z]{3}$/.test(p.currency));

    let profileOk  = false;
    let profileReason = 'missing_geo_or_currency';

    if (validGeo && hasCur) {
      const id = buildMarketProfileIdentity({
        latitude:           p.latitude,
        longitude:          p.longitude,
        currency:           p.currency,
        targetGuests:       p.max_guests    ?? null,
        targetBedrooms:     p.bedrooms      ?? null,
        targetPropertyType: p.property_type ?? null,
      });
      profileOk     = id.valid;
      profileReason = id.reason;
    }

    const entry = { id: p.id, name, validGeo, hasCurrency: hasCur, profileReason };
    if (profileOk) bridgeReady.push(entry);
    else           profileInvalid.push(entry);
  }

  // ── B: Bridge-ready ───────────────────────────────────────────────────────────
  console.log(`── B: BRIDGE-READY (${bridgeReady.length}) — bridge will write observations ──`);
  if (bridgeReady.length === 0) {
    console.log('  (none)');
  }
  for (const p of bridgeReady) {
    console.log(`  [${p.id}] ${p.name}`);
  }
  console.log();

  // ── C: Profile-incomplete (bridge will skip with OBS_PERSIST_SKIPPED_PROFILE_INCOMPLETE) ──
  console.log(`── C: PROFILE-INCOMPLETE (${profileInvalid.length}) — bridge will skip ────`);
  if (profileInvalid.length === 0) {
    console.log('  (none)');
  }
  for (const p of profileInvalid) {
    const flags = [
      p.validGeo    ? 'geo:✓' : 'geo:✗ (null lat/lon)',
      p.hasCurrency ? 'cur:✓' : 'cur:✗ (missing currency)',
      `reason:${p.profileReason}`,
    ].join('  ');
    console.log(`  [${p.id}] ${p.name}`);
    console.log(`         ${flags}`);
  }
  console.log();

  // ── E: DataSource eligibility ─────────────────────────────────────────────────
  console.log('── E: DATASOURCE ELIGIBILITY ────────────────────────────────────');
  const sources = [
    { source: 'brightdata_live',         expected: 'airbnb'  },
    { source: 'apify_live',              expected: 'airbnb'  },
    { source: 'apify',                   expected: 'airbnb'  },
    { source: 'brightdata_booking_live', expected: 'booking' },
    { source: 'mock',                    expected: null      },
  ];
  for (const { source, expected } of sources) {
    const mapped = mapDataSourceToProvider(source);
    const icon   = mapped ? '✅' : '⏭ ';
    const note   = mapped ? `→ provider='${mapped}'` : '→ skip (mock/unknown)';
    console.log(`  ${icon} ${source.padEnd(28)} ${note}`);
  }
  console.log();

  // ── F: State-aware status ─────────────────────────────────────────────────────
  const hasBridgeReady   = bridgeReady.length > 0;
  const tablesAccessible = profileCount !== undefined;

  const ACTIVATION_STATE = determineActivationState(persistenceOn, sharedOn);

  console.log('── F: CURRENT STATE ─────────────────────────────────────────────');
  console.log(`  STATE = ${ACTIVATION_STATE}`);
  console.log();

  // Prerequisites (apply in all states)
  const prereqs = [
    { ok: tablesAccessible, label: 'Shadow tables accessible (market_profiles, market_observations)' },
    { ok: hasBridgeReady,   label: `At least 1 bridge-ready property (${bridgeReady.length} found)` },
  ];

  let prereqsGreen = true;
  for (const c of prereqs) {
    const icon = c.ok ? '✅' : '❌';
    if (!c.ok) prereqsGreen = false;
    console.log(`  ${icon}  ${c.label}`);
  }
  console.log();

  // State-specific conclusion
  if (ACTIVATION_STATE === 'PRE_ACTIVATION') {
    if (prereqsGreen) {
      console.log('  ✅ Prerequisites pass — ready to activate.');
      console.log('  To activate (Render env vars):');
      console.log('    MARKET_OBSERVATION_PERSISTENCE_ENABLED=true');
      console.log('  (MARKET_SHARED_COLLECTION_ENABLED is NOT required for the bridge)');
    } else {
      console.log('  ⚠️  Some prerequisites failed — resolve before activating.');
    }
  } else if (ACTIVATION_STATE === 'PERSISTENCE_ACTIVE_SHADOW') {
    if (prereqsGreen) {
      console.log('  ✅ PERSISTENCE_ACTIVE_SHADOW — bridge is live and healthy.');
      console.log('  Observations will be written on the next pricing cron run.');
      console.log('  MARKET_SHARED_COLLECTION_ENABLED is OFF — no extra BD calls.');
    } else {
      console.log('  ⚠️  Bridge is active but some prerequisites are not met — investigate.');
    }
  } else if (ACTIVATION_STATE === 'PERSISTENCE_AND_SHARED_ACTIVE') {
    console.log('  ⚠️  PERSISTENCE_AND_SHARED_ACTIVE — both flags are ON.');
    console.log('  Shadow collection will make additional Bright Data calls.');
    console.log('  This requires separate approval — see R spec.');
  } else {
    console.log('  ⚠️  Unexpected flag combination — review env vars.');
  }

  console.log();
  console.log('── SUMMARY ──────────────────────────────────────────────────────');
  console.log(`  ACTIVATION_STATE        = ${ACTIVATION_STATE}`);
  console.log(`  Total active properties = ${props.length}`);
  console.log(`  Bridge-ready            = ${bridgeReady.length}  (will produce observations)`);
  console.log(`  Profile-incomplete      = ${profileInvalid.length}  (will be skipped by bridge)`);
  console.log(`  Existing profiles       = ${profileCount ?? '?'}`);
  console.log(`  Existing observations   = ${observationCount ?? '?'}`);
  console.log();
  console.log('  R15 CONSTRAINT: DO NOT modify Render env vars from this tool (read-only).');
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

// Exported for test inspection
module.exports = { ACTIVE_PROPERTIES_SQL, SHADOW_COUNTS_SQL, determineActivationState };
