// ============================================
// SERVICE D'ENVOI AUTOMATIQUE DES MESSAGES D'ARRIVÉE
// Envoie un message de bienvenue avec tous les liens le jour de l'arrivée à 7h
// ============================================

const crypto = require('crypto');

/**
 * Génère le message de bienvenue avec tous les liens
 */
function generateArrivalMessage(conversation, property, hasCleaningPhotos, cleaningPhotoCount) {
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const baseUrl = appUrl.replace(/\/$/, '');
  
  const propertyName = property.name || 'votre logement';
  const chatLink = `${baseUrl}/chat/${conversation.unique_token}`;
  const cleaningPhotosLink = `${baseUrl}/chat/${conversation.photos_token}/cleaning-photos`;
  const checkoutFormLink = `${baseUrl}/chat/${conversation.photos_token}/checkout-form`;
  
  let message = `🎉 Bienvenue dans ${propertyName} !

Nous sommes ravis de vous accueillir aujourd'hui.

📋 Informations importantes :

`;

  // Livret d'accueil
  if (property.welcome_book_url) {
    message += `📖 Livret d'accueil :
Retrouvez toutes les informations sur le logement (WiFi, accès, règles, etc.) :
👉 ${property.welcome_book_url}

`;
  }

  // Photos du ménage
  if (hasCleaningPhotos) {
    message += `🧹 État du logement à votre arrivée :
Consultez les photos du nettoyage effectué juste avant votre arrivée (${cleaningPhotoCount} photos) :
👉 ${cleaningPhotosLink}

`;
  }

  // Photos de sortie
  message += `📸 Photos de départ (optionnel) :
Si vous le souhaitez, vous pouvez prendre quelques photos avant de partir pour documenter l'état du logement :
👉 ${checkoutFormLink}

`;

  // Instructions de base si pas de livret
  if (!property.welcome_book_url) {
    message += `ℹ️ Informations pratiques :
`;
    
    if (property.arrival_time) {
      message += `• Arrivée : à partir de ${property.arrival_time}\n`;
    }
    if (property.departure_time) {
      message += `• Départ : avant ${property.departure_time}\n`;
    }
    if (property.access_code) {
      message += `• Code d'accès : ${property.access_code}\n`;
    }
    if (property.wifi_name) {
      message += `• WiFi : "${property.wifi_name}"`;
      if (property.wifi_password) {
        message += ` / Mot de passe : "${property.wifi_password}"`;
      }
      message += `\n`;
    }
    
    message += `\n`;
  }

  message += `💬 Questions ?
N'hésitez pas à nous contacter via le chat pour toute question :
👉 ${chatLink}

Excellent séjour ! 🏡✨`;

  return message;
}

/**
 * Vérifie si un message d'arrivée a déjà été envoyé pour cette conversation
 */
async function hasArrivalMessageBeenSent(pool, conversationId) {
  try {
    const result = await pool.query(
      `SELECT id FROM messages 
       WHERE conversation_id = $1 
       AND sender_type = 'system' 
       AND message LIKE '%Bienvenue dans%'
       LIMIT 1`,
      [conversationId]
    );
    
    return result.rows.length > 0;
  } catch (error) {
    console.error('❌ Erreur vérification message arrivée:', error);
    return false;
  }
}

/**
 * Envoie le message d'arrivée pour une conversation
 */
async function sendArrivalMessage(pool, io, conversation) {
  try {
    // Vérifier si le message a déjà été envoyé
    const alreadySent = await hasArrivalMessageBeenSent(pool, conversation.id);
    if (alreadySent) {
      console.log(`⏭️  Message d'arrivée déjà envoyé pour conversation ${conversation.id}`);
      return { success: false, reason: 'already_sent' };
    }

    // Récupérer les infos de la propriété
    const propertyResult = await pool.query(
      `SELECT id, name, welcome_book_url, arrival_time, departure_time,
              access_code, wifi_name, wifi_password
       FROM properties 
       WHERE id = $1`,
      [conversation.property_id]
    );

    if (propertyResult.rows.length === 0) {
      console.log(`❌ Propriété ${conversation.property_id} introuvable`);
      return { success: false, reason: 'property_not_found' };
    }

    const property = propertyResult.rows[0];

    // Vérifier s'il y a des photos de ménage
    const startDate = new Date(conversation.reservation_start_date).toISOString().split('T')[0];
    const endDate = conversation.reservation_end_date 
      ? new Date(conversation.reservation_end_date).toISOString().split('T')[0]
      : null;
    
    const reservationKey = endDate 
      ? `${conversation.property_id}_${startDate}_${endDate}`
      : null;

    let hasCleaningPhotos = false;
    let cleaningPhotoCount = 0;

    if (reservationKey) {
      const cleaningResult = await pool.query(
        `SELECT photos FROM cleaning_checklists WHERE reservation_key = $1`,
        [reservationKey]
      );

      if (cleaningResult.rows.length > 0) {
        const photos = cleaningResult.rows[0].photos;
        cleaningPhotoCount = Array.isArray(photos) ? photos.length : 
                           (typeof photos === 'string' ? JSON.parse(photos).length : 0);
        hasCleaningPhotos = cleaningPhotoCount > 0;
      }
    }

    // Générer le message
    const message = generateArrivalMessage(conversation, property, hasCleaningPhotos, cleaningPhotoCount);

    // Insérer le message dans la base
    const messageResult = await pool.query(
      `INSERT INTO messages (conversation_id, sender_type, sender_name, message, is_read, created_at)
       VALUES ($1, 'system', 'Bienvenue', $2, FALSE, NOW())
       RETURNING id, conversation_id, sender_type, sender_name, message, is_read, created_at`,
      [conversation.id, message]
    );

    const savedMessage = messageResult.rows[0];

    // Émettre via Socket.io si disponible
    if (io) {
      io.to(`conversation_${conversation.id}`).emit('new_message', savedMessage);
    }

    console.log(`✅ Message d'arrivée envoyé pour conversation ${conversation.id} (${property.name})`);

    return {
      success: true,
      messageId: savedMessage.id,
      conversationId: conversation.id,
      propertyName: property.name,
      guestName: conversation.guest_name,
      guestEmail: conversation.guest_email
    };

  } catch (error) {
    console.error(`❌ Erreur envoi message arrivée pour conversation ${conversation.id}:`, error);
    return { success: false, reason: 'error', error: error.message };
  }
}

/**
 * Traite toutes les arrivées du jour à 7h
 */
async function processArrivalsForToday(pool, io, transporter) {
  try {
    console.log('🔄 Traitement des arrivées du jour...');

    // Date du jour (format YYYY-MM-DD en heure de Paris)
    const today = new Date().toLocaleDateString('fr-FR', { 
      timeZone: 'Europe/Paris',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).split('/').reverse().join('-');

    console.log(`📅 Recherche des arrivées pour le ${today}`);

    // Récupérer toutes les conversations avec arrivée aujourd'hui
    const result = await pool.query(
      `SELECT c.*, u.email as owner_email, u.first_name as owner_first_name
       FROM conversations c
       LEFT JOIN users u ON c.user_id = u.id
       WHERE DATE(c.reservation_start_date) = $1
       AND c.is_verified = TRUE`,
      [today]
    );

    console.log(`📊 ${result.rows.length} arrivée(s) trouvée(s)`);

    const results = [];
    const successfulSends = [];

    for (const conversation of result.rows) {
      const sendResult = await sendArrivalMessage(pool, io, conversation);
      results.push(sendResult);

      if (sendResult.success) {
        successfulSends.push({
          ...sendResult,
          ownerEmail: conversation.owner_email,
          ownerFirstName: conversation.owner_first_name
        });
      }
    }

    // Envoyer des emails de notification aux propriétaires
    if (transporter && successfulSends.length > 0) {
      await sendOwnerNotifications(transporter, successfulSends);
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`✅ ${successCount}/${results.length} message(s) d'arrivée envoyé(s) avec succès`);

    return {
      total: results.length,
      success: successCount,
      results
    };

  } catch (error) {
    console.error('❌ Erreur traitement des arrivées:', error);
    return { total: 0, success: 0, error: error.message };
  }
}

/**
 * Envoie des emails de notification aux propriétaires
 */
async function sendOwnerNotifications(transporter, sends) {
  try {
    for (const send of sends) {
      if (!send.ownerEmail) continue;

      const mailOptions = {
        from: process.env.EMAIL_FROM || 'noreply@bookingmanage.com',
        to: send.ownerEmail,
        subject: `Message de bienvenue envoyé - ${send.propertyName}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #10B981;">✅ Message de bienvenue envoyé</h2>
            
            <p>Bonjour ${send.ownerFirstName || ''},</p>
            
            <p>Le message de bienvenue automatique a été envoyé à votre voyageur :</p>
            
            <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 5px 0;"><strong>Logement :</strong> ${send.propertyName}</p>
              <p style="margin: 5px 0;"><strong>Voyageur :</strong> ${send.guestName || 'Non renseigné'}</p>
              ${send.guestEmail ? `<p style="margin: 5px 0;"><strong>Email :</strong> ${send.guestEmail}</p>` : ''}
            </div>
            
            <p>Le voyageur a reçu :</p>
            <ul>
              <li>Lien du livret d'accueil (si configuré)</li>
              <li>Lien des photos du ménage (si disponibles)</li>
              <li>Lien pour photos de sortie</li>
              <li>Informations pratiques</li>
            </ul>
            
            <p style="color: #6B7280; font-size: 14px; margin-top: 30px;">
              Cet email est envoyé automatiquement à chaque arrivée.<br>
              Bookingmanage - Gestion simplifiée de vos locations
            </p>
          </div>
        `
      };

      await transporter.sendMail(mailOptions);
      console.log(`📧 Email de notification envoyé à ${send.ownerEmail}`);
    }
  } catch (error) {
    console.error('❌ Erreur envoi notifications propriétaires:', error);
  }
}

module.exports = {
  generateArrivalMessage,
  sendArrivalMessage,
  processArrivalsForToday,
  hasArrivalMessageBeenSent
};
