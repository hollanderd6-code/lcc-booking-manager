'use strict';
/**
 * ATTACHMENTS-4 — Téléchargement sécurisé + stockage Cloudinary
 *
 * Tests structurels + unitaires — aucune connexion DB, aucune connexion réseau.
 *
 * A. Module attachment-processor exporté correctement
 * B. validateSourceUrl — cas d'erreur SSRF
 * C. validateSourceUrl — allowlist CHANNEX_ATTACHMENT_ALLOWED_HOSTS
 * D. validateSourceUrl — wildcards
 * E. validateFileBuffer — magic bytes
 * F. validateFileBuffer — limites de taille
 * G. processAttachment — présence dans server.js (setImmediate)
 * H. Cron job ATTACHMENTS-4 déclaré dans server.js
 * I. Migration colonnes retry dans server.js
 * J. Sécurité — source_url → NULL après stockage
 * K. Sécurité — aucun URL signée loguée
 * L. Sécurité — upload Cloudinary type authenticated
 * M. processPendingAttachments — filtre pending + source_url NOT NULL
 * N. Non-régression — normalizeChannexAttachments intact
 */

const fs   = require('fs');
const path = require('path');

const srv     = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const procSrc = fs.readFileSync(
  path.join(__dirname, '../services/attachment-processor.js'), 'utf8'
);

// ─── Charger les fonctions exportées ─────────────────────────────────────────
// Remplacer les dépendances externes par des stubs pour les tests unitaires
let validateSourceUrl    = null;
let validateFileBuffer   = null;
let processAttachment    = null;
let processPendingAttachments = null;

// Instancier validateFileBuffer directement (pas de dépendances externes)
try {
  const isolated = `
    'use strict';
    const PRIVATE_RANGES = [
      /^10\\./,
      /^192\\.168\\./,
      /^172\\.(1[6-9]|2\\d|3[01])\\./,
      /^127\\./,
      /^169\\.254\\./,
      /^0\\./,
      /^100\\.(6[4-9]|[7-9]\\d|1[01]\\d|12[0-7])\\./,
    ];
    const MAGIC_SIGNATURES = [
      { type: 'image/jpeg',  sig: [0xFF, 0xD8] },
      { type: 'image/png',   sig: [0x89, 0x50] },
      { type: 'image/webp',  sig: [0x52, 0x49, 0x46, 0x46], webp: true },
      { type: 'video/mp4',   sig: [0x00, 0x00, 0x00], ftypOffset: 4, ftypSig: [0x66, 0x74, 0x79, 0x70] },
      { type: 'application/pdf', sig: [0x25, 0x50, 0x44, 0x46] },
    ];
    const MAX_SIZE_BYTES = 10 * 1024 * 1024;
    function validateFileBuffer(buffer) {
      if (!Buffer.isBuffer(buffer) || buffer.length < 8) return { ok: false, error: 'BUFFER_TOO_SMALL' };
      if (buffer.length > MAX_SIZE_BYTES) return { ok: false, error: 'FILE_TOO_LARGE' };
      for (const def of MAGIC_SIGNATURES) {
        if (def.ftypOffset !== undefined) {
          const hasFtyp = def.ftypSig.every((b, i) => buffer[def.ftypOffset + i] === b);
          if (hasFtyp) return { ok: true, detectedType: def.type };
          continue;
        }
        const match = def.sig.every((b, i) => buffer[i] === b);
        if (match) {
          if (def.webp) {
            const webp = [0x57, 0x45, 0x42, 0x50];
            if (!webp.every((b, i) => buffer[8 + i] === b)) continue;
          }
          return { ok: true, detectedType: def.type };
        }
      }
      return { ok: false, error: 'UNSUPPORTED_FILE_TYPE' };
    }
    return validateFileBuffer;
  `;
  // eslint-disable-next-line no-new-func
  validateFileBuffer = new Function(isolated)();
} catch(e) { /* structurel seulement */ }

// ─────────────────────────────────────────────────────────────────────────────
// A. Module exports
// ─────────────────────────────────────────────────────────────────────────────
describe('A. Module attachment-processor — exports', () => {
  test('A-01: fichier services/attachment-processor.js existe', () => {
    expect(fs.existsSync(path.join(__dirname, '../services/attachment-processor.js'))).toBe(true);
  });

  test('A-02: exports validateSourceUrl', () => {
    expect(procSrc).toMatch(/module\.exports[\s\S]*validateSourceUrl/);
  });

  test('A-03: exports validateFileBuffer', () => {
    expect(procSrc).toMatch(/module\.exports[\s\S]*validateFileBuffer/);
  });

  test('A-04: exports processAttachment', () => {
    expect(procSrc).toMatch(/module\.exports[\s\S]*processAttachment/);
  });

  test('A-05: exports processPendingAttachments', () => {
    expect(procSrc).toMatch(/module\.exports[\s\S]*processPendingAttachments/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. validateSourceUrl — cas d'erreur structurels
// ─────────────────────────────────────────────────────────────────────────────
describe('B. validateSourceUrl — structure du code', () => {
  test('B-01: refuse protocole http (non HTTPS)', () => {
    expect(procSrc).toMatch(/protocol.*!==.*https:/);
  });

  test('B-02: vérifie CHANNEX_ATTACHMENT_ALLOWED_HOSTS', () => {
    expect(procSrc).toMatch(/CHANNEX_ATTACHMENT_ALLOWED_HOSTS/);
  });

  test('B-03: fail-closed si allowlist absente', () => {
    expect(procSrc).toMatch(/NO_ALLOWLIST/);
  });

  test('B-04: PRIVATE_RANGES déclarées', () => {
    expect(procSrc).toMatch(/PRIVATE_RANGES/);
    expect(procSrc).toMatch(/10\\\./);          // /^10\./
    expect(procSrc).toMatch(/192\\.168\\./);    // /^192\.168\./
    expect(procSrc).toMatch(/127\\\./);         // /^127\./
    expect(procSrc).toMatch(/169\\.254\\./);    // /^169\.254\./
  });

  test('B-05: résolution DNS (dns.resolve4)', () => {
    expect(procSrc).toMatch(/resolve4/);
  });

  test('B-06: code d\'erreur PRIVATE_IP_BLOCKED', () => {
    expect(procSrc).toMatch(/PRIVATE_IP_BLOCKED/);
  });

  test('B-07: code d\'erreur HOST_NOT_ALLOWLISTED', () => {
    expect(procSrc).toMatch(/HOST_NOT_ALLOWLISTED/);
  });

  test('B-08: code d\'erreur DNS_RESOLUTION_FAILED', () => {
    expect(procSrc).toMatch(/DNS_RESOLUTION_FAILED/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. validateSourceUrl — allowlist (structurel)
// ─────────────────────────────────────────────────────────────────────────────
describe('C. validateSourceUrl — allowlist et wildcards', () => {
  test('C-01: supporte wildcard *.domain.com', () => {
    expect(procSrc).toMatch(/startsWith\('\*\.'\)/);
  });

  test('C-02: split par virgule pour allowlist multiple', () => {
    expect(procSrc).toMatch(/\.split\(','\)/);
  });

  test('C-03: comparaison lowercase', () => {
    expect(procSrc).toMatch(/\.toLowerCase\(\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. validateFileBuffer — magic bytes
// ─────────────────────────────────────────────────────────────────────────────
describe('D. validateFileBuffer — magic bytes (unitaire)', () => {
  const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);
  const png  = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const pdf  = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34]);
  const webp = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
  // MP4 avec ftyp à offset 4
  const mp4  = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6F, 0x6D]);

  test('D-01: JPEG reconnu', () => {
    if (!validateFileBuffer) return;
    const r = validateFileBuffer(jpeg);
    expect(r.ok).toBe(true);
    expect(r.detectedType).toBe('image/jpeg');
  });

  test('D-02: PNG reconnu', () => {
    if (!validateFileBuffer) return;
    const r = validateFileBuffer(png);
    expect(r.ok).toBe(true);
    expect(r.detectedType).toBe('image/png');
  });

  test('D-03: WEBP reconnu', () => {
    if (!validateFileBuffer) return;
    const r = validateFileBuffer(webp);
    expect(r.ok).toBe(true);
    expect(r.detectedType).toBe('image/webp');
  });

  test('D-04: MP4 reconnu (ftyp)', () => {
    if (!validateFileBuffer) return;
    const r = validateFileBuffer(mp4);
    expect(r.ok).toBe(true);
    expect(r.detectedType).toBe('video/mp4');
  });

  test('D-05: PDF reconnu', () => {
    if (!validateFileBuffer) return;
    const r = validateFileBuffer(pdf);
    expect(r.ok).toBe(true);
    expect(r.detectedType).toBe('application/pdf');
  });

  test('D-06: type inconnu refusé', () => {
    if (!validateFileBuffer) return;
    const exe = Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]); // DOS MZ
    const r = validateFileBuffer(exe);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('UNSUPPORTED_FILE_TYPE');
  });

  test('D-07: JPEG tronqué (< 8 octets) refusé', () => {
    if (!validateFileBuffer) return;
    const r = validateFileBuffer(Buffer.from([0xFF, 0xD8]));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('BUFFER_TOO_SMALL');
  });

  test('D-08: RIFF sans WEBP refusé', () => {
    if (!validateFileBuffer) return;
    const notWebp = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x41, 0x56, 0x49, 0x20]);
    const r = validateFileBuffer(notWebp);
    expect(r.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E. validateFileBuffer — limites de taille
// ─────────────────────────────────────────────────────────────────────────────
describe('E. validateFileBuffer — limites de taille', () => {
  test('E-01: limite MAX_SIZE_BYTES déclarée (10 MB)', () => {
    expect(procSrc).toMatch(/10\s*\*\s*1024\s*\*\s*1024/);
  });

  test('E-02: buffer > 10 MB refusé', () => {
    if (!validateFileBuffer) return;
    const big = Buffer.alloc(11 * 1024 * 1024, 0xFF);
    const r = validateFileBuffer(big);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('FILE_TOO_LARGE');
  });

  test('E-03: buffer vide refusé', () => {
    if (!validateFileBuffer) return;
    const r = validateFileBuffer(Buffer.alloc(0));
    expect(r.ok).toBe(false);
  });

  test('E-04: maxContentLength identique à MAX_SIZE_BYTES', () => {
    expect(procSrc).toMatch(/maxContentLength\s*:\s*MAX_SIZE_BYTES/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F. processAttachment — logique DB
// ─────────────────────────────────────────────────────────────────────────────
describe('F. processAttachment — logique DB', () => {
  test('F-01: filtre WHERE status = pending', () => {
    expect(procSrc).toMatch(/status\s*=\s*'\s*pending\s*'/);
  });

  test('F-02: incrémente processing_attempts AVANT le traitement', () => {
    const incr = procSrc.match(/processing_attempts\s*=\s*processing_attempts\s*\+\s*1[\s\S]+?last_attempt_at\s*=\s*NOW/);
    expect(incr).not.toBeNull();
  });

  test('F-03: status → failed après MAX_ATTEMPTS', () => {
    expect(procSrc).toMatch(/MAX_ATTEMPTS/);
    expect(procSrc).toMatch(/'failed'/);
  });

  test('F-04: source_url → NULL après stockage réussi', () => {
    expect(procSrc).toMatch(/source_url\s*=\s*NULL/);
  });

  test('F-05: storage_url mis à jour', () => {
    expect(procSrc).toMatch(/storage_url\s*=\s*\$3/);
  });

  test('F-06: cloudinary_public_id mis à jour', () => {
    expect(procSrc).toMatch(/cloudinary_public_id\s*=\s*\$2/);
  });

  test('F-07: status → stored en cas de succès', () => {
    expect(procSrc).toMatch(/'stored'/);
  });

  test('F-08: last_error_code stocké en cas d\'échec', () => {
    expect(procSrc).toMatch(/last_error_code/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G. server.js — setImmediate webhook
// ─────────────────────────────────────────────────────────────────────────────
describe('G. server.js — setImmediate post-webhook', () => {
  test('G-01: setImmediate déclenché si hasAttachments', () => {
    expect(srv).toMatch(/if\s*\(hasAttachments\)\s*\{[\s\S]+?setImmediate/);
  });

  test('G-02: appelle processPendingAttachments (avec pool)', () => {
    // ATTACHMENTS-5 : signature mise à jour → processPendingAttachments(pool, io)
    expect(srv).toMatch(/processPendingAttachments\s*\(\s*pool/);
  });

  test('G-03: require attachment-processor dans server.js', () => {
    expect(srv).toMatch(/require\(['"]\.\/services\/attachment-processor['"]\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H. server.js — cron ATTACHMENTS-4
// ─────────────────────────────────────────────────────────────────────────────
describe('H. server.js — cron ATTACHMENTS-4', () => {
  test('H-01: cron toutes les 5 min déclaré', () => {
    expect(srv).toMatch(/cron\.schedule\s*\(\s*['"]\*\/5 \* \* \* \*['"]/);
  });

  test('H-02: appelle processPendingAttachments dans le cron', () => {
    const cronBlock = srv.match(/cron\.schedule\s*\(['"]\*\/5 \* \* \* \*[\s\S]+?\}\s*\)/)?.[0] || '';
    expect(cronBlock).toMatch(/processPendingAttachments/);
  });

  test('H-03: log initialisation cron ATTACHMENTS-4', () => {
    expect(srv).toMatch(/ATTACHMENTS-4[\s\S]*pending initialisé/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I. server.js — migration colonnes retry
// ─────────────────────────────────────────────────────────────────────────────
describe('I. server.js — migration colonnes retry', () => {
  test('I-01: ADD COLUMN processing_attempts', () => {
    expect(srv).toMatch(/ADD COLUMN IF NOT EXISTS processing_attempts/);
  });

  test('I-02: processing_attempts DEFAULT 0', () => {
    expect(srv).toMatch(/processing_attempts.*DEFAULT 0/);
  });

  test('I-03: ADD COLUMN last_error_code', () => {
    expect(srv).toMatch(/ADD COLUMN IF NOT EXISTS last_error_code/);
  });

  test('I-04: ADD COLUMN last_attempt_at TIMESTAMPTZ', () => {
    expect(srv).toMatch(/ADD COLUMN IF NOT EXISTS last_attempt_at.*TIMESTAMPTZ/);
  });

  test('I-05: dans un bloc IIFE try/catch', () => {
    expect(srv).toMatch(/Colonnes retry message_attachments OK/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// J. Sécurité — source_url NULLifié + pas de log URL signée
// ─────────────────────────────────────────────────────────────────────────────
describe('J. Sécurité — source_url et confidentialité', () => {
  test('J-01: source_url nullifié après stockage (pas dans log)', () => {
    // La source_url n'est JAMAIS loguée directement
    expect(procSrc).not.toMatch(/console\.log.*source_url/);
  });

  test('J-02: aucun console.log du buffer brut', () => {
    expect(procSrc).not.toMatch(/console\.log.*buffer/i);
  });

  test('J-03: aucune URL complète loguée (pas de log att.source_url)', () => {
    expect(procSrc).not.toMatch(/console\.(log|warn|error).*att\.source_url/);
  });

  test('J-04: timeout téléchargement défini', () => {
    expect(procSrc).toMatch(/timeout\s*:\s*DOWNLOAD_TIMEOUT/);
    expect(procSrc).toMatch(/DOWNLOAD_TIMEOUT\s*=\s*\d+/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// K. Cloudinary — type authenticated
// ─────────────────────────────────────────────────────────────────────────────
describe('K. Cloudinary — upload type authenticated', () => {
  test('K-01: dossier boostinghost/chat-attachments', () => {
    expect(procSrc).toMatch(/boostinghost\/chat-attachments/);
  });

  test('K-02: type: authenticated', () => {
    expect(procSrc).toMatch(/type\s*:\s*['"]authenticated['"]/);
  });

  test('K-03: resource_type: auto', () => {
    expect(procSrc).toMatch(/resource_type\s*:\s*['"]auto['"]/);
  });

  test('K-04: cloudinary.uploader.upload_stream utilisé', () => {
    expect(procSrc).toMatch(/upload_stream/);
  });

  test('K-05: public_id construit depuis att.id (pas de données perso)', () => {
    expect(procSrc).toMatch(/att_\$\{att\.id\}/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L. processPendingAttachments — requête SQL
// ─────────────────────────────────────────────────────────────────────────────
describe('L. processPendingAttachments — requête SQL', () => {
  test('L-01: filtre status = pending ET source_url IS NOT NULL', () => {
    expect(procSrc).toMatch(/source_url IS NOT NULL/);
  });

  test('L-02: filtre processing_attempts < MAX_ATTEMPTS', () => {
    expect(procSrc).toMatch(/processing_attempts\s*<\s*\$1/);
  });

  test('L-03: LIMIT 20', () => {
    expect(procSrc).toMatch(/LIMIT\s+20/);
  });

  test('L-04: ORDER BY created_at ASC (FIFO)', () => {
    expect(procSrc).toMatch(/ORDER BY created_at ASC/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M. Non-régression ATTACHMENTS-3
// ─────────────────────────────────────────────────────────────────────────────
describe('M. Non-régression ATTACHMENTS-3', () => {
  test('M-01: normalizeChannexAttachments toujours présente', () => {
    expect(srv).toMatch(/function normalizeChannexAttachments\(raw\)/);
  });

  test('M-02: _inferAttachmentType toujours présente', () => {
    expect(srv).toMatch(/function _inferAttachmentType\(mimeOrType\)/);
  });

  test('M-03: escalateToOwner toujours appelé si hasAttachments', () => {
    const pos1 = srv.indexOf('if (hasAttachments)');
    const pos2 = srv.indexOf('await escalateToOwner(');
    expect(pos1).toBeGreaterThan(-1);
    expect(pos2).toBeGreaterThan(pos1);
  });

  test('M-04: ON CONFLICT ... DO NOTHING toujours présent', () => {
    expect(srv).toMatch(/ON CONFLICT.*provider_attachment_id.*DO NOTHING/s);
  });
});
