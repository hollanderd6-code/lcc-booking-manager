'use strict';
// Migration : réaligne les templates existants sur le propriétaire de leurs logements.
// Lecture seule par défaut. Usage : DATABASE_URL=… node outils/migrer-templates-proprietaire.js [--ecrire]
const { Pool } = require('pg');
const { repartirTemplateParProprietaire } = require('../utils/templates-proprietaire');
const ECRIRE = process.argv.includes('--ecrire');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM message_templates ORDER BY id');
    const toutes = [];
    for (const t of rows) {
      const r = await repartirTemplateParProprietaire(client, t, { dryRun: !ECRIRE });
      toutes.push(...r.changes);
    }
    console.table(toutes);
    console.log(`\n${toutes.length} changement(s)${ECRIRE ? ' — écrits' : ' — lecture seule, relancer avec --ecrire'}`);
    await client.query(ECRIRE ? 'COMMIT' : 'ROLLBACK');
  } catch (e) {
    await client.query('ROLLBACK'); console.error('ERREUR — rien écrit :', e.message);
  } finally { client.release(); await pool.end(); }
})();
