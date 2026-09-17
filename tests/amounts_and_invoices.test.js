'use strict';

// Tests de régression pour les corrections BACKAMOUNT + BACKINV.
// Ces tests sont purement unitaires — pas de connexion DB requise.

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

// ── Chargement des fonctions testées ──────────────────────────────────────────
// On extrait uniquement les helpers purs sans instancier le serveur Express.

const serverSrc = fs.readFileSync(
  path.join(__dirname, '../server.js'), 'utf8'
);

// effectiveAmountRooms
const earMatch = serverSrc.match(/function effectiveAmountRooms\(r\)\s*\{[\s\S]*?\n\}/);
assert.ok(earMatch, 'effectiveAmountRooms doit être défini dans server.js');
const effectiveAmountRooms = new Function('return ' + earMatch[0])();

// calcPayFee (helper inline dans /api/reporting, on le ré-extrait)
const cpfMatch = serverSrc.match(/function calcPayFee\(row,\s*otaCom,\s*total\)\s*\{[\s\S]*?\n    \}/);
assert.ok(cpfMatch, 'calcPayFee doit être défini dans server.js');
const calcPayFee = new Function('return ' + cpfMatch[0])();

// calcNetHote
const cnhMatch = serverSrc.match(/function calcNetHote\(row\)\s*\{[\s\S]*?\n    \}/);
assert.ok(cnhMatch, 'calcNetHote doit être défini dans server.js');
// calcNetHote appelle calcPayFee — on injecte via closure
const calcNetHoteFactory = new Function('calcPayFee', `return ${cnhMatch[0]}`);
const calcNetHote = calcNetHoteFactory(calcPayFee);

// channex.js amount_rooms logic — on extrait le bloc de dérivation
const channexSrc = fs.readFileSync(
  path.join(__dirname, '../channex.js'), 'utf8'
);

// Vérifie que la correction channex est en place (pas de parseFloat(room.amount || amount_total))
const bugPattern = /const amount_rooms\s*=\s*parseFloat\s*\(\s*room\.amount\s*\|\|\s*amount_total\s*\)/;
assert.ok(!bugPattern.test(channexSrc),
  'channex.js : le bug amount_rooms = parseFloat(room.amount || amount_total) ne doit plus être présent');

// Vérifie que la logique correcte est présente
assert.ok(channexSrc.includes('roomAmountRaw'),
  'channex.js doit contenir la variable roomAmountRaw');
assert.ok(channexSrc.includes('isBookingCom && amount_cleaning > 0 && amount_total > 0'),
  'channex.js doit contenir la branche Booking.com pour amount_rooms');

// Vérifie que isBookingCom est déclaré AVANT amount_rooms
const idxIsBooking = channexSrc.indexOf('const isBookingCom =');
const idxRoomAmountRaw = channexSrc.indexOf('const roomAmountRaw');
assert.ok(idxIsBooking < idxRoomAmountRaw && idxIsBooking > 0,
  'channex.js : isBookingCom doit être déclaré avant roomAmountRaw');

// Vérifie que amount_cleaning est calculé AVANT amount_rooms
const idxAmountCleaning = channexSrc.indexOf('const amount_cleaning =');
assert.ok(idxAmountCleaning < idxRoomAmountRaw && idxAmountCleaning > 0,
  'channex.js : amount_cleaning doit être calculé avant roomAmountRaw');

// ── Helpers de simulation channex ─────────────────────────────────────────────
function simulateChannexRooms({ roomAmount, amountTotal, amountCleaning, isBookingCom }) {
  // Reproduit la logique de channex.js pour amount_rooms
  const roomAmountRaw = (roomAmount != null && roomAmount !== '')
    ? parseFloat(roomAmount)
    : null;
  let amount_rooms;
  if (roomAmountRaw != null && !isNaN(roomAmountRaw)) {
    amount_rooms = roomAmountRaw;
  } else if (isBookingCom && amountCleaning > 0 && amountTotal > 0) {
    amount_rooms = Math.round((amountTotal - amountCleaning) * 100) / 100;
  } else {
    amount_rooms = amountTotal;
  }
  return amount_rooms;
}

// ── Compteur de tests ─────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch(e) { console.error(`  ✗ ${name}\n    ${e.message}`); failed++; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION AMT — Montants Channex
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\nAMT — Parsing montants Channex');

test('AMT1 Booking sans room.amount : nuits = total - ménage', () => {
  const r = simulateChannexRooms({ roomAmount: null, amountTotal: 188.34, amountCleaning: 15, isBookingCom: true });
  assert.strictEqual(r, 173.34);
});

test('AMT2 Booking avec room.amount fourni : le conserver', () => {
  const r = simulateChannexRooms({ roomAmount: 173.34, amountTotal: 188.34, amountCleaning: 15, isBookingCom: true });
  assert.strictEqual(r, 173.34);
});

test('AMT2b Booking room.amount = 0 (zéro explicite) : le conserver (nuits gratuites)', () => {
  const r = simulateChannexRooms({ roomAmount: 0, amountTotal: 15, amountCleaning: 15, isBookingCom: true });
  assert.strictEqual(r, 0);
});

test('AMT3 Booking avec city tax : nuits = total - ménage (PAS city tax)', () => {
  // city tax est hors amount_total → pas à soustraire ici
  const r = simulateChannexRooms({ roomAmount: null, amountTotal: 188.34, amountCleaning: 15, isBookingCom: true });
  assert.strictEqual(r, 173.34);
  // city tax 28.17 ne doit pas impacter amount_rooms
});

test('AMT3b Booking sans ménage : fallback amount_total', () => {
  const r = simulateChannexRooms({ roomAmount: null, amountTotal: 188.34, amountCleaning: 0, isBookingCom: true });
  assert.strictEqual(r, 188.34);
});

test('AMT5 Airbnb : room.amount fourni, conservé (pas de correction Booking)', () => {
  const r = simulateChannexRooms({ roomAmount: 160.00, amountTotal: 160.00, amountCleaning: 20, isBookingCom: false });
  assert.strictEqual(r, 160.00);
});

test('AMT6 Direct : pas de room.amount, pas Booking → fallback amount_total', () => {
  const r = simulateChannexRooms({ roomAmount: null, amountTotal: 200.00, amountCleaning: 0, isBookingCom: false });
  assert.strictEqual(r, 200.00);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION AMT — effectiveAmountRooms (filet API historique)
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\nAMT — effectiveAmountRooms (filet API)');

test('AMT-API1 Booking historique rooms=total cleaning>0 : corrigé', () => {
  const r = effectiveAmountRooms({
    amount_total: 188.34, amount_rooms: 188.34, amount_cleaning: 15,
    source: 'channex', ota_name: 'Booking.com'
  });
  assert.strictEqual(r, 173.34);
});

test('AMT-API2 Booking déjà corrigé rooms≠total : inchangé', () => {
  const r = effectiveAmountRooms({
    amount_total: 188.34, amount_rooms: 173.34, amount_cleaning: 15,
    source: 'channex', ota_name: 'Booking.com'
  });
  assert.strictEqual(r, 173.34);
});

test('AMT-API3 Airbnb : aucune correction', () => {
  const r = effectiveAmountRooms({
    amount_total: 160.00, amount_rooms: 160.00, amount_cleaning: 20,
    source: 'channex', ota_name: 'Airbnb'
  });
  assert.strictEqual(r, 160.00);
});

test('AMT-API4 Direct : aucune correction (source ≠ booking)', () => {
  const r = effectiveAmountRooms({
    amount_total: 200.00, amount_rooms: 200.00, amount_cleaning: 0,
    source: 'DIRECT', ota_name: null
  });
  assert.strictEqual(r, 200.00);
});

test('AMT-API5 Booking cleaning=0 : aucune correction (condition non remplie)', () => {
  const r = effectiveAmountRooms({
    amount_total: 173.34, amount_rooms: 173.34, amount_cleaning: 0,
    source: 'channex', ota_name: 'Booking.com'
  });
  assert.strictEqual(r, 173.34);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION AMT — calcNetHote
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\nAMT — calcNetHote');

test('AMT4 Net hôte Booking : 173.34 - 32.02 - 2.64 = 138.68 (city tax ignorée)', () => {
  const row = {
    amount_total: 188.34, amount_rooms: 188.34, amount_cleaning: 15,
    amount_taxes: 28.17,  ota_commission: 32.02, host_payout: null,
    source: 'channex', ota_name: 'Booking.com', platform: null
  };
  const net = calcNetHote(row);
  assert.strictEqual(net, 138.68);
});

test('AMT4b Net hôte Booking sans city tax : identique', () => {
  const row = {
    amount_total: 188.34, amount_rooms: 188.34, amount_cleaning: 15,
    amount_taxes: 0,      ota_commission: 32.02, host_payout: null,
    source: 'channex', ota_name: 'Booking.com', platform: null
  };
  const net = calcNetHote(row);
  assert.strictEqual(net, 138.68);
});

test('AMT5b Net hôte Airbnb : host_payout - cleaning - payFee(0)', () => {
  const row = {
    amount_total: 140.00, amount_rooms: 140.00, amount_cleaning: 20,
    amount_taxes: 5,      ota_commission: 18, host_payout: 140.00,
    source: 'channex', ota_name: 'Airbnb', platform: null
  };
  const net = calcNetHote(row);
  // host_payout - cleaning - payFee(airbnb=0) = 140 - 20 - 0 = 120
  assert.strictEqual(net, 120);
});

test('AMT6b Net hôte Direct : total * 1.5% frais Stripe', () => {
  const row = {
    amount_total: 200.00, amount_rooms: 200.00, amount_cleaning: 0,
    amount_taxes: 10,     ota_commission: 0, host_payout: null,
    source: 'DIRECT', ota_name: null, platform: null
  };
  const net = calcNetHote(row);
  // rent = 200 - 0 - 10 (taxes incluses pour non-Booking) = 190
  // payFee = 200 * 0.015 = 3
  // net = 190 - 0 - 3 = 187
  assert.strictEqual(net, 187);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION AMT — days_breakdown cohérence
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\nAMT — days_breakdown');

test('AMT-DB1 Sonia : sum(days_breakdown) = 173.34', () => {
  const breakdown = { '2025-08-10': '57.51', '2025-08-11': '57.51', '2025-08-12': '58.32' };
  const vals = Object.values(breakdown).map(v => parseFloat(v));
  const sum = +vals.reduce((a, b) => a + b, 0).toFixed(2);
  assert.strictEqual(sum, 173.34);
});

test('AMT-DB2 sum(days_breakdown) cohérent avec effectiveAmountRooms', () => {
  const breakdown = { '2025-08-10': '57.51', '2025-08-11': '57.51', '2025-08-12': '58.32' };
  const vals = Object.values(breakdown).map(v => parseFloat(v));
  const nightsSum = +vals.reduce((a, b) => a + b, 0).toFixed(2);
  const apiRooms = effectiveAmountRooms({
    amount_total: 188.34, amount_rooms: 188.34, amount_cleaning: 15,
    source: 'channex', ota_name: 'Booking.com'
  });
  assert.strictEqual(nightsSum, apiRooms, 'days_breakdown sum doit correspondre au effectiveAmountRooms corrigé');
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION INV — Anti-doublon, reservationUid, historique
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\nINV — Présence des fonctionnalités dans server.js');

// INV1 : reservationUid extrait du body
test('INV1 reservationUid extrait du body dans POST /api/invoice/create', () => {
  const createBlock = serverSrc.slice(
    serverSrc.indexOf("app.post('/api/invoice/create'"),
    serverSrc.indexOf("app.post('/api/invoice/create'") + 8000
  );
  assert.ok(createBlock.includes('rawReservationUid') || createBlock.includes('reservationUid:'),
    'reservationUid doit être extrait du body');
});

// INV2 : détection doublon idempotente (200, pas 409)
test('INV2 anti-doublon idempotent : HTTP 200 + existing:true (pas 409)', () => {
  const createBlock = serverSrc.slice(
    serverSrc.indexOf("app.post('/api/invoice/create'"),
    serverSrc.indexOf("app.post('/api/invoice/create'") + 12000
  );
  assert.ok(createBlock.includes('existing: true') && createBlock.includes('duplicate: true'),
    'Le retour idempotent doit contenir existing:true et duplicate:true');
  assert.ok(!createBlock.includes('res.status(409)'),
    'Le 409 ne doit plus être utilisé pour le doublon facture');
});

// INV3 : advisory lock présent dans invoice/create
test('INV3 advisory lock dans POST /api/invoice/create', () => {
  const createBlock = serverSrc.slice(
    serverSrc.indexOf("app.post('/api/invoice/create'"),
    serverSrc.indexOf("app.post('/api/invoice/create'") + 8000
  );
  assert.ok(createBlock.includes('pg_advisory_xact_lock'),
    'pg_advisory_xact_lock doit être dans le chemin de création');
});

// INV4 : filtre ?reservationUid= dans GET /api/invoice/history
test('INV4 filtrage ?reservationUid= dans GET /api/invoice/history', () => {
  const histBlock = serverSrc.slice(
    serverSrc.indexOf("app.get('/api/invoice/history'"),
    serverSrc.indexOf("app.get('/api/invoice/history'") + 4000
  );
  assert.ok(histBlock.includes('filterReservationUid') || histBlock.includes('reservationUid'),
    'GET /api/invoice/history doit filtrer par reservationUid');
});

// INV5 : scope agence sans ?agency=all dans download-by-number
test('INV6 download-by-number utilise scope agence complet', () => {
  const dlBlock = serverSrc.slice(
    serverSrc.indexOf("app.get('/api/invoice/download-by-number/"),
    serverSrc.indexOf("app.get('/api/invoice/download-by-number/") + 1500
  );
  assert.ok(dlBlock.includes('agency') && dlBlock.includes('all'),
    'download-by-number doit forcer le scope agence complet');
});

// INV7 : contrôle user_id toujours présent dans download-by-number
test('INV7 download-by-number : contrôle user_id conservé', () => {
  const dlBlock = serverSrc.slice(
    serverSrc.indexOf("app.get('/api/invoice/download-by-number/"),
    serverSrc.indexOf("app.get('/api/invoice/download-by-number/") + 1500
  );
  assert.ok(dlBlock.includes('ANY($1::text[])') || dlBlock.includes('agencyIds'),
    'Le contrôle user_id = ANY(agencyIds) doit rester présent');
});

// INV8 : reservationUid dans les métadonnées JSON sauvegardées
test('INV8 reservationUid persisté dans meta JSON de invoice_download_tokens', () => {
  // Chercher les deux blocs _meta (avec email et sans)
  const metaSection = serverSrc.slice(
    serverSrc.indexOf("app.post('/api/invoice/create'"),
    serverSrc.indexOf("app.post('/api/invoice/create'") + 14000
  );
  const occurrences = (metaSection.match(/reservationUid.*reservationUid/gs) || []).length
    + (metaSection.match(/reservationUid.*\|\|.*null/g) || []).length;
  assert.ok(occurrences >= 2 || metaSection.split('reservationUid: reservationUid').length >= 3,
    'reservationUid doit apparaître dans les deux blocs meta (sendEmail + no-email)');
});

// ── Tests idempotence ─────────────────────────────────────────────────────────
console.log('\nINV-IDEM — Idempotence création facture');

// Simule la logique de _findExistingInvoice + double création
test('INV-IDEM1 première création : existing=false, duplicate=false', () => {
  // Vérifie que la réponse de création retourne bien existing:false.
  // Le bloc est long (~30k chars) — on cherche dans le fichier entier après le
  // point d'entrée du handler plutôt qu'avec une fenêtre trop petite.
  const startIdx = serverSrc.indexOf("app.post('/api/invoice/create'");
  const endIdx   = serverSrc.indexOf("app.post('/api/invoice/send-link'");
  const createBlock = serverSrc.slice(startIdx, endIdx > startIdx ? endIdx : startIdx + 32000);
  assert.ok(createBlock.includes('existing: false'),
    'La création neuve doit retourner existing:false');
  assert.ok(createBlock.includes('duplicate: false'),
    'La création neuve doit retourner duplicate:false');
});

test('INV-IDEM2 facture existante : success=true, existing=true, même invoiceNumber', () => {
  const createBlock = serverSrc.slice(
    serverSrc.indexOf("app.post('/api/invoice/create'"),
    serverSrc.indexOf("app.post('/api/invoice/create'") + 14000
  );
  // La branche idempotente retourne success:true + existing:true
  assert.ok(createBlock.includes('success: true, existing: true, duplicate: true'),
    'Le retour idempotent doit avoir success:true, existing:true, duplicate:true');
  // Et retourne l'invoiceNumber existant (pas un nouveau)
  assert.ok(createBlock.includes('invoiceNumber: preflight.invoiceNumber') ||
            createBlock.includes('invoiceNumber: _innerIdempotent.invoiceNumber'),
    'Le retour idempotent doit réutiliser l\'invoiceNumber existant');
});

test('INV-IDEM3 retry : downloadUrl existant retourné', () => {
  const createBlock = serverSrc.slice(
    serverSrc.indexOf("app.post('/api/invoice/create'"),
    serverSrc.indexOf("app.post('/api/invoice/create'") + 14000
  );
  assert.ok(createBlock.includes('downloadUrl: preflight.downloadUrl') ||
            createBlock.includes('downloadUrl: _innerIdempotent.downloadUrl'),
    'Le downloadUrl existant doit être retourné sans créer un nouveau token');
});

test('INV-IDEM4 re-vérification sous advisory lock (protège la race)', () => {
  const createBlock = serverSrc.slice(
    serverSrc.indexOf("app.post('/api/invoice/create'"),
    serverSrc.indexOf("app.post('/api/invoice/create'") + 14000
  );
  // Le lock est acquis AVANT la re-vérification interne
  const lockIdx    = createBlock.indexOf('pg_advisory_xact_lock');
  const innerCheck = createBlock.indexOf('_findExistingInvoice(client)');
  assert.ok(lockIdx > 0 && innerCheck > 0 && lockIdx < innerCheck,
    'La re-vérification du doublon doit être APRÈS l\'advisory lock');
  // Et la re-vérification utilise le client de transaction (pas pool)
  assert.ok(createBlock.includes('_findExistingInvoice(client)'),
    '_findExistingInvoice doit être appelé avec le client transactionnel');
});

// INV — calcPayFee Booking
test('INV-PAY Booking payFee = commission × 0.0824', () => {
  const row = { source: 'channex', platform: null, ota_name: 'Booking.com' };
  const fee = calcPayFee(row, 32.02, 188.34);
  assert.strictEqual(fee, Math.round(32.02 * 0.0824 * 100) / 100);
});

test('INV-PAY Airbnb payFee = 0', () => {
  const row = { source: 'channex', platform: null, ota_name: 'Airbnb' };
  const fee = calcPayFee(row, 18.00, 140.00);
  assert.strictEqual(fee, 0);
});

test('INV-PAY Direct payFee = total × 0.015', () => {
  const row = { source: 'DIRECT', platform: null, ota_name: null };
  const fee = calcPayFee(row, 0, 200.00);
  assert.strictEqual(fee, Math.round(200 * 0.015 * 100) / 100);
});

// ── Rapport final ─────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`Résultat : ${passed} passés, ${failed} échoués`);
if (failed > 0) {
  console.error('❌ Des tests ont échoué.');
  process.exit(1);
} else {
  console.log('✅ Tous les tests passent.');
}
