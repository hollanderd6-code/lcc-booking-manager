'use strict';
/**
 * P1.2-B5-BK-O — Market Observation Store & Shared Search Identity
 *
 * Sections:
 *   A  — Market Profile Identity: same vs different                   (14 tests)
 *   B  — Search Fingerprint V2: dimensions, stability                  (8 tests)
 *   C  — Search Fingerprint: propertyId excluded                       (4 tests)
 *   D  — Shared Search Planner: Jouy fixture                           (6 tests)
 *   E  — Shared Search Planner: Massy fixture                         (11 tests)
 *   F  — Shared Search Planner: dedup boundaries (no false sharing)    (6 tests)
 *   G  — Observation immutability model                                (6 tests)
 *   H  — Observation idempotency (retry safety)                        (5 tests)
 *   I  — Multi-property assignment                                     (5 tests)
 *   J  — Observation type: PROVIDER vs DERIVED_CONSENSUS               (5 tests)
 *   K  — Provenance / dimensions preserved                             (8 tests)
 *   L  — Storage estimator                                             (6 tests)
 *   M  — History read model compatibility                              (5 tests)
 *   N  — Safety: 0 network, 0 pricing, 0 secrets                      (8 tests)
 *
 * ABSOLUTE RULE: 0 Bright Data credits. Pure JS + mock DB only.
 */

const assert = require('assert');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const {
  buildMarketProfileIdentity,
  buildMarketSearchFingerprint,
  FINGERPRINT_VERSION,
  GEO_PRECISION,
} = require('../services/market-search-identity');

const { planSharedSearches }         = require('../services/market-shared-search-planner');
const { estimateObservationStorage } = require('../services/market-observation-storage-estimator');

const {
  createObservation,
  attachObservationToProperties,
  upsertMarketProfile,
  findReusableObservation,
  getObservationHistory,
} = require('../services/market-observation-repository');

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures  = [];
const asyncTasks = [];

function test(label, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      asyncTasks.push(
        result.then(
          () => { passed++; },
          (e) => { failed++; failures.push({ label, message: e.message }); }
        )
      );
    } else {
      passed++;
    }
  } catch (e) {
    failed++;
    failures.push({ label, message: e.message });
  }
}

// ── In-memory mock pool ───────────────────────────────────────────────────────

function createMockPool() {
  const tables = {
    market_observations:           [],
    market_observation_properties: [],
    market_profiles:               [],
  };

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
        const row = {
          observation_id:        'obs-' + crypto.randomUUID(),
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
          created_at:            new Date().toISOString(),
        };
        tables.market_observations.push(row);
        return { rows: [{ observation_id: row.observation_id }] };
      }

      // Attach properties
      if (s.startsWith('INSERT INTO market_observation_properties')) {
        const [obs_id, prop_id, user_id, profile_id, reason] = params;
        const key = `${obs_id}|${prop_id}`;
        if (!tables.market_observation_properties.find(r => r._key === key)) {
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
          tables.market_profiles.push({ profile_id: pid });
        }
        return { rows: [] };
      }

      // Reuse query (SELECT * ... WHERE search_fingerprint = $1 AND collected_at >= $2)
      if (s.startsWith('SELECT * FROM market_observations WHERE search_fingerprint')) {
        const [fp, cutoff] = params;
        const rows = tables.market_observations
          .filter(r => r.search_fingerprint === fp && r.collected_at >= cutoff)
          .sort((a, b) => b.collected_at.localeCompare(a.collected_at));
        return { rows: rows.slice(0, 1) };
      }

      // History query (WHERE market_profile_id = $1 ...)
      if (s.includes('FROM market_observations') && s.includes('market_profile_id = $1')) {
        const [profileId, ...rest] = params;
        let rows = tables.market_observations.filter(r => r.market_profile_id === profileId);
        // Apply optional provider filter
        const provIdx = rest.findIndex(
          (_, i) => s.includes(`provider = $${i + 2}`)
        );
        if (provIdx >= 0) {
          rows = rows.filter(r => r.provider === rest[provIdx]);
        }
        return { rows };
      }

      return { rows: [] };
    },
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const JOUY_LAT  = 48.7632;
const JOUY_LON  = 2.1745;
const MASSY_LAT = 48.7268;
const MASSY_LON = 2.2916;

function jouyProp(overrides = {}) {
  return {
    latitude: JOUY_LAT, longitude: JOUY_LON, currency: 'EUR',
    targetGuests: 4, targetBedrooms: 1, targetPropertyType: 'entire_place',
    ...overrides,
  };
}

function massyPropA(overrides = {}) {
  return { latitude: MASSY_LAT, longitude: MASSY_LON, currency: 'EUR', max_guests: 2, bedrooms: 1, property_type: 'entire_place', ...overrides };
}

function massyPropB(overrides = {}) {
  return { latitude: MASSY_LAT, longitude: MASSY_LON, currency: 'EUR', max_guests: 4, bedrooms: 2, property_type: 'entire_place', ...overrides };
}

const STAY  = { checkIn: '2026-10-15', checkOut: '2026-10-18' };
const STAY2 = { checkIn: '2026-11-01', checkOut: '2026-11-04' };

const jouyProperties = [
  { id: 'jouy-1', ...jouyProp() },
  { id: 'jouy-2', ...jouyProp() },
  { id: 'jouy-3', ...jouyProp() },
];

const massyProperties = [
  ...Array.from({ length: 5 }, (_, i) => ({ id: `massy-a${i + 1}`, ...massyPropA() })),
  ...Array.from({ length: 7 }, (_, i) => ({ id: `massy-b${i + 1}`, ...massyPropB() })),
];

// ── A. Market Profile Identity ────────────────────────────────────────────────

test('A-01: same geo same profile → same profileId', () => {
  const a = buildMarketProfileIdentity(jouyProp());
  const b = buildMarketProfileIdentity(jouyProp());
  assert.ok(a.valid && b.valid);
  assert.strictEqual(a.profileId, b.profileId);
});

test('A-02: extra unknown field does not change profileId', () => {
  const a = buildMarketProfileIdentity(jouyProp());
  const b = buildMarketProfileIdentity({ ...jouyProp(), _ignore: 'x' });
  assert.strictEqual(a.profileId, b.profileId);
});

test('A-03: same building identical attributes → same profile', () => {
  const a = buildMarketProfileIdentity({ latitude: JOUY_LAT, longitude: JOUY_LON, currency: 'EUR', targetGuests: 4 });
  const b = buildMarketProfileIdentity({ latitude: JOUY_LAT, longitude: JOUY_LON, currency: 'EUR', targetGuests: 4 });
  assert.strictEqual(a.profileId, b.profileId);
});

test('A-04: different capacity → different profile', () => {
  const a = buildMarketProfileIdentity(jouyProp({ targetGuests: 2 }));
  const b = buildMarketProfileIdentity(jouyProp({ targetGuests: 4 }));
  assert.notStrictEqual(a.profileId, b.profileId);
});

test('A-05: different bedrooms → different profile', () => {
  const a = buildMarketProfileIdentity(jouyProp({ targetBedrooms: 1 }));
  const b = buildMarketProfileIdentity(jouyProp({ targetBedrooms: 2 }));
  assert.notStrictEqual(a.profileId, b.profileId);
});

test('A-06: different property type → different profile', () => {
  const a = buildMarketProfileIdentity(jouyProp({ targetPropertyType: 'entire_place' }));
  const b = buildMarketProfileIdentity(jouyProp({ targetPropertyType: 'private_room' }));
  assert.notStrictEqual(a.profileId, b.profileId);
});

test('A-07: different currency → different profile', () => {
  const a = buildMarketProfileIdentity(jouyProp({ currency: 'EUR' }));
  const b = buildMarketProfileIdentity(jouyProp({ currency: 'GBP' }));
  assert.notStrictEqual(a.profileId, b.profileId);
});

test('A-08: meaningfully different location → different profile', () => {
  const a = buildMarketProfileIdentity(jouyProp());
  const b = buildMarketProfileIdentity({ ...jouyProp(), latitude: MASSY_LAT, longitude: MASSY_LON });
  assert.notStrictEqual(a.profileId, b.profileId);
});

test('A-09: same building coords within 5m → same geo bucket at 4dp', () => {
  const a = buildMarketProfileIdentity(jouyProp({ latitude: 48.76320, longitude: 2.17450 }));
  const b = buildMarketProfileIdentity(jouyProp({ latitude: 48.76322, longitude: 2.17451 }));
  assert.strictEqual(a.profileId, b.profileId);
});

test('A-10: Massy profile A valid with prefix mp2_', () => {
  const r = buildMarketProfileIdentity(massyPropA());
  assert.ok(r.valid);
  assert.ok(r.profileId.startsWith('mp2_'));
});

test('A-11: Massy profile B valid with prefix mp2_', () => {
  const r = buildMarketProfileIdentity(massyPropB());
  assert.ok(r.valid);
  assert.ok(r.profileId.startsWith('mp2_'));
});

test('A-12: Massy A profile != Massy B profile (using canonical camelCase args)', () => {
  // buildMarketProfileIdentity uses targetGuests/targetBedrooms; massyPropA uses DB column names.
  // The planner resolves the alias; for direct calls use canonical camelCase.
  const a = buildMarketProfileIdentity({ latitude: MASSY_LAT, longitude: MASSY_LON, currency: 'EUR', targetGuests: 2, targetBedrooms: 1 });
  const b = buildMarketProfileIdentity({ latitude: MASSY_LAT, longitude: MASSY_LON, currency: 'EUR', targetGuests: 4, targetBedrooms: 2 });
  assert.notStrictEqual(a.profileId, b.profileId);
});

test('A-13: missing latitude → valid=false reason=invalid_geo', () => {
  const r = buildMarketProfileIdentity({ longitude: JOUY_LON, currency: 'EUR' });
  assert.ok(!r.valid);
  assert.strictEqual(r.reason, 'invalid_geo');
});

test('A-14: invalid currency → valid=false reason=invalid_currency', () => {
  const r = buildMarketProfileIdentity(jouyProp({ currency: 'eu' }));
  assert.ok(!r.valid);
  assert.strictEqual(r.reason, 'invalid_currency');
});

// ── B. Search Fingerprint V2 ──────────────────────────────────────────────────

test('B-01: same profile+provider+window → same fingerprint', () => {
  const a = buildMarketSearchFingerprint({ ...jouyProp(), provider: 'airbnb', ...STAY });
  const b = buildMarketSearchFingerprint({ ...jouyProp(), provider: 'airbnb', ...STAY });
  assert.ok(a.valid && b.valid);
  assert.strictEqual(a.fingerprint, b.fingerprint);
});

test('B-02: different provider → different fingerprint', () => {
  const a = buildMarketSearchFingerprint({ ...jouyProp(), provider: 'airbnb',  ...STAY });
  const b = buildMarketSearchFingerprint({ ...jouyProp(), provider: 'booking', ...STAY });
  assert.notStrictEqual(a.fingerprint, b.fingerprint);
});

test('B-03: different checkIn → different fingerprint', () => {
  const a = buildMarketSearchFingerprint({ ...jouyProp(), provider: 'airbnb', checkIn: '2026-10-15', checkOut: '2026-10-18' });
  const b = buildMarketSearchFingerprint({ ...jouyProp(), provider: 'airbnb', checkIn: '2026-10-22', checkOut: '2026-10-25' });
  assert.notStrictEqual(a.fingerprint, b.fingerprint);
});

test('B-04: different checkOut → different fingerprint', () => {
  const a = buildMarketSearchFingerprint({ ...jouyProp(), provider: 'airbnb', checkIn: '2026-10-15', checkOut: '2026-10-18' });
  const b = buildMarketSearchFingerprint({ ...jouyProp(), provider: 'airbnb', checkIn: '2026-10-15', checkOut: '2026-10-19' });
  assert.notStrictEqual(a.fingerprint, b.fingerprint);
});

test('B-05: different currency → different fingerprint', () => {
  const a = buildMarketSearchFingerprint({ ...jouyProp({ currency: 'EUR' }), provider: 'airbnb', ...STAY });
  const b = buildMarketSearchFingerprint({ ...jouyProp({ currency: 'GBP' }), provider: 'airbnb', ...STAY });
  assert.notStrictEqual(a.fingerprint, b.fingerprint);
});

test('B-06: fingerprint starts with ms2_ prefix', () => {
  const r = buildMarketSearchFingerprint({ ...jouyProp(), provider: 'airbnb', ...STAY });
  assert.ok(r.fingerprint.startsWith('ms2_'));
});

test('B-07: missing provider → valid=false reason=missing_provider', () => {
  const r = buildMarketSearchFingerprint({ ...jouyProp(), ...STAY });
  assert.ok(!r.valid);
  assert.strictEqual(r.reason, 'missing_provider');
});

test('B-08: missing checkIn → valid=false reason=missing_check_in', () => {
  const r = buildMarketSearchFingerprint({ ...jouyProp(), provider: 'airbnb', checkOut: '2026-10-18' });
  assert.ok(!r.valid);
  assert.strictEqual(r.reason, 'missing_check_in');
});

// ── C. propertyId excluded from fingerprint ───────────────────────────────────

test('C-01: 3 identical-profile calls → same profileId (propertyId not in dimensions)', () => {
  const ids = ['jouy-1', 'jouy-2', 'jouy-3'].map(() => buildMarketProfileIdentity(jouyProp()).profileId);
  assert.ok(ids.every(id => id === ids[0]));
});

test('C-02: 3 identical searches → same fingerprint regardless of "caller"', () => {
  const fps = [1, 2, 3].map(() => buildMarketSearchFingerprint({ ...jouyProp(), provider: 'airbnb', ...STAY }).fingerprint);
  assert.ok(fps.every(f => f === fps[0]));
});

test('C-03: profile dimensions do not contain propertyId or property_id', () => {
  const p = buildMarketProfileIdentity(jouyProp());
  assert.ok(!('propertyId'  in p.dimensions));
  assert.ok(!('property_id' in p.dimensions));
});

test('C-04: fingerprint dimensions do not contain propertyId or property_id', () => {
  const f = buildMarketSearchFingerprint({ ...jouyProp(), provider: 'airbnb', ...STAY });
  assert.ok(!('propertyId'  in f.dimensions));
  assert.ok(!('property_id' in f.dimensions));
});

// ── D. Shared Search Planner: Jouy ───────────────────────────────────────────

test('D-01: Jouy propertyCount = 3', () => {
  const p = planSharedSearches({ properties: jouyProperties, stayWindow: STAY, providers: ['airbnb'] });
  assert.strictEqual(p.propertyCount, 3);
});

test('D-02: Jouy profileCount = 1', () => {
  const p = planSharedSearches({ properties: jouyProperties, stayWindow: STAY, providers: ['airbnb'] });
  assert.strictEqual(p.profileCount, 1);
});

test('D-03: Jouy naiveSearchCount = 3', () => {
  const p = planSharedSearches({ properties: jouyProperties, stayWindow: STAY, providers: ['airbnb'] });
  assert.strictEqual(p.deduplication.naiveSearchCount, 3);
});

test('D-04: Jouy actualSearchCount = 1', () => {
  const p = planSharedSearches({ properties: jouyProperties, stayWindow: STAY, providers: ['airbnb'] });
  assert.strictEqual(p.deduplication.actualSearchCount, 1);
});

test('D-05: Jouy searchesSaved = 2', () => {
  const p = planSharedSearches({ properties: jouyProperties, stayWindow: STAY, providers: ['airbnb'] });
  assert.strictEqual(p.deduplication.searchesSaved, 2);
});

test('D-06: Jouy all 3 assignments share the same profileId', () => {
  const p = planSharedSearches({ properties: jouyProperties, stayWindow: STAY, providers: ['airbnb'] });
  const ids = p.propertyAssignments.map(a => a.profileId);
  assert.ok(ids.every(id => id === ids[0]));
});

// ── E. Shared Search Planner: Massy ──────────────────────────────────────────

test('E-01: Massy propertyCount = 12', () => {
  const p = planSharedSearches({ properties: massyProperties, stayWindow: STAY, providers: ['airbnb'] });
  assert.strictEqual(p.propertyCount, 12);
});

test('E-02: Massy profileCount = 2', () => {
  const p = planSharedSearches({ properties: massyProperties, stayWindow: STAY, providers: ['airbnb'] });
  assert.strictEqual(p.profileCount, 2);
});

test('E-03: Massy 1P naiveSearchCount = 12', () => {
  const p = planSharedSearches({ properties: massyProperties, stayWindow: STAY, providers: ['airbnb'] });
  assert.strictEqual(p.deduplication.naiveSearchCount, 12);
});

test('E-04: Massy 1P actualSearchCount = 2', () => {
  const p = planSharedSearches({ properties: massyProperties, stayWindow: STAY, providers: ['airbnb'] });
  assert.strictEqual(p.deduplication.actualSearchCount, 2);
});

test('E-05: Massy 1P searchesSaved = 10', () => {
  const p = planSharedSearches({ properties: massyProperties, stayWindow: STAY, providers: ['airbnb'] });
  assert.strictEqual(p.deduplication.searchesSaved, 10);
});

test('E-06: Massy 2P naiveSearchCount = 24', () => {
  const p = planSharedSearches({ properties: massyProperties, stayWindow: STAY, providers: ['airbnb', 'booking'] });
  assert.strictEqual(p.deduplication.naiveSearchCount, 24);
});

test('E-07: Massy 2P actualSearchCount = 4', () => {
  const p = planSharedSearches({ properties: massyProperties, stayWindow: STAY, providers: ['airbnb', 'booking'] });
  assert.strictEqual(p.deduplication.actualSearchCount, 4);
});

test('E-08: Massy 2P searchesSaved = 20', () => {
  const p = planSharedSearches({ properties: massyProperties, stayWindow: STAY, providers: ['airbnb', 'booking'] });
  assert.strictEqual(p.deduplication.searchesSaved, 20);
});

test('E-09: Massy group A (5 props) all share same profileId', () => {
  const p    = planSharedSearches({ properties: massyProperties, stayWindow: STAY, providers: ['airbnb'] });
  const aIds = p.propertyAssignments.filter(a => a.propertyId.startsWith('massy-a')).map(a => a.profileId);
  assert.strictEqual(aIds.length, 5);
  assert.ok(aIds.every(id => id === aIds[0]));
});

test('E-10: Massy group B (7 props) all share same profileId', () => {
  const p    = planSharedSearches({ properties: massyProperties, stayWindow: STAY, providers: ['airbnb'] });
  const bIds = p.propertyAssignments.filter(a => a.propertyId.startsWith('massy-b')).map(a => a.profileId);
  assert.strictEqual(bIds.length, 7);
  assert.ok(bIds.every(id => id === bIds[0]));
});

test('E-11: Massy group A and group B have different profileIds', () => {
  const p  = planSharedSearches({ properties: massyProperties, stayWindow: STAY, providers: ['airbnb'] });
  const aId = p.propertyAssignments.find(a => a.propertyId === 'massy-a1')?.profileId;
  const bId = p.propertyAssignments.find(a => a.propertyId === 'massy-b1')?.profileId;
  assert.ok(aId && bId && aId !== bId);
});

// ── F. Dedup boundaries ───────────────────────────────────────────────────────

test('F-01: no accidental cross-currency dedup', () => {
  const props = [
    { id: 'p1', ...jouyProp({ currency: 'EUR' }) },
    { id: 'p2', ...jouyProp({ currency: 'GBP' }) },
  ];
  const p = planSharedSearches({ properties: props, stayWindow: STAY, providers: ['airbnb'] });
  assert.strictEqual(p.deduplication.actualSearchCount, 2);
});

test('F-02: different providers produce different fingerprints', () => {
  const prop = { id: 'p1', ...jouyProp() };
  const pA = planSharedSearches({ properties: [prop], stayWindow: STAY, providers: ['airbnb'] });
  const pB = planSharedSearches({ properties: [prop], stayWindow: STAY, providers: ['booking'] });
  assert.notStrictEqual(pA.searches[0].fingerprint, pB.searches[0].fingerprint);
});

test('F-03: different stay window → different search fingerprint', () => {
  const prop = { id: 'p1', ...jouyProp() };
  const p1 = planSharedSearches({ properties: [prop], stayWindow: STAY,  providers: ['airbnb'] });
  const p2 = planSharedSearches({ properties: [prop], stayWindow: STAY2, providers: ['airbnb'] });
  assert.notStrictEqual(p1.searches[0].fingerprint, p2.searches[0].fingerprint);
});

test('F-04: different capacity → different profile → no cross-profile dedup', () => {
  const props = [
    { id: 'p1', ...jouyProp({ targetGuests: 2 }) },
    { id: 'p2', ...jouyProp({ targetGuests: 4 }) },
  ];
  const p = planSharedSearches({ properties: props, stayWindow: STAY, providers: ['airbnb'] });
  assert.strictEqual(p.profileCount, 2);
  assert.strictEqual(p.deduplication.actualSearchCount, 2);
});

test('F-05: single property → no savings, reductionPct = 0', () => {
  const p = planSharedSearches({ properties: [{ id: 'solo', ...jouyProp() }], stayWindow: STAY, providers: ['airbnb'] });
  assert.strictEqual(p.deduplication.searchesSaved, 0);
  assert.strictEqual(p.deduplication.reductionPct, 0);
});

test('F-06: invalid property (missing lat) → invalidProperties, not counted in naive', () => {
  const props = [
    { id: 'good', ...jouyProp() },
    { id: 'bad',  longitude: JOUY_LON, currency: 'EUR' },
  ];
  const p = planSharedSearches({ properties: props, stayWindow: STAY, providers: ['airbnb'] });
  assert.strictEqual(p.invalidProperties.length, 1);
  assert.strictEqual(p.invalidProperties[0].propertyId, 'bad');
  assert.strictEqual(p.deduplication.naiveSearchCount, 1);
});

// ── G. Observation immutability model ─────────────────────────────────────────

test('G-01: createObservation returns observation_id + created=true', async () => {
  const pool = createMockPool();
  const { observation_id, created } = await createObservation(pool, {
    provider: 'airbnb', collected_at: '2026-09-29T08:00:00Z',
    search_fingerprint: 'ms2_g01', currency: 'EUR', collection_run_id: 'run-g01',
  });
  assert.ok(typeof observation_id === 'string' && observation_id.length > 0);
  assert.ok(created === true);
});

test('G-02: two observations different collected_at coexist (historical)', async () => {
  const pool = createMockPool();
  const fp = 'ms2_g02';
  await createObservation(pool, { provider: 'airbnb', collected_at: '2026-09-29T08:00:00Z', search_fingerprint: fp, currency: 'EUR', collection_run_id: 'run-g02-w1' });
  await createObservation(pool, { provider: 'airbnb', collected_at: '2026-10-06T08:00:00Z', search_fingerprint: fp, currency: 'EUR', collection_run_id: 'run-g02-w2' });
  assert.strictEqual(pool._tables.market_observations.length, 2);
});

test('G-03: airbnb and booking produce different fingerprints', () => {
  const a = buildMarketSearchFingerprint({ ...jouyProp(), provider: 'airbnb',  ...STAY });
  const b = buildMarketSearchFingerprint({ ...jouyProp(), provider: 'booking', ...STAY });
  assert.notStrictEqual(a.fingerprint, b.fingerprint);
});

test('G-04: consensus fingerprint distinct from provider fingerprints', () => {
  const a = buildMarketSearchFingerprint({ ...jouyProp(), provider: 'airbnb',    ...STAY });
  const c = buildMarketSearchFingerprint({ ...jouyProp(), provider: 'consensus', ...STAY });
  assert.notStrictEqual(a.fingerprint, c.fingerprint);
});

test('G-05: DERIVED_CONSENSUS observation accepted by repository', async () => {
  const pool = createMockPool();
  const { created } = await createObservation(pool, {
    provider: 'consensus', observation_type: 'DERIVED_CONSENSUS',
    collected_at: '2026-09-29T08:00:00Z', search_fingerprint: 'ms2_g05', currency: 'EUR',
    algorithm_version: 'v1', source_observation_ids: ['uuid-a', 'uuid-b'],
    collection_run_id: 'run-g05',
  });
  assert.ok(created === true);
});

test('G-06: two runs same fingerprint → two different observation_ids', async () => {
  const pool = createMockPool();
  const fp = 'ms2_g06';
  const r1 = await createObservation(pool, { provider: 'airbnb', collected_at: '2026-09-29T08:00:00Z', search_fingerprint: fp, currency: 'EUR', collection_run_id: 'run-g06-w1' });
  const r2 = await createObservation(pool, { provider: 'airbnb', collected_at: '2026-10-06T08:00:00Z', search_fingerprint: fp, currency: 'EUR', collection_run_id: 'run-g06-w2' });
  assert.notStrictEqual(r1.observation_id, r2.observation_id);
});

// ── H. Idempotency ────────────────────────────────────────────────────────────

test('H-01: retry same (run_id, fingerprint) → same observation_id, created=false', async () => {
  const pool = createMockPool();
  const opts = { provider: 'airbnb', collected_at: '2026-09-29T08:00:00Z', search_fingerprint: 'ms2_h01', currency: 'EUR', collection_run_id: 'run-h01' };
  const r1 = await createObservation(pool, opts);
  const r2 = await createObservation(pool, opts);
  assert.ok(r1.created === true);
  assert.ok(r2.created === false);
  assert.strictEqual(r1.observation_id, r2.observation_id);
});

test('H-02: 3 retries → 1 row in DB', async () => {
  const pool = createMockPool();
  const opts = { provider: 'airbnb', collected_at: '2026-09-29T08:00:00Z', search_fingerprint: 'ms2_h02', currency: 'EUR', collection_run_id: 'run-h02' };
  await createObservation(pool, opts);
  await createObservation(pool, opts);
  await createObservation(pool, opts);
  assert.strictEqual(pool._tables.market_observations.length, 1);
});

test('H-03: same fingerprint different run → 2 rows', async () => {
  const pool = createMockPool();
  await createObservation(pool, { provider: 'airbnb', collected_at: '2026-09-29T08:00:00Z', search_fingerprint: 'ms2_h03', currency: 'EUR', collection_run_id: 'run-h03-w1' });
  await createObservation(pool, { provider: 'airbnb', collected_at: '2026-10-06T08:00:00Z', search_fingerprint: 'ms2_h03', currency: 'EUR', collection_run_id: 'run-h03-w2' });
  assert.strictEqual(pool._tables.market_observations.length, 2);
});

test('H-04: no collection_run_id → always creates new row', async () => {
  const pool = createMockPool();
  await createObservation(pool, { provider: 'airbnb', collected_at: '2026-09-29T08:00:00Z', search_fingerprint: 'ms2_h04', currency: 'EUR' });
  await createObservation(pool, { provider: 'airbnb', collected_at: '2026-09-29T08:00:00Z', search_fingerprint: 'ms2_h04', currency: 'EUR' });
  assert.strictEqual(pool._tables.market_observations.length, 2);
});

test('H-05: idempotency key is (run_id, fingerprint) NOT fingerprint alone', async () => {
  const pool = createMockPool();
  await createObservation(pool, { provider: 'airbnb', collected_at: '2026-09-29T08:00:00Z', search_fingerprint: 'ms2_h05', currency: 'EUR', collection_run_id: 'run-A' });
  await createObservation(pool, { provider: 'airbnb', collected_at: '2026-10-06T08:00:00Z', search_fingerprint: 'ms2_h05', currency: 'EUR', collection_run_id: 'run-B' });
  assert.strictEqual(pool._tables.market_observations.length, 2);
});

// ── I. Multi-property assignment ──────────────────────────────────────────────

test('I-01: 5 properties attached to 1 observation', async () => {
  const pool = createMockPool();
  const { observation_id } = await createObservation(pool, { provider: 'airbnb', collected_at: '2026-09-29T08:00:00Z', search_fingerprint: 'ms2_i01', currency: 'EUR', collection_run_id: 'run-i01' });
  await attachObservationToProperties(pool, observation_id,
    ['p1','p2','p3','p4','p5'].map(id => ({ property_id: id }))
  );
  assert.strictEqual(pool._tables.market_observation_properties.filter(r => r.observation_id === observation_id).length, 5);
});

test('I-02: 1 observation row + 5 link rows', async () => {
  const pool = createMockPool();
  const { observation_id } = await createObservation(pool, { provider: 'airbnb', collected_at: '2026-09-29T08:00:00Z', search_fingerprint: 'ms2_i02', currency: 'EUR', collection_run_id: 'run-i02' });
  await attachObservationToProperties(pool, observation_id, [1,2,3,4,5].map(i => ({ property_id: `p${i}` })));
  assert.strictEqual(pool._tables.market_observations.length, 1);
  assert.strictEqual(pool._tables.market_observation_properties.length, 5);
});

test('I-03: duplicate attach is idempotent (ON CONFLICT DO NOTHING)', async () => {
  const pool = createMockPool();
  const { observation_id } = await createObservation(pool, { provider: 'airbnb', collected_at: '2026-09-29T08:00:00Z', search_fingerprint: 'ms2_i03', currency: 'EUR', collection_run_id: 'run-i03' });
  await attachObservationToProperties(pool, observation_id, [{ property_id: 'p1' }]);
  await attachObservationToProperties(pool, observation_id, [{ property_id: 'p1' }]);
  assert.strictEqual(pool._tables.market_observation_properties.filter(r => r.observation_id === observation_id).length, 1);
});

test('I-04: assignment carries profile_id for audit', async () => {
  const pool = createMockPool();
  const { observation_id } = await createObservation(pool, { provider: 'airbnb', collected_at: '2026-09-29T08:00:00Z', search_fingerprint: 'ms2_i04', currency: 'EUR', collection_run_id: 'run-i04' });
  await attachObservationToProperties(pool, observation_id, [{ property_id: 'p1', profile_id: 'mp2_xyz' }]);
  assert.strictEqual(pool._tables.market_observation_properties[0].profile_id, 'mp2_xyz');
});

test('I-05: assignment_reason recorded', async () => {
  const pool = createMockPool();
  const { observation_id } = await createObservation(pool, { provider: 'airbnb', collected_at: '2026-09-29T08:00:00Z', search_fingerprint: 'ms2_i05', currency: 'EUR', collection_run_id: 'run-i05' });
  await attachObservationToProperties(pool, observation_id, [{ property_id: 'p1', assignment_reason: 'shared_search' }]);
  assert.strictEqual(pool._tables.market_observation_properties[0].assignment_reason, 'shared_search');
});

// ── J. PROVIDER vs DERIVED_CONSENSUS ─────────────────────────────────────────

test('J-01: DERIVED_CONSENSUS row accepted by repository', async () => {
  const pool = createMockPool();
  const { created } = await createObservation(pool, {
    provider: 'consensus', observation_type: 'DERIVED_CONSENSUS',
    collected_at: '2026-09-29T08:00:00Z', search_fingerprint: 'ms2_j01', currency: 'EUR',
    algorithm_version: 'cross-source-v1', source_observation_ids: ['abc', 'def'],
    collection_run_id: 'run-j01',
  });
  assert.ok(created === true);
});

test('J-02: algorithm_version preserved in consensus row', async () => {
  const pool = createMockPool();
  await createObservation(pool, {
    provider: 'consensus', observation_type: 'DERIVED_CONSENSUS',
    collected_at: '2026-09-29T08:00:00Z', search_fingerprint: 'ms2_j02', currency: 'EUR',
    algorithm_version: 'cross-source-v2', collection_run_id: 'run-j02',
  });
  assert.strictEqual(pool._tables.market_observations[0].algorithm_version, 'cross-source-v2');
});

test('J-03: source_observation_ids preserved in consensus row', async () => {
  const pool = createMockPool();
  const srcIds = ['uuid-obs-a', 'uuid-obs-b'];
  await createObservation(pool, {
    provider: 'consensus', observation_type: 'DERIVED_CONSENSUS',
    collected_at: '2026-09-29T08:00:00Z', search_fingerprint: 'ms2_j03', currency: 'EUR',
    source_observation_ids: srcIds, collection_run_id: 'run-j03',
  });
  assert.deepStrictEqual(pool._tables.market_observations[0].source_observation_ids, srcIds);
});

test('J-04: PROVIDER observation does not require algorithm_version', async () => {
  const pool = createMockPool();
  const { created } = await createObservation(pool, {
    provider: 'airbnb', observation_type: 'PROVIDER',
    collected_at: '2026-09-29T08:00:00Z', search_fingerprint: 'ms2_j04', currency: 'EUR',
    collection_run_id: 'run-j04',
  });
  assert.ok(created === true);
  assert.strictEqual(pool._tables.market_observations[0].algorithm_version, null);
});

test('J-05: 3 fingerprints (airbnb, booking, consensus) are all distinct', () => {
  const a = buildMarketSearchFingerprint({ ...jouyProp(), provider: 'airbnb',    ...STAY });
  const b = buildMarketSearchFingerprint({ ...jouyProp(), provider: 'booking',   ...STAY });
  const c = buildMarketSearchFingerprint({ ...jouyProp(), provider: 'consensus', ...STAY });
  assert.strictEqual(new Set([a.fingerprint, b.fingerprint, c.fingerprint]).size, 3);
});

// ── K. Provenance / dimensions preserved ─────────────────────────────────────

test('K-01: lat/lon at GEO_PRECISION decimal places in dimensions', () => {
  const r = buildMarketProfileIdentity(jouyProp());
  assert.strictEqual(r.dimensions.lat, JOUY_LAT.toFixed(GEO_PRECISION));
  assert.strictEqual(r.dimensions.lon, JOUY_LON.toFixed(GEO_PRECISION));
});

test('K-02: currency preserved in dimensions', () => {
  const r = buildMarketProfileIdentity(jouyProp({ currency: 'GBP' }));
  assert.strictEqual(r.dimensions.currency, 'GBP');
});

test('K-03: targetGuests preserved in dimensions', () => {
  const r = buildMarketProfileIdentity(jouyProp({ targetGuests: 6 }));
  assert.strictEqual(r.dimensions.guests, 6);
});

test('K-04: targetBedrooms preserved in dimensions', () => {
  const r = buildMarketProfileIdentity(jouyProp({ targetBedrooms: 3 }));
  assert.strictEqual(r.dimensions.bedrooms, 3);
});

test('K-05: targetPropertyType preserved (lowercased) in dimensions', () => {
  const r = buildMarketProfileIdentity(jouyProp({ targetPropertyType: 'PRIVATE_ROOM' }));
  assert.strictEqual(r.dimensions.propType, 'private_room');
});

test('K-06: fingerprint dimensions contain profileId with mp2_ prefix', () => {
  const r = buildMarketSearchFingerprint({ ...jouyProp(), provider: 'airbnb', ...STAY });
  assert.ok(r.dimensions.profileId.startsWith('mp2_'));
});

test('K-07: fingerprint dimensions contain checkIn and checkOut', () => {
  const r = buildMarketSearchFingerprint({ ...jouyProp(), provider: 'airbnb', ...STAY });
  assert.strictEqual(r.dimensions.checkIn,  STAY.checkIn);
  assert.strictEqual(r.dimensions.checkOut, STAY.checkOut);
});

test('K-08: FINGERPRINT_VERSION constant = 2', () => {
  assert.strictEqual(FINGERPRINT_VERSION, 2);
});

// ── L. Storage estimator ──────────────────────────────────────────────────────

test('L-01: Massy 12 props 2 profiles 1P 1W → deduped = 2×1×52', () => {
  const e = estimateObservationStorage({ propertyCount: 12, profileCount: 2, searchWindowsPerWeek: 1, providers: ['airbnb'] });
  assert.strictEqual(e.deduplicatedObservationsPerYear, 2 * 1 * 52);
});

test('L-02: naive = propertyCount × providers × windows × 52', () => {
  const e = estimateObservationStorage({ propertyCount: 100, profileCount: 50, searchWindowsPerWeek: 1, providers: ['airbnb', 'booking'] });
  assert.strictEqual(e.naiveObservationsPerYear, 100 * 2 * 52);
});

test('L-03: deduped = profileCount × providers × windows × 52', () => {
  const e = estimateObservationStorage({ propertyCount: 100, profileCount: 50, searchWindowsPerWeek: 1, providers: ['airbnb', 'booking'] });
  assert.strictEqual(e.deduplicatedObservationsPerYear, 50 * 2 * 52);
});

test('L-04: estimatedComparableRowsPerYear = 0 when avgComparables = 0', () => {
  const e = estimateObservationStorage({ propertyCount: 12, profileCount: 2, providers: ['airbnb'] });
  assert.strictEqual(e.estimatedComparableRowsPerYear, 0);
});

test('L-05: comparable rows = deduped × avgComparablesPerObservation', () => {
  const e = estimateObservationStorage({ propertyCount: 12, profileCount: 2, searchWindowsPerWeek: 1, providers: ['airbnb'], avgComparablesPerObservation: 50 });
  assert.strictEqual(e.estimatedComparableRowsPerYear, 2 * 1 * 52 * 50);
});

test('L-06: retention note contains INDEFINITE', () => {
  const e = estimateObservationStorage({ propertyCount: 12 });
  assert.ok(e.notes.retention.includes('INDEFINITE'));
});

// ── M. History read model compatibility ───────────────────────────────────────

test('M-01: getObservationHistory returns all rows for a profile', async () => {
  const pool = createMockPool();
  await createObservation(pool, { provider: 'airbnb', collected_at: '2026-09-29T08:00:00Z', search_fingerprint: 'ms2_m01_a', currency: 'EUR', collection_run_id: 'run-m01-1', market_profile_id: 'mp2_target' });
  await createObservation(pool, { provider: 'airbnb', collected_at: '2026-10-06T08:00:00Z', search_fingerprint: 'ms2_m01_b', currency: 'EUR', collection_run_id: 'run-m01-2', market_profile_id: 'mp2_target' });
  const rows = await getObservationHistory(pool, 'mp2_target');
  assert.strictEqual(rows.length, 2);
});

test('M-02: findReusableObservation returns fresh observation', async () => {
  const pool = createMockPool();
  await createObservation(pool, {
    provider: 'airbnb',
    collected_at: new Date(Date.now() - 1000).toISOString(),
    search_fingerprint: 'ms2_m02', currency: 'EUR', collection_run_id: 'run-m02',
  });
  const found = await findReusableObservation(pool, 'ms2_m02', { maxAgeMs: 60_000 });
  assert.ok(found !== null);
});

test('M-03: findReusableObservation returns null for stale observation', async () => {
  const pool = createMockPool();
  await createObservation(pool, {
    provider: 'airbnb',
    collected_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    search_fingerprint: 'ms2_m03', currency: 'EUR', collection_run_id: 'run-m03',
  });
  const found = await findReusableObservation(pool, 'ms2_m03', { maxAgeMs: 60_000 });
  assert.strictEqual(found, null);
});

test('M-04: provider filter in getObservationHistory works', async () => {
  const pool = createMockPool();
  await createObservation(pool, { provider: 'airbnb',  collected_at: '2026-09-29T08:00:00Z', search_fingerprint: 'ms2_m04_a', currency: 'EUR', collection_run_id: 'r-m04-a', market_profile_id: 'mp2_m04' });
  await createObservation(pool, { provider: 'booking', collected_at: '2026-09-29T09:00:00Z', search_fingerprint: 'ms2_m04_b', currency: 'EUR', collection_run_id: 'r-m04-b', market_profile_id: 'mp2_m04' });
  const rows = await getObservationHistory(pool, 'mp2_m04', { provider: 'airbnb' });
  assert.ok(rows.every(r => r.provider === 'airbnb'));
});

test('M-05: year-over-year supported — 2025 and 2026 rows coexist', async () => {
  const pool = createMockPool();
  await createObservation(pool, { provider: 'airbnb', collected_at: '2025-10-01T08:00:00Z', search_fingerprint: 'ms2_m05_25', currency: 'EUR', collection_run_id: 'r-2025', market_profile_id: 'mp2_yoy' });
  await createObservation(pool, { provider: 'airbnb', collected_at: '2026-10-01T08:00:00Z', search_fingerprint: 'ms2_m05_26', currency: 'EUR', collection_run_id: 'r-2026', market_profile_id: 'mp2_yoy' });
  const all = await getObservationHistory(pool, 'mp2_yoy');
  assert.strictEqual(all.length, 2);
  assert.ok(all.some(r => r.collected_at.startsWith('2025')));
  assert.ok(all.some(r => r.collected_at.startsWith('2026')));
});

// ── N. Safety ─────────────────────────────────────────────────────────────────

test('N-01: market-search-identity does not require brightdata', () => {
  const src = fs.readFileSync(path.join(__dirname, '../services/market-search-identity.js'), 'utf8');
  assert.ok(!src.includes('brightdata') && !src.includes('BrightData'));
});

test('N-02: market-shared-search-planner does not require brightdata', () => {
  const src = fs.readFileSync(path.join(__dirname, '../services/market-shared-search-planner.js'), 'utf8');
  assert.ok(!src.includes('brightdata'));
});

test('N-03: market-observation-repository does not require brightdata', () => {
  const src = fs.readFileSync(path.join(__dirname, '../services/market-observation-repository.js'), 'utf8');
  assert.ok(!src.includes('brightdata'));
});

test('N-04: no pricing writes in market-search-identity', () => {
  const src = fs.readFileSync(path.join(__dirname, '../services/market-search-identity.js'), 'utf8');
  assert.ok(!src.includes('pricing_schedule'));
  assert.ok(!src.includes('pricing_history'));
  assert.ok(!src.includes('applyDynamicPricing'));
});

test('N-05: no Channex require/call in any O module', () => {
  // Allow "no Channex" in safety comments; forbid actual require or API usage.
  const files = [
    '../services/market-search-identity.js',
    '../services/market-shared-search-planner.js',
    '../services/market-observation-repository.js',
    '../services/market-observation-storage-estimator.js',
  ];
  const banned = [/require\(['"].*channex/i, /channex\.(send|post|get|put)/i, /channex_api/i];
  for (const f of files) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    for (const re of banned) {
      assert.ok(!re.test(src), `${f} contains banned Channex pattern: ${re}`);
    }
  }
});

test('N-06: repository not required by dynamic-pricing-cron', () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/dynamic-pricing-cron.js'), 'utf8');
  assert.ok(!src.includes('market-observation-repository'));
});

test('N-07: market-search-identity is pure (no pool, no network)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../services/market-search-identity.js'), 'utf8');
  assert.ok(!src.includes('pool.query'));
  assert.ok(!src.includes("require('http')"));
  assert.ok(!src.includes('axios'));
  assert.ok(!src.includes('fetch('));
});

test('N-08: SAFE_TO_ACTIVATE_PRODUCTION = NO in market-search-identity', () => {
  const src = fs.readFileSync(path.join(__dirname, '../services/market-search-identity.js'), 'utf8');
  assert.ok(src.includes('SAFE_TO_ACTIVATE_PRODUCTION = NO'));
});

// ── Runner / Jest shim ────────────────────────────────────────────────────────

async function runAll() {
  await Promise.all(asyncTasks);
}

if (typeof it === 'function') {
  // Jest environment
  it('P1.2-B5-BK-O — all sub-tests pass', async () => {
    await runAll();
    if (failed > 0) {
      const detail = failures.map(f => `  ✗ ${f.label}: ${f.message}`).join('\n');
      throw new Error(`${failed} sub-test(s) failed:\n${detail}`);
    }
    console.log(`\nP1.2-B5-BK-O — ${passed} passed, 0 failed`);
  });
} else {
  // Direct node execution
  runAll().then(() => {
    console.log(`\nP1.2-B5-BK-O — ${passed} passed, ${failed} failed`);
    if (failures.length > 0) {
      console.error('\nFailed tests:');
      failures.forEach(f => console.error(`  ✗ ${f.label}\n    ${f.message}`));
      process.exit(1);
    }
  }).catch(err => { console.error(err); process.exit(1); });
}
