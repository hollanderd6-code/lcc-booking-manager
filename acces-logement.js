/* ============================================================
   acces-logement.js — qui a le droit de toucher à ce logement
   ============================================================
   Trois sortes de comptes accèdent à un logement dans ce produit, et
   un contrôle sur le seul user_id n'en couvre qu'une :

     1. le PROPRIÉTAIRE : properties.user_id = son id ;
     2. un SOUS-COMPTE : le logement est au compte parent, et lui est
        confié par sub_account_properties (ou tout le parc, si aucune
        restriction n'est posée) ;
     3. une AGENCE : compte principal qui gère les comptes d'autres
        utilisateurs par délégation. Le logement appartient à un
        TROISIÈME user_id, celui du client délégant.

   C'est le cas 3 qui manquait : les champs de majoration disparaissaient
   des comptes agences, parce que la route répondait 404 et que le client
   masque ce qu'il ne peut pas enregistrer.

   On reprend ici le mécanisme déjà en place dans server.js
   (getAgencyUserIds, table account_delegations, status 'accepted') plutôt
   que d'en inventer un second : deux règles d'accès qui divergent, c'est
   une faille en préparation.

   Comme les routes récentes de server.js, les comptes délégués sont
   toujours inclus — sans exiger ?agency=all. L'intercepteur qui ajoute ce
   paramètre est justement désactivé sur les pages de réglages, là où se
   règle la majoration.

   RETOUR : l'identifiant du PROPRIÉTAIRE du logement, à utiliser dans le
   WHERE user_id = $2 des requêtes suivantes. null si l'accès est refusé.
   ============================================================ */

'use strict';

async function idsAccessibles(pool, req, getRealUserId) {
  let uid = null;
  if (typeof getRealUserId === 'function') {
    try { uid = await getRealUserId(pool, req); } catch (e) {}
  }
  if (!uid) uid = req.user && (req.user.id || req.user.userId);
  if (!uid) return [];

  const ids = [uid];
  try {
    const { rows } = await pool.query(
      `SELECT delegator_user_id FROM account_delegations
        WHERE delegate_user_id = $1 AND status = 'accepted'`,
      [uid]
    );
    rows.forEach((r) => { if (r.delegator_user_id) ids.push(r.delegator_user_id); });
  } catch (e) {
    // Table absente sur une installation sans délégation : pas un incident.
  }
  return ids;
}

async function proprietaireDuLogement(pool, req, property_id, getRealUserId) {
  const ids = await idsAccessibles(pool, req, getRealUserId);
  if (!ids.length) return null;

  const { rows } = await pool.query(
    'SELECT user_id FROM properties WHERE id = $1 AND user_id = ANY($2)',
    [property_id, ids]
  );
  if (rows.length) {
    // Un sous-compte restreint ne voit que les logements qui lui sont confiés.
    if (req.user && req.user.isSubAccount) {
      const { rows: restrictions } = await pool.query(
        'SELECT property_id FROM sub_account_properties WHERE sub_account_id = $1',
        [req.user.subAccountId]
      );
      if (restrictions.length &&
          !restrictions.some((r) => r.property_id === property_id)) {
        return null;
      }
    }
    return rows[0].user_id;
  }

  return null;
}

module.exports = { idsAccessibles, proprietaireDuLogement };
