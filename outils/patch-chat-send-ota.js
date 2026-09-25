'use strict';
// /api/chat/send : un message hôte sur une conversation Booking/Airbnb (Channex) part AUSSI vers la plateforme.
// En cas d'échec, une alerte visible est ajoutée dans la conversation. Idempotent, sauvegarde .bak-ota
// Usage : node outils/patch-chat-send-ota.js
const fs = require('fs'), path = require('path');
const f = path.join(__dirname, '../routes/chat_routes.js');
let s = fs.readFileSync(f, 'utf8');
if (s.includes('_filetOTA')) { console.log('Déjà appliqué.'); process.exit(0); }

const A = `      // Émettre via Socket.io
      if (io) {
        io.to(\`conversation_\${conversation_id}\`).emit('new_message', newMessage);
      }`;
const B = `      // _filetOTA : message hôte sur une conversation OTA → envoi vers la plateforme via Channex
      if ((sender_type === 'owner' || sender_type === 'property') && message && message.trim()) {
        let _bid = null;
        try {
          const _cx = await pool.query(
            \`SELECT COALESCE(c.channex_booking_id, r.channex_booking_id) AS bid
               FROM conversations c
               LEFT JOIN reservations r ON (
                 c.channex_booking_id IS NULL AND r.property_id = c.property_id
                 AND DATE(r.start_date) = DATE(c.reservation_start_date)
                 AND r.channex_booking_id IS NOT NULL AND r.status != 'cancelled')
              WHERE c.id = $1 LIMIT 1\`, [conversation_id]);
          _bid = _cx.rows[0]?.bid || null;
          if (_bid) {
            const { sendBookingMessage } = require('../channex');
            const _r = await sendBookingMessage(_bid, message);
            if (_r) {
              await pool.query('UPDATE messages SET delivered_at = NOW(), channex_message_id = $2 WHERE id = $1',
                [newMessage.id, _r.id || _r.data?.id || null]).catch(() => {});
              newMessage.delivered = true;
              console.log(\`✅ [CHAT SEND] Conv \${conversation_id} → plateforme (booking \${_bid})\`);
            } else {
              throw new Error('refusé par la plateforme (403/404)');
            }
          }
        } catch (e) {
          if (_bid) {
            newMessage.delivered = false;
            newMessage.delivery_error = e.message;
            console.error(\`❌ [CHAT SEND] Conv \${conversation_id} : message NON délivré sur la plateforme —\`, e.message);
            try {
              const _al = await pool.query(
                \`INSERT INTO messages (conversation_id, sender_type, sender_name, message, is_read, created_at)
                 VALUES ($1, 'system', 'Système', $2, TRUE, NOW()) RETURNING *\`,
                [conversation_id, '⚠️ Votre dernier message n\\'a PAS été délivré au voyageur sur la plateforme. Renvoyez-le ou répondez depuis l\\'extranet.']);
              if (io) io.to(\`conversation_\${conversation_id}\`).emit('new_message', _al.rows[0]);
            } catch (_) {}
          }
        }
      }

` + A;
const n = s.split(A).length - 1;
if (n !== 1) { console.error('❌ Motif trouvé ' + n + ' fois — rien modifié.'); process.exit(1); }
fs.writeFileSync(f + '.bak-ota', s);
s = s.replace(A, B);
fs.writeFileSync(f, s);
console.log('✅ /api/chat/send : messages hôte transmis à Booking/Airbnb + alerte si échec (sauvegarde .bak-ota)');
