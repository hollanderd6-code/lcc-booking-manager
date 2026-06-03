/**
 * SmartLockAdapter — Interface commune pour toutes les marques
 * Chaque marque implémente cette interface.
 */
class SmartLockAdapter {
  constructor(connection, pool) {
    this.connection = connection; // row from smart_lock_connections
    this.pool = pool;
    this.credentials = connection.credentials || {};
    this.userId = connection.user_id;
    this.brand = connection.brand;
  }

  /** Obtenir/renouveler le token d'accès */
  async authenticate() {
    throw new Error(`authenticate() non implémenté pour ${this.brand}`);
  }

  /** Lister toutes les serrures du compte
   * @returns {Array<{deviceId, name, type, model, serialNumber, battery, isOnline, metadata}>}
   */
  async listLocks() {
    throw new Error(`listLocks() non implémenté pour ${this.brand}`);
  }

  /** Générer un code d'accès temporaire
   * @param {Object} lock - row from smart_locks table
   * @param {Object} options - {startDate, endDate, guestName, codeType}
   * @returns {{externalCodeId, code, validFrom, validUntil}}
   */
  async generateCode(lock, options) {
    throw new Error(`generateCode() non implémenté pour ${this.brand}`);
  }

  /** Révoquer/supprimer un code d'accès
   * @param {Object} lock - row from smart_locks table
   * @param {string} externalCodeId - ID du code chez la marque
   * @returns {boolean}
   */
  async revokeCode(lock, externalCodeId) {
    throw new Error(`revokeCode() non implémenté pour ${this.brand}`);
  }

  /** Obtenir le statut d'une serrure (batterie, online…)
   * @param {Object} lock - row from smart_locks table
   * @returns {{battery, isOnline, lastActivity, firmwareVersion}}
   */
  async getLockStatus(lock) {
    throw new Error(`getLockStatus() non implémenté pour ${this.brand}`);
  }

  // ── Utilitaires ──

  /** Sauvegarder les credentials mis à jour (après refresh token) */
  async saveCredentials(newCredentials) {
    this.credentials = { ...this.credentials, ...newCredentials };
    await this.pool.query(
      `UPDATE smart_lock_connections SET credentials = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(this.credentials), this.connection.id]
    );
  }

  /** Helper HTTP avec gestion d'erreurs */
  async apiCall(url, options = {}) {
    const fetch = (await import('node-fetch')).default;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`[${this.brand}] API ${res.status}: ${body.substring(0, 200)}`);
      err.status = res.status;
      err.body = body;
      throw err;
    }

    return res.json();
  }
}

module.exports = SmartLockAdapter;
