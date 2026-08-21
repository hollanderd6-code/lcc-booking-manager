#!/usr/bin/env node
/* ============================================================
   Deux correctifs
   ============================================================
   1. LE LOGO HOSTERZZ
      Le script precedent cherchait « mono-carre.svg ». Mais votre commit
      d'avant l'avait deja remplace par « mono-hosterzz.svg » — le SVG que
      j'avais extrait a tort, et qui ne montrait que l'anneau hexagonal
      sans la maison. Le script ne trouvait donc plus rien.
      Celui-ci accepte les deux noms.

   2. LE BADGE « 0 » SUR DEUX PAGES
      settings-account.html et sub-account.html chargeaient
      messages-badge-dynamic.js au lieu du script commun aux 21 autres
      pages. Ce fichier affichait la pastille meme a zero — c'etait ecrit
      dans son en-tete : « Affiche toujours le badge (meme pour 0) ».
      Les deux pages basculent sur le script commun. dynamic.js n'est plus
      reference : le temps reel qu'il apportait a ete verse dans l'autre.

   Usage :  node outils/logo-et-badge.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const R = process.cwd();
let logos = 0, badges = 0;

/* ── 1. Logo ─────────────────────────────────────────────────────────── */
for (const rel of ['public/settings-account.html', 'public/cleaning.html']) {
  const p = path.join(R, rel);
  if (!fs.existsSync(p)) { console.log('  absent : ' + rel); continue; }
  let s = fs.readFileSync(p, 'utf8');
  const avant = s;
  let n = 0;

  // Les deux noms possibles, et seulement quand alt="Hosterzz" :
  // mono-carre.svg reste le monogramme BH partout ailleurs.
  s = s.replace(/src="\/img\/brand\/web\/mono-(carre|hosterzz)\.svg[^"]*"(\s+alt="Hosterzz")/g,
    function (t, quoi, alt) { n++; return 'src="/img/brand/web/hosterzz-mark.png"' + alt; });

  // La plaque blanche : inutile, ce PNG porte son propre fond vert.
  s = s.replace(
    'style="width:44px;height:44px;border-radius:10px;background:#fff;border:1px solid #e5e7eb;display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:6px;box-sizing:border-box;"',
    'style="width:44px;height:44px;border-radius:10px;overflow:hidden;flex-shrink:0;"');
  s = s.replace(
    'style="width:44px;height:44px;border-radius:10px;background:var(--bh-panneau);border:1px solid var(--bh-ligne);display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:6px;box-sizing:border-box;"',
    'style="width:44px;height:44px;border-radius:10px;overflow:hidden;flex-shrink:0;"');

  // L'image remplit le carre au lieu d'y flotter avec des marges.
  s = s.replace(/(src="\/img\/brand\/web\/hosterzz-mark\.png"\s+alt="Hosterzz"\s+style=")width:100%;height:100%;object-fit:contain;"/g,
    '$1width:100%;height:100%;display:block;object-fit:cover;"');

  if (s !== avant) { fs.writeFileSync(p, s, 'utf8'); logos += n; console.log('  logo : ' + rel + ' (' + n + ')'); }
  else console.log('  logo : ' + rel + ' — rien a changer');
}

/* ── 2. Badge ────────────────────────────────────────────────────────── */
for (const rel of ['public/settings-account.html', 'public/sub-account.html']) {
  const p = path.join(R, rel);
  if (!fs.existsSync(p)) { console.log('  absent : ' + rel); continue; }
  let s = fs.readFileSync(p, 'utf8');
  const avant = s;

  s = s.replace(/<script src="\/js\/messages-badge-dynamic\.js[^"]*"><\/script>/g,
    '<script src="/js/messages-badge-desktop-mobile.js"></script>');

  if (s !== avant) { fs.writeFileSync(p, s, 'utf8'); badges++; console.log('  badge : ' + rel); }
  else console.log('  badge : ' + rel + ' — deja sur le script commun');
}

console.log('\n  ' + logos + ' reference(s) de logo corrigee(s), ' + badges + ' page(s) de badge basculee(s).');
console.log('\n  Il reste a supprimer le fichier devenu inutile :');
console.log('      git rm public/js/messages-badge-dynamic.js');
console.log('  Verifiez d\'abord qu\'il n\'est plus cite :');
console.log('      grep -rn "messages-badge-dynamic" public/ | grep -v Binary\n');
