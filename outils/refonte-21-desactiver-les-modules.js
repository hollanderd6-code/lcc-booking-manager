#!/usr/bin/env node
/* ============================================================
   outils/refonte-21-desactiver-les-modules.js
   Lot 21 : rendre les anciennes pages a elles-memes
   ============================================================

   ── LA DECISION ──────────────────────────────────────────────────
   On arrete les modules superposes. Ils se posaient sur un DOM qu'ils
   ne possedaient pas : chaque ecran demandait de deviner ou etaient les
   blocs de l'ancienne page, et ce cout montait au lieu de baisser.

   Les ecrans seront desormais des PAGES NEUVES, qui consomment les
   routes deja construites.

   ── CE QUI PART ──────────────────────────────────────────────────
   Les balises <script> des douze modules de la refonte, dans app.html,
   messages.html et reservations.html. Plus la regle anti-clignotement
   du lot 20, et la route /calendrier.html — sans son module de vue,
   elle afficherait app.html en entier.

   ── CE QUI RESTE, ET POURQUOI ────────────────────────────────────
   1. TOUT server.js. /api/aujourdhui/etats — etats d'envoi, menages,
      conditions bloquantes, departs, heures d'arrivee — et
      /api/ia/semaine. Ce sont des lectures seules qui ne genent
      personne, et les pages neuves s'en nourriront des le premier jour.
      Les jeter reviendrait a refaire les lots 6 a 16.

   2. Les fichiers public/js/bh-*.js, sur le disque, non charges. Ils
      sont la specification exacte de ce que chaque ecran doit montrer :
      quelles donnees, quels etats, quelles causes nommees. Je les relis
      en ecrivant les pages neuves.

   ── CE QUE LE SCRIPT NE FAIT PAS ─────────────────────────────────
   Il ne retire que les douze modules qu'il connait. Tout autre script
   « bh- » present dans vos pages est LAISSE EN PLACE et LISTE en fin de
   sortie. Certains sont anterieurs a la refonte — bh-layout.js gere
   votre navigation — et les retirer casserait l'application.

   Si la liste finale contient un module de refonte que j'aurais oublie,
   dites-le moi : une ligne a ajouter.

   Usage :
     node outils/refonte-21-desactiver-les-modules.js --essai
     node outils/refonte-21-desactiver-les-modules.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = process.cwd();
const SERVEUR = path.join(RACINE, 'server.js');
const PUBLIC = path.join(RACINE, 'public');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

/* Les modules poses par la refonte, lots 3 a 20. */
const MODULES = [
  'bh-vide-du-haut.js',
  'bh-entete-jour.js',
  'bh-bande-jours.js',
  'bh-listes-jour.js',
  'bh-liste-unifiee.js',
  'bh-cartes-mois.js',
  'bh-aujourdhui-allege.js',
  'bh-barre-onglets.js',
  'bh-vue-calendrier.js',
  'bh-entete-calendrier.js',
  'bh-messages-liste.js',
  'bh-entete-messages.js'
];

const PAGES = ['app.html', 'messages.html', 'reservations.html', 'calendrier.html'];

const ecritures = [];
const retires = {};
const laisses = {};

/* Retire une balise <script src="...nom..."></script>, quels que soient
   les guillemets, le chemin et les attributs. */
function retirerBalise(html, nom) {
  let n = 0;
  let i;
  while ((i = html.indexOf(nom)) !== -1) {
    const debut = html.lastIndexOf('<script', i);
    if (debut === -1) break;
    const fin = html.indexOf('</script>', i);
    if (fin === -1) break;
    const finReelle = fin + '</script>'.length;
    /* La balise doit etre courte : un <script src> ne contient pas de
       code. Si elle est longue, c'est qu'on a attrape autre chose. */
    if (finReelle - debut > 400) break;
    let a = debut;
    while (a > 0 && (html[a - 1] === ' ' || html[a - 1] === '\t')) a--;
    let b = finReelle;
    if (html[b] === '\n') b++;
    html = html.slice(0, a) + html.slice(b);
    n++;
  }
  return { html: html, n: n };
}

PAGES.forEach(function (nomPage) {
  const fichier = path.join(PUBLIC, nomPage);
  if (!fs.existsSync(fichier)) return;
  let html = fs.readFileSync(fichier, 'utf8');
  const avant = html;
  retires[nomPage] = [];

  MODULES.forEach(function (m) {
    const r = retirerBalise(html, m);
    if (r.n) { html = r.html; retires[nomPage].push(m + (r.n > 1 ? ' \u00d7' + r.n : '')); }
  });

  /* La regle anti-clignotement du lot 20. */
  const iStyle = html.indexOf('<style id="bh-anti-clignotement">');
  if (iStyle !== -1) {
    const iCom = html.lastIndexOf('<!--', iStyle);
    const debut = (iCom !== -1 && iStyle - iCom < 200) ? iCom : iStyle;
    const iFin = html.indexOf('}, 4000);\n</script>', iStyle);
    if (iFin !== -1) {
      html = html.slice(0, debut) + html.slice(iFin + '}, 4000);\n</script>'.length + 1);
      retires[nomPage].push('regle anti-clignotement');
    }
  }

  /* Ce qui reste, et qu'on ne touche pas. */
  const restants = [];
  const re = /js\/(bh-[a-z0-9-]+\.js)/gi;
  let m2;
  while ((m2 = re.exec(html)) !== null) {
    if (restants.indexOf(m2[1]) === -1) restants.push(m2[1]);
  }
  if (restants.length) laisses[nomPage] = restants;

  if (html !== avant) ecritures.push([fichier, html]);
});

/* ── La route /calendrier.html ────────────────────────────────── */

let etatServeur = 'inchange';
if (fs.existsSync(SERVEUR)) {
  let srv = fs.readFileSync(SERVEUR, 'utf8');
  const iRoute = srv.indexOf("app.get('/calendrier.html'");
  if (iRoute !== -1) {
    const iCom = srv.lastIndexOf('// ====', iRoute);
    const debut = (iCom !== -1 && iRoute - iCom < 1200) ? iCom : iRoute;
    const iFin = srv.indexOf('});', iRoute);
    if (iFin === -1) echec('Fin de la route /calendrier.html introuvable.');
    let fin = iFin + 3;
    while (srv[fin] === '\n') fin++;
    srv = srv.slice(0, debut) + srv.slice(fin);

    if (srv.indexOf("app.get('/calendrier.html'") !== -1) echec('La route subsiste apres retrait. Refus.');
    if (srv.indexOf('/api/aujourdhui/etats') === -1) echec('La route des etats aurait disparu. Refus.');
    if (srv.indexOf('/api/ia/semaine') === -1) echec('La route IA aurait disparu. Refus.');
    try { new Function(srv); } catch (e) { echec('server.js ne serait plus valide — ' + e.message); }

    etatServeur = 'route /calendrier.html retiree — les deux routes de donnees restent';
    ecritures.push([SERVEUR, srv]);
  } else {
    etatServeur = 'aucune route /calendrier.html — les routes de donnees restent';
  }
}

/* La redirection posee dans reservations.html. */
const RESA = path.join(PUBLIC, 'reservations.html');
if (fs.existsSync(RESA)) {
  let r = fs.readFileSync(RESA, 'utf8');
  if (r.indexOf("location.replace('/calendrier.html')") !== -1
      || r.indexOf("location.replace('/app.html?vue=calendrier')") !== -1) {
    console.log('\n  \u26a0 reservations.html porte encore une redirection vers le');
    console.log('    calendrier. Je ne la retire pas automatiquement : je ne sais');
    console.log('    pas dans quel bloc elle a ete posee. Cherchez');
    console.log('    « location.replace » dans le fichier et supprimez ces lignes.');
  }
}

/* ── Ecriture ─────────────────────────────────────────────────── */

if (!ecritures.length) {
  console.log('\n  Rien a desactiver — les pages sont deja propres.\n');
  process.exit(0);
}

if (!ESSAI) {
  ecritures.forEach(function (e) { fs.writeFileSync(e[0], e[1], 'utf8'); });
  if (fs.existsSync(SERVEUR)) {
    const relu = fs.readFileSync(SERVEUR, 'utf8');
    if (relu.indexOf('/api/aujourdhui/etats') === -1) echec('Les routes de donnees ont disparu. Restaurez avec git.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
Object.keys(retires).forEach(function (p) {
  if (!retires[p].length) return;
  console.log('\n  ' + p);
  retires[p].forEach(function (m) { console.log('    \u2212 ' + m); });
});
console.log('\n  server.js  ' + etatServeur);

const restants = Object.keys(laisses);
if (restants.length) {
  console.log('\n  LAISSES EN PLACE — je ne les connais pas comme modules de');
  console.log('  refonte, et certains sont anterieurs (bh-layout.js gere votre');
  console.log('  navigation). Les retirer casserait l\'application.');
  restants.forEach(function (p) {
    console.log('    ' + p + ' : ' + laisses[p].join(', '));
  });
  console.log('\n  Si l\'un d\'eux est bien un module de refonte que j\'ai oublie,');
  console.log('  dites-le moi — c\'est une ligne a ajouter.');
}

console.log('\n  CE QUI RESTE, ET QUI SERVIRA :');
console.log('    server.js — /api/aujourdhui/etats et /api/ia/semaine, en');
console.log('      lecture seule. Les pages neuves s\'en nourriront des le');
console.log('      premier jour ; les jeter refereait les lots 6 a 16.');
console.log('    public/js/bh-*.js — sur le disque, non charges. Ils sont la');
console.log('      specification de ce que chaque ecran doit montrer.');
console.log('\n  A verifier apres deploiement, cache vide :');
console.log('    /app.html          l\'ancienne page du matin, entiere');
console.log('    /messages.html     l\'ancienne liste, entiere');
console.log('    /reservations.html inchangee');
console.log('\n  Puis on ecrit mobile-messages.html — page autonome, une seule');
console.log('  source, rien a deviner.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
