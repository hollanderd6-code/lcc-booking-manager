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

  /* La loupe et le rond sont DEPLACES, pas copies : leurs ecouteurs
     restent attaches, donc la recherche et « Mon compte » fonctionnent
     sans qu'une ligne de leur logique soit reecrite. */
  function deplacerCommandes() {
    var droite = document.getElementById('bhEnteteCommandes');
    if (!droite) return false;

    var loupe = document.querySelector('.bhgs-trigger-mobile');
    var rond = document.getElementById('bhAvatarHeader');
    if (!loupe && !rond) { diag.raison = 'ni loupe ni rond trouves'; return false; }

    if (loupe && loupe.parentElement !== droite) {
      loupe.style.setProperty('margin', '0', 'important');
      loupe.style.setProperty('flex', 'none', 'important');
      droite.appendChild(loupe);
      diag.loupe = true;
    }
    if (rond && rond.parentElement !== droite) {
      rond.style.setProperty('margin', '0', 'important');
      droite.appendChild(rond);
      diag.rond = true;
    }

    /* La barre beige n'est masquee que si les deux commandes ont bien
       trouve leur nouvelle place. Deux etages valent mieux qu'une
       application sans recherche ni acces au compte. */
    if (loupe && rond && loupe.parentElement === droite && rond.parentElement === droite) {
      var barre = loupe.closest('header, .mobile-header, [class*="header"]');
      if (barre && !barre.dataset.bhMasquee) {
        /* On ne masque pas un conteneur qui porte encore autre chose de
           visible et cliquable — un bouton que je n'aurais pas vu. */
        var restants = barre.querySelectorAll('button:not([data-bh-masque]), a[href]:not(.mobile-logo)');
        var vivants = 0;
        for (var i = 0; i < restants.length; i++) {
          var e = restants[i];
          if (e === loupe || e === rond) continue;
          if (droite.contains(e)) continue;
          if (getComputedStyle(e).display === 'none') continue;
          vivants++;
        }
        if (vivants === 0) {
          barre.style.setProperty('display', 'none', 'important');
          barre.dataset.bhMasquee = '1';
          diag.barre_masquee = true;
        } else {
          diag.raison = vivants + ' bouton(s) encore vivant(s) dans la barre — non masquee';
        }
      }
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
    remonterBande();
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
