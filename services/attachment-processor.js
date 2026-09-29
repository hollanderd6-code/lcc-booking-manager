'use strict';
// ── ATTACHMENTS-4/5 : téléchargement sécurisé + stockage Cloudinary ───────────
// Seul consommateur des lignes status='pending' dans message_attachments.
// Pas de binaire stocké en DB, pas d'URL signée loguée.

const axios      = require('axios');
const cloudinary = require('cloudinary').v2;
const dns        = require('dns').promises;

// ── Constantes ────────────────────────────────────────────────────────────────
const MAX_SIZE_BYTES    = 10 * 1024 * 1024;  // 10 MB
const DOWNLOAD_TIMEOUT  = 15000;             // 15 s
const MAX_ATTEMPTS      = 3;
const SIGNED_URL_TTL    = 3600;             // 1 heure

// Plages IPv4 privées / loopback — SSRF
const PRIVATE_RANGES = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^127\./,
  /^169\.254\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,  // CGNAT
];

// Signatures de fichiers autorisées
const MAGIC_SIGNATURES = [
  { type: 'image/jpeg',  sig: [0xFF, 0xD8] },
  { type: 'image/png',   sig: [0x89, 0x50] },
  { type: 'image/webp',  sig: [0x52, 0x49, 0x46, 0x46] },  // RIFF
  { type: 'video/mp4',   sig: [0x00, 0x00, 0x00], offset: 0, ftypOffset: 4, ftypSig: [0x66, 0x74, 0x79, 0x70] },
  { type: 'application/pdf', sig: [0x25, 0x50, 0x44, 0x46] },  // %PDF
];

// ── Validation URL (SSRF) ─────────────────────────────────────────────────────
async function validateSourceUrl(url) {
  if (typeof url !== 'string' || !url) return { ok: false, error: 'MISSING_URL' };

  let parsed;
  try { parsed = new URL(url); } catch { return { ok: false, error: 'INVALID_URL' }; }

  if (parsed.protocol !== 'https:') return { ok: false, error: 'NOT_HTTPS' };

  const allowlistRaw = process.env.CHANNEX_ATTACHMENT_ALLOWED_HOSTS || '';
  if (!allowlistRaw.trim()) return { ok: false, error: 'NO_ALLOWLIST' };

  const allowed = allowlistRaw.split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
  const host    = parsed.hostname.toLowerCase();

  const hostAllowed = allowed.some(pattern => {
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1); // e.g. ".amazonaws.com"
      return host === suffix.slice(1) || host.endsWith(suffix);
    }
    return host === pattern;
  });
  if (!hostAllowed) return { ok: false, error: 'HOST_NOT_ALLOWLISTED' };

  // Résolution DNS → vérifier IP non-privée
  let addresses;
  try {
    addresses = await dns.resolve4(host);
  } catch {
    return { ok: false, error: 'DNS_RESOLUTION_FAILED' };
  }
  for (const ip of addresses) {
    if (PRIVATE_RANGES.some(re => re.test(ip))) {
      return { ok: false, error: 'PRIVATE_IP_BLOCKED' };
    }
  }

  return { ok: true };
}

// ── Validation buffer (magic bytes) ──────────────────────────────────────────
function validateFileBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return { ok: false, error: 'BUFFER_TOO_SMALL' };
  if (buffer.length > MAX_SIZE_BYTES) return { ok: false, error: 'FILE_TOO_LARGE' };

  for (const def of MAGIC_SIGNATURES) {
    if (def.ftypOffset !== undefined) {
      // MP4: bytes[4..7] === 'ftyp'
      const hasFtyp = def.ftypSig.every((b, i) => buffer[def.ftypOffset + i] === b);
      if (hasFtyp) return { ok: true, detectedType: def.type };
      continue;
    }
    const match = def.sig.every((b, i) => buffer[i] === b);
    if (match) {
      // WEBP extra check: bytes[8..11] === 'WEBP'
      if (def.type === 'image/webp') {
        const webp = [0x57, 0x45, 0x42, 0x50];
        if (!webp.every((b, i) => buffer[8 + i] === b)) continue;
      }
      return { ok: true, detectedType: def.type };
    }
  }
  return { ok: false, error: 'UNSUPPORTED_FILE_TYPE' };
}

// ── Signed URL Cloudinary (ATTACHMENTS-5) ────────────────────────────────────
// Génère une URL temporaire (~1h) côté client. Ne jamais stocker en DB.
function buildSignedAttachmentUrl(att) {
  // 'sent' : outbound confirmé par l'OTA — le fichier est toujours dans Cloudinary
  if (!att || !att.cloudinary_public_id) return null;
  if (att.status !== 'stored' && att.status !== 'sent') return null;
  const resourceType = att.type === 'video' ? 'video' : att.type === 'image' ? 'image' : 'raw';
  try {
    return cloudinary.url(att.cloudinary_public_id, {
      type:          'authenticated',
      resource_type: resourceType,
      secure:        true,
      sign_url:      true,
      expires_at:    Math.floor(Date.now() / 1000) + SIGNED_URL_TTL,
    });
  } catch (e) {
    console.error('⚠️ [ATTACH-5] Cloudinary URL gen:', e.message);
    return null;
  }
}

// ── Sanitisation d'un attachment pour le client (ATTACHMENTS-5) ──────────────
// NE retourne jamais : source_url, cloudinary_public_id, provider_attachment_id,
//                      processing_attempts, last_error_code, last_attempt_at.
function sanitizeAttachmentForClient(att) {
  return {
    id:         att.id,
    type:       att.type,
    mime_type:  att.mime_type   || null,
    filename:   att.filename    || null,
    size_bytes: att.size_bytes  || null,
    status:     att.status,
    url:        buildSignedAttachmentUrl(att),
  };
}

// ── Batch : récupérer les attachments de N messages (anti-N+1) ───────────────
// Retourne un map { message_id → [attachment, …] }
async function fetchAttachmentsByMessageIds(messageIds, pool) {
  if (!messageIds || !messageIds.length) return {};
  try {
    const { rows } = await pool.query(
      `SELECT id, message_id, type, mime_type, filename, size_bytes,
              status, cloudinary_public_id
       FROM message_attachments
       WHERE message_id = ANY($1::int[])
       ORDER BY created_at ASC, id ASC`,
      [messageIds]
    );
    const map = {};
    for (const att of rows) {
      if (!map[att.message_id]) map[att.message_id] = [];
      map[att.message_id].push(sanitizeAttachmentForClient(att));
    }
    return map;
  } catch (e) {
    console.error('⚠️ [ATTACH-5] fetchAttachmentsByMessageIds:', e.message);
    return {};
  }
}

// ── Upload Cloudinary (chat-attachments, authenticated) ───────────────────────
function uploadAttachmentToCloudinary(buffer, publicId) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder:        'boostinghost/chat-attachments',
        public_id:     publicId,
        resource_type: 'auto',
        type:          'authenticated',
      },
      (err, result) => { if (err) reject(err); else resolve(result); }
    );
    const { Readable } = require('stream');
    Readable.from(buffer).pipe(stream);
  });
}

// ── Traitement d'un attachment (download → validate → Cloudinary → DB) ────────
// io est optionnel — s'il est fourni, émet attachment_updated après stockage.
async function processAttachment(attachmentId, pool, io) {
  const { rows } = await pool.query(
    `SELECT id, message_id, conversation_id, source_url, type, mime_type, filename,
            provider_attachment_id, processing_attempts
     FROM message_attachments
     WHERE id = $1 AND status = 'pending'`,
    [attachmentId]
  );
  if (!rows.length) return { skipped: true };

  const att = rows[0];

  // Incrémenter tentative AVANT le traitement (fail-safe : évite les boucles infinies)
  await pool.query(
    `UPDATE message_attachments
     SET processing_attempts = processing_attempts + 1, last_attempt_at = NOW()
     WHERE id = $1`,
    [att.id]
  );

  // 1. Valider URL
  const urlCheck = await validateSourceUrl(att.source_url);
  if (!urlCheck.ok) {
    await pool.query(
      `UPDATE message_attachments SET status = 'failed', last_error_code = $2, updated_at = NOW() WHERE id = $1`,
      [att.id, urlCheck.error]
    );
    console.warn(`⚠️ [ATTACH-4] #${att.id} URL rejetée : ${urlCheck.error}`);
    return { ok: false, error: urlCheck.error };
  }

  // 2. Télécharger
  let buffer;
  try {
    const resp = await axios.get(att.source_url, {
      responseType: 'arraybuffer',
      timeout:      DOWNLOAD_TIMEOUT,
      maxContentLength: MAX_SIZE_BYTES,
      maxBodyLength:    MAX_SIZE_BYTES,
    });
    buffer = Buffer.from(resp.data);
  } catch (err) {
    const errCode = err.code || (err.response ? `HTTP_${err.response.status}` : 'DOWNLOAD_ERROR');
    const attempts = (att.processing_attempts || 0) + 1;
    const newStatus = attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
    await pool.query(
      `UPDATE message_attachments SET status = $2, last_error_code = $3, updated_at = NOW() WHERE id = $1`,
      [att.id, newStatus, errCode]
    );
    console.warn(`⚠️ [ATTACH-4] #${att.id} téléchargement échoué (tentative ${attempts}) : ${errCode}`);
    return { ok: false, error: errCode };
  }

  // 3. Valider magic bytes
  const fileCheck = validateFileBuffer(buffer);
  if (!fileCheck.ok) {
    await pool.query(
      `UPDATE message_attachments SET status = 'failed', last_error_code = $2, updated_at = NOW() WHERE id = $1`,
      [att.id, fileCheck.error]
    );
    console.warn(`⚠️ [ATTACH-4] #${att.id} fichier invalide : ${fileCheck.error}`);
    return { ok: false, error: fileCheck.error };
  }

  // 4. Upload Cloudinary
  const publicId = `att_${att.id}_${Date.now()}`;
  let cloudResult;
  try {
    cloudResult = await uploadAttachmentToCloudinary(buffer, publicId);
  } catch (err) {
    const attempts = (att.processing_attempts || 0) + 1;
    const newStatus = attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
    await pool.query(
      `UPDATE message_attachments SET status = $2, last_error_code = $3, updated_at = NOW() WHERE id = $1`,
      [att.id, newStatus, 'CLOUDINARY_ERROR']
    );
    console.error(`⚠️ [ATTACH-4] #${att.id} erreur Cloudinary : ${err.message}`);
    return { ok: false, error: 'CLOUDINARY_ERROR' };
  }

  // 5. Mettre à jour DB : source_url → NULL, storage_url + public_id
  await pool.query(
    `UPDATE message_attachments
     SET status = 'stored',
         cloudinary_public_id = $2,
         storage_url = $3,
         source_url = NULL,
         updated_at = NOW()
     WHERE id = $1`,
    [att.id, cloudResult.public_id, cloudResult.secure_url]
  );

  console.log(`✅ [ATTACH-4] #${att.id} stocké → ${cloudResult.public_id}`);

  // 6. ATTACHMENTS-5 : notifier les clients via Socket.io (attachment_updated)
  if (io) {
    try {
      const signedUrl = buildSignedAttachmentUrl({
        status:              'stored',
        cloudinary_public_id: cloudResult.public_id,
        type:                att.type,
      });
      // Récupérer user_id via la conversation pour émettre dans la room hôte
      const convRow = await pool.query(
        'SELECT user_id FROM conversations WHERE id = $1',
        [att.conversation_id]
      );
      const payload = {
        attachment_id:   att.id,
        message_id:      att.message_id,
        conversation_id: att.conversation_id,
        status:          'stored',
        url:             signedUrl,
      };
      io.to(`conversation_${att.conversation_id}`).emit('attachment_updated', payload);
      if (convRow.rows[0]) {
        io.to(`user_${convRow.rows[0].user_id}`).emit('attachment_updated', payload);
      }
    } catch (e) {
      console.error('⚠️ [ATTACH-5] socket attachment_updated:', e.message);
    }
  }

  return { ok: true, public_id: cloudResult.public_id };
}

// ── Batch : traiter tous les pending éligibles ────────────────────────────────
async function processPendingAttachments(pool, io) {
  let rows;
  try {
    const res = await pool.query(
      `SELECT id FROM message_attachments
       WHERE status = 'pending'
         AND source_url IS NOT NULL
         AND processing_attempts < $1
       ORDER BY created_at ASC
       LIMIT 20`,
      [MAX_ATTEMPTS]
    );
    rows = res.rows;
  } catch (err) {
    console.error('⚠️ [ATTACH-4] Lecture pending échouée :', err.message);
    return;
  }

  if (!rows.length) return;
  console.log(`📎 [ATTACH-4] ${rows.length} attachment(s) pending à traiter`);

  for (const row of rows) {
    try {
      await processAttachment(row.id, pool, io);
    } catch (err) {
      console.error(`⚠️ [ATTACH-4] Exception #${row.id} :`, err.message);
    }
  }
}

module.exports = {
  validateSourceUrl,
  validateFileBuffer,
  processAttachment,
  processPendingAttachments,
  buildSignedAttachmentUrl,
  sanitizeAttachmentForClient,
  fetchAttachmentsByMessageIds,
};
