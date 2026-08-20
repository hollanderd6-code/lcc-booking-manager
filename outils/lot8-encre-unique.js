#!/usr/bin/env node
/* ============================================================
   LOT 8 — Une seule encre
   ============================================================
   Le lot 2b a fait passer l'encre du bleu-noir froid #0D1117 au
   brun-noir chaud #20221F, accorde au creme et au vert. Mais il n'a
   traite que les FEUILLES : les 49 pages gardent 126 occurrences du
   noir froid dans leur CSS interne.

   Le produit affiche donc aujourd'hui DEUX noirs selon l'endroit du
   texte. Ce n'est pas une question de gout, c'est une incoherence.

   Ce script remplace ces 126 occurrences par var(--bh-encre), et les
   rgba(13,17,23,a) par rgba(32,34,31,a) a alpha identique.

   ── TROIS EXCLUSIONS, APPRISES A MES DEPENS ──────────────────────
   1. [style*="color:#0D1117"] est un SELECTEUR d'attribut : il cible
      les styles en ligne du HTML. Y mettre var(--bh-encre) ne casse
      pas le CSS, mais la regle ne correspond plus a rien : elle
      devient morte silencieusement.
   2. background:#0D1117 dans un bloc de mode sombre est un FOND :
      l'eclaircir en encre chaude ruinerait le fond sombre.
   3. --cream:#0D1117 est une declaration de jeton propre au mode
      sombre, meme raison.

   Usage :
     node outils/lot8-encre-unique.js --essai
     node outils/lot8-encre-unique.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const RACINE = process.cwd();
const PUBLIC = path.join(RACINE, 'public');
const CSS = path.join(PUBLIC, 'css');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

if (!fs.existsSync(path.join(CSS, 'bh-tokens.css'))) {
  console.error('\n  \u2717 public/css/bh-tokens.css introuvable : lancez les lots 2 et 6a d\'abord.\n');
  process.exit(1);
}

const estSelecteur = (l) => /\[\s*(style|class)\s*[*^$~|]?=/i.test(l);
const estJeton     = (l) => /^\s*--[a-z0-9-]+\s*:/i.test(l);
const estFond      = (l) => /background(-color)?\s*:/i.test(l);

function traiter(css, st) {
  return css.split('\n').map((l, i) => {
    let out = l;
    if (/#0D1117/i.test(out)) {
      if (estSelecteur(out))   { st.selecteurs.push(i + 1); }
      else if (estJeton(out))  { st.jetons.push(i + 1); }
      else if (estFond(out))   { st.fonds.push(i + 1); }
      else { out = out.replace(/#0D1117/gi, 'var(--bh-encre)'); st.texte++; }
    }
    if (/rgba\(\s*13\s*,\s*17\s*,\s*23\s*,/i.test(out)) {
      out = out.replace(/rgba\(\s*13\s*,\s*17\s*,\s*23\s*,/gi, 'rgba(32,34,31,');
      st.rgba++;
    }
    return out;
  }).join('\n');
}

const neuf = () => ({ texte: 0, rgba: 0, selecteurs: [], jetons: [], fonds: [] });
const global = neuf();
const lignes = [];

function cumuler(st) {
  global.texte += st.texte; global.rgba += st.rgba;
  global.selecteurs.push(...st.selecteurs);
  global.jetons.push(...st.jetons);
  global.fonds.push(...st.fonds);
}

/* 1. Les feuilles restantes (le lot 2b en a deja traite l'essentiel) */
for (const f of fs.readdirSync(CSS)) {
  if (!f.endsWith('.css')) continue;
  const p = path.join(CSS, f);
  if (!fs.statSync(p).isFile()) continue;
  const avant = fs.readFileSync(p, 'utf8');
  const st = neuf();
  const apres = traiter(avant, st);
  if (st.texte || st.rgba) {
    if (!ESSAI) fs.writeFileSync(p, apres, 'utf8');
    lignes.push({ nom: 'css/' + f, ...st });
  }
  cumuler(st);
}

/* 2. Le CSS ecrit dans les pages */
for (const f of fs.readdirSync(PUBLIC)) {
  if (!f.endsWith('.html')) continue;
  const p = path.join(PUBLIC, f);
  const avant = fs.readFileSync(p, 'utf8');
  const st = neuf();
  const apres = avant.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (t, o, corps, c) => o + traiter(corps, st) + c);
  if (st.texte || st.rgba) {
    if (!ESSAI) fs.writeFileSync(p, apres, 'utf8');
    lignes.push({ nom: f, ...st });
  }
  cumuler(st);
}

console.log((ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLICATION —') + '\n');
for (const l of lignes.sort((a, b) => (b.texte + b.rgba) - (a.texte + a.rgba))) {
  console.log('  ' + l.nom.padEnd(38)
    + (l.texte ? String(l.texte).padStart(4) + ' texte' : '          ')
    + (l.rgba ? '   ' + String(l.rgba).padStart(3) + ' rgba' : ''));
}

console.log('\n' + '─'.repeat(60));
console.log('Couleurs de texte alignees ..... ' + global.texte);
console.log('rgba derives corriges .......... ' + global.rgba);
console.log('Fichiers touches ............... ' + lignes.length);

if (global.selecteurs.length) console.log('\nSelecteurs d\'attribut evites ... ' + global.selecteurs.length);
if (global.jetons.length)     console.log('Declarations de jeton evitees .. ' + global.jetons.length);
if (global.fonds.length)      console.log('Fonds sombres preserves ........ ' + global.fonds.length);

console.log('\nA REGARDER : le texte passe du bleu-noir froid au brun-noir chaud.');
console.log('C\'est visible, subtil, et voulu — les feuilles l\'affichent deja ainsi');
console.log('depuis le lot 2b. Apres ce lot, le produit n\'a plus qu\'une seule encre.');
console.log('\nControle : grep -c "#0D1117" public/*.html public/css/*.css | grep -v ":0"');
if (ESSAI) console.log('\nEssai termine — rien n\'a ete ecrit.');
