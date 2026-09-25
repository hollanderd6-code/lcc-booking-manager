#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.2-B4-C Property Currency Acquisition
 *
 * Verifies that fresh market acquisition uses the authoritative properties.currency
 * rather than any global MARKET_REQUEST_CURRENCY constant.
 *
 * Groups:
 *   B4C-01–04 : MARKET_REQUEST_CURRENCY removed; scrapeWithApify API changed
 *   B4C-05–08 : scrapeBestZone / scrapeZone propagate requestedCurrency
 *   B4C-09–12 : weekly loop (runDynamicPricingJob) per-property currency
 *   B4C-13–16 : weekly loop unknown-currency guard
 *   B4C-17–18 : zone cache is currency-aware
 *   B4C-19–22 : one-property path (runDynamicPricingForOneProperty) per-property currency
 *   B4C-23–24 : one-property unknown-currency guard (behavioral)
 *   B4C-25–26 : mock mode respects unknown-currency guard
 *   B4C-27–28 : no EUR fallback anywhere
 *
 * Run: node tests/p1_2b4c_property_currency_acquisition.test.js
 * No real DB / Apify / Channex calls.
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

// ── Runner ─────────────────────────────────────────────────────────────────────
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

// ── Source ─────────────────────────────────────────────────────────────────────
const CRON_SRC = fs.readFileSync(path.resolve(__dirname, '../routes/dynamic-pricing-cron.js'), 'utf8');

// ── Module under test ──────────────────────────────────────────────────────────
const cronModule = require('../routes/dynamic-pricing-cron');
const { writeScrapeResult, runDynamicPricingForOneProperty } = cronModule;

// ── Helpers ────────────────────────────────────────────────────────────────────
function makeConnectPool(cfgRow, marketDataExists = false, onInsert = null) {
  return {
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, ' ').trim();
      // pricing_config + property join
      if (/FROM pricing_config pc.*JOIN properties/i.test(s)) {
        return { rows: cfgRow ? [cfgRow] : [] };
      }
      // market_data existence check
      if (/FROM market_data WHERE property_id/i.test(s) && /LIMIT 1/i.test(s)) {
        return { rows: marketDataExists ? [{ '?column?': 1 }] : [] };
      }
      return { rows: [] };
    },
    async connect() {
      const client = {
        async query(sql, params = []) {
          const s = sql.replace(/\s+/g, ' ').trim();
          if (/BEGIN/i.test(s) || /COMMIT/i.test(s) || /ROLLBACK/i.test(s)) return { rows: [] };
          if (/SELECT country_code, latitude, longitude/i.test(s)) {
            return { rows: [{ country_code: cfgRow?.country_code || 'FR', latitude: cfgRow?.latitude || 48.85, longitude: cfgRow?.longitude || 2.35 }] };
          }
          if (/INSERT INTO market_data/i.test(s)) {
            if (onInsert) onInsert(sql, params);
            return { rows: [] };
          }
          return { rows: [] };
        },
        release() {},
      };
      return client;
    },
  };
}

function makeCfg(overrides = {}) {
  return {
    user_id: 'u1', property_id: 'p1',
    property_name: 'TestProp', property_address: '1 rue de la Paix 75001 Paris',
    is_active: true, mode: 'manual',
    price_min: '80', price_max: '200', base_price: '120',
    bedrooms: 2, country_code: 'FR', latitude: 48.85, longitude: 2.35,
    currency: 'EUR',
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

(async () => {

console.log('\n── B4C-01–04 : MARKET_REQUEST_CURRENCY removed; scrapeWithApify API changed ──');

await test('B4C-01 MARKET_REQUEST_CURRENCY constant is removed from cron module', () => {
  assert.ok(
    !/const MARKET_REQUEST_CURRENCY\s*=/.test(CRON_SRC),
    'MARKET_REQUEST_CURRENCY constant must not exist in cron module after B4-C'
  );
});

await test('B4C-02 scrapeWithApify signature includes requestedCurrency as third parameter', () => {
  const fnMatch = CRON_SRC.match(/async function scrapeWithApify\s*\(([^)]+)\)/);
  assert.ok(fnMatch, 'scrapeWithApify function not found');
  assert.ok(
    /requestedCurrency/.test(fnMatch[1]),
    `scrapeWithApify must have requestedCurrency parameter, got: ${fnMatch[1]}`
  );
});

await test('B4C-03 scrapeWithApify throws when requestedCurrency is missing/falsy', () => {
  assert.ok(
    /if\s*\(!requestedCurrency\)\s*throw/.test(CRON_SRC),
    'scrapeWithApify must throw when requestedCurrency is missing'
  );
});

await test('B4C-04 Apify actor body uses requestedCurrency variable (not MARKET_REQUEST_CURRENCY or EUR literal)', () => {
  const apifyBodyMatch = CRON_SRC.match(/body:\s*JSON\.stringify\(\{[\s\S]{0,400}?\}\)/);
  assert.ok(apifyBodyMatch, 'Apify body JSON.stringify block not found');
  assert.ok(
    /currency\s*:\s*requestedCurrency/.test(apifyBodyMatch[0]),
    "Apify body must use requestedCurrency variable"
  );
  assert.ok(
    !/currency\s*:\s*['"]EUR['"]/.test(apifyBodyMatch[0]),
    "Apify body must not use bare 'EUR' literal"
  );
});

console.log('\n── B4C-05–08 : scrapeBestZone / scrapeZone propagate requestedCurrency ──');

await test('B4C-05 scrapeZone signature includes requestedCurrency parameter', () => {
  const fnMatch = CRON_SRC.match(/async function scrapeZone\s*\(([^)]+)\)/);
  assert.ok(fnMatch, 'scrapeZone function not found');
  assert.ok(
    /requestedCurrency/.test(fnMatch[1]),
    `scrapeZone must have requestedCurrency parameter, got: ${fnMatch[1]}`
  );
});

await test('B4C-06 scrapeZone passes requestedCurrency to marketProvider.scrape (B5-D wired)', () => {
  const fnIdx = CRON_SRC.indexOf('async function scrapeZone');
  assert.ok(fnIdx !== -1, 'scrapeZone not found');
  const fnBody = CRON_SRC.slice(fnIdx, fnIdx + 800);
  assert.ok(
    /marketProvider\.scrape\s*\([^)]*requestedCurrency/.test(fnBody),
    'scrapeZone must pass requestedCurrency to marketProvider.scrape (B5-D wired)'
  );
});

await test('B4C-07 scrapeBestZone signature includes requestedCurrency parameter', () => {
  const fnMatch = CRON_SRC.match(/async function scrapeBestZone\s*\(([^)]+)\)/);
  assert.ok(fnMatch, 'scrapeBestZone function not found');
  assert.ok(
    /requestedCurrency/.test(fnMatch[1]),
    `scrapeBestZone must have requestedCurrency parameter, got: ${fnMatch[1]}`
  );
});

await test('B4C-08 scrapeBestZone passes requestedCurrency to scrapeZone', () => {
  const fnIdx = CRON_SRC.indexOf('async function scrapeBestZone');
  assert.ok(fnIdx !== -1, 'scrapeBestZone not found');
  const fnBody = CRON_SRC.slice(fnIdx, fnIdx + 800);
  assert.ok(
    /scrapeZone\s*\([^)]*requestedCurrency/.test(fnBody),
    'scrapeBestZone must pass requestedCurrency to scrapeZone'
  );
});

console.log('\n── B4C-09–12 : weekly loop per-property currency ──');

await test('B4C-09 runDynamicPricingJob SELECT includes p.currency', () => {
  const fnIdx = CRON_SRC.indexOf('async function runDynamicPricingJob');
  assert.ok(fnIdx !== -1, 'runDynamicPricingJob not found');
  const fnBody = CRON_SRC.slice(fnIdx, fnIdx + 1200);
  assert.ok(
    /p\.currency/.test(fnBody),
    'p.currency missing from runDynamicPricingJob SELECT'
  );
});

await test('B4C-10 weekly loop normalizes cfg.currency into capturedPropertyCurrency', () => {
  const fnIdx = CRON_SRC.indexOf('async function runDynamicPricingJob');
  assert.ok(fnIdx !== -1, 'runDynamicPricingJob not found');
  const fnBody = CRON_SRC.slice(fnIdx, fnIdx + 4000);
  assert.ok(
    /const capturedPropertyCurrency = normalizeMarketCurrency\(cfg\.currency\)/.test(fnBody),
    'weekly loop must capture capturedPropertyCurrency = normalizeMarketCurrency(cfg.currency)'
  );
});

await test('B4C-11 weekly scrapeBestZone call passes capturedPropertyCurrency', () => {
  const fnIdx = CRON_SRC.indexOf('async function runDynamicPricingJob');
  assert.ok(fnIdx !== -1, 'runDynamicPricingJob not found');
  const fnBody = CRON_SRC.slice(fnIdx, fnIdx + 4000);
  assert.ok(
    /scrapeBestZone[\s\S]{0,400}capturedPropertyCurrency/.test(fnBody),
    'weekly scrapeBestZone must receive capturedPropertyCurrency'
  );
});

await test('B4C-12 weekly writeScrapeResult call passes capturedPropertyCurrency', () => {
  const fnIdx = CRON_SRC.indexOf('async function runDynamicPricingJob');
  assert.ok(fnIdx !== -1, 'runDynamicPricingJob not found');
  const fnBody = CRON_SRC.slice(fnIdx, fnIdx + 6000);
  // B4-D renamed parameter; callers now use shorthand notation
  assert.ok(
    /writeScrapeResult\([\s\S]{0,500}capturedPropertyCurrency/.test(fnBody),
    'weekly writeScrapeResult must pass capturedPropertyCurrency'
  );
});

console.log('\n── B4C-13–16 : weekly loop unknown-currency guard ──');

await test('B4C-13 weekly loop has unknown-currency guard before scrape', () => {
  const fnIdx = CRON_SRC.indexOf('async function runDynamicPricingJob');
  assert.ok(fnIdx !== -1, 'runDynamicPricingJob not found');
  const fnBody = CRON_SRC.slice(fnIdx, fnIdx + 4000);
  assert.ok(
    /if\s*\(!capturedPropertyCurrency\)/.test(fnBody),
    'weekly loop must have if(!capturedPropertyCurrency) guard'
  );
});

await test('B4C-14 weekly unknown-currency guard calls applyDynamicPricingForProperty with marketOverride=null', () => {
  const fnIdx = CRON_SRC.indexOf('async function runDynamicPricingJob');
  assert.ok(fnIdx !== -1, 'runDynamicPricingJob not found');
  const fnBody = CRON_SRC.slice(fnIdx, fnIdx + 4000);
  const guardIdx = fnBody.indexOf('if (!capturedPropertyCurrency)');
  assert.ok(guardIdx !== -1, 'unknown-currency guard not found in weekly loop');
  const guardBlock = fnBody.slice(guardIdx, guardIdx + 600);
  assert.ok(
    /marketOverride:\s*null/.test(guardBlock),
    'unknown-currency guard must pass marketOverride: null to applyDynamicPricingForProperty'
  );
  assert.ok(
    /isMock:\s*false/.test(guardBlock),
    'unknown-currency guard must pass isMock: false'
  );
});

await test('B4C-15 weekly unknown-currency guard pushes result into results array', () => {
  const fnIdx = CRON_SRC.indexOf('async function runDynamicPricingJob');
  assert.ok(fnIdx !== -1, 'runDynamicPricingJob not found');
  const fnBody = CRON_SRC.slice(fnIdx, fnIdx + 4000);
  const guardIdx = fnBody.indexOf('if (!capturedPropertyCurrency)');
  const guardBlock = fnBody.slice(guardIdx, guardIdx + 1200);
  assert.ok(
    /results\.push\(/.test(guardBlock),
    'unknown-currency guard must push result into results array'
  );
  assert.ok(
    /continue/.test(guardBlock),
    'unknown-currency guard must continue to next property'
  );
});

await test('B4C-16 weekly unknown-currency guard does NOT call writeScrapeResult', () => {
  const fnIdx = CRON_SRC.indexOf('async function runDynamicPricingJob');
  assert.ok(fnIdx !== -1, 'runDynamicPricingJob not found');
  const fnBody = CRON_SRC.slice(fnIdx, fnIdx + 4000);
  const guardIdx = fnBody.indexOf('if (!capturedPropertyCurrency)');
  assert.ok(guardIdx !== -1, 'unknown-currency guard not found');
  const guardBlock = fnBody.slice(guardIdx, guardIdx + 800);
  assert.ok(
    !/writeScrapeResult/.test(guardBlock),
    'unknown-currency guard must NOT call writeScrapeResult'
  );
});

console.log('\n── B4C-17–18 : zone cache is currency-aware ──');

await test('B4C-17 cache key includes currency (zones + ":EUR" style)', () => {
  assert.ok(
    /cacheKey\s*=\s*zones\.join\(['"]\|['"]\)\s*\+\s*['"]:['"]/.test(CRON_SRC),
    'zone cache key must concatenate zones.join("|") + ":" + currency'
  );
  assert.ok(
    /capturedPropertyCurrency/.test(CRON_SRC.match(/cacheKey\s*=.*\n/)?.[0] || ''),
    'cache key must incorporate capturedPropertyCurrency'
  );
});

await test('B4C-18 unknown-currency properties are never inserted into zone cache', () => {
  // Unknown-currency properties hit the guard and `continue` before the cacheKey lookup.
  // The cache lookup `if (!zoneCache[cacheKey])` must appear AFTER the unknown-currency guard.
  const fnIdx = CRON_SRC.indexOf('async function runDynamicPricingJob');
  assert.ok(fnIdx !== -1, 'runDynamicPricingJob not found');
  const fnBody = CRON_SRC.slice(fnIdx, fnIdx + 4000);
  const guardIdx = fnBody.indexOf('if (!capturedPropertyCurrency)');
  const cacheIdx = fnBody.indexOf('if (!zoneCache[cacheKey])');
  assert.ok(guardIdx !== -1, 'unknown-currency guard not found');
  assert.ok(cacheIdx !== -1, 'zone cache lookup not found');
  assert.ok(
    guardIdx < cacheIdx,
    'unknown-currency guard must appear before zone cache lookup'
  );
});

console.log('\n── B4C-19–22 : one-property path per-property currency ──');

await test('B4C-19 runDynamicPricingForOneProperty SELECT includes p.currency', () => {
  const fnIdx = CRON_SRC.indexOf('async function runDynamicPricingForOneProperty');
  assert.ok(fnIdx !== -1, 'runDynamicPricingForOneProperty not found');
  const fnBody = CRON_SRC.slice(fnIdx, fnIdx + 800);
  assert.ok(
    /p\.currency/.test(fnBody),
    'p.currency missing from runDynamicPricingForOneProperty SELECT'
  );
});

await test('B4C-20 one-property path normalizes cfg.currency into capturedPropertyCurrency', () => {
  const fnIdx = CRON_SRC.indexOf('async function runDynamicPricingForOneProperty');
  assert.ok(fnIdx !== -1, 'runDynamicPricingForOneProperty not found');
  const fnBody = CRON_SRC.slice(fnIdx, fnIdx + 3000);
  assert.ok(
    /const capturedPropertyCurrency = normalizeMarketCurrency\(cfg\.currency\)/.test(fnBody),
    'one-property path must capture capturedPropertyCurrency = normalizeMarketCurrency(cfg.currency)'
  );
});

await test('B4C-21 one-property scrapeBestZone call passes capturedPropertyCurrency', () => {
  const fnIdx = CRON_SRC.indexOf('async function runDynamicPricingForOneProperty');
  assert.ok(fnIdx !== -1, 'runDynamicPricingForOneProperty not found');
  const fnBody = CRON_SRC.slice(fnIdx, fnIdx + 3000);
  assert.ok(
    /scrapeBestZone[\s\S]{0,300}capturedPropertyCurrency/.test(fnBody),
    'one-property scrapeBestZone must receive capturedPropertyCurrency'
  );
});

await test('B4C-22 one-property writeScrapeResult call passes capturedPropertyCurrency', () => {
  const fnIdx = CRON_SRC.indexOf('async function runDynamicPricingForOneProperty');
  assert.ok(fnIdx !== -1, 'runDynamicPricingForOneProperty not found');
  const fnBody = CRON_SRC.slice(fnIdx, fnIdx + 3000);
  // B4-D renamed parameter; caller now uses shorthand notation
  assert.ok(
    /writeScrapeResult\([\s\S]{0,500}capturedPropertyCurrency/.test(fnBody),
    'one-property writeScrapeResult must pass capturedPropertyCurrency'
  );
});

console.log('\n── B4C-23–24 : one-property unknown-currency guard (behavioral) ──');

await test('B4C-23 runDynamicPricingForOneProperty returns ok:true with null marketStats when currency unknown', async () => {
  // Behavioral: verify return value shape (applyDynamicPricingForProperty uses destructured import
  // so module-level patching is not reliable — verify via return value + source text).
  const cfgRow = makeCfg({ currency: null });  // normalizes to null
  const pool   = makeConnectPool(cfgRow, false);

  const result = await runDynamicPricingForOneProperty(pool, {
    userId: 'u1', propertyId: 'p1', sendPushNotification: null,
  });

  assert.ok(result.ok === true, `Expected ok:true, got: ${JSON.stringify(result)}`);
  assert.ok(result.isMock === false, `Expected isMock:false, got: ${result.isMock}`);
  assert.ok(result.marketStats === null, `Expected marketStats:null, got: ${JSON.stringify(result.marketStats)}`);

  // Source-text: unknown-currency guard must call applyDynamicPricingForProperty with the right args
  const fnIdx = CRON_SRC.indexOf('async function runDynamicPricingForOneProperty');
  const fnBody = CRON_SRC.slice(fnIdx, fnIdx + 3000);
  const guardIdx = fnBody.indexOf('if (!capturedPropertyCurrency)');
  const guardBlock = fnBody.slice(guardIdx, guardIdx + 600);
  assert.ok(
    /applyDynamicPricingForProperty/.test(guardBlock),
    'unknown-currency guard must call applyDynamicPricingForProperty'
  );
  assert.ok(
    /marketOverride:\s*null/.test(guardBlock),
    'unknown-currency guard must pass marketOverride: null'
  );
  assert.ok(
    /isMock:\s*false/.test(guardBlock),
    'unknown-currency guard must pass isMock: false'
  );
});

await test('B4C-24 runDynamicPricingForOneProperty does NOT call writeScrapeResult when currency unknown', async () => {
  const cfgRow = makeCfg({ currency: 'not-valid-!!' });  // normalizes to null
  let writeCalled = false;
  const pool = makeConnectPool(cfgRow, false, () => { writeCalled = true; });

  const applyModule = require('../routes/pricing-apply');
  const originalApply = applyModule.applyDynamicPricingForProperty;
  applyModule.applyDynamicPricingForProperty = async () => ({ status: 'skipped', nights: 0 });

  try {
    await runDynamicPricingForOneProperty(pool, {
      userId: 'u1', propertyId: 'p1', sendPushNotification: null,
    });
    assert.ok(!writeCalled, 'writeScrapeResult (INSERT market_data) must NOT be called when currency is unknown');
  } finally {
    applyModule.applyDynamicPricingForProperty = originalApply;
  }
});

console.log('\n── B4C-25–26 : mock mode respects unknown-currency guard ──');

await test('B4C-25 mock path (MOCK_MODE) also respects unknown-currency guard in one-property path', () => {
  // scrapeZone in MOCK_MODE never calls scrapeWithApify — but the unknown-currency guard
  // fires before scrapeBestZone is even reached, so mock mode is irrelevant.
  // Source-text check: guard must be before scrapeBestZone call in one-property path.
  const fnIdx = CRON_SRC.indexOf('async function runDynamicPricingForOneProperty');
  assert.ok(fnIdx !== -1, 'runDynamicPricingForOneProperty not found');
  const fnBody = CRON_SRC.slice(fnIdx, fnIdx + 3000);
  const guardIdx = fnBody.indexOf('if (!capturedPropertyCurrency)');
  const scrapeIdx = fnBody.indexOf('scrapeBestZone(');
  assert.ok(guardIdx !== -1, 'unknown-currency guard not found in one-property path');
  assert.ok(scrapeIdx !== -1, 'scrapeBestZone call not found in one-property path');
  assert.ok(
    guardIdx < scrapeIdx,
    'unknown-currency guard must appear before scrapeBestZone call'
  );
});

await test('B4C-26 mock path for weekly loop also has unknown-currency guard before scrapeBestZone', () => {
  const fnIdx = CRON_SRC.indexOf('async function runDynamicPricingJob');
  assert.ok(fnIdx !== -1, 'runDynamicPricingJob not found');
  const fnBody = CRON_SRC.slice(fnIdx, fnIdx + 4000);
  const guardIdx = fnBody.indexOf('if (!capturedPropertyCurrency)');
  const cacheIdx = fnBody.indexOf('if (!zoneCache[cacheKey])');
  assert.ok(guardIdx !== -1, 'unknown-currency guard not found in weekly loop');
  assert.ok(cacheIdx !== -1, 'zone cache lookup not found in weekly loop');
  assert.ok(
    guardIdx < cacheIdx,
    'guard must appear before scrapeBestZone (cache lookup) in weekly loop'
  );
});

console.log('\n── B4C-27–28 : no EUR fallback anywhere ──');

await test('B4C-27 no EUR fallback in scrapeWithApify, scrapeZone, scrapeBestZone, or acquisition paths', () => {
  // Forbidden patterns per B4-C spec
  const forbidden = [
    /propertyCurrency\s*\|\|\s*['"]EUR['"]/,
    /propertyCurrency\s*\|\|\s*MARKET_REQUEST_CURRENCY/,
    /currency\s*\?\?\s*['"]EUR['"]/,
    /requestedCurrency\s*\|\|\s*['"]EUR['"]/,
    /requestedCurrency\s*\?\?\s*['"]EUR['"]/,
  ];
  for (const pattern of forbidden) {
    assert.ok(
      !pattern.test(CRON_SRC),
      `Forbidden EUR fallback pattern found: ${pattern}`
    );
  }
});

await test('B4C-28 currency constant removed and MARKET_REQUEST_CURRENCY not referenced anywhere in cron', () => {
  assert.ok(
    !/MARKET_REQUEST_CURRENCY/.test(CRON_SRC.replace(/\/\/.*/g, '')),
    'MARKET_REQUEST_CURRENCY still referenced (outside comments) in cron module after B4-C'
  );
});

// ── Summary ────────────────────────────────────────────────────────────────────
const TOTAL = 28;
console.log(`\n${'─'.repeat(55)}`);
console.log(`  ${passed} passed  /  ${failed} failed  /  ${TOTAL} total`);
if (failures.length) {
  console.log('\n  Failures:');
  failures.forEach(f => console.log(`    ❌  ${f.name}\n       ${f.message}`));
}
console.log('─'.repeat(55));
if (passed + failed !== TOTAL) {
  console.error(`⚠️  Expected ${TOTAL} tests, ${passed + failed} ran`);
  process.exit(1);
}
process.exit(failed > 0 ? 1 : 0);

})();
