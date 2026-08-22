#!/usr/bin/env node
/* ============================================================
   outils/apropos-boostprice.js
   Le bloc « A propos » disait trois choses inexactes
   ============================================================
   Cible : public/dynamic-pricing.html

   ── CE QUI CLOCHAIT ──────────────────────────────────────────────

   1. « 50 a 200 logements similaires »
      Une fourchette annoncee, alors que chaque carte du dashboard
      affiche le nombre reel de comparables. Si une carte en montre 14,
      la promesse est dementie sur le meme ecran. On affiche donc le
      chiffre reel, lu dans les donnees deja chargees.

   2. « L'equivalent de PriceLabs (49€/mois) ou Wheelhouse (39€/mois) »
      Cet argument appartient a la page de vente. Ici, face a un client
      qui a deja paye, il n'apporte rien — et ces tarifs seront faux
      dans un an. « Inclus dans votre abonnement » suffit.

   3. « L'algorithme combine 4 signaux : taux d'occupation du marche,
      prix median, votre propre occupation et la saisonnalite. »
      Le code (calcRecommendedPrice) part du prix median et lui applique
      TROIS facteurs : occupation du marche, votre occupation,
      saisonnalite. Le prix median n'est pas un signal, c'est la base du
      calcul. Compter quatre choses la ou il y en a trois plus une base
      fait douter du reste.

   Usage :
     node outils/apropos-boostprice.js --essai
     node outils/apropos-boostprice.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'dynamic-pricing.html');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

if (!fs.existsSync(CIBLE)) {
  console.error('\n  \u2717 public/dynamic-pricing.html introuvable. Lancez depuis la racine.\n');
  process.exit(1);
}

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('apropos-comparables') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

const edits = [];

/* ── 1. Le texte : chiffre reel, trois facteurs, pas de concurrents ── */
edits.push([
  'texte A propos',
  `        <p style="font-size:13px;color:var(--text);line-height:1.7;margin-bottom:12px;">
          Boostinghost analyse chaque semaine les prix et la disponibilité de <strong>50 à 200 logements similaires</strong> dans votre zone. L'algorithme combine 4 signaux : taux d'occupation du marché, prix médian, votre propre occupation et la saisonnalité.
        </p>
        <p style="font-size:13px;color:var(--text);line-height:1.7;margin-bottom:12px;">
          <strong>Coût additionnel : 0€.</strong> La collecte de données est incluse dans votre abonnement Boostinghost. C'est l'équivalent de PriceLabs (49€/mois) ou Wheelhouse (39€/mois), intégré nativement.
        </p>`,
  `        <p style="font-size:13px;color:var(--text);line-height:1.7;margin-bottom:12px;">
          Chaque semaine, Boostinghost relève les prix et la disponibilité des logements
          comparables dans un rayon de 1,5 km autour du vôtre
          <span id="apropos-comparables"></span>.
        </p>
        <p style="font-size:13px;color:var(--text);line-height:1.7;margin-bottom:12px;">
          Le calcul part du <strong>prix médian du marché</strong>, puis lui applique trois
          facteurs : l'occupation du marché, votre propre occupation sur les trente jours à
          venir, et la saisonnalité. Vos événements déclarés s'ajoutent ensuite, s'il y en a.
        </p>
        <p style="font-size:13px;color:var(--text);line-height:1.7;margin-bottom:12px;">
          <strong>Inclus dans votre abonnement</strong>, sans surcoût.
        </p>`
]);

/* ── 2. Le nombre reel, injecte depuis les donnees du dashboard ────── */
edits.push([
  'injection du nombre de comparables',
  `async function loadNotifPrefs() {`,
  `/* Le nombre de comparables vient des donnees deja chargees : annoncer une
   fourchette generique que les cartes dementent ruine la confiance. Sans
   donnees marche, on n'annonce rien plutot qu'un ordre de grandeur invente. */
function majComparables() {
  const el = $('apropos-comparables');
  if (!el) return;
  const props = (state.dashboard && state.dashboard.properties) || [];
  const nombres = props.map(p => p.market && p.market.comparableCount)
                       .filter(n => typeof n === 'number' && n > 0);
  if (!nombres.length) { el.textContent = ''; return; }

  const min = Math.min(...nombres), max = Math.max(...nombres);
  el.textContent = min === max
    ? \` — \${min} logements comparables relevés lors de la dernière analyse\`
    : \` — de \${min} à \${max} logements comparables selon le logement, lors de la dernière analyse\`;
}

async function loadNotifPrefs() {
  majComparables();`
]);

for (const [nom, ancien] of edits) {
  const n = src.split(ancien).length - 1;
  if (n !== 1) {
    console.error('\n  \u2717 ' + nom + ' : ' + n + ' occurrence(s), 1 attendue.');
    console.error('    Le fichier a change. Rien n\'a ete ecrit.\n');
    process.exit(1);
  }
}
for (const [, ancien, nouveau] of edits) src = src.split(ancien).join(nouveau);

if (!ESSAI) fs.writeFileSync(CIBLE, src, 'utf8');

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  Nombre de comparables : reel, lu dans les donnees du dashboard.');
console.log('  Tarifs des concurrents : retires.');
console.log('  « 4 signaux » : corrige en une base et trois facteurs.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
