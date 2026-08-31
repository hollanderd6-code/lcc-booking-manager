#!/usr/bin/env node
/* ============================================================
   outils/refonte-9-vue-exclusive.js
   Lot 9 : en vue calendrier, Aujourd'hui ne se construit pas
   ============================================================

   ── CE QUE MONTRE VOTRE CAPTURE ──────────────────────────────────
   Sur /calendrier.html vous voyez « A TRAITER MAINTENANT », les
   arrivees, les departs — tout Aujourd'hui — et le calendrier ajoute en
   bas. Le masquage n'a donc rien masque.

   Mais le defaut n'est pas dans le masquage. C'est une course.

   bh-vue-calendrier masque le corps de la page une fois, vers 2 s. Or
   six modules continuent de CONSTRUIRE Aujourd'hui jusqu'a 9,5 s :

       bh-entete-jour     pose le titre, deplace la loupe
       bh-kpi-haut        deplace les trois tuiles, arbitre l'ordre
       bh-bande-jours     appelle le reseau, cree la bande
       bh-listes-jour     appelle le reseau, cree les listes
       bh-liste-unifiee   idem
       bh-carte-journee   remonte les chiffres de fond

   Chacun insere ses blocs APRES le masquage, dans le corps ou dans un
   conteneur qu'il vient de creer. Ils ne savent pas qu'ils sont sur la
   vue calendrier, donc ils font leur travail — correctement, au mauvais
   endroit.

   Ajouter des passages de masquage ne reglerait rien : ce serait deux
   modules qui se repassent la main indefiniment, et le resultat
   dependrait encore de la vitesse du reseau. Nous avons deja vu ce film
   avec l'ordre du haut.

   ── LA CORRECTION ────────────────────────────────────────────────
   Les six modules recoivent la meme clause d'entree que
   bh-aujourdhui-allege possede deja :

       si l'adresse est calendrier.html ou porte vue=calendrier,
       ce module ne fait rien du tout.

   Un module qui ne se lance pas ne peut pas defaire le travail d'un
   autre. La course disparait au lieu d'etre arbitree.

   ── ET L'ONGLET ──────────────────────────────────────────────────
   Votre barre d'etat montre encore reservations.html sous l'onglet
   Calendrier. Or /calendrier.html existe et sert deja app.html : c'est
   l'adresse a viser, plus simple que app.html?vue=calendrier que je
   proposais au lot 8. L'onglet est repointe, et la comparaison
   « suis-je deja sur place » redevient un simple nom de page.

   Usage :
     node outils/refonte-9-vue-exclusive.js --essai
     node outils/refonte-9-vue-exclusive.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const JS = path.join(process.cwd(), 'public', 'js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(JS)) echec('public/js introuvable. Lancez depuis la racine du projet.');

/* Les modules qui construisent Aujourd'hui et n'ont rien a y faire en
   vue calendrier. bh-aujourdhui-allege a deja sa clause. */
const MODULES = [
  'bh-entete-jour.js',
  'bh-kpi-haut.js',
  'bh-bande-jours.js',
  'bh-listes-jour.js',
  'bh-liste-unifiee.js',
  'bh-carte-journee.js',
  'bh-cartes-mois.js',
  'bh-vide-du-haut.js'
];

const CLAUSE = `  /* En vue calendrier, ce module n'a rien a construire — et ce qu'il
     construirait reapparaitrait par-dessus le calendrier, apres le
     masquage. Un module qui ne se lance pas ne peut pas defaire le
     travail d'un autre. */
  if ((location.search || '').indexOf('vue=calendrier') !== -1) return;
  if ((location.pathname || '').split('/').pop().toLowerCase() === 'calendrier.html') return;
`;

const rapport = [];
const ecrire = [];

MODULES.forEach(function (nom) {
  const p = path.join(JS, nom);
  if (!fs.existsSync(p)) { rapport.push([nom, 'absent']); return; }

  let src = fs.readFileSync(p, 'utf8');
  if (src.indexOf('vue=calendrier') !== -1) { rapport.push([nom, 'deja']); return; }

  /* On s'insere juste avant la pose du drapeau anti-double-chargement :
     c'est le point ou le module decide de vivre. */
  const motif = /\n(\s*)window\.__bh\w+ = true;/;
  const m = src.match(motif);
  if (!m) { rapport.push([nom, 'sentinelle introuvable — ignore']); return; }

  const pos = src.indexOf(m[0]);
  src = src.slice(0, pos + 1) + CLAUSE + src.slice(pos + 1);

  try { new Function(src); }
  catch (e) { echec(nom + ' ne serait plus du JavaScript valide — ' + e.message); }

  if (src.indexOf('vue=calendrier') === -1) echec('La clause n\'a pas ete posee dans ' + nom + '.');

  ecrire.push([p, src]);
  rapport.push([nom, 'clause posee']);
});

const posees = rapport.filter(function (r) { return r[1] === 'clause posee'; }).length;
if (posees === 0) {
  const dejaTous = rapport.every(function (r) { return r[1] === 'deja' || r[1] === 'absent'; });
  if (dejaTous) { console.log('\n  Deja applique — rien a faire.\n'); process.exit(0); }
  echec('Aucune clause posee. Verifiez les noms dans public/js.');
}

/* ── L'onglet vise calendrier.html, la page qui existe ────────── */

const BARRE = path.join(JS, 'bh-barre-onglets.js');
let barre = fs.readFileSync(BARRE, 'utf8');
let etatBarre = 'inchangee';

if (barre.indexOf("page: 'calendrier.html'") !== -1) {
  etatBarre = 'deja';
} else {
  const anciennes = ["page: 'app.html?vue=calendrier'", "page: 'reservations.html'"];
  let fait = false;
  for (let i = 0; i < anciennes.length && !fait; i++) {
    if (barre.split(anciennes[i]).length - 1 === 1) {
      barre = barre.split(anciennes[i]).join("page: 'calendrier.html'");
      etatBarre = 'repointee depuis ' + anciennes[i].replace("page: '", '').replace("'", '');
      fait = true;
    }
  }
  if (!fait) echec("La destination de l'onglet Calendrier est introuvable dans bh-barre-onglets.js.");

  /* Deux onglets ne partagent plus app.html : la comparaison redevient
     un simple nom de page. On la remet telle quelle si le lot 8 l'avait
     etendue au point d'interrogation. */
  const etendue = ".toLowerCase() + location.search;";
  if (barre.split(etendue).length - 1 === 1) {
    barre = barre.split(etendue).join(".toLowerCase();");
    etatBarre += ' + comparaison simplifiee';
  }

  try { new Function(barre); }
  catch (e) { echec('bh-barre-onglets.js ne serait plus du JavaScript valide — ' + e.message); }

  ecrire.push([BARRE, barre]);
}

/* ── Ecriture ─────────────────────────────────────────────────── */

if (!ESSAI) {
  ecrire.forEach(function (p) { fs.writeFileSync(p[0], p[1], 'utf8'); });
  /* Relecture : la clause doit etre la, dans chaque fichier annonce. */
  rapport.forEach(function (r) {
    if (r[1] !== 'clause posee') return;
    const relu = fs.readFileSync(path.join(JS, r[0]), 'utf8');
    if (relu.indexOf('vue=calendrier') === -1) echec('Apres ecriture, la clause manque dans ' + r[0] + '.');
  });
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
rapport.forEach(function (r) { console.log('  ' + (r[0] + '                        ').slice(0, 24) + r[1]); });
console.log('  ' + ('bh-barre-onglets.js' + '                        ').slice(0, 24) + etatBarre);
console.log('\n  En vue calendrier, les modules d\'Aujourd\'hui ne se lancent plus.');
console.log('  La course disparait au lieu d\'etre arbitree : un module qui ne');
console.log('  demarre pas ne peut pas defaire le travail d\'un autre.');
console.log('  L\'onglet vise /calendrier.html — la page qui existe deja.');
console.log('\n  A verifier sur telephone, cache vide :');
console.log('  1. /calendrier.html : les trois cartes du mois puis le');
console.log('     calendrier. Plus de « A traiter », plus d\'arrivees.');
console.log('     bhVerifVueCalendrier()  — pose: true, blocs_masques > 0.');
console.log('  2. /app.html : Aujourd\'hui intact, sans CA ni calendrier.');
console.log('  3. L\'onglet Calendrier mene bien a /calendrier.html, et');
console.log('     « Aujourd\'hui » vous ramene.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
