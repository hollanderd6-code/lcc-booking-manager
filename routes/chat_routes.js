// ============================================
// ROUTES SYSTÈME DE CHAT SÉCURISÉ
// ============================================

const crypto = require('crypto');

console.log('📦 [CHAT_ROUTES] Module en cours de chargement...');

// ============================================
// 🤖 IMPORTS SYSTÈME ONBOARDING + RÉPONSES AUTO
// ============================================
const { handleIncomingMessage } = require('../integrated-chat-handler');
const { startOnboarding } = require('../onboarding-system');

console.log('✅ [CHAT_ROUTES] Imports système chargés');

// ============================================
// 🤖 SERVICE DE RÉPONSES AUTOMATIQUES
// ============================================

const QUESTION_PATTERNS = {
  checkin: {
    keywords: ['arriver', 'arrivée', 'check-in', 'checkin', 'heure arrivée', 'quelle heure arriver', 'arrive'],
    priority: 1
  },
  checkout: {
    keywords: ['partir', 'départ', 'check-out', 'checkout', 'heure départ', 'quelle heure partir', 'libérer', 'quitter'],
    priority: 1
  },
  draps: {
    keywords: ['draps', 'drap', 'linge de lit', 'literie'],
    priority: 2
  },
  serviettes: {
    keywords: ['serviettes', 'serviette', 'linge de toilette', 'bain'],
    priority: 2
  },
  cuisine: {
    keywords: ['cuisine', 'cuisiner', 'équipée', 'ustensiles', 'vaisselle'],
    priority: 2
  },
  wifi: {
    keywords: ['wifi', 'wi-fi', 'internet', 'réseau', 'connexion', 'mot de passe wifi', 'code wifi'],
    priority: 1
  },
  acces_code: {
    keywords: ['code', 'clé', 'clef', 'accès', 'entrer', 'porte', 'digicode'],
    priority: 1
  },
  animaux: {
    keywords: ['animaux', 'animal', 'chien', 'chat', 'accepté'],
    priority: 2
  },
  parking: {
    keywords: ['parking', 'stationner', 'garer', 'voiture', 'stationnement'],
    priority: 2
  },
  chauffage: {
    keywords: ['chauffage', 'chauffer', 'température', 'froid', 'chaud', 'radiateur', 'climatisation'],
    priority: 2
  },
  menage: {
    keywords: ['ménage', 'nettoyage', 'nettoyer', 'propre', 'propreté'],
    priority: 3
  },
  commerce: {
    keywords: ['courses', 'supermarché', 'magasin', 'commerce', 'épicerie', 'boulangerie', 'acheter'],
    priority: 3
  }
};

// ============================================
// FONCTION PRINCIPALE SETUP
// ============================================

function setupChatRoutes(app, pool, io, authenticateAny, checkSubscription) {
  console.log('🚀 [CHAT_ROUTES] Début de setupChatRoutes...');
  
  try {
    // ✅ Import des fonctions de gestion des permissions depuis le middleware
    const { 
      requirePermission, 
      loadSubAccountData, 
      filterByAccessibleProperties, 
      getRealUserId 
    } = require('../sub-accounts-middleware');
    
    console.log('✅ [CHAT_ROUTES] Middleware sous-comptes chargé');
    
    // Garder authenticateToken pour compatibilité avec les routes existantes
    const authenticateToken = authenticateAny;

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
          req.user = null;
          return next();
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
      } catch (error) {
        req.user = null;
        next();
      }
    };

    console.log('✅ [CHAT_ROUTES] Middleware optionalAuth créé');

    // ============================================
    // 1. CRÉATION DE CONVERSATION
    // ============================================
    
    console.log('📝 [CHAT_ROUTES] Montage route: POST /api/chat/create-for-reservation');
    
    app.post('/api/chat/create-for-reservation', authenticateToken, checkSubscription, async (req, res) => {
      try {
        const { reservation_uid } = req.body;
        
        if (!reservation_uid) {
          return res.status(400).json({ error: 'reservation_uid requis' });
        }

        const userId = req.user.userId || req.user.id;

        const reservation = await pool.query(
          `SELECT 
            r.*, 
            p.name as property_name,
            p.user_id as property_owner_id
           FROM reservations r
           JOIN properties p ON r.property_id = p.id
           WHERE r.uid = $1`,
          [reservation_uid]
        );

        if (reservation.rows.length === 0) {
          return res.status(404).json({ error: 'Réservation introuvable' });
        }

        const res_data = reservation.rows[0];

        if (res_data.property_owner_id !== userId) {
          return res.status(403).json({ error: 'Non autorisé' });
        }

        const existingConv = await pool.query(
          `SELECT id, unique_token, pin_code 
           FROM conversations 
           WHERE property_id = $1 
           AND reservation_start_date = $2 
           AND platform = $3`,
          [res_data.property_id, res_data.start_date, res_data.source]
        );

        if (existingConv.rows.length > 0) {
          return res.json({
            success: true,
            conversation_id: existingConv.rows[0].id,
            unique_token: existingConv.rows[0].unique_token,
            pin_code: existingConv.rows[0].pin_code,
            already_exists: true
          });
        }

        const pinCode = Math.floor(1000 + Math.random() * 9000).toString();
        const uniqueToken = crypto.randomBytes(32).toString('hex');
        const photosToken = crypto.randomBytes(32).toString('hex');

        const newConv = await pool.query(
          `INSERT INTO conversations 
          (user_id, property_id, reservation_start_date, reservation_end_date, 
           platform, pin_code, unique_token, photos_token, status, is_verified)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', FALSE)
          RETURNING id, unique_token, pin_code`,
          [
            userId,
            res_data.property_id,
            res_data.start_date,
            res_data.end_date,
            res_data.source,
            pinCode,
            uniqueToken,
            photosToken
          ]
        );

        res.json({
          success: true,
          conversation_id: newConv.rows[0].id,
          unique_token: newConv.rows[0].unique_token,
          pin_code: newConv.rows[0].pin_code,
          already_exists: false
        });

      } catch (error) {
        console.error('❌ Erreur création conversation:', error);
        res.status(500).json({ error: 'Erreur serveur' });
      }
    });

    // ============================================
    // 2. LISTE DES CONVERSATIONS (Propriétaire)
    // ============================================
    
    console.log('📝 [CHAT_ROUTES] Montage route: GET /api/chat/conversations');
    
    app.get('/api/chat/conversations', 
      authenticateToken,
      checkSubscription,
      requirePermission(pool, 'can_view_messages'),
      loadSubAccountData(pool),
      async (req, res) => {
      try {
        const userId = req.user.isSubAccount 
          ? (await getRealUserId(pool, req))
          : (req.user.userId || req.user.id);

        if (!userId) {
          return res.status(401).json({ error: 'Non autorisé' });
        }

        const { status, property_id } = req.query;

        let query = `
          SELECT 
            c.*,
            p.name as property_name,
            p.color as property_color,
            (SELECT COUNT(*) FROM chat_messages WHERE conversation_id = c.id AND is_read = FALSE AND sender_type = 'guest') as unread_count,
            (SELECT message FROM chat_messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
            (SELECT created_at FROM chat_messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_time
          FROM conversations c
          LEFT JOIN properties p ON c.property_id = p.id
          WHERE c.user_id = $1
        `;

        const params = [userId];
        let paramCount = 1;

        if (status) {
          paramCount++;
          query += ` AND c.status = $${paramCount}`;
          params.push(status);
        }

        if (property_id) {
          paramCount++;
          query += ` AND c.property_id = $${paramCount}`;
          params.push(property_id);
        }

        query += ` ORDER BY last_message_time DESC NULLS LAST, c.created_at DESC`;

        const result = await pool.query(query, params);

        // ✅ Filtrer par propriétés accessibles si sous-compte
        const conversations = req.user.isSubAccount
          ? filterByAccessibleProperties(result.rows, req)
          : result.rows;

        res.json({
          success: true,
          conversations
        });

      } catch (error) {
        console.error('❌ Erreur récupération conversations:', error);
        res.status(500).json({ error: 'Erreur serveur' });
      }
    });

    // ============================================
    // 3. VÉRIFICATION PAR TOKEN (Voyageur)
    // ============================================
    
    console.log('📝 [CHAT_ROUTES] Montage route: POST /api/chat/verify');
    
    app.post('/api/chat/verify', async (req, res) => {
      try {
        const { token, pin_code } = req.body;

        if (!token || !pin_code) {
          return res.status(400).json({ error: 'Token et PIN requis' });
        }

        const result = await pool.query(
          `SELECT 
            c.*,
            p.name as property_name,
            p.address as property_address
           FROM conversations c
           LEFT JOIN properties p ON c.property_id = p.id
           WHERE c.unique_token = $1 AND c.pin_code = $2`,
          [token, pin_code]
        );

        if (result.rows.length === 0) {
          return res.status(404).json({ error: 'Conversation introuvable ou code incorrect' });
        }

        const conversation = result.rows[0];

        // Marquer comme vérifiée si pas déjà fait
        if (!conversation.is_verified) {
          await pool.query(
            `UPDATE conversations 
             SET is_verified = TRUE, verified_at = NOW(), status = 'active'
             WHERE id = $1`,
            [conversation.id]
          );
        }

        res.json({
          success: true,
          conversation_id: conversation.id,
          property_id: conversation.property_id,
          property_name: conversation.property_name,
          property_address: conversation.property_address,
          reservation_start: conversation.reservation_start_date,
          reservation_end: conversation.reservation_end_date
        });

      } catch (error) {
        console.error('❌ Erreur vérification:', error);
        res.status(500).json({ error: 'Erreur serveur' });
      }
    });

    // ============================================
    // 4. VÉRIFICATION PAR PROPRIÉTÉ + DATES + PIN
    // ============================================
    
    console.log('📝 [CHAT_ROUTES] Montage route: POST /api/chat/verify-by-property');
    
    app.post('/api/chat/verify-by-property', async (req, res) => {
      try {
        console.log('🔍 [VERIFY] Requête reçue:', req.body);
        
        const { property_id, chat_pin, checkin_date, checkout_date, platform } = req.body;

        if (!property_id || !chat_pin || !checkin_date || !platform) {
          console.log('❌ [VERIFY] Paramètres manquants');
          return res.status(400).json({ 
            error: 'property_id, chat_pin, checkin_date et platform requis' 
          });
        }

        // Vérifier que la propriété existe
        const property = await pool.query(
          `SELECT id, name, user_id FROM properties WHERE id = $1`,
          [property_id]
        );

        if (property.rows.length === 0) {
          console.log('❌ [VERIFY] Propriété introuvable:', property_id);
          return res.status(404).json({ error: 'Propriété introuvable' });
        }

        console.log('✅ [VERIFY] Propriété trouvée:', property.rows[0].name);

        const checkinDateStr = new Date(checkin_date).toISOString().split('T')[0];
        const checkoutDateStr = checkout_date ? new Date(checkout_date).toISOString().split('T')[0] : null;

        console.log('📅 [VERIFY] Dates:', { checkinDateStr, checkoutDateStr, platform });

        // Vérifier qu'une réservation existe
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
          console.log('❌ [VERIFY] Aucune réservation trouvée');
          return res.status(404).json({ 
            error: 'Aucune réservation trouvée avec ces informations' 
          });
        }

        console.log('✅ [VERIFY] Réservation trouvée');

        // Chercher ou créer la conversation
        let conversation;
        const existingConv = await pool.query(
          `SELECT * FROM conversations 
           WHERE property_id = $1 
           AND DATE(reservation_start_date) = $2 
           AND LOWER(platform) = LOWER($3)
           AND pin_code = $4`,
          [property_id, checkinDateStr, platform, chat_pin]
        );

        if (existingConv.rows.length > 0) {
          console.log('✅ [VERIFY] Conversation existante trouvée');
          conversation = existingConv.rows[0];
          
          if (!conversation.is_verified) {
            await pool.query(
              `UPDATE conversations 
               SET is_verified = TRUE, verified_at = NOW(), status = 'active'
               WHERE id = $1`,
              [conversation.id]
            );
          }
        } else {
          console.log('📝 [VERIFY] Création nouvelle conversation');
          const uniqueToken = crypto.randomBytes(32).toString('hex');
          const photosToken = crypto.randomBytes(32).toString('hex');

          const newConvResult = await pool.query(
            `INSERT INTO conversations 
            (user_id, property_id, reservation_start_date, reservation_end_date, platform, pin_code, unique_token, photos_token, is_verified, verified_at, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, NOW(), 'active')
            RETURNING *`,
            [property.rows[0].user_id, property_id, checkinDateStr, checkoutDateStr, platform, chat_pin, uniqueToken, photosToken]
          );

          conversation = newConvResult.rows[0];
          console.log('✅ [VERIFY] Conversation créée:', conversation.id);
        }

        res.json({
          success: true,
          conversation_id: conversation.id,
          property_id: conversation.property_id,
          property_name: property.rows[0].name,
          reservation_start: conversation.reservation_start_date,
          reservation_end: conversation.reservation_end_date,
          unique_token: conversation.unique_token
        });

      } catch (error) {
        console.error('❌ [VERIFY] Erreur:', error);
        res.status(500).json({ error: 'Erreur serveur' });
      }
    });

    console.log('✅ [CHAT_ROUTES] Route verify-by-property montée avec succès');

    // ============================================
    // 5. RÉCUPÉRER LES MESSAGES D'UNE CONVERSATION
    // ============================================
    
    console.log('📝 [CHAT_ROUTES] Montage route: GET /api/chat/messages/:conversationId');
    
    app.get('/api/chat/messages/:conversationId', optionalAuth, async (req, res) => {
      try {
        const { conversationId } = req.params;

        const result = await pool.query(
          `SELECT * FROM chat_messages 
           WHERE conversation_id = $1 
           ORDER BY created_at ASC`,
          [conversationId]
        );

        res.json({
          success: true,
          messages: result.rows
        });

      } catch (error) {
        console.error('❌ Erreur récupération messages:', error);
        res.status(500).json({ error: 'Erreur serveur' });
      }
    });

    // ============================================
    // 6. ENVOYER UN MESSAGE
    // ============================================
    
    console.log('📝 [CHAT_ROUTES] Montage route: POST /api/chat/send');
    
    app.post('/api/chat/send', optionalAuth, async (req, res) => {
      try {
        const { conversation_id, message, sender_type } = req.body;

        if (!conversation_id || !message) {
          return res.status(400).json({ error: 'conversation_id et message requis' });
        }

        const finalSenderType = sender_type || (req.user ? 'owner' : 'guest');

        const result = await pool.query(
          `INSERT INTO chat_messages (conversation_id, message, sender_type, is_read, created_at)
           VALUES ($1, $2, $3, FALSE, NOW())
           RETURNING *`,
          [conversation_id, message, finalSenderType]
        );

        const newMessage = result.rows[0];

        // Émettre via Socket.IO
        io.to(`conversation_${conversation_id}`).emit('new_message', newMessage);

        // Notification propriétaire si message du voyageur
        if (finalSenderType === 'guest') {
          const conv = await pool.query('SELECT user_id FROM conversations WHERE id = $1', [conversation_id]);
          if (conv.rows.length > 0) {
            io.to(`user_${conv.rows[0].user_id}`).emit('new_notification', {
              type: 'new_message',
              conversationId: conversation_id,
              messageId: newMessage.id
            });
          }
        }

        res.json({
          success: true,
          message: newMessage
        });

      } catch (error) {
        console.error('❌ Erreur envoi message:', error);
        res.status(500).json({ error: 'Erreur serveur' });
      }
    });

    // ============================================
    // 7. MARQUER COMME LU
    // ============================================
    
    console.log('📝 [CHAT_ROUTES] Montage route: POST /api/chat/mark-read/:conversationId');
    
    app.post('/api/chat/mark-read/:conversationId', optionalAuth, async (req, res) => {
      try {
        const { conversationId } = req.params;

        await pool.query(
          `UPDATE chat_messages 
           SET is_read = TRUE 
           WHERE conversation_id = $1 AND is_read = FALSE`,
          [conversationId]
        );

        io.to(`conversation_${conversationId}`).emit('messages_read', { conversationId });

        res.json({ success: true });

      } catch (error) {
        console.error('❌ Erreur marquage lu:', error);
        res.status(500).json({ error: 'Erreur serveur' });
      }
    });

    // ============================================
    // 8. GÉNÉRER MESSAGE BOOKING
    // ============================================
    
    console.log('📝 [CHAT_ROUTES] Montage route: GET /api/chat/generate-booking-message/:conversationId');
    
    app.get('/api/chat/generate-booking-message/:conversationId', 
      authenticateToken,
      checkSubscription,
      async (req, res) => {
      try {
        const { conversationId } = req.params;
        const userId = req.user.userId || req.user.id;

        const conversation = await pool.query(
          `SELECT * FROM conversations WHERE id = $1 AND user_id = $2`,
          [conversationId, userId]
        );

        if (conversation.rows.length === 0) {
          return res.status(404).json({ error: 'Conversation introuvable' });
        }

        const message = generateMessageTemplate(conversation.rows[0].pin_code, conversation.rows[0].unique_token);

        res.json({
          success: true,
          message
        });

      } catch (error) {
        console.error('❌ Erreur génération message:', error);
        res.status(500).json({ error: 'Erreur serveur' });
      }
    });

    // ============================================
    // 9. SOCKET.IO EVENTS
    // ============================================
    
    console.log('📝 [CHAT_ROUTES] Configuration Socket.IO');
    
    io.on('connection', (socket) => {
      console.log('🔌 Client connecté:', socket.id);

      socket.on('join_conversation', async (conversationId) => {
        socket.join(`conversation_${conversationId}`);
        console.log(`✅ Socket ${socket.id} rejoint conversation ${conversationId}`);
      });

      socket.on('leave_conversation', (conversationId) => {
        socket.leave(`conversation_${conversationId}`);
        console.log(`👋 Socket ${socket.id} quitte conversation ${conversationId}`);
      });

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

    console.log('✅ [CHAT_ROUTES] Toutes les routes montées avec succès !');

  } catch (error) {
    console.error('❌ [CHAT_ROUTES] ERREUR FATALE dans setupChatRoutes:', error);
    throw error;
  }
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

console.log('✅ [CHAT_ROUTES] Module chargé avec succès');

module.exports = { setupChatRoutes };
