#!/usr/bin/env node
/* ============================================================
   Parcours de connexion complet — les quatre plateformes
   ============================================================
   Cible : public/js/bh-ota-connect.js (le parcours REELLEMENT actif ;
   l'ancien openChannexModal de settings.js est ecrase ligne ~526).

   Remplace outils/airbnb-parcours-complet.js, qui ne traitait qu'Airbnb.

   ── LE MANQUE ────────────────────────────────────────────────────
   L'aide s'arretait a l'authentification : « Connect with Airbnb » pour
   Airbnb, « renseignez votre Property ID » pour les autres. Or il reste
   ensuite TROIS gestes, identiques sur les quatre plateformes, que rien
   n'annonce :

     - fermer la fiche par la croix, puis cliquer sur Refresh pour que
       le canal apparaisse dans la liste ;
     - ouvrir la ligne, onglet Mapping, associer le logement ;
     - repondre « Save & Activate » a la question posee.

   Le dernier est le plus couteux a manquer : sans activation, le canal
   existe, le mapping est fait, et rien ne se synchronise. Le client
   croit avoir termine.

   ── LA STRUCTURE RETENUE ─────────────────────────────────────────
   Le fichier ecrivait quatre tableaux presque identiques, dont trois
   fois la meme ligne « Dans Title, donnez un nom... ». Une correction
   en oubliait forcement une.

   Desormais : une TETE par plateforme (comment on s'authentifie, ce qui
   seul differe) et une QUEUE commune (mapper, activer), concatenees.
   Ajouter une plateforme, c'est ajouter une tete.

   ── CE QUI EST PRESERVE ──────────────────────────────────────────
   La formulation de l'etape « Title » est LUE dans le fichier et
   reutilisee telle quelle. Si vous l'avez reecrite localement sans la
   pousser, elle survit — et elle s'applique desormais aux quatre
   plateformes au lieu d'une seule.

   Le script est idempotent : il fonctionne que le patch Airbnb
   precedent ait ete applique ou non.

   Usage :
     node outils/ota-parcours-complet.js --essai
     node outils/ota-parcours-complet.js
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

/* ── Reperage du bloc etapesFenetre ──────────────────────────────── */
const DEBUT = '    var etapesFenetre = ';
const iDebut = src.indexOf(DEBUT);
if (iDebut === -1) {
  console.error('\n  \u2717 « var etapesFenetre = » introuvable. Le fichier a change.');
  console.error('      grep -n "etapesFenetre" public/js/bh-ota-connect.js\n');
  process.exit(1);
}
const iFin = src.indexOf('];', iDebut);
if (iFin === -1) {
  console.error('\n  \u2717 Fin du bloc etapesFenetre introuvable. Arret.\n');
  process.exit(1);
}
const blocAncien = src.slice(iDebut, iFin + 2);

/* ── Extraction de l'etape « Title », telle qu'elle est ecrite ───── */
const lignes = blocAncien.split('\n');
const ligneTitre = lignes.find((l) => l.indexOf("g('Title')") !== -1);
if (!ligneTitre) {
  console.error('\n  \u2717 L\'etape « Title » n\'a pas ete trouvee dans le bloc.');
  console.error('    Elle doit etre preservee : arret plutot que de l\'ecraser.\n');
  process.exit(1);
}
// On garde l'expression JS exacte, sans l'indentation ni la virgule finale.
const exprTitre = ligneTitre.trim().replace(/,\s*$/, '');

console.log('\n  Etape « Title » lue dans le fichier et preservee :');
console.log('    ' + exprTitre.slice(0, 120) + (exprTitre.length > 120 ? '…' : ''));

/* ── Le nouveau bloc ─────────────────────────────────────────────── */
const blocNouveau = `    /* Le parcours dans la fenetre Channex se decompose en deux parties :
       une TETE propre a chaque plateforme — la seule chose qui differe, c'est
       la facon de s'authentifier — et une QUEUE identique partout : mapper
       l'annonce, puis activer le canal. Ecrire la queue une seule fois evite
       qu'une correction n'en oublie trois.

       L'etape « Title » est commune aux quatre : un seul endroit a modifier. */
    var etapeTitre = ${exprTitre};

    var teteCanal = {
      ABB: ['Cliquez sur ' + g('Create') + '.',
            'Dans ' + g('Channel') + ', choisissez ' + g('Airbnb') + '.',
            etapeTitre,
            'Cliquez sur ' + g('Save') + ', puis descendez et cliquez sur le bouton rouge ' + g('Connect with Airbnb') + '.',
            'Autorisez la connexion sur Airbnb, puis revenez sur cette fenêtre.'],
      BDC: ['Cliquez sur ' + g('Create') + '.',
            'Dans ' + g('Channel') + ', choisissez ' + g('Booking.com') + '.',
            etapeTitre,
            'Cliquez sur ' + g('Save') + ', puis renseignez votre ' + g('Property ID') + ' : le numéro affiché en haut de votre extranet, à côté du nom de l\\'établissement.'],
      EXP: ['Cliquez sur ' + g('Create') + '.',
            'Dans ' + g('Channel') + ', choisissez ' + g('Expedia') + '.',
            etapeTitre,
            'Cliquez sur ' + g('Save') + ', puis renseignez votre ' + g('Property ID') + ' : il se trouve dans les paramètres de votre logement sur ' + g('Expedia Partner Central') + '.'],
      VRB: ['Cliquez sur ' + g('Create') + '.',
            'Dans ' + g('Channel') + ', choisissez ' + g('Abritel / VRBO') + '.',
            etapeTitre,
            'Cliquez sur ' + g('Save') + ', puis renseignez votre ' + g('Property ID') + ' : il est visible dans l\\'URL de votre annonce.']
    };

    var teteGenerique = ['Cliquez sur ' + g('Create') + '.',
      'Dans ' + g('Channel') + ', choisissez ' + g(p.label) + '.',
      etapeTitre,
      'Cliquez sur ' + g('Save') + ', puis renseignez votre ' + g('Property ID') + '.'];

    /* Identique sur les quatre plateformes. La derniere etape est la plus
       couteuse a manquer : sans activation, le canal existe, le mapping est
       fait, et rien ne remonte. */
    var queueCanal = [
      'Fermez la fiche avec la croix ' + g('✕') + ' en haut à gauche, puis cliquez sur ' + g('Refresh') + ' : votre canal apparaît dans la liste.',
      'Ouvrez la ligne, allez dans l\\'onglet ' + g('Mapping') + ', choisissez votre logement en face de ' + g('Not mapped') + ', puis ' + g('Save') + '.',
      'À la question ' + g('Activate Channel') + ', répondez ' + g('Save &amp; Activate') + ' — sans cette activation, le canal existe mais rien ne se synchronise.'
    ];

    var etapesFenetre = (teteCanal[code] || teteGenerique).concat(queueCanal);`;

src = src.slice(0, iDebut) + blocNouveau + src.slice(iFin + 2);

/* ── Le bandeau « photo de profil », Airbnb seul ─────────────────── */
if (src.indexOf('bandeauPhoto') === -1) {
  const A2 = '    var cadre = function (interieur) {';
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

  if (src.split(A2).length - 1 !== 1) {
    console.error('\n  \u2717 « var cadre = function (interieur) { » : ancre non unique. Arret.\n');
    process.exit(1);
  }
  src = src.split(A2).join(N2);

  const A3 = `'color:' + V.t2 + ';line-height:1.5;">' + aide + bandeauNom +`;
  if (src.split(A3).length - 1 !== 1) {
    console.error('\n  \u2717 Point d\'affichage du bandeau introuvable. Arret.\n');
    process.exit(1);
  }
  src = src.split(A3).join(`'color:' + V.t2 + ';line-height:1.5;">' + aide + bandeauNom + bandeauPhoto +`);
  console.log('\n  Bandeau « photo de profil » ajoute (Airbnb seul).');
} else {
  console.log('\n  Bandeau « photo de profil » deja present — conserve.');
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
console.log('  Les quatre plateformes vont desormais jusqu\'a l\'activation :');
console.log('    Airbnb ........ 8 etapes (OAuth + mapping + activation)');
console.log('    Booking.com ... 7 etapes (Property ID extranet)');
console.log('    Expedia ....... 7 etapes (Property ID Partner Central)');
console.log('    Abritel/VRBO .. 7 etapes (Property ID dans l\'URL)');
console.log('\n  Quatre tableaux presque identiques deviennent une tete par');
console.log('  plateforme + une queue commune. L\'etape « Title » n\'est plus');
console.log('  ecrite qu\'une fois, et s\'applique aux quatre.');
console.log('\n  Syntaxe verifiee : le fichier reste du JavaScript valide.');
console.log('\n  A VOIR A L\'ECRAN — ouvrez les quatre :');
console.log('    Airbnb : bouton rouge en 4, puis croix/Refresh, Mapping,');
console.log('             Save & Activate. Encadre ambre present.');
console.log('    Booking.com, Expedia, Abritel : Property ID en 4, puis la');
console.log('             meme fin. Encadre ambre ABSENT.');
if (ESSAI) console.log('\n  Relancez sans --essai pour appliquer.');
console.log('');
