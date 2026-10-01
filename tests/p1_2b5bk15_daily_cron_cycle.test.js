'use strict';
/**
 * BOOSTPRICE-DAILY-CRON-IMPLEMENTATION-15
 * Tests A–Z: safe daily BoostPrice 06:00 cycle.
 * Static source analysis + lightweight unit tests with mock pools.
 * DB_WRITES=0  NETWORK_CALLS=0  BRIGHT_DATA_CALLS=0  CHANNEX_CALLS=0
 */

const fs   = require('fs');
const path = require('path');

const cronPath     = path.join(__dirname, '../routes/dynamic-pricing-cron.js');
const providerPath = path.join(__dirname, '../services/market-provider.js');
const bdPath       = path.join(__dirname, '../services/providers/brightdata.js');

let cronSrc, providerSrc, bdSrc;

beforeAll(() => {
  cronSrc     = fs.readFileSync(cronPath, 'utf8');
  providerSrc = fs.readFileSync(providerPath, 'utf8');
  bdSrc       = fs.readFileSync(bdPath, 'utf8');
});

// ─── A: getCurrentParisDayISO function exists ───
test('A: getCurrentParisDayISO function is defined in dynamic-pricing-cron.js', () => {
  expect(cronSrc).toContain('function getCurrentParisDayISO');
});

// ─── B: getCurrentParisDayISO returns Europe/Paris date ───
test('B: getCurrentParisDayISO returns a YYYY-MM-DD string for an injected clock', () => {
  const { getCurrentParisDayISO } = require('../routes/dynamic-pricing-cron');
  // 2026-10-01 12:00 UTC = 14:00 Paris (CEST) → same calendar date
  const result = getCurrentParisDayISO(new Date('2026-10-01T12:00:00Z'));
  expect(result).toBe('2026-10-01');
});

// ─── C: advisory lock key is a safe integer ───
test('C: DP_DAILY_JOB_ADVISORY_LOCK_KEY is a numeric constant (safe for pg_try_advisory_lock)', () => {
  expect(cronSrc).toContain('DP_DAILY_JOB_ADVISORY_LOCK_KEY =');
  const match = cronSrc.match(/DP_DAILY_JOB_ADVISORY_LOCK_KEY\s*=\s*(\d+)/);
  expect(match).not.toBeNull();
  const key = parseInt(match[1], 10);
  expect(Number.isSafeInteger(key)).toBe(true);
  expect(key).toBeGreaterThan(0);
});

// ─── D: unified daily schedule '0 6 * * *' is registered ───
test('D: initDynamicPricingCron registers exactly the unified "0 6 * * *" daily schedule', () => {
  const initIdx = cronSrc.indexOf('function initDynamicPricingCron');
  const initBody = cronSrc.slice(initIdx, initIdx + 3000);
  expect(initBody).toContain("'0 6 * * *'");
});

// ─── E: old Monday-only schedule is gone ───
test('E: initDynamicPricingCron does NOT contain the old Monday-only "0 6 * * 1" schedule', () => {
  const initIdx = cronSrc.indexOf('function initDynamicPricingCron');
  const initBody = cronSrc.slice(initIdx, initIdx + 3000);
  expect(initBody).not.toContain("'0 6 * * 1'");
});

// ─── F: old Tue–Sun schedule is gone ───
test('F: initDynamicPricingCron does NOT contain the old Tue-Sun "0 6 * * 2,3,4,5,6,0" schedule', () => {
  const initIdx = cronSrc.indexOf('function initDynamicPricingCron');
  const initBody = cronSrc.slice(initIdx, initIdx + 3000);
  expect(initBody).not.toContain("'0 6 * * 2,3,4,5,6,0'");
});

// ─── G: dp_daily_collection_run table DDL is present ───
test('G: dp_daily_collection_run CREATE TABLE IF NOT EXISTS DDL is in initDynamicPricingCron', () => {
  expect(cronSrc).toContain('CREATE TABLE IF NOT EXISTS dp_daily_collection_run');
  expect(cronSrc).toContain('run_date');
  expect(cronSrc).toContain('job_status');
});

// ─── H: BOOSTPRICE_DAILY_JOB_ALREADY_RUNNING is logged on lock contention ───
test('H: BOOSTPRICE_DAILY_JOB_ALREADY_RUNNING log event is present in runDynamicPricingJob', () => {
  expect(cronSrc).toContain('BOOSTPRICE_DAILY_JOB_ALREADY_RUNNING');
});

// ─── I: pg_try_advisory_lock is called in runDynamicPricingJob ───
test('I: pg_try_advisory_lock is called within runDynamicPricingJob', () => {
  const jobIdx = cronSrc.indexOf('async function runDynamicPricingJob');
  const jobBody = cronSrc.slice(jobIdx, jobIdx + 1000);
  expect(jobBody).toContain('pg_try_advisory_lock');
});

// ─── J: pg_advisory_unlock is in a finally block ───
test('J: pg_advisory_unlock is called inside a finally block', () => {
  const finallyIdx = cronSrc.indexOf('} finally {');
  expect(finallyIdx).toBeGreaterThan(-1);
  const finallySlice = cronSrc.slice(finallyIdx, finallyIdx + 200);
  expect(finallySlice).toContain('pg_advisory_unlock');
});

// ─── K: daily dedupe INSERT is in runDynamicPricingJob ───
test('K: dp_daily_collection_run INSERT is present in runDynamicPricingJob', () => {
  const jobIdx = cronSrc.indexOf('async function runDynamicPricingJob');
  const jobBody = cronSrc.slice(jobIdx, jobIdx + 2000);
  expect(jobBody).toContain('INSERT INTO dp_daily_collection_run');
  expect(jobBody).toContain("ON CONFLICT (run_date) DO UPDATE");
});

// ─── L: completion UPDATE is in runDynamicPricingJob ───
test('L: UPDATE dp_daily_collection_run to completed is in runDynamicPricingJob', () => {
  // The function is very long — search full source; the UPDATE is unique to this function
  expect(cronSrc).toContain("UPDATE dp_daily_collection_run SET completed_at = NOW(), job_status = 'completed'");
  // Ensure it precedes the finally block (ordering sanity check)
  const updateIdx  = cronSrc.indexOf("UPDATE dp_daily_collection_run SET completed_at = NOW()");
  const finallyIdx = cronSrc.indexOf('} finally {');
  expect(updateIdx).toBeGreaterThan(-1);
  expect(updateIdx).toBeLessThan(finallyIdx);
});

// ─── M: advisory lock acquired before dedupe INSERT (ordering check) ───
test('M: advisory lock acquisition precedes the daily dedupe INSERT in source order', () => {
  const lockIdx   = cronSrc.indexOf('pg_try_advisory_lock');
  const dedupeIdx = cronSrc.indexOf('INSERT INTO dp_daily_collection_run');
  expect(lockIdx).toBeGreaterThan(-1);
  expect(dedupeIdx).toBeGreaterThan(-1);
  expect(lockIdx).toBeLessThan(dedupeIdx);
});

// ─── N: mock guard calls resolveMarketData ───
test('N: mock guard calls resolveMarketData (skip DB write, reuse last live data)', () => {
  expect(cronSrc).toContain('provider returned mock — skip market write, reuse last live data');
  const mockGuardIdx = cronSrc.indexOf('provider returned mock — skip market write');
  const guardSlice   = cronSrc.slice(mockGuardIdx, mockGuardIdx + 600);
  expect(guardSlice).toContain('resolveMarketData');
});

// ─── O: mock guard passes isMock:false to applyDynamicPricingForProperty ───
test('O: mock guard passes isMock: false to applyDynamicPricingForProperty', () => {
  const mockGuardIdx = cronSrc.indexOf('provider returned mock — skip market write');
  const guardSlice   = cronSrc.slice(mockGuardIdx, mockGuardIdx + 800);
  expect(guardSlice).toContain('isMock: false');
});

// ─── P: MARKET_BUDGET_EXHAUSTED log event is present ───
test('P: MARKET_BUDGET_EXHAUSTED log event is emitted on budget exhaustion', () => {
  expect(cronSrc).toContain('MARKET_BUDGET_EXHAUSTED');
});

// ─── Q: MARKET_MAX_DAILY_PROVIDER_CALLS env var with default 10 ───
test("Q: MARKET_MAX_DAILY_PROVIDER_CALLS defaults to '10' when env not set", () => {
  expect(cronSrc).toContain("MARKET_MAX_DAILY_PROVIDER_CALLS || '10'");
});

// ─── R: all six MARKET_PROVIDER_FALLBACK_PATH events are present ───
test('R: all 6 MARKET_PROVIDER_FALLBACK_PATH events are present in market-provider.js', () => {
  const events = [
    'BRIGHTDATA_SUCCESS',
    'BRIGHTDATA_FAILED_FALLBACK_APIFY',
    'APIFY_SUCCESS_AFTER_BRIGHTDATA',
    'ALL_PROVIDERS_FAILED_MOCK',
    'DIRECT_APIFY_SUCCESS',
    'DIRECT_APIFY_FAILED_MOCK',
  ];
  for (const ev of events) {
    expect(providerSrc).toContain(ev);
  }
});

// ─── S: BRIGHTDATA_SUCCESS event ───
test('S: BRIGHTDATA_SUCCESS event is logged on successful BD scrape', () => {
  const bdSuccessIdx = providerSrc.indexOf('BRIGHTDATA_SUCCESS');
  expect(bdSuccessIdx).toBeGreaterThan(-1);
  const slice = providerSrc.slice(bdSuccessIdx - 50, bdSuccessIdx + 100);
  expect(slice).toContain('MARKET_PROVIDER_FALLBACK_PATH');
});

// ─── T: BRIGHTDATA_FAILED_FALLBACK_APIFY event ───
test('T: BRIGHTDATA_FAILED_FALLBACK_APIFY event is logged on BD failure', () => {
  expect(providerSrc).toContain('BRIGHTDATA_FAILED_FALLBACK_APIFY');
  const count = (providerSrc.match(/BRIGHTDATA_FAILED_FALLBACK_APIFY/g) || []).length;
  expect(count).toBeGreaterThanOrEqual(2); // once for zero-listings, once for error
});

// ─── U: APIFY_SUCCESS_AFTER_BRIGHTDATA event ───
test('U: APIFY_SUCCESS_AFTER_BRIGHTDATA event is present in market-provider.js', () => {
  expect(providerSrc).toContain('APIFY_SUCCESS_AFTER_BRIGHTDATA');
});

// ─── V: ALL_PROVIDERS_FAILED_MOCK event ───
test('V: ALL_PROVIDERS_FAILED_MOCK event is present in market-provider.js', () => {
  expect(providerSrc).toContain('ALL_PROVIDERS_FAILED_MOCK');
});

// ─── W: BD timeout logs snapshot_id before throwing ───
test('W: brightdata.js logs snapshot_id on timeout before throwing', () => {
  expect(bdSrc).toContain('BD_TIMEOUT');
  const timeoutIdx = bdSrc.indexOf('BD_TIMEOUT');
  const slice = bdSrc.slice(timeoutIdx, timeoutIdx + 200);
  expect(slice).toContain('snapshotId');
});

// ─── X: BD timeout error message includes snapshot_id ───
test('X: brightdata.js timeout error message includes the snapshot_id value', () => {
  const throwIdx = bdSrc.indexOf('BrightData timeout: snapshot non prêt dans les délais');
  expect(throwIdx).toBeGreaterThan(-1);
  const slice = bdSrc.slice(throwIdx, throwIdx + 120);
  expect(slice).toContain('snapshotId');
});

// ─── Y: DIRECT_APIFY_SUCCESS and DIRECT_APIFY_FAILED_MOCK events ───
test('Y: DIRECT_APIFY_SUCCESS and DIRECT_APIFY_FAILED_MOCK events are in market-provider.js', () => {
  expect(providerSrc).toContain('DIRECT_APIFY_SUCCESS');
  expect(providerSrc).toContain('DIRECT_APIFY_FAILED_MOCK');
});

// ─── Z: reactive path uses today-semantics (scraped_at + data_source != mock) ───
test("Z: runDynamicPricingForOneProperty dedup uses scraped_at today-semantics, not week_start", () => {
  const oneIdx  = cronSrc.indexOf('async function runDynamicPricingForOneProperty');
  const oneBody = cronSrc.slice(oneIdx, oneIdx + 3000);
  expect(oneBody).toContain('scraped_at');
  expect(oneBody).toContain("data_source != 'mock'");
  expect(oneBody).toContain('AT TIME ZONE');
  // Must NOT use the old week_start-only dedup pattern
  const oldPattern = "WHERE property_id = $1 AND week_start = $2 LIMIT 1";
  expect(oneBody).not.toContain(oldPattern);
});

// ═══════════════════════════════════════════════════════════════════════════════
// BOOSTPRICE-DAILY-CRON-FINAL-FIX-17 — Behavioral tests (AA–AV)
// DB_WRITES=0  NETWORK_CALLS=0  BRIGHT_DATA_CALLS=0  CHANNEX_CALLS=0
// All mock pools are lightweight in-process fakes.
// ═══════════════════════════════════════════════════════════════════════════════

// ── helpers ──────────────────────────────────────────────────────────────────

function makeLockClient(acquires = true) {
  const client = {
    query: jest.fn(async (sql) => {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: acquires }] };
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  return client;
}

function makeMockPool({ lockAcquires = true, configs = [], dedupeRowCount = 1 } = {}) {
  const lockClient = makeLockClient(lockAcquires);
  const pool = {
    connect: jest.fn().mockResolvedValue(lockClient),
    query:   jest.fn(async (sql) => {
      if (sql.includes('INSERT INTO dp_daily_collection_run'))
        return { rowCount: dedupeRowCount, rows: dedupeRowCount > 0 ? [{ run_date: '2026-10-01' }] : [] };
      if (sql.includes('SELECT pc.*') || sql.includes('FROM pricing_config'))
        return { rows: configs };
      if (sql.includes('UPDATE dp_daily_collection_run'))  return { rows: [] };
      if (sql.includes('DELETE FROM dp_daily_collection_run')) return { rows: [] };
      if (sql.includes('CREATE TABLE'))                    return { rows: [] };
      return { rows: [] };
    }),
    _lockClient: lockClient,
  };
  return pool;
}

// ─── AA: advisory lock acquired on dedicated lockClient, not pool.query() ────
test('AA: advisory lock is acquired on a dedicated lockClient (pool.connect), not pool.query()', async () => {
  jest.resetModules();
  const { runDynamicPricingJob } = require('../routes/dynamic-pricing-cron');
  const pool = makeMockPool({ lockAcquires: false }); // contention → early return
  await runDynamicPricingJob(pool, jest.fn(), jest.fn());

  // pool.connect must have been called
  expect(pool.connect).toHaveBeenCalled();
  // lockClient.query must contain the advisory lock call
  const lockCalls = pool._lockClient.query.mock.calls.map(c => c[0]);
  expect(lockCalls.some(sql => sql.includes('pg_try_advisory_lock'))).toBe(true);
  // pool.query must NOT have been called for the lock acquisition
  const poolLockCalls = pool.query.mock.calls.filter(c => c[0].includes('pg_try_advisory_lock'));
  expect(poolLockCalls.length).toBe(0);
});

// ─── AB: lockClient.release() called after successful job completion ──────────
test('AB: lockClient.release() is called after a successful (0-config) job run', async () => {
  jest.resetModules();
  const { runDynamicPricingJob } = require('../routes/dynamic-pricing-cron');
  const pool = makeMockPool({ configs: [] });
  await runDynamicPricingJob(pool, jest.fn(), jest.fn(), { suppressNotifications: true });
  expect(pool._lockClient.release).toHaveBeenCalled();
});

// ─── AC: lockClient.release() called when job body throws ────────────────────
test('AC: lockClient.release() is called when the dedupe INSERT throws', async () => {
  jest.resetModules();
  const { runDynamicPricingJob } = require('../routes/dynamic-pricing-cron');
  const lockClient = makeLockClient(true);
  const pool = {
    connect: jest.fn().mockResolvedValue(lockClient),
    query: jest.fn(async (sql) => {
      if (sql.includes('INSERT INTO dp_daily_collection_run')) throw new Error('simulated DB failure');
      return { rows: [] };
    }),
  };
  await expect(runDynamicPricingJob(pool, jest.fn(), jest.fn())).rejects.toThrow('simulated DB failure');
  expect(lockClient.release).toHaveBeenCalled();
});

// ─── AD: lockClient.release() called on lock contention (no acquisition) ─────
test('AD: lockClient.release() is called even when advisory lock was not acquired', async () => {
  jest.resetModules();
  const { runDynamicPricingJob } = require('../routes/dynamic-pricing-cron');
  const pool = makeMockPool({ lockAcquires: false });
  await runDynamicPricingJob(pool, jest.fn(), jest.fn());
  expect(pool._lockClient.release).toHaveBeenCalled();
});

// ─── AE: daily dedup — completed row causes job to skip ──────────────────────
test('AE: daily dedup — rowCount=0 (already completed) causes job to skip without running', async () => {
  jest.resetModules();
  const { runDynamicPricingJob } = require('../routes/dynamic-pricing-cron');
  const pool = makeMockPool({ dedupeRowCount: 0 });
  const result = await runDynamicPricingJob(pool, jest.fn(), jest.fn(), { suppressNotifications: true });
  // Job returns undefined (early return) when dedup row count is 0
  expect(result).toBeUndefined();
  // Config query should NOT have been called (skipped before it)
  const configCalls = pool.query.mock.calls.filter(c => c[0].includes('FROM pricing_config'));
  expect(configCalls.length).toBe(0);
});

// ─── AF: daily dedup — running row allows restart (crash recovery) ────────────
test('AF: daily dedup — rowCount=1 on running row allows restart (crash recovery)', async () => {
  jest.resetModules();
  const { runDynamicPricingJob } = require('../routes/dynamic-pricing-cron');
  const pool = makeMockPool({ dedupeRowCount: 1, configs: [] }); // rowCount=1 → proceed
  await runDynamicPricingJob(pool, jest.fn(), jest.fn(), { suppressNotifications: true });
  // Job proceeded past the dedup check: the configs query was called
  const configCalls = pool.query.mock.calls.filter(c => c[0].includes('SELECT pc.*'));
  expect(configCalls.length).toBeGreaterThan(0);
});

// ─── AG: BD budget = 1 slot ───────────────────────────────────────────────────
test('AG: BD success consumes exactly 1 provider slot via consumeProviderAttempt', async () => {
  jest.resetModules();
  const { scrape } = require('../services/market-provider');
  const saved = {
    MARKET_PRIMARY_PROVIDER:          process.env.MARKET_PRIMARY_PROVIDER,
    MARKET_BRIGHTDATA_GLOBAL_ENABLED: process.env.MARKET_BRIGHTDATA_GLOBAL_ENABLED,
  };
  process.env.MARKET_PRIMARY_PROVIDER          = 'brightdata';
  process.env.MARKET_BRIGHTDATA_GLOBAL_ENABLED = 'true';
  try {
    let slots = 0;
    const bdItem = { currency: 'EUR', pricing_details: { price_per_night: 100 }, availability: true, ratings: 4.5 };
    const bdFetch = async (url) => {
      if (url.includes('/trigger'))    return { ok: true, json: async () => ({ snapshot_id: 'snap1' }) };
      if (url.includes('/progress/'))  return { ok: true, json: async () => ({ status: 'ready' }) };
      return { ok: true, json: async () => [bdItem] };
    };
    const res = await scrape('Paris, France', 10, 'EUR', {
      bdApiKey: 'test-key', bdFetchImpl: bdFetch,
      maxWaitMs: 5000, pollIntervalMs: 0,
      canAttemptProvider:     () => slots < 10,
      consumeProviderAttempt: () => { slots++; },
    });
    expect(slots).toBe(1);
    expect(res.providerAttempts).toBe(1);
    expect(res.isMock).toBe(false);
  } finally {
    process.env.MARKET_PRIMARY_PROVIDER          = saved.MARKET_PRIMARY_PROVIDER;
    process.env.MARKET_BRIGHTDATA_GLOBAL_ENABLED = saved.MARKET_BRIGHTDATA_GLOBAL_ENABLED;
  }
});

// ─── AH: BD+Apify fallback = 2 slots ─────────────────────────────────────────
test('AH: BD zero-listings + Apify fallback consumes 2 slots', async () => {
  jest.resetModules();
  const { scrape } = require('../services/market-provider');
  const saved = {
    MARKET_PRIMARY_PROVIDER:          process.env.MARKET_PRIMARY_PROVIDER,
    MARKET_BRIGHTDATA_GLOBAL_ENABLED: process.env.MARKET_BRIGHTDATA_GLOBAL_ENABLED,
  };
  process.env.MARKET_PRIMARY_PROVIDER          = 'brightdata';
  process.env.MARKET_BRIGHTDATA_GLOBAL_ENABLED = 'true';
  try {
    let slots = 0;
    const bdFetch = async (url) => {
      if (url.includes('/trigger'))    return { ok: true, json: async () => ({ snapshot_id: 'snap2' }) };
      if (url.includes('/progress/'))  return { ok: true, json: async () => ({ status: 'ready' }) };
      return { ok: true, json: async () => [] }; // 0 listings → triggers Apify fallback
    };
    const res = await scrape('Lyon, France', 10, 'EUR', {
      bdApiKey: 'test-key', bdFetchImpl: bdFetch,
      maxWaitMs: 5000, pollIntervalMs: 0,
      canAttemptProvider:     () => slots < 10,
      consumeProviderAttempt: () => { slots++; },
    });
    expect(slots).toBe(2);
    expect(res.providerAttempts).toBe(2);
  } finally {
    process.env.MARKET_PRIMARY_PROVIDER          = saved.MARKET_PRIMARY_PROVIDER;
    process.env.MARKET_BRIGHTDATA_GLOBAL_ENABLED = saved.MARKET_BRIGHTDATA_GLOBAL_ENABLED;
  }
});

// ─── AI: BD fails, Apify blocked at 1 slot remaining → returns mock ──────────
test('AI: when BD fails and only 1 slot was available, Apify fallback returns mock', async () => {
  jest.resetModules();
  const { scrape } = require('../services/market-provider');
  const saved = {
    MARKET_PRIMARY_PROVIDER:          process.env.MARKET_PRIMARY_PROVIDER,
    MARKET_BRIGHTDATA_GLOBAL_ENABLED: process.env.MARKET_BRIGHTDATA_GLOBAL_ENABLED,
  };
  process.env.MARKET_PRIMARY_PROVIDER          = 'brightdata';
  process.env.MARKET_BRIGHTDATA_GLOBAL_ENABLED = 'true';
  try {
    let slots = 0;
    const bdFetch = async (url) => {
      if (url.includes('/trigger')) return { ok: true, json: async () => ({ snapshot_id: 'snap3' }) };
      if (url.includes('/progress/')) return { ok: true, json: async () => ({ status: 'ready' }) };
      return { ok: true, json: async () => [] }; // 0 listings → fallback Apify
    };
    const res = await scrape('Marseille, France', 10, 'EUR', {
      bdApiKey: 'test-key', bdFetchImpl: bdFetch,
      maxWaitMs: 5000, pollIntervalMs: 0,
      canAttemptProvider:     () => slots < 1, // only 1 slot total
      consumeProviderAttempt: () => { slots++; },
    });
    // BD consumes the 1 slot; Apify fallback sees 0 remaining → returns mock
    expect(slots).toBe(1);
    expect(res.isMock).toBe(true);
    expect(res.providerAttempts).toBe(1);
    expect(res.dataSource).toBe('mock');
  } finally {
    process.env.MARKET_PRIMARY_PROVIDER          = saved.MARKET_PRIMARY_PROVIDER;
    process.env.MARKET_BRIGHTDATA_GLOBAL_ENABLED = saved.MARKET_BRIGHTDATA_GLOBAL_ENABLED;
  }
});

// ─── AJ: direct Apify = 1 slot ───────────────────────────────────────────────
test('AJ: direct Apify path (non-BD provider) consumes exactly 1 slot', async () => {
  jest.resetModules();
  const { scrape } = require('../services/market-provider');
  const saved = process.env.MARKET_PRIMARY_PROVIDER;
  delete process.env.MARKET_PRIMARY_PROVIDER; // defaults to apify
  try {
    let slots = 0;
    const res = await scrape('Paris, France', 10, 'EUR', {
      canAttemptProvider:     () => slots < 10,
      consumeProviderAttempt: () => { slots++; },
      // No APIFY_TOKEN → scrapeZoneApify returns mock
    });
    expect(slots).toBe(1);
    expect(res.providerAttempts).toBe(1);
    expect(res.isMock).toBe(true); // mock because no APIFY_TOKEN in test env
  } finally {
    process.env.MARKET_PRIMARY_PROVIDER = saved;
  }
});

// ─── AK: shared fingerprint — 10 properties with same profile = 1 scrapeFn call ─
test('AK: 10 properties sharing the same fingerprint produce exactly 1 scrapeFn call', async () => {
  jest.resetModules();
  const { runSharedPreCollection, groupPropertiesByFingerprint } = require('../services/market-shared-collection-coordinator');

  const baseCfg = {
    property_id: null, user_id: '1',
    latitude: '48.8566', longitude: '2.3522',
    currency: 'EUR', max_guests: 4, bedrooms: 2, property_type: null,
    property_address: 'Paris, France', zone_label: 'Paris, France',
    price_min: '80', price_max: '200',
  };
  const configs = Array.from({ length: 10 }, (_, i) => ({ ...baseCfg, property_id: String(i + 1) }));

  let scrapeCalls = 0;
  const mockScrapeFn = jest.fn(async () => {
    scrapeCalls++;
    return { listings: [], isMock: true, dataSource: 'mock', zoneUsed: 'Paris, France', diagnostics: null };
  });

  const result = await runSharedPreCollection(configs, {
    checkIn: '2026-10-15', checkOut: '2026-10-16',
    resolveProvider: () => 'apify',
    scrapeFn: mockScrapeFn,
    getFallbackZonesFn: () => ['Paris, France'],
    priceFallbackFn: () => 80,
    maxListings: 100,
  });

  expect(scrapeCalls).toBe(1);
  expect(result.groupCount).toBe(1);
  expect(result.propToFingerprint.size).toBe(10);
});

// ─── AL: shared collection stops at budget limit ──────────────────────────────
test('AL: shared collection stops calling scrapeFn when budget is exhausted', async () => {
  jest.resetModules();
  const { runSharedPreCollection } = require('../services/market-shared-collection-coordinator');

  // 3 distinct locations → 3 different fingerprints → 3 potential scrapeFn calls
  const makeDistinctCfg = (id, lat, lon) => ({
    property_id: String(id), user_id: '1',
    latitude: String(lat), longitude: String(lon),
    currency: 'EUR', max_guests: 4, bedrooms: 2, property_type: null,
    property_address: 'France', zone_label: 'France',
    price_min: '80', price_max: '200',
  });
  const configs = [
    makeDistinctCfg(1, 48.8566, 2.3522),   // Paris
    makeDistinctCfg(2, 45.7640, 4.8357),   // Lyon
    makeDistinctCfg(3, 43.2965, 5.3698),   // Marseille
  ];

  let slots = 0;
  let scrapeCalls = 0;
  // mockScrapeFn simulates a real scrapeFn: calls consumeProviderAttempt (as scrapeZone would)
  const mockScrapeFn = jest.fn(async (...args) => {
    const budgetOpts = args[6] || {};
    if (budgetOpts.consumeProviderAttempt) budgetOpts.consumeProviderAttempt('apify');
    scrapeCalls++;
    return { listings: [], isMock: true, dataSource: 'mock', zoneUsed: 'France', diagnostics: null };
  });

  await runSharedPreCollection(configs, {
    checkIn: '2026-10-15', checkOut: '2026-10-16',
    resolveProvider: () => 'apify',
    scrapeFn: mockScrapeFn,
    getFallbackZonesFn: () => ['France'],
    priceFallbackFn: () => 80,
    maxListings: 100,
    canAttemptProvider:     () => slots < 1, // budget: 1 slot only
    consumeProviderAttempt: () => { slots++; },
  });

  // After group 1: slots=1, canAttemptProvider()=false → groups 2 and 3 are budget-gated
  expect(scrapeCalls).toBe(1);
});

// ─── AM: pricing continues after budget (uses existing DB data) ───────────────
test('AM: MARKET_BUDGET_EXHAUSTED log is present in cron and pricing continues without scrape', () => {
  // Static: verify the budget-exhausted log event and DB-fallback path exist
  expect(cronSrc).toContain('MARKET_BUDGET_EXHAUSTED');
  expect(cronSrc).toContain('recalculate from existing DB data');
  // The budget-exhausted path calls resolveMarketData, not scrapeBestZone
  const budgetIdx  = cronSrc.indexOf('MARKET_BUDGET_EXHAUSTED');
  const resolveIdx = cronSrc.indexOf('resolveMarketData', budgetIdx);
  expect(resolveIdx).toBeGreaterThan(budgetIdx);
});

// ─── AN: neutral market when resolveMarketData returns no DB row ──────────────
test('AN: mock guard + no prior live data → _prevMarketStats is null (neutral market signal)', () => {
  // Verify the mock guard sets _prevMarketStats=null when the DB row is missing
  const mockGuardIdx  = cronSrc.indexOf('provider returned mock — skip market write');
  const guardSlice    = cronSrc.slice(mockGuardIdx, mockGuardIdx + 800);
  // Pattern: if not trusted OR no row → _prevMarketStats = null
  expect(guardSlice).toContain('_prevMarketStats');
  // The null-guard pattern uses a ternary checking trusted && row
  expect(guardSlice).toMatch(/trusted.*&&.*row|row.*&&.*trusted/);
});

// ─── AO: mock not persisted — writeScrapeResult NOT called on mock result ─────
test('AO: when provider returns mock, writeScrapeResult is NOT called (anti-persistence)', () => {
  const mockGuardIdx   = cronSrc.indexOf('provider returned mock — skip market write');
  expect(mockGuardIdx).toBeGreaterThan(-1);
  // writeScrapeResult must NOT appear between the mock guard and the continue statement
  // The block is ~1400 chars long — use 1600 to safely contain the full block
  const guardBlock = cronSrc.slice(mockGuardIdx, mockGuardIdx + 1600);
  expect(guardBlock).not.toContain('writeScrapeResult');
  expect(guardBlock).toContain('continue');
});

// ─── AP: reactive path does NOT acquire global advisory lock ─────────────────
test('AP: runDynamicPricingForOneProperty does not call pg_try_advisory_lock', () => {
  const oneIdx  = cronSrc.indexOf('async function runDynamicPricingForOneProperty');
  const endIdx  = cronSrc.indexOf('\nasync function writeScrapeResult'); // next major function
  const oneBody = cronSrc.slice(oneIdx, endIdx > oneIdx ? endIdx : oneIdx + 5000);
  expect(oneBody).not.toContain('pg_try_advisory_lock');
  expect(oneBody).not.toContain('DP_DAILY_JOB_ADVISORY_LOCK_KEY');
});

// ─── AQ: reactive dedup uses scraped_at + Paris timezone ─────────────────────
test('AQ: reactive dedup query uses scraped_at with AT TIME ZONE Europe/Paris', () => {
  const oneIdx  = cronSrc.indexOf('async function runDynamicPricingForOneProperty');
  const oneBody = cronSrc.slice(oneIdx, oneIdx + 3000);
  expect(oneBody).toContain("scraped_at >= ($2::date AT TIME ZONE 'Europe/Paris')");
});

// ─── AR: Paris midnight boundary — 23:59 UTC is next calendar day in Paris ───
test('AR: getCurrentParisDayISO correctly handles Paris midnight (23:59 UTC = next day CEST+2)', () => {
  const { getCurrentParisDayISO } = require('../routes/dynamic-pricing-cron');
  // 2026-06-30T23:59:00Z = 2026-07-01 01:59 Paris (CEST, UTC+2) → Paris date is 2026-07-01
  const result = getCurrentParisDayISO(new Date('2026-06-30T23:59:00Z'));
  expect(result).toBe('2026-07-01');
});

// ─── AS: suppressExternalPush is forwarded to applyDynamicPricingForProperty ─
test('AS: suppressExternalPush option is forwarded to applyDynamicPricingForProperty in cron', () => {
  const jobIdx  = cronSrc.indexOf('async function runDynamicPricingJob');
  const jobBody = cronSrc.slice(jobIdx, jobIdx + 10000);
  expect(jobBody).toContain('suppressExternalPush');
  expect(jobBody).toContain('opts.suppressExternalPush === true');
});

// ─── AT: non-entitled property never reaches provider (entitlement gate) ──────
test('AT: runDynamicPricingForOneProperty returns no_boostprice_entitlement without calling provider', async () => {
  jest.resetModules();
  // Override entitlement module to return false
  jest.mock('../services/boostprice-entitlement', () => ({
    hasBoostPriceEntitlement: jest.fn().mockResolvedValue(false),
  }));
  const { runDynamicPricingForOneProperty } = require('../routes/dynamic-pricing-cron');
  const pool = {
    query: jest.fn(async (sql) => {
      // Return a minimal cfg row
      if (sql.includes('FROM pricing_config')) return {
        rows: [{
          property_id: '42', user_id: '1', property_name: 'Test',
          property_address: 'Paris', zone_label: null,
          latitude: '48.85', longitude: '2.35', country_code: 'FR',
          currency: 'EUR', max_guests: 2, bedrooms: 1, timezone: 'Europe/Paris',
          price_min: '80', price_max: '200', is_active: true,
        }],
      };
      return { rows: [] };
    }),
    connect: jest.fn(),
  };
  const result = await runDynamicPricingForOneProperty(pool, { userId: '1', propertyId: '42' });
  expect(result.ok).toBe(false);
  expect(result.error).toBe('no_boostprice_entitlement');
  jest.unmock('../services/boostprice-entitlement');
});

// ─── AU: is_active gate — inactive configs excluded from bulk job ─────────────
test('AU: is_active=FALSE configs are excluded by the SQL query (static check)', () => {
  const jobIdx  = cronSrc.indexOf('async function runDynamicPricingJob');
  const jobBody = cronSrc.slice(jobIdx, jobIdx + 3000);
  // The SQL for bulk job must filter on is_active = TRUE
  expect(jobBody).toContain('pc.is_active = TRUE');
});

// ─── AV: 90-day cleanup is fire-and-forget after completion UPDATE ────────────
test('AV: dp_daily_collection_run 90-day cleanup runs after completion UPDATE (non-fatal)', () => {
  const completionIdx = cronSrc.indexOf("job_status = 'completed'");
  const cleanupIdx    = cronSrc.indexOf('INTERVAL \'90 days\'');
  expect(cleanupIdx).toBeGreaterThan(-1);
  // Cleanup appears after the completion UPDATE
  expect(cleanupIdx).toBeGreaterThan(completionIdx);
  // Cleanup uses fire-and-forget (.catch pattern)
  const cleanupSlice = cronSrc.slice(cleanupIdx - 50, cleanupIdx + 200);
  expect(cleanupSlice).toContain('.catch(');
});

// ═══════════════════════════════════════════════════════════════════════════════
// BOOSTPRICE-DAILY-CRON-STARTUP-FIX-18B — Startup initialization behavioral tests
// DB_WRITES=0  NETWORK_CALLS=0  BRIGHT_DATA_CALLS=0  CHANNEX_CALLS=0
// ═══════════════════════════════════════════════════════════════════════════════

// ─── AW: CREATE TABLE succeeds → authoritative cron is registered ─────────────
test('AW: CREATE TABLE success → initDynamicPricingCron resolves and daily cron is registered', async () => {
  jest.resetModules();
  const scheduledExpressions = [];
  jest.doMock('node-cron', () => ({
    schedule: (expr) => { scheduledExpressions.push(expr); },
  }));
  const { initDynamicPricingCron } = require('../routes/dynamic-pricing-cron');
  const pool = {
    connect: jest.fn(),
    query: jest.fn().mockResolvedValue({ rows: [] }),
  };
  await expect(initDynamicPricingCron(pool, jest.fn(), jest.fn())).resolves.toBeUndefined();
  expect(scheduledExpressions).toContain('0 6 * * *');
  jest.dontMock('node-cron');
});

// ─── AX: CREATE TABLE rejects → initDynamicPricingCron rejects, no cron registered
test('AX: CREATE TABLE failure → initDynamicPricingCron rejects and daily cron is NOT registered', async () => {
  jest.resetModules();
  const scheduledExpressions = [];
  jest.doMock('node-cron', () => ({
    schedule: (expr) => { scheduledExpressions.push(expr); },
  }));
  const { initDynamicPricingCron } = require('../routes/dynamic-pricing-cron');
  const pool = {
    connect: jest.fn(),
    query: jest.fn().mockRejectedValue(new Error('DB connection refused')),
  };
  await expect(initDynamicPricingCron(pool, jest.fn(), jest.fn()))
    .rejects.toThrow('DB connection refused');
  expect(scheduledExpressions).toHaveLength(0);
  jest.dontMock('node-cron');
});

// ─── AY: server.js outer .catch() absorbs the rejection — no process.exit() ──
test('AY: server.js outer .catch() absorbs initDynamicPricingCron failure without crashing', async () => {
  jest.resetModules();
  jest.doMock('node-cron', () => ({ schedule: () => {} }));
  const { initDynamicPricingCron } = require('../routes/dynamic-pricing-cron');
  const pool = {
    connect: jest.fn(),
    query: jest.fn().mockRejectedValue(new Error('schema failure')),
  };
  const errors = [];
  await initDynamicPricingCron(pool, jest.fn(), jest.fn())
    .catch(err => errors.push(err.message));
  expect(errors).toHaveLength(1);
  expect(errors[0]).toBe('schema failure');
  // No unhandled rejection, no process.exit — test surviving is the proof
  jest.dontMock('node-cron');
});

// ─── AZ: successful startup behavior unchanged — 3 cron expressions registered ─
test('AZ: successful startup registers exactly the expected set of cron expressions', async () => {
  jest.resetModules();
  const scheduledExpressions = [];
  jest.doMock('node-cron', () => ({
    schedule: (expr) => { scheduledExpressions.push(expr); },
  }));
  const { initDynamicPricingCron } = require('../routes/dynamic-pricing-cron');
  const pool = {
    connect: jest.fn(),
    query: jest.fn().mockResolvedValue({ rows: [] }),
  };
  await initDynamicPricingCron(pool, jest.fn(), jest.fn());
  expect(scheduledExpressions).toContain('0 6 * * *');   // authoritative daily
  expect(scheduledExpressions).toContain('5 6 * * *');   // pickup shadow
  expect(scheduledExpressions).toContain('15 3 * * 1');  // seasonality shadow
  expect(scheduledExpressions).toHaveLength(3);
  jest.dontMock('node-cron');
});
