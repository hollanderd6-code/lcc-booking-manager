#!/usr/bin/env node
/* ============================================================
   outils/refonte-2b-barre-ids.js
   Lot 2b : les vrais noms de la barre, et un ordre qui ne casse rien
   ============================================================

   ── CE QUE LE RELEVE M'APPREND ───────────────────────────────────
       <div class="mobile-tabs"> display=flex
           div.lg-capsule.lg-visible.lg-animate
           button.tab-btn.active   « Accueil »
           button.tab-btn          « Réservations »
           button.tab-btn          « Messages 0 7 »
           button.tab-btn          « Ménage »
           button.tab-btn          « Plus »

   Deux consequences, et la seconde change mon plan.

   1. Ce sont des <button>, pas des <a>. Poser un href n'aurait rien
      navigue. Le clic doit etre reecrit.

   2. Une capsule glissante, .lg-capsule, se place selon la position du
      bouton actif. Reordonner les boutons dans le DOM la desynchronise :
      elle irait s'allumer sous le mauvais onglet. C'est exactement le
      defaut que vous m'avez signale la premiere fois.

   ── LA DECISION ──────────────────────────────────────────────────
   Je ne reordonne pas. Les cinq onglets gardent leur place, et
   changent de nom et de destination :

       Accueil       -> Aujourd'hui   app.html
       Réservations   -> Calendrier    reservations.html
       Messages      -> Messages      messages.html
       Ménage        -> Logements     settings.html
       Plus          -> Argent        deposits.html

   C'est l'ensemble de la maquette, dans un ordre different : Calendrier
   avant Messages. Je prefere vous livrer une barre juste dans un ordre
   discutable qu'une barre dans le bon ordre avec une capsule qui
   s'allume a cote. L'ordre exact de la maquette demande de toucher a
   mobile-native-experience.js, ou la capsule est calculee — un lot a
   part, une fois celui-ci verifie.

   Aucun onglet n'est masque : cinq places, cinq destinations. « Plus »
   ne disparait pas, il devient « Argent » — et « Mon compte » a deja
   repris ses 21 entrees.

   ── LE MENAGE ────────────────────────────────────────────────────
   Le garde-fou du lot 2 reste : un compte de role menage ne voit sa
   barre ni renommee ni repointee.

   Usage :
     node outils/refonte-2b-barre-ids.js --essai
     node outils/refonte-2b-barre-ids.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'js', 'bh-barre-onglets.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('public/js/bh-barre-onglets.js introuvable. Lancez d\'abord refonte-2-barre-argent.js.');

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('mobile-tabs') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

function remplacer(avant, apres, quoi) {
  if (src.split(avant).length - 1 !== 1) {
    echec('\u00ab ' + quoi + ' \u00bb introuvable (ou present plusieurs fois).');
  }
  src = src.split(avant).join(apres);
}

/* ── 1. La barre visee : l'ordre des boutons existants ───────── */

remplacer(
`  var VISEE = [
    { cle: 'accueil',     libelle: "Aujourd'hui", page: 'app.html' },
    { cle: 'messages',    libelle: 'Messages',    page: 'messages.html' },
    { cle: 'calendrier',  libelle: 'Calendrier',  page: 'reservations.html' },
    { cle: 'logements',   libelle: 'Logements',   page: 'settings.html' },
    { cle: 'argent',      libelle: 'Argent',      page: 'deposits.html' }
  ];`,
`  /* Dans l'ORDRE DES BOUTONS EXISTANTS, pour ne pas desynchroniser la
     capsule glissante .lg-capsule, qui se place selon leur position. */
  var VISEE = [
    { cle: 'accueil',    libelle: "Aujourd'hui", page: 'app.html',          mots: ['accueil', 'dashboard', "aujourd"] },
    { cle: 'calendrier', libelle: 'Calendrier',  page: 'reservations.html', mots: ['réservation', 'reservation', 'calendrier'] },
    { cle: 'messages',   libelle: 'Messages',    page: 'messages.html',     mots: ['message'] },
    { cle: 'logements',  libelle: 'Logements',   page: 'settings.html',     mots: ['ménage', 'menage', 'logement', 'cleaning'] },
    { cle: 'argent',     libelle: 'Argent',      page: 'deposits.html',     mots: ['plus', 'caution', 'argent'] }
  ];`,
  'la liste visee'
);

/* ── 2. Les vrais selecteurs ─────────────────────────────────── */

remplacer(
`    var barres = [];
    ['.bh-tabbar', '#bhTabBar', '[class*="tabbar"]', '[class*="tab-bar"]', '.mobile-nav', '#mobileNav', 'nav[class*="bottom"]']
      .forEach(function (sel) {`,
`    var barres = [];
    ['.mobile-tabs', '.bh-tabbar', '#bhTabBar', '[class*="tabbar"]', '[class*="tab-bar"]', '.mobile-nav', '#mobileNav']
      .forEach(function (sel) {`,
  'la liste des barres'
);

remplacer(
`      var items = barres[b].querySelectorAll('a[href], button, [data-tab], [role="tab"]');
      if (items.length >= 4 && items.length <= 7) {
        return { barre: barres[b], items: Array.prototype.slice.call(items) };
      }`,
`      /* .tab-btn d'abord : cela ecarte d'emblee la capsule .lg-capsule,
         qui n'est pas un onglet mais l'indicateur qui glisse dessous. */
      var items = barres[b].querySelectorAll('.tab-btn');
      if (!items.length) items = barres[b].querySelectorAll('a[href], button, [data-tab], [role="tab"]');
      var vrais = Array.prototype.slice.call(items).filter(function (e) {
        return !/lg-capsule|capsule|indicator/.test(e.className || '');
      });
      if (vrais.length >= 4 && vrais.length <= 7) {
        return { barre: barres[b], items: vrais };
      }`,
  'la lecture des onglets'
);

/* ── 3. L'appariement se fait par mot, dans l'ordre ──────────── */

remplacer(
`      if (!trouve) {
        var mots = { accueil: ['accueil', 'dashboard', 'aujourd'], messages: ['message'],
                     calendrier: ['reservation', 'calendrier', 'calendar'],
                     logements: ['logement', 'settings', 'parametre'],
                     argent: ['caution', 'argent', 'paiement', 'plus'] }[v.cle] || [];
        for (var j = 0; j < libres.length && !trouve; j++) {
          var t = texteDe(libres[j]);
          for (var k = 0; k < mots.length; k++) {
            if (t.indexOf(mots[k]) !== -1) { trouve = libres[j]; break; }
          }
        }
      }`,
`      if (!trouve) {
        var mots = v.mots || [];
        for (var j = 0; j < libres.length && !trouve; j++) {
          var t = texteDe(libres[j]);
          for (var k = 0; k < mots.length; k++) {
            if (t.indexOf(mots[k]) !== -1) { trouve = libres[j]; break; }
          }
        }
      }`,
  'l\'appariement par mot'
);

/* ── 4. Renommage sur, et clic reecrit ──────────────────────── */

remplacer(
`    pris.forEach(function (p) {
      var el = p.el;
      /* Le libelle : le dernier noeud texte non vide, sans toucher aux icones. */
      var cibles = el.querySelectorAll('span, div, small, label');
      var pose = false;
      for (var i = cibles.length - 1; i >= 0; i--) {
        var c = cibles[i];
        if (c.children.length) continue;
        var t = (c.textContent || '').trim();
        if (!t || /^\\d+$/.test(t)) continue;
        c.textContent = p.vise.libelle;
        pose = true;
        break;
      }
      if (!pose && !el.children.length) el.textContent = p.vise.libelle;

      if (el.tagName === 'A') el.setAttribute('href', '/' + p.vise.page);
      el.setAttribute('data-bh-onglet', p.vise.cle);
      etat.renommes.push(p.vise.libelle + ' \\u2192 ' + p.vise.page);
    });`,
`    pris.forEach(function (p) {
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
        if (!t || /^\\d+$/.test(t)) continue;
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
          if (!t2 || /^\\d+$/.test(t2)) continue;
          c2.textContent = p.vise.libelle;
          pose = true;
          break;
        }
      }
      if (!pose && !el.children.length) el.textContent = p.vise.libelle;

      /* Ce sont des <button> : un href ne navigue pas. On reecrit le clic,
         en capture, pour passer devant le gestionnaire d'origine. */
      if (el.tagName === 'A') el.setAttribute('href', '/' + p.vise.page);
      if (!el.__bhClic) {
        el.__bhClic = true;
        var page = p.vise.page;
        el.addEventListener('click', function (ev) {
          var ici = location.pathname.split('/').pop().toLowerCase();
          if (ici === page) return; /* deja sur place : on laisse faire */
          ev.preventDefault();
          ev.stopImmediatePropagation();
          location.href = '/' + page;
        }, true);
      }

      el.setAttribute('data-bh-onglet', p.vise.cle);
      el.setAttribute('aria-label', p.vise.libelle);
      etat.renommes.push(p.vise.libelle + ' \\u2192 ' + p.vise.page);
    });`,
  'le renommage et le repointage'
);

/* ── 5. Aucun onglet masque : cinq places, cinq destinations ── */

remplacer(
`    /* Les onglets restes sans role visé quittent la barre — « Plus » en
       tete, puisque « Mon compte » l'a remplace. */
    libres.forEach(function (el) {
      var t = texteDe(el);
      el.style.setProperty('display', 'none', 'important');
      el.setAttribute('data-bh-retire', '1');
      if (t.indexOf('plus') !== -1) etat.plus_retire = true;
    });

    /* La barre compte cinq colonnes, pas six. */
    try {
      var st = getComputedStyle(lu.barre);
      if (st.display === 'grid') lu.barre.style.setProperty('grid-template-columns', 'repeat(' + pris.length + ', 1fr)', 'important');
    } catch (e) {}`,
`    /* Cinq boutons pour cinq destinations : rien n'est masque, donc la
       capsule glissante garde ses reperes et la barre sa geometrie.
       « Plus » n'est pas retire — il devient « Argent ». */
    etat.plus_retire = pris.some(function (p) { return p.vise.cle === 'argent'; });
    libres.forEach(function (el) {
      el.setAttribute('data-bh-restant', texteDe(el) || '?');
    });`,
  'le masquage des onglets restants'
);

/* ── 6. Le diagnostic dit la verite sur l'ordre ─────────────── */

remplacer(
`      visibles: Array.prototype.slice.call(document.querySelectorAll('[data-bh-onglet]'))
        .map(function (e) { return e.getAttribute('data-bh-onglet'); }),
      caches: document.querySelectorAll('[data-bh-retire]').length`,
`      ordre_reel: Array.prototype.slice.call(document.querySelectorAll('[data-bh-onglet]'))
        .map(function (e) { return e.getAttribute('data-bh-onglet'); }),
      non_apparies: Array.prototype.slice.call(document.querySelectorAll('[data-bh-restant]'))
        .map(function (e) { return e.getAttribute('data-bh-restant'); }),
      note: 'Calendrier est en 2e place, pas en 3e : reordonner desynchroniserait la capsule.'`,
  'le diagnostic'
);

/* ── Verifications ───────────────────────────────────────────── */

[
  ['le selecteur de barre', "'.mobile-tabs'"],
  ['le selecteur d\'onglets', "querySelectorAll('.tab-btn')"],
  ['l\'exclusion de la capsule', 'lg-capsule|capsule|indicator'],
  ['le clic reecrit', "location.href = '/' + page;"],
  ['le renommage par mot attendu', 'if (bas.indexOf(p.vise.mots[k]) !== -1)'],
  ['Menage devient Logements', "mots: ['ménage', 'menage', 'logement', 'cleaning']"],
  ['Plus devient Argent', "mots: ['plus', 'caution', 'argent']"],
].forEach(function (c) {
  if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent apres modification.');
});

/* Le garde-fou menage doit etre intact. */
if (src.indexOf('function estRoleMenage()') === -1 || src.indexOf("etat.raison = 'role menage") === -1) {
  echec('Le garde-fou du role menage a disparu. Refus.');
}
/* Plus aucun masquage d'onglet. */
if (src.indexOf("data-bh-retire") !== -1) echec('Un masquage d\'onglet subsiste. Refus.');

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('mobile-tabs') === -1) {
    echec("La correction n'est pas dans le fichier apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Accueil       -> Aujourd\'hui   app.html');
console.log('  Réservations   -> Calendrier    reservations.html');
console.log('  Messages      -> Messages      messages.html');
console.log('  Ménage        -> Logements     settings.html');
console.log('  Plus          -> Argent        deposits.html');
console.log('\n  Aucun onglet masque : la capsule garde ses reperes.');
console.log('  Calendrier est en 2e place, pas en 3e — l\'ordre exact de la');
console.log('  maquette demande de toucher mobile-native-experience.js.');
console.log('\n  A verifier sur telephone, cache vide :');
console.log('  1. Les cinq onglets portent les nouveaux noms.');
console.log('  2. « Logements » ouvre settings.html, « Argent » deposits.html.');
console.log('  3. Sur chaque page, la capsule s\'allume sous le bon onglet.');
console.log('  4. bhVerifBarre()  — ordre_reel a cinq entrees, non_apparies vide.');
console.log('  5. Avec un compte MENAGE : role_menage: true, barre inchangee.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
