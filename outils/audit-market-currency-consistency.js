#!/usr/bin/env node
'use strict';
require('dotenv').config();
/**
 * P1.2-B4-G — Market Currency Consistency Audit
 *
 * READ-ONLY. DB_WRITES = 0. CHANNEX_WRITES = 0.
 * Only SELECT queries. No Channex mutations.
 *
 * For every BoostPrice-active property, fetches properties.currency and the
 * latest market_data row, then classifies via classifyMarketData.
 * Reports currency-related resolver statuses and flags those requiring a refresh.
 *
 * Usage: DATABASE_URL=... node outils/audit-market-currency-consistency.js
 *   --user <userId>   restrict to one user (optional)
 *   --json            emit machine-readable JSON at the end (optional)
 *   --all             include inactive pricing_config rows too (optional)
 */

const { Pool }              = require('pg');
const { classifyMarketData } = require('../routes/market-data-resolver');
const { computeMarketContextKey } = require('../routes/market-context-key');

// DB_WRITES = 0
// CHANNEX_WRITES = 0

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let filterUserId = null;
let emitJson     = false;
let includeAll   = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--user' && args[i + 1]) { filterUserId = args[++i]; }
  if (args[i] === '--json')                { emitJson = true; }
  if (args[i] === '--all')                 { includeAll = true; }
}

function makePool() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required');
  }
  return new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
}

function tail(id) {
  if (!id) return '(none)';
  return '…' + String(id).slice(-8);
}

// ── Fetch properties + latest market snapshot in one pass ─────────────────────
async function fetchData(pool, userId, includeInactive) {
  const isActiveFilter = includeInactive ? '' : 'AND pc.is_active = TRUE';
  const userFilter     = userId ? 'AND p.user_id = $1' : '';
  const params         = userId ? [userId] : [];

  const sql = `
    SELECT
      p.id            AS property_id,
      p.name          AS property_name,
      p.currency      AS property_currency,
      p.country_code,
      p.latitude,
      p.longitude,
      pc.is_active    AS bp_active,
      md.week_start   AS market_week_start,
      md.scraped_at   AS market_scraped_at,
      md.data_source  AS market_data_source,
      md.currency     AS market_currency,
      md.market_context_key,
      md.median_price,
      md.comparable_count,
      md.tension_level
    FROM properties p
    JOIN pricing_config pc ON pc.property_id = p.id AND pc.user_id = p.user_id
                              ${isActiveFilter}
    LEFT JOIN LATERAL (
      SELECT week_start, scraped_at, data_source, currency, market_context_key,
             median_price, comparable_count, tension_level
      FROM market_data
      WHERE property_id = p.id
      ORDER BY week_start DESC, scraped_at DESC
      LIMIT 1
    ) md ON TRUE
    WHERE TRUE
      ${userFilter}
    ORDER BY p.user_id, p.id
  `;
  const res = await pool.query(sql, params);
  return res.rows;
}

// ── Classify each row ─────────────────────────────────────────────────────────
function classify(row) {
  const propertyContextKey = computeMarketContextKey({
    countryCode: row.country_code,
    latitude:    row.latitude,
    longitude:   row.longitude,
  });

  // Reconstruct market_data row shape expected by classifyMarketData
  const marketRow = row.market_week_start ? {
    week_start:          row.market_week_start,
    scraped_at:          row.market_scraped_at,
    data_source:         row.market_data_source,
    currency:            row.market_currency,
    market_context_key:  row.market_context_key,
    median_price:        row.median_price,
    comparable_count:    row.comparable_count,
    tension_level:       row.tension_level,
  } : null;

  return classifyMarketData(marketRow, {
    propertyCurrency:   row.property_currency ?? null,
    propertyContextKey,
  });
}

// ── Formatting ────────────────────────────────────────────────────────────────
const STATUS_ORDER = [
  'currency_mismatch',
  'market_currency_unknown',
  'property_currency_unknown',
  'missing',
  'live_stale',
  'live_wrong_location',
  'legacy_unverified_location',
  'context_unavailable',
  'mock',
  'unknown',
  'invalid',
  'live_fresh',
];

function formatLine(row, cls) {
  const name     = (row.property_name || row.property_id || '?').slice(0, 38).padEnd(38);
  const idTag    = tail(row.property_id);
  const propCur  = (row.property_currency || 'null').padEnd(4);
  const mktCur   = (row.market_currency   || 'null').padEnd(4);
  const refresh  = cls.refreshRequired ? ' ⟳ REFRESH' : '';
  const usable   = cls.usable           ? ' ✓usable'   : '';
  return `  [${cls.status.padEnd(28)}] ${idTag}  ${name}  prop:${propCur}  mkt:${mktCur}${refresh}${usable}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  P1.2-B4-G — Market Currency Consistency Audit');
  console.log('  READ-ONLY. DB_WRITES = 0. CHANNEX_WRITES = 0.');
  if (filterUserId) console.log(`  Filter: user_id = ${tail(filterUserId)}`);
  if (includeAll)   console.log('  Mode: ALL pricing_config rows (including inactive)');
  else              console.log('  Mode: active pricing_config only');
  console.log('═══════════════════════════════════════════════════════════\n');

  const pool = makePool();
  let rows;
  try {
    rows = await fetchData(pool, filterUserId, includeAll);
  } finally {
    await pool.end();
  }

  console.log(`  Loaded ${rows.length} propert${rows.length === 1 ? 'y' : 'ies'} from DB.\n`);
  if (rows.length === 0) {
    console.log('  Nothing to audit.\n');
    process.exit(0);
  }

  // Classify and group
  const classified = rows.map(row => ({ row, cls: classify(row) }));
  const grouped    = {};
  for (const { row, cls } of classified) {
    if (!grouped[cls.status]) grouped[cls.status] = [];
    grouped[cls.status].push({ row, cls });
  }

  // Print per-status sections
  for (const status of STATUS_ORDER) {
    const group = grouped[status];
    if (!group || group.length === 0) continue;
    const bar = '─'.repeat(Math.max(0, 46 - status.length - String(group.length).length - 4));
    console.log(`── ${status} (${group.length}) ${bar}`);
    for (const { row, cls } of group) {
      console.log(formatLine(row, cls));
    }
    console.log();
  }

  // Counters
  const byStatus     = {};
  let refreshNeeded  = 0;
  let usableCount    = 0;
  for (const { cls } of classified) {
    byStatus[cls.status] = (byStatus[cls.status] || 0) + 1;
    if (cls.refreshRequired) refreshNeeded++;
    if (cls.usable)          usableCount++;
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Total:             ${rows.length}`);
  console.log(`  Usable (live_fresh): ${usableCount}`);
  console.log(`  Refresh required:    ${refreshNeeded}`);
  console.log();
  console.log('  By resolver status:');
  for (const status of STATUS_ORDER) {
    const count = byStatus[status] || 0;
    if (count === 0) continue;
    const warn = (status === 'currency_mismatch' || status === 'market_currency_unknown') ? '  ⚠' : '';
    console.log(`    ${status.padEnd(30)} ${String(count).padStart(4)}${warn}`);
  }
  console.log();

  if (refreshNeeded > 0) {
    console.log(`  ⚠  ${refreshNeeded} propert${refreshNeeded === 1 ? 'y' : 'ies'} need a market refresh (currency issue).`);
  } else {
    console.log('  ✓  No currency-related refresh flags.');
  }
  console.log('═══════════════════════════════════════════════════════════\n');

  if (emitJson) {
    const json = {
      runAt:          new Date().toISOString(),
      total:          rows.length,
      usableCount,
      refreshNeeded,
      byStatus,
      refreshPropertyIds: classified
        .filter(({ cls }) => cls.refreshRequired)
        .map(({ row }) => tail(row.property_id)),
    };
    console.log('JSON:' + JSON.stringify(json));
  }

  process.exit(refreshNeeded > 0 ? 2 : 0);
})();
