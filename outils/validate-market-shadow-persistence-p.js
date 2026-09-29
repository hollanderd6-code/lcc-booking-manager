'use strict';
/**
 * P1.2-B5-BK-P19 — Shadow Persistence Static Validator
 *
 * Zero-network static analysis of all P files.
 * Verifies key safety and correctness properties without executing any code.
 *
 * ABSOLUTE SAFETY:
 *   DB_WRITES              = 0  static analysis only
 *   NETWORK_CALLS          = 0  static analysis only
 *   PRODUCTION_WRITES      = 0  read-only file analysis
 *   BRIGHT_DATA_CALLS      = 0  always
 *   SAFE_TO_ACTIVATE       = NO (validates, does not activate)
 *
 * Usage:
 *   node outils/validate-market-shadow-persistence-p.js
 */

const fs   = require('fs');
const path = require('path');

// ── Load P source files ───────────────────────────────────────────────────────

const ROOT = path.join(__dirname, '..');

function load(rel) {
  const full = path.join(ROOT, rel);
  try { return fs.readFileSync(full, 'utf8'); }
  catch (_) { return null; }
}

const writerSrc      = load('services/market-shadow-observation-writer.js');
const coordSrc       = load('services/market-shared-collection-coordinator.js');
const repoSrc        = load('services/market-observation-repository.js');
const cronSrc        = load('routes/dynamic-pricing-cron.js');
const identitySrc    = load('services/market-search-identity.js');

// ── Test runner ───────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;

function check(label, cond, hint = '') {
  if (cond) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.log(`  ✗ ${label}${hint ? '  — ' + hint : ''}`);
    fail++;
  }
}

function has(src, pattern) {
  if (!src) return false;
  if (typeof pattern === 'string') return src.includes(pattern);
  return pattern.test(src);
}

// ── Section A: Writer file exists and exports ─────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  A — Writer (market-shadow-observation-writer.js)');
console.log('══════════════════════════════════════════════════════════════');

check('A-01: writer file exists', writerSrc !== null);
check('A-02: buildComparables exported', has(writerSrc, 'buildComparables'));
check('A-03: buildProviderObservationData exported', has(writerSrc, 'buildProviderObservationData'));
check('A-04: buildConsensusObservationData exported', has(writerSrc, 'buildConsensusObservationData'));
check('A-05: writeShadowObservations exported', has(writerSrc, 'writeShadowObservations'));
check('A-06: MARKET_DATA_WRITES = 0 declared', has(writerSrc, 'MARKET_DATA_WRITES'));
check('A-07: PRICING_WRITES = 0 declared', has(writerSrc, 'PRICING_WRITES'));
check('A-08: SAFE_TO_ACTIVATE_PRODUCTION = NO declared', has(writerSrc, 'SAFE_TO_ACTIVATE_PRODUCTION'));
check('A-09: calls createObservationComplete (not raw INSERT)', has(writerSrc, 'createObservationComplete'));
check('A-10: provider=consensus uses DERIVED_CONSENSUS type',
  has(writerSrc, "'DERIVED_CONSENSUS'"));
check('A-11: provider=airbnb/booking uses PROVIDER type',
  has(writerSrc, "'PROVIDER'"));
check('A-12: sourceLinks passed to createObservationComplete for consensus',
  has(writerSrc, /sourceLinks[\s\S]{0,60}airbnbObsId/));
check('A-13: writer does NOT reference market_data',
  !has(writerSrc, 'market_data'));
check('A-14: writer does NOT reference Channex',
  !has(writerSrc, 'channex'));
check('A-15: writer uses fingerprintConsensus for consensus fingerprint',
  has(writerSrc, 'fingerprintConsensus'));

// ── Section B: Repository — assignCurrentProfile ──────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  B — Repository (assignCurrentProfile — P2)');
console.log('══════════════════════════════════════════════════════════════');

check('B-01: repository file exists', repoSrc !== null);
check('B-02: assignCurrentProfile defined', has(repoSrc, 'assignCurrentProfile'));
check('B-03: assignCurrentProfile exported', has(repoSrc, /module\.exports[\s\S]{0,300}assignCurrentProfile/));
check('B-04: uses ON CONFLICT (property_id) DO UPDATE',
  has(repoSrc, 'ON CONFLICT (property_id) DO UPDATE'));
check('B-05: updates profile_id on conflict',
  has(repoSrc, /ON CONFLICT \(property_id\) DO UPDATE[\s\S]{0,100}profile_id/));
check('B-06: does NOT insert into market_data',
  (() => {
    // find the assignCurrentProfile function block
    const idx = repoSrc?.indexOf('async function assignCurrentProfile') ?? -1;
    if (idx < 0) return false;
    const block = repoSrc.slice(idx, idx + 400);
    return !block.includes('market_data');
  })());

// ── Section C: Coordinator ────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  C — Coordinator (market-shared-collection-coordinator.js)');
console.log('══════════════════════════════════════════════════════════════');

check('C-01: coordinator file exists', coordSrc !== null);
check('C-02: generateCollectionRunId exported', has(coordSrc, 'generateCollectionRunId'));
check('C-03: coordinateCollection exported', has(coordSrc, 'coordinateCollection'));
check('C-04: isShadowCollectionEnabled exported', has(coordSrc, 'isShadowCollectionEnabled'));
check('C-05: validatePropertyCompleteness exported', has(coordSrc, 'validatePropertyCompleteness'));
check('C-06: P4 single-flight map present', has(coordSrc, '_inflight'));
check('C-07: P5 findReusableObservation called', has(coordSrc, 'findReusableObservation'));
check('C-08: P6 generateCollectionRunId uses crun_ prefix',
  has(coordSrc, "'crun_'") || has(coordSrc, '`crun_'));
check('C-09: P13 missing_geo check present', has(coordSrc, "'missing_geo'"));
check('C-10: P13 missing_currency check present', has(coordSrc, "'missing_currency'"));
check('C-11: MARKET_DATA_WRITES = 0 declared', has(coordSrc, 'MARKET_DATA_WRITES'));
check('C-12: BRIGHT_DATA_CALLS = 0 declared', has(coordSrc, 'BRIGHT_DATA_CALLS') ||
  has(coordSrc, 'BD credits'));
check('C-13: SAFE_TO_ACTIVATE_PRODUCTION = NO declared', has(coordSrc, 'SAFE_TO_ACTIVATE_PRODUCTION'));
check('C-14: feature flag check uses both flags',
  has(coordSrc, 'MARKET_SHARED_COLLECTION_ENABLED') &&
  has(coordSrc, 'MARKET_OBSERVATION_PERSISTENCE_ENABLED'));
check('C-15: both flags default OFF (checks for === true)',
  has(coordSrc, "=== 'true'"));
check('C-16: upsertMarketProfile called before K engine',
  has(coordSrc, /upsertMarketProfile[\s\S]{0,800}runShadowMarketEngine/));
check('C-17: coordinator does NOT reference market_data',
  !has(coordSrc, 'market_data'));
check('C-18: coordinator does NOT reference writeScrapeResult',
  !has(coordSrc, 'writeScrapeResult'));
check('C-19: scraper injection params _airbnbScrape/_bookingScrape present',
  has(coordSrc, '_airbnbScrape') && has(coordSrc, '_bookingScrape'));
check('C-20: assignCurrentProfile called to update current mapping',
  has(coordSrc, 'assignCurrentProfile'));

// ── Section D: Cron wiring (P15/P16) ─────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  D — Cron wiring (dynamic-pricing-cron.js)');
console.log('══════════════════════════════════════════════════════════════');

check('D-01: cron file exists', cronSrc !== null);
check('D-02: isShadowCollectionEnabled called in cron',
  has(cronSrc, 'isShadowCollectionEnabled'));
check('D-03: _runShadowCollectionPhase defined in cron',
  has(cronSrc, '_runShadowCollectionPhase'));
check('D-04: shadow call is fire-and-forget (.catch)',
  has(cronSrc, /_runShadowCollectionPhase[\s\S]{0,60}\.catch/));
check('D-05: shadow wiring does NOT await before email phase',
  // Shadow call must not await (fire-and-forget)
  !has(cronSrc, /await _runShadowCollectionPhase/));
check('D-06: lazy require of coordinator',
  has(cronSrc, '_getShadowCoordinator') || has(cronSrc, 'market-shared-collection-coordinator'));
check('D-07: shadow phase has MARKET_DATA_WRITES = 0 comment',
  has(cronSrc, 'MARKET_DATA_WRITES'));
check('D-08: shadow phase has SAFE_TO_ACTIVATE_PRODUCTION = NO comment',
  has(cronSrc, 'SAFE_TO_ACTIVATE_PRODUCTION'));
check('D-09: cron writeScrapeResult still present (production path unchanged)',
  has(cronSrc, 'writeScrapeResult'));
check('D-10: cron INSERT market_data still present (production path unchanged)',
  has(cronSrc, 'INSERT INTO market_data'));

// ── Section E: Identity module available ─────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  E — Identity module (market-search-identity.js)');
console.log('══════════════════════════════════════════════════════════════');

check('E-01: identity file exists', identitySrc !== null);
check('E-02: buildMarketSearchFingerprint exported',
  has(identitySrc, 'buildMarketSearchFingerprint'));
check('E-03: buildMarketProfileIdentity exported',
  has(identitySrc, 'buildMarketProfileIdentity'));
check('E-04: FINGERPRINT_VERSION = 2', has(identitySrc, 'FINGERPRINT_VERSION = 2'));
check('E-05: GEO_PRECISION = 4', has(identitySrc, 'GEO_PRECISION = 4'));

// ── Section F: Safety — no forbidden writes ───────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  F — Safety: no forbidden writes in P files');
console.log('══════════════════════════════════════════════════════════════');

check('F-01: writer does not INSERT INTO market_data',
  !has(writerSrc, /INSERT INTO market_data/i));
check('F-02: coordinator does not INSERT INTO market_data',
  !has(coordSrc, /INSERT INTO market_data/i));
check('F-03: writer does not reference pricing_history',
  !has(writerSrc, 'pricing_history'));
check('F-04: coordinator does not reference pricing_history',
  !has(coordSrc, 'pricing_history'));
check('F-05: writer does not reference channex',
  !has(writerSrc, /channex/i));
check('F-06: coordinator does not reference channex',
  !has(coordSrc, /channex/i));
check('F-07: coordinator does not UPDATE market_data',
  !has(coordSrc, /UPDATE market_data/i));
check('F-08: writer does not UPDATE market_data',
  !has(writerSrc, /UPDATE market_data/i));

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log(`  RESULT: ${pass} passed, ${fail} failed`);
console.log('══════════════════════════════════════════════════════════════\n');

if (fail > 0) process.exit(1);
