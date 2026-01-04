/* ============================================
   💬 CHAT MODERNE - EMOJIS & PHOTOS (FIX v2)
   
   Version corrigée qui affiche les images dans les deux chats
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
  // 🎨 DÉTECTION AUTOMATIQUE
  // ============================================
  
  let inputContainer = null;
  let chatInput = null;
  let sendBtn = null;

  function detectChatStructure() {
    inputContainer = document.querySelector('.chat-modal-input') || 
                     document.querySelector('.chat-input-container');
    
    if (!inputContainer) return false;

    chatInput = document.getElementById('chatInput') || 
                document.getElementById('messageInput');
    
    if (!chatInput) return false;

    sendBtn = document.getElementById('sendBtn');
    
    if (!sendBtn) return false;

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

    if (document.getElementById('emojiPickerBtn')) {
      return;
    }

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'chat-input-actions';

    const emojiBtn = document.createElement('button');
    emojiBtn.id = 'emojiPickerBtn';
    emojiBtn.className = 'chat-action-btn';
    emojiBtn.type = 'button';
    emojiBtn.innerHTML = '😊';
    emojiBtn.title = 'Ajouter un emoji';
    emojiBtn.onclick = toggleEmojiPicker;

    const photoBtn = document.createElement('button');
    photoBtn.id = 'photoUploadBtn';
    photoBtn.className = 'chat-action-btn';
    photoBtn.type = 'button';
    photoBtn.innerHTML = '<i class="fas fa-image"></i>';
    photoBtn.title = 'Envoyer une photo';
    photoBtn.onclick = triggerPhotoUpload;

    const fileInput = document.createElement('input');
    fileInput.id = 'photoFileInput';
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    fileInput.onchange = handlePhotoSelect;

    actionsDiv.appendChild(emojiBtn);
    actionsDiv.appendChild(photoBtn);
    actionsDiv.appendChild(fileInput);

    inputContainer.insertBefore(actionsDiv, sendBtn);

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

    if (!file.type.startsWith('image/')) {
      if (typeof showToast === 'function') {
        showToast('Veuillez sélectionner une image', 'error');
      } else {
        alert('Veuillez sélectionner une image');
      }
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      if (typeof showToast === 'function') {
        showToast('Image trop volumineuse (max 5MB)', 'error');
      } else {
        alert('Image trop volumineuse (max 5MB)');
      }
      return;
    }

    showPhotoPreview(file);
  }

  function showPhotoPreview(file) {
    let previewContainer = document.getElementById('photoPreviewContainer');
    
    if (!previewContainer) {
      previewContainer = document.createElement('div');
      previewContainer.id = 'photoPreviewContainer';
      previewContainer.className = 'photo-preview-container';
      inputContainer.appendChild(previewContainer);
    }

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
      const formData = new FormData();
      formData.append('file', file);
      formData.append('upload_preset', 'chat-photos');

      const response = await fetch('https://api.cloudinary.com/v1_1/dvn95fhbx/image/upload', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error('Erreur upload');
      }

      const data = await response.json();
      uploadedPhotoUrl = data.secure_url;

      if (chatInput) {
        const imageTag = `[IMAGE:${uploadedPhotoUrl}]`;
        chatInput.value = (chatInput.value ? chatInput.value + '\n' : '') + imageTag;
        chatInput.focus();
      }

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
  // 🖼️ AFFICHAGE DES IMAGES - VERSION UNIVERSELLE
  // ============================================
  
  function createMessageWithImage(message) {
    const imageRegex = /\[IMAGE:(https?:\/\/[^\]]+)\]/g;
    let messageText = message.message || '';
    const images = [];
    
    let match;
    while ((match = imageRegex.exec(messageText)) !== null) {
      images.push(match[1]);
    }
    
    messageText = messageText.replace(imageRegex, '').trim();
    
    return { text: messageText, images: images };
  }

  // Surcharger appendMessage pour TOUS les chats
  const originalAppendMessage = window.appendMessage;
  
  if (originalAppendMessage) {
    window.appendMessage = function(message) {
      const parsed = createMessageWithImage(message);
      
      // Si pas d'image, utiliser la fonction originale
      if (parsed.images.length === 0) {
        return originalAppendMessage(message);
      }
      
      // Déterminer quel conteneur utiliser
      const container = document.getElementById('chatMessages') || 
                       document.getElementById('messagesContainer');
      
      if (!container) {
        console.warn('⚠️ Conteneur de messages non trouvé');
        return;
      }
      
      // Vider si message vide
      if (container.querySelector('p')) {
        container.innerHTML = '';
      }
      
      // Détecter le type de classe à utiliser
      const isOwnerChat = document.querySelector('.chat-modal');
      const messageClass = isOwnerChat ? 'chat-message' : 'message';
      const avatarClass = isOwnerChat ? 'chat-avatar' : 'message-avatar';
      const bubbleClass = isOwnerChat ? 'chat-bubble' : 'message-bubble';
      const senderClass = isOwnerChat ? 'chat-sender' : 'message-sender';
      const metaClass = isOwnerChat ? 'chat-meta' : 'message-meta';
      const timeClass = isOwnerChat ? 'chat-time' : 'message-time';
      const statusClass = isOwnerChat ? 'chat-status' : 'message-status';
      
      // Normaliser le sender_type
      let normalizedType = (message.sender_type || '').toLowerCase();
      
      const messageDiv = document.createElement('div');
      messageDiv.className = `${messageClass} ${normalizedType}`;
      
      const avatar = document.createElement('div');
      avatar.className = avatarClass;
      avatar.textContent = normalizedType === 'guest' ? 'V' : 
                          normalizedType === 'bot' ? '🤖' : 'P';
      
      const contentDiv = document.createElement('div');
      contentDiv.style.flex = '1';
      if (!isOwnerChat) {
        contentDiv.className = 'message-content';
      }
      
      const sender = document.createElement('div');
      sender.className = senderClass;
      sender.textContent = message.sender_name || 
                          (normalizedType === 'guest' ? 'Voyageur' : 
                           normalizedType === 'bot' ? 'Assistant' : 'Propriétaire');
      
      const bubble = document.createElement('div');
      bubble.className = bubbleClass;
      
      // Ajouter le texte
      if (parsed.text) {
        const textNode = document.createTextNode(parsed.text);
        bubble.appendChild(textNode);
      }
      
      // Ajouter les images
      parsed.images.forEach(imageUrl => {
        const img = document.createElement('img');
        img.src = imageUrl;
        img.className = 'chat-image';
        img.alt = 'Photo';
        img.style.maxWidth = '300px';
        img.style.maxHeight = '400px';
        img.style.borderRadius = '12px';
        img.style.marginTop = '8px';
        img.style.cursor = 'pointer';
        img.onclick = () => window.open(imageUrl, '_blank');
        bubble.appendChild(img);
      });
      
      const meta = document.createElement('div');
      meta.className = metaClass;
      
      const time = document.createElement('span');
      time.className = timeClass;
      time.textContent = typeof formatTime === 'function' ? 
                        formatTime(message.created_at) : '';
      
      const status = document.createElement('span');
      status.className = statusClass;
      status.textContent = (normalizedType === 'owner' || normalizedType === 'guest') ? 'Envoyé' : '';
      
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
    
    console.log('✅ appendMessage() surchargé pour supporter les images');
  }

  // Surcharger appendMessageSafe aussi (pour le chat voyageur)
  const originalAppendMessageSafe = window.appendMessageSafe;
  
  if (originalAppendMessageSafe) {
    window.appendMessageSafe = function(m) {
      // Juste appeler la nouvelle appendMessage
      window.appendMessage(m);
    };
    
    console.log('✅ appendMessageSafe() surchargé');
  }

  // ============================================
  // 🌍 FONCTIONS GLOBALES
  // ============================================
  
  window.closeEmojiPicker = closeEmojiPicker;
  window.cancelPhotoUpload = cancelPhotoUpload;

  // ============================================
  // 🚀 INITIALISATION
  // ============================================
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(initChatModern, 500);
    });
  } else {
    setTimeout(initChatModern, 500);
  }

  const originalOpenChat = window.openChat;
  if (originalOpenChat) {
    window.openChat = async function(...args) {
      await originalOpenChat(...args);
      setTimeout(initChatModern, 500);
    };
  }

  console.log('📦 Chat moderne v2 - Images fixes - Emojis & Photos chargé');

})();
