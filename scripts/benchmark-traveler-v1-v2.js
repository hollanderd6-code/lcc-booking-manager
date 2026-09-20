#!/usr/bin/env node
'use strict';
/**
 * Blind V1 vs V2 Benchmark Runner — DEV25 only
 * Version: 1.0.0
 *
 * Usage:
 *   node scripts/benchmark-traveler-v1-v2.js --dry-run
 *   node scripts/benchmark-traveler-v1-v2.js --dev --confirm-real-run
 *
 * SHADOW mode: SELECT only — zero DB writes, zero platform messages, zero FCM.
 *
 * Outputs (in benchmarks/runs/PREFIX-timestamp/, never committed):
 *   BLIND.json — no model labels (SYSTEM_A / SYSTEM_B only)
 *   KEY.json   — model mapping (KEEP CONFIDENTIAL until review)
 *   RAW.json   — full diagnostic context data
 *
 * DATASET GUARD: verifies fingerprint, no golden IDs, no regression IDs before any call.
 *
 * V1 TEMPORAL LIMITATION (documented):
 *   buildTemporalContext() inside getGroqResponse uses new Date() at call time.
 *   stayPhase is computed from targetTs (historical) — but Groq system prompt
 *   "current date" block will reflect current runtime date, not historical date.
 *   This is an unavoidable V1 production characteristic; documented in RAW.json.
 */

const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');
const { Pool } = require('pg');

const { getGroqResponse }                  = require('../groq-ai');
const {
  buildTravelerContext,
  loadBenchmarkFewShotExamples,
  buildTravelerSystemPrompt,
  callGroqTravelerV2,
  computeContextFingerprint,
} = require('../services/traveler-ai-v2');

// ─── Constants ────────────────────────────────────────────────────────────────

const DATASET_PATH         = path.join(__dirname, '..', 'benchmarks', 'traveler-v2-eval-set.json');
const EXPECTED_FINGERPRINT = 'c6174b89918aad08e435a907df322960773c7070da2c2831c4cdd41b078ba7eb';
const GOLDEN_IDS           = new Set([3139, 8786, 6072, 2592, 3749, 6913]);
const REGRESSION_IDS       = new Set([4626, 9410, 7297, 3259]);
const AB_SALT              = 'v1v2-blind-2026-09-20'; // CLASSIFY FIRST salt — never change

// ─── Dataset Guard ────────────────────────────────────────────────────────────

/**
 * Loads and validates the frozen evaluation dataset.
 * Throws if fingerprint doesn't match, or if any invariant fails.
 * Returns { dataset, devCases } with devCases = exactly 25 DEV cases.
 */
function loadAndGuardDataset() {
  if (!fs.existsSync(DATASET_PATH)) {
    throw new Error(`Dataset not found: ${DATASET_PATH}. Run build-eval-set.js first.`);
  }

  const dataset = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf8'));

  if (dataset.dataset_fingerprint !== EXPECTED_FINGERPRINT) {
    throw new Error(
      `DATASET FINGERPRINT MISMATCH.\n` +
      `  Expected: ${EXPECTED_FINGERPRINT}\n` +
      `  Got:      ${dataset.dataset_fingerprint}\n` +
      `Do NOT modify the evaluation dataset.`
    );
  }

  if (dataset.total_cases !== 40) {
    throw new Error(`Expected total_cases=40, got ${dataset.total_cases}`);
  }

  const devCases = (dataset.cases || []).filter(c => c.split === 'DEV');
  if (devCases.length !== 25) {
    throw new Error(`Expected 25 DEV cases, got ${devCases.length}`);
  }

  for (const c of devCases) {
    if (GOLDEN_IDS.has(c.message_id)) {
      throw new Error(`GOLDEN ID ${c.message_id} found in DEV set — dataset corrupted`);
    }
    if (REGRESSION_IDS.has(c.message_id)) {
      throw new Error(`REGRESSION ID ${c.message_id} found in DEV set — dataset corrupted`);
    }
  }

  return { dataset, devCases };
}

// ─── A/B Assignment ───────────────────────────────────────────────────────────

/**
 * Deterministic balanced A/B assignment.
 * SHA-256(fingerprint + ":" + message_id + ":" + AB_SALT) → sort all 25 by hash.
 * First 12 → V1 gets label SYSTEM_A. Remaining 13 → V1 gets label SYSTEM_B.
 * Result is always 12 SYSTEM_A + 13 SYSTEM_B (for V1), regardless of case order.
 *
 * @param {Array}  cases             — DEV cases from dataset
 * @param {string} datasetFingerprint
 * @returns {Object} { message_id → 'SYSTEM_A' | 'SYSTEM_B' }
 */
function computeABAssignment(cases, datasetFingerprint) {
  const hashed = cases.map(c => ({
    message_id: c.message_id,
    _h: crypto.createHash('sha256')
      .update(`${datasetFingerprint}:${c.message_id}:${AB_SALT}`, 'utf8')
      .digest('hex'),
  }));

  hashed.sort((a, b) => a._h.localeCompare(b._h));

  const assignments = {};
  hashed.forEach((c, i) => {
    // First 12 → V1 labeled SYSTEM_A; last 13 → V1 labeled SYSTEM_B
    assignments[c.message_id] = i < 12 ? 'SYSTEM_A' : 'SYSTEM_B';
  });

  return assignments;
}

// ─── V1 Context Builder (pure SELECT, anti-leakage temporal) ─────────────────

/**
 * Builds the V1 context object from DB — mirrors handleIncomingMessage context
 * construction (integrated-chat-handler.js lines 833–915) with two changes:
 *
 *   1. Only SELECT queries — zero DB writes.
 *   2. targetTs replaces new Date() for stayPhase + alreadyGreetedToday.
 *      V1_TEMPORAL_LIMITATION: buildTemporalContext() inside getGroqResponse still
 *      uses new Date() (current runtime); only stayPhase is corrected here.
 *
 * @param {object} pool
 * @param {object} msg   — enriched message row (includes conversation JOIN fields)
 * @param {Date}   targetTs — message created_at timestamp
 * @returns {object} context for getGroqResponse
 */
async function buildV1Context(pool, msg, targetTs) {
  const convId = msg.conversation_id;

  // Property
  let property = null;
  if (msg.property_id) {
    const pr = await pool.query('SELECT * FROM properties WHERE id = $1', [msg.property_id]);
    property = pr.rows[0] || null;
  }

  if (!property) {
    return { language: msg.language || 'fr', _v1_no_property: true };
  }

  // Language detection — same scoring as production, no DB write
  const msgText = msg.message || '';
  const VALID_LANGS = ['fr','en','es','de','it','pt','nl','ru','zh','ja','ko'];
  const pinnedLang  = (msg.language && VALID_LANGS.includes(msg.language)) ? msg.language : null;
  const scores = {
    en: (msgText.match(/\b(hello|hi|hey|thanks|thank you|please|what|where|when|how|can|could|would|wifi|password|check.in|check.out|address|arrival|departure|yes|no|perfect|good|got it)\b/gi) || []).length,
    es: (msgText.match(/\b(hola|gracias|por favor|dónde|cuándo|puedo|quiero|necesito|contraseña|llegada|salida)\b/gi) || []).length,
    de: (msgText.match(/\b(hallo|danke|bitte|wo|wann|wie|was|können|möchte|passwort|ankunft|abreise)\b/gi) || []).length,
    it: (msgText.match(/\b(ciao|grazie|dove|quando|posso|vorrei|ho bisogno|indirizzo|arrivo|partenza)\b/gi) || []).length,
    fr: (msgText.match(/\b(bonjour|bonsoir|merci|où|quand|comment|puis-je|voudrais|besoin|arrivée|départ|avez-vous|est-ce|nous|vous|je|pourquoi|pouvez|votre|payé|reçu|facture)\b/gi) || []).length,
    pt: (msgText.match(/\b(olá|ola|obrigado|obrigada|por favor|onde|quando|posso|quero|preciso|senha|chegada|saída)\b/gi) || []).length,
    nl: (msgText.match(/\b(hallo|hoi|bedankt|dank|alsjeblieft|waar|wanneer|kan|wil|nodig|wachtwoord|aankomst|vertrek)\b/gi) || []).length,
  };
  const best     = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  const bestLang = best[0], bestScore = best[1];
  let language;
  if      (bestScore >= 2 && bestLang !== pinnedLang) language = bestLang;
  else if (pinnedLang)                                language = pinnedLang;
  else if (bestScore >= 1)                            language = bestLang;
  else                                                language = 'fr';

  // Platform
  const platformRaw       = (msg.platform || '').toLowerCase().replace(/[_\-\s]/g, '');
  const isAirbnbPlatform  = ['airbnb','abb','airbnbofficial'].includes(platformRaw) || platformRaw.includes('airbnb');

  // Welcome book
  let welcomeBookData = null;
  if (property.welcome_book_url) {
    const urlMatch = property.welcome_book_url.match(/\/welcome\/([a-zA-Z0-9_-]+)/);
    const uniqueId = urlMatch ? urlMatch[1] : null;
    if (uniqueId) {
      try {
        const bookResult = await pool.query(
          'SELECT data FROM welcome_books_v2 WHERE unique_id = $1', [uniqueId]
        );
        welcomeBookData = bookResult.rows[0]?.data || null;
      } catch(e) {}
    }
  }

  // Deposit (SELECT only)
  let depositStatus = null, depositAmount = null;
  if (!isAirbnbPlatform) {
    try {
      const depResult = await pool.query(
        `SELECT d.status, d.amount_cents, p.deposit_amount
         FROM conversations c
         LEFT JOIN properties p ON p.id = c.property_id
         LEFT JOIN reservations r ON (
           (r.channex_booking_id = c.channex_booking_id AND c.channex_booking_id IS NOT NULL)
           OR (r.property_id = c.property_id AND DATE(r.start_date) = DATE(c.reservation_start_date))
         )
         LEFT JOIN deposits d ON d.reservation_uid = r.uid
         WHERE c.id = $1
         ORDER BY d.created_at DESC LIMIT 1`,
        [convId]
      );
      if (depResult.rows[0]) {
        depositStatus = depResult.rows[0].status || null;
        depositAmount = depResult.rows[0].amount_cents
          ? depResult.rows[0].amount_cents / 100
          : depResult.rows[0].deposit_amount || null;
      }
    } catch(e) {}
  }

  // Stay phase — using targetTs (historical) rather than new Date()
  const nowForPhase = targetTs;
  const checkinDt   = msg.reservation_start_date ? new Date(msg.reservation_start_date) : null;
  const checkoutDt  = msg.reservation_end_date   ? new Date(msg.reservation_end_date)   : null;
  let stayPhase = 'before';
  if (checkinDt && checkoutDt) {
    if (nowForPhase >= checkoutDt)  stayPhase = 'after';
    else if (nowForPhase >= checkinDt) stayPhase = 'during';
  }

  // Already greeted today — based on targetTs day, not today
  let alreadyGreetedToday = false;
  try {
    const todayStart = new Date(targetTs); todayStart.setHours(0, 0, 0, 0);
    const greetCheck = await pool.query(
      `SELECT COUNT(*) AS c FROM messages
       WHERE conversation_id = $1
       AND sender_type IN ('property','system','bot')
       AND created_at >= $2
       AND created_at < $3`,
      [convId, todayStart, targetTs]
    );
    alreadyGreetedToday = parseInt(greetCheck.rows[0].c) > 0;
  } catch(e) {}

  // Registration (fiche de police)
  let registrationDone = true, registrationLink = null, isForeignGuest = false;
  if (!isAirbnbPlatform) {
    try {
      const regRes = await pool.query(
        `SELECT c.unique_token, r.guest_country,
                EXISTS (SELECT 1 FROM police_records pr WHERE pr.conversation_id = c.id) AS done
         FROM conversations c
         LEFT JOIN reservations r ON (
           (c.channex_booking_id IS NOT NULL AND r.channex_booking_id = c.channex_booking_id)
           OR (c.channex_booking_id IS NULL AND r.property_id = c.property_id
               AND DATE(r.start_date) = DATE(c.reservation_start_date))
         )
         WHERE c.id = $1 LIMIT 1`,
        [convId]
      );
      if (regRes.rows[0]) {
        registrationDone = regRes.rows[0].done === true;
        const gc  = (regRes.rows[0].guest_country || '').toUpperCase().trim();
        isForeignGuest = gc !== '' && gc !== 'FR';
        const tok = regRes.rows[0].unique_token;
        if (tok) {
          const baseUrl = (process.env.APP_URL || 'https://www.boostinghost.fr').replace(/\/$/, '');
          registrationLink = `${baseUrl}/checkin.html?token=${tok}`;
        }
      }
    } catch(e) { registrationDone = true; }
  }

  const depositRequired      = !isAirbnbPlatform && property.deposit_amount && parseFloat(property.deposit_amount) > 0;
  const depositPaid          = depositStatus && ['authorized','captured'].includes(depositStatus);
  const depositBlocksAccess  = !!(depositRequired && !depositPaid);
  const registrationBlocksAccess = !isAirbnbPlatform && isForeignGuest && !registrationDone && !!registrationLink;

  // Deposit link already sent — temporal filter: only messages before targetTs
  let depositLinkAlreadySent = false, depositUrl = null;
  try {
    const r = await pool.query(
      `SELECT message FROM messages
       WHERE conversation_id = $1
       AND sender_type IN ('property','system','bot')
       AND message ILIKE '%boostinghost.fr/c/%'
       AND created_at < $2
       ORDER BY created_at ASC LIMIT 1`,
      [convId, targetTs]
    );
    if (r.rows.length > 0) {
      depositLinkAlreadySent = true;
      const match = r.rows[0].message.match(/https:\/\/boostinghost\.fr\/c\/[a-zA-Z0-9]+/);
      depositUrl = match ? match[0] : null;
    }
  } catch(e) {}

  // Property facts
  let propertyFacts = [];
  try {
    const factsRes = await pool.query(
      `SELECT question, answer, detail FROM property_facts
       WHERE property_id = $1 ORDER BY updated_at DESC LIMIT 50`,
      [property.id]
    );
    propertyFacts = factsRes.rows;
  } catch(e) {}

  // Schedule decisions — temporal filter: only answered before targetTs
  let scheduleDecisions = [];
  try {
    const sdRes = await pool.query(
      `SELECT kind, meta->>'type' AS type, meta->>'reqLabel' AS req_label,
              meta->>'refLabel' AS ref_label, status, answer_text
       FROM ai_host_questions
       WHERE conversation_id = $1 AND kind = 'schedule'
         AND status IN ('answered_yes', 'answered_no')
         AND answered_at < $2
       ORDER BY answered_at ASC`,
      [convId, targetTs]
    );
    scheduleDecisions = sdRes.rows;
  } catch(e) {}

  // Custom Q/R
  let customQRSummary = null;
  try {
    const rawQR   = property.custom_auto_responses || property.customAutoResponses;
    const customQR = Array.isArray(rawQR) ? rawQR : (typeof rawQR === 'string' ? JSON.parse(rawQR) : []);
    if (customQR.length > 0) {
      customQRSummary = customQR
        .filter(qr => qr.keywords && qr.response)
        .map(qr => `- "${qr.keywords}" → ${qr.response}`)
        .join('\n');
    }
  } catch(e) {}

  return {
    propertyName:         property.name,
    language,
    stayPhase,
    checkinDt:            msg.reservation_start_date,
    checkoutDt:           msg.reservation_end_date,
    checkinDate:          checkinDt  ? checkinDt.toLocaleDateString('fr-FR')  : null,
    checkoutDate:         checkoutDt ? checkoutDt.toLocaleDateString('fr-FR') : null,
    alreadyGreetedToday,
    arrivalTime:          property.arrival_time,
    departureTime:        property.departure_time || welcomeBookData?.checkoutTime,
    checkoutInstructions: welcomeBookData?.checkoutInstructions,
    lateCheckoutToleranceMin: (property.late_checkout_tolerance_minutes != null ? parseInt(property.late_checkout_tolerance_minutes) : 120),
    earlyCheckinToleranceMin: (property.early_checkin_tolerance_minutes  != null ? parseInt(property.early_checkin_tolerance_minutes)  : 60),
    lateCheckoutPaid:     property.late_checkout_enabled  === true && parseFloat(property.late_checkout_price_per_hour)  > 0,
    earlyCheckinPaid:     property.early_checkin_enabled  === true && parseFloat(property.early_checkin_price_per_hour)  > 0,
    welcomeBasketEnabled: property.welcome_basket_enabled === true && parseFloat(property.welcome_basket_price) > 0,
    welcomeBasketPrice:   parseFloat(property.welcome_basket_price) || null,
    welcomeBasketDescription: property.welcome_basket_description || null,
    wifiName:             property.wifi_name     || welcomeBookData?.wifiSSID,
    wifiPassword:         registrationBlocksAccess ? null : (property.wifi_password || welcomeBookData?.wifiPassword),
    accessCode: (() => {
      if (isAirbnbPlatform)          return property.access_code || welcomeBookData?.keyboxCode;
      if (registrationBlocksAccess)  return null;
      if (depositBlocksAccess)       return null;
      return property.access_code || welcomeBookData?.keyboxCode;
    })(),
    accessInstructions: (() => {
      if (isAirbnbPlatform)          return property.access_instructions || welcomeBookData?.accessInstructions;
      if (registrationBlocksAccess)  return null;
      if (depositBlocksAccess)       return null;
      return property.access_instructions || welcomeBookData?.accessInstructions;
    })(),
    address: (() => {
      const parts = [
        property.address || welcomeBookData?.address,
        welcomeBookData?.postalCode,
        welcomeBookData?.city,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(', ') : null;
    })(),
    parkingInfo:          welcomeBookData?.parkingInfo,
    extraNotesAccess:     welcomeBookData?.extraNotesAccess,
    equipmentList:        welcomeBookData?.equipmentList,
    importantRules:       welcomeBookData?.importantRules,
    transportInfo:        welcomeBookData?.transportInfo,
    extraNotesPractical:  welcomeBookData?.extraNotesPractical,
    welcomeDescription:   welcomeBookData?.welcomeDescription,
    contactPhone:         welcomeBookData?.contactPhone,
    restaurants:          welcomeBookData?.restaurants,
    places:               welcomeBookData?.places,
    shopsList:            welcomeBookData?.shopsList,
    extraNotesAround:     welcomeBookData?.extraNotesAround,
    rooms:                welcomeBookData?.rooms,
    extraNotesLogement:   welcomeBookData?.extraNotesLogement,
    practicalInfo:        property.practical_info,
    customQRSummary,
    propertyFacts,
    scheduleDecisions,
    depositAmount:        isAirbnbPlatform ? null : depositAmount,
    depositStatus:        isAirbnbPlatform ? 'not_applicable' : depositStatus,
    depositBlocksAccess,
    depositLinkAlreadySent,
    depositUrl,
    isAirbnb:             isAirbnbPlatform,
    registrationBlocksAccess,
    registrationLink,
  };
}

// ─── V1 History Builder (anti-leakage temporal) ───────────────────────────────

/**
 * Returns history for V1 getGroqResponse with strict temporal anti-leakage.
 * Production uses NOW() - 7 days; benchmark uses targetTs - 7 days with
 * an additional created_at < targetTs upper bound.
 *
 * @param {object} pool
 * @param {number} convId
 * @param {Date}   targetTs
 * @returns {Array<{role, content}>}
 */
async function buildV1History(pool, convId, targetTs) {
  const histResult = await pool.query(
    `SELECT sender_type, sender_name, message FROM messages
     WHERE conversation_id = $1
     AND created_at < $2
     AND created_at > $2::timestamptz - INTERVAL '7 days'
     AND message NOT ILIKE '%THIS RESERVATION HAS BEEN PRE-PAID%'
     AND message NOT ILIKE '%BOOKING NOTE%'
     AND message NOT ILIKE '%OTA Commission%'
     AND message NOT ILIKE '%Payment Collect%'
     AND message NOT ILIKE '%Meal Plan%'
     AND LENGTH(message) > 3
     ORDER BY created_at ASC
     LIMIT 30`,
    [convId, targetTs]
  );
  return histResult.rows.map(m => ({
    role:    m.sender_type === 'guest' ? 'user' : 'assistant',
    content: m.message,
  }));
}

// ─── V1 Context Fingerprint ───────────────────────────────────────────────────

/**
 * SHA-256(16 chars hex) of the canonical V1 input context.
 * Canonical = JSON with all object keys sorted alphabetically.
 * Excludes: timestamps, latency_ms, response content.
 *
 * @param {string} guestMessage
 * @param {Array}  history
 * @param {Array}  fewShot
 * @param {object} context  — V1 context object from buildV1Context
 * @returns {string} 16-char hex fingerprint
 */
function computeV1ContextFingerprint(guestMessage, history, fewShot, context) {
  function canonicalize(val) {
    if (val === null || val === undefined) return val;
    if (Array.isArray(val)) return val.map(canonicalize);
    if (typeof val === 'object') {
      const sorted = {};
      for (const k of Object.keys(val).sort()) sorted[k] = canonicalize(val[k]);
      return sorted;
    }
    return val;
  }

  const payload = {
    _v:          'v1',
    context:     context  || {},
    fewShot:     (fewShot  || []).map(ex => ({ guest: ex.guest, host: ex.host })),
    guestMessage: guestMessage || '',
    history:     (history  || []).map(h  => ({ content: h.content, role: h.role })),
  };

  const canonical = JSON.stringify(canonicalize(payload));
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex').substring(0, 16);
}

// ─── Blind Entry Builder ──────────────────────────────────────────────────────

/**
 * Builds one entry for BLIND.json — no model labels.
 * v1Label is the SYSTEM label assigned to V1 ('SYSTEM_A' or 'SYSTEM_B').
 *
 * @param {object} p
 * @param {string} p.evalId
 * @param {string} p.v1Label      — 'SYSTEM_A' or 'SYSTEM_B'
 * @param {*}      p.v1Response   — raw V1 Groq response (string or DRY_RUN marker)
 * @param {*}      p.v2Response   — V2 decision object or DRY_RUN marker
 * @param {string} p.category     — message category from eval set
 * @param {string} p.fpV1         — V1 context fingerprint
 * @param {string} p.fpV2         — V2 context fingerprint
 * @returns {object} blind entry with SYSTEM_A / SYSTEM_B keys only
 */
function buildBlindEntry({ evalId, v1Label, v1Response, v2Response, category, fpV1, fpV2 }) {
  const v2Label = v1Label === 'SYSTEM_A' ? 'SYSTEM_B' : 'SYSTEM_A';
  return {
    eval_id:  evalId,
    category,
    [v1Label]: { response: v1Response, context_fp: fpV1 },
    [v2Label]: { response: v2Response, context_fp: fpV2 },
  };
}

// ─── Run Validity ────────────────────────────────────────────────────────────

/**
 * A DEV25 run is valid only when every case has a real generation from both systems.
 * A single technical error invalidates the run for comparative purposes.
 * @param {number} attempted — cases actually processed
 * @param {number} v1ok      — cases with a valid V1 string response
 * @param {number} v2ok      — cases with a valid V2 object response (no error)
 * @returns {boolean}
 */
function computeRunValidity(attempted, v1ok, v2ok) {
  return attempted === 25 && v1ok === 25 && v2ok === 25;
}

// ─── V1 Response Validator ────────────────────────────────────────────────────

/**
 * A real V1 generation is a non-empty, non-whitespace string.
 * null / undefined / "" / "  " are all failures — never count as success.
 * @param {*} response
 * @returns {{ ok: boolean, reason?: string }}
 */
function validateV1Response(response) {
  if (response === null || response === undefined)  return { ok: false, reason: 'NULL_RESPONSE' };
  if (typeof response !== 'string')                 return { ok: false, reason: 'NOT_A_STRING' };
  if (response.trim().length === 0)                 return { ok: false, reason: 'EMPTY_OR_WHITESPACE' };
  return { ok: true };
}

// ─── Groq Key Preflight ───────────────────────────────────────────────────────

/**
 * Makes a minimal Groq API call (1 token) to verify the key is valid.
 * Uses native fetch (Node 18+). Does NOT use a DEV benchmark case.
 * @param {string} apiKey
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function preflightGroqKey(apiKey) {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        model:     'openai/gpt-oss-120b',
        messages:  [{ role: 'user', content: 'ok' }],
        max_tokens: 1,
      }),
    });
    if (res.status === 200 || res.status === 201) return { ok: true };
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─── Historical Reply Resolver ────────────────────────────────────────────────

function _resolveHistoricalReplyLocal(nextRow) {
  const isHostReply = nextRow && ['owner','property','system'].includes(nextRow.sender_type);
  if (!isHostReply) return { reply: null, replyType: 'AUCUNE' };
  let replyType;
  if      (nextRow.sender_type === 'system')  replyType = 'IA_V1';
  else if (nextRow.is_bot_response === true)  replyType = 'IA_AUTO';
  else if (nextRow.sender_type === 'owner')   replyType = 'HUMAIN';
  else                                        replyType = 'INCONNU';
  return { reply: nextRow.message, replyType };
}

// ─── Main Benchmark Runner ────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {boolean} [opts.dryRun=true]
 * @param {boolean} [opts.confirmRealRun=false]
 */
async function runBenchmark({ dryRun = true, confirmRealRun = false } = {}) {
  if (!dryRun && !confirmRealRun) {
    throw new Error('Real run requires confirmRealRun=true. This triggers 50 Groq API calls.');
  }

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  Blind V1 vs V2 Benchmark Runner${dryRun ? ' — DRY RUN' : ' — REAL RUN (DEV25)'}`);
  console.log(`  ${new Date().toISOString()}`);
  console.log(`${'═'.repeat(70)}\n`);

  // Step 1 — Load and guard dataset
  console.log('── Step 1: Load and guard dataset');
  const { dataset, devCases } = loadAndGuardDataset();
  console.log(`   ✅ Fingerprint OK: ${dataset.dataset_fingerprint.substring(0, 24)}...`);
  console.log(`   ✅ ${devCases.length} DEV cases`);

  // Step 2 — A/B assignment
  console.log('\n── Step 2: A/B assignment');
  const abAssignments = computeABAssignment(devCases, dataset.dataset_fingerprint);
  const countA = Object.values(abAssignments).filter(x => x === 'SYSTEM_A').length;
  const countB = Object.values(abAssignments).filter(x => x === 'SYSTEM_B').length;
  console.log(`   ✅ SYSTEM_A (V1): ${countA} cases, SYSTEM_B (V1): ${countB} cases`);

  // Determine which label corresponds to which model globally (same seed, deterministic)
  const keyHash    = crypto.createHash('sha256')
    .update(`${dataset.dataset_fingerprint}:${AB_SALT}:key`, 'utf8')
    .digest('hex');
  const v1IsGlobalA = parseInt(keyHash[0], 16) % 2 === 0;
  const KEY_INFO = {
    generated_at: new Date().toISOString(),
    salt:         AB_SALT,
    global_label: { SYSTEM_A: v1IsGlobalA ? 'V1' : 'V2', SYSTEM_B: v1IsGlobalA ? 'V2' : 'V1' },
    note: 'per-case mapping: SYSTEM_A = model labeled V1 in some cases, V2 in others (see abAssignments)',
  };
  console.log(`   ✅ Key generated (SYSTEM_A global default: ${KEY_INFO.global_label.SYSTEM_A})`);

  // Step 2.5 — GROQ_API_KEY fail-fast (real runs only — dry-run skips Groq entirely)
  if (!dryRun) {
    if (!process.env.GROQ_API_KEY || !process.env.GROQ_API_KEY.trim()) {
      console.error('\n❌ ABORT: GROQ_API_KEY_MISSING');
      console.error('   A real benchmark run requires GROQ_API_KEY to be set.');
      console.error('   Processed cases = 0, Groq calls = 0');
      throw new Error('GROQ_API_KEY_MISSING');
    }
    console.log('\n── Step 2.5: Groq key preflight');
    const pf = await preflightGroqKey(process.env.GROQ_API_KEY);
    if (!pf.ok) {
      console.error(`   ❌ ABORT: Groq key invalid — ${pf.error}`);
      throw new Error(`GROQ_KEY_INVALID: ${pf.error}`);
    }
    console.log('   ✅ Groq key verified');
  }

  // Step 3 — DB connection
  console.log('\n── Step 3: DB connection');
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL not set');
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  console.log('   ✅ Pool created');

  // Step 4 — Process DEV cases
  console.log(`\n── Step 4: Process ${devCases.length} cases${dryRun ? ' (DRY RUN — no Groq calls)' : ''}\n`);

  const blindResults = [];
  const rawResults   = [];
  const keyMapping   = {};

  let groqCallCount = 0;

  for (let i = 0; i < devCases.length; i++) {
    const evalCase = devCases[i];
    const evalId   = `EVAL-DEV-${String(i + 1).padStart(3, '0')}`;
    const v1Label  = abAssignments[evalCase.message_id];
    const v2Label  = v1Label === 'SYSTEM_A' ? 'SYSTEM_B' : 'SYSTEM_A';

    keyMapping[evalId] = { [v1Label]: 'V1', [v2Label]: 'V2' };

    console.log(`  [${evalId}] msg=${evalCase.message_id} conv=${evalCase.conversation_id} cat=${evalCase.category} V1→${v1Label}`);

    const raw = {
      eval_id:             evalId,
      message_id:          evalCase.message_id,
      conversation_id:     evalCase.conversation_id,
      property_id:         evalCase.property_id,
      category:            evalCase.category,
      split:               evalCase.split,
      v1_system_label:     v1Label,
      v2_system_label:     v2Label,
      guest_message:       null,
      message_at:          null,
      historical_reply:     null,
      historical_reply_type: null,
      v1_context_fp:       null,
      v2_context_fp:       null,
      v1_history_count:    null,
      v2_history_count:    null,
      v1_fewshot_count:    null,
      v2_fewshot_count:    null,
      v1_response:         null,
      v2_response:         null,
      v1_latency_ms:       null,
      v2_latency_ms:       null,
      v1_error:            null,
      v2_error:            null,
      v1_temporal_limitation: 'buildTemporalContext in groq-ai.js uses new Date() at call time; stayPhase uses targetTs',
      dry_run:             dryRun,
    };

    try {
      // Fetch message + conversation (JOIN)
      const msgRes = await pool.query(
        `SELECT m.id, m.message, m.created_at, m.conversation_id,
                c.property_id, c.user_id, c.guest_name, c.platform,
                c.channex_booking_id, c.reservation_start_date, c.reservation_end_date,
                c.language
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE m.id = $1`,
        [evalCase.message_id]
      );

      if (!msgRes.rows[0]) {
        const errMsg = `MISSING_MESSAGE_ID: ${evalCase.message_id}`;
        raw.v1_error = raw.v2_error = errMsg;
        console.log(`     ⚠️  ${errMsg}`);
        rawResults.push(raw);
        blindResults.push(buildBlindEntry({ evalId, v1Label, v1Response: null, v2Response: null, category: evalCase.category, fpV1: null, fpV2: null }));
        continue;
      }

      const msg      = msgRes.rows[0];
      const targetTs = new Date(msg.created_at);
      raw.guest_message = msg.message;
      raw.message_at    = msg.created_at;

      // Historical reply (reference only — never injected into prompts)
      const histReplyRes = await pool.query(
        `SELECT message, sender_type, sender_name, is_bot_response FROM messages
         WHERE conversation_id = $1
         AND sender_type NOT IN ('internal_note')
         AND created_at > $2
         ORDER BY created_at ASC LIMIT 1`,
        [evalCase.conversation_id, targetTs]
      );
      const { reply: histReply, replyType: histReplyType } =
        _resolveHistoricalReplyLocal(histReplyRes.rows[0] || null);
      raw.historical_reply      = histReply;
      raw.historical_reply_type = histReplyType;

      // ── V1 context ────────────────────────────────────────────────
      const v1Context = await buildV1Context(pool, msg, targetTs);
      const v1History = await buildV1History(pool, evalCase.conversation_id, targetTs);
      const v1FewShot = await loadBenchmarkFewShotExamples(
        pool, evalCase.conversation_id, evalCase.property_id, targetTs
      );
      raw.v1_history_count  = v1History.length;
      raw.v1_fewshot_count  = v1FewShot.length;
      raw.v1_context_fp     = computeV1ContextFingerprint(msg.message, v1History, v1FewShot, v1Context);

      // ── V2 context ────────────────────────────────────────────────
      const v2Ctx = await buildTravelerContext(pool, evalCase.conversation_id, {
        atTimestamp: targetTs,
        baseUrl:     process.env.APP_URL || 'https://www.boostinghost.fr',
      });
      const v2FewShot = await loadBenchmarkFewShotExamples(
        pool, evalCase.conversation_id, evalCase.property_id, targetTs
      );
      v2Ctx._fewShot = v2FewShot;
      const v2SystemPrompt = buildTravelerSystemPrompt(v2Ctx);

      const v2HistRes = await pool.query(
        `SELECT sender_type, message FROM messages
         WHERE conversation_id = $1
         AND created_at < $2
         AND created_at > $2::timestamptz - INTERVAL '7 days'
         AND LENGTH(message) > 3
         AND message NOT ILIKE '%THIS RESERVATION HAS BEEN PRE-PAID%'
         AND message NOT ILIKE '%BOOKING NOTE%'
         ORDER BY created_at ASC LIMIT 30`,
        [evalCase.conversation_id, targetTs]
      );
      const v2History = v2HistRes.rows.map(m => ({
        role:    m.sender_type === 'guest' ? 'user' : 'assistant',
        content: m.message,
      }));
      raw.v2_history_count = v2History.length;
      raw.v2_fewshot_count = v2FewShot.length;
      raw.v2_context_fp    = computeContextFingerprint({
        guestMessage:    msg.message,
        history:         v2History,
        fewShot:         v2FewShot,
        travelerContext: v2Ctx,
        systemPrompt:    v2SystemPrompt,
      });

      console.log(`     contexts built — V1 fp=${raw.v1_context_fp} V2 fp=${raw.v2_context_fp}`);

      if (dryRun) {
        raw.v1_response = '[DRY_RUN_NO_CALL]';
        raw.v2_response = '[DRY_RUN_NO_CALL]';
        console.log(`     ✅ DRY-RUN: skipped Groq calls`);
      } else {
        // ── V1 call ──────────────────────────────────────────────
        console.log(`     🚀 V1...`);
        const v1Start = Date.now();
        try {
          const v1Response  = await getGroqResponse(msg.message, v1Context, v1History, v1FewShot, { now: targetTs });
          raw.v1_latency_ms = Date.now() - v1Start;
          groqCallCount++;
          const v1Valid = validateV1Response(v1Response);
          if (v1Valid.ok) {
            raw.v1_response = v1Response;
            console.log(`        V1 ✅ (${raw.v1_latency_ms}ms) ${v1Response.substring(0, 50)}`);
          } else {
            raw.v1_error = v1Valid.reason;
            console.warn(`        V1 ❌ ${v1Valid.reason}`);
          }
        } catch(e) {
          raw.v1_error      = e.message;
          raw.v1_latency_ms = Date.now() - v1Start;
          groqCallCount++;
          console.warn(`        V1 ❌ ${e.message}`);
        }

        // 2s inter-V1/V2 pause to reduce 429 risk (both use same Groq key)
        await new Promise(r => setTimeout(r, 2000));

        // ── V2 call ──────────────────────────────────────────────
        console.log(`     🚀 V2...`);
        const v2Result = await callGroqTravelerV2({
          systemPrompt: v2SystemPrompt,
          history:      v2History,
          guestMessage: msg.message,
          apiKey:       process.env.GROQ_API_KEY,
          model:        process.env.GROQ_MODEL_V2 || 'openai/gpt-oss-120b',
          label:        evalId,
        });
        raw.v2_response   = v2Result.decision;
        raw.v2_latency_ms = v2Result.latency_ms;
        raw.v2_error      = v2Result.error || null;
        groqCallCount++;
        if (v2Result.decision) {
          console.log(`        V2 ✅ (${v2Result.latency_ms}ms) action=${v2Result.decision.action}`);
        } else {
          console.warn(`        V2 ❌ ${v2Result.error}`);
        }

        // 3s inter-case pause
        if (i < devCases.length - 1) await new Promise(r => setTimeout(r, 3000));
      }

    } catch(err) {
      console.error(`     ❌ Error: ${err.message}`);
      raw.v1_error = raw.v2_error = err.message;
    }

    rawResults.push(raw);
    blindResults.push(buildBlindEntry({
      evalId,
      v1Label,
      v1Response: raw.v1_response,
      v2Response: raw.v2_response,
      category:   evalCase.category,
      fpV1:       raw.v1_context_fp,
      fpV2:       raw.v2_context_fp,
    }));
  }

  await pool.end();

  // Step 4.5 — Compute run validity before writing outputs
  let runValid = true;
  let _v1ok = 0, _v2ok = 0;
  if (!dryRun) {
    _v1ok = rawResults.filter(r => validateV1Response(r.v1_response).ok).length;
    _v2ok = rawResults.filter(r => r.v2_response && typeof r.v2_response === 'object' && !r.v2_error).length;
    runValid = computeRunValidity(rawResults.length, _v1ok, _v2ok);
  }

  // Step 5 — Write outputs
  console.log('\n── Step 5: Write output files');
  const prefix    = dryRun ? 'DRYRUN' : 'RUN';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const outDir    = path.join(__dirname, '..', 'benchmarks', 'runs', `${prefix}-${timestamp}`);
  fs.mkdirSync(outDir, { recursive: true });

  // BLIND.json — no model labels anywhere
  const blindOutput = {
    run_id:              `${prefix}-${timestamp}`,
    run_valid:           dryRun ? null : runValid,
    dry_run:             dryRun,
    generated_at:        new Date().toISOString(),
    dataset_fingerprint: dataset.dataset_fingerprint,
    total_cases:         blindResults.length,
    ab_salt:             AB_SALT,
    note: 'BLIND — model labels absent from this file. See KEY.json for the mapping.',
    cases: blindResults,
  };
  fs.writeFileSync(path.join(outDir, 'BLIND.json'), JSON.stringify(blindOutput, null, 2));

  // KEY.json — per-case model mapping
  const keyOutput = {
    run_id:       `${prefix}-${timestamp}`,
    generated_at: new Date().toISOString(),
    salt:         AB_SALT,
    note: 'KEEP CONFIDENTIAL until blind review is complete',
    global_label: KEY_INFO.global_label,
    per_case:     keyMapping,
  };
  fs.writeFileSync(path.join(outDir, 'KEY.json'), JSON.stringify(keyOutput, null, 2));

  // RAW.json — full diagnostic data
  const rawOutput = {
    run_id:          `${prefix}-${timestamp}`,
    run_valid:       dryRun ? null : runValid,
    dry_run:         dryRun,
    generated_at:    new Date().toISOString(),
    groq_call_count: groqCallCount,
    ab_assignments:  abAssignments,
    cases:           rawResults,
  };
  fs.writeFileSync(path.join(outDir, 'RAW.json'), JSON.stringify(rawOutput, null, 2));

  console.log(`   ✅ BLIND.json → ${path.join(outDir, 'BLIND.json')}`);
  console.log(`   ✅ KEY.json   → ${path.join(outDir, 'KEY.json')}`);
  console.log(`   ✅ RAW.json   → ${path.join(outDir, 'RAW.json')}`);

  // Summary
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  SUMMARY`);
  console.log(`  Processed: ${rawResults.length}/${devCases.length} cases`);
  console.log(`  V1 SYSTEM_A: ${countA}   V1 SYSTEM_B: ${countB}`);
  console.log(`  Groq calls:  ${groqCallCount}${dryRun ? ' (dry-run: none)' : ''}`);
  if (!dryRun) {
    console.log(`  V1 success:  ${_v1ok}/${rawResults.length}`);
    console.log(`  V2 success:  ${_v2ok}/${rawResults.length}`);
    console.log(`  EXPERIMENTAL_RESULT_VALID: ${runValid ? 'OUI' : 'NON'}`);
    if (!runValid) console.error('  ❌ Both V1 and V2 returned 0 successes — this run is invalid.');
  }
  console.log(`${'═'.repeat(70)}\n`);

  return { blindResults, rawResults, keyMapping, abAssignments, runValid };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args            = process.argv.slice(2);
  const dryRun          = args.includes('--dry-run');
  const devMode         = args.includes('--dev');
  const confirmRealRun  = args.includes('--confirm-real-run');

  if (!dryRun && !devMode) {
    console.log('Usage:');
    console.log('  node scripts/benchmark-traveler-v1-v2.js --dry-run');
    console.log('  node scripts/benchmark-traveler-v1-v2.js --dev --confirm-real-run');
    process.exit(0);
  }

  if (devMode && !confirmRealRun) {
    console.error('❌ --dev requires --confirm-real-run. This will make up to 50 Groq API calls.');
    process.exit(1);
  }

  runBenchmark({ dryRun: !devMode, confirmRealRun })
    .then(({ runValid }) => process.exit(runValid ? 0 : 1))
    .catch(err => {
      console.error('❌ Fatal:', err.message);
      process.exit(1);
    });
}

// ─── Exports (for tests) ─────────────────────────────────────────────────────

module.exports = {
  loadAndGuardDataset,
  computeABAssignment,
  buildV1Context,
  buildV1History,
  computeV1ContextFingerprint,
  buildBlindEntry,
  validateV1Response,
  computeRunValidity,
  runBenchmark,
  EXPECTED_FINGERPRINT,
  GOLDEN_IDS,
  REGRESSION_IDS,
  AB_SALT,
};
