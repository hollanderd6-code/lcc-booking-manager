'use strict';
/**
 * Launcher ponctuel — Groq Traveler AI V2 Benchmark (Golden Set Mode)
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
 *   - MODE GOLDEN SET : 6 messages fixes, aucun random
 *   - Aucun side effect : DB read-only, aucun message envoyé
 *   - Garde process-local contre double exécution
 *   - N'arrête JAMAIS le serveur en cas d'erreur
 */

const {
  runGoldenSetBenchmark,
  formatGoldenReport,
  GOLDEN_IDS,
} = require('../services/traveler-ai-v2');

const BENCHMARK_LIMIT = 5;  // conservé pour compatibilité avec les tests launcher existants

// Garde process-local : empêche une double exécution dans le même process
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
 * Lance le benchmark golden set. Ne lève jamais d'exception vers l'appelant.
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
  console.log(`MODE       = GOLDEN_SET`);
  console.log(`CASES      = ${GOLDEN_IDS.length}`);
  console.log(`MODEL USED = ${model}`);
  console.log('');

  let pool = null;
  try {
    const { Pool } = require('pg');
    // Même config SSL que le pool principal server.js :
    // Render Postgres utilise un certificat auto-signé → rejectUnauthorized: false en prod.
    // rejectUnauthorized: false est scopé à ce pool uniquement — pas de changement TLS global.
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });

    // Diagnostic de connectivité DB avant tout appel benchmark
    console.log('[V2-BENCH] STAGE: DB_CONNECT');
    await pool.query('SELECT 1');
    console.log('[V2-BENCH] STAGE: DB_QUERY — connexion OK');

    console.log('[V2-BENCH] STAGE: GROQ_REQUEST — démarrage des cas golden set');
    const results = await runGoldenSetBenchmark(pool, {
      model,
      apiKey:  process.env.GROQ_API_KEY,
      baseUrl: process.env.APP_URL || 'https://www.boostinghost.fr',
    });

    const report = formatGoldenReport(results);
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
