#!/usr/bin/env node
/* ============================================================
   outils/tunnel-inscriptions.js
   Ou s'arretent les inscrits pendant leurs 14 jours d'essai
   ============================================================
   LECTURE SEULE. Aucune ecriture, ni en base, ni ailleurs.

   ── POURQUOI CE SCRIPT ──────────────────────────────────────────
   Des gens s'inscrivent, disposent de 14 jours, et ne prennent pas
   d'abonnement. Personne ne sait ou ils s'arretent : aucun contact
   n'a ete pris avec eux, et le produit ne mesure rien.

   Ce script reconstitue le tunnel a partir des donnees existantes.
   Il ne devine rien : il compte.

   ── CE QU'IL MESURE ─────────────────────────────────────────────
   Sur la cohorte des inscrits dont l'essai est TERMINE (inscription
   remontant a plus de 14 jours — les autres sont encore en cours et
   fausseraient le taux) :

     1. inscrits
     2. ont cree au moins un logement
     3. ont connecte au moins une plateforme
     4. ont au moins une reservation
     5. ont au moins une conversation
     6. ont un abonnement payant

   Puis, pour chacun, LA DERNIERE ETAPE ATTEINTE — c'est la que se lit
   le decrochage. Un tunnel dit combien restent ; la derniere etape dit
   ou ils s'arretent, ce qui n'est pas la meme chose.

   Il mesure aussi les DELAIS : combien de jours entre l'inscription et
   le premier logement, entre le premier logement et la premiere
   connexion. Si ces delais approchent 14 jours, l'essai est trop court
   pour que le produit ait pu servir — et aucune correction d'interface
   n'y changera rien.

   ── PRUDENCE ────────────────────────────────────────────────────
   Le script inspecte information_schema avant chaque requete : une
   table ou une colonne absente est signalee, pas devinee. Mieux vaut
   un trou annonce qu'un chiffre invente.

   ── AVANT DE LANCER ─────────────────────────────────────────────
   DATABASE_URL doit etre disponible. Depuis Render > votre service >
   Environment, copiez la valeur, puis :

     DATABASE_URL='postgres://…' node outils/tunnel-inscriptions.js

   Rien n'est ecrit sur disque, la chaine n'est pas enregistree.
   ============================================================ */

const URL = process.env.DATABASE_URL;
if (!URL) {
  console.error('\n  \u2717 DATABASE_URL absente.');
  console.error("    Copiez-la depuis Render > Environment, puis :");
  console.error("    DATABASE_URL='postgres://…' node outils/tunnel-inscriptions.js\n");
  process.exit(1);
}

let Pool;
try { Pool = require('pg').Pool; }
catch (e) {
  console.error('\n  \u2717 Le module pg est introuvable. Lancez depuis la racine du projet.\n');
  process.exit(1);
}

const pool = new Pool({
  connectionString: URL,
  max: 2,
  ssl: /render\.com|amazonaws|neon|supabase/.test(URL) ? { rejectUnauthorized: false } : undefined
});

const JOURS_ESSAI = 14;

/* Ce qui existe reellement en base : on ne suppose rien. */
async function colonnes(table) {
  const r = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [table]
  ).catch(() => ({ rows: [] }));
  return r.rows.map(x => x.column_name);
}

function pct(n, total) {
  if (!total) return '   —';
  return String(Math.round((n / total) * 100)).padStart(3, ' ') + '%';
}

function barre(n, total) {
  if (!total) return '';
  const l = Math.round((n / total) * 40);
  return '\u2588'.repeat(l) + '\u2591'.repeat(40 - l);
}

(async () => {
  console.log('\n  Lecture de la base…');

  const colUsers = await colonnes('users');
  if (!colUsers.length) {
    console.error('\n  \u2717 La table users est introuvable. Mauvaise base ?\n');
    await pool.end(); process.exit(1);
  }
  const colProps = await colonnes('properties');
  const colSubs = await colonnes('subscriptions');
  const colResa = await colonnes('reservations');
  const colConv = await colonnes('conversations');

  const manque = [];
  if (!colUsers.includes('created_at')) manque.push('users.created_at');
  if (!colProps.length) manque.push('table properties');
  if (!colSubs.length) manque.push('table subscriptions');
  if (manque.length) {
    console.error('\n  \u2717 Introuvable : ' + manque.join(', '));
    console.error('    Le tunnel ne peut pas etre reconstitue sans cela.\n');
    await pool.end(); process.exit(1);
  }

  const aChannex = colProps.includes('channex_enabled');
  const aResa = colResa.length > 0 && colResa.includes('property_id');
  const aConv = colConv.length > 0 && colConv.includes('user_id');
  const colProprio = colProps.includes('user_id') ? 'user_id' : null;
  if (!colProprio) {
    console.error('\n  \u2717 properties.user_id est introuvable.\n');
    await pool.end(); process.exit(1);
  }

  /* La cohorte : essai termine. Ceux inscrits il y a moins de 14 jours
     sont encore en cours et abaisseraient artificiellement le taux. */
  const coh = await pool.query(
    `SELECT COUNT(*)::int AS n FROM users WHERE created_at < NOW() - INTERVAL '${JOURS_ESSAI} days'`
  );
  const total = coh.rows[0].n;

  const enCours = await pool.query(
    `SELECT COUNT(*)::int AS n FROM users WHERE created_at >= NOW() - INTERVAL '${JOURS_ESSAI} days'`
  );

  console.log('');
  console.log('  ══════════════════════════════════════════════════════════');
  console.log('   TUNNEL D\'INSCRIPTION — essais termines');
  console.log('  ══════════════════════════════════════════════════════════');
  console.log('   Cohorte : ' + total + ' comptes inscrits il y a plus de ' + JOURS_ESSAI + ' jours');
  console.log('   (' + enCours.rows[0].n + ' encore en essai, exclus du calcul)');
  console.log('');

  if (!total) {
    console.log('   Aucun essai termine : rien a mesurer pour l\'instant.\n');
    await pool.end(); return;
  }

  /* Chaque etape est comptee independamment, sur la meme cohorte. */
  const etapes = [];
  const q = async (label, sql) => {
    try {
      const r = await pool.query(sql);
      etapes.push([label, r.rows[0].n]);
    } catch (e) {
      etapes.push([label, null]);
      console.warn('   (' + label + ' : illisible — ' + e.message + ')');
    }
  };

  const COHORTE = `SELECT id FROM users WHERE created_at < NOW() - INTERVAL '${JOURS_ESSAI} days'`;

  await q('Inscrits', `SELECT COUNT(*)::int AS n FROM (${COHORTE}) c`);
  await q('Ont cree un logement',
    `SELECT COUNT(DISTINCT c.id)::int AS n FROM (${COHORTE}) c
       JOIN properties p ON p.${colProprio} = c.id`);
  if (aChannex) {
    await q('Ont connecte une plateforme',
      `SELECT COUNT(DISTINCT c.id)::int AS n FROM (${COHORTE}) c
         JOIN properties p ON p.${colProprio} = c.id
        WHERE p.channex_enabled = TRUE`);
  }
  if (aResa) {
    await q('Ont une reservation',
      `SELECT COUNT(DISTINCT c.id)::int AS n FROM (${COHORTE}) c
         JOIN properties p ON p.${colProprio} = c.id
         JOIN reservations r ON r.property_id = p.id`);
  }
  if (aConv) {
    await q('Ont une conversation',
      `SELECT COUNT(DISTINCT c.id)::int AS n FROM (${COHORTE}) c
         JOIN conversations v ON v.user_id = c.id`);
  }

  /* Abonnement payant : ni essai, ni annule. */
  const colPlan = colSubs.includes('plan_type') ? 'plan_type' : null;
  await q('Ont un abonnement payant',
    `SELECT COUNT(DISTINCT c.id)::int AS n FROM (${COHORTE}) c
       JOIN subscriptions s ON s.user_id = c.id
      WHERE s.status IN ('active','past_due')
        ${colPlan ? "AND COALESCE(s." + colPlan + ", '') NOT ILIKE '%trial%'" : ''}`);

  for (const [label, n] of etapes) {
    if (n === null) { console.log('   ' + label.padEnd(30) + '   illisible'); continue; }
    console.log('   ' + label.padEnd(30) + String(n).padStart(5) + '  ' + pct(n, total) + '  ' + barre(n, total));
  }

  /* ── La derniere etape atteinte : c'est la que se lit le decrochage ── */
  console.log('');
  console.log('  ══════════════════════════════════════════════════════════');
  console.log('   OU ILS S\'ARRETENT');
  console.log('  ══════════════════════════════════════════════════════════');
  try {
    const r = await pool.query(`
      WITH c AS (${COHORTE}),
      etat AS (
        SELECT c.id,
          EXISTS (SELECT 1 FROM properties p WHERE p.${colProprio} = c.id) AS a_logement,
          ${aChannex ? `EXISTS (SELECT 1 FROM properties p WHERE p.${colProprio} = c.id AND p.channex_enabled = TRUE)` : 'FALSE'} AS a_connecte,
          ${aResa ? `EXISTS (SELECT 1 FROM properties p JOIN reservations r ON r.property_id = p.id WHERE p.${colProprio} = c.id)` : 'FALSE'} AS a_resa,
          EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = c.id AND s.status IN ('active','past_due')) AS a_paye
        FROM c
      )
      SELECT CASE
        WHEN a_paye THEN '6. Abonne'
        WHEN a_resa THEN '5. Reservations, pas d abonnement'
        WHEN a_connecte THEN '4. Connecte, aucune reservation'
        WHEN a_logement THEN '3. Logement cree, jamais connecte'
        ELSE '2. Inscrit, rien cree'
      END AS etape, COUNT(*)::int AS n
      FROM etat GROUP BY 1 ORDER BY 1
    `);
    for (const row of r.rows) {
      console.log('   ' + row.etape.padEnd(38) + String(row.n).padStart(5) + '  ' + pct(row.n, total));
    }
  } catch (e) {
    console.warn('   (repartition illisible — ' + e.message + ')');
  }

  /* ── Les delais : l'essai est-il seulement assez long ? ── */
  console.log('');
  console.log('  ══════════════════════════════════════════════════════════');
  console.log('   DELAIS (mediane, en jours)');
  console.log('  ══════════════════════════════════════════════════════════');
  const colPropDate = colProps.includes('created_at') ? 'created_at' : null;
  if (colPropDate) {
    try {
      const r = await pool.query(`
        WITH c AS (SELECT id, created_at FROM users WHERE created_at < NOW() - INTERVAL '${JOURS_ESSAI} days'),
        prem AS (
          SELECT c.id, MIN(p.created_at) AS premier_logement,
                 ${aChannex ? 'MIN(p.created_at) FILTER (WHERE p.channex_enabled = TRUE)' : 'NULL::timestamptz'} AS premiere_connexion,
                 c.created_at AS inscription
          FROM c JOIN properties p ON p.${colProprio} = c.id GROUP BY c.id, c.created_at
        )
        SELECT
          ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (premier_logement - inscription))/86400)::numeric, 1) AS d_logement,
          ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (premiere_connexion - inscription))/86400)::numeric, 1) AS d_connexion
        FROM prem
      `);
      const d = r.rows[0] || {};
      console.log('   Inscription -> premier logement    ' + (d.d_logement == null ? '—' : d.d_logement + ' j'));
      console.log('   Inscription -> premiere connexion  ' + (d.d_connexion == null ? '—' : d.d_connexion + ' j'));
      if (d.d_connexion != null && Number(d.d_connexion) > JOURS_ESSAI * 0.5) {
        console.log('');
        console.log('   \u26a0  La moitie de l\'essai passe avant la premiere connexion.');
        console.log('      Le produit ne sert a rien tant qu\'aucune plateforme n\'est');
        console.log('      branchee : il reste donc peu de jours pour convaincre.');
      }
    } catch (e) {
      console.warn('   (delais illisibles — ' + e.message + ')');
    }
  } else {
    console.log('   properties.created_at est absent : delais non mesurables.');
  }

  /* ── Evolution : le probleme s'aggrave-t-il ou se resorbe-t-il ? ── */
  console.log('');
  console.log('  ══════════════════════════════════════════════════════════');
  console.log('   PAR MOIS D\'INSCRIPTION');
  console.log('  ══════════════════════════════════════════════════════════');
  try {
    const r = await pool.query(`
      SELECT TO_CHAR(DATE_TRUNC('month', u.created_at), 'YYYY-MM') AS mois,
             COUNT(*)::int AS inscrits,
             COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM properties p WHERE p.${colProprio} = u.id))::int AS avec_logement,
             COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status IN ('active','past_due')))::int AS abonnes
      FROM users u
      WHERE u.created_at < NOW() - INTERVAL '${JOURS_ESSAI} days'
      GROUP BY 1 ORDER BY 1 DESC LIMIT 12
    `);
    console.log('   mois      inscrits  logement  abonnes');
    for (const row of r.rows) {
      console.log('   ' + row.mois + '   ' + String(row.inscrits).padStart(7) + '   ' +
        String(row.avec_logement).padStart(7) + '   ' + String(row.abonnes).padStart(6));
    }
  } catch (e) {
    console.warn('   (evolution illisible — ' + e.message + ')');
  }

  console.log('');
  console.log('  ══════════════════════════════════════════════════════════');
  console.log('   Ce que ces chiffres ne disent pas : POURQUOI.');
  console.log('   Ils designent l\'endroit ou regarder, pas la cause. Cinq');
  console.log('   appels a des decrocheurs en apprendront plus que le reste.');
  console.log('  ══════════════════════════════════════════════════════════\n');

  await pool.end();
})().catch(async (e) => {
  console.error('\n  \u2717 ' + e.message + '\n');
  try { await pool.end(); } catch (x) {}
  process.exit(1);
});
