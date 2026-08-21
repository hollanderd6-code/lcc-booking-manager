#!/usr/bin/env node
/* ============================================================
   Deuxieme logement d'un meme immeuble : ne pas dire « Create »
   ============================================================
   Cible : public/js/bh-ota-connect.js

   ── LE MUR RENCONTRE ─────────────────────────────────────────────
   Deux logements dans le meme immeuble Booking.com :

       Appartement 1 Chambre    identifiant 900151901
       Appartement deux pieces  identifiant 900151902

   L'identifiant de l'ETABLISSEMENT est 9001519 — partage par les deux.
   Les deux derniers chiffres designent le LOGEMENT dans cet
   etablissement. Le client saisit 9001519 pour le premier logement :
   ca marche. Il le ressaisit pour le second : « cette propriete est
   deja utilisee ». Il est bloque, et rien ne lui dit pourquoi.

   Ce n'est pas un bug : un etablissement Booking ne se connecte qu'une
   fois. Le second logement ne doit pas creer un canal, il doit etre
   MAPPE dans le canal deja cree.

   Or l'aide du produit dit « Cliquez sur Create » — instruction juste
   pour le premier logement, fausse pour le second, et qui mene droit au
   message d'erreur.

   ── CE QUE FAIT CE PATCH ─────────────────────────────────────────
   Avant d'afficher les etapes, on regarde s'il existe un autre logement
   a la MEME ADRESSE, deja rattache au meme etablissement, et dont ce
   canal est deja connecte. Si oui, les etapes changent : elles disent
   de ne PAS cliquer sur Create et d'aller mapper dans le canal
   existant. Un bandeau explique la difference entre l'identifiant de
   l'immeuble et celui du logement — sans quoi le client ressaisira le
   meme numero.

   ── LA CONDITION PREALABLE, DITE AU BON MOMENT ───────────────────
   Ce rattachement repose sur l'adresse : sans adresse identique, le
   produit ne peut pas savoir que deux logements sont dans le meme
   immeuble, et le client retombe sur le mur. Quand l'adresse manque,
   le bandeau le dit et propose d'aller la renseigner.

   Usage :
     node outils/immeuble-canal-existant.js --essai
     node outils/immeuble-canal-existant.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'js', 'bh-ota-connect.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

if (!fs.existsSync(CIBLE)) {
  console.error('\n  \u2717 public/js/bh-ota-connect.js introuvable.');
  console.error('    Lancez depuis la racine du depot.\n');
  process.exit(1);
}

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('canalDejaSurImmeuble') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* ── 1. Detection + etapes alternatives ─────────────────────────── */
const A1 = `    var etapesFenetre = (teteCanal[code] || teteGenerique).concat(queueCanal);`;

const N1 = `    /* Deuxieme logement d'un meme immeuble : le canal existe deja au niveau de
       l'etablissement. Cliquer sur « Create » echoue — Booking.com refuse un
       identifiant d'etablissement deja utilise, parce que 9001519 designe
       l'IMMEUBLE et 900151901 / 900151902 les logements qu'il contient.
       Dans ce cas il ne faut pas creer un canal, mais mapper ce logement
       dans le canal existant. */
    var frereImmeuble = voisinConnecte(pid);
    var canalDejaSurImmeuble = false;
    if (frereImmeuble) {
      try {
        var fid = frereImmeuble.id || frereImmeuble._id;
        var rFrere = await fetch(API_URL + '/api/channex/connected-channels/' + fid + '?bh_property_id=' + fid,
          { headers: { Authorization: 'Bearer ' + token() } });
        if (rFrere.ok) {
          var dFrere = await rFrere.json();
          canalDejaSurImmeuble = (dFrere.channels || []).some(function (c) {
            var s = String(c.channel || '').toLowerCase();
            return s === p.cle || s.indexOf(p.cle) > -1 ||
                   (p.cle === 'booking' && s.indexOf('bdc') > -1) ||
                   (p.cle === 'airbnb' && s === 'abb');
          });
        }
      } catch (eFrere) {}
    }

    var etapesFenetre = canalDejaSurImmeuble
      ? ['Ne cliquez ' + g('pas') + ' sur ' + g('Create') + ' : le canal ' + g(p.label) +
           ' existe déjà pour cet immeuble.',
         'Ouvrez la ligne ' + g(p.label) + ' déjà présente dans la liste.',
         'Allez dans l\\'onglet ' + g('Mapping') + '.',
         'En face de ' + g('Not mapped') + ', choisissez ce logement — côté ' + p.label +
           ', son identifiant est celui de l\\'immeuble suivi de deux chiffres propres au logement.',
         'Cliquez sur ' + g('Save') + ', puis répondez ' + g('Save &amp; Activate') +
           ' — sans cette activation, rien ne se synchronise.']
      : (teteCanal[code] || teteGenerique).concat(queueCanal);`;

/* ── 2. Le bandeau d'explication, à côté du nom à copier ────────── */
const A2 = `    var cadre = function (interieur) {`;

const N2 = `    /* Le mur le plus couteux du parcours : reutiliser l'identifiant de
       l'etablissement pour un second logement. On explique la difference
       AVANT la saisie, pas apres le refus. */
    var bandeauImmeuble = canalDejaSurImmeuble
      ? '<div style="display:flex;align-items:flex-start;gap:11px;background:' + V.creme +
        ';border:1px solid ' + V.ligne + ';border-radius:10px;padding:11px 13px;margin-top:10px;">' +
        '<i class="fas fa-building" style="color:' + V.t2 + ';font-size:14px;margin-top:2px;flex:none;"></i>' +
        '<span style="flex:1;color:' + V.t2 + ';line-height:1.5;">' +
        '<strong style="font-weight:600;color:' + V.encre + ';">Même immeuble que ' +
        esc(frereImmeuble ? (frereImmeuble.name || 'votre autre logement') : 'votre autre logement') +
        '.</strong> Ne ressaisissez pas l\\'identifiant de l\\'établissement : il n\\'est utilisable ' +
        'qu\\'une fois. Ce logement se rattache en le mappant dans le canal déjà créé.' +
        '</span></div>'
      : '';

    var cadre = function (interieur) {`;

/* ── 3. Affichage du bandeau ─────────────────────────────────────── */
const A3 = `'color:' + V.t2 + ';line-height:1.5;">' + aide + bandeauNom + bandeauPhoto +`;
const N3 = `'color:' + V.t2 + ';line-height:1.5;">' + aide + bandeauNom + bandeauImmeuble + bandeauPhoto +`;

/* ── 4. Prevenir en amont quand l'adresse manque ─────────────────── */
const A4 = `        '<span style="font-size:13px;color:' + V.or + ';line-height:1.5;flex:1;">Ce logement n\\'a pas d\\'adresse. ' +
        'Il sera traité comme un logement indépendant — s\\'il fait partie d\\'un immeuble déjà connecté, ' +
        'renseignez l\\'adresse d\\'abord pour éviter un doublon d\\'établissement.</span>' +`;

const N4 = `        '<span style="font-size:13px;color:' + V.or + ';line-height:1.5;flex:1;">Ce logement n\\'a pas d\\'adresse. ' +
        'Il sera traité comme un logement indépendant. S\\'il est en réalité dans un immeuble déjà connecté, ' +
        'renseignez l\\'adresse d\\'abord : sans elle, Booking.com refusera l\\'identifiant de l\\'établissement, ' +
        'déjà utilisé par votre premier logement.</span>' +`;

const edits = [
  ['etapes alternatives', A1, N1],
  ['bandeau immeuble', A2, N2],
  ['affichage du bandeau', A3, N3],
  ['avertissement adresse manquante', A4, N4]
];

const optionnels = { 'avertissement adresse manquante': true };

let faits = 0;
for (const [nom, ancien, nouveau] of edits) {
  const n = src.split(ancien).length - 1;
  if (n !== 1) {
    if (optionnels[nom]) {
      console.log('  ignore    ' + nom + ' (' + n + ' occurrence(s) — texte deja modifie)');
      continue;
    }
    console.error('\n  \u2717 ' + nom + ' : ' + n + ' occurrence(s), 1 attendue.');
    if (nom === 'affichage du bandeau') {
      console.error('    Ce patch suppose outils/ota-parcours-complet.js applique');
      console.error('    (bandeauPhoto). Appliquez-le d\'abord.');
    }
    console.error('    Rien n\'a ete ecrit.\n');
    process.exit(1);
  }
  src = src.split(ancien).join(nouveau);
  console.log('  applique  ' + nom);
  faits++;
}

try {
  new Function(src);
} catch (e) {
  console.error('\n  \u2717 Le resultat n\'est pas du JavaScript valide : ' + e.message);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!ESSAI) fs.writeFileSync(CIBLE, src, 'utf8');

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  ' + faits + ' modification(s). Syntaxe verifiee.');
console.log('\n  CE QUE VOUS DEVEZ FAIRE AVANT DE TESTER');
console.log('    Mettre la MEME adresse sur vos deux logements de l\'immeuble.');
console.log('    C\'est la seule chose qui permet au produit de savoir qu\'ils');
console.log('    partagent un etablissement.');
console.log('\n  A VOIR A L\'ECRAN');
console.log('    Second logement \u2192 Booking.com : les etapes doivent commencer');
console.log('    par « Ne cliquez PAS sur Create », et un bandeau doit nommer');
console.log('    le logement voisin. Le premier logement garde ses 7 etapes');
console.log('    normales, avec Create.');
if (ESSAI) console.log('\n  Relancez sans --essai pour appliquer.');
console.log('');
