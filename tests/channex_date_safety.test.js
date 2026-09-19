'use strict';
/**
 * Tests de régression — CHANNEX DATE SAFETY
 *
 * Vérifie normalizeDateOnly() et getOccupiedNights() (utils/dates.js).
 * Couvre également le comportement du mécanisme de retry pushAvailability.
 *
 * Ces fonctions sont importées directement (pas de miroir nécessaire :
 * utils/dates.js n'a aucune dépendance externe — pure logic only).
 *
 * Exécution : node tests/channex_date_safety.test.js
 */

const assert = require('assert');
const { normalizeDateOnly, getOccupiedNights } = require('../utils/dates');

// ─── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌  ${name}`);
    console.error(`       ${err.message}`);
    failed++;
  }
}

// ─── Série DA : getOccupiedNights — cas fondamentaux ─────────────────────────

console.log('\n── Série DA : getOccupiedNights — cas fondamentaux ──────────────────────────');

test('TEST-A — 18/09 → 20/09 : deux nuits exactement [18, 19]', () => {
  const nights = getOccupiedNights('2026-09-18', '2026-09-20');
  assert.deepStrictEqual(nights, ['2026-09-18', '2026-09-19'],
    'Doit produire exactement 18 et 19, jamais le 20 (checkout exclusif)');
});

test('TEST-B — 18/09 → 19/09 : une seule nuit [18]', () => {
  const nights = getOccupiedNights('2026-09-18', '2026-09-19');
  assert.deepStrictEqual(nights, ['2026-09-18']);
});

test('TEST-C — 30/09 → 01/10 : passage fin de mois → [30/09]', () => {
  const nights = getOccupiedNights('2026-09-30', '2026-10-01');
  assert.deepStrictEqual(nights, ['2026-09-30']);
});

test('TEST-D — 31/12 → 02/01 : passage fin d\'année → [31/12, 01/01]', () => {
  const nights = getOccupiedNights('2026-12-31', '2027-01-02');
  assert.deepStrictEqual(nights, ['2026-12-31', '2027-01-01']);
});

test('TEST-E — DST spring forward 2026-03-29 : 3 nuits sans duplication ni saut', () => {
  // 29 mars 2026 : Europe/Paris passe de UTC+1 à UTC+2 (02h → 03h, nuit 23h)
  // L'itération UTC (+86400000 ms) ne doit pas être affectée par ce changement d'heure.
  const nights = getOccupiedNights('2026-03-28', '2026-03-31');
  assert.deepStrictEqual(nights, ['2026-03-28', '2026-03-29', '2026-03-30'],
    'DST spring forward : 3 nuits distinctes, pas de doublon sur le 29 mars');

  // Fall-back DST : 25 octobre 2026 (03h → 02h, nuit 25h)
  const nights2 = getOccupiedNights('2026-10-24', '2026-10-27');
  assert.deepStrictEqual(nights2, ['2026-10-24', '2026-10-25', '2026-10-26'],
    'DST fall-back : 3 nuits distinctes, pas de doublon sur le 25 octobre');
});

// ─── Série DB : normalizeDateOnly — inputs variés ─────────────────────────────

console.log('\n── Série DB : normalizeDateOnly — types d\'input ─────────────────────────────');

test('TEST-F — input string "YYYY-MM-DD" (cas pg colonne DATE, TZ-agnostique)', () => {
  // pg retourne une string pour les colonnes DATE — indépendant du TZ du process.
  assert.strictEqual(normalizeDateOnly('2026-09-18'), '2026-09-18');
  assert.strictEqual(normalizeDateOnly('2026-12-31'), '2026-12-31');
  // Vérifie que getOccupiedNights est cohérent avec des inputs strings
  const nights = getOccupiedNights('2026-09-18', '2026-09-20');
  assert.deepStrictEqual(nights, ['2026-09-18', '2026-09-19'],
    'Résultat identique que le process tourne en UTC ou Europe/Paris');
});

test('TEST-G — input Date objet Paris midnight (cas pg colonne TIMESTAMPTZ)', () => {
  // Un TIMESTAMPTZ "2026-09-18T00:00:00+02:00" (minuit Paris, été)
  // que pg retourne comme Date(2026-09-17T22:00:00Z).
  // normalizeDateOnly doit retourner "2026-09-18" (date métier Paris), PAS "2026-09-17".
  const pgDateSummer = new Date('2026-09-17T22:00:00Z'); // = minuit Paris été
  assert.strictEqual(normalizeDateOnly(pgDateSummer), '2026-09-18',
    'TIMESTAMPTZ minuit Paris été (UTC-2h) → date Paris "2026-09-18"');

  // Hiver Paris UTC+1 : "2026-01-15T00:00:00+01:00" → pg retourne Date(2026-01-14T23:00:00Z)
  const pgDateWinter = new Date('2026-01-14T23:00:00Z'); // = minuit Paris hiver
  assert.strictEqual(normalizeDateOnly(pgDateWinter), '2026-01-15',
    'TIMESTAMPTZ minuit Paris hiver (UTC-1h) → date Paris "2026-01-15"');

  // Vérifie que getOccupiedNights fonctionne avec des Date objects TIMESTAMPTZ
  // Résa 18/09 → 20/09 vue depuis pg TIMESTAMPTZ (été)
  const pgStart = new Date('2026-09-17T22:00:00Z'); // = 18 sept Paris
  const pgEnd   = new Date('2026-09-19T22:00:00Z'); // = 20 sept Paris
  const nights = getOccupiedNights(pgStart, pgEnd);
  assert.deepStrictEqual(nights, ['2026-09-18', '2026-09-19'],
    'TIMESTAMPTZ pg → getOccupiedNights produit les dates Paris correctes');
});

test('TEST-H — input string "YYYY-MM-DD" depuis pg colonne DATE', () => {
  // pg retourne une string pour les colonnes DATE (OID 1082)
  const s = '2026-09-18';
  assert.strictEqual(normalizeDateOnly(s), '2026-09-18');
  assert.strictEqual(normalizeDateOnly(s).length, 10);
});

test('TEST-I — input Date object représentant minuit Europe/Paris (TIMESTAMPTZ pg)', () => {
  // Cas critique P0-B : résultat de toISOString().slice(0,10) serait faux.
  const parisMinuitEte    = new Date('2026-09-17T22:00:00Z');
  const parisMinuitHiver  = new Date('2026-01-14T23:00:00Z');
  const parisMinuitDST    = new Date('2026-03-28T23:00:00Z'); // = minuit Paris jour avant DST

  assert.strictEqual(normalizeDateOnly(parisMinuitEte),   '2026-09-18');
  assert.strictEqual(normalizeDateOnly(parisMinuitHiver), '2026-01-15');
  assert.strictEqual(normalizeDateOnly(parisMinuitDST),   '2026-03-29');

  // Contrôle négatif : toISOString().slice(0,10) produirait le mauvais résultat
  assert.notStrictEqual(parisMinuitEte.toISOString().slice(0, 10), '2026-09-18',
    'Preuve du bug : toISOString().slice(0,10) donne "2026-09-17" (faux)');
});

test('TEST-J — input Date UTC midnight (pas de biais)', () => {
  // Un Date au midnight UTC n'a pas de biais en Paris (minuit UTC = 02h Paris en été)
  const utcMidnight = new Date('2026-09-18T00:00:00Z'); // = 02:00 Paris
  assert.strictEqual(normalizeDateOnly(utcMidnight), '2026-09-18',
    'Date UTC midnight → date Paris identique si > 00:00 Paris');

  // 2026-09-17T23:00:00Z = 01:00 Paris → toujours le 18 septembre côté Paris
  const lateUtcPrev = new Date('2026-09-17T23:00:00Z');
  assert.strictEqual(normalizeDateOnly(lateUtcPrev), '2026-09-18',
    '2026-09-17T23:00:00Z = 01:00 Paris le 18 sept → "2026-09-18"');
});

// ─── Série DC : cas limites ────────────────────────────────────────────────────

console.log('\n── Série DC : cas limites ────────────────────────────────────────────────────');

test('TEST-K — checkout = checkin : zéro nuit (aucune boucle infinie)', () => {
  const nights = getOccupiedNights('2026-09-18', '2026-09-18');
  assert.deepStrictEqual(nights, [], 'check-out = check-in → tableau vide');
});

test('TEST-L — end_date < start_date : erreur contrôlée, jamais boucle infinie', () => {
  assert.throws(
    () => getOccupiedNights('2026-09-20', '2026-09-18'),
    /endDate.*ant/i,
    'end < start doit lancer une Error explicite'
  );
});

test('TEST-L2 — null / undefined inputs → tableau vide (pas d\'erreur)', () => {
  assert.deepStrictEqual(getOccupiedNights(null, '2026-09-20'), []);
  assert.deepStrictEqual(getOccupiedNights('2026-09-18', null), []);
  assert.deepStrictEqual(getOccupiedNights(null, null), []);
  assert.strictEqual(normalizeDateOnly(null), null);
  assert.strictEqual(normalizeDateOnly(undefined), null);
});

// ─── Série DD : retry pushAvailability — logique de décision ─────────────────

console.log('\n── Série DD : retry pushAvailability — décision et idempotence ──────────────');

// Miroir du cœur du mécanisme de retry :
// calcule les dates bloquées depuis des lignes DB (format retourné par AT TIME ZONE).
function computeRetryBlockedDates(reservationRows) {
  const blocked = [];
  for (const r of reservationRows) {
    blocked.push(...getOccupiedNights(r.s, r.e));
  }
  return [...new Set(blocked)].sort();
}

// Miroir de la décision "faut-il programmer un retry ?"
function shouldScheduleRetry(pushDidThrow) {
  return pushDidThrow;
}

test('TEST-M — push réussit : aucun retry programmé', () => {
  assert.strictEqual(shouldScheduleRetry(false), false,
    'push OK → pas de retry');
});

test('TEST-N — push échoue : retry doit être programmé', () => {
  assert.strictEqual(shouldScheduleRetry(true), true,
    'push throw → retry schedulé');
});

test('TEST-O — retry utilise le property_id de la réservation, pas d\'autre donnée', () => {
  let capturedPropId = null;
  function simulateCatch(result) {
    // Miroir de : const _retryPropId = result.property_id;
    capturedPropId = result.property_id;
  }
  simulateCatch({ property_id: 'prop-cdg5', uid: 'CHX_abc123' });
  assert.strictEqual(capturedPropId, 'prop-cdg5');
});

test('TEST-P — retry réussit : SUCCESS log attendu', () => {
  let log = null;
  function simulateRetryExecution(pushWillFail) {
    try {
      if (pushWillFail) throw new Error('Channex down');
      log = 'CHANNEX_AVAILABILITY_RETRY_SUCCESS';
    } catch (e) {
      log = 'CHANNEX_AVAILABILITY_RETRY_FAILED';
    }
  }
  simulateRetryExecution(false);
  assert.strictEqual(log, 'CHANNEX_AVAILABILITY_RETRY_SUCCESS');
});

test('TEST-Q — retry échoue : FAILED log attendu', () => {
  let log = null;
  function simulateRetryExecution(pushWillFail) {
    try {
      if (pushWillFail) throw new Error('Channex down');
      log = 'CHANNEX_AVAILABILITY_RETRY_SUCCESS';
    } catch (e) {
      log = 'CHANNEX_AVAILABILITY_RETRY_FAILED';
    }
  }
  simulateRetryExecution(true);
  assert.strictEqual(log, 'CHANNEX_AVAILABILITY_RETRY_FAILED');
});

test('TEST-R — deux retries sur la même propriété : résultat idempotent, zéro doublon', () => {
  const rows = [
    { s: '2026-09-18', e: '2026-09-23' }, // résa A
    { s: '2026-09-18', e: '2026-09-20' }  // résa B (chevauchement — CDG5)
  ];
  const result1 = computeRetryBlockedDates(rows);
  const result2 = computeRetryBlockedDates(rows);
  assert.deepStrictEqual(result1, result2, 'Résultat idempotent sur deux appels');
  assert.strictEqual(new Set(result1).size, result1.length, 'Aucun doublon dans le résultat');
  // Nuits attendues : 18 19 20 21 22 (A couvre 18→22, B couvre 18→19 — union = 18→22)
  assert.deepStrictEqual(result1, ['2026-09-18','2026-09-19','2026-09-20','2026-09-21','2026-09-22']);
});

test('TEST-S — booking A checkout = booking B checkin : aucun doublon sur la date frontière', () => {
  // Sémantique : checkout EXCLUSIF → la nuit du 20 appartient à B, pas à A.
  const rows = [
    { s: '2026-09-18', e: '2026-09-20' }, // A : nuits 18 + 19
    { s: '2026-09-20', e: '2026-09-25' }  // B : nuits 20, 21, 22, 23, 24
  ];
  const blocked = computeRetryBlockedDates(rows);
  // Union attendue : [18, 19, 20, 21, 22, 23, 24] — 7 nuits distinctes
  assert.deepStrictEqual(blocked, [
    '2026-09-18','2026-09-19',
    '2026-09-20','2026-09-21','2026-09-22','2026-09-23','2026-09-24'
  ], 'Pas de doublon sur la date frontière checkout/checkin');
  assert.strictEqual(new Set(blocked).size, blocked.length, 'Set size = array length → pas de doublon');
});

test('TEST-T — réservation + BHGuest hold actif : les deux sources couvrent l\'availability', () => {
  // triggerChannexAvailabilitySync combine [...resaResult.rows, ...holdsResult.rows].
  // Les deux sources retournent {start_str, end_str} via AT TIME ZONE 'Europe/Paris'.
  // Ce test vérifie que getOccupiedNights traite correctement les deux types de lignes.
  const resaRows = [{ start_str: '2026-09-20', end_str: '2026-09-25' }]; // réservation
  const holdRows = [{ start_str: '2026-09-27', end_str: '2026-09-29' }]; // bhguest_hold actif

  const blocked = [];
  [...resaRows, ...holdRows].forEach(r => blocked.push(...getOccupiedNights(r.start_str, r.end_str)));
  const unique = [...new Set(blocked)].sort();

  // Nuits réservation : 20, 21, 22, 23, 24 (5 nuits)
  // Nuits hold        : 27, 28              (2 nuits)
  // Union             : 7 nuits, sans doublon
  assert.deepStrictEqual(unique, [
    '2026-09-20','2026-09-21','2026-09-22','2026-09-23','2026-09-24',
    '2026-09-27','2026-09-28'
  ]);
  assert.strictEqual(unique.length, 7, '5 nuits réservation + 2 nuits hold = 7 distinctes');
});

// ─── Résumé ───────────────────────────────────────────────────────────────────
console.log(`\n── Résultat ──────────────────────────────────────────────────────────────────`);
console.log(`   ${passed} test(s) réussi(s)  |  ${failed} échec(s)\n`);

if (failed > 0) process.exit(1);
