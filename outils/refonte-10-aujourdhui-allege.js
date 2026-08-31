#!/usr/bin/env node
/* ============================================================
   outils/refonte-10-aujourdhui-allege.js
   Lot 10 : Aujourd'hui ne garde que ce qui se fait aujourd'hui
   ============================================================

   ── CE QUI PART DE L'ECRAN ───────────────────────────────────────
       « Votre journee » + la date         doublon de l'en-tete
       CA mensuel                          -> Calendrier
       Occupation du mois                  -> Calendrier
       Automatisation (453 / 482)          -> Messages
       Calendrier des reservations         -> Calendrier

   Il reste l'en-tete, les trois compteurs, la bande de sept jours et la
   liste du jour. Un ecran d'action, sans bilan.

   ── CE QUE « DEPLACER » VEUT DIRE ICI, HONNETEMENT ───────────────
   Calendrier, c'est reservations.html. Messages, c'est messages.html.
   Ce sont des PAGES distinctes, pas des onglets d'une meme page : un
   noeud du DOM ne traverse pas une navigation.

   Ce lot fait donc la moitie qui est sure : les cinq blocs quittent
   Aujourd'hui, masques et reversibles. Rien n'est recopie, rien n'est
   fige.

   Pour l'autre moitie — les reconstruire sur leur page d'arrivee — il me
   faut leur source. Ces cartes sont ecrites dans app.html, pas dans un
   module, et app.html fait 775 Ko : je ne vais pas deviner quel appel
   les alimente.

   Le module fait l'inventaire pour nous. Avant de masquer un bloc, il
   releve tous les identifiants qu'il contient et leur valeur affichee.
   Apres deploiement :

       bhVerifAllege().valeurs

   Collez-moi cette sortie : elle me donne les identifiants exacts, et le
   lot 11 reconstruit les deux KPI sur Calendrier et l'automatisation sur
   Messages — a partir de la meme source, sans chiffre recopie.

   Une commande qui aide autant, en local :

       grep -n "CA MENSUEL\\|OCCUPATION DU MOIS\\|AUTOMATISATION" public/app.html

   ── REPERAGE ─────────────────────────────────────────────────────
   Chaque bloc est trouve par son INTITULE, puis remonte jusqu'au
   premier niveau de la page — le niveau dont le parent porte aussi
   l'en-tete. Un bloc qui engloberait l'en-tete est refuse : mieux vaut
   ne rien masquer que masquer la page.

   ── REVERSIBLE ───────────────────────────────────────────────────
   bhAnnulerAllege()   tout revient
   bhVerifAllege()     ce qui est parti, ce qui a resiste, et l'inventaire

   Usage :
     node outils/refonte-10-aujourdhui-allege.js --essai
     node outils/refonte-10-aujourdhui-allege.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(process.cwd(), 'public');
const APP = path.join(PUBLIC, 'app.html');
const MODULE = path.join(PUBLIC, 'js', 'bh-aujourdhui-allege.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(APP)) echec('public/app.html introuvable. Lancez depuis la racine du projet.');
if (!fs.existsSync(path.join(PUBLIC, 'js', 'bh-entete-jour.js'))) {
  echec('bh-entete-jour.js absent : le repere de premier niveau manque. Lancez les lots precedents.');
}

const SOURCE = `/* ============================================================
   bh-aujourdhui-allege.js — l'ecran du matin, sans les bilans
   ============================================================
   Cinq blocs quittent Aujourd'hui. Deux d'entre eux ont leur place sur
   Calendrier, un sur Messages — mais ce sont d'autres pages : ce module
   ne fait que le depart, proprement et reversiblement.

   Avant de masquer, il releve les identifiants et les valeurs de chaque
   bloc. C'est ce qui permettra de les reconstruire ailleurs sans
   recopier un chiffre mort.
   ============================================================ */
(function () {
  'use strict';

  if (window.__bhAujourdhuiAllege) return;
  window.__bhAujourdhuiAllege = true;

  var CIBLES = [
    { cle: 'journee', motif: 'VOTRE JOURN', vers: 'doublon de l en-tete' },
    { cle: 'ca_mensuel', motif: 'CA MENSUEL', vers: 'Calendrier' },
    { cle: 'occupation', motif: 'OCCUPATION DU MOIS', vers: 'Calendrier' },
    { cle: 'automatisation', motif: 'AUTOMATISATION', vers: 'Messages' },
    { cle: 'calendrier', motif: 'CALENDRIER DES R', vers: 'Calendrier' }
  ];

  var mem = [];
  var diag = { masques: [], refuses: [], introuvables: [], valeurs: {} };

  function normaliser(t) {
    return String(t || '').replace(/\\s+/g, ' ').trim().toUpperCase();
  }

  function repere() {
    return document.getElementById('bhEnteteJour') || document.getElementById('bhBandeJours');
  }

  /* L'intitule : une feuille de texte, courte, qui commence par le
     motif. Court, sinon on attrape le conteneur entier. */
  function trouverIntitule(motif) {
    var noeuds = document.querySelectorAll('div, span, p, h1, h2, h3, h4, h5, h6, label, strong');
    for (var i = 0; i < noeuds.length; i++) {
      var n = noeuds[i];
      if (n.children.length > 2) continue;
      var t = normaliser(n.textContent);
      if (t.length > 70) continue;
      if (t.indexOf(motif) === 0) return n;
    }
    return null;
  }

  /* Le bloc de premier niveau : on remonte jusqu'au noeud dont le PARENT
     porte aussi l'en-tete. C'est le frere des autres sections de la
     page — ni la carte interieure, ni la page entiere. */
  function blocDe(el) {
    var r = repere();
    if (!r) return null;
    var c = el;
    var garde = 0;
    while (c && c.parentElement && c !== document.body && garde++ < 14) {
      if (c.contains(r)) return null;
      if (c.parentElement.contains(r)) return c;
      c = c.parentElement;
    }
    return null;
  }

  /* L'inventaire, pris AVANT de masquer : identifiants et valeurs
     affichees. C'est ce qui servira a reconstruire ces blocs sur leur
     page d'arrivee, sans figer un chiffre. */
  function inventaire(bloc) {
    var out = {};
    var avecId = bloc.querySelectorAll('[id]');
    for (var i = 0; i < avecId.length && i < 40; i++) {
      var e = avecId[i];
      var t = normaliser(e.textContent);
      out[e.id] = t.length > 60 ? t.slice(0, 60) + '…' : t;
    }
    if (!Object.keys(out).length) out['(aucun identifiant)'] = normaliser(bloc.textContent).slice(0, 80);
    return out;
  }

  function masquer() {
    if (!repere()) return false;
    var faits = 0;

    CIBLES.forEach(function (cible) {
      if (diag.masques.indexOf(cible.cle) !== -1) return;

      var titre = trouverIntitule(cible.motif);
      if (!titre) {
        if (diag.introuvables.indexOf(cible.cle) === -1) diag.introuvables.push(cible.cle);
        return;
      }

      var bloc = blocDe(titre);
      if (!bloc) {
        if (diag.refuses.indexOf(cible.cle) === -1) {
          diag.refuses.push(cible.cle + ' : aucun bloc de premier niveau sur — rien masque');
        }
        return;
      }

      /* Un bloc qui contiendrait l'intitule d'une autre cible masquerait
         plus que demande. On s'abstient. */
      var deTrop = null;
      CIBLES.forEach(function (autre) {
        if (autre.cle === cible.cle || deTrop) return;
        var t = trouverIntitule(autre.motif);
        if (t && bloc.contains(t) && autre.cle !== 'journee') deTrop = autre.cle;
      });
      if (deTrop) {
        if (diag.refuses.indexOf(cible.cle) === -1) {
          diag.refuses.push(cible.cle + ' : engloberait ' + deTrop + ' — rien masque');
        }
        return;
      }

      diag.valeurs[cible.cle] = inventaire(bloc);
      mem.push({ el: bloc, valeur: bloc.style.getPropertyValue('display'), priorite: bloc.style.getPropertyPriority('display') });
      bloc.style.setProperty('display', 'none', 'important');
      diag.masques.push(cible.cle);

      var pos = diag.introuvables.indexOf(cible.cle);
      if (pos !== -1) diag.introuvables.splice(pos, 1);
      faits++;
    });

    return faits > 0;
  }

  window.bhAnnulerAllege = function () {
    for (var i = mem.length - 1; i >= 0; i--) {
      var m = mem[i];
      if (m.valeur) m.el.style.setProperty('display', m.valeur, m.priorite);
      else m.el.style.removeProperty('display');
    }
    var n = mem.length;
    mem = [];
    diag.masques = [];
    console.log(n + ' bloc(s) rendu(s) a Aujourd\\'hui.');
    return n;
  };

  window.bhVerifAllege = function () {
    var res = {
      masques: diag.masques,
      refuses: diag.refuses,
      introuvables: diag.introuvables,
      valeurs: diag.valeurs,
      annulable: mem.length + ' bloc(s) memorise(s)'
    };
    console.log('── Aujourd\\'hui allege ──');
    console.log(res);
    console.log('Inventaire pour la reconstruction (a me coller) :');
    console.log(JSON.stringify(diag.valeurs, null, 1));
    if (diag.refuses.length) console.warn('Refus : ' + diag.refuses.join(' | '));
    if (diag.introuvables.length) console.warn('Intitules non trouves : ' + diag.introuvables.join(', '));
    console.log('Pour revenir en arriere : bhAnnulerAllege()');
    return res;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(masquer, 2000); });
  } else {
    setTimeout(masquer, 2000);
  }
  setTimeout(masquer, 3800);
  setTimeout(masquer, 6400);
  setTimeout(masquer, 9000);
})();
`;

const BALISE = '<script src="js/bh-aujourdhui-allege.js"></script>';

let html = fs.readFileSync(APP, 'utf8');
let etatApp;

if (html.indexOf('bh-aujourdhui-allege.js') !== -1) {
  etatApp = 'balise deja presente';
} else {
  let ancre = html.indexOf('bh-cartes-mois.js');
  let nom = 'bh-cartes-mois.js';
  if (ancre === -1) { ancre = html.indexOf('bh-liste-unifiee.js'); nom = 'bh-liste-unifiee.js'; }
  if (ancre === -1) { ancre = html.indexOf('bh-listes-jour.js'); nom = 'bh-listes-jour.js'; }
  if (ancre === -1) echec('Aucun module des lots precedents dans app.html.');
  const fin = html.indexOf('</script>', ancre);
  if (fin === -1) echec('Balise mal formee dans app.html.');
  const pos = fin + '</script>'.length;
  html = html.slice(0, pos) + '\n' + BALISE + html.slice(pos);
  etatApp = 'balise ajoutee apres ' + nom;
  if (!ESSAI) fs.writeFileSync(APP, html, 'utf8');
}

if (!ESSAI) {
  fs.writeFileSync(MODULE, SOURCE, 'utf8');
  const relu = fs.readFileSync(MODULE, 'utf8');
  if (relu.indexOf('bhAnnulerAllege') === -1) echec("Le module n'est pas complet apres ecriture.");
  try { new Function(relu); } catch (e) { echec('Module invalide — ' + e.message); }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  public/js/bh-aujourdhui-allege.js  (' + Math.round(SOURCE.length / 1024) + ' Ko)');
console.log('  app.html                           ' + etatApp);
console.log('\n  Quittent Aujourd\'hui : « Votre journee » et sa date, CA mensuel,');
console.log('  Occupation du mois, Automatisation, Calendrier des reservations.');
console.log('\n  Ce lot ne fait que le DEPART. Calendrier et Messages sont des');
console.log('  pages distinctes (reservations.html, messages.html) : un bloc du');
console.log('  DOM ne traverse pas une navigation. La reconstruction sur leur');
console.log('  page d\'arrivee est le lot 11 — et pour l\'ecrire il me faut leur');
console.log('  source, que ce module releve pour nous :');
console.log('');
console.log('  bhVerifAllege().valeurs');
console.log('');
console.log('  Collez-moi la sortie. En local, ceci aide autant :');
console.log('');
console.log('  grep -n "CA MENSUEL\\|OCCUPATION DU MOIS\\|AUTOMATISATION" public/app.html');
console.log('');
console.log('  Garde-fou : un bloc qui engloberait l\'en-tete ou une autre');
console.log('  cible est refuse et nomme. Rien n\'est masque au hasard.');
console.log('  Annulation : bhAnnulerAllege()\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
