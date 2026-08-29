#!/usr/bin/env node
/* ============================================================
   outils/tpl-caution-non-resolue.js
   Ne plus envoyer un message dont le lien de caution manque
   ============================================================
   Cible : server.js  (resolution des variables de modele, ~ligne 30508)

   ── CE QUI EST ARRIVE ───────────────────────────────────────────
   Une voyageuse de Saint Gratien RDC a recu ceci, tel quel :

     « Veuillez trouver ci-joint le lien de caution obligatoire pour
       obtenir les informations : {caution_url} »

   L'hote a du envoyer le lien a la main quatre minutes plus tard.

   ── LA CAUSE ────────────────────────────────────────────────────
   Dans la resolution des variables :

       if (!cautionUrl) {
         console.warn('⚠️ [TPL] {caution_url} non résolu …');
       } else {
         msg = msg.replace(/{caution_url}/gi, cautionUrl);
       }

   Quand le lien ne peut pas etre fabrique, le code AVERTIT DANS LES
   JOURNAUX ET NE REMPLACE RIEN. La variable part donc en toutes lettres.
   La branche catch, elle, remplacait par du vide — le voyageur recevait
   alors « le lien de caution obligatoire : » suivi de rien.

   Pourquoi le lien manquait-il ici ? Le code tente de creer la caution a
   la volee via getStripeForProperty — donc, pour ce logement, sur le
   compte Stripe du proprietaire, dont l'inscription n'etait pas terminee.
   Stripe refuse, l'erreur est avalee par un catch, cautionUrl reste vide.
   (outils/stripe-repli-compte-inactif.js traite cette cause-la ;
   celui-ci traite la consequence.)

   ── CE QUE FAIT CE CORRECTIF ────────────────────────────────────
   Si le lien de caution ne peut pas etre resolu, LE MESSAGE N'EST PAS
   ENVOYE : la fonction renvoie { skipped: true, reason }, la meme
   convention qu'elle utilise deja pour la fiche de police.

   Un message absent se remarque et se rattrape. Un message casse fait
   perdre la confiance du voyageur et oblige l'hote a reparer sans
   comprendre.

   Le cron de messages automatiques applique DEJA cette regle
   (« {caution_url} non résolu … — message non envoyé »). Ce correctif
   met les deux chemins d'accord.

   ── L'EXCEPTION AIRBNB ──────────────────────────────────────────
   Airbnb encaisse lui-meme la caution : il n'y a pas de lien BH a
   fournir, et le message reste utile sans lui. Comme le cron, on
   supprime alors la variable et on envoie. Sans cette exception, le
   correctif bloquerait tous les messages Airbnb portant cette variable.

   ── CE QU'IL RESTE A FAIRE ──────────────────────────────────────
   L'hote n'est prevenu de rien : le message non envoye n'existe que dans
   les journaux du serveur. Il faudrait le signaler dans la conversation
   — « message d'arrivee non envoye : lien de caution indisponible » —
   pour qu'il puisse agir. A voir ensemble.

   Usage :
     node outils/tpl-caution-non-resolue.js --essai
     node outils/tpl-caution-non-resolue.js
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

if (src.indexOf("reason: 'lien de caution indisponible'") !== -1) {
  console.log('\n  Le correctif est deja en place — rien a faire.\n');
  process.exit(0);
}

const AVANT = "      if (!cautionUrl) {\n        console.warn(`⚠️ [TPL] {caution_url} non résolu pour conv ${conv.id} — deposit absent ou montant=0`);\n      } else {\n        msg = msg.replace(/{caution_url}/gi, cautionUrl);\n      }\n    } catch(e) {\n      msg = msg.replace(/{caution_url}/gi, '');\n      console.warn('⚠️ [TPL] Erreur résolution {caution_url}:', e.message);\n    }";
const APRES = "      if (!cautionUrl) {\n        /* Airbnb encaisse lui-meme la caution : il n'y a pas de lien BH a\n           fournir, et le message reste utile sans lui. Meme regle que le\n           cron (voir « Airbnb — {caution_url} supprime »). */\n        const plateforme = (conv.platform || conv.channex_platform || conv.ota_name || '')\n          .toLowerCase().replace(/[_\\-\\s]/g, '');\n        if (plateforme.includes('airbnb') || plateforme === 'abb') {\n          msg = msg.replace(/{caution_url}/gi, '');\n          console.log(`ℹ️ [TPL] Airbnb — {caution_url} supprimé pour conv ${conv.id} (pas de caution BH)`);\n        } else {\n          /* Ailleurs, on N'ENVOIE PAS. Auparavant le message partait avec\n             « {caution_url} » en toutes lettres : le voyageur recevait une\n             consigne inapplicable, et l'hote devait envoyer le lien a la main\n             sans savoir pourquoi. Un message absent se remarque et se\n             rattrape ; un message casse fait perdre la confiance.\n             Le cron applique deja cette regle — les deux chemins s'accordent. */\n          console.warn(`⚠️ [TPL] {caution_url} non résolu pour conv ${conv.id} — message NON envoyé (deposit absent, montant=0, ou compte Stripe du propriétaire inutilisable)`);\n          return { skipped: true, reason: 'lien de caution indisponible' };\n        }\n      } else {\n        msg = msg.replace(/{caution_url}/gi, cautionUrl);\n      }\n    } catch(e) {\n      /* Meme principe en cas d'erreur : mieux vaut ne rien envoyer qu'un\n         message ampute de son lien. */\n      console.warn('⚠️ [TPL] Erreur résolution {caution_url} — message NON envoyé :', e.message);\n      return { skipped: true, reason: 'erreur lors de la création du lien de caution' };\n    }";

const n = src.split(AVANT).length - 1;
if (n !== 1) echec("Le bloc de resolution de {caution_url} : " + n + " occurrence(s) au lieu d'une. server.js a change.");
src = src.split(AVANT).join(APRES);

/* ---- Verifications ---- */
try { new Function(src); }
catch (e) { echec("server.js n'est plus du JavaScript valide — " + e.message); }

const controles = [
  ["le refus d'envoi", "return { skipped: true, reason: 'lien de caution indisponible' };"],
  ["le refus en cas d'erreur", "reason: 'erreur lors de la création du lien de caution'"],
  ["l'exception Airbnb", "plateforme.includes('airbnb')"],
  ['le journal explicite', 'message NON envoyé'],
];
for (const c of controles) {
  if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent du resultat.');
}

/* Le cas nominal doit rester intact. */
if (src.indexOf('msg = msg.replace(/{caution_url}/gi, cautionUrl);') === -1) {
  echec('Le remplacement normal du lien a ete perdu.');
}
/* La convention de sortie doit etre celle du fichier. */
if (src.indexOf('return { skipped: true, reason:') === -1) {
  echec('La convention { skipped, reason } est absente.');
}
/* Un seul refus de chaque sorte. */
if (src.split("reason: 'lien de caution indisponible'").length - 1 !== 1) {
  echec('Le refus a ete insere plusieurs fois.');
}

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf("reason: 'lien de caution indisponible'") === -1) {
    echec("L'ajout est absent apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log("  Un message dont le lien de caution est introuvable n'est plus envoye.");
console.log('  Airbnb fait exception : la variable est retiree et le message part.');
console.log('  Les deux chemins (envoi immediat et cron) appliquent enfin la meme regle.');
console.log('');
console.log('  Redemarrez le serveur, puis surveillez :');
console.log('    ⚠️ [TPL] {caution_url} non résolu … — message NON envoyé');
console.log('');
console.log('  Si ce message apparait souvent, la cause est en amont : un logement');
console.log('  sans montant de caution, ou un compte Stripe proprietaire inutilisable');
console.log('  (voir outils/stripe-repli-compte-inactif.js).\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
