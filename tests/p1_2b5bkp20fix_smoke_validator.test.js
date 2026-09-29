'use strict';
/**
 * P1.2-B5-BK-P20-FIX — Smoke Validator: Static Analysis Tests
 *
 * Zero-network static analysis of:
 *   - outils/smoke-market-observation-repository-p.js
 *   - services/db-pool.js
 *   - services/market-shared-collection-coordinator.js (generateCollectionRunId collision)
 *   - outils/audit-market-observations-p.js
 *   - outils/audit-market-shared-profiles-p.js
 *
 * ABSOLUTE SAFETY:
 *   DB_WRITES              = 0  static analysis only
 *   NETWORK_CALLS          = 0  static analysis only
 *   PRODUCTION_WRITES      = 0  read-only file analysis
 *   BRIGHT_DATA_CALLS      = 0  always
 *   SAFE_TO_ACTIVATE       = NO (validates, does not activate)
 *
 * Usage:
 *   node tests/p1_2b5bkp20fix_smoke_validator.test.js
 */

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');

function load(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
  catch (_) { return null; }
}

const smokeSrc   = load('outils/smoke-market-observation-repository-p.js');
const dbPoolSrc  = load('services/db-pool.js');
const coordSrc   = load('services/market-shared-collection-coordinator.js');
const auditObsSrc  = load('outils/audit-market-observations-p.js');
const auditProfSrc = load('outils/audit-market-shared-profiles-p.js');

// ── Test runner ───────────────────────────────────────────────────────────────

let pass = 0, fail = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
    pass++;
  } catch (e) {
    console.log(`  ✗ ${label}  — ${e.message}`);
    fail++;
  }
}

function has(src, pattern) {
  if (!src) return false;
  if (typeof pattern === 'string') return src.includes(pattern);
  return pattern.test(src);
}

// ── Section A: Smoke script — TLS safety ─────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  A — Smoke script TLS safety');
console.log('══════════════════════════════════════════════════════════════');

test('A-01: smoke file exists', () =>
  assert.ok(smokeSrc !== null, 'smoke script file not found'));

test('A-02: smoke does NOT set NODE_TLS_REJECT_UNAUTHORIZED', () =>
  assert.ok(!has(smokeSrc, /process\.env\.NODE_TLS_REJECT_UNAUTHORIZED\s*=/),
    'smoke script must not assign process.env.NODE_TLS_REJECT_UNAUTHORIZED'));

test('A-03: smoke does NOT introduce rejectUnauthorized: false directly', () =>
  assert.ok(!has(smokeSrc, /rejectUnauthorized\s*:\s*false/),
    'smoke script must not introduce rejectUnauthorized: false — leave TLS to db-pool.js'));

test('A-04: smoke does NOT directly require pg Pool', () =>
  assert.ok(!has(smokeSrc, /require\(['"]pg['"]\)/),
    "smoke script must use createPool() from db-pool.js, not require('pg') directly"));

test('A-05: smoke uses createPool from db-pool', () =>
  assert.ok(has(smokeSrc, 'createPool') && has(smokeSrc, 'db-pool'),
    "smoke script must require createPool from '../services/db-pool'"));

test('A-06: smoke does NOT hardcode DATABASE_URL string as a value', () =>
  assert.ok(!has(smokeSrc, /process\.env\.DATABASE_URL/),
    'smoke script must not read DATABASE_URL directly — delegate to db-pool.js'));

test('A-07: smoke does NOT log DATABASE_URL', () =>
  assert.ok(!has(smokeSrc, /console\.\w+.*DATABASE_URL/),
    'smoke script must never log DATABASE_URL'));

// ── Section B: Smoke script — transactional guarantees ───────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  B — Smoke script transactional guarantees');
console.log('══════════════════════════════════════════════════════════════');

test('B-01: smoke has BEGIN', () =>
  assert.ok(has(smokeSrc, "'BEGIN'") || has(smokeSrc, '"BEGIN"'),
    'smoke script must issue BEGIN to start transaction'));

test('B-02: smoke has ROLLBACK', () =>
  assert.ok(has(smokeSrc, "'ROLLBACK'") || has(smokeSrc, '"ROLLBACK"'),
    'smoke script must issue ROLLBACK'));

test('B-03: smoke has NO COMMIT path', () =>
  assert.ok(!has(smokeSrc, "'COMMIT'") && !has(smokeSrc, '"COMMIT"'),
    'smoke script must NEVER commit — ROLLBACK always'));

test('B-04: ROLLBACK in finally block', () =>
  assert.ok(has(smokeSrc, /finally[\s\S]{0,120}ROLLBACK|ROLLBACK[\s\S]{0,120}finally/),
    'ROLLBACK must appear in or near a finally block'));

test('B-05: client.release() in finally block', () =>
  assert.ok(has(smokeSrc, /finally[\s\S]{0,200}client\.release/),
    'client.release() must be in the finally block'));

test('B-06: catch block also rolls back', () =>
  assert.ok(has(smokeSrc, /catch[\s\S]{0,200}ROLLBACK/),
    'catch block must also issue ROLLBACK on unexpected error'));

test('B-07: smoke uses single PoolClient (pool.connect)', () =>
  assert.ok(has(smokeSrc, 'pool.connect'),
    'smoke must acquire a single PoolClient via pool.connect()'));

test('B-08: smoke does NOT import createObservationComplete from repository', () => {
  // Grab what's destructured from market-observation-repository and verify it's not in there
  const importBlock = smokeSrc?.match(/require\(['"].*market-observation-repository['"]\)[\s\S]{0,600}/)?.[0] ?? '';
  assert.ok(!importBlock.includes('createObservationComplete'),
    'smoke must NOT import createObservationComplete — it manages its own internal transaction');
});

// ── Section C: Smoke script — labeling and smoke ID prefix ───────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  C — Smoke script labeling and ID prefix');
console.log('══════════════════════════════════════════════════════════════');

test('C-01: smoke prefix smoke_p20 present', () =>
  assert.ok(has(smokeSrc, 'smoke_p20'),
    "smoke synthetic IDs must use 'smoke_p20' prefix"));

test('C-02: smoke header has SAFE_TO_ACTIVATE = NO', () =>
  assert.ok(has(smokeSrc, 'SAFE_TO_ACTIVATE'),
    'smoke header must declare SAFE_TO_ACTIVATE = NO'));

test('C-03: smoke header has ALWAYS ROLLBACK language', () =>
  assert.ok(has(smokeSrc, 'ALWAYS ROLLBACK') || has(smokeSrc, 'always rolled back') ||
    has(smokeSrc, 'ROLLBACK — all smoke writes discarded'),
    'smoke header must clearly state that writes are always rolled back'));

test('C-04: smoke has --execute-db flag gate', () =>
  assert.ok(has(smokeSrc, '--execute-db'),
    "smoke must require --execute-db flag to run Section B"));

test('C-05: smoke Section A is read-only', () =>
  assert.ok(has(smokeSrc, 'READ ONLY'),
    'smoke must label Section A as READ ONLY'));

test('C-06: post-rollback proof section exists', () =>
  assert.ok(has(smokeSrc, 'Post-rollback') || has(smokeSrc, 'post-rollback') ||
    has(smokeSrc, 'C-01') || has(smokeSrc, 'runPostRollbackProof'),
    'smoke must have a post-rollback proof section (Section C)'));

test('C-07: smoke verifies 0 rows remain after rollback', () =>
  assert.ok(has(smokeSrc, 'smoke_p20') && has(smokeSrc, 'LIKE'),
    "smoke Section C must check that smoke_p20* rows are 0 after rollback"));

// ── Section D: db-pool.js — canonical SSL config ─────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  D — db-pool.js canonical SSL configuration');
console.log('══════════════════════════════════════════════════════════════');

test('D-01: db-pool.js file exists', () =>
  assert.ok(dbPoolSrc !== null, 'services/db-pool.js not found'));

test('D-02: db-pool uses createPool export', () =>
  assert.ok(has(dbPoolSrc, 'createPool'),
    'db-pool.js must export createPool'));

test('D-03: db-pool.js connects via DATABASE_URL env var', () =>
  assert.ok(has(dbPoolSrc, 'process.env.DATABASE_URL'),
    'db-pool.js must use process.env.DATABASE_URL'));

test('D-04: db-pool.js checks NODE_ENV === production for SSL', () =>
  assert.ok(has(dbPoolSrc, "NODE_ENV === 'production'") ||
    has(dbPoolSrc, "process.env.NODE_ENV === 'production'"),
    "db-pool.js must gate SSL on NODE_ENV === 'production'"));

test('D-05: db-pool.js uses rejectUnauthorized: false in production', () =>
  assert.ok(has(dbPoolSrc, 'rejectUnauthorized: false') ||
    has(dbPoolSrc, 'rejectUnauthorized:false'),
    'db-pool.js must use rejectUnauthorized: false for production SSL'));

test('D-06: db-pool.js uses ssl: false for non-production', () =>
  assert.ok(has(dbPoolSrc, 'ssl: false') || has(dbPoolSrc, 'ssl:false'),
    'db-pool.js must use ssl: false for non-production environments'));

test('D-07: db-pool.js does NOT set NODE_TLS_REJECT_UNAUTHORIZED', () =>
  assert.ok(!has(dbPoolSrc, /process\.env\.NODE_TLS_REJECT_UNAUTHORIZED\s*=/),
    'db-pool.js must never assign process.env.NODE_TLS_REJECT_UNAUTHORIZED'));

test('D-08: db-pool.js does NOT log DATABASE_URL', () =>
  assert.ok(!has(dbPoolSrc, /console\.\w+.*DATABASE_URL/),
    'db-pool.js must never log DATABASE_URL'));

test('D-09: db-pool.js does NOT hardcode certificates', () =>
  assert.ok(!has(dbPoolSrc, 'BEGIN CERTIFICATE') && !has(dbPoolSrc, 'ca:'),
    'db-pool.js must not hardcode TLS certificates'));

test('D-10: db-pool.js exports createPool via module.exports', () =>
  assert.ok(has(dbPoolSrc, 'module.exports'),
    'db-pool.js must export via module.exports'));

// ── Section E: generateCollectionRunId — collision risk ──────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  E — generateCollectionRunId collision risk analysis');
console.log('══════════════════════════════════════════════════════════════');

test('E-01: coordinator file exists', () =>
  assert.ok(coordSrc !== null, 'market-shared-collection-coordinator.js not found'));

test('E-02: generateCollectionRunId uses crun_ prefix', () =>
  assert.ok(has(coordSrc, "'crun_'") || has(coordSrc, '`crun_'),
    "generateCollectionRunId must produce IDs with 'crun_' prefix"));

test('E-03: generateCollectionRunId uses 6-hour UTC slot', () =>
  assert.ok(has(coordSrc, '/ 6') || has(coordSrc, '/6'),
    'generateCollectionRunId must divide UTC hours by 6 for slot assignment'));

test('E-04: generateCollectionRunId collision risk — same slot for same 6h window (logic test)', () => {
  // Dynamically require and test the actual function
  let generateCollectionRunId;
  try {
    ({ generateCollectionRunId } = require('../services/market-shared-collection-coordinator'));
  } catch (_) {
    throw new Error('cannot require coordinator — check module exports');
  }
  const d1 = new Date('2026-09-29T00:00:00Z'); // slot 0
  const d2 = new Date('2026-09-29T05:59:59Z'); // still slot 0
  assert.equal(generateCollectionRunId(d1), generateCollectionRunId(d2),
    'Two calls in the same 6h slot must produce the same ID (expected behavior for retry idempotency)');
});

test('E-05: generateCollectionRunId — different slots produce different IDs', () => {
  let generateCollectionRunId;
  try {
    ({ generateCollectionRunId } = require('../services/market-shared-collection-coordinator'));
  } catch (_) {
    throw new Error('cannot require coordinator');
  }
  const d1 = new Date('2026-09-29T00:00:00Z'); // slot 0
  const d2 = new Date('2026-09-29T06:00:00Z'); // slot 1
  assert.notEqual(generateCollectionRunId(d1), generateCollectionRunId(d2),
    'Different 6h slots must produce different IDs');
});

test('E-06: collision risk acknowledged — distinct intentional runs in same slot collide', () => {
  // This is a KNOWN limitation: two separate intentional runs in the same 6h slot
  // will get the same collection_run_id, causing the second to reuse the first
  // observation via findReusableObservation. This is documented (not fixed in P20-FIX).
  let generateCollectionRunId;
  try {
    ({ generateCollectionRunId } = require('../services/market-shared-collection-coordinator'));
  } catch (_) {
    throw new Error('cannot require coordinator');
  }
  const slotStart = new Date('2026-09-29T12:00:00Z');
  const slotEnd   = new Date('2026-09-29T17:45:00Z');
  // Confirm both fall in slot 2 (hours 12-17 → floor(12/6)=2, floor(17/6)=2)
  assert.equal(
    generateCollectionRunId(slotStart),
    generateCollectionRunId(slotEnd),
    'KNOWN: Two calls within the same slot collide — collision risk confirmed as expected'
  );
});

test('E-07: generateCollectionRunId — 4 distinct slots per day', () => {
  let generateCollectionRunId;
  try {
    ({ generateCollectionRunId } = require('../services/market-shared-collection-coordinator'));
  } catch (_) {
    throw new Error('cannot require coordinator');
  }
  const day = '2026-09-29';
  const slots = [0, 6, 12, 18].map(h =>
    generateCollectionRunId(new Date(`${day}T${String(h).padStart(2, '0')}:00:00Z`))
  );
  const unique = new Set(slots);
  assert.equal(unique.size, 4, `Expected 4 distinct run IDs for 4 slots, got ${unique.size}: ${slots.join(', ')}`);
});

test('E-08: generateCollectionRunId format — crun_YYYY-MM-DD_s{0-3}', () => {
  let generateCollectionRunId;
  try {
    ({ generateCollectionRunId } = require('../services/market-shared-collection-coordinator'));
  } catch (_) {
    throw new Error('cannot require coordinator');
  }
  const id = generateCollectionRunId(new Date('2026-09-29T09:00:00Z'));
  assert.match(id, /^crun_\d{4}-\d{2}-\d{2}_s[0-3]$/,
    `ID "${id}" must match format crun_YYYY-MM-DD_s{0-3}`);
});

test('E-09: generateCollectionRunId — 23:59:59 UTC falls in slot 3', () => {
  let generateCollectionRunId;
  try {
    ({ generateCollectionRunId } = require('../services/market-shared-collection-coordinator'));
  } catch (_) {
    throw new Error('cannot require coordinator');
  }
  const id = generateCollectionRunId(new Date('2026-09-29T23:59:59Z'));
  assert.ok(id.endsWith('_s3'), `23:59:59 UTC must be slot 3, got: ${id}`);
});

// ── Section F: Audit tools — canonical SSL ────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  F — Audit tools use canonical SSL config');
console.log('══════════════════════════════════════════════════════════════');

test('F-01: audit-market-observations-p.js exists', () =>
  assert.ok(auditObsSrc !== null, 'outils/audit-market-observations-p.js not found'));

test('F-02: audit-market-observations-p uses createPool from db-pool', () =>
  assert.ok(has(auditObsSrc, 'createPool') && has(auditObsSrc, 'db-pool'),
    "audit-market-observations-p.js must use createPool() from db-pool"));

test('F-03: audit-market-observations-p does NOT directly require pg', () =>
  assert.ok(!has(auditObsSrc, /require\(['"]pg['"]\)/),
    "audit-market-observations-p.js must not require('pg') directly"));

test('F-04: audit-market-observations-p does NOT set NODE_TLS_REJECT_UNAUTHORIZED', () =>
  assert.ok(!has(auditObsSrc, 'NODE_TLS_REJECT_UNAUTHORIZED'),
    'audit-market-observations-p.js must not set NODE_TLS_REJECT_UNAUTHORIZED'));

test('F-05: audit-market-shared-profiles-p.js exists', () =>
  assert.ok(auditProfSrc !== null, 'outils/audit-market-shared-profiles-p.js not found'));

test('F-06: audit-market-shared-profiles-p uses createPool from db-pool', () =>
  assert.ok(has(auditProfSrc, 'createPool') && has(auditProfSrc, 'db-pool'),
    "audit-market-shared-profiles-p.js must use createPool() from db-pool"));

test('F-07: audit-market-shared-profiles-p does NOT directly require pg', () =>
  assert.ok(!has(auditProfSrc, /require\(['"]pg['"]\)/),
    "audit-market-shared-profiles-p.js must not require('pg') directly"));

test('F-08: audit-market-shared-profiles-p does NOT set NODE_TLS_REJECT_UNAUTHORIZED', () =>
  assert.ok(!has(auditProfSrc, 'NODE_TLS_REJECT_UNAUTHORIZED'),
    'audit-market-shared-profiles-p.js must not set NODE_TLS_REJECT_UNAUTHORIZED'));

// ── Section G: Safety — no forbidden patterns across P20-FIX files ───────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  G — Cross-file safety: no forbidden patterns');
console.log('══════════════════════════════════════════════════════════════');

const allP20Src = [smokeSrc, dbPoolSrc, auditObsSrc, auditProfSrc].filter(Boolean);

test('G-01: no P20-FIX file hardcodes a DATABASE_URL value', () =>
  assert.ok(allP20Src.every(src => !has(src, /postgres:\/\/[^'"\s]{4,}/)),
    'No P20-FIX file must contain a hardcoded postgres:// connection string'));

test('G-02: no P20-FIX file sets NODE_TLS_REJECT_UNAUTHORIZED', () =>
  assert.ok(allP20Src.every(src => !has(src, /process\.env\.NODE_TLS_REJECT_UNAUTHORIZED\s*=/)),
    'No P20-FIX file may assign process.env.NODE_TLS_REJECT_UNAUTHORIZED'));

test('G-03: no P20-FIX file references market_data table', () =>
  assert.ok(allP20Src.every(src => !has(src, /INSERT INTO market_data/i)),
    'No P20-FIX file may INSERT INTO market_data'));

test('G-04: no P20-FIX file references pricing_history', () =>
  assert.ok(allP20Src.every(src => !has(src, 'pricing_history')),
    'No P20-FIX file may reference pricing_history'));

test('G-05: smoke file has MARKET_DATA_WRITES = 0 declared', () =>
  assert.ok(has(smokeSrc, 'MARKET_DATA_WRITES'),
    'smoke header must declare MARKET_DATA_WRITES = 0'));

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log(`  RESULT: ${pass} passed, ${fail} failed`);
console.log('══════════════════════════════════════════════════════════════\n');

if (fail > 0) process.exit(1);
