'use strict';
// Patche buildAndSendInvoiceToConversation dans server.js (idempotent, sauvegarde server.js.bak).
// Usage : node outils/appliquer-patch-server.js
const fs = require('fs');
const path = require('path');
const f = path.join(__dirname, '../server.js');
let s = fs.readFileSync(f, 'utf8');
if (s.includes('computeInvoiceAmounts(reservation')) { console.log('Déjà appliqué.'); process.exit(0); }

const A = `  const _total      = parseFloat(reservation?.amount_total)    || 0;
  const cleaningFee = parseFloat(reservation?.amount_cleaning) || 0;
  const touristTax  = parseFloat(reservation?.amount_taxes)    || 0;
  const rentAmount  = _total > 0
    ? Math.max(0, Math.round((_total - cleaningFee - touristTax) * 100) / 100)
    : parseFloat(reservation?.amount_rooms) || 0;`;
const B = `  // Montant réellement payé par le voyageur (Booking : taxe de séjour HORS amount_total)
  const { computeInvoiceAmounts, isOtaReservation } = require('./utils/invoice-amounts');
  const _amt        = computeInvoiceAmounts(reservation || {});
  const cleaningFee = _amt.cleaningFee;
  const touristTax  = _amt.touristTaxAmount;
  const rentAmount  = _amt.rentAmount;
  const serviceFee  = _amt.serviceFee || 0;
  const _paid       = reservation ? isOtaReservation(reservation) : false;
  const _paidDate   = _paid ? (reservation.created_at || null) : null;
  const _platform   = reservation?.ota_name || reservation?.platform || '';`;

const M1 = `      nights, rentAmount, touristTaxAmount: touristTax, cleaningFee, vatRate: 0,
      invoiceNumber: num,`;
const M2 = `      nights, rentAmount, touristTaxAmount: touristTax, cleaningFee, vatRate: 0,
      serviceFee, paid: _paid, paidDate: _paidDate, platform: _platform,
      invoiceNumber: num,`;

for (const [a, label] of [[A, 'calcul montants'], [M1, 'buildMeta']]) {
  if (!s.includes(a)) { console.error('❌ Motif introuvable (' + label + ') — rien modifié.'); process.exit(1); }
}
fs.writeFileSync(f + '.bak', s);
s = s.replace(A, B).replace(M1, M2);
fs.writeFileSync(f, s);
console.log('✅ server.js patché (sauvegarde : server.js.bak)');

// Les requêtes qui chargent la réservation doivent fournir ota_name/platform/created_at/airbnb_data
const i = s.indexOf('const { invoiceNumber, downloadUrl } = await buildAndSendInvoiceToConversation');
console.log('\nÀ vérifier — SELECT des réservations juste avant l\'appel (doit inclure ota_name, platform, created_at, airbnb_data) :\n');
console.log(s.slice(Math.max(0, i - 1400), i));
