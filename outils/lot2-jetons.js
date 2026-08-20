#!/usr/bin/env node
/* ============================================================
   LOT 2 — Un seul systeme de jetons
   ============================================================
   Trois operations, dans cet ordre :

   1. bh-core.css perd son bloc :root. Il ne garde que ce qu'il
      sait faire : badges, toasts, squelettes, focus, micro-
      interactions. Il continue de charger en dernier, a sa juste
      place puisqu'il ne contient plus que des composants.

   2. bh-brand.css perd son bloc « :root, html.bh-lux ». Ses
      overrides de mise en page (en-tete mobile, logo, verrou)
      restent intacts.

   3. bh-tokens.css est declare sur les 49 pages, juste apres
      bh-theme-v3.css — ou en tete de la pile globale pour les
      pages qui ne chargent pas le theme.

   RENDU IDENTIQUE. Les valeurs reprises dans bh-tokens.css sont
   celles qui gagnaient reellement la cascade (celles de bh-core,
   qui chargeait en dernier). Rien ne bouge a l'ecran ; ce qui
   change, c'est qu'il n'existe plus qu'un endroit ou les changer.

   Usage :
     node outils/lot2-jetons.js --essai
     node outils/lot2-jetons.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const RACINE = process.cwd();
const DOSSIER = path.join(RACINE, 'public');
const CSS = path.join(DOSSIER, 'css');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

/* ── Garde-fou de depot ─────────────────────────────────────── */
const temoins = ['bh-core.css', 'bh-theme-v3.css', 'bh-brand.css', 'bh-tokens.css'];
const absents = temoins.filter(f => !fs.existsSync(path.join(CSS, f)));
if (absents.length) {
  console.error('\n  \u2717 Fichiers manquants dans public/css : ' + absents.join(', '));
  if (absents.includes('bh-tokens.css')) {
    console.error('    bh-tokens.css doit etre copie dans public/css/ avant de lancer ce script.');
  }
  console.error('    Dossier courant : ' + RACINE + '\n');
  process.exit(1);
}

let echecs = 0;

/* ── 1 & 2. Retrait des blocs :root doublons ────────────────── */

/* Retire le bloc de declarations qui commence au selecteur donne.
   Compte les accolades : robuste aux commentaires contenant « } ».  */
function retirerBloc(src, selecteur) {
  const i = src.indexOf(selecteur);
  if (i === -1) return null;
  const debutAccolade = src.indexOf('{', i);
  if (debutAccolade === -1) return null;
  let n = 0, j = debutAccolade;
  for (; j < src.length; j++) {
    if (src[j] === '{') n++;
    else if (src[j] === '}') { n--; if (n === 0) { j++; break; } }
  }
  return { avant: src.slice(0, i), apres: src.slice(j), bloc: src.slice(i, j) };
}

function degraisser(fichier, selecteur, note) {
  const p = path.join(CSS, fichier);
  const src = fs.readFileSync(p, 'utf8');
  const d = retirerBloc(src, selecteur);
  if (!d) {
    console.log('  \u2192 ' + fichier + ' : bloc « ' + selecteur + ' » introuvable (deja retire ?)');
    return { fichier, jetons: 0, deja: true };
  }
  const jetons = (d.bloc.match(/--[a-z0-9-]+\s*:/gi) || []).length;
  const remplacement = '/* Les jetons de ce fichier vivent desormais dans bh-tokens.css.\n'
    + '   ' + note + '\n'
    + '   (' + jetons + ' jetons deplaces, lot 2.) */\n';
  const sortie = (d.avant + remplacement + d.apres).replace(/\n{3,}/g, '\n\n');
  if (!ESSAI) fs.writeFileSync(p, sortie, 'utf8');
  return { fichier, jetons, deja: false };
}

console.log((ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLICATION —') + '\n');
console.log('1. Retrait des declarations de jetons en double');

const r1 = degraisser('bh-core.css', ':root{',
  'bh-core.css ne garde que ses composants : badges, toasts, squelettes, focus.');
const r2 = degraisser('bh-brand.css', ':root,',
  'bh-brand.css ne garde que ses overrides de mise en page.');
for (const r of [r1, r2]) {
  if (!r.deja) console.log('  ok  ' + r.fichier.padEnd(18) + r.jetons + ' jetons retires');
}

/* ── 3. Declaration de bh-tokens.css sur toutes les pages ───── */
console.log('\n2. Declaration de bh-tokens.css');

/* Empreinte de contenu : meme convention que les autres feuilles
   de public/, pour ne pas reintroduire de compteur manuel.        */
const crypto = require('crypto');
const empreinte = crypto.createHash('sha1')
  .update(fs.readFileSync(path.join(CSS, 'bh-tokens.css')))
  .digest('hex').slice(0, 8);
const BALISE = '<link rel="stylesheet" href="/css/bh-tokens.css?v=' + empreinte + '">';

const RE_LIEN_TOKENS = /[ \t]*<link\b[^>]*bh-tokens\.css[^>]*>\n?/gi;
const pages = fs.readdirSync(DOSSIER).filter(f => f.endsWith('.html'));

let posees = 0, remplacees = 0, sansAncre = 0;

for (const f of pages) {
  const p = path.join(DOSSIER, f);
  let html = fs.readFileSync(p, 'utf8');
  const avait = RE_LIEN_TOKENS.test(html);
  RE_LIEN_TOKENS.lastIndex = 0;
  html = html.replace(RE_LIEN_TOKENS, '');   // idempotence : on repart propre

  /* Ancre : juste apres bh-theme-v3.css. A defaut, juste apres le
     premier <link> de /css/ (la pile globale posee au lot 1).      */
  let m = html.match(/[ \t]*<link\b[^>]*bh-theme-v3\.css[^>]*>\n?/i);
  if (!m) m = html.match(/[ \t]*<link\b[^>]*rel=["']?stylesheet[^>]*\/css\/[^>]*>\n?/i);
  if (!m) {
    // page sans aucune feuille /css/ : on pose juste avant </head>
    const fin = html.search(/<\/head\s*>/i);
    if (fin === -1) { console.log('  ! ' + f + ' : pas de </head>, ignoree'); sansAncre++; echecs++; continue; }
    html = html.slice(0, fin) + '  ' + BALISE + '\n' + html.slice(fin);
    sansAncre++;
  } else {
    const pos = m.index + m[0].length;
    html = html.slice(0, pos) + '  ' + BALISE + '\n' + html.slice(pos);
  }

  if (!ESSAI) fs.writeFileSync(p, html, 'utf8');
  if (avait) remplacees++; else posees++;
}

console.log('  ' + posees + ' pages equipees' + (remplacees ? ', ' + remplacees + ' mises a jour' : '')
  + (sansAncre ? ', ' + sansAncre + ' sans feuille /css/ (pose avant </head>)' : ''));

/* ── Rapport ────────────────────────────────────────────────── */
console.log('\n' + '─'.repeat(66));
console.log('Un seul fichier declare desormais les jetons : public/css/bh-tokens.css');
console.log('\nCe qui reste a decider, et qui n\'est PAS fait par ce script :');
console.log('  \u2022 deux jetons portent la valeur affichee aujourd\'hui, non la valeur');
console.log('    voulue par la palette. Le bloc « INTENTION » en fin de bh-tokens.css');
console.log('    permet de basculer :');
console.log('        --bh-vert-fonce  #125A45 affiche  \u2192  #0A2C22 voulu');
console.log('        --bh-encre       #0D1117 affiche  \u2192  #20221F voulu');
console.log('  \u2022 class="bh-lux" n\'est present que sur 4 pages sur 49 (cleaning,');
console.log('    messages, reservations, settings). Tout le remappage de la palette');
console.log('    dans bh-brand.css est enferme dans html.bh-lux[data-theme-v3="1"] :');
console.log('    il ne s\'applique donc pas aux 45 autres. C\'est le lot 2b.');
console.log('\nVerification : node outils/lot2-verifier.js');
if (ESSAI) console.log('\nEssai termine — rien n\'a ete ecrit.');
process.exit(echecs ? 1 : 0);
