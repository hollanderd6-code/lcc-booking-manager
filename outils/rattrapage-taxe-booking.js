'use strict';
// Rattrapage : réservations Booking sans taxe de séjour ou avec amount_rooms = total (ménage inclus).
// Relit chaque réservation chez Channex et corrige amount_taxes / amount_rooms.
// Usage : DATABASE_URL=… CHANNEX_API_KEY=… node outils/rattrapage-taxe-booking.js [--ecrire]
const { Pool } = require('pg');
const axios = require('axios');
const ECRIRE = process.argv.includes('--ecrire');
if (!process.env.DATABASE_URL || !process.env.CHANNEX_API_KEY) {
  console.error('Usage: DATABASE_URL=… CHANNEX_API_KEY=… node outils/rattrapage-taxe-booking.js [--ecrire]'); process.exit(1);
}
const base = process.env.CHANNEX_ENV === 'staging' ? 'https://staging.channex.io/api/v1' : 'https://app.channex.io/api/v1';
const api = axios.create({ baseURL: base, headers: { 'user-api-key': process.env.CHANNEX_API_KEY }, timeout: 30000 });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const { rows } = await pool.query(`
    SELECT id, uid, guest_name, start_date, channex_booking_id,
           amount_total, amount_rooms, amount_cleaning, amount_taxes
      FROM reservations
     WHERE source = 'channex' AND channex_booking_id IS NOT NULL
       AND (ota_name ILIKE '%booking%' OR platform ILIKE '%booking%')
       AND status <> 'cancelled'
       AND start_date >= NOW() - INTERVAL '18 months'
       AND (COALESCE(amount_taxes, 0) = 0
            OR (COALESCE(amount_cleaning, 0) > 0 AND amount_rooms = amount_total))
     ORDER BY start_date`);
  console.log(`${rows.length} réservation(s) Booking à vérifier${ECRIRE ? '' : ' (lecture seule)'}\n`);

  let corr = 0, err = 0;
  for (const r of rows) {
    try {
      const a = (await api.get(`/bookings/${r.channex_booking_id}`)).data?.data?.attributes || {};
      const room = (a.rooms || [])[0] || {};
      const ct = (room.collected_taxes || []).concat(room.taxes || [])
        .find(t => /city|tourist|taxe.?s.?jour/i.test(`${t.type || ''} ${t.name || ''}`));
      const tax = ct ? r2(ct.total_price) : r2(r.amount_taxes);
      const total = r2(r.amount_total), clean = r2(r.amount_cleaning);
      const rooms = clean > 0 && r2(r.amount_rooms) === total ? r2(total - clean) : r2(r.amount_rooms);
      const change = tax !== r2(r.amount_taxes) || rooms !== r2(r.amount_rooms);
      const d = new Date(r.start_date).toISOString().slice(0, 10);
      console.log(`${change ? '✏️ ' : '· '} ${d} ${r.guest_name.padEnd(24)} taxe ${r.amount_taxes ?? '∅'} → ${tax} | nuits ${r.amount_rooms} → ${rooms} | payé ${r2(rooms + clean + tax)} €`);
      if (change) {
        corr++;
        if (ECRIRE) await pool.query(
          'UPDATE reservations SET amount_taxes = $1, amount_rooms = $2, updated_at = NOW() WHERE id = $3',
          [tax || null, rooms, r.id]);
      }
    } catch (e) {
      err++; console.log(`❌ ${r.uid} : ${e.response?.status || ''} ${e.message}`);
    }
    await sleep(200);
  }
  console.log(`\n${corr} à corriger${ECRIRE ? ' — écrit en base' : ' — relancer avec --ecrire'} | ${err} erreur(s)`);
  await pool.end();
})().catch(e => { console.error('ERREUR:', e.message); pool.end(); process.exit(1); });
