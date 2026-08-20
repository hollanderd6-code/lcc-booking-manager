#!/usr/bin/env node
/* ============================================================
   DIAGNOSTIC — le theme v3 est-il reellement actif ?
   ============================================================
   Presque tout bh-theme-v3.css (81 Ko, ~690 selecteurs) est
   conditionne a html[data-theme-v3="1"]. Trois scripts en
   dependent aussi et sortent immediatement sans lui :
   bh-theme-v3-nav.js, mobile-tabs-handler.js (3 fois),
   cookies-banner.js.

   Une page qui CHARGE la feuille sans porter l'attribut
   telecharge donc 81 Ko pour n'en appliquer presque rien, et
   retombe sur style.css. C'est la cause la plus probable des
   ecarts d'aspect entre ecrans.

   Ce script ne modifie rien : il classe les 49 pages.

   Usage :
     node outils/diag-theme-v3.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const DOSSIER = path.join(process.cwd(), 'public');
if (!fs.existsSync(DOSSIER)) {
  console.error('public/ introuvable — lancez depuis la racine du depot.');
  process.exit(1);
}

const pages = fs.readdirSync(DOSSIER).filter(f => f.endsWith('.html')).sort();

const mortes = [], vives = [], sansFeuille = [], luxIncoherentes = [];

for (const f of pages) {
  const html = fs.readFileSync(path.join(DOSSIER, f), 'utf8');
  const balise = (html.match(/<html\b[^>]*>/i) || [''])[0];

  const aAttribut = /data-theme-v3\s*=\s*["']?1/i.test(balise);
  const aFeuille  = /<link\b[^>]*bh-theme-v3\.css/i.test(html);
  const aClasseLux = /class\s*=\s*["'][^"']*\bbh-lux\b/i.test(balise);
  const aFeuilleLux = /<link\b[^>]*bh-lux[a-z-]*\.css/i.test(html);

  if (aFeuille && !aAttribut) mortes.push(f);
  else if (aFeuille && aAttribut) vives.push(f);
  else if (!aFeuille && aAttribut) sansFeuille.push(f);

  // la classe bh-lux sans feuille lux, ou l'inverse
  if (aClasseLux !== aFeuilleLux) {
    luxIncoherentes.push(f + '  ' + (aClasseLux ? 'classe bh-lux SANS feuille lux' : 'feuille lux SANS classe bh-lux'));
  }
}

const poids = (() => {
  const p = path.join(DOSSIER, 'css', 'bh-theme-v3.css');
  return fs.existsSync(p) ? Math.round(fs.statSync(p).size / 1024) : 0;
})();

console.log('THEME V3 — etat reel sur les ' + pages.length + ' pages\n');

console.log('ACTIF (feuille + attribut) ................. ' + vives.length);
console.log('MORT  (feuille chargee, attribut absent) ... ' + mortes.length);
console.log('Attribut sans la feuille ................... ' + sansFeuille.length);

if (mortes.length) {
  console.log('\n\u2717 CES PAGES TELECHARGENT ' + poids + ' Ko POUR RIEN :');
  console.log('  la feuille est chargee, mais html[data-theme-v3="1"] manque,');
  console.log('  donc ~690 regles ne s\'appliquent pas. La page retombe sur style.css,');
  console.log('  et bh-theme-v3-nav.js + mobile-tabs-handler.js sortent sans agir.\n');
  for (const f of mortes) console.log('    ' + f);
  console.log('\n  Correctif : ajouter data-theme-v3="1" a la balise <html>.');
  console.log('  C\'est un changement VISIBLE et voulu : la page adopte enfin le theme.');
}

if (sansFeuille.length) {
  console.log('\n! Attribut present mais feuille absente (l\'attribut ne sert a rien) :');
  for (const f of sansFeuille) console.log('    ' + f);
}

if (luxIncoherentes.length) {
  console.log('\n! Incoherences bh-lux :');
  for (const l of luxIncoherentes) console.log('    ' + l);
}

if (!mortes.length && !sansFeuille.length && !luxIncoherentes.length) {
  console.log('\nAucune incoherence : chaque page qui charge le theme l\'active.');
}
