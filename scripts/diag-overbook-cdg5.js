'use strict';
/**
 * CDG5-OVERBOOKING — Diagnostic forensique READ-ONLY
 *
 * Propriété : CDG5 (u_mmj5c6hq-cdg5)
 * Booking A  : 702f5756-08e5-4846-b137-654b48149f66 (Matthias Fingerle, 18→23 sept)
 * Booking B  : 5d61658d-b679-4c93-b17b-299daf200a71 (Bringboui Natasha, 18→20 sept)
 *
 * Exécution : DATABASE_URL=<url> node scripts/diag-overbook-cdg5.js
 *
 * AUCUN UPDATE / DELETE / INSERT — strictement SELECT.
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
});

// ── Constantes ─────────────────────────────────────────────────────────────
const PROPERTY_ID          = 'u_mmj5c6hq-cdg5';
const CHANNEX_PROPERTY_ID  = 'f8a37394-a68d-45f6-aa78-915c6380c118';
const CHANNEX_ROOM_TYPE_ID = '8d800c4d-54f5-4f3b-9d59-75c7807a8c39';
const BOOKING_A_ID         = '702f5756-08e5-4846-b137-654b48149f66';
const BOOKING_B_ID         = '5d61658d-b679-4c93-b17b-299daf200a71';
const OTA_A                = '6950155430';
const OTA_B                = '6716680387';
const WINDOW_START         = '2026-09-15 22:00:00+00'; // UTC = 2026-09-16 00:00 Paris
const WINDOW_END           = '2026-09-18 22:00:00+00'; // UTC = 2026-09-19 00:00 Paris
const DATES_A              = ['2026-09-18','2026-09-19','2026-09-20','2026-09-21','2026-09-22'];

function banner(code, title) {
  const pad = Math.max(0, 68 - code.length - title.length - 3);
  console.log(`\n${'═'.repeat(3)} ${code} — ${title} ${'═'.repeat(pad)}`);
}

function row(label, val) {
  console.log(`  ${String(label).padEnd(36)} ${val ?? 'NULL'}`);
}

function ts(d) {
  if (!d) return 'NULL';
  const dt = new Date(d);
  return dt.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

async function main() {
  const client = await pool.connect();
  try {
    console.log('\n══ CDG5-OVERBOOKING — Diagnostic forensique (READ-ONLY) ══════════════\n');

    // ══════════════════════════════════════════════════════════════════════
    // OVERBOOK-1 — Propriété CDG5 / configuration Channex
    // ══════════════════════════════════════════════════════════════════════
    banner('OVERBOOK-1', 'Configuration CDG5 / room type');

    const propR = await client.query(
      `SELECT id, name, internal_name, channex_enabled,
              channex_property_id, channex_room_type_id, channex_rate_plan_id,
              ical_urls
       FROM properties WHERE id = $1`,
      [PROPERTY_ID]
    );
    if (propR.rows.length === 0) {
      console.log('  ⚠️  PROPRIÉTÉ INTROUVABLE — vérifier PROPERTY_ID');
    } else {
      const p = propR.rows[0];
      row('name', p.name);
      row('internal_name', p.internal_name);
      row('channex_enabled', p.channex_enabled);
      row('channex_property_id', p.channex_property_id);
      row('channex_property_id MATCH', p.channex_property_id === CHANNEX_PROPERTY_ID ? '✅ OUI' : '❌ NON — MISMATCH');
      row('channex_room_type_id', p.channex_room_type_id);
      row('channex_room_type_id MATCH', p.channex_room_type_id === CHANNEX_ROOM_TYPE_ID ? '✅ OUI' : '❌ NON — MISMATCH');
      row('channex_rate_plan_id', p.channex_rate_plan_id);
      const ical = p.ical_urls;
      const icalArr = Array.isArray(ical) ? ical : (typeof ical === 'string' ? JSON.parse(ical || '[]') : []);
      row('ical_urls count', icalArr.length);
      if (icalArr.length > 0) {
        icalArr.forEach((u, i) => row(`  ical[${i}]`, typeof u === 'object' ? u.url : u));
      }
    }

    // ══════════════════════════════════════════════════════════════════════
    // OVERBOOK-2 — Réservation A (Matthias Fingerle)
    // ══════════════════════════════════════════════════════════════════════
    banner('OVERBOOK-2', 'Réservation A (Matthias Fingerle)');

    const resA = await client.query(
      `SELECT uid, property_id, status, source, platform, ota_name, ota_reservation_id,
              channex_booking_id, channex_revision_id,
              to_char(start_date AT TIME ZONE 'Europe/Paris','YYYY-MM-DD') as start_str,
              to_char(end_date   AT TIME ZONE 'Europe/Paris','YYYY-MM-DD') as end_str,
              to_char(created_at AT TIME ZONE 'Europe/Paris','YYYY-MM-DD HH24:MI:SS') as created_paris,
              to_char(updated_at AT TIME ZONE 'Europe/Paris','YYYY-MM-DD HH24:MI:SS') as updated_paris
       FROM reservations
       WHERE channex_booking_id = $1
          OR ota_reservation_id = $2
       ORDER BY created_at LIMIT 5`,
      [BOOKING_A_ID, OTA_A]
    );
    if (resA.rows.length === 0) {
      console.log('  ⚠️  Réservation A INTROUVABLE par booking_id ou ota_reservation_id');
    } else {
      resA.rows.forEach((r, i) => {
        if (i > 0) console.log('  --- doublon/version ---');
        row('uid', r.uid);
        row('status', r.status);
        row('source', r.source);
        row('platform / ota_name', `${r.platform} / ${r.ota_name}`);
        row('channex_booking_id', r.channex_booking_id);
        row('ota_reservation_id', r.ota_reservation_id);
        row('dates (Paris)', `${r.start_str} → ${r.end_str}`);
        row('created (Paris)', r.created_paris);
        row('updated (Paris)', r.updated_paris);
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    // OVERBOOK-3 — Réservation B (Bringboui Natasha)
    // ══════════════════════════════════════════════════════════════════════
    banner('OVERBOOK-3', 'Réservation B (Bringboui Natasha)');

    const resB = await client.query(
      `SELECT uid, property_id, status, source, platform, ota_name, ota_reservation_id,
              channex_booking_id, channex_revision_id,
              to_char(start_date AT TIME ZONE 'Europe/Paris','YYYY-MM-DD') as start_str,
              to_char(end_date   AT TIME ZONE 'Europe/Paris','YYYY-MM-DD') as end_str,
              to_char(created_at AT TIME ZONE 'Europe/Paris','YYYY-MM-DD HH24:MI:SS') as created_paris,
              to_char(updated_at AT TIME ZONE 'Europe/Paris','YYYY-MM-DD HH24:MI:SS') as updated_paris
       FROM reservations
       WHERE channex_booking_id = $1
          OR ota_reservation_id = $2
       ORDER BY created_at LIMIT 5`,
      [BOOKING_B_ID, OTA_B]
    );
    if (resB.rows.length === 0) {
      console.log('  ⚠️  Réservation B INTROUVABLE par booking_id ou ota_reservation_id');
    } else {
      resB.rows.forEach((r, i) => {
        if (i > 0) console.log('  --- doublon/version ---');
        row('uid', r.uid);
        row('status', r.status);
        row('source / platform', `${r.source} / ${r.platform}`);
        row('channex_booking_id', r.channex_booking_id);
        row('ota_reservation_id', r.ota_reservation_id);
        row('dates (Paris)', `${r.start_str} → ${r.end_str}`);
        row('created (Paris)', r.created_paris);
        row('updated (Paris)', r.updated_paris);
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    // OVERBOOK-4 — Toutes les réservations CDG5 actives (non cancelled)
    // ══════════════════════════════════════════════════════════════════════
    banner('OVERBOOK-4', 'Toutes réservations CDG5 sept–oct 2026');

    const allRes = await client.query(
      `SELECT uid, status, source, ota_name, ota_reservation_id, channex_booking_id,
              to_char(start_date AT TIME ZONE 'Europe/Paris','YYYY-MM-DD') as start_str,
              to_char(end_date   AT TIME ZONE 'Europe/Paris','YYYY-MM-DD') as end_str,
              to_char(created_at AT TIME ZONE 'Europe/Paris','YYYY-MM-DD HH24:MI:SS') as created_paris
       FROM reservations
       WHERE property_id = $1
         AND start_date >= '2026-09-01' AND start_date <= '2026-10-31'
       ORDER BY start_date`,
      [PROPERTY_ID]
    );
    if (allRes.rows.length === 0) {
      console.log('  Aucune réservation CDG5 sept–oct 2026');
    } else {
      console.log(`  ${allRes.rows.length} réservation(s) :\n`);
      allRes.rows.forEach(r => {
        const tag = r.status === 'cancelled' ? '❌' : '✅';
        console.log(`  ${tag} ${r.start_str}→${r.end_str}  [${r.status}]  ${r.source}/${r.ota_name}  ${r.uid}  ota:${r.ota_reservation_id}  chx:${r.channex_booking_id}  créée:${r.created_paris}`);
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    // OVERBOOK-5 — TIMELINE : channex_logs CDG5 fenêtre 16→18 sept
    // ══════════════════════════════════════════════════════════════════════
    banner('OVERBOOK-5', 'Timeline channex_logs CDG5 (16→18 sept 2026)');

    const logs = await client.query(
      `SELECT event_type, direction, status, error_message,
              to_char(created_at AT TIME ZONE 'Europe/Paris','YYYY-MM-DD HH24:MI:SS') as ts_paris,
              payload
       FROM channex_logs
       WHERE property_id = $1
         AND created_at >= $2::timestamptz
         AND created_at <= $3::timestamptz
       ORDER BY created_at`,
      [PROPERTY_ID, WINDOW_START, WINDOW_END]
    );
    if (logs.rows.length === 0) {
      console.log('  ⚠️  Aucun log dans cette fenêtre');
      // Chercher la fenêtre élargie
      const allLogs = await client.query(
        `SELECT event_type, direction, status,
                to_char(created_at AT TIME ZONE 'Europe/Paris','YYYY-MM-DD HH24:MI:SS') as ts_paris
         FROM channex_logs WHERE property_id = $1
         ORDER BY created_at DESC LIMIT 20`,
        [PROPERTY_ID]
      );
      console.log(`\n  Derniers logs CDG5 (tous confondus) :`);
      allLogs.rows.forEach(l => {
        console.log(`    ${l.ts_paris}  ${l.event_type}  ${l.direction}  ${l.status}`);
      });
    } else {
      console.log(`\n  ${logs.rows.length} événement(s) :\n`);
      logs.rows.forEach(l => {
        const pl = l.payload || {};
        const payloadSummary = JSON.stringify(pl).slice(0, 120);
        const errTag = l.status === 'error' ? '❌' : '✅';
        console.log(`  ${errTag} ${l.ts_paris}  ${l.direction.padEnd(8)} ${l.event_type.padEnd(24)} ${l.status}`);
        if (l.error_message) console.log(`     ⚠️  ${l.error_message}`);
        if (pl.booking_id)    console.log(`     booking_id: ${pl.booking_id}`);
        if (pl.blocked_count !== undefined) console.log(`     blocked_count: ${pl.blocked_count}  dates_count: ${pl.dates_count}`);
        if (pl.reservation_start) console.log(`     resa: ${pl.reservation_start}→${pl.reservation_end}  ${pl.ota_name}`);
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    // OVERBOOK-6 — Push_availability CDG5 depuis réception A jusqu'à B
    // ══════════════════════════════════════════════════════════════════════
    banner('OVERBOOK-6', 'push_availability CDG5 depuis A (16 sept) jusqu\'à B (19 sept)');

    const pushLogs = await client.query(
      `SELECT event_type, direction, status, error_message,
              to_char(created_at AT TIME ZONE 'Europe/Paris','YYYY-MM-DD HH24:MI:SS') as ts_paris,
              payload
       FROM channex_logs
       WHERE property_id = $1
         AND event_type = 'push_availability'
         AND created_at >= '2026-09-15 22:00:00+00'
         AND created_at <= '2026-09-19 22:00:00+00'
       ORDER BY created_at`,
      [PROPERTY_ID]
    );
    if (pushLogs.rows.length === 0) {
      console.log('  Aucun push_availability dans cette fenêtre');
    } else {
      pushLogs.rows.forEach((l, i) => {
        const pl = l.payload || {};
        const tag = l.status === 'error' ? '❌' : '✅';
        console.log(`\n  Push #${i+1} — ${l.ts_paris}  ${tag} ${l.status}`);
        console.log(`    blocked_count: ${pl.blocked_count ?? 'N/A'}  dates_count: ${pl.dates_count ?? 'N/A'}`);
        if (l.error_message) console.log(`    ⚠️  ${l.error_message}`);
        // Payload complet pour inspection
        if (Object.keys(pl).length > 0) console.log(`    payload: ${JSON.stringify(pl)}`);
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    // OVERBOOK-7 — receive_booking logs pour A et B
    // ══════════════════════════════════════════════════════════════════════
    banner('OVERBOOK-7', 'receive_booking — logs A et B');

    const recvLogs = await client.query(
      `SELECT event_type, direction, status,
              to_char(created_at AT TIME ZONE 'Europe/Paris','YYYY-MM-DD HH24:MI:SS') as ts_paris,
              payload
       FROM channex_logs
       WHERE property_id = $1
         AND event_type = 'receive_booking'
         AND created_at >= '2026-09-15 22:00:00+00'
         AND created_at <= '2026-09-20 00:00:00+00'
       ORDER BY created_at`,
      [PROPERTY_ID]
    );
    if (recvLogs.rows.length === 0) {
      console.log('  Aucun log receive_booking dans la fenêtre');
    } else {
      recvLogs.rows.forEach((l, i) => {
        const pl = l.payload || {};
        console.log(`\n  Booking reçu #${i+1} — ${l.ts_paris}  ${l.status}`);
        console.log(`    booking_id   : ${pl.booking_id}`);
        console.log(`    ota_name     : ${pl.ota_name}`);
        console.log(`    resa_start   : ${pl.reservation_start}`);
        console.log(`    resa_end     : ${pl.reservation_end}`);
        console.log(`    room0_type_id: ${pl.room0_type_id}`);
        console.log(`    room0_checkin: ${pl.room0_checkin}`);
        console.log(`    amount_total : ${pl.amount_total}`);
        const isA = pl.booking_id === BOOKING_A_ID ? ' ← RÉSERVATION A' : '';
        const isB = pl.booking_id === BOOKING_B_ID ? ' ← RÉSERVATION B' : '';
        if (isA || isB) console.log(`    🔴 IDENTIFICATION${isA}${isB}`);
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    // OVERBOOK-8 — webhook_events CDG5 (16→19 sept)
    // ══════════════════════════════════════════════════════════════════════
    banner('OVERBOOK-8', 'webhook_events CDG5 (16→19 sept 2026)');

    let webhookCheck;
    try {
      webhookCheck = await client.query(
        `SELECT event_type, booking_id, status, error_message,
                to_char(received_at AT TIME ZONE 'Europe/Paris','YYYY-MM-DD HH24:MI:SS') as ts_paris,
                payload
         FROM webhook_events
         WHERE (property_id = $1 OR booking_id IN ($2, $3))
           AND received_at >= '2026-09-15 22:00:00+00'
           AND received_at <= '2026-09-19 22:00:00+00'
         ORDER BY received_at`,
        [CHANNEX_PROPERTY_ID, BOOKING_A_ID, BOOKING_B_ID]
      );
      if (webhookCheck.rows.length === 0) {
        console.log('  Aucun webhook_event dans la fenêtre');
        // Essai par booking_id seul, sans property_id
        const wh2 = await client.query(
          `SELECT event_type, booking_id, status,
                  to_char(received_at AT TIME ZONE 'Europe/Paris','YYYY-MM-DD HH24:MI:SS') as ts_paris
           FROM webhook_events
           WHERE booking_id IN ($1, $2)
           ORDER BY received_at`,
          [BOOKING_A_ID, BOOKING_B_ID]
        );
        if (wh2.rows.length > 0) {
          console.log('  Trouvés via booking_id seulement :');
          wh2.rows.forEach(w => {
            console.log(`    ${w.ts_paris}  ${w.event_type}  ${w.status}  booking:${w.booking_id}`);
          });
        }
      } else {
        webhookCheck.rows.forEach(w => {
          const pl = w.payload || {};
          const plSummary = JSON.stringify(pl).slice(0,100);
          console.log(`  ${w.ts_paris}  ${w.event_type}  ${w.status}  booking:${w.booking_id}`);
          if (w.error_message) console.log(`    ⚠️  ${w.error_message}`);
        });
      }
    } catch (e) {
      console.log('  Table webhook_events absente ou erreur:', e.message);
    }

    // ══════════════════════════════════════════════════════════════════════
    // OVERBOOK-9 — Mapping room_type_id dans channex_log payload A et B
    // ══════════════════════════════════════════════════════════════════════
    banner('OVERBOOK-9', 'Mapping room_type_id — A et B dans les logs');

    const roomTypeA = await client.query(
      `SELECT payload->>'room0_type_id' as room_type_id,
              payload->>'booking_id'    as booking_id,
              to_char(created_at AT TIME ZONE 'Europe/Paris','YYYY-MM-DD HH24:MI:SS') as ts_paris
       FROM channex_logs
       WHERE payload->>'booking_id' = $1
         AND event_type = 'receive_booking'
       LIMIT 3`,
      [BOOKING_A_ID]
    );
    const roomTypeB = await client.query(
      `SELECT payload->>'room0_type_id' as room_type_id,
              payload->>'booking_id'    as booking_id,
              to_char(created_at AT TIME ZONE 'Europe/Paris','YYYY-MM-DD HH24:MI:SS') as ts_paris
       FROM channex_logs
       WHERE payload->>'booking_id' = $1
         AND event_type = 'receive_booking'
       LIMIT 3`,
      [BOOKING_B_ID]
    );

    const expectedRoomType = CHANNEX_ROOM_TYPE_ID;

    console.log('\n  Booking A :');
    if (roomTypeA.rows.length === 0) {
      console.log('    room_type_id : INCONNU (log absent)  → UNKNOWN');
    } else {
      roomTypeA.rows.forEach(r => {
        const match = r.room_type_id === expectedRoomType ? '✅ EXACT' : (r.room_type_id ? '❌ MISMATCH' : '⚠️ NULL → FALLBACK');
        console.log(`    ${r.ts_paris}  room_type_id: ${r.room_type_id ?? 'NULL'}  ${match}`);
      });
    }

    console.log('\n  Booking B :');
    if (roomTypeB.rows.length === 0) {
      console.log('    room_type_id : INCONNU (log absent)  → UNKNOWN');
    } else {
      roomTypeB.rows.forEach(r => {
        const match = r.room_type_id === expectedRoomType ? '✅ EXACT' : (r.room_type_id ? '❌ MISMATCH' : '⚠️ NULL → FALLBACK');
        console.log(`    ${r.ts_paris}  room_type_id: ${r.room_type_id ?? 'NULL'}  ${match}`);
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    // OVERBOOK-10 — Calcul théorique de l'availability après A
    // ══════════════════════════════════════════════════════════════════════
    banner('OVERBOOK-10', 'Calcul availability théorique pour dates A (18→22 sept)');

    const reservationsForCalc = await client.query(
      `SELECT uid, status, source,
              to_char(start_date AT TIME ZONE 'Europe/Paris','YYYY-MM-DD') as start_str,
              to_char(end_date   AT TIME ZONE 'Europe/Paris','YYYY-MM-DD') as end_str
       FROM reservations
       WHERE property_id = $1
         AND status NOT IN ('cancelled')
         AND end_date > '2026-09-17'
         AND start_date < '2026-09-24'
       ORDER BY start_date`,
      [PROPERTY_ID]
    );

    console.log(`\n  Réservations actives qui couvrent la période sept 18→23 :`);
    const blockedDates = new Set();
    reservationsForCalc.rows.forEach(r => {
      console.log(`    ${r.uid}  ${r.source}  [${r.status}]  ${r.start_str} → ${r.end_str}`);
      // Reproduire la logique triggerChannexAvailabilitySync : [start, end)
      let d = new Date(r.start_str + 'T00:00:00');
      const end = new Date(r.end_str + 'T00:00:00');
      while (d < end) {
        blockedDates.add(d.toISOString().split('T')[0]);
        d.setDate(d.getDate() + 1);
      }
    });

    console.log(`\n  Dates bloquées calculées localement (miroir triggerChannexAvailabilitySync) :`);
    console.log(`\n  DATE         | AVAILABILITY CALCULÉE | DANS DATES A`);
    console.log(`  ${'─'.repeat(55)}`);
    const datesRelevantes = [
      '2026-09-18','2026-09-19','2026-09-20',
      '2026-09-21','2026-09-22','2026-09-23'
    ];
    datesRelevantes.forEach(d => {
      const avail = blockedDates.has(d) ? 0 : 1;
      const inA   = DATES_A.includes(d) ? '✅ Nuit A' : '(hors A)';
      const mark  = avail === 0 ? '🔴 BLOQUÉE' : '🟢 OUVERTE';
      console.log(`  ${d} | ${String(avail).padEnd(21)} ${mark.padEnd(12)} | ${inA}`);
    });

    // ══════════════════════════════════════════════════════════════════════
    // OVERBOOK-11 — iCal : URLs et syncs CDG5 dans la fenêtre
    // ══════════════════════════════════════════════════════════════════════
    banner('OVERBOOK-11', 'iCal — URLs et sync CDG5 dans la fenêtre');

    const icalLogs = await client.query(
      `SELECT event_type, direction, status,
              to_char(created_at AT TIME ZONE 'Europe/Paris','YYYY-MM-DD HH24:MI:SS') as ts_paris,
              payload
       FROM channex_logs
       WHERE property_id = $1
         AND event_type LIKE '%ical%'
         AND created_at >= '2026-09-15 22:00:00+00'
         AND created_at <= '2026-09-19 22:00:00+00'
       ORDER BY created_at`,
      [PROPERTY_ID]
    );
    if (icalLogs.rows.length === 0) {
      console.log('  Aucun événement iCal dans la fenêtre');
    } else {
      icalLogs.rows.forEach(l => {
        console.log(`  ${l.ts_paris}  ${l.event_type}  ${l.status}  ${JSON.stringify(l.payload || {}).slice(0,100)}`);
      });
    }

    // iCal dans reservations
    const icalRes = await client.query(
      `SELECT uid, status, source,
              to_char(start_date AT TIME ZONE 'Europe/Paris','YYYY-MM-DD') as start_str,
              to_char(end_date   AT TIME ZONE 'Europe/Paris','YYYY-MM-DD') as end_str,
              to_char(created_at AT TIME ZONE 'Europe/Paris','YYYY-MM-DD HH24:MI:SS') as created_paris,
              to_char(updated_at AT TIME ZONE 'Europe/Paris','YYYY-MM-DD HH24:MI:SS') as updated_paris
       FROM reservations
       WHERE property_id = $1
         AND source = 'ical'
         AND start_date >= '2026-09-01' AND end_date <= '2026-10-31'
       ORDER BY start_date`,
      [PROPERTY_ID]
    );
    if (icalRes.rows.length === 0) {
      console.log('  Aucune réservation iCal CDG5 sept–oct 2026');
    } else {
      console.log(`\n  Réservations iCal CDG5 :`);
      icalRes.rows.forEach(r => {
        console.log(`    ${r.created_paris}  ${r.uid}  [${r.status}]  ${r.start_str}→${r.end_str}  mis à jour:${r.updated_paris}`);
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    // OVERBOOK-12 — Logs tous types CDG5 pendant la fenêtre (élargie)
    // ══════════════════════════════════════════════════════════════════════
    banner('OVERBOOK-12', 'Tous logs CDG5 — fenêtre élargie 15→20 sept 2026');

    const allLogs = await client.query(
      `SELECT event_type, direction, status,
              to_char(created_at AT TIME ZONE 'Europe/Paris','YYYY-MM-DD HH24:MI:SS') as ts_paris,
              error_message,
              payload
       FROM channex_logs
       WHERE property_id = $1
         AND created_at >= '2026-09-14 22:00:00+00'
         AND created_at <= '2026-09-20 22:00:00+00'
       ORDER BY created_at`,
      [PROPERTY_ID]
    );
    if (allLogs.rows.length === 0) {
      console.log('  Aucun log dans la fenêtre élargie');
      // Last 50 logs
      const last50 = await client.query(
        `SELECT event_type, direction, status,
                to_char(created_at AT TIME ZONE 'Europe/Paris','YYYY-MM-DD HH24:MI:SS') as ts_paris
         FROM channex_logs WHERE property_id = $1
         ORDER BY created_at DESC LIMIT 30`,
        [PROPERTY_ID]
      );
      console.log(`\n  Derniers 30 logs CDG5 (toutes dates) :`);
      last50.rows.forEach(l => {
        const tag = l.status === 'error' ? '❌' : '✅';
        console.log(`    ${tag} ${l.ts_paris}  ${l.event_type.padEnd(24)}  ${l.direction}  ${l.status}`);
      });
    } else {
      console.log(`\n  ${allLogs.rows.length} événement(s) :\n`);
      allLogs.rows.forEach(l => {
        const pl = l.payload || {};
        const tag = l.status === 'error' ? '❌' : '✅';
        let detail = '';
        if (pl.booking_id)    detail += ` booking:${pl.booking_id}`;
        if (pl.blocked_count !== undefined) detail += ` blocked:${pl.blocked_count}/${pl.dates_count}`;
        if (pl.reservation_start) detail += ` resa:${pl.reservation_start}→${pl.reservation_end}`;
        if (l.error_message)  detail += ` ERR:${l.error_message.slice(0,60)}`;
        console.log(`  ${tag} ${l.ts_paris}  ${l.event_type.padEnd(24)}  ${l.direction.padEnd(8)} ${l.status}${detail}`);
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    // OVERBOOK-13 — Réservations modifiées/annulées sur CDG5 avant B
    // ══════════════════════════════════════════════════════════════════════
    banner('OVERBOOK-13', 'Historique modifications réservations CDG5 avant B');

    const resHistory = await client.query(
      `SELECT uid, status, source, ota_reservation_id, channex_booking_id,
              to_char(start_date AT TIME ZONE 'Europe/Paris','YYYY-MM-DD') as start_str,
              to_char(end_date   AT TIME ZONE 'Europe/Paris','YYYY-MM-DD') as end_str,
              to_char(created_at AT TIME ZONE 'Europe/Paris','YYYY-MM-DD HH24:MI:SS') as created_paris,
              to_char(updated_at AT TIME ZONE 'Europe/Paris','YYYY-MM-DD HH24:MI:SS') as updated_paris
       FROM reservations
       WHERE property_id = $1
         AND (
           (start_date >= '2026-09-17' AND start_date <= '2026-09-23')
           OR (end_date > '2026-09-17' AND end_date <= '2026-09-24')
         )
       ORDER BY start_date, created_at`,
      [PROPERTY_ID]
    );
    if (resHistory.rows.length === 0) {
      console.log('  Aucune réservation CDG5 sur la période 17→23 sept');
    } else {
      console.log(`  ${resHistory.rows.length} réservation(s) sur la période 17→23 sept :\n`);
      resHistory.rows.forEach(r => {
        const tag = r.status === 'cancelled' ? '❌' : '✅';
        console.log(`  ${tag} ${r.start_str}→${r.end_str}  [${r.status}]  ${r.source}  uid:${r.uid}`);
        console.log(`       ota_id:${r.ota_reservation_id}  chx:${r.channex_booking_id}  créée:${r.created_paris}  màj:${r.updated_paris}`);
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    // OVERBOOK-14 — push_availability complet (7 derniers jours)
    // ══════════════════════════════════════════════════════════════════════
    banner('OVERBOOK-14', 'push_availability CDG5 — 20 derniers (toutes dates)');

    const recentPush = await client.query(
      `SELECT event_type, status, error_message,
              to_char(created_at AT TIME ZONE 'Europe/Paris','YYYY-MM-DD HH24:MI:SS') as ts_paris,
              payload->>'blocked_count' as blocked_count,
              payload->>'dates_count'   as dates_count
       FROM channex_logs
       WHERE property_id = $1 AND event_type = 'push_availability'
       ORDER BY created_at DESC LIMIT 20`,
      [PROPERTY_ID]
    );
    if (recentPush.rows.length === 0) {
      console.log('  Aucun push_availability dans les logs CDG5');
    } else {
      console.log(`  ${recentPush.rows.length} push(s) :\n`);
      [...recentPush.rows].reverse().forEach(l => {
        const tag = l.status === 'error' ? '❌' : '✅';
        const errNote = l.error_message ? `  ⚠️ ${l.error_message.slice(0,80)}` : '';
        console.log(`  ${tag} ${l.ts_paris}  blocked:${l.blocked_count ?? '?'}  total:${l.dates_count ?? '?'}  ${l.status}${errNote}`);
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    // OVERBOOK-15 — Synthèse / Hypothèses
    // ══════════════════════════════════════════════════════════════════════
    banner('OVERBOOK-15', 'Synthèse — Hypothèses à valider');

    console.log(`
  ARCHITECTURE DE RESPONSABILITÉ (code) :
  ─────────────────────────────────────────────────────────────────────────

  Channex n'est PAS le garant de l'inventaire : c'est Boostinghost.

  Flux normal après réception d'une réservation OTA :
    Webhook Channex  →  processChannexBooking()  →  INSERT reservation
    →  bookingAcknowledge(revision_id)
    →  pushAvailability(dates_blocked = [18,19,20,21,22 sept], dates_to_update = idem)

  pushAvailability envoie availability=0 pour les dates bloquées,
  puis RELIT Channex pour vérifier (verifierBlocage).

  Si pushAvailability réussit :
    → Channex reçoit availability=0 pour 18→22 sept
    → Channex devrait bloquer ces dates sur Booking.com
    → Booking.com ne devrait plus pouvoir accepter B

  Si pushAvailability échoue (exception capturée mais non bloquante) :
    → Les dates restent ouvertes dans Channex
    → Booking.com peut continuer à accepter des réservations
    → B peut être créée

  POINT CLEF dans le code (server.js L42097) :
    } catch (availErr) {
      console.warn("⚠️ [CHANNEX SYNC] Erreur push availability (non bloquant):", availErr.message);
    }
  → L'erreur est logguée mais NE BLOQUE PAS le traitement du webhook
  → Le webhook retourne 200 même si la dispo n'a PAS été fermée

  HYPOTHÈSES À TRANCHER avec les logs :
  ─────────────────────────────────────────────────────────────────────────

  H1 — PUSH_A RATÉ
       push_availability après A a retourné une erreur (voir OVERBOOK-6 et -14)
       Si status='error' après receive_booking A → H1 CONFIRMÉE

  H2 — PUSH_A RÉUSSI MAIS DATES INCOMPLÈTES
       Le code calcule dates_blocked via start_date/end_date FROM DB.
       Si A est insérée avec start_date=2026-09-17T22:00:00Z (TIMESTAMPTZ Paris)
       → new Date(result.start_date).toISOString().substring(0,10) = "2026-09-17"
       → dates_blocked = [17,18,19,20,21 sept] (décalé d'un jour)
       → Channex bloque le 17 mais pas le 23
       → Les nuits 18→22 restent OUVERTES (sauf si le 17 suffit par coïncidence)
       ATTENTION : ce bug est CRITIQUE et INDÉPENDANT de l'hypothèse H1.

  H3 — ROOM TYPE INVENTORY > 1 DANS CHANNEX
       Si le room type 8d800c4d est configuré avec count=2 (deux unités),
       Channex autorise deux bookings simultanés même si availability=0.
       → Ce serait une configuration légitime, pas un bug BH
       → À vérifier dans l'interface Channex (non visible en DB)

  H4 — PUSH_A RÉUSSI, DATES CORRECTES, MAIS CHANNEX/BOOKING IGNORE
       Channex a accepté le push et renvoyé availability=0,
       mais Booking.com a quand même accepté B (race condition OTA)
       → B a été réservée AVANT que Channex propage la fermeture
       Distinguer par le timestamp de création de B vs le timestamp du push A.

  H5 — LOOP : un autre push_availability ultérieur a RÉOUVERT les dates
       Un cron ou action utilisateur (sync-all, pricing update, etc.)
       a appelé triggerChannexAvailabilitySync APRÈS A mais AVANT B,
       avec une DB dans laquelle A n'était pas encore committée
       → La requête SQL "status NOT IN cancelled" n'incluait pas A
       → Le push envoyait dates_blocked=[] pour ces dates
       → availability=1 renvoyé → B possible
       Distinguer : comparer timestamp de tous les push_availability
       avec le timestamp de création de la reservation A.
`);

    console.log('\n══ FIN DU DIAGNOSTIC ══════════════════════════════════════════════════\n');

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => {
  console.error('❌ Erreur fatale:', e.message);
  process.exit(1);
});
