#!/usr/bin/env node
/* ============================================================
   outils/refonte-19d-mobile-header.js
   Lot 19d : la barre s'appelle .mobile-header
   ============================================================

   ── ELLE A UN NOM ────────────────────────────────────────────────
   La sonde l'a nommee : DIV.mobile-header, 442 x 60, position fixed,
   collee en haut. La regle du lot 19c l'aurait trouvee — elle n'etait
   simplement pas encore deployee quand vous avez teste.

   Plutot que d'attendre un deploiement pour verifier une deduction, on
   la nomme. Un selecteur connu vaut mieux qu'une heuristique juste :
   il ne peut pas se tromper de cible.

   La detection par position reste en second recours, si la classe
   disparaissait un jour.

   ── LA PLACE QU'ELLE RESERVAIT ───────────────────────────────────
   Une barre fixe ne prend pas de place dans le flux : le contenu passe
   dessous, et quelqu'un a donc pose un espace en haut pour compenser.
   Masquer la barre sans retirer cet espace laisserait soixante pixels
   de vide.

   Le module cherche donc, sur les ancetres de la liste, un espacement
   haut compris entre 40 et 90 pixels — la hauteur de la barre — et le
   ramene a zero. Il note lequel dans le diagnostic. En dehors de cette
   fourchette il ne touche a rien : un espacement de 12 pixels est une
   respiration, pas une compensation.

   Usage :
     node outils/refonte-19d-mobile-header.js --essai
     node outils/refonte-19d-mobile-header.js
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

if (!fs.existsSync(MODULE)) echec('bh-entete-messages.js absent.');

let src = fs.readFileSync(MODULE, 'utf8');
if (src.indexOf('mobile-header') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}
if (src.indexOf('function barreMarque()') === -1) echec('Les lots 18 et 19 ne sont pas appliques.');

/* ── 1. Nommer la barre ───────────────────────────────────────── */

const iBarre = src.indexOf('  function barreMarque()');
if (iBarre === -1) echec('barreMarque introuvable.');
const iFin = src.indexOf('\n  }\n', iBarre);
if (iFin === -1) echec('Fin de barreMarque introuvable.');

const REMPLACANT = `  function barreMarque() {
    /* La sonde l'a nommee : DIV.mobile-header, 60 pixels, fixed, en
       haut. Un selecteur connu ne peut pas se tromper de cible ;
       l'heuristique de position reste en second recours si la classe
       disparait un jour. */
    var nommee = document.querySelector('.mobile-header');
    if (nommee && !interdit(nommee)) {
      diag.candidats = [decrire(nommee) + '  (nommee)'];
      return nommee;
    }
    if (window.scrollY > 4) { try { window.scrollTo(0, 0); } catch (e) {} }
    var c = candidatsBande();
    diag.candidats = c.map(decrire);
    if (!c.length) return null;
    c.sort(function (a, b) { return profondeur(b) - profondeur(a); });
    return c[0];
  }`;

/* Le lot 19c n'est peut-etre pas passe : on fournit alors les outils
   dont depend le remplacant. */
let prealable = '';
if (src.indexOf('function candidatsBande()') === -1) {
  prealable = `  function profondeur(el) {
    var d = 0;
    while (el && el.parentElement) { d++; el = el.parentElement; }
    return d;
  }

  function decrire(el) {
    var r = el.getBoundingClientRect();
    return (el.tagName ? el.tagName.toLowerCase() : '?')
      + (el.id ? '#' + el.id : '')
      + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/)[0] : '')
      + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' top=' + Math.round(r.top);
  }

  function interdit(el) {
    if (!el || el.nodeType !== 1) return true;
    var t = el.tagName;
    if (t === 'BODY' || t === 'HTML') return true;
    if (el.id === 'bhSidebar' || el.id === 'bhEnteteMsg') return true;
    if (el.closest && el.closest('#bhSidebar, #bhEnteteMsg')) return true;
    if (el.querySelector && el.querySelector('#conversationsList, #bhMessagesListe')) return true;
    return false;
  }

  function candidatsBande() {
    var out = [];
    var tous = document.querySelectorAll('div, header, nav, section, aside');
    for (var i = 0; i < tous.length; i++) {
      var el = tous[i];
      if (interdit(el)) continue;
      var r = el.getBoundingClientRect();
      if (r.top < -4 || r.top > 12) continue;
      if (r.height < 36 || r.height > 150) continue;
      if (r.width < window.innerWidth * 0.7) continue;
      var s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      out.push(el);
    }
    return out;
  }

`;
}

src = src.slice(0, iBarre) + prealable + REMPLACANT + src.slice(iFin + 3);

/* Le champ candidats doit exister. */
if (src.indexOf('candidats: []') === -1) {
  const ETAT = 'marque: null, recherche: null,';
  if (src.split(ETAT).length - 1 !== 1) echec('L\'etat interne est introuvable.');
  src = src.split(ETAT).join('marque: null, recherche: null, candidats: [],');
}

/* ── 2. L'espace qu'elle reservait ────────────────────────────── */

const AVANT = `  function masquerMarque() {`;
if (src.split(AVANT).length - 1 !== 1) echec('masquerMarque introuvable.');
src = src.split(AVANT).join(`  /* Une barre fixe ne prend pas de place dans le flux : le contenu
     passe dessous et quelqu'un a pose un espace en haut pour compenser.
     La masquer sans retirer cet espace laisserait soixante pixels de
     vide. On ne touche qu'a la fourchette de sa hauteur — un espacement
     de douze pixels est une respiration, pas une compensation. */
  function retirerEspaceReserve(hauteur) {
    var hote = document.getElementById('bhMessagesListe');
    if (!hote) return;
    var el = hote.parentElement, garde = 0;
    while (el && el !== document.body && garde++ < 6) {
      if (!el.dataset.bhEspaceRetire) {
        var s = getComputedStyle(el);
        ['padding-top', 'margin-top'].forEach(function (prop) {
          var v = parseFloat(s.getPropertyValue(prop)) || 0;
          if (v >= Math.max(40, hauteur - 20) && v <= Math.max(90, hauteur + 30)) {
            memoriser(el, prop, '0px');
            el.dataset.bhEspaceRetire = '1';
            diag.espace = (el.id ? '#' + el.id : el.tagName.toLowerCase())
              + ' ' + prop + ' ' + Math.round(v) + 'px \\u2192 0';
          }
        });
      }
      el = el.parentElement;
    }
  }

  function masquerMarque() {`);

const APRES_MASQUE = `    diag.marque = (b.id ? '#' + b.id : b.tagName.toLowerCase())`;
if (src.split(APRES_MASQUE).length - 1 !== 1) echec('La pose du diagnostic est introuvable.');
src = src.split(APRES_MASQUE).join(`    retirerEspaceReserve(Math.round(b.getBoundingClientRect().height) || 60);
    diag.marque = (b.id ? '#' + b.id : b.tagName.toLowerCase())`);

if (src.indexOf('espace_retire:') === -1) {
  const D = `      candidats_barre:`;
  if (src.split(D).length - 1 === 1) {
    src = src.split(D).join(`      espace_retire: diag.espace || 'aucun espace de compensation trouve',
      candidats_barre:`);
  } else {
    const D2 = `      marque_masquee:`;
    if (src.split(D2).length - 1 !== 1) echec('Le diagnostic est introuvable.');
    src = src.split(D2).join(`      espace_retire: diag.espace || 'aucun espace de compensation trouve',
      candidats_barre: diag.candidats.length ? diag.candidats : 'aucun candidat',
      marque_masquee:`);
  }
}

if (src.indexOf('espace: null') === -1) {
  src = src.split('candidats: [],').join('candidats: [], espace: null,');
}

src = src.split('      delete m.el.dataset.bhReplie;')
         .join('      delete m.el.dataset.bhReplie;\n        delete m.el.dataset.bhEspaceRetire;');

[
  ['la barre nommee', "querySelector('.mobile-header')"],
  ['l espace reserve', 'function retirerEspaceReserve('],
  ['le diagnostic', 'espace_retire:'],
].forEach(function (c) {
  if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent apres modification.');
});

try { new Function(src); } catch (e) { echec('Le module ne serait plus valide — ' + e.message); }

if (!ESSAI) {
  fs.writeFileSync(MODULE, src, 'utf8');
  const relu = fs.readFileSync(MODULE, 'utf8');
  if (relu.indexOf('mobile-header') === -1) echec("La correction n'est pas dans le fichier apres ecriture.");
  try { new Function(relu); } catch (e) { echec('Module invalide apres ecriture — ' + e.message); }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  public/js/bh-entete-messages.js  .mobile-header nommee');
if (prealable) console.log('  (les outils de position du lot 19c ont ete ajoutes au passage)');
console.log('\n  La sonde l\'a nommee : DIV.mobile-header, 60 pixels, fixed. Un');
console.log('  selecteur connu ne peut pas se tromper de cible — l\'heuristique');
console.log('  de position reste en second recours.');
console.log('\n  L\'espace de compensation est retire aussi : une barre fixe ne');
console.log('  prend pas de place dans le flux, quelqu\'un a donc pose soixante');
console.log('  pixels en haut du contenu. Seule cette fourchette est touchee.');
console.log('\n  A verifier, cache vide : /messages.html');
console.log('    plus de barre, et pas de vide a sa place');
console.log('    bhVerifEnteteMsg()  ->  marque_masquee: div.mobile-header');
console.log('                            espace_retire renseigne');
console.log('\n  Si un vide subsiste : bhVerifEnteteMsg().espace_retire dira');
console.log('  « aucun espace trouve », et l\'espacement est ailleurs que sur');
console.log('  les six ancetres de la liste.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
