#!/usr/bin/env node
/* ============================================================
   LOT 1 — Remettre la cascade CSS d'aplomb
   ============================================================
   CE QUE LA MESURE A MONTRE

   Les feuilles de style ne sont pas "en bas du document" : elles
   sont toutes dans le <head>. Mais ce <head> fait 1 575 lignes
   (3 554 pour app.html) et contient 40 a 72 Ko de CSS EN LIGNE.
   Les feuilles sont posees de part et d'autre de ce pave :

     cleaning.html
       all.min · style · bh-theme-v3 · bh-shared · bh-bottom-bar
       · bh-badges · cleaning-cards · guest-info
       >>> 40 Ko de <style> en ligne <<<
       · menu-plus-fixes · menu-active-button
       · mobile-native-styles · bh-core

   D'ou les deux symptomes constates :

   1. les feuilles placees AVANT le pave perdent contre lui.
      C'est la raison d'etre de la plupart des !important : une
      regle de theme doit crier pour battre le CSS de la page.
   2. l'ordre relatif differe d'une page a l'autre. Dans app.html
      bh-theme-v3 charge APRES bh-bottom-bar et bh-badges ; dans
      cleaning.html il charge AVANT. Meme composant, deux rendus.

   CE QUE FAIT CE SCRIPT

   - il regroupe toutes les feuilles /css/ en UN bloc unique,
     dans un ordre canonique identique sur toutes les pages ;
   - il place ce bloc en tete du <head>, et deplace le CSS en
     ligne de la page APRES, sans en changer une virgule.

   L'architecture devient celle qu'on attend : le general d'abord,
   le particulier ensuite. Le CSS d'une page gagne sur les feuilles
   globales — ce qui est le comportement correct, et ce qui rendra
   les !important supprimables au lot 2.

   LE SEUL CHANGEMENT DE COMPORTEMENT, ANNONCE

   Quatre feuilles chargeaient apres le CSS de la page et le
   battaient : menu-plus-fixes, menu-active-button,
   mobile-native-styles, bh-core. Elles passent avant. Leurs regles
   en !important continuent de gagner (un !important en feuille bat
   une regle simple en ligne, quel que soit l'ordre) ; leurs regles
   SANS !important cedent desormais au CSS de la page. Le script
   compte ces regles et les liste : c'est la seule chose a verifier
   a l'ecran apres passage.

   Usage :
     node outils/lot1-cascade.js --essai     (n'ecrit rien)
     node outils/lot1-cascade.js             (applique)
   ============================================================ */

const fs = require('fs');
const path = require('path');

const RACINE = process.cwd();
const DOSSIER = path.join(RACINE, 'public');
const CSS = path.join(DOSSIER, 'css');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

/* ── L'ordre canonique, du plus general au plus specifique ──
   Une feuille absente d'une page n'est jamais ajoutee : on ne
   reordonne que ce que la page chargeait deja.

   IMPORTANT — le CSS en ligne de la page reste a sa place dans la
   pile. Les feuilles qui le precedaient le precedent encore, celles
   qui le suivaient le suivent encore. C'est ce qui garantit un
   rendu identique : la mesure a montre que bh-core.css (141 regles,
   zero !important) et mobile-native-styles.css (370 regles simples)
   ne gagnent aujourd'hui QUE parce qu'ils chargent apres. Les faire
   remonter casserait badges, toasts, squelettes et focus.
   Leur remise a l'endroit se fera au lot 2, en separant les jetons
   (qui doivent charger en premier) des regles de composants (qui
   doivent charger en dernier).                                     */
const ORDRE = [
  // 0. Bibliotheques tierces
  'all.min.css',

  // 1. Socle historique, puis theme principal
  'style.css',
  'bh-theme-v3.css',

  // 2. Jetons de marque
  'bh-brand.css',

  // 3. Calques "luxe", du general au particulier
  'bh-lux.css',
  'bh-lux-app.css',
  'bh-lux-pages.css',
  'bh-messages-lux.css',
  'bh-settings-lux.css',

  // 4. Structure partagee
  'bh-shared.css',
  'bh-menu.css',
  'bh-bottom-bar.css',
  'bh-badges.css',

  // 5. Habillages par page
  'chat-modern.css',
  'guest-info-styles.css',
  'cleaning-cards-style.css',
  'deposits-cards-style.css',
  'invoices-cards-style.css',

  // 6. Mobile : apres le desktop, sinon les media queries ne servent a rien
  'bh-mobile.css',
  'bh-v3-mobile.css',
  'mobile-native-styles.css',
  'modal-keyboard-fix.css',

  // 7. Correctifs empiles — a supprimer au lot 4
  'menu-plus-fixes.css',
  'menu-active-button.css',

  // 8. Jetons + finitions. Sa place logique est en tete (jetons), mais
  //    ses 141 regles de composants n'ont aucun !important et comptent
  //    sur leur position finale. On ne le deplace pas : lot 2.
  'bh-core.css'
];

/* NOTE bh-core.css — il joue deux roles incompatibles dans un seul
   fichier : declarer les jetons de marque (role qui exige de charger
   en PREMIER) et poser les badges, toasts, squelettes et focus (role
   qui exige de charger en DERNIER). Tant que les deux cohabitent, sa
   place ne peut pas etre juste. Le lot 2 le coupe en deux.          */

const rangInconnu = ORDRE.length;
const rangDe = (f) => { const i = ORDRE.indexOf(f); return i === -1 ? rangInconnu : i; };

const RE_BALISE = /<link\b[^>]*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi;
const estFeuilleCss = (b) => /^<link/i.test(b)
  && /rel\s*=\s*["']?stylesheet/i.test(b)
  && /href\s*=\s*["'][^"']*\/?css\/[^"']+\.css/i.test(b);
const fichierDe = (b) => {
  const m = b.match(/href\s*=\s*["']([^"']+)["']/i);
  return m ? m[1].split('?')[0].split('/').pop() : null;
};

/* Mesure le poids des feuilles qui doivent conserver leur position
   finale : c'est ce qui justifie de ne PAS les remonter au lot 1.   */
const DOIVENT_RESTER_APRES = ['bh-mobile.css', 'bh-v3-mobile.css', 'mobile-native-styles.css', 'modal-keyboard-fix.css', 'menu-plus-fixes.css', 'menu-active-button.css', 'bh-core.css'];
function poidsDesTardives() {
  const out = [];
  for (const f of DOIVENT_RESTER_APRES) {
    const p = path.join(CSS, f);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const decls = src.match(/[a-z-]+\s*:[^;{}]+;/gi) || [];
    const simples = decls.filter(d => !/!important/i.test(d)).length;
    out.push({ f, total: decls.length, simples });
  }
  return out;
}

function traiter(chemin) {
  const nom = path.relative(RACINE, chemin);
  let html = fs.readFileSync(chemin, 'utf8');
  const finHead = html.search(/<\/head\s*>/i);
  if (finHead === -1) return { nom, statut: 'ignore', detail: 'pas de </head>' };

  const head = html.slice(0, finHead);
  const reste = html.slice(finHead);

  /* On releve toutes les balises de style du <head> dans l'ordre, en
     notant pour chaque feuille si elle se trouvait AVANT ou APRES le
     premier bloc de CSS en ligne. Ce cote est preserve : c'est la
     condition d'un rendu identique.                                 */
  const avant = new Map();      // fichier -> balise
  const apres = new Map();
  const enLigne = [];           // blocs <style> du milieu, verbatim
  const enLigneFin = [];        // blocs <style> posterieurs aux feuilles tardives
  const morceaux = [];          // head prive des balises extraites
  let curseur = 0, m, nbFeuilles = 0, vuUnStyle = false, vuUneTardive = false;

  RE_BALISE.lastIndex = 0;
  while ((m = RE_BALISE.exec(head)) !== null) {
    const balise = m[0];
    if (!(estFeuilleCss(balise) || /^<style/i.test(balise))) continue;

    morceaux.push(head.slice(curseur, m.index).replace(/[ \t]*$/, ''));
    curseur = m.index + balise.length;

    if (/^<style/i.test(balise)) {
      // un bloc pose apres les feuilles tardives doit y rester : sur
      // app.html le 17e bloc suit bh-core.css et compte le battre.
      (vuUneTardive ? enLigneFin : enLigne).push(balise);
      vuUnStyle = true;
      continue;
    }

    const f = fichierDe(balise);
    if (!f) continue;
    nbFeuilles++;
    // une feuille deja vue de l'autre cote reste du cote le plus tardif
    if (vuUnStyle) { avant.delete(f); apres.set(f, balise); vuUneTardive = true; }
    else if (!apres.has(f)) { avant.set(f, balise); }
  }
  if (!avant.size && !apres.size && !enLigne.length && !enLigneFin.length) return { nom, statut: 'rien' };
  morceaux.push(head.slice(curseur));

  const tete = morceaux.join('').replace(/\n{3,}/g, '\n\n');
  const trier = (map) => [...map.entries()]
    .sort((a, b) => rangDe(a[0]) - rangDe(b[0]) || a[0].localeCompare(b[0]));
  const ordA = trier(avant);
  const ordB = trier(apres);

  const blocA = ordA.length ? (
    '\n  <!-- Feuilles globales — ordre unique sur toutes les pages (lot 1).\n'
    + '       Du general au particulier : tiers, theme, jetons, calques,\n'
    + '       structure, habillages. N\'ajoutez aucun <link> ailleurs dans le\n'
    + '       document ; la place d\'une nouvelle feuille se decide dans\n'
    + '       outils/lot1-cascade.js. -->\n'
    + ordA.map(([, b]) => '  ' + b.trim()).join('\n') + '\n'
  ) : '';

  const blocEnLigne = enLigne.length ? (
    '\n  <!-- CSS propre a cette page. -->\n'
    + enLigne.map(s => '  ' + s.trim()).join('\n\n') + '\n'
  ) : '';

  const blocB = ordB.length ? (
    '\n  <!-- Calques tardifs — mobile et correctifs empiles. Ils surchargent\n'
    + '       volontairement le CSS de la page et n\'ont presque pas de\n'
    + '       !important : leur position finale est ce qui les fait tenir.\n'
    + '       A resorber au lot 4, pas a deplacer maintenant. -->\n'
    + ordB.map(([, b]) => '  ' + b.trim()).join('\n') + '\n'
  ) : '';

  const blocFin = enLigneFin.length ? (
    '\n  <!-- CSS de page pose apres les calques tardifs : il les surcharge\n'
    + '       volontairement, sa position est conservee telle quelle. -->\n'
    + enLigneFin.map(s => '  ' + s.trim()).join('\n\n') + '\n'
  ) : '';

  const nouveau = tete.replace(/\s*$/, '\n') + blocA + blocEnLigne + blocB + blocFin + reste;
  if (!ESSAI) fs.writeFileSync(chemin, nouveau, 'utf8');

  return {
    nom, statut: 'traite',
    feuilles: avant.size + apres.size,
    tardives: apres.size,
    doublons: nbFeuilles - (avant.size + apres.size),
    blocsEnLigne: enLigne.length + enLigneFin.length,
    octetsEnLigne: enLigne.concat(enLigneFin).reduce((n, s) => n + s.length, 0),
    ordre: ordA.map(([f]) => f)
      .concat(['—CSS de la page—'], ordB.map(([f]) => f), enLigneFin.length ? ['—CSS de la page (fin)—'] : [])
  };
}

/* ── Parcours ─────────────────────────────────────────────── */
/* ── Garde-fou : sommes-nous dans le bon depot ? ───────────────
   Le script a deja ete lance par erreur dans un autre projet.
   On exige des marqueurs propres a LCC Booking Manager avant de
   toucher au moindre fichier.                                    */
const manquants = [];
if (!fs.existsSync(DOSSIER)) manquants.push('public/');
if (!fs.existsSync(CSS)) manquants.push('public/css/');
const TEMOINS = ['bh-core.css', 'bh-theme-v3.css', 'bh-brand.css'];
const presents = fs.existsSync(CSS) ? TEMOINS.filter(f => fs.existsSync(path.join(CSS, f))) : [];
if (presents.length < 2) manquants.push('les feuilles bh-* (' + presents.length + '/3 trouvees)');

if (manquants.length) {
  console.error('\n  \u2717 Ce dossier n\'est pas le depot LCC Booking Manager.');
  console.error('    Introuvable : ' + manquants.join(', '));
  console.error('    Dossier courant : ' + RACINE);
  console.error('\n    Placez-vous a la racine du depot LCC, puis relancez :');
  console.error('      cd ~/lcc-booking-manager');
  console.error('      node outils/lot1-cascade.js --essai\n');
  process.exit(1);
}

const pages = fs.readdirSync(DOSSIER).filter(f => f.endsWith('.html')).map(f => path.join(DOSSIER, f));
console.log((ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLICATION —') + '  ' + pages.length + ' pages\n');

let nbT = 0, nbDbl = 0, nbBlocs = 0, nbOctets = 0, nbTardives = 0;
const signatures = new Map();

for (const p of pages) {
  const r = traiter(p);
  if (r.statut === 'ignore') { console.log('  ignoree  ' + r.nom + '  (' + r.detail + ')'); continue; }
  if (r.statut !== 'traite') continue;
  nbT++; nbDbl += r.doublons; nbBlocs += r.blocsEnLigne; nbOctets += r.octetsEnLigne; nbTardives += r.tardives;
  signatures.set(r.ordre.join(' > '), (signatures.get(r.ordre.join(' > ')) || 0) + 1);
  console.log('  ' + r.nom.padEnd(38)
    + String(r.feuilles).padStart(2) + ' feuilles'
    + (r.tardives ? ' (dont ' + r.tardives + ' tardive' + (r.tardives > 1 ? 's' : '') + ')' : '            ')
    + (r.blocsEnLigne ? '  ' + r.blocsEnLigne + ' bloc(s) en ligne, ' + Math.round(r.octetsEnLigne / 1024) + ' Ko' : '')
    + (r.doublons ? '  ← ' + r.doublons + ' doublon(s)' : ''));
}

console.log('\n' + '─'.repeat(66));
console.log('Pages traitees ..................... ' + nbT);
console.log('Doublons de feuilles supprimes ..... ' + nbDbl);
console.log('CSS de page laisse en place ........ ' + nbBlocs + ' blocs, ' + Math.round(nbOctets / 1024) + ' Ko');
console.log('Feuilles maintenues en position fin . ' + nbTardives);
console.log('Piles distinctes ................... ' + signatures.size);
console.log('\nPourquoi le rendu ne change pas : chaque feuille reste du meme cote');
console.log('du CSS de la page qu\'avant. Seul l\'ordre A L\'INTERIEUR de chaque');
console.log('groupe est uniformise — c\'est ce qui supprime les ecarts entre pages');
console.log('(bh-theme-v3 avant bh-badges partout, et non l\'inverse selon la page).');
console.log('\nLes feuilles maintenues en fin, et ce qui les y retient :');
for (const r of poidsDesTardives()) {
  const pct = r.total ? Math.round(r.simples / r.total * 100) : 0;
  console.log('  ' + r.f.padEnd(28) + String(r.simples).padStart(4) + ' regles sans !important sur ' + r.total + '  (' + pct + ' %)');
}
console.log('\nCes feuilles ne tiennent que par leur position. Les remonter sans');
console.log('les avoir reecrites casserait badges, toasts, squelettes et focus :');
console.log('c\'est le travail du lot 2, qui separe les jetons des composants.');
console.log('\nA parcourir quand meme apres application : une page de liste, les');
console.log('reglages, la messagerie — desktop et mobile.');
if (ESSAI) console.log('\nEssai termine — rien n\'a ete ecrit. Relancez sans --essai pour appliquer.');
