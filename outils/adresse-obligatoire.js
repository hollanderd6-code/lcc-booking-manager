#!/usr/bin/env node
/* ============================================================
   outils/adresse-obligatoire.js
   Pas de connexion sans adresse
   ============================================================
   Cible : public/js/bh-ota-connect.js

   ── POURQUOI BLOQUER ─────────────────────────────────────────────
   Le regroupement d'un immeuble se deduit de l'adresse : deux logements
   a la meme adresse partagent un etablissement chez le partenaire. Sans
   adresse, on ne peut pas le deduire, et un etablissement separe est
   cree pour le second logement.

   La suite est connue, et couteuse : Booking.com refuse l'identifiant
   de l'etablissement, deja pris par le premier logement. Pour reparer,
   il faut detacher, rattacher, puis remapper chaque plateforme — et si
   une annonce Airbnb est restee accrochee a l'ancien etablissement,
   elle se verrouille et seule sa suppression cote partenaire la libere.

   Un avertissement ne suffit donc pas. On demande l'adresse d'abord.

   ── OU LE BLOCAGE EST POSE ───────────────────────────────────────
   Dans _bhOta(), le point de passage unique de toutes les demandes de
   connexion. Poser le controle sur chaque bouton laisserait passer le
   chemin qu'on oublie.

   L'ecran propose d'aller renseigner l'adresse, et ne se contente pas
   d'interdire : un refus sans issue est aussi mauvais qu'une erreur.

   Usage :
     node outils/adresse-obligatoire.js --essai
     node outils/adresse-obligatoire.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'js', 'bh-ota-connect.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

if (!fs.existsSync(CIBLE)) {
  console.error('\n  \u2717 public/js/bh-ota-connect.js introuvable. Lancez depuis la racine.\n');
  process.exit(1);
}

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('_bhAdresseRequise') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

const edits = [];

/* ── 1. Le blocage, au point de passage unique ────────────────────── */
edits.push([
  'blocage dans _bhOta',
  `    window._bhOta = function (code) {
      var p = PLATEFORMES.find(function (x) { return x.code === code; });`,
  `    window._bhOta = function (code) {
      /* Sans adresse, le regroupement d'immeuble ne peut pas etre deduit et
         un etablissement separe serait cree. Le reparer ensuite coute un
         detachement, un rattachement et un remappage de chaque plateforme.
         On demande l'adresse maintenant. */
      if (sansAdresse) return window._bhAdresseRequise();
      var p = PLATEFORMES.find(function (x) { return x.code === code; });`
]);

/* ── 2. L'ecran qui explique et propose l'issue ───────────────────── */
edits.push([
  'ecran adresse requise',
  `    window._bhAdresse = function () {`,
  `    window._bhAdresseRequise = function () {
      modal.innerHTML = carte(500,
        entete(null, 'Renseignez l\\'adresse d\\'abord', esc(pname)) +
        '<div style="padding:22px 24px;display:flex;flex-direction:column;gap:14px;">' +
        '<div style="font-size:14px;line-height:1.6;color:' + V.encre + ';">' +
        'Les logements d\\'un meme immeuble doivent partager un seul etablissement chez ' +
        'la plateforme, et c\\'est l\\'adresse qui permet de les reconnaitre.</div>' +
        '<div style="font-size:13px;line-height:1.6;color:' + V.t2 + ';background:' + V.creme +
        ';border-radius:12px;padding:14px 16px;">Sans elle, ce logement serait declare separement. ' +
        'Booking.com refuserait alors son identifiant, deja utilise par le premier logement de ' +
        'l\\'immeuble, et il faudrait tout reprendre : detacher, rattacher, puis remapper chaque plateforme.</div>' +
        '<div style="font-size:12.5px;color:' + V.t4 + ';">Si ce logement est bien independant, ' +
        'renseignez tout de meme son adresse : elle sert aussi aux voyageurs.</div>' +
        '</div>' +
        pied(btnFantome('Plus tard', "document.getElementById('channexModal')?.remove()"),
          btnPlein('Renseigner l\\'adresse', 'window._bhAdresse()')));
    };

    window._bhAdresse = function () {`
]);

/* ── 3. L'avertissement dit maintenant qu'il bloque ───────────────── */
edits.push([
  'texte de l\'avertissement',
  `'<span style="font-size:13px;color:' + V.or + ';line-height:1.5;flex:1;">Ce logement n\\'a pas d\\'adresse. ' +
        'Il sera traité comme un logement indépendant. S\\'il est en réalité dans un immeuble déjà connecté, ' +
        'renseignez l\\'adresse d\\'abord : sans elle, Booking.com refusera l\\'identifiant de l\\'établissement, ' +
        'déjà utilisé par votre premier logement.</span>' +`,
  `'<span style="font-size:13px;color:' + V.or + ';line-height:1.5;flex:1;">' +
        '<strong style="font-weight:600;">Adresse requise avant connexion.</strong> ' +
        'C\\'est elle qui permet de reconnaître les logements d\\'un même immeuble, ' +
        'qui doivent partager un seul établissement chez la plateforme.</span>' +`
]);

for (const [nom, ancien] of edits) {
  const n = src.split(ancien).length - 1;
  if (n !== 1) {
    console.error('\n  \u2717 ' + nom + ' : ' + n + ' occurrence(s), 1 attendue.');
    console.error('    Le fichier a change. Rien n\'a ete ecrit.\n');
    process.exit(1);
  }
}
for (const [, ancien, nouveau] of edits) src = src.split(ancien).join(nouveau);

try {
  new Function(src);
} catch (e) {
  console.error('\n  \u2717 Le resultat n\'est pas du JavaScript valide : ' + e.message);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!ESSAI) fs.writeFileSync(CIBLE, src, 'utf8');

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  Aucune connexion ne peut demarrer sans adresse.');
console.log('  L\'ecran explique pourquoi et mene a la fiche du logement.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
