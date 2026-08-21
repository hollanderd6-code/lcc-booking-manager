#!/usr/bin/env node
/* ============================================================
   Integration Hosterzz : son vrai logo
   ============================================================
   Remplace les deux references au monogramme BH (mono-carre.svg) par
   l'icone Hosterzz, et retire la plaque blanche du conteneur — inutile
   pour un logo qui porte son propre fond.

   Usage :  node outils/logo-hosterzz.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLES = ['public/settings-account.html', 'public/cleaning.html'];
let total = 0;

for (const rel of CIBLES) {
  const p = path.join(process.cwd(), rel);
  if (!fs.existsSync(p)) { console.log('  absent : ' + rel); continue; }
  let src = fs.readFileSync(p, 'utf8');
  const avant = src;
  let n = 0;

  // 1. La source de l'image. On ne touche QUE les balises dont le alt vaut
  //    Hosterzz : mono-carre.svg reste le monogramme BH partout ailleurs.
  src = src.replace(/src="\/img\/brand\/web\/mono-carre\.svg[^"]*"(\s+alt="Hosterzz")/g,
    function (t, alt) { n++; return 'src="/img/brand/web/hosterzz-mark.png"' + alt; });

  // 2. La plaque blanche du conteneur, dans settings-account uniquement.
  //    Le logo porte son fond : la plaque et le padding l'enfermaient dans
  //    un cadre blanc superflu.
  src = src.replace(
    'style="width:44px;height:44px;border-radius:10px;background:#fff;border:1px solid #e5e7eb;display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:6px;box-sizing:border-box;"',
    'style="width:44px;height:44px;border-radius:10px;overflow:hidden;flex-shrink:0;"');

  // 3. L'image remplit le carre au lieu d'y etre contenue avec des marges.
  src = src.replace(
    'src="/img/brand/web/hosterzz-mark.png" alt="Hosterzz" style="width:100%;height:100%;object-fit:contain;"',
    'src="/img/brand/web/hosterzz-mark.png" alt="Hosterzz" style="width:100%;height:100%;display:block;object-fit:cover;"');

  if (src !== avant) { fs.writeFileSync(p, src, 'utf8'); total += n; console.log('  ' + rel + ' : ' + n + ' reference(s)'); }
  else console.log('  ' + rel + ' : rien a changer (deja corrige ?)');
}

console.log('\n  ' + total + ' reference(s) au monogramme BH remplacee(s).');
console.log('  Verifiez que public/img/brand/web/hosterzz-mark.png est bien copie.\n');
