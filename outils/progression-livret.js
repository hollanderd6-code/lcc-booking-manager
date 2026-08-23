#!/usr/bin/env node
/* ============================================================
   outils/progression-livret.js
   Une progression qui mesure le remplissage, pas la navigation
   ============================================================
   Cible : public/welcome.html

   ── CE QUE MESURAIT LA BARRE ─────────────────────────────────────
       const pct = Math.round(((index) / (total - 1)) * 100);

   Le pourcentage ne depend que de l'etape affichee. Arriver a l'etape 5
   sans avoir rien saisi affiche 100 %. Cliquer « Suivant » quatre fois
   « termine » le formulaire. La barre mesure les clics, pas le travail.

   ── CE QUE LA PAGE NE DIT PAS, ET DEVRAIT ────────────────────────
   Sur la cinquantaine de champs, six seulement sont obligatoires, tous
   dans les etapes 1 et 2. Les etapes 3, 4 et 5 sont entierement
   facultatives : le livret peut etre publie sans elles et enrichi plus
   tard.

   Personne ne le sait. L'utilisateur qui ouvre l'etape 3 et voit vingt
   champs vides croit devoir tout remplir avant de pouvoir publier. C'est
   la l'information qui manque — plus que le nombre de champs restants.

   ── CE QUI EST FAIT ──────────────────────────────────────────────
   1. La barre suit les champs obligatoires reellement remplis, et
      l'etiquette devient « 4 champs obligatoires sur 6 ». A 6 sur 6,
      elle passe au vert et annonce que le livret peut etre publie.
   2. Les etapes sans aucun champ obligatoire portent la mention
      « optionnel » dans le fil des etapes. Elle est calculee depuis le
      formulaire, pas ecrite en dur : ajouter un champ obligatoire a
      l'etape 4 la fera disparaitre d'elle-meme.
   3. « Etape 3 / 5 » reste affiche : savoir ou l'on est garde son
      utilite, ce n'est simplement pas une mesure d'avancement.

   Usage :
     node outils/progression-livret.js --essai
     node outils/progression-livret.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'welcome.html');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

if (!fs.existsSync(CIBLE)) {
  console.error('\n  \u2717 public/welcome.html introuvable. Lancez depuis la racine.\n');
  process.exit(1);
}

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('bhEtatObligatoires') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

const edits = [];

/* ── 1. La barre suit le remplissage ──────────────────────────────── */
edits.push([
  'calcul de la progression',
  `function updateProgressBar(index) {
  const total = 5;
  const pct = Math.round(((index) / (total - 1)) * 100);
  const bar = document.getElementById('wizProgressBar');
  const label = document.getElementById('wizProgressLabel');
  if (bar) bar.style.width = pct + '%';
  if (label) label.textContent = 'Étape ' + (index + 1) + ' / ' + total;
  const pctEl = document.getElementById('wizProgressPct');
  if (pctEl) pctEl.textContent = pct + '%';
}`,
  `/* Les champs obligatoires du formulaire entier : ceux marques [required], plus
   la photo de couverture, qui est un champ fichier controle a part. */
function bhEtatObligatoires() {
  const form = document.getElementById('welcomeForm');
  if (!form) return { remplis: 0, total: 0 };

  const champs = Array.from(form.querySelectorAll('[required]'));
  let remplis = champs.filter(f => (f.value || '').trim()).length;
  let total = champs.length;

  const cover = document.getElementById('coverPhoto');
  if (cover) {
    total += 1;
    const apercu = document.getElementById('coverPhotoPreview');
    if ((cover.files && cover.files.length) || (apercu && apercu.querySelector('img'))) remplis += 1;
  }
  return { remplis, total };
}

/* Une etape sans champ obligatoire peut etre passee : le livret se publie
   sans elle. Calcule depuis le formulaire — ajouter un champ obligatoire a
   une etape la retire de la liste sans toucher a ce code. */
function bhMarquerEtapesOptionnelles() {
  const sections = getSections();
  document.querySelectorAll('.wizard-step').forEach((etape, i) => {
    const section = sections[i];
    if (!section) return;
    const aDesObligatoires = section.querySelector('[required]') || section.querySelector('#coverPhoto');
    let tag = etape.querySelector('.wiz-optionnel');
    if (aDesObligatoires) { if (tag) tag.remove(); return; }
    if (!tag) {
      tag = document.createElement('span');
      tag.className = 'wiz-optionnel';
      tag.textContent = 'optionnel';
      tag.style.cssText = 'font-size:9.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;'
        + 'color:#9CA3AF;background:rgba(32,34,31,.06);padding:2px 6px;border-radius:5px;margin-left:2px;';
      etape.appendChild(tag);
    }
  });
}

function updateProgressBar(index) {
  const total = 5;
  const label = document.getElementById('wizProgressLabel');
  if (label) label.textContent = 'Étape ' + (index + 1) + ' / ' + total;

  /* La barre mesure les champs obligatoires remplis. L'ancien calcul ne
     dependait que de l'etape affichee : quatre clics sur « Suivant »
     annonçaient 100 % sur un formulaire vide. */
  const { remplis, total: obligatoires } = bhEtatObligatoires();
  const pct = obligatoires ? Math.round((remplis / obligatoires) * 100) : 100;

  const bar = document.getElementById('wizProgressBar');
  if (bar) {
    bar.style.width = pct + '%';
    bar.style.background = pct === 100
      ? 'linear-gradient(90deg,#0E3B2E,#3FA37A)'
      : 'linear-gradient(90deg,#0E3B2E,#1E6E52)';
  }

  const pctEl = document.getElementById('wizProgressPct');
  if (pctEl) {
    if (pct === 100) {
      pctEl.innerHTML = '<i class="fas fa-check" style="font-size:10px;"></i> Prêt à publier';
      pctEl.style.color = '#0E3B2E';
      pctEl.style.fontWeight = '600';
    } else {
      pctEl.textContent = remplis + ' champ' + (remplis > 1 ? 's' : '') + ' obligatoire'
        + (remplis > 1 ? 's' : '') + ' sur ' + obligatoires;
      pctEl.style.color = '#9CA3AF';
      pctEl.style.fontWeight = '400';
    }
  }

  bhMarquerEtapesOptionnelles();
}`
]);

/* ── 2. Suivre la saisie, pas seulement les changements d'etape ───── */
edits.push([
  'mise a jour a la saisie',
  `  bhPoserIndicateurs();
  form.addEventListener('input',  () => bhAutoSave.marquerSale());
  form.addEventListener('change', () => bhAutoSave.marquerSale());`,
  `  bhPoserIndicateurs();
  bhMarquerEtapesOptionnelles();
  form.addEventListener('input',  () => { bhAutoSave.marquerSale(); updateProgressBar(currentSectionIndex); });
  form.addEventListener('change', () => { bhAutoSave.marquerSale(); updateProgressBar(currentSectionIndex); });`
]);

for (const [nom, ancien] of edits) {
  const n = src.split(ancien).length - 1;
  if (n !== 1) {
    console.error('\n  \u2717 ' + nom + ' : ' + n + ' occurrence(s), 1 attendue.');
    if (nom.indexOf('saisie') !== -1) {
      console.error('    Appliquez d\'abord outils/sauvegarde-auto-livret.js.');
    }
    console.error('    Rien n\'a ete ecrit.\n');
    process.exit(1);
  }
}
for (const [, ancien, nouveau] of edits) src = src.split(ancien).join(nouveau);

if (!ESSAI) fs.writeFileSync(CIBLE, src, 'utf8');

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  La barre suit les champs obligatoires remplis, pas les clics.');
console.log('  Les etapes 3, 4 et 5 portent la mention « optionnel ».\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
