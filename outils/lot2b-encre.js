#!/usr/bin/env node
/* ============================================================
   LOT 2b — Le noir de texte code en dur
   ============================================================
   L'ancien noir froid #0D1117 est ecrit en dur dans les feuilles
   actives, souvent avec !important. Maintenant que --bh-encre vaut
   le brun-noir chaud #20221F, ces occurrences resteraient froides :
   le produit afficherait deux noirs selon l'endroit.

   Ce script les remplace par var(--bh-encre), et les rgba(13,17,23)
   par l'equivalent chaud rgba(32,34,31) a alpha identique.

   Ce qu'il NE touche pas :
     - public/css/_archive/  (fichiers morts, supprimes au lot 5) ;
     - les blocs de mode sombre, ou #0D1117 sert de FOND et non de
       texte : l'y remplacer eclaircirait le fond. Ils sont listes
       en fin de rapport pour traitement manuel.

   Usage :
     node outils/lot2b-encre.js --essai
     node outils/lot2b-encre.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CSS = path.join(process.cwd(), 'public', 'css');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

if (!fs.existsSync(path.join(CSS, 'bh-tokens.css'))) {
  console.error('\n  \u2717 public/css/bh-tokens.css introuvable : lancez le lot 2 d\'abord.\n');
  process.exit(1);
}

/* Trois familles de lignes qu'il ne faut PAS toucher. */

// 1. Un selecteur d'attribut : [style*="color:#0D1117"] cible les styles en
//    ligne du HTML. Y mettre var(--bh-encre) ne casserait pas le CSS, mais le
//    selecteur ne correspondrait plus a rien : la regle deviendrait morte.
const estSelecteur = (ligne) => /\[\s*style\s*\*?=|\[\s*class\s*\*?=/i.test(ligne);

// 2. Une declaration de jeton (--x: #0D1117). Inutile d'y toucher : le pont
//    pose dans bh-tokens.css redirige deja --text-1 et --obsidian vers
//    l'encre. Et --cream vaut #0D1117 en mode sombre, ou c'est un FOND :
//    le remplacer eclaircirait le fond sombre.
const estJeton = (ligne) => /^\s*--[a-z0-9-]+\s*:/i.test(ligne);

// 3. Un fond explicite.
const estFond = (ligne) => /background(-color)?\s*:/i.test(ligne);

const fichiers = fs.readdirSync(CSS).filter(f => f.endsWith('.css') && f !== 'bh-tokens.css');
let totalTexte = 0, totalRgba = 0;
const reportes = [];
const ignores = [];

for (const f of fichiers) {
  const p = path.join(CSS, f);
  const src = fs.readFileSync(p, 'utf8');
  const lignes = src.split('\n');
  let texte = 0, rgba = 0;

  const sortie = lignes.map((l, i) => {
    let out = l;

    if (/#0D1117/i.test(out)) {
      if (estSelecteur(out)) {
        ignores.push(f + ':' + (i + 1) + '  selecteur d\'attribut  ' + l.trim().slice(0, 74));
      } else if (estJeton(out)) {
        ignores.push(f + ':' + (i + 1) + '  declaration de jeton   ' + l.trim().slice(0, 74));
      } else if (estFond(out)) {
        reportes.push(f + ':' + (i + 1) + '  ' + l.trim().slice(0, 96));
      } else {
        out = out.replace(/#0D1117/gi, 'var(--bh-encre)');
        texte++;
      }
    }

    /* rgba(13,17,23,a) -> rgba(32,34,31,a). Les ombres et bordures
       derivees du noir froid doivent suivre l'encre chaude, sinon
       elles bleuissent legerement sur les fonds creme. */
    if (/rgba\(\s*13\s*,\s*17\s*,\s*23\s*,/i.test(out)) {
      out = out.replace(/rgba\(\s*13\s*,\s*17\s*,\s*23\s*,/gi, 'rgba(32,34,31,');
      rgba++;
    }

    return out;
  }).join('\n');

  if (texte || rgba) {
    if (!ESSAI) fs.writeFileSync(p, sortie, 'utf8');
    console.log('  ' + f.padEnd(26)
      + (texte ? texte + ' couleur(s) de texte' : '').padEnd(22)
      + (rgba ? rgba + ' rgba derive(s)' : ''));
    totalTexte += texte; totalRgba += rgba;
  }
}

console.log('\n' + '\u2500'.repeat(64));
console.log('Couleurs de texte alignees sur --bh-encre .... ' + totalTexte);
console.log('rgba derives du noir froid corriges .......... ' + totalRgba);

if (ignores.length) {
  console.log('\nIGNORES \u2014 volontairement, avec la raison :');
  for (const r of ignores) console.log('    ' + r);
}

if (reportes.length) {
  console.log('\nLAISSES EN PLACE \u2014 #0D1117 y est un FOND, pas un texte.');
  console.log('Le remplacer eclaircirait un fond sombre. A revoir au lot 6 (mode sombre) :');
  for (const r of reportes) console.log('    ' + r);
}

console.log('\nVerification : node outils/lot2-verifier.js');
if (ESSAI) console.log('\nEssai termine \u2014 rien n\'a ete ecrit.');
