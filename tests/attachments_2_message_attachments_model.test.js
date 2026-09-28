'use strict';
/**
 * ATTACHMENTS-2 — message_attachments schema
 *
 * Tests structurels : vérifient la présence et les propriétés du SQL dans
 * server.js sans connexion DB en live.
 *
 * A. Table créée dans une IIFE try/catch (idempotente au démarrage)
 * B. Colonnes NOT NULL garanties
 * C. Colonnes nullable (valeurs inconnues à la réception Channex)
 * D. Clé étrangère messages(id) ON DELETE CASCADE
 * E. conversation_id dénormalisé (pas de FK — cohérent avec le projet)
 * F. CHECK constraints direction / status / type
 * G. Pas de type BIGSERIAL ou BIGINT : cohérence avec SERIAL du projet
 * H. Index : message_id, conversation_id, provider_attachment_id (partiel)
 * I. Déduplication : index partiel WHERE provider_attachment_id IS NOT NULL
 * J. Cloudinary public_id (référence stable, pas d'URL signée stockée)
 * K. Pas de binaire (base64, BYTEA, BLOB)
 * L. messages.photo_url intact (pas supprimée ni modifiée)
 * M. Aucune modification des tables/routes existantes
 * N. Non-régression : pas de changement sur les INSERT/SELECT messages existants
 */

const fs   = require('fs');
const path = require('path');

const srv      = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const chatRoutes = fs.readFileSync(path.join(__dirname, '../routes/chat_routes.js'), 'utf8');

// ─── Bloc de migration isolé ──────────────────────────────────────────────────
const migrationBlock = srv.match(
  /ATTACHMENTS-2[^\n]*\n\(async \(\)[\s\S]+?console\.log\(['"]✅ Table message_attachments OK['"]\)[\s\S]+?\}\)\(\);/
)?.[0] || '';

const createTableBlock = migrationBlock.match(
  /CREATE TABLE IF NOT EXISTS message_attachments\s*\([\s\S]+?\n\s{6}\)/
)?.[0] || '';

// ─────────────────────────────────────────────────────────────────────────────
// A. Présence et structure de la migration
// ─────────────────────────────────────────────────────────────────────────────
describe('A. ATTACHMENTS-2 — IIFE migration présente', () => {
  test('A-01: bloc de migration trouvé dans server.js', () => {
    expect(migrationBlock.length).toBeGreaterThan(200);
  });

  test('A-02: migration dans une IIFE async avec try/catch', () => {
    expect(migrationBlock).toMatch(/\(async \(\) =>/);
    expect(migrationBlock).toMatch(/} catch \(e\)/);
    expect(migrationBlock).toMatch(/console\.error\(['"]❌ Migration message_attachments:/);
  });

  test('A-03: utilise CREATE TABLE IF NOT EXISTS (idempotent)', () => {
    expect(migrationBlock).toMatch(/CREATE TABLE IF NOT EXISTS message_attachments/);
  });

  test('A-04: log de succès présent', () => {
    expect(migrationBlock).toMatch(/console\.log\(['"]✅ Table message_attachments OK['"]\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. Colonnes NOT NULL obligatoires
// ─────────────────────────────────────────────────────────────────────────────
describe('B. Colonnes NOT NULL garanties', () => {
  test('B-01: id SERIAL PRIMARY KEY', () => {
    expect(createTableBlock).toMatch(/id\s+SERIAL\s+PRIMARY KEY/);
  });

  test('B-02: message_id NOT NULL', () => {
    expect(createTableBlock).toMatch(/message_id\s+INTEGER\s+NOT NULL/);
  });

  test('B-03: conversation_id NOT NULL', () => {
    expect(createTableBlock).toMatch(/conversation_id\s+INTEGER\s+NOT NULL/);
  });

  test('B-04: type NOT NULL avec DEFAULT', () => {
    expect(createTableBlock).toMatch(/type\s+TEXT\s+NOT NULL/);
    expect(createTableBlock).toMatch(/type\s+TEXT\s+NOT NULL\s+DEFAULT\s+['"]image['"]/);
  });

  test('B-05: direction NOT NULL avec DEFAULT inbound', () => {
    expect(createTableBlock).toMatch(/direction\s+TEXT\s+NOT NULL/);
    expect(createTableBlock).toMatch(/direction\s+TEXT\s+NOT NULL\s+DEFAULT\s+['"]inbound['"]/);
  });

  test('B-06: status NOT NULL avec DEFAULT pending', () => {
    expect(createTableBlock).toMatch(/status\s+TEXT\s+NOT NULL/);
    expect(createTableBlock).toMatch(/status\s+TEXT\s+NOT NULL\s+DEFAULT\s+['"]pending['"]/);
  });

  test('B-07: created_at TIMESTAMPTZ NOT NULL', () => {
    expect(createTableBlock).toMatch(/created_at\s+TIMESTAMPTZ\s+NOT NULL/);
  });

  test('B-08: updated_at TIMESTAMPTZ NOT NULL', () => {
    expect(createTableBlock).toMatch(/updated_at\s+TIMESTAMPTZ\s+NOT NULL/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. Colonnes nullable (incertaines à la réception Channex)
// ─────────────────────────────────────────────────────────────────────────────
describe('C. Colonnes nullable — valeurs non garanties par Channex', () => {
  test('C-01: mime_type est TEXT sans NOT NULL', () => {
    // Doit être présent mais pas NOT NULL
    expect(createTableBlock).toMatch(/mime_type\s+TEXT[^,\n]*(?:,|\))/);
    expect(createTableBlock).not.toMatch(/mime_type\s+TEXT\s+NOT NULL/);
  });

  test('C-02: filename est TEXT sans NOT NULL', () => {
    expect(createTableBlock).toMatch(/filename\s+TEXT[^,\n]*(?:,|\))/);
    expect(createTableBlock).not.toMatch(/filename\s+TEXT\s+NOT NULL/);
  });

  test('C-03: size_bytes sans NOT NULL', () => {
    expect(createTableBlock).toMatch(/size_bytes\s+INTEGER[^,\n]*(?:,|\))/);
    expect(createTableBlock).not.toMatch(/size_bytes\s+INTEGER\s+NOT NULL/);
  });

  test('C-04: provider_attachment_id est TEXT sans NOT NULL', () => {
    expect(createTableBlock).toMatch(/provider_attachment_id\s+TEXT[^,\n]*(?:,|\))/);
    expect(createTableBlock).not.toMatch(/provider_attachment_id\s+TEXT\s+NOT NULL/);
  });

  test('C-05: source_url est TEXT sans NOT NULL', () => {
    expect(createTableBlock).toMatch(/source_url\s+TEXT[^,\n]*(?:,|\))/);
    expect(createTableBlock).not.toMatch(/source_url\s+TEXT\s+NOT NULL/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. Foreign key messages(id) ON DELETE CASCADE
// ─────────────────────────────────────────────────────────────────────────────
describe('D. FK messages(id) ON DELETE CASCADE', () => {
  test('D-01: REFERENCES messages(id) présent', () => {
    expect(createTableBlock).toMatch(/REFERENCES messages\(id\)/);
  });

  test('D-02: ON DELETE CASCADE présent', () => {
    expect(createTableBlock).toMatch(/ON DELETE CASCADE/);
  });

  test('D-03: FK est sur message_id', () => {
    expect(createTableBlock).toMatch(/message_id\s+INTEGER\s+NOT NULL\s+REFERENCES messages\(id\)\s+ON DELETE CASCADE/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E. conversation_id dénormalisé — pas de FK
// ─────────────────────────────────────────────────────────────────────────────
describe('E. conversation_id dénormalisé (pas de FK)', () => {
  test('E-01: conversation_id présent comme INTEGER NOT NULL', () => {
    expect(createTableBlock).toMatch(/conversation_id\s+INTEGER\s+NOT NULL/);
  });

  test('E-02: conversation_id n\'a pas de REFERENCES conversations', () => {
    const convLine = createTableBlock.match(/conversation_id\s+INTEGER[^\n,]*/)?.[0] || '';
    expect(convLine).not.toMatch(/REFERENCES conversations/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F. CHECK constraints
// ─────────────────────────────────────────────────────────────────────────────
describe('F. CHECK constraints', () => {
  test('F-01: CHECK sur direction (inbound/outbound)', () => {
    expect(createTableBlock).toMatch(/chk_ma_direction/);
    expect(createTableBlock).toMatch(/direction\s+IN\s*\(['"]inbound['"],\s*['"]outbound['"]\)/);
  });

  test('F-02: CHECK sur status (pending/stored/failed/sent)', () => {
    expect(createTableBlock).toMatch(/chk_ma_status/);
    expect(createTableBlock).toMatch(/status\s+IN\s*\([\s\S]*['"]pending['"][\s\S]*['"]stored['"][\s\S]*['"]failed['"][\s\S]*['"]sent['"]/);
  });

  test('F-03: CHECK sur type (image/video/document/other)', () => {
    expect(createTableBlock).toMatch(/chk_ma_type/);
    expect(createTableBlock).toMatch(/type\s+IN\s*\([\s\S]*['"]image['"][\s\S]*['"]video['"][\s\S]*['"]document['"][\s\S]*['"]other['"]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G. Type cohérent avec le projet (SERIAL, pas BIGSERIAL)
// ─────────────────────────────────────────────────────────────────────────────
describe('G. Types cohérents avec le projet', () => {
  test('G-01: id est SERIAL (pas BIGSERIAL)', () => {
    const idLine = createTableBlock.match(/id\s+\w+\s+PRIMARY KEY/)?.[0] || '';
    expect(idLine).toMatch(/SERIAL/);
    expect(idLine).not.toMatch(/BIGSERIAL/);
  });

  test('G-02: message_id est INTEGER (pas BIGINT)', () => {
    expect(createTableBlock).toMatch(/message_id\s+INTEGER/);
    expect(createTableBlock).not.toMatch(/message_id\s+BIGINT/);
  });

  test('G-03: conversation_id est INTEGER (pas BIGINT)', () => {
    expect(createTableBlock).toMatch(/conversation_id\s+INTEGER/);
    expect(createTableBlock).not.toMatch(/conversation_id\s+BIGINT/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H. Index
// ─────────────────────────────────────────────────────────────────────────────
describe('H. Index', () => {
  test('H-01: index sur message_id', () => {
    expect(migrationBlock).toMatch(/CREATE INDEX IF NOT EXISTS idx_message_attachments_message_id/);
    expect(migrationBlock).toMatch(/idx_message_attachments_message_id[\s\S]*ON message_attachments \(message_id\)/);
  });

  test('H-02: index sur conversation_id', () => {
    expect(migrationBlock).toMatch(/CREATE INDEX IF NOT EXISTS idx_message_attachments_conversation_id/);
    expect(migrationBlock).toMatch(/idx_message_attachments_conversation_id[\s\S]*ON message_attachments \(conversation_id\)/);
  });

  test('H-03: index partiel sur provider_attachment_id', () => {
    expect(migrationBlock).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_message_attachments_provider_dedup/);
    expect(migrationBlock).toMatch(/ON message_attachments \(provider_attachment_id\)/);
    expect(migrationBlock).toMatch(/WHERE provider_attachment_id IS NOT NULL/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I. Déduplication
// ─────────────────────────────────────────────────────────────────────────────
describe('I. Déduplication provider_attachment_id', () => {
  test('I-01: index UNIQUE sur provider_attachment_id', () => {
    expect(migrationBlock).toMatch(/CREATE UNIQUE INDEX[\s\S]*idx_message_attachments_provider_dedup/);
  });

  test('I-02: index partiel — NULL autorisé (plusieurs attachments sans provider_id)', () => {
    // WHERE clause exclut NULL → plusieurs lignes NULL autorisées (dédup seulement si ID connu)
    expect(migrationBlock).toMatch(/WHERE provider_attachment_id IS NOT NULL/);
  });

  test('I-03: provider_attachment_id sans NOT NULL (peut être absent)', () => {
    expect(createTableBlock).not.toMatch(/provider_attachment_id\s+TEXT\s+NOT NULL/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// J. Cloudinary — référence stable, pas d'URL signée en DB
// ─────────────────────────────────────────────────────────────────────────────
describe('J. Cloudinary public_id — référence stable', () => {
  test('J-01: colonne cloudinary_public_id présente', () => {
    expect(createTableBlock).toMatch(/cloudinary_public_id\s+TEXT/);
  });

  test('J-02: cloudinary_public_id nullable (pas de NOT NULL)', () => {
    expect(createTableBlock).not.toMatch(/cloudinary_public_id\s+TEXT\s+NOT NULL/);
  });

  test('J-03: storage_url présent comme référence alternative (non-Cloudinary)', () => {
    expect(createTableBlock).toMatch(/storage_url\s+TEXT/);
  });

  test('J-04: pas de colonne signed_url ou expiring_url (aucune URL signée en DB)', () => {
    expect(createTableBlock).not.toMatch(/signed_url/i);
    expect(createTableBlock).not.toMatch(/expir/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// K. Pas de stockage binaire
// ─────────────────────────────────────────────────────────────────────────────
describe('K. Pas de stockage binaire', () => {
  test('K-01: pas de BYTEA dans message_attachments', () => {
    expect(createTableBlock).not.toMatch(/BYTEA/i);
  });

  test('K-02: pas de BLOB dans message_attachments', () => {
    expect(createTableBlock).not.toMatch(/\bBLOB\b/i);
  });

  test('K-03: pas de colonne base64_data ou raw_data', () => {
    expect(createTableBlock).not.toMatch(/base64_data|raw_data/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L. messages.photo_url intact
// ─────────────────────────────────────────────────────────────────────────────
describe('L. Compatibilité — messages.photo_url non touché', () => {
  test('L-01: aucun DROP COLUMN photo_url dans server.js', () => {
    expect(srv).not.toMatch(/DROP COLUMN\s+(IF EXISTS\s+)?photo_url/i);
    expect(chatRoutes).not.toMatch(/DROP COLUMN\s+(IF EXISTS\s+)?photo_url/i);
  });

  test('L-02: photo_url toujours utilisé dans INSERT messages (chat direct, chat_routes.js)', () => {
    expect(chatRoutes).toMatch(/INSERT INTO messages[\s\S]{0,200}photo_url/);
  });

  test('L-03: ATTACHMENTS-2 ne modifie pas la structure de la table messages', () => {
    expect(migrationBlock).not.toMatch(/ALTER TABLE messages/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M. Non-régression — tables et endpoints existants intacts
// ─────────────────────────────────────────────────────────────────────────────
describe('M. Non-régression', () => {
  test('M-01: webhook /api/channex/webhook-message non modifié — INSERT messages inchangé', () => {
    const webhookInsert = srv.match(
      /INSERT INTO messages \(conversation_id, sender_type, sender_name, message, is_read, created_at, channex_message_id\)/
    )?.[0] || '';
    expect(webhookInsert.length).toBeGreaterThan(0);
  });

  test('M-02: GET /api/chat/conversations/:id/messages — SELECT non modifié (chat_routes.js)', () => {
    expect(chatRoutes).toMatch(
      /SELECT id, conversation_id, sender_type, sender_name, message,\s+is_read, is_bot_response, is_auto_response,\s+created_at, read_at, delivered_at/
    );
  });

  test('M-03: sendBookingMessage non modifié — payload texte seul (channex.js)', () => {
    const channex = fs.readFileSync(path.join(__dirname, '../channex.js'), 'utf8');
    const fn = channex.match(
      /async function sendBookingMessage[\s\S]+?^\}/m
    )?.[0] || '';
    expect(fn.length).toBeGreaterThan(0);
    expect(fn).toMatch(/message:\s*\{\s*message\s*\}/);
    expect(fn).not.toMatch(/attachments/);
  });

  test('M-04: la migration ATTACHMENTS-2 ne touche aucune table existante', () => {
    const noAlterExisting = !migrationBlock.match(
      /ALTER TABLE (messages|conversations|reservations|properties|users)\b/
    );
    expect(noAlterExisting).toBe(true);
  });

  test('M-05: ATTACHMENTS-2 ne modifie pas integrated-chat-handler', () => {
    // Le handler IA ne doit pas être référencé dans le bloc de migration
    expect(migrationBlock).not.toMatch(/handleIncomingMessage|escalateToOwner|getGroqResponse/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// N. Champs du schéma — couverture complète
// ─────────────────────────────────────────────────────────────────────────────
describe('N. Présence de tous les champs du modèle', () => {
  const expectedColumns = [
    'id', 'message_id', 'conversation_id', 'type', 'mime_type', 'filename',
    'size_bytes', 'source_url', 'cloudinary_public_id', 'storage_url',
    'provider_attachment_id', 'channel', 'direction', 'status',
    'created_at', 'updated_at',
  ];

  expectedColumns.forEach(col => {
    test(`N: colonne "${col}" présente dans CREATE TABLE`, () => {
      expect(createTableBlock).toMatch(new RegExp(`\\b${col}\\b`));
    });
  });
});
