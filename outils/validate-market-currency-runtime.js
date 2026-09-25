#!/usr/bin/env node
'use strict';
require('dotenv').config();
/**
 * P1.2-B4-H — Controlled Production Runtime Validation
 *
 * Validates the full B4 market pipeline end-to-end for ONE property:
 *   properties.currency → Apify scrape → CAS geo → CAS currency
 *   → market_data write → classifyMarketData → live_fresh check
 *
 * SAFETY CONTRACT — The ONLY write this tool may perform is:
 *   market_data INSERT/UPSERT via writeScrapeResult
 *
 * ABSOLUTELY NO:
 *   applyDynamicPricingForProperty   PROHIBITED
 *   priceProperty                    PROHIBITED
 *   publishEffectivePricing          PROHIBITED
 *   pricing_schedule writes          PROHIBITED
 *   pricing_history writes           PROHIBITED
 *   pricing_config writes            PROHIBITED
 *   properties writes                PROHIBITED
 *   Channex API calls                PROHIBITED
 *
 * CHANNEX_WRITES  = 0
 * PRICING_WRITES  = 0
 *
 * Usage:
 *   DATABASE_URL=... node outils/validate-market-currency-runtime.js --name M6
 *     → PREVIEW mode: reads state, 0 Apify calls, 0 DB writes
 *
 *   DATABASE_URL=... node outils/validate-market-currency-runtime.js --name M6 --execute
 *     → EXECUTE mode: real Apify scrape → write → validate live_fresh
 */

// ── Safe imports only (no pricing/channex) ─────────────────────────────────────
const {
  writeScrapeResult,
  scrapeBestZone,
  getFallbackZones,
  getCurrentWeekStart,
  calcMarketStats,
} = require('../routes/dynamic-pricing-cron');
const { classifyMarketData, normalizeCurrency } = require('../routes/market-data-resolver');
const { computeMarketContextKey }               = require('../routes/market-context-key');
const { Pool }                                  = require('pg');

// ── Constants ─────────────────────────────────────────────────────────────────
const MAX_LISTINGS        = 100;
const REQUIRE_CURRENCY    = 'EUR';   // hard-coded for B4-H validation

// ── SQL fragment reused for both target-lookup and fresh-read ─────────────────
const PROP_SELECT = `
  SELECT p.id, p.name, p.internal_name, p.address,
         p.currency AS property_currency,
         p.country_code, p.latitude, p.longitude,
         p.channex_enabled, p.channex_rate_plan_id,
         pc.is_active, pc.mode, pc.user_id,
         pc.price_min, pc.price_max, pc.bedrooms, pc.zone_label
  FROM properties p
  JOIN pricing_config pc ON pc.property_id = p.id AND pc.user_id = p.user_id
`;

// ── resolveTarget: find property by name pattern ──────────────────────────────
async function resolveTarget(pool, { name }) {
  const rows = (await pool.query(
    PROP_SELECT + `WHERE (p.internal_name ILIKE $1 OR p.name ILIKE $1)`,
    [`%${name}%`]
  )).rows;
  return rows;
}

// ── freshSelectById: re-read by confirmed ID before T0 scrape ─────────────────
async function freshSelectById(pool, { propertyId, userId }) {
  const rows = (await pool.query(
    PROP_SELECT + `WHERE p.id = $1 AND p.user_id = $2`,
    [propertyId, userId]
  )).rows;
  return rows[0] || null;
}

// ── checkPropertyGuards: pure validation — no I/O ─────────────────────────────
function checkPropertyGuards(prop, { requireCurrency = null } = {}) {
  if (!prop.is_active) {
    return `BoostPrice not active for this property (pricing_config.is_active = false)`;
  }
  const currency = normalizeCurrency(prop.property_currency);
  if (!currency) {
    return `properties.currency absent or invalid (got: ${JSON.stringify(prop.property_currency)})`;
  }
  if (requireCurrency && currency !== requireCurrency) {
    return `currency mismatch: expected ${requireCurrency}, got ${currency} — this validation requires EUR`;
  }
  const ctxKey = computeMarketContextKey({
    countryCode: prop.country_code,
    latitude:    prop.latitude,
    longitude:   prop.longitude,
  });
  if (!ctxKey) {
    return `insufficient geo for market context key (need country_code + lat + lng, got: ${prop.country_code}/${prop.latitude}/${prop.longitude})`;
  }
  return null; // all checks pass
}

// ── previewMode: READ-ONLY ─────────────────────────────────────────────────────
// DB_WRITES = 0, APIFY_CALLS = 0, CHANNEX_WRITES = 0
async function previewMode(pool, { name }) {
  console.log('\n' + '═'.repeat(70));
  console.log('  B4-H RUNTIME VALIDATION — PREVIEW MODE (READ-ONLY)');
  console.log('  DB_WRITES = 0 | APIFY_CALLS = 0 | CHANNEX_WRITES = 0');
  console.log('═'.repeat(70));

  const targets = await resolveTarget(pool, { name });

  console.log(`\n  TARGET_PROPERTY_COUNT = ${targets.length}`);

  if (targets.length === 0) {
    console.log(`  ⛔  No property matching "${name}"`);
    return { ok: false, abort: `no_target: no property matching "${name}"` };
  }
  if (targets.length > 1) {
    console.log(`  ⛔  Ambiguous: ${targets.length} properties match "${name}" — refine --name`);
    targets.forEach(t => console.log(`       - ${t.id}  ${t.internal_name || t.name}`));
    return { ok: false, abort: `ambiguous_target: ${targets.length} matches` };
  }

  const prop = targets[0];
  const ctxKey  = computeMarketContextKey({ countryCode: prop.country_code, latitude: prop.latitude, longitude: prop.longitude });
  const currency = normalizeCurrency(prop.property_currency);

  console.log('\n  ── PROPERTY ─────────────────────────────────────────────────');
  console.log(`  id                   : ${prop.id}`);
  console.log(`  name                 : ${prop.internal_name || prop.name}`);
  console.log(`  pricing_config.active: ${prop.is_active}`);
  console.log(`  pricing_config.mode  : ${prop.mode}`);
  console.log(`  properties.currency  : ${prop.property_currency ?? 'NULL'}`);
  console.log(`  country_code         : ${prop.country_code ?? 'NULL'}`);
  console.log(`  latitude / longitude : ${prop.latitude ?? 'NULL'} / ${prop.longitude ?? 'NULL'}`);
  console.log(`  context_key          : ${ctxKey ?? 'NULL (insufficient geo)'}`);
  console.log(`  channex_enabled      : ${prop.channex_enabled}`);

  // Latest market_data
  const latestMarket = (await pool.query(
    `SELECT id, week_start, scraped_at, data_source, currency, market_context_key,
            median_price, comparable_count, tension_level
     FROM market_data
     WHERE property_id = $1
     ORDER BY week_start DESC, scraped_at DESC LIMIT 1`,
    [prop.id]
  )).rows[0] || null;

  const cls = classifyMarketData(latestMarket, {
    propertyCurrency:   prop.property_currency ?? null,
    propertyContextKey: ctxKey,
  });

  console.log('\n  ── LATEST MARKET_DATA ───────────────────────────────────────');
  if (!latestMarket) {
    console.log('  (none)');
  } else {
    console.log(`  data_source          : ${latestMarket.data_source}`);
    console.log(`  currency             : ${latestMarket.currency ?? 'NULL'}`);
    console.log(`  market_context_key   : ${latestMarket.market_context_key ?? 'NULL'}`);
    console.log(`  week_start           : ${latestMarket.week_start}`);
    console.log(`  scraped_at           : ${latestMarket.scraped_at}`);
    console.log(`  median_price         : ${latestMarket.median_price}`);
  }

  console.log('\n  ── RESOLVER ─────────────────────────────────────────────────');
  console.log(`  resolverStatus       : ${cls.status}`);
  console.log(`  trusted              : ${cls.trusted}`);
  console.log(`  usable               : ${cls.usable}`);

  console.log('\n  ── EXECUTE READINESS ────────────────────────────────────────');
  const apifyPresent = !!process.env.APIFY_TOKEN;
  console.log(`  APIFY_TOKEN_PRESENT  : ${apifyPresent}`);
  console.log(`  TARGET_CURRENCY      : ${currency ?? 'MISSING'}`);
  console.log(`  EXPECTED_CONTEXT_KEY : ${ctxKey ?? 'MISSING'}`);

  const guardErr = checkPropertyGuards(prop, { requireCurrency: REQUIRE_CURRENCY });
  if (guardErr) {
    console.log(`\n  ⛔  CANNOT EXECUTE: ${guardErr}`);
    return { ok: false, abort: guardErr, targets: 1 };
  }
  if (!apifyPresent) {
    console.log(`\n  ⚠️  APIFY_TOKEN absent — --execute would receive mock data and abort`);
  } else {
    console.log(`\n  ✅  Ready for --execute (add --execute flag to proceed)`);
  }
  console.log('═'.repeat(70) + '\n');

  return { ok: true, targets: 1, propertyId: prop.id, currency, ctxKey, apifyPresent };
}

// ── executeMode: performs scrape → write → classify ───────────────────────────
async function executeMode(pool, { name }, deps = {}) {
  // deps = { scrapeFn, writeFn } — injectable for tests; production uses real cron fns
  const scrapeFn = deps.scrapeFn || scrapeBestZone;
  const writeFn  = deps.writeFn  || writeScrapeResult;

  console.log('\n' + '═'.repeat(70));
  console.log('  B4-H RUNTIME VALIDATION — EXECUTE MODE');
  console.log('');
  console.log('  SAFETY CONTRACT:');
  console.log('    applyDynamicPricingForProperty  NOT CALLED');
  console.log('    priceProperty                   NOT CALLED');
  console.log('    publishEffectivePricing         NOT CALLED');
  console.log('    pricing_schedule writes         PROHIBITED');
  console.log('    pricing_history writes          PROHIBITED');
  console.log('    pricing_config writes           PROHIBITED');
  console.log('    properties writes               PROHIBITED');
  console.log('    Channex API calls               PROHIBITED');
  console.log('    CHANNEX_WRITES  = 0');
  console.log('    PRICING_WRITES  = 0');
  console.log('    Allowed write: market_data INSERT/UPSERT ONLY');
  console.log('═'.repeat(70));

  // 1. Resolve target
  const targets = await resolveTarget(pool, { name });
  if (targets.length !== 1) {
    console.log(`\n  ⛔  ABORT: TARGET_COUNT=${targets.length} — must be exactly 1`);
    return { ok: false, abort: `TARGET_COUNT=${targets.length}` };
  }
  const confirmed       = targets[0];
  const confirmedId     = confirmed.id;
  const confirmedUserId = confirmed.user_id;

  console.log(`\n  Target confirmed: ${confirmed.internal_name || confirmed.name} [${confirmedId.slice(-8)}]`);

  // 2. Guard on initial resolution
  const guardErr0 = checkPropertyGuards(confirmed, { requireCurrency: REQUIRE_CURRENCY });
  if (guardErr0) {
    console.log(`\n  ⛔  ABORT: ${guardErr0}`);
    return { ok: false, abort: guardErr0 };
  }

  // 3. Fresh SELECT by confirmed ID (T0 capture)
  const fresh = await freshSelectById(pool, { propertyId: confirmedId, userId: confirmedUserId });
  if (!fresh) {
    console.log('\n  ⛔  ABORT: property disappeared after initial resolution');
    return { ok: false, abort: 'property_disappeared' };
  }

  // 4. Re-validate on fresh read
  const guardErrFresh = checkPropertyGuards(fresh, { requireCurrency: REQUIRE_CURRENCY });
  if (guardErrFresh) {
    console.log(`\n  ⛔  ABORT (post-refresh): ${guardErrFresh}`);
    return { ok: false, abort: `post_refresh_guard: ${guardErrFresh}` };
  }

  // 5. T0 captures
  const capturedPropertyCurrency = normalizeCurrency(fresh.property_currency);
  const capturedContextKey = computeMarketContextKey({
    countryCode: fresh.country_code,
    latitude:    fresh.latitude,
    longitude:   fresh.longitude,
  });

  console.log(`\n  T0 capturedPropertyCurrency = ${capturedPropertyCurrency}`);
  console.log(`  T0 capturedContextKey       = ${capturedContextKey}`);

  // 6. Scrape
  const zones      = getFallbackZones(fresh.address || '', fresh.zone_label);
  const weekStart  = getCurrentWeekStart();
  const medianBase = (parseFloat(fresh.price_min || 80) + parseFloat(fresh.price_max || 200)) / 2;

  console.log(`\n  Scraping zones: ${zones.join(' → ')}  currency=${capturedPropertyCurrency}`);
  const scrapeResult = await scrapeFn(zones, medianBase, MAX_LISTINGS, fresh.bedrooms, capturedPropertyCurrency);

  if (scrapeResult.isMock) {
    console.log('\n  ⛔  ABORT: MOCK_SCRAPE — real Apify response required for validation');
    console.log('       (APIFY_TOKEN missing or all zones failed)');
    return { ok: false, abort: 'MOCK_SCRAPE: isMock=true' };
  }

  console.log(`  Scrape: ${scrapeResult.listings.length} listings, zone="${scrapeResult.zoneUsed}"`);

  // 7. Compute stats
  const marketStats = calcMarketStats(scrapeResult.listings);
  if (!marketStats) {
    console.log('\n  ⛔  ABORT: no marketStats (0 valid listings)');
    return { ok: false, abort: 'no_market_stats' };
  }
  console.log(`  Stats: median=${marketStats.median} occ=${marketStats.occupancy}% tension=${marketStats.tensionLevel}`);

  // 8. Write market_data (CAS geo + currency active)
  console.log('\n  Writing market_data via writeScrapeResult...');
  const writeResult = await writeFn(pool, {
    userId:                   confirmedUserId,
    propertyId:               confirmedId,
    weekStart,
    marketStats,
    zoneLabel:                scrapeResult.zoneUsed,
    dataSource:               'apify_live',
    capturedContextKey,
    capturedPropertyCurrency,
  });

  if (!writeResult.written) {
    console.log(`\n  ⛔  ABORT: write rejected — reason=${writeResult.reason}`);
    if (writeResult.reason === 'context_stale') {
      console.log('       Geographic context changed during scrape — CAS protected the write.');
    } else if (writeResult.reason === 'currency_stale') {
      console.log(`       Currency changed during scrape (captured=${writeResult.capturedCurrency} current=${writeResult.currentCurrency}) — CAS protected the write.`);
    }
    return { ok: false, abort: `write_rejected: ${writeResult.reason}`, writeResult };
  }

  console.log('  ✅  market_data written.');

  // 9. Fresh SELECT of written row
  const freshMarket = (await pool.query(
    `SELECT id, week_start, scraped_at, data_source, currency, market_context_key,
            median_price, comparable_count, occupancy_rate, tension_level, zone_label
     FROM market_data
     WHERE property_id = $1
     ORDER BY week_start DESC, scraped_at DESC
     LIMIT 1`,
    [confirmedId]
  )).rows[0] || null;

  // 10. Classify
  const cls = classifyMarketData(freshMarket, {
    propertyCurrency:   capturedPropertyCurrency,
    propertyContextKey: capturedContextKey,
  });

  // 11. Validate 9 conditions
  const checks = {
    POST_DATA_SOURCE:      freshMarket?.data_source === 'apify_live',
    POST_MARKET_CURRENCY:  normalizeCurrency(freshMarket?.currency) === 'EUR',
    POST_PROPERTY_CURRENCY: capturedPropertyCurrency === 'EUR',
    POST_CONTEXT_MATCH:    freshMarket?.market_context_key === capturedContextKey,
    POST_RESOLVER_STATUS:  cls.status === 'live_fresh',
    POST_TRUSTED:          cls.trusted === true,
    POST_FRESH:            cls.fresh === true,
    POST_USABLE:           cls.usable === true,
    POST_MARKET_RETURNED:  cls.market != null,
  };

  const allPass = Object.values(checks).every(Boolean);
  const validationResult = allPass ? 'PASS' : 'FAIL';

  console.log('\n  ── VALIDATION RESULTS ───────────────────────────────────────');
  for (const [k, v] of Object.entries(checks)) {
    console.log(`  ${v ? '✅' : '❌'}  ${k.padEnd(26)} = ${v}`);
  }
  console.log(`\n  VALIDATION_RESULT = ${validationResult}`);
  console.log('═'.repeat(70) + '\n');

  return {
    ok: allPass,
    validationResult,
    checks,
    cls,
    freshMarket,
    capturedPropertyCurrency,
    capturedContextKey,
    scrapeZoneUsed: scrapeResult.zoneUsed,
    weekStart,
    marketStats,
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  let name    = null;
  let execute = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name' && args[i + 1]) { name = args[++i]; }
    if (args[i] === '--execute')             { execute = true; }
  }

  if (!name) {
    console.error('Usage: node outils/validate-market-currency-runtime.js --name <property-name> [--execute]');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL environment variable required');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  const run = execute
    ? executeMode(pool, { name })
    : previewMode(pool, { name });

  run
    .then(result => {
      pool.end().catch(() => {});
      if (!result.ok && result.abort) process.exit(1);
    })
    .catch(err => {
      console.error('Fatal:', err.message);
      pool.end().catch(() => {});
      process.exit(1);
    });
}

module.exports = { resolveTarget, previewMode, executeMode, checkPropertyGuards, freshSelectById };
