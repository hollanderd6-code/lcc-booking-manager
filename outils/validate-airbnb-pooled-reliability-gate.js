#!/usr/bin/env node
'use strict';
/**
 * P1.2-B5-BK-J5 — Airbnb Pooled Snapshot Reliability Gate Validator
 *
 * Runs the J4 pooled-market pipeline, then applies the J5 reliability gate.
 * Phases 1-5 come from J4; phases 6-7 are J5-specific.
 *
 * SAFETY:
 *   BD_CALLS        = 0 (preview) | up to 3 Airbnb only (execute, early-stop may reduce to 2)
 *   DB_WRITES       = 0  always
 *   PRICING_WRITES  = 0  always
 *   CHANNEX_CALLS   = 0  always
 *   BD API key never printed to stdout
 *   PRODUCTION_ROUTING_UNCHANGED
 *   PRODUCTION_NOT_ACTIVATED
 *
 * CLI:
 *   node outils/validate-airbnb-pooled-reliability-gate.js --name "M6"
 *   node outils/validate-airbnb-pooled-reliability-gate.js --name "M6" --execute
 *   node outils/validate-airbnb-pooled-reliability-gate.js --name "M6" --execute --check-in 2026-11-01 --check-out 2026-11-04
 */

require('dotenv').config();
const { Pool } = require('pg');
const {
  executeMode:  j4Execute,
  previewMode:  j4Preview,
} = require('./validate-airbnb-pooled-snapshot-market');
const { computePooledReliabilityGate } = require('../services/airbnb-pooled-reliability-gate');

// ── Print helpers ─────────────────────────────────────────────────────────────

function banner(phase, title) {
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`  PHASE ${phase}: ${title}`);
  console.log('═'.repeat(72));
}

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 66 - title.length))}`);
}

// ── previewMode ───────────────────────────────────────────────────────────────

async function previewMode(opts) {
  return j4Preview(opts);
}

// ── executeMode ───────────────────────────────────────────────────────────────

async function executeMode(opts = {}) {
  // Phases 1-5: J4 pipeline (prints its own banners + "J4 VALIDATION COMPLETE")
  const j4Result = await j4Execute(opts);
  const { pooled, actualBdCalls, earlyStopTriggered } = j4Result;

  // ── PHASE 6: Reliability Gate ───────────────────────────────────────────────
  banner(6, 'RELIABILITY GATE');

  const gate = computePooledReliabilityGate(pooled);

  console.log(`  ABC_LOCAL_COUNT:               ${gate.ABC_LOCAL_COUNT}`);
  console.log(`  ABC_SELECTED_RADIUS:           ${gate.ABC_SELECTED_RADIUS ?? 'N/A'} km`);
  const iqrStr = gate.ABC_IQR_PCT != null ? gate.ABC_IQR_PCT.toFixed(2) + '%' : 'N/A';
  console.log(`  ABC_IQR_PCT:                   ${iqrStr}`);
  console.log(`  USABLE_SNAPSHOTS:              ${gate.usableSnapshotCount}`);
  const repVar = gate.REPEATED_LISTING_PRICE_MAX_VARIATION;
  console.log(`  REPEATED_PRICE_MAX_VARIATION:  ${repVar != null ? repVar.toFixed(2) + '%' : 'N/A'}`);

  if (Object.keys(gate.subsets || {}).length > 0) {
    section('Subset reliability');
    for (const [key, ev] of Object.entries(gate.subsets)) {
      const geoStr = Object.entries(ev.geoStatuses).map(([l, s]) => `${l}=${s}`).join(', ');
      const detStr = ev.subsetReliable
        ? `dev=${ev.deviationFromABC != null ? ev.deviationFromABC.toFixed(2) + '%' : 'N/A'}`
        : `reason=${ev.reliabilityReason}`;
      console.log(
        `  [${key}] count@radius=${ev.countAtAbcRadius}  eligible=${ev.eligibleSnapshotCount}` +
        `  reliable=${ev.subsetReliable ? 'YES' : 'NO'}  ${detStr}  (${geoStr})`
      );
    }
  }

  console.log(`\n  RELIABLE_SUBSET_COUNT:         ${gate.RELIABLE_SUBSET_COUNT}`);
  const maxDevStr = gate.RELIABLE_MAX_DEVIATION_PCT != null
    ? gate.RELIABLE_MAX_DEVIATION_PCT.toFixed(2) + '%'
    : 'N/A';
  console.log(`  RELIABLE_MAX_DEVIATION_PCT:    ${maxDevStr}`);
  if (gate.UNRELIABLE_SUBSETS.length > 0) {
    console.log(`  UNRELIABLE_SUBSETS:            ${gate.UNRELIABLE_SUBSETS.join(', ')}`);
  }

  console.log(`\n  POOLED_RELIABILITY_STATUS:     ${gate.POOLED_RELIABILITY_STATUS}`);
  if (gate.POOLED_RELIABILITY_REASONS.length > 0) {
    console.log(`  POOLED_RELIABILITY_REASONS:`);
    for (const r of gate.POOLED_RELIABILITY_REASONS) console.log(`    — ${r}`);
  } else {
    console.log(`  POOLED_RELIABILITY_REASONS:    [] (all rules passed)`);
  }

  // ── PHASE 7: Safety Check ───────────────────────────────────────────────────
  banner(7, 'SAFETY CHECK (J5)');

  const fs   = require('fs');
  const path = require('path');
  const srcGate = fs.readFileSync(
    path.join(__dirname, '../services/airbnb-pooled-reliability-gate.js'), 'utf8'
  );
  const src = fs.readFileSync(__filename, 'utf8');

  // Forbidden patterns as runtime-constructed strings — source never contains
  // the literal contiguous substring, preventing self-match false positives.
  const P = {
    sqlWrite:   ['INS', 'ERT '].join(''),
    newPool:    ['new', ' Pool('].join(''),
    chxRqRel:   ["require", "('./chann"].join(''),
    chxRqUp:    ["require", "('../chann"].join(''),
    pricingRel: ["require", "('./pricing-apply"].join(''),
    pricingUp:  ["require", "('../pricing-apply"].join(''),
    bdKey:      ['BRIGHT', 'DATA_API_KEY'].join(''),
  };

  function noChannex(s) { return !s.includes(P.chxRqRel) && !s.includes(P.chxRqUp); }
  function noPricing(s) { return !s.includes(P.pricingRel) && !s.includes(P.pricingUp); }

  const checks = [
    { label: 'gate module: no SQL write',         ok: !srcGate.includes(P.sqlWrite) },
    { label: 'gate module: no pool construction', ok: !srcGate.includes(P.newPool) },
    { label: 'gate module: no channex import',    ok: noChannex(srcGate) },
    { label: 'gate module: no pricing-apply',     ok: noPricing(srcGate) },
    { label: 'validator: no DB write',            ok: !src.includes(P.sqlWrite) },
    { label: 'validator: no channex import',      ok: noChannex(src) },
    { label: 'validator: BD key not logged',      ok: !src.includes(P.bdKey) },
  ];

  let allOk = true;
  for (const { label, ok } of checks) {
    if (!ok) allOk = false;
    console.log(`  [${ok ? 'OK' : 'FAIL'}] ${label}`);
  }
  if (!allOk) console.log('\n  ⚠️  One or more safety checks FAILED — review above');

  console.log('\n' + '═'.repeat(72));
  console.log('  J5 VALIDATION COMPLETE');
  console.log(`  MAX_BD_CALLS: 3 | ACTUAL_BD_CALLS: ${actualBdCalls} | EARLY_STOP: ${earlyStopTriggered}`);
  console.log('  DB_WRITES: 0 | PRICING_WRITES: 0 | CHANNEX_CALLS: 0');
  console.log('  PRODUCTION_NOT_ACTIVATED');
  console.log('═'.repeat(72) + '\n');

  return { j4Result, gate };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args     = process.argv.slice(2);
  const nameIdx  = args.indexOf('--name');
  const name     = nameIdx !== -1 ? args[nameIdx + 1] : null;
  const execute  = args.includes('--execute');
  const ciIdx    = args.indexOf('--check-in');
  const coIdx    = args.indexOf('--check-out');
  const checkIn  = ciIdx !== -1 ? args[ciIdx + 1] : undefined;
  const checkOut = coIdx !== -1 ? args[coIdx + 1] : undefined;

  if (!name) {
    console.error('Usage: node outils/validate-airbnb-pooled-reliability-gate.js --name <nom> [--execute] [--check-in YYYY-MM-DD --check-out YYYY-MM-DD]');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const opts    = { name, pool, _checkIn: checkIn, _checkOut: checkOut };
  const runMode = execute ? executeMode(opts) : previewMode(opts);

  runMode
    .then(() => pool.end().catch(() => {}))
    .catch(err => {
      const msg  = (err.message || '').toLowerCase();
      const code = (err.code   || '').toUpperCase();
      let errType = 'FATAL_ERROR';
      if (msg.includes('self-signed') || msg.includes('certificate') || code.includes('SSL')) errType = 'DB_TLS_ERROR';
      else if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') errType = 'DB_CONNECTION_ERROR';
      else if (msg.includes('brightdata') || msg.includes('airbnb')) errType = 'BRIGHTDATA_ERROR';
      console.error(`\n  ❌ ${errType}: ${err.message}`);
      pool.end().catch(() => {});
      process.exit(1);
    });
}

module.exports = { previewMode, executeMode };
