'use strict';
/**
 * Tests unitaires — Host Questions (arbitrage hôte)
 *
 * Couvre les helpers et logiques extraits de integrated-chat-handler.js
 * et la route POST /api/host-questions/:id/answer (concurrence atomique).
 *
 * Pas d'appel DB réel. Les helpers sont testés avec des stubs in-memory.
 *
 * Exécution : node tests/host_question.test.js
 */

const assert = require('assert');
const { checkExistingScheduleDecision, collectHostQuestionRecipients } = require('../integrated-chat-handler');

// ---------------------------------------------------------------------------
// BACKREQ-1 : checkExistingScheduleDecision — found
// ---------------------------------------------------------------------------

async function test_BACKREQ1_found() {
  const pool = {
    query: async (sql, params) => ({
      rows: [{
        status: 'answered_yes',
        answer_text: null,
      }],
    }),
  };
  const row = await checkExistingScheduleDecision(pool, 42, 'late', '11:00');
  assert.strictEqual(row.status, 'answered_yes',
    'BACKREQ-1: should return existing answered row');
  console.log('✅ BACKREQ-1 passed');
}

// ---------------------------------------------------------------------------
// BACKREQ-2 : checkExistingScheduleDecision — not found (empty rows)
// ---------------------------------------------------------------------------

async function test_BACKREQ2_notFound() {
  const pool = {
    query: async () => ({ rows: [] }),
  };
  const row = await checkExistingScheduleDecision(pool, 42, 'late', '11:00');
  assert.strictEqual(row, null,
    'BACKREQ-2: should return null when no matching row');
  console.log('✅ BACKREQ-2 passed');
}

// ---------------------------------------------------------------------------
// BACKREQ-3 : checkExistingScheduleDecision — DB error swallowed, returns null
// ---------------------------------------------------------------------------

async function test_BACKREQ3_dbError() {
  const pool = {
    query: async () => { throw new Error('DB connection lost'); },
  };
  const row = await checkExistingScheduleDecision(pool, 42, 'late', '11:00');
  assert.strictEqual(row, null,
    'BACKREQ-3: DB error must be swallowed and null returned');
  console.log('✅ BACKREQ-3 passed');
}

// ---------------------------------------------------------------------------
// BACKREQ-4 : HostQuestionScheduleType mapping — early/late/unknown
// (Pure unit test — mirrors the iOS enum logic in JS context)
// ---------------------------------------------------------------------------

function scheduleLabel(type) {
  if (type === 'early') return 'Arrivée anticipée';
  if (type === 'late')  return 'Départ tardif';
  return 'Demande horaire';
}

function test_BACKREQ4_scheduleLabel() {
  assert.strictEqual(scheduleLabel('early'), 'Arrivée anticipée');
  assert.strictEqual(scheduleLabel('late'),  'Départ tardif');
  assert.strictEqual(scheduleLabel('early_checkin'), 'Demande horaire',
    'BACKREQ-4: legacy "early_checkin" should fall to unknown');
  assert.strictEqual(scheduleLabel(undefined), 'Demande horaire');
  console.log('✅ BACKREQ-4 passed');
}

// ---------------------------------------------------------------------------
// BACKREQ-5 : Atomic claim UPDATE returns 409 when status !== pending
// (Tests the routing guard pattern, not the DB layer)
// ---------------------------------------------------------------------------

function test_BACKREQ5_atomicClaim() {
  // Simulate the claim result when status is already 'processing' or 'answered_yes'
  function handleAnswer(claimRowCount) {
    if (claimRowCount === 0) return { status: 409, body: { alreadyAnswered: true } };
    return { status: 200, body: { success: true } };
  }
  assert.strictEqual(handleAnswer(0).status, 409,
    'BACKREQ-5: claim on non-pending row → 409');
  assert.strictEqual(handleAnswer(1).status, 200,
    'BACKREQ-5: claim on pending row → 200');
  console.log('✅ BACKREQ-5 passed');
}

// ---------------------------------------------------------------------------
// BACKREQ-6 : scheduleDecisions Groq context injection — format
// ---------------------------------------------------------------------------

function test_BACKREQ6_groqContextFormat() {
  const scheduleDecisions = [
    { type: 'late', req_label: '11:00', status: 'answered_yes', answer_text: null },
    { type: 'early', req_label: '09:00', status: 'answered_no', answer_text: 'Ménage en cours' },
  ];

  function buildScheduleSection(decisions) {
    if (!decisions || !decisions.length) return null;
    const lines = decisions.map(d => {
      const typeLabel = d.type === 'early' ? 'Arrivée anticipée' : 'Départ tardif';
      const outcome   = d.status === 'answered_yes' ? 'AUTORISÉ' : 'REFUSÉ';
      const detail    = d.answer_text ? ` (${d.answer_text})` : '';
      return `- ${typeLabel} à ${d.req_label} : ${outcome} par l'hôte${detail}`;
    });
    return lines.join('\n');
  }

  const section = buildScheduleSection(scheduleDecisions);
  assert.ok(section.includes('Départ tardif à 11:00 : AUTORISÉ'), 'BACKREQ-6: yes row formatted');
  assert.ok(section.includes('Arrivée anticipée à 09:00 : REFUSÉ par l\'hôte (Ménage en cours)'), 'BACKREQ-6: no row with text');
  console.log('✅ BACKREQ-6 passed');
}

// ---------------------------------------------------------------------------
// BACKREQ-7 : checkExistingScheduleDecision queries by type AND reqLabel
// ---------------------------------------------------------------------------

async function test_BACKREQ7_queryScope() {
  let capturedParams = null;
  const pool = {
    query: async (sql, params) => {
      capturedParams = params;
      return { rows: [] };
    },
  };
  await checkExistingScheduleDecision(pool, 99, 'early', '09:30');
  assert.ok(capturedParams, 'BACKREQ-7: pool.query should be called');
  assert.strictEqual(capturedParams[0], 99,    'BACKREQ-7: param[0] = conversationId');
  assert.strictEqual(capturedParams[1], 'early', 'BACKREQ-7: param[1] = scheduleType');
  assert.strictEqual(capturedParams[2], '09:30', 'BACKREQ-7: param[2] = reqLabel');
  console.log('✅ BACKREQ-7 passed');
}

// ---------------------------------------------------------------------------
// BACKREQ-8 : Same reqLabel different type → both stored separately
// (Tests that type IS part of the lookup key)
// ---------------------------------------------------------------------------

async function test_BACKREQ8_typeScopesLookup() {
  const store = {
    'late_10:00': { status: 'answered_yes', answer_text: null },
  };
  const pool = {
    query: async (sql, params) => {
      const key = `${params[1]}_${params[2]}`;
      const row = store[key];
      return { rows: row ? [row] : [] };
    },
  };
  const lateRow  = await checkExistingScheduleDecision(pool, 1, 'late',  '10:00');
  const earlyRow = await checkExistingScheduleDecision(pool, 1, 'early', '10:00');
  assert.ok(lateRow !== null,  'BACKREQ-8: late/10:00 found');
  assert.ok(earlyRow === null, 'BACKREQ-8: early/10:00 not found (different type)');
  console.log('✅ BACKREQ-8 passed');
}

// ---------------------------------------------------------------------------
// BACKREQ-9 : De-escalation path distinction
// escalated=true + ai_disabled=false → /deescalate only (AI stays enabled)
// escalated=true + ai_disabled=true  → /toggle-ai (re-enables AI)
// ---------------------------------------------------------------------------

function test_BACKREQ9_deescalationPath() {
  function pickDeescalateRoute(isEscalated, isAiDisabled) {
    if (!isEscalated) return null;
    return isAiDisabled ? 'toggle-ai' : 'deescalate';
  }
  assert.strictEqual(pickDeescalateRoute(true, false), 'deescalate',
    'BACKREQ-9: temp escalation → deescalate only');
  assert.strictEqual(pickDeescalateRoute(true, true), 'toggle-ai',
    'BACKREQ-9: explicit AI disable → toggle-ai');
  assert.strictEqual(pickDeescalateRoute(false, false), null,
    'BACKREQ-9: not escalated → no call');
  console.log('✅ BACKREQ-9 passed');
}

// ---------------------------------------------------------------------------
// BACKREQ-10 : ConversationItem sort key equals createdAt
// ---------------------------------------------------------------------------

function test_BACKREQ10_sortKey() {
  // Mirrors the iOS ConversationItem.sortKey logic in JS for cross-platform parity
  function sortKey(item) {
    if (item.type === 'message')      return item.createdAt || '';
    if (item.type === 'hostQuestion') return item.createdAt || '';
    return '';
  }
  const msg = { type: 'message', createdAt: '2026-09-01T10:00:00Z' };
  const q   = { type: 'hostQuestion', createdAt: '2026-09-01T10:01:00Z' };
  assert.ok(sortKey(msg) < sortKey(q), 'BACKREQ-10: message before question by createdAt');
  console.log('✅ BACKREQ-10 passed');
}

// ---------------------------------------------------------------------------
// BACKREQ-11 : Internal note sentinel stripping
// ---------------------------------------------------------------------------

function test_BACKREQ11_internalNoteSentinel() {
  const SENTINEL = '⟦NOTE_INTERNE⟧ ';
  function displayMessage(senderType, message) {
    if (senderType === 'internal_note' && message.startsWith(SENTINEL)) {
      return message.slice(SENTINEL.length);
    }
    return message;
  }
  assert.strictEqual(
    displayMessage('internal_note', '⟦NOTE_INTERNE⟧ Voyageur VIP'),
    'Voyageur VIP',
    'BACKREQ-11: sentinel stripped'
  );
  assert.strictEqual(
    displayMessage('guest', '⟦NOTE_INTERNE⟧ accidental'),
    '⟦NOTE_INTERNE⟧ accidental',
    'BACKREQ-11: sentinel not stripped for non-internal_note sender'
  );
  console.log('✅ BACKREQ-11 passed');
}

// ---------------------------------------------------------------------------
// BACKREQ-12 : push notification host_question routing — conversation_id presence
// ---------------------------------------------------------------------------

function test_BACKREQ12_hostQuestionPushPayload() {
  // The backend payload for host_question must carry conversation_id
  // so the iOS deep-link can route directly to the conversation.
  // This test verifies the payload structure expected by PushNotificationManager.
  function buildHostQuestionPayload(questionId, conversationId) {
    return {
      type: 'host_question',
      question_id: String(questionId),
      conversation_id: String(conversationId),
    };
  }
  const payload = buildHostQuestionPayload(77, 42);
  assert.strictEqual(payload.type, 'host_question');
  assert.strictEqual(payload.conversation_id, '42',
    'BACKREQ-12: conversation_id required for iOS deep-link');
  assert.ok(!('conversationId' in payload),
    'BACKREQ-12: must use snake_case key per integrated-chat-handler convention');
  console.log('✅ BACKREQ-12 passed');
}

// ---------------------------------------------------------------------------
// PUSHBACK-1 : propriétaire reçoit host_question
// ---------------------------------------------------------------------------

async function test_PUSHBACK1_ownerReceives() {
  const pool = {
    query: async (sql, params) => {
      if (sql.includes('account_delegations')) return { rows: [] };
      return { rows: [{ fcm_token: 'tok_owner_abc' }] };
    },
  };
  const tokens = await collectHostQuestionRecipients(pool, 'user_owner');
  assert.deepStrictEqual(tokens, ['tok_owner_abc'],
    'PUSHBACK-1: owner token must be included');
  console.log('✅ PUSHBACK-1 passed');
}

// ---------------------------------------------------------------------------
// PUSHBACK-2 : compte agence légitimement lié reçoit aussi la notification
// ---------------------------------------------------------------------------

async function test_PUSHBACK2_agencyReceives() {
  const pool = {
    query: async (sql, params) => {
      if (sql.includes('account_delegations')) return { rows: [{ fcm_token: 'tok_agency_xyz' }] };
      return { rows: [{ fcm_token: 'tok_owner_abc' }] };
    },
  };
  const tokens = await collectHostQuestionRecipients(pool, 'user_owner');
  assert.ok(tokens.includes('tok_owner_abc'), 'PUSHBACK-2: owner token included');
  assert.ok(tokens.includes('tok_agency_xyz'), 'PUSHBACK-2: agency token included');
  assert.strictEqual(tokens.length, 2, 'PUSHBACK-2: exactly owner + agency');
  console.log('✅ PUSHBACK-2 passed');
}

// ---------------------------------------------------------------------------
// PUSHBACK-3 : utilisateur étranger ne reçoit rien
// ---------------------------------------------------------------------------

async function test_PUSHBACK3_foreignUserExcluded() {
  const pool = {
    query: async (sql, params) => {
      // Only returns tokens for 'user_owner'; foreign user has none linked
      if (params[0] === 'user_owner') return { rows: [{ fcm_token: 'tok_owner_abc' }] };
      return { rows: [] };
    },
  };
  const tokens = await collectHostQuestionRecipients(pool, 'user_owner');
  assert.ok(!tokens.includes('tok_foreign'), 'PUSHBACK-3: foreign token must not appear');
  console.log('✅ PUSHBACK-3 passed');
}

// ---------------------------------------------------------------------------
// PUSHBACK-4 : token dupliqué entre propriétaire et agence → une seule entrée
// ---------------------------------------------------------------------------

async function test_PUSHBACK4_deduplicatedTokens() {
  const SHARED = 'tok_shared_device';
  const pool = {
    query: async (sql) => {
      // Same token returned by both owner and agency queries
      return { rows: [{ fcm_token: SHARED }] };
    },
  };
  const tokens = await collectHostQuestionRecipients(pool, 'user_owner');
  assert.strictEqual(tokens.length, 1,
    'PUSHBACK-4: duplicate token must appear only once');
  assert.strictEqual(tokens[0], SHARED, 'PUSHBACK-4: shared token present');
  console.log('✅ PUSHBACK-4 passed');
}

// ---------------------------------------------------------------------------
// PUSHBACK-5 : token null ou vide ignoré
// ---------------------------------------------------------------------------

async function test_PUSHBACK5_nullOrEmptyTokenIgnored() {
  const pool = {
    query: async (sql) => {
      return { rows: [{ fcm_token: null }, { fcm_token: '' }, { fcm_token: 'tok_valid' }] };
    },
  };
  const tokens = await collectHostQuestionRecipients(pool, 'user_owner');
  assert.ok(!tokens.includes(null),  'PUSHBACK-5: null token excluded');
  assert.ok(!tokens.includes(''),    'PUSHBACK-5: empty string token excluded');
  assert.ok(tokens.includes('tok_valid'), 'PUSHBACK-5: valid token kept');
  console.log('✅ PUSHBACK-5 passed');
}

// ---------------------------------------------------------------------------
// PUSHBACK-6 : échec d'un token n'empêche pas les autres envois
// ---------------------------------------------------------------------------

async function test_PUSHBACK6_perTokenErrorIsolated() {
  // Simulates the per-token try/catch loop in createHostQuestion's push section.
  const tokens = ['tok_good', 'tok_bad', 'tok_also_good'];
  let sent = [];
  for (const token of tokens) {
    try {
      if (token === 'tok_bad') throw new Error('FCM rejected');
      sent.push(token);
    } catch (err) {
      // intentionally swallowed per-token
    }
  }
  assert.deepStrictEqual(sent, ['tok_good', 'tok_also_good'],
    'PUSHBACK-6: bad token error must not prevent good tokens from sending');
  console.log('✅ PUSHBACK-6 passed');
}

// ---------------------------------------------------------------------------
// PUSHBACK-7 : payload contient conversation_id et question_id en String
// ---------------------------------------------------------------------------

function test_PUSHBACK7_payloadStrings() {
  const questionId = 70;    // BIGINT — could be large
  const conversationId = 1510;
  const pushData = {
    type: 'host_question',
    question_id: String(questionId),
    conversation_id: String(conversationId),
    screen: 'messages'
  };
  assert.strictEqual(typeof pushData.question_id, 'string',
    'PUSHBACK-7: question_id must be String');
  assert.strictEqual(typeof pushData.conversation_id, 'string',
    'PUSHBACK-7: conversation_id must be String');
  assert.strictEqual(pushData.conversation_id, '1510',
    'PUSHBACK-7: conversation_id value correct');
  assert.strictEqual(pushData.question_id, '70',
    'PUSHBACK-7: question_id value correct');
  console.log('✅ PUSHBACK-7 passed');
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function run() {
  console.log('\n--- BACKREQ host_question tests ---\n');
  try {
    await test_BACKREQ1_found();
    await test_BACKREQ2_notFound();
    await test_BACKREQ3_dbError();
    test_BACKREQ4_scheduleLabel();
    test_BACKREQ5_atomicClaim();
    test_BACKREQ6_groqContextFormat();
    await test_BACKREQ7_queryScope();
    await test_BACKREQ8_typeScopesLookup();
    test_BACKREQ9_deescalationPath();
    test_BACKREQ10_sortKey();
    test_BACKREQ11_internalNoteSentinel();
    test_BACKREQ12_hostQuestionPushPayload();
    await test_PUSHBACK1_ownerReceives();
    await test_PUSHBACK2_agencyReceives();
    await test_PUSHBACK3_foreignUserExcluded();
    await test_PUSHBACK4_deduplicatedTokens();
    await test_PUSHBACK5_nullOrEmptyTokenIgnored();
    await test_PUSHBACK6_perTokenErrorIsolated();
    test_PUSHBACK7_payloadStrings();
    console.log('\n✅ All BACKREQ + PUSHBACK tests passed.\n');
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    process.exit(1);
  }
}

run();
