'use strict';
// Usage : DATABASE_URL="postgres://..." node outils/gen-invoice-from-reservation.js "Soufiane Benmalek" 2026-09-21
// Génère /tmp/invoice-real-<guest>.pdf en passant par generateInvoicePdf exactement
// comme le ferait le endpoint /api/invoice/download/:token.

const { Pool } = require('pg');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

if (!process.env.DATABASE_URL) {
  console.error('\n  Usage: DATABASE_URL="postgres://…" node outils/gen-invoice-from-reservation.js "Prénom Nom" YYYY-MM-DD\n');
  process.exit(1);
}

const guestQuery = process.argv[2] || '';
const dateQuery  = process.argv[3] || '';

// ── Extraire generateInvoicePdf depuis server.js ──────────────────────────────
const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const logoStart = serverSrc.indexOf('const _BH_LOGO_PATH =');
const logoEnd   = serverSrc.indexOf("';\n", logoStart) + 3;
const fnStart   = serverSrc.indexOf('async function generateInvoicePdf(');
let depth = 0, i = fnStart, fnEnd = -1;
while (i < serverSrc.length) {
  if (serverSrc[i] === '{') depth++;
  else if (serverSrc[i] === '}') { depth--; if (depth === 0) { fnEnd = i + 1; break; } }
  i++;
}
const modPath = path.join(__dirname, '../_gen_invoice_real.js');
fs.writeFileSync(modPath, `'use strict';
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
${serverSrc.slice(logoStart, logoEnd)}
${serverSrc.slice(fnStart, fnEnd)}
module.exports = { generateInvoicePdf };
`);
const { generateInvoicePdf } = require(modPath);
fs.unlinkSync(modPath);

// ── Requête DB ────────────────────────────────────────────────────────────────
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  // Trouver la réservation
  const resQ = `
    SELECT r.*, c.user_id AS conv_user_id,
           p.name AS property_name, p.address AS property_address,
           c.id AS conv_id
    FROM reservations r
    LEFT JOIN conversations c ON c.reservation_uid = r.uid
    LEFT JOIN properties p ON p.id = r.property_id
    WHERE (r.guest_name ILIKE $1 OR r.guest_name ILIKE $2)
      ${dateQuery ? 'AND r.start_date::date = $3' : ''}
    ORDER BY r.created_at DESC
    LIMIT 5
  `;
  const params = [`%${guestQuery}%`, `${guestQuery}%`];
  if (dateQuery) params.push(dateQuery);

  const resRows = await pool.query(resQ, params);
  if (resRows.rows.length === 0) {
    console.error('Aucune réservation trouvée pour', guestQuery, dateQuery);
    await pool.end();
    return;
  }

  const res = resRows.rows[0];
  console.log('Réservation trouvée:');
  console.log('  guest_name :', res.guest_name);
  console.log('  uid        :', res.uid);
  console.log('  start_date :', res.start_date);
  console.log('  end_date   :', res.end_date);
  console.log('  amount_total:', res.amount_total);
  console.log('  amount_cleaning:', res.amount_cleaning);
  console.log('  amount_taxes:', res.amount_taxes);
  console.log('  property   :', res.property_name);

  // Compte propriétaire
  const userId = res.conv_user_id || res.user_id;
  const userRow = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
  const user = userRow.rows[0] || {};
  console.log('Utilisateur  :', user.company || `${user.first_name} ${user.last_name}`, '| vat_regime:', user.vat_regime);

  // Calcul montants (même logique que buildAndSendInvoiceToConversation)
  const nights      = Math.round((new Date(res.end_date) - new Date(res.start_date)) / 86400000);
  const totalAmt    = parseFloat(res.amount_total)    || 0;
  const cleaningFee = parseFloat(res.amount_cleaning) || 0;
  const touristTax  = parseFloat(res.amount_taxes)    || 0;
  const rentAmount  = totalAmt > 0
    ? Math.max(0, Math.round((totalAmt - cleaningFee - touristTax) * 100) / 100)
    : parseFloat(res.amount_rooms) || 0;

  const data = {
    invoiceNumber:    `FAC-REEL-${res.uid?.slice(0,8) || 'TEST'}`,
    clientName:       res.guest_name || '',
    clientEmail:      res.guest_email || '',
    propertyName:     res.property_name || '',
    propertyAddress:  res.property_address || '',
    checkinDate:      res.start_date,
    checkoutDate:     res.end_date,
    nights,
    rentAmount,
    touristTaxAmount: touristTax,
    cleaningFee,
    vatRate:          0,
    platform:         res.ota || res.channel || '',
  };

  const outPath = `/tmp/invoice-real-${(res.guest_name || 'guest').replace(/\s+/g, '-').toLowerCase()}.pdf`;
  await generateInvoicePdf(outPath, data, user, null);
  console.log('\nPDF généré :', outPath);

  // Extraction texte brute pour vérification
  const buf = fs.readFileSync(outPath);
  let allText = '';
  let pos = 0;
  while (pos < buf.length) {
    const si = buf.indexOf(Buffer.from('stream\n'), pos);
    if (si < 0) break;
    const ds = si + 7;
    const ei = buf.indexOf(Buffer.from('\nendstream'), ds);
    try { allText += zlib.inflateSync(buf.slice(ds, ei)).toString('latin1'); } catch(e) {}
    pos = ei + 10;
  }
  const btBlocks = (allText.match(/BT[\s\S]*?ET/g) || []);
  console.log('Blocs texte BT/ET :', btBlocks.length, '| Taille :', buf.length, 'octets');

  await pool.end();
}

run().catch(e => { console.error('ERREUR:', e.message); pool.end(); process.exit(1); });
