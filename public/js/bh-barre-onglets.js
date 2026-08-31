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
  /* Dans l'ORDRE DES BOUTONS EXISTANTS, pour ne pas desynchroniser la
     capsule glissante .lg-capsule, qui se place selon leur position. */
  var VISEE = [
    { cle: 'accueil',    libelle: "Aujourd'hui", page: 'app.html',          mots: ['accueil', 'dashboard', "aujourd"] },
    { cle: 'calendrier', libelle: 'Calendrier',  page: 'calendrier.html', dest: 'calendrier.html', mots: ['réservation', 'reservation', 'calendrier'] },
    { cle: 'messages',   libelle: 'Messages',    page: 'messages.html',     mots: ['message'] },
    { cle: 'logements',  libelle: 'Logements',   page: 'settings.html',     mots: ['ménage', 'menage', 'logement', 'cleaning'] },
    { cle: 'argent',     libelle: 'Argent',      page: 'deposits.html',     mots: ['plus', 'caution', 'argent'] }
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
    ['.mobile-tabs', '.bh-tabbar', '#bhTabBar', '[class*="tabbar"]', '[class*="tab-bar"]', '.mobile-nav', '#mobileNav']
      .forEach(function (sel) {
        try {
          var els = document.querySelectorAll(sel);
          for (var i = 0; i < els.length; i++) if (barres.indexOf(els[i]) === -1) barres.push(els[i]);
        } catch (e) {}
      });

    for (var b = 0; b < barres.length; b++) {
      /* .tab-btn d'abord : cela ecarte d'emblee la capsule .lg-capsule,
         qui n'est pas un onglet mais l'indicateur qui glisse dessous. */
      var items = barres[b].querySelectorAll('.tab-btn');
      if (!items.length) items = barres[b].querySelectorAll('a[href], button, [data-tab], [role="tab"]');
      var vrais = Array.prototype.slice.call(items).filter(function (e) {
        return !/lg-capsule|capsule|indicator/.test(e.className || '');
      });
      if (vrais.length >= 4 && vrais.length <= 7) {
        return { barre: barres[b], items: vrais };
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
        var mots = v.mots || [];
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

      /* « Messages 0 7 » : deux badges cohabitent avec le mot. On ne
         remplace donc que la feuille qui contient DEJA le mot attendu,
         jamais un compteur ni une icone. */
      var cibles = el.querySelectorAll('span, div, small, label, p');
      var pose = false;
      for (var i = 0; i < cibles.length && !pose; i++) {
        var c = cibles[i];
        if (c.children.length) continue;
        var t = (c.textContent || '').trim();
        if (!t || /^\d+$/.test(t)) continue;
        var bas = t.toLowerCase();
        for (var k = 0; k < (p.vise.mots || []).length; k++) {
          if (bas.indexOf(p.vise.mots[k]) !== -1) { c.textContent = p.vise.libelle; pose = true; break; }
        }
      }
      /* Repli : la derniere feuille non numerique. */
      if (!pose) {
        for (var j = cibles.length - 1; j >= 0; j--) {
          var c2 = cibles[j];
          if (c2.children.length) continue;
          var t2 = (c2.textContent || '').trim();
          if (!t2 || /^\d+$/.test(t2)) continue;
          c2.textContent = p.vise.libelle;
          pose = true;
          break;
        }
      }
      if (!pose && !el.children.length) el.textContent = p.vise.libelle;

      /* Ce sont des <button> : un href ne navigue pas. On reecrit le clic,
         en capture, pour passer devant le gestionnaire d'origine. */
      if (el.tagName === 'A') el.setAttribute('href', '/' + (p.vise.dest || p.vise.page));
      if (!el.__bhClic) {
        el.__bhClic = true;
        var dest = p.vise.dest || p.vise.page;
        el.addEventListener('click', function (ev) {
          var cible = dest.split('?')[0].toLowerCase();
          var recherche = dest.indexOf('?') !== -1 ? '?' + dest.split('?')[1] : '';
          var ici = location.pathname.split('/').pop().toLowerCase();
          /* Deja sur place : meme fichier ET meme vue. Sans la seconde
             condition, Aujourd'hui et Calendrier deviendraient le meme
             bouton, puisqu'ils partagent app.html. */
          if (ici === cible && (location.search || '') === recherche) return;
          ev.preventDefault();
          ev.stopImmediatePropagation();
          location.href = '/' + dest;
        }, true);
      }

      el.setAttribute('data-bh-onglet', p.vise.cle);
      el.setAttribute('aria-label', p.vise.libelle);
      etat.renommes.push(p.vise.libelle + ' \u2192 ' + (p.vise.dest || p.vise.page));
    });

    /* Cinq boutons pour cinq destinations : rien n'est masque, donc la
       capsule glissante garde ses reperes et la barre sa geometrie.
       « Plus » n'est pas retire — il devient « Argent ». */
    etat.plus_retire = pris.some(function (p) { return p.vise.cle === 'argent'; });
    libres.forEach(function (el) {
      el.setAttribute('data-bh-restant', texteDe(el) || '?');
    });

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
      ordre_reel: Array.prototype.slice.call(document.querySelectorAll('[data-bh-onglet]'))
        .map(function (e) { return e.getAttribute('data-bh-onglet'); }),
      non_apparies: Array.prototype.slice.call(document.querySelectorAll('[data-bh-restant]'))
        .map(function (e) { return e.getAttribute('data-bh-restant'); }),
      note: 'Calendrier est en 2e place, pas en 3e : reordonner desynchroniserait la capsule.'
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
