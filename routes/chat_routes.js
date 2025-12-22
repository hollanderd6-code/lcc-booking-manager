// ============================================
// ROUTES SYSTÈME DE CHAT SÉCURISÉ
// ============================================

const crypto = require('crypto');

/**
 * Configuration des routes de chat
 * @param {Object} app - Express app
 * @param {Object} pool - PostgreSQL pool
 * @param {Object} io - Socket.io instance
 */
function setupChatRoutes(app, pool, io, authenticateToken, checkSubscription) {
  
  // ============================================
  // MIDDLEWARE D'AUTHENTIFICATION OPTIONNELLE
  // ============================================
  
  /**
   * Middleware qui tente d'authentifier l'utilisateur mais ne bloque pas si absent
   * Utilisé pour les routes accessibles aux propriétaires ET aux voyageurs
   */
  const optionalAuth = async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        // Pas de token = continue comme invité
        req.user = null;
        return next();
      }
      
      const token = authHeader.substring(7);
      const jwt = require('jsonwebtoken');
      const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
      
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded; // Ajouter les infos user à req
        next();
      } catch (error) {
        // Token invalide = continue comme invité
        console.warn('⚠️ Token invalide dans optionalAuth:', error.message);
        req.user = null;
        next();
      }
    } catch (error) {
      console.error('❌ Erreur dans optionalAuth:', error);
      req.user = null;
      next();
    }
  };
  
  // ============================================
  // 1. GÉNÉRATION DE CONVERSATION POUR NOUVELLE RÉSERVATION
  // ============================================
  
  /**
   * Crée automatiquement une conversation quand une réservation arrive
   * Appelé par le service iCal lors de la synchronisation
   */
  app.post('/api/chat/create-for-reservation', authenticateToken, checkSubscription, async (req, res) => {
    try {
      const userId = req.user.id;
      const { property_id, reservation_start_date, reservation_end_date, platform, guest_name, guest_email } = req.body;

      if (!property_id || !reservation_start_date) {
        return res.status(400).json({ error: 'property_id et reservation_start_date requis' });
      }

      // Vérifier si conversation existe déjà
      const existing = await pool.query(
        `SELECT id, unique_token, pin_code FROM conversations 
         WHERE user_id = $1 AND property_id = $2 AND reservation_start_date = $3 AND platform = $4`,
        [userId, property_id, reservation_start_date, platform || 'direct']
      );

      if (existing.rows.length > 0) {
        const conv = existing.rows[0];
        return res.json({
          success: true,
          already_exists: true,
          conversation_id: conv.id,
          chat_link: `${process.env.APP_URL || 'http://localhost:3000'}/chat/${conv.unique_token}`,
          pin_code: conv.pin_code
        });
      }

      // Générer PIN à 4 chiffres
      const pinCode = Math.floor(1000 + Math.random() * 9000).toString();

      // Générer token unique
      const uniqueToken = crypto.randomBytes(32).toString('hex');

      // Créer la conversation
      const result = await pool.query(
        `INSERT INTO conversations 
        (user_id, property_id, reservation_start_date, reservation_end_date, platform, guest_name, guest_email, pin_code, unique_token)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, unique_token, pin_code`,
        [userId, property_id, reservation_start_date, reservation_end_date, platform || 'direct', guest_name, guest_email, pinCode, uniqueToken]
      );

      const conversation = result.rows[0];

      console.log(`✅ Conversation créée: ID ${conversation.id} pour réservation ${property_id} - ${reservation_start_date}`);

      res.json({
        success: true,
        conversation_id: conversation.id,
        chat_link: `${process.env.APP_URL || 'http://localhost:3000'}/chat/${conversation.unique_token}`,
        pin_code: conversation.pin_code,
        message_template: generateMessageTemplate(conversation.pin_code, conversation.unique_token)
      });

    } catch (error) {
      console.error('❌ Erreur création conversation:', error);
      res.status(500).json({ error: 'Erreur création conversation' });
    }
  });

  // ============================================
  // 2. VÉRIFICATION ET ACCÈS AU CHAT
  // ============================================

  /**
   * Vérifier les informations du voyageur et donner accès au chat
   */
  app.post('/api/chat/verify/:token', async (req, res) => {
    try {
      const { token } = req.params;
      const { property_id, checkin_date, platform, pin_code } = req.body;

      if (!property_id || !checkin_date || !platform || !pin_code) {
        return res.status(400).json({ error: 'Tous les champs sont requis' });
      }

      // Récupérer la conversation
      const convResult = await pool.query(
        'SELECT * FROM conversations WHERE unique_token = $1',
        [token]
      );

      if (convResult.rows.length === 0) {
        return res.status(404).json({ error: 'Lien de chat invalide' });
      }

      const conversation = convResult.rows[0];

      // Vérifier le nombre de tentatives
      if (conversation.verification_attempts >= 3) {
        return res.status(403).json({ 
          error: 'Trop de tentatives. Veuillez contacter le propriétaire.',
          max_attempts_reached: true
        });
      }

      // Vérifier les informations
      const checkinDateStr = new Date(checkin_date).toISOString().split('T')[0];
      const conversationDateStr = new Date(conversation.reservation_start_date).toISOString().split('T')[0];

      const isValid = 
        parseInt(property_id) === parseInt(conversation.property_id) &&
        checkinDateStr === conversationDateStr &&
        platform === conversation.platform &&
        pin_code === conversation.pin_code;

      if (!isValid) {
        // Incrémenter les tentatives
        await pool.query(
          'UPDATE conversations SET verification_attempts = verification_attempts + 1 WHERE id = $1',
          [conversation.id]
        );

        return res.status(401).json({ 
          error: 'Informations incorrectes. Vérifiez vos données.',
          attempts: conversation.verification_attempts + 1,
          max_attempts: 3
        });
      }

      // ✅ Vérification réussie !
      await pool.query(
        `UPDATE conversations 
         SET is_verified = TRUE, verified_at = NOW(), status = 'active'
         WHERE id = $1`,
        [conversation.id]
      );

      // Envoyer automatiquement le message de bienvenue avec livret d'accueil
      await sendWelcomeMessage(pool, conversation.id, conversation.property_id, conversation.user_id);

      res.json({
        success: true,
        conversation_id: conversation.id,
        property_id: conversation.property_id,
        guest_name: conversation.guest_name
      });

    } catch (error) {
      console.error('❌ Erreur vérification:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });
/**
 * Vérification du chat basée sur le PIN du logement
 */
app.post('/api/chat/verify-by-property', async (req, res) => {
  try {
    const { property_id, chat_pin, checkin_date, checkout_date, platform } = req.body;

    // Validation
    if (!property_id || !chat_pin || !checkin_date || !platform) {
      return res.status(400).json({ 
        error: 'Tous les champs sont requis' 
      });
    }

    // 1. Vérifier le logement et le PIN
    const propertyResult = await pool.query(
      'SELECT id, user_id, name, chat_pin FROM properties WHERE id = $1',
      [property_id]
    );

    if (propertyResult.rows.length === 0) {
      return res.status(404).json({ error: 'Logement non trouvé' });
    }

    const property = propertyResult.rows[0];

    if (property.chat_pin !== chat_pin) {
      return res.status(401).json({ error: 'Code PIN incorrect' });
    }

    // 2. Vérifier qu'une réservation existe
    const checkinDateStr = new Date(checkin_date).toISOString().split('T')[0];
    const checkoutDateStr = checkout_date ? new Date(checkout_date).toISOString().split('T')[0] : null;

    const reservationResult = await pool.query(
      `SELECT id FROM reservations 
       WHERE property_id = $1 
       AND DATE(start_date) = $2 
       AND ($3::date IS NULL OR DATE(end_date) = $3)
       AND LOWER(source) = LOWER($4)
       LIMIT 1`,
      [property_id, checkinDateStr, checkoutDateStr, platform]
    );

    if (reservationResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Aucune réservation trouvée avec ces informations' 
      });
    }

    // 3. Créer ou récupérer la conversation
    let conversation;
    const existingConv = await pool.query(
      `SELECT * FROM conversations 
       WHERE property_id = $1 
       AND reservation_start_date = $2 
       AND platform = $3`,
      [property_id, checkinDateStr, platform]
    );

    if (existingConv.rows.length > 0) {
      conversation = existingConv.rows[0];
      
      if (!conversation.is_verified) {
        await pool.query(
          `UPDATE conversations 
           SET is_verified = TRUE, verified_at = NOW(), status = 'active'
           WHERE id = $1`,
          [conversation.id]
        );
        await sendWelcomeMessage(pool, conversation.id, property_id, property.user_id);
      }
    } else {
      const crypto = require('crypto');
      const uniqueToken = crypto.randomBytes(32).toString('hex');

      const newConvResult = await pool.query(
        `INSERT INTO conversations 
        (user_id, property_id, reservation_start_date, reservation_end_date, platform, pin_code, unique_token, is_verified, verified_at, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, NOW(), 'active')
        RETURNING *`,
        [property.user_id, property_id, checkinDateStr, checkoutDateStr, platform, chat_pin, uniqueToken]
      );

      conversation = newConvResult.rows[0];
      await sendWelcomeMessage(pool, conversation.id, property_id, property.user_id);
    }

    res.json({
      success: true,
      conversation_id: conversation.id,
      property_id: property_id,
      property_name: property.name
    });

  } catch (error) {
    console.error('Erreur vérification:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
  // ============================================
  // 3. RÉCUPÉRATION DES PROPRIÉTÉS (pour liste déroulante)
  // ============================================

  app.get('/api/chat/properties', async (req, res) => {
    try {
      // Récupérer toutes les propriétés actives
      const result = await pool.query(
        `SELECT id, name, color FROM properties ORDER BY name`
      );

      res.json({ properties: result.rows });
    } catch (error) {
      console.error('❌ Erreur récupération propriétés:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // ============================================
  // 4. LISTE DES CONVERSATIONS (pour propriétaire)
  // ============================================

  app.get('/api/chat/conversations', authenticateToken, checkSubscription, async (req, res) => {
    try {
      const userId = req.user.id;
      const { status, property_id } = req.query;

      let query = `
        SELECT 
          c.*,
          (
            SELECT COUNT(1)
            FROM chat_notifications cn
            WHERE cn.user_id = c.user_id
              AND cn.conversation_id = c.id
              AND COALESCE(cn.is_read, FALSE) = FALSE
          ) as unread_count,
          COUNT(m.id) as total_messages,
          MAX(m.created_at) as last_message_time,
          p.name as property_name,
          p.color as property_color
        FROM conversations c
        LEFT JOIN messages m ON c.id = m.conversation_id
        LEFT JOIN properties p ON c.property_id = p.id
        WHERE c.user_id = $1
      `;

      const params = [userId];
      let paramIndex = 2;

      if (status) {
        query += ` AND c.status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
      }

      if (property_id) {
        query += ` AND c.property_id = $${paramIndex}`;
        params.push(property_id);
        paramIndex++;
      }

      query += ` GROUP BY c.id, p.name, p.color ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC`;

      const result = await pool.query(query, params);

      res.json({ conversations: result.rows });

    } catch (error) {
      console.error('❌ Erreur récupération conversations:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // ============================================
  // 4bis. Compteur global de notifications non lues (sidebar)
  // ============================================
  app.get('/api/chat/unread-count', authenticateToken, checkSubscription, async (req, res) => {
    try {
      const userId = req.user.id;

      const result = await pool.query(
        `SELECT COUNT(1) AS unread_count
         FROM chat_notifications
         WHERE user_id = $1
           AND COALESCE(is_read, FALSE) = FALSE`,
        [userId]
      );

      res.json({ unread_count: parseInt(result.rows[0].unread_count || 0, 10) });
    } catch (error) {
      console.error('❌ Erreur unread-count:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // ============================================
  // 4ter. Marquer une conversation comme lue (toutes notifications)
  // ============================================
  app.post('/api/chat/conversations/:conversationId/mark-read', authenticateToken, checkSubscription, async (req, res) => {
    try {
      const userId = req.user.id;
      const { conversationId } = req.params;

      // Sécurité : vérifier que la conversation appartient au user
      const convCheck = await pool.query(
        'SELECT user_id FROM conversations WHERE id = $1',
        [conversationId]
      );
      if (convCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Conversation introuvable' });
      }
      if (parseInt(convCheck.rows[0].user_id, 10) !== parseInt(userId, 10)) {
        return res.status(403).json({ error: 'Accès non autorisé' });
      }

      await pool.query(
        `UPDATE chat_notifications
         SET is_read = TRUE
         WHERE user_id = $1
           AND conversation_id = $2
           AND COALESCE(is_read, FALSE) = FALSE`,
        [userId, conversationId]
      );

      // On conserve aussi la logique existante sur messages.is_read (pour cohérence)
      await pool.query(
        `UPDATE messages
         SET is_read = TRUE
         WHERE conversation_id = $1
           AND sender_type = 'guest'
           AND COALESCE(is_read, FALSE) = FALSE`,
        [conversationId]
      );

      res.json({ success: true });
    } catch (error) {
      console.error('❌ Erreur mark-read:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // ============================================
  // 5. MESSAGES D'UNE CONVERSATION
  // ============================================

  app.get('/api/chat/conversations/:conversationId/messages', optionalAuth, async (req, res) => {
    try {
      const { conversationId } = req.params;

      // Si authentifié = propriétaire, sinon = voyageur (vérification token conversation)
      const userId = req.user ? req.user.id : null;

      // Vérifier l'accès
      const convCheck = await pool.query(
        'SELECT user_id, is_verified, status FROM conversations WHERE id = $1',
        [conversationId]
      );

      if (convCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Conversation introuvable' });
      }

      const conv = convCheck.rows[0];

      // Si pas de userId (voyageur), vérifier que la conversation est vérifiée
      if (!userId && !conv.is_verified) {
        return res.status(403).json({ error: 'Accès non autorisé' });
      }

      // Si userId (propriétaire), vérifier qu'il possède la conversation
      if (userId && conv.user_id !== userId) {
        return res.status(403).json({ error: 'Accès non autorisé' });
      }

      // Récupérer les messages
      const messages = await pool.query(
        `SELECT id, sender_type, sender_name, message, is_read, is_bot_response, created_at 
         FROM messages 
         WHERE conversation_id = $1 
         ORDER BY created_at ASC`,
        [conversationId]
      );

      // Marquer les messages du voyageur comme lus si c'est le propriétaire
      if (userId) {
        await pool.query(
          `UPDATE messages 
           SET is_read = TRUE 
           WHERE conversation_id = $1 AND sender_type = 'guest' AND is_read = FALSE`,
          [conversationId]
        );

        // Marquer les notifications associées comme lues (pour que le compteur se mette à 0)
        await pool.query(
          `UPDATE chat_notifications
           SET is_read = TRUE
           WHERE user_id = $1
             AND conversation_id = $2
             AND COALESCE(is_read, FALSE) = FALSE`,
          [userId, conversationId]
        );
      }

      res.json({ messages: messages.rows });

    } catch (error) {
      console.error('❌ Erreur récupération messages:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // ============================================
  // 6. ENVOI DE MESSAGE
  // ============================================

  app.post('/api/chat/conversations/:conversationId/messages', optionalAuth, async (req, res) => {
    try {
      const { conversationId } = req.params;
      const { message, sender_name } = req.body;

      if (!message || !message.trim()) {
        return res.status(400).json({ error: 'Message vide' });
      }

      const userId = req.user ? req.user.id : null;
      const senderType = userId ? 'owner' : 'guest';

      // Vérifier l'accès
      const convCheck = await pool.query(
        'SELECT user_id, is_verified, status, property_id FROM conversations WHERE id = $1',
        [conversationId]
      );

      if (convCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Conversation introuvable' });
      }

      const conv = convCheck.rows[0];

      if (!userId && !conv.is_verified) {
        return res.status(403).json({ error: 'Conversation non vérifiée' });
      }

      if (userId && conv.user_id !== userId) {
        return res.status(403).json({ error: 'Accès non autorisé' });
      }

      // Insérer le message
      const result = await pool.query(
        `INSERT INTO messages (conversation_id, sender_type, sender_name, message, is_read)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, sender_type, sender_name, message, is_read, is_bot_response, created_at`,
        [conversationId, senderType, sender_name, message.trim(), senderType === 'owner']
      );

      const savedMessage = result.rows[0];

      // Mettre à jour last_message_at
      await pool.query(
        'UPDATE conversations SET last_message_at = NOW() WHERE id = $1',
        [conversationId]
      );

      // Émettre le message via Socket.io
      io.to(`conversation_${conversationId}`).emit('new_message', savedMessage);

      // Si message du voyageur, vérifier si une réponse auto est applicable
      if (senderType === 'guest') {
        const autoResponse = await findAutoResponse(pool, conv.user_id, conv.property_id, message);
        
        if (autoResponse) {
          // Envoyer réponse automatique
          const botResult = await pool.query(
            `INSERT INTO messages (conversation_id, sender_type, sender_name, message, is_read, is_bot_response)
             VALUES ($1, 'bot', 'Assistant automatique', $2, FALSE, TRUE)
             RETURNING id, sender_type, sender_name, message, is_read, is_bot_response, created_at`,
            [conversationId, autoResponse]
          );

          const botMessage = botResult.rows[0];
          io.to(`conversation_${conversationId}`).emit('new_message', botMessage);
        } else {
          // Pas de réponse auto -> notifier le propriétaire
          await createNotification(pool, io, conv.user_id, conversationId, savedMessage.id, 'new_message');
        }
      }

      res.json({ success: true, message: savedMessage });

    } catch (error) {
      console.error('❌ Erreur envoi message:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // ============================================
  // 7. GESTION DES RÉPONSES AUTOMATIQUES
  // ============================================

  app.get('/api/chat/auto-responses', authenticateToken, checkSubscription, async (req, res) => {
    try {
      const userId = req.user.id;
      const { property_id } = req.query;

      let query = `
        SELECT id, property_id, keywords, response, order_priority, is_active, created_at
        FROM auto_responses
        WHERE user_id = $1
      `;

      const params = [userId];

      if (property_id) {
        query += ` AND property_id = $2`;
        params.push(property_id);
      }

      query += ` ORDER BY order_priority DESC, id DESC`;

      const result = await pool.query(query, params);
      res.json({ auto_responses: result.rows });

    } catch (error) {
      console.error('❌ Erreur récupération réponses auto:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  app.post('/api/chat/auto-responses', authenticateToken, checkSubscription, async (req, res) => {
    try {
      const userId = req.user.id;
      const { property_id, keywords, response, order_priority } = req.body;

      if (!keywords || keywords.length === 0 || !response) {
        return res.status(400).json({ error: 'Keywords et response requis' });
      }

      const result = await pool.query(
        `INSERT INTO auto_responses (user_id, property_id, keywords, response, order_priority)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [userId, property_id || null, keywords, response, order_priority || 0]
      );

      res.json({ success: true, auto_response: result.rows[0] });

    } catch (error) {
      console.error('❌ Erreur création réponse auto:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  app.put('/api/chat/auto-responses/:id', authenticateToken, checkSubscription, async (req, res) => {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const { keywords, response, order_priority, is_active } = req.body;

      const result = await pool.query(
        `UPDATE auto_responses 
         SET keywords = COALESCE($1, keywords),
             response = COALESCE($2, response),
             order_priority = COALESCE($3, order_priority),
             is_active = COALESCE($4, is_active),
             updated_at = NOW()
         WHERE id = $5 AND user_id = $6
         RETURNING *`,
        [keywords, response, order_priority, is_active, id, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Réponse auto introuvable' });
      }

      res.json({ success: true, auto_response: result.rows[0] });

    } catch (error) {
      console.error('❌ Erreur mise à jour réponse auto:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  app.delete('/api/chat/auto-responses/:id', authenticateToken, checkSubscription, async (req, res) => {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      const result = await pool.query(
        'DELETE FROM auto_responses WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Réponse auto introuvable' });
      }

      res.json({ success: true });

    } catch (error) {
      console.error('❌ Erreur suppression réponse auto:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // ============================================
  // 8. SOCKET.IO - TEMPS RÉEL
  // ============================================

  io.on('connection', (socket) => {
    console.log('🔌 Client connecté:', socket.id);

    // Rejoindre une conversation
    socket.on('join_conversation', async (conversationId) => {
      socket.join(`conversation_${conversationId}`);
      console.log(`✅ Socket ${socket.id} rejoint conversation ${conversationId}`);
    });

    // Quitter une conversation
    socket.on('leave_conversation', (conversationId) => {
      socket.leave(`conversation_${conversationId}`);
      console.log(`👋 Socket ${socket.id} quitte conversation ${conversationId}`);
    });

    // Typing indicator
    socket.on('typing', ({ conversationId, senderName }) => {
      socket.to(`conversation_${conversationId}`).emit('user_typing', { senderName });
    });

    socket.on('stop_typing', ({ conversationId }) => {
      socket.to(`conversation_${conversationId}`).emit('user_stop_typing');
    });

    socket.on('disconnect', () => {
      console.log('🔌 Client déconnecté:', socket.id);
    });
  });
}

// ============================================
// FONCTIONS HELPER
// ============================================

/**
 * Génère le template de message à envoyer sur Airbnb/Booking
 */
function generateMessageTemplate(pinCode, token) {
  const chatLink = `${process.env.APP_URL || 'http://localhost:3000'}/chat/${token}`;
  
  return `🎉 Bonjour et merci pour votre réservation !

Pour faciliter votre séjour et recevoir toutes les informations importantes (accès, livret d'accueil, etc.), merci de cliquer sur le lien ci-dessous :

🔗 ${chatLink}

📌 Votre code de vérification : ${pinCode}

Vous devrez saisir :
- La date de votre arrivée
- La plateforme de réservation
- Ce code à 4 chiffres

Au plaisir de vous accueillir ! 🏠`;
}

/**
 * Envoie le message de bienvenue avec livret d'accueil
 */
async function sendWelcomeMessage(pool, conversationId, propertyId, userId) {
  try {
    // Récupérer le livret d'accueil
    const welcomeBook = await pool.query(
      `SELECT unique_id, property_name FROM welcome_books_v2 
       WHERE user_id = $1 AND property_name = (SELECT name FROM properties WHERE id = $2)
       LIMIT 1`,
      [userId, propertyId]
    );

    let welcomeContent = '👋 Bienvenue ! Nous sommes ravis de vous accueillir.';

    if (welcomeBook.rows.length > 0) {
      const bookUrl = `${process.env.APP_URL || 'http://localhost:3000'}/welcome/${welcomeBook.rows[0].unique_id}`;
      welcomeContent += `\n\n📖 Consultez votre livret d'accueil ici : ${bookUrl}\n\nVous y trouverez toutes les informations pour votre séjour (WiFi, accès, recommandations, etc.)`;
    }

    welcomeContent += '\n\nN\'hésitez pas à nous poser vos questions ! 😊';

    // Insérer le message de bienvenue
    await pool.query(
      `INSERT INTO messages (conversation_id, sender_type, sender_name, message, is_read, is_bot_response)
       VALUES ($1, 'bot', 'Assistant automatique', $2, FALSE, TRUE)`,
      [conversationId, welcomeContent]
    );

    console.log(`✅ Message de bienvenue envoyé pour conversation ${conversationId}`);

  } catch (error) {
    console.error('❌ Erreur envoi message bienvenue:', error);
  }
}

/**
 * Trouve une réponse automatique correspondante
 */
async function findAutoResponse(pool, userId, propertyId, messageContent) {
  try {
    const lowerContent = messageContent.toLowerCase();

    // Récupérer toutes les réponses auto actives pour cet utilisateur
    const result = await pool.query(
      `SELECT response, keywords 
       FROM auto_responses 
       WHERE user_id = $1 
       AND (property_id IS NULL OR property_id = $2)
       AND is_active = TRUE
       ORDER BY order_priority DESC`,
      [userId, propertyId]
    );

    // Chercher la première qui matche
    for (const row of result.rows) {
      const keywords = row.keywords || [];
      const hasMatch = keywords.some(keyword => lowerContent.includes(keyword.toLowerCase()));
      
      if (hasMatch) {
        return row.response;
      }
    }

    return null;

  } catch (error) {
    console.error('❌ Erreur recherche réponse auto:', error);
    return null;
  }
}

/**
 * Crée une notification pour le propriétaire
 */
async function createNotification(pool, io, userId, conversationId, messageId, type) {
  try {
    await pool.query(
      `INSERT INTO chat_notifications (user_id, conversation_id, message_id, notification_type)
       VALUES ($1, $2, $3, $4)`,
      [userId, conversationId, messageId, type]
    );

    // Émettre notification via Socket.io
    io.to(`user_${userId}`).emit('new_notification', {
      type,
      conversationId,
      messageId
    });

    console.log(`🔔 Notification envoyée à ${userId} pour conversation ${conversationId}`);

  } catch (error) {
    console.error('❌ Erreur création notification:', error);
  }
}

module.exports = { setupChatRoutes };
