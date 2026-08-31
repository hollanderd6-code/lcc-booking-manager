#!/usr/bin/env node
/* ============================================================
   outils/refonte-11-onglet-a-la-source.js
   Lot 11 : une ligne dans le moteur, et la surcouche disparait
   ============================================================

   ── CE QUE LA LECTURE DU MOTEUR APPREND ──────────────────────────
   La chaine de verite, dans l'ordre :

     1. mobile-tabs-handler.js deduit activeTab du nom de page
     2. il le publie :  window.__bhActiveTab = activeTab
     3. mobile-native-experience.js le lit et pose la classe « active »
     4. bh-layout.js positionne .lg-capsule en TRANSFORM, avec sa
        propre transition de 0,5 s

   Pour calendrier.html, aucune branche ne correspond : ni cleaning, ni
   messages, ni reservations, ni settings, ni app. activeTab reste donc
   a sa valeur par defaut, « dashboard ». Le moteur fait exactement ce
   qu'on lui a dit ; personne ne lui a parle de calendrier.html.

   Et le commentaire du code dit precisement pourquoi cela compte :

       « Sans ca, la barre se cree avec Dashboard actif puis la capsule
         glass glisse visiblement vers le vrai onglet a chaque arrivee. »

   ── MON ERREUR, NOMMEE ───────────────────────────────────────────
   bh-capsule-calendrier.js ecrivait left et transform:none, avec un
   MutationObserver. Or bh-layout travaille en transform et anime sur
   0,5 s. Chaque ecriture declenchait une mutation, qui declenchait une
   replacement, qui declenchait une mutation. Le tremblement que vous
   voyez est cette boucle.

   Deux mecaniques qui se disputent la meme propriete ne se stabilisent
   jamais. La surcouche est supprimee, pas reglee.

   ── LA CORRECTION, A LA SOURCE ───────────────────────────────────
   Une branche ajoutee dans la detection de page :

       else if (currentPath.includes('calendrier')) activeTab = 'calendar';

   Placee avant le repli sur « app », car calendrier.html sert app.html
   et la chaine « app » n'y apparait pas — mais l'ordre reste explicite
   pour qui relira. A partir de la, tout suit sans rien d'autre :
   __bhActiveTab est juste, la classe est posee par le moteur, et
   bh-layout place la capsule avec sa transition normale. Aucune boucle,
   aucun observateur.

   ── CE QUE JE NE TOUCHE PAS, ET POURQUOI ─────────────────────────
   ROUTES.calendar reste sur /reservations.html.

   C'est deliberé. ROLE_PAGES.cleaner vaut ['calendar', 'cleaning'] : un
   compte menage possede l'onglet Calendrier. Le faire pointer sur
   calendrier.html — qui sert app.html — l'enverrait sur le tableau de
   bord, et sub-account-guard.js ne l'arreterait pas : sa liste de pages
   bloquees ne connait pas calendrier.html.

   Pour les comptes principaux, la navigation est deja assuree par
   bh-barre-onglets.js, qui reecrit le clic en capture et vise
   calendrier.html. Ce module ne s'active pas pour un role menage — le
   garde-fou pose au lot 2. Chacun garde donc la bonne destination.

   Seule consequence : le prechargement rechauffe reservations.html au
   lieu de calendrier.html. C'est un gain de vitesse manque, pas un
   defaut de comportement — et le prix est bien plus bas que celui d'un
   compte menage qui atterrit sur le tableau de bord.

   Usage :
     node outils/refonte-11-onglet-a-la-source.js --essai
     node outils/refonte-11-onglet-a-la-source.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(process.cwd(), 'public');
const JS = path.join(PUBLIC, 'js');
const MOTEUR = path.join(JS, 'mobile-tabs-handler.js');
const SURCOUCHE = path.join(JS, 'bh-capsule-calendrier.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const PAGES = ['app.html', 'calendrier.html', 'messages.html', 'reservations.html', 'settings.html', 'deposits.html', 'factures.html', 'cleaning.html'];

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(MOTEUR)) echec('public/js/mobile-tabs-handler.js introuvable.');

let moteur = fs.readFileSync(MOTEUR, 'utf8');
const ecrire = [];
const aSupprimer = [];
const rapport = [];

/* ── 1. La branche, dans le moteur ───────────────────────────── */

if (moteur.indexOf("includes('calendrier')") !== -1) {
  rapport.push(['mobile-tabs-handler.js', 'branche deja posee']);
} else {
  const ANCRE = `  } else if (currentPath.includes('messages')) {
    activeTab = 'messages';`;
  const n = moteur.split(ANCRE).length - 1;
  if (n !== 1) echec("L'ancre de detection (branche messages) est presente " + n + ' fois (attendu : 1).');

  moteur = moteur.split(ANCRE).join(
`  } else if (currentPath.includes('calendrier')) {
    // calendrier.html sert app.html : sans cette branche, activeTab reste
    // « dashboard » et la capsule s'allume sous Aujourd'hui. C'est la seule
    // ligne necessaire — mobile-native-experience lit __bhActiveTab, et
    // bh-layout place ensuite la capsule avec sa transition normale.
    activeTab = 'calendar';
  } else if (currentPath.includes('messages')) {
    activeTab = 'messages';`);

  try { new Function(moteur); }
  catch (e) { echec('mobile-tabs-handler.js ne serait plus du JavaScript valide — ' + e.message); }

  ecrire.push([MOTEUR, moteur]);
  rapport.push(['mobile-tabs-handler.js', 'branche calendrier ajoutee']);
}

/* La destination du role menage ne doit pas avoir bouge. */
if (moteur.indexOf("calendar: '/reservations.html'") === -1) {
  echec("ROUTES.calendar ne vaut plus /reservations.html : un compte menage serait envoye sur le tableau de bord. Refus.");
}

/* ── 2. La surcouche disparait ───────────────────────────────── */

const BALISE = '<script src="js/bh-capsule-calendrier.js"></script>';
let retirees = 0;

PAGES.forEach(function (nom) {
  const p = path.join(PUBLIC, nom);
  if (!fs.existsSync(p)) return;
  let html = fs.readFileSync(p, 'utf8');
  if (html.indexOf('bh-capsule-calendrier.js') === -1) return;

  /* La balise, avec le saut de ligne qui la precedait. */
  const avant = html.length;
  html = html.split('\n' + BALISE).join('');
  html = html.split(BALISE).join('');
  if (html.length === avant) { rapport.push([nom, 'balise introuvable — a retirer a la main']); return; }

  ecrire.push([p, html]);
  retirees++;
  rapport.push([nom, 'balise retiree']);
});

if (fs.existsSync(SURCOUCHE)) aSupprimer.push(SURCOUCHE);

if (!ecrire.length && !aSupprimer.length) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* ── Ecriture ─────────────────────────────────────────────────── */

if (!ESSAI) {
  ecrire.forEach(function (p) { fs.writeFileSync(p[0], p[1], 'utf8'); });
  aSupprimer.forEach(function (p) { fs.unlinkSync(p); });

  const relu = fs.readFileSync(MOTEUR, 'utf8');
  if (relu.indexOf("includes('calendrier')") === -1) {
    echec("La branche n'est pas dans mobile-tabs-handler.js apres ecriture.");
  }
  if (relu.indexOf("calendar: '/reservations.html'") === -1) {
    echec('ROUTES.calendar a change apres ecriture. Refus.');
  }
  PAGES.forEach(function (nom) {
    const p = path.join(PUBLIC, nom);
    if (!fs.existsSync(p)) return;
    if (fs.readFileSync(p, 'utf8').indexOf('bh-capsule-calendrier.js') !== -1) {
      echec('La balise subsiste dans ' + nom + ' apres ecriture.');
    }
  });
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
rapport.forEach(function (r) { console.log('  ' + (r[0] + '                          ').slice(0, 26) + r[1]); });
if (aSupprimer.length) console.log('  ' + ('bh-capsule-calendrier.js' + '                          ').slice(0, 26) + (ESSAI ? 'serait supprime' : 'supprime'));

console.log('\n  Une branche dans le moteur remplace un module de 12 Ko.');
console.log('  Le tremblement venait de deux mecaniques se disputant la meme');
console.log('  propriete : bh-layout en transform, ma surcouche en left, dans');
console.log('  une boucle observateur. Cela ne se stabilise jamais.');
console.log('\n  ROUTES.calendar reste sur /reservations.html : un compte menage');
console.log('  possede l\'onglet Calendrier, et calendrier.html sert app.html —');
console.log('  il atterrirait sur le tableau de bord, sans que');
console.log('  sub-account-guard.js l\'arrete. Pour les comptes principaux, la');
console.log('  navigation est deja assuree par bh-barre-onglets.js.');
console.log('\n  A verifier sur telephone, cache vide : /calendrier.html');
console.log('  1. La capsule est sous « Calendrier », immobile.');
console.log('  2. Aucun tremblement, meme apres 15 secondes.');
console.log('  3. « Aujourd\'hui » est gris et vous y ramene.');
console.log('  4. Dans la console au chargement, la derniere ligne du moteur');
console.log('     doit dire :  onglets mobile initialisee (page: calendar)');
console.log('     C\'est la preuve que la correction agit a la source.');
console.log('\n  Et si vous avez un compte menage sous la main : son onglet');
console.log('  Calendrier doit toujours mener a reservations.html.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
