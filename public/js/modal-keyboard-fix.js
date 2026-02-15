// ============================================
// SOLUTION ALTERNATIVE MOBILE
// Navigation plein écran au lieu de modal flottant
// ============================================

/**
 * Version améliorée de openChat pour mobile
 */
function openChatMobile(conversationId) {
  console.log('💬 Ouverture conversation (mode mobile):', conversationId);
  
  currentConversationId = conversationId;
  const conv = allConversations.find(c => c.id == conversationId);
  
  if (!conv) return;
  
  // Mettre à jour le titre
  const guestName = cleanGuestName(conv);
  const titleEl = document.getElementById('chatModalTitle');
  if (titleEl) {
    titleEl.textContent = guestName;
  }
  
  // Bloquer le scroll de la page principale
  document.body.classList.add('chat-open');
  document.documentElement.classList.add('chat-open');
  
  // Sauvegarder la position de scroll
  const scrollY = window.scrollY || window.pageYOffset;
  document.body.style.top = `-${scrollY}px`;
  
  // Afficher le modal en plein écran
  const modal = document.getElementById('chatModal');
  if (modal) {
    modal.classList.add('active');
  }
  
  // Charger les messages
  loadMessages(conversationId).then(() => {
    // Scroll vers le bas après chargement
    setTimeout(() => {
      scrollToBottom();
    }, 100);
  });
  
  // Marquer comme lu
  markMessagesAsRead(conversationId);
  
  // Rejoindre la room Socket.IO
  if (socket) {
    socket.emit('join_conversation', conversationId);
  }
  
  // Focus sur l'input après un délai (mais pas sur mobile pour éviter le clavier)
  if (window.innerWidth > 768) {
    setTimeout(() => {
      const chatInput = document.getElementById('chatInput');
      if (chatInput) chatInput.focus();
    }, 300);
  }
}

/**
 * Version améliorée de closeChat pour mobile
 */
function closeChatMobile() {
  console.log('❌ Fermeture conversation (mode mobile)');
  
  const modal = document.getElementById('chatModal');
  
  // Ajouter classe pour animation de sortie
  if (modal) {
    modal.parentElement?.classList.add('closing');
  }
  
  // Attendre la fin de l'animation
  setTimeout(() => {
    // Fermer le modal
    if (modal) {
      modal.classList.remove('active');
      modal.parentElement?.classList.remove('closing');
    }
    
    // Débloquer le scroll
    document.body.classList.remove('chat-open');
    document.documentElement.classList.remove('chat-open');
    
    // Restaurer la position de scroll
    const scrollY = document.body.style.top;
    document.body.style.top = '';
    if (scrollY) {
      window.scrollTo(0, parseInt(scrollY || '0') * -1);
    }
    
    // Quitter la room Socket.IO
    if (socket && currentConversationId) {
      socket.emit('leave_conversation', currentConversationId);
    }
    
    currentConversationId = null;
  }, 250); // Durée de l'animation
}

/**
 * Détection mobile et choix de la bonne fonction
 */
function isMobile() {
  return window.innerWidth <= 768;
}

/**
 * Wrapper intelligent qui choisit la bonne approche
 */
function openChatSmart(conversationId) {
  if (isMobile()) {
    openChatMobile(conversationId);
  } else {
    // Sur desktop, utiliser l'ancienne fonction
    openChatDesktop(conversationId);
  }
}

function closeChatSmart() {
  if (isMobile()) {
    closeChatMobile();
  } else {
    closeChatDesktop();
  }
}

/**
 * Version desktop (comportement modal classique)
 */
function openChatDesktop(conversationId) {
  currentConversationId = conversationId;
  const conv = allConversations.find(c => c.id == conversationId);
  
  if (!conv) return;
  
  const guestName = cleanGuestName(conv);
  const titleEl = document.getElementById('chatModalTitle');
  if (titleEl) {
    titleEl.textContent = guestName;
  }
  
  const modal = document.getElementById('chatModal');
  if (modal) {
    modal.classList.add('active');
  }
  
  loadMessages(conversationId);
  markMessagesAsRead(conversationId);
  
  if (socket) {
    socket.emit('join_conversation', conversationId);
  }
  
  setTimeout(() => {
    const chatInput = document.getElementById('chatInput');
    if (chatInput) chatInput.focus();
  }, 300);
}

function closeChatDesktop() {
  const modal = document.getElementById('chatModal');
  if (modal) {
    modal.classList.remove('active');
  }
  
  if (socket && currentConversationId) {
    socket.emit('leave_conversation', currentConversationId);
  }
  
  currentConversationId = null;
}

/**
 * Gestion du resize du viewport (clavier)
 * Scroll automatique quand le clavier s'ouvre
 */
if (window.visualViewport) {
  let lastHeight = window.visualViewport.height;
  
  window.visualViewport.addEventListener('resize', () => {
    const currentHeight = window.visualViewport.height;
    const chatMessages = document.getElementById('chatMessages');
    
    // Si le viewport se réduit (clavier s'ouvre)
    if (currentHeight < lastHeight && chatMessages && isMobile()) {
      // Scroll vers le bas
      setTimeout(() => {
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }, 100);
    }
    
    lastHeight = currentHeight;
  });
}

/**
 * Amélioration de l'auto-resize du textarea
 */
document.addEventListener('DOMContentLoaded', () => {
  const chatInput = document.getElementById('chatInput');
  
  if (chatInput) {
    chatInput.addEventListener('input', function() {
      this.style.height = 'auto';
      const newHeight = Math.min(this.scrollHeight, 120);
      this.style.height = newHeight + 'px';
      
      // Sur mobile, ajuster la zone de messages
      if (isMobile()) {
        const inputZone = document.querySelector('.chat-modal-input');
        if (inputZone) {
          const totalHeight = newHeight + 24; // padding
          inputZone.style.setProperty('--input-height', `${totalHeight}px`);
        }
      }
    });
  }
});

/**
 * Gestion du bouton retour Android
 */
document.addEventListener('backbutton', function(e) {
  if (currentConversationId) {
    e.preventDefault();
    closeChatSmart();
  }
}, false);

/**
 * Gestion de la touche Escape
 */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && currentConversationId) {
    closeChatSmart();
  }
});

// ============================================
// REMPLACER LES FONCTIONS GLOBALES
// ============================================
window.openChat = openChatSmart;
window.closeChat = closeChatSmart;

console.log('✅ Solution alternative mobile activée');
console.log('📱 Mode:', isMobile() ? 'Mobile (plein écran)' : 'Desktop (modal)');
