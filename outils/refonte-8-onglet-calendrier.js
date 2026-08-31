#!/usr/bin/env node
/* ============================================================
   outils/refonte-8-onglet-calendrier.js
   Lot 8 : l'ecran 3 en entier sur l'onglet Calendrier
   ============================================================

   ── POURQUOI RIEN NE BOUGEAIT ────────────────────────────────────
   Votre releve donne les vrais identifiants :

       CA mensuel            div.bh2-feat
       Occupation du mois    section#kpiOccupancyCard
       Automatisation        section#kpiAutoCard
       Calendrier            div#bhCalRoot          (existe bien)

   Et il donne la cause. Dans bh-aujourdhui-allege.js, proteges() ramasse
   TOUS les noeuds dont l'identifiant commence par « kpi » :

       var kpis = document.querySelectorAll('[id^="kpi"]');

   Or deux des trois blocs a masquer s'appellent kpiOccupancyCard et
   kpiAutoCard. Le module se protegeait donc contre lui-meme : chaque
   masquage etait refuse parce que la zone visee « contenait un noeud
   protege » — elle-meme. Trois refus silencieux, et vos quatre blocs
   toujours a l'ecran.

   La protection etait juste dans son intention : ne pas emporter les
   compteurs remontes en haut. Mais « tout ce qui commence par kpi » est
   trop large. Elle vise desormais les identifiants precis qui ont ete
   deplaces ou remontes, et eux seuls.

   ── LE SECOND DEFAUT, PLUS PROFOND ───────────────────────────────
   L'onglet Calendrier mene a /reservations.html. Mais le moteur du
   calendrier vit dans app.html — 224 Ko qui ne peuvent pas demenager.
   C'est pour cela que bh-vue-calendrier.js sert app.html sous un autre
   nom, et c'est pour cela que l'onglet ne montrait pas le calendrier :
   il ouvrait une autre page.

   L'onglet vise desormais app.html?vue=calendrier.

   Consequence a traiter : deux onglets pointent sur app.html. La
   comparaison « suis-je deja sur place » doit donc inclure la partie
   apres le point d'interrogation, sinon « Aujourd'hui » refuse de vous
   ramener depuis la vue calendrier. C'est corrige.

   ── LE TROISIEME ─────────────────────────────────────────────────
   bh-vue-calendrier ne deplacait que le calendrier. Vous voulez tout
   l'ecran 3 : les trois cartes du mois montent avec lui, dans l'ordre
   CA, Occupation, Automatisation, puis le calendrier.

   Elles doivent etre deplacees AVANT le masquage de masse, sinon elles
   disparaissent avec le conteneur qui les porte.

   ── ET LA CAPSULE ────────────────────────────────────────────────
   Les deux onglets partageant app.html, la capsule s'allumerait sous
   « Aujourd'hui » dans la vue calendrier. Le module la corrige lui-meme :
   il sait qu'il est en vue calendrier, il est le seul a le savoir.

   Trois fichiers touches, aucun cree. bh-cartes-mois.js n'est pas
   modifie : son travail devient sans objet des que l'allege reussit.

   Usage :
     node outils/refonte-8-onglet-calendrier.js --essai
     node outils/refonte-8-onglet-calendrier.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(process.cwd(), 'public', 'js');
const ALLEGE = path.join(PUBLIC, 'bh-aujourdhui-allege.js');
const VUE = path.join(PUBLIC, 'bh-vue-calendrier.js');
const BARRE = path.join(PUBLIC, 'bh-barre-onglets.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

[[ALLEGE, 'bh-aujourdhui-allege.js'], [VUE, 'bh-vue-calendrier.js'], [BARRE, 'bh-barre-onglets.js']]
  .forEach(function (p) { if (!fs.existsSync(p[0])) echec(p[1] + ' introuvable.'); });

let allege = fs.readFileSync(ALLEGE, 'utf8');
let vue = fs.readFileSync(VUE, 'utf8');
let barre = fs.readFileSync(BARRE, 'utf8');

if (allege.indexOf('PROTEGES_PRECIS') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

function rempl(texte, avant, apres, quoi, fichier) {
  const n = texte.split(avant).length - 1;
  if (n !== 1) echec('\u00ab ' + quoi + ' \u00bb trouve ' + n + ' fois dans ' + fichier + ' (attendu : 1).');
  return texte.split(avant).join(apres);
}

/* ============================================================
   1. bh-aujourdhui-allege.js — une protection qui vise juste
   ============================================================ */

allege = rempl(allege,
`    var kpis = document.querySelectorAll('[id^="kpi"]');
    for (var i = 0; i < kpis.length; i++) {
      if (kpis[i].id !== sauf) out.push(kpis[i]);
    }`,
`    /* « Tout ce qui commence par kpi » etait trop large : deux des blocs
       a masquer s'appellent kpiOccupancyCard et kpiAutoCard. Le module se
       protegeait contre lui-meme et refusait chaque masquage, en silence.
       Seules les valeurs deplacees en haut doivent survivre. */
    PROTEGES_PRECIS.forEach(function (id) {
      if (id === sauf) return;
      var e = document.getElementById(id);
      if (e) out.push(e);
    });`,
  'le ramassage des kpi', 'bh-aujourdhui-allege.js');

allege = rempl(allege,
  '  /* Ce qui ne doit jamais partir dans un masquage. */\n  function proteges(sauf) {',
`  /* Les valeurs remontees en haut de page : les trois tuiles deplacees
     par bh-kpi-haut, et les deux chiffres passes sous le titre. */
  var PROTEGES_PRECIS = [
    'kpiArrivalsValue', 'kpiDeparturesValue', 'kpiCleaning48hValue',
    'kpiPropertiesValue', 'kpiDepositsValue'
  ];

  /* Ce qui ne doit jamais partir dans un masquage. */
  function proteges(sauf) {`,
  'l\'entete de proteges', 'bh-aujourdhui-allege.js');

/* Les blocs vises a l'identifiant reel, plus par leur texte. */
allege = rempl(allege,
`    /* Les deux partent au meme endroit : leur bloc commun est la bonne
       unite, a condition qu'il ne porte rien d'autre. */
    if (ca && occ) {`,
`    /* Vises a l'identifiant quand on le connait : section#kpiOccupancyCard
       et div.bh2-feat. Un identifiant ne bouge pas quand le texte change. */
    var occId = document.getElementById('kpiOccupancyCard');
    var caCls = document.querySelector('.bh2-feat');
    if (occId || caCls) {
      var faitId = 0;
      if (caCls && cacher('ca_mensuel', caCls, null)) faitId++;
      if (occId && cacher('occupation', occId, null)) faitId++;
      if (faitId) { diag.masques.push('bilans_du_mois'); return; }
    }

    /* Les deux partent au meme endroit : leur bloc commun est la bonne
       unite, a condition qu'il ne porte rien d'autre. */
    if (ca && occ) {`,
  'le bloc des bilans', 'bh-aujourdhui-allege.js');

allege = rempl(allege,
`    var l = document.getElementById('kpiAutoLabel') || feuille('AUTOMATISATION');`,
`    /* La carte porte son propre identifiant : inutile de la deduire. */
    var carteAuto = document.getElementById('kpiAutoCard');
    if (carteAuto) { cacher('automatisation', carteAuto, null); return; }
    var l = document.getElementById('kpiAutoLabel') || feuille('AUTOMATISATION');`,
  'la fonction automatisation', 'bh-aujourdhui-allege.js');

/* ============================================================
   2. bh-vue-calendrier.js — les trois cartes montent aussi
   ============================================================ */

vue = rempl(vue,
`    document.body.appendChild(racine);
    racine.appendChild(section);`,
`    document.body.appendChild(racine);

    /* Les trois cartes du mois montent avec le calendrier : c'est
       l'ecran demande, pas le calendrier seul. Deplacees AVANT le
       masquage de masse — sinon elles disparaitraient avec le conteneur
       qui les porte. */
    etat.cartes = [];
    etat.origines = [];
    ['.bh2-feat', '#kpiOccupancyCard', '#kpiAutoCard'].forEach(function (sel) {
      var c = document.querySelector(sel);
      if (!c) { etat.cartes.push(sel + ' : absente'); return; }
      etat.origines.push({ el: c, parent: c.parentElement, avant: c.nextSibling });
      c.style.setProperty('margin', '0 0 12px', 'important');
      c.style.removeProperty('display');
      racine.appendChild(c);
      etat.cartes.push(sel + ' : deplacee');
    });

    racine.appendChild(section);`,
  'la creation de la racine', 'bh-vue-calendrier.js');

vue = rempl(vue,
`    etat.pose = true;
    try { window.scrollTo(0, 0); } catch (e) {}
    return true;`,
`    /* Les deux onglets partagent app.html : la capsule s'allumerait sous
       « Aujourd'hui ». Ce module est le seul a savoir qu'on est en vue
       calendrier — c'est donc a lui de le dire. */
    try {
      var onglets = document.querySelectorAll('[data-bh-onglet]');
      for (var i = 0; i < onglets.length; i++) {
        var o = onglets[i];
        var cible = o.getAttribute('data-bh-onglet') === 'calendrier';
        o.classList.toggle('active', cible);
        o.classList.toggle('lg-active', cible);
        o.style.setProperty('color', cible ? '#0E3B2E' : '#9A958A', 'important');
      }
      etat.capsule = true;
      window.dispatchEvent(new Event('resize'));
    } catch (e) {}

    etat.pose = true;
    try { window.scrollTo(0, 0); } catch (e) {}
    return true;`,
  'la fin de poser', 'bh-vue-calendrier.js');

vue = rempl(vue,
`    if (etat.barre && etat.barre.parent) {
      etat.barre.parent.insertBefore(etat.barre.el, etat.barre.avant);
    }`,
`    if (etat.barre && etat.barre.parent) {
      etat.barre.parent.insertBefore(etat.barre.el, etat.barre.avant);
    }
    (etat.origines || []).forEach(function (o) {
      if (o.parent) o.parent.insertBefore(o.el, o.avant);
    });`,
  'le retour de la barre', 'bh-vue-calendrier.js');

vue = rempl(vue,
  '      blocs_masques: etat.masques,',
  '      cartes_du_mois: etat.cartes || [],\n      capsule_corrigee: !!etat.capsule,\n      blocs_masques: etat.masques,',
  'le diagnostic de la vue', 'bh-vue-calendrier.js');

/* ============================================================
   3. bh-barre-onglets.js — l'onglet vise la bonne adresse
   ============================================================ */

barre = rempl(barre,
  "page: 'reservations.html', mots: ['réservation', 'reservation', 'calendrier'] }",
  "page: 'app.html?vue=calendrier', mots: ['réservation', 'reservation', 'calendrier'] }",
  'la destination de l\'onglet Calendrier', 'bh-barre-onglets.js');

barre = rempl(barre,
`          var ici = location.pathname.split('/').pop().toLowerCase();
          if (ici === page) return; /* deja sur place : on laisse faire */`,
`          /* Deux onglets partagent app.html : la comparaison doit inclure
             ce qui suit le point d'interrogation, sinon « Aujourd'hui »
             refuse de vous ramener depuis la vue calendrier. */
          var ici = location.pathname.split('/').pop().toLowerCase() + location.search;
          if (ici === page) return; /* deja sur place : on laisse faire */`,
  'la comparaison de page', 'bh-barre-onglets.js');

/* ── Verifications ───────────────────────────────────────────── */

[
  [allege, 'la liste precise', 'var PROTEGES_PRECIS = ['],
  [allege, 'son usage dans proteges', 'PROTEGES_PRECIS.forEach(function (id) {'],
  [allege, 'la carte occupation par id', "document.getElementById('kpiOccupancyCard')"],
  [allege, 'la carte CA par classe', "document.querySelector('.bh2-feat')"],
  [allege, 'la carte automatisation par id', "document.getElementById('kpiAutoCard')"],
  [vue, 'le deplacement des cartes', "['.bh2-feat', '#kpiOccupancyCard', '#kpiAutoCard']"],
  [vue, 'la capsule', "o.getAttribute('data-bh-onglet') === 'calendrier'"],
  [vue, 'le retour des cartes', '(etat.origines || []).forEach'],
  [barre, 'la nouvelle adresse', "page: 'app.html?vue=calendrier'"],
  [barre, 'la comparaison avec search', '.toLowerCase() + location.search'],
].forEach(function (c) {
  if (c[0].indexOf(c[2]) === -1) echec('Verification : ' + c[1] + ' est absent apres modification.');
});

if (allege.indexOf('[id^="kpi"]') !== -1) {
  echec('Le ramassage large des kpi* subsiste : les masquages seraient encore refuses. Refus.');
}
if (barre.indexOf("'reservations.html'") !== -1) {
  echec('Une reference a reservations.html subsiste dans la barre. Refus.');
}

[[allege, 'bh-aujourdhui-allege.js'], [vue, 'bh-vue-calendrier.js'], [barre, 'bh-barre-onglets.js']]
  .forEach(function (p) {
    try { new Function(p[0]); }
    catch (e) { echec(p[1] + ' ne serait plus du JavaScript valide — ' + e.message); }
  });

if (!ESSAI) {
  fs.writeFileSync(ALLEGE, allege, 'utf8');
  fs.writeFileSync(VUE, vue, 'utf8');
  fs.writeFileSync(BARRE, barre, 'utf8');
  if (fs.readFileSync(ALLEGE, 'utf8').indexOf('PROTEGES_PRECIS') === -1) {
    echec("La correction n'est pas dans bh-aujourdhui-allege.js apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  1. allege : la protection vise 5 identifiants precis, plus');
console.log('     « tout ce qui commence par kpi » — qui la faisait refuser');
console.log('     de masquer kpiOccupancyCard et kpiAutoCard, soit elle-meme.');
console.log('  2. allege : les trois blocs vises a l\'identifiant reel');
console.log('     (.bh2-feat, #kpiOccupancyCard, #kpiAutoCard).');
console.log('  3. vue : les trois cartes du mois montent avec le calendrier.');
console.log('  4. vue : la capsule s\'allume sous Calendrier, pas Aujourd\'hui.');
console.log('  5. barre : l\'onglet vise app.html?vue=calendrier — le moteur');
console.log('     du calendrier ne peut pas quitter app.html.');
console.log('\n  A verifier sur telephone, cache vide :');
console.log('  1. /app.html : plus de CA, ni Occupation, ni Automatisation,');
console.log('     ni calendrier. Titre, tuiles, bande, listes seulement.');
console.log('     bhVerifAllege()  — 4 entrees dans « masques », « refuses » vide.');
console.log('  2. Onglet Calendrier : CA, Occupation, Automatisation, puis le');
console.log('     calendrier. La capsule sous « Calendrier ».');
console.log('     bhVerifVueCalendrier()  — cartes_du_mois : trois « deplacee ».');
console.log('  3. Touchez « Aujourd\'hui » : vous devez revenir. C\'est le test');
console.log('     de la comparaison avec le point d\'interrogation.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
