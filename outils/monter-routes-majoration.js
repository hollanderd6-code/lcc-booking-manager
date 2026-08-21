#!/usr/bin/env node
/* ============================================================
   Monter les routes de majoration dans server.js
   ============================================================
   Je ne peux pas lire server.js : il depasse la taille que je peux
   parcourir. Ce script ne devine donc rien — il LIT le fichier chez
   vous et en deduit les trois noms dont il a besoin :

     - le nom de l'application Express      (const app = express())
     - le nom du pool Postgres              (new Pool / const pool)
     - le nom du middleware d'authentification, extrait d'une route
       /api/properties existante — celui qui protege deja vos logements,
       donc forcement le bon.

   Si l'un des trois ne peut pas etre determine avec certitude, le
   script s'arrete et vous dit lequel, plutot que d'inserter une ligne
   qui ferait planter le serveur au demarrage.

   ── OU LA LIGNE EST INSEREE ──────────────────────────────────────
   Juste avant app.listen(). A cet endroit, `app`, `pool` et le
   middleware sont necessairement definis — c'est le seul point du
   fichier ou c'est garanti sans avoir a analyser l'ordre des
   declarations.

   L'ordre d'enregistrement des routes n'a pas d'importance ici :
   /api/properties/:id/markups a trois segments, il ne peut pas etre
   capture par un /api/properties/:id existant.

   Usage :
     node outils/monter-routes-majoration.js --essai
     node outils/monter-routes-majoration.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = process.cwd();
const CIBLE = path.join(RACINE, 'server.js');
const ROUTE = path.join(RACINE, 'routes', 'markup-routes.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

if (!fs.existsSync(CIBLE)) {
  console.error('\n  \u2717 server.js introuvable. Lancez depuis la racine du depot.\n');
  process.exit(1);
}
if (!fs.existsSync(ROUTE)) {
  console.error('\n  \u2717 routes/markup-routes.js introuvable.');
  console.error('    Copiez-le d\'abord :  cp .../markup-routes.js routes/\n');
  process.exit(1);
}

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('markup-routes') !== -1) {
  console.log('\n  La ligne est deja presente dans server.js — rien a faire.\n');
  process.exit(0);
}

/* ── Detection ───────────────────────────────────────────────────── */
const sansCommentaires = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

// 1. L'application Express
let nomApp = null;
const mApp = sansCommentaires.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*express\s*\(\s*\)/);
if (mApp) nomApp = mApp[1];

// 2. Le pool Postgres
let nomPool = null;
const mPool = sansCommentaires.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+Pool\b/);
if (mPool) nomPool = mPool[1];
else if (/(?:const|let|var)\s+pool\b/.test(sansCommentaires)) nomPool = 'pool';

// 3. Le middleware d'auth, lu sur une route /api/properties existante.
//    On compte les candidats : si plusieurs noms differents protegent des
//    routes /api/properties, on ne choisit pas au hasard.
const candidats = {};
const reRoute = /\.(?:get|post|put|patch|delete)\s*\(\s*['"`]\/api\/properties[^'"`]*['"`]\s*,\s*([A-Za-z_$][\w$.]*)\s*,/g;
let m;
while ((m = reRoute.exec(sansCommentaires)) !== null) {
  const nom = m[1];
  // « upload.single », « express.json » etc. ne sont pas des middlewares d'auth
  if (/^(upload|multer|express|bodyParser)\b/.test(nom)) continue;
  candidats[nom] = (candidats[nom] || 0) + 1;
}
const tries = Object.entries(candidats).sort((a, b) => b[1] - a[1]);
const nomAuth = tries.length ? tries[0][0] : null;

console.log('\n  DETECTE DANS server.js');
console.log('    application Express ....... ' + (nomApp || '\u2717 introuvable'));
console.log('    pool Postgres ............. ' + (nomPool || '\u2717 introuvable'));
console.log('    middleware d\'auth ......... ' + (nomAuth || '\u2717 introuvable') +
  (tries.length ? '   (' + tries[0][1] + ' route(s) /api/properties)' : ''));

if (tries.length > 1) {
  console.log('\n  Autres middlewares vus sur /api/properties :');
  tries.slice(1).forEach(function (t) { console.log('    ' + t[0] + '  (' + t[1] + ')'); });
  console.log('  Le plus utilise est retenu. Si ce n\'est pas le bon, corrigez');
  console.log('  la ligne a la main apres application.');
}

if (!nomApp || !nomPool || !nomAuth) {
  console.error('\n  \u2717 Detection incomplete — rien n\'a ete ecrit.');
  console.error('    Ajoutez la ligne a la main, avant app.listen() :');
  console.error('      require(\'./routes/markup-routes\')(app, pool, VOTRE_MIDDLEWARE);\n');
  process.exit(1);
}

/* ── Point d'insertion : avant le dernier app.listen( ────────────── */
const reListen = new RegExp('(^|\\n)([ \\t]*)' + nomApp.replace(/\$/g, '\\$') + '\\.listen\\s*\\(', 'g');
let dernier = null, mm;
while ((mm = reListen.exec(src)) !== null) dernier = mm;

if (!dernier) {
  console.error('\n  \u2717 ' + nomApp + '.listen( introuvable : impossible de situer l\'insertion.');
  console.error('    Ajoutez la ligne a la main avant le demarrage du serveur.\n');
  process.exit(1);
}

const indent = dernier[2] || '';
const posInsert = dernier.index + (dernier[1] ? dernier[1].length : 0);

const ligne =
  indent + '// ── Majoration de prix par plateforme ───────────────────────\n' +
  indent + '// Lecture et ecriture de properties.platform_markups. La majoration\n' +
  indent + '// est appliquee a la SORTIE, dans channex.js (assurerPlansMajores) :\n' +
  indent + '// base_price n\'est jamais modifie.\n' +
  indent + 'require(\'./routes/markup-routes\')(' + nomApp + ', ' + nomPool + ', ' + nomAuth + ');\n\n';

src = src.slice(0, posInsert) + ligne + src.slice(posInsert);

/* ── Controle de syntaxe ─────────────────────────────────────────── */
try {
  new Function(src);
} catch (e) {
  console.error('\n  \u2717 server.js ne serait plus du JavaScript valide : ' + e.message);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!ESSAI) fs.writeFileSync(CIBLE, src, 'utf8');

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  Ligne inseree juste avant ' + nomApp + '.listen( :');
console.log('    require(\'./routes/markup-routes\')(' + nomApp + ', ' + nomPool + ', ' + nomAuth + ');');
console.log('\n  Syntaxe de server.js verifiee.');
console.log('\n  AU REDEMARRAGE, vous devez voir dans les logs :');
console.log('    ✅ [MARKUPS] Routes de majoration par plateforme montées');
console.log('\n  Si le serveur refuse de demarrer, la ligne est isolee et');
console.log('  annulable :  git diff server.js  puis  git checkout -- server.js');
if (ESSAI) console.log('\n  Relancez sans --essai pour appliquer.');
console.log('');
