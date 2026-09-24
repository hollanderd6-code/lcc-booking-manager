'use strict';
// Regénère une facture OTA déjà émise, même numéro, au montant réellement payé + tampon ACQUITTÉE.
// Prérequis : utils/invoice-amounts.js en place + patch utils/invoice-pdf.js appliqué.
// Usage : DATABASE_URL="postgres://..." node outils/regen-facture-acquittee.js FACT-2026-0100 [--ecrire]
//   sans --ecrire : affiche seulement les montants (lecture seule)
//   avec --ecrire : met à jour les métadonnées du lien de téléchargement + génère ./output/<num>.pdf

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { generateInvoicePdf } = require('../utils/invoice-pdf');
const { computeInvoiceAmounts, isOtaReservation } = require('../utils/invoice-amounts');
const { resolveOwnerClientId } = require('../utils/owner-utils');

const num = process.argv[2];
const ECRIRE = process.argv.includes('--ecrire');
// --taxe=28.17 : force la taxe de séjour si elle n'a pas été enregistrée à la réception
const TAXE = (process.argv.find(a => a.startsWith('--taxe=')) || '').split('=')[1];
if (!process.env.DATABASE_URL || !num) {
  console.error('Usage: DATABASE_URL=… node outils/regen-facture-acquittee.js FACT-YYYY-NNNN [--ecrire]');
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const day = (d) => d ? new Date(d).toISOString().slice(0, 10) : null;

(async () => {
  const tok = (await pool.query(
    `SELECT id, file_path, user_id FROM invoice_download_tokens
      WHERE invoice_number = $1 ORDER BY created_at DESC LIMIT 1`, [num])).rows[0];
  if (!tok) throw new Error(`${num} introuvable dans invoice_download_tokens`);
  let meta = {}; try { meta = JSON.parse(tok.file_path || '{}'); } catch (e) {}

  // Retrouver la réservation : uid si présent, sinon logement + dates + nom
  const q = await pool.query(
    `SELECT r.* FROM reservations r
      LEFT JOIN properties p ON p.id = r.property_id
      WHERE ($1::text IS NOT NULL AND r.uid = $1)
         OR (r.start_date::date = $2::date AND r.end_date::date = $3::date
             AND (r.property_id::text = $4 OR p.name = $5)
             AND r.guest_name ILIKE $6)
      ORDER BY (r.status = 'cancelled') ASC, r.updated_at DESC LIMIT 2`,
    [meta.reservationUid || meta.uid || null, day(meta.checkinDate), day(meta.checkoutDate),
     meta.propertyId ? String(meta.propertyId) : null, meta.propertyName || null,
     `%${(meta.clientName || '').trim()}%`]);
  if (!q.rows.length) throw new Error('Réservation introuvable — vérifier meta : ' + JSON.stringify(meta));
  if (q.rows.length > 1 && !meta.reservationUid) console.warn('⚠️ 2 réservations candidates, la plus récente est prise :', q.rows.map(r => r.uid));
  const res = q.rows[0];

  console.log('  EN BASE:', { total: res.amount_total, rooms: res.amount_rooms, menage: res.amount_cleaning, taxes: res.amount_taxes, ota: res.ota_name });
  if (TAXE) res.amount_taxes = parseFloat(TAXE.replace(',', '.'));
  const amt = computeInvoiceAmounts(res);
  if (/booking/i.test(res.ota_name || res.platform || '') && !(amt.touristTaxAmount > 0))
    console.warn('  ⚠️ Taxe de séjour à 0 — relancer avec --taxe=MONTANT (ex. --taxe=28.17)');
  console.log(`\n${num} — ${res.guest_name} — ${res.ota_name || res.platform} — ${res.uid}`);
  console.log('  AVANT  :', { rent: meta.rentAmount, taxe: meta.touristTaxAmount, menage: meta.cleaningFee });
  console.log('  APRÈS  :', amt);

  const newMeta = {
    ...meta,
    invoiceNumber: num,
    reservationUid: res.uid,
    rentAmount: amt.rentAmount,
    cleaningFee: amt.cleaningFee,
    touristTaxAmount: amt.touristTaxAmount,
    serviceFee: amt.serviceFee || 0,
    platform: meta.platform || res.ota_name || res.platform || '',
    paid: isOtaReservation(res),
    paidDate: res.created_at,
  };

  if (!ECRIRE) { console.log('\n(lecture seule — relancer avec --ecrire)'); return pool.end(); }

  await pool.query('UPDATE invoice_download_tokens SET file_path = $1 WHERE id = $2',
    [JSON.stringify(newMeta), tok.id]);

  const user = (await pool.query('SELECT * FROM users WHERE id = $1', [tok.user_id])).rows[0] || {};
  let ownerInfo = null;
  const propId = newMeta.propertyId || res.property_id;
  if (propId) {
    ownerInfo = (await pool.query(
      `SELECT oc.* FROM properties p
         JOIN owner_clients oc ON oc.id::text = REGEXP_REPLACE(p.owner_id, '^agency_client_', '')
        WHERE p.id::text = $1::text AND p.user_id = $2`, [String(propId), tok.user_id])).rows[0] || null;
  }
  if (!ownerInfo && newMeta.ownerId) {
    ownerInfo = (await pool.query('SELECT * FROM owner_clients WHERE id = $1 AND user_id = $2',
      [resolveOwnerClientId(newMeta.ownerId), tok.user_id])).rows[0] || null;
  }
  const outDir = path.join(__dirname, '../output');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${num}.pdf`);
  console.log('  Émetteur :', ownerInfo ? (ownerInfo.company_name || `${ownerInfo.first_name} ${ownerInfo.last_name}`) : '⚠️ propriétaire introuvable → compte agence');
  await generateInvoicePdf(out, newMeta, user, ownerInfo);
  console.log(`\n✅ ${out} — total ${amt.paidTotal} € — lien de téléchargement mis à jour`);
  await pool.end();
})().catch(e => { console.error('ERREUR:', e.message); pool.end(); process.exit(1); });
