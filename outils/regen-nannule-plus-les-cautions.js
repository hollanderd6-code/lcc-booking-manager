#!/usr/bin/env node
/* ============================================================
   outils/regen-nannule-plus-les-cautions.js
   Un cron de rafraichissement de lien annulait des cautions
   ============================================================
   Cible : server.js — regenStripeSession() (~29905)

   ── CE QUE FAISAIT LE CODE ──────────────────────────────────────
       const propRow = await pool.query('SELECT * FROM properties WHERE id = $1', [propertyId])
         .catch(() => ({ rows: [] }));
       const prop = propRow.rows[0] || {};

       if (!prop.id) {
         console.warn(`... logement ${propertyId} introuvable, caution annulee`);
         await pool.query('UPDATE deposits SET status = $1 ...', ['cancelled', record.id])
           .catch(() => {});
         return null;
       }

   ── LES TROIS DEFAUTS ───────────────────────────────────────────
   1. Le .catch sur le SELECT. Toute erreur de base — coupure reseau,
      timeout, pool sature — renvoie zero ligne. Le code en conclut que le
      logement n'existe pas et annule la caution. Un incident passager
      d'une seconde suffit a detruire une caution valide.

   2. L'annulation elle-meme. Ce cron a une seule tache : regenerer un lien
      Stripe expire. Annuler une caution est une decision commerciale, avec
      un effet sur l'argent du voyageur et de l'hote. Elle ne peut pas etre
      prise par un job de maintenance sur la foi d'une jointure vide.

      Dans les logs de production, deux cautions ont ete annulees ainsi :
        bhgpay_f4876d0f... — logement u_mmtl7m45-sg-rdc-2
        bhgpay_077955a4... — logement u_mmtl7m45-sg-etage
      Or ces identifiants n'existent pas dans la table properties : les
      logements ont ete recrees sous le compte proprietaire avec d'autres
      ids. Le logement n'avait pas disparu — c'est la reference qui etait
      perimee. La caution, elle, etait bien reelle.

   3. Le .catch sur l'UPDATE. L'annulation echouait silencieusement, ou
      reussissait silencieusement : aucune trace exploitable.

   ── CE QUE FAIT LE CORRECTIF ────────────────────────────────────
   On distingue les deux situations que le code confondait :

     - la requete echoue        → on ne conclut rien, on saute ce tour.
                                  Le lien sera regenere au passage suivant.
     - le logement est absent   → on saute aussi, en le disant clairement,
                                  et on NE TOUCHE PAS au statut.

   Dans les deux cas la caution reste dans son etat : visible, en attente,
   rattrapable a la main. Un lien perime se repare ; une caution annulee,
   non.

   ── CE QUE CE SCRIPT NE FAIT PAS ────────────────────────────────
   Il ne restaure pas les cautions deja annulees. Pour les retrouver :

     SELECT id, property_id, amount_cents, status, updated_at
       FROM deposits
      WHERE status = 'cancelled'
        AND property_id NOT IN (SELECT id FROM properties)
      ORDER BY updated_at DESC;

   Chacune doit etre examinee avant d'etre remise en 'pending' : le
   voyageur est peut-etre parti depuis.

   Il ne corrige pas non plus la cause d'origine — des lignes qui pointent
   vers des ids de logement perimes. C'est un nettoyage de donnees a part.

   Usage :
     node outils/regen-nannule-plus-les-cautions.js --essai
     node outils/regen-nannule-plus-les-cautions.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'server.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

function unique(src, texte, quoi) {
  const n = src.split(texte).length - 1;
  if (n === 0) echec(quoi + ' introuvable. server.js a change depuis la lecture.');
  if (n > 1) echec(quoi + ' present ' + n + ' fois — ancre ambigue, je m\'arrete.');
}

if (!fs.existsSync(CIBLE)) echec('server.js introuvable. Lancez depuis la racine du projet.');

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('[REGEN] lecture du logement impossible') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

const A_BLOC = `  // Récupérer le logement pour le nom
  const propRow = await pool.query('SELECT * FROM properties WHERE id = $1', [propertyId]).catch(() => ({ rows: [] }));
  const prop = propRow.rows[0] || {};

  // Si le logement n'existe pas en DB, on annule la caution et on skip
  if (!prop.id) {
    console.warn(\`⚠️ [REGEN] \${record.id} ignoré — logement \${propertyId} introuvable, caution annulée\`);
    await pool.query('UPDATE deposits SET status = $1, updated_at = NOW() WHERE id = $2', ['cancelled', record.id]).catch(() => {});
    return null;
  }`;

const N_BLOC = `  /* Récupérer le logement pour le nom.

     Le .catch(() => ({ rows: [] })) qui se trouvait ici confondait deux
     situations très différentes : « le logement n'existe pas » et « je n'ai
     pas réussi à le lire ». Une coupure réseau ou un timeout renvoyait zéro
     ligne, et le code en concluait la disparition du logement.

     On laisse donc l'erreur remonter comme telle, et on la traite à part. */
  let prop = {};
  let lectureOk = true;
  try {
    const propRow = await pool.query('SELECT * FROM properties WHERE id = $1', [propertyId]);
    prop = propRow.rows[0] || {};
  } catch (e) {
    lectureOk = false;
    console.warn(\`⚠️ [REGEN] lecture du logement impossible pour \${record.id} (\${propertyId}) : \${e.message}\`);
  }

  /* Requête en échec : on ne conclut rien. Le lien sera régénéré au passage
     suivant du cron — un lien périmé de quelques heures se répare tout seul. */
  if (!lectureOk) return null;

  /* Logement réellement absent : on saute, et on NE TOUCHE PAS au statut de
     la caution.

     Le code annulait ici la caution (UPDATE deposits SET status = 'cancelled').
     Ce cron n'a qu'une tâche : régénérer un lien Stripe expiré. Annuler une
     caution engage l'argent du voyageur et de l'hôte — ce n'est pas à un job
     de maintenance de le décider sur la foi d'une jointure vide.

     En production, deux cautions bien réelles ont été annulées ainsi, parce
     que leur property_id pointait vers un identifiant périmé : le logement
     avait été recréé sous le compte propriétaire. Le logement n'avait pas
     disparu, c'était la référence qui était fausse.

     La caution reste donc en attente, visible, rattrapable à la main. */
  if (!prop.id) {
    console.warn(\`⚠️ [REGEN] \${record.id} ignoré — logement \${propertyId} introuvable (statut inchangé, à vérifier à la main)\`);
    return null;
  }`;

unique(src, A_BLOC, 'Le bloc de garde de regenStripeSession');
src = src.split(A_BLOC).join(N_BLOC);

try { new Function(src); }
catch (e) { echec("Le resultat n'est pas du JavaScript valide — " + e.message); }

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  const relu = fs.readFileSync(CIBLE, 'utf8');
  if (relu.indexOf('[REGEN] lecture du logement impossible') === -1
      || relu.indexOf("['cancelled', record.id]") !== -1) {
    echec("La correction n'est pas complete dans le fichier apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Le cron de regeneration n\'annule plus aucune caution.');
console.log('  Une erreur de lecture ne vaut plus « logement disparu ».\n');
console.log('  A examiner en base — les cautions deja annulees a tort :');
console.log('    SELECT id, property_id, amount_cents, status, updated_at');
console.log('      FROM deposits');
console.log("     WHERE status = 'cancelled'");
console.log('       AND property_id NOT IN (SELECT id FROM properties)');
console.log('     ORDER BY updated_at DESC;\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
