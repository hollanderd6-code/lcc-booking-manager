#!/usr/bin/env node
/* ============================================================
   outils/menage-affichage-mobile.js
   Page Menage : bouton « Valider » invisible et bande vide en bas
   ============================================================
   Cible : public/cleaning.html

   ── 1. LE BOUTON « VALIDER » BLANC SUR BLANC ─────────────────────
   Sur la carte d'une checklist en attente, le bouton « Valider »
   apparait comme un rectangle blanc vide. « Details » et
   « Complement » restent lisibles a cote.

   Deux causes cumulees :

   a) Specificite. La regle du theme v3

        html[data-theme-v3="1"] .checklist-item-actions .btn {
          background: rgba(255,255,255,.6) !important;
        }

      compte un attribut et deux classes ; « .btn-validate » n'en
      compte qu'une. Le fond blanc l'emporte donc, alors que la couleur
      de texte « white » de .btn-validate reste en place. Texte blanc sur
      fond blanc. « Complement » y echappe : son rouge reste lisible sur
      le blanc.

   b) Variable inexistante. .btn-validate peint son fond avec
      var(--bh-vert-fonce) — variable definie NI dans cleaning.html, NI
      dans bh-brand.css, NI dans bh-bottom-bar.css. La declaration est
      donc invalide : le fond vert n'a jamais ete applique, meme sans le
      probleme de specificite.

   Corrige par une regle de meme specificite, posee apres, avec une
   valeur de repli explicite : var(--bh-vert-fonce, #0A2C22). Elle
   fonctionne que la variable existe un jour ou non.

   ── 2. LA BANDE VIDE EN BAS, SUR TOUS LES ONGLETS ────────────────
   Un bloc intitule « FIX SCROLL MOBILE » posait :

        .app-container  { height: calc(100dvh - 40px); overflow: hidden }
        main.main-content { height: 100%; max-height: calc(100dvh - 40px);
                            padding-bottom: 120px + safe-area }

   Le « - 40px » retranche 40 px a la zone de defilement, mais
   l'element garde sa hauteur : son bas passe sous la zone visible et
   devient inatteignable. C'est visible sur les captures — la carte CDG4
   et le champ « Compte app (optionnel) » sont coupes net. Et par-dessus,
   le padding-bottom de 120 px fabrique une bande vide au-dessus de la
   barre de navigation.

   100dvh suit deja exactement la zone visible sur iOS : c'est tout
   l'interet de cette unite, et la soustraction la rend fausse. Elle est
   retiree, et le padding-bottom ramene a 100 px — la valeur que
   bh-bottom-bar.css utilise lui-meme pour degager la barre.

   ── CE QUI N'EST PAS TOUCHE ─────────────────────────────────────
   · La regle blanche du theme v3 sur les autres boutons : c'est le
     parti pris visuel de la page, on ne le renverse pas.
   · Le bloc @media (max-width: 1366px) : la correction reste cantonnee
     au mobile et a la tablette.
   · Aucune logique JavaScript.

   ── CE QUI RESTE ────────────────────────────────────────────────
   La capture de l'onglet Templates montre « Erreur de chargement » dans
   la carte « Automatisation Hosterzz ». C'est un appel API en echec, pas
   un probleme d'affichage — a regarder separement.

   Usage :
     node outils/menage-affichage-mobile.js --essai
     node outils/menage-affichage-mobile.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'cleaning.html');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('public/cleaning.html introuvable. Lancez depuis la racine du projet.');
let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('#0A2C22') !== -1 && src.indexOf('calc(100dvh - 40px)') === -1) {
  console.log('\n  Le correctif est deja en place — rien a faire.\n');
  process.exit(0);
}

const PAIRES = [
  ['la hauteur de la zone de defilement', "  html[data-theme-v3=\"1\"] .app-container {\n    height: calc(100dvh - 40px) !important;\n    min-height: calc(100dvh - 40px) !important;\n    overflow: hidden !important;\n  }\n  html[data-theme-v3=\"1\"] main.main-content {\n    height: 100% !important;\n    max-height: calc(100dvh - 40px) !important;", "  /* Le « - 40px » retranchait 40 px a la zone de defilement : le bas du\n     contenu passait sous l'ecran et devenait inatteignable (la derniere\n     carte et le dernier champ des formulaires etaient coupes), tandis que\n     le padding-bottom laissait une bande vide au-dessus de la barre.\n     100dvh suit exactement la zone visible : aucune soustraction n'est\n     necessaire. */\n  html[data-theme-v3=\"1\"] .app-container {\n    height: 100dvh !important;\n    min-height: 100dvh !important;\n    overflow: hidden !important;\n  }\n  html[data-theme-v3=\"1\"] main.main-content {\n    height: 100% !important;\n    max-height: 100dvh !important;"],
  ['le padding du bas', "    padding-bottom: calc(120px + env(safe-area-inset-bottom, 0px)) !important;", "    /* Juste ce qu'il faut pour degager la barre du bas (60 a 80 px selon\n       l'appareil), aligne sur la valeur de bh-bottom-bar.css. Au-dela, on\n       fabrique une bande vide. */\n    padding-bottom: calc(100px + env(safe-area-inset-bottom, 0px)) !important;"],
  ['le style du bouton Valider', "html[data-theme-v3=\"1\"] .checklist-item-actions .btn:hover {\n  background: white !important;\n}", "html[data-theme-v3=\"1\"] .checklist-item-actions .btn:hover {\n  background: white !important;\n}\n\n/* Le bouton « Valider » etait invisible : blanc sur blanc.\n   Deux causes cumulees, corrigees ici :\n\n   1. La regle ci-dessus (attribut + deux classes) est plus specifique que\n      « .btn-validate », donc son fond blanc gagnait — alors que la couleur\n      de texte « white » de .btn-validate restait. Texte blanc sur fond\n      blanc. « Complement » restait lisible, lui, parce que son rouge\n      survivait au meme traitement.\n\n   2. .btn-validate peint son fond avec var(--bh-vert-fonce), variable qui\n      n'est definie NI dans cette page, NI dans bh-brand.css, NI dans\n      bh-bottom-bar.css. La declaration etait donc invalide et le fond vert\n      n'a jamais ete applique. D'ou la valeur de repli explicite ci-dessous :\n      elle fonctionne que la variable existe ou non. */\nhtml[data-theme-v3=\"1\"] .checklist-item-actions .btn-validate,\nhtml[data-theme-v3=\"1\"] .checklist-item-actions .btn-validate:hover {\n  background: var(--bh-vert-fonce, #0A2C22) !important;\n  color: #fff !important;\n  border-color: transparent !important;\n}\nhtml[data-theme-v3=\"1\"] .checklist-item-actions .btn-validate i {\n  color: #fff !important;\n}\n/* Meme correction pour le bouton de refus, dont le fond blanc etait\n   fortuitement lisible mais pas intentionnel. */\nhtml[data-theme-v3=\"1\"] .checklist-item-actions .btn-reject,\nhtml[data-theme-v3=\"1\"] .checklist-item-actions .btn-reject:hover {\n  background: rgba(255,255,255,.6) !important;\n  color: #B4402A !important;\n  border-color: rgba(180,64,42,.35) !important;\n}"],
];
for (const [quoi, avant, apres] of PAIRES) {
  const n = src.split(avant).length - 1;
  if (n !== 1) echec(quoi + ' : ' + n + " occurrence(s) au lieu d'une. cleaning.html a change.");
  src = src.split(avant).join(apres);
}

/* ---- Verifications ---- */
if (src.indexOf('calc(100dvh - 40px)') !== -1) echec('Une soustraction de 40px subsiste.');
if (src.indexOf('calc(120px + env') !== -1) echec("L'ancien padding de 120px subsiste.");

const controles = [
  ['la hauteur corrigee', 'height: 100dvh !important;'],
  ['le padding corrige', 'calc(100px + env(safe-area-inset-bottom, 0px))'],
  ['le fond du bouton Valider', 'background: var(--bh-vert-fonce, #0A2C22) !important;'],
  ['la couleur de son texte', 'color: #fff !important;'],
  ['son icone', '.checklist-item-actions .btn-validate i'],
];
for (const c of controles) {
  if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent du resultat.');
}

/* La regle v3 d'origine doit rester : on ajoute une exception, on ne la supprime pas. */
if (src.indexOf('html[data-theme-v3="1"] .checklist-item-actions .btn {') === -1) {
  echec('La regle v3 des boutons de checklist a disparu.');
}
/* La correction doit venir APRES la regle qu'elle corrige. */
if (src.indexOf('.checklist-item-actions .btn-validate,') < src.indexOf('.checklist-item-actions .btn:hover')) {
  echec('La correction du bouton est placee avant la regle qu\'elle doit surcharger.');
}
/* Le media query mobile doit encadrer la correction de hauteur. */
if (src.indexOf('@media (max-width: 1366px)') === -1) {
  echec('Le media query mobile a disparu.');
}

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('#0A2C22') === -1) {
    echec("L'ajout est absent apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Bouton « Valider » : fond vert, texte blanc, icone blanche.');
console.log('  Zone de defilement : plus de 40px perdus, le bas du contenu est');
console.log('  atteignable et la bande vide se reduit a un degagement de barre.');
console.log('');
console.log('  Ensuite : ⌘⇧R sur la page Menage (le CSS est en cache).');
console.log('  Sur iPhone, l\'app charge le site distant : rien a rebuilder.');
console.log('');
console.log('  A verifier sur les cinq onglets : le dernier element doit etre');
console.log('  entierement visible juste au-dessus de la barre du bas.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
