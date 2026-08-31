#!/usr/bin/env node
/* ============================================================
   outils/refonte-11b-sonde-calendrier.js
   Lot 11b : trouver le calendrier sans supposer son enveloppe
   ============================================================

   ── POURQUOI LE 11 A ECHOUE ──────────────────────────────────────
   Je cherchais id="bhCalRoot" dans le markup. Il n'y est pas : cet
   identifiant est POSE A L'EXECUTION par un script. Le DOM le montre,
   le fichier ne le contient pas. Chercher dans le fichier ce qu'on a lu
   dans le navigateur, c'est l'erreur que fait ce lot 11.

   ── CE QUE CETTE SONDE CHERCHE ───────────────────────────────────
   Plusieurs ancres, dans l'ordre, jusqu'a ce qu'une reponde :

       id="calendarGrid"        la grille elle-meme
       id="propertyList"        la colonne des logements
       id="daysHeader"          la ligne des jours
       id="calendarSection"     une section nommee
       calendar-modern-header   l'en-tete du composant
       calendar-header-top      sa barre haute

   Pour chaque ancre trouvee, elle remonte les CINQ ancetres successifs
   et decrit chacun : balise, identifiant, classe, lignes, taille. C'est
   a moi de choisir lequel est le bloc a deplacer — pas a un script de
   le deviner.

   Elle dit aussi qui pose bhCalRoot, en montrant les lignes de app.html
   ou ce nom apparait.

   ── ET LA DESTINATION ────────────────────────────────────────────
   reservations.html ne contient ni calendarGrid, ni calendar-modern :
   le calendrier moderne n'existe que sur app.html. La sonde liste donc
   le sommaire de reservations.html — ses identifiants et ses scripts —
   pour qu'on sache ce qu'on met de cote et ce qu'il faudra charger.

   ── ELLE NE MODIFIE RIEN ─────────────────────────────────────────
   Aucune ecriture, sauf --extraire qui depose le rapport dans
   outils/rapport-calendrier.json.

   Usage :
     node outils/refonte-11b-sonde-calendrier.js
     node outils/refonte-11b-sonde-calendrier.js --extraire
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(process.cwd(), 'public');
const APP = path.join(PUBLIC, 'app.html');
const RESA = path.join(PUBLIC, 'reservations.html');
const EXTRAIRE = process.argv.includes('--extraire');

function echec(msg) {
  console.error('\n  \u2717 ' + msg + '\n');
  process.exit(1);
}

if (!fs.existsSync(APP)) echec('public/app.html introuvable. Lancez depuis la racine du projet.');
if (!fs.existsSync(RESA)) echec('public/reservations.html introuvable.');

const app = fs.readFileSync(APP, 'utf8');
const resa = fs.readFileSync(RESA, 'utf8');
const ligneDe = (src, i) => src.slice(0, i).split('\n').length;

/* ── Delimitation d'un bloc par comptage de balises ───────────── */

function finDuBloc(src, i, nom) {
  const ouvre = new RegExp('<' + nom + '(\\s|>|/)', 'gi');
  const ferme = new RegExp('</' + nom + '\\s*>', 'gi');
  let profondeur = 0;
  let pos = i;
  let tours = 0;
  while (pos < src.length && tours++ < 200000) {
    ouvre.lastIndex = pos;
    ferme.lastIndex = pos;
    const o = ouvre.exec(src);
    const f = ferme.exec(src);
    if (!f) return -1;
    if (o && o.index < f.index) {
      const finBalise = src.indexOf('>', o.index);
      if (finBalise !== -1 && src[finBalise - 1] === '/') { pos = finBalise + 1; continue; }
      profondeur++;
      pos = o.index + 1;
      continue;
    }
    profondeur--;
    pos = f.index + f[0].length;
    if (profondeur === 0) return pos;
  }
  return -1;
}

/* Les ancetres : on recule de balise ouvrante en balise ouvrante, et on
   garde celles dont le bloc couvre bien la position visee. */
function ancetres(src, index, combien) {
  const out = [];
  let curseur = index;
  let tours = 0;
  while (out.length < combien && curseur > 0 && tours++ < 5000) {
    const ouv = src.lastIndexOf('<', curseur - 1);
    if (ouv === -1) break;
    curseur = ouv;
    const nom = (src.slice(ouv + 1).match(/^([a-zA-Z][\w-]*)/) || [])[1];
    if (!nom || ['br', 'img', 'input', 'meta', 'link', 'hr', 'path', 'circle', 'span', 'i', 'b', 'em'].indexOf(nom.toLowerCase()) !== -1) continue;
    const finBalise = src.indexOf('>', ouv);
    if (finBalise === -1 || src[finBalise - 1] === '/') continue;
    const fin = finDuBloc(src, ouv, nom);
    if (fin === -1 || fin <= index) continue;
    const entete = src.slice(ouv, finBalise + 1);
    out.push({
      balise: nom,
      id: (entete.match(/id="([^"]+)"/) || [])[1] || null,
      classe: ((entete.match(/class="([^"]+)"/) || [])[1] || '').slice(0, 70) || null,
      ligne_debut: ligneDe(src, ouv),
      ligne_fin: ligneDe(src, fin),
      taille_ko: Math.round((fin - ouv) / 1024)
    });
  }
  return out;
}

/* ── 1. Les ancres ────────────────────────────────────────────── */

const ANCRES = [
  ['id="calendarGrid"', 'la grille'],
  ['id="propertyList"', 'la colonne des logements'],
  ['id="daysHeader"', 'la ligne des jours'],
  ['id="calendarSection"', 'une section nommee'],
  ['calendar-modern-header', "l'en-tete du composant"],
  ['calendar-header-top', 'sa barre haute'],
  ['id="prevPeriod"', 'la fleche mois precedent']
];

const trouvees = [];
ANCRES.forEach(function (a) {
  const i = app.indexOf(a[0]);
  if (i === -1) return;
  trouvees.push({
    ancre: a[0],
    quoi: a[1],
    ligne: ligneDe(app, i),
    occurrences: app.split(a[0]).length - 1,
    ancetres: ancetres(app, i, 5)
  });
});

/* ── 2. Qui pose bhCalRoot ────────────────────────────────────── */

const poseurs = [];
let p = app.indexOf('bhCalRoot');
while (p !== -1 && poseurs.length < 8) {
  const l1 = app.lastIndexOf('\n', p) + 1;
  const l2 = app.indexOf('\n', p);
  poseurs.push({ ligne: ligneDe(app, p), texte: app.slice(l1, l2 === -1 ? p + 90 : l2).trim().slice(0, 120) });
  p = app.indexOf('bhCalRoot', p + 1);
}

/* ── 3. La destination ────────────────────────────────────────── */

const srcsDe = (src) => Array.from(new Set(
  (src.match(/<script[^>]+src="([^"]+)"/g) || []).map(s => (s.match(/src="([^"]+)"/) || [])[1])
));
const srcsApp = srcsDe(app);
const srcsResa = srcsDe(resa);

const idsResa = [];
const reId = /id="([^"]+)"/g;
let mm;
while ((mm = reId.exec(resa)) !== null && idsResa.length < 60) {
  idsResa.push(mm[1] + ' (l.' + ligneDe(resa, mm.index) + ')');
}

/* Les sections de premier niveau de reservations.html : ce qu'on met
   de cote. On les prend dans <body>, un niveau sous lui. */
const corps = resa.indexOf('<body');
const sections = [];
if (corps !== -1) {
  const debutCorps = resa.indexOf('>', corps) + 1;
  let curseur = debutCorps;
  let tours = 0;
  while (curseur < resa.length && sections.length < 25 && tours++ < 4000) {
    const ouv = resa.indexOf('<', curseur);
    if (ouv === -1) break;
    const nom = (resa.slice(ouv + 1).match(/^([a-zA-Z][\w-]*)/) || [])[1];
    if (!nom) { curseur = ouv + 1; continue; }
    if (nom.toLowerCase() === '/body' || resa.slice(ouv, ouv + 7).toLowerCase() === '</body>') break;
    if (['script', 'style', 'noscript', 'template'].indexOf(nom.toLowerCase()) !== -1) {
      const f0 = resa.toLowerCase().indexOf('</' + nom.toLowerCase() + '>', ouv);
      curseur = f0 === -1 ? ouv + 1 : f0 + nom.length + 3;
      continue;
    }
    const finBalise = resa.indexOf('>', ouv);
    if (finBalise === -1) break;
    const fin = finDuBloc(resa, ouv, nom);
    if (fin === -1) { curseur = finBalise + 1; continue; }
    const entete = resa.slice(ouv, finBalise + 1);
    sections.push({
      balise: nom,
      id: (entete.match(/id="([^"]+)"/) || [])[1] || null,
      classe: ((entete.match(/class="([^"]+)"/) || [])[1] || '').slice(0, 60) || null,
      ligne_debut: ligneDe(resa, ouv),
      ligne_fin: ligneDe(resa, fin),
      taille_ko: Math.round((fin - ouv) / 1024)
    });
    curseur = fin;
  }
}

const rapport = {
  app: { taille_ko: Math.round(app.length / 1024), ancres: trouvees, poseurs_de_bhCalRoot: poseurs },
  reservations: {
    taille_ko: Math.round(resa.length / 1024),
    a_calendar_modern_js: srcsResa.some(s => /calendar-modern/.test(s)),
    sections_premier_niveau: sections,
    identifiants_1_a_60: idsResa,
    scripts: srcsResa,
    scripts_presents_dans_app_et_absents_ici: srcsApp.filter(s => srcsResa.indexOf(s) === -1)
  }
};

if (EXTRAIRE) {
  fs.writeFileSync(path.join(process.cwd(), 'outils', 'rapport-calendrier.json'), JSON.stringify(rapport, null, 2), 'utf8');
}

/* ── Le rapport ───────────────────────────────────────────────── */

console.log('\n— SONDE, AUCUNE MODIFICATION —');
console.log('  app.html ' + rapport.app.taille_ko + ' Ko  ·  reservations.html ' + rapport.reservations.taille_ko + ' Ko\n');

console.log('  ANCRES TROUVEES DANS app.html (' + trouvees.length + '/' + ANCRES.length + ')');
if (!trouvees.length) {
  console.log('    Aucune. Le calendrier est alors construit entierement en');
  console.log('    JavaScript, sans markup statique — ce qui change la reponse :');
  console.log('    il n\'y a rien a deplacer, il faut appeler le meme composant');
  console.log('    depuis reservations.html.');
} else {
  trouvees.forEach(function (t) {
    console.log('\n    ' + t.ancre + '  (' + t.quoi + ')  ligne ' + t.ligne
      + (t.occurrences > 1 ? '  [' + t.occurrences + ' occurrences]' : ''));
    t.ancetres.forEach(function (a, i) {
      console.log('      ancetre ' + (i + 1) + ' : <' + a.balise + '>'
        + (a.id ? ' #' + a.id : '') + (a.classe ? ' .' + a.classe.split(/\s+/).slice(0, 3).join('.') : '')
        + '  lignes ' + a.ligne_debut + '-' + a.ligne_fin + '  ' + a.taille_ko + ' Ko');
    });
  });
}

console.log('\n  QUI POSE bhCalRoot (' + poseurs.length + ' occurrence(s))');
poseurs.forEach(function (x) { console.log('    l.' + x.ligne + '  ' + x.texte); });
if (!poseurs.length) console.log('    Aucune : l\'identifiant vient d\'un module externe.');

console.log('\n  DESTINATION — reservations.html');
console.log('    calendar-modern.js charge ici : ' + (rapport.reservations.a_calendar_modern_js ? 'oui' : 'NON'));
console.log('    sections de premier niveau (' + sections.length + ') :');
sections.forEach(function (s) {
  console.log('      <' + s.balise + '>' + (s.id ? ' #' + s.id : '')
    + (s.classe ? ' .' + s.classe.split(/\s+/).slice(0, 2).join('.') : '')
    + '  lignes ' + s.ligne_debut + '-' + s.ligne_fin + '  ' + s.taille_ko + ' Ko');
});
console.log('    scripts absents ici et presents dans app.html : '
  + rapport.reservations.scripts_presents_dans_app_et_absents_ici.length);
rapport.reservations.scripts_presents_dans_app_et_absents_ici.slice(0, 12).forEach(function (s) {
  console.log('      ' + s);
});

console.log('\n  Collez-moi cette sortie. Elle me dit trois choses : ou commence');
console.log('  vraiment le calendrier, ce que reservations.html contient qu\'on');
console.log('  met de cote, et quels scripts il faudra lui donner.');
if (EXTRAIRE) console.log('\n  Ecrit : outils/rapport-calendrier.json (aucune page modifiee)\n');
else console.log('\n  --extraire depose le rapport complet en JSON.\n');
