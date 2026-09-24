'use strict';
// Applique le patch « facture acquittée » à utils/invoice-pdf.js (idempotent).
// Usage : node outils/appliquer-patch-facture.js
const fs = require('fs');
const path = require('path');
const f = path.join(__dirname, '../utils/invoice-pdf.js');
let s = fs.readFileSync(f, 'utf8');
if (s.includes('FACTURE ACQUITTÉE')) { console.log('Déjà appliqué.'); process.exit(0); }
fs.writeFileSync(f + '.bak', s);

const rep = (a, b) => { if (!s.includes(a)) { console.error('❌ Motif introuvable :\n' + a); process.exit(1); } s = s.replace(a, b); };

rep(`vatRate = 0, invoiceNumber = ''`,
    `vatRate = 0, invoiceNumber = '',\n    serviceFee = 0, paid = false, paidDate = ''`);

rep(`+ parseFloat(cleaningFee || 0);`,
    `+ parseFloat(cleaningFee || 0) + parseFloat(serviceFee || 0);`);

rep(`addRow('Frais de ménage', cleaningFee);`,
    `addRow('Frais de ménage', cleaningFee);\n    addRow('Frais de service plateforme', serviceFee);`);

rep(`       .text(formatEuro(total), totX + 14, y + 10, { width: totW - 28, align: 'right' });
    y += 38;`,
`       .text(formatEuro(total), totX + 14, y + 10, { width: totW - 28, align: 'right' });

    // ── Tampon FACTURE ACQUITTÉE — rouge, encadré, à gauche du total ──
    if (paid) {
      const RED = '#C62828';
      const pLabel = platform ? (platformLabels[platform.toLowerCase()] || platform) : '';
      const sub = [pLabel ? \`Réglée via \${pLabel}\` : 'Réglée',
                   paidDate ? \`le \${fmtDate(paidDate)}\` : ''].filter(Boolean).join(' ');
      const SW = 210, SH = 54, SX = mg, SY = y - 8;
      doc.save();
      doc.lineWidth(2).strokeColor(RED).rect(SX, SY, SW, SH).stroke();
      doc.lineWidth(0.75).strokeColor(RED).rect(SX + 4, SY + 4, SW - 8, SH - 8).stroke();
      doc.font('MN-Bold').fontSize(14).fillColor(RED)
         .text('FACTURE ACQUITTÉE', SX, SY + 12, { width: SW, align: 'center' });
      doc.font('MN-SemiBold').fontSize(8).fillColor(RED)
         .text(sub, SX, SY + 32, { width: SW, align: 'center' });
      doc.restore();
    }
    y += 38;`);

fs.writeFileSync(f, s);
console.log('✅ utils/invoice-pdf.js patché (sauvegarde : invoice-pdf.js.bak)');
