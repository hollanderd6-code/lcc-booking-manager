// ========================================
// PLATFORM APP - MODERN BOOKING MANAGER
// ========================================
const API_URL = 'https://lcc-booking-manager.onrender.com';

let calendar = null;
let allReservations = [];
let activeFilters = new Set();
// exposer les filtres pour le calendrier moderne (script dans app.html)
window.activeFilters = activeFilters;

// ========================================
// INITIALIZATION
// ========================================

document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 Platform initializing...');

  // Initialize theme
  initializeTheme();

  // Initialize calendar (FullCalendar)
  initializeCalendar();

  // Load data from API
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

  // View buttons (mois / semaine / liste)
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const view = e.currentTarget.dataset.view;
      changeCalendarView(view);

      // Update active state
      document
        .querySelectorAll('.view-btn')
        .forEach(b => b.classList.remove('active'));
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
// CALENDAR (FULLCALENDAR)
// ========================================

function initializeCalendar() {
  const calendarEl = document.getElementById('calendar');
  if (!calendarEl) return;

  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    locale: 'fr',            // calendrier en français
    firstDay: 1,             // lundi
    height: 'auto',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: ''              // les boutons vue sont en dehors (view-btn)
    },
    buttonText: {
      today: "Aujourd'hui",
      month: 'Mois',
      week: 'Semaine',
      list: 'Liste'
    },
    titleFormat: { month: 'long', year: 'numeric' },          // "Novembre 2025"
    dayHeaderFormat: { weekday: 'short', day: '2-digit' },    // "L 03", "M 04"...

    eventDisplay: 'block',
    dayMaxEvents: 4,

    eventClick: function (info) {
      if (info.event.extendedProps && info.event.extendedProps.reservation) {
        showReservationModal(info.event.extendedProps.reservation);
      }
    },

    // classes CSS selon la source (Airbnb / Booking / Direct)
    eventClassNames: function(info) {
      const classes = ['bh-event'];
      const normalized = normalizeSource(info.event.extendedProps.source);

      if (normalized === 'airbnb') classes.push('bh-event-airbnb');
      else if (normalized === 'booking') classes.push('bh-event-booking');
      else classes.push('bh-event-direct');

      return classes;
    },

    // contenu HTML de l’event : logement + badge + voyageur
    eventContent: function(arg) {
      const props = arg.event.extendedProps || {};
      const property = props.propertyName || 'Logement';
      const sourceRaw = props.source || '';
      const guest = arg.event.title || '';

      const normalized = normalizeSource(sourceRaw);

      const wrapper = document.createElement('div');
      wrapper.className = 'bh-event-inner';

      let badgeLetter = 'D';
      if (normalized === 'airbnb') badgeLetter = 'A';
      else if (normalized === 'booking') badgeLetter = 'B';

      const sourceBadge = `<span class="bh-event-source bh-source-${normalized}">${badgeLetter}</span>`;

      wrapper.innerHTML = `
        <div class="bh-event-top">
          <span class="bh-event-property">${property}</span>
          ${sourceBadge}
        </div>
        <div class="bh-event-guest">${guest}</div>
      `;

      return { domNodes: [wrapper] };
    },

    events: []
  });

  calendar.render();
}

function changeCalendarView(view) {
  if (!calendar) return;

  const viewMap = {
    month: 'dayGridMonth',
    week: 'timeGridWeek',
    list: 'listMonth'
  };

  calendar.changeView(viewMap[view] || 'dayGridMonth');
}

// Normalisation des infos logement / couleur pour éviter tout mélange
function getReservationPropertyId(r) {
  return r.propertyId || (r.property && r.property.id) || null;
}

function getReservationPropertyName(r) {
  return r.propertyName || (r.property && r.property.name) || 'Logement';
}

function getReservationPropertyColor(r) {
  return r.propertyColor || (r.property && r.property.color) || '#10B981';
}

// 👉 nouvelle version : on fournit title = voyageur + extendedProps utilisés pour l’affichage
// et on filtre proprement sur le logement (propertyId)
function updateCalendarEvents() {
  if (!calendar) return;

  const events = allReservations
    .filter(r => {
      const propId = getReservationPropertyId(r);
      if (!propId) return activeFilters.size === 0;
      return activeFilters.size === 0 || activeFilters.has(propId);
    })
    .map(r => {
      const guestLabel = r.guestName || 'Voyageur';
      const propertyName = getReservationPropertyName(r);
      const propertyColor = getReservationPropertyColor(r);
      const sourceRaw = r.source || '';

      return {
        title: guestLabel,
        start: r.start,
        end: r.end,
        backgroundColor: propertyColor,
        borderColor: propertyColor,
        extendedProps: {
          reservation: r,
          propertyName: propertyName,
          source: sourceRaw
        }
      };
    });

  calendar.removeAllEvents();
  calendar.addEventSource(events);
}

// Met à jour FullCalendar + le calendrier moderne (tableau par logement)
function updateAllCalendars() {
  updateCalendarEvents();

  if (window.renderModernCalendar) {
    try {
      window.renderModernCalendar(allReservations, window.LCC_PROPERTIES || []);
    } catch (e) {
      console.warn('Erreur calendrier moderne', e);
    }
  }
}

// ========================================
// OVERVIEW CARD (Aujourd’hui & à venir)
// ========================================

function updateOverviewFromReservations(reservations) {
  if (!Array.isArray(reservations)) return;

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  let upcomingCount = 0;
  let currentCount = 0;

  const todayArrivals = [];
  const todayDepartures = [];
  const currentStays = [];

  reservations.forEach(r => {
    if (!r.start || !r.end) return;

    const start = new Date(r.start);
    const end = new Date(r.end);

    const startStr = r.start.slice(0, 10);
    const endStr = r.end.slice(0, 10);

    if (end >= now) {
      upcomingCount++;
    }

    if (start <= now && end >= now) {
      currentCount++;
      currentStays.push({ res: r, start, end });
    }

    if (startStr === todayStr) {
      todayArrivals.push({ res: r, start, end });
    }

    if (endStr === todayStr) {
      todayDepartures.push({ res: r, start, end });
    }
  });

  const ovUpcomingEl = document.getElementById('ovUpcoming');
  const ovCurrentEl = document.getElementById('ovCurrent');

  if (ovUpcomingEl) ovUpcomingEl.textContent = upcomingCount;
  if (ovCurrentEl) ovCurrentEl.textContent = currentCount;

  const container = document.getElementById('overviewTimeline');
  if (!container) return;
  container.innerHTML = '';

  const items = [];

  todayArrivals.forEach(({ res, start }) => {
    items.push({
      type: 'arrival',
      label: `Arrivée – ${res.propertyName || (res.property && res.property.name) || 'Logement'}`,
      time: start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    });
  });

  currentStays.forEach(({ res }) => {
    items.push({
      type: 'stay',
      label: `Séjour en cours – ${res.propertyName || (res.property && res.property.name) || 'Logement'}`,
      time: ''
    });
  });

  todayDepartures.forEach(({ res, end }) => {
    items.push({
      type: 'departure',
      label: `Départ – ${res.propertyName || (res.property && res.property.name) || 'Logement'}`,
      time: end.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    });
  });

  if (items.length === 0) {
    const p = document.createElement('p');
    p.className = 'overview-empty';
    p.textContent = 'Aucun check-in ou check-out aujourd’hui.';
    container.appendChild(p);
  } else {
    items.slice(0, 4).forEach(item => {
      const row = document.createElement('div');
      row.className = 'overview-timeline-item';

      const dot = document.createElement('span');
      dot.className = `overview-dot ${item.type}`;

      const main = document.createElement('div');
      main.className = 'overview-line-main';
      main.textContent = item.label;

      const time = document.createElement('div');
      time.className = 'overview-line-time';
      time.textContent = item.time || '';

      row.appendChild(dot);
      row.appendChild(main);
      row.appendChild(time);

      container.appendChild(row);
    });

    const footer = document.createElement('div');
    footer.className = 'overview-timeline-footer';
    footer.textContent = 'Calendrier synchronisé avec vos annonces Airbnb / Booking.';
    container.appendChild(footer);
  }
}

// ========================================
// DATA LOADING + SYNC
// ========================================

async function loadReservations() {
  showLoading();

  try {
    const token = localStorage.getItem('lcc_token');

    const response = await fetch(`${API_URL}/api/reservations`, {
      headers: {
        Authorization: 'Bearer ' + token
      }
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${response.status}`);
    }

    const data = await response.json();

    allReservations = data.reservations || [];
    window.LCC_RESERVATIONS = allReservations;
    window.LCC_PROPERTIES = data.properties || [];

    console.log('DEBUG PROPERTIES', JSON.stringify(window.LCC_PROPERTIES, null, 2));
    console.log('DEBUG RESERVATIONS', JSON.stringify(allReservations, null, 2));

    // Carte "Vue d’ensemble"
    updateOverviewFromReservations(allReservations);

    // Stats + filtres
    updateStats(data);
    renderPropertyFilters(window.LCC_PROPERTIES);

    // Calendriers (FullCalendar + moderne)
    updateAllCalendars();

    console.log(`📦 ${allReservations.length} réservations chargées`);
  } catch (error) {
    console.error('Error loading reservations:', error);
    showToast("Erreur lors du chargement des réservations", 'error');
  } finally {
    hideLoading();
  }
}

async function syncReservations() {
  const syncBtn = document.getElementById('syncBtn');
  const icon = syncBtn ? syncBtn.querySelector('i') : null;

  if (icon) icon.classList.add('fa-spin');
  if (syncBtn) syncBtn.disabled = true;

  try {
    const token = localStorage.getItem('lcc_token');

    const response = await fetch(`${API_URL}/api/sync`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token
      }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    console.log('Sync result:', data);
    showToast('Synchronisation réussie', 'success');

    await loadReservations();
  } catch (error) {
    console.error('Error syncing:', error);
    showToast('Erreur lors de la synchronisation', 'error');
  } finally {
    if (icon) icon.classList.remove('fa-spin');
    if (syncBtn) syncBtn.disabled = false;
  }
}

// ========================================
// UI UPDATES (stats + filtres)
// ========================================

function safeSetText(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = value;
  }
}

function updateStats(data) {
  const reservations = data.reservations || [];

  safeSetText('statTotal', reservations.length);

  const now = new Date();
  const upcoming = reservations.filter(r => new Date(r.start) > now).length;
  const current = reservations.filter(
    r => new Date(r.start) <= now && new Date(r.end) >= now
  ).length;

  safeSetText('statUpcoming', upcoming);
  safeSetText('statCurrent', current);

  const navBadge = document.getElementById('navTotalReservations');
  if (navBadge) {
    navBadge.textContent = reservations.length;
  }
}

function renderPropertyFilters(properties) {
  const container = document.getElementById('propertyFilters');
  if (!container) return;

  if (!properties.length) {
    container.innerHTML = '<p class="overview-empty">Aucun logement configuré.</p>';
    return;
  }

  container.innerHTML = properties.map(p => {
    const color = p.color || '#10B981';
    return `
      <div class="property-badge"
           style="border-color: ${color}; color: ${color};"
           data-property-id="${p.id}"
           onclick="togglePropertyFilter('${p.id}')">
        <i class="fas fa-home"></i>
        <span>${p.name}</span>
        <span class="property-count">${p.count}</span>
      </div>
    `;
  }).join('');
}

function togglePropertyFilter(propertyId) {
  if (activeFilters.has(propertyId)) {
    activeFilters.delete(propertyId);
  } else {
    activeFilters.add(propertyId);
  }

  // garder la référence globale à jour
  window.activeFilters = activeFilters;

  const badge = document.querySelector(`[data-property-id="${propertyId}"]`);
  if (badge) {
    badge.classList.toggle('active');
  }

  updateAllCalendars();
}

function clearFilters() {
  activeFilters.clear();
  window.activeFilters = activeFilters;

  document
    .querySelectorAll('.property-badge')
    .forEach(badge => badge.classList.remove('active'));

  updateAllCalendars();
}

// ========================================
// MODAL
// ========================================

function showReservationModal(reservation) {
  const modal = document.getElementById('reservationModal');
  const modalBody = document.getElementById('modalBody');

  const checkin = new Date(reservation.start);
  const checkout = new Date(reservation.end);

  const propColor = getReservationPropertyColor(reservation);
  const propName = getReservationPropertyName(reservation);

  modalBody.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 20px;">

      <div style="display: flex; align-items: center; gap: 12px; padding: 16px; background: var(--bg-secondary); border-radius: var(--radius-md);">
        <div style="width: 48px; height: 48px; border-radius: var(--radius-md); background: ${propColor}; display: flex; align-items: center; justify-content: center; color: white; font-size: 24px;">
          <i class="fas fa-home"></i>
        </div>
        <div>
          <div style="font-weight: 700; font-size: 18px; color: var(--text-primary);">${propName}</div>
          <div style="color: var(--text-secondary); font-size: 14px;">${reservation.source || ''}</div>
        </div>
      </div>

      <div>
        <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 8px;">Voyageur</div>
        <div style="font-size: 18px; font-weight: 700; color: var(--text-primary);">
          <i class="fas fa-user" style="color: var(--primary-color); margin-right: 8px;"></i>
          ${reservation.guestName || ''}
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div>
          <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 8px;">Arrivée</div>
          <div style="font-weight: 600; color: var(--text-primary);">
            <i class="fas fa-calendar-check" style="color: var(--success); margin-right: 8px;"></i>
            ${checkin.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
          <div style="color: var(--text-secondary); font-size: 14px; margin-top: 4px;">
            ${checkin.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>

        <div>
          <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 8px;">Départ</div>
          <div style="font-weight: 600; color: var(--text-primary);">
            <i class="fas fa-calendar-times" style="color: var(--error); margin-right: 8px;"></i>
            ${checkout.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
          <div style="color: var(--text-secondary); font-size: 14px; margin-top: 4px;">
            ${checkout.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>

      <div style="display: flex; gap: 16px;">
        <div style="flex: 1; padding: 16px; background: var(--bg-secondary); border-radius: var(--radius-md); text-align: center;">
          <div style="font-size: 12px; color: var(--text-tertiary); margin-bottom: 4px;">Nuits</div>
          <div style="font-size: 24px; font-weight: 700; color: var(--primary-color);">
            <i class="fas fa-moon"></i> ${reservation.nights || ''}
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
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.classList.add('active');
}

function hideLoading() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.classList.remove('active');
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
    <i class="fas ${icons[type]}"></i>
    <span class="toast-message">${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideInRight 0.3s ease reverse';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function openDepositsPage() {
  window.location.href = '/deposits.html';
}

function goToMessages() {
  window.location.href = '/messages.html';
}

// Normalise la source (Airbnb / Booking.com / etc.) en clé courte
function normalizeSource(sourceRaw) {
  const val = String(sourceRaw || '').toLowerCase();
  if (!val) return 'direct';
  if (val.includes('airbnb')) return 'airbnb';
  if (val.includes('booking')) return 'booking';
  if (val.includes('expedia')) return 'expedia';
  if (val.includes('vrbo') || val.includes('abritel') || val.includes('homeaway')) return 'vrbo';
  if (val.includes('hotel')) return 'hotels';
  return 'direct';
}

// ========================================
// MOBILE MENU (TODO)
// ========================================
// (rien de spécial ici pour l’instant)
