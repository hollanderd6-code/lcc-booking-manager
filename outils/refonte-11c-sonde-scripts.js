#!/usr/bin/env node
/* ============================================================
   outils/refonte-11c-sonde-scripts.js
   Lot 11c : quel code anime le calendrier, et peut-il voyager
   ============================================================

   ── CE QU'ON SAIT DEJA ───────────────────────────────────────────
   Le markup est propre : <section id="calendarSection" class="card">,
   lignes 4037-4143, 7 Ko. Il contient la navigation de periode, la
   colonne des logements, l'en-tete des jours et la grille.

   Ce qu'on ne sait pas : ce qui le REMPLIT.

   Et c'est la question qui compte. public/js/calendar-modern.js ne peut
   pas etre la reponse : son getPropertyPrice renvoie 75 en dur avec un
   « TODO », et son initialisation plante si #addBookingBtn ou #logoutBtn
   manquent. Votre calendrier affiche 375, 90, 75 selon le logement et le
   jour — ce n'est pas ce fichier qui l'ecrit.

   Le vrai moteur est donc inline dans app.html. Cette sonde le trouve.

   ── CE QU'ELLE MESURE ────────────────────────────────────────────
   Pour chaque <script> inline de app.html qui nomme un identifiant du
   calendrier, elle donne :

       lignes, taille, nombre de fonctions
       les identifiants du calendrier qu'il touche
       les identifiants HORS calendrier qu'il touche aussi
       les appels reseau qu'il fait

   Le dernier point decide de tout. Un script qui ne parle que du
   calendrier se copie. Un script qui parle aussi du reste de la page ne
   se copie pas : il chercherait sur reservations.html des noeuds qui n'y
   sont pas, et echouerait a chaque chargement.

   ── ELLE NE MODIFIE RIEN ─────────────────────────────────────────
   Avec --extraire, elle depose outils/rapport-scripts-calendrier.json.

   Usage :
     node outils/refonte-11c-sonde-scripts.js
     node outils/refonte-11c-sonde-scripts.js --extraire
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(process.cwd(), 'public');
const APP = path.join(PUBLIC, 'app.html');
const EXTRAIRE = process.argv.includes('--extraire');

function echec(msg) {
  console.error('\n  \u2717 ' + msg + '\n');
  process.exit(1);
}

if (!fs.existsSync(APP)) echec('public/app.html introuvable. Lancez depuis la racine du projet.');

const app = fs.readFileSync(APP, 'utf8');
const ligneDe = (i) => app.slice(0, i).split('\n').length;

/* ── Les identifiants du bloc calendrier ──────────────────────── */

const debutBloc = app.indexOf('id="calendarSection"');
if (debutBloc === -1) echec('id="calendarSection" introuvable — relancez la sonde 11b.');
const ouv = app.lastIndexOf('<', debutBloc);
const finBloc = app.indexOf('</section>', debutBloc);
if (finBloc === -1) echec('Fermeture de la section introuvable.');
const bloc = app.slice(ouv, finBloc + 10);

const IDS_CAL = Array.from(new Set((bloc.match(/id="([^"]+)"/g) || []).map(s => s.slice(4, -1))));
const CLASSES_CAL = ['calendar-cell', 'calendar-row', 'property-item', 'day-header',
  'booking-block', 'view-tab', 'period-display', 'cell-price'];

/* Tous les identifiants de la page, pour savoir ce qu'un script touche
   en dehors du calendrier. */
const IDS_PAGE = Array.from(new Set((app.match(/id="([^"]+)"/g) || []).map(s => s.slice(4, -1))));
const IDS_HORS = IDS_PAGE.filter(id => IDS_CAL.indexOf(id) === -1);

/* ── Les scripts ──────────────────────────────────────────────── */

const scripts = [];
const externes = [];
const reScript = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m;
while ((m = reScript.exec(app)) !== null) {
  const attrs = m[1] || '';
  const corps = m[2] || '';
  const src = (attrs.match(/src="([^"]+)"/) || [])[1];
  if (src) { externes.push(src); continue; }
  if (corps.length < 40) continue;

  const touchesCal = IDS_CAL.filter(id => corps.indexOf("'" + id + "'") !== -1 || corps.indexOf('"' + id + '"') !== -1);
  const touchesClasses = CLASSES_CAL.filter(c => corps.indexOf(c) !== -1);
  if (!touchesCal.length && !touchesClasses.length) continue;

  const touchesHors = IDS_HORS.filter(id => corps.indexOf("'" + id + "'") !== -1 || corps.indexOf('"' + id + '"') !== -1);
  const fonctions = Array.from(new Set(
    (corps.match(/function\s+([A-Za-z_$][\w$]*)/g) || []).map(s => s.replace(/function\s+/, ''))
  ));
  const appels = Array.from(new Set(
    (corps.match(/['"`]\/api\/[a-zA-Z0-9_\-\/]+/g) || []).map(s => s.slice(1))
  ));

  scripts.push({
    ligne_debut: ligneDe(m.index),
    ligne_fin: ligneDe(m.index + m[0].length),
    taille_ko: Math.round(corps.length / 1024),
    nb_fonctions: fonctions.length,
    fonctions: fonctions.slice(0, 10),
    ids_calendrier: touchesCal.slice(0, 10),
    nb_ids_calendrier: touchesCal.length,
    classes_calendrier: touchesClasses,
    ids_hors_calendrier: touchesHors.slice(0, 10),
    nb_ids_hors_calendrier: touchesHors.length,
    appels_api: appels.slice(0, 8),
    /* Le critere : un script qui ne nomme aucun noeud etranger au
       calendrier peut voyager tel quel. */
    voyageable: touchesHors.length === 0
  });
}

scripts.sort((a, b) => b.nb_ids_calendrier - a.nb_ids_calendrier);

const rapport = {
  bloc: { ids: IDS_CAL, taille_ko: Math.round(bloc.length / 1024) },
  calendar_modern_charge_par_app: externes.some(s => /calendar-modern/.test(s)),
  scripts_inline_lies_au_calendrier: scripts,
  total_scripts_inline_analyses: scripts.length
};

if (EXTRAIRE) {
  fs.writeFileSync(path.join(process.cwd(), 'outils', 'rapport-scripts-calendrier.json'),
    JSON.stringify(rapport, null, 2), 'utf8');
}

/* ── Le rapport ───────────────────────────────────────────────── */

console.log('\n— SONDE, AUCUNE MODIFICATION —\n');
console.log('  Le bloc porte ' + IDS_CAL.length + ' identifiants :');
console.log('    ' + IDS_CAL.join(', '));
console.log('\n  app.html charge calendar-modern.js : '
  + (rapport.calendar_modern_charge_par_app ? 'OUI' : 'non'));

console.log('\n  SCRIPTS INLINE QUI TOUCHENT AU CALENDRIER (' + scripts.length + ')\n');
if (!scripts.length) {
  console.log('    Aucun. Le calendrier est alors rempli par un fichier externe.');
  console.log('    Dans ce cas la reponse est simple : on charge le meme fichier');
  console.log('    sur reservations.html, avec le markup, et c\'est tout.');
} else {
  scripts.forEach(function (s, i) {
    console.log('    ' + (i + 1) + '. lignes ' + s.ligne_debut + '-' + s.ligne_fin
      + '   ' + s.taille_ko + ' Ko   ' + s.nb_fonctions + ' fonction(s)');
    console.log('       calendrier : ' + s.nb_ids_calendrier + ' id(s)'
      + (s.ids_calendrier.length ? '  (' + s.ids_calendrier.slice(0, 6).join(', ') + ')' : '')
      + (s.classes_calendrier.length ? '  + classes ' + s.classes_calendrier.slice(0, 4).join(', ') : ''));
    console.log('       hors calendrier : ' + s.nb_ids_hors_calendrier + ' id(s)'
      + (s.ids_hors_calendrier.length ? '  (' + s.ids_hors_calendrier.slice(0, 6).join(', ') + ')' : ''));
    if (s.appels_api.length) console.log('       api : ' + s.appels_api.join(', '));
    if (s.fonctions.length) console.log('       fn : ' + s.fonctions.slice(0, 6).join(', '));
    console.log('       -> ' + (s.voyageable ? 'VOYAGEABLE tel quel' : 'MELE au reste de la page'));
    console.log('');
  });

  const v = scripts.filter(s => s.voyageable);
  const total = scripts.reduce((n, s) => n + s.taille_ko, 0);
  console.log('  RESUME');
  console.log('    ' + v.length + ' script(s) voyageable(s) sur ' + scripts.length
    + '  ·  ' + total + ' Ko au total');
  if (v.length === scripts.length) {
    console.log('    Tout peut partir. Le lot 12 sort markup et scripts dans un');
    console.log('    module partage, charge par les deux pages.');
  } else if (!v.length) {
    console.log('    Rien ne peut partir tel quel. Le calendrier est tisse dans');
    console.log('    app.html. Deux options honnetes alors : soit reservations.html');
    console.log('    devient une redirection vers app.html cadree sur le calendrier,');
    console.log('    soit on demele — et il faut savoir que ce n\'est pas un lot,');
    console.log('    c\'est un chantier.');
  } else {
    console.log('    Partage. Le lot 12 emporte les voyageables et je vous dis,');
    console.log('    pour chaque script mele, ce qu\'il faut en extraire.');
  }
}

console.log('\n  Collez-moi cette sortie.');
if (EXTRAIRE) console.log('  Ecrit : outils/rapport-scripts-calendrier.json\n');
else console.log('  --extraire depose le rapport complet en JSON.\n');
