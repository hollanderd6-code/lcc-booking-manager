#!/usr/bin/env node
/* ============================================================
   outils/refonte-14-moteur-calendrier.js
   Lot 14 : lancer le moteur, et ne masquer qu'apres
   ============================================================

   ── LE DEFAUT ────────────────────────────────────────────────────
   Sur /calendrier.html : l'adresse est bonne, la section est la, et la
   grille est vide. Aucun appel a /api/properties ni /api/reservations
   dans le journal — le moteur du calendrier n'a jamais demarre.

   Et mon module, lui, avait masque les onze voisins sans verifier que
   le calendrier etait rempli. D'ou la page blanche. C'est la faute la
   plus grave des deux : masquer d'abord, verifier ensuite.

   ── CE QUI DEMARRE LE MOTEUR ─────────────────────────────────────
   Les globales de la page les nomment :

       loadCalendarData      charge logements et reservations
       renderModernCalendar  dessine la grille
       initializeCalendar    les deux, si elle existe
       __bhCalendarRender    le rendu interne
       .view-tab[data-view=month]   le clic qui declenche tout

   Le module les essaie dans cet ordre, une par tour, et s'arrete des
   que la grille se remplit. Il note laquelle a marche :
   bhVerifVueCalendrier().moteur_lance_par.

   Je ne cherche pas POURQUOI le declencheur d'origine ne part pas sur
   cette adresse. Ce serait une enquete dans 224 Ko, pour un resultat
   identique.

   ── L'ORDRE INVERSE, ET UN FILET ─────────────────────────────────
   Desormais : d'abord la grille se remplit, ensuite seulement les
   voisins sont masques. Une grille vide ne masque rien.

   Et si apres dix-huit secondes le calendrier n'est toujours pas la, le
   module se retracte tout seul, rend la page complete et l'ecrit dans
   la console. Une page blanche n'est jamais un resultat acceptable, et
   surtout pas un resultat silencieux.

   ── REMPLACE LE MODULE DU LOT 12 ─────────────────────────────────
   Meme fichier, meme balise, rien a changer dans app.html.

   Usage :
     node outils/refonte-14-moteur-calendrier.js --essai
     node outils/refonte-14-moteur-calendrier.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(process.cwd(), 'public');
const MODULE = path.join(PUBLIC, 'js', 'bh-vue-calendrier.js');
const APP = path.join(PUBLIC, 'app.html');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(APP)) echec('public/app.html introuvable. Lancez depuis la racine du projet.');
if (!fs.existsSync(MODULE)) echec('bh-vue-calendrier.js absent. Lancez d\'abord le lot 12.');
if (fs.readFileSync(APP, 'utf8').indexOf('bh-vue-calendrier.js') === -1) {
  echec('La balise du module est absente de app.html. Lancez d\'abord le lot 12.');
}

const SOURCE = `/* ============================================================
   bh-vue-calendrier.js — /calendrier.html
   ============================================================
   Le calendrier ne peut pas quitter app.html : 224 Ko de moteur l'y
   retiennent. /calendrier.html sert donc le meme fichier, et ce module
   n'affiche que <section id="calendarSection">.

   Deux regles apprises a la dure :

   1. Le moteur ne demarre pas tout seul sur cette adresse. On l'appelle.
   2. On ne masque rien tant que la grille est vide. Une page blanche
      n'est pas un resultat.
   ============================================================ */
(function () {
  'use strict';

  if (window.__bhVueCalendrier) return;

  function vueDemandee() {
    var page = (location.pathname || '').split('/').pop().toLowerCase();
    if (page === 'calendrier.html') return true;
    return (location.search || '').indexOf('vue=calendrier') !== -1;
  }
  if (!vueDemandee()) return;
  window.__bhVueCalendrier = true;

  var mem = [];
  var diag = {
    section: false, masques: 0, voisins: [], moteur_lance_par: null,
    tentatives: [], retracte: false, raison: ''
  };

  function memoriser(el, prop, valeur) {
    mem.push({ el: el, prop: prop, valeur: el.style.getPropertyValue(prop), priorite: el.style.getPropertyPriority(prop) });
    el.style.setProperty(prop, valeur, 'important');
  }

  function grille() { return document.getElementById('calendarGrid'); }
  function remplie() { var g = grille(); return !!(g && g.childElementCount > 0); }

  /* ── Le moteur ──────────────────────────────────────────────
     Les noms viennent des globales de la page, pas d'une supposition.
     Une par tour : si la premiere suffit, les suivantes ne sont jamais
     appelees. */
  var MOTEURS = [
    ['loadCalendarData', function () { window.loadCalendarData(); }],
    ['initializeCalendar', function () { window.initializeCalendar(); }],
    ['renderModernCalendar', function () { window.renderModernCalendar(); }],
    ['__bhCalendarRender', function () { window.__bhCalendarRender(); }],
    ['__bhCalSwitchView', function () { window.__bhCalSwitchView('month'); }],
    ['clic sur l onglet Mois', function () {
      var t = document.querySelector('.view-tab[data-view="month"]') || document.querySelector('.view-tab');
      if (!t) throw new Error('aucun onglet de vue');
      t.click();
    }]
  ];
  var prochain = 0;

  function lancerMoteur() {
    if (remplie()) return true;
    while (prochain < MOTEURS.length) {
      var m = MOTEURS[prochain++];
      var nom = m[0];
      if (nom.indexOf('clic') === -1 && typeof window[nom] !== 'function') {
        diag.tentatives.push(nom + ' : absente');
        continue;
      }
      try {
        m[1]();
        diag.tentatives.push(nom + ' : appelee');
        return false; /* on laisse le temps a la grille de se remplir */
      } catch (e) {
        diag.tentatives.push(nom + ' : erreur — ' + e.message);
      }
    }
    return false;
  }

  /* ── Le masquage, seulement une fois la grille remplie ────── */

  function intouchable(el) {
    if (!el || el.nodeType !== 1) return true;
    if (el.id === 'calendarSection') return true;
    var c = ' ' + (el.className && el.className.baseVal !== undefined ? el.className.baseVal : (el.className || '')) + ' ';
    if (/tabbar|tab-bar|mobile-tabs|mobile-nav|sidebar-overlay|modal/i.test(c)) return true;
    if (/modal/i.test(el.id || '')) return true;
    if (el.querySelector && el.querySelector('#calendarSection')) return true;
    return false;
  }

  function masquer() {
    var section = document.getElementById('calendarSection');
    if (!section) { diag.raison = 'section pas encore rendue'; return false; }
    diag.section = true;
    if (!remplie()) { diag.raison = 'grille vide — rien masque'; return false; }

    var courant = section;
    var garde = 0;
    while (courant && courant.parentElement && courant !== document.body && garde++ < 12) {
      var parent = courant.parentElement;
      for (var i = 0; i < parent.children.length; i++) {
        var frere = parent.children[i];
        if (frere === courant || intouchable(frere)) continue;
        if (frere.dataset && frere.dataset.bhVueMasque) continue;
        if (getComputedStyle(frere).display === 'none') continue;
        memoriser(frere, 'display', 'none');
        if (frere.dataset) frere.dataset.bhVueMasque = '1';
        diag.masques++;
        diag.voisins.push((frere.id ? '#' + frere.id : frere.tagName.toLowerCase())
          + (frere.className && typeof frere.className === 'string' ? '.' + frere.className.split(/\\s+/)[0] : ''));
      }
      courant = parent;
    }

    memoriser(section, 'margin', '0');
    if (section.parentElement) memoriser(section.parentElement, 'padding-top', '8px');
    diag.raison = '';
    return true;
  }

  function tour() {
    if (diag.retracte) return;
    if (!remplie()) { lancerMoteur(); return; }
    if (!diag.masques) masquer();
  }

  /* ── Le filet ───────────────────────────────────────────────
     Dix-huit secondes sans calendrier : on rend la page et on le dit. */
  function filet() {
    if (remplie() || diag.retracte) return;
    diag.retracte = true;
    diag.raison = 'calendrier absent apres 18 s — page rendue';
    if (mem.length) window.bhAnnulerVueCalendrier();
    console.warn('[vue calendrier] Le calendrier ne s est pas rempli. '
      + 'La page complete est rendue plutot que de vous laisser devant du blanc.');
    console.warn('[vue calendrier] Tentatives : ' + diag.tentatives.join(' | '));
  }

  window.bhAnnulerVueCalendrier = function () {
    for (var i = mem.length - 1; i >= 0; i--) {
      var m = mem[i];
      if (m.valeur) m.el.style.setProperty(m.prop, m.valeur, m.priorite);
      else m.el.style.removeProperty(m.prop);
      if (m.el.dataset) delete m.el.dataset.bhVueMasque;
    }
    var n = mem.length;
    mem = [];
    diag.masques = 0;
    diag.voisins = [];
    console.log(n + ' changement(s) annule(s). La page complete est revenue.');
    return n;
  };

  window.bhVerifVueCalendrier = function () {
    var s = document.getElementById('calendarSection');
    var g = grille();
    var res = {
      adresse: location.pathname,
      section_trouvee: !!s,
      section_visible: !!(s && getComputedStyle(s).display !== 'none'),
      grille_remplie: g ? g.childElementCount : 0,
      moteur_lance_par: diag.moteur_lance_par,
      tentatives: diag.tentatives,
      voisins_masques: diag.masques,
      exemples: diag.voisins.slice(0, 12),
      retracte: diag.retracte,
      annulable: mem.length + ' changement(s) memorise(s)',
      raison: diag.raison
    };
    console.log('── Vue calendrier ──');
    console.log(res);
    if (!res.grille_remplie) console.warn('Grille vide : ' + (diag.raison || 'moteur non demarre'));
    console.log('Pour revenir a la page complete : bhAnnulerVueCalendrier()');
    return res;
  };

  /* Des que la grille se remplit, on note ce qui l'a remplie. */
  var surveille = setInterval(function () {
    if (remplie() && !diag.moteur_lance_par) {
      diag.moteur_lance_par = diag.tentatives.length
        ? diag.tentatives[diag.tentatives.length - 1]
        : 'la page, seule';
      tour();
      clearInterval(surveille);
    }
  }, 400);
  setTimeout(function () { clearInterval(surveille); }, 20000);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(tour, 500); });
  } else {
    setTimeout(tour, 500);
  }
  [1200, 2200, 3500, 5000, 7000, 9500, 12000, 15000].forEach(function (t) { setTimeout(tour, t); });
  setTimeout(filet, 18000);
})();
`;

try { new Function(SOURCE); } catch (e) { echec('Le module ne serait pas valide — ' + e.message); }
['bhAnnulerVueCalendrier', 'bhVerifVueCalendrier', 'function filet(', 'loadCalendarData'].forEach(function (t) {
  if (SOURCE.indexOf(t) === -1) echec('Verification : ' + t + ' absent du module.');
});

if (!ESSAI) {
  fs.writeFileSync(MODULE, SOURCE, 'utf8');
  const relu = fs.readFileSync(MODULE, 'utf8');
  if (relu.indexOf('function filet(') === -1) echec("Le module n'est pas complet apres ecriture.");
  try { new Function(relu); } catch (e) { echec('Module invalide apres ecriture — ' + e.message); }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  public/js/bh-vue-calendrier.js  remplace (' + Math.round(SOURCE.length / 1024) + ' Ko)');
console.log('  app.html                        inchange, la balise est deja la');
console.log('\n  1. Le moteur est appele : loadCalendarData, puis');
console.log('     initializeCalendar, renderModernCalendar, __bhCalendarRender,');
console.log('     __bhCalSwitchView, et en dernier le clic sur l\'onglet Mois.');
console.log('     Une par tour, jusqu\'a ce que la grille se remplisse.');
console.log('\n  2. Rien n\'est masque tant que la grille est vide. C\'etait');
console.log('     l\'inverse, et c\'est ce qui a produit la page blanche.');
console.log('\n  3. Filet : apres 18 s sans calendrier, le module se retracte,');
console.log('     rend la page complete et l\'ecrit dans la console.');
console.log('\n  A verifier, cache vide, sur /calendrier.html :');
console.log('    bhVerifVueCalendrier()');
console.log('  J\'attends grille_remplie > 0 et moteur_lance_par renseigne.');
console.log('  Ce champ me dira laquelle des six voies a fonctionne.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
