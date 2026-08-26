#!/usr/bin/env node
/* ============================================================
   outils/agence-regroupement.js
   Le regroupement d'immeuble, accessible en mode agence
   ============================================================
   Cible : routes/regroupement-routes.js

   ── CE QUE J'AVAIS ANNONCE, ET CE QUE J'AI TROUVE ────────────────
   J'avais propose un lot de six routes « meme famille ». En les
   lisant, cinq n'en font pas partie :

     · host/properties, host/reservations/:uid/cancel,
       host/pricing/block, host/pricing/weekend
       → espace MARKETPLACE. Elles verifient is_external_host et
         utilisent authenticateToken. Un compte agence n'y accede pas :
         il n'y a rien a corriger, ce sont deux mondes distincts.

     · manual-reservations/delete
       → deja juste. Elle lit account_delegations et construit
         allUserIds. C'est le modele que les autres auraient du suivre.

   Reste une seule route reellement fautive.

   ── LE DEFAUT ────────────────────────────────────────────────────
       SELECT ... FROM properties
        WHERE user_id = $1 AND id = ANY($2::text[])
       [req.user.id, [req.params.id, cible]]

   Un gestionnaire d'agence ne possede aucun de ces deux logements : la
   requete ne remonte rien, et la route repond « Logement introuvable »
   sur un logement bien reel.

   C'est la fonction qui rattache un logement a l'immeuble d'un voisin —
   celle qui evite precisement le probleme que nous avons passe des
   heures a demeler sur Saint Gratien. Un client ne peut donc pas s'en
   servir, et une agence non plus.

   ── LA CORRECTION ────────────────────────────────────────────────
   Le periometre passe du compte connecte a l'ensemble des comptes qu'il
   gere : le sien, plus ceux qui l'ont delegue.

   Une precaution qui compte ici : les DEUX logements doivent appartenir
   au meme proprietaire. Sans cela, une agence pourrait rattacher le
   logement d'un client a l'immeuble d'un autre — leurs prix et leurs
   disponibilites se melangeraient chez Channex. C'est exactement le
   genre de degat qu'on ne detecte qu'apres une reservation.

   Usage :
     node outils/agence-regroupement.js --essai
     node outils/agence-regroupement.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'routes', 'regroupement-routes.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('routes/regroupement-routes.js introuvable. Lancez depuis la racine du projet.');

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('comptesGeres') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

const ANCIEN = `      const { rows } = await pool.query(
        \`SELECT id, name, internal_name, channex_property_id, channex_enabled
           FROM properties
          WHERE user_id = $1 AND id = ANY($2::text[])\`,
        [req.user.id, [req.params.id, cible]]
      );

      const moi = rows.find(r => r.id === req.params.id);
      const autre = rows.find(r => r.id === cible);

      if (!moi)   return res.status(404).json({ error: 'Logement introuvable' });
      if (!autre) return res.status(404).json({ error: 'Logement cible introuvable' });`;

const NOUVEAU = `      /* Un gestionnaire d'agence ne possede pas les logements qu'il gere :
         un filtre sur son seul identifiant repondait « Logement
         introuvable » sur un logement bien reel. On elargit aux comptes
         qui l'ont delegue. */
      const ids = await comptesGeres(pool, req);

      const { rows } = await pool.query(
        \`SELECT id, name, internal_name, channex_property_id, channex_enabled, user_id
           FROM properties
          WHERE user_id = ANY($1::text[]) AND id = ANY($2::text[])\`,
        [ids, [req.params.id, cible]]
      );

      const moi = rows.find(r => r.id === req.params.id);
      const autre = rows.find(r => r.id === cible);

      if (!moi)   return res.status(404).json({ error: 'Logement introuvable' });
      if (!autre) return res.status(404).json({ error: 'Logement cible introuvable' });

      /* Les deux logements doivent etre au MEME proprietaire. Sans cette
         verification, une agence pourrait rattacher le logement d'un client
         a l'immeuble d'un autre : leurs prix et leurs disponibilites se
         melangeraient chez Channex, et on ne s'en apercevrait qu'apres une
         reservation. */
      if (moi.user_id !== autre.user_id) {
        return res.status(409).json({
          error: 'Ces deux logements appartiennent a des comptes differents : ils ne peuvent pas partager un immeuble.'
        });
      }`;

if (src.split(ANCIEN).length - 1 !== 1) {
  echec('Bloc de lecture des logements introuvable. Le fichier a change.');
}
src = src.split(ANCIEN).join(NOUVEAU);

/* Le helper, pose avant le module.exports pour rester dans la portee du
   fichier. Meme forme que dans les autres modules corriges aujourd'hui. */
const A_HELPER = `module.exports = `;
const N_HELPER = `/* Les comptes qu'un utilisateur peut administrer : le sien, et ceux qui
   l'ont explicitement delegue. Meme lecture que manual-reservations/delete,
   qui etait deja juste. */
async function comptesGeres(pool, req) {
  const moi = req.user && (req.user.isSubAccount ? (req.user.parentUserId || req.user.id) : req.user.id);
  if (!moi) return [];
  try {
    const { rows } = await pool.query(
      \`SELECT delegator_user_id FROM account_delegations
        WHERE delegate_user_id = $1 AND status = 'accepted'\`,
      [moi]
    );
    return [moi, ...rows.map((d) => d.delegator_user_id)];
  } catch (e) {
    // Sans delegation lisible, on n'ouvre rien de plus que son propre compte.
    return [moi];
  }
}

module.exports = `;

const nh = src.split(A_HELPER).length - 1;
if (nh !== 1) echec(nh + ' occurrence(s) de module.exports, 1 attendue.');
src = src.split(A_HELPER).join(N_HELPER);

/* Les autres requetes du fichier peuvent porter le meme defaut : on les
   signale sans y toucher, plutot que de corriger a l'aveugle. */
const restes = [];
src.split('\n').forEach((l, i) => {
  if (/req\.user\.id/.test(l) && !/comptesGeres|const moi/.test(l)) {
    restes.push('    ligne ' + (i + 1) + ' : ' + l.trim().slice(0, 76));
  }
});

try { new Function(src); }
catch (e) { echec('Le resultat n\'est pas du JavaScript valide — ' + e.message); }

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('comptesGeres') === -1) {
    echec('La correction n\'est pas dans le fichier apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Le regroupement d\'immeuble accepte les comptes geres.');
console.log('  Un rattachement entre deux comptes differents est refuse.\n');

if (restes.length) {
  console.log('  \u26a0  Autres usages de req.user.id dans ce fichier, non touches :');
  restes.forEach((r) => console.log(r));
  console.log('     Envoyez-les-moi si l\'un d\'eux ecrit en base.\n');
}
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
