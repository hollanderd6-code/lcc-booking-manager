#!/usr/bin/env node
/* ============================================================
   LOT 7 — Verificateur
   ============================================================
   Prouve que le lot 7 n'a rien change au rendu.

   Methode : pour chaque fichier modifie, on prend la version du
   dernier commit et la version actuelle, on remplace dans les DEUX
   chaque var(--jeton) par sa valeur litterale, puis on compare.
   Si les deux textes sont identiques, aucune couleur n'a bouge.

   C'est plus fort qu'une comparaison de couleurs : tout ecart,
   meme une accolade deplacee, ressort.

   Usage :
     node outils/lot7-verifier.js
   ============================================================ */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RACINE = process.cwd();
const PUBLIC = path.join(RACINE, 'public');
const CSS = path.join(PUBLIC, 'css');

const srcTokens = fs.readFileSync(path.join(CSS, 'bh-tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const iRoot = srcTokens.indexOf(':root');
const iDark = srcTokens.indexOf('html[data-theme="dark"]');
const blocClair = srcTokens.slice(iRoot, iDark > 0 ? iDark : srcTokens.length);

const jetons = new Map();
{
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m;
  while ((m = re.exec(blocClair)) !== null) jetons.set(m[1], m[2].trim());
}
const resoudre = (v, p = 0) => p > 10 ? v :
  v.replace(/var\(\s*(--[a-z0-9-]+)\s*\)/gi, (t, n) => jetons.has(n) ? resoudre(jetons.get(n), p + 1) : t).trim();

/* Aplatit : var(--x) -> valeur, hex en minuscules et etendus */
function aplatir(css) {
  let out = css.replace(/var\(\s*(--[a-z0-9-]+)\s*\)/gi,
    (t, n) => jetons.has(n) ? resoudre(jetons.get(n)) : t);
  out = out.replace(/#[0-9a-fA-F]{3,8}\b/g, (h) => {
    let v = h.toLowerCase();
    if (v.length === 4) v = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    return v;
  });
  return out.replace(/\s+/g, ' ').trim();
}

function auCommit(rel) {
  try { return execFileSync('git', ['show', 'HEAD:' + rel], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
  catch (e) { return null; }
}

const cibles = [];
for (const f of fs.readdirSync(CSS)) if (f.endsWith('.css') && f !== 'bh-tokens.css') cibles.push('public/css/' + f);
for (const f of fs.readdirSync(PUBLIC)) if (f.endsWith('.html')) cibles.push('public/' + f);

let ok = 0, ecarts = [], horsGit = 0;

for (const rel of cibles) {
  const p = path.join(RACINE, rel);
  const ancien = auCommit(rel);
  if (ancien === null) { horsGit++; continue; }
  const courant = fs.readFileSync(p, 'utf8');
  if (ancien === courant) { ok++; continue; }       // non modifie

  // pour un HTML, on ne compare que les blocs <style>
  const extraire = (s) => rel.endsWith('.html')
    ? (s.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || []).join('\n')
    : s;

  const a = aplatir(extraire(ancien));
  const b = aplatir(extraire(courant));

  if (a === b) { ok++; continue; }

  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  ecarts.push({
    rel,
    pos: i,
    avant: a.slice(Math.max(0, i - 40), i + 60),
    apres: b.slice(Math.max(0, i - 40), i + 60)
  });
}

console.log('Fichiers conformes ....... ' + ok);
console.log('Fichiers a examiner ...... ' + ecarts.length);
if (horsGit) console.log('Hors suivi git ........... ' + horsGit);

if (ecarts.length) {
  console.log('\n\u2717 ECARTS DE RENDU :');
  for (const e of ecarts) {
    console.log('  ' + e.rel);
    console.log('      avant : …' + e.avant + '…');
    console.log('      apres : …' + e.apres + '…');
  }
  console.log('\nNe committez pas : « git checkout -- public/ » revient en arriere.');
  process.exit(1);
}

console.log('\nAucun ecart : chaque var(--jeton) pose vaut exactement la couleur');
console.log('qu\'il remplace. Le rendu est identique, la marque est pilotable.');
