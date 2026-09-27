#!/usr/bin/env node
'use strict';
/**
 * P1.2-B5-BK-M10 / M10F-7 — Production Market Signal Historical Anomaly Audit
 *
 * Reads production market_data rows from the DB, builds a historical baseline,
 * classifies anomalies vs that baseline, and emits a QUARANTINE_RECOMMENDATION
 * (INFORMATIONAL ONLY — no DB write, no pricing change, no Channex call).
 *
 * Usage:
 *   node audit-production-market-signal-m.js [options]
 *
 *   --property-id ID          filter by property_id
 *   --name NAME               filter by property internal_name or name (partial match)
 *   --limit N                 max rows to audit (default 10)
 *   --candidate-median N      M10F-5: candidate shadow median to compare
 *   --candidate-confidence X  M10F-5: candidate confidence level (e.g. HIGH)
 *   --candidate-status X      M10F-5: candidate market status (e.g. STABLE_DUAL)
 *
 * Requires DATABASE_URL in environment.
 *
 * SAFETY:
 *   DB_WRITES                    = 0  always
 *   PRICING_WRITES               = 0  always
 *   CHANNEX_CALLS                = 0  always
 *   BD_CALLS                     = 0  always
 *   SAFE_TO_ACTIVATE_PRODUCTION  = NO always
 */

const { Pool } = require('pg');
const { buildHistoricalBaseline }       = require('../services/market-historical-baseline');
const { checkStayWindowCompatibility }  = require('../services/market-stay-window-compatibility');
const { classifyHistoricalAnomaly }     = require('../services/market-historical-anomaly-classifier');

// ── Quarantine recommendation derivation (M10F-8) ────────────────────────────
// Informational only — never written to DB or applied to pricing.

const SEVERITY_TO_RECOMMENDATION = {
  NONE:        'NONE',
  LOW:         'CAUTION',
  HIGH:        'QUARANTINE',
  CRITICAL:    'QUARANTINE',
  INCONCLUSIVE: 'INCONCLUSIVE',
};

function deriveQuarantineRecommendation(severity) {
  return SEVERITY_TO_RECOMMENDATION[severity] ?? 'INCONCLUSIVE';
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function _arg(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

const args = process.argv.slice(2);

const propertyId          = _arg(args, '--property-id');
const nameFilter          = _arg(args, '--name');
const limit               = parseInt(_arg(args, '--limit') || '10', 10);
const candidateMedian     = _arg(args, '--candidate-median')     ? parseFloat(_arg(args, '--candidate-median'))  : null;
const candidateConfidence = _arg(args, '--candidate-confidence') || null;
const candidateStatus     = _arg(args, '--candidate-status')     || null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtAge(scrapedAt) {
  if (!scrapedAt) return 'unknown';
  const h = Math.round((Date.now() - new Date(scrapedAt).getTime()) / 3_600_000 * 10) / 10;
  return `${h}h ago`;
}

function fmtNum(n, decimals = 2) {
  return n != null ? Number(n).toFixed(decimals) : 'n/a';
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('P1.2-B5-BK-M10 — Production Market Signal Historical Anomaly Audit');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`Property ID     : ${propertyId || '(all)'}`);
  console.log(`Name filter     : ${nameFilter  || '(none)'}`);
  console.log(`Limit           : ${limit}`);
  if (candidateMedian != null) {
    console.log(`Candidate       : median=${candidateMedian} confidence=${candidateConfidence ?? 'n/a'} status=${candidateStatus ?? 'n/a'}`);
  }
  console.log(`Date            : ${new Date().toISOString().slice(0, 16)}Z`);
  console.log('SAFE_TO_ACTIVATE_PRODUCTION = NO');
  console.log('');

  try {
    // ── Step 1: resolve property_id from --name ───────────────────────────────
    let resolvedPropertyId = propertyId;

    if (!resolvedPropertyId && nameFilter) {
      const { rows: propRows } = await pool.query(
        `SELECT DISTINCT property_id, internal_name, name
         FROM market_data
         JOIN properties ON market_data.property_id::text = properties.id::text
         WHERE internal_name ILIKE $1 OR name ILIKE $1
         LIMIT 5`,
        [`%${nameFilter}%`]
      );

      if (!propRows.length) {
        // Fallback: look directly in market_data for property_id without join
        const { rows: mdRows } = await pool.query(
          `SELECT DISTINCT property_id FROM market_data LIMIT 20`
        );
        console.log(`No property matching name "${nameFilter}" found.`);
        console.log('Available property IDs in market_data:');
        mdRows.forEach(r => console.log(`  ${r.property_id}`));
        return;
      }

      resolvedPropertyId = propRows[0].property_id;
      console.log(`Resolved name "${nameFilter}" → property_id: ${resolvedPropertyId}`);
      console.log('');
    }

    // ── Step 2: fetch the latest rows to audit ────────────────────────────────
    const whereClause = resolvedPropertyId
      ? `WHERE md.property_id = $1 ORDER BY md.scraped_at DESC LIMIT $2`
      : `WHERE 1=1 ORDER BY md.scraped_at DESC LIMIT $1`;
    const params = resolvedPropertyId ? [resolvedPropertyId, limit] : [limit];

    const { rows } = await pool.query(
      `SELECT md.id, md.property_id, md.median_price, md.price_p25, md.price_p75,
              md.comparable_count, md.occupancy_rate, md.tension_level,
              md.data_source, md.scraped_at, md.currency, md.raw_data, md.week_start
       FROM market_data md
       ${whereClause}`,
      params
    );

    if (!rows.length) {
      console.log('No production market_data rows found.');
      return;
    }

    // Group by property_id for historical comparison
    const byProperty = new Map();
    for (const row of rows) {
      const pid = row.property_id;
      if (!byProperty.has(pid)) byProperty.set(pid, []);
      byProperty.get(pid).push(row);
    }

    // For each property that appears in the audit window, also fetch deeper history
    const historyCache = new Map();
    for (const [pid] of byProperty) {
      const { rows: histRows } = await pool.query(
        `SELECT id, property_id, median_price, comparable_count, scraped_at, raw_data, week_start
         FROM market_data
         WHERE property_id = $1
         ORDER BY scraped_at DESC
         LIMIT 20`,
        [pid]
      );
      historyCache.set(pid, histRows);
    }

    let totalAudited    = 0;
    let quarantineCount = 0;
    let cautionCount    = 0;
    let inconclusiveCount = 0;

    for (const [pid, propertyRows] of byProperty) {
      const allHistory = historyCache.get(pid) || [];

      for (const latestRow of propertyRows) {
        // Historical rows = all rows for this property strictly before this one
        const historicalRows = allHistory.filter(
          r => r.id !== latestRow.id && new Date(r.scraped_at) < new Date(latestRow.scraped_at)
        );

        const baseline   = buildHistoricalBaseline(latestRow, historicalRows);
        const windowComp = checkStayWindowCompatibility(latestRow, historicalRows);
        const anomaly    = classifyHistoricalAnomaly(baseline, windowComp);
        const recommendation = deriveQuarantineRecommendation(anomaly.severity);

        totalAudited++;
        if      (recommendation === 'QUARANTINE')    quarantineCount++;
        else if (recommendation === 'CAUTION')       cautionCount++;
        else if (recommendation === 'INCONCLUSIVE')  inconclusiveCount++;

        // ── Print structured block ────────────────────────────────────────────
        console.log(`── Property: ${pid} ──────────────────────────────────────────────`);
        console.log(`  PROPERTY              : ${pid}`);
        console.log(`  LATEST_MEDIAN         : ${fmtNum(latestRow.median_price)} ${latestRow.currency || ''}`);
        console.log(`  COMPARABLE_COUNT      : ${latestRow.comparable_count ?? 'n/a'}`);
        console.log(`  AGE                   : ${fmtAge(latestRow.scraped_at)}`);
        console.log(`  DATA_SOURCE           : ${latestRow.data_source || 'n/a'}`);
        console.log(`  WEEK_START            : ${latestRow.week_start || 'n/a'}`);
        console.log('');
        console.log(`  HISTORICAL_COUNT      : ${baseline.historyCount}`);
        console.log(`  HISTORICAL_MEDIAN     : ${fmtNum(baseline.historyMedian)}`);
        console.log(`  HISTORICAL_RANGE      : [${fmtNum(baseline.historyMin)}, ${fmtNum(baseline.historyMax)}]`);
        console.log(`  HISTORY_IQR           : [${fmtNum(baseline.iqrLow)}, ${fmtNum(baseline.iqrHigh)}]`);
        console.log(`  HISTORY_MAD           : ${fmtNum(baseline.mad)}`);
        console.log(`  HISTORY_COMPARABILITY : ${windowComp.status}`);
        console.log('');
        console.log(`  DELTA_VS_HISTORY      : ${anomaly.metrics.deltaVsHistoryMedianPct != null ? anomaly.metrics.deltaVsHistoryMedianPct + '%' : 'n/a'}`);
        console.log(`  RATIO_VS_HISTORY      : ${fmtNum(anomaly.metrics.ratioVsHistoryMedian, 3)}`);
        console.log(`  ANOMALY_SEVERITY      : ${anomaly.severity}`);
        console.log(`  ANOMALY_REASONS       : ${anomaly.reasons.length ? anomaly.reasons.join(', ') : '(none)'}`);
        console.log(`  ANOMALY_WARNINGS      : ${anomaly.warnings.length ? anomaly.warnings.join(', ') : '(none)'}`);
        console.log(`  QUARANTINE_RECOMMENDATION : ${recommendation}  (informational only — 0 DB writes)`);

        // ── M10F-5: Candidate signal comparison ───────────────────────────────
        if (candidateMedian != null) {
          const latestMed = Number(latestRow.median_price);
          const candDelta = latestMed > 0
            ? Math.round((candidateMedian - latestMed) / latestMed * 100 * 100) / 100
            : null;
          console.log('');
          console.log(`  CANDIDATE_MEDIAN      : ${candidateMedian}`);
          console.log(`  CANDIDATE_CONFIDENCE  : ${candidateConfidence ?? 'n/a'}`);
          console.log(`  CANDIDATE_STATUS      : ${candidateStatus ?? 'n/a'}`);
          console.log(`  PROD_VS_CANDIDATE_PCT : ${candDelta != null ? candDelta + '%' : 'n/a'}`);
          if (baseline.historyMedian && baseline.historyMedian > 0) {
            const candVsHistory = Math.round((candidateMedian - baseline.historyMedian) / baseline.historyMedian * 100 * 100) / 100;
            console.log(`  CANDIDATE_VS_HISTORY  : ${candVsHistory}%`);
          }
        }

        // ── Historical medians list ────────────────────────────────────────────
        if (baseline.historyMedians && baseline.historyMedians.length) {
          console.log('');
          console.log(`  HISTORY_MEDIANS       : [${baseline.historyMedians.map(m => fmtNum(m)).join(', ')}]`);
        }

        console.log('');
      }
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('Summary');
    console.log(`  Rows audited              : ${totalAudited}`);
    console.log(`  QUARANTINE (recommended)  : ${quarantineCount}`);
    console.log(`  CAUTION                   : ${cautionCount}`);
    console.log(`  INCONCLUSIVE              : ${inconclusiveCount}`);
    console.log(`  CLEAN (NONE)              : ${totalAudited - quarantineCount - cautionCount - inconclusiveCount}`);
    console.log('');
    console.log('SAFE_TO_ACTIVATE_PRODUCTION = NO');
    console.log('0 BD credits consumed. 0 DB writes. 0 pricing changes.');

  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
