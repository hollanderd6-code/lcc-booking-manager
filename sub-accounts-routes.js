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

function setupSubAccountsRoutes(app, pool, authenticateToken, sendEmail) {

  // ── Template email sous-compte ──────────────────────────────────────────
  const EMAIL_FROM = process.env.EMAIL_FROM || '"Boostinghost" <no-reply@boostinghost.fr>';
  const APP_URL = process.env.APP_URL || 'https://boostinghost.fr';

  async function sendSubAccountWelcomeEmail({ email, firstName, lastName, password, role, parentName }) {
    const roleLabels = {
      owner: 'Propriétaire',
      cleaner: 'Agent de ménage',
      manager: 'Gestionnaire',
      custom: 'Accès personnalisé'
    };
    const roleLabel = roleLabels[role] || role;

    await sendEmail({
      from: EMAIL_FROM,
      to: email,
      subject: `Vous avez été ajouté à l'équipe Boostinghost`,
      html: `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body{margin:0;padding:0;background:#E8E4DC;font-family:Arial,Helvetica,sans-serif;}
    .wrap{max-width:600px;margin:0 auto;padding:32px 16px;}
    .header{background:#1A7A5E;border-radius:12px 12px 0 0;padding:36px 40px 28px;text-align:center;}
    .header h1{margin:0 0 6px;color:#fff;font-size:24px;font-weight:700;}
    .header p{margin:0;color:rgba(255,255,255,0.72);font-size:14px;}
    .body{background:#fff;padding:36px 40px;border-left:1px solid #DDD8CE;border-right:1px solid #DDD8CE;}
    .footer-bar{background:#1C2B25;border-radius:0 0 12px 12px;padding:20px 40px;text-align:center;}
    .footer-bar p{margin:0 0 4px;font-size:11px;color:rgba(255,255,255,0.38);}
    .footer-bar a{color:rgba(255,255,255,0.38);text-decoration:none;}
    .btn{display:inline-block;background:#1A7A5E;color:#fff !important;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:700;}
    .cta-block{background:#F5F2EC;border:1px solid #DDD8CE;border-radius:10px;padding:24px;text-align:center;margin:24px 0;}
    .cta-block p{margin:0 0 14px;font-size:13px;color:#777;}
    .credentials-box{background:#F0F8F5;border:1.5px solid #1A7A5E;border-radius:10px;padding:20px 24px;margin:20px 0;}
    .cred-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #D1EAE2;font-size:14px;}
    .cred-row:last-child{border-bottom:none;}
    .cred-label{color:#666;font-size:13px;}
    .cred-value{font-weight:700;color:#1A7A5E;font-family:monospace;font-size:14px;}
    .role-badge{display:inline-block;background:#1A7A5E;color:#fff;font-size:12px;font-weight:700;padding:3px 12px;border-radius:20px;}
    p{margin:0 0 14px;font-size:15px;color:#333;line-height:1.65;}
    .signoff{font-size:14px;color:#888;margin-top:24px;}
  </style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div style="display:inline-block;width:52px;height:52px;line-height:52px;background:rgba(255,255,255,0.15);border:1.5px solid rgba(255,255,255,0.25);border-radius:12px;font-size:24px;margin-bottom:14px;">👋</div>
    <h1>Vous rejoignez l'équipe</h1>
    <p>Boostinghost · Gestion locative</p>
  </div>
  <div class="body">
    <p>Bonjour <strong>${firstName}</strong>,</p>
    <p><strong>${parentName || 'Un propriétaire'}</strong> vous a ajouté en tant que <span class="role-badge">${roleLabel}</span> sur Boostinghost.</p>
    <p>Voici vos identifiants de connexion :</p>

    <div class="credentials-box">
      <div class="cred-row">
        <span class="cred-label">Adresse e-mail</span>
        <span class="cred-value">${email}</span>
      </div>
      <div class="cred-row">
        <span class="cred-label">Mot de passe</span>
        <span class="cred-value">${password}</span>
      </div>
    </div>

    <div class="cta-block">
      <p>Accédez à votre espace dès maintenant</p>
      <a href="${APP_URL}/login.html" class="btn">Se connecter →</a>
    </div>

    <p style="font-size:13px;color:#999;">Pour votre sécurité, nous vous recommandons de changer votre mot de passe après votre première connexion.</p>
    <p class="signoff">L'équipe Boostinghost</p>
  </div>
  <div class="footer-bar">
    <p style="font-size:13px;font-weight:700;color:rgba(255,255,255,0.65);letter-spacing:1.5px;margin-bottom:8px;">BOOSTINGHOST</p>
    <p>© ${new Date().getFullYear()} Boostinghost · Tous droits réservés</p>
    <p><a href="mailto:contact@boostinghost.fr">contact@boostinghost.fr</a></p>
  </div>
</div>
</body>
</html>`
    });
  }

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
        propertyIds,
        notifications: notifRaw
      } = req.body;
      const notifications = notifRaw || {};

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
          can_manage_team: false,
          can_view_deposits: permissions.can_view_deposits || false,
          can_manage_deposits: permissions.can_manage_deposits || false,
          can_view_smart_locks: permissions.can_view_smart_locks || false,
          can_manage_smart_locks: permissions.can_manage_smart_locks || false,
          can_view_invoices: permissions.can_view_invoices || false,
          can_manage_invoices: permissions.can_manage_invoices || false,
          can_view_contracts: permissions.can_view_contracts || false,
          visible_kpis: permissions.visible_kpis || {}
        };
      } else {
        switch(role) {
          case 'owner':
            finalPermissions = {
              can_view_calendar: true,
              can_edit_reservations: true,
              can_create_reservations: true,
              can_delete_reservations: true,
              can_view_messages: true,
              can_send_messages: true,
              can_view_cleaning: true,
              can_assign_cleaning: true,
              can_manage_cleaning_staff: false,
              can_view_finances: true,
              can_edit_finances: false,
              can_view_properties: true,
              can_edit_properties: true,
              can_access_settings: false,
              can_manage_team: false,
              can_view_deposits: true,
              can_manage_deposits: true,
              can_view_smart_locks: true,
              can_manage_smart_locks: true,
              can_view_invoices: true,
              can_manage_invoices: true,
              can_view_payments: true,
              can_manage_payments: true,
              can_view_contracts: true,
              visible_kpis: {}
            };
            break;

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
              can_manage_team: false,
              can_view_deposits: true,
              can_manage_deposits: true,
              can_view_smart_locks: false,
              can_manage_smart_locks: false,
              can_view_invoices: false,
              can_manage_invoices: false,
              can_view_payments: true,
              can_manage_payments: true,
              can_view_contracts: true,
              visible_kpis: {}
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
              can_assign_cleaning: false,
              can_manage_cleaning_staff: false,
              can_view_finances: false,
              can_edit_finances: false,
              can_view_properties: false,
              can_edit_properties: false,
              can_access_settings: false,
              can_manage_team: false,
              can_view_deposits: false,
              can_manage_deposits: false,
              can_view_smart_locks: false,
              can_manage_smart_locks: false,
              can_view_invoices: false,
              can_manage_invoices: false,
              can_view_payments: false,
              can_manage_payments: false,
              can_view_contracts: false,
              visible_kpis: {}
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
              can_manage_team: false,
              can_view_deposits: true,
              can_manage_deposits: false,
              can_view_smart_locks: false,
              can_manage_smart_locks: false,
              can_view_invoices: true,
              can_manage_invoices: false,
              can_view_payments: false,
              can_manage_payments: false,
              can_view_contracts: false,
              visible_kpis: {}
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
          can_manage_team = $15,
          can_view_deposits = $17,
          can_manage_deposits = $18,
          can_view_smart_locks = $19,
          can_manage_smart_locks = $20,
          can_view_invoices = $21,
          can_manage_invoices = $22,
          can_view_payments = $23,
          can_manage_payments = $24,
          can_view_contracts = $25,
          notif_sub_new_reservation = $26,
          notif_sub_reservation_cancelled = $27,
          notif_sub_cleaning_assigned = $28,
          notif_sub_cleaning_completed = $29,
          notif_sub_deposit_paid = $30,
          notif_sub_payment_received = $31,
          notif_sub_new_message = $32,
          notif_sub_daily_summary = $33,
          visible_kpis = $34
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
        subAccount.id,
        finalPermissions.can_view_deposits || false,
        finalPermissions.can_manage_deposits || false,
        finalPermissions.can_view_smart_locks || false,
        finalPermissions.can_manage_smart_locks || false,
        finalPermissions.can_view_invoices || false,
        finalPermissions.can_manage_invoices || false,
        finalPermissions.can_view_payments || false,
        finalPermissions.can_manage_payments || false,
        finalPermissions.can_view_contracts || false,
        notifications.notif_sub_new_reservation || false,
        notifications.notif_sub_reservation_cancelled || false,
        notifications.notif_sub_cleaning_assigned || false,
        notifications.notif_sub_cleaning_completed || false,
        notifications.notif_sub_deposit_paid || false,
        notifications.notif_sub_payment_received || false,
        notifications.notif_sub_new_message || false,
        notifications.notif_sub_daily_summary || false,
        JSON.stringify(finalPermissions.visible_kpis || {})
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

      // ── Envoi email de bienvenue au sous-compte ──────────────────────────
      try {
        // Récupérer le nom du compte principal
        const parentResult = await pool.query(
          'SELECT first_name, last_name, company FROM users WHERE id = $1',
          [req.user.id]
        );
        const parent = parentResult.rows[0] || {};
        const parentName = parent.company || [parent.first_name, parent.last_name].filter(Boolean).join(' ') || 'Votre gestionnaire';

        await sendSubAccountWelcomeEmail({
          email,
          firstName,
          lastName,
          password,
          role: role || 'custom',
          parentName
        });
        console.log(`✅ Email de bienvenue envoyé au sous-compte: ${email}`);
      } catch (emailErr) {
        console.error('⚠️ Erreur envoi email sous-compte (non bloquant):', emailErr.message);
      }
      // ────────────────────────────────────────────────────────────────────

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
      const { firstName, lastName, role, propertyIds, permissions, notifications: notifRaw } = req.body;
      const notifications = notifRaw || {};
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
          can_manage_team: false,
          can_view_deposits: permissions.can_view_deposits || false,
          can_manage_deposits: permissions.can_manage_deposits || false,
          can_view_smart_locks: permissions.can_view_smart_locks || false,
          can_manage_smart_locks: permissions.can_manage_smart_locks || false,
          can_view_invoices: permissions.can_view_invoices || false,
          can_manage_invoices: permissions.can_manage_invoices || false,
          can_view_contracts: permissions.can_view_contracts || false,
          visible_kpis: permissions.visible_kpis || {}
        };
      } else {
        switch(role) {
          case 'owner':
            finalPermissions = {
              can_view_calendar: true,
              can_edit_reservations: true,
              can_create_reservations: true,
              can_delete_reservations: true,
              can_view_messages: true,
              can_send_messages: true,
              can_view_cleaning: true,
              can_assign_cleaning: true,
              can_manage_cleaning_staff: false,
              can_view_finances: true,
              can_edit_finances: false,
              can_view_properties: true,
              can_edit_properties: true,
              can_access_settings: false,
              can_manage_team: false,
              can_view_deposits: true,
              can_manage_deposits: true,
              can_view_smart_locks: true,
              can_manage_smart_locks: true,
              can_view_invoices: true,
              can_manage_invoices: true,
              can_view_payments: true,
              can_manage_payments: true,
              can_view_contracts: true,
              visible_kpis: {}
            };
            break;
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
              can_manage_team: false,
              can_view_deposits: true,
              can_manage_deposits: true,
              can_view_smart_locks: false,
              can_manage_smart_locks: false,
              can_view_invoices: false,
              can_manage_invoices: false,
              can_view_payments: true,
              can_manage_payments: true,
              can_view_contracts: true,
              visible_kpis: {}
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
              can_assign_cleaning: false,
              can_manage_cleaning_staff: false,
              can_view_finances: false,
              can_edit_finances: false,
              can_view_properties: false,
              can_edit_properties: false,
              can_access_settings: false,
              can_manage_team: false,
              can_view_deposits: false,
              can_manage_deposits: false,
              can_view_smart_locks: false,
              can_manage_smart_locks: false,
              can_view_invoices: false,
              can_manage_invoices: false,
              can_view_payments: false,
              can_manage_payments: false,
              can_view_contracts: false,
              visible_kpis: {}
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
              can_manage_team: false,
              can_view_deposits: true,
              can_manage_deposits: false,
              can_view_smart_locks: false,
              can_manage_smart_locks: false,
              can_view_invoices: true,
              can_manage_invoices: false,
              can_view_payments: false,
              can_manage_payments: false,
              can_view_contracts: false,
              visible_kpis: {}
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
             can_manage_team = $15,
             can_view_deposits = $17,
             can_manage_deposits = $18,
             can_view_smart_locks = $19,
             can_manage_smart_locks = $20,
             can_view_invoices = $21,
             can_manage_invoices = $22,
             can_view_payments = $23,
             can_manage_payments = $24,
             can_view_contracts = $25,
             notif_sub_new_reservation = $26,
             notif_sub_reservation_cancelled = $27,
             notif_sub_cleaning_assigned = $28,
             notif_sub_cleaning_completed = $29,
             notif_sub_deposit_paid = $30,
             notif_sub_payment_received = $31,
             notif_sub_new_message = $32,
             notif_sub_daily_summary = $33,
             visible_kpis = $34
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
          subAccountId,
          finalPermissions.can_view_deposits || false,
          finalPermissions.can_manage_deposits || false,
          finalPermissions.can_view_smart_locks || false,
          finalPermissions.can_manage_smart_locks || false,
          finalPermissions.can_view_invoices || false,
          finalPermissions.can_manage_invoices || false,
          finalPermissions.can_view_payments || false,
          finalPermissions.can_manage_payments || false,
          finalPermissions.can_view_contracts || false,
          notifications.notif_sub_new_reservation || false,
          notifications.notif_sub_reservation_cancelled || false,
          notifications.notif_sub_cleaning_assigned || false,
          notifications.notif_sub_cleaning_completed || false,
          notifications.notif_sub_deposit_paid || false,
          notifications.notif_sub_payment_received || false,
          notifications.notif_sub_new_message || false,
          notifications.notif_sub_daily_summary || false,
          JSON.stringify(finalPermissions.visible_kpis || {})
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
          sp.can_view_deposits,
          sp.can_manage_deposits,
          sp.can_view_smart_locks,
          sp.can_manage_smart_locks,
          sp.can_view_invoices,
          sp.can_manage_invoices,
          sp.can_view_payments,
          sp.can_manage_payments,
          sp.can_view_contracts,
          sp.notif_sub_new_reservation,
          sp.notif_sub_reservation_cancelled,
          sp.notif_sub_cleaning_assigned,
          sp.notif_sub_cleaning_completed,
          sp.notif_sub_deposit_paid,
          sp.notif_sub_payment_received,
          sp.notif_sub_new_message,
          sp.notif_sub_daily_summary,
          
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
        can_view_deposits: row.can_view_deposits || false,
        can_manage_deposits: row.can_manage_deposits || false,
        can_view_smart_locks: row.can_view_smart_locks || false,
        can_manage_smart_locks: row.can_manage_smart_locks || false,
        can_view_invoices: row.can_view_invoices || false,
        can_manage_invoices: row.can_manage_invoices || false,
        can_view_payments: row.can_view_payments || false,
        can_manage_payments: row.can_manage_payments || false,
        can_view_contracts: row.can_view_contracts || false,
        notif_sub_new_reservation: row.notif_sub_new_reservation || false,
        notif_sub_reservation_cancelled: row.notif_sub_reservation_cancelled || false,
        notif_sub_cleaning_assigned: row.notif_sub_cleaning_assigned || false,
        notif_sub_cleaning_completed: row.notif_sub_cleaning_completed || false,
        notif_sub_deposit_paid: row.notif_sub_deposit_paid || false,
        notif_sub_payment_received: row.notif_sub_payment_received || false,
        notif_sub_new_message: row.notif_sub_new_message || false,
        notif_sub_daily_summary: row.notif_sub_daily_summary || false,
        visible_kpis: (() => { try { return typeof row.visible_kpis === 'string' ? JSON.parse(row.visible_kpis) : (row.visible_kpis || {}); } catch(e) { return {}; } })()
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
        SELECT sa.*, sp.*, u.logo_url as parent_logo_url
        FROM sub_accounts sa
        LEFT JOIN sub_account_permissions sp ON sa.id = sp.sub_account_id
        LEFT JOIN users u ON u.id = sa.parent_user_id
        WHERE LOWER(sa.email) = LOWER($1) AND sa.is_active = TRUE
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
          parentLogoUrl: subAccount.parent_logo_url || null,
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
            can_view_deposits: subAccount.can_view_deposits || false,
            can_manage_deposits: subAccount.can_manage_deposits || false,
            can_view_smart_locks: subAccount.can_view_smart_locks || false,
            can_manage_smart_locks: subAccount.can_manage_smart_locks || false,
            can_view_invoices: subAccount.can_view_invoices || false,
            can_manage_invoices: subAccount.can_manage_invoices || false,
            can_view_payments: subAccount.can_view_payments || false,
            can_manage_payments: subAccount.can_manage_payments || false,
            can_view_contracts: subAccount.can_view_contracts || false,
            visible_kpis: (() => { try { return typeof subAccount.visible_kpis === 'string' ? JSON.parse(subAccount.visible_kpis) : (subAccount.visible_kpis || {}); } catch(e) { return {}; } })(),
            notif_sub_new_reservation: subAccount.notif_sub_new_reservation || false,
            notif_sub_reservation_cancelled: subAccount.notif_sub_reservation_cancelled || false,
            notif_sub_cleaning_assigned: subAccount.notif_sub_cleaning_assigned || false,
            notif_sub_cleaning_completed: subAccount.notif_sub_cleaning_completed || false,
            notif_sub_deposit_paid: subAccount.notif_sub_deposit_paid || false,
            notif_sub_payment_received: subAccount.notif_sub_payment_received || false,
            notif_sub_new_message: subAccount.notif_sub_new_message || false,
            notif_sub_daily_summary: subAccount.notif_sub_daily_summary || false
          }
        }
      });

    } catch (error) {
      console.error('❌ Erreur login sous-compte:', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  });

  // ============================================
  // 7. VÉRIFIER LE TOKEN SUB-ACCOUNT
  // ============================================
  
  app.get('/api/sub-accounts/verify', authenticateAny, async (req, res) => {
    try {
      // Si ce n'est pas un sous-compte
      if (!req.user.isSubAccount) {
        return res.json({
          success: true,
          isSubAccount: false
        });
      }

      // Récupérer les infos du sous-compte
      const result = await pool.query(`
        SELECT sa.*, sp.*
        FROM sub_accounts sa
        LEFT JOIN sub_account_permissions sp ON sa.id = sp.sub_account_id
        WHERE sa.id = $1 AND sa.is_active = TRUE
      `, [req.user.subAccountId]);

      if (result.rows.length === 0) {
        return res.status(401).json({ 
          success: false, 
          error: 'Sous-compte introuvable ou inactif' 
        });
      }

      const subAccount = result.rows[0];

      res.json({
        success: true,
        isSubAccount: true,
        subAccount: {
          id: subAccount.id,
          email: subAccount.email,
          firstName: subAccount.first_name,
          lastName: subAccount.last_name,
          role: subAccount.role
        }
      });

    } catch (error) {
      console.error('❌ Erreur vérification token:', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  });

  // ============================================
  // 8. RÉCUPÉRER LES PROPRIÉTÉS ACCESSIBLES
  // ============================================

  app.get('/api/sub-accounts/accessible-properties', authenticateAny, async (req, res) => {
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

  console.log('✅ Routes sous-comptes initialisées (avec vérification token)');
}

module.exports = { setupSubAccountsRoutes };
