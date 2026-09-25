#!/usr/bin/env node
'use strict';
require('dotenv').config();
/**
 * P1.2-B4-H2 — Property Geo Completeness Diagnostic
 *
 * READ-ONLY. DB_WRITES = 0. EXTERNAL_API_CALLS = 0. CHANNEX_WRITES = 0.
 *
 * For BoostPrice-active properties (or --name <pattern>), shows:
 *   - All address/geo fields from properties
 *   - Computed market_context_key (null = geo incomplete)
 *   - Geo completeness flag and geocodeable address flag
 *   - Latest market_data context fields
 *   - BoostPrice config (active, mode, channex_enabled)
 *
 * Summary across all active properties:
 *   ACTIVE_BOOSTPRICE_TOTAL / ACTIVE_WITH_COMPLETE_GEO / ACTIVE_WITH_INCOMPLETE_GEO
 *
 * Usage:
 *   DATABASE_URL=... node outils/diag-property-geo.js
 *   DATABASE_URL=... node outils/diag-property-geo.js --name M6
 *   DATABASE_URL=... node outils/diag-property-geo.js --all    # include inactive
 *   DATABASE_URL=... node outils/diag-property-geo.js --json   # machine-readable output
 */

const { Pool }                    = require('pg');
const { computeMarketContextKey } = require('../routes/market-context-key');

// DB_WRITES = 0
// EXTERNAL_API_CALLS = 0
// CHANNEX_WRITES = 0

const args = process.argv.slice(2);
let filterName   = null;
let includeAll   = false;
let emitJson     = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--name' && args[i + 1]) { filterName = args[++i]; }
  if (args[i] === '--all')                 { includeAll = true; }
  if (args[i] === '--json')                { emitJson = true; }
}

function makePool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL requis');
  return new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
}

function fmt(v)  { return v == null ? 'NULL' : String(v); }
function tail(id) { return id ? '…' + String(id).slice(-8) : '(none)'; }
function fmtDate(v) {
  if (v == null) return 'NULL';
  try { return new Date(v).toISOString().slice(0, 19); } catch { return String(v); }
}

// Determine whether an address string is sufficient for a geocoding attempt
function isGeocodeableAddress(address) {
  if (!address || !String(address).trim()) return false;
  const a = String(address).trim();
  // Require at least a number + street or a city name — not just "France" etc
  if (/^france$/i.test(a)) return false;
  if (a.length < 8) return false;
  return true;
}

async function run() {
  const pool = makePool();

  try {
    // 1. Load BoostPrice-active properties (or filtered by name)
    let propSql, propParams;
    if (filterName) {
      // Name filter: include active and inactive to show any matching property
      propSql = `
        SELECT p.id, p.name, p.internal_name, p.address, p.city, p.postal_code,
               p.country_code, p.latitude, p.longitude, p.timezone, p.currency,
               p.channex_enabled, p.channex_rate_plan_id,
               pc.is_active, pc.mode, pc.user_id
        FROM properties p
        LEFT JOIN pricing_config pc ON pc.property_id = p.id AND pc.user_id = p.user_id
        WHERE (p.internal_name ILIKE $1 OR p.name ILIKE $1)
        ORDER BY p.id
      `;
      propParams = [`%${filterName}%`];
    } else if (includeAll) {
      propSql = `
        SELECT p.id, p.name, p.internal_name, p.address, p.city, p.postal_code,
               p.country_code, p.latitude, p.longitude, p.timezone, p.currency,
               p.channex_enabled, p.channex_rate_plan_id,
               pc.is_active, pc.mode, pc.user_id
        FROM properties p
        INNER JOIN pricing_config pc ON pc.property_id = p.id AND pc.user_id = p.user_id
        ORDER BY pc.is_active DESC, p.id
      `;
      propParams = [];
    } else {
      // Default: BoostPrice-active only
      propSql = `
        SELECT p.id, p.name, p.internal_name, p.address, p.city, p.postal_code,
               p.country_code, p.latitude, p.longitude, p.timezone, p.currency,
               p.channex_enabled, p.channex_rate_plan_id,
               pc.is_active, pc.mode, pc.user_id
        FROM properties p
        INNER JOIN pricing_config pc ON pc.property_id = p.id AND pc.user_id = p.user_id
        WHERE pc.is_active = TRUE
        ORDER BY p.id
      `;
      propParams = [];
    }

    const properties = (await pool.query(propSql, propParams)).rows;

    if (properties.length === 0) {
      console.log(filterName
        ? `  (no property matching "${filterName}")`
        : '  (no BoostPrice-active properties found)');
      return { properties: [], summary: null };
    }

    // 2. Latest market_data per property
    const ids = properties.map(p => p.id);
    const marketSql = `
      SELECT DISTINCT ON (property_id)
        property_id, week_start, scraped_at, data_source, currency, market_context_key
      FROM market_data
      WHERE property_id = ANY($1::text[])
      ORDER BY property_id, week_start DESC, scraped_at DESC
    `;
    const marketRows = (await pool.query(marketSql, [ids])).rows;
    const marketMap  = {};
    marketRows.forEach(r => { marketMap[r.property_id] = r; });

    const results = [];
    let totalComplete = 0, totalIncomplete = 0;

    for (const p of properties) {
      const propName   = p.internal_name || p.name || p.id;
      const ctxKey     = computeMarketContextKey({
        countryCode: p.country_code,
        latitude:    p.latitude,
        longitude:   p.longitude,
      });
      const geoComplete   = ctxKey !== null;
      // Derive geocodeable address: prefer full address; fall back to city+postal_code
      const geoQuery      = p.address || [p.city, p.postal_code].filter(Boolean).join(', ') || null;
      const geocodeable   = isGeocodeableAddress(geoQuery);
      const market        = marketMap[p.id] || null;

      if (p.is_active) {
        if (geoComplete) totalComplete++;
        else             totalIncomplete++;
      }

      console.log('\n' + '═'.repeat(72));
      console.log(`  PROPERTY: ${propName} [${tail(p.id)}]`);
      console.log('═'.repeat(72));

      console.log('\n  ── ADDRESS/GEO ──────────────────────────────────────────────');
      console.log(`  id                   : ${p.id}`);
      console.log(`  name                 : ${propName}`);
      console.log(`  address              : ${fmt(p.address)}`);
      console.log(`  city                 : ${fmt(p.city)}`);
      console.log(`  postal_code          : ${fmt(p.postal_code)}`);
      console.log(`  country_code         : ${fmt(p.country_code)}`);
      console.log(`  latitude             : ${fmt(p.latitude)}`);
      console.log(`  longitude            : ${fmt(p.longitude)}`);
      console.log(`  timezone             : ${fmt(p.timezone)}`);
      console.log(`  currency             : ${fmt(p.currency)}`);
      console.log(`  computed_ctx_key     : ${fmt(ctxKey)}`);

      console.log('\n  ── GEO READINESS ────────────────────────────────────────────');
      console.log(`  GEO_COMPLETE         : ${geoComplete}`);
      console.log(`  GEO_QUERY_STRING     : ${fmt(geoQuery)}`);
      console.log(`  ADDRESS_GEOCODEABLE  : ${geocodeable}`);

      console.log('\n  ── BOOSTPRICE CONFIG ────────────────────────────────────────');
      console.log(`  bp_active            : ${fmt(p.is_active)}`);
      console.log(`  mode                 : ${fmt(p.mode)}`);
      console.log(`  channex_enabled      : ${fmt(p.channex_enabled)}`);
      console.log(`  channex_rate_plan_id : ${tail(p.channex_rate_plan_id)}`);

      console.log('\n  ── LATEST MARKET_DATA ───────────────────────────────────────');
      if (!market) {
        console.log('  (none)');
      } else {
        console.log(`  week_start           : ${fmt(market.week_start)}`);
        console.log(`  scraped_at           : ${fmtDate(market.scraped_at)}`);
        console.log(`  data_source          : ${fmt(market.data_source)}`);
        console.log(`  currency             : ${fmt(market.currency)}`);
        console.log(`  market_context_key   : ${fmt(market.market_context_key)}`);
        const mctxMatch = ctxKey && market.market_context_key === ctxKey;
        console.log(`  context_key_matches  : ${ctxKey ? mctxMatch : 'N/A (geo incomplete)'}`);
      }

      results.push({
        propertyId:    p.id,
        propertyName:  propName,
        bp_active:     p.is_active,
        mode:          p.mode,
        channex_enabled: p.channex_enabled,
        address:       p.address,
        city:          p.city,
        postal_code:   p.postal_code,
        country_code:  p.country_code,
        latitude:      p.latitude,
        longitude:     p.longitude,
        timezone:      p.timezone,
        currency:      p.currency,
        ctxKey,
        geoComplete,
        geocodeable,
        geoQuery,
        latestMarket: market ? {
          week_start:        market.week_start,
          scraped_at:        market.scraped_at,
          data_source:       market.data_source,
          currency:          market.currency,
          market_context_key: market.market_context_key,
        } : null,
      });
    }

    // 3. Summary
    const activeProps = results.filter(r => r.bp_active);
    const incompleteGeoList = activeProps.filter(r => !r.geoComplete);

    console.log('\n' + '═'.repeat(72));
    console.log('  GEO COMPLETENESS SUMMARY');
    console.log('═'.repeat(72));
    console.log(`  ACTIVE_BOOSTPRICE_TOTAL      : ${activeProps.length}`);
    console.log(`  ACTIVE_WITH_COMPLETE_GEO     : ${totalComplete}`);
    console.log(`  ACTIVE_WITH_INCOMPLETE_GEO   : ${totalIncomplete}`);
    if (incompleteGeoList.length > 0) {
      console.log('\n  Properties with INCOMPLETE geo:');
      incompleteGeoList.forEach(r => {
        console.log(`    - ${r.propertyName} [${tail(r.propertyId)}]`);
        console.log(`      address="${r.address || r.city || '(none)'}"`);
        console.log(`      geocodeable=${r.geocodeable}  channex_enabled=${r.channex_enabled}  mode=${r.mode}`);
      });
    }
    console.log('\n  DB_WRITES = 0 | EXTERNAL_API_CALLS = 0 | CHANNEX_WRITES = 0');
    console.log('═'.repeat(72) + '\n');

    if (emitJson) {
      const summary = {
        activeBpTotal:         activeProps.length,
        activeWithCompleteGeo: totalComplete,
        activeWithIncompleteGeo: totalIncomplete,
        incompleteGeoList:     incompleteGeoList.map(r => ({ propertyId: r.propertyId, name: r.propertyName, address: r.address, city: r.city, geocodeable: r.geocodeable })),
      };
      console.log('JSON:' + JSON.stringify({ properties: results, summary }, null, 2));
    }

    return { properties: results, summary: { activeProps, totalComplete, totalIncomplete } };

  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  run().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}

module.exports = { run, isGeocodeableAddress };
