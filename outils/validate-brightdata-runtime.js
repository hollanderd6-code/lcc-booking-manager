#!/usr/bin/env node
'use strict';
require('dotenv').config();
/**
 * P1.2-B5-E — Bright Data Runtime Validation Tool
 *
 * Preview:  node outils/validate-brightdata-runtime.js --name M6
 * Execute:  node outils/validate-brightdata-runtime.js --name M6 --execute
 *
 * SAFETY CONTRACT:
 *   Preview:  0 network calls, 0 DB writes
 *   Execute:  1 Bright Data call, 1 market_data INSERT/UPSERT ONLY
 *
 * ABSOLUTELY PROHIBITED:
 *   applyDynamicPricingForProperty   PROHIBITED
 *   priceProperty                    PROHIBITED
 *   publishEffectivePricing          PROHIBITED
 *   triggerChannexRatesSync          PROHIBITED
 *   runDynamicPricingForOneProperty  PROHIBITED
 *   pricing_config UPDATE            PROHIBITED
 *   pricing_schedule writes          PROHIBITED
 *   pricing_history writes           PROHIBITED
 *   properties UPDATE                PROHIBITED
 *   Channex API calls                PROHIBITED
 *   Apify fallback                   PROHIBITED
 *   Mock fallback                    PROHIBITED
 *
 * CHANNEX_WRITES  = 0
 * PRICING_WRITES  = 0
 * APIFY_CALLS     = 0
 */

// ── Safe imports only (no pricing/channex) ─────────────────────────────────────
// NOTE: dynamic-pricing-cron is required lazily inside executeMode to avoid the
// circular dependency chain: cron → dynamic-pricing-routes → market-refresh-trigger → cron.
// PREVIEW runs entirely without requiring that module.
const { classifyMarketData, resolveMarketData, normalizeCurrency } =
  require('../routes/market-data-resolver');
const { computeMarketContextKey } = require('../routes/market-context-key');
const { getBrightDataMarketDates } = require('../services/market-provider');
const { scrapeWithBrightData, DATASET_ID } = require('../services/providers/brightdata');
const { Pool } = require('pg');

// ── Constants ──────────────────────────────────────────────────────────────────
const MAX_LISTINGS    = 100;
const MIN_COMPARABLES = 8;

// ── AbortError — thrown by abort(); CLI layer calls process.exit ───────────────
class AbortError extends Error {
  constructor(msg) { super(msg); this.name = 'AbortError'; }
}

function abort(msg) { throw new AbortError(msg); }

// ── Property lookup ───────────────────────────────────────────────────────────
async function resolvePropByName(pool, name) {
  // zone_label lives in market_data, NOT pricing_config — do not select pc.zone_label.
  // getFallbackZones(address, null) derives zones from address when no zoneLabel given.
  const rows = (await pool.query(
    `SELECT p.id, p.user_id, p.name, p.internal_name, p.address,
            p.latitude, p.longitude, p.country_code, p.timezone,
            p.currency, p.channex_enabled,
            pc.is_active, pc.mode
       FROM properties p
       LEFT JOIN pricing_config pc ON pc.property_id = p.id AND pc.user_id = p.user_id
      WHERE LOWER(p.name) = LOWER($1) OR LOWER(p.internal_name) = LOWER($1)`,
    [name]
  )).rows;
  return rows;
}

// ── previewMode ───────────────────────────────────────────────────────────────
// DB_WRITES = 0   BRIGHTDATA_CALLS = 0   APIFY_CALLS = 0   CHANNEX_WRITES = 0
async function previewMode(pool, { name, _now } = {}) {
  console.log('\n' + '═'.repeat(64));
  console.log('  B5-E BRIGHT DATA VALIDATION — PREVIEW MODE (READ-ONLY)');
  console.log('  DB_WRITES=0 | BRIGHTDATA_CALLS=0 | CHANNEX_WRITES=0');
  console.log('═'.repeat(64));

  const rows = await resolvePropByName(pool, name);

  if (rows.length === 0) {
    console.log(`\n  ⛔  Aucune propriété trouvée: "${name}"`);
    return { ok: false, abort: `no_target: "${name}"` };
  }
  if (rows.length > 1) {
    console.log(`  ⛔  Ambiguïté: ${rows.length} propriétés correspondent à "${name}"`);
    rows.forEach(r => console.log(`       - ${r.id}  ${r.internal_name || r.name}`));
    return { ok: false, abort: `ambiguous_target: ${rows.length} matches` };
  }

  const prop     = rows[0];
  const timezone = prop.timezone || 'Europe/Paris';

  const contextKey       = computeMarketContextKey({
    countryCode: prop.country_code,
    latitude:    prop.latitude  != null ? parseFloat(prop.latitude)  : null,
    longitude:   prop.longitude != null ? parseFloat(prop.longitude) : null,
  });
  const normalizedCurrency = normalizeCurrency(prop.currency);
  const { checkIn, checkOut } = getBrightDataMarketDates({ timezone, now: _now });
  const apiKeyPresent = !!(process.env.BRIGHTDATA_API_KEY);

  // Derive location using production zone logic (lazy require to avoid circular dep)
  const { getFallbackZones } = require('../routes/dynamic-pricing-cron');
  const zones    = getFallbackZones(prop.address, null);
  const location = zones[0];

  // ── Print PROPERTY ──────────────────────────────────────────
  console.log('\n  PROPERTY:');
  console.log(`    id:                  ${prop.id}`);
  console.log(`    name:                ${prop.internal_name || prop.name}`);
  console.log(`    address:             ${prop.address}`);
  console.log(`    latitude:            ${prop.latitude}`);
  console.log(`    longitude:           ${prop.longitude}`);
  console.log(`    country_code:        ${prop.country_code}`);
  console.log(`    timezone:            ${prop.timezone}`);
  console.log(`    market_context_key:  ${contextKey}`);
  console.log(`    currency:            ${prop.currency} → normalisé: ${normalizedCurrency}`);
  console.log(`    pricing_config.active: ${prop.is_active != null ? String(prop.is_active) : 'N/A'}`);
  console.log(`    pricing_config.mode:   ${prop.mode ?? 'N/A'}`);
  console.log(`    channex_enabled:     ${prop.channex_enabled}`);

  // ── Print BRIGHT DATA ───────────────────────────────────────
  console.log('\n  BRIGHT DATA:');
  console.log(`    BRIGHTDATA_API_KEY_PRESENT: ${apiKeyPresent}`);
  console.log(`    dataset id:          ${DATASET_ID}`);
  console.log(`    requested currency:  ${normalizedCurrency}`);
  console.log(`    location query:      ${location}`);
  console.log(`    planned checkIn:     ${checkIn}`);
  console.log(`    planned checkOut:    ${checkOut}`);
  console.log(`    date strategy:       property-local J+14 → J+15`);
  console.log(`    max listings:        ${MAX_LISTINGS}`);

  // ── Print READINESS ─────────────────────────────────────────
  const geoComplete     = !!(prop.latitude && prop.longitude && prop.country_code);
  const tzPresent       = !!(prop.timezone);
  const currencyValid   = !!(normalizedCurrency);
  const contextKeyValid = !!(contextKey);
  const ready = geoComplete && tzPresent && currencyValid && contextKeyValid && apiKeyPresent;

  console.log('\n  READINESS:');
  console.log(`    property uniquely resolved: ${ready ? '✅' : '⚪'}`);
  console.log(`    geo complete:               ${geoComplete ? '✅' : '❌'} (lat=${prop.latitude}, lng=${prop.longitude}, cc=${prop.country_code})`);
  console.log(`    timezone present:           ${tzPresent ? '✅' : '❌'}`);
  console.log(`    currency valid:             ${currencyValid ? '✅' : '❌'}`);
  console.log(`    context key valid:          ${contextKeyValid ? '✅' : '❌'} (${contextKey})`);
  console.log(`    API key present:            ${apiKeyPresent ? '✅' : '❌'}`);

  if (!ready) {
    console.log('\n  ⛔  NOT READY FOR EXECUTE.');
  } else {
    console.log('\n  ✅  READY FOR EXECUTE (ajouter --execute pour démarrer).');
  }
  console.log('═'.repeat(64) + '\n');

  return {
    ok: ready, targets: 1,
    propertyId: prop.id, contextKey, normalizedCurrency, apiKeyPresent,
  };
}

// ── executeMode ───────────────────────────────────────────────────────────────
// ONLY permitted write: market_data INSERT/UPSERT via writeScrapeResult
async function executeMode(pool, { name, _now, _bdScrape } = {}) {
  // Lazy require: avoids the circular dep chain in PREVIEW mode.
  const {
    getFallbackZones,
    calcMarketStats,
    writeScrapeResult,
    getCurrentWeekStart,
  } = require('../routes/dynamic-pricing-cron');

  // Injectable BD scrape function (real by default; injectable for tests).
  const bdScrape = _bdScrape || scrapeWithBrightData;

  console.log('\n' + '═'.repeat(64));
  console.log('  B5-E BRIGHT DATA VALIDATION — EXECUTE MODE');
  console.log('');
  console.log('  SAFETY CONTRACT:');
  console.log('    Bright Data direct call         (no Apify fallback, no mock)');
  console.log('    market_data INSERT/UPSERT ONLY');
  console.log('    applyDynamicPricingForProperty  NOT CALLED');
  console.log('    pricing_config writes           PROHIBITED');
  console.log('    pricing_schedule writes         PROHIBITED');
  console.log('    pricing_history writes          PROHIBITED');
  console.log('    properties writes               PROHIBITED');
  console.log('    Channex API calls               PROHIBITED');
  console.log('    CHANNEX_WRITES  = 0');
  console.log('    PRICING_WRITES  = 0');
  console.log('    APIFY_CALLS     = 0');
  console.log('═'.repeat(64));

  // ── 1. Resolve target ────────────────────────────────────────
  const rows = await resolvePropByName(pool, name);
  if (rows.length === 0) abort(`Aucune propriété: "${name}"`);
  if (rows.length > 1)  abort(`${rows.length} propriétés correspondent à "${name}" — affiner --name`);

  const prop     = rows[0];
  const timezone = prop.timezone || 'Europe/Paris';
  console.log(`\n  Cible: ${prop.internal_name || prop.name} [${prop.id.slice(-8)}]`);

  // ── 2. Pre-flight guards ──────────────────────────────────────
  const normalizedCurrency = normalizeCurrency(prop.currency);
  const contextKey = computeMarketContextKey({
    countryCode: prop.country_code,
    latitude:    prop.latitude  != null ? parseFloat(prop.latitude)  : null,
    longitude:   prop.longitude != null ? parseFloat(prop.longitude) : null,
  });
  const apiKeyPresent = !!(process.env.BRIGHTDATA_API_KEY);

  if (!(prop.latitude && prop.longitude && prop.country_code)) abort('Geo incomplète — context key non calculable');
  if (!prop.timezone)        abort('Timezone manquante — date strategy impossible');
  if (!normalizedCurrency)   abort('Devise propriété invalide ou absente');
  if (!contextKey)           abort('Context key invalide — vérifier lat/lng/country_code');
  if (!apiKeyPresent)        abort('BRIGHTDATA_API_KEY non défini');

  // ── 3. T0 capture ─────────────────────────────────────────────
  const capturedPropertyId       = prop.id;
  const capturedPropertyCurrency = normalizedCurrency;
  const capturedContextKey       = contextKey;

  console.log(`\n  T0 capturedPropertyCurrency = ${capturedPropertyCurrency}`);
  console.log(`  T0 capturedContextKey       = ${capturedContextKey}`);

  // ── 4. Safety invariant snapshots ────────────────────────────
  const beforePcRows = (await pool.query(
    `SELECT is_active, mode, updated_at FROM pricing_config WHERE property_id = $1`,
    [capturedPropertyId]
  )).rows;
  const beforePcFingerprint = JSON.stringify(beforePcRows);

  let beforeScheduleCount = '0';
  try {
    beforeScheduleCount = (await pool.query(
      `SELECT COUNT(*) AS cnt FROM pricing_schedule WHERE property_id = $1`,
      [capturedPropertyId]
    )).rows[0]?.cnt ?? '0';
  } catch (_) { /* table may not exist in dev environment */ }

  const beforeHistoryCount = (await pool.query(
    `SELECT COUNT(*) AS cnt FROM pricing_history WHERE property_id = $1`,
    [capturedPropertyId]
  )).rows[0]?.cnt ?? '0';

  const beforePropRow = (await pool.query(
    `SELECT name, address, latitude, longitude, country_code, timezone, currency, channex_enabled
       FROM properties WHERE id = $1`,
    [capturedPropertyId]
  )).rows[0];
  const beforePropFingerprint = JSON.stringify(beforePropRow);

  // ── 5. Date strategy (B5-D helper) ───────────────────────────
  const { checkIn, checkOut } = getBrightDataMarketDates({ timezone, now: _now });
  console.log(`\n  checkIn=${checkIn}  checkOut=${checkOut}  timezone=${timezone}`);

  // ── 6. Zone derivation (production logic) ────────────────────
  const zones    = getFallbackZones(prop.address, null);
  const location = zones[0];
  console.log(`  location=${location}  (zones: ${zones.join(' → ')})`);

  // ── 7. Bright Data call (NO Apify fallback, NO mock) ─────────
  console.log(`\n  🔍 Appel Bright Data direct: "${location}" currency=${capturedPropertyCurrency}`);

  let bdResult;
  try {
    bdResult = await bdScrape(
      location, MAX_LISTINGS, capturedPropertyCurrency,
      { checkIn, checkOut }
      // apiKey resolved from BRIGHTDATA_API_KEY env var inside scrapeWithBrightData
    );
  } catch (err) {
    abort(`Bright Data call failed: ${err.message}`);
  }

  if (bdResult.isMock) abort('Résultat mock reçu — brightdata_live requis, aucun fallback autorisé');
  if (bdResult.dataSource !== 'brightdata_live') {
    abort(`dataSource="${bdResult.dataSource}" — brightdata_live requis`);
  }

  const diag = bdResult.diagnostics || {};
  console.log('\n  BRIGHT DATA RESULT:');
  console.log(`    RETURNED_COUNT:                ${diag.returnedCount ?? '?'}`);
  console.log(`    ACCEPTED_BY_ADAPTER:           ${diag.acceptedCount ?? '?'}`);
  console.log(`    REJECTED_PRICE:                ${diag.rejectedPriceCount ?? '?'}`);
  console.log(`    REJECTED_CURRENCY:             ${diag.rejectedCurrencyCount ?? '?'}`);
  console.log(`    REJECTED_AVAILABILITY:         ${diag.rejectedAvailabilityCount ?? '?'}`);

  if (bdResult.listings.length === 0) {
    abort('Bright Data: 0 listings utilisables — abandon sans écriture');
  }

  // ── 8. Comparable filtering (B5-D policy) ───────────────────
  // All BD listings have bedrooms=null — no bedroom filter applied here.
  // (Validation does not read pricing_config.bedrooms; null listings pass through.)
  const filtered = bdResult.listings;
  console.log(`    COMPARABLE_COUNT_AFTER_FILTER: ${filtered.length}`);

  if (filtered.length < MIN_COMPARABLES) {
    abort(`${filtered.length} comparables < seuil minimum ${MIN_COMPARABLES}`);
  }

  // ── 9. Market statistics (production calcMarketStats) ────────
  const marketStats = calcMarketStats(filtered);
  if (!marketStats) abort('calcMarketStats null — aucun prix valide');

  console.log('\n  MARKET STATISTICS (avant écriture):');
  console.log(`    median_price:       ${marketStats.median}`);
  console.log(`    price_p25:          ${marketStats.p25}`);
  console.log(`    price_p75:          ${marketStats.p75}`);
  console.log(`    occupancy_rate:     ${marketStats.occupancy}%`);
  console.log(`    tension_level:      ${marketStats.tensionLevel}`);
  console.log(`    comparable_count:   ${marketStats.count}`);
  console.log(`    data_source:        ${bdResult.dataSource}`);
  console.log(`    currency:           ${capturedPropertyCurrency}`);
  console.log(`    market_context_key: ${capturedContextKey}`);
  console.log(`    location/zone:      ${location}`);
  console.log(`    checkIn:            ${checkIn}`);
  console.log(`    checkOut:           ${checkOut}`);

  // ── 10. Sanity guards ─────────────────────────────────────────
  if (bdResult.dataSource !== 'brightdata_live') abort('dataSource !== brightdata_live');
  if (bdResult.isMock)                           abort('isMock true — données réelles requises');
  if (marketStats.count < MIN_COMPARABLES)       abort(`comparable_count ${marketStats.count} < ${MIN_COMPARABLES}`);
  if (!Number.isFinite(marketStats.median) || marketStats.median <= 0) abort('median invalide ou nul');
  if (!Number.isFinite(marketStats.p25)    || marketStats.p25    <= 0) abort('p25 invalide ou nul');
  if (!Number.isFinite(marketStats.p75)    || marketStats.p75    <= 0) abort('p75 invalide ou nul');
  if (!Number.isFinite(marketStats.occupancy)
    || marketStats.occupancy < 0 || marketStats.occupancy > 100)       abort('occupancy_rate hors plage 0..100');

  // ── 11. Write market_data (CAS geo + currency via writeScrapeResult) ──────────
  const weekStart = getCurrentWeekStart();
  console.log(`\n  📝 Écriture market_data (week_start=${weekStart})...`);

  const writeResult = await writeScrapeResult(pool, {
    userId:                  prop.user_id,
    propertyId:              capturedPropertyId,
    weekStart,
    marketStats,
    zoneLabel:               location,
    dataSource:              bdResult.dataSource,
    capturedContextKey,
    capturedPropertyCurrency,
  });

  if (!writeResult.written) {
    abort(`writeScrapeResult annulé: ${writeResult.reason}`);
  }
  console.log('  ✅ market_data écrit');

  // ── 12. Post-write verification ───────────────────────────────
  const storedRow = (await pool.query(
    `SELECT data_source, currency, market_context_key,
            median_price, price_p25, price_p75, occupancy_rate, comparable_count
       FROM market_data
      WHERE property_id = $1 AND week_start = $2`,
    [capturedPropertyId, weekStart]
  )).rows[0];

  if (!storedRow) abort('Lecture post-écriture échouée: aucune ligne trouvée');

  console.log('\n  VÉRIFICATION POST-ÉCRITURE:');
  const postChecks = [
    ['data_source',        storedRow.data_source,               'brightdata_live'],
    ['currency',           storedRow.currency,                   capturedPropertyCurrency],
    ['market_context_key', storedRow.market_context_key,         capturedContextKey],
    ['median_price',       parseFloat(storedRow.median_price),   marketStats.median],
    ['price_p25',          parseFloat(storedRow.price_p25),      marketStats.p25],
    ['price_p75',          parseFloat(storedRow.price_p75),      marketStats.p75],
    ['occupancy_rate',     parseInt(storedRow.occupancy_rate),   marketStats.occupancy],
    ['comparable_count',   parseInt(storedRow.comparable_count), marketStats.count],
  ];
  let postOk = true;
  for (const [field, actual, expected] of postChecks) {
    const ok = actual === expected;
    console.log(`    ${field}: ${ok ? '✅' : '❌'} ${actual} ${ok ? '===' : '!=='} ${expected}`);
    if (!ok) postOk = false;
  }
  if (!postOk) abort('Vérification post-écriture échouée');

  // ── 13. Resolver check ────────────────────────────────────────
  const resolution = await resolveMarketData(pool, {
    propertyId:         capturedPropertyId,
    propertyContextKey: capturedContextKey,
    propertyCurrency:   capturedPropertyCurrency,
  });

  console.log('\n  RÉSULTAT RESOLVER:');
  console.log(`    resolverStatus:      ${resolution.status}`);
  console.log(`    trusted:             ${resolution.trusted}`);
  console.log(`    fresh:               ${resolution.fresh}`);
  console.log(`    locationCompatible:  ${resolution.locationCompatible}`);
  console.log(`    usable:              ${resolution.usable}`);

  if (resolution.status !== 'live_fresh' || !resolution.trusted || !resolution.fresh
      || !resolution.locationCompatible || !resolution.usable) {
    abort(`Resolver non-usable: status=${resolution.status} trusted=${resolution.trusted} usable=${resolution.usable}`);
  }
  console.log('  ✅ Resolver confirme brightdata_live live_fresh + usable');

  // ── 14. Safety invariant verification ────────────────────────
  console.log('\n  VÉRIFICATION INVARIANTS DE SÉCURITÉ:');

  const afterPcRows = (await pool.query(
    `SELECT is_active, mode, updated_at FROM pricing_config WHERE property_id = $1`,
    [capturedPropertyId]
  )).rows;
  const pcUnchanged = JSON.stringify(afterPcRows) === beforePcFingerprint;
  console.log(`    pricing_config:    ${pcUnchanged ? '✅ inchangé' : '❌ MODIFIÉ !'}`);

  let afterScheduleCount = '0';
  try {
    afterScheduleCount = (await pool.query(
      `SELECT COUNT(*) AS cnt FROM pricing_schedule WHERE property_id = $1`,
      [capturedPropertyId]
    )).rows[0]?.cnt ?? '0';
  } catch (_) { /* table may not exist */ }
  const scheduleUnchanged = String(afterScheduleCount) === String(beforeScheduleCount);
  console.log(`    pricing_schedule:  ${scheduleUnchanged ? '✅ inchangé' : '❌ MODIFIÉ'} (${beforeScheduleCount} → ${afterScheduleCount})`);

  const afterHistoryCount = (await pool.query(
    `SELECT COUNT(*) AS cnt FROM pricing_history WHERE property_id = $1`,
    [capturedPropertyId]
  )).rows[0]?.cnt ?? '0';
  const historyUnchanged = String(afterHistoryCount) === String(beforeHistoryCount);
  console.log(`    pricing_history:   ${historyUnchanged ? '✅ inchangé' : '❌ MODIFIÉ'} (${beforeHistoryCount} → ${afterHistoryCount})`);

  const afterPropRow = (await pool.query(
    `SELECT name, address, latitude, longitude, country_code, timezone, currency, channex_enabled
       FROM properties WHERE id = $1`,
    [capturedPropertyId]
  )).rows[0];
  const propUnchanged = JSON.stringify(afterPropRow) === beforePropFingerprint;
  console.log(`    properties:        ${propUnchanged ? '✅ inchangé' : '❌ MODIFIÉ !'}`);

  if (!pcUnchanged || !scheduleUnchanged || !historyUnchanged || !propUnchanged) {
    abort('Invariants de sécurité violés — changements inattendus détectés');
  }

  console.log(`\n  🎉 VALIDATION B5-E COMPLÈTE — brightdata_live live_fresh + usable`);
  console.log(`     Propriété: ${prop.internal_name || prop.name} | zone: ${location}`);
  console.log('═'.repeat(64) + '\n');

  return {
    success: true,
    propertyId:  capturedPropertyId,
    contextKey:  capturedContextKey,
    currency:    capturedPropertyCurrency,
    dataSource:  bdResult.dataSource,
    marketStats,
    location,
    checkIn,
    checkOut,
    resolution,
  };
}

module.exports = {
  previewMode,
  executeMode,
  resolvePropByName,
  AbortError,
  MAX_LISTINGS,
  MIN_COMPARABLES,
};

// ── CLI entry point ────────────────────────────────────────────────────────────
if (require.main === module) {
  const args    = process.argv.slice(2);
  const nameIdx = args.indexOf('--name');
  const name    = nameIdx !== -1 ? args[nameIdx + 1] : null;
  const execute = args.includes('--execute');

  if (!name) {
    console.error('Usage: node outils/validate-brightdata-runtime.js --name <nom> [--execute]');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  function classifyError(err) {
    const msg  = (err.message || '').toLowerCase();
    const code = (err.code    || '').toUpperCase();
    if (msg.includes('self-signed') || msg.includes('certificate') ||
        code.includes('CERT') || code.includes('SSL') || msg.includes('tls')) {
      return 'DB_TLS_ERROR';
    }
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT') {
      return 'DB_CONNECTION_ERROR';
    }
    if (msg.includes('column') || msg.includes('does not exist') || msg.includes('relation') ||
        msg.includes('syntax error') || code === '42703' || code === '42P01' || code === '42601') {
      return 'DB_SCHEMA_ERROR';
    }
    if (msg.includes('property') || msg.includes('propriét') || msg.includes('market_data')) {
      return 'PROPERTY_LOOKUP_ERROR';
    }
    if (msg.includes('brightdata') || msg.includes('bright data')) {
      return 'BRIGHTDATA_ERROR';
    }
    return 'FATAL_ERROR';
  }

  const run = execute
    ? executeMode(pool, { name })
    : previewMode(pool, { name });

  run
    .then(() => pool.end())
    .catch(err => {
      if (err.name === 'AbortError') {
        console.error(`\n  ❌ ABORT: ${err.message}`);
      } else {
        const errType = classifyError(err);
        console.error(`\n  ❌ ${errType}: ${err.message}`);
      }
      pool.end().catch(() => {});
      process.exit(1);
    });
}
