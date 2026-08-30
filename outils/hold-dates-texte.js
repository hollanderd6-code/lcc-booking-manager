#!/usr/bin/env node
/* ============================================================
   outils/hold-dates-texte.js
   Les nuits d'un hold n'arrivaient jamais chez Channex
   ============================================================
   Cible : server.js  (les requetes qui lisent bhguest_holds)

   ── LE DEFAUT, ET LA LIGNE QUI LE PROUVE ─────────────────────────
   Test du 30 aout, 20:19, lien BHGuest sur M13 du 5 au 6 novembre :

       📅 [CHANNEX] Push disponibilites … (83 dates bloquees)
       ✓  [CHANNEX] Blocage relu et confirme (4 nuits a 0)

   83 annoncees, 4 envoyees a 0. Les nuits du hold manquaient — et
   Channex affichait bien AVL = 1 sur le 5 novembre.

   La cause est une ligne d'ecart entre deux requetes voisines :

       -- reservations : converties en TEXTE
       to_char(start_date AT TIME ZONE 'Europe/Paris','YYYY-MM-DD') as s
       -- holds : lues BRUTES
       SELECT checkin as s, checkout as e FROM bhguest_holds

   node-postgres renvoie une colonne DATE comme objet Date JavaScript.
   Le code fait ensuite :

       new Date(r.s + 'T00:00:00')

   Sur un objet Date, cette concatenation donne
   « Thu Nov 05 2026 00:00:00 GMT+0100 (…)T00:00:00 » : une date
   INVALIDE. La boucle « for (d = invalide ; d < invalide ; …) » ne
   s'execute pas une seule fois. Le hold contribue zero nuit, sans
   erreur, sans avertissement.

   Les reservations, elles, ont le to_char : elles ont toujours
   fonctionne. C'est pourquoi le produit avait l'air correct.

   ── LA CORRECTION ────────────────────────────────────────────────
   Les memes to_char sur les colonnes des holds. Aucune logique
   touchee : ces requetes renvoient desormais du texte 'AAAA-MM-JJ',
   ce que le code attendait depuis le debut.

   checkin/checkout sont des DATE sans fuseau : pas de AT TIME ZONE
   ici, il decalerait la nuit d'un jour.

   ── CE QUE CE LOT NE FAIT PAS ────────────────────────────────────
   Il ne rejoue pas les blocages perdus. Apres deploiement, le prochain
   envoi sur chaque logement remettra les holds actifs a 0 — et le lot
   precedent (relecture) le confirmera dans les logs.

   Usage :
     node outils/hold-dates-texte.js --essai
     node outils/hold-dates-texte.js
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

if (src.indexOf("to_char(checkin,'YYYY-MM-DD')") !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

const TC = "to_char(checkin,'YYYY-MM-DD')";
const TO = "to_char(checkout,'YYYY-MM-DD')";

/* Les deux ecritures presentes dans server.js, avec leurs alias. */
const REGLES = [
  {
    quoi: 'les holds du sync Channex (start_str / end_str)',
    avant: 'SELECT checkin as start_str, checkout as end_str FROM bhguest_holds',
    apres: 'SELECT ' + TC + ' as start_str, ' + TO + ' as end_str FROM bhguest_holds'
  },
  {
    quoi: 'les holds des envois directs (s / e)',
    avant: 'SELECT checkin as s, checkout as e FROM bhguest_holds',
    apres: 'SELECT ' + TC + ' as s, ' + TO + ' as e FROM bhguest_holds'
  }
];

let total = 0;
const detail = [];

REGLES.forEach(function (r) {
  const n = src.split(r.avant).length - 1;
  if (n > 0) {
    src = src.split(r.avant).join(r.apres);
    total += n;
    detail.push('  ' + String(n).padStart(2) + ' \u00d7  ' + r.quoi);
  }
});

if (total === 0) {
  echec("Aucune requete a corriger n'a ete trouvee. Attendu, entre autres :\n"
      + '    SELECT checkin as s, checkout as e FROM bhguest_holds\n'
      + '    Envoyez-moi : grep -n "FROM bhguest_holds" server.js');
}

/* ── Verifications ───────────────────────────────────────────────── */

try { new Function(src.replace(/^#![^\n]*\n/, '')); }
catch (e) { echec('server.js ne serait plus du JavaScript valide — ' + e.message); }

if (src.indexOf('SELECT checkin as s, checkout as e FROM bhguest_holds') !== -1
 || src.indexOf('SELECT checkin as start_str, checkout as end_str FROM bhguest_holds') !== -1) {
  echec('Une lecture brute des dates de hold subsiste.');
}
if (src.indexOf(TC) === -1) echec('Verification : le to_char sur checkin est absent apres modification.');

/* Un AT TIME ZONE sur ces colonnes decalerait la nuit : on s'assure de
   ne pas l'avoir introduit. */
if (src.indexOf("to_char(checkin AT TIME ZONE") !== -1) {
  echec('Un AT TIME ZONE a ete introduit sur checkin : risque de decalage d\'un jour.');
}

if (!ESSAI) {
  const sauvegarde = CIBLE + '.avant-hold-dates';
  if (!fs.existsSync(sauvegarde)) fs.writeFileSync(sauvegarde, fs.readFileSync(CIBLE));
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf(TC) === -1) {
    echec("La correction n'est pas dans le fichier apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  ' + total + ' requete(s) corrigee(s) :');
detail.forEach(l => console.log(l));
if (!ESSAI) console.log('  Sauvegarde : server.js.avant-hold-dates (ne pas commiter)');
console.log('');
console.log('  A verifier apres deploiement : refaites un lien BHGuest sur une date');
console.log('  lointaine. Dans les logs, le compte des nuits relues doit AUGMENTER');
console.log('  du nombre de nuits du hold :');
console.log('    📅 Push disponibilites … (N dates bloquees)');
console.log('    ✓  Blocage relu et confirme (M nuits a 0)      M inclut vos nuits');
console.log('  Puis, pour la preuve exterieure :');
console.log('    node outils/channex-dispo.js <channex_property_id> <date> <date>');
console.log('  La nuit doit etre a 0, et le calendrier Airbnb fermé.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
