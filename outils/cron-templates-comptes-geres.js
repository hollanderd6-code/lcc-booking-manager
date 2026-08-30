#!/usr/bin/env node
/* ============================================================
   outils/cron-templates-comptes-geres.js
   Rendre au cron des modeles les conversations des comptes geres
   ============================================================
   Cible : server.js  (fonction runTemplatesCron)

   ── LA REGRESSION, DATEE ─────────────────────────────────────────
   Le 26 aout a 09:19, commit e81b773 « Cron templates: conversations
   des comptes geres ». Depuis, la selection du cron s'ecrit :

       WHERE c.user_id = $1        avec $1 = tmpl.user_id

   Un modele porte par le compte AGENCE ne voit donc plus aucune
   conversation des comptes qu'il gere. Le modele « Fiche Police »
   (compte u_mmtl7m45) avait envoye 67 fois jusqu'au 26 aout ; il cible
   « 0 conversation » chaque matin depuis.

   Consequence en chaine, verifiee dans les logs du 30 aout :

       Template "Fiche Police" -> 0 conversation(s) ciblee(s)
       Template "Arrivee"      -> 3 conversation(s) ciblee(s)
         ↳ Skip conv 1274 : fiche de police manquante (voyageur etranger)
         ↳ Skip conv 1283 : fiche de police manquante (voyageur etranger)

   Le modele d'arrivee exige une fiche de police signee pour les
   voyageurs etrangers ; la fiche n'est plus jamais demandee ; donc
   aucun voyageur etranger ne recoit ses infos d'acces. Dix-huit
   arrivees etrangeres etaient concernees d'ici mai 2027.

   Les deux commits suivants (5bff3a2, a563f20) ont aggrave le silence :
   l'interface calcule la portee sur les logements et affiche « Tous les
   logements — 26 logements » pour un modele qui n'en atteint aucun.
   L'ecran affirme, le cron ignore. Ce lot ne touche pas a l'affichage :
   une fois le cron reparé, l'affichage redevient vrai.

   ── LA CORRECTION ────────────────────────────────────────────────
   La regle d'acces existe deja dans le produit — acces-logement.js et
   getAgencyUserIds : un compte atteint les comptes qui lui sont
   DELEGUES via account_delegations (status 'accepted'). On la reprend
   telle quelle plutot que d'en inventer une seconde :

       WHERE c.user_id = ANY($1)   avec $1 = [tmpl.user_id, ...delegants]

   Le sens compte. On ajoute les comptes que le proprietaire du modele
   GERE (delegate_user_id = tmpl.user_id), jamais l'inverse : un modele
   de client ne doit pas atteindre les voyageurs d'un autre client.

   Le filtre par logements (property_ids) reste applique par-dessus,
   inchange : un modele restreint a M6 ne touchera pas AM4, meme si les
   deux comptes sont accessibles.

   Si la table account_delegations est absente, la fonction renvoie le
   seul compte du modele — donc le comportement d'aujourd'hui, sans
   erreur.

   ── CE QUE CE LOT NE FAIT PAS ────────────────────────────────────
   Il ne renvoie AUCUN message en retard. Les arrivees deja passees ne
   seront pas rattrapees : ce serait ecrire a des voyageurs partis. Le
   cron reprend a la prochaine execution, pour les arrivees a venir.

   Usage :
     node outils/cron-templates-comptes-geres.js --essai
     node outils/cron-templates-comptes-geres.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'server.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('server.js introuvable. Lancez depuis la racine du projet.');

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('COMPTES_GERES_V2') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* ── 1. Le resolveur de comptes, pose juste avant runTemplatesCron ── */

const A_FONCTION = 'async function runTemplatesCron(triggerTypes) {';

const N_FONCTION = `/* COMPTES_GERES_V2 — un modele porte par un compte agence doit atteindre
   les conversations des comptes qu'il gere. Depuis le 26 aout (e81b773) la
   selection filtrait sur le seul tmpl.user_id : le modele « Fiche Police »
   ciblait 0 conversation chaque matin, et par ricochet aucun voyageur
   etranger ne recevait ses infos d'acces (send_condition police_complete).

   Meme regle que acces-logement.js : les comptes DELEGUES au proprietaire
   du modele, jamais l'inverse. */
async function comptesDuModele(ownerUserId) {
  const ids = [ownerUserId];
  try {
    const { rows } = await pool.query(
      \`SELECT delegator_user_id FROM account_delegations
        WHERE delegate_user_id = $1 AND status = 'accepted'\`,
      [ownerUserId]
    );
    rows.forEach(r => { if (r.delegator_user_id && !ids.includes(r.delegator_user_id)) ids.push(r.delegator_user_id); });
  } catch (e) {
    /* Table absente : on reste sur le seul compte du modele. */
  }
  return ids;
}

async function runTemplatesCron(triggerTypes) {`;

if (src.split(A_FONCTION).length - 1 !== 1) {
  echec("La declaration de runTemplatesCron est introuvable (ou presente plusieurs fois).");
}
src = src.split(A_FONCTION).join(N_FONCTION);

/* ── 2. La selection des conversations ──────────────────────────── */

const A_WHERE = `           WHERE c.user_id = $1
           AND DATE(c.\${dateCol} AT TIME ZONE 'Europe/Paris') = $2`;

const N_WHERE = `           WHERE c.user_id = ANY($1)
           AND DATE(c.\${dateCol} AT TIME ZONE 'Europe/Paris') = $2`;

if (src.split(A_WHERE).length - 1 !== 1) {
  echec("Le WHERE de selection des conversations est introuvable.\n"
      + "    Attendu :  WHERE c.user_id = $1  suivi du DATE(c.${dateCol} ...).\n"
      + '    Envoyez-moi : grep -n "WHERE c.user_id = \\$1" server.js');
}
src = src.split(A_WHERE).join(N_WHERE);

/* ── 3. Le parametre passe a la requete ─────────────────────────── */

const A_PARAM = `          [tmpl.user_id, targetDate]`;
const N_PARAM = `          [await comptesDuModele(tmpl.user_id), targetDate]`;

if (src.split(A_PARAM).length - 1 !== 1) {
  echec("Le parametre [tmpl.user_id, targetDate] est introuvable (ou present plusieurs fois).\n"
      + '    Envoyez-moi : grep -n "tmpl.user_id, targetDate" server.js');
}
src = src.split(A_PARAM).join(N_PARAM);

/* ── 4. Verifications ───────────────────────────────────────────── */

/* Un eventuel shebang en premiere ligne est accepte par node mais refuse
   par new Function : on l'ecarte avant de controler. */
try { new Function(src.replace(/^#![^\n]*\n/, '')); }
catch (e) { echec('server.js ne serait plus du JavaScript valide — ' + e.message); }

[
  ['le resolveur de comptes', 'async function comptesDuModele(ownerUserId)'],
  ['la delegation lue dans le bon sens', 'WHERE delegate_user_id = $1'],
  ['la selection elargie', 'WHERE c.user_id = ANY($1)'],
  ['le parametre', '[await comptesDuModele(tmpl.user_id), targetDate]'],
].forEach(function (c) {
  if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent apres modification.');
});

/* Le sens inverse serait une fuite entre clients : on s'en assure. */
if (src.indexOf('WHERE delegator_user_id = $1 AND status') !== -1) {
  echec('Une lecture des delegations dans le sens inverse est presente : risque de fuite entre comptes.');
}

if (!ESSAI) {
  const sauvegarde = CIBLE + '.avant-comptes-geres';
  if (!fs.existsSync(sauvegarde)) fs.writeFileSync(sauvegarde, fs.readFileSync(CIBLE));
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('COMPTES_GERES_V2') === -1) {
    echec("La correction n'est pas dans le fichier apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Selection   : WHERE c.user_id = ANY($1) — compte du modele + comptes geres');
console.log('  Delegation  : account_delegations, status accepted, sens agence -> client');
console.log('  Logements   : filtre property_ids inchange, toujours applique');
if (!ESSAI) console.log('  Sauvegarde  : server.js.avant-comptes-geres (a supprimer une fois valide)');
console.log('');
console.log('  ATTENTION — server.js.avant-comptes-geres ne doit pas etre commite :');
console.log('    echo "server.js.avant-comptes-geres" >> .gitignore');
console.log('');
console.log('  A verifier apres deploiement, dans les logs du prochain cron :');
console.log('    Template "Fiche Police" -> N conversation(s) ciblee(s)   avec N > 0');
console.log('  Et le lendemain, plus aucun « Skip conv ... fiche de police manquante »');
console.log('  pour un voyageur dont la fiche est partie trois jours avant.\n');
console.log('  Aucun message en retard ne sera renvoye : les arrivees passees restent');
console.log('  passees. Le rattrapage se fait a la main, ou pas du tout.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
