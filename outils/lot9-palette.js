#!/usr/bin/env node
/* ============================================================
   LOT 9 — Resserrer la palette
   ============================================================
   Le lot 7 a remplace les couleurs STRICTEMENT egales a un jeton.
   Restent celles qui en sont proches sans l'egaler. Mesurees en
   distance perceptuelle (dE, CIELAB), elles se separent en deux
   familles tres differentes :

   DOUBLONS INVOLONTAIRES — dE < 6, invisibles a l'oeil
       #f5f0e8   68x   dE 0.7 de --bh-creme
       #fafaf8   34x   dE 0.6 de --bh-fond
       #f9fafb   41x   dE 1.1 de --bh-fond
       #f5f2ec   92x   dE 1.1 de --bh-creme
       #faf7f2   21x   dE 1.9 de --bh-cote
       #fbf8f3   19x   dE 1.9 de --bh-cote
       #f3f4f6   65x   dE 2.3 de --bh-cote
       #dce9e3   25x   dE 2.3 de --vert-100
       #e5e7eb  115x   dE 4.3 de --bh-ligne
       #15624b   64x   dE 5.5 de --vert-600
     544 occurrences. Personne n'a CHOISI ces variantes : cinq cremes
     a moins de 2 dE l'une de l'autre, c'est de la derive, pas du
     design. Les unifier ne se voit pas et supprime le desordre.

   VRAI CHANGEMENT — dE > 9, visible
       #374151  104x   dE 18.1 de --bh-t2
       #6b7280   92x   dE 15.7 de --bh-t2
       #111827   63x   dE 14.3 de --bh-encre
       #7a8695   87x   dE 13.4 de --bh-t3
       #9ca3af   81x   dE 12.4 de --bh-t4 -> reoriente vers --bh-t3
       #d1d5db   41x   dE  9.0 de --bh-ligne
     468 occurrences. Ces gris sont FROIDS, les jetons sont CHAUDS :
     l'ecart est surtout une affaire de teinte. Les ramener a la marque
     est exactement l'effet recherche — mais cela se voit, ecran par
     ecran. C'est une decision, pas un nettoyage.

   Par defaut, le script ne traite que la premiere famille.
   --gris ajoute la seconde.

   Usage :
     node outils/lot9-palette.js --essai
     node outils/lot9-palette.js
     node outils/lot9-palette.js --gris --essai
   ============================================================ */

const fs = require('fs');
const path = require('path');

const RACINE = process.cwd();
const PUBLIC = path.join(RACINE, 'public');
const CSS = path.join(PUBLIC, 'css');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const GRIS  = process.argv.includes('--gris');

if (!fs.existsSync(path.join(CSS, 'bh-tokens.css'))) {
  console.error('\n  \u2717 public/css/bh-tokens.css introuvable : lancez le lot 2 d\'abord.\n');
  process.exit(1);
}

/* ── Les correspondances, decidees a partir de la mesure ──────────── */
const DOUBLONS = {
  '#f5f2ec': '--bh-creme',
  '#f5f0e8': '--bh-creme',
  '#fafaf8': '--bh-fond',
  '#f9fafb': '--bh-fond',
  '#faf7f2': '--bh-cote',
  '#fbf8f3': '--bh-cote',
  '#f3f4f6': '--bh-cote',
  '#dce9e3': '--vert-100',
  '#e5e7eb': '--bh-ligne',
  '#15624b': '--vert-600'
};

const GRIS_FROIDS = {
  '#111827': '--bh-encre',
  '#374151': '--bh-t2',
  '#6b7280': '--bh-t2',
  '#7a8695': '--bh-t3',
  '#9ca3af': '--bh-t3',
  '#d1d5db': '--bh-ligne'
};

const TABLE = GRIS ? Object.assign({}, DOUBLONS, GRIS_FROIDS) : DOUBLONS;

/* ── Les memes exclusions que les lots precedents ─────────────────── */
const estSelecteur = (l) => /\[\s*(style|class)\s*[*^$~|]?=/i.test(l);
const estJeton     = (l) => /^\s*--[a-z0-9-]+\s*:/i.test(l);

const RE_HEX = /#[0-9a-fA-F]{3,8}\b/g;

/* Les commentaires ne doivent PAS etre reecrits. La v1 les traitait comme du
   code : elle a transforme « les gris froids (#6b7280, #e5e7eb...) » en
   « (#6b7280, #eae9e5...) », rendant la documentation fausse.
   On isole donc les commentaires, on traite le reste, on les remet. */
function horsCommentaires(css, fn) {
  const gardes = [];
  const masque = css.replace(/\/\*[\s\S]*?\*\//g, (c) => {
    gardes.push(c);
    return '\u0000C' + (gardes.length - 1) + '\u0000';
  });
  const traite = fn(masque);
  return traite.replace(/\u0000C(\d+)\u0000/g, (t, i) => gardes[+i]);
}

/* Deux couleurs DIFFERENTES d'un meme fichier qui pointent vers le MEME jeton
   etaient peut-etre distinctes a dessein. Sur smart-locks.html la v1 a fait
   fondre --sl-bg (#f5f2ec) et --sl-card (#f5f0e8) en une seule valeur : les
   cartes ne se detachaient plus de leur fond. On detecte la collision et on
   laisse les deux tranquilles, en les signalant. */
function collisions(css) {
  const vues = {};
  const sansCom = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let m;
  const re = new RegExp(RE_HEX.source, 'g');
  while ((m = re.exec(sansCom)) !== null) {
    let v = m[0].toLowerCase();
    if (v.length === 4) v = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    const j = TABLE[v];
    if (!j) continue;
    (vues[j] = vues[j] || new Set()).add(v);
  }
  const bloquees = new Set();
  const paires = [];
  for (const j in vues) {
    if (vues[j].size > 1) {
      paires.push(j + ' <- ' + [...vues[j]].join(' + '));
      for (const v of vues[j]) bloquees.add(v);
    }
  }
  return { bloquees, paires };
}

function traiter(css, st) {
  const col = collisions(css);
  for (const p of col.paires) st.collisions.push(p);

  return horsCommentaires(css, (corps) => corps.split('\n').map((ligne) => {
    if (estSelecteur(ligne)) { st.selecteurs++; return ligne; }
    if (estJeton(ligne))     { st.jetons++;     return ligne; }
    return ligne.replace(RE_HEX, (hex) => {
      let v = hex.toLowerCase();
      if (v.length === 4) v = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
      if (v.length === 9) return hex;                       // alpha : intact
      const j = TABLE[v];
      if (!j) return hex;
      if (col.bloquees.has(v)) { st.bloquees++; return hex; }
      st.parCouleur[v] = (st.parCouleur[v] || 0) + 1;
      return 'var(' + j + ')';
    });
  }).join('\n'));
}

const neuf = () => ({ parCouleur: {}, selecteurs: 0, jetons: 0, bloquees: 0, collisions: [] });
const cumul = neuf();
const fichiers = [];

function fusionner(st) {
  for (const k in st.parCouleur) cumul.parCouleur[k] = (cumul.parCouleur[k] || 0) + st.parCouleur[k];
  cumul.selecteurs += st.selecteurs;
  cumul.jetons += st.jetons;
  cumul.bloquees += st.bloquees;
  for (const p of st.collisions) if (cumul.collisions.indexOf(p) === -1) cumul.collisions.push(p);
}
const somme = (o) => Object.values(o).reduce((a, b) => a + b, 0);

/* 1. Les feuilles, sauf le fichier de jetons */
for (const f of fs.readdirSync(CSS)) {
  if (!f.endsWith('.css') || f === 'bh-tokens.css') continue;
  const p = path.join(CSS, f);
  if (!fs.statSync(p).isFile()) continue;
  const avant = fs.readFileSync(p, 'utf8');
  const st = neuf();
  const apres = traiter(avant, st);
  const n = somme(st.parCouleur);
  if (n) { if (!ESSAI) fs.writeFileSync(p, apres, 'utf8'); fichiers.push({ nom: 'css/' + f, n }); }
  fusionner(st);
}

/* 2. Le CSS ecrit dans les pages */
for (const f of fs.readdirSync(PUBLIC)) {
  if (!f.endsWith('.html')) continue;
  const p = path.join(PUBLIC, f);
  const avant = fs.readFileSync(p, 'utf8');
  const st = neuf();
  const apres = avant.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (t, o, corps, c) => o + traiter(corps, st) + c);
  const n = somme(st.parCouleur);
  if (n) { if (!ESSAI) fs.writeFileSync(p, apres, 'utf8'); fichiers.push({ nom: f, n }); }
  fusionner(st);
}

/* ── Rapport ─────────────────────────────────────────────────────── */
console.log((ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLICATION —'));
console.log(GRIS
  ? 'Familles traitees : doublons involontaires ET gris froids.\n'
  : 'Famille traitee : doublons involontaires seulement.\n');

console.log('PAR COULEUR');
for (const [c, n] of Object.entries(cumul.parCouleur).sort((a, b) => b[1] - a[1])) {
  console.log('  ' + String(n).padStart(5) + '  ' + c + '  ->  ' + TABLE[c]);
}

console.log('\nPAR FICHIER (15 premiers)');
for (const f of fichiers.sort((a, b) => b.n - a.n).slice(0, 15)) {
  console.log('  ' + String(f.n).padStart(5) + '  ' + f.nom);
}
console.log('  ' + fichiers.length + ' fichiers touches');

console.log('\n' + '─'.repeat(60));
console.log('Occurrences remplacees ......... ' + somme(cumul.parCouleur));
console.log('Selecteurs d\'attribut evites .. ' + cumul.selecteurs);
console.log('Declarations de jeton evitees .. ' + cumul.jetons);
console.log('Laissees pour collision ........ ' + cumul.bloquees);

if (cumul.collisions.length) {
  console.log('\nCOLLISIONS EVITEES — deux couleurs proches d\'un meme fichier');
  console.log('visaient le meme jeton. Les fondre en une seule ferait perdre une');
  console.log('distinction voulue (une carte qui se detache de son fond, par ex.).');
  console.log('Elles sont laissees en place ; a arbitrer a l\'oeil :');
  for (const p of cumul.collisions) console.log('    ' + p);
}

if (!GRIS) {
  console.log('\nLes 468 occurrences de gris froids ne sont PAS traitees.');
  console.log('Elles changent visiblement le rendu — les gris passent du froid');
  console.log('au chaud. Pour les voir : node outils/lot9-palette.js --gris --essai');
} else {
  console.log('\nA REGARDER ECRAN PAR ECRAN : les gris passent du froid au chaud.');
  console.log('C\'est le resserrement de la marque, et il se voit. Retour arriere :');
  console.log('  git checkout -- public/');
}

if (ESSAI) console.log('\nEssai termine — rien n\'a ete ecrit.');
