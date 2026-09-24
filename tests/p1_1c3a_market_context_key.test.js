#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.1-C3A Market Context Identity Foundation
 *
 * Groupes :
 *   MCK-01–MCK-13 : computeMarketContextKey — validation des entrées → null
 *   MCK-14–MCK-18 : computeMarketContextKey — format des sorties valides
 *   MCK-19–MCK-23 : computeMarketContextKey — bornes et cas limites
 *   MCK-24–MCK-25 : Source checks — migration server.js + write paths cron
 *
 * Exécution : node tests/p1_1c3a_market_context_key.test.js
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

// ── Module sous test ──────────────────────────────────────────────────────────
const { computeMarketContextKey } = require('../routes/market-context-key');

// ── Source text helpers ───────────────────────────────────────────────────────
const SERVER_SRC = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
const CRON_SRC   = fs.readFileSync(path.resolve(__dirname, '../routes/dynamic-pricing-cron.js'), 'utf8');

// ── Tests ─────────────────────────────────────────────────────────────────────
(async () => {

console.log('\n── MCK-01–MCK-04 : inputs null/undefined → null ──');

await test('MCK-01 tous inputs null → null', async () => {
  assert.strictEqual(computeMarketContextKey({ countryCode: null, latitude: null, longitude: null }), null);
});

await test('MCK-02 countryCode null → null (lat/lng valides)', async () => {
  assert.strictEqual(computeMarketContextKey({ countryCode: null, latitude: 48.86, longitude: 2.35 }), null);
});

await test('MCK-03 latitude null → null', async () => {
  assert.strictEqual(computeMarketContextKey({ countryCode: 'FR', latitude: null, longitude: 2.35 }), null);
});

await test('MCK-04 longitude null → null', async () => {
  assert.strictEqual(computeMarketContextKey({ countryCode: 'FR', latitude: 48.86, longitude: null }), null);
});

console.log('\n── MCK-05–MCK-07 : countryCode format invalide → null ──');

await test('MCK-05 countryCode minuscule ("fr") → null', async () => {
  assert.strictEqual(computeMarketContextKey({ countryCode: 'fr', latitude: 48.86, longitude: 2.35 }), null);
});

await test('MCK-06 countryCode 3 chars ("FRA") → null', async () => {
  assert.strictEqual(computeMarketContextKey({ countryCode: 'FRA', latitude: 48.86, longitude: 2.35 }), null);
});

await test('MCK-07 countryCode 1 char ou vide → null', async () => {
  assert.strictEqual(computeMarketContextKey({ countryCode: 'F', latitude: 48.86, longitude: 2.35 }), null);
  assert.strictEqual(computeMarketContextKey({ countryCode: '', latitude: 48.86, longitude: 2.35 }), null);
});

console.log('\n── MCK-08–MCK-13 : latitude/longitude invalides → null ──');

await test('MCK-08 latitude NaN → null', async () => {
  assert.strictEqual(computeMarketContextKey({ countryCode: 'FR', latitude: NaN, longitude: 2.35 }), null);
});

await test('MCK-09 latitude Infinity → null', async () => {
  assert.strictEqual(computeMarketContextKey({ countryCode: 'FR', latitude: Infinity, longitude: 2.35 }), null);
  assert.strictEqual(computeMarketContextKey({ countryCode: 'FR', latitude: -Infinity, longitude: 2.35 }), null);
});

await test('MCK-10 latitude > 90 → null', async () => {
  assert.strictEqual(computeMarketContextKey({ countryCode: 'FR', latitude: 90.001, longitude: 2.35 }), null);
});

await test('MCK-11 latitude < -90 → null', async () => {
  assert.strictEqual(computeMarketContextKey({ countryCode: 'FR', latitude: -90.001, longitude: 2.35 }), null);
});

await test('MCK-12 longitude > 180 → null', async () => {
  assert.strictEqual(computeMarketContextKey({ countryCode: 'FR', latitude: 48.86, longitude: 180.001 }), null);
});

await test('MCK-13 longitude < -180 → null', async () => {
  assert.strictEqual(computeMarketContextKey({ countryCode: 'FR', latitude: 48.86, longitude: -180.001 }), null);
});

console.log('\n── MCK-14–MCK-18 : format des sorties valides ──');

await test('MCK-14 Paris → "FR:48.86:2.35"', async () => {
  const key = computeMarketContextKey({ countryCode: 'FR', latitude: 48.8566, longitude: 2.3522 });
  assert.strictEqual(key, 'FR:48.86:2.35');
});

await test('MCK-15 Tokyo → "JP:35.68:139.65"', async () => {
  const key = computeMarketContextKey({ countryCode: 'JP', latitude: 35.6762, longitude: 139.6503 });
  assert.strictEqual(key, 'JP:35.68:139.65');
});

await test('MCK-16 Sydney (lat négative) → "AU:-33.87:151.21"', async () => {
  const key = computeMarketContextKey({ countryCode: 'AU', latitude: -33.8688, longitude: 151.2093 });
  assert.strictEqual(key, 'AU:-33.87:151.21');
});

await test('MCK-17 New York (lng négative) → "US:40.71:-74.01"', async () => {
  const key = computeMarketContextKey({ countryCode: 'US', latitude: 40.7128, longitude: -74.006 });
  assert.strictEqual(key, 'US:40.71:-74.01');
});

await test('MCK-18 zéro négatif → "ZZ:0.00:0.00" (pas "-0.00")', async () => {
  const key = computeMarketContextKey({ countryCode: 'ZZ', latitude: -0, longitude: -0 });
  assert.strictEqual(key, 'ZZ:0.00:0.00', `Zéro négatif mal canonicalisé : "${key}"`);
  assert.ok(!key.includes('-0'), `"-0" trouvé dans la clé : "${key}"`);
});

console.log('\n── MCK-19–MCK-23 : bornes et cas limites ──');

await test('MCK-19 latitude = 90 (borne max) → valide', async () => {
  const key = computeMarketContextKey({ countryCode: 'XX', latitude: 90, longitude: 0 });
  assert.strictEqual(key, 'XX:90.00:0.00');
});

await test('MCK-20 latitude = -90 (borne min) → valide', async () => {
  const key = computeMarketContextKey({ countryCode: 'XX', latitude: -90, longitude: 0 });
  assert.strictEqual(key, 'XX:-90.00:0.00');
});

await test('MCK-21 latitude = 90.001 → null (hors borne)', async () => {
  assert.strictEqual(computeMarketContextKey({ countryCode: 'XX', latitude: 90.001, longitude: 0 }), null);
});

await test('MCK-22 longitude = 180 (borne max) → valide', async () => {
  const key = computeMarketContextKey({ countryCode: 'XX', latitude: 0, longitude: 180 });
  assert.strictEqual(key, 'XX:0.00:180.00');
});

await test('MCK-23 longitude = -180.001 → null (hors borne)', async () => {
  assert.strictEqual(computeMarketContextKey({ countryCode: 'XX', latitude: 0, longitude: -180.001 }), null);
});

console.log('\n── MCK-24–MCK-25 : source checks ──');

await test('MCK-24 server.js contient la migration market_context_key (P1.1-C3A)', async () => {
  assert.ok(
    /ALTER TABLE market_data ADD COLUMN IF NOT EXISTS market_context_key/.test(SERVER_SRC),
    'Migration market_context_key absente de server.js'
  );
  assert.ok(/P1\.1-C3A/.test(SERVER_SRC), 'Label P1.1-C3A absent du commentaire de migration dans server.js');
});

await test('MCK-25 dynamic-pricing-cron.js — writeScrapeResult inclut market_context_key + les deux write paths l\'appellent', async () => {
  // C3B a centralisé l'UPSERT dans writeScrapeResult — vérifier la fonction helper
  const insertMatches = [...CRON_SRC.matchAll(/INSERT INTO market_data[\s\S]*?scraped_at\s*=\s*NOW\(\)/g)];
  assert.ok(insertMatches.length >= 1, `Aucun bloc INSERT market_data trouvé`);
  const block = insertMatches[0][0];
  assert.ok(/market_context_key/.test(block), 'writeScrapeResult ne contient pas market_context_key');
  assert.ok(/market_context_key\s*=\s*EXCLUDED\.market_context_key/.test(block),
    'writeScrapeResult ne contient pas "market_context_key = EXCLUDED.market_context_key"');
  // Les deux write paths doivent appeler writeScrapeResult
  const callCount = (CRON_SRC.match(/\bwriteScrapeResult\b/g) || []).length;
  assert.ok(callCount >= 3, `writeScrapeResult doit être défini (1×) + appelé (2×), trouvé ${callCount}×`);
  assert.ok(/capturedContextKey/.test(CRON_SRC), 'capturedContextKey absent des appels writeScrapeResult');
});

console.log('\n── MCK-26–MCK-28 : R5 — support des strings NUMERIC PostgreSQL ──');

await test('MCK-26 string NUMERIC DB (latitude "48.856600", longitude "2.352200") → clé valide', async () => {
  const key = computeMarketContextKey({ countryCode: 'FR', latitude: '48.856600', longitude: '2.352200' });
  assert.strictEqual(key, 'FR:48.86:2.35', `Clé inattendue : "${key}"`);
});

await test('MCK-27 string mal formée ("48abc") → null', async () => {
  assert.strictEqual(computeMarketContextKey({ countryCode: 'FR', latitude: '48abc', longitude: '2.35' }), null);
  assert.strictEqual(computeMarketContextKey({ countryCode: 'FR', latitude: '48.86', longitude: '2.abc' }), null);
});

await test('MCK-28 string vide ou "NaN" → null', async () => {
  assert.strictEqual(computeMarketContextKey({ countryCode: 'FR', latitude: '', longitude: '2.35' }), null);
  assert.strictEqual(computeMarketContextKey({ countryCode: 'FR', latitude: 'NaN', longitude: '2.35' }), null);
  assert.strictEqual(computeMarketContextKey({ countryCode: 'FR', latitude: '48.86', longitude: '   ' }), null);
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(55)}`);
console.log(`  ${passed} passed  /  ${failed} failed  /  28 total`);
if (failures.length) {
  console.log('\n  Failures:');
  failures.forEach(f => console.log(`    ❌  ${f.name}\n       ${f.message}`));
}
console.log('─'.repeat(55));
if (passed + failed !== 28) {
  console.error(`⚠️  Attendu 28 tests, ${passed + failed} exécutés`);
  process.exit(1);
}
process.exit(failed > 0 ? 1 : 0);

})();
