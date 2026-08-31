/* ============================================================
   bh-entete-messages.js — en-tete, defilement, onglets
   ============================================================
   Pose l'en-tete de la page Messages a la forme des autres ecrans,
   libere le defilement de la liste, et masque les onglets Templates /
   Statut / SMS.

   Tout est reversible : bhAnnulerEnteteMsg().
   ============================================================ */
(function () {
  'use strict';

  if (window.__bhEnteteMessages) return;
  window.__bhEnteteMessages = true;

  var ENCRE = '#0D1117';
  var GRIS = '#8B8B84';

  var mem = [];
  var diag = { entete: false, rond: false, loupe: false, defilement: [], onglets: null,
               marque: null, recherche: null, raison: '' };

  function memoriser(el, prop, valeur) {
    mem.push({ type: 'style', el: el, prop: prop, valeur: el.style.getPropertyValue(prop), priorite: el.style.getPropertyPriority(prop) });
    el.style.setProperty(prop, valeur, 'important');
  }

  var SVG_LOUPE = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true"'
    + ' stroke="#3D4A44" stroke-width="1.9" stroke-linecap="round">'
    + '<circle cx="10.6" cy="10.6" r="6.4"/><path d="M15.4 15.4 20.5 20.5"/></svg>';

  function nonLus() {
    var l = window.allConversations || [];
    var n = 0;
    for (var i = 0; i < l.length; i++) n += parseInt(l[i].unread_count, 10) || 0;
    return n;
  }

  function surtitre() {
    var n = nonLus();
    return n ? n + ' non lu' + (n > 1 ? 's' : '') : '';
  }

  /* ── 1. L'en-tete ───────────────────────────────────────────── */

  function poserEntete() {
    var hote = document.getElementById('bhMessagesListe');
    if (!hote) { diag.raison = 'la liste du lot 17 n est pas posee'; return false; }

    var bloc = document.getElementById('bhEnteteMsg');
    if (!bloc) {
      bloc = document.createElement('div');
      bloc.id = 'bhEnteteMsg';
      bloc.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between'
        + ';gap:12px;padding:8px 4px 14px;font-family:inherit';

      var gauche = document.createElement('div');
      gauche.style.cssText = 'min-width:0';
      var sur = document.createElement('div');
      sur.id = 'bhEnteteMsgSur';
      sur.textContent = surtitre();
      sur.style.cssText = 'font-size:13.5px;font-weight:500;color:' + GRIS
        + ';letter-spacing:-.01em;min-height:18px;line-height:1.35';
      gauche.appendChild(sur);
      var titre = document.createElement('div');
      titre.textContent = 'Messages';
      titre.style.cssText = 'margin-top:1px;font-size:31px;font-weight:600;letter-spacing:-.03em;color:' + ENCRE;
      gauche.appendChild(titre);
      bloc.appendChild(gauche);

      var droite = document.createElement('div');
      droite.id = 'bhEnteteMsgCommandes';
      droite.style.cssText = 'flex:none;display:flex;align-items:center;gap:9px;padding-top:5px';
      bloc.appendChild(droite);

      hote.parentElement.insertBefore(bloc, hote);
      diag.entete = true;
    } else {
      /* Jamais fige : les conversations arrivent apres nous. */
      var s = document.getElementById('bhEnteteMsgSur');
      if (s) s.textContent = surtitre();
    }

    var droiteEl = document.getElementById('bhEnteteMsgCommandes');
    if (droiteEl) {
      if (!document.getElementById('bhLoupeMsg')) {
        var b = document.createElement('button');
        b.id = 'bhLoupeMsg';
        b.type = 'button';
        b.setAttribute('aria-label', 'Rechercher');
        b.style.cssText = 'flex:none;width:40px;height:40px;padding:0;border:1px solid #E4E1D8'
          + ';border-radius:50%;background:#fff;display:inline-flex;align-items:center'
          + ';justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent';
        b.innerHTML = SVG_LOUPE;
        b.addEventListener('click', function (ev) {
          ev.preventDefault();
          basculerRecherche();
        });
        droiteEl.appendChild(b);
        diag.loupe = true;
      }

      var rond = document.getElementById('bhAvatarHeader');
      if (rond && rond.parentElement !== droiteEl) {
        mem.push({ type: 'place', el: rond, parent: rond.parentElement, avant: rond.nextSibling });
        rond.style.setProperty('margin', '0', 'important');
        droiteEl.appendChild(rond);
        diag.rond = true;
      }
    }
    return true;
  }

  /* ── 1 bis. La marque et la recherche ───────────────────────── */

  function champRecherche() {
    return document.getElementById('msgsSearchInput')
      || document.querySelector('input[placeholder*="echerch"], input[placeholder*="echerch"]');
  }

  /* Le bandeau : le plus petit conteneur qui porte le champ et qui a
     une hauteur propre. On remonte de trois crans au plus. */
  function bandeauRecherche() {
    var c = champRecherche();
    if (!c) return null;
    var el = c.parentElement, garde = 0, dernier = null;
    while (el && el !== document.body && garde++ < 3) {
      if (el.querySelector('#conversationsList, #bhMessagesListe')) break;
      dernier = el;
      el = el.parentElement;
    }
    return dernier;
  }

  /* La barre de marque.

     Ma premiere regle — « le plus petit conteneur portant BOOSTINGHOST »
     — designait #bhSidebar : le menu lateral porte le mot lui aussi, et
     il est plus court. Le mot est partout dans la page ; la barre du
     haut, elle, est une FORME et une POSITION.

     On part donc de « SMART PROPERTY MANAGER », qui n'apparait que sous
     le logo, et on remonte jusqu'a l'ancetre qui ressemble a une barre :
     large, basse, tout en haut. Avec des refus explicites. */
  function estBarreDuHaut(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el === document.body || el.tagName === 'HTML') return false;
    if (el.id === 'bhSidebar') return false;
    var cls = ' ' + (typeof el.className === 'string' ? el.className.toLowerCase() : '') + ' ';
    if (/sidebar|drawer|menu-lateral|offcanvas/.test(cls)) return false;
    if (el.querySelector('#conversationsList, #bhMessagesListe, #msgsSearchInput')) return false;
    var r = el.getBoundingClientRect();
    if (r.width < window.innerWidth * 0.7) return false;
    if (r.height < 40 || r.height > 160) return false;
    if (r.top > 200) return false;
    return true;
  }

  function barreMarque() {
    /* Le sous-titre du logo : present une seule fois dans la page. */
    var depart = null;
    var noeuds = document.querySelectorAll('div, span, p, small, h1, h2');
    for (var i = 0; i < noeuds.length; i++) {
      var n = noeuds[i];
      if (n.children.length) continue;
      var t = (n.textContent || '').replace(/\s+/g, ' ').trim();
      if (/^smart property manager$/i.test(t)) { depart = n; break; }
    }
    /* A defaut, le logo lui-meme. */
    if (!depart) depart = document.querySelector('img[alt*="oosting" i], img[src*="logo" i]');
    if (!depart) return null;
    if (depart.closest && depart.closest('#bhSidebar')) {
      /* Le sous-titre trouve est celui du menu : on cherche l'autre. */
      var tous = document.querySelectorAll('img[alt*="oosting" i], img[src*="logo" i]');
      depart = null;
      for (var j = 0; j < tous.length; j++) {
        if (!tous[j].closest('#bhSidebar')) { depart = tous[j]; break; }
      }
      if (!depart) return null;
    }

    var el = depart, garde = 0;
    while (el && garde++ < 8) {
      if (estBarreDuHaut(el)) return el;
      el = el.parentElement;
    }
    return null;
  }

  var rechercheOuverte = false;

  function basculerRecherche() {
    var bandeau = bandeauRecherche();
    var champ = champRecherche();
    if (!bandeau || !champ) {
      console.warn('[entete msg] aucun champ de recherche a ouvrir');
      return;
    }
    rechercheOuverte = !rechercheOuverte;
    bandeau.style.setProperty('display', rechercheOuverte ? '' : 'none', 'important');
    if (rechercheOuverte) {
      try { champ.focus(); } catch (e) {}
    } else if (champ.value) {
      /* On referme sur un champ vide : sinon la liste resterait filtree
         par un texte que plus personne ne voit. */
      champ.value = '';
      try { champ.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
    }
  }

  function replierRecherche() {
    var bandeau = bandeauRecherche();
    if (!bandeau || bandeau.dataset.bhReplie) return;
    bandeau.dataset.bhReplie = '1';
    memoriser(bandeau, 'display', 'none');
    diag.recherche = 'repliee — la loupe l ouvre';

    var champ = champRecherche();
    if (champ && !champ.dataset.bhEchap) {
      champ.dataset.bhEchap = '1';
      champ.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') basculerRecherche();
      });
      champ.addEventListener('blur', function () {
        if (!champ.value && rechercheOuverte) setTimeout(basculerRecherche, 120);
      });
    }
  }

  function masquerMarque() {
    if (diag.marque) return;
    var b = barreMarque();
    if (!b) { diag.marque = null; return; }
    if (b.id === 'bhSidebar' || (b.closest && b.closest('#bhSidebar'))) {
      diag.marque = 'refus : la cible serait le menu lateral';
      return;
    }
    if (b.dataset.bhMarqueMasquee) return;
    b.dataset.bhMarqueMasquee = '1';
    memoriser(b, 'display', 'none');
    diag.marque = (b.id ? '#' + b.id : b.tagName.toLowerCase())
      + (typeof b.className === 'string' && b.className ? '.' + b.className.split(/\s+/)[0] : '');
  }

  /* ── 2. Le defilement ───────────────────────────────────────── */

  function libererDefilement() {
    var hote = document.getElementById('bhMessagesListe');
    if (!hote) return;
    var el = hote.parentElement;
    var garde = 0;
    while (el && el !== document.body && garde++ < 8) {
      if (!el.dataset.bhDefilement) {
        var s = getComputedStyle(el);
        var bloque = false;
        /* Une hauteur figee sur un conteneur plus court que son contenu :
           c'est ce qui empeche le pouce de faire defiler. */
        if (s.overflowY === 'hidden') { memoriser(el, 'overflow-y', 'auto'); bloque = true; }
        if (s.height !== 'auto' && el.scrollHeight > el.clientHeight + 4) {
          memoriser(el, 'height', 'auto');
          memoriser(el, 'max-height', 'none');
          bloque = true;
        }
        if (bloque) {
          memoriser(el, '-webkit-overflow-scrolling', 'touch');
          el.dataset.bhDefilement = '1';
          diag.defilement.push((el.id ? '#' + el.id : el.tagName.toLowerCase())
            + (typeof el.className === 'string' && el.className ? '.' + el.className.split(/\s+/)[0] : ''));
        }
      }
      el = el.parentElement;
    }
  }

  /* ── 3. Les onglets ─────────────────────────────────────────── */

  function texteCourt(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /* Repere par le CONTENU : le plus petit conteneur portant a la fois
     « Templates » et « Statut ». Un intitule qui change n'entraine
     aucun masquage — jamais une barre au hasard. */
  function barreOnglets() {
    var noeuds = document.querySelectorAll('div, nav, ul, section, header');
    var meilleur = null;
    for (var i = 0; i < noeuds.length; i++) {
      var t = texteCourt(noeuds[i]);
      if (t.length > 220) continue;
      if (t.indexOf('Templates') === -1) continue;
      if (t.indexOf('Statut') === -1 && t.indexOf('SMS') === -1) continue;
      if (noeuds[i].querySelector('#conversationsList, #bhMessagesListe')) continue;
      if (!meilleur || t.length < texteCourt(meilleur).length) meilleur = noeuds[i];
    }
    return meilleur;
  }

  function masquerOnglets() {
    if (diag.onglets) return;
    var b = barreOnglets();
    if (!b) { diag.onglets = null; return; }
    if (b.dataset.bhOngletsMasques) return;
    b.dataset.bhOngletsMasques = '1';
    memoriser(b, 'display', 'none');
    diag.onglets = (b.id ? '#' + b.id : b.tagName.toLowerCase())
      + (typeof b.className === 'string' && b.className ? '.' + b.className.split(/\s+/)[0] : '')
      + ' — « ' + texteCourt(b).slice(0, 60) + ' »';
  }

  /* ── Le tour ────────────────────────────────────────────────── */

  /* Le lot 19 masquait #bhSidebar par erreur. On le rend avant tout,
     une seule fois, quoi qu'il arrive ensuite. */
  var sidebarRendu = false;
  function rendreSidebar() {
    if (sidebarRendu) return;
    sidebarRendu = true;
    var s = document.getElementById('bhSidebar');
    if (s && s.dataset.bhMarqueMasquee) {
      s.style.removeProperty('display');
      delete s.dataset.bhMarqueMasquee;
      for (var i = mem.length - 1; i >= 0; i--) if (mem[i].el === s) mem.splice(i, 1);
      diag.marque = null;
      console.log('[entete msg] menu lateral rendu — il avait ete masque par erreur.');
    }
  }

  function tour() {
    rendreSidebar();
    poserEntete();
    masquerMarque();
    replierRecherche();
    libererDefilement();
    masquerOnglets();
  }

  window.bhAnnulerEnteteMsg = function () {
    for (var i = mem.length - 1; i >= 0; i--) {
      var m = mem[i];
      if (m.type === 'style') {
        if (m.valeur) m.el.style.setProperty(m.prop, m.valeur, m.priorite);
        else m.el.style.removeProperty(m.prop);
        delete m.el.dataset.bhDefilement;
        delete m.el.dataset.bhOngletsMasques;
        delete m.el.dataset.bhMarqueMasquee;
        delete m.el.dataset.bhReplie;
      } else if (m.type === 'place' && m.parent) {
        m.parent.insertBefore(m.el, m.avant);
      }
    }
    var b = document.getElementById('bhEnteteMsg');
    if (b) b.remove();
    var n = mem.length;
    mem = [];
    diag.defilement = [];
    diag.onglets = null;
    console.log(n + ' changement(s) annule(s) : en-tete retire, onglets rendus.');
    return n;
  };

  window.bhVerifEnteteMsg = function () {
    var res = {
      entete_pose: !!document.getElementById('bhEnteteMsg'),
      surtitre: (document.getElementById('bhEnteteMsgSur') || {}).textContent || '(aucun non lu)',
      loupe: !!document.getElementById('bhLoupeMsg'),
      rond_deplace: diag.rond,
      defilement: diag.defilement.length ? diag.defilement : 'aucun conteneur ne bloquait',
      onglets_masques: diag.onglets || 'barre non trouvee — rien masque',
      marque_masquee: diag.marque || 'barre BOOSTINGHOST non trouvee — rien masque',
      recherche: diag.recherche || 'bandeau non trouve — laisse en place',
      recherche_ouverte: rechercheOuverte,
      annulable: mem.length + ' changement(s) memorise(s)',
      raison: diag.raison
    };
    console.log('── En-tete Messages ──');
    console.log(res);
    if (!res.entete_pose) console.warn('En-tete non pose : ' + (diag.raison || 'la liste du lot 17 est absente'));
    if (!diag.onglets) console.warn('Onglets : aucun conteneur portant « Templates » et « Statut ». Rien masque.');
    console.log('Pour revenir en arriere : bhAnnulerEnteteMsg()');
    return res;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(tour, 1100); });
  } else {
    setTimeout(tour, 1100);
  }
  [2000, 3200, 5000, 7500, 11000].forEach(function (t) { setTimeout(tour, t); });
})();
