#!/usr/bin/env node
/* ============================================================
   outils/hold-conversion-compte.js
   Le hold payé n'était jamais converti : mauvais compte dans l'UPDATE
   ============================================================
   Cible : server.js — les trois conversions de hold (~5284, ~46262, ~49499)

     node outils/hold-conversion-compte.js --essai
     node outils/hold-conversion-compte.js

   ── LE DÉFAUT, PROUVÉ EN BASE ────────────────────────────────────
   Hold 41b98cfb… sur M3, 19→20 septembre, payé (réservation guest_app
   « Ania messadene » confirmée). Le hold est pourtant resté 'active' :
   le calendrier affiche « Pré-réservation » à côté de la réservation
   payée, et l'app iOS dessine deux lignes superposées.

   Les trois UPDATE de conversion portent la même condition :

       AND status = 'active' AND user_id = $4

   avec, selon le site, $4 = prop.owner_user_id ou ownerId. Or :

     · properties n'a PAS de colonne owner_user_id — elle a user_id et
       owner_id. prop.owner_user_id vaut donc undefined, que pg envoie
       en NULL. « user_id = NULL » n'est vrai pour aucune ligne : ce
       chemin n'a jamais converti un seul hold.

     · le site du webhook passe ownerId, le compte propriétaire du
       logement (u_mmj5c6hq). Mais le hold porte le compte qui a CRÉÉ
       LE LIEN (u_mmtl7m45, le compte agence). Deux comptes légitimes,
       jamais égaux : là non plus la conversion ne pouvait aboutir.

   Personne ne l'a vu parce que le hold expire de lui-même au bout de
   4h : la double ligne disparaît « toute seule », ce qui ressemble à
   un retard d'affichage plutôt qu'à un défaut.

   ── LA CORRECTION ────────────────────────────────────────────────
   La condition de compte est SUPPRIMÉE, pas réparée. Sur un logement
   donné, à des dates données, un hold encore 'active' est forcément
   celui que l'on vient de payer : deux comptes ne peuvent pas tenir le
   même logement aux mêmes nuits. Le compte n'apportait aucune
   sécurité — seulement une occasion de se tromper, saisie deux fois.

   Le reste du bloc ne bouge pas : suppression de la réservation
   HOLD_xxx, rafraîchissement du calendrier, journalisation.

   ── CE QUE CE SCRIPT NE FAIT PAS ─────────────────────────────────
   Il ne nettoie pas les holds déjà bloqués en 'active'. La requête de
   rattrapage est imprimée à la fin, à lancer une fois, en connaissance
   de cause.
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

if (src.indexOf('HOLD_CONVERSION_SANS_COMPTE') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* ── Site 1 et 2 : conversions « prop.owner_user_id » (texte identique) ── */
const A1 = `        \`UPDATE bhguest_holds SET status = 'converted'
         WHERE property_id = $1 AND checkin = $2 AND checkout = $3
           AND status = 'active' AND user_id = $4 RETURNING link_token\`,
        [property_id, checkin, checkout, prop.owner_user_id]`;

const N1 = `        /* HOLD_CONVERSION_SANS_COMPTE — la condition « user_id = $4 » ne pouvait
           jamais etre vraie : prop.owner_user_id n'existe pas (properties a
           user_id et owner_id), donc pg recevait NULL. Et quand le lien est cree
           depuis un compte AGENCE, le hold porte ce compte, pas le proprietaire
           du logement : meme reparee, la comparaison aurait echoue. Logement +
           dates + status='active' identifient le hold sans ambiguite. */
        \`UPDATE bhguest_holds SET status = 'converted'
         WHERE property_id = $1 AND checkin = $2 AND checkout = $3
           AND status = 'active' RETURNING link_token\`,
        [property_id, checkin, checkout]`;

const n1 = src.split(A1).length - 1;
if (n1 === 0) echec("Les conversions « prop.owner_user_id » sont introuvables. server.js a change.");
src = src.split(A1).join(N1);

/* ── Site 3 : conversion du webhook Stripe (« ownerId », sans espaces) ── */
const A2 = `                      \`UPDATE bhguest_holds SET status='converted'
                         WHERE property_id=$1 AND checkin=$2 AND checkout=$3
                           AND status='active' AND user_id=$4 RETURNING link_token\`,
                      [propId, startDate, endDate, ownerId]`;

const N2 = `                      /* HOLD_CONVERSION_SANS_COMPTE — ownerId est le proprietaire du
                         logement ; le hold porte le compte qui a cree le lien, qui peut
                         etre un compte agence. La comparaison echouait donc en mode
                         agence, et le hold survivait jusqu'a son expiration (4h). */
                      \`UPDATE bhguest_holds SET status='converted'
                         WHERE property_id=$1 AND checkin=$2 AND checkout=$3
                           AND status='active' RETURNING link_token\`,
                      [propId, startDate, endDate]`;

const n2 = src.split(A2).length - 1;
if (n2 === 0) echec("La conversion du webhook (« ownerId ») est introuvable. server.js a change.");
src = src.split(A2).join(N2);

/* ── Verifications ───────────────────────────────────────────────── */
try { new Function(src.replace(/^#![^\n]*\n/, '')); }
catch (e) { echec('server.js ne serait plus du JavaScript valide — ' + e.message); }

if (/UPDATE bhguest_holds SET status\s*=\s*'converted'[\s\S]{0,200}?user_id\s*=\s*\$4/.test(src)) {
  echec('Une conversion filtre encore sur user_id = $4.');
}
if (src.indexOf('HOLD_CONVERSION_SANS_COMPTE') === -1) echec('Le marqueur est absent apres modification.');

/* La suppression de la pre-resa et la journalisation doivent survivre. */
['HOLD_\' + hold.link_token', '[HOLD] Converti'].forEach(t => {
  if (src.indexOf(t) === -1) echec('Un morceau du bloc a ete perdu : ' + t);
});

if (!ESSAI) {
  const sauvegarde = CIBLE + '.avant-hold-conversion';
  if (!fs.existsSync(sauvegarde)) fs.writeFileSync(sauvegarde, fs.readFileSync(CIBLE));
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('HOLD_CONVERSION_SANS_COMPTE') === -1) {
    echec("La correction n'est pas dans le fichier apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log(`  ${n1} conversion(s) « prop.owner_user_id » + ${n2} conversion(s) webhook corrigee(s).`);
if (!ESSAI) console.log('  Sauvegarde : server.js.avant-hold-conversion (ne pas commiter)');
console.log('');
console.log('  RATTRAPAGE des holds deja bloques — a lancer UNE fois, apres relecture :');
console.log('');
console.log("    UPDATE bhguest_holds h SET status = 'converted'");
console.log("     WHERE h.status = 'active'");
console.log('       AND EXISTS (SELECT 1 FROM reservations r');
console.log("                    WHERE r.property_id = h.property_id");
console.log("                      AND r.source = 'guest_app' AND r.status != 'cancelled'");
console.log('                      AND r.start_date::date = h.checkin::date');
console.log('                      AND r.end_date::date   = h.checkout::date);');
console.log('');
console.log('  Puis, apres redemarrage, testez un lien BHGuest de bout en bout :');
console.log('  a l\'instant du paiement la ligne « Pre-reservation » doit disparaitre,');
console.log('  remplacee par la reservation au nom du voyageur — sur le web et sur iOS,');
console.log('  sans changement cote application.');
console.log('');
console.log('  A verifier separement : prop.owner_user_id sert aussi de user_id a la');
console.log('  reservation creee (INSERT INTO reservations … prop.owner_user_id). Si la');
console.log('  requete qui charge `prop` ne l\'alias pas, ces reservations naissent avec');
console.log('  user_id NULL et n\'apparaissent chez personne :');
console.log('    grep -n "owner_user_id" server.js\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
