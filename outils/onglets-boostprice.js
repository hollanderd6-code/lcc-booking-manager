#!/usr/bin/env node
/* ============================================================
   outils/onglets-boostprice.js
   Cinq onglets au lieu de six, et le calendrier en deuxieme
   ============================================================
   Cible : public/dynamic-pricing.html
   Prerequis : outils/brancher-notifications-boostprice.js applique.

   ── CE QUI N'ALLAIT PAS ──────────────────────────────────────────
   Six onglets, dont deux qui disent la meme chose : « Configuration »
   (activation, prix min/max, mode, zone d'analyse) et « Parametres »
   (notifications, saisonnalite, a propos). Rien ne permet de deviner
   lequel contient quoi ; on ouvre les deux.

   Et « Calendrier » — la vue la plus consultee au quotidien, celle qui
   montre les prix jour par jour — arrivait en cinquieme position,
   derriere trois ecrans de reglages qu'on ne visite qu'une fois.

   ── CE QUI EST FAIT ──────────────────────────────────────────────
   1. Ordre : Dashboard, Calendrier, Reglages, Historique, Evenements.
      Le quotidien d'abord, les reglages au milieu, l'archive apres.
   2. « Configuration » et « Parametres » fusionnent sous « Reglages ».
      Les deux panneaux s'affichent a la suite : les reglages par
      logement d'abord, les preferences globales ensuite. Aucun bloc de
      HTML n'est deplace — c'est l'affichage qui les reunit, ce qui
      evite de casser les identifiants auxquels le JavaScript s'accroche.
   3. switchTab('settings') et switchTab('config') menent au meme
      endroit : les appels existants ailleurs dans la page continuent
      de fonctionner.

   Usage :
     node outils/onglets-boostprice.js --essai
     node outils/onglets-boostprice.js
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

if (src.indexOf('PANNEAUX_REGLAGES') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

if (src.indexOf('loadNotifPrefs') === -1) {
  console.error('\n  \u2717 Appliquez d\'abord outils/brancher-notifications-boostprice.js.\n');
  process.exit(1);
}

const edits = [];

/* ── 1. La barre d'onglets : nouvel ordre, un onglet en moins ─────── */
edits.push([
  'barre d\'onglets',
  `    <button class="ptab active" onclick="switchTab('dashboard')" id="tab-dashboard">
      <i class="fas fa-chart-line"></i> Dashboard
    </button>
    <button class="ptab" onclick="switchTab('config')" id="tab-config">
      <i class="fas fa-sliders-h"></i> Configuration
    </button>
    <button class="ptab" onclick="switchTab('history')" id="tab-history">
      <i class="fas fa-clock-rotate-left"></i> Historique
    </button>
    <button class="ptab" onclick="switchTab('settings')" id="tab-settings">
      <i class="fas fa-cog"></i> Paramètres
    </button>
    <button class="ptab" onclick="switchTab('calendar')" id="tab-calendar">
      <i class="fas fa-calendar-days"></i> Calendrier
    </button>
    <button class="ptab" onclick="switchTab('events')" id="tab-events">
      <i class="fas fa-bullhorn"></i> Événements
    </button>`,
  `    <button class="ptab active" onclick="switchTab('dashboard')" id="tab-dashboard">
      <i class="fas fa-chart-line"></i> Dashboard
    </button>
    <button class="ptab" onclick="switchTab('calendar')" id="tab-calendar">
      <i class="fas fa-calendar-days"></i> Calendrier
    </button>
    <button class="ptab" onclick="switchTab('config')" id="tab-config">
      <i class="fas fa-sliders-h"></i> Réglages
    </button>
    <button class="ptab" onclick="switchTab('history')" id="tab-history">
      <i class="fas fa-clock-rotate-left"></i> Historique
    </button>
    <button class="ptab" onclick="switchTab('events')" id="tab-events">
      <i class="fas fa-bullhorn"></i> Événements
    </button>`
]);

/* ── 2. Un titre avant les preferences globales ───────────────────── */
edits.push([
  'titre des preferences',
  `  <div class="tab-panel" id="panel-settings">
    <div class="pcard">
      <div class="pcard-header">
        <div class="pcard-title"><i class="fas fa-bell"></i> Notifications</div>
      </div>`,
  `  <div class="tab-panel" id="panel-settings">
    <!-- Affiche a la suite de panel-config, sous le meme onglet « Reglages » :
         les reglages par logement d'abord, les preferences globales ensuite. -->
    <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
                color:var(--muted);margin:24px 0 10px;">Préférences générales</div>
    <div class="pcard">
      <div class="pcard-header">
        <div class="pcard-title"><i class="fas fa-bell"></i> Notifications</div>
      </div>`
]);

/* ── 3. switchTab : les deux panneaux ensemble ────────────────────── */
edits.push([
  'switchTab',
  `  if (name === 'config') loadConfig();
  if (name === 'settings') loadNotifPrefs();`,
  `  /* « Reglages » reunit deux panneaux : ceux par logement (panel-config) et
     les preferences generales (panel-settings). On les affiche ensemble
     plutot que de deplacer le HTML — les identifiants restent intacts. */
  if (name === 'config' || name === 'settings') {
    PANNEAUX_REGLAGES.forEach(id => $(id)?.classList.add('active'));
    $('tab-config').classList.add('active');
    loadConfig();
    loadNotifPrefs();
  }`
]);

/* ── 4. La constante, et l'alias de l'ancien nom d'onglet ─────────── */
edits.push([
  'entete de switchTab',
  `function switchTab(name) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.ptab').forEach(b => b.classList.remove('active'));
  $('panel-' + name).classList.add('active');
  $('tab-' + name).classList.add('active');`,
  `/* Les deux panneaux qui composent l'onglet « Reglages ». */
const PANNEAUX_REGLAGES = ['panel-config', 'panel-settings'];

function switchTab(name) {
  // L'onglet Parametres a disparu ; les appels existants restent valides.
  if (name === 'settings') name = 'config';

  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.ptab').forEach(b => b.classList.remove('active'));
  $('panel-' + name)?.classList.add('active');
  $('tab-' + name)?.classList.add('active');`
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
console.log('  Onglets : Dashboard · Calendrier · Reglages · Historique · Evenements');
console.log('  Configuration et Parametres reunis sous « Reglages ».\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
