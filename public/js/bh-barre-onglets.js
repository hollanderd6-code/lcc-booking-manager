/* ============================================================
   bh-barre-onglets.js — la barre du bas de la maquette
   ============================================================
   Aujourd'hui · Messages · Calendrier · Logements · Argent

   Ne touche RIEN pour un compte de role menage : cleaning.html est sa
   seule page, l'onglet doit rester.

   Le module ne reconstruit pas la barre : il renomme, reordonne et
   repointe les onglets existants. La logique de la capsule active, du
   halo et des vibrations reste celle de mobile-native-experience.js.
   ============================================================ */
(function () {
  'use strict';

  if (window.__bhBarreOnglets) return;
  window.__bhBarreOnglets = true;

  /* ── La barre visee ─────────────────────────────────────────── */
  var VISEE = [
    { cle: 'accueil',     libelle: "Aujourd'hui", page: 'app.html' },
    { cle: 'messages',    libelle: 'Messages',    page: 'messages.html' },
    { cle: 'calendrier',  libelle: 'Calendrier',  page: 'reservations.html' },
    { cle: 'logements',   libelle: 'Logements',   page: 'settings.html' },
    { cle: 'argent',      libelle: 'Argent',      page: 'deposits.html' }
  ];

  /* ── Le role, lu avant toute modification ───────────────────── */
  function estRoleMenage() {
    /* 1. Un marqueur explicite dans la page. */
    if (document.body && (document.body.dataset.bhRole || '').toLowerCase().indexOf('menage') !== -1) return true;
    if (document.body && (document.body.dataset.bhRole || '').toLowerCase().indexOf('clean') !== -1) return true;

    /* 2. Le jeton. On lit la charge utile, publique par construction. */
    try {
      var t = localStorage.getItem('lcc_token') || localStorage.getItem('token') || '';
      var p = t.split('.')[1];
      if (p) {
        var o = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));
        var champs = [o.role, o.type, o.account_type, o.sub_role, o.permissions]
          .map(function (v) { return typeof v === 'string' ? v.toLowerCase() : ''; })
          .join(' ');
        if (champs.indexOf('clean') !== -1 || champs.indexOf('menage') !== -1) return true;
        if (o.type === 'sub_account' && champs.indexOf('clean') !== -1) return true;
      }
    } catch (e) {}

    /* 3. L'objet utilisateur stocke. */
    try {
      ['lcc_user', 'bh_user', 'user'].forEach(function (cle) {
        var brut = localStorage.getItem(cle);
        if (!brut) return;
        var o2 = JSON.parse(brut);
        var r = ((o2.role || '') + ' ' + (o2.type || '')).toLowerCase();
        if (r.indexOf('clean') !== -1 || r.indexOf('menage') !== -1) throw 'menage';
      });
    } catch (e) {
      if (e === 'menage') return true;
    }

    return false;
  }

  /* ── Les onglets presents, quel que soit leur habillage ─────── */
  function lireOnglets() {
    var barres = [];
    ['.bh-tabbar', '#bhTabBar', '[class*="tabbar"]', '[class*="tab-bar"]', '.mobile-nav', '#mobileNav', 'nav[class*="bottom"]']
      .forEach(function (sel) {
        try {
          var els = document.querySelectorAll(sel);
          for (var i = 0; i < els.length; i++) if (barres.indexOf(els[i]) === -1) barres.push(els[i]);
        } catch (e) {}
      });

    for (var b = 0; b < barres.length; b++) {
      var items = barres[b].querySelectorAll('a[href], button, [data-tab], [role="tab"]');
      if (items.length >= 4 && items.length <= 7) {
        return { barre: barres[b], items: Array.prototype.slice.call(items) };
      }
    }
    return null;
  }

  function texteDe(el) {
    var clone = el.cloneNode(true);
    var p = clone.querySelectorAll('.badge, .notif-count, sup, [data-count], svg, img, i');
    for (var i = 0; i < p.length; i++) p[i].remove();
    return (clone.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function pageDe(el) {
    var h = el.getAttribute && el.getAttribute('href');
    if (h) return h.split('?')[0].split('/').pop().toLowerCase();
    var oc = (el.getAttribute && el.getAttribute('onclick')) || '';
    var m = oc.match(/([\w-]+\.html)/);
    return m ? m[1].toLowerCase() : '';
  }

  var etat = { agi: false, raison: '', renommes: [], plus_retire: false, role_menage: false };

  function appliquer() {
    if (etat.agi) return true;

    if (estRoleMenage()) {
      etat.role_menage = true;
      etat.raison = 'role menage — barre laissee intacte';
      etat.agi = true;
      return true;
    }

    var lu = lireOnglets();
    if (!lu) { etat.raison = 'barre introuvable'; return false; }

    var libres = lu.items.slice();
    var pris = [];

    /* Chaque onglet vise cherche son porteur : d'abord par destination,
       ensuite par libelle. Un onglet sans porteur n'est pas cree — on ne
       fabrique pas de faux boutons. */
    VISEE.forEach(function (v) {
      var trouve = null;
      for (var i = 0; i < libres.length; i++) {
        if (pageDe(libres[i]) === v.page) { trouve = libres[i]; break; }
      }
      if (!trouve) {
        var mots = { accueil: ['accueil', 'dashboard', 'aujourd'], messages: ['message'],
                     calendrier: ['reservation', 'calendrier', 'calendar'],
                     logements: ['logement', 'settings', 'parametre'],
                     argent: ['caution', 'argent', 'paiement', 'plus'] }[v.cle] || [];
        for (var j = 0; j < libres.length && !trouve; j++) {
          var t = texteDe(libres[j]);
          for (var k = 0; k < mots.length; k++) {
            if (t.indexOf(mots[k]) !== -1) { trouve = libres[j]; break; }
          }
        }
      }
      if (trouve) {
        pris.push({ vise: v, el: trouve });
        libres.splice(libres.indexOf(trouve), 1);
      }
    });

    if (pris.length < 4) { etat.raison = 'seulement ' + pris.length + ' onglet(s) apparie(s) — abandon'; return false; }

    /* Renommage et repointage. */
    pris.forEach(function (p) {
      var el = p.el;
      /* Le libelle : le dernier noeud texte non vide, sans toucher aux icones. */
      var cibles = el.querySelectorAll('span, div, small, label');
      var pose = false;
      for (var i = cibles.length - 1; i >= 0; i--) {
        var c = cibles[i];
        if (c.children.length) continue;
        var t = (c.textContent || '').trim();
        if (!t || /^\d+$/.test(t)) continue;
        c.textContent = p.vise.libelle;
        pose = true;
        break;
      }
      if (!pose && !el.children.length) el.textContent = p.vise.libelle;

      if (el.tagName === 'A') el.setAttribute('href', '/' + p.vise.page);
      el.setAttribute('data-bh-onglet', p.vise.cle);
      etat.renommes.push(p.vise.libelle + ' \u2192 ' + p.vise.page);
    });

    /* Les onglets restes sans role visé quittent la barre — « Plus » en
       tete, puisque « Mon compte » l'a remplace. */
    libres.forEach(function (el) {
      var t = texteDe(el);
      el.style.setProperty('display', 'none', 'important');
      el.setAttribute('data-bh-retire', '1');
      if (t.indexOf('plus') !== -1) etat.plus_retire = true;
    });

    /* La barre compte cinq colonnes, pas six. */
    try {
      var st = getComputedStyle(lu.barre);
      if (st.display === 'grid') lu.barre.style.setProperty('grid-template-columns', 'repeat(' + pris.length + ', 1fr)', 'important');
    } catch (e) {}

    etat.agi = true;
    etat.raison = 'applique';
    return true;
  }

  window.bhVerifBarre = function () {
    var res = {
      role_menage: etat.role_menage,
      raison: etat.raison,
      onglets: etat.renommes.slice(),
      plus_retire: etat.plus_retire,
      visibles: Array.prototype.slice.call(document.querySelectorAll('[data-bh-onglet]'))
        .map(function (e) { return e.getAttribute('data-bh-onglet'); }),
      caches: document.querySelectorAll('[data-bh-retire]').length
    };
    console.log('── Barre d\'onglets ──');
    console.log(res);
    if (etat.role_menage) console.log('Compte menage : la barre est laissee telle quelle, cleaning.html reste atteignable.');
    if (!etat.agi) console.warn('Rien n\'a ete applique : ' + etat.raison);
    return res;
  };

  function demarrer() { appliquer(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(demarrer, 600); });
  } else {
    setTimeout(demarrer, 600);
  }
  /* La barre est parfois construite par mobile-native-experience.js apres nous. */
  setTimeout(demarrer, 1800);
  setTimeout(demarrer, 3600);
})();
