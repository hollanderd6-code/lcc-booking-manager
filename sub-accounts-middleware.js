// ============================================
// 🔐 MIDDLEWARE POUR SOUS-COMPTES
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
      console.log('🔐 Sous-compte authentifié:', decoded.subAccountId);
    } else {
      // C'est un compte principal
      req.user = decoded;
      req.user.type = 'main';
      req.user.isSubAccount = false;
      console.log('🔐 Compte principal authentifié:', decoded.id);
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
      return next();
    }
    
    // Si sous-compte, vérifier la permission
    try {
      const { rows } = await pool.query(
        'SELECT * FROM sub_accounts WHERE id = $1',
        [req.user.subAccountId]
      );
      
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Sous-compte introuvable' });
      }
      
      const subAccount = rows[0];
      
      if (!subAccount[permission]) {
        return res.status(403).json({ 
          error: 'Permission refusée',
          required: permission
        });
      }
      
      next();
    } catch (err) {
      console.error('Erreur vérification permission:', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  };
}

module.exports = { 
  authenticateAny,
  requirePermission,
  generateSubAccountToken
};
