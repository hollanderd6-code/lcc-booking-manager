#!/usr/bin/env node
/* ============================================================
   outils/hold-conversion-commentaire.js
   Corriger le commentaire errone laisse par hold-conversion-compte.js
   ============================================================
     node outils/hold-conversion-commentaire.js --essai
     node outils/hold-conversion-commentaire.js

   Le correctif precedent est bon, son commentaire ne l'est pas : il
   affirme que properties n'a pas de colonne owner_user_id. C'est faux —
   les requetes qui chargent `prop` l'aliasent (server.js 46154, 49414,
   50097 : « user_id as owner_user_id »). La valeur n'etait donc jamais
   NULL, et les reservations BHGuest ne naissent pas sans proprietaire.

   La cause reelle est la seconde, et elle suffit : prop.owner_user_id
   est le proprietaire du LOGEMENT, tandis que le hold porte le compte
   qui a cree le LIEN. Les deux coincident quand un proprietaire gere
   seul son compte — et divergent des qu'une agence cree le lien pour
   le bien d'un client. La conversion echouait donc exactement dans ce
   cas, et seulement dans ce cas.
   ============================================================ */

'use strict';
const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'server.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(m) { console.error('\n  \u2717 ' + m + "\n    Rien n'a ete ecrit.\n"); process.exit(1); }

if (!fs.existsSync(CIBLE)) echec('server.js introuvable. Lancez depuis la racine du projet.');
let src = fs.readFileSync(CIBLE, 'utf8');

const A = `        /* HOLD_CONVERSION_SANS_COMPTE — la condition « user_id = $4 » ne pouvait
           jamais etre vraie : prop.owner_user_id n'existe pas (properties a
           user_id et owner_id), donc pg recevait NULL. Et quand le lien est cree
           depuis un compte AGENCE, le hold porte ce compte, pas le proprietaire
           du logement : meme reparee, la comparaison aurait echoue. Logement +
           dates + status='active' identifient le hold sans ambiguite. */`;

const N = `        /* HOLD_CONVERSION_SANS_COMPTE — la condition « user_id = $4 » comparait
           deux comptes legitimes mais differents : prop.owner_user_id est le
           proprietaire du LOGEMENT, le hold porte le compte qui a cree le LIEN.
           Ils coincident quand un proprietaire gere seul son compte — et
           divergent des qu'une agence cree le lien pour le bien d'un client.
           La conversion echouait alors en silence : le hold restait 'active'
           jusqu'a son expiration (4h), et le calendrier affichait la
           pre-reservation a cote de la reservation payee.
           Logement + dates + status='active' identifient le hold sans
           ambiguite : deux comptes ne peuvent pas tenir les memes nuits. */`;

const n = src.split(A).length - 1;
if (n === 0) echec('Le commentaire a corriger est introuvable (deja corrige ?).');
src = src.split(A).join(N);

const A2 = `                      /* HOLD_CONVERSION_SANS_COMPTE — ownerId est le proprietaire du
                         logement ; le hold porte le compte qui a cree le lien, qui peut
                         etre un compte agence. La comparaison echouait donc en mode
                         agence, et le hold survivait jusqu'a son expiration (4h). */`;
/* Celui du webhook etait deja exact — on le laisse tel quel. */
if (src.indexOf(A2) === -1) console.log('  (note : le commentaire du webhook est absent ou deja different)');

try { new Function(src.replace(/^#![^\n]*\n/, '')); }
catch (e) { echec('server.js ne serait plus du JavaScript valide — ' + e.message); }

if (src.indexOf("prop.owner_user_id n'existe pas") !== -1) echec('L\'affirmation fausse subsiste.');

if (!ESSAI) fs.writeFileSync(CIBLE, src, 'utf8');

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log(`  ${n} commentaire(s) corrige(s). Le code n'a pas change.\n`);
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
