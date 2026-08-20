#!/usr/bin/env node
/* ============================================================
   LOT 7 — Rendre la marque pilotable
   ============================================================
   L'audit du lot 6 a montre 3 904 couleurs ecrites en dur. En les
   comptant par valeur, un fait ressort :

       #0e3b2e   603 fois     c'est --vert-800
       #0a2c22   117 fois     c'est --vert-900
       #8fc7af    86 fois     c'est --vert-300
       #f1f6f3    28 fois     c'est --vert-050
       #1e6e52    22 fois     c'est --vert-600
       #eae9e5    18 fois     c'est --bh-ligne

   Pres de 900 occurrences de couleurs qui ONT DEJA un jeton, ecrites
   en litteral. Les remplacer ne change RIEN a l'ecran — valeur pour
   valeur — et rend la marque modifiable depuis un seul fichier.
   C'est aussi ce qui rendra le mode sombre presque gratuit.

   ── CE QUE FAIT CE SCRIPT ────────────────────────────────────────
   Il lit la table des jetons dans bh-tokens.css, puis remplace dans
   les feuilles et dans le CSS des pages toute couleur STRICTEMENT
   EGALE a la valeur d'un jeton par var(--ce-jeton).

   ── CE QU'IL NE FAIT PAS, ET POURQUOI ────────────────────────────
   - le blanc et le noir purs : --bh-panneau vaut #FFFFFF, mais un
     lisere blanc sur une photo n'est pas un « panneau ». Remplacer
     mecaniquement donnerait un code trompeur ;
   - les selecteurs d'attribut ([style*="color:#0D1117"]) : la regle
     deviendrait morte, elle ne correspondrait plus a rien ;
   - toute couleur DIFFERENTE d'un jeton. #0d1117 (123 fois),
     #15624b (64 fois), les cinq cremes et les gris Tailwind sont
     seulement SIGNALES : les remplacer changerait le rendu, c'est
     une decision, pas une reecriture.

   Usage :
     node outils/lot7-marque.js --essai
     node outils/lot7-marque.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const RACINE = process.cwd();
const PUBLIC = path.join(RACINE, 'public');
const CSS = path.join(PUBLIC, 'css');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

const fTokens = path.join(CSS, 'bh-tokens.css');
if (!fs.existsSync(fTokens)) {
  console.error('\n  \u2717 public/css/bh-tokens.css introuvable : lancez les lots 2 et 6a d\'abord.\n');
  process.exit(1);
}

/* ── La table des jetons, lue a la source ────────────────────────── */
const srcTokens = fs.readFileSync(fTokens, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const iRoot = srcTokens.indexOf(':root');
const iDark = srcTokens.indexOf('html[data-theme="dark"]');
const blocClair = srcTokens.slice(iRoot, iDark > 0 ? iDark : srcTokens.length);

const jetons = new Map();               // nom -> valeur litterale
{
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m;
  while ((m = re.exec(blocClair)) !== null) jetons.set(m[1], m[2].trim());
}
const resoudre = (v, p = 0) => p > 10 ? v :
  v.replace(/var\(\s*(--[a-z0-9-]+)\s*\)/gi, (t, n) => jetons.has(n) ? resoudre(jetons.get(n), p + 1) : t).trim();

/* Valeur normalisee -> nom de jeton.
   L'ordre de preference compte : une premiere version de ce script a
   choisi « le nom le plus court » et a retenu --jade pour le vert de
   marque et --text-1 pour l'encre — c'est-a-dire justement les noms
   HISTORIQUES que le lot 2 cherchait a retirer. Ecrire var(--jade)
   603 fois les aurait graves dans le code.

   Priorite retenue :
     1. la couche semantique --bh-* (« le vert de marque », « l'encre ») ;
     2. l'echelle --vert-* quand aucun alias semantique n'existe ;
     3. jamais les ponts historiques.                                */
const PONTS = new Set(['--jade', '--jade-light', '--primary-color', '--primary-hover', '--primary-dark', '--text-1', '--obsidian']);
const rang = (nom) => PONTS.has(nom) ? 3 : (nom.startsWith('--bh-') ? 0 : 1);

const BLANC_NOIR = new Set(['#ffffff', '#000000']);
const parValeur = new Map();
for (const [nom, brut] of jetons) {
  let v = resoudre(brut).toLowerCase();
  if (!/^#[0-9a-f]{3,6}$/.test(v)) continue;
  if (v.length === 4) v = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
  if (BLANC_NOIR.has(v)) continue;
  const actuel = parValeur.get(v);
  if (!actuel) { parValeur.set(v, nom); continue; }
  const ra = rang(nom), rb = rang(actuel);
  if (ra < rb || (ra === rb && nom.length < actuel.length)) parValeur.set(v, nom);
}
// Un pont n'est jamais une cible de remplacement.
for (const [v, nom] of [...parValeur]) if (PONTS.has(nom)) parValeur.delete(v);

/* ── Remplacement dans un fragment de CSS ────────────────────────── */
const RE_HEX = /#[0-9a-fA-F]{3,8}\b/g;
const estSelecteurAttribut = (ligne) => /\[\s*(style|class)\s*[*^$~|]?=/i.test(ligne);

function traiterCss(css, stats) {
  return css.split('\n').map((ligne) => {
    if (estSelecteurAttribut(ligne)) { stats.selecteursIgnores++; return ligne; }
    return ligne.replace(RE_HEX, (hex) => {
      let v = hex.toLowerCase();
      if (v.length === 4) v = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
      if (v.length === 9) { stats.alphaIgnores++; return hex; }   // #rrggbbaa : laisse tel quel
      const jeton = parValeur.get(v);
      if (!jeton) { stats.sansJeton.set(v, (stats.sansJeton.get(v) || 0) + 1); return hex; }
      stats.remplaces.set(jeton, (stats.remplaces.get(jeton) || 0) + 1);
      return 'var(' + jeton + ')';
    });
  }).join('\n');
}

/* ── Parcours ────────────────────────────────────────────────────── */
const stats = { remplaces: new Map(), sansJeton: new Map(), selecteursIgnores: 0, alphaIgnores: 0 };
const parFichier = [];

// 1. Les feuilles, sauf bh-tokens.css lui-meme
for (const f of fs.readdirSync(CSS)) {
  if (!f.endsWith('.css') || f === 'bh-tokens.css') continue;
  const p = path.join(CSS, f);
  if (!fs.statSync(p).isFile()) continue;
  const avant = fs.readFileSync(p, 'utf8');
  const local = { remplaces: new Map(), sansJeton: new Map(), selecteursIgnores: 0, alphaIgnores: 0 };
  const apres = traiterCss(avant, local);
  const n = [...local.remplaces.values()].reduce((a, b) => a + b, 0);
  if (n) {
    if (!ESSAI) fs.writeFileSync(p, apres, 'utf8');
    parFichier.push({ nom: 'css/' + f, n });
  }
  for (const [k, v] of local.remplaces) stats.remplaces.set(k, (stats.remplaces.get(k) || 0) + v);
  for (const [k, v] of local.sansJeton) stats.sansJeton.set(k, (stats.sansJeton.get(k) || 0) + v);
  stats.selecteursIgnores += local.selecteursIgnores;
  stats.alphaIgnores += local.alphaIgnores;
}

// 2. Le CSS ecrit dans les pages, blocs <style> uniquement.
//    Les attributs style="" du HTML ne sont PAS touches : ils sont trop
//    lies au contenu, et une erreur y serait invisible a la relecture.
for (const f of fs.readdirSync(PUBLIC)) {
  if (!f.endsWith('.html')) continue;
  const p = path.join(PUBLIC, f);
  const avant = fs.readFileSync(p, 'utf8');
  const local = { remplaces: new Map(), sansJeton: new Map(), selecteursIgnores: 0, alphaIgnores: 0 };
  const apres = avant.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (t, o, corps, c) => o + traiterCss(corps, local) + c);
  const n = [...local.remplaces.values()].reduce((a, b) => a + b, 0);
  if (n) {
    if (!ESSAI) fs.writeFileSync(p, apres, 'utf8');
    parFichier.push({ nom: f, n });
  }
  for (const [k, v] of local.remplaces) stats.remplaces.set(k, (stats.remplaces.get(k) || 0) + v);
  for (const [k, v] of local.sansJeton) stats.sansJeton.set(k, (stats.sansJeton.get(k) || 0) + v);
  stats.selecteursIgnores += local.selecteursIgnores;
  stats.alphaIgnores += local.alphaIgnores;
}

/* ── Rapport ─────────────────────────────────────────────────────── */
const total = [...stats.remplaces.values()].reduce((a, b) => a + b, 0);

console.log((ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLICATION —'));
console.log('Remplacement a valeur EGALE : le rendu ne change pas.\n');

console.log('PAR JETON');
for (const [j, n] of [...stats.remplaces.entries()].sort((a, b) => b[1] - a[1])) {
  console.log('  ' + String(n).padStart(5) + '  ' + j.padEnd(20) + resoudre(jetons.get(j)));
}

console.log('\nPAR FICHIER (les 15 premiers)');
for (const f of parFichier.sort((a, b) => b.n - a.n).slice(0, 15)) {
  console.log('  ' + String(f.n).padStart(5) + '  ' + f.nom);
}
console.log('  ' + parFichier.length + ' fichiers touches au total');

console.log('\n' + '─'.repeat(64));
console.log('Occurrences remplacees ......... ' + total);
console.log('Selecteurs d\'attribut evites ... ' + stats.selecteursIgnores);
console.log('Couleurs a alpha laissees ...... ' + stats.alphaIgnores);

/* ── Ce qui reste, et qui demande une decision ───────────────────── */
const restant = [...stats.sansJeton.entries()]
  .filter(([v]) => !BLANC_NOIR.has(v) && v !== '#fff' && v !== '#000')
  .sort((a, b) => b[1] - a[1]).slice(0, 20);

if (restant.length) {
  console.log('\nA DECIDER — couleurs sans jeton equivalent. Les remplacer');
  console.log('CHANGERAIT le rendu : c\'est un arbitrage, pas une reecriture.');
  const proches = {
    '#0d1117': 'ancienne encre froide — le lot 2b l\'a corrigee dans les feuilles, pas ici',
    '#15624b': 'vert hors echelle — entre --vert-800 et --vert-600',
    '#f5f2ec': 'creme n\u00b01 — quatre autres cremes voisines coexistent',
    '#f5f0e8': 'creme n\u00b02',
    '#fafaf8': 'creme n\u00b03',
    '#faf7f2': 'creme n\u00b04',
    '#fbf8f3': 'creme n\u00b05',
    '#e5e7eb': 'gris Tailwind — proche de --bh-ligne #EAE9E5',
    '#374151': 'gris Tailwind — proche de --bh-t2',
    '#6b7280': 'gris Tailwind — proche de --bh-t2 #5A5A54',
    '#9ca3af': 'gris Tailwind — proche de --bh-t3 #8B8B84',
    '#111827': 'gris Tailwind — proche de --bh-encre',
    '#7a8695': 'gris froid hors palette',
    '#f3f4f6': 'gris Tailwind — proche de --bh-cote'
  };
  for (const [v, n] of restant) {
    console.log('  ' + String(n).padStart(5) + '  ' + v.padEnd(10) + (proches[v] || ''));
  }
  console.log('\n  Les cinq cremes et les gris Tailwind sont la vraie derive de');
  console.log('  palette. Les ramener aux jetons resserre la marque, mais se voit :');
  console.log('  a faire famille par famille, en regardant l\'ecran.');
}

if (ESSAI) console.log('\nEssai termine — rien n\'a ete ecrit.');
console.log('\nVerification apres application : node outils/lot7-verifier.js');
