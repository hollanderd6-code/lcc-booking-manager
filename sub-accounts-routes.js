// ============================================
// 📋 ROUTES API - GESTION DES SOUS-COMPTES
// VERSION COMPATIBLE DB EXISTANTE
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
        role,
        permissions,
        propertyIds
      } = req.body;

      if (!email || !password || !firstName || !lastName) {
        return res.status(400).json({ success: false, error: 'Champs obligatoires manquants' });
      }

      const existing = await pool.query(
        'SELECT id FROM sub_accounts WHERE email = $1',
        [email]
      );

      if (existing.rows.length > 0) {
        return res.status(400).json({ success: false, error: 'Cet email est déjà utilisé' });
      }

      const passwordHash = await bcrypt.hash(password, 10);

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

      // Permissions selon le rôle
      let finalPermissions = {};
      
      if (role === 'custom' && permissions) {
        // MAPPING: Frontend (snake_case) -> DB (noms actuels)
        finalPermissions = {
          can_view_calendar: permissions.can_view_reservations || false,
          can_edit_reservations: permissions.can_edit_reservations || false,
          can_create_reservations: permissions.can_create_reservations || false,
          can_delete_reservations: false,
          can_view_messages: permissions.can_view_messages || false,
          can_send_messages: permissions.can_send_messages || false,
          can_view_cleaning: permissions.can_view_cleaning || false,
          can_assign_cleaning: permissions.can_manage_cleaning || false,
          can_manage_cleaning_staff: false,
          can_view_finances: permissions.can_view_finances || false,
          can_edit_finances: false,
          can_view_properties: permissions.can_view_properties || false,
          can_edit_properties: permissions.can_edit_properties || false,
          can_access_settings: false,
          can_manage_team: false
        };
      } else {
        switch(role) {
          case 'manager':
            finalPermissions = {
              can_view_calendar: true,
              can_edit_reservations: true,
              can_create_reservations: true,
              can_delete_reservations: false,
              can_view_messages: true,
              can_send_messages: true,
              can_view_cleaning: true,
              can_assign_cleaning: true,
              can_manage_cleaning_staff: false,
              can_view_finances: false,
              can_edit_finances: false,
              can_view_properties: true,
              can_edit_properties: false,
              can_access_settings: false,
              can_manage_team: false
            };
            break;
            
          case 'cleaner':
            finalPermissions = {
              can_view_calendar: true,
              can_edit_reservations: false,
              can_create_reservations: false,
              can_delete_reservations: false,
              can_view_messages: false,
              can_send_messages: false,
              can_view_cleaning: true,
              can_assign_cleaning: true,
              can_manage_cleaning_staff: false,
              can_view_finances: false,
              can_edit_finances: false,
              can_view_properties: true,
              can_edit_properties: false,
              can_access_settings: false,
              can_manage_team: false
            };
            break;
            
          case 'accountant':
            finalPermissions = {
              can_view_calendar: true,
              can_edit_reservations: false,
              can_create_reservations: false,
              can_delete_reservations: false,
              can_view_messages: false,
              can_send_messages: false,
              can_view_cleaning: false,
              can_assign_cleaning: false,
              can_manage_cleaning_staff: false,
              can_view_finances: true,
              can_edit_finances: false,
              can_view_properties: true,
              can_edit_properties: false,
              can_access_settings: false,
              can_manage_team: false
            };
            break;
        }
      }

      await pool.query(`
        UPDATE sub_account_permissions SET
          can_view_calendar = $1,
          can_edit_reservations = $2,
          can_create_reservations = $3,
          can_delete_reservations = $4,
          can_view_messages = $5,
          can_send_messages = $6,
          can_view_cleaning = $7,
          can_assign_cleaning = $8,
          can_manage_cleaning_staff = $9,
          can_view_finances = $10,
          can_edit_finances = $11,
          can_view_properties = $12,
          can_edit_properties = $13,
          can_access_settings = $14,
          can_manage_team = $15
        WHERE sub_account_id = $16
      `, [
        finalPermissions.can_view_calendar,
        finalPermissions.can_edit_reservations,
        finalPermissions.can_create_reservations,
        finalPermissions.can_delete_reservations,
        finalPermissions.can_view_messages,
        finalPermissions.can_send_messages,
        finalPermissions.can_view_cleaning,
        finalPermissions.can_assign_cleaning,
        finalPermissions.can_manage_cleaning_staff,
        finalPermissions.can_view_finances,
        finalPermissions.can_edit_finances,
        finalPermissions.can_view_properties,
        finalPermissions.can_edit_properties,
        finalPermissions.can_access_settings,
        finalPermissions.can_manage_team,
        subAccount.id
      ]);

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
  // 2. MODIFIER UN SOUS-COMPTE (ROUTE PUT)
  // ============================================
  
  app.put('/api/sub-accounts/:id', authenticateToken, async (req, res) => {
    try {
      const subAccountId = parseInt(req.params.id);
      const { firstName, lastName, role, propertyIds, permissions } = req.body;
      const parentUserId = req.user.id;
      
      console.log('🔄 Modification sous-compte:', { subAccountId, role });
      
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
      
      await pool.query(
        `UPDATE sub_accounts 
         SET first_name = $1, last_name = $2, role = $3, updated_at = NOW()
         WHERE id = $4`,
        [firstName, lastName, role, subAccountId]
      );
      
      // Permissions
      let finalPermissions = {};
      
      if (role === 'custom' && permissions) {
        finalPermissions = {
          can_view_calendar: permissions.can_view_reservations || false,
          can_edit_reservations: permissions.can_edit_reservations || false,
          can_create_reservations: permissions.can_create_reservations || false,
          can_delete_reservations: false,
          can_view_messages: permissions.can_view_messages || false,
          can_send_messages: permissions.can_send_messages || false,
          can_view_cleaning: permissions.can_view_cleaning || false,
          can_assign_cleaning: permissions.can_manage_cleaning || false,
          can_manage_cleaning_staff: false,
          can_view_finances: permissions.can_view_finances || false,
          can_edit_finances: false,
          can_view_properties: permissions.can_view_properties || false,
          can_edit_properties: permissions.can_edit_properties || false,
          can_access_settings: false,
          can_manage_team: false
        };
      } else {
        switch(role) {
          case 'manager':
            finalPermissions = {
              can_view_calendar: true,
              can_edit_reservations: true,
              can_create_reservations: true,
              can_delete_reservations: false,
              can_view_messages: true,
              can_send_messages: true,
              can_view_cleaning: true,
              can_assign_cleaning: true,
              can_manage_cleaning_staff: false,
              can_view_finances: false,
              can_edit_finances: false,
              can_view_properties: true,
              can_edit_properties: false,
              can_access_settings: false,
              can_manage_team: false
            };
            break;
            
          case 'cleaner':
            finalPermissions = {
              can_view_calendar: true,
              can_edit_reservations: false,
              can_create_reservations: false,
              can_delete_reservations: false,
              can_view_messages: false,
              can_send_messages: false,
              can_view_cleaning: true,
              can_assign_cleaning: true,
              can_manage_cleaning_staff: false,
              can_view_finances: false,
              can_edit_finances: false,
              can_view_properties: true,
              can_edit_properties: false,
              can_access_settings: false,
              can_manage_team: false
            };
            break;
            
          case 'accountant':
            finalPermissions = {
              can_view_calendar: true,
              can_edit_reservations: false,
              can_create_reservations: false,
              can_delete_reservations: false,
              can_view_messages: false,
              can_send_messages: false,
              can_view_cleaning: false,
              can_assign_cleaning: false,
              can_manage_cleaning_staff: false,
              can_view_finances: true,
              can_edit_finances: false,
              can_view_properties: true,
              can_edit_properties: false,
              can_access_settings: false,
              can_manage_team: false
            };
            break;
        }
      }
      
      await pool.query(
        `UPDATE sub_account_permissions 
         SET can_view_calendar = $1,
             can_edit_reservations = $2,
             can_create_reservations = $3,
             can_delete_reservations = $4,
             can_view_messages = $5,
             can_send_messages = $6,
             can_view_cleaning = $7,
             can_assign_cleaning = $8,
             can_manage_cleaning_staff = $9,
             can_view_finances = $10,
             can_edit_finances = $11,
             can_view_properties = $12,
             can_edit_properties = $13,
             can_access_settings = $14,
             can_manage_team = $15
         WHERE sub_account_id = $16`,
        [
          finalPermissions.can_view_calendar,
          finalPermissions.can_edit_reservations,
          finalPermissions.can_create_reservations,
          finalPermissions.can_delete_reservations,
          finalPermissions.can_view_messages,
          finalPermissions.can_send_messages,
          finalPermissions.can_view_cleaning,
          finalPermissions.can_assign_cleaning,
          finalPermissions.can_manage_cleaning_staff,
          finalPermissions.can_view_finances,
          finalPermissions.can_edit_finances,
          finalPermissions.can_view_properties,
          finalPermissions.can_edit_properties,
          finalPermissions.can_access_settings,
          finalPermissions.can_manage_team,
          subAccountId
        ]
      );
      
      if (propertyIds !== undefined) {
        await pool.query(
          'DELETE FROM sub_account_properties WHERE sub_account_id = $1',
          [subAccountId]
        );
        
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
        message: 'Sous-compte modifié avec succès'
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
          
          -- Permissions (noms DB actuels)
          sp.can_view_calendar,
          sp.can_edit_reservations,
          sp.can_create_reservations,
          sp.can_delete_reservations,
          sp.can_view_messages,
          sp.can_send_messages,
          sp.can_view_cleaning,
          sp.can_assign_cleaning,
          sp.can_manage_cleaning_staff,
          sp.can_view_finances,
          sp.can_edit_finances,
          sp.can_view_properties,
          sp.can_edit_properties,
          sp.can_access_settings,
          sp.can_manage_team,
          
          -- Propriétés accessibles (array de TEXT/VARCHAR, pas INTEGER)
          COALESCE(
            (SELECT array_agg(property_id)
             FROM sub_account_properties 
             WHERE sub_account_id = sa.id),
            ARRAY[]::text[]
          ) as accessible_properties
          
        FROM sub_accounts sa
        LEFT JOIN sub_account_permissions sp ON sa.id = sp.sub_account_id
        WHERE sa.parent_user_id = $1
        ORDER BY sa.created_at DESC
      `, [req.user.id]);

      // MAPPING: DB -> Frontend (pour compatibilité)
      const mappedResults = result.rows.map(row => ({
        ...row,
        // Ajouter les noms attendus par le frontend
        can_view_reservations: row.can_view_calendar,
        can_manage_cleaning: row.can_assign_cleaning,
        can_view_deposits: false, // À ajouter dans la DB plus tard
        can_manage_locks: false   // À ajouter dans la DB plus tard
      }));

      res.json({
        success: true,
        subAccounts: mappedResults
      });

    } catch (error) {
      console.error('❌ Erreur liste sous-comptes:', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  });

  // ============================================
  // 4. SUPPRIMER UN SOUS-COMPTE
  // ============================================
  
  app.delete('/api/sub-accounts/:id', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;

      const check = await pool.query(
        'SELECT email FROM sub_accounts WHERE id = $1 AND parent_user_id = $2',
        [id, req.user.id]
      );

      if (check.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Sous-compte introuvable' });
      }

      await pool.query('DELETE FROM sub_accounts WHERE id = $1', [id]);

      console.log(`✅ Sous-compte supprimé: ${check.rows[0].email}`);

      res.json({ success: true });

    } catch (error) {
      console.error('❌ Erreur suppression sous-compte:', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  });

  // ============================================
  // 5. ACTIVER/DÉSACTIVER UN SOUS-COMPTE
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
  // 6. LOGIN SOUS-COMPTE
  // ============================================
  
  app.post('/api/sub-accounts/login', async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ success: false, error: 'Email et mot de passe requis' });
      }

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

      const validPassword = await bcrypt.compare(password, subAccount.password_hash);

      if (!validPassword) {
        return res.status(401).json({ success: false, error: 'Email ou mot de passe incorrect' });
      }

      await pool.query(
        'UPDATE sub_accounts SET last_login = NOW() WHERE id = $1',
        [subAccount.id]
      );

      const token = generateSubAccountToken(subAccount.id);

      console.log(`✅ Connexion sous-compte: ${email}`);
      console.log('🔍 SubAccount object keys:', Object.keys(subAccount));
      console.log('🔍 can_view_calendar:', subAccount.can_view_calendar);
      console.log('🔍 can_view_messages:', subAccount.can_view_messages);

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
            // MAPPING: DB -> Frontend
            can_view_reservations: subAccount.can_view_calendar,
            can_edit_reservations: subAccount.can_edit_reservations,
            can_create_reservations: subAccount.can_create_reservations,
            can_view_messages: subAccount.can_view_messages,
            can_send_messages: subAccount.can_send_messages,
            can_view_cleaning: subAccount.can_view_cleaning,
            can_manage_cleaning: subAccount.can_assign_cleaning,
            can_view_finances: subAccount.can_view_finances,
            can_view_properties: subAccount.can_view_properties,
            can_edit_properties: subAccount.can_edit_properties,
            can_manage_team: subAccount.can_manage_team,
            can_view_deposits: false, // À ajouter
            can_manage_locks: false   // À ajouter
          }
        }
      });

    } catch (error) {
      console.error('❌ Erreur login sous-compte:', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  });
// ============================================
// 🔧 ROUTE À AJOUTER DANS sub-accounts-routes.js
// Pour récupérer les propriétés accessibles d'un sous-compte
// ============================================

// Ajouter cette route dans la fonction setupSubAccountsRoutes()

app.get('/api/sub-accounts/accessible-properties', authenticateToken, async (req, res) => {
  try {
    // Si c'est un compte principal, il a accès à tout
    if (!req.user.isSubAccount) {
      const propertiesResult = await pool.query(
        'SELECT id FROM properties WHERE user_id = $1',
        [req.user.id]
      );
      
      return res.json({
        success: true,
        propertyIds: propertiesResult.rows.map(r => r.id),
        hasFullAccess: true
      });
    }

    // Si c'est un sous-compte, récupérer ses propriétés autorisées
    const result = await pool.query(`
      SELECT property_id
      FROM sub_account_properties
      WHERE sub_account_id = $1
    `, [req.user.subAccountId]);

    const propertyIds = result.rows.map(r => r.property_id);

    // Si aucune restriction (tableau vide en DB) = accès à toutes les propriétés du parent
    if (propertyIds.length === 0) {
      const subAccountResult = await pool.query(
        'SELECT parent_user_id FROM sub_accounts WHERE id = $1',
        [req.user.subAccountId]
      );

      if (subAccountResult.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Sous-compte introuvable' });
      }

      const parentUserId = subAccountResult.rows[0].parent_user_id;

      const allPropertiesResult = await pool.query(
        'SELECT id FROM properties WHERE user_id = $1',
        [parentUserId]
      );

      return res.json({
        success: true,
        propertyIds: allPropertiesResult.rows.map(r => r.id),
        hasFullAccess: true
      });
    }

    // Sinon, retourner les propriétés spécifiques
    res.json({
      success: true,
      propertyIds: propertyIds,
      hasFullAccess: false
    });

  } catch (error) {
    console.error('❌ Erreur accessible-properties:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

console.log('✅ Route accessible-properties ajoutée');
  console.log('✅ Routes sous-comptes initialisées');
}

module.exports = { setupSubAccountsRoutes };
