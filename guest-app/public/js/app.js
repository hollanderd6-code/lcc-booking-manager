// ============================================
// CONFIGURATION
// ============================================

const IS_NATIVE = window.Capacitor?.isNativePlatform?.() || false;
const API_URL = IS_NATIVE 
  ? 'https://lcc-booking-manager.onrender.com'
  : window.location.origin;

console.log('🚀 Guest App - Mode:', IS_NATIVE ? 'NATIVE' : 'WEB', 'API:', API_URL);

// State
let socket = null;
let conversationId = null;
let propertyId = null;
let propertyName = null;

// ============================================
// DEEP LINKS HANDLING
// ============================================

async function setupDeepLinks() {
  if (!IS_NATIVE) {
    // Mode web : récupérer depuis l'URL
    const urlParams = new URLSearchParams(window.location.search);
    const urlPropertyId = urlParams.get('property');
    if (urlPropertyId) {
      console.log('🔗 Property ID from URL:', urlPropertyId);
      localStorage.setItem('property_id', urlPropertyId);
      propertyId = urlPropertyId;
    }
    return;
  }

  // Mode natif : utiliser Capacitor App plugin
  const CapApp = window.Capacitor?.Plugins?.App;
  
  if (!CapApp) {
    console.log('⚠️ Capacitor App plugin non disponible');
    return;
  }

  // Écouter les deep links quand l'app est ouverte
  CapApp.addListener('appUrlOpen', (event) => {
    console.log('🔗 Deep link reçu:', event.url);
    handleDeepLink(event.url);
  });

  // Vérifier si l'app a été lancée via un deep link
  try {
    const launchUrl = await CapApp.getLaunchUrl();
    if (launchUrl?.url) {
      console.log('🚀 App lancée via deep link:', launchUrl.url);
      handleDeepLink(launchUrl.url);
    }
  } catch (error) {
    console.log('⚠️ Erreur getLaunchUrl:', error);
  }
  
  console.log('✅ Deep links configurés');
}

function handleDeepLink(url) {
  console.log('🔗 ===== HANDLE DEEP LINK =====');
  console.log('🔗 URL reçue:', url);
  
  try {
    const urlObj = new URL(url);
    console.log('🔗 URL parsée:', urlObj.href);
    console.log('🔗 Search params:', urlObj.search);
    
    const urlPropertyId = urlObj.searchParams.get('property');
    console.log('🔗 Property ID extrait:', urlPropertyId);
    
    if (urlPropertyId) {
      console.log('✅ Property ID extrait du deep link:', urlPropertyId);
      
      // Sauvegarder le property_id
      localStorage.setItem('property_id', urlPropertyId);
      propertyId = urlPropertyId;
      
      console.log('✅ Property ID sauvegardé dans localStorage');
      console.log('✅ localStorage.getItem("property_id"):', localStorage.getItem('property_id'));
      
      // Si on est déjà vérifié pour une AUTRE propriété, déconnecter
      const savedPropertyId = localStorage.getItem('guest_property_id');
      if (savedPropertyId && savedPropertyId !== urlPropertyId) {
        console.log('🔄 Nouvelle propriété détectée, reset session');
        localStorage.removeItem('guest_conversation_id');
        localStorage.removeItem('guest_property_id');
        localStorage.removeItem('guest_property_name');
        localStorage.removeItem('guest_verified');
      }
      
      // Cacher l'erreur "ID manquant" si elle était affichée
      const errorBox = document.getElementById('errorMessage');
      if (errorBox) {
        errorBox.style.display = 'none';
      }
      
      // Mettre à jour l'affichage si on est sur l'écran PIN
      updatePropertyIdStatus();
    } else {
      console.log('❌ Aucun property ID trouvé dans l\'URL');
    }
  } catch (error) {
    console.error('❌ Erreur parsing deep link:', error);
  }
  
  console.log('🔗 ===== FIN HANDLE DEEP LINK =====');
}

function updatePropertyIdStatus() {
  const storedPropertyId = localStorage.getItem('property_id');
  if (storedPropertyId) {
    console.log('✅ Property ID disponible:', storedPropertyId);
  }
}

// ============================================
// NOTIFICATIONS PUSH (Firebase)
// ============================================
async function setupPushNotifications() {
  console.log('🔔 [DEBUG] setupPushNotifications appelé');
  
  if (!IS_NATIVE) {
    console.log('⚠️ Push notifications uniquement en mode natif');
    return;
  }

  try {
    const { FirebaseMessaging } = window.Capacitor.Plugins;
    
    if (!FirebaseMessaging) {
      console.log('⚠️ FirebaseMessaging plugin non disponible');
      return;
    }

    // Demander la permission
    await FirebaseMessaging.requestPermissions();
    console.log('✅ Permission notifications accordée');

    // Obtenir le token
    const result = await FirebaseMessaging.getToken();
    if (result?.token) {
      console.log('🔥🔥🔥 FCM TOKEN:', result.token);
      
      // Sauvegarder le token
      localStorage.setItem('guest_fcm_token', result.token);
      
      // Envoyer au serveur si on a une conversation
      if (conversationId) {
        await registerFcmToken(result.token);
      }
    }

    // Écouter les nouveaux tokens
    FirebaseMessaging.addListener('tokenReceived', async (event) => {
      console.log('🔥🔥🔥 NOUVEAU TOKEN FCM:', event.token);
      localStorage.setItem('guest_fcm_token', event.token);
      
      if (conversationId) {
        await registerFcmToken(event.token);
      }
    });

    // Écouter les notifications
    FirebaseMessaging.addListener('notificationReceived', (event) => {
      console.log('📩 Notification reçue:', event);
      
      if (document.getElementById('chatScreen').classList.contains('active')) {
        loadMessages();
      }
    });

    FirebaseMessaging.addListener('notificationActionPerformed', (event) => {
      console.log('👆 Action notification:', event);
      
      if (event.notification?.data?.conversation_id === conversationId) {
        showChatScreen();
        loadMessages();
      }
    });

  } catch (error) {
    console.error('❌ Erreur setup push notifications:', error);
  }
}

async function registerFcmToken(token) {
  try {
    const response = await fetch(`${API_URL}/api/chat/register-guest-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: conversationId,
        fcm_token: token,
        device_type: 'ios' // ou 'android' selon la plateforme
      })
    });
    
    if (response.ok) {
      console.log('✅ Token FCM enregistré sur le serveur');
    }
  } catch (error) {
    console.error('❌ Erreur enregistrement token:', error);
  }
}

// ============================================
// PIN SCREEN - AUTO-FOCUS & NAVIGATION
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  console.log('✅ DOM Ready');
  
  // Setup deep links FIRST
  await setupDeepLinks();
  
  // 🔍 DEBUG : Afficher le property_id détecté
  const storedPropertyId = localStorage.getItem('property_id');
  console.log('🔍 Property ID au démarrage:', storedPropertyId);
  
  if (storedPropertyId) {
    console.log('✅ Property ID disponible:', storedPropertyId);
  } else {
    console.log('❌ Aucun Property ID trouvé');
  }
  
  // Setup push notifications
  await setupPushNotifications();
  
  // Setup PIN inputs
  setupPinInputs();
  
  // Check if already verified
  checkExistingSession();
  
  // Setup form
  document.getElementById('pinForm').addEventListener('submit', handleVerification);
  
  // Setup chat
  document.getElementById('sendBtn').addEventListener('click', sendMessage);
  document.getElementById('messageInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  
  // Setup photo button
  document.getElementById('photoBtn')?.addEventListener('click', openPhotoPicker);
  
  // Back button
  document.getElementById('btnBack').addEventListener('click', logout);
  
  // Recharger les messages quand l'app revient au premier plan
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && conversationId) {
      console.log('📱 App au premier plan, rechargement messages...');
      loadMessages();
    }
  });
});

function setupPinInputs() {
  const pins = ['pin1', 'pin2', 'pin3', 'pin4'];
  
  pins.forEach((id, index) => {
    const input = document.getElementById(id);
    
    input.addEventListener('input', (e) => {
      const value = e.target.value;
      
      // Only allow digits
      if (!/^\d*$/.test(value)) {
        e.target.value = '';
        return;
      }
      
      // Move to next input
      if (value && index < 3) {
        document.getElementById(pins[index + 1]).focus();
      }
    });
    
    input.addEventListener('keydown', (e) => {
      // Backspace: move to previous input
      if (e.key === 'Backspace' && !e.target.value && index > 0) {
        document.getElementById(pins[index - 1]).focus();
      }
    });
  });
  
  // Auto-focus désactivé pour ne pas cacher le header avec le clavier
  // L'utilisateur peut taper manuellement sur le premier champ
}

// ============================================
// PHOTO PICKER
// ============================================

function openPhotoPicker() {
  // Créer un input file invisible
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.style.display = 'none';
  
  input.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      await uploadPhotos(files);
    }
    input.remove();
  });
  
  document.body.appendChild(input);
  input.click();
}

async function uploadPhotos(files) {
  console.log('📷 uploadPhotos appelé avec', files.length, 'fichiers');
  
  const sendBtn = document.getElementById('sendBtn');
  const photoBtn = document.getElementById('photoBtn');
  
  sendBtn.disabled = true;
  photoBtn.disabled = true;
  
  try {
    for (const file of files) {
      console.log('📷 Traitement fichier:', file.name, 'Type:', file.type, 'Taille:', file.size);
      
      // Vérifier que c'est une image
      if (!file.type.startsWith('image/')) {
        throw new Error('Le fichier doit être une image');
      }
      
      // Vérifier la taille (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        throw new Error('Image trop volumineuse (max 5MB)');
      }
      
      // Afficher un message temporaire
      const tempId = Date.now();
      appendTempMessage(tempId, '📷 Upload de la photo...');
      
      console.log('📤 Upload vers Cloudinary...');
      
      // Upload vers Cloudinary
      const formData = new FormData();
      formData.append('file', file);
      formData.append('upload_preset', 'chat-photos');
      
      const cloudinaryResponse = await fetch('https://api.cloudinary.com/v1_1/dvn95fhbx/image/upload', {
        method: 'POST',
        body: formData
      });
      
      if (!cloudinaryResponse.ok) {
        throw new Error('Erreur upload Cloudinary');
      }
      
      const cloudinaryData = await cloudinaryResponse.json();
      const imageUrl = cloudinaryData.secure_url;
      
      console.log('✅ Photo uploadée sur Cloudinary:', imageUrl);
      
      // Envoyer le message avec le tag [IMAGE:url]
      const messageWithImage = `[IMAGE:${imageUrl}]`;
      
      const response = await fetch(`${API_URL}/api/chat/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: conversationId,
          sender_type: 'guest',
          sender_name: 'Guest',
          message: messageWithImage
        })
      });
      
      // Supprimer le message temporaire
      removeTempMessage(tempId);
      
      if (!response.ok) {
        const data = await response.json();
        console.error('❌ Réponse serveur erreur:', data);
        throw new Error(data.error || 'Erreur envoi photo');
      }
      
      console.log('✅ Photo envoyée avec succès');
      
      // Haptic feedback
      if (window.Capacitor?.Plugins?.Haptics) {
        window.Capacitor.Plugins.Haptics.notification({ type: 'success' });
      }
    }
    
  } catch (error) {
    console.error('❌ Erreur upload photo:', error);
    alert('Erreur lors de l\'envoi de la photo: ' + error.message);
  } finally {
    sendBtn.disabled = false;
    photoBtn.disabled = false;
  }
}

function appendTempMessage(id, text) {
  const container = document.getElementById('messagesContainer');
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message guest temp-message';
  messageDiv.id = `temp-${id}`;
  messageDiv.innerHTML = `
    <div class="message-content">
      <div class="message-bubble" style="opacity: 0.7;">
        <i class="fas fa-spinner fa-spin"></i> ${text}
      </div>
    </div>
  `;
  container.appendChild(messageDiv);
  scrollToBottom();
}

function removeTempMessage(id) {
  const temp = document.getElementById(`temp-${id}`);
  if (temp) temp.remove();
}

// ============================================
// VERIFICATION
// ============================================

async function handleVerification(e) {
  e.preventDefault();
  
  const pin1 = document.getElementById('pin1').value;
  const pin2 = document.getElementById('pin2').value;
  const pin3 = document.getElementById('pin3').value;
  const pin4 = document.getElementById('pin4').value;
  const pinCode = pin1 + pin2 + pin3 + pin4;
  
  const checkinDate = document.getElementById('checkinDate').value;
  const checkoutDate = document.getElementById('checkoutDate').value;
  const platform = document.getElementById('platform').value;
  
  // Validation
  if (pinCode.length !== 4 || !/^\d{4}$/.test(pinCode)) {
    showError('Le code PIN doit être composé de 4 chiffres');
    return;
  }
  
  if (!checkinDate || !platform) {
    showError('Veuillez remplir tous les champs obligatoires');
    return;
  }
  
  // Get property ID - d'abord localStorage (deep link), sinon URL
  propertyId = localStorage.getItem('property_id');
  
  if (!propertyId) {
    // Fallback sur l'URL (mode web)
    const urlParams = new URLSearchParams(window.location.search);
    propertyId = urlParams.get('property');
  }
  
  if (!propertyId) {
    showError('Lien invalide - ID de propriété manquant. Veuillez utiliser le lien fourni par votre hôte.');
    return;
  }
  
  const verifyBtn = document.getElementById('verifyBtn');
  verifyBtn.disabled = true;
  verifyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Vérification...';
  
  try {
    const response = await fetch(`${API_URL}/api/chat/verify-by-property`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        property_id: propertyId,
        chat_pin: pinCode,
        checkin_date: checkinDate,
        checkout_date: checkoutDate || null,
        platform: platform
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      showError(data.error || 'Erreur de vérification');
      verifyBtn.disabled = false;
      verifyBtn.innerHTML = '<i class="fas fa-check"></i> Vérifier et accéder au chat';
      return;
    }
    
    // ✅ Success
    console.log('✅ Vérification réussie:', data);
    
    conversationId = data.conversation_id;
    propertyName = data.property_name;
    
    // Save to localStorage (persists across app restarts)
    localStorage.setItem('guest_conversation_id', conversationId);
    localStorage.setItem('guest_property_id', propertyId);
    localStorage.setItem('guest_property_name', propertyName);
    localStorage.setItem('guest_verified', 'true');
    
    // Enregistrer le token FCM si disponible
    const fcmToken = localStorage.getItem('guest_fcm_token');
    if (fcmToken) {
      await registerFcmToken(fcmToken);
    }
    
    // Show chat
    showChatScreen();
    
  } catch (error) {
    console.error('❌ Erreur:', error);
    showError('Erreur de connexion au serveur');
    verifyBtn.disabled = false;
    verifyBtn.innerHTML = '<i class="fas fa-check"></i> Vérifier et accéder au chat';
  }
}

function showError(message) {
  const errorBox = document.getElementById('errorMessage');
  const errorText = document.getElementById('errorText');
  errorText.textContent = message;
  errorBox.style.display = 'flex';
  
  // Haptic feedback if available
  if (window.Capacitor?.Plugins?.Haptics) {
    window.Capacitor.Plugins.Haptics.notification({ type: 'error' });
  }
  
  setTimeout(() => {
    errorBox.style.display = 'none';
  }, 5000);
}

// ============================================
// SESSION MANAGEMENT
// ============================================

function checkExistingSession() {
  const verified = localStorage.getItem('guest_verified');
  
  if (verified === 'true') {
    conversationId = localStorage.getItem('guest_conversation_id');
    propertyId = localStorage.getItem('guest_property_id');
    propertyName = localStorage.getItem('guest_property_name');
    
    if (conversationId && propertyId) {
      console.log('✅ Session existante trouvée');
      showChatScreen();
    }
  }
}

function logout() {
  if (confirm('Voulez-vous vous déconnecter du chat ?')) {
    localStorage.removeItem('guest_conversation_id');
    localStorage.removeItem('guest_property_id');
    localStorage.removeItem('guest_property_name');
    localStorage.removeItem('guest_verified');
    localStorage.removeItem('property_id');
    
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    
    // Show PIN screen
    document.getElementById('chatScreen').classList.remove('active');
    document.getElementById('pinScreen').classList.add('active');
    
    // Reset form
    document.getElementById('pinForm').reset();
    document.getElementById('pin1').focus();
  }
}

// ============================================
// CHAT SCREEN
// ============================================

function showChatScreen() {
  document.getElementById('pinScreen').classList.remove('active');
  document.getElementById('chatScreen').classList.add('active');
  
  // Update header
  document.getElementById('propertyName').textContent = propertyName || 'Chat';
  
  // Initialize chat
  initializeChat();
}

async function initializeChat() {
  console.log('💬 Initialisation chat...');
  
  // Connect socket
  connectSocket();
  
  // Load messages
  await loadMessages();
}

// ============================================
// SOCKET.IO
// ============================================

function connectSocket() {
  if (socket?.connected) {
    console.log('✅ Socket déjà connecté');
    return;
  }
  
  // Déconnecter l'ancien socket si existant
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  
  console.log('🔌 Connexion socket...', API_URL);
  
  socket = io(API_URL, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity, // Réessayer indéfiniment
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
    forceNew: true
  });
  
  socket.on('connect', () => {
    console.log('✅ Socket connecté:', socket.id);
    socket.emit('join_conversation', conversationId);
  });
  
  socket.on('new_message', (message) => {
    console.log('📩 Nouveau message reçu via socket:', message);
    
    // Vérifier si le message n'est pas déjà affiché
    const container = document.getElementById('messagesContainer');
    const existingMsg = container.querySelector(`[data-message-id="${message.id}"]`);
    if (!existingMsg) {
      appendMessage(message);
      scrollToBottom();
    }
    
    // Vibration si message du propriétaire
    if (message.sender_type !== 'guest' && window.Capacitor?.Plugins?.Haptics) {
      window.Capacitor.Plugins.Haptics.notification({ type: 'success' });
    }
  });
  
  socket.on('disconnect', (reason) => {
    console.log('🔌 Socket déconnecté, raison:', reason);
    
    // Reconnecter automatiquement si déconnexion non voulue
    if (reason === 'io server disconnect') {
      // Le serveur a forcé la déconnexion, reconnecter
      socket.connect();
    }
  });
  
  socket.on('connect_error', (error) => {
    console.error('❌ Erreur connexion socket:', error.message);
  });
  
  socket.on('reconnect', (attemptNumber) => {
    console.log('🔄 Reconnecté après', attemptNumber, 'tentatives');
    socket.emit('join_conversation', conversationId);
    // Recharger les messages après reconnexion
    loadMessages();
  });
  
  socket.on('error', (error) => {
    console.error('❌ Socket error:', error);
  });
}

// ============================================
// MESSAGES
// ============================================

async function loadMessages() {
  const container = document.getElementById('messagesContainer');
  container.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i><br>Chargement des messages...</div>';
  
  try {
    const response = await fetch(`${API_URL}/api/chat/messages/${conversationId}`);
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Erreur chargement messages');
    }
    
    container.innerHTML = '';
    
    if (data.messages && data.messages.length > 0) {
      data.messages.forEach(msg => appendMessage(msg));
    } else {
      container.innerHTML = '<div class="loading">Aucun message pour le moment</div>';
    }
    
    scrollToBottom();
    
  } catch (error) {
    console.error('❌ Erreur chargement messages:', error);
    container.innerHTML = '<div class="loading">Erreur de chargement</div>';
  }
}

function linkifyMessage(text) {
  if (!text) return '';
  var div = document.createElement('div');
  div.textContent = text;
  var escaped = div.innerHTML;
  // Convert line breaks
  escaped = escaped.replace(/\n/g, '<br>');
  // Linkify URLs
  var urlRegex = /(https?:\/\/[^\s<]+)/g;
  return escaped.replace(urlRegex, function(url) {
    var cleanUrl = url.replace(/[.,;:!?)<]+$/, '');
    var rawUrl = cleanUrl.replace(/&amp;/g, '&');
    if (rawUrl.includes('checkout.stripe.com') || rawUrl.includes('caution')) {
      return '<a href="' + rawUrl + '" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin:6px 0;padding:10px 18px;background:#7c3aed;color:white;text-decoration:none;border-radius:10px;font-weight:600;font-size:14px;">Autoriser la caution</a>';
    }
    var display = cleanUrl.length > 45 ? cleanUrl.substring(0, 42) + '...' : cleanUrl;
    return '<a href="' + rawUrl + '" target="_blank" rel="noopener noreferrer" style="color:#2563EB;text-decoration:underline;word-break:break-all;font-weight:500;">' + display + '</a>';
  });
}

function appendMessage(message) {
  const container = document.getElementById('messagesContainer');
  
  // Éviter les doublons
  if (message.id && container.querySelector(`[data-message-id="${message.id}"]`)) {
    console.log('⚠️ Message déjà affiché:', message.id);
    return;
  }
  
  // Remove loading if present
  const loading = container.querySelector('.loading');
  if (loading) loading.remove();
  
  const isGuest = message.sender_type === 'guest';
  
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${message.sender_type}`;
  if (message.id) {
    messageDiv.setAttribute('data-message-id', message.id);
  }
  
  const time = new Date(message.created_at).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit'
  });
  
  // Parser le message pour extraire les images
  const imageRegex = /\[IMAGE:(https?:\/\/[^\]]+)\]/g;
  let messageText = message.message || '';
  const images = [];
  
  let match;
  while ((match = imageRegex.exec(messageText)) !== null) {
    images.push(match[1]);
  }
  
  // Enlever les tags [IMAGE:...] du texte
  messageText = messageText.replace(imageRegex, '').trim();
  
  // Construire le contenu
  let content = '';
  
  // Ajouter le texte s'il y en a
  if (messageText) {
    content += linkifyMessage(messageText);
  }
  
  // Ajouter les images
  images.forEach(imageUrl => {
    content += `<img src="${imageUrl}" class="message-photo" onclick="openFullImage('${imageUrl}')" alt="Photo">`;
  });
  
  // Si toujours vide, ne rien afficher
  if (!content) {
    content = '<i>Photo</i>';
  }
  
  // Bouton traduction — uniquement sur les messages du proprio (pas les siens)
  const guestLangDetected = detectBrowserLang();
  const flagMap = { fr:'🇫🇷', en:'🇬🇧', de:'🇩🇪', it:'🇮🇹', nl:'🇳🇱', zh:'🇨🇳', es:'🇪🇸', pt:'🇵🇹' };
  const destFlag = flagMap[guestLangDetected] || '🌐';
  const txHtml = (!isGuest && messageText) ? `
    <div class="tx-bar">
      <button class="tx-chip" data-original="${messageText.replace(/"/g, '&quot;')}" data-translated="" data-state="original" data-destflag="${destFlag}">
        <span class="tx-flags">🇫🇷→${destFlag}</span><span class="tx-label">Traduire</span>
      </button>
    </div>` : '';
  
  messageDiv.innerHTML = `
    <div class="message-content">
      <div class="message-bubble">${content}</div>
      <div class="message-time">${time}</div>
      ${txHtml}
    </div>
  `;
  
  // Attacher l'event au bouton si présent
  const txBtn = messageDiv.querySelector('.tx-chip');
  if (txBtn) {
    const bubble = messageDiv.querySelector('.message-bubble');
    txBtn.addEventListener('click', async function() {
      const state = txBtn.getAttribute('data-state');
      const original = txBtn.getAttribute('data-original');
      
      if (state === 'translated') {
        bubble.innerHTML = linkifyMessage(original);
        const df = txBtn.getAttribute('data-destflag') || '🌐';
        txBtn.innerHTML = `<span class="tx-flags">🇫🇷→${df}</span><span class="tx-label">Traduire</span>`;
        txBtn.setAttribute('data-state', 'original');
        txBtn.classList.remove('translated');
        return;
      }
      
      const cached = txBtn.getAttribute('data-translated');
      if (cached) {
        bubble.textContent = cached;
        const df2 = txBtn.getAttribute('data-destflag') || '🌐';
        txBtn.innerHTML = `<span class="tx-flags">${df2}→🇫🇷</span><span class="tx-label">Original</span>`;
        txBtn.setAttribute('data-state', 'translated');
        txBtn.classList.add('translated');
        return;
      }
      
      txBtn.innerHTML = '<span class="tx-flags">⏳</span><span class="tx-label">...</span>';
      txBtn.setAttribute('data-state', 'loading');
      txBtn.disabled = true;
      
      try {
        const guestLang = localStorage.getItem('guest_lang') || detectBrowserLang();
        const translated = await guestChatTranslate(original, guestLang);
        txBtn.setAttribute('data-translated', translated);
        bubble.textContent = translated;
        txBtn.innerHTML = '↩ Original';
        txBtn.setAttribute('data-state', 'translated');
      } catch(e) {
        const df4 = txBtn.getAttribute('data-destflag') || '🌐'; txBtn.innerHTML = `<span class="tx-flags">🇫🇷→${df4}</span><span class="tx-label">Traduire</span>`;
        txBtn.setAttribute('data-state', 'original');
      }
      txBtn.disabled = false;
    });
  }
  
  container.appendChild(messageDiv);
}

// ── Traduction côté voyageur ─────────────────────────────────────────────
const _guestTxCache = {};
async function guestChatTranslate(text, targetLang) {
  // Détecter la langue source (fr par défaut — les hôtes écrivent en fr)
  const langMap = { fr: 'fr|fr', en: 'fr|en-GB', de: 'fr|de-DE', it: 'fr|it-IT', nl: 'fr|nl-NL', zh: 'fr|zh-CN', es: 'fr|es-ES', pt: 'fr|pt-PT' };
  const langpair = langMap[targetLang] || 'fr|en-GB';
  const key = langpair + '|' + text.slice(0, 60);
  if (_guestTxCache[key]) return _guestTxCache[key];
  
  if (text.length <= 450) {
    const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langpair}`);
    const d = await r.json();
    if (d.responseStatus === 200) { _guestTxCache[key] = d.responseData.translatedText; return _guestTxCache[key]; }
    throw new Error('failed');
  }
  
  const sentences = text.match(/[^.!?]+[.!?]*/g) || [text];
  const parts = [];
  for (const s of sentences) {
    const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(s.trim())}&langpair=${langpair}`);
    const d = await r.json();
    parts.push(d.responseStatus === 200 ? d.responseData.translatedText : s);
  }
  _guestTxCache[key] = parts.join(' ');
  return _guestTxCache[key];
}

function detectBrowserLang() {
  const l = (navigator.language || 'fr').split('-')[0].toLowerCase();
  return ['fr','en','de','it','nl','zh','es','pt'].includes(l) ? l : 'en';
}

function openFullImage(url) {
  // Ouvrir l'image en plein écran
  const overlay = document.createElement('div');
  overlay.className = 'image-overlay';
  overlay.innerHTML = `
    <img src="${url}" alt="Photo">
    <button class="close-overlay"><i class="fas fa-times"></i></button>
  `;
  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
}

async function sendMessage() {
  const input = document.getElementById('messageInput');
  const message = input.value.trim();
  
  if (!message) return;
  
  const sendBtn = document.getElementById('sendBtn');
  sendBtn.disabled = true;
  
  try {
    const response = await fetch(`${API_URL}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: conversationId,
        message: message,
        sender_type: 'guest'
      })
    });
    
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Erreur envoi message');
    }
    
    input.value = '';
    input.style.height = 'auto';
    
    // Haptic feedback
    if (window.Capacitor?.Plugins?.Haptics) {
      window.Capacitor.Plugins.Haptics.impact({ style: 'light' });
    }
    
  } catch (error) {
    console.error('❌ Erreur envoi:', error);
    alert('Erreur lors de l\'envoi du message');
  } finally {
    sendBtn.disabled = false;
  }
}

// ============================================
// UTILS
// ============================================

function scrollToBottom() {
  const container = document.getElementById('messagesContainer');
  setTimeout(() => {
    container.scrollTop = container.scrollHeight;
  }, 100);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
