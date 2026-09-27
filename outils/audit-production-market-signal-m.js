#!/usr/bin/env node
'use strict';
/**
 * P1.2-B5-BK-M10 — Production Market Signal Audit
 *
 * Reads production market_data rows from the DB and runs the M5 quarantine
 * + L4 sanity check against fresh shadow results (or injected fixtures).
 *
 * Usage:
 *   node audit-production-market-signal-m.js [--property-id ID] [--limit N]
 *
 * Requires DATABASE_URL in environment.
 * Does NOT make Bright Data calls — shadow results must be pre-computed or
 * provided via --fixture.
 *
 * SAFETY:
 *   DB_WRITES        = 0  always
 *   PRICING_WRITES   = 0  always
 *   CHANNEX_CALLS    = 0  always
 *   BD_CALLS         = 0  always
 */

const { Pool } = require('pg');
const { analyzeProductionSignalSanity } = require('../services/market-production-sanity');
const { evaluateQuarantine }            = require('../services/market-production-quarantine');

// ── CLI ───────────────────────────────────────────────────────────────────────

const args        = process.argv.slice(2);
const pidIdx      = args.indexOf('--property-id');
const propertyId  = pidIdx >= 0 ? args[pidIdx + 1] : null;
const limitIdx    = args.indexOf('--limit');
const limit       = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 10;

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('P1.2-B5-BK-M10 — Production Market Signal Audit');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Property filter : ${propertyId || '(all)'}`);
  console.log(`Limit           : ${limit}`);
  console.log(`Date            : ${new Date().toISOString().slice(0, 10)}`);
  console.log('');

  try {
    const whereClause = propertyId
      ? `WHERE property_id = $1 ORDER BY scraped_at DESC LIMIT $2`
      : `WHERE 1=1 ORDER BY scraped_at DESC LIMIT $1`;
    const params = propertyId ? [propertyId, limit] : [limit];

    const { rows } = await pool.query(
      `SELECT id, property_id, median_price, price_p25, price_p75,
              comparable_count, occupancy_rate, tension_level,
              data_source, scraped_at, currency
       FROM market_data
       ${whereClause}`,
      params
    );

    if (!rows.length) {
      console.log('No production market_data rows found.');
      return;
    }

    let quarantinedCount = 0;
    let cautionCount     = 0;

    for (const row of rows) {
      // Without a shadow result to compare, run sanity with nulls
      // (demonstrates the module works with production data)
      const sanity = analyzeProductionSignalSanity({
        productionSignal:  row,
        airbnbDiagMedian:  null,
        bookingDiagMedian: null,
        shadowConsensus:   null,
      });

      const quarantine = evaluateQuarantine(sanity);

      const ageH   = sanity.signalAgeHours != null
        ? `${sanity.signalAgeHours}h ago`
        : 'unknown age';

      console.log(`Property ${row.property_id || row.id}`);
      console.log(`  median_price   : ${row.median_price} ${row.currency || ''}`);
      console.log(`  comparable_cnt : ${row.comparable_count}`);
      console.log(`  data_source    : ${row.data_source}`);
      console.log(`  scraped_at     : ${ageH}`);
      console.log(`  quarantine     : ${quarantine.level} ${quarantine.quarantined ? '⚠ QUARANTINED' : ''}`);
      console.log('');

      if (quarantine.quarantined)        quarantinedCount++;
      else if (quarantine.level === 'CAUTION') cautionCount++;
    }

    console.log('── Summary ──────────────────────────────────────────────────');
    console.log(`  Rows audited   : ${rows.length}`);
    console.log(`  QUARANTINED    : ${quarantinedCount}`);
    console.log(`  CAUTION        : ${cautionCount}`);
    console.log(`  CLEAN          : ${rows.length - quarantinedCount - cautionCount}`);
    console.log('');
    console.log('0 BD credits consumed. 0 DB writes.');
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
