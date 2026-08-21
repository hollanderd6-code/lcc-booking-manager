#!/usr/bin/env node
/* ============================================================
   Majoration par plateforme — le reglage dans l'interface
   ============================================================
   Cible : public/js/bh-ota-connect.js
   Prerequis : outils/majoration-plateformes.js applique, la migration
   passee, et routes/markup-routes.js monte dans server.js.

   ── OU LE REGLAGE EST POSE ───────────────────────────────────────
   Dans l'ecran « Connecter mes plateformes » d'un logement, sur la
   ligne de chaque plateforme. C'est le seul endroit du produit ou l'on
   voit Airbnb et Booking cote a cote pour CE logement : la majoration
   se lit et se compare d'un coup d'oeil.

   L'alternative etait deux champs dans la fiche du logement, qui compte
   deja une quarantaine d'entrees. Un reglage de prix par plateforme
   enterre entre les equipements et les regles de la maison ne serait
   jamais trouve.

   ── LE CHAMP NE S'AFFICHE QUE S'IL PEUT ENREGISTRER ──────────────
   L'ecran interroge d'abord GET /api/properties/:id/markups. Si la
   route n'est pas montee, les champs ne sont pas affiches du tout :
   mieux vaut une fonctionnalite absente qu'une saisie qui disparait
   sans rien dire.

   ── ET APRES LA SAISIE ───────────────────────────────────────────
   Le nouveau prix ne part chez le partenaire qu'a la prochaine
   synchronisation des tarifs. On l'ecrit sous le champ : sans cela
   l'utilisateur verifie sur Airbnb, ne voit rien, et recommence.

   Usage :
     node outils/majoration-interface.js --essai
     node outils/majoration-interface.js
   ============================================================ */

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

if (src.indexOf('_bhMajoration') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* ── 1. Lire les majorations a l'ouverture de l'ecran ────────────── */
const A1 = `    var voisin = voisinConnecte(pid);
    var lignes = PLATEFORMES.map(function (p) {`;

const N1 = `    /* Les majorations de prix par plateforme. Le resultat de cet appel sert
       aussi de test de disponibilite : si la route n'est pas montee cote
       serveur, on n'affiche pas les champs — plutot que de proposer une
       saisie qui ne serait jamais enregistree. */
    var majorations = {};
    var majorationsDispo = false;
    try {
      var rMaj = await fetch(API_URL + '/api/properties/' + pid + '/markups',
        { headers: { Authorization: 'Bearer ' + token() } });
      if (rMaj.ok) {
        var dMaj = await rMaj.json();
        majorations = dMaj.markups || {};
        majorationsDispo = true;
      }
    } catch (eMaj) {}

    var voisin = voisinConnecte(pid);
    var lignes = PLATEFORMES.map(function (p) {`;

/* ── 2. Le champ dans la ligne de la plateforme ──────────────────── */
const A2 = `        '<span style="display:block;font-size:12.5px;color:' + V.t3 + ';margin-top:2px;">' + esc(etat) + '</span></span>' +`;

const N2 = `        '<span style="display:block;font-size:12.5px;color:' + V.t3 + ';margin-top:2px;">' + esc(etat) + '</span></span>' +
        /* Majoration : le prix du calendrier, majore de ce pourcentage, pour
           cette plateforme seulement. Vide ou 0 = prix du calendrier tel quel. */
        (majorationsDispo
          ? '<span style="display:flex;align-items:center;gap:5px;flex:none;">' +
            '<span style="font-size:12.5px;color:' + V.t3 + ';">+</span>' +
            '<input type="number" min="0" max="100" step="0.5" inputmode="decimal" ' +
            'value="' + (majorations[p.code] != null ? majorations[p.code] : '') + '" placeholder="0" ' +
            'aria-label="Majoration de prix pour ' + esc(p.label) + ', en pourcentage" ' +
            'onchange="window._bhMajoration(\\'' + p.code + '\\', this)" ' +
            'style="width:54px;padding:7px;border:1px solid ' + V.ligne + ';border-radius:8px;font-family:' + V.sans +
            ';font-size:13px;text-align:right;color:' + V.encre + ';background:#fff;">' +
            '<span style="font-size:12.5px;color:' + V.t3 + ';">%</span></span>'
          : '') +`;

/* ── 3. L'enregistrement ─────────────────────────────────────────── */
const A3 = `    window._bhOta = function (code) {`;

const N3 = `    /* Enregistrement d'une majoration. Un PATCH par plateforme : deux
       onglets ouverts ne s'ecrasent pas. Le champ passe au vert le temps de
       confirmer, et on rappelle QUAND le prix partira — sinon l'utilisateur
       verifie sur la plateforme, ne voit rien, et recommence. */
    window._bhMajoration = async function (code, champ) {
      var val = String(champ.value || '').trim().replace(',', '.');
      var pct = val === '' ? 0 : parseFloat(val);
      if (!isFinite(pct) || pct < 0 || pct > 100) {
        champ.style.borderColor = '#C0433C';
        toast('La majoration doit être un nombre entre 0 et 100.', 'error');
        return;
      }
      champ.value = pct > 0 ? String(pct) : '';
      champ.disabled = true;
      try {
        var r = await fetch(API_URL + '/api/properties/' + pid + '/markups', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
          body: JSON.stringify({ code: code, pct: pct })
        });
        var d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Enregistrement impossible');
        majorations = d.markups || {};
        champ.style.borderColor = V.vertFilet;
        setTimeout(function () { champ.style.borderColor = V.ligne; }, 1400);
        var nom = (PLATEFORMES.find(function (x) { return x.code === code; }) || {}).label || code;
        toast(pct > 0
          ? nom + ' : +' + pct + '% — appliqué à la prochaine synchronisation des tarifs.'
          : nom + ' : majoration retirée, prix du calendrier.', 'success');
      } catch (e) {
        champ.style.borderColor = '#C0433C';
        toast(e.message, 'error');
      } finally {
        champ.disabled = false;
      }
    };

    window._bhOta = function (code) {`;

const edits = [
  ['lecture des majorations', A1, N1],
  ['champ dans la ligne', A2, N2],
  ['enregistrement', A3, N3]
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
  console.error('\n  \u2717 Le resultat n\'est pas du JavaScript valide : ' + e.message);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!ESSAI) fs.writeFileSync(CIBLE, src, 'utf8');

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  Champ « + __ % » ajoute sur chaque ligne de plateforme, dans');
console.log('  l\'ecran « Connecter mes plateformes » d\'un logement.');
console.log('\n  Syntaxe verifiee : le fichier reste du JavaScript valide.');
console.log('\n  AVANT DE TESTER — trois choses doivent etre en place');
console.log('    1. node outils/majoration-plateformes.js');
console.log('    2. psql "$DATABASE_URL" -f migrations/majoration-plateformes.sql');
console.log('    3. dans server.js, apres pool et le middleware d\'auth :');
console.log('         require(\'./routes/markup-routes\')(app, pool, authenticateToken);');
console.log('       (remplacez authenticateToken par le nom reel de votre');
console.log('        middleware — celui des autres routes /api/properties)');
console.log('\n  A VOIR A L\'ECRAN');
console.log('    Mes logements \u2192 un logement \u2192 Connecter mes plateformes :');
console.log('    chaque ligne a un champ « + __ % ». Saisissez 5 sur Airbnb :');
console.log('    le champ passe au vert et le message dit que le prix partira');
console.log('    a la prochaine synchronisation.');
console.log('\n    SI LES CHAMPS N\'APPARAISSENT PAS : la route n\'est pas montee.');
console.log('    C\'est voulu — un champ qui ne peut pas enregistrer ne doit pas');
console.log('    s\'afficher. Verifiez le point 3.');
if (ESSAI) console.log('\n  Relancez sans --essai pour appliquer.');
console.log('');
