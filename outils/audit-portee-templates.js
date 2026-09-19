#!/usr/bin/env node
/* ============================================================
   outils/audit-portee-templates.js
   Quels modèles, dans TOUT le parc, ne peuvent atteindre personne
   ============================================================
   Lecture seule. N'envoie rien, n'écrit rien.

     DATABASE_URL='postgres://…' node outils/audit-portee-templates.js

   ── CE QU'IL CHERCHE ─────────────────────────────────────────────
   Le défaut trouvé chez u_mmj5c6hq n'a rien de particulier à ce compte :
   un modèle créé en travaillant sur un autre compte s'y enregistre, et le
   cron — qui ne lit que le compte du modèle et les comptes DÉLÉGUÉS à
   celui-ci — ne trouve alors aucune conversation. L'écran affiche
   pourtant « Actif · Saint Gratien RDC ». Rien ne prévient.

   Pour chaque modèle du parc, ce script calcule :
     · les comptes que son propriétaire peut servir (lui + ses délégants)
     · les logements joignables depuis ces comptes
     · l'intersection avec son ciblage

   Trois verdicts :
     MUET       aucun logement joignable — le modèle ne partira jamais
     PARTIEL    une partie du ciblage est hors de portée
     OK         tout son ciblage est joignable

   Pour chaque modèle MUET, il indique le compte qui, lui, POURRAIT
   l'envoyer — c'est la destination du déplacement.
   ============================================================ */

'use strict';
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const T = (s) => `\n\u2500\u2500 ${s} ${'\u2500'.repeat(Math.max(0, 62 - s.length))}`;

(async () => {
  const { rows: users } = await pool.query(`SELECT id, email FROM users`);
  const emailDe = new Map(users.map(u => [u.id, u.email]));

  const { rows: dels } = await pool.query(
    `SELECT delegator_user_id, delegate_user_id FROM account_delegations
      WHERE status = 'accepted' AND delegate_user_id IS NOT NULL`);

  /* gere.get(X) = comptes que X peut servir (lui-même + ceux qui lui sont délégués) */
  const gere = new Map();
  const addGere = (a, b) => { if (!gere.has(a)) gere.set(a, new Set([a])); gere.get(a).add(b); };
  users.forEach(u => gere.set(u.id, new Set([u.id])));
  dels.forEach(d => addGere(d.delegate_user_id, d.delegator_user_id));

  const { rows: props } = await pool.query(`SELECT id, user_id, name FROM properties`);
  const propsDe = new Map();          // compte -> Set(logement)
  const ownerDe = new Map();          // logement -> compte
  props.forEach(p => {
    ownerDe.set(String(p.id), p.user_id);
    if (!propsDe.has(p.user_id)) propsDe.set(p.user_id, new Set());
    propsDe.get(p.user_id).add(String(p.id));
  });
  const nomDe = new Map(props.map(p => [String(p.id), p.name]));

  const joignables = (userId) => {
    const s = new Set();
    for (const compte of (gere.get(userId) || [userId])) {
      for (const pid of (propsDe.get(compte) || [])) s.add(pid);
    }
    return s;
  };

  const { rows: tmpls } = await pool.query(
    `SELECT id, user_id, title, trigger_type, active, property_id, property_ids
       FROM message_templates ORDER BY user_id, id`);

  const cibles = (t) => {
    let l = [];
    try { l = Array.isArray(t.property_ids) ? t.property_ids : JSON.parse(t.property_ids || '[]'); } catch (e) {}
    if (!l.length && t.property_id) l = [t.property_id];
    return l.map(String);
  };

  const muets = [], partiels = [], vides = [];
  let okCount = 0;

  for (const t of tmpls) {
    const dispo = joignables(t.user_id);
    const c = cibles(t);

    if (!c.length) {                                  // « tous les logements »
      if (dispo.size === 0) vides.push({ t, dispo });
      else okCount++;
      continue;
    }
    const couverts = c.filter(id => dispo.has(id));
    if (couverts.length === 0) muets.push({ t, c });
    else if (couverts.length < c.length) partiels.push({ t, c, couverts });
    else okCount++;
  }

  /* Qui pourrait envoyer un modèle muet : un compte dont le parc joignable
     couvre son ciblage. */
  const sauveur = (c) => {
    const candidats = [];
    for (const u of users) {
      const dispo = joignables(u.id);
      const n = c.filter(id => dispo.has(id)).length;
      if (n) candidats.push({ id: u.id, email: emailDe.get(u.id), n });
    }
    return candidats.sort((a, b) => b.n - a.n).slice(0, 2);
  };

  console.log(T('RÉSUMÉ'));
  console.log(`   ${tmpls.length} modèle(s) | ${okCount} OK | ${partiels.length} partiel(s) | ${muets.length} MUET(S) | ${vides.length} global(aux) sans parc`);

  console.log(T('MODÈLES MUETS — NE PARTIRONT JAMAIS'));
  if (!muets.length) console.log('   aucun \u2713');
  for (const { t, c } of muets) {
    console.log(`   tpl ${String(t.id).padStart(3)} | ${t.trigger_type.padEnd(15)} | actif ${t.active ? '✓' : '✗'} | « ${t.title} »`);
    console.log(`        posé sur ${t.user_id} (${emailDe.get(t.user_id) || '?'})`);
    console.log(`        vise ${c.length} logement(s) : ${c.map(id => nomDe.get(id) || id).slice(0, 4).join(', ')}${c.length > 4 ? '…' : ''}`);
    const s = sauveur(c);
    if (s.length) console.log(`        pourrait partir depuis : ${s.map(x => `${x.id} (${x.email}) — ${x.n}/${c.length}`).join('  |  ')}`);
    else console.log('        aucun compte n\'atteint ces logements : ciblage périmé (logements supprimés ?)');
  }

  console.log(T('MODÈLES PARTIELS — UNE PARTIE DU CIBLAGE EST HORS DE PORTÉE'));
  if (!partiels.length) console.log('   aucun \u2713');
  for (const { t, c, couverts } of partiels) {
    const perdus = c.filter(id => !couverts.includes(id));
    console.log(`   tpl ${String(t.id).padStart(3)} | ${t.trigger_type.padEnd(15)} | « ${t.title} » — posé sur ${t.user_id} (${emailDe.get(t.user_id) || '?'})`);
    console.log(`        ${couverts.length}/${c.length} joignables — hors de portée : ${perdus.map(id => nomDe.get(id) || id).join(', ')}`);
  }

  console.log(T('MODÈLES « TOUS LES LOGEMENTS » SUR UN COMPTE SANS PARC'));
  if (!vides.length) console.log('   aucun \u2713');
  for (const { t } of vides) {
    console.log(`   tpl ${String(t.id).padStart(3)} | « ${t.title} » — ${t.user_id} (${emailDe.get(t.user_id) || '?'}) n'a ni logement ni délégation`);
  }

  /* ── Comptes agence sans délégation acceptée ──────────────────── */
  console.log(T('COMPTES PORTANT DES MODÈLES POUR UN PARC QU\'ILS NE GÈRENT PAS'));
  const parCompte = new Map();
  tmpls.forEach(t => parCompte.set(t.user_id, (parCompte.get(t.user_id) || 0) + 1));
  let rien = true;
  for (const [uid, n] of parCompte) {
    const dispo = joignables(uid);
    if (dispo.size === 0) {
      rien = false;
      console.log(`   ${uid} (${emailDe.get(uid) || '?'}) porte ${n} modèle(s) et n'atteint AUCUN logement.`);
    }
  }
  if (rien) console.log('   aucun \u2713');

  console.log('\n   Rappel : une délégation n\'est pas transitive. A géré par B, B géré par C');
  console.log('   ne donne PAS à C les conversations de A. Un modèle doit vivre sur le');
  console.log('   compte qui gère directement le logement visé.\n');

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
