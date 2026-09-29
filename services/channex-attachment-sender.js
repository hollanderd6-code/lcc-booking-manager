'use strict';
// ── ATTACHMENTS-7B : envoi des pièces jointes hôte → Channex → OTA ───────────
// Seul responsable du flux outbound : Cloudinary → base64 → Channex upload →
// Channex message. Ne touche jamais les attachments inbound (ATTACHMENTS-4).

const axios      = require('axios');
const cloudinary = require('cloudinary').v2;

// ── Constantes ────────────────────────────────────────────────────────────────
const MAX_SIZE_BYTES   = 10 * 1024 * 1024;  // 10 MB
const DOWNLOAD_TIMEOUT = 20000;             // 20 s (fichiers jusqu'à 10 MB)
const MAX_ATTEMPTS     = 3;
const SIGNED_URL_TTL   = 300;               // 5 min — usage unique (download interne)

// Types d'images autorisés en outbound (Channex confirme : images uniquement)
const OUTBOUND_ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Signatures magic bytes — images outbound uniquement
const OUTBOUND_MAGIC = [
  { type: 'image/jpeg', sig: [0xFF, 0xD8] },
  { type: 'image/png',  sig: [0x89, 0x50] },
  { type: 'image/webp', sig: [0x52, 0x49, 0x46, 0x46] }, // RIFF
];

// ── Validation buffer outbound (images seules) ────────────────────────────────
function validateOutboundImageBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12)
    return { ok: false, error: 'BUFFER_TOO_SMALL' };
  if (buffer.length > MAX_SIZE_BYTES)
    return { ok: false, error: 'FILE_TOO_LARGE' };

  for (const def of OUTBOUND_MAGIC) {
    const match = def.sig.every((b, i) => buffer[i] === b);
    if (match) {
      if (def.type === 'image/webp') {
        const webp = [0x57, 0x45, 0x42, 0x50]; // 'WEBP'
        if (!webp.every((b, i) => buffer[8 + i] === b)) continue;
      }
      return { ok: true, detectedType: def.type };
    }
  }
  return { ok: false, error: 'UNSUPPORTED_FILE_TYPE' };
}

// ── Capacité OTA outbound image ───────────────────────────────────────────────
// Channex confirme : Airbnb, Booking.com, Expedia standard.
// Les valeurs de platform dans la DB sont libres → normalisation par includes().
// Expedia Partner Solutions (EAN) : Channex indique no support.
// Nous ne pouvons pas distinguer EAN de standard via le champ platform.
// → Expedia is supported by supportsOutboundImage; EAN is an unknown edge case.
function supportsOutboundImage(platform) {
  if (!platform || typeof platform !== 'string') return false;
  const p = platform.toLowerCase().trim();
  if (p.includes('airbnb') || p === 'abb') return true;
  if (p.includes('booking') || p === 'bdc') return true;
  if (p.includes('expedia') || p === 'exp') return true;
  return false;
}

// ── Résolution OTA depuis les champs DB (PROD-FIX-7) ─────────────────────────
// conversations.platform peut être 'channex' quand ota_name était null à la
// création. Seul le transport générique 'channex' déclenche le fallback vers
// ota_name (de reservations). Les canaux 'direct', 'ical', etc. restent
// fail-closed — un ota_name parasite ne doit pas les élever en OTA supportée.
function resolveOutboundOta(platform, otaName) {
  const p   = String(platform || '').trim().toLowerCase();
  const ota = String(otaName  || '').trim().toLowerCase();
  if (p === 'channex') return ota;
  return p || ota;
}

// ── Téléchargement Cloudinary authenticated (usage interne) ──────────────────
async function downloadFromCloudinary(cloudinaryPublicId, attachmentType) {
  const resourceType = attachmentType === 'video' ? 'video'
    : attachmentType === 'image' ? 'image'
    : 'raw';

  const signedUrl = cloudinary.url(cloudinaryPublicId, {
    type:          'authenticated',
    resource_type: resourceType,
    secure:        true,
    sign_url:      true,
    expires_at:    Math.floor(Date.now() / 1000) + SIGNED_URL_TTL,
  });

  const resp = await axios.get(signedUrl, {
    responseType:      'arraybuffer',
    timeout:           DOWNLOAD_TIMEOUT,
    maxContentLength:  MAX_SIZE_BYTES,
    maxBodyLength:     MAX_SIZE_BYTES,
  });
  return Buffer.from(resp.data);
}

// ── Envoi d'un attachment outbound vers Channex ───────────────────────────────
// Flux : Cloudinary (authenticated) → buffer → base64 → POST /attachments
//     → provider_attachment_id sauvé → POST /bookings/:id/messages
//     → status = 'sent' → Socket.io attachment_updated
//
// Idempotence : si provider_attachment_id est déjà renseigné (upload Channex
// réussi mais envoi message échoué), l'upload est ignoré et on retente seulement
// l'envoi du message.
async function sendOutboundAttachment(attachmentId, pool, io) {
  // 1. Charger attachment + conversation + ota_name de la réservation liée
  // ota_name est en reservations, pas en conversations → sous-requête corrélée.
  // LIMIT 1 sur la sous-requête : conversation avec plusieurs révisions du même
  // booking_id théoriquement impossible, mais on évite tout risque de doublon.
  const { rows } = await pool.query(
    `SELECT ma.id, ma.message_id, ma.conversation_id, ma.type, ma.mime_type,
            ma.filename, ma.size_bytes, ma.cloudinary_public_id,
            ma.provider_attachment_id, ma.processing_attempts, ma.direction, ma.status,
            c.channex_booking_id, c.platform, c.user_id,
            (SELECT r.ota_name
             FROM reservations r
             WHERE (c.reservation_uid IS NOT NULL AND r.uid = c.reservation_uid)
                OR (c.channex_booking_id IS NOT NULL
                    AND r.channex_booking_id = c.channex_booking_id)
             ORDER BY r.updated_at DESC NULLS LAST
             LIMIT 1) AS ota_name
     FROM message_attachments ma
     JOIN conversations c ON c.id = ma.conversation_id
     WHERE ma.id = $1`,
    [attachmentId]
  );

  if (!rows.length) return { skipped: true, reason: 'not_found' };
  const att = rows[0];

  const resolvedOta = resolveOutboundOta(att.platform, att.ota_name);
  console.log(`[ATTACH-RUNTIME] sender start attachment=${attachmentId} platform="${att.platform || ''}" ota="${att.ota_name || ''}" resolved="${resolvedOta}"`); // FIX-6-C/7

  // 2. Guards préliminaires
  if (att.direction !== 'outbound') return { skipped: true, reason: 'not_outbound' };
  if (att.status === 'sent')        return { skipped: true, reason: 'already_sent' };
  if (att.status === 'failed')      return { skipped: true, reason: 'already_failed' };

  if (att.type !== 'image') {
    await pool.query(
      `UPDATE message_attachments SET status='failed', last_error_code='UNSUPPORTED_TYPE_OUTBOUND', updated_at=NOW() WHERE id=$1`,
      [att.id]
    );
    return { ok: false, error: 'UNSUPPORTED_TYPE_OUTBOUND' };
  }

  if ((att.size_bytes || 0) > MAX_SIZE_BYTES) {
    await pool.query(
      `UPDATE message_attachments SET status='failed', last_error_code='FILE_TOO_LARGE', updated_at=NOW() WHERE id=$1`,
      [att.id]
    );
    return { ok: false, error: 'FILE_TOO_LARGE' };
  }

  if (!att.cloudinary_public_id) {
    await pool.query(
      `UPDATE message_attachments SET status='failed', last_error_code='NO_CLOUDINARY_ID', updated_at=NOW() WHERE id=$1`,
      [att.id]
    );
    return { ok: false, error: 'NO_CLOUDINARY_ID' };
  }

  if (!att.channex_booking_id) {
    await pool.query(
      `UPDATE message_attachments SET status='failed', last_error_code='NO_CHANNEX_BOOKING_ID', updated_at=NOW() WHERE id=$1`,
      [att.id]
    );
    return { ok: false, error: 'NO_CHANNEX_BOOKING_ID' };
  }

  if (!supportsOutboundImage(resolvedOta)) {
    console.warn(`[ATTACH-RUNTIME] CHANNEL_NOT_SUPPORTED attachment=${att.id} resolved="${resolvedOta}"`); // FIX-6-C/7
    await pool.query(
      `UPDATE message_attachments SET status='failed', last_error_code='CHANNEL_NOT_SUPPORTED', updated_at=NOW() WHERE id=$1`,
      [att.id]
    );
    return { ok: false, error: 'CHANNEL_NOT_SUPPORTED' };
  }

  // 3. Incrémenter les tentatives AVANT le traitement (fail-safe boucle infinie)
  const currentAttempts = (att.processing_attempts || 0) + 1;
  await pool.query(
    `UPDATE message_attachments SET processing_attempts=$2, last_attempt_at=NOW(), updated_at=NOW() WHERE id=$1`,
    [att.id, currentAttempts]
  );

  const { uploadChannexAttachment, sendBookingAttachment } = require('../channex');

  // 4. Idempotence : réutiliser l'ID Channex si déjà uploadé
  let channexAttachmentId = att.provider_attachment_id || null;

  if (!channexAttachmentId) {
    // 4a. Télécharger depuis Cloudinary
    let buffer;
    try {
      buffer = await downloadFromCloudinary(att.cloudinary_public_id, att.type);
    } catch (err) {
      const errCode = err.code || (err.response ? `HTTP_${err.response.status}` : 'CLOUDINARY_DOWNLOAD_ERROR');
      const isFinal = currentAttempts >= MAX_ATTEMPTS;
      await pool.query(
        `UPDATE message_attachments SET status=$2, last_error_code=$3, updated_at=NOW() WHERE id=$1`,
        [att.id, isFinal ? 'failed' : 'stored', errCode]
      );
      console.warn(`⚠️ [ATTACH-7B] #${att.id} téléchargement Cloudinary échoué (tentative ${currentAttempts}) : ${errCode}`);
      return { ok: false, error: errCode, retryable: !isFinal };
    }

    // 4b. Revalider le buffer (images outbound uniquement)
    const fileCheck = validateOutboundImageBuffer(buffer);
    if (!fileCheck.ok) {
      await pool.query(
        `UPDATE message_attachments SET status='failed', last_error_code=$2, updated_at=NOW() WHERE id=$1`,
        [att.id, fileCheck.error]
      );
      return { ok: false, error: fileCheck.error };
    }

    if (!OUTBOUND_ALLOWED_TYPES.has(fileCheck.detectedType)) {
      await pool.query(
        `UPDATE message_attachments SET status='failed', last_error_code='MIME_NOT_ALLOWED_OUTBOUND', updated_at=NOW() WHERE id=$1`,
        [att.id]
      );
      return { ok: false, error: 'MIME_NOT_ALLOWED_OUTBOUND' };
    }

    // 4c. Upload vers Channex (ne jamais logger le base64 / buffer)
    const filename = att.filename || `image.${(fileCheck.detectedType.split('/')[1]) || 'jpg'}`;
    try {
      channexAttachmentId = await uploadChannexAttachment(buffer, filename, fileCheck.detectedType);
    } catch (err) {
      const status = err.response?.status;
      const isPermanent = (status === 400 || status === 422);
      const isFinal = isPermanent || currentAttempts >= MAX_ATTEMPTS;
      const errCode = status ? `CHANNEX_HTTP_${status}` : 'CHANNEX_UPLOAD_ERROR';
      await pool.query(
        `UPDATE message_attachments SET status=$2, last_error_code=$3, updated_at=NOW() WHERE id=$1`,
        [att.id, isFinal ? 'failed' : 'stored', errCode]
      );
      console.warn(`⚠️ [ATTACH-7B] #${att.id} upload Channex échoué (tentative ${currentAttempts}) : ${errCode}`);
      return { ok: false, error: errCode, retryable: !isFinal };
    }

    console.log(`[ATTACH-RUNTIME] Channex attachment uploaded id=${att.id}`); // FIX-6-C

    // 4d. Sauvegarder provider_attachment_id AVANT l'envoi (idempotence)
    await pool.query(
      `UPDATE message_attachments SET provider_attachment_id=$2, updated_at=NOW() WHERE id=$1`,
      [att.id, channexAttachmentId]
    );
  }

  // 5. Envoyer le message Channex avec attachment_id
  try {
    await sendBookingAttachment(att.channex_booking_id, channexAttachmentId);
  } catch (err) {
    const status = err.response?.status;
    const isPermanent = (status === 400 || status === 422 || status === 403 || status === 404);
    const isFinal = isPermanent || currentAttempts >= MAX_ATTEMPTS;
    const errCode = status ? `CHANNEX_SEND_HTTP_${status}` : 'CHANNEX_SEND_ERROR';
    await pool.query(
      `UPDATE message_attachments SET status=$2, last_error_code=$3, updated_at=NOW() WHERE id=$1`,
      [att.id, isFinal ? 'failed' : 'stored', errCode]
    );
    console.warn(`⚠️ [ATTACH-7B] #${att.id} envoi message Channex échoué (tentative ${currentAttempts}) : ${errCode}`);
    return { ok: false, error: errCode, retryable: !isFinal };
  }

  // 6. Succès confirmé — Channex API est synchrone, l'OTA a accepté
  await pool.query(
    `UPDATE message_attachments SET status='sent', last_error_code=NULL, updated_at=NOW() WHERE id=$1`,
    [att.id]
  );

  console.log(`[ATTACH-RUNTIME] Channex attachment message accepted id=${att.id}`); // FIX-6-C
  console.log(`✅ [ATTACH-7B] #${att.id} envoyé → Channex booking ${att.channex_booking_id}`);

  // 7. Socket.io — public uniquement (jamais base64, cloudinary_public_id, provider_attachment_id)
  if (io) {
    try {
      const payload = {
        attachment_id:   att.id,
        message_id:      att.message_id,
        conversation_id: att.conversation_id,
        status:          'sent',
        url:             null, // outbound sent : le client a déjà l'URL signed
      };
      io.to(`conversation_${att.conversation_id}`).emit('attachment_updated', payload);
      io.to(`user_${att.user_id}`).emit('attachment_updated', payload);
    } catch (e) {
      console.warn('⚠️ [ATTACH-7B] Socket.io emit error:', e.message);
    }
  }

  return { ok: true, channexAttachmentId };
}

// ── Traiter les attachments outbound en attente (cron + fallback) ─────────────
// Picks up 'stored' outbound images whose previous attempt failed but was retryable.
async function processPendingOutboundAttachments(pool, io) {
  try {
    const { rows } = await pool.query(
      `SELECT id FROM message_attachments
       WHERE direction = 'outbound'
         AND status = 'stored'
         AND type = 'image'
         AND processing_attempts < $1
       ORDER BY created_at ASC
       LIMIT 20`,
      [MAX_ATTEMPTS]
    );
    for (const row of rows) {
      await sendOutboundAttachment(row.id, pool, io);
    }
  } catch (e) {
    console.error('⚠️ [ATTACH-7B] processPendingOutboundAttachments:', e.message);
  }
}

module.exports = {
  sendOutboundAttachment,
  processPendingOutboundAttachments,
  validateOutboundImageBuffer,
  supportsOutboundImage,
  resolveOutboundOta,
};
