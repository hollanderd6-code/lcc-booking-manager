#!/usr/bin/env node
/* ============================================================
   outils/diag-modeles-compte.js
   Tous les modèles d'un compte, avec leur déclencheur et leur portée
   ============================================================
   Lecture seule.

     DATABASE_URL='postgres://…' node outils/diag-modeles-compte.js u_mtka9hxw

   Écrit après le cas Sophie Le Huche : diag-arrivee.js a répondu
   « aucun modèle on_arrival n'atteint cette conversation », alors que le
   log montre « tpl 36 | manual | sent » — le modèle existe et a été
   envoyé à la main. Il n'est donc pas déclaré on_arrival, ou il ne vise
   pas ce logement. Ce script montre les deux d'un coup.
   ============================================================ */

'use strict';
require('dotenv').config();
const { Pool } = require('pg');

const COMPTE = process.argv[2];
if (!COMPTE) { console.error('\nUsage : node outils/diag-modeles-compte.js <user_id>\n'); process.exit(1); }

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const T = (s) => `\n\u2500\u2500 ${s} ${'\u2500'.repeat(Math.max(0, 62 - s.length))}`;

(async () => {
  const { rows: props } = await pool.query(
    `SELECT id, name FROM properties WHERE user_id = $1 ORDER BY name`, [COMPTE]);
  const nom = new Map(props.map(p => [String(p.id), p.name]));

  console.log(T('LOGEMENTS DU COMPTE'));
  props.forEach(p => console.log(`   ${p.id}  ${p.name}`));
  if (!props.length) console.log('   aucun');

  const { rows: tmpls } = await pool.query(
    `SELECT id, title, trigger_type, trigger_offset_days, trigger_offset_hours,
            send_condition, active, property_id, property_ids, created_at
       FROM message_templates WHERE user_id = $1 ORDER BY id`, [COMPTE]);

  console.log(T('MODÈLES DU COMPTE'));
  if (!tmpls.length) console.log('   AUCUN modèle sur ce compte.');
  for (const t of tmpls) {
    let c = [];
    try { c = Array.isArray(t.property_ids) ? t.property_ids : JSON.parse(t.property_ids || '[]'); } catch (e) {}
    if (!c.length && t.property_id) c = [t.property_id];
    c = c.map(String);

    console.log(`\n   tpl ${t.id} — « ${t.title} »`);
    console.log(`      déclencheur : ${t.trigger_type}` +
      (t.trigger_offset_days ? ` (J${t.trigger_type.startsWith('before') ? '-' : '+'}${t.trigger_offset_days})` : '') +
      ` | actif ${t.active ? '✓' : '✗'}`);
    console.log(`      conditions  : ${t.send_condition || 'always'}`);
    console.log(`      logements   : ${c.length ? c.map(id => nom.get(id) || id + ' (HORS DU COMPTE)').join(', ') : 'tous'}`);
    if (t.trigger_offset_days === 0 && t.trigger_offset_hours && t.trigger_type.startsWith('before')) {
      console.log(`      ⚠ offset_days = 0 mais offset_hours = ${t.trigger_offset_hours} : le cron retombe sur le fallback.`);
    }
  }

  console.log(T('MODÈLES on_arrival — COUVERTURE RÉELLE'));
  const arr = tmpls.filter(t => t.trigger_type === 'on_arrival');
  if (!arr.length) {
    console.log('   AUCUN modèle on_arrival sur ce compte.');
    console.log('   => Le message d\'arrivée ne peut pas partir automatiquement : il n\'existe pas.');
    console.log('      Un modèle « avant l\'arrivée J-0 » n\'est PAS un on_arrival ; il part à 7h');
    console.log('      via le même cron mais suit le calcul d\'offset, pas la règle du jour J.');
  }
  arr.forEach(t => {
    let c = [];
    try { c = Array.isArray(t.property_ids) ? t.property_ids : JSON.parse(t.property_ids || '[]'); } catch (e) {}
    if (!c.length && t.property_id) c = [t.property_id];
    const couverts = c.map(String).filter(id => nom.has(id));
    console.log(`   tpl ${t.id} « ${t.title} » — ${c.length ? couverts.length + '/' + c.length + ' logement(s) du compte' : 'tous les logements'}`);
  });

  console.log(T('DERNIERS ENVOIS DU COMPTE'));
  const { rows: logs } = await pool.query(
    `SELECT tl.id, tl.template_id, tl.trigger_type, tl.status, tl.sent_at, tl.error_message,
            c.guest_name
       FROM message_template_logs tl
       LEFT JOIN conversations c ON c.id = tl.conversation_id
      WHERE c.user_id = $1
      ORDER BY tl.sent_at DESC NULLS LAST LIMIT 25`, [COMPTE]);
  logs.forEach(l => console.log(
    `   ${String(l.sent_at).slice(0, 21)} | tpl ${l.template_id} | ${String(l.trigger_type).padEnd(14)} | ${l.status}` +
    ` | ${l.guest_name || ''}${l.error_message ? ' | ' + l.error_message : ''}`));
  if (!logs.length) console.log('   aucun');
  console.log('');

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
