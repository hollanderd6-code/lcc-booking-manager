#!/usr/bin/env node
/* ============================================================
   outils/refonte-11-inventaire-calendrier.js
   Lot 11 : ce qu'il faut emporter pour deplacer le calendrier
   ============================================================

   ── POURQUOI UN INVENTAIRE AVANT LE DEPLACEMENT ──────────────────
   « Le calendrier va dans l'onglet Calendrier » se dit en une phrase.
   Dans le code, c'est sortir un bloc de markup et le code qui l'anime
   de app.html — 775 Ko — pour les poser sur reservations.html.

   #bhCalRoot n'existe QUE dans app.html. Il n'y a rien a reutiliser sur
   reservations.html : tout doit voyager.

   Deplacer du markup sans le code qui le remplit donne un calendrier
   mort : les cases sont la, les prix n'arrivent jamais. C'est le genre
   de resultat qui a l'air d'un succes pendant dix secondes.

   Ce script NE MODIFIE RIEN. Il repond a trois questions :

       1. Ou commence et ou finit le bloc #bhCalRoot, exactement.
       2. Quels scripts de app.html le pilotent — et lesquels sont
          entrelaces avec le reste de la page.
       3. Ce que reservations.html a deja, et ce qui lui manque.

   Avec ces trois reponses, le lot 12 fait le deplacement en sachant ce
   qu'il transporte.

   ── OPTION ───────────────────────────────────────────────────────
   Avec --extraire, il ECRIT deux fichiers de travail, sans toucher a
   app.html ni a reservations.html :

       public/partials/bh-calendrier.html    le markup, tel quel
       outils/rapport-calendrier.json        l'analyse complete

   Usage :
     node outils/refonte-11-inventaire-calendrier.js
     node outils/refonte-11-inventaire-calendrier.js --extraire
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

/* ── 1. Le bloc #bhCalRoot, delimite par comptage de balises ──── */

const marque = app.indexOf('id="bhCalRoot"');
if (marque === -1) echec('id="bhCalRoot" introuvable dans app.html.');

const debut = app.lastIndexOf('<', marque);
if (debut === -1) echec('Balise ouvrante de #bhCalRoot introuvable.');
const nomBalise = (app.slice(debut + 1).match(/^([a-zA-Z][\w-]*)/) || [])[1];
if (!nomBalise) echec('Nom de balise illisible a la position ' + debut + '.');

/* Comptage des ouvertures et fermetures de la MEME balise. Les balises
   auto-fermantes et les commentaires sont ecartes : sans cela le compte
   derape et on emporte la moitie de la page. */
function finDuBloc(src, i, nom) {
  const ouvre = new RegExp('<' + nom + '(\\s|>|/)', 'gi');
  const ferme = new RegExp('</' + nom + '\\s*>', 'gi');
  let profondeur = 0;
  let pos = i;
  while (pos < src.length) {
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

const fin = finDuBloc(app, debut, nomBalise);
if (fin === -1) echec('Fermeture de #bhCalRoot introuvable — le comptage de balises n\'aboutit pas.');

const bloc = app.slice(debut, fin);
const ids = Array.from(new Set((bloc.match(/id="([^"]+)"/g) || []).map(s => s.slice(4, -1))));
const gestionnaires = Array.from(new Set(
  (bloc.match(/on[a-z]+="([^"(]+)\(/g) || []).map(s => s.replace(/^on[a-z]+="/, '').replace(/\($/, ''))
));

/* ── 2. Les scripts de app.html qui pilotent ce bloc ──────────── */

const MOTS = ['bhCalRoot', 'calendarGrid', 'propertyList', 'daysHeader', 'bhCalPeriodLabel',
  'bhMonthOuter', 'prevPeriod', 'nextPeriod', 'batchEditBtn'].concat(gestionnaires);

const scripts = [];
const reScript = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m;
while ((m = reScript.exec(app)) !== null) {
  const attrs = m[1] || '';
  const corps = m[2] || '';
  const srcAttr = (attrs.match(/src="([^"]+)"/) || [])[1] || null;
  if (srcAttr) continue;
  const touches = MOTS.filter(mot => corps.indexOf(mot) !== -1);
  if (!touches.length) continue;
  const fonctions = Array.from(new Set(
    (corps.match(/function\s+([A-Za-z_$][\w$]*)/g) || []).map(s => s.replace(/function\s+/, ''))
  ));
  scripts.push({
    ligne_debut: ligneDe(app, m.index),
    ligne_fin: ligneDe(app, m.index + m[0].length),
    taille_ko: Math.round(corps.length / 1024),
    mots_touches: touches,
    nb_fonctions: fonctions.length,
    fonctions_1_a_8: fonctions.slice(0, 8),
    /* Un script qui ne parle QUE du calendrier voyage seul. Un script
       qui parle aussi du reste de la page ne peut pas etre copie tel
       quel — il faudra en extraire la part calendrier. */
    dedie: fonctions.length > 0 && fonctions.every(f => /cal|month|day|period|property|price|tarif|resa/i.test(f))
  });
}

/* ── 3. Ce que reservations.html a deja ───────────────────────── */

const srcsDe = (src) => Array.from(new Set(
  (src.match(/<script[^>]+src="([^"]+)"/g) || []).map(s => (s.match(/src="([^"]+)"/) || [])[1])
));
const srcsApp = srcsDe(app);
const srcsResa = srcsDe(resa);
const manquants = srcsApp.filter(s => srcsResa.indexOf(s) === -1);
const idsPresents = ids.filter(id => resa.indexOf('id="' + id + '"') !== -1);

const rapport = {
  bloc: {
    balise: nomBalise,
    ligne_debut: ligneDe(app, debut),
    ligne_fin: ligneDe(app, fin),
    taille_ko: Math.round(bloc.length / 1024),
    identifiants: ids,
    gestionnaires_inline: gestionnaires
  },
  scripts_pilotes: scripts,
  destination: {
    identifiants_deja_presents: idsPresents,
    scripts_externes_manquants: manquants
  }
};

if (EXTRAIRE) {
  const dossier = path.join(PUBLIC, 'partials');
  if (!fs.existsSync(dossier)) fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, 'bh-calendrier.html'), bloc, 'utf8');
  fs.writeFileSync(path.join(process.cwd(), 'outils', 'rapport-calendrier.json'), JSON.stringify(rapport, null, 2), 'utf8');
}

/* ── Le rapport ───────────────────────────────────────────────── */

console.log('\n— INVENTAIRE, AUCUNE MODIFICATION —\n');
console.log('  LE BLOC');
console.log('    <' + nomBalise + ' id="bhCalRoot"> lignes ' + rapport.bloc.ligne_debut
  + ' a ' + rapport.bloc.ligne_fin + '  (' + rapport.bloc.taille_ko + ' Ko)');
console.log('    ' + ids.length + ' identifiants, ' + gestionnaires.length + ' gestionnaire(s) inline');
if (gestionnaires.length) console.log('    ' + gestionnaires.slice(0, 12).join(', '));

console.log('\n  LES SCRIPTS QUI LE PILOTENT (' + scripts.length + ')');
if (!scripts.length) {
  console.log('    Aucun script inline ne nomme ces identifiants.');
  console.log('    Le calendrier est donc pilote depuis un fichier externe,');
  console.log('    ou par du code genere. A verifier avant de deplacer.');
} else {
  scripts.forEach((s, i) => {
    console.log('    ' + (i + 1) + '. lignes ' + s.ligne_debut + '-' + s.ligne_fin
      + '  ' + s.taille_ko + ' Ko  ' + s.nb_fonctions + ' fonction(s)'
      + (s.dedie ? '   [dedie au calendrier]' : '   [MELE AU RESTE DE LA PAGE]'));
    console.log('       touche : ' + s.mots_touches.slice(0, 6).join(', '));
    if (s.fonctions_1_a_8.length) console.log('       ex. : ' + s.fonctions_1_a_8.join(', '));
  });
  const meles = scripts.filter(s => !s.dedie).length;
  if (meles) {
    console.log('\n    ' + meles + ' script(s) melent le calendrier et le reste de la page.');
    console.log('    Ceux-la ne se copient pas tels quels : les copier emporterait');
    console.log('    du code qui parle a des noeuds absents de reservations.html,');
    console.log('    et provoquerait des erreurs a chaque chargement.');
  }
}

console.log('\n  LA DESTINATION');
console.log('    reservations.html porte deja ' + idsPresents.length + ' des ' + ids.length + ' identifiants');
if (idsPresents.length) console.log('    ' + idsPresents.slice(0, 10).join(', '));
console.log('    ' + manquants.length + ' script(s) externe(s) presents dans app.html et absents ici');
if (manquants.length) console.log('    ' + manquants.slice(0, 10).join('\n    '));

console.log('\n  CE QUE J\'ATTENDS DE VOUS');
console.log('    Collez-moi ce rapport. Selon ce qu\'il dit, le lot 12 prendra');
console.log('    l\'une de deux routes :');
console.log('');
console.log('    - scripts dedies -> on sort markup et scripts dans un module');
console.log('      partage, charge par les deux pages. Un seul calendrier,');
console.log('      deux endroits ou il s\'affiche.');
console.log('');
console.log('    - scripts meles  -> on ne deplace pas, on remplace : la page');
console.log('      Calendrier a deja son propre calendrier, et c\'est lui');
console.log('      qu\'on amene au niveau de celui d\'Aujourd\'hui.');
console.log('');
if (EXTRAIRE) {
  console.log('  Ecrits (aucune page modifiee) :');
  console.log('    public/partials/bh-calendrier.html');
  console.log('    outils/rapport-calendrier.json\n');
} else {
  console.log('  Relancez avec --extraire pour ecrire le markup et le rapport.\n');
}
