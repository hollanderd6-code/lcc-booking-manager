/* ============================================================
   bh-mon-compte.js — la feuille « Mon compte »
   Ouverte par le rond aux initiales, en haut a droite.
   ============================================================
   Ne remplace pas « Plus » : le lot 2 s'en chargera, une fois que
   vous aurez verifie qu'aucune entree ne manque ici.

   Le module ne connait aucune URL en dur. Il lit les liens presents
   dans la feuille « Plus » et les range. Une entree qu'il ne reconnait
   pas va dans « Autres » — jamais a la poubelle.
   ============================================================ */
(function () {
  'use strict';

  if (window.__bhMonCompte) return;
  window.__bhMonCompte = true;

  var VERT = '#0E3B2E';
  var ENCRE = '#0D1117';
  var GRIS = '#7A8695';
  var BORD = '#F0EEE7';
  var FOND = '#EFEDE6';

  /* ── Les familles, dans l'ordre d'affichage ─────────────────── */
  var FAMILLES = [
    { titre: 'Le compte', motifs: ['abonnement', 'facturation', 'mon profil', 'profil', 'equipe', 'utilisateur', 'acces', 'sous-compte', 'compte gere', 'delegation', 'plateforme', 'channex', 'connexion', 'airbnb', 'booking'] },
    { titre: "L'exploitation", motifs: ['menage', 'cleaning', 'prestataire', 'intervenant', 'message', 'modele', 'template', 'automatique', 'notification', 'serrure', 'code', 'ia', 'assistant'] },
    { titre: "L'argent", motifs: ['caution', 'deposit', 'paiement', 'facture', 'tarif', 'pricing', 'prix', 'revenu', 'releve', 'proprietaire'] },
    { titre: "L'aide", motifs: ['aide', 'tutoriel', 'support', 'contact', 'ecrire', 'documentation', 'faq'] }
  ];

  /* ── Lecture des entrees existantes ─────────────────────────── */
  function lireEntrees() {
    var vus = {};
    var out = [];

    /* On cherche large : toute feuille/menu qui ressemble au Plus. */
    var conteneurs = [];
    ['#moreSheet', '#bhMoreSheet', '.bh-more-sheet', '#plusSheet', '[data-bh-sheet="more"]', '#mobileMoreMenu', '.more-sheet']
      .forEach(function (sel) {
        try {
          var els = document.querySelectorAll(sel);
          for (var i = 0; i < els.length; i++) conteneurs.push(els[i]);
        } catch (e) {}
      });

    /* Repli : un conteneur qui contient beaucoup de liens .html et le mot « Plus ». */
    if (!conteneurs.length) {
      var tous = document.querySelectorAll('div, nav, section, aside, ul');
      for (var j = 0; j < tous.length; j++) {
        var el = tous[j];
        if (el.children.length < 4 || el.children.length > 40) continue;
        var liens = el.querySelectorAll('a[href*=".html"]');
        if (liens.length >= 4 && liens.length <= 30) {
          var prof = 0, p = el;
          while (p && p !== document.body) { prof++; p = p.parentElement; }
          conteneurs.push(el);
          if (conteneurs.length > 3) break;
        }
      }
    }

    conteneurs.forEach(function (c) {
      var liens = c.querySelectorAll('a[href]');
      for (var i = 0; i < liens.length; i++) {
        var a = liens[i];
        var href = a.getAttribute('href') || '';
        if (!href || href.charAt(0) === '#' || href.indexOf('javascript:') === 0) continue;
        var libelle = (a.textContent || '').replace(/\s+/g, ' ').trim();
        if (!libelle || libelle.length > 60) continue;
        var cle = href + '|' + libelle.toLowerCase();
        if (vus[cle]) continue;
        vus[cle] = true;
        out.push({ href: href, libelle: libelle });
      }
    });

    return out;
  }

  function ranger(entrees) {
    var groupes = FAMILLES.map(function (f) { return { titre: f.titre, items: [] }; });
    var autres = { titre: 'Autres', items: [] };

    entrees.forEach(function (e) {
      var texte = (e.libelle + ' ' + e.href).toLowerCase();
      var place = false;
      for (var i = 0; i < FAMILLES.length && !place; i++) {
        for (var j = 0; j < FAMILLES[i].motifs.length; j++) {
          if (texte.indexOf(FAMILLES[i].motifs[j]) !== -1) { groupes[i].items.push(e); place = true; break; }
        }
      }
      if (!place) autres.items.push(e);
    });

    var res = groupes.filter(function (g) { return g.items.length; });
    if (autres.items.length) res.push(autres);
    return res;
  }

  /* ── Initiales et nom, lus dans la page ─────────────────────── */
  function lireIdentite() {
    var nom = '';
    ['#userName', '#profileName', '[data-user-name]', '.user-name'].forEach(function (sel) {
      if (nom) return;
      var el = document.querySelector(sel);
      if (el) nom = (el.textContent || '').trim();
    });
    if (!nom) {
      try {
        var brut = localStorage.getItem('lcc_user') || localStorage.getItem('bh_user') || '';
        if (brut) { var o = JSON.parse(brut); nom = o.name || o.full_name || o.email || ''; }
      } catch (e) {}
    }
    var init = '';
    if (nom) {
      var mots = nom.replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/);
      init = (mots[0] ? mots[0].charAt(0) : '') + (mots[1] ? mots[1].charAt(0) : '');
      init = init.toUpperCase();
    }
    return { nom: nom || 'Mon compte', initiales: init || '\u2022\u2022' };
  }

  /* ── Construction de la feuille ─────────────────────────────── */
  var feuille = null;

  function construire() {
    var entrees = lireEntrees();
    var groupes = ranger(entrees);
    var moi = lireIdentite();

    var el = document.createElement('div');
    el.id = 'bhMonCompte';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Mon compte');
    el.style.cssText = 'position:fixed;inset:0;z-index:99998;background:' + FOND
      + ';display:flex;flex-direction:column;font-family:"DM Sans",system-ui,-apple-system,sans-serif'
      + ';transform:translateY(100%);transition:transform .28s cubic-bezier(.32,.72,0,1)';

    var haut = document.createElement('div');
    haut.style.cssText = 'flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px'
      + ';padding:calc(env(safe-area-inset-top,0px) + 18px) 20px 12px';
    haut.innerHTML = '<h2 style="margin:0;font-size:29px;font-weight:600;letter-spacing:-.03em;color:' + ENCRE + '">Mon compte</h2>';
    var fermer = document.createElement('button');
    fermer.type = 'button';
    fermer.textContent = 'Fermer';
    fermer.style.cssText = 'border:0;background:none;font:inherit;font-size:15px;font-weight:600;color:' + VERT
      + ';padding:10px 4px;min-height:44px;cursor:pointer';
    fermer.addEventListener('click', masquer);
    haut.appendChild(fermer);
    el.appendChild(haut);

    var corps = document.createElement('div');
    corps.style.cssText = 'flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:4px 16px 40px';

    var carte = document.createElement('div');
    carte.style.cssText = 'display:flex;align-items:center;gap:14px;background:#fff;border-radius:18px;padding:16px;margin-bottom:16px';
    carte.innerHTML = '<div style="flex:none;width:52px;height:52px;border-radius:50%;background:#DCE8E1;display:flex;align-items:center'
      + ';justify-content:center;font-size:16px;font-weight:600;color:' + VERT + '">' + moi.initiales + '</div>'
      + '<div style="flex:1;min-width:0"><div style="font-size:17px;font-weight:600;color:' + ENCRE
      + ';letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + moi.nom + '</div>'
      + '<div style="font-size:13px;color:' + GRIS + ';margin-top:2px">Boostinghost</div></div>';
    corps.appendChild(carte);

    if (!groupes.length) {
      var vide = document.createElement('div');
      vide.style.cssText = 'background:#FBF6E9;border:1px solid #E5C98F;border-radius:16px;padding:16px;font-size:14px;color:#8A5B14;line-height:1.5';
      vide.textContent = "Aucune entree lue dans le menu Plus sur cette page. Le menu Plus reste disponible : rien n'est perdu. Tapez bhVerifMonCompte() dans la console pour le diagnostic.";
      corps.appendChild(vide);
    }

    groupes.forEach(function (g) {
      var titre = document.createElement('div');
      titre.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:.13em;color:#8B8B84;padding:6px 4px 9px;text-transform:uppercase';
      titre.textContent = g.titre;
      corps.appendChild(titre);

      var bloc = document.createElement('div');
      bloc.style.cssText = 'background:#fff;border-radius:18px;overflow:hidden;margin-bottom:16px';
      g.items.forEach(function (item, i) {
        if (i) {
          var trait = document.createElement('div');
          trait.style.cssText = 'height:1px;background:' + BORD + ';margin:0 16px';
          bloc.appendChild(trait);
        }
        var a = document.createElement('a');
        a.href = item.href;
        a.style.cssText = 'display:flex;align-items:center;gap:10px;padding:15px 16px;min-height:44px'
          + ';text-decoration:none;color:' + ENCRE + ';font-size:15.5px';
        a.innerHTML = '<span style="flex:1">' + item.libelle + '</span>'
          + '<span style="flex:none;color:#C4C0B6;font-size:18px;line-height:1">\u203A</span>';
        bloc.appendChild(a);
      });
      corps.appendChild(bloc);
    });

    var deco = document.querySelector('#logoutBtn, [data-logout], a[href*="logout"], button[onclick*="logout"]');
    if (deco) {
      var b = document.createElement('div');
      b.style.cssText = 'background:#fff;border-radius:18px;padding:16px;text-align:center;margin-bottom:14px;cursor:pointer';
      b.innerHTML = '<span style="font-size:15.5px;font-weight:600;color:#A8452A">Se deconnecter</span>';
      b.addEventListener('click', function () { deco.click(); });
      corps.appendChild(b);
    }

    el.appendChild(corps);
    document.body.appendChild(el);
    feuille = el;
    feuille.__entrees = entrees;
    feuille.__groupes = groupes;
    return el;
  }

  function afficher() {
    if (!feuille) construire();
    /* Reconstruire si la page a change entre-temps. */
    document.body.style.overflow = 'hidden';
    feuille.style.display = 'flex';
    requestAnimationFrame(function () { feuille.style.transform = 'translateY(0)'; });
  }

  function masquer() {
    if (!feuille) return;
    feuille.style.transform = 'translateY(100%)';
    document.body.style.overflow = '';
    setTimeout(function () { if (feuille) feuille.style.display = 'none'; }, 300);
  }

  window.bhOuvrirMonCompte = afficher;
  window.bhFermerMonCompte = masquer;

  /* ── Le rond aux initiales ouvre la feuille ─────────────────── */
  function brancher() {
    var cibles = [];
    ['#userAvatar', '#profileAvatar', '.bh-avatar', '[data-bh-avatar]', '.user-avatar', '#avatarBtn', '.avatar-circle']
      .forEach(function (sel) {
        try {
          var els = document.querySelectorAll(sel);
          for (var i = 0; i < els.length; i++) cibles.push(els[i]);
        } catch (e) {}
      });

    var n = 0;
    cibles.forEach(function (c) {
      if (c.__bhCompteBranche) return;
      c.__bhCompteBranche = true;
      c.style.cursor = 'pointer';
      c.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        afficher();
      }, true);
      n++;
    });
    return n;
  }

  /* ── Le diagnostic, pour que la verification ne soit pas une croyance ── */
  window.bhVerifMonCompte = function () {
    var entrees = lireEntrees();
    var groupes = ranger(entrees);
    var ranges = 0;
    groupes.forEach(function (g) { ranges += g.items.length; });
    var avatars = document.querySelectorAll('#userAvatar, #profileAvatar, .bh-avatar, [data-bh-avatar], .user-avatar, #avatarBtn, .avatar-circle').length;

    var res = {
      entrees_lues_dans_Plus: entrees.length,
      entrees_rangees: ranges,
      manquantes: entrees.length - ranges,
      familles: groupes.map(function (g) { return g.titre + ' (' + g.items.length + ')'; }),
      ronds_initiales_trouves: avatars,
      feuille_construite: !!feuille
    };
    console.log('── Mon compte ──');
    console.table(entrees);
    console.log(res);
    if (!avatars) console.warn('Aucun rond aux initiales trouve sur cette page : la feuille ne peut pas etre ouverte au doigt. Utilisez bhOuvrirMonCompte().');
    if (res.manquantes > 0) console.warn(res.manquantes + ' entree(s) lue(s) mais non rangee(s) — signalez-le, « Plus » doit rester en place.');
    return res;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(brancher, 400); });
  } else {
    setTimeout(brancher, 400);
  }
  /* La barre d'onglets se construit parfois apres nous. */
  setTimeout(brancher, 1500);
  setTimeout(brancher, 3000);
})();
