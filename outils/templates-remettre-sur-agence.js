#!/usr/bin/env node
/* ============================================================
   outils/templates-remettre-sur-agence.js
   Remettre les modèles sur le compte qui peut réellement les envoyer
   ============================================================
     DATABASE_URL='postgres://…' node outils/templates-remettre-sur-agence.js --essai
     DATABASE_URL='postgres://…' node outils/templates-remettre-sur-agence.js

   ── CE QUI A ÉTÉ CONSTATÉ ────────────────────────────────────────
   Le compte qui gère réellement les autres est u_mmtl7m45
   (charles.induni@gmail.com). C'est lui qui est DÉLÉGUÉ :

       #11  u_mmj5c6hq  -> u_mmtl7m45   accepted
       #13  u_mt2nuw9l  -> u_mmtl7m45   accepted

   Les 15 modèles « Arrivée … » sont enregistrés sur u_mmj5c6hq, qui
   n'est pas délégué mais délégant. comptesDuTemplate(u_mmj5c6hq) ne
   renvoie que lui-même : ces modèles ne peuvent atteindre aucune
   conversation de u_mt2nuw9l. Le cron a raison de refuser — lire la
   délégation dans l'autre sens ferait partir les messages d'un client
   chez les voyageurs d'un autre.

   La chaîne u_mmj5c6hq -> u_mmtl7m45 -> u_mt2nuw9l n'est pas suivie non
   plus, volontairement : une délégation n'est pas transitive.

   ── CE QUE FAIT CE SCRIPT ────────────────────────────────────────
   Il change le user_id des modèles visés, de u_mmj5c6hq vers
   u_mmtl7m45. Rien d'autre : titre, message, ciblage, conditions,
   état actif — tout est conservé à l'identique.

   Pourquoi c'est sans perte de couverture : u_mmtl7m45 gère AUSSI
   u_mmj5c6hq (#11 accepted). Un modèle déplacé continue donc d'atteindre
   les logements de u_mmj5c6hq, et gagne ceux de u_mt2nuw9l.

   ── GARDE-FOU ────────────────────────────────────────────────────
   Un modèle SANS ciblage (« tous les logements ») change de portée en
   changeant de compte : il couvrirait d'un coup tout le parc géré. Ces
   modèles-là ne sont PAS déplacés sans --inclure-globaux, et sont
   listés à part.

   ── CE QUE CE SCRIPT NE FAIT PAS ─────────────────────────────────
   Il ne renvoie aucun message en retard. Lucile Mouton arrive
   aujourd'hui : son message d'arrivée doit partir à la main depuis la
   conversation. Le cron reprend pour les arrivées suivantes.
   ============================================================ */

'use strict';
require('dotenv').config();
const { Pool } = require('pg');

const DEPUIS = process.env.DEPUIS || 'u_mmj5c6hq';   // compte où les modèles sont posés
const VERS   = process.env.VERS   || 'u_mmtl7m45';   // compte réellement délégué
const ESSAI  = process.argv.includes('--essai') || process.argv.includes('--dry');
const GLOBAUX = process.argv.includes('--inclure-globaux');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const T = (s) => `\n\u2500\u2500 ${s} ${'\u2500'.repeat(Math.max(0, 62 - s.length))}`;

function echec(m) { console.error('\n  \u2717 ' + m + "\n    Rien n'a ete ecrit.\n"); process.exit(1); }

(async () => {
  /* ── 1. Vérifier que VERS est bien un délégué accepté ─────────── */
  const { rows: del } = await pool.query(
    `SELECT delegator_user_id FROM account_delegations
      WHERE delegate_user_id = $1 AND status = 'accepted'`, [VERS]);
  const geres = del.map(d => d.delegator_user_id);

  console.log(T('VÉRIFICATION DU COMPTE CIBLE'));
  console.log(`   ${VERS} gère : ${geres.length ? geres.join(', ') : 'AUCUN compte'}`);
  if (!geres.includes(DEPUIS)) {
    echec(`${VERS} ne gère pas ${DEPUIS} : le déplacement ferait PERDRE la couverture\n` +
          `    des logements de ${DEPUIS}. Vérifiez la délégation avant de continuer.`);
  }
  console.log(`   ${DEPUIS} est bien géré par ${VERS} : aucune couverture perdue.`);

  /* ── 2. Le parc joignable après déplacement ───────────────────── */
  const { rows: parc } = await pool.query(
    `SELECT id, user_id, name FROM properties
      WHERE user_id = ANY($1::text[])`, [[VERS, ...geres]]);
  const joignables = new Set(parc.map(p => String(p.id)));

  /* ── 3. Les modèles à déplacer ────────────────────────────────── */
  const { rows: tmpls } = await pool.query(
    `SELECT id, title, trigger_type, active, property_id, property_ids
       FROM message_templates WHERE user_id = $1 ORDER BY id`, [DEPUIS]);

  const cibles = (t) => {
    let l = [];
    try { l = Array.isArray(t.property_ids) ? t.property_ids : JSON.parse(t.property_ids || '[]'); } catch (e) {}
    if (!l.length && t.property_id) l = [t.property_id];
    return l.map(String);
  };

  const aDeplacer = [], globaux = [];
  for (const t of tmpls) (cibles(t).length ? aDeplacer : globaux).push(t);

  console.log(T('MODÈLES CIBLÉS — À DÉPLACER'));
  for (const t of aDeplacer) {
    const c = cibles(t);
    const couverts = c.filter(id => joignables.has(id)).length;
    console.log(`   tpl ${String(t.id).padStart(3)} | ${t.trigger_type.padEnd(15)} | « ${t.title} »`);
    console.log(`        ${c.length} logement(s) ciblé(s) — ${couverts} joignable(s) après déplacement` +
                (couverts < c.length ? `  (${c.length - couverts} hors parc, sans effet)` : ''));
  }
  if (!aDeplacer.length) console.log('   aucun');

  console.log(T('MODÈLES GLOBAUX — NON DÉPLACÉS SANS --inclure-globaux'));
  for (const t of globaux) {
    console.log(`   tpl ${String(t.id).padStart(3)} | ${t.trigger_type.padEnd(15)} | « ${t.title} »`);
    console.log(`        « tous les logements » : passerait de ${parc.filter(p => p.user_id === DEPUIS).length}` +
                ` à ${parc.length} logements. Vérifiez que c'est voulu.`);
  }
  if (!globaux.length) console.log('   aucun');

  const ids = [...aDeplacer, ...(GLOBAUX ? globaux : [])].map(t => t.id);
  if (!ids.length) { console.log('\n  Rien à déplacer.\n'); await pool.end(); return; }

  /* ── 4. Le déplacement ────────────────────────────────────────── */
  console.log(T(ESSAI ? 'ESSAI — AUCUNE ÉCRITURE' : 'DÉPLACEMENT'));
  console.log(`   ${ids.length} modèle(s) : ${DEPUIS} -> ${VERS}`);
  console.log(`   Retour arrière :`);
  console.log(`     UPDATE message_templates SET user_id = '${DEPUIS}' WHERE id IN (${ids.join(', ')});`);

  if (!ESSAI) {
    const { rowCount } = await pool.query(
      `UPDATE message_templates SET user_id = $1, updated_at = NOW() WHERE id = ANY($2::int[])`,
      [VERS, ids]);
    console.log(`   ${rowCount} ligne(s) mise(s) à jour.`);

    const { rows: reste } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM message_templates WHERE id = ANY($1::int[]) AND user_id <> $2`,
      [ids, VERS]);
    if (reste[0].n) echec('Des modèles sont restés sur l\'ancien compte.');
    console.log('   Vérifié : tous les modèles sont sur le compte agence.');
  }

  console.log('\n   À faire ensuite :');
  console.log('     · Lucile Mouton arrive AUJOURD\'HUI — envoyez son message d\'arrivée à la main.');
  console.log('     · Demain 7h, surveillez le log : « Arrivée » → N conversation(s) sur M compte(s), N > 0.');
  console.log('     · Les délégations révoquées en double (#2 à #9) peuvent être purgées, sans urgence.\n');
  if (ESSAI) console.log('   Relancez sans --essai pour appliquer.\n');

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
