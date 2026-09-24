'use strict';
// Cron factures (runInvoiceQueue) : une réservation déjà facturée n'obtient JAMAIS de nouveau numéro.
// La demande est clôturée avec le numéro existant. Idempotent, sauvegarde server.js.bak-dedup
// Usage : node outils/patch-cron-facture-unique.js
const fs = require('fs'), path = require('path');
const f = path.join(__dirname, '../server.js');
let s = fs.readFileSync(f, 'utf8');
if (s.includes('_dejaFacturee')) { console.log('Déjà appliqué.'); process.exit(0); }

const A = `    for (const req of requests.rows) {
      try {
        const userId = req.user_id;`;
const B = `    for (const req of requests.rows) {
      try {
        const userId = req.user_id;
        // Une facture émise ne se refait pas : si la réservation a déjà un numéro, on le réutilise.
        if (req.reservation_uid) {
          const _dejaFacturee = await pool.query(
            \`SELECT invoice_number FROM invoice_requests
              WHERE reservation_uid = $1 AND status = 'sent' AND invoice_number IS NOT NULL AND id <> $2
             UNION ALL
             SELECT invoice_number FROM invoice_download_tokens
              WHERE file_path LIKE '{%' AND file_path::jsonb->>'reservationUid' = $1
             LIMIT 1\`,
            [req.reservation_uid, req.id]
          ).catch(() => ({ rows: [] }));
          if (_dejaFacturee.rows[0]) {
            await pool.query(
              \`UPDATE invoice_requests SET status = 'sent', invoice_number = $1, updated_at = NOW() WHERE id = $2\`,
              [_dejaFacturee.rows[0].invoice_number, req.id]
            );
            console.log(\`🔁 [INVOICE CRON] Résa \${req.reservation_uid} déjà facturée (\${_dejaFacturee.rows[0].invoice_number}) → pas de nouveau numéro\`);
            continue;
          }
        }`;
const n = s.split(A).length - 1;
if (n !== 1) { console.error('❌ Motif trouvé ' + n + ' fois — rien modifié.'); process.exit(1); }
fs.writeFileSync(f + '.bak-dedup', s);
s = s.replace(A, B);
fs.writeFileSync(f, s);
console.log('✅ runInvoiceQueue : plus de 2e facture pour une même réservation (sauvegarde .bak-dedup)');
