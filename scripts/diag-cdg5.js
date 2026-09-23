'use strict';
// Diagnostic lecture seule — BACKMERGE-FIX ÉTAPE 1
// Usage : DATABASE_URL=<url> node scripts/diag-cdg5.js
//
// NE MODIFIE RIEN EN BASE.

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

function fmt(v) {
  if (v == null) return 'NULL';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function row(r) {
  return [
    `uid=${r.uid}`,
    `source=${r.source}`,
    `start=${fmt(r.start_date)}`,
    `end=${fmt(r.end_date)}`,
    `ical_uid=${fmt(r.ical_uid)}`,
    `chx_booking_id=${fmt(r.channex_booking_id)}`,
    `ota_res_id=${fmt(r.ota_reservation_id)}`,
    `status=${r.status}`,
    `created=${fmt(r.created_at)}`,
    `updated=${fmt(r.updated_at)}`,
  ].join('  |  ');
}

async function main() {
  // ─── 1. Trouver CDG5 ────────────────────────────────────────────────────────
  const propRes = await pool.query(`
    SELECT id, name, internal_name, channex_enabled, channex_property_id
    FROM properties
    WHERE name ILIKE '%CDG5%' OR internal_name ILIKE '%CDG5%'
    ORDER BY name
  `);

  if (propRes.rows.length === 0) {
    console.log('❌  Aucun logement CDG5 trouvé. Vérifiez le nom exact dans la table properties.');
    return;
  }

  console.log('\n══════════════════════════════════════════════════════');
  console.log('BACKFIX-1 — Logement(s) CDG5');
  console.log('══════════════════════════════════════════════════════');
  for (const p of propRes.rows) {
    console.log(`  id=${p.id}  name=${p.name}  internal_name=${p.internal_name}  channex_enabled=${p.channex_enabled}  channex_property_id=${p.channex_property_id}`);
  }

  // ─── 2. Réservations actives CDG5 ───────────────────────────────────────────
  for (const prop of propRes.rows) {
    const resaRes = await pool.query(`
      SELECT
        uid, source, start_date, end_date,
        ical_uid, channex_booking_id, ota_reservation_id,
        status, created_at, updated_at
      FROM reservations
      WHERE property_id = $1
        AND status != 'cancelled'
      ORDER BY start_date
    `, [prop.id]);

    console.log(`\n══════════════════════════════════════════════════════`);
    console.log(`BACKFIX-1b — Réservations actives : ${prop.name} (${prop.id})`);
    console.log(`══════════════════════════════════════════════════════`);
    if (resaRes.rows.length === 0) {
      console.log('  (aucune réservation non-annulée)');
    } else {
      resaRes.rows.forEach((r, i) => console.log(`  [${i + 1}]  ${row(r)}`));
    }

    // ─── 3. Détection du cas A/B/C ───────────────────────────────────────────
    const icalRows = resaRes.rows.filter(r => r.source === 'ical');
    const chxRows  = resaRes.rows.filter(r => r.source === 'channex');

    console.log(`\n  → lignes channex : ${chxRows.length}    lignes ical : ${icalRows.length}`);

    let casDetected = 'C';
    for (const ical of icalRows) {
      const icalStart = new Date(ical.start_date);
      const icalEnd   = new Date(ical.end_date);

      // Vérifie si toutes les journées de l'iCal sont couvertes par ≥1 CHX
      let days = 0, covered = 0;
      for (let d = new Date(icalStart); d < icalEnd; d.setDate(d.getDate() + 1)) {
        days++;
        const inChx = chxRows.some(c => {
          const cs = new Date(c.start_date);
          const ce = new Date(c.end_date);
          return cs <= d && d < ce;
        });
        if (inChx) covered++;
      }

      if (days > 0 && covered === days) {
        casDetected = 'A';
        console.log(`\n  ⚠️  CAS A DÉTECTÉ — iCal entièrement redondant avec des CHX`);
        console.log(`     iCal uid=${ical.uid}  ${fmt(ical.start_date)}→${fmt(ical.end_date)}`);
        console.log(`     Toutes les ${days} journées sont couvertes par des réservations Channex`);
      } else if (days > 0 && covered > 0) {
        console.log(`\n  ⚠️  iCal partiellement couvert (${covered}/${days} jours)  uid=${ical.uid}  ${fmt(ical.start_date)}→${fmt(ical.end_date)}`);
      }
    }

    // Détecter CAS B : CHX qui se chevauchent
    for (let i = 0; i < chxRows.length; i++) {
      for (let j = i + 1; j < chxRows.length; j++) {
        const a = chxRows[i], b = chxRows[j];
        const aStart = new Date(a.start_date), aEnd = new Date(a.end_date);
        const bStart = new Date(b.start_date), bEnd = new Date(b.end_date);
        if (aStart < bEnd && aEnd > bStart) {
          casDetected = 'B';
          console.log(`\n  ⚠️  CAS B DÉTECTÉ — deux CHX se chevauchent`);
          console.log(`     CHX_1 uid=${a.uid}  ${fmt(a.start_date)}→${fmt(a.end_date)}`);
          console.log(`     CHX_2 uid=${b.uid}  ${fmt(b.start_date)}→${fmt(b.end_date)}`);
        }
      }
    }

    if (casDetected === 'C') {
      console.log(`\n  ℹ️  CAS C — aucun doublon iCal/CHX ni chevauchement CHX/CHX détecté sur ce logement`);
    }
  }

  // ─── 4. BACKFIX-8 : scan global des iCal entièrement couverts par CHX ──────
  console.log('\n══════════════════════════════════════════════════════');
  console.log('BACKFIX-8 — Scan global : lignes iCal couvertes par CHX');
  console.log('══════════════════════════════════════════════════════');

  // On fait la détection en SQL via generate_series pour être précis
  const globalRes = await pool.query(`
    WITH chx AS (
      SELECT property_id, start_date::date AS sd, end_date::date AS ed
      FROM reservations
      WHERE source = 'channex' AND status != 'cancelled'
    ),
    ical AS (
      SELECT id, uid, property_id, start_date::date AS sd, end_date::date AS ed, ical_uid, created_at
      FROM reservations
      WHERE source = 'ical' AND status != 'cancelled'
    )
    SELECT i.uid, i.property_id, i.sd, i.ed, i.ical_uid, i.created_at
    FROM ical i
    WHERE NOT EXISTS (
      SELECT 1
      FROM generate_series(i.sd, i.ed - 1, '1 day'::interval) AS g(day)
      WHERE NOT EXISTS (
        SELECT 1 FROM chx c
        WHERE c.property_id = i.property_id
          AND c.sd <= g.day::date
          AND c.ed > g.day::date
      )
    )
    ORDER BY i.property_id, i.sd
  `);

  if (globalRes.rows.length === 0) {
    console.log('  ✅  Aucune ligne iCal entièrement couverte par CHX en base.');
  } else {
    console.log(`  ⚠️  ${globalRes.rows.length} ligne(s) iCal entièrement redondante(s) avec des CHX :`);
    globalRes.rows.forEach((r, i) => {
      console.log(`  [${i + 1}]  property=${r.property_id}  uid=${r.uid}  ${fmt(r.sd)}→${fmt(r.ed)}  ical_uid=${fmt(r.ical_uid)}  created=${fmt(r.created_at)}`);
    });
  }
}

main()
  .catch(e => console.error('❌ Erreur :', e.message))
  .finally(() => pool.end());
