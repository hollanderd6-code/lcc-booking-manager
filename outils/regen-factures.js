'use strict';
// Régénère un ou plusieurs PDFs de factures depuis invoice_download_tokens.
// Usage : DATABASE_URL="postgres://..." node outils/regen-factures.js FACT-2026-0096 FACT-2026-0099
// Sortie : ./output/<numéro>.pdf

const { Pool }  = require('pg');
const PDFDocument = require('pdfkit');
const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

if (!process.env.DATABASE_URL) {
  console.error('\n  Usage: DATABASE_URL="postgres://…" node outils/regen-factures.js FACT-YYYY-NNNN …\n');
  process.exit(1);
}

const invoiceNumbers = process.argv.slice(2);
if (!invoiceNumbers.length) {
  console.error('Aucun numéro de facture fourni.');
  process.exit(1);
}

// ── Extraire generateInvoicePdf depuis server.js ──────────────────────────────
const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const logoStart  = serverSrc.indexOf('const _BH_LOGO_PATH =');
const logoEnd    = serverSrc.indexOf("';\n", logoStart) + 3;
const fnStart    = serverSrc.indexOf('async function generateInvoicePdf(');
let depth = 0, i = fnStart, fnEnd = -1;
while (i < serverSrc.length) {
  if (serverSrc[i] === '{') depth++;
  else if (serverSrc[i] === '}') { depth--; if (depth === 0) { fnEnd = i + 1; break; } }
  i++;
}
const tmpMod = path.join(__dirname, '../_regen_factures_tmp.js');
fs.writeFileSync(tmpMod, `'use strict';
const PDFDocument = require('pdfkit');
const fs   = require('fs');
const path = require('path');
${serverSrc.slice(logoStart, logoEnd)}
${serverSrc.slice(fnStart, fnEnd)}
module.exports = { generateInvoicePdf };
`);
const { generateInvoicePdf } = require(tmpMod);
fs.unlinkSync(tmpMod);

// ── Résolution de l'owner_client via properties.owner_id ─────────────────────
function resolveOwnerClientId(ownerId) {
  if (!ownerId) return null;
  const s = String(ownerId);
  return (s.startsWith('agency_client_') ? s.slice('agency_client_'.length) : s) || null;
}

async function loadOwnerInfo(pool, { propertyId, propertyName, propertyAddress, userId, ownerIdHint }) {
  if (!userId) return null;
  if (propertyId) {
    try {
      const r = await pool.query(
        `SELECT oc.* FROM properties p
         JOIN owner_clients oc ON oc.id::text = REGEXP_REPLACE(p.owner_id, '^agency_client_', '')
         WHERE p.id = $1 AND p.user_id = $2`,
        [propertyId, userId]
      );
      if (r.rowCount) return r.rows[0];
    } catch(e) { console.warn('⚠️ ownerInfo by propertyId:', e.message); }
  }
  if (propertyName) {
    try {
      const r = await pool.query(
        `SELECT oc.* FROM properties p
         JOIN owner_clients oc ON oc.id::text = REGEXP_REPLACE(p.owner_id, '^agency_client_', '')
         WHERE p.name = $1 AND p.user_id = $2
         ORDER BY (p.address = $3) DESC LIMIT 1`,
        [propertyName, userId, propertyAddress || null]
      );
      if (r.rowCount) return r.rows[0];
    } catch(e) { console.warn('⚠️ ownerInfo by propertyName:', e.message); }
  }
  if (ownerIdHint) {
    try {
      const r = await pool.query(
        'SELECT * FROM owner_clients WHERE id = $1 AND user_id = $2',
        [resolveOwnerClientId(ownerIdHint), userId]
      );
      if (r.rowCount) return r.rows[0];
    } catch(e) { console.warn('⚠️ ownerInfo by ownerIdHint:', e.message); }
  }
  return null;
}

// ── Répertoire de sortie ──────────────────────────────────────────────────────
const outDir = path.join(__dirname, '../output');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  for (const invoiceNumber of invoiceNumbers) {
    console.log(`\n── ${invoiceNumber} ──`);

    const row = await pool.query(
      `SELECT file_path, user_id FROM invoice_download_tokens
       WHERE invoice_number = $1 ORDER BY created_at DESC LIMIT 1`,
      [invoiceNumber]
    ).then(r => r.rows[0]);

    if (!row) {
      console.error(`  ❌ Introuvable dans invoice_download_tokens`);
      continue;
    }

    let meta = {};
    try { meta = JSON.parse(row.file_path || '{}'); } catch(e) {}
    const userId = row.user_id;

    console.log('  user_id   :', userId);
    console.log('  propertyId:', meta.propertyId || '—');
    console.log('  property  :', meta.propertyName || '—');
    console.log('  ownerId   :', meta.ownerId || '—');

    const userRow = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    const user = userRow.rows[0] || {};
    console.log('  user      :', user.company || `${user.first_name} ${user.last_name}`);

    const ownerInfo = await loadOwnerInfo(pool, {
      propertyId:      meta.propertyId || null,
      propertyName:    meta.propertyName || null,
      propertyAddress: meta.propertyAddress || null,
      userId,
      ownerIdHint:     meta.ownerId || null,
    });
    console.log('  ownerInfo :', ownerInfo
      ? (ownerInfo.company_name || `${ownerInfo.first_name} ${ownerInfo.last_name}`)
      : 'null → émetteur = user.company');

    if (!meta.invoiceNumber) meta.invoiceNumber = invoiceNumber;

    const outPath = path.join(outDir, `${invoiceNumber}.pdf`);
    await generateInvoicePdf(outPath, meta, user, ownerInfo);

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
    console.log(`  ✅ PDF généré : ${outPath}`);
    console.log(`     ${buf.length} octets, ${btBlocks.length} blocs BT/ET`);
  }

  await pool.end();
}

run().catch(e => { console.error('ERREUR:', e.message, e.stack); pool.end(); process.exit(1); });
