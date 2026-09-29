'use strict';
/**
 * P1.2-B5-BK-P21 — Persisted Observation Reuse
 *
 * Root-cause proof for smoke B-09 failure + full reuse contract tests.
 *
 * ABSOLUTE SAFETY:
 *   DB_WRITES        = 0  in-memory mock only
 *   NETWORK_CALLS    = 0
 *   BD_CREDITS       = 0
 *   SAFE_TO_ACTIVATE = NO
 *
 * Usage:
 *   node tests/p1_2b5bkp21_persisted_reuse.test.js
 */

const assert = require('node:assert/strict');
const fs     = require('fs');
const path   = require('path');

const { findReusableObservation } = require('../services/market-observation-repository');
const {
  generateCollectionRunId,
  coordinateCollection,
} = require('../services/market-shared-collection-coordinator');

// ── Helpers ───────────────────────────────────────────────────────────────────

let pass = 0, fail = 0;
function ok(label)          { console.log(`  ✓ ${label}`); pass++; }
function err(label, detail) { console.log(`  ✗ ${label}  — ${detail}`); fail++; }

// ── findReusableObservation mock pool ─────────────────────────────────────────
// Direct in-memory pool that implements only the SELECT used by findReusableObservation.
// $1 = fingerprint, $2 = lower cutoff (ISO), $3 = upper future bound (ISO).

function makeReusePool(observations = []) {
  return {
    async query(sql, params = []) {
      const s = sql.trim().replace(/\s+/g, ' ');
      if (/SELECT \* FROM market_observations/.test(s)) {
        const fp     = params[0];
        const cutoff = new Date(params[1]);
        const future = params[2] ? new Date(params[2]) : new Date(8640000000000000);
        const rows   = observations
          .filter(r =>
            r.search_fingerprint === fp     &&
            new Date(r.collected_at) >= cutoff &&
            new Date(r.collected_at) <= future
          )
          .sort((a, b) => new Date(b.collected_at) - new Date(a.collected_at));
        return { rows: rows.slice(0, 1) };
      }
      return { rows: [] };
    },
  };
}

// Observation factory — collected_at defaults to NOW (always fresh).
function makeObs(fp, overrides = {}) {
  return {
    search_fingerprint: fp,
    observation_id:     overrides.observation_id ?? `obs_${Math.random().toString(36).slice(2)}`,
    collected_at:       overrides.collected_at   ?? new Date().toISOString(),
    provider:           overrides.provider       ?? 'airbnb',
    observation_type:   overrides.observation_type ?? 'PROVIDER',
    collection_run_id:  overrides.collection_run_id ?? null,
  };
}

// ── Full coordinator mock pool (mirrors P20-B makeMockPool) ───────────────────
let _globalSeq = 0;

function makeCoordPool(preloadedObs = []) {
  const T = {
    market_profiles:              [],
    market_profile_properties:    [],
    market_observations:          [...preloadedObs],
    market_observation_sources:   [],
    market_observation_properties:[],
    market_observation_comparables:[],
  };
  const nextUuid = () => `00000000-0000-0000-0000-${String(++_globalSeq).padStart(12, '0')}`;

  async function query(sql, params = []) {
    const s = sql.trim().replace(/\s+/g, ' ');
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(s)) return { rows: [] };
    if (/INSERT INTO market_profiles/.test(s)) {
      if (!T.market_profiles.find(r => r.profile_id === params[0]))
        T.market_profiles.push({ profile_id: params[0] });
      return { rows: [] };
    }
    if (/INSERT INTO market_profile_properties/.test(s)) {
      const [profileId, propertyId, userId] = params;
      const idx = T.market_profile_properties.findIndex(r => r.property_id === propertyId);
      if (idx >= 0) T.market_profile_properties[idx].profile_id = profileId;
      else T.market_profile_properties.push({ profile_id: profileId, property_id: propertyId, user_id: userId });
      return { rows: [] };
    }
    if (/SELECT observation_id FROM market_observations/.test(s)) {
      const row = T.market_observations.find(r =>
        r.collection_run_id === params[0] && r.search_fingerprint === params[1]
      );
      return { rows: row ? [{ observation_id: row.observation_id }] : [] };
    }
    if (/SELECT \* FROM market_observations/.test(s)) {
      const fp = params[0], cutoff = new Date(params[1]);
      const future = params[2] ? new Date(params[2]) : new Date(8640000000000000);
      const m = T.market_observations
        .filter(r => r.search_fingerprint === fp
                  && new Date(r.collected_at) >= cutoff
                  && new Date(r.collected_at) <= future)
        .sort((a, b) => new Date(b.collected_at) - new Date(a.collected_at))[0];
      return { rows: m ? [m] : [] };
    }
    if (/INSERT INTO market_observations/.test(s)) {
      const obsId = nextUuid();
      T.market_observations.push({
        observation_id:    obsId,
        provider:          params[1],
        observation_type:  params[2],
        data_source:       params[4],
        collected_at:      params[5],
        search_fingerprint:params[6],
        market_profile_id: params[7],
        currency:          params[8],
        quality_status:    params[27],
        collection_run_id: params[31],
      });
      return { rows: [{ observation_id: obsId }] };
    }
    if (/INSERT INTO market_observation_sources/.test(s)) return { rows: [] };
    if (/INSERT INTO market_observation_properties/.test(s)) return { rows: [] };
    if (/INSERT INTO market_observation_comparables/.test(s)) return { rows: [] };
    return { rows: [] };
  }

  return {
    query,
    connect: async () => ({ query, release: () => {} }),
    _store: T,
  };
}

function makeKResult() {
  return {
    airbnb:  { listings: [{ id: 'a1', nightly_price: 100, currency: 'EUR' }],
               median_price: 100, currency: 'EUR', market_status: 'ok' },
    booking: { listings: [{ id: 'b1', nightly_price: 105, currency: 'EUR' }],
               median_price: 105, currency: 'EUR', market_status: 'ok' },
    market_status: 'ok', algorithm_version: 'v1',
  };
}

const BASE_CFG = {
  property_id: 'prop_p21', user_id: null,
  latitude: '48.8566', longitude: '2.3522', currency: 'EUR',
  max_guests: 4, bedrooms: 2, property_type: 'entire_place',
};
const BASE_CALL = {
  cfg: BASE_CFG, location: 'Paris',
  checkIn: '2026-10-13', checkOut: '2026-10-14',
  maxListings: 10,
  propertyLinks: [{ property_id: 'prop_p21', user_id: null }],
  _airbnbScrape:  async () => makeKResult().airbnb,
  _bookingScrape: async () => makeKResult().booking,
};

// ── Section A: Basic reuse ────────────────────────────────────────────────────

(async () => {

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  A — Basic reuse: fresh observation found');
console.log('══════════════════════════════════════════════════════════════\n');

// A-01: fresh observation → found
try {
  const fp  = 'fp_airbnb_test_p21';
  const obs = makeObs(fp);
  const pool = makeReusePool([obs]);
  const r   = await findReusableObservation(pool, fp, { maxAgeMs: 3600000 });
  assert.ok(r !== null, 'expected observation, got null');
  ok('A-01: fresh observation with same fingerprint → found');
} catch (e) { err('A-01: fresh observation with same fingerprint → found', e.message); }

// A-02: returned row has correct observation_id
try {
  const fp  = 'fp_check_id_p21';
  const obs = makeObs(fp, { observation_id: 'obs_expected_p21' });
  const pool = makeReusePool([obs]);
  const r   = await findReusableObservation(pool, fp, { maxAgeMs: 3600000 });
  assert.equal(r?.observation_id, 'obs_expected_p21');
  ok('A-02: returned observation_id is correct');
} catch (e) { err('A-02: returned observation_id is correct', e.message); }

// A-03: no observation for fingerprint → null
try {
  const pool = makeReusePool([makeObs('fp_other')]);
  const r   = await findReusableObservation(pool, 'fp_nobody_p21', { maxAgeMs: 3600000 });
  assert.equal(r, null);
  ok('A-03: no matching fingerprint → null');
} catch (e) { err('A-03: no matching fingerprint → null', e.message); }

// A-04: expired observation → null
try {
  const fp  = 'fp_stale_p21';
  const stale = makeObs(fp, { collected_at: new Date(Date.now() - 2 * 3600000).toISOString() });
  const pool  = makeReusePool([stale]);
  const r    = await findReusableObservation(pool, fp, { maxAgeMs: 3600000 });
  assert.equal(r, null, 'stale obs (2h ago) with 1h TTL should not be returned');
  ok('A-04: expired observation (age > TTL) → null');
} catch (e) { err('A-04: expired observation (age > TTL) → null', e.message); }

// A-05: multiple observations — newest selected
try {
  const fp  = 'fp_multi_p21';
  const old = makeObs(fp, { observation_id: 'obs_old', collected_at: new Date(Date.now() - 1800000).toISOString() });
  const neo = makeObs(fp, { observation_id: 'obs_new', collected_at: new Date(Date.now() - 300000).toISOString() });
  const pool = makeReusePool([old, neo]);
  const r   = await findReusableObservation(pool, fp, { maxAgeMs: 3600000 });
  assert.equal(r?.observation_id, 'obs_new', 'should return newest, not oldest');
  ok('A-05: multiple fresh observations → newest returned');
} catch (e) { err('A-05: multiple fresh observations → newest returned', e.message); }

// A-06: mixed freshness — only fresh returned, newest selected
try {
  const fp    = 'fp_mixed_p21';
  const stale = makeObs(fp, { observation_id: 'obs_stale2', collected_at: new Date(Date.now() - 90000000).toISOString() });
  const fresh = makeObs(fp, { observation_id: 'obs_fresh2', collected_at: new Date(Date.now() - 60000).toISOString() });
  const pool  = makeReusePool([stale, fresh]);
  const r    = await findReusableObservation(pool, fp, { maxAgeMs: 3600000 });
  assert.equal(r?.observation_id, 'obs_fresh2');
  ok('A-06: mixed ages → only fresh returned, newest of fresh selected');
} catch (e) { err('A-06: mixed ages → only fresh returned, newest of fresh selected', e.message); }

// A-07: all stale → null
try {
  const fp = 'fp_allstale_p21';
  const obs = [
    makeObs(fp, { observation_id: 's1', collected_at: new Date(Date.now() - 7200000).toISOString() }),
    makeObs(fp, { observation_id: 's2', collected_at: new Date(Date.now() - 9000000).toISOString() }),
  ];
  const pool = makeReusePool(obs);
  const r   = await findReusableObservation(pool, fp, { maxAgeMs: 3600000 });
  assert.equal(r, null);
  ok('A-07: all observations stale → null');
} catch (e) { err('A-07: all observations stale → null', e.message); }

// A-08: maxAgeMs=0 → essentially all observations are stale
try {
  const fp  = 'fp_agezero_p21';
  const obs = makeObs(fp, { collected_at: new Date(Date.now() - 1000).toISOString() });
  const pool = makeReusePool([obs]);
  const r   = await findReusableObservation(pool, fp, { maxAgeMs: 0 });
  assert.equal(r, null, 'maxAgeMs=0 means cutoff=now, 1s old obs should not be returned');
  ok('A-08: maxAgeMs=0 → all observations treated as stale');
} catch (e) { err('A-08: maxAgeMs=0 → all observations treated as stale', e.message); }

// ── Section B: TTL boundary / future timestamp ────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  B — TTL boundary and future-timestamp fail-closed');
console.log('══════════════════════════════════════════════════════════════\n');

// B-01: just within TTL → found
try {
  const fp  = 'fp_ttlok_p21';
  const obs = makeObs(fp, { collected_at: new Date(Date.now() - 3599000).toISOString() }); // 59.98 min ago
  const pool = makeReusePool([obs]);
  const r   = await findReusableObservation(pool, fp, { maxAgeMs: 3600000 });
  assert.ok(r !== null, '59.98 min old obs within 60 min TTL should be found');
  ok('B-01: age just under TTL → found');
} catch (e) { err('B-01: age just under TTL → found', e.message); }

// B-02: just past TTL → null
try {
  const fp  = 'fp_ttlover_p21';
  const obs = makeObs(fp, { collected_at: new Date(Date.now() - 3601000).toISOString() }); // 60.02 min ago
  const pool = makeReusePool([obs]);
  const r   = await findReusableObservation(pool, fp, { maxAgeMs: 3600000 });
  assert.equal(r, null, '60.02 min old obs past 60 min TTL should not be found');
  ok('B-02: age just past TTL → null');
} catch (e) { err('B-02: age just past TTL → null', e.message); }

// B-03: TTL boundary is inclusive (age == TTL - 1ms → found)
try {
  const maxAgeMs = 3600000;
  const fp  = 'fp_ttlbound_p21';
  // collected_at is exactly at the boundary: cutoff = now - maxAgeMs, collected_at ≈ cutoff
  // Using maxAgeMs - 500ms to avoid race with test execution time
  const obs = makeObs(fp, { collected_at: new Date(Date.now() - (maxAgeMs - 500)).toISOString() });
  const pool = makeReusePool([obs]);
  const r   = await findReusableObservation(pool, fp, { maxAgeMs });
  assert.ok(r !== null, 'obs at TTL boundary (age < maxAgeMs) should be found (>= is inclusive)');
  ok('B-03: TTL boundary is inclusive — age just under TTL is found');
} catch (e) { err('B-03: TTL boundary is inclusive — age just under TTL is found', e.message); }

// B-04: future timestamp far beyond clock skew → fail closed (not found)
try {
  const fp  = 'fp_future_p21';
  const obs = makeObs(fp, { collected_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() }); // +30 min
  const pool = makeReusePool([obs]);
  const r   = await findReusableObservation(pool, fp, { maxAgeMs: 3600000 });
  assert.equal(r, null, 'obs with future collected_at (+30min) should be rejected');
  ok('B-04: future timestamp (far beyond clock skew) → fail closed, not returned');
} catch (e) { err('B-04: future timestamp (far beyond clock skew) → fail closed, not returned', e.message); }

// B-05: future timestamp within 5min clock skew → accepted
try {
  const fp  = 'fp_clkskew_p21';
  const obs = makeObs(fp, { collected_at: new Date(Date.now() + 2 * 60 * 1000).toISOString() }); // +2 min
  const pool = makeReusePool([obs]);
  const r   = await findReusableObservation(pool, fp, { maxAgeMs: 3600000 });
  assert.ok(r !== null, 'obs +2min future (within 5min clock skew) should be accepted');
  ok('B-05: future timestamp within 5min clock skew → accepted');
} catch (e) { err('B-05: future timestamp within 5min clock skew → accepted', e.message); }

// B-06: default maxAgeMs is 24 h (no opts override)
try {
  const fp  = 'fp_default24h_p21';
  const obs = makeObs(fp, { collected_at: new Date(Date.now() - 23 * 3600000).toISOString() }); // 23h ago
  const pool = makeReusePool([obs]);
  const r   = await findReusableObservation(pool, fp);  // no opts → default 24h
  assert.ok(r !== null, '23h old obs should be found with default 24h TTL');
  ok('B-06: default maxAgeMs is 24h — 23h old observation found');
} catch (e) { err('B-06: default maxAgeMs is 24h — 23h old observation found', e.message); }

// ── Section C: Fingerprint isolation ─────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  C — Fingerprint isolation: cross-provider / cross-dimension');
console.log('══════════════════════════════════════════════════════════════\n');

// C-01: different fingerprint → null
try {
  const pool = makeReusePool([makeObs('fp_airbnb_c01')]);
  const r   = await findReusableObservation(pool, 'fp_booking_c01', { maxAgeMs: 3600000 });
  assert.equal(r, null);
  ok('C-01: different fingerprint → null (never cross-fingerprint reuse)');
} catch (e) { err('C-01: different fingerprint → null', e.message); }

// C-02: airbnb fingerprint obs does not satisfy a booking fingerprint request
try {
  const fpA = 'fp_provider_airbnb_c02', fpB = 'fp_provider_booking_c02';
  const pool = makeReusePool([makeObs(fpA, { provider: 'airbnb' })]);
  const r   = await findReusableObservation(pool, fpB, { maxAgeMs: 3600000 });
  assert.equal(r, null, 'airbnb obs should not satisfy booking fingerprint lookup');
  ok('C-02: airbnb fingerprint obs does not satisfy booking fingerprint request');
} catch (e) { err('C-02: airbnb fingerprint obs does not satisfy booking fingerprint request', e.message); }

// C-03: consensus fingerprint is distinct from provider fingerprints
try {
  const fpConsensus = 'fp_consensus_c03', fpAirbnb = 'fp_airbnb_c03';
  const pool = makeReusePool([makeObs(fpAirbnb, { provider: 'airbnb' })]);
  const r   = await findReusableObservation(pool, fpConsensus, { maxAgeMs: 3600000 });
  assert.equal(r, null);
  ok('C-03: consensus fingerprint does not return airbnb provider obs');
} catch (e) { err('C-03: consensus fingerprint does not return airbnb provider obs', e.message); }

// C-04: same fingerprint, different collection_run_id → still reusable
// (collection_run_id identifies a collection attempt; reuse does not require it to match)
try {
  const fp  = 'fp_runid_c04';
  const obs = makeObs(fp, { collection_run_id: 'crun_old_run', observation_id: 'obs_c04' });
  const pool = makeReusePool([obs]);
  const r   = await findReusableObservation(pool, fp, { maxAgeMs: 3600000 });
  assert.ok(r !== null);
  assert.equal(r.observation_id, 'obs_c04');
  ok('C-04: different collection_run_id does not block reuse (run ID not required)');
} catch (e) { err('C-04: different collection_run_id does not block reuse', e.message); }

// C-05: obs without collection_run_id → still reusable
try {
  const fp  = 'fp_norunid_c05';
  const obs = makeObs(fp, { collection_run_id: null, observation_id: 'obs_c05' });
  const pool = makeReusePool([obs]);
  const r   = await findReusableObservation(pool, fp, { maxAgeMs: 3600000 });
  assert.ok(r !== null && r.observation_id === 'obs_c05');
  ok('C-05: obs with null collection_run_id is still reusable');
} catch (e) { err('C-05: obs with null collection_run_id is still reusable', e.message); }

// C-06: only fingerprint + freshness determine reuse — not provider field in the row
// (fingerprint encodes provider already, so a booking fp always returns a booking obs)
try {
  const fp  = 'fp_booking_c06';
  const obs = makeObs(fp, { provider: 'booking', observation_id: 'obs_c06' });
  const pool = makeReusePool([obs]);
  const r   = await findReusableObservation(pool, fp, { maxAgeMs: 3600000 });
  assert.ok(r !== null && r.provider === 'booking');
  ok('C-06: booking obs returned when booking fingerprint requested');
} catch (e) { err('C-06: booking obs returned when booking fingerprint requested', e.message); }

// ── Section D: collection_run_id contract ─────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  D — collection_run_id is NOT required for reuse');
console.log('══════════════════════════════════════════════════════════════\n');

// D-01: run ID A obs → reusable by request with run ID B
try {
  const fp   = 'fp_runswap_d01';
  const obs  = makeObs(fp, { collection_run_id: 'crun_A', observation_id: 'obs_d01' });
  const pool = makeReusePool([obs]);
  const r    = await findReusableObservation(pool, fp, { maxAgeMs: 86400000 });
  assert.ok(r !== null && r.observation_id === 'obs_d01');
  ok('D-01: obs from run A is reusable by request in run B');
} catch (e) { err('D-01: obs from run A is reusable by request in run B', e.message); }

// D-02: reuse query contains no reference to collection_run_id
try {
  const repoSrc = fs.readFileSync(
    path.join(__dirname, '../services/market-observation-repository.js'), 'utf8'
  );
  // findReusableObservation function body must not filter by collection_run_id
  const fnStart  = repoSrc.indexOf('async function findReusableObservation');
  const fnEnd    = repoSrc.indexOf('\n}', fnStart) + 2;
  const fnBody   = repoSrc.slice(fnStart, fnEnd);
  assert.ok(!fnBody.includes('collection_run_id'),
    'findReusableObservation must not filter by collection_run_id');
  ok('D-02: findReusableObservation SQL does not filter by collection_run_id');
} catch (e) { err('D-02: findReusableObservation SQL does not filter by collection_run_id', e.message); }

// D-03: coordinator passes reused obs without re-collecting (zero scrapes)
try {
  const pool = makeCoordPool();
  // First call: collect and store
  let scrapeCount = 0;
  const countScrape = async () => { scrapeCount++; return makeKResult().airbnb; };
  const r1 = await coordinateCollection(pool, {
    ...BASE_CALL, _airbnbScrape: countScrape, _bookingScrape: countScrape,
    collectionRunId: generateCollectionRunId(),
  });
  assert.ok(r1.ok && !r1.reused, 'first call must collect');
  const scrapeAfterFirst = scrapeCount;
  assert.ok(scrapeAfterFirst >= 1, 'first call must trigger at least one scrape');

  // Second call: must reuse — zero additional scrapes
  const r2 = await coordinateCollection(pool, {
    ...BASE_CALL, _airbnbScrape: countScrape, _bookingScrape: countScrape,
    collectionRunId: generateCollectionRunId(),  // intentionally DIFFERENT run ID
  });
  assert.ok(r2.ok, `second call failed: ${r2.reason}`);
  assert.ok(r2.reused === true, 'second call must reuse (not re-collect)');
  assert.equal(scrapeCount, scrapeAfterFirst, `no additional scrapes on reuse: got ${scrapeCount - scrapeAfterFirst} extra`);
  ok('D-03: coordinator reuses stored obs — zero additional provider calls');
} catch (e) { err('D-03: coordinator reuses stored obs — zero additional provider calls', e.message); }

// D-04: reused consensusObsId matches what the coordinator stored
try {
  const pool = makeCoordPool();
  const r1 = await coordinateCollection(pool, {
    ...BASE_CALL, collectionRunId: generateCollectionRunId(),
  });
  assert.ok(r1.ok && !r1.reused && r1.consensusObsId);

  const r2 = await coordinateCollection(pool, {
    ...BASE_CALL, collectionRunId: generateCollectionRunId(),
  });
  assert.ok(r2.reused === true);
  assert.equal(r2.consensusObsId, r1.consensusObsId,
    'reused consensusObsId must match first collected obs');
  ok('D-04: reused consensusObsId matches original stored observation');
} catch (e) { err('D-04: reused consensusObsId matches original stored observation', e.message); }

// ── Section E: Coordinator integration ───────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  E — Coordinator integration: reuse, single-flight, retry');
console.log('══════════════════════════════════════════════════════════════\n');

// E-01: no stored obs → collection performed (reused: false)
try {
  const pool = makeCoordPool();
  const r    = await coordinateCollection(pool, {
    ...BASE_CALL, reuseMaxAgeMs: 0, collectionRunId: generateCollectionRunId(),
  });
  assert.ok(r.ok && r.reused !== true);
  ok('E-01: no stored obs → fresh collection (reused: false or absent)');
} catch (e) { err('E-01: no stored obs → fresh collection', e.message); }

// E-02: stored obs → first subsequent call returns reused result
try {
  const pool = makeCoordPool();
  // Collect first
  const r1 = await coordinateCollection(pool, {
    ...BASE_CALL, collectionRunId: generateCollectionRunId(),
  });
  assert.ok(r1.ok);
  // Now reuse
  const r2 = await coordinateCollection(pool, {
    ...BASE_CALL, collectionRunId: generateCollectionRunId(),
  });
  assert.ok(r2.ok && r2.reused === true);
  ok('E-02: stored obs → subsequent call returns { reused: true }');
} catch (e) { err('E-02: stored obs → subsequent call returns reused', e.message); }

// E-03: 10 sequential calls → exactly 1 set of scrapes, rest reused
try {
  const pool = makeCoordPool();
  let scrapeCount = 0;
  const countScrape = async () => { scrapeCount++; return makeKResult().airbnb; };
  const N = 10;
  const results = [];
  for (let i = 0; i < N; i++) {
    results.push(await coordinateCollection(pool, {
      ...BASE_CALL,
      _airbnbScrape: countScrape, _bookingScrape: countScrape,
      collectionRunId: generateCollectionRunId(),
    }));
  }
  const okAll = results.every(r => r.ok);
  assert.ok(okAll, 'all 10 calls must succeed');
  assert.ok(scrapeCount <= 4, `scrapeCount=${scrapeCount} should be ≤4 (one run only)`);
  const consensusIds = new Set(results.map(r => r.consensusObsId).filter(Boolean));
  assert.ok(consensusIds.size === 1, `expected 1 unique consensusObsId, got ${consensusIds.size}`);
  ok('E-03: 10 sequential calls → 1 collection, 9 reuses, all share consensus obs');
} catch (e) { err('E-03: 10 sequential calls → 1 collection, 9 reuses', e.message); }

// E-04: different fingerprint (different dates) → new collection despite other obs stored
try {
  const pool = makeCoordPool();
  const r1 = await coordinateCollection(pool, {
    ...BASE_CALL, collectionRunId: generateCollectionRunId(),
    checkIn: '2026-10-13', checkOut: '2026-10-14',
  });
  assert.ok(r1.ok && !r1.reused);
  const r2 = await coordinateCollection(pool, {
    ...BASE_CALL, collectionRunId: generateCollectionRunId(),
    checkIn: '2026-11-01', checkOut: '2026-11-02',
  });
  assert.ok(r2.ok && !r2.reused, 'different dates must trigger a fresh collection, not reuse');
  ok('E-04: different stay dates → new collection (not reuse of prior obs)');
} catch (e) { err('E-04: different stay dates → new collection', e.message); }

// E-05: single-flight still works when no stored obs (concurrent with reuseMaxAgeMs:0)
try {
  const pool = makeCoordPool();
  const runId = generateCollectionRunId();
  const results = await Promise.all(
    Array.from({ length: 6 }, () =>
      coordinateCollection(pool, {
        ...BASE_CALL, reuseMaxAgeMs: 0, collectionRunId: runId,
      })
    )
  );
  assert.ok(results.some(r => r.ok), 'at least one concurrent call must succeed');
  ok('E-05: single-flight preserved — concurrent calls with no stored obs do not crash');
} catch (e) { err('E-05: single-flight preserved for concurrent calls', e.message); }

// ── Section F: Smoke validator static checks ──────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  F — Smoke static: B-09 root cause prevention');
console.log('══════════════════════════════════════════════════════════════\n');

// F-01: B-09 root cause — smoke OBS_BASE uses dynamic collected_at, NOT hardcoded ISO string
try {
  const smokeSrc = fs.readFileSync(
    path.join(__dirname, '../outils/smoke-market-observation-repository-p.js'), 'utf8'
  );
  // Must contain new Date().toISOString() (not a hardcoded YYYY-MM-DDT... literal for collected_at)
  assert.ok(
    smokeSrc.includes("collected_at:      new Date().toISOString()") ||
    smokeSrc.includes("collected_at: new Date().toISOString()"),
    'OBS_BASE.collected_at must be dynamic (new Date().toISOString())'
  );
  ok('F-01: smoke OBS_BASE.collected_at is dynamic — not a hardcoded stale timestamp');
} catch (e) { err('F-01: smoke OBS_BASE.collected_at is dynamic', e.message); }

// F-02: smoke B-09 passes `client` (not `pool`) to findReusableObservation
try {
  const smokeSrc = fs.readFileSync(
    path.join(__dirname, '../outils/smoke-market-observation-repository-p.js'), 'utf8'
  );
  // The call must be findReusableObservation(client, ...) — not findReusableObservation(pool, ...)
  assert.ok(
    !smokeSrc.includes('findReusableObservation(pool,'),
    'smoke must NOT call findReusableObservation(pool, ...) — must use client for tx visibility'
  );
  assert.ok(
    smokeSrc.includes('findReusableObservation(client,'),
    'smoke must call findReusableObservation(client, ...) for same-transaction visibility'
  );
  ok('F-02: smoke B-09 passes `client` to findReusableObservation (same-tx visibility correct)');
} catch (e) { err('F-02: smoke B-09 passes client to findReusableObservation', e.message); }

// F-03: findReusableObservation has future-timestamp guard ($3 upper bound)
try {
  const repoSrc = fs.readFileSync(
    path.join(__dirname, '../services/market-observation-repository.js'), 'utf8'
  );
  const fnStart = repoSrc.indexOf('async function findReusableObservation');
  const fnEnd   = repoSrc.indexOf('\n}', fnStart) + 2;
  const fnBody  = repoSrc.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes('collected_at <= $3') || fnBody.includes('collected_at<=$3'),
    'findReusableObservation must have upper bound guard (collected_at <= $3)');
  assert.ok(fnBody.includes('CLOCK_SKEW') || fnBody.includes('future'),
    'future upper bound must reference clock skew or future variable');
  ok('F-03: findReusableObservation has future-timestamp fail-closed guard (collected_at <= $3)');
} catch (e) { err('F-03: findReusableObservation has future-timestamp guard', e.message); }

// F-04: smoke has NO hardcoded date literal for collected_at
try {
  const smokeSrc = fs.readFileSync(
    path.join(__dirname, '../outils/smoke-market-observation-repository-p.js'), 'utf8'
  );
  const hardcoded = /collected_at:\s*['"]20\d{2}-\d{2}-\d{2}T/.test(smokeSrc);
  assert.ok(!hardcoded, 'smoke must not hardcode a date literal for collected_at');
  ok('F-04: smoke contains no hardcoded YYYY-MM-DD ISO literal for collected_at');
} catch (e) { err('F-04: smoke contains no hardcoded date literal for collected_at', e.message); }

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log(`  P21: ${pass} passed, ${fail} failed`);
console.log('══════════════════════════════════════════════════════════════\n');

if (fail > 0) process.exit(1);

})().catch(e => { console.error('Fatal:', e.message, e.stack); process.exit(1); });
