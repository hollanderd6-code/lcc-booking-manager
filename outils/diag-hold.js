#!/usr/bin/env node
/* ============================================================
   outils/diag-hold.js
   Pourquoi un hold BHGuest n'a pas été converti au paiement
   ============================================================
   Lecture seule.

     DATABASE_URL='postgres://…' node outils/diag-hold.js 41b98cfb242f1a4d3429b3de0752f0ae
     DATABASE_URL='postgres://…' node outils/diag-hold.js            (les 10 derniers)

   L'UPDATE de conversion (server.js ~49499) exige :
       property_id = $1 AND checkin = $2 AND checkout = $3
       AND status = 'active' AND user_id = prop.owner_user_id

   Ce script compare, pour chaque hold, le user_id RÉEL du hold avec le
   user_id et le owner_user_id du logement. S'ils diffèrent, l'UPDATE ne
   peut pas matcher : le hold reste 'active', le calendrier continue
   d'afficher « Pré-réservation » à côté de la réservation payée, et
   l'app iOS dessine deux lignes.
   ============================================================ */

'use strict';
require('dotenv').config();
const { Pool } = require('pg');

const TOKEN = process.argv[2] || null;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const T = (s) => `\n\u2500\u2500 ${s} ${'\u2500'.repeat(Math.max(0, 62 - s.length))}`;

(async () => {
  /* Quelles colonnes de compte existent réellement sur properties ? */
  const { rows: cols } = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'properties' AND column_name IN ('user_id','owner_id','owner_user_id')`);
  const dispo = cols.map(c => c.column_name);
  console.log(T('COLONNES DE COMPTE SUR properties'));
  console.log('   ' + dispo.join(', '));
  const sel = ['user_id', 'owner_id', 'owner_user_id'].filter(c => dispo.includes(c))
    .map(c => `p.${c} AS p_${c}`).join(', ');

  const { rows: holds } = await pool.query(
    TOKEN
      ? `SELECT h.*, p.name AS p_name, ${sel} FROM bhguest_holds h
           LEFT JOIN properties p ON p.id = h.property_id
          WHERE h.link_token = $1`
      : `SELECT h.*, p.name AS p_name, ${sel} FROM bhguest_holds h
           LEFT JOIN properties p ON p.id = h.property_id
          ORDER BY h.created_at DESC LIMIT 10`,
    TOKEN ? [TOKEN] : []
  );

  if (!holds.length) { console.log('\n   Aucun hold trouvé.\n'); await pool.end(); return; }

  for (const h of holds) {
    console.log(T(`HOLD ${String(h.link_token).slice(0, 16)}…`));
    console.log(`   logement   : ${h.property_id} (${h.p_name || '?'})`);
    console.log(`   dates      : ${String(h.checkin).slice(0, 10)} → ${String(h.checkout).slice(0, 10)}`);
    console.log(`   statut     : ${h.status} | expire ${h.expires_at}`);
    console.log(`   créé par   : user_id = ${h.user_id}`);
    dispo.forEach(c => console.log(`   properties.${c.padEnd(14)} = ${h['p_' + c]}`));

    const cible = h.p_owner_user_id !== undefined ? h.p_owner_user_id : '(colonne absente)';
    const matche = h.user_id === cible;
    console.log(`   => l'UPDATE cherche user_id = ${cible}`);
    console.log(`      ${matche ? '\u2713 correspond' : '\u2717 NE CORRESPOND PAS au user_id du hold'}` +
      (matche ? '' : ' \u2192 conversion impossible, le hold survit'));

    /* La réservation payée existe-t-elle sur les mêmes dates ? */
    const { rows: res } = await pool.query(
      `SELECT uid, source, status, guest_name,
              to_char(start_date,'YYYY-MM-DD') AS s, to_char(end_date,'YYYY-MM-DD') AS e
         FROM reservations
        WHERE property_id = $1 AND status != 'cancelled'
          AND end_date > $2::date AND start_date < $3::date
        ORDER BY created_at DESC LIMIT 5`,
      [h.property_id, h.checkin, h.checkout]);
    console.log(`   réservations sur ces dates :`);
    res.forEach(r => console.log(`      ${r.s}→${r.e} | ${r.source || '?'} | ${r.status} | ${r.guest_name || ''} | ${r.uid}`));
    if (!res.length) console.log('      aucune — le voyageur n\'a pas (encore) payé');
    const payee = res.find(r => r.source === 'guest_app');
    if (payee && h.status === 'active') {
      console.log(`   *** La réservation payée existe ET le hold est encore 'active' :`);
      console.log(`       c'est exactement le doublon affiché au calendrier et sur iOS. ***`);
    }
  }
  console.log('');
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
