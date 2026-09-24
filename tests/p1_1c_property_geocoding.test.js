#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.1-C2 Property Geo Context Resolution (Geoapify)
 *
 * Groupes :
 *   GEO-01–03  : geocodeAddress() — guards (empty address, no API key)
 *   GEO-04–10  : geocodeAddress() — status resolution (resolved/ambiguous/failed)
 *   GEO-11–14  : geocodeAddress() — coordinate + field validation
 *   GEO-15–17  : geocodeAddress() — normalization helpers (countryCode, timezone)
 *   GEO-18–25  : server.js source — geocodePropertyAsync + write paths
 *   GEO-26–30  : server.js source — address change detection + compare-and-set
 *   GEO-31–35  : isolation — market_data / pricing_schedule / channex / hardcodes
 *
 * Exécution : node tests/p1_1c_property_geocoding.test.js
 * Aucun appel DB réel. Aucun appel HTTP réel.
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

// ── Load modules ──────────────────────────────────────────────────────────────
const GEOCODER_PATH = path.resolve(__dirname, '../services/property-geocoder.js');
const SERVER_PATH   = path.resolve(__dirname, '../server.js');
const { geocodeAddress } = require(GEOCODER_PATH);
const src = fs.readFileSync(SERVER_PATH, 'utf8');

// ── Source helpers ────────────────────────────────────────────────────────────
function getGeoPropertyAsync() {
  const match = src.match(/async function geocodePropertyAsync[\s\S]{0,2500}?\n\}/);
  return match ? match[0] : '';
}

function getPUTUpdateBlock() {
  const match = src.match(/UPDATE properties\s+SET\s+name\s*=\s*\$1[\s\S]{0,3000}/);
  return match ? match[0] : '';
}

function getPOSTPropertiesGeoHook() {
  // Section after loadProperties() in POST /api/properties
  const idx = src.indexOf("Propriété créée avec succès");
  if (idx === -1) return '';
  return src.slice(idx, idx + 400);
}

function getPUTLoadPropertiesRegion() {
  // Anchor on the 6-param setImmediate call in the PUT addressChanged=true branch.
  // C3C updated the call to pass userId + _prevKey; use the new unique marker.
  const marker = 'geocodePropertyAsync(pool, propertyId, newAddress, newAddress, userId, _prevKey)';
  const idx = src.indexOf(marker);
  if (idx === -1) return '';
  return src.slice(idx - 700, idx + 400);
}

function getPOSTHostGeoHook() {
  const idx = src.indexOf('Logement publié sur la marketplace');
  if (idx === -1) return '';
  return src.slice(idx, idx + 350);
}

function getGeocoderSrc() {
  return fs.readFileSync(GEOCODER_PATH, 'utf8');
}

// ── Mock axios factory ────────────────────────────────────────────────────────
function mockAxios(response) {
  return {
    get: async () => response,
  };
}

function mockAxiosThrow(err) {
  return {
    get: async () => { throw err; },
  };
}

function makeGeoResponse(overrides = {}) {
  return {
    data: {
      results: [{
        lat: '48.856614',
        lon: '2.352222',
        rank: { confidence: 0.97 },
        result_type: 'building',
        country_code: 'fr',
        timezone: { name: 'Europe/Paris' },
        ...overrides,
      }],
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
(async () => {

console.log('\n── GEO-01–03 : geocodeAddress() guards ──');

await test('GEO-01 null address → failed, empty_address, no HTTP call', async () => {
  let called = false;
  const http = { get: async () => { called = true; return {}; } };
  const r = await geocodeAddress(null, { _axios: http, _apiKey: 'key' });
  assert.strictEqual(r.status, 'failed', 'status doit être failed');
  assert.strictEqual(r.reason, 'empty_address', `reason inattendu: ${r.reason}`);
  assert.strictEqual(called, false, 'axios.get ne doit pas être appelé');
});

await test('GEO-02 empty string address → failed, empty_address, no HTTP call', async () => {
  let called = false;
  const http = { get: async () => { called = true; return {}; } };
  const r = await geocodeAddress('   ', { _axios: http, _apiKey: 'key' });
  assert.strictEqual(r.status, 'failed');
  assert.strictEqual(r.reason, 'empty_address');
  assert.strictEqual(called, false, 'axios.get ne doit pas être appelé pour une adresse vide');
});

await test('GEO-03 no API key → failed, no_api_key, no HTTP call', async () => {
  let called = false;
  const http = { get: async () => { called = true; return {}; } };
  const r = await geocodeAddress('12 Rue de la Paix, Paris', { _axios: http, _apiKey: null });
  assert.strictEqual(r.status, 'failed');
  assert.strictEqual(r.reason, 'no_api_key');
  assert.strictEqual(called, false, 'axios.get ne doit pas être appelé sans clé API');
});

console.log('\n── GEO-04–10 : geocodeAddress() — résolution de statut ──');

await test('GEO-04 confidence 0.97 + building → resolved, tous champs présents', async () => {
  const r = await geocodeAddress('12 Rue de la Paix, Paris', {
    _apiKey: 'test-key',
    _axios: mockAxios(makeGeoResponse()),
  });
  assert.strictEqual(r.status, 'resolved', `status inattendu: ${r.status}`);
  assert.ok(Math.abs(r.latitude - 48.856614) < 1e-6, `latitude: ${r.latitude}`);
  assert.ok(Math.abs(r.longitude - 2.352222) < 1e-6, `longitude: ${r.longitude}`);
  assert.strictEqual(r.countryCode, 'FR', `countryCode: ${r.countryCode}`);
  assert.strictEqual(r.timezone, 'Europe/Paris', `timezone: ${r.timezone}`);
  assert.strictEqual(r.provider, 'geoapify');
  assert.ok(r.confidence >= 0.7, `confidence: ${r.confidence}`);
});

await test('GEO-05 confidence 0.75 + street → ambiguous (street trop imprécis pour un logement)', async () => {
  const r = await geocodeAddress('Rue Rivoli, Paris', {
    _apiKey: 'test-key',
    _axios: mockAxios(makeGeoResponse({ rank: { confidence: 0.75 }, result_type: 'street' })),
  });
  assert.strictEqual(r.status, 'ambiguous', `street ne doit pas être resolved: ${r.status}`);
});

await test('GEO-06 confidence 0.30 → failed (trop faible)', async () => {
  const r = await geocodeAddress('Paris', {
    _apiKey: 'test-key',
    _axios: mockAxios(makeGeoResponse({ rank: { confidence: 0.30 }, result_type: 'city' })),
  });
  assert.strictEqual(r.status, 'failed', `status: ${r.status}`);
  assert.ok(/too_coarse|low_confidence/.test(r.reason), `reason: ${r.reason}`);
});

await test('GEO-07 confidence 0.55 → ambiguous', async () => {
  const r = await geocodeAddress('Rue de la Paix', {
    _apiKey: 'test-key',
    _axios: mockAxios(makeGeoResponse({ rank: { confidence: 0.55 }, result_type: 'street' })),
  });
  assert.strictEqual(r.status, 'ambiguous', `status: ${r.status}`);
});

await test('GEO-08 result_type=country → failed (trop grossier)', async () => {
  const r = await geocodeAddress('France', {
    _apiKey: 'test-key',
    _axios: mockAxios(makeGeoResponse({ rank: { confidence: 0.99 }, result_type: 'country' })),
  });
  assert.strictEqual(r.status, 'failed', `status: ${r.status}`);
});

await test('GEO-09 result_type=state → failed', async () => {
  const r = await geocodeAddress('Île-de-France', {
    _apiKey: 'test-key',
    _axios: mockAxios(makeGeoResponse({ rank: { confidence: 0.99 }, result_type: 'state' })),
  });
  assert.strictEqual(r.status, 'failed');
});

await test('GEO-10 result_type=county + confidence 0.85 → ambiguous (pas resolved)', async () => {
  const r = await geocodeAddress('Seine', {
    _apiKey: 'test-key',
    _axios: mockAxios(makeGeoResponse({ rank: { confidence: 0.85 }, result_type: 'county' })),
  });
  assert.notStrictEqual(r.status, 'resolved', 'county ne doit pas être resolved');
  assert.strictEqual(r.status, 'ambiguous', `status attendu ambiguous, obtenu ${r.status}`);
});

console.log('\n── GEO-11–14 : geocodeAddress() — validation champs ──');

await test('GEO-11 coordonnées invalides (NaN lat) → failed, invalid_coordinates', async () => {
  const r = await geocodeAddress('somewhere', {
    _apiKey: 'test-key',
    _axios: mockAxios({
      data: { results: [{ lat: 'not-a-number', lon: '2.35', rank: { confidence: 0.9 }, result_type: 'building' }] },
    }),
  });
  assert.strictEqual(r.status, 'failed');
  assert.strictEqual(r.reason, 'invalid_coordinates');
  assert.strictEqual(r.latitude, null, 'latitude doit être null sur invalid_coordinates');
  assert.strictEqual(r.longitude, null, 'longitude doit être null sur invalid_coordinates');
});

await test('GEO-12 résultats vides → failed, no_result', async () => {
  const r = await geocodeAddress('xyzzy123', {
    _apiKey: 'test-key',
    _axios: mockAxios({ data: { results: [] } }),
  });
  assert.strictEqual(r.status, 'failed');
  assert.strictEqual(r.reason, 'no_result');
});

await test('GEO-13 timeout (ECONNABORTED) → failed, reason=timeout', async () => {
  const err = new Error('timeout');
  err.code = 'ECONNABORTED';
  const r = await geocodeAddress('Paris', {
    _apiKey: 'test-key',
    _axios: mockAxiosThrow(err),
  });
  assert.strictEqual(r.status, 'failed');
  assert.strictEqual(r.reason, 'timeout');
});

await test('GEO-14 erreur HTTP 500 → failed, reason=http_error_500', async () => {
  const err = new Error('Internal Server Error');
  err.response = { status: 500 };
  const r = await geocodeAddress('Paris', {
    _apiKey: 'test-key',
    _axios: mockAxiosThrow(err),
  });
  assert.strictEqual(r.status, 'failed');
  assert.strictEqual(r.reason, 'http_error_500');
});

console.log('\n── GEO-15–17 : Normalisations (countryCode, timezone) ──');

await test('GEO-15 country_code "  fr  " → "FR" (normalisation uppercase + trim)', async () => {
  const r = await geocodeAddress('test', {
    _apiKey: 'test-key',
    _axios: mockAxios(makeGeoResponse({ country_code: '  fr  ' })),
  });
  assert.strictEqual(r.countryCode, 'FR', `countryCode: ${r.countryCode}`);
});

await test('GEO-16 country_code "XXX" (3 chars) → null', async () => {
  const r = await geocodeAddress('test', {
    _apiKey: 'test-key',
    _axios: mockAxios(makeGeoResponse({ country_code: 'XXX' })),
  });
  assert.strictEqual(r.countryCode, null, `countryCode devrait être null: ${r.countryCode}`);
});

await test('GEO-17 timezone IANA valide → retourné ; timezone invalide → null', async () => {
  const rValid = await geocodeAddress('test', {
    _apiKey: 'test-key',
    _axios: mockAxios(makeGeoResponse({ timezone: { name: 'America/New_York' } })),
  });
  assert.strictEqual(rValid.timezone, 'America/New_York', `timezone valide: ${rValid.timezone}`);

  const rInvalid = await geocodeAddress('test', {
    _apiKey: 'test-key',
    _axios: mockAxios(makeGeoResponse({ timezone: { name: 'Not/ATimezone' } })),
  });
  assert.strictEqual(rInvalid.timezone, null, `timezone invalide devrait être null: ${rInvalid.timezone}`);
});

console.log('\n── GEO-18–25 : server.js — geocodePropertyAsync + write paths ──');

await test('GEO-18 geocodePropertyAsync défini dans server.js', async () => {
  const block = getGeoPropertyAsync();
  assert.ok(block, 'geocodePropertyAsync introuvable dans server.js');
});

await test('GEO-19 geocodePropertyAsync utilise le compare-and-set (WHERE id = AND address =)', async () => {
  const block = getGeoPropertyAsync();
  assert.ok(block, 'geocodePropertyAsync introuvable');
  assert.ok(/WHERE id = \$5 AND address = \$6/.test(block),
    'Compare-and-set WHERE id=$5 AND address=$6 absent de geocodePropertyAsync');
});

await test('GEO-20 geocodePropertyAsync appelle loadProperties() après écriture réussie', async () => {
  const block = getGeoPropertyAsync();
  assert.ok(block, 'geocodePropertyAsync introuvable');
  assert.ok(/await loadProperties\(\)/.test(block),
    'loadProperties() absent de geocodePropertyAsync');
});

await test('GEO-21 geocodePropertyAsync ne SET pas currency', async () => {
  const block = getGeoPropertyAsync();
  assert.ok(block, 'geocodePropertyAsync introuvable');
  const setMatch = block.match(/SET[\s\S]{0,300}/);
  const setClause = setMatch ? setMatch[0] : block;
  assert.ok(!/\bcurrency\b/.test(setClause),
    'currency trouvé dans le SET de geocodePropertyAsync — ne doit pas être écrit par le géocodeur');
});

await test('GEO-22 PUT UPDATE query reset lat/lng/country_code/timezone via CASE WHEN $43', async () => {
  const block = getPUTUpdateBlock();
  assert.ok(block, 'UPDATE properties SET introuvable dans server.js');
  assert.ok(/latitude\s*=\s*CASE WHEN \$43::boolean THEN NULL/.test(block),
    'CASE WHEN $43 latitude absent du UPDATE PUT');
  assert.ok(/longitude\s*=\s*CASE WHEN \$43::boolean THEN NULL/.test(block),
    'CASE WHEN $43 longitude absent du UPDATE PUT');
  assert.ok(/country_code\s*=\s*CASE WHEN \$43::boolean THEN NULL/.test(block),
    'CASE WHEN $43 country_code absent du UPDATE PUT');
  assert.ok(/timezone\s*=\s*CASE WHEN \$43::boolean THEN NULL/.test(block),
    'CASE WHEN $43 timezone absent du UPDATE PUT');
  // Single source of truth: SQL must NOT independently compare addresses
  assert.ok(!/IS DISTINCT FROM/.test(block),
    'IS DISTINCT FROM encore présent — le SQL ne doit pas recalculer le changement');
});

await test('GEO-23 POST /api/properties inclut hook geocodePropertyAsync', async () => {
  const block = getPOSTPropertiesGeoHook();
  assert.ok(block, 'Bloc POST /api/properties introuvable');
  assert.ok(/geocodePropertyAsync/.test(block),
    'geocodePropertyAsync absent du POST /api/properties');
  assert.ok(/setImmediate/.test(block),
    'setImmediate absent du POST /api/properties');
});

await test('GEO-24 PUT /api/properties/:id inclut hook geocodePropertyAsync', async () => {
  const region = getPUTLoadPropertiesRegion();
  assert.ok(region, 'Région PUT loadProperties introuvable');
  assert.ok(/geocodePropertyAsync/.test(region),
    'geocodePropertyAsync absent du PUT /api/properties/:id');
  assert.ok(/setImmediate/.test(region),
    'setImmediate absent du PUT /api/properties/:id');
});

await test('GEO-25 POST /api/host/properties inclut hook geocodePropertyAsync', async () => {
  const block = getPOSTHostGeoHook();
  assert.ok(block, 'Bloc POST /api/host/properties introuvable');
  assert.ok(/geocodePropertyAsync/.test(block),
    'geocodePropertyAsync absent du POST /api/host/properties');
  assert.ok(/setImmediate/.test(block),
    'setImmediate absent du POST /api/host/properties');
});

console.log('\n── GEO-26–30 : server.js — détection de changement d\'adresse ──');

await test('GEO-26 normalizeAddressForComparison défini dans server.js', async () => {
  assert.ok(/function normalizeAddressForComparison/.test(src),
    'normalizeAddressForComparison introuvable dans server.js');
});

await test('GEO-27 PUT handler calcule addressChanged via normalizeAddressForComparison avant le UPDATE', async () => {
  // The declaration must come BEFORE the pool.query for the UPDATE (before $43 is passed)
  const declIdx = src.indexOf('const addressChanged = normalizeAddressForComparison(newAddress)');
  assert.ok(declIdx !== -1, 'Déclaration "const addressChanged = normalizeAddressForComparison(newAddress)" introuvable');
  // Must be inside the PUT handler — verify it's before the UPDATE query params array
  const updateParamsIdx = src.indexOf('newDepositReleaseDays,\n        newExternalPricing,\n        addressChanged');
  assert.ok(updateParamsIdx !== -1, 'addressChanged absent du tableau de paramètres UPDATE');
  assert.ok(declIdx < updateParamsIdx, 'addressChanged doit être calculé avant le pool.query UPDATE');
});

await test('GEO-28 PUT handler ne géocode pas si adresse nulle (if newAddress)', async () => {
  const region = getPUTLoadPropertiesRegion();
  assert.ok(/if\s*\(\s*newAddress\s*&&\s*addressChanged\s*\)/.test(region),
    'Guard "if (newAddress && addressChanged)" absent du PUT handler');
});

await test('GEO-29 compare-and-set utilise l\'adresse réelle (non normalisée) dans WHERE', async () => {
  const block = getGeoPropertyAsync();
  assert.ok(block, 'geocodePropertyAsync introuvable');
  // Must pass raw `address` parameter, not a normalized version
  assert.ok(/WHERE id = \$5 AND address = \$6/.test(block),
    'WHERE clause doit utiliser l\'adresse réelle ($6), pas une version normalisée');
  assert.ok(!/normalizeAddressForComparison/.test(block),
    'normalizeAddressForComparison ne doit pas être utilisé dans la clause WHERE de geocodePropertyAsync');
});

await test('GEO-30 geocodePropertyAsync ne peut pas provoquer une unhandled rejection (try/catch)', async () => {
  const block = getGeoPropertyAsync();
  assert.ok(block, 'geocodePropertyAsync introuvable');
  // Must have try/catch around the pool.query write-back
  const tryCatchCount = (block.match(/\btry\b/g) || []).length;
  assert.ok(tryCatchCount >= 1, 'Aucun try/catch dans geocodePropertyAsync');
  assert.ok(/catch\s*\(/.test(block), 'catch absent de geocodePropertyAsync');
});

console.log('\n── GEO-31–35 : Isolation — market_data / pricing / channex / hardcodes ──');

await test('GEO-31 services/property-geocoder.js ne touche pas market_data', async () => {
  const geoSrc = getGeocoderSrc();
  assert.ok(!/market_data/.test(geoSrc), 'market_data trouvé dans property-geocoder.js');
  assert.ok(!/market-data-resolver/.test(geoSrc), 'market-data-resolver importé dans property-geocoder.js');
});

await test('GEO-32 geocodePropertyAsync ne touche pas pricing_schedule', async () => {
  const block = getGeoPropertyAsync();
  assert.ok(block, 'geocodePropertyAsync introuvable');
  assert.ok(!/pricing_schedule/.test(block),
    'pricing_schedule trouvé dans geocodePropertyAsync — ne doit pas être touché en C2');
});

await test('GEO-33 geocodePropertyAsync ne SET pas currency', async () => {
  // Redundant with GEO-21 but explicit: currency is NOT a geocoder output
  const block = getGeoPropertyAsync();
  assert.ok(block, 'geocodePropertyAsync introuvable');
  assert.ok(!/SET[\s\S]{0,500}currency/.test(block),
    'currency trouvé dans SET de geocodePropertyAsync');
});

await test('GEO-34 services/property-geocoder.js ne requiert pas channex ni pricing-engine', async () => {
  const geoSrc = getGeocoderSrc();
  assert.ok(!/channex/.test(geoSrc), 'channex importé dans property-geocoder.js');
  assert.ok(!/pricing-engine/.test(geoSrc), 'pricing-engine importé dans property-geocoder.js');
});

await test('GEO-35 services/property-geocoder.js ne hard-code pas FR / EUR / Europe/Paris', async () => {
  const geoSrc = getGeocoderSrc();
  assert.ok(!/'FR'/.test(geoSrc), '"FR" hard-codé dans property-geocoder.js');
  assert.ok(!/'EUR'/.test(geoSrc), '"EUR" hard-codé dans property-geocoder.js');
  assert.ok(!/Europe\/Paris/.test(geoSrc), '"Europe/Paris" hard-codé dans property-geocoder.js');
  // lang=en must NOT be in the params
  assert.ok(!/lang.*en/.test(geoSrc), 'lang=en trouvé dans property-geocoder.js');
  // country=FR filter must NOT be present
  assert.ok(!/country.*FR/.test(geoSrc), 'country=FR trouvé dans property-geocoder.js');
});

console.log('\n── GEO-36–42 : R1/R2/R7/R8 — cohérence Node/SQL + edge cases ──');

await test('GEO-36 PUT UPDATE utilise $43::boolean (pas IS DISTINCT FROM $4) — source de vérité unique', async () => {
  const block = getPUTUpdateBlock();
  assert.ok(block, 'UPDATE properties SET introuvable');
  // Single source of truth: the decision must come from a parameter, not SQL string comparison
  assert.ok(/\$43::boolean/.test(block),
    '$43::boolean absent du CASE WHEN — la décision doit venir de Node, pas du SQL');
  assert.ok(!/IS DISTINCT FROM/.test(block),
    'IS DISTINCT FROM encore présent — le SQL ne doit pas recalculer le changement d\'adresse');
});

await test('GEO-37 adresse cosmétique (casse/espaces) → geo context CONSERVÉ, no Geoapify (via $43)', async () => {
  // Vérifie que addressChanged est calculé AVANT le UPDATE (avant pool.query)
  // et que c'est ce boolean qui pilote le CASE WHEN, pas la comparaison SQL directe.
  // Sans ce test, '18 rue X' → '18 RUE X ' effacerait le geo context sans recalcul.
  const block = getPUTUpdateBlock();
  assert.ok(/CASE WHEN \$43::boolean THEN NULL ELSE latitude END/.test(block),
    'latitude CASE WHEN $43 absent — adresse cosmétique pourrait effacer le geo context');
  assert.ok(/CASE WHEN \$43::boolean THEN NULL ELSE timezone END/.test(block),
    'timezone CASE WHEN $43 absent');
});

await test('GEO-38 adresse absente du payload → geo context conservé (addressChanged = false)', async () => {
  // address absent → newAddress = property.address (kept) → addressChanged = false → $43 = false
  const region = getPUTLoadPropertiesRegion();
  assert.ok(region, 'Région PUT introuvable');
  // The guard "if (newAddress && addressChanged)" ensures absent address doesn't trigger geocode
  assert.ok(/if\s*\(\s*newAddress\s*&&\s*addressChanged\s*\)/.test(region),
    'Guard "if (newAddress && addressChanged)" absent');
});

await test('GEO-39 adresse supprimée (null/vide) → geo context NULL, aucun geocode', async () => {
  // address null → addressChanged = true (normalizeAddressForComparison(null)='' ≠ old) → $43=true → CASE WHEN → NULL
  // but if (!newAddress) → no geocodePropertyAsync call
  const region = getPUTLoadPropertiesRegion();
  assert.ok(/if\s*\(\s*newAddress\s*&&\s*addressChanged\s*\)/.test(region),
    '"if (newAddress && addressChanged)" doit protéger contre le geocode sans adresse');
  // The CASE WHEN must clear geo when addressChanged=true (which is triggered for null→something)
  const block = getPUTUpdateBlock();
  assert.ok(/CASE WHEN \$43::boolean THEN NULL/.test(block),
    'CASE WHEN $43 absent — suppression adresse ne nettoierait pas le geo');
});

await test('GEO-40 resolved avec timezone=null → non resolved (contexte partiel rejeté)', async () => {
  const r = await geocodeAddress('12 Rue de la Paix, Paris', {
    _apiKey: 'test-key',
    _axios: mockAxios(makeGeoResponse({ timezone: null })),
  });
  assert.notStrictEqual(r.status, 'resolved',
    'timezone null ne doit pas permettre status=resolved (contexte partiel)');
});

await test('GEO-41 result_type inconnu / futur → pas resolved (allowlist fail-closed)', async () => {
  // ALLOWLIST policy: only 'building' and 'amenity' can reach 'resolved'.
  // null/unknown/future type → ambiguous, regardless of confidence.
  const rNull = await geocodeAddress('somewhere', {
    _apiKey: 'test-key',
    _axios: mockAxios(makeGeoResponse({ rank: { confidence: 0.99 }, result_type: null })),
  });
  assert.notStrictEqual(rNull.status, 'resolved',
    'result_type null + confidence 0.99 ne doit PAS être resolved (allowlist)');
  assert.strictEqual(rNull.status, 'ambiguous',
    `result_type null doit être ambiguous, obtenu: ${rNull.status}`);

  const rFuture = await geocodeAddress('somewhere', {
    _apiKey: 'test-key',
    _axios: mockAxios(makeGeoResponse({ rank: { confidence: 0.99 }, result_type: 'future_unknown_type' })),
  });
  assert.notStrictEqual(rFuture.status, 'resolved',
    'result_type futur inconnu ne doit PAS être resolved');
});

await test('GEO-42 confidence NaN → pas resolved (fail-closed)', async () => {
  // NaN confidence: parseFloat(NaN)=NaN, !isFinite(NaN)=true → FAILED path
  const r = await geocodeAddress('somewhere', {
    _apiKey: 'test-key',
    _axios: mockAxios({
      data: { results: [{
        lat: '48.85', lon: '2.35',
        rank: { confidence: NaN },
        result_type: 'building',
        country_code: 'fr',
        timezone: { name: 'Europe/Paris' },
      }] },
    }),
  });
  assert.notStrictEqual(r.status, 'resolved',
    'confidence NaN ne doit pas produire status=resolved');
  assert.strictEqual(r.status, 'failed',
    `confidence NaN doit produire failed, obtenu: ${r.status}`);
});

await test('GEO-43 ALLOWLIST — seuls building/amenity peuvent être resolved', async () => {
  const allowedTypes = ['building', 'amenity'];
  const bannedTypes  = ['street', 'postcode', 'district', 'city', 'suburb', null, undefined, '', 'future_type'];

  for (const rt of allowedTypes) {
    const r = await geocodeAddress('test', {
      _apiKey: 'test-key',
      _axios: mockAxios(makeGeoResponse({ rank: { confidence: 0.97 }, result_type: rt })),
    });
    assert.strictEqual(r.status, 'resolved',
      `result_type "${rt}" devrait être resolved avec confidence 0.97`);
  }

  for (const rt of bannedTypes) {
    const r = await geocodeAddress('test', {
      _apiKey: 'test-key',
      _axios: mockAxios(makeGeoResponse({ rank: { confidence: 0.99 }, result_type: rt })),
    });
    assert.notStrictEqual(r.status, 'resolved',
      `result_type "${rt}" NE DOIT PAS être resolved (hors allowlist)`);
  }
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(55)}`);
console.log(`  ${passed} passed  /  ${failed} failed  /  43 total`);
if (failures.length) {
  console.log('\n  Failures:');
  failures.forEach(f => console.log(`    ❌  ${f.name}\n       ${f.message}`));
}
console.log('─'.repeat(55));
process.exit(failed > 0 ? 1 : 0);

})();
