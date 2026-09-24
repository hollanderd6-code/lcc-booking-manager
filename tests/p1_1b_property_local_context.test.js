#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.1-B Property Local Context Foundation
 *
 * Groupes :
 *   PLC-01–PLC-05 : ALTER TABLE — colonnes créées sans DEFAULT
 *   PLC-06–PLC-10 : CHECK constraints — bornes et patterns
 *   PLC-11–PLC-15 : Row mapping — NULL = inconnu (jamais FR/EUR/Paris)
 *   PLC-16–PLC-18 : loadProperties SELECT — nouvelles colonnes incluses
 *   PLC-19–PLC-20 : Write isolation — INSERT/UPDATE ne touche pas les nouvelles colonnes
 *
 * Exécution : node tests/p1_1b_property_local_context.test.js
 * Aucun appel DB réel. Aucun appel Channex.
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
const SERVER_PATH = path.resolve(__dirname, '../server.js');
const src = fs.readFileSync(SERVER_PATH, 'utf8');

// Extrait le bloc P1.1-B (de "P1.1-B" jusqu'au prochain "// ✅ Migration")
function getP11BBlock() {
  const start = src.indexOf('P1.1-B');
  if (start === -1) return '';
  const end = src.indexOf('// ✅ Migration', start + 1);
  return end === -1 ? src.slice(start) : src.slice(start, end);
}

// Extrait la totalité du SELECT dans loadProperties (de l'ouverture jusqu'à "FROM properties")
function getLoadPropertiesSelect() {
  const match = src.match(/async function loadProperties\(\)[^{]*\{[\s\S]*?FROM properties/);
  return match ? match[0] : '';
}

// Extrait le bloc INSERT INTO properties (le premier, ~ligne 18851)
function getPropertiesInsert() {
  const idx = src.indexOf('INSERT INTO properties');
  if (idx === -1) return '';
  return src.slice(idx, idx + 1500);
}

// Extrait le bloc UPDATE properties SET name=$1 (le principal PUT /api/properties/:id)
function getPropertiesUpdate() {
  const match = src.match(/UPDATE properties\s+SET\s+name\s*=\s*\$1[\s\S]{0,2000}/);
  return match ? match[0] : '';
}

// ── Row mapping (reproduit la logique de loadProperties) ──────────────────────
function mapGeoContext(row) {
  return {
    latitude:     row.latitude     != null ? parseFloat(row.latitude)  : null,
    longitude:    row.longitude    != null ? parseFloat(row.longitude) : null,
    country_code: row.country_code ?? null,
    timezone:     row.timezone     ?? null,
    currency:     row.currency     ?? null,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
(async () => {

const p11b     = getP11BBlock();
const lpSelect = getLoadPropertiesSelect();
const insertSrc = getPropertiesInsert();
const updateSrc = getPropertiesUpdate();

// ── Sanity ────────────────────────────────────────────────────────────────────
if (!p11b) {
  console.error('❌ Bloc P1.1-B introuvable dans server.js — migration non appliquée ?');
  process.exit(1);
}
if (!lpSelect) {
  console.error('❌ loadProperties SELECT introuvable dans server.js');
  process.exit(1);
}

console.log('\n── PLC-01–PLC-05 : ALTER TABLE — colonnes sans DEFAULT ──');

await test('PLC-01 latitude NUMERIC(9,6) défini, aucun DEFAULT', async () => {
  assert.ok(/ADD COLUMN IF NOT EXISTS latitude\s+NUMERIC\(9,6\)/.test(p11b),
    'ADD COLUMN latitude NUMERIC(9,6) absent du bloc P1.1-B');
  const latLine = p11b.split('\n').find(l => /ADD COLUMN IF NOT EXISTS latitude/.test(l));
  assert.ok(latLine, 'Ligne ADD COLUMN latitude introuvable');
  assert.ok(!/DEFAULT/i.test(latLine), `DEFAULT trouvé sur la ligne latitude : "${latLine.trim()}"`);
});

await test('PLC-02 longitude NUMERIC(9,6) défini, aucun DEFAULT', async () => {
  assert.ok(/ADD COLUMN IF NOT EXISTS longitude\s+NUMERIC\(9,6\)/.test(p11b),
    'ADD COLUMN longitude NUMERIC(9,6) absent du bloc P1.1-B');
  const lngLine = p11b.split('\n').find(l => /ADD COLUMN IF NOT EXISTS longitude/.test(l));
  assert.ok(lngLine, 'Ligne ADD COLUMN longitude introuvable');
  assert.ok(!/DEFAULT/i.test(lngLine), `DEFAULT trouvé sur la ligne longitude : "${lngLine.trim()}"`);
});

await test('PLC-03 country_code TEXT défini, aucun DEFAULT', async () => {
  assert.ok(/ADD COLUMN IF NOT EXISTS country_code\s+TEXT/.test(p11b),
    'ADD COLUMN country_code TEXT absent du bloc P1.1-B');
  const line = p11b.split('\n').find(l => /ADD COLUMN IF NOT EXISTS country_code/.test(l));
  assert.ok(line, 'Ligne ADD COLUMN country_code introuvable');
  assert.ok(!/DEFAULT/i.test(line), `DEFAULT trouvé sur la ligne country_code : "${line.trim()}"`);
});

await test('PLC-04 timezone TEXT défini, aucun DEFAULT', async () => {
  assert.ok(/ADD COLUMN IF NOT EXISTS timezone\s+TEXT/.test(p11b),
    'ADD COLUMN timezone TEXT absent du bloc P1.1-B');
  const line = p11b.split('\n').find(l => /ADD COLUMN IF NOT EXISTS timezone/.test(l));
  assert.ok(line, 'Ligne ADD COLUMN timezone introuvable');
  assert.ok(!/DEFAULT/i.test(line), `DEFAULT trouvé sur la ligne timezone : "${line.trim()}"`);
});

await test('PLC-05 currency TEXT défini, aucun DEFAULT', async () => {
  assert.ok(/ADD COLUMN IF NOT EXISTS currency\s+TEXT/.test(p11b),
    'ADD COLUMN currency TEXT absent du bloc P1.1-B');
  // Match la ligne ADD COLUMN currency (pas les lignes de contrainte qui contiennent "currency ~")
  const line = p11b.split('\n').find(l => /ADD COLUMN IF NOT EXISTS currency\s/.test(l));
  assert.ok(line, 'Ligne ADD COLUMN currency introuvable');
  assert.ok(!/DEFAULT/i.test(line), `DEFAULT trouvé sur la ligne currency : "${line.trim()}"`);
});

console.log('\n── PLC-06–PLC-10 : CHECK constraints ──');

await test('PLC-06 latitude CHECK borne -90..90', async () => {
  assert.ok(/chk_properties_lat/.test(p11b), 'Contrainte chk_properties_lat absente');
  assert.ok(/latitude\s*>=\s*-90/.test(p11b), 'Borne inférieure -90 absente du CHECK latitude');
  assert.ok(/latitude\s*<=\s*90/.test(p11b),  'Borne supérieure 90 absente du CHECK latitude');
});

await test('PLC-07 longitude CHECK borne -180..180', async () => {
  assert.ok(/chk_properties_lng/.test(p11b), 'Contrainte chk_properties_lng absente');
  assert.ok(/longitude\s*>=\s*-180/.test(p11b), 'Borne inférieure -180 absente du CHECK longitude');
  assert.ok(/longitude\s*<=\s*180/.test(p11b),  'Borne supérieure 180 absente du CHECK longitude');
});

await test('PLC-08 country_code CHECK pattern ^[A-Z]{2}$', async () => {
  assert.ok(/chk_properties_country_code/.test(p11b), 'Contrainte chk_properties_country_code absente');
  assert.ok(/\[A-Z\]\{2\}/.test(p11b), 'Pattern [A-Z]{2} absent du CHECK country_code');
});

await test('PLC-09 currency CHECK pattern ^[A-Z]{3}$', async () => {
  assert.ok(/chk_properties_currency/.test(p11b), 'Contrainte chk_properties_currency absente');
  assert.ok(/\[A-Z\]\{3\}/.test(p11b), 'Pattern [A-Z]{3} absent du CHECK currency');
});

await test('PLC-10 timezone — aucun CHECK constraint (TEXT libre)', async () => {
  const tzLines = p11b.split('\n').filter(l => /timezone/.test(l));
  const hasCheck = tzLines.some(l => /CHECK/.test(l));
  assert.strictEqual(hasCheck, false,
    `CHECK trouvé sur une ligne timezone : ${tzLines.find(l => /CHECK/.test(l))?.trim()}`);
});

console.log('\n── PLC-11–PLC-15 : Row mapping NULL = inconnu ──');

await test('PLC-11 latitude null → null (pas 0, pas "FR")', async () => {
  const r = mapGeoContext({ latitude: null, longitude: null, country_code: null, timezone: null, currency: null });
  assert.strictEqual(r.latitude, null, 'latitude null doit rester null');
  assert.notStrictEqual(r.latitude, 0,    'latitude ne doit pas être 0 par défaut');
  assert.notStrictEqual(r.latitude, 'FR', 'latitude ne doit pas être "FR"');
});

await test('PLC-12 latitude numérique → parseFloat exact', async () => {
  const r = mapGeoContext({ latitude: '48.856614', longitude: '2.352222', country_code: null, timezone: null, currency: null });
  assert.strictEqual(typeof r.latitude, 'number', 'latitude doit être un number');
  assert.ok(Math.abs(r.latitude - 48.856614) < 1e-9, `latitude mal parsée : ${r.latitude}`);
  assert.ok(Math.abs(r.longitude - 2.352222) < 1e-9, `longitude mal parsée : ${r.longitude}`);
});

await test('PLC-13 country_code null → null (pas "FR")', async () => {
  const r = mapGeoContext({ latitude: null, longitude: null, country_code: null, timezone: null, currency: null });
  assert.strictEqual(r.country_code, null, 'country_code null doit rester null');
  assert.notStrictEqual(r.country_code, 'FR', 'country_code ne doit pas être "FR" par défaut');
});

await test('PLC-14 currency null → null (pas "EUR")', async () => {
  const r = mapGeoContext({ latitude: null, longitude: null, country_code: null, timezone: null, currency: null });
  assert.strictEqual(r.currency, null, 'currency null doit rester null');
  assert.notStrictEqual(r.currency, 'EUR', 'currency ne doit pas être "EUR" par défaut');
});

await test('PLC-15 timezone null → null (pas "Europe/Paris")', async () => {
  const r = mapGeoContext({ latitude: null, longitude: null, country_code: null, timezone: null, currency: null });
  assert.strictEqual(r.timezone, null, 'timezone null doit rester null');
  assert.notStrictEqual(r.timezone, 'Europe/Paris', 'timezone ne doit pas être "Europe/Paris" par défaut');
});

console.log('\n── PLC-16–PLC-18 : loadProperties SELECT ──');

await test('PLC-16 loadProperties SELECT inclut latitude et longitude', async () => {
  assert.ok(/\blatitude\b/.test(lpSelect),  'latitude absent du SELECT loadProperties');
  assert.ok(/\blongitude\b/.test(lpSelect), 'longitude absent du SELECT loadProperties');
});

await test('PLC-17 loadProperties SELECT inclut country_code, timezone, currency', async () => {
  assert.ok(/\bcountry_code\b/.test(lpSelect), 'country_code absent du SELECT loadProperties');
  assert.ok(/\btimezone\b/.test(lpSelect),     'timezone absent du SELECT loadProperties');
  assert.ok(/\bcurrency\b/.test(lpSelect),     'currency absent du SELECT loadProperties');
});

await test('PLC-18 loadProperties SELECT ne hard-code pas FR/EUR/Paris', async () => {
  assert.ok(!/COALESCE[^)]*'FR'/.test(lpSelect),          'COALESCE FR trouvé dans loadProperties SELECT');
  assert.ok(!/COALESCE[^)]*'EUR'/.test(lpSelect),         'COALESCE EUR trouvé dans loadProperties SELECT');
  assert.ok(!/Europe\/Paris/.test(lpSelect),              'Europe/Paris trouvé dans loadProperties SELECT');
  assert.ok(!/'FR'\s*AS\s*country_code/i.test(lpSelect),  '"FR" AS country_code trouvé dans SELECT');
});

console.log('\n── PLC-19–PLC-20 : Write isolation INSERT/UPDATE ──');

await test('PLC-19 INSERT properties ne contient pas les colonnes geo/locale', async () => {
  assert.ok(insertSrc, 'INSERT INTO properties introuvable dans server.js');
  const valuesIdx = insertSrc.indexOf('VALUES');
  const columnList = valuesIdx !== -1 ? insertSrc.slice(0, valuesIdx) : insertSrc;
  const forbidden = ['latitude', 'longitude', 'country_code', 'timezone'];
  for (const col of forbidden) {
    assert.ok(!new RegExp(`\\b${col}\\b`).test(columnList),
      `INSERT contient "${col}" dans la liste de colonnes — ne doit pas être écrit par client`);
  }
});

await test('PLC-20 UPDATE properties ne set pas les colonnes geo/locale via paramètre client ($N)', async () => {
  // P1.1-C2 ajoute "latitude = CASE WHEN address IS DISTINCT FROM $4 THEN NULL ELSE latitude END"
  // (logique serveur pure — pas un paramètre client). Ce test vérifie qu'aucune colonne
  // geo/locale n'est assignée directement à un paramètre $N (écrit par le client).
  assert.ok(updateSrc, 'UPDATE properties SET introuvable dans server.js');
  const whereIdx = updateSrc.indexOf('WHERE');
  const setBlock = whereIdx !== -1 ? updateSrc.slice(0, whereIdx) : updateSrc;
  // B4-E: currency is now intentionally client-writable via PUT /api/properties/:propertyId
  const forbidden = ['latitude', 'longitude', 'country_code', 'timezone'];
  for (const col of forbidden) {
    // CASE WHEN autorisé (serveur), affectation directe à $N interdite (client)
    assert.ok(!new RegExp(`\\b${col}\\s*=\\s*\\$\\d`).test(setBlock),
      `UPDATE assigne "${col}" à un paramètre client $N — ne doit pas être écrit directement par le client`);
  }
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(55)}`);
console.log(`  ${passed} passed  /  ${failed} failed  /  20 total`);
if (failures.length) {
  console.log('\n  Failures:');
  failures.forEach(f => console.log(`    ❌  ${f.name}\n       ${f.message}`));
}
console.log('─'.repeat(55));
process.exit(failed > 0 ? 1 : 0);

})();
