/* ============================================================
   bh-vue-calendrier.js — app.html?vue=calendrier
   ============================================================
   Le calendrier ne peut pas quitter app.html : 224 Ko de code l'y
   retiennent, tisses avec les modales, le reordonnancement et les
   restrictions de la page. Alors c'est l'onglet qui vient a lui.

   En vue calendrier, tout est masque sauf <section id="calendarSection">.
   Rien n'est deplace, rien n'est duplique : le moteur tourne chez lui,
   et une seule section reste visible.
   ============================================================ */
(function () {
  'use strict';

  if (window.__bhVueCalendrier) return;
  if ((location.search || '').indexOf('vue=calendrier') === -1) return;
  window.__bhVueCalendrier = true;

  var mem = [];
  var diag = { section: false, masques: 0, raison: '', voisins: [] };

  function memoriser(el, prop, valeur) {
    mem.push({ el: el, prop: prop, valeur: el.style.getPropertyValue(prop), priorite: el.style.getPropertyPriority(prop) });
    el.style.setProperty(prop, valeur, 'important');
  }

  /* Ce qui doit rester visible quoi qu'il arrive : la barre du bas, et
     les modales du calendrier lui-meme. */
  function intouchable(el) {
    if (!el || el.nodeType !== 1) return true;
    if (el.id === 'calendarSection') return true;
    var c = ' ' + (el.className && el.className.baseVal !== undefined ? el.className.baseVal : (el.className || '')) + ' ';
    if (/tabbar|tab-bar|mobile-tabs|mobile-nav|sidebar-overlay|modal/i.test(c)) return true;
    if (/modal/i.test(el.id || '')) return true;
    if (el.querySelector && el.querySelector('#calendarSection')) return true;
    return false;
  }

  function appliquer() {
    var section = document.getElementById('calendarSection');
    if (!section) { diag.raison = 'section calendrier pas encore rendue'; return false; }
    diag.section = true;

    /* On remonte de la section jusqu'au corps, et a chaque niveau on
       masque ses freres. La section reste donc dans sa chaine de
       parents — sa mise en page n'est pas touchee. */
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

    /* La section prend la place laissee libre. */
    memoriser(section, 'margin', '0');
    var pere = section.parentElement;
    if (pere) memoriser(pere, 'padding-top', '8px');

    return true;
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
    var res = {
      vue_active: true,
      section_trouvee: diag.section,
      section_visible: !!(s && getComputedStyle(s).display !== 'none'),
      voisins_masques: diag.masques,
      exemples: diag.voisins.slice(0, 12),
      barre_onglets_visible: !!document.querySelector('.mobile-tabs, [class*="tabbar"], [class*="tab-bar"]'),
      annulable: mem.length + ' changement(s) memorise(s)',
      raison: diag.raison
    };
    console.log('── Vue calendrier ──');
    console.log(res);
    if (!res.section_visible) console.warn('Le calendrier n\'est pas visible : ' + (diag.raison || 'inconnu'));
    console.log('Pour revenir a la page complete : bhAnnulerVueCalendrier()');
    return res;
  };

  function demarrer() { appliquer(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(demarrer, 400); });
  } else {
    setTimeout(demarrer, 400);
  }
  /* Le calendrier et ses voisins arrivent par vagues : on repasse. */
  [1200, 2400, 4000, 6500, 9000].forEach(function (t) { setTimeout(demarrer, t); });
})();
