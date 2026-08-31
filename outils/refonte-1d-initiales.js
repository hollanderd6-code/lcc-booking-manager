#!/usr/bin/env node
/* ============================================================
   outils/refonte-1d-initiales.js
   Lot 1d : le rond aux initiales, la porte qui manquait
   ============================================================

   ── CE QUE LE TELEPHONE M'A APPRIS ───────────────────────────────
   Le header est nu : masques 5, introuvables 0. Mais votre relevé des
   sept boutons ne contenait aucun avatar — il n'y en a jamais eu dans
   le header mobile. Le lot 1 cherchait un rond aux initiales qui
   n'existe pas.

   Consequence : « Mon compte » n'est atteignable qu'en tapant
   bhOuvrirMonCompte() dans la console. C'est une porte sans poignee.

   ── CE QUE FAIT CE LOT ───────────────────────────────────────────
   Il pose la poignee : un rond de 40 px aux initiales, a droite de la
   loupe, dans le meme conteneur — donc aligne sans une ligne de CSS de
   positionnement.

   Les initiales sont lues dans l'ordre : un element de nom present dans
   la page, puis le jeton stocke localement, puis l'e-mail. Si rien
   n'est trouve, le rond affiche une silhouette plutot qu'un carre vide
   ou deux points sans sens.

   Le rond porte aria-label « Mon compte » et fait 44 px de zone
   tactile, minimum vital sur telephone.

   Usage :
     node outils/refonte-1d-initiales.js --essai
     node outils/refonte-1d-initiales.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(process.cwd(), 'public');
const MODULE = path.join(PUBLIC, 'js', 'bh-initiales.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const PAGES = ['app.html', 'messages.html', 'reservations.html', 'settings.html', 'deposits.html', 'factures.html', 'cleaning.html'];

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(PUBLIC)) echec('Dossier public/ introuvable.');
if (!fs.existsSync(path.join(PUBLIC, 'js', 'bh-mon-compte.js'))) {
  echec('bh-mon-compte.js absent. Lancez d\'abord refonte-1-mon-compte.js.');
}

const SOURCE = `/* ============================================================
   bh-initiales.js — le rond aux initiales dans le header mobile
   ============================================================
   Il n'existait pas : le header mobile n'avait que le logo, cinq
   commandes et la loupe. Ce module pose le rond a droite de la loupe,
   dans son conteneur, et lui donne un seul role : ouvrir « Mon compte ».
   ============================================================ */
(function () {
  'use strict';

  if (window.__bhInitiales) return;
  window.__bhInitiales = true;

  var VERT = '#0E3B2E';

  function lireIdentite() {
    var nom = '';
    ['#userName', '#profileName', '#currentUserName', '[data-user-name]', '.user-name', '#userFullName']
      .forEach(function (sel) {
        if (nom) return;
        try {
          var el = document.querySelector(sel);
          if (el) nom = (el.textContent || '').replace(/\\s+/g, ' ').trim();
        } catch (e) {}
      });

    if (!nom) {
      ['lcc_user', 'bh_user', 'user', 'currentUser'].forEach(function (cle) {
        if (nom) return;
        try {
          var brut = localStorage.getItem(cle);
          if (!brut) return;
          var o = JSON.parse(brut);
          nom = o.name || o.full_name || o.fullName || o.first_name || o.email || '';
        } catch (e) {}
      });
    }

    if (!nom) {
      /* Le jeton porte souvent l'e-mail. On ne dechiffre rien : on lit
         la charge utile, publique par construction. */
      try {
        var t = localStorage.getItem('lcc_token') || localStorage.getItem('token') || '';
        var p = t.split('.')[1];
        if (p) {
          var o2 = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));
          nom = o2.name || o2.email || '';
        }
      } catch (e) {}
    }

    if (!nom) return { nom: 'Mon compte', initiales: null };

    var propre = nom.indexOf('@') !== -1 ? nom.split('@')[0].replace(/[._-]+/g, ' ') : nom;
    var mots = propre.replace(/[^\\p{L}\\s]/gu, ' ').trim().split(/\\s+/).filter(Boolean);
    var init = ((mots[0] || '').charAt(0) + (mots[1] || '').charAt(0)).toUpperCase();
    return { nom: nom, initiales: init || (mots[0] || '').charAt(0).toUpperCase() || null };
  }

  /* Une silhouette, plutot qu'un rond vide, quand le nom est inconnu. */
  var SILHOUETTE = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">'
    + '<circle cx="12" cy="8" r="3.6" stroke="' + VERT + '" stroke-width="1.7"/>'
    + '<path d="M5.5 19.5c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" stroke="' + VERT + '" stroke-width="1.7" stroke-linecap="round"/></svg>';

  function poser() {
    if (document.getElementById('bhAvatarHeader')) return true;

    var loupe = document.querySelector('.bhgs-trigger-mobile');
    var hote = loupe ? loupe.parentElement : null;
    if (!hote) {
      /* Repli : le conteneur de droite du header mobile. */
      var notif = document.getElementById('bh-mobile-notif-btn');
      hote = notif ? notif.parentElement : null;
    }
    if (!hote) return false;

    var moi = lireIdentite();

    var rond = document.createElement('button');
    rond.id = 'bhAvatarHeader';
    rond.type = 'button';
    rond.setAttribute('aria-label', 'Mon compte');
    rond.title = moi.nom;
    rond.style.cssText = 'flex:none;width:40px;height:40px;min-width:40px;padding:0;margin-left:8px'
      + ';border:0;border-radius:50%;background:#DCE8E1;color:' + VERT
      + ';font:inherit;font-size:13px;font-weight:600;letter-spacing:.02em'
      + ';display:inline-flex;align-items:center;justify-content:center;cursor:pointer'
      + ';-webkit-tap-highlight-color:transparent';

    if (moi.initiales) rond.textContent = moi.initiales;
    else rond.innerHTML = SILHOUETTE;

    /* Zone tactile de 44 px sans grossir le rond. */
    rond.style.setProperty('position', 'relative');
    var zone = document.createElement('span');
    zone.setAttribute('aria-hidden', 'true');
    zone.style.cssText = 'position:absolute;inset:-2px;border-radius:50%';
    rond.appendChild(zone);

    rond.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof window.bhOuvrirMonCompte === 'function') window.bhOuvrirMonCompte();
      else console.warn('bh-mon-compte.js non charge sur cette page.');
    });

    if (loupe && loupe.nextSibling) hote.insertBefore(rond, loupe.nextSibling);
    else hote.appendChild(rond);

    /* Le nom peut arriver apres nous (chargement du profil). */
    if (!moi.initiales) {
      setTimeout(function () {
        var tard = lireIdentite();
        if (tard.initiales) { rond.textContent = tard.initiales; rond.title = tard.nom; }
      }, 2500);
    }
    return true;
  }

  window.bhVerifInitiales = function () {
    var rond = document.getElementById('bhAvatarHeader');
    var res = {
      rond_pose: !!rond,
      affiche: rond ? (rond.textContent.trim() || 'silhouette') : null,
      identite: lireIdentite(),
      loupe_trouvee: !!document.querySelector('.bhgs-trigger-mobile'),
      mon_compte_disponible: typeof window.bhOuvrirMonCompte === 'function'
    };
    console.log('── Rond aux initiales ──');
    console.log(res);
    if (!res.rond_pose) console.warn('Le rond n\\'est pas pose : conteneur du header introuvable.');
    if (!res.mon_compte_disponible) console.warn('bh-mon-compte.js absent : le rond ne pourrait rien ouvrir.');
    return res;
  };

  function demarrer() { poser(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(demarrer, 500); });
  } else {
    setTimeout(demarrer, 500);
  }
  setTimeout(demarrer, 1700);
  setTimeout(demarrer, 3400);
})();
`;

const BALISE = '<script src="js/bh-initiales.js"></script>';
const rapport = [];

PAGES.forEach(function (nom) {
  const chemin = path.join(PUBLIC, nom);
  if (!fs.existsSync(chemin)) { rapport.push([nom, 'absente']); return; }

  let html = fs.readFileSync(chemin, 'utf8');
  if (html.indexOf('bh-initiales.js') !== -1) { rapport.push([nom, 'deja']); return; }

  const ancre = html.indexOf('bh-mon-compte.js');
  if (ancre === -1) { rapport.push([nom, 'sans bh-mon-compte — ignoree']); return; }
  const fin = html.indexOf('</script>', ancre);
  if (fin === -1) { rapport.push([nom, 'balise mal formee — ignoree']); return; }

  const pos = fin + '</script>'.length;
  html = html.slice(0, pos) + '\n' + BALISE + html.slice(pos);
  rapport.push([nom, 'apres bh-mon-compte.js']);

  if (!ESSAI) fs.writeFileSync(chemin, html, 'utf8');
});

if (!ESSAI) {
  fs.writeFileSync(MODULE, SOURCE, 'utf8');
  if (fs.readFileSync(MODULE, 'utf8').indexOf('bhVerifInitiales') === -1) {
    echec("Le module n'est pas complet apres ecriture.");
  }
}

const posees = rapport.filter(function (r) { return r[1].indexOf('apres') === 0; }).length;
if (posees === 0 && !ESSAI) echec("Aucune page n'a recu le module.");

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  public/js/bh-initiales.js  (' + Math.round(SOURCE.length / 1024) + ' Ko)');
rapport.forEach(function (r) { console.log('  ' + (r[0] + '                    ').slice(0, 20) + r[1]); });
console.log('\n  Le rond se pose a droite de .bhgs-trigger-mobile, dans son conteneur.');
console.log('  Nom inconnu : une silhouette, pas un rond vide.');
console.log('\n  A verifier sur telephone : /app.html — un rond vert clair a droite');
console.log('  de la loupe. Touchez-le : « Mon compte » doit monter.');
console.log('  Puis :  bhVerifInitiales()\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
