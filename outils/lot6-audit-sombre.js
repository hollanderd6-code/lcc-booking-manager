#!/usr/bin/env node
/* ============================================================
   LOT 6 — Combien coute reellement le mode sombre ?
   ============================================================
   L'audit initial disait : « le mode sombre est ecrit, puis cache ».
   C'etait faux. La mesure donne :

     style.css        205 regles,   0 sombre   (28 pages en dependent)
     bh-theme-v3.css  320 regles,  39 sombres  (12 %)
     bh-core.css       58 regles,   0 sombre   (et il cache le bouton)
     bh-lux.css        42 regles,   7 sombres  (2 pages seulement)

   Le commentaire de bh-core.css — « couverture incomplete » — avait
   donc raison : masquer le bouton etait la bonne decision.

   Restait un angle mort : les 87 blocs de CSS ecrits DANS les pages,
   829 Ko au total. C'est ce que ce script mesure.

   Une couleur « en dur » est une couleur qui ne suivra pas le theme :
   il faudra soit la remplacer par un jeton, soit lui ecrire une
   variante sombre. Une couleur passee par var(--x) suit toute seule
   des que le jeton a une valeur sombre — c'est le levier.

   Le script ne modifie rien. Il classe le travail par fichier, du
   plus couteux au moins couteux.

   Usage :
     node outils/lot6-audit-sombre.js
     node outils/lot6-audit-sombre.js --detail   (liste les couleurs)
   ============================================================ */

const fs = require('fs');
const path = require('path');

const RACINE = process.cwd();
const PUBLIC = path.join(RACINE, 'public');
const DETAIL = process.argv.includes('--detail');

if (!fs.existsSync(PUBLIC)) {
  console.error('public/ introuvable — lancez depuis la racine du depot.');
  process.exit(1);
}

/* Couleurs qui n'ont pas besoin de variante sombre : elles sont
   deliberement les memes dans les deux themes. */
const NEUTRES = /^(transparent|inherit|currentcolor|none|initial|unset)$/i;
const estBlancPur = (c) => /^#f{3,8}$/i.test(c.replace(/\s/g, ''))
  || /^rgba?\(\s*255\s*,\s*255\s*,\s*255/i.test(c);
const estNoirPur = (c) => /^#0{3,8}$/i.test(c.replace(/\s/g, ''))
  || /^rgba?\(\s*0\s*,\s*0\s*,\s*0/i.test(c);

/* Une couleur sur fond translucide (alpha < .5) traverse souvent bien
   les deux themes : on la compte a part plutot que comme un du. */
function alphaDe(c) {
  const m = c.match(/rgba?\([^)]*,\s*([\d.]+)\s*\)/i);
  if (m) return parseFloat(m[1]);
  const h = c.match(/^#[0-9a-f]{8}$/i);
  if (h) return parseInt(c.slice(7, 9), 16) / 255;
  return 1;
}

const RE_COULEUR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;

function analyser(css) {
  const sansCom = css.replace(/\/\*[\s\S]*?\*\//g, '');

  // on ignore ce qui est deja dans un bloc sombre
  const blocsSombres = [];
  const reBloc = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  let dejaSombre = 0;
  const dur = [], translucides = [];

  while ((m = reBloc.exec(sansCom)) !== null) {
    const sel = m[1].replace(/\s+/g, ' ').trim();
    const corps = m[2];
    const sombre = /data-theme=["']?dark|prefers-color-scheme:\s*dark/.test(sel);
    const couleurs = corps.match(RE_COULEUR) || [];
    for (const c of couleurs) {
      if (NEUTRES.test(c)) continue;
      if (sombre) { dejaSombre++; continue; }
      if (estBlancPur(c) || estNoirPur(c)) { /* compte quand meme : un blanc pur eblouit */ }
      if (alphaDe(c) < 0.5) { translucides.push(c); continue; }
      dur.push(c);
    }
  }

  const viaJeton = (sansCom.match(/var\(\s*--/g) || []).length;
  const mediaDark = (sansCom.match(/prefers-color-scheme\s*:\s*dark/gi) || []).length;

  return { dur, translucides, dejaSombre, viaJeton, mediaDark };
}

/* ── Collecte ────────────────────────────────────────────────────── */
const lignes = [];

// 1. Les feuilles
const dirCss = path.join(PUBLIC, 'css');
if (fs.existsSync(dirCss)) {
  for (const f of fs.readdirSync(dirCss)) {
    if (!f.endsWith('.css')) continue;
    const p = path.join(dirCss, f);
    if (!fs.statSync(p).isFile()) continue;
    const r = analyser(fs.readFileSync(p, 'utf8'));
    lignes.push({ nom: 'css/' + f, type: 'feuille', ...r });
  }
}

// 2. Le CSS ecrit dans les pages
for (const f of fs.readdirSync(PUBLIC)) {
  if (!f.endsWith('.html')) continue;
  const html = fs.readFileSync(path.join(PUBLIC, f), 'utf8');
  const blocs = html.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || [];
  if (!blocs.length) continue;
  const css = blocs.map(b => b.replace(/^<style[^>]*>/i, '').replace(/<\/style>$/i, '')).join('\n');
  const r = analyser(css);
  lignes.push({ nom: f, type: 'page', blocs: blocs.length, octets: css.length, ...r });
}

/* ── Rapport ────────────────────────────────────────────────────── */
const cout = (l) => l.dur.length;
lignes.sort((a, b) => cout(b) - cout(a));

const tot = (k) => lignes.reduce((n, l) => n + (Array.isArray(l[k]) ? l[k].length : l[k]), 0);

console.log('COUT REEL DU MODE SOMBRE\n');
console.log('Une couleur « en dur » ne suivra pas le theme : il faut soit la');
console.log('remplacer par un jeton, soit lui ecrire une variante sombre.');
console.log('Une couleur passee par var() suit toute seule des que le jeton a');
console.log('une valeur sombre — c\'est le levier a privilegier.\n');

console.log('  ' + 'FICHIER'.padEnd(34) + 'EN DUR'.padStart(7) + 'TRANSLU.'.padStart(9)
  + 'VIA var()'.padStart(10) + 'DEJA SOMBRE'.padStart(12));
console.log('  ' + '─'.repeat(72));
for (const l of lignes) {
  if (!l.dur.length && !l.dejaSombre && !l.viaJeton) continue;
  console.log('  ' + l.nom.padEnd(34)
    + String(l.dur.length).padStart(7)
    + String(l.translucides.length).padStart(9)
    + String(l.viaJeton).padStart(10)
    + String(l.dejaSombre).padStart(12));
}

console.log('  ' + '─'.repeat(72));
console.log('  ' + 'TOTAL'.padEnd(34)
  + String(tot('dur')).padStart(7)
  + String(tot('translucides')).padStart(9)
  + String(tot('viaJeton')).padStart(10)
  + String(tot('dejaSombre')).padStart(12));

const feuilles = lignes.filter(l => l.type === 'feuille');
const pagesL = lignes.filter(l => l.type === 'page');
console.log('\nRepartition du travail :');
console.log('  dans les feuilles ..... ' + feuilles.reduce((n, l) => n + l.dur.length, 0) + ' couleurs en dur, ' + feuilles.length + ' fichiers');
console.log('  dans les pages ........ ' + pagesL.reduce((n, l) => n + l.dur.length, 0) + ' couleurs en dur, ' + pagesL.length + ' pages');

console.log('\nCE QUE CELA VEUT DIRE');
console.log('Les feuilles se traitent une fois et profitent a toutes les pages.');
console.log('Les couleurs ecrites dans les pages doivent etre reprises page par');
console.log('page : c\'est la que se trouve le vrai cout, et c\'est pourquoi le');
console.log('bouton de theme est masque aujourd\'hui plutot qu\'a moitie fonctionnel.');
console.log('\nORDRE CONSEILLE');
console.log('  1. valeurs sombres des jetons dans bh-tokens.css (fait : lot 6a)');
console.log('  2. les 3-4 feuilles en tete de ce tableau');
console.log('  3. les pages, par ordre de fréquentation reelle');
console.log('  4. rendre le bouton visible seulement une fois 2 et 3 faits');

if (DETAIL) {
  console.log('\n\nDETAIL — couleurs en dur les plus repandues');
  const compte = new Map();
  for (const l of lignes) for (const c of l.dur) {
    const k = c.toLowerCase().replace(/\s+/g, '');
    compte.set(k, (compte.get(k) || 0) + 1);
  }
  const top = [...compte.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
  for (const [c, n] of top) console.log('  ' + String(n).padStart(4) + '  ' + c);
  console.log('\nLes plus frequentes valent un jeton : une seule correction pour');
  console.log('toutes leurs occurrences.');
}
