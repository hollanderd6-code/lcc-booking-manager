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
  try {
    const urlObj = new URL(url);
    const urlPropertyId = urlObj.searchParams.get('property');
    
    if (urlPropertyId) {
      console.log('✅ Property ID extrait du deep link:', urlPropertyId);
      
      // Sauvegarder le property_id
      localStorage.setItem('property_id', urlPropertyId);
      propertyId = urlPropertyId;
      
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
    }
  } catch (error) {
    console.error('❌ Erreur parsing deep link:', error);
  }
}

function updatePropertyIdStatus() {
  // Optionnel : afficher un indicateur que le property_id est bien reçu
  const storedPropertyId = localStorage.getItem('property_id');
  if (storedPropertyId) {
    console.log('✅ Property ID disponible:', storedPropertyId);
  }
}

// ============================================
// PIN SCREEN - AUTO-FOCUS & NAVIGATION
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  console.log('✅ DOM Ready');
  
  // Setup deep links FIRST
  await setupDeepLinks();
  
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
  
  // Back button
  document.getElementById('btnBack').addEventListener('click', logout);
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
  
  // Auto-focus first input
  document.getElementById('pin1').focus();
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
  
  console.log('🔌 Connexion socket...');
  
  socket = io(API_URL, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000
  });
  
  socket.on('connect', () => {
    console.log('✅ Socket connecté:', socket.id);
    socket.emit('join_conversation', conversationId);
  });
  
  socket.on('new_message', (message) => {
    console.log('📩 Nouveau message:', message);
    appendMessage(message);
    scrollToBottom();
  });
  
  socket.on('disconnect', () => {
    console.log('🔌 Socket déconnecté');
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

function appendMessage(message) {
  const container = document.getElementById('messagesContainer');
  
  // Remove loading if present
  const loading = container.querySelector('.loading');
  if (loading) loading.remove();
  
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${message.sender_type}`;
  
  const time = new Date(message.created_at).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit'
  });
  
  messageDiv.innerHTML = `
    <div class="message-content">
      <div class="message-bubble">${escapeHtml(message.message)}</div>
      <div class="message-time">${time}</div>
    </div>
  `;
  
  container.appendChild(messageDiv);
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

// ============================================
// NOTIFICATIONS (pour plus tard)
// ============================================

// TODO: Setup Firebase notifications
// Cette partie sera ajoutée après les tests de base
