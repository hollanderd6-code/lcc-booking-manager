#!/usr/bin/env node
/* ============================================================================
   outils/marque.js — normalise l'en-tete de toutes les pages.

   Ce que fait le script, sur chaque fichier de public/*.html :

   1. Injecte les balises de marque manquantes (favicon, apple-touch-icon,
      manifest, theme-color, og:image) sans jamais dupliquer celles qui
      existent deja.
   2. Insere bh-brand.css juste apres bh-theme-v3.css (l'ordre compte : la
      palette doit surcharger le theme, mais rester avant les calques lux).
   3. Recalcule TOUS les ?v= des css/js locaux a partir du hash du fichier.
      C'est le point qui evite les heures perdues sur du cache : un fichier
      inchange garde son parametre, un fichier modifie en recoit un nouveau.

   Le script est idempotent : on peut le relancer autant de fois que voulu.

   Usage :  node outils/marque.js            (applique)
            node outils/marque.js --essai    (montre sans ecrire)
   ============================================================================ */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RACINE = path.join(__dirname, '..', 'public');
const ESSAI = process.argv.includes('--essai');

const COULEUR_MARQUE = '#0E3B2E';

// ── Hash de contenu, pour les ?v= ──────────────────────────────────────────
const cacheHash = new Map();
function hash(cheminWeb) {
  if (cacheHash.has(cheminWeb)) return cacheHash.get(cheminWeb);
  const abs = path.join(RACINE, cheminWeb.replace(/^\//, '').split('?')[0]);
  let h = null;
  try {
    h = crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex').slice(0, 8);
  } catch { /* fichier absent : on laisse le ?v= tel quel */ }
  cacheHash.set(cheminWeb, h);
  return h;
}

// ── Balises de marque ──────────────────────────────────────────────────────
const BALISES = [
  { cle: 'icon-svg',   test: /rel=["']icon["'][^>]*\.svg/i,
    html: '<link rel="icon" href="/img/brand/web/favicon.svg" type="image/svg+xml">' },
  { cle: 'icon-png',   test: /rel=["']icon["'][^>]*favicon-32/i,
    html: '<link rel="icon" href="/img/brand/web/favicon-32.png" sizes="32x32" type="image/png">' },
  { cle: 'apple',      test: /rel=["']apple-touch-icon["']/i,
    html: '<link rel="apple-touch-icon" href="/img/brand/web/apple-touch-icon.png">' },
  { cle: 'manifest',   test: /rel=["']manifest["']/i,
    html: '<link rel="manifest" href="/img/brand/web/manifest.webmanifest">' },
  { cle: 'theme',      test: /name=["']theme-color["']/i,
    html: `<meta name="theme-color" content="${COULEUR_MARQUE}">` },
];

const BALISES_PUBLIQUES = [
  { cle: 'og-image',   test: /property=["']og:image["']/i,
    html: '<meta property="og:image" content="/img/brand/social/og-image.png">' },
  { cle: 'og-type',    test: /property=["']og:type["']/i,
    html: '<meta property="og:type" content="website">' },
];

// Pages applicatives : celles qui chargent la navigation
const estPageApp = (s) => /bh-layout\.js/.test(s);

function traiter(fichier) {
  const abs = path.join(RACINE, fichier);
  let s = fs.readFileSync(abs, 'utf8');
  const avant = s;
  const notes = [];

  // ── 1. ?v= recalcules sur le hash ────────────────────────────────────────
  let nbV = 0;
  s = s.replace(
    /((?:href|src)=["'])(\/(?:css|js|img)\/[^"'?]+\.(?:css|js))(\?v=[^"']*)?(["'])/g,
    (m, p1, chemin, ancienV, p4) => {
      const h = hash(chemin);
      if (!h) return m;
      const neuf = `${p1}${chemin}?v=${h}${p4}`;
      if (neuf !== m) nbV++;
      return neuf;
    }
  );
  if (nbV) notes.push(`${nbV} version(s)`);

  // ── 2. bh-brand.css juste apres bh-theme-v3.css ─────────────────────────
  if (!/bh-brand\.css/.test(s)) {
    const h = hash('/css/bh-brand.css');
    const lien = `<link rel="stylesheet" href="/css/bh-brand.css${h ? '?v=' + h : ''}">`;
    const apresTheme = s.match(/<link[^>]*bh-theme-v3\.css[^>]*>/i);
    if (apresTheme) {
      s = s.replace(apresTheme[0], apresTheme[0] + '\n' + lien);
      notes.push('bh-brand.css');
    } else if (/<\/head>/i.test(s) && /rel=["']stylesheet["']/i.test(s)) {
      // page sans theme v3 : on ajoute quand meme la palette, en dernier
      s = s.replace(/<\/head>/i, '  ' + lien + '\n</head>');
      notes.push('bh-brand.css (fin de head)');
    }
  }

  // ── 3. Balises de marque manquantes ─────────────────────────────────────
  const aPoser = BALISES.filter(b => !b.test.test(s));
  if (!estPageApp(s)) aPoser.push(...BALISES_PUBLIQUES.filter(b => !b.test.test(s)));

  if (aPoser.length && /<\/head>/i.test(s)) {
    const bloc = '\n  <!-- Marque Boostinghost — genere par outils/marque.js -->\n  '
      + aPoser.map(b => b.html).join('\n  ') + '\n';
    s = s.replace(/<\/head>/i, bloc + '</head>');
    notes.push(aPoser.map(b => b.cle).join('+'));
  }

  if (s !== avant) {
    if (!ESSAI) fs.writeFileSync(abs, s);
    console.log(`  ${fichier.padEnd(38)} ${notes.join(', ')}`);
    return 1;
  }
  return 0;
}

const pages = fs.readdirSync(RACINE).filter(f => f.endsWith('.html'));
console.log(ESSAI ? 'ESSAI — aucune ecriture\n' : 'Application\n');
const n = pages.reduce((acc, f) => acc + traiter(f), 0);
console.log(`\n${n} page(s) sur ${pages.length} mise(s) a jour.`);
