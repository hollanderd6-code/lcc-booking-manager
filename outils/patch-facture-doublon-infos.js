'use strict';
// /api/invoice/create : quand la facture existe déjà (réponse "duplicate"), les infos client saisies
// (adresse, CP, ville, SIRET, société, email, téléphone) sont reportées sur la facture existante — même numéro.
// Idempotent, sauvegarde server.js.bak-dupinfos. Usage : node outils/patch-facture-doublon-infos.js
const fs = require('fs'), path = require('path');
const f = path.join(__dirname, '../server.js');
let s = fs.readFileSync(f, 'utf8');
if (s.includes('_majInfosFactureExistante')) { console.log('Déjà appliqué.'); process.exit(0); }

const helper = `
// Reporte sur une facture existante les infos client saisies lors d'une nouvelle tentative (même numéro).
async function _majInfosFactureExistante(pool, invoiceNumber, body) {
  if (!invoiceNumber || !body) return;
  const champs = {
    clientName: ['clientName', 'client_name'], clientEmail: ['clientEmail', 'client_email'],
    clientAddress: ['clientAddress', 'client_address'], clientPostalCode: ['clientPostalCode', 'client_postal_code'],
    clientCity: ['clientCity', 'client_city'], clientSiret: ['clientSiret', 'client_siret'],
    clientCompany: ['clientCompany', 'client_company'], clientPhone: ['clientPhone', 'client_phone', 'phone']
  };
  const maj = {};
  for (const [k, keys] of Object.entries(champs)) {
    const v = keys.map(x => body[x]).find(x => x != null && String(x).trim() !== '');
    if (v != null) maj[k] = String(v).trim();
  }
  if (!Object.keys(maj).length) return;
  try {
    const toks = await pool.query('SELECT token, file_path FROM invoice_download_tokens WHERE invoice_number = $1', [invoiceNumber]);
    for (const t of toks.rows) {
      let m; try { m = JSON.parse(t.file_path || '{}'); } catch (e) { continue; }
      const avant = JSON.stringify(m);
      Object.assign(m, maj);
      if (JSON.stringify(m) !== avant) {
        await pool.query('UPDATE invoice_download_tokens SET file_path = $1 WHERE token = $2', [JSON.stringify(m), t.token]);
      }
    }
    console.log(\`✏️ [INVOICE] \${invoiceNumber} existante complétée :\`, Object.keys(maj).join(', '));
  } catch (e) { console.warn('⚠️ [INVOICE] Mise à jour infos facture existante:', e.message); }
}
`;

const routeAnchor = "app.post('/api/invoice/create'";
if (s.split(routeAnchor).length !== 2) { console.error('❌ Route /api/invoice/create introuvable — rien modifié.'); process.exit(1); }

// Insère l'appel avant chaque "return res.json({ … duplicate: true … })" de la route
const start = s.indexOf(routeAnchor);
const end = (() => { const i = s.indexOf('\napp.', start + 10); return i === -1 ? s.length : i; })();
let route = s.slice(start, end);
let count = 0;
route = route.replace(/(\n[ \t]*)return res\.json\(\{([^}]*?duplicate: true[^}]*?)\}\);/g, (m, indent, inner) => {
  const im = inner.match(/invoiceNumber:\s*([^,\n]+)/);
  if (!im) return m;
  count++;
  return `${indent}await _majInfosFactureExistante(pool, ${im[1].trim()}, req.body);${m}`;
});
if (!count) { console.error('❌ Aucune réponse "duplicate" trouvée dans la route — rien modifié.'); process.exit(1); }

fs.writeFileSync(f + '.bak-dupinfos', s);
s = s.slice(0, start) + helper.trimStart() + '\n' + route + s.slice(end);
fs.writeFileSync(f, s);
console.log(`✅ /api/invoice/create : infos reportées sur la facture existante (${count} point(s) de retour) — sauvegarde .bak-dupinfos`);
