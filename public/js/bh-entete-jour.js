/* ============================================================
   bh-entete-jour.js — un titre, puis les sept jours
   ============================================================
   Pose « Lundi 31 aout / Aujourd'hui » en tete de page, et remonte la
   bande de sept jours juste dessous.

   « Votre journee » n'est ni modifiee ni masquee : elle glisse d'un cran.
   ============================================================ */
(function () {
  'use strict';

  if (window.__bhEnteteJour) return;
  window.__bhEnteteJour = true;

  var ENCRE = '#0D1117';
  var GRIS = '#8B8B84';

  var JOURS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
              'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  var diag = { entete: false, bande_remontee: false, carte_trouvee: false, raison: '' };

  /* La carte « Votre journee » : notre repere pour savoir ou commence
     le contenu de la page. */
  function carteJournee() {
    var titres = document.querySelectorAll('h1, h2, h3, h4, .card-title, [class*="title"]');
    for (var i = 0; i < titres.length; i++) {
      var t = (titres[i].textContent || '').toLowerCase();
      if (t.indexOf('votre journ') === -1) continue;
      var carte = titres[i].closest('.card, [class*="card"], section, .panel') || titres[i].parentElement;
      /* On remonte tant que le bloc est trop petit pour etre la carte. */
      var garde = 0;
      while (carte && carte.parentElement && carte.getBoundingClientRect().height < 120 && garde++ < 6) {
        carte = carte.parentElement;
      }
      return carte;
    }
    return null;
  }

  function poserEntete() {
    if (document.getElementById('bhEnteteJour')) return true;
    var carte = carteJournee();
    if (!carte || !carte.parentElement) { diag.raison = 'carte « Votre journee » introuvable'; return false; }
    diag.carte_trouvee = true;

    var d = new Date();
    var bloc = document.createElement('div');
    bloc.id = 'bhEnteteJour';
    bloc.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:12px'
      + ';padding:2px 4px 14px;font-family:inherit';

    var gauche = document.createElement('div');
    gauche.style.cssText = 'min-width:0';
    gauche.innerHTML =
      '<div style="font-size:13.5px;font-weight:500;color:' + GRIS + ';letter-spacing:-.01em">'
      + JOURS[d.getDay()] + ' ' + d.getDate() + ' ' + MOIS[d.getMonth()] + '</div>'
      + '<div style="margin-top:1px;font-size:31px;font-weight:600;letter-spacing:-.03em;color:' + ENCRE + '">'
      + "Aujourd'hui</div>";
    bloc.appendChild(gauche);

    /* Le cote droit accueillera la loupe et le rond, deplaces depuis la
       barre beige. Cree vide : s'ils manquent, il ne laisse aucun trou. */
    var droite = document.createElement('div');
    droite.id = 'bhEnteteCommandes';
    droite.style.cssText = 'flex:none;display:flex;align-items:center;gap:9px;padding-top:5px';
    bloc.appendChild(droite);

    carte.parentElement.insertBefore(bloc, carte);
    diag.entete = true;
    return true;
  }

  /* La bande s'insere apres « Votre journee ». On la remonte entre
     l'en-tete et la carte, pour qu'elle soit visible sans defiler. */
  function remonterBande() {
    var bande = document.getElementById('bhBandeJours');
    var entete = document.getElementById('bhEnteteJour');
    if (!bande || !entete) return false;
    if (bande.previousElementSibling === entete) { diag.bande_remontee = true; return true; }
    if (!entete.parentElement) return false;

    /* insertBefore deplace le noeud : rien n'est clone, donc aucun
       doublon possible, et les ecouteurs du lien « Voir le mois »
       restent attaches. */
    entete.parentElement.insertBefore(bande, entete.nextSibling);
    bande.style.marginTop = '0';
    diag.bande_remontee = true;
    return true;
  }

  /* ── Une loupe, la notre, creee une fois ──────────────────────
     Le composant de recherche recree son bouton a intervalles : le
     deplacer produisait une loupe de plus a chaque passage. On cree
     donc la notre, et au clic on declenche l'original — celui qui
     existe a cet instant. La logique de recherche est appelee, jamais
     dupliquee. */
  var SVG_LOUPE = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true"'
    + ' stroke="#3D4A44" stroke-width="1.9" stroke-linecap="round">'
    + '<circle cx="10.6" cy="10.6" r="6.4"/><path d="M15.4 15.4 20.5 20.5"/></svg>';

  function loupeOriginale() {
    var tous = document.querySelectorAll('.bhgs-trigger-mobile, .bhgs-trigger, [class*="bhgs-trigger"]');
    for (var i = 0; i < tous.length; i++) {
      if (tous[i].id === 'bhLoupeEntete') continue;
      return tous[i];
    }
    return null;
  }

  function poserLoupe(droite) {
    if (document.getElementById('bhLoupeEntete')) return true;
    var b = document.createElement('button');
    b.id = 'bhLoupeEntete';
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
      if (!orig) { console.warn('[entete] aucun bouton de recherche a declencher'); return; }
      /* Masque : certaines librairies refusent d'agir sur un element
         invisible. On le montre le temps du clic. */
      var avant = orig.style.display;
      orig.style.removeProperty('display');
      try { orig.click(); } catch (e) {}
      setTimeout(function () {
        if (orig.dataset.bhLoupeMasquee) orig.style.setProperty('display', 'none', 'important');
        else orig.style.display = avant;
      }, 60);
    });
    droite.insertBefore(b, droite.firstChild);
    diag.loupe = true;
    return true;
  }

  /* Le menage : toute loupe surnumeraire arrivee dans l'en-tete par mes
     passages precedents, et celles du header, sont masquees. */
  function rangerLoupes(droite) {
    var n = 0;
    var tous = document.querySelectorAll('.bhgs-trigger-mobile, .bhgs-trigger, [class*="bhgs-trigger"]');
    for (var i = 0; i < tous.length; i++) {
      var e = tous[i];
      if (e.id === 'bhLoupeEntete') continue;
      /* Une intruse deja dans l'en-tete : elle vient de mes anciens
         deplacements, on la retire du flux. */
      if (droite && droite.contains(e)) { e.remove(); n++; continue; }
      if (!e.dataset.bhLoupeMasquee) {
        e.dataset.bhLoupeMasquee = '1';
        e.style.setProperty('display', 'none', 'important');
        n++;
      }
    }
    diag.loupes_rangees = (diag.loupes_rangees || 0) + n;
    return n;
  }

  function deplacerCommandes() {
    var droite = document.getElementById('bhEnteteCommandes');
    if (!droite) return false;

    poserLoupe(droite);
    rangerLoupes(droite);

    /* Le rond porte un id unique : un seul deplacement possible. */
    var rond = document.getElementById('bhAvatarHeader');
    if (rond && rond.parentElement !== droite) {
      rond.style.setProperty('margin', '0', 'important');
      droite.appendChild(rond);
      diag.rond = true;
    }

    /* Le header part si l'en-tete porte sa loupe ET le rond. La
       condition ne depend plus de ce que le header contient — sinon un
       bouton recree par son proprietaire le bloquerait indefiniment. */
    var maLoupe = document.getElementById('bhLoupeEntete');
    var monRond = document.getElementById('bhAvatarHeader');
    var pret = !!(maLoupe && maLoupe.parentElement === droite)
            && !!(monRond && monRond.parentElement === droite);

    if (pret) {
      var repere = document.querySelector('.mobile-logo') || loupeOriginale();
      var barre = repere ? repere.closest('header, .mobile-header, [class*="header"]') : null;
      if (barre && barre !== document.body && !barre.contains(droite)) {
        if (!barre.dataset.bhMasquee) {
          barre.style.setProperty('display', 'none', 'important');
          barre.dataset.bhMasquee = '1';
          diag.barre_masquee = true;
        } else if (getComputedStyle(barre).display !== 'none') {
          /* Son proprietaire l'a rouverte : on remasque, sans bruit. */
          barre.style.setProperty('display', 'none', 'important');
        }
      } else if (!barre) {
        diag.raison = 'conteneur du header introuvable';
      }
    } else {
      diag.raison = 'en-tete incomplet (loupe ou rond absent)';
    }
    return true;
  }

  window.bhVerifEntete = function () {
    var bande = document.getElementById('bhBandeJours');
    var entete = document.getElementById('bhEnteteJour');
    var res = {
      entete_pose: !!entete,
      bande_presente: !!bande,
      bande_juste_sous_entete: !!(bande && entete && bande.previousElementSibling === entete),
      carte_journee_trouvee: diag.carte_trouvee,
      loupe_deplacee: !!diag.loupe,
      rond_deplace: !!diag.rond,
      barre_beige_masquee: !!diag.barre_masquee,
      loupes_visibles: Array.prototype.slice.call(
        document.querySelectorAll('#bhLoupeEntete, .bhgs-trigger-mobile, [class*="bhgs-trigger"]')
      ).filter(function (e) { return getComputedStyle(e).display !== 'none'; }).length,
      loupes_rangees: diag.loupes_rangees || 0,
      bande_visible_sans_defiler: bande ? bande.getBoundingClientRect().top < window.innerHeight : false,
      raison: diag.raison
    };
    console.log('── En-tete du jour ──');
    console.log(res);
    if (!res.entete_pose) console.warn('En-tete non pose : ' + (diag.raison || 'inconnu'));
    if (res.bande_presente && !res.bande_juste_sous_entete) {
      console.warn('La bande existe mais n\'a pas ete remontee — elle est peut-etre arrivee apres.');
    }
    return res;
  };

  function demarrer() {
    poserEntete();
    deplacerCommandes();
    /* remonterBande() n'est plus appelee : l'ordre du haut est arbitre
       par bh-kpi-haut.js. Deux modules qui deplacent le meme bloc
       finissent par dependre de la vitesse du reseau. */
    if (!document.querySelector('[data-bh-kpi-haut]')) remonterBande();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(demarrer, 1000); });
  } else {
    setTimeout(demarrer, 1000);
  }
  /* La bande arrive apres son appel reseau : on repasse. */
  setTimeout(demarrer, 2200);
  setTimeout(demarrer, 4000);
  setTimeout(demarrer, 6000);
})();
