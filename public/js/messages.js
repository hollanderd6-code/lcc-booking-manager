// ========================================
// CONFIGURATION & STATE
// ========================================
const API_URL = 'https://lcc-booking-manager.onrender.com';
';
let allReservations = [];

const TEMPLATES = {
  'welcome': { icon: '👋', label: 'Bienvenue (J-7)' },
  'checkin-instructions': { icon: '🔑', label: 'Instructions (J-2)' },
  'reminder-checkin': { icon: '⏰', label: 'Rappel (J-1)' },
  'during-stay': { icon: '💬', label: 'Pendant séjour' },
  'checkout-reminder': { icon: '👋', label: 'Départ (Jour J)' },
  'post-stay': { icon: '⭐', label: 'Après séjour' }
};

// ========================================
// INITIALIZATION
// ========================================
document.addEventListener('DOMContentLoaded', async () => {
  console.log('💬 Messages Rapides - Initialisation...');
  
  await loadReservations();
  organizeReservations();
  
  console.log('✅ Messages initialisés');
});

// ========================================
// API CALLS
// ========================================
async function loadReservations() {
  showLoading();
  
  try {
    // 1) On récupère le token stocké au login
    const token = localStorage.getItem('lcc_token');

    // Pas de token -> on renvoie l’utilisateur au login
    if (!token) {
      console.warn('Aucun token trouvé, redirection vers la page de connexion');
      window.location.href = '/login.html';
      return;
    }

    // 2) Appel API avec l’en-tête Authorization
    const response = await fetch(`${API_URL}/api/reservations`, {
      headers: {
        Authorization: 'Bearer ' + token
      }
    });

    let data = {};
    try {
      data = await response.json();
    } catch (e) {
      console.error('Réponse non JSON /api/reservations :', e);
      data = {};
    }

    // 3) Gestion des erreurs HTTP
    if (!response.ok) {
      console.error('Réponse non OK /api/reservations:', response.status, data);

      // Si 401 -> token invalide ou expiré : on nettoie et on renvoie au login
      if (response.status === 401) {
        localStorage.removeItem('lcc_token');
        localStorage.removeItem('lcc_user');
        window.location.href = '/login.html';
        return;
      }

      allReservations = [];
      showToast(data.error || 'Erreur lors du chargement des réservations', 'error');
      return;
    }

    // 4) Succès : on stocke un tableau (même si vide)
    allReservations = Array.isArray(data.reservations) ? data.reservations : [];
    console.log(`📦 ${allReservations.length} réservation(s) chargée(s)`);
  } catch (error) {
    console.error('Erreur chargement:', error);
    allReservations = [];
    showToast('Erreur lors du chargement des réservations', 'error');
  } finally {
    hideLoading();
  }
}

async function generateMessage(reservationUid, templateKey) {
  try {
    const token = localStorage.getItem('lcc_token');

    const response = await fetch(`${API_URL}/api/messages/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      },
      body: JSON.stringify({
        reservationUid,
        templateKey
      })
    });

    return await response.json();
  } catch (error) {
    console.error('Erreur génération message:', error);
    return null;
  }
}


// ========================================
// RESERVATIONS ORGANIZATION
// ========================================
function organizeReservations() {
  // Sécurise au cas où allReservations serait undefined
  const reservations = Array.isArray(allReservations) ? allReservations : [];

  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const next7 = new Date(now);
  next7.setDate(next7.getDate() + 7);
  
  // Arrivées aujourd'hui
  const checkinsToday = allReservations.filter(r => {
    const checkin = new Date(r.start);
    return isSameDay(checkin, now);
  });
  
  // Arrivées demain
  const checkinsTomorrow = allReservations.filter(r => {
    const checkin = new Date(r.start);
    return isSameDay(checkin, tomorrow);
  });
  
  // Prochains 7 jours (après demain)
  const checkinsNext7 = allReservations.filter(r => {
    const checkin = new Date(r.start);
    const dayAfterTomorrow = new Date(tomorrow);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);
    return checkin > tomorrow && checkin <= next7;
  });
  
  // Séjours en cours
  const currentStays = allReservations.filter(r => {
    const checkin = new Date(r.start);
    const checkout = new Date(r.end);
    return checkin <= now && checkout >= now;
  });
  
  // Départs aujourd'hui
  const checkoutsToday = allReservations.filter(r => {
    const checkout = new Date(r.end);
    return isSameDay(checkout, now);
  });
  
  // Render each section
  renderSection('listToday', 'countToday', checkinsToday, 'reminder-checkin');
  renderSection('listTomorrow', 'countTomorrow', checkinsTomorrow, 'checkin-instructions');
  renderSection('listNext7', 'countNext7', checkinsNext7, 'welcome');
  renderSection('listCurrent', 'countCurrent', currentStays, 'during-stay');
  renderSection('listCheckouts', 'countCheckouts', checkoutsToday, 'checkout-reminder');
}

function renderSection(listId, countId, reservations, defaultTemplate) {
  const listEl = document.getElementById(listId);
  const countEl = document.getElementById(countId);
  
  countEl.textContent = reservations.length;
  
  if (reservations.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-check-circle"></i>
        <p>Aucune réservation dans cette catégorie</p>
      </div>
    `;
    return;
  }
  
  listEl.innerHTML = reservations.map(r => `
    <div class="reservation-item" style="border-left-color: ${r.property.color}">
      <div class="reservation-header">
        <div class="reservation-info">
          <h3>${r.property.name} - ${r.guestName}</h3>
          <div class="reservation-meta">
            <span><i class="fas fa-calendar"></i> ${formatDate(r.start)} → ${formatDate(r.end)}</span>
            <span><i class="fas fa-moon"></i> ${r.nights} nuit(s)</span>
            <span><i class="fas fa-tag"></i> ${r.source}</span>
          </div>
        </div>
      </div>
      
      <div class="template-selector" id="templates-${r.uid}">
        ${Object.entries(TEMPLATES).map(([key, tmpl]) => `
          <button class="template-btn ${key === defaultTemplate ? 'active' : ''}" 
                  onclick="selectTemplate('${r.uid}', '${key}')"
                  data-template="${key}">
            <span>${tmpl.icon}</span>
            <span>${tmpl.label}</span>
          </button>
        `).join('')}
      </div>
      
      <div class="message-preview" id="preview-${r.uid}" style="display: none;">
        <div class="message-subject" id="subject-${r.uid}"></div>
        <div class="message-body" id="body-${r.uid}"></div>
        <button class="copy-btn" onclick="copyMessage('${r.uid}')">
          <i class="fas fa-copy"></i>
          <span id="copy-text-${r.uid}">Copier le message</span>
        </button>
      </div>
    </div>
  `).join('');
  
  // Auto-load default template for first reservation
  if (reservations.length > 0) {
    selectTemplate(reservations[0].uid, defaultTemplate);
  }
}

// ========================================
// TEMPLATE MANAGEMENT
// ========================================
async function selectTemplate(reservationUid, templateKey) {
  // Update active button
  const container = document.getElementById(`templates-${reservationUid}`);
  container.querySelectorAll('.template-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.template === templateKey);
  });
  
  // Show preview
  const preview = document.getElementById(`preview-${reservationUid}`);
  const subjectEl = document.getElementById(`subject-${reservationUid}`);
  const bodyEl = document.getElementById(`body-${reservationUid}`);
  
  preview.style.display = 'block';
  subjectEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Génération...';
  bodyEl.textContent = '';
  
  // Generate message
  const message = await generateMessage(reservationUid, templateKey);
  
  if (message) {
    subjectEl.innerHTML = `<i class="fas fa-envelope"></i> ${message.subject}`;
    bodyEl.textContent = message.message;
  } else {
    subjectEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Erreur';
    bodyEl.textContent = 'Impossible de générer le message';
  }
}

async function copyMessage(reservationUid) {
  const subject = document.getElementById(`subject-${reservationUid}`).textContent;
  const body = document.getElementById(`body-${reservationUid}`).textContent;
  const copyBtn = document.getElementById(`copy-text-${reservationUid}`);
  
  const fullMessage = `${subject}\n\n${body}`;
  
  try {
    await navigator.clipboard.writeText(fullMessage);
    
    copyBtn.innerHTML = '<i class="fas fa-check"></i> Copié !';
    copyBtn.parentElement.classList.add('copied');
    
    setTimeout(() => {
      copyBtn.innerHTML = '<i class="fas fa-copy"></i> Copier le message';
      copyBtn.parentElement.classList.remove('copied');
    }, 2000);
    
    showToast('Message copié ! Collez-le dans Airbnb/Booking', 'success');
  } catch (error) {
    showToast('Erreur lors de la copie', 'error');
  }
}

// ========================================
// UTILITIES
// ========================================
function isSameDay(date1, date2) {
  return date1.getFullYear() === date2.getFullYear() &&
         date1.getMonth() === date2.getMonth() &&
         date1.getDate() === date2.getDate();
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short'
  });
}

function showLoading() {
  document.getElementById('loadingOverlay').classList.add('active');
}

function hideLoading() {
  document.getElementById('loadingOverlay').classList.remove('active');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  
  const icons = {
    success: 'fa-check-circle',
    error: 'fa-exclamation-circle',
    info: 'fa-info-circle'
  };
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <i class="fas ${icons[type]}"></i>
    <span class="toast-message">${message}</span>
  `;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideInRight 0.3s ease reverse';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
