#!/usr/bin/env node
/* ============================================================
   LOT 10 — Accessibilite au clavier
   ============================================================
   Un PMS s'utilise huit heures par jour. Naviguer au clavier n'est
   pas seulement une question de handicap : c'est ce qui distingue un
   outil professionnel d'un site vitrine. Un gestionnaire qui saisit
   vingt reservations veut passer de champ en champ avec Tab, valider
   avec Entree, fermer avec Echap — sans toucher la souris.

   Ce script ne modifie rien. Il compte ce qui empeche cela, par
   gravite, avec le fichier et la ligne.

   ── CE QU'IL CHERCHE ────────────────────────────────────────────

   1. CLIQUABLES INACCESSIBLES — un <div onclick> ou <span onclick>
      n'est pas atteignable au clavier : pas de focus, pas d'Entree.
      C'est le defaut le plus repandu et le plus invalidant.

   2. FOCUS INVISIBLE — « outline: none » sans style de focus de
      remplacement. L'utilisateur au clavier ne sait plus ou il est.
      On ne peut pas naviguer ce qu'on ne voit pas.

   3. BOUTONS MUETS — un bouton qui ne contient qu'une icone, sans
      aria-label ni title. Un lecteur d'ecran annonce « bouton »,
      sans dire lequel.

   4. LIENS SANS DESTINATION — <a> sans href : pas focusable, donc
      invisible au clavier. Doit etre un <button>.

   5. ORDRE DE TABULATION FORCE — tabindex positif. Il court-circuite
      l'ordre naturel du document et devient faux des qu'on ajoute un
      champ.

   Usage :
     node outils/lot10-clavier.js
     node outils/lot10-clavier.js --detail
   ============================================================ */

const fs = require('fs');
const path = require('path');

const RACINE = process.cwd();
const PUBLIC = path.join(RACINE, 'public');
const DETAIL = process.argv.includes('--detail');

if (!fs.existsSync(PUBLIC)) {
  console.error('public/ introuvable — lancez depuis la racine du depot.');
  process.exit(1);
}

const pages = fs.readdirSync(PUBLIC).filter(f => f.endsWith('.html'));
const feuilles = fs.existsSync(path.join(PUBLIC, 'css'))
  ? fs.readdirSync(path.join(PUBLIC, 'css')).filter(f => f.endsWith('.css')) : [];

const R = {
  cliquables: [], focus: [], muets: [], liens: [], tabindex: []
};

/* ── 1, 3, 4, 5 : le HTML ───────────────────────────────────────── */
const BALISES_INERTES = /^(div|span|li|td|tr|p|img|i|section|article|header|footer|nav|ul|ol|h[1-6]|label)$/i;

for (const f of pages) {
  const html = fs.readFileSync(path.join(PUBLIC, f), 'utf8');
  const lignes = html.split('\n');

  lignes.forEach((ligne, i) => {
    const n = i + 1;

    /* 1. cliquables inaccessibles */
    const re = /<([a-z][a-z0-9]*)\b([^>]*\bonclick\s*=[^>]*)>/gi;
    let m;
    while ((m = re.exec(ligne)) !== null) {
      const balise = m[1], attrs = m[2];
      if (!BALISES_INERTES.test(balise)) continue;
      // deja rendus accessibles a la main ?
      if (/\brole\s*=\s*["']?button/i.test(attrs) && /\btabindex\s*=\s*["']?0/i.test(attrs)) continue;
      R.cliquables.push({ f, n, balise, extrait: ligne.trim().slice(0, 96) });
    }

    /* 3. boutons muets : <button> ... </button> sans texte ni label */
    const rb = /<button\b([^>]*)>([\s\S]{0,200}?)<\/button>/gi;
    while ((m = rb.exec(ligne)) !== null) {
      const attrs = m[1], contenu = m[2];
      if (/aria-label\s*=|title\s*=|aria-labelledby\s*=/i.test(attrs)) continue;
      const texte = contenu.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, '').trim();
      if (texte.length > 0) continue;
      R.muets.push({ f, n, extrait: (('<button' + attrs + '>' + contenu).trim()).slice(0, 96) });
    }

    /* 4. liens sans href */
    const ra = /<a\b([^>]*)>/gi;
    while ((m = ra.exec(ligne)) !== null) {
      if (/\bhref\s*=/i.test(m[1])) continue;
      if (/\bname\s*=/i.test(m[1])) continue;   // ancre historique
      R.liens.push({ f, n, extrait: m[0].slice(0, 96) });
    }

    /* 5. tabindex positif */
    const rt = /\btabindex\s*=\s*["']?([1-9]\d*)/gi;
    while ((m = rt.exec(ligne)) !== null) {
      R.tabindex.push({ f, n, valeur: m[1], extrait: ligne.trim().slice(0, 96) });
    }
  });
}

/* ── 2 : le focus, dans les feuilles ET dans le CSS des pages ───── */
function auditFocus(nom, css) {
  const sansCom = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const supprime = (sansCom.match(/outline\s*:\s*(none|0)\b/gi) || []).length;
  if (!supprime) return;
  const remplace = (sansCom.match(/:focus-visible|:focus\s*\{[^}]*(outline|box-shadow|border)/gi) || []).length;
  R.focus.push({ nom, supprime, remplace });
}

for (const f of feuilles) auditFocus('css/' + f, fs.readFileSync(path.join(PUBLIC, 'css', f), 'utf8'));
for (const f of pages) {
  const html = fs.readFileSync(path.join(PUBLIC, f), 'utf8');
  const blocs = (html.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || [])
    .map(b => b.replace(/^<style[^>]*>/i, '').replace(/<\/style>$/i, '')).join('\n');
  if (blocs) auditFocus(f, blocs);
}

/* ── Rapport ────────────────────────────────────────────────────── */
const parFichier = (liste) => {
  const m = {};
  for (const x of liste) m[x.f] = (m[x.f] || 0) + 1;
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
};

console.log('ACCESSIBILITE AU CLAVIER — ' + pages.length + ' pages, ' + feuilles.length + ' feuilles\n');

console.log('1. CLIQUABLES INACCESSIBLES AU CLAVIER ....... ' + R.cliquables.length);
console.log('   Un <div onclick> ne recoit pas le focus : l\'action est');
console.log('   impossible sans souris. Correctif : en faire un <button>, ou');
console.log('   ajouter role="button" tabindex="0" ET un gestionnaire clavier.');
for (const [f, n] of parFichier(R.cliquables).slice(0, 12)) console.log('     ' + String(n).padStart(4) + '  ' + f);

console.log('\n2. FOCUS RENDU INVISIBLE ..................... ' + R.focus.reduce((a, x) => a + x.supprime, 0));
console.log('   « outline: none » sans style de remplacement. Colonne de');
console.log('   droite : nombre de styles de focus trouves dans le meme fichier.');
for (const x of R.focus.sort((a, b) => b.supprime - a.supprime).slice(0, 12)) {
  const verdict = x.remplace === 0 ? '  AUCUN REMPLACEMENT' : (x.remplace < x.supprime ? '  partiel' : '  ok');
  console.log('     ' + String(x.supprime).padStart(4) + '  ' + x.nom.padEnd(34) + String(x.remplace).padStart(3) + verdict);
}

console.log('\n3. BOUTONS SANS NOM ACCESSIBLE ............... ' + R.muets.length);
console.log('   Bouton a icone seule, sans aria-label ni title.');
for (const [f, n] of parFichier(R.muets).slice(0, 12)) console.log('     ' + String(n).padStart(4) + '  ' + f);

console.log('\n4. LIENS SANS href ........................... ' + R.liens.length);
console.log('   Non focusables : doivent etre des <button>.');
for (const [f, n] of parFichier(R.liens).slice(0, 8)) console.log('     ' + String(n).padStart(4) + '  ' + f);

console.log('\n5. ORDRE DE TABULATION FORCE ................. ' + R.tabindex.length);
for (const [f, n] of parFichier(R.tabindex).slice(0, 8)) console.log('     ' + String(n).padStart(4) + '  ' + f);

const total = R.cliquables.length + R.muets.length + R.liens.length + R.tabindex.length;
console.log('\n' + '─'.repeat(64));
console.log('Total des points bloquants ................... ' + total);
console.log('\nPAR OU COMMENCER');
console.log('  Le point 2 d\'abord : rendre le focus visible ne demande qu\'une');
console.log('  regle globale et rend le clavier utilisable immediatement, meme');
console.log('  la ou tout le reste est imparfait.');
console.log('  Le point 1 ensuite, fichier par fichier, en commencant par les');
console.log('  ecrans du haut de liste.');

if (DETAIL) {
  console.log('\n\nDETAIL\n');
  const bloc = (titre, liste, champ) => {
    console.log('── ' + titre);
    for (const x of liste.slice(0, 60)) {
      console.log('   ' + (x.f + ':' + x.n).padEnd(38) + (champ ? x[champ] + '  ' : '') + (x.extrait || ''));
    }
    if (liste.length > 60) console.log('   … et ' + (liste.length - 60) + ' autres');
    console.log('');
  };
  bloc('Cliquables inaccessibles', R.cliquables, 'balise');
  bloc('Boutons sans nom', R.muets);
  bloc('Liens sans href', R.liens);
  bloc('tabindex positif', R.tabindex, 'valeur');
}
