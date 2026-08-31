/* ============================================================
   bh-barre-style.js — les icones de la maquette, la barre en ilot
   ============================================================
   Ne touche pas au role menage : si bh-barre-onglets.js n'a rien
   renomme (compte menage), ce module ne restyle rien non plus.
   ============================================================ */
(function () {
  'use strict';

  if (window.__bhBarreStyle) return;
  window.__bhBarreStyle = true;

  var VERT = '#0E3B2E';
  var GRIS = '#9A958A';

  /* ── Les cinq dessins, au trait, un seul chemin quand c'est possible ── */
  function svg(corps) {
    return '<svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true"'
      + ' stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">'
      + corps + '</svg>';
  }

  var DESSINS = {
    accueil:    svg('<path d="M3.2 10.4 12 3.6l8.8 6.8V20a.9.9 0 0 1-.9.9h-4.4v-6.2H9.5v6.2H5.1a.9.9 0 0 1-.9-.9z"/>'),
    calendrier: svg('<rect x="3.4" y="5.2" width="17.2" height="15.4" rx="2.4"/><path d="M3.4 10.1h17.2M8.2 3.4v3.4M15.8 3.4v3.4"/>'
                  + '<circle cx="8.1" cy="13.7" r=".9" fill="currentColor" stroke="none"/>'
                  + '<circle cx="12" cy="13.7" r=".9" fill="currentColor" stroke="none"/>'
                  + '<circle cx="15.9" cy="13.7" r=".9" fill="currentColor" stroke="none"/>'
                  + '<circle cx="8.1" cy="17.2" r=".9" fill="currentColor" stroke="none"/>'
                  + '<circle cx="12" cy="17.2" r=".9" fill="currentColor" stroke="none"/>'),
    messages:   svg('<path d="M4 5.6h16a1 1 0 0 1 1 1v8.6a1 1 0 0 1-1 1h-9.1L6.4 20v-3.8H4a1 1 0 0 1-1-1V6.6a1 1 0 0 1 1-1z"/>'),
    logements:  svg('<path d="M4.4 20.6V4.9a.9.9 0 0 1 .9-.9h8.1a.9.9 0 0 1 .9.9v15.7M14.3 20.6V9.9h4.4a.9.9 0 0 1 .9.9v9.8M2.6 20.6h18.8"/>'
                  + '<path d="M7.3 8h1.2M10.6 8h1.2M7.3 11.4h1.2M10.6 11.4h1.2M7.3 14.8h1.2M10.6 14.8h1.2M16.6 13.6h1.1M16.6 17h1.1"/>'),
    argent:     svg('<rect x="3" y="6" width="18" height="12.4" rx="2.6"/><path d="M3 10.2h11.4a2 2 0 0 1 0 4H3"/>'
                  + '<circle cx="17.4" cy="12.2" r="1.15" fill="currentColor" stroke="none"/>')
  };

  function poserIcones() {
    var onglets = document.querySelectorAll('[data-bh-onglet]');
    if (!onglets.length) return 0;
    var n = 0;

    for (var i = 0; i < onglets.length; i++) {
      var el = onglets[i];
      var cle = el.getAttribute('data-bh-onglet');
      var dessin = DESSINS[cle];
      if (!dessin || el.dataset.bhIcone) continue;

      /* On remplace le porteur d'icone existant : un <svg>, un <i>, une
         <img>, ou le premier enfant s'il ne contient pas de texte. */
      var ancien = el.querySelector('svg, i, img, .tab-icon, [class*="icon"]');
      if (!ancien) {
        for (var j = 0; j < el.children.length; j++) {
          var c = el.children[j];
          if (!(c.textContent || '').trim()) { ancien = c; break; }
        }
      }
      if (!ancien) continue;

      var boite = document.createElement('span');
      boite.setAttribute('data-bh-icone', cle);
      boite.style.cssText = 'display:inline-flex;align-items:center;justify-content:center'
        + ';width:23px;height:23px;line-height:0;color:inherit';
      boite.innerHTML = dessin;

      /* Le badge de non-lus vit parfois DANS l'ancienne icone : on le garde. */
      var badge = ancien.querySelector ? ancien.querySelector('.badge, .notif-count, sup, [data-count]') : null;
      ancien.replaceWith(boite);
      if (badge) boite.appendChild(badge);

      el.dataset.bhIcone = '1';
      n++;
    }
    return n;
  }

  /* ── La barre en ilot ───────────────────────────────────────── */
  function poserIlot() {
    var barre = document.querySelector('.mobile-tabs');
    if (!barre || barre.dataset.bhIlot) return false;

    barre.style.setProperty('left', '12px', 'important');
    barre.style.setProperty('right', '12px', 'important');
    barre.style.setProperty('width', 'auto', 'important');
    barre.style.setProperty('bottom', 'calc(env(safe-area-inset-bottom, 0px) + 10px)', 'important');
    barre.style.setProperty('border-radius', '26px', 'important');
    barre.style.setProperty('background', 'rgba(255,255,255,.94)', 'important');
    barre.style.setProperty('backdrop-filter', 'blur(14px)', 'important');
    barre.style.setProperty('-webkit-backdrop-filter', 'blur(14px)', 'important');
    barre.style.setProperty('border', '1px solid #DFE6E1', 'important');
    barre.style.setProperty('border-top', '1px solid #DFE6E1', 'important');
    barre.style.setProperty('box-shadow', '0 6px 24px rgba(13,17,23,.10)', 'important');
    barre.style.setProperty('padding', '9px 4px', 'important');
    barre.style.setProperty('overflow', 'hidden', 'important');

    /* Un ilot ne colle pas au bas : le contenu doit pouvoir defiler dessous. */
    try {
      var h = barre.getBoundingClientRect().height || 62;
      document.body.style.setProperty('padding-bottom', 'calc(' + Math.round(h + 22) + 'px + env(safe-area-inset-bottom, 0px))');
    } catch (e) {}

    barre.dataset.bhIlot = '1';

    /* La capsule se place en mesurant le bouton actif. La barre a bouge :
       on la force a recalculer, sinon elle reste ou elle etait. */
    setTimeout(function () {
      try { window.dispatchEvent(new Event('resize')); } catch (e) {}
      var actif = barre.querySelector('.tab-btn.active, .tab-btn.lg-active');
      if (actif) { actif.classList.add('bh-relance'); actif.classList.remove('bh-relance'); }
    }, 60);

    return true;
  }

  /* ── Le « + » passe au-dessus de l'ilot ─────────────────────── */
  function remonterFab() {
    var fab = document.querySelector('#bhFab, .fab, .floating-action, [class*="fab"]:not(.mobile-tabs)');
    if (!fab || fab.dataset.bhRemonte) return false;
    try {
      var st = getComputedStyle(fab);
      if (st.position !== 'fixed' && st.position !== 'absolute') return false;
      fab.style.setProperty('bottom', 'calc(env(safe-area-inset-bottom, 0px) + 88px)', 'important');
      fab.dataset.bhRemonte = '1';
      return true;
    } catch (e) { return false; }
  }

  /* ── Les couleurs actif / inactif, sans feuille de style ────── */
  function teinter() {
    var onglets = document.querySelectorAll('[data-bh-onglet]');
    for (var i = 0; i < onglets.length; i++) {
      var el = onglets[i];
      var actif = /\bactive\b|\blg-active\b/.test(el.className || '');
      el.style.setProperty('color', actif ? VERT : GRIS, 'important');
      var t = el.querySelectorAll('span, div, small, label');
      for (var j = 0; j < t.length; j++) {
        if (t[j].getAttribute('data-bh-icone') !== null) continue;
        if (t[j].children.length) continue;
        var txt = (t[j].textContent || '').trim();
        if (!txt || /^\d+$/.test(txt)) continue;
        t[j].style.setProperty('color', actif ? VERT : GRIS, 'important');
        t[j].style.setProperty('font-weight', actif ? '700' : '500', 'important');
      }
    }
  }

  window.bhVerifStyle = function () {
    var res = {
      icones_posees: document.querySelectorAll('[data-bh-icone]').length,
      ilot: !!document.querySelector('.mobile-tabs[data-bh-ilot]'),
      fab_remonte: !!document.querySelector('[data-bh-remonte]'),
      onglets_trouves: document.querySelectorAll('[data-bh-onglet]').length
    };
    console.log('── Style de la barre ──');
    console.log(res);
    if (!res.onglets_trouves) console.warn('Aucun onglet marque : bh-barre-onglets.js n\'a rien applique (compte menage ?).');
    if (res.icones_posees < 5 && res.onglets_trouves) console.warn('Seulement ' + res.icones_posees + ' icone(s) posee(s) sur ' + res.onglets_trouves + '.');
    return res;
  };

  function demarrer() {
    poserIcones();
    poserIlot();
    remonterFab();
    teinter();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(demarrer, 800); });
  } else {
    setTimeout(demarrer, 800);
  }
  setTimeout(demarrer, 2000);
  setTimeout(demarrer, 3800);
})();
