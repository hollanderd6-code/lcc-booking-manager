'use strict';
/**
 * Launcher ponctuel — Groq Traveler AI V2 Benchmark
 *
 * Ce module N'EXÉCUTE RIEN à l'import : il exporte uniquement run().
 * Déclenchement uniquement si RUN_TRAVELER_AI_V2_BENCHMARK === 'true'.
 *
 * Usage depuis server.js :
 *   if (process.env.RUN_TRAVELER_AI_V2_BENCHMARK === 'true') {
 *     setImmediate(() => require('./scripts/run-traveler-v2-once').run().catch(...));
 *   }
 *
 * Usage CLI direct :
 *   RUN_TRAVELER_AI_V2_BENCHMARK=true node scripts/run-traveler-v2-once.js
 *
 * Contraintes :
 *   - Limite forcée à 5 (non configurable depuis ce launcher)
 *   - Aucun side effect : DB read-only, aucun message envoyé
 *   - Garde process-local contre double exécution
 *   - N'arrête JAMAIS le serveur en cas d'erreur
 */

const { runTravelerBenchmark, formatBenchmarkReport } = require('../services/traveler-ai-v2');

const BENCHMARK_LIMIT = 5;  // figé pour cette mission

// Garde process-local : empêche une double exécution dans le même process
// (ex: Render qui appellerait listen() deux fois, ou require() en cache avec run() rappelé).
let _running = false;

/**
 * Teste si le benchmark doit s'exécuter dans l'environnement courant.
 * Testable unitairement sans importer server.js.
 */
function shouldRun(env) {
  const e = env || process.env;
  return e.RUN_TRAVELER_AI_V2_BENCHMARK === 'true';
}

/**
 * Lance le benchmark. Ne lève jamais d'exception vers l'appelant.
 * Retourne silencieusement si la variable n'est pas activée.
 */
async function run() {
  if (!shouldRun()) return;

  if (_running) {
    console.warn('⚠️ [V2-BENCH] Benchmark déjà en cours dans ce process — doublon ignoré');
    return;
  }
  _running = true;

  const model = process.env.GROQ_MODEL_V2 || 'openai/gpt-oss-120b';

  console.log('');
  console.log('=== TRAVELER AI V2 BENCHMARK START ===');
  console.log(`MODEL USED = ${model}`);
  console.log(`LIMIT      = ${BENCHMARK_LIMIT}`);
  console.log('');

  let pool = null;
  try {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: process.env.DATABASE_URL });

    const results = await runTravelerBenchmark(pool, {
      limit:   BENCHMARK_LIMIT,
      model,
      apiKey:  process.env.GROQ_API_KEY,
      baseUrl: process.env.APP_URL || 'https://www.boostinghost.fr',
    });

    const report = formatBenchmarkReport(results);
    console.log('\n' + report);

  } catch (err) {
    // Ne jamais propager l'erreur vers le serveur
    console.error('❌ [V2-BENCH] Erreur benchmark (non bloquante):', err.message);
  } finally {
    if (pool) await pool.end().catch(() => {});
    console.log('');
    console.log('=== TRAVELER AI V2 BENCHMARK END ===');
    console.log('');
    _running = false;
  }
}

module.exports = { run, shouldRun, BENCHMARK_LIMIT };

// ─── Exécution directe si le fichier est lancé comme script ─────────────────
// (ne s'active pas via require() — uniquement via `node scripts/run-traveler-v2-once.js`)
if (require.main === module) {
  run().catch(err => {
    console.error('❌ [V2-BENCH] Fatal:', err.message);
    process.exit(1);
  });
}
