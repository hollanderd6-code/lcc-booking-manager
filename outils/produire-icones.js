#!/usr/bin/env node
/* ============================================================================
   outils/produire-icones.js — reconstruit les icones iOS et Android.

   Regle d'Apple, rappelee dans img/brand/LISEZ-MOI.md : les AppIcon-*.png sont
   des carres PLEINS, opaques, sans coins arrondis ni transparence. Le systeme
   applique lui-meme son masque (une superellipse, pas un arc de cercle). Un
   arrondi cuit dans le fichier produirait un liseré parasite apres masquage.

   Le SVG source ne doit donc pas porter de rx sur son rect de fond.

   sharp embarque son moteur de rendu : contrairement a cairosvg, il n'y a
   aucune bibliotheque systeme a installer.

   Dependance :  npm i -D sharp
   Usage      :  node outils/produire-icones.js public/img/brand/web/mono-ios.svg
   ============================================================================ */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SRC = process.argv[2] || 'public/img/brand/web/mono-ios.svg';
const DEST = process.argv[3] || 'public/img/brand';

const IOS = [20, 29, 40, 57, 58, 60, 76, 80, 87, 100, 114, 120, 144, 152, 167, 180, 1024];
const ANDROID = [48, 72, 96, 144, 192, 384, 512];
const MASKABLE = [192, 512];

// Le SVG fait 128 unites de cote. On monte la densite proportionnellement a la
// taille demandee : sans cela, sharp rasterise a 128 px puis agrandit, et le
// 1024 sort flou.
const COTE_SVG = 128;

if (!fs.existsSync(SRC)) {
  console.error(`Source introuvable : ${SRC}`);
  process.exit(1);
}
const svg = fs.readFileSync(SRC);

async function rendre(dossier, prefixe, tailles) {
  fs.mkdirSync(dossier, { recursive: true });
  for (const t of tailles) {
    const sortie = path.join(dossier, `${prefixe}-${t}.png`);
    await sharp(svg, { density: Math.ceil((72 * t) / COTE_SVG) })
      .resize(t, t)
      .png()
      .toFile(sortie);
    console.log(`  ${sortie}`);
  }
}

(async () => {
  console.log(`Source : ${SRC}\n`);
  await rendre(path.join(DEST, 'ios'), 'AppIcon', IOS);
  await rendre(path.join(DEST, 'android'), 'icon', ANDROID);
  // Android : la zone sure du masque adaptatif est plus large que celle d'iOS,
  // mais un inset de 10 % la respecte deja — meme trace.
  await rendre(path.join(DEST, 'android'), 'maskable', MASKABLE);

  const controle = path.join(DEST, 'ios', 'AppIcon-1024.png');
  const { data, info } = await sharp(controle).raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => {
    const i = (y * info.width + x) * info.channels;
    return [data[i], data[i + 1], data[i + 2]];
  };
  console.log(`\nControle sur ${path.basename(controle)} :`);
  console.log(`  coin (0,0)  ${px(0, 0).join(', ')}   attendu 14, 59, 46`);
  const fond = px(5, 5).join();
  let filet = null;
  for (let x = 0; x < 300; x++) {
    if (px(x, 512).join() !== fond) { filet = x; break; }
  }
  console.log(filet === null
    ? '  aucun filet detecte'
    : `  filet a ${(100 * filet / info.width).toFixed(1)} %`);
})();
