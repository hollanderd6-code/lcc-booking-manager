// ============================================
// CONFIGURATION & STATE
// ============================================
// Détection du mode natif (Capacitor)
const IS_NATIVE = window.Capacitor?.isNativePlatform() || false;
const API_URL = IS_NATIVE 
  ? 'https://lcc-booking-manager.onrender.com'
  : window.location.origin;

console.log('🔌 [SOCKET] API_URL:', API_URL, '(Native:', IS_NATIVE + ')');

let socket = null;
let allConversations = [];
let currentConversationId = null;
let userId = null;

// ============================================
// INIT
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
  console.log('💬 Chat Propriétaire - Initialisation...');
  
  // Récupérer le userId
  const rawUser = localStorage.getItem('lcc_user');
  if (rawUser) {
    try {
      const user = JSON.parse(rawUser);
      userId = user.id;
    } catch (e) {
      console.error('Erreur lecture user:', e);
    }
  }
  
  // Charger les propriétés pour le filtre
  await loadProperties();
  
  // Charger les conversations
  await loadConversations();
  
  // Connecter Socket.IO
  connectSocket();
  
  // Event listeners
  document.getElementById('filterStatus').addEventListener('change', loadConversations);
  document.getElementById('filterProperty').addEventListener('change', loadConversations);
  
  // Auto-resize textarea
  const chatInput = document.getElementById('chatInput');
  chatInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });
  
  // Send on Enter
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessageOwner();
    }
  });
  
  console.log('✅ Chat initialisé');
});

// ============================================
// CHARGEMENT DES PROPRIÉTÉS
// ============================================
async function loadProperties() {
  try {
    const token = localStorage.getItem('lcc_token');
    console.log("📤 [CHAT] Fetching properties:", "/api/properties");
    const response = await fetch(`/api/properties`, {
      headers: {
        'Authorization': 'Bearer ' + token
      }
    });
    
 // ⚡ Vérifier content-type
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      console.error('❌ Conversations non-JSON');
      throw new Error('Réponse invalide');
    }    if (!response.ok) return;
    
    // ⚡ Vérifier content-type
    if (!contentType.includes('application/json')) {
      console.warn('⚠️ Properties non-JSON');
      return;
    }
    const data = await response.json();
    const select = document.getElementById('filterProperty');
    
    data.properties.forEach(property => {
      const option = document.createElement('option');
      option.value = property.id;
      option.textContent = property.name;
      select.appendChild(option);
    });
    
  } catch (error) {
    console.error('❌ Erreur chargement propriétés:', error);
  }
}

// ============================================
// CHARGEMENT DES CONVERSATIONS
// ============================================
async function loadConversations() {
  showLoading();
  
  try {
    const token = localStorage.getItem('lcc_token');
    const status = document.getElementById('filterStatus').value;
    const propertyId = document.getElementById('filterProperty').value;
    
    let url = `/api/chat/conversations?`;
    if (status) url += `status=${status}&`;
    if (propertyId) url += `property_id=${propertyId}&`;
    
    console.log("📤 [CHAT] Fetching conversations:", url);
    
    const response = await fetch(url, {
      headers: {
        'Authorization': 'Bearer ' + token
      }
    });
    
    if (!response.ok) {
      throw new Error('Erreur chargement conversations');
    }
    
    const data = await response.json();
    allConversations = data.conversations || [];
    
    console.log(`📦 ${allConversations.length} conversation(s) chargée(s)`);
    
    // Mettre à jour les stats
    updateStats();
    
    // Afficher les conversations
    renderConversations();
    
  } catch (error) {
    console.error('❌ Erreur:', error);
    showToast('Erreur de chargement', 'error');
  } finally {
    hideLoading();
  }
}

// ============================================
// MISE À JOUR DES STATS
// ============================================
function updateStats() {
  const total = allConversations.length;
  const unread = allConversations.reduce((sum, conv) => sum + (parseInt(conv.unread_count) || 0), 0);
  const active = allConversations.filter(conv => conv.status === 'active').length;
  
  // Mettre à jour les statistiques de la page
  const statTotal = document.getElementById('statTotal');
  const statUnread = document.getElementById('statUnread');
  const statActive = document.getElementById('statActive');
  
  if (statTotal) statTotal.textContent = total;
  if (statUnread) statUnread.textContent = unread;
  if (statActive) statActive.textContent = active;
  
  // Mettre à jour le badge rouge dans la sidebar (géré par messages-badge-dynamic.js)
  // On ne touche plus à ce badge ici, il est géré automatiquement
  
  // LEGACY: Support de l'ancien badge vert (si encore présent)
  const oldBadge = document.getElementById('unreadCount');
  if (oldBadge) {
    oldBadge.textContent = unread || '';
  }
}

// ============================================
// AFFICHAGE DES CONVERSATIONS
// ============================================
function renderConversations() {
  const container = document.getElementById('conversationsList');
  
  if (allConversations.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-comments"></i>
        <h3>Aucune conversation</h3>
        <p>Les conversations avec vos voyageurs apparaîtront ici.</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = allConversations.map(conv => {
    const unreadCount = parseInt(conv.unread_count) || 0;
    const statusClass = conv.status;
    const statusLabel = {
      'active': 'Active',
      'pending': 'En attente',
      'closed': 'Fermée'
    }[conv.status] || conv.status;
    
    const guestInitial = (conv.guest_name || 'V').charAt(0).toUpperCase();
    const checkinDate = new Date(conv.reservation_start_date).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'short'
    });
    
    const lastMessageTime = conv.last_message_time 
      ? formatTime(conv.last_message_time)
      : formatTime(conv.created_at);
    
    return `
      <div class="conversation-item" data-conversation-id="${conv.id}" onclick="openChat(${conv.id})">
        <div class="conversation-avatar" style="background: ${conv.property_color || '#10B981'};">
          ${guestInitial}
        </div>
        
        <div class="conversation-content">
          <div class="conversation-header">
            <div class="conversation-info">
              <h3>${conv.guest_name || 'Voyageur'}</h3>
              <div class="meta">
                <span class="property-badge" style="background: ${conv.property_color || '#10B981'}20; color: ${conv.property_color || '#10B981'};">
                  ${conv.property_name || 'Logement'}
                </span>
                <span><i class="fas fa-calendar"></i> ${checkinDate}</span>
                <span><i class="fas fa-tag"></i> ${conv.platform || 'direct'}</span>
              </div>
            </div>
            
            <div class="conversation-status">
              <!-- ✅ NOUVEAU : Bouton de suppression -->
              <div class="conversation-actions">
                <button class="btn-delete-conversation" 
                        onclick="deleteConversation(${conv.id}, event)" 
                        title="Supprimer la conversation">
                  <i class="fas fa-trash"></i>
                  Supprimer
                </button>
              </div>
              
              <div class="conversation-time">${lastMessageTime}</div>
              <div class="status-badge ${statusClass}">${statusLabel}</div>
              ${unreadCount > 0 ? `<div class="unread-badge">${unreadCount}</div>` : ''}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ============================================
// OUVRIR UNE CONVERSATION
// ============================================
async function openChat(conversationId) {
  currentConversationId = conversationId;
  const conv = allConversations.find(c => c.id === conversationId);
  
  if (!conv) return;
  
  // Mettre à jour le titre
  document.getElementById('chatModalTitle').textContent = `${conv.guest_name || 'Voyageur'} — ${conv.property_name || 'Logement'}`;
  
  // Afficher le modal
  document.getElementById('chatModal').classList.add('active');
  
  // Charger les messages
  await loadMessages(conversationId);
  
  // ✅ NOUVEAU : Marquer les messages comme lus
  await markMessagesAsRead(conversationId);
  
  // Rejoindre la room Socket.IO
  if (socket) {
    socket.emit('join_conversation', conversationId);
  }
}

// ============================================
// MARQUER LES MESSAGES COMME LUS
// ============================================
async function markMessagesAsRead(conversationId) {
  try {
    const token = localStorage.getItem('lcc_token');
    const response = await fetch(`/api/chat/conversations/${conversationId}/mark-read`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      // Mettre à jour localement le compteur de non lus
      const conv = allConversations.find(c => c.id === conversationId);
      if (conv) {
        conv.unread_count = 0;
      }
      
      // Mettre à jour le badge visuel de cette conversation
      const convElement = document.querySelector(`[data-conversation-id="${conversationId}"]`);
      if (convElement) {
        const unreadBadge = convElement.querySelector('.unread-badge');
        if (unreadBadge) {
          unreadBadge.remove();
        }
      }
      
      // Mettre à jour les stats globales
      updateStats();
      
      console.log('✅ Messages marqués comme lus pour conversation', conversationId);
    }
  } catch (error) {
    console.error('❌ Erreur marquage messages lus:', error);
    // Ne pas bloquer l'ouverture du chat si ça échoue
  }
}

// ============================================
// FERMER LE CHAT
// ============================================
function closeChat() {
  if (socket && currentConversationId) {
    socket.emit('leave_conversation', currentConversationId);
  }
  
  document.getElementById('chatModal').classList.remove('active');
  currentConversationId = null;
  
  // Recharger les conversations pour mettre à jour les compteurs
  loadConversations();
}

// ============================================
// CHARGEMENT DES MESSAGES
// ============================================
async function loadMessages(conversationId) {
  try {
    const token = localStorage.getItem('lcc_token');
    const response = await fetch(`/api/chat/conversations/${conversationId}/messages`, {
      headers: {
        'Authorization': 'Bearer ' + token
      }
    });
    
    if (!response.ok) {
      throw new Error('Erreur chargement messages');
    }
    
    const data = await response.json();
    const container = document.getElementById('chatMessages');
    container.innerHTML = '';
    
    if (data.messages && data.messages.length > 0) {
      data.messages.forEach(message => {
        appendMessage(message);
      });
    } else {
      container.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 40px;">Aucun message</p>';
    }
    
    scrollToBottom();
    
  } catch (error) {
    console.error('❌ Erreur chargement messages:', error);
    showToast('Erreur de chargement des messages', 'error');
  }
}

// ============================================
// ENVOI DE MESSAGE
// ============================================
async function sendMessageOwner() {
  const input = document.getElementById('chatInput');
  const content = input.value.trim();
  
  if (!content || !currentConversationId) return;
  
  const sendBtn = document.getElementById('sendBtn');
  sendBtn.disabled = true;
  
  try {
    const token = localStorage.getItem('lcc_token');
    const response = await fetch(`/api/chat/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({
        conversation_id: currentConversationId,
        message: content,
        sender_type: 'owner',
        sender_name: 'Propriétaire'
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Erreur envoi message');
    }
    
    // ✅ On ne fait PLUS appendMessage ici
    // Socket.IO va s'en charger via l'événement 'new_message'
    
    input.value = '';
    input.style.height = 'auto';
    
  } catch (error) {
    console.error('❌ Erreur envoi:', error);
    showToast('Erreur lors de l\'envoi du message', 'error');
  } finally {
    sendBtn.disabled = false;
  }
}

// ============================================
// AFFICHAGE DES MESSAGES
// ============================================
function appendMessage(message) {
  const container = document.getElementById('chatMessages');
  
  // Supprimer le message "Aucun message" si présent
  if (container.querySelector('p')) {
    container.innerHTML = '';
  }
  
  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${message.sender_type}`;
  
  const avatar = document.createElement('div');
  avatar.className = 'chat-avatar';
  avatar.textContent = message.sender_type === 'guest' ? 'V' : 
                      message.sender_type === 'bot' ? '🤖' : 'P';
  
  const contentDiv = document.createElement('div');
  contentDiv.style.flex = '1';
  
  const sender = document.createElement('div');
  sender.className = 'chat-sender';
  sender.textContent = message.sender_name || 
                      (message.sender_type === 'guest' ? 'Voyageur' : 
                       message.sender_type === 'bot' ? 'Assistant' : 'Vous');
  
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  bubble.textContent = message.message;
  
  
// Meta : heure + statut (même taille que côté guest)
const meta = document.createElement('div');
meta.className = 'chat-meta';

const time = document.createElement('span');
time.className = 'chat-time';
time.textContent = formatTime(message.created_at);

const status = document.createElement('span');
status.className = 'chat-status';

// Placeholder : on affiche "Envoyé" uniquement pour les messages du propriétaire (vous)
// (on rendra Distribué/Lu réel ensuite côté backend)
status.textContent = (message.sender_type === 'owner') ? 'Envoyé' : '';

meta.appendChild(time);
meta.appendChild(status);

contentDiv.appendChild(sender);
contentDiv.appendChild(bubble);
contentDiv.appendChild(meta);messageDiv.appendChild(avatar);
  messageDiv.appendChild(contentDiv);
  
  container.appendChild(messageDiv);
  scrollToBottom();
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  
  if (isToday) {
    return date.toLocaleTimeString('fr-FR', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  } else {
    return date.toLocaleDateString('fr-FR', { 
      day: '2-digit', 
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}

function scrollToBottom() {
  const container = document.getElementById('chatMessages');
  container.scrollTop = container.scrollHeight;
}

// ============================================
// COPIER LE LIEN D'INVITATION
// ============================================
function copyInviteLink(token, pinCode) {
  const chatLink = `${window.location.origin}/chat/${token}`;
  const message = `🎉 Bonjour et merci pour votre réservation !

Pour faciliter votre séjour et recevoir toutes les informations importantes (accès, livret d'accueil, etc.), merci de cliquer sur le lien ci-dessous :

🔗 ${chatLink}

📌 Votre code de vérification : ${pinCode}

Vous devrez saisir :
- La date de votre arrivée
- La plateforme de réservation
- Ce code à 4 chiffres

Au plaisir de vous accueillir ! 🏠`;
  
  navigator.clipboard.writeText(message).then(
    () => {
      showToast('Message copié dans le presse-papier !', 'success');
    },
    err => {
      console.error('Erreur copie:', err);
      showToast('Erreur lors de la copie', 'error');
    }
  );
}

// ============================================
// SOCKET.IO
// ============================================
function connectSocket() {
  console.log('🔌 [SOCKET] Connexion à:', API_URL);
  
  // Options Socket.io optimisées pour mobile natif
  const socketOptions = {
    transports: ['websocket', 'polling'], // Websocket en premier
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5,
    timeout: 20000
  };
  
  socket = io(API_URL, socketOptions);
  
  socket.on('connect', () => {
    console.log('✅ Socket connecté');
    
    // Rejoindre la room utilisateur pour les notifications
    if (userId) {
      socket.emit('join_user_room', userId);
    }
  });
  
  socket.on('connect_error', (error) => {
    console.error('❌ [SOCKET] Erreur de connexion:', error.message);
  });
  
  socket.on('new_message', (message) => {
    // Si c'est dans la conversation actuelle, afficher le message
    if (currentConversationId && message.conversation_id === currentConversationId) {
      appendMessage(message);
      scrollToBottom(); // ✅ Scroll automatique
    }
    
    // Mettre à jour le compteur de messages non lus
    loadConversations();
  });
  
  socket.on('new_notification', (notification) => {
    console.log('🔔 Nouvelle notification:', notification);
    // Afficher une notification toast
    showToast('Nouveau message reçu', 'info');
    // Recharger les conversations
    loadConversations();
  });
  
  socket.on('disconnect', () => {
    console.log('❌ Socket déconnecté');
  });
}

// ============================================
// LOADING & TOASTS
// ============================================
function showLoading() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) {
    overlay.classList.add('active');
  }
}

function hideLoading() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) {
    overlay.classList.remove('active');
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const icons = {
    success: 'fa-check-circle',
    error: 'fa-exclamation-circle',
    info: 'fa-info-circle'
  };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <i class="fas ${icons[type] || icons.info}"></i>
    <span class="toast-message">${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('hide');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3500);
}

// Fermer le modal en cliquant sur l'overlay
document.getElementById('chatModal').addEventListener('click', function(e) {
  if (e.target === this) {
    closeChat();
  }
});

// ============================================
// SUPPRESSION DE CONVERSATION
// ============================================
async function deleteConversation(conversationId, event) {
  // Empêcher l'ouverture du chat
  event.stopPropagation();
  
  if (!confirm('Êtes-vous sûr de vouloir supprimer cette conversation ? Cette action est irréversible.')) {
    return;
  }
  
  try {
    const token = localStorage.getItem('lcc_token');
    
    const response = await fetch(`/api/chat/conversations/${conversationId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': 'Bearer ' + token
      }
    });
    
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Erreur lors de la suppression');
    }
    
    // Supprimer visuellement avec animation
    const conversationElement = document.querySelector(`[data-conversation-id="${conversationId}"]`);
    if (conversationElement) {
      conversationElement.style.transition = 'all 0.3s ease';
      conversationElement.style.opacity = '0';
      conversationElement.style.transform = 'translateX(-20px)';
      
      setTimeout(() => {
        conversationElement.remove();
        
        // Retirer de allConversations
        allConversations = allConversations.filter(c => c.id !== conversationId);
        
        // Mettre à jour les stats
        updateStats();
        
        // Si plus aucune conversation, afficher le message vide
        const conversationsList = document.getElementById('conversationsList');
        if (conversationsList && conversationsList.children.length === 0) {
          conversationsList.innerHTML = `
            <div class="empty-state">
              <i class="fas fa-comments"></i>
              <h3>Aucune conversation</h3>
              <p>Les conversations avec vos voyageurs apparaîtront ici.</p>
            </div>
          `;
        }
      }, 300);
    }
    
    // Toast de confirmation
    showToast('Conversation supprimée avec succès', 'success');
    
  } catch (error) {
    console.error('❌ Erreur suppression conversation:', error);
    showToast('Erreur: ' + error.message, 'error');
  }
}
