// Diagnostic — conversations sans jointure réservation
// Usage : DATABASE_URL=xxx node diag-conv-join.js
// (supprimer ce fichier une fois le diagnostic terminé)

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  // ── Q0 : total des conversations non annulées ──────────────────────────
  const total = await pool.query(`SELECT COUNT(*) FROM conversations WHERE status != 'cancelled'`);
  console.log('\n=== Q0 : total conversations actives ===');
  console.log('total :', total.rows[0].count);

  // ── Q1 : échantillon de 20 conversations sans jointure ─────────────────
  const sample = await pool.query(`
    SELECT c.id, c.guest_name, c.property_id, c.reservation_start_date,
           c.platform, c.created_at::date AS created, c.status,
           c.reservation_uid
    FROM conversations c
    WHERE c.status != 'cancelled'
      AND NOT EXISTS (
        SELECT 1 FROM reservations r
        WHERE (
          (c.channex_booking_id IS NOT NULL AND r.channex_booking_id = c.channex_booking_id)
          OR (c.channex_booking_id IS NULL
              AND r.property_id = c.property_id
              AND DATE(r.start_date) = DATE(c.reservation_start_date))
        )
      )
    ORDER BY c.created_at DESC
    LIMIT 20
  `);
  console.log('\n=== Q1 : 20 conversations sans jointure (les plus récentes) ===');
  console.table(sample.rows);

  // ── Q2 : distribution par platform et par année ───────────────────────
  const dist = await pool.query(`
    SELECT
      EXTRACT(YEAR FROM c.created_at)::int AS annee,
      COALESCE(c.platform, 'null') AS platform,
      COUNT(*) AS n
    FROM conversations c
    WHERE c.status != 'cancelled'
      AND NOT EXISTS (
        SELECT 1 FROM reservations r
        WHERE (
          (c.channex_booking_id IS NOT NULL AND r.channex_booking_id = c.channex_booking_id)
          OR (c.channex_booking_id IS NULL
              AND r.property_id = c.property_id
              AND DATE(r.start_date) = DATE(c.reservation_start_date))
        )
      )
    GROUP BY 1, 2 ORDER BY 1 DESC, 3 DESC
  `);
  console.log('\n=== Q2 : distribution par année/plateforme ===');
  console.table(dist.rows);

  // ── Q3 : réservation proche (± 3 jours) pour les 5 premiers ──────────
  console.log('\n=== Q3 : réservation proche (±3 j) pour les 5 premières ===');
  const five = sample.rows.slice(0, 5);
  for (const c of five) {
    const near = await pool.query(`
      SELECT r.uid, r.property_id, r.start_date::date, r.end_date::date,
             r.source, r.status,
             (DATE(r.start_date) - DATE($2)) AS delta_days
      FROM reservations r
      WHERE r.property_id = $1
        AND ABS(DATE(r.start_date) - DATE($2)) <= 3
      ORDER BY ABS(DATE(r.start_date) - DATE($2))
      LIMIT 5
    `, [c.property_id, c.reservation_start_date]);
    console.log(`\nconv ${c.id} | guest: ${c.guest_name} | start: ${c.reservation_start_date} | property: ${c.property_id}`);
    if (near.rows.length === 0) {
      console.log('  → aucune réservation dans ±3 jours sur ce logement');
    } else {
      console.table(near.rows);
    }
  }

  // ── Q4 : conversations avec reservation_uid rempli mais JOIN raté ──────
  const withUid = await pool.query(`
    SELECT COUNT(*) AS avec_uid,
           COUNT(*) FILTER (WHERE reservation_uid IS NULL) AS sans_uid
    FROM conversations
    WHERE status != 'cancelled'
      AND NOT EXISTS (
        SELECT 1 FROM reservations r
        WHERE (
          (conversations.channex_booking_id IS NOT NULL AND r.channex_booking_id = conversations.channex_booking_id)
          OR (conversations.channex_booking_id IS NULL
              AND r.property_id = conversations.property_id
              AND DATE(r.start_date) = DATE(conversations.reservation_start_date))
        )
      )
  `);
  console.log('\n=== Q4 : parmi les 211 — combien ont reservation_uid rempli ? ===');
  console.table(withUid.rows);

  // ── Q5 : parmi ceux avec reservation_uid — la résa existe-t-elle ? ────
  const uidMatch = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM reservations r WHERE r.uid = c.reservation_uid)) AS uid_trouve,
      COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM reservations r WHERE r.uid = c.reservation_uid)) AS uid_introuvable
    FROM conversations c
    WHERE c.status != 'cancelled'
      AND c.reservation_uid IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM reservations r2
        WHERE (
          (c.channex_booking_id IS NOT NULL AND r2.channex_booking_id = c.channex_booking_id)
          OR (c.channex_booking_id IS NULL
              AND r2.property_id = c.property_id
              AND DATE(r2.start_date) = DATE(c.reservation_start_date))
        )
      )
  `);
  console.log('\n=== Q5 : pour ceux qui ont reservation_uid — la résa existe ? ===');
  console.table(uidMatch.rows);

  pool.end();
}

run().catch(e => { console.error(e); pool.end(); });
