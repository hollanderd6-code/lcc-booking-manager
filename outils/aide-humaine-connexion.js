#!/usr/bin/env node
/* ============================================================
   outils/aide-humaine-connexion.js
   Une issue de secours dans la fenetre du partenaire
   ============================================================
   Cible : public/js/bh-ota-connect.js

   Etat 2c de la maquette « Connexion des plateformes ».

   ── LE CONSTAT ──────────────────────────────────────────────────
   La derniere etape de la connexion se passe dans une fenetre qui ne
   nous appartient pas : celle de Channex, en anglais, avec des termes
   que personne ne peut traduire — Create, Mapping, Save & Activate.

   L'ecran est deja tres travaille : instructions numerotees, nom du
   logement copiable, avertissement sur la photo de profil Airbnb,
   etapes differentes pour un second logement d'immeuble. Tout cela
   aide celui qui avance.

   Il ne restait rien pour celui qui BLOQUE. Et c'est precisement le
   point du parcours ou un client en essai abandonne — sans rien dire,
   sans que personne ne le sache.

   ── CE QUE FAIT CE CORRECTIF ────────────────────────────────────
   Une ligne discrete sous les etapes : « Bloque a une etape ? » avec
   un bouton « Faites-le nous faire ».

   Il ouvre un ecran qui assume la situation : cette etape se passe
   chez le partenaire, dans une fenetre que nous ne maitrisons pas ;
   plutot que d'y perdre son temps, on la fait a sa place.

   Le message de demande est REDIGE ET COPIE automatiquement :

     « Bonjour, je bloque sur la connexion de « Longere n° 3 » a
       Booking.com. Pouvez-vous la faire pour moi ? »

   Le client n'a pas a expliquer sa situation — il ne saurait pas le
   faire : il ne connait ni le nom de son logement chez nous, ni celui
   de la plateforme dans notre vocabulaire. Il colle, et c'est tout.

   ── POURQUOI PAS UN ENVOI AUTOMATIQUE ───────────────────────────
   Creer la conversation de support depuis ici demanderait de connaitre
   la forme exacte attendue par /api/support/conversation/new. Se
   tromper produirait un message perdu — pire que pas de message du
   tout, puisque le client croirait avoir demande de l'aide.

   On copie et on ouvre le support : le geste restant est d'un coller.
   L'envoi direct viendra quand la route aura ete verifiee.

   ── CE QUI N'EST PAS TOUCHE ─────────────────────────────────────
   Les instructions, le nom copiable, l'avertissement Airbnb, les
   etapes d'immeuble : tout reste. On ajoute une porte de sortie, on
   ne retire aucun panneau.

   Usage :
     node outils/aide-humaine-connexion.js --essai
     node outils/aide-humaine-connexion.js
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

if (src.indexOf('_bhAideHumaine') !== -1) {
  console.log('\n  Le correctif est deja en place — rien a faire.\n');
  process.exit(0);
}

const AVANT = "    var aide = '<div style=\"display:flex;flex-direction:column;gap:6px;\">' +\n      etapesFenetre.map(function (t, i) {\n        return '<div style=\"display:flex;gap:9px;align-items:flex-start;\">' +\n          '<span style=\"width:18px;height:18px;border-radius:50%;background:#fff;border:1px solid ' + V.ligne +\n          ';color:' + V.vert + ';font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;' +\n          'flex:none;margin-top:1px;\">' + (i + 1) + '</span><span>' + t + '</span></div>';\n      }).join('') + '</div>';";
const APRES = "    var aide = '<div style=\"display:flex;flex-direction:column;gap:6px;\">' +\n      etapesFenetre.map(function (t, i) {\n        return '<div style=\"display:flex;gap:9px;align-items:flex-start;\">' +\n          '<span style=\"width:18px;height:18px;border-radius:50%;background:#fff;border:1px solid ' + V.ligne +\n          ';color:' + V.vert + ';font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;' +\n          'flex:none;margin-top:1px;\">' + (i + 1) + '</span><span>' + t + '</span></div>';\n      }).join('') +\n      /* L'issue de secours. Cette fenetre appartient a un tiers, elle est en\n         anglais, et c'est le point du parcours ou un client bloque abandonne\n         sans rien dire. Une main tendue ici vaut mieux qu'un centre d'aide :\n         elle est offerte a l'instant precis du blocage, et elle est humaine. */\n      '<div style=\"margin-top:12px;padding-top:11px;border-top:1px solid ' + V.ligne +\n        ';display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;\">' +\n        '<span style=\"font-size:12.5px;color:' + V.t3 + ';\">Bloqu\\u00e9 \\u00e0 une \\u00e9tape&nbsp;?</span>' +\n        '<button type=\"button\" onclick=\"window._bhAideHumaine()\" style=\"border:1px solid ' + V.vertFilet +\n        ';background:' + V.vertPale + ';color:' + V.vert + ';font-family:' + V.sans + ';font-size:12.5px;' +\n        'font-weight:600;padding:8px 13px;border-radius:8px;cursor:pointer;\">Faites-le nous faire</button>' +\n      '</div>' +\n      '</div>';\n\n    /* Le message est pret et copie : le client n'a pas a expliquer sa\n       situation, ce qu'il ne saurait pas faire — il ne connait ni le nom de\n       la plateforme chez nous, ni celui de son logement chez elle. */\n    window._bhAideHumaine = function () {\n      var texte = 'Bonjour, je bloque sur la connexion de \\u00ab ' + (pname || 'mon logement') +\n        ' \\u00bb \\u00e0 ' + p.label + '. Pouvez-vous la faire pour moi\\u00a0?';\n      try { navigator.clipboard && navigator.clipboard.writeText(texte); } catch (e) {}\n      modal.innerHTML = carte(470,\n        entete(null, 'On s\\'en occupe', esc(pname)) +\n        '<div style=\"padding:20px 24px;display:flex;flex-direction:column;gap:14px;\">' +\n        '<div style=\"font-size:14px;line-height:1.65;color:' + V.t2 + ';\">' +\n        'Cette \\u00e9tape se passe chez ' + esc(p.label) + ', dans une fen\\u00eatre que nous ne ma\\u00eetrisons pas. ' +\n        'Plut\\u00f4t que d\\'y perdre votre temps, dites-le nous : nous la faisons \\u00e0 votre place.' +\n        '</div>' +\n        '<div style=\"background:' + V.creme + ';border-radius:11px;padding:13px 15px;font-size:13px;' +\n        'line-height:1.55;color:' + V.encre + ';\">' + esc(texte) + '</div>' +\n        '<div style=\"font-size:12.5px;color:' + V.t3 + ';\">Ce message est d\\u00e9j\\u00e0 copi\\u00e9 : ' +\n        'collez-le dans le chat du support, nous reprenons la main de l\\u00e0.</div>' +\n        '</div>' +\n        pied(btnFantome('Revenir aux \\u00e9tapes', 'window._bhRetourFenetre()'),\n          btnPlein('Ouvrir le support', \"window.location.href='/help.html'\")));\n      window._bhRetourFenetre = function () { lancer(modal, pid, pname, code); };\n    };";

const n = src.split(AVANT).length - 1;
if (n !== 1) echec("Le bloc d'aide de la fenetre Channex : " + n + " occurrence(s) au lieu d'une.");
src = src.split(AVANT).join(APRES);

/* ---- Verifications ---- */
try { new Function(src); }
catch (e) { echec("bh-ota-connect.js n'est plus du JavaScript valide — " + e.message); }

const controles = [
  ['le bouton', 'Faites-le nous faire'],
  ['la fonction', 'window._bhAideHumaine = function ()'],
  ['le message pret', 'je bloque sur la connexion de'],
  ['la copie', 'navigator.clipboard.writeText(texte)'],
  ['le retour aux etapes', 'window._bhRetourFenetre'],
  ['l\'ouverture du support', '/help.html'],
];
for (const c of controles) {
  if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent du resultat.');
}

/* Les aides existantes doivent rester. */
for (const [quoi, aiguille] of [
  ['les instructions numerotees', 'etapesFenetre.map(function (t, i)'],
  ['le nom copiable', 'bhCopieNom'],
  ['les etapes d\'immeuble', 'canalDejaSurImmeuble'],
]) if (src.indexOf(aiguille) === -1) echec('Verification : ' + quoi + ' a disparu.');

if (src.split('window._bhAideHumaine = function').length - 1 !== 1) {
  echec("L'issue de secours est definie plusieurs fois.");
}

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('_bhAideHumaine') === -1) {
    echec("L'ajout est absent apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Sous les etapes de la fenetre Channex : « Bloque a une etape ? »');
console.log('  et un bouton qui redige la demande et la copie.');
console.log('');
console.log('  Ensuite : \u2318\u21e7R sur R\u00e9glages, puis ouvrez la connexion');
console.log('  d\'une plateforme sur un logement.');
console.log('');
console.log('  A DECIDER : ces demandes vous arriveront par le chat du support.');
console.log('  Sur un essai de quatorze jours, y repondre dans l\'heure change');
console.log('  tout — c\'est le moment ou le client decide si votre produit');
console.log('  tient ses promesses.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
