#!/usr/bin/env node
/* ============================================================
   LOT 1 — Verificateur
   ============================================================
   Compare chaque page a sa version dans le dernier commit et
   prouve que le lot 1 n'a fait que DEPLACER du CSS :

     1. meme liste de feuilles (memes href, meme nombre) ;
     2. meme CSS en ligne, octet pour octet ;
     3. tout le reste du document rigoureusement inchange.

   Le point 3 est le plus important : c'est lui qui garantit
   qu'aucun script, aucune balise, aucun attribut n'a bouge.
   Un diff de 4 000 lignes sur app.html est normal si ce
   verificateur passe : 72 Ko de CSS ont change de place.

   Usage, avant de committer :
     node outils/lot1-verifier.js
   ============================================================ */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RACINE = process.cwd();
const DOSSIER = path.join(RACINE, 'public');

const RE_BALISE = /<link\b[^>]*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi;
const estFeuilleCss = (b) => /^<link/i.test(b)
  && /rel\s*=\s*["']?stylesheet/i.test(b)
  && /href\s*=\s*["'][^"']*\/?css\/[^"']+\.css/i.test(b);
const hrefDe = (b) => (b.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1] || '';

/* Les commentaires que le lot 1 a lui-meme inseres ne doivent pas
   compter comme une modification du document : on les retire des
   deux cotes avant comparaison.                                   */
const MARQUEURS = [
  'Feuilles globales',
  'CSS propre a cette page',
  'Calques tardifs',
  'CSS de page pose apres les calques tardifs',
  'Feuilles de style'
];
function sansCommentairesDuLot(s) {
  return s.replace(/<!--[\s\S]*?-->/g, (c) => MARQUEURS.some(m => c.includes(m)) ? '' : c);
}

/* Decoupe une page en trois : la liste des feuilles, le CSS en
   ligne concatene, et le squelette (tout le reste).            */
function decomposer(html) {
  const finHead = html.search(/<\/head\s*>/i);
  if (finHead === -1) return null;
  const head = html.slice(0, finHead);
  const reste = html.slice(finHead);

  const feuilles = [];
  const styles = [];
  let squelette = '', curseur = 0, m;

  RE_BALISE.lastIndex = 0;
  while ((m = RE_BALISE.exec(head)) !== null) {
    const b = m[0];
    if (!(estFeuilleCss(b) || /^<style/i.test(b))) continue;
    squelette += head.slice(curseur, m.index);
    curseur = m.index + b.length;
    if (/^<style/i.test(b)) styles.push(b.replace(/^<style[^>]*>/i, '').replace(/<\/style\s*>$/i, ''));
    else feuilles.push(hrefDe(b));
  }
  squelette += head.slice(curseur) + reste;

  return {
    feuilles,                                   // ordre inclus
    feuillesTriees: [...feuilles].sort(),        // ensemble, hors ordre
    css: styles.join('\n/*—*/\n'),
    squelette: sansCommentairesDuLot(squelette)
      .replace(/[ \t]+$/gm, '').replace(/\n{2,}/g, '\n').trim()
  };
}

function versionCommit(relatif) {
  try {
    return execFileSync('git', ['show', 'HEAD:' + relatif], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) { return null; }
}

if (!fs.existsSync(DOSSIER)) {
  console.error('public/ introuvable — lancez depuis la racine du depot.');
  process.exit(1);
}

const pages = fs.readdirSync(DOSSIER).filter(f => f.endsWith('.html'));
let ok = 0, alertes = 0, ignorees = 0;
const problemes = [];

for (const f of pages) {
  const relatif = 'public/' + f;
  const courant = fs.readFileSync(path.join(DOSSIER, f), 'utf8');
  const ancien = versionCommit(relatif);
  if (ancien === null) { ignorees++; continue; }   // fichier non suivi par git

  const A = decomposer(ancien), B = decomposer(courant);
  if (!A || !B) { problemes.push([f, 'pas de </head>']); alertes++; continue; }

  const ecarts = [];
  if (A.feuillesTriees.join('|') !== B.feuillesTriees.join('|')) {
    const perdues = A.feuillesTriees.filter(x => !B.feuillesTriees.includes(x));
    const ajoutees = B.feuillesTriees.filter(x => !A.feuillesTriees.includes(x));
    ecarts.push('feuilles' + (perdues.length ? ' perdues: ' + perdues.join(', ') : '')
      + (ajoutees.length ? ' ajoutees: ' + ajoutees.join(', ') : ''));
  }
  if (A.css !== B.css) {
    ecarts.push('CSS en ligne modifie (' + A.css.length + ' -> ' + B.css.length + ' octets)');
  }
  if (A.squelette !== B.squelette) {
    // localise la premiere divergence, pour pouvoir l'inspecter
    let i = 0; while (i < A.squelette.length && A.squelette[i] === B.squelette[i]) i++;
    const ligne = A.squelette.slice(0, i).split('\n').length;
    ecarts.push('document modifie hors CSS, vers la ligne ' + ligne
      + ' : « ' + A.squelette.slice(i, i + 60).replace(/\n/g, '⏎') + ' »'
      + ' devenu « ' + B.squelette.slice(i, i + 60).replace(/\n/g, '⏎') + ' »');
  }

  if (ecarts.length) { problemes.push([f, ecarts.join(' ; ')]); alertes++; }
  else {
    ok++;
    const reordonne = A.feuilles.join('|') !== B.feuilles.join('|');
    console.log('  ok  ' + f.padEnd(42) + (reordonne ? 'ordre corrige' : 'ordre deja bon'));
  }
}

console.log('\n' + '─'.repeat(60));
console.log('Pages conformes ......... ' + ok);
console.log('Pages a examiner ........ ' + alertes);
if (ignorees) console.log('Hors suivi git .......... ' + ignorees);

if (problemes.length) {
  console.log('\nA EXAMINER :');
  for (const [f, d] of problemes) console.log('  ✗ ' + f + '\n      ' + d);
  console.log('\nNe committez pas en l\'etat. « git checkout -- public/ » revient en arriere.');
  process.exit(1);
}

console.log('\nAucune perte : memes feuilles, meme CSS en ligne, document identique.');
console.log('Le lot 1 n\'a fait que reordonner. Vous pouvez committer.');
