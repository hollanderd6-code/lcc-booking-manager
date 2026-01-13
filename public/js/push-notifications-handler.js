// ============================================
// 📱 GESTIONNAIRE DE NOTIFICATIONS PUSH - VERSION CORRIGÉE
// ============================================

console.log('🔔 [DEBUG] Fichier push-notifications-handler.js chargé');

const API_BASE = 'https://lcc-booking-manager.onrender.com';

// Fonction principale
async function initPushNotifications() {
  console.log('🔔 [DEBUG] initPushNotifications appelée');
  console.log('🔔 [DEBUG] typeof Capacitor:', typeof Capacitor);
  console.log('🔔 [DEBUG] window.Capacitor:', window.Capacitor);
  
  try {
    // Vérifier si Capacitor est disponible
    if (typeof Capacitor === 'undefined' && typeof window.Capacitor === 'undefined') {
      console.log('⚠️ [DEBUG] Capacitor non disponible');
      return;
    }

    const Cap = window.Capacitor || Capacitor;
    const platform = Cap.getPlatform();
    console.log('📱 [DEBUG] Platform:', platform);
    
    // Si on est sur le web, ne rien faire
    if (platform === 'web') {
      console.log('⚠️ [DEBUG] Sur web, pas de push notifications');
      return;
    }

    console.log('✅ [DEBUG] On est sur mobile:', platform);

    // Récupérer le plugin PushNotifications
    const { PushNotifications } = window.Capacitor.Plugins;
    
    if (!PushNotifications) {
      console.error('❌ [DEBUG] Plugin PushNotifications non trouvé');
      console.log('Plugins disponibles:', Object.keys(window.Capacitor.Plugins));
      return;
    }
    
    console.log('✅ [DEBUG] Plugin PushNotifications trouvé');

    // ============================================
    // LISTENERS D'ABORD (avant register)
    // ============================================
    
    console.log('📝 [DEBUG] Ajout des listeners...');
    
    // Listener pour le token
    PushNotifications.addListener('registration', async (token) => {
      console.log('✅ [DEBUG] Token reçu:', token.value);
      
      const deviceType = platform === 'ios' ? 'ios' : 'android';
      console.log('📱 [DEBUG] Device type:', deviceType);
      
      await saveTokenToServer(token.value, deviceType);
    });

    // Listener pour les erreurs
    PushNotifications.addListener('registrationError', (error) => {
      console.error('❌ [DEBUG] Erreur registration:', error);
    });

    // Listener notification reçue (foreground)
    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('📬 [DEBUG] Notification reçue:', notification);
      // Ne pas afficher d'alert en prod, juste logger
      console.log(`Notification: ${notification.title || ''}\n${notification.body || ''}`);
    });

    // Listener notification cliquée
    PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
      console.log('👆 [DEBUG] Notification cliquée:', notification);
    });

    console.log('✅ [DEBUG] Listeners ajoutés');

    // ============================================
    // DEMANDER LA PERMISSION
    // ============================================
    
    console.log('📝 [DEBUG] Vérification permission...');
    let permStatus = await PushNotifications.checkPermissions();
    console.log('📊 [DEBUG] Permission actuelle:', JSON.stringify(permStatus));

    if (permStatus.receive === 'prompt' || permStatus.receive === 'prompt-with-rationale') {
      console.log('📝 [DEBUG] Demande de permission...');
      permStatus = await PushNotifications.requestPermissions();
      console.log('📊 [DEBUG] Nouvelle permission:', JSON.stringify(permStatus));
    }

    if (permStatus.receive !== 'granted') {
      console.warn('⚠️ [DEBUG] Permission refusée:', permStatus.receive);
      return;
    }

    console.log('✅ [DEBUG] Permission accordée');

    // ============================================
    // ENREGISTRER
    // ============================================
    
    console.log('📝 [DEBUG] Appel PushNotifications.register()...');
    await PushNotifications.register();
    console.log('✅ [DEBUG] Register() appelé avec succès');

  } catch (error) {
    console.error('❌ [DEBUG] Erreur dans initPushNotifications:', error);
    console.error('❌ [DEBUG] Stack:', error.stack);
  }
}

// ============================================
// 🔧 FONCTION POUR RÉCUPÉRER LE JWT (comme fcm-registration-5.js)
// ============================================

async function findSupabaseKey() {
  try {
    const cap = window.Capacitor;
    if (!cap || !cap.Plugins || !cap.Plugins.Preferences) {
      console.error('❌ Capacitor Preferences non disponible');
      return null;
    }
    
    // Essayer différentes clés possibles
    const possibleKeys = [
      'sb-ztdzragdnjkastswtvzn-auth-token',
      'supabase.auth.token',
      '@supabase/auth-token',
      'sb-auth-token',
      'lcc_token'
    ];
    
    console.log('🔍 Recherche de la clé Supabase...');
    
    for (const key of possibleKeys) {
      const { value } = await cap.Plugins.Preferences.get({ key });
      if (value) {
        console.log(`✅ Clé trouvée: ${key}`);
        return { key, value };
      }
    }
    
    console.warn('⚠️ Aucune clé Supabase trouvée');
    return null;
  } catch (err) {
    console.error('❌ Erreur recherche clé:', err);
    return null;
  }
}

async function getSupabaseSession() {
  const found = await findSupabaseKey();
  if (!found) return null;
  
  try {
    // Si c'est lcc_token, c'est directement le JWT
    if (found.key === 'lcc_token') {
      console.log('✅ JWT direct trouvé');
      return found.value;
    }
    
    // Sinon, parser le JSON
    const session = JSON.parse(found.value);
    console.log('✅ Session Supabase parsée');
    
    // Essayer différents chemins pour le token
    const token = session.access_token || session.accessToken || session.token;
    if (token) {
      console.log('✅ JWT extrait de la session');
      return token;
    }
    
    console.warn('⚠️ Pas de token dans la session');
    return null;
  } catch (err) {
    console.error('❌ Erreur parsing session:', err);
    return null;
  }
}

// Fonction pour envoyer le token au serveur
async function saveTokenToServer(token, deviceType) {
  try {
    console.log('💾 [DEBUG] saveTokenToServer appelée');
    console.log('   Token:', token.substring(0, 30) + '...');
    console.log('   Device:', deviceType);
    
    // ✅ CORRECTION 1 : Récupérer le JWT via Preferences
    const authToken = await getSupabaseSession();
    console.log('   Auth token:', authToken ? 'Présent' : 'Absent');
    
    if (!authToken) {
      console.warn('⚠️ [DEBUG] Pas de token auth - impossible de sauvegarder');
      return;
    }

    // ✅ CORRECTION 2 : URL absolue
    console.log('📤 [DEBUG] Envoi au serveur...');
    const response = await fetch(`${API_BASE}/api/save-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        token: token,
        device_type: deviceType
      })
    });

    console.log('📊 [DEBUG] Response status:', response.status);
    const data = await response.json();
    console.log('📊 [DEBUG] Response data:', data);

    if (response.ok) {
      console.log('✅ [DEBUG] Token enregistré sur serveur');
    } else {
      console.error('❌ [DEBUG] Erreur serveur:', data);
    }

  } catch (error) {
    console.error('❌ [DEBUG] Erreur saveTokenToServer:', error);
  }
}

// Exposer globalement pour debug
window.initPushNotifications = initPushNotifications;
window.saveTokenToServer = saveTokenToServer;

// Initialisation automatique avec délai
console.log('⏰ [DEBUG] Programmation initialisation dans 3 secondes...');
setTimeout(() => {
  console.log('⏰ [DEBUG] Démarrage initialisation...');
  initPushNotifications();
}, 3000);

console.log('✅ [DEBUG] Fin du chargement du fichier');
