#!/usr/bin/env node
/* ============================================================
   outils/refonte-1b-header.js
   Lot 1b : le header n'a plus que le titre, la loupe et les initiales
   ============================================================

   ── L'ETAT ACTUEL ────────────────────────────────────────────────
   Six commandes se disputent la barre du haut :

       deux pastilles d'etat serveur     ·  info     ·  agence
       actualiser                        ·  cloche 9 ·  loupe

   Six cibles de 44 px sur 390 px de large, sans un mot pour dire ce
   qu'elles font. Aucune n'est urgente. Trois ne servent qu'une fois par
   mois. Et « actualiser » ne devrait pas exister : une page qui a besoin
   d'un bouton pour se remettre a jour a un defaut ailleurs.

   ── CE QUE FAIT LE LOT ───────────────────────────────────────────
   Il ne SUPPRIME rien du code. Il masque les boutons dans le header et
   les rend au doigt depuis « Mon compte », avec un libelle en francais :

       Etat des serveurs        les deux pastilles, lues et traduites
       Notifications            la cloche, avec son compteur
       Mode agence              le bouton violet
       Aide et informations     le point d'interrogation
       Actualiser               retire, purement et simplement

   Restent dans le header : la date, le titre, la loupe, les initiales.
   Deux cibles au lieu de six.

   ── POURQUOI CE N'EST PAS DESTRUCTIF ─────────────────────────────
   Les boutons d'origine restent dans le DOM, simplement invisibles. Les
   lignes de « Mon compte » declenchent leur clic reel — aucune logique
   n'est reecrite, donc rien ne peut divergerdu comportement actuel.
   Si une ligne manque a l'appel, son bouton est toujours la : il suffit
   de retirer une ligne du fichier pour revenir en arriere.

   Ce lot suppose refonte-1-mon-compte.js deja deploye.

   Usage :
     node outils/refonte-1b-header.js --essai
     node outils/refonte-1b-header.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = process.cwd();
const PUBLIC = path.join(RACINE, 'public');
const MODULE = path.join(PUBLIC, 'js', 'bh-header-epure.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const PAGES = ['app.html', 'messages.html', 'reservations.html', 'settings.html', 'deposits.html', 'factures.html', 'cleaning.html'];

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(PUBLIC)) echec('Dossier public/ introuvable. Lancez depuis la racine du projet.');
if (!fs.existsSync(path.join(PUBLIC, 'js', 'bh-mon-compte.js'))) {
  echec('public/js/bh-mon-compte.js absent. Lancez d\'abord refonte-1-mon-compte.js.');
}

const SOURCE = `/* ============================================================
   bh-header-epure.js — le header se tait, « Mon compte » parle
   ============================================================
   Masque les commandes secondaires du header et les rend accessibles
   dans la feuille « Mon compte », nommees en francais.

   Rien n'est supprime du DOM : chaque ligne declenche le clic du vrai
   bouton, toujours present mais invisible. Aucune logique dupliquee.
   ============================================================ */
(function () {
  'use strict';

  if (window.__bhHeaderEpure) return;
  window.__bhHeaderEpure = true;

  var ENCRE = '#0D1117';
  var GRIS = '#7A8695';
  var BORD = '#F0EEE7';

  /* ── Ce qui reste visible dans le header ─────────────────────── */
  var GARDES = ['search', 'loupe', 'recherche', 'avatar', 'initial', 'profil', 'logo', 'brand', 'boostinghost'];

  /* ── Ce qu'on deplace, dans l'ordre d'affichage ──────────────── */
  var DEPLACES = [
    {
      cle: 'serveurs',
      titre: 'Etat des serveurs',
      selecteurs: ['#serverStatus', '#statusDots', '.server-status', '[data-server-status]', '#healthDots', '.status-dot'],
      valeur: function (el) {
        /* Les pastilles disent vert ou rouge. On le dit en mots. */
        var dots = el.querySelectorAll ? el.querySelectorAll('span,i,div') : [];
        var rouge = 0, total = 0;
        for (var i = 0; i < dots.length; i++) {
          var c = getComputedStyle(dots[i]).backgroundColor || '';
          var m = c.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
          if (!m) continue;
          var r = +m[1], v = +m[2], b = +m[3];
          if (r + v + b < 40) continue;
          total++;
          if (r > v + 40) rouge++;
        }
        if (!total) return { texte: 'Voir', ton: 'neutre' };
        if (rouge) return { texte: rouge + ' en alerte', ton: 'alerte' };
        return { texte: 'Tout va bien', ton: 'bon' };
      }
    },
    {
      cle: 'notifications',
      titre: 'Notifications',
      selecteurs: ['#notifBtn', '#notificationsBtn', '.notif-btn', '[data-notifications]', '#bellBtn', '.notification-bell'],
      valeur: function (el) {
        var badge = el.querySelector ? el.querySelector('.badge, .notif-count, sup, [data-count]') : null;
        var n = badge ? parseInt((badge.textContent || '').replace(/\\D/g, ''), 10) : 0;
        if (n > 0) return { texte: n + ' non lue' + (n > 1 ? 's' : ''), ton: 'alerte' };
        return { texte: 'A jour', ton: 'neutre' };
      }
    },
    {
      cle: 'agence',
      titre: 'Mode agence',
      selecteurs: ['#agencyBtn', '#agenceBtn', '[data-agency]', '.agency-btn', '#switchAgency'],
      valeur: function () { return { texte: '', ton: 'neutre' }; }
    },
    {
      cle: 'info',
      titre: 'Aide et informations',
      selecteurs: ['#infoBtn', '#helpBtn', '[data-info]', '.info-btn', '#aideBtn'],
      valeur: function () { return { texte: '', ton: 'neutre' }; }
    }
  ];

  /* ── « Actualiser » : retire, pas deplace ────────────────────── */
  var ACTUALISER = ['#refreshBtn', '#reloadBtn', '[data-refresh]', '.refresh-btn', '#actualiserBtn', '[onclick*="location.reload"]'];

  function chercher(selecteurs) {
    for (var i = 0; i < selecteurs.length; i++) {
      try {
        var el = document.querySelector(selecteurs[i]);
        if (el) {
          /* On remonte au bouton cliquable si on a attrape une pastille. */
          var cible = el.closest ? (el.closest('button,a,[role="button"]') || el) : el;
          return cible;
        }
      } catch (e) {}
    }
    return null;
  }

  var trouves = {};
  var masques = [];

  function masquer() {
    DEPLACES.forEach(function (d) {
      var el = chercher(d.selecteurs);
      if (!el) return;
      trouves[d.cle] = el;
      if (el.dataset.bhMasque) return;
      el.dataset.bhMasque = '1';
      el.style.setProperty('display', 'none', 'important');
      masques.push(d.cle);
    });

    ACTUALISER.forEach(function (sel) {
      try {
        var els = document.querySelectorAll(sel);
        for (var i = 0; i < els.length; i++) {
          var e = els[i];
          var t = (e.id || '') + ' ' + (e.className || '');
          if (GARDES.some(function (g) { return t.toLowerCase().indexOf(g) !== -1; })) continue;
          if (e.dataset.bhMasque) continue;
          e.dataset.bhMasque = '1';
          e.style.setProperty('display', 'none', 'important');
          if (masques.indexOf('actualiser') === -1) masques.push('actualiser');
        }
      } catch (e) {}
    });
    return masques.length;
  }

  /* ── Les lignes ajoutees dans « Mon compte » ─────────────────── */
  function poserLignes() {
    var feuille = document.getElementById('bhMonCompte');
    if (!feuille) return 0;
    var corps = feuille.children[1];
    if (!corps) return 0;
    var ancien = feuille.querySelector('[data-bh-header-bloc]');
    if (ancien) ancien.remove();

    var lignes = DEPLACES.filter(function (d) { return trouves[d.cle]; });
    if (!lignes.length) return 0;

    var enveloppe = document.createElement('div');
    enveloppe.setAttribute('data-bh-header-bloc', '1');

    var titre = document.createElement('div');
    titre.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:.13em;color:#8B8B84;padding:6px 4px 9px';
    titre.textContent = 'L\\u2019APPLICATION';
    enveloppe.appendChild(titre);

    var bloc = document.createElement('div');
    bloc.style.cssText = 'background:#fff;border-radius:18px;overflow:hidden;margin-bottom:16px';

    lignes.forEach(function (d, i) {
      if (i) {
        var trait = document.createElement('div');
        trait.style.cssText = 'height:1px;background:' + BORD + ';margin:0 16px';
        bloc.appendChild(trait);
      }
      var v = { texte: '', ton: 'neutre' };
      try { v = d.valeur(trouves[d.cle]) || v; } catch (e) {}
      var couleur = v.ton === 'alerte' ? '#A8452A' : v.ton === 'bon' ? '#0E3B2E' : GRIS;

      var ligne = document.createElement('div');
      ligne.style.cssText = 'display:flex;align-items:center;gap:10px;padding:15px 16px;min-height:44px;cursor:pointer';
      ligne.innerHTML = '<span style="flex:1;font-size:15.5px;color:' + ENCRE + '">' + d.titre + '</span>'
        + (v.texte ? '<span style="flex:none;font-size:13.5px;font-weight:600;color:' + couleur + '">' + v.texte + '</span>' : '')
        + '<span style="flex:none;color:#C4C0B6;font-size:18px;line-height:1">\\u203A</span>';
      ligne.addEventListener('click', function () {
        var cible = trouves[d.cle];
        if (!cible) return;
        /* Le bouton est masque : on le montre le temps du clic, sinon
           certaines librairies refusent d'agir sur un element invisible. */
        var avant = cible.style.display;
        cible.style.removeProperty('display');
        if (window.bhFermerMonCompte) window.bhFermerMonCompte();
        setTimeout(function () {
          try { cible.click(); } catch (e) {}
          setTimeout(function () { cible.style.setProperty('display', 'none', 'important'); }, 50);
        }, 260);
      });
      bloc.appendChild(ligne);
    });

    enveloppe.appendChild(bloc);
    /* Juste apres la carte d'identite, avant les familles de liens. */
    if (corps.children.length > 1) corps.insertBefore(enveloppe, corps.children[1]);
    else corps.appendChild(enveloppe);
    return lignes.length;
  }

  /* ── On s'accroche a l'ouverture de la feuille ───────────────── */
  function accrocher() {
    if (typeof window.bhOuvrirMonCompte !== 'function') return false;
    if (window.bhOuvrirMonCompte.__bhEnveloppe) return true;
    var origine = window.bhOuvrirMonCompte;
    var enveloppe = function () {
      var r = origine.apply(this, arguments);
      setTimeout(poserLignes, 30);
      return r;
    };
    enveloppe.__bhEnveloppe = true;
    window.bhOuvrirMonCompte = enveloppe;
    return true;
  }

  window.bhVerifHeader = function () {
    var res = {
      masques: masques.slice(),
      actualiser_retire: masques.indexOf('actualiser') !== -1,
      deplaces_trouves: Object.keys(trouves),
      deplaces_introuvables: DEPLACES.filter(function (d) { return !trouves[d.cle]; }).map(function (d) { return d.cle; }),
      accroche_a_mon_compte: typeof window.bhOuvrirMonCompte === 'function' && !!window.bhOuvrirMonCompte.__bhEnveloppe
    };
    console.log('── Header epure ──');
    console.log(res);
    if (res.deplaces_introuvables.length) {
      console.warn('Introuvables sur cette page : ' + res.deplaces_introuvables.join(', ')
        + ' — leurs boutons restent visibles dans le header. Donnez-moi leur id.');
    }
    return res;
  };

  function demarrer() {
    masquer();
    accrocher();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(demarrer, 450); });
  } else {
    setTimeout(demarrer, 450);
  }
  setTimeout(demarrer, 1600);
  setTimeout(demarrer, 3200);
})();
`;

const BALISE = '<script src="js/bh-header-epure.js"></script>';
const rapport = [];

PAGES.forEach(function (nom) {
  const chemin = path.join(PUBLIC, nom);
  if (!fs.existsSync(chemin)) { rapport.push([nom, 'absente']); return; }

  let html = fs.readFileSync(chemin, 'utf8');
  if (html.indexOf('bh-header-epure.js') !== -1) { rapport.push([nom, 'deja']); return; }

  /* Toujours APRES bh-mon-compte.js : on enveloppe sa fonction. */
  const ancre = html.indexOf('bh-mon-compte.js');
  if (ancre === -1) { rapport.push([nom, 'sans bh-mon-compte — ignoree']); return; }
  const finBalise = html.indexOf('</script>', ancre);
  if (finBalise === -1) { rapport.push([nom, 'balise mal formee — ignoree']); return; }

  const pos = finBalise + '</script>'.length;
  html = html.slice(0, pos) + '\n' + BALISE + html.slice(pos);
  rapport.push([nom, 'apres bh-mon-compte.js']);

  if (!ESSAI) fs.writeFileSync(chemin, html, 'utf8');
});

if (!ESSAI) {
  fs.writeFileSync(MODULE, SOURCE, 'utf8');
  if (fs.readFileSync(MODULE, 'utf8').indexOf('bhVerifHeader') === -1) {
    echec("Le module n'est pas complet apres ecriture.");
  }
}

const posees = rapport.filter(function (r) { return r[1].indexOf('apres') === 0; }).length;
if (posees === 0 && !ESSAI) echec("Aucune page n'a recu le module.");

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  public/js/bh-header-epure.js  (' + Math.round(SOURCE.length / 1024) + ' Ko)');
rapport.forEach(function (r) { console.log('  ' + (r[0] + '                    ').slice(0, 20) + r[1]); });
console.log('\n  Header : date, titre, loupe, initiales. Deux cibles au lieu de six.');
console.log('  Deplaces dans Mon compte : etat serveurs, notifications, agence, info.');
console.log('  Retire : actualiser.');
console.log('\n  A verifier sur telephone : /app.html — le header doit etre nu.');
console.log('  Ouvrez le rond aux initiales : un bloc « L\\u2019APPLICATION » apparait');
console.log('  sous votre nom, avec « Notifications · 9 non lues ».');
console.log('  Puis :  bhVerifHeader()');
console.log('  Si « deplaces_introuvables » n\'est pas vide, donnez-moi les id');
console.log('  manquants — leurs boutons seront restes visibles dans le header.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
