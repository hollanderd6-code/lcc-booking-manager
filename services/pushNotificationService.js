const admin = require('firebase-admin');
const path = require('path');

// Initialiser Firebase Admin SDK
let firebaseInitialized = false;

function initializeFirebase() {
  if (firebaseInitialized) return;

  try {
    const serviceAccount = require(path.join(__dirname, '../firebase-service-account.json'));

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });

    firebaseInitialized = true;
    console.log('✅ Firebase Admin SDK initialisé');
  } catch (error) {
    // Firebase refuse un second initializeApp sur l'app par défaut. Si un autre
    // module l'a déjà initialisée, ce n'est pas une panne : on se marque comme
    // prêt au lieu de rester bloqué à false et de refuser tous les envois.
    if (error.code === 'app/duplicate-app' || /already exists/i.test(error.message || '')) {
      firebaseInitialized = true;
      console.log('ℹ️ Firebase Admin déjà initialisé par un autre module');
      return;
    }
    console.error('❌ Erreur initialisation Firebase Admin:', error.message);
  }
}

// Initialiser au démarrage
initializeFirebase();

/**
 * Envoie une notification push à un utilisateur
 * @param {string} userId - ID de l'utilisateur destinataire
 * @param {Object} notification - Contenu de la notification
 * @param {Object} db - Instance de la base de données
 */
async function sendPushNotification(userId, notification, db) {
  if (!firebaseInitialized) {
    console.error('❌ Firebase Admin non initialisé');
    return;
  }

  try {
    // La colonne s'appelle fcm_token, pas token : la table user_fcm_tokens a
    // pour colonnes id, user_id, fcm_token, device_id, device_type,
    // sub_account_id, created_at, updated_at. La requête d'origine lisait
    // « token » — elle levait donc une erreur SQL à chaque appel, et aucune
    // notification passant par ce fichier ne partait.
    const tokens = await db.query(
      'SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1 AND fcm_token IS NOT NULL',
      [userId]
    );

    if (!tokens.rows || tokens.rows.length === 0) {
      console.log(`ℹ️ Aucun token FCM pour l'utilisateur ${userId}`);
      return;
    }

    const fcmTokens = tokens.rows.map(row => row.fcm_token);

    // Préparer le message
    const message = {
      notification: {
        title: notification.title,
        body: notification.body
      },
      data: notification.data || {},
      tokens: fcmTokens
    };

    // sendMulticast a été retiré de firebase-admin en v11 ; le projet est en
    // ^13.6.0, donc la méthode était undefined et l'appel levait un TypeError.
    // sendEachForMulticast prend le même message et renvoie la même forme de
    // réponse (successCount, failureCount, responses[]).
    const response = await admin.messaging().sendEachForMulticast(message);

    console.log(`✅ Notification envoyée à ${userId}: ${response.successCount}/${fcmTokens.length} tokens`);

    // Nettoyer les tokens invalides
    if (response.failureCount > 0) {
      const tokensToDelete = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          // Ne supprimer que les tokens réellement périmés. Une panne réseau ou
          // un quota dépassé fait aussi échouer la réponse : purger sur ce seul
          // critère effacerait des tokens valides, et l'appareil ne recevrait
          // plus rien jusqu'à sa prochaine reconnexion.
          const code = resp.error?.code || '';
          if (code === 'messaging/registration-token-not-registered'
              || code === 'messaging/invalid-registration-token'
              || code === 'messaging/invalid-argument') {
            tokensToDelete.push(fcmTokens[idx]);
          }
        }
      });

      if (tokensToDelete.length > 0) {
        await db.query(
          'DELETE FROM user_fcm_tokens WHERE fcm_token = ANY($1)',
          [tokensToDelete]
        );
        console.log(`🧹 ${tokensToDelete.length} token(s) invalide(s) supprimé(s)`);
      }
    }

    return response;
  } catch (error) {
    console.error('❌ Erreur envoi notification push:', error.message);
    throw error;
  }
}

/**
 * Envoie une notification pour un nouveau message
 * @param {string} recipientUserId - ID de l'utilisateur qui reçoit le message
 * @param {Object} messageData - Données du message
 * @param {Object} db - Instance de la base de données
 */
async function sendNewMessageNotification(recipientUserId, messageDataOrGuestName, messageTextOrDb, conversationIdOrUndefined, dbOrUndefined) {
  // Support deux signatures :
  // 1. (userId, messageData{...}, db)               — ancien format objet
  // 2. (userId, guestName, messageText, convId, db) — format direct depuis server.js
  let guestName, messageText, conversationId, db;

  if (typeof messageDataOrGuestName === 'object' && messageDataOrGuestName !== null) {
    // Format objet
    const messageData = messageDataOrGuestName;
    db = messageTextOrDb;
    guestName     = messageData.senderName || messageData.guestName || 'Voyageur';
    messageText   = messageData.message || '';
    conversationId = messageData.conversationId;
  } else {
    // Format direct : (userId, guestName, message, convId, db)
    guestName      = messageDataOrGuestName || 'Voyageur';
    messageText    = messageTextOrDb || '';
    conversationId = conversationIdOrUndefined;
    db             = dbOrUndefined;
  }

  // Aperçu du message : tronquer à 80 chars, masquer les URLs
  const preview = (messageText || '')
    .replace(/https?:\/\/\S+/g, '🔗 Lien')
    .substring(0, 80);

  // Récupérer le nom du logement depuis la conversation si possible.
  // conversations n'a PAS de colonne property_name : la requête d'origine
  // lisait cette colonne inexistante, l'erreur était avalée par le .catch
  // juste en dessous, et le nom du logement n'apparaissait jamais dans le
  // titre. On passe par properties, comme le reste du code.
  let propertyName = '';
  try {
    if (conversationId && db) {
      const convRow = await db.query(
        `SELECT COALESCE(p.internal_name, p.name) AS property_name
           FROM conversations c
           LEFT JOIN properties p ON p.id = c.property_id
          WHERE c.id = $1
          LIMIT 1`,
        [conversationId]
      ).catch(() => ({ rows: [] }));
      propertyName = convRow.rows[0]?.property_name || '';
    }
  } catch(e) {}

  const titleParts = ['💬', guestName];
  if (propertyName) titleParts.push('·', propertyName);

  const notification = {
    title: titleParts.join(' '),
    body: preview || 'Nouveau message',
    data: {
      type: 'new_chat_message',
      conversationId: conversationId ? conversationId.toString() : '',
      conversation_id: conversationId ? conversationId.toString() : '',
    }
  };

  return await sendPushNotification(recipientUserId, notification, db);
}

/**
 * Envoie une notification pour une nouvelle réservation
 * @param {string} userId - ID de l'utilisateur propriétaire
 * @param {Object} reservationData - Données de la réservation
 * @param {Object} db - Instance de la base de données
 */
async function sendNewReservationNotification(userId, reservationData, db) {
  const notification = {
    title: '🏠 Nouvelle réservation',
    body: `${reservationData.propertyName} - ${reservationData.guestName || 'Nouveau voyageur'}`,
    data: {
      type: 'new_reservation',
      property_id: reservationData.propertyId || '',
      reservation_id: reservationData.reservationId || '',
      start_date: reservationData.startDate || '',
      end_date: reservationData.endDate || ''
    }
  };

  return await sendPushNotification(userId, notification, db);
}

/**
 * Envoie une notification pour un check-in du jour
 * @param {string} userId - ID de l'utilisateur propriétaire
 * @param {Object} checkInData - Données du check-in
 * @param {Object} db - Instance de la base de données
 */
async function sendCheckInNotification(userId, checkInData, db) {
  const notification = {
    title: '📅 Arrivée aujourd\'hui',
    body: `${checkInData.propertyName} - ${checkInData.guestName}`,
    data: {
      type: 'daily_arrivals',
      property_id: checkInData.propertyId || '',
      reservation_id: checkInData.reservationId || ''
    }
  };

  return await sendPushNotification(userId, notification, db);
}

/**
 * Envoie une notification pour un ménage à faire
 * @param {string} userId - ID de l'utilisateur propriétaire
 * @param {Object} cleaningData - Données du ménage
 * @param {Object} db - Instance de la base de données
 */
async function sendCleaningNotification(userId, cleaningData, db) {
  const notification = {
    title: '🧹 Ménage à planifier',
    body: `${cleaningData.propertyName} - ${cleaningData.date}`,
    data: {
      type: 'new_cleaning',
      property_id: cleaningData.propertyId || '',
      cleaning_id: cleaningData.cleaningId || '',
      date: cleaningData.date || ''
    }
  };

  return await sendPushNotification(userId, notification, db);
}

/**
 * Test de notification push
 * @param {string} userId - ID de l'utilisateur pour le test
 * @param {Object} db - Instance de la base de données
 */
async function sendTestPushNotification(userId, db) {
  const notification = {
    title: '🎉 Test de notification',
    body: 'Si vous voyez ce message, les notifications push fonctionnent !',
    data: {
      type: 'test',
      timestamp: new Date().toISOString()
    }
  };

  return await sendPushNotification(userId, notification, db);
}

module.exports = {
  sendPushNotification,
  sendNewMessageNotification,
  sendNewReservationNotification,
  sendCheckInNotification,
  sendCleaningNotification,
  sendTestPushNotification
};
