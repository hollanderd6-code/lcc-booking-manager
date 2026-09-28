'use strict';
/**
 * ATTACHMENTS-7C — Interface web envoi d'images outbound
 *
 * Tests structurels — lecture du source JS uniquement.
 * Aucun DOM réel, aucun réseau, aucun serveur.
 *
 * A. _supportsOutboundImage — helper plateforme
 * B. Variables d'état outbound
 * C. window.openPhotoUpload — déclencheur file picker
 * D. _bhHandleFileSelection — validation fichiers
 * E. _bhRefreshPreviewZone / _bhClearOutboundPreviews
 * F. _sendOutboundImages — XHR + FormData
 * G. _bhUpdateUploadProgress — barre de progression
 * H. sendMessageOwner — modifications outbound
 * I. _checkChannexConversation — visibilité photoUploadBtn
 * J. socket.on attachment_updated — sent / failed
 * K. CSS styles outbound
 * L. Sécurité — pas de base64 dans les logs
 * M. Non-régression ATTACHMENTS-6
 */

const fs   = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../public/js/chat-owner.js'),
  'utf8'
);

// ── A. _supportsOutboundImage ────────────────────────────────────────────────
describe('A. _supportsOutboundImage — helper plateforme', () => {
  test('A-01 : fonction définie', () => {
    expect(src).toMatch(/function\s+_supportsOutboundImage\s*\(/);
  });

  test('A-02 : airbnb reconnu (includes)', () => {
    expect(src).toMatch(/includes\(['"]airbnb['"]\)/);
  });

  test('A-03 : abb reconnu (code court)', () => {
    expect(src).toMatch(/=== ['"]abb['"]/);
  });

  test('A-04 : booking reconnu (includes)', () => {
    expect(src).toMatch(/includes\(['"]booking['"]\)/);
  });

  test('A-05 : bdc reconnu (code court)', () => {
    expect(src).toMatch(/=== ['"]bdc['"]/);
  });

  test('A-06 : expedia reconnu (includes)', () => {
    expect(src).toMatch(/includes\(['"]expedia['"]\)/);
  });

  test('A-07 : platform mis en lowercase avant comparaison', () => {
    const block = src.match(/function\s+_supportsOutboundImage[\s\S]*?^}/m)?.[0] || '';
    expect(block).toMatch(/toLowerCase/);
  });

  test('A-08 : fail-closed — retourne false pour null/undefined', () => {
    const block = src.match(/function\s+_supportsOutboundImage[\s\S]*?^}/m)?.[0] || '';
    expect(block).toMatch(/if\s*\(\s*!platform/);
  });
});

// ── B. Variables d'état outbound ─────────────────────────────────────────────
describe('B. Variables d\'état outbound', () => {
  test('B-01 : _selectedFiles déclaré comme tableau vide', () => {
    expect(src).toMatch(/let\s+_selectedFiles\s*=\s*\[\]/);
  });

  test('B-02 : _uploadInProgress déclaré comme false', () => {
    expect(src).toMatch(/let\s+_uploadInProgress\s*=\s*false/);
  });

  test('B-03 : _selectedFiles déclaré en portée module (avant les fonctions)', () => {
    const posVar = src.indexOf('let _selectedFiles');
    const posFn  = src.indexOf('function _supportsOutboundImage');
    expect(posVar).toBeGreaterThan(0);
    expect(posVar).toBeLessThan(posFn);
  });
});

// ── C. window.openPhotoUpload ────────────────────────────────────────────────
describe('C. window.openPhotoUpload — déclencheur file picker', () => {
  test('C-01 : fonction définie sur window', () => {
    expect(src).toMatch(/window\.openPhotoUpload\s*=\s*function/);
  });

  test('C-02 : bloqué si _uploadInProgress', () => {
    const block = src.match(/openPhotoUpload\s*=\s*function[\s\S]*?^};/m)?.[0] || '';
    expect(block).toMatch(/_uploadInProgress/);
  });

  test('C-03 : vérifie _supportsOutboundImage avant d\'ouvrir', () => {
    const block = src.match(/openPhotoUpload\s*=\s*function[\s\S]*?^};/m)?.[0] || '';
    expect(block).toMatch(/_supportsOutboundImage/);
  });

  test('C-04 : crée un input type file', () => {
    expect(src).toMatch(/type\s*=\s*['"]file['"]/);
  });

  test('C-05 : accept image/jpeg,image/png,image/webp', () => {
    expect(src).toMatch(/image\/jpeg,image\/png,image\/webp/);
  });

  test('C-06 : multiple = true', () => {
    expect(src).toMatch(/\.multiple\s*=\s*true/);
  });

  test('C-07 : écoute l\'événement change sur le file input', () => {
    expect(src).toMatch(/addEventListener\s*\(\s*['"]change['"]\s*,\s*_bhHandleFileSelection/);
  });

  test('C-08 : reset value avant click (évite le cache navigateur)', () => {
    const block = src.match(/openPhotoUpload\s*=\s*function[\s\S]*?^};/m)?.[0] || '';
    expect(block).toMatch(/\.value\s*=\s*['"]{2}/);
  });

  test('C-09 : appelle fi.click()', () => {
    const block = src.match(/openPhotoUpload\s*=\s*function[\s\S]*?^};/m)?.[0] || '';
    expect(block).toMatch(/\.click\s*\(\s*\)/);
  });

  test('C-10 : toast d\'erreur si plateforme non supportée', () => {
    const block = src.match(/openPhotoUpload\s*=\s*function[\s\S]*?^};/m)?.[0] || '';
    expect(block).toMatch(/showToast/);
  });
});

// ── D. _bhHandleFileSelection ─────────────────────────────────────────────────
describe('D. _bhHandleFileSelection — validation fichiers', () => {
  test('D-01 : fonction définie', () => {
    expect(src).toMatch(/function\s+_bhHandleFileSelection\s*\(/);
  });

  test('D-02 : limite MAX_FILES = 5', () => {
    const block = src.match(/function\s+_bhHandleFileSelection[\s\S]*?^}/m)?.[0] || '';
    expect(block).toMatch(/MAX_FILES\s*=\s*5/);
  });

  test('D-03 : limite MAX_BYTES = 10 MB', () => {
    const block = src.match(/function\s+_bhHandleFileSelection[\s\S]*?^}/m)?.[0] || '';
    expect(block).toMatch(/10\s*\*\s*1024\s*\*\s*1024/);
  });

  test('D-04 : whitelist JPEG/PNG/WEBP uniquement', () => {
    const block = src.match(/function\s+_bhHandleFileSelection[\s\S]*?^}/m)?.[0] || '';
    expect(block).toMatch(/image\/jpeg/);
    expect(block).toMatch(/image\/png/);
    expect(block).toMatch(/image\/webp/);
  });

  test('D-05 : toast si trop de fichiers', () => {
    const block = src.match(/function\s+_bhHandleFileSelection[\s\S]*?^}/m)?.[0] || '';
    expect(block).toMatch(/MAX_FILES/);
    expect(block).toMatch(/showToast/);
  });

  test('D-06 : toast si fichier trop lourd', () => {
    const block = src.match(/function\s+_bhHandleFileSelection[\s\S]*?^}/m)?.[0] || '';
    expect(block).toMatch(/trop lourd/i);
  });

  test('D-07 : toast si format non accepté', () => {
    const block = src.match(/function\s+_bhHandleFileSelection[\s\S]*?^}/m)?.[0] || '';
    expect(block).toMatch(/format non accept/i);
  });

  test('D-08 : appelle _bhRefreshPreviewZone après validation', () => {
    const block = src.match(/function\s+_bhHandleFileSelection[\s\S]*?^}/m)?.[0] || '';
    expect(block).toMatch(/_bhRefreshPreviewZone/);
  });

  test('D-09 : push les fichiers valides dans _selectedFiles', () => {
    const block = src.match(/function\s+_bhHandleFileSelection[\s\S]*?^}/m)?.[0] || '';
    expect(block).toMatch(/_selectedFiles\.push/);
  });
});

// ── E. Preview zone ───────────────────────────────────────────────────────────
describe('E. _bhRefreshPreviewZone / _bhClearOutboundPreviews', () => {
  test('E-01 : _bhRefreshPreviewZone définie', () => {
    expect(src).toMatch(/function\s+_bhRefreshPreviewZone\s*\(/);
  });

  test('E-02 : _bhClearOutboundPreviews définie', () => {
    expect(src).toMatch(/function\s+_bhClearOutboundPreviews\s*\(/);
  });

  test('E-03 : crée la zone avec id _bhOutboundPreviewZone', () => {
    expect(src).toMatch(/_bhOutboundPreviewZone/);
  });

  test('E-04 : classe CSS bh-outbound-preview-zone', () => {
    expect(src).toMatch(/bh-outbound-preview-zone/);
  });

  test('E-05 : utilise URL.createObjectURL pour les thumbnails', () => {
    expect(src).toMatch(/URL\.createObjectURL/);
  });

  test('E-06 : révoque les objectURL avant de vider la zone', () => {
    const block = src.match(/function\s+_bhRefreshPreviewZone[\s\S]*?^}/m)?.[0] || '';
    expect(block).toMatch(/URL\.revokeObjectURL/);
  });

  test('E-07 : _bhClearOutboundPreviews révoque aussi les objectURL', () => {
    const block = src.match(/function\s+_bhClearOutboundPreviews[\s\S]*?^}/m)?.[0] || '';
    expect(block).toMatch(/URL\.revokeObjectURL/);
  });

  test('E-08 : thumbnail a une classe bh-outbound-thumb', () => {
    expect(src).toMatch(/bh-outbound-thumb/);
  });

  test('E-09 : bouton de retrait avec aria-label', () => {
    expect(src).toMatch(/aria-label.*Retirer/);
  });

  test('E-10 : zone cachée quand pas de fichiers', () => {
    const block = src.match(/function\s+_bhRefreshPreviewZone[\s\S]*?^}/m)?.[0] || '';
    expect(block).toMatch(/style\.display\s*=\s*['"]none['"]/);
  });

  test('E-11 : zone insérée avant chatInputArea', () => {
    const block = src.match(/function\s+_bhRefreshPreviewZone[\s\S]*?^}/m)?.[0] || '';
    expect(block).toMatch(/chatInputArea/);
    expect(block).toMatch(/insertBefore/);
  });
});

// ── F. _sendOutboundImages ────────────────────────────────────────────────────
describe('F. _sendOutboundImages — XHR + FormData', () => {
  test('F-01 : fonction async définie', () => {
    expect(src).toMatch(/async\s+function\s+_sendOutboundImages\s*\(/);
  });

  test('F-02 : utilise FormData', () => {
    const block = src.match(/async\s+function\s+_sendOutboundImages[\s\S]*?^\}/m)?.[0] || '';
    expect(block).toMatch(/new\s+FormData/);
  });

  test('F-03 : appends les fichiers avec champ "files"', () => {
    const block = src.match(/async\s+function\s+_sendOutboundImages[\s\S]*?^\}/m)?.[0] || '';
    expect(block).toMatch(/fd\.append\s*\(\s*['"]files['"]/);
  });

  test('F-04 : utilise XMLHttpRequest (pour le progress)', () => {
    expect(src).toMatch(/new\s+XMLHttpRequest/);
  });

  test('F-05 : POST vers /api/chat/conversations/:id/attachments', () => {
    expect(src).toMatch(/\/api\/chat\/conversations.*\/attachments/);
  });

  test('F-06 : injecte Authorization Bearer header', () => {
    const block = src.match(/async\s+function\s+_sendOutboundImages[\s\S]*?^\}/m)?.[0] || '';
    expect(block).toMatch(/Authorization.*Bearer/);
  });

  test('F-07 : écoute l\'événement progress sur xhr.upload', () => {
    const block = src.match(/async\s+function\s+_sendOutboundImages[\s\S]*?^\}/m)?.[0] || '';
    expect(block).toMatch(/xhr\.upload\.addEventListener\s*\(\s*['"]progress['"]/);
  });

  test('F-08 : appelle _bhUpdateUploadProgress avec le pourcentage', () => {
    const block = src.match(/async\s+function\s+_sendOutboundImages[\s\S]*?^\}/m)?.[0] || '';
    expect(block).toMatch(/_bhUpdateUploadProgress/);
  });

  test('F-09 : toast 413 pour fichier trop lourd', () => {
    const block = src.match(/async\s+function\s+_sendOutboundImages[\s\S]*?^\}/m)?.[0] || '';
    expect(block).toMatch(/413/);
  });

  test('F-10 : toast pour les erreurs HTTP >= 400', () => {
    const block = src.match(/async\s+function\s+_sendOutboundImages[\s\S]*?^\}/m)?.[0] || '';
    expect(block).toMatch(/status\s*>=\s*400/);
  });

  test('F-11 : toast pour les images partiellement échouées (results)', () => {
    const block = src.match(/async\s+function\s+_sendOutboundImages[\s\S]*?^\}/m)?.[0] || '';
    expect(block).toMatch(/results/);
    expect(block).toMatch(/nFailed|n_failed|failed\.length/);
  });

  test('F-12 : gère l\'erreur réseau (event error)', () => {
    const block = src.match(/async\s+function\s+_sendOutboundImages[\s\S]*?^\}/m)?.[0] || '';
    expect(block).toMatch(/addEventListener\s*\(\s*['"]error['"]/);
  });

  test('F-13 : enveloppe dans une Promise pour awaiter', () => {
    const block = src.match(/async\s+function\s+_sendOutboundImages[\s\S]*?^\}/m)?.[0] || '';
    expect(block).toMatch(/new\s+Promise/);
  });
});

// ── G. _bhUpdateUploadProgress ────────────────────────────────────────────────
describe('G. _bhUpdateUploadProgress — barre de progression', () => {
  test('G-01 : fonction définie', () => {
    expect(src).toMatch(/function\s+_bhUpdateUploadProgress\s*\(/);
  });

  test('G-02 : crée la barre avec id _bhOutboundProgressBar', () => {
    expect(src).toMatch(/_bhOutboundProgressBar/);
  });

  test('G-03 : masque la barre à 0% et à 100%', () => {
    const block = src.match(/function\s+_bhUpdateUploadProgress[\s\S]*?^}/m)?.[0] || '';
    expect(block).toMatch(/pct\s*<=\s*0|pct\s*>=\s*100/);
    expect(block).toMatch(/display.*none/);
  });

  test('G-04 : met à jour la largeur de la barre fill', () => {
    const block = src.match(/function\s+_bhUpdateUploadProgress[\s\S]*?^}/m)?.[0] || '';
    expect(block).toMatch(/\.width\s*=\s*pct.*%/);
  });

  test('G-05 : classe CSS bh-outbound-progress', () => {
    expect(src).toMatch(/bh-outbound-progress/);
  });
});

// ── H. sendMessageOwner — modifications outbound ──────────────────────────────
describe('H. sendMessageOwner — modifications outbound', () => {
  test('H-01 : permet l\'envoi image-only (plus de blocage si !message seul)', () => {
    expect(src).toMatch(/if\s*\(\s*!message\s*&&\s*_selectedFiles\.length\s*===\s*0\s*\)\s*return/);
  });

  test('H-02 : protection double-envoi (_uploadInProgress)', () => {
    const fnBlock = src.match(/async\s+function\s+sendMessageOwner[\s\S]*?^\}/m)?.[0] || '';
    expect(fnBlock).toMatch(/if\s*\(\s*_uploadInProgress\s*\)\s*return/);
  });

  test('H-03 : snapshot _files = [..._selectedFiles] avant await', () => {
    const fnBlock = src.match(/async\s+function\s+sendMessageOwner[\s\S]*?^\}/m)?.[0] || '';
    expect(fnBlock).toMatch(/const\s+_files\s*=\s*\[\s*\.\.\._selectedFiles\s*\]/);
  });

  test('H-04 : set _uploadInProgress = true si fichiers', () => {
    const fnBlock = src.match(/async\s+function\s+sendMessageOwner[\s\S]*?^\}/m)?.[0] || '';
    expect(fnBlock).toMatch(/_uploadInProgress\s*=\s*true/);
  });

  test('H-05 : texte envoyé avant images (send-platform dans if(message))', () => {
    const fnBlock = src.match(/async\s+function\s+sendMessageOwner[\s\S]*?^\}/m)?.[0] || '';
    const posText = fnBlock.indexOf('send-platform');
    const posImg  = fnBlock.indexOf('_sendOutboundImages');
    expect(posText).toBeGreaterThan(0);
    expect(posImg).toBeGreaterThan(0);
    expect(posText).toBeLessThan(posImg);
  });

  test('H-06 : _sendOutboundImages appelé avec currentConversationId', () => {
    const fnBlock = src.match(/async\s+function\s+sendMessageOwner[\s\S]*?^\}/m)?.[0] || '';
    expect(fnBlock).toMatch(/_sendOutboundImages\s*\(\s*currentConversationId\s*\)/);
  });

  test('H-07 : nettoyage dans finally (_bhClearOutboundPreviews)', () => {
    const fnBlock = src.match(/async\s+function\s+sendMessageOwner[\s\S]*?^\}/m)?.[0] || '';
    const posFinally = fnBlock.indexOf('finally');
    const posClean   = fnBlock.indexOf('_bhClearOutboundPreviews');
    expect(posFinally).toBeGreaterThan(0);
    expect(posClean).toBeGreaterThan(posFinally);
  });

  test('H-08 : _selectedFiles réinitialisé dans finally', () => {
    const fnBlock = src.match(/async\s+function\s+sendMessageOwner[\s\S]*?^\}/m)?.[0] || '';
    const posFinally = fnBlock.indexOf('finally');
    const posReset   = fnBlock.lastIndexOf('_selectedFiles = []');
    expect(posReset).toBeGreaterThan(posFinally);
  });

  test('H-09 : _uploadInProgress réinitialisé dans finally', () => {
    const fnBlock = src.match(/async\s+function\s+sendMessageOwner[\s\S]*?^\}/m)?.[0] || '';
    const posFinally = fnBlock.indexOf('finally');
    const posReset   = fnBlock.lastIndexOf('_uploadInProgress = false');
    expect(posReset).toBeGreaterThan(posFinally);
  });

  test('H-10 : input.value vidé même pour image-only', () => {
    const fnBlock = src.match(/async\s+function\s+sendMessageOwner[\s\S]*?^\}/m)?.[0] || '';
    // Dans la branche else (image-only), l'input est aussi vidé
    const elseBlock = fnBlock.match(/\} else \{[\s\S]*?input\.value\s*=\s*['"]{2}/);
    expect(elseBlock).toBeTruthy();
  });
});

// ── I. _checkChannexConversation — visibilité photoUploadBtn ──────────────────
describe('I. _checkChannexConversation — visibilité photoUploadBtn', () => {
  test('I-01 : photoUploadBtn affiché pour les plateformes supportées', () => {
    const block = src.match(/async\s+function\s+_checkChannexConversation[\s\S]*?^\}/m)?.[0] || '';
    expect(block).toMatch(/photoUploadBtn/);
  });

  test('I-02 : utilise _supportsOutboundImage pour décider la visibilité', () => {
    const block = src.match(/async\s+function\s+_checkChannexConversation[\s\S]*?^\}/m)?.[0] || '';
    expect(block).toMatch(/_supportsOutboundImage/);
  });

  test('I-03 : display=none si plateforme non supportée', () => {
    const block = src.match(/async\s+function\s+_checkChannexConversation[\s\S]*?^\}/m)?.[0] || '';
    // Dans la branche sans support outbound
    expect(block).toMatch(/photoBtn\.style\.display\s*=\s*['"]none['"]/);
  });

  test('I-04 : _selectedFiles et previews réinitialisés si plateforme non supportée', () => {
    const block = src.match(/async\s+function\s+_checkChannexConversation[\s\S]*?^\}/m)?.[0] || '';
    expect(block).toMatch(/_bhClearOutboundPreviews/);
  });

  test('I-05 : photoUploadBtn caché dans la branche else (pas de Channex)', () => {
    const block = src.match(/async\s+function\s+_checkChannexConversation[\s\S]*?^\}/m)?.[0] || '';
    const elseIdx = block.lastIndexOf('} else {');
    const elseBlock = block.slice(elseIdx);
    expect(elseBlock).toMatch(/photoBtn/);
    expect(elseBlock).toMatch(/display.*none/);
  });
});

// ── J. socket.on attachment_updated — sent / failed ──────────────────────────
// On recherche dans le src global car le handler couvre plusieurs blocs imbriqués.
describe('J. socket.on attachment_updated — sent / failed', () => {
  // Extraire la section entière attachment_updated (jusqu'à Exposer le socket)
  const handlerIdx = src.indexOf("socket.on('attachment_updated'");
  const handlerEnd = src.indexOf('// Exposer le socket', handlerIdx);
  const handler = handlerIdx >= 0 && handlerEnd > handlerIdx
    ? src.slice(handlerIdx, handlerEnd)
    : src; // fallback sur tout le fichier si la délimitation change

  test('J-01 : handler restructuré — plus de blocage strict sur stored+url', () => {
    expect(handler).not.toMatch(/data\.status\s*!==\s*['"]stored['"]\s*\|\|\s*!data\.url/);
  });

  test('J-02 : branche status stored avec url (inbound, ATTACHMENTS-6 non-regression)', () => {
    expect(handler).toMatch(/data\.status\s*===\s*['"]stored['"]\s*&&\s*data\.url/);
  });

  test('J-03 : branche status sent (outbound confirmé)', () => {
    expect(handler).toMatch(/data\.status\s*===\s*['"]sent['"]/);
  });

  test('J-04 : branche status failed (outbound échoué)', () => {
    expect(handler).toMatch(/data\.status\s*===\s*['"]failed['"]/);
  });

  test('J-05 : badge envoyé ajouté sur .bh-att-img-w (sent)', () => {
    expect(handler).toMatch(/bh-att-sent-badge/);
  });

  test('J-06 : badge sent idempotent (pas de doublon)', () => {
    expect(handler).toMatch(/querySelector\s*\(\s*['"]\.bh-att-sent-badge['"]/);
  });

  test('J-07 : remplacement par bh-att-failed pour le cas failed', () => {
    const failedIdx = handler.indexOf("data.status === 'failed'");
    const failedBlock = failedIdx >= 0 ? handler.slice(failedIdx) : '';
    expect(failedBlock).toMatch(/bh-att-failed/);
    expect(failedBlock).toMatch(/replaceChild/);
  });

  test('J-08 : filtre par conversation_id', () => {
    expect(handler).toMatch(/data\.conversation_id\s*!==\s*currentConversationId/);
  });
});

// ── K. CSS styles outbound ────────────────────────────────────────────────────
describe('K. CSS styles outbound', () => {
  test('K-01 : .bh-att-sent-badge défini dans les styles', () => {
    expect(src).toMatch(/\.bh-att-sent-badge\s*\{/);
  });

  test('K-02 : .bh-outbound-preview-zone défini', () => {
    expect(src).toMatch(/\.bh-outbound-preview-zone\s*\{/);
  });

  test('K-03 : .bh-outbound-thumb défini', () => {
    expect(src).toMatch(/\.bh-outbound-thumb\s*\{/);
  });

  test('K-04 : .bh-outbound-progress défini', () => {
    expect(src).toMatch(/\.bh-outbound-progress\s*\{/);
  });

  test('K-05 : .bh-outbound-progress-fill défini', () => {
    expect(src).toMatch(/\.bh-outbound-progress-fill\s*\{/);
  });

  test('K-06 : .bh-att-sent-badge a position:absolute', () => {
    const cssBlock = src.match(/\.bh-att-sent-badge\s*\{[^}]*\}/)?.[0] || '';
    expect(cssBlock).toMatch(/position:absolute/);
  });

  test('K-07 : styles injectés dans _ensureBhAttachStyles', () => {
    const styleBlock = src.match(/function\s+_ensureBhAttachStyles[\s\S]*?document\.head\.appendChild/)?.[0] || '';
    expect(styleBlock).toMatch(/bh-att-sent-badge/);
    expect(styleBlock).toMatch(/bh-outbound-preview-zone/);
  });
});

// ── L. Sécurité ───────────────────────────────────────────────────────────────
describe('L. Sécurité — pas de base64 dans les logs', () => {
  test('L-01 : _sendOutboundImages ne logge pas le contenu du fichier', () => {
    const block = src.match(/async\s+function\s+_sendOutboundImages[\s\S]*?^\}/m)?.[0] || '';
    expect(block).not.toMatch(/console\.log.*base64/i);
    expect(block).not.toMatch(/console\.log.*file\b/i);
  });

  test('L-02 : _bhHandleFileSelection ne logge pas le fichier', () => {
    const block = src.match(/function\s+_bhHandleFileSelection[\s\S]*?^}/m)?.[0] || '';
    expect(block).not.toMatch(/console\.log/);
  });
});

// ── N. ATTACHMENTS-7C-FIX — corrections explicites ───────────────────────────
describe('N. ATTACHMENTS-7C-FIX — correctifs', () => {
  // N-01 : accept exact (spec exige image/jpeg,image/png,image/webp — pas image/*)
  test('N-01 : accept exact "image/jpeg,image/png,image/webp" dans le file picker', () => {
    expect(src).toMatch(/fi\.accept\s*=\s*['"]image\/jpeg,image\/png,image\/webp['"]/);
  });

  // N-02 : image-only — le chemin else { input.value=''; } existe pour skip texte vide
  test('N-02 : branche else pour image-only (skip envoi texte vide)', () => {
    const fnBlock = src.match(/async\s+function\s+sendMessageOwner[\s\S]*?^\}/m)?.[0] || '';
    // La branche else s'exécute quand message est vide mais des fichiers sont présents
    expect(fnBlock).toMatch(/if\s*\(\s*message\s*\)\s*\{[\s\S]*?\}\s*else\s*\{[\s\S]*?input\.value/);
  });

  // N-03 : aucun texte vide envoyé vers Channex — send-platform seulement dans if(message)
  test('N-03 : send-platform uniquement dans if(message) — jamais message vide envoyé', () => {
    const fnBlock = src.match(/async\s+function\s+sendMessageOwner[\s\S]*?^\}/m)?.[0] || '';
    // L'appel send-platform doit être dans un bloc conditionnel if(message)
    const textBlock = fnBlock.match(/if\s*\(\s*message\s*\)\s*\{[\s\S]*?send-platform[\s\S]*?\}/)?.[0] || '';
    expect(textBlock.length).toBeGreaterThan(0);
  });

  // N-04 : ordre texte → images via position dans le source
  test('N-04 : send-platform avant _sendOutboundImages dans sendMessageOwner', () => {
    const fnBlock = src.match(/async\s+function\s+sendMessageOwner[\s\S]*?^\}/m)?.[0] || '';
    expect(fnBlock.indexOf('send-platform')).toBeLessThan(fnBlock.indexOf('_sendOutboundImages'));
  });

  // N-05 : _clearFiles flag introduit
  test('N-05 : flag _clearFiles déclaré dans sendMessageOwner', () => {
    const fnBlock = src.match(/async\s+function\s+sendMessageOwner[\s\S]*?^\}/m)?.[0] || '';
    expect(fnBlock).toMatch(/let\s+_clearFiles\s*=/);
  });

  // N-06 : finally conditionnel — nettoyage seulement si _clearFiles
  test('N-06 : finally nettoie uniquement si _clearFiles est true', () => {
    const fnBlock = src.match(/async\s+function\s+sendMessageOwner[\s\S]*?^\}/m)?.[0] || '';
    const finallyIdx = fnBlock.lastIndexOf('finally');
    const finallyBlock = fnBlock.slice(finallyIdx);
    expect(finallyBlock).toMatch(/if\s*\(\s*_clearFiles\s*\)/);
    expect(finallyBlock).toMatch(/_bhClearOutboundPreviews/);
    expect(finallyBlock).toMatch(/_selectedFiles\s*=\s*\[\]/);
  });

  // N-07 : _uploadInProgress libéré dans finally même sans nettoyage (retry possible)
  test('N-07 : _uploadInProgress toujours libéré dans finally (même sur échec)', () => {
    const fnBlock = src.match(/async\s+function\s+sendMessageOwner[\s\S]*?^\}/m)?.[0] || '';
    const finallyIdx = fnBlock.lastIndexOf('finally');
    const finallyBlock = fnBlock.slice(finallyIdx);
    // _uploadInProgress = false doit être AVANT le if(_clearFiles) pour toujours s'exécuter
    const posRelease = finallyBlock.indexOf('_uploadInProgress = false');
    const posCheck   = finallyBlock.indexOf('if (_clearFiles)');
    expect(posRelease).toBeGreaterThan(0);
    expect(posRelease).toBeLessThan(posCheck);
  });

  // N-08 : _sendOutboundImages retourne un boolean (serverResponded)
  test('N-08 : _sendOutboundImages retourne true si serveur a répondu', () => {
    const block = src.match(/async\s+function\s+_sendOutboundImages[\s\S]*?^\}/m)?.[0] || '';
    expect(block).toMatch(/return\s+_serverResponded/);
  });

  // N-09 : _serverResponded mis à true seulement dans xhr.load (pas dans xhr.error)
  test('N-09 : _serverResponded vrai dans load, absent de error', () => {
    const block = src.match(/async\s+function\s+_sendOutboundImages[\s\S]*?^\}/m)?.[0] || '';
    expect(block).toMatch(/_serverResponded\s*=\s*true/);
    // Dans le handler error, _serverResponded ne doit pas être mis à true
    const errorHandler = block.match(/addEventListener\s*\(\s*['"]error['"][\s\S]*?\}\s*\)/)?.[0] || '';
    expect(errorHandler).not.toMatch(/_serverResponded\s*=\s*true/);
  });

  // N-10 : openChat nettoie les fichiers outbound de la conv précédente
  test('N-10 : openChat réinitialise _selectedFiles et les previews', () => {
    const block = src.match(/async\s+function\s+openChat[\s\S]*?^\}/m)?.[0] || '';
    expect(block).toMatch(/_selectedFiles\s*=\s*\[\]/);
    expect(block).toMatch(/_bhClearOutboundPreviews/);
  });

  // N-11 : closeChat nettoie les fichiers et libère le verrou
  test('N-11 : closeChat réinitialise _selectedFiles, _uploadInProgress et les previews', () => {
    const block = src.match(/function\s+closeChat[\s\S]*?^\}/m)?.[0] || '';
    expect(block).toMatch(/_selectedFiles\s*=\s*\[\]/);
    expect(block).toMatch(/_bhClearOutboundPreviews/);
    expect(block).toMatch(/_uploadInProgress\s*=\s*false/);
  });

  // N-12 : failed — message lisible sans détails internes
  test('N-12 : état failed affiche message lisible', () => {
    const handlerIdx = src.indexOf("socket.on('attachment_updated'");
    const handlerEnd = src.indexOf('// Exposer le socket', handlerIdx);
    const handler = handlerIdx >= 0 && handlerEnd > handlerIdx ? src.slice(handlerIdx, handlerEnd) : src;
    const failedIdx = handler.indexOf("data.status === 'failed'");
    const failedBlock = failedIdx >= 0 ? handler.slice(failedIdx, failedIdx + 500) : '';
    // Message visible
    expect(failedBlock).toMatch(/Envoi échoué|envoi échoué|échec/i);
    // Pas de détails internes exposés dans textContent
    expect(failedBlock).not.toMatch(/Channex|cloudinary|HTTP|stack/i);
  });

  // N-13 : mauvais conversation_id → handler ignoré (idempotence)
  test('N-13 : attachment_updated ignoré si mauvaise conversation', () => {
    const handlerIdx = src.indexOf("socket.on('attachment_updated'");
    const handlerEnd = src.indexOf('// Exposer le socket', handlerIdx);
    const handler = handlerIdx >= 0 && handlerEnd > handlerIdx ? src.slice(handlerIdx, handlerEnd) : src;
    expect(handler).toMatch(/data\.conversation_id\s*!==\s*currentConversationId/);
    const guardIdx = handler.indexOf('data.conversation_id !== currentConversationId');
    const guardBlock = handler.slice(guardIdx, guardIdx + 80);
    expect(guardBlock).toMatch(/return/);
  });

  // N-14 : double clic bloqué — _uploadInProgress vérifié dans openPhotoUpload aussi
  test('N-14 : double clic bloqué dans openPhotoUpload (_uploadInProgress)', () => {
    const block = src.match(/openPhotoUpload\s*=\s*function[\s\S]*?^};/m)?.[0] || '';
    expect(block).toMatch(/if\s*\(\s*_uploadInProgress\s*\)\s*return/);
  });
});

// ── M. Non-régression ATTACHMENTS-6 ──────────────────────────────────────────
describe('M. Non-régression ATTACHMENTS-6', () => {
  test('M-01 : _bhRenderOneAttachment toujours définie', () => {
    expect(src).toMatch(/function\s+_bhRenderOneAttachment\s*\(/);
  });

  test('M-02 : _bhRenderAttachments toujours définie', () => {
    expect(src).toMatch(/function\s+_bhRenderAttachments\s*\(/);
  });

  test('M-03 : _bhLightboxShow toujours définie', () => {
    expect(src).toMatch(/function\s+_bhLightboxShow\s*\(/);
  });

  test('M-04 : branche inbound stored+url préservée dans attachment_updated', () => {
    const block = src.match(/socket\.on\s*\(\s*['"]attachment_updated[\s\S]*?\}\s*\)\s*;/)?.[0] || '';
    expect(block).toMatch(/_bhRenderOneAttachment/);
    expect(block).toMatch(/replaceChild/);
  });

  test('M-05 : _bhRenderAttachments appelé dans appendMessage', () => {
    expect(src).toMatch(/_bhRenderAttachments\s*\(\s*contentDiv\s*,\s*message\.attachments/);
  });

  test('M-06 : sendMessageOwner toujours exportée globalement', () => {
    expect(src).toMatch(/window\.sendMessageOwner\s*=\s*sendMessageOwner/);
  });
});
