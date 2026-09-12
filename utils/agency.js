// Résolution inconditionnelle des comptes délégués.
// À utiliser pour le contrôle d'accès (qui peut agir sur cette ressource ?),
// pas pour le listing optionnel d'affichage (?agency=all → getAgencyUserIds).
async function comptesAutorises(pool, userId) {
  if (!userId) return [];
  try {
    const { rows } = await pool.query(
      `SELECT delegator_user_id FROM account_delegations WHERE delegate_user_id = $1 AND status = 'accepted'`,
      [userId]
    );
    return [userId, ...rows.map(d => d.delegator_user_id)];
  } catch (e) {
    console.error('⚠️ [AGENCY] delegations illisibles pour', userId, ':', e.message);
    return [userId];
  }
}

module.exports = { comptesAutorises };
