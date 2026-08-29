#!/usr/bin/env node
/* ============================================================
   outils/channex-tarifs-connexion.js
   Un logement connecte a Channex reste « Tarif ferme » sur Booking
   ============================================================
   Cible : server.js  (route POST /api/channex/connect-property)

   ── LE PROBLEME ─────────────────────────────────────────────────
   Un logement vient d'etre connecte. Cote Booking, il affiche
   « Tarif ferme » sur toute la periode, avec des dizaines de
   « problemes eventuels ». Il est donc invisible a la vente.

   La route /api/channex/connect-property fait, dans l'ordre :
     1. cree la property + room type chez Channex ;
     2. calcule les dates deja reservees ;
     3. pousse la DISPONIBILITE (pushAvailability) ;
     4. enregistre les webhooks bookings et messages ;
     5. installe l'application Messages & Reviews ;
     6. repond « Logement connecte a Channex avec succes ».

   Il manque les TARIFS. Le plan tarifaire est cree chez Channex mais
   ne porte aucun prix. Or une plateforme ne vend pas un plan sans
   tarif : Booking le marque ferme. La disponibilite seule ne suffit
   pas — c'est la difference entre « des chambres sont libres » et
   « voici a quel prix ».

   Le code pour le faire existe deja : triggerChannexRatesSync(), plus
   haut dans server.js, appelee apres chaque modification de prix. Elle
   lit base_price / weekend_price, construit le calendrier tarifaire et
   appelle pushRates + pushRestrictions. Elle n'etait simplement jamais
   declenchee au moment ou l'on en a le plus besoin : la connexion.

   ── CE QUE FAIT CE CORRECTIF ────────────────────────────────────
   1. Appelle triggerChannexRatesSync juste apres la disponibilite. On
      reutilise la fonction existante plutot que de reecrire la
      construction des tarifs : une seule logique de prix dans le
      produit, donc pas deux comportements a maintenir.
   2. Verifie d'abord qu'un prix de base existe. Sans base_price, la
      synchronisation ne pousserait rien et le logement resterait ferme
      sans que personne ne sache pourquoi. Dans ce cas la reponse le DIT.
   3. La reponse de l'API porte desormais tarifs_pousses et, le cas
      echeant, un avertissement lisible par l'interface.

   L'echec du push de tarifs ne fait PAS echouer la connexion : la
   property, les webhooks et la disponibilite sont deja en place cote
   Channex, et renvoyer une erreur laisserait l'utilisateur croire que
   rien n'a ete fait — alors qu'un second essai buterait sur
   « Ce logement est deja connecte a Channex ».

   ── CE QUI RESTE A FAIRE (hors de ce script) ────────────────────
   · La carte du logement continue d'afficher « Connecter mes
     plateformes » alors que le serveur repond « deja connecte ». Elle
     est alimentee par GET /api/properties ; a traiter separement.
   · Les 31 « problemes eventuels » cote Booking peuvent aussi tenir a
     des donnees d'etablissement incompletes (photos, equipements,
     politiques). Le tarif est la cause du blocage, pas forcement la
     seule alerte.

   Usage :
     node outils/channex-tarifs-connexion.js --essai
     node outils/channex-tarifs-connexion.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'server.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('server.js introuvable. Lancez depuis la racine du projet.');
let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('tarifs_pousses') !== -1) {
  console.log('\n  Le correctif est deja en place — rien a faire.\n');
  process.exit(0);
}

/* La fonction reutilisee doit exister, sinon le correctif n'a pas de sens. */
if (src.indexOf('async function triggerChannexRatesSync(') === -1) {
  echec('triggerChannexRatesSync est introuvable dans server.js.');
}

/* ── L'ancre : la fin du push de disponibilite de cette route ──
   « result.channex_property_id » distingue cette occurrence des autres
   appels a pushAvailability du fichier. */
const ANCRE = `    await pushAvailability(pool, {
      property_id,
      channex_property_id: result.channex_property_id,
      channex_room_type_id: result.channex_room_type_id,
      dates_blocked
    });
`;
const n = src.split(ANCRE).length - 1;
if (n !== 1) echec(`Le push de disponibilite de connect-property : ${n} occurrence(s) au lieu d'une.`);

const AJOUT = ANCRE + `
    /* ── Les TARIFS ──────────────────────────────────────────────
       Sans eux, le plan tarifaire existe chez Channex mais ne porte
       aucun prix : Booking affiche « Tarif ferme » et le logement n'est
       pas vendable. La disponibilite seule ne suffit pas.

       triggerChannexRatesSync fait deja ce travail apres chaque
       modification de prix (base_price / weekend_price, overrides,
       regles long sejour) : on la reutilise, pour qu'il n'existe qu'une
       seule logique de tarification dans le produit.

       Un echec ici ne fait pas echouer la connexion : la property, les
       webhooks et la disponibilite sont deja en place cote Channex, et
       un second essai buterait sur « deja connecte a Channex ». */
    let tarifs_pousses = false;
    let avertissement = null;
    try {
      const prixRes = await pool.query('SELECT base_price FROM properties WHERE id = $1', [property_id]);
      const basePrice = prixRes.rows[0] ? prixRes.rows[0].base_price : null;

      if (basePrice == null || !(Number(basePrice) > 0)) {
        // Cas frequent et silencieux : le logement n'a pas encore de prix.
        // On le dit, sinon l'utilisateur voit « connecte » et un logement
        // ferme sur Booking, sans lien evident entre les deux.
        avertissement = "Aucun prix de base n'est defini sur ce logement : les plateformes le laisseront ferme tant qu'un tarif ne sera pas renseigne.";
        console.warn(\`⚠️ [CHANNEX CONNECT] \${property_id} : pas de base_price, aucun tarif pousse\`);
      } else {
        await triggerChannexRatesSync(property_id, user_id);
        tarifs_pousses = true;
        console.log(\`✅ [CHANNEX CONNECT] Tarifs pousses pour \${property_id}\`);
      }
    } catch (rateErr) {
      avertissement = "Les tarifs n'ont pas pu etre envoyes aux plateformes : " + rateErr.message;
      console.error('❌ [CHANNEX CONNECT] push tarifs:', rateErr.message);
    }
`;
src = src.split(ANCRE).join(AJOUT);

/* ── La reponse porte l'information ── */
const R_ANCIEN = `    res.json({
      success: true,
      message: 'Logement connecté à Channex avec succès',
      channex_property_id: result.channex_property_id
    });`;
const nR = src.split(R_ANCIEN).length - 1;
if (nR !== 1) echec(`La reponse de connect-property : ${nR} occurrence(s) au lieu d'une.`);

const R_NOUVEAU = `    res.json({
      success: true,
      message: tarifs_pousses
        ? 'Logement connecté à Channex, disponibilités et tarifs envoyés'
        : 'Logement connecté à Channex — tarifs non envoyés',
      channex_property_id: result.channex_property_id,
      tarifs_pousses,
      ...(avertissement ? { avertissement } : {})
    });`;
src = src.split(R_ANCIEN).join(R_NOUVEAU);

/* ---- Verifications ---- */
try { new Function(src); }
catch (e) { echec('server.js n\'est plus du JavaScript valide — ' + e.message); }

for (const [quoi, aiguille] of [
  ['l\'appel a la synchronisation des tarifs', 'await triggerChannexRatesSync(property_id, user_id);'],
  ['le controle du prix de base', "SELECT base_price FROM properties WHERE id = $1"],
  ['l\'avertissement sans prix', "Aucun prix de base n'est defini"],
  ['le drapeau dans la reponse', 'tarifs_pousses,'],
]) if (src.indexOf(aiguille) === -1) echec(`Verification : ${quoi} est absent du resultat.`);

if (src.split('await triggerChannexRatesSync(property_id, user_id);').length - 1 !== 1) {
  echec('L\'appel a la synchronisation a ete insere plusieurs fois.');
}
/* Le push de disponibilite doit rester AVANT les tarifs. */
if (src.indexOf('dates_blocked\n    });\n\n    /* ── Les TARIFS') === -1) {
  echec('L\'ordre disponibilite puis tarifs n\'est pas celui attendu.');
}
/* Les webhooks ne doivent pas avoir bouge. */
if (src.indexOf('// ✅ Enregistrer les webhooks uniquement si nouvelle property Channex') === -1) {
  echec('Le bloc d\'enregistrement des webhooks a ete perdu.');
}

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('tarifs_pousses') === -1) {
    echec('L\'ajout est absent apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  connect-property pousse desormais les TARIFS apres la disponibilite.');
console.log('  Sans prix de base, la reponse le dit au lieu de laisser le logement');
console.log('  ferme sans explication.');
console.log('');
console.log('  Redemarrez le serveur, puis pour le logement DEJA connecte (la longere');
console.log('  numero 3), la route de connexion refusera de rejouer. Forcez une');
console.log('  synchronisation des tarifs depuis l\'interface — toute modification de');
console.log('  prix declenche triggerChannexRatesSync — ou appelez la route de');
console.log('  synchronisation des tarifs existante.');
console.log('');
console.log('  Verifiez ensuite dans Channex : Property > Rate Plan > les prix');
console.log('  doivent apparaitre. Booking passe de « Tarif ferme » a ouvert dans');
console.log('  les minutes qui suivent.');
console.log('');
console.log('  A SUIVRE : la carte du logement affiche encore « Connecter mes');
console.log('  plateformes » alors que le serveur repond « deja connecte ».\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
