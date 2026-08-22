#!/usr/bin/env node
/* ============================================================
   outils/pause-boostprice.js
   Le bouton « Tout mettre en pause », en haut de la page
   ============================================================
   Cible : public/dynamic-pricing.html
   Prerequis : routes/pricing-pause-routes.js monte dans server.js.

   ── OU LE POSER ──────────────────────────────────────────────────
   Juste sous le titre, avant les onglets. Pas dans les reglages :
   quelqu'un qui veut tout arreter est inquiet, et on ne fait pas
   chercher un frein. C'est aussi le seul endroit visible depuis les
   cinq onglets.

   ── CE QU'IL DIT ─────────────────────────────────────────────────
   En pause, le bandeau devient visible et permanent : personne ne doit
   se demander pourquoi ses prix ne bougent plus dans trois semaines. Il
   affiche depuis quand, et combien de logements sont concernes.

   Et il dit ce que la pause ne fait pas : les prix deja publies chez les
   plateformes restent en place. Une pause qui laisserait croire a un
   retour en arriere serait pire que pas de pause du tout.

   Usage :
     node outils/pause-boostprice.js --essai
     node outils/pause-boostprice.js
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

if (src.indexOf('bhPauseBandeau') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

const edits = [];

/* ── 1. Le bandeau, entre le titre et les onglets ─────────────────── */
edits.push([
  'bandeau de pause',
  `  <!-- ── Tabs ── -->
  <div class="pricing-tabs">`,
  `  <!-- ── Pause generale ──
       Place avant les onglets : visible depuis n'importe lequel d'entre eux. -->
  <div id="bhPauseBandeau" style="display:none;margin-bottom:16px;"></div>

  <!-- ── Tabs ── -->
  <div class="pricing-tabs">`
]);

/* ── 2. Le style ──────────────────────────────────────────────────── */
edits.push([
  'style du bandeau',
  `.summary-stat .lbl { font-size: 11px; color: var(--muted); margin-top: 2px; }`,
  `.summary-stat .lbl { font-size: 11px; color: var(--muted); margin-top: 2px; }

/* Bandeau de pause generale. Discret quand tout tourne, franc quand c'est
   arrete : personne ne doit chercher pourquoi ses prix ne bougent plus. */
.pause-bar {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  border-radius: 12px; padding: 12px 16px; font-size: 13px;
}
.pause-bar.repos { background: #fff; border: 1px solid var(--border); color: var(--muted); }
.pause-bar.arret { background: #FBF6E9; border: 1px solid #E5C98F; color: #916018; }
.pause-bar .pause-txt { flex: 1; min-width: 180px; line-height: 1.5; }
.pause-bar .pause-txt strong { font-weight: 700; }
.pause-bar button {
  border: 1px solid var(--border); background: #fff; color: var(--ink);
  font-family: inherit; font-size: 12.5px; font-weight: 600;
  padding: 8px 14px; border-radius: 9px; cursor: pointer; white-space: nowrap;
}
.pause-bar.arret button { border-color: #E5C98F; color: #916018; }
.pause-bar button:disabled { opacity: .5; cursor: default; }`
]);

/* ── 3. La logique ────────────────────────────────────────────────── */
edits.push([
  'logique de pause',
  `/* Les deux panneaux qui composent l'onglet « Reglages ». */`,
  `/* ── Pause generale ─────────────────────────────────────────────────
   Un seul levier : is_active dans pricing_config, sur lequel filtrent le
   cron, le recalcul declenche, le dashboard et l'email hebdomadaire. */
async function loadPauseEtat() {
  const hote = $('bhPauseBandeau');
  if (!hote) return;
  try {
    const r = await fetch(\`\${API_BASE}\${DP}/pause\`);
    if (!r.ok) throw new Error('indisponible');
    const d = await r.json();

    // Aucun logement configure : rien a mettre en pause, rien a afficher.
    if (!d.total) { hote.style.display = 'none'; return; }

    hote.style.display = 'block';
    if (d.en_pause) {
      const depuis = d.depuis ? new Date(d.depuis).toLocaleDateString('fr-FR',
        { day: 'numeric', month: 'long' }) : null;
      hote.innerHTML = \`
        <div class="pause-bar arret">
          <i class="fas fa-circle-pause" style="font-size:16px;"></i>
          <div class="pause-txt">
            <strong>BoostPrice est en pause\${depuis ? ' depuis le ' + depuis : ''}.</strong>
            Aucun prix ne sera plus ajusté sur vos \${d.logements_en_pause} logement\${d.logements_en_pause > 1 ? 's' : ''}.
            Les prix déjà publiés chez les plateformes restent en place.
          </div>
          <button onclick="basculerPause(false, this)">Reprendre</button>
        </div>\`;
    } else {
      hote.innerHTML = \`
        <div class="pause-bar repos">
          <i class="fas fa-circle-play" style="font-size:14px;color:var(--pg);"></i>
          <div class="pause-txt">Ajustement actif sur \${d.actifs} logement\${d.actifs > 1 ? 's' : ''}.</div>
          <button onclick="basculerPause(true, this)">Tout mettre en pause</button>
        </div>\`;
    }
  } catch (e) {
    // Route absente : on n'affiche pas un frein qui ne freine rien.
    hote.style.display = 'none';
  }
}

async function basculerPause(pause, btn) {
  if (pause && !confirm('Mettre BoostPrice en pause sur tous vos logements ?\\n\\n'
    + 'Plus aucun prix ne sera ajusté. Les prix déjà publiés chez les plateformes '
    + 'restent en place. Vous pourrez reprendre à tout moment : chaque logement '
    + 'retrouvera exactement son réglage actuel.')) return;

  btn.disabled = true;
  btn.textContent = pause ? 'Mise en pause…' : 'Reprise…';
  try {
    const r = await fetch(\`\${API_BASE}\${DP}/pause\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused: pause })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Opération impossible');

    showToast(pause
      ? 'BoostPrice en pause sur ' + d.logements + ' logement' + (d.logements > 1 ? 's' : '')
      : 'BoostPrice a repris — chaque logement a retrouvé son réglage', 'success');

    await loadPauseEtat();
    loadDashboard();
  } catch (e) {
    showToast(e.message, 'error');
    await loadPauseEtat();
  }
}

/* Les deux panneaux qui composent l'onglet « Reglages ». */`
]);

/* ── 4. Charger l'etat a l'arrivee sur la page ─────────────────────── */
edits.push([
  'appel initial',
  `  if (name === 'dashboard') loadDashboard();`,
  `  if (name === 'dashboard') { loadDashboard(); loadPauseEtat(); }`
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

/* Premier chargement de la page : le dashboard est deja actif, switchTab
   n'est pas appele. On accroche l'etat de pause au demarrage existant. */
const DEMARRAGE = src.match(/loadDashboard\(\);\s*\n(\s*)\/\/|document\.addEventListener\('DOMContentLoaded'/);
if (!/loadPauseEtat\(\);[\s\S]{0,400}DOMContentLoaded|DOMContentLoaded[\s\S]{0,400}loadPauseEtat/.test(src)) {
  src += '\n<script>document.addEventListener(\'DOMContentLoaded\', function () {\n'
       + '  // Premier affichage : le dashboard est actif sans passer par switchTab.\n'
       + '  if (typeof loadPauseEtat === \'function\') setTimeout(loadPauseEtat, 300);\n'
       + '});</script>\n';
}

if (!ESSAI) fs.writeFileSync(CIBLE, src, 'utf8');

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  Bandeau de pause sous le titre, visible depuis tous les onglets.');
console.log('  La reprise restitue l\'etat exact de chaque logement.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
