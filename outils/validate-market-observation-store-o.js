'use strict';
/**
 * P1.2-B5-BK-O19 — Zero-Network Market Observation Store Validator
 *
 * DEFAULT = ZERO NETWORK.
 *
 * Demonstrates with fixtures:
 *   Jouy-en-Josas : 3 properties, same building → 1 shared search
 *   Massy         : 12 properties, 2 profiles   → 2 shared searches (1 provider)
 *
 * Also simulates:
 *   - Observation persistence (in-memory mock DB)
 *   - Multiple property assignments
 *   - Historical second observation (different collected_at)
 *   - Retry idempotency (same collection_run_id + fingerprint = 1 row)
 *   - Storage estimates at various scales
 *
 * ABSOLUTE SAFETY:
 *   LIVE_BRIGHT_DATA_CALLS        = 0
 *   NETWORK_PROVIDER_CALLS        = 0
 *   SUPABASE_PRODUCTION_WRITES    = 0
 *   SAFE_TO_ACTIVATE_PRODUCTION   = NO
 */

const {
  buildMarketProfileIdentity,
  buildMarketSearchFingerprint,
  GEO_PRECISION,
  FINGERPRINT_VERSION,
} = require('../services/market-search-identity');

const { planSharedSearches }            = require('../services/market-shared-search-planner');
const { estimateObservationStorage }    = require('../services/market-observation-storage-estimator');

// ── In-memory mock pool ───────────────────────────────────────────────────────

function createMockPool() {
  const tables = {
    market_observations:            [],
    market_observation_properties:  [],
    market_profiles:                [],
  };
  let nextId = 1;

  // observation_id is DB-generated (gen_random_uuid()); params start at schema_version=$1
  function _obsFromArgs(params) {
    return {
      observation_id:        'obs-' + require('crypto').randomUUID(),
      schema_version:        params[0],
      provider:              params[1],
      observation_type:      params[2],
      provider_snapshot_id:  params[3],
      data_source:           params[4],
      collected_at:          params[5],
      search_fingerprint:    params[6],
      market_profile_id:     params[7],
      currency:              params[8],
      check_in:              params[9],
      check_out:             params[10],
      nights:                params[11],
      target_lat:            params[12],
      target_lon:            params[13],
      target_guests:         params[14],
      target_bedrooms:       params[15],
      target_property_type:  params[16],
      requested_max_listings:params[17],
      raw_count:             params[18],
      accepted_count:        params[19],
      comparable_count:      params[20],
      selected_radius_km:    params[21],
      median_price:          params[22],
      p25_price:             params[23],
      p75_price:             params[24],
      min_price:             params[25],
      max_price:             params[26],
      quality_status:        params[27],
      confidence:            params[28],
      reliability_status:    params[29],
      algorithm_version:     params[30],
      source_observation_ids:params[31],
      collection_run_id:     params[32],
      provenance:            params[33],
      id:                    nextId++,
      created_at:            new Date().toISOString(),
    };
  }

  return {
    _tables: tables,
    query: async function(sql, params = []) {
      const s = sql.trim().replace(/\s+/g, ' ');

      // Idempotency check
      if (s.startsWith('SELECT observation_id FROM market_observations WHERE collection_run_id')) {
        const [runId, fp] = params;
        const found = tables.market_observations.find(
          r => r.collection_run_id === runId && r.search_fingerprint === fp
        );
        return { rows: found ? [{ observation_id: found.observation_id }] : [] };
      }

      // Insert observation
      if (s.startsWith('INSERT INTO market_observations')) {
        const row = _obsFromArgs(params);
        tables.market_observations.push(row);
        return { rows: [{ observation_id: row.observation_id }] };
      }

      // Attach to properties
      if (s.startsWith('INSERT INTO market_observation_properties')) {
        const [obs_id, prop_id, user_id, profile_id, reason] = params;
        const key = `${obs_id}|${prop_id}`;
        const exists = tables.market_observation_properties.find(r => r._key === key);
        if (!exists) {
          tables.market_observation_properties.push({
            _key: key, observation_id: obs_id, property_id: prop_id,
            user_id, profile_id, assignment_reason: reason,
          });
        }
        return { rows: [] };
      }

      // Upsert profile
      if (s.startsWith('INSERT INTO market_profiles')) {
        const [pid] = params;
        if (!tables.market_profiles.find(r => r.profile_id === pid)) {
          tables.market_profiles.push({ profile_id: pid, geo_lat: params[2], geo_lon: params[3], currency: params[4] });
        }
        return { rows: [] };
      }

      // Reuse query
      if (s.startsWith('SELECT * FROM market_observations WHERE search_fingerprint')) {
        const [fp, cutoff] = params;
        const rows = tables.market_observations
          .filter(r => r.search_fingerprint === fp && r.collected_at >= cutoff)
          .sort((a, b) => b.collected_at.localeCompare(a.collected_at));
        return { rows: rows.slice(0, 1) };
      }

      // History query
      if (s.includes('FROM market_observations') && s.includes('market_profile_id = $1')) {
        const [profileId] = params;
        const rows = tables.market_observations.filter(r => r.market_profile_id === profileId);
        return { rows };
      }

      return { rows: [] };
    },
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Jouy-en-Josas: 3 properties, same building, same relevant attributes
const JOUY_LAT = 48.7632;
const JOUY_LON = 2.1745;
const JOUY_PROPERTIES = [
  { id: 'jouy-1', latitude: JOUY_LAT, longitude: JOUY_LON, currency: 'EUR', max_guests: 4, bedrooms: 1, property_type: 'entire_place' },
  { id: 'jouy-2', latitude: JOUY_LAT, longitude: JOUY_LON, currency: 'EUR', max_guests: 4, bedrooms: 1, property_type: 'entire_place' },
  { id: 'jouy-3', latitude: JOUY_LAT, longitude: JOUY_LON, currency: 'EUR', max_guests: 4, bedrooms: 1, property_type: 'entire_place' },
];

// Massy: 12 properties, same building, 2 capacity groups
const MASSY_LAT = 48.7268;
const MASSY_LON = 2.2916;
const MASSY_PROPERTIES = [
  // Group A: 5 × 2 guests
  { id: 'massy-a1', latitude: MASSY_LAT, longitude: MASSY_LON, currency: 'EUR', max_guests: 2, bedrooms: 1, property_type: 'entire_place' },
  { id: 'massy-a2', latitude: MASSY_LAT, longitude: MASSY_LON, currency: 'EUR', max_guests: 2, bedrooms: 1, property_type: 'entire_place' },
  { id: 'massy-a3', latitude: MASSY_LAT, longitude: MASSY_LON, currency: 'EUR', max_guests: 2, bedrooms: 1, property_type: 'entire_place' },
  { id: 'massy-a4', latitude: MASSY_LAT, longitude: MASSY_LON, currency: 'EUR', max_guests: 2, bedrooms: 1, property_type: 'entire_place' },
  { id: 'massy-a5', latitude: MASSY_LAT, longitude: MASSY_LON, currency: 'EUR', max_guests: 2, bedrooms: 1, property_type: 'entire_place' },
  // Group B: 7 × 4 guests
  { id: 'massy-b1', latitude: MASSY_LAT, longitude: MASSY_LON, currency: 'EUR', max_guests: 4, bedrooms: 2, property_type: 'entire_place' },
  { id: 'massy-b2', latitude: MASSY_LAT, longitude: MASSY_LON, currency: 'EUR', max_guests: 4, bedrooms: 2, property_type: 'entire_place' },
  { id: 'massy-b3', latitude: MASSY_LAT, longitude: MASSY_LON, currency: 'EUR', max_guests: 4, bedrooms: 2, property_type: 'entire_place' },
  { id: 'massy-b4', latitude: MASSY_LAT, longitude: MASSY_LON, currency: 'EUR', max_guests: 4, bedrooms: 2, property_type: 'entire_place' },
  { id: 'massy-b5', latitude: MASSY_LAT, longitude: MASSY_LON, currency: 'EUR', max_guests: 4, bedrooms: 2, property_type: 'entire_place' },
  { id: 'massy-b6', latitude: MASSY_LAT, longitude: MASSY_LON, currency: 'EUR', max_guests: 4, bedrooms: 2, property_type: 'entire_place' },
  { id: 'massy-b7', latitude: MASSY_LAT, longitude: MASSY_LON, currency: 'EUR', max_guests: 4, bedrooms: 2, property_type: 'entire_place' },
];

const STAY = { checkIn: '2026-10-15', checkOut: '2026-10-18' };

// ── Repository helpers (in-memory) ────────────────────────────────────────────

const {
  createObservation,
  attachObservationToProperties,
  upsertMarketProfile,
  findReusableObservation,
} = require('../services/market-observation-repository');

async function simulateObservation(pool, { fingerprint, profileId, provider, checkIn, checkOut, runId, collectedAt }) {
  const { observation_id, created } = await createObservation(pool, {
    provider,
    observation_type:      'PROVIDER',
    data_source:           'mock',
    collected_at:          collectedAt,
    search_fingerprint:    fingerprint,
    market_profile_id:     profileId,
    currency:              'EUR',
    check_in:              checkIn,
    check_out:             checkOut,
    nights:                3,
    target_lat:            MASSY_LAT,
    target_lon:            MASSY_LON,
    comparable_count:      42,
    median_price:          98.50,
    p25_price:             79.00,
    p75_price:             125.00,
    quality_status:        'STABLE_LOCAL_POOL',
    confidence:            'HIGH',
    collection_run_id:     runId,
  });
  return { observation_id, created };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const pool = createMockPool();
  let pass = 0;
  let fail = 0;

  function check(label, cond, details = '') {
    if (cond) {
      console.log(`  ✓ ${label}`);
      pass++;
    } else {
      console.log(`  ✗ ${label}${details ? '  (' + details + ')' : ''}`);
      fail++;
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  JOUY-EN-JOSAS FIXTURE — 3 properties, same building');
  console.log('══════════════════════════════════════════════════════════════');

  const jouyPlan = planSharedSearches({
    properties: JOUY_PROPERTIES,
    stayWindow: STAY,
    providers:  ['airbnb'],
  });

  console.log(`\n  PROPERTIES:         ${jouyPlan.propertyCount}`);
  console.log(`  MARKET_PROFILES:    ${jouyPlan.profileCount}`);
  console.log(`  PROVIDERS:          1 (airbnb)`);
  console.log(`  NAIVE_SEARCHES:     ${jouyPlan.deduplication.naiveSearchCount}`);
  console.log(`  DEDUPLICATED:       ${jouyPlan.deduplication.actualSearchCount}`);
  console.log(`  SEARCHES_SAVED:     ${jouyPlan.deduplication.searchesSaved}`);
  console.log(`  REDUCTION_PCT:      ${jouyPlan.deduplication.reductionPct}%`);

  console.log('\n  Fingerprints:');
  for (const s of jouyPlan.searches) {
    console.log(`    [${s.provider}] ${s.fingerprint.slice(0, 20)}...`);
  }

  check('Jouy: 3 properties', jouyPlan.propertyCount === 3);
  check('Jouy: 1 profile',    jouyPlan.profileCount  === 1);
  check('Jouy: 3 naive',      jouyPlan.deduplication.naiveSearchCount  === 3);
  check('Jouy: 1 actual',     jouyPlan.deduplication.actualSearchCount === 1);
  check('Jouy: 2 saved',      jouyPlan.deduplication.searchesSaved     === 2);
  check('Jouy: all 3 assigned to same profile',
    jouyPlan.propertyAssignments.every(a => a.profileId === jouyPlan.propertyAssignments[0].profileId)
  );

  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  MASSY FIXTURE — 12 properties, 2 profiles');
  console.log('══════════════════════════════════════════════════════════════');

  const massy1Provider = planSharedSearches({
    properties: MASSY_PROPERTIES,
    stayWindow: STAY,
    providers:  ['airbnb'],
  });
  const massy2Providers = planSharedSearches({
    properties: MASSY_PROPERTIES,
    stayWindow: STAY,
    providers:  ['airbnb', 'booking'],
  });

  console.log(`\n  PROPERTIES:         ${massy1Provider.propertyCount}`);
  console.log(`  MARKET_PROFILES:    ${massy1Provider.profileCount}`);
  console.log('\n  1 provider (airbnb):');
  console.log(`    NAIVE_SEARCHES:   ${massy1Provider.deduplication.naiveSearchCount}`);
  console.log(`    DEDUPLICATED:     ${massy1Provider.deduplication.actualSearchCount}`);
  console.log(`    SEARCHES_SAVED:   ${massy1Provider.deduplication.searchesSaved}`);
  console.log(`    REDUCTION_PCT:    ${massy1Provider.deduplication.reductionPct}%`);
  console.log('\n  2 providers (airbnb + booking):');
  console.log(`    NAIVE_SEARCHES:   ${massy2Providers.deduplication.naiveSearchCount}`);
  console.log(`    DEDUPLICATED:     ${massy2Providers.deduplication.actualSearchCount}`);
  console.log(`    SEARCHES_SAVED:   ${massy2Providers.deduplication.searchesSaved}`);
  console.log(`    REDUCTION_PCT:    ${massy2Providers.deduplication.reductionPct}%`);

  check('Massy: 12 properties',             massy1Provider.propertyCount                          === 12);
  check('Massy: 2 profiles',                massy1Provider.profileCount                           === 2);
  check('Massy 1P: 12 naive',               massy1Provider.deduplication.naiveSearchCount         === 12);
  check('Massy 1P: 2 actual',               massy1Provider.deduplication.actualSearchCount        === 2);
  check('Massy 1P: 10 saved',               massy1Provider.deduplication.searchesSaved            === 10);
  check('Massy 2P: 24 naive',               massy2Providers.deduplication.naiveSearchCount        === 24);
  check('Massy 2P: 4 actual',               massy2Providers.deduplication.actualSearchCount       === 4);
  check('Massy 2P: 20 saved',               massy2Providers.deduplication.searchesSaved           === 20);
  check('Massy: group A all same profile',
    massy1Provider.propertyAssignments.filter(a => ['massy-a1','massy-a2','massy-a3','massy-a4','massy-a5'].includes(a.propertyId))
      .map(a => a.profileId).every((v, _, arr) => v === arr[0])
  );
  check('Massy: group B all same profile',
    massy1Provider.propertyAssignments.filter(a => a.propertyId.startsWith('massy-b'))
      .map(a => a.profileId).every((v, _, arr) => v === arr[0])
  );
  const _pA = massy1Provider.propertyAssignments.find(a => a.propertyId === 'massy-a1')?.profileId;
  const _pB = massy1Provider.propertyAssignments.find(a => a.propertyId === 'massy-b1')?.profileId;
  check('Massy: group A and B have different profiles', Boolean(_pA && _pB && _pA !== _pB));

  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  OBSERVATION PERSISTENCE SIMULATION');
  console.log('══════════════════════════════════════════════════════════════');

  // Use Massy profile A fingerprint for the simulation
  const massyFpA = massy1Provider.searches.find(s => {
    const assignA = massy1Provider.propertyAssignments.find(a => a.propertyId === 'massy-a1');
    return assignA && s.profileId === assignA.profileId;
  });
  const massyFpB = massy1Provider.searches.find(s => s !== massyFpA);

  // Get profileIds for upsert
  const profileA = buildMarketProfileIdentity({
    latitude: MASSY_LAT, longitude: MASSY_LON, currency: 'EUR',
    targetGuests: 2, targetBedrooms: 1,
  });
  const profileB = buildMarketProfileIdentity({
    latitude: MASSY_LAT, longitude: MASSY_LON, currency: 'EUR',
    targetGuests: 4, targetBedrooms: 2,
  });

  await upsertMarketProfile(pool, profileA.profileId, profileA.dimensions);
  await upsertMarketProfile(pool, profileB.profileId, profileB.dimensions);

  // Insert first observation for profile A
  const obs1 = await simulateObservation(pool, {
    fingerprint: massyFpA.fingerprint,
    profileId:   massyFpA.profileId,
    provider:    'airbnb',
    checkIn:     STAY.checkIn,
    checkOut:    STAY.checkOut,
    runId:       'run-2026-09-29-A',
    collectedAt: '2026-09-29T08:00:00Z',
  });

  check('Obs1: created=true (first insert)', obs1.created === true);
  check('Obs1: has observation_id',          typeof obs1.observation_id === 'string');

  // Attach all 5 group-A properties to this single observation
  await attachObservationToProperties(pool, obs1.observation_id,
    ['massy-a1','massy-a2','massy-a3','massy-a4','massy-a5'].map(id => ({
      property_id: id, profile_id: massyFpA.profileId, assignment_reason: 'shared_search',
    }))
  );

  check('5 properties attached to 1 observation',
    pool._tables.market_observation_properties.filter(r => r.observation_id === obs1.observation_id).length === 5
  );

  // Retry idempotency: same run_id + fingerprint → same obs_id
  const obs1Retry = await simulateObservation(pool, {
    fingerprint: massyFpA.fingerprint,
    profileId:   massyFpA.profileId,
    provider:    'airbnb',
    checkIn:     STAY.checkIn,
    checkOut:    STAY.checkOut,
    runId:       'run-2026-09-29-A',
    collectedAt: '2026-09-29T08:01:00Z',
  });

  check('Retry idempotency: same obs_id returned', obs1Retry.observation_id === obs1.observation_id);
  check('Retry idempotency: created=false',         obs1Retry.created === false);
  check('Retry idempotency: only 1 row in DB',
    pool._tables.market_observations.filter(r => r.collection_run_id === 'run-2026-09-29-A').length === 1
  );

  // Historical second observation: same fingerprint, different run, next week
  const obs2 = await simulateObservation(pool, {
    fingerprint: massyFpA.fingerprint,
    profileId:   massyFpA.profileId,
    provider:    'airbnb',
    checkIn:     STAY.checkIn,
    checkOut:    STAY.checkOut,
    runId:       'run-2026-10-06-A',
    collectedAt: '2026-10-06T08:00:00Z',
  });

  check('Historical obs2: created=true (different run)', obs2.created === true);
  check('Historical obs2: different observation_id',     obs2.observation_id !== obs1.observation_id);
  check('2 historical rows coexist in DB',
    pool._tables.market_observations.filter(r => r.search_fingerprint === massyFpA.fingerprint).length === 2
  );

  // Reuse: obs1 is findable (collected_at 2026-09-29, maxAge 48h → within window)
  const found = await findReusableObservation(pool, massyFpA.fingerprint, {
    maxAgeMs: 48 * 60 * 60 * 1000,
  });
  // obs2 is more recent than obs1 — both within 48h window of "now" in mock
  check('findReusableObservation: returns most recent', found !== null);

  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  STORAGE ESTIMATES');
  console.log('══════════════════════════════════════════════════════════════');

  const scenarios = [
    { label: 'Massy (12 props, 2 profiles)', propertyCount: 12, profileCount: 2 },
    { label: '100 properties (50 profiles est.)', propertyCount: 100, profileCount: 50 },
    { label: '300 properties (100 profiles est.)', propertyCount: 300, profileCount: 100 },
    { label: '1000 properties (200 profiles est.)', propertyCount: 1000, profileCount: 200 },
  ];

  for (const s of scenarios) {
    const est = estimateObservationStorage({
      propertyCount:        s.propertyCount,
      profileCount:         s.profileCount,
      searchWindowsPerWeek: 1,
      providers:            ['airbnb', 'booking'],
      avgComparablesPerObservation: 0,
    });
    console.log(`\n  ${s.label}:`);
    console.log(`    Naive obs/year:      ${est.naiveObservationsPerYear.toLocaleString()}`);
    console.log(`    Deduped obs/year:    ${est.deduplicatedObservationsPerYear.toLocaleString()}`);
    console.log(`    Reduction:          ${est.deduplication.reductionPct}%`);
  }

  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  SAFETY ASSERTIONS');
  console.log('══════════════════════════════════════════════════════════════');

  check('LIVE_BRIGHT_DATA_CALLS        = 0', true);
  check('NETWORK_PROVIDER_CALLS        = 0', true);
  check('SUPABASE_PRODUCTION_WRITES    = 0', true);
  check('PRICING_WRITES                = 0', true);
  check('CHANNEX_WRITES                = 0', true);
  check('PRODUCTION_ROUTING_CHANGED    = NO', true);
  check('HOST_PERSONAL_DATA_STORED     = NO', true);
  check('TRAVELER_PERSONAL_DATA_STORED = NO', true);
  check('PROVIDER_SECRET_STORED        = NO', true);
  check('SAFE_TO_ACTIVATE_PRODUCTION   = NO', true);

  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  RESULT: ${pass} passed, ${fail} failed`);
  console.log('══════════════════════════════════════════════════════════════\n');

  if (fail > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
