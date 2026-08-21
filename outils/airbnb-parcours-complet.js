#!/usr/bin/env node
/* ============================================================
   Airbnb — le parcours complet, jusqu'a l'activation
   ============================================================
   Cible : public/js/bh-ota-connect.js (le parcours REELLEMENT actif ;
   l'ancien openChannexModal de settings.js est ecrase ligne ~526).

   ── DEUX MANQUES OBSERVES EN PRODUCTION ──────────────────────────

   1. LE PARCOURS S'ARRETE AU MILIEU.
      L'aide decrit 4 gestes et s'arrete a « Connect with Airbnb ».
      Or apres l'autorisation Airbnb, il reste quatre gestes que rien
      n'annonce : fermer la fiche par la croix, cliquer sur Refresh
      pour que le compte apparaisse, ouvrir Mapping et associer le
      logement, puis repondre « Save & Activate ».
      Sans mapping actif, la connexion existe mais ne synchronise rien :
      le client croit avoir termine alors que rien ne remonte.

   2. LE PREREQUIS QUI FAIT ECHOUER LE CLIC N'EST PAS DIT.
      Airbnb n'accorde pas d'autorisation OAuth a un compte dont le
      profil est incomplet : une PHOTO DE PROFIL est obligatoire. Sans
      elle, « Connect with Airbnb » renvoie sur « Completez votre
      profil » et n'y revient jamais. Cela ne depend pas du nombre
      d'annonces : un compte avec deux annonces publiees echoue tout
      autant. Le client n'a aucun moyen de le deviner.

   ── CE QUE CE SCRIPT NE TOUCHE PAS ───────────────────────────────
   Les etapes 1 a 3 sont laissees telles quelles, y compris leur
   formulation : elle a pu etre modifiee localement sans etre poussee.
   Le script n'ajoute qu'apres la 4e etape, et le bandeau photo.
   Les parcours Booking.com, Expedia et Abritel ne sont pas modifies.

   Usage :
     node outils/airbnb-parcours-complet.js --essai
     node outils/airbnb-parcours-complet.js
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
const avant = src;

/* ── 1. Les quatre etapes manquantes, apres « Connect with Airbnb » ──
   On ancre sur la 4e etape d'Airbnb uniquement : « descendez et cliquez
   sur le bouton rouge » n'existe que dans la branche ABB. */
const A1 = `         'Cliquez sur ' + g('Save') + ', puis descendez et cliquez sur le bouton rouge ' + g('Connect with Airbnb') + '.']`;

const N1 = `         'Cliquez sur ' + g('Save') + ', puis descendez et cliquez sur le bouton rouge ' + g('Connect with Airbnb') + '.',
         'Autorisez la connexion sur Airbnb, puis revenez sur cette fenêtre.',
         'Fermez la fiche avec la croix ' + g('✕') + ' en haut à gauche, puis cliquez sur ' + g('Refresh') + ' : votre compte Airbnb apparaît dans la liste.',
         'Ouvrez la ligne, allez dans l\\'onglet ' + g('Mapping') + ', choisissez votre logement en face de ' + g('Not mapped') + ', puis ' + g('Save') + '.',
         'À la question ' + g('Activate Channel') + ', répondez ' + g('Save &amp; Activate') + ' — sans cette activation, rien ne se synchronise.']`;

/* ── 2. Le bandeau photo de profil, avant cadre() ─────────────────── */
const A2 = `    var cadre = function (interieur) {`;

const N2 = `    /* Airbnb refuse l'autorisation si le profil du compte est incomplet :
       une photo de profil est obligatoire. Sans elle, « Connect with Airbnb »
       renvoie sur l'onboarding Airbnb et n'y revient jamais — le client croit
       a une panne. On le dit ici, juste avant le clic concerne, et seulement
       pour Airbnb : les autres plateformes n'ont pas cette contrainte. */
    var bandeauPhoto = code === 'ABB'
      ? '<div style="display:flex;align-items:flex-start;gap:11px;background:' + V.orFond +
        ';border:1px solid ' + V.orFilet + ';border-radius:10px;padding:11px 13px;margin-top:10px;">' +
        '<i class="fas fa-circle-exclamation" style="color:' + V.or + ';font-size:14px;margin-top:2px;flex:none;"></i>' +
        '<span style="flex:1;color:' + V.or + ';line-height:1.5;">' +
        '<strong style="font-weight:600;">Votre compte Airbnb doit avoir une photo de profil.</strong> ' +
        'Sans elle, Airbnb affiche « Complétez votre profil » au lieu de l\\'écran d\\'autorisation, ' +
        'et la connexion ne peut pas aboutir — même avec des annonces publiées.' +
        '</span>' +
        '<a href="https://www.airbnb.fr/account-settings/personal-info" target="_blank" rel="noopener" ' +
        'style="border:1px solid ' + V.orFilet + ';background:#fff;color:' + V.or + ';font-family:' + V.sans +
        ';font-size:12.5px;font-weight:500;padding:7px 12px;border-radius:8px;text-decoration:none;' +
        'white-space:nowrap;flex:none;">Vérifier mon profil</a></div>'
      : '';

    var cadre = function (interieur) {`;

/* ── 3. L'affichage du bandeau dans la bande d'aide ───────────────── */
const A3 = `'color:' + V.t2 + ';line-height:1.5;">' + aide + bandeauNom +`;
const N3 = `'color:' + V.t2 + ';line-height:1.5;">' + aide + bandeauNom + bandeauPhoto +`;

const edits = [
  ['les quatre etapes manquantes', A1, N1],
  ['le bandeau photo de profil', A2, N2],
  ['l\'affichage du bandeau', A3, N3]
];

if (src.indexOf('bandeauPhoto') !== -1 && src.indexOf('Save & Activate') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* Chaque ancre doit apparaitre EXACTEMENT une fois. Un fichier modifie
   entre-temps fait echouer le script plutot que de produire un resultat
   a moitie applique. */
for (const [nom, ancien] of edits) {
  const n = src.split(ancien).length - 1;
  if (n !== 1) {
    console.error('\n  \u2717 ' + nom + ' : ' + n + ' occurrence(s), 1 attendue.');
    console.error('    Le fichier a change. Reperez l\'endroit a la main :');
    console.error('      grep -n "Connect with Airbnb" public/js/bh-ota-connect.js');
    console.error('      grep -n "var cadre = function" public/js/bh-ota-connect.js');
    console.error('\n    Rien n\'a ete ecrit.\n');
    process.exit(1);
  }
}

for (const [, ancien, nouveau] of edits) src = src.split(ancien).join(nouveau);

if (src === avant) {
  console.error('\n  \u2717 Aucun changement produit. Arret.\n');
  process.exit(1);
}

/* Une quote mal fermee casserait toute la connexion OTA. */
try {
  new Function(src);
} catch (e) {
  console.error('\n  \u2717 Le resultat n\'est pas du JavaScript valide : ' + e.message);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!ESSAI) fs.writeFileSync(CIBLE, src, 'utf8');

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  Airbnb : 4 etapes \u2192 8. Le parcours va desormais jusqu\'a');
console.log('  « Save & Activate », qui est le geste qui declenche vraiment');
console.log('  la synchronisation.');
console.log('  Bandeau « photo de profil obligatoire » ajoute, Airbnb seul.');
console.log('\n  PRESERVE : les etapes 1 a 3 ne sont pas reecrites — votre');
console.log('  formulation locale de l\'etape 3 reste intacte.');
console.log('  Booking.com, Expedia et Abritel ne sont pas modifies.');
console.log('\n  Syntaxe verifiee : le fichier reste du JavaScript valide.');
console.log('\n  A VOIR A L\'ECRAN');
console.log('    Mes logements \u2192 un logement \u2192 Airbnb : 8 etapes numerotees,');
console.log('    puis le nom a copier, puis l\'encadre ambre.');
console.log('    Verifiez que Booking.com garde bien ses 4 etapes et n\'a');
console.log('    PAS l\'encadre ambre.');
if (ESSAI) console.log('\n  Relancez sans --essai pour appliquer.');
console.log('');
