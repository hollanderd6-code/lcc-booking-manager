/* ============================================================
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
    section: false, masques: 0, voisins: [], moteur_lance_par: null, conteneur: null,
    tentatives: [], retracte: false, raison: ''
  };

  function memoriser(el, prop, valeur) {
    mem.push({ el: el, prop: prop, valeur: el.style.getPropertyValue(prop), priorite: el.style.getPropertyPriority(prop) });
    el.style.setProperty(prop, valeur, 'important');
  }

  /* #calendarGrid est un vestige : il est vide sur app.html aussi,
     alors que le calendrier s'y affiche. Le rendu reel va dans
     #bhMonthOuter. On accepte les trois reponses possibles plutot que
     de parier sur un seul conteneur. */
  function conteneurRempli() {
    var mo = document.getElementById('bhMonthOuter');
    if (mo && mo.childElementCount > 0) return 'bhMonthOuter';
    var g = document.getElementById('calendarGrid');
    if (g && g.childElementCount > 0) return 'calendarGrid';
    var s = document.getElementById('calendarSection');
    if (s && s.querySelectorAll('.calendar-cell, .calendar-row, .day-header').length > 10) return 'cellules';
    return null;
  }
  function grille() { return document.getElementById('bhMonthOuter') || document.getElementById('calendarGrid'); }
  function remplie() {
    var q = conteneurRempli();
    if (q) diag.conteneur = q;
    return !!q;
  }

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
          + (frere.className && typeof frere.className === 'string' ? '.' + frere.className.split(/\s+/)[0] : ''));
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
      conteneur_rempli: diag.conteneur || null,
      grille_remplie: g ? g.childElementCount : 0,
      bhMonthOuter: (document.getElementById('bhMonthOuter') || {}).childElementCount || 0,
      calendarGrid: (document.getElementById('calendarGrid') || {}).childElementCount || 0,
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
    if (!res.conteneur_rempli) {
      console.warn('Aucun conteneur rempli : ' + (diag.raison || 'moteur non demarre'));
      console.warn('bhMonthOuter ' + res.bhMonthOuter + ' · calendarGrid ' + res.calendarGrid);
    }
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
