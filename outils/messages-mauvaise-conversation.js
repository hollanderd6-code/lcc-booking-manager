#!/usr/bin/env node
/* ============================================================
   outils/messages-mauvaise-conversation.js
   Le message part chez le mauvais voyageur
   ============================================================
   Cibles : public/messages.html
            public/js/chat-owner.js

   ── LE SYMPTOME ─────────────────────────────────────────────────
   On ouvre une conversation, on revient a la liste, on en ouvre une
   autre, on ecrit — et le message arrive dans la PREMIERE. Constate
   plusieurs fois, avec des codes d'acces envoyes au mauvais voyageur.

   ── LA CAUSE ────────────────────────────────────────────────────
   Deux fichiers suivent chacun « la conversation ouverte », et ils ne
   se parlent pas.

   1. messages.html REMPLACE window.openChat par son propre patch
      (patchOpenChat). Ce patch ne rappelle jamais la fonction d'origine :
      il ecrit window.currentConversationId, affiche le panneau, charge
      les messages, rejoint le socket — et c'est tout.

   2. chat-owner.js garde SA variable, « let currentConversationId »,
      qui n'est mise a jour que dans son openChat d'origine — celui qui
      n'est plus appele. Elle ne bouge donc plus jamais.

   3. Au moment d'envoyer, sendMessageOwner faisait :

        if (!currentConversationId && window.currentConversationId) {
          currentConversationId = window.currentConversationId;
        }

      La recopie n'a lieu QUE SI la locale est vide. Elle se remplit a la
      premiere conversation ouverte… et n'est plus jamais rafraichie.
      Toutes les conversations suivantes envoient donc a la premiere.

   Le meme piege existe pour l'identifiant de reservation Channex, qui
   determine dans quel fil Booking.com le message est publie. Pire : dans
   messages.html, _currentChannexBookingId est une variable LOCALE, jamais
   publiee sur window — alors que chat-owner.js ne lit que la version
   window. Les deux fichiers suivaient litteralement deux conversations
   differentes.

   ── CE QUE FAIT CE CORRECTIF ────────────────────────────────────
   Il fait de window la source unique, puisque c'est la seule que le
   patch tient a jour a chaque ouverture :

   · messages.html — le patch de openChat remet window._currentChannexBookingId
     a zero en ouvrant une conversation ;
   · messages.html — le suivi Channex publie desormais sa valeur sur
     window, a la mise a zero comme a l'affectation ;
   · chat-owner.js — sendMessageOwner adopte window.currentConversationId
     des qu'il DIFFERE de sa copie locale, et reprend alors l'identifiant
     Channex correspondant, meme vide.

   ── POURQUOI PAS APPELER LA FONCTION D'ORIGINE ? ────────────────
   Ce serait la correction de fond : que le patch delegue a l'original
   au lieu de le remplacer. Mais l'original charge les messages, rejoint
   le socket et manipule le DOM — tout ce que le patch refait deja a sa
   facon. L'appeler produirait des doublons d'affichage et des
   abonnements socket en double. La refonte de ce doublon est un chantier
   a part ; ce correctif ferme la fuite sans y toucher.

   ── CE QUI N'EST PAS TOUCHE ─────────────────────────────────────
   · Les deux gestionnaires « paste » de chat-owner.js (lignes ~278 et
     ~298) sont DEUX FOIS LE MEME CODE, colle en double, et lisent eux
     aussi la locale en priorite. Ils ne servent qu'a resoudre les
     raccourcis a la volee : l'impact est cosmetique, et supprimer un
     doublon depasse le cadre de ce correctif. A nettoyer un jour.

   Usage :
     node outils/messages-mauvaise-conversation.js --essai
     node outils/messages-mauvaise-conversation.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const HTML = path.join(process.cwd(), 'public', 'messages.html');
const JS = path.join(process.cwd(), 'public', 'js', 'chat-owner.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

for (const f of [HTML, JS]) {
  if (!fs.existsSync(f)) echec(f + ' introuvable. Lancez depuis la racine du projet.');
}
let html = fs.readFileSync(HTML, 'utf8');
let js = fs.readFileSync(JS, 'utf8');

if (js.indexOf('window.currentConversationId est la seule source fiable') !== -1) {
  console.log('\n  Le correctif est deja en place — rien a faire.\n');
  process.exit(0);
}

function remplacer(source, avant, apres, quoi) {
  const n = source.split(avant).length - 1;
  if (n !== 1) echec(quoi + ' : ' + n + " occurrence(s) au lieu d'une. Le fichier a change.");
  return source.split(avant).join(apres);
}

html = remplacer(html, "    window.openChat = async function(conversationId) {\n      window.currentConversationId = conversationId;", "    window.openChat = async function(conversationId) {\n      window.currentConversationId = conversationId;\n      /* Ce patch remplace openChat de chat-owner.js sans jamais appeler\n         l'original : la variable interne de ce module n'est donc plus\n         actualisee, et window fait desormais foi. On remet aussi a zero\n         l'identifiant Channex — sans quoi le message partirait dans le fil\n         Booking du voyageur precedent. */\n      window._currentChannexBookingId = null;", 'Le patch de openChat');
html = remplacer(html, "window.openConversation = async function(convId, ...args) {\n  _currentChannexBookingId = null;", "window.openConversation = async function(convId, ...args) {\n  _currentChannexBookingId = null;\n  /* Publie sur window : chat-owner.js ne lit que window._currentChannexBookingId\n     et n'a aucun acces a cette variable locale. Sans cette ligne, les deux\n     fichiers suivaient deux conversations differentes. */\n  window._currentChannexBookingId = null;", 'La mise a zero Channex');
html = remplacer(html, "        _currentChannexBookingId = data.channex_booking_id;", "        _currentChannexBookingId = data.channex_booking_id;\n        window._currentChannexBookingId = data.channex_booking_id;", "L'affectation Channex");
js   = remplacer(js,   "  // Sur messages.html, currentConversationId est dans window — fallback\n  if (!currentConversationId && window.currentConversationId) {\n    currentConversationId = window.currentConversationId;\n  }\n  if (!currentChannexBookingId && window._currentChannexBookingId) {\n    currentChannexBookingId = window._currentChannexBookingId;\n  }", "  /* Sur messages.html, openChat est remplace par un patch qui n'appelle pas\n     la version d'origine : la variable locale ci-dessus n'est donc jamais\n     mise a jour, et window.currentConversationId est la seule source fiable.\n\n     L'ancienne condition « if (!currentConversationId) » ne recopiait la\n     valeur QU'UNE FOIS. Des la deuxieme conversation ouverte, la locale\n     restait figee sur la premiere et tous les envois y repartaient — le\n     message arrivait chez le mauvais voyageur. */\n  if (window.currentConversationId\n      && String(window.currentConversationId) !== String(currentConversationId)) {\n    currentConversationId = window.currentConversationId;\n    /* L'identifiant de reservation Channex appartient a la conversation :\n       le conserver enverrait le message dans le fil Booking du precedent.\n       On le reprend meme lorsqu'il est vide. */\n    currentChannexBookingId = window._currentChannexBookingId || null;\n  } else if (!currentConversationId && window.currentConversationId) {\n    currentConversationId = window.currentConversationId;\n  }\n  if (!currentChannexBookingId && window._currentChannexBookingId) {\n    currentChannexBookingId = window._currentChannexBookingId;\n  }", 'La reprise des identifiants dans sendMessageOwner');

/* ---- Verifications ---- */
try { new Function(js); }
catch (e) { echec("chat-owner.js n'est plus du JavaScript valide — " + e.message); }

const blocs = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
let vuPatch = false;
for (const b of blocs) {
  const corps = b.replace(/^<script>/, '').replace(/<\/script>$/, '');
  if (corps.indexOf('patchOpenChat') !== -1) vuPatch = true;
  try { new Function(corps); }
  catch (e) { echec("Un bloc <script> de messages.html n'est plus valide — " + e.message); }
}
if (!vuPatch) echec('Le bloc contenant patchOpenChat est introuvable apres modification.');

const controles = [
  ['la remise a zero a l\'ouverture', 'window._currentChannexBookingId = null;', html],
  ['la publication de l\'identifiant Channex', 'window._currentChannexBookingId = data.channex_booking_id;', html],
  ['la comparaison des identifiants', "String(window.currentConversationId) !== String(currentConversationId)", js],
  ['la reprise de l\'identifiant Channex', 'currentChannexBookingId = window._currentChannexBookingId || null;', js],
];
for (const [quoi, aiguille, ou] of controles) {
  if (ou.indexOf(aiguille) === -1) echec('Verification : ' + quoi + ' est absent du resultat.');
}

/* Le repli d'origine doit subsister pour le cas ou la locale est vide. */
if (js.indexOf('} else if (!currentConversationId && window.currentConversationId) {') === -1) {
  echec('Le repli initial a ete perdu.');
}
/* La garde qui empeche d'envoyer sans conversation doit rester. */
if (js.indexOf('if (!input || !currentConversationId) return;') === -1) {
  echec("La garde d'envoi a disparu.");
}
if (html.split('window._currentChannexBookingId = null;').length - 1 !== 2) {
  echec('Nombre inattendu de remises a zero Channex (2 attendues).');
}

if (!ESSAI) {
  fs.writeFileSync(HTML, html, 'utf8');
  fs.writeFileSync(JS, js, 'utf8');
  if (fs.readFileSync(JS, 'utf8').indexOf('seule source fiable') === -1) {
    echec("L'ajout est absent apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  L\'envoi suit desormais la conversation reellement ouverte,');
console.log('  et l\'identifiant Channex la suit avec elle.');
console.log('');
console.log('  Ensuite : ⌘⇧R sur Messages (messages.html et chat-owner.js');
console.log('  sont tous deux en cache).');
console.log('');
console.log('  A ESSAYER, c\'est le scenario exact du bug :');
console.log('   1. ouvrir une conversation A, envoyer un message ;');
console.log('   2. revenir a la liste, ouvrir une conversation B ;');
console.log('   3. envoyer — le message doit arriver chez B.');
console.log('  Verifiez aussi cote Booking.com que le fil est le bon.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
