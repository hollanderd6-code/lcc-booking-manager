#!/usr/bin/env node
'use strict';
/**
 * Benchmark CLI — Groq Traveler AI V2 (Shadow Mode)
 *
 * Usage :
 *   node scripts/benchmark-traveler-ai-v2.js --golden
 *   node scripts/benchmark-traveler-ai-v2.js [--limit 5] [--model llama-3.3-70b-versatile]
 *
 * Pré-requis :
 *   DATABASE_URL et GROQ_API_KEY dans .env (ou variables d'environnement).
 *
 * Résultats écrits dans benchmark-results/ (gitignored).
 * Aucun message envoyé. Aucune écriture en DB. Shadow mode total.
 */

require('dotenv').config();

const path   = require('path');
const fs     = require('fs');
const { Pool } = require('pg');
const {
  runTravelerBenchmark,
  runGoldenSetBenchmark,
  formatBenchmarkReport,
  formatGoldenReport,
  GOLDEN_IDS,
} = require('../services/traveler-ai-v2');

// ─── Parse args ──────────────────────────────────────────────────────────────

const args   = process.argv.slice(2);
let limit    = 5;
let model    = process.env.GROQ_MODEL_V2 || 'openai/gpt-oss-120b';
let golden   = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--golden') {
    golden = true;
  }
  if (args[i] === '--limit' && args[i + 1]) {
    limit = Math.max(1, Math.min(50, parseInt(args[i + 1]) || 5));
    i++;
  }
  if (args[i] === '--model' && args[i + 1]) {
    model = args[i + 1];
    i++;
  }
}

// ─── Vérifications préliminaires ─────────────────────────────────────────────

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL absent. Ajoutez-le dans .env ou en variable d\'environnement.');
  process.exit(1);
}

if (!process.env.GROQ_API_KEY) {
  console.error('❌ GROQ_API_KEY absent — benchmark annulé (shadow mode, aucun appel réel).');
  process.exit(1);
}

// ─── Répertoire de résultats ─────────────────────────────────────────────────

const resultsDir = path.join(__dirname, '..', 'benchmark-results');
if (!fs.existsSync(resultsDir)) {
  fs.mkdirSync(resultsDir, { recursive: true });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // Même config SSL que server.js production (rejectUnauthorized: false en prod).
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  let results;
  let report;
  let filePrefix;

  if (golden) {
    console.log(`\n🏅 Groq Traveler AI V2 — Golden Set Benchmark`);
    console.log(`   MODE       = GOLDEN_SET`);
    console.log(`   CASES      = ${GOLDEN_IDS.length}`);
    console.log(`   IDs        = [${GOLDEN_IDS.join(', ')}]`);
    console.log(`   model=${model}`);
    console.log(`   DATABASE: ${(process.env.DATABASE_URL || '').replace(/:\/\/[^@]+@/, '://***@')}`);
    console.log(`   GROQ_API_KEY: ${process.env.GROQ_API_KEY ? '✓' : '✗'}`);
    console.log('');

    try {
      results = await runGoldenSetBenchmark(pool, {
        model,
        apiKey:  process.env.GROQ_API_KEY,
        baseUrl: process.env.APP_URL || 'https://www.boostinghost.fr',
      });
    } catch (err) {
      console.error('❌ Erreur fatale golden benchmark:', err.message);
      await pool.end();
      process.exit(1);
    }

    report    = formatGoldenReport(results);
    filePrefix = 'golden-run';

  } else {
    console.log(`\n🚀 Groq Traveler AI V2 — Shadow Mode Benchmark`);
    console.log(`   limit=${limit}  model=${model}`);
    console.log(`   DATABASE: ${(process.env.DATABASE_URL || '').replace(/:\/\/[^@]+@/, '://***@')}`);
    console.log(`   GROQ_API_KEY: ${process.env.GROQ_API_KEY ? '✓' : '✗'}`);
    console.log('');

    try {
      results = await runTravelerBenchmark(pool, {
        limit,
        model,
        apiKey:  process.env.GROQ_API_KEY,
        baseUrl: process.env.APP_URL || 'https://www.boostinghost.fr',
      });
    } catch (err) {
      console.error('❌ Erreur fatale benchmark:', err.message);
      await pool.end();
      process.exit(1);
    }

    report    = formatBenchmarkReport(results);
    filePrefix = 'run';
  }

  await pool.end();

  // ─── Sérialisation ────────────────────────────────────────────────────────
  const ts      = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(resultsDir, `${filePrefix}-${ts}.json`);
  const txtPath  = path.join(resultsDir, `${filePrefix}-${ts}.txt`);

  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n📄 Résultats JSON : ${jsonPath}`);

  fs.writeFileSync(txtPath, report, 'utf8');
  console.log(`📄 Rapport texte : ${txtPath}`);

  // Affichage condensé dans le terminal
  console.log('\n' + '═'.repeat(72));
  for (const r of results) {
    const status = r.error ? '❌' : '✅';
    const action = r.decision?.action || (r.error?.startsWith('MISSING') ? 'MISSING' : 'ERROR');
    const conf   = r.decision ? r.decision.confidence.toFixed(2) : '—';
    const risk   = r.decision?.hallucination_risk || '—';
    const ms     = r.latency_ms ? `${r.latency_ms}ms` : '—';
    const fp     = r.context_fingerprint ? `fp=${r.context_fingerprint}` : '';
    console.log(`${status} ${r.case_id} | ${action} conf=${conf} risk=${risk} ${ms} ${fp}`);
    if (r.error) console.log(`   ↳ ${r.error}`);
  }
  console.log('═'.repeat(72));

  const ok  = results.filter(r => !r.error).length;
  const err = results.filter(r =>  r.error).length;
  const mode = golden ? 'GOLDEN SET' : 'RANDOM';
  console.log(`\n✅ ${ok} OK  ❌ ${err} erreur(s)  [${mode}] — benchmark terminé\n`);
}

main().catch(err => {
  console.error('❌ Fatal:', err);
  process.exit(1);
});
