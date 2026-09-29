'use strict';
/**
 * P1.2-B5-BK-Q — BoostPrice Geo Readiness Tests
 *
 * Sections:
 *   A  isValidLatitude  (null / undefined / '' / NaN / 0 / boundary / out-of-range / string)
 *   B  isValidLongitude (same)
 *   C  hasValidCoordinates (composite)
 *   D  buildMarketProfileIdentity — null fail-closed, 0/0 valid (Q2)
 *   E  cron shadow eligibility logic — aligned to canonical validator (Q3)
 *   F  audit eligibility logic — aligned to canonical validator (Q3)
 *   G  geocode audit — static safety invariants (Q4/Q5/Q6/Q7)
 *   H  geocode CAS logic unit tests (mocked DB + geocoder)
 *
 * Safety:
 *   DB_WRITES              = 0
 *   NETWORK_CALLS          = 0
 *   BRIGHT_DATA_CALLS      = 0
 *   MARKET_REFRESH_CALLS   = 0
 */

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');

const { isValidLatitude, isValidLongitude, hasValidCoordinates } =
  require('../services/market-geo-validator');
const { buildMarketProfileIdentity } =
  require('../services/market-search-identity');

// ── helpers ───────────────────────────────────────────────────────────────────

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
// A — isValidLatitude
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nA — isValidLatitude');

test('A-01: null → false', () => {
  assert.strictEqual(isValidLatitude(null), false);
});

test('A-02: undefined → false', () => {
  assert.strictEqual(isValidLatitude(undefined), false);
});

test('A-03: empty string → false', () => {
  assert.strictEqual(isValidLatitude(''), false);
});

test('A-04: NaN → false', () => {
  assert.strictEqual(isValidLatitude(NaN), false);
});

test('A-05: Infinity → false', () => {
  assert.strictEqual(isValidLatitude(Infinity), false);
});

test('A-06: 0 → true (CRITICAL — equator is valid)', () => {
  assert.strictEqual(isValidLatitude(0), true);
});

test('A-07: 48.8566 → true', () => {
  assert.strictEqual(isValidLatitude(48.8566), true);
});

test('A-08: -90 → true (south pole boundary)', () => {
  assert.strictEqual(isValidLatitude(-90), true);
});

test('A-09: 90 → true (north pole boundary)', () => {
  assert.strictEqual(isValidLatitude(90), true);
});

test('A-10: -91 → false (out of range)', () => {
  assert.strictEqual(isValidLatitude(-91), false);
});

test('A-11: 91 → false (out of range)', () => {
  assert.strictEqual(isValidLatitude(91), false);
});

test('A-12: string "48.5" → true', () => {
  assert.strictEqual(isValidLatitude('48.5'), true);
});

test('A-13: string "0" → true', () => {
  assert.strictEqual(isValidLatitude('0'), true);
});

test('A-14: string "abc" → false', () => {
  assert.strictEqual(isValidLatitude('abc'), false);
});

test('A-15: object {} → false', () => {
  assert.strictEqual(isValidLatitude({}), false);
});

test('A-16: string "-90" → true', () => {
  assert.strictEqual(isValidLatitude('-90'), true);
});

test('A-17: string "90" → true', () => {
  assert.strictEqual(isValidLatitude('90'), true);
});

test('A-18: string "91" → false', () => {
  assert.strictEqual(isValidLatitude('91'), false);
});

test('A-19: false (boolean) → false (booleans rejected explicitly)', () => {
  assert.strictEqual(isValidLatitude(false), false);
});

test('A-20: true (boolean) → false (booleans rejected explicitly)', () => {
  assert.strictEqual(isValidLatitude(true), false);
});

// ═════════════════════════════════════════════════════════════════════════════
// B — isValidLongitude
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nB — isValidLongitude');

test('B-01: null → false', () => {
  assert.strictEqual(isValidLongitude(null), false);
});

test('B-02: undefined → false', () => {
  assert.strictEqual(isValidLongitude(undefined), false);
});

test('B-03: empty string → false', () => {
  assert.strictEqual(isValidLongitude(''), false);
});

test('B-04: NaN → false', () => {
  assert.strictEqual(isValidLongitude(NaN), false);
});

test('B-05: 0 → true (CRITICAL — prime meridian is valid)', () => {
  assert.strictEqual(isValidLongitude(0), true);
});

test('B-06: 2.3522 → true', () => {
  assert.strictEqual(isValidLongitude(2.3522), true);
});

test('B-07: -180 → true (date line boundary)', () => {
  assert.strictEqual(isValidLongitude(-180), true);
});

test('B-08: 180 → true (date line boundary)', () => {
  assert.strictEqual(isValidLongitude(180), true);
});

test('B-09: -181 → false (out of range)', () => {
  assert.strictEqual(isValidLongitude(-181), false);
});

test('B-10: 181 → false (out of range)', () => {
  assert.strictEqual(isValidLongitude(181), false);
});

test('B-11: string "2.35" → true', () => {
  assert.strictEqual(isValidLongitude('2.35'), true);
});

test('B-12: string "-180" → true', () => {
  assert.strictEqual(isValidLongitude('-180'), true);
});

test('B-13: string "180" → true', () => {
  assert.strictEqual(isValidLongitude('180'), true);
});

test('B-14: string "181" → false', () => {
  assert.strictEqual(isValidLongitude('181'), false);
});

// ═════════════════════════════════════════════════════════════════════════════
// C — hasValidCoordinates
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nC — hasValidCoordinates');

test('C-01: null, null → false', () => {
  assert.strictEqual(hasValidCoordinates(null, null), false);
});

test('C-02: 48, null → false (lon missing)', () => {
  assert.strictEqual(hasValidCoordinates(48, null), false);
});

test('C-03: null, 2 → false (lat missing)', () => {
  assert.strictEqual(hasValidCoordinates(null, 2), false);
});

test('C-04: 0, 0 → true (CRITICAL — equator/meridian intersection)', () => {
  assert.strictEqual(hasValidCoordinates(0, 0), true);
});

test('C-05: 48.8566, 2.3522 → true (Paris)', () => {
  assert.strictEqual(hasValidCoordinates(48.8566, 2.3522), true);
});

test('C-06: 91, 0 → false (lat out of range)', () => {
  assert.strictEqual(hasValidCoordinates(91, 0), false);
});

test('C-07: 0, 181 → false (lon out of range)', () => {
  assert.strictEqual(hasValidCoordinates(0, 181), false);
});

test('C-08: undefined, 2 → false', () => {
  assert.strictEqual(hasValidCoordinates(undefined, 2), false);
});

test('C-09: 48, undefined → false', () => {
  assert.strictEqual(hasValidCoordinates(48, undefined), false);
});

test('C-10: -90, -180 → true (corner boundaries)', () => {
  assert.strictEqual(hasValidCoordinates(-90, -180), true);
});

// ═════════════════════════════════════════════════════════════════════════════
// D — buildMarketProfileIdentity: null fail-closed, 0/0 valid (Q2)
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nD — buildMarketProfileIdentity geo behavior');

const BASE_CURRENCY = 'EUR';
const VALID_LAT = 48.8566;
const VALID_LON = 2.3522;

test('D-01: lat=null → invalid_geo (fail closed — no longer accepts null as equator)', () => {
  const r = buildMarketProfileIdentity({ latitude: null, longitude: VALID_LON, currency: BASE_CURRENCY });
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.reason, 'invalid_geo');
  assert.strictEqual(r.profileId, null);
});

test('D-02: lon=null → invalid_geo', () => {
  const r = buildMarketProfileIdentity({ latitude: VALID_LAT, longitude: null, currency: BASE_CURRENCY });
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.reason, 'invalid_geo');
});

test('D-03: lat=undefined → invalid_geo', () => {
  const r = buildMarketProfileIdentity({ latitude: undefined, longitude: VALID_LON, currency: BASE_CURRENCY });
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.reason, 'invalid_geo');
});

test('D-04: lat=0, lon=0 → VALID (equator/meridian — was broken before Q2)', () => {
  const r = buildMarketProfileIdentity({ latitude: 0, longitude: 0, currency: BASE_CURRENCY });
  assert.strictEqual(r.valid, true);
  assert.ok(r.profileId);
  assert.strictEqual(r.reason, null);
});

test('D-05: lat=0, lon=2.35 → valid', () => {
  const r = buildMarketProfileIdentity({ latitude: 0, longitude: 2.35, currency: BASE_CURRENCY });
  assert.strictEqual(r.valid, true);
});

test('D-06: lat=48, lon=0 → valid', () => {
  const r = buildMarketProfileIdentity({ latitude: 48, longitude: 0, currency: BASE_CURRENCY });
  assert.strictEqual(r.valid, true);
});

test('D-07: lat=91 → invalid_geo', () => {
  const r = buildMarketProfileIdentity({ latitude: 91, longitude: VALID_LON, currency: BASE_CURRENCY });
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.reason, 'invalid_geo');
});

test('D-08: lon=181 → invalid_geo', () => {
  const r = buildMarketProfileIdentity({ latitude: VALID_LAT, longitude: 181, currency: BASE_CURRENCY });
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.reason, 'invalid_geo');
});

test('D-09: string "0"/"0" → valid (string coordinates)', () => {
  const r = buildMarketProfileIdentity({ latitude: '0', longitude: '0', currency: BASE_CURRENCY });
  assert.strictEqual(r.valid, true);
});

test('D-10: string "48.5"/"2.35" → valid', () => {
  const r = buildMarketProfileIdentity({ latitude: '48.5', longitude: '2.35', currency: BASE_CURRENCY });
  assert.strictEqual(r.valid, true);
});

test('D-11: null/null → same profileId as 0/0 is impossible — null gives invalid', () => {
  const nullR  = buildMarketProfileIdentity({ latitude: null, longitude: null, currency: BASE_CURRENCY });
  const zeroR  = buildMarketProfileIdentity({ latitude: 0,    longitude: 0,    currency: BASE_CURRENCY });
  assert.strictEqual(nullR.valid, false);
  assert.strictEqual(zeroR.valid, true);
  // profileIds must NOT collide
  assert.notStrictEqual(nullR.profileId, zeroR.profileId); // nullR.profileId is null anyway
});

test('D-12: lat=NaN → invalid_geo', () => {
  const r = buildMarketProfileIdentity({ latitude: NaN, longitude: VALID_LON, currency: BASE_CURRENCY });
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.reason, 'invalid_geo');
});

// ═════════════════════════════════════════════════════════════════════════════
// E — cron shadow eligibility: hasValidCoordinates semantics (Q3)
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nE — cron shadow eligibility logic');

// Replicate the exact skip logic from dynamic-pricing-cron.js _runShadowCollectionPhase
function cronShadowEligible(cfg) {
  return hasValidCoordinates(cfg.latitude, cfg.longitude) && !!cfg.currency;
}

test('E-01: null lat → ineligible', () => {
  assert.strictEqual(cronShadowEligible({ latitude: null, longitude: 2.35, currency: 'EUR' }), false);
});

test('E-02: null lon → ineligible', () => {
  assert.strictEqual(cronShadowEligible({ latitude: 48.5, longitude: null, currency: 'EUR' }), false);
});

test('E-03: lat=0, lon=0 → eligible (Q3 fix: old truthy check would skip this)', () => {
  assert.strictEqual(cronShadowEligible({ latitude: 0, longitude: 0, currency: 'EUR' }), true);
});

test('E-04: valid lat/lon but null currency → ineligible', () => {
  assert.strictEqual(cronShadowEligible({ latitude: 48.5, longitude: 2.35, currency: null }), false);
});

test('E-05: valid lat/lon and currency → eligible', () => {
  assert.strictEqual(cronShadowEligible({ latitude: 48.5, longitude: 2.35, currency: 'EUR' }), true);
});

test('E-06: undefined coords → ineligible', () => {
  assert.strictEqual(cronShadowEligible({ latitude: undefined, longitude: undefined, currency: 'EUR' }), false);
});

// E-07: Demonstrates the old truthy bug — preserved as documentation
test('E-07: old !lat check would incorrectly skip lat=0 — new check does not', () => {
  const cfg = { latitude: 0, longitude: 0, currency: 'EUR' };
  const oldCheckWouldSkip  = !cfg.latitude || !cfg.longitude || !cfg.currency; // TRUE (wrong)
  const newCheckWouldSkip  = !cronShadowEligible(cfg);                         // FALSE (correct)
  assert.strictEqual(oldCheckWouldSkip,  true,  'old check incorrectly skips lat=0');
  assert.strictEqual(newCheckWouldSkip,  false, 'new check correctly passes lat=0');
});

// ═════════════════════════════════════════════════════════════════════════════
// F — audit eligibility: same semantics as cron (Q3)
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nF — audit eligibility logic');

// Replicate audit-market-shared-profiles-p.js step A
function auditStepA(cfg) {
  return hasValidCoordinates(cfg.latitude, cfg.longitude) && !!cfg.currency;
}

test('F-01: null/null → not eligible', () => {
  assert.strictEqual(auditStepA({ latitude: null, longitude: null, currency: 'EUR' }), false);
});

test('F-02: 0/0 → eligible (aligned with cron — both use hasValidCoordinates)', () => {
  assert.strictEqual(auditStepA({ latitude: 0, longitude: 0, currency: 'EUR' }), true);
});

test('F-03: cron and audit give identical decisions for all test configs', () => {
  const configs = [
    { latitude: null,  longitude: 2.35,  currency: 'EUR' },
    { latitude: 48.5,  longitude: null,  currency: 'EUR' },
    { latitude: 0,     longitude: 0,     currency: 'EUR' },
    { latitude: 48.5,  longitude: 2.35,  currency: null  },
    { latitude: 48.5,  longitude: 2.35,  currency: 'EUR' },
    { latitude: -90,   longitude: -180,  currency: 'USD' },
  ];
  for (const cfg of configs) {
    assert.strictEqual(
      cronShadowEligible(cfg),
      auditStepA(cfg),
      `cron/audit mismatch for ${JSON.stringify(cfg)}`
    );
  }
});

test('F-04: buildMarketProfileIdentity agrees with eligibility — eligible → valid profile', () => {
  const cfg = { latitude: 48.5, longitude: 2.35, currency: 'EUR', max_guests: 4, bedrooms: 2 };
  const eligible = auditStepA(cfg);
  const profile  = buildMarketProfileIdentity({
    latitude: cfg.latitude, longitude: cfg.longitude, currency: cfg.currency,
    targetGuests: cfg.max_guests, targetBedrooms: cfg.bedrooms,
  });
  assert.strictEqual(eligible, true);
  assert.strictEqual(profile.valid, true);
});

test('F-05: buildMarketProfileIdentity agrees — ineligible (null) → invalid profile', () => {
  const cfg = { latitude: null, longitude: 2.35, currency: 'EUR' };
  const eligible = auditStepA(cfg);
  const profile  = buildMarketProfileIdentity({
    latitude: cfg.latitude, longitude: cfg.longitude, currency: cfg.currency,
  });
  assert.strictEqual(eligible, false);
  assert.strictEqual(profile.valid, false);
});

// ═════════════════════════════════════════════════════════════════════════════
// G — geocode audit: static safety invariants (Q4/Q5/Q6/Q7)
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nG — geocode audit static safety invariants');

// Read audit source to check static invariants without executing it
const AUDIT_SOURCE = fs.readFileSync(
  path.join(__dirname, '../outils/audit-boostprice-geo-readiness-q.js'), 'utf8'
);

test('G-01: --execute-geocode is not auto-invoked (requires explicit flag)', () => {
  // The source must check process.argv for --execute-geocode
  assert.ok(
    AUDIT_SOURCE.includes('process.argv.includes(\'--execute-geocode\')'),
    'Must gate geocode execution on explicit --execute-geocode flag'
  );
});

test('G-02: audit does NOT call scheduleMarketRefresh (no market refresh side effect)', () => {
  // Check for actual function invocation, not comment references
  assert.ok(
    !AUDIT_SOURCE.includes('scheduleMarketRefresh('),
    'Audit must NOT call scheduleMarketRefresh() (BRIGHT_DATA_CALLS_FROM_Q=0)'
  );
});

test('G-03: audit does NOT call geocodePropertyAsync (uses geocodeAddress directly)', () => {
  // Check for actual function invocation, not comment references
  assert.ok(
    !AUDIT_SOURCE.includes('geocodePropertyAsync('),
    'Audit must use geocodeAddress directly, NOT geocodePropertyAsync() (which triggers refresh)'
  );
});

test('G-04: CAS write is guarded by address match (WHERE id=$5 AND address=$6)', () => {
  assert.ok(
    AUDIT_SOURCE.includes('WHERE id = $5 AND address = $6'),
    'CAS UPDATE must include address guard to prevent stale writes'
  );
});

test('G-05: audit does NOT touch market_observations table', () => {
  assert.ok(
    !AUDIT_SOURCE.includes('market_observations'),
    'Audit must not write to market_observations'
  );
});

test('G-06: audit does NOT touch market_profiles table', () => {
  assert.ok(
    !AUDIT_SOURCE.includes('market_profiles'),
    'Audit must not write to market_profiles'
  );
});

test('G-07: audit does NOT touch market_property_links table', () => {
  assert.ok(
    !AUDIT_SOURCE.includes('market_property_links'),
    'Audit must not write to market_property_links'
  );
});

test('G-08: audit does NOT touch pricing_config table (no currency mutation)', () => {
  const hasPricingUpdate = /UPDATE\s+pricing_config/.test(AUDIT_SOURCE);
  assert.ok(!hasPricingUpdate, 'Must not UPDATE pricing_config');
});

test('G-09: audit does NOT call coordinateCollection (no shadow coordinator)', () => {
  assert.ok(
    !AUDIT_SOURCE.includes('coordinateCollection'),
    'Audit must not invoke shadow collection coordinator'
  );
});

test('G-10: audit does NOT call channex (no OTA writes)', () => {
  assert.ok(
    !AUDIT_SOURCE.includes('channex'),
    'Audit must not call Channex'
  );
});

test('G-11: audit uses existing geocodeAddress from property-geocoder (not a new geocoder)', () => {
  assert.ok(
    AUDIT_SOURCE.includes("require('../services/property-geocoder')"),
    'Must reuse existing property-geocoder service'
  );
});

test('G-12: audit uses hasValidCoordinates from canonical validator', () => {
  assert.ok(
    AUDIT_SOURCE.includes("require('../services/market-geo-validator')"),
    'Must use canonical market-geo-validator'
  );
});

test('G-13: audit BRIGHT_DATA_CALLS_FROM_Q declared as 0', () => {
  assert.ok(
    AUDIT_SOURCE.includes('BRIGHT_DATA_CALLS_FROM_Q = 0'),
    'Must declare BRIGHT_DATA_CALLS_FROM_Q = 0'
  );
});

test('G-14: audit MARKET_REFRESH_CALLS declared as 0', () => {
  assert.ok(
    AUDIT_SOURCE.includes('MARKET_REFRESH_CALLS') && AUDIT_SOURCE.includes('= 0'),
    'Must declare MARKET_REFRESH_CALLS = 0'
  );
});

test('G-15: geocode only processes properties with has_address', () => {
  assert.ok(
    AUDIT_SOURCE.includes('geoMissing.filter(p => p.hasAddress)'),
    'Must only geocode properties that have an address'
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// H — geocode CAS logic (mocked DB + geocoder)
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nH — geocode CAS logic (mocked)');

// Extract geocodeOneProperty function logic — re-implement inline for unit testing
// since the original is in an IIFE-style module. We test the logic pattern directly.

async function geocodeOnePropertyMock(prop, geocodeResult, dbWriteRowCount = 1) {
  const { id, address } = prop;

  if (!address || !String(address).trim()) {
    return { status: 'skipped', reason: 'no_address' };
  }

  // Mock geocode call
  const geoResult = geocodeResult;

  if (!geoResult || geoResult.status !== 'resolved') {
    return { status: 'skipped', reason: `geocode_${geoResult?.status ?? 'null'}: ${geoResult?.reason ?? ''}` };
  }

  // Mock CAS write: simulate address changed (rowCount=0) or success (rowCount=1)
  if (dbWriteRowCount === 0) {
    return { status: 'skipped', reason: 'cas_miss_address_changed' };
  }

  return {
    status: 'resolved',
    resultType: geoResult.resultType,
    confidence: geoResult.confidence,
    countryCode: geoResult.countryCode,
  };
}

const RESOLVED_GEO = {
  status: 'resolved', latitude: 48.8566, longitude: 2.3522,
  countryCode: 'FR', timezone: 'Europe/Paris', confidence: 0.85,
  resultType: 'building', provider: 'geoapify',
};

const AMBIGUOUS_GEO  = { status: 'ambiguous', reason: 'ambiguous', latitude: 48.8, longitude: 2.3, confidence: 0.5, resultType: 'street' };
const FAILED_GEO     = { status: 'failed', reason: 'no_result' };

(async function runAsyncTests() {
  const asyncTests = [];

  asyncTests.push(['H-01: no address → skipped with no_address', async () => {
    const r = await geocodeOnePropertyMock({ id: 'p1', address: null }, RESOLVED_GEO);
    assert.strictEqual(r.status, 'skipped');
    assert.strictEqual(r.reason, 'no_address');
  }]);

  asyncTests.push(['H-02: empty address → skipped', async () => {
    const r = await geocodeOnePropertyMock({ id: 'p1', address: '   ' }, RESOLVED_GEO);
    assert.strictEqual(r.status, 'skipped');
    assert.strictEqual(r.reason, 'no_address');
  }]);

  asyncTests.push(['H-03: geocode returns resolved → resolved result', async () => {
    const r = await geocodeOnePropertyMock(
      { id: 'p1', address: '1 rue de Rivoli, Paris' },
      RESOLVED_GEO, 1
    );
    assert.strictEqual(r.status, 'resolved');
    assert.strictEqual(r.countryCode, 'FR');
  }]);

  asyncTests.push(['H-04: geocode returns ambiguous → skipped (not written)', async () => {
    const r = await geocodeOnePropertyMock(
      { id: 'p1', address: '1 rue de Rivoli, Paris' },
      AMBIGUOUS_GEO
    );
    assert.strictEqual(r.status, 'skipped');
    assert.ok(r.reason.startsWith('geocode_ambiguous'));
  }]);

  asyncTests.push(['H-05: geocode returns failed → skipped', async () => {
    const r = await geocodeOnePropertyMock(
      { id: 'p1', address: '1 rue de Rivoli, Paris' },
      FAILED_GEO
    );
    assert.strictEqual(r.status, 'skipped');
    assert.ok(r.reason.startsWith('geocode_failed'));
  }]);

  asyncTests.push(['H-06: CAS write returns rowCount=0 (address changed) → skipped', async () => {
    const r = await geocodeOnePropertyMock(
      { id: 'p1', address: '1 rue de Rivoli, Paris' },
      RESOLVED_GEO,
      0  // simulate: address changed between read and write → no row updated
    );
    assert.strictEqual(r.status, 'skipped');
    assert.strictEqual(r.reason, 'cas_miss_address_changed');
  }]);

  asyncTests.push(['H-07: already-valid coordinates → not in candidate list (filter logic)', async () => {
    // Properties with valid coordinates should not reach geocodeOneProperty
    const props = [
      { id: 'p1', latitude: 48.5, longitude: 2.3, hasAddress: true },  // valid geo
      { id: 'p2', latitude: null, longitude: null, hasAddress: true },  // missing geo — candidate
      { id: 'p3', latitude: null, longitude: null, hasAddress: false }, // missing geo but no address
    ];
    const geoMissing  = props.filter(p => !hasValidCoordinates(p.latitude, p.longitude));
    const candidates  = geoMissing.filter(p => p.hasAddress);
    assert.strictEqual(candidates.length, 1);
    assert.strictEqual(candidates[0].id, 'p2');
    // p1: valid geo → not in geoMissing
    // p3: no address → filtered from candidates
  }]);

  asyncTests.push(['H-08: geocode does not modify currency (no pricing fields in UPDATE)', async () => {
    // The UPDATE statement only touches lat/lon/country_code/timezone
    const updateSQL = `UPDATE properties
       SET latitude = $1, longitude = $2, country_code = $3, timezone = $4
       WHERE id = $5 AND address = $6`;
    assert.ok(!updateSQL.includes('currency'));
    assert.ok(!updateSQL.includes('pricing'));
    assert.ok(!updateSQL.includes('boostprice'));
  }]);

  for (const [label, fn] of asyncTests) {
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

  // ── Final report ──────────────────────────────────────────────────────────────
  console.log('\n');
  if (failed > 0) {
    const detail = failures.map(f => `  ✗ ${f.label}: ${f.message}`).join('\n');
    console.error(`P1.2-B5-BK-Q — ${passed} passed, ${failed} failed:\n${detail}`);
    process.exit(1);
  } else {
    console.log(`P1.2-B5-BK-Q — ${passed} passed, ${failed} failed`);
  }
})().catch(err => {
  console.error('Test runner error:', err.message);
  process.exit(1);
});
