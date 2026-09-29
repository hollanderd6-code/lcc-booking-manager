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

// ── H. sendMessageOwner — texte uniquement (PROD-FIX-2) ──────────────────────
describe('H. sendMessageOwner — texte uniquement (PROD-FIX-2)', () => {
  test('H-01 : retourne tôt si message vide (images → _bhSendPhotos)', () => {
    const fnBlock = src.match(/async\s+function\s+sendMessageOwner[\s\S]*?^\}/m)?.[0] || '';
    // Nouvelle garde : if (!message) return — sans condition _selectedFiles
    expect(fnBlock).toMatch(/if\s*\(\s*!message\s*\)\s*return/);
    // Pas d'ancienne garde combinée
    expect(fnBlock).not.toMatch(/!message\s*&&\s*_selectedFiles/);
  });

  test('H-02 : sendMessageOwner ne gère plus _uploadInProgress', () => {
    const fnBlock = src.match(/async\s+function\s+sendMessageOwner[\s\S]*?^\}/m)?.[0] || '';
    expect(fnBlock).not.toMatch(/if\s*\(\s*_uploadInProgress\s*\)\s*return/);
    expect(fnBlock).not.toMatch(/_uploadInProgress\s*=\s*true/);
  });

  test('H-03 : pas de snapshot _files dans sendMessageOwner', () => {
    const fnBlock = src.match(/async\s+function\s+sendMessageOwner[\s\S]*?^\}/m)?.[0] || '';
    expect(fnBlock).not.toMatch(/const\s+_files\s*=\s*\[\s*\.\.\._selectedFiles\s*\]/);
  });

  test('H-04 : sendMessageOwner ne touche pas _selectedFiles', () => {
    const fnBlock = src.match(/async\s+function\s+sendMessageOwner[\s\S]*?^\}/m)?.[0] || '';
    expect(fnBlock).not.toMatch(/_selectedFiles/);
  });

  test('H-05 : send-platform présent dans sendMessageOwner (envoi texte Channex)', () => {
    const fnBlock = src.match(/async\s+function\s+sendMessageOwner[\s\S]*?^\}/m)?.[0] || '';
    expect(fnBlock).toMatch(/send-platform/);
  });

  test('H-06 : sendMessageOwner n\'appelle PAS _sendOutboundImages (découplement)', () => {
    const fnBlock = src.match(/async\s+function\s+sendMessageOwner[\s\S]*?^\}/m)?.[0] || '';
    expect(fnBlock).not.toMatch(/_sendOutboundImages/);
  });

  test('H-07 : finally de sendMessageOwner ne contient pas _bhClearOutboundPreviews', () => {
    const fnBlock = src.match(/async\s+function\s+sendMessageOwner[\s\S]*?^\}/m)?.[0] || '';
    const posFinally = fnBlock.lastIndexOf('finally');
    const finallyBlock = posFinally >= 0 ? fnBlock.slice(posFinally) : '';
    expect(finallyBlock).not.toMatch(/_bhClearOutboundPreviews/);
  });

  test('H-08 : finally de sendMessageOwner ne réinitialise pas _selectedFiles', () => {
    const fnBlock = src.match(/async\s+function\s+sendMessageOwner[\s\S]*?^\}/m)?.[0] || '';
    const posFinally = fnBlock.lastIndexOf('finally');
    const finallyBlock = posFinally >= 0 ? fnBlock.slice(posFinally) : '';
    expect(finallyBlock).not.toMatch(/_selectedFiles\s*=\s*\[\]/);
  });

  test('H-09 : finally de sendMessageOwner libère uniquement sendBtn', () => {
    const fnBlock = src.match(/async\s+function\s+sendMessageOwner[\s\S]*?^\}/m)?.[0] || '';
    const posFinally = fnBlock.lastIndexOf('finally');
    const finallyBlock = posFinally >= 0 ? fnBlock.slice(posFinally) : '';
    expect(finallyBlock).toMatch(/sendBtn\.disabled\s*=\s*false/);
    expect(finallyBlock).not.toMatch(/_uploadInProgress\s*=\s*false/);
  });

  test('H-10 : pas de branche else image-only dans sendMessageOwner', () => {
    const fnBlock = src.match(/async\s+function\s+sendMessageOwner[\s\S]*?^\}/m)?.[0] || '';
    // L'ancien else { input.value = '' } pour image-only a été supprimé
    expect(fnBlock).not.toMatch(/\}\s*else\s*\{[\s\S]{0,100}input\.value\s*=\s*['"]{2}/);
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

  test('L-02 : _bhHandleFileSelection ne logge pas le contenu/nom du fichier (FIX-8 : count ok)', () => {
    const block = src.match(/function\s+_bhHandleFileSelection[\s\S]*?^}/m)?.[0] || '';
    // Interdit : noms, taille, type, base64 — le count seul (ATTACH-FRONT) est autorisé
    expect(block).not.toMatch(/console\.log.*f\.name/i);
    expect(block).not.toMatch(/console\.log.*f\.size/i);
    expect(block).not.toMatch(/console\.log.*f\.type/i);
    expect(block).not.toMatch(/console\.log.*base64/i);
    expect(block).not.toMatch(/console\.log.*file\b/i);
  });
});

// ── N. ATTACHMENTS-7C-FIX — corrections explicites ───────────────────────────
describe('N. ATTACHMENTS-7C-FIX — correctifs', () => {
  // N-01 : accept exact (spec exige image/jpeg,image/png,image/webp — pas image/*)
  test('N-01 : accept exact "image/jpeg,image/png,image/webp" dans le file picker', () => {
    expect(src).toMatch(/fi\.accept\s*=\s*['"]image\/jpeg,image\/png,image\/webp['"]/);
  });

  // N-02 : image-only géré par _bhSendPhotos — sendMessageOwner ne traite plus les images
  test('N-02 : _bhSendPhotos définie pour envoi image-only (PROD-FIX-2)', () => {
    expect(src).toMatch(/async\s+function\s+_bhSendPhotos\s*\(/);
  });

  // N-03 : aucun texte vide envoyé vers Channex — garde if(!message) en amont
  test('N-03 : send-platform présent dans sendMessageOwner, message vide intercepté en amont', () => {
    const fnBlock = src.match(/async\s+function\s+sendMessageOwner[\s\S]*?^\}/m)?.[0] || '';
    expect(fnBlock).toMatch(/send-platform/);
    // La garde précoce suffit — message toujours non-vide quand send-platform est atteint
    expect(fnBlock).toMatch(/if\s*\(\s*!message\s*\)\s*return/);
  });

  // N-04 : _sendOutboundImages dans _bhSendPhotos, pas dans sendMessageOwner
  // FIX-9 : l'argument est sendConvId (frozen at selection), pas currentConversationId direct
  test('N-04 : _sendOutboundImages appelé depuis _bhSendPhotos (pas sendMessageOwner)', () => {
    const sendFn = src.match(/async\s+function\s+sendMessageOwner[\s\S]*?^\}/m)?.[0] || '';
    const photosFn = src.match(/async\s+function\s+_bhSendPhotos[\s\S]*?^\}/m)?.[0] || '';
    expect(sendFn).not.toMatch(/_sendOutboundImages/);
    expect(photosFn).toMatch(/_sendOutboundImages\s*\(\s*sendConvId\s*\)/);
  });

  // N-05 : _clearFiles dans _bhSendPhotos (déplacé depuis sendMessageOwner)
  test('N-05 : flag _clearFiles dans _bhSendPhotos', () => {
    const block = src.match(/async\s+function\s+_bhSendPhotos[\s\S]*?^\}/m)?.[0] || '';
    expect(block).toMatch(/let\s+_clearFiles\s*=/);
  });

  // N-06 : finally conditionnel dans _bhSendPhotos — nettoyage seulement si _clearFiles
  test('N-06 : finally de _bhSendPhotos nettoie uniquement si _clearFiles', () => {
    const block = src.match(/async\s+function\s+_bhSendPhotos[\s\S]*?^\}/m)?.[0] || '';
    const finallyIdx = block.lastIndexOf('finally');
    const finallyBlock = block.slice(finallyIdx);
    expect(finallyBlock).toMatch(/if\s*\(\s*_clearFiles\s*\)/);
    expect(finallyBlock).toMatch(/_bhClearOutboundPreviews/);
    expect(finallyBlock).toMatch(/_selectedFiles\s*=\s*\[\]/);
  });

  // N-07 : _uploadInProgress toujours libéré dans finally de _bhSendPhotos (retry possible)
  test('N-07 : _uploadInProgress libéré avant if(_clearFiles) dans _bhSendPhotos', () => {
    const block = src.match(/async\s+function\s+_bhSendPhotos[\s\S]*?^\}/m)?.[0] || '';
    const finallyIdx = block.lastIndexOf('finally');
    const finallyBlock = block.slice(finallyIdx);
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
    expect(failedBlock).toMatch(/Envoi échoué|envoi échoué|échec/i);
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

// ── P. ATTACHMENTS-PROD-FIX-2 — confirmation explicite avant envoi ─────────
describe('P. PROD-FIX-2 — confirmation explicite avant envoi image', () => {

  // P-01 : sélection de fichiers != envoi — _bhHandleFileSelection n'appelle pas _bhSendPhotos
  test('P-01 : sélection fichiers ne déclenche pas l\'envoi', () => {
    const block = src.match(/function\s+_bhHandleFileSelection[\s\S]*?^}/m)?.[0] || '';
    expect(block).not.toMatch(/_bhSendPhotos/);
    expect(block).not.toMatch(/sendMessageOwner/);
    expect(block).not.toMatch(/fetch|XMLHttpRequest/);
  });

  // P-02 : _bhCancelOutbound définie — ne contient aucun réseau
  test('P-02 : _bhCancelOutbound définie sans requête réseau', () => {
    expect(src).toMatch(/function\s+_bhCancelOutbound\s*\(/);
    const block = src.match(/function\s+_bhCancelOutbound[\s\S]*?^}/m)?.[0] || '';
    expect(block).not.toMatch(/fetch|XMLHttpRequest|FormData|ajax/i);
    expect(block).toMatch(/_selectedFiles\s*=\s*\[\]/);
    expect(block).toMatch(/_bhClearOutboundPreviews/);
  });

  // P-03 : _bhSendPhotos appelle _sendOutboundImages (image-only fonctionne)
  test('P-03 : _bhSendPhotos appelle _sendOutboundImages', () => {
    const block = src.match(/async\s+function\s+_bhSendPhotos[\s\S]*?^\}/m)?.[0] || '';
    expect(block).toMatch(/_sendOutboundImages\s*\(/);
  });

  // P-04 : sendMessageOwner n'appelle pas _sendOutboundImages ni _bhSendPhotos (découplement)
  test('P-04 : sendMessageOwner ne déclenche PAS l\'envoi d\'images', () => {
    const block = src.match(/async\s+function\s+sendMessageOwner[\s\S]*?^\}/m)?.[0] || '';
    expect(block).not.toMatch(/_sendOutboundImages/);
    // Pas d'appel (parenthèse) — le commentaire explicatif est toléré
    expect(block).not.toMatch(/_bhSendPhotos\s*\(/);
  });

  // P-05 : bouton dédié .bh-outbound-send-btn créé dans _bhRefreshPreviewZone
  test('P-05 : bouton dédié bh-outbound-send-btn créé dans la zone de confirmation', () => {
    const block = src.match(/function\s+_bhRefreshPreviewZone[\s\S]*?^}/m)?.[0] || '';
    expect(block).toMatch(/bh-outbound-send-btn/);
    expect(block).toMatch(/bh-outbound-cancel-btn/);
    expect(block).toMatch(/_bhSendPhotos/);
    expect(block).toMatch(/_bhCancelOutbound/);
  });

  // P-06 : double clic impossible — _uploadInProgress vérifié dans _bhSendPhotos
  test('P-06 : double clic bloqué — _uploadInProgress dans _bhSendPhotos', () => {
    const block = src.match(/async\s+function\s+_bhSendPhotos[\s\S]*?^\}/m)?.[0] || '';
    expect(block).toMatch(/if\s*\(\s*_uploadInProgress\s*\)\s*return/);
    expect(block).toMatch(/_uploadInProgress\s*=\s*true/);
  });

  // P-07 : erreur réseau conserve previews — _clearFiles reste false si !dispatched
  test('P-07 : erreur réseau conserve les previews (dispatched=false → réactive boutons)', () => {
    const block = src.match(/async\s+function\s+_bhSendPhotos[\s\S]*?^\}/m)?.[0] || '';
    // La branche else du finally réactive les boutons
    const finallyIdx = block.lastIndexOf('finally');
    const finallyBlock = block.slice(finallyIdx);
    expect(finallyBlock).toMatch(/\.disabled\s*=\s*false/);
    expect(finallyBlock).toMatch(/bh-outbound-send-btn/);
  });

  // P-08 : succès nettoie previews — _clearFiles=true si dispatched
  test('P-08 : succès nettoie previews et _selectedFiles', () => {
    const block = src.match(/async\s+function\s+_bhSendPhotos[\s\S]*?^\}/m)?.[0] || '';
    const finallyIdx = block.lastIndexOf('finally');
    const finallyBlock = block.slice(finallyIdx);
    expect(finallyBlock).toMatch(/_bhClearOutboundPreviews/);
    expect(finallyBlock).toMatch(/_selectedFiles\s*=\s*\[\]/);
  });

  // P-09 : object URLs révoquées à l'annulation (_bhCancelOutbound → _bhClearOutboundPreviews)
  test('P-09 : _bhCancelOutbound révoque les object URLs via _bhClearOutboundPreviews', () => {
    const cancelBlock = src.match(/function\s+_bhCancelOutbound[\s\S]*?^}/m)?.[0] || '';
    expect(cancelBlock).toMatch(/_bhClearOutboundPreviews/);
    // _bhClearOutboundPreviews contient revokeObjectURL
    const clearBlock = src.match(/function\s+_bhClearOutboundPreviews[\s\S]*?^}/m)?.[0] || '';
    expect(clearBlock).toMatch(/URL\.revokeObjectURL/);
  });

  // P-10 : multi-images — libellé pluriel "Envoyer les photos"
  test('P-10 : bouton affiche "Envoyer les photos" pour plusieurs images', () => {
    const block = src.match(/function\s+_bhRefreshPreviewZone[\s\S]*?^}/m)?.[0] || '';
    expect(block).toMatch(/Envoyer la photo/);
    expect(block).toMatch(/Envoyer les photos/);
    // Choix conditionnel selon le nombre de fichiers
    expect(block).toMatch(/_selectedFiles\.length\s*===\s*1/);
  });

  // P-11 : changement de conversation nettoie la sélection
  test('P-11 : openChat réinitialise _selectedFiles et previews (changement conversation)', () => {
    const block = src.match(/async\s+function\s+openChat[\s\S]*?^\}/m)?.[0] || '';
    expect(block).toMatch(/_selectedFiles\s*=\s*\[\]/);
    expect(block).toMatch(/_bhClearOutboundPreviews/);
    expect(block).toMatch(/_uploadInProgress\s*=\s*false/);
  });

  // P-12 : canal incompatible → photoUploadBtn caché, _selectedFiles vidés
  test('P-12 : canal non supporté masque photoUploadBtn et vide la sélection', () => {
    const block = src.match(/async\s+function\s+_checkChannexConversation[\s\S]*?^\}/m)?.[0] || '';
    expect(block).toMatch(/_supportsOutboundImage/);
    expect(block).toMatch(/photoBtn\.style\.display\s*=\s*['"]none['"]/);
    expect(block).toMatch(/_bhClearOutboundPreviews/);
  });

  // P-13 : CSS boutons confirmation définis
  test('P-13 : CSS .bh-outbound-cancel-btn et .bh-outbound-send-btn définis', () => {
    expect(src).toMatch(/\.bh-outbound-cancel-btn\s*\{/);
    expect(src).toMatch(/\.bh-outbound-send-btn\s*\{/);
    expect(src).toMatch(/\.bh-outbound-confirm-actions\s*\{/);
    expect(src).toMatch(/\.bh-outbound-confirm-thumbs\s*\{/);
  });

  // P-14 : boutons désactivés pendant l'upload — disabled = true avant await
  test('P-14 : boutons désactivés pendant l\'upload', () => {
    const block = src.match(/async\s+function\s+_bhSendPhotos[\s\S]*?^\}/m)?.[0] || '';
    const beforeAwait = block.slice(0, block.indexOf('await _sendOutboundImages'));
    expect(beforeAwait).toMatch(/sendBtn\.disabled\s*=\s*true/);
    expect(beforeAwait).toMatch(/cancelBtn\.disabled\s*=\s*true/);
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

// ── Q. ATTACHMENTS-PROD-FIX-4 — anti-régression cross-file messages.html ─────
// Tests croisés : garantissent que messages.html ne peut plus masquer
// la définition de window.openPhotoUpload de chat-owner.js.
describe('Q. PROD-FIX-4 — anti-régression messages.html vs chat-owner.js', () => {
  const html = require('fs').readFileSync(
    require('path').join(__dirname, '../public/messages.html'),
    'utf8'
  );

  // Q-01 : messages.html ne définit plus window.openPhotoUpload
  test('Q-01 : messages.html ne définit PAS window.openPhotoUpload', () => {
    expect(html).not.toMatch(/window\.openPhotoUpload\s*=/);
  });

  // Q-02 : messages.html peut APPELER openPhotoUpload mais ne doit pas l'implémenter
  test('Q-02 : messages.html peut appeler openPhotoUpload (bouton HTML)', () => {
    expect(html).toMatch(/openPhotoUpload\s*\(\s*\)/);
    expect(html).not.toMatch(/window\.openPhotoUpload\s*=\s*function/);
  });

  // Q-03 : chat-owner.js est l'unique implémentation frontend propriétaire
  test('Q-03 : chat-owner.js contient l\'unique window.openPhotoUpload du frontend', () => {
    const count = (src.match(/window\.openPhotoUpload\s*=/g) || []).length;
    expect(count).toBe(1);
  });

  // Q-04 : messages.html ne fait PAS de fetch vers api.cloudinary.com
  test('Q-04 : aucun upload direct Cloudinary dans messages.html', () => {
    expect(html).not.toMatch(/api\.cloudinary\.com/);
    expect(html).not.toMatch(/upload_preset/);
  });

  // Q-05 : messages.html ne construit plus de message [IMAGE:<url>] à envoyer
  test('Q-05 : messages.html ne produit plus de tag [IMAGE:url]', () => {
    // Le reader (fixImageBubbles) est toléré — seul le producer est interdit
    // Le producer construisait : '[IMAGE:' + imageUrl + ']' envoyé via fetch
    // On cherche la combinaison distinctive : [IMAGE: + /api/chat/send dans le même contexte
    const imageProducerPattern = /\[IMAGE:.*fetch\s*\(.*\/api\/chat\/send/s;
    expect(html).not.toMatch(imageProducerPattern);
    // Vérification supplémentaire : pas de '[IMAGE:' + variable (construction dynamique)
    expect(html).not.toMatch(/\[IMAGE:\s*['"]\s*\+\s*\w/);
  });

  // Q-06 : le chemin ATTACHMENTS — sélection ne provoque aucun réseau dans messages.html
  test('Q-06 : openPhotoUpload dans messages.html ne contient aucun fetch inline', () => {
    // Comme window.openPhotoUpload n'est plus définie dans messages.html,
    // il ne peut y avoir aucun fetch inline dans ce bloc inexistant
    expect(html).not.toMatch(/window\.openPhotoUpload\s*=[\s\S]*?fetch\s*\(/);
  });

  // Q-07 : _bhSendPhotos est l'unique déclencheur réseau pour les images (dans chat-owner.js)
  test('Q-07 : _bhSendPhotos est le seul point d\'envoi réseau image (chat-owner.js)', () => {
    const block = src.match(/async\s+function\s+_bhSendPhotos[\s\S]*?^\}/m)?.[0] || '';
    expect(block).toMatch(/_sendOutboundImages/);
    // _sendOutboundImages utilise XHR (XMLHttpRequest), PAS fetch — c'est la garantie de l'upload stream
    const sendBlock = src.match(/async\s+function\s+_sendOutboundImages[\s\S]*?^\}/m)?.[0] || '';
    expect(sendBlock).toMatch(/XMLHttpRequest/);
    expect(sendBlock).not.toMatch(/\bfetch\s*\(/);
  });

  // Q-08 : Annuler → _bhCancelOutbound — pas de réseau dans messages.html ni chat-owner.js cancel
  test('Q-08 : _bhCancelOutbound ne contient aucun appel réseau', () => {
    const block = src.match(/function\s+_bhCancelOutbound[\s\S]*?^}/m)?.[0] || '';
    expect(block).not.toMatch(/fetch|XMLHttpRequest|FormData/);
  });

  // Q-09 : le cache-busting chat-owner.js dans messages.html est différent de l'ancienne valeur
  test('Q-09 : version chat-owner.js dans messages.html ≠ ancienne valeur f78c0252', () => {
    expect(html).toMatch(/chat-owner\.js\?v=/);
    expect(html).not.toMatch(/chat-owner\.js\?v=f78c0252/);
  });

  // Q-10 : une seule définition de window.openPhotoUpload dans tout le frontend propriétaire
  test('Q-10 : une seule définition globale de window.openPhotoUpload (chat-owner.js uniquement)', () => {
    // messages.html : 0 définitions
    const htmlDefs = (html.match(/window\.openPhotoUpload\s*=/g) || []).length;
    expect(htmlDefs).toBe(0);
    // chat-owner.js : exactement 1 définition
    const jsDefs = (src.match(/window\.openPhotoUpload\s*=/g) || []).length;
    expect(jsDefs).toBe(1);
  });
});

// ── R. PROD-FIX-5 — _getConversationOta : résolution OTA robuste ─────────────
describe('R. PROD-FIX-5 — _getConversationOta résolution OTA (conv.platform || conv.ota_name)', () => {
  const chatRoutesSrc = require('fs').readFileSync(
    require('path').join(__dirname, '../routes/chat_routes.js'),
    'utf8'
  );

  // R-01 : _getConversationOta est définie dans chat-owner.js
  test('R-01 : _getConversationOta est définie', () => {
    expect(src).toMatch(/function\s+_getConversationOta\s*\(/);
  });

  // R-02 : utilise conv.platform en première source
  test('R-02 : _getConversationOta utilise conv.platform', () => {
    const block = src.match(/function\s+_getConversationOta[\s\S]*?^}/m)?.[0] || '';
    expect(block).toMatch(/conv\.platform/);
  });

  // R-03 : utilise conv.ota_name comme fallback
  test('R-03 : _getConversationOta utilise conv.ota_name comme fallback', () => {
    const block = src.match(/function\s+_getConversationOta[\s\S]*?^}/m)?.[0] || '';
    expect(block).toMatch(/conv\.ota_name/);
  });

  // R-04 : retourne '' (pas d'exception) si conv est null/undefined
  test('R-04 : _getConversationOta gère conv null/undefined sans exception', () => {
    const block = src.match(/function\s+_getConversationOta[\s\S]*?^}/m)?.[0] || '';
    // Guard sur !conv avant accès aux propriétés
    expect(block).toMatch(/if\s*\(!conv\)/);
  });

  // R-05 : normalise en lowercase pour compatibilité avec _supportsOutboundImage
  test('R-05 : _getConversationOta applique toLowerCase()', () => {
    const block = src.match(/function\s+_getConversationOta[\s\S]*?^}/m)?.[0] || '';
    expect(block).toMatch(/toLowerCase/);
  });

  // R-06 : openPhotoUpload utilise _getConversationOta au lieu de conv.platform direct
  test('R-06 : openPhotoUpload passe _getConversationOta(conv) à _supportsOutboundImage', () => {
    const block = src.match(/window\.openPhotoUpload\s*=[\s\S]*?^\};/m)?.[0] || '';
    expect(block).toMatch(/_supportsOutboundImage\s*\(\s*_getConversationOta\s*\(/);
    expect(block).not.toMatch(/_supportsOutboundImage\s*\(\s*conv\.platform/);
  });

  // R-07 : _checkChannexConversation utilise _getConversationOta
  test('R-07 : _checkChannexConversation utilise _getConversationOta pour résoudre le platform', () => {
    // Extrait depuis le début de _checkChannexConversation jusqu'à la fin du fichier,
    // puis cherche _getConversationOta dans cette portion
    const startIdx = src.indexOf('async function _checkChannexConversation(');
    expect(startIdx).toBeGreaterThan(-1);
    const tail = src.slice(startIdx, startIdx + 2000);
    expect(tail).toMatch(/_getConversationOta\s*\(/);
  });

  // R-08 : conversations API retourne r.ota_name depuis le JOIN reservations
  test('R-08 : GET /api/chat/conversations sélectionne r.ota_name', () => {
    expect(chatRoutesSrc).toMatch(/r\.ota_name/);
  });

  // R-09 : _supportsOutboundImage reste fail-closed (ne change pas)
  test('R-09 : _supportsOutboundImage retourne false pour valeur inconnue (fail-closed)', () => {
    const block = src.match(/function\s+_supportsOutboundImage[\s\S]*?^}/m)?.[0] || '';
    expect(block).toMatch(/return false/);
    // Pas de return true par défaut
    const lines = block.split('\n');
    const defaultTrue = lines.find(l => !l.includes('airbnb') && !l.includes('abb') && !l.includes('booking') && !l.includes('bdc') && !l.includes('expedia') && l.includes('return true'));
    expect(defaultTrue).toBeUndefined();
  });

  // R-10 : _checkChannexConversation n'utilise plus conv.platform directement pour la comparaison OTA
  test('R-10 : _checkChannexConversation ne lit plus conv.platform directement pour la résolution OTA', () => {
    const block = src.match(/async\s+function\s+_checkChannexConversation[\s\S]*?^\s*}/m)?.[0] || '';
    // La ligne   const platform = (conv ? conv.platform || '' : '').toLowerCase()  a été supprimée
    expect(block).not.toMatch(/conv\s*\?\s*conv\.platform/);
  });

  // R-11 : _getConversationOta est positionnée après _supportsOutboundImage (ordre de déclaration)
  test('R-11 : _getConversationOta est déclarée après _supportsOutboundImage dans le source', () => {
    const idxSupports = src.indexOf('function _supportsOutboundImage(');
    const idxGetOta   = src.indexOf('function _getConversationOta(');
    expect(idxSupports).toBeGreaterThan(-1);
    expect(idxGetOta).toBeGreaterThan(idxSupports);
  });

  // R-12 : logique explicite channex → ota_name (pas de court-circuit || qui retournerait 'channex')
  test('R-12 : _getConversationOta utilise une comparaison explicite platform === "channex"', () => {
    const block = src.match(/function\s+_getConversationOta[\s\S]*?^}/m)?.[0] || '';
    // La logique doit être : if (platform === 'channex') return otaName
    // et PAS : conv.platform || conv.ota_name (qui court-circuiterait avec 'channex')
    expect(block).toMatch(/platform\s*===\s*['"]channex['"]/);
    expect(block).not.toMatch(/conv\.platform\s*\|\|\s*conv\.ota_name/);
  });
});

// ── S. PROD-FIX-5B — Tests comportementaux (exécution réelle des fonctions) ──
describe('S. PROD-FIX-5B — Comportement réel _getConversationOta + _supportsOutboundImage', () => {
  let _getConversationOta;
  let _supportsOutboundImage;
  let supports; // shorthand : supports(conv) → bool

  beforeAll(() => {
    const getOtaSrc      = src.match(/function _getConversationOta\b[\s\S]*?^}/m)?.[0] || '';
    const supportsImgSrc = src.match(/function _supportsOutboundImage\b[\s\S]*?^}/m)?.[0] || '';
    expect(getOtaSrc).not.toBe('');
    expect(supportsImgSrc).not.toBe('');
    // eslint-disable-next-line no-new-func
    const harness = new Function(`${supportsImgSrc}\n${getOtaSrc}\nreturn { _getConversationOta, _supportsOutboundImage };`)();
    _getConversationOta  = harness._getConversationOta;
    _supportsOutboundImage = harness._supportsOutboundImage;
    supports = (conv) => _supportsOutboundImage(_getConversationOta(conv));
  });

  // S-01 : cas production principal — platform='channex', ota_name='Airbnb' → autorisé
  test('S-01 : platform="channex" + ota_name="Airbnb" → autorisé', () => {
    const conv = { platform: 'channex', ota_name: 'Airbnb' };
    expect(_getConversationOta(conv)).toBe('airbnb');
    expect(supports(conv)).toBe(true);
  });

  // S-02 : casse mixte — ota_name='AirBNB' → autorisé
  test('S-02 : platform="channex" + ota_name="AirBNB" → autorisé', () => {
    expect(supports({ platform: 'channex', ota_name: 'AirBNB' })).toBe(true);
  });

  // S-03 : Booking.com via code court — ota_name='Bdc' → autorisé
  test('S-03 : platform="channex" + ota_name="Bdc" → autorisé', () => {
    expect(supports({ platform: 'channex', ota_name: 'Bdc' })).toBe(true);
  });

  // S-04 : Booking.com via code long — ota_name='BookingCom' → autorisé
  test('S-04 : platform="channex" + ota_name="BookingCom" → autorisé', () => {
    expect(supports({ platform: 'channex', ota_name: 'BookingCom' })).toBe(true);
  });

  // S-05 : Expedia via code court — ota_name='Exp' → autorisé
  test('S-05 : platform="channex" + ota_name="Exp" → autorisé', () => {
    expect(supports({ platform: 'channex', ota_name: 'Exp' })).toBe(true);
  });

  // S-06 : Expedia via code court — ota_name='Expedia' → autorisé
  test('S-06 : platform="channex" + ota_name="Expedia" → autorisé', () => {
    expect(supports({ platform: 'channex', ota_name: 'Expedia' })).toBe(true);
  });

  // S-07 : platform='airbnb' direct (ota_name absent) → autorisé
  test('S-07 : platform="airbnb" + ota_name=null → autorisé', () => {
    expect(supports({ platform: 'airbnb', ota_name: null })).toBe(true);
  });

  // S-08 : platform='booking' direct (ota_name absent) → autorisé
  test('S-08 : platform="booking" + ota_name=null → autorisé', () => {
    expect(supports({ platform: 'booking', ota_name: null })).toBe(true);
  });

  // S-09 : platform='channex' + ota_name=null → refusé (fail-closed)
  test('S-09 : platform="channex" + ota_name=null → refusé', () => {
    expect(_getConversationOta({ platform: 'channex', ota_name: null })).toBe('');
    expect(supports({ platform: 'channex', ota_name: null })).toBe(false);
  });

  // S-10 : platform='direct' + ota_name='Airbnb' → refusé (direct ne doit pas hériter OTA)
  test('S-10 : platform="direct" + ota_name="Airbnb" → refusé', () => {
    expect(_getConversationOta({ platform: 'direct', ota_name: 'Airbnb' })).toBe('direct');
    expect(supports({ platform: 'direct', ota_name: 'Airbnb' })).toBe(false);
  });

  // S-11 : platform=null + ota_name='Airbnb' → autorisé (conv très ancienne sans platform)
  test('S-11 : platform=null + ota_name="Airbnb" → autorisé', () => {
    expect(supports({ platform: null, ota_name: 'Airbnb' })).toBe(true);
  });

  // S-12 : platform='ical' + ota_name=null → refusé
  test('S-12 : platform="ical" + ota_name=null → refusé', () => {
    expect(supports({ platform: 'ical', ota_name: null })).toBe(false);
  });
});

// ── T. PROD-FIX-6 — Anti-régression producteurs [IMAGE:] + traces ATTACH-RUNTIME ──
describe('T. PROD-FIX-6 — Producteurs [IMAGE:] et ATTACH-RUNTIME', () => {
  const html        = require('fs').readFileSync(require('path').join(__dirname, '../public/messages.html'), 'utf8');
  const chatSrc     = require('fs').readFileSync(require('path').join(__dirname, '../public/js/chat-owner.js'), 'utf8');
  const routesSrc   = require('fs').readFileSync(require('path').join(__dirname, '../routes/chat_routes.js'), 'utf8');
  const senderSrc   = require('fs').readFileSync(require('path').join(__dirname, '../services/channex-attachment-sender.js'), 'utf8');

  // T-01 : messages.html ne contient aucun producteur [IMAGE:url]
  test('T-01 : messages.html ne produit pas de tag [IMAGE:url]', () => {
    // Production = construction dynamique '[IMAGE:' + url
    expect(html).not.toMatch(/\[IMAGE:\s*['"]\s*\+/);           // '[IMAGE:' + variable
    expect(html).not.toMatch(/`\[IMAGE:\$\{/);                   // template literal `[IMAGE:${url}`
    expect(html).not.toMatch(/window\.openPhotoUpload[\s\S]{0,300}api\.cloudinary\.com/);
  });

  // T-02 : chat-owner.js ne contient aucun producteur [IMAGE:url]
  test('T-02 : chat-owner.js ne produit pas de tag [IMAGE:url]', () => {
    expect(chatSrc).not.toMatch(/\[IMAGE:\s*['"]\s*\+/);
    expect(chatSrc).not.toMatch(/`\[IMAGE:\$\{/);
    expect(chatSrc).not.toMatch(/api\.cloudinary\.com/);
  });

  // T-03 : _bhSendPhotos utilise uniquement le nouvel endpoint /attachments
  test('T-03 : _bhSendPhotos délègue à _sendOutboundImages (→ /attachments, pas /send)', () => {
    const block = chatSrc.match(/async\s+function\s+_bhSendPhotos[\s\S]*?^\}/m)?.[0] || '';
    expect(block).toMatch(/_sendOutboundImages/);
    expect(block).not.toMatch(/\/api\/chat\/send/);
    expect(block).not.toMatch(/\[IMAGE:/);
  });

  // T-04 : _sendOutboundImages pointe vers /conversations/:id/attachments
  test('T-04 : _sendOutboundImages utilise /api/chat/conversations/:id/attachments', () => {
    const block = chatSrc.match(/async\s+function\s+_sendOutboundImages[\s\S]*?^\}/m)?.[0] || '';
    expect(block).toMatch(/\/api\/chat\/conversations\b.*\/attachments/);
    expect(block).not.toMatch(/\/api\/chat\/send/);
  });

  // T-05 : chat-owner.js lit les anciens [IMAGE:url] (lecteur legacy intact)
  test('T-05 : chat-owner.js contient le lecteur legacy [IMAGE:url] (render)', () => {
    // Le replace supprime les [IMAGE:] pour le texte brut — c'est le lecteur
    expect(chatSrc).toMatch(/\[IMAGE:[^\]]+\]/);
    // Mais AUCUNE production directe
    expect(chatSrc).not.toMatch(/`\[IMAGE:\$\{/);
  });

  // T-06 : /api/chat/send contient le marqueur de détection legacy
  test('T-06 : /api/chat/send contient la détection LEGACY IMAGE MESSAGE', () => {
    expect(routesSrc).toMatch(/LEGACY IMAGE MESSAGE DETECTED via \/api\/chat\/send/);
    // Vérifie que c'est un warn (pas un throw/block)
    expect(routesSrc).toMatch(/console\.warn.*LEGACY IMAGE MESSAGE/);
  });

  // T-07 : POST /api/chat/conversations/:id/attachments contient les marqueurs ATTACH-RUNTIME
  test('T-07 : endpoint /attachments contient les 3 marqueurs ATTACH-RUNTIME (FIX-6-C)', () => {
    expect(routesSrc).toMatch(/\[ATTACH-RUNTIME\] upload endpoint hit/);
    expect(routesSrc).toMatch(/\[ATTACH-RUNTIME\] attachment created/);
    expect(routesSrc).toMatch(/\[ATTACH-RUNTIME\] scheduling outbound/);
  });

  // T-08 : sendOutboundAttachment contient les marqueurs ATTACH-RUNTIME
  test('T-08 : sendOutboundAttachment contient les 4 marqueurs ATTACH-RUNTIME (FIX-6-C)', () => {
    expect(senderSrc).toMatch(/\[ATTACH-RUNTIME\] sender start/);
    expect(senderSrc).toMatch(/\[ATTACH-RUNTIME\] Channex attachment uploaded/);
    expect(senderSrc).toMatch(/\[ATTACH-RUNTIME\] Channex attachment message accepted/);
    expect(senderSrc).toMatch(/\[ATTACH-RUNTIME\] CHANNEL_NOT_SUPPORTED/);
  });

  // T-09 : le marqueur CHANNEL_NOT_SUPPORTED logue la valeur résolue (pour diagnostic)
  // Note : depuis PROD-FIX-7 le log expose resolved= (valeur après resolveOutboundOta)
  test('T-09 : CHANNEL_NOT_SUPPORTED log expose resolved= pour diagnostic', () => {
    expect(senderSrc).toMatch(/CHANNEL_NOT_SUPPORTED.*resolved=/);
  });

  // T-10 : backend supportsOutboundImage détecte bien 'abb' et 'bdc' (codes courts Channex)
  // (note: manque encore 'exp' et fallback ota_name — ces gaps sont répertoriés dans le rapport)
  test('T-10 : backend supportsOutboundImage gère les codes courts abb et bdc', () => {
    const block = senderSrc.match(/function supportsOutboundImage[\s\S]*?^}/m)?.[0] || '';
    expect(block).toMatch(/=== ['"]abb['"]/);
    expect(block).toMatch(/=== ['"]bdc['"]/);
  });
});
