// ============================================
// FIX MODAL CLAVIER iOS - JavaScript
// ============================================

/**
 * Amélioration de la fonction openChat
 * Ajoute la classe modal-open au body pour bloquer le scroll
 */
function openChatFixed(conversationId) {
  console.log('💬 Ouverture conversation:', conversationId);
  
  // Bloquer le scroll du body
  document.body.classList.add('modal-open');
  
  // Sauvegarder la position de scroll actuelle
  const scrollY = window.scrollY;
  document.body.style.top = `-${scrollY}px`;
  
  // Ouvrir le modal (logique existante)
  currentConversationId = conversationId;
  const chatModal = document.getElementById('chatModal');
  if (chatModal) {
    chatModal.classList.add('active');
  }
  
  // Charger les messages
  loadMessages(conversationId);
  
  // Marquer comme lu
  markAsRead(conversationId);
  
  // Rejoindre la room Socket.IO
  if (socket) {
    socket.emit('join_conversation', conversationId);
  }
  
  // Focus sur l'input après un délai pour laisser le modal s'ouvrir
  setTimeout(() => {
    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
      // Sur mobile, ne pas auto-focus pour éviter l'ouverture immédiate du clavier
      if (window.innerWidth > 768) {
        chatInput.focus();
      }
    }
  }, 300);
}

/**
 * Amélioration de la fonction closeChat
 * Retire la classe modal-open et restaure la position de scroll
 */
function closeChatFixed() {
  console.log('❌ Fermeture conversation');
  
  // Fermer le modal
  const chatModal = document.getElementById('chatModal');
  if (chatModal) {
    chatModal.classList.remove('active');
  }
  
  // Quitter la room Socket.IO
  if (socket && currentConversationId) {
    socket.emit('leave_conversation', currentConversationId);
  }
  
  currentConversationId = null;
  
  // Débloquer le scroll du body
  document.body.classList.remove('modal-open');
  
  // Restaurer la position de scroll
  const scrollY = document.body.style.top;
  document.body.style.top = '';
  if (scrollY) {
    window.scrollTo(0, parseInt(scrollY || '0') * -1);
  }
}

/**
 * Gestion du resize du viewport (clavier qui s'ouvre/ferme)
 * Scroll automatique vers le bas quand le clavier s'ouvre
 */
let lastHeight = window.innerHeight;

function handleViewportResize() {
  const currentHeight = window.innerHeight;
  const chatMessages = document.getElementById('chatMessages');
  
  // Si le viewport se réduit (clavier qui s'ouvre)
  if (currentHeight < lastHeight && chatMessages) {
    // Scroll vers le bas après un court délai
    setTimeout(() => {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }, 100);
  }
  
  lastHeight = currentHeight;
}

// Écouter les changements de taille du viewport
if (window.visualViewport) {
  // Méthode moderne pour iOS
  window.visualViewport.addEventListener('resize', handleViewportResize);
} else {
  // Fallback pour les anciens navigateurs
  window.addEventListener('resize', handleViewportResize);
}

/**
 * Empêcher le scroll sur le fond quand on scroll dans les messages
 */
document.addEventListener('DOMContentLoaded', () => {
  const chatModal = document.getElementById('chatModal');
  const chatMessages = document.getElementById('chatMessages');
  
  if (chatModal && chatMessages) {
    // Empêcher la propagation du scroll
    chatMessages.addEventListener('touchmove', (e) => {
      e.stopPropagation();
    }, { passive: true });
    
    // Empêcher le scroll sur l'overlay
    chatModal.addEventListener('touchmove', (e) => {
      if (e.target === chatModal) {
        e.preventDefault();
      }
    }, { passive: false });
  }
});

/**
 * Amélioration de l'auto-resize du textarea
 * avec meilleure gestion du scroll
 */
document.addEventListener('DOMContentLoaded', () => {
  const chatInput = document.getElementById('chatInput');
  
  if (chatInput) {
    chatInput.addEventListener('input', function() {
      // Reset de la hauteur
      this.style.height = 'auto';
      
      // Calculer la nouvelle hauteur (max 120px comme dans le CSS)
      const newHeight = Math.min(this.scrollHeight, 120);
      this.style.height = newHeight + 'px';
      
      // Si on est sur mobile et que le textarea grandit
      if (window.innerWidth <= 768 && newHeight > 44) {
        // Scroll vers le bas pour garder l'input visible
        const chatMessages = document.getElementById('chatMessages');
        if (chatMessages) {
          setTimeout(() => {
            chatMessages.scrollTop = chatMessages.scrollHeight;
          }, 50);
        }
      }
    });
  }
});

// ============================================
// EXPORT DES FONCTIONS AMÉLIORÉES
// ============================================
// Remplacer les fonctions existantes par les versions fixes
window.openChat = openChatFixed;
window.closeChat = closeChatFixed;

console.log('✅ Modal keyboard fix initialized');
