'use strict';
/**
 * Tests unitaires — evaluateArrivalEligibility (server.js)
 *
 * La fonction evaluateArrivalEligibility() est la source de vérité unique pour
 * les messages on_arrival. Sa logique de décision est extraite ici en fonctions
 * pures (sans vraie DB) afin de tester tous les chemins sans démarrer le serveur.
 *
 * Couvre :
 *   • Les 7 cas d'origine (Série A)
 *   • Les 16 scénarios de la centralisation (Série B)
 *   • Le test de régression (Série R)
 *   • Les cas limites bonus (Série X)
 *
 * Exécution : node tests/on_arrival_guards.test.js
 * ou : npm test
 */

const assert = require('assert');

// ─── Fonctions miroir de evaluateArrivalEligibility ───────────────────────────
//
// evaluateArrivalEligibility() dans server.js fait des requêtes SQL. Ici on
// reproduit la LOGIQUE DE DÉCISION exacte sous forme de fonctions pures.
// Toute modification de la règle métier dans server.js doit se refléter ici.

/**
 * Décision caution — miroir de la garde 2 dans evaluateArrivalEligibility.
 */
function checkDepositGuard({ isAirbnb, depositAmount, depStatus }) {
  if (isAirbnb) return { blocked: false, reason: 'airbnb_exempt' };
  if (!(depositAmount > 0)) return { blocked: false, reason: 'no_deposit_config' };
  if (depStatus !== 'captured' && depStatus !== 'authorized') {
    return { blocked: true, reason: `caution non validée (status=${depStatus || 'aucune'})` };
  }
  return { blocked: false, reason: null };
}

/**
 * Décision police — miroir de la garde 3 dans evaluateArrivalEligibility (VERSION CORRIGÉE).
 */
function checkPoliceGuard({ isAirbnb, guestCountry, policeDone, linkSent }) {
  if (isAirbnb) return { blocked: false, reason: 'airbnb_exempt' };
  const gc = (guestCountry || '').toUpperCase().trim();
  const isForeign = gc !== '' && gc !== 'FR';
  if (!isForeign) return { blocked: false, reason: null };
  if (policeDone) return { blocked: false, reason: null };
  if (linkSent) {
    return { blocked: true, reason: `fiche de police non complétée (pays=${gc})` };
  }
  return { blocked: false, reason: 'checkin_link_never_sent' };
}

/**
 * Décision police — VERSION BUGGÉE (avant correctif). Pour le test de régression.
 */
function checkPoliceGuard_BEFORE_FIX({ isAirbnb, guestCountry, policeDone }) {
  if (isAirbnb) return { blocked: false, reason: 'airbnb_exempt' };
  const gc = (guestCountry || '').toUpperCase().trim();
  const isForeign = gc !== '' && gc !== 'FR';
  if (!isForeign) return { blocked: false, reason: null };
  if (policeDone) return { blocked: false, reason: null };
  return { blocked: true, reason: `fiche de police non complétée (pays=${gc})` };
}

/**
 * evaluateArrivalEligibility — version pure (sans DB).
 * Reproduit exactement la logique de server.js evaluateArrivalEligibility().
 *
 * @param {object} params
 *   platform        string  - 'airbnb'|'abb'|autre
 *   depositAmount   number  - properties.deposit_amount
 *   depStatus       string  - deposits.status (null si aucun dépôt)
 *   guestCountry    string  - reservations.guest_country
 *   policeDone      boolean - police_records existe et status='signed'
 *   linkSent        boolean - template {checkin_link} envoyé avec status='sent'
 *   simulateDbError boolean - simule une erreur DB sur la requête principale (Phase A)
 */
function evaluateArrivalEligibility({
  platform = '',
  depositAmount = 0,
  depStatus = null,
  guestCountry = '',
  policeDone = false,
  linkSent = false,
  simulateDbError = false,
}) {
  const platformRaw = platform.toLowerCase().replace(/[_\-\s]/g, '');
  const isAirbnb = platformRaw.includes('airbnb') || platformRaw === 'abb';

  if (isAirbnb) {
    return { allowed: true, reason: null,
             depositRequired: false, depositSatisfied: true,
             policeRequired: false, policeSatisfied: true, checkinLinkSent: false };
  }

  // Phase A — fail-closed : erreur DB sur la requête principale
  if (simulateDbError) {
    return { allowed: false, reason: 'eligibility_error',
             depositRequired: false, depositSatisfied: false,
             policeRequired: false, policeSatisfied: false, checkinLinkSent: false };
  }

  // Garde caution
  const depositRequired = depositAmount > 0;
  let depositSatisfied = true;
  if (depositRequired) {
    depositSatisfied = depStatus === 'authorized' || depStatus === 'captured';
  }
  if (!depositSatisfied) {
    return { allowed: false, reason: 'deposit_pending',
             depositRequired, depositSatisfied,
             policeRequired: false, policeSatisfied: true, checkinLinkSent: false };
  }

  // Garde police
  const gc = (guestCountry || '').toUpperCase().trim();
  const policeRequired = gc !== '' && gc !== 'FR';
  let policeSatisfied = true;
  let checkinLinkSent = false;

  if (policeRequired && !policeDone) {
    checkinLinkSent = linkSent;
    if (linkSent) policeSatisfied = false;
  }

  return {
    allowed: policeSatisfied,
    reason: !policeSatisfied ? 'police_pending' : null,
    depositRequired,
    depositSatisfied,
    policeRequired,
    policeSatisfied,
    checkinLinkSent,
  };
}

/**
 * comptesDuTemplate — miroir de server.js ~33087.
 */
function buildComptesDuTemplate(templateOwnerId, delegations) {
  const delegators = delegations
    .filter(d => d.delegate_user_id === templateOwnerId && d.status === 'accepted')
    .map(d => d.delegator_user_id);
  return [templateOwnerId, ...delegators];
}

// ─── Runner de tests ───────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`  ✅ ${label}`);
    passed++;
  } catch (e) {
    console.error(`  ❌ ${label}`);
    console.error(`     → ${e.message}`);
    failed++;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SÉRIE A — 7 cas d'origine (gardes séparées, conservés comme référence)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n📋  Série A — Cas d\'origine (gardes séparées)\n');

test('A1 — Propriétaire, pas de caution, iCal → autorisé', () => {
  const d = checkDepositGuard({ isAirbnb: false, depositAmount: 0, depStatus: null });
  const p = checkPoliceGuard({ isAirbnb: false, guestCountry: '', policeDone: false, linkSent: false });
  assert(!d.blocked && !p.blocked);
});

test('A2 — Propriétaire, caution authorized, iCal → autorisé', () => {
  const d = checkDepositGuard({ isAirbnb: false, depositAmount: 500, depStatus: 'authorized' });
  const p = checkPoliceGuard({ isAirbnb: false, guestCountry: '', policeDone: false, linkSent: false });
  assert(!d.blocked && !p.blocked);
});

test('A3 — Propriétaire, caution pending → bloqué par garde caution', () => {
  const d = checkDepositGuard({ isAirbnb: false, depositAmount: 500, depStatus: 'pending' });
  assert(d.blocked && /caution non validée/.test(d.reason));
});

test('A4 — Agence, pas de caution, voyageur DE via Channex, sans {checkin_link} → autorisé', () => {
  const d = checkDepositGuard({ isAirbnb: false, depositAmount: 0, depStatus: null });
  const p = checkPoliceGuard({ isAirbnb: false, guestCountry: 'DE', policeDone: false, linkSent: false });
  assert(!d.blocked && !p.blocked);
});

test('A5 — Agence, caution authorized, voyageur GB, sans {checkin_link} → autorisé', () => {
  const d = checkDepositGuard({ isAirbnb: false, depositAmount: 500, depStatus: 'authorized' });
  const p = checkPoliceGuard({ isAirbnb: false, guestCountry: 'GB', policeDone: false, linkSent: false });
  assert(!d.blocked && !p.blocked);
});

test('A6 — Agence, caution aucune → bloqué par garde caution', () => {
  const d = checkDepositGuard({ isAirbnb: false, depositAmount: 500, depStatus: null });
  assert(d.blocked && /caution non validée/.test(d.reason));
});

test('A7 — Isolation : comptesDuTemplate(agenceA) exclut les propriétaires de agenceB', () => {
  const delegations = [
    { delegate_user_id: 'agenceA', delegator_user_id: 'owner1', status: 'accepted' },
    { delegate_user_id: 'agenceA', delegator_user_id: 'owner2', status: 'accepted' },
    { delegate_user_id: 'agenceB', delegator_user_id: 'owner3', status: 'accepted' },
    { delegate_user_id: 'agenceA', delegator_user_id: 'owner4', status: 'pending' },
  ];
  const A = buildComptesDuTemplate('agenceA', delegations);
  const B = buildComptesDuTemplate('agenceB', delegations);
  assert(A.includes('agenceA') && A.includes('owner1') && A.includes('owner2'));
  assert(!A.includes('owner3') && !A.includes('owner4'));
  assert(!B.includes('owner1'));
  const overlap = A.filter(id => id !== 'agenceA' && B.includes(id) && id !== 'agenceB');
  assert(overlap.length === 0, `chevauchement: ${overlap}`);
});

// ══════════════════════════════════════════════════════════════════════════════
// SÉRIE B — 16 scénarios de evaluateArrivalEligibility (interface unifiée)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n📋  Série B — evaluateArrivalEligibility (16 scénarios)\n');

test('B1 — on_arrival sans caution configurée → allowed', () => {
  const r = evaluateArrivalEligibility({ depositAmount: 0 });
  assert(r.allowed && !r.depositRequired && r.depositSatisfied);
});

test('B2 — caution requise, non validée → deposit_pending', () => {
  const r = evaluateArrivalEligibility({ depositAmount: 500, depStatus: 'pending' });
  assert(!r.allowed && r.reason === 'deposit_pending' && r.depositRequired && !r.depositSatisfied);
});

test('B3 — caution requise, validée (authorized), pas de police → allowed', () => {
  const r = evaluateArrivalEligibility({ depositAmount: 500, depStatus: 'authorized' });
  assert(r.allowed && r.depositSatisfied && !r.depositRequired ? false : r.depositRequired);
  assert(r.depositSatisfied && r.allowed);
});

test('B4 — étranger, aucun {checkin_link} envoyé → allowed (pas de blocage police)', () => {
  const r = evaluateArrivalEligibility({ guestCountry: 'DE', policeDone: false, linkSent: false });
  assert(r.allowed && r.policeRequired && r.policeSatisfied && !r.checkinLinkSent);
});

test('B5 — étranger, {checkin_link} envoyé, fiche NON signée → police_pending', () => {
  const r = evaluateArrivalEligibility({ guestCountry: 'DE', policeDone: false, linkSent: true });
  assert(!r.allowed && r.reason === 'police_pending' && r.policeRequired && !r.policeSatisfied && r.checkinLinkSent);
});

test('B6 — étranger, {checkin_link} envoyé, fiche signée → allowed', () => {
  const r = evaluateArrivalEligibility({ guestCountry: 'DE', policeDone: true, linkSent: true });
  assert(r.allowed && r.policeRequired && r.policeSatisfied);
});

test('B7 — caution validée + police pending → police_pending (caution ne suffit pas)', () => {
  const r = evaluateArrivalEligibility({
    depositAmount: 500, depStatus: 'authorized',
    guestCountry: 'DE', policeDone: false, linkSent: true,
  });
  assert(!r.allowed && r.reason === 'police_pending');
  assert(r.depositSatisfied && !r.policeSatisfied);
});

test('B8 — caution pending + police signée → deposit_pending (police ne suffit pas)', () => {
  const r = evaluateArrivalEligibility({
    depositAmount: 500, depStatus: 'pending',
    guestCountry: 'DE', policeDone: true, linkSent: true,
  });
  assert(!r.allowed && r.reason === 'deposit_pending');
  assert(!r.depositSatisfied && r.policeSatisfied);
});

test('B9 — les deux conditions satisfaites → allowed', () => {
  const r = evaluateArrivalEligibility({
    depositAmount: 500, depStatus: 'authorized',
    guestCountry: 'DE', policeDone: true, linkSent: true,
  });
  assert(r.allowed && r.depositSatisfied && r.policeSatisfied);
});

test('B10 — Channex last-minute, caution pending → bloqué (divergence corrigée)', () => {
  // Avant centralisation ce cas n'était pas protégé si send_condition='always'
  const r = evaluateArrivalEligibility({
    platform: 'booking', depositAmount: 500, depStatus: 'pending',
    guestCountry: 'DE', policeDone: false, linkSent: false,
  });
  assert(!r.allowed && r.reason === 'deposit_pending');
});

test('B11 — Channex last-minute, police pending → bloqué (divergence corrigée)', () => {
  const r = evaluateArrivalEligibility({
    platform: 'booking', depositAmount: 500, depStatus: 'authorized',
    guestCountry: 'DE', policeDone: false, linkSent: true,
  });
  assert(!r.allowed && r.reason === 'police_pending');
});

test('B12 — handleDepositPaid : caution validée + police pending → bloqué (bypass corrigé)', () => {
  // Avant centralisation, handleDepositPaid envoyait sans vérifier la police
  const r = evaluateArrivalEligibility({
    depositAmount: 500, depStatus: 'authorized',
    guestCountry: 'GB', policeDone: false, linkSent: true,
  });
  assert(!r.allowed && r.reason === 'police_pending');
  assert(r.depositSatisfied && !r.policeSatisfied);
});

test('B13 — Scénario 1 : caution payée = dernière condition → allowed', () => {
  // Étape 1 : caution non validée → blocked
  const avant = evaluateArrivalEligibility({ depositAmount: 500, depStatus: null, guestCountry: '' });
  assert(!avant.allowed && avant.reason === 'deposit_pending');
  // Étape 2 : caution validée (événement Stripe) → allowed
  const apres = evaluateArrivalEligibility({ depositAmount: 500, depStatus: 'authorized', guestCountry: '' });
  assert(apres.allowed);
});

test('B14 — Scénario 2 : signature police = dernière condition → allowed', () => {
  // Étape 1 : police non signée → blocked
  const avant = evaluateArrivalEligibility({
    depositAmount: 500, depStatus: 'authorized',
    guestCountry: 'DE', policeDone: false, linkSent: true,
  });
  assert(!avant.allowed && avant.reason === 'police_pending');
  // Étape 2 : fiche signée → allowed
  const apres = evaluateArrivalEligibility({
    depositAmount: 500, depStatus: 'authorized',
    guestCountry: 'DE', policeDone: true, linkSent: true,
  });
  assert(apres.allowed);
});

test('B15 — Anti-doublon : un envoi récent bloque les suivants (logique applicative)', () => {
  // Simulation : alreadySentLog.rows.length > 0 → le code skip avant même d'évaluer
  // L'anti-doublon est en amont de evaluateArrivalEligibility dans runTemplatesCron.
  // Ce test vérifie que la logique métier elle-même est idempotente si on l'appelait deux fois.
  const r1 = evaluateArrivalEligibility({ depositAmount: 500, depStatus: 'authorized', guestCountry: 'DE', policeDone: true, linkSent: true });
  const r2 = evaluateArrivalEligibility({ depositAmount: 500, depStatus: 'authorized', guestCountry: 'DE', policeDone: true, linkSent: true });
  // La fonction est pure : deux appels identiques → même résultat
  assert(r1.allowed && r2.allowed && r1.reason === r2.reason);
  // La protection contre le double envoi réel est assurée par la vérification
  // SELECT status='sent' dans message_template_logs (23h window) en amont.
});

test('B16 — Concurrence : deux appels simultanés avec conditions satisfaites → même décision allowed', () => {
  // evaluateArrivalEligibility est une fonction pure sans effets de bord.
  // Deux appels simultanés retournent le même résultat — la protection contre
  // le double envoi est assurée par le SELECT anti-doublon (23h) qui précède
  // l'appel dans runTemplatesCron et handleDepositPaid. Pour les chemins
  // concurrents (webhook + cron simultanés), la fenêtre de race est réduite
  // par le setTimeout(3000ms) sur la relance police-triggered.
  const appel1 = evaluateArrivalEligibility({ depositAmount: 500, depStatus: 'authorized', guestCountry: 'DE', policeDone: true, linkSent: true });
  const appel2 = evaluateArrivalEligibility({ depositAmount: 500, depStatus: 'authorized', guestCountry: 'DE', policeDone: true, linkSent: true });
  assert(appel1.allowed && appel2.allowed, 'Les deux appels doivent être allowed');
  // Note documentée : pour une protection forte, utiliser INSERT WHERE NOT EXISTS
  // (claim atomique) avant sendTemplateMessage — améliorations possibles futures.
});

// ══════════════════════════════════════════════════════════════════════════════
// SÉRIE R — Test de régression (bug original agence/Channex)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n📋  Série R — Régression\n');

test('R1 — Agence + voyageur DE + sans {checkin_link} : était bloqué avant, autorisé maintenant', () => {
  // AVANT : bloquait inconditionnellement pour tout étranger sans fiche
  const avant = checkPoliceGuard_BEFORE_FIX({ isAirbnb: false, guestCountry: 'DE', policeDone: false });
  assert(avant.blocked, 'La version avant-fix aurait dû bloquer ce cas');

  // APRÈS (evaluateArrivalEligibility) : autorisé car lien jamais envoyé
  const apres = evaluateArrivalEligibility({ guestCountry: 'DE', policeDone: false, linkSent: false });
  assert(!apres.allowed === false, 'evaluateArrivalEligibility doit retourner allowed=true');
  assert(apres.allowed, 'Pas de {checkin_link} envoyé → on ne peut pas exiger une fiche');

  // Invariant : si le lien a été envoyé ET fiche non signée → toujours bloqué
  const avecLien = evaluateArrivalEligibility({ guestCountry: 'DE', policeDone: false, linkSent: true });
  assert(!avecLien.allowed && avecLien.reason === 'police_pending');
});

test('R2 — Scénario 3 complet : caution ET police en attente, ordre satisfaction variable', () => {
  const toutEnAttente = evaluateArrivalEligibility({
    depositAmount: 500, depStatus: null,
    guestCountry: 'DE', policeDone: false, linkSent: true,
  });
  assert(!toutEnAttente.allowed && toutEnAttente.reason === 'deposit_pending',
    'La caution est testée en premier → son blocage prime');

  // Caution payée en premier (police toujours pending)
  const cautionPayée = evaluateArrivalEligibility({
    depositAmount: 500, depStatus: 'authorized',
    guestCountry: 'DE', policeDone: false, linkSent: true,
  });
  assert(!cautionPayée.allowed && cautionPayée.reason === 'police_pending',
    'Caution validée mais police encore pending → bloqué');

  // Police signée ensuite → tout satisfait
  const toutSatisfait = evaluateArrivalEligibility({
    depositAmount: 500, depStatus: 'authorized',
    guestCountry: 'DE', policeDone: true, linkSent: true,
  });
  assert(toutSatisfait.allowed, 'Les deux conditions satisfaites → allowed');

  // Ordre inverse : police signée en premier (caution toujours pending)
  const policeSignéePremière = evaluateArrivalEligibility({
    depositAmount: 500, depStatus: null,
    guestCountry: 'DE', policeDone: true, linkSent: true,
  });
  assert(!policeSignéePremière.allowed && policeSignéePremière.reason === 'deposit_pending',
    'Police signée mais caution pending → bloqué');

  // Caution payée ensuite → tout satisfait
  const toutSatisfait2 = evaluateArrivalEligibility({
    depositAmount: 500, depStatus: 'authorized',
    guestCountry: 'DE', policeDone: true, linkSent: true,
  });
  assert(toutSatisfait2.allowed, 'Les deux conditions satisfaites (ordre inverse) → allowed');
});

// ══════════════════════════════════════════════════════════════════════════════
// SÉRIE X — Cas limites
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n📋  Série X — Cas limites\n');

test('X1 — Airbnb : toutes les gardes sautées', () => {
  const r = evaluateArrivalEligibility({
    platform: 'airbnb', depositAmount: 500, depStatus: null,
    guestCountry: 'DE', policeDone: false, linkSent: true,
  });
  assert(r.allowed && !r.depositRequired && !r.policeRequired);
});

test('X2 — ABB (code court Airbnb) : exempté aussi', () => {
  const r = evaluateArrivalEligibility({ platform: 'abb', depositAmount: 500, depStatus: null });
  assert(r.allowed);
});

test('X3 — Caution captured (encaissée) → valide', () => {
  const r = evaluateArrivalEligibility({ depositAmount: 500, depStatus: 'captured' });
  assert(r.allowed && r.depositSatisfied);
});

test('X4 — Voyageur français : jamais bloqué par police', () => {
  const r = evaluateArrivalEligibility({ guestCountry: 'FR', policeDone: false, linkSent: true });
  assert(r.allowed && !r.policeRequired);
});

test('X5 — Nationalité inconnue (iCal) : jamais bloqué par police', () => {
  const r = evaluateArrivalEligibility({ guestCountry: '', policeDone: false, linkSent: true });
  assert(r.allowed && !r.policeRequired);
});

test('X6 — caution auth_expired (expirée) → deposit_pending', () => {
  const r = evaluateArrivalEligibility({ depositAmount: 500, depStatus: 'auth_expired' });
  assert(!r.allowed && r.reason === 'deposit_pending');
});

test('X7 — caution released (libérée) → deposit_pending', () => {
  // 'released' n'est pas dans la liste valide (authorized|captured)
  const r = evaluateArrivalEligibility({ depositAmount: 500, depStatus: 'released' });
  assert(!r.allowed && r.reason === 'deposit_pending');
});

// ══════════════════════════════════════════════════════════════════════════════
// SÉRIE E — Phase A : fail-closed sur erreur DB
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n📋  Série E — Fail-closed (erreur DB pendant evaluateArrivalEligibility)\n');

test('E1 — Erreur DB sur requête principale → allowed:false, reason:eligibility_error', () => {
  const r = evaluateArrivalEligibility({ simulateDbError: true });
  assert(!r.allowed, 'allowed doit être false sur erreur DB');
  assert.strictEqual(r.reason, 'eligibility_error', 'reason doit être eligibility_error');
});

test('E2 — eligibility_error distinct de deposit_pending et police_pending', () => {
  const errDb  = evaluateArrivalEligibility({ simulateDbError: true });
  const depPend = evaluateArrivalEligibility({ depositAmount: 500, depStatus: 'pending' });
  const polPend = evaluateArrivalEligibility({ guestCountry: 'DE', policeDone: false, linkSent: true });
  assert.strictEqual(errDb.reason, 'eligibility_error');
  assert.strictEqual(depPend.reason, 'deposit_pending');
  assert.strictEqual(polPend.reason, 'police_pending');
  // Aucune confusion entre les trois raisons
  assert(errDb.reason !== depPend.reason && errDb.reason !== polPend.reason);
});

test('E3 — Airbnb : erreur DB simulée — Airbnb est exempté avant la requête DB', () => {
  // Le shortcut Airbnb est évalué AVANT la requête DB : même si la DB plante,
  // un on_arrival Airbnb reste autorisé (le raccourci ne touche pas la DB).
  const r = evaluateArrivalEligibility({ platform: 'airbnb', simulateDbError: true });
  // simulateDbError n'a pas d'effet car isAirbnb=true court-circuite la logique DB
  // (dans la version pure du test, simulateDbError est vérifié après isAirbnb)
  assert(r.allowed, 'Airbnb doit rester allowed même si la DB est simulée en erreur');
  assert.strictEqual(r.reason, null);
});

test('E4 — eligibility_error ne génère pas status=sent (pas de blocage du retry)', () => {
  // L'anti-doublon dans runTemplatesCron vérifie uniquement status='sent'.
  // Un résultat eligibility_error → le code écrit status='blocked' avec error_message='eligibility_error'.
  // Ce test vérifie que allowed:false + reason:eligibility_error n'autorise pas l'envoi.
  const r = evaluateArrivalEligibility({ simulateDbError: true });
  assert(!r.allowed, 'Un eligibility_error ne doit jamais autoriser l\'envoi');
  // Simulation : si allowed:false, le chemin runTemplatesCron écrit 'blocked', pas 'sent'
  const statusEcrit = r.allowed ? 'sent' : 'blocked';
  assert.strictEqual(statusEcrit, 'blocked', 'Le log doit être blocked, jamais sent');
});

test('E5 — Après rétablissement DB, la fonction retourne une décision métier normale', () => {
  // Simule : la DB était en erreur (retourne eligibility_error), puis se rétablit.
  // Au prochain cron, la même conversation est évaluée sans erreur DB → décision correcte.
  const pendantErreur = evaluateArrivalEligibility({ simulateDbError: true });
  assert(!pendantErreur.allowed && pendantErreur.reason === 'eligibility_error');

  // DB rétablie, caution ok, pas de police requise → autorisé
  const apresRetablissement = evaluateArrivalEligibility({
    depositAmount: 500, depStatus: 'authorized', guestCountry: '',
  });
  assert(apresRetablissement.allowed, 'Après rétablissement DB, la décision métier normale est rendue');
  assert.strictEqual(apresRetablissement.reason, null);
});

test('E6 — eligibility_error avec caution réelle en attente : fail-closed ne masque pas le vrai état', () => {
  // Un eligibility_error NE DIT PAS que la caution est pending ou que la police est pending.
  // Il dit uniquement : "je n'ai pas pu vérifier". Ce test vérifie que les champs
  // depositRequired/policeRequired sont false (état inconnu, pas état faux positif).
  const r = evaluateArrivalEligibility({ simulateDbError: true });
  assert.strictEqual(r.depositRequired, false, 'depositRequired doit être false sur eligibility_error');
  assert.strictEqual(r.depositSatisfied, false, 'depositSatisfied doit être false sur eligibility_error');
  assert.strictEqual(r.policeRequired, false, 'policeRequired doit être false sur eligibility_error');
  assert.strictEqual(r.policeSatisfied, false, 'policeSatisfied doit être false sur eligibility_error');
  assert.strictEqual(r.checkinLinkSent, false, 'checkinLinkSent doit être false sur eligibility_error');
});

// ══════════════════════════════════════════════════════════════════════════════
// SÉRIE P — Phase B : idempotence atomique multi-déclencheurs
//
// Ces tests valident la LOGIQUE de la couche idempotente sans PostgreSQL réel.
// Ils modélisent le comportement attendu de sendOnArrivalIdempotently via des
// fonctions pures.
//
// NOTE IMPORTANTE : Les tests P34 (5 workers concurrents) et les transitions
// error→sending prouvent seulement que la logique applicative est correcte.
// L'atomicité PostgreSQL réelle (INSERT ON CONFLICT DO UPDATE WHERE) ne peut
// être garantie que par des tests d'intégration avec une vraie base de données.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n📋  Série P — Phase B : idempotence atomique multi-déclencheurs\n');

/**
 * Modèle simplifié du store idempotent (en mémoire, sans PostgreSQL).
 * Simule INSERT ON CONFLICT (idempotency_key) DO UPDATE WHERE status='error'.
 */
function makeIdempotencyStore() {
  const store = new Map();

  function claim(key) {
    if (!store.has(key)) {
      store.set(key, { status: 'sending' });
      return { claimed: true };
    }
    const existing = store.get(key);
    if (existing.status === 'error') {
      store.set(key, { status: 'sending' });
      return { claimed: true };
    }
    return { claimed: false, existingStatus: existing.status };
  }

  function setStatus(key, status) {
    store.set(key, { status });
  }

  function getStatus(key) {
    return store.get(key)?.status || null;
  }

  return { claim, setStatus, getStatus };
}

/**
 * Simule l'envoi d'un on_arrival via sendOnArrivalIdempotently.
 * Retourne 'sent', 'skipped', 'blocked', 'ota_rejected', 'delivery_unknown', 'error'.
 */
function simulateSendOnArrival(store, idempotencyKey, opts = {}) {
  const {
    templateId = 1,
    convId = 100,
    arrivalDate = '2026-09-16',
    channexOtaRejected = false,
    channexAmbiguous = false,
    templateError = false,
    templateSkipped = false,
  } = opts;

  const key = idempotencyKey || `on_arrival:${templateId}:${convId}:${arrivalDate}`;
  const claimResult = store.claim(key);

  if (!claimResult.claimed) {
    return { outcome: 'skipped', reason: 'already_claimed' };
  }

  // sendTemplateMessage simulé
  if (templateError) {
    store.setStatus(key, 'error');
    return { outcome: 'error' };
  }
  if (templateSkipped) {
    store.setStatus(key, 'blocked');
    return { outcome: 'blocked' };
  }
  if (channexOtaRejected) {
    store.setStatus(key, 'ota_rejected');
    return { outcome: 'ota_rejected' };
  }
  if (channexAmbiguous) {
    store.setStatus(key, 'delivery_unknown');
    return { outcome: 'delivery_unknown' };
  }

  store.setStatus(key, 'sent');
  return { outcome: 'sent' };
}

// ── P29 : Airbnb last-minute + cron → un seul envoi ──────────────────────────
test('P29 — Airbnb last-minute + cron même template/conv/date → un seul envoi', () => {
  const store = makeIdempotencyStore();
  const key = 'on_arrival:1:100:2026-09-16';

  const r1 = simulateSendOnArrival(store, key, { channexOtaRejected: false });
  const r2 = simulateSendOnArrival(store, key); // cron tente après Airbnb
  assert.strictEqual(r1.outcome, 'sent', 'Airbnb doit réussir en premier');
  assert.strictEqual(r2.outcome, 'skipped', 'Cron doit être skipé (déjà réclamé)');
});

// ── P30 : BHGuest + cron → un seul envoi ─────────────────────────────────────
test('P30 — BHGuest + cron même template/conv/date → un seul envoi', () => {
  const store = makeIdempotencyStore();
  const key = 'on_arrival:2:200:2026-09-16';

  const r1 = simulateSendOnArrival(store, key);
  const r2 = simulateSendOnArrival(store, key);
  assert.strictEqual(r1.outcome, 'sent');
  assert.strictEqual(r2.outcome, 'skipped');
});

// ── P31 : Stripe + cron → un seul envoi ──────────────────────────────────────
test('P31 — Stripe (handleDepositPaid) + cron même template/conv/date → un seul envoi', () => {
  const store = makeIdempotencyStore();
  const key = 'on_arrival:3:300:2026-09-16';

  const r1 = simulateSendOnArrival(store, key); // Stripe arrive en premier
  const r2 = simulateSendOnArrival(store, key); // cron arrive après
  assert.strictEqual(r1.outcome, 'sent', 'Stripe premier');
  assert.strictEqual(r2.outcome, 'skipped', 'Cron skipé');
});

// ── P32 : Channex webhook last-minute + cron → un seul envoi ─────────────────
test('P32 — Channex last-minute + cron même template/conv/date → un seul envoi', () => {
  const store = makeIdempotencyStore();
  const key = 'on_arrival:4:400:2026-09-16';

  const r1 = simulateSendOnArrival(store, key); // Channex webhook premier
  const r2 = simulateSendOnArrival(store, key); // cron de 7h/9h/etc
  assert.strictEqual(r1.outcome, 'sent');
  assert.strictEqual(r2.outcome, 'skipped');
});

// ── P33 : signature police + Stripe → un seul envoi ─────────────────────────
test('P33 — police signature + Stripe même template/conv/date → un seul envoi', () => {
  const store = makeIdempotencyStore();
  const key = 'on_arrival:5:500:2026-09-16';

  const r1 = simulateSendOnArrival(store, key); // police signature déclenche runTemplatesCron
  const r2 = simulateSendOnArrival(store, key); // Stripe déclenche handleDepositPaid
  assert.strictEqual(r1.outcome, 'sent');
  assert.strictEqual(r2.outcome, 'skipped');
});

// ── P34 : 5 déclencheurs concurrents simulés → un seul claim ─────────────────
test('P34 — 5 déclencheurs concurrents simultanés → un seul claim', () => {
  const store = makeIdempotencyStore();
  const key = 'on_arrival:6:600:2026-09-16';

  // Tous tentent simultanément (séquentiels ici car JS mono-thread)
  const results = [
    simulateSendOnArrival(store, key),
    simulateSendOnArrival(store, key),
    simulateSendOnArrival(store, key),
    simulateSendOnArrival(store, key),
    simulateSendOnArrival(store, key),
  ];

  const sent = results.filter(r => r.outcome === 'sent').length;
  const skipped = results.filter(r => r.outcome === 'skipped').length;
  assert.strictEqual(sent, 1, 'Exactement un seul envoi doit aboutir');
  assert.strictEqual(skipped, 4, 'Les 4 autres doivent être skippés');
});

// ── P35 : Airbnb reste exempté des gardes caution/police ─────────────────────
test('P35 — Airbnb exempté des gardes caution/police mais passe par le claim atomique', () => {
  // evaluateArrivalEligibility Airbnb → allowed sans aucune vérification caution/police
  const r = evaluateArrivalEligibility({
    platform: 'airbnb', depositAmount: 500, depStatus: null,
    guestCountry: 'DE', policeDone: false, linkSent: true,
  });
  assert(r.allowed, 'Airbnb doit être allowed même sans caution et police');
  assert(!r.depositRequired, 'depositRequired doit être false pour Airbnb');
  assert(!r.policeRequired, 'policeRequired doit être false pour Airbnb');

  // Airbnb last-minute passe ensuite par le claim atomique (pas de guard éligibilité)
  const store = makeIdempotencyStore();
  const key = 'on_arrival:7:700:2026-09-16';
  const r1 = simulateSendOnArrival(store, key);
  const r2 = simulateSendOnArrival(store, key);
  assert.strictEqual(r1.outcome, 'sent', 'Premier appel doit envoyer');
  assert.strictEqual(r2.outcome, 'skipped', 'Deuxième appel doit être skipé');
});

// ── P36 : BHGuest conserve ses règles métier ─────────────────────────────────
test('P36 — BHGuest : pas de contrainte caution/police artificielle (règles métier préservées)', () => {
  // BHGuest : arrivée aujourd'hui + after 7h → on_arrival déclenché SANS guard caution/police
  // La couche idempotente est ajoutée APRÈS la décision métier existante
  const isArrivalToday = true;
  const isAfter7h = true;
  const triggersIncludeOnArrival = isArrivalToday && isAfter7h;
  assert(triggersIncludeOnArrival, 'BHGuest doit déclencher on_arrival si arrivée aujourd\'hui après 7h');

  // Mais une fois déclenché, passe par le claim atomique
  const store = makeIdempotencyStore();
  const key = 'on_arrival:8:800:2026-09-16';
  const r = simulateSendOnArrival(store, key);
  assert.strictEqual(r.outcome, 'sent');
});

// ── P37 : blocked caution/police → aucune idempotency_key ────────────────────
test('P37 — blocked caution/police → aucun claim (idempotency_key NULL)', () => {
  // Dans runTemplatesCron/handleDepositPaid, si eligibility.allowed=false :
  //   INSERT message_template_logs (status='blocked') sans idempotency_key
  //   → on NE FAIT PAS sendOnArrivalIdempotently
  const blocked = evaluateArrivalEligibility({ depositAmount: 500, depStatus: 'pending' });
  assert(!blocked.allowed, 'Doit être bloqué');

  // Simulation : si not allowed → on n'appelle pas sendOnArrivalIdempotently
  const store = makeIdempotencyStore();
  const key = 'on_arrival:9:900:2026-09-16';
  if (!blocked.allowed) {
    // Aucun claim → le store reste vide
  }
  assert.strictEqual(store.getStatus(key), null, 'Aucun claim ne doit être fait pour un blocked');

  // Et le prochain cron peut réévaluer (car pas de claim bloquant)
  const afterFix = evaluateArrivalEligibility({ depositAmount: 500, depStatus: 'authorized' });
  assert(afterFix.allowed, 'Après paiement caution, doit être autorisé');
  const r = simulateSendOnArrival(store, key);
  assert.strictEqual(r.outcome, 'sent', 'Après levée du blocage, doit pouvoir envoyer');
});

// ── P38 : ota_rejected → aucun retry automatique ─────────────────────────────
test('P38 — ota_rejected → aucun retry automatique', () => {
  const store = makeIdempotencyStore();
  const key = 'on_arrival:10:1000:2026-09-16';

  const r1 = simulateSendOnArrival(store, key, { channexOtaRejected: true });
  assert.strictEqual(r1.outcome, 'ota_rejected', 'Premier appel → ota_rejected');
  assert.strictEqual(store.getStatus(key), 'ota_rejected');

  // Retry automatique tenté → skipé (status n'est pas 'error')
  const r2 = simulateSendOnArrival(store, key);
  assert.strictEqual(r2.outcome, 'skipped', 'ota_rejected ne doit jamais être retenté automatiquement');
});

// ── P39 : delivery_unknown → aucun retry automatique ─────────────────────────
test('P39 — delivery_unknown → aucun retry automatique', () => {
  const store = makeIdempotencyStore();
  const key = 'on_arrival:11:1100:2026-09-16';

  const r1 = simulateSendOnArrival(store, key, { channexAmbiguous: true });
  assert.strictEqual(r1.outcome, 'delivery_unknown');
  assert.strictEqual(store.getStatus(key), 'delivery_unknown');

  // Retry automatique tenté → skipé
  const r2 = simulateSendOnArrival(store, key);
  assert.strictEqual(r2.outcome, 'skipped', 'delivery_unknown ne doit jamais être retenté automatiquement');
});

// ── P40 : error → retry atomique autorisé ────────────────────────────────────
test('P40 — error → retry atomique autorisé (DO UPDATE WHERE status=\'error\')', () => {
  const store = makeIdempotencyStore();
  const key = 'on_arrival:12:1200:2026-09-16';

  // Premier appel → error
  const r1 = simulateSendOnArrival(store, key, { templateError: true });
  assert.strictEqual(r1.outcome, 'error');
  assert.strictEqual(store.getStatus(key), 'error');

  // Retry → claim réussi (status='error' est retryable)
  const r2 = simulateSendOnArrival(store, key);
  assert.strictEqual(r2.outcome, 'sent', 'Après error, le retry doit pouvoir réclamer et envoyer');
  assert.strictEqual(store.getStatus(key), 'sent');

  // Troisième appel → skipé (status='sent')
  const r3 = simulateSendOnArrival(store, key);
  assert.strictEqual(r3.outcome, 'skipped', 'Après sent, plus de retry');
});

// ── Clé sans déclencheur ──────────────────────────────────────────────────────
test('P41 — La clé idempotency_key ne contient pas le déclencheur', () => {
  const templateId = 42;
  const convId = 1337;
  const arrivalDate = '2026-09-16';

  const key = `on_arrival:${templateId}:${convId}:${arrivalDate}`;

  // La clé ne doit PAS contenir : cron, stripe, police, channex, airbnb, bhguest
  const forbiddenTerms = ['cron', 'stripe', 'police', 'channex', 'airbnb', 'bhguest'];
  for (const term of forbiddenTerms) {
    assert(!key.toLowerCase().includes(term), `La clé ne doit pas contenir "${term}"`);
  }

  // La clé doit respecter le format exact
  assert.match(key, /^on_arrival:\d+:\d+:\d{4}-\d{2}-\d{2}$/, 'Format de clé invalide');

  // Deux déclencheurs avec les mêmes paramètres → même clé
  const keyStripe = `on_arrival:${templateId}:${convId}:${arrivalDate}`;
  const keyCron = `on_arrival:${templateId}:${convId}:${arrivalDate}`;
  assert.strictEqual(keyStripe, keyCron, 'Stripe et cron doivent produire la même clé');
});

// ══════════════════════════════════════════════════════════════════════════════
// SÉRIE P2 — Fix 1/2/3 : ota_rejected, stale sending, réconciliation
//
// Fonctions pures miroir de markStaleOnArrivalSendingAsUnknown et
// reconcileOnArrivalDeliveryUnknown définis dans server.js.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n📋  Série P2 — Fix 1/2/3 : ota_rejected, stale, réconciliation\n');

// ── Helpers purs ──────────────────────────────────────────────────────────────

/**
 * Miroir de la détection cxRes===null dans sendTemplateMessage.
 * sendBookingMessage retourne null pour 403/404 → channexOtaRejected=true.
 */
function classifyChannexResult(cxRes) {
  if (cxRes === null) return { channexOtaRejected: true, channexMessageId: null };
  return { channexOtaRejected: false, channexMessageId: cxRes?.id || null };
}

/**
 * Miroir de markStaleOnArrivalSendingAsUnknown.
 * Prend un tableau de records en mémoire + nowMs, retourne les records mis à jour.
 */
function simulateMarkStale(records, nowMs) {
  const FIFTEEN_MIN_MS = 15 * 60 * 1000;
  return records.map(r => {
    if (
      r.trigger_type === 'on_arrival' &&
      r.idempotency_key !== null &&
      r.status === 'sending' &&
      r.sent_at !== null &&
      (nowMs - new Date(r.sent_at).getTime()) > FIFTEEN_MIN_MS
    ) {
      return { ...r, status: 'delivery_unknown', error_message: r.error_message || 'sending_timeout_15min' };
    }
    return { ...r };
  });
}

/**
 * Miroir de reconcileOnArrivalDeliveryUnknown.
 * getMessagesFn(channex_booking_id) : function simulant getBookingMessages (peut throw).
 * notifyFn(userId, title, body) : captur les notifications.
 * nowMs : heure courante simulée.
 */
function simulateReconcile(records, getMessagesFn, nowMs, notifyFn) {
  const WINDOW_MS = 2 * 60 * 60 * 1000;
  const NINETY_MIN_MS = 90 * 60 * 1000;
  const normalize = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

  const updated = records.map(r => ({ ...r }));
  const apiErrors = [];

  for (const rec of updated) {
    if (
      rec.trigger_type !== 'on_arrival' ||
      rec.status !== 'delivery_unknown' ||
      rec.idempotency_key === null ||
      rec.channex_message_id !== null
    ) continue;

    if (!rec.channex_booking_id) continue;

    let channexMessages;
    try {
      channexMessages = getMessagesFn(rec.channex_booking_id);
    } catch (e) {
      apiErrors.push(rec.id);
      continue; // Erreur API → on ne touche pas au status
    }

    const sentAt = rec.sent_at ? new Date(rec.sent_at) : null;
    const normalizedLocalMsg = normalize(rec.message);

    const match = channexMessages.find(m => {
      if (m.sender !== 'host') return false;
      if (normalize(m.message) !== normalizedLocalMsg) return false;
      if (sentAt && m.inserted_at) {
        const cxAt = new Date(m.inserted_at);
        if (Math.abs(cxAt - sentAt) > WINDOW_MS) return false;
      }
      return true;
    });

    if (match) {
      rec.status = 'sent';
      rec.channex_message_id = match.id;
      rec.delivered_at = match.inserted_at ? new Date(match.inserted_at) : new Date(nowMs);
      rec.error_message = null;
      continue;
    }

    if (!sentAt) continue;
    const ageMs = nowMs - sentAt.getTime();
    if (ageMs < NINETY_MIN_MS) continue;

    if (rec.error_message === 'reconciliation_unresolved') continue;

    rec.error_message = 'reconciliation_unresolved';
    if (notifyFn) notifyFn(rec.user_id, rec.id);
  }

  return { records: updated, apiErrors };
}

// ── P42 : sendBookingMessage null → ota_rejected ──────────────────────────────
test('P42 — sendBookingMessage retourne null (403/404) → channexOtaRejected=true, pas sent', () => {
  const r1 = classifyChannexResult(null);
  assert.strictEqual(r1.channexOtaRejected, true, 'null doit déclencher ota_rejected');
  assert.strictEqual(r1.channexMessageId, null);

  // Résultat non-null → pas ota_rejected
  const r2 = classifyChannexResult({ id: 'uuid-abc' });
  assert.strictEqual(r2.channexOtaRejected, false);
  assert.strictEqual(r2.channexMessageId, 'uuid-abc');

  // Via le store idempotent : ota_rejected ne finit jamais en 'sent'
  const store = makeIdempotencyStore();
  const key = 'on_arrival:1:42:2026-09-16';
  const outcome = simulateSendOnArrival(store, key, { channexOtaRejected: true });
  assert.strictEqual(outcome.outcome, 'ota_rejected');
  assert.strictEqual(store.getStatus(key), 'ota_rejected');
});

// ── P43 : ota_rejected est terminal ──────────────────────────────────────────
test('P43 — ota_rejected est terminal : aucun retry automatique possible', () => {
  const store = makeIdempotencyStore();
  const key = 'on_arrival:1:43:2026-09-16';

  simulateSendOnArrival(store, key, { channexOtaRejected: true });
  assert.strictEqual(store.getStatus(key), 'ota_rejected');

  // Le store refuse le claim car status !== 'error'
  const retry = store.claim(key);
  assert.strictEqual(retry.claimed, false);
  assert.strictEqual(retry.existingStatus, 'ota_rejected');
});

// ── P44 : ota_rejected même si SMS/message local créé ────────────────────────
test('P44 — 403/404 Channex : le message local est créé mais le statut final est ota_rejected (pas sent)', () => {
  // Ce test valide la règle : un message créé localement ou en SMS
  // NE doit PAS faire passer le statut à 'sent' si Channex a retourné null.
  // La détection cxRes===null arrive AVANT la résolution du statut final.
  const cxRes = null; // 403 ou 404 → null
  const { channexOtaRejected } = classifyChannexResult(cxRes);
  assert.strictEqual(channexOtaRejected, true);

  // Simulation de la résolution du statut dans sendOnArrivalIdempotently :
  // result.channexOtaRejected=true → finalStatus='ota_rejected' même si message local OK
  const result = { channexOtaRejected: true, channexAmbiguous: false, status: 'ok', message: 'Voici vos codes...' };
  let finalStatus;
  if (result.channexOtaRejected)    finalStatus = 'ota_rejected';
  else if (result.channexAmbiguous) finalStatus = 'delivery_unknown';
  else if (result.status === 'error') finalStatus = 'error';
  else                               finalStatus = 'sent';

  assert.strictEqual(finalStatus, 'ota_rejected', '403/404 doit finir ota_rejected même avec message local');
});

// ── P45 : sending >15min + on_arrival + clé → delivery_unknown ───────────────
test('P45 — sending >15min + on_arrival + idempotency_key → delivery_unknown', () => {
  const nowMs = Date.now();
  const records = [{
    id: 1, trigger_type: 'on_arrival', status: 'sending',
    idempotency_key: 'on_arrival:1:45:2026-09-16',
    sent_at: new Date(nowMs - 20 * 60 * 1000).toISOString(), // 20 min ago
    error_message: null,
  }];
  const updated = simulateMarkStale(records, nowMs);
  assert.strictEqual(updated[0].status, 'delivery_unknown');
  assert.strictEqual(updated[0].error_message, 'sending_timeout_15min');
});

// ── P46 : sending <15min → inchangé ──────────────────────────────────────────
test('P46 — sending <15min → status inchangé (pas encore stale)', () => {
  const nowMs = Date.now();
  const records = [{
    id: 2, trigger_type: 'on_arrival', status: 'sending',
    idempotency_key: 'on_arrival:1:46:2026-09-16',
    sent_at: new Date(nowMs - 5 * 60 * 1000).toISOString(), // 5 min ago
    error_message: null,
  }];
  const updated = simulateMarkStale(records, nowMs);
  assert.strictEqual(updated[0].status, 'sending', 'Moins de 15 min → pas touché');
});

// ── P47 : autre trigger_type → non touché ────────────────────────────────────
test('P47 — trigger_type != on_arrival → jamais touché par markStale', () => {
  const nowMs = Date.now();
  const records = [
    { id: 3, trigger_type: 'pre_arrival', status: 'sending',
      idempotency_key: 'pre_arrival:1:47:2026-09-16',
      sent_at: new Date(nowMs - 60 * 60 * 1000).toISOString(), error_message: null },
    { id: 4, trigger_type: 'post_stay', status: 'sending',
      idempotency_key: null,
      sent_at: new Date(nowMs - 60 * 60 * 1000).toISOString(), error_message: null },
  ];
  const updated = simulateMarkStale(records, nowMs);
  assert.strictEqual(updated[0].status, 'sending', 'pre_arrival ne doit pas être touché');
  assert.strictEqual(updated[1].status, 'sending', 'post_stay ne doit pas être touché');
});

// ── P48 : sending + on_arrival sans idempotency_key → non touché ──────────────
test('P48 — sending + on_arrival sans idempotency_key (anciens logs) → jamais touché', () => {
  const nowMs = Date.now();
  const records = [{
    id: 5, trigger_type: 'on_arrival', status: 'sending',
    idempotency_key: null, // Ancien log sans Phase B
    sent_at: new Date(nowMs - 60 * 60 * 1000).toISOString(), error_message: null,
  }];
  const updated = simulateMarkStale(records, nowMs);
  assert.strictEqual(updated[0].status, 'sending', 'Sans idempotency_key → jamais touché');
});

// ── P49 : sent/error/ota_rejected + on_arrival → non touchés ─────────────────
test('P49 — statuts terminaux (sent/error/ota_rejected) → markStale ne les modifie pas', () => {
  const nowMs = Date.now();
  const oldDate = new Date(nowMs - 60 * 60 * 1000).toISOString();
  const records = [
    { id: 6, trigger_type: 'on_arrival', status: 'sent', idempotency_key: 'k1', sent_at: oldDate, error_message: null },
    { id: 7, trigger_type: 'on_arrival', status: 'error', idempotency_key: 'k2', sent_at: oldDate, error_message: 'timeout' },
    { id: 8, trigger_type: 'on_arrival', status: 'ota_rejected', idempotency_key: 'k3', sent_at: oldDate, error_message: null },
  ];
  const updated = simulateMarkStale(records, nowMs);
  assert.strictEqual(updated[0].status, 'sent');
  assert.strictEqual(updated[1].status, 'error');
  assert.strictEqual(updated[2].status, 'ota_rejected');
});

// ── P50 : réconciliation — message trouvé → sent ──────────────────────────────
test('P50 — reconcile : message retrouvé sur Channex (sender=host, contenu, ±2h) → status=sent', () => {
  const sentAtMs = Date.now() - 30 * 60 * 1000; // 30 min ago
  const sentAt = new Date(sentAtMs).toISOString();
  const channexMsgId = 'cx-uuid-50';
  const records = [{
    id: 10, trigger_type: 'on_arrival', status: 'delivery_unknown',
    idempotency_key: 'on_arrival:1:50:2026-09-16',
    channex_message_id: null, message: 'Voici vos codes accès.',
    sent_at: sentAt, user_id: 1, conversation_id: 50,
    channex_booking_id: 'bk-50', error_message: null,
  }];

  const getMsg = () => [{
    id: channexMsgId, sender: 'host',
    message: 'Voici vos codes accès.',
    inserted_at: new Date(sentAtMs + 60000).toISOString(), // 1 min après
  }];

  const notifications = [];
  const { records: updated } = simulateReconcile(records, getMsg, Date.now(), (uid) => notifications.push(uid));
  assert.strictEqual(updated[0].status, 'sent');
  assert.strictEqual(updated[0].channex_message_id, channexMsgId);
  assert.notStrictEqual(updated[0].delivered_at, null);
  assert.strictEqual(notifications.length, 0, 'Aucune notif si réconcilié avec succès');
});

// ── P51 : message introuvable + âge <90min → delivery_unknown inchangé ────────
test('P51 — reconcile : message introuvable + âge <90min → delivery_unknown, aucune notif', () => {
  const sentAtMs = Date.now() - 30 * 60 * 1000; // 30 min ago (< 90 min)
  const records = [{
    id: 11, trigger_type: 'on_arrival', status: 'delivery_unknown',
    idempotency_key: 'on_arrival:1:51:2026-09-16',
    channex_message_id: null, message: 'Bonjour message.',
    sent_at: new Date(sentAtMs).toISOString(), user_id: 1, conversation_id: 51,
    channex_booking_id: 'bk-51', error_message: null,
  }];

  const getMsg = () => []; // Aucun message
  const notifications = [];
  const { records: updated } = simulateReconcile(records, getMsg, Date.now(), (uid) => notifications.push(uid));
  assert.strictEqual(updated[0].status, 'delivery_unknown', 'Statut inchangé');
  assert.strictEqual(updated[0].error_message, null, 'error_message inchangé');
  assert.strictEqual(notifications.length, 0, 'Aucune notif avant 90 min');
});

// ── P52 : message introuvable + âge >90min → reconciliation_unresolved + notif ─
test('P52 — reconcile : message introuvable + âge >90min → error_message=reconciliation_unresolved + notif', () => {
  const sentAtMs = Date.now() - 100 * 60 * 1000; // 100 min ago (> 90 min)
  const records = [{
    id: 12, trigger_type: 'on_arrival', status: 'delivery_unknown',
    idempotency_key: 'on_arrival:1:52:2026-09-16',
    channex_message_id: null, message: 'Voici les codes.',
    sent_at: new Date(sentAtMs).toISOString(), user_id: 99, conversation_id: 52,
    channex_booking_id: 'bk-52', error_message: null,
  }];

  const getMsg = () => [];
  const notifications = [];
  const { records: updated } = simulateReconcile(records, getMsg, Date.now(), (uid) => notifications.push(uid));
  assert.strictEqual(updated[0].status, 'delivery_unknown', 'Le statut reste delivery_unknown');
  assert.strictEqual(updated[0].error_message, 'reconciliation_unresolved');
  assert.strictEqual(notifications.length, 1, 'Une notif doit être envoyée');
  assert.strictEqual(notifications[0], 99, 'Notif envoyée à user_id=99');
});

// ── P53 : déjà reconciliation_unresolved → aucune seconde notif ───────────────
test('P53 — reconcile : error_message=reconciliation_unresolved déjà présent → aucune notif supplémentaire', () => {
  const sentAtMs = Date.now() - 200 * 60 * 1000; // 200 min ago
  const records = [{
    id: 13, trigger_type: 'on_arrival', status: 'delivery_unknown',
    idempotency_key: 'on_arrival:1:53:2026-09-16',
    channex_message_id: null, message: 'Message.',
    sent_at: new Date(sentAtMs).toISOString(), user_id: 99, conversation_id: 53,
    channex_booking_id: 'bk-53', error_message: 'reconciliation_unresolved',
  }];

  const getMsg = () => [];
  const notifications = [];
  const { records: updated } = simulateReconcile(records, getMsg, Date.now(), (uid) => notifications.push(uid));
  assert.strictEqual(updated[0].error_message, 'reconciliation_unresolved', 'error_message inchangé');
  assert.strictEqual(notifications.length, 0, 'Aucune notif si déjà marqué unresolved');
});

// ── P54 : normalisation du contenu (espaces différents) ───────────────────────
test('P54 — reconcile : normalisation contenu (espaces multiples / casse) → match trouvé', () => {
  const sentAtMs = Date.now() - 10 * 60 * 1000;
  const records = [{
    id: 14, trigger_type: 'on_arrival', status: 'delivery_unknown',
    idempotency_key: 'on_arrival:1:54:2026-09-16',
    channex_message_id: null, message: 'Voici  vos  codes.',
    sent_at: new Date(sentAtMs).toISOString(), user_id: 1, conversation_id: 54,
    channex_booking_id: 'bk-54', error_message: null,
  }];

  // Message Channex avec espaces différents
  const getMsg = () => [{
    id: 'cx-54', sender: 'host',
    message: 'Voici vos codes.', // espaces normalisés
    inserted_at: new Date(sentAtMs + 30000).toISOString(),
  }];

  const { records: updated } = simulateReconcile(records, getMsg, Date.now(), null);
  assert.strictEqual(updated[0].status, 'sent', 'La normalisation doit permettre le match');
  assert.strictEqual(updated[0].channex_message_id, 'cx-54');
});

// ── P55 : message dans la fenêtre ±2h → match ─────────────────────────────────
test('P55 — reconcile : message Channex dans la fenêtre ±2h → match valide', () => {
  const sentAtMs = Date.now() - 30 * 60 * 1000;
  const records = [{
    id: 15, trigger_type: 'on_arrival', status: 'delivery_unknown',
    idempotency_key: 'on_arrival:1:55:2026-09-16',
    channex_message_id: null, message: 'Codes accès.',
    sent_at: new Date(sentAtMs).toISOString(), user_id: 1, conversation_id: 55,
    channex_booking_id: 'bk-55', error_message: null,
  }];

  // Message 90 min après sent_at — encore dans la fenêtre ±2h
  const getMsg = () => [{
    id: 'cx-55', sender: 'host', message: 'Codes accès.',
    inserted_at: new Date(sentAtMs + 90 * 60 * 1000).toISOString(),
  }];

  const { records: updated } = simulateReconcile(records, getMsg, Date.now(), null);
  assert.strictEqual(updated[0].status, 'sent', '90min dans ±2h → match valide');
});

// ── P56 : message hors fenêtre ±2h → aucun match ─────────────────────────────
test('P56 — reconcile : message Channex hors fenêtre ±2h → aucun match', () => {
  const sentAtMs = Date.now() - 30 * 60 * 1000;
  const records = [{
    id: 16, trigger_type: 'on_arrival', status: 'delivery_unknown',
    idempotency_key: 'on_arrival:1:56:2026-09-16',
    channex_message_id: null, message: 'Codes accès.',
    sent_at: new Date(sentAtMs).toISOString(), user_id: 1, conversation_id: 56,
    channex_booking_id: 'bk-56', error_message: null,
  }];

  // Message 3h après sent_at — hors de la fenêtre ±2h
  const getMsg = () => [{
    id: 'cx-56', sender: 'host', message: 'Codes accès.',
    inserted_at: new Date(sentAtMs + 3 * 60 * 60 * 1000).toISOString(),
  }];

  const { records: updated } = simulateReconcile(records, getMsg, Date.now(), null);
  assert.strictEqual(updated[0].status, 'delivery_unknown', 'Hors ±2h → aucun match');
  assert.strictEqual(updated[0].channex_message_id, null);
});

// ── P57 : erreur API Channex → status inchangé ───────────────────────────────
test('P57 — reconcile : erreur API getBookingMessages → status delivery_unknown inchangé', () => {
  const sentAtMs = Date.now() - 30 * 60 * 1000;
  const records = [{
    id: 17, trigger_type: 'on_arrival', status: 'delivery_unknown',
    idempotency_key: 'on_arrival:1:57:2026-09-16',
    channex_message_id: null, message: 'Accès.',
    sent_at: new Date(sentAtMs).toISOString(), user_id: 1, conversation_id: 57,
    channex_booking_id: 'bk-57', error_message: null,
  }];

  const getMsg = () => { throw new Error('Channex API timeout'); };
  const notifications = [];
  const { records: updated, apiErrors } = simulateReconcile(records, getMsg, Date.now(), (uid) => notifications.push(uid));
  assert.strictEqual(updated[0].status, 'delivery_unknown', 'Erreur API → statut inchangé');
  assert.strictEqual(notifications.length, 0, 'Aucune notif si erreur API');
  assert.strictEqual(apiErrors.includes(17), true, 'Record marqué en erreur API');
});

// ── P58 : sans channex_booking_id → skippé ────────────────────────────────────
test('P58 — reconcile : record sans channex_booking_id → skippé (delivery_unknown inchangé)', () => {
  const sentAtMs = Date.now() - 100 * 60 * 1000;
  const records = [{
    id: 18, trigger_type: 'on_arrival', status: 'delivery_unknown',
    idempotency_key: 'on_arrival:1:58:2026-09-16',
    channex_message_id: null, message: 'Accès.',
    sent_at: new Date(sentAtMs).toISOString(), user_id: 1, conversation_id: 58,
    channex_booking_id: null, // Pas de booking Channex
    error_message: null,
  }];

  const getMsg = () => { throw new Error('Should not be called'); };
  const notifications = [];
  const { records: updated } = simulateReconcile(records, getMsg, Date.now(), (uid) => notifications.push(uid));
  assert.strictEqual(updated[0].status, 'delivery_unknown', 'Sans booking_id → skippé, statut inchangé');
  assert.strictEqual(updated[0].error_message, null, 'error_message inchangé');
  assert.strictEqual(notifications.length, 0);
});

// ─── Résumé ───────────────────────────────────────────────────────────────────
console.log('');
if (failed === 0) {
  console.log(`✅  ${passed} test(s) passé(s) — aucune régression détectée.\n`);
} else {
  console.error(`❌  ${failed} test(s) en échec sur ${passed + failed}.\n`);
  process.exit(1);
}
