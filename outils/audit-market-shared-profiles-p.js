'use strict';
/**
 * P1.2-B5-BK-P12-FIX — Market Shared Profiles Preview Audit (READ ONLY)
 *
 * PREVIEW: Calculates theoretical market profiles from CURRENT PROPERTY DATA
 * using the SAME canonical profile/search identity code used in production
 * by market-shared-collection-coordinator.js and dynamic-pricing-cron.js.
 *
 * No profile rows need to exist — this answers:
 *   "If P were enabled right now, what profile would each property receive?"
 *   "Which properties would share a market search and save Bright Data credits?"
 *
 * ABSOLUTE SAFETY:
 *   DB_WRITES              = 0  read-only SELECT queries only
 *   NETWORK_CALLS          = 0  (DB connect only)
 *   BRIGHT_DATA_CALLS      = 0  no provider calls
 *   PRODUCTION_WRITES      = 0  read-only
 *   PRICING_WRITES         = 0  always
 *   CHANNEX_CALLS          = 0  always
 *   SAFE_TO_ACTIVATE       = NO (preview only, does not activate anything)
 *
 * Usage:
 *   NODE_ENV=production node outils/audit-market-shared-profiles-p.js
 */

const { createPool }               = require('../services/db-pool');
const {
  buildMarketProfileIdentity,
  buildMarketSearchFingerprint,
}                                  = require('../services/market-search-identity');
const { getBrightDataMarketDates } = require('../services/market-provider');
const { hasValidCoordinates }      = require('../services/market-geo-validator');

const pool = createPool();

// Display name — mirrors server.js displayName() helper
function displayName(p) {
  return p.internal_name || p.name || `property_${p.property_id}`;
}

// Count rows in the three market tables (used for zero-write proof)
async function getMarketTableCounts() {
  const [a, b, c] = await Promise.all([
    pool.query('SELECT COUNT(*) AS cnt FROM market_profiles'),
    pool.query('SELECT COUNT(*) AS cnt FROM market_profile_properties'),
    pool.query('SELECT COUNT(*) AS cnt FROM market_observations'),
  ]);
  return {
    profiles: parseInt(a.rows[0].cnt, 10),
    assignments: parseInt(b.rows[0].cnt, 10),
    observations: parseInt(c.rows[0].cnt, 10),
  };
}

async function run() {
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('  P12-FIX — Market Shared Profiles Preview Audit (READ ONLY)');
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('  Uses canonical profile/fingerprint code — same as production P path');
  console.log('  DB_WRITES=0  NETWORK_CALLS=0  BRIGHT_DATA_CALLS=0');
  console.log('══════════════════════════════════════════════════════════════════════\n');

  // ── Zero-write proof: snapshot BEFORE ────────────────────────────────────────
  const before = await getMarketTableCounts();

  // ── TOTAL_PROPERTIES ─────────────────────────────────────────────────────────
  const totalPropsRow = await pool.query('SELECT COUNT(*) AS cnt FROM properties');
  const TOTAL_PROPERTIES = parseInt(totalPropsRow.rows[0].cnt, 10);

  // ── Active pricing configs — exact cron join (pc.* + selected p.* columns) ──
  // This mirrors the production query in dynamic-pricing-cron.js runDynamicPricingJob()
  const activeResult = await pool.query(
    `SELECT pc.property_id, pc.user_id, pc.bedrooms, pc.property_type,
            p.name, p.internal_name,
            p.latitude, p.longitude, p.country_code, p.currency, p.max_guests
       FROM pricing_config pc
       JOIN properties  p ON p.id = pc.property_id AND p.user_id = pc.user_id
      WHERE pc.is_active = TRUE
      ORDER BY pc.created_at`
  );
  const configs = activeResult.rows;
  const BOOSTPRICE_ACTIVE_PROPERTIES = configs.length;

  // ── Property completeness analysis ────────────────────────────────────────────
  // Mirror the EXACT cron skip logic from _runShadowCollectionPhase():
  //   Step A: canonical coordinate check via hasValidCoordinates (Q3 — replaces truthy check)
  //   Step B: canonical profile builder validity check (buildMarketProfileIdentity)

  const missingCounts = {
    latitude:    0,
    longitude:   0,
    currency:    0,
    max_guests:  0,  // optional but material — affects profile ID
    bedrooms:    0,  // optional but material — affects profile ID
  };

  let shadowEligible   = 0;  // passes cron's coordinate check
  const completeProps  = [];  // passes canonical builder → valid profile
  const incompleteProps = []; // fails either check

  for (const cfg of configs) {
    if (!hasValidCoordinates(cfg.latitude, cfg.longitude)) {
      missingCounts.latitude++;
      missingCounts.longitude++;
    }
    if (!cfg.currency)  missingCounts.currency++;
    if (cfg.max_guests == null) missingCounts.max_guests++;
    if (cfg.bedrooms   == null) missingCounts.bedrooms++;

    // Step A — canonical coordinate check (same as production cron)
    if (!hasValidCoordinates(cfg.latitude, cfg.longitude) || !cfg.currency) {
      incompleteProps.push({ cfg, reason: 'missing_lat_lon_or_currency' });
      continue;
    }
    shadowEligible++;

    // Step B — canonical profile builder (same function as coordinator)
    const identity = buildMarketProfileIdentity({
      latitude:           cfg.latitude,
      longitude:          cfg.longitude,
      currency:           cfg.currency,
      targetGuests:       cfg.max_guests    ?? null,
      targetBedrooms:     cfg.bedrooms      ?? null,
      targetPropertyType: cfg.property_type ?? null,
    });

    if (identity.valid) {
      completeProps.push({ cfg, identity });
    } else {
      shadowEligible--;  // coord-check passed but builder-failed
      incompleteProps.push({ cfg, reason: identity.reason });
    }
  }

  const SHADOW_ELIGIBLE_PROPERTIES  = shadowEligible;
  const PROFILE_COMPLETE_PROPERTIES = completeProps.length;
  const PROFILE_INCOMPLETE_PROPERTIES = incompleteProps.length;

  // ── B: Group properties by market profile ─────────────────────────────────────
  // Same grouping logic as _runShadowCollectionPhase() in the cron
  const profileGroups = new Map(); // profileId → { identity, dimensions, properties[] }

  for (const { cfg, identity } of completeProps) {
    const pid = identity.profileId;
    if (!profileGroups.has(pid)) {
      profileGroups.set(pid, {
        identity,
        dimensions: identity.dimensions,
        properties: [],
      });
    }
    profileGroups.get(pid).properties.push({
      property_id:  String(cfg.property_id),
      display_name: displayName(cfg),
    });
  }

  const allGroups    = [...profileGroups.values()];
  const sharedGroups = allGroups.filter(g => g.properties.length > 1);
  const singleGroups = allGroups.filter(g => g.properties.length === 1);

  const UNIQUE_MARKET_PROFILES       = profileGroups.size;
  const SINGLE_PROPERTY_PROFILES     = singleGroups.length;
  const SHARED_PROFILES              = sharedGroups.length;
  const PROPERTIES_IN_SHARED_PROFILES = sharedGroups.reduce((s, g) => s + g.properties.length, 0);
  const MAX_PROPERTIES_IN_ONE_PROFILE = allGroups.length > 0
    ? Math.max(...allGroups.map(g => g.properties.length))
    : 0;

  // ── C: Search fingerprint preview ─────────────────────────────────────────────
  // Use canonical date window — same function as the cron calls
  const { checkIn, checkOut } = getBrightDataMarketDates();

  const airbnbFps  = new Set();
  const bookingFps = new Set();

  for (const { cfg } of completeProps) {
    const fpBase = {
      latitude:           cfg.latitude,
      longitude:          cfg.longitude,
      currency:           cfg.currency,
      targetGuests:       cfg.max_guests    ?? null,
      targetBedrooms:     cfg.bedrooms      ?? null,
      targetPropertyType: cfg.property_type ?? null,
      checkIn,
      checkOut,
      maxListings: 100,
    };
    const fpA = buildMarketSearchFingerprint({ ...fpBase, provider: 'airbnb' });
    const fpB = buildMarketSearchFingerprint({ ...fpBase, provider: 'booking' });
    if (fpA.valid) airbnbFps.add(fpA.fingerprint);
    if (fpB.valid) bookingFps.add(fpB.fingerprint);
  }

  const N = PROFILE_COMPLETE_PROPERTIES;
  const AIRBNB_NAIVE_CALLS   = N;
  const AIRBNB_SHARED_CALLS  = airbnbFps.size;
  const AIRBNB_CALLS_SAVED   = AIRBNB_NAIVE_CALLS - AIRBNB_SHARED_CALLS;
  const AIRBNB_REDUCTION_PCT = N > 0 ? Math.round(AIRBNB_CALLS_SAVED / AIRBNB_NAIVE_CALLS * 100) : 0;

  const DUAL_SOURCE_NAIVE_CALLS   = N * 2;
  const DUAL_SOURCE_SHARED_CALLS  = airbnbFps.size + bookingFps.size;
  const DUAL_SOURCE_CALLS_SAVED   = DUAL_SOURCE_NAIVE_CALLS - DUAL_SOURCE_SHARED_CALLS;
  const DUAL_SOURCE_REDUCTION_PCT = DUAL_SOURCE_NAIVE_CALLS > 0
    ? Math.round(DUAL_SOURCE_CALLS_SAVED / DUAL_SOURCE_NAIVE_CALLS * 100)
    : 0;

  // ── D: Stored state (separate from preview — may be 0) ───────────────────────
  const storedProfilesRow     = await pool.query('SELECT COUNT(*) AS cnt FROM market_profiles');
  const storedAssignmentsRow  = await pool.query('SELECT COUNT(*) AS cnt FROM market_profile_properties');
  const STORED_MARKET_PROFILES    = parseInt(storedProfilesRow.rows[0].cnt, 10);
  const STORED_PROFILE_ASSIGNMENTS = parseInt(storedAssignmentsRow.rows[0].cnt, 10);

  // ── Zero-write proof: snapshot AFTER ─────────────────────────────────────────
  const after = await getMarketTableCounts();

  // ═══════════════════════════════════════════════════════════════════════════════
  // OUTPUT
  // ═══════════════════════════════════════════════════════════════════════════════

  // ── A: Preview State ──────────────────────────────────────────────────────────
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('  A — PREVIEW STATE (computed from current property data)');
  console.log('══════════════════════════════════════════════════════════════════════\n');

  console.log(`  TOTAL_PROPERTIES                = ${TOTAL_PROPERTIES}`);
  console.log(`  BOOSTPRICE_ACTIVE_PROPERTIES    = ${BOOSTPRICE_ACTIVE_PROPERTIES}`);
  console.log(`  SHADOW_ELIGIBLE_PROPERTIES      = ${SHADOW_ELIGIBLE_PROPERTIES}   (pass cron coordinate check)`);
  console.log(`  PROFILE_COMPLETE_PROPERTIES     = ${PROFILE_COMPLETE_PROPERTIES}   (valid canonical profile)`);
  console.log(`  PROFILE_INCOMPLETE_PROPERTIES   = ${PROFILE_INCOMPLETE_PROPERTIES}   (would be skipped by P)`);

  if (PROFILE_INCOMPLETE_PROPERTIES > 0) {
    console.log('\n  ── Required fields missing from active properties ──');
    console.log(`    MISSING_LATITUDE    = ${missingCounts.latitude}`);
    console.log(`    MISSING_LONGITUDE   = ${missingCounts.longitude}`);
    console.log(`    MISSING_CURRENCY    = ${missingCounts.currency}`);
    console.log(`    MISSING_MAX_GUESTS  = ${missingCounts.max_guests}   (optional — affects profile dimensions)`);
    console.log(`    MISSING_BEDROOMS    = ${missingCounts.bedrooms}   (optional — affects profile dimensions)`);
    if (incompleteProps.length > 0 && incompleteProps.length <= 10) {
      console.log('\n  Incomplete properties:');
      for (const { cfg, reason } of incompleteProps) {
        console.log(`    property_id=${cfg.property_id}  "${displayName(cfg)}"  reason=${reason}`);
      }
    }
  } else {
    console.log('\n  All active properties have complete profile data. ✓');
  }

  // ── B: Profile Groups ─────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('  B — Theoretical Profile Groups');
  console.log('══════════════════════════════════════════════════════════════════════\n');

  console.log(`  UNIQUE_MARKET_PROFILES          = ${UNIQUE_MARKET_PROFILES}`);
  console.log(`  SINGLE_PROPERTY_PROFILES        = ${SINGLE_PROPERTY_PROFILES}`);
  console.log(`  SHARED_PROFILES                 = ${SHARED_PROFILES}`);
  console.log(`  PROPERTIES_IN_SHARED_PROFILES   = ${PROPERTIES_IN_SHARED_PROFILES}`);
  console.log(`  MAX_PROPERTIES_IN_ONE_PROFILE   = ${MAX_PROPERTIES_IN_ONE_PROFILE}`);

  if (UNIQUE_MARKET_PROFILES > 0) {
    console.log('\n  ── All profile groups (anonymized dimensions) ──');
    // Sort: shared profiles first (by size DESC), then singles
    const sorted = [...allGroups].sort((a, b) => b.properties.length - a.properties.length);
    for (const g of sorted) {
      const d   = g.dimensions;
      const pid = g.identity.profileId;
      const tag = g.properties.length > 1 ? ' ◄ SHARED' : '';
      console.log(
        `    ${pid.slice(0, 16)}…  ` +
        `guests=${d.guests ?? '?'}  bed=${d.bedrooms ?? '?'}  type=${d.propType}  ` +
        `cur=${d.currency}  props=${g.properties.length}${tag}`
      );
    }

    if (SHARED_PROFILES > 0) {
      console.log('\n  ── Shared groups — property identification (internal only) ──');
      for (const g of sharedGroups.sort((a, b) => b.properties.length - a.properties.length)) {
        const pid = g.identity.profileId;
        console.log(`\n  GROUP ${pid.slice(0, 16)}…  (${g.properties.length} properties)`);
        g.properties.forEach((p, i) => {
          console.log(`    M${i + 1}  property_id=${p.property_id}  "${p.display_name}"`);
        });
      }
    }
  } else {
    console.log('\n  No profile-complete properties found — profile table would be empty.');
  }

  // ── C: Fingerprint Preview & Call Savings ─────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('  C — Search Fingerprint Preview & Call Savings');
  console.log('══════════════════════════════════════════════════════════════════════\n');

  console.log(`  Preview window (canonical — getBrightDataMarketDates, Europe/Paris):`);
  console.log(`    checkIn  = ${checkIn}  (today+14 calendar days)`);
  console.log(`    checkOut = ${checkOut}  (checkIn+1 day)`);
  console.log(`    maxListings = 100 (production default)`);

  console.log('\n  AIRBNB ONLY:');
  console.log(`    AIRBNB_NAIVE_CALLS       = ${AIRBNB_NAIVE_CALLS}   (1 call × ${N} properties)`);
  console.log(`    AIRBNB_SHARED_CALLS      = ${AIRBNB_SHARED_CALLS}   (1 call × ${UNIQUE_MARKET_PROFILES} unique profiles)`);
  console.log(`    AIRBNB_CALLS_SAVED       = ${AIRBNB_CALLS_SAVED}`);
  console.log(`    AIRBNB_REDUCTION_PCT     = ${AIRBNB_REDUCTION_PCT}%`);

  console.log('\n  AIRBNB + BOOKING (dual source):');
  console.log(`    DUAL_SOURCE_NAIVE_CALLS  = ${DUAL_SOURCE_NAIVE_CALLS}   (2 calls × ${N} properties)`);
  console.log(`    DUAL_SOURCE_SHARED_CALLS = ${DUAL_SOURCE_SHARED_CALLS}   (${airbnbFps.size} airbnb + ${bookingFps.size} booking)`);
  console.log(`    DUAL_SOURCE_CALLS_SAVED  = ${DUAL_SOURCE_CALLS_SAVED}`);
  console.log(`    DUAL_SOURCE_REDUCTION_PCT= ${DUAL_SOURCE_REDUCTION_PCT}%`);

  // ── D: Stored State ───────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('  D — STORED STATE (what exists in DB right now — separate from preview)');
  console.log('══════════════════════════════════════════════════════════════════════\n');

  console.log(`  STORED_MARKET_PROFILES      = ${STORED_MARKET_PROFILES}`);
  console.log(`  STORED_PROFILE_ASSIGNMENTS  = ${STORED_PROFILE_ASSIGNMENTS}`);
  if (STORED_MARKET_PROFILES === 0) {
    console.log('  (Expected: both 0 — P persistence not yet enabled)');
  }

  // ── E: Zero-write proof ───────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('  E — Zero-write proof');
  console.log('══════════════════════════════════════════════════════════════════════\n');

  const profilesDelta     = after.profiles     - before.profiles;
  const assignmentsDelta  = after.assignments  - before.assignments;
  const observationsDelta = after.observations - before.observations;

  console.log(`  market_profiles           before=${before.profiles}     after=${after.profiles}     delta=${profilesDelta}`);
  console.log(`  market_profile_properties before=${before.assignments}  after=${after.assignments}  delta=${assignmentsDelta}`);
  console.log(`  market_observations       before=${before.observations} after=${after.observations} delta=${observationsDelta}`);

  const writesOk = profilesDelta === 0 && assignmentsDelta === 0 && observationsDelta === 0;
  console.log(`\n  DB_WRITES       = ${writesOk ? 0 : 'UNEXPECTED'}${writesOk ? '' : ' ← BUG'}`);
  console.log('  NETWORK_CALLS   = 0');
  console.log('  BD_CREDITS      = 0');

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('  Audit complete — no writes performed.');
  console.log('  SAFE_TO_ENABLE_PERSISTENCE      = NO  (requires P21 activation plan)');
  console.log('  SAFE_TO_ENABLE_SHARED_COLLECTION = NO  (requires P21 activation plan)');
  console.log('  SAFE_TO_ACTIVATE_PRODUCTION      = NO');
  console.log('══════════════════════════════════════════════════════════════════════\n');
}

run()
  .catch(err => { console.error('Audit error:', err.message); process.exit(1); })
  .finally(() => pool.end());
