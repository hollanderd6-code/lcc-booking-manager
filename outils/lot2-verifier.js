#!/usr/bin/env node
/* ============================================================
   LOT 2 — Verificateur
   ============================================================
   Prouve que la valeur FINALE de chaque jeton est inchangee.

   Methode : on reconstitue la cascade des deux cotes.

     AVANT (dans le dernier commit)
       bh-theme-v3.css  puis  bh-brand.css  puis  bh-core.css
       (bh-core chargeait en dernier : c'est lui qui gagnait)

     APRES (fichiers actuels)
       bh-theme-v3.css  puis  bh-tokens.css
       (bh-brand et bh-core n'ont plus de jetons)

   Puis on resout les var() en chaine et on compare valeur par
   valeur. Tout ecart est signale avec les deux valeurs, et tout
   jeton disparu est signale comme perte.

   Usage :
     node outils/lot2-verifier.js
   ============================================================ */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CSS = path.join(process.cwd(), 'public', 'css');

function auCommit(relatif) {
  try { return execFileSync('git', ['show', 'HEAD:' + relatif], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }); }
  catch (e) { return ''; }
}
const local = (f) => { try { return fs.readFileSync(path.join(CSS, f), 'utf8'); } catch (e) { return ''; } };

/* Releve les jetons de TOUS les blocs dont le selecteur contient
   :root ou html.bh-lux, dans l'ordre du fichier. Les blocs
   conditionnels (media, prefers-color-scheme) sont ignores : ils
   ne definissent pas la valeur par defaut.                        */
function jetonsDe(src) {
  // Les commentaires sont retires du fichier ENTIER d'abord : sinon un bloc
  // mis en commentaire (comme « INTENTION » dans bh-tokens.css) serait lu
  // comme une vraie declaration, alors que le navigateur l'ignore.
  src = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Map();
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const sel = m[1].trim();
    if (!/(^|[\s,])(:root|html\.bh-lux)/.test(sel)) continue;
    if (/@media|prefers-color-scheme/.test(sel)) continue;
    if (/\[data-theme=["']?dark/.test(sel)) continue;
    const rd = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
    let d;
    while ((d = rd.exec(m[2])) !== null) out.set(d[1], d[2].trim());
  }
  return out;
}

/* Empile plusieurs sources dans l'ordre de chargement : le dernier
   a declarer un jeton l'emporte.                                  */
function empiler(sources) {
  const out = new Map();
  for (const src of sources) for (const [k, v] of jetonsDe(src)) out.set(k, v);
  return out;
}

/* Resout les var(--x) en chaine, avec garde anti-boucle. */
function resoudre(map, valeur, profondeur = 0) {
  if (profondeur > 12) return valeur;
  return valeur.replace(/var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^()]*))?\)/gi, (tout, nom, repli) => {
    if (map.has(nom)) return resoudre(map, map.get(nom), profondeur + 1);
    return repli !== undefined ? repli.trim() : tout;
  }).trim();
}

/* Comparaison a la valeur pres, pas a l'espace pres : une liste de
   polices reste la meme qu'elle soit ecrite « a,b » ou « a, b ».   */
const normaliser = (v) => v.toLowerCase()
  .replace(/\s+/g, ' ')
  .replace(/\s*,\s*/g, ',')
  .replace(/;$/, '')
  .trim();

const avant = empiler([
  auCommit('public/css/bh-theme-v3.css'),
  auCommit('public/css/bh-brand.css'),
  auCommit('public/css/bh-core.css')
]);
const apres = empiler([
  local('bh-theme-v3.css'),
  local('bh-tokens.css'),
  local('bh-brand.css'),
  local('bh-core.css')
]);

if (!avant.size) {
  console.error('Impossible de lire les versions du dernier commit (git show).');
  process.exit(1);
}

const perdus = [], changes = [];
let identiques = 0;

for (const [nom, valAvant] of avant) {
  if (!apres.has(nom)) { perdus.push([nom, valAvant]); continue; }
  const a = normaliser(resoudre(avant, valAvant));
  const b = normaliser(resoudre(apres, apres.get(nom)));
  if (a === b) identiques++;
  else changes.push([nom, a, b]);
}

const nouveaux = [...apres.keys()].filter(k => !avant.has(k));

console.log('Jetons declares avant ..... ' + avant.size);
console.log('Jetons declares apres ..... ' + apres.size);
console.log('Valeurs identiques ........ ' + identiques);
console.log('Valeurs modifiees ......... ' + changes.length);
console.log('Jetons disparus ........... ' + perdus.length);
if (nouveaux.length) console.log('Jetons ajoutes ............ ' + nouveaux.length + '  (' + nouveaux.slice(0, 8).join(', ') + (nouveaux.length > 8 ? '…' : '') + ')');

if (perdus.length) {
  console.log('\n\u2717 JETONS DISPARUS — a reporter dans bh-tokens.css :');
  for (const [n, v] of perdus) console.log('    ' + n.padEnd(24) + v);
}
if (changes.length) {
  console.log('\n! VALEURS MODIFIEES — verifiez que chacune est voulue :');
  for (const [n, a, b] of changes) console.log('    ' + n.padEnd(24) + a + '  \u2192  ' + b);
}

if (perdus.length) {
  console.log('\nNe committez pas : « git checkout -- public/ » revient en arriere.');
  process.exit(1);
}
if (changes.length) {
  console.log('\nAucune perte, mais des valeurs ont bouge. Si la liste ci-dessus');
  console.log('correspond a ce que vous avez decide (bloc INTENTION), committez.');
  process.exit(0);
}
console.log('\nAucune perte, aucune valeur modifiee : les jetons sont unifies');
console.log('sans le moindre changement a l\'ecran. Vous pouvez committer.');
