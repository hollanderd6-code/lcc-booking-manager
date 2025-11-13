// ========================================
// CONFIGURATION & STATE
// ========================================
const API_URL = '';
let calendar;
let allReservations = [];
let allProperties = [];
let activePropertyFilters = new Set();
let currentView = 'month';

// ========================================
// INITIALIZATION
// ========================================
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 LCC Booking Manager - Initialisation...');
  
  // Initialize components
  await loadConfiguration();
  await loadReservations();
  initializeCalendar();
  initializeEventListeners();
  
  console.log('✅ Application initialisée');
});

// ========================================
// API CALLS
// ========================================
async function loadConfiguration() {
  try {
    const response = await fetch(`${API_URL}/api/config`);
    const config = await response.json();
    
    allProperties = config.properties;
    
    // Initialize all filters as active
    allProperties.forEach(p => activePropertyFilters.add(p.id));
    
    renderPropertyFilters();
  } catch (error) {
    console.error('Erreur chargement configuration:', error);
    showToast('Erreur de connexion au serveur', 'error');
  }
}

async function loadReservations() {
  try {
    const response = await fetch(`${API_URL}/api/reservations`);
    const data = await response.json();
    
    allReservations = data.reservations;
    
    updateStatusBar(data);
    updateCalendarEvents();
    
    console.log(`📅 ${allReservations.length} réservations chargées`);
  } catch (error) {
    console.error('Erreur chargement réservations:', error);
    showToast('Erreur lors du chargement des réservations', 'error');
  }
}

async function syncCalendars() {
  const syncBtn = document.getElementById('syncBtn');
  const syncIcon = document.getElementById('syncIcon');
  const loadingOverlay = document.getElementById('loadingOverlay');
  
  syncBtn.classList.add('syncing');
  syncIcon.classList.add('syncing');
  loadingOverlay.classList.add('active');
  
  try {
    const response = await fetch(`${API_URL}/api/sync`, {
      method: 'POST'
    });
    
    const result = await response.json();
    
    await loadReservations();
    showToast('✅ Synchronisation réussie', 'success');
    
    console.log('✅ Synchronisation terminée:', result);
  } catch (error) {
    console.error('Erreur synchronisation:', error);
    showToast('❌ Erreur lors de la synchronisation', 'error');
  } finally {
    syncBtn.classList.remove('syncing');
    syncIcon.classList.remove('syncing');
    loadingOverlay.classList.remove('active');
  }
}

async function loadStats() {
  try {
    const response = await fetch(`${API_URL}/api/stats`);
    const stats = await response.json();
    
    displayStats(stats);
  } catch (error) {
    console.error('Erreur chargement stats:', error);
    showToast('Erreur lors du chargement des statistiques', 'error');
  }
}

// ========================================
// CALENDAR INITIALIZATION
// ========================================
function initializeCalendar() {
  const calendarEl = document.getElementById('calendar');
  
  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    locale: 'fr',
    firstDay: 1,
    height: 'auto',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,timeGridWeek,listWeek'
    },
    buttonText: {
      today: "Aujourd'hui",
      month: 'Mois',
      week: 'Semaine',
      list: 'Liste'
    },
    events: [],
    eventClick: function(info) {
      const reservation = allReservations.find(r => r.uid === info.event.id);
      if (reservation) {
        showReservationModal(reservation);
      }
    },
    eventDidMount: function(info) {
      // Add tooltip
      info.el.title = info.event.extendedProps.tooltip;
    },
    dayCellDidMount: function(info) {
      // Could add availability indicators here
    }
  });
  
  calendar.render();
}

function updateCalendarEvents() {
  const filteredReservations = allReservations.filter(r => 
    activePropertyFilters.has(r.property.id)
  );
  
  const events = filteredReservations.map(r => ({
    id: r.uid,
    title: `${r.property.name} - ${r.guestName}`,
    start: r.start,
    end: r.end,
    backgroundColor: r.property.color,
    borderColor: r.property.color,
    extendedProps: {
      reservation: r,
      tooltip: `${r.property.name}\n${r.guestName}\n${r.nights} nuit(s)\nSource: ${r.source}`
    }
  }));
  
  calendar.removeAllEvents();
  calendar.addEventSource(events);
}

// ========================================
// UI RENDERING
// ========================================
function renderPropertyFilters() {
  const container = document.getElementById('propertyFilters');
  
  container.innerHTML = allProperties.map(property => `
    <div class="property-filter active" data-property-id="${property.id}">
      <div class="property-color" style="background-color: ${property.color}"></div>
      <span>${property.name}</span>
      <span class="property-count" id="count-${property.id}">0</span>
    </div>
  `).join('');
  
  // Add click handlers
  container.querySelectorAll('.property-filter').forEach(filter => {
    filter.addEventListener('click', () => {
      const propertyId = filter.dataset.propertyId;
      
      if (activePropertyFilters.has(propertyId)) {
        activePropertyFilters.delete(propertyId);
        filter.classList.remove('active');
      } else {
        activePropertyFilters.add(propertyId);
        filter.classList.add('active');
      }
      
      updateCalendarEvents();
      updateReservationsList();
    });
  });
  
  updatePropertyCounts();
}

function updatePropertyCounts() {
  allProperties.forEach(property => {
    const count = allReservations.filter(r => r.property.id === property.id).length;
    const countEl = document.getElementById(`count-${property.id}`);
    if (countEl) {
      countEl.textContent = count;
    }
  });
}

function updateStatusBar(data) {
  document.getElementById('totalReservations').textContent = data.reservations.length;
  
  const now = new Date();
  const upcoming = data.reservations.filter(r => new Date(r.start) > now).length;
  const current = data.reservations.filter(r => 
    new Date(r.start) <= now && new Date(r.end) >= now
  ).length;
  
  document.getElementById('upcomingReservations').textContent = upcoming;
  document.getElementById('currentReservations').textContent = current;
  
  if (data.lastSync) {
    const lastSyncDate = new Date(data.lastSync);
    const lastSyncText = formatRelativeTime(lastSyncDate);
    document.getElementById('lastSync').textContent = `Dernière synchro: ${lastSyncText}`;
  }
}

function updateReservationsList() {
  const listContainer = document.getElementById('reservationsList');
  
  const filteredReservations = allReservations
    .filter(r => activePropertyFilters.has(r.property.id))
    .sort((a, b) => new Date(a.start) - new Date(b.start));
  
  if (filteredReservations.length === 0) {
    listContainer.innerHTML = `
      <div style="text-align: center; padding: 60px 20px; color: var(--text-secondary);">
        <i class="fas fa-calendar-times" style="font-size: 48px; margin-bottom: 16px; opacity: 0.3;"></i>
        <p>Aucune réservation à afficher</p>
      </div>
    `;
    return;
  }
  
  listContainer.innerHTML = filteredReservations.map(r => `
    <div class="reservation-card" data-uid="${r.uid}" style="border-left-color: ${r.property.color}">
      <div class="reservation-content">
        <div class="reservation-header">
          <div class="reservation-property" style="color: ${r.property.color}">
            <i class="fas fa-home"></i>
            ${r.property.name}
          </div>
          <span class="reservation-source">${r.source}</span>
        </div>
        
        <div class="reservation-details">
          <div class="reservation-detail">
            <i class="fas fa-user"></i>
            <span><strong>${r.guestName}</strong></span>
          </div>
          
          <div class="reservation-detail">
            <i class="fas fa-calendar-alt"></i>
            <span>${formatDate(r.start)} → ${formatDate(r.end)}</span>
          </div>
          
          <div class="reservation-detail">
            <i class="fas fa-moon"></i>
            <span><strong>${r.nights}</strong> nuit${r.nights > 1 ? 's' : ''}</span>
          </div>
          
          ${r.guestPhone ? `
          <div class="reservation-detail">
            <i class="fas fa-phone"></i>
            <span>${r.guestPhone}</span>
          </div>
          ` : ''}
        </div>
      </div>
    </div>
  `).join('');
  
  // Add click handlers
  listContainer.querySelectorAll('.reservation-card').forEach(card => {
    card.addEventListener('click', () => {
      const uid = card.dataset.uid;
      const reservation = allReservations.find(r => r.uid === uid);
      if (reservation) {
        showReservationModal(reservation);
      }
    });
  });
}

// ========================================
// MODALS
// ========================================
function showReservationModal(reservation) {
  const modal = document.getElementById('reservationModal');
  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');
  
  modalTitle.innerHTML = `
    <i class="fas fa-home" style="color: ${reservation.property.color}"></i>
    ${reservation.property.name}
  `;
  
  modalBody.innerHTML = `
    <div class="detail-grid">
      <div class="detail-section" style="border-left-color: ${reservation.property.color}">
        <div class="detail-section-title">
          <i class="fas fa-user"></i>
          Informations Voyageur
        </div>
        
        <div class="detail-row">
          <div class="detail-label">
            <i class="fas fa-user"></i>
            Nom
          </div>
          <div class="detail-value highlight">${reservation.guestName}</div>
        </div>
        
        ${reservation.guestEmail ? `
        <div class="detail-row">
          <div class="detail-label">
            <i class="fas fa-envelope"></i>
            Email
          </div>
          <div class="detail-value">
            <a href="mailto:${reservation.guestEmail}">${reservation.guestEmail}</a>
          </div>
        </div>
        ` : ''}
        
        ${reservation.guestPhone ? `
        <div class="detail-row">
          <div class="detail-label">
            <i class="fas fa-phone"></i>
            Téléphone
          </div>
          <div class="detail-value">
            <a href="tel:${reservation.guestPhone}">${reservation.guestPhone}</a>
          </div>
        </div>
        ` : ''}
      </div>
      
      <div class="detail-section">
        <div class="detail-section-title">
          <i class="fas fa-calendar"></i>
          Dates & Durée
        </div>
        
        <div class="detail-row">
          <div class="detail-label">
            <i class="fas fa-sign-in-alt"></i>
            Arrivée
          </div>
          <div class="detail-value highlight">${formatDateTime(reservation.start)}</div>
        </div>
        
        <div class="detail-row">
          <div class="detail-label">
            <i class="fas fa-sign-out-alt"></i>
            Départ
          </div>
          <div class="detail-value highlight">${formatDateTime(reservation.end)}</div>
        </div>
        
        <div class="detail-row">
          <div class="detail-label">
            <i class="fas fa-moon"></i>
            Nuits
          </div>
          <div class="detail-value highlight">${reservation.nights} nuit${reservation.nights > 1 ? 's' : ''}</div>
        </div>
      </div>
      
      <div class="detail-section">
        <div class="detail-section-title">
          <i class="fas fa-info-circle"></i>
          Détails Réservation
        </div>
        
        <div class="detail-row">
          <div class="detail-label">
            <i class="fas fa-globe"></i>
            Plateforme
          </div>
          <div class="detail-value">${reservation.source}</div>
        </div>
        
        ${reservation.bookingId ? `
        <div class="detail-row">
          <div class="detail-label">
            <i class="fas fa-hashtag"></i>
            ID Réservation
          </div>
          <div class="detail-value"><code>${reservation.bookingId}</code></div>
        </div>
        ` : ''}
        
        <div class="detail-row">
          <div class="detail-label">
            <i class="fas fa-check-circle"></i>
            Statut
          </div>
          <div class="detail-value">${reservation.status}</div>
        </div>
        
        <div class="detail-row">
          <div class="detail-label">
            <i class="fas fa-clock"></i>
            Créée le
          </div>
          <div class="detail-value">${formatDateTime(reservation.created)}</div>
        </div>
      </div>
      
      ${reservation.description ? `
      <div class="detail-section">
        <div class="detail-section-title">
          <i class="fas fa-sticky-note"></i>
          Notes
        </div>
        <div style="white-space: pre-wrap; color: var(--text-secondary); line-height: 1.6;">
          ${reservation.description}
        </div>
      </div>
      ` : ''}
    </div>
  `;
  
  modal.classList.add('active');
}

function showStatsModal() {
  const modal = document.getElementById('statsModal');
  modal.classList.add('active');
  loadStats();
}

function displayStats(stats) {
  const modalBody = document.getElementById('statsModalBody');
  
  modalBody.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${stats.totalReservations}</div>
        <div class="stat-label">Réservations totales</div>
      </div>
      
      <div class="stat-card">
        <div class="stat-value">${stats.upcomingReservations}</div>
        <div class="stat-label">À venir</div>
      </div>
      
      <div class="stat-card">
        <div class="stat-value">${stats.currentReservations}</div>
        <div class="stat-label">En cours</div>
      </div>
    </div>
    
    <div class="detail-section">
      <div class="detail-section-title">
        <i class="fas fa-home"></i>
        Par Logement
      </div>
      ${Object.entries(stats.byProperty).map(([id, data]) => `
        <div class="detail-row">
          <div class="detail-label">${data.name}</div>
          <div class="detail-value">
            <strong>${data.total}</strong> réservations
            (${data.upcoming} à venir, ${data.current} en cours)
          </div>
        </div>
      `).join('')}
    </div>
    
    ${Object.keys(stats.byMonth).length > 0 ? `
    <div class="detail-section">
      <div class="detail-section-title">
        <i class="fas fa-chart-line"></i>
        Par Mois
      </div>
      ${Object.entries(stats.byMonth)
        .sort((a, b) => b[0].localeCompare(a[0]))
        .slice(0, 6)
        .map(([month, count]) => `
          <div class="detail-row">
            <div class="detail-label">${formatMonth(month)}</div>
            <div class="detail-value highlight">${count} réservation${count > 1 ? 's' : ''}</div>
          </div>
        `).join('')}
    </div>
    ` : ''}
  `;
}

function closeStatsModal() {
  document.getElementById('statsModal').classList.remove('active');
}

function closeSettingsModal() {
  document.getElementById('settingsModal').classList.remove('active');
}

// ========================================
// EVENT LISTENERS
// ========================================
function initializeEventListeners() {
  // Sync button
  document.getElementById('syncBtn').addEventListener('click', syncCalendars);
  
  // Stats button
  document.getElementById('statsBtn').addEventListener('click', showStatsModal);
  
  // Settings button
  document.getElementById('settingsBtn').addEventListener('click', () => {
    showToast('Paramètres à venir', 'info');
  });
  
  // Modal close buttons
  document.getElementById('modalClose').addEventListener('click', () => {
    document.getElementById('reservationModal').classList.remove('active');
  });
  
  // Close modals on backdrop click
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('active');
      }
    });
  });
  
  // View toggle buttons
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      currentView = view;
      
      if (view === 'list') {
        document.getElementById('calendar').parentElement.style.display = 'none';
        document.getElementById('reservationsList').style.display = 'block';
        updateReservationsList();
      } else {
        document.getElementById('calendar').parentElement.style.display = 'block';
        document.getElementById('reservationsList').style.display = 'none';
        
        const calendarView = view === 'month' ? 'dayGridMonth' : 'timeGridWeek';
        calendar.changeView(calendarView);
      }
    });
  });
  
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal.active').forEach(modal => {
        modal.classList.remove('active');
      });
    }
  });
}

// ========================================
// UTILITIES
// ========================================
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function formatDateTime(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatMonth(monthString) {
  const [year, month] = monthString.split('-');
  const date = new Date(year, month - 1);
  return date.toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric'
  });
}

function formatRelativeTime(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 1) return 'à l\'instant';
  if (diffMins < 60) return `il y a ${diffMins} min`;
  
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `il y a ${diffHours}h`;
  
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `il y a ${diffDays}j`;
  
  return formatDate(date);
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

// ========================================
// AUTO-REFRESH
// ========================================
setInterval(() => {
  loadReservations();
}, 5 * 60 * 1000); // Refresh every 5 minutes
