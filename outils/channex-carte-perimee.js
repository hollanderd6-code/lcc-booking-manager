#!/usr/bin/env node
/* ============================================================
   outils/channex-carte-perimee.js
   Apres connexion, la carte propose encore « Connecter »
   ============================================================
   Cible : public/js/settings.js  (fonction _connectAndProceed)

   Complement de outils/channex-tarifs-connexion.js, qui doit avoir ete
   lance : c'est lui qui fait remonter « avertissement » depuis le serveur.

   ── LE SYMPTOME ─────────────────────────────────────────────────
   Un logement vient d'etre connecte a Channex. Sa carte continue
   d'afficher le bouton « Connecter mes plateformes ». On reclique, et
   le serveur repond « Ce logement est deja connecte a Channex ».

   ── CE QUI A ETE ECARTE ─────────────────────────────────────────
   · Le serveur : GET /api/properties renvoie bien channexEnabled: true
     et le channexPropertyId — verifie en direct dans le navigateur.
   · Un cache navigateur : lcc_properties_cache est absent.
   · Les trois declarations de app.get('/api/properties') reperees dans
     server.js aux lignes 1861, 1866 et 16742 : les deux premieres sont
     a l'interieur d'un commentaire de documentation. Une seule route
     existe reellement, et elle est correcte.

   ── LA CAUSE ────────────────────────────────────────────────────
   Dans _connectAndProceed, apres la reponse du serveur :

       loadProperties().catch(() => {});

   Deux defauts dans cette seule ligne :

   1. Pas de « await ». Le rechargement part en arriere-plan pendant que
      le flux enchaine sur l'ecran suivant. La carte peut donc etre
      redessinee avec l'etat d'AVANT la connexion.
   2. Le .catch vide avale tout echec. Si le rechargement echoue, plus
      rien ne le signale : la liste reste perimee, sans trace ni dans la
      console ni a l'ecran.

   Les deux autres appels a loadProperties du fichier sont deja
   attendus — celui-ci est le seul oubli.

   ── CE QUE FAIT CE CORRECTIF ────────────────────────────────────
   1. Attend le rechargement avant de poursuivre.
   2. Journalise l'echec au lieu de l'avaler.
   3. Affiche l'avertissement remonte par le serveur — typiquement
      « aucun prix de base defini », qui laisse le logement ferme sur les
      plateformes. Sans ce message, la connexion parait complete alors
      que le logement reste invisible a la vente : exactement le piege
      rencontre avec Booking.

   ── CE QUI N'EST PAS TOUCHE, ET POURQUOI ────────────────────────
   La modale n'est pas fermee au succes. C'est volontaire : la fonction
   appelante teste « if (!modal.isConnected) return; » pour distinguer
   l'echec du succes, puis enchaine sur le choix de la plateforme. La
   retirer ici interromprait le parcours juste apres la connexion.

   Ce parcours meriterait d'etre repris — un ecran de confirmation qui
   dit ce qui est fait (property creee, disponibilites envoyees, tarifs
   envoyes) et ce qui reste a faire. Ce n'est pas un correctif, c'est une
   conception : a decider ensemble plutot qu'a glisser dans un script.

   Usage :
     node outils/channex-carte-perimee.js --essai
     node outils/channex-carte-perimee.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'js', 'settings.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('public/js/settings.js introuvable. Lancez depuis la racine du projet.');
let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('[OTA] rafraichissement de la liste') !== -1) {
  console.log('\n  Le correctif est deja en place — rien a faire.\n');
  process.exit(0);
}

/* L'ancre porte sur les trois lignes ensemble : « loadProperties().catch »
   existe trois fois dans le fichier, mais les deux autres sont deja
   attendues et ne doivent pas etre touchees. */
const ANCIEN = `    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Erreur activation');
    loadProperties().catch(() => {});`;

const n = src.split(ANCIEN).length - 1;
if (n !== 1) echec(`Le bloc de fin de _connectAndProceed : ${n} occurrence(s) au lieu d'une.`);

const NOUVEAU = `    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Erreur activation');

    /* « await », et non un appel lance en arriere-plan : la suite du flux
       et la carte du logement doivent voir le nouvel etat. Sans cette
       attente, la carte continue de proposer « Connecter mes plateformes »
       pour un logement qui vient d'etre connecte — et le clic suivant se
       heurte a « Ce logement est deja connecte a Channex ». */
    try {
      await loadProperties();
    } catch (e2) {
      /* L'echec n'est plus avale en silence : sans rafraichissement, la
         liste affichee est perimee, ce qui est precisement le symptome. */
      console.error('[OTA] rafraichissement de la liste apres connexion :', e2);
    }

    /* Le serveur signale par « avertissement » ce qui empeche la mise en
       vente — typiquement un logement sans prix de base, que les
       plateformes laissent ferme. Le taire donnerait une connexion
       apparemment reussie et un logement invisible a la vente. */
    if (d && d.avertissement && typeof showToast === 'function') {
      showToast(d.avertissement, 'warning');
    }`;

src = src.split(ANCIEN).join(NOUVEAU);

/* ---- Verifications ---- */
try { new Function(src); }
catch (e) { echec('settings.js n\'est plus du JavaScript valide — ' + e.message); }

for (const [quoi, aiguille] of [
  ['l\'attente du rechargement', 'await loadProperties();'],
  ['la journalisation de l\'echec', '[OTA] rafraichissement de la liste apres connexion'],
  ['l\'affichage de l\'avertissement', "showToast(d.avertissement, 'warning')"],
]) if (src.indexOf(aiguille) === -1) echec(`Verification : ${quoi} est absent du resultat.`);

/* Le parcours de la modale ne doit pas avoir bouge. */
if (src.indexOf('if (!modal.isConnected) return;') === -1) {
  echec('Le test modal.isConnected a disparu : le parcours apres connexion serait casse.');
}
/* Les deux autres appels, deja attendus, restent intacts. */
if (src.split('await loadProperties().catch(() => {});').length - 1 !== 2) {
  echec('Les deux autres appels a loadProperties ont ete modifies par erreur.');
}
if (src.split('await loadProperties();').length - 1 !== 1) {
  echec('L\'attente a ete inseree plusieurs fois.');
}
/* showToast doit accepter un type. */
if (src.indexOf('function showToast(message, type = "success")') === -1
    && src.indexOf("function showToast(message, type = 'success')") === -1) {
  echec('La signature de showToast a change : verifiez le second parametre.');
}

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('await loadProperties();') === -1) {
    echec('L\'ajout est absent apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  settings.js : la liste est rechargee AVANT de poursuivre, l\'echec est');
console.log('  journalise, et l\'avertissement du serveur est affiche.');
console.log('');
console.log('  Ensuite : ⌘⇧R sur Boostinghost (settings.js est mis en cache).');
console.log('');
console.log('  Pour La longere numero 3, deja connectee : rechargez la page, la carte');
console.log('  doit montrer le badge de synchronisation au lieu du bouton « Connecter ».');
console.log('  Si le bouton persiste APRES rechargement, le probleme n\'est pas le');
console.log('  rafraichissement — dites-le moi, la piste serait alors le rendu de la');
console.log('  carte lui-meme (lignes 1425 et 1595, qui ne lisent que le camelCase).\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
