'use strict';

const PDFDocument = require('pdfkit');
const fs   = require('fs');
const path = require('path');

// Monogramme BH ivoire (source : Boostinghost-ios/Assets.xcassets AppIcon 1024×1024,
// détouré fond vert → PNG transparent, recadré aux lettres)
const _BH_LOGO_IMG = path.join(__dirname, '..', 'assets', 'brand', 'bh-monogram-ivory.png');
// Dimensions du PNG recadré : 621×627 → ratio quasi carré
const _BH_LOGO_RATIO = 621 / 627;

// Format montant — toLocaleString fr-FR peut produire U+202F (espace fine insécable)
// absent de Manrope woff → carré dans le PDF. On remplace par U+0020 ordinaire.
const formatEuro = (n) => Number(n || 0)
  .toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  .replace(/[  ]/g, ' ') + ' €';

// Format date — même sanitisation pour cohérence
const fmtDate = (d) => (d instanceof Date ? d : new Date(d))
  .toLocaleDateString('fr-FR')
  .replace(/[  ]/g, ' ');

async function generateInvoicePdf(outputPath, data, user, ownerInfo) {
  const {
    clientName = '', clientEmail = '', clientAddress = '', clientPostalCode = '',
    clientCity = '', clientSiret = '', clientCompany = '', freeNote = '',
    clientNationality = '', platform = '',
    propertyName = '', propertyAddress = '',
    checkinDate = '', checkoutDate = '', nights = 0,
    rentAmount = 0, touristTaxAmount = 0, cleaningFee = 0,
    vatRate = 0, invoiceNumber = '',
    serviceFee = 0, paid = false, paidDate = ''
  } = data;
  const emitterVatRegime = user?.vat_regime || data.emitterVatRegime || '';

  const subtotal = parseFloat(rentAmount || 0) + parseFloat(touristTaxAmount || 0) + parseFloat(cleaningFee || 0) + parseFloat(serviceFee || 0);
  const vatAmount = subtotal * (parseFloat(vatRate || 0) / 100);
  const total = subtotal + vatAmount;

  const emitterName  = ownerInfo ? (ownerInfo.company_name || `${ownerInfo.first_name||''} ${ownerInfo.last_name||''}`.replace(/\s+/g, ' ').trim()) : (data.emitterName || user?.company || `${user?.first_name||''} ${user?.last_name||''}`.replace(/\s+/g, ' ').trim() || 'Ma Conciergerie');
  const emitterAddr  = ownerInfo?.address     || data.emitterAddress    || user?.address     || '';
  const emitterCP    = ownerInfo?.postal_code || data.emitterPostalCode || user?.postal_code || '';
  const emitterCity  = ownerInfo?.city        || data.emitterCity       || user?.city        || '';
  const emitterEmail = ownerInfo?.email       || data.emitterEmail      || user?.invoice_email || user?.email || '';
  const emitterSiret = ownerInfo?.siret       || data.emitterSiret      || user?.siret       || '';

  const platformLabels = {
    airbnb: 'Airbnb', booking: 'Booking.com', bookingcom: 'Booking.com',
    direct: 'Réservation directe', guest_app: 'BHGuest', bhguest: 'BHGuest',
    abritel: 'Abritel / VRBO', vrbo: 'VRBO', expedia: 'Expedia', hotels: 'Hotels.com',
    gites: 'Gîtes de France'
  };

  const FONT_DIR = path.join(__dirname, '..', 'fonts');
  const FONTSOURCE_DIR = path.join(__dirname, '..', 'node_modules/@fontsource/manrope/files');
  const F_CG_REG  = path.join(FONT_DIR, 'CormorantGaramond-Regular.ttf');
  const F_CG_BOLD = path.join(FONT_DIR, 'CormorantGaramond-Bold.ttf');
  const F_CG_IT   = path.join(FONT_DIR, 'CormorantGaramond-Italic.ttf');
  const F_MN_REG  = path.join(FONTSOURCE_DIR, 'manrope-latin-400-normal.woff');
  const F_MN_SB   = path.join(FONTSOURCE_DIR, 'manrope-latin-600-normal.woff');
  const F_MN_BOLD = path.join(FONTSOURCE_DIR, 'manrope-latin-700-normal.woff');

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    // Désactiver les ligatures (Manrope : "tt" → ﬅ supprime une lettre dans TTC, Cette, etc.)
    const _origDocText = doc.text.bind(doc);
    doc.text = function _noLigaText(str, x, y, opts) {
      if (typeof x === 'object' && x !== null) { opts = x; x = undefined; y = undefined; }
      else if (typeof y === 'object' && y !== null) { opts = y; y = undefined; }
      const o = Object.assign({ features: { liga: false, clig: false, dlig: false } }, opts || {});
      if (x !== undefined) return _origDocText(str, x, y, o);
      return _origDocText(str, o);
    };

    doc.registerFont('CG-Regular', F_CG_REG);
    doc.registerFont('CG-Bold',    F_CG_BOLD);
    doc.registerFont('CG-Italic',  F_CG_IT);
    doc.registerFont('MN-Regular', F_MN_REG);
    doc.registerFont('MN-SemiBold',F_MN_SB);
    doc.registerFont('MN-Bold',    F_MN_BOLD);

    const W = 595, H = 842;
    const mg = 48;
    const FOOTER_H = 36;
    const CONTENT_BOTTOM = H - FOOTER_H - 12; // limite basse du contenu (au-dessus du pied de page)
    // Maison Vert palette
    const BOTTLE  = '#0E3B2E'; // aplats, bandeau
    const ACCENT  = '#1E6E52'; // titres section, accents
    const IVORY   = '#F2EADA'; // fonds doux
    const BODY    = '#1C1F1D'; // texte courant
    const MUTED   = '#6B6F6A'; // labels secondaires
    const BORDER  = '#D9D2C5'; // séparateurs ivoire foncé

    // ── Bandeau émetteur (haut) ─────────────────────────────────────────────────
    const HEADER_H = 110;
    doc.rect(0, 0, W, HEADER_H).fill(BOTTLE);

    // Nom émetteur — Cormorant Garamond Bold, grand
    doc.font('CG-Bold').fontSize(28).fillColor('#FFFFFF').text(emitterName, mg, 24, { width: 340 });
    let yH = 24 + doc.heightOfString(emitterName, { font: 'CG-Bold', fontSize: 28, width: 340 }) + 6;

    doc.font('MN-Regular').fontSize(8.5).fillColor('rgba(255,255,255,0.72)');
    const emitterLines = [
      emitterAddr,
      [emitterCP, emitterCity].filter(Boolean).join(' '),
      emitterEmail,
      emitterSiret ? `SIRET : ${emitterSiret}` : ''
    ].filter(Boolean);
    for (const line of emitterLines) {
      if (yH > HEADER_H - 10) break;
      doc.text(line, mg, yH, { width: 320 }); yH += 13;
    }

    // Bloc FACTURE — coin supérieur droit, fond ivoire
    // Hauteur dynamique selon présence des dates ; centré verticalement dans le bandeau.
    const BW = 168, BX = W - mg - BW, BPadX = 14, BPadY = 10;
    const _hasDates = !!(checkinDate && checkoutDate);
    // Hauteur contenu : CG-Bold 22→height 28, MN-SB 9.5→1igne 16, MN-Reg 8.5→13, MN-SB 8→10
    const _contentSpan = _hasDates ? 78 : 54;
    const BH = _contentSpan + BPadY * 2;
    const BY = Math.round((HEADER_H - BH) / 2);
    doc.rect(BX, BY, BW, BH).fill(IVORY);
    const _bBase = BY + BPadY;
    doc.font('CG-Bold').fontSize(22).fillColor(ACCENT).text('Facture', BX + BPadX, _bBase);
    doc.font('MN-SemiBold').fontSize(9.5).fillColor(BODY)
       .text(`N° ${invoiceNumber}`, BX + BPadX, _bBase + 28);
    doc.font('MN-Regular').fontSize(8.5).fillColor(MUTED)
       .text(`Émise le : ${fmtDate(new Date())}`, BX + BPadX, _bBase + 44);
    if (_hasDates) {
      const ci = fmtDate(checkinDate);
      const co = fmtDate(checkoutDate);
      doc.text(`${ci} au ${co}`, BX + BPadX, _bBase + 57);
      doc.font('MN-SemiBold').fontSize(8).fillColor(ACCENT)
         .text(`${nights} nuit${nights > 1 ? 's' : ''}`, BX + BPadX, _bBase + 68);
    }

    // ── Zone blanche principale ─────────────────────────────────────────────────
    let y = HEADER_H + 22;

    // Saut de page si le contenu dépasse la limite (pied de page réservé)
    const ensureSpace = (needed) => {
      if (y + needed > CONTENT_BOTTOM) {
        doc.addPage();
        y = mg;
      }
    };

    // ── Parties (émetteur / client) — deux colonnes ────────────────────────────
    const colW = (W - mg * 2 - 20) / 2;
    const col2 = mg + colW + 20;

    // Labels section
    doc.font('MN-Bold').fontSize(7).fillColor(ACCENT)
       .text('ÉMETTEUR', mg, y)
       .text('DESTINATAIRE', col2, y);
    y += 13;

    // Filet ivoire sous les labels
    doc.rect(mg, y, W - mg * 2, 0.75).fill(BORDER);
    y += 10;

    // Colonne gauche
    let yL = y;
    doc.font('CG-Bold').fontSize(14).fillColor(BODY).text(emitterName, mg, yL, { width: colW });
    yL += doc.heightOfString(emitterName, { font: 'CG-Bold', fontSize: 14, width: colW }) + 5;
    doc.font('MN-Regular').fontSize(8.5).fillColor(MUTED);
    if (emitterAddr)            { doc.text(emitterAddr, mg, yL, { width: colW }); yL += 13; }
    if (emitterCP || emitterCity){ doc.text([emitterCP, emitterCity].filter(Boolean).join(' '), mg, yL); yL += 13; }
    if (emitterEmail)           { doc.text(emitterEmail, mg, yL); yL += 13; }
    if (emitterSiret)           { doc.text(`SIRET : ${emitterSiret}`, mg, yL); yL += 13; }

    // Colonne droite
    let yR = y;
    const clientDisplay = clientCompany || clientName;
    doc.font('CG-Bold').fontSize(14).fillColor(BODY).text(clientDisplay, col2, yR, { width: colW });
    yR += doc.heightOfString(clientDisplay, { font: 'CG-Bold', fontSize: 14, width: colW }) + 5;
    if (clientCompany && clientName) {
      doc.font('MN-Regular').fontSize(8.5).fillColor(MUTED).text(clientName, col2, yR, { width: colW }); yR += 13;
    }
    doc.font('MN-Regular').fontSize(8.5).fillColor(MUTED);
    if (clientAddress)     { doc.text(clientAddress, col2, yR, { width: colW }); yR += 13; }
    const cpCity = [clientPostalCode, clientCity].filter(Boolean).join(' ');
    if (cpCity)            { doc.text(cpCity, col2, yR); yR += 13; }
    if (clientNationality) { doc.text(`Nationalité : ${clientNationality}`, col2, yR); yR += 13; }
    if (clientEmail)       { doc.text(clientEmail, col2, yR); yR += 13; }
    if (clientSiret)       { doc.text(`N° fiscal : ${clientSiret}`, col2, yR); yR += 13; }
    if (freeNote)          { doc.font('CG-Italic').fontSize(9).text(freeNote, col2, yR, { width: colW }); yR += 13; }

    y = Math.max(yL, yR) + 20;

    // ── Séjour ──────────────────────────────────────────────────────────────────
    ensureSpace(12 + 13 + 34 + 4 + 30);
    doc.rect(mg, y, W - mg * 2, 0.75).fill(BORDER); y += 12;
    doc.font('MN-Bold').fontSize(7).fillColor(ACCENT).text('SÉJOUR', mg, y); y += 13;

    // Fond ivoire léger pour la ligne séjour
    const stayLineH = 34;
    doc.rect(mg, y, W - mg * 2, stayLineH).fill(IVORY);
    doc.font('CG-Bold').fontSize(13).fillColor(BODY).text(propertyName, mg + 12, y + 8, { width: 300 });
    if (propertyAddress) {
      doc.font('MN-Regular').fontSize(8.5).fillColor(MUTED).text(propertyAddress, mg + 12, y + 23, { width: 300 });
    }
    // Dates + durée sur la droite
    if (checkinDate && checkoutDate) {
      const ci = fmtDate(checkinDate);
      const co = fmtDate(checkoutDate);
      doc.font('MN-SemiBold').fontSize(9).fillColor(ACCENT)
         .text(`${ci} au ${co}`, mg + 12, y + 8, { width: W - mg * 2 - 24, align: 'right' });
      doc.font('MN-Regular').fontSize(8.5).fillColor(MUTED)
         .text(`${nights} nuit${nights > 1 ? 's' : ''}`, mg + 12, y + 23, { width: W - mg * 2 - 24, align: 'right' });
    }
    y += stayLineH + 4;

    if (platform) {
      const pLabel = platformLabels[platform.toLowerCase()] || platform;
      doc.font('MN-Regular').fontSize(8).fillColor(MUTED).text(`Plateforme : ${pLabel}`, mg, y); y += 13;
    }
    y += 16;

    // ── Tableau détail ──────────────────────────────────────────────────────────
    ensureSpace(12 + 12 + 30);
    doc.rect(mg, y, W - mg * 2, 0.75).fill(BORDER); y += 12;
    doc.font('MN-Bold').fontSize(7).fillColor(ACCENT).text('DÉTAIL', mg, y); y += 12;

    // En-tête tableau
    const ROW_H = 30;
    doc.rect(mg, y, W - mg * 2, ROW_H).fill(BOTTLE);
    doc.font('MN-Bold').fontSize(8.5).fillColor('#FFFFFF')
       .text('PRESTATION', mg + 14, y + 10, { width: 280 })
       .text('MONTANT', W - mg - 90, y + 10, { width: 78, align: 'right' });
    y += ROW_H;

    let alt = false;
    const addRow = (label, amount) => {
      if (parseFloat(amount || 0) <= 0) return;
      ensureSpace(ROW_H);
      if (alt) doc.rect(mg, y, W - mg * 2, ROW_H).fill(IVORY);
      doc.font('MN-Regular').fontSize(9.5).fillColor(BODY)
         .text(label, mg + 14, y + 9, { width: 280 });
      doc.font('MN-SemiBold').fontSize(9.5).fillColor(BODY)
         .text(formatEuro(amount), W - mg - 90, y + 9, { width: 78, align: 'right' });
      doc.rect(mg, y + ROW_H, W - mg * 2, 0.5).fill(BORDER);
      y += ROW_H; alt = !alt;
    };
    addRow(`Séjour${nights ? ' (' + nights + ' nuit' + (nights > 1 ? 's' : '') + ')' : ''}`, rentAmount);
    addRow('Taxe de séjour', touristTaxAmount);
    addRow('Frais de ménage', cleaningFee);
    addRow('Frais de service plateforme', serviceFee);
    y += 20;

    // ── Totaux ──────────────────────────────────────────────────────────────────
    ensureSpace(16 + 16 + 7 + 38 + 16);
    const totW = 230, totX = W - mg - totW;
    if (parseFloat(vatRate || 0) > 0) {
      doc.font('MN-Regular').fontSize(9).fillColor(MUTED)
         .text('Sous-total HT', totX, y, { width: 130 })
         .text(formatEuro(subtotal), totX + 130, y, { width: 88, align: 'right' });
      y += 16;
      doc.text(`TVA (${vatRate} %)`, totX, y, { width: 130 })
         .text(formatEuro(vatAmount), totX + 130, y, { width: 88, align: 'right' });
      y += 16;
    }
    // Ligne accent
    doc.rect(totX, y, totW, 1).fill(ACCENT); y += 6;
    // Bande total
    doc.rect(totX, y, totW, 38).fill(BOTTLE);
    doc.font('CG-Bold').fontSize(16).fillColor('#FFFFFF')
       .text('Total TTC', totX + 14, y + 10, { width: 120 });
    doc.font('MN-Bold').fontSize(16).fillColor('#FFFFFF')
       .text(formatEuro(total), totX + 14, y + 10, { width: totW - 28, align: 'right' });

    // ── Tampon FACTURE ACQUITTÉE — rouge, encadré, à gauche du total ──
    if (paid) {
      const RED = '#C62828';
      const pLabel = platform ? (platformLabels[platform.toLowerCase()] || platform) : '';
      const sub = [pLabel ? `Réglée via ${pLabel}` : 'Réglée',
                   paidDate ? `le ${fmtDate(paidDate)}` : ''].filter(Boolean).join(' ');
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
    y += 38;

    // Mention TVA franchise (art. 293 B) : uniquement si vat_regime = 'franchise' est renseigné
    if (emitterVatRegime === 'franchise') {
      y += 8;
      doc.font('MN-Regular').fontSize(7.5).fillColor(MUTED)
         .text('TVA non applicable, art. 293 B du CGI', totX, y);
    }

    // ── Pied de page — dernière page uniquement ────────────────────────────────
    doc.rect(0, H - FOOTER_H, W, FOOTER_H).fill(BOTTLE);

    // Monogramme BH PNG ivoire (assets/brand/bh-monogram-ivory.png, 621×627 px)
    const LOGO_H_F = 18;
    const LOGO_W_F = LOGO_H_F * _BH_LOGO_RATIO; // ≈ 17.8 pt

    // Mesure des segments de texte pour centrage horizontal
    const FOOTER_FONT = 8.5;
    const FTXT1 = 'Cette facture a été générée par ';
    const FTXT2 = 'Boostinghost.fr';
    doc.font('MN-Regular').fontSize(FOOTER_FONT);
    const fw1 = doc.widthOfString(FTXT1, { features: { liga: false, clig: false, dlig: false } });
    doc.font('MN-Bold').fontSize(FOOTER_FONT);
    const fw2 = doc.widthOfString(FTXT2, { features: { liga: false, clig: false, dlig: false } });

    const fGap = 6;
    const fStartX = (W - (LOGO_W_F + fGap + fw1 + fw2)) / 2;

    // Logo PNG — doc.image() avec alpha (transparent)
    const fLogoTopY = H - FOOTER_H + (FOOTER_H - LOGO_H_F) / 2;
    doc.image(_BH_LOGO_IMG, fStartX, fLogoTopY, { height: LOGO_H_F });

    // Mention textuelle
    const fTextX = fStartX + LOGO_W_F + fGap;
    const fTextY = H - FOOTER_H + (FOOTER_H - FOOTER_FONT * 1.15) / 2;
    doc.font('MN-Regular').fontSize(FOOTER_FONT).fillColor(IVORY)
       .text(FTXT1, fTextX, fTextY, { continued: true, lineBreak: false });
    doc.font('MN-Bold').fillColor(IVORY)
       .text(FTXT2, { continued: false, lineBreak: false });

    // Lien cliquable sur toute la mention
    doc.link(fTextX, fTextY - 1, fw1 + fw2, FOOTER_FONT + 3, 'https://boostinghost.fr');

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

module.exports = { generateInvoicePdf, formatEuro };
