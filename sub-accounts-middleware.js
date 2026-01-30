// ============================================
// 🔐 MIDDLEWARE POUR SOUS-COMPTES - VERSION CORRIGÉE
// Authentifie les comptes principaux ET les sous-comptes
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
      // 🔧 CORRECTION : Chercher dans sub_account_permissions, pas sub_accounts !
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
      
      // 🔧 CORRECTION : Mapping des permissions
      // Frontend envoie: can_view_reservations
      // DB stocke: can_view_calendar
      const permissionMapping = {
        'can_view_reservations': 'can_view_calendar',
        'can_manage_cleaning': 'can_assign_cleaning'
      };
      
      const dbPermission = permissionMapping[permission] || permission;
      
      if (!permissions[dbPermission]) {
        console.log('❌ Permission refusée:', dbPermission, 'pour sous-compte', req.user.subAccountId);
        return res.status(403).json({ 
          error: 'Permission refusée',
          required: permission
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
 * Usage dans les routes qui ont besoin des données complètes
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
 * Utile pour les routes qui ont besoin d'accéder aux propriétés accessibles, etc.
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

module.exports = { 
  authenticateAny,
  requirePermission,
  generateSubAccountToken,
  getSubAccountData,
  loadSubAccountData,
  filterByAccessibleProperties
};
