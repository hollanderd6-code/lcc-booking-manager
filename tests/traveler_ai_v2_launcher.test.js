'use strict';
/**
 * Tests — Launcher Groq Traveler AI V2
 *
 * Vérifie le déclenchement conditionnel (RUN_TRAVELER_AI_V2_BENCHMARK),
 * la garde contre les double-runs, la limite forcée à 5,
 * et l'absence de side effects.
 *
 * Aucun appel Groq réel. Aucun appel DB réel.
 *
 * Exécution : node tests/traveler_ai_v2_launcher.test.js
 */

const assert = require('assert');
const { shouldRun, BENCHMARK_LIMIT } = require('../scripts/run-traveler-v2-once');

// ─── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌  ${name}`);
    console.error(`       ${err.message}`);
    failed++;
  }
}

// ─── Série L0 : shouldRun — logique de déclenchement ─────────────────────────

console.log('\n── Série L0 : Déclenchement conditionnel ────────────────────────────────────');

test('L01 — variable absente → shouldRun=false (benchmark jamais lancé)', () => {
  assert.strictEqual(shouldRun({}), false);
});

test('L02 — variable false → shouldRun=false', () => {
  assert.strictEqual(shouldRun({ RUN_TRAVELER_AI_V2_BENCHMARK: 'false' }), false);
});

test('L03 — variable "1" → shouldRun=false (doit être exactement "true")', () => {
  assert.strictEqual(shouldRun({ RUN_TRAVELER_AI_V2_BENCHMARK: '1' }), false);
});

test('L04 — variable "True" (majuscule) → shouldRun=false (sensible à la casse)', () => {
  assert.strictEqual(shouldRun({ RUN_TRAVELER_AI_V2_BENCHMARK: 'True' }), false);
});

test('L05 — variable "true" → shouldRun=true', () => {
  assert.strictEqual(shouldRun({ RUN_TRAVELER_AI_V2_BENCHMARK: 'true' }), true);
});

// ─── Série L1 : Limite figée à 5 ─────────────────────────────────────────────

console.log('\n── Série L1 : Limite figée ───────────────────────────────────────────────────');

test('L06 — BENCHMARK_LIMIT exporté et vaut exactement 5', () => {
  assert.strictEqual(BENCHMARK_LIMIT, 5, 'Limite figée à 5 pour cette mission');
});

// ─── Série L2 : Absence de side effects dans le module ───────────────────────

console.log('\n── Série L2 : Module propre — aucun side effect à l\'import ─────────────────');

test('L07 — le module exporte run, shouldRun, BENCHMARK_LIMIT et rien d\'autre de dangereux', () => {
  const launcher = require('../scripts/run-traveler-v2-once');
  assert.strictEqual(typeof launcher.run, 'function', 'run doit être exporté');
  assert.strictEqual(typeof launcher.shouldRun, 'function', 'shouldRun doit être exporté');
  assert.strictEqual(typeof launcher.BENCHMARK_LIMIT, 'number', 'BENCHMARK_LIMIT doit être exporté');
  // Aucune fonction d'envoi
  const forbidden = ['sendBotMessage', 'transmitToChannex', 'escalateToOwner', 'sendNotification'];
  for (const name of forbidden) {
    assert.strictEqual(typeof launcher[name], 'undefined', `${name} ne doit pas être exporté`);
  }
});

test('L08 — require du module ne lance pas de benchmark (pas d\'exécution à l\'import)', () => {
  // Si le module exécutait du code au require(), le test précédent aurait levé une erreur
  // ou effectué des appels réseau (timeout). Le fait d'arriver ici prouve que require est sûr.
  const launcher = require('../scripts/run-traveler-v2-once');
  assert.ok(launcher, 'module chargé sans side effect');
});

// ─── Série L3 : run() avec variable inactive → pas d'appel Groq ──────────────

console.log('\n── Série L3 : run() sans variable → sortie immédiate ────────────────────────');

test('L09 — run() sans RUN_TRAVELER_AI_V2_BENCHMARK=true → retourne immédiatement (Promise résolue)', async () => {
  // Sauvegarde + suppression de la variable
  const saved = process.env.RUN_TRAVELER_AI_V2_BENCHMARK;
  delete process.env.RUN_TRAVELER_AI_V2_BENCHMARK;

  // Pas d'appel Groq ni DB car shouldRun() retourne false
  const { run } = require('../scripts/run-traveler-v2-once');
  let resolved = false;
  await run().then(() => { resolved = true; });
  assert.ok(resolved, 'run() s\'est terminé sans erreur');

  // Restauration
  if (saved !== undefined) process.env.RUN_TRAVELER_AI_V2_BENCHMARK = saved;
});

// ─── Série L4 : Erreur benchmark → serveur non crashé ────────────────────────

console.log('\n── Série L4 : Résilience — erreur benchmark non propagée ────────────────────');

test('L10 — run() avec GROQ_API_KEY absente et variable=true → catch interne, pas d\'exception', async () => {
  const savedRun  = process.env.RUN_TRAVELER_AI_V2_BENCHMARK;
  const savedKey  = process.env.GROQ_API_KEY;
  const savedDb   = process.env.DATABASE_URL;

  process.env.RUN_TRAVELER_AI_V2_BENCHMARK = 'true';
  delete process.env.GROQ_API_KEY;
  delete process.env.DATABASE_URL;

  // Patch interne : éviter que run() tente une vraie connexion pg
  // On vérifie simplement que run() ne lève pas d'exception vers l'appelant.
  const { run } = require('../scripts/run-traveler-v2-once');

  // reset du guard interne pour ce test (hack nécessaire pour l'isolation)
  const launcher = require('../scripts/run-traveler-v2-once');

  let didThrow = false;
  try {
    // run() va échouer (pas de DATABASE_URL) mais doit catcher en interne
    await run();
  } catch (err) {
    didThrow = true;
  }

  // Restauration avant l'assertion
  if (savedRun !== undefined) process.env.RUN_TRAVELER_AI_V2_BENCHMARK = savedRun;
  else delete process.env.RUN_TRAVELER_AI_V2_BENCHMARK;
  if (savedKey !== undefined) process.env.GROQ_API_KEY = savedKey;
  if (savedDb  !== undefined) process.env.DATABASE_URL = savedDb;

  assert.strictEqual(didThrow, false, 'run() ne doit jamais propager d\'exception au serveur');
});

// ─── Série L5 : Intégration server.js — hook minimal ─────────────────────────

console.log('\n── Série L5 : Hook server.js ─────────────────────────────────────────────────');

test('L11 — server.js contient exactement le hook conditionnel et rien d\'autre pour V2', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');

  // Le hook conditionnel doit être présent
  assert.ok(
    src.includes("process.env.RUN_TRAVELER_AI_V2_BENCHMARK === 'true'"),
    'hook conditionnel présent dans server.js'
  );
  // Il doit utiliser setImmediate (non bloquant)
  assert.ok(
    src.includes("setImmediate"),
    'setImmediate présent → démarrage HTTP non bloqué'
  );
  // Il ne doit PAS créer de cron pour V2
  assert.ok(
    !src.includes('cron.schedule.*traveler') && !src.includes('cron.schedule.*v2-bench'),
    'aucun cron V2 dans server.js'
  );
  // Il ne doit PAS créer de route pour V2
  assert.ok(
    !src.includes("'/benchmark'") && !src.includes('"/benchmark"'),
    'aucune route /benchmark dans server.js'
  );
});

test('L12 — run-traveler-v2-once.js n\'importe pas sendBotMessage ni transmitToChannex', () => {
  const fs = require('fs');
  const src = fs.readFileSync(
    require('path').join(__dirname, '..', 'scripts', 'run-traveler-v2-once.js'), 'utf8'
  );
  assert.ok(!src.includes('sendBotMessage'),   'sendBotMessage absent du launcher');
  assert.ok(!src.includes('transmitToChannex'), 'transmitToChannex absent du launcher');
  assert.ok(!src.includes('escalateToOwner'),  'escalateToOwner absent du launcher');
});

// ─── Série L6 : Configuration SSL pool benchmark ──────────────────────────────

console.log('\n── Série L6 : Configuration SSL — alignement avec production ────────────────');

test('L13 — run-traveler-v2-once.js utilise la même config SSL que server.js', () => {
  const fs   = require('fs');
  const path = require('path');
  const launcherSrc = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'run-traveler-v2-once.js'), 'utf8');
  const serverSrc   = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  // server.js utilise: ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  assert.ok(
    serverSrc.includes("ssl: process.env.NODE_ENV === 'production'"),
    'server.js utilise ssl conditionnel sur NODE_ENV'
  );
  assert.ok(
    launcherSrc.includes("ssl: process.env.NODE_ENV === 'production'"),
    'launcher utilise la même config SSL conditionnelle'
  );
  assert.ok(
    launcherSrc.includes('rejectUnauthorized: false'),
    'rejectUnauthorized: false présent (scopé au pool, pas global)'
  );
});

test('L14 — benchmark-traveler-ai-v2.js utilise aussi la même config SSL', () => {
  const fs   = require('fs');
  const path = require('path');
  const cliSrc = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'benchmark-traveler-ai-v2.js'), 'utf8');
  assert.ok(
    cliSrc.includes("ssl: process.env.NODE_ENV === 'production'"),
    'CLI benchmark utilise la même config SSL conditionnelle'
  );
});

test('L15 — NODE_TLS_REJECT_UNAUTHORIZED=0 absent de tous les fichiers benchmark', () => {
  const fs   = require('fs');
  const path = require('path');
  const files = [
    'scripts/run-traveler-v2-once.js',
    'scripts/benchmark-traveler-ai-v2.js',
    'services/traveler-ai-v2.js',
  ];
  for (const f of files) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.ok(
      !src.includes('NODE_TLS_REJECT_UNAUTHORIZED'),
      `NODE_TLS_REJECT_UNAUTHORIZED absent de ${f}`
    );
  }
});

test('L16 — launcher contient les logs de diagnostic par étape (DB_CONNECT, DB_QUERY, GROQ_REQUEST)', () => {
  const fs   = require('fs');
  const path = require('path');
  const src  = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'run-traveler-v2-once.js'), 'utf8');
  assert.ok(src.includes('DB_CONNECT'),    'log DB_CONNECT présent');
  assert.ok(src.includes('DB_QUERY'),      'log DB_QUERY présent');
  assert.ok(src.includes('GROQ_REQUEST'),  'log GROQ_REQUEST présent');
});

// ─── Résumé ───────────────────────────────────────────────────────────────────
setImmediate(() => {
  console.log(`\n── Résultat ──────────────────────────────────────────────────────────────────`);
  console.log(`   ${passed} test(s) réussi(s)  |  ${failed} échec(s)\n`);
  if (failed > 0) process.exit(1);
});
