#!/usr/bin/env node
/* ============================================================
   Bouton « Rattacher a l'immeuble de… »
   ============================================================
   Cible : public/js/bh-ota-connect.js
   Prerequis : routes/regroupement-routes.js monte dans server.js.

   ── CE QU'IL DEBLOQUE ────────────────────────────────────────────
   Deux logements a la meme adresse, connectes separement : chacun a son
   etablissement chez le partenaire. Booking.com refuse alors le second,
   son identifiant d'etablissement n'etant utilisable qu'une fois. Rien
   dans le produit ne disait pourquoi, et la seule issue — deconnecter
   puis reconnecter — etait indevinable.

   L'ecran des plateformes affiche desormais un encadre quand ce cas est
   detecte, avec un bouton qui fait l'operation.

   ── CE QUE L'ENCADRE DIT AVANT D'AGIR ────────────────────────────
   Le rattachement casse les canaux deja mappes : ils devront etre
   remappes. L'encadre les nomme, et compte les reservations a venir.
   Une operation destructrice s'annonce avant, pas apres.

   Si la liste des canaux n'a pas pu etre lue, l'encadre le dit au lieu
   d'afficher « rien a remapper », ce qui serait un mensonge par omission.

   Usage :
     node outils/bouton-regroupement.js --essai
     node outils/bouton-regroupement.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'js', 'bh-ota-connect.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

if (!fs.existsSync(CIBLE)) {
  console.error('\n  \u2717 public/js/bh-ota-connect.js introuvable.\n');
  process.exit(1);
}

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('_bhRegrouper') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* ── 1. Detection + encadre ──────────────────────────────────────── */
const A1 = `    modal.innerHTML = carte(540,`;

const N1 = `    /* Meme adresse qu'un autre logement, mais etablissement different chez le
       partenaire : Booking.com refusera le second. On le detecte et on propose
       le rattachement, au lieu de laisser deviner qu'une deconnexion est la
       solution. La route sert aussi de test de disponibilite. */
    var noteRegroupement = '';
    try {
      var rReg = await fetch(API_URL + '/api/properties/' + pid + '/regroupement',
        { headers: { Authorization: 'Bearer ' + token() } });
      if (rReg.ok) {
        var dReg = await rReg.json();
        if (!dReg.deja_groupe && dReg.candidats && dReg.candidats.length) {
          var c0 = dReg.candidats[0];
          window._bhRegCible = c0.id;

          // Ce qui sera casse. null = la liste n'a pas pu etre lue : on le dit,
          // plutot que de laisser croire qu'il n'y a rien a refaire.
          var coutRemap = dReg.a_remapper === null
            ? 'Les plateformes déjà connectées sur ce logement devront être remappées (liste indisponible).'
            : (dReg.a_remapper.length
                ? 'À remapper ensuite : ' + dReg.a_remapper.map(function (x) { return esc(x.titre); }).join(', ') + '.'
                : 'Aucune plateforme n\\'est encore mappée sur ce logement : rien à refaire.');

          var coutResa = dReg.reservations_a_venir > 0
            ? '<span style="display:block;margin-top:6px;color:' + V.or + ';font-weight:500;">' +
              dReg.reservations_a_venir + ' réservation' + (dReg.reservations_a_venir > 1 ? 's' : '') +
              ' à venir sur ce logement — traitez-les avant.</span>'
            : '';

          noteRegroupement =
            '<div style="background:' + V.orFond + ';border:1px solid ' + V.orFilet + ';border-radius:12px;' +
            'padding:13px 15px;display:flex;align-items:flex-start;gap:11px;">' +
            '<i class="fas fa-building" style="color:' + V.or + ';font-size:14px;margin-top:2px;flex:none;"></i>' +
            '<span style="flex:1;font-size:13px;color:' + V.or + ';line-height:1.5;">' +
            '<strong style="font-weight:600;">Même adresse que ' + esc(c0.nom) + ', mais établissement séparé.</strong> ' +
            'Booking.com refusera ce logement : l\\'identifiant de l\\'établissement n\\'est utilisable qu\\'une fois. ' +
            'Rattachez-le pour qu\\'ils partagent le même. ' + coutRemap + coutResa +
            '</span>' +
            '<button type="button" onclick="window._bhRegrouper()" style="border:1px solid ' + V.orFilet +
            ';background:#fff;color:' + V.or + ';font-family:' + V.sans + ';font-size:12.5px;font-weight:500;' +
            'padding:7px 12px;border-radius:8px;cursor:pointer;white-space:nowrap;flex:none;">Rattacher</button></div>';
        }
      }
    } catch (eReg) {}

    modal.innerHTML = carte(540,`;

/* ── 2. Affichage ────────────────────────────────────────────────── */
const A2 = `' + noteAdresse + noteImmeuble + lignes + '`;
const N2 = `' + noteAdresse + noteRegroupement + noteImmeuble + lignes + '`;

/* ── 3. L'action ─────────────────────────────────────────────────── */
const A3 = `    window._bhAdresse = function () {`;

const N3 = `    window._bhRegrouper = async function () {
      var cible = window._bhRegCible;
      if (!cible) return;
      modal.innerHTML = carte(420,
        '<div style="padding:40px;text-align:center;">' +
        '<div style="width:22px;height:22px;margin:0 auto;border:2px solid ' + V.ligne + ';border-top-color:' + V.vert +
        ';border-radius:50%;animation:bhspin .8s linear infinite;"></div>' +
        '<div style="margin-top:14px;font-size:13.5px;color:' + V.encre + ';">Rattachement en cours…</div>' +
        '<div style="margin-top:6px;font-size:12.5px;color:' + V.t3 + ';">Ne fermez pas cette fenêtre.</div></div>');
      try {
        var r = await fetch(API_URL + '/api/properties/' + pid + '/regroupement', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
          body: JSON.stringify({ cible_property_id: cible })
        });
        var d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Rattachement impossible');
        if (typeof loadProperties === 'function') loadProperties().catch(function () {});
        modal.innerHTML = carte(480,
          entete(null, 'Rattaché à l\\'immeuble', esc(d.immeuble_de || '')) +
          '<div style="padding:22px 24px;font-size:14px;color:' + V.t2 + ';line-height:1.6;">' +
          esc(d.message || '') + '</div>' +
          pied('', btnPlein('Voir les plateformes', 'window._bhRetourPlateformes()')));
        window._bhRetourPlateformes = function () { ecranPlateformes(modal, pid, pname); };
      } catch (e) {
        modal.innerHTML = carte(480,
          entete(null, 'Le rattachement n\\'a pas abouti', null) +
          '<div style="padding:22px 24px;font-size:14px;color:' + V.encre + ';line-height:1.6;">' +
          esc(e.message) + '</div>' +
          pied('', btnFantome('Retour', 'window._bhRetourPlateformes()')));
        window._bhRetourPlateformes = function () { ecranPlateformes(modal, pid, pname); };
      }
    };

    window._bhAdresse = function () {`;

const edits = [
  ['detection et encadre', A1, N1],
  ['affichage', A2, N2],
  ['action de rattachement', A3, N3]
];

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
  console.error('\n  \u2717 Resultat invalide : ' + e.message + '\n    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!ESSAI) fs.writeFileSync(CIBLE, src, 'utf8');

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  Encadre « Rattacher » + action, dans l\'ecran des plateformes.');
console.log('  Syntaxe verifiee.');
console.log('\n  AVANT DE TESTER');
console.log('    1. cp .../regroupement-routes.js routes/');
console.log('    2. dans server.js, avant app.listen() :');
console.log('         require(\'./routes/regroupement-routes\')(app, pool, authenticateToken);');
console.log('    3. la MEME adresse exacte sur les deux logements.');
console.log('\n  A VOIR A L\'ECRAN');
console.log('    SG Etage \u2192 Connecter mes plateformes : un encadre ambre nomme');
console.log('    SG RDC, annonce ce qui devra etre remappe, et propose');
console.log('    « Rattacher ». Apres l\'operation, la fenetre du partenaire');
console.log('    montre la ligne Booking.com de SG RDC — plus de Create.');
console.log('\n    L\'encadre ne s\'affiche PAS si les adresses different : c\'est');
console.log('    le signal que le point 3 n\'est pas fait.');
if (ESSAI) console.log('\n  Relancez sans --essai pour appliquer.');
console.log('');
