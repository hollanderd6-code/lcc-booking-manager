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
