#!/usr/bin/env node
/* ============================================================
   outils/refonte-3i-vide-du-haut.js
   Lot 3i : reprendre la place que le header a laissee
   ============================================================

   ── D'OU VIENT LE BLANC ──────────────────────────────────────────
   Le header est masque, mais la place qu'il occupait ne s'est pas
   refermee. Deux raisons possibles, souvent les deux ensemble :

   1. Le header etait en position fixe. La page compensait sa hauteur
      avec une marge ou un padding en haut — sur le <body>, sur le
      conteneur principal, ou via une variable CSS. Le header parti, la
      compensation reste : c'est le blanc.

   2. Le premier bloc de contenu porte sa propre marge haute, prevue
      pour respirer SOUS le header. Sans header, elle s'ajoute au vide.

   Deviner laquelle serait un pari. Le module mesure : il regarde ce qui
   se trouve reellement au-dessus de l'en-tete, et ne retire que ce
   qu'il a identifie.

   ── CE QUE FAIT LE LOT ───────────────────────────────────────────
   · il remonte l'arbre depuis l'en-tete et neutralise les
     padding-top et margin-top superieurs a 20 px, en memorisant chacun
   · il ecrase les variables CSS de hauteur d'en-tete si elles existent
   · il laisse une marge de securite : 10 px plus l'encoche du telephone
     (env(safe-area-inset-top)), pour que le titre ne colle pas au haut
     de l'ecran ni ne passe sous l'heure

   Tout est memorise : bhAnnulerVideDuHaut() remet chaque valeur
   d'origine, si le resultat ne vous convient pas. Une correction qu'on
   ne peut pas defaire n'est pas une correction, c'est un pari.

   Usage :
     node outils/refonte-3i-vide-du-haut.js --essai
     node outils/refonte-3i-vide-du-haut.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(process.cwd(), 'public');
const MODULE = path.join(PUBLIC, 'js', 'bh-vide-du-haut.js');
const APP = path.join(PUBLIC, 'app.html');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(APP)) echec('public/app.html introuvable.');
if (!fs.existsSync(path.join(PUBLIC, 'js', 'bh-entete-jour.js'))) {
  echec('bh-entete-jour.js absent. Lancez d\'abord les lots 3f a 3h.');
}

const SOURCE = `/* ============================================================
   bh-vide-du-haut.js — refermer la place du header
   ============================================================
   Le header masque laisse derriere lui la compensation de sa hauteur.
   Ce module la mesure et la retire, en memorisant tout pour pouvoir
   revenir en arriere.
   ============================================================ */
(function () {
  'use strict';

  if (window.__bhVideDuHaut) return;
  window.__bhVideDuHaut = true;

  var SEUIL = 20;   /* en dessous, c'est du style voulu, pas une compensation */
  var GARDE = 10;   /* ce qu'on laisse au-dessus du titre */
  var mem = [];
  var diag = { retires: [], variables: [], hauteur_avant: null, hauteur_apres: null };

  function px(v) {
    var n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }

  function memoriser(el, prop, valeur) {
    mem.push({ el: el, prop: prop, valeur: el.style.getPropertyValue(prop), priorite: el.style.getPropertyPriority(prop) });
    el.style.setProperty(prop, valeur, 'important');
  }

  function nom(el) {
    return el.tagName.toLowerCase()
      + (el.id ? '#' + el.id : '')
      + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/)[0] : '');
  }

  function refermer() {
    var entete = document.getElementById('bhEnteteJour');
    if (!entete) return false;

    diag.hauteur_avant = Math.round(entete.getBoundingClientRect().top);
    /* Deja en haut : rien a faire. */
    if (diag.hauteur_avant <= GARDE + 24) { diag.raison = 'deja en haut'; return true; }

    /* 1. Les variables CSS de hauteur d'en-tete, si elles existent. */
    var racine = document.documentElement;
    var st = getComputedStyle(racine);
    ['--header-height', '--mobile-header-height', '--bh-header-height', '--topbar-height', '--header-h']
      .forEach(function (v) {
        var val = st.getPropertyValue(v);
        if (val && px(val) > SEUIL) {
          mem.push({ el: racine, prop: v, valeur: racine.style.getPropertyValue(v), priorite: '' });
          racine.style.setProperty(v, '0px');
          diag.variables.push(v + ' : ' + val.trim() + ' -> 0');
        }
      });

    /* 2. L'arbre au-dessus de l'en-tete. On ne touche qu'aux espaces
       hauts francs, jamais aux petits paddings de mise en page. */
    var el = entete;
    var garde = 0;
    while (el && el !== document.documentElement && garde++ < 10) {
      var s = getComputedStyle(el);
      ['padding-top', 'margin-top'].forEach(function (prop) {
        var v = px(s.getPropertyValue(prop));
        if (v > SEUIL) {
          memoriser(el, prop, '0px');
          diag.retires.push(nom(el) + ' ' + prop + ' : ' + Math.round(v) + 'px -> 0');
        }
      });
      el = el.parentElement;
    }

    /* 3. Le premier enfant du conteneur : s'il precede l'en-tete et
       n'est qu'un espaceur vide, il tombe. */
    var parent = entete.parentElement;
    if (parent) {
      for (var i = 0; i < parent.children.length; i++) {
        var c = parent.children[i];
        if (c === entete) break;
        var r = c.getBoundingClientRect();
        var vide = !(c.textContent || '').trim() && !c.querySelector('img, svg, input, button, canvas');
        if (vide && r.height > SEUIL && getComputedStyle(c).position === 'static') {
          memoriser(c, 'display', 'none');
          diag.retires.push(nom(c) + ' espaceur vide de ' + Math.round(r.height) + 'px masque');
        }
      }
    }

    /* 4. La garde : le titre ne doit ni coller au bord ni passer sous
       l'heure du telephone. */
    memoriser(entete, 'padding-top', 'calc(env(safe-area-inset-top, 0px) + ' + GARDE + 'px)');

    diag.hauteur_apres = Math.round(entete.getBoundingClientRect().top);
    return true;
  }

  window.bhAnnulerVideDuHaut = function () {
    for (var i = mem.length - 1; i >= 0; i--) {
      var m = mem[i];
      if (m.valeur) m.el.style.setProperty(m.prop, m.valeur, m.priorite);
      else m.el.style.removeProperty(m.prop);
    }
    var n = mem.length;
    mem = [];
    console.log(n + ' valeur(s) remise(s) d\\'origine. Rechargez pour repartir de zero.');
    return n;
  };

  window.bhVerifVide = function () {
    var entete = document.getElementById('bhEnteteJour');
    var res = {
      entete_trouve: !!entete,
      haut_avant: diag.hauteur_avant,
      haut_apres: entete ? Math.round(entete.getBoundingClientRect().top) : null,
      espaces_retires: diag.retires,
      variables_ecrasees: diag.variables,
      annulable: mem.length + ' valeur(s) memorisee(s)',
      raison: diag.raison
    };
    console.log('── Vide du haut ──');
    console.log(res);
    if (res.haut_apres !== null && res.haut_apres > 60) {
      console.warn('Le titre commence encore a ' + res.haut_apres + 'px du haut. Un espace'
        + ' m\\'echappe : envoyez-moi cette sortie.');
    }
    console.log('Pour revenir en arriere : bhAnnulerVideDuHaut()');
    return res;
  };

  function demarrer() { refermer(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(demarrer, 1400); });
  } else {
    setTimeout(demarrer, 1400);
  }
  /* Le header n'est masque qu'apres plusieurs passages du lot 3h. */
  setTimeout(demarrer, 2600);
  setTimeout(demarrer, 4400);
  setTimeout(demarrer, 6500);
})();
`;

const BALISE = '<script src="js/bh-vide-du-haut.js"></script>';

let html = fs.readFileSync(APP, 'utf8');
let etat;

if (html.indexOf('bh-vide-du-haut.js') !== -1) {
  etat = 'deja';
} else {
  const ancre = html.indexOf('bh-entete-jour.js');
  if (ancre === -1) echec('bh-entete-jour.js absent de app.html.');
  const fin = html.indexOf('</script>', ancre);
  if (fin === -1) echec('Balise mal formee dans app.html.');
  const pos = fin + '</script>'.length;
  html = html.slice(0, pos) + '\n' + BALISE + html.slice(pos);
  etat = 'apres bh-entete-jour.js';
  if (!ESSAI) fs.writeFileSync(APP, html, 'utf8');
}

if (!ESSAI) {
  fs.writeFileSync(MODULE, SOURCE, 'utf8');
  const relu = fs.readFileSync(MODULE, 'utf8');
  if (relu.indexOf('bhAnnulerVideDuHaut') === -1) echec("Le module n'est pas complet apres ecriture.");
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  public/js/bh-vide-du-haut.js  (' + Math.round(SOURCE.length / 1024) + ' Ko)');
console.log('  app.html             ' + etat);
console.log('\n  Le module MESURE au lieu de deviner : il remonte l\'arbre depuis');
console.log('  l\'en-tete et ne retire que les espaces hauts francs (> 20 px),');
console.log('  plus les variables CSS de hauteur d\'en-tete.');
console.log('  Il laisse 10 px et l\'encoche du telephone au-dessus du titre.');
console.log('\n  TOUT est memorise :  bhAnnulerVideDuHaut()  remet chaque valeur.');
console.log('\n  A verifier sur telephone, cache vide : /app.html');
console.log('  « Lundi 31 aout » doit commencer juste sous l\'heure.');
console.log('  Puis :  bhVerifVide()');
console.log('  « haut_apres » doit etre bien plus petit que « haut_avant ».');
console.log('  S\'il reste au-dessus de 60, un espace m\'echappe : collez-moi');
console.log('  la sortie, elle nomme chaque element touche.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
