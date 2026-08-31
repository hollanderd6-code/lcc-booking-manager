/* ============================================================
   bh-entete-calendrier.js — l'en-tete de la vue calendrier
   ============================================================
   « X % d'occupation ce mois » / « Calendrier », loupe et initiales a
   droite. Le pourcentage est LU dans la carte Occupation, jamais
   recalcule : un seul endroit calcule l'occupation.
   ============================================================ */
(function () {
  'use strict';

  var enVue = (location.search || '').indexOf('vue=calendrier') !== -1
    || (location.pathname || '').split('/').pop().toLowerCase() === 'calendrier.html';
  if (!enVue) return;
  if (window.__bhEnteteCalendrier) return;
  window.__bhEnteteCalendrier = true;

  var ENCRE = '#0D1117';
  var GRIS = '#8B8B84';
  var VERT = '#0E3B2E';

  var mem = [];
  var diag = { entete: false, occupation: null, loupe: false, rond: false, cartes: [] };

  function memoriser(el, prop, valeur) {
    mem.push({ type: 'style', el: el, prop: prop, valeur: el.style.getPropertyValue(prop), priorite: el.style.getPropertyPriority(prop) });
    el.style.setProperty(prop, valeur, 'important');
  }

  /* Le pourcentage, lu la ou il est calcule. Si la carte ne l'a pas
     encore, on n'invente pas : le sous-titre reste vide et se remplira
     au passage suivant. */
  function occupation() {
    var c = document.getElementById('kpiOccupancyCard');
    if (!c) return null;
    var m = (c.textContent || '').match(/(\d{1,3})\s*%/);
    return m ? m[1] : null;
  }

  var SVG_LOUPE = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true"'
    + ' stroke="#3D4A44" stroke-width="1.9" stroke-linecap="round">'
    + '<circle cx="10.6" cy="10.6" r="6.4"/><path d="M15.4 15.4 20.5 20.5"/></svg>';

  function loupeOriginale() {
    var tous = document.querySelectorAll('.bhgs-trigger-mobile, .bhgs-trigger, [class*="bhgs-trigger"]');
    for (var i = 0; i < tous.length; i++) {
      if (tous[i].id === 'bhLoupeEntete' || tous[i].id === 'bhLoupeCal') continue;
      return tous[i];
    }
    return null;
  }

  function poser() {
    var racine = document.getElementById('bhVueRacine');
    if (!racine) return false;

    var pct = occupation();
    if (pct) diag.occupation = pct + ' %';

    var bloc = document.getElementById('bhEnteteCal');
    if (!bloc) {
      bloc = document.createElement('div');
      bloc.id = 'bhEnteteCal';
      bloc.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:12px'
        + ';padding:8px 4px 14px;font-family:inherit';

      var gauche = document.createElement('div');
      gauche.style.cssText = 'min-width:0';
      var sous = document.createElement('div');
      sous.id = 'bhEnteteCalSous';
      sous.textContent = pct ? pct + " % d'occupation ce mois" : '';
      sous.style.cssText = 'font-size:13.5px;font-weight:500;color:' + GRIS + ';letter-spacing:-.01em;min-height:18px';
      gauche.appendChild(sous);
      var titre = document.createElement('div');
      titre.textContent = 'Calendrier';
      titre.style.cssText = 'margin-top:1px;font-size:31px;font-weight:600;letter-spacing:-.03em;color:' + ENCRE;
      gauche.appendChild(titre);
      bloc.appendChild(gauche);

      var droite = document.createElement('div');
      droite.id = 'bhEnteteCalCommandes';
      droite.style.cssText = 'flex:none;display:flex;align-items:center;gap:9px;padding-top:5px';
      bloc.appendChild(droite);

      racine.insertBefore(bloc, racine.firstChild);
      diag.entete = true;
    } else {
      /* Le pourcentage arrive parfois apres nous. */
      var s = document.getElementById('bhEnteteCalSous');
      if (s && pct && !s.textContent) s.textContent = pct + " % d'occupation ce mois";
    }

    /* L'en-tete doit rester le premier enfant : bh-vue-calendrier
       deplace des blocs dans la racine apres nous. */
    if (racine.firstChild !== bloc) racine.insertBefore(bloc, racine.firstChild);

    var droiteEl = document.getElementById('bhEnteteCalCommandes');
    if (droiteEl) {
      /* Notre loupe, creee une fois. Le composant de recherche recree la
         sienne a intervalles : la deplacer en produirait une de plus a
         chaque passage — la lecon du lot 3h. */
      if (!document.getElementById('bhLoupeCal')) {
        var b = document.createElement('button');
        b.id = 'bhLoupeCal';
        b.type = 'button';
        b.setAttribute('aria-label', 'Rechercher');
        b.style.cssText = 'flex:none;width:40px;height:40px;padding:0;border:1px solid #E4E1D8'
          + ';border-radius:50%;background:#fff;display:inline-flex;align-items:center'
          + ';justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent';
        b.innerHTML = SVG_LOUPE;
        b.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          var orig = loupeOriginale();
          if (!orig) { console.warn('[entete cal] aucun bouton de recherche a declencher'); return; }
          var avant = orig.style.display;
          orig.style.removeProperty('display');
          try { orig.click(); } catch (e) {}
          setTimeout(function () { orig.style.display = avant; }, 60);
        });
        droiteEl.appendChild(b);
        diag.loupe = true;
      }

      /* Le rond porte un identifiant unique : un seul deplacement. */
      var rond = document.getElementById('bhAvatarHeader');
      if (rond && rond.parentElement !== droiteEl) {
        mem.push({ type: 'place', el: rond, parent: rond.parentElement, avant: rond.nextSibling });
        rond.style.setProperty('margin', '0', 'important');
        droiteEl.appendChild(rond);
        diag.rond = true;
      }
    }

    /* Les trois cartes du mois : la maquette ne les montre pas, et son
       sous-titre porte deja l'occupation. Masquees, pas supprimees. */
    ['.bh2-feat', '#kpiOccupancyCard', '#kpiAutoCard'].forEach(function (sel) {
      var c = document.querySelector(sel);
      if (!c || c.dataset.bhCalMasquee) return;
      c.dataset.bhCalMasquee = '1';
      memoriser(c, 'display', 'none');
      diag.cartes.push(sel);
    });

    return true;
  }

  window.bhAnnulerEnteteCal = function () {
    for (var i = mem.length - 1; i >= 0; i--) {
      var m = mem[i];
      if (m.type === 'style') {
        if (m.valeur) m.el.style.setProperty(m.prop, m.valeur, m.priorite);
        else m.el.style.removeProperty(m.prop);
        delete m.el.dataset.bhCalMasquee;
      } else if (m.type === 'place' && m.parent) {
        m.parent.insertBefore(m.el, m.avant);
      }
    }
    var b = document.getElementById('bhEnteteCal');
    if (b) b.remove();
    var n = mem.length;
    mem = [];
    console.log(n + ' changement(s) annule(s) : les trois cartes du mois sont revenues.');
    return n;
  };

  window.bhVerifEnteteCal = function () {
    var racine = document.getElementById('bhVueRacine');
    var bloc = document.getElementById('bhEnteteCal');
    var section = document.getElementById('calendarSection');
    var liste = document.getElementById('bhListeUnifiee');
    var res = {
      entete_pose: !!bloc,
      premier_dans_la_vue: !!(racine && bloc && racine.firstChild === bloc),
      occupation_lue: diag.occupation,
      loupe_propre: !!document.getElementById('bhLoupeCal'),
      rond_deplace: diag.rond,
      cartes_masquees: diag.cartes,
      liste_sous_le_calendrier: !!(liste && section && section.nextElementSibling === liste),
      liste_affichee: !!liste,
      annulable: mem.length + ' changement(s) memorise(s)'
    };
    console.log('── En-tete calendrier ──');
    console.log(res);
    if (!res.entete_pose) console.warn('En-tete non pose : bhVueRacine absente (la vue calendrier ne s est pas posee).');
    if (!res.liste_affichee) console.warn('Liste absente : tapez bhVerifListeUnifiee() pour la raison.');
    console.log('Pour revenir en arriere : bhAnnulerEnteteCal()');
    return res;
  };

  function demarrer() { poser(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(demarrer, 900); });
  } else {
    setTimeout(demarrer, 900);
  }
  [1800, 3000, 4500, 7000, 10000, 13000].forEach(function (t) { setTimeout(demarrer, t); });
})();
