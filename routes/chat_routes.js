// ============================================
// ROUTES SYSTÈME DE CHAT SÉCURISÉ
// ============================================

const crypto = require('crypto');

// ============================================
// 🤖 IMPORTS SYSTÈME ONBOARDING + RÉPONSES AUTO
// ============================================
const { handleIncomingMessage } = require('../integrated-chat-handler');
const { startOnboarding } = require('../onboarding-system');

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
    keywords: ['parking', 'garer', 'stationnement', 'voiture', 'se garer'],
    priority: 2
  }
};

function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectQuestions(message) {
  const normalized = normalizeText(message);
  const detected = [];
  
  for (const [category, config] of Object.entries(QUESTION_PATTERNS)) {
    for (const keyword of config.keywords) {
      const normalizedKeyword = normalizeText(keyword);
      if (normalized.includes(normalizedKeyword)) {
        detected.push({ category, priority: config.priority });
        break;
      }
    }
  }
  
  return detected.sort((a, b) => a.priority - b.priority);
}

function generateAutoResponse(property, detectedQuestions) {
  if (!property || detectedQuestions.length === 0) return null;
  
  const amenities = typeof property.amenities === 'string' ? JSON.parse(property.amenities) : (property.amenities || {});
  const houseRules = typeof property.house_rules === 'string' ? JSON.parse(property.house_rules) : (property.house_rules || {});
  const practicalInfo = typeof property.practical_info === 'string' ? JSON.parse(property.practical_info) : (property.practical_info || {});
  
  const responses = [];
  
  for (const question of detectedQuestions) {
    let response = null;
    
    switch (question.category) {
      case 'checkin':
        if (property.arrival_time) response = `L'arrivée est possible à partir de ${property.arrival_time}.`;
        break;
      case 'checkout':
        if (property.departure_time) response = `Le départ doit se faire avant ${property.departure_time}.`;
        break;
      case 'draps':
        response = amenities.draps ? 'Oui, les draps sont fournis.' : 'Non, les draps ne sont pas fournis.';
        break;
      case 'serviettes':
        response = amenities.serviettes ? 'Oui, les serviettes sont fournies.' : 'Non, les serviettes ne sont pas fournies.';
        break;
      case 'cuisine':
        response = amenities.cuisine_equipee ? 'Oui, la cuisine est équipée.' : 'La cuisine dispose d\'équipements de base.';
        break;
      case 'wifi':
        if (property.wifi_name && property.wifi_password) {
          response = `Réseau WiFi : "${property.wifi_name}"\nMot de passe : "${property.wifi_password}"`;
        }
        break;
      case 'acces_code':
        if (property.access_code) response = `Le code d'accès est : ${property.access_code}`;
        break;
      case 'animaux':
        response = houseRules.animaux ? 'Oui, les animaux sont acceptés.' : 'Non, les animaux ne sont pas acceptés.';
        break;
      case 'parking':
        if (amenities.parking && practicalInfo.parking_details) {
          response = `Oui, voici les informations parking : ${practicalInfo.parking_details}`;
        } else if (amenities.parking) {
          response = 'Oui, un parking est disponible.';
        }
        break;
    }
    
    if (response) responses.push(response);
  }
  
  return responses.length > 0 ? responses.join('\n\n') : null;
}

// ============================================
// Configuration des routes de chat
// ============================================

/**
 * Configuration des routes de chat
 * @param {Object} app - Express app
 * @param {Object} pool - PostgreSQL pool
 * @param {Object} io - Socket.io instance
 */
function setupChatRoutes(app, pool, io, authenticateAny, checkSubscription) {
  
  // ✅ Import des fonctions de gestion des permissions depuis le middleware
  const { 
    requirePermission, 
    loadSubAccountData, 
    filterByAccessibleProperties, 
    getRealUserId 
  } = require('../sub-accounts-middleware');
  
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
      const photosToken = crypto.randomBytes(32).toString('hex');

      // Créer la conversation
      const result = await pool.query(
        `INSERT INTO conversations 
        (user_id, property_id, reservation_start_date, reservation_end_date, platform, guest_name, guest_email, pin_code, unique_token, photos_token, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
        RETURNING id, unique_token, pin_code, photos_token`,
        [userId, property_id, reservation_start_date, reservation_end_date, platform || 'direct', guest_name, guest_email, pinCode, uniqueToken, photosToken]
      );

      const conversation = result.rows[0];

      // ✅ Envoyer le message de bienvenue automatique
      await sendWelcomeMessage(pool, io, conversation.id, property_id, userId);

      res.json({
        success: true,
        conversation_id: conversation.id,
        chat_link: `${process.env.APP_URL || 'http://localhost:3000'}/chat/${conversation.unique_token}`,
        pin_code: conversation.pin_code,
        photos_token: conversation.photos_token
      });

    } catch (error) {
      console.error('❌ Erreur création conversation:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // ============================================
  // 2. LISTE DES CONVERSATIONS (PROPRIÉTAIRE)
  // ============================================
  
  app.get('/api/chat/conversations', 
    authenticateToken, 
    checkSubscription, 
    requirePermission(pool, 'can_view_conversations'),
    loadSubAccountData(pool),
    async (req, res) => {
    try {
      // ✅ Support des sous-comptes : récupérer l'ID utilisateur réel
      const userId = await getRealUserId(pool, req);
      const { status, property_id } = req.query;

      let query = `
        SELECT 
          c.*,
          c.guest_first_name,
          c.guest_last_name,
          c.guest_phone,
          p.name as property_name,
          p.color as property_color,
          (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND is_read = FALSE AND sender_type = 'guest') as unread_count,
          (SELECT message FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
          (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_time
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
      const filteredConversations = filterByAccessibleProperties(result.rows, req);

      // ⭐ Enrichir les conversations avec les infos du voyageur
      const enrichedConversations = filteredConversations.map(conv => ({
        ...conv,
        guest_display_name: conv.guest_first_name 
          ? `${conv.guest_first_name} ${conv.guest_last_name || ''}`.trim()
          : `Voyageur ${conv.platform || 'Booking'}`,
        guest_initial: conv.guest_first_name 
          ? conv.guest_first_name.charAt(0).toUpperCase() 
          : 'V'
      }));

      res.json({
        success: true,
        conversations: enrichedConversations
      });

    } catch (error) {
      console.error('❌ Erreur récupération conversations:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // ============================================
  // 3. VÉRIFICATION ET ACCÈS AU CHAT (VOYAGEUR)
  // ============================================
  
  /**
   * Vérification par token unique (lien direct)
   */
  app.post('/api/chat/verify', async (req, res) => {
    try {
      const { token, pin_code } = req.body;

      if (!token || !pin_code) {
        return res.status(400).json({ error: 'Token et PIN requis' });
      }

      const result = await pool.query(
        `SELECT 
          c.*,
          c.guest_first_name,
          c.guest_last_name,
          c.guest_phone,
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
        reservation_end: conversation.reservation_end_date,
        // ⭐ Ajouter les infos du voyageur
        guest_first_name: conversation.guest_first_name,
        guest_last_name: conversation.guest_last_name,
        guest_phone: conversation.guest_phone,
        guest_display_name: conversation.guest_first_name 
          ? `${conversation.guest_first_name} ${conversation.guest_last_name || ''}`.trim()
          : `Voyageur ${conversation.platform || 'Booking'}`,
        guest_initial: conversation.guest_first_name 
          ? conversation.guest_first_name.charAt(0).toUpperCase() 
          : 'V'
      });

    } catch (error) {
      console.error('❌ Erreur vérification:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  /**
   * Vérification par property + dates + PIN
   */
  app.post('/api/chat/verify-by-property', async (req, res) => {
    try {
      const { property_id, chat_pin, checkin_date, checkout_date, platform } = req.body;

      if (!property_id || !chat_pin || !checkin_date || !platform) {
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
        return res.status(404).json({ error: 'Propriété introuvable' });
      }

      const checkinDateStr = new Date(checkin_date).toISOString().split('T')[0];
      const checkoutDateStr = checkout_date ? new Date(checkout_date).toISOString().split('T')[0] : null;

      // Vérifier qu'une réservation existe
      console.log('🔍 [VERIFY] Recherche réservation avec:', {
        property_id,
        checkinDateStr,
        checkoutDateStr,
        platform
      });
      
      // Recherche FLEXIBLE bidirectionnelle
      const reservationResult = await pool.query(
        `SELECT id, source, platform FROM reservations 
         WHERE property_id = $1 
         AND DATE(start_date) = $2 
         AND ($3::date IS NULL OR DATE(end_date) = $3)
         AND (
           -- Match exact
           LOWER(source) = LOWER($4)
           OR LOWER(platform) = LOWER($4)
           -- Source/Platform contient ce que l'utilisateur cherche
           OR LOWER(source) LIKE '%' || LOWER($4) || '%'
           OR LOWER(platform) LIKE '%' || LOWER($4) || '%'
           -- CE QUE L'UTILISATEUR CHERCHE contient source/platform (inversé)
           OR LOWER($4) LIKE '%' || LOWER(source) || '%'
           OR LOWER($4) LIKE '%' || LOWER(platform) || '%'
         )
         LIMIT 1`,
        [property_id, checkinDateStr, checkoutDateStr, platform]
      );

      console.log('📊 [VERIFY] Résultat recherche:', {
        found: reservationResult.rows.length > 0,
        data: reservationResult.rows[0]
      });

      if (reservationResult.rows.length === 0) {
        // Debug : voir ce qu'il y a vraiment dans la base
        const debugResult = await pool.query(
          `SELECT id, source, platform, start_date, end_date 
           FROM reservations 
           WHERE property_id = $1 
           AND DATE(start_date) = $2 
           LIMIT 3`,
          [property_id, checkinDateStr]
        );
        
        console.log('❌ [VERIFY] Aucune réservation trouvée. Voici ce qui existe pour cette date:', debugResult.rows);
        
        return res.status(404).json({ 
          error: 'Aucune réservation trouvée avec ces informations',
          debug: debugResult.rows.length > 0 ? {
            available: debugResult.rows.map(r => ({
              source: r.source,
              platform: r.platform
            }))
          } : 'Aucune réservation pour cette date'
        });
      }

      // Chercher ou créer la conversation
      let conversation;
      const existingConv = await pool.query(
        `SELECT * FROM conversations 
         WHERE property_id = $1 
         AND reservation_start_date = $2 
         AND platform = $3 
         AND pin_code = $4`,
        [property_id, checkinDateStr, platform, chat_pin]
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
        }
      } else {
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
        
        // ✅ Envoyer le message de bienvenue pour la nouvelle conversation
        await sendWelcomeMessage(pool, io, conversation.id, property_id, property.rows[0].user_id);
      }

      // ⭐ Récupérer les infos du voyageur de la conversation
      const convDetailsResult = await pool.query(
        `SELECT guest_first_name, guest_last_name, guest_phone, platform 
         FROM conversations 
         WHERE id = $1`,
        [conversation.id]
      );
      
      const convDetails = convDetailsResult.rows[0] || {};

      res.json({
        success: true,
        conversation_id: conversation.id,
        property_id: property_id,
        property_name: property.rows[0].name,
        // ⭐ Ajouter les infos du voyageur
        guest_first_name: convDetails.guest_first_name,
        guest_last_name: convDetails.guest_last_name,
        guest_phone: convDetails.guest_phone,
        guest_display_name: convDetails.guest_first_name 
          ? `${convDetails.guest_first_name} ${convDetails.guest_last_name || ''}`.trim()
          : `Voyageur ${convDetails.platform || 'Booking'}`,
        guest_initial: convDetails.guest_first_name 
          ? convDetails.guest_first_name.charAt(0).toUpperCase() 
          : 'V'
      });

    } catch (error) {
      console.error('❌ Erreur vérification:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // ============================================
  // 4. RÉCUPÉRER LES MESSAGES D'UNE CONVERSATION
  // ============================================
  
  app.get('/api/chat/messages/:conversationId', optionalAuth, async (req, res) => {
    try {
      const { conversationId } = req.params;

      const convCheck = await pool.query(
        `SELECT c.id, c.user_id, c.property_id,
                c.guest_first_name, c.guest_last_name, c.guest_phone, c.platform 
         FROM conversations c 
         WHERE c.id = $1`,
        [conversationId]
      );

      if (convCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Conversation introuvable' });
      }

      const conversation = convCheck.rows[0];

      // Vérifier les permissions (propriétaire OU sous-compte OU voyageur vérifié)
      if (req.user) {
        // ✅ Support des sous-comptes
        const realUserId = req.user.isSubAccount 
          ? (await getRealUserId(pool, req))
          : req.user.id;
        
        if (realUserId !== conversation.user_id) {
          // Vérifier si sous-compte avec accès à cette propriété
          if (req.user.isSubAccount) {
            const subAccountData = await pool.query(
              'SELECT accessible_property_ids FROM sub_account_data WHERE sub_account_id = $1',
              [req.user.subAccountId]
            );
            
            if (subAccountData.rows.length > 0) {
              const accessibleIds = subAccountData.rows[0].accessible_property_ids || [];
              if (accessibleIds.length > 0 && !accessibleIds.includes(conversation.property_id)) {
                return res.status(403).json({ error: 'Accès refusé à cette propriété' });
              }
            }
          } else {
            return res.status(403).json({ error: 'Accès refusé' });
          }
        }
      }

      const messages = await pool.query(
        `SELECT 
          id, conversation_id, sender_type, sender_name, message,
          is_read, is_bot_response, is_auto_response,
          created_at, read_at, delivered_at
         FROM messages
         WHERE conversation_id = $1
         ORDER BY created_at ASC`,
        [conversationId]
      );

      res.json({
        success: true,
        messages: messages.rows,
        // ⭐ Ajouter les infos de la conversation
        conversation: {
          id: conversation.id,
          guest_first_name: conversation.guest_first_name,
          guest_last_name: conversation.guest_last_name,
          guest_phone: conversation.guest_phone,
          guest_display_name: conversation.guest_first_name 
            ? `${conversation.guest_first_name} ${conversation.guest_last_name || ''}`.trim()
            : `Voyageur ${conversation.platform || 'Booking'}`,
          guest_initial: conversation.guest_first_name 
            ? conversation.guest_first_name.charAt(0).toUpperCase() 
            : 'V'
        }
      });

    } catch (error) {
      console.error('❌ Erreur récupération messages:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // ============================================
  // 5. ENVOYER UN MESSAGE
  // ============================================
  
  app.post('/api/chat/send', optionalAuth, async (req, res) => {
    try {
      const { conversation_id, message, sender_type, sender_name } = req.body;

      if (!conversation_id || !message || !sender_type) {
        return res.status(400).json({ error: 'Données manquantes' });
      }

      // Vérifier que la conversation existe
      const convResult = await pool.query(
        `SELECT id, user_id, property_id, status FROM conversations WHERE id = $1`,
        [conversation_id]
      );

      if (convResult.rows.length === 0) {
        return res.status(404).json({ error: 'Conversation introuvable' });
      }

      const conversation = convResult.rows[0];

      // Vérifier les permissions
      if (req.user && sender_type === 'owner') {
        // ✅ Support des sous-comptes
        const realUserId = req.user.isSubAccount 
          ? (await getRealUserId(pool, req))
          : req.user.id;
        
        if (realUserId !== conversation.user_id) {
          return res.status(403).json({ error: 'Accès refusé' });
        }
        
        // ✅ Vérifier accès propriété si sous-compte
        if (req.user.isSubAccount) {
          const subAccountData = await pool.query(
            'SELECT accessible_property_ids FROM sub_account_data WHERE sub_account_id = $1',
            [req.user.subAccountId]
          );
          
          if (subAccountData.rows.length > 0) {
            const accessibleIds = subAccountData.rows[0].accessible_property_ids || [];
            if (accessibleIds.length > 0 && !accessibleIds.includes(conversation.property_id)) {
              return res.status(403).json({ error: 'Accès refusé à cette propriété' });
            }
          }
        }
      }

      // Insérer le message
      const result = await pool.query(
        `INSERT INTO messages 
        (conversation_id, sender_type, sender_name, message, is_read, created_at)
        VALUES ($1, $2, $3, $4, FALSE, NOW())
        RETURNING id, conversation_id, sender_type, sender_name, message, is_read, is_bot_response, is_auto_response, created_at`,
        [conversation_id, sender_type, sender_name || 'Anonyme', message]
      );

      const newMessage = result.rows[0];

      // Marquer conversation comme active
      await pool.query(
        `UPDATE conversations SET status = 'active', last_message_at = NOW() WHERE id = $1`,
        [conversation_id]
      );

      // Émettre via Socket.io
      if (io) {
        io.to(`conversation_${conversation_id}`).emit('new_message', newMessage);
      }
// ============================================
// 🔔 NOTIFICATION PUSH FIREBASE - PROPRIÉTAIRE → VOYAGEUR  
// ============================================

// Si c'est le propriétaire qui répond, notifier le voyageur (s'il a l'app)
if (sender_type === 'owner') {
  try {
    // Récupérer l'email du voyageur depuis la conversation
    const guestResult = await pool.query(
      'SELECT guest_email FROM conversations WHERE id = $1',
      [conversation_id]
    );
    
    if (guestResult.rows.length > 0 && guestResult.rows[0].guest_email) {
      const guestEmail = guestResult.rows[0].guest_email;
      
      // Vérifier si le voyageur a un compte et un token
      const guestUserResult = await pool.query(
        `SELECT u.id 
         FROM users u
         JOIN user_fcm_tokens t ON u.id = t.user_id
         WHERE u.email = $1 AND t.fcm_token IS NOT NULL
         LIMIT 1`,
        [guestEmail]
      );
      
      if (guestUserResult.rows.length > 0) {
        const guestUserId = guestUserResult.rows[0].id;
        
        // Récupérer le nom de la propriété
        const propertyResult = await pool.query(
          'SELECT name FROM properties WHERE id = $1',
          [conversation.property_id]
        );
        
        const propertyName = propertyResult.rows.length > 0 
          ? propertyResult.rows[0].name 
          : 'Votre logement';
        
        const { sendNewMessageNotification } = require('../services/notifications-service');
        
        const messagePreview = message.length > 100 
          ? message.substring(0, 97) + '...' 
          : message;
        
        await sendNewMessageNotification(
          guestUserId,
          conversation_id,
          messagePreview,
          propertyName
        );
        
        console.log(`✅ Notification push envoyée au voyageur ${guestUserId}`);
      }
    }
  } catch (notifError) {
    console.error('❌ Erreur notification push voyageur:', notifError.message);
  }
}
      // ✅ Si c'est un message du voyageur, chercher une réponse automatique
      if (sender_type === 'guest') {
        const autoResponse = await findAutoResponse(pool, conversation.user_id, conversation.property_id, message);
        
        if (autoResponse) {
          // Attendre un peu pour simuler un délai naturel
          setTimeout(async () => {
            try {
              const autoResult = await pool.query(
                `INSERT INTO messages 
                (conversation_id, sender_type, sender_name, message, is_read, is_bot_response, is_auto_response, created_at)
                VALUES ($1, 'bot', 'Assistant automatique', $2, FALSE, TRUE, TRUE, NOW())
                RETURNING id, conversation_id, sender_type, sender_name, message, is_read, is_bot_response, is_auto_response, created_at`,
                [conversation_id, autoResponse]
              );

              const autoMsg = autoResult.rows[0];
              
              if (io) {
                io.to(`conversation_${conversation_id}`).emit('new_message', autoMsg);
              }

              console.log(`🤖 Réponse automatique envoyée pour conversation ${conversation_id}`);
            } catch (error) {
              console.error('❌ Erreur envoi réponse auto:', error);
            }
          }, 1500);
        }

        // Créer une notification pour le propriétaire
        await createNotification(pool, io, conversation.user_id, conversation_id, newMessage.id, 'new_message');
        
        // ============================================
// 🔔 NOTIFICATION PUSH FIREBASE - VOYAGEUR → PROPRIÉTAIRE
// ============================================

// Envoyer une notification push au propriétaire quand un voyageur écrit
try {
  const { sendNewMessageNotification } = require('../services/notifications-service');
  
  const messagePreview = message.length > 100 
    ? message.substring(0, 97) + '...' 
    : message;
  
  await sendNewMessageNotification(
    conversation.user_id,      // userId (propriétaire)
    'Voyageur',                // senderName
    messagePreview,            // messagePreview
    conversation_id            // conversationId
  );
  
  console.log(`✅ Notification push envoyée au propriétaire ${conversation.user_id}`);
  
} catch (notifError) {
  console.error('❌ Erreur notification push:', notifError.message);
}
} 

      // ============================================
      // 🤖 TRAITEMENT AUTOMATIQUE (Onboarding + Réponses auto)
      // ============================================
      if (sender_type === 'guest') {
        try {
          // Récupérer la conversation complète avec tous les champs nécessaires
          const fullConvResult = await pool.query(
            'SELECT * FROM conversations WHERE id = $1',
            [conversation_id]
          );
          
          if (fullConvResult.rows.length > 0) {
            const fullConversation = fullConvResult.rows[0];
            
            // Traiter le message (onboarding + réponses auto)
            await handleIncomingMessage(newMessage, fullConversation, pool, io);
            
            console.log(`✅ Message traité automatiquement pour conversation ${conversation_id}`);
          }
        } catch (autoError) {
          console.error('❌ Erreur traitement auto:', autoError);
          // Ne pas bloquer l'envoi du message même si l'auto-traitement échoue
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
  // 6. MARQUER MESSAGES COMME LUS
  // ============================================
  
  app.post('/api/chat/mark-read/:conversationId', optionalAuth, async (req, res) => {
    try {
      const { conversationId } = req.params;

      await pool.query(
        `UPDATE messages 
         SET is_read = TRUE, read_at = NOW()
         WHERE conversation_id = $1 AND is_read = FALSE`,
        [conversationId]
      );

      // Émettre via Socket.io
      if (io) {
        io.to(`conversation_${conversationId}`).emit('messages_read', { conversationId });
      }

      res.json({ success: true });

    } catch (error) {
      console.error('❌ Erreur marquage lu:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // ============================================
  // 7. GÉNÉRER LE MESSAGE POUR AIRBNB/BOOKING
  // ============================================
  
  app.get('/api/chat/generate-booking-message/:conversationId', 
    authenticateToken, 
    checkSubscription, 
    requirePermission(pool, 'can_generate_booking_messages'),
    loadSubAccountData(pool),
    async (req, res) => {
    try {
      const { conversationId } = req.params;
      // ✅ Support des sous-comptes
      const userId = await getRealUserId(pool, req);

      const result = await pool.query(
        `SELECT c.unique_token, c.pin_code, c.user_id, c.property_id 
         FROM conversations c 
         WHERE c.id = $1`,
        [conversationId]
      );

      if (result.rows.length === 0 || result.rows[0].user_id !== userId) {
        return res.status(404).json({ error: 'Conversation introuvable' });
      }

      const conversation = result.rows[0];
      
      // ✅ Vérifier accès propriété si sous-compte
      if (req.user.isSubAccount && req.subAccountData.accessible_property_ids.length > 0) {
        if (!req.subAccountData.accessible_property_ids.includes(conversation.property_id)) {
          return res.status(403).json({ error: 'Accès refusé à cette propriété' });
        }
      }

      const message = generateMessageTemplate(conversation.pin_code, conversation.unique_token);

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
  // 8. SOCKET.IO EVENTS
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
async function sendWelcomeMessage(pool, io, conversationId, propertyId, userId) {
  try {
    console.log(`🎯 Démarrage de l'onboarding pour conversation ${conversationId}`);
    
    // Démarrer l'onboarding au lieu du message de bienvenue classique
    const { startOnboarding } = require('../onboarding-system');
    await startOnboarding(conversationId, pool, io);
    
    console.log(`✅ Onboarding démarré pour conversation ${conversationId}`);
  } catch (error) {
    console.error('❌ Erreur sendWelcomeMessage (onboarding):', error);
  }
}

/**
 * Trouve une réponse automatique correspondante
 */
async function findAutoResponse(pool, userId, propertyId, messageContent) {
  try {
    // Récupérer les infos complètes de la propriété
    const propertyResult = await pool.query(
      `SELECT 
        id, name, address, arrival_time, departure_time,
        wifi_name, wifi_password, access_code, access_instructions,
        amenities, house_rules, practical_info, auto_responses_enabled
       FROM properties 
       WHERE id = $1 AND user_id = $2`,
      [propertyId, userId]
    );
    
    if (propertyResult.rows.length === 0) {
      return null;
    }
    
    const property = propertyResult.rows[0];
    
    // Vérifier si les réponses auto sont activées
    if (property.auto_responses_enabled === false) {
      return null;
    }
    
    // Détecter les questions
    const detectedQuestions = detectQuestions(messageContent);
    
    if (detectedQuestions.length === 0) {
      return null;
    }
    
    // Générer la réponse
    const response = generateAutoResponse(property, detectedQuestions);
    
    if (response) {
      console.log('🤖 Réponse auto générée pour:', detectedQuestions.map(q => q.category).join(', '));
      return response;
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
