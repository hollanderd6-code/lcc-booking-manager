#!/usr/bin/env node
/* ============================================================
   outils/refonte-19c-barre-par-position.js
   Lot 19c : la trouver par ou elle est, pas par ce qu'elle dit
   ============================================================

   ── CE QUE LA SONDE A MONTRE ─────────────────────────────────────
   Le seul « SMART PROPERTY MANAGER » du document vit dans #bhSidebar,
   et il mesure zero par zero pixel — le menu lateral est replie. La
   barre que vous voyez en haut ne porte donc AUCUN de mes reperes :
   son logo est un SVG ou une image de fond, sans texte lisible.

   J'ai cherche trois fois un mot. La barre n'est pas un mot, c'est un
   endroit.

   ── LA REGLE, ENFIN POSITIONNELLE ────────────────────────────────
   On ramene la page en haut, puis on retient les elements qui occupent
   la bande superieure :

       top      entre -4 et 12 pixels
       hauteur  entre 36 et 150
       largeur  au moins 70 % de l'ecran
       visible  display et opacite reels

   Et on refuse : #bhSidebar et sa descendance, tout ce qui porte
   « sidebar » ou « drawer » en classe, tout ce qui contient la liste ou
   notre propre en-tete, le body et l'html.

   Parmi les candidats restants on prend le PLUS PROFOND — la barre
   elle-meme, pas le conteneur de page qui commence aussi en haut.

   ── ET S'IL SE TROMPE ENCORE ─────────────────────────────────────
   bhVerifEnteteMsg().candidats_barre liste desormais tout ce que la
   bande contenait, avec balise, classe, taille et profondeur — meme
   quand rien n'est masque. Plus besoin de vous faire coller une sonde :
   la reponse est deja dans le diagnostic.

   Et bhRendreMarque() rend la barre sans tout annuler, si je vise mal.

   Usage :
     node outils/refonte-19c-barre-par-position.js --essai
     node outils/refonte-19c-barre-par-position.js
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
if (src.indexOf('candidatsBande') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

const DEBUT = src.indexOf('  /* La barre de marque.');
if (DEBUT === -1) echec('Le lot 19b n\'est pas applique (barreMarque introuvable).');
const FIN = src.indexOf('  var rechercheOuverte = false;');
if (FIN === -1 || FIN < DEBUT) echec('Borne de fin introuvable.');

const NOUVEAU = `  /* La barre de marque, par la POSITION.

     Trois lots durant j'ai cherche un mot : « BOOSTINGHOST » designait
     le menu lateral, « SMART PROPERTY MANAGER » n'existe que dedans, et
     il mesure zero pixel. Le logo visible en haut est un SVG ou une
     image de fond — aucun texte a saisir.

     Une barre du haut n'est pas un mot, c'est un endroit : collee en
     haut, large, basse. On la decrit ainsi. */

  function profondeur(el) {
    var d = 0;
    while (el && el.parentElement) { d++; el = el.parentElement; }
    return d;
  }

  function decrire(el) {
    var r = el.getBoundingClientRect();
    return (el.tagName ? el.tagName.toLowerCase() : '?')
      + (el.id ? '#' + el.id : '')
      + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/)[0] : '')
      + ' ' + Math.round(r.width) + '\\u00d7' + Math.round(r.height)
      + ' top=' + Math.round(r.top) + ' p=' + profondeur(el);
  }

  function interdit(el) {
    if (!el || el.nodeType !== 1) return true;
    var t = el.tagName;
    if (t === 'BODY' || t === 'HTML' || t === 'SCRIPT' || t === 'STYLE') return true;
    if (el.id === 'bhSidebar' || el.id === 'bhEnteteMsg' || el.id === 'bhMessagesListe') return true;
    if (el.closest && el.closest('#bhSidebar, #bhEnteteMsg')) return true;
    var cls = ' ' + (typeof el.className === 'string' ? el.className.toLowerCase() : '') + ' ';
    if (/sidebar|drawer|offcanvas|modal/.test(cls)) return true;
    if (el.querySelector && el.querySelector('#conversationsList, #bhMessagesListe, #msgsSearchInput')) return true;
    return false;
  }

  /* Tout ce qui occupe la bande du haut. Conserve meme en cas d'echec :
     c'est le diagnostic qui evitera une sonde de plus. */
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
      if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) continue;
      out.push(el);
    }
    return out;
  }

  function barreMarque() {
    /* La bande se lit en haut de page : si l'on a defile, tout glisse. */
    if (window.scrollY > 4) { try { window.scrollTo(0, 0); } catch (e) {} }
    var c = candidatsBande();
    diag.candidats = c.map(decrire);
    if (!c.length) return null;
    /* Le plus profond : la barre, pas le conteneur de page qui commence
       lui aussi en haut. */
    c.sort(function (a, b) { return profondeur(b) - profondeur(a); });
    return c[0];
  }

`;

src = src.slice(0, DEBUT) + NOUVEAU + src.slice(FIN);

/* Le champ de diagnostic. */
const ETAT = `  var diag = { entete: false, rond: false, loupe: false, defilement: [], onglets: null,
               marque: null, recherche: null, raison: '' };`;
if (src.split(ETAT).length - 1 !== 1) echec('L\'etat interne est introuvable.');
src = src.split(ETAT).join(`  var diag = { entete: false, rond: false, loupe: false, defilement: [], onglets: null,
               marque: null, recherche: null, candidats: [], raison: '' };`);

const DIAG = `      marque_masquee: diag.marque || 'barre BOOSTINGHOST non trouvee — rien masque',`;
if (src.split(DIAG).length - 1 !== 1) echec('Le diagnostic est introuvable.');
src = src.split(DIAG).join(`      marque_masquee: diag.marque || 'barre non trouvee — rien masque',
      candidats_barre: diag.candidats.length ? diag.candidats : 'la bande du haut est vide',`);

/* Rendre la barre seule, sans tout annuler. */
const AVANT_VERIF = `  window.bhVerifEnteteMsg = function () {`;
if (src.split(AVANT_VERIF).length - 1 !== 1) echec('bhVerifEnteteMsg introuvable.');
src = src.split(AVANT_VERIF).join(`  /* Si je vise mal, la barre revient sans defaire le reste. */
  window.bhRendreMarque = function () {
    var n = 0;
    for (var i = mem.length - 1; i >= 0; i--) {
      var m = mem[i];
      if (m.type === 'style' && m.el.dataset && m.el.dataset.bhMarqueMasquee) {
        if (m.valeur) m.el.style.setProperty(m.prop, m.valeur, m.priorite);
        else m.el.style.removeProperty(m.prop);
        delete m.el.dataset.bhMarqueMasquee;
        mem.splice(i, 1);
        n++;
      }
    }
    diag.marque = null;
    console.log(n + ' barre(s) rendue(s).');
    return n;
  };

  window.bhVerifEnteteMsg = function () {`);

[
  ['les candidats', 'function candidatsBande()'],
  ['la profondeur', 'function profondeur(el)'],
  ['les refus', 'function interdit(el)'],
  ['le diagnostic', 'candidats_barre:'],
  ['le retour arriere cible', 'bhRendreMarque'],
].forEach(function (c) {
  if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent apres modification.');
});

if (src.indexOf('SMART PROPERTY') !== -1) echec('L\'ancien repere textuel subsiste. Refus.');

try { new Function(src); } catch (e) { echec('Le module ne serait plus valide — ' + e.message); }

if (!ESSAI) {
  fs.writeFileSync(MODULE, src, 'utf8');
  const relu = fs.readFileSync(MODULE, 'utf8');
  if (relu.indexOf('candidatsBande') === -1) echec("La correction n'est pas dans le fichier apres ecriture.");
  try { new Function(relu); } catch (e) { echec('Module invalide apres ecriture — ' + e.message); }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  public/js/bh-entete-messages.js  detection par position');
console.log('\n  Le seul « SMART PROPERTY MANAGER » du document est dans le menu');
console.log('  lateral, a zero pixel. La barre visible n\'a pas de texte : son');
console.log('  logo est un SVG ou une image de fond. Trois lots a chercher un');
console.log('  mot, alors qu\'une barre du haut est un ENDROIT.');
console.log('\n  Elle est desormais decrite ainsi : collee en haut, au moins');
console.log('  70 % de large, 36 a 150 de haut, visible — et le plus profond');
console.log('  des candidats, pour ne pas prendre le conteneur de page.');
console.log('\n  A verifier, cache vide : /messages.html');
console.log('    bhVerifEnteteMsg()');
console.log('  Deux champs : marque_masquee, et candidats_barre qui liste TOUT');
console.log('  ce que la bande contenait. Si la barre est encore la, ce champ');
console.log('  me la nommera sans nouvelle sonde.');
console.log('\n  Si je vise mal : bhRendreMarque() rend la barre seule.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
