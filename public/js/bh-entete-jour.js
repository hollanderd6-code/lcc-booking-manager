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
    bloc.style.cssText = 'padding:2px 4px 14px;font-family:inherit';
    bloc.innerHTML =
      '<div style="font-size:13.5px;font-weight:500;color:' + GRIS + ';letter-spacing:-.01em">'
      + JOURS[d.getDay()] + ' ' + d.getDate() + ' ' + MOIS[d.getMonth()] + '</div>'
      + '<div style="margin-top:1px;font-size:31px;font-weight:600;letter-spacing:-.03em;color:' + ENCRE + '">'
      + "Aujourd'hui</div>";

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

  window.bhVerifEntete = function () {
    var bande = document.getElementById('bhBandeJours');
    var entete = document.getElementById('bhEnteteJour');
    var res = {
      entete_pose: !!entete,
      bande_presente: !!bande,
      bande_juste_sous_entete: !!(bande && entete && bande.previousElementSibling === entete),
      carte_journee_trouvee: diag.carte_trouvee,
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
