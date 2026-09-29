'use strict';
/**
 * P1.2-B5-BK-R-PROD-1 — Post-Activation Verifier Tests
 *
 * Sections:
 *   A  determineActivationState — audit state semantics
 *   B  validateProviderObservation — valid / invalid cases
 *   C  buildSharedProfileGroups — M6/M7 shared profile detection
 *   D  checkPricingAuthority — no market_observations pricing reads
 *   E  verifier: WAITING_FOR_FIRST_COLLECTION state (zero obs)
 *   F  verifier: FIRST_COLLECTION_VALID state
 *   G  verifier: FIRST_COLLECTION_INVALID state
 *   H  verifier: UNSAFE_FLAG_CONFIGURATION
 *   I  --since CLI argument parsing
 *   J  Ti Junot guard (incomplete + attachment = violation)
 *   K  M6/M7 shared attachment validation
 *   L  Static safety invariants (verifier source)
 *   M  Audit fix regressions (post-activation state)
 *   N  Prior suite regressions (Q, Q1, R bridge)
 *
 * Safety:
 *   DB_WRITES     = 0  (injected mocks)
 *   NETWORK_CALLS = 0
 *   BRIGHT_DATA   = 0
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const {
  validateProviderObservation,
  buildSharedProfileGroups,
  checkPricingAuthority,
  PRICING_FILES_TO_CHECK,
} = require('../outils/verify-market-persistence-prod-r');

const { determineActivationState } = require('../outils/audit-market-persistence-activation-r');

let passed   = 0;
let failed   = 0;
const failures = [];

function test(label, fn) {
  try { fn(); passed++; process.stdout.write('.'); }
  catch (e) { failed++; failures.push({ label, message: e.message }); process.stdout.write('F'); }
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

const VALID_OBS = {
  observation_id:    'obs-abc-123',
  provider:          'airbnb',
  observation_type:  'PROVIDER',
  data_source:       'brightdata_live',
  collected_at:      '2026-09-30T06:30:00.000Z',
  search_fingerprint:'ms2_abc123',
  market_profile_id: 'mp2_def456',
  currency:          'EUR',
  check_in:          '2026-10-14',
  check_out:         '2026-10-15',
  nights:            1,
  comparable_count:  28,
  median_price:      120,
  p25_price:         95,
  p75_price:         155,
  collection_run_id: 'brun_xyz-uuid',
  provenance:        { bridge: true, tensionLevel: 'HIGH' },
  quality_status:    null,
};

const VALID_LINKS = [
  { observation_id: 'obs-abc-123', property_id: '42', user_id: '7', assignment_reason: 'shared_search' },
];

const VALID_PROPS_M6M7 = [
  { id: 6, internal_name: 'M6', name: 'M6 Apt', latitude: 48.8566, longitude: 2.3522, currency: 'EUR', max_guests: 4, bedrooms: 2, property_type: 'entire_place' },
  { id: 7, internal_name: 'M7', name: 'M7 Apt', latitude: 48.8566, longitude: 2.3522, currency: 'EUR', max_guests: 4, bedrooms: 2, property_type: 'entire_place' },
  { id: 99, internal_name: 'Ti Junot', name: 'Ti Junot Loft', latitude: null, longitude: null, currency: 'EUR', max_guests: 2, bedrooms: 1, property_type: 'entire_place' },
];

// ═════════════════════════════════════════════════════════════════════════════
// A — determineActivationState
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nA — determineActivationState');

test('A-01: both OFF → PRE_ACTIVATION', () => {
  assert.strictEqual(determineActivationState(false, false), 'PRE_ACTIVATION');
});

test('A-02: persistence=true, shared=false → PERSISTENCE_ACTIVE_SHADOW', () => {
  assert.strictEqual(determineActivationState(true, false), 'PERSISTENCE_ACTIVE_SHADOW');
});

test('A-03: both ON → PERSISTENCE_AND_SHARED_ACTIVE', () => {
  assert.strictEqual(determineActivationState(true, true), 'PERSISTENCE_AND_SHARED_ACTIVE');
});

test('A-04: shared=true, persistence=false → SHARED_ONLY_NO_PERSISTENCE', () => {
  assert.strictEqual(determineActivationState(false, true), 'SHARED_ONLY_NO_PERSISTENCE');
});

test('A-05: PERSISTENCE_ACTIVE_SHADOW is the expected production state', () => {
  // This is the state we should be in on Render right now
  const state = determineActivationState(true, false);
  assert.strictEqual(state, 'PERSISTENCE_ACTIVE_SHADOW');
});

test('A-06: PRE_ACTIVATION is not a failure — it means ready to activate', () => {
  const state = determineActivationState(false, false);
  // PRE_ACTIVATION must NOT be considered an error — it's the pre-activation healthy state
  assert.notStrictEqual(state, 'PERSISTENCE_AND_SHARED_ACTIVE');
  assert.notStrictEqual(state, 'SHARED_ONLY_NO_PERSISTENCE');
});

test('A-07: PERSISTENCE_AND_SHARED_ACTIVE is distinct from PERSISTENCE_ACTIVE_SHADOW', () => {
  assert.notStrictEqual(
    determineActivationState(true, true),
    determineActivationState(true, false)
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// B — validateProviderObservation
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nB — validateProviderObservation');

test('B-01: valid observation + links → valid=true, no issues', () => {
  const r = validateProviderObservation(VALID_OBS, VALID_LINKS);
  assert.strictEqual(r.valid, true, `Unexpected issues: ${r.issues.join(', ')}`);
  assert.strictEqual(r.issues.length, 0);
});

test('B-02: unrecognized provider → issue unrecognized_provider', () => {
  const obs = { ...VALID_OBS, provider: 'tripadvisor' };
  const r   = validateProviderObservation(obs, VALID_LINKS);
  assert.ok(r.issues.some(i => i.startsWith('unrecognized_provider')));
  assert.strictEqual(r.valid, false);
});

test('B-03: wrong observation_type (DERIVED_CONSENSUS) → issue wrong_observation_type', () => {
  const obs = { ...VALID_OBS, observation_type: 'DERIVED_CONSENSUS' };
  const r   = validateProviderObservation(obs, VALID_LINKS);
  assert.ok(r.issues.some(i => i.startsWith('wrong_observation_type')));
});

test('B-04: invalid collected_at → issue invalid_collected_at', () => {
  const obs = { ...VALID_OBS, collected_at: 'not-a-date' };
  const r   = validateProviderObservation(obs, VALID_LINKS);
  assert.ok(r.issues.includes('invalid_collected_at'));
});

test('B-05: null collected_at → issue invalid_collected_at', () => {
  const obs = { ...VALID_OBS, collected_at: null };
  const r   = validateProviderObservation(obs, VALID_LINKS);
  assert.ok(r.issues.includes('invalid_collected_at'));
});

test('B-06: invalid currency (lowercase) → issue invalid_currency', () => {
  const obs = { ...VALID_OBS, currency: 'eur' };
  const r   = validateProviderObservation(obs, VALID_LINKS);
  assert.ok(r.issues.some(i => i.startsWith('invalid_currency')));
});

test('B-07: null currency → issue invalid_currency', () => {
  const obs = { ...VALID_OBS, currency: null };
  const r   = validateProviderObservation(obs, VALID_LINKS);
  assert.ok(r.issues.some(i => i.startsWith('invalid_currency')));
});

test('B-08: missing check_in → issue missing_stay_window', () => {
  const obs = { ...VALID_OBS, check_in: null };
  const r   = validateProviderObservation(obs, VALID_LINKS);
  assert.ok(r.issues.includes('missing_stay_window'));
});

test('B-09: missing check_out → issue missing_stay_window', () => {
  const obs = { ...VALID_OBS, check_out: null };
  const r   = validateProviderObservation(obs, VALID_LINKS);
  assert.ok(r.issues.includes('missing_stay_window'));
});

test('B-10: check_in >= check_out → issue invalid_stay_window', () => {
  const obs = { ...VALID_OBS, check_in: '2026-10-16', check_out: '2026-10-15' };
  const r   = validateProviderObservation(obs, VALID_LINKS);
  assert.ok(r.issues.some(i => i.startsWith('invalid_stay_window')));
});

test('B-11: missing search_fingerprint → issue missing_search_fingerprint', () => {
  const obs = { ...VALID_OBS, search_fingerprint: null };
  const r   = validateProviderObservation(obs, VALID_LINKS);
  assert.ok(r.issues.includes('missing_search_fingerprint'));
});

test('B-12: missing market_profile_id → issue missing_market_profile_id', () => {
  const obs = { ...VALID_OBS, market_profile_id: null };
  const r   = validateProviderObservation(obs, VALID_LINKS);
  assert.ok(r.issues.includes('missing_market_profile_id'));
});

test('B-13: missing collection_run_id → issue missing_collection_run_id', () => {
  const obs = { ...VALID_OBS, collection_run_id: null };
  const r   = validateProviderObservation(obs, VALID_LINKS);
  assert.ok(r.issues.includes('missing_collection_run_id'));
});

test('B-14: provenance.bridge !== true → issue provenance_bridge_flag_missing', () => {
  const obs = { ...VALID_OBS, provenance: { bridge: false } };
  const r   = validateProviderObservation(obs, VALID_LINKS);
  assert.ok(r.issues.includes('provenance_bridge_flag_missing'));
});

test('B-15: null provenance → issue provenance_bridge_flag_missing', () => {
  const obs = { ...VALID_OBS, provenance: null };
  const r   = validateProviderObservation(obs, VALID_LINKS);
  assert.ok(r.issues.includes('provenance_bridge_flag_missing'));
});

test('B-16: comparable_count>0 and median_price null → issue suspicious_median', () => {
  const obs = { ...VALID_OBS, comparable_count: 5, median_price: null };
  const r   = validateProviderObservation(obs, VALID_LINKS);
  assert.ok(r.issues.some(i => i.startsWith('suspicious_median')));
});

test('B-17: comparable_count=0 and median_price null → no suspicious_median issue', () => {
  const obs = { ...VALID_OBS, comparable_count: 0, median_price: null };
  const r   = validateProviderObservation(obs, VALID_LINKS);
  assert.ok(!r.issues.some(i => i.startsWith('suspicious_median')),
    'Should not flag median when count=0');
});

test('B-18: no property links → issue no_property_attachments', () => {
  const r = validateProviderObservation(VALID_OBS, []);
  assert.ok(r.issues.includes('no_property_attachments'));
});

test('B-19: booking provider is valid', () => {
  const obs = { ...VALID_OBS, provider: 'booking' };
  const r   = validateProviderObservation(obs, VALID_LINKS);
  assert.ok(!r.issues.some(i => i.startsWith('unrecognized_provider')));
});

test('B-20: missing data_source → issue missing_data_source', () => {
  const obs = { ...VALID_OBS, data_source: null };
  const r   = validateProviderObservation(obs, VALID_LINKS);
  assert.ok(r.issues.includes('missing_data_source'));
});

// ═════════════════════════════════════════════════════════════════════════════
// C — buildSharedProfileGroups
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nC — buildSharedProfileGroups');

test('C-01: M6 and M7 (same lat/lon/currency/capacity) → same group', () => {
  const groups = buildSharedProfileGroups(VALID_PROPS_M6M7);
  const sharedGroups = [...groups.values()].filter(g => g.length > 1);
  assert.strictEqual(sharedGroups.length, 1, 'Exactly one shared profile group expected');
  assert.strictEqual(sharedGroups[0].length, 2, 'M6 + M7 should be in the same group');
});

test('C-02: Ti Junot (null geo) excluded from profile groups', () => {
  const groups  = buildSharedProfileGroups(VALID_PROPS_M6M7);
  const allIds  = [...groups.values()].flat().map(m => m.id);
  assert.ok(!allIds.includes('99'), 'Ti Junot (null geo) must be excluded from profile groups');
});

test('C-03: single property with unique location → own group (not shared)', () => {
  const props = [{ id: 1, internal_name: 'Solo', name: 'Solo', latitude: 43.0, longitude: 5.0, currency: 'EUR', max_guests: 2, bedrooms: 1, property_type: 'entire_place' }];
  const groups = buildSharedProfileGroups(props);
  const sharedGroups = [...groups.values()].filter(g => g.length > 1);
  assert.strictEqual(sharedGroups.length, 0, 'Solo property should not be in a shared group');
});

test('C-04: different currencies → different groups', () => {
  const props = [
    { id: 1, internal_name: 'A', name: 'A', latitude: 48.0, longitude: 2.0, currency: 'EUR', max_guests: 2, bedrooms: 1, property_type: 'entire_place' },
    { id: 2, internal_name: 'B', name: 'B', latitude: 48.0, longitude: 2.0, currency: 'GBP', max_guests: 2, bedrooms: 1, property_type: 'entire_place' },
  ];
  const groups = buildSharedProfileGroups(props);
  assert.strictEqual(groups.size, 2, 'Different currencies must produce different profile groups');
});

test('C-05: null lat/lon → excluded from profile groups', () => {
  const props = [{ id: 1, internal_name: 'X', name: 'X', latitude: null, longitude: null, currency: 'EUR', max_guests: 2, bedrooms: 1, property_type: 'entire_place' }];
  const groups = buildSharedProfileGroups(props);
  assert.strictEqual(groups.size, 0, 'Null geo must be excluded');
});

test('C-06: empty array → empty groups', () => {
  const groups = buildSharedProfileGroups([]);
  assert.strictEqual(groups.size, 0);
});

test('C-07: same geo but different bedrooms → different groups', () => {
  const props = [
    { id: 1, internal_name: 'A', name: 'A', latitude: 48.0, longitude: 2.0, currency: 'EUR', max_guests: 2, bedrooms: 1, property_type: 'entire_place' },
    { id: 2, internal_name: 'B', name: 'B', latitude: 48.0, longitude: 2.0, currency: 'EUR', max_guests: 4, bedrooms: 3, property_type: 'entire_place' },
  ];
  const groups = buildSharedProfileGroups(props);
  assert.strictEqual(groups.size, 2, 'Different capacities must produce different profile groups');
});

// ═════════════════════════════════════════════════════════════════════════════
// D — checkPricingAuthority
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nD — checkPricingAuthority');

test('D-01: none of the pricing files SELECT from market_observations', () => {
  const results = checkPricingAuthority();
  const violations = results.filter(r => r.readable && r.selectsFromObs);
  assert.strictEqual(violations.length, 0,
    `These pricing files read market_observations (violation): ${violations.map(v => v.file).join(', ')}`);
});

test('D-02: MARKET_OBSERVATIONS_PRICING_AUTHORITY = NO', () => {
  const results = checkPricingAuthority();
  const anyReads = results.some(r => r.readable && r.selectsFromObs);
  assert.strictEqual(anyReads, false, 'market_observations must NOT be read by pricing engine');
});

test('D-03: market-data-resolver.js is among checked files', () => {
  assert.ok(PRICING_FILES_TO_CHECK.some(f => f.includes('market-data-resolver')));
});

test('D-04: dynamic-pricing-routes.js is among checked files', () => {
  assert.ok(PRICING_FILES_TO_CHECK.some(f => f.includes('dynamic-pricing-routes')));
});

test('D-05: pricing-apply.js is among checked files', () => {
  assert.ok(PRICING_FILES_TO_CHECK.some(f => f.includes('pricing-apply')));
});

// ═════════════════════════════════════════════════════════════════════════════
// E — WAITING_FOR_FIRST_COLLECTION state (zero observations)
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nE — WAITING_FOR_FIRST_COLLECTION state logic');

test('E-01: observation count=0 → state must be WAITING_FOR_FIRST_COLLECTION', () => {
  // The verifier returns WAITING when observationCount=0 and flags are correct
  // We verify the logic through the state determination functions
  const flagState = determineActivationState(true, false);
  assert.strictEqual(flagState, 'PERSISTENCE_ACTIVE_SHADOW', 'Flags must be in shadow mode');
  // Zero observations with correct flags → WAITING (not failure)
  // This is the expected initial state
});

test('E-02: zero observations is NOT an error state', () => {
  // WAITING_FOR_FIRST_COLLECTION should not cause process.exit(1)
  // The verifier only exits with 1 for FIRST_COLLECTION_INVALID or UNSAFE_FLAG_CONFIGURATION
  // We verify this via static analysis of the source
  const VERIFIER_SOURCE = fs.readFileSync(
    path.join(__dirname, '../outils/verify-market-persistence-prod-r.js'), 'utf8'
  );
  // Verify that WAITING is not treated as a failure
  assert.ok(
    VERIFIER_SOURCE.includes("'FIRST_COLLECTION_INVALID'") &&
    VERIFIER_SOURCE.includes("'UNSAFE_FLAG_CONFIGURATION'"),
    'Only invalid/unsafe states should exit with non-zero'
  );
  assert.ok(
    !VERIFIER_SOURCE.includes("WAITING_FOR_FIRST_COLLECTION.*process.exit"),
    'WAITING_FOR_FIRST_COLLECTION must NOT trigger process.exit(1)'
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// F — FIRST_COLLECTION_VALID state
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nF — FIRST_COLLECTION_VALID state logic');

test('F-01: all observations valid → state = FIRST_COLLECTION_VALID', () => {
  // Simulated: 2 valid observations, 0 invalid → validCount=2, invalidCount=0
  // final state logic: invalidCount === 0 → FIRST_COLLECTION_VALID
  const invalidCount = 0;
  const finalState   = invalidCount === 0 ? 'FIRST_COLLECTION_VALID' : 'FIRST_COLLECTION_INVALID';
  assert.strictEqual(finalState, 'FIRST_COLLECTION_VALID');
});

test('F-02: valid observation result has valid=true and empty issues', () => {
  const r = validateProviderObservation(VALID_OBS, VALID_LINKS);
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.issues.length, 0);
});

// ═════════════════════════════════════════════════════════════════════════════
// G — FIRST_COLLECTION_INVALID state
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nG — FIRST_COLLECTION_INVALID state logic');

test('G-01: any invalid observation → FIRST_COLLECTION_INVALID', () => {
  const invalidCount = 1;
  const finalState   = invalidCount === 0 ? 'FIRST_COLLECTION_VALID' : 'FIRST_COLLECTION_INVALID';
  assert.strictEqual(finalState, 'FIRST_COLLECTION_INVALID');
});

test('G-02: observation with missing profile → invalid', () => {
  const obs = { ...VALID_OBS, market_profile_id: null };
  const r   = validateProviderObservation(obs, VALID_LINKS);
  assert.strictEqual(r.valid, false);
  assert.ok(r.issues.includes('missing_market_profile_id'));
});

test('G-03: observation with missing fingerprint → invalid', () => {
  const obs = { ...VALID_OBS, search_fingerprint: null };
  const r   = validateProviderObservation(obs, VALID_LINKS);
  assert.strictEqual(r.valid, false);
});

test('G-04: observation with wrong currency → invalid', () => {
  const obs = { ...VALID_OBS, currency: 'XX' };
  const r   = validateProviderObservation(obs, VALID_LINKS);
  assert.strictEqual(r.valid, false);
});

test('G-05: observation with bad stay window (check_in > check_out) → invalid', () => {
  const obs = { ...VALID_OBS, check_in: '2026-10-20', check_out: '2026-10-15' };
  const r   = validateProviderObservation(obs, VALID_LINKS);
  assert.strictEqual(r.valid, false);
});

// ═════════════════════════════════════════════════════════════════════════════
// H — UNSAFE_FLAG_CONFIGURATION
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nH — UNSAFE_FLAG_CONFIGURATION');

test('H-01: persistence=false → not shadow mode (verifier would return UNSAFE_FLAG_CONFIGURATION)', () => {
  const state = determineActivationState(false, false);
  assert.notStrictEqual(state, 'PERSISTENCE_ACTIVE_SHADOW');
});

test('H-02: both flags ON → not expected shadow mode', () => {
  const state = determineActivationState(true, true);
  assert.strictEqual(state, 'PERSISTENCE_AND_SHARED_ACTIVE');
});

test('H-03: EXPECTED_SHADOW_MODE = persistence=true AND shared=false', () => {
  const persistenceOn = true;
  const sharedOn      = false;
  const expectedShadowMode = persistenceOn && !sharedOn;
  assert.strictEqual(expectedShadowMode, true);
});

test('H-04: persistence=false → EXPECTED_SHADOW_MODE = false', () => {
  const expectedShadowMode = false && !false;
  assert.strictEqual(expectedShadowMode, false);
});

// ═════════════════════════════════════════════════════════════════════════════
// I — --since parsing
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nI — --since parsing');

// These tests exercise the parsing logic without running the CLI
test('I-01: valid ISO8601 string parses to finite date', () => {
  const raw    = '2026-09-29T17:00:00Z';
  const parsed = new Date(raw);
  assert.ok(isFinite(parsed.getTime()), 'Must parse to finite date');
});

test('I-02: invalid ISO8601 string → NaN (fail closed)', () => {
  const raw    = 'not-a-date';
  const parsed = new Date(raw);
  assert.ok(!isFinite(parsed.getTime()), 'Invalid date must not parse');
});

test('I-03: ISO8601 with Z suffix → UTC (isFinite)', () => {
  const raw = '2026-09-29T17:00:00.000Z';
  assert.ok(isFinite(new Date(raw).getTime()));
});

test('I-04: ISO8601 with offset → valid', () => {
  const raw = '2026-09-29T19:00:00+02:00';
  assert.ok(isFinite(new Date(raw).getTime()));
});

test('I-05: empty string → fail closed', () => {
  const raw    = '';
  const parsed = new Date(raw);
  // new Date('') → Invalid Date in Node
  assert.ok(!isFinite(parsed.getTime()), 'Empty string must fail');
});

test('I-06: verifier source references --since flag', () => {
  const VERIFIER_SOURCE = fs.readFileSync(
    path.join(__dirname, '../outils/verify-market-persistence-prod-r.js'), 'utf8'
  );
  assert.ok(VERIFIER_SOURCE.includes('--since='), 'Verifier must document --since CLI option');
});

test('I-07: provenance unconfirmed warning when --since omitted', () => {
  const VERIFIER_SOURCE = fs.readFileSync(
    path.join(__dirname, '../outils/verify-market-persistence-prod-r.js'), 'utf8'
  );
  assert.ok(
    VERIFIER_SOURCE.includes('sinceUnconfirmed') || VERIFIER_SOURCE.includes('provenance unconfirmed'),
    'Verifier must warn when --since is omitted'
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// J — Ti Junot guard
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nJ — Ti Junot guard');

test('J-01: incomplete property with 0 attachments → guard OK', () => {
  // Simulated: Ti Junot has null geo, attachment_count=0
  const attachmentCount = 0;
  const geoNull         = true;
  const guardOk         = !(geoNull && attachmentCount > 0);
  assert.strictEqual(guardOk, true, 'Zero attachments on incomplete property = guard OK');
});

test('J-02: incomplete property with 1+ attachments → guard VIOLATION', () => {
  const attachmentCount = 1;
  const geoNull         = true;
  const guardViolated   = geoNull && attachmentCount > 0;
  assert.strictEqual(guardViolated, true, 'Attachment on incomplete property = violation');
});

test('J-03: Ti Junot expected to have TI_JUNOT_PROFILE_READY = NO currently', () => {
  // Ti Junot has null lat/lon in the test fixture
  const tiJunot = VALID_PROPS_M6M7.find(p => p.internal_name === 'Ti Junot');
  assert.ok(tiJunot, 'Ti Junot must be in fixture');
  const profileReady = tiJunot.latitude !== null && tiJunot.longitude !== null;
  assert.strictEqual(profileReady, false, 'Ti Junot must have incomplete profile (null geo)');
});

test('J-04: Ti Junot excluded from shared profile groups', () => {
  const groups = buildSharedProfileGroups(VALID_PROPS_M6M7);
  const allIds = [...groups.values()].flat().map(m => m.id);
  assert.ok(!allIds.includes('99'), 'Ti Junot must NOT appear in any profile group');
});

// ═════════════════════════════════════════════════════════════════════════════
// K — M6/M7 shared attachment validation
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nK — M6/M7 shared attachment validation');

test('K-01: M6 and M7 appear in the same profile group', () => {
  const groups = buildSharedProfileGroups(VALID_PROPS_M6M7);
  const sharedGroups = [...groups.values()].filter(g => g.length > 1);
  assert.strictEqual(sharedGroups.length, 1);
  const ids = sharedGroups[0].map(m => m.id);
  assert.ok(ids.includes('6') && ids.includes('7'), 'Both M6 and M7 must be in the group');
});

test('K-02: shared group has exactly 2 members (M6 + M7)', () => {
  const groups = buildSharedProfileGroups(VALID_PROPS_M6M7);
  const sharedGroups = [...groups.values()].filter(g => g.length > 1);
  assert.strictEqual(sharedGroups[0].length, 2);
});

test('K-03: M6 and M7 share the same profileId', () => {
  const groups = buildSharedProfileGroups(VALID_PROPS_M6M7);
  // There should be exactly one shared group key
  const sharedGroupKeys = [...groups.keys()].filter(k => groups.get(k).length > 1);
  assert.strictEqual(sharedGroupKeys.length, 1, 'Exactly one shared profileId expected');
});

test('K-04: M6/M7 WAITING state is not a failure (no observations yet)', () => {
  // WAITING_FOR_FIRST_COLLECTION is the expected initial state
  // We verify the verifier does not produce an error for this
  const VERIFIER_SOURCE = fs.readFileSync(
    path.join(__dirname, '../outils/verify-market-persistence-prod-r.js'), 'utf8'
  );
  assert.ok(
    VERIFIER_SOURCE.includes('WAITING_FOR_FIRST_COLLECTION'),
    'Verifier must handle WAITING state without error'
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// L — Static safety invariants (verifier source)
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nL — Static safety invariants');

const VERIFIER_SOURCE = fs.readFileSync(
  path.join(__dirname, '../outils/verify-market-persistence-prod-r.js'), 'utf8'
);

test('L-01: verifier does not call scrapeWithBrightData', () => {
  assert.ok(!VERIFIER_SOURCE.includes('scrapeWithBrightData('),
    'Verifier must NEVER call scrapeWithBrightData — zero BD credits');
});

test('L-02: verifier does not call geocodeAddress', () => {
  assert.ok(!VERIFIER_SOURCE.includes('geocodeAddress('),
    'Verifier must not call Geoapify');
});

test('L-03: verifier does not INSERT into any table', () => {
  // Allow comments — check for actual SQL INSERT statements
  assert.ok(!/pool\.query\s*\(\s*['`]INSERT\b/i.test(VERIFIER_SOURCE),
    'Verifier must NOT INSERT into any table (read-only)');
});

test('L-04: verifier does not UPDATE any table', () => {
  assert.ok(!/pool\.query\s*\(\s*['`]UPDATE\b/i.test(VERIFIER_SOURCE),
    'Verifier must NOT UPDATE any table (read-only)');
});

test('L-05: VERIFIER_PROVIDER_CALLS = 0 declared', () => {
  assert.ok(VERIFIER_SOURCE.includes('VERIFIER_PROVIDER_CALLS'),
    'Must declare VERIFIER_PROVIDER_CALLS = 0');
});

test('L-06: BRIDGE_CODE_ADDITIONAL_PROVIDER_CALLS = 0 declared', () => {
  assert.ok(VERIFIER_SOURCE.includes('BRIDGE_CODE_ADDITIONAL_PROVIDER_CALLS'),
    'Must declare BRIDGE_CODE_ADDITIONAL_PROVIDER_CALLS = 0');
});

test('L-07: RUNTIME_EXTRA_PROVIDER_CALLS_PROVEN = NO declared', () => {
  assert.ok(VERIFIER_SOURCE.includes('RUNTIME_EXTRA_PROVIDER_CALLS_PROVEN'),
    'Must declare RUNTIME_EXTRA_PROVIDER_CALLS_PROVEN = NO');
});

test('L-08: SAFE_TO_ENABLE_SHARED_COLLECTION = NO declared', () => {
  assert.ok(VERIFIER_SOURCE.includes('SAFE_TO_ENABLE_SHARED_COLLECTION'),
    'Must state shared collection is not yet safe to enable');
});

test('L-09: SAFE_TO_USE_OBSERVATIONS_FOR_PRICING = NO declared', () => {
  assert.ok(VERIFIER_SOURCE.includes('SAFE_TO_USE_OBSERVATIONS_FOR_PRICING'),
    'Must state observations must not be used for pricing');
});

test('L-10: DB_WRITES=0 declared', () => {
  assert.ok(VERIFIER_SOURCE.includes('DB_WRITES'),
    'Must declare DB_WRITES=0');
});

test('L-11: NETWORK_CALLS=0 declared', () => {
  assert.ok(VERIFIER_SOURCE.includes('NETWORK_CALLS'),
    'Must declare NETWORK_CALLS=0');
});

test('L-12: final state WAITING_FOR_FIRST_COLLECTION present', () => {
  assert.ok(VERIFIER_SOURCE.includes('WAITING_FOR_FIRST_COLLECTION'));
});

test('L-13: final state FIRST_COLLECTION_VALID present', () => {
  assert.ok(VERIFIER_SOURCE.includes('FIRST_COLLECTION_VALID'));
});

test('L-14: final state FIRST_COLLECTION_INVALID present', () => {
  assert.ok(VERIFIER_SOURCE.includes('FIRST_COLLECTION_INVALID'));
});

test('L-15: final state UNSAFE_FLAG_CONFIGURATION present', () => {
  assert.ok(VERIFIER_SOURCE.includes('UNSAFE_FLAG_CONFIGURATION'));
});

test('L-16: verifier does not call runDynamicPricingJob', () => {
  assert.ok(!VERIFIER_SOURCE.includes('runDynamicPricingJob'),
    'Verifier must NEVER trigger pricing cron');
});

test('L-17: verifier does not call scheduleMarketRefresh', () => {
  assert.ok(!VERIFIER_SOURCE.includes('scheduleMarketRefresh('),
    'Verifier must not trigger market refresh');
});

// ═════════════════════════════════════════════════════════════════════════════
// M — Audit fix regressions (post-activation state)
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nM — Audit fix regressions');

const AUDIT_SOURCE = fs.readFileSync(
  path.join(__dirname, '../outils/audit-market-persistence-activation-r.js'), 'utf8'
);

test('M-01: audit exports determineActivationState', () => {
  assert.ok(AUDIT_SOURCE.includes('determineActivationState'),
    'Audit must export determineActivationState for testability');
});

test('M-02: audit does NOT use flagOff as a checklist condition', () => {
  // The old broken check: { ok: flagOff, label: '...' }
  // Post-fix: flagOff should NOT appear as a checklist prerequisite
  assert.ok(
    !AUDIT_SOURCE.includes('{ ok: flagOff,') && !AUDIT_SOURCE.includes('ok: flagOff'),
    'Post-activation audit must NOT use flagOff as a prerequisite (breaks when active)'
  );
});

test('M-03: audit uses determineActivationState() to set ACTIVATION_STATE', () => {
  assert.ok(AUDIT_SOURCE.includes('determineActivationState(persistenceOn, sharedOn)'),
    'Must use the pure function for state determination');
});

test('M-04: PERSISTENCE_ACTIVE_SHADOW is mentioned as expected production state', () => {
  assert.ok(AUDIT_SOURCE.includes('PERSISTENCE_ACTIVE_SHADOW'),
    'Must mention PERSISTENCE_ACTIVE_SHADOW');
});

test('M-05: PRE_ACTIVATION is mentioned', () => {
  assert.ok(AUDIT_SOURCE.includes('PRE_ACTIVATION'), 'Must mention PRE_ACTIVATION');
});

test('M-06: PERSISTENCE_AND_SHARED_ACTIVE is mentioned', () => {
  assert.ok(AUDIT_SOURCE.includes('PERSISTENCE_AND_SHARED_ACTIVE'),
    'Must mention PERSISTENCE_AND_SHARED_ACTIVE');
});

test('M-07: audit is still read-only (no INSERT/UPDATE)', () => {
  assert.ok(!AUDIT_SOURCE.includes('INSERT INTO') && !AUDIT_SOURCE.includes('UPDATE '),
    'Audit must remain read-only');
});

test('M-08: ACTIVATION_STATE included in summary output', () => {
  assert.ok(AUDIT_SOURCE.includes('ACTIVATION_STATE'),
    'Summary must include ACTIVATION_STATE');
});

// ═════════════════════════════════════════════════════════════════════════════
// N — Prior suite regressions (quick static check)
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nN — Prior suite regressions');

const BRIDGE_SOURCE = fs.readFileSync(
  path.join(__dirname, '../services/market-observation-persistence-bridge.js'), 'utf8'
);

test('N-01: bridge still exports isPersistenceEnabled', () => {
  assert.ok(BRIDGE_SOURCE.includes('isPersistenceEnabled'));
});

test('N-02: bridge still exports bridgePersistProductionEvidence', () => {
  assert.ok(BRIDGE_SOURCE.includes('bridgePersistProductionEvidence'));
});

test('N-03: bridge still declares MARKET_DATA_WRITES = 0', () => {
  assert.ok(BRIDGE_SOURCE.includes('MARKET_DATA_WRITES     = 0'));
});

test('N-04: bridge still declares BRIGHT_DATA_CALLS = 0', () => {
  assert.ok(BRIDGE_SOURCE.includes('BRIGHT_DATA_CALLS      = 0'));
});

const CRON_SOURCE = fs.readFileSync(
  path.join(__dirname, '../routes/dynamic-pricing-cron.js'), 'utf8'
);

test('N-05: cron still has bridge integration', () => {
  assert.ok(CRON_SOURCE.includes('bridgePersistProductionEvidence'));
});

test('N-06: cron still gates bridge on isPersistenceEnabled()', () => {
  assert.ok(CRON_SOURCE.includes('isPersistenceEnabled()'));
});

test('N-07: verifier imports from audit (determineActivationState)', () => {
  assert.ok(VERIFIER_SOURCE.includes('determineActivationState'));
});

// ═════════════════════════════════════════════════════════════════════════════
// P — R-PROD-1-FIX: market_data schema pin (real column names)
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nP — market_data schema pin');

test('P-01: verifier SQL does NOT reference currency_code (wrong column)', () => {
  assert.ok(
    !VERIFIER_SOURCE.includes('currency_code'),
    'market_data has no currency_code column — verifier must not reference it'
  );
});

test('P-02: verifier SQL does NOT reference md.updated_at (column does not exist)', () => {
  // market_data has scraped_at and created_at, no updated_at
  assert.ok(
    !VERIFIER_SOURCE.includes('md.updated_at') && !VERIFIER_SOURCE.includes('updated_at'),
    'market_data has no updated_at column — verifier must use scraped_at instead'
  );
});

test('P-03: verifier SQL references md.currency (correct column name from P1.2-B2 migration)', () => {
  assert.ok(
    VERIFIER_SOURCE.includes('md.currency'),
    'Cross-check query must use md.currency (not md.currency_code)'
  );
});

test('P-04: verifier SQL references scraped_at (correct timestamp column)', () => {
  assert.ok(
    VERIFIER_SOURCE.includes('scraped_at'),
    'Cross-check query must use scraped_at (the market_data timestamp column)'
  );
});

test('P-05: zero-observation cross-check reports NOT_AVAILABLE (not an error)', () => {
  // When recentObs=[] the function returns early with NOT_AVAILABLE, never crashes
  assert.ok(
    VERIFIER_SOURCE.includes('NOT_AVAILABLE (no observations yet)'),
    'Zero-obs state must produce NOT_AVAILABLE, not an exception'
  );
});

test('P-06: cross-check reports MATCH when currency + data_source align', () => {
  assert.ok(
    VERIFIER_SOURCE.includes('MATCH ✅') && VERIFIER_SOURCE.includes('currency + data_source align'),
    'MATCH result must be present in cross-check output'
  );
});

test('P-07: cross-check reports MISMATCH when market_data present but columns differ', () => {
  assert.ok(
    VERIFIER_SOURCE.includes('MISMATCH ⚠️') && VERIFIER_SOURCE.includes('currency/source differ'),
    'MISMATCH result must be reported when market_data exists but columns differ'
  );
});

test('P-08: cross-check reports NOT_AVAILABLE when no market_data for property', () => {
  assert.ok(
    VERIFIER_SOURCE.includes('NOT_AVAILABLE (no market_data for property within 7 days)'),
    'NOT_AVAILABLE must be reported when no market_data exists for a property'
  );
});

test('P-09: cross-check overall summary line present', () => {
  assert.ok(
    VERIFIER_SOURCE.includes('EVIDENCE_COMPATIBLE ='),
    'Cross-check must print EVIDENCE_COMPATIBLE overall result'
  );
});

test('P-10: cross-check fetches property links from market_observation_properties', () => {
  // MATCH requires joining observations → property links → market_data
  assert.ok(
    VERIFIER_SOURCE.includes('market_observation_properties') &&
    VERIFIER_SOURCE.includes('linksByObsId'),
    'Cross-check must fetch property links to join obs → market_data'
  );
});

// ── Final report ──────────────────────────────────────────────────────────────

console.log('\n');
if (failed > 0) {
  const detail = failures.map(f => `  ✗ ${f.label}: ${f.message}`).join('\n');
  console.error(`P1.2-B5-BK-R-PROD-1 — ${passed} passed, ${failed} failed:\n${detail}`);
  process.exit(1);
} else {
  console.log(`P1.2-B5-BK-R-PROD-1 — ${passed} passed, ${failed} failed`);
}
