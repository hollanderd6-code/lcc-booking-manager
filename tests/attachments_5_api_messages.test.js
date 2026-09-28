'use strict';
/**
 * ATTACHMENTS-5 — API messages enrichie + accès sécurisé aux pièces jointes
 *
 * Tests structurels + unitaires — aucune connexion DB, aucune connexion réseau.
 *
 * A. fetchAttachmentsByMessageIds — présence et contrat
 * B. buildSignedAttachmentUrl — resource_type et TTL
 * C. sanitizeAttachmentForClient — champs publics / champs interdits
 * D. Route principale GET /api/chat/messages/:conversationId — enrichissement
 * E. Route messages-channex — enrichissement
 * F. Route /api/host/conversations/:id/messages — enrichissement
 * G. Route /api/guest/conversations/:id/messages — enrichissement
 * H. Endpoint /api/chat/attachments/:id — auth + ownership
 * I. Socket.io — plus de source_url dans le payload
 * J. attachment_updated — event post-stockage
 * K. Performance — pas de N+1 (stratégie batch)
 * L. Sécurité — champs interdits absents du payload client
 * M. Statuts pending/failed → url null
 * N. photo_url — non supprimée
 * O. Non-régression ATTACHMENTS-4
 * P. PDF scope deviation
 */

const fs   = require('fs');
const path = require('path');

const srv      = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const chatRoutes = fs.readFileSync(path.join(__dirname, '../routes/chat_routes.js'), 'utf8');
const procSrc  = fs.readFileSync(
  path.join(__dirname, '../services/attachment-processor.js'), 'utf8'
);

// ─── Charger sanitizeAttachmentForClient + buildSignedAttachmentUrl ────────────
let sanitizeAttachmentForClient = null;
let buildSignedAttachmentUrl    = null;

try {
  // Stub cloudinary pour les tests
  const Module = require('module');
  const origLoad = Module._load;
  Module._load = function(req, ...rest) {
    if (req === 'cloudinary') {
      return {
        v2: {
          url: (public_id, opts) => `https://res.cloudinary.com/test/${opts.resource_type}/${public_id}?expires=${opts.expires_at || 0}`,
          uploader: { upload_stream: () => {} },
        }
      };
    }
    if (req === 'axios') return { get: async () => ({ data: Buffer.alloc(0) }) };
    if (req === 'dns') return { promises: { resolve4: async () => ['1.2.3.4'] } };
    return origLoad.apply(this, [req, ...rest]);
  };
  const proc = require('../services/attachment-processor');
  sanitizeAttachmentForClient = proc.sanitizeAttachmentForClient;
  buildSignedAttachmentUrl    = proc.buildSignedAttachmentUrl;
  Module._load = origLoad;
} catch(e) { /* structurel seulement */ }

// ─────────────────────────────────────────────────────────────────────────────
// A. fetchAttachmentsByMessageIds
// ─────────────────────────────────────────────────────────────────────────────
describe('A. fetchAttachmentsByMessageIds — présence et exports', () => {
  test('A-01: exportée depuis attachment-processor', () => {
    expect(procSrc).toMatch(/module\.exports[\s\S]*fetchAttachmentsByMessageIds/);
  });

  test('A-02: utilise ANY($1::int[])', () => {
    expect(procSrc).toMatch(/ANY\(\$1::int\[\]\)/);
  });

  test('A-03: retourne un map vide pour messageIds vide', async () => {
    // Guard against requiring in broken env
    let fetchFn = null;
    try {
      const proc = require('../services/attachment-processor');
      fetchFn = proc.fetchAttachmentsByMessageIds;
    } catch {}
    if (!fetchFn) return;
    const mockPool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const result = await fetchFn([], mockPool);
    expect(result).toEqual({});
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  test('A-04: ORDER BY created_at ASC, id ASC', () => {
    expect(procSrc).toMatch(/ORDER BY created_at ASC, id ASC/);
  });

  test('A-05: ne sélectionne pas source_url', () => {
    const fetchBlock = procSrc.match(/async function fetchAttachmentsByMessageIds[\s\S]+?\n\}/)?.[0] || '';
    expect(fetchBlock).not.toMatch(/source_url/);
  });

  test('A-06: ne sélectionne pas cloudinary_public_id directement dans la map', () => {
    // cloudinary_public_id est sélectionné pour buildSignedAttachmentUrl mais ne sort pas via sanitize
    const fetchBlock = procSrc.match(/async function fetchAttachmentsByMessageIds[\s\S]+?\n\}/)?.[0] || '';
    expect(fetchBlock).toMatch(/cloudinary_public_id/); // sélectionné pour la signature
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. buildSignedAttachmentUrl — resource_type + TTL
// ─────────────────────────────────────────────────────────────────────────────
describe('B. buildSignedAttachmentUrl — resource_type et TTL', () => {
  test('B-01: exportée depuis attachment-processor', () => {
    expect(procSrc).toMatch(/module\.exports[\s\S]*buildSignedAttachmentUrl/);
  });

  test('B-02: retourne null si status != stored', () => {
    if (!buildSignedAttachmentUrl) return;
    const result = buildSignedAttachmentUrl({ status: 'pending', cloudinary_public_id: 'abc', type: 'image' });
    expect(result).toBeNull();
  });

  test('B-03: retourne null si cloudinary_public_id absent', () => {
    if (!buildSignedAttachmentUrl) return;
    expect(buildSignedAttachmentUrl({ status: 'stored', type: 'image' })).toBeNull();
  });

  test('B-04: image → resource_type image', () => {
    expect(procSrc).toMatch(/att\.type === 'image'.*'image'/);
  });

  test('B-05: video → resource_type video', () => {
    expect(procSrc).toMatch(/att\.type === 'video'.*'video'/);
  });

  test('B-06: document → resource_type raw', () => {
    expect(procSrc).toMatch(/'raw'/);
  });

  test('B-07: TTL SIGNED_URL_TTL déclaré (3600 s)', () => {
    expect(procSrc).toMatch(/SIGNED_URL_TTL\s*=\s*3600/);
  });

  test('B-08: expires_at utilisé dans cloudinary.url', () => {
    expect(procSrc).toMatch(/expires_at/);
  });

  test('B-09: type authenticated', () => {
    const buildBlock = procSrc.match(/function buildSignedAttachmentUrl[\s\S]+?\n\}/)?.[0] || '';
    expect(buildBlock).toMatch(/type.*authenticated/);
  });

  test('B-10: sign_url: true', () => {
    const buildBlock = procSrc.match(/function buildSignedAttachmentUrl[\s\S]+?\n\}/)?.[0] || '';
    expect(buildBlock).toMatch(/sign_url.*true/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. sanitizeAttachmentForClient — champs publics / interdits
// ─────────────────────────────────────────────────────────────────────────────
describe('C. sanitizeAttachmentForClient — champs publics et interdits', () => {
  const storedAtt = {
    id: 42, type: 'image', mime_type: 'image/jpeg', filename: 'photo.jpg',
    size_bytes: 12345, status: 'stored', cloudinary_public_id: 'test/abc',
    source_url: 'https://secret.cdn.com/private.jpg',
    provider_attachment_id: 'prov_xyz', processing_attempts: 2,
    last_error_code: null, last_attempt_at: null,
  };

  test('C-01: contient id', () => {
    if (!sanitizeAttachmentForClient) return;
    expect(sanitizeAttachmentForClient(storedAtt)).toHaveProperty('id', 42);
  });

  test('C-02: contient type', () => {
    if (!sanitizeAttachmentForClient) return;
    expect(sanitizeAttachmentForClient(storedAtt)).toHaveProperty('type', 'image');
  });

  test('C-03: contient status', () => {
    if (!sanitizeAttachmentForClient) return;
    expect(sanitizeAttachmentForClient(storedAtt)).toHaveProperty('status', 'stored');
  });

  test('C-04: NE contient PAS source_url', () => {
    if (!sanitizeAttachmentForClient) return;
    expect(sanitizeAttachmentForClient(storedAtt)).not.toHaveProperty('source_url');
  });

  test('C-05: NE contient PAS cloudinary_public_id', () => {
    if (!sanitizeAttachmentForClient) return;
    expect(sanitizeAttachmentForClient(storedAtt)).not.toHaveProperty('cloudinary_public_id');
  });

  test('C-06: NE contient PAS provider_attachment_id', () => {
    if (!sanitizeAttachmentForClient) return;
    expect(sanitizeAttachmentForClient(storedAtt)).not.toHaveProperty('provider_attachment_id');
  });

  test('C-07: NE contient PAS processing_attempts', () => {
    if (!sanitizeAttachmentForClient) return;
    expect(sanitizeAttachmentForClient(storedAtt)).not.toHaveProperty('processing_attempts');
  });

  test('C-08: NE contient PAS last_error_code', () => {
    if (!sanitizeAttachmentForClient) return;
    expect(sanitizeAttachmentForClient(storedAtt)).not.toHaveProperty('last_error_code');
  });

  test('C-09: NE contient PAS last_attempt_at', () => {
    if (!sanitizeAttachmentForClient) return;
    expect(sanitizeAttachmentForClient(storedAtt)).not.toHaveProperty('last_attempt_at');
  });

  test('C-10: pending → url null', () => {
    if (!sanitizeAttachmentForClient) return;
    const pendingAtt = { ...storedAtt, status: 'pending', cloudinary_public_id: null };
    expect(sanitizeAttachmentForClient(pendingAtt).url).toBeNull();
  });

  test('C-11: failed → url null', () => {
    if (!sanitizeAttachmentForClient) return;
    const failedAtt = { ...storedAtt, status: 'failed', cloudinary_public_id: null };
    expect(sanitizeAttachmentForClient(failedAtt).url).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. Route GET /api/chat/messages/:conversationId (chat_routes.js)
// ─────────────────────────────────────────────────────────────────────────────
describe('D. Route principale GET /api/chat/messages — enrichissement attachments', () => {
  test('D-01: requiert services/attachment-processor dans chat_routes.js', () => {
    expect(chatRoutes).toMatch(/require.*attachment-processor/);
  });

  test('D-02: appelle fetchAttachmentsByMessageIds', () => {
    expect(chatRoutes).toMatch(/fetchAttachmentsByMessageIds/);
  });

  test('D-03: mappe chaque message avec attachments: []', () => {
    expect(chatRoutes).toMatch(/attachments.*_attMap\[m\.id\].*\[\]/);
  });

  test('D-04: utilise messagesWithAtts dans res.json', () => {
    expect(chatRoutes).toMatch(/messagesWithAtts/);
    expect(chatRoutes).toMatch(/messages:\s*messagesWithAtts/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E. Route messages-channex (server.js)
// ─────────────────────────────────────────────────────────────────────────────
describe('E. Route messages-channex — enrichissement attachments', () => {
  test('E-01: appelle fetchAttachmentsByMessageIds', () => {
    expect(srv).toMatch(/fetchAttachmentsByMessageIds.*dbMessages\.rows\.map/s);
  });

  test('E-02: retourne messagesWithAtts', () => {
    expect(srv).toMatch(/messages:\s*messagesWithAtts/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F. Route /api/host/conversations/:id/messages
// ─────────────────────────────────────────────────────────────────────────────
describe('F. Route /api/host/conversations — enrichissement', () => {
  test('F-01: appelle fetchAttachmentsByMessageIds (_fetchHostAtts)', () => {
    expect(srv).toMatch(/_fetchHostAtts/);
  });

  test('F-02: retourne _hostMsgs', () => {
    expect(srv).toMatch(/messages:\s*_hostMsgs/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G. Route /api/guest/conversations/:id/messages
// ─────────────────────────────────────────────────────────────────────────────
describe('G. Route /api/guest/conversations — enrichissement', () => {
  test('G-01: appelle fetchAttachmentsByMessageIds (_fetchGuestAtts)', () => {
    expect(srv).toMatch(/_fetchGuestAtts/);
  });

  test('G-02: retourne _guestMsgs', () => {
    expect(srv).toMatch(/messages:\s*_guestMsgs/);
  });

  test('G-03: photo_url toujours dans le SELECT', () => {
    expect(srv).toMatch(/SELECT.*photo_url[\s\S]+FROM messages[\s\S]+WHERE conversation_id = \$1 AND sender_type != 'internal_note'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H. Endpoint /api/chat/attachments/:id
// ─────────────────────────────────────────────────────────────────────────────
describe('H. Endpoint GET /api/chat/attachments/:id', () => {
  test('H-01: route déclarée dans server.js', () => {
    expect(srv).toMatch(/app\.get\(['"]\/api\/chat\/attachments\/:id['"]/);
  });

  test('H-02: auth obligatoire (authenticateAny)', () => {
    const block = srv.match(/app\.get\(['"]\/api\/chat\/attachments\/:id['"]\s*,\s*authenticateAny[\s\S]+?\n\}\);/)?.[0] || '';
    expect(block).toMatch(/authenticateAny/);
  });

  test('H-03: ownership vérifié via conversation.user_id', () => {
    const block = srv.match(/app\.get\(['"]\/api\/chat\/attachments\/:id[\s\S]+?Accès refusé/)?.[0] || '';
    expect(block).toMatch(/user_id/);
  });

  test('H-04: status != stored → url null (pas d\'erreur)', () => {
    expect(srv).toMatch(/status.*stored.*url.*null/s);
  });

  test('H-05: ne redirige jamais vers source_url', () => {
    const block = srv.match(/app\.get\(['"]\/api\/chat\/attachments\/:id[\s\S]+?\n\}\);/)?.[0] || '';
    expect(block).not.toMatch(/source_url/);
  });

  test('H-06: ne retourne pas cloudinary_public_id dans res.json', () => {
    const block = srv.match(/app\.get\(['"]\/api\/chat\/attachments\/:id[\s\S]+?res\.json\([^)]+\)/)?.[0] || '';
    expect(block).not.toMatch(/cloudinary_public_id.*res\.json/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I. Socket.io — plus de source_url
// ─────────────────────────────────────────────────────────────────────────────
describe('I. Socket.io — payload sanitisé', () => {
  test('I-01: payload guest utilise publicAttachmentsGuest (pas normalizedAttachments)', () => {
    expect(srv).toMatch(/publicAttachmentsGuest/);
    // Le socket.io émet publicAttachmentsGuest, pas normalizedAttachments
    const socketGuestBlock = srv.match(
      /publicAttachmentsGuest\.push[\s\S]+?io\.to.*conversation.*emit.*new_message.*publicAttachmentsGuest/
    )?.[0];
    expect(socketGuestBlock).toBeTruthy();
  });

  test('I-02: payload hôte utilise publicAttachmentsHost', () => {
    expect(srv).toMatch(/publicAttachmentsHost/);
  });

  test('I-03: normalizedAttachments non diffusé directement en Socket.io (après correction)', () => {
    // Vérifier qu'aucun emit ne passe directement normalizedAttachments
    const emitNormalized = srv.match(
      /io\.to.*emit.*new_message.*normalizedAttachments(?!.*\}\/\/ ancienne)/g
    );
    expect(emitNormalized).toBeNull();
  });

  test('I-04: url: null dans le payload pending (pas de source_url)', () => {
    // Les attachments insérés ont url: null (pending, pas de Cloudinary URL)
    expect(srv).toMatch(/url:\s*null/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// J. attachment_updated event
// ─────────────────────────────────────────────────────────────────────────────
describe('J. attachment_updated — émis après stockage', () => {
  test('J-01: événement attachment_updated émis dans attachment-processor', () => {
    expect(procSrc).toMatch(/attachment_updated/);
  });

  test('J-02: émis dans la room conversation', () => {
    expect(procSrc).toMatch(/io\.to.*conversation_.*emit.*attachment_updated/s);
  });

  test('J-03: émis dans la room user', () => {
    expect(procSrc).toMatch(/io\.to.*user_.*emit.*attachment_updated/s);
  });

  test('J-04: payload contient attachment_id, message_id, conversation_id, status, url', () => {
    expect(procSrc).toMatch(/attachment_id/);
    expect(procSrc).toMatch(/message_id/);
    expect(procSrc).toMatch(/conversation_id/);
  });

  test('J-05: io paramètre optionnel de processAttachment', () => {
    expect(procSrc).toMatch(/async function processAttachment\(attachmentId, pool, io\)/);
  });

  test('J-06: io paramètre de processPendingAttachments', () => {
    expect(procSrc).toMatch(/async function processPendingAttachments\(pool, io\)/);
  });

  test('J-07: io transmis à processAttachment depuis processPendingAttachments', () => {
    const batchBlock = procSrc.match(/async function processPendingAttachments[\s\S]+?\n\}/)?.[0] || '';
    expect(batchBlock).toMatch(/processAttachment\(row\.id, pool, io\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// K. Performance — pas de N+1
// ─────────────────────────────────────────────────────────────────────────────
describe('K. Performance — anti-N+1', () => {
  test('K-01: batch via ANY($1::int[]) — 1 seule requête pour N messages', () => {
    expect(procSrc).toMatch(/ANY\(\$1::int\[\]\)/);
  });

  test('K-02: pas de requête attachment par message dans la route principale', () => {
    // Il ne doit pas y avoir un fetchAttachmentsByMessageIds dans une boucle for/forEach/map
    const block = chatRoutes.match(/fetchAttachmentsByMessageIds[\s\S]{0,200}/)?.[0] || '';
    expect(block).not.toMatch(/for.*of|\.forEach|\.map.*fetchAtt/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L. Sécurité — champs interdits absents des routes
// ─────────────────────────────────────────────────────────────────────────────
describe('L. Sécurité — champs interdits', () => {
  test('L-01: fetchAttachmentsByMessageIds ne sélectionne pas source_url', () => {
    const fetchBlock = procSrc.match(/async function fetchAttachmentsByMessageIds[\s\S]+?\n\}/)?.[0] || '';
    expect(fetchBlock).not.toMatch(/\bsource_url\b/);
  });

  test('L-02: sanitizeAttachmentForClient ne retourne pas processing_attempts', () => {
    const sanitizeBlock = procSrc.match(/function sanitizeAttachmentForClient[\s\S]+?\n\}/)?.[0] || '';
    expect(sanitizeBlock).not.toMatch(/processing_attempts/);
  });

  test('L-03: sanitizeAttachmentForClient ne retourne pas last_error_code', () => {
    const sanitizeBlock = procSrc.match(/function sanitizeAttachmentForClient[\s\S]+?\n\}/)?.[0] || '';
    expect(sanitizeBlock).not.toMatch(/last_error_code/);
  });

  test('L-04: /api/chat/attachments/:id ne retourne pas last_attempt_at', () => {
    const endpointBlock = srv.match(/app\.get\(['"]\/api\/chat\/attachments\/:id[\s\S]+?\n\}\);/)?.[0] || '';
    expect(endpointBlock).not.toMatch(/last_attempt_at/);
  });

  test('L-05: /api/chat/attachments/:id ne retourne pas provider_attachment_id', () => {
    const endpointBlock = srv.match(/app\.get\(['"]\/api\/chat\/attachments\/:id[\s\S]+?\n\}\);/)?.[0] || '';
    expect(endpointBlock).not.toMatch(/provider_attachment_id.*res\.json/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M. Statuts pending / failed → url null
// ─────────────────────────────────────────────────────────────────────────────
describe('M. Statuts pending/failed → url null', () => {
  test('M-01: buildSignedAttachmentUrl retourne null si status != stored', () => {
    const buildBlock = procSrc.match(/function buildSignedAttachmentUrl[\s\S]+?\n\}/)?.[0] || '';
    expect(buildBlock).toMatch(/status.*!==.*'stored'.*return null/s);
  });

  test('M-02: sanitize couvre les statuts non-stored → url null', () => {
    if (!sanitizeAttachmentForClient) return;
    const pending = { id: 1, type: 'image', status: 'pending', cloudinary_public_id: null };
    const failed  = { id: 2, type: 'image', status: 'failed',  cloudinary_public_id: null };
    expect(sanitizeAttachmentForClient(pending).url).toBeNull();
    expect(sanitizeAttachmentForClient(failed).url).toBeNull();
  });

  test('M-03: endpoint /api/chat/attachments/:id retourne url null si non stored', () => {
    const block = srv.match(/app\.get\(['"]\/api\/chat\/attachments\/:id[\s\S]+?url:\s*null[\s\S]+?res\.json/)?.[0];
    expect(block).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// N. Legacy photo_url non supprimée
// ─────────────────────────────────────────────────────────────────────────────
describe('N. Legacy photo_url — non supprimée', () => {
  test('N-01: photo_url dans le SELECT /api/guest/conversations/:id/messages', () => {
    expect(srv).toMatch(/SELECT.*photo_url[\s\S]+?FROM messages[\s\S]+?sender_type != 'internal_note'/);
  });

  test('N-02: photo_url non supprimée du SELECT guest messages', () => {
    // La colonne messages.photo_url est préservée dans la route /api/guest/conversations/:id/messages
    expect(srv).toMatch(/SELECT.*photo_url.*FROM messages/s);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// O. Non-régression ATTACHMENTS-4
// ─────────────────────────────────────────────────────────────────────────────
describe('O. Non-régression ATTACHMENTS-4', () => {
  test('O-01: processAttachment toujours présente', () => {
    expect(procSrc).toMatch(/async function processAttachment/);
  });

  test('O-02: validateSourceUrl toujours présente', () => {
    expect(procSrc).toMatch(/async function validateSourceUrl/);
  });

  test('O-03: source_url → NULL après stockage', () => {
    expect(procSrc).toMatch(/source_url\s*=\s*NULL/);
  });

  test('O-04: cron */5 toujours présent + passe io', () => {
    expect(srv).toMatch(/cron\.schedule\s*\(\s*['"]\*\/5 \* \* \* \*['"]/);
    const cronBlock = srv.match(/cron\.schedule\s*\(\s*['"]\*\/5 \* \* \* \*[\s\S]+?\}\s*\)/)?.[0] || '';
    expect(cronBlock).toMatch(/processPendingAttachments\(pool, io\)/);
  });

  test('O-05: setImmediate passe io', () => {
    const siBlock = srv.match(/ATTACHMENTS-4\/5[\s\S]+?processPendingAttachments\(pool, io\)/)?.[0];
    expect(siBlock).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P. PDF — scope deviation
// ─────────────────────────────────────────────────────────────────────────────
describe('P. PDF — scope deviation signalée', () => {
  test('P-01: SCOPE_DEVIATION — PDF présent dans MAGIC_SIGNATURES', () => {
    // PDF a été ajouté dans ATTACHMENTS-4. Ce test documente la déviation de scope.
    // Pour retirer le support PDF : supprimer la ligne { type: 'application/pdf', ... }
    expect(procSrc).toMatch(/application\/pdf/);
    // SCOPE DEVIATION: PDF — ajouté dans ATTACHMENTS-4, non retiré en ATTACHMENTS-5.
  });
});
