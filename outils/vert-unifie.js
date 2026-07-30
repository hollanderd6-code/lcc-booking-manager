#!/usr/bin/env node
/* ============================================================================
   outils/vert-unifie.js — unifie tous les verts sur le vert du logo.

   Avant : le site melangeait une quinzaine de verts sans rapport — le jade
   #1A7A5E, les verts Tailwind (#10B981, #059669, #16A34A, #22C55E...), un
   vert de marque #0E3B2E, et leurs variantes rgba(). Resultat : aucune
   couleur ne semblait deliberee.

   Apres : une seule echelle, derivee du vert du logo #0E3B2E.

     --vert-900  #0A2C22   survol, etat presse
     --vert-800  #0E3B2E   MARQUE et couleur d'action principale
     --vert-600  #1E6E52   accent, survol clair, dark mode
     --vert-400  #4FA184   sur fond sombre
     --vert-300  #8FC7AF   traces et courbes sur fond sombre
     --vert-200  #A8CDBE   filets, bordures
     --vert-100  #E4EDE8   fonds doux
     --vert-050  #F1F6F3   fonds tres doux

   Les verts clairs poses SUR FOND SOMBRE gardent une valeur claire : les
   passer au vert bouteille les rendrait invisibles.

   Usage :  node outils/vert-unifie.js            (applique)
            node outils/vert-unifie.js --essai    (montre sans ecrire)
   ============================================================================ */

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..', 'public');
const ESSAI = process.argv.includes('--essai');

// ── Table de correspondance ────────────────────────────────────────────────
const HEX = {
  // Jade historique et ses variantes -> vert de marque
  '#1A7A5E': '#0E3B2E',   '#1E6E52': '#0E3B2E',
  '#145F4A': '#0A2C22',   '#164F3B': '#0A2C22',
  '#2AAE86': '#1E6E52',   '#2E8A69': '#1E6E52',

  // Verts Tailwind (succes, validation) -> meme echelle
  '#10B981': '#0E3B2E',   '#16A34A': '#0E3B2E',
  '#059669': '#0A2C22',   '#047857': '#0A2C22',
  '#065F46': '#0A2C22',   '#15803D': '#0A2C22',
  '#166534': '#0A2C22',   '#14532D': '#0A2C22',
  '#22C55E': '#1E6E52',

  // Tons clairs : conserves clairs (bordures, texte sur fond sombre)
  '#34D399': '#4FA184',   '#6EE7B7': '#8FC7AF',
  '#A7F3D0': '#C3DBD0',

  // Fonds teintes
  '#D1FAE5': '#DCE9E3',   '#ECFDF5': '#F1F6F3',
  '#F0FDF4': '#F1F6F3',   '#E8F0EC': '#E4EDE8',
  '#EAF1ED': '#E4EDE8',   '#DCFCE7': '#DCE9E3',
};

// rgb()/rgba() : on remplace le triplet en gardant l'alpha
const RGB = {
  '26,122,94':  '14,59,46',     // jade
  '30,110,82':  '14,59,46',
  '16,185,129': '14,59,46',     // emerald
  '5,150,105':  '10,44,34',
  '4,120,87':   '10,44,34',
  '22,163,74':  '14,59,46',
  '20,83,45':   '10,44,34',
  '42,174,134': '30,110,82',    // jade clair
  '52,211,153': '79,161,132',   // tons clairs conserves clairs
  '110,231,183':'143,199,175',
};

// Fichiers a ne pas toucher
const IGNORE = [/\/_archive\//, /\.backup$/, /\.broken$/, /\.OLD$/, /\.old$/,
                /\.disabled$/, /\/img\/brand\//, /bh-brand\.css$/];

function fichiers(rep, acc = []) {
  for (const e of fs.readdirSync(rep, { withFileTypes: true })) {
    const p = path.join(rep, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'img') {
        if (e.name === 'img') continue;
        continue;
      }
      fichiers(p, acc);
    } else if (/\.(html|css|js)$/.test(e.name)) {
      acc.push(p);
    }
  }
  return acc;
}

let totalRempl = 0, totalFic = 0;
const detail = {};

for (const f of fichiers(RACINE)) {
  const rel = path.relative(RACINE, f);
  if (IGNORE.some(r => r.test('/' + rel))) continue;

  let s = fs.readFileSync(f, 'utf8');
  const avant = s;
  let n = 0;

  // hex, insensible a la casse, en preservant les mots plus longs
  for (const [de, vers] of Object.entries(HEX)) {
    const re = new RegExp(de.replace('#', '#') + '(?![0-9a-fA-F])', 'gi');
    s = s.replace(re, () => { n++; return vers; });
  }

  // rgb / rgba : espaces optionnels autour des virgules
  for (const [de, vers] of Object.entries(RGB)) {
    const [r, g, b] = de.split(',');
    const re = new RegExp('(rgba?\\(\\s*)' + r + '(\\s*,\\s*)' + g + '(\\s*,\\s*)' + b, 'g');
    const [nr, ng, nb] = vers.split(',');
    s = s.replace(re, (m, p1, p2, p3) => { n++; return p1 + nr + p2 + ng + p3 + nb; });
  }

  if (s !== avant) {
    if (!ESSAI) fs.writeFileSync(f, s);
    detail[rel] = n; totalRempl += n; totalFic++;
  }
}

console.log(ESSAI ? 'ESSAI — aucune ecriture\n' : 'Application\n');
Object.entries(detail).sort((a, b) => b[1] - a[1]).slice(0, 25)
  .forEach(([f, n]) => console.log(`  ${f.padEnd(44)} ${String(n).padStart(5)}`));
if (Object.keys(detail).length > 25) console.log(`  … et ${Object.keys(detail).length - 25} autres`);
console.log(`\n${totalRempl} remplacements dans ${totalFic} fichiers.`);
