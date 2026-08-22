#!/usr/bin/env node
/* ============================================================
   Monter les routes de regroupement dans server.js
   ============================================================
   Meme methode que outils/monter-routes-majoration.js : le script LIT
   server.js et en deduit les trois noms dont il a besoin, plutot que de
   les supposer.

     - l'application Express      (const app = express())
     - le pool Postgres           (new Pool)
     - le middleware d'auth       extrait d'une route /api/properties
                                  existante, donc forcement le bon

   Si l'un des trois est introuvable, le script s'arrete sans rien
   ecrire : une ligne fausse ferait planter le serveur au demarrage.

   Usage :
     node outils/monter-routes-regroupement.js --essai
     node outils/monter-routes-regroupement.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = process.cwd();
const CIBLE = path.join(RACINE, 'server.js');
const ROUTE = path.join(RACINE, 'routes', 'regroupement-routes.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

if (!fs.existsSync(CIBLE)) {
  console.error('\n  \u2717 server.js introuvable. Lancez depuis la racine du depot.\n');
  process.exit(1);
}
if (!fs.existsSync(ROUTE)) {
  console.error('\n  \u2717 routes/regroupement-routes.js introuvable.');
  console.error('    Copiez-le d\'abord :  cp /tmp/reg/.../regroupement-routes.js routes/\n');
  process.exit(1);
}

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('regroupement-routes') !== -1) {
  console.log('\n  La ligne est deja presente dans server.js — rien a faire.\n');
  process.exit(0);
}

const sansCommentaires = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

let nomApp = null;
const mApp = sansCommentaires.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*express\s*\(\s*\)/);
if (mApp) nomApp = mApp[1];

let nomPool = null;
const mPool = sansCommentaires.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+Pool\b/);
if (mPool) nomPool = mPool[1];
else if (/(?:const|let|var)\s+pool\b/.test(sansCommentaires)) nomPool = 'pool';

// Le middleware, lu sur les routes /api/properties : c'est celui qui protege
// deja les logements, donc celui qu'attend cette route.
const candidats = {};
const reRoute = /\.(?:get|post|put|patch|delete)\s*\(\s*['"`]\/api\/properties[^'"`]*['"`]\s*,\s*([A-Za-z_$][\w$.]*)\s*,/g;
let m;
while ((m = reRoute.exec(sansCommentaires)) !== null) {
  if (/^(upload|multer|express|bodyParser)\b/.test(m[1])) continue;
  candidats[m[1]] = (candidats[m[1]] || 0) + 1;
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
  tries.slice(1).forEach(t => console.log('    ' + t[0] + '  (' + t[1] + ')'));
  console.log('  Le plus utilise est retenu.');
}

if (!nomApp || !nomPool || !nomAuth) {
  console.error('\n  \u2717 Detection incomplete — rien n\'a ete ecrit.');
  console.error('    Ajoutez la ligne a la main, avant app.listen() :');
  console.error('      require(\'./routes/regroupement-routes\')(app, pool, VOTRE_MIDDLEWARE);\n');
  process.exit(1);
}

// Insertion avant le dernier app.listen( : le seul endroit ou app, pool et le
// middleware sont forcement definis, sans analyser l'ordre des declarations.
const reListen = new RegExp('(^|\\n)([ \\t]*)' + nomApp.replace(/\$/g, '\\$') + '\\.listen\\s*\\(', 'g');
let dernier = null, mm;
while ((mm = reListen.exec(src)) !== null) dernier = mm;

if (!dernier) {
  console.error('\n  \u2717 ' + nomApp + '.listen( introuvable : impossible de situer l\'insertion.\n');
  process.exit(1);
}

const indent = dernier[2] || '';
const posInsert = dernier.index + (dernier[1] ? dernier[1].length : 0);

const ligne =
  indent + '// ── Rattachement d\'un logement a l\'immeuble d\'un autre ──────\n' +
  indent + '// Deux logements a la meme adresse mais sur des etablissements\n' +
  indent + '// separes : Booking.com refuse le second, son identifiant\n' +
  indent + '// d\'etablissement n\'etant utilisable qu\'une fois.\n' +
  indent + 'require(\'./routes/regroupement-routes\')(' + nomApp + ', ' + nomPool + ', ' + nomAuth + ');\n\n';

src = src.slice(0, posInsert) + ligne + src.slice(posInsert);

try {
  new Function(src);
} catch (e) {
  console.error('\n  \u2717 server.js ne serait plus du JavaScript valide : ' + e.message);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!ESSAI) fs.writeFileSync(CIBLE, src, 'utf8');

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  Ligne inseree avant ' + nomApp + '.listen( :');
console.log('    require(\'./routes/regroupement-routes\')(' + nomApp + ', ' + nomPool + ', ' + nomAuth + ');');
console.log('\n  Syntaxe de server.js verifiee.');
console.log('\n  AU REDEMARRAGE, dans les logs :');
console.log('    ✅ [REGROUPEMENT] Routes de rattachement d\'immeuble montées');
console.log('\n  Annulable :  git checkout -- server.js');
if (ESSAI) console.log('\n  Relancez sans --essai pour appliquer.');
console.log('');
