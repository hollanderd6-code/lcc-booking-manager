#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.1-C2-R2 Geocoding CAS Anchor + Cosmetic Edit Race
 *
 * Groupes :
 *   C2R2-01–05 : signature + séparation anchor/query dans geocodePropertyAsync
 *   C2R2-06–09 : cosmetic edit race (adresse inchangée normalisée, geo incomplet)
 *   C2R2-10–11 : marketplace caller — CAS anchor = adresse stockée
 *   C2R2-12–13 : intégration computeMarketContextKey dans le PUT handler
 *   C2R2-14–15 : isolation — pas de marché/Apify dans geocodePropertyAsync
 *
 * Exécution : node tests/p1_1c2r2_geocoding_cas.test.js
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

// ── Test runner ───────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌  ${name}`);
    console.error(`       ${err.message}`);
    failures.push({ name, message: err.message });
    failed++;
  }
}

// ── Source text helpers ───────────────────────────────────────────────────────
const SERVER_SRC = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');

function getGeoFn() {
  const match = SERVER_SRC.match(/async function geocodePropertyAsync[\s\S]{0,2500}?\n\}/);
  return match ? match[0] : '';
}

function getPUTGeoRegion() {
  // C3C updated calls to 6 params; anchor on the addressChanged=true branch marker.
  const marker = 'geocodePropertyAsync(pool, propertyId, newAddress, newAddress, userId, _prevKey)';
  const idx = SERVER_SRC.indexOf(marker);
  if (idx === -1) return '';
  return SERVER_SRC.slice(idx - 900, idx + 600);
}

function getPOSTHostGeoHook() {
  const idx = SERVER_SRC.indexOf('Logement publié sur la marketplace');
  if (idx === -1) return '';
  return SERVER_SRC.slice(idx, idx + 400);
}

// ── Tests ─────────────────────────────────────────────────────────────────────
(async () => {

console.log('\n── C2R2-01–05 : signature — séparation anchor/query ──');

await test('C2R2-01 signature : expectedStoredAddress + geocodeQuery default + userId + previousContextKey', async () => {
  const fn = getGeoFn();
  assert.ok(fn, 'geocodePropertyAsync introuvable dans server.js');
  // C3C extended to 6 params: geocodeQuery default + userId + previousContextKey
  assert.ok(
    /geocodePropertyAsync\s*\(pool,\s*propertyId,\s*expectedStoredAddress,\s*geocodeQuery\s*=\s*expectedStoredAddress/.test(fn),
    'Signature attendue : (pool, propertyId, expectedStoredAddress, geocodeQuery = expectedStoredAddress, ...)'
  );
  assert.ok(
    /userId\s*=\s*null/.test(fn),
    'userId = null default absent de la signature'
  );
  assert.ok(
    /previousContextKey\s*=\s*null/.test(fn),
    'previousContextKey = null default absent de la signature'
  );
});

await test('C2R2-02 early-return vérifie expectedStoredAddress (pas geocodeQuery)', async () => {
  const fn = getGeoFn();
  assert.ok(fn, 'geocodePropertyAsync introuvable');
  assert.ok(
    /if\s*\(\s*!expectedStoredAddress/.test(fn),
    'Early return doit vérifier !expectedStoredAddress'
  );
  // The guard line must NOT include geocodeQuery — only expectedStoredAddress is the anchor
  const guardMatch = fn.match(/if\s*\([^)]*!expectedStoredAddress[^)]*\)[^;]*;/);
  assert.ok(guardMatch, 'Ligne guard early-return introuvable');
  assert.ok(
    !/geocodeQuery/.test(guardMatch[0]),
    'Le guard early-return ne doit pas tester geocodeQuery — seul expectedStoredAddress est l\'anchor CAS'
  );
});

await test('C2R2-03 geocodeAddress appelé avec geocodeQuery (pas directement expectedStoredAddress)', async () => {
  const fn = getGeoFn();
  assert.ok(fn, 'geocodePropertyAsync introuvable');
  assert.ok(
    /geocodeAddress\s*\(\s*geocodeQuery\s*(&&|\|\|)/.test(fn) ||
    /geocodeAddress\s*\(\s*geocodeQuery\s*\|\|\s*expectedStoredAddress\s*\)/.test(fn) ||
    /geocodeAddress\s*\(\s*geocodeQuery\s*\)/.test(fn),
    'geocodeAddress doit être appelé avec geocodeQuery (ou geocodeQuery || expectedStoredAddress)'
  );
});

await test('C2R2-04 CAS WHERE $6 = expectedStoredAddress (pas geocodeQuery)', async () => {
  const fn = getGeoFn();
  assert.ok(fn, 'geocodePropertyAsync introuvable');
  assert.ok(
    /WHERE id = \$5 AND address = \$6/.test(fn),
    'Compare-and-set WHERE id=$5 AND address=$6 absent'
  );
  // The params array 6th element must be expectedStoredAddress
  assert.ok(
    /propertyId,\s*expectedStoredAddress\s*\]/.test(fn),
    'Le 6e param du CAS doit être expectedStoredAddress (anchor), pas geocodeQuery'
  );
});

await test('C2R2-05 callers PUT + POST standard passent userId et previousContextKey explicitement (C3C)', async () => {
  // C3C updated all callers to 6 params — verify each call site is explicit
  assert.ok(
    SERVER_SRC.includes('geocodePropertyAsync(pool, propertyId, newAddress, newAddress, userId, _prevKey)'),
    'PUT handler (addressChanged) doit passer (pool, propertyId, newAddress, newAddress, userId, _prevKey)'
  );
  assert.ok(
    SERVER_SRC.includes('geocodePropertyAsync(pool, id, address, address, userId, null)'),
    'POST standard doit passer (pool, id, address, address, userId, null)'
  );
});

console.log('\n── C2R2-06–09 : cosmetic edit race ──');

await test('C2R2-06 PUT handler — branche else if (newAddress && !addressChanged) présente', async () => {
  const region = getPUTGeoRegion();
  assert.ok(region, 'Région PUT geocode introuvable');
  assert.ok(
    /else if\s*\(\s*newAddress\s*&&\s*!addressChanged\s*\)/.test(region),
    'Branche "else if (newAddress && !addressChanged)" absente du PUT handler'
  );
});

await test('C2R2-07 PUT handler — cosmetic branch utilise computeMarketContextKey pour détecter geo incomplet', async () => {
  const region = getPUTGeoRegion();
  assert.ok(region, 'Région PUT geocode introuvable');
  assert.ok(
    /computeMarketContextKey/.test(region),
    'computeMarketContextKey absent de la région cosmetic-edit du PUT handler'
  );
  assert.ok(
    /_geoIncomplete/.test(region),
    '_geoIncomplete absent — la variable de détection geo incomplet est attendue'
  );
});

await test('C2R2-08 PUT handler — cosmetic branch ne re-géocode QUE si geo incomplet (guard _geoIncomplete)', async () => {
  const region = getPUTGeoRegion();
  assert.ok(region, 'Région PUT geocode introuvable');
  // The conditional geocode call must be guarded by _geoIncomplete
  const incompleteIdx = region.indexOf('_geoIncomplete');
  assert.ok(incompleteIdx !== -1, '_geoIncomplete absent de la région PUT');
  const cosmGeoIdx = region.indexOf('geocodePropertyAsync(pool, propertyId, newAddress, newAddress, userId, null)', incompleteIdx);
  assert.ok(cosmGeoIdx !== -1, 'geocodePropertyAsync(pool, propertyId, newAddress, newAddress, userId, null) absent après le guard _geoIncomplete');
  assert.ok(cosmGeoIdx > incompleteIdx, '_geoIncomplete doit précéder le setImmediate cosmétique');
});

await test('C2R2-09 PUT handler — si addressChanged=true → geocode déclenché (branche originale conservée)', async () => {
  const region = getPUTGeoRegion();
  assert.ok(region, 'Région PUT geocode introuvable');
  assert.ok(
    /if\s*\(\s*newAddress\s*&&\s*addressChanged\s*\)/.test(region),
    'Guard "if (newAddress && addressChanged)" absent — branche adresse changée manquante'
  );
});

console.log('\n── C2R2-10–11 : marketplace caller — anchor = adresse stockée ──');

await test('C2R2-10 marketplace passe address ET geoAddress séparément (4-params)', async () => {
  const block = getPOSTHostGeoHook();
  assert.ok(block, 'Bloc POST /api/host/properties introuvable');
  assert.ok(
    /geocodePropertyAsync\s*\(pool,\s*id,\s*address,\s*geoAddress,\s*userId,\s*null\s*\)/.test(block),
    'Appel 6-params geocodePropertyAsync(pool, id, address, geoAddress, userId, null) absent du marketplace caller'
  );
});

await test('C2R2-11 marketplace guard vérifie address (pas seulement geoAddress)', async () => {
  const block = getPOSTHostGeoHook();
  assert.ok(block, 'Bloc POST /api/host/properties introuvable');
  // Must check `address &&` before the setImmediate — ensures no CAS against empty stored address
  assert.ok(
    /if\s*\(\s*address\s*&&\s*geoAddress\s*\)/.test(block),
    'Guard "if (address && geoAddress)" absent — le marketplace doit vérifier address (anchor DB) avant geoAddress'
  );
});

console.log('\n── C2R2-12–13 : intégration computeMarketContextKey dans server.js ──');

await test('C2R2-12 computeMarketContextKey importé dans server.js', async () => {
  assert.ok(
    /require\(['"]\.\/routes\/market-context-key['"]\)/.test(SERVER_SRC),
    'market-context-key non importé dans server.js'
  );
  assert.ok(
    /\bcomputeMarketContextKey\b/.test(SERVER_SRC),
    'computeMarketContextKey absent de server.js'
  );
});

await test('C2R2-13 computeMarketContextKey utilisé dans la branche cosmetic edit du PUT handler', async () => {
  const region = getPUTGeoRegion();
  assert.ok(region, 'Région PUT geocode introuvable');
  assert.ok(
    /computeMarketContextKey\s*\(\s*\{/.test(region),
    'computeMarketContextKey({...}) absent de la branche cosmetic du PUT handler'
  );
  // Must pass country_code, latitude, longitude from the updated row
  assert.ok(
    /countryCode\s*:\s*updated\.country_code/.test(region),
    'countryCode: updated.country_code absent — doit lire le geo context DB post-UPDATE'
  );
});

console.log('\n── C2R2-14–15 : isolation — pas de marché/Apify dans geocodePropertyAsync ──');

await test('C2R2-14 geocodePropertyAsync délègue au trigger (scheduleMarketRefresh) sans appel Apify direct', async () => {
  const fn = getGeoFn();
  assert.ok(fn, 'geocodePropertyAsync introuvable');
  // C3C adds scheduleMarketRefresh — orchestration only, no direct Apify
  assert.ok(
    !/APIFY_ACTOR_ID/.test(fn),
    'APIFY_ACTOR_ID trouvé dans geocodePropertyAsync — Apify ne doit pas être appelé directement'
  );
  assert.ok(
    !/scrapeBestZone/.test(fn),
    'scrapeBestZone trouvé dans geocodePropertyAsync — doit passer par le trigger'
  );
  assert.ok(
    !/INSERT INTO market_data/.test(fn),
    'Écriture directe market_data dans geocodePropertyAsync — doit passer par writeScrapeResult'
  );
});

await test('C2R2-15 geocodePropertyAsync ne contient pas apify (isolation géocodeur/scraper)', async () => {
  const fn = getGeoFn();
  assert.ok(fn, 'geocodePropertyAsync introuvable');
  assert.ok(
    !/apify/i.test(fn),
    'apify trouvé dans geocodePropertyAsync — le géocodeur ne doit pas déclencher de scraping marché'
  );
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(55)}`);
console.log(`  ${passed} passed  /  ${failed} failed  /  15 total`);
if (failures.length) {
  console.log('\n  Failures:');
  failures.forEach(f => console.log(`    ❌  ${f.name}\n       ${f.message}`));
}
console.log('─'.repeat(55));
if (passed + failed !== 15) {
  console.error(`⚠️  Attendu 15 tests, ${passed + failed} exécutés`);
  process.exit(1);
}
process.exit(failed > 0 ? 1 : 0);

})();
