#!/usr/bin/env node
/* ============================================================
   outils/refonte-10b-allege-precis.js
   Lot 10b : viser les identifiants, pas les alentours
   ============================================================

   ── CE QUI S'EST PASSE ───────────────────────────────────────────
   Le lot 10 remontait de l'intitule jusqu'au bloc de premier niveau.
   Pour « Votre journee », ce bloc portait aussi les quatre cartes kpi* :
   en masquant le titre, j'ai masque les compteurs. C'est exactement ce
   que le garde-fou etait cense empecher, et il ne l'a pas vu parce que
   ces cartes n'etaient pas dans ma liste de cibles.

   Et CA mensuel et Occupation partagent un meme bloc : chacun a donc
   refuse de partir en accusant l'autre. Huit refus pour une situation
   parfaitement normale — les deux s'en vont ensemble, au meme endroit.

   ── CE QUE FAIT CE LOT ───────────────────────────────────────────
   Votre inventaire a donne les identifiants reels. On ne remonte plus a
   l'aveugle :

       #bh2TodayDate        la date, et le titre « Votre journee »
       #bhCalRoot           le calendrier des reservations, en entier
       #kpiAutoLabel        la carte Automatisation
       CA + Occupation      leur bloc commun, assume comme tel

   Rien ne peut plus emporter un voisin : avant de masquer quoi que ce
   soit, le module verifie que la zone visee ne contient AUCUN de ces
   noeuds proteges —

       #bhEnteteJour, #bhBandeJours, #bhListeUnifiee, #bhListesJour,
       toute carte dont l'identifiant commence par « kpi » et qui n'est
       pas la cible.

   Si la verification echoue, rien n'est masque et bhVerifAllege() nomme
   le noeud qui a bloque.

   ── SUR LES COMPTEURS ────────────────────────────────────────────
   Les quatre cartes kpi* de « Votre journee » restent en place. Deux
   d'entre elles portent encore des zeros — « Tout est valide 0 »,
   « Notes sur reservations 0 ». Elles meritent leur propre decision,
   pas d'etre emportees par un titre.

   ── REMPLACE LE LOT 10 ───────────────────────────────────────────
   Meme fichier, meme balise : rien a retirer de app.html. Si le lot 10
   tourne encore dans un onglet ouvert, bhAnnulerAllege() puis un
   rechargement suffisent.

   Usage :
     node outils/refonte-10b-allege-precis.js --essai
     node outils/refonte-10b-allege-precis.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(process.cwd(), 'public');
const APP = path.join(PUBLIC, 'app.html');
const MODULE = path.join(PUBLIC, 'js', 'bh-aujourdhui-allege.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(APP)) echec('public/app.html introuvable. Lancez depuis la racine du projet.');

const SOURCE = `/* ============================================================
   bh-aujourdhui-allege.js — quatre departs, vises a l'identifiant
   ============================================================
   La date et le titre « Votre journee », le bloc CA mensuel +
   Occupation, la carte Automatisation, le calendrier des reservations.

   Les quatre cartes kpi* restent : elles ne font pas partie du voyage.
   Avant chaque masquage, la zone visee est verifiee — si elle contient
   un noeud protege, rien ne bouge et le module le dit.
   ============================================================ */
(function () {
  'use strict';

  if (window.__bhAujourdhuiAllege) return;
  window.__bhAujourdhuiAllege = true;

  var mem = [];
  var diag = { masques: [], refuses: [], introuvables: [], details: {} };

  function normaliser(t) {
    return String(t || '').replace(/\\s+/g, ' ').trim().toUpperCase();
  }

  /* Ce qui ne doit jamais partir dans un masquage. */
  function proteges(sauf) {
    var out = [];
    ['bhEnteteJour', 'bhBandeJours', 'bhListeUnifiee', 'bhListesJour', 'bhChiffresFond'].forEach(function (id) {
      var e = document.getElementById(id);
      if (e && id !== sauf) out.push(e);
    });
    var kpis = document.querySelectorAll('[id^="kpi"]');
    for (var i = 0; i < kpis.length; i++) {
      if (kpis[i].id !== sauf) out.push(kpis[i]);
    }
    var ops = document.querySelector('[data-bh-kpi-haut]');
    if (ops) out.push(ops);
    return out;
  }

  function estSur(zone, sauf) {
    var liste = proteges(sauf);
    for (var i = 0; i < liste.length; i++) {
      if (zone.contains(liste[i])) return liste[i].id || liste[i].className || 'noeud protege';
    }
    return null;
  }

  function cacher(cle, zone, sauf) {
    if (!zone) { if (diag.introuvables.indexOf(cle) === -1) diag.introuvables.push(cle); return false; }
    var bloqueur = estSur(zone, sauf);
    if (bloqueur) {
      var msg = cle + ' : contient ' + bloqueur + ' — rien masque';
      if (diag.refuses.indexOf(msg) === -1) diag.refuses.push(msg);
      return false;
    }
    mem.push({ el: zone, valeur: zone.style.getPropertyValue('display'), priorite: zone.style.getPropertyPriority('display') });
    zone.style.setProperty('display', 'none', 'important');
    if (diag.masques.indexOf(cle) === -1) diag.masques.push(cle);
    diag.details[cle] = (zone.id ? '#' + zone.id : zone.tagName.toLowerCase())
      + ' \\u00b7 ' + normaliser(zone.textContent).slice(0, 44);
    return true;
  }

  function feuille(motif) {
    var noeuds = document.querySelectorAll('div, span, p, h1, h2, h3, h4, h5, h6, label, strong');
    for (var i = 0; i < noeuds.length; i++) {
      var n = noeuds[i];
      if (n.children.length > 2) continue;
      var t = normaliser(n.textContent);
      if (t.length > 70) continue;
      if (t.indexOf(motif) === 0) return n;
    }
    return null;
  }

  /* La carte qui porte un noeud : le premier ancetre assez grand, tant
     qu'il ne touche a rien de protege. */
  function carteDe(el, sauf) {
    var c = el;
    var garde = 0;
    while (c && c.parentElement && c !== document.body && garde++ < 8) {
      var r = c.getBoundingClientRect();
      if (r.height >= 70 && r.width >= 140) {
        if (!estSur(c, sauf)) return c;
        return null;
      }
      c = c.parentElement;
    }
    return null;
  }

  /* ── 1. Le titre et la date ────────────────────────────────── */
  function titreEtDate() {
    if (diag.masques.indexOf('titre_journee') !== -1) return;
    var date = document.getElementById('bh2TodayDate');
    var titre = feuille('VOTRE JOURN');
    if (!date && !titre) { if (diag.introuvables.indexOf('titre_journee') === -1) diag.introuvables.push('titre_journee'); return; }

    /* Une carte commune au titre et a la date, si elle ne porte rien
       d'autre. Sinon les deux noeuds, un par un. */
    if (date && titre) {
      var c = titre.parentElement;
      var garde = 0;
      while (c && garde++ < 6 && !c.contains(date)) c = c.parentElement;
      if (c && c !== document.body && !estSur(c, 'bh2TodayDate') && normaliser(c.textContent).length < 60) {
        if (cacher('titre_journee', c, 'bh2TodayDate')) return;
      }
    }
    var fait = 0;
    [titre, date].forEach(function (n, i) {
      if (!n) return;
      mem.push({ el: n, valeur: n.style.getPropertyValue('display'), priorite: n.style.getPropertyPriority('display') });
      n.style.setProperty('display', 'none', 'important');
      fait++;
    });
    if (fait) {
      diag.masques.push('titre_journee');
      diag.details.titre_journee = fait + ' noeud(s) : titre et date, masques separement';
    }
  }

  /* ── 2. CA mensuel + Occupation, ensemble ──────────────────── */
  function bilansDuMois() {
    if (diag.masques.indexOf('bilans_du_mois') !== -1) return;
    var ca = feuille('CA MENSUEL');
    var occ = feuille('OCCUPATION DU MOIS');
    if (!ca && !occ) { if (diag.introuvables.indexOf('bilans_du_mois') === -1) diag.introuvables.push('bilans_du_mois'); return; }

    /* Les deux partent au meme endroit : leur bloc commun est la bonne
       unite, a condition qu'il ne porte rien d'autre. */
    if (ca && occ) {
      var c = ca.parentElement;
      var garde = 0;
      while (c && garde++ < 8 && !c.contains(occ)) c = c.parentElement;
      if (c && c !== document.body && cacher('bilans_du_mois', c, null)) return;
    }
    var fait = 0;
    [['ca_mensuel', ca], ['occupation', occ]].forEach(function (p) {
      if (!p[1]) return;
      if (cacher(p[0], carteDe(p[1], null), null)) fait++;
    });
    if (fait === 2) diag.masques.push('bilans_du_mois');
  }

  /* ── 3. L'automatisation ───────────────────────────────────── */
  function automatisation() {
    if (diag.masques.indexOf('automatisation') !== -1) return;
    var l = document.getElementById('kpiAutoLabel') || feuille('AUTOMATISATION');
    if (!l) { if (diag.introuvables.indexOf('automatisation') === -1) diag.introuvables.push('automatisation'); return; }
    cacher('automatisation', carteDe(l, 'kpiAutoLabel'), 'kpiAutoLabel');
  }

  /* ── 4. Le calendrier des reservations ─────────────────────── */
  function calendrier() {
    if (diag.masques.indexOf('calendrier') !== -1) return;
    var r = document.getElementById('bhCalRoot');
    if (!r) { if (diag.introuvables.indexOf('calendrier') === -1) diag.introuvables.push('calendrier'); return; }
    cacher('calendrier', r, 'bhCalRoot');
  }

  function passer() {
    if (!document.getElementById('bhEnteteJour') && !document.getElementById('bhBandeJours')) return;
    titreEtDate();
    bilansDuMois();
    automatisation();
    calendrier();
  }

  window.bhAnnulerAllege = function () {
    for (var i = mem.length - 1; i >= 0; i--) {
      var m = mem[i];
      if (m.valeur) m.el.style.setProperty('display', m.valeur, m.priorite);
      else m.el.style.removeProperty('display');
    }
    var n = mem.length;
    mem = [];
    diag.masques = [];
    diag.details = {};
    console.log(n + ' element(s) rendu(s) a Aujourd\\'hui.');
    return n;
  };

  window.bhVerifAllege = function () {
    var res = {
      masques: diag.masques,
      details: diag.details,
      refuses: diag.refuses,
      introuvables: diag.introuvables,
      compteurs_intacts: !!document.querySelector('[id^="kpi"]'),
      entete_intact: !!document.getElementById('bhEnteteJour'),
      bande_intacte: !!document.getElementById('bhBandeJours'),
      liste_intacte: !!document.getElementById('bhListeUnifiee'),
      annulable: mem.length + ' element(s) memorise(s)'
    };
    console.log('── Aujourd\\'hui allege ──');
    console.log(res);
    if (diag.refuses.length) console.warn('Refus : ' + diag.refuses.join(' | '));
    if (diag.introuvables.length) console.warn('Non trouves : ' + diag.introuvables.join(', '));
    console.log('Pour revenir en arriere : bhAnnulerAllege()');
    return res;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(passer, 2000); });
  } else {
    setTimeout(passer, 2000);
  }
  setTimeout(passer, 3800);
  setTimeout(passer, 6400);
  setTimeout(passer, 9000);
})();
`;

const BALISE = '<script src="js/bh-aujourdhui-allege.js"></script>';

let html = fs.readFileSync(APP, 'utf8');
let etatApp;

if (html.indexOf('bh-aujourdhui-allege.js') !== -1) {
  etatApp = 'balise deja en place (lot 10)';
} else {
  let ancre = html.indexOf('bh-liste-unifiee.js');
  let nom = 'bh-liste-unifiee.js';
  if (ancre === -1) { ancre = html.indexOf('bh-listes-jour.js'); nom = 'bh-listes-jour.js'; }
  if (ancre === -1) echec('Aucun module des lots precedents dans app.html.');
  const fin = html.indexOf('</script>', ancre);
  if (fin === -1) echec('Balise mal formee dans app.html.');
  const pos = fin + '</script>'.length;
  html = html.slice(0, pos) + '\n' + BALISE + html.slice(pos);
  etatApp = 'balise ajoutee apres ' + nom;
  if (!ESSAI) fs.writeFileSync(APP, html, 'utf8');
}

if (!ESSAI) {
  fs.writeFileSync(MODULE, SOURCE, 'utf8');
  const relu = fs.readFileSync(MODULE, 'utf8');
  if (relu.indexOf('bhAnnulerAllege') === -1) echec("Le module n'est pas complet apres ecriture.");
  if (relu.indexOf('function proteges(') === -1) echec('Le garde-fou des noeuds proteges est absent.');
  try { new Function(relu); } catch (e) { echec('Module invalide — ' + e.message); }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  public/js/bh-aujourdhui-allege.js  remplace (' + Math.round(SOURCE.length / 1024) + ' Ko)');
console.log('  app.html                           ' + etatApp);
console.log('\n  Vise a l\'identifiant : #bh2TodayDate, #bhCalRoot, #kpiAutoLabel,');
console.log('  et le bloc commun CA mensuel + Occupation.');
console.log('\n  Les quatre cartes kpi* restent. Aucune zone n\'est masquee si');
console.log('  elle contient l\'en-tete, la bande, la liste du jour ou une');
console.log('  carte kpi — le module refuse et nomme le noeud qui bloque.');
console.log('\n  Apres deploiement, cache vide :');
console.log('    bhVerifAllege()');
console.log('  J\'attends masques: 4 et compteurs_intacts: true.');
console.log('\n  Annulation immediate : bhAnnulerAllege()\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
