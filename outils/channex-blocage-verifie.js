#!/usr/bin/env node
/* ============================================================
   outils/channex-blocage-verifie.js
   Ne plus jamais ecrire « bloque » sans l'avoir verifie
   ============================================================
   Cible : channex.js  (fonction pushAvailability)

   ── CE QUI EST PROUVE ────────────────────────────────────────────
   Le 30 aout a 16:40:01, un lien BHGuest a bloque la nuit du 15 janvier
   2027 sur M13. Le serveur a envoye 500 valeurs a Channex en un POST et
   journalise « ✅ Disponibilites poussees » puis « 🔒 Channex bloque ».
   L'API Channex, interrogee ensuite, repondait :

       {"e0464321-...":{"2027-01-15":1, ...}}     -> VENDABLE

   Le meme blocage envoye SEUL a pris effet immediatement. Et la reponse
   de Channex explique tout :

       {"data":[{"id":"2cea11d1-...","type":"task"}],"meta":{"Success"}}

   « task ». Le 200 veut dire MIS EN FILE, pas APPLIQUE. Un gros lot qui
   echoue en arriere-plan ne remonte nulle part — et la nuit reste en
   vente pendant que l'ecran affiche « bloque ». C'est ainsi qu'une resa
   Airbnb est tombee vingt minutes apres un lien de paiement.

   ── LES TROIS CORRECTIONS ────────────────────────────────────────
   1. TRANCHES. Les valeurs partent par paquets de 100 au lieu de 500 en
      un bloc. Plus lent, mais accepte.

   2. ATTENTE DU RESULTAT. Chaque POST renvoie un identifiant de tache :
      on interroge GET /tasks/:id jusqu'a son issue. Une tache en echec
      leve une erreur au lieu de passer pour un succes.

   3. RELECTURE. Avant de conclure, on relit les dates qui devaient etre
      bloquees. Si l'une est encore vendable, on leve une erreur. Le
      serveur ecrira alors « ⚠️ Channex non bloque », ce qui est la
      verite, et vous pourrez agir.

   Consequence a assumer : les blocages qui echouent deviendront visibles.
   Ce n'est pas une regression, c'est la fin d'un silence.

   ── CE QUE CE LOT NE FAIT PAS ────────────────────────────────────
   Il ne touche pas a server.js ni aux neuf appels existants : la
   signature de pushAvailability est inchangee. Il ne rejoue aucun
   blocage passe — les dates deja perdues doivent etre repoussees, ce que
   fait naturellement le prochain envoi sur chaque logement.

   Usage :
     node outils/channex-blocage-verifie.js --essai
     node outils/channex-blocage-verifie.js
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

if (src.indexOf('BLOCAGE_VERIFIE') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* ── 1. Les deux fonctions d'appui, posees avant pushAvailability ── */

const A_SIG = 'async function pushAvailability(pool, { property_id, channex_property_id, channex_room_type_id, dates_blocked = [], dates_to_update = null }) {';

const N_SIG = `/* BLOCAGE_VERIFIE ────────────────────────────────────────────────────
   Channex repond « task » : un 200 signifie mis en file, pas applique.
   Un lot de 500 valeurs peut donc echouer en silence — c'est ce qui a
   laisse la nuit du 15/01/2027 en vente malgre un hold actif. On attend
   desormais l'issue de chaque tache, et on relit avant de conclure. */
const CHANNEX_TRANCHE = 100;

async function attendreTache(taskId, essais = 12) {
  for (let i = 0; i < essais; i++) {
    await new Promise(r => setTimeout(r, 700));
    try {
      const r = await channexAPI.get('/tasks/' + taskId);
      const a = (r.data && r.data.data && (r.data.data.attributes || r.data.data)) || {};
      const st = String(a.status || a.state || '').toLowerCase();
      if (st === 'completed' || st === 'success' || st === 'applied') return { ok: true };
      if (st === 'failed' || st === 'error') {
        return { ok: false, raison: JSON.stringify(a.errors || a.error || a).slice(0, 300) };
      }
    } catch (e) {
      /* Endpoint indisponible : on n'invente pas d'echec, la relecture
         qui suit reste le juge. */
      return { ok: true, indetermine: true };
    }
  }
  return { ok: true, indetermine: true };
}

/* Relit ce que Channex expose vraiment, pour les dates qui devaient
   etre bloquees. Renvoie la liste de celles qui sont encore vendables. */
async function verifierBlocage(channex_property_id, channex_room_type_id, dates) {
  if (!dates.length) return [];
  const triees = [...dates].sort();
  const r = await channexAPI.get('/availability', {
    params: {
      'filter[property_id]': channex_property_id,
      'filter[date][gte]': triees[0],
      'filter[date][lte]': triees[triees.length - 1]
    }
  });
  const d = (r.data && r.data.data) || {};
  const parRt = d[channex_room_type_id] || d[Object.keys(d)[0]] || {};
  return triees.filter(j => Number(parRt[j]) !== 0);
}

${A_SIG}`;

if (src.split(A_SIG).length - 1 !== 1) echec('La signature de pushAvailability est introuvable (ou presente plusieurs fois).');
src = src.split(A_SIG).join(N_SIG);

/* ── 2. L'envoi : tranches, taches, relecture ────────────────────── */

const A_POST = `    await channexAPI.post('/availability', { values });`;

const N_POST = `    /* Envoi par tranches : un lot unique de 500 valeurs est accepte puis
       partiellement perdu, sans erreur. */
    const taches = [];
    for (let i = 0; i < values.length; i += CHANNEX_TRANCHE) {
      const lot = values.slice(i, i + CHANNEX_TRANCHE);
      const rep = await channexAPI.post('/availability', { values: lot });
      const donnee = rep.data && rep.data.data;
      const id = Array.isArray(donnee) ? (donnee[0] && donnee[0].id) : (donnee && donnee.id);
      if (id) taches.push(id);
    }

    /* On attend l'issue de chaque tache : « Success » a l'appel ne dit
       rien de son execution. */
    for (const t of taches) {
      const issue = await attendreTache(t);
      if (!issue.ok) {
        throw new Error('Channex a refuse la mise a jour (tache ' + t + ') : ' + issue.raison);
      }
    }

    /* Puis on relit. C'est la seule preuve : le reste est de la parole. */
    const aVerifier = values.filter(v => v.availability === 0).map(v => v.date);
    if (aVerifier.length) {
      const manquantes = await verifierBlocage(channex_property_id, channex_room_type_id, aVerifier);
      if (manquantes.length) {
        throw new Error('Channex expose encore ' + manquantes.length + ' nuit(s) en vente apres blocage : '
          + manquantes.slice(0, 6).join(', ') + (manquantes.length > 6 ? '\u2026' : ''));
      }
      console.log('\u2713 [CHANNEX] Blocage relu et confirme (' + aVerifier.length + ' nuits a 0)');
    }`;

if (src.split(A_POST).length - 1 !== 1) echec("L'appel POST /availability est introuvable (ou present plusieurs fois).");
src = src.split(A_POST).join(N_POST);

/* ── 3. Le message de succes, rendu honnete ──────────────────────── */

const A_OK = "console.log(`✅ [CHANNEX] Disponibilités poussées (${values.length} jours)`);";
const N_OK = "console.log(`✅ [CHANNEX] Disponibilités poussées ET verifiees (${values.length} jours, ${taches.length} tranche(s))`);";

if (src.split(A_OK).length - 1 !== 1) echec('Le message de succes est introuvable.');
src = src.split(A_OK).join(N_OK);

/* ── 4. Verifications ────────────────────────────────────────────── */

try { new Function(src.replace(/^#![^\n]*\n/, '')); }
catch (e) { echec('channex.js ne serait plus du JavaScript valide — ' + e.message); }

[
  ['les tranches', 'CHANNEX_TRANCHE = 100'],
  ['l\'attente des taches', 'async function attendreTache('],
  ['la relecture', 'async function verifierBlocage('],
  ['l\'envoi decoupe', 'values.slice(i, i + CHANNEX_TRANCHE)'],
  ['l\'erreur si une nuit reste en vente', 'Channex expose encore '],
].forEach(function (c) {
  if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent apres modification.');
});
if (src.indexOf("await channexAPI.post('/availability', { values });") !== -1) {
  echec("L'envoi en un seul lot subsiste.");
}

if (!ESSAI) {
  const sauvegarde = CIBLE + '.avant-blocage-verifie';
  if (!fs.existsSync(sauvegarde)) fs.writeFileSync(sauvegarde, fs.readFileSync(CIBLE));
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('BLOCAGE_VERIFIE') === -1) {
    echec("La correction n'est pas dans le fichier apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Tranches   : 100 valeurs par POST au lieu de 500 en un bloc');
console.log('  Taches     : GET /tasks/:id attendu pour chaque envoi');
console.log('  Relecture  : les nuits a bloquer sont relues avant de conclure');
console.log('  Logs       : « poussees ET verifiees », ou une erreur explicite');
if (!ESSAI) console.log('  Sauvegarde : channex.js.avant-blocage-verifie (ne pas commiter)');
console.log('');
console.log('  A verifier apres deploiement : creez un lien BHGuest sur une date');
console.log('  lointaine, puis relancez');
console.log('    node outils/channex-dispo.js <channex_property_id> <date> <date>');
console.log('  La nuit doit etre a 0. Et dans les logs, « Blocage relu et confirme ».\n');
console.log('  Attendez-vous a voir apparaitre des « ⚠️ Channex non bloque » sur');
console.log('  certains logements : ce sont des echecs qui existaient deja et que');
console.log('  personne ne voyait.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
