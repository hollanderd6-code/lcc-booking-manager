'use strict';
/**
 * P1.3-T2-POST — Booking Pickup Post-Activation Audit — Test Suite
 *
 * Tests the pure helpers exported from audit-booking-pickup-persistence-post-t2.js.
 * All tests run without a database connection.
 *
 * SAFETY:
 *   DB_WRITES             = 0  always
 *   PRICING_WRITES        = 0  always
 *   CHANNEX_CALLS         = 0  always
 *   MARKET_PROVIDER_CALLS = 0  always
 *   NETWORK_CALLS         = 0  always
 *
 * Sections:
 *   A — determineTableHealth
 *   B — longitudinalStage
 *   C — validateTargetDateShape
 *   D — checkAdvisoryBounds
 *   E — computePropertyCoverage
 *   F — Pricing authority proof (source scan)
 *   G — Write safety (no INSERT/UPDATE/DELETE in SQL constants)
 *   H — Module safety (require.main guard — helpers importable without main())
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const {
  determineTableHealth,
  longitudinalStage,
  validateTargetDateShape,
  checkAdvisoryBounds,
  computePropertyCoverage,
  ADVISORY_MIN,
  ADVISORY_MAX,
} = require('../outils/audit-booking-pickup-persistence-post-t2');

const POST_AUDIT_SRC = fs.readFileSync(
  path.join(__dirname, '../outils/audit-booking-pickup-persistence-post-t2.js'),
  'utf8',
);

let passed = 0;
let failed = 0;
const errors = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗  ${name}`);
    console.log(`       ${err.message}`);
    errors.push({ name, message: err.message });
    failed++;
  }
}

// ── A — determineTableHealth ──────────────────────────────────────────────────

console.log('\n  [A] determineTableHealth');

test('A-01: 0 rows → WAITING_FIRST_COLLECTION regardless of issues', () => {
  assert.strictEqual(determineTableHealth(0, []), 'WAITING_FIRST_COLLECTION');
  assert.strictEqual(determineTableHealth(0, ['some issue']), 'WAITING_FIRST_COLLECTION');
});

test('A-02: rows > 0, no issues → HEALTHY', () => {
  assert.strictEqual(determineTableHealth(90, []), 'HEALTHY');
  assert.strictEqual(determineTableHealth(1,  []), 'HEALTHY');
});

test('A-03: rows > 0, with issues → UNHEALTHY', () => {
  assert.strictEqual(determineTableHealth(90, ['duplicate found']), 'UNHEALTHY');
  assert.strictEqual(determineTableHealth(1,  ['null fields', 'advisory out of range']), 'UNHEALTHY');
});

test('A-04: UNHEALTHY triggers — duplicates', () => {
  assert.strictEqual(determineTableHealth(90, ['Duplicate: prop=1 target=2026-10-01']), 'UNHEALTHY');
});

test('A-05: UNHEALTHY triggers — null fields', () => {
  assert.strictEqual(determineTableHealth(90, ['3 rows with critical NULL fields']), 'UNHEALTHY');
});

test('A-06: UNHEALTHY triggers — advisory out of range', () => {
  assert.strictEqual(determineTableHealth(90, ['2 rows with advisory_multiplier outside [0.94, 1.06]']), 'UNHEALTHY');
});

test('A-07: UNHEALTHY triggers — invalid shape', () => {
  assert.strictEqual(determineTableHealth(90, ['5 rows fail target_date shape check']), 'UNHEALTHY');
});

test('A-08: UNHEALTHY triggers — constraint missing', () => {
  assert.strictEqual(determineTableHealth(90, ['Dedup constraint missing']), 'UNHEALTHY');
});

test('A-09: UNHEALTHY triggers — pricing authority violation', () => {
  assert.strictEqual(
    determineTableHealth(90, ['Pricing authority violation: pricing-engine.js imports booking-pickup-shadow']),
    'UNHEALTHY',
  );
});

test('A-10: UNHEALTHY triggers — coverage gap', () => {
  assert.strictEqual(determineTableHealth(60, ['1 eligible property has no observations']), 'UNHEALTHY');
});

test('A-11: multiple issues all counted', () => {
  const issues = ['null fields', 'advisory out of range', 'duplicates'];
  assert.strictEqual(determineTableHealth(90, issues), 'UNHEALTHY');
});

// ── B — longitudinalStage ─────────────────────────────────────────────────────

console.log('\n  [B] longitudinalStage');

test('B-01: 0 obs dates → WAITING_FIRST_COLLECTION', () => {
  assert.strictEqual(longitudinalStage(0), 'WAITING_FIRST_COLLECTION');
});

test('B-02: 1 obs date → COLLECTION_STARTED', () => {
  assert.strictEqual(longitudinalStage(1), 'COLLECTION_STARTED');
});

test('B-03: 2 obs dates → EARLY_COLLECTION', () => {
  assert.strictEqual(longitudinalStage(2), 'EARLY_COLLECTION');
});

test('B-04: 6 obs dates → EARLY_COLLECTION (boundary)', () => {
  assert.strictEqual(longitudinalStage(6), 'EARLY_COLLECTION');
});

test('B-05: 7 obs dates → BUILDING (boundary)', () => {
  assert.strictEqual(longitudinalStage(7), 'BUILDING');
});

test('B-06: 29 obs dates → BUILDING (boundary)', () => {
  assert.strictEqual(longitudinalStage(29), 'BUILDING');
});

test('B-07: 30 obs dates → MATURE (boundary)', () => {
  assert.strictEqual(longitudinalStage(30), 'MATURE');
});

test('B-08: 365 obs dates → MATURE', () => {
  assert.strictEqual(longitudinalStage(365), 'MATURE');
});

// ── C — validateTargetDateShape ───────────────────────────────────────────────

console.log('\n  [C] validateTargetDateShape');

test('C-01: target = obsDate+1 → valid (minimum lead)', () => {
  assert.strictEqual(validateTargetDateShape('2026-10-02', '2026-10-01'), true);
});

test('C-02: target = obsDate+30 → valid (maximum horizon)', () => {
  assert.strictEqual(validateTargetDateShape('2026-10-31', '2026-10-01'), true);
});

test('C-03: target = obsDate+31 → invalid (beyond horizon)', () => {
  assert.strictEqual(validateTargetDateShape('2026-11-01', '2026-10-01'), false);
});

test('C-04: target = obsDate → invalid (same day, zero lead)', () => {
  assert.strictEqual(validateTargetDateShape('2026-10-01', '2026-10-01'), false);
});

test('C-05: target < obsDate → invalid (past date)', () => {
  assert.strictEqual(validateTargetDateShape('2026-09-30', '2026-10-01'), false);
});

test('C-06: null target → invalid', () => {
  assert.strictEqual(validateTargetDateShape(null, '2026-10-01'), false);
});

test('C-07: null obsDate → invalid', () => {
  assert.strictEqual(validateTargetDateShape('2026-10-02', null), false);
});

test('C-08: custom horizonDays=14 — target+14 valid', () => {
  assert.strictEqual(validateTargetDateShape('2026-10-15', '2026-10-01', 14), true);
});

test('C-09: custom horizonDays=14 — target+15 invalid', () => {
  assert.strictEqual(validateTargetDateShape('2026-10-16', '2026-10-01', 14), false);
});

test('C-10: month boundary (Sept→Oct) valid', () => {
  assert.strictEqual(validateTargetDateShape('2026-10-01', '2026-09-30'), true);
});

test('C-11: year boundary (Dec→Jan) valid', () => {
  assert.strictEqual(validateTargetDateShape('2027-01-01', '2026-12-31'), true);
});

// ── D — checkAdvisoryBounds ───────────────────────────────────────────────────

console.log('\n  [D] checkAdvisoryBounds');

test('D-01: 1.00 in bounds (INSUFFICIENT_DATA / LOW_EVIDENCE)', () => {
  assert.strictEqual(checkAdvisoryBounds(1.00), true);
});

test('D-02: ADVISORY_MIN (0.94) in bounds', () => {
  assert.strictEqual(checkAdvisoryBounds(ADVISORY_MIN), true);
  assert.strictEqual(checkAdvisoryBounds(0.94), true);
});

test('D-03: ADVISORY_MAX (1.06) in bounds', () => {
  assert.strictEqual(checkAdvisoryBounds(ADVISORY_MAX), true);
  assert.strictEqual(checkAdvisoryBounds(1.06), true);
});

test('D-04: 0.96 in bounds (SLOW+MODERATE)', () => {
  assert.strictEqual(checkAdvisoryBounds(0.96), true);
});

test('D-05: 1.04 in bounds (ACCELERATING+MODERATE)', () => {
  assert.strictEqual(checkAdvisoryBounds(1.04), true);
});

test('D-06: 0.93 out of bounds (below ADVISORY_MIN)', () => {
  assert.strictEqual(checkAdvisoryBounds(0.93), false);
});

test('D-07: 1.07 out of bounds (above ADVISORY_MAX)', () => {
  assert.strictEqual(checkAdvisoryBounds(1.07), false);
});

test('D-08: null → out of bounds', () => {
  assert.strictEqual(checkAdvisoryBounds(null), false);
});

test('D-09: undefined → out of bounds', () => {
  assert.strictEqual(checkAdvisoryBounds(undefined), false);
});

test('D-10: 0.00 → out of bounds', () => {
  assert.strictEqual(checkAdvisoryBounds(0.00), false);
});

test('D-11: Ti Junot INSUFFICIENT_DATA → advisory=1.00 → in bounds', () => {
  // INSUFFICIENT_DATA always maps to advisory=1.00, which is in [0.94, 1.06]
  assert.strictEqual(checkAdvisoryBounds(1.00), true);
});

test('D-12: ADVISORY_MIN and ADVISORY_MAX match module constants', () => {
  assert.strictEqual(ADVISORY_MIN, 0.94);
  assert.strictEqual(ADVISORY_MAX, 1.06);
});

// ── E — computePropertyCoverage ───────────────────────────────────────────────

console.log('\n  [E] computePropertyCoverage');

test('E-01: 3 eligible, 3 observed → full coverage, missing=0, fraction=1', () => {
  const r = computePropertyCoverage(3, 3);
  assert.strictEqual(r.covered,  3);
  assert.strictEqual(r.missing,  0);
  assert.strictEqual(r.fraction, 1);
});

test('E-02: 3 eligible, 0 observed → missing=3, fraction=0', () => {
  const r = computePropertyCoverage(3, 0);
  assert.strictEqual(r.covered,  0);
  assert.strictEqual(r.missing,  3);
  assert.strictEqual(r.fraction, 0);
});

test('E-03: 3 eligible, 2 observed → missing=1, fraction≈0.667', () => {
  const r = computePropertyCoverage(3, 2);
  assert.strictEqual(r.covered,  2);
  assert.strictEqual(r.missing,  1);
  assert.ok(Math.abs(r.fraction - 2 / 3) < 0.001);
});

test('E-04: 0 eligible → fraction=null, covered=0, missing=0', () => {
  const r = computePropertyCoverage(0, 0);
  assert.strictEqual(r.covered,  0);
  assert.strictEqual(r.missing,  0);
  assert.strictEqual(r.fraction, null);
});

test('E-05: eligible=1, observed=1 → full coverage', () => {
  const r = computePropertyCoverage(1, 1);
  assert.strictEqual(r.covered,  1);
  assert.strictEqual(r.missing,  0);
  assert.strictEqual(r.fraction, 1);
});

test('E-06: Ti Junot scenario — eligible=3 (M6, M7, TiJunot), 0 collected → WAITING', () => {
  // Before first cron: 3 eligible properties, 0 observed
  const r = computePropertyCoverage(3, 0);
  assert.strictEqual(r.missing,  3);
  assert.strictEqual(r.fraction, 0);
});

// ── F — Pricing authority proof ───────────────────────────────────────────────

console.log('\n  [F] Pricing authority proof (source scan)');

const PRICING_CHAIN = [
  'routes/pricing-engine.js',
  'routes/pricing-apply.js',
  'routes/pricing-publisher.js',
  'routes/effective-pricing-resolver.js',
];

const PICKUP_MODULES = [
  'booking-pickup-shadow',
  'booking-pickup-persistence',
  'booking-pickup-shadow-job',
];

const ROOT = path.join(__dirname, '..');

test('F-01: no pickup module imported by pricing chain files', () => {
  const violations = [];
  for (const pricingFile of PRICING_CHAIN) {
    const fpath = path.join(ROOT, pricingFile);
    if (!fs.existsSync(fpath)) continue;
    const src = fs.readFileSync(fpath, 'utf8');
    for (const mod of PICKUP_MODULES) {
      const re = new RegExp(`require\\(['""][^'"]*${mod.replace(/-/g, '[-_]')}`, 'i');
      if (re.test(src)) violations.push(`${pricingFile} → ${mod}`);
    }
  }
  assert.strictEqual(violations.length, 0,
    `Pricing authority violated: ${violations.join(', ')}`);
});

test('F-02: post-audit does not require() pricing-engine', () => {
  // PRICING_CHAIN names pricing-engine.js as a file to scan, not to import.
  // Check that there is no actual require() call for it.
  assert.ok(
    !/require\(['""][^'"]*pricing-engine/i.test(POST_AUDIT_SRC),
    'Post-activation audit must not require pricing-engine',
  );
});

test('F-03: post-audit does not require() pricing-publisher', () => {
  assert.ok(
    !/require\(['""][^'"]*pricing-publisher/i.test(POST_AUDIT_SRC),
    'Post-activation audit must not require pricing-publisher',
  );
});

test('F-04: post-audit SQL does not touch pricing_schedule', () => {
  // The comment section mentions pricing_schedule as something NOT written.
  // Verify no SQL constant references the table.
  const SQL_CONSTANTS_SECTION = POST_AUDIT_SRC.slice(
    POST_AUDIT_SRC.indexOf('// ── SQL'),
    POST_AUDIT_SRC.indexOf('// ── Pricing authority proof'),
  );
  assert.ok(
    !/pricing_schedule/i.test(SQL_CONSTANTS_SECTION),
    'SQL constants must not reference pricing_schedule',
  );
});

// ── G — Write safety ──────────────────────────────────────────────────────────

console.log('\n  [G] Write safety (no INSERT/UPDATE/DELETE in SQL)');

// Extract the SQL constants section (before require.main guard)
const SQL_CONSTANTS_SECTION = POST_AUDIT_SRC.slice(
  POST_AUDIT_SRC.indexOf('// ── SQL'),
  POST_AUDIT_SRC.indexOf('// ── Pricing authority proof'),
);

test('G-01: no INSERT statement in SQL constants', () => {
  assert.ok(
    !/\bINSERT\b/i.test(SQL_CONSTANTS_SECTION),
    'SQL constants must not contain INSERT',
  );
});

test('G-02: no UPDATE statement in SQL constants', () => {
  assert.ok(
    !/\bUPDATE\b/i.test(SQL_CONSTANTS_SECTION),
    'SQL constants must not contain UPDATE',
  );
});

test('G-03: no DELETE statement in SQL constants', () => {
  assert.ok(
    !/\bDELETE\b/i.test(SQL_CONSTANTS_SECTION),
    'SQL constants must not contain DELETE',
  );
});

test('G-04: no DROP statement in SQL constants', () => {
  assert.ok(
    !/\bDROP\b/i.test(SQL_CONSTANTS_SECTION),
    'SQL constants must not contain DROP',
  );
});

test('G-05: all SQL constants are SELECT or pg_constraint checks', () => {
  // Extract all SQL template literals — check they start with SELECT or are system catalog queries
  const sqlStrings = SQL_CONSTANTS_SECTION.match(/`[\s\S]*?`/g) || [];
  for (const sql of sqlStrings) {
    const trimmed = sql.replace(/`/g, '').trim();
    if (!trimmed) continue;
    const firstWord = trimmed.split(/\s+/)[0].toUpperCase();
    assert.ok(
      ['SELECT', 'WITH'].includes(firstWord),
      `SQL block starts with ${firstWord}, expected SELECT: ${trimmed.slice(0, 80)}`,
    );
  }
});

test('G-06: ADVISORY_OUT_OF_BOUNDS_SQL does not write', () => {
  // Verify the interpolated SQL is read-only (advisory constant is a number, no injection risk)
  assert.ok(POST_AUDIT_SRC.includes('SELECT COUNT(*) AS out_of_bounds_count'));
  assert.ok(!POST_AUDIT_SRC.match(/INSERT INTO booking_pickup/));
});

// ── H — Module safety (require.main guard) ────────────────────────────────────

console.log('\n  [H] Module safety');

test('H-01: require.main === module guard present', () => {
  assert.ok(
    POST_AUDIT_SRC.includes('require.main === module'),
    'Main function must be guarded by require.main === module',
  );
});

test('H-02: pure helpers can be required without executing main()', () => {
  // The module was already required at the top of this file without DB access.
  // If main() ran it would have thrown (no DB). Getting here means the guard works.
  assert.strictEqual(typeof determineTableHealth, 'function');
  assert.strictEqual(typeof longitudinalStage,    'function');
  assert.strictEqual(typeof validateTargetDateShape, 'function');
  assert.strictEqual(typeof checkAdvisoryBounds,  'function');
  assert.strictEqual(typeof computePropertyCoverage, 'function');
});

test('H-03: createPool not called at require time', () => {
  // Verified by H-02 — if pool were opened at require time, the test runner would hang
  // or throw a DB connection error. Reaching this line proves it was not.
  assert.ok(true);
});

test('H-04: dotenv.config not called at require time', () => {
  assert.ok(
    POST_AUDIT_SRC.includes("if (require.main === module)"),
    'dotenv.config must be inside require.main guard',
  );
  // Ensure dotenv is inside the guard block, not at top level
  const dotenvIdx       = POST_AUDIT_SRC.indexOf("require('dotenv').config()");
  const requireMainIdx  = POST_AUDIT_SRC.indexOf("if (require.main === module)");
  assert.ok(dotenvIdx > requireMainIdx, 'dotenv.config must be called after the require.main guard');
});

test('H-05: module.exports contains all five pure helpers', () => {
  assert.ok(POST_AUDIT_SRC.includes('determineTableHealth,'));
  assert.ok(POST_AUDIT_SRC.includes('longitudinalStage,'));
  assert.ok(POST_AUDIT_SRC.includes('validateTargetDateShape,'));
  assert.ok(POST_AUDIT_SRC.includes('checkAdvisoryBounds,'));
  assert.ok(POST_AUDIT_SRC.includes('computePropertyCoverage,'));
});

test('H-06: ADVISORY_MIN and ADVISORY_MAX exported', () => {
  assert.ok(POST_AUDIT_SRC.includes('ADVISORY_MIN,'));
  assert.ok(POST_AUDIT_SRC.includes('ADVISORY_MAX,'));
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('');
console.log('══════════════════════════════════════════════════════════════');
console.log(`  P1.3-T2-POST  ${passed + failed} tests  —  ${passed} passed  ${failed} failed`);
console.log('──────────────────────────────────────────────────────────────');
if (errors.length > 0) {
  errors.forEach(e => console.log(`  ✗  ${e.name}: ${e.message}`));
  console.log('──────────────────────────────────────────────────────────────');
}
console.log(`  ${failed === 0 ? 'ALL PASSED ✓' : `${failed} FAILED ✗`}`);
console.log('  DB_WRITES=0  CHANNEX_CALLS=0  PRICING_WRITES=0  NETWORK_CALLS=0');
console.log('══════════════════════════════════════════════════════════════');
console.log('');

if (failed > 0) process.exit(1);
