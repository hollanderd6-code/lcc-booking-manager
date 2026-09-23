'use strict';
/**
 * AB-PRIORITY — Diagnostic ciblé sur les résas A et B CDG5 (sept 2026)
 *
 *   A = CHX_702f5756-08e5-4846-b137-654b48149f66   DB: 2026-09-17 → 2026-09-22
 *   B = CHX_5d61658d-b679-4c93-b17b-299daf200a71   DB: 2026-09-17 → 2026-09-19
 *
 * Question centrale :
 *   Est-ce que A(17→22) correspond aux dates PARENT du booking Channex,
 *   alors que la room réellement associée à CDG5 avait des dates différentes ?
 *
 * STRICTEMENT READ-ONLY — aucun INSERT, UPDATE, DELETE.
 *
 * Usage :
 *   ! DATABASE_URL=<url> node scripts/diag-ab-priority.js
 *
 * Sections :
 *   AB-1  → données complètes DB pour A et B
 *   AB-2  → partagent-ils le même channex_booking_id ? (multi-room ?)
 *   AB-3  → channex_room_type_id de CDG5 + association room type
 *   AB-4  → channex_logs pour les booking_ids de A et B (historique complet)
 *   AB-5  → dateDedup : même start_date → collision → une résa disparaît
 *   AB-6  → toutes résas CDG5 sept 2026 (toutes sources, tous statuts)
 *   AB-7  → timeline reconstructée des événements Channex
 *   AB-8  → verdict : dates PARENT ou dates ROOM-LEVEL en DB ?
 *   AB-9  → si CHXROOMFIX applicable : CURRENT_DB_DATES / CORRECT_ROOM_DATES / EVIDENCE / CONFIDENCE
 */

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('\n❌  DATABASE_URL manquant.\n');
  console.error('  ! DATABASE_URL=<url> node scripts/diag-ab-priority.js\n');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const UID_A = 'CHX_702f5756-08e5-4846-b137-654b48149f66';
const UID_B = 'CHX_5d61658d-b679-4c93-b17b-299daf200a71';

function d(v) {
  if (!v) return 'null';
  // Si pg retourne un Date object (colonne TIMESTAMPTZ), on lit en heure Paris
  // pour éviter le décalage UTC → -1 jour (voir diag-offset.js OFFSET-4)
  if (v instanceof Date) return v.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
  return String(v).slice(0, 10);
}

function banner(code, title) {
  const bar = '─'.repeat(Math.max(0, 72 - code.length - title.length - 3));
  console.log(`\n${code} — ${title} ${bar}`);
}

function days(start, end) {
  if (!start || !end) return '?';
  return Math.round((new Date(end) - new Date(start)) / 86400000);
}

async function run() {

  // ════════════════════════════════════════════════════════════════════════════
  banner('AB-1', 'Données complètes DB pour A et B');
  // ════════════════════════════════════════════════════════════════════════════

  const resA_q = await pool.query(`
    SELECT id, uid, property_id,
           start_date, end_date,
           source, platform, ota_name, status,
           channex_booking_id, ota_reservation_id,
           guest_name,
           days_breakdown,
           amount_total,
           created_at, updated_at
    FROM reservations WHERE uid = $1
  `, [UID_A]);

  const resB_q = await pool.query(`
    SELECT id, uid, property_id,
           start_date, end_date,
           source, platform, ota_name, status,
           channex_booking_id, ota_reservation_id,
           guest_name,
           days_breakdown,
           amount_total,
           created_at, updated_at
    FROM reservations WHERE uid = $1
  `, [UID_B]);

  const rowA = resA_q.rows[0] || null;
  const rowB = resB_q.rows[0] || null;

  function printRow(label, row) {
    if (!row) { console.log(`  ${label} : ❌  INTROUVABLE`); return; }
    const span = days(row.start_date, row.end_date);
    const bdKeys = row.days_breakdown ? Object.keys(row.days_breakdown) : [];
    console.log(`  ${label} = ${row.uid}`);
    console.log(`    property_id          : ${row.property_id}`);
    console.log(`    start_date           : ${d(row.start_date)}`);
    console.log(`    end_date             : ${d(row.end_date)}`);
    console.log(`    span                 : ${span} nuits`);
    console.log(`    status               : ${row.status}`);
    console.log(`    source               : ${row.source}`);
    console.log(`    ota_name             : ${row.ota_name || 'null'}`);
    console.log(`    channex_booking_id   : ${row.channex_booking_id || 'null'}`);
    console.log(`    ota_reservation_id   : ${row.ota_reservation_id || 'null'}`);
    console.log(`    guest_name           : ${row.guest_name || 'null'}`);
    console.log(`    amount_total         : ${row.amount_total || 'null'}`);
    console.log(`    days_breakdown keys  : ${bdKeys.length}  [${bdKeys.sort().slice(0,4).join(', ')}${bdKeys.length>4?'…':''}]`);
    console.log(`    created_at           : ${d(row.created_at)}`);
    console.log(`    updated_at           : ${d(row.updated_at)}`);
  }

  printRow('A', rowA);
  console.log('');
  printRow('B', rowB);

  // ════════════════════════════════════════════════════════════════════════════
  banner('AB-2', 'Partagent-ils le même channex_booking_id ? (multi-room ?)');
  // ════════════════════════════════════════════════════════════════════════════

  const bidA = rowA?.channex_booking_id || null;
  const bidB = rowB?.channex_booking_id || null;

  console.log(`  A.channex_booking_id = ${bidA || 'null'}`);
  console.log(`  B.channex_booking_id = ${bidB || 'null'}`);

  if (bidA && bidB && bidA === bidB) {
    console.log(`\n  ⚠️  MÊME booking_id → A et B sont du MÊME booking Channex (multi-room)`);
    console.log(`       Ceci confirme le scénario CAS B3 : booking multi-room,`);
    console.log(`       l'une des résas a les dates PARENT au lieu des dates room-level.`);
  } else if (bidA && bidB) {
    console.log(`\n  ℹ️  booking_ids DIFFÉRENTS → résas de bookings Channex distincts.`);
  } else {
    console.log(`\n  ℹ️  Au moins un booking_id est null — vérifier les logs pour la source.`);
  }

  // Si même booking_id, lister toutes les résas qui le portent
  if (bidA) {
    const siblings = await pool.query(`
      SELECT uid, start_date, end_date, status, ota_name, updated_at
      FROM reservations
      WHERE channex_booking_id = $1
      ORDER BY start_date ASC
    `, [bidA]);
    if (siblings.rows.length > 1) {
      console.log(`\n  Toutes les résas avec channex_booking_id="${bidA}" :`);
      siblings.rows.forEach((r, i) => {
        const sp = days(r.start_date, r.end_date);
        const flag = r.uid === UID_A ? ' ← A' : r.uid === UID_B ? ' ← B' : '';
        console.log(`    [${i+1}] uid=${r.uid}  ${d(r.start_date)}→${d(r.end_date)}  (${sp}n)  status=${r.status}${flag}`);
      });
    }
  }
  if (bidB && bidB !== bidA) {
    const siblings = await pool.query(`
      SELECT uid, start_date, end_date, status, ota_name, updated_at
      FROM reservations
      WHERE channex_booking_id = $1
      ORDER BY start_date ASC
    `, [bidB]);
    if (siblings.rows.length > 1) {
      console.log(`\n  Toutes les résas avec channex_booking_id="${bidB}" :`);
      siblings.rows.forEach((r, i) => {
        const sp = days(r.start_date, r.end_date);
        const flag = r.uid === UID_A ? ' ← A' : r.uid === UID_B ? ' ← B' : '';
        console.log(`    [${i+1}] uid=${r.uid}  ${d(r.start_date)}→${d(r.end_date)}  (${sp}n)  status=${r.status}${flag}`);
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('AB-3', 'channex_room_type_id de CDG5 + association room type');
  // ════════════════════════════════════════════════════════════════════════════

  const propId = rowA?.property_id || rowB?.property_id;
  if (propId) {
    const propR = await pool.query(`
      SELECT id, name, internal_name,
             channex_property_id, channex_room_type_id, channex_rate_plan_id,
             channex_enabled
      FROM properties WHERE id = $1
    `, [propId]);
    if (propR.rows.length > 0) {
      const p = propR.rows[0];
      console.log(`  property_id            : ${p.id}`);
      console.log(`  name                   : ${p.name}`);
      console.log(`  internal_name          : ${p.internal_name || 'null'}`);
      console.log(`  channex_property_id    : ${p.channex_property_id || 'null'}`);
      console.log(`  channex_room_type_id   : ${p.channex_room_type_id || 'null'}`);
      console.log(`  channex_rate_plan_id   : ${p.channex_rate_plan_id || 'null'}`);
      console.log(`  channex_enabled        : ${p.channex_enabled}`);

      // Vérifier si le booking_room_type_id de A ou B correspond à channex_room_type_id
      // (channex_room_type_id est l'ID de type de chambre configuré pour ce logement)
      // Dans processChannexBooking : room_type_id (rooms[0].room_type_id) doit matcher
      // pour que l'association soit EXACT_ROOM_TYPE (vs PROPERTY_FALLBACK).
      // On peut reconstruire cette info depuis channex_logs.
      console.log(`\n  ℹ️  Pour l'association room : si rooms[0].room_type_id == channex_room_type_id`);
      console.log(`       → EXACT_ROOM_TYPE (association directe)`);
      console.log(`       sinon → PROPERTY_FALLBACK (match par propriété seulement)`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('AB-4', 'channex_logs — historique complet pour les booking_ids A et B');
  // ════════════════════════════════════════════════════════════════════════════

  async function printLogs(bid, label) {
    if (!bid) { console.log(`  ${label} : booking_id null — pas de logs`); return; }
    try {
      const r = await pool.query(`
        SELECT id, event_type, direction, payload, created_at
        FROM channex_logs
        WHERE (payload->>'booking_id' = $1
               OR payload->>'channex_booking_id' = $1)
        ORDER BY created_at ASC
      `, [bid]);

      console.log(`\n  ${label} (booking_id=${bid}) — ${r.rows.length} log(s) :`);
      if (r.rows.length === 0) {
        // Fallback : chercher par uid dans property_id
        const r2 = await pool.query(`
          SELECT id, event_type, direction, payload, created_at
          FROM channex_logs
          WHERE property_id = $1
            AND created_at >= '2026-09-01'
            AND created_at <  '2026-10-01'
          ORDER BY created_at ASC
          LIMIT 20
        `, [propId]);
        console.log(`  (0 log sur booking_id — fallback property sept 2026 : ${r2.rows.length} log(s))`);
        r2.rows.forEach(row => printLogRow(row));
        return;
      }

      r.rows.forEach(row => printLogRow(row));
    } catch (e) {
      console.log(`  ⚠️  Erreur channex_logs : ${e.message}`);
    }
  }

  function printLogRow(row) {
    const p = row.payload || {};
    console.log(`  ${d(row.created_at)}  ${String(row.event_type).padEnd(18)}`);
    if (p.booking_id)         console.log(`    booking_id         : ${p.booking_id}`);
    if (p.revision_id)        console.log(`    revision_id        : ${p.revision_id}`);
    if (p.rooms_count != null)console.log(`    rooms_count        : ${p.rooms_count}`);
    if (p.room0_type_id)      console.log(`    room0_type_id      : ${p.room0_type_id}`);
    if (p.room0_checkin)      console.log(`    room0_checkin      : ${p.room0_checkin}`);
    if (p.room0_checkout)     console.log(`    room0_checkout     : ${p.room0_checkout}`);
    if (p.parent_arrival)     console.log(`    parent_arrival     : ${p.parent_arrival}`);
    if (p.parent_departure)   console.log(`    parent_departure   : ${p.parent_departure}`);
    if (p.reservation_start)  console.log(`    reservation_start  : ${p.reservation_start}  ← dates persistées en DB`);
    if (p.reservation_end)    console.log(`    reservation_end    : ${p.reservation_end}  ← dates persistées en DB`);
    if (p.ota_reservation_code) console.log(`    ota_reservation_code: ${p.ota_reservation_code}`);
    // Payload brut tronqué si pas les champs attendus
    const knownKeys = ['booking_id','revision_id','rooms_count','room0_type_id',
                       'room0_checkin','room0_checkout','parent_arrival','parent_departure',
                       'reservation_start','reservation_end','ota_reservation_code',
                       'ota_name','amount_total'];
    const extra = Object.entries(p).filter(([k]) => !knownKeys.includes(k));
    if (extra.length > 0) {
      const extraStr = extra.slice(0,4).map(([k,v]) => `${k}=${JSON.stringify(v)}`).join('  ');
      console.log(`    (autres) ${extraStr}`);
    }
    console.log('');
  }

  await printLogs(bidA, 'Logs A');
  if (bidB && bidB !== bidA) await printLogs(bidB, 'Logs B');
  else if (bidB === bidA) console.log('\n  B partage le même booking_id que A — logs identiques.');

  // ════════════════════════════════════════════════════════════════════════════
  banner('AB-5', 'dateDedup — même start_date → collision → une résa disparaît');
  // ════════════════════════════════════════════════════════════════════════════

  {
    const startA = d(rowA?.start_date);
    const startB = d(rowB?.start_date);
    const endA   = d(rowA?.end_date);
    const endB   = d(rowB?.end_date);

    console.log(`  A : start=${startA}  end=${endA}  → clé dateDedup = "${startA}_${endA}"`);
    console.log(`  B : start=${startB}  end=${endB}  → clé dateDedup = "${startB}_${endB}"`);

    if (startA === startB && endA === endB) {
      console.log(`\n  ⚠️  CLÉ IDENTIQUE → dateDedup élimine l'une des deux (la moins récente par updated_at)`);
      const tsA = String(rowA?.updated_at || rowA?.created_at || '');
      const tsB = String(rowB?.updated_at || rowB?.created_at || '');
      if (tsA > tsB) {
        console.log(`       A (updated=${d(rowA?.updated_at)}) > B (updated=${d(rowB?.updated_at)}) → B ÉLIMINÉE`);
      } else if (tsB > tsA) {
        console.log(`       B (updated=${d(rowB?.updated_at)}) > A (updated=${d(rowA?.updated_at)}) → A ÉLIMINÉE`);
      } else {
        console.log(`       Timestamps égaux — comportement non déterministe.`);
      }
    } else if (startA === startB) {
      console.log(`\n  ⚠️  Même start_date mais end_date différentes → clés différentes.`);
      console.log(`       Les deux résas survivent à dateDedup.`);
      console.log(`       Mais elles ont la MÊME start_date → chevauchement calendrier.`);
    } else {
      console.log(`\n  ✅  start_dates différentes → pas de collision dateDedup.`);
    }

    // Aussi : le store channex est remplacé par DB pour source=channex
    // → dateDedup ne s'applique pas directement à ces résas
    // Mais si A et B partagent start_date, la DB query les retourne toutes les deux
    // et elles se retrouvent toutes les deux dans allReservations
    console.log(`\n  ℹ️  Note : les résas channex (source=channex) contournent dateDedup`);
    console.log(`       (elles sont ajoutées depuis la DB directement, pas depuis le store).`);
    console.log(`       Si A et B ont même start_date, elles seront TOUTES LES DEUX dans la sortie.`);
    console.log(`       Le calendrier iOS les affiche donc simultanément → bloc visuel fusionné.`);
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('AB-6', 'Toutes résas CDG5 sept 2026 (toutes sources, tous statuts)');
  // ════════════════════════════════════════════════════════════════════════════

  if (propId) {
    const r = await pool.query(`
      SELECT uid, start_date, end_date, source, platform, ota_name, status,
             channex_booking_id, days_breakdown, created_at, updated_at
      FROM reservations
      WHERE property_id = $1
        AND start_date >= '2026-09-01'::date
        AND start_date <  '2026-10-01'::date
      ORDER BY start_date ASC, created_at ASC
    `, [propId]);

    console.log(`  ${r.rows.length} ligne(s) en septembre 2026 pour la propriété :`);
    r.rows.forEach((row, i) => {
      const sp  = days(row.start_date, row.end_date);
      const bdk = row.days_breakdown ? Object.keys(row.days_breakdown).length : 0;
      const flag = row.uid === UID_A ? ' ← A' : row.uid === UID_B ? ' ← B' : '';
      console.log(`  [${i+1}] ${d(row.start_date)}→${d(row.end_date)}  (${sp}n)  uid=${row.uid}${flag}`);
      console.log(`       source=${row.source}  status=${row.status}  chx_bid=${row.channex_booking_id || '-'}  bd_keys=${bdk}`);
      console.log(`       created=${d(row.created_at)}  updated=${d(row.updated_at)}`);
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('AB-7', 'Timeline reconstruite des événements Channex (sept)');
  // ════════════════════════════════════════════════════════════════════════════

  if (propId) {
    try {
      const r = await pool.query(`
        SELECT id, event_type, direction, payload, created_at
        FROM channex_logs
        WHERE property_id = $1
          AND created_at >= '2026-09-01'
          AND created_at <  '2026-10-01'
        ORDER BY created_at ASC
        LIMIT 50
      `, [propId]);

      console.log(`  ${r.rows.length} log(s) channex pour CDG5 en sept 2026 :`);
      r.rows.forEach(row => {
        const p = row.payload || {};
        const bid   = (p.booking_id || '').slice(0,8);
        const rStart = p.reservation_start || p.room0_checkin || '?';
        const rEnd   = p.reservation_end   || p.room0_checkout || '?';
        const pArr   = p.parent_arrival    || '';
        const pDep   = p.parent_departure  || '';
        const rooms  = p.rooms_count != null ? `rooms=${p.rooms_count}` : '';
        console.log(`  ${d(row.created_at)}  ${String(row.event_type).padEnd(16)}  bid=${bid}…  res=${rStart}→${rEnd}  parent=${pArr}→${pDep}  ${rooms}`);
      });
    } catch (e) {
      console.log(`  ⚠️  Erreur : ${e.message}`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('AB-8', 'Verdict — dates PARENT ou dates ROOM-LEVEL en DB ?');
  // ════════════════════════════════════════════════════════════════════════════

  {
    console.log(`  Rappel des faits :`);
    console.log(`    A DB : ${d(rowA?.start_date)} → ${d(rowA?.end_date)}  (${days(rowA?.start_date, rowA?.end_date)} nuits)`);
    console.log(`    B DB : ${d(rowB?.start_date)} → ${d(rowB?.end_date)}  (${days(rowB?.start_date, rowB?.end_date)} nuits)`);
    console.log('');
    console.log(`  Interprétation selon channex_logs (voir AB-4 et AB-7) :`);
    console.log('');
    console.log(`  Si logs montrent :`);
    console.log(`    parent_arrival=2026-09-17  parent_departure=2026-09-22`);
    console.log(`    room0_checkin =2026-09-17  room0_checkout =2026-09-19  (ou autre)`);
    console.log(`  ET A.end_date = parent_departure (22) alors que room0_checkout = 19`);
    console.log(`  → A a été créée avec les dates PARENT (avant CHXROOMFIX) ← H1 CONFIRMÉE`);
    console.log('');
    console.log(`  Si A et B ont le même booking_id :`);
    console.log(`    A = multi-room room 0 créée avec parent dates (17→22)`);
    console.log(`    B = multi-room room 1 créée avec room-level dates (17→19)`);
    console.log(`    → les deux coexistent avec start=17, l'une a la mauvaise end_date`);
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('AB-9', 'Si CHXROOMFIX applicable : données corrigées');
  // ════════════════════════════════════════════════════════════════════════════

  {
    // On peut seulement conclure sur données + logs
    // Le script affiche le template à remplir avec les données AB-4

    const bdA = rowA?.days_breakdown ? Object.keys(rowA.days_breakdown).sort() : [];
    const bdB = rowB?.days_breakdown ? Object.keys(rowB.days_breakdown).sort() : [];

    console.log(`  Signal secondaire — days_breakdown :`);
    console.log(`    A : ${bdA.length} clés  first=${bdA[0]||'?'}  last=${bdA[bdA.length-1]||'?'}`);
    console.log(`    B : ${bdB.length} clés  first=${bdB[0]||'?'}  last=${bdB[bdB.length-1]||'?'}`);
    console.log('');
    console.log(`  ──────────────────────────────────────────────────────────────`);
    console.log(`  À compléter après lecture des logs AB-4 :`);
    console.log('');
    console.log(`  CURRENT_DB_DATES  A : ${d(rowA?.start_date)} → ${d(rowA?.end_date)}`);
    console.log(`  CORRECT_ROOM_DATES A : <room0_checkin depuis logs> → <room0_checkout depuis logs>`);
    console.log('');
    console.log(`  EVIDENCE :`);
    console.log(`    - channex_booking_id A : ${rowA?.channex_booking_id || 'voir AB-1'}`);
    console.log(`    - channex_booking_id B : ${rowB?.channex_booking_id || 'voir AB-1'}`);
    console.log(`    - rooms_count depuis logs : voir AB-4`);
    console.log(`    - parent_departure depuis logs : voir AB-4`);
    console.log(`    - room0_checkout depuis logs : voir AB-4`);
    console.log(`    - A.end_date == parent_departure ? : à déduire de AB-4`);
    console.log('');
    console.log(`  CONFIDENCE : [HAUTE si logs confirment parent_departure=22 et room0_checkout≠22]`);
    console.log(`  ──────────────────────────────────────────────────────────────`);
    console.log('');
    console.log(`  Si H1 confirmée, l'UPDATE requis (NE PAS EXÉCUTER MAINTENANT) :`);
    console.log(`    UPDATE reservations`);
    console.log(`    SET start_date = '<room0_checkin>', end_date = '<room0_checkout>',`);
    console.log(`        updated_at = NOW()`);
    console.log(`    WHERE uid = '${UID_A}';`);
    console.log('');
    console.log(`  Si A et B ont le même booking_id et B a déjà les bonnes dates,`);
    console.log(`  la correction est uniquement sur A.`);
  }

  await pool.end();
  console.log('\n── AB-PRIORITY terminé ──────────────────────────────────────────────────\n');
}

run().catch(err => {
  console.error('Erreur fatale :', err.message);
  pool.end();
  process.exit(1);
});
