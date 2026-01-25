// services/igloohome-service.js
// Service pour communiquer avec l'API Igloohome

const axios = require('axios');

// Configuration API Igloohome
const IGLOO_API_BASE = 'https://api.igloohome.co/v1';
const IGLOO_AUTH_URL = 'https://api.igloohome.co/oauth/token';

class IgloohomeService {
  /**
   * Obtenir un access token OAuth2
   */
  async getAccessToken(clientId, clientSecret) {
    try {
      const response = await axios.post(IGLOO_AUTH_URL, {
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      return {
        access_token: response.data.access_token,
        expires_in: response.data.expires_in,
        token_type: response.data.token_type
      };
    } catch (error) {
      console.error('Erreur obtention token Igloohome:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Erreur d\'authentification Igloohome');
    }
  }

  /**
   * Récupérer la liste des serrures (locks) du compte
   */
  async getLocks(accessToken) {
    try {
      const response = await axios.get(`${IGLOO_API_BASE}/locks`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      return response.data.locks || response.data.data || [];
    } catch (error) {
      console.error('Erreur récupération serrures:', error.response?.data || error.message);
      throw new Error('Erreur de récupération des serrures');
    }
  }

  /**
   * Récupérer les détails d'une serrure
   */
  async getLockDetails(accessToken, lockId) {
    try {
      const response = await axios.get(`${IGLOO_API_BASE}/locks/${lockId}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      return response.data.lock || response.data.data || response.data;
    } catch (error) {
      console.error('Erreur détails serrure:', error.response?.data || error.message);
      throw new Error('Erreur de récupération des détails de la serrure');
    }
  }

  /**
   * Générer un code d'accès PIN pour une période donnée
   */
  async generatePinCode(accessToken, lockId, startTime, endTime, pinName = 'Guest') {
    try {
      // Format des dates : timestamp Unix (secondes)
      const startTimestamp = Math.floor(new Date(startTime).getTime() / 1000);
      const endTimestamp = Math.floor(new Date(endTime).getTime() / 1000);

      const response = await axios.post(`${IGLOO_API_BASE}/locks/${lockId}/pins`, {
        name: pinName,
        start_time: startTimestamp,
        end_time: endTimestamp,
        pin_type: 'period' // Code temporaire
      }, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      return {
        pin_code: response.data.pin || response.data.pin_code,
        pin_id: response.data.id || response.data.pin_id,
        algo_pin: response.data.algo_pin, // Pour les serrures avec algoPIN
        start_time: startTimestamp,
        end_time: endTimestamp
      };
    } catch (error) {
      console.error('Erreur génération PIN:', error.response?.data || error.message);
      throw new Error('Erreur de génération du code PIN');
    }
  }

  /**
   * Supprimer un code PIN
   */
  async deletePin(accessToken, lockId, pinId) {
    try {
      await axios.delete(`${IGLOO_API_BASE}/locks/${lockId}/pins/${pinId}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      return { success: true };
    } catch (error) {
      console.error('Erreur suppression PIN:', error.response?.data || error.message);
      throw new Error('Erreur de suppression du code PIN');
    }
  }

  /**
   * Lister tous les codes PIN d'une serrure
   */
  async listPins(accessToken, lockId) {
    try {
      const response = await axios.get(`${IGLOO_API_BASE}/locks/${lockId}/pins`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      return response.data.pins || response.data.data || [];
    } catch (error) {
      console.error('Erreur liste PIN:', error.response?.data || error.message);
      throw new Error('Erreur de récupération des codes PIN');
    }
  }

  /**
   * Vérifier si le token est encore valide
   */
  isTokenExpired(tokenExpiresAt) {
    if (!tokenExpiresAt) return true;
    const now = new Date();
    const expiresAt = new Date(tokenExpiresAt);
    // Ajouter une marge de 5 minutes
    return now >= new Date(expiresAt.getTime() - 5 * 60 * 1000);
  }

  /**
   * Rafraîchir le token si nécessaire
   */
  async refreshTokenIfNeeded(pool, apiId, clientId, clientSecret, tokenExpiresAt) {
    if (!this.isTokenExpired(tokenExpiresAt)) {
      return null; // Token encore valide
    }

    // Token expiré, en obtenir un nouveau
    const tokenData = await this.getAccessToken(clientId, clientSecret);
    
    // Calculer la date d'expiration
    const expiresAt = new Date(Date.now() + (tokenData.expires_in * 1000));
    
    // Mettre à jour en base
    await pool.query(
      `UPDATE smart_locks_api 
       SET access_token = $1, token_expires_at = $2, updated_at = NOW()
       WHERE id = $3`,
      [tokenData.access_token, expiresAt, apiId]
    );

    return tokenData.access_token;
  }
}

module.exports = new IgloohomeService();
