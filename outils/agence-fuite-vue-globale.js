#!/usr/bin/env node
/* ============================================================
   outils/agence-fuite-vue-globale.js
   La vue agence fuit dans le compte gere
   ============================================================
   Cible : public/app.html

   ── CE QUI SE PASSE ─────────────────────────────────────────────
   En se connectant sur le compte d'un client gere (Stephanie Induni),
   l'agence voyait SES PROPRES clients proprietaires — 12 clients,
   13 706,78 EUR facture — dans l'espace de la cliente.

   Deux morceaux de code se combinent :

   1. Un intercepteur global de fetch (~ligne 43) :

        window.fetch = function(url, opts) {
          if (localStorage.getItem('bh_agency_view') === 'all'
              && url.includes('/api/') && !url.includes('agency=')) {
            url += (url.includes('?') ? '&' : '?') + 'agency=all';
          }

      Tant que ce drapeau est pose, TOUS les appels API reclament la
      vue agregee de l'agence.

   2. switchAgencyAccount() remplace lcc_token par le jeton du compte
      gere et nettoie plusieurs caches (lcc_settings_profile,
      lcc_properties_cache) — mais PAS bh_agency_view.

   On entre donc dans le compte de la cliente avec son jeton, tout en
   continuant de demander « agency=all » a chaque requete. Le selecteur
   de compte le montre d'ailleurs : « Tous les comptes / Vue globale
   agence » reste coche alors que le pied de la barre affiche
   « Stephanie Induni — Mon espace ».

   ── CE QUE FAIT CE CORRECTIF ────────────────────────────────────
   1. bh_agency_view est efface a la bascule vers un compte gere, et au
      retour vers le compte agence. Un changement de compte remet donc
      toujours la vue sur « mon compte ».
   2. L'intercepteur refuse d'ajouter agency=all quand on est en train
      d'impersonner un compte (presence de lcc_agency_token). C'est la
      ceinture : meme si le drapeau traine — onglet ouvert avant le
      correctif, deuxieme onglet, retour arriere — la requete part
      propre.
   3. Au chargement, si les deux etats sont incompatibles (un compte
      gere actif ET le drapeau pose), le drapeau est efface avant tout
      appel.

   ── CE QUE CE CORRECTIF NE FAIT PAS ─────────────────────────────
   Il ne corrige PAS le serveur, et c'est important : le parametre
   agency=all voyage dans l'URL. N'importe qui peut l'ajouter a la main.
   Si /api/... l'honore sans verifier que le demandeur gere reellement
   des comptes — et qu'il n'agrege QUE ceux qu'il gere, jamais le compte
   parent — alors la cliente peut obtenir la liste des clients de
   l'agence depuis son propre navigateur. Ce correctif ferme la porte
   par laquelle vous etes passe ; il ne verrouille pas la porte.

   La verification cote serveur est a faire dans server.js, sur chaque
   route qui lit req.query.agency.

   Usage :
     node outils/agence-fuite-vue-globale.js --essai
     node outils/agence-fuite-vue-globale.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'app.html');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}
function unique(src, aiguille, quoi) {
  const n = src.split(aiguille).length - 1;
  if (n !== 1) echec(`${quoi} : ${n} occurrence(s) au lieu d'une. app.html a change.`);
}

if (!fs.existsSync(CIBLE)) echec('public/app.html introuvable. Lancez depuis la racine du projet.');
let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('bh_agency_view_purge') !== -1) {
  console.log('\n  Le correctif est deja en place — rien a faire.\n');
  process.exit(0);
}

/* ── 1. L'intercepteur : ne jamais agreger pendant une impersonation ── */
const I_ANCIEN = "      if (typeof url === 'string' && localStorage.getItem('bh_agency_view') === 'all' && url.includes('/api/') && !url.includes('agency=')) {";
const I_NOUVEAU = "      /* bh_agency_view_purge : pendant l'impersonation d'un compte gere\n"
  + "         (lcc_agency_token present), on n'agrege JAMAIS. Sans cette garde,\n"
  + "         le drapeau laisse par la vue agence faisait reclamer agency=all\n"
  + "         avec le jeton du client gere — qui voyait alors les clients de\n"
  + "         l'agence. */\n"
  + "      var _impers = !!localStorage.getItem('lcc_agency_token');\n"
  + "      if (typeof url === 'string' && !_impers && localStorage.getItem('bh_agency_view') === 'all' && url.includes('/api/') && !url.includes('agency=')) {";
unique(src, I_ANCIEN, 'Intercepteur de fetch');
src = src.split(I_ANCIEN).join(I_NOUVEAU);

/* ── 2. La bascule vers un compte gere : effacer le drapeau ── */
const B_ANCIEN = `      localStorage.removeItem('lcc_settings_profile');
      localStorage.removeItem('lcc_properties_cache');
      window.location.reload();`;
const B_NOUVEAU = `      localStorage.removeItem('lcc_settings_profile');
      localStorage.removeItem('lcc_properties_cache');
      // La vue « tous les comptes » n'a aucun sens dans le compte d'un
      // client : sans cet oubli, il voyait les donnees de l'agence.
      localStorage.removeItem('bh_agency_view');
      window._agencyViewActive = false;
      window.location.reload();`;
unique(src, B_ANCIEN, 'Fin de switchAgencyAccount');
src = src.split(B_ANCIEN).join(B_NOUVEAU);

/* ── 3. Le retour au compte agence : meme nettoyage ── */
const S_ANCIEN = "  ['lcc_agency_token','lcc_managed_user','lcc_settings_profile','lcc_properties_cache','lcc_agency_permissions'].forEach(function(k){ localStorage.removeItem(k); });";
const S_NOUVEAU = "  ['lcc_agency_token','lcc_managed_user','lcc_settings_profile','lcc_properties_cache','lcc_agency_permissions','bh_agency_view'].forEach(function(k){ localStorage.removeItem(k); });";
unique(src, S_ANCIEN, 'exitAgencyMode');
src = src.split(S_ANCIEN).join(S_NOUVEAU);

/* ── 4. Au chargement : rattraper un etat incoherent ──
   Un onglet ouvert avant ce correctif, ou un retour arriere, peut
   presenter les deux etats a la fois. On tranche avant le premier appel. */
const C_ANCIEN = "  (function() {\n    var params = new URLSearchParams(window.location.search);\n    var impToken = params.get('impersonate_token');";
const C_NOUVEAU = "  /* bh_agency_view_purge : un compte gere actif et la vue agregee posee\n"
  + "     sont incompatibles. Cela arrive avec un onglet ouvert avant le\n"
  + "     correctif. On efface le drapeau avant le premier appel API. */\n"
  + "  (function() {\n"
  + "    if (localStorage.getItem('lcc_agency_token') && localStorage.getItem('bh_agency_view') === 'all') {\n"
  + "      localStorage.removeItem('bh_agency_view');\n"
  + "      console.warn('[AGENCY] vue globale desactivee : un compte gere est actif');\n"
  + "    }\n"
  + "  })();\n\n"
  + "  (function() {\n    var params = new URLSearchParams(window.location.search);\n    var impToken = params.get('impersonate_token');";
unique(src, C_ANCIEN, 'Bloc impersonate_token');
src = src.split(C_ANCIEN).join(C_NOUVEAU);

/* ---- Verifications ---- */
for (const [quoi, aiguille] of [
  ['la garde d\'impersonation', 'var _impers = !!localStorage.getItem(\'lcc_agency_token\');'],
  ['la garde dans la condition', '!_impers && localStorage.getItem(\'bh_agency_view\')'],
  ['le nettoyage a la bascule', "localStorage.removeItem('bh_agency_view');\n      window._agencyViewActive = false;"],
  ['le nettoyage au retour', "'lcc_agency_permissions','bh_agency_view'"],
  ['le rattrapage au chargement', "[AGENCY] vue globale desactivee"],
]) if (src.indexOf(aiguille) === -1) echec(`Verification : ${quoi} est absent du resultat.`);

if (src.split('bh_agency_view_purge').length - 1 !== 2) echec('Les marqueurs du correctif sont en nombre inattendu.');
/* Le drapeau doit rester lisible pour la vraie vue agence : on ne l'a pas supprime partout. */
if (src.indexOf("localStorage.setItem('bh_agency_view', mode)") === -1) {
  echec('setAgencyView ne pose plus le drapeau — la vue agence serait cassee.');
}

/* La page est un document HTML : on valide les scripts qu'on a touches
   en isolant le bloc de tete, pas tout le fichier. */
const tete = src.slice(0, src.indexOf('window.switchAgencyAccount') + 2000);
const scripts = tete.match(/<script>([\s\S]*?)<\/script>/g) || [];
if (!scripts.length) echec('Aucun bloc <script> trouve en tete de page.');
for (const s of scripts) {
  const corps = s.replace(/^<script>/, '').replace(/<\/script>$/, '');
  try { new Function(corps); }
  catch (e) { echec('Un script de tete n\'est plus valide — ' + e.message); }
}

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('bh_agency_view_purge') === -1) {
    echec('L\'ajout est absent apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  app.html : agency=all n\'est plus envoye pendant l\'impersonation d\'un compte.');
console.log('  bh_agency_view est efface a la bascule, au retour, et au chargement si incoherent.');
console.log('  La vraie vue agence (depuis le compte agence) continue de fonctionner.');
console.log('');
console.log('  A FAIRE ENSUITE — le serveur, qui est le vrai verrou :');
console.log('    grep -n "query.agency\\|agency=all\\|req.query.agency" server.js');
console.log('  Chaque route qui lit ce parametre doit verifier que le demandeur');
console.log('  gere effectivement des comptes, et n\'agreger QUE ceux-la.');
console.log('  Sinon la cliente peut ajouter ?agency=all elle-meme.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
