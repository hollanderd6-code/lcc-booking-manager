'use strict';
// À placer dans utils/invoice-amounts.js
// Montants de facture = ce que le voyageur a réellement payé sur la plateforme.
//
// Booking.com : amount_total = nuits + ménage, taxe de séjour HORS total
//   (channex.js : bdc_city_tax → amount_taxes). Total payé = total + taxe.
//   Ex. Mangano M6 : 173,34 + 15 + 28,17 = 216,51 €.
// Airbnb : airbnb_data.airbnb_total_paid fait foi quand présent.
// Autres : amount_total inclut déjà tout.

const OTA_RE = /airbnb|booking|expedia|vrbo|abritel|hotels|gites|agoda|homeaway/i;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function isOtaReservation(res) {
  return OTA_RE.test(`${res.ota_name || ''} ${res.platform || ''} ${res.source === 'channex' ? 'booking' : ''}`)
    && !/direct|guest_app|bhguest/i.test(res.platform || '');
}

function computeInvoiceAmounts(res) {
  const ota = `${res.ota_name || ''} ${res.platform || ''}`.toLowerCase();
  const total    = r2(res.amount_total);
  const cleaning = r2(res.amount_cleaning);
  const tax      = r2(res.amount_taxes);
  const rooms    = r2(res.amount_rooms);

  if (ota.includes('booking')) {
    const rent = total > 0 ? r2(total - cleaning) : rooms;
    return { rentAmount: rent, cleaningFee: cleaning, touristTaxAmount: tax,
             paidTotal: r2(rent + cleaning + tax) };
  }

  if (ota.includes('airbnb')) {
    let ad = res.airbnb_data;
    if (typeof ad === 'string') { try { ad = JSON.parse(ad); } catch (e) { ad = null; } }
    const paid = r2(ad?.airbnb_total_paid);
    if (paid > 0) {
      const guestFee = r2(ad?.airbnb_guest_fee);
      // Airbnb collecte et reverse la taxe lui-même : elle figure sur le reçu Airbnb,
      // pas dans notre facture, sauf si reversée à l'hôte (airbnb_tax_to_host).
      const taxHost = r2(ad?.airbnb_tax_to_host);
      const rent = r2(paid - cleaning - guestFee - taxHost);
      return { rentAmount: rent, cleaningFee: cleaning, touristTaxAmount: taxHost,
               serviceFee: guestFee, paidTotal: paid };
    }
  }

  const rent = total > 0 ? Math.max(0, r2(total - cleaning - tax)) : rooms;
  return { rentAmount: rent, cleaningFee: cleaning, touristTaxAmount: tax,
           paidTotal: r2(rent + cleaning + tax) };
}

module.exports = { computeInvoiceAmounts, isOtaReservation };
