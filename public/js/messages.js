// ========================================
// CONFIGURATION & STATE
// ========================================
const API_URL = 'https://lcc-booking-manager.onrender.com';
let allReservations = [];

const TEMPLATES = {
  welcome: { icon: '👋', label: 'Bienvenue (J-7)' },
  'checkin-instructions': { icon: '🔑', label: 'Instructions (J-2)' },
  'reminder-checkin': { icon: '⏰', label: 'Rappel (J-1)' },
  'during-stay': { icon: '💬', label: 'Pendant séjour' },
  'checkout-reminder': { icon: '👋', label: 'Départ (Jour J)' },
  'post-stay': { icon: '⭐', label: 'Après séjour' }
};

// ========================================
// INIT
// ========================================
document.addEventListener('DOMContentLoaded', async () => {
  console.log('💬 Messages Rapides - Initialisation...');
  try {
    await loadReservations();
    organizeReservations();
    console.log('✅ Messages initialisés');
  } catch (error) {
    console.error('❌ Erreur init messages:', error);
  }
});

// ========================================
// HELPERS
// ========================================
function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short'
  });
}

// ========================================
// API CALLS
// ========================================
async function loadReservations() {
  showLoading();
  
  try {
    const token = localStorage.getItem('lcc_token');

    if (!token) {
      console.warn('Aucun token trouvé, redirection vers la page de connexion');
      window.location.href = '/login.html';
      return;
    }

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

    if (!response.ok) {
      console.error('Réponse non OK /api/reservations:', response.status, data);

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

    if (!response.ok) {
      console.error('Réponse non OK /api/messages/generate:', response.status);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('Erreur génération message:', error);
    return null;
  }
}

// ========================================
// ORGANISATION DES RÉSERVATIONS
// ========================================
function getReservationStart(reservation) {
  return (
    reservation.start ||
    reservation.startDate ||
    reservation.checkIn ||
    reservation.checkin ||
    null
  );
}

function getReservationEnd(reservation) {
  return (
    reservation.end ||
    reservation.endDate ||
    reservation.checkOut ||
    reservation.checkout ||
    null
  );
}

function organizeReservations() {
  const reservations = Array.isArray(allReservations) ? allReservations : [];

  console.log('📊 Organisation des réservations, total =', reservations.length);

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const next7 = new Date(now);
  next7.setDate(next7.getDate() + 7);

  const checkinsToday = reservations.filter(r => {
    const raw = getReservationStart(r);
    if (!raw) return false;
    const d = new Date(raw);
    d.setHours(0, 0, 0, 0);
    return d.getTime() === now.getTime();
  });

  const checkinsTomorrow = reservations.filter(r => {
    const raw = getReservationStart(r);
    if (!raw) return false;
    const d = new Date(raw);
    d.setHours(0, 0, 0, 0);
    return d.getTime() === tomorrow.getTime();
  });

  const checkinsNext7 = reservations.filter(r => {
    const raw = getReservationStart(r);
    if (!raw) return false;
    const d = new Date(raw);
    d.setHours(0, 0, 0, 0);
    return d.getTime() > tomorrow.getTime() && d.getTime() <= next7.getTime();
  });

  const currentStays = reservations.filter(r => {
    const startRaw = getReservationStart(r);
    const endRaw = getReservationEnd(r);
    if (!startRaw || !endRaw) return false;

    const start = new Date(startRaw);
    const end = new Date(endRaw);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    return start.getTime() <= now.getTime() && now.getTime() < end.getTime();
  });

  const checkoutsToday = reservations.filter(r => {
    const raw = getReservationEnd(r);
    if (!raw) return false;
    const d = new Date(raw);
    d.setHours(0, 0, 0, 0);
    return d.getTime() === now.getTime();
  });

  console.log(
    '   👉 Today:', checkinsToday.length,
    '| Tomorrow:', checkinsTomorrow.length,
    '| Next7:', checkinsNext7.length,
    '| Current:', currentStays.length,
    '| CheckoutsToday:', checkoutsToday.length
  );

  renderSection('listToday', 'countToday', checkinsToday, 'welcome');
  renderSection('listTomorrow', 'countTomorrow', checkinsTomorrow, 'checkin-instructions');
  renderSection('listNext7', 'countNext7', checkinsNext7, 'welcome');
  renderSection('listCurrent', 'countCurrent', currentStays, 'during-stay');
  renderSection('listCheckouts', 'countCheckouts', checkoutsToday, 'checkout-reminder');
}

// ========================================
// RENDU DE SECTION
// ========================================
function renderSection(listId, countId, reservations, defaultTemplateKey) {
  const listEl = document.getElementById(listId);
  const countEl = document.getElementById(countId);

  if (!listEl || !countEl) return;

  countEl.textContent = reservations.length;

  if (!reservations.length) {
    listEl.innerHTML = `
      <div class="empty-state">
        <p>Aucune réservation dans cette section.</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = reservations.map(r => {
    const guestName = r.guestName || 'Voyageur';
    const propertyName = (r.property && r.property.name) || 'Logement';
    const nights = r.nights || r.nightCount || '';
    const source = r.source || r.channel || '';
    const start = formatDate(getReservationStart(r));
    const end = formatDate(getReservationEnd(r));
    const color = (r.property && r.property.color) || '#0f172a';

    return `
      <div class="reservation-item" style="border-left-color: ${color}">
        <div class="reservation-header">
          <div class="reservation-info">
            <h3>${propertyName} – ${guestName}</h3>
            <div class="reservation-meta">
              <span><i class="fas fa-calendar"></i> ${start} → ${end}</span>
              ${nights ? `<span><i class="fas fa-moon"></i> ${nights} nuit(s)</span>` : ''}
              ${source ? `<span><i class="fas fa-tag"></i> ${source}</span>` : ''}
            </div>
          </div>
        </div>

        <div class="reservation-actions">
          <button class="copy-btn" onclick="selectTemplate('${r.uid}', '${defaultTemplateKey}')">
            <i class="fas fa-magic"></i>
            Préparer le message
          </button>

          ${r.emailProxy ? `
          <a 
            id="mailto-${r.uid}" 
            class="copy-btn copy-btn-secondary"
            style="margin-left:8px;"
            target="_blank"
          >
            <i class="fas fa-envelope"></i>
            Email proxy
          </a>
          ` : ''}
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
    `;
  }).join('');
}

// ========================================
// TEMPLATE MANAGEMENT
// ========================================
async function selectTemplate(reservationUid, templateKey) {
  const container = document.getElementById(`templates-${reservationUid}`);
  if (container) {
    container.querySelectorAll('.template-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.template === templateKey);
    });
  }
  
  const preview = document.getElementById(`preview-${reservationUid}`);
  const subjectEl = document.getElementById(`subject-${reservationUid}`);
  const bodyEl = document.getElementById(`body-${reservationUid}`);
  
  if (!preview || !subjectEl || !bodyEl) {
    console.warn('Impossible de trouver les éléments de preview pour', reservationUid);
    return;
  }

  preview.style.display = 'block';
  subjectEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Génération...';
  bodyEl.textContent = '';
  
  const message = await generateMessage(reservationUid, templateKey);
  
  if (message) {
    subjectEl.innerHTML = `<i class="fas fa-envelope"></i> ${message.subject}`;
    bodyEl.textContent = message.message;

    const reservation = Array.isArray(allReservations)
      ? allReservations.find(r => r.uid === reservationUid)
      : null;

    if (reservation && reservation.emailProxy) {
      const mailLink = document.getElementById(`mailto-${reservationUid}`);
      if (mailLink) {
        const mailto = `mailto:${reservation.emailProxy
          }?subject=${encodeURIComponent(message.subject)
          }&body=${encodeURIComponent(message.message)}`;
        mailLink.href = mailto;
      }
    }
  } else {
    subjectEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Erreur';
    bodyEl.textContent = 'Impossible de générer le message';
  }
}

// ========================================
// ACTIONS UTILITAIRES
// ========================================
function copyMessage(reservationUid) {
  const subjectEl = document.getElementById(`subject-${reservationUid}`);
  const bodyEl = document.getElementById(`body-${reservationUid}`);
  const copyTextEl = document.getElementById(`copy-text-${reservationUid}`);

  if (!subjectEl || !bodyEl) return;

  const textToCopy = `${subjectEl.textContent}\n\n${bodyEl.textContent}`;

  navigator.clipboard.writeText(textToCopy).then(
    () => {
      if (copyTextEl) copyTextEl.textContent = 'Copié !';
      setTimeout(() => {
        if (copyTextEl) copyTextEl.textContent = 'Copier le message';
      }, 2000);
    },
    err => {
      console.error('Erreur copie presse-papier:', err);
      showToast('Impossible de copier le message', 'error');
    }
  );
}

// ========================================
// LOADING & TOASTS
// ========================================
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
