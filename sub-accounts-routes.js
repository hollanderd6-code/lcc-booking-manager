// ============================================
// 📋 ROUTES API - GESTION DES SOUS-COMPTES
// À ajouter dans server.js
// ============================================

const bcrypt = require('bcryptjs');
const { 
  authenticateAny,
  requireTeamManagement, 
  requirePermission,
  generateSubAccountToken 
} = require('./sub-accounts-middleware');

function setupSubAccountsRoutes(app, pool, authenticateToken) {

  // ============================================
  // 1. CRÉER UN SOUS-COMPTE
  // ============================================
  
  app.post('/api/sub-accounts/create', authenticateToken, async (req, res) => {
    try {
      const {
        email,
        password,
        firstName,
        lastName,
        role, // 'manager', 'cleaner', 'accountant', 'custom'
        permissions, // Objet avec les permissions
        propertyIds // Array des IDs de propriétés accessibles
      } = req.body;

      // Validation
      if (!email || !password || !firstName || !lastName) {
        return res.status(400).json({ success: false, error: 'Champs obligatoires manquants' });
      }

      // Vérifier que l'email n'existe pas déjà
      const existing = await pool.query(
        'SELECT id FROM sub_accounts WHERE email = $1',
        [email]
      );

      if (existing.rows.length > 0) {
        return res.status(400).json({ success: false, error: 'Cet email est déjà utilisé' });
      }

      // Hash du mot de passe
      const passwordHash = await bcrypt.hash(password, 10);

      // Créer le sous-compte
      const result = await pool.query(`
        INSERT INTO sub_accounts (
          parent_user_id,
          email,
          password_hash,
          first_name,
          last_name,
          role
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, email, first_name, last_name, role
      `, [req.user.id, email, passwordHash, firstName, lastName, role || 'custom']);

      const subAccount = result.rows[0];

      // Déterminer les permissions selon le rôle
      let finalPermissions = {};
      
      if (role === 'custom' && permissions) {
        // Permissions personnalisées (format snake_case depuis le frontend)
        finalPermissions = {
          can_view_reservations: permissions.can_view_reservations || false,
          can_edit_reservations: permissions.can_edit_reservations || false,
          can_create_reservations: permissions.can_create_reservations || false,
          can_view_messages: permissions.can_view_messages || false,
          can_send_messages: permissions.can_send_messages || false,
          can_view_cleaning: permissions.can_view_cleaning || false,
          can_manage_cleaning: permissions.can_manage_cleaning || false,
          can_view_properties: permissions.can_view_properties || false,
          can_edit_properties: permissions.can_edit_properties || false,
          can_view_finances: permissions.can_view_finances || false,
          can_manage_team: false,
          can_view_deposits: permissions.can_view_deposits || false,
          can_manage_locks: permissions.can_manage_locks || false
        };
      } else {
        // Permissions prédéfinies selon le rôle
        switch(role) {
          case 'manager':
            finalPermissions = {
              can_view_reservations: true,
              can_edit_reservations: true,
              can_create_reservations: true,
              can_view_messages: true,
              can_send_messages: true,
              can_view_cleaning: true,
              can_manage_cleaning: true,
              can_view_properties: true,
              can_edit_properties: false,
              can_view_finances: false,
              can_manage_team: false,
              can_view_deposits: false,
              can_manage_locks: false
            };
            break;
            
          case 'cleaner':
            finalPermissions = {
              can_view_reservations: true,
              can_edit_reservations: false,
              can_create_reservations: false,
              can_view_messages: false,
              can_send_messages: false,
              can_view_cleaning: true,
              can_manage_cleaning: true,
              can_view_properties: true,
              can_edit_properties: false,
              can_view_finances: false,
              can_manage_team: false,
              can_view_deposits: false,
              can_manage_locks: false
            };
            break;
            
          case 'accountant':
            finalPermissions = {
              can_view_reservations: true,
              can_edit_reservations: false,
              can_create_reservations: false,
              can_view_messages: false,
              can_send_messages: false,
              can_view_cleaning: false,
              can_manage_cleaning: false,
              can_view_properties: true,
              can_edit_properties: false,
              can_view_finances: true,
              can_manage_team: false,
              can_view_deposits: false,
              can_manage_locks: false
            };
            break;
            
          default:
            finalPermissions = {
              can_view_reservations: false,
              can_edit_reservations: false,
              can_create_reservations: false,
              can_view_messages: false,
              can_send_messages: false,
              can_view_cleaning: false,
              can_manage_cleaning: false,
              can_view_properties: false,
              can_edit_properties: false,
              can_view_finances: false,
              can_manage_team: false,
              can_view_deposits: false,
              can_manage_locks: false
            };
        }
      }

      // Mettre à jour les permissions
      await pool.query(`
        UPDATE sub_account_permissions SET
          can_view_reservations = $1,
          can_edit_reservations = $2,
          can_create_reservations = $3,
          can_view_messages = $4,
          can_send_messages = $5,
          can_view_cleaning = $6,
          can_manage_cleaning = $7,
          can_view_properties = $8,
          can_edit_properties = $9,
          can_view_finances = $10,
          can_manage_team = $11,
          can_view_deposits = $12,
          can_manage_locks = $13
        WHERE sub_account_id = $14
      `, [
        finalPermissions.can_view_reservations,
        finalPermissions.can_edit_reservations,
        finalPermissions.can_create_reservations,
        finalPermissions.can_view_messages,
        finalPermissions.can_send_messages,
        finalPermissions.can_view_cleaning,
        finalPermissions.can_manage_cleaning,
        finalPermissions.can_view_properties,
        finalPermissions.can_edit_properties,
        finalPermissions.can_view_finances,
        finalPermissions.can_manage_team,
        finalPermissions.can_view_deposits,
        finalPermissions.can_manage_locks,
        subAccount.id
      ]);

      // Assigner les propriétés
      if (propertyIds && propertyIds.length > 0) {
        for (const propId of propertyIds) {
          await pool.query(
            'INSERT INTO sub_account_properties (sub_account_id, property_id) VALUES ($1, $2)',
            [subAccount.id, propId]
          );
        }
      }

      console.log(`✅ Sous-compte créé: ${email} (role: ${role})`);

      res.json({
        success: true,
        subAccount: {
          id: subAccount.id,
          email: subAccount.email,
          firstName: subAccount.first_name,
          lastName: subAccount.last_name,
          role: subAccount.role
        }
      });

    } catch (error) {
      console.error('❌ Erreur création sous-compte:', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  });

  // ============================================
  // 2. MODIFIER UN SOUS-COMPTE (NOUVELLE ROUTE)
  // ============================================
  
  app.put('/api/sub-accounts/:id', authenticateToken, async (req, res) => {
    try {
      const subAccountId = parseInt(req.params.id);
      const { email, firstName, lastName, role, propertyIds, permissions } = req.body;
      const parentUserId = req.user.id;
      
      console.log('🔄 Modification sous-compte:', { subAccountId, email, role });
      
      // Vérifier que le sous-compte appartient bien au parent
      const checkOwnership = await pool.query(
        'SELECT id FROM sub_accounts WHERE id = $1 AND parent_user_id = $2',
        [subAccountId, parentUserId]
      );
      
      if (checkOwnership.rows.length === 0) {
        return res.status(403).json({ 
          success: false, 
          error: 'Vous n\'avez pas accès à ce sous-compte' 
        });
      }
      
      // Mettre à jour les informations de base (pas l'email ni le mot de passe)
      await pool.query(
        `UPDATE sub_accounts 
         SET first_name = $1, last_name = $2, role = $3, updated_at = NOW()
         WHERE id = $4`,
        [firstName, lastName, role, subAccountId]
      );
      
      // Déterminer les permissions
      let finalPermissions = {};
      
      if (role === 'custom' && permissions) {
        finalPermissions = {
          can_view_reservations: permissions.can_view_reservations || false,
          can_edit_reservations: permissions.can_edit_reservations || false,
          can_create_reservations: permissions.can_create_reservations || false,
          can_view_messages: permissions.can_view_messages || false,
          can_send_messages: permissions.can_send_messages || false,
          can_view_cleaning: permissions.can_view_cleaning || false,
          can_manage_cleaning: permissions.can_manage_cleaning || false,
          can_view_properties: permissions.can_view_properties || false,
          can_edit_properties: permissions.can_edit_properties || false,
          can_view_finances: permissions.can_view_finances || false,
          can_manage_team: false,
          can_view_deposits: permissions.can_view_deposits || false,
          can_manage_locks: permissions.can_manage_locks || false
        };
      } else {
        // Permissions prédéfinies
        switch(role) {
          case 'manager':
            finalPermissions = {
              can_view_reservations: true,
              can_edit_reservations: true,
              can_create_reservations: true,
              can_view_messages: true,
              can_send_messages: true,
              can_view_cleaning: true,
              can_manage_cleaning: true,
              can_view_properties: true,
              can_edit_properties: false,
              can_view_finances: false,
              can_manage_team: false,
              can_view_deposits: false,
              can_manage_locks: false
            };
            break;
            
          case 'cleaner':
            finalPermissions = {
              can_view_reservations: true,
              can_edit_reservations: false,
              can_create_reservations: false,
              can_view_messages: false,
              can_send_messages: false,
              can_view_cleaning: true,
              can_manage_cleaning: true,
              can_view_properties: true,
              can_edit_properties: false,
              can_view_finances: false,
              can_manage_team: false,
              can_view_deposits: false,
              can_manage_locks: false
            };
            break;
            
          case 'accountant':
            finalPermissions = {
              can_view_reservations: true,
              can_edit_reservations: false,
              can_create_reservations: false,
              can_view_messages: false,
              can_send_messages: false,
              can_view_cleaning: false,
              can_manage_cleaning: false,
              can_view_properties: true,
              can_edit_properties: false,
              can_view_finances: true,
              can_manage_team: false,
              can_view_deposits: false,
              can_manage_locks: false
            };
            break;
        }
      }
      
      // Mettre à jour les permissions
      await pool.query(
        `UPDATE sub_account_permissions 
         SET can_view_reservations = $1,
             can_edit_reservations = $2,
             can_create_reservations = $3,
             can_view_messages = $4,
             can_send_messages = $5,
             can_view_cleaning = $6,
             can_manage_cleaning = $7,
             can_view_properties = $8,
             can_edit_properties = $9,
             can_view_finances = $10,
             can_manage_team = $11,
             can_view_deposits = $12,
             can_manage_locks = $13
         WHERE sub_account_id = $14`,
        [
          finalPermissions.can_view_reservations,
          finalPermissions.can_edit_reservations,
          finalPermissions.can_create_reservations,
          finalPermissions.can_view_messages,
          finalPermissions.can_send_messages,
          finalPermissions.can_view_cleaning,
          finalPermissions.can_manage_cleaning,
          finalPermissions.can_view_properties,
          finalPermissions.can_edit_properties,
          finalPermissions.can_view_finances,
          finalPermissions.can_manage_team,
          finalPermissions.can_view_deposits,
          finalPermissions.can_manage_locks,
          subAccountId
        ]
      );
      
      // Mettre à jour les propriétés accessibles
      if (propertyIds !== undefined) {
        // Supprimer les anciennes associations
        await pool.query(
          'DELETE FROM sub_account_properties WHERE sub_account_id = $1',
          [subAccountId]
        );
        
        // Insérer les nouvelles associations
        if (propertyIds.length > 0) {
          for (const propertyId of propertyIds) {
            await pool.query(
              'INSERT INTO sub_account_properties (sub_account_id, property_id) VALUES ($1, $2)',
              [subAccountId, propertyId]
            );
          }
        }
      }
      
      console.log('✅ Sous-compte modifié:', subAccountId);
      
      res.json({ 
        success: true, 
        message: 'Sous-compte modifié avec succès',
        subAccountId: subAccountId
      });
      
    } catch (error) {
      console.error('❌ Erreur modification sous-compte:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Erreur lors de la modification du sous-compte' 
      });
    }
  });

  // ============================================
  // 3. LISTE DES SOUS-COMPTES
  // ============================================
  
  app.get('/api/sub-accounts/list', authenticateToken, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT 
          sa.id,
          sa.email,
          sa.first_name,
          sa.last_name,
          sa.role,
          sa.is_active,
          sa.created_at,
          sa.last_login,
          
          -- Permissions (format snake_case)
          sp.can_view_reservations,
          sp.can_edit_reservations,
          sp.can_create_reservations,
          sp.can_view_messages,
          sp.can_send_messages,
          sp.can_view_cleaning,
          sp.can_manage_cleaning,
          sp.can_view_finances,
          sp.can_view_properties,
          sp.can_edit_properties,
          sp.can_manage_team,
          sp.can_view_deposits,
          sp.can_manage_locks,
          
          -- Propriétés accessibles
          COALESCE(
            (SELECT array_agg(property_id)
             FROM sub_account_properties 
             WHERE sub_account_id = sa.id),
            ARRAY[]::int[]
          ) as accessible_properties
          
        FROM sub_accounts sa
        LEFT JOIN sub_account_permissions sp ON sa.id = sp.sub_account_id
        WHERE sa.parent_user_id = $1
        ORDER BY sa.created_at DESC
      `, [req.user.id]);

      res.json({
        success: true,
        subAccounts: result.rows
      });

    } catch (error) {
      console.error('❌ Erreur liste sous-comptes:', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  });

  // ============================================
  // 4. MODIFIER LES PERMISSIONS (déprécié, utiliser PUT /:id)
  // ============================================
  
  app.put('/api/sub-accounts/:id/permissions', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const { permissions, propertyIds } = req.body;

      // Vérifier que le sous-compte appartient bien à l'utilisateur
      const check = await pool.query(
        'SELECT id FROM sub_accounts WHERE id = $1 AND parent_user_id = $2',
        [id, req.user.id]
      );

      if (check.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Sous-compte introuvable' });
      }

      // Mettre à jour les permissions
      await pool.query(`
        UPDATE sub_account_permissions SET
          can_view_reservations = $1,
          can_edit_reservations = $2,
          can_create_reservations = $3,
          can_view_messages = $4,
          can_send_messages = $5,
          can_view_cleaning = $6,
          can_manage_cleaning = $7,
          can_view_finances = $8,
          can_view_properties = $9,
          can_edit_properties = $10,
          can_manage_team = $11,
          can_view_deposits = $12,
          can_manage_locks = $13,
          updated_at = NOW()
        WHERE sub_account_id = $14
      `, [
        permissions.can_view_reservations || false,
        permissions.can_edit_reservations || false,
        permissions.can_create_reservations || false,
        permissions.can_view_messages || false,
        permissions.can_send_messages || false,
        permissions.can_view_cleaning || false,
        permissions.can_manage_cleaning || false,
        permissions.can_view_finances || false,
        permissions.can_view_properties || false,
        permissions.can_edit_properties || false,
        permissions.can_manage_team || false,
        permissions.can_view_deposits || false,
        permissions.can_manage_locks || false,
        id
      ]);

      // Mettre à jour les propriétés
      if (propertyIds !== undefined) {
        await pool.query('DELETE FROM sub_account_properties WHERE sub_account_id = $1', [id]);

        if (propertyIds.length > 0) {
          for (const propId of propertyIds) {
            await pool.query(
              'INSERT INTO sub_account_properties (sub_account_id, property_id) VALUES ($1, $2)',
              [id, propId]
            );
          }
        }
      }

      console.log(`✅ Permissions mises à jour pour sous-compte ${id}`);

      res.json({ success: true });

    } catch (error) {
      console.error('❌ Erreur mise à jour permissions:', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  });

  // ============================================
  // 5. SUPPRIMER UN SOUS-COMPTE
  // ============================================
  
  app.delete('/api/sub-accounts/:id', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;

      // Vérifier appartenance
      const check = await pool.query(
        'SELECT email FROM sub_accounts WHERE id = $1 AND parent_user_id = $2',
        [id, req.user.id]
      );

      if (check.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Sous-compte introuvable' });
      }

      // Supprimer (CASCADE supprimera permissions et propriétés)
      await pool.query('DELETE FROM sub_accounts WHERE id = $1', [id]);

      console.log(`✅ Sous-compte supprimé: ${check.rows[0].email}`);

      res.json({ success: true });

    } catch (error) {
      console.error('❌ Erreur suppression sous-compte:', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  });

  // ============================================
  // 6. ACTIVER/DÉSACTIVER UN SOUS-COMPTE
  // ============================================
  
  app.put('/api/sub-accounts/:id/toggle', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;

      const result = await pool.query(`
        UPDATE sub_accounts 
        SET is_active = NOT is_active, updated_at = NOW()
        WHERE id = $1 AND parent_user_id = $2
        RETURNING is_active
      `, [id, req.user.id]);

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Sous-compte introuvable' });
      }

      res.json({ 
        success: true, 
        isActive: result.rows[0].is_active 
      });

    } catch (error) {
      console.error('❌ Erreur toggle sous-compte:', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  });

  // ============================================
  // 7. LOGIN SOUS-COMPTE
  // ============================================
  
  app.post('/api/sub-accounts/login', async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ success: false, error: 'Email et mot de passe requis' });
      }

      // Chercher le sous-compte
      const result = await pool.query(`
        SELECT sa.*, sp.*
        FROM sub_accounts sa
        LEFT JOIN sub_account_permissions sp ON sa.id = sp.sub_account_id
        WHERE sa.email = $1 AND sa.is_active = TRUE
      `, [email]);

      if (result.rows.length === 0) {
        return res.status(401).json({ success: false, error: 'Email ou mot de passe incorrect' });
      }

      const subAccount = result.rows[0];

      // Vérifier le mot de passe
      const validPassword = await bcrypt.compare(password, subAccount.password_hash);

      if (!validPassword) {
        return res.status(401).json({ success: false, error: 'Email ou mot de passe incorrect' });
      }

      // Mettre à jour last_login
      await pool.query(
        'UPDATE sub_accounts SET last_login = NOW() WHERE id = $1',
        [subAccount.id]
      );

      // Générer le token
      const token = generateSubAccountToken(subAccount.id);

      console.log(`✅ Connexion sous-compte: ${email}`);

      res.json({
        success: true,
        token,
        subAccount: {
          id: subAccount.id,
          email: subAccount.email,
          firstName: subAccount.first_name,
          lastName: subAccount.last_name,
          role: subAccount.role,
          parentUserId: subAccount.parent_user_id,
          permissions: {
            can_view_reservations: subAccount.can_view_reservations,
            can_edit_reservations: subAccount.can_edit_reservations,
            can_create_reservations: subAccount.can_create_reservations,
            can_view_messages: subAccount.can_view_messages,
            can_send_messages: subAccount.can_send_messages,
            can_view_cleaning: subAccount.can_view_cleaning,
            can_manage_cleaning: subAccount.can_manage_cleaning,
            can_view_finances: subAccount.can_view_finances,
            can_view_properties: subAccount.can_view_properties,
            can_edit_properties: subAccount.can_edit_properties,
            can_manage_team: subAccount.can_manage_team,
            can_view_deposits: subAccount.can_view_deposits,
            can_manage_locks: subAccount.can_manage_locks
          }
        }
      });

    } catch (error) {
      console.error('❌ Erreur login sous-compte:', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  });

  console.log('✅ Routes sous-comptes initialisées');
}

module.exports = { setupSubAccountsRoutes };
