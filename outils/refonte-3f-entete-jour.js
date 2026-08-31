#!/usr/bin/env node
/* ============================================================
   outils/refonte-3f-entete-jour.js
   Lot 3f : le titre de la maquette, et la bande remontee
   ============================================================

   ── CE QUE VOUS VOYEZ AUJOURD'HUI ────────────────────────────────
   La page ouvre sur « Votre journee », une carte de six mesures qui
   occupe presque tout l'ecran. La bande de sept jours arrive apres —
   il faut defiler pour voir le calendrier que vous consultez le plus.

   ── CE QUE FAIT LE LOT ───────────────────────────────────────────
   Deux gestes, aucun contenu supprime.

   1. Un en-tete comme la maquette : la date en petit, « Aujourd'hui »
      en grand. Il remplace le titre « Votre journee » enferme dans la
      carte, et donne a la page un point de depart au lieu d'un tableau.

   2. La bande de sept jours remonte juste sous cet en-tete. Elle est
      donc visible des l'ouverture, sans un geste.

   « Votre journee » reste en place, avec ses six mesures, immediatement
   sous la bande. Rien n'est retire : logements actifs, cautions, notes
   sur reservations sont toujours la, un pouce plus bas.

   ── CE QUE JE NE FAIS PAS ────────────────────────────────────────
   La maquette montre trois compteurs compacts — arrivees, departs, a
   traiter — a la place de la grande carte. Je ne les fabrique pas ici :
   il faudrait recopier des chiffres qui vivent deja dans votre carte, et
   deux sources pour un meme nombre finissent toujours par divergen.
   Si vous voulez cette version compacte, elle demande de modifier la
   carte elle-meme, pas de la doubler — dites-le et je le fais
   proprement, en un lot separe.

   Usage :
     node outils/refonte-3f-entete-jour.js --essai
     node outils/refonte-3f-entete-jour.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(process.cwd(), 'public');
const MODULE = path.join(PUBLIC, 'js', 'bh-entete-jour.js');
const APP = path.join(PUBLIC, 'app.html');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(APP)) echec('public/app.html introuvable.');
if (!fs.existsSync(path.join(PUBLIC, 'js', 'bh-bande-jours.js'))) {
  echec('bh-bande-jours.js absent. Lancez d\'abord les lots 3 a 3e.');
}

const SOURCE = `/* ============================================================
   bh-entete-jour.js — un titre, puis les sept jours
   ============================================================
   Pose « Lundi 31 aout / Aujourd'hui » en tete de page, et remonte la
   bande de sept jours juste dessous.

   « Votre journee » n'est ni modifiee ni masquee : elle glisse d'un cran.
   ============================================================ */
(function () {
  'use strict';

  if (window.__bhEnteteJour) return;
  window.__bhEnteteJour = true;

  var ENCRE = '#0D1117';
  var GRIS = '#8B8B84';

  var JOURS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
              'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  var diag = { entete: false, bande_remontee: false, carte_trouvee: false, raison: '' };

  /* La carte « Votre journee » : notre repere pour savoir ou commence
     le contenu de la page. */
  function carteJournee() {
    var titres = document.querySelectorAll('h1, h2, h3, h4, .card-title, [class*="title"]');
    for (var i = 0; i < titres.length; i++) {
      var t = (titres[i].textContent || '').toLowerCase();
      if (t.indexOf('votre journ') === -1) continue;
      var carte = titres[i].closest('.card, [class*="card"], section, .panel') || titres[i].parentElement;
      /* On remonte tant que le bloc est trop petit pour etre la carte. */
      var garde = 0;
      while (carte && carte.parentElement && carte.getBoundingClientRect().height < 120 && garde++ < 6) {
        carte = carte.parentElement;
      }
      return carte;
    }
    return null;
  }

  function poserEntete() {
    if (document.getElementById('bhEnteteJour')) return true;
    var carte = carteJournee();
    if (!carte || !carte.parentElement) { diag.raison = 'carte « Votre journee » introuvable'; return false; }
    diag.carte_trouvee = true;

    var d = new Date();
    var bloc = document.createElement('div');
    bloc.id = 'bhEnteteJour';
    bloc.style.cssText = 'padding:2px 4px 14px;font-family:inherit';
    bloc.innerHTML =
      '<div style="font-size:13.5px;font-weight:500;color:' + GRIS + ';letter-spacing:-.01em">'
      + JOURS[d.getDay()] + ' ' + d.getDate() + ' ' + MOIS[d.getMonth()] + '</div>'
      + '<div style="margin-top:1px;font-size:31px;font-weight:600;letter-spacing:-.03em;color:' + ENCRE + '">'
      + "Aujourd'hui</div>";

    carte.parentElement.insertBefore(bloc, carte);
    diag.entete = true;
    return true;
  }

  /* La bande s'insere apres « Votre journee ». On la remonte entre
     l'en-tete et la carte, pour qu'elle soit visible sans defiler. */
  function remonterBande() {
    var bande = document.getElementById('bhBandeJours');
    var entete = document.getElementById('bhEnteteJour');
    if (!bande || !entete) return false;
    if (bande.previousElementSibling === entete) { diag.bande_remontee = true; return true; }
    if (!entete.parentElement) return false;

    /* insertBefore deplace le noeud : rien n'est clone, donc aucun
       doublon possible, et les ecouteurs du lien « Voir le mois »
       restent attaches. */
    entete.parentElement.insertBefore(bande, entete.nextSibling);
    bande.style.marginTop = '0';
    diag.bande_remontee = true;
    return true;
  }

  window.bhVerifEntete = function () {
    var bande = document.getElementById('bhBandeJours');
    var entete = document.getElementById('bhEnteteJour');
    var res = {
      entete_pose: !!entete,
      bande_presente: !!bande,
      bande_juste_sous_entete: !!(bande && entete && bande.previousElementSibling === entete),
      carte_journee_trouvee: diag.carte_trouvee,
      bande_visible_sans_defiler: bande ? bande.getBoundingClientRect().top < window.innerHeight : false,
      raison: diag.raison
    };
    console.log('── En-tete du jour ──');
    console.log(res);
    if (!res.entete_pose) console.warn('En-tete non pose : ' + (diag.raison || 'inconnu'));
    if (res.bande_presente && !res.bande_juste_sous_entete) {
      console.warn('La bande existe mais n\\'a pas ete remontee — elle est peut-etre arrivee apres.');
    }
    return res;
  };

  function demarrer() {
    poserEntete();
    remonterBande();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(demarrer, 1000); });
  } else {
    setTimeout(demarrer, 1000);
  }
  /* La bande arrive apres son appel reseau : on repasse. */
  setTimeout(demarrer, 2200);
  setTimeout(demarrer, 4000);
  setTimeout(demarrer, 6000);
})();
`;

const BALISE = '<script src="js/bh-entete-jour.js"></script>';

let html = fs.readFileSync(APP, 'utf8');
let etat;

if (html.indexOf('bh-entete-jour.js') !== -1) {
  etat = 'deja';
} else {
  const ancre = html.indexOf('bh-bande-jours.js');
  if (ancre === -1) echec('bh-bande-jours.js absent de app.html.');
  const fin = html.indexOf('</script>', ancre);
  if (fin === -1) echec('Balise mal formee dans app.html.');
  const pos = fin + '</script>'.length;
  html = html.slice(0, pos) + '\n' + BALISE + html.slice(pos);
  etat = 'apres bh-bande-jours.js';
  if (!ESSAI) fs.writeFileSync(APP, html, 'utf8');
}

if (!ESSAI) {
  fs.writeFileSync(MODULE, SOURCE, 'utf8');
  const relu = fs.readFileSync(MODULE, 'utf8');
  if (relu.indexOf('bhVerifEntete') === -1) echec("Le module n'est pas complet apres ecriture.");
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  public/js/bh-entete-jour.js  (' + Math.round(SOURCE.length / 1024) + ' Ko)');
console.log('  app.html             ' + etat);
console.log('\n  1. « Lundi 31 aout / Aujourd\'hui » en tete de page');
console.log('  2. La bande de sept jours juste dessous, visible sans defiler');
console.log('  3. « Votre journee » glisse d\'un cran, intacte');
console.log('\n  La bande est DEPLACEE, pas clonee : aucun doublon possible.');
console.log('\n  A verifier sur telephone, cache vide : /app.html');
console.log('  L\'ecran doit ouvrir sur le titre puis les sept jours.');
console.log('  Puis :  bhVerifEntete()');
console.log('  bande_juste_sous_entete et bande_visible_sans_defiler : true.\n');
console.log('  Note : les trois compteurs compacts de la maquette (arrivees,');
console.log('  departs, a traiter) ne sont PAS fabriques ici — il faudrait');
console.log('  recopier des chiffres qui vivent deja dans « Votre journee », et');
console.log('  deux sources pour un meme nombre finissent par divergen. Si vous');
console.log('  voulez cette version compacte, elle demande de modifier la carte');
console.log('  elle-meme : dites-le et je le fais en un lot separe.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
