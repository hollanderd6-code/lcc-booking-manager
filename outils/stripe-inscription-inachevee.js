#!/usr/bin/env node
/* ============================================================
   outils/stripe-inscription-inachevee.js
   Dire au proprietaire que son compte Stripe ne peut pas encaisser
   ============================================================
   Cibles : server.js                    (GET /api/stripe/status)
            public/settings-account.html (affichage du statut)

   Complement de outils/stripe-repli-compte-inactif.js, qui doit avoir
   ete lance : celui-la evite que le paiement echoue, celui-ci previent
   le proprietaire que la situation n'est pas normale.

   ── LE PROBLEME ─────────────────────────────────────────────────
   L'ecran Reglages > Compte affichait « Compte Stripe connecte », en
   vert, a des proprietaires dont le compte ne pouvait rien encaisser.

   Deux causes, l'une plus vicieuse que l'autre :

   1. La route calculait
        connected = charges_enabled && details_submitted
      sans regarder le NOM D'ENTREPRISE. Or Stripe refuse d'ouvrir une
      page Checkout tant qu'il est absent : « In order to use Checkout,
      you must set an account or business name ». Un compte pouvait donc
      etre « connecte » en vert et rejeter tous les paiements.

   2. Quand connected valait false, l'ecran disait « Aucun compte Stripe
      connecte » — alors qu'un compte EXISTE, seulement inachevé. Le
      proprietaire n'avait aucune raison de penser qu'il devait le
      terminer.

   Constate en production : cinq comptes connectes sont dans cet etat
   (inscription commencee, jamais finie), et des dizaines de cautions
   echouaient en boucle sans que personne ne soit averti.

   ── CE QUE FAIT CE CORRECTIF ────────────────────────────────────
   Cote serveur, la route renvoie l'etat reel :
     · canCharge  — le compte peut-il vraiment encaisser
     · blocages   — ce qui manque, en clair, pret a afficher
     · businessName

   Cote ecran, trois etats au lieu de deux :
     · vert   — le compte encaisse
     · orange — « Inscription a terminer — nom de l'entreprise absent »,
                avec un bandeau qui explique la consequence : les
                paiements sont encaisses par Boostinghost et lui seront
                reverses. Le bouton devient « Terminer mon inscription ».
     · gris   — aucun compte connecte (le cas d'origine)

   Le bandeau dit la consequence avant l'action : un proprietaire qui ne
   comprend pas ce qu'il risque ne fait rien.

   ── CE QUI N'EST PAS TOUCHE ─────────────────────────────────────
   · Le champ « connected » garde son sens : d'autres appels s'en
     servent peut-etre. On ajoute, on ne remplace pas.
   · La logique d'encaissement : c'est l'autre script qui s'en charge.
   · Le compte plateforme Boostinghost : rien ne le concerne ici.

   Usage :
     node outils/stripe-inscription-inachevee.js --essai
     node outils/stripe-inscription-inachevee.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const SRV = path.join(process.cwd(), 'server.js');
const HTML = path.join(process.cwd(), 'public', 'settings-account.html');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

for (const f of [SRV, HTML]) {
  if (!fs.existsSync(f)) echec(f + ' introuvable. Lancez depuis la racine du projet.');
}

let srv = fs.readFileSync(SRV, 'utf8');
let html = fs.readFileSync(HTML, 'utf8');

if (srv.indexOf('canCharge') !== -1 && html.indexOf('afficherAvertissementStripe') !== -1) {
  console.log('\n  Le correctif est deja en place — rien a faire.\n');
  process.exit(0);
}

const P = {"SRV_A":"      const connected = !!(account.charges_enabled && account.details_submitted);\n\n      return res.json({\n        connected,\n        accountId: user.stripeAccountId,\n        chargesEnabled: account.charges_enabled,\n        payoutsEnabled: account.payouts_enabled,\n        detailsSubmitted: account.details_submitted\n      });","SRV_B":"      /* « connected » ne suffit pas a savoir si le compte peut encaisser.\n         Stripe refuse d'ouvrir une page Checkout tant qu'aucun nom\n         d'entreprise n'est renseigne — un compte peut donc avoir\n         charges_enabled ET details_submitted, et faire echouer tous les\n         paiements. C'est ce qui s'est produit : des dizaines de cautions\n         rejetees avec « you must set an account or business name », sans\n         que l'ecran de reglages ne montre autre chose qu'un vert rassurant. */\n      const businessName = (account.business_profile && account.business_profile.name)\n        || (account.settings && account.settings.dashboard && account.settings.dashboard.display_name)\n        || null;\n      const connected = !!(account.charges_enabled && account.details_submitted);\n      const canCharge = connected && !!businessName;\n\n      /* Ce qui manque, en clair, pour l'afficher tel quel. */\n      const blocages = [];\n      if (!account.details_submitted) blocages.push('inscription non terminée');\n      if (!account.charges_enabled) blocages.push('paiements non activés par Stripe');\n      if (!businessName) blocages.push(\"nom de l'entreprise absent\");\n\n      return res.json({\n        connected,\n        canCharge,\n        blocages,\n        businessName,\n        accountId: user.stripeAccountId,\n        chargesEnabled: account.charges_enabled,\n        payoutsEnabled: account.payouts_enabled,\n        detailsSubmitted: account.details_submitted\n      });","SRV_C":"      return res.json({\n        connected: false,\n        error: 'Impossible de récupérer le compte Stripe'\n      });","SRV_D":"      return res.json({\n        connected: false,\n        canCharge: false,\n        blocages: ['compte introuvable chez Stripe'],\n        accountId: user.stripeAccountId,\n        error: 'Impossible de récupérer le compte Stripe'\n      });","FRONT_A":"          if (data.connected) {\n            stripeStatusEl.textContent = 'Compte Stripe connecté';\n            stripeStatusEl.className   = 'pill-status stripe-pill-ok';\n\n            if (manageStripeBtn) {\n              manageStripeBtn.style.display = 'inline-flex';\n            }\n            if (connectStripeBtn) {\n              connectStripeBtn.querySelector('span').textContent =\n                'Reconnecter / compléter mon compte Stripe';\n            }\n          } else {","FRONT_B":"          /* Trois etats, et non deux. Un compte « connecte » peut etre\n             incapable d'encaisser : sans nom d'entreprise, Stripe refuse\n             toute page de paiement. Afficher un vert rassurant dans ce cas\n             laissait le proprietaire ignorer que ses cautions echouaient. */\n          if (data.connected && data.canCharge === false) {\n            var manque = (data.blocages && data.blocages.length)\n              ? data.blocages.join(', ')\n              : 'configuration incomplète';\n            stripeStatusEl.innerHTML =\n              '<i class=\"fas fa-triangle-exclamation\"></i> Inscription à terminer — ' + manque;\n            stripeStatusEl.className = 'pill-status stripe-pill-warn';\n            afficherAvertissementStripe(manque);\n\n            if (manageStripeBtn) manageStripeBtn.style.display = 'inline-flex';\n            if (connectStripeBtn) {\n              connectStripeBtn.querySelector('span').textContent =\n                'Terminer mon inscription Stripe';\n            }\n          } else if (data.connected) {\n            stripeStatusEl.textContent = 'Compte Stripe connecté';\n            stripeStatusEl.className   = 'pill-status stripe-pill-ok';\n            afficherAvertissementStripe(null);\n\n            if (manageStripeBtn) {\n              manageStripeBtn.style.display = 'inline-flex';\n            }\n            if (connectStripeBtn) {\n              connectStripeBtn.querySelector('span').textContent =\n                'Reconnecter / compléter mon compte Stripe';\n            }\n          } else {","FRONT_C":"            stripeStatusEl.textContent = 'Aucun compte Stripe connecté';\n            stripeStatusEl.className   = 'pill-status stripe-pill-warn';","FRONT_D":"            /* Aucun compte, ou compte introuvable : dans les deux cas le\n               proprietaire doit agir, mais le message differe. */\n            stripeStatusEl.textContent = (data.blocages && data.blocages.length)\n              ? 'Compte Stripe indisponible — ' + data.blocages.join(', ')\n              : 'Aucun compte Stripe connecté';\n            stripeStatusEl.className   = 'pill-status stripe-pill-warn';\n            afficherAvertissementStripe(\n              (data.blocages && data.blocages.length) ? data.blocages.join(', ') : null);","FRONT_FN":"      /* Un bandeau sous la pastille : la pastille est trop courte pour dire\n         ce qu'il faut faire, et un proprietaire qui ne comprend pas ne fait\n         rien. Le bandeau nomme la consequence — les paiements arrivent chez\n         Boostinghost et devront lui etre reverses — puis l'action. */\n      function afficherAvertissementStripe(raison) {\n        var id = 'bh-stripe-alerte';\n        var vieux = document.getElementById(id);\n        if (!raison) { if (vieux) vieux.remove(); return; }\n        if (vieux) vieux.remove();\n\n        var socle = stripeStatusEl && stripeStatusEl.parentElement;\n        if (!socle || !socle.parentElement) return;\n\n        var el = document.createElement('div');\n        el.id = id;\n        el.style.cssText = 'margin:10px 0 14px;padding:12px 14px;border-radius:10px;' +\n          'background:#FFF8E7;border:1px solid #F0C674;font-size:13px;line-height:1.55;color:#6B4E12;';\n        el.innerHTML =\n          '<strong>Votre compte Stripe ne peut pas encore encaisser</strong> (' + raison + ').<br>' +\n          'En attendant, les paiements et cautions de vos logements sont encaissés par ' +\n          'Boostinghost et vous seront reversés. Terminez votre inscription pour les ' +\n          'recevoir directement.';\n        socle.parentElement.insertBefore(el, socle.nextSibling);\n      }\n\n"};

function remplacer(source, avant, apres, quoi) {
  const n = source.split(avant).length - 1;
  if (n !== 1) echec(quoi + ' : ' + n + ' occurrence(s) au lieu d\'une. Le fichier a change.');
  return source.split(avant).join(apres);
}

/* ── 1. La route dit l'etat reel ── */
srv = remplacer(srv, P.SRV_A, P.SRV_B, 'Reponse de /api/stripe/status');
srv = remplacer(srv, P.SRV_C, P.SRV_D, 'Branche d\'erreur de /api/stripe/status');

/* ── 2. L'ecran montre trois etats ──
   L'ordre compte : FRONT_C se trouve dans la branche « else » que
   FRONT_B conserve, il reste donc unique apres la premiere substitution. */
html = remplacer(html, P.FRONT_A, P.FRONT_B, 'Affichage du statut Stripe');
html = remplacer(html, P.FRONT_C, P.FRONT_D, 'Branche « aucun compte »');
html = remplacer(html, '      async function refreshStripeStatus() {',
  P.FRONT_FN + '      async function refreshStripeStatus() {', 'Declaration de refreshStripeStatus');

/* ---- Verifications ---- */
try { new Function(srv); }
catch (e) { echec('server.js n\'est plus du JavaScript valide — ' + e.message); }

const blocs = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
let trouve = false;
for (const b of blocs) {
  const corps = b.replace(/^<script>/, '').replace(/<\/script>$/, '');
  if (corps.indexOf('refreshStripeStatus') !== -1) trouve = true;
  try { new Function(corps); }
  catch (e) { echec('Un script de settings-account.html n\'est plus valide — ' + e.message); }
}
if (!trouve) echec('Le bloc contenant refreshStripeStatus est introuvable apres modification.');

for (const [quoi, aiguille, ou] of [
  ['le calcul canCharge', 'const canCharge = connected && !!businessName;', srv],
  ['la liste des blocages', "blocages.push(\"nom de l'entreprise absent\")", srv],
  ['le nom d\'entreprise', 'const businessName =', srv],
  ['l\'etat intermediaire', 'data.canCharge === false', html],
  ['le bouton d\'action', 'Terminer mon inscription Stripe', html],
  ['le bandeau', 'function afficherAvertissementStripe(raison)', html],
  ['la consequence expliquee', 'vous seront reversés', html],
]) if (ou.indexOf(aiguille) === -1) echec('Verification : ' + quoi + ' est absent du resultat.');

if (html.split('function afficherAvertissementStripe(raison)').length - 1 !== 1) {
  echec('Le bandeau est defini plusieurs fois.');
}
/* « connected » doit rester renvoye : d'autres appels peuvent s'en servir. */
if (srv.indexOf('        connected,\n        canCharge,') === -1) {
  echec('Le champ « connected » a disparu de la reponse.');
}

if (!ESSAI) {
  fs.writeFileSync(SRV, srv, 'utf8');
  fs.writeFileSync(HTML, html, 'utf8');
  if (fs.readFileSync(SRV, 'utf8').indexOf('canCharge') === -1
      || fs.readFileSync(HTML, 'utf8').indexOf('afficherAvertissementStripe') === -1) {
    echec('L\'ajout est absent apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  /api/stripe/status renvoie canCharge, blocages et businessName.');
console.log('  Reglages > Compte affiche trois etats au lieu de deux, et un bandeau');
console.log('  explique que les paiements sont encaisses par Boostinghost en attendant.');
console.log('');
console.log('  Redemarrez le serveur, puis ⌘⇧R sur la page Reglages > Compte.');
console.log('');
console.log('  Sur un compte sain : « Compte Stripe connecte », en vert, sans bandeau.');
console.log('  Sur un compte inacheve : « Inscription a terminer — … » en orange.');
console.log('');
console.log('  Les cinq comptes concernes en production :');
console.log('    alafermeasnieres@gmail.com, lothteto@gmail.com, jeanclaudegoche@gmail.com,');
console.log('    et deux adresses a vous. Ils verront desormais le message en se');
console.log('    connectant — un mot de votre part accelererait les choses.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
