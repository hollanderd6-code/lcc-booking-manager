/* ============================================
   💬 CHAT MODERNE - EMOJIS & PHOTOS (UNIVERSEL)
   
   Version compatible avec :
   - Chat propriétaire (messages.html)
   - Chat voyageur (chat-guest.html)
   
   ⚠️ Charger ce fichier APRÈS le script principal du chat
   ============================================ */

(function() {
  'use strict';

  // ============================================
  // 😊 LISTE D'EMOJIS POPULAIRES
  // ============================================
  
  const EMOJIS = [
    '😊', '😃', '😄', '😁', '😆', '😅', '🤣', '😂',
    '🙂', '🙃', '😉', '😇', '🥰', '😍', '🤩', '😘',
    '😗', '☺️', '😚', '😙', '🥲', '😋', '😛', '😜',
    '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐',
    '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬',
    '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒',
    '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '😶‍🌫️', '😵',
    '🤯', '🤠', '🥳', '😎', '🤓', '🧐', '😕', '😟',
    '🙁', '☹️', '😮', '😯', '😲', '😳', '🥺', '😦',
    '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖',
    '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡',
    '😠', '🤬', '👍', '👎', '👌', '✌️', '🤞', '🤟',
    '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👏',
    '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💪', '🦾',
    '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍',
    '💔', '❤️‍🔥', '❤️‍🩹', '💕', '💞', '💓', '💗', '💖',
    '💘', '💝', '🎉', '🎊', '🎈', '🎁', '🏆', '🥇',
    '⭐', '✨', '💫', '🔥', '💯', '✅', '❌', '⚠️',
    '🏠', '🏡', '🏘️', '🏨', '🏩', '🏪', '🏫', '🏬',
    '🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑'
  ];

  // ============================================
  // 🎨 DÉTECTION AUTOMATIQUE DE LA STRUCTURE
  // ============================================
  
  let inputContainer = null;
  let chatInput = null;
  let sendBtn = null;

  function detectChatStructure() {
    // Chercher le conteneur
    inputContainer = document.querySelector('.chat-modal-input') || 
                     document.querySelector('.chat-input-container');
    
    if (!inputContainer) {
      console.warn('⚠️ Conteneur de chat non trouvé');
      return false;
    }

    // Chercher le textarea
    chatInput = document.getElementById('chatInput') || 
                document.getElementById('messageInput');
    
    if (!chatInput) {
      console.warn('⚠️ Input de chat non trouvé');
      return false;
    }

    // Chercher le bouton send
    sendBtn = document.getElementById('sendBtn');
    
    if (!sendBtn) {
      console.warn('⚠️ Bouton d\'envoi non trouvé');
      return false;
    }

    console.log('✅ Structure détectée:', {
      container: inputContainer.className,
      input: chatInput.id
    });

    return true;
  }

  // ============================================
  // 🎨 CRÉATION DE L'INTERFACE
  // ============================================
  
  function initChatModern() {
    if (!detectChatStructure()) {
      console.warn('⚠️ Impossible d\'initialiser le chat moderne');
      return;
    }

    // Vérifier si déjà initialisé
    if (document.getElementById('emojiPickerBtn')) {
      return;
    }

    // Créer le conteneur des actions
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'chat-input-actions';

    // Bouton emoji
    const emojiBtn = document.createElement('button');
    emojiBtn.id = 'emojiPickerBtn';
    emojiBtn.className = 'chat-action-btn';
    emojiBtn.type = 'button';
    emojiBtn.innerHTML = '😊';
    emojiBtn.title = 'Ajouter un emoji';
    emojiBtn.onclick = toggleEmojiPicker;

    // Bouton photo
    const photoBtn = document.createElement('button');
    photoBtn.id = 'photoUploadBtn';
    photoBtn.className = 'chat-action-btn';
    photoBtn.type = 'button';
    photoBtn.innerHTML = '<i class="fas fa-image"></i>';
    photoBtn.title = 'Envoyer une photo';
    photoBtn.onclick = triggerPhotoUpload;

    // Input file caché
    const fileInput = document.createElement('input');
    fileInput.id = 'photoFileInput';
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    fileInput.onchange = handlePhotoSelect;

    // Réorganiser
    actionsDiv.appendChild(emojiBtn);
    actionsDiv.appendChild(photoBtn);
    actionsDiv.appendChild(fileInput);

    // Insérer avant le bouton d'envoi
    inputContainer.insertBefore(actionsDiv, sendBtn);

    // Créer l'emoji picker
    createEmojiPicker();

    console.log('✅ Chat moderne initialisé');
  }

  // ============================================
  // 😊 EMOJI PICKER
  // ============================================
  
  function createEmojiPicker() {
    const picker = document.createElement('div');
    picker.id = 'emojiPicker';
    picker.className = 'emoji-picker';

    const header = document.createElement('div');
    header.className = 'emoji-picker-header';
    header.innerHTML = `
      <span>Emojis</span>
      <button class="emoji-picker-close" onclick="window.closeEmojiPicker()">
        <i class="fas fa-times"></i>
      </button>
    `;

    const grid = document.createElement('div');
    grid.className = 'emoji-picker-grid';

    EMOJIS.forEach(emoji => {
      const btn = document.createElement('button');
      btn.className = 'emoji-btn';
      btn.textContent = emoji;
      btn.onclick = () => insertEmoji(emoji);
      grid.appendChild(btn);
    });

    picker.appendChild(header);
    picker.appendChild(grid);
    inputContainer.appendChild(picker);
  }

  function toggleEmojiPicker() {
    const picker = document.getElementById('emojiPicker');
    if (picker) {
      picker.classList.toggle('active');
    }
  }

  function closeEmojiPicker() {
    const picker = document.getElementById('emojiPicker');
    if (picker) {
      picker.classList.remove('active');
    }
  }

  function insertEmoji(emoji) {
    if (!chatInput) return;

    const start = chatInput.selectionStart;
    const end = chatInput.selectionEnd;
    const text = chatInput.value;

    chatInput.value = text.substring(0, start) + emoji + text.substring(end);
    chatInput.selectionStart = chatInput.selectionEnd = start + emoji.length;
    chatInput.focus();

    closeEmojiPicker();
  }

  // ============================================
  // 📷 UPLOAD DE PHOTOS
  // ============================================
  
  let uploadedPhotoUrl = null;

  function triggerPhotoUpload() {
    const fileInput = document.getElementById('photoFileInput');
    if (fileInput) {
      fileInput.click();
    }
  }

  async function handlePhotoSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Vérifier que c'est une image
    if (!file.type.startsWith('image/')) {
      if (typeof showToast === 'function') {
        showToast('Veuillez sélectionner une image', 'error');
      } else {
        alert('Veuillez sélectionner une image');
      }
      return;
    }

    // Vérifier la taille (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      if (typeof showToast === 'function') {
        showToast('Image trop volumineuse (max 5MB)', 'error');
      } else {
        alert('Image trop volumineuse (max 5MB)');
      }
      return;
    }

    // Afficher preview et uploader
    showPhotoPreview(file);
  }

  function showPhotoPreview(file) {
    // Créer ou récupérer le conteneur de preview
    let previewContainer = document.getElementById('photoPreviewContainer');
    
    if (!previewContainer) {
      previewContainer = document.createElement('div');
      previewContainer.id = 'photoPreviewContainer';
      previewContainer.className = 'photo-preview-container';
      inputContainer.appendChild(previewContainer);
    }

    // Créer l'aperçu
    const reader = new FileReader();
    reader.onload = async (e) => {
      previewContainer.innerHTML = `
        <img src="${e.target.result}" class="photo-preview" alt="Preview">
        <div class="photo-preview-actions">
          <button class="photo-cancel-btn" onclick="window.cancelPhotoUpload()">
            <i class="fas fa-times"></i> Annuler
          </button>
          <button class="photo-send-btn" id="photoSendBtn">
            <i class="fas fa-cloud-upload"></i> Envoyer
          </button>
        </div>
        <div id="uploadProgress" style="margin-top: 8px; font-size: 12px; color: #6B7280; display: none;">
          <i class="fas fa-spinner fa-spin"></i> Upload en cours...
        </div>
      `;
      previewContainer.classList.add('active');

      // Bouton envoyer
      document.getElementById('photoSendBtn').onclick = () => uploadPhoto(file);
    };

    reader.readAsDataURL(file);
  }

  function cancelPhotoUpload() {
    const container = document.getElementById('photoPreviewContainer');
    if (container) {
      container.classList.remove('active');
      container.innerHTML = '';
    }
    
    // Reset file input
    const fileInput = document.getElementById('photoFileInput');
    if (fileInput) {
      fileInput.value = '';
    }
  }

  async function uploadPhoto(file) {
    const progressEl = document.getElementById('uploadProgress');
    const sendBtn = document.getElementById('photoSendBtn');
    
    if (progressEl) progressEl.style.display = 'block';
    if (sendBtn) sendBtn.disabled = true;

    try {
      // Créer FormData
      const formData = new FormData();
      formData.append('file', file);
      formData.append('upload_preset', 'chat-photos'); // ⚠️ TON PRESET

      // Upload vers Cloudinary
      const response = await fetch('https://api.cloudinary.com/v1_1/dvn95fhbx/image/upload', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error('Erreur upload');
      }

      const data = await response.json();
      uploadedPhotoUrl = data.secure_url;

      // Insérer l'URL dans le textarea
      if (chatInput) {
        const imageTag = `[IMAGE:${uploadedPhotoUrl}]`;
        chatInput.value = (chatInput.value ? chatInput.value + '\n' : '') + imageTag;
        chatInput.focus();
      }

      // Fermer la preview
      cancelPhotoUpload();

      if (typeof showToast === 'function') {
        showToast('Photo uploadée ! Cliquez sur Envoyer', 'success');
      }

    } catch (error) {
      console.error('❌ Erreur upload photo:', error);
      if (typeof showToast === 'function') {
        showToast('Erreur lors de l\'upload de la photo', 'error');
      } else {
        alert('Erreur lors de l\'upload de la photo');
      }
    } finally {
      if (progressEl) progressEl.style.display = 'none';
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  // ============================================
  // 🖼️ AFFICHAGE DES IMAGES DANS LES MESSAGES
  // ============================================
  
  // Surcharger appendMessage pour supporter les images
  const originalAppendMessage = window.appendMessage;
  
  if (originalAppendMessage) {
    window.appendMessage = function(message) {
      // Détecter si le message contient une image
      const imageRegex = /\[IMAGE:(https?:\/\/[^\]]+)\]/g;
      let messageText = message.message;
      const images = [];
      
      let match;
      while ((match = imageRegex.exec(messageText)) !== null) {
        images.push(match[1]);
      }
      
      // Si pas d'image, utiliser la fonction originale
      if (images.length === 0) {
        return originalAppendMessage(message);
      }
      
      // Supprimer les tags [IMAGE:...] du texte
      messageText = messageText.replace(imageRegex, '').trim();
      
      // Créer le message manuellement avec les images
      const container = document.getElementById('chatMessages') || 
                       document.getElementById('chatMessagesContainer');
      
      if (!container) return;
      
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
      
      // Ajouter le texte s'il existe
      if (messageText) {
        const textNode = document.createTextNode(messageText);
        bubble.appendChild(textNode);
      }
      
      // Ajouter les images
      images.forEach(imageUrl => {
        const img = document.createElement('img');
        img.src = imageUrl;
        img.className = 'chat-image';
        img.alt = 'Photo';
        img.onclick = () => window.open(imageUrl, '_blank');
        bubble.appendChild(img);
      });
      
      const meta = document.createElement('div');
      meta.className = 'chat-meta';
      
      const time = document.createElement('span');
      time.className = 'chat-time';
      time.textContent = typeof formatTime === 'function' ? formatTime(message.created_at) : '';
      
      const status = document.createElement('span');
      status.className = 'chat-status';
      status.textContent = (message.sender_type === 'owner') ? 'Envoyé' : '';
      
      meta.appendChild(time);
      meta.appendChild(status);
      
      contentDiv.appendChild(sender);
      contentDiv.appendChild(bubble);
      contentDiv.appendChild(meta);
      
      messageDiv.appendChild(avatar);
      messageDiv.appendChild(contentDiv);
      
      container.appendChild(messageDiv);
      
      if (typeof scrollToBottom === 'function') {
        scrollToBottom();
      }
    };
  }

  // ============================================
  // 🌍 FONCTIONS GLOBALES
  // ============================================
  
  window.closeEmojiPicker = closeEmojiPicker;
  window.cancelPhotoUpload = cancelPhotoUpload;

  // ============================================
  // 🚀 INITIALISATION
  // ============================================
  
  // Initialiser quand le DOM est prêt
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(initChatModern, 500); // Attendre un peu
    });
  } else {
    setTimeout(initChatModern, 500); // Attendre un peu
  }

  // Réinitialiser quand le chat s'ouvre (pour le chat propriétaire)
  const originalOpenChat = window.openChat;
  if (originalOpenChat) {
    window.openChat = async function(...args) {
      await originalOpenChat(...args);
      setTimeout(initChatModern, 500);
    };
  }

  console.log('📦 Chat moderne universel - Emojis & Photos chargé');

})();
