'use strict';
/**
 * ATTACHMENTS-6 — Affichage Web des pièces jointes (chat-owner.js)
 *
 * Tests structurels — aucune connexion DB, aucune connexion réseau.
 * Stratégie : analyse statique du source JS + exécution dans un environnement
 * DOM simulé minimal (jsdom ou chaîne de regex/AST légère).
 *
 * A. Injection CSS — _ensureBhAttachStyles
 * B. Lightbox — _bhLightboxShow / _bhLightboxHide
 * C. URL expirée — _bhRefreshAttachUrl
 * D. Rendu image — _bhRenderOneAttachment (type image)
 * E. Rendu vidéo — _bhRenderOneAttachment (type video)
 * F. Rendu document — _bhRenderOneAttachment (type document)
 * G. État pending — _bhRenderOneAttachment (status pending)
 * H. État failed — _bhRenderOneAttachment (status failed)
 * I. Données manquantes (no url stored) — bh-att-failed
 * J. _bhRenderAttachments — photo_url legacy
 * K. _bhRenderAttachments — grille 1 image (cnt-1)
 * L. _bhRenderAttachments — grille 2 images (cnt-2)
 * M. _bhRenderAttachments — grille 3+ images (cnt-m)
 * N. _bhRenderAttachments — mix image+doc
 * O. appendMessage — _bhRenderAttachments appelé
 * P. Socket attachment_updated — intégré après new_platform_message
 * Q. Socket attachment_updated — filtre par conversation_id
 * R. Socket attachment_updated — status != stored → skip
 * S. XSS — filename rendu via textContent
 * T. Non-régression displayMessages — filtre media-only
 * U. Non-régression photo_url — pas supprimée du SELECT
 * V. Sécurité — source_url absent du rendu frontend
 * W. Pending — data-att-type stocké pour update ultérieur
 */

const fs   = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../public/js/chat-owner.js'), 'utf8'
);

// ── A. Injection CSS ─────────────────────────────────────────────────────────
describe('A. _ensureBhAttachStyles', () => {
  test('A-01 : fonction définie', () => {
    expect(src).toMatch(/function\s+_ensureBhAttachStyles\s*\(\s*\)/);
  });

  test('A-02 : id bhAttachStyles utilisé', () => {
    expect(src).toMatch(/bhAttachStyles/);
  });

  test('A-03 : CSS grille bh-attach-grid défini', () => {
    expect(src).toMatch(/\.bh-attach-grid/);
  });

  test('A-04 : classes cnt-1, cnt-2, cnt-m présentes', () => {
    expect(src).toMatch(/cnt-1/);
    expect(src).toMatch(/cnt-2/);
    expect(src).toMatch(/cnt-m/);
  });

  test('A-05 : CSS pending avec animation spin', () => {
    expect(src).toMatch(/bhAttSpin/);
    expect(src).toMatch(/bh-att-pending/);
  });

  test('A-06 : CSS failed défini', () => {
    expect(src).toMatch(/bh-att-failed/);
  });

  test('A-07 : CSS lightbox #bhLightbox défini', () => {
    expect(src).toMatch(/#bhLightbox/);
  });

  test('A-08 : injecté dans document.head', () => {
    expect(src).toMatch(/document\.head\.appendChild/);
  });

  test('A-09 : idempotent — guard sur getElementById', () => {
    expect(src).toMatch(/getElementById\(['"]bhAttachStyles['"]\)/);
  });
});

// ── B. Lightbox ──────────────────────────────────────────────────────────────
describe('B. Lightbox', () => {
  test('B-01 : _bhLightboxShow définie', () => {
    expect(src).toMatch(/function\s+_bhLightboxShow\s*\(/);
  });

  test('B-02 : _bhLightboxHide définie', () => {
    expect(src).toMatch(/function\s+_bhLightboxHide\s*\(\s*\)/);
  });

  test('B-03 : fermeture par backdrop onclick', () => {
    expect(src).toMatch(/lb\.onclick\s*=\s*_bhLightboxHide/);
  });

  test('B-04 : fermeture par touche Escape', () => {
    expect(src).toMatch(/e\.key\s*===\s*['"]Escape['"]/);
    expect(src).toMatch(/_bhLightboxHide\(\)/);
  });

  test('B-05 : rôle dialog ARIA', () => {
    expect(src).toMatch(/setAttribute\s*\(\s*['"]role['"]\s*,\s*['"]dialog['"]/);
  });

  test('B-06 : bouton fermeture id bhLightboxClose', () => {
    expect(src).toMatch(/bhLightboxClose/);
  });

  test('B-07 : overflow hidden sur body ouverture', () => {
    expect(src).toMatch(/document\.body\.style\.overflow\s*=\s*['"]hidden['"]/);
  });

  test('B-08 : overflow restauré à la fermeture', () => {
    expect(src).toMatch(/document\.body\.style\.overflow\s*=\s*['"]{2}/);
  });
});

// ── C. URL refresh ───────────────────────────────────────────────────────────
describe('C. _bhRefreshAttachUrl', () => {
  test('C-01 : fonction async définie', () => {
    expect(src).toMatch(/async\s+function\s+_bhRefreshAttachUrl\s*\(/);
  });

  test('C-02 : appel /api/chat/attachments/:id', () => {
    expect(src).toMatch(/\/api\/chat\/attachments\/\$\{/);
  });

  test('C-03 : header Authorization Bearer', () => {
    expect(src).toMatch(/'Authorization'.*Bearer/);
  });

  test('C-04 : retourne null en cas d\'erreur', () => {
    expect(src).toMatch(/return\s+null/);
  });

  test('C-05 : lit lcc_token depuis localStorage', () => {
    expect(src).toMatch(/localStorage\.getItem\(['"]lcc_token['"]\)/);
  });
});

// ── D. Rendu image ───────────────────────────────────────────────────────────
describe('D. _bhRenderOneAttachment — image', () => {
  test('D-01 : classe bh-att-img-w sur le wrapper', () => {
    expect(src).toMatch(/bh-att-img-w/);
  });

  test('D-02 : classe bh-att-img sur l\'img', () => {
    expect(src).toMatch(/bh-att-img/);
  });

  test('D-03 : loading lazy', () => {
    expect(src).toMatch(/img\.loading\s*=\s*['"]lazy['"]/);
  });

  test('D-04 : onclick lightbox', () => {
    expect(src).toMatch(/img\.onclick.*_bhLightboxShow/);
  });

  test('D-05 : retry unique via _bhRefreshAttachUrl', () => {
    expect(src).toMatch(/img\.onerror[\s\S]*_bhRefreshAttachUrl/);
  });

  test('D-06 : fallback bh-att-failed si retry échoue', () => {
    expect(src).toMatch(/_bhRefreshAttachUrl[\s\S]*bh-att-failed/);
  });

  test('D-07 : data-att-id sur l\'image', () => {
    expect(src).toMatch(/img\.setAttribute\s*\(\s*['"]data-att-id['"]/);
  });
});

// ── E. Rendu vidéo ───────────────────────────────────────────────────────────
describe('E. _bhRenderOneAttachment — video', () => {
  test('E-01 : élément video créé', () => {
    expect(src).toMatch(/createElement\s*\(\s*['"]video['"]\s*\)/);
  });

  test('E-02 : classe bh-att-video', () => {
    expect(src).toMatch(/bh-att-video/);
  });

  test('E-03 : controls activé', () => {
    expect(src).toMatch(/vid\.controls\s*=\s*true/);
  });

  test('E-04 : playsinline pour mobile', () => {
    expect(src).toMatch(/playsinline/);
  });

  test('E-05 : preload metadata', () => {
    expect(src).toMatch(/preload.*metadata/);
  });

  test('E-06 : élément source avec mime_type', () => {
    expect(src).toMatch(/src\.type\s*=\s*att\.mime_type/);
  });
});

// ── F. Rendu document ────────────────────────────────────────────────────────
describe('F. _bhRenderOneAttachment — document', () => {
  test('F-01 : classe bh-att-doc', () => {
    expect(src).toMatch(/bh-att-doc/);
  });

  test('F-02 : lien Ouvrir avec target _blank', () => {
    expect(src).toMatch(/link\.target\s*=\s*['"]_blank['"]/);
  });

  test('F-03 : rel noopener noreferrer', () => {
    expect(src).toMatch(/noopener noreferrer/);
  });

  test('F-04 : taille en Mo ou Ko', () => {
    expect(src).toMatch(/Mo/);
    expect(src).toMatch(/Ko/);
  });

  test('F-05 : aria-label sur le lien', () => {
    expect(src).toMatch(/setAttribute\s*\(\s*['"]aria-label['"]/);
  });
});

// ── G. État pending ──────────────────────────────────────────────────────────
describe('G. _bhRenderOneAttachment — pending', () => {
  test('G-01 : status pending → classe bh-att-pending', () => {
    expect(src).toMatch(/status\s*===\s*['"]pending['"][\s\S]*bh-att-pending/);
  });

  test('G-02 : data-att-id présent', () => {
    const pendingBlock = src.match(/status\s*===\s*['"]pending['"][\s\S]*?return\s+el;/);
    expect(pendingBlock).toBeTruthy();
    expect(pendingBlock[0]).toMatch(/data-att-id/);
  });

  test('G-03 : data-att-type stocké sur l\'élément pending', () => {
    const pendingBlock = src.match(/status\s*===\s*['"]pending['"][\s\S]*?return\s+el;/);
    expect(pendingBlock).toBeTruthy();
    expect(pendingBlock[0]).toMatch(/data-att-type/);
  });

  test('G-04 : message utilisateur sur l\'élément', () => {
    expect(src).toMatch(/Pièce jointe en cours de récupération/);
  });
});

// ── H. État failed ───────────────────────────────────────────────────────────
describe('H. _bhRenderOneAttachment — failed', () => {
  test('H-01 : status failed → classe bh-att-failed', () => {
    expect(src).toMatch(/status\s*===\s*['"]failed['"][\s\S]*bh-att-failed/);
  });

  test('H-02 : message Pièce jointe indisponible', () => {
    expect(src).toMatch(/Pièce jointe indisponible/);
  });

  test('H-03 : data-att-id présent sur élément failed', () => {
    const failedBlock = src.match(/status\s*===\s*['"]failed['"][\s\S]*?return\s+el;/);
    expect(failedBlock).toBeTruthy();
    expect(failedBlock[0]).toMatch(/data-att-id/);
  });
});

// ── I. Stored sans url ───────────────────────────────────────────────────────
describe('I. Stored sans url → bh-att-failed', () => {
  test('I-01 : !att.url → fallback failed', () => {
    expect(src).toMatch(/!\s*att\.url[\s\S]*bh-att-failed/);
  });
});

// ── J. photo_url legacy ──────────────────────────────────────────────────────
describe('J. _bhRenderAttachments — photo_url legacy', () => {
  test('J-01 : guard atts.length === 0 && photoUrl', () => {
    expect(src).toMatch(/atts\.length\s*===\s*0\s*&&\s*photoUrl/);
  });

  test('J-02 : grille cnt-1 pour image legacy', () => {
    expect(src).toMatch(/bh-attach-grid cnt-1/);
  });

  test('J-03 : lightbox sur click image legacy', () => {
    const legacyBlock = src.match(/atts\.length\s*===\s*0\s*&&\s*photoUrl[\s\S]*?return;/);
    expect(legacyBlock).toBeTruthy();
    expect(legacyBlock[0]).toMatch(/_bhLightboxShow/);
  });
});

// ── K. Grille cnt-1 ──────────────────────────────────────────────────────────
describe('K. _bhRenderAttachments — grille 1 image', () => {
  test('K-01 : cnt-1 pour images.length === 1', () => {
    expect(src).toMatch(/images\.length\s*===\s*1.*cnt-1/);
  });
});

// ── L. Grille cnt-2 ──────────────────────────────────────────────────────────
describe('L. _bhRenderAttachments — grille 2 images', () => {
  test('L-01 : cnt-2 pour images.length === 2', () => {
    expect(src).toMatch(/images\.length\s*===\s*2.*cnt-2/);
  });
});

// ── M. Grille cnt-m ──────────────────────────────────────────────────────────
describe('M. _bhRenderAttachments — grille 3+ images', () => {
  test('M-01 : cnt-m pour 3+ images', () => {
    expect(src).toMatch(/cnt-m/);
  });
});

// ── N. Mix image+doc ─────────────────────────────────────────────────────────
describe('N. _bhRenderAttachments — mix image+doc', () => {
  test('N-01 : séparation images/autres', () => {
    expect(src).toMatch(/images\s*=\s*atts\.filter[\s\S]*type\s*===\s*['"]image['"]/);
  });

  test('N-02 : autres traitées séparément (nonImageAtts)', () => {
    expect(src).toMatch(/nonImageAtts/);
  });

  test('N-03 : chaque element ajouté via _bhRenderOneAttachment', () => {
    expect(src).toMatch(/nonImageAtts\.forEach[\s\S]*_bhRenderOneAttachment/);
  });
});

// ── O. appendMessage intégration ────────────────────────────────────────────
describe('O. appendMessage — appel _bhRenderAttachments', () => {
  test('O-01 : _bhRenderAttachments appelé dans appendMessage', () => {
    const appendBlock = src.match(/function\s+appendMessage[\s\S]*?^}/m);
    expect(appendBlock).toBeTruthy();
    expect(appendBlock[0]).toMatch(/_bhRenderAttachments\s*\(/);
  });

  test('O-02 : passe message.attachments', () => {
    const appendBlock = src.match(/function\s+appendMessage[\s\S]*?^}/m);
    expect(appendBlock[0]).toMatch(/_bhRenderAttachments\s*\([\s\S]*message\.attachments/);
  });

  test('O-03 : passe message.photo_url', () => {
    const appendBlock = src.match(/function\s+appendMessage[\s\S]*?^}/m);
    expect(appendBlock[0]).toMatch(/_bhRenderAttachments\s*\([\s\S]*message\.photo_url/);
  });

  test('O-04 : appel après bubble (après contentDiv)', () => {
    const idx_bubble = src.indexOf("contentDiv.appendChild(bubble)");
    const idx_render = src.indexOf("_bhRenderAttachments(contentDiv, message.attachments");
    expect(idx_bubble).toBeGreaterThan(0);
    expect(idx_render).toBeGreaterThan(idx_bubble);
  });
});

// ── P. Socket attachment_updated ────────────────────────────────────────────
describe('P. Socket attachment_updated', () => {
  test('P-01 : handler socket.on attachment_updated défini', () => {
    expect(src).toMatch(/socket\.on\s*\(\s*['"]attachment_updated['"]/);
  });

  test('P-02 : vérifie la source canonique de la conversation active', () => {
    // FIX-10 : currentConversationId direct remplacé par _getActiveConversationId() (source canonique)
    const block = src.match(/socket\.on\s*\(\s*['"]attachment_updated['"][\s\S]*?\}\s*\)/);
    expect(block).toBeTruthy();
    expect(block[0]).toMatch(/currentConversationId|_getActiveConversationId/);
  });

  test('P-03 : filtre par conversation_id', () => {
    const block = src.match(/socket\.on\s*\(\s*['"]attachment_updated['"][\s\S]*?\}\s*\)/);
    expect(block[0]).toMatch(/data\.conversation_id/);
  });

  test('P-04 : filtre status stored', () => {
    const block = src.match(/socket\.on\s*\(\s*['"]attachment_updated['"][\s\S]*?\}\s*\)/);
    expect(block[0]).toMatch(/data\.status.*stored|stored.*data\.status/);
  });

  test('P-05 : querySelector sur data-att-id', () => {
    const block = src.match(/socket\.on\s*\(\s*['"]attachment_updated['"][\s\S]*?\}\s*\)/);
    expect(block[0]).toMatch(/data-att-id/);
  });

  test('P-06 : replaceChild utilisé pour remplacer l\'élément', () => {
    const block = src.match(/socket\.on\s*\(\s*['"]attachment_updated['"][\s\S]*?\}\s*\)/);
    expect(block[0]).toMatch(/replaceChild/);
  });

  test('P-07 : appelle _bhRenderOneAttachment pour le nouvel élément', () => {
    const block = src.match(/socket\.on\s*\(\s*['"]attachment_updated['"][\s\S]*?\}\s*\)/);
    expect(block[0]).toMatch(/_bhRenderOneAttachment/);
  });

  test('P-08 : lit data-att-type pour reconstruire l\'objet', () => {
    const block = src.match(/socket\.on\s*\(\s*['"]attachment_updated['"][\s\S]*?\}\s*\)/);
    expect(block[0]).toMatch(/data-att-type/);
  });

  test('P-09 : placé après new_platform_message', () => {
    const idx_platform = src.indexOf("socket.on('new_platform_message'");
    const idx_updated  = src.indexOf("socket.on('attachment_updated'");
    expect(idx_platform).toBeGreaterThan(0);
    expect(idx_updated).toBeGreaterThan(idx_platform);
  });
});

// ── Q. filtre conversation_id (statique) ────────────────────────────────────
describe('Q. attachment_updated — filtre conversation_id', () => {
  test('Q-01 : guard early return si conversation différente', () => {
    const block = src.match(/socket\.on\s*\(\s*['"]attachment_updated['"][\s\S]*?\}\s*\)/);
    expect(block[0]).toMatch(/return/);
    // FIX-10 : guard utilise _getActiveConversationId() avec String() pour la comparaison
    expect(block[0]).toMatch(/!currentConversationId|!_activeCid|_getActiveConversationId|conversation_id\s*!==\s*currentConversationId/);
  });
});

// ── R. filtre status != stored ───────────────────────────────────────────────
describe('R. attachment_updated — filtre status != stored', () => {
  test('R-01 : early return si status !== stored ou url absente', () => {
    const block = src.match(/socket\.on\s*\(\s*['"]attachment_updated['"][\s\S]*?\}\s*\)/);
    expect(block[0]).toMatch(/data\.url/);
  });
});

// ── S. XSS safety ───────────────────────────────────────────────────────────
describe('S. XSS — filename via textContent', () => {
  test('S-01 : filename rendu via textContent (jamais innerHTML)', () => {
    expect(src).toMatch(/name\.textContent\s*=\s*att\.filename/);
  });

  test('S-02 : textContent sur l\'élément pending (pas innerHTML)', () => {
    const pendingBlock = src.match(/status\s*===\s*['"]pending['"][\s\S]*?return\s+el;/);
    expect(pendingBlock[0]).toMatch(/el\.textContent/);
    expect(pendingBlock[0]).not.toMatch(/el\.innerHTML/);
  });

  test('S-03 : textContent sur l\'élément failed (pas innerHTML)', () => {
    const failedBlock = src.match(/status\s*===\s*['"]failed['"][\s\S]*?return\s+el;/);
    expect(failedBlock[0]).toMatch(/el\.textContent/);
    expect(failedBlock[0]).not.toMatch(/el\.innerHTML\s*=\s*att/);
  });
});

// ── T. Non-régression displayMessages ───────────────────────────────────────
describe('T. Non-régression displayMessages — filtre media-only', () => {
  test('T-01 : hasAtt vérifie attachments.length > 0', () => {
    expect(src).toMatch(/attachments.*length.*>\s*0/);
  });

  test('T-02 : hasAtt vérifie photo_url comme legacy', () => {
    expect(src).toMatch(/\|\|.*\!\!.*photo_url|\|\|\s*msg\.photo_url/);
  });

  test('T-03 : message sans texte ni pièce jointe filtré', () => {
    expect(src).toMatch(/hasContent/);
  });
});

// ── U. Non-régression photo_url SELECT ──────────────────────────────────────
describe('U. Non-régression photo_url — non supprimée', () => {
  test('U-01 : photo_url reste dans les messages côté JS', () => {
    expect(src).toMatch(/photo_url/);
  });
});

// ── V. Sécurité — source_url absent ─────────────────────────────────────────
describe('V. Sécurité — source_url absent du frontend', () => {
  test('V-01 : source_url jamais utilisé dans chat-owner.js', () => {
    expect(src).not.toMatch(/source_url/);
  });

  test('V-02 : cloudinary_public_id jamais utilisé dans chat-owner.js', () => {
    expect(src).not.toMatch(/cloudinary_public_id/);
  });
});

// ── W. data-att-type sur pending ────────────────────────────────────────────
describe('W. Pending — data-att-type stocké', () => {
  test('W-01 : setAttribute data-att-type dans le bloc pending', () => {
    const pendingBlock = src.match(/status\s*===\s*['"]pending['"][\s\S]*?return\s+el;/);
    expect(pendingBlock).toBeTruthy();
    expect(pendingBlock[0]).toMatch(/setAttribute\s*\(\s*['"]data-att-type['"]/);
  });

  test('W-02 : data-att-mime aussi stocké', () => {
    const pendingBlock = src.match(/status\s*===\s*['"]pending['"][\s\S]*?return\s+el;/);
    expect(pendingBlock[0]).toMatch(/data-att-mime/);
  });

  test('W-03 : data-att-filename aussi stocké', () => {
    const pendingBlock = src.match(/status\s*===\s*['"]pending['"][\s\S]*?return\s+el;/);
    expect(pendingBlock[0]).toMatch(/data-att-filename/);
  });
});
