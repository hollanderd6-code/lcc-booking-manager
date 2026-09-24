'use strict';
// Patche runInvoiceQueue (cron factures demandées) dans server.js — idempotent, sauvegarde server.js.bak2
// Usage : node outils/appliquer-patch-cron-factures.js
const fs = require('fs');
const path = require('path');
const f = path.join(__dirname, '../server.js');
let s = fs.readFileSync(f, 'utf8');
if (s.includes('_resForAmt')) { console.log('Déjà appliqué.'); dump(); process.exit(0); }

const edits = [
  // 1. SELECT : plateforme + date de réservation (les deux requêtes identiques, sans risque)
  { all: true,
    a: `r.amount_total, r.amount_rooms, r.amount_cleaning, r.amount_taxes,
              p.name as property_name, p.address as property_address,`,
    b: `r.amount_total, r.amount_rooms, r.amount_cleaning, r.amount_taxes,
              r.ota_name, r.platform AS res_platform, r.source AS res_source,
              r.created_at AS res_created_at, r.airbnb_data,
              p.name as property_name, p.address as property_address,` },
  // 2. Calcul des montants
  { a: `        const cleaningFee = parseFloat(req.cleaning_fee || req.amount_cleaning || req.prop_cleaning_fee) || 0;
        const touristTax  = parseFloat(req.tourist_tax || req.amount_taxes || (req.tourist_tax_per_night ? req.tourist_tax_per_night * nights : 0)) || 0;
        let rentAmount;
        if (_total > 0) {
          rentAmount = Math.max(0, Math.round((_total - cleaningFee - touristTax) * 100) / 100);
        } else {
          rentAmount = parseFloat(req.rent_amount || req.amount_rooms) || 0;
        }`,
    b: `        let cleaningFee = parseFloat(req.cleaning_fee || req.amount_cleaning || req.prop_cleaning_fee) || 0;
        let touristTax  = parseFloat(req.tourist_tax || req.amount_taxes || (req.tourist_tax_per_night ? req.tourist_tax_per_night * nights : 0)) || 0;
        let rentAmount;
        if (_total > 0) {
          rentAmount = Math.max(0, Math.round((_total - cleaningFee - touristTax) * 100) / 100);
        } else {
          rentAmount = parseFloat(req.rent_amount || req.amount_rooms) || 0;
        }
        // Réservation plateforme : montant réellement payé (Booking : taxe HORS amount_total)
        const { computeInvoiceAmounts, isOtaReservation } = require('./utils/invoice-amounts');
        const _resForAmt = { ...req, platform: req.res_platform, source: req.res_source, created_at: req.res_created_at };
        const _isOta = !!req.ota_name && isOtaReservation(_resForAmt);
        let serviceFee = 0;
        if (_isOta && _total > 0) {
          const _a = computeInvoiceAmounts(_resForAmt);
          rentAmount = _a.rentAmount; cleaningFee = _a.cleaningFee;
          touristTax = _a.touristTaxAmount; serviceFee = _a.serviceFee || 0;
        }` },
  // 3. Métadonnées de la facture : tampon
  { a: `              vatRate: 0,
              invoiceNumber,
              propertyId: req.property_id || null
            });`,
    b: `              vatRate: 0,
              serviceFee, paid: _isOta, paidDate: _isOta ? req.res_created_at : null,
              platform: req.ota_name || '',
              invoiceNumber,
              propertyId: req.property_id || null
            });` },
  // 4. Total enregistré
  { a: `               parseFloat(rentAmount) + parseFloat(cleaningFee) + parseFloat(touristTax)]`,
    b: `               parseFloat(rentAmount) + parseFloat(cleaningFee) + parseFloat(touristTax) + serviceFee]` },
];

for (const e of edits) {
  const n = s.split(e.a).length - 1;
  if (n === 0 || (!e.all && n !== 1)) { console.error('❌ Motif trouvé ' + n + ' fois — rien modifié :\n' + e.a.slice(0, 120)); process.exit(1); }
}
fs.writeFileSync(f + '.bak2', s);
for (const e of edits) s = e.all ? s.split(e.a).join(e.b) : s.replace(e.a, e.b);
fs.writeFileSync(f, s);
console.log('✅ runInvoiceQueue patché (sauvegarde : server.js.bak2)');
dump();

function dump() {
  const t = fs.readFileSync(f, 'utf8');
  const i = t.indexOf('touristTaxAmount: meta.touristTaxAmount');
  if (i < 0) return;
  const start = t.lastIndexOf('\n', i - 1500);
  console.log('\n──── Route de téléchargement (à me renvoyer) ────\n' + t.slice(start, i + 700));
}
