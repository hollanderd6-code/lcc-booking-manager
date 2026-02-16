// ============================================
// 💬 ROUTES API - SUPPORT CHAT
// ============================================

const express = require('express');
const router = express.Router();
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

// Multer pour upload images support
const supportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype.toLowerCase())) {
      return cb(null, true);
    }
    cb(new Error('Format non supporté. Formats acceptés: JPG, PNG, WEBP, GIF'), false);
  }
});

/**
 * Initialiser les tables support en DB
 */
async function initSupportTables(pool) {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS support_conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        subject TEXT DEFAULT 'Support général',
        status TEXT DEFAULT 'open' CHECK (status IN ('open', 'closed', 'waiting')),
        last_message_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS support_messages (
        id SERIAL PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
        sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'admin')),
        sender_id TEXT,
        sender_name TEXT,
        message TEXT,
        image_url TEXT,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_support_messages_conv 
        ON support_messages(conversation_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_support_conversations_user 
        ON support_conversations(user_id);
      CREATE INDEX IF NOT EXISTS idx_support_conversations_status 
        ON support_conversations(status);

      CREATE TABLE IF NOT EXISTS support_admin_tokens (
        id SERIAL PRIMARY KEY,
        device_name TEXT DEFAULT 'Appareil',
        fcm_token TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS support_admin_emails (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        added_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('✅ Tables support_conversations, support_messages & support_admin_tokens OK');
  } catch (err) {
    console.error('❌ Erreur création tables support:', err);
  }
}

/**
 * Setup des routes support
 */
function setupSupportRoutes(app, pool, io, authenticateToken) {

  // ============================================
  // GET /api/support/conversation — Récupérer ou créer la conversation de l'utilisateur
  // ============================================
  app.get('/api/support/conversation', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id || req.user.userId;

      // Chercher une conversation existante (ouverte ou en attente)
      let result = await pool.query(
        `SELECT * FROM support_conversations 
         WHERE user_id = $1 AND status != 'closed'
         ORDER BY updated_at DESC LIMIT 1`,
        [userId]
      );

      let conversation;

      if (result.rows.length === 0) {
        // Créer une nouvelle conversation
        const convId = 'sup_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        const user = req.user;
        const subject = `Support - ${user.firstName || user.email || 'Utilisateur'}`;

        const insertResult = await pool.query(
          `INSERT INTO support_conversations (id, user_id, subject, status, created_at, updated_at, last_message_at)
           VALUES ($1, $2, $3, 'open', NOW(), NOW(), NOW())
           RETURNING *`,
          [convId, userId, subject]
        );
        conversation = insertResult.rows[0];

        // Envoyer un message de bienvenue
        await pool.query(
          `INSERT INTO support_messages (conversation_id, sender_type, sender_name, message, is_read, created_at)
           VALUES ($1, 'admin', 'Support Boostinghost', $2, FALSE, NOW())`,
          [convId, `👋 Bonjour ! Comment pouvons-nous vous aider ?\n\nN'hésitez pas à nous décrire votre problème ou votre question. Vous pouvez aussi envoyer des captures d'écran si nécessaire.\n\nNous vous répondrons dès que possible.`]
        );
      } else {
        conversation = result.rows[0];
      }

      res.json({ conversation });
    } catch (error) {
      console.error('❌ Erreur GET /api/support/conversation:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // ============================================
  // GET /api/support/messages/:conversationId — Récupérer les messages
  // ============================================
  app.get('/api/support/messages/:conversationId', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id || req.user.userId;
      const { conversationId } = req.params;

      // Vérifier que la conversation appartient à l'utilisateur
      const convCheck = await pool.query(
        'SELECT id FROM support_conversations WHERE id = $1 AND user_id = $2',
        [conversationId, userId]
      );
      if (convCheck.rows.length === 0) {
        return res.status(403).json({ error: 'Accès refusé' });
      }

      const result = await pool.query(
        `SELECT * FROM support_messages 
         WHERE conversation_id = $1 
         ORDER BY created_at ASC`,
        [conversationId]
      );

      // Marquer les messages admin comme lus
      await pool.query(
        `UPDATE support_messages 
         SET is_read = TRUE 
         WHERE conversation_id = $1 AND sender_type = 'admin' AND is_read = FALSE`,
        [conversationId]
      );

      res.json({ messages: result.rows });
    } catch (error) {
      console.error('❌ Erreur GET /api/support/messages:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // ============================================
  // POST /api/support/messages — Envoyer un message
  // ============================================
  app.post('/api/support/messages', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id || req.user.userId;
      const { conversationId, message } = req.body;

      if (!conversationId || !message?.trim()) {
        return res.status(400).json({ error: 'Message requis' });
      }

      // Vérifier que la conversation appartient à l'utilisateur
      const convCheck = await pool.query(
        'SELECT id FROM support_conversations WHERE id = $1 AND user_id = $2',
        [conversationId, userId]
      );
      if (convCheck.rows.length === 0) {
        return res.status(403).json({ error: 'Accès refusé' });
      }

      const userName = req.user.firstName 
        ? `${req.user.firstName} ${req.user.lastName || ''}`.trim()
        : (req.user.email || 'Utilisateur');

      // Insérer le message
      const result = await pool.query(
        `INSERT INTO support_messages (conversation_id, sender_type, sender_id, sender_name, message, is_read, created_at)
         VALUES ($1, 'user', $2, $3, $4, FALSE, NOW())
         RETURNING *`,
        [conversationId, userId, userName, message.trim()]
      );

      const savedMessage = result.rows[0];

      // Mettre à jour la conversation
      await pool.query(
        `UPDATE support_conversations 
         SET last_message_at = NOW(), updated_at = NOW(), status = 'waiting'
         WHERE id = $1`,
        [conversationId]
      );

      // Émettre via Socket.io
      if (io) {
        // Notifier les admins
        io.to('support_admin').emit('support_new_message', {
          ...savedMessage,
          conversationId
        });
        // Émettre dans la room de la conversation
        io.to(`support_${conversationId}`).emit('support_message', savedMessage);
      }

      // 🔔 Notification push aux admins support
      try {
        const { sendNotification } = require('./services/notifications-service');
        
        // Source 1 : tokens dédiés (table support_admin_tokens)
        const dedicatedTokens = await pool.query(
          'SELECT fcm_token, device_name FROM support_admin_tokens'
        );
        
        // Source 2 : tokens Capacitor des admins via email
        // ⚠️ CHANGE L'EMAIL ICI :
        const HARDCODED_ADMIN_EMAILS = ['contact@boostinghost.com'];
        
        let registeredEmails = [];
        try {
          const regResult = await pool.query('SELECT email FROM support_admin_emails');
          registeredEmails = regResult.rows.map(r => r.email);
        } catch (e) { /* table pas encore créée */ }
        
        const uniqueEmails = [...new Set([
          ...HARDCODED_ADMIN_EMAILS,
          ...registeredEmails
        ].map(e => e.toLowerCase()))];
        
        let capacitorTokens = { rows: [] };
        if (uniqueEmails.length > 0) {
          capacitorTokens = await pool.query(
            `SELECT t.fcm_token, t.device_type as device_name 
             FROM user_fcm_tokens t
             JOIN users u ON u.id = t.user_id
             WHERE LOWER(u.email) = ANY($1)`,
            [uniqueEmails]
          );
        }
        
        // Fusionner et dédupliquer
        const allTokens = new Map();
        for (const t of dedicatedTokens.rows) allTokens.set(t.fcm_token, t.device_name || 'Admin');
        for (const t of capacitorTokens.rows) allTokens.set(t.fcm_token, t.device_name || 'App');
        
        console.log(`🔔 Notif support → ${allTokens.size} appareil(s) (${uniqueEmails.join(', ')})`);
        
        for (const [fcmToken, deviceName] of allTokens) {
          const result = await sendNotification(
            fcmToken,
            `💬 Nouveau message support`,
            `${userName}: ${message.substring(0, 100)}`,
            { type: 'support_message', conversationId }
          );
          
          if (result && result.success) {
            console.log(`✅ Notif support OK: ${deviceName} (${fcmToken.substring(0, 20)}...)`);
          } else {
            const errorMsg = result?.error || 'Erreur inconnue';
            console.error(`❌ Notif support FAIL: ${deviceName} (${fcmToken.substring(0, 20)}...): ${errorMsg}`);
            
            // Nettoyer uniquement les tokens dédiés support (pas user_fcm_tokens)
            if (errorMsg.includes('authentication credential') ||
                errorMsg.includes('not-registered') ||
                errorMsg.includes('invalid-registration-token') ||
                errorMsg.includes('UNREGISTERED') ||
                errorMsg.includes('INVALID_ARGUMENT')) {
              await pool.query('DELETE FROM support_admin_tokens WHERE fcm_token = $1', [fcmToken]);
            }
          }
        }
      } catch (e) {
        console.error('⚠️ Erreur notification support:', e.message);
      }

      res.json({ message: savedMessage });
    } catch (error) {
      console.error('❌ Erreur POST /api/support/messages:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // ============================================
  // POST /api/support/upload — Upload image
  // ============================================
  app.post('/api/support/upload', authenticateToken, supportUpload.single('image'), async (req, res) => {
    try {
      const userId = req.user.id || req.user.userId;
      const { conversationId } = req.body;

      if (!req.file || !conversationId) {
        return res.status(400).json({ error: 'Image et conversationId requis' });
      }

      // Vérifier la conversation
      const convCheck = await pool.query(
        'SELECT id FROM support_conversations WHERE id = $1 AND user_id = $2',
        [conversationId, userId]
      );
      if (convCheck.rows.length === 0) {
        return res.status(403).json({ error: 'Accès refusé' });
      }

      // Upload vers Cloudinary
      const imageUrl = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: 'support-images',
            resource_type: 'image',
            transformation: [{ width: 1200, crop: 'limit' }, { quality: 'auto' }]
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result.secure_url);
          }
        );
        uploadStream.end(req.file.buffer);
      });

      const userName = req.user.firstName 
        ? `${req.user.firstName} ${req.user.lastName || ''}`.trim()
        : (req.user.email || 'Utilisateur');

      // Sauvegarder le message avec l'image
      const result = await pool.query(
        `INSERT INTO support_messages (conversation_id, sender_type, sender_id, sender_name, message, image_url, is_read, created_at)
         VALUES ($1, 'user', $2, $3, $4, $5, FALSE, NOW())
         RETURNING *`,
        [conversationId, userId, userName, '📷 Image', imageUrl]
      );

      const savedMessage = result.rows[0];

      // Mettre à jour la conversation
      await pool.query(
        `UPDATE support_conversations SET last_message_at = NOW(), updated_at = NOW(), status = 'waiting' WHERE id = $1`,
        [conversationId]
      );

      // Socket.io
      if (io) {
        io.to('support_admin').emit('support_new_message', { ...savedMessage, conversationId });
        io.to(`support_${conversationId}`).emit('support_message', savedMessage);
      }

      // 🔔 Notification push aux admins support (image)
      try {
        const { sendNotification } = require('./services/notifications-service');
        
        const HARDCODED_ADMIN_EMAILS = ['contact@boostinghost.com'];
        let registeredEmails = [];
        try {
          const regResult = await pool.query('SELECT email FROM support_admin_emails');
          registeredEmails = regResult.rows.map(r => r.email);
        } catch (e) {}
        
        const uniqueEmails = [...new Set([...HARDCODED_ADMIN_EMAILS, ...registeredEmails].map(e => e.toLowerCase()))];
        
        let capacitorTokens = { rows: [] };
        if (uniqueEmails.length > 0) {
          capacitorTokens = await pool.query(
            `SELECT t.fcm_token, t.device_type as device_name 
             FROM user_fcm_tokens t JOIN users u ON u.id = t.user_id
             WHERE LOWER(u.email) = ANY($1)`,
            [uniqueEmails]
          );
        }
        
        const dedicatedTokens = await pool.query('SELECT fcm_token, device_name FROM support_admin_tokens');
        const allTokens = new Map();
        for (const t of dedicatedTokens.rows) allTokens.set(t.fcm_token, t.device_name || 'Admin');
        for (const t of capacitorTokens.rows) allTokens.set(t.fcm_token, t.device_name || 'App');
        
        for (const [fcmToken, deviceName] of allTokens) {
          const result = await sendNotification(fcmToken, '📷 Image support', `${userName} a envoyé une image`, { type: 'support_message', conversationId });
          if (!result || !result.success) {
            const errorMsg = result?.error || '';
            if (errorMsg.includes('authentication credential') || errorMsg.includes('not-registered') || errorMsg.includes('UNREGISTERED')) {
              await pool.query('DELETE FROM support_admin_tokens WHERE fcm_token = $1', [fcmToken]);
            }
          }
        }
      } catch (e) {
        console.error('⚠️ Erreur notification support image:', e.message);
      }

      res.json({ message: savedMessage });
    } catch (error) {
      console.error('❌ Erreur POST /api/support/upload:', error);
      res.status(500).json({ error: 'Erreur upload' });
    }
  });

  // ============================================
  // GET /api/support/unread-count — Nombre de messages non lus
  // ============================================
  app.get('/api/support/unread-count', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id || req.user.userId;
      
      const result = await pool.query(
        `SELECT COUNT(*) as count 
         FROM support_messages sm
         JOIN support_conversations sc ON sm.conversation_id = sc.id
         WHERE sc.user_id = $1 AND sm.sender_type = 'admin' AND sm.is_read = FALSE`,
        [userId]
      );

      res.json({ unreadCount: parseInt(result.rows[0].count) || 0 });
    } catch (error) {
      console.error('❌ Erreur GET /api/support/unread-count:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // ============================================
  // ===== ROUTES ADMIN =====
  // ============================================

  // GET /api/support/admin/conversations — Lister toutes les conversations (admin)
  app.get('/api/support/admin/conversations', authenticateToken, async (req, res) => {
    try {
      // TODO: vérifier que l'utilisateur est admin
      const result = await pool.query(
        `SELECT sc.*, 
          u.email as user_email, 
          u.first_name as user_first_name,
          u.last_name as user_last_name,
          u.company as user_company,
          (SELECT COUNT(*) FROM support_messages sm WHERE sm.conversation_id = sc.id AND sm.sender_type = 'user' AND sm.is_read = FALSE) as unread_count,
          (SELECT message FROM support_messages sm WHERE sm.conversation_id = sc.id ORDER BY sm.created_at DESC LIMIT 1) as last_message
         FROM support_conversations sc
         JOIN users u ON u.id = sc.user_id
         ORDER BY sc.last_message_at DESC`
      );

      res.json({ conversations: result.rows });
    } catch (error) {
      console.error('❌ Erreur GET /api/support/admin/conversations:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // GET /api/support/admin/messages/:conversationId — Messages d'une conversation (admin)
  app.get('/api/support/admin/messages/:conversationId', authenticateToken, async (req, res) => {
    try {
      const { conversationId } = req.params;

      const result = await pool.query(
        `SELECT * FROM support_messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
        [conversationId]
      );

      // Marquer les messages utilisateur comme lus
      await pool.query(
        `UPDATE support_messages SET is_read = TRUE WHERE conversation_id = $1 AND sender_type = 'user' AND is_read = FALSE`,
        [conversationId]
      );

      res.json({ messages: result.rows });
    } catch (error) {
      console.error('❌ Erreur GET /api/support/admin/messages:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // POST /api/support/admin/reply — Répondre à une conversation (admin)
  app.post('/api/support/admin/reply', authenticateToken, async (req, res) => {
    try {
      const { conversationId, message } = req.body;
      const adminId = req.user.id || req.user.userId;
      const adminName = req.user.firstName 
        ? `${req.user.firstName} (Support)`
        : 'Support Boostinghost';

      if (!conversationId || !message?.trim()) {
        return res.status(400).json({ error: 'Message requis' });
      }

      const result = await pool.query(
        `INSERT INTO support_messages (conversation_id, sender_type, sender_id, sender_name, message, is_read, created_at)
         VALUES ($1, 'admin', $2, $3, $4, FALSE, NOW())
         RETURNING *`,
        [conversationId, adminId, adminName, message.trim()]
      );

      const savedMessage = result.rows[0];

      // Mettre à jour le statut
      await pool.query(
        `UPDATE support_conversations SET last_message_at = NOW(), updated_at = NOW(), status = 'open' WHERE id = $1`,
        [conversationId]
      );

      // Socket.io
      if (io) {
        io.to(`support_${conversationId}`).emit('support_message', savedMessage);
      }

      // 🔔 Notification push à l'utilisateur
      try {
        const convResult = await pool.query(
          'SELECT user_id FROM support_conversations WHERE id = $1',
          [conversationId]
        );
        if (convResult.rows.length > 0) {
          const targetUserId = convResult.rows[0].user_id;
          const userTokens = await pool.query(
            'SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1',
            [targetUserId]
          );
          
          const { sendNotification } = require('./services/notifications-service');
          for (const token of userTokens.rows) {
            try {
              await sendNotification(
                token.fcm_token,
                `💬 Réponse du support`,
                message.substring(0, 100),
                { type: 'support_reply', conversationId }
              );
            } catch (e) { /* ignore */ }
          }
        }
      } catch (e) {
        console.error('⚠️ Erreur notification support reply:', e.message);
      }

      res.json({ message: savedMessage });
    } catch (error) {
      console.error('❌ Erreur POST /api/support/admin/reply:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // PUT /api/support/admin/conversations/:id/status — Changer le statut
  app.put('/api/support/admin/conversations/:id/status', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!['open', 'closed', 'waiting'].includes(status)) {
        return res.status(400).json({ error: 'Statut invalide' });
      }

      await pool.query(
        'UPDATE support_conversations SET status = $1, updated_at = NOW() WHERE id = $2',
        [status, id]
      );

      res.json({ success: true });
    } catch (error) {
      console.error('❌ Erreur PUT status:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // ============================================
  // POST /api/support/admin/register-token — Enregistrer un token FCM admin
  // ============================================
  app.post('/api/support/admin/register-token', async (req, res) => {
    try {
      const { fcmToken, deviceName, pin } = req.body;

      if (!fcmToken) {
        return res.status(400).json({ error: 'Token requis' });
      }

      // Vérifier le PIN (sécurité basique)
      // Le PIN est vérifié côté client, mais on peut aussi le vérifier ici
      // Pour l'instant on accepte si le token est fourni

      await pool.query(
        `INSERT INTO support_admin_tokens (fcm_token, device_name, created_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (fcm_token) DO UPDATE SET device_name = $2, created_at = NOW()`,
        [fcmToken, deviceName || 'Appareil']
      );

      console.log(`✅ Token admin support enregistré: ${deviceName || 'Appareil'}`);
      res.json({ success: true });
    } catch (error) {
      console.error('❌ Erreur register token admin:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // DELETE /api/support/admin/unregister-token — Supprimer un token FCM admin
  app.delete('/api/support/admin/unregister-token', async (req, res) => {
    try {
      const { fcmToken } = req.body;
      if (!fcmToken) return res.status(400).json({ error: 'Token requis' });

      await pool.query('DELETE FROM support_admin_tokens WHERE fcm_token = $1', [fcmToken]);
      res.json({ success: true });
    } catch (error) {
      console.error('❌ Erreur unregister token admin:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // ============================================
  // GESTION DES ADMINS SUPPORT (emails)
  // ============================================

  // GET /api/support/admin/team — Lister les admins
  app.get('/api/support/admin/team', async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT id, email, created_at FROM support_admin_emails ORDER BY created_at ASC'
      );
      // Ajouter le hardcodé
      const hardcoded = [{ id: 0, email: 'contact@boostinghost.com', hardcoded: true, created_at: null }];
      res.json({ admins: [...hardcoded, ...result.rows] });
    } catch (error) {
      console.error('❌ Erreur GET team:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // POST /api/support/admin/team — Ajouter un admin
  app.post('/api/support/admin/team', async (req, res) => {
    try {
      const { email } = req.body;
      if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Email invalide' });
      }

      // Vérifier que l'utilisateur existe
      const userCheck = await pool.query(
        'SELECT id, email, first_name FROM users WHERE LOWER(email) = LOWER($1)',
        [email.trim()]
      );
      if (userCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Aucun utilisateur avec cet email' });
      }

      await pool.query(
        `INSERT INTO support_admin_emails (email, created_at)
         VALUES (LOWER($1), NOW())
         ON CONFLICT (email) DO NOTHING`,
        [email.trim()]
      );

      res.json({ success: true, user: userCheck.rows[0] });
    } catch (error) {
      console.error('❌ Erreur POST team:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // DELETE /api/support/admin/team/:id — Retirer un admin
  app.delete('/api/support/admin/team/:id', async (req, res) => {
    try {
      const { id } = req.params;
      await pool.query('DELETE FROM support_admin_emails WHERE id = $1', [id]);
      res.json({ success: true });
    } catch (error) {
      console.error('❌ Erreur DELETE team:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  console.log('✅ Routes support chat configurées');
}

module.exports = { setupSupportRoutes, initSupportTables };
