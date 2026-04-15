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
let currentChannexBookingId = null; // null si pas de lien Channex
window._chatSocket = null; // exposé pour messages.html
let allConversations = [];
let searchQuery = '';
let currentConversationId = null;
let userId = null;

// ============================================
// DÉTECTION MOBILE (pour redirection)
// ============================================
function isMobileDevice() {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth <= 768;
}

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
  
  // Event listeners pour les filtres
  setupFilters();
  
  // Auto-resize textarea
  const chatInput = document.getElementById('chatInput');
  if (chatInput) {
    chatInput.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });
    
    // Send on Ctrl+Enter or Shift+Enter, new line on Enter
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.shiftKey)) {
        e.preventDefault();
        sendMessageOwner();
      }
    });
  }
  
  // Fermer le modal en cliquant sur l'overlay
  const chatModal = document.getElementById('chatModal');
  if (chatModal) {
    chatModal.addEventListener('click', function(e) {
      if (e.target === this) {
        closeChat();
      }
    });
  }
  
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
    
    // Vérifier content-type
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      console.warn('⚠️ Properties non-JSON');
      return;
    }
    
    if (!response.ok) return;
    
    const data = await response.json();
    const select = document.getElementById('filterProperty');
    
    if (select && data.properties) {
      data.properties.forEach(property => {
        const option = document.createElement('option');
        option.value = property.id;
        option.textContent = property.name;
        select.appendChild(option);
      });
    }
    
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
    const status = document.getElementById('filterStatus')?.value || '';
    const propertyId = document.getElementById('filterProperty')?.value || '';
    
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
      if (response.status === 401) {
        window.location.href = '/login.html';
        return;
      }
      throw new Error('Erreur chargement conversations');
    }
    
    const data = await response.json();
    allConversations = data.conversations || [];
    // Trier immédiatement par dernier message DESC
    allConversations.sort((a, b) => {
      const tA = new Date(a.last_message_time || a.created_at || 0).getTime();
      const tB = new Date(b.last_message_time || b.created_at || 0).getTime();
      return tB - tA;
    });
    window.allConversations = allConversations; // exposé pour messages.html
    
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
  if (!container) return;
  
  // Filtrer selon la recherche en cours
  const q = searchQuery.toLowerCase().trim();
  const filtered = q
    ? allConversations.filter(conv => {
        const name = (cleanGuestName(conv) || '').toLowerCase();
        const prop  = (conv.property_name || '').toLowerCase();
        const plat  = (conv.platform || '').toLowerCase();
        return name.includes(q) || prop.includes(q) || plat.includes(q);
      })
    : allConversations;

  // Trier par dernier message DESC (ou created_at si pas de message)
  filtered.sort((a, b) => {
    const tA = new Date(a.last_message_time || a.created_at || 0).getTime();
    const tB = new Date(b.last_message_time || b.created_at || 0).getTime();
    return tB - tA;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-comments"></i>
        <h3>${q ? 'Aucun résultat' : 'Aucune conversation'}</h3>
        <p>${q ? 'Aucune conversation ne correspond à votre recherche.' : 'Les conversations avec vos voyageurs apparaîtront ici.'}</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = filtered.map(conv => {
    const unreadCount = parseInt(conv.unread_count) || 0;
    const statusClass = conv.status;
    const statusLabel = getStatusLabel(conv.status);
    
    const guestName = cleanGuestName(conv);
    const guestInitial = getGuestInitial(conv);
    const guestPhone = getGuestPhone(conv);
    
    const checkinDate = new Date(conv.reservation_start_date).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'short'
    });
    
    const lastMessageTime = conv.last_message_time 
      ? formatTime(conv.last_message_time)
      : formatTime(conv.created_at);
    
    const platformIcon = getPlatformIcon(conv.platform);
    const platformColor = getPlatformColor(conv.platform);
    
    return `
      <div class="conversation-item" data-conversation-id="${conv.id}" onclick="openChat(${conv.id})">
        <div class="conversation-avatar" style="background: ${getPlatformColor(conv.platform)};">
          ${guestInitial}
        </div>
        
        <div class="conversation-content">
          <div class="conversation-header">
            <div class="conversation-info">
              <h3>${guestName}</h3>
              ${guestPhone ? `<span class="conversation-phone">${guestPhone}</span>` : ''}
              <div class="meta">
                <span class="property-badge" style="background: ${conv.property_color || '#10B981'}20; color: ${conv.property_color || '#10B981'};">
                  ${conv.property_name || 'Logement'}
                </span>
                <span><i class="fas fa-calendar"></i> ${checkinDate}</span>
                <span class="platform-badge" style="background-color: ${platformColor}20; color: ${platformColor};">
                  <i class="fas ${platformIcon}"></i>
                  ${conv.platform || 'direct'}
                </span>
              </div>
            </div>
            
            <div class="conversation-status">
              <!-- Bouton de suppression -->
              <div class="conversation-actions">
                <button class="btn-delete-conversation" 
                        onclick="deleteConversation(${conv.id}, event)" 
                        title="Supprimer la conversation">
                  <i class="fas fa-trash"></i>
                  Supprimer
                </button>
              </div>
              
              <div style="display:flex;align-items:center;gap:5px;justify-content:flex-end;">
                ${(function() {
                  const ageMs = Date.now() - new Date(conv.created_at).getTime();
                  const openedIds = JSON.parse(localStorage.getItem('bh_opened_convs') || '[]');
                  const isNew = ageMs < 24 * 60 * 60 * 1000 && unreadCount === 0 && !openedIds.includes(conv.id);
                  return isNew ? `<span class="conv-new-badge" data-conv-id="${conv.id}" style="background:#EF4444;color:#fff;font-size:9px;font-weight:700;padding:2px 6px;border-radius:999px;letter-spacing:.04em;">NEW</span>` : '';
                })()}
                <div class="conversation-time">${lastMessageTime}</div>
              </div>
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
// FONCTIONS UTILITAIRES
// ============================================
function cleanGuestName(conv) {
  if (!conv) return 'Voyageur';
  
  // Priorité 1 : guest_display_name (construit par le serveur)
  if (conv.guest_display_name && 
      conv.guest_display_name !== 'Voyageur' && 
      conv.guest_display_name.trim() !== '') {
    return conv.guest_display_name;
  }
  
  // Priorité 2 : Construire depuis guest_first_name + guest_last_name
  if (conv.guest_first_name) {
    const firstName = conv.guest_first_name.trim();
    const lastName = conv.guest_last_name ? conv.guest_last_name.trim() : '';
    return lastName ? `${firstName} ${lastName}` : firstName;
  }
  
  // Priorité 3 : Fallback sur guest_name / guestName
  const rawName = conv.guest_name || conv.guestName;
  if (rawName && rawName !== 'undefined' && rawName !== 'null' && rawName.trim() !== '') {
    return rawName.trim();
  }
  
  // Fallback final
  return 'Voyageur';
}

function getGuestInitial(conv) {
  const name = cleanGuestName(conv);
  return name.charAt(0).toUpperCase();
}

function getGuestPhone(conv) {
  if (!conv) return '';
  return conv.guest_phone || conv.guestPhone || '';
}

function getPlatformIcon(platform) {
  const p = (platform || '').toLowerCase();
  if (p.includes('airbnb')) return 'fa-home';  // ✅ Airbnb (fa-airbnb n'existe pas dans Font Awesome free)
  if (p.includes('booking')) return 'fa-bed';
  return 'fa-calendar';
}

function getPlatformColor(platform) {
  const p = (platform || '').toLowerCase();
  // Valeurs converties par server.js (OTA_MAP)
  if (p.includes('airbnb') || p === 'abb') return '#FF5A5F';
  if (p.includes('booking') || p === 'bdc') return '#003580';
  if (p.includes('expedia') || p === 'exp') return '#FFC72C';
  if (p.includes('vrbo') || p.includes('homeaway') || p.includes('abritel')) return '#3D6AFF';
  // Autres OTAs
  if (p.includes('tripadvisor')) return '#00AA6C';
  if (p.includes('google'))      return '#4285F4';
  if (p.includes('agoda'))       return '#5392FF';
  if (p.includes('holidu'))      return '#00C2A8';
  if (p.includes('tui'))         return '#E2001A';
  // Direct / manuel
  if (p.includes('direct') || p.includes('manual')) return '#1A7A5E';
  // Fallback vert Boostinghost
  return '#1A7A5E';
}

function getStatusLabel(status) {
  const labels = {
    'active': 'Active',
    'pending': 'En attente',
    'closed': 'Fermée',
    'archived': 'Archivée'
  };
  return labels[status] || 'Active';
}

// ============================================
// FILTRES
// ============================================
function setupFilters() {
  const statusFilter = document.getElementById('filterStatus');
  const propertyFilter = document.getElementById('filterProperty');
  
  if (statusFilter) {
    statusFilter.addEventListener('change', loadConversations);
  }
  
  if (propertyFilter) {
    propertyFilter.addEventListener('change', loadConversations);
  }

  // Barre de recherche (desktop + mobile)
  const searchInput = document.getElementById('msgsSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      searchQuery = this.value;
      renderConversations();
    });
  }
}

// ============================================
// OUVRIR UNE CONVERSATION
// ============================================
async function openChat(conversationId) {
  console.log('💬 Ouverture conversation:', conversationId);
  
  // 🔥 SUR MOBILE : Rediriger vers une page dédiée
  if (isMobileDevice()) {
    // Sauvegarder l'ID de conversation
    sessionStorage.setItem('current_conversation_id', conversationId);
    
    // Rediriger vers la page de chat mobile
    // Pour Capacitor, utiliser le chemin complet
    const chatUrl = IS_NATIVE 
      ? `${window.location.origin}/chat-mobile.html?id=${conversationId}`
      : `/chat-mobile.html?id=${conversationId}`;
    
    console.log('🔄 Redirection vers:', chatUrl);
    window.location.href = chatUrl;
    return;
  }
  
  // 💻 SUR DESKTOP : Garder le modal (comportement actuel)
  currentConversationId = conversationId;
  const conv = allConversations.find(c => c.id == conversationId);
  
  if (!conv) return;

  // ✅ Supprimer le badge NEW à l'ouverture + mémoriser dans localStorage
  const newBadge = document.querySelector(`.conv-new-badge[data-conv-id="${conversationId}"]`);
  if (newBadge) newBadge.remove();
  const openedIds = JSON.parse(localStorage.getItem('bh_opened_convs') || '[]');
  if (!openedIds.includes(conversationId)) {
    openedIds.push(conversationId);
    localStorage.setItem('bh_opened_convs', JSON.stringify(openedIds));
  }
  
  // Nom complet : priorité guest_first_name + guest_last_name (Channex)
  const firstName = conv.guest_first_name || null;
  const lastName  = conv.guest_last_name  || null;
  const fullName  = (firstName || lastName)
    ? [firstName, lastName].filter(Boolean).join(' ')
    : cleanGuestName(conv);

  const titleEl = document.getElementById('chatModalTitle');
  if (titleEl) titleEl.textContent = fullName;

  // Nationalité
  const countryCode = conv.guest_country || null;
  const countryNames = {
    FR:'France', GB:'Royaume-Uni', DE:'Allemagne', ES:'Espagne', IT:'Italie',
    US:'États-Unis', NL:'Pays-Bas', BE:'Belgique', CH:'Suisse', PT:'Portugal',
    CA:'Canada', AU:'Australie', JP:'Japon', CN:'Chine', BR:'Brésil',
    MX:'Mexique', RU:'Russie', IN:'Inde', ZA:'Afrique du Sud', MA:'Maroc',
    TN:'Tunisie', DZ:'Algérie', LU:'Luxembourg', IE:'Irlande', SE:'Suède',
    NO:'Norvège', DK:'Danemark', FI:'Finlande', PL:'Pologne', AT:'Autriche',
    GR:'Grèce', TR:'Turquie', AE:'Émirats arabes unis', SG:'Singapour',
  };
  const countryEl = document.getElementById('chatGuestCountry');
  if (countryEl) {
    if (countryCode) {
      const flag = countryCode.toUpperCase().replace(/./g, c =>
        String.fromCodePoint(c.charCodeAt(0) + 127397)
      );
      const countryName = countryNames[countryCode] || countryCode;
      countryEl.textContent = flag + ' ' + countryName;
      countryEl.style.display = 'block';
    } else {
      countryEl.style.display = 'none';
    }
  }

  // Remplir les infos dans le header
  const propertyNameEl = document.getElementById('chatPropertyName');
  const checkinDateEl  = document.getElementById('chatCheckinDate');

  if (propertyNameEl) propertyNameEl.textContent = conv.property_name || 'Logement';
  if (checkinDateEl && conv.reservation_start_date) {
    const checkin = new Date(conv.reservation_start_date).toLocaleDateString('fr-FR');
    checkinDateEl.textContent = checkin;
  }
  
  // Afficher le bouton de copie du lien
  const copyLinkBtn = document.getElementById('btnCopyInviteLink');
  if (copyLinkBtn && conv.chat_token && conv.pin_code) {
    copyLinkBtn.style.display = 'inline-flex';
    copyLinkBtn.onclick = () => copyInviteLink(conv.chat_token, conv.pin_code);
  } else if (copyLinkBtn) {
    copyLinkBtn.style.display = 'none';
  }
  
  // Détecter Channex en arrière-plan (après que showInlineChat ait rendu l'UI)
  currentChannexBookingId = null;
  window._currentChannexBookingId = null;
  const bookingBtn = document.getElementById('btnBookingMessage');
  if (bookingBtn) bookingBtn.style.display = 'none';
  setTimeout(() => _checkChannexConversation(conversationId, conv), 200);
  
  // Afficher la modal
  const modal = document.getElementById('chatModal');
  if (modal) {
    modal.classList.add('active');
  }
  
  // ✅ BLOQUER LE SCROLL DU BODY (FIX iOS)
  document.body.classList.add('modal-open');
  document.body.style.overflow = 'hidden';
  document.body.style.position = 'fixed';
  document.body.style.width = '100%';
  document.body.style.height = '100%';
  document.documentElement.style.overflow = 'hidden';
  
  // Charger les messages
  await loadMessages(conversationId);
  
  // Marquer comme lu
  await markMessagesAsRead(conversationId);
  
  // Rejoindre la room Socket.IO
  if (socket) {
    socket.emit('join_conversation', conversationId);
  }
}

async function markMessagesAsRead(conversationId) {
  try {
    const token = localStorage.getItem('lcc_token');
    await fetch(`/api/chat/mark-read/${conversationId}`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token
      }
    });
    
    // Recharger les conversations pour mettre à jour le badge
    await loadConversations();
  } catch (error) {
    console.error('❌ Erreur marquage lu:', error);
  }
}

function closeChat() {
  const modal = document.getElementById('chatModal');
  if (modal) {
    modal.classList.remove('active');
  }
  
  // ✅ DÉBLOQUER LE SCROLL DU BODY (FIX iOS)
  document.body.classList.remove('modal-open');
  document.body.style.overflow = '';
  document.body.style.position = '';
  document.body.style.width = '';
  document.body.style.height = '';
  document.documentElement.style.overflow = '';
  
  if (socket && currentConversationId) {
    socket.emit('leave_conversation', currentConversationId);
  }
  
  currentConversationId = null;
}

// ============================================
// MESSAGES
// ============================================
async function loadMessages(conversationId) {
  try {
    const token = localStorage.getItem('lcc_token');
    const response = await fetch(`/api/chat/messages/${conversationId}`, {
      headers: {
        'Authorization': 'Bearer ' + token
      }
    });
    
    if (!response.ok) {
      throw new Error('Erreur chargement messages');
    }
    
    const data = await response.json();
    
    if (data.success && data.messages) {
      displayMessages(data.messages);
    }
  } catch (error) {
    console.error('❌ Erreur chargement messages:', error);
    showToast('Erreur de chargement des messages', 'error');
  }
}

function displayMessages(messages) {
  const container = document.getElementById('chatMessages');
  if (!container) return;
  
  container.innerHTML = '';
  
  if (!messages || messages.length === 0) {
    // ✅ Attendre que les messages Channex soient injectés avant d'afficher "Aucun message"
    container.innerHTML = `<div class="empty-state" id="emptyMsgState"><i class="fas fa-comments"></i><p>Aucun message</p></div>`;
    setTimeout(() => {
      const el = document.getElementById('emptyMsgState');
      const chatEl = document.getElementById('chatMessages');
      // S'il y a des messages Channex injectés, cacher l'empty state
      if (el && chatEl && chatEl.children.length > 1) {
        el.style.display = 'none';
      }
    }, 800);
    return;
  }
  
  messages.forEach(msg => appendMessage(msg));
  scrollToBottom();
}

function appendMessage(message) {
  const container = document.getElementById('chatMessages');
  if (!container) return;
  
  const isOwner = message.sender_type === 'owner' || message.sender_type === 'property' || message.sender_type === 'bot';
  
  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${isOwner ? 'owner' : 'guest'}`;
  
  const avatar = document.createElement('div');
  avatar.className = 'chat-avatar';
  avatar.textContent = isOwner ? '🏠' : '👤';
  
  const contentDiv = document.createElement('div');
  contentDiv.className = 'chat-content';
  
  const sender = document.createElement('div');
  sender.className = 'chat-sender';
  sender.textContent = isOwner ? 'Vous' : 'Voyageur';
  
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';

  const stripeMatch = (message.message || '').match(/(https?:\/\/(?:checkout\.stripe\.com|tinyurl\.com)\/\S+)/);
  if (stripeMatch) {
    const url = stripeMatch[1];
    const textBefore = (message.message || '').replace(url, '').trim();
    if (textBefore) {
      const textNode = document.createElement('div');
      textNode.style.cssText = 'margin-bottom:8px;';
      textNode.textContent = textBefore;
      bubble.appendChild(textNode);
    }
    const card = document.createElement('a');
    card.href = url;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    card.style.cssText = 'display:flex;align-items:center;gap:10px;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);border-radius:12px;padding:10px 14px;text-decoration:none;color:inherit;';
    card.innerHTML = '<span style="font-size:22px;">🔒</span>'
      + '<div><div style="font-weight:700;font-size:13px;">Déposer la caution</div>'
      + '<div style="font-size:11px;opacity:0.75;margin-top:2px;">Cliquer pour déposer en ligne</div></div>'
      + '<span style="margin-left:auto;font-size:16px;">→</span>';
    bubble.appendChild(card);
  } else {
    bubble.textContent = message.message;
  }
  
  // Meta : heure + statut
  const meta = document.createElement('div');
  meta.className = 'chat-meta';
  
  const time = document.createElement('span');
  time.className = 'chat-time';
  time.textContent = formatTime(message.created_at);
  
  const status = document.createElement('span');
  status.className = 'chat-status';
  status.textContent = (message.sender_type === 'owner' || message.sender_type === 'property' || message.sender_type === 'bot') ? 'Envoyé' : '';
  
  meta.appendChild(time);
  meta.appendChild(status);
  
  contentDiv.appendChild(sender);
  contentDiv.appendChild(bubble);
  contentDiv.appendChild(meta);
  
  // Bouton traduction — uniquement sur les messages du voyageur avec du texte
  const msgTextOnly = (message.message || '').replace(/\[IMAGE:[^\]]+\]/g, '').trim();
  if (!isOwner && msgTextOnly) {
    const txBar = document.createElement('div');
    txBar.className = 'tx-bar';
    
    const txBtn = document.createElement('button');
    txBtn.className = 'tx-chip';
    txBtn.innerHTML = '<span class="tx-flags">🇫🇷→🇬🇧</span><span class="tx-label">Traduire</span>';
    txBtn.setAttribute('data-original', message.message);
    txBtn.setAttribute('data-translated', '');
    txBtn.setAttribute('data-state', 'original'); // original | loading | translated
    
    txBtn.addEventListener('click', async function() {
      const state = txBtn.getAttribute('data-state');
      const original = txBtn.getAttribute('data-original');
      
      if (state === 'translated') {
        // Revenir à l'original
        bubble.textContent = original;
        txBtn.innerHTML = '🌐 Traduire';
        txBtn.setAttribute('data-state', 'original');
        return;
      }
      
      // Déjà traduit en cache
      const cached = txBtn.getAttribute('data-translated');
      if (cached) {
        bubble.textContent = cached;
        txBtn.innerHTML = '<span class="tx-flags">🇬🇧→🇫🇷</span><span class="tx-label">Original</span>';
        txBtn.setAttribute('data-state', 'translated');
        txBtn.classList.add('translated');
        return;
      }
      
      // Traduire via MyMemory
      txBtn.innerHTML = '<span class="tx-flags">⏳</span><span class="tx-label">...</span>';
      txBtn.setAttribute('data-state', 'loading');
      txBtn.disabled = true;
      
      try {
        const ownerLang = localStorage.getItem('owner_lang') || 'fr';
        const translated = await chatTranslate(original, ownerLang);
        txBtn.setAttribute('data-translated', translated);
        bubble.textContent = translated;
        txBtn.innerHTML = '<span class="tx-flags">🇬🇧→🇫🇷</span><span class="tx-label">Original</span>';
        txBtn.setAttribute('data-state', 'translated');
        txBtn.classList.add('translated');
      } catch(e) {
        txBtn.innerHTML = '<span class="tx-flags">🇫🇷→🇬🇧</span><span class="tx-label">Traduire</span>';
        txBtn.setAttribute('data-state', 'original');
      }
      txBtn.disabled = false;
    });
    
    txBar.appendChild(txBtn);
    contentDiv.appendChild(txBar);
  }
  
  messageDiv.appendChild(avatar);
  messageDiv.appendChild(contentDiv);
  
  container.appendChild(messageDiv);
  scrollToBottom();
}

// ── Traduction MyMemory ──────────────────────────────────────────────────
const _txCache = {};
async function chatTranslate(text, targetLang) {
  const langMap = { fr: 'en|fr', en: 'fr|en', de: 'fr|de', it: 'fr|it', nl: 'fr|nl', zh: 'fr|zh-CN' };
  const langpair = langMap[targetLang] || 'en|fr';
  const key = langpair + '|' + text.slice(0, 60);
  if (_txCache[key]) return _txCache[key];
  
  // Découper si > 450 chars
  if (text.length <= 450) {
    const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langpair}`);
    const d = await r.json();
    if (d.responseStatus === 200) {
      _txCache[key] = d.responseData.translatedText;
      return _txCache[key];
    }
    throw new Error('Translation failed');
  }
  
  // Texte long : découper par phrases
  const sentences = text.match(/[^.!?]+[.!?]*/g) || [text];
  const parts = [];
  for (const s of sentences) {
    const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(s.trim())}&langpair=${langpair}`);
    const d = await r.json();
    parts.push(d.responseStatus === 200 ? d.responseData.translatedText : s);
  }
  _txCache[key] = parts.join(' ');
  return _txCache[key];
}

// Langue du proprio (sauvegardée dans localStorage)
function setOwnerLang(lang) {
  localStorage.setItem('owner_lang', lang);
}

async function sendMessageOwner() {
  const input = document.getElementById('chatInput');
  if (!input || !currentConversationId) return;

  const message = input.value.trim();
  if (!message) return;

  const sendBtn = document.getElementById('sendBtn');
  if (sendBtn) sendBtn.disabled = true;

  try {
    const token = localStorage.getItem('lcc_token');

    // ── Si conversation liée à Channex : envoyer via plateforme ──
    if (currentChannexBookingId) {
      const response = await fetch(`${API_URL}/api/chat/conversations/${currentConversationId}/send-platform`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ message })
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Erreur envoi plateforme');
      }
      input.value = '';
      input.style.height = 'auto';
      showToast('✅ Envoyé sur la plateforme', 'success');
      return;
    }

    // ── Conversation BH classique ──────────────────────────────
    const response = await fetch(API_URL + '/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        conversation_id: currentConversationId,
        message: message,
        sender_type: 'owner'
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Erreur envoi message');
    }

    input.value = '';
    input.style.height = 'auto';
    // Le message sera ajouté via Socket.IO

  } catch (error) {
    console.error('❌ Erreur envoi message:', error);
    showToast('Erreur lors de l\'envoi : ' + error.message, 'error');
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

// ── Injecter les messages Channex dans le chat UI ─────────────
function _injectChannexMessages(channexMsgs) {
  const chatEl = document.getElementById('chatMessages');
  if (!chatEl) return;
  channexMsgs.forEach(m => {
    if (chatEl.querySelector(`[data-channex-id="${m.id}"]`)) return;
    const isGuest = m.sender === 'guest';
    const time = m.inserted_at
      ? new Date(m.inserted_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      : '';
    const div = document.createElement('div');
    div.className = `chat-message${isGuest ? '' : ' owner'}`;
    div.setAttribute('data-channex-id', m.id);
    div.innerHTML = `
      <div class="chat-bubble">
        <div class="chat-sender">${isGuest ? 'Voyageur' : 'Vous'} <span style="font-size:10px;opacity:.6;">· via plateforme</span></div>
        <div class="chat-text">${m.message}</div>
        <div class="chat-time">${time}</div>
      </div>`;
    chatEl.appendChild(div);
  });
  chatEl.scrollTop = chatEl.scrollHeight;
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
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
}

// ============================================
// GÉNÉRATION MESSAGE BOOKING
// ============================================
async function openBookingMessageModal(conversationId) {
  try {
    const token = localStorage.getItem('lcc_token');
    const response = await fetch(`/api/chat/generate-booking-message/${conversationId}`, {
      headers: {
        'Authorization': 'Bearer ' + token
      }
    });
    
    if (!response.ok) {
      throw new Error('Erreur génération message');
    }
    
    const data = await response.json();
    
    if (data.success && data.message) {
      // Copier dans le presse-papier
      await navigator.clipboard.writeText(data.message);
      
      // Afficher une notification
      showToast('✅ Message copié dans le presse-papier !', 'success');
    }
  } catch (error) {
    console.error('❌ Erreur génération message:', error);
    showToast('❌ Erreur lors de la génération', 'error');
  }
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
    console.log('📨 Nouveau message reçu:', message);
    
    // Si c'est dans la conversation actuelle, afficher le message
    if (currentConversationId && message.conversation_id === currentConversationId) {
      appendMessage(message);
      scrollToBottom();
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
  
  socket.on('messages_read', ({ conversationId }) => {
    console.log('✅ Messages marqués comme lus:', conversationId);
    // Recharger les conversations
    loadConversations();
  });
  
  socket.on('disconnect', () => {
    console.log('❌ Socket déconnecté');
  });

  // ── Messages entrants depuis les plateformes (Airbnb/Booking) ──
  socket.on('new_platform_message', (data) => {
    console.log('💬 [CHANNEX] Message plateforme reçu:', data);

    // Recharger la liste des conversations (badge non-lu)
    loadConversations();

    // Si la conversation est ouverte, afficher le message
    if (data.conversation_id && currentConversationId == data.conversation_id && data.message) {
      const m = data.message;
      const div = document.createElement('div');
      div.className = 'chat-message';
      const time = new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      div.innerHTML = `
        <div class="chat-bubble">
          <div class="chat-sender">Voyageur <span style="font-size:10px;opacity:.6;">· via plateforme</span></div>
          <div class="chat-text">${m.message}</div>
          <div class="chat-time">${time}</div>
        </div>`;
      const chatEl = document.getElementById('chatMessages');
      if (chatEl) { chatEl.appendChild(div); chatEl.scrollTop = chatEl.scrollHeight; }
    }

    showToast('💬 Nouveau message voyageur', 'info');
  });

  // Exposer le socket pour messages.html
  window._chatSocket = socket;
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
  
  // Fallback si pas de container
  if (!container) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 10000;
      animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
    return;
  }

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

// ============================================
// GESTION CLAVIER
// ============================================
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && currentConversationId) {
    closeChat();
  }
});

// ============================================
// DÉTECTION CHANNEX (appelée après rendu UI)
// ============================================
async function _checkChannexConversation(conversationId, conv) {
  try {
    const token = localStorage.getItem('lcc_token');
    const chxRes = await fetch(`${API_URL}/api/chat/conversations/${conversationId}/messages-channex`, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!chxRes.ok) return;

    const chxData = await chxRes.json();

    if (chxData.channex_booking_id) {
      currentChannexBookingId = chxData.channex_booking_id;
      window._currentChannexBookingId = currentChannexBookingId;

      // Adapter le sendBtn pour la plateforme
      const platform = (conv ? conv.platform || '' : '').toLowerCase();
      const platformLabel = platform.includes('airbnb') ? 'Airbnb' : platform.includes('booking') ? 'Booking.com' : 'Plateforme';
      const platformColor = platform.includes('airbnb') ? '#FF5A5F' : platform.includes('booking') ? '#003580' : '#1A7A5E';

      const sendBtn = document.getElementById('sendBtn');
      if (sendBtn) {
        sendBtn.title = `Envoyer sur ${platformLabel}`;
        sendBtn.style.background = platformColor;
      }
      const chatInput = document.getElementById('chatInput');
      if (chatInput) chatInput.placeholder = `Répondre via ${platformLabel}…`;

      // Injecter messages Channex non encore en DB
      if (chxData.channex_messages && chxData.channex_messages.length > 0) {
        _injectChannexMessages(chxData.channex_messages);
      }

      console.log(`✅ [CHANNEX] Conversation ${conversationId} liée au booking ${chxData.channex_booking_id}`);
    } else {
      // Reset sendBtn état normal
      const sendBtn = document.getElementById('sendBtn');
      if (sendBtn) { sendBtn.style.background = ''; sendBtn.title = 'Envoyer'; }
      const chatInput = document.getElementById('chatInput');
      if (chatInput) chatInput.placeholder = 'Répondre à…';
    }
  } catch(e) {
    console.warn('⚠️ [CHANNEX] check:', e.message);
  }
}

// ============================================
// EXPOSER LES FONCTIONS GLOBALEMENT
// ============================================
window.openChat = openChat;
window.closeChat = closeChat;
window.sendMessageOwner = sendMessageOwner;
window.loadQuickReplies = loadQuickReplies;
window.openBookingMessageModal = openBookingMessageModal;
window.copyInviteLink = copyInviteLink;
window.deleteConversation = deleteConversation;
window.cleanGuestName = cleanGuestName;
window.getGuestInitial = getGuestInitial;
window.getGuestPhone = getGuestPhone;
window.formatRelativeTime = formatTime; // Alias pour compatibilité

// ============================================
// RACCOURCIS MESSAGES
// ============================================
async function loadQuickReplies(conversationId) {
  const bar = document.getElementById('quickRepliesBar');
  if (!bar) return;
  bar.innerHTML = '';
  bar.style.display = 'none';

  try {
    const token = localStorage.getItem('lcc_token');
    const res = await fetch(`${API_URL}/api/chat/conversations/${conversationId}/quick-context`, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) return;
    const data = await res.json();

    const chips = [];

    // Raccourcis texte
    (data.quickReplies || []).forEach(reply => {
      // Compatibilité : ancien format string ou nouveau format {title, text}
      const text  = (typeof reply === 'object') ? reply.text  : reply;
      const title = (typeof reply === 'object') ? reply.title : reply;
      const btn = document.createElement('button');
      btn.className = 'qr-chip';
      btn.textContent = title || text;
      btn.title = text; // tooltip au survol
      btn.onclick = () => {
        const input = document.getElementById('chatInput');
        if (input) {
          const current = input.value;
          input.value = current ? current + ' ' + text : text;
          input.focus();
          input.dispatchEvent(new Event('input'));
        }
      };
      chips.push(btn);
    });

    // Bouton lien caution
    if (data.depositUrl) {
      const btn = document.createElement('button');
      btn.className = 'qr-chip deposit';
      btn.innerHTML = '🔒 Envoyer lien caution';
      btn.onclick = async () => {
        const input = document.getElementById('chatInput');
        if (!input) return;
        btn.innerHTML = '⏳ Raccourcissement...';
        btn.disabled = true;
        try {
          const res = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(data.depositUrl)}`);
          const shortUrl = res.ok ? (await res.text()).trim() : data.depositUrl;
          const current = input.value;
          input.value = current ? current + ' ' + shortUrl : shortUrl;
          input.focus();
          input.dispatchEvent(new Event('input'));
        } catch(e) {
          const current = input.value;
          input.value = current ? current + ' ' + data.depositUrl : data.depositUrl;
          input.focus();
          input.dispatchEvent(new Event('input'));
        } finally {
          btn.innerHTML = '🔒 Envoyer lien caution';
          btn.disabled = false;
        }
      };
      chips.push(btn);
    }

    if (chips.length > 0) {
      chips.forEach(c => bar.appendChild(c));
      bar.style.display = 'flex';
    }
  } catch(e) {
    console.warn('Erreur loadQuickReplies:', e);
  }
}

console.log('✅ Chat owner initialized');
