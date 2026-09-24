'use strict';
// Cron factures : réservation déjà facturée → RENVOI de la facture existante (même numéro, même lien)
// dans la conversation + sur la plateforme (Channex). À lancer APRÈS patch-cron-facture-unique.js.
// Idempotent, sauvegarde server.js.bak-renvoi. Usage : node outils/patch-cron-facture-renvoi.js
const fs = require('fs'), path = require('path');
const f = path.join(__dirname, '../server.js');
let s = fs.readFileSync(f, 'utf8');
if (s.includes('_renvoiExistante')) { console.log('Déjà appliqué.'); process.exit(0); }

const A = `            console.log(\`🔁 [INVOICE CRON] Résa \${req.reservation_uid} déjà facturée (\${_dejaFacturee.rows[0].invoice_number}) → pas de nouveau numéro\`);
            continue;`;
const B = `            const _num = _dejaFacturee.rows[0].invoice_number;
            console.log(\`🔁 [INVOICE CRON] Résa \${req.reservation_uid} déjà facturée (\${_num}) → renvoi, pas de nouveau numéro\`);
            // _renvoiExistante : on renvoie la facture déjà émise (lien valide le plus récent)
            try {
              const _tok = await pool.query(
                \`SELECT token FROM invoice_download_tokens
                  WHERE invoice_number = $1 AND expires_at > NOW()
                  ORDER BY created_at DESC LIMIT 1\`, [_num]);
              const _appUrl = (process.env.APP_URL || 'https://boostinghost.fr').replace(/\\/$/, '');
              const _url = _tok.rows[0] ? \`\${_appUrl}/api/invoice/download/\${_tok.rows[0].token}\` : null;
              const _conv = await pool.query(
                'SELECT id, channex_booking_id FROM conversations WHERE id = $1 LIMIT 1', [req.conversation_id]);
              const _c = _conv.rows[0];
              if (_c && _url) {
                const _msg = \`📄 Voici à nouveau votre facture \${_num}.\\n\\n📥 Télécharger : \${_url}\\n(lien valable 1 an)\`;
                await sendAutomatedMessage(_c.id, _msg, io);
                if (_c.channex_booking_id) {
                  try {
                    await require('./channex').sendBookingMessage(_c.channex_booking_id,
                      \`Voici à nouveau votre facture \${_num} : \${_url} (lien valable 1 an)\`);
                  } catch (e) { console.warn('⚠️ [INVOICE CRON] Renvoi Channex:', e.message, JSON.stringify(e.response?.data || {})); }
                }
                console.log(\`✅ [INVOICE CRON] Facture \${_num} renvoyée (conv \${_c.id})\`);
              } else {
                console.warn(\`⚠️ [INVOICE CRON] Renvoi \${_num} impossible (conversation ou lien introuvable)\`);
              }
            } catch (e) { console.warn('⚠️ [INVOICE CRON] Erreur renvoi facture existante:', e.message); }
            continue;`;
const n = s.split(A).length - 1;
if (n !== 1) { console.error('❌ Motif trouvé ' + n + ' fois — patch-cron-facture-unique.js est-il appliqué ? Rien modifié.'); process.exit(1); }
fs.writeFileSync(f + '.bak-renvoi', s);
s = s.replace(A, B);
fs.writeFileSync(f, s);
console.log('✅ runInvoiceQueue : facture existante renvoyée au lieu d\'être ignorée (sauvegarde .bak-renvoi)');
