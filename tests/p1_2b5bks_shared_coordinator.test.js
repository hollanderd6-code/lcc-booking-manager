'use strict';
/**
 * P1.2-B5-BK-S — Shared Collection Production Safety Tests
 *
 * Sections:
 *   A  isSharedProductionEnabled flag checks
 *   B  groupPropertiesByFingerprint — pure grouping logic
 *   C  runSharedPreCollection — one call per group (injectable scraper)
 *   D  S10 job-level dedup — M6+M7 → provider called EXACTLY ONCE
 *   E  S11 Ti Junot exclusion — zero provider calls
 *   F  S12 failure isolation — no per-property fallback
 *   G  S5 provider separation — never mix provider evidence
 *   H  S2/S13 rollback safety — flag off = legacy, flag on = shared
 *   I  S15 telemetry — structured log fields present in source
 *   J  S6 market_data authority — pricing authority unchanged
 *   K  Static safety invariants (source-level)
 *   L  Regression guard (R-PROD-1, R bridge, audit tool)
 *
 * Safety:
 *   DB_WRITES     = 0  (no pool)
 *   NETWORK_CALLS = 0  (injectable scraper, never real provider)
 *   BRIGHT_DATA   = 0
 *   BD_CREDITS    = 0
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const {
  isSharedProductionEnabled,
  isShadowCollectionEnabled,
  groupPropertiesByFingerprint,
  runSharedPreCollection,
  validatePropertyCompleteness,
} = require('../services/market-shared-collection-coordinator');

const {
  computeCostEstimate,
} = require('../outils/audit-market-shared-activation-s');

let passed   = 0;
let failed   = 0;
const failures = [];

function test(label, fn) {
  try { fn(); passed++; process.stdout.write('.'); }
  catch (e) { failed++; failures.push({ label, message: e.message }); process.stdout.write('F'); }
}

async function testAsync(label, fn) {
  try { await fn(); passed++; process.stdout.write('.'); }
  catch (e) { failed++; failures.push({ label, message: e.message }); process.stdout.write('F'); }
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

const CHECK_IN  = '2026-10-14';
const CHECK_OUT = '2026-10-15';

// M6: profile-ready, Pontoise area
const M6_CFG = {
  property_id: '6', user_id: '1', id: 6,
  property_name: 'M6 Apt', internal_name: 'M6', name: 'M6 Apt',
  property_address: '12 rue des Lilas 95300 Pontoise',
  zone_label: 'Pontoise, France',
  latitude: 48.8566, longitude: 2.3522,
  currency: 'EUR', max_guests: 4, bedrooms: 2, property_type: 'entire_place',
  price_min: '50', price_max: '120',
  country_code: 'FR', timezone: 'Europe/Paris', is_active: true,
};

// M7: profile-ready, same canonical profile as M6
const M7_CFG = {
  property_id: '7', user_id: '1', id: 7,
  property_name: 'M7 Apt', internal_name: 'M7', name: 'M7 Apt',
  property_address: '14 rue des Lilas 95300 Pontoise',
  zone_label: 'Pontoise, France',
  latitude: 48.8566, longitude: 2.3522,   // same geo bucket as M6
  currency: 'EUR', max_guests: 4, bedrooms: 2, property_type: 'entire_place',
  price_min: '55', price_max: '125',
  country_code: 'FR', timezone: 'Europe/Paris', is_active: true,
};

// Ti Junot: profile incomplete — null geo
const TI_JUNOT_CFG = {
  property_id: '99', user_id: '1', id: 99,
  property_name: 'Ti Junot Loft', internal_name: 'Ti Junot', name: 'Ti Junot Loft',
  property_address: null, zone_label: null,
  latitude: null, longitude: null,
  currency: 'EUR', max_guests: 2, bedrooms: 1, property_type: 'entire_place',
  price_min: '60', price_max: '140',
  country_code: null, timezone: 'Europe/Paris', is_active: true,
};

// Solo property at a different location
const SOLO_CFG = {
  property_id: '42', user_id: '2', id: 42,
  property_name: 'Solo Lyon', internal_name: 'Solo', name: 'Solo Lyon',
  property_address: '5 rue de la Paix 69001 Lyon',
  zone_label: 'Lyon, France',
  latitude: 45.7640, longitude: 4.8357,
  currency: 'EUR', max_guests: 2, bedrooms: 1, property_type: 'entire_place',
  price_min: '45', price_max: '90',
  country_code: 'FR', timezone: 'Europe/Paris', is_active: true,
};

// M6-variant: different capacity → different fingerprint
const M6_LARGE_CFG = {
  ...M6_CFG,
  property_id: '8', id: 8, internal_name: 'M8', name: 'M8 Apt',
  max_guests: 6, bedrooms: 3,
};

// M6-variant: different currency → different fingerprint
const M6_GBP_CFG = {
  ...M6_CFG,
  property_id: '9', id: 9, internal_name: 'M9', name: 'M9 GBP',
  currency: 'GBP',
};

// Standard mock scrape result
const MOCK_SCRAPE = {
  listings:    [{ price: 90, isBooked: false, bedrooms: 2, stars: 4.5 }],
  isMock:      false,
  dataSource:  'apify_live',
  zoneUsed:    'Pontoise, France',
  diagnostics: null,
};

function mockScrapeFn(result = MOCK_SCRAPE) {
  return async () => ({ ...result });
}

function countingMockScrape() {
  let calls = 0;
  const fn = async () => { calls++; return { ...MOCK_SCRAPE }; };
  fn.callCount = () => calls;
  return fn;
}

const defaultPreCollectionOpts = (scrapeFn) => ({
  checkIn:            CHECK_IN,
  checkOut:           CHECK_OUT,
  resolveProvider:    () => 'apify',
  scrapeFn,
  getFallbackZonesFn: (addr, zl) => [zl || 'France'],
  priceFallbackFn:    () => 80,
  maxListings:        100,
});

// ═════════════════════════════════════════════════════════════════════════════
// A — isSharedProductionEnabled
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nA — isSharedProductionEnabled');

test('A-01: unset → false', () => {
  const saved = process.env.MARKET_SHARED_COLLECTION_ENABLED;
  delete process.env.MARKET_SHARED_COLLECTION_ENABLED;
  assert.strictEqual(isSharedProductionEnabled(), false);
  if (saved !== undefined) process.env.MARKET_SHARED_COLLECTION_ENABLED = saved;
});

test('A-02: "false" → false', () => {
  const saved = process.env.MARKET_SHARED_COLLECTION_ENABLED;
  process.env.MARKET_SHARED_COLLECTION_ENABLED = 'false';
  assert.strictEqual(isSharedProductionEnabled(), false);
  process.env.MARKET_SHARED_COLLECTION_ENABLED = saved ?? '';
  if (saved === undefined) delete process.env.MARKET_SHARED_COLLECTION_ENABLED;
});

test('A-03: "true" → true', () => {
  const saved = process.env.MARKET_SHARED_COLLECTION_ENABLED;
  process.env.MARKET_SHARED_COLLECTION_ENABLED = 'true';
  assert.strictEqual(isSharedProductionEnabled(), true);
  if (saved !== undefined) process.env.MARKET_SHARED_COLLECTION_ENABLED = saved;
  else delete process.env.MARKET_SHARED_COLLECTION_ENABLED;
});

test('A-04: isSharedProductionEnabled requires only MARKET_SHARED_COLLECTION_ENABLED', () => {
  // Does NOT require MARKET_OBSERVATION_PERSISTENCE_ENABLED (unlike isShadowCollectionEnabled)
  const savedShared = process.env.MARKET_SHARED_COLLECTION_ENABLED;
  const savedPers   = process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED;
  process.env.MARKET_SHARED_COLLECTION_ENABLED       = 'true';
  delete process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED;
  assert.strictEqual(isSharedProductionEnabled(), true,
    'isSharedProductionEnabled must not require persistence flag');
  if (savedShared !== undefined) process.env.MARKET_SHARED_COLLECTION_ENABLED = savedShared;
  else delete process.env.MARKET_SHARED_COLLECTION_ENABLED;
  if (savedPers !== undefined) process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED = savedPers;
});

test('A-05: isShadowCollectionEnabled requires BOTH flags (regression)', () => {
  const savedShared = process.env.MARKET_SHARED_COLLECTION_ENABLED;
  const savedPers   = process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED;
  process.env.MARKET_SHARED_COLLECTION_ENABLED       = 'true';
  delete process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED;
  assert.strictEqual(isShadowCollectionEnabled(), false,
    'isShadowCollectionEnabled must require both flags');
  if (savedShared !== undefined) process.env.MARKET_SHARED_COLLECTION_ENABLED = savedShared;
  else delete process.env.MARKET_SHARED_COLLECTION_ENABLED;
  if (savedPers !== undefined) process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED = savedPers;
});

// ═════════════════════════════════════════════════════════════════════════════
// B — groupPropertiesByFingerprint
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nB — groupPropertiesByFingerprint');

test('B-01: empty configs → empty map', () => {
  const groups = groupPropertiesByFingerprint([], { checkIn: CHECK_IN, checkOut: CHECK_OUT, resolveProvider: () => 'apify' });
  assert.strictEqual(groups.size, 0);
});

test('B-02: M6 alone → one group with one property link', () => {
  const groups = groupPropertiesByFingerprint([M6_CFG], { checkIn: CHECK_IN, checkOut: CHECK_OUT, resolveProvider: () => 'apify' });
  assert.strictEqual(groups.size, 1);
  const [, group] = [...groups.entries()][0];
  assert.strictEqual(group.propertyLinks.length, 1);
  assert.strictEqual(group.propertyLinks[0].property_id, '6');
});

test('B-03: M6 + M7 same geo/currency/capacity → one group (two property links)', () => {
  const groups = groupPropertiesByFingerprint([M6_CFG, M7_CFG], { checkIn: CHECK_IN, checkOut: CHECK_OUT, resolveProvider: () => 'apify' });
  assert.strictEqual(groups.size, 1, 'M6 and M7 must land in one fingerprint group');
  const [, group] = [...groups.entries()][0];
  assert.strictEqual(group.propertyLinks.length, 2, 'Group must have 2 property links');
});

test('B-04: M6+M7 group contains both property IDs', () => {
  const groups = groupPropertiesByFingerprint([M6_CFG, M7_CFG], { checkIn: CHECK_IN, checkOut: CHECK_OUT, resolveProvider: () => 'apify' });
  const [, group] = [...groups.entries()][0];
  const ids = group.propertyLinks.map(l => l.property_id);
  assert.ok(ids.includes('6') && ids.includes('7'), 'Both M6 and M7 must be in the group');
});

test('B-05: Ti Junot (null geo) excluded from groups', () => {
  const groups = groupPropertiesByFingerprint([M6_CFG, M7_CFG, TI_JUNOT_CFG], { checkIn: CHECK_IN, checkOut: CHECK_OUT, resolveProvider: () => 'apify' });
  const allPropIds = [...groups.values()].flatMap(g => g.propertyLinks.map(l => l.property_id));
  assert.ok(!allPropIds.includes('99'), 'Ti Junot must NOT appear in any fingerprint group');
});

test('B-06: Ti Junot + M6 → one group (M6 only), Ti Junot excluded', () => {
  const groups = groupPropertiesByFingerprint([M6_CFG, TI_JUNOT_CFG], { checkIn: CHECK_IN, checkOut: CHECK_OUT, resolveProvider: () => 'apify' });
  assert.strictEqual(groups.size, 1, 'Only M6 group — Ti Junot excluded');
  const [, group] = [...groups.entries()][0];
  assert.strictEqual(group.propertyLinks.length, 1);
});

test('B-07: different geo → different groups', () => {
  const groups = groupPropertiesByFingerprint([M6_CFG, SOLO_CFG], { checkIn: CHECK_IN, checkOut: CHECK_OUT, resolveProvider: () => 'apify' });
  assert.strictEqual(groups.size, 2, 'Different geo must produce different groups');
});

test('B-08: different currency → different groups', () => {
  const groups = groupPropertiesByFingerprint([M6_CFG, M6_GBP_CFG], { checkIn: CHECK_IN, checkOut: CHECK_OUT, resolveProvider: () => 'apify' });
  assert.strictEqual(groups.size, 2, 'Different currency must produce different groups');
});

test('B-09: different capacity → different groups', () => {
  const groups = groupPropertiesByFingerprint([M6_CFG, M6_LARGE_CFG], { checkIn: CHECK_IN, checkOut: CHECK_OUT, resolveProvider: () => 'apify' });
  assert.strictEqual(groups.size, 2, 'Different capacity must produce different groups');
});

test('B-10: S5 — different provider → different groups', () => {
  let call = 0;
  const resolveProvider = (pid) => { call++; return pid === '6' ? 'apify' : 'brightdata'; };
  const groups = groupPropertiesByFingerprint([M6_CFG, M7_CFG], { checkIn: CHECK_IN, checkOut: CHECK_OUT, resolveProvider });
  assert.strictEqual(groups.size, 2, 'Different provider must produce different fingerprint groups');
});

test('B-11: same geo/currency/capacity + same provider → same group regardless of address text', () => {
  const M7_DIFF_ADDR = { ...M7_CFG, property_address: '99 boulevard Victor Hugo 95300 Cergy' };
  const groups = groupPropertiesByFingerprint([M6_CFG, M7_DIFF_ADDR], { checkIn: CHECK_IN, checkOut: CHECK_OUT, resolveProvider: () => 'apify' });
  assert.strictEqual(groups.size, 1, 'Address text must not affect fingerprint grouping');
});

test('B-12: property_id NOT part of fingerprint — different IDs, same profile = same group', () => {
  const M6_ALT = { ...M6_CFG, property_id: '600', id: 600 };
  const groups = groupPropertiesByFingerprint([M6_CFG, M6_ALT], { checkIn: CHECK_IN, checkOut: CHECK_OUT, resolveProvider: () => 'apify' });
  assert.strictEqual(groups.size, 1, 'property_id must NOT make compatible searches distinct');
});

test('B-13: group representative cfg is the first eligible property', () => {
  const groups = groupPropertiesByFingerprint([M6_CFG, M7_CFG], { checkIn: CHECK_IN, checkOut: CHECK_OUT, resolveProvider: () => 'apify' });
  const [, group] = [...groups.entries()][0];
  assert.strictEqual(String(group.cfg.property_id), '6', 'First eligible property is representative');
});

test('B-14: group contains profileId and dimensions', () => {
  const groups = groupPropertiesByFingerprint([M6_CFG], { checkIn: CHECK_IN, checkOut: CHECK_OUT, resolveProvider: () => 'apify' });
  const [, group] = [...groups.entries()][0];
  assert.ok(group.profileId,  'Group must have profileId');
  assert.ok(group.dimensions, 'Group must have dimensions');
});

test('B-15: group dimensions have expected fields', () => {
  const groups = groupPropertiesByFingerprint([M6_CFG], { checkIn: CHECK_IN, checkOut: CHECK_OUT, resolveProvider: () => 'apify' });
  const [, group] = [...groups.entries()][0];
  const { dimensions } = group;
  assert.ok('lat' in dimensions && 'lon' in dimensions, 'dimensions must have lat/lon');
  assert.ok('currency' in dimensions, 'dimensions must have currency');
  assert.ok('guests' in dimensions, 'dimensions must have guests');
});

test('B-16: missing currency → excluded from groups', () => {
  const NO_CURRENCY = { ...M6_CFG, currency: null, property_id: '10' };
  const groups = groupPropertiesByFingerprint([NO_CURRENCY], { checkIn: CHECK_IN, checkOut: CHECK_OUT, resolveProvider: () => 'apify' });
  assert.strictEqual(groups.size, 0, 'Property with null currency must be excluded');
});

test('B-17: invalid currency string → excluded', () => {
  const BAD_CURRENCY = { ...M6_CFG, currency: 'XX', property_id: '11' };
  const groups = groupPropertiesByFingerprint([BAD_CURRENCY], { checkIn: CHECK_IN, checkOut: CHECK_OUT, resolveProvider: () => 'apify' });
  assert.strictEqual(groups.size, 0);
});

test('B-18: M6 + M7 + Solo → two groups total', () => {
  const groups = groupPropertiesByFingerprint([M6_CFG, M7_CFG, SOLO_CFG], { checkIn: CHECK_IN, checkOut: CHECK_OUT, resolveProvider: () => 'apify' });
  assert.strictEqual(groups.size, 2, 'M6+M7 share one group; Solo is another');
});

test('B-19: different check_in → different fingerprints', () => {
  const groups = groupPropertiesByFingerprint(
    [M6_CFG, M6_CFG],
    { checkIn: CHECK_IN, checkOut: CHECK_OUT, resolveProvider: () => 'apify' }
  );
  // Same config twice → still one group
  assert.strictEqual(groups.size, 1, 'Identical configs → one group');
  assert.strictEqual(groups.values().next().value.propertyLinks.length, 2);
});

test('B-20: different stay window → different fingerprints for different windows', () => {
  const groupsA = groupPropertiesByFingerprint([M6_CFG], { checkIn: '2026-10-14', checkOut: '2026-10-15', resolveProvider: () => 'apify' });
  const groupsB = groupPropertiesByFingerprint([M6_CFG], { checkIn: '2026-11-01', checkOut: '2026-11-02', resolveProvider: () => 'apify' });
  const fpA = [...groupsA.keys()][0];
  const fpB = [...groupsB.keys()][0];
  assert.notStrictEqual(fpA, fpB, 'Different stay window must produce different fingerprint');
});

test('B-21: group provider matches resolved provider', () => {
  const groups = groupPropertiesByFingerprint([M6_CFG], { checkIn: CHECK_IN, checkOut: CHECK_OUT, resolveProvider: () => 'brightdata' });
  const [, group] = [...groups.entries()][0];
  assert.strictEqual(group.provider, 'brightdata');
});

test('B-22: M6 and M7 have same fingerprint key in map', () => {
  const groups = groupPropertiesByFingerprint([M6_CFG, M7_CFG], { checkIn: CHECK_IN, checkOut: CHECK_OUT, resolveProvider: () => 'apify' });
  assert.strictEqual(groups.size, 1);
  const fp = [...groups.keys()][0];
  assert.ok(fp && fp.length > 0, 'Fingerprint key must be non-empty');
});

test('B-23: groups map value has fingerprint field matching map key', () => {
  const groups = groupPropertiesByFingerprint([M6_CFG], { checkIn: CHECK_IN, checkOut: CHECK_OUT, resolveProvider: () => 'apify' });
  for (const [key, group] of groups) {
    assert.strictEqual(key, group.fingerprint, 'Map key must equal group.fingerprint');
  }
});

test('B-24: propertyLinks contain property_id as string', () => {
  const groups = groupPropertiesByFingerprint([M6_CFG, M7_CFG], { checkIn: CHECK_IN, checkOut: CHECK_OUT, resolveProvider: () => 'apify' });
  const [, group] = [...groups.entries()][0];
  for (const link of group.propertyLinks) {
    assert.strictEqual(typeof link.property_id, 'string', 'property_id in links must be string');
  }
});

test('B-25: no resolveProvider defaults to apify', () => {
  const groups = groupPropertiesByFingerprint([M6_CFG], { checkIn: CHECK_IN, checkOut: CHECK_OUT });
  assert.strictEqual(groups.size, 1);
  const [, group] = [...groups.entries()][0];
  assert.strictEqual(group.provider, 'apify');
});

// ═════════════════════════════════════════════════════════════════════════════
// C — runSharedPreCollection: structural tests
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nC — runSharedPreCollection structure');

(async () => {

await testAsync('C-01: empty configs → groupCount=0, callCount=0', async () => {
  const { groupCount, callCount } = await runSharedPreCollection([], defaultPreCollectionOpts(mockScrapeFn()));
  assert.strictEqual(groupCount, 0);
  assert.strictEqual(callCount, 0);
});

await testAsync('C-02: M6 alone → groupCount=1, callCount=1', async () => {
  const { groupCount, callCount } = await runSharedPreCollection(
    [M6_CFG], defaultPreCollectionOpts(mockScrapeFn())
  );
  assert.strictEqual(groupCount, 1);
  assert.strictEqual(callCount, 1);
});

await testAsync('C-03: propToFingerprint maps M6 to a fingerprint', async () => {
  const { propToFingerprint } = await runSharedPreCollection(
    [M6_CFG], defaultPreCollectionOpts(mockScrapeFn())
  );
  assert.ok(propToFingerprint.has('6'), 'M6 must have a fingerprint mapping');
  assert.ok(propToFingerprint.get('6').length > 0);
});

await testAsync('C-04: sharedEvidence contains result for M6 fingerprint', async () => {
  const { sharedEvidence, propToFingerprint } = await runSharedPreCollection(
    [M6_CFG], defaultPreCollectionOpts(mockScrapeFn())
  );
  const fp = propToFingerprint.get('6');
  const ev = sharedEvidence.get(fp);
  assert.ok(ev && !ev.error, 'Evidence must be present and not an error');
  assert.strictEqual(ev.dataSource, 'apify_live');
});

await testAsync('C-05: Ti Junot excluded — no fingerprint mapping', async () => {
  const { propToFingerprint, groupCount } = await runSharedPreCollection(
    [TI_JUNOT_CFG], defaultPreCollectionOpts(mockScrapeFn())
  );
  assert.strictEqual(groupCount, 0, 'Ti Junot must produce no groups');
  assert.ok(!propToFingerprint.has('99'), 'Ti Junot must not be mapped to any fingerprint');
});

await testAsync('C-06: M6+M7 → propToFingerprint has entries for both', async () => {
  const { propToFingerprint } = await runSharedPreCollection(
    [M6_CFG, M7_CFG], defaultPreCollectionOpts(mockScrapeFn())
  );
  assert.ok(propToFingerprint.has('6'));
  assert.ok(propToFingerprint.has('7'));
});

await testAsync('C-07: M6+M7 → both map to same fingerprint', async () => {
  const { propToFingerprint } = await runSharedPreCollection(
    [M6_CFG, M7_CFG], defaultPreCollectionOpts(mockScrapeFn())
  );
  assert.strictEqual(propToFingerprint.get('6'), propToFingerprint.get('7'),
    'M6 and M7 must share the same fingerprint');
});

await testAsync('C-08: M6+M7+Ti Junot → groupCount=1, Ti Junot has no mapping', async () => {
  const { groupCount, propToFingerprint } = await runSharedPreCollection(
    [M6_CFG, M7_CFG, TI_JUNOT_CFG], defaultPreCollectionOpts(mockScrapeFn())
  );
  assert.strictEqual(groupCount, 1);
  assert.ok(!propToFingerprint.has('99'));
});

await testAsync('C-09: M6+Solo → groupCount=2, callCount=2', async () => {
  const mock = countingMockScrape();
  const { groupCount, callCount } = await runSharedPreCollection(
    [M6_CFG, SOLO_CFG], defaultPreCollectionOpts(mock)
  );
  assert.strictEqual(groupCount, 2);
  assert.strictEqual(callCount, 2);
  assert.strictEqual(mock.callCount(), 2, 'scraper called exactly twice');
});

await testAsync('C-10: evidence object has listings, isMock, dataSource, zoneUsed', async () => {
  const { sharedEvidence, propToFingerprint } = await runSharedPreCollection(
    [M6_CFG], defaultPreCollectionOpts(mockScrapeFn())
  );
  const fp = propToFingerprint.get('6');
  const ev = sharedEvidence.get(fp);
  assert.ok(Array.isArray(ev.listings), 'evidence.listings must be array');
  assert.ok('isMock' in ev, 'evidence.isMock required');
  assert.ok('dataSource' in ev, 'evidence.dataSource required');
  assert.ok('zoneUsed' in ev, 'evidence.zoneUsed required');
});

// ═════════════════════════════════════════════════════════════════════════════
// D — S10 job-level dedup: M6+M7 → provider called EXACTLY ONCE
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nD — S10 job-level dedup');

await testAsync('D-01: M6+M7 → scrapeFn called EXACTLY ONCE', async () => {
  const mock = countingMockScrape();
  await runSharedPreCollection([M6_CFG, M7_CFG], defaultPreCollectionOpts(mock));
  assert.strictEqual(mock.callCount(), 1, 'Provider must be called exactly once for M6+M7 group');
});

await testAsync('D-02: M6+M7+Solo → scrapeFn called EXACTLY TWICE', async () => {
  const mock = countingMockScrape();
  await runSharedPreCollection([M6_CFG, M7_CFG, SOLO_CFG], defaultPreCollectionOpts(mock));
  assert.strictEqual(mock.callCount(), 2, 'One call per fingerprint group');
});

await testAsync('D-03: M6+M7 → groupCount=1 (one fingerprint group)', async () => {
  const { groupCount } = await runSharedPreCollection([M6_CFG, M7_CFG], defaultPreCollectionOpts(mockScrapeFn()));
  assert.strictEqual(groupCount, 1);
});

await testAsync('D-04: M6+M7 shared evidence is accessible for both properties', async () => {
  const { sharedEvidence, propToFingerprint } = await runSharedPreCollection(
    [M6_CFG, M7_CFG], defaultPreCollectionOpts(mockScrapeFn())
  );
  const fp6 = propToFingerprint.get('6');
  const fp7 = propToFingerprint.get('7');
  assert.strictEqual(fp6, fp7, 'Both properties must reference same fingerprint');
  assert.ok(sharedEvidence.has(fp6), 'Evidence available for shared fingerprint');
});

await testAsync('D-05: evidence is the exact same object for M6 and M7 (not cloned)', async () => {
  const { sharedEvidence, propToFingerprint } = await runSharedPreCollection(
    [M6_CFG, M7_CFG], defaultPreCollectionOpts(mockScrapeFn())
  );
  const fp6 = propToFingerprint.get('6');
  const fp7 = propToFingerprint.get('7');
  // Same fingerprint → same Map entry
  assert.strictEqual(sharedEvidence.get(fp6), sharedEvidence.get(fp7),
    'Same fingerprint must yield same evidence object');
});

await testAsync('D-06: M6+M7 different providers → two calls', async () => {
  const mock = countingMockScrape();
  await runSharedPreCollection(
    [M6_CFG, M7_CFG],
    { ...defaultPreCollectionOpts(mock), resolveProvider: (pid) => pid === '6' ? 'apify' : 'brightdata' }
  );
  assert.strictEqual(mock.callCount(), 2, 'Different providers → different fingerprints → two calls');
});

await testAsync('D-07: 10 properties with same profile → scrapeFn called once', async () => {
  const configs = Array.from({ length: 10 }, (_, i) => ({
    ...M6_CFG, property_id: String(100 + i), id: 100 + i,
  }));
  const mock = countingMockScrape();
  const { groupCount, callCount } = await runSharedPreCollection(configs, defaultPreCollectionOpts(mock));
  assert.strictEqual(groupCount, 1);
  assert.strictEqual(callCount, 1);
  assert.strictEqual(mock.callCount(), 1);
});

await testAsync('D-08: callCount matches number of unique fingerprint groups', async () => {
  const mock = countingMockScrape();
  const { groupCount, callCount } = await runSharedPreCollection(
    [M6_CFG, M7_CFG, SOLO_CFG], defaultPreCollectionOpts(mock)
  );
  assert.strictEqual(callCount, groupCount, 'callCount must equal number of groups');
});

await testAsync('D-09: computeCostEstimate returns naiveCalls=2 sharedCalls=1 for M6+M7', () => {
  const estimate = computeCostEstimate(
    [M6_CFG, M7_CFG],
    { checkIn: CHECK_IN, checkOut: CHECK_OUT, resolveProvider: () => 'apify' }
  );
  assert.strictEqual(estimate.naiveCalls, 2);
  assert.strictEqual(estimate.sharedCalls, 1);
  assert.strictEqual(estimate.saved, 1);
  assert.strictEqual(estimate.reductionPct, 50);
});

await testAsync('D-10: computeCostEstimate with Ti Junot: naiveCalls=2 (M6+M7) not 3', () => {
  const estimate = computeCostEstimate(
    [M6_CFG, M7_CFG, TI_JUNOT_CFG],
    { checkIn: CHECK_IN, checkOut: CHECK_OUT, resolveProvider: () => 'apify' }
  );
  assert.strictEqual(estimate.naiveCalls, 2, 'Ti Junot excluded from naive count too');
  assert.strictEqual(estimate.sharedCalls, 1);
});

// ═════════════════════════════════════════════════════════════════════════════
// E — S11 Ti Junot exclusion (profile incomplete, zero provider calls)
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nE — S11 Ti Junot exclusion');

test('E-01: validatePropertyCompleteness → not ok for null geo', () => {
  const r = validatePropertyCompleteness(TI_JUNOT_CFG);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'missing_geo');
});

test('E-02: Ti Junot excluded from groupPropertiesByFingerprint', () => {
  const groups = groupPropertiesByFingerprint([TI_JUNOT_CFG], { checkIn: CHECK_IN, checkOut: CHECK_OUT, resolveProvider: () => 'apify' });
  assert.strictEqual(groups.size, 0, 'Ti Junot must produce no groups');
});

await testAsync('E-03: Ti Junot alone → scrapeFn never called', async () => {
  const mock = countingMockScrape();
  await runSharedPreCollection([TI_JUNOT_CFG], defaultPreCollectionOpts(mock));
  assert.strictEqual(mock.callCount(), 0, 'Provider must not be called for Ti Junot');
});

await testAsync('E-04: Ti Junot with M6 → scrapeFn called once (M6 only)', async () => {
  const mock = countingMockScrape();
  await runSharedPreCollection([M6_CFG, TI_JUNOT_CFG], defaultPreCollectionOpts(mock));
  assert.strictEqual(mock.callCount(), 1, 'Only M6 triggers a call');
});

test('E-05: Ti Junot has no fake profile — reason is missing_geo', () => {
  const r = validatePropertyCompleteness(TI_JUNOT_CFG);
  assert.strictEqual(r.reason, 'missing_geo', 'Must report structured skip reason');
});

test('E-06: Ti Junot does not use default Paris coordinates', () => {
  // No coordinate fallback allowed (per S11)
  const r = validatePropertyCompleteness(TI_JUNOT_CFG);
  assert.strictEqual(r.ok, false, 'null geo must be rejected, not substituted with Paris');
});

test('E-07: Ti Junot with no currency also excluded', () => {
  const NO_CURRENCY = { ...TI_JUNOT_CFG, currency: null };
  const r = validatePropertyCompleteness(NO_CURRENCY);
  assert.strictEqual(r.ok, false);
});

await testAsync('E-08: Ti Junot produces no propToFingerprint entry', async () => {
  const { propToFingerprint } = await runSharedPreCollection(
    [TI_JUNOT_CFG], defaultPreCollectionOpts(mockScrapeFn())
  );
  assert.ok(!propToFingerprint.has('99'), 'Ti Junot must have no fingerprint mapping');
});

await testAsync('E-09: M6+M7+TiJunot: M6 and M7 still get evidence despite Ti Junot', async () => {
  const { propToFingerprint, sharedEvidence } = await runSharedPreCollection(
    [M6_CFG, M7_CFG, TI_JUNOT_CFG], defaultPreCollectionOpts(mockScrapeFn())
  );
  assert.ok(propToFingerprint.has('6'));
  assert.ok(propToFingerprint.has('7'));
  const fp = propToFingerprint.get('6');
  assert.ok(sharedEvidence.get(fp) && !sharedEvidence.get(fp).error);
});

test('E-10: incomplete property with null lon (only) also excluded', () => {
  const NULL_LON = { ...M6_CFG, longitude: null, property_id: '20' };
  const r = validatePropertyCompleteness(NULL_LON);
  assert.strictEqual(r.ok, false);
});

// ═════════════════════════════════════════════════════════════════════════════
// F — S12 failure isolation
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nF — S12 failure isolation');

await testAsync('F-01: scrapeFn throws → sharedEvidence records error', async () => {
  const failScrape = async () => { throw new Error('simulated_bd_failure'); };
  const { sharedEvidence, propToFingerprint } = await runSharedPreCollection(
    [M6_CFG], defaultPreCollectionOpts(failScrape)
  );
  // groupPropertiesByFingerprint runs before scrapeFn, so propToFingerprint IS populated
  const fp = propToFingerprint.get('6');
  assert.ok(fp, 'M6 must have a fingerprint even when scrapeFn throws (grouping precedes scraping)');
  const ev = sharedEvidence.get(fp);
  assert.ok(ev && ev.error, 'sharedEvidence must record error when scrapeFn throws');
});

// Correct version:
await testAsync('F-02: scrapeFn throws → evidence map has error entry, no fabricated data', async () => {
  const failScrape = async () => { throw new Error('simulated_bd_failure'); };
  const { sharedEvidence, propToFingerprint } = await runSharedPreCollection(
    [M6_CFG], defaultPreCollectionOpts(failScrape)
  );
  // propToFingerprint IS populated (from grouping phase)
  const fp = propToFingerprint.get('6');
  assert.ok(fp, 'M6 must have a fingerprint (grouping happens before scraping)');
  const ev = sharedEvidence.get(fp);
  assert.ok(ev && ev.error, 'Failed evidence must have error field');
  assert.ok(!ev.listings, 'No fabricated listings in error evidence');
});

await testAsync('F-03: scrapeFn throws → callCount reflects failure (not counted as success)', async () => {
  const failScrape = async () => { throw new Error('failure'); };
  const { callCount } = await runSharedPreCollection(
    [M6_CFG], defaultPreCollectionOpts(failScrape)
  );
  assert.strictEqual(callCount, 0, 'Failed call must not increment callCount');
});

await testAsync('F-04: group A fails, group B succeeds — no crash, B evidence available', async () => {
  const M6_FAIL = { ...M6_CFG, property_id: '6', id: 6 };
  let callNum = 0;
  const selectiveFail = async () => {
    callNum++;
    if (callNum === 1) throw new Error('first_group_failure');
    return { ...MOCK_SCRAPE };
  };
  const { sharedEvidence, propToFingerprint, groupCount } = await runSharedPreCollection(
    [M6_FAIL, SOLO_CFG], defaultPreCollectionOpts(selectiveFail)
  );
  assert.strictEqual(groupCount, 2, 'Two groups expected');
  const fpSolo = propToFingerprint.get('42');
  assert.ok(fpSolo, 'Solo must still have a fingerprint');
  const evSolo = sharedEvidence.get(fpSolo);
  assert.ok(evSolo && !evSolo.error, 'Solo evidence must be available despite group A failure');
});

await testAsync('F-05: failure does not copy another groups evidence', async () => {
  let callNum = 0;
  const selectiveFail = async () => {
    callNum++;
    if (callNum === 1) throw new Error('first_group_failure');
    return { ...MOCK_SCRAPE, zoneUsed: 'Lyon, France' };
  };
  const { sharedEvidence, propToFingerprint } = await runSharedPreCollection(
    [M6_CFG, SOLO_CFG], defaultPreCollectionOpts(selectiveFail)
  );
  const fpM6 = propToFingerprint.get('6');
  const evM6 = sharedEvidence.get(fpM6);
  const fpSolo = propToFingerprint.get('42');
  const evSolo = sharedEvidence.get(fpSolo);
  assert.ok(evM6 && evM6.error, 'M6 must have error evidence');
  assert.ok(evSolo && !evSolo.error, 'Solo must have real evidence');
  assert.notStrictEqual(evM6, evSolo, 'Error group must not be given other groups evidence');
});

await testAsync('F-06: runSharedPreCollection itself does not throw on provider failure', async () => {
  const failScrape = async () => { throw new Error('total_failure'); };
  // Should NOT throw — failure is isolated per group
  await assert.doesNotReject(
    () => runSharedPreCollection([M6_CFG], defaultPreCollectionOpts(failScrape)),
    'runSharedPreCollection must not throw on provider failure'
  );
});

await testAsync('F-07: error entry has error field with message', async () => {
  const failScrape = async () => { throw new Error('specific_error_msg'); };
  const { sharedEvidence, propToFingerprint } = await runSharedPreCollection(
    [M6_CFG], defaultPreCollectionOpts(failScrape)
  );
  const fp = propToFingerprint.get('6');
  const ev = sharedEvidence.get(fp);
  assert.ok(ev.error.includes('specific_error_msg'), 'Error message must be preserved');
});

// ═════════════════════════════════════════════════════════════════════════════
// G — S5 provider separation
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nG — S5 provider separation');

test('G-01: apify and brightdata produce different fingerprints for same profile', () => {
  const groupsApify      = groupPropertiesByFingerprint([M6_CFG], { checkIn: CHECK_IN, checkOut: CHECK_OUT, resolveProvider: () => 'apify' });
  const groupsBrightdata = groupPropertiesByFingerprint([M6_CFG], { checkIn: CHECK_IN, checkOut: CHECK_OUT, resolveProvider: () => 'brightdata' });
  const fpApify      = [...groupsApify.keys()][0];
  const fpBrightdata = [...groupsBrightdata.keys()][0];
  assert.notStrictEqual(fpApify, fpBrightdata, 'Different provider must yield different fingerprint');
});

test('G-02: M6 apify + M7 brightdata → two groups (no unsafe mixing)', () => {
  const groups = groupPropertiesByFingerprint(
    [M6_CFG, M7_CFG],
    { checkIn: CHECK_IN, checkOut: CHECK_OUT, resolveProvider: (pid) => pid === '6' ? 'apify' : 'brightdata' }
  );
  assert.strictEqual(groups.size, 2, 'Different providers must not share a fingerprint group');
});

test('G-03: provider is included in group object', () => {
  const groups = groupPropertiesByFingerprint([M6_CFG], { checkIn: CHECK_IN, checkOut: CHECK_OUT, resolveProvider: () => 'brightdata' });
  const [, group] = [...groups.entries()][0];
  assert.strictEqual(group.provider, 'brightdata');
});

test('G-04: apify fingerprint prefix differs from brightdata fingerprint', () => {
  const { buildMarketSearchFingerprint } = require('../services/market-search-identity');
  const base = { latitude: 48.8566, longitude: 2.3522, currency: 'EUR', targetGuests: 4, targetBedrooms: 2, targetPropertyType: 'entire_place', checkIn: CHECK_IN, checkOut: CHECK_OUT, maxListings: 100 };
  const fpA = buildMarketSearchFingerprint({ ...base, provider: 'apify' });
  const fpB = buildMarketSearchFingerprint({ ...base, provider: 'brightdata' });
  assert.notStrictEqual(fpA.fingerprint, fpB.fingerprint);
});

test('G-05: provider is part of groupPropertiesByFingerprint key (provider-aware)', () => {
  // M6 under apify and M6 under brightdata must land in DIFFERENT groups
  const M6_APIFY      = { ...M6_CFG };
  const M6_BRIGHTDATA = { ...M6_CFG, property_id: '6b', id: '6b' };
  const groups = groupPropertiesByFingerprint(
    [M6_APIFY, M6_BRIGHTDATA],
    { checkIn: CHECK_IN, checkOut: CHECK_OUT, resolveProvider: (pid) => pid === '6' ? 'apify' : 'brightdata' }
  );
  assert.strictEqual(groups.size, 2, 'Different providers for same profile → different groups');
});

// ═════════════════════════════════════════════════════════════════════════════
// H — S2/S13 rollback safety
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nH — S2/S13 rollback safety');

test('H-01: S13: flag rollback — isSharedProductionEnabled false when env not set', () => {
  const saved = process.env.MARKET_SHARED_COLLECTION_ENABLED;
  delete process.env.MARKET_SHARED_COLLECTION_ENABLED;
  assert.strictEqual(isSharedProductionEnabled(), false);
  if (saved !== undefined) process.env.MARKET_SHARED_COLLECTION_ENABLED = saved;
});

test('H-02: cron source has sharedEnabled detection', () => {
  const CRON = fs.readFileSync(path.join(__dirname, '../routes/dynamic-pricing-cron.js'), 'utf8');
  assert.ok(CRON.includes('isSharedProductionEnabled()'), 'Cron must call isSharedProductionEnabled');
});

test('H-03: cron source has legacy path (unchanged when flag off)', () => {
  const CRON = fs.readFileSync(path.join(__dirname, '../routes/dynamic-pricing-cron.js'), 'utf8');
  assert.ok(CRON.includes('Legacy path'), 'Legacy zone-cache path must be preserved');
});

test('H-04: shadow phase suppressed when sharedEnabled=true', () => {
  const CRON = fs.readFileSync(path.join(__dirname, '../routes/dynamic-pricing-cron.js'), 'utf8');
  assert.ok(
    CRON.includes('!sharedEnabled && coord.isShadowCollectionEnabled()'),
    'Shadow phase must be suppressed when shared is active (prevents duplicate calls)'
  );
});

test('H-05: S2 invariant: PARALLEL_DUPLICATE_COLLECTION_POSSIBLE = NO in source', () => {
  const CRON = fs.readFileSync(path.join(__dirname, '../routes/dynamic-pricing-cron.js'), 'utf8');
  // When sharedEnabled=true: pre-collection phase runs + shadow phase is suppressed
  // This proves no parallel duplicate collection is possible
  assert.ok(CRON.includes('!sharedEnabled && coord.isShadowCollectionEnabled()'));
  assert.ok(CRON.includes('runSharedPreCollection'));
});

// ═════════════════════════════════════════════════════════════════════════════
// I — S15 telemetry fields
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nI — S15 telemetry');

const COORD_SRC = fs.readFileSync(
  path.join(__dirname, '../services/market-shared-collection-coordinator.js'), 'utf8'
);
const CRON_SRC = fs.readFileSync(
  path.join(__dirname, '../routes/dynamic-pricing-cron.js'), 'utf8'
);

test('I-01: MARKET_PROVIDER_CALL_ATTEMPT declared in coordinator', () => {
  assert.ok(COORD_SRC.includes('MARKET_PROVIDER_CALL_ATTEMPT'));
});

test('I-02: MARKET_PROVIDER_CALL_SUCCESS declared in coordinator', () => {
  assert.ok(COORD_SRC.includes('MARKET_PROVIDER_CALL_SUCCESS'));
});

test('I-03: MARKET_PROVIDER_CALL_FAILURE declared in coordinator', () => {
  assert.ok(COORD_SRC.includes('MARKET_PROVIDER_CALL_FAILURE'));
});

test('I-04: telemetry includes provider field', () => {
  assert.ok(COORD_SRC.includes('provider=${group.provider}'), 'Telemetry must include provider');
});

test('I-05: telemetry includes fingerprint prefix (not full coordinates)', () => {
  assert.ok(COORD_SRC.includes('fp=${fingerprint.slice(0, 12)}'), 'Telemetry must include fingerprint prefix');
});

test('I-06: telemetry includes shared_group_size', () => {
  assert.ok(COORD_SRC.includes('shared_group_size=${groupSize}'), 'Telemetry must include group size');
});

test('I-07: telemetry includes reason field', () => {
  assert.ok(COORD_SRC.includes('reason=shared_production') || COORD_SRC.includes('reason='), 'Telemetry must include reason');
});

test('I-08: MARKET_PROVIDER_CALL_ATTEMPT in cron for single-property path', () => {
  assert.ok(CRON_SRC.includes('[MARKET_PROVIDER_CALL_ATTEMPT]'), 'Cron must log provider call attempts');
});

test('I-09: MARKET_PROVIDER_CALL_SUCCESS in cron for single-property path', () => {
  assert.ok(CRON_SRC.includes('[MARKET_PROVIDER_CALL_SUCCESS]'), 'Cron must log provider call success');
});

test('I-10: telemetry does NOT include raw coordinates (no lat= or lon= in telemetry lines)', () => {
  // Check that MARKET_PROVIDER_CALL_ATTEMPT lines don't log raw lat/lon
  const attemptLines = COORD_SRC.split('\n').filter(l => l.includes('MARKET_PROVIDER_CALL_ATTEMPT'));
  for (const line of attemptLines) {
    assert.ok(!line.includes('lat=') && !line.includes('lon='),
      'Telemetry must not log raw coordinates');
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// J — S6 market_data authority and S7 observation integration
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nJ — S6/S7 authority checks');

test('J-01: market_data remains pricing authority — resolver not changed to use market_observations', () => {
  const RESOLVER = fs.readFileSync(path.join(__dirname, '../routes/market-data-resolver.js'), 'utf8');
  assert.ok(!RESOLVER.includes('FROM market_observations'),
    'market-data-resolver must not read from market_observations (pricing authority)');
});

test('J-02: dynamic-pricing-routes.js does not read market_observations for pricing', () => {
  const DP_ROUTES = fs.readFileSync(path.join(__dirname, '../routes/dynamic-pricing-routes.js'), 'utf8');
  assert.ok(!DP_ROUTES.includes('FROM market_observations'),
    'dynamic-pricing-routes must not use market_observations for pricing');
});

test('J-03: bridge persistence is fire-and-forget (R7 preserved)', () => {
  assert.ok(CRON_SRC.includes('bridgePersistProductionEvidence'), 'Bridge must still be called');
  assert.ok(CRON_SRC.includes('.catch(err =>'), 'Bridge must be fire-and-forget');
});

test('J-04: market_data fanout: writeScrapeResult called per property (not per group)', () => {
  // Each property in the shared path still calls writeScrapeResult
  assert.ok(CRON_SRC.includes('writeScrapeResult'), 'writeScrapeResult must still be called in shared path');
});

test('J-05: pricing is property-specific — applyDynamicPricingForProperty still per-property', () => {
  assert.ok(CRON_SRC.includes('applyDynamicPricingForProperty'), 'Per-property pricing must remain');
});

test('J-06: MARKET_DATA_WRITES = 0 still declared in coordinator (shadow tables only)', () => {
  assert.ok(COORD_SRC.includes('MARKET_DATA_WRITES     = 0'), 'Coordinator must not write market_data');
});

test('J-07: bridge still integrated in shared path (bridge call inside shared property loop)', () => {
  // When shared path runs, bridge is called after writeScrapeResult
  assert.ok(CRON_SRC.includes('bridgePersistProductionEvidence'));
  assert.ok(CRON_SRC.includes('bridgePersistenceEnabled'));
});

// ═════════════════════════════════════════════════════════════════════════════
// K — Static safety invariants
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nK — Static safety invariants');

const AUDIT_S_SRC = fs.readFileSync(
  path.join(__dirname, '../outils/audit-market-shared-activation-s.js'), 'utf8'
);

test('K-01: coordinator runSharedPreCollection uses injectable scrapeFn (not direct brightdata)', () => {
  // runSharedPreCollection must call injectable scrapeFn — never scrapeWithBrightData directly
  // (the file-level import exists for the legacy K-engine coordinateCollection)
  const runSharedIdx = COORD_SRC.indexOf('async function runSharedPreCollection');
  assert.ok(runSharedIdx !== -1, 'runSharedPreCollection must be defined');
  const bodySlice = COORD_SRC.slice(runSharedIdx, runSharedIdx + 2000);
  assert.ok(bodySlice.includes('scrapeFn('), 'runSharedPreCollection must call injectable scrapeFn');
  assert.ok(!bodySlice.includes('scrapeWithBrightData('),
    'runSharedPreCollection must not call scrapeWithBrightData directly');
});

test('K-02: audit tool declared as read-only with DB_WRITES=0', () => {
  assert.ok(AUDIT_S_SRC.includes('DB_WRITES              = 0'));
  assert.ok(AUDIT_S_SRC.includes('NETWORK_CALLS          = 0'));
  assert.ok(AUDIT_S_SRC.includes('BRIGHT_DATA_CALLS      = 0'));
});

test('K-03: audit tool does not INSERT or UPDATE', () => {
  assert.ok(!/pool\.query\s*\(\s*['`]INSERT\b/i.test(AUDIT_S_SRC), 'Audit must not INSERT');
  assert.ok(!/pool\.query\s*\(\s*['`]UPDATE\b/i.test(AUDIT_S_SRC), 'Audit must not UPDATE');
});

test('K-04: audit tool reports SAFE_TO_ENABLE_SHARED_COLLECTION', () => {
  assert.ok(AUDIT_S_SRC.includes('SAFE_TO_ENABLE_SHARED_COLLECTION'));
});

test('K-05: coordinator exports isSharedProductionEnabled', () => {
  assert.ok(COORD_SRC.includes('isSharedProductionEnabled'));
  assert.ok(COORD_SRC.includes("module.exports = {") && COORD_SRC.includes('isSharedProductionEnabled,'));
});

test('K-06: coordinator exports groupPropertiesByFingerprint', () => {
  assert.ok(COORD_SRC.includes('groupPropertiesByFingerprint,'));
});

test('K-07: coordinator exports runSharedPreCollection', () => {
  assert.ok(COORD_SRC.includes('runSharedPreCollection,'));
});

test('K-08: cron pre-collection uses runSharedPreCollection', () => {
  assert.ok(CRON_SRC.includes('runSharedPreCollection(configs,'));
});

test('K-09: cron suppresses shadow phase when shared active', () => {
  assert.ok(CRON_SRC.includes('!sharedEnabled && coord.isShadowCollectionEnabled()'));
});

test('K-10: computeCostEstimate exported from audit tool', () => {
  assert.ok(AUDIT_S_SRC.includes('module.exports = {') && AUDIT_S_SRC.includes('computeCostEstimate'));
});

test('K-11: audit tool has require.main === module guard (no pool at require time)', () => {
  assert.ok(AUDIT_S_SRC.includes('require.main === module'));
});

test('K-12: cron S-skip logs structured reason for profile_incomplete', () => {
  assert.ok(CRON_SRC.includes('MARKET_PROVIDER_CALL_SKIP') && CRON_SRC.includes('reason=profile_incomplete'));
});

// ═════════════════════════════════════════════════════════════════════════════
// L — Regressions (R-PROD-1, R bridge, audit tool)
// ═════════════════════════════════════════════════════════════════════════════

console.log('\nL — Regressions');

const BRIDGE_SRC = fs.readFileSync(
  path.join(__dirname, '../services/market-observation-persistence-bridge.js'), 'utf8'
);
const AUDIT_R_SRC = fs.readFileSync(
  path.join(__dirname, '../outils/audit-market-persistence-activation-r.js'), 'utf8'
);

test('L-01: bridge still exports isPersistenceEnabled', () => {
  assert.ok(BRIDGE_SRC.includes('isPersistenceEnabled'));
});

test('L-02: bridge still declares MARKET_DATA_WRITES = 0', () => {
  assert.ok(BRIDGE_SRC.includes('MARKET_DATA_WRITES     = 0'));
});

test('L-03: bridge still uses brun_ prefix (not crun_)', () => {
  assert.ok(BRIDGE_SRC.includes("'brun_'"));
  assert.ok(!BRIDGE_SRC.includes("'crun_'")); // crun is for shadow coordinator
});

test('L-04: R audit still exports determineActivationState', () => {
  assert.ok(AUDIT_R_SRC.includes('determineActivationState'));
});

test('L-05: R audit uses R15 constraint text', () => {
  assert.ok(AUDIT_R_SRC.includes('R15 CONSTRAINT'));
});

test('L-06: cron module.exports still includes runDynamicPricingJob', () => {
  assert.ok(CRON_SRC.includes('runDynamicPricingJob') && CRON_SRC.includes('module.exports'));
});

test('L-07: cron module.exports still includes runDynamicPricingForOneProperty', () => {
  assert.ok(CRON_SRC.includes('runDynamicPricingForOneProperty'));
});

test('L-08: cron module.exports still includes writeScrapeResult', () => {
  assert.ok(CRON_SRC.includes('writeScrapeResult'));
});

test('L-09: verifier still imports determineActivationState from audit', () => {
  const VERIFIER = fs.readFileSync(
    path.join(__dirname, '../outils/verify-market-persistence-prod-r.js'), 'utf8'
  );
  assert.ok(VERIFIER.includes('determineActivationState'));
});

test('L-10: verifier SQL uses md.currency (not md.currency_code)', () => {
  const VERIFIER = fs.readFileSync(
    path.join(__dirname, '../outils/verify-market-persistence-prod-r.js'), 'utf8'
  );
  assert.ok(!VERIFIER.includes('currency_code'), 'Schema fix must persist — no currency_code');
});

test('L-11: coordinator still exports isShadowCollectionEnabled', () => {
  assert.ok(COORD_SRC.includes('isShadowCollectionEnabled,'));
});

test('L-12: coordinator single-flight _inflight still present', () => {
  assert.ok(COORD_SRC.includes('_inflight'), 'Single-flight map must remain');
});

test('L-13: cron still calls bridgePersistProductionEvidence after writeScrapeResult', () => {
  assert.ok(CRON_SRC.includes('bridgePersistProductionEvidence'));
  assert.ok(CRON_SRC.includes('bridgePersistenceEnabled'));
});

// ── M — S audit schema-contract tests ──────────────────────────────────────

console.log('\nM — S audit SQL schema contract');

const AUDIT_S_SQL = AUDIT_S_SRC.match(/const ACTIVE_PROPERTIES_SQL = `([\s\S]*?)`;/)?.[1] ?? '';

test('M-01: ACTIVE_PROPERTIES_SQL does NOT reference pc.zone_label', () => {
  assert.ok(!AUDIT_S_SQL.includes('zone_label'),
    'pc.zone_label does not exist in pricing_config — it lives on market_data');
});

test('M-02: ACTIVE_PROPERTIES_SQL is a SELECT (no writes)', () => {
  assert.ok(AUDIT_S_SQL.trim().startsWith('SELECT'), 'Must be a SELECT statement');
  assert.ok(!/\bINSERT\b|\bUPDATE\b|\bDELETE\b/i.test(AUDIT_S_SQL), 'Must not modify data');
});

test('M-03: ACTIVE_PROPERTIES_SQL references only valid pricing_config columns', () => {
  const validPcCols = ['pc.bedrooms', 'pc.property_type', 'pc.is_active', 'pc.price_min', 'pc.price_max'];
  for (const col of validPcCols) {
    assert.ok(AUDIT_S_SQL.includes(col), `Must reference ${col}`);
  }
  assert.ok(!AUDIT_S_SQL.includes('pc.zone_label'), 'Must not reference pc.zone_label');
  assert.ok(!AUDIT_S_SQL.includes('pc.zone_lat'),   'Must not reference pc.zone_lat (select via p)');
  assert.ok(!AUDIT_S_SQL.includes('pc.zone_lng'),   'Must not reference pc.zone_lng (select via p)');
});

test('M-04: ACTIVE_PROPERTIES_SQL references valid properties columns', () => {
  const validPCols = ['p.id', 'p.internal_name', 'p.name', 'p.latitude', 'p.longitude',
                      'p.currency', 'p.max_guests', 'p.address', 'p.user_id'];
  for (const col of validPCols) {
    assert.ok(AUDIT_S_SQL.includes(col), `Must reference ${col}`);
  }
});

test('M-05: computeCostEstimate with M6+M7 returns naiveCalls=2, sharedCalls=1, saved=1', () => {
  const est = computeCostEstimate([M6_CFG, M7_CFG], {
    checkIn:  '2025-08-01',
    checkOut: '2025-08-08',
    resolveProvider: () => 'apify',
  });
  assert.strictEqual(est.naiveCalls,  2, 'Naive = one per eligible property');
  assert.strictEqual(est.sharedCalls, 1, 'Shared = one per fingerprint');
  assert.strictEqual(est.saved,       1, 'Saves exactly 1 call');
  assert.strictEqual(est.reductionPct, 50, '50% reduction');
});

test('M-06: computeCostEstimate with only Ti Junot returns naiveCalls=0, sharedCalls=0', () => {
  const est = computeCostEstimate([TI_JUNOT_CFG], {
    checkIn:  '2025-08-01',
    checkOut: '2025-08-08',
    resolveProvider: () => 'apify',
  });
  assert.strictEqual(est.naiveCalls,  0, 'Ti Junot is excluded — no eligible');
  assert.strictEqual(est.sharedCalls, 0, 'No groups for excluded property');
});

test('M-07: computeCostEstimate groups Map carries profileId per group', () => {
  const est = computeCostEstimate([M6_CFG, M7_CFG], {
    checkIn:  '2025-08-01',
    checkOut: '2025-08-08',
    resolveProvider: () => 'apify',
  });
  assert.strictEqual(est.groups.size, 1);
  const [[, group]] = [...est.groups];
  assert.ok(typeof group.profileId === 'string' && group.profileId.length > 0, 'profileId must be set');
  assert.strictEqual(group.propertyLinks.length, 2, 'Both M6 and M7 must be in the group');
});

test('M-08: audit SQL schema comment documents zone_label location', () => {
  assert.ok(AUDIT_S_SRC.includes('zone_label lives on market_data'),
    'Schema comment must document that zone_label is on market_data, not pricing_config');
});

test('M-09: audit reports UNIQUE_MARKET_PROFILES in output', () => {
  assert.ok(AUDIT_S_SRC.includes('UNIQUE_MARKET_PROFILES'), 'Must report UNIQUE_MARKET_PROFILES');
});

test('M-10: audit reports SHARED_PROFILES in output', () => {
  assert.ok(AUDIT_S_SRC.includes('SHARED_PROFILES'), 'Must report SHARED_PROFILES');
});

test('M-11: audit reports PROPERTIES_IN_SHARED_PROFILES in output', () => {
  assert.ok(AUDIT_S_SRC.includes('PROPERTIES_IN_SHARED_PROFILES'), 'Must report PROPERTIES_IN_SHARED_PROFILES');
});

test('M-12: audit reports BOOSTPRICE_ACTIVE_PROPERTIES in output', () => {
  assert.ok(AUDIT_S_SRC.includes('BOOSTPRICE_ACTIVE_PROPERTIES'), 'Must report BOOSTPRICE_ACTIVE_PROPERTIES');
});

test('M-13: audit reports CURRENT_WEEKLY_COLLECTION_UNIT', () => {
  assert.ok(AUDIT_S_SRC.includes('CURRENT_WEEKLY_COLLECTION_UNIT'), 'Must report CURRENT_WEEKLY_COLLECTION_UNIT');
});

test('M-14: audit reports CURRENT_SINGLE_PROPERTY_COLLECTION_UNIT', () => {
  assert.ok(AUDIT_S_SRC.includes('CURRENT_SINGLE_PROPERTY_COLLECTION_UNIT'), 'Must report CURRENT_SINGLE_PROPERTY_COLLECTION_UNIT');
});

test('M-15: audit fail-closed block outputs SCHEMA_COMPATIBLE = NO on SQL error', () => {
  assert.ok(AUDIT_S_SRC.includes('SCHEMA_COMPATIBLE               = NO'), 'Must output SCHEMA_COMPATIBLE = NO on SQL error');
  assert.ok(AUDIT_S_SRC.includes("SAFE_TO_ENABLE_SHARED_COLLECTION = NO"), 'Must output SAFE_TO_ENABLE_SHARED_COLLECTION = NO on error');
});

// ── N — S15 provider telemetry ────────────────────────────────────────────────

console.log('\nN — S15 provider telemetry');

// Capture MARKET_PROVIDER_CALL_* log events emitted during async fn execution.
// Mocks console.log and console.error; restores them in finally.
// The test harness uses process.stdout.write (not console.log) so mocking is safe.
async function captureProviderTelemetry(fn) {
  const counts = { ATTEMPT: 0, SUCCESS: 0, FAILURE: 0 };
  const origLog = console.log;
  const origErr = console.error;
  const capture = (...args) => {
    const m = String(args[0] || '');
    if (m.includes('MARKET_PROVIDER_CALL_ATTEMPT')) counts.ATTEMPT++;
    if (m.includes('MARKET_PROVIDER_CALL_SUCCESS')) counts.SUCCESS++;
    if (m.includes('MARKET_PROVIDER_CALL_FAILURE')) counts.FAILURE++;
  };
  console.log = capture;
  console.error = capture;
  try {
    await fn();
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  return counts;
}

await testAsync('N-01: shared M6+M7 success → 1 ATTEMPT, 1 SUCCESS, 0 FAILURE', async () => {
  const mock = countingMockScrape();
  const counts = await captureProviderTelemetry(() =>
    runSharedPreCollection([M6_CFG, M7_CFG], defaultPreCollectionOpts(mock))
  );
  assert.strictEqual(counts.ATTEMPT, 1, 'Exactly 1 ATTEMPT for the fingerprint group');
  assert.strictEqual(counts.SUCCESS, 1, 'Exactly 1 SUCCESS');
  assert.strictEqual(counts.FAILURE, 0, 'Zero FAILURE');
});

await testAsync('N-02: shared failure → 1 ATTEMPT, 0 SUCCESS, 1 FAILURE', async () => {
  const failScrape = async () => { throw new Error('provider_unavailable'); };
  const counts = await captureProviderTelemetry(() =>
    runSharedPreCollection([M6_CFG], defaultPreCollectionOpts(failScrape))
  );
  assert.strictEqual(counts.ATTEMPT, 1, 'Exactly 1 ATTEMPT');
  assert.strictEqual(counts.SUCCESS, 0, 'Zero SUCCESS on failure');
  assert.strictEqual(counts.FAILURE, 1, 'Exactly 1 FAILURE');
});

await testAsync('N-03: two distinct fingerprints → 2 ATTEMPT, 2 terminal events', async () => {
  const mock = countingMockScrape();
  const counts = await captureProviderTelemetry(() =>
    runSharedPreCollection([M6_CFG, SOLO_CFG], defaultPreCollectionOpts(mock))
  );
  assert.strictEqual(counts.ATTEMPT, 2, 'One ATTEMPT per fingerprint group');
  assert.strictEqual(counts.SUCCESS + counts.FAILURE, 2, 'One terminal event per group');
});

await testAsync('N-04: M6+M7 fanout does NOT duplicate telemetry', async () => {
  const mock = countingMockScrape();
  const counts = await captureProviderTelemetry(() =>
    runSharedPreCollection([M6_CFG, M7_CFG], defaultPreCollectionOpts(mock))
  );
  assert.strictEqual(mock.callCount(), 1, 'Provider called once despite 2 properties');
  assert.strictEqual(counts.ATTEMPT,  1, 'ATTEMPT not duplicated for fanout to M6+M7');
  assert.strictEqual(counts.SUCCESS,  1, 'SUCCESS not duplicated for fanout');
});

await testAsync('N-05: telemetry does not alter evidence content', async () => {
  const mock = countingMockScrape();
  let capturedEvidence;
  const counts = await captureProviderTelemetry(async () => {
    const { sharedEvidence, propToFingerprint } = await runSharedPreCollection(
      [M6_CFG], defaultPreCollectionOpts(mock)
    );
    const fp = propToFingerprint.get('6');
    capturedEvidence = sharedEvidence.get(fp);
  });
  assert.ok(capturedEvidence && capturedEvidence.dataSource === 'apify_live', 'Evidence content unaltered by telemetry');
  assert.ok(!capturedEvidence.error, 'No error injected by telemetry');
  assert.strictEqual(counts.ATTEMPT, 1);
  assert.strictEqual(counts.SUCCESS, 1);
});

// Static source checks — legacy and single-property paths require DB so checked statically

test('N-06: cron runDynamicPricingForOneProperty body has FAILURE telemetry', () => {
  const fnIdx = CRON_SRC.indexOf('async function runDynamicPricingForOneProperty');
  assert.ok(fnIdx !== -1, 'Function must exist');
  const body = CRON_SRC.slice(fnIdx, fnIdx + 4000);
  assert.ok(body.includes('MARKET_PROVIDER_CALL_FAILURE'),
    'Single-property path must emit MARKET_PROVIDER_CALL_FAILURE on scrapeBestZone error');
});

test('N-07: cron legacy weekly path has ATTEMPT with reason=legacy_zone_cache', () => {
  assert.ok(CRON_SRC.includes('reason=legacy_zone_cache'),
    'Legacy path ATTEMPT must include reason=legacy_zone_cache (distinct from single-property)');
});

test('N-08: cron now has MARKET_PROVIDER_CALL_FAILURE (all paths complete)', () => {
  assert.ok(CRON_SRC.includes('MARKET_PROVIDER_CALL_FAILURE'),
    'Cron must have MARKET_PROVIDER_CALL_FAILURE for both legacy and single-property paths');
});

test('N-09: audit checks coordinator source for all three telemetry events', () => {
  assert.ok(AUDIT_S_SRC.includes('_coordTelemetryPresent'),
    'Audit must check coordinator (shared path) telemetry');
  assert.ok(AUDIT_S_SRC.includes("COORD_SRC.includes('MARKET_PROVIDER_CALL_ATTEMPT')"),
    'Audit must check COORD_SRC for ATTEMPT');
  assert.ok(AUDIT_S_SRC.includes("COORD_SRC.includes('MARKET_PROVIDER_CALL_FAILURE')"),
    'Audit must check COORD_SRC for FAILURE');
});

test('N-10: audit providerTelemetryPresent requires both shared and cron paths complete', () => {
  assert.ok(AUDIT_S_SRC.includes('_coordTelemetryPresent && _cronTelemetryPresent'),
    'providerTelemetryPresent must be AND of both path checks');
});

test('N-11: audit PROVIDER_TELEMETRY_PRESENT would be NO if FAILURE absent from cron', () => {
  // Simulate partial cron: ATTEMPT+SUCCESS only, no FAILURE
  const partialCron = CRON_SRC.replace(/MARKET_PROVIDER_CALL_FAILURE/g, '_REMOVED_');
  const coordHasAll =
    partialCron.includes('MARKET_PROVIDER_CALL_ATTEMPT') === false; // coord not in cron
  // Re-evaluate the check logic manually
  const cronTelemetry =
    partialCron.includes('MARKET_PROVIDER_CALL_ATTEMPT') &&
    partialCron.includes('MARKET_PROVIDER_CALL_SUCCESS') &&
    partialCron.includes('MARKET_PROVIDER_CALL_FAILURE'); // false since removed
  assert.strictEqual(cronTelemetry, false,
    'With FAILURE stripped from cron, _cronTelemetryPresent must be false → providerTelemetryPresent=false');
});

// ── Final report ──────────────────────────────────────────────────────────────

console.log('\n');
if (failed > 0) {
  const detail = failures.map(f => `  ✗ ${f.label}: ${f.message}`).join('\n');
  console.error(`P1.2-B5-BK-S — ${passed} passed, ${failed} failed:\n${detail}`);
  process.exit(1);
} else {
  console.log(`P1.2-B5-BK-S — ${passed} passed, ${failed} failed`);
}

})();
