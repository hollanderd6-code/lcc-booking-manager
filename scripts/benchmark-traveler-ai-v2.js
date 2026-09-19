#!/usr/bin/env node
'use strict';
/**
 * Benchmark CLI — Groq Traveler AI V2 (Shadow Mode)
 *
 * Usage :
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
  formatBenchmarkReport,
} = require('../services/traveler-ai-v2');

// ─── Parse args ──────────────────────────────────────────────────────────────

const args  = process.argv.slice(2);
let limit   = 5;
let model   = process.env.GROQ_MODEL_V2 || 'llama-3.3-70b-versatile';

for (let i = 0; i < args.length; i++) {
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
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  console.log(`\n🚀 Groq Traveler AI V2 — Shadow Mode Benchmark`);
  console.log(`   limit=${limit}  model=${model}`);
  console.log(`   DATABASE: ${(process.env.DATABASE_URL || '').replace(/:\/\/[^@]+@/, '://***@')}`);
  console.log(`   GROQ_API_KEY: ${process.env.GROQ_API_KEY ? '✓' : '✗'}`);
  console.log('');

  let results;
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

  await pool.end();

  // ─── Sérialisation ────────────────────────────────────────────────────────
  const ts     = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(resultsDir, `run-${ts}.json`);
  const txtPath  = path.join(resultsDir, `run-${ts}.txt`);

  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n📄 Résultats JSON : ${jsonPath}`);

  const report = formatBenchmarkReport(results);
  fs.writeFileSync(txtPath, report, 'utf8');
  console.log(`📄 Rapport texte : ${txtPath}`);

  // Affichage condensé dans le terminal
  console.log('\n' + '═'.repeat(72));
  for (const r of results) {
    const status = r.error ? '❌' : '✅';
    const action = r.decision?.action || 'ERROR';
    const conf   = r.decision ? r.decision.confidence.toFixed(2) : '—';
    const risk   = r.decision?.hallucination_risk || '—';
    const ms     = r.latency_ms ? `${r.latency_ms}ms` : '—';
    console.log(`${status} ${r.case_id} | ${action} conf=${conf} risk=${risk} ${ms}`);
    if (r.error) console.log(`   ↳ ${r.error}`);
  }
  console.log('═'.repeat(72));

  const ok  = results.filter(r => !r.error).length;
  const err = results.filter(r => r.error).length;
  console.log(`\n✅ ${ok} OK  ❌ ${err} erreur(s)  — benchmark terminé\n`);
}

main().catch(err => {
  console.error('❌ Fatal:', err);
  process.exit(1);
});
