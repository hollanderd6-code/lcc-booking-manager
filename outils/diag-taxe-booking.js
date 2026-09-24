'use strict';
// Affiche où Channex place la taxe de séjour d'une réservation Booking (lecture seule).
// Usage : CHANNEX_API_KEY=… CHANNEX_ENV=production node outils/diag-taxe-booking.js b6fa2d32-8ad9-46c5-beab-978dedd19c84
const axios = require('axios');
const id = process.argv[2];
if (!process.env.CHANNEX_API_KEY || !id) { console.error('Usage: CHANNEX_API_KEY=… node outils/diag-taxe-booking.js <channex_booking_id>'); process.exit(1); }
const base = process.env.CHANNEX_ENV === 'staging' ? 'https://staging.channex.io/api/v1' : 'https://app.channex.io/api/v1';

(async () => {
  const r = await axios.get(`${base}/bookings/${id}`, { headers: { 'user-api-key': process.env.CHANNEX_API_KEY } });
  const a = r.data?.data?.attributes || {};
  console.log('ota_name        :', a.ota_name);
  console.log('amount          :', a.amount, '| ota_commission:', a.ota_commission);
  console.log('booking.taxes   :', JSON.stringify(a.taxes ?? null, null, 2));
  console.log('booking.services:', JSON.stringify(a.services ?? null, null, 2));
  (a.rooms || []).forEach((room, i) => {
    console.log(`\nrooms[${i}].amount  :`, room.amount);
    console.log(`rooms[${i}].taxes   :`, JSON.stringify(room.taxes ?? null, null, 2));
    console.log(`rooms[${i}].services:`, JSON.stringify(room.services ?? null, null, 2));
  });
  // Toute clé contenant "tax" ailleurs dans la réponse
  const hits = [];
  (function walk(o, p) {
    if (o && typeof o === 'object') for (const k of Object.keys(o)) {
      if (/tax/i.test(k) && !/^rooms\.\d+\.taxes$|^taxes$/.test(p + k)) hits.push(`${p}${k} = ${JSON.stringify(o[k])}`);
      walk(o[k], `${p}${k}.`);
    }
  })(a, '');
  console.log('\nAutres champs "tax" :', hits.length ? '\n  ' + hits.join('\n  ') : 'aucun');
})().catch(e => { console.error('ERREUR:', e.response?.status, JSON.stringify(e.response?.data || e.message)); process.exit(1); });
