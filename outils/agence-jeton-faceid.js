#!/usr/bin/env node
/* ============================================================
   outils/agence-jeton-faceid.js
   Face ID ecrase le jeton d'impersonation agence
   ============================================================
   Cible : public/js/auth-fetch.js

   ── LE BUG ──────────────────────────────────────────────────────
   Une agence bascule sur le compte d'un client gere. L'interface
   affiche bien « Stephanie Induni — Mon espace », mais toutes les
   donnees affichees sont celles de L'AGENCE : ses 12 clients
   proprietaires, son total facture.

   Le serveur n'y est pour rien. Verifie ligne a ligne :
   /api/agency/switch signe correctement { id: targetUserId,
   type: 'agency_access', agentId }, la delegation est controlee, et
   /api/owner-clients scope bien sur user.id avec le bon sens de
   delegation (delegate_user_id).

   Le coupable est ici, dans refreshToken() :

       const baseToken = localStorage.getItem('lcc_faceid_token') || getToken();
       ...
       if (d?.token) {
         await nativeSet('lcc_token', d.token);        // <-- ecrase
         await nativeSet('lcc_faceid_token', d.token);

   Ce rafraichissement part du jeton Face ID longue duree (90 jours),
   qui appartient au titulaire du navigateur — l'agence. Il s'execute au
   demarrage (refresh proactif) et sur 401. Il ecrit donc le jeton de
   L'AGENCE dans lcc_token, par-dessus le jeton d'impersonation. Comme
   lcc_managed_user survit, l'interface continue d'annoncer le compte du
   client : on croit travailler chez lui, on travaille chez soi.

   Verifie en direct : le jeton actif portait
   { id: 'u_...', email: 'charles.induni@gmail.com', faceid: true } —
   ni type: 'agency_access', ni agentId.

   En navigation privee il n'y a pas de lcc_faceid_token : rien n'ecrase,
   tout parait normal. Le probleme est donc invisible aux tests faits
   dans une fenetre propre, et systematique pour tout utilisateur agence
   ayant active Face ID.

   Ce n'est PAS une fuite de donnees : le client ne voit jamais les
   donnees de l'agence. C'est l'inverse — l'agence agit sur son propre
   compte en croyant agir sur celui du client. Une facture creee, un
   logement modifie, un message envoye partent du mauvais compte.

   ── LE CORRECTIF ────────────────────────────────────────────────
   Pendant une impersonation (lcc_agency_token present), le
   rafraichissement Face ID ne doit ni s'executer ni ecrire lcc_token :
   le jeton agency_access a sa propre route de renouvellement,
   /api/agency/refresh, deja appelee toutes les 6 h par app.html.

   Deux gardes, volontairement redondantes :
   1. refreshToken() sort immediatement si une impersonation est active.
   2. L'ecriture de lcc_token est conditionnee de la meme facon — si un
      autre chemin appelle ce bloc un jour, le jeton d'impersonation
      survit quand meme.

   Usage :
     node outils/agence-jeton-faceid.js --essai
     node outils/agence-jeton-faceid.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'js', 'auth-fetch.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}
function unique(src, aiguille, quoi) {
  const n = src.split(aiguille).length - 1;
  if (n !== 1) echec(`${quoi} : ${n} occurrence(s) au lieu d'une. auth-fetch.js a change.`);
}

if (!fs.existsSync(CIBLE)) echec('public/js/auth-fetch.js introuvable. Lancez depuis la racine du projet.');
let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('_impersonationActive') !== -1) {
  console.log('\n  Le correctif est deja en place — rien a faire.\n');
  process.exit(0);
}

/* 1. Le detecteur, pose juste avant refreshToken(). */
const A1 = '    const refreshToken = () => {';
unique(src, A1, 'Declaration de refreshToken');
src = src.split(A1).join(`    /* Une impersonation agence est active quand lcc_agency_token existe :
       il conserve le jeton de l'agence pendant que lcc_token porte celui du
       compte gere. Le jeton Face ID, lui, appartient toujours au titulaire
       du navigateur — le rafraichir ici ecraserait l'impersonation. Le jeton
       agency_access se renouvelle par /api/agency/refresh. */
    const _impersonationActive = () => {
      try {
        return !!(localStorage.getItem('lcc_agency_token')
          || localStorage.getItem('lcc_managed_user'));
      } catch { return false; }
    };

${A1}`);

/* 2. La sortie immediate, au meme endroit que la garde des sous-comptes. */
const A2 = `          // Les sous-comptes utilisent un autre type de token → pas de refresh ici
          if (localStorage.getItem('lcc_account_type') === 'sub') return null;`;
unique(src, A2, 'Garde des sous-comptes');
src = src.split(A2).join(`${A2}

          // Impersonation agence en cours : ne pas rafraichir. Le jeton Face ID
          // est celui de l'agence ; l'ecrire dans lcc_token ferait travailler
          // l'agence sur son propre compte en croyant etre chez son client.
          if (_impersonationActive()) return null;`);

/* 3. L'ecriture elle-meme, protegee a son tour. */
const A3 = `          if (d?.token) {
            await nativeSet('lcc_token', d.token);
            await nativeSet('lcc_faceid_token', d.token);`;
unique(src, A3, 'Ecriture du jeton rafraichi');
src = src.split(A3).join(`          if (d?.token) {
            // Ceinture : meme si l'on arrivait ici pendant une impersonation,
            // lcc_token ne doit pas etre remplace. Seul le jeton long est roule.
            if (!_impersonationActive()) await nativeSet('lcc_token', d.token);
            await nativeSet('lcc_faceid_token', d.token);`);

/* ---- Verifications ---- */
try { new Function(src); }
catch (e) { echec('Le resultat n\'est pas du JavaScript valide — ' + e.message); }

for (const [quoi, aiguille] of [
  ['le detecteur', 'const _impersonationActive = () => {'],
  ['la sortie immediate', 'if (_impersonationActive()) return null;'],
  ['la protection de l\'ecriture', "if (!_impersonationActive()) await nativeSet('lcc_token', d.token);"],
]) if (src.indexOf(aiguille) === -1) echec(`Verification : ${quoi} est absent du resultat.`);

if (src.split('const _impersonationActive').length - 1 !== 1) echec('Le detecteur est defini deux fois.');
/* Le jeton long doit continuer d'etre roule : c'est lui qui garde Face ID actif. */
if (src.indexOf("await nativeSet('lcc_faceid_token', d.token);") === -1) {
  echec('Le rafraichissement du jeton Face ID a ete perdu.');
}
/* Le detecteur doit etre defini AVANT son premier usage. */
if (src.indexOf('const _impersonationActive') > src.indexOf('if (_impersonationActive()) return null;')) {
  echec('Le detecteur est defini apres son premier appel.');
}

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('_impersonationActive') === -1) {
    echec('L\'ajout est absent apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  auth-fetch.js : le rafraichissement Face ID n\'ecrase plus le jeton');
console.log('  d\'impersonation agence. Le jeton long continue d\'etre roule.');
console.log('');
console.log('  A verifier, dans votre navigateur habituel (PAS en navigation privee,');
console.log('  qui masque le probleme puisqu\'elle n\'a pas de jeton Face ID) :');
console.log('    1. Basculer sur le compte d\'un client gere.');
console.log('    2. Console : JSON.parse(atob(localStorage.getItem(\'lcc_token\').split(\'.\')[1]))');
console.log('       -> doit afficher type: "agency_access" et agentId, PAS faceid: true.');
console.log('    3. La page Mes clients doit alors montrer les clients du CLIENT.');
console.log('');
console.log('  Reste a traiter, si vous le voulez : quand le jeton d\'impersonation');
console.log('  expire ou echoue, l\'interface devrait sortir du mode agence au lieu');
console.log('  de retomber silencieusement sur le compte de l\'agence.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
