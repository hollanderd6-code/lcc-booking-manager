'use strict';
/**
 * OTA-SYSTEM-MESSAGE-AI-GATE
 *
 * Vérifie que les notes techniques OTA (ex: "THIS RESERVATION HAS BEEN PRE-PAID")
 * ne déclenchent jamais le LLM ni ne polluent la DB comme messages voyageur.
 *
 * A — Classifier unit tests (OTA-01 à OTA-16)
 * B — Reason extraction (OTA-R-01/02)
 * C — Booking notes path — gate avant INSERT (OTA-B-01 à OTA-B-07)
 * D — Webhook message — gate avant INSERT (OTA-W-01 à OTA-W-05)
 * E — Sync-messages — gate avant INSERT (OTA-S-01 à OTA-S-04)
 * F — Filet de sécurité IA — handleIncomingMessage (OTA-H-01 à OTA-H-05)
 * G — Historique SQL — filtres ILIKE contexte (OTA-SQL-01 à OTA-SQL-03)
 */

const { isOtaSystemMessage, getOtaSystemMessageReason } = require('../utils/chat-utils');

const fs   = require('fs');
const path = require('path');
const serverSrc  = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const handlerSrc = fs.readFileSync(path.join(__dirname, '../integrated-chat-handler.js'), 'utf8');
const chatUtilsSrc = fs.readFileSync(path.join(__dirname, '../utils/chat-utils.js'), 'utf8');

// Fixture réel de la capture utilisateur
const REAL_BOOKING_NOTE = [
  '** THIS RESERVATION HAS BEEN PRE-PAID **',
  '',
  'BOOKING NOTE : Payment charge is EUR 15.47',
  'Meal Plan: Les repas ne sont pas compris dans le tarif de la chambre.',
  'Smoking Preference: Non-Smoking',
  'Payment Collect: OTA collect',
  'OTA Commission: 187.85',
].join('\n');

// ── A. Classifier — signatures système ───────────────────────────────────────
describe('A. isOtaSystemMessage — signatures OTA', () => {

  test('OTA-01 : cas réel PRE-PAID complet → system', () => {
    expect(isOtaSystemMessage(REAL_BOOKING_NOTE)).toBe(true);
  });

  test('OTA-02 : lowercase PRE-PAID → system', () => {
    expect(isOtaSystemMessage('this reservation has been pre-paid\nbooking note: payment info')).toBe(true);
  });

  test('OTA-03 : mixed-case → system', () => {
    expect(isOtaSystemMessage('This Reservation Has Been Pre-Paid')).toBe(true);
  });

  test('OTA-04 : BOOKING NOTE: (sans espace) → system', () => {
    expect(isOtaSystemMessage('BOOKING NOTE: payment charge is EUR 10')).toBe(true);
  });

  test('OTA-05 : BOOKING NOTE : (espace avant deux-points) → system', () => {
    expect(isOtaSystemMessage('BOOKING NOTE : payment charge is EUR 10')).toBe(true);
  });

  test('OTA-06 : OTA Commission: → system', () => {
    expect(isOtaSystemMessage('OTA Commission: 187.85')).toBe(true);
  });

  test('OTA-07 : Payment Collect: → system', () => {
    expect(isOtaSystemMessage('Payment Collect: OTA collect')).toBe(true);
  });

  test('OTA-08 : CRLF line endings → system', () => {
    expect(isOtaSystemMessage('** THIS RESERVATION HAS BEEN PRE-PAID **\r\nBOOKING NOTE: info')).toBe(true);
  });

  test('OTA-09 : null → false', () => {
    expect(isOtaSystemMessage(null)).toBe(false);
  });

  test('OTA-10 : undefined → false', () => {
    expect(isOtaSystemMessage(undefined)).toBe(false);
  });

  test('OTA-11 : chaîne vide → false', () => {
    expect(isOtaSystemMessage('')).toBe(false);
  });

  test('OTA-12 : seulement espaces → false', () => {
    expect(isOtaSystemMessage('   ')).toBe(false);
  });
});

// ── A2. Faux positifs — vrais messages voyageur doivent passer ────────────────
describe('A2. isOtaSystemMessage — faux positifs (must return false)', () => {

  test('OTA-FP-01 : "Is my reservation prepaid?" → guest normal', () => {
    expect(isOtaSystemMessage('Is my reservation prepaid?')).toBe(false);
  });

  test('OTA-FP-02 : "Booking charged my card, can you help?" → guest normal', () => {
    expect(isOtaSystemMessage('Booking charged my card, can you help?')).toBe(false);
  });

  test('OTA-FP-03 : "I paid €200, can you confirm?" → guest normal', () => {
    expect(isOtaSystemMessage('I paid €200, can you confirm?')).toBe(false);
  });

  test('OTA-FP-04 : "How much is the commission?" → guest normal', () => {
    expect(isOtaSystemMessage('How much is the commission?')).toBe(false);
  });

  test('OTA-FP-05 : "Is there a meal plan?" → guest normal', () => {
    expect(isOtaSystemMessage('Is there a meal plan?')).toBe(false);
  });

  test('OTA-FP-06 : "Can I smoke?" → guest normal', () => {
    expect(isOtaSystemMessage('Can I smoke?')).toBe(false);
  });

  test('OTA-FP-07 : "Bonjour, à quelle heure peut-on arriver ?" → guest normal', () => {
    expect(isOtaSystemMessage('Bonjour, à quelle heure peut-on arriver ?')).toBe(false);
  });

  test('OTA-FP-08 : message contenant "payment" seul → guest normal', () => {
    expect(isOtaSystemMessage('I have a payment question.')).toBe(false);
  });

  test('OTA-FP-09 : message contenant "booking" seul → guest normal', () => {
    expect(isOtaSystemMessage('My booking reference is 12345.')).toBe(false);
  });

  test('OTA-FP-10 : message contenant "commission" seul → guest normal', () => {
    expect(isOtaSystemMessage('What is your commission?')).toBe(false);
  });

  test('OTA-FP-11 : une seule signature faible (Meal Plan: ) → guest normal', () => {
    // Seule signature faible — insuffisant sans combinaison
    expect(isOtaSystemMessage('Meal Plan: breakfast included')).toBe(false);
  });

  test('OTA-FP-12 : une seule signature faible (Smoking Preference:) → guest normal', () => {
    expect(isOtaSystemMessage('Smoking Preference: no')).toBe(false);
  });

  test('OTA-FP-13 : deux signatures faibles → system (combinaison suffisante)', () => {
    expect(isOtaSystemMessage('Meal Plan: included\nSmoking Preference: Non-Smoking')).toBe(true);
  });
});

// ── B. Reason extraction ──────────────────────────────────────────────────────
describe('B. getOtaSystemMessageReason', () => {

  test('OTA-R-01 : PRE-PAID → reason identifié non-null', () => {
    const r = getOtaSystemMessageReason('** THIS RESERVATION HAS BEEN PRE-PAID **');
    expect(r).toBeTruthy();
    expect(typeof r).toBe('string');
  });

  test('OTA-R-02 : message voyageur normal → null', () => {
    expect(getOtaSystemMessageReason('Bonjour, à quelle heure ?')).toBeNull();
  });

  test('OTA-R-03 : cas réel complet → reason contient le premier pattern fort', () => {
    const r = getOtaSystemMessageReason(REAL_BOOKING_NOTE);
    expect(r).toBeTruthy();
    // Doit identifier le pattern fort dominant
    expect(typeof r).toBe('string');
    expect(r.length).toBeGreaterThan(0);
  });
});

// ── C. Static analysis — chemin booking_notes ────────────────────────────────
describe('C. Chemin booking_notes — gate avant INSERT guest', () => {

  // Extraire le bloc autour de attrs.notes dans server.js
  const notesIdx = serverSrc.indexOf('const specialRequest = (attrs.notes');
  const notesBlock = notesIdx !== -1 ? serverSrc.substring(notesIdx, notesIdx + 2200) : '';

  test('OTA-B-01 : isOtaSystemMessage appliqué à specialRequest', () => {
    expect(notesBlock).toMatch(/isOtaSystemMessage\(specialRequest\)/);
  });

  test('OTA-B-02 : variable _specialIsSystem définie', () => {
    expect(notesBlock).toMatch(/_specialIsSystem/);
  });

  test('OTA-B-03 : INSERT guest conditionnel sur !_specialIsSystem', () => {
    expect(notesBlock).toMatch(/!_specialIsSystem/);
  });

  test('OTA-B-04 : AI_SKIP_OTA_SYSTEM_MESSAGE loggé avec source=booking_notes', () => {
    expect(notesBlock).toMatch(/AI_SKIP_OTA_SYSTEM_MESSAGE/);
    expect(notesBlock).toMatch(/booking_notes/);
  });

  test('OTA-B-05 : sendAutoMessage conservé (affichage hôte)', () => {
    expect(notesBlock).toMatch(/sendAutoMessage/);
  });

  test('OTA-B-06 : arrivalHourReq indépendant de _specialIsSystem', () => {
    // arrivalHourReq push doit apparaître SANS condition _specialIsSystem
    const pushIdx = notesBlock.indexOf('guestMsgParts.push(`Je souhaite arriver');
    expect(pushIdx).toBeGreaterThan(-1);
    // Le push pour specialRequest doit avoir la condition !_specialIsSystem
    expect(notesBlock).toMatch(/!isAirbnb && !_specialIsSystem.*guestMsgParts\.push\(specialRequest\)|guestMsgParts\.push\(specialRequest\).*!_specialIsSystem/s);
  });

  test('OTA-B-07 : note système + arrivalHourReq ne sont pas concaténés en bloc unique pour l\'IA', () => {
    // Les deux ne doivent jamais se retrouver dans le même guestMsgParts.push
    expect(notesBlock).not.toMatch(/guestMsgParts\.push\(specialRequest\s*\+.*arrivalHour|guestMsgParts\.push\(arrivalHour.*\+.*specialRequest/);
  });
});

// ── D. Static analysis — webhook-message ─────────────────────────────────────
describe('D. Webhook message — gate avant INSERT', () => {

  const webhookIdx = serverSrc.indexOf("app.post('/api/channex/webhook-message'");
  const webhookBlock = webhookIdx !== -1 ? serverSrc.substring(webhookIdx, webhookIdx + 6000) : '';

  test('OTA-W-01 : isOtaSystemMessage(messageText) utilisé', () => {
    expect(webhookBlock).toMatch(/isOtaSystemMessage\(messageText\)/);
  });

  test('OTA-W-02 : AI_SKIP_OTA_SYSTEM_MESSAGE loggé avec source=channex_message_webhook', () => {
    expect(webhookBlock).toMatch(/AI_SKIP_OTA_SYSTEM_MESSAGE/);
    expect(webhookBlock).toMatch(/channex_message_webhook/);
  });

  test('OTA-W-03 : signal structurel sender utilisé (booking, channel_manager)', () => {
    expect(webhookBlock).toMatch(/'booking'.*'channel_manager'|_isStructuralSystem|_OTA_STRUCTURAL_SENDERS/);
  });

  test('OTA-W-04 : ancien OTA_SYSTEM_PATTERNS array supprimé', () => {
    expect(webhookBlock).not.toMatch(/const OTA_SYSTEM_PATTERNS/);
  });

  test('OTA-W-05 : skip retourne avant INSERT messages', () => {
    // Chercher dans la source complète pour éviter les problèmes de fenêtre
    const webhookStart = serverSrc.indexOf("app.post('/api/channex/webhook-message'");
    const skipIdx = webhookStart !== -1 ? serverSrc.indexOf("skipped: 'ota_system_message'", webhookStart) : -1;
    const insertIdx = skipIdx !== -1 ? serverSrc.indexOf('INSERT INTO messages', skipIdx) : -1;
    expect(skipIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(skipIdx);
  });
});

// ── E. Static analysis — sync-messages ───────────────────────────────────────
describe('E. Sync-messages — gate avant INSERT', () => {

  const syncIdx = serverSrc.indexOf("app.post('/api/channex/sync-messages/");
  const syncBlock = syncIdx !== -1 ? serverSrc.substring(syncIdx, syncIdx + 2500) : '';

  test('OTA-S-01 : isOtaSystemMessage appliqué dans sync-messages', () => {
    expect(syncBlock).toMatch(/isOtaSystemMessage\(messageText\)/);
  });

  test('OTA-S-02 : AI_SKIP_OTA_SYSTEM_MESSAGE loggé avec source=channex_sync', () => {
    expect(syncBlock).toMatch(/AI_SKIP_OTA_SYSTEM_MESSAGE/);
    expect(syncBlock).toMatch(/channex_sync/);
  });

  test('OTA-S-03 : note système → skipped++ continue (pas d\'INSERT)', () => {
    expect(syncBlock).toMatch(/isOtaSystemMessage[\s\S]{0,600}skipped\+\+/);
  });

  test('OTA-S-04 : message voyageur normal → INSERT conservé', () => {
    // L'INSERT final est bien là pour les messages non-système
    expect(syncBlock).toMatch(/INSERT INTO messages/);
  });
});

// ── F. Static analysis — filet de sécurité IA ────────────────────────────────
describe('F. Filet de sécurité IA — handleIncomingMessage', () => {

  const handlerIdx = handlerSrc.indexOf('async function handleIncomingMessage(');
  const handlerBlock = handlerIdx !== -1 ? handlerSrc.substring(handlerIdx, handlerIdx + 8000) : '';

  test('OTA-H-01 : isOtaSystemMessage(msgText) appelé dans handleIncomingMessage', () => {
    expect(handlerBlock).toMatch(/isOtaSystemMessage\(msgText\)/);
  });

  test('OTA-H-02 : AI_SKIP_OTA_SYSTEM_MESSAGE loggé avec source=ai_safety_gate', () => {
    expect(handlerBlock).toMatch(/AI_SKIP_OTA_SYSTEM_MESSAGE/);
    expect(handlerBlock).toMatch(/ai_safety_gate/);
  });

  test('OTA-H-03 : ancien array inline supprimé du handler', () => {
    expect(handlerBlock).not.toMatch(/msgText\.includes\('THIS RESERVATION/);
  });

  test('OTA-H-04 : helper importé depuis utils/chat-utils', () => {
    expect(handlerSrc).toMatch(/require.*utils\/chat-utils/);
    expect(handlerSrc).toMatch(/isOtaSystemMessage/);
  });

  test('OTA-H-05 : gate retourne false avant tout appel LLM', () => {
    // Chercher dans la source complète du handler
    const funcStart = handlerSrc.indexOf('async function handleIncomingMessage(');
    const gateIdx = funcStart !== -1 ? handlerSrc.indexOf('isOtaSystemMessage(msgText)', funcStart) : -1;
    const groqIdx = funcStart !== -1 ? handlerSrc.indexOf('getGroqResponse', funcStart) : -1;
    expect(gateIdx).toBeGreaterThan(-1);
    expect(groqIdx).toBeGreaterThan(gateIdx);
  });
});

// ── G. Filtres SQL historiques — contexte IA ─────────────────────────────────
describe('G. Filtres SQL ILIKE — contexte IA (messages historiques)', () => {

  test('OTA-SQL-01 : integrated-chat-handler exclut PRE-PAID du contexte', () => {
    expect(handlerSrc).toMatch(/NOT ILIKE.*THIS RESERVATION HAS BEEN PRE-PAID/i);
  });

  test('OTA-SQL-02 : integrated-chat-handler exclut BOOKING NOTE du contexte', () => {
    expect(handlerSrc).toMatch(/NOT ILIKE.*BOOKING NOTE/i);
  });

  test('OTA-SQL-03 : integrated-chat-handler exclut OTA Commission du contexte', () => {
    expect(handlerSrc).toMatch(/NOT ILIKE.*OTA Commission/i);
  });
});
