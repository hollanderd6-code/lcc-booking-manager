/* ============================================
   💬 CHAT MODERNE - EMOJIS & PHOTOS
   
   ⚠️ Charger ce fichier APRÈS chat-owner.js
   Ajoute les fonctionnalités sans modifier l'existant
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
  // 🎨 CRÉATION DE L'INTERFACE
  // ============================================
  
  function initChatModern() {
    const inputContainer = document.querySelector('.chat-modal-input');
    if (!inputContainer) {
      console.warn('⚠️ Chat input container not found');
      return;
    }

    // Vérifier si déjà initialisé
    if (document.getElementById('emojiPickerBtn')) {
      return;
    }

    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');

    if (!chatInput || !sendBtn) {
      console.warn('⚠️ Chat input or send button not found');
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
    const inputContainer = document.querySelector('.chat-modal-input');
    
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
    const input = document.getElementById('chatInput');
    if (!input) return;

    const start = input.selectionStart;
    const end = input.selectionEnd;
    const text = input.value;

    input.value = text.substring(0, start) + emoji + text.substring(end);
    input.selectionStart = input.selectionEnd = start + emoji.length;
    input.focus();

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
      document.querySelector('.chat-modal-input').appendChild(previewContainer);
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
      formData.append('upload_preset', 'lcc-uploads'); // ⚠️ Remplace par ton preset Cloudinary

      // Upload vers Cloudinary
      const response = await fetch('https://api.cloudinary.com/v1_1/YOUR_CLOUD_NAME/image/upload', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error('Erreur upload');
      }

      const data = await response.json();
      uploadedPhotoUrl = data.secure_url;

      // Insérer l'URL dans le textarea
      const input = document.getElementById('chatInput');
      if (input) {
        const imageTag = `[IMAGE:${uploadedPhotoUrl}]`;
        input.value = (input.value ? input.value + '\n' : '') + imageTag;
        input.focus();
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
    const container = document.getElementById('chatMessages');
    
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
    document.addEventListener('DOMContentLoaded', initChatModern);
  } else {
    initChatModern();
  }

  // Réinitialiser quand le chat s'ouvre
  const originalOpenChat = window.openChat;
  if (originalOpenChat) {
    window.openChat = async function(...args) {
      await originalOpenChat(...args);
      // Attendre un peu que le DOM soit mis à jour
      setTimeout(initChatModern, 100);
    };
  }

  console.log('📦 Chat moderne - Emojis & Photos chargé');

})();
