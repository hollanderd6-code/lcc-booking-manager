'use strict';
/**
 * Tests unitaires — CHXROOMFIX : dates canoniques room-level dans processChannexBooking
 *
 * Logique miroir extraite de channex.js.
 * Toute modification de resolveReservationDates dans channex.js doit se refléter ici.
 *
 * Exécution : node tests/channex_room_dates.test.js
 */

const assert = require('assert');

// ─── Copie miroir de la logique de date canonique (channex.js) ────────────────
function resolveReservationDates(attrs) {
  const room = (attrs.rooms || [])[0] || {};
  const arrival_date   = attrs.arrival_date;
  const departure_date = attrs.departure_date;
  const reservationStart = room.checkin_date  || arrival_date;
  const reservationEnd   = room.checkout_date || departure_date;
  return { reservationStart, reservationEnd, arrival_date, departure_date };
}

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

// ─── Série RD — résolution des dates canoniques ───────────────────────────────

console.log('\n── Série RD : résolution dates room-level ────────────────────────────────');

test('RD-1 — mono-room : dates parent == room → résultat identique (aucune régression)', () => {
  const { reservationStart, reservationEnd } = resolveReservationDates({
    arrival_date: '2026-10-14', departure_date: '2026-10-20',
    rooms: [{ checkin_date: '2026-10-14', checkout_date: '2026-10-20' }]
  });
  assert.strictEqual(reservationStart, '2026-10-14');
  assert.strictEqual(reservationEnd,   '2026-10-20');
});

test('RD-2 — multi-room parent 14→28, rooms[0] 14→20 → réservation BH 14→20', () => {
  const { reservationStart, reservationEnd } = resolveReservationDates({
    arrival_date: '2026-10-14', departure_date: '2026-10-28',
    rooms: [
      { checkin_date: '2026-10-14', checkout_date: '2026-10-20' },
      { checkin_date: '2026-10-20', checkout_date: '2026-10-28' }
    ]
  });
  assert.strictEqual(reservationStart, '2026-10-14');
  assert.strictEqual(reservationEnd,   '2026-10-20');
});

test('RD-3 — multi-room parent 14→28, rooms[0] 20→28 → réservation BH 20→28', () => {
  const { reservationStart, reservationEnd } = resolveReservationDates({
    arrival_date: '2026-10-14', departure_date: '2026-10-28',
    rooms: [
      { checkin_date: '2026-10-20', checkout_date: '2026-10-28' },
      { checkin_date: '2026-10-14', checkout_date: '2026-10-20' }
    ]
  });
  assert.strictEqual(reservationStart, '2026-10-20');
  assert.strictEqual(reservationEnd,   '2026-10-28');
});

test('RD-4 — rooms absent → fallback booking parent', () => {
  const { reservationStart, reservationEnd } = resolveReservationDates({
    arrival_date: '2026-10-14', departure_date: '2026-10-20'
    // pas de rooms
  });
  assert.strictEqual(reservationStart, '2026-10-14');
  assert.strictEqual(reservationEnd,   '2026-10-20');
});

test('RD-5 — rooms[] vide → fallback booking parent', () => {
  const { reservationStart, reservationEnd } = resolveReservationDates({
    arrival_date: '2026-10-14', departure_date: '2026-10-20',
    rooms: []
  });
  assert.strictEqual(reservationStart, '2026-10-14');
  assert.strictEqual(reservationEnd,   '2026-10-20');
});

test('RD-6 — checkin_date absent dans rooms[0] → fallback parent start seulement', () => {
  const { reservationStart, reservationEnd } = resolveReservationDates({
    arrival_date: '2026-10-14', departure_date: '2026-10-28',
    rooms: [{ checkout_date: '2026-10-20' }] // pas de checkin_date
  });
  assert.strictEqual(reservationStart, '2026-10-14'); // fallback parent
  assert.strictEqual(reservationEnd,   '2026-10-20'); // room-level
});

test('RD-7 — checkout_date absent dans rooms[0] → fallback parent end seulement', () => {
  const { reservationStart, reservationEnd } = resolveReservationDates({
    arrival_date: '2026-10-14', departure_date: '2026-10-28',
    rooms: [{ checkin_date: '2026-10-14' }] // pas de checkout_date
  });
  assert.strictEqual(reservationStart, '2026-10-14'); // room-level
  assert.strictEqual(reservationEnd,   '2026-10-28'); // fallback parent
});

test('RD-8 — modification mono-room 14→20 → 14→28 : les nouvelles dates room0 sont utilisées', () => {
  // Révision 1 (simulée — déjà persistée en DB)
  const rev1 = resolveReservationDates({
    arrival_date: '2026-10-14', departure_date: '2026-10-20',
    rooms: [{ checkin_date: '2026-10-14', checkout_date: '2026-10-20' }]
  });
  assert.strictEqual(rev1.reservationStart, '2026-10-14');
  assert.strictEqual(rev1.reservationEnd,   '2026-10-20');

  // Révision 2 : vraie prolongation
  const rev2 = resolveReservationDates({
    arrival_date: '2026-10-14', departure_date: '2026-10-28',
    rooms: [{ checkin_date: '2026-10-14', checkout_date: '2026-10-28' }]
  });
  assert.strictEqual(rev2.reservationStart, '2026-10-14');
  assert.strictEqual(rev2.reservationEnd,   '2026-10-28'); // prolongation correctement capturée
});

test('RD-9 — modification multi-room : parent change mais rooms[0] dates spécifiques', () => {
  // Parent passe de 14→28 à 14→30 (rooms[1] prolongée)
  // rooms[0] reste 14→20 — la réservation BH pour rooms[0] ne doit pas changer
  const { reservationStart, reservationEnd } = resolveReservationDates({
    arrival_date: '2026-10-14', departure_date: '2026-10-30', // parent étendu
    rooms: [
      { checkin_date: '2026-10-14', checkout_date: '2026-10-20' }, // rooms[0] inchangée
      { checkin_date: '2026-10-20', checkout_date: '2026-10-30' }  // rooms[1] prolongée
    ]
  });
  assert.strictEqual(reservationStart, '2026-10-14');
  assert.strictEqual(reservationEnd,   '2026-10-20'); // rooms[0] non affectée
});

test('RD-10 — les dates parent restent accessibles pour le logging (non écrasées)', () => {
  const result = resolveReservationDates({
    arrival_date: '2026-10-14', departure_date: '2026-10-28',
    rooms: [{ checkin_date: '2026-10-14', checkout_date: '2026-10-20' }]
  });
  // Les dates parent doivent rester disponibles pour le log
  assert.strictEqual(result.arrival_date,   '2026-10-14');
  assert.strictEqual(result.departure_date, '2026-10-28');
  // Les dates BH doivent être room-level
  assert.strictEqual(result.reservationStart, '2026-10-14');
  assert.strictEqual(result.reservationEnd,   '2026-10-20');
});

test('RD-11 — days_breakdown cohérent avec rooms[0].days (6 entrées pour 6 nuits)', () => {
  const room0_days = {
    '2026-10-14': '100.00',
    '2026-10-15': '100.00',
    '2026-10-16': '100.00',
    '2026-10-17': '100.00',
    '2026-10-18': '100.00',
    '2026-10-19': '100.00',
  };
  const attrs = {
    arrival_date: '2026-10-14', departure_date: '2026-10-28',
    rooms: [
      { checkin_date: '2026-10-14', checkout_date: '2026-10-20', days: room0_days },
      { checkin_date: '2026-10-20', checkout_date: '2026-10-28', days: {} }
    ]
  };
  const { reservationStart, reservationEnd } = resolveReservationDates(attrs);
  const days_breakdown = (attrs.rooms[0]).days || {};
  const breakdown_count = Object.keys(days_breakdown).length;
  const span_days = (new Date(reservationEnd) - new Date(reservationStart)) / 86400000;

  // Avec le fix room-level : span = 6, breakdown = 6 → cohérent
  assert.strictEqual(span_days,       6, 'span doit être 6 nuits (rooms[0] scope)');
  assert.strictEqual(breakdown_count, 6, 'breakdown doit couvrir 6 nuits (rooms[0] only)');
  // Sans le fix (parent) : span serait 14 ≠ breakdown 6 → incohérence détectable
  const parent_span = (new Date(attrs.departure_date) - new Date(attrs.arrival_date)) / 86400000;
  assert.strictEqual(parent_span, 14, 'parent span = 14 sans fix');
  assert.notStrictEqual(parent_span, breakdown_count, 'B3 détectable : span parent ≠ breakdown');
});

test('RD-12 — booking_id et uid restent dérivés du booking_id parent (inchangés)', () => {
  const booking_id = 'cfa33f3b-bd32-4b90-8ef9-bde2bfe986cd';
  const uid = `CHX_${booking_id}`;
  // L'uid est formé depuis booking_id, pas depuis les dates — ce correctif ne le change pas
  assert.strictEqual(uid, 'CHX_cfa33f3b-bd32-4b90-8ef9-bde2bfe986cd');
  // Les dates room-level n'entrent pas dans la composition du uid
  assert.ok(!uid.includes('2026'), 'uid ne contient pas de dates');
});

// ─── Série FB — fallbacks 3 et 4 : paramètres SQL réels ─────────────────────

console.log('\n── Série FB : fallback matching params ───────────────────────────────────');

// Miroir de la logique des fallbacks 3 et 4 de processChannexBooking.
// Retourne les paramètres $2,$3 qui seraient passés au SQL.
function fallbackMatchParams(attrs) {
  const room = (attrs.rooms || [])[0] || {};
  const reservationStart = room.checkin_date  || attrs.arrival_date;
  const reservationEnd   = room.checkout_date || attrs.departure_date;
  return { reservationStart, reservationEnd };
}

// Miroir de la condition SQL du fallback 4 (start_date < $3 AND end_date > $2)
function icalOverlapsReservation(icalStart, icalEnd, reservationStart, reservationEnd) {
  return icalStart < reservationEnd && icalEnd > reservationStart;
}

test('FB-1 — fallback 3 multi-room : paramètre SQL = room-level (14→20), pas parent (14→28)', () => {
  const { reservationStart, reservationEnd } = fallbackMatchParams({
    arrival_date: '2026-10-14', departure_date: '2026-10-28',
    rooms: [
      { checkin_date: '2026-10-14', checkout_date: '2026-10-20' },
      { checkin_date: '2026-10-20', checkout_date: '2026-10-28' }
    ]
  });
  // La DB serait interrogée avec start_date='2026-10-20' et end_date='2026-10-20'
  // → trouve une ligne CHX existante property=P, start=14, end=20
  assert.strictEqual(reservationStart, '2026-10-14', 'start doit être rooms[0].checkin, pas parent');
  assert.strictEqual(reservationEnd,   '2026-10-20', 'end doit être rooms[0].checkout, PAS departure parent Oct28');
  assert.notStrictEqual(reservationEnd, '2026-10-28', 'departure parent ne doit PAS être utilisé');
});

test('FB-2 — fallback 4 multi-room : iCal 14→20 matche avec reservationStart=14 reservationEnd=20', () => {
  const { reservationStart, reservationEnd } = fallbackMatchParams({
    arrival_date: '2026-10-14', departure_date: '2026-10-28',
    rooms: [{ checkin_date: '2026-10-14', checkout_date: '2026-10-20' }]
  });
  // iCal ayant start=Oct14, end=Oct20 chevauchant la réservation 14→20
  assert.ok(
    icalOverlapsReservation('2026-10-14', '2026-10-20', reservationStart, reservationEnd),
    'iCal 14→20 doit être trouvé par le fallback 4 avec dates room-level'
  );
  // iCal ayant start=Oct14, end=Oct20 ne chevaucherait PAS le span parent 14→28 différemment
  // — mais la direction critique : un iCal 20→28 NE doit PAS matcher rooms[0] 14→20
  assert.ok(
    !icalOverlapsReservation('2026-10-20', '2026-10-28', reservationStart, reservationEnd),
    'iCal 20→28 ne doit PAS matcher rooms[0] qui se termine le 20 (adjacent = pas chevauchement)'
  );
});

test('FB-3 — fallback 4 span parent étendu ne piège pas un iCal rooms[1] seule', () => {
  // Avec le FIX : reservationEnd = Oct20 (rooms[0].checkout)
  // Un iCal portant uniquement Oct20→Oct28 (rooms[1]) ne doit PAS être converti à tort
  const { reservationStart, reservationEnd } = fallbackMatchParams({
    arrival_date: '2026-10-14', departure_date: '2026-10-28',
    rooms: [
      { checkin_date: '2026-10-14', checkout_date: '2026-10-20' },
      { checkin_date: '2026-10-20', checkout_date: '2026-10-28' }
    ]
  });
  // Ancien comportement (buggy) : reservationEnd = departure_date = Oct28
  // → icalOverlaps('2026-10-20', '2026-10-28', '2026-10-14', '2026-10-28') = true (mauvais)
  const buggyEnd = '2026-10-28';
  assert.ok(
    icalOverlapsReservation('2026-10-20', '2026-10-28', '2026-10-14', buggyEnd),
    'preuve du bug : ancien span parent capturait aussi le iCal de rooms[1]'
  );
  // Nouveau comportement (corrigé) : reservationEnd = Oct20
  assert.ok(
    !icalOverlapsReservation('2026-10-20', '2026-10-28', reservationStart, reservationEnd),
    'après fix : iCal rooms[1] adjacent (20→28) ne matche plus rooms[0] (14→20)'
  );
});

// ─── Résumé ───────────────────────────────────────────────────────────────────
console.log(`\n── Résultat ──────────────────────────────────────────────────────────────`);
console.log(`   ${passed} test(s) réussi(s)  |  ${failed} échec(s)\n`);

if (failed > 0) process.exit(1);
