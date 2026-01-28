// ============================================
// 🔐 ROUTES API - GESTION DES SOUS-COMPTES
// À ajouter dans server.js
// ============================================
const bcrypt = require('bcryptjs');
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
        return res.status(400).json({ error: 'Champs obligatoires manquants' });
      }

      // Vérifier que l'email n'existe pas déjà
      const existing = await pool.query(
        'SELECT id FROM sub_accounts WHERE email = $1',
        [email]
      );

      if (existing.rows.length > 0) {
        return res.status(400).json({ error: 'Cet email est déjà utilisé' });
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

      // Si rôle custom et permissions fournies, les mettre à jour
      if (role === 'custom' && permissions) {
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
          permissions.canViewCalendar || false,
          permissions.canEditReservations || false,
          permissions.canCreateReservations || false,
          permissions.canDeleteReservations || false,
          permissions.canViewMessages || false,
          permissions.canSendMessages || false,
          permissions.canViewCleaning || false,
          permissions.canAssignCleaning || false,
          permissions.canManageCleaningStaff || false,
          permissions.canViewFinances || false,
          permissions.canEditFinances || false,
          permissions.canViewProperties || false,
          permissions.canEditProperties || false,
          permissions.canAccessSettings || false,
          permissions.canManageTeam || false,
          subAccount.id
        ]);
      }

      // Assigner les propriétés
      if (propertyIds && propertyIds.length > 0) {
        const values = propertyIds.map((propId, i) => 
          `(${subAccount.id}, $${i + 1})`
        ).join(', ');

        await pool.query(
          `INSERT INTO sub_account_properties (sub_account_id, property_id) VALUES ${values}`,
          propertyIds
        );
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
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // ============================================
  // 2. LISTE DES SOUS-COMPTES
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
          
          -- Permissions
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
          
          -- Propriétés accessibles
          COALESCE(
            (SELECT json_agg(json_build_object('id', property_id))
             FROM sub_account_properties 
             WHERE sub_account_id = sa.id),
            '[]'::json
          ) as properties
          
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
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // ============================================
  // 3. MODIFIER LES PERMISSIONS
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
        return res.status(404).json({ error: 'Sous-compte introuvable' });
      }

      // Mettre à jour les permissions
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
          can_manage_team = $15,
          updated_at = NOW()
        WHERE sub_account_id = $16
      `, [
        permissions.canViewCalendar || false,
        permissions.canEditReservations || false,
        permissions.canCreateReservations || false,
        permissions.canDeleteReservations || false,
        permissions.canViewMessages || false,
        permissions.canSendMessages || false,
        permissions.canViewCleaning || false,
        permissions.canAssignCleaning || false,
        permissions.canManageCleaningStaff || false,
        permissions.canViewFinances || false,
        permissions.canEditFinances || false,
        permissions.canViewProperties || false,
        permissions.canEditProperties || false,
        permissions.canAccessSettings || false,
        permissions.canManageTeam || false,
        id
      ]);

      // Mettre à jour les propriétés
      if (propertyIds !== undefined) {
        // Supprimer les anciennes
        await pool.query('DELETE FROM sub_account_properties WHERE sub_account_id = $1', [id]);

        // Ajouter les nouvelles
        if (propertyIds.length > 0) {
          const values = propertyIds.map((propId, i) => 
            `(${id}, $${i + 1})`
          ).join(', ');

          await pool.query(
            `INSERT INTO sub_account_properties (sub_account_id, property_id) VALUES ${values}`,
            propertyIds
          );
        }
      }

      console.log(`✅ Permissions mises à jour pour sous-compte ${id}`);

      res.json({ success: true });

    } catch (error) {
      console.error('❌ Erreur mise à jour permissions:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // ============================================
  // 4. SUPPRIMER UN SOUS-COMPTE
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
        return res.status(404).json({ error: 'Sous-compte introuvable' });
      }

      // Supprimer (CASCADE supprimera permissions et propriétés)
      await pool.query('DELETE FROM sub_accounts WHERE id = $1', [id]);

      console.log(`✅ Sous-compte supprimé: ${check.rows[0].email}`);

      res.json({ success: true });

    } catch (error) {
      console.error('❌ Erreur suppression sous-compte:', error);
      res.status(500).json({ error: 'Erreur serveur' });
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
        return res.status(404).json({ error: 'Sous-compte introuvable' });
      }

      res.json({ 
        success: true, 
        isActive: result.rows[0].is_active 
      });

    } catch (error) {
      console.error('❌ Erreur toggle sous-compte:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // ============================================
  // 6. LOGIN SOUS-COMPTE
  // ============================================
  
  app.post('/api/sub-accounts/login', async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: 'Email et mot de passe requis' });
      }

      // Chercher le sous-compte
      const result = await pool.query(`
        SELECT sa.*, sp.*
        FROM sub_accounts sa
        LEFT JOIN sub_account_permissions sp ON sa.id = sp.sub_account_id
        WHERE sa.email = $1 AND sa.is_active = TRUE
      `, [email]);

      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
      }

      const subAccount = result.rows[0];

      // Vérifier le mot de passe
      const validPassword = await bcrypt.compare(password, subAccount.password_hash);

      if (!validPassword) {
        return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
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
            canViewCalendar: subAccount.can_view_calendar,
            canEditReservations: subAccount.can_edit_reservations,
            canCreateReservations: subAccount.can_create_reservations,
            canDeleteReservations: subAccount.can_delete_reservations,
            canViewMessages: subAccount.can_view_messages,
            canSendMessages: subAccount.can_send_messages,
            canViewCleaning: subAccount.can_view_cleaning,
            canAssignCleaning: subAccount.can_assign_cleaning,
            canManageCleaningStaff: subAccount.can_manage_cleaning_staff,
            canViewFinances: subAccount.can_view_finances,
            canEditFinances: subAccount.can_edit_finances,
            canViewProperties: subAccount.can_view_properties,
            canEditProperties: subAccount.can_edit_properties,
            canAccessSettings: subAccount.can_access_settings,
            canManageTeam: subAccount.can_manage_team
          }
        }
      });

    } catch (error) {
      console.error('❌ Erreur login sous-compte:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  console.log('✅ Routes sous-comptes initialisées');
}

module.exports = { setupSubAccountsRoutes };
