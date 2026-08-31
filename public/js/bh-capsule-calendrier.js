/* ============================================================
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
        if (!txt || /^\d+$/.test(txt)) continue;
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
      libelle_cible: c ? (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20) : null,
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
