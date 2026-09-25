#!/usr/bin/env node
'use strict';
require('dotenv').config();
/**
 * P1.2-B4-H — Market State Diagnostic
 *
 * READ-ONLY. DB_WRITES = 0. CHANNEX_WRITES = 0. APIFY_CALLS = 0.
 *
 * For each BoostPrice-active property (or --property <id>), shows:
 *   - property: currency, config, geo, market context key
 *   - latest market_data row: all fields
 *   - last N market_data rows (history)
 *   - resolver classification: status, trusted, fresh, usable,
 *     refreshRequired, isMock semantics, auto-push block
 *
 * Usage: DATABASE_URL=... node outils/diag-market-state.js
 *   --property <id>   restrict to one property id (optional)
 *   --history <n>     show last N rows per property (default: 5)
 *   --json            emit machine-readable JSON at the end
 */

const { Pool }              = require('pg');
const { classifyMarketData } = require('../routes/market-data-resolver');
const { computeMarketContextKey } = require('../routes/market-context-key');

// DB_WRITES = 0
// CHANNEX_WRITES = 0
// APIFY_CALLS = 0

const args = process.argv.slice(2);
let filterPropertyId = null;
let historyCount     = 5;
let emitJson         = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--property' && args[i + 1]) { filterPropertyId = args[++i]; }
  if (args[i] === '--history'  && args[i + 1]) { historyCount = parseInt(args[++i]) || 5; }
  if (args[i] === '--json')                    { emitJson = true; }
}

function makePool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL requis');
  return new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
}

function tail(id) { return id ? '…' + String(id).slice(-8) : '(none)'; }
function fmt(v)   { return v == null ? 'NULL' : String(v); }
function fmtDate(v) {
  if (v == null) return 'NULL';
  try { return new Date(v).toISOString(); } catch { return String(v); }
}

async function run() {
  const pool = makePool();
  let properties, historyMap;

  try {
    // 1. Properties + pricing_config
    const propFilter = filterPropertyId ? 'AND p.id = $2' : '';
    const propParams = filterPropertyId ? [true, filterPropertyId] : [true];
    const propSql = `
      SELECT
        p.id, p.name, p.internal_name, p.address,
        p.currency      AS property_currency,
        p.country_code, p.latitude, p.longitude,
        p.channex_enabled, p.channex_rate_plan_id,
        pc.is_active    AS bp_active,
        pc.mode,
        pc.user_id
      FROM properties p
      JOIN pricing_config pc ON pc.property_id = p.id AND pc.user_id = p.user_id
      WHERE pc.is_active = $1
        ${propFilter}
      ORDER BY p.id
    `;
    properties = (await pool.query(propSql, propParams)).rows;

    if (properties.length === 0 && filterPropertyId) {
      // Try inactive too
      const r2 = await pool.query(propSql.replace('pc.is_active = $1', 'TRUE'), [filterPropertyId]);
      properties = r2.rows;
    }

    // 2. Latest market_data row per property
    const ids = properties.map(p => p.id);
    if (ids.length === 0) { console.log('Aucune propriété trouvée.'); await pool.end(); return; }

    const latestSql = `
      SELECT DISTINCT ON (property_id)
        id, property_id, week_start, scraped_at, created_at,
        data_source, currency, market_context_key,
        zone_label, comparable_count, median_price,
        price_p25, price_p75, occupancy_rate, tension_level
      FROM market_data
      WHERE property_id = ANY($1::text[])
      ORDER BY property_id, week_start DESC, scraped_at DESC
    `;
    const latestRows = (await pool.query(latestSql, [ids])).rows;
    const latestMap  = {};
    latestRows.forEach(r => { latestMap[r.property_id] = r; });

    // 3. Last N rows per property
    const historySql = `
      SELECT id, property_id, week_start, scraped_at, created_at,
             data_source, currency, market_context_key,
             zone_label, comparable_count, median_price,
             price_p25, price_p75, occupancy_rate, tension_level
      FROM market_data
      WHERE property_id = ANY($1::text[])
      ORDER BY property_id, week_start DESC, scraped_at DESC
    `;
    const historyRows = (await pool.query(historySql, [ids])).rows;
    historyMap = {};
    for (const r of historyRows) {
      if (!historyMap[r.property_id]) historyMap[r.property_id] = [];
      if (historyMap[r.property_id].length < historyCount) historyMap[r.property_id].push(r);
    }

  } finally {
    await pool.end();
  }

  const jsonOut = [];

  for (const prop of properties) {
    const propCtxKey = computeMarketContextKey({
      countryCode: prop.country_code,
      latitude:    prop.latitude,
      longitude:   prop.longitude,
    });

    const latest = latestMap[prop.id] || null;
    const cls    = classifyMarketData(latest, {
      propertyCurrency:   prop.property_currency ?? null,
      propertyContextKey: propCtxKey,
    });

    // isMock semantics: same logic as cron
    const isMock = !cls.trusted && cls.status !== 'missing';
    const autoPushBlocked = isMock;  // auto-push blocked only when isMock

    const propName = prop.internal_name || prop.name || prop.id;

    console.log('\n' + '═'.repeat(72));
    console.log(`  PROPERTY: ${propName} [${tail(prop.id)}]`);
    console.log('═'.repeat(72));

    console.log('\n  ── PROPERTY ─────────────────────────────────────────────');
    console.log(`  id                   : ${prop.id}`);
    console.log(`  name                 : ${propName}`);
    console.log(`  properties.currency  : ${fmt(prop.property_currency)}`);
    console.log(`  bp_active            : ${fmt(prop.bp_active)}`);
    console.log(`  mode                 : ${fmt(prop.mode)}`);
    console.log(`  channex_enabled      : ${fmt(prop.channex_enabled)}`);
    console.log(`  channex_rate_plan_id : ${tail(prop.channex_rate_plan_id)}`);
    console.log(`  country_code         : ${fmt(prop.country_code)}`);
    console.log(`  latitude             : ${fmt(prop.latitude)}`);
    console.log(`  longitude            : ${fmt(prop.longitude)}`);
    console.log(`  market_context_key   : ${fmt(propCtxKey)}`);

    console.log('\n  ── LATEST MARKET_DATA ───────────────────────────────────');
    if (!latest) {
      console.log('  (no row)');
    } else {
      console.log(`  id                   : ${fmt(latest.id)}`);
      console.log(`  week_start           : ${fmt(latest.week_start)}`);
      console.log(`  scraped_at           : ${fmtDate(latest.scraped_at)}`);
      console.log(`  created_at           : ${fmtDate(latest.created_at)}`);
      console.log(`  data_source          : ${fmt(latest.data_source)}`);
      console.log(`  currency             : ${fmt(latest.currency)}`);
      console.log(`  market_context_key   : ${fmt(latest.market_context_key)}`);
      console.log(`  zone_label           : ${fmt(latest.zone_label)}`);
      console.log(`  comparable_count     : ${fmt(latest.comparable_count)}`);
      console.log(`  median_price         : ${fmt(latest.median_price)}`);
      console.log(`  price_p25/p75        : ${fmt(latest.price_p25)} / ${fmt(latest.price_p75)}`);
      console.log(`  occupancy_rate       : ${fmt(latest.occupancy_rate)}`);
      console.log(`  tension_level        : ${fmt(latest.tension_level)}`);
    }

    console.log('\n  ── RESOLVER ─────────────────────────────────────────────');
    console.log(`  resolverStatus       : ${cls.status}`);
    console.log(`  trusted              : ${cls.trusted}`);
    console.log(`  fresh                : ${cls.fresh}`);
    console.log(`  usable               : ${cls.usable}`);
    console.log(`  refreshRequired      : ${cls.refreshRequired ?? false}`);
    console.log(`  market returned      : ${cls.market ? 'YES' : 'NO'}`);
    console.log(`  isMock (cron logic)  : ${isMock}`);
    console.log(`  auto-push blocked    : ${autoPushBlocked}`);
    if (cls.propertyCurrency !== undefined) console.log(`  propertyCurrency     : ${fmt(cls.propertyCurrency)}`);
    if (cls.marketCurrency   !== undefined) console.log(`  marketCurrency       : ${fmt(cls.marketCurrency)}`);
    if (cls.ageMs            != null)       console.log(`  ageMs/days           : ${cls.ageMs} / ${cls.ageDays?.toFixed(1)}`);

    // History
    const hist = historyMap[prop.id] || [];
    console.log(`\n  ── LAST ${historyCount} MARKET_DATA ROWS ─────────────────────────────`);
    if (hist.length === 0) {
      console.log('  (none)');
    } else {
      const hdr = '  #  week_start   scraped_at            data_source  currency  ctx_key          median   occ   tension';
      console.log(hdr);
      console.log('  ' + '─'.repeat(hdr.length - 2));
      hist.forEach((r, i) => {
        const ctxShort = r.market_context_key ? r.market_context_key.slice(0, 14) : 'NULL          ';
        const sa       = r.scraped_at ? new Date(r.scraped_at).toISOString().slice(0, 19) : 'NULL               ';
        const cur      = (r.currency || 'NULL').padEnd(4);
        const ds       = (r.data_source || 'NULL').padEnd(10);
        const med      = r.median_price != null ? String(Math.round(r.median_price)).padStart(6) : '  NULL';
        const occ      = r.occupancy_rate != null ? String(r.occupancy_rate).padStart(4) + '%' : ' NULL';
        console.log(`  ${i+1}  ${String(r.week_start).slice(0,10).padEnd(12)} ${sa}  ${ds} ${cur}      ${ctxShort.padEnd(16)} ${med}  ${occ}  ${r.tension_level || 'NULL'}`);
      });
    }

    jsonOut.push({
      propertyId:         prop.id,
      propertyName:       propName,
      property_currency:  prop.property_currency,
      bp_active:          prop.bp_active,
      mode:               prop.mode,
      channex_enabled:    prop.channex_enabled,
      market_context_key: propCtxKey,
      latestRow: latest ? {
        id:                latest.id,
        week_start:        latest.week_start,
        scraped_at:        latest.scraped_at,
        created_at:        latest.created_at,
        data_source:       latest.data_source,
        currency:          latest.currency,
        market_context_key: latest.market_context_key,
        median_price:      latest.median_price,
        comparable_count:  latest.comparable_count,
      } : null,
      resolver: {
        status:          cls.status,
        trusted:         cls.trusted,
        fresh:           cls.fresh,
        usable:          cls.usable,
        refreshRequired: cls.refreshRequired ?? false,
        isMock,
        autoPushBlocked,
      },
      history: hist.map(r => ({
        week_start:  r.week_start,
        scraped_at:  r.scraped_at,
        data_source: r.data_source,
        currency:    r.currency,
        market_context_key: r.market_context_key,
        median_price: r.median_price,
      })),
    });
  }

  console.log('\n' + '═'.repeat(72));
  console.log(`  TOTAL: ${properties.length} propert${properties.length === 1 ? 'y' : 'ies'} diagnosed.`);
  console.log('  DB_WRITES = 0 | CHANNEX_WRITES = 0 | APIFY_CALLS = 0');
  console.log('═'.repeat(72) + '\n');

  if (emitJson) {
    console.log('JSON:' + JSON.stringify(jsonOut, null, 2));
  }
}

run().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
