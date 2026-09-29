'use strict';
/**
 * ATTACHMENTS-9 — SOURCE CANONIQUE DE CONVERSATION ACTIVE
 *
 * U. _getActiveConversationId / _getActiveConversation — synchronisation window vs module
 * V. openPhotoUpload — utilise la source canonique, pas currentConversationId directement
 * W. Sécurité FIX-9-G — protection contre changement de conversation
 * X. Pas de retour legacy [IMAGE:url] / pas d'auto-send
 */

const fs   = require('fs');
const path = require('path');
const src  = fs.readFileSync(
  path.join(__dirname, '../public/js/chat-owner.js'), 'utf8'
);

// Evaluer le fichier dans un contexte minimal (new Function simule le scope module)
function makeContext(overrides = {}) {
  return {
    window: {
      currentConversationId: null,
      _currentChannexBookingId: null,
      Capacitor: null,
      location: { origin: '' },
      allConversations: [],
      ...overrides.window,
    },
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => ({ forEach: () => {} }),
      addEventListener: () => {},
      body: { style: {} },
      documentElement: { style: {} },
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    sessionStorage: { setItem: () => {} },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    XMLHttpRequest: function() {
      return { open: () => {}, setRequestHeader: () => {}, send: () => {},
               upload: { addEventListener: () => {} }, addEventListener: () => {} };
    },
    FormData: function() { return { append: () => {} }; },
    setTimeout: () => {},
    clearInterval: () => {},
    setInterval: () => {},
    alert: () => {},
    confirm: () => true,
    ...overrides.globals,
  };
}

// Extraire les fonctions photo en les évaluant dans un contexte contrôlé
function buildPhotoModule(convId, allConvs) {
  // On extrait les fragments de code nécessaires avec new Function
  // pour tester les helpers sans les dépendances DOM complètes.

  // Extraire _getActiveConversationId
  const helperSrc = src.match(
    /function _getActiveConversationId\(\)[\s\S]*?^}/m
  )?.[0] || '';
  const getActiveConvSrc = src.match(
    /function _getActiveConversation\(\)[\s\S]*?^}/m
  )?.[0] || '';

  const fn = new Function(
    'currentConversationId', 'allConversations', 'window_currentConversationId',
    `
    let currentConversationId = currentConversationId;
    const allConversations = allConversations;
    const window = { currentConversationId: window_currentConversationId };
    ${helperSrc}
    ${getActiveConvSrc}
    return {
      getActiveConversationId: _getActiveConversationId,
      getActiveConversation:   _getActiveConversation,
    };
    `
  );
  return fn(convId, allConvs, convId);
}

// ── U. Helpers _getActiveConversationId / _getActiveConversation ─────────────
describe('U. PROD-FIX-9 — _getActiveConversationId (source canonique)', () => {

  // U-01 : les helpers sont bien définis dans le code source
  test('U-01 : _getActiveConversationId définie dans chat-owner.js', () => {
    expect(src).toMatch(/function _getActiveConversationId\s*\(\)/);
  });

  test('U-02 : _getActiveConversation définie dans chat-owner.js', () => {
    expect(src).toMatch(/function _getActiveConversation\s*\(\)/);
  });

  // U-03 : openPhotoUpload utilise _getActiveConversation() plutôt que lookup direct
  test('U-03 : openPhotoUpload utilise _getActiveConversation()', () => {
    const block = src.match(/window\.openPhotoUpload\s*=[\s\S]*?^\};/m)?.[0] || '';
    expect(block).toMatch(/_getActiveConversation\(\)/);
    expect(block).not.toMatch(/allConversations\.find\(c => c\.id == currentConversationId\)/);
  });

  // U-04 : openPhotoUpload log utilise _getActiveConversationId()
  test('U-04 : log openPhotoUpload utilise _getActiveConversationId()', () => {
    const block = src.match(/window\.openPhotoUpload\s*=[\s\S]*?^\};/m)?.[0] || '';
    expect(block).toMatch(/_getActiveConversationId\(\)/);
    // Plus de référence directe à currentConversationId dans le log
    expect(block).not.toMatch(/conversationId:\s*currentConversationId/);
  });

  // U-05 : _getActiveConversationId lit window.currentConversationId en priorité
  test('U-05 : _getActiveConversationId retourne window.currentConversationId si présent', () => {
    const block = src.match(/function _getActiveConversationId\(\)[\s\S]*?^}/m)?.[0] || '';
    expect(block).toMatch(/window\.currentConversationId/);
  });

  // U-06 : _getActiveConversationId synchronise currentConversationId depuis window
  test('U-06 : _getActiveConversationId met à jour currentConversationId depuis window', () => {
    const block = src.match(/function _getActiveConversationId\(\)[\s\S]*?^}/m)?.[0] || '';
    expect(block).toMatch(/currentConversationId\s*=\s*wid/);
  });

  // U-07 : _getActiveConversation fait appel à _getActiveConversationId
  test('U-07 : _getActiveConversation appelle _getActiveConversationId()', () => {
    const block = src.match(/function _getActiveConversation\(\)[\s\S]*?^}/m)?.[0] || '';
    expect(block).toMatch(/_getActiveConversationId\(\)/);
  });

  // U-08 : _getActiveConversation retourne null si pas de conversation active
  test('U-08 : _getActiveConversation retourne null si pas de conversation', () => {
    const block = src.match(/function _getActiveConversation\(\)[\s\S]*?^}/m)?.[0] || '';
    expect(block).toMatch(/return null/);
  });
});

// ── V. openPhotoUpload — contexte correct ─────────────────────────────────────
describe('V. PROD-FIX-9 — openPhotoUpload utilise source canonique', () => {

  // V-01 : _bhHandleFileSelection mémorise _selectedConversationId à la sélection
  test('V-01 : _bhHandleFileSelection enregistre _selectedConversationId', () => {
    const block = src.match(/function _bhHandleFileSelection[\s\S]*?^}/m)?.[0] || '';
    expect(block).toMatch(/_selectedConversationId\s*=\s*_getActiveConversationId\(\)/);
  });

  // V-02 : _bhSendPhotos utilise _getActiveConversationId() (plus de sync block manuel)
  test('V-02 : _bhSendPhotos utilise _getActiveConversationId()', () => {
    const block = src.match(/async function _bhSendPhotos\(\)[\s\S]*?^\}/m)?.[0] || '';
    expect(block).toMatch(/_getActiveConversationId\(\)/);
  });

  // V-03 : _bhSendPhotos n'a plus le vieux sync block manuel (window.currentConversationId)
  test('V-03 : _bhSendPhotos — sync block manuel supprimé', () => {
    const block = src.match(/async function _bhSendPhotos\(\)[\s\S]*?^\}/m)?.[0] || '';
    // L'ancienne logique "if (window.currentConversationId && String(...) !== String(...))"
    // manuelle est remplacée par _getActiveConversationId()
    expect(block).not.toMatch(/window\.currentConversationId\s*&&\s*String\(window\.currentConversationId\)\s*!==\s*String\(currentConversationId\)/);
  });

  // V-04 : _bhSendPhotos POSTe vers sendConvId (pas currentConversationId direct)
  test('V-04 : _bhSendPhotos passe sendConvId à _sendOutboundImages', () => {
    const block = src.match(/async function _bhSendPhotos\(\)[\s\S]*?^\}/m)?.[0] || '';
    expect(block).toMatch(/_sendOutboundImages\(sendConvId\)/);
    expect(block).not.toMatch(/_sendOutboundImages\(currentConversationId\)/);
  });

  // V-05 : _selectedConversationId déclarée comme variable de module
  test('V-05 : _selectedConversationId déclarée dans le scope module', () => {
    expect(src).toMatch(/let _selectedConversationId\s*=\s*null/);
  });
});

// ── W. Sécurité FIX-9-G — protection changement conversation ─────────────────
describe('W. PROD-FIX-9 — Protection changement conversation (FIX-9-G)', () => {

  // W-01 : _bhSendPhotos vérifie que activeId === _selectedConversationId
  test('W-01 : _bhSendPhotos contient la protection FIX-9-G', () => {
    const block = src.match(/async function _bhSendPhotos\(\)[\s\S]*?^\}/m)?.[0] || '';
    expect(block).toMatch(/_selectedConversationId.*activeId|activeId.*_selectedConversationId/);
    expect(block).toMatch(/Conversation changée/);
  });

  // W-02 : en cas de changement de conversation, les fichiers sont vidés
  test('W-02 : changement conv → _selectedFiles=[] + _selectedConversationId=null', () => {
    const block = src.match(/async function _bhSendPhotos\(\)[\s\S]*?^\}/m)?.[0] || '';
    // La protection doit vider les fichiers ET réinitialiser la conv mémorisée
    const guardBlock = block.match(/Conversation changée[\s\S]*?return;/)?.[0] || '';
    expect(guardBlock).toMatch(/_selectedFiles\s*=\s*\[\]/);
    expect(guardBlock).toMatch(/_selectedConversationId\s*=\s*null/);
  });

  // W-03 : sendConvId utilise _selectedConversationId (frozen at selection) not activeId
  test('W-03 : sendConvId = _selectedConversationId || activeId (priorité à la conv sélectionnée)', () => {
    const block = src.match(/async function _bhSendPhotos\(\)[\s\S]*?^\}/m)?.[0] || '';
    expect(block).toMatch(/sendConvId\s*=\s*_selectedConversationId\s*\|\|\s*activeId/);
  });

  // W-04 : après envoi réussi, _selectedConversationId est réinitialisé
  test('W-04 : après envoi réussi, _selectedConversationId = null', () => {
    const block = src.match(/async function _bhSendPhotos\(\)[\s\S]*?^\}/m)?.[0] || '';
    // Dans le bloc finally / clearFiles
    expect(block).toMatch(/_selectedConversationId\s*=\s*null/);
  });

  // W-05 : _bhCancelOutbound réinitialise _selectedConversationId
  test('W-05 : _bhCancelOutbound réinitialise _selectedConversationId', () => {
    const block = src.match(/function _bhCancelOutbound\(\)[\s\S]*?^}/m)?.[0] || '';
    expect(block).toMatch(/_selectedConversationId\s*=\s*null/);
  });

  // W-06 : changement de conversation (showInlineChat) réinitialise _selectedConversationId
  test('W-06 : changement conv (showInlineChat) réinitialise _selectedConversationId', () => {
    // Chercher la zone de reset dans showInlineChat (après "Nettoyer les fichiers outbound")
    const resetZone = src.match(/Nettoyer les fichiers outbound[\s\S]{0,200}/)?.[0] || '';
    expect(resetZone).toMatch(/_selectedConversationId\s*=\s*null/);
  });
});

// ── X. Pas de retour legacy / pas d'auto-send ─────────────────────────────────
describe('X. PROD-FIX-9 — Anti-régression legacy + sécurité auto-send', () => {

  // X-01 : openPhotoUpload ne construit pas de [IMAGE:url]
  test('X-01 : openPhotoUpload ne construit pas de tag [IMAGE:url]', () => {
    const block = src.match(/window\.openPhotoUpload\s*=[\s\S]*?^\};/m)?.[0] || '';
    expect(block).not.toMatch(/\[IMAGE:/);
    expect(block).not.toMatch(/api\/chat\/send/);
  });

  // X-02 : _bhHandleFileSelection ne déclenche pas d'envoi automatique
  test('X-02 : _bhHandleFileSelection ne déclenche pas d\'envoi automatique', () => {
    const block = src.match(/function _bhHandleFileSelection[\s\S]*?^}/m)?.[0] || '';
    expect(block).not.toMatch(/_bhSendPhotos\(\)/);
    expect(block).not.toMatch(/fetch\(/);
    expect(block).not.toMatch(/XMLHttpRequest/);
    expect(block).not.toMatch(/api\/chat\/send/);
  });

  // X-03 : _sendOutboundImages pointe vers /api/chat/conversations/:id/attachments
  test('X-03 : _sendOutboundImages pointe vers /attachments (pas /send)', () => {
    const block = src.match(/async function _sendOutboundImages[\s\S]*?^\}/m)?.[0] || '';
    expect(block).toMatch(/\/api\/chat\/conversations.*\/attachments/);
    expect(block).not.toMatch(/\/api\/chat\/send/);
  });

  // X-04 : aucun [IMAGE:url] construit dans chat-owner.js (sendMessageOwner)
  test('X-04 : sendMessageOwner ne construit pas de tag [IMAGE:url]', () => {
    expect(src).not.toMatch(/`\[IMAGE:\$\{/);
    expect(src).not.toMatch(/'\[IMAGE:'\s*\+/);
  });

  // X-05 : _getActiveConversationId ne logge pas de données voyageur
  test('X-05 : _getActiveConversationId ne logge pas de données voyageur', () => {
    const block = src.match(/function _getActiveConversationId\(\)[\s\S]*?^}/m)?.[0] || '';
    expect(block).not.toMatch(/console\.log/);
  });

  // X-06 : _getActiveConversation ne logge pas de données voyageur
  test('X-06 : _getActiveConversation ne logge pas de données voyageur', () => {
    const block = src.match(/function _getActiveConversation\(\)[\s\S]*?^}/m)?.[0] || '';
    expect(block).not.toMatch(/console\.log/);
  });
});
