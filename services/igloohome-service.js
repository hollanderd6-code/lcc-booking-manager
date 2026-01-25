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
      // Igloohome utilise application/x-www-form-urlencoded
      const params = new URLSearchParams();
      params.append('grant_type', 'client_credentials');
      params.append('client_id', clientId);
      params.append('client_secret', clientSecret);

      const response = await axios.post(IGLOO_AUTH_URL, params, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      return {
        access_token: response.data.access_token,
        expires_in: response.data.expires_in,
        token_type: response.data.token_type
      };
    } catch (error) {
      console.error('Erreur obtention token Igloohome:', error.response?.data || error.message);
      throw new Error(error.response?.data?.error_description || error.response?.data?.message || 'Identifiants Igloohome invalides');
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
      console.error('Erreur récupération locks:', error.response?.data || error.message);
      throw new Error('Erreur lors de la récupération des serrures');
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

      return response.data;
    } catch (error) {
      console.error('Erreur détails lock:', error.response?.data || error.message);
      throw new Error('Erreur lors de la récupération des détails de la serrure');
    }
  }

  /**
   * Générer un code PIN pour une période donnée
   */
  async generatePinCode(accessToken, lockId, startDate, endDate, guestName = 'Guest') {
    try {
      const response = await axios.post(
        `${IGLOO_API_BASE}/locks/${lockId}/pins`,
        {
          name: guestName,
          start_date: startDate,
          end_date: endDate
        },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('Erreur génération PIN:', error.response?.data || error.message);
      throw new Error('Erreur lors de la génération du code PIN');
    }
  }

  /**
   * Supprimer un code PIN
   */
  async deletePin(accessToken, lockId, pinId) {
    try {
      await axios.delete(`${IGLOO_API_BASE}/locks/${lockId}/pins/${pinId}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      return { success: true };
    } catch (error) {
      console.error('Erreur suppression PIN:', error.response?.data || error.message);
      throw new Error('Erreur lors de la suppression du code PIN');
    }
  }

  /**
   * Lister tous les PINs d'une serrure
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
      console.error('Erreur liste PINs:', error.response?.data || error.message);
      throw new Error('Erreur lors de la récupération des codes PIN');
    }
  }

  /**
   * Rafraîchir le token si nécessaire
   */
  async refreshTokenIfNeeded(pool, apiId, clientId, clientSecret, expiresAt) {
    // Vérifier si le token expire dans moins de 5 minutes
    const now = new Date();
    const expiry = new Date(expiresAt);
    const fiveMinutes = 5 * 60 * 1000;

    if (expiry.getTime() - now.getTime() < fiveMinutes) {
      console.log('Token expirant, rafraîchissement...');
      
      const tokenData = await this.getAccessToken(clientId, clientSecret);
      const newExpiresAt = new Date(Date.now() + (tokenData.expires_in * 1000));

      // Mettre à jour en base
      await pool.query(
        'UPDATE smart_locks_api SET access_token = $1, token_expires_at = $2, updated_at = NOW() WHERE id = $3',
        [tokenData.access_token, newExpiresAt, apiId]
      );

      return tokenData.access_token;
    }

    return null;
  }
}

module.exports = new IgloohomeService();
