#!/usr/bin/env node
/* ============================================================
   outils/question-immeuble.js
   Nommer la consequence, pas seulement poser la question
   ============================================================
   Cible : public/js/bh-ota-connect.js  (demanderRattachement)

   Suite de outils/channex-rattachement-choisi.js, qui doit avoir ete
   lance : il a rendu le rattachement explicite. Celui-ci rend sa
   consequence comprehensible. C'est l'etat 2b de la maquette.

   ── CE QUI MANQUAIT ─────────────────────────────────────────────
   L'ecran actuel dit : « sinon les plateformes du voisin seront
   appliquees a ce logement ». C'est exact et cela ne parle a personne.

   Vous-meme, en connaissant le systeme, avez mis plusieurs heures a
   comprendre pourquoi La longere n° 3 apparaissait sur Airbnb. Un
   client n'aurait jamais fait le lien.

   ── CE QUE FAIT CE CORRECTIF ────────────────────────────────────
   L'avertissement nomme les plateformes REELLES du voisin, lues via
   /api/channex/connected-channels :

     « Attention : Longere n° 3 sera aussi mise en vente sur Airbnb et
       Booking.com, ou Longere n° 2 est deja presente. »

   Il ne s'affiche que s'il y a quelque chose a perdre : un voisin sans
   plateforme connectee ne fait courir aucun risque, et un avertissement
   inutile use la credibilite des autres.

   L'ecran est repris pour aller avec :
     · le titre pose la situation (« X partage son adresse avec Y »)
       au lieu d'un intitule generique ;
     · « Le plus courant » remplace « Recommande » — c'est un fait
       observable, pas un avis ;
     · les libelles parlent de gites et d'hotels, pas d'etablissements
       et d'identifiants hoteliers.

   ── UN DETAIL QUI COMPTE ────────────────────────────────────────
   L'ecran s'affiche IMMEDIATEMENT, sans attendre la liste des
   plateformes, puis s'enrichit quand elle arrive. Faire patienter
   devant un ecran vide pour un avertissement conditionnel serait payer
   le reseau au prix fort.

   ── PRUDENCE ────────────────────────────────────────────────────
   · Si la lecture des plateformes echoue, l'avertissement est omis
     plutot qu'invente : mieux vaut general que faux.
   · La fermeture par la croix vaut toujours annulation.
   · La fonction appelante n'est pas touchee.

   Usage :
     node outils/question-immeuble.js --essai
     node outils/question-immeuble.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'js', 'bh-ota-connect.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('public/js/bh-ota-connect.js introuvable. Lancez depuis la racine du projet.');
let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('plateformesDuVoisin') !== -1) {
  console.log('\n  Le correctif est deja en place — rien a faire.\n');
  process.exit(0);
}
if (src.indexOf('function demanderRattachement') === -1) {
  echec('demanderRattachement est introuvable : lancez d\'abord outils/channex-rattachement-choisi.js.');
}

const ANCIEN = "  function demanderRattachement(modal, moi, voisin) {\n    return new Promise(function (resoudre) {\n      var nomVoisin = esc(voisin.name || 'votre autre logement');\n      var nomMoi = esc((moi && moi.name) || 'ce logement');\n      var adresse = esc((moi && moi.address) || '');\n\n      var option = function (id, titre, texte, recommande) {\n        return '<button type=\"button\" id=\"' + id + '\" style=\"width:100%;text-align:left;cursor:pointer;' +\n          'background:#fff;border:1.5px solid ' + (recommande ? V.vertFilet : V.ligne) + ';border-radius:12px;' +\n          'padding:14px 16px;margin-bottom:10px;font-family:inherit;display:block;\">' +\n          '<div style=\"display:flex;align-items:center;gap:8px;\">' +\n          '<span style=\"font-size:14px;font-weight:600;color:' + V.encre + ';\">' + titre + '</span>' +\n          (recommande ? '<span style=\"font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;' +\n            'color:' + V.vert + ';background:' + V.vertPale + ';border-radius:99px;padding:3px 9px;\">Recommandé</span>' : '') +\n          '</div>' +\n          '<div style=\"margin-top:5px;font-size:12.5px;line-height:1.5;color:' + V.t2 + ';\">' + texte + '</div>' +\n          '</button>';\n      };\n\n      modal.innerHTML = carte(500,\n        entete('Connexion aux plateformes', 'Un autre logement a la même adresse',\n               adresse || (nomMoi + ' · ' + nomVoisin)) +\n        '<div style=\"padding:20px 24px 22px;\">' +\n        '<div style=\"font-size:13px;line-height:1.55;color:' + V.t2 + ';margin-bottom:16px;\">' +\n        '<strong style=\"color:' + V.encre + ';\">' + nomVoisin + '</strong> est déjà connecté à cette adresse. ' +\n        'Comment faut-il traiter <strong style=\"color:' + V.encre + ';\">' + nomMoi + '</strong> ?' +\n        '</div>' +\n        option('bh-rat-independant', 'Ce sont deux logements distincts',\n               'Chacun garde son propre établissement, ses plateformes et ses tarifs. ' +\n               'C\\'est le cas de deux gîtes, deux appartements ou deux maisons loués séparément.', true) +\n        option('bh-rat-immeuble', 'Ce sont deux unités du même établissement',\n               'Les deux partagent un seul établissement chez les plateformes. ' +\n               'À ne choisir que si vos annonces partagent déjà le même identifiant hôtelier ' +\n               '— sinon les plateformes du voisin seront appliquées à ce logement.', false) +\n        '<div style=\"text-align:center;margin-top:6px;\">' +\n        '<button type=\"button\" id=\"bh-rat-annuler\" style=\"background:none;border:none;cursor:pointer;' +\n        'font-family:inherit;font-size:12.5px;color:' + V.t4 + ';padding:8px 12px;\">Annuler</button>' +\n        '</div></div>');\n\n      var fini = false;\n      var repondre = function (valeur) {\n        if (fini) return;\n        fini = true;\n        clearInterval(veille);\n        resoudre(valeur);\n      };\n\n      /* Si la modale est fermee par la croix de l'en-tete, la promesse doit\n         se resoudre quand meme : sans cela, la connexion resterait suspendue\n         sans que rien ne l'indique. */\n      var veille = setInterval(function () {\n        if (!modal.isConnected) repondre(null);\n      }, 300);\n\n      var brancher = function (id, valeur) {\n        var b = modal.querySelector('#' + id);\n        if (b) b.onclick = function () { repondre(valeur); };\n      };\n      brancher('bh-rat-independant', false);\n      brancher('bh-rat-immeuble', true);\n      brancher('bh-rat-annuler', null);\n    });\n  }";
const NOUVEAU = "  /* ── La question d'immeuble, posee au bon moment ──────────────────────\n     Deux logements a la meme adresse ne sont pas forcement deux chambres du\n     meme etablissement. Le rattachement etait autrefois automatique, et\n     l'utilisateur l'apprenait une fois le fait accompli.\n\n     La consequence est desormais ecrite DANS l'option, pas en note de bas\n     de page, et elle nomme les plateformes reelles du voisin : « sera aussi\n     mise en vente sur Airbnb » se comprend, « les canaux seront partages »\n     non. C'est exactement ce qui a mis Airbnb sur une longere qui n'y\n     etait pas. */\n  async function plateformesDuVoisin(voisin) {\n    var id = voisin && (voisin.id || voisin._id);\n    if (!id) return [];\n    try {\n      var r = await fetch(API_URL + '/api/channex/connected-channels/' + id + '?bh_property_id=' + id,\n        { headers: { Authorization: 'Bearer ' + token() } });\n      if (!r.ok) return [];\n      var d = await r.json();\n      var noms = { airbnb: 'Airbnb', bookingcom: 'Booking.com', expedia: 'Expedia', vrbo: 'Abritel' };\n      return (d.channels || []).map(function (c) { return noms[String(c.channel || '').toLowerCase()]; })\n        .filter(function (x, i, t) { return x && t.indexOf(x) === i; });\n    } catch (e) { return []; }   // sans la liste, on reste general plutot que faux\n  }\n\n  function enumerer(liste) {\n    if (liste.length === 1) return liste[0];\n    return liste.slice(0, -1).join(', ') + ' et ' + liste[liste.length - 1];\n  }\n\n  function demanderRattachement(modal, moi, voisin) {\n    return new Promise(function (resoudre) {\n      var nomVoisin = esc(voisin.name || 'votre autre logement');\n      var nomMoi = esc((moi && moi.name) || 'ce logement');\n\n      var fini = false;\n      var veille = null;\n      var repondre = function (valeur) {\n        if (fini) return;\n        fini = true;\n        if (veille) clearInterval(veille);\n        resoudre(valeur);\n      };\n\n      var peindre = function (plateformes) {\n        // L'avertissement n'apparait que s'il y a quelque chose a perdre :\n        // un voisin sans plateforme connectee ne fait courir aucun risque.\n        var alerte = plateformes.length\n          ? '<div style=\"font-size:12.5px;line-height:1.5;color:#8A5B14;margin-top:8px;background:' + V.orFond +\n            ';border-radius:8px;padding:9px 11px;\">Attention : ' + nomMoi + ' sera aussi mise en vente sur ' +\n            esc(enumerer(plateformes)) + ', o\\u00f9 ' + nomVoisin + ' est d\\u00e9j\\u00e0 pr\\u00e9sente.</div>'\n          : '';\n\n        var option = function (id, titre, texte, courant, sous) {\n          return '<button type=\"button\" id=\"' + id + '\" style=\"width:100%;text-align:left;cursor:pointer;' +\n            'background:' + (courant ? V.vertPale : '#fff') + ';border:1.5px solid ' + (courant ? V.vertFilet : V.ligne) +\n            ';border-radius:13px;padding:15px 16px;margin-bottom:10px;font-family:inherit;display:block;\">' +\n            '<div style=\"display:flex;align-items:center;gap:9px;\">' +\n            '<span style=\"font-size:14.5px;font-weight:600;color:' + V.encre + ';\">' + titre + '</span>' +\n            (courant ? '<span style=\"font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:' +\n              V.vert + ';background:#fff;border-radius:99px;padding:3px 9px;\">Le plus courant</span>' : '') +\n            '</div>' +\n            '<div style=\"font-size:13px;line-height:1.55;color:' + V.t2 + ';margin-top:6px;\">' + texte + '</div>' +\n            (sous || '') + '</button>';\n        };\n\n        modal.innerHTML = carte(500,\n          entete('Une question avant de brancher',\n                 nomMoi + ' partage son adresse avec ' + nomVoisin, null) +\n          '<div style=\"padding:18px 22px 20px;\">' +\n          option('bh-rat-independant', 'Deux logements s\\u00e9par\\u00e9s',\n                 'Deux g\\u00eetes, deux annonces, deux calendriers. Chacun ses plateformes et ses tarifs.', true) +\n          option('bh-rat-immeuble', 'Deux chambres du m\\u00eame \\u00e9tablissement',\n                 'Un h\\u00f4tel, une r\\u00e9sidence. Vos annonces partagent d\\u00e9j\\u00e0 le m\\u00eame num\\u00e9ro chez Booking.com.',\n                 false, alerte) +\n          '<div style=\"text-align:center;margin-top:4px;\">' +\n          '<button type=\"button\" id=\"bh-rat-annuler\" style=\"background:none;border:none;cursor:pointer;' +\n          'font-family:inherit;font-size:12.5px;color:' + V.t3 + ';padding:8px 12px;\">Annuler</button>' +\n          '</div></div>');\n\n        // Fermer par la croix vaut annulation : sans cela, la connexion\n        // resterait suspendue sans que rien ne l'indique.\n        if (veille) clearInterval(veille);\n        veille = setInterval(function () { if (!modal.isConnected) repondre(null); }, 300);\n\n        var brancher = function (id, valeur) {\n          var b = modal.querySelector('#' + id);\n          if (b) b.onclick = function () { repondre(valeur); };\n        };\n        brancher('bh-rat-independant', false);\n        brancher('bh-rat-immeuble', true);\n        brancher('bh-rat-annuler', null);\n      };\n\n      // On peint tout de suite avec ce qu'on sait, puis on enrichit des que\n      // les plateformes du voisin sont connues : l'ecran ne reste jamais vide\n      // en attendant le reseau.\n      peindre([]);\n      plateformesDuVoisin(voisin).then(function (liste) {\n        if (!fini && liste.length) peindre(liste);\n      });\n    });\n  }";

const n = src.split(ANCIEN).length - 1;
if (n !== 1) echec('La fonction demanderRattachement : ' + n + " occurrence(s) au lieu d'une. Le fichier a change.");
src = src.split(ANCIEN).join(NOUVEAU);

/* ---- Verifications ---- */
try { new Function(src); }
catch (e) { echec("bh-ota-connect.js n'est plus du JavaScript valide — " + e.message); }

const controles = [
  ['la lecture des plateformes du voisin', 'async function plateformesDuVoisin(voisin)'],
  ['l\'enumeration en francais', 'function enumerer(liste)'],
  ['l\'avertissement nomme', 'sera aussi mise en vente sur'],
  ['l\'affichage immediat', 'peindre([]);'],
  ['l\'enrichissement differe', 'if (!fini && liste.length) peindre(liste);'],
  ['le libelle factuel', 'Le plus courant'],
  ['la veille sur la fermeture', 'if (!modal.isConnected) repondre(null);'],
];
for (const c of controles) {
  if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent du resultat.');
}

/* Le vocabulaire technique doit avoir disparu de cet ecran. */
if (src.indexOf('identifiant h\u00f4telier') !== -1 || src.indexOf('identifiant hôtelier') !== -1) {
  echec("Le vocabulaire technique subsiste dans l'ecran.");
}
/* L'appelant ne doit pas avoir bouge. */
if (src.indexOf('rattacher = await demanderRattachement(modal, moi, voisin);') === -1) {
  echec("L'appel a demanderRattachement a ete perdu.");
}
/* Une seule definition. */
if (src.split('function demanderRattachement').length - 1 !== 1) {
  echec('demanderRattachement est definie plusieurs fois.');
}

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('plateformesDuVoisin') === -1) {
    echec("L'ajout est absent apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log("  L'avertissement nomme les plateformes reelles du voisin.");
console.log('  Il ne parait que si le voisin en a — sinon rien.');
console.log('');
console.log('  Ensuite : \u2318\u21e7R sur R\u00e9glages.');
console.log('');
console.log('  Pour le voir : connectez un logement dont l\'adresse est deja');
console.log('  celle d\'un autre logement connecte. Avec vos longeres, le');
console.log('  message doit citer Booking.com et Airbnb nommement.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
