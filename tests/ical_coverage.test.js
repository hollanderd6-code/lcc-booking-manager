'use strict';
/**
 * Tests unitaires — isIcalCoveredByChannex (server.js)
 *
 * La fonction isIcalCoveredByChannex() est extraite ici en copie miroir
 * pour être testée sans démarrer le serveur.
 *
 * Toute modification de cette fonction dans server.js doit se refléter ici.
 *
 * Exécution : node tests/ical_coverage.test.js
 */

const assert = require('assert');

// ─── Copie miroir de isIcalCoveredByChannex ───────────────────────────────────
// Doit rester IDENTIQUE à la définition dans server.js.
function isIcalCoveredByChannex(icalStart, icalEnd, chxRows) {
  const end = new Date(icalEnd);
  const sorted = [...chxRows].sort((a, b) => new Date(a.sd) - new Date(b.sd));
  let frontier = new Date(icalStart);
  for (const chx of sorted) {
    if (new Date(chx.sd) > frontier) break;
    const ce = new Date(chx.ed);
    if (ce > frontier) frontier = ce;
  }
  return frontier >= end;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function chx(sd, ed) { return { sd: new Date(sd), ed: new Date(ed) }; }

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

// ─── Série IC — couverture iCal par Channex ───────────────────────────────────

console.log('\n── Série IC : cas de couverture ──────────────────────────────────────────');

test('IC-1 — deux CHX contigus couvrent exactement l\'iCal (CAS A principal)', () => {
  // CHX 14→20, CHX 20→28, ICAL 14→28 → doit être ignoré
  const covered = isIcalCoveredByChannex(
    '2026-10-14', '2026-10-28',
    [chx('2026-10-14', '2026-10-20'), chx('2026-10-20', '2026-10-28')]
  );
  assert.strictEqual(covered, true);
});

test('IC-2 — iCal partiellement couvert (seul CHX) → ne pas ignorer', () => {
  // CHX 14→20, ICAL 14→28 → 20→28 non couvert
  const covered = isIcalCoveredByChannex(
    '2026-10-14', '2026-10-28',
    [chx('2026-10-14', '2026-10-20')]
  );
  assert.strictEqual(covered, false);
});

test('IC-3 — iCal commence avant le CHX → ne pas ignorer', () => {
  // CHX 16→20, ICAL 14→28 → 14→16 non couvert
  const covered = isIcalCoveredByChannex(
    '2026-10-14', '2026-10-28',
    [chx('2026-10-16', '2026-10-20')]
  );
  assert.strictEqual(covered, false);
});

test('IC-4 — trou entre deux CHX → ne pas ignorer', () => {
  // CHX 14→18, CHX 20→28, ICAL 14→28 → trou 18→20
  const covered = isIcalCoveredByChannex(
    '2026-10-14', '2026-10-28',
    [chx('2026-10-14', '2026-10-18'), chx('2026-10-20', '2026-10-28')]
  );
  assert.strictEqual(covered, false);
});

test('IC-5 — iCal un jour avant les CHX → ne pas ignorer', () => {
  // CHX 14→20, CHX 20→28, ICAL 13→28 → jour 13 non couvert
  const covered = isIcalCoveredByChannex(
    '2026-10-13', '2026-10-28',
    [chx('2026-10-14', '2026-10-20'), chx('2026-10-20', '2026-10-28')]
  );
  assert.strictEqual(covered, false);
});

test('IC-6 — iCal un jour après les CHX → ne pas ignorer', () => {
  // CHX 14→20, CHX 20→28, ICAL 14→29 → jour 28 non couvert
  const covered = isIcalCoveredByChannex(
    '2026-10-14', '2026-10-29',
    [chx('2026-10-14', '2026-10-20'), chx('2026-10-20', '2026-10-28')]
  );
  assert.strictEqual(covered, false);
});

test('IC-7 — iCal indépendant (aucun CHX du tout) → ne pas ignorer', () => {
  const covered = isIcalCoveredByChannex('2026-10-14', '2026-10-28', []);
  assert.strictEqual(covered, false);
});

test('IC-8 — iCal checkout = CHX checkin (contigus, pas de couverture) → ne pas ignorer', () => {
  // iCal commence là où le CHX se termine → pas de couverture (convention checkout exclusive)
  const covered = isIcalCoveredByChannex(
    '2026-10-20', '2026-10-28',
    [chx('2026-10-14', '2026-10-20')]
  );
  assert.strictEqual(covered, false);
});

test('IC-9 — un seul CHX couvre exactement l\'iCal (1 nuit)', () => {
  const covered = isIcalCoveredByChannex(
    '2026-10-14', '2026-10-15',
    [chx('2026-10-14', '2026-10-15')]
  );
  assert.strictEqual(covered, true);
});

test('IC-10 — trois CHX contigus couvrent iCal plus large', () => {
  // CHX 14→18, CHX 18→22, CHX 22→28, ICAL 14→28
  const covered = isIcalCoveredByChannex(
    '2026-10-14', '2026-10-28',
    [
      chx('2026-10-14', '2026-10-18'),
      chx('2026-10-18', '2026-10-22'),
      chx('2026-10-22', '2026-10-28'),
    ]
  );
  assert.strictEqual(covered, true);
});

test('IC-11 — CHX non ordonnés en entrée (tri interne requis)', () => {
  // Même que IC-1 mais ordre inversé dans le tableau
  const covered = isIcalCoveredByChannex(
    '2026-10-14', '2026-10-28',
    [chx('2026-10-20', '2026-10-28'), chx('2026-10-14', '2026-10-20')]
  );
  assert.strictEqual(covered, true);
});

test('IC-12 — CHX se chevauchent eux-mêmes mais couvrent l\'iCal', () => {
  // CHX 14→22, CHX 20→28 (overlap) — l'union couvre 14→28
  const covered = isIcalCoveredByChannex(
    '2026-10-14', '2026-10-28',
    [chx('2026-10-14', '2026-10-22'), chx('2026-10-20', '2026-10-28')]
  );
  assert.strictEqual(covered, true);
});

test('IC-13 — iCal import normal indépendant de tout CHX', () => {
  // Résas CHX sur d\'autres périodes → iCal non couvert
  const covered = isIcalCoveredByChannex(
    '2026-11-01', '2026-11-07',
    [chx('2026-10-14', '2026-10-20'), chx('2026-10-20', '2026-10-28')]
  );
  assert.strictEqual(covered, false);
});

test('IC-14 — iCal d\'une nuit, CHX contigu avant → pas couvert', () => {
  const covered = isIcalCoveredByChannex(
    '2026-10-20', '2026-10-21',
    [chx('2026-10-14', '2026-10-20')]
  );
  assert.strictEqual(covered, false);
});

// ─── Résumé ───────────────────────────────────────────────────────────────────
console.log(`\n── Résultat ──────────────────────────────────────────────────────────────`);
console.log(`   ${passed} test(s) réussi(s)  |  ${failed} échec(s)\n`);

if (failed > 0) process.exit(1);
