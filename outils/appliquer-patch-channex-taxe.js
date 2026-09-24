'use strict';
// Patche channex.js (idempotent, sauvegarde channex.js.bak) :
//  1. Taxe de séjour Booking lue aussi dans room.collected_taxes (taxe perçue par Booking, "Withheld")
//  2. amount_rooms Booking : si room.amount == total et ménage présent, room.amount inclut le ménage → total − ménage
// Usage : node outils/appliquer-patch-channex-taxe.js
const fs = require('fs');
const path = require('path');
const f = path.join(__dirname, '../channex.js');
let s = fs.readFileSync(f, 'utf8');
if (s.includes('room.collected_taxes')) { console.log('Déjà appliqué.'); process.exit(0); }

const A1 = `    // ── Booking.com : commission ──`;
const B1 = `    // Booking perçoit lui-même la taxe (Withheld) : Channex la place dans
    // room.collected_taxes, pas dans room.taxes. Ex. Mangano M6 : 28,17 €.
    if (isBookingCom && !bdc_city_tax) {
      const ct = (room.collected_taxes || []).find(t =>
        /city|tourist|taxe.?s.?jour/i.test(\`\${t.type || ''} \${t.name || ''}\`));
      if (ct) bdc_city_tax = parseFloat(ct.total_price || 0) || 0;
    }

    // ── Booking.com : commission ──`;

const A2 = `if (roomAmountRaw != null && !isNaN(roomAmountRaw)) {`;
const B2 = `if (roomAmountRaw != null && !isNaN(roomAmountRaw)
        && !(isBookingCom && amount_cleaning > 0 && Math.abs(roomAmountRaw - amount_total) < 0.01)) {
      // (Booking : room.amount == amount_total inclut le ménage → branche suivante)`;

for (const [a, l] of [[A1, 'commission'], [A2, 'roomAmountRaw']]) {
  const n = s.split(a).length - 1;
  if (n !== 1) { console.error('❌ Motif "' + l + '" trouvé ' + n + ' fois — rien modifié.'); process.exit(1); }
}
fs.writeFileSync(f + '.bak', s);
s = s.replace(A1, B1).replace(A2, B2);
fs.writeFileSync(f, s);
console.log('✅ channex.js patché (sauvegarde : channex.js.bak)');
