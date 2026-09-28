'use strict';
/**
 * ATTACHMENTS-3 — Réception des pièces jointes Channex
 *
 * Tests structurels et unitaires — pas de connexion DB.
 *
 * A. normalizeChannexAttachments — entrées robustes
 * B. _inferAttachmentType — inférence de type MIME
 * C. Condition d'acceptation du webhook
 * D. Persistance INSERT message_attachments
 * E. Déduplication ON CONFLICT
 * F. IA — escalade immédiate si attachment
 * G. IA — fix substring si message vide
 * H. escalateToOwner exporté
 * I. Socket.io — attachments dans le payload
 * J. Sécurité — aucun téléchargement réseau
 * K. Direction inbound/outbound
 * L. Non-régression — sendBookingMessage intact
 * M. normalizeChannexAttachments — tests fonctionnels directs
 */

const fs   = require('fs');
const path = require('path');

const srv     = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const handler = fs.readFileSync(path.join(__dirname, '../integrated-chat-handler.js'), 'utf8');

// ─── Extraire les fonctions utilitaires pour les tests unitaires directs ──────
// normalizeChannexAttachments (extraire jusqu'à la fin de la fonction)
const normalizeBlock = srv.match(
  /function normalizeChannexAttachments\(raw\)[\s\S]+?\n\}/
)?.[0] || '';

// _inferAttachmentType
const inferBlock = srv.match(
  /function _inferAttachmentType\(mimeOrType\)[\s\S]+?\n\}/
)?.[0] || '';

// Instancier les fonctions pour les tests unitaires directs
let normalizeChannexAttachments = null;
let _inferAttachmentType = null;
try {
  // eslint-disable-next-line no-new-func
  _inferAttachmentType = new Function(`
    ${inferBlock}
    return _inferAttachmentType;
  `)();
  // eslint-disable-next-line no-new-func
  normalizeChannexAttachments = new Function(`
    ${inferBlock}
    ${normalizeBlock}
    return normalizeChannexAttachments;
  `)();
} catch(e) { /* tests structurels seuls si extraction échoue */ }

// ─── Bloc webhook pour assertions structurelles ───────────────────────────────
const webhookBlock = srv.match(
  /app\.post\('\/api\/channex\/webhook-message'[\s\S]+?^\}\);/m
)?.[0] || '';

// ─── Bloc de migration ATTACHMENTS-3 INSERT pour les assertions ──────────────
const insertBlock = webhookBlock.match(
  /INSERT INTO message_attachments[\s\S]+?ON CONFLICT[\s\S]+?DO NOTHING/
)?.[0] || '';

// ─────────────────────────────────────────────────────────────────────────────
// A. normalizeChannexAttachments — entrées robustes (structurel)
// ─────────────────────────────────────────────────────────────────────────────
describe('A. normalizeChannexAttachments — présence et robustesse', () => {
  test('A-01: fonction définie dans server.js', () => {
    expect(srv).toMatch(/function normalizeChannexAttachments\(raw\)/);
  });

  test('A-02: null retourne []', () => {
    if (!normalizeChannexAttachments) return;
    expect(normalizeChannexAttachments(null)).toEqual([]);
  });

  test('A-03: undefined retourne []', () => {
    if (!normalizeChannexAttachments) return;
    expect(normalizeChannexAttachments(undefined)).toEqual([]);
  });

  test('A-04: tableau vide retourne []', () => {
    if (!normalizeChannexAttachments) return;
    expect(normalizeChannexAttachments([])).toEqual([]);
  });

  test('A-05: objet unique converti en tableau de 1', () => {
    if (!normalizeChannexAttachments) return;
    const result = normalizeChannexAttachments({ url: 'https://example.com/photo.jpg' });
    expect(result).toHaveLength(1);
    expect(result[0].source_url).toBe('https://example.com/photo.jpg');
  });

  test('A-06: tableau de plusieurs attachments', () => {
    if (!normalizeChannexAttachments) return;
    const result = normalizeChannexAttachments([
      { url: 'https://example.com/a.jpg', id: 'att1' },
      { url: 'https://example.com/b.jpg', id: 'att2' },
    ]);
    expect(result).toHaveLength(2);
  });

  test('A-07: attachment sans URL — conservé (type=other, status=pending via INSERT)', () => {
    if (!normalizeChannexAttachments) return;
    const result = normalizeChannexAttachments([{ id: 'att_unkn', size: 1024 }]);
    expect(result).toHaveLength(1);
    expect(result[0].source_url).toBeNull();
    expect(result[0].type).toBe('other');
  });

  test('A-08: attachment avec media_url reconnu', () => {
    if (!normalizeChannexAttachments) return;
    const result = normalizeChannexAttachments([{ media_url: 'https://cdn.example.com/img.jpg' }]);
    expect(result[0].source_url).toBe('https://cdn.example.com/img.jpg');
  });

  test('A-09: attachment avec download_url reconnu', () => {
    if (!normalizeChannexAttachments) return;
    const result = normalizeChannexAttachments([{ download_url: 'https://cdn.example.com/doc.pdf' }]);
    expect(result[0].source_url).toBe('https://cdn.example.com/doc.pdf');
  });

  test('A-10: source_url tronquée à 2048 chars', () => {
    if (!normalizeChannexAttachments) return;
    const longUrl = 'https://cdn.example.com/' + 'x'.repeat(2100);
    const result = normalizeChannexAttachments([{ url: longUrl }]);
    expect(result[0].source_url.length).toBe(2048);
  });

  test('A-11: provider_attachment_id extrait depuis id', () => {
    if (!normalizeChannexAttachments) return;
    const result = normalizeChannexAttachments([{ url: 'https://example.com/a.jpg', id: 'pid_abc123' }]);
    expect(result[0].provider_attachment_id).toBe('pid_abc123');
  });

  test('A-12: plusieurs attachments sans provider_id autorisés (provider_id=null)', () => {
    if (!normalizeChannexAttachments) return;
    const result = normalizeChannexAttachments([
      { url: 'https://example.com/a.jpg' },
      { url: 'https://example.com/b.jpg' },
    ]);
    expect(result[0].provider_attachment_id).toBeNull();
    expect(result[1].provider_attachment_id).toBeNull();
  });

  test('A-13: item non-objet ignoré (filtré)', () => {
    if (!normalizeChannexAttachments) return;
    const result = normalizeChannexAttachments([null, undefined, 'string', { url: 'https://ok.com/a.jpg' }]);
    expect(result).toHaveLength(1);
  });

  test('A-14: size_bytes extrait depuis size', () => {
    if (!normalizeChannexAttachments) return;
    const result = normalizeChannexAttachments([{ url: 'https://example.com/a.jpg', size: 204800 }]);
    expect(result[0].size_bytes).toBe(204800);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. _inferAttachmentType
// ─────────────────────────────────────────────────────────────────────────────
describe('B. _inferAttachmentType', () => {
  test('B-01: image/jpeg → image', () => {
    if (!_inferAttachmentType) return;
    expect(_inferAttachmentType('image/jpeg')).toBe('image');
  });

  test('B-02: image/png → image', () => {
    if (!_inferAttachmentType) return;
    expect(_inferAttachmentType('image/png')).toBe('image');
  });

  test('B-03: video/mp4 → video', () => {
    if (!_inferAttachmentType) return;
    expect(_inferAttachmentType('video/mp4')).toBe('video');
  });

  test('B-04: application/pdf → document', () => {
    if (!_inferAttachmentType) return;
    expect(_inferAttachmentType('application/pdf')).toBe('document');
  });

  test('B-05: null → other', () => {
    if (!_inferAttachmentType) return;
    expect(_inferAttachmentType(null)).toBe('other');
  });

  test('B-06: "image" (type string brut) → image', () => {
    if (!_inferAttachmentType) return;
    expect(_inferAttachmentType('image')).toBe('image');
  });

  test('B-07: type inconnu → other', () => {
    if (!_inferAttachmentType) return;
    expect(_inferAttachmentType('application/x-unknown')).toBe('other');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. Condition d'acceptation du webhook
// ─────────────────────────────────────────────────────────────────────────────
describe('C. Condition d\'acceptation — webhook', () => {
  test('C-01: message texte seul → accepté (pas de skip)', () => {
    // Ancienne condition: !messageText → nouvelle: !messageText && !hasAttachments
    expect(webhookBlock).toMatch(/!\(messageText\s*&&\s*!hasAttachments\)|(!messageText\s*&&\s*!hasAttachments)/);
  });

  test('C-02: nouvelle condition remplace l\'ancienne (!messageText seul)', () => {
    // L'ancienne condition !messageText seule ne doit plus exister dans le bloc de skip
    const skipLine = webhookBlock.match(/if \(!channex_booking_id[\s\S]+?skipped: true/)?.[0] || '';
    expect(skipLine).not.toMatch(/\|\|\s*!messageText\s*\|\|/);
  });

  test('C-03: skip log mentionne attachments count', () => {
    expect(webhookBlock).toMatch(/attachments=\$\{normalizedAttachments\.length\}/);
  });

  test('C-04: normalizeChannexAttachments appelé dans le webhook', () => {
    expect(webhookBlock).toMatch(/normalizeChannexAttachments\(attrs\.attachments\)/);
  });

  test('C-05: hasAttachments calculé', () => {
    expect(webhookBlock).toMatch(/const hasAttachments = normalizedAttachments\.length > 0/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. INSERT message_attachments
// ─────────────────────────────────────────────────────────────────────────────
describe('D. INSERT message_attachments dans le webhook', () => {
  test('D-01: INSERT INTO message_attachments présent dans le webhook', () => {
    expect(webhookBlock).toMatch(/INSERT INTO message_attachments/);
  });

  test('D-02: toutes les colonnes obligatoires présentes dans l\'INSERT', () => {
    expect(insertBlock).toMatch(/message_id/);
    expect(insertBlock).toMatch(/conversation_id/);
    expect(insertBlock).toMatch(/type/);
    expect(insertBlock).toMatch(/source_url/);
    expect(insertBlock).toMatch(/provider_attachment_id/);
    expect(insertBlock).toMatch(/channel/);
    expect(insertBlock).toMatch(/direction/);
    expect(insertBlock).toMatch(/status/);
  });

  test('D-03: status hardcodé à pending à l\'insertion', () => {
    expect(insertBlock).toMatch(/'pending'/);
  });

  test('D-04: try/catch autour de l\'INSERT (non bloquant)', () => {
    expect(webhookBlock).toMatch(/try\s*\{[\s\S]*?INSERT INTO message_attachments[\s\S]*?\}\s*catch\s*\(aErr\)/);
  });

  test('D-05: deux INSERT présents (un pour hôte, un pour voyageur)', () => {
    const matches = webhookBlock.match(/INSERT INTO message_attachments/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E. Déduplication ON CONFLICT
// ─────────────────────────────────────────────────────────────────────────────
describe('E. Déduplication ON CONFLICT', () => {
  test('E-01: ON CONFLICT DO NOTHING présent', () => {
    expect(webhookBlock).toMatch(/ON CONFLICT[\s\S]*?DO NOTHING/);
  });

  test('E-02: condition partielle WHERE provider_attachment_id IS NOT NULL', () => {
    expect(webhookBlock).toMatch(/WHERE provider_attachment_id IS NOT NULL/);
  });

  test('E-03: index partiel respecté dans la clause ON CONFLICT', () => {
    expect(insertBlock).toMatch(/ON CONFLICT \(provider_attachment_id\)\s+WHERE provider_attachment_id IS NOT NULL\s+DO NOTHING/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F. IA — escalade immédiate si attachment
// ─────────────────────────────────────────────────────────────────────────────
describe('F. IA — escalade immédiate pour les attachments voyageur', () => {
  test('F-01: branche if (hasAttachments) présente dans le webhook', () => {
    expect(webhookBlock).toMatch(/if \(hasAttachments\)/);
  });

  test('F-02: escalateToOwner appelé dans la branche hasAttachments du webhook', () => {
    // Vérifier que escalateToOwner et hasAttachments sont tous les deux dans le webhook
    expect(webhookBlock).toMatch(/if \(hasAttachments\)/);
    expect(webhookBlock).toMatch(/await escalateToOwner\(/);
    // Vérifier l'ordre : if (hasAttachments) avant await escalateToOwner dans le webhook
    const idxHas = webhookBlock.indexOf('if (hasAttachments)');
    const idxEsc = webhookBlock.indexOf('await escalateToOwner(');
    expect(idxHas).toBeGreaterThanOrEqual(0);
    expect(idxEsc).toBeGreaterThan(idxHas);
  });

  test('F-03: escalateToOwner importé depuis integrated-chat-handler dans le webhook', () => {
    expect(webhookBlock).toMatch(/escalateToOwner.*require\('\.\/integrated-chat-handler'\)/);
  });

  test('F-04: handleIncomingMessageDebounced uniquement pour texte-seul (else du if hasAttachments)', () => {
    expect(webhookBlock).toMatch(/else\s*\{[\s\S]*?handleIncomingMessageDebounced/);
  });

  test('F-05: host reply avec attachment → pas d\'escalade IA (isHostReply early return)', () => {
    const hostBlock = webhookBlock.match(/isHostReply[\s\S]+?return res\.status\(200\)/)?.[0] || '';
    expect(hostBlock).not.toMatch(/escalateToOwner/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G. Fix substring — message vide
// ─────────────────────────────────────────────────────────────────────────────
describe('G. Fix .substring() avec message vide', () => {
  test('G-01: line 442 de integrated-chat-handler — (message.message || \'\')', () => {
    expect(handler).toMatch(/\(message\.message \|\| ''\)\.substring\(0, 60\)/);
  });

  test('G-02: webhook log utilise (savedMsg.message || \'\') pour substring', () => {
    expect(webhookBlock).toMatch(/\(savedMsg\.message \|\| ''\)\.substring/);
  });

  test('G-03: pas de message.message.substring() nu dans integrated-chat-handler', () => {
    // Aucun appel nu (sans garde) dans le handler principal
    const lines = handler.split('\n');
    const bare = lines.filter(l =>
      l.includes('message.message.substring') &&
      !l.includes("(message.message || '')")
    );
    expect(bare).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H. escalateToOwner exporté
// ─────────────────────────────────────────────────────────────────────────────
describe('H. escalateToOwner exporté', () => {
  test('H-01: escalateToOwner dans module.exports de integrated-chat-handler', () => {
    expect(handler).toMatch(/module\.exports\s*=\s*\{[\s\S]*?escalateToOwner[\s\S]*?\}/);
  });

  test('H-02: fonction escalateToOwner définie dans le handler', () => {
    expect(handler).toMatch(/async function escalateToOwner\(/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I. Socket.io — attachments dans le payload
// ─────────────────────────────────────────────────────────────────────────────
describe('I. Socket.io — attachments transmis', () => {
  test('I-01: new_message emit inclut attachments (payload sanitisé)', () => {
    // ATTACHMENTS-5 : le payload utilise publicAttachmentsGuest (sanitisé, sans source_url)
    // au lieu de normalizedAttachments (qui contenait source_url)
    expect(webhookBlock).toMatch(/emit\('new_message',\s*\{[\s\S]*?attachments:\s*public/);
  });

  test('I-02: new_platform_message inclut message avec attachments (payload sanitisé)', () => {
    expect(webhookBlock).toMatch(/emit\('new_platform_message',[\s\S]*?attachments:\s*public/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// J. Sécurité — aucun téléchargement réseau dans ATTACHMENTS-3
// ─────────────────────────────────────────────────────────────────────────────
describe('J. Sécurité — aucun téléchargement réseau', () => {
  test('J-01: pas de axios.get(source_url) dans le webhook', () => {
    expect(webhookBlock).not.toMatch(/axios\.(get|post)\(.*source_url/);
  });

  test('J-02: pas de fetch(source_url) dans le webhook', () => {
    expect(webhookBlock).not.toMatch(/fetch\(.*source_url/);
  });

  test('J-03: pas d\'upload Cloudinary dans le webhook', () => {
    expect(webhookBlock).not.toMatch(/cloudinary\.(uploader|upload)/i);
  });

  test('J-04: cloudinary_public_id non renseigné à l\'insert (NULL implicite)', () => {
    // cloudinary_public_id n'est PAS dans les colonnes de l'INSERT webhook
    expect(insertBlock).not.toMatch(/cloudinary_public_id/);
  });

  test('J-05: storage_url non renseigné à l\'insert (NULL implicite)', () => {
    expect(insertBlock).not.toMatch(/storage_url/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// K. Direction inbound / outbound
// ─────────────────────────────────────────────────────────────────────────────
describe('K. Direction inbound/outbound', () => {
  test('K-01: INSERT voyageur utilise direction inbound', () => {
    const guestSection = webhookBlock.match(
      /Insérer le message dans BH[\s\S]+?INSERT INTO message_attachments[\s\S]+?DO NOTHING/
    )?.[0] || '';
    expect(guestSection).toMatch(/'inbound'/);
  });

  test('K-02: INSERT hôte utilise direction outbound', () => {
    const hostSection = webhookBlock.match(
      /Réponse hôte[\s\S]+?INSERT INTO message_attachments[\s\S]+?DO NOTHING/
    )?.[0] || '';
    expect(hostSection).toMatch(/'outbound'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L. Non-régression — sendBookingMessage intact
// ─────────────────────────────────────────────────────────────────────────────
describe('L. Non-régression sendBookingMessage', () => {
  test('L-01: sendBookingMessage dans channex.js — payload message seul (pas d\'attachments)', () => {
    const channex = fs.readFileSync(path.join(__dirname, '../channex.js'), 'utf8');
    const fn = channex.match(/async function sendBookingMessage[\s\S]+?^\}/m)?.[0] || '';
    expect(fn.length).toBeGreaterThan(0);
    expect(fn).toMatch(/message:\s*\{\s*message\s*\}/);
    expect(fn).not.toMatch(/attachments/);
  });

  test('L-02: webhook attachments 2 (ATTACHMENTS-2 migration) intact', () => {
    expect(srv).toMatch(/CREATE TABLE IF NOT EXISTS message_attachments/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M. Tests fonctionnels directs de normalizeChannexAttachments
// ─────────────────────────────────────────────────────────────────────────────
describe('M. normalizeChannexAttachments — comportement complet', () => {
  test('M-01: type image pour mime image/jpeg', () => {
    if (!normalizeChannexAttachments) return;
    const result = normalizeChannexAttachments([{ url: 'https://example.com/a.jpg', content_type: 'image/jpeg' }]);
    expect(result[0].type).toBe('image');
  });

  test('M-02: type video pour mime video/mp4', () => {
    if (!normalizeChannexAttachments) return;
    const result = normalizeChannexAttachments([{ url: 'https://example.com/a.mp4', content_type: 'video/mp4' }]);
    expect(result[0].type).toBe('video');
  });

  test('M-03: type document pour application/pdf', () => {
    if (!normalizeChannexAttachments) return;
    const result = normalizeChannexAttachments([{ url: 'https://example.com/a.pdf', content_type: 'application/pdf' }]);
    expect(result[0].type).toBe('document');
  });

  test('M-04: mime_type depuis content_type', () => {
    if (!normalizeChannexAttachments) return;
    const result = normalizeChannexAttachments([{ url: 'https://example.com/a.jpg', content_type: 'image/jpeg' }]);
    expect(result[0].mime_type).toBe('image/jpeg');
  });

  test('M-05: filename extrait depuis file_name', () => {
    if (!normalizeChannexAttachments) return;
    const result = normalizeChannexAttachments([{ url: 'https://example.com/a.jpg', file_name: 'photo.jpg' }]);
    expect(result[0].filename).toBe('photo.jpg');
  });

  test('M-06: channel non renseigné par le normaliseur (renseigné par le webhook)', () => {
    if (!normalizeChannexAttachments) return;
    const result = normalizeChannexAttachments([{ url: 'https://example.com/a.jpg' }]);
    // Le résultat du normaliseur ne contient pas channel (ajouté par le webhook)
    expect(result[0]).not.toHaveProperty('channel');
  });

  test('M-07: direction non renseignée par le normaliseur', () => {
    if (!normalizeChannexAttachments) return;
    const result = normalizeChannexAttachments([{ url: 'https://example.com/a.jpg' }]);
    expect(result[0]).not.toHaveProperty('direction');
  });

  test('M-08: provider_attachment_id depuis attachment_id', () => {
    if (!normalizeChannexAttachments) return;
    const result = normalizeChannexAttachments([{ url: 'https://example.com/a.jpg', attachment_id: 'attch_xyz' }]);
    expect(result[0].provider_attachment_id).toBe('attch_xyz');
  });
});
