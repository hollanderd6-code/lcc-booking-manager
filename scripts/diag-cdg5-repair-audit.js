'use strict';
/**
 * CDG5-REPAIR-AUDIT — Diagnostic READ-ONLY avant correction production
 *
 * Usage :
 *   DATABASE_URL=<url> node scripts/diag-cdg5-repair-audit.js
 *   DATABASE_URL=<url> CHANNEX_API_KEY=<key> node scripts/diag-cdg5-repair-audit.js
 *
 * NE MODIFIE RIEN EN BASE. Lecture seule.
 */

const { Pool } = require('pg');
const https    = require('https');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const CHANNEX_API_KEY = process.env.CHANNEX_API_KEY || null;
const CHANNEX_BASE    = process.env.CHANNEX_ENV === 'production'
  ? 'https://app.channex.io/api/v1'
  : 'https://staging.channex.io/api/v1';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(v) {
  if (v == null) return 'NULL';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function sep(title = '') {
  console.log(`\n${'═'.repeat(60)}`);
  if (title) console.log(title);
  console.log('═'.repeat(60));
}

function sub(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 54 - title.length))}`);
}

function channexGet(path) {
  return new Promise((resolve, reject) => {
    if (!CHANNEX_API_KEY) return resolve(null);
    const url = `${CHANNEX_BASE}${path}`;
    const req = https.get(url, {
      headers: { 'user-api-key': CHANNEX_API_KEY, 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {

  sep('CDG5-REPAIR-AUDIT — Diagnostic production READ-ONLY');
  console.log('Aucune écriture. Aucun UPDATE/DELETE/INSERT.');

  // ── CDG5FIX-1 : Identifier CDG5 ───────────────────────────────────────────
  sep('CDG5FIX-1 — Identification propriété CDG5');

  const propRes = await pool.query(`
    SELECT id, name, internal_name, channex_enabled,
           channex_property_id, channex_room_type_id
    FROM properties
    WHERE name ILIKE '%CDG5%' OR internal_name ILIKE '%CDG5%'
    ORDER BY name
  `);

  if (propRes.rows.length === 0) {
    console.log('❌  Aucune propriété CDG5 trouvée. Vérifiez le nom exact.');
    await pool.end(); return;
  }

  const prop = propRes.rows[0];
  console.log(`  property.id              : ${prop.id}`);
  console.log(`  property.name            : ${prop.name}`);
  console.log(`  channex_property_id      : ${fmt(prop.channex_property_id)}`);
  console.log(`  channex_room_type_id     : ${fmt(prop.channex_room_type_id)}`);
  if (propRes.rows.length > 1) {
    console.log(`  ⚠️  ${propRes.rows.length} propriétés CDG5 trouvées — utilisation de la première.`);
  }

  // ── CDG5FIX-2/3/4/5/6 : Réservations Channex ─────────────────────────────
  sep('CDG5FIX-2 à 6 — Réservations Channex CDG5 actives');

  const resaRes = await pool.query(`
    SELECT
      id, uid, property_id, source, status,
      start_date::date AS start_date,
      end_date::date   AS end_date,
      channex_booking_id,
      channex_revision_id,
      ota_reservation_id,
      ota_name,
      created_at,
      updated_at,
      days_breakdown,
      amount_total,
      amount_rooms,
      amount_cleaning,
      amount_taxes
    FROM reservations
    WHERE property_id = $1
      AND source = 'channex'
      AND status != 'cancelled'
    ORDER BY start_date
  `, [prop.id]);

  if (resaRes.rows.length === 0) {
    console.log('  (aucune réservation Channex non-annulée)');
  }

  let suspectRow = null;

  for (const r of resaRes.rows) {
    const startDate = new Date(r.start_date);
    const endDate   = new Date(r.end_date);
    const spanDays  = Math.round((endDate - startDate) / 86400000);

    let breakdown = {};
    try {
      breakdown = (typeof r.days_breakdown === 'string')
        ? JSON.parse(r.days_breakdown)
        : (r.days_breakdown || {});
    } catch (_) {}

    const breakdownKeys = Object.keys(breakdown).sort();
    const breakdownDays = breakdownKeys.length;
    const bFirst = breakdownKeys[0]  || 'N/A';
    const bLast  = breakdownKeys[breakdownKeys.length - 1] || 'N/A';

    // candidate dates dérivées du days_breakdown
    let candidateStart = null;
    let candidateEnd   = null;
    if (breakdownDays > 0) {
      candidateStart = bFirst;
      const lastDay   = new Date(bLast);
      lastDay.setDate(lastDay.getDate() + 1);
      candidateEnd   = lastDay.toISOString().slice(0, 10);
    }

    const isSuspect = breakdownDays > 0 && breakdownDays < spanDays;

    console.log(`\n  ┌─ uid=${r.uid}`);
    console.log(`  │  ota_name              : ${fmt(r.ota_name)}`);
    console.log(`  │  channex_booking_id    : ${fmt(r.channex_booking_id)}`);
    console.log(`  │  channex_revision_id   : ${fmt(r.channex_revision_id)}`);
    console.log(`  │  ota_reservation_id    : ${fmt(r.ota_reservation_id)}`);
    console.log(`  │  status                : ${r.status}`);
    console.log(`  │  start_date (DB)       : ${fmt(r.start_date)}`);
    console.log(`  │  end_date (DB)         : ${fmt(r.end_date)}`);
    console.log(`  │  span_days             : ${spanDays}`);
    console.log(`  │  breakdown_days        : ${breakdownDays}`);
    console.log(`  │  breakdown first/last  : ${bFirst} → ${bLast}`);
    console.log(`  │  candidate_start       : ${candidateStart || 'N/A'}`);
    console.log(`  │  candidate_end         : ${candidateEnd   || 'N/A'}`);
    console.log(`  │  amount_total          : ${fmt(r.amount_total)}`);
    console.log(`  │  amount_rooms          : ${fmt(r.amount_rooms)}`);
    console.log(`  │  amount_cleaning       : ${fmt(r.amount_cleaning)}`);
    console.log(`  │  amount_taxes          : ${fmt(r.amount_taxes)}`);
    console.log(`  │  created_at            : ${fmt(r.created_at)}`);
    console.log(`  │  updated_at            : ${fmt(r.updated_at)}`);
    const deltaMin = r.updated_at
      ? Math.round((new Date(r.updated_at) - new Date(r.created_at)) / 60000)
      : 0;
    console.log(`  │  created→updated (min) : ${deltaMin}`);

    if (isSuspect) {
      console.log(`  └─ ⚠️  SUSPECT_CDG5 — span_days=${spanDays} > breakdown_days=${breakdownDays}`);
      console.log(`     CURRENT  : ${fmt(r.start_date)} → ${fmt(r.end_date)}`);
      console.log(`     CANDIDATE: ${candidateStart} → ${candidateEnd}`);
      suspectRow = { ...r, spanDays, breakdownDays, bFirst, bLast, candidateStart, candidateEnd };
    } else {
      console.log(`  └─ ✅ cohérent (span=${spanDays} == breakdown=${breakdownDays})`);
    }
  }

  if (!suspectRow) {
    console.log('\n  ℹ️  Aucune réservation SUSPECT_CDG5 détectée parmi les lignes Channex actives.');
    console.log('  (Le bug est peut-être sur une ligne annulée, ou déjà corrigé, ou la propriété a un autre nom.)');
  }

  // ── CDG5FIX-7/8 : Réservations adjacentes ────────────────────────────────
  sep('CDG5FIX-7/8 — Réservations adjacentes (toutes sources)');

  const adjacentRes = await pool.query(`
    SELECT id, uid, source, status,
           start_date::date, end_date::date,
           channex_booking_id, ota_reservation_id
    FROM reservations
    WHERE property_id = $1
      AND status != 'cancelled'
    ORDER BY start_date
  `, [prop.id]);

  for (const r of adjacentRes.rows) {
    console.log(`  uid=${r.uid}  source=${r.source}  ${fmt(r.start_date)}→${fmt(r.end_date)}  status=${r.status}`);
  }

  if (suspectRow) {
    const candEnd = suspectRow.candidateEnd;
    const adjacent = adjacentRes.rows.find(r =>
      fmt(r.start_date) === candEnd &&
      r.uid !== suspectRow.uid
    );
    if (adjacent) {
      console.log(`\n  ✅ ADJACENCY_CONSISTENT = true`);
      console.log(`     Réservation ${adjacent.uid} commence le ${candEnd} — correspond exactement à candidate_end.`);
      console.log(`     Schéma : ${suspectRow.candidateStart}→${candEnd}  +  ${fmt(adjacent.start_date)}→${fmt(adjacent.end_date)}`);
    } else {
      console.log(`\n  ℹ️  ADJACENCY_CONSISTENT = inconnu/false — pas de réservation débutant exactement à ${candEnd}`);
    }
  }

  // ── CDG5FIX-9/10/11/12 : API Channex ─────────────────────────────────────
  sep('CDG5FIX-9 à 12 — API Channex');

  if (!CHANNEX_API_KEY) {
    console.log('  CHANNEX_API = NON DISPONIBLE (CHANNEX_API_KEY absent)');
    console.log('  Relancer avec : DATABASE_URL=<url> CHANNEX_API_KEY=<key> node scripts/diag-cdg5-repair-audit.js');
  } else if (suspectRow && suspectRow.channex_booking_id) {
    console.log(`  Fetching /bookings/${suspectRow.channex_booking_id} ...`);
    const chxData = await channexGet(`/bookings/${suspectRow.channex_booking_id}`);
    if (!chxData || !chxData.data) {
      console.log('  ❌  Aucune donnée retournée par Channex API.');
    } else {
      const attrs = chxData.data.attributes || chxData.data;
      console.log(`  booking_id      : ${fmt(attrs.booking_id || chxData.data.id)}`);
      console.log(`  revision_id     : ${fmt(attrs.revision_id)}`);
      console.log(`  arrival_date    : ${fmt(attrs.arrival_date)}`);
      console.log(`  departure_date  : ${fmt(attrs.departure_date)}`);
      const rooms = attrs.rooms || [];
      console.log(`  rooms_count     : ${rooms.length}`);
      rooms.forEach((rm, i) => {
        const daysCount = Object.keys(rm.days || {}).length;
        console.log(`\n  Room[${i}]:`);
        console.log(`    room_type_id   : ${fmt(rm.room_type_id)}`);
        console.log(`    booking_room_id: ${fmt(rm.booking_room_id)}`);
        console.log(`    ota_unique_id  : ${fmt(rm.ota_unique_id)}`);
        console.log(`    checkin_date   : ${fmt(rm.checkin_date)}`);
        console.log(`    checkout_date  : ${fmt(rm.checkout_date)}`);
        console.log(`    days_count     : ${daysCount}`);

        if (rm.room_type_id === prop.channex_room_type_id) {
          console.log(`    → MATCHED_ROOM CDG5`);
          if (suspectRow) {
            const roomDateMatch =
              rm.checkin_date  === suspectRow.candidateStart &&
              rm.checkout_date === suspectRow.candidateEnd;
            console.log(`    ROOM_DATES_CONFIRMED = ${roomDateMatch}`);
            if (roomDateMatch) {
              console.log(`    ✅ checkin=${rm.checkin_date} / checkout=${rm.checkout_date} == candidate DB`);
            } else {
              console.log(`    ⚠️  checkin=${rm.checkin_date} / checkout=${rm.checkout_date}`);
              console.log(`    ⚠️  candidate DB : ${suspectRow.candidateStart} → ${suspectRow.candidateEnd}`);
            }
          }
        }
      });
    }
  } else {
    console.log('  (pas de SUSPECT_CDG5 identifié — skip API Channex)');
  }

  // ── CDG5FIX-13/14 : Conversation ─────────────────────────────────────────
  sep('CDG5FIX-13/14 — Conversation');

  if (suspectRow) {
    const convRes = await pool.query(`
      SELECT id, channex_booking_id,
             reservation_start_date::date AS res_start,
             reservation_end_date::date   AS res_end,
             status
      FROM conversations
      WHERE channex_booking_id = $1
         OR reservation_uid = $2
      ORDER BY created_at DESC
      LIMIT 5
    `, [suspectRow.channex_booking_id, suspectRow.uid]);

    if (convRes.rows.length === 0) {
      console.log('  Aucune conversation trouvée pour ce booking_id / uid.');
    }
    for (const c of convRes.rows) {
      const needsRepair =
        fmt(c.res_end) !== suspectRow.candidateEnd &&
        fmt(c.res_end) === fmt(suspectRow.end_date);
      console.log(`  conv.id                    : ${c.id}`);
      console.log(`  channex_booking_id         : ${fmt(c.channex_booking_id)}`);
      console.log(`  reservation_start_date     : ${fmt(c.res_start)}`);
      console.log(`  reservation_end_date       : ${fmt(c.res_end)}`);
      console.log(`  status                     : ${c.status}`);
      console.log(`  CONVERSATION_REPAIR_REQUIRED: ${needsRepair}`);
    }
  } else {
    console.log('  (pas de SUSPECT_CDG5 — skip)');
  }

  // ── CDG5FIX-15 : Ménage ──────────────────────────────────────────────────
  sep('CDG5FIX-15 — Tâches ménage');

  if (suspectRow) {
    // Tente plusieurs noms de tables ménage communs
    for (const tbl of ['cleaning_tasks', 'cleaning_schedules', 'tasks']) {
      const exists = await pool.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_name = $1
        )
      `, [tbl]);
      if (!exists.rows[0].exists) continue;

      // On tente de trouver des colonnes communes
      const colRes = await pool.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = $1
      `, [tbl]);
      const cols = colRes.rows.map(r => r.column_name);

      const refCol = cols.find(c => ['reservation_id', 'reservation_uid', 'reservation_uid_ref', 'uid'].includes(c));
      const dateCol = cols.find(c => ['scheduled_date', 'due_date', 'checkout_date', 'date'].includes(c));
      const statusCol = cols.find(c => c === 'status');

      if (!refCol) { console.log(`  Table ${tbl} : pas de colonne de référence réservation connue.`); continue; }

      const q = `SELECT id, ${refCol}${dateCol ? ', ' + dateCol : ''}${statusCol ? ', status' : ''} FROM ${tbl} WHERE ${refCol} = $1 OR ${refCol} = $2`;
      const ctRes = await pool.query(q, [suspectRow.uid, suspectRow.id]);
      if (ctRes.rows.length === 0) {
        console.log(`  Table ${tbl} : aucune tâche liée à uid=${suspectRow.uid}`);
      } else {
        for (const ct of ctRes.rows) {
          const badDate = dateCol && ct[dateCol] && fmt(ct[dateCol]) === fmt(suspectRow.end_date);
          console.log(`  Table ${tbl} : id=${ct.id}  ref=${ct[refCol]}  date=${dateCol ? fmt(ct[dateCol]) : 'N/A'}  status=${ct.status || 'N/A'}  BAD_DATE=${badDate}`);
        }
      }
    }

    // Chercher aussi dans cleaning_tasks par channex_booking_id si colonne présente
    const ctDirect = await pool.query(`
      SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cleaning_tasks')
    `);
    if (ctDirect.rows[0].exists) {
      const ctCols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'cleaning_tasks'`);
      const hasBid = ctCols.rows.some(r => r.column_name === 'channex_booking_id');
      if (hasBid) {
        const r2 = await pool.query(
          `SELECT id, channex_booking_id, scheduled_date, status FROM cleaning_tasks WHERE channex_booking_id = $1`,
          [suspectRow.channex_booking_id]
        );
        r2.rows.forEach(ct => console.log(`  cleaning_tasks via booking_id: id=${ct.id} date=${fmt(ct.scheduled_date)} status=${ct.status}`));
      }
    }
  } else {
    console.log('  (pas de SUSPECT_CDG5 — skip)');
  }

  // ── CDG5FIX-16 : Factures ────────────────────────────────────────────────
  sep('CDG5FIX-16 — Factures');

  if (suspectRow) {
    for (const tbl of ['invoices', 'invoice_requests', 'invoice_download_tokens']) {
      const ex = await pool.query(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1)`, [tbl]);
      if (!ex.rows[0].exists) continue;

      const cols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [tbl])).rows.map(r => r.column_name);
      const refCol = cols.find(c => ['reservation_id', 'reservation_uid', 'uid'].includes(c));
      const numCol = cols.find(c => ['invoice_number', 'number', 'reference'].includes(c));

      if (!refCol) continue;
      const q = `SELECT id${numCol ? ', ' + numCol : ''}, ${refCol} FROM ${tbl} WHERE ${refCol} = $1 OR ${refCol} = $2 LIMIT 10`;
      const invRes = await pool.query(q, [suspectRow.uid, String(suspectRow.id)]);
      if (invRes.rows.length > 0) {
        invRes.rows.forEach(inv =>
          console.log(`  Table ${tbl}: INVOICE_EXISTS=true  id=${inv.id}  ${numCol ? 'number=' + inv[numCol] : ''}  ref=${inv[refCol]}`)
        );
      } else {
        console.log(`  Table ${tbl}: INVOICE_EXISTS=false`);
      }
    }
  } else {
    console.log('  (pas de SUSPECT_CDG5 — skip)');
  }

  // ── CDG5FIX-17 : Messages futurs ─────────────────────────────────────────
  sep('CDG5FIX-17 — Messages automatiques futurs');

  if (suspectRow) {
    for (const tbl of ['message_schedules', 'scheduled_messages', 'auto_messages', 'message_logs']) {
      const ex = await pool.query(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1)`, [tbl]);
      if (!ex.rows[0].exists) continue;

      const cols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [tbl])).rows.map(r => r.column_name);
      const refCol = cols.find(c => ['reservation_id', 'reservation_uid', 'uid', 'channex_booking_id'].includes(c));
      const schedCol = cols.find(c => ['scheduled_at', 'scheduled_date', 'send_at'].includes(c));
      const statusCol = cols.find(c => c === 'status');
      const typeCol = cols.find(c => ['type', 'template_type', 'message_type'].includes(c));

      if (!refCol) continue;
      const q = `SELECT id${typeCol ? ', ' + typeCol : ''}${schedCol ? ', ' + schedCol : ''}${statusCol ? ', status' : ''},${refCol} FROM ${tbl} WHERE ${refCol} = $1 OR ${refCol} = $2`;
      const msgRes = await pool.query(q, [suspectRow.uid, suspectRow.channex_booking_id]);
      if (msgRes.rows.length > 0) {
        msgRes.rows.forEach(m =>
          console.log(`  Table ${tbl}: id=${m.id}  type=${m[typeCol]||'?'}  sched=${schedCol ? fmt(m[schedCol]) : 'N/A'}  status=${m.status||'?'}  ref=${m[refCol]}`)
        );
      } else {
        console.log(`  Table ${tbl}: aucun message lié`);
      }
    }
  } else {
    console.log('  (pas de SUSPECT_CDG5 — skip)');
  }

  // ── CDG5FIX-18 : Autres tables dépendantes ───────────────────────────────
  sep('CDG5FIX-18 — Autres tables dépendantes');

  if (suspectRow) {
    const tablesToCheck = [
      { table: 'deposit_requests',   refCols: ['reservation_id', 'reservation_uid'] },
      { table: 'deposit_schedules',  refCols: ['reservation_id', 'reservation_uid'] },
      { table: 'cautions',           refCols: ['reservation_id', 'reservation_uid', 'uid'] },
      { table: 'stripe_sessions',    refCols: ['reservation_uid', 'reservation_id'] },
      { table: 'contracts',          refCols: ['reservation_id', 'reservation_uid'] },
      { table: 'access_codes',       refCols: ['reservation_id', 'reservation_uid'] },
      { table: 'webhook_events',     refCols: ['booking_id'] },
      { table: 'channex_logs',       refCols: ['payload'] },
    ];

    for (const { table, refCols } of tablesToCheck) {
      const ex = await pool.query(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1)`, [table]);
      if (!ex.rows[0].exists) { console.log(`  ${table}: table inexistante`); continue; }

      const cols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [table])).rows.map(r => r.column_name);

      if (table === 'webhook_events') {
        const wr = await pool.query(
          `SELECT id, booking_id, event_type, received_at, status FROM webhook_events WHERE booking_id = $1 ORDER BY received_at`,
          [suspectRow.channex_booking_id]
        );
        if (wr.rows.length === 0) {
          console.log(`  webhook_events: aucun event pour booking_id=${suspectRow.channex_booking_id}`);
        } else {
          wr.rows.forEach(w => console.log(`  webhook_events: id=${w.id}  event=${w.event_type}  received=${fmt(w.received_at)}  status=${w.status}`));
        }
        continue;
      }

      if (table === 'channex_logs') {
        const lr = await pool.query(
          `SELECT id, event_type, created_at, payload->>'booking_id' AS bid FROM channex_logs WHERE payload->>'booking_id' = $1 ORDER BY created_at`,
          [suspectRow.channex_booking_id]
        );
        if (lr.rows.length === 0) {
          console.log(`  channex_logs: aucun log pour booking_id=${suspectRow.channex_booking_id}`);
        } else {
          lr.rows.forEach(l => console.log(`  channex_logs: id=${l.id}  event=${l.event_type}  date=${fmt(l.created_at)}`));
        }
        continue;
      }

      const refCol = refCols.find(c => cols.includes(c));
      if (!refCol) { console.log(`  ${table}: MATCH_FOUND=NON (pas de colonne de référence connue)`); continue; }

      const hasStartDate = cols.includes('start_date') || cols.includes('reservation_start_date');
      const hasEndDate   = cols.includes('end_date')   || cols.includes('reservation_end_date');

      const q = `SELECT id, ${refCol}${hasStartDate ? ', COALESCE(start_date, reservation_start_date) AS sd' : ''}${hasEndDate ? ', COALESCE(end_date, reservation_end_date) AS ed' : ''} FROM ${table} WHERE ${refCol} = $1 OR ${refCol} = $2 LIMIT 5`;
      try {
        const tr = await pool.query(q, [suspectRow.uid, String(suspectRow.id)]);
        if (tr.rows.length === 0) {
          console.log(`  ${table}: MATCH_FOUND=NON`);
        } else {
          tr.rows.forEach(row => {
            const datesCopied = hasStartDate && hasEndDate;
            const needsRepair = datesCopied && row.ed && fmt(row.ed) === fmt(suspectRow.end_date);
            console.log(`  ${table}: MATCH_FOUND=OUI  id=${row.id}  ref=${row[refCol]}  DATES_COPIED=${datesCopied}  NEEDS_REPAIR=${needsRepair ? 'OUI' : 'NON'}`);
          });
        }
      } catch (_) {
        console.log(`  ${table}: erreur requête (colonnes incompatibles — vérification manuelle requise)`);
      }
    }
  } else {
    console.log('  (pas de SUSPECT_CDG5 — skip)');
  }

  // ── CDG5FIX-19/20 : Plan SQL ─────────────────────────────────────────────
  sep('CDG5FIX-19/20 — Correction recommandée et plan SQL (NON EXÉCUTÉ)');

  if (!suspectRow) {
    console.log('  Aucune réservation SUSPECT_CDG5 identifiée — aucun plan généré.');
  } else {
    console.log(`\n  CORRECTION RECOMMANDÉE :`);
    console.log(`  reservations.start_date : ${fmt(suspectRow.start_date)}  →  ${suspectRow.candidateStart} (inchangé si identique)`);
    console.log(`  reservations.end_date   : ${fmt(suspectRow.end_date)}  →  ${suspectRow.candidateEnd}`);
    console.log(`\n  ⚠️  Exécuter UNIQUEMENT si ROOM_DATES_CONFIRMED=true ou ADJACENCY_CONSISTENT=true.`);
    console.log(`\n  PLAN SQL TRANSACTIONNEL (NE PAS EXÉCUTER ICI) :\n`);
    console.log(`BEGIN;`);
    console.log(``);
    console.log(`-- 1. Vérification discriminante — la réservation doit correspondre exactement.`);
    console.log(`--    Si cette query retourne 0 ligne, ROLLBACK immédiat.`);
    console.log(`SELECT id, uid, channex_booking_id, start_date::date, end_date::date`);
    console.log(`FROM reservations`);
    console.log(`WHERE id = ${suspectRow.id}`);
    console.log(`  AND uid = '${suspectRow.uid}'`);
    console.log(`  AND channex_booking_id = '${suspectRow.channex_booking_id}'`);
    console.log(`  AND start_date::date = '${fmt(suspectRow.start_date)}'`);
    console.log(`  AND end_date::date   = '${fmt(suspectRow.end_date)}'`);
    console.log(`FOR UPDATE;`);
    console.log(``);
    console.log(`-- 2. Correction de la réservation.`);
    console.log(`UPDATE reservations`);
    console.log(`SET end_date   = '${suspectRow.candidateEnd}',`);
    console.log(`    updated_at = NOW()`);
    console.log(`WHERE id                 = ${suspectRow.id}`);
    console.log(`  AND uid                = '${suspectRow.uid}'`);
    console.log(`  AND channex_booking_id = '${suspectRow.channex_booking_id}'`);
    console.log(`  AND start_date::date   = '${fmt(suspectRow.start_date)}'`);
    console.log(`  AND end_date::date     = '${fmt(suspectRow.end_date)}';`);
    console.log(`-- Attend 1 ligne modifiée. Si 0 → ROLLBACK.`);
    console.log(``);
    console.log(`-- 3. Correction conversation si CONVERSATION_REPAIR_REQUIRED=true.`);
    console.log(`--    Décommenter seulement si confirmé à l'étape CDG5FIX-14.`);
    console.log(`-- UPDATE conversations`);
    console.log(`-- SET reservation_end_date = '${suspectRow.candidateEnd}',`);
    console.log(`--     updated_at = NOW()`);
    console.log(`-- WHERE channex_booking_id = '${suspectRow.channex_booking_id}'`);
    console.log(`--   AND reservation_end_date::date = '${fmt(suspectRow.end_date)}';`);
    console.log(``);
    console.log(`-- 4. Vérification post-update.`);
    console.log(`SELECT id, uid, start_date::date, end_date::date, updated_at`);
    console.log(`FROM reservations`);
    console.log(`WHERE id = ${suspectRow.id};`);
    console.log(``);
    console.log(`ROLLBACK; -- Pour cette étape d'audit. Remplacer par COMMIT; lors de l'exécution réelle.`);
  }

  // ── Bilan final ───────────────────────────────────────────────────────────
  sep('BILAN — CDG5FIX-21 à 23');
  console.log('  CDG5FIX-21 — Écritures DB effectuées : NON ✅');
  console.log('  CDG5FIX-22 — Commit                  : NON ✅');
  console.log('  CDG5FIX-23 — Push                    : NON ✅');

  if (suspectRow) {
    console.log('\n  CONCLUSION :');
    if (CHANNEX_API_KEY) {
      console.log('  → Vérifiez ROOM_DATES_CONFIRMED dans le rapport ci-dessus.');
      console.log('  → Si true : REPAIR-A');
      console.log('  → Si false mais ADJACENCY_CONSISTENT=true : REPAIR-B');
    } else {
      console.log('  → CHANNEX_API_KEY absent. Vérifiez ADJACENCY_CONSISTENT dans le rapport.');
      console.log('  → Si ADJACENCY_CONSISTENT=true : REPAIR-B');
      console.log('  → Sinon : REPAIR-C (données insuffisantes)');
      console.log('  → Conseil : relancer avec CHANNEX_API_KEY pour REPAIR-A.');
    }
  } else {
    console.log('\n  CONCLUSION : REPAIR-C — SUSPECT_CDG5 non trouvé parmi les lignes actives.');
    console.log('  Vérifiez les lignes annulées ou utilisez le nom exact de la propriété.');
  }
}

main()
  .catch(e => { console.error('❌ Erreur fatale :', e.message); process.exit(1); })
  .finally(() => pool.end());
