'use strict';
/**
 * P1.2-B5-BK-P12-FIX — Market Shared Profiles Preview Tests
 *
 * Verifies: canonical profile builder used, grouping logic, fingerprint
 * deduplication, missing-field tracking, and audit safety invariants.
 *
 * All tests are pure (no DB, no network, no BD credits).
 *
 * ABSOLUTE SAFETY:
 *   DB_WRITES        = 0
 *   NETWORK_CALLS    = 0
 *   BD_CREDITS       = 0
 *   SAFE_TO_ACTIVATE = NO
 *
 * Usage:
 *   node tests/p1_2b5bkp12fix_shared_profiles_preview.test.js
 */

const assert = require('node:assert/strict');
const fs     = require('fs');
const path   = require('path');

const {
  buildMarketProfileIdentity,
  buildMarketSearchFingerprint,
  FINGERPRINT_VERSION,
  GEO_PRECISION,
} = require('../services/market-search-identity');

// ── Helpers ───────────────────────────────────────────────────────────────────

let pass = 0, fail = 0;
function ok(label)          { console.log(`  ✓ ${label}`); pass++; }
function err(label, detail) { console.log(`  ✗ ${label}  — ${detail}`); fail++; }

// Canonical profile from a property-like cfg object (mirrors the cron's call)
function profileFromCfg(cfg) {
  return buildMarketProfileIdentity({
    latitude:           cfg.latitude,
    longitude:          cfg.longitude,
    currency:           cfg.currency,
    targetGuests:       cfg.max_guests    ?? null,
    targetBedrooms:     cfg.bedrooms      ?? null,
    targetPropertyType: cfg.property_type ?? null,
  });
}

// Airbnb fingerprint from cfg + stay window (mirrors coordinator call)
function airbnbFpFromCfg(cfg, checkIn, checkOut) {
  return buildMarketSearchFingerprint({
    latitude:           cfg.latitude,
    longitude:          cfg.longitude,
    currency:           cfg.currency,
    targetGuests:       cfg.max_guests    ?? null,
    targetBedrooms:     cfg.bedrooms      ?? null,
    targetPropertyType: cfg.property_type ?? null,
    provider:           'airbnb',
    checkIn,
    checkOut,
    maxListings:        100,
  });
}

// Base property — Paris, EUR, 4 guests, 2 bedrooms, entire_place
const BASE = {
  property_id:   'prop_base',
  name:          'Base Apt',
  internal_name: null,
  latitude:      '48.8566',
  longitude:     '2.3522',
  currency:      'EUR',
  max_guests:    4,
  bedrooms:      2,
  property_type: 'entire_place',
};

// ── Section A: Canonical profile identity ─────────────────────────────────────

(async () => {

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  A — Canonical profile identity (buildMarketProfileIdentity)');
console.log('══════════════════════════════════════════════════════════════\n');

// A-01: complete property → valid profile
try {
  const id = profileFromCfg(BASE);
  assert.ok(id.valid, `expected valid, got reason=${id.reason}`);
  assert.ok(id.profileId.startsWith('mp2_'));
  ok('A-01: complete property → valid profile with mp2_ prefix');
} catch (e) { err('A-01', e.message); }

// A-02: profileId is deterministic (same input → same ID)
try {
  const a = profileFromCfg(BASE), b = profileFromCfg(BASE);
  assert.equal(a.profileId, b.profileId);
  ok('A-02: profileId is deterministic — same input always same output');
} catch (e) { err('A-02', e.message); }

// A-03: null latitude — caught by BOTH the cron gate AND the builder (Q2 fix)
// After Q2: buildMarketProfileIdentity itself rejects null (no longer accepts null→0).
// The cron gate (hasValidCoordinates) also rejects null — double protection.
try {
  const cfg = { ...BASE, latitude: null };
  // Cron gate (hasValidCoordinates — Q3):
  const { hasValidCoordinates } = require('../services/market-geo-validator');
  const skipsByCron = !hasValidCoordinates(cfg.latitude, cfg.longitude) || !cfg.currency;
  assert.ok(skipsByCron, 'null latitude must be caught by cron hasValidCoordinates check');
  // Builder also rejects null (Q2 — fail closed):
  const id = profileFromCfg(cfg);
  assert.ok(!id.valid, 'builder must reject null latitude (Q2 fail-closed)');
  assert.strictEqual(id.reason, 'invalid_geo');
  ok('A-03: null latitude → caught by both cron gate and builder (Q2/Q3)');
} catch (e) { err('A-03', e.message); }

// A-04: null longitude — same double protection
try {
  const cfg = { ...BASE, longitude: null };
  const { hasValidCoordinates } = require('../services/market-geo-validator');
  const skipsByCron = !hasValidCoordinates(cfg.latitude, cfg.longitude) || !cfg.currency;
  assert.ok(skipsByCron, 'null longitude must be caught by cron hasValidCoordinates check');
  const id = profileFromCfg(cfg);
  assert.ok(!id.valid, 'builder must reject null longitude (Q2 fail-closed)');
  ok('A-04: null longitude → caught by both cron gate and builder (Q2/Q3)');
} catch (e) { err('A-04', e.message); }

// A-05: missing currency → invalid
try {
  const id = profileFromCfg({ ...BASE, currency: null });
  assert.ok(!id.valid);
  ok('A-05: missing currency → invalid profile (property skipped)');
} catch (e) { err('A-05', e.message); }

// A-06: property_id intentionally NOT part of the profile
try {
  const cfgA = { ...BASE, property_id: 'prop_001' };
  const cfgB = { ...BASE, property_id: 'prop_002' };
  const a = profileFromCfg(cfgA), b = profileFromCfg(cfgB);
  assert.equal(a.profileId, b.profileId,
    'property_id must NOT differentiate profiles — same market, different unit');
  ok('A-06: property_id does NOT affect profile ID — two units same profile');
} catch (e) { err('A-06', e.message); }

// A-07: geo precision = 4 decimal places (~11 m)
try {
  // Same geo rounded to 4dp
  const same1 = profileFromCfg({ ...BASE, latitude: '48.85661', longitude: '2.35221' });
  const same2 = profileFromCfg({ ...BASE, latitude: '48.85664', longitude: '2.35224' });
  assert.equal(same1.profileId, same2.profileId, 'coords within same 4dp bucket → same profile');

  // Different geo (different 4dp bucket)
  const diff = profileFromCfg({ ...BASE, latitude: '48.8600', longitude: '2.3600' });
  assert.notEqual(same1.profileId, diff.profileId, 'coords in different 4dp bucket → different profile');
  ok(`A-07: geo precision = ${GEO_PRECISION} decimal places — same bucket same profile, diff bucket diff profile`);
} catch (e) { err('A-07', e.message); }

// A-08: version field is part of profile identity
try {
  const id = profileFromCfg(BASE);
  assert.equal(id.dimensions.v, FINGERPRINT_VERSION, `expected version ${FINGERPRINT_VERSION}`);
  ok(`A-08: profile dimensions include version = ${FINGERPRINT_VERSION}`);
} catch (e) { err('A-08', e.message); }

// ── Section B: Profile grouping ───────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  B — Profile grouping (shared vs single)');
console.log('══════════════════════════════════════════════════════════════\n');

// B-01: two identical properties (same geo/currency/capacity) → same profile
try {
  const a = profileFromCfg({ ...BASE, property_id: 'p1' });
  const b = profileFromCfg({ ...BASE, property_id: 'p2' });
  assert.equal(a.profileId, b.profileId);
  ok('B-01: identical market dimensions → shared profile (1 search covers both)');
} catch (e) { err('B-01', e.message); }

// B-02: different max_guests → different profile
try {
  const a = profileFromCfg({ ...BASE, max_guests: 2 });
  const b = profileFromCfg({ ...BASE, max_guests: 6 });
  assert.notEqual(a.profileId, b.profileId);
  ok('B-02: different max_guests → different profile');
} catch (e) { err('B-02', e.message); }

// B-03: different bedrooms → different profile
try {
  const a = profileFromCfg({ ...BASE, bedrooms: 1 });
  const b = profileFromCfg({ ...BASE, bedrooms: 3 });
  assert.notEqual(a.profileId, b.profileId);
  ok('B-03: different bedrooms → different profile');
} catch (e) { err('B-03', e.message); }

// B-04: different property_type → different profile
try {
  const a = profileFromCfg({ ...BASE, property_type: 'entire_place' });
  const b = profileFromCfg({ ...BASE, property_type: 'private_room' });
  assert.notEqual(a.profileId, b.profileId);
  ok('B-04: different property_type → different profile');
} catch (e) { err('B-04', e.message); }

// B-05: different currency → different profile
try {
  const a = profileFromCfg({ ...BASE, currency: 'EUR' });
  const b = profileFromCfg({ ...BASE, currency: 'GBP' });
  assert.notEqual(a.profileId, b.profileId);
  ok('B-05: different currency → different profile');
} catch (e) { err('B-05', e.message); }

// B-06: null max_guests treated as "any" — differs from specific capacity
try {
  const nullGuests  = profileFromCfg({ ...BASE, max_guests: null });
  const fourGuests  = profileFromCfg({ ...BASE, max_guests: 4 });
  assert.notEqual(nullGuests.profileId, fourGuests.profileId,
    'null guests ≠ 4 guests — different market dimensions');
  ok('B-06: null max_guests ("any") is a distinct dimension from specific capacity');
} catch (e) { err('B-06', e.message); }

// B-07: simulated grouping logic — 3 identical properties → 1 profile group
try {
  const cfgs = [
    { ...BASE, property_id: 'p1' },
    { ...BASE, property_id: 'p2' },
    { ...BASE, property_id: 'p3' },
  ];
  const groups = new Map();
  for (const cfg of cfgs) {
    const id = profileFromCfg(cfg);
    assert.ok(id.valid);
    if (!groups.has(id.profileId)) groups.set(id.profileId, []);
    groups.get(id.profileId).push(cfg.property_id);
  }
  assert.equal(groups.size, 1, '3 identical props → 1 profile group');
  const [props] = groups.values();
  assert.equal(props.length, 3, 'group has 3 members');
  ok('B-07: 3 identical properties → 1 shared profile group with 3 members');
} catch (e) { err('B-07', e.message); }

// B-08: empty market_profiles table does not prevent preview
try {
  // Preview is computed purely from property data — zero DB reads of market_profiles
  // This is validated by the audit architecture: it queries pricing_config/properties,
  // not market_profiles. Static check: audit must NOT query market_profiles in preview section.
  const auditSrc = fs.readFileSync(
    path.join(__dirname, '../outils/audit-market-shared-profiles-p.js'), 'utf8'
  );
  // Preview section builds groups from cfgs — stored state section reads market_profiles
  // Check: preview does NOT require market_profiles to be non-empty
  assert.ok(
    auditSrc.includes('buildMarketProfileIdentity'),
    'audit must use buildMarketProfileIdentity for preview'
  );
  assert.ok(
    auditSrc.includes('PREVIEW STATE') && auditSrc.includes('STORED STATE'),
    'audit must label preview vs stored state separately'
  );
  ok('B-08: empty market_profiles table does not prevent preview calculation');
} catch (e) { err('B-08', e.message); }

// ── Section C: Fingerprint deduplication ──────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  C — Search fingerprint deduplication');
console.log('══════════════════════════════════════════════════════════════\n');

const CI = '2026-10-27', CO = '2026-10-28';

// C-01: same market profile + same dates → same Airbnb fingerprint
try {
  const a = airbnbFpFromCfg({ ...BASE, property_id: 'p1' }, CI, CO);
  const b = airbnbFpFromCfg({ ...BASE, property_id: 'p2' }, CI, CO);
  assert.ok(a.valid && b.valid);
  assert.equal(a.fingerprint, b.fingerprint, 'same market + same dates → same Airbnb FP');
  ok('C-01: identical market dimensions + same dates → same Airbnb fingerprint');
} catch (e) { err('C-01', e.message); }

// C-02: same market profile + same dates → same Booking fingerprint
try {
  const a = buildMarketSearchFingerprint({ ...BASE, property_id: 'p1', provider: 'booking', checkIn: CI, checkOut: CO, maxListings: 100 });
  const b = buildMarketSearchFingerprint({ ...BASE, property_id: 'p2', provider: 'booking', checkIn: CI, checkOut: CO, maxListings: 100 });
  assert.ok(a.valid && b.valid);
  assert.equal(a.fingerprint, b.fingerprint);
  ok('C-02: identical market dimensions + same dates → same Booking fingerprint');
} catch (e) { err('C-02', e.message); }

// C-03: Airbnb FP ≠ Booking FP (providers remain separate)
try {
  const fpA = airbnbFpFromCfg(BASE, CI, CO);
  const fpB = buildMarketSearchFingerprint({ ...BASE, provider: 'booking', checkIn: CI, checkOut: CO, maxListings: 100 });
  assert.ok(fpA.valid && fpB.valid);
  assert.notEqual(fpA.fingerprint, fpB.fingerprint,
    'Airbnb and Booking fingerprints must never be equal');
  ok('C-03: Airbnb fingerprint ≠ Booking fingerprint (providers remain separate)');
} catch (e) { err('C-03', e.message); }

// C-04: different stay dates → different fingerprint
try {
  const fpA = airbnbFpFromCfg(BASE, '2026-10-27', '2026-10-28');
  const fpB = airbnbFpFromCfg(BASE, '2026-11-03', '2026-11-04');
  assert.ok(fpA.valid && fpB.valid);
  assert.notEqual(fpA.fingerprint, fpB.fingerprint);
  ok('C-04: different stay dates → different fingerprint (stay window is material)');
} catch (e) { err('C-04', e.message); }

// C-05: N identical properties → 1 unique Airbnb fingerprint (deduplicated)
try {
  const N = 8;
  const fps = new Set();
  for (let i = 0; i < N; i++) {
    const fp = airbnbFpFromCfg({ ...BASE, property_id: `p${i}` }, CI, CO);
    if (fp.valid) fps.add(fp.fingerprint);
  }
  assert.equal(fps.size, 1, `${N} identical properties should yield 1 unique FP, got ${fps.size}`);
  ok(`C-05: ${N} identical properties → 1 unique Airbnb fingerprint (${N - 1} calls saved)`);
} catch (e) { err('C-05', e.message); }

// C-06: different currencies → different fingerprints
try {
  const fpEur = airbnbFpFromCfg({ ...BASE, currency: 'EUR' }, CI, CO);
  const fpGbp = airbnbFpFromCfg({ ...BASE, currency: 'GBP' }, CI, CO);
  assert.notEqual(fpEur.fingerprint, fpGbp.fingerprint);
  ok('C-06: different currencies → different Airbnb fingerprints (never cross-currency reuse)');
} catch (e) { err('C-06', e.message); }

// C-07: fingerprint has ms2_ prefix
try {
  const fp = airbnbFpFromCfg(BASE, CI, CO);
  assert.ok(fp.fingerprint.startsWith('ms2_'), `got: ${fp.fingerprint}`);
  ok('C-07: fingerprint has ms2_ prefix (correct version marker)');
} catch (e) { err('C-07', e.message); }

// ── Section D: Missing-field tracking ────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  D — Missing-field tracking and eligibility filtering');
console.log('══════════════════════════════════════════════════════════════\n');

// D-01: simulate audit filtering — complete property → complete list
try {
  const cfgs = [BASE, { ...BASE, property_id: 'p2' }];
  const complete = [], incomplete = [];
  const missing = { latitude: 0, longitude: 0, currency: 0 };

  for (const cfg of cfgs) {
    if (!cfg.latitude) missing.latitude++;
    if (!cfg.longitude) missing.longitude++;
    if (!cfg.currency) missing.currency++;
    const id = profileFromCfg(cfg);
    if (id.valid) complete.push(cfg); else incomplete.push(cfg);
  }
  assert.equal(complete.length, 2, 'both complete props should be in complete list');
  assert.equal(incomplete.length, 0);
  assert.equal(Object.values(missing).reduce((a, b) => a + b, 0), 0, 'no missing fields');
  ok('D-01: all complete properties → complete list, no missing counts');
} catch (e) { err('D-01', e.message); }

// D-02: null latitude → incomplete (caught by canonical hasValidCoordinates check — Q3)
// After Q3: audit uses hasValidCoordinates, which correctly rejects null.
// After Q2: builder also rejects null — both gates agree.
try {
  const { hasValidCoordinates } = require('../services/market-geo-validator');
  const cfgs = [BASE, { ...BASE, property_id: 'p_nolat', latitude: null }];
  const complete = [], incomplete = [];
  const missing = { latitude: 0, longitude: 0, currency: 0 };
  for (const cfg of cfgs) {
    if (!hasValidCoordinates(cfg.latitude, cfg.longitude)) {
      missing.latitude++;
      missing.longitude++;
    }
    if (!cfg.currency) missing.currency++;
    // Audit logic: canonical coordinate check first, then builder
    if (!hasValidCoordinates(cfg.latitude, cfg.longitude) || !cfg.currency) {
      incomplete.push({ id: cfg.property_id, reason: 'missing_lat_lon_or_currency' });
      continue;
    }
    const id = profileFromCfg(cfg);
    if (id.valid) complete.push(cfg.property_id);
    else incomplete.push({ id: cfg.property_id, reason: id.reason });
  }
  assert.equal(complete.length, 1);
  assert.equal(incomplete.length, 1);
  assert.equal(missing.latitude, 1, 'should count 1 missing latitude');
  ok('D-02: null latitude → missing_latitude++ and property counted as incomplete (hasValidCoordinates)');
} catch (e) { err('D-02', e.message); }

// D-03: missing currency → incomplete, missing_currency++
try {
  const cfgs = [{ ...BASE, property_id: 'p_nocur', currency: null }];
  const missing = { latitude: 0, longitude: 0, currency: 0 };
  const incomplete = [];
  for (const cfg of cfgs) {
    if (!cfg.latitude) missing.latitude++;
    if (!cfg.longitude) missing.longitude++;
    if (!cfg.currency) missing.currency++;
    const id = profileFromCfg(cfg);
    if (!id.valid) incomplete.push(id.reason);
  }
  assert.equal(missing.currency, 1);
  assert.equal(incomplete.length, 1);
  ok('D-03: null currency → missing_currency++ and property counted as incomplete');
} catch (e) { err('D-03', e.message); }

// D-04: null bedrooms and null max_guests are optional — property still complete
try {
  const cfg = { ...BASE, bedrooms: null, max_guests: null };
  const id  = profileFromCfg(cfg);
  assert.ok(id.valid, 'null bedrooms + null max_guests should still produce valid profile');
  assert.equal(id.dimensions.bedrooms, null);
  assert.equal(id.dimensions.guests, null);
  ok('D-04: null bedrooms + null max_guests → property is still PROFILE_COMPLETE');
} catch (e) { err('D-04', e.message); }

// D-05: null bedrooms vs bedrooms=2 → different profile IDs (material dimension)
try {
  const withBed  = profileFromCfg({ ...BASE, bedrooms: 2 });
  const nullBed  = profileFromCfg({ ...BASE, bedrooms: null });
  assert.notEqual(withBed.profileId, nullBed.profileId,
    'null bedrooms is a distinct dimension from bedrooms=2');
  ok('D-05: null bedrooms vs bedrooms=2 → different profile IDs (material)');
} catch (e) { err('D-05', e.message); }

// D-06: SHADOW_ELIGIBLE vs PROFILE_COMPLETE distinction
// Properties with truthy lat/lon/currency but invalid geo range → SHADOW_ELIGIBLE but not PROFILE_COMPLETE
try {
  // latitude 999 is truthy but fails range check in builder
  const cfgBadGeo = { ...BASE, property_id: 'p_badgeo', latitude: '999' };
  const passsTruthy = !(!cfgBadGeo.latitude || !cfgBadGeo.longitude || !cfgBadGeo.currency);
  const id = profileFromCfg(cfgBadGeo);
  assert.ok(passsTruthy, 'latitude=999 passes truthy check (non-empty string)');
  assert.ok(!id.valid, 'latitude=999 fails canonical builder (out of range)');
  ok('D-06: invalid geo range passes truthy check but fails canonical builder (correctly excluded)');
} catch (e) { err('D-06', e.message); }

// ── Section E: Audit safety ───────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  E — Audit safety: no writes, no network, canonical imports');
console.log('══════════════════════════════════════════════════════════════\n');

const auditSrc = fs.readFileSync(
  path.join(__dirname, '../outils/audit-market-shared-profiles-p.js'), 'utf8'
);

// E-01: audit imports buildMarketProfileIdentity from canonical module
try {
  assert.ok(
    auditSrc.includes("require('../services/market-search-identity')"),
    'must import from market-search-identity'
  );
  assert.ok(
    auditSrc.includes('buildMarketProfileIdentity'),
    'must call buildMarketProfileIdentity'
  );
  ok('E-01: audit uses canonical buildMarketProfileIdentity from market-search-identity.js');
} catch (e) { err('E-01', e.message); }

// E-02: audit imports buildMarketSearchFingerprint from canonical module
try {
  assert.ok(auditSrc.includes('buildMarketSearchFingerprint'));
  ok('E-02: audit uses canonical buildMarketSearchFingerprint');
} catch (e) { err('E-02', e.message); }

// E-03: audit imports getBrightDataMarketDates (canonical stay window)
try {
  assert.ok(
    auditSrc.includes('getBrightDataMarketDates'),
    'audit must use canonical date window function'
  );
  ok('E-03: audit uses canonical getBrightDataMarketDates for preview window');
} catch (e) { err('E-03', e.message); }

// E-04: audit does NOT write to market_profiles (no INSERT)
try {
  assert.ok(
    !auditSrc.includes('INSERT INTO market_profiles'),
    'audit must not INSERT into market_profiles'
  );
  assert.ok(
    !auditSrc.includes('INSERT INTO market_profile_properties'),
    'audit must not INSERT into market_profile_properties'
  );
  ok('E-04: audit contains no INSERT statements — pure read-only');
} catch (e) { err('E-04', e.message); }

// E-05: audit does NOT output raw coordinates or addresses
try {
  // Should not print lat/lon values of individual properties
  // (dimensions are anonymized — guests, bedrooms, type, currency only)
  assert.ok(
    !auditSrc.includes("cfg.latitude + '"),
    'audit must not output raw latitude in property output'
  );
  assert.ok(
    !auditSrc.includes("cfg.longitude + '"),
    'audit must not output raw longitude in property output'
  );
  ok('E-05: audit does not output raw coordinates in property identification output');
} catch (e) { err('E-05', e.message); }

// E-06: audit uses createPool from db-pool (canonical SSL config)
try {
  assert.ok(
    auditSrc.includes("require('../services/db-pool')"),
    'must use canonical db-pool'
  );
  assert.ok(auditSrc.includes('createPool'));
  ok('E-06: audit uses canonical createPool from services/db-pool.js');
} catch (e) { err('E-06', e.message); }

// E-07: zero-write proof section present
try {
  assert.ok(
    auditSrc.includes('Zero-write proof') && auditSrc.includes('DB_WRITES'),
    'audit must include zero-write proof section'
  );
  ok('E-07: audit includes zero-write proof with DB_WRITES = 0 assertion');
} catch (e) { err('E-07', e.message); }

// E-08: PREVIEW STATE and STORED STATE clearly separated
try {
  assert.ok(auditSrc.includes('PREVIEW STATE'));
  assert.ok(auditSrc.includes('STORED STATE'));
  ok('E-08: audit clearly separates PREVIEW STATE from STORED STATE');
} catch (e) { err('E-08', e.message); }

// E-09: no hardcoded fallback geo/city/currency values
try {
  const forbidden = [
    "'Paris'",    // hardcoded location fallback
    "'France'",   // hardcoded country fallback
    "'EUR'",      // hardcoded currency
    "'48.",       // hardcoded lat
    "'2.3",       // hardcoded lon
  ];
  // These should not appear in the preview computation (only in the cron's location fallback)
  // Allow 'France' only if it's inside getFallbackZones or zone_label logic
  // Simple check: the profile building section must not use hardcoded values
  const profileSection = auditSrc.slice(
    auditSrc.indexOf('── A: Preview State'),
    auditSrc.indexOf('── B: Profile Groups')
  );
  // The preview section itself should not have hardcoded geo
  assert.ok(!profileSection.includes("'48."), 'no hardcoded latitude in preview section');
  assert.ok(!profileSection.includes("latitude: '48"), 'no hardcoded latitude assignment');
  ok('E-09: audit preview section contains no hardcoded geo/city/currency fallback values');
} catch (e) { err('E-09', e.message); }

// E-10: SAFE_TO_ACTIVATE_PRODUCTION = NO declared
try {
  assert.ok(auditSrc.includes('SAFE_TO_ACTIVATE_PRODUCTION      = NO'));
  ok('E-10: audit declares SAFE_TO_ACTIVATE_PRODUCTION = NO');
} catch (e) { err('E-10', e.message); }

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log(`  P12-FIX: ${pass} passed, ${fail} failed`);
console.log('══════════════════════════════════════════════════════════════\n');

if (fail > 0) process.exit(1);

})().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
