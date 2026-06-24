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

// ── Cache propriétés pour la résolution des raccourcis ────────
const _propertiesCache = {};

// ── Résolution des raccourcis {{variable}} ────────────────────
// Appelée avant l'envoi si le message contient {{ }}
async function resolveShortcuts(text, conv) {
  if (!text || (!text.includes('{{') && !text.includes('{'))) return text;

  const firstName  = conv.guest_first_name || (conv.guest_name || '').split(' ')[0] || '';
  const guestName  = [conv.guest_first_name, conv.guest_last_name].filter(Boolean).join(' ')
                     || conv.guest_name || 'Voyageur';
  const propName   = conv.property_name || '';

  const fmtDate = (iso) => {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric' }); }
    catch { return iso; }
  };

  const checkinDate  = fmtDate(conv.reservation_start_date);
  const checkoutDate = fmtDate(conv.reservation_end_date);

  // Infos logement depuis cache ou API
  let prop = {};
  if (conv.property_id) {
    if (_propertiesCache[conv.property_id]) {
      prop = _propertiesCache[conv.property_id];
    } else {
      try {
        const token = localStorage.getItem('lcc_token');
        const res = await fetch(`${API_URL}/api/properties/${conv.property_id}`, {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        if (res.ok) {
          const data = await res.json();
          prop = data.property || data || {};
          _propertiesCache[conv.property_id] = prop;
        }
      } catch (e) {
        console.warn('[SHORTCUTS] Propriété non chargée:', e.message);
      }
    }
  }

  const vars = {
    // Voyageur — double ET simple accolade
    '{{guest_name}}':        guestName,   '{guest_name}':        guestName,
    '{{nom}}':               guestName,   '{nom}':               guestName,
    '{{prenom}}':            firstName,   '{prenom}':            firstName,
    '{{first_name}}':        firstName,   '{first_name}':        firstName,
    '{{guest_first_name}}':  firstName,   '{guest_first_name}':  firstName,
    // Logement
    '{{property_name}}':     propName,    '{property_name}':     propName,
    '{{logement}}':          propName,    '{logement}':          propName,
    // Dates
    '{{checkin_date}}':      checkinDate, '{checkin_date}':      checkinDate,
    '{{checkout_date}}':    checkoutDate, '{checkout_date}':    checkoutDate,
    '{{date_arrivee}}':      checkinDate, '{date_arrivee}':      checkinDate,
    '{{arrivee}}':           checkinDate, '{arrivee}':           checkinDate,
    '{{date_depart}}':      checkoutDate, '{date_depart}':      checkoutDate,
    '{{depart}}':           checkoutDate, '{depart}':           checkoutDate,
    '{{arrival_date}}':      checkinDate, '{arrival_date}':      checkinDate,
    '{{departure_date}}':   checkoutDate, '{departure_date}':   checkoutDate,
    // Horaires
    '{{arrival_time}}':      prop.arrivalTime    || prop.arrival_time    || '', '{arrival_time}':      prop.arrivalTime    || prop.arrival_time    || '',
    '{{departure_time}}':    prop.departureTime  || prop.departure_time  || '', '{departure_time}':    prop.departureTime  || prop.departure_time  || '',
    '{{heure_arrivee}}':     prop.arrivalTime    || prop.arrival_time    || '', '{heure_arrivee}':     prop.arrivalTime    || prop.arrival_time    || '',
    '{{heure_depart}}':      prop.departureTime  || prop.departure_time  || '', '{heure_depart}':      prop.departureTime  || prop.departure_time  || '',
    '{{departureTime}}':     prop.departureTime  || prop.departure_time  || '', '{departureTime}':     prop.departureTime  || prop.departure_time  || '',
    '{{arrivalTime}}':       prop.arrivalTime    || prop.arrival_time    || '', '{arrivalTime}':       prop.arrivalTime    || prop.arrival_time    || '',
    // Accès
    '{{access_code}}':       prop.accessCode || prop.access_code || '', '{access_code}':  prop.accessCode || prop.access_code || '',
    '{{code_acces}}':        prop.accessCode || prop.access_code || '', '{code_acces}':   prop.accessCode || prop.access_code || '',
    '{{keybox_code}}':       prop.accessCode || prop.access_code || '', '{keybox_code}':  prop.accessCode || prop.access_code || '',
    // Wifi
    '{{wifi_name}}':         prop.wifiName || prop.wifi_name || '', '{wifi_name}':     prop.wifiName || prop.wifi_name || '',
    '{{wifi_password}}':     prop.wifiPassword || prop.wifi_password || '', '{wifi_password}': prop.wifiPassword || prop.wifi_password || '',
    '{{wifi_ssid}}':         prop.wifiName || prop.wifi_name || '', '{wifi_ssid}':     prop.wifiName || prop.wifi_name || '',
    '{{mot_de_passe_wifi}}': prop.wifiPassword || prop.wifi_password || '', '{mot_de_passe_wifi}': prop.wifiPassword || prop.wifi_password || '',
    '{{wifi_nom}}':          prop.wifiName || prop.wifi_name || '', '{wifi_nom}':      prop.wifiName || prop.wifi_name || '',
    '{{wifi_mdp}}':          prop.wifiPassword || prop.wifi_password || '', '{wifi_mdp}':      prop.wifiPassword || prop.wifi_password || '',
    // Livret — la route /api/properties/:id retourne welcomeBookUrl (camelCase)
    '{{welcome_book_url}}':  prop.welcomeBookUrl || prop.welcome_book_url || '', '{welcome_book_url}': prop.welcomeBookUrl || prop.welcome_book_url || '',
    '{{livret}}':            prop.welcomeBookUrl || prop.welcome_book_url || '', '{livret}':           prop.welcomeBookUrl || prop.welcome_book_url || '',
    '{{livret_url}}':        prop.welcomeBookUrl || prop.welcome_book_url || '', '{livret_url}':       prop.welcomeBookUrl || prop.welcome_book_url || '',
    // Adresse
    '{{address}}':           prop.address || '', '{address}': prop.address || '',
    '{{adresse}}':           prop.address || '', '{adresse}': prop.address || '',
  };

  let result = text;
  for (const [key, val] of Object.entries(vars)) {
    result = result.split(key).join(val);
  }
  // Les {{variables_inconnues}} restantes sont laissées telles quelles
  // pour que l'hôte puisse les voir et les corriger
  return result;
}

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

  // ── Pull to refresh sur la liste des conversations ──────────
  (function initPullToRefresh() {
    const listContainer = document.querySelector('.msgs-left') || document.getElementById('conversationsList');
    if (!listContainer) return;

    let startY = 0, pulling = false, indicator = null;

    const createIndicator = () => {
      const el = document.createElement('div');
      el.id = 'ptr-indicator';
      el.style.cssText = 'position:absolute;top:0;left:0;right:0;display:flex;align-items:center;justify-content:center;height:0;overflow:hidden;transition:height .2s;z-index:100;background:#F5F2EC;';
      el.innerHTML = '<div style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:#1A7A5E;"><i class="fas fa-sync-alt" id="ptr-icon"></i><span id="ptr-text">Tirer pour actualiser</span></div>';
      listContainer.style.position = 'relative';
      listContainer.insertBefore(el, listContainer.firstChild);
      return el;
    };

    listContainer.addEventListener('touchstart', (e) => {
      if (listContainer.scrollTop > 0) return;
      startY = e.touches[0].clientY;
      pulling = true;
    }, { passive: true });

    listContainer.addEventListener('touchmove', (e) => {
      if (!pulling) return;
      const dy = e.touches[0].clientY - startY;
      if (dy < 10) return;
      if (!indicator) indicator = createIndicator();
      const h = Math.min(dy * 0.4, 52);
      indicator.style.height = h + 'px';
      const icon = document.getElementById('ptr-icon');
      const text = document.getElementById('ptr-text');
      if (h > 40) {
        if (icon) { icon.style.transform = 'rotate(180deg)'; icon.style.transition = 'transform .2s'; }
        if (text) text.textContent = 'Relâcher pour actualiser';
      } else {
        if (icon) { icon.style.transform = 'rotate(0deg)'; }
        if (text) text.textContent = 'Tirer pour actualiser';
      }
    }, { passive: true });

    listContainer.addEventListener('touchend', async (e) => {
      if (!pulling || !indicator) { pulling = false; return; }
      const dy = e.changedTouches[0].clientY - startY;
      pulling = false;
      if (dy > 50) {
        // Déclencher le refresh
        const icon = document.getElementById('ptr-icon');
        const text = document.getElementById('ptr-text');
        if (icon) { icon.classList.add('fa-spin'); icon.style.transform = 'none'; }
        if (text) text.textContent = 'Actualisation…';
        indicator.style.height = '44px';
        // Haptic si dispo
        try { window.Capacitor?.Plugins?.Haptics?.impact({ style: 'LIGHT' }); } catch {}
        await loadConversations();
        // Mettre à jour le badge de la bottom bar
        try {
          const totalUnread = (window.allConversations || []).reduce((s, c) => s + (parseInt(c.unread_count) || 0), 0);
          // IDs possibles du badge selon les pages/composants
          ['msgBadgeMobile','msgBadgeDesktop','messageBadge','unreadCount','tabGuestsBadge'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.textContent = totalUnread || '0'; el.style.display = totalUnread > 0 ? '' : 'none'; }
          });
          // Badge dans la bottom bar mobile (géré par bh-layout.js / messages-badge-desktop-mobile.js)
          document.querySelectorAll('[id*="badge"][id*="essage"], [id*="Badge"][id*="essage"], .tab-badge, .nav-badge').forEach(el => {
            if (el.closest && el.closest('[href*="messages"], [onclick*="messages"]')) {
              el.textContent = totalUnread || '0';
            }
          });
          if (typeof window._refreshBadge === 'function') window._refreshBadge();
          if (typeof window.refreshMessagesBadge === 'function') window.refreshMessagesBadge();
        } catch(e) {}
        // Cacher l'indicateur
        indicator.style.height = '0';
        setTimeout(() => { indicator?.remove(); indicator = null; }, 300);
      } else {
        indicator.style.height = '0';
        setTimeout(() => { indicator?.remove(); indicator = null; }, 300);
      }
    }, { passive: true });
  })();

  // ── Auto-ouvrir une conversation depuis ?conv=ID dans l'URL ──
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const convIdParam = urlParams.get('conv');
    if (convIdParam) {
      const convId = parseInt(convIdParam, 10);
      if (!isNaN(convId)) {
        const tryOpenConv = async (attempts) => {
          const item = document.querySelector(`[data-conversation-id="${convId}"]`);
          if (item) {
            await openChat(convId);
            item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            item.classList.add('active');
            window.history.replaceState({}, '', window.location.pathname);
          } else if (attempts > 0) {
            setTimeout(() => tryOpenConv(attempts - 1), 300);
          }
        };
        setTimeout(() => tryOpenConv(10), 500);
      }
    }
  } catch (e) {
    console.warn('[chat-owner] Erreur auto-open conv:', e);
  }

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
      // Déclencher le popup de raccourcis si {{ détecté
      _checkShortcutTrigger(this);
    });

    // ── Résolution automatique des raccourcis au collage ──
    chatInput.addEventListener('paste', function() {
      const inputEl = this;
      setTimeout(async function() {
        const text = inputEl.value;
        if (!text || !text.includes('{')) return;
        const convId = currentConversationId || window.currentConversationId;
        if (!convId) return;
        const conv = (typeof allConversations !== 'undefined' ? allConversations : [])
          .find(c => c.id == convId);
        if (!conv) return;
        const resolved = await resolveShortcuts(text, conv);
        if (resolved !== text) {
          inputEl.value = resolved;
          inputEl.style.height = 'auto';
          inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
        }
      }, 50);
    });

    // ── Résolution automatique des raccourcis au collage ──────────
    chatInput.addEventListener('paste', function() {
      const inputEl = this;
      setTimeout(async function() {
        const text = inputEl.value;
        if (!text || (!text.includes('{') && !text.includes('{'))) return;
        const convId = currentConversationId || window.currentConversationId;
        if (!convId) return;
        const conv = (typeof allConversations !== 'undefined' ? allConversations : [])
          .find(c => c.id == convId);
        if (!conv) return;
        const resolved = await resolveShortcuts(text, conv);
        if (resolved !== text) {
          inputEl.value = resolved;
          inputEl.style.height = 'auto';
          inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
        }
      }, 50); // Attendre que le texte collé soit dans l'input
    });
    
    // Send on Ctrl+Enter or Shift+Enter, new line on Enter
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.shiftKey)) {
        e.preventDefault();
        sendMessageOwner();
      }
    });

    // Fermer le popup si Escape
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') _closeShortcutPopup();
    });
  }

  // Injecter le popup de raccourcis dans le DOM
  _injectShortcutPopup();
  
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
    const isCancelled = conv.status === 'cancelled';
    
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
    
    // ── Préparation du snippet du dernier message ──────────────
    const rawSnippet = conv.last_message || '';
    const cleanSnippet = rawSnippet
      .replace(/\{[^}]+\}/g, '')           // supprimer les variables non résolues
      .replace(/https?:\/\/\S+/g, '🔗 Lien') // remplacer les URLs par un label
      .replace(/\s+/g, ' ').trim();
    const snippet = cleanSnippet.length > 72 ? cleanSnippet.substring(0, 72) + '…' : cleanSnippet;
    const isUnread = unreadCount > 0;

    return `
      <div class="conversation-item ${isUnread ? 'conv-unread' : ''} ${isCancelled ? 'conv-cancelled' : ''}" data-conversation-id="${conv.id}" onclick="openChat(${conv.id})" style="${isCancelled ? 'opacity:.62;' : ''}">

        <!-- Avatar avec indicateur non-lu -->
        <div style="position:relative;flex-shrink:0;">
          <div class="conversation-avatar" style="background: ${getPlatformColor(conv.platform)};">
            ${guestInitial}
          </div>
          ${isUnread ? `<div style="position:absolute;bottom:0;right:0;width:11px;height:11px;border-radius:50%;background:#1A7A5E;border:2px solid white;"></div>` : ''}
        </div>

        <div class="conversation-content">
          <!-- Ligne 1 : Nom + heure + badge -->
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1px;">
            <h3 style="font-size:13.5px;font-weight:${isUnread ? '800' : '600'};color:${isUnread ? '#0D1117' : '#374151'};margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:62%;font-family:'DM Sans',sans-serif;">${isCancelled ? '<span style="display:inline-block;font-size:9.5px;font-weight:800;color:#DC2626;background:#FEF2F2;border:1px solid #FECACA;border-radius:5px;padding:1px 5px;margin-right:5px;vertical-align:middle;">⊘ ANNULÉ</span>' : ''}${guestName}</h3>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;">
              <span style="font-size:11px;color:${isUnread ? '#1A7A5E' : '#B0BAC5'};font-weight:${isUnread ? '600' : '400'};white-space:nowrap;">${lastMessageTime}</span>
              ${unreadCount > 0 ? `<span style="min-width:18px;height:18px;padding:0 5px;background:#1A7A5E;color:#fff;font-size:10px;font-weight:700;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;">${unreadCount}</span>` : ''}
            </div>
          </div>

          <!-- Ligne 2 : Logement · Date · Plateforme -->
          <div style="display:flex;align-items:center;gap:5px;margin-bottom:3px;overflow:hidden;">
            <span style="font-size:11px;font-weight:600;color:${conv.property_color || '#10B981'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px;">${conv.property_name || 'Logement'}</span>
            <span style="font-size:10px;color:#CBD5E1;flex-shrink:0;">·</span>
            <span style="font-size:11px;color:#94A3B8;white-space:nowrap;flex-shrink:0;">${checkinDate}</span>
            <span style="font-size:10px;color:#CBD5E1;flex-shrink:0;">·</span>
            ${(conv.platform || '').toLowerCase().includes('boostinghost') || (conv.platform || '').toLowerCase().includes('guest')
              ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:11px;color:#7C3AED;font-weight:700;white-space:nowrap;flex-shrink:0;"><span style="display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;background:#7C3AED;border-radius:3px;color:white;font-size:9px;font-weight:900;font-family:'DM Sans',sans-serif;">B</span>BOOSTINGHOST GUEST</span>`
              : `<span style="font-size:11px;color:${platformColor};font-weight:600;white-space:nowrap;flex-shrink:0;"><i class="fas ${platformIcon}" style="font-size:9px;margin-right:2px;"></i>${(conv.platform || 'direct').toUpperCase()}</span>`
            }
          </div>

          <!-- Ligne 3 : Aperçu dernier message -->
          ${snippet ? `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
            <p style="font-size:12px;color:${isUnread ? '#374151' : '#94A3B8'};font-weight:${isUnread ? '500' : '400'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0;flex:1;font-family:'DM Sans',sans-serif;">${snippet}</p>
            ${isUnread ? `<div style="width:8px;height:8px;border-radius:50%;background:#1A7A5E;flex-shrink:0;"></div>` : ''}
          </div>` : ''}

          <!-- Éléments cachés pour compatibilité (delete, status, unread-badge, meta) -->
          <div class="conversation-actions" style="display:none;">
            <button class="btn-delete-conversation" onclick="deleteConversation(${conv.id}, event)" title="Supprimer"><i class="fas fa-trash"></i></button>
          </div>
          <div class="status-badge ${statusClass}" style="display:none;">${statusLabel}</div>
<!-- unread-badge supprimé -->
          <div class="meta" style="display:none;"></div>
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
  if (p.includes('boostinghost') || p.includes('guest')) return 'fa-bolt';
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
  // BHGuest
  if (p.includes('boostinghost') || p.includes('guest')) return '#7C3AED';
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
  // Exception : sur messages.html, rester en mode inline même sur mobile
  const isMessagesPage = !!document.getElementById('msgsChatPlaceholder');
  if (isMobileDevice() && !isMessagesPage) {
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
  window.currentConversationId = conversationId;
  window.currentConversationId = conversationId; // sync avec messages.html
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
  if (titleEl) {
    if (conv.status === 'cancelled') {
      const safeName = String(fullName).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      titleEl.innerHTML = '<span style="display:inline-block;font-size:10px;font-weight:800;color:#DC2626;background:#FEF2F2;border:1px solid #FECACA;border-radius:5px;padding:1px 6px;margin-right:6px;vertical-align:middle;">⊘ ANNULÉ</span>' + safeName;
    } else {
      titleEl.textContent = fullName;
    }
  }

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
  
  // ✅ BLOQUER LE SCROLL DU BODY (FIX iOS) — seulement si pas en mode inline (messages.html)
  if (!document.getElementById('msgsChatPlaceholder')) {
    document.body.classList.add('modal-open');
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.height = '100%';
    document.documentElement.style.overflow = 'hidden';
  }
  
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
  
  // ✅ Trier par created_at ASC — les messages sans date valide vont à la fin
  const sorted = [...messages].sort((a, b) => {
    const tA = a.created_at ? new Date(a.created_at).getTime() : Infinity;
    const tB = b.created_at ? new Date(b.created_at).getTime() : Infinity;
    return tA - tB;
  });

  // ✅ Filtrer les messages sans date ET sans contenu (artefacts vides)
  const filtered = sorted.filter(msg => {
    const hasDate = msg.created_at && !isNaN(new Date(msg.created_at).getTime());
    const hasContent = (msg.message || '').trim().length > 0;
    if (!hasDate && !hasContent) return false;
    return true;
  });

  filtered.forEach(msg => appendMessage(msg));

  // ✅ Nettoyer les divs .chat-message sans contenu (artefacts DOM)
  setTimeout(() => {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    container.querySelectorAll('.chat-message').forEach(el => {
      // Vérifier .chat-text OU .chat-bubble OU data-ts — si rien → artefact
      const textEl = el.querySelector('.chat-text, .chat-bubble');
      const hasText = textEl && textEl.textContent?.trim().length > 0;
      const hasTs = !!el.getAttribute('data-ts');
      const hasContent = el.querySelector('img, a, .chat-bubble');
      if (!hasText && !hasTs && !hasContent) el.remove();
    });
    scrollToBottom();
  }, 100);
}

function appendMessage(message) {
  const container = document.getElementById('chatMessages');
  if (!container) return;

  // ── Anti-doublon : ne pas afficher deux fois le même message ──
  if (message.id && container.querySelector(`[data-msg-id="${message.id}"]`)) {
    console.log(`⏭️ [CHAT] Message ${message.id} déjà affiché — skip`);
    return;
  }

  // ── Note système d'information (résa directe : canal e-mail/SMS) ──
  if (message.sender_type === 'system' && message.sender_name === 'BH_INFO') {
    const noteDiv = document.createElement('div');
    if (message.id) noteDiv.setAttribute('data-msg-id', message.id);
    noteDiv.style.cssText = 'max-width:88%;margin:10px auto;padding:10px 14px;'
      + 'background:#FFF7E6;border:1px solid #FFE0A3;border-radius:12px;'
      + 'color:#7A5B16;font-size:12.5px;line-height:1.45;text-align:center;';
    noteDiv.textContent = message.message || '';
    container.appendChild(noteDiv);
    scrollToBottom();
    return;
  }

  const isOwner = message.sender_type === 'owner' || message.sender_type === 'property' || message.sender_type === 'bot' || message.sender_type === 'system';
  
  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${isOwner ? 'owner' : 'guest'}`;
  if (message.id) messageDiv.setAttribute('data-msg-id', message.id);
  if (message.created_at) {
    messageDiv.setAttribute('data-ts', new Date(message.created_at).getTime());
  }
  
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
  const _ts = message.created_at || message.timestamp || message.sent_at || null;
  time.textContent = _ts ? formatTime(_ts) : '';
  
  const status = document.createElement('span');
  status.className = 'chat-status';
  const _isOwnerMsg = message.sender_type === 'owner' || message.sender_type === 'property' || message.sender_type === 'bot' || message.sender_type === 'system';
  status.textContent = _isOwnerMsg ? 'Envoyé' : '';
  
  meta.appendChild(time);
  meta.appendChild(status);
  
  contentDiv.appendChild(sender);
  contentDiv.appendChild(bubble);
  contentDiv.appendChild(meta);
  
  // ── Bouton traduction ───────────────────────────────────────────────────
  // Affiché sur : messages voyageur + messages bot/propriétaire (pour voir la traduction en FR)
  const msgTextOnly = (message.message || '').replace(/\[IMAGE:[^\]]+\]/g, '').trim();
  const isBotOrOwner = message.sender_type === 'property' || message.sender_type === 'bot' || message.sender_type === 'system';
  const showTxBtn = msgTextOnly && (!isOwner || isBotOrOwner);

  if (showTxBtn) {
    // Détecter la langue source du message pour afficher le bon drapeau
    const FLAGS = {
      fr: '🇫🇷', en: '🇬🇧', pt: '🇵🇹', es: '🇪🇸',
      de: '🇩🇪', it: '🇮🇹', nl: '🇳🇱', ru: '🇷🇺',
      zh: '🇨🇳', ja: '🇯🇵', ko: '🇰🇷', ar: '🇸🇦',
    };

    function detectMsgLang(text) {
      const t = text.toLowerCase();
      const scores = {
        pt: (t.match(/\b(olá|ola|obrigado|obrigada|por favor|onde|quando|posso|quero|preciso|senha|bom dia|boa tarde|boa noite|como|entrada|saída)\b/g) || []).length,
        en: (t.match(/\b(hello|hi|hey|thanks|thank you|please|what|where|when|how|can|could|would|wifi|password|check|arrival|departure|need|want)\b/g) || []).length,
        es: (t.match(/\b(hola|gracias|por favor|dónde|cuándo|puedo|quiero|necesito|contraseña|llegada|salida|buenos días)\b/g) || []).length,
        de: (t.match(/\b(hallo|hei|danke|bitte|wo|wann|wie|was|kann|möchte|passwort|ankunft|abreise|guten)\b/g) || []).length,
        it: (t.match(/\b(ciao|grazie|dove|quando|posso|vorrei|ho bisogno|indirizzo|arrivo|partenza|buongiorno)\b/g) || []).length,
        nl: (t.match(/\b(hallo|hoi|bedankt|dank|alsjeblieft|waar|wanneer|kan|wil|wachtwoord|aankomst|vertrek)\b/g) || []).length,
        fr: (t.match(/\b(bonjour|bonsoir|merci|où|quand|comment|puis-je|voudrais|besoin|arrivée|départ|nous|vous|je|salut)\b/g) || []).length,
      };
      const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
      return best[1] >= 1 ? best[0] : 'en';
    }

    const srcLang = isBotOrOwner ? 'bot' : detectMsgLang(msgTextOnly);
    const srcFlag = FLAGS[srcLang] || '🌐';
    const dstFlag = '🇫🇷';

    const txBar = document.createElement('div');
    txBar.className = 'tx-bar';

    const txBtn = document.createElement('button');
    txBtn.className = 'tx-chip';
    txBtn.innerHTML = `<span class="tx-flags">${srcFlag}→${dstFlag}</span><span class="tx-label">Traduire</span>`;
    txBtn.setAttribute('data-original', message.message);
    txBtn.setAttribute('data-translated', '');
    txBtn.setAttribute('data-state', 'original');

    txBtn.addEventListener('click', async function() {
      const state = txBtn.getAttribute('data-state');
      const original = txBtn.getAttribute('data-original');

      if (state === 'translated') {
        bubble.textContent = original;
        txBtn.innerHTML = `<span class="tx-flags">${srcFlag}→${dstFlag}</span><span class="tx-label">Traduire</span>`;
        txBtn.setAttribute('data-state', 'original');
        txBtn.classList.remove('translated');
        return;
      }

      const cached = txBtn.getAttribute('data-translated');
      if (cached) {
        bubble.textContent = cached;
        txBtn.innerHTML = `<span class="tx-flags">${dstFlag}→${srcFlag}</span><span class="tx-label">Original</span>`;
        txBtn.setAttribute('data-state', 'translated');
        txBtn.classList.add('translated');
        return;
      }

      txBtn.innerHTML = '<span class="tx-flags">⏳</span><span class="tx-label">...</span>';
      txBtn.setAttribute('data-state', 'loading');
      txBtn.disabled = true;

      try {
        const translated = await chatTranslate(original, 'fr');
        txBtn.setAttribute('data-translated', translated);
        bubble.textContent = translated;
        txBtn.innerHTML = `<span class="tx-flags">${dstFlag}→${srcFlag}</span><span class="tx-label">Original</span>`;
        txBtn.setAttribute('data-state', 'translated');
        txBtn.classList.add('translated');
      } catch(e) {
        txBtn.innerHTML = `<span class="tx-flags">${srcFlag}→${dstFlag}</span><span class="tx-label">Traduire</span>`;
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

// ── Traduction via DeepL (proxy backend) ────────────────────────────────
const _txCache = {};
async function chatTranslate(text, targetLang) {
  // targetLang : 'fr' (→ français) ou 'en' (→ anglais)
  const deeplTarget = targetLang === 'fr' ? 'FR' : 'EN-GB';
  const key = deeplTarget + '|' + text.slice(0, 60);
  if (_txCache[key]) return _txCache[key];

  try {
    const r = await fetch(`${API_URL}/api/translate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (localStorage.getItem('lcc_token') || '')
      },
      body: JSON.stringify({ text, target_lang: deeplTarget })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    const translated = d.translated || d.text || d.translation;
    if (!translated) throw new Error('Pas de traduction retournée');
    _txCache[key] = translated;
    return translated;
  } catch (err) {
    console.warn('⚠️ [TRANSLATE] Erreur DeepL backend:', err.message);
    // Fallback MyMemory si le backend échoue
    const langMap = { fr: 'en|fr', en: 'fr|en' };
    const langpair = langMap[targetLang] || 'en|fr';
    const r2 = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0,450))}&langpair=${langpair}`);
    const d2 = await r2.json();
    if (d2.responseStatus === 200) {
      _txCache[key] = d2.responseData.translatedText;
      return _txCache[key];
    }
    throw new Error('Translation failed');
  }
}

// Langue du proprio (sauvegardée dans localStorage)
function setOwnerLang(lang) {
  localStorage.setItem('owner_lang', lang);
}

async function sendMessageOwner() {
  const input = document.getElementById('chatInput');
  // Sur messages.html, currentConversationId est dans window — fallback
  if (!currentConversationId && window.currentConversationId) {
    currentConversationId = window.currentConversationId;
  }
  if (!currentChannexBookingId && window._currentChannexBookingId) {
    currentChannexBookingId = window._currentChannexBookingId;
  }
  if (!input || !currentConversationId) return;

  let message = input.value.trim();
  if (!message) return;

  // ── Résoudre les raccourcis {{variable}} avant l'envoi ──
  if (message.includes('{{') || message.includes('{')) {
    const conv = allConversations.find(c => c.id == currentConversationId);
    if (conv) {
      const resolved = await resolveShortcuts(message, conv);
      if (resolved !== message) {
        // Afficher un aperçu avant envoi si des variables ont été remplacées
        message = resolved;
        input.value = resolved;
      }
    }
  }

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
      const data = await response.json();
      input.value = '';
      input.style.height = 'auto';
      // Afficher immédiatement le message avec son vrai id (pas de doublon possible via socket)
      const savedMsg = data.message || { content: message, sender_type: 'property', created_at: new Date().toISOString(), id: 'tmp_' + Date.now() };
      appendMessage({ ...savedMsg, sender_type: 'owner' });
      scrollToBottom();
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

  // Trier les messages Channex par date avant injection
  const sorted = [...channexMsgs].sort((a, b) => {
    const tA = a.inserted_at ? new Date(a.inserted_at).getTime() : 0;
    const tB = b.inserted_at ? new Date(b.inserted_at).getTime() : 0;
    return tA - tB;
  });

  sorted.forEach(m => {
    if (!m.id || !m.message) return; // ignorer les messages vides/invalides
    if (chatEl.querySelector(`[data-channex-id="${m.id}"]`)) return;
    const isGuest = m.sender === 'guest';
    const ts = m.inserted_at ? new Date(m.inserted_at).getTime() : 0;
    const time = m.inserted_at
      ? new Date(m.inserted_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      : '';
    const div = document.createElement('div');
    div.className = `chat-message${isGuest ? '' : ' owner'}`;
    div.setAttribute('data-channex-id', m.id);
    div.setAttribute('data-ts', ts); // ✅ Ajouter data-ts pour le tri
    div.innerHTML = `
      <div class="chat-bubble">
        <div class="chat-sender">${isGuest ? 'Voyageur' : 'Vous'} <span style="font-size:10px;opacity:.6;">· via plateforme</span></div>
        <div class="chat-text">${m.message}</div>
        <div class="chat-time">${time}</div>
      </div>`;

    // Insérer au bon endroit chronologiquement
    if (ts > 0) {
      const allMsgs = Array.from(chatEl.children);
      let inserted = false;
      for (const existing of allMsgs) {
        const existingTs = parseInt(existing.getAttribute('data-ts') || '0');
        if (existingTs > 0 && ts < existingTs) {
          chatEl.insertBefore(div, existing);
          inserted = true;
          break;
        }
      }
      if (!inserted) chatEl.appendChild(div);
    } else {
      chatEl.appendChild(div);
    }
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
    // Retry après injection des messages Channex (asynchrone)
    setTimeout(() => {
      container.scrollTop = container.scrollHeight;
    }, 500);
    setTimeout(() => {
      container.scrollTop = container.scrollHeight;
    }, 1200);
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
  // ⚠️ Ne PAS ajouter de div ici : le message est déjà affiché via 'new_message'.
  // On garde seulement la mise à jour du badge + le toast.
  socket.on('new_platform_message', (data) => {
    console.log('💬 [CHANNEX] Message plateforme reçu (toast uniquement):', data);

    // Recharger la liste des conversations (badge non-lu)
    loadConversations();

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
window.displayMessages = displayMessages;
window.loadMessages = loadMessages;
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

    // Bouton lien caution — masqué pour Airbnb (caution gérée par la plateforme)
    const _convForDeposit = window.currentChatConv || {};
    const _platDeposit = (_convForDeposit.platform || '').toLowerCase().replace(/[_\-\s]/g, '');
    const _isAirbnbConv = _platDeposit.includes('airbnb') || _platDeposit === 'abb';
    if (data.depositUrl && !_isAirbnbConv) {
      const btn = document.createElement('button');
      btn.className = 'qr-chip deposit';
      btn.innerHTML = '🔒 Envoyer lien caution';
      btn.onclick = async () => {
        const input = document.getElementById('chatInput');
        if (!input) return;
        btn.innerHTML = '⏳...';
        btn.disabled = true;
        try {
          // Utiliser notre propre endpoint de lien court (domaine boostinghost.fr)
          const token = localStorage.getItem('lcc_token');
          const r = await fetch(`${API_URL}/api/short-link`, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: data.depositUrl })
          });
          const d = r.ok ? await r.json() : null;
          const shortUrl = d?.shortUrl || data.depositUrl;
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

// ============================================================
// POPUP RACCOURCIS {{variables}}
// Apparaît quand l'hôte tape {{ dans le textarea
// ============================================================
const SHORTCUTS_LIST = [
  { key: '{{guest_name}}',       label: 'Nom du voyageur',       icon: '👤' },
  { key: '{{prenom}}',           label: 'Prénom du voyageur',     icon: '👤' },
  { key: '{{property_name}}',    label: 'Nom du logement',        icon: '🏠' },
  { key: '{{checkin_date}}',     label: "Date d'arrivée",         icon: '📅' },
  { key: '{{checkout_date}}',    label: 'Date de départ',         icon: '📅' },
  { key: '{{arrival_time}}',     label: "Heure d'arrivée",        icon: '⏰' },
  { key: '{{departure_time}}',   label: 'Heure de départ',        icon: '⏰' },
  { key: '{{access_code}}',      label: "Code d'accès",           icon: '🔑' },
  { key: '{{wifi_name}}',        label: 'Nom du WiFi',            icon: '📶' },
  { key: '{{wifi_password}}',    label: 'Mot de passe WiFi',      icon: '📶' },
  { key: '{{welcome_book_url}}', label: 'Lien livret d\'accueil', icon: '📖' },
  { key: '{{adresse}}',          label: 'Adresse du logement',    icon: '📍' },
];

function _injectShortcutPopup() {
  if (document.getElementById('shortcutPopup')) return;
  const popup = document.createElement('div');
  popup.id = 'shortcutPopup';
  popup.style.cssText = [
    'position:absolute',
    'bottom:100%',
    'left:0',
    'right:0',
    'background:white',
    'border:1px solid rgba(200,184,154,.4)',
    'border-radius:12px',
    'box-shadow:0 -4px 24px rgba(13,17,23,.12)',
    'max-height:220px',
    'overflow-y:auto',
    'z-index:9999',
    'display:none',
    'margin-bottom:6px',
  ].join(';');
  // Insérer dans le parent du textarea
  const chatInput = document.getElementById('chatInput');
  if (chatInput && chatInput.parentElement) {
    chatInput.parentElement.style.position = 'relative';
    chatInput.parentElement.insertBefore(popup, chatInput);
  } else {
    document.body.appendChild(popup);
  }
}

function _checkShortcutTrigger(input) {
  const val = input.value;
  const cursor = input.selectionStart;
  const before = val.substring(0, cursor);
  const match = before.match(/\{\{([^}]*)$/);

  const popup = document.getElementById('shortcutPopup');
  if (!popup) return;

  if (!match) { _closeShortcutPopup(); return; }

  const query = match[1].toLowerCase();
  const filtered = SHORTCUTS_LIST.filter(s =>
    s.key.toLowerCase().includes(query) ||
    s.label.toLowerCase().includes(query)
  );

  if (!filtered.length) { _closeShortcutPopup(); return; }

  popup.innerHTML = filtered.map((s, i) => `
    <div class="shortcut-item" data-key="${s.key}"
      style="display:flex;align-items:center;gap:10px;padding:9px 14px;cursor:pointer;font-size:13px;font-family:'DM Sans',sans-serif;border-bottom:1px solid rgba(200,184,154,.2);transition:background .1s;"
      onmouseenter="this.style.background='rgba(26,122,94,.06)'"
      onmouseleave="this.style.background=''"
      onmousedown="event.preventDefault();_selectShortcut('${s.key}')">
      <span style="font-size:16px;">${s.icon}</span>
      <div>
        <div style="font-weight:600;color:#0D1117;">${s.label}</div>
        <div style="font-size:11px;color:#7A8695;font-family:monospace;">${s.key}</div>
      </div>
    </div>
  `).join('');

  popup.style.display = 'block';
}

function _selectShortcut(key) {
  const input = document.getElementById('chatInput');
  if (!input) return;

  const val = input.value;
  const cursor = input.selectionStart;
  const before = val.substring(0, cursor);
  const after  = val.substring(cursor);

  // Remplacer le {{ partiel par la variable complète
  const newBefore = before.replace(/\{\{[^}]*$/, key);
  input.value = newBefore + after;

  // Replacer le curseur après la variable insérée
  const newCursor = newBefore.length;
  input.setSelectionRange(newCursor, newCursor);
  input.focus();
  input.dispatchEvent(new Event('input'));
  _closeShortcutPopup();
}

function _closeShortcutPopup() {
  const popup = document.getElementById('shortcutPopup');
  if (popup) popup.style.display = 'none';
}

// Fermer le popup si on clique ailleurs
document.addEventListener('click', (e) => {
  if (!e.target.closest('#shortcutPopup') && e.target.id !== 'chatInput') {
    _closeShortcutPopup();
  }
});

console.log('✅ Chat owner initialized');
