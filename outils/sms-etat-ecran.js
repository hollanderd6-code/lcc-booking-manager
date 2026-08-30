#!/usr/bin/env node
/* ============================================================
   outils/sms-etat-ecran.js
   L'ecran dit ce que la passerelle a repondu
   ============================================================
   Cible : public/app.html  (retour de la creation d'un lien BHGuest)

   ── LE DEFAUT ────────────────────────────────────────────────────
   L'ecran ne connait que deux issues : envoye, ou echec.

       var smsFailed = !!phone && data.sms_sent === false;

   Or la passerelle en a trois. « Pending » n'est ni l'un ni l'autre :
   le message est en file, il attend l'appareil Android. Le 30 aout,
   l'application du telephone plantait au lancement — les deux SMS sont
   restes en attente et l'ecran affichait « ✅ Lien envoye par SMS ».

   Le serveur renvoie desormais `sms_state` (lot sms-etat-reel.js). Cet
   ecran l'ignore encore.

   ── LA CORRECTION ────────────────────────────────────────────────
   Une troisieme issue : en attente. Le bouton confirme que le lien est
   cree (c'est vrai, et les dates sont bloquees), mais le texte dit que
   le SMS n'est pas parti. En ambre, pas en vert : ce n'est pas un
   echec, c'est un inachevé.

   « SMS en attente de l'appareil relais — pas encore parti »

   Et « SMS » disparait de la liste des destinataires atteints tant que
   l'etat n'est pas Sent ou Delivered. Un mot juste vaut mieux qu'une
   coche rassurante.

   Rien d'autre ne bouge : les deux branches existantes (echec, succes)
   sont conservees telles quelles.

   Usage :
     node outils/sms-etat-ecran.js --essai
     node outils/sms-etat-ecran.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'app.html');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('public/app.html introuvable. Lancez depuis la racine du projet.');

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('smsEnAttente') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

function remplacer(avant, apres, quoi) {
  if (src.split(avant).length - 1 !== 1) {
    echec('\u00ab ' + quoi + ' \u00bb introuvable (ou present plusieurs fois) dans public/app.html.');
  }
  src = src.split(avant).join(apres);
}

/* ── 1. La troisieme issue, declaree ────────────────────────────── */

remplacer(
"        var smsFailed = !!phone && data.sms_sent === false;",
"        var smsFailed = !!phone && data.sms_sent === false;\n"
+ "        // La passerelle a trois issues, pas deux : « Pending » signifie que le\n"
+ "        // message attend l'appareil Android relais. Le dire, plutot que de\n"
+ "        // cocher « envoye » et decouvrir trois jours plus tard qu'il dormait.\n"
+ "        var smsEnAttente = !!phone && !smsFailed && !!data.sms_state\n"
+ "          && ['Sent', 'Delivered'].indexOf(data.sms_state) === -1;",
  'la variable smsFailed'
);

/* ── 2. « SMS » n'est destinataire atteint qu'une fois parti ─────── */

remplacer(
"        if (phone && !smsFailed) dest.push('SMS');",
"        if (phone && !smsFailed && !smsEnAttente) dest.push('SMS');",
  'la liste des destinataires'
);

/* ── 3. La branche d'attente, avant le succes ────────────────────── */

remplacer(
`        } else {
          btn.innerHTML = '<i class="fas fa-check"></i> Lien envoyé';
          btn.style.background = '#0A2C22';
          status.style.color = '#0A2C22';
          status.innerHTML = '✅ Lien envoyé' + (dest.length ? ' par ' + dest.join(' et ') : '') + ' · Dates bloquées jusqu\\'à ' + exp;
        }`,
`        } else if (smsEnAttente) {
          btn.innerHTML = '<i class="fas fa-check"></i> Lien créé';
          btn.style.background = '#0A2C22';
          status.style.color = '#B45309';
          status.innerHTML = (email ? '✅ Lien envoyé par email · ' : '')
            + '⏳ SMS en attente de l\\'appareil relais — pas encore parti · Dates bloquées jusqu\\'à ' + exp;
        } else {
          btn.innerHTML = '<i class="fas fa-check"></i> Lien envoyé';
          btn.style.background = '#0A2C22';
          status.style.color = '#0A2C22';
          status.innerHTML = '✅ Lien envoyé' + (dest.length ? ' par ' + dest.join(' et ') : '') + ' · Dates bloquées jusqu\\'à ' + exp;
        }`,
  'la branche de succes'
);

/* ── 4. Verifications ───────────────────────────────────────────── */

[
  ['la variable d\'attente', 'var smsEnAttente = !!phone'],
  ['le retrait de SMS des destinataires', "!smsFailed && !smsEnAttente) dest.push('SMS')"],
  ['la branche d\'attente', '} else if (smsEnAttente) {'],
  ['le message en attente', 'en attente de l\\\'appareil relais'],
].forEach(function (c) {
  if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent apres modification.');
});

/* Les trois branches doivent rester distinctes et la structure intacte. */
const nbBranches = src.split("btn.innerHTML = '<i class=\"fas fa-check\"></i> Lien").length - 1;
if (nbBranches < 3) echec('Les branches du retour ne sont plus au nombre attendu (' + nbBranches + ').');

if (!ESSAI) {
  const sauvegarde = CIBLE + '.avant-sms-ecran';
  if (!fs.existsSync(sauvegarde)) fs.writeFileSync(sauvegarde, fs.readFileSync(CIBLE));
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('smsEnAttente') === -1) {
    echec("La correction n'est pas dans le fichier apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Trois issues : envoye (vert), en attente (ambre), echec (rouge)');
console.log('  Le bouton dit « Lien cree » quand le SMS n\'est pas encore parti');
console.log('  Les dates restent bloquees dans tous les cas, et c\'est dit');
if (!ESSAI) console.log('  Sauvegarde : public/app.html.avant-sms-ecran (ne pas commiter)');
console.log('');
console.log('  A verifier : telephone relais ETEINT, envoyez un lien par SMS.');
console.log('  Attendu a l\'ecran : « ⏳ SMS en attente de l\'appareil relais — pas');
console.log('  encore parti ». Rallumez, renvoyez : « ✅ Lien envoye par SMS ».\n');
console.log('  Ce lot suppose sms-etat-reel.js deja deploye : sans lui, sms_state');
console.log('  est absent et l\'ecran se comporte comme avant.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
