'use strict';
/**
 * ATTACHMENTS-10 — BH DISPLAY + LIVE UPDATE
 *
 * Y. URL signée outbound — buildSignedAttachmentUrl + sanitizeAttachmentForClient
 *    BH-01 : outbound stored  → URL affichable
 *    BH-02 : outbound sent    → URL affichable (FIX-10)
 *    BH-03 : status pending   → url=null
 *    BH-04 : status failed    → url=null
 *    BH-05 : cloudinary_public_id absent → url=null (peu importe status)
 *
 * Z. Frontend structure — analyse statique de chat-owner.js
 *    BH-06 : _sendOutboundImages parse la réponse POST et injecte via appendMessage
 *    BH-07 : socket new_message utilise _getActiveConversationId() (String())
 *    BH-08 : socket attachment_updated utilise _getActiveConversationId()
 *    BH-09 : _bhRenderOneAttachment — status sent + url → pas de "Pièce jointe indisponible"
 *    BH-10 : _bhRenderOneAttachment — !url → "Pièce jointe indisponible"
 *    BH-11 : messages.html join_conversation envoie hostToken
 *    BH-12 : nouveau message POST response inclut le champ message
 *    BH-13 : [ATTACH-LIVE-FRONT] logs dans new_message et renderFromPost
 */

// ── Mock cloudinary (utilisé par buildSignedAttachmentUrl) ────────────────────
jest.mock('cloudinary', () => ({
  v2: {
    url: jest.fn((publicId, opts) => {
      if (!publicId) throw new Error('publicId manquant');
      return `https://res.cloudinary.example/image/authenticated/s--sig--/${publicId}.jpg`;
    }),
  },
}), { virtual: false });

const { buildSignedAttachmentUrl, sanitizeAttachmentForClient } = require('../services/attachment-processor');

const fs   = require('fs');
const path = require('path');
const src  = fs.readFileSync(path.join(__dirname, '../public/js/chat-owner.js'), 'utf8');
const msgHtml = fs.readFileSync(path.join(__dirname, '../public/messages.html'), 'utf8');
const chatRoutesSrc = fs.readFileSync(path.join(__dirname, '../routes/chat_routes.js'), 'utf8');

// ── Y. URL signée outbound ────────────────────────────────────────────────────
describe('Y. PROD-FIX-10 — buildSignedAttachmentUrl / sanitizeAttachmentForClient', () => {

  const baseAtt = {
    id: 1, type: 'image', mime_type: 'image/jpeg', filename: 'photo.jpg',
    size_bytes: 50000, cloudinary_public_id: 'boostinghost/chat-attachments/out_123',
  };

  // BH-01 : outbound stored → URL générée
  test('BH-01 : outbound stored → url présente', () => {
    const att = { ...baseAtt, status: 'stored' };
    expect(buildSignedAttachmentUrl(att)).toBeTruthy();
    const pub = sanitizeAttachmentForClient(att);
    expect(pub.url).toBeTruthy();
    expect(pub).not.toHaveProperty('cloudinary_public_id');
  });

  // BH-02 : outbound sent → URL générée (FIX-10 — était null avant)
  test('BH-02 : outbound sent → url présente (FIX-10)', () => {
    const att = { ...baseAtt, status: 'sent' };
    const url = buildSignedAttachmentUrl(att);
    expect(url).toBeTruthy();
    const pub = sanitizeAttachmentForClient(att);
    expect(pub.url).toBeTruthy();
  });

  // BH-03 : status pending → url null
  test('BH-03 : status pending → url=null', () => {
    expect(buildSignedAttachmentUrl({ ...baseAtt, status: 'pending' })).toBeNull();
  });

  // BH-04 : status failed → url null
  test('BH-04 : status failed → url=null', () => {
    expect(buildSignedAttachmentUrl({ ...baseAtt, status: 'failed' })).toBeNull();
  });

  // BH-05 : cloudinary_public_id absent → url null (peu importe status)
  test('BH-05 : cloudinary_public_id absent → url=null même si sent', () => {
    expect(buildSignedAttachmentUrl({ ...baseAtt, status: 'sent', cloudinary_public_id: null })).toBeNull();
    expect(buildSignedAttachmentUrl({ ...baseAtt, status: 'stored', cloudinary_public_id: '' })).toBeNull();
  });

  // BH-05b : sanitizeAttachmentForClient ne leake jamais cloudinary_public_id
  test('BH-05b : sanitizeAttachmentForClient ne retourne pas cloudinary_public_id', () => {
    const pub = sanitizeAttachmentForClient({ ...baseAtt, status: 'sent' });
    expect(pub).not.toHaveProperty('cloudinary_public_id');
    expect(pub).not.toHaveProperty('source_url');
    expect(pub).not.toHaveProperty('provider_attachment_id');
  });
});

// ── Z. Analyse statique chat-owner.js ────────────────────────────────────────
describe('Z. PROD-FIX-10 — chat-owner.js structure live update', () => {

  // BH-06 : _sendOutboundImages parse la réponse et appelle appendMessage
  test('BH-06 : _sendOutboundImages injecte le message depuis la réponse POST', () => {
    const block = src.match(/async function _sendOutboundImages[\s\S]*?^\}/m)?.[0] || '';
    expect(block).toMatch(/r\.message/);
    expect(block).toMatch(/appendMessage\(/);
    expect(block).toMatch(/ATTACH-LIVE-FRONT.*message rendered/);
  });

  // BH-07 : socket new_message utilise _getActiveConversationId() avec String()
  test('BH-07 : socket new_message compare via String(_getActiveConversationId())', () => {
    // Extraire le handler par indexOf pour éviter regex arrêtée sur le premier });
    const startIdx = src.indexOf("socket.on('new_message'");
    const block = startIdx !== -1 ? src.substring(startIdx, startIdx + 800) : '';
    expect(block).toMatch(/_getActiveConversationId\(\)/);
    expect(block).toMatch(/String\(message\.conversation_id\)\s*===\s*String\(/);
    // Ne doit plus comparer directement currentConversationId sans conversion
    expect(block).not.toMatch(/message\.conversation_id\s*===\s*currentConversationId\b/);
  });

  // BH-08 : socket attachment_updated utilise _getActiveConversationId()
  test('BH-08 : socket attachment_updated utilise _getActiveConversationId()', () => {
    const startIdx = src.indexOf("socket.on('attachment_updated'");
    const block = startIdx !== -1 ? src.substring(startIdx, startIdx + 400) : '';
    expect(block).toMatch(/_getActiveConversationId\(\)/);
    expect(block).toMatch(/String\(/);
    // Ne doit plus tester !currentConversationId directement
    expect(block).not.toMatch(/!\s*currentConversationId\s*\|\|.*data\.conversation_id\s*!==\s*currentConversationId/);
  });

  // BH-09 : _bhRenderOneAttachment — logique status sent + url → pas de "indisponible"
  test('BH-09 : _bhRenderOneAttachment — sent+url passe le guard failed/!url', () => {
    // Le guard est : (att.status === 'failed' || !att.url)
    // Avec status='sent' et url présente : les deux conditions sont fausses → on continue vers <img>
    const block = src.match(/function _bhRenderOneAttachment[\s\S]*?^}/m)?.[0] || '';
    // Le guard ne doit pas inclure status==='sent' comme cas bloquant
    expect(block).not.toMatch(/status\s*===\s*['"]sent['"]\s*\|\|\s*!att\.url/);
    expect(block).not.toMatch(/\['failed','sent'\]\.includes\(att\.status\)/);
    // Le guard existant : failed OU !url — avec url présente même si sent → image rendue
    expect(block).toMatch(/att\.status\s*===\s*['"]failed['"]\s*\|\|\s*!att\.url/);
  });

  // BH-10 : _bhRenderOneAttachment — !url (quel que soit status non-failed) → "Pièce jointe indisponible"
  test('BH-10 : _bhRenderOneAttachment — !url → "Pièce jointe indisponible"', () => {
    const block = src.match(/function _bhRenderOneAttachment[\s\S]*?^}/m)?.[0] || '';
    expect(block).toMatch(/Pièce jointe indisponible/);
    // Le chemin !url doit produire cet affichage
    const failBlock = block.match(/!att\.url[\s\S]{0,200}Pièce jointe indisponible/)?.[0] || '';
    expect(failBlock).toBeTruthy();
  });

  // BH-11 : log ATTACH-LIVE-FRONT dans new_message
  test('BH-11 : log ATTACH-LIVE-FRONT dans le handler new_message', () => {
    const block = src.match(/socket\.on\('new_message'[\s\S]*?\}\s*\);/m)?.[0] || '';
    expect(block).toMatch(/ATTACH-LIVE-FRONT.*new_message received/);
    // Pas de donnée voyageur dans le log
    expect(block).not.toMatch(/guest_name|guest_email|phone/);
  });
});

// ── messages.html — join_conversation avec hostToken ─────────────────────────
describe('Z2. PROD-FIX-10 — messages.html socket join avec token', () => {

  // BH-12 : join_conversation envoie un objet avec conversationId ET hostToken
  test('BH-12 : messages.html join_conversation inclut hostToken', () => {
    // Chercher la zone du patchOpenChat
    const patchBlock = msgHtml.match(/patchOpenChat[\s\S]*?window\.openChat\._bhPatched/)?.[0] || '';
    expect(patchBlock).toMatch(/join_conversation/);
    // Doit passer un objet (pas juste le conversationId brut)
    expect(patchBlock).toMatch(/hostToken/);
    // Doit lire le token depuis localStorage
    expect(patchBlock).toMatch(/localStorage\.getItem/);
    // Ne doit plus envoyer le conversationId seul (sans objet)
    expect(patchBlock).not.toMatch(/sock\.emit\('join_conversation',\s*conversationId\s*\)/);
  });

  // BH-13 : chat_routes.js — la réponse POST /attachments inclut message
  test('BH-13 : POST /attachments résultat inclut message: msgWithAtt', () => {
    const block = chatRoutesSrc.match(/results\.push\(\{[\s\S]{0,300}message_id.*\}/m)?.[0] || '';
    expect(block).toMatch(/message\s*:\s*msgWithAtt/);
  });

  // BH-14 : hostToken lu depuis 'lcc_token' (clé canonique)
  test('BH-14 : join_conversation lit hostToken depuis lcc_token (clé canonique)', () => {
    const patchBlock = msgHtml.match(/patchOpenChat[\s\S]*?window\.openChat\._bhPatched/)?.[0] || '';
    // La clé canonique utilisée dans toute l'application
    expect(patchBlock).toMatch(/localStorage\.getItem\(['"']lcc_token['"']\)/);
    // Aucune nouvelle clé localStorage inventée
    expect(patchBlock).not.toMatch(/getItem\(['"]auth_token['"]\)/);
    expect(patchBlock).not.toMatch(/getItem\(['"]access_token['"]\)/);
    expect(patchBlock).not.toMatch(/getItem\(['"]jwt_token['"]\)/);
  });
});

// ── Section F — attachment_updated sent : URL préservée ───────────────────────
describe('Z3. PROD-FIX-10 — attachment_updated sent préserve l\'URL existante', () => {

  // BH-LIVE-01 : handler status='sent' n'appelle ni replaceChild ni change img.src
  test('BH-LIVE-01 : attachment_updated sent → badge seulement, URL non écrasée', () => {
    // Le bloc status='sent' commence après le commentaire "Outbound confirmé"
    const sentCommentIdx = src.indexOf('// Outbound confirmé envoyé vers');
    const sentBlock = sentCommentIdx !== -1 ? src.substring(sentCommentIdx, sentCommentIdx + 600) : '';
    // Doit exister
    expect(sentBlock).toMatch(/data\.status\s*===\s*'sent'/);
    // Doit uniquement ajouter un badge (appendChild)
    expect(sentBlock).toMatch(/appendChild/);
    // NE doit PAS remplacer l'élément (replaceChild) dans le bloc sent
    expect(sentBlock).not.toMatch(/replaceChild/);
    // NE doit PAS modifier img.src
    expect(sentBlock).not.toMatch(/\.src\s*=/);
  });

  // BH-LIVE-02 : handler status='sent' → pas de chemin 'indisponible'
  test('BH-LIVE-02 : attachment_updated sent url:null → pas de "Pièce jointe indisponible"', () => {
    const sentCommentIdx = src.indexOf('// Outbound confirmé envoyé vers');
    const sentBlock = sentCommentIdx !== -1 ? src.substring(sentCommentIdx, sentCommentIdx + 600) : '';
    expect(sentBlock).not.toMatch(/Pièce jointe indisponible/);
    expect(sentBlock).not.toMatch(/bh-att-failed/);
  });
});
