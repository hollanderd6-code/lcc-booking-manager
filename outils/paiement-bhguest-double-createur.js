#!/usr/bin/env node
/* ============================================================
   outils/paiement-bhguest-double-createur.js
   « Ces dates ne sont plus disponibles » juste apres avoir paye
   ============================================================
   Cible : server.js

   ── LE DEFAUT, ET LES LIGNES QUI LE PROUVENT ─────────────────────
   Deux morceaux de code creent la reservation d'un paiement BHGuest :

     1. le webhook Stripe — l.4890 `case 'checkout.session.completed'`,
        insertion `BHGUEST_${paymentId || session.id}` vers l.5128.
        Il part des l'encaissement, serveur a serveur. Il aboutit
        toujours. C'est lui qui envoie votre notification.

     2. /api/guest/confirm-after-payment — l.49341, appele par le
        NAVIGATEUR du voyageur a son retour de Stripe
        (guest-app/public/js/app-guest.js l.828).

   Le second ne sait pas que le premier est deja passe. Sa premiere
   verification est :

       SELECT id FROM reservations
        WHERE property_id = $1 AND status NOT IN ('cancelled')
          AND start_date < $3 AND end_date > $2        -- l.49370
       → 409 « Ces dates ne sont plus disponibles »

   Or ces nuits sont desormais occupees... par la reservation que le
   webhook vient de creer. Et aussi par la ligne HOLD_<token> de la
   pre-reservation, que rien n'a encore retiree.

   Consequences, toutes observees :
   • le voyageur lit « Reservation confirmee mais erreur: Ces dates ne
     sont plus disponibles » (le catch de app-guest.js l.848) et croit
     que son paiement a echoue ;
   • la fonction s'arrete sur ce 409, donc elle n'atteint JAMAIS sa
     propre liberation du hold (l.49473-49489 : `status='converted'`
     puis `DELETE FROM reservations WHERE uid = 'HOLD_'||token`) ;
   • la ligne HOLD_* survit donc a cote de la reservation payee : deux
     barres sur la meme nuit dans le calendrier.

   Le paiement, lui, est bien encaisse et la reservation bien creee.
   Le defaut est un faux negatif, pas une perte d'argent.

   ── LA CORRECTION ────────────────────────────────────────────────
   1. confirm-after-payment commence par demander « est-ce deja fait ? ».
      Si le webhook a cree la reservation, on la renvoie (succes,
      `already: true`) au lieu de la recreer ou de repondre 409.
   2. Sa verification de dispo ignore la pre-reservation du lien
      lui-meme (uid HOLD_*, source bhguest_hold) : ce n'est pas un
      conflit, c'est le lien qu'on est en train d'honorer.
   3. La verification equivalente du webhook (`existingResa`, l.5116)
      ignore les memes lignes : sinon une pre-reservation empeche le
      webhook de creer la vraie reservation.
   4. La liberation du hold devient une fonction unique,
      `bhLibererHold()`, appelee dans le webhook — le chemin qui
      aboutit toujours — et plus seulement au retour du navigateur.

   ── CE QUE CE LOT NE FAIT PAS ────────────────────────────────────
   Il ne rejoue pas les paiements passes. Les sejours deja payes dont
   la ligne HOLD_* traine encore doivent etre nettoyes une fois :
     SELECT uid, source, status, start_date, end_date FROM reservations
      WHERE uid LIKE 'HOLD_%' AND status NOT IN ('cancelled');
   puis DELETE des lignes dont les nuits sont couvertes par une
   reservation BHGUEST_* / GUEST_*.

   Usage :
     node outils/paiement-bhguest-double-createur.js --essai
     node outils/paiement-bhguest-double-createur.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'server.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('server.js introuvable. Lancez depuis la racine du projet.');
let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('async function bhLibererHold') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* ── Outils d'insertion, tolerants a l'indentation ───────────────── */

function uneSeuleFois(ancre, quoi) {
  const n = src.split(ancre).length - 1;
  if (n !== 1) echec(quoi + ' : ancre attendue 1 fois, ' + n + ' trouvee(s).\n    Ancre : ' + ancre.slice(0, 70));
  return src.indexOf(ancre);
}

function indentationDe(i) {
  const debut = src.lastIndexOf('\n', i - 1) + 1;
  return src.slice(debut, i).match(/^[ \t]*/)[0];
}

// Insere `texte` (lignes) juste avant la ligne qui contient `cible`,
// en reprenant son indentation. `cible` est cherchee apres `ancre`.
function insererAvant(ancre, cible, lignes, quoi, portee) {
  const i = uneSeuleFois(ancre, quoi);
  const j = src.indexOf(cible, i);
  if (j === -1) echec(quoi + ' : « ' + cible.slice(0, 50) + ' » introuvable apres l\'ancre.');
  if (j - i > (portee || 900)) echec(quoi + ' : cible trouvee trop loin de l\'ancre (' + (j - i) + ' car.).');
  const debutLigne = src.lastIndexOf('\n', j - 1) + 1;
  const ind = indentationDe(j);
  const bloc = lignes.map(l => (l ? ind + l : '')).join('\n') + '\n';
  src = src.slice(0, debutLigne) + bloc + src.slice(debutLigne);
  return true;
}

// Insere `lignes` juste APRES la ligne qui contient `ancre`.
function insererApres(ancre, lignes, quoi) {
  const i = uneSeuleFois(ancre, quoi);
  const finLigne = src.indexOf('\n', i);
  if (finLigne === -1) echec(quoi + ' : fin de ligne introuvable.');
  const ind = indentationDe(i);
  const bloc = '\n' + lignes.map(l => (l ? ind + l : '')).join('\n');
  src = src.slice(0, finLigne) + bloc + src.slice(finLigne);
  return true;
}

const detail = [];

/* ── 1. La fonction de liberation du hold ────────────────────────── */

const HELPER = [
  '// ============================================================',
  '// 🔓 BHGuest — liberer la pre-reservation d\'un lien',
  '// Le hold passe a \'converted\' et la ligne HOLD_<token> du calendrier',
  '// disparait. Idempotent, jamais bloquant. Appelee par le webhook Stripe',
  '// (chemin qui aboutit toujours) ET par confirm-after-payment.',
  '// ============================================================',
  'async function bhLibererHold(propertyId, checkin, checkout) {',
  '  try {',
  '    const holds = await pool.query(',
  '      `UPDATE bhguest_holds SET status = \'converted\'',
  '         WHERE property_id = $1 AND checkin = $2 AND checkout = $3',
  '           AND status IN (\'active\', \'expired\')',
  '       RETURNING link_token`,',
  '      [propertyId, checkin, checkout]',
  '    );',
  '    for (const h of holds.rows) {',
  '      if (!h.link_token) continue;',
  '      await pool.query(`DELETE FROM reservations WHERE uid = $1`, [\'HOLD_\' + h.link_token]);',
  '    }',
  '    if (holds.rowCount > 0) {',
  '      console.log(`🔓 [HOLD] ${holds.rowCount} pre-reservation(s) liberee(s) — ${propertyId} ${checkin}→${checkout}`);',
  '    }',
  '    return holds.rowCount;',
  '  } catch (e) {',
  '    console.warn(\'⚠️ [HOLD] Liberation non bloquante:\', e.message);',
  '    return 0;',
  '  }',
  '}',
  ''
];

insererAvant(
  "app.post('/api/guest/confirm-after-payment'",
  "app.post('/api/guest/confirm-after-payment'",
  HELPER,
  'insertion de bhLibererHold',
  10
);
detail.push('  bhLibererHold() ajoutee avant confirm-after-payment');

/* ── 2. confirm-after-payment : « est-ce deja fait ? » ───────────── */

const DEJA_FAIT = [
  '// ── Le paiement a-t-il DEJA ete traite ? ───────────────────────',
  '// Le webhook Stripe (checkout.session.completed) cree la reservation',
  '// BHGUEST_* des l\'encaissement, avant que le navigateur du voyageur',
  '// ne revienne ici. Sans ce test, la verification de dispo qui suit',
  '// voit cette reservation-la et repond 409 « plus disponibles » : le',
  '// voyageur lit « Reservation confirmee mais erreur » alors que tout',
  '// est en ordre, et la liberation du hold (plus bas) n\'a jamais lieu.',
  'try {',
  '  const dejaFait = await pool.query(`',
  '    SELECT r.uid, r.amount_total FROM reservations r',
  '      LEFT JOIN payments pay ON pay.reservation_uid = r.uid',
  '     WHERE r.property_id = $1 AND r.status NOT IN (\'cancelled\')',
  '       AND r.start_date = $2::date AND r.end_date = $3::date',
  '       AND (r.uid LIKE \'BHGUEST_%\'',
  '            OR ($4::text IS NOT NULL AND pay.stripe_session_id = $4::text))',
  '     ORDER BY r.created_at DESC LIMIT 1',
  '  `, [property_id, checkin, checkout, session_id || null]);',
  '  if (dejaFait.rows[0]) {',
  '    const dejaUid = dejaFait.rows[0].uid;',
  '    await bhLibererHold(property_id, checkin, checkout);',
  '    console.log(`✅ [GUEST] confirm: deja creee par le webhook (${dejaUid}) — rien a refaire`);',
  '    return res.json({',
  '      success: true, already: true, reservation_uid: dejaUid,',
  '      total_ttc: dejaFait.rows[0].amount_total != null ? parseFloat(dejaFait.rows[0].amount_total) : null',
  '    });',
  '  }',
  '} catch (dejaErr) {',
  '  console.warn(\'⚠️ [GUEST] confirm: test idempotence non bloquant:\', dejaErr.message);',
  '}',
  ''
];

insererAvant(
  "app.post('/api/guest/confirm-after-payment'",
  'const conflict = await pool.query(',
  DEJA_FAIT,
  'test d\'idempotence dans confirm-after-payment',
  2500
);
detail.push('  confirm-after-payment : renvoie la reservation du webhook au lieu d\'un 409');

/* ── 3. Les deux verifications ignorent la pre-reservation ───────── */

const EXCLUSIONS = [
  "AND COALESCE(uid,'') NOT LIKE 'HOLD_%'      -- la pre-reservation du lien",
  "AND COALESCE(source,'') <> 'bhguest_hold'   -- n'est pas un conflit"
];

insererAvant(
  "app.post('/api/guest/confirm-after-payment'",
  'AND start_date < $3 AND end_date > $2',
  EXCLUSIONS,
  'exclusion du hold dans la dispo de confirm-after-payment',
  6000
);
detail.push('  confirm-after-payment : la dispo ignore uid HOLD_* / source bhguest_hold');

insererAvant(
  'évite tout doublon avec confirm-after-payment',
  'AND start_date < $3 AND end_date > $2',
  EXCLUSIONS,
  'exclusion du hold dans la dispo du webhook',
  900
);
detail.push('  webhook : existingResa ignore uid HOLD_* / source bhguest_hold');

/* ── 4. Le webhook libere le hold lui-meme ──────────────────────── */

insererApres(
  '✅ [BHGUEST] Réservation créée: BHGUEST_${paymentId || session.id}',
  [
    '// La pre-reservation du lien a fait son office : on la libere ICI,',
    '// dans le chemin qui aboutit toujours, et plus seulement au retour',
    '// du navigateur du voyageur (qui peut ne jamais revenir).',
    'await bhLibererHold(propId, startDate, endDate);'
  ],
  'appel de bhLibererHold dans le webhook'
);
detail.push('  webhook : libere le hold apres creation de la reservation');

/* ── Verifications ──────────────────────────────────────────────── */

try { new Function(src.replace(/^#![^\n]*\n/, '')); }
catch (e) { echec('server.js ne serait plus du JavaScript valide — ' + e.message); }

if (src.indexOf('async function bhLibererHold') === -1) echec('bhLibererHold absente apres modification.');
if ((src.split('await bhLibererHold(').length - 1) < 2) echec('bhLibererHold n\'est pas appelee des deux cotes.');
if ((src.split("NOT LIKE 'HOLD_%'").length - 1) < 2) echec('Les exclusions de hold ne sont pas posees deux fois.');
if (src.indexOf('already: true') === -1) echec('Le test d\'idempotence est absent.');

if (!ESSAI) {
  const sauvegarde = CIBLE + '.avant-double-createur';
  if (!fs.existsSync(sauvegarde)) fs.writeFileSync(sauvegarde, fs.readFileSync(CIBLE));
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('async function bhLibererHold') === -1) {
    echec("La correction n'est pas dans le fichier apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '\u2014 ESSAI, aucune ecriture \u2014' : '\u2014 APPLIQUE ET VERIFIE \u2014'));
detail.forEach(l => console.log(l));
if (!ESSAI) console.log('  Sauvegarde : server.js.avant-double-createur (ne pas commiter)');
console.log('');
console.log('  A verifier apres deploiement, sur un lien BHGuest de test :');
console.log('  \u2022 le voyageur voit l\'ecran de confirmation, PAS « Reservation');
console.log('    confirmee mais erreur » ;');
console.log('  \u2022 dans les logs : « deja creee par le webhook » ou « Reservation');
console.log('    creee », puis « pre-reservation(s) liberee(s) » ;');
console.log('  \u2022 une seule barre dans le calendrier, a la couleur BHGuest.');
console.log('');
console.log('  Nettoyage unique des sejours deja payes :');
console.log("    SELECT uid, start_date, end_date FROM reservations");
console.log("     WHERE uid LIKE 'HOLD_%' AND status NOT IN ('cancelled');");
console.log('');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
