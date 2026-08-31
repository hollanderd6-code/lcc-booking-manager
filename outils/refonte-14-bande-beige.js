#!/usr/bin/env node
/* ============================================================
   outils/refonte-14-bande-beige.js
   Lot 14 : la reserve d'espace change de proprietaire
   ============================================================

   ── LA CAUSE, ETABLIE ────────────────────────────────────────────
       body            bg = rgb(245, 242, 236)   padding-bottom = 100px
       .mobile-tabs    fixed, bottom = 10px, fond blanc translucide
       parent          body

   La barre flotte a 10 px du bas depuis le lot 2c. Pour que le contenu
   puisse defiler au-dessus d'elle, le meme lot avait pose 100 px de
   marge interieure en bas du body :

       document.body.style.setProperty('padding-bottom', ...)

   Or cette marge est A L'INTERIEUR du body, et c'est le fond du body qui
   la peint — beige. Le contenu, lui, peint son propre fond, plus clair.
   La bande beige est donc exactement ces 100 px : la difference entre
   deux fonds, revelee par un espace que j'ai cree.

   Elle ne se voyait pas avant le lot 2c parce que la barre, collee au
   bas et opaque, la recouvrait entierement.

   ── LA CORRECTION ────────────────────────────────────────────────
   La reserve d'espace appartient au conteneur qui peint le fond du
   contenu, pas au body. Elle passe donc sur .page-content — ou, a
   defaut, sur main.main-content. Ce conteneur s'etend alors sous la
   barre avec SON fond, et il n'y a plus de difference a voir.

   Le module ne suppose pas la couleur : il n'en lit ni n'en ecrit
   aucune. Il deplace une marge. Si le fond du contenu est transparent,
   la page est uniformement beige et il n'y avait de toute facon aucune
   bande.

   ── AILLEURS ─────────────────────────────────────────────────────
   La vue calendrier a sa propre racine (#bhVueRacine, 104 px de marge
   basse) : elle est traitee de la meme facon, son fond etant celui que
   bh-vue-calendrier lui a donne en heritant de la classe du parent.

   Le module tourne sur toutes les pages qui portent la barre — le
   defaut n'est pas propre a Aujourd'hui, vous l'avez vu sur les deux.

   Usage :
     node outils/refonte-14-bande-beige.js --essai
     node outils/refonte-14-bande-beige.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(process.cwd(), 'public');
const JS = path.join(PUBLIC, 'js');
const STYLE = path.join(JS, 'bh-barre-style.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(STYLE)) echec('public/js/bh-barre-style.js introuvable.');

let src = fs.readFileSync(STYLE, 'utf8');

if (src.indexOf('conteneurDeContenu') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* ── La marge quitte le body ─────────────────────────────────── */

const ANCIEN = `    /* Un ilot ne colle pas au bas : le contenu doit pouvoir defiler dessous. */
    try {
      var h = barre.getBoundingClientRect().height || 62;
      document.body.style.setProperty('padding-bottom', 'calc(' + Math.round(h + 22) + 'px + env(safe-area-inset-bottom, 0px))');
    } catch (e) {}`;

if (src.split(ANCIEN).length - 1 !== 1) {
  echec("Le bloc de marge du lot 2c est introuvable dans bh-barre-style.js.");
}

src = src.split(ANCIEN).join(
`    /* Un ilot ne colle pas au bas : le contenu doit pouvoir defiler
       dessous. Mais la reserve d'espace ne doit PAS aller sur le body :
       elle y est peinte par le fond du body, plus sombre que celui du
       contenu, et c'est la bande beige qu'on voyait sous la barre.

       Elle appartient au conteneur qui peint le fond du contenu : il
       s'etend alors sous la barre avec SON fond, et il n'y a plus de
       difference a voir. Aucune couleur n'est lue ni ecrite ici. */
    try {
      var h = barre.getBoundingClientRect().height || 62;
      var reserve = 'calc(' + Math.round(h + 22) + 'px + env(safe-area-inset-bottom, 0px))';
      var hote = conteneurDeContenu();
      if (hote) {
        hote.style.setProperty('padding-bottom', reserve, 'important');
        hote.style.setProperty('box-sizing', 'border-box', 'important');
        /* Le body n'a plus a reserver quoi que ce soit — s'il le faisait
           encore, la bande reapparaitrait sous le conteneur. */
        document.body.style.removeProperty('padding-bottom');
        barre.dataset.bhReserve = hote.id || hote.className || 'contenu';
      } else {
        /* Aucun conteneur identifie : on garde l'ancien comportement
           plutot que de laisser la barre recouvrir le dernier element. */
        document.body.style.setProperty('padding-bottom', reserve);
        barre.dataset.bhReserve = 'body (repli)';
      }
    } catch (e) {}`);

/* ── La fonction qui designe le conteneur ────────────────────── */

const ANCRE = '  /* ── La barre en ilot ───────────────────────────────────────── */';
if (src.split(ANCRE).length - 1 !== 1) echec("L'ancre de la barre en ilot est introuvable.");

src = src.split(ANCRE).join(
`  /* Le conteneur qui porte le contenu de la page, du plus precis au plus
     large. La vue calendrier a sa propre racine : elle passe en premier,
     sinon on reserverait de l'espace dans un bloc masque. */
  function conteneurDeContenu() {
    var noms = ['#bhVueRacine', '.page-content', 'main.main-content', '.app-container'];
    for (var i = 0; i < noms.length; i++) {
      var el = document.querySelector(noms[i]);
      if (!el) continue;
      if (getComputedStyle(el).display === 'none') continue;
      /* Un conteneur qui ne contient pas la page n'est pas le bon. */
      if (el.getBoundingClientRect().height < 200) continue;
      return el;
    }
    return null;
  }

  /* ── La barre en ilot ───────────────────────────────────────── */`);

/* ── Le diagnostic dit qui porte la reserve ──────────────────── */

const DIAG = '      fab_remonte: !!document.querySelector(\'[data-bh-remonte]\'),';
if (src.split(DIAG).length - 1 !== 1) echec('La ligne du diagnostic est introuvable.');
src = src.split(DIAG).join(
`      fab_remonte: !!document.querySelector('[data-bh-remonte]'),
      reserve_portee_par: (document.querySelector('.mobile-tabs') || {}).dataset
        ? (document.querySelector('.mobile-tabs').dataset.bhReserve || 'aucune') : 'aucune',
      body_padding_bottom: getComputedStyle(document.body).paddingBottom,`);

/* ── Verifications ───────────────────────────────────────────── */

[
  ['la fonction de conteneur', 'function conteneurDeContenu() {'],
  ['la vue calendrier en premier', "['#bhVueRacine', '.page-content'"],
  ['la marge sur le conteneur', "hote.style.setProperty('padding-bottom', reserve, 'important')"],
  ['le retrait sur le body', "document.body.style.removeProperty('padding-bottom')"],
  ['le repli', "barre.dataset.bhReserve = 'body (repli)'"],
  ['le diagnostic', 'reserve_portee_par:'],
].forEach(function (c) {
  if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent apres modification.');
});

/* Aucune couleur ne doit avoir ete introduite. */
const zone = src.slice(src.indexOf('function conteneurDeContenu'), src.indexOf('function remonterFab'));
if (/background|rgb\(|#[0-9a-f]{6}/i.test(zone)) {
  echec('Le correctif introduit une couleur : il ne doit que deplacer une marge. Refus.');
}

try { new Function(src); }
catch (e) { echec('bh-barre-style.js ne serait plus du JavaScript valide — ' + e.message); }

if (!ESSAI) {
  fs.writeFileSync(STYLE, src, 'utf8');
  if (fs.readFileSync(STYLE, 'utf8').indexOf('conteneurDeContenu') === -1) {
    echec("La correction n'est pas dans le fichier apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  La reserve de 100 px quitte le body pour le conteneur de');
console.log('  contenu — .page-content, ou #bhVueRacine en vue calendrier.');
console.log('  Ce conteneur s\'etend alors sous la barre avec SON fond : il n\'y');
console.log('  a plus de difference de couleur a voir.');
console.log('\n  Le module ne lit ni n\'ecrit aucune couleur — il deplace une');
console.log('  marge. Le script refuse d\'ecrire si une couleur apparait.');
console.log('  Si aucun conteneur n\'est identifie, l\'ancien comportement est');
console.log('  conserve : mieux vaut la bande que la barre par-dessus le');
console.log('  dernier element de la liste.');
console.log('\n  A verifier sur telephone, cache vide :');
console.log('  1. /app.html : plus de bande beige sous la barre. Defilez');
console.log('     jusqu\'en bas — le dernier element reste atteignable.');
console.log('  2. /calendrier.html : idem, et le calendrier defile en entier.');
console.log('  3. bhVerifStyle()  — « reserve_portee_par » doit nommer');
console.log('     page-content (ou bhVueRacine), et « body_padding_bottom »');
console.log('     valoir 0px.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
