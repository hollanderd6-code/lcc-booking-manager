#!/usr/bin/env node
/* ============================================================
   LOT 5 — Code mort et fichiers servis pour rien
   ============================================================
   ── DEUX CORRECTIONS PAR RAPPORT A LA PREMIERE VERSION ──────

   1. PERIMETRE. La v1 scannait tout le depot, y compris android/,
      ios/ et android/app/build/ — qui sont des COPIES de public/
      fabriquees par Capacitor. Chaque fichier paraissait donc
      « utilise », cite par ses propres copies. Seule la source
      compte : public/, server.js, CLAUDE.md.

   2. NOMS AMBIGUS. public/bh-layout.js et public/js/bh-layout.js
      portent le MEME nom. Chercher « bh-layout.js » ne peut pas
      les distinguer : les deux paraissent utilises alors qu'une
      seule des deux copies est chargee.
      Quand un nom existe a plusieurs endroits, on cherche donc le
      CHEMIN exact tel qu'il apparait dans une URL (« /bh-layout.js »
      contre « /js/bh-layout.js »), precede d'un guillemet ou d'un
      signe egal. Sinon on garde la recherche par nom, qui attrape
      aussi les chargements construits dynamiquement.

   3. MES PROPRES OUTILS FAUSSAIENT LE COMPTE. outils/lot1-cascade.js
      enumere les feuilles dans sa liste ORDRE, et ce fichier-ci cite
      des noms dans ses commentaires. Trois fichiers morts etaient
      donc « conserves », sauves par une mention dans un outil.
      outils/ est desormais hors du perimetre de recherche.

   4. LA DOCUMENTATION N'EST PAS UN CHARGEMENT. Un fichier cite
      uniquement dans CLAUDE.md ou README.md n'est charge par aucune
      page : il est signale a part, pour votre jugement, plutot que
      sauve d'office ou supprime a l'aveugle.

   Le script ne supprime rien : avec --appliquer il DEPLACE vers
   .corbeille-lot5/ en conservant l'arborescence.

   Usage :
     node outils/lot5-menage.js
     node outils/lot5-menage.js --appliquer
   ============================================================ */

const fs = require('fs');
const path = require('path');

const RACINE = process.cwd();
const PUBLIC = path.join(RACINE, 'public');
const APPLIQUER = process.argv.includes('--appliquer');
const CORBEILLE = path.join(RACINE, '.corbeille-lot5');

if (!fs.existsSync(PUBLIC)) {
  console.error('public/ introuvable — lancez depuis la racine du depot.');
  process.exit(1);
}

/* ── Perimetre : la SOURCE, jamais les copies de build ───────────────── */
const HORS_PERIMETRE = [
  'android', 'ios', 'guest-app', 'node_modules', '.git',
  '.corbeille-lot5', 'dist', 'build', 'www',
  // Les outils de cet audit citent des noms de fichiers dans leurs
  // commentaires et leurs listes de configuration : ce ne sont pas des
  // chargements, et ils sauvaient a tort des fichiers morts.
  'outils'
];
const estHorsPerimetre = (rel) => HORS_PERIMETRE.some(d => rel === d || rel.startsWith(d + path.sep));

const EXT_TEXTE = new Set(['.html', '.js', '.css', '.json', '.md', '.txt', '.backup', '.mjs', '.cjs']);

function parcourir(dir, sortie = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const rel = path.relative(RACINE, p);
    if (estHorsPerimetre(rel)) continue;
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) parcourir(p, sortie);
    else sortie.push(p);
  }
  return sortie;
}

const tous = parcourir(RACINE);

/* ── Les candidats ──────────────────────────────────────────────────── */
const candidats = [];
const vu = new Set();
const ajouter = (p, motif) => { if (!vu.has(p)) { vu.add(p); candidats.push({ p, motif }); } };

// 1. Sauvegardes
for (const p of tous) {
  const n = path.basename(p);
  if (/\.bak(-[\d-]+)?$/.test(n) || /\.backup$/.test(n) || /\.orig$/.test(n) || n.endsWith('~')) {
    ajouter(p, 'sauvegarde');
  }
}

// 2. Archives
const ARCHIVE = path.join(PUBLIC, 'css', '_archive');
if (fs.existsSync(ARCHIVE)) for (const p of parcourir(ARCHIVE)) ajouter(p, 'archive');

// 3. Doublons de nom entre public/ et public/{css,js}
for (const e of fs.readdirSync(PUBLIC)) {
  const p = path.join(PUBLIC, e);
  if (!fs.statSync(p).isFile() || !/\.(css|js)$/i.test(e)) continue;
  const jumeau = path.join(PUBLIC, /\.css$/i.test(e) ? 'css' : 'js', e);
  if (fs.existsSync(jumeau)) ajouter(p, 'double de public/' + (/\.css$/i.test(e) ? 'css/' : 'js/') + e);
}

// 4. Feuilles et scripts jamais references
for (const sous of ['css', 'js']) {
  const d = path.join(PUBLIC, sous);
  if (!fs.existsSync(d)) continue;
  for (const e of fs.readdirSync(d)) {
    const p = path.join(d, e);
    if (!fs.statSync(p).isFile() || !/\.(css|js)$/i.test(e)) continue;
    ajouter(p, 'candidat');   // statut tranche plus bas
  }
}

/* ── Le texte de la source, hors candidats ──────────────────────────── */
const exclus = new Set(candidats.map(c => c.p));
const textes = [];
for (const p of tous) {
  if (exclus.has(p)) continue;                       // un mort n'en sauve pas un autre
  if (!EXT_TEXTE.has(path.extname(p).toLowerCase())) continue;
  try {
    if (fs.statSync(p).size > 8 * 1024 * 1024) continue;
    textes.push([path.relative(RACINE, p), fs.readFileSync(p, 'utf8')]);
  } catch (e) { /* illisible */ }
}

/* Combien de fichiers portent ce nom, dans toute la source ? */
const parNom = new Map();
for (const p of tous) {
  const n = path.basename(p);
  parNom.set(n, (parNom.get(n) || 0) + 1);
}

/* Cherche les references a un candidat.
   Nom unique  -> recherche par nom (attrape les chargements dynamiques).
   Nom ambigu  -> recherche du CHEMIN d'URL exact, precede d'un guillemet,
                  d'un = ou d'une parenthese, pour ne pas confondre
                  « /bh-layout.js » avec « /js/bh-layout.js ».            */
function references(candidat) {
  const nom = path.basename(candidat);
  const relPublic = path.relative(PUBLIC, candidat);
  const ambigu = (parNom.get(nom) || 0) > 1;
  const out = [];

  if (!ambigu) {
    for (const [p, c] of textes) if (c.includes(nom)) out.push(p);
    return { out, methode: 'nom' };
  }

  const url = '/' + relPublic.split(path.sep).join('/');
  const motifs = ['"' + url, "'" + url, '=' + url, '(' + url, ' ' + url];
  for (const [p, c] of textes) {
    if (motifs.some(m => c.includes(m))) out.push(p);
  }
  return { out, methode: 'chemin ' + url };
}

/* ── Tri ────────────────────────────────────────────────────────────── */
const estDoc = (rel) => /\.md$/i.test(rel);
const aSupprimer = [], aGarder = [], docSeule = [];
for (const c of candidats) {
  const { out, methode } = references(c.p);
  const taille = fs.statSync(c.p).size;
  const motif = c.motif === 'candidat' ? 'jamais reference' : c.motif;
  const code = out.filter(p => !estDoc(p));
  if (code.length) aGarder.push({ ...c, cites: code, taille, methode });
  else if (out.length) docSeule.push({ ...c, cites: out, taille, methode, motif });
  else aSupprimer.push({ ...c, motif, taille, methode });
}

const ko = (o) => (o / 1024).toFixed(0) + ' Ko';
const total = aSupprimer.reduce((n, c) => n + c.taille, 0);

console.log((APPLIQUER ? '— APPLICATION —' : '— RAPPORT, rien n\'est touche —'));
console.log('Perimetre : la source seule. android/, ios/, guest-app/ et les');
console.log('dossiers de build sont ignores (ce sont des copies de public/).\n');

const groupes = {};
for (const c of aSupprimer) (groupes[c.motif] = groupes[c.motif] || []).push(c);
for (const motif of Object.keys(groupes).sort()) {
  const l = groupes[motif];
  console.log(motif.toUpperCase() + '  (' + l.length + ', ' + ko(l.reduce((n, c) => n + c.taille, 0)) + ')');
  for (const c of l) console.log('    ' + path.relative(RACINE, c.p).padEnd(50) + ko(c.taille).padStart(8));
  console.log('');
}

console.log('─'.repeat(64));
console.log('A retirer ............ ' + aSupprimer.length + ' fichiers, ' + ko(total));
console.log('Cites en doc seule ... ' + docSeule.length + '   (a trancher)');
console.log('Conserves ............ ' + aGarder.length);

if (docSeule.length) {
  console.log('\nA TRANCHER — cites SEULEMENT dans la documentation, donc charges par');
  console.log('aucune page. Soit le fichier sert encore et la doc a raison, soit la');
  console.log('doc decrit un etat passe. Ils ne sont PAS deplaces :');
  for (const c of docSeule) {
    console.log('    ' + path.relative(RACINE, c.p).padEnd(46) + ko(c.taille).padStart(8)
      + '   doc : ' + c.cites.join(', '));
  }
}

if (aGarder.length) {
  console.log('\nCONSERVES — references, avec la preuve :');
  for (const c of aGarder.sort((a, b) => a.p.localeCompare(b.p))) {
    console.log('    ' + path.relative(RACINE, c.p));
    console.log('        par ' + c.cites.length + ' fichier(s) [' + c.methode + '] : '
      + c.cites.slice(0, 3).join(', ') + (c.cites.length > 3 ? ' …' : ''));
  }
}

/* ── Artefacts de build suivis par git ──────────────────────────────── */
const suspects = ['android/app/build', 'ios/App/App/public', 'android/app/src/main/assets/public'];
const presents = suspects.filter(d => fs.existsSync(path.join(RACINE, d)));
if (presents.length) {
  console.log('\nA VERIFIER SEPAREMENT — dossiers de build presents dans le depot :');
  for (const d of presents) console.log('    ' + d);
  console.log('  Ce sont des copies regenerees par « npx cap sync ». Les versionner');
  console.log('  alourdit le depot et fait apparaitre chaque correction en double.');
  console.log('  Verifiez : git ls-files android/app/build | head');
  console.log('  S\'ils sont suivis, les retirer du suivi (sans les effacer) :');
  console.log('      git rm -r --cached android/app/build');
  console.log('      echo "android/app/build/" >> .gitignore');
}

if (!APPLIQUER) {
  console.log('\nRelancez avec --appliquer pour deplacer vers .corbeille-lot5/.');
  process.exit(0);
}

let n = 0;
for (const c of aSupprimer) {
  const dest = path.join(CORBEILLE, path.relative(RACINE, c.p));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(c.p, dest);
  n++;
}
console.log('\n' + n + ' fichiers deplaces vers .corbeille-lot5/');
console.log('Retour en arriere : rsync -a .corbeille-lot5/ ./');
console.log('Ajoutez .corbeille-lot5/ a .gitignore, verifiez le produit,');
console.log('puis supprimez le dossier quand vous etes sur.');
