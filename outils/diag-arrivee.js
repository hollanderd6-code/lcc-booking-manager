#!/usr/bin/env node
/* ============================================================
   outils/diag-arrivee.js
   Pourquoi le message d'arrivée n'est pas parti — pour UNE réservation
   ============================================================
   Lecture seule. N'envoie rien, n'écrit rien. À lancer sur le serveur :

     node outils/diag-arrivee.js "Lucile Mouton"
     node outils/diag-arrivee.js 1274            (id de conversation)

   ── POURQUOI CE SCRIPT PLUTÔT QU'UN 5e CORRECTIF ─────────────────
   Les correctifs précédents visaient la portée agence du cron
   (WHERE c.user_id = ANY(...)). Cette cause est écartée par les faits :
   la même conversation a reçu « Message de Bienvenue » (on_booking) et
   « Caution Saint Gratien » (before_arrival), tous deux portés par le
   compte agence et ciblant le même logement délégué. Le cron voit donc
   la conversation. Ce qui reste propre à on_arrival :

     1. evaluateArrivalEligibility — gardes caution + fiche de police,
        hardcodées, indépendantes de send_condition.
     2. send_condition du modèle — ici « deposit_active,police_complete ».
        police_complete est évalué par un AUTRE helper que la garde 1 :
        les deux n'ont pas les mêmes exemptions (lien jamais envoyé,
        nationalité inconnue). C'est une asymétrie connue du code.
     3. La couche idempotente (Phase B) — idempotency_key
        « on_arrival:<template>:<conv>:<date> ». Les statuts
        'sending' (figé), 'delivery_unknown' et 'ota_rejected' sont
        TERMINAUX : aucun cron ne retente. Un webhook Stripe qui réclame
        la clé à 01h15 puis échoue suffit à faire taire le cron de 7h.

   Ce script affiche l'état réel des trois, pour la réservation donnée.
   Le verdict imprimé dit lequel a bloqué — plus de supposition.
   ============================================================ */

'use strict';
require('dotenv').config();
const { Pool } = require('pg');

const arg = process.argv.slice(2).join(' ').trim();
if (!arg) {
  console.error('\nUsage : node outils/diag-arrivee.js "Nom Voyageur" | <conversation_id>\n');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false : { rejectUnauthorized: false },
});

const T = (s) => `\n\u2500\u2500 ${s} ${'\u2500'.repeat(Math.max(0, 60 - s.length))}`;
const ok = (b) => (b ? '\u2713' : '\u2717');

async function q(sql, params) {
  try { return (await pool.query(sql, params)).rows; }
  catch (e) {
    console.log(`   (requête impossible : ${e.code || ''} ${e.message || e}) `);
    if (e.detail) console.log(`      ${e.detail}`);
    return [];
  }
}

/* La connexion d'abord : une erreur vide plus haut voulait dire « base
   injoignable », pas « voyageuse introuvable ». */
async function verifierConnexion() {
  if (!process.env.DATABASE_URL) {
    console.error('\n  DATABASE_URL absent. Lancez avec l\'URL de production :');
    console.error('    DATABASE_URL="postgres://..." node outils/diag-arrivee.js "Lucile Mouton"\n');
    process.exit(1);
  }
  try {
    const r = await pool.query('SELECT current_database() AS db, now() AS t');
    console.log(`\n  Base : ${r.rows[0].db} — ${String(r.rows[0].t).slice(0, 19)}`);
  } catch (e) {
    console.error(`\n  Connexion impossible : ${e.code || ''} ${e.message || e}`);
    console.error(`  URL utilisée : ${String(process.env.DATABASE_URL).replace(/:[^:@/]*@/, ':****@')}\n`);
    process.exit(1);
  }
}

(async () => {
  await verifierConnexion();

  /* ── 1. La conversation ───────────────────────────────────────── */
  const convs = /^\d+$/.test(arg)
    ? await q(`SELECT * FROM conversations WHERE id = $1`, [Number(arg)])
    : await q(
        `SELECT * FROM conversations
          WHERE guest_name ILIKE $1
             OR (COALESCE(guest_first_name,'') || ' ' || COALESCE(guest_last_name,'')) ILIKE $1
          ORDER BY reservation_start_date DESC NULLS LAST LIMIT 5`,
        [`%${arg}%`]
      );

  if (!convs.length) { console.log('\nAucune conversation trouvée.\n'); await pool.end(); return; }
  if (convs.length > 1) {
    console.log('\nPlusieurs conversations — relancez avec un id :');
    convs.forEach(c => console.log(`   ${c.id}  ${c.guest_name}  ${c.property_id}  ${c.reservation_start_date}`));
    await pool.end(); return;
  }

  const c = convs[0];
  const platform = String(c.platform || '').toLowerCase().replace(/[_\-\s]/g, '');
  const isAirbnb = platform.includes('airbnb') || platform === 'abb';

  console.log(T('CONVERSATION'));
  console.log(`   id ${c.id} | ${c.guest_name} | plateforme ${c.platform || '(vide)'} | status ${c.status}`);
  console.log(`   compte propriétaire de la conversation : ${c.user_id}`);
  console.log(`   logement ${c.property_id} | arrivée ${c.reservation_start_date} | channex ${c.channex_booking_id || 'non'}`);

  const [prop] = await q(`SELECT * FROM properties WHERE id = $1`, [c.property_id]);
  if (prop) console.log(`   logement « ${prop.name} » — compte ${prop.user_id} — caution ${prop.deposit_amount || 0} \u20ac`);

  /* La réservation Channex prime toujours sur un éventuel blocage calendrier
     qui tomberait sur le même logement aux mêmes dates. */
  const [resa] = await q(
    `SELECT * FROM reservations
      WHERE ($1::text IS NOT NULL AND channex_booking_id = $1)
         OR (property_id = $2 AND DATE(start_date) = DATE($3) AND $1::text IS NULL)
      ORDER BY (channex_booking_id IS NOT NULL) DESC, created_at DESC LIMIT 1`,
    [c.channex_booking_id, c.property_id, c.reservation_start_date]
  );
  const guestCountry = String((resa && resa.guest_country) || c.guest_country || '').toUpperCase().trim();
  console.log(`   réservation uid ${resa ? resa.uid : '(introuvable)'} | pays voyageur « ${guestCountry || 'INCONNU'} »`);

  /* ── 2. Les modèles on_arrival qui visent ce logement ──────────── */
  console.log(T('MODÈLES on_arrival CANDIDATS'));
  const tmpls = await q(`SELECT * FROM message_templates WHERE trigger_type = 'on_arrival'`);
  const candidats = [];
  for (const t of tmpls) {
    let cibles = [];
    try {
      cibles = Array.isArray(t.property_ids) ? t.property_ids : JSON.parse(t.property_ids || '[]');
    } catch (e) { cibles = []; }
    if (!cibles.length && t.property_id) cibles = [t.property_id];

    const viseLeLogement = cibles.length === 0 || cibles.map(String).includes(String(c.property_id));

    /* Les comptes que ce modèle peut servir — même règle que comptesDuTemplate */
    const deleg = await q(
      `SELECT delegator_user_id FROM account_delegations
        WHERE delegate_user_id = $1 AND status = 'accepted'`, [t.user_id]);
    const comptes = [t.user_id, ...deleg.map(d => d.delegator_user_id)];
    const atteintLaConv = comptes.includes(c.user_id);

    if (!viseLeLogement && !atteintLaConv) continue;
    candidats.push({ t, cibles, viseLeLogement, atteintLaConv, comptes });

    console.log(`   « ${t.title} » (id ${t.id}) — compte ${t.user_id} — actif ${ok(t.active)}`);
    console.log(`      ${ok(atteintLaConv)} atteint le compte de la conversation (${comptes.length} compte(s) lus)`);
    console.log(`      ${ok(viseLeLogement)} vise le logement (${cibles.length ? cibles.length + ' ciblés' : 'tous'})`);
    console.log(`      send_condition : ${t.send_condition || 'always'}`);
  }
  if (!candidats.length) console.log('   AUCUN modèle on_arrival ne peut atteindre cette conversation.');

  /* ── 3. Garde caution ─────────────────────────────────────────── */
  console.log(T('GARDE 1 — CAUTION'));
  /* deposits n'a pas de conversation_id : le rattachement se fait par
     reservation_uid, y compris la forme « CHX_<booking id> ». */
  const deps = await q(
    `SELECT id, status, amount_cents, reservation_uid, authorized_at, captured_at, created_at
       FROM deposits
      WHERE reservation_uid = ANY($1::text[])
      ORDER BY created_at DESC`,
    [[resa ? resa.uid : null, c.channex_booking_id ? 'CHX_' + c.channex_booking_id : null].filter(Boolean)]
  );
  deps.forEach(d => console.log(`   deposit ${d.id} | status ${d.status} | ${(d.amount_cents || 0) / 100} \u20ac | uid ${d.reservation_uid} | autorisée ${d.authorized_at || '-'}`));
  if (!deps.length) console.log('   aucune ligne deposits rattachée');

  const depStatus = deps.length ? deps[0].status : null;
  const depositRequired = !isAirbnb && Number(prop && prop.deposit_amount || 0) > 0;
  const depositSatisfied = !depositRequired || depStatus === 'authorized' || depStatus === 'captured';
  console.log(`   => requise ${ok(depositRequired)} | satisfaite ${ok(depositSatisfied)} (status lu : ${depStatus || 'aucune'})`);
  console.log('   ATTENTION : si la caution existe mais n\'est PAS rattachée par reservation_uid');
  console.log('   ci-dessus, la garde la lit comme « aucune » et bloque, même payée.');

  /* ── 4. Garde police ──────────────────────────────────────────── */
  console.log(T('GARDE 2 — FICHE DE POLICE'));
  const police = await q(
    `SELECT id, status, signed_at FROM police_records
      WHERE conversation_id = $1 OR ($2::text IS NOT NULL AND reservation_uid = $2)`,
    [c.id, resa ? resa.uid : null]
  );
  const policeDone = police.some(p => p.status === 'signed');
  const policeRequired = !isAirbnb && guestCountry !== '' && guestCountry !== 'FR';
  const lienEnvoye = await q(
    `SELECT id, sent_at, status FROM message_template_logs
      WHERE conversation_id = $1 AND status = 'sent' AND message ILIKE '%checkin.html%'
      ORDER BY sent_at DESC LIMIT 3`, [c.id]);
  console.log(`   fiches signées : ${police.length ? police.map(p => p.id + '/' + p.status).join(', ') : 'aucune'}`);
  console.log(`   lien {checkin_link} réellement envoyé : ${lienEnvoye.length ? lienEnvoye.map(l => l.sent_at).join(', ') : 'JAMAIS'}`);
  console.log(`   => requise ${ok(policeRequired)} (pays « ${guestCountry || 'INCONNU'} ») | signée ${ok(policeDone)}`);
  console.log('   Rappel : evaluateArrivalEligibility ne bloque que si le lien a été');
  console.log('   envoyé. Mais le token « police_complete » d\'un send_condition passe');
  console.log('   par shouldSkipForDepositCondition, qui n\'a PAS cette exemption.');
  const tokenPolice = candidats.some(x => String(x.t.send_condition || '').includes('police_complete'));
  if (tokenPolice && policeRequired && !policeDone) {
    console.log('   *** Le modèle coche « Fiche police » ET aucune fiche n\'est signée :');
    console.log('       ce token bloque l\'envoi indépendamment de la garde ci-dessus. ***');
  }

  /* ── 5. La couche idempotente + les logs ──────────────────────── */
  console.log(T('GARDE 3 — IDEMPOTENCE / LOGS D\'ENVOI'));
  const logs = await q(
    `SELECT id, template_id, trigger_type, status, error_message, idempotency_key, sent_at
       FROM message_template_logs
      WHERE conversation_id = $1
      ORDER BY sent_at DESC NULLS LAST LIMIT 40`, [c.id]);
  if (!logs.length) console.log('   aucun log — le modèle n\'a jamais été évalué pour cette conversation');
  logs.forEach(l => console.log(
    `   ${String(l.sent_at).slice(0, 19)} | tpl ${l.template_id} | ${l.trigger_type} | ${l.status}` +
    `${l.error_message ? ' | ' + l.error_message : ''}${l.idempotency_key ? ' | ' + l.idempotency_key : ''}`));

  const terminaux = logs.filter(l => l.trigger_type === 'on_arrival'
    && ['sending', 'delivery_unknown', 'ota_rejected'].includes(l.status));
  if (terminaux.length) {
    console.log('\n   *** Une clé d\'idempotence est en statut TERMINAL :');
    terminaux.forEach(l => console.log(`       ${l.status} — ${l.idempotency_key}`));
    console.log('       Aucun cron ne retentera. Seul un passage à \'error\' (ou la');
    console.log('       suppression de la ligne) rouvre l\'envoi. C\'est le cas typique');
    console.log('       d\'un webhook Stripe de nuit qui réclame la clé puis échoue. ***');
  }

  /* ── 6. Verdict ───────────────────────────────────────────────── */
  console.log(T('VERDICT'));
  if (!candidats.length) console.log('   Aucun modèle on_arrival n\'atteint cette conversation (portée/ciblage).');
  else if (terminaux.length) console.log('   BLOQUÉ par la couche idempotente (statut terminal ci-dessus).');
  else if (!depositSatisfied) console.log('   BLOQUÉ par la garde caution (status lu : ' + (depStatus || 'aucune') + ').');
  else if (tokenPolice && policeRequired && !policeDone) console.log('   BLOQUÉ par le token send_condition « police_complete ».');
  else if (policeRequired && !policeDone && lienEnvoye.length) console.log('   BLOQUÉ par la garde police (lien envoyé, fiche non signée).');
  else console.log('   Aucune garde ne bloque : le modèle aurait dû partir. Chercher côté\n   sélection du cron (log « N conversation(s) ciblée(s) sur M compte(s) »).');
  console.log('');

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
