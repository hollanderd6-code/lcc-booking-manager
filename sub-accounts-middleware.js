// ============================================
// 🔐 MIDDLEWARE - GESTION DES SOUS-COMPTES
// Vérification des permissions et authentification
// ============================================

const jwt = require('jsonwebtoken');

// Variable globale pour stocker la pool
let dbPool = null;

/**
 * Initialiser le middleware avec la pool
 */
function initializeMiddleware(pool) {
  dbPool = pool;
}

/**
 * Middleware d'authentification pour sous-comptes
 * Vérifie le token JWT et charge les permissions
 */
async function authenticateSubAccount(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Token manquant' });
    }

    // Décoder le token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Charger les infos du sous-compte avec permissions
    const result = await dbPool.query(`
      SELECT 
        sa.*,
        sp.*,
        ARRAY(SELECT property_id FROM sub_account_properties WHERE sub_account_id = sa.id) as accessible_properties
      FROM sub_accounts sa
      LEFT JOIN sub_account_permissions sp ON sa.id = sp.sub_account_id
      WHERE sa.id = $1 AND sa.is_active = TRUE
    `, [decoded.subAccountId]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Sous-compte introuvable ou inactif' });
    }

    // Attacher les infos au req
    req.subAccount = result.rows[0];
    req.isSubAccount = true;
    req.parentUserId = result.rows[0].parent_user_id;
    
    next();
    
  } catch (error) {
    console.error('Erreur auth sous-compte:', error);
    return res.status(401).json({ error: 'Token invalide' });
  }
}

/**
 * Middleware hybride : accepte user principal OU sous-compte
 */
async function authenticateAny(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Token manquant' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Sous-compte ?
    if (decoded.subAccountId) {
      const result = await dbPool.query(`
        SELECT 
          sa.*,
          sp.*,
          ARRAY(SELECT property_id FROM sub_account_properties WHERE sub_account_id = sa.id) as accessible_properties
        FROM sub_accounts sa
        LEFT JOIN sub_account_permissions sp ON sa.id = sp.sub_account_id
        WHERE sa.id = $1 AND sa.is_active = TRUE
      `, [decoded.subAccountId]);

      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Sous-compte introuvable' });
      }

      req.subAccount = result.rows[0];
      req.isSubAccount = true;
      req.userId = result.rows[0].parent_user_id; // Le parent
      req.parentUserId = result.rows[0].parent_user_id;
      
    } else {
      // User principal
      const result = await dbPool.query('SELECT * FROM users WHERE id = $1', [decoded.userId]);
      
      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Utilisateur introuvable' });
      }

      req.user = result.rows[0];
      req.isSubAccount = false;
      req.userId = decoded.userId;
    }
    
    next();
    
  } catch (error) {
    console.error('Erreur auth:', error);
    return res.status(401).json({ error: 'Token invalide' });
  }
}

/**
 * Vérifier une permission spécifique
 */
function requirePermission(permissionName) {
  return async (req, res, next) => {
    // Si user principal → toujours autorisé
    if (!req.isSubAccount) {
      return next();
    }

    // Si sous-compte → vérifier permission
    const hasPermission = req.subAccount[permissionName];
    
    if (!hasPermission) {
      return res.status(403).json({ 
        error: 'Permission refusée',
        required: permissionName 
      });
    }

    next();
  };
}

/**
 * Vérifier accès à une propriété
 */
async function requirePropertyAccess(req, res, next) {
  const propertyId = req.params.propertyId || req.body.propertyId || req.query.propertyId;
  
  // User principal → accès total
  if (!req.isSubAccount) {
    return next();
  }

  // Sous-compte → vérifier si propriété accessible
  const accessibleProperties = req.subAccount.accessible_properties || [];
  
  // Si aucune restriction (tableau vide) → accès à toutes les propriétés du parent
  if (accessibleProperties.length === 0) {
    return next();
  }

  // Sinon vérifier que la propriété est dans la liste
  if (!accessibleProperties.includes(propertyId)) {
    return res.status(403).json({ 
      error: 'Accès refusé à cette propriété' 
    });
  }

  next();
}

/**
 * Filtrer les propriétés accessibles
 */
function filterAccessibleProperties(properties, subAccount) {
  if (!subAccount) return properties;

  const accessible = subAccount.accessible_properties || [];
  
  // Si pas de restriction → toutes accessibles
  if (accessible.length === 0) return properties;

  // Sinon filtrer
  return properties.filter(p => accessible.includes(p.id));
}

/**
 * Filtrer les réservations accessibles
 */
function filterAccessibleReservations(reservations, subAccount) {
  if (!subAccount) return reservations;

  const accessible = subAccount.accessible_properties || [];
  
  // Si pas de restriction → toutes accessibles
  if (accessible.length === 0) return reservations;

  // Sinon filtrer
  return reservations.filter(r => accessible.includes(r.property_id || r.propertyId));
}

/**
 * Générer un token JWT pour sous-compte
 */
function generateSubAccountToken(subAccountId) {
  const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
  return jwt.sign(
    { subAccountId, type: 'sub_account' },
    secret,
    { expiresIn: '7d' }
  );
}

/**
 * Vérifier si l'utilisateur peut gérer les sous-comptes
 */
function requireTeamManagement(req, res, next) {
  // User principal → toujours autorisé
  if (!req.isSubAccount) {
    return next();
  }

  // Sous-compte → vérifier permission
  if (!req.subAccount.can_manage_team) {
    return res.status(403).json({ 
      error: 'Vous n\'avez pas la permission de gérer l\'équipe' 
    });
  }

  next();
}

module.exports = {
  initializeMiddleware,
  authenticateSubAccount,
  authenticateAny,
  requirePermission,
  requirePropertyAccess,
  requireTeamManagement,
  filterAccessibleProperties,
  filterAccessibleReservations,
  generateSubAccountToken
};
