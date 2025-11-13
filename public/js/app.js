// ========================================
// PLATFORM APP - MODERN BOOKING MANAGER
// ========================================

const API_URL = '';
let calendar = null;
let allReservations = [];
let activeFilters = new Set();

// ========================================
// INITIALIZATION
// ========================================

document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 Platform initializing...');
  
  // Initialize theme
  initializeTheme();
  
  // Initialize calendar
  initializeCalendar();
  
  // Load data
  await loadReservations();
  
  // Setup event listeners
  setupEventListeners();
  
  console.log('✅ Platform ready');
});

// ========================================
// THEME MANAGEMENT
// ========================================

function initializeTheme() {
  const savedTheme = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
  updateThemeIcon(newTheme);
  
  // Refresh calendar to update colors
  if (calendar) {
    calendar.render();
  }
}

function updateThemeIcon(theme) {
  const icon = document.querySelector('#themeToggle i');
  if (icon) {
    icon.className = theme === 'light' ? 'fas fa-moon' : 'fas fa-sun';
  }
}

// ========================================
// EVENT LISTENERS
// ========================================

function setupEventListeners() {
  // Theme toggle
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }
  
  // Sync button
  const syncBtn = document.getElementById('syncBtn');
  if (syncBtn) {
    syncBtn.addEventListener('click', syncReservations);
  }
  
  // View buttons
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const view = e.currentTarget.dataset.view;
      changeCalendarView(view);
      
      // Update active state
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
    });
  });
  
  // Modal close
  const modalClose = document.getElementById('modalClose');
  if (modalClose) {
    modalClose.addEventListener('click', () => {
      document.getElementById('reservationModal').classList.remove('active');
    });
  }
  
  // Close modal on backdrop click
  const modal = document.getElementById('reservationModal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('active');
      }
    });
  }
}

// ========================================
// CALENDAR
// ========================================

function initializeCalendar() {
  const calendarEl = document.getElementById('calendar');
  if (!calendarEl) return;
  
  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    locale: 'fr',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: ''
    },
    buttonText: {
      today: 'Aujourd\'hui'
    },
    height: 'auto',
    eventClick: function(info) {
      showReservationModal(info.event.extendedProps.reservation);
    },
    events: []
  });
  
  calendar.render();
}

function changeCalendarView(view) {
  if (!calendar) return;
  
  const viewMap = {
    'month': 'dayGridMonth',
    'week': 'timeGridWeek',
    'list': 'listMonth'
  };
  
  calendar.changeView(viewMap[view] || 'dayGridMonth');
}

function updateCalendarEvents() {
  if (!calendar) return;
  
  const events = allReservations
    .filter(r => activeFilters.size === 0 || activeFilters.has(r.property.id))
    .map(r => ({
      title: `${r.property.name} - ${r.guestName}`,
      start: r.start,
      end: r.end,
      backgroundColor: r.property.color,
      borderColor: r.property.color,
      extendedProps: {
        reservation: r
      }
    }));
  
  calendar.removeAllEvents();
  calendar.addEventSource(events);
}

// ========================================
// DATA LOADING
// ========================================

async function loadReservations() {
  showLoading();
  
  try {
    const response = await fetch(`${API_URL}/api/reservations`);
    const data = await response.json();
    
    allReservations = data.reservations;
    
    // Update stats
    updateStats(data);
    
    // Render property filters
    renderPropertyFilters(data.properties);
    
    // Update calendar
    updateCalendarEvents();
    
    console.log(`📦 ${allReservations.length} reservations loaded`);
  } catch (error) {
    console.error('Error loading reservations:', error);
    showToast('Erreur lors du chargement des réservations', 'error');
  } finally {
    hideLoading();
  }
}

async function syncReservations() {
  const syncBtn = document.getElementById('syncBtn');
  const icon = syncBtn.querySelector('i');
  
  icon.classList.add('fa-spin');
  syncBtn.disabled = true;
  
  try {
    const response = await fetch(`${API_URL}/api/sync`, { method: 'POST' });
    const data = await response.json();
    
    showToast('Synchronisation réussie', 'success');
    await loadReservations();
  } catch (error) {
    console.error('Error syncing:', error);
    showToast('Erreur lors de la synchronisation', 'error');
  } finally {
    icon.classList.remove('fa-spin');
    syncBtn.disabled = false;
  }
}

// ========================================
// UI UPDATES
// ========================================

function updateStats(data) {
  document.getElementById('statTotal').textContent = data.reservations.length;
  
  const now = new Date();
  const upcoming = data.reservations.filter(r => new Date(r.start) > now).length;
  const current = data.reservations.filter(r => 
    new Date(r.start) <= now && new Date(r.end) >= now
  ).length;
  
  document.getElementById('statUpcoming').textContent = upcoming;
  document.getElementById('statCurrent').textContent = current;
  
  // Update nav badge
  const navBadge = document.getElementById('navTotalReservations');
  if (navBadge) {
    navBadge.textContent = data.reservations.length;
  }
}

function renderPropertyFilters(properties) {
  const container = document.getElementById('propertyFilters');
  if (!container) return;
  
  container.innerHTML = properties.map(p => `
    <div class="property-badge" 
         style="border-color: ${p.color}; color: ${p.color};"
         data-property-id="${p.id}"
         onclick="togglePropertyFilter('${p.id}')">
      <i class="fas fa-home"></i>
      <span>${p.name}</span>
      <span class="property-count">${p.count}</span>
    </div>
  `).join('');
}

function togglePropertyFilter(propertyId) {
  if (activeFilters.has(propertyId)) {
    activeFilters.delete(propertyId);
  } else {
    activeFilters.add(propertyId);
  }
  
  // Update UI
  const badge = document.querySelector(`[data-property-id="${propertyId}"]`);
  if (badge) {
    badge.classList.toggle('active');
  }
  
  // Update calendar
  updateCalendarEvents();
}

function clearFilters() {
  activeFilters.clear();
  
  document.querySelectorAll('.property-badge').forEach(badge => {
    badge.classList.remove('active');
  });
  
  updateCalendarEvents();
}

// ========================================
// MODAL
// ========================================

function showReservationModal(reservation) {
  const modal = document.getElementById('reservationModal');
  const modalBody = document.getElementById('modalBody');
  
  const checkin = new Date(reservation.start);
  const checkout = new Date(reservation.end);
  
  modalBody.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 20px;">
      
      <div style="display: flex; align-items: center; gap: 12px; padding: 16px; background: var(--bg-secondary); border-radius: var(--radius-md);">
        <div style="width: 48px; height: 48px; border-radius: var(--radius-md); background: ${reservation.property.color}; display: flex; align-items: center; justify-content: center; color: white; font-size: 24px;">
          <i class="fas fa-home"></i>
        </div>
        <div>
          <div style="font-weight: 700; font-size: 18px; color: var(--text-primary);">${reservation.property.name}</div>
          <div style="color: var(--text-secondary); font-size: 14px;">${reservation.source}</div>
        </div>
      </div>
      
      <div>
        <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 8px;">Voyageur</div>
        <div style="font-size: 18px; font-weight: 700; color: var(--text-primary);">
          <i class="fas fa-user" style="color: var(--primary-color); margin-right: 8px;"></i>
          ${reservation.guestName}
        </div>
      </div>
      
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div>
          <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 8px;">Arrivée</div>
          <div style="font-weight: 600; color: var(--text-primary);">
            <i class="fas fa-calendar-check" style="color: var(--success); margin-right: 8px;"></i>
            ${checkin.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
          <div style="color: var(--text-secondary); font-size: 14px; margin-top: 4px;">${checkin.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
        
        <div>
          <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 8px;">Départ</div>
          <div style="font-weight: 600; color: var(--text-primary);">
            <i class="fas fa-calendar-times" style="color: var(--error); margin-right: 8px;"></i>
            ${checkout.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
          <div style="color: var(--text-secondary); font-size: 14px; margin-top: 4px;">${checkout.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
      </div>
      
      <div style="display: flex; gap: 16px;">
        <div style="flex: 1; padding: 16px; background: var(--bg-secondary); border-radius: var(--radius-md); text-align: center;">
          <div style="font-size: 12px; color: var(--text-tertiary); margin-bottom: 4px;">Nuits</div>
          <div style="font-size: 24px; font-weight: 700; color: var(--primary-color);">
            <i class="fas fa-moon"></i> ${reservation.nights}
          </div>
        </div>
        
        ${reservation.guestPhone ? `
        <div style="flex: 1; padding: 16px; background: var(--bg-secondary); border-radius: var(--radius-md);">
          <div style="font-size: 12px; color: var(--text-tertiary); margin-bottom: 4px;">Contact</div>
          <div style="font-weight: 600; color: var(--text-primary);">
            <a href="tel:${reservation.guestPhone}" style="color: var(--primary-color); text-decoration: none;">
              <i class="fas fa-phone"></i> ${reservation.guestPhone}
            </a>
          </div>
        </div>
        ` : ''}
      </div>
      
      ${reservation.notes ? `
      <div>
        <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 8px;">Notes</div>
        <div style="padding: 12px; background: var(--bg-secondary); border-radius: var(--radius-md); color: var(--text-secondary);">
          ${reservation.notes}
        </div>
      </div>
      ` : ''}
      
      <div style="display: flex; gap: 12px; margin-top: 8px;">
        <a href="/messages.html" class="btn btn-primary" style="flex: 1;">
          <i class="fas fa-comment-dots"></i>
          Envoyer un message
        </a>
        <button class="btn btn-secondary" onclick="document.getElementById('reservationModal').classList.remove('active')">
          Fermer
        </button>
      </div>
    </div>
  `;
  
  modal.classList.add('active');
}

// ========================================
// UTILITIES
// ========================================

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

// ========================================
// MOBILE MENU (TODO)
// ========================================

// Add mobile menu toggle functionality if needed
