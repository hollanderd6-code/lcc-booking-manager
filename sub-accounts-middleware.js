// ============================================
// 🔐 MIDDLEWARE POUR SOUS-COMPTES - VERSION 6
// Authentifie les comptes principaux ET les sous-comptes
// Gestion des permissions pour calendrier, nettoyage ET messages
// ============================================

const jwt = require('jsonwebtoken');

/**
 * Génère un token JWT pour un sous-compte
 */
function generateSubAccountToken(subAccountId) {
  const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
  
  return jwt.sign(
    {
      subAccountId: subAccountId,
      type: 'sub_account'
    },
    secret,
    { expiresIn: '7d' }
  );
}

/**
 * Authentifie n'importe quel type de compte (principal ou sous-compte)
 * Compatible avec authenticateToken existant
 */
function authenticateAny(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Token manquant' });
  }
  
  const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
  
  try {
    const decoded = jwt.verify(token, secret);
    
    // ✅ Détecter le type de compte
    if (decoded.type === 'sub_account') {
      // C'est un sous-compte
      req.user = { 
        id: null,
        subAccountId: decoded.subAccountId,
        type: 'sub',
        isSubAccount: true
      };
      console.log('🔓 Sous-compte authentifié:', decoded.subAccountId);
    } else {
      // C'est un compte principal
      req.user = decoded;
      req.user.type = 'main';
      req.user.isSubAccount = false;
      console.log('🔓 Compte principal authentifié:', decoded.id);
    }
    
    next();
  } catch (err) {
    console.error('❌ Erreur auth:', err.message);
    return res.status(403).json({ error: 'Token invalide' });
  }
}

/**
 * Vérifie qu'un sous-compte a une permission spécifique
 * Usage: app.get('/api/messages', authenticateAny, requirePermission(pool, 'can_view_messages'), ...)
 */
function requirePermission(pool, permission) {
  return async (req, res, next) => {
    // Si compte principal, on laisse passer
    if (!req.user.isSubAccount) {
      console.log('✅ Compte principal - permission accordée');
      return next();
    }
    
    // Si sous-compte, vérifier la permission
    try {
      const { rows } = await pool.query(`
        SELECT sp.* 
        FROM sub_account_permissions sp
        JOIN sub_accounts sa ON sa.id = sp.sub_account_id
        WHERE sa.id = $1 AND sa.is_active = TRUE
      `, [req.user.subAccountId]);
      
      if (rows.length === 0) {
        console.log('❌ Sous-compte introuvable ou inactif:', req.user.subAccountId);
        return res.status(404).json({ error: 'Sous-compte introuvable' });
      }
      
      const permissions = rows[0];
      
      // 🔧 Mapping des permissions (frontend → DB)
      const permissionMapping = {
        // Calendrier & Réservations (existant)
        'can_view_reservations': 'can_view_calendar',
        'can_manage_cleaning': 'can_assign_cleaning',
        
        // Messages
        'can_view_conversations': 'can_view_messages',
        'can_send_messages': 'can_send_messages',
        'can_mark_read': 'can_view_messages', // Inclus dans view_messages
        'can_delete_conversations': 'can_delete_messages',
        'can_generate_booking_messages': 'can_send_messages', // Inclus dans send_messages
        
        // Ménages
        'can_view_cleaning': 'can_view_cleaning',
        'can_assign_cleaning': 'can_assign_cleaning',
        
        // Logements
        'can_view_properties': 'can_view_properties',
        'can_edit_properties': 'can_edit_properties',
        'can_delete_properties': 'can_delete_properties',
        
        // Cautions
        'can_view_deposits': 'can_view_deposits',
        'can_manage_deposits': 'can_manage_deposits',
        
        // Serrures connectées
        'can_view_smart_locks': 'can_view_smart_locks',
        'can_manage_smart_locks': 'can_manage_smart_locks',
        
        // Factures
        'can_view_invoices': 'can_view_invoices',
        'can_manage_invoices': 'can_manage_invoices'
      };
      
      const dbPermission = permissionMapping[permission] || permission;
      
      if (!permissions[dbPermission]) {
        console.log('❌ Permission refusée:', dbPermission, 'pour sous-compte', req.user.subAccountId);
        return res.status(403).json({ 
          error: 'Permission refusée',
          required: permission,
          message: `Vous n'avez pas la permission: ${permission}`
        });
      }
      
      console.log('✅ Permission accordée:', dbPermission, 'pour sous-compte', req.user.subAccountId);
      next();
    } catch (err) {
      console.error('❌ Erreur vérification permission:', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  };
}

/**
 * Récupère les informations complètes d'un sous-compte (avec permissions)
 */
async function getSubAccountData(pool, subAccountId) {
  const { rows } = await pool.query(`
    SELECT 
      sa.*,
      sp.*,
      sa.parent_user_id
    FROM sub_accounts sa
    LEFT JOIN sub_account_permissions sp ON sa.id = sp.sub_account_id
    WHERE sa.id = $1 AND sa.is_active = TRUE
  `, [subAccountId]);
  
  if (rows.length === 0) {
    return null;
  }
  
  return rows[0];
}

/**
 * Middleware qui charge les données du sous-compte dans req.subAccountData
 */
function loadSubAccountData(pool) {
  return async (req, res, next) => {
    if (!req.user.isSubAccount) {
      return next();
    }
    
    try {
      req.subAccountData = await getSubAccountData(pool, req.user.subAccountId);
      
      if (!req.subAccountData) {
        return res.status(404).json({ error: 'Sous-compte introuvable' });
      }
      
      // Charger aussi les propriétés accessibles
      const { rows } = await pool.query(
        'SELECT property_id FROM sub_account_properties WHERE sub_account_id = $1',
        [req.user.subAccountId]
      );
      
      req.subAccountData.accessible_property_ids = rows.map(r => r.property_id);
      
      next();
    } catch (err) {
      console.error('❌ Erreur chargement données sous-compte:', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  };
}

/**
 * Filtre les résultats pour ne retourner que les données des propriétés accessibles
 */
function filterByAccessibleProperties(data, req) {
  // Si compte principal, tout passer
  if (!req.user.isSubAccount) {
    return data;
  }
  
  // Si sous-compte sans restriction (aucune propriété spécifiée = accès à tout)
  if (!req.subAccountData.accessible_property_ids || 
      req.subAccountData.accessible_property_ids.length === 0) {
    return data;
  }
  
  // Filtrer selon les propriétés accessibles
  if (Array.isArray(data)) {
    return data.filter(item => 
      req.subAccountData.accessible_property_ids.includes(item.property_id)
    );
  }
  
  return data;
}

/**
 * Récupère l'ID utilisateur réel (compte principal ou parent du sous-compte)
 * Utile pour les requêtes qui ont besoin de l'owner_id
 */
async function getRealUserId(pool, req) {
  if (!req.user.isSubAccount) {
    return req.user.id;
  }
  
  // Récupérer le parent_user_id du sous-compte
  const { rows } = await pool.query(
    'SELECT parent_user_id FROM sub_accounts WHERE id = $1',
    [req.user.subAccountId]
  );
  
  if (rows.length === 0) {
    throw new Error('Sous-compte introuvable');
  }
  
  return rows[0].parent_user_id;
}

module.exports = { 
  authenticateAny,
  requirePermission,
  generateSubAccountToken,
  getSubAccountData,
  loadSubAccountData,
  filterByAccessibleProperties,
  getRealUserId
};
