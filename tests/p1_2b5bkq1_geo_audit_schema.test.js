'use strict';
/**
 * P1.2-B5-BK-Q1 — Geo Audit Schema Correctness Tests
 *
 * Root cause: ACTIVE_PROPERTIES_SQL originally used pc.currency, pc.max_guests,
 * and pc.boostprice_active — none of which exist in pricing_config.
 *
 * These tests prove the fix: all columns reference their canonical tables.
 *
 * Sections:
 *   A  SQL column source: currency from p.currency (NOT pc.currency)
 *   B  SQL column source: max_guests from p.max_guests (NOT pc.max_guests)
 *   C  SQL does not reference non-existent column boostprice_active
 *   D  JOIN is canonical (p.id = pc.property_id AND p.user_id = pc.user_id)
 *   E  Filter is canonical (pc.is_active = TRUE only)
 *   F  Secondary query (geo-missing addresses) uses same canonical schema
 *   G  Remaining Q safety invariants still hold after fix
 *   H  Verified column list matches canonical production cron
 *
 * Safety:
 *   DB_WRITES     = 0
 *   NETWORK_CALLS = 0
 *   BRIGHT_DATA   = 0
 */

const assert = require('assert');

const {
  ACTIVE_PROPERTIES_SQL,
  GEO_MISSING_ADDRESSES_SQL,
} = require('../outils/audit-boostprice-geo-readiness-q.js');

let passed = 0;
let failed = 0;
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

// ═════════════════════════════════════════════════════════════════════════════
// A — currency must come from p.currency (properties table)
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nA — currency column source');

test('A-01: SQL uses p.currency (properties table)', () => {
  assert.ok(
    ACTIVE_PROPERTIES_SQL.includes('p.currency'),
    'Must select p.currency — properties is the currency authority (P1.2-B3/B4)'
  );
});

test('A-02: SQL does NOT use pc.currency (pricing_config has no currency column)', () => {
  assert.ok(
    !ACTIVE_PROPERTIES_SQL.includes('pc.currency'),
    'Must NOT reference pc.currency — that column does not exist in pricing_config'
  );
});

test('A-03: secondary query also does not reference pc.currency', () => {
  assert.ok(
    !GEO_MISSING_ADDRESSES_SQL.includes('pc.currency'),
    'Secondary query must not reference pc.currency'
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// B — max_guests must come from p.max_guests (properties table)
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nB — max_guests column source');

test('B-01: SQL uses p.max_guests (properties table)', () => {
  assert.ok(
    ACTIVE_PROPERTIES_SQL.includes('p.max_guests'),
    'Must select p.max_guests — pricing_config has no max_guests column'
  );
});

test('B-02: SQL does NOT use pc.max_guests', () => {
  assert.ok(
    !ACTIVE_PROPERTIES_SQL.includes('pc.max_guests'),
    'Must NOT reference pc.max_guests — that column does not exist in pricing_config'
  );
});

test('B-03: secondary query does not reference pc.max_guests', () => {
  assert.ok(
    !GEO_MISSING_ADDRESSES_SQL.includes('pc.max_guests'),
    'Secondary query must not reference pc.max_guests'
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// C — boostprice_active must not be referenced (non-existent column)
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nC — non-existent column boostprice_active');

test('C-01: ACTIVE_PROPERTIES_SQL does not reference boostprice_active', () => {
  assert.ok(
    !ACTIVE_PROPERTIES_SQL.includes('boostprice_active'),
    'boostprice_active does not exist in any production schema — must not be referenced'
  );
});

test('C-02: GEO_MISSING_ADDRESSES_SQL does not reference boostprice_active', () => {
  assert.ok(
    !GEO_MISSING_ADDRESSES_SQL.includes('boostprice_active'),
    'boostprice_active does not exist — must not be referenced in secondary query'
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// D — JOIN uses canonical condition (matches production cron)
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nD — canonical JOIN condition');

test('D-01: ACTIVE_PROPERTIES_SQL joins on property_id AND user_id', () => {
  assert.ok(
    ACTIVE_PROPERTIES_SQL.includes('pc.property_id') && ACTIVE_PROPERTIES_SQL.includes('pc.user_id'),
    'Must join on both property_id and user_id — canonical cron join condition'
  );
});

test('D-02: GEO_MISSING_ADDRESSES_SQL uses same canonical join', () => {
  assert.ok(
    GEO_MISSING_ADDRESSES_SQL.includes('pc.property_id') && GEO_MISSING_ADDRESSES_SQL.includes('pc.user_id'),
    'Secondary query must also use canonical join with both property_id and user_id'
  );
});

test('D-03: ACTIVE_PROPERTIES_SQL uses pricing_config as the leading table (matches cron)', () => {
  // Cron: FROM pricing_config pc JOIN properties p
  const fromPc = /FROM\s+pricing_config\s+pc/i.test(ACTIVE_PROPERTIES_SQL);
  assert.ok(fromPc, 'Must use pricing_config as the FROM table (canonical cron pattern)');
});

// ═════════════════════════════════════════════════════════════════════════════
// E — filter is canonical (pc.is_active = TRUE — no invented boostprice_active)
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nE — canonical WHERE filter');

test('E-01: ACTIVE_PROPERTIES_SQL filters by pc.is_active = TRUE', () => {
  assert.ok(
    /pc\.is_active\s*=\s*TRUE/i.test(ACTIVE_PROPERTIES_SQL),
    'Must filter by pc.is_active = TRUE (canonical active-property predicate)'
  );
});

test('E-02: GEO_MISSING_ADDRESSES_SQL filters by pc.is_active = TRUE', () => {
  assert.ok(
    /pc\.is_active\s*=\s*TRUE/i.test(GEO_MISSING_ADDRESSES_SQL),
    'Secondary query must also filter by pc.is_active = TRUE'
  );
});

test('E-03: geo-missing filter uses p.latitude IS NULL OR p.longitude IS NULL', () => {
  assert.ok(
    GEO_MISSING_ADDRESSES_SQL.includes('p.latitude IS NULL') ||
    GEO_MISSING_ADDRESSES_SQL.includes('p.longitude IS NULL'),
    'Secondary query must identify geo-missing rows via p.latitude/p.longitude IS NULL'
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// F — pricing_config owned columns are correct (bedrooms, property_type)
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nF — pricing_config owned columns');

test('F-01: bedrooms comes from pc.bedrooms (pricing_config)', () => {
  assert.ok(
    ACTIVE_PROPERTIES_SQL.includes('pc.bedrooms'),
    'bedrooms must come from pc.bedrooms — pricing_config owns capacity dimensions'
  );
});

test('F-02: property_type comes from pc.property_type (pricing_config)', () => {
  assert.ok(
    ACTIVE_PROPERTIES_SQL.includes('pc.property_type'),
    'property_type must come from pc.property_type — pricing_config owns capacity dimensions'
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// G — properties-table owned columns are correct
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nG — properties table owned columns');

test('G-01: latitude comes from p.latitude', () => {
  assert.ok(ACTIVE_PROPERTIES_SQL.includes('p.latitude'), 'Must select p.latitude');
});

test('G-02: longitude comes from p.longitude', () => {
  assert.ok(ACTIVE_PROPERTIES_SQL.includes('p.longitude'), 'Must select p.longitude');
});

test('G-03: country_code comes from p.country_code', () => {
  assert.ok(ACTIVE_PROPERTIES_SQL.includes('p.country_code'), 'Must select p.country_code');
});

test('G-04: timezone comes from p.timezone', () => {
  assert.ok(ACTIVE_PROPERTIES_SQL.includes('p.timezone'), 'Must select p.timezone');
});

test('G-05: name comes from p.name', () => {
  assert.ok(ACTIVE_PROPERTIES_SQL.includes('p.name'), 'Must select p.name');
});

test('G-06: internal_name comes from p.internal_name', () => {
  assert.ok(ACTIVE_PROPERTIES_SQL.includes('p.internal_name'), 'Must select p.internal_name');
});

test('G-07: address checked from p.address', () => {
  assert.ok(ACTIVE_PROPERTIES_SQL.includes('p.address'), 'Must reference p.address for has_address');
});

test('G-08: id comes from p.id', () => {
  assert.ok(ACTIVE_PROPERTIES_SQL.includes('p.id'), 'Must select p.id');
});

// ═════════════════════════════════════════════════════════════════════════════
// H — Q safety invariants preserved after fix
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nH — Q safety invariants');

const fs   = require('fs');
const path = require('path');
const AUDIT_SOURCE = fs.readFileSync(
  path.join(__dirname, '../outils/audit-boostprice-geo-readiness-q.js'), 'utf8'
);

test('H-01: audit does not call scheduleMarketRefresh()', () => {
  assert.ok(!AUDIT_SOURCE.includes('scheduleMarketRefresh('), 'No scheduleMarketRefresh call');
});

test('H-02: audit does not call geocodePropertyAsync()', () => {
  assert.ok(!AUDIT_SOURCE.includes('geocodePropertyAsync('), 'No geocodePropertyAsync call');
});

test('H-03: CAS UPDATE uses WHERE id=$5 AND address=$6', () => {
  assert.ok(
    AUDIT_SOURCE.includes('WHERE id = $5 AND address = $6'),
    'CAS guard must be present'
  );
});

test('H-04: BRIGHT_DATA_CALLS_FROM_Q = 0 declared', () => {
  assert.ok(AUDIT_SOURCE.includes('BRIGHT_DATA_CALLS_FROM_Q = 0'), 'Must declare 0 BD calls');
});

test('H-05: --execute-geocode requires explicit flag', () => {
  assert.ok(
    AUDIT_SOURCE.includes("process.argv.includes('--execute-geocode')"),
    'Must gate geocode on explicit flag'
  );
});

test('H-06: audit does not touch market_observations', () => {
  assert.ok(!AUDIT_SOURCE.includes('market_observations'), 'Must not reference market_observations');
});

test('H-07: audit does not touch pricing writes', () => {
  assert.ok(!/UPDATE\s+pricing_config/.test(AUDIT_SOURCE), 'Must not UPDATE pricing_config');
});

// ── Final report ──────────────────────────────────────────────────────────────

console.log('\n');
if (failed > 0) {
  const detail = failures.map(f => `  ✗ ${f.label}: ${f.message}`).join('\n');
  console.error(`P1.2-B5-BK-Q1 — ${passed} passed, ${failed} failed:\n${detail}`);
  process.exit(1);
} else {
  console.log(`P1.2-B5-BK-Q1 — ${passed} passed, ${failed} failed`);
}
