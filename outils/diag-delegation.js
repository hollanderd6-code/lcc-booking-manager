#!/usr/bin/env node
/* ============================================================
   outils/diag-delegation.js
   Où vivent les modèles, et quelle délégation les relie (ou pas)
   ============================================================
   Lecture seule. N'envoie rien, n'écrit rien.

     DATABASE_URL='postgres://…' node outils/diag-delegation.js

   Suite de diag-arrivee.js, qui a montré :
     « Arrivée » (tpl 18) appartient a u_mmj5c6hq (agence)
     la conversation appartient a u_mt2nuw9l (Loth Teto)
     comptesDuTemplate n'a lu qu'UN compte -> aucune delegation acceptee

   Ce script repond a trois questions :
     1. Quelles lignes account_delegations existent entre ces comptes,
        et dans quel etat ? (pending / accepted / revoked, delegate_user_id
        rempli ou NULL)
     2. Sur quel compte vit chacun des modeles du parc — pour confirmer que
        ceux qui partent vivent chez le proprietaire, pas chez l'agence.
     3. Quelle est la vraie structure de deposits, et l'etat reel de la
        caution de la reservation block_1789410360940 (la requete
        precedente a plante sur une colonne inexistante).
   ============================================================ */

'use strict';
require('dotenv').config();
const { Pool } = require('pg');

const AGENCE = process.env.AGENCE || 'u_mmj5c6hq';
const CLIENT = process.env.CLIENT || 'u_mt2nuw9l';
const UID    = process.env.UID    || 'block_1789410360940';
const CONV   = Number(process.env.CONV || 1451);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const T = (s) => `\n\u2500\u2500 ${s} ${'\u2500'.repeat(Math.max(0, 62 - s.length))}`;

async function q(sql, params) {
  try { return (await pool.query(sql, params)).rows; }
  catch (e) { console.log(`   (requête impossible : ${e.code || ''} ${e.message})`); return []; }
}

(async () => {
  /* ── 1. Les délégations ───────────────────────────────────────── */
  console.log(T('DÉLÉGATIONS TOUCHANT CES DEUX COMPTES'));
  const dels = await q(
    `SELECT id, delegator_user_id, delegate_user_id, delegate_email, status,
            invited_at, accepted_at, revoked_at
       FROM account_delegations
      WHERE delegator_user_id IN ($1, $2) OR delegate_user_id IN ($1, $2)
      ORDER BY id`, [AGENCE, CLIENT]);
  if (!dels.length) console.log('   AUCUNE ligne. Le compte agence n\'a aucune délégation en base.');
  dels.forEach(d => console.log(
    `   #${d.id} | délégant ${d.delegator_user_id} -> délégué ${d.delegate_user_id || 'NULL (invitation non acceptée)'}` +
    `\n        email ${d.delegate_email} | status ${d.status} | accepté ${d.accepted_at || '-'} | révoqué ${d.revoked_at || '-'}`));

  const bonne = dels.find(d => d.delegator_user_id === CLIENT && d.delegate_user_id === AGENCE && d.status === 'accepted');
  console.log(`\n   => Lien exploitable par le cron (${CLIENT} -> ${AGENCE}, accepted) : ${bonne ? 'OUI #' + bonne.id : 'NON'}`);
  if (!bonne) {
    const proche = dels.find(d => d.delegator_user_id === CLIENT);
    if (proche) console.log(`      Ligne la plus proche : #${proche.id}, status « ${proche.status} », delegate_user_id ${proche.delegate_user_id || 'NULL'}`);
  }

  /* ── 2. Les comptes des utilisateurs concernés ────────────────── */
  console.log(T('COMPTES'));
  const users = await q(`SELECT id, email, name FROM users WHERE id IN ($1, $2)`, [AGENCE, CLIENT]);
  users.forEach(u => console.log(`   ${u.id} | ${u.email} | ${u.name || ''}`));

  /* ── 3. Où vivent les modèles ─────────────────────────────────── */
  console.log(T('PROPRIÉTAIRE DE CHAQUE MODÈLE'));
  const tmpls = await q(
    `SELECT id, user_id, title, trigger_type, active, send_condition
       FROM message_templates
      WHERE user_id IN ($1, $2) OR id IN (13, 18, 34)
      ORDER BY user_id, id`, [AGENCE, CLIENT]);
  tmpls.forEach(t => console.log(
    `   tpl ${String(t.id).padStart(3)} | compte ${t.user_id}${t.user_id === AGENCE ? ' (AGENCE)' : t.user_id === CLIENT ? ' (client)' : ''}` +
    ` | ${t.trigger_type.padEnd(16)} | actif ${t.active ? '✓' : '✗'} | « ${t.title} »`));
  const surAgence = tmpls.filter(t => t.user_id === AGENCE).length;
  const surClient = tmpls.filter(t => t.user_id === CLIENT).length;
  console.log(`\n   => ${surAgence} modèle(s) sur le compte agence, ${surClient} sur le compte client.`);
  console.log('      Si les modèles qui PARTENT sont ceux du client et le muet celui de');
  console.log('      l\'agence, la cause est bien la délégation manquante — pas le cron.');

  /* ── 4. La vraie table deposits ───────────────────────────────── */
  console.log(T('STRUCTURE RÉELLE DE deposits'));
  const cols = await q(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'deposits' ORDER BY ordinal_position`);
  console.log('   ' + cols.map(c => c.column_name).join(', '));

  console.log(T('CAUTION DE CETTE RÉSERVATION'));
  const dep = await q(`SELECT * FROM deposits WHERE reservation_uid = $1 ORDER BY id DESC`, [UID]);
  if (!dep.length) {
    console.log(`   aucune ligne pour reservation_uid = ${UID}`);
    /* Peut-être rattachée autrement : on cherche large sur la conversation. */
    const alt = await q(
      `SELECT * FROM deposits
        WHERE reservation_uid IN (SELECT uid FROM reservations WHERE channex_booking_id =
              (SELECT channex_booking_id FROM conversations WHERE id = $1))
        ORDER BY id DESC LIMIT 5`, [CONV]);
    alt.forEach(d => console.log('   (via channex_booking_id) ' + JSON.stringify(d)));
    if (!alt.length) console.log('   aucune ligne non plus via le channex_booking_id de la conversation');
  }
  dep.forEach(d => console.log('   ' + JSON.stringify(d, null, 0)));

  /* ── 5. Les réservations de cette conversation ────────────────── */
  console.log(T('RÉSERVATIONS RATTACHÉES'));
  const res = await q(
    `SELECT uid, property_id, channex_booking_id, start_date, status, guest_name, guest_country
       FROM reservations
      WHERE channex_booking_id = (SELECT channex_booking_id FROM conversations WHERE id = $1)
         OR uid = $2`, [CONV, UID]);
  res.forEach(r => console.log(`   uid ${r.uid} | ${r.property_id} | channex ${r.channex_booking_id || '-'} | ${String(r.start_date).slice(0,15)} | ${r.status} | ${r.guest_name} | ${r.guest_country || '-'}`));
  console.log('\n   Note : uid « block_… » = réservation issue d\'un blocage, pas d\'un booking.');
  console.log('   Si la caution est enregistrée sous un AUTRE uid que celui-ci, la garde');
  console.log('   caution la cherchera au mauvais endroit et bloquera une caution payée.\n');

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
