#!/usr/bin/env node
'use strict';
/**
 * P1.2-B5-G — Bright Data Production Rollout Validator
 *
 * Two modes:
 *   Preview  : 0 BD calls, 0 DB writes, 0 pricing writes, 0 Channex calls
 *   Execute  : 1 BD call (or Apify fallback), 1 market_data UPSERT, 0 pricing writes, 0 Channex calls
 *
 * Safety invariants enforced:
 *   DB_WRITES          = 0  in preview
 *   PRICING_WRITES     = 0  always (pricing engine never triggered)
 *   CHANNEX_WRITES     = 0  always (no channex import)
 *   BRIGHTDATA_API_KEY       never printed
 *   Authorization headers    never printed
 *
 * CLI:
 *   node outils/validate-brightdata-production-rollout.js --name "M6"
 *   node outils/validate-brightdata-production-rollout.js --name "M6" --execute-market-data
 */

const path   = require('path');
const { Pool } = require('pg');

const marketProvider = require('../services/market-provider');
const {
  resolveProvider, resolveProviderForProperty, getBrightDataMarketDates,
} = marketProvider;
const {
  selectComparables, calcBrightDataMarketStats,
  MIN_COMPARABLES_FALLBACK, MIN_COMPARABLES_TARGET, LOCAL_PRIORITY_RADIUS_KM, MAX_RADIUS_KM,
} = require('../services/brightdata-comparable-filter');
const {
  writeScrapeResult, getFallbackZones, getCurrentWeekStart,
  calcProviderMarketStats, validateBDStats,
} = require('../routes/dynamic-pricing-cron');
const { computeMarketContextKey } = require('../routes/market-context-key');
const { resolveMarketData }       = require('../routes/market-data-resolver');

class AbortError extends Error {}

const MAX_LISTINGS = 100;

// ── Property resolver ─────────────────────────────────────────

async function resolvePropG(client, name) {
  if (!name || !name.trim()) throw new AbortError('--name est requis');
  const res = await client.query(
    `SELECT pc.property_id, p.name, p.address AS property_address,
            p.latitude, p.longitude, p.country_code, p.currency,
            p.max_guests, p.timezone, pc.user_id,
            pc.price_min, pc.price_max, pc.bedrooms
       FROM pricing_config pc
       JOIN properties p ON p.id = pc.property_id AND p.user_id = pc.user_id
      WHERE p.name ILIKE $1
      LIMIT 1`,
    [`%${name.trim()}%`]
  );
  if (!res.rows.length) throw new AbortError(`Propriété introuvable: "${name}"`);
  return res.rows[0];
}

// ── Preview mode ──────────────────────────────────────────────

async function previewMode({ name, _now, pool: poolOverride } = {}) {
  const pool = poolOverride || new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
  });
  const client = await pool.connect();
  try {
    const prop = await resolvePropG(client, name);

    const now             = _now || new Date();
    const timezone        = prop.timezone || 'Europe/Paris';
    const dates           = getBrightDataMarketDates({ timezone, now });
    const contextKey      = computeMarketContextKey({
      countryCode: prop.country_code,
      latitude:    prop.latitude  != null ? parseFloat(prop.latitude)  : null,
      longitude:   prop.longitude != null ? parseFloat(prop.longitude) : null,
    });
    const primaryProvider = resolveProvider();
    const providerForProp = resolveProviderForProperty(prop.property_id);

    // What would a non-listed property route to?
    const nonListedProvider = resolveProviderForProperty('__not_in_allowlist__');

    const allowlistRaw   = (process.env.MARKET_BRIGHTDATA_PROPERTY_ALLOWLIST || '').trim();
    const globalEnabled  = (process.env.MARKET_BRIGHTDATA_GLOBAL_ENABLED || '').trim().toLowerCase() === 'true';
    const zones          = getFallbackZones(prop.property_address, null);
    const inAllowlist    = allowlistRaw
      ? allowlistRaw.split(',').map(s => s.trim()).includes(String(prop.property_id))
      : false;

    // Read current market_data row (read-only)
    const mktRes = await client.query(
      `SELECT data_source, median_price, scraped_at, market_context_key, currency, comparable_count
         FROM market_data WHERE property_id = $1
         ORDER BY week_start DESC, scraped_at DESC LIMIT 1`,
      [prop.property_id]
    );
    const currentRow = mktRes.rows[0] || null;

    console.log('\n════════════════════════════════════════════════════════');
    console.log('  B5-G Production Rollout Validator — PREVIEW');
    console.log('════════════════════════════════════════════════════════\n');
    console.log(`  Property ID         : ${prop.property_id}`);
    console.log(`  Property Name       : ${prop.name}`);
    console.log(`  Currency            : ${prop.currency || '(null)'}`);
    console.log(`  Timezone            : ${timezone}`);
    console.log(`  Market Context Key  : ${contextKey || '(null — no geo)'}`);
    console.log(`  Max Guests          : ${prop.max_guests || '(null)'}`);
    console.log('');
    console.log('  ── Environment ─────────────────────────────────────');
    console.log(`  MARKET_PRIMARY_PROVIDER          : ${process.env.MARKET_PRIMARY_PROVIDER || '(unset → apify)'}`);
    console.log(`  MARKET_BRIGHTDATA_PROPERTY_ALLOWLIST : ${allowlistRaw || '(empty)'}`);
    console.log(`  MARKET_BRIGHTDATA_GLOBAL_ENABLED : ${process.env.MARKET_BRIGHTDATA_GLOBAL_ENABLED || '(unset)'}`);
    console.log('');
    console.log('  ── Routing Decision ────────────────────────────────');
    console.log(`  resolveProvider()                          : ${primaryProvider}`);
    console.log(`  resolveProviderForProperty(${prop.property_id.slice(-6)}) : ${providerForProp}`);
    console.log(`  resolveProviderForProperty(non-listed)     : ${nonListedProvider}`);
    console.log(`  ${prop.name} in allowlist                  : ${inAllowlist}`);
    console.log(`  GLOBAL_ENABLED                             : ${globalEnabled}`);
    console.log('');
    console.log(`  → ${prop.name} WOULD route to: ${providerForProp.toUpperCase()}`);
    console.log(`  → Non-listed property WOULD route to: ${nonListedProvider.toUpperCase()}`);
    if (providerForProp === nonListedProvider) {
      console.log('  ⚠️  Pilot isolation NOT active — all properties route to same provider');
    } else {
      console.log('  ✅ Pilot isolation ACTIVE — M6 and non-listed use different providers');
    }
    console.log('');
    console.log('  ── Planned Dates (no network call) ─────────────────');
    console.log(`  checkIn             : ${dates.checkIn}   (J+14 from ${timezone} local date)`);
    console.log(`  checkOut            : ${dates.checkOut}  (J+15)`);
    console.log('');
    console.log('  ── Quality Policy Constants ────────────────────────');
    console.log(`  MIN_COMPARABLES_TARGET   = ${MIN_COMPARABLES_TARGET}`);
    console.log(`  MIN_COMPARABLES_FALLBACK = ${MIN_COMPARABLES_FALLBACK}`);
    console.log(`  LOCAL_PRIORITY_RADIUS_KM = ${LOCAL_PRIORITY_RADIUS_KM}`);
    console.log(`  MAX_RADIUS_KM            = ${MAX_RADIUS_KM}`);
    console.log('');
    console.log('  ── Fallback Chain ──────────────────────────────────');
    console.log(`  ${prop.name} → ${providerForProp} → ${providerForProp === 'brightdata' ? 'Apify (on BD failure)' : 'mock (on Apify failure)'}`);
    console.log('');
    console.log('  ── Current market_data ─────────────────────────────');
    if (currentRow) {
      console.log(`  data_source       : ${currentRow.data_source}`);
      console.log(`  median_price      : ${currentRow.median_price}`);
      console.log(`  comparable_count  : ${currentRow.comparable_count}`);
      console.log(`  currency          : ${currentRow.currency}`);
      console.log(`  scraped_at        : ${currentRow.scraped_at}`);
      console.log(`  context_key match : ${currentRow.market_context_key === contextKey}`);
    } else {
      console.log('  (no market_data row yet)');
    }
    console.log('');
    console.log('  ── Zone Fallback ───────────────────────────────────');
    console.log(`  Zones (ordered): ${zones.join(' → ')}`);
    if (providerForProp === 'brightdata') {
      console.log(`  BD uses first zone only: ${zones[0]}`);
    }
    console.log('');
    console.log('════════════════════════════════════════════════════════');
    console.log('  PREVIEW COMPLETE — no network/write calls made');
    console.log('════════════════════════════════════════════════════════\n');

    return {
      propertyId:         prop.property_id,
      propertyName:       prop.name,
      providerForProp,
      nonListedProvider,
      pilotIsolationActive: providerForProp !== nonListedProvider,
      checkIn:            dates.checkIn,
      checkOut:           dates.checkOut,
      contextKey,
      currency:           prop.currency,
      allowlistRaw,
      globalEnabled,
    };
  } finally {
    client.release();
    if (!poolOverride) await pool.end();
  }
}

// ── Execute market-data mode ──────────────────────────────────

async function executeMarketDataMode({ name, _bdScrape, _getFallbackZones, _now, pool: poolOverride } = {}) {
  const pool = poolOverride || new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
  });
  const client = await pool.connect();

  try {
    const prop = await resolvePropG(client, name);

    const now     = _now || new Date();
    const timezone = prop.timezone || 'Europe/Paris';

    // Snapshot T0: capture context key and currency before any network call
    const marketContextKey        = computeMarketContextKey({
      countryCode: prop.country_code,
      latitude:    prop.latitude  != null ? parseFloat(prop.latitude)  : null,
      longitude:   prop.longitude != null ? parseFloat(prop.longitude) : null,
    });
    const capturedPropertyCurrency = prop.currency
      ? String(prop.currency).trim().toUpperCase()
      : null;

    if (!capturedPropertyCurrency) {
      throw new AbortError(`${prop.name}: devise inconnue — impossible d'exécuter le scrape marché`);
    }

    // ── Phase 7: Pricing isolation — capture pre-execute checksums ──
    const prePriceConfigRes = await client.query(
      'SELECT * FROM pricing_config WHERE property_id=$1', [prop.property_id]
    );
    const prePriceHistRes = await client.query(
      'SELECT COUNT(*) AS n FROM pricing_history WHERE property_id=$1', [prop.property_id]
    );
    const prePriceSchedRes = await client.query(
      'SELECT COUNT(*) AS n FROM pricing_schedule WHERE property_id=$1', [prop.property_id]
    );

    client.release();

    const weekStart = getCurrentWeekStart();
    const providerForProp = resolveProviderForProperty(prop.property_id);

    console.log('\n════════════════════════════════════════════════════════');
    console.log('  B5-G Production Rollout Validator — EXECUTE MARKET DATA');
    console.log('════════════════════════════════════════════════════════\n');
    console.log(`  Property            : ${prop.property_id} / ${prop.name}`);
    console.log(`  Currency            : ${capturedPropertyCurrency}`);
    console.log(`  Timezone            : ${timezone}`);
    console.log(`  Context Key         : ${marketContextKey}`);
    console.log(`  Provider for prop   : ${providerForProp}`);
    console.log(`  Week Start          : ${weekStart}`);

    // ── Phase 5: Zone fallback ────────────────────────────────────────────
    const zones = (_getFallbackZones || getFallbackZones)(prop.property_address, null);
    const zonesToTry = (providerForProp === 'brightdata') ? zones.slice(0, 1) : zones;
    console.log(`  Zones               : ${zonesToTry.join(' → ')}`);
    console.log('');

    // ── Execute market scrape ─────────────────────────────────────────────
    // If _bdScrape injectable provided (tests): bypass real network call.
    // Otherwise: use real production marketProvider.scrape path.
    let scrapeResult;
    if (_bdScrape) {
      // Test path — use injectable
      scrapeResult = await _bdScrape(zonesToTry[0], MAX_LISTINGS, capturedPropertyCurrency, { propertyId: prop.property_id });
    } else {
      // Production path — real provider routing
      scrapeResult = await marketProvider.scrape(
        zonesToTry[0], MAX_LISTINGS, capturedPropertyCurrency,
        { propertyId: prop.property_id, timezone, now }
      );
    }

    const { listings, isMock, dataSource, diagnostics } = scrapeResult;
    console.log(`  Provider Used       : ${scrapeResult.provider}`);
    console.log(`  Data Source         : ${dataSource}`);
    console.log(`  Raw Returned        : ${diagnostics?.returnedCount ?? listings.length}`);
    console.log(`  Adapter Accepted    : ${diagnostics?.acceptedCount ?? listings.length}`);
    console.log(`  Is Mock             : ${isMock}`);

    if (isMock) {
      throw new AbortError('Result is mock — cannot write mock data as live market row');
    }

    // ── Quality gate ──────────────────────────────────────────────────────
    const cfg = {
      latitude:   prop.latitude,
      longitude:  prop.longitude,
      max_guests: prop.max_guests,
      timezone,
      bedrooms:   prop.bedrooms,
    };
    const marketStats = calcProviderMarketStats(listings, cfg, dataSource);
    if (!marketStats) {
      throw new AbortError('Quality gate failed — insufficient comparables or invalid stats');
    }

    const sel = marketStats._bdSelectionDiag || {};
    console.log('');
    console.log('  ── Quality Gate ────────────────────────────────────');
    console.log(`  Comparable Count    : ${sel.comparableCount ?? marketStats.count}`);
    console.log(`  Selected Radius km  : ${sel.selectedRadiusKm ?? 'N/A'}`);
    console.log(`  Selection Status    : ${sel.selectionStatus ?? 'N/A'}`);
    console.log(`  Median Price        : ${marketStats.median}`);
    console.log(`  P25                 : ${marketStats.p25}`);
    console.log(`  P75                 : ${marketStats.p75}`);
    console.log(`  Calendar Proxy (%)  : ${marketStats.occupancy}`);
    console.log(`  Tension Level       : ${marketStats.tensionLevel}`);
    console.log(`  validateBDStats     : ${dataSource === 'brightdata_live' ? validateBDStats(marketStats) : 'N/A (Apify)'}`);
    console.log('');

    // ── Write market_data ─────────────────────────────────────────────────
    const writeResult = await writeScrapeResult(pool, {
      userId:                  prop.user_id,
      propertyId:              prop.property_id,
      weekStart,
      marketStats,
      zoneLabel:               zonesToTry[0],
      dataSource,
      capturedContextKey:      marketContextKey,
      capturedPropertyCurrency,
    });

    console.log('  ── Write Result ────────────────────────────────────');
    if (!writeResult.written) {
      throw new AbortError(`Write rejected: ${writeResult.reason} — captured=${writeResult.capturedCurrency ?? marketContextKey} vs current=${writeResult.currentCurrency ?? '?'}`);
    }
    console.log(`  market_data write   : ✅ WRITTEN (week_start=${weekStart})`);

    // ── Phase 6: Post-write resolver verification ─────────────────────────
    const resolution = await resolveMarketData(pool, {
      propertyId:         prop.property_id,
      propertyContextKey: marketContextKey,
      propertyCurrency:   capturedPropertyCurrency,
      now,
    });

    console.log('');
    console.log('  ── Resolver Verification ───────────────────────────');
    console.log(`  resolver status     : ${resolution.status}`);
    console.log(`  trusted             : ${resolution.trusted}`);
    console.log(`  fresh               : ${resolution.fresh}`);
    console.log(`  usable              : ${resolution.usable}`);
    console.log(`  locationCompatible  : ${resolution.locationCompatible}`);
    if (resolution.row) {
      console.log(`  stored data_source  : ${resolution.row.data_source}`);
      console.log(`  stored currency     : ${resolution.row.currency}`);
      console.log(`  stored median       : ${resolution.row.median_price}`);
      console.log(`  stored comparables  : ${resolution.row.comparable_count}`);
    }

    if (!resolution.trusted || !resolution.fresh || !resolution.usable) {
      throw new AbortError(`Resolver check FAILED: status=${resolution.status} trusted=${resolution.trusted} fresh=${resolution.fresh} usable=${resolution.usable}`);
    }
    if (resolution.row?.data_source !== dataSource) {
      throw new AbortError(`data_source mismatch: wrote ${dataSource} but resolver sees ${resolution.row?.data_source}`);
    }
    console.log('  ✅ Resolver: live_fresh / trusted / usable');

    // ── Phase 7: Pricing isolation — verify nothing changed ───────────────
    const postPriceConfigRes = await pool.query(
      'SELECT * FROM pricing_config WHERE property_id=$1', [prop.property_id]
    );
    const postPriceHistRes = await pool.query(
      'SELECT COUNT(*) AS n FROM pricing_history WHERE property_id=$1', [prop.property_id]
    );
    const postPriceSchedRes = await pool.query(
      'SELECT COUNT(*) AS n FROM pricing_schedule WHERE property_id=$1', [prop.property_id]
    );

    const priceConfigChanged = JSON.stringify(prePriceConfigRes.rows) !== JSON.stringify(postPriceConfigRes.rows);
    const histChanged        = prePriceHistRes.rows[0].n !== postPriceHistRes.rows[0].n;
    const schedChanged       = prePriceSchedRes.rows[0].n !== postPriceSchedRes.rows[0].n;

    console.log('');
    console.log('  ── Pricing Isolation ───────────────────────────────');
    console.log(`  pricing_config unchanged  : ${!priceConfigChanged ? '✅' : '❌ CHANGED'}`);
    console.log(`  pricing_history unchanged : ${!histChanged ? '✅' : '❌ CHANGED'}`);
    console.log(`  pricing_schedule unchanged: ${!schedChanged ? '✅' : '❌ CHANGED'}`);

    if (priceConfigChanged || histChanged || schedChanged) {
      throw new AbortError('Pricing isolation VIOLATED — pricing tables were modified');
    }
    console.log('  CHANNEX_WRITES = 0  (no channex import in this tool)');
    console.log('');
    console.log('════════════════════════════════════════════════════════');
    console.log('  EXECUTE COMPLETE');
    console.log('════════════════════════════════════════════════════════\n');

    return {
      propertyId:          prop.property_id,
      provider:            scrapeResult.provider,
      dataSource,
      comparableCount:     sel.comparableCount ?? marketStats.count,
      selectedRadiusKm:    sel.selectedRadiusKm ?? null,
      median:              marketStats.median,
      p25:                 marketStats.p25,
      p75:                 marketStats.p75,
      occupancy:           marketStats.occupancy,
      tensionLevel:        marketStats.tensionLevel,
      currency:            capturedPropertyCurrency,
      resolverStatus:      resolution.status,
      resolverTrusted:     resolution.trusted,
      resolverUsable:      resolution.usable,
      pricingIsolated:     true,
    };

  } catch (err) {
    if (err instanceof AbortError) {
      console.error(`\n  ❌ ABORTED: ${err.message}\n`);
      process.exitCode = 1;
      return { aborted: true, reason: err.message };
    }
    throw err;
  } finally {
    try { await pool.end(); } catch (_) {}
  }
}

// ── CLI ───────────────────────────────────────────────────────

if (require.main === module) {
  const args       = process.argv.slice(2);
  const nameIdx    = args.indexOf('--name');
  const name       = nameIdx !== -1 ? args[nameIdx + 1] : null;
  const isExecute  = args.includes('--execute-market-data');

  if (!name) {
    console.error('Usage: node outils/validate-brightdata-production-rollout.js --name "<property>" [--execute-market-data]');
    process.exit(1);
  }

  (isExecute ? executeMarketDataMode({ name }) : previewMode({ name }))
    .catch(err => { console.error('Fatal:', err.message); process.exit(1); });
}

module.exports = { previewMode, executeMarketDataMode, resolvePropG, AbortError, MAX_LISTINGS };
