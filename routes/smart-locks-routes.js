// routes/smart-locks-routes.js
// Routes API pour la gestion des serrures connectées Igloohome

const express = require('express');
const router = express.Router();
const igloohomeService = require('../services/igloohome-service');

// Helper pour obtenir l'utilisateur depuis le token
async function getUserFromToken(req, pool) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;

  const token = authHeader.replace('Bearer ', '');
  const result = await pool.query('SELECT id FROM users WHERE id = $1', [token]);
  
  if (result.rows.length === 0) return null;
  return result.rows[0];
}

// ============================================
// GET /api/smart-locks/status
// Vérifier le statut de connexion API
// ============================================
router.get('/status', async (req, res) => {
  try {
    const user = await getUserFromToken(req, req.app.locals.pool);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const result = await req.app.locals.pool.query(
      `SELECT id, provider, is_active, created_at, updated_at, token_expires_at
       FROM smart_locks_api
       WHERE user_id = $1 AND provider = 'igloohome'
       ORDER BY created_at DESC
       LIMIT 1`,
      [user.id]
    );

    if (result.rows.length === 0) {
      return res.json({
        connected: false,
        connection: null
      });
    }

    const connection = result.rows[0];
    
    res.json({
      connected: connection.is_active,
      connection: {
        id: connection.id,
        provider: connection.provider,
        is_active: connection.is_active,
        created_at: connection.created_at,
        updated_at: connection.updated_at,
        token_expires_at: connection.token_expires_at
      }
    });
  } catch (error) {
    console.error('Erreur status API:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// POST /api/smart-locks/connect
// Connecter l'API Igloohome
// ============================================
router.post('/connect', async (req, res) => {
  try {
    const user = await getUserFromToken(req, req.app.locals.pool);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { clientId, clientSecret } = req.body;

    if (!clientId || !clientSecret) {
      return res.status(400).json({ error: 'Client ID et Secret requis' });
    }

    // Tester la connexion en obtenant un token
    let tokenData;
    try {
      tokenData = await igloohomeService.getAccessToken(clientId, clientSecret);
    } catch (error) {
      return res.status(400).json({ 
        error: 'Identifiants Igloohome invalides',
        details: error.message
      });
    }

    // Calculer la date d'expiration
    const expiresAt = new Date(Date.now() + (tokenData.expires_in * 1000));

    // Vérifier si une connexion existe déjà
    const existing = await req.app.locals.pool.query(
      'SELECT id FROM smart_locks_api WHERE user_id = $1 AND provider = $2',
      [user.id, 'igloohome']
    );

    if (existing.rows.length > 0) {
      // Mettre à jour
      await req.app.locals.pool.query(
        `UPDATE smart_locks_api 
         SET client_id = $1, client_secret = $2, access_token = $3, 
             token_expires_at = $4, is_active = true, updated_at = NOW()
         WHERE user_id = $5 AND provider = 'igloohome'`,
        [clientId, clientSecret, tokenData.access_token, expiresAt, user.id]
      );
    } else {
      // Créer
      await req.app.locals.pool.query(
        `INSERT INTO smart_locks_api 
         (user_id, provider, client_id, client_secret, access_token, token_expires_at, is_active)
         VALUES ($1, 'igloohome', $2, $3, $4, $5, true)`,
        [user.id, clientId, clientSecret, tokenData.access_token, expiresAt]
      );
    }

    res.json({
      success: true,
      message: 'API Igloohome connectée avec succès'
    });
  } catch (error) {
    console.error('Erreur connexion API:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// POST /api/smart-locks/disconnect
// Déconnecter l'API
// ============================================
router.post('/disconnect', async (req, res) => {
  try {
    const user = await getUserFromToken(req, req.app.locals.pool);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    await req.app.locals.pool.query(
      `UPDATE smart_locks_api 
       SET is_active = false, updated_at = NOW()
       WHERE user_id = $1 AND provider = 'igloohome'`,
      [user.id]
    );

    res.json({
      success: true,
      message: 'API déconnectée'
    });
  } catch (error) {
    console.error('Erreur déconnexion:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// GET /api/smart-locks
// Liste des serrures de l'utilisateur
// ============================================
router.get('/', async (req, res) => {
  try {
    const user = await getUserFromToken(req, req.app.locals.pool);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const result = await req.app.locals.pool.query(
      `SELECT 
        sl.*,
        la.property_id,
        la.id as assignment_id
       FROM smart_locks sl
       LEFT JOIN lock_assignments la ON la.lock_id = sl.id AND la.is_active = true
       WHERE sl.user_id = $1 AND sl.is_active = true
       ORDER BY sl.created_at DESC`,
      [user.id]
    );

    // Enrichir avec les noms de propriétés
    const locks = result.rows.map(lock => {
      let propertyName = null;
      
      if (lock.property_id) {
        // Chercher le nom de la propriété dans PROPERTIES (variable globale du serveur)
        const property = req.app.locals.PROPERTIES?.find(p => p.id === lock.property_id);
        propertyName = property?.name || 'Logement inconnu';
      }

      return {
        ...lock,
        assignment: lock.property_id ? {
          property_id: lock.property_id,
          property_name: propertyName,
          assignment_id: lock.assignment_id
        } : null
      };
    });

    res.json({
      success: true,
      locks: locks
    });
  } catch (error) {
    console.error('Erreur liste serrures:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// POST /api/smart-locks/sync
// Synchroniser les serrures depuis Igloohome
// ============================================
router.post('/sync', async (req, res) => {
  try {
    const user = await getUserFromToken(req, req.app.locals.pool);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    // Récupérer la connexion API
    const apiResult = await req.app.locals.pool.query(
      `SELECT id, client_id, client_secret, access_token, token_expires_at
       FROM smart_locks_api
       WHERE user_id = $1 AND provider = 'igloohome' AND is_active = true`,
      [user.id]
    );

    if (apiResult.rows.length === 0) {
      return res.status(400).json({ error: 'API non connectée' });
    }

    const apiConnection = apiResult.rows[0];

    // Rafraîchir le token si nécessaire
    let accessToken = apiConnection.access_token;
    const refreshedToken = await igloohomeService.refreshTokenIfNeeded(
      req.app.locals.pool,
      apiConnection.id,
      apiConnection.client_id,
      apiConnection.client_secret,
      apiConnection.token_expires_at
    );

    if (refreshedToken) {
      accessToken = refreshedToken;
    }

    // Récupérer les serrures depuis Igloohome
    const locks = await igloohomeService.getLocks(accessToken);

    let added = 0;
    let updated = 0;

    for (const lock of locks) {
      const lockId = lock.id || lock.lock_id;
      const lockName = lock.name || lock.lock_name || 'Serrure sans nom';
      const lockType = lock.type || lock.lock_type || 'Smart Lock';
      const serialNumber = lock.serial_number || lock.sn;
      const batteryLevel = lock.battery_level;

      // Vérifier si existe déjà
      const existing = await req.app.locals.pool.query(
        'SELECT id FROM smart_locks WHERE user_id = $1 AND lock_id = $2',
        [user.id, lockId]
      );

      if (existing.rows.length > 0) {
        // Mettre à jour
        await req.app.locals.pool.query(
          `UPDATE smart_locks 
           SET lock_name = $1, lock_type = $2, serial_number = $3, 
               battery_level = $4, last_sync_at = NOW(), updated_at = NOW()
           WHERE user_id = $5 AND lock_id = $6`,
          [lockName, lockType, serialNumber, batteryLevel, user.id, lockId]
        );
        updated++;
      } else {
        // Créer
        await req.app.locals.pool.query(
          `INSERT INTO smart_locks 
           (user_id, api_id, lock_id, lock_name, lock_type, serial_number, battery_level, last_sync_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
          [user.id, apiConnection.id, lockId, lockName, lockType, serialNumber, batteryLevel]
        );
        added++;
      }
    }

    res.json({
      success: true,
      message: 'Synchronisation réussie',
      added: added,
      updated: updated,
      total: locks.length
    });
  } catch (error) {
    console.error('Erreur sync:', error);
    res.status(500).json({ 
      error: 'Erreur de synchronisation',
      details: error.message
    });
  }
});

// ============================================
// POST /api/smart-locks/assign
// Associer une serrure à un logement
// ============================================
router.post('/assign', async (req, res) => {
  try {
    const user = await getUserFromToken(req, req.app.locals.pool);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { lockId, propertyId } = req.body;

    if (!lockId || !propertyId) {
      return res.status(400).json({ error: 'Lock ID et Property ID requis' });
    }

    // Vérifier que la serrure appartient à l'utilisateur
    const lockResult = await req.app.locals.pool.query(
      'SELECT id FROM smart_locks WHERE id = $1 AND user_id = $2',
      [lockId, user.id]
    );

    if (lockResult.rows.length === 0) {
      return res.status(404).json({ error: 'Serrure introuvable' });
    }

    // Supprimer toute assignation existante pour ce logement
    await req.app.locals.pool.query(
      'DELETE FROM lock_assignments WHERE user_id = $1 AND property_id = $2',
      [user.id, propertyId]
    );

    // Créer la nouvelle assignation
    await req.app.locals.pool.query(
      `INSERT INTO lock_assignments (user_id, property_id, lock_id)
       VALUES ($1, $2, $3)`,
      [user.id, propertyId, lockId]
    );

    res.json({
      success: true,
      message: 'Serrure associée au logement'
    });
  } catch (error) {
    console.error('Erreur assignation:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// POST /api/smart-locks/generate-code
// Générer un code d'accès pour une réservation
// ============================================
router.post('/generate-code', async (req, res) => {
  try {
    const user = await getUserFromToken(req, req.app.locals.pool);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { propertyId, reservationKey, guestName, startDate, endDate } = req.body;

    if (!propertyId || !reservationKey || !startDate || !endDate) {
      return res.status(400).json({ error: 'Données manquantes' });
    }

    // Récupérer la serrure associée au logement
    const lockResult = await req.app.locals.pool.query(
      `SELECT sl.*, sla.client_id, sla.client_secret, sla.access_token, sla.token_expires_at, sla.id as api_id
       FROM smart_locks sl
       JOIN lock_assignments la ON la.lock_id = sl.id
       JOIN smart_locks_api sla ON sla.id = sl.api_id
       WHERE la.property_id = $1 AND la.user_id = $2 AND la.is_active = true AND sla.is_active = true`,
      [propertyId, user.id]
    );

    if (lockResult.rows.length === 0) {
      return res.status(404).json({ error: 'Aucune serrure associée à ce logement' });
    }

    const lock = lockResult.rows[0];

    // Rafraîchir le token si nécessaire
    let accessToken = lock.access_token;
    const refreshedToken = await igloohomeService.refreshTokenIfNeeded(
      req.app.locals.pool,
      lock.api_id,
      lock.client_id,
      lock.client_secret,
      lock.token_expires_at
    );

    if (refreshedToken) {
      accessToken = refreshedToken;
    }

    // Générer le code PIN
    const pinData = await igloohomeService.generatePinCode(
      accessToken,
      lock.lock_id,
      startDate,
      endDate,
      guestName || 'Guest'
    );

    // Sauvegarder en base
    await req.app.locals.pool.query(
      `INSERT INTO access_codes 
       (user_id, lock_id, reservation_key, guest_name, access_code, pin_code, start_date, end_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, reservation_key, lock_id) 
       DO UPDATE SET access_code = $5, pin_code = $6, start_date = $7, end_date = $8, updated_at = NOW()`,
      [
        user.id,
        lock.id,
        reservationKey,
        guestName,
        pinData.pin_id,
        pinData.pin_code || pinData.algo_pin,
        startDate,
        endDate
      ]
    );

    res.json({
      success: true,
      message: 'Code d\'accès généré',
      code: {
        pin_code: pinData.pin_code || pinData.algo_pin,
        algo_pin: pinData.algo_pin,
        start_date: startDate,
        end_date: endDate,
        lock_name: lock.lock_name
      }
    });
  } catch (error) {
    console.error('Erreur génération code:', error);
    res.status(500).json({ 
      error: 'Erreur de génération du code',
      details: error.message
    });
  }
});

module.exports = router;
