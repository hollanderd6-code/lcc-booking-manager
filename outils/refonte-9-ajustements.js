#!/usr/bin/env node
/* ============================================================
   outils/refonte-9-ajustements.js
   Lot 9 : trois corrections vues sur telephone
   ============================================================

   1. LES DEUX CARTES DU MOIS PARTENT
      « CA MENSUEL 19 111 € » et « OCCUPATION DU MOIS 32 % » quittent
      Aujourd'hui. Elles ne se lisent pas le matin : elles se consultent.
      Leur place est dans Argent, ou nous les remettrons ensemble.

      Elles sont MASQUEES, pas supprimees : bhAnnulerCartesMois() les
      ramene, et le code qui les alimente n'est pas touche.

   2. « CONDITION « DEPOSIT_ACTIVE,POLICE_COMPLETE » » N'EST PAS UNE PHRASE
      Votre serveur renvoie plusieurs conditions separees par une virgule.
      Je les affichais brutes, entre guillemets, avec le mot « Condition »
      devant — le nom technique, pas la raison.

      Desormais chaque condition devient sa propre pastille, en francais :

          deposit_active,police_complete
          -> « Caution a autoriser »  « Fiche police non signee »

      Une condition que je ne connais pas s'affiche telle quelle, sans
      habillage : un nom technique brut vaut mieux qu'une traduction
      inventee.

   3. LES COULEURS DES PLATEFORMES
      BOOKING en rouge et AIRBNB en vert, c'etait l'inverse du reflexe.
      Chaque badge prend la couleur de sa plateforme : rose Airbnb, bleu
      Booking, orange BHGuest. Fond clair, encre soutenue — le contraste
      reste lisible au soleil.

   Usage :
     node outils/refonte-9-ajustements.js --essai
     node outils/refonte-9-ajustements.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = process.cwd();
const PUBLIC = path.join(RACINE, 'public');
const APP = path.join(PUBLIC, 'app.html');
const LISTE = path.join(PUBLIC, 'js', 'bh-liste-unifiee.js');
const MODULE = path.join(PUBLIC, 'js', 'bh-cartes-mois.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(APP)) echec('public/app.html introuvable. Lancez depuis la racine du projet.');
if (!fs.existsSync(LISTE)) echec('bh-liste-unifiee.js absent. Lancez d\'abord le lot 8.');

/* ============================================================
   PARTIE 2 ET 3 — le module de la liste
   ============================================================ */

let liste = fs.readFileSync(LISTE, 'utf8');
let etatListe;

if (liste.indexOf('function causes(') !== -1) {
  etatListe = 'deja applique';
} else {
  const remplacer = (avant, apres, quoi) => {
    const n = liste.split(avant).length - 1;
    if (n !== 1) echec('\u00ab ' + quoi + ' \u00bb trouve ' + n + ' fois dans bh-liste-unifiee.js (attendu : 1).');
    liste = liste.split(avant).join(apres);
  };

  /* ── Les conditions, en francais et une par pastille ──────── */

  remplacer(
`  var CONDITIONS = {
    police_complete: 'Fiche police non signée',
    deposit_paid: 'Caution non payée',
    deposit_authorized: 'Caution non autorisée',
    contract_signed: 'Contrat non signé',
    checkin_completed: 'Enregistrement non terminé',
    id_verified: 'Pièce d identité non vérifiée'
  };

  function cause(a) {
    var c = a.condition_envoi;
    if (!c) return null;
    if (c === 'always') return 'Condition « always » — cause ailleurs';
    return CONDITIONS[c] || ('Condition « ' + c + ' »');
  }`,
`  var CONDITIONS = {
    deposit_active: 'Caution à autoriser',
    deposit_paid: 'Caution non payée',
    deposit_authorized: 'Caution non autorisée',
    police_complete: 'Fiche police non signée',
    contract_signed: 'Contrat non signé',
    checkin_completed: 'Enregistrement non terminé',
    id_verified: "Pièce d'identité non vérifiée"
  };

  /* Le serveur renvoie parfois plusieurs conditions separees par une
     virgule : « deposit_active,police_complete ». Chacune est une raison
     distincte, donc chacune sa pastille. Une condition inconnue passe
     telle quelle — un nom technique vaut mieux qu'une traduction
     inventee. */
  function causes(a) {
    var brut = a.condition_envoi;
    if (!brut) return [];
    var liste = String(brut).split(/[,+;|]/).map(function (x) { return x.trim(); }).filter(Boolean);
    if (!liste.length) return [];
    if (liste.length === 1 && liste[0] === 'always') return ['Envoi immédiat prévu — cause ailleurs'];
    var out = [];
    liste.forEach(function (c) {
      if (c === 'always') return;
      out.push(CONDITIONS[c] || c);
    });
    return out;
  }`,
    'les conditions d\'envoi'
  );

  remplacer(
`      var c = cause(a);
      if (a.message_envoye === false && c) out.push(pastille(c, 'ambre'));`,
`      if (a.message_envoye === false) {
        causes(a).forEach(function (c) { out.push(pastille(c, 'ambre')); });
      }`,
    'les pastilles de cause'
  );

  remplacer(
`        diag.a_traiter.push((a.property_name || '?') + ' / ' + (a.guest_name || '?') + ' — ' + (cause(a) || 'sans condition connue'));`,
`        diag.a_traiter.push((a.property_name || '?') + ' / ' + (a.guest_name || '?') + ' — ' + (causes(a).join(' + ') || 'sans condition connue'));`,
    'le diagnostic des causes'
  );

  /* ── Les couleurs des plateformes ──────────────────────────── */

  remplacer(
`    airbnb: { nom: 'AIRBNB', fond: '#E4EDE8', encre: '#0E3B2E' },
    abb: { nom: 'AIRBNB', fond: '#E4EDE8', encre: '#0E3B2E' },
    booking: { nom: 'BOOKING', fond: '#FBEAE4', encre: '#A8452A' },
    bookingcom: { nom: 'BOOKING', fond: '#FBEAE4', encre: '#A8452A' },
    bdc: { nom: 'BOOKING', fond: '#FBEAE4', encre: '#A8452A' },
    expedia: { nom: 'EXPEDIA', fond: '#EEF0F6', encre: '#3A4A6B' },
    boostinghost: { nom: 'BHGUEST', fond: '#F4EDE4', encre: '#8A5B14' },
    bhguest: { nom: 'BHGUEST', fond: '#F4EDE4', encre: '#8A5B14' }`,
`    airbnb: { nom: 'AIRBNB', fond: '#FCE7EC', encre: '#B81E4B' },
    abb: { nom: 'AIRBNB', fond: '#FCE7EC', encre: '#B81E4B' },
    booking: { nom: 'BOOKING', fond: '#E3EAF8', encre: '#123E86' },
    bookingcom: { nom: 'BOOKING', fond: '#E3EAF8', encre: '#123E86' },
    bdc: { nom: 'BOOKING', fond: '#E3EAF8', encre: '#123E86' },
    expedia: { nom: 'EXPEDIA', fond: '#EEF0F6', encre: '#3A4A6B' },
    boostinghost: { nom: 'BHGUEST', fond: '#FDEBDC', encre: '#A85413' },
    bhguest: { nom: 'BHGUEST', fond: '#FDEBDC', encre: '#A85413' }`,
    'les couleurs des plateformes'
  );

  [
    ['la fonction causes', 'function causes(a) {'],
    ['la caution active', "deposit_active: 'Caution à autoriser'"],
    ['le rose Airbnb', "encre: '#B81E4B'"],
    ['le bleu Booking', "encre: '#123E86'"],
    ['l\'orange BHGuest', "encre: '#A85413'"],
  ].forEach(function (c) {
    if (liste.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent apres modification.');
  });

  if (liste.indexOf('cause(a)') !== -1) echec('Un appel a l\'ancienne fonction cause() subsiste. Refus.');

  try {
    new Function(liste);
  } catch (e) {
    echec('bh-liste-unifiee.js ne serait plus du JavaScript valide — ' + e.message);
  }

  etatListe = 'conditions lisibles + couleurs des plateformes';
  if (!ESSAI) fs.writeFileSync(LISTE, liste, 'utf8');
}

/* ============================================================
   PARTIE 1 — les deux cartes du mois
   ============================================================ */

const SOURCE = `/* ============================================================
   bh-cartes-mois.js — « CA mensuel » et « Occupation » quittent le matin
   ============================================================
   Deux mesures de bilan sur un ecran d'action. Elles ne se lisent pas a
   9 h : elles se consultent. Leur place est dans Argent.

   Les cartes sont reperees par leur INTITULE, pas par un identifiant
   devine. Si l'intitule change, le module ne masque rien et le dit —
   plutot que de masquer la mauvaise carte.
   ============================================================ */
(function () {
  'use strict';

  if (window.__bhCartesMois) return;
  window.__bhCartesMois = true;

  var CIBLES = ['CA MENSUEL', 'OCCUPATION DU MOIS'];
  var mem = [];
  var diag = { masquees: [], introuvables: [], raison: '' };

  function normaliser(t) {
    return String(t || '').replace(/\\s+/g, ' ').trim().toUpperCase();
  }

  /* On part de l'intitule et on remonte jusqu'a la carte : le premier
     ancetre assez grand pour en etre une. */
  function carteDe(el) {
    var c = el;
    var garde = 0;
    while (c && c.parentElement && garde++ < 8) {
      var r = c.getBoundingClientRect();
      if (r.height >= 90 && r.width >= 120) return c;
      c = c.parentElement;
    }
    return null;
  }

  function trouver(intitule) {
    var noeuds = document.querySelectorAll('div, span, p, h1, h2, h3, h4, h5, h6, label');
    for (var i = 0; i < noeuds.length; i++) {
      var n = noeuds[i];
      if (n.children.length) continue;
      if (normaliser(n.textContent) === intitule) return n;
    }
    return null;
  }

  function masquer() {
    if (diag.masquees.length === CIBLES.length) return true;
    var faits = 0;

    CIBLES.forEach(function (intitule) {
      if (diag.masquees.indexOf(intitule) !== -1) return;
      var titre = trouver(intitule);
      if (!titre) { if (diag.introuvables.indexOf(intitule) === -1) diag.introuvables.push(intitule); return; }
      var c = carteDe(titre);
      if (!c) { diag.raison = 'carte introuvable autour de ' + intitule; return; }

      mem.push({ el: c, valeur: c.style.getPropertyValue('display'), priorite: c.style.getPropertyPriority('display') });
      c.style.setProperty('display', 'none', 'important');
      diag.masquees.push(intitule);
      var pos = diag.introuvables.indexOf(intitule);
      if (pos !== -1) diag.introuvables.splice(pos, 1);
      faits++;
    });

    return faits > 0;
  }

  window.bhAnnulerCartesMois = function () {
    for (var i = mem.length - 1; i >= 0; i--) {
      var m = mem[i];
      if (m.valeur) m.el.style.setProperty('display', m.valeur, m.priorite);
      else m.el.style.removeProperty('display');
    }
    var n = mem.length;
    mem = [];
    diag.masquees = [];
    console.log(n + ' carte(s) rendue(s) : CA mensuel et Occupation du mois sont revenues.');
    return n;
  };

  window.bhVerifCartesMois = function () {
    var res = {
      masquees: diag.masquees,
      introuvables: diag.introuvables,
      annulable: mem.length + ' changement(s) memorise(s)',
      raison: diag.raison
    };
    console.log('── Cartes du mois ──');
    console.log(res);
    if (diag.introuvables.length) {
      console.warn('Intitule(s) non trouve(s) : ' + diag.introuvables.join(', ')
        + ' — rien n a ete masque pour eux, aucune carte au hasard.');
    }
    console.log('Pour revenir en arriere : bhAnnulerCartesMois()');
    return res;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(masquer, 1600); });
  } else {
    setTimeout(masquer, 1600);
  }
  setTimeout(masquer, 3400);
  setTimeout(masquer, 6000);
})();
`;

const BALISE = '<script src="js/bh-cartes-mois.js"></script>';

let html = fs.readFileSync(APP, 'utf8');
let etatApp;

if (html.indexOf('bh-cartes-mois.js') !== -1) {
  etatApp = 'balise deja presente';
} else {
  const ancre = html.indexOf('bh-liste-unifiee.js');
  if (ancre === -1) echec('bh-liste-unifiee.js absent de app.html. Lancez d\'abord le lot 8.');
  const fin = html.indexOf('</script>', ancre);
  if (fin === -1) echec('Balise mal formee dans app.html.');
  const pos = fin + '</script>'.length;
  html = html.slice(0, pos) + '\n' + BALISE + html.slice(pos);
  etatApp = 'balise ajoutee apres bh-liste-unifiee.js';
  if (!ESSAI) fs.writeFileSync(APP, html, 'utf8');
}

if (!ESSAI) {
  fs.writeFileSync(MODULE, SOURCE, 'utf8');
  const relu = fs.readFileSync(MODULE, 'utf8');
  if (relu.indexOf('bhAnnulerCartesMois') === -1) echec("Le module n'est pas complet apres ecriture.");
  try { new Function(relu); } catch (e) { echec('Module invalide — ' + e.message); }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  public/js/bh-liste-unifiee.js  ' + etatListe);
console.log('  public/js/bh-cartes-mois.js    (' + Math.round(SOURCE.length / 1024) + ' Ko)');
console.log('  app.html                       ' + etatApp);
console.log('\n  1. « deposit_active,police_complete » devient deux pastilles :');
console.log('     « Caution a autoriser »  « Fiche police non signee »');
console.log('  2. Rose Airbnb, bleu Booking, orange BHGuest.');
console.log('  3. CA mensuel et Occupation du mois sont masques sur Aujourd\'hui.');
console.log('\n  Les cartes sont reperees par leur intitule. Si l\'intitule a');
console.log('  change, rien n\'est masque et bhVerifCartesMois() le nomme :');
console.log('  aucune carte au hasard.');
console.log('\n  A verifier sur telephone, cache vide :');
console.log('    bhVerifCartesMois()      masquees: 2');
console.log('    bhVerifListeUnifiee()    a_traiter avec les causes en clair');
console.log('\n  Annulation : bhAnnulerCartesMois()  /  bhAnnulerListe()\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
