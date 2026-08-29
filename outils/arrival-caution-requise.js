#!/usr/bin/env node
/* ============================================================
   outils/arrival-caution-requise.js
   Pas de tour de bienvenue sans caution
   ============================================================
   Cible : server.js  (sendArrivalWelcomeTours, ~ligne 16220)

   ── CE QUI EST ARRIVE ───────────────────────────────────────────
   Une voyageuse de Saint Gratien RDC n'a jamais paye sa caution, et
   n'est donc jamais venue. Elle a recu, a l'heure du check-in :

     « Vous voila arrive(e) ! On espere que tout est a votre gout. »

   suivi du lien de sejour permettant de signaler un probleme.

   ── LA CAUSE ────────────────────────────────────────────────────
   Le cron horaire sendArrivalWelcomeTours envoie ce message a toute
   conversation dont la date d'arrivee est aujourd'hui, des que l'heure
   de check-in + 1h est passee. Aucune verification : ni caution, ni
   arrivee reelle.

   Ce message est interne au logiciel — ce n'est pas un modele. Il
   echappait donc a la case « Caution validee » que les modeles
   proposent depuis toujours.

   ── CE QUE FAIT CE CORRECTIF ────────────────────────────────────
   Avant d'envoyer, on appelle shouldSkipForDepositCondition — le meme
   helper que les modeles, avec la condition 'deposit_active'.

   Le reutiliser plutot que d'ecrire une regle parallele importe : il
   connait deja les exemptions, et une seconde regle finirait par
   diverger de la premiere. Ses regles, inchangees :
     · Airbnb  → toujours envoyer (Airbnb encaisse la caution)
     · BHGuest → toujours envoyer (paiement Stripe = caution)
     · logement sans montant de caution → toujours envoyer
     · ailleurs → envoyer seulement si la caution est autorisee

   Le refus est journalise avec sa raison. Rien n'est supprime : le
   message partira au passage suivant du cron si la caution arrive dans
   la journee — le cron tourne toutes les heures et la conversation
   reste eligible tant que la date d'arrivee est aujourd'hui.

   La requete recupere desormais c.platform et c.channex_booking_id,
   dont le helper a besoin pour reconnaitre la plateforme et retrouver
   la reservation. Sans eux il ne pourrait pas exempter Airbnb.

   ── CE QUE CE CORRECTIF NE FAIT PAS ─────────────────────────────
   Il ne verifie pas que le voyageur est REELLEMENT arrive — seulement
   qu'il a paye. Un voyageur qui paie sa caution puis annule son voyage
   recevra encore le message. Verifier l'arrivee reelle demanderait une
   information que le logiciel n'a pas aujourd'hui.

   Usage :
     node outils/arrival-caution-requise.js --essai
     node outils/arrival-caution-requise.js
   ============================================================ */

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

if (src.indexOf('[ARRIVAL] Tour de bienvenue NON envoyé') !== -1) {
  console.log('\n  Le correctif est deja en place — rien a faire.\n');
  process.exit(0);
}

const PAIRES = [
  ['la requete du cron de bienvenue', "      `SELECT c.id, c.user_id, c.property_id, c.guest_name, c.reservation_start_date,\n              c.reservation_uid, p.arrival_time, p.name AS property_name", "      `SELECT c.id, c.user_id, c.property_id, c.guest_name, c.reservation_start_date,\n              c.reservation_uid, c.platform, c.channex_booking_id,\n              p.arrival_time, p.name AS property_name"],
  ['l\'envoi du tour de bienvenue', "      try {\n        const token = await ensureArrivalCheckin(conv);", "      try {\n        /* Ne pas souhaiter la bienvenue a quelqu'un qui n'a pas paye sa caution.\n           Le message livre un lien de sejour et suppose l'arrivee effective ;\n           l'envoyer a un voyageur qui n'est jamais venu est au mieux absurde,\n           au pire une invitation a entrer.\n\n           On reutilise le helper des modeles plutot que d'ecrire une regle\n           parallele : il connait deja les exemptions (Airbnb et BHGuest\n           encaissent eux-memes la caution) et le cas des logements sans\n           caution, ou il laisse passer. */\n        const barrage = await shouldSkipForDepositCondition(pool, conv, 'deposit_active');\n        if (barrage.skip) {\n          console.log(`🛎️ [ARRIVAL] Tour de bienvenue NON envoyé — conv ${conv.id} — ${barrage.reason}`);\n          continue;\n        }\n\n        const token = await ensureArrivalCheckin(conv);"],
];
for (const [quoi, avant, apres] of PAIRES) {
  const n = src.split(avant).length - 1;
  if (n !== 1) echec(quoi + ' : ' + n + " occurrence(s) au lieu d'une. server.js a change.");
  src = src.split(avant).join(apres);
}

/* ---- Verifications ---- */
try { new Function(src); }
catch (e) { echec("server.js n'est plus du JavaScript valide — " + e.message); }

const controles = [
  ['l\'appel au helper', "shouldSkipForDepositCondition(pool, conv, 'deposit_active')"],
  ['le saut de la conversation', 'if (barrage.skip) {'],
  ['le journal du refus', '[ARRIVAL] Tour de bienvenue NON envoyé'],
  ['la plateforme dans la requete', 'c.platform, c.channex_booking_id'],
];
for (const c of controles) {
  if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent du resultat.');
}

/* Le helper doit exister dans le fichier. */
if (src.indexOf('async function shouldSkipForDepositCondition') === -1) {
  echec("shouldSkipForDepositCondition est introuvable : le correctif appellerait une fonction inexistante.");
}
/* Le message doit continuer d'etre envoye dans le cas nominal. */
if (src.indexOf('await sendAutomatedMessage(conv.id, message, io);') === -1) {
  echec("L'envoi du message a ete perdu.");
}
if (src.split("shouldSkipForDepositCondition(pool, conv, 'deposit_active')").length - 1 !== 1) {
  echec('Le controle a ete insere plusieurs fois.');
}

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('[ARRIVAL] Tour de bienvenue NON envoyé') === -1) {
    echec("L'ajout est absent apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Le tour de bienvenue ne part plus si la caution n\'est pas validee.');
console.log('  Airbnb, BHGuest et les logements sans caution ne changent pas.');
console.log('  Meme helper que les modeles : une seule regle, pas deux.');
console.log('');
console.log('  Redemarrez le serveur, puis surveillez a l\'heure des check-in :');
console.log('    🛎️ [ARRIVAL] Tour de bienvenue NON envoyé — conv … — …');
console.log('');
console.log('  Le cron tourne toutes les heures : si la caution arrive dans la');
console.log('  journee, le message partira au passage suivant.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
