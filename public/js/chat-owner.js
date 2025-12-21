// ============================================
// CONFIGURATION & STATE
// ============================================
const API_URL = window.location.origin;
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
    const response = await fetch(`${API_URL}/api/properties`, {
      headers: {
        'Authorization': 'Bearer ' + token
      }
    });
    
    if (!response.ok) return;
    
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
    
    let url = `${API_URL}/api/chat/conversations?`;
    if (status) url += `status=${status}&`;
    if (propertyId) url += `property_id=${propertyId}&`;
    
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
  
  document.getElementById('statTotal').textContent = total;
  document.getElementById('statUnread').textContent = unread;
  document.getElementById('statActive').textContent = active;
  document.getElementById('unreadCount').textContent = unread || '';
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
      <div class="conversation-item" onclick="openChat(${conv.id})">
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
              <div class="conversation-time">${lastMessageTime}</div>
              <div class="status-badge ${statusClass}">${statusLabel}</div>
              ${unreadCount > 0 ? `<div class="unread-badge">${unreadCount}</div>` : ''}
            </div>
          </div>
          
          <div class="conversation-actions">
            <button class="btn-action" onclick="event.stopPropagation(); openChat(${conv.id});">
              <i class="fas fa-comments"></i>
              Ouvrir la conversation
            </button>
            <button class="btn-action secondary" onclick="event.stopPropagation(); copyInviteLink('${conv.unique_token}', '${conv.pin_code}');">
              <i class="fas fa-copy"></i>
              Copier l'invitation
            </button>
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
  
  // Rejoindre la room Socket.IO
  if (socket) {
    socket.emit('join_conversation', conversationId);
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
    const response = await fetch(`${API_URL}/api/chat/conversations/${conversationId}/messages`, {
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
    const response = await fetch(`${API_URL}/api/chat/conversations/${currentConversationId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({
  message: content,
  sender_name: 'Propriétaire'
})
    });
    
    if (!response.ok) {
      throw new Error('Erreur envoi message');
    }
    const data = await response.json();
if (data.message) {
  appendMessage(data.message);
  scrollToBottom();
}
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
  if (message && message.id) messageDiv.dataset.messageId = String(message.id);
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

// Statut WhatsApp :
// - Envoyé = rien reçu par l'autre (fallback)
// - ✓ = distribué (delivered_at)
// - ✓✓ = lu (read_at / is_read)
if (message.sender_type === 'owner') {
  const delivered = !!message.delivered_at;
  const read = !!message.read_at || !!message.is_read;
  status.textContent = read ? '✓✓' : (delivered ? '✓' : 'Envoyé');
} else {
  status.textContent = '';
}

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
  socket = io(API_URL);
  
  socket.on('connect', () => {
    console.log('✅ Socket connecté');
    
    // Rejoindre la room utilisateur pour les notifications
    if (userId) {
      socket.emit('join_user_room', userId);
    }
  });
  
  socket.on('new_message', (message) => {
    // Si c'est dans la conversation actuelle, afficher le message
    if (currentConversationId && message.conversation_id === currentConversationId) {
      appendMessage(message);
    }
    
    // Mettre à jour le compteur de messages non lus
  loadConversations();

  // Si on est dans la conversation ouverte et que le message vient de l'autre, on confirme "Distribué"
  if (currentConversationId && message.conversation_id === currentConversationId && message.sender_type !== 'owner') {
    socket.emit('message_delivered', { conversationId: currentConversationId, messageId: message.id, reader_type: 'owner' });
    // Si le chat est ouvert et en bas, on marque aussi "Lu"
    setTimeout(markVisibleAsRead, 50);
  }
});

// ✅ Le serveur confirme qu'un message a été distribué : mettre ✓ sur nos messages
socket.on('message_delivered', ({ messageId }) => {
  updateMessageStatus(messageId, { delivered: true });
});

// ✅ Le serveur confirme une lecture : mettre ✓✓ sur nos messages jusqu'à upTo
socket.on('messages_read', ({ conversationId, upToMessageId, reader_type }) => {
  if (!currentConversationId || conversationId !== currentConversationId) return;
  // Si l'autre a lu, alors nos messages envoyés (owner) deviennent ✓✓
  if (reader_type === 'guest') {
    updateMessagesReadUpTo(upToMessageId);
  }
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
// ✅ STATUTS : helpers DOM
// ============================================
function updateMessageStatus(messageId, { delivered = false, read = false } = {}) {
  const el = document.querySelector(`.chat-message[data-message-id="${messageId}"] .chat-status`);
  if (!el) return;

  const current = el.textContent || '';
  if (read) { el.textContent = '✓✓'; return; }
  if (delivered) {
    // si déjà ✓✓, ne pas rétrograder
    if (current.includes('✓✓')) return;
    el.textContent = '✓';
  }
}

function updateMessagesReadUpTo(upToMessageId) {
  document.querySelectorAll('.chat-message.owner[data-message-id]').forEach(msgEl => {
    const id = parseInt(msgEl.dataset.messageId, 10);
    if (!Number.isFinite(id)) return;
    if (id <= upToMessageId) {
      const statusEl = msgEl.querySelector('.chat-status');
      if (statusEl) statusEl.textContent = '✓✓';
    }
  });
}

// Marquer comme "Lu" si l'utilisateur regarde la conversation et est en bas (ou presque)
function markVisibleAsRead() {
  if (!socket || !currentConversationId) return;

  const container = document.getElementById('chatMessages');
  if (!container) return;

  const nearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 40;
  if (!nearBottom) return;

  // Dernier message de l'autre partie visible : on marque lu jusqu'à ce message
  const msgs = Array.from(document.querySelectorAll('.chat-message.guest[data-message-id]'));
  if (msgs.length === 0) return;
  const lastId = parseInt(msgs[msgs.length - 1].dataset.messageId, 10);
  if (!Number.isFinite(lastId)) return;

  socket.emit('messages_read', { conversationId: currentConversationId, upToMessageId: lastId, reader_type: 'owner' });
}

// Quand l'utilisateur scrolle jusqu'en bas, on marque lu
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('chatMessages');
  if (container) {
    container.addEventListener('scroll', () => {
      // throttle léger
      window.clearTimeout(window.__readThrottle);
      window.__readThrottle = window.setTimeout(markVisibleAsRead, 120);
    });
  }
  window.addEventListener('focus', () => setTimeout(markVisibleAsRead, 120));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) setTimeout(markVisibleAsRead, 120);
  });
});
