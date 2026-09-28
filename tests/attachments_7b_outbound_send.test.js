'use strict';
/**
 * ATTACHMENTS-7B — Envoi outbound Boostinghost → Channex → OTA
 *
 * Tests structurels — aucune connexion DB, aucun appel Channex réel.
 *
 * A. channex.js — uploadChannexAttachment
 * B. channex.js — sendBookingAttachment
 * C. channex-attachment-sender — validateOutboundImageBuffer
 * D. channex-attachment-sender — supportsOutboundImage
 * E. channex-attachment-sender — sendOutboundAttachment (flux complet)
 * F. Endpoint /api/chat/conversations/:id/attachments (route)
 * G. Multer — limite taille
 * H. Sécurité — pas de base64/secrets dans les logs/socket
 * I. Idempotence — réutilisation provider_attachment_id
 * J. Retry — erreurs temporaires vs définitives
 * K. Capacités OTA
 * L. Multi-images — indépendance des échecs
 * M. Socket.io — payload public
 * N. Non-régression legacy photo_data
 * O. Non-régression inbound ATTACHMENTS-4
 */

const fs   = require('fs');
const path = require('path');

const senderSrc  = fs.readFileSync(path.join(__dirname, '../services/channex-attachment-sender.js'), 'utf8');
const channexSrc = fs.readFileSync(path.join(__dirname, '../channex.js'), 'utf8');
const chatSrc    = fs.readFileSync(path.join(__dirname, '../routes/chat_routes.js'), 'utf8');
const srvSrc     = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

// ── A. uploadChannexAttachment ───────────────────────────────────────────────
describe('A. channex.js — uploadChannexAttachment', () => {
  test('A-01 : fonction définie', () => {
    expect(channexSrc).toMatch(/async\s+function\s+uploadChannexAttachment\s*\(/);
  });

  test('A-02 : POST /attachments', () => {
    const block = channexSrc.match(/function\s+uploadChannexAttachment[\s\S]*?^}/m);
    expect(block).toBeTruthy();
    expect(block[0]).toMatch(/\/attachments/);
    expect(block[0]).toMatch(/channexAPI\.post/);
  });

  test('A-03 : payload exact { attachment: { file, file_name, file_type } }', () => {
    const block = channexSrc.match(/function\s+uploadChannexAttachment[\s\S]*?^}/m);
    expect(block[0]).toMatch(/file_name/);
    expect(block[0]).toMatch(/file_type/);
    expect(block[0]).toMatch(/attachment:/);
  });

  test('A-04 : base64 via buffer.toString(base64)', () => {
    const block = channexSrc.match(/function\s+uploadChannexAttachment[\s\S]*?^}/m);
    expect(block[0]).toMatch(/toString\s*\(\s*['"]base64['"]\s*\)/);
  });

  test('A-05 : base64 jamais loggé (console.log interdit sur base64)', () => {
    const block = channexSrc.match(/function\s+uploadChannexAttachment[\s\S]*?^}/m);
    expect(block[0]).not.toMatch(/console\.log[\s\S]*base64/);
    expect(block[0]).not.toMatch(/console\.log[\s\S]*buffer/);
  });

  test('A-06 : ID récupéré dans res.data.data.id', () => {
    const block = channexSrc.match(/function\s+uploadChannexAttachment[\s\S]*?^}/m);
    expect(block[0]).toMatch(/res\.data[\s\S]*data[\s\S]*id|data\?\.data\?\.id/);
  });

  test('A-07 : erreur si ID absent de la réponse', () => {
    const block = channexSrc.match(/function\s+uploadChannexAttachment[\s\S]*?^}/m);
    expect(block[0]).toMatch(/throw|Error/);
    expect(block[0]).toMatch(/channexAttId|ID absent/);
  });

  test('A-08 : exporté dans module.exports', () => {
    expect(channexSrc).toMatch(/module\.exports[\s\S]*uploadChannexAttachment/);
  });
});

// ── B. sendBookingAttachment ─────────────────────────────────────────────────
describe('B. channex.js — sendBookingAttachment', () => {
  test('B-01 : fonction définie', () => {
    expect(channexSrc).toMatch(/async\s+function\s+sendBookingAttachment\s*\(/);
  });

  test('B-02 : POST /bookings/:id/messages', () => {
    const block = channexSrc.match(/function\s+sendBookingAttachment[\s\S]*?^}/m);
    expect(block).toBeTruthy();
    expect(block[0]).toMatch(/\/bookings\/.*\/messages/);
  });

  test('B-03 : payload { message: { attachment_id } }', () => {
    const block = channexSrc.match(/function\s+sendBookingAttachment[\s\S]*?^}/m);
    expect(block[0]).toMatch(/attachment_id/);
    expect(block[0]).toMatch(/message:\s*\{/);
  });

  test('B-04 : champ "message" (texte) ABSENT du payload', () => {
    const block = channexSrc.match(/function\s+sendBookingAttachment[\s\S]*?^}/m);
    // Le payload ne doit contenir que attachment_id — pas de champ message: "<texte>"
    expect(block[0]).not.toMatch(/message:\s*message\b/);
    expect(block[0]).not.toMatch(/message:\s*['"]/);
  });

  test('B-05 : exporté dans module.exports', () => {
    expect(channexSrc).toMatch(/module\.exports[\s\S]*sendBookingAttachment/);
  });
});

// ── C. validateOutboundImageBuffer ───────────────────────────────────────────
describe('C. validateOutboundImageBuffer', () => {
  const { validateOutboundImageBuffer } = require('../services/channex-attachment-sender');

  test('C-01 : JPEG accepté', () => {
    const buf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
    const r = validateOutboundImageBuffer(buf);
    expect(r.ok).toBe(true);
    expect(r.detectedType).toBe('image/jpeg');
  });

  test('C-02 : PNG accepté', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]);
    const r = validateOutboundImageBuffer(buf);
    expect(r.ok).toBe(true);
    expect(r.detectedType).toBe('image/png');
  });

  test('C-03 : WEBP accepté', () => {
    const buf = Buffer.alloc(12);
    buf.write('RIFF', 0, 'ascii');
    buf.writeUInt32LE(100, 4);
    buf.write('WEBP', 8, 'ascii');
    const r = validateOutboundImageBuffer(buf);
    expect(r.ok).toBe(true);
    expect(r.detectedType).toBe('image/webp');
  });

  test('C-04 : MP4 refusé', () => {
    const buf = Buffer.alloc(12, 0);
    buf.write('ftyp', 4, 'ascii');
    const r = validateOutboundImageBuffer(buf);
    expect(r.ok).toBe(false);
  });

  test('C-05 : PDF refusé (%PDF)', () => {
    const buf = Buffer.from('%PDF-1.4 test test test');
    const r = validateOutboundImageBuffer(buf);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('UNSUPPORTED_FILE_TYPE');
  });

  test('C-06 : SVG refusé (début XML)', () => {
    const buf = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">test</svg>');
    const r = validateOutboundImageBuffer(buf);
    expect(r.ok).toBe(false);
  });

  test('C-07 : fichier trop gros refusé', () => {
    const buf = Buffer.alloc(10 * 1024 * 1024 + 1, 0xFF);
    const r = validateOutboundImageBuffer(buf);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('FILE_TOO_LARGE');
  });

  test('C-08 : buffer trop petit refusé', () => {
    const buf = Buffer.from([0xFF, 0xD8]);
    const r = validateOutboundImageBuffer(buf);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('BUFFER_TOO_SMALL');
  });

  test('C-09 : 10 Mo exact — limite selon implémentation (< ou <=)', () => {
    // La limite est MAX_SIZE_BYTES = 10 * 1024 * 1024
    // Un buffer exactement à la limite doit passer la vérification de taille
    // (validateOutboundImageBuffer vérifie buffer.length > MAX_SIZE_BYTES)
    const buf = Buffer.alloc(10 * 1024 * 1024, 0x00);
    buf[0] = 0xFF; buf[1] = 0xD8; // JPEG header
    // La taille passe, mais le type peut être invalide (pas de fichier JPEG complet)
    // Ce test vérifie juste que l'erreur n'est PAS FILE_TOO_LARGE
    const r = validateOutboundImageBuffer(buf);
    expect(r.error).not.toBe('FILE_TOO_LARGE');
  });

  test('C-10 : faux MIME WEBP sans signature WEBP refusé', () => {
    const buf = Buffer.alloc(12, 0);
    buf.write('RIFF', 0, 'ascii'); // RIFF mais pas WEBP à l'offset 8
    buf.write('XXXX', 8, 'ascii');
    const r = validateOutboundImageBuffer(buf);
    expect(r.ok).toBe(false);
  });
});

// ── D. supportsOutboundImage ─────────────────────────────────────────────────
describe('D. supportsOutboundImage', () => {
  const { supportsOutboundImage } = require('../services/channex-attachment-sender');

  test('D-01 : Airbnb autorisé (lowercase)', () => {
    expect(supportsOutboundImage('airbnb')).toBe(true);
  });

  test('D-02 : Airbnb autorisé (Airbnb)', () => {
    expect(supportsOutboundImage('Airbnb')).toBe(true);
  });

  test('D-03 : abb autorisé', () => {
    expect(supportsOutboundImage('abb')).toBe(true);
  });

  test('D-04 : booking autorisé', () => {
    expect(supportsOutboundImage('booking')).toBe(true);
  });

  test('D-05 : booking.com autorisé', () => {
    expect(supportsOutboundImage('booking.com')).toBe(true);
  });

  test('D-06 : bdc autorisé', () => {
    expect(supportsOutboundImage('bdc')).toBe(true);
  });

  test('D-07 : expedia autorisé', () => {
    expect(supportsOutboundImage('expedia')).toBe(true);
  });

  test('D-08 : Expedia (majuscule) autorisé', () => {
    expect(supportsOutboundImage('Expedia')).toBe(true);
  });

  test('D-09 : canal inconnu refusé (fail-closed)', () => {
    expect(supportsOutboundImage('direct')).toBe(false);
  });

  test('D-10 : null refusé', () => {
    expect(supportsOutboundImage(null)).toBe(false);
  });

  test('D-11 : chaîne vide refusée', () => {
    expect(supportsOutboundImage('')).toBe(false);
  });

  test('D-12 : bhguest refusé', () => {
    expect(supportsOutboundImage('bhguest')).toBe(false);
  });

  test('D-13 : ical refusé', () => {
    expect(supportsOutboundImage('ical')).toBe(false);
  });
});

// ── E. sendOutboundAttachment — flux et guards ───────────────────────────────
describe('E. sendOutboundAttachment — structure du service', () => {
  test('E-01 : fonction exportée', () => {
    expect(senderSrc).toMatch(/module\.exports[\s\S]*sendOutboundAttachment/);
  });

  test('E-02 : guard direction !== outbound', () => {
    expect(senderSrc).toMatch(/direction\s*!==\s*['"]outbound['"]/);
  });

  test('E-03 : guard status sent déjà traité', () => {
    expect(senderSrc).toMatch(/status\s*===\s*['"]sent['"]/);
  });

  test('E-04 : guard type !== image → failed', () => {
    expect(senderSrc).toMatch(/type\s*!==\s*['"]image['"]/);
    expect(senderSrc).toMatch(/UNSUPPORTED_TYPE_OUTBOUND/);
  });

  test('E-05 : guard size > 10MB → failed', () => {
    expect(senderSrc).toMatch(/FILE_TOO_LARGE/);
    expect(senderSrc).toMatch(/size_bytes.*MAX_SIZE_BYTES|MAX_SIZE_BYTES.*size_bytes/);
  });

  test('E-06 : guard channex_booking_id absent → failed', () => {
    expect(senderSrc).toMatch(/NO_CHANNEX_BOOKING_ID/);
  });

  test('E-07 : guard canal non supporté → failed', () => {
    expect(senderSrc).toMatch(/CHANNEL_NOT_SUPPORTED/);
    expect(senderSrc).toMatch(/supportsOutboundImage/);
  });

  test('E-08 : guard cloudinary_public_id absent → failed', () => {
    expect(senderSrc).toMatch(/NO_CLOUDINARY_ID/);
  });

  test('E-09 : increment processing_attempts AVANT traitement', () => {
    const block = senderSrc.match(/sendOutboundAttachment[\s\S]*?module\.exports/);
    expect(block[0]).toMatch(/processing_attempts.*\+.*1|processing_attempts\s*\+=/);
  });

  test('E-10 : uploadChannexAttachment appelé', () => {
    expect(senderSrc).toMatch(/uploadChannexAttachment\s*\(/);
  });

  test('E-11 : provider_attachment_id sauvé AVANT sendBookingAttachment', () => {
    const idx_save = senderSrc.indexOf('provider_attachment_id=$2');
    const idx_send = senderSrc.indexOf('sendBookingAttachment(');
    expect(idx_save).toBeGreaterThan(0);
    expect(idx_send).toBeGreaterThan(idx_save);
  });

  test('E-12 : sendBookingAttachment appelé', () => {
    expect(senderSrc).toMatch(/sendBookingAttachment\s*\(/);
  });

  test('E-13 : status = sent après succès', () => {
    expect(senderSrc).toMatch(/status='sent'/);
  });

  test('E-14 : Socket.io émis après succès', () => {
    expect(senderSrc).toMatch(/emit\s*\(\s*['"]attachment_updated['"]/);
  });

  test('E-15 : Socket payload sans secrets (pas de base64/cloudinary_public_id)', () => {
    // payload est défini dans un bloc const { ... } puis passé à emit — on analyse le bloc payload
    const payloadBlock = senderSrc.match(/const\s+payload\s*=\s*\{[\s\S]*?\};/);
    expect(payloadBlock).toBeTruthy();
    expect(payloadBlock[0]).not.toMatch(/base64/);
    expect(payloadBlock[0]).not.toMatch(/cloudinary_public_id/);
    expect(payloadBlock[0]).not.toMatch(/provider_attachment_id/);
    expect(payloadBlock[0]).not.toMatch(/source_url/);
  });
});

// ── F. Endpoint upload ───────────────────────────────────────────────────────
describe('F. Route POST /api/chat/conversations/:id/attachments', () => {
  test('F-01 : endpoint défini', () => {
    expect(chatSrc).toMatch(/\/api\/chat\/conversations\/:id\/attachments/);
  });

  test('F-02 : authenticateAny requis', () => {
    const block = chatSrc.match(/\/api\/chat\/conversations\/:id\/attachments[\s\S]*?^\s*\)\s*;/m);
    expect(block).toBeTruthy();
    expect(block[0]).toMatch(/authenticateAny/);
  });

  test('F-03 : ownership check via comptes et getRealUserId', () => {
    const block = chatSrc.match(/\/api\/chat\/conversations\/:id\/attachments[\s\S]*?return res\.json/);
    expect(block).toBeTruthy();
    expect(block[0]).toMatch(/getRealUserId/);
    expect(block[0]).toMatch(/comptesAutorises/);
  });

  test('F-04 : 403 si compte différent', () => {
    const block = chatSrc.match(/\/api\/chat\/conversations\/:id\/attachments[\s\S]*?return res\.json/);
    expect(block[0]).toMatch(/403/);
    expect(block[0]).toMatch(/Accès refusé/);
  });

  test('F-05 : multipart/form-data via multer memoryStorage', () => {
    expect(chatSrc).toMatch(/multer.*memoryStorage|memoryStorage.*multer/);
  });

  test('F-06 : limite fichier 10 Mo dans multer', () => {
    expect(chatSrc).toMatch(/fileSize.*10.*1024.*1024|10\s*\*\s*1024\s*\*\s*1024/);
  });

  test('F-07 : 413 si fichier trop volumineux', () => {
    expect(chatSrc).toMatch(/413/);
    expect(chatSrc).toMatch(/LIMIT_FILE_SIZE/);
  });

  test('F-08 : validateOutboundImageBuffer appelé par image', () => {
    const block = chatSrc.match(/\/api\/chat\/conversations\/:id\/attachments[\s\S]*?results\.push/);
    expect(block).toBeTruthy();
    expect(block[0]).toMatch(/validateOutboundImageBuffer/);
  });

  test('F-09 : upload vers Cloudinary authenticated', () => {
    const block = chatSrc.match(/\/api\/chat\/conversations\/:id\/attachments[\s\S]*?cloudResult/);
    expect(block).toBeTruthy();
    expect(block[0]).toMatch(/type.*authenticated|authenticated.*type/);
    expect(block[0]).toMatch(/resource_type.*image/);
  });

  test('F-10 : dossier boostinghost/chat-attachments', () => {
    expect(chatSrc).toMatch(/boostinghost\/chat-attachments/);
  });

  test('F-11 : pas d\'écriture filesystem (pas de writeFileSync/writeFile)', () => {
    const block = chatSrc.match(/\/api\/chat\/conversations\/:id\/attachments[\s\S]*?setImmediate/);
    expect(block).toBeTruthy();
    expect(block[0]).not.toMatch(/writeFileSync|writeFile\b/);
    expect(block[0]).not.toMatch(/UPLOAD_DIR|chat-photos/);
  });

  test('F-12 : INSERT message avec message vide (outbound)', () => {
    const block = chatSrc.match(/\/api\/chat\/conversations\/:id\/attachments[\s\S]*?INSERT INTO message_attachments/);
    expect(block).toBeTruthy();
    expect(block[0]).toMatch(/INSERT INTO messages/);
    expect(block[0]).toMatch(/'property'/);
  });

  test('F-13 : direction outbound et status stored dans INSERT message_attachments', () => {
    expect(chatSrc).toMatch(/'outbound'/);
    expect(chatSrc).toMatch(/'stored'/);
    // Les deux valeurs sont dans le même INSERT VALUES
    expect(chatSrc).toMatch(/'outbound',\s*'stored'/s);
  });

  test('F-14 : setImmediate → sendOutboundAttachment', () => {
    expect(chatSrc).toMatch(/setImmediate[\s\S]*sendOutboundAttachment/);
  });

  test('F-15 : résultats détaillés par fichier', () => {
    expect(chatSrc).toMatch(/results\.push/);
  });

  test('F-16 : 422 si tous les fichiers rejetés', () => {
    expect(chatSrc).toMatch(/422/);
    expect(chatSrc).toMatch(/Tous les fichiers/);
  });

  test('F-17 : sanitisation du nom de fichier', () => {
    expect(chatSrc).toMatch(/safeFilename/);
  });

  test('F-18 : socket new_message émis avec attachment', () => {
    const block = chatSrc.match(/\/api\/chat\/conversations\/:id\/attachments[\s\S]*?setImmediate/);
    expect(block[0]).toMatch(/emit.*new_message/);
    expect(block[0]).toMatch(/attachments.*pubAtt|pubAtt.*attachments/);
  });
});

// ── G. Multer limite taille ───────────────────────────────────────────────────
describe('G. Multer — limite taille', () => {
  test('G-01 : fileSize configuré à exactement 10 MB', () => {
    expect(chatSrc).toMatch(/fileSize\s*:\s*10\s*\*\s*1024\s*\*\s*1024/);
  });

  test('G-02 : LIMIT_FILE_SIZE géré explicitement', () => {
    expect(chatSrc).toMatch(/LIMIT_FILE_SIZE/);
  });
});

// ── H. Sécurité — pas de base64/secrets dans logs ou socket ─────────────────
describe('H. Sécurité — base64 jamais exposé', () => {
  test('H-01 : base64 jamais loggé dans channex.js (uploadChannexAttachment)', () => {
    const block = channexSrc.match(/function\s+uploadChannexAttachment[\s\S]*?^}/m);
    expect(block[0]).not.toMatch(/console\.log[\s\S]{0,100}base64/);
  });

  test('H-02 : base64 jamais loggé dans channex-attachment-sender.js', () => {
    expect(senderSrc).not.toMatch(/console\.log[\s\S]{0,100}base64/);
  });

  test('H-03 : socket attachment_updated ne contient pas base64', () => {
    const socketEmit = senderSrc.match(/emit\s*\(\s*['"]attachment_updated['"][\s\S]{0,500}/);
    expect(socketEmit).toBeTruthy();
    expect(socketEmit[0]).not.toMatch(/base64/);
    expect(socketEmit[0]).not.toMatch(/cloudinary_public_id/);
  });

  test('H-04 : socket new_message dans la route ne contient pas cloudinary_public_id', () => {
    const routeEmit = chatSrc.match(/emit.*new_message[\s\S]{0,300}/);
    expect(routeEmit).toBeTruthy();
    expect(routeEmit[0]).not.toMatch(/cloudinary_public_id/);
  });
});

// ── I. Idempotence provider_attachment_id ────────────────────────────────────
describe('I. Idempotence — provider_attachment_id', () => {
  test('I-01 : provider_attachment_id lu depuis DB', () => {
    expect(senderSrc).toMatch(/provider_attachment_id/);
  });

  test('I-02 : si provider_attachment_id existant → upload Channex sauté', () => {
    // La variable channexAttachmentId est initialisée depuis att.provider_attachment_id
    expect(senderSrc).toMatch(/channexAttachmentId\s*=\s*att\.provider_attachment_id/);
  });

  test('I-03 : download Cloudinary conditionné sur !channexAttachmentId', () => {
    expect(senderSrc).toMatch(/if\s*\(\s*!channexAttachmentId\s*\)/);
  });

  test('I-04 : provider_attachment_id sauvé AVANT sendBookingAttachment', () => {
    const idx_set = senderSrc.indexOf('provider_attachment_id=$2');
    const idx_send = senderSrc.indexOf('sendBookingAttachment(');
    expect(idx_set).toBeGreaterThan(0);
    expect(idx_send).toBeGreaterThan(idx_set);
  });
});

// ── J. Retry — temporaire vs définitif ───────────────────────────────────────
describe('J. Retry — erreurs temporaires vs définitives', () => {
  test('J-01 : MAX_ATTEMPTS = 3', () => {
    expect(senderSrc).toMatch(/MAX_ATTEMPTS\s*=\s*3/);
  });

  test('J-02 : 400/422 → échec définitif (isPermanent)', () => {
    expect(senderSrc).toMatch(/400.*422|422.*400/);
    expect(senderSrc).toMatch(/isPermanent/);
  });

  test('J-03 : processing_attempts >= MAX_ATTEMPTS → failed', () => {
    expect(senderSrc).toMatch(/currentAttempts\s*>=\s*MAX_ATTEMPTS/);
  });

  test('J-04 : timeout/5xx → stored (retryable)', () => {
    // Si l'erreur est retryable et tentatives < MAX_ATTEMPTS → status reste 'stored'
    expect(senderSrc).toMatch(/isFinal\s*\?.*['"]failed['"].*:.*['"]stored['"]/);
  });

  test('J-05 : erreur Cloudinary download → stored si retryable', () => {
    expect(senderSrc).toMatch(/CLOUDINARY_DOWNLOAD_ERROR/);
  });

  test('J-06 : 403/404 Channex send → failed immédiat', () => {
    expect(senderSrc).toMatch(/403.*404|404.*403/);
  });

  test('J-07 : processPendingOutboundAttachments filtre processing_attempts < MAX_ATTEMPTS', () => {
    expect(senderSrc).toMatch(/processing_attempts\s*<\s*\$1|processing_attempts\s*<\s*MAX_ATTEMPTS/);
  });
});

// ── K. Capacités OTA ─────────────────────────────────────────────────────────
describe('K. supportsOutboundImage — capacités OTA confirmées', () => {
  const { supportsOutboundImage } = require('../services/channex-attachment-sender');

  test('K-01 : Airbnb → true', () => { expect(supportsOutboundImage('airbnb')).toBe(true); });
  test('K-02 : BookingCom → true', () => { expect(supportsOutboundImage('BookingCom')).toBe(true); });
  test('K-03 : Expedia → true', () => { expect(supportsOutboundImage('Expedia')).toBe(true); });
  test('K-04 : canal inconnu → false (fail-closed)', () => { expect(supportsOutboundImage('unknown_ota')).toBe(false); });
  test('K-05 : chaîne vide → false', () => { expect(supportsOutboundImage('')).toBe(false); });
});

// ── L. Multi-images — indépendance des échecs ────────────────────────────────
describe('L. Multi-images — indépendance', () => {
  test('L-01 : route itère sur req.files', () => {
    expect(chatSrc).toMatch(/for\s*\(\s*const\s+file\s+of\s+req\.files/);
  });

  test('L-02 : chaque fichier produit son propre résultat', () => {
    expect(chatSrc).toMatch(/results\.push.*ok.*filename|results\.push.*filename.*ok/);
  });

  test('L-03 : continue après échec d\'un fichier (pas de throw global)', () => {
    const block = chatSrc.match(/for\s*\(\s*const\s+file\s+of\s+req\.files[\s\S]*?setImmediate/);
    expect(block).toBeTruthy();
    // Le continue est présent pour passer au fichier suivant en cas d'erreur
    expect(block[0]).toMatch(/continue/);
  });

  test('L-04 : multer accepte jusqu\'à 5 fichiers', () => {
    expect(chatSrc).toMatch(/array\s*\(\s*['"]files['"]\s*,\s*5\s*\)/);
  });

  test('L-05 : un setImmediate par fichier réussi (pas un seul global)', () => {
    // Chaque fichier réussi déclenche son propre setImmediate dans la boucle
    const block = chatSrc.match(/for\s*\(\s*const\s+file\s+of\s+req\.files[\s\S]*?setImmediate/);
    expect(block).toBeTruthy();
    expect(block[0]).toMatch(/setImmediate/);
  });
});

// ── M. Socket.io — payload public ────────────────────────────────────────────
describe('M. Socket.io — payload public', () => {
  test('M-01 : attachment_updated émis dans la room conversation', () => {
    expect(senderSrc).toMatch(/conversation_\$\{att\.conversation_id\}.*attachment_updated|attachment_updated.*conversation_\$\{/);
  });

  test('M-02 : attachment_updated émis dans la room user', () => {
    expect(senderSrc).toMatch(/user_\$\{att\.user_id\}.*attachment_updated|attachment_updated.*user_\$\{att\.user_id\}/);
  });

  test('M-03 : payload contient attachment_id, message_id, conversation_id, status', () => {
    const payload = senderSrc.match(/attachment_id.*message_id.*conversation_id.*status|const\s+payload\s*=\s*\{[\s\S]*?attachment_id[\s\S]*?status/);
    expect(payload).toBeTruthy();
  });

  test('M-04 : source_url absent du payload socket', () => {
    const payloadBlock = senderSrc.match(/const\s+payload\s*=\s*\{[\s\S]*?\};/);
    expect(payloadBlock).toBeTruthy();
    expect(payloadBlock[0]).not.toMatch(/source_url/);
  });

  test('M-05 : provider_attachment_id absent du payload socket', () => {
    const payloadBlock = senderSrc.match(/const\s+payload\s*=\s*\{[\s\S]*?\};/);
    expect(payloadBlock).toBeTruthy();
    expect(payloadBlock[0]).not.toMatch(/provider_attachment_id/);
  });
});

// ── N. Non-régression legacy photo_data ──────────────────────────────────────
describe('N. Non-régression — photo_data legacy', () => {
  test('N-01 : /api/chat/send toujours présent', () => {
    expect(chatSrc).toMatch(/\/api\/chat\/send/);
  });

  test('N-02 : photo_data toujours accepté dans /api/chat/send', () => {
    const sendBlock = chatSrc.match(/\/api\/chat\/send[\s\S]*?photo_data/);
    expect(sendBlock).toBeTruthy();
  });

  test('N-03 : photo_url non supprimée des insertions messages legacy', () => {
    const sendBlock = chatSrc.match(/\/api\/chat\/send[\s\S]*?photo_url/);
    expect(sendBlock).toBeTruthy();
  });
});

// ── O. Non-régression ATTACHMENTS-4 inbound ──────────────────────────────────
describe('O. Non-régression ATTACHMENTS-4', () => {
  test('O-01 : processAttachment toujours exporté dans attachment-processor.js', () => {
    const procSrc = fs.readFileSync(path.join(__dirname, '../services/attachment-processor.js'), 'utf8');
    expect(procSrc).toMatch(/module\.exports[\s\S]*processAttachment/);
  });

  test('O-02 : processPendingAttachments toujours exporté', () => {
    const procSrc = fs.readFileSync(path.join(__dirname, '../services/attachment-processor.js'), 'utf8');
    expect(procSrc).toMatch(/module\.exports[\s\S]*processPendingAttachments/);
  });

  test('O-03 : cron */5 appelle toujours processPendingAttachments', () => {
    expect(srvSrc).toMatch(/processPendingAttachments[\s\S]*pool/);
  });

  test('O-04 : cron */5 appelle aussi processPendingOutboundAttachments', () => {
    expect(srvSrc).toMatch(/processPendingOutboundAttachments[\s\S]*pool/);
  });

  test('O-05 : ATTACHMENTS-4 direction inbound non touchée', () => {
    // Le service inbound (attachment-processor) ne doit pas utiliser sendBookingAttachment
    const procSrc = fs.readFileSync(path.join(__dirname, '../services/attachment-processor.js'), 'utf8');
    expect(procSrc).not.toMatch(/sendBookingAttachment/);
    expect(procSrc).not.toMatch(/uploadChannexAttachment/);
  });

  test('O-06 : MIME outbound n\'accepte pas video/mp4 ni application/pdf', () => {
    // OUTBOUND_ALLOWED_TYPES dans channex-attachment-sender.js
    expect(senderSrc).not.toMatch(/video\/mp4|application\/pdf/);
  });
});
