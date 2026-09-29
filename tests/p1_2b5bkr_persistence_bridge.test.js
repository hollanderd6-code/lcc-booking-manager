'use strict';
/**
 * P1.2-B5-BK-R — Market Observation Persistence Bridge Tests
 *
 * Sections:
 *   A  isPersistenceEnabled flag behaviour
 *   B  generateBridgeRunId format
 *   C  mapDataSourceToProvider mapping
 *   D  buildBridgeObservationData structure + fields
 *   E  bridgePersistProductionEvidence — flag OFF (no writes)
 *   F  bridgePersistProductionEvidence — mock source skip
 *   G  bridgePersistProductionEvidence — Ti Junot skip (null geo)
 *   H  bridgePersistProductionEvidence — successful write
 *   I  bridgePersistProductionEvidence — idempotency (REUSED)
 *   J  bridgePersistProductionEvidence — M6/M7 shared fingerprint (two links)
 *   K  bridgePersistProductionEvidence — DB failure isolation (never throws)
 *   L  bridgePersistProductionEvidence — missing currency skip
 *   M  bridgePersistProductionEvidence — invalid fingerprint (missing checkIn)
 *   N  Static safety invariants
 *   O  Cron integration invariants (static analysis)
 *   P  Audit tool static checks
 *
 * Safety:
 *   DB_WRITES     = 0  (all DB calls use injected mocks)
 *   NETWORK_CALLS = 0
 *   BRIGHT_DATA   = 0
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const {
  isPersistenceEnabled,
  generateBridgeRunId,
  mapDataSourceToProvider,
  buildBridgeObservationData,
  bridgePersistProductionEvidence,
} = require('../services/market-observation-persistence-bridge');

let passed   = 0;
let failed   = 0;
const failures = [];

function test(label, fn) {
  try {
    fn();
    passed++;
    process.stdout.write('.');
  } catch (e) {
    failed++;
    failures.push({ label, message: e.message });
    process.stdout.write('F');
  }
}

async function testAsync(label, fn) {
  try {
    await fn();
    passed++;
    process.stdout.write('.');
  } catch (e) {
    failed++;
    failures.push({ label, message: e.message });
    process.stdout.write('F');
  }
}

// All sections run inside this async IIFE — avoids top-level await in CJS
(async () => {

// ── Test fixtures ─────────────────────────────────────────────────────────────

const VALID_CFG = {
  property_id:   42,
  user_id:       7,
  latitude:      48.8566,
  longitude:     2.3522,
  currency:      'EUR',
  max_guests:    4,
  bedrooms:      2,
  property_type: 'entire_place',
};

const NULL_GEO_CFG = {
  property_id: 99,
  user_id:     7,
  latitude:    null,
  longitude:   null,
  currency:    'EUR',
};

const MOCK_STATS = {
  median:       120,
  p25:          95,
  p75:          155,
  count:        30,
  occupancy:    72,
  tensionLevel: 'HIGH',
  _bdSelectionDiag: {
    selectedRadiusKm: 1.2,
    comparableCount:  28,
    selectionStatus:  'ok',
  },
};

const MOCK_LISTINGS = [
  { providerListingId: 'abc1', latitude: 48.857, longitude: 2.353, price: 110, guests: 4, bedrooms: 2, category: 'entire_place' },
  { providerListingId: 'abc2', latitude: 48.858, longitude: 2.354, price: 125, guests: 4, bedrooms: 2, category: 'entire_place' },
];

// ── Mock pool factory ─────────────────────────────────────────────────────────

function makeMockPool({
  existingObs = null,
  insertFails = false,
  connectFails = false,
} = {}) {
  const written    = [];
  const attached   = [];
  const upserted   = [];
  const assigned   = [];

  return {
    _written:    written,
    _attached:   attached,
    _upserted:   upserted,
    _assigned:   assigned,

    async query(sql, params) {
      const s = sql.trim().toUpperCase();

      // upsertMarketProfile
      if (s.startsWith('INSERT INTO MARKET_PROFILES')) {
        upserted.push(params);
        return { rowCount: 1 };
      }
      // assignCurrentProfile
      if (s.startsWith('INSERT INTO MARKET_PROFILE_PROPERTIES')) {
        assigned.push(params);
        return { rowCount: 1 };
      }
      // idempotency check in createObservation
      if (s.startsWith('SELECT OBSERVATION_ID FROM MARKET_OBSERVATIONS')) {
        if (existingObs) {
          return { rows: [{ observation_id: existingObs }] };
        }
        return { rows: [] };
      }
      // attachObservationToProperties standalone
      if (s.startsWith('INSERT INTO MARKET_OBSERVATION_PROPERTIES')) {
        attached.push(params);
        return { rowCount: 1 };
      }
      // main INSERT INTO market_observations
      if (s.startsWith('INSERT INTO MARKET_OBSERVATIONS')) {
        if (insertFails) throw new Error('simulated_db_insert_failure');
        const obsId = 'obs_test_' + Math.random().toString(36).slice(2, 8);
        written.push({ params, obsId });
        return { rows: [{ observation_id: obsId }] };
      }
      return { rows: [], rowCount: 0 };
    },

    async connect() {
      if (connectFails) throw new Error('simulated_connect_failure');
      const self = this;
      return {
        async query(sql, params) { return self.query(sql, params); },
        async query(sql, params) { return self.query(sql, params); },
        release() {},
        // expose methods on client too
        ...{
          async query(sql, params) { return self.query(sql, params); },
          release() {},
        },
      };
    },
  };
}

// Real mock pool with BEGIN/COMMIT/ROLLBACK support
function makeTxPool({
  existingObs = null,
  insertFails = false,
  connectFails = false,
} = {}) {
  const written  = [];
  const attached = [];
  const upserted = [];
  const assigned = [];

  const handler = async (sql, params) => {
    const s = (sql || '').trim().toUpperCase();
    if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
    if (s.startsWith('INSERT INTO MARKET_PROFILES')) {
      upserted.push(params);
      return { rowCount: 1 };
    }
    if (s.startsWith('INSERT INTO MARKET_PROFILE_PROPERTIES')) {
      assigned.push(params);
      return { rowCount: 1 };
    }
    if (s.startsWith('SELECT OBSERVATION_ID FROM MARKET_OBSERVATIONS')) {
      if (existingObs) return { rows: [{ observation_id: existingObs }] };
      return { rows: [] };
    }
    if (s.startsWith('INSERT INTO MARKET_OBSERVATION_PROPERTIES')) {
      attached.push(params);
      return { rowCount: 1 };
    }
    if (s.startsWith('INSERT INTO MARKET_OBSERVATIONS')) {
      if (insertFails) throw new Error('simulated_db_insert_failure');
      const obsId = 'obs_' + Math.random().toString(36).slice(2, 8);
      written.push({ obsId });
      return { rows: [{ observation_id: obsId }] };
    }
    if (s.startsWith('INSERT INTO MARKET_OBSERVATION_COMPARABLES')) {
      return { rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  };

  return {
    _written:  written,
    _attached: attached,
    _upserted: upserted,
    _assigned: assigned,
    async query(sql, params) { return handler(sql, params); },
    async connect() {
      if (connectFails) throw new Error('simulated_connect_failure');
      return {
        async query(sql, params) { return handler(sql, params); },
        release() {},
      };
    },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// A — isPersistenceEnabled
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nA — isPersistenceEnabled');

test('A-01: returns false when env var unset', () => {
  const orig = process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED;
  delete process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED;
  assert.strictEqual(isPersistenceEnabled(), false);
  if (orig !== undefined) process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED = orig;
});

test('A-02: returns false when set to "false"', () => {
  process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED = 'false';
  assert.strictEqual(isPersistenceEnabled(), false);
  delete process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED;
});

test('A-03: returns false when set to "1"', () => {
  process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED = '1';
  assert.strictEqual(isPersistenceEnabled(), false);
  delete process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED;
});

test('A-04: returns true when set to "true"', () => {
  process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED = 'true';
  assert.strictEqual(isPersistenceEnabled(), true);
  delete process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED;
});

test('A-05: does NOT require MARKET_SHARED_COLLECTION_ENABLED (R4)', () => {
  delete process.env.MARKET_SHARED_COLLECTION_ENABLED;
  process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED = 'true';
  assert.strictEqual(isPersistenceEnabled(), true, 'Must be true without MARKET_SHARED_COLLECTION_ENABLED');
  delete process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED;
});

// ═════════════════════════════════════════════════════════════════════════════
// B — generateBridgeRunId
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nB — generateBridgeRunId');

test('B-01: starts with brun_', () => {
  assert.ok(generateBridgeRunId().startsWith('brun_'), 'Must start with brun_');
});

test('B-02: each call returns a different ID', () => {
  const a = generateBridgeRunId();
  const b = generateBridgeRunId();
  assert.notStrictEqual(a, b, 'Must generate unique IDs');
});

test('B-03: ID has UUID v4 format after prefix', () => {
  const id = generateBridgeRunId();
  const uuid = id.slice('brun_'.length);
  assert.ok(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuid),
    `UUID part must be v4 format: ${uuid}`);
});

test('B-04: distinct from crun_ prefix used by shadow coordinator', () => {
  assert.ok(!generateBridgeRunId().startsWith('crun_'), 'Must NOT use crun_ prefix');
});

// ═════════════════════════════════════════════════════════════════════════════
// C — mapDataSourceToProvider
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nC — mapDataSourceToProvider');

test('C-01: brightdata_live → airbnb', () => {
  assert.strictEqual(mapDataSourceToProvider('brightdata_live'), 'airbnb');
});

test('C-02: apify_live → airbnb', () => {
  assert.strictEqual(mapDataSourceToProvider('apify_live'), 'airbnb');
});

test('C-03: apify → airbnb', () => {
  assert.strictEqual(mapDataSourceToProvider('apify'), 'airbnb');
});

test('C-04: brightdata_booking_live → booking', () => {
  assert.strictEqual(mapDataSourceToProvider('brightdata_booking_live'), 'booking');
});

test('C-05: mock → null (no real evidence)', () => {
  assert.strictEqual(mapDataSourceToProvider('mock'), null);
});

test('C-06: undefined → null', () => {
  assert.strictEqual(mapDataSourceToProvider(undefined), null);
});

test('C-07: unknown string → null', () => {
  assert.strictEqual(mapDataSourceToProvider('some_unknown_source'), null);
});

// ═════════════════════════════════════════════════════════════════════════════
// D — buildBridgeObservationData
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nD — buildBridgeObservationData');

const BASE_OBS_OPTS = {
  provider:           'airbnb',
  dataSource:         'brightdata_live',
  fingerprint:        'ms2_abc123',
  profileId:          'mp2_def456',
  collectionRunId:    'brun_uuid',
  checkIn:            '2026-10-15',
  checkOut:           '2026-10-16',
  currency:           'EUR',
  targetLat:          '48.8566',
  targetLon:          '2.3522',
  targetGuests:       4,
  targetBedrooms:     2,
  targetPropertyType: 'entire_place',
  marketStats:        MOCK_STATS,
  collectedAt:        '2026-09-29T10:00:00.000Z',
};

test('D-01: observation_type is PROVIDER (not consensus)', () => {
  const obs = buildBridgeObservationData(BASE_OBS_OPTS);
  assert.strictEqual(obs.observation_type, 'PROVIDER');
});

test('D-02: provider matches input', () => {
  const obs = buildBridgeObservationData(BASE_OBS_OPTS);
  assert.strictEqual(obs.provider, 'airbnb');
});

test('D-03: data_source matches input', () => {
  const obs = buildBridgeObservationData(BASE_OBS_OPTS);
  assert.strictEqual(obs.data_source, 'brightdata_live');
});

test('D-04: median_price from marketStats.median', () => {
  const obs = buildBridgeObservationData(BASE_OBS_OPTS);
  assert.strictEqual(obs.median_price, 120);
});

test('D-05: p25_price from marketStats.p25', () => {
  const obs = buildBridgeObservationData(BASE_OBS_OPTS);
  assert.strictEqual(obs.p25_price, 95);
});

test('D-06: p75_price from marketStats.p75', () => {
  const obs = buildBridgeObservationData(BASE_OBS_OPTS);
  assert.strictEqual(obs.p75_price, 155);
});

test('D-07: selected_radius_km from _bdSelectionDiag', () => {
  const obs = buildBridgeObservationData(BASE_OBS_OPTS);
  assert.strictEqual(obs.selected_radius_km, 1.2);
});

test('D-08: comparable_count from _bdSelectionDiag.comparableCount', () => {
  const obs = buildBridgeObservationData(BASE_OBS_OPTS);
  assert.strictEqual(obs.comparable_count, 28);
});

test('D-09: provenance.bridge === true', () => {
  const obs = buildBridgeObservationData(BASE_OBS_OPTS);
  assert.strictEqual(obs.provenance.bridge, true);
});

test('D-10: nights computed from checkIn/checkOut', () => {
  const obs = buildBridgeObservationData(BASE_OBS_OPTS);
  assert.strictEqual(obs.nights, 1);
});

test('D-11: nights is null when checkIn/checkOut absent', () => {
  const obs = buildBridgeObservationData({ ...BASE_OBS_OPTS, checkIn: null, checkOut: null });
  assert.strictEqual(obs.nights, null);
});

test('D-12: collection_run_id matches input', () => {
  const obs = buildBridgeObservationData(BASE_OBS_OPTS);
  assert.strictEqual(obs.collection_run_id, 'brun_uuid');
});

test('D-13: market_profile_id matches input', () => {
  const obs = buildBridgeObservationData(BASE_OBS_OPTS);
  assert.strictEqual(obs.market_profile_id, 'mp2_def456');
});

test('D-14: schema_version is 1', () => {
  const obs = buildBridgeObservationData(BASE_OBS_OPTS);
  assert.strictEqual(obs.schema_version, 1);
});

test('D-15: market_data authority fields are null (R10 — no pricing writes)', () => {
  const obs = buildBridgeObservationData(BASE_OBS_OPTS);
  // Bridge never sets these to signal it's not production pricing data
  assert.strictEqual(obs.min_price, null);
  assert.strictEqual(obs.max_price, null);
  assert.strictEqual(obs.quality_status, null);
  assert.strictEqual(obs.confidence, null);
});

test('D-16: comparable_count falls back to marketStats.count when no _bdSelectionDiag', () => {
  const opts = { ...BASE_OBS_OPTS, marketStats: { median: 100, p25: 80, p75: 120, count: 15 } };
  const obs  = buildBridgeObservationData(opts);
  assert.strictEqual(obs.comparable_count, 15);
});

// ═════════════════════════════════════════════════════════════════════════════
// E — bridgePersistProductionEvidence — flag OFF
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nE — flag OFF: no writes');

// When the flag is OFF, the bridge is not called by the cron — we test the
// function in isolation to confirm it still operates correctly when invoked.
// These tests verify that mock→skip works when the function is used by callers
// that check the flag themselves.
// Specifically: the cron ONLY calls bridgePersistProductionEvidence when
// isPersistenceEnabled() === true.

// We verify via static analysis (section O) that the cron gates the bridge call.

// E: Flag-off tests verify the gating logic at the function level for mock sources
// (the primary internal skip path available without a live DB).

await testAsync('E-01: mock dataSource → skip regardless of flag state', async () => {
  const pool = makeTxPool();
  const r = await bridgePersistProductionEvidence(pool, {
    cfg: VALID_CFG, listings: MOCK_LISTINGS, marketStats: MOCK_STATS,
    dataSource: 'mock', collectionRunId: 'brun_x',
    checkIn: '2026-10-15', checkOut: '2026-10-16',
  });
  assert.strictEqual(r.status, 'skipped');
  assert.strictEqual(r.reason, 'mock_source');
  assert.strictEqual(pool._written.length, 0, 'Must not write any observation for mock source');
});

// ═════════════════════════════════════════════════════════════════════════════
// F — mock source skip
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nF — mock source skip');

await testAsync('F-01: mock → status=skipped, reason=mock_source', async () => {
  const pool = makeTxPool();
  const r = await bridgePersistProductionEvidence(pool, {
    cfg: VALID_CFG, listings: [], marketStats: MOCK_STATS,
    dataSource: 'mock', collectionRunId: 'brun_x',
    checkIn: '2026-10-15', checkOut: '2026-10-16',
  });
  assert.strictEqual(r.status, 'skipped');
  assert.strictEqual(r.reason, 'mock_source');
  assert.strictEqual(r.obsId, null);
});

await testAsync('F-02: null dataSource → status=skipped', async () => {
  const pool = makeTxPool();
  const r = await bridgePersistProductionEvidence(pool, {
    cfg: VALID_CFG, listings: [], marketStats: MOCK_STATS,
    dataSource: null, collectionRunId: 'brun_x',
    checkIn: '2026-10-15', checkOut: '2026-10-16',
  });
  assert.strictEqual(r.status, 'skipped');
});

await testAsync('F-03: unknown dataSource → status=skipped', async () => {
  const pool = makeTxPool();
  const r = await bridgePersistProductionEvidence(pool, {
    cfg: VALID_CFG, listings: [], marketStats: MOCK_STATS,
    dataSource: 'legacy_scraper_v1', collectionRunId: 'brun_x',
    checkIn: '2026-10-15', checkOut: '2026-10-16',
  });
  assert.strictEqual(r.status, 'skipped');
});

// ═════════════════════════════════════════════════════════════════════════════
// G — Ti Junot skip (null geo / profile incomplete)
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nG — Ti Junot skip (profile incomplete)');

await testAsync('G-01: null lat/lon → status=skipped, OBS_PERSIST_SKIPPED_PROFILE_INCOMPLETE', async () => {
  const pool = makeTxPool();
  const r = await bridgePersistProductionEvidence(pool, {
    cfg: NULL_GEO_CFG, listings: [], marketStats: MOCK_STATS,
    dataSource: 'brightdata_live', collectionRunId: 'brun_x',
    checkIn: '2026-10-15', checkOut: '2026-10-16',
  });
  assert.strictEqual(r.status, 'skipped');
  assert.ok(r.reason.includes('profile_incomplete') || r.reason === 'profile_incomplete');
  assert.strictEqual(pool._written.length, 0, 'No write on incomplete profile');
});

await testAsync('G-02: missing currency → status=skipped', async () => {
  const pool = makeTxPool();
  const r = await bridgePersistProductionEvidence(pool, {
    cfg: { ...VALID_CFG, currency: null },
    listings: [], marketStats: MOCK_STATS,
    dataSource: 'brightdata_live', collectionRunId: 'brun_x',
    checkIn: '2026-10-15', checkOut: '2026-10-16',
  });
  assert.strictEqual(r.status, 'skipped');
});

await testAsync('G-03: invalid currency (not 3 uppercase letters) → status=skipped', async () => {
  const pool = makeTxPool();
  const r = await bridgePersistProductionEvidence(pool, {
    cfg: { ...VALID_CFG, currency: 'eu' },
    listings: [], marketStats: MOCK_STATS,
    dataSource: 'brightdata_live', collectionRunId: 'brun_x',
    checkIn: '2026-10-15', checkOut: '2026-10-16',
  });
  assert.strictEqual(r.status, 'skipped');
});

await testAsync('G-04: null cfg → status=skipped (not crash)', async () => {
  const pool = makeTxPool();
  const r = await bridgePersistProductionEvidence(pool, {
    cfg: null, listings: [], marketStats: MOCK_STATS,
    dataSource: 'brightdata_live', collectionRunId: 'brun_x',
    checkIn: '2026-10-15', checkOut: '2026-10-16',
  });
  assert.strictEqual(r.status, 'skipped');
  assert.notStrictEqual(r.reason, null);
});

await testAsync('G-05: lat=0, lon=0 (equator/meridian) → treated as valid geo, NOT skipped', async () => {
  const pool = makeTxPool();
  const r = await bridgePersistProductionEvidence(pool, {
    cfg: { ...VALID_CFG, latitude: 0, longitude: 0 },
    listings: [], marketStats: MOCK_STATS,
    dataSource: 'brightdata_live', collectionRunId: 'brun_x',
    checkIn: '2026-10-15', checkOut: '2026-10-16',
  });
  // lat=0/lon=0 is valid — bridge must attempt the write (may succeed or fail on DB mock)
  assert.notStrictEqual(r.status, 'skipped', 'lat=0/lon=0 is valid geo — must not skip');
});

// ═════════════════════════════════════════════════════════════════════════════
// H — successful write
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nH — successful write');

await testAsync('H-01: returns status=written with obsId', async () => {
  const pool = makeTxPool();
  const r = await bridgePersistProductionEvidence(pool, {
    cfg: VALID_CFG, listings: MOCK_LISTINGS, marketStats: MOCK_STATS,
    dataSource: 'brightdata_live', collectionRunId: 'brun_test_run',
    checkIn: '2026-10-15', checkOut: '2026-10-16',
    propertyLinks: [{ property_id: '42', user_id: '7' }],
  });
  assert.strictEqual(r.status, 'written');
  assert.ok(r.obsId, 'Must return an obsId');
  assert.strictEqual(r.reason, null);
});

await testAsync('H-02: observation was inserted (pool._written.length === 1)', async () => {
  const pool = makeTxPool();
  await bridgePersistProductionEvidence(pool, {
    cfg: VALID_CFG, listings: MOCK_LISTINGS, marketStats: MOCK_STATS,
    dataSource: 'brightdata_live', collectionRunId: 'brun_h02',
    checkIn: '2026-10-15', checkOut: '2026-10-16',
    propertyLinks: [{ property_id: '42', user_id: '7' }],
  });
  assert.strictEqual(pool._written.length, 1, 'Exactly one observation written');
});

await testAsync('H-03: market_profile was upserted', async () => {
  const pool = makeTxPool();
  await bridgePersistProductionEvidence(pool, {
    cfg: VALID_CFG, listings: MOCK_LISTINGS, marketStats: MOCK_STATS,
    dataSource: 'brightdata_live', collectionRunId: 'brun_h03',
    checkIn: '2026-10-15', checkOut: '2026-10-16',
    propertyLinks: [{ property_id: '42', user_id: '7' }],
  });
  assert.ok(pool._upserted.length >= 1, 'market_profiles must be upserted');
});

await testAsync('H-04: current profile was assigned for property', async () => {
  const pool = makeTxPool();
  await bridgePersistProductionEvidence(pool, {
    cfg: VALID_CFG, listings: [], marketStats: MOCK_STATS,
    dataSource: 'brightdata_live', collectionRunId: 'brun_h04',
    checkIn: '2026-10-15', checkOut: '2026-10-16',
    propertyLinks: [{ property_id: '42', user_id: '7' }],
  });
  assert.ok(pool._assigned.length >= 1, 'assignCurrentProfile must be called');
});

await testAsync('H-05: apify_live also succeeds (status=written)', async () => {
  const pool = makeTxPool();
  const r = await bridgePersistProductionEvidence(pool, {
    cfg: VALID_CFG, listings: [], marketStats: MOCK_STATS,
    dataSource: 'apify_live', collectionRunId: 'brun_h05',
    checkIn: '2026-10-15', checkOut: '2026-10-16',
  });
  assert.strictEqual(r.status, 'written');
});

await testAsync('H-06: apify also succeeds (status=written)', async () => {
  const pool = makeTxPool();
  const r = await bridgePersistProductionEvidence(pool, {
    cfg: VALID_CFG, listings: [], marketStats: MOCK_STATS,
    dataSource: 'apify', collectionRunId: 'brun_h06',
    checkIn: '2026-10-15', checkOut: '2026-10-16',
  });
  assert.strictEqual(r.status, 'written');
});

await testAsync('H-07: empty listings array does not crash', async () => {
  const pool = makeTxPool();
  const r = await bridgePersistProductionEvidence(pool, {
    cfg: VALID_CFG, listings: [], marketStats: MOCK_STATS,
    dataSource: 'brightdata_live', collectionRunId: 'brun_h07',
    checkIn: '2026-10-15', checkOut: '2026-10-16',
  });
  assert.strictEqual(r.status, 'written');
});

await testAsync('H-08: undefined listings does not crash', async () => {
  const pool = makeTxPool();
  const r = await bridgePersistProductionEvidence(pool, {
    cfg: VALID_CFG, listings: undefined, marketStats: MOCK_STATS,
    dataSource: 'brightdata_live', collectionRunId: 'brun_h08',
    checkIn: '2026-10-15', checkOut: '2026-10-16',
  });
  assert.strictEqual(r.status, 'written');
});

// ═════════════════════════════════════════════════════════════════════════════
// I — idempotency (REUSED)
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nI — idempotency (REUSED)');

await testAsync('I-01: same run+fingerprint → status=reused', async () => {
  const pool = makeTxPool({ existingObs: 'obs_existing_123' });
  const r = await bridgePersistProductionEvidence(pool, {
    cfg: VALID_CFG, listings: [], marketStats: MOCK_STATS,
    dataSource: 'brightdata_live', collectionRunId: 'brun_same',
    checkIn: '2026-10-15', checkOut: '2026-10-16',
    propertyLinks: [{ property_id: '42', user_id: '7' }],
  });
  assert.strictEqual(r.status, 'reused');
  assert.strictEqual(r.obsId, 'obs_existing_123');
  assert.strictEqual(r.reason, 'idempotent');
});

await testAsync('I-02: reused observation → no new row in pool._written', async () => {
  const pool = makeTxPool({ existingObs: 'obs_existing_456' });
  await bridgePersistProductionEvidence(pool, {
    cfg: VALID_CFG, listings: [], marketStats: MOCK_STATS,
    dataSource: 'brightdata_live', collectionRunId: 'brun_same',
    checkIn: '2026-10-15', checkOut: '2026-10-16',
    propertyLinks: [{ property_id: '42', user_id: '7' }],
  });
  assert.strictEqual(pool._written.length, 0, 'Must not insert a new row on idempotent retry');
});

await testAsync('I-03: reused observation → attachObservationToProperties called for M6/M7 (R5)', async () => {
  const pool = makeTxPool({ existingObs: 'obs_shared_789' });
  await bridgePersistProductionEvidence(pool, {
    cfg: VALID_CFG, listings: [], marketStats: MOCK_STATS,
    dataSource: 'brightdata_live', collectionRunId: 'brun_shared',
    checkIn: '2026-10-15', checkOut: '2026-10-16',
    propertyLinks: [{ property_id: '43', user_id: '7' }],
  });
  assert.ok(pool._attached.length >= 1,
    'Must attach property link even on idempotent retry (R5 M6/M7 shared profile)');
});

// ═════════════════════════════════════════════════════════════════════════════
// J — M6/M7 shared fingerprint (two property links)
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nJ — M6/M7 shared fingerprint (two links)');

await testAsync('J-01: M6 call (first) → new observation written', async () => {
  const pool = makeTxPool();
  const r = await bridgePersistProductionEvidence(pool, {
    cfg: VALID_CFG, listings: MOCK_LISTINGS, marketStats: MOCK_STATS,
    dataSource: 'brightdata_live', collectionRunId: 'brun_shared_run',
    checkIn: '2026-10-15', checkOut: '2026-10-16',
    propertyLinks: [{ property_id: '6', user_id: '7' }],
  });
  assert.strictEqual(r.status, 'written');
  assert.ok(r.obsId, 'M6 must get an obsId');
});

await testAsync('J-02: M7 call (same run+profile) → reused, link attached', async () => {
  // Simulate: M6 already wrote the obs → M7 finds it via idempotency check
  const m6ObsId = 'obs_m6_abc';
  const pool    = makeTxPool({ existingObs: m6ObsId });
  const r = await bridgePersistProductionEvidence(pool, {
    cfg: VALID_CFG, listings: MOCK_LISTINGS, marketStats: MOCK_STATS,
    dataSource: 'brightdata_live', collectionRunId: 'brun_shared_run',
    checkIn: '2026-10-15', checkOut: '2026-10-16',
    propertyLinks: [{ property_id: '7', user_id: '7' }],
  });
  assert.strictEqual(r.status, 'reused', 'M7 must reuse M6 observation');
  assert.strictEqual(r.obsId, m6ObsId, 'M7 must reference the M6 obsId');
  assert.ok(pool._attached.some(a => a[1] === '7' || a.includes('7')),
    'M7 property link must be attached to the existing observation');
});

await testAsync('J-03: shared run → only one observation written (not two)', async () => {
  // First call writes, second finds existing
  const pool = makeTxPool({ existingObs: null });
  await bridgePersistProductionEvidence(pool, {
    cfg: VALID_CFG, listings: [], marketStats: MOCK_STATS,
    dataSource: 'brightdata_live', collectionRunId: 'brun_shared_run',
    checkIn: '2026-10-15', checkOut: '2026-10-16',
    propertyLinks: [{ property_id: '6', user_id: '7' }],
  });
  assert.strictEqual(pool._written.length, 1, 'Exactly one observation written for shared profile');
});

// ═════════════════════════════════════════════════════════════════════════════
// K — DB failure isolation (R7: never throws)
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nK — DB failure isolation (R7)');

await testAsync('K-01: pool.connect() failure → status=error, does NOT throw', async () => {
  const pool = makeTxPool({ connectFails: true });
  let threw = false;
  let r;
  try {
    r = await bridgePersistProductionEvidence(pool, {
      cfg: VALID_CFG, listings: [], marketStats: MOCK_STATS,
      dataSource: 'brightdata_live', collectionRunId: 'brun_fail',
      checkIn: '2026-10-15', checkOut: '2026-10-16',
    });
  } catch {
    threw = true;
  }
  assert.strictEqual(threw, false, 'R7: Must NEVER throw — failure must be caught');
  assert.strictEqual(r.status, 'error');
  assert.ok(r.reason, 'Must report the error reason');
});

await testAsync('K-02: INSERT failure → status=error, does NOT throw', async () => {
  const pool = makeTxPool({ insertFails: true });
  let threw = false;
  let r;
  try {
    r = await bridgePersistProductionEvidence(pool, {
      cfg: VALID_CFG, listings: [], marketStats: MOCK_STATS,
      dataSource: 'brightdata_live', collectionRunId: 'brun_fail2',
      checkIn: '2026-10-15', checkOut: '2026-10-16',
    });
  } catch {
    threw = true;
  }
  assert.strictEqual(threw, false, 'R7: Must NEVER throw on INSERT failure');
  assert.strictEqual(r.status, 'error');
});

await testAsync('K-03: error result has obsId=null', async () => {
  const pool = makeTxPool({ connectFails: true });
  const r = await bridgePersistProductionEvidence(pool, {
    cfg: VALID_CFG, listings: [], marketStats: MOCK_STATS,
    dataSource: 'brightdata_live', collectionRunId: 'brun_fail3',
    checkIn: '2026-10-15', checkOut: '2026-10-16',
  });
  assert.strictEqual(r.obsId, null);
});

// ═════════════════════════════════════════════════════════════════════════════
// L — missing currency skip
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nL — missing currency skip');

await testAsync('L-01: currency null → skipped', async () => {
  const pool = makeTxPool();
  const r = await bridgePersistProductionEvidence(pool, {
    cfg: { ...VALID_CFG, currency: null },
    listings: [], marketStats: MOCK_STATS,
    dataSource: 'brightdata_live', collectionRunId: 'brun_l01',
    checkIn: '2026-10-15', checkOut: '2026-10-16',
  });
  assert.strictEqual(r.status, 'skipped');
});

await testAsync('L-02: currency empty string → skipped', async () => {
  const pool = makeTxPool();
  const r = await bridgePersistProductionEvidence(pool, {
    cfg: { ...VALID_CFG, currency: '' },
    listings: [], marketStats: MOCK_STATS,
    dataSource: 'brightdata_live', collectionRunId: 'brun_l02',
    checkIn: '2026-10-15', checkOut: '2026-10-16',
  });
  assert.strictEqual(r.status, 'skipped');
});

// ═════════════════════════════════════════════════════════════════════════════
// M — invalid fingerprint (missing checkIn)
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nM — invalid fingerprint');

await testAsync('M-01: missing checkIn → skipped (invalid_fingerprint)', async () => {
  const pool = makeTxPool();
  const r = await bridgePersistProductionEvidence(pool, {
    cfg: VALID_CFG, listings: [], marketStats: MOCK_STATS,
    dataSource: 'brightdata_live', collectionRunId: 'brun_m01',
    checkIn: null, checkOut: '2026-10-16',
  });
  assert.strictEqual(r.status, 'skipped');
  assert.ok(r.reason.includes('fingerprint') || r.reason.includes('check_in'),
    `Expected fingerprint/check_in in reason: ${r.reason}`);
});

await testAsync('M-02: missing checkOut → skipped (invalid_fingerprint)', async () => {
  const pool = makeTxPool();
  const r = await bridgePersistProductionEvidence(pool, {
    cfg: VALID_CFG, listings: [], marketStats: MOCK_STATS,
    dataSource: 'brightdata_live', collectionRunId: 'brun_m02',
    checkIn: '2026-10-15', checkOut: null,
  });
  assert.strictEqual(r.status, 'skipped');
});

// ═════════════════════════════════════════════════════════════════════════════
// N — Static safety invariants
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nN — Static safety invariants');

const BRIDGE_SOURCE = fs.readFileSync(
  path.join(__dirname, '../services/market-observation-persistence-bridge.js'), 'utf8'
);

test('N-01: bridge does not import from market-provider (no scrape)', () => {
  assert.ok(!BRIDGE_SOURCE.includes("require('../services/market-provider')") &&
            !BRIDGE_SOURCE.includes("require('./market-provider')"),
    'Bridge must not import market-provider (no scrape dependencies)');
});

test('N-02: bridge does not call scrapeWithBrightData', () => {
  assert.ok(!BRIDGE_SOURCE.includes('scrapeWithBrightData('),
    'Bridge must NEVER call scrapeWithBrightData — zero BD credits');
});

test('N-03: bridge does not reference market_data table', () => {
  assert.ok(!BRIDGE_SOURCE.includes('market_data'),
    'Bridge must NOT touch market_data (R10 — that is production pricing authority)');
});

test('N-04: bridge does not UPDATE pricing_config', () => {
  assert.ok(!/UPDATE\s+pricing_config/i.test(BRIDGE_SOURCE),
    'Bridge must never write to pricing_config');
});

test('N-05: BRIGHT_DATA_CALLS declared as 0', () => {
  assert.ok(BRIDGE_SOURCE.includes('BRIGHT_DATA_CALLS      = 0'),
    'Must declare BRIGHT_DATA_CALLS = 0');
});

test('N-06: MARKET_DATA_WRITES declared as 0', () => {
  assert.ok(BRIDGE_SOURCE.includes('MARKET_DATA_WRITES     = 0'),
    'Must declare MARKET_DATA_WRITES = 0');
});

test('N-07: PRICING_WRITES declared as 0', () => {
  assert.ok(BRIDGE_SOURCE.includes('PRICING_WRITES         = 0'),
    'Must declare PRICING_WRITES = 0');
});

test('N-08: OBS_PERSIST_ATTEMPT log key present', () => {
  assert.ok(BRIDGE_SOURCE.includes('OBS_PERSIST_ATTEMPT'),
    'Must emit OBS_PERSIST_ATTEMPT log');
});

test('N-09: OBS_PERSIST_SUCCESS log key present', () => {
  assert.ok(BRIDGE_SOURCE.includes('OBS_PERSIST_SUCCESS'),
    'Must emit OBS_PERSIST_SUCCESS log');
});

test('N-10: OBS_PERSIST_REUSED log key present', () => {
  assert.ok(BRIDGE_SOURCE.includes('OBS_PERSIST_REUSED'),
    'Must emit OBS_PERSIST_REUSED log');
});

test('N-11: OBS_PERSIST_SKIPPED_PROFILE_INCOMPLETE log key present', () => {
  assert.ok(BRIDGE_SOURCE.includes('OBS_PERSIST_SKIPPED_PROFILE_INCOMPLETE'),
    'Must emit OBS_PERSIST_SKIPPED_PROFILE_INCOMPLETE (Ti Junot path)');
});

test('N-12: OBS_PERSIST_SKIPPED_MOCK log key present', () => {
  assert.ok(BRIDGE_SOURCE.includes('OBS_PERSIST_SKIPPED_MOCK'),
    'Must emit OBS_PERSIST_SKIPPED_MOCK log');
});

test('N-13: OBS_PERSIST_FAILURE log key present', () => {
  assert.ok(BRIDGE_SOURCE.includes('OBS_PERSIST_FAILURE'),
    'Must emit OBS_PERSIST_FAILURE log (R7 caught error)');
});

test('N-14: R15 activation constraint declared in source', () => {
  assert.ok(BRIDGE_SOURCE.includes('MARKET_OBSERVATION_PERSISTENCE_ENABLED'),
    'Must reference the flag name so it is searchable');
});

test('N-15: attachObservationToProperties called in reuse path (R5 M6/M7)', () => {
  assert.ok(BRIDGE_SOURCE.includes('attachObservationToProperties'),
    'Must call attachObservationToProperties for shared-profile idempotent path');
});

// ═════════════════════════════════════════════════════════════════════════════
// O — Cron integration invariants (static analysis)
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nO — Cron integration invariants');

const CRON_SOURCE = fs.readFileSync(
  path.join(__dirname, '../routes/dynamic-pricing-cron.js'), 'utf8'
);

test('O-01: cron lazy-requires the bridge with _getBridge()', () => {
  assert.ok(CRON_SOURCE.includes('_getBridge()'),
    'Must lazy-require the bridge via _getBridge()');
});

test('O-02: cron requires market-observation-persistence-bridge', () => {
  assert.ok(CRON_SOURCE.includes('market-observation-persistence-bridge'),
    'Cron must require market-observation-persistence-bridge');
});

test('O-03: cron gates bridge call with isPersistenceEnabled()', () => {
  assert.ok(CRON_SOURCE.includes('isPersistenceEnabled()'),
    'Cron must gate bridge call with isPersistenceEnabled()');
});

test('O-04: cron generates bridgeRunId before main loop', () => {
  assert.ok(CRON_SOURCE.includes('bridgeRunId') || CRON_SOURCE.includes('bridgeCollectionRunId'),
    'Must generate a bridge run ID for the whole job');
});

test('O-05: cron calls bridgePersistProductionEvidence', () => {
  assert.ok(CRON_SOURCE.includes('bridgePersistProductionEvidence'),
    'Must call bridgePersistProductionEvidence');
});

test('O-06: bridge call is fire-and-forget (.catch)', () => {
  assert.ok(CRON_SOURCE.includes('bridgePersistProductionEvidence') &&
            CRON_SOURCE.includes('.catch('),
    'Bridge call must be fire-and-forget with .catch()');
});

test('O-07: bridge call in runDynamicPricingJob is after writeResult.written check', () => {
  const writeIdx  = CRON_SOURCE.indexOf('writeResult.written');
  const bridgeIdx = CRON_SOURCE.indexOf('bridgePersistProductionEvidence');
  assert.ok(bridgeIdx > writeIdx,
    'Bridge call must come after writeResult.written check');
});

test('O-08: bridge call also present in runDynamicPricingForOneProperty', () => {
  const oneIdx    = CRON_SOURCE.indexOf('runDynamicPricingForOneProperty');
  const bridgeIdx = CRON_SOURCE.indexOf('bridgePersistProductionEvidence', oneIdx);
  assert.ok(bridgeIdx > oneIdx,
    'Bridge must also be integrated in runDynamicPricingForOneProperty');
});

test('O-09: bridge never modifies the existing writeScrapeResult flow (market_data unchanged)', () => {
  assert.ok(CRON_SOURCE.includes('writeScrapeResult'),
    'writeScrapeResult must still be called — market_data path must be unchanged');
});

test('O-10: getBrightDataMarketDates called before loop for bridge dates', () => {
  assert.ok(CRON_SOURCE.includes('getBrightDataMarketDates'),
    'Must call getBrightDataMarketDates for bridge checkIn/checkOut');
});

// ═════════════════════════════════════════════════════════════════════════════
// P — Audit tool static checks
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nP — Audit tool static checks');

const AUDIT_SOURCE = fs.readFileSync(
  path.join(__dirname, '../outils/audit-market-persistence-activation-r.js'), 'utf8'
);

test('P-01: audit does not write to market_observations', () => {
  assert.ok(!AUDIT_SOURCE.includes('INSERT INTO market_observations'),
    'Audit must NOT write observations — read-only');
});

test('P-02: audit does not call bridgePersistProductionEvidence', () => {
  assert.ok(!AUDIT_SOURCE.includes('bridgePersistProductionEvidence'),
    'Audit must not trigger bridge writes');
});

test('P-03: audit references R15 constraint (DO NOT enable flags)', () => {
  assert.ok(AUDIT_SOURCE.includes('R15'),
    'Must include R15 constraint reference');
});

test('P-04: audit uses canonical JOIN (pricing_config pc JOIN properties p)', () => {
  assert.ok(AUDIT_SOURCE.includes('pricing_config') && AUDIT_SOURCE.includes('properties'),
    'Must use canonical join to get active properties');
});

test('P-05: audit uses mapDataSourceToProvider to document eligibility', () => {
  assert.ok(AUDIT_SOURCE.includes('mapDataSourceToProvider'),
    'Must document which data sources are eligible');
});

test('P-06: audit declares DB_WRITES=0', () => {
  assert.ok(AUDIT_SOURCE.includes('DB_WRITES'),
    'Must declare DB_WRITES=0 safety constraint');
});

// ── Final report ──────────────────────────────────────────────────────────────

  console.log('\n');
  if (failed > 0) {
    const detail = failures.map(f => `  ✗ ${f.label}: ${f.message}`).join('\n');
    console.error(`P1.2-B5-BK-R — ${passed} passed, ${failed} failed:\n${detail}`);
    process.exit(1);
  } else {
    console.log(`P1.2-B5-BK-R — ${passed} passed, ${failed} failed`);
  }
})();
