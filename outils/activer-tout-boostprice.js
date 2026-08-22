#!/usr/bin/env node
/* ============================================================
   outils/activer-tout-boostprice.js
   Activer ou desactiver tous les logements d'un coup
   ============================================================
   Cible : public/dynamic-pricing.html

   ── LE BESOIN ────────────────────────────────────────────────────
   L'onglet Reglages affiche une carte par logement, chacune avec son
   interrupteur. Avec vingt-quatre logements, la premiere mise en route
   demande vingt-quatre gestes identiques.

   ── LA DIFFICULTE, ET CE QU'ELLE IMPOSE ──────────────────────────
   Activer un logement exige une fourchette de prix. Un logement jamais
   configure affiche 40–200 € : ce sont les valeurs par defaut du
   formulaire, pas un choix. Les envoyer en masse publierait des prix
   arbitraires sur de vraies annonces.

   Le bouton distingue donc deux populations :

     — les logements dont la fourchette est ENREGISTREE en base : ils
       s'activent, avec leurs propres valeurs ;
     — les autres : ils sont laisses de cote, et le bouton dit combien
       il en reste a regler. Ils gardent leur carte, ou une fourchette
       se saisit en deux champs.

   La desactivation, elle, n'a aucune condition : elle est toujours sure.

   ── POURQUOI PAS LA PAUSE GENERALE ───────────────────────────────
   Le bandeau de pause arrete tout temporairement et memorise l'etat
   pour le restituer. Ici on modifie l'etat voulu, durablement. Deux
   gestes differents, deux endroits differents.

   Usage :
     node outils/activer-tout-boostprice.js --essai
     node outils/activer-tout-boostprice.js
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

if (src.indexOf('basculerTousLesLogements') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

const edits = [];

/* ── 1. Savoir si la fourchette vient de la base ou du formulaire ─── */
edits.push([
  'marquage des configs existantes',
  `        strategy: cfg?.strategy ?? 50,
        mode: cfg?.mode ?? 'manual',
      };
    });`,
  `        strategy: cfg?.strategy ?? 50,
        mode: cfg?.mode ?? 'manual',
        /* 40–200 sont les valeurs par defaut du formulaire, pas un choix de
           l'utilisateur. Sans cette distinction, une activation en masse
           publierait des prix arbitraires sur de vraies annonces. */
        fourchetteEnregistree: !!cfg,
      };
    });`
]);

/* ── 2. La barre d'action, en tete de liste ───────────────────────── */
edits.push([
  'barre d\'action',
  `      $('config-cards').innerHTML = merged.map((c, i) => renderConfigCard(c, i)).join('');
    }`,
  `      $('config-cards').innerHTML = barreToutActiver(merged)
        + merged.map((c, i) => renderConfigCard(c, i)).join('');
    }`
]);

/* ── 3. La barre et la bascule ────────────────────────────────────── */
edits.push([
  'logique de bascule groupee',
  `function renderConfigCard(cfg, idx) {`,
  `/* En-tete de la liste : l'etat du parc, et le geste inverse de cet etat. */
function barreToutActiver(configs) {
  const actifs = configs.filter(c => c.isActive).length;
  const total  = configs.length;
  if (total < 2) return '';   // un seul logement : son interrupteur suffit

  const activables = configs.filter(c => !c.isActive && c.fourchetteEnregistree).length;
  const aRegler    = configs.filter(c => !c.isActive && !c.fourchetteEnregistree).length;
  const toutActif  = actifs === total;

  let bouton, note = '';
  if (toutActif) {
    bouton = \`<button class="tout-btn" onclick="basculerTousLesLogements(false, this)">
                <i class="fas fa-power-off"></i> Tout désactiver</button>\`;
  } else if (activables) {
    bouton = \`<button class="tout-btn primaire" onclick="basculerTousLesLogements(true, this)">
                <i class="fas fa-bolt"></i> Activer les \${activables} logement\${activables > 1 ? 's' : ''} déjà réglé\${activables > 1 ? 's' : ''}</button>\`;
    if (aRegler) note = \`\${aRegler} logement\${aRegler > 1 ? 's' : ''} sans fourchette de prix enregistrée \${aRegler > 1 ? 'restent' : 'reste'} à régler ci-dessous.\`;
  } else {
    note = aRegler
      ? \`Renseignez une fourchette de prix sur un logement pour pouvoir activer le reste en une fois.\`
      : '';
    bouton = actifs ? \`<button class="tout-btn" onclick="basculerTousLesLogements(false, this)">
                <i class="fas fa-power-off"></i> Tout désactiver</button>\` : '';
  }

  return \`
    <div class="tout-bar">
      <div class="tout-txt">
        <strong>\${actifs} logement\${actifs > 1 ? 's' : ''} sur \${total}</strong> avec le pricing actif.
        \${note ? '<span class="tout-note">' + note + '</span>' : ''}
      </div>
      \${bouton}
    </div>\`;
}

async function basculerTousLesLogements(activer, btn) {
  const cibles = activer
    ? state.configs.filter(c => !c.isActive && c.fourchetteEnregistree)
    : state.configs.filter(c => c.isActive);

  if (!cibles.length) return;

  const question = activer
    ? \`Activer le pricing dynamique sur \${cibles.length} logement\${cibles.length > 1 ? 's' : ''} ?\\n\\n\`
      + 'Chacun gardera sa propre fourchette de prix. Les suggestions apparaîtront '
      + 'au dashboard : rien n\\'est publié sans votre accord en mode manuel.'
    : \`Désactiver le pricing sur \${cibles.length} logement\${cibles.length > 1 ? 's' : ''} ?\\n\\n\`
      + 'Les prix déjà publiés chez les plateformes restent en place.';
  if (!confirm(question)) return;

  const libelle = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = activer ? 'Activation…' : 'Désactivation…';

  /* Un appel par logement — la route /config travaille logement par logement.
     En serie plutot qu'en parallele : vingt-quatre ecritures simultanees sur
     la meme table, pour un geste qui n'est pas urgent, ne se justifie pas. */
  let faits = 0;
  const echecs = [];
  for (const c of cibles) {
    try {
      const r = await fetch(\`\${API_BASE}\${DP}/config\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: c.propertyId,
          priceMin: c.priceMin,
          priceMax: c.priceMax,
          mode: c.mode || 'manual',
          strategy: c.strategy ?? 50,
          isActive: activer
        })
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      c.isActive = activer;
      faits++;
    } catch (e) {
      echecs.push(c.propertyName);
    }
  }

  btn.disabled = false;
  btn.innerHTML = libelle;

  if (echecs.length) {
    showToast(\`\${faits} logement\${faits > 1 ? 's' : ''} traité\${faits > 1 ? 's' : ''}, \${echecs.length} en échec : \${echecs.slice(0, 3).join(', ')}\`, 'error');
  } else {
    showToast(activer
      ? \`Pricing activé sur \${faits} logement\${faits > 1 ? 's' : ''}\`
      : \`Pricing désactivé sur \${faits} logement\${faits > 1 ? 's' : ''}\`, 'success');
  }

  await loadConfig();
  if (activer && faits) loadDashboard();
  if (typeof loadPauseEtat === 'function') loadPauseEtat();
}

function renderConfigCard(cfg, idx) {`
]);

/* ── 4. Le style ──────────────────────────────────────────────────── */
edits.push([
  'style de la barre',
  `.summary-stat .lbl { font-size: 11px; color: var(--muted); margin-top: 2px; }`,
  `.summary-stat .lbl { font-size: 11px; color: var(--muted); margin-top: 2px; }

/* Barre d'action groupee, en tete de la liste des logements. */
.tout-bar {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  background: #F7F6F1; border: 1px solid var(--border); border-radius: 12px;
  padding: 13px 16px; margin-bottom: 14px; font-size: 13px;
}
.tout-txt { flex: 1; min-width: 190px; line-height: 1.5; color: var(--muted); }
.tout-txt strong { color: var(--ink); font-weight: 700; }
.tout-note { display: block; font-size: 12px; margin-top: 3px; }
.tout-btn {
  border: 1px solid var(--border); background: #fff; color: var(--ink);
  font-family: inherit; font-size: 12.5px; font-weight: 600;
  padding: 9px 15px; border-radius: 9px; cursor: pointer; white-space: nowrap;
  display: inline-flex; align-items: center; gap: 7px;
}
.tout-btn.primaire { background: var(--pg); border-color: var(--pg); color: #fff; }
.tout-btn:disabled { opacity: .55; cursor: default; }
.tout-btn i { font-size: 11px; }`
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
console.log('  Barre d\'action en tete de la liste des logements.');
console.log('  N\'active que ceux dont la fourchette de prix est enregistree.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
