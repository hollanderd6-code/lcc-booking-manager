#!/usr/bin/env node
/* ============================================================
   outils/refonte-1e-finitions.js
   Lot 1e : trois defauts vus a l'ecran
   ============================================================

   La feuille fonctionne. Trois choses clochent, toutes visibles sur
   votre capture :

   1. « Messages » apparait deux fois — « Messages » et « Messages 7 ».
      Le badge de non-lus est un noeud enfant du lien : son chiffre
      entre dans le libelle et fabrique un faux second lien. Le
      dedoublonnage se fait sur href + libelle, donc il ne les voit pas
      comme identiques. Correction : nettoyer le libelle AVANT de
      comparer, et dedoublonner sur le href seul.

   2. Le bouton « + » flotte par-dessus la feuille, et la barre
      d'onglets se devine en bas. La feuille est en z-index 99998, eux
      sont plus hauts. Correction : la feuille monte a 2147483000, et
      les elements flottants connus sont masques le temps de l'ouverture.

   3. La carte du haut affiche « charles.induni@gmail.com » comme nom.
      C'est l'identifiant, pas le nom. Correction : quand l'identite
      n'est qu'une adresse, on en tire un nom lisible — « Charles
      Induni » — et l'adresse passe en seconde ligne, a sa place.

   Aucune de ces trois corrections ne touche a la structure : ce sont
   trois remplacements dans bh-mon-compte.js.

   Usage :
     node outils/refonte-1e-finitions.js --essai
     node outils/refonte-1e-finitions.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'js', 'bh-mon-compte.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('public/js/bh-mon-compte.js introuvable.');

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('nettoyerLibelle') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

function remplacer(avant, apres, quoi) {
  if (src.split(avant).length - 1 !== 1) {
    echec('\u00ab ' + quoi + ' \u00bb introuvable (ou present plusieurs fois).');
  }
  src = src.split(avant).join(apres);
}

/* ── 1. Le doublon « Messages 7 » ────────────────────────────── */

remplacer(
`  /* ── Lecture des entrees existantes ─────────────────────────── */
  function lireEntrees() {`,
`  /* Un libelle propre : sans le badge de non-lus, sans les chevrons,
     sans les espaces doubles. « Messages 7 » et « Messages » doivent
     etre reconnus comme une seule et meme entree. */
  function nettoyerLibelle(a) {
    var clone = a.cloneNode(true);
    /* On retire les compteurs avant de lire le texte. */
    var parasites = clone.querySelectorAll('.badge, .notif-count, .count, sup, [data-count], .bh-badge, .pill');
    for (var i = 0; i < parasites.length; i++) parasites[i].remove();
    var t = (clone.textContent || '').replace(/\\s+/g, ' ').trim();
    t = t.replace(/[\\u203A\\u00BB>›»]+$/g, '').trim();
    /* Un chiffre isole en fin de libelle est un compteur, pas un mot. */
    t = t.replace(/\\s+\\d{1,3}$/, '').trim();
    return t;
  }

  /* ── Lecture des entrees existantes ─────────────────────────── */
  function lireEntrees() {`,
  'la fonction de lecture'
);

remplacer(
`        var libelle = (a.textContent || '').replace(/\\s+/g, ' ').trim();
        if (!libelle || libelle.length > 60) continue;
        var cle = href + '|' + libelle.toLowerCase();
        if (vus[cle]) continue;
        vus[cle] = true;`,
`        var libelle = nettoyerLibelle(a);
        if (!libelle || libelle.length > 60) continue;
        /* Dedoublonnage sur la destination seule : deux liens vers la
           meme page sont la meme entree, quel que soit leur libelle. */
        var cle = href.split('#')[0].split('?')[0].toLowerCase();
        if (vus[cle]) continue;
        vus[cle] = true;`,
  'le dedoublonnage'
);

/* ── 2. La feuille passe devant tout ────────────────────────── */

remplacer(
  "    el.style.cssText = 'position:fixed;inset:0;z-index:99998;background:' + FOND",
  "    el.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:' + FOND",
  'le z-index de la feuille'
);

remplacer(
`  function afficher() {
    if (!feuille) construire();
    /* Reconstruire si la page a change entre-temps. */
    document.body.style.overflow = 'hidden';
    feuille.style.display = 'flex';
    requestAnimationFrame(function () { feuille.style.transform = 'translateY(0)'; });
  }`,
`  /* Les elements flottants (bouton « + », barre d'onglets) vivent au-dessus
     de presque tout. On les endort le temps de l'ouverture, et on les
     reveille intacts a la fermeture. */
  var FLOTTANTS = ['#bhFab', '.fab', '[class*="fab"]', '#addBtn', '.floating-action',
                   '.bh-tabbar', '#bhTabBar', '[class*="tabbar"]', '[class*="tab-bar"]',
                   '.mobile-nav', '#mobileNav'];
  var endormis = [];

  function endormir() {
    endormis = [];
    FLOTTANTS.forEach(function (sel) {
      try {
        var els = document.querySelectorAll(sel);
        for (var i = 0; i < els.length; i++) {
          var e = els[i];
          if (e === feuille || (feuille && feuille.contains(e))) continue;
          endormis.push([e, e.style.visibility]);
          e.style.visibility = 'hidden';
        }
      } catch (err) {}
    });
  }

  function reveiller() {
    endormis.forEach(function (p) { p[0].style.visibility = p[1] || ''; });
    endormis = [];
  }

  function afficher() {
    if (!feuille) construire();
    document.body.style.overflow = 'hidden';
    endormir();
    feuille.style.display = 'flex';
    requestAnimationFrame(function () { feuille.style.transform = 'translateY(0)'; });
  }`,
  'la fonction afficher'
);

remplacer(
`  function masquer() {
    if (!feuille) return;
    feuille.style.transform = 'translateY(100%)';
    document.body.style.overflow = '';
    setTimeout(function () { if (feuille) feuille.style.display = 'none'; }, 300);
  }`,
`  function masquer() {
    if (!feuille) return;
    feuille.style.transform = 'translateY(100%)';
    document.body.style.overflow = '';
    reveiller();
    setTimeout(function () { if (feuille) feuille.style.display = 'none'; }, 300);
  }`,
  'la fonction masquer'
);

/* ── 3. Un nom, puis l'adresse ──────────────────────────────── */

remplacer(
`    var init = '';
    if (nom) {
      var mots = nom.replace(/[^\\p{L}\\s]/gu, ' ').trim().split(/\\s+/);
      init = (mots[0] ? mots[0].charAt(0) : '') + (mots[1] ? mots[1].charAt(0) : '');
      init = init.toUpperCase();
    }
    return { nom: nom || 'Mon compte', initiales: init || '\\\\u2022\\\\u2022' };`,
`    /* Une adresse n'est pas un nom. « charles.induni@gmail.com » donne
       « Charles Induni », et l'adresse va en seconde ligne. */
    var affiche = nom, second = '';
    if (nom && nom.indexOf('@') !== -1) {
      second = nom;
      affiche = nom.split('@')[0]
        .replace(/[._-]+/g, ' ')
        .replace(/\\d+/g, '')
        .trim()
        .split(/\\s+/)
        .map(function (m) { return m ? m.charAt(0).toUpperCase() + m.slice(1) : ''; })
        .join(' ')
        .trim() || nom;
    }

    var init = '';
    if (affiche) {
      var mots = affiche.replace(/[^\\p{L}\\s]/gu, ' ').trim().split(/\\s+/).filter(Boolean);
      init = ((mots[0] || '').charAt(0) + (mots[1] || '').charAt(0)).toUpperCase();
    }
    return { nom: affiche || 'Mon compte', second: second, initiales: init || '\\\\u2022\\\\u2022' };`,
  'la lecture de l\'identite'
);

remplacer(
  "      + '<div style=\"font-size:13px;color:' + GRIS + ';margin-top:2px\">Boostinghost</div></div>';",
  "      + '<div style=\"font-size:13px;color:' + GRIS + ';margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap\">'\n      + (moi.second || 'Boostinghost') + '</div></div>';",
  'la seconde ligne de la carte'
);

/* ── Verifications ───────────────────────────────────────────── */

[
  ['le nettoyage du libelle', 'function nettoyerLibelle(a) {'],
  ['son appel', 'var libelle = nettoyerLibelle(a);'],
  ['le dedoublonnage par href', "var cle = href.split('#')[0].split('?')[0].toLowerCase();"],
  ['le z-index', 'z-index:2147483000'],
  ['l\'endormissement des flottants', 'function endormir() {'],
  ['le reveil', 'reveiller();'],
  ['le nom deduit', "second = nom;"],
  ['la seconde ligne', "(moi.second || 'Boostinghost')"],
].forEach(function (c) {
  if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent apres modification.');
});

/* Le reveil doit etre appele autant de fois qu'il est defini + 1 (masquer). */
if (src.split('reveiller()').length - 1 < 2) echec('Le reveil des flottants n\'est pas appele.');

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('nettoyerLibelle') === -1) {
    echec("La correction n'est pas dans le fichier apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  1. « Messages 7 » et « Messages » : une seule entree');
console.log('  2. Feuille au-dessus du « + » et de la barre d\'onglets');
console.log('  3. « Charles Induni », adresse en seconde ligne');
console.log('\n  A verifier sur telephone, cache vide : ouvrez le rond aux initiales.');
console.log('  Plus de doublon, plus de « + » qui flotte, un nom en tete.');
console.log('  Puis :  bhVerifMonCompte()   — « manquantes » doit valoir 0.');
console.log('  C\'est cette valeur qui autorise le lot 2 (retirer « Plus »).\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
