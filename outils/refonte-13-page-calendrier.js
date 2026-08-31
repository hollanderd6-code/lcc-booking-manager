#!/usr/bin/env node
/* ============================================================
   outils/refonte-13-page-calendrier.js
   Lot 13 : /calendrier.html, une vraie page
   ============================================================

   ── CE QUE VOUS DEMANDEZ, ET POURQUOI C'ETAIT BLOQUE ─────────────
   Le calendrier doit vivre sur sa propre page, pas sur app.html avec un
   parametre. La sonde 11c a montre le mur : 224 Ko de moteur, dix
   scripts inline, sept entrelaces avec les modales et les KPI de
   app.html. Sortir ce code, c'est plusieurs jours.

   ── LA ROUTE QUE J'AVAIS RATEE ───────────────────────────────────
   On ne deplace pas le fichier. On lui donne une seconde adresse.

       GET /calendrier.html   ->   sert public/app.html

   Un seul fichier sur le disque, donc aucune duplication et aucune
   chance de voir deux versions diverger. Mais une vraie URL, un vrai
   onglet, un vrai favori. La vue s'active desormais sur le NOM DE PAGE,
   plus sur un parametre.

   C'est trois lignes de serveur la ou le demelage en demandait des
   milliers, et le resultat visible est le meme.

   ── CE QUE CA CHANGE VRAIMENT ────────────────────────────────────
   L'adresse affiche calendrier.html. Le reste — le moteur, les prix,
   les reservations, les modales — tourne exactement comme avant, au
   meme endroit, sur les memes donnees.

   Ce que ca ne change pas : app.html reste le fichier source. Le jour
   ou vous demelerez vraiment le calendrier, cette route disparaitra
   d'une ligne et rien d'autre ne bougera.

   ── CINQ MODIFICATIONS ───────────────────────────────────────────
   1. server.js                 la route /calendrier.html
   2. bh-vue-calendrier.js      s'active sur le nom de page
   3. bh-aujourdhui-allege.js   se tait sur calendrier.html
   4. bh-barre-onglets.js       l'onglet pointe sur /calendrier.html
   5. reservations.html         redirige vers /calendrier.html

   Chacune est verifiee avant ecriture. Si une seule ancre manque, rien
   n'est ecrit du tout.

   Usage :
     node outils/refonte-13-page-calendrier.js --essai
     node outils/refonte-13-page-calendrier.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = process.cwd();
const SERVEUR = path.join(RACINE, 'server.js');
const PUBLIC = path.join(RACINE, 'public');
const VUE = path.join(PUBLIC, 'js', 'bh-vue-calendrier.js');
const ALLEGE = path.join(PUBLIC, 'js', 'bh-aujourdhui-allege.js');
const BARRE = path.join(PUBLIC, 'js', 'bh-barre-onglets.js');
const RESA = path.join(PUBLIC, 'reservations.html');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

[['server.js', SERVEUR], ['bh-vue-calendrier.js', VUE], ['bh-barre-onglets.js', BARRE], ['reservations.html', RESA]]
  .forEach(function (f) { if (!fs.existsSync(f[1])) echec(f[0] + ' introuvable. Lancez depuis la racine du projet.'); });

const ecritures = [];
const etats = {};

/* ============================================================
   1. server.js — la seconde adresse
   ============================================================ */

let srv = fs.readFileSync(SERVEUR, 'utf8');

if (srv.indexOf("'/calendrier.html'") !== -1) {
  etats.serveur = 'deja applique';
} else {
  const ANCRE = 'async function runTemplatesCron(triggerTypes) {';
  const n = srv.split(ANCRE).length - 1;
  if (n !== 1) echec("L'ancre runTemplatesCron est presente " + n + ' fois (attendu : 1).');

  const ROUTE = `// ============================================================
// GET /calendrier.html — la page Calendrier
// ============================================================
// Le calendrier vit dans public/app.html : son moteur y est tisse avec
// les modales, le reordonnancement et les restrictions de la page
// (voir outils/refonte-11c-sonde-scripts.js). Le sortir demanderait de
// reecrire 224 Ko.
//
// On lui donne donc une seconde adresse plutot qu'une seconde copie.
// Un seul fichier sur le disque : les deux pages ne peuvent pas diverger.
// bh-vue-calendrier.js reconnait le nom de page et n'affiche que la
// section calendrier.
app.get('/calendrier.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

`;

  ['INSERT ', 'UPDATE ', 'DELETE ', 'ALTER ', 'DROP ', 'CREATE TABLE'].forEach(function (mot) {
    if (ROUTE.toUpperCase().indexOf(mot) !== -1) echec('Le code ajoute contient « ' + mot.trim() + ' ». Refus.');
  });
  if (srv.indexOf("require('path')") === -1 && srv.indexOf('require("path")') === -1) {
    echec("server.js ne requiert pas 'path' : la route ne pourrait pas resoudre le fichier. Refus.");
  }

  const pos = srv.indexOf(ANCRE);
  srv = srv.slice(0, pos) + ROUTE + srv.slice(pos);

  if (srv.split("app.get('/calendrier.html'").length - 1 !== 1) echec('La route serait definie plusieurs fois. Refus.');
  try { new Function(srv); } catch (e) { echec('server.js ne serait plus du JavaScript valide — ' + e.message); }

  etats.serveur = 'route /calendrier.html ajoutee';
  ecritures.push([SERVEUR, srv]);
}

/* ============================================================
   2. bh-vue-calendrier.js — s'activer sur le nom de page
   ============================================================ */

let vue = fs.readFileSync(VUE, 'utf8');

if (vue.indexOf('function vueDemandee(') !== -1) {
  etats.vue = 'deja applique';
} else {
  const avant = "  if ((location.search || '').indexOf('vue=calendrier') === -1) return;";
  if (vue.split(avant).length - 1 !== 1) echec("Le garde d'entree de bh-vue-calendrier.js est introuvable.");
  vue = vue.split(avant).join(
`  /* Deux facons d'etre en vue calendrier : la page dediee, ou le
     parametre — garde pour ne pas casser les liens deja poses. */
  function vueDemandee() {
    var page = (location.pathname || '').split('/').pop().toLowerCase();
    if (page === 'calendrier.html') return true;
    return (location.search || '').indexOf('vue=calendrier') !== -1;
  }
  if (!vueDemandee()) return;`);
  try { new Function(vue); } catch (e) { echec('bh-vue-calendrier.js ne serait plus valide — ' + e.message); }
  etats.vue = 'active sur calendrier.html';
  ecritures.push([VUE, vue]);
}

/* ============================================================
   3. bh-aujourdhui-allege.js — se taire sur la page calendrier
   ============================================================ */

if (!fs.existsSync(ALLEGE)) {
  etats.allege = 'absent (rien a faire)';
} else {
  let allege = fs.readFileSync(ALLEGE, 'utf8');
  if (allege.indexOf('calendrier.html') !== -1) {
    etats.allege = 'deja applique';
  } else {
    const avant = "  if ((location.search || '').indexOf('vue=calendrier') !== -1) return;";
    if (allege.split(avant).length - 1 !== 1) {
      echec("Le garde de bh-aujourdhui-allege.js est introuvable. Lancez d'abord le lot 12.");
    }
    allege = allege.split(avant).join(
`  if ((location.search || '').indexOf('vue=calendrier') !== -1) return;
  if ((location.pathname || '').split('/').pop().toLowerCase() === 'calendrier.html') return;`);
    try { new Function(allege); } catch (e) { echec('bh-aujourdhui-allege.js ne serait plus valide — ' + e.message); }
    etats.allege = 'se tait sur calendrier.html';
    ecritures.push([ALLEGE, allege]);
  }
}

/* ============================================================
   4. bh-barre-onglets.js — la destination
   ============================================================ */

let barre = fs.readFileSync(BARRE, 'utf8');

if (barre.indexOf("dest: 'calendrier.html'") !== -1) {
  etats.barre = 'deja applique';
} else if (barre.indexOf("dest: 'app.html?vue=calendrier'") !== -1) {
  barre = barre.split("dest: 'app.html?vue=calendrier'").join("dest: 'calendrier.html'");
  try { new Function(barre); } catch (e) { echec('bh-barre-onglets.js ne serait plus valide — ' + e.message); }
  etats.barre = "Calendrier -> /calendrier.html";
  ecritures.push([BARRE, barre]);
} else {
  echec("La destination du lot 12 est absente de bh-barre-onglets.js. Lancez d'abord le lot 12.");
}

/* ============================================================
   5. reservations.html — la redirection suit
   ============================================================ */

let resa = fs.readFileSync(RESA, 'utf8');

if (resa.indexOf("location.replace('/calendrier.html')") !== -1) {
  etats.resa = 'deja applique';
} else if (resa.indexOf("location.replace('/app.html?vue=calendrier')") !== -1) {
  resa = resa.split("location.replace('/app.html?vue=calendrier')").join("location.replace('/calendrier.html')");
  etats.resa = 'redirige vers /calendrier.html';
  ecritures.push([RESA, resa]);
} else {
  etats.resa = 'aucune redirection en place (lot 12b non applique) — ignoree';
}

/* ============================================================
   Ecriture, tout ou rien
   ============================================================ */

if (!ecritures.length) {
  console.log('\n  Tout est deja en place — rien a faire.\n');
  process.exit(0);
}

if (!ESSAI) {
  const sauvegarde = SERVEUR + '.avant-page-calendrier';
  if (ecritures.some(e => e[0] === SERVEUR) && !fs.existsSync(sauvegarde)) {
    fs.writeFileSync(sauvegarde, fs.readFileSync(SERVEUR));
  }
  ecritures.forEach(function (e) { fs.writeFileSync(e[0], e[1], 'utf8'); });

  if (fs.readFileSync(SERVEUR, 'utf8').indexOf("app.get('/calendrier.html'") === -1
      && etats.serveur !== 'deja applique') {
    echec("La route n'est pas dans server.js apres ecriture.");
  }
  if (fs.readFileSync(VUE, 'utf8').indexOf('vueDemandee') === -1) {
    echec("Le module de vue n'a pas ete modifie.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  server.js                   ' + etats.serveur);
console.log('  bh-vue-calendrier.js        ' + etats.vue);
console.log('  bh-aujourdhui-allege.js     ' + etats.allege);
console.log('  bh-barre-onglets.js         ' + etats.barre);
console.log('  reservations.html           ' + etats.resa);
if (!ESSAI && etats.serveur.indexOf('deja') === -1) {
  console.log('  Sauvegarde : server.js.avant-page-calendrier (ne pas commiter)');
}
console.log('\n  /calendrier.html sert public/app.html. Un seul fichier sur le');
console.log('  disque : les deux pages ne peuvent pas diverger. Le module de');
console.log('  vue reconnait le nom de page et n\'affiche que la section');
console.log('  calendrier.');
console.log('\n  Le parametre ?vue=calendrier continue de fonctionner : les');
console.log('  liens deja poses ne cassent pas.');
console.log('\n  A verifier apres deploiement, cache vide :');
console.log('    /calendrier.html directement  -> le calendrier seul');
console.log('    onglet Calendrier             -> meme resultat, bonne adresse');
console.log('    onglet Aujourd\'hui            -> la page du matin, inchangee');
console.log('    bhVerifVueCalendrier()        -> section_visible: true');
console.log('\n  Si Render refuse de demarrer, la cause serait « path is not');
console.log('  defined » : le script a verifie que server.js requiert path,');
console.log('  mais pas a quelle ligne. Le cas echeant, dites-le moi.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
