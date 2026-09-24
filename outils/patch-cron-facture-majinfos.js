'use strict';
// Cron factures : avant de renvoyer une facture existante, y reporter les infos client
// apportées par la nouvelle demande (même numéro, PDF régénéré à l'ouverture).
// À lancer APRÈS patch-cron-facture-renvoi.js. Idempotent, sauvegarde .bak-majinfos
// Usage : node outils/patch-cron-facture-majinfos.js
const fs = require('fs'), path = require('path');
const f = path.join(__dirname, '../server.js');
let s = fs.readFileSync(f, 'utf8');
if (s.includes('_majInfosClient')) { console.log('Déjà appliqué.'); process.exit(0); }

const A = `            // _renvoiExistante : on renvoie la facture déjà émise (lien valide le plus récent)
            try {`;
const B = `            // _majInfosClient : infos apportées par la nouvelle demande → reportées sur la facture existante
            try {
              const _maj = {};
              const _champs = { clientName: 'client_name', clientEmail: 'client_email', clientSiret: 'client_siret',
                                clientCompany: 'client_company', clientAddress: 'client_address',
                                clientPostalCode: 'client_postal_code', clientCity: 'client_city' };
              for (const [k, col] of Object.entries(_champs)) {
                if (req[col] && String(req[col]).trim()) _maj[k] = String(req[col]).trim();
              }
              if (Object.keys(_maj).length) {
                const _toks = await pool.query(
                  \`SELECT id, file_path FROM invoice_download_tokens WHERE invoice_number = $1\`, [_num]);
                let _n = 0;
                for (const t of _toks.rows) {
                  let m = {}; try { m = JSON.parse(t.file_path || '{}'); } catch (e) { continue; }
                  const avant = JSON.stringify(m);
                  Object.assign(m, _maj);
                  if (JSON.stringify(m) !== avant) {
                    await pool.query('UPDATE invoice_download_tokens SET file_path = $1 WHERE id = $2', [JSON.stringify(m), t.id]);
                    _n++;
                  }
                }
                if (_n) console.log(\`✏️ [INVOICE CRON] Facture \${_num} mise à jour avec les infos client :\`, Object.keys(_maj).join(', '));
              }
            } catch (e) { console.warn('⚠️ [INVOICE CRON] Mise à jour infos facture existante:', e.message); }
            // _renvoiExistante : on renvoie la facture déjà émise (lien valide le plus récent)
            try {`;
const n = s.split(A).length - 1;
if (n !== 1) { console.error('❌ Motif trouvé ' + n + ' fois — patch-cron-facture-renvoi.js est-il appliqué ? Rien modifié.'); process.exit(1); }
fs.writeFileSync(f + '.bak-majinfos', s);
s = s.replace(A, B);
fs.writeFileSync(f, s);
console.log('✅ runInvoiceQueue : infos client reportées sur la facture existante avant renvoi (sauvegarde .bak-majinfos)');
