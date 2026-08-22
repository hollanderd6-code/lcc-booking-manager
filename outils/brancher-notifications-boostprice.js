#!/usr/bin/env node
/* ============================================================
   outils/brancher-notifications-boostprice.js
   Les trois interrupteurs de l'onglet Parametres, branches
   ============================================================
   Cible : public/dynamic-pricing.html
   Prerequis : routes/pricing-notifications-routes.js monte dans server.js.

   ── CE QUI EXISTAIT ──────────────────────────────────────────────
       function saveSettings() {
         showToast('Preferences enregistrees', 'success');
         // TODO : appeler POST /api/dynamic-pricing/config ...
       }

   Trois interrupteurs coches en dur dans le HTML, un message de
   confirmation, et rien d'envoye. L'utilisateur croyait avoir regle ses
   notifications ; le cron hebdomadaire, lui, lisait notify_email en base
   sans jamais recevoir ce qu'il avait choisi.

   ── CE QUI EST MIS EN PLACE ──────────────────────────────────────
   1. L'etat reel est lu a l'ouverture de l'onglet. Les interrupteurs
      refletent la base, au lieu d'etre coches par principe.
   2. Chaque bascule envoie un PATCH et attend la reponse. L'interrupteur
      revient a sa position d'origine si l'enregistrement echoue : un
      interrupteur qui reste en place est une promesse.
   3. Sans aucun logement configure, ils sont desactives avec la raison
      affichee. Mieux vaut un reglage indisponible qu'un reglage qui ment.
   4. Une valeur differente selon les logements (heritage de l'ancien
      modele par logement) est signalee, pas masquee.

   Usage :
     node outils/brancher-notifications-boostprice.js --essai
     node outils/brancher-notifications-boostprice.js
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

if (src.indexOf('loadNotifPrefs') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

const edits = [];

/* ── 1. Les trois interrupteurs recoivent une identite ────────────── */
edits.push([
  'interrupteur push',
  `          <label class="toggle-switch">
            <input type="checkbox" checked onchange="saveSettings()">
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="setting-row">
          <div>
            <div class="setting-label">Email récapitulatif hebdomadaire</div>`,
  `          <label class="toggle-switch">
            <input type="checkbox" id="notifPush" onchange="saveNotifPref('notifyPush', this)">
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="setting-row">
          <div>
            <div class="setting-label">Email récapitulatif hebdomadaire</div>`
]);

edits.push([
  'interrupteur email',
  `          <label class="toggle-switch">
            <input type="checkbox" checked onchange="saveSettings()">
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="setting-row">
          <div>
            <div class="setting-label">Alerte si écart marché > 20%</div>`,
  `          <label class="toggle-switch">
            <input type="checkbox" id="notifEmail" onchange="saveNotifPref('notifyEmail', this)">
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="setting-row">
          <div>
            <div class="setting-label">Alerte si écart marché > 20%</div>`
]);

edits.push([
  'interrupteur alerte',
  `          <label class="toggle-switch">
            <input type="checkbox" checked onchange="saveSettings()">
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
    </div>`,
  `          <label class="toggle-switch">
            <input type="checkbox" id="notifAlert" onchange="saveNotifPref('notifyAlert', this)">
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div id="notif-etat" style="padding:10px 20px;font-size:12px;color:var(--muted);"></div>
      </div>
    </div>`
]);

/* ── 2. L'onglet charge l'etat reel ───────────────────────────────── */
edits.push([
  'chargement a l\'ouverture',
  `  if (name === 'config') loadConfig();`,
  `  if (name === 'config') loadConfig();
  if (name === 'settings') loadNotifPrefs();`
]);

/* ── 3. La lecture et l'ecriture ──────────────────────────────────── */
edits.push([
  'remplacement de saveSettings',
  `function saveSettings() {
  showToast('Préférences enregistrées ✓', 'success');
  // TODO : appeler POST /api/dynamic-pricing/config avec les bons flags notifyPush/notifyEmail/notifyAlert
}`,
  `/* Les preferences vivent dans pricing_config, une ligne par logement, mais
   ce sont des preferences personnelles : elles s'appliquent a tout le parc.
   La route dediee ne touche que les trois colonnes concernees — passer par
   POST /config aurait exige priceMin/priceMax et ecrase les fourchettes. */
const NOTIF_CHAMPS = { notifyPush: 'notifPush', notifyEmail: 'notifEmail', notifyAlert: 'notifAlert' };

async function loadNotifPrefs() {
  const etat = $('notif-etat');
  try {
    const r = await fetch(\`\${API_BASE}\${DP}/notifications\`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();

    Object.keys(NOTIF_CHAMPS).forEach(cle => {
      const el = $(NOTIF_CHAMPS[cle]);
      if (!el) return;
      el.checked  = !!d[cle];
      el.disabled = d.logements === 0;
      el.dataset.avant = el.checked ? '1' : '0';
    });

    /* Sans logement configure, il n'existe aucune ligne ou ecrire. On le dit
       et on desactive, plutot que de laisser croire que le reglage tient. */
    if (etat) {
      if (d.logements === 0) {
        etat.textContent = 'Activez le pricing dynamique sur au moins un logement pour régler vos notifications.';
      } else {
        const melanges = Object.keys(NOTIF_CHAMPS).filter(c => d.heterogene && d.heterogene[c]);
        etat.textContent = melanges.length
          ? 'Certains logements avaient un réglage différent : basculer un interrupteur alignera tout le parc.'
          : 'Ces préférences s\\'appliquent à vos ' + d.logements + ' logement' + (d.logements > 1 ? 's' : '') + '.';
      }
    }
  } catch (e) {
    /* La route n'est pas montee : on desactive au lieu d'afficher trois
       interrupteurs qui ne menent nulle part. */
    Object.values(NOTIF_CHAMPS).forEach(id => { const el = $(id); if (el) el.disabled = true; });
    if (etat) etat.textContent = 'Préférences indisponibles pour le moment.';
  }
}

async function saveNotifPref(cle, el) {
  const avant = el.dataset.avant === '1';
  el.disabled = true;
  try {
    const r = await fetch(\`\${API_BASE}\${DP}/notifications\`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: cle, value: el.checked })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Enregistrement impossible');

    el.dataset.avant = el.checked ? '1' : '0';
    showToast(el.checked ? 'Notification activée ✓' : 'Notification désactivée', 'success');
  } catch (e) {
    // Un interrupteur qui reste en place est une promesse : on le remet.
    el.checked = avant;
    showToast(e.message, 'error');
  } finally {
    el.disabled = false;
  }
}`
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
console.log('  Les trois interrupteurs lisent et ecrivent reellement.');
console.log('  Ils se desactivent si aucun logement n\'est configure.\n');
console.log('  N\'OUBLIEZ PAS le montage dans server.js :');
console.log('    require(\'./routes/pricing-notifications-routes\')(app, pool,');
console.log('      { authenticateAny, getRealUserId });\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
