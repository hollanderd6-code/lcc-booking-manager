#!/usr/bin/env node
/* ============================================================
   outils/refonte-3h-loupe-unique.js
   Lot 3h : une seule loupe, et le header qui part vraiment
   ============================================================

   ── MON ERREUR ───────────────────────────────────────────────────
   Votre capture montre trois loupes et un header toujours la. Les deux
   defauts ont la meme cause.

   Le composant de recherche RE-INJECTE son bouton .bhgs-trigger-mobile
   dans le header, a intervalles. Mon module repassait toutes les
   secondes et adoptait chaque nouveau venu : une loupe de plus a chaque
   passage. Et comme une loupe fraiche reapparaissait dans le header, mon
   filet de securite comptait un « bouton vivant » et refusait de le
   masquer. Logique respectee, resultat absurde.

   Deplacer un noeud que son proprietaire recree ne marche pas. Il faut
   arreter de le deplacer.

   ── LA CORRECTION ────────────────────────────────────────────────
   L'en-tete porte desormais SA loupe, la sienne, creee une fois. Au
   clic, elle declenche le bouton d'origine — celui qui existe a cet
   instant, ou qu'il soit. La logique de recherche n'est pas dupliquee :
   elle est appelee.

   Et a chaque passage, le module :
     · supprime toute loupe surnumeraire arrivee dans l'en-tete
     · masque les loupes du header au lieu de les deplacer
     · masque le header, sans plus compter les boutons que son
       proprietaire y remet

   Le rond aux initiales, lui, porte un id unique : il est deplace une
   fois, sans risque de doublon.

   ── LE FILET, REVISE ─────────────────────────────────────────────
   Le header n'est masque que si l'en-tete porte bien sa loupe ET le
   rond. La condition ne depend plus de ce que le header contient — donc
   plus de blocage par un bouton recree.

   Usage :
     node outils/refonte-3h-loupe-unique.js --essai
     node outils/refonte-3h-loupe-unique.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'js', 'bh-entete-jour.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('public/js/bh-entete-jour.js introuvable.');

let src = fs.readFileSync(CIBLE, 'utf8');
if (src.indexOf('deplacerCommandes') === -1) echec('Lancez d\'abord refonte-3g-entete-maquette.js.');

if (src.indexOf('bhLoupeEntete') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* On remplace toute la fonction, du commentaire d'ouverture a sa
   derniere ligne. Bornes reperees sur des lignes courtes et uniques. */
const debut = src.indexOf('  /* La loupe et le rond sont DEPLACES');
const fin = src.indexOf('  window.bhVerifEntete = function () {');
if (debut === -1 || fin === -1 || fin < debut) echec('Bornes de la fonction introuvables.');

const NOUVELLE = `  /* ── Une loupe, la notre, creee une fois ──────────────────────
     Le composant de recherche recree son bouton a intervalles : le
     deplacer produisait une loupe de plus a chaque passage. On cree
     donc la notre, et au clic on declenche l'original — celui qui
     existe a cet instant. La logique de recherche est appelee, jamais
     dupliquee. */
  var SVG_LOUPE = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true"'
    + ' stroke="#3D4A44" stroke-width="1.9" stroke-linecap="round">'
    + '<circle cx="10.6" cy="10.6" r="6.4"/><path d="M15.4 15.4 20.5 20.5"/></svg>';

  function loupeOriginale() {
    var tous = document.querySelectorAll('.bhgs-trigger-mobile, .bhgs-trigger, [class*="bhgs-trigger"]');
    for (var i = 0; i < tous.length; i++) {
      if (tous[i].id === 'bhLoupeEntete') continue;
      return tous[i];
    }
    return null;
  }

  function poserLoupe(droite) {
    if (document.getElementById('bhLoupeEntete')) return true;
    var b = document.createElement('button');
    b.id = 'bhLoupeEntete';
    b.type = 'button';
    b.setAttribute('aria-label', 'Rechercher');
    b.style.cssText = 'flex:none;width:40px;height:40px;padding:0;border:1px solid #E4E1D8'
      + ';border-radius:50%;background:#fff;display:inline-flex;align-items:center'
      + ';justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent';
    b.innerHTML = SVG_LOUPE;
    b.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      var orig = loupeOriginale();
      if (!orig) { console.warn('[entete] aucun bouton de recherche a declencher'); return; }
      /* Masque : certaines librairies refusent d'agir sur un element
         invisible. On le montre le temps du clic. */
      var avant = orig.style.display;
      orig.style.removeProperty('display');
      try { orig.click(); } catch (e) {}
      setTimeout(function () {
        if (orig.dataset.bhLoupeMasquee) orig.style.setProperty('display', 'none', 'important');
        else orig.style.display = avant;
      }, 60);
    });
    droite.insertBefore(b, droite.firstChild);
    diag.loupe = true;
    return true;
  }

  /* Le menage : toute loupe surnumeraire arrivee dans l'en-tete par mes
     passages precedents, et celles du header, sont masquees. */
  function rangerLoupes(droite) {
    var n = 0;
    var tous = document.querySelectorAll('.bhgs-trigger-mobile, .bhgs-trigger, [class*="bhgs-trigger"]');
    for (var i = 0; i < tous.length; i++) {
      var e = tous[i];
      if (e.id === 'bhLoupeEntete') continue;
      /* Une intruse deja dans l'en-tete : elle vient de mes anciens
         deplacements, on la retire du flux. */
      if (droite && droite.contains(e)) { e.remove(); n++; continue; }
      if (!e.dataset.bhLoupeMasquee) {
        e.dataset.bhLoupeMasquee = '1';
        e.style.setProperty('display', 'none', 'important');
        n++;
      }
    }
    diag.loupes_rangees = (diag.loupes_rangees || 0) + n;
    return n;
  }

  function deplacerCommandes() {
    var droite = document.getElementById('bhEnteteCommandes');
    if (!droite) return false;

    poserLoupe(droite);
    rangerLoupes(droite);

    /* Le rond porte un id unique : un seul deplacement possible. */
    var rond = document.getElementById('bhAvatarHeader');
    if (rond && rond.parentElement !== droite) {
      rond.style.setProperty('margin', '0', 'important');
      droite.appendChild(rond);
      diag.rond = true;
    }

    /* Le header part si l'en-tete porte sa loupe ET le rond. La
       condition ne depend plus de ce que le header contient — sinon un
       bouton recree par son proprietaire le bloquerait indefiniment. */
    var maLoupe = document.getElementById('bhLoupeEntete');
    var monRond = document.getElementById('bhAvatarHeader');
    var pret = !!(maLoupe && maLoupe.parentElement === droite)
            && !!(monRond && monRond.parentElement === droite);

    if (pret) {
      var repere = document.querySelector('.mobile-logo') || loupeOriginale();
      var barre = repere ? repere.closest('header, .mobile-header, [class*="header"]') : null;
      if (barre && barre !== document.body && !barre.contains(droite)) {
        if (!barre.dataset.bhMasquee) {
          barre.style.setProperty('display', 'none', 'important');
          barre.dataset.bhMasquee = '1';
          diag.barre_masquee = true;
        } else if (getComputedStyle(barre).display !== 'none') {
          /* Son proprietaire l'a rouverte : on remasque, sans bruit. */
          barre.style.setProperty('display', 'none', 'important');
        }
      } else if (!barre) {
        diag.raison = 'conteneur du header introuvable';
      }
    } else {
      diag.raison = 'en-tete incomplet (loupe ou rond absent)';
    }
    return true;
  }

`;

src = src.slice(0, debut) + NOUVELLE + src.slice(fin);

/* ── Le diagnostic compte les loupes ────────────────────────── */
const avantDiag = "      barre_beige_masquee: !!diag.barre_masquee,";
if (src.split(avantDiag).length - 1 !== 1) echec('Ligne du diagnostic introuvable.');
src = src.split(avantDiag).join(
  "      barre_beige_masquee: !!diag.barre_masquee,\n"
  + "      loupes_visibles: Array.prototype.slice.call(\n"
  + "        document.querySelectorAll('#bhLoupeEntete, .bhgs-trigger-mobile, [class*=\"bhgs-trigger\"]')\n"
  + "      ).filter(function (e) { return getComputedStyle(e).display !== 'none'; }).length,\n"
  + "      loupes_rangees: diag.loupes_rangees || 0,"
);

/* ── Verifications ───────────────────────────────────────────── */

[
  ['la loupe propre', "b.id = 'bhLoupeEntete'"],
  ['le declenchement de l\'originale', 'var orig = loupeOriginale();'],
  ['le rangement', 'function rangerLoupes(droite) {'],
  ['la suppression des intruses', 'if (droite && droite.contains(e)) { e.remove(); n++; continue; }'],
  ['la condition independante du header', 'var pret = !!(maLoupe && maLoupe.parentElement === droite)'],
  ['le remasquage', "/* Son proprietaire l'a rouverte : on remasque, sans bruit. */"],
  ['le compte des loupes visibles', 'loupes_visibles:'],
].forEach(function (c) {
  if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent apres modification.');
});

if (src.indexOf('droite.appendChild(loupe);') !== -1) echec('L\'ancien deplacement de la loupe subsiste. Refus.');
if (src.indexOf('cloneNode') !== -1) echec('Un cloneNode est apparu. Refus.');
if (src.split('function deplacerCommandes()').length - 1 !== 1) echec('deplacerCommandes est definie plusieurs fois. Refus.');

try {
  new Function(src);
} catch (e) {
  echec('Le module ne serait plus du JavaScript valide — ' + e.message);
}

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('bhLoupeEntete') === -1) {
    echec("La correction n'est pas dans le fichier apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  L\'en-tete porte SA loupe, creee une fois. Au clic, elle');
console.log('  declenche le bouton d\'origine — la recherche est appelee,');
console.log('  jamais dupliquee.');
console.log('  Les loupes surnumeraires sont supprimees, celles du header');
console.log('  masquees. Le header est masque, et remasque s\'il se rouvre.');
console.log('\n  A verifier sur telephone, cache vide : /app.html');
console.log('  1. UNE seule loupe, a droite du titre. Attendez 10 secondes');
console.log('     et regardez encore : toujours une seule.');
console.log('  2. Touchez-la : la recherche doit s\'ouvrir normalement.');
console.log('  3. Le header beige a disparu.');
console.log('  4. bhVerifEntete()  — loupes_visibles doit valoir 1.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
