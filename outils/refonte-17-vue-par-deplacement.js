#!/usr/bin/env node
/* ============================================================
   outils/refonte-17-vue-par-deplacement.js
   Lot 17 : deplacer un bloc plutot que d'en masquer trente
   ============================================================

   ── POURQUOI CHANGER DE METHODE ──────────────────────────────────
   Masquer les voisins un par un est fragile par construction. La page
   se construit par vagues : chaque vague ajoute des blocs, et il faut
   repasser. J'ai repasse, et la vague suivante a produit une page
   blanche. On peut courir longtemps derriere.

   Le lot 16 est un mauvais lot. Je le remplace au lieu de le rustiner.

   ── LA METHODE ───────────────────────────────────────────────────
   Un seul deplacement, un seul masquage :

       1. <section id="calendarSection"> est DEPLACEE dans un conteneur
          neuf, attache directement au corps de page.
       2. La barre d'onglets est deplacee de meme, pour survivre.
       3. Tout le reste du corps est masque en bloc.

   Ce qui arrive ensuite — la liste du jour, les cartes, les modales —
   nait a l'interieur de ce qui est deja masque. Il n'y a plus de
   retardataire possible. Le probleme n'est pas mieux traite : il ne se
   pose plus.

   Le conteneur herite de la CLASSE du parent d'origine, pour que la
   section garde la mise en page que son CSS attend.

   ── DEPLACEE, PAS COPIEE ─────────────────────────────────────────
   insertBefore et appendChild deplacent le noeud. Aucun clone, donc
   aucun ecouteur perdu, et le moteur du calendrier continue de dessiner
   dans le meme element sans savoir qu'il a change de parent.

   ── LE FILET, PLUS COURT ─────────────────────────────────────────
   Douze secondes. Si le calendrier n'est pas rempli, la page est
   rendue intacte et la console le dit. Rien n'est jamais masque avant
   que le calendrier ne soit la.

   ── ANNULATION ───────────────────────────────────────────────────
   bhAnnulerVueCalendrier() remet la section a sa place exacte, la barre
   a la sienne, et rend les blocs masques.

   Usage :
     node outils/refonte-17-vue-par-deplacement.js --essai
     node outils/refonte-17-vue-par-deplacement.js
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
if (fs.readFileSync(APP, 'utf8').indexOf('bh-vue-calendrier.js') === -1) {
  echec('La balise du module est absente de app.html. Lancez d\'abord le lot 12.');
}

const SOURCE = `/* ============================================================
   bh-vue-calendrier.js — /calendrier.html, par deplacement
   ============================================================
   Le calendrier ne peut pas quitter app.html : 224 Ko de moteur l'y
   retiennent. /calendrier.html sert donc le meme fichier.

   Methode : on DEPLACE <section id="calendarSection"> dans un conteneur
   neuf attache au corps, on deplace la barre d'onglets de meme, et on
   masque tout le reste en un seul geste.

   Masquer les voisins un par un obligeait a repasser a chaque vague de
   contenu. Ici ce qui arrive apres nait dans ce qui est deja masque.
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
  var etat = {
    pose: false, conteneur: null, origine: null, barre: null,
    masques: 0, moteur: [], lance_par: null, retracte: false, raison: ''
  };

  function memoriser(el, prop, valeur) {
    mem.push({ el: el, prop: prop, valeur: el.style.getPropertyValue(prop), priorite: el.style.getPropertyPriority(prop) });
    el.style.setProperty(prop, valeur, 'important');
  }

  /* ── Le calendrier est-il rempli ────────────────────────────
     #calendarGrid est un vestige, vide sur app.html aussi. Le rendu
     reel va dans #bhMonthOuter. Trois reponses possibles, une suffit. */
  function rempli() {
    var mo = document.getElementById('bhMonthOuter');
    if (mo && mo.childElementCount > 0) return 'bhMonthOuter';
    var g = document.getElementById('calendarGrid');
    if (g && g.childElementCount > 0) return 'calendarGrid';
    var s = document.getElementById('calendarSection');
    if (s && s.querySelectorAll('.calendar-cell, .calendar-row, .day-header').length > 10) return 'cellules';
    return null;
  }

  /* ── Le moteur, si la page ne le lance pas d'elle-meme ────── */
  var MOTEURS = [
    ['loadCalendarData', function () { window.loadCalendarData(); }],
    ['initializeCalendar', function () { window.initializeCalendar(); }],
    ['renderModernCalendar', function () { window.renderModernCalendar(); }],
    ['__bhCalendarRender', function () { window.__bhCalendarRender(); }],
    ['__bhCalSwitchView', function () { window.__bhCalSwitchView('month'); }],
    ['clic onglet Mois', function () {
      var t = document.querySelector('.view-tab[data-view="month"]') || document.querySelector('.view-tab');
      if (!t) throw new Error('aucun onglet de vue');
      t.click();
    }]
  ];
  var prochain = 0;

  function lancerMoteur() {
    while (prochain < MOTEURS.length) {
      var m = MOTEURS[prochain++];
      if (m[0].indexOf('clic') === -1 && typeof window[m[0]] !== 'function') {
        etat.moteur.push(m[0] + ' : absente');
        continue;
      }
      try { m[1](); etat.moteur.push(m[0] + ' : appelee'); return; }
      catch (e) { etat.moteur.push(m[0] + ' : erreur — ' + e.message); }
    }
  }

  function estBarre(el) {
    if (!el || el.nodeType !== 1) return false;
    var c = ' ' + (typeof el.className === 'string' ? el.className : '') + ' ';
    return /mobile-tabs|tabbar|tab-bar|mobile-nav/i.test(c) || el.id === 'mobileNav' || el.id === 'bhTabBar';
  }

  function garder(el) {
    if (!el || el.nodeType !== 1) return true;
    var t = el.tagName;
    if (t === 'SCRIPT' || t === 'STYLE' || t === 'LINK' || t === 'NOSCRIPT' || t === 'TEMPLATE') return true;
    if (el.id === 'bhVueRacine') return true;
    if (estBarre(el)) return true;
    return false;
  }

  /* ── Le geste, une seule fois ───────────────────────────────── */
  function poser() {
    if (etat.pose) return true;

    var section = document.getElementById('calendarSection');
    if (!section) { etat.raison = 'section calendrier absente'; return false; }

    var q = rempli();
    if (!q) { etat.raison = 'calendrier pas encore rempli'; return false; }
    etat.conteneur = q;

    /* La place exacte, pour pouvoir tout remettre. */
    etat.origine = { parent: section.parentElement, avant: section.nextSibling };

    var racine = document.createElement('div');
    racine.id = 'bhVueRacine';
    /* La classe du parent d'origine : la section garde la mise en page
       que son CSS attend. */
    if (section.parentElement && typeof section.parentElement.className === 'string') {
      racine.className = section.parentElement.className;
    }
    racine.style.cssText = 'padding:8px 0 104px;box-sizing:border-box;min-height:100vh';
    document.body.appendChild(racine);
    racine.appendChild(section);

    /* La barre d'onglets vit souvent dans le conteneur qu'on masque :
       on la sort avant, sinon elle disparait avec lui. */
    var barre = document.querySelector('.mobile-tabs, [class*="tabbar"], [class*="tab-bar"], .mobile-nav, #mobileNav');
    if (barre && barre.parentElement !== document.body) {
      etat.barre = { el: barre, parent: barre.parentElement, avant: barre.nextSibling };
      document.body.appendChild(barre);
    }

    /* Et le reste part en un seul geste. */
    var enfants = Array.prototype.slice.call(document.body.children);
    enfants.forEach(function (e) {
      if (garder(e)) return;
      if (getComputedStyle(e).display === 'none') return;
      memoriser(e, 'display', 'none');
      etat.masques++;
    });

    etat.pose = true;
    try { window.scrollTo(0, 0); } catch (e) {}
    return true;
  }

  function tour() {
    if (etat.pose || etat.retracte) return;
    if (!rempli()) { lancerMoteur(); return; }
    if (!etat.lance_par) {
      etat.lance_par = etat.moteur.length ? etat.moteur[etat.moteur.length - 1] : 'la page, seule';
    }
    poser();
  }

  /* Douze secondes. Une page blanche n'est pas un resultat, et une page
     blanche silencieuse encore moins. */
  function filet() {
    if (etat.pose || etat.retracte) return;
    etat.retracte = true;
    etat.raison = 'calendrier absent apres 12 s — page laissee intacte';
    console.warn('[vue calendrier] Le calendrier ne s est pas rempli en 12 s. '
      + 'La page est laissee intacte plutot que videe.');
    console.warn('[vue calendrier] Tentatives : ' + etat.moteur.join(' | '));
  }

  window.bhAnnulerVueCalendrier = function () {
    var section = document.getElementById('calendarSection');
    if (section && etat.origine && etat.origine.parent) {
      etat.origine.parent.insertBefore(section, etat.origine.avant);
    }
    if (etat.barre && etat.barre.parent) {
      etat.barre.parent.insertBefore(etat.barre.el, etat.barre.avant);
    }
    for (var i = mem.length - 1; i >= 0; i--) {
      var m = mem[i];
      if (m.valeur) m.el.style.setProperty(m.prop, m.valeur, m.priorite);
      else m.el.style.removeProperty(m.prop);
    }
    var racine = document.getElementById('bhVueRacine');
    if (racine) racine.remove();
    var n = mem.length;
    mem = [];
    etat.pose = false;
    etat.masques = 0;
    console.log('Vue calendrier annulee : section remise a sa place, '
      + n + ' bloc(s) rendu(s).');
    return n;
  };

  window.bhVerifVueCalendrier = function () {
    var s = document.getElementById('calendarSection');
    var mo = document.getElementById('bhMonthOuter');
    var res = {
      adresse: location.pathname,
      pose: etat.pose,
      conteneur_rempli: etat.conteneur,
      section_dans_la_vue: !!(s && s.parentElement && s.parentElement.id === 'bhVueRacine'),
      section_visible: !!(s && getComputedStyle(s).display !== 'none'),
      bhMonthOuter: mo ? mo.childElementCount : 0,
      blocs_masques: etat.masques,
      barre_sauvee: !!etat.barre,
      moteur_lance_par: etat.lance_par,
      tentatives: etat.moteur,
      retracte: etat.retracte,
      raison: etat.raison
    };
    console.log('── Vue calendrier ──');
    console.log(res);
    if (!res.pose) console.warn('Vue non posee : ' + (etat.raison || 'en attente'));
    console.log('Pour revenir a la page complete : bhAnnulerVueCalendrier()');
    return res;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(tour, 400); });
  } else {
    setTimeout(tour, 400);
  }
  [900, 1500, 2200, 3000, 4000, 5500, 7000, 9000, 11000].forEach(function (t) { setTimeout(tour, t); });
  setTimeout(filet, 12000);
})();
`;

try { new Function(SOURCE); } catch (e) { echec('Le module ne serait pas valide — ' + e.message); }
[
  ['le deplacement', "racine.appendChild(section)"],
  ['la barre sauvee', "etat.barre = {"],
  ['le masquage en bloc', 'enfants.forEach'],
  ['le filet', 'function filet('],
  ['l\'annulation', 'bhAnnulerVueCalendrier'],
  ['le bon conteneur', "getElementById('bhMonthOuter')"],
].forEach(function (c) {
  if (SOURCE.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent du module.');
});

if (!ESSAI) {
  fs.writeFileSync(MODULE, SOURCE, 'utf8');
  const relu = fs.readFileSync(MODULE, 'utf8');
  if (relu.indexOf('bhVueRacine') === -1) echec("Le module n'est pas complet apres ecriture.");
  try { new Function(relu); } catch (e) { echec('Module invalide apres ecriture — ' + e.message); }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  public/js/bh-vue-calendrier.js  reecrit (' + Math.round(SOURCE.length / 1024) + ' Ko)');
console.log('  app.html                        inchange');
console.log('\n  Nouvelle methode : la section calendrier est DEPLACEE dans un');
console.log('  conteneur neuf attache au corps, la barre d\'onglets aussi, et');
console.log('  tout le reste est masque en un seul geste.');
console.log('\n  Ce qui arrive apres — liste du jour, cartes, modales — nait a');
console.log('  l\'interieur de ce qui est deja masque. Plus de retardataires,');
console.log('  donc plus de repassage, donc plus de page blanche a la vague');
console.log('  suivante. Le lot 16 courait derriere le probleme ; celui-ci le');
console.log('  supprime.');
console.log('\n  Filet ramene a 12 s : si le calendrier n\'est pas rempli, RIEN');
console.log('  n\'est masque et la page reste entiere.');
console.log('\n  A verifier, cache vide, sur /calendrier.html :');
console.log('    bhVerifVueCalendrier()');
console.log('  J\'attends pose: true, section_dans_la_vue: true, et la barre');
console.log('  d\'onglets toujours en bas.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
