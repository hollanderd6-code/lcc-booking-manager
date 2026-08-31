#!/usr/bin/env node
/* ============================================================
   outils/refonte-10-capsule-calendrier.js
   Lot 10 : la capsule sous l'onglet Calendrier, et elle y reste
   ============================================================

   ── POURQUOI LE CORRECTIF DU LOT 8 N'A PAS TENU ──────────────────
   Le lot 8 posait bien la classe « active » sur l'onglet Calendrier,
   mais une seule fois, a l'interieur de poser(). Or la capsule
   .lg-capsule n'est pas positionnee par cette classe : elle est placee
   en mesurant le bouton actif, par mobile-native-experience.js — qui
   repasse apres nous, et qui ne connait que le nom de fichier servi.

   calendrier.html sert app.html. Le moteur en deduit « Accueil », et
   remet la capsule a gauche. Poser une classe une fois contre un moteur
   qui recalcule en boucle ne pouvait pas tenir.

   ── LA CORRECTION ────────────────────────────────────────────────
   Un module dedie, charge uniquement en vue calendrier, qui fait trois
   choses que le lot 8 ne faisait pas :

   1. Il POSITIONNE la capsule lui-meme, en mesurant le bouton
      Calendrier — left et width, avec transform neutralise. Il ne
      suppose pas la mecanique du moteur : il impose le resultat.

   2. Il surveille la barre. Un MutationObserver sur les attributs
      class et style : des que le moteur touche a la capsule ou aux
      onglets, le module remet la capsule en place. Pas de sondage a
      intervalle fixe qui tournerait pour rien.

   3. Il rend l'onglet « Aujourd'hui » a son etat inactif : couleur,
      graisse, classes. Sinon deux onglets paraissent allumes.

   ── CE QUE JE NE FAIS PAS ────────────────────────────────────────
   Je ne modifie pas mobile-native-experience.js. Le moteur est
   partage par toutes les pages ; lui apprendre que calendrier.html
   signifie « onglet Calendrier » serait plus propre, mais c'est un
   fichier que je n'ai pas lu, sur un chemin ou toutes les pages
   passent. Une surcouche qui se limite a une seule adresse ne peut
   rien casser ailleurs.

   Si vous preferez la correction a la source, dites-le : je lis le
   moteur d'abord, et je remplace cette surcouche par trois lignes
   dedans.

   Usage :
     node outils/refonte-10-capsule-calendrier.js --essai
     node outils/refonte-10-capsule-calendrier.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(process.cwd(), 'public');
const JS = path.join(PUBLIC, 'js');
const MODULE = path.join(JS, 'bh-capsule-calendrier.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const PAGES = ['app.html', 'calendrier.html', 'messages.html', 'reservations.html', 'settings.html', 'deposits.html', 'factures.html', 'cleaning.html'];

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(JS)) echec('public/js introuvable.');
if (!fs.existsSync(path.join(JS, 'bh-barre-onglets.js'))) echec('bh-barre-onglets.js absent.');

const SOURCE = `/* ============================================================
   bh-capsule-calendrier.js — la capsule suit l'onglet Calendrier
   ============================================================
   Uniquement en vue calendrier. calendrier.html sert app.html, donc le
   moteur d'origine en deduit « Accueil » et remet la capsule a gauche.

   Ce module ne discute pas avec lui : il mesure le bouton Calendrier,
   place la capsule dessus, et remet en place des que le moteur y touche.
   ============================================================ */
(function () {
  'use strict';

  var enVue = (location.search || '').indexOf('vue=calendrier') !== -1
    || (location.pathname || '').split('/').pop().toLowerCase() === 'calendrier.html';
  if (!enVue) return;
  if (window.__bhCapsuleCalendrier) return;
  window.__bhCapsuleCalendrier = true;

  var VERT = '#0E3B2E';
  var GRIS = '#9A958A';
  var diag = { poses: 0, capsule_trouvee: false, cible_trouvee: false, observe: false };

  function barre() {
    return document.querySelector('.mobile-tabs, [class*="tabbar"], [class*="tab-bar"], .mobile-nav, #mobileNav');
  }

  function cible() {
    var b = barre();
    if (!b) return null;
    var parId = b.querySelector('[data-bh-onglet="calendrier"]');
    if (parId) return parId;
    /* Repli : le libelle. La barre a pu etre reconstruite sans nos
       marqueurs. */
    var btns = b.querySelectorAll('.tab-btn, button, a');
    for (var i = 0; i < btns.length; i++) {
      var t = (btns[i].textContent || '').toLowerCase();
      if (t.indexOf('calendrier') !== -1) return btns[i];
    }
    return null;
  }

  function capsule() {
    var b = barre();
    if (!b) return null;
    return b.querySelector('.lg-capsule, [class*="capsule"], [class*="indicator"]');
  }

  /* Le geste : mesurer, puis imposer. On ne suppose pas si le moteur
     travaille en left ou en transform — on neutralise le transform et on
     ecrit left, ce qui couvre les deux. */
  function placer() {
    var c = cible();
    var cap = capsule();
    diag.cible_trouvee = !!c;
    diag.capsule_trouvee = !!cap;
    if (!c) return false;

    /* Les couleurs, dans les deux sens : sinon deux onglets paraissent
       allumes. */
    var onglets = document.querySelectorAll('[data-bh-onglet], .tab-btn');
    for (var i = 0; i < onglets.length; i++) {
      var o = onglets[i];
      var actif = o === c;
      if (actif) { o.classList.add('active'); o.classList.add('lg-active'); }
      else { o.classList.remove('active'); o.classList.remove('lg-active'); }
      o.style.setProperty('color', actif ? VERT : GRIS, 'important');
      var feuilles = o.querySelectorAll('span, div, small, label');
      for (var j = 0; j < feuilles.length; j++) {
        var f = feuilles[j];
        if (f.getAttribute('data-bh-icone') !== null) continue;
        if (f.children.length) continue;
        var txt = (f.textContent || '').trim();
        if (!txt || /^\\d+$/.test(txt)) continue;
        f.style.setProperty('color', actif ? VERT : GRIS, 'important');
        f.style.setProperty('font-weight', actif ? '700' : '500', 'important');
      }
    }

    if (!cap) return true; /* pas de capsule dans ce theme : les couleurs suffisent */

    var gauche = c.offsetLeft;
    var large = c.offsetWidth;
    if (!large) return true;

    cap.style.setProperty('transform', 'none', 'important');
    cap.style.setProperty('left', gauche + 'px', 'important');
    cap.style.setProperty('width', large + 'px', 'important');
    cap.style.setProperty('opacity', '1', 'important');
    /* Certaines implementations masquent la capsule tant qu'aucun onglet
       n'est reconnu comme actif. */
    cap.classList.add('lg-visible');
    diag.poses++;
    return true;
  }

  /* La surveillance : le moteur recalcule en boucle. Plutot que sonder a
     intervalle fixe, on repond a ses gestes. */
  function surveiller() {
    var b = barre();
    if (!b || diag.observe) return;
    try {
      var obs = new MutationObserver(function () {
        /* Une seule replacement par salve, pour ne pas se declencher
           soi-meme en boucle. */
        if (surveiller.enCours) return;
        surveiller.enCours = true;
        requestAnimationFrame(function () {
          surveiller.enCours = false;
          placer();
        });
      });
      obs.observe(b, { attributes: true, subtree: true, attributeFilter: ['class', 'style'] });
      diag.observe = true;
    } catch (e) {}
  }

  window.bhVerifCapsule = function () {
    var c = cible();
    var cap = capsule();
    var res = {
      en_vue_calendrier: enVue,
      cible_trouvee: !!c,
      libelle_cible: c ? (c.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 20) : null,
      capsule_trouvee: !!cap,
      capsule_left: cap ? cap.style.left : null,
      cible_offsetLeft: c ? c.offsetLeft + 'px' : null,
      alignee: !!(c && cap && cap.style.left === c.offsetLeft + 'px'),
      placements: diag.poses,
      surveillance_active: diag.observe
    };
    console.log('── Capsule calendrier ──');
    console.log(res);
    if (!res.cible_trouvee) console.warn('Onglet Calendrier introuvable dans la barre.');
    if (res.cible_trouvee && !res.capsule_trouvee) console.warn('Pas de capsule : seules les couleurs sont posees.');
    return res;
  };

  function demarrer() {
    placer();
    surveiller();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(demarrer, 700); });
  } else {
    setTimeout(demarrer, 700);
  }
  /* La barre est parfois construite tard, et les cartes deplacees
     changent la hauteur donc la position. */
  [1500, 2600, 4000, 6000, 9000].forEach(function (t) { setTimeout(demarrer, t); });
  window.addEventListener('resize', function () { setTimeout(placer, 60); });
})();
`;

const BALISE = '<script src="js/bh-capsule-calendrier.js"></script>';
const rapport = [];
const ecrire = [];

PAGES.forEach(function (nom) {
  const p = path.join(PUBLIC, nom);
  if (!fs.existsSync(p)) { rapport.push([nom, 'absente']); return; }

  let html = fs.readFileSync(p, 'utf8');
  if (html.indexOf('bh-capsule-calendrier.js') !== -1) { rapport.push([nom, 'deja']); return; }

  /* Toujours apres bh-barre-style.js : la capsule doit etre placee une
     fois les icones et la forme en ilot posees, sinon les mesures
     changent juste apres. */
  const ordre = ['bh-barre-style.js', 'bh-barre-onglets.js'];
  let ancre = -1, quoi = null;
  for (let i = 0; i < ordre.length && ancre === -1; i++) {
    const k = html.indexOf(ordre[i]);
    if (k !== -1) { ancre = k; quoi = ordre[i]; }
  }
  if (ancre === -1) { rapport.push([nom, 'sans barre — ignoree']); return; }

  const fin = html.indexOf('</script>', ancre);
  if (fin === -1) { rapport.push([nom, 'balise mal formee — ignoree']); return; }

  const pos = fin + '</script>'.length;
  html = html.slice(0, pos) + '\n' + BALISE + html.slice(pos);
  ecrire.push([p, html]);
  rapport.push([nom, 'apres ' + quoi]);
});

const posees = rapport.filter(function (r) { return r[1].indexOf('apres') === 0; }).length;
if (posees === 0) {
  const tout = rapport.every(function (r) { return r[1] === 'deja' || r[1] === 'absente'; });
  if (tout) { console.log('\n  Deja applique — rien a faire.\n'); process.exit(0); }
  echec("Aucune page n'a recu le module.");
}

try { new Function(SOURCE); }
catch (e) { echec('Le module ne serait pas du JavaScript valide — ' + e.message); }

if (!ESSAI) {
  fs.writeFileSync(MODULE, SOURCE, 'utf8');
  ecrire.forEach(function (p) { fs.writeFileSync(p[0], p[1], 'utf8'); });
  const relu = fs.readFileSync(MODULE, 'utf8');
  if (relu.indexOf('bhVerifCapsule') === -1) echec("Le module n'est pas complet apres ecriture.");
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  public/js/bh-capsule-calendrier.js  (' + Math.round(SOURCE.length / 1024) + ' Ko)');
rapport.forEach(function (r) { console.log('  ' + (r[0] + '                    ').slice(0, 20) + r[1]); });
console.log('\n  Le module mesure le bouton Calendrier et impose la position de');
console.log('  la capsule — il ne suppose pas si le moteur travaille en left');
console.log('  ou en transform : il neutralise le transform et ecrit left.');
console.log('  Un MutationObserver la remet en place des que le moteur y');
console.log('  touche. Pas de sondage a intervalle fixe.');
console.log('  Les couleurs sont posees dans les deux sens : « Aujourd\'hui »');
console.log('  redevient gris, sinon deux onglets paraissent allumes.');
console.log('\n  A verifier sur telephone, cache vide : /calendrier.html');
console.log('  1. La capsule est sous « Calendrier », en vert.');
console.log('  2. « Aujourd\'hui » est gris, non souligne.');
console.log('  3. Attendez 10 secondes : elle ne doit pas repartir a gauche.');
console.log('  4. bhVerifCapsule()  — alignee: true.');
console.log('     « placements » dit combien de fois elle a du etre remise :');
console.log('     un nombre qui monte doucement est normal, c\'est le moteur');
console.log('     qui recalcule et l\'observateur qui repond.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
