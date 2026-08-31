#!/usr/bin/env node
/* ============================================================
   outils/refonte-19b-marque-bonne-cible.js
   Lot 19b : c'etait la barre laterale que je masquais
   ============================================================

   ── L'ERREUR ─────────────────────────────────────────────────────
   bhVerifEnteteMsg().marque_masquee repondait « #bhSidebar ». Ma regle
   cherchait le plus petit conteneur portant « BOOSTINGHOST » : le menu
   lateral le porte aussi, et il est plus court que la barre du haut.
   J'ai donc masque le menu — invisible sur telephone, d'ou l'absence
   d'effet visible — et laisse la barre en place.

   Chercher « le plus petit qui contient ce mot » etait une mauvaise
   regle : le mot est partout, la barre est une position.

   ── LA NOUVELLE REGLE ────────────────────────────────────────────
   Le point de depart est « SMART PROPERTY MANAGER », qui n'apparait que
   sous le logo. On remonte ensuite jusqu'a un ancetre qui a la FORME
   d'une barre du haut :

       largeur     au moins 70 % de l'ecran
       hauteur     entre 40 et 160 pixels
       position    dans les 200 premiers pixels de la page

   Et trois refus explicites : #bhSidebar, tout ce qui porte « sidebar »
   ou « menu » dans sa classe, et tout ce qui contient la liste des
   conversations. Une forme et des refus valent mieux qu'un nom devine.

   ── LE MENU LATERAL EST REND ─────────────────────────────────────
   Le lot commence par rendre #bhSidebar s'il a ete masque. Vous ne le
   voyiez pas sur telephone, mais il devait revenir avant tout.

   Usage :
     node outils/refonte-19b-marque-bonne-cible.js --essai
     node outils/refonte-19b-marque-bonne-cible.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const MODULE = path.join(process.cwd(), 'public', 'js', 'bh-entete-messages.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(MODULE)) echec('bh-entete-messages.js absent. Lancez d\'abord les lots 18 et 19.');

let src = fs.readFileSync(MODULE, 'utf8');
if (src.indexOf('SMART PROPERTY') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}
if (src.indexOf('function barreMarque()') === -1) echec('Le lot 19 n\'est pas applique.');

const DEBUT = src.indexOf('  /* La barre de marque : un conteneur portant');
const FIN = src.indexOf('  var rechercheOuverte = false;');
if (DEBUT === -1 || FIN === -1 || FIN < DEBUT) echec('Bornes de barreMarque introuvables.');

const NOUVEAU = `  /* La barre de marque.

     Ma premiere regle — « le plus petit conteneur portant BOOSTINGHOST »
     — designait #bhSidebar : le menu lateral porte le mot lui aussi, et
     il est plus court. Le mot est partout dans la page ; la barre du
     haut, elle, est une FORME et une POSITION.

     On part donc de « SMART PROPERTY MANAGER », qui n'apparait que sous
     le logo, et on remonte jusqu'a l'ancetre qui ressemble a une barre :
     large, basse, tout en haut. Avec des refus explicites. */
  function estBarreDuHaut(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el === document.body || el.tagName === 'HTML') return false;
    if (el.id === 'bhSidebar') return false;
    var cls = ' ' + (typeof el.className === 'string' ? el.className.toLowerCase() : '') + ' ';
    if (/sidebar|drawer|menu-lateral|offcanvas/.test(cls)) return false;
    if (el.querySelector('#conversationsList, #bhMessagesListe, #msgsSearchInput')) return false;
    var r = el.getBoundingClientRect();
    if (r.width < window.innerWidth * 0.7) return false;
    if (r.height < 40 || r.height > 160) return false;
    if (r.top > 200) return false;
    return true;
  }

  function barreMarque() {
    /* Le sous-titre du logo : present une seule fois dans la page. */
    var depart = null;
    var noeuds = document.querySelectorAll('div, span, p, small, h1, h2');
    for (var i = 0; i < noeuds.length; i++) {
      var n = noeuds[i];
      if (n.children.length) continue;
      var t = (n.textContent || '').replace(/\\s+/g, ' ').trim();
      if (/^smart property manager$/i.test(t)) { depart = n; break; }
    }
    /* A defaut, le logo lui-meme. */
    if (!depart) depart = document.querySelector('img[alt*="oosting" i], img[src*="logo" i]');
    if (!depart) return null;
    if (depart.closest && depart.closest('#bhSidebar')) {
      /* Le sous-titre trouve est celui du menu : on cherche l'autre. */
      var tous = document.querySelectorAll('img[alt*="oosting" i], img[src*="logo" i]');
      depart = null;
      for (var j = 0; j < tous.length; j++) {
        if (!tous[j].closest('#bhSidebar')) { depart = tous[j]; break; }
      }
      if (!depart) return null;
    }

    var el = depart, garde = 0;
    while (el && garde++ < 8) {
      if (estBarreDuHaut(el)) return el;
      el = el.parentElement;
    }
    return null;
  }

`;

src = src.slice(0, DEBUT) + NOUVEAU + src.slice(FIN);

/* Le menu lateral doit revenir s'il a ete masque. */
const AVANT_TOUR = `  function tour() {
    poserEntete();
    masquerMarque();`;
if (src.split(AVANT_TOUR).length - 1 !== 1) echec('Le tour est introuvable.');
src = src.split(AVANT_TOUR).join(`  /* Le lot 19 masquait #bhSidebar par erreur. On le rend avant tout,
     une seule fois, quoi qu'il arrive ensuite. */
  var sidebarRendu = false;
  function rendreSidebar() {
    if (sidebarRendu) return;
    sidebarRendu = true;
    var s = document.getElementById('bhSidebar');
    if (s && s.dataset.bhMarqueMasquee) {
      s.style.removeProperty('display');
      delete s.dataset.bhMarqueMasquee;
      for (var i = mem.length - 1; i >= 0; i--) if (mem[i].el === s) mem.splice(i, 1);
      diag.marque = null;
      console.log('[entete msg] menu lateral rendu — il avait ete masque par erreur.');
    }
  }

  function tour() {
    rendreSidebar();
    poserEntete();
    masquerMarque();`);

/* Le refus final dans masquerOnglets n'est pas touche ; on borne aussi
   masquerMarque pour qu'il ne puisse plus jamais viser le menu. */
const AVANT_MASQUER = `    var b = barreMarque();
    if (!b) { diag.marque = null; return; }`;
if (src.split(AVANT_MASQUER).length - 1 !== 1) echec('masquerMarque introuvable.');
src = src.split(AVANT_MASQUER).join(`    var b = barreMarque();
    if (!b) { diag.marque = null; return; }
    if (b.id === 'bhSidebar' || (b.closest && b.closest('#bhSidebar'))) {
      diag.marque = 'refus : la cible serait le menu lateral';
      return;
    }`);

[
  ['la forme de la barre', 'function estBarreDuHaut(el)'],
  ['le point de depart', 'smart property manager'],
  ['le refus du menu', "el.id === 'bhSidebar'"],
  ['le menu rendu', 'function rendreSidebar()'],
  ['le garde-fou', 'refus : la cible serait le menu lateral'],
].forEach(function (c) {
  if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent apres modification.');
});

try { new Function(src); } catch (e) { echec('Le module ne serait plus valide — ' + e.message); }

if (!ESSAI) {
  fs.writeFileSync(MODULE, src, 'utf8');
  const relu = fs.readFileSync(MODULE, 'utf8');
  if (relu.indexOf('estBarreDuHaut') === -1) echec("La correction n'est pas dans le fichier apres ecriture.");
  try { new Function(relu); } catch (e) { echec('Module invalide apres ecriture — ' + e.message); }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  public/js/bh-entete-messages.js  cible corrigee');
console.log('\n  Je masquais #bhSidebar — le menu lateral porte « BOOSTINGHOST »');
console.log('  lui aussi, et ma regle prenait le plus court. Le menu est rendu');
console.log('  au chargement, et deux refus l\'excluent desormais.');
console.log('\n  La barre du haut est trouvee par sa FORME : large, basse, tout');
console.log('  en haut, en partant de « SMART PROPERTY MANAGER » qui n\'existe');
console.log('  que sous le logo.');
console.log('\n  A verifier, cache vide : /messages.html');
console.log('    bhVerifEnteteMsg().marque_masquee');
console.log('  J\'attends un nom de barre, PAS « #bhSidebar ». Si la reponse');
console.log('  est « refus » ou « non trouvee », la barre a une autre forme');
console.log('  que celle que je decris, et je verrai laquelle.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
