#!/usr/bin/env node
/* ============================================================
   outils/channex-blocage-rapide.js
   La meme certitude, en trois secondes au lieu de quarante
   ============================================================
   Cible : channex.js  (pushAvailability, apres channex-blocage-verifie)

   ── LE DEFAUT, ET IL EST DE MOI ──────────────────────────────────
   Le lot precedent attendait l'issue de CHAQUE tranche, l'une apres
   l'autre : cinq tranches, jusqu'a huit secondes chacune, plus la
   relecture. D'ou les quarante secondes au clic sur « Envoyer ».

   Cette attente ne servait a rien. Interroger GET /tasks/:id dit ce que
   Channex pense avoir fait ; relire /availability dit ce qu'il expose
   vraiment. La seconde preuve contient la premiere. Garder les deux,
   c'etait payer deux fois pour une seule information.

   ── CE QUE CE LOT CHANGE ─────────────────────────────────────────
   1. Les tranches partent EN PARALLELE (Promise.all) au lieu d'une par
      une. Cinq POST simultanes, pas cinq attentes bout a bout.

   2. L'attente des taches disparait. La fonction attendreTache est
      retiree : du code mort qui coute huit secondes n'est pas du code
      prudent.

   3. La relecture gagne deux essais de secours. Channex applique de
      facon asynchrone : si la premiere lecture arrive trop tot, on
      reessaie a 900 ms puis 1,8 s avant de conclure a l'echec. C'est
      ce qui remplace, en mieux, l'attente supprimee.

   Resultat attendu : environ trois secondes, meme garantie — une nuit
   declaree bloquee l'est vraiment, sinon l'erreur est levee.

   Usage :
     node outils/channex-blocage-rapide.js --essai
     node outils/channex-blocage-rapide.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'channex.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('channex.js introuvable. Lancez depuis la racine du projet.');

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('BLOCAGE_RAPIDE') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}
if (src.indexOf('BLOCAGE_VERIFIE') === -1) {
  echec('Le lot channex-blocage-verifie.js n\'est pas applique : rien a accelerer.');
}

function remplacer(avant, apres, quoi) {
  if (src.split(avant).length - 1 !== 1) {
    echec('\u00ab ' + quoi + ' \u00bb introuvable (ou present plusieurs fois) dans channex.js.');
  }
  src = src.split(avant).join(apres);
}

/* ── 1. Les tranches en parallele ────────────────────────────────── */

remplacer(
`    const taches = [];
    for (let i = 0; i < values.length; i += CHANNEX_TRANCHE) {
      const lot = values.slice(i, i + CHANNEX_TRANCHE);
      const rep = await channexAPI.post('/availability', { values: lot });
      const donnee = rep.data && rep.data.data;
      const id = Array.isArray(donnee) ? (donnee[0] && donnee[0].id) : (donnee && donnee.id);
      if (id) taches.push(id);
    }`,
`    /* BLOCAGE_RAPIDE — tranches simultanees. En serie, cinq tranches
       mettaient quarante secondes au clic sur « Envoyer ». */
    const lots = [];
    for (let i = 0; i < values.length; i += CHANNEX_TRANCHE) {
      lots.push(values.slice(i, i + CHANNEX_TRANCHE));
    }
    const taches = (await Promise.all(lots.map(function (lot) {
      return channexAPI.post('/availability', { values: lot }).then(function (rep) {
        const d = rep.data && rep.data.data;
        return Array.isArray(d) ? (d[0] && d[0].id) : (d && d.id);
      });
    }))).filter(Boolean);`,
  'la boucle d\'envoi des tranches'
);

/* ── 2. L'attente des taches, supprimee ──────────────────────────── */

remplacer(
`    /* On attend l'issue de chaque tache : « Success » a l'appel ne dit
       rien de son execution. */
    for (const t of taches) {
      const issue = await attendreTache(t);
      if (!issue.ok) {
        throw new Error('Channex a refuse la mise a jour (tache ' + t + ') : ' + issue.raison);
      }
    }
`,
`    /* Plus d'attente de tache : la relecture ci-dessous dit ce que
       Channex expose vraiment, ce qui vaut mieux que ce qu'il pense
       avoir fait — et coute huit secondes de moins par tranche. */
`,
  'l\'attente des taches'
);

/* ── 3. La relecture, avec deux essais de secours ─────────────────── */

remplacer(
`      const manquantes = await verifierBlocage(channex_property_id, channex_room_type_id, aVerifier);
      if (manquantes.length) {
        throw new Error('Channex expose encore ' + manquantes.length + ' nuit(s) en vente apres blocage : '
          + manquantes.slice(0, 6).join(', ') + (manquantes.length > 6 ? '\u2026' : ''));
      }`,
`      /* Channex applique en differe : si la premiere lecture arrive trop
         tot, on reessaie avant de crier a l'echec. */
      let manquantes = await verifierBlocage(channex_property_id, channex_room_type_id, aVerifier);
      for (let essai = 0; essai < 2 && manquantes.length; essai++) {
        await new Promise(r => setTimeout(r, 900 * (essai + 1)));
        manquantes = await verifierBlocage(channex_property_id, channex_room_type_id, aVerifier);
      }
      if (manquantes.length) {
        throw new Error('Channex expose encore ' + manquantes.length + ' nuit(s) en vente apres blocage : '
          + manquantes.slice(0, 6).join(', ') + (manquantes.length > 6 ? '\u2026' : ''));
      }`,
  'la relecture des nuits bloquees'
);

/* ── 4. Retrait de la fonction devenue morte ──────────────────────── */

const DEBUT_MORTE = 'async function attendreTache(taskId, essais = 12) {';
const FIN_MORTE = '  return { ok: true, indetermine: true };\n}\n';

const iDeb = src.indexOf(DEBUT_MORTE);
if (iDeb !== -1) {
  const iFin = src.indexOf(FIN_MORTE, iDeb);
  if (iFin === -1) echec('La fin de attendreTache est introuvable : je ne retire rien a l\'aveugle.');
  src = src.slice(0, iDeb)
      + '/* attendreTache a ete retiree : la relecture de /availability est une\n'
      + '   preuve plus forte, et huit secondes plus rapide par tranche. */\n'
      + src.slice(iFin + FIN_MORTE.length);
}

/* ── 5. Verifications ────────────────────────────────────────────── */

try { new Function(src.replace(/^#![^\n]*\n/, '')); }
catch (e) { echec('channex.js ne serait plus du JavaScript valide — ' + e.message); }

[
  ['les tranches simultanees', 'await Promise.all(lots.map('],
  ['la relecture conservee', 'async function verifierBlocage('],
  ['les essais de secours', "900 * (essai + 1)"],
  ['l\'erreur si une nuit reste en vente', 'Channex expose encore '],
].forEach(function (c) {
  if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent apres modification.');
});
if (src.indexOf('attendreTache(') !== -1) echec('Un appel a attendreTache subsiste.');

if (!ESSAI) {
  const sauvegarde = CIBLE + '.avant-blocage-rapide';
  if (!fs.existsSync(sauvegarde)) fs.writeFileSync(sauvegarde, fs.readFileSync(CIBLE));
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('BLOCAGE_RAPIDE') === -1) {
    echec("La correction n'est pas dans le fichier apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Tranches   : envoyees en parallele');
console.log('  Taches     : attente supprimee (et fonction morte retiree)');
console.log('  Relecture  : conservee, avec deux essais de secours (900 ms, 1,8 s)');
if (!ESSAI) console.log('  Sauvegarde : channex.js.avant-blocage-rapide (ne pas commiter)');
console.log('');
console.log('  A verifier : le clic sur « Envoyer » doit repasser sous cinq secondes,');
console.log('  et les logs afficher « Blocage relu et confirme » comme aujourd\'hui.');
console.log('  Si vous voyez « Channex expose encore … » sur un blocage qui marchait,');
console.log('  dites-le moi : il faudra alors rallonger les essais de secours.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
