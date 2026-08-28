#!/usr/bin/env node
/* ============================================================
   outils/agence-expiration.js
   Le mode agence expire en silence
   ============================================================
   Cible : public/app.html

   ── TROIS DEFAUTS ENCHAINES ─────────────────────────────────────

   1. L'auto-refresh appelle une fonction qui n'existe pas encore.

        (function() {
          ...
          if (localStorage.getItem('lcc_managed_user')) {
            agencyRefreshToken();                       // <- ligne ~328
            setInterval(agencyRefreshToken, 6*3600*1000);
          }
        })();

        window.agencyRefreshToken = async function() { ... }   // <- ligne ~334

      L'affectation sur window n'est pas hoistee : quand l'IIFE
      s'execute, agencyRefreshToken vaut undefined. En impersonation on
      leve donc une ReferenceError — le refresh immediat echoue ET le
      setInterval n'est jamais pose. Le jeton agency_access, valable
      24 h, n'est jamais renouvele : il meurt.

   2. A l'expiration, l'interface ne dit rien. La branche 401/403
      appelle exitAgencyMode() sans argument, donc sans redirection :
      les cles sont nettoyees mais la page reste telle quelle, avec le
      nom du client affiche. On continue a croire qu'on travaille chez
      lui alors qu'on est revenu chez soi.

   3. Rien ne surveille l'expiration entre deux refresh. Un portable
      referme 24 h, un onglet laisse ouvert : au reveil le jeton est
      mort, chaque appel API repond 401, et l'ecran se vide sans
      explication.

   C'est la meme famille de bug que le jeton Face ID corrige juste
   avant : l'affichage du compte actif ne vient pas du jeton, mais de
   lcc_managed_user, qui survit a tout.

   ── LE CORRECTIF ────────────────────────────────────────────────
   1. L'appel a agencyRefreshToken est differe (setTimeout 0) : il part
      quand le script entier a fini d'etre evalue, donc la fonction
      existe. Le setInterval est pose dans le meme temps.
   2. Une verification d'expiration lit l'echeance inscrite dans le
      jeton lui-meme, au chargement puis chaque minute. Un jeton mort ou
      qui expire dans moins de deux minutes fait sortir du mode agence.
   3. La sortie est desormais explicite : un message nomme le compte
      quitte, et la page est rechargee pour qu'aucun ecran ne continue
      d'afficher des donnees du mauvais compte.

   Usage :
     node outils/agence-expiration.js --essai
     node outils/agence-expiration.js
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

if (src.indexOf('agencySortieExpiree') !== -1) {
  console.log('\n  Le correctif est deja en place — rien a faire.\n');
  process.exit(0);
}

/* ── 1. Sortie explicite + surveillance de l'echeance ──
   Pose juste avant la definition de agencyRefreshToken, donc apres
   l'IIFE : ces fonctions ne sont appelees que de facon differee. */
const A_DEF = '// ── Refresh token agence ──\nwindow.agencyRefreshToken = async function() {';
unique(src, A_DEF, 'Definition de agencyRefreshToken');

const BLOC = `// ── Sortie du mode agence quand le jeton n'est plus valable ──
/* L'interface affiche le compte actif d'apres lcc_managed_user, qui
   survit a l'expiration du jeton. Sans message ni rechargement, on
   continue donc de croire qu'on travaille chez le client alors qu'on
   est revenu sur son propre compte. */
window.agencySortieExpiree = function(raison) {
  var nom = '';
  try { nom = (JSON.parse(localStorage.getItem('lcc_managed_user') || '{}').name) || ''; } catch (e) {}
  var msg = nom
    ? 'Votre accès au compte ' + nom + ' a expiré. Retour à votre compte.'
    : 'Votre accès au compte géré a expiré. Retour à votre compte.';
  if (raison) console.warn('⚠️ [AGENCY] ' + raison);
  try {
    if (typeof showToast === 'function') showToast(msg);
    else if (typeof toast === 'function') toast(msg);
    else alert(msg);
  } catch (e) { try { alert(msg); } catch (e2) {} }
  // exitAgencyMode restaure le jeton de l'agence et nettoie les caches.
  // La redirection est indispensable : sans elle, la page en cours garde
  // a l'ecran les donnees chargees sous l'autre compte.
  try { exitAgencyMode('/app.html'); }
  catch (e) { try { exitAgencyMode(); } finally { window.location.href = '/app.html'; } }
};

/* Echeance lue dans le jeton lui-meme : c'est la seule source fiable.
   Le refresh toutes les 6 h ne voit pas un portable referme 24 h. */
window.agencyJetonExpire = function() {
  if (!localStorage.getItem('lcc_managed_user')) return false;
  var t = localStorage.getItem('lcc_token');
  if (!t) return true;
  try {
    var p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (!p || !p.exp) return false;               // pas d'echeance : on ne juge pas
    return (p.exp * 1000) - Date.now() < 120000;  // mort, ou dans moins de 2 min
  } catch (e) { return false; }                   // jeton illisible : on laisse le 401 trancher
};

window.agencyVeilleExpiration = function() {
  if (window.agencyJetonExpire()) window.agencySortieExpiree('jeton d\\'impersonation expire');
};

`;
src = src.split(A_DEF).join(BLOC + A_DEF);

/* ── 2. La branche 401/403 : prevenir, pas seulement nettoyer ── */
const A_401 = `    } else if (res.status === 403 || res.status === 401) {
      console.warn('⚠️ [AGENCY] Token expiré ou délégation révoquée — retour au compte principal');
      exitAgencyMode();
    }`;
unique(src, A_401, 'Branche 401/403 du refresh');
src = src.split(A_401).join(`    } else if (res.status === 403 || res.status === 401) {
      // Le jeton est mort ou la delegation a ete revoquee : on le DIT et on
      // recharge, au lieu de nettoyer en silence en laissant l'ecran mentir.
      agencySortieExpiree('refresh refuse (' + res.status + ')');
    }`);

/* ── 3. L'auto-refresh : differer l'appel et brancher la veille ── */
const A_AUTO = `  // ── Auto-refresh token agence toutes les 6h ──
  if (localStorage.getItem('lcc_managed_user')) {
    agencyRefreshToken(); // refresh immédiat au chargement (vérifie validité)
    setInterval(agencyRefreshToken, 6 * 60 * 60 * 1000);
  }`;
unique(src, A_AUTO, 'Bloc d\'auto-refresh');
src = src.split(A_AUTO).join(`  // ── Auto-refresh token agence toutes les 6h ──
  /* Appel DIFFERE : window.agencyRefreshToken est defini plus bas dans ce
     meme script, et une affectation sur window n'est pas hoistee. L'appeler
     ici levait une ReferenceError — le refresh immediat echouait et le
     setInterval n'etait jamais pose, donc le jeton mourait a 24 h. */
  if (localStorage.getItem('lcc_managed_user')) {
    setTimeout(function() {
      if (typeof agencyRefreshToken !== 'function') {
        console.warn('⚠️ [AGENCY] agencyRefreshToken indisponible');
        return;
      }
      // La veille passe d'abord : inutile de demander un refresh avec un
      // jeton deja mort, la reponse serait un 401 de plus.
      if (typeof agencyVeilleExpiration === 'function') agencyVeilleExpiration();
      agencyRefreshToken();
      setInterval(agencyRefreshToken, 6 * 60 * 60 * 1000);
      if (typeof agencyVeilleExpiration === 'function') setInterval(agencyVeilleExpiration, 60000);
    }, 0);
  }`);

/* ---- Verifications ---- */
for (const [quoi, aiguille] of [
  ['la sortie explicite', 'window.agencySortieExpiree = function(raison) {'],
  ['la lecture de l\'echeance', 'window.agencyJetonExpire = function() {'],
  ['la veille', 'window.agencyVeilleExpiration = function() {'],
  ['l\'appel differe', 'setTimeout(function() {'],
  ['la veille chaque minute', 'setInterval(agencyVeilleExpiration, 60000)'],
  ['le message a l\'expiration', 'a expiré. Retour à votre compte.'],
]) if (src.indexOf(aiguille) === -1) echec(`Verification : ${quoi} est absent du resultat.`);

if (src.indexOf('      exitAgencyMode();\n    }') !== -1) echec('L\'ancienne sortie silencieuse subsiste.');
if (src.split('window.agencySortieExpiree =').length - 1 !== 1) echec('La sortie est definie deux fois.');
/* Les fonctions doivent etre definies APRES l'IIFE qui les utilise en differe,
   mais AVANT agencyRefreshToken qui les appelle. */
if (src.indexOf('window.agencySortieExpiree') > src.indexOf('window.agencyRefreshToken = async function')) {
  echec('agencySortieExpiree est definie apres agencyRefreshToken.');
}

/* Validation des scripts de tete. */
const tete = src.slice(0, src.indexOf('window.applyAgencyPermissions') + 200);
const scripts = tete.match(/<script>([\s\S]*?)<\/script>/g) || [];
if (!scripts.length) echec('Aucun bloc <script> trouve en tete de page.');
for (const s of scripts) {
  const corps = s.replace(/^<script>/, '').replace(/<\/script>$/, '');
  try { new Function(corps); }
  catch (e) { echec('Un script de tete n\'est plus valide — ' + e.message); }
}

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('agencySortieExpiree') === -1) {
    echec('L\'ajout est absent apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  app.html :');
console.log('   · l\'auto-refresh du jeton agence fonctionne enfin (appel differe) —');
console.log('     il levait une ReferenceError, donc le jeton n\'etait jamais renouvele ;');
console.log('   · l\'echeance du jeton est surveillee chaque minute, pas seulement');
console.log('     toutes les 6 h : un portable referme 24 h est desormais vu ;');
console.log('   · l\'expiration affiche un message nommant le compte quitte et recharge,');
console.log('     au lieu de nettoyer en silence en laissant l\'ecran mentir.');
console.log('');
console.log('  A verifier : basculez sur un compte gere, puis dans la console');
console.log('    localStorage.setItem(\'lcc_token\', \'x.eyJleHAiOjF9.y\')');
console.log('  (jeton dont l\'echeance est 1970) — vous devez voir le message et');
console.log('  revenir sur votre compte en moins d\'une minute.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
