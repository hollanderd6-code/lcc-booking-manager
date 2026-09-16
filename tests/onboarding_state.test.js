'use strict';
/**
 * Tests unitaires — Onboarding state machine
 *
 * Couvre B1–B11 (helpers serveur) et S1–S8 (nextRelevantStep).
 * Exécution : node tests/onboarding_state.test.js
 */

const assert = require('assert');

// ─── Copie exacte des helpers server.js ──────────────────────────────────────

function resolveOnboardingInjection(userCreatedAt, deployEpochMs) {
  const epochValid = typeof deployEpochMs === 'number'
    && !isNaN(deployEpochMs)
    && deployEpochMs > 0;
  if (!epochValid) return { status: 'completed', completedAt: null };
  const userMs = userCreatedAt ? new Date(userCreatedAt).getTime() : 0;
  const isExisting = userMs < deployEpochMs;
  return { status: isExisting ? 'completed' : 'notStarted', completedAt: null };
}

const ONBOARDING_STATUS_ORDER = { notStarted: 0, inProgress: 1, skipped: 2, completed: 3 };
function mergeOnboardingStatus(newStatus, currentStatus) {
  const nr = ONBOARDING_STATUS_ORDER[newStatus]    ?? -1;
  const cr = ONBOARDING_STATUS_ORDER[currentStatus] ?? 0;
  return nr >= cr ? newStatus : currentStatus;
}

function validateOnboardingPatch(ob) {
  if (!ob || typeof ob !== 'object' || Array.isArray(ob)) {
    return { error: 'onboarding doit être un objet' };
  }
  const validStatuses = ['notStarted', 'inProgress', 'skipped', 'completed'];
  if (!validStatuses.includes(ob.status)) {
    return { error: 'onboarding.status invalide' };
  }
  if (ob.completedAt !== null && ob.completedAt !== undefined) {
    if (typeof ob.completedAt !== 'string' || isNaN(Date.parse(ob.completedAt))) {
      return { error: 'onboarding.completedAt doit être null ou une date ISO valide' };
    }
  }
  return { clean: { status: ob.status, completedAt: ob.completedAt ?? null } };
}

// Simule le comportement du GET route pour l'injection onboarding
// (sans base de données — logique pure testable)
function simulateGetPreferences(rawPrefs, userCreatedAt, deployEpochMs) {
  const raw = rawPrefs ? { ...rawPrefs } : {};
  if (raw.onboarding === undefined || raw.onboarding === null) {
    raw.onboarding = resolveOnboardingInjection(userCreatedAt, deployEpochMs);
  }
  return raw;
}

// ─── Machine d'état nextRelevantStep (miroir JS de la fonction Swift) ─────────

const STEP_ORDER = ['property', 'platforms', 'messages', 'cleaning', 'team', 'payments', 'welcomeBook'];

function nextRelevantStep(steps, current = null, deferred = new Set()) {
  const startIdx = current !== null ? STEP_ORDER.indexOf(current) + 1 : 0;
  for (let i = startIdx; i < STEP_ORDER.length; i++) {
    const stepId = STEP_ORDER[i];
    if (deferred.has(stepId)) continue;
    const step = steps.find(s => s.stepID === stepId);
    if (!step) continue;
    if (step.state === 'pending') return stepId;
  }
  return null;
}

// ─── Helpers test ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`  ✅ ${label}`);
    passed++;
  } catch (e) {
    console.error(`  ❌ ${label}`);
    console.error(`     ${e.message}`);
    failed++;
  }
}

// ─── Série B — helpers serveur ────────────────────────────────────────────────

const EPOCH = new Date('2026-10-01T00:00:00Z').getTime();  // epoch de déploiement fictive
const OLD_ACCOUNT_DATE  = '2026-01-15T10:00:00Z';          // avant l'epoch
const NEW_ACCOUNT_DATE  = '2026-10-15T10:00:00Z';          // après l'epoch

console.log('\n── B: helpers serveur ──');

// B1 — ancien compte + onboarding absent + epoch valide → completed
test('B1 — ancien compte + epoch valide → completed', () => {
  const result = simulateGetPreferences(null, OLD_ACCOUNT_DATE, EPOCH);
  assert.strictEqual(result.onboarding.status, 'completed');
  // B11 — completedAt doit être null pour les comptes historiques migrés
  assert.strictEqual(result.onboarding.completedAt, null, 'completedAt doit être null pour comptes historiques');
});

// B2 — nouveau compte + onboarding absent + epoch valide → notStarted
test('B2 — nouveau compte + epoch valide → notStarted', () => {
  const result = simulateGetPreferences(null, NEW_ACCOUNT_DATE, EPOCH);
  assert.strictEqual(result.onboarding.status, 'notStarted');
  assert.strictEqual(result.onboarding.completedAt, null);
});

// B3 — onboarding skipped existant → reste skipped (pas écrasé)
test('B3 — onboarding skipped existant → respecté', () => {
  const existingPrefs = { onboarding: { status: 'skipped', completedAt: null } };
  const result = simulateGetPreferences(existingPrefs, NEW_ACCOUNT_DATE, EPOCH);
  assert.strictEqual(result.onboarding.status, 'skipped');
});

// B4 — onboarding completed existant → reste completed
test('B4 — onboarding completed existant → respecté', () => {
  const existingPrefs = { onboarding: { status: 'completed', completedAt: '2026-10-20T12:00:00Z' } };
  const result = simulateGetPreferences(existingPrefs, NEW_ACCOUNT_DATE, EPOCH);
  assert.strictEqual(result.onboarding.status, 'completed');
  assert.strictEqual(result.onboarding.completedAt, '2026-10-20T12:00:00Z');
});

// B5 — PUT status invalide → erreur 400
test('B5 — PUT status invalide → erreur', () => {
  const v = validateOnboardingPatch({ status: 'invalid_status', completedAt: null });
  assert.ok(v.error, 'doit retourner une erreur');
  assert.ok(v.error.includes('status'), `erreur doit mentionner "status" : ${v.error}`);
});

// B6 — PUT onboarding non-object → erreur 400
test('B6 — PUT onboarding non-object (array) → erreur', () => {
  const v = validateOnboardingPatch(['status', 'completed']);
  assert.ok(v.error, 'doit retourner une erreur');
});

test('B6b — PUT onboarding string → erreur', () => {
  const v = validateOnboardingPatch('completed');
  assert.ok(v.error);
});

// B7 — PUT completedAt invalide → erreur 400
test('B7 — PUT completedAt non-ISO → erreur', () => {
  const v = validateOnboardingPatch({ status: 'completed', completedAt: 'pas-une-date' });
  assert.ok(v.error, 'doit retourner une erreur');
  assert.ok(v.error.includes('completedAt'));
});

test('B7b — PUT completedAt null → valide', () => {
  const v = validateOnboardingPatch({ status: 'completed', completedAt: null });
  assert.ok(!v.error, `ne doit pas avoir d'erreur : ${v.error}`);
  assert.strictEqual(v.clean.completedAt, null);
});

test('B7c — PUT completedAt ISO valide → valide', () => {
  const v = validateOnboardingPatch({ status: 'completed', completedAt: '2026-10-20T12:00:00Z' });
  assert.ok(!v.error);
  assert.strictEqual(v.clean.completedAt, '2026-10-20T12:00:00Z');
});

// B8 — PUT onboarding ne doit pas effacer setupCardDismissed
// (le JSONB || opérateur préserve les clés non incluses dans le patch)
test('B8 — merge JSONB préserve setupCardDismissed', () => {
  // Simule la logique du serveur : clean ne contient QUE les champs patchés
  const existingPrefs = { setupCardDismissed: true, setupStepsNotApplicable: [], onboarding: { status: 'notStarted', completedAt: null } };
  const patchClean = { onboarding: { status: 'inProgress', completedAt: null } };
  // Simule JSONB ||
  const merged = { ...existingPrefs, ...patchClean };
  assert.strictEqual(merged.setupCardDismissed, true, 'setupCardDismissed doit être préservé');
});

// B9 — PUT onboarding ne doit pas effacer setupStepsNotApplicable
test('B9 — merge JSONB préserve setupStepsNotApplicable', () => {
  const existingPrefs = { setupCardDismissed: false, setupStepsNotApplicable: ['cleaning', 'team'], onboarding: { status: 'notStarted', completedAt: null } };
  const patchClean = { onboarding: { status: 'completed', completedAt: '2026-10-20T12:00:00Z' } };
  const merged = { ...existingPrefs, ...patchClean };
  assert.deepStrictEqual(merged.setupStepsNotApplicable, ['cleaning', 'team'], 'setupStepsNotApplicable doit être préservé');
});

// B10 — epoch absente/invalide → comportement fail-closed (completed pour tous)
test('B10a — epoch absente (undefined) → fail-closed → completed', () => {
  const result = resolveOnboardingInjection(NEW_ACCOUNT_DATE, NaN);
  assert.strictEqual(result.status, 'completed', 'fail-closed : epoch absente → completed');
});

test('B10b — epoch = 0 → fail-closed → completed', () => {
  const result = resolveOnboardingInjection(NEW_ACCOUNT_DATE, 0);
  assert.strictEqual(result.status, 'completed');
});

test('B10c — epoch = "texte" → fail-closed → completed', () => {
  const result = resolveOnboardingInjection(NEW_ACCOUNT_DATE, parseInt('texte', 10));
  assert.strictEqual(result.status, 'completed');
});

// B11 — compte historique → completedAt == null
test('B11 — compte historique injecté → completedAt null', () => {
  const result = resolveOnboardingInjection(OLD_ACCOUNT_DATE, EPOCH);
  assert.strictEqual(result.status, 'completed');
  assert.strictEqual(result.completedAt, null, 'les comptes historiques ne doivent pas avoir de completedAt');
});

// ─── Règle de monotonie ────────────────────────────────────────────────────────

console.log('\n── Monotonie ──');

test('M1 — completed ne régresse pas vers skipped', () => {
  assert.strictEqual(mergeOnboardingStatus('skipped', 'completed'), 'completed');
});

test('M2 — completed ne régresse pas vers notStarted', () => {
  assert.strictEqual(mergeOnboardingStatus('notStarted', 'completed'), 'completed');
});

test('M3 — skipped ne régresse pas vers inProgress', () => {
  assert.strictEqual(mergeOnboardingStatus('inProgress', 'skipped'), 'skipped');
});

test('M4 — completed → completed (idempotent)', () => {
  assert.strictEqual(mergeOnboardingStatus('completed', 'completed'), 'completed');
});

test('M5 — inProgress → avance vers skipped', () => {
  assert.strictEqual(mergeOnboardingStatus('skipped', 'inProgress'), 'skipped');
});

test('M6 — notStarted → avance vers inProgress', () => {
  assert.strictEqual(mergeOnboardingStatus('inProgress', 'notStarted'), 'inProgress');
});

// ─── Série S — machine d'état nextRelevantStep ────────────────────────────────

console.log('\n── S: nextRelevantStep ──');

const makeStep = (stepID, state) => ({ stepID, state });

// S1 — étape pending → sélectionnée
test('S1 — property pending → retourné', () => {
  const steps = [makeStep('property', 'pending')];
  assert.strictEqual(nextRelevantStep(steps), 'property');
});

// S2 — étape completed → ignorée
test('S2 — property completed → ignoré, nil retourné (seule étape)', () => {
  const steps = [makeStep('property', 'completed')];
  assert.strictEqual(nextRelevantStep(steps), null);
});

// S3 — étape notApplicable → ignorée
test('S3 — platforms notApplicable → ignoré', () => {
  const steps = [
    makeStep('property',  'completed'),
    makeStep('platforms', 'notApplicable'),
  ];
  assert.strictEqual(nextRelevantStep(steps), null);
});

// S4 — étape locked → ignorée
test('S4 — payments locked → ignoré', () => {
  const steps = [
    makeStep('property', 'completed'),
    makeStep('payments', 'locked'),
  ];
  assert.strictEqual(nextRelevantStep(steps), null);
});

// S5 — étape dans deferredSteps → ignorée pendant la session
test('S5 — messages deferred → ignoré', () => {
  const steps = [
    makeStep('property',  'completed'),
    makeStep('messages',  'pending'),
    makeStep('platforms', 'pending'),
  ];
  const deferred = new Set(['messages']);
  // platforms vient avant messages dans l'ordre → sera sélectionné
  // mais on commence depuis le début ici
  const result = nextRelevantStep(steps, null, deferred);
  assert.strictEqual(result, 'platforms', 'platforms pending doit être sélectionné car messages est deferred');
});

// S6 — deferredSteps réinitialisé → redevient sélectionnable
test('S6 — deferred reset → messages redevient sélectionnable', () => {
  const steps = [
    makeStep('property', 'completed'),
    makeStep('messages', 'pending'),
  ];
  // Sans deferred
  assert.strictEqual(nextRelevantStep(steps, null, new Set()), 'messages');
});

// S7 — toutes les étapes traitées → null
test('S7 — toutes completed/notApplicable → null', () => {
  const steps = STEP_ORDER.map(id => makeStep(id, id === 'cleaning' ? 'notApplicable' : 'completed'));
  assert.strictEqual(nextRelevantStep(steps), null);
});

// S8 — property pending + toutes autres locked → property
test('S8 — property pending, autres locked → property sélectionné', () => {
  const steps = [
    makeStep('property',    'pending'),
    makeStep('platforms',   'locked'),
    makeStep('messages',    'locked'),
    makeStep('cleaning',    'locked'),
    makeStep('team',        'locked'),
    makeStep('payments',    'locked'),
    makeStep('welcomeBook', 'locked'),
  ];
  assert.strictEqual(nextRelevantStep(steps), 'property');
});

// ─── Série F — flow conditionnel Phase 5.3 ───────────────────────────────────

console.log('\n── F: flow conditionnel (Phase 5.3) ──');

// F1 — property pending → retourné comme premier step
test('F1 — property pending → property', () => {
  const steps = STEP_ORDER.map(id =>
    makeStep(id, id === 'property' ? 'pending' : 'locked')
  );
  assert.strictEqual(nextRelevantStep(steps), 'property');
});

// F2 — property completed + platforms pending → platforms
test('F2 — property completed + platforms pending → platforms', () => {
  const steps = [
    makeStep('property',  'completed'),
    makeStep('platforms', 'pending'),
    makeStep('messages',  'locked'),
    makeStep('cleaning',  'locked'),
    makeStep('team',      'locked'),
    makeStep('payments',  'locked'),
    makeStep('welcomeBook', 'locked'),
  ];
  assert.strictEqual(nextRelevantStep(steps), 'platforms');
});

// F3 — completed + notApplicable → null (flow terminé)
test('F3 — completed + notApplicable → null', () => {
  const steps = [
    makeStep('property',    'completed'),
    makeStep('platforms',   'notApplicable'),
    makeStep('messages',    'completed'),
    makeStep('cleaning',    'notApplicable'),
    makeStep('team',        'notApplicable'),
    makeStep('payments',    'completed'),
    makeStep('welcomeBook', 'completed'),
  ];
  assert.strictEqual(nextRelevantStep(steps), null);
});

// F4 — étape deferred → ignorée pendant la session
test('F4 — platforms deferred → ignoré', () => {
  const steps = [
    makeStep('property',  'completed'),
    makeStep('platforms', 'pending'),
    makeStep('messages',  'pending'),
  ];
  const deferred = new Set(['platforms']);
  assert.strictEqual(nextRelevantStep(steps, null, deferred), 'messages');
});

// F5 — toutes étapes pending mais toutes deferred → null
test('F5 — toutes deferred → null (fin de session)', () => {
  const steps = STEP_ORDER.map(id => makeStep(id, 'pending'));
  const deferred = new Set(STEP_ORDER);
  assert.strictEqual(nextRelevantStep(steps, null, deferred), null);
});

// F6 — reset deferredSteps → étapes redeviennent candidates
test('F6 — deferred reset → redeviennent candidates', () => {
  const steps = [
    makeStep('property',  'completed'),
    makeStep('platforms', 'pending'),
    makeStep('messages',  'pending'),
  ];
  const withDeferred    = nextRelevantStep(steps, null, new Set(['platforms', 'messages']));
  const afterReset      = nextRelevantStep(steps, null, new Set());
  assert.strictEqual(withDeferred, null,       'toutes deferred → null');
  assert.strictEqual(afterReset,   'platforms', 'après reset → platforms sélectionnable');
});

// F7 — start(at: pending step) en mode manuel → step affiché
// (côté JS : nextRelevantStep avec step donné directement en current=null mais ici on teste
//  qu'un step pending est bien retourné si on cherche à partir de null)
test('F7 — targeted step pending → inclus', () => {
  const steps = [
    makeStep('property',  'completed'),
    makeStep('messages',  'pending'),
  ];
  // start(at: .messages) — on cherche depuis null mais step précis :
  // simule un check "ce step est-il pending ?"
  const state = steps.find(s => s.stepID === 'messages')?.state;
  assert.strictEqual(state, 'pending', 'step targeted doit être pending');
});

// F8 — start(at: completed step) en mode manuel explicite → affiché quand même
// (côté JS : le state est completed mais en mode manuel on passe quand même)
// On teste ici que la logique de sélection ordinaire SKIPERAIT ce step,
// confirmant que start(at:) doit bypasser nextRelevantStep.
test('F8 — targeted completed via start(at) bypasse nextRelevantStep', () => {
  const steps = [
    makeStep('property',  'completed'),
    makeStep('messages',  'completed'),
  ];
  // nextRelevantStep skippe normalement les completed
  const auto = nextRelevantStep(steps);
  assert.strictEqual(auto, null, 'flow auto skiperait — correct');
  // start(at:) peut forcer l'affichage côté coordinateur (hors JS)
  // Ce test confirme que la logique JS seule ne suffit pas → il faut start(at:)
});

// F9 — step completed → ignoré en flow automatique
test('F9 — automatic completed → skippé', () => {
  const steps = [
    makeStep('property', 'completed'),
    makeStep('messages', 'pending'),
  ];
  assert.strictEqual(nextRelevantStep(steps), 'messages');
  // property est bien skippé
  assert.notStrictEqual(nextRelevantStep(steps), 'property');
});

// F10 — locked → ignoré
test('F10 — locked → skippé', () => {
  const steps = [
    makeStep('property',  'completed'),
    makeStep('platforms', 'locked'),
    makeStep('messages',  'pending'),
  ];
  assert.strictEqual(nextRelevantStep(steps), 'messages');
});

// F11 — retour écran métier, step toujours pending → defer pour session → advance
// Simule le comportement de handleReturn : après silentRefresh, step reste pending → defer
test('F11 — retour pending → step deferred → next sélectionné', () => {
  const steps = [
    makeStep('property',  'completed'),
    makeStep('messages',  'pending'),
    makeStep('cleaning',  'pending'),
  ];
  // handleReturn: step toujours pending → coordinator.defer_(messages)
  const deferred = new Set(['messages']);
  const next = nextRelevantStep(steps, 'messages', deferred);
  assert.strictEqual(next, 'cleaning', 'après defer messages → cleaning sélectionné');
});

// F12 — retour écran métier, step completed → advance direct
test('F12 — retour completed → advance vers cleaning', () => {
  const stepsAfterReturn = [
    makeStep('property',  'completed'),
    makeStep('messages',  'completed'), // vient d'être complété
    makeStep('cleaning',  'pending'),
  ];
  const next = nextRelevantStep(stepsAfterReturn, 'messages', new Set());
  assert.strictEqual(next, 'cleaning');
});

// F13 — NA successful → advance vers étape suivante
test('F13 — NA platforms → advance vers messages', () => {
  const stepsAfterNA = [
    makeStep('property',  'completed'),
    makeStep('platforms', 'notApplicable'), // vient d'être marqué NA
    makeStep('messages',  'pending'),
  ];
  const next = nextRelevantStep(stepsAfterNA, 'platforms', new Set());
  assert.strictEqual(next, 'messages');
});

// F14 — NA échoue (simule erreur réseau) → step reste current, pas d'avancée
// (côté serveur : aucun changement → côté JS : step reste pending, nextRelevantStep le retourne)
test('F14 — NA échoué → step reste pending', () => {
  const stepsUnchanged = [
    makeStep('property',  'completed'),
    makeStep('platforms', 'pending'), // échec NA → reste pending
    makeStep('messages',  'pending'),
  ];
  const next = nextRelevantStep(stepsUnchanged, null, new Set());
  assert.strictEqual(next, 'platforms', 'platforms toujours sélectionné après échec NA');
});

// F15 — toutes les étapes completed → null immédiatement (écran final)
test('F15 — toutes completed → null (écran Vous êtes prêt)', () => {
  const steps = STEP_ORDER.map(id => makeStep(id, 'completed'));
  assert.strictEqual(nextRelevantStep(steps), null);
});

// ─── Résultat ─────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests — ${passed} ✅  ${failed} ❌`);
if (failed > 0) process.exit(1);
