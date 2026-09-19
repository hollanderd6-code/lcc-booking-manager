#!/usr/bin/env node
/* ============================================================
   outils/hold-rattrapage.js
   Clore les holds restés « active » alors que le séjour est payé
   ============================================================
     DATABASE_URL='postgres://…' node outils/hold-rattrapage.js --essai
     DATABASE_URL='postgres://…' node outils/hold-rattrapage.js

   Suite de hold-conversion-compte.js : le code ne laissera plus de hold
   ouvert après paiement, mais ceux déjà en base le restent jusqu'à leur
   expiration. Ce script les ferme, et uniquement eux : un hold n'est
   converti que s'il existe une réservation payée (source 'guest_app',
   non annulée) sur le MÊME logement aux MÊMES dates.

   Les holds sans réservation correspondante ne sont pas touchés : ils
   tiennent peut-être encore des nuits pour un voyageur en train de
   payer. Le cron d'expiration s'en chargera comme d'habitude.
   ============================================================ */

'use strict';
require('dotenv').config();
const { Pool } = require('pg');

const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const CIBLES = `
  SELECT h.id, h.link_token, h.property_id, h.user_id, h.status,
         to_char(h.checkin,'YYYY-MM-DD')  AS checkin,
         to_char(h.checkout,'YYYY-MM-DD') AS checkout,
         r.uid AS resa_uid, r.guest_name
    FROM bhguest_holds h
    JOIN reservations r
      ON r.property_id = h.property_id
     AND r.source = 'guest_app'
     AND r.status <> 'cancelled'
     AND r.start_date::date = h.checkin::date
     AND r.end_date::date   = h.checkout::date
   WHERE h.status = 'active'
   ORDER BY h.created_at DESC`;

(async () => {
  const { rows } = await pool.query(CIBLES);

  console.log(`\n\u2500\u2500 HOLDS À CLORE (${rows.length}) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
  rows.forEach(h => console.log(
    `   ${h.property_id} | ${h.checkin} \u2192 ${h.checkout} | hold ${String(h.link_token).slice(0, 12)}\u2026` +
    ` | payé par ${h.guest_name || '?'} (${h.resa_uid})`));
  if (!rows.length) { console.log('   aucun — rien à rattraper.\n'); await pool.end(); return; }

  /* Les pré-réservations affichées au calendrier portent l'uid HOLD_<token> :
     le code les supprime à la conversion, on fait pareil ici. */
  const tokens = rows.map(h => 'HOLD_' + h.link_token);

  if (ESSAI) {
    console.log(`\n   ESSAI — aucune écriture. ${rows.length} hold(s) passeraient en 'converted',`);
    console.log(`   et ${tokens.length} réservation(s) HOLD_… seraient supprimée(s).\n`);
    await pool.end(); return;
  }

  /* id est du TEXTE dans bhguest_holds — on cible par link_token, qui est
     indexé et unique, plutôt que de caster un identifiant au type incertain. */
  const up = await pool.query(
    `UPDATE bhguest_holds SET status = 'converted' WHERE link_token = ANY($1::text[])`,
    [rows.map(h => h.link_token)]);
  const del = await pool.query(`DELETE FROM reservations WHERE uid = ANY($1::text[])`, [tokens]);

  console.log(`\n   ${up.rowCount} hold(s) clos, ${del.rowCount} pré-réservation(s) supprimée(s).`);
  console.log('   Rechargez le calendrier : la double ligne doit avoir disparu.\n');
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
