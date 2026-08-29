#!/usr/bin/env node
/* ============================================================
   outils/channex-rattachement-choisi.js
   Le rattachement a l'etablissement voisin devient un choix
   ============================================================
   Cible : public/js/bh-ota-connect.js

   ── CE QUI SE PASSAIT ───────────────────────────────────────────
   « La longere numero 3 » a ete connectee a Booking. Elle est apparue
   sur Airbnb, ou elle n'a jamais ete inscrite.

   La chaine, verifiee bout a bout :

   1. bh-ota-connect.js cherche un « voisin » — un logement DEJA connecte
      portant la MEME ADRESSE, apres normalisation (voisinConnecte).
   2. S'il en trouve un, il envoie channex_property_id au serveur sans
      rien demander :

          var voisin = voisinConnecte(pid);
          var corps = { property_id: pid };
          if (voisin) corps.channex_property_id = voisin.channexPropertyId;

      L'utilisateur l'apprend apres coup, par un message :
      « Rattache au meme etablissement que … ».
   3. Le serveur appelle alors addRoomTypeToProperty : le logement devient
      un room type de l'etablissement Channex du voisin.
   4. Channex mappe ce nouveau room type sur TOUS les canaux deja branches
      sur cet etablissement. Le voisin etait sur Airbnb et Booking : le
      nouveau logement s'y retrouve aussi.

   L'etape 4 n'est pas de notre fait — le code ne touche jamais aux
   mappings (aucune occurrence de « mapping » dans channex.js). C'est le
   comportement de Channex, et il est logique : au sein d'un meme
   etablissement, toutes les chambres sont vendues sur les memes canaux.

   Le probleme est donc a l'etape 1-2 : deux gites a la meme adresse ne
   sont pas deux chambres d'un meme hotel. Une adresse commune ne suffit
   pas a le decider — et surtout, ce n'est pas au logiciel de le decider.

   Un ecran de choix existe pourtant deja dans settings.js
   (_showPropertyTypeScreen : « Logement independant » / « Partie d'un
   immeuble », avec le conseil « dans le doute, choisissez independant »).
   Ce parcours-ci le court-circuite.

   ── CE QUE FAIT CE CORRECTIF ────────────────────────────────────
   Quand un voisin est detecte, une question est posee :

     · « Ce sont deux logements distincts » — RECOMMANDE, et c'est le cas
       de deux gites, deux appartements, deux maisons loues separement.
       Chacun garde son etablissement, ses plateformes, ses tarifs.
     · « Ce sont deux unites du meme etablissement » — a ne choisir que si
       les annonces partagent deja le meme identifiant hotelier. Le texte
       previent que les plateformes du voisin seront appliquees.
     · Annuler.

   Fermer la fenetre par la croix equivaut a annuler : une veille surveille
   le retrait de la modale, sans quoi la connexion resterait suspendue
   indefiniment, sans message.

   ── CE QUI N'EST PAS TOUCHE ─────────────────────────────────────
   · voisinConnecte : la detection reste utile, c'est son automatisme qui
     ne l'etait pas.
   · Le serveur : aucune modification. Il rattache si on le lui demande,
     ce qui est correct.
   · Les logements deja rattaches : ils le restent. Pour les separer, il
     faut les deconnecter puis les reconnecter en « logements distincts »,
     et retirer a la main le mapping en trop dans Channex
     (Channels > Airbnb > Mappings).

   Usage :
     node outils/channex-rattachement-choisi.js --essai
     node outils/channex-rattachement-choisi.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'js', 'bh-ota-connect.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('public/js/bh-ota-connect.js introuvable. Lancez depuis la racine du projet.');
let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('demanderRattachement') !== -1) {
  console.log('\n  Le correctif est deja en place — rien a faire.\n');
  process.exit(0);
}

function unique(aiguille, quoi) {
  const n = src.split(aiguille).length - 1;
  if (n !== 1) echec(quoi + ' : ' + n + ' occurrence(s) au lieu d\'une. Le fichier a change.');
}

/* ── 1. Poser la question au lieu de rattacher ── */
const A = '    if (!dejaConnecte) {\n'
  + '      var voisin = voisinConnecte(pid);\n'
  + '      var corps = { property_id: pid };\n'
  + '      if (voisin) corps.channex_property_id = voisin.channexPropertyId || voisin.channex_property_id;';
unique(A, 'Rattachement automatique au voisin');

const AN = '    if (!dejaConnecte) {\n'
  + '      var voisin = voisinConnecte(pid);\n\n'
  + '      /* Le rattachement n\'est plus automatique. Voir demanderRattachement :\n'
  + '         partager une adresse ne veut pas dire partager un etablissement, et\n'
  + '         le rattachement embarque le logement sur toutes les plateformes du\n'
  + '         voisin. */\n'
  + '      var rattacher = false;\n'
  + '      if (voisin) {\n'
  + '        rattacher = await demanderRattachement(modal, moi, voisin);\n'
  + '        if (rattacher === null) { if (modal.isConnected) modal.remove(); return; }\n'
  + '        modal.innerHTML = carte(420,\n'
  + '          \'<div style="padding:40px;text-align:center;">\' +\n'
  + '          \'<div style="width:22px;height:22px;margin:0 auto;border:2px solid \' + V.ligne + \';border-top-color:\' + V.vert +\n'
  + '          \';border-radius:50%;animation:bhspin .8s linear infinite;"></div>\' +\n'
  + '          \'<div style="margin-top:14px;font-size:13px;color:\' + V.t3 + \';">Préparation de la connexion…</div></div>\');\n'
  + '      }\n\n'
  + '      var corps = { property_id: pid };\n'
  + '      if (voisin && rattacher) corps.channex_property_id = voisin.channexPropertyId || voisin.channex_property_id;';
src = src.split(A).join(AN);

/* ── 2. Le message de confirmation ne doit s'afficher que si on a rattache ── */
const T = "        if (voisin) toast('Rattaché au même établissement que ' + (voisin.name || 'votre autre logement') + '.', 'success');";
unique(T, 'Message de rattachement');
src = src.split(T).join("        if (voisin && rattacher) toast('Rattaché au même établissement que ' + (voisin.name || 'votre autre logement') + '.', 'success');");

/* ── 3. L'ecran de choix ── */
const ANCRE_FN = '  async function lancer(modal, pid, pname, code) {';
unique(ANCRE_FN, 'Declaration de lancer');
const FONCTION = "  /* ── Rattacher a l'etablissement voisin ? On demande. ──────────────────\n     Deux logements a la meme adresse ne sont pas forcement deux chambres du\n     meme etablissement. Jusqu'ici le rattachement etait AUTOMATIQUE des que\n     l'adresse coincidait, et l'utilisateur l'apprenait par un message une\n     fois le fait accompli.\n\n     Les consequences sont lourdes et invisibles : les deux logements\n     partagent alors une seule property Channex, et Channex mappe le nouveau\n     room type sur TOUS les canaux deja branches sur cette property. Un gite\n     connecte a Booking seul se retrouve ainsi annonce sur Airbnb.\n\n     Le defaut est desormais « logements independants » — le cas courant.\n     Le rattachement reste possible, mais il se choisit. */\n  function demanderRattachement(modal, moi, voisin) {\n    return new Promise(function (resoudre) {\n      var nomVoisin = esc(voisin.name || 'votre autre logement');\n      var nomMoi = esc((moi && moi.name) || 'ce logement');\n      var adresse = esc((moi && moi.address) || '');\n\n      var option = function (id, titre, texte, recommande) {\n        return '<button type=\"button\" id=\"' + id + '\" style=\"width:100%;text-align:left;cursor:pointer;' +\n          'background:#fff;border:1.5px solid ' + (recommande ? V.vertFilet : V.ligne) + ';border-radius:12px;' +\n          'padding:14px 16px;margin-bottom:10px;font-family:inherit;display:block;\">' +\n          '<div style=\"display:flex;align-items:center;gap:8px;\">' +\n          '<span style=\"font-size:14px;font-weight:600;color:' + V.encre + ';\">' + titre + '</span>' +\n          (recommande ? '<span style=\"font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;' +\n            'color:' + V.vert + ';background:' + V.vertPale + ';border-radius:99px;padding:3px 9px;\">Recommandé</span>' : '') +\n          '</div>' +\n          '<div style=\"margin-top:5px;font-size:12.5px;line-height:1.5;color:' + V.t2 + ';\">' + texte + '</div>' +\n          '</button>';\n      };\n\n      modal.innerHTML = carte(500,\n        entete('Connexion aux plateformes', 'Un autre logement a la même adresse',\n               adresse || (nomMoi + ' · ' + nomVoisin)) +\n        '<div style=\"padding:20px 24px 22px;\">' +\n        '<div style=\"font-size:13px;line-height:1.55;color:' + V.t2 + ';margin-bottom:16px;\">' +\n        '<strong style=\"color:' + V.encre + ';\">' + nomVoisin + '</strong> est déjà connecté à cette adresse. ' +\n        'Comment faut-il traiter <strong style=\"color:' + V.encre + ';\">' + nomMoi + '</strong> ?' +\n        '</div>' +\n        option('bh-rat-independant', 'Ce sont deux logements distincts',\n               'Chacun garde son propre établissement, ses plateformes et ses tarifs. ' +\n               'C\\'est le cas de deux gîtes, deux appartements ou deux maisons loués séparément.', true) +\n        option('bh-rat-immeuble', 'Ce sont deux unités du même établissement',\n               'Les deux partagent un seul établissement chez les plateformes. ' +\n               'À ne choisir que si vos annonces partagent déjà le même identifiant hôtelier ' +\n               '— sinon les plateformes du voisin seront appliquées à ce logement.', false) +\n        '<div style=\"text-align:center;margin-top:6px;\">' +\n        '<button type=\"button\" id=\"bh-rat-annuler\" style=\"background:none;border:none;cursor:pointer;' +\n        'font-family:inherit;font-size:12.5px;color:' + V.t4 + ';padding:8px 12px;\">Annuler</button>' +\n        '</div></div>');\n\n      var fini = false;\n      var repondre = function (valeur) {\n        if (fini) return;\n        fini = true;\n        clearInterval(veille);\n        resoudre(valeur);\n      };\n\n      /* Si la modale est fermee par la croix de l'en-tete, la promesse doit\n         se resoudre quand meme : sans cela, la connexion resterait suspendue\n         sans que rien ne l'indique. */\n      var veille = setInterval(function () {\n        if (!modal.isConnected) repondre(null);\n      }, 300);\n\n      var brancher = function (id, valeur) {\n        var b = modal.querySelector('#' + id);\n        if (b) b.onclick = function () { repondre(valeur); };\n      };\n      brancher('bh-rat-independant', false);\n      brancher('bh-rat-immeuble', true);\n      brancher('bh-rat-annuler', null);\n    });\n  }\n\n";
src = src.split(ANCRE_FN).join(FONCTION + ANCRE_FN);

/* ---- Verifications ---- */
try { new Function(src); }
catch (e) { echec('bh-ota-connect.js n\'est plus du JavaScript valide — ' + e.message); }

for (const [quoi, aiguille] of [
  ['l\'ecran de choix', 'function demanderRattachement(modal, moi, voisin)'],
  ['son appel', 'await demanderRattachement(modal, moi, voisin)'],
  ['le rattachement conditionnel', 'if (voisin && rattacher) corps.channex_property_id'],
  ['l\'option recommandee', 'Ce sont deux logements distincts'],
  ['l\'avertissement du rattachement', 'les plateformes du voisin seront appliquées'],
  ['la veille sur la fermeture', 'if (!modal.isConnected) repondre(null);'],
]) if (src.indexOf(aiguille) === -1) echec('Verification : ' + quoi + ' est absent du resultat.');

if (src.indexOf('if (voisin) corps.channex_property_id') !== -1) {
  echec('Le rattachement automatique subsiste.');
}
if (src.split('function demanderRattachement').length - 1 !== 1) echec('L\'ecran a ete insere plusieurs fois.');
/* La detection du voisin reste en place : c'est son automatisme qu'on retire. */
if (src.indexOf('function voisinConnecte(propertyId)') === -1) {
  echec('La detection du voisin a ete perdue.');
}

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('demanderRattachement') === -1) {
    echec('L\'ajout est absent apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Connecter un logement dont l\'adresse existe deja pose desormais la');
console.log('  question, au lieu de rattacher d\'office a l\'etablissement du voisin.');
console.log('  Defaut recommande : deux logements distincts.');
console.log('');
console.log('  Ensuite : ⌘⇧R sur Boostinghost.');
console.log('');
console.log('  Pour La longere numero 3, deja rattachee, ce script ne change rien :');
console.log('   1. retirez le mapping Airbnb dans Channex (Channels > Airbnb > Mappings) ;');
console.log('   2. ou, pour la separer vraiment, deconnectez-la puis reconnectez-la en');
console.log('      choisissant « deux logements distincts ».\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
