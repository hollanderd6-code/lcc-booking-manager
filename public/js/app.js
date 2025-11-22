// ========================================
// PLATFORM APP - MODERN BOOKING MANAGER
// ========================================
const API_URL = 'https://lcc-booking-manager.onrender.com';

let calendar = null;
let allReservations = [];
let activeFilters = new Set();

// expose filters for the modern grid calendar
window.activeFilters = activeFilters;

// Colors by source/platform (for both calendars)
const SOURCE_COLORS = {
  airbnb: { bg: '#FF5A5F', border: '#FF5A5F' },   // rose foncé
  booking: { bg: '#003580', border: '#003580' },  // bleu foncé
  direct: { bg: '#10B981', border: '#10B981' },   // vert
  vrbo: { bg: '#1569C7', border: '#1569C7' },
  expedia: { bg: '#FFC72C', border: '#FFC72C' }
};

function normalizeSourceToKey(raw) {
  if (!raw) return 'direct';
  const v = String(raw).toLowerCase();
  if (v.includes('airbnb')) return 'airbnb';
  if (v.includes('booking')) return 'booking';
  if (v.includes('vrbo') || v.includes('abritel') || v.includes('homeaway')) return 'vrbo';
  if (v.includes('expedia')) return 'expedia';
  return 'direct';
}

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
// CALENDAR
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
      const sourceKey = normalizeSourceToKey(
        info.event.extendedProps.source || info.event.extendedProps.sourceRaw
      );

      if (sourceKey === 'airbnb') classes.push('bh-event-airbnb');
      else if (sourceKey === 'booking') classes.push('bh-event-booking');
      else classes.push('bh-event-direct');

      return classes;
    },

    // contenu HTML de l’event : logement + badge + voyageur
    eventContent: function(arg) {
      const props = arg.event.extendedProps || {};
      const property = props.propertyName || 'Logement';
      const sourceKey = props.source || normalizeSourceToKey(props.sourceRaw);
      const guest = arg.event.title || '';

      const wrapper = document.createElement('div');
      wrapper.className = 'bh-event-inner';

      let sourceBadge = '';
      if (sourceKey) {
        const letter =
          sourceKey === 'airbnb' ? 'A' :
          sourceKey === 'booking' ? 'B' :
          'D';
        sourceBadge = `<span class="bh-event-source bh-source-${sourceKey}">${letter}</span>`;
      }

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

// 👉 nouvelle version : couleurs basées sur la plateforme de la réservation
function updateCalendarEvents() {
  if (!calendar) return;

  const events = allReservations
    .filter(r => activeFilters.size === 0 || (r.property && activeFilters.has(r.property.id)))
    .map(r => {
      const guestLabel = r.guestName || 'Voyageur';
      const propertyName = (r.property && r.property.name) || 'Logement';
      const sourceKey = normalizeSourceToKey(r.source);
      const colors = SOURCE_COLORS[sourceKey] || SOURCE_COLORS.direct;

      return {
        title: guestLabel,
        start: r.start,
        end: r.end,
        backgroundColor: colors.bg,
        borderColor: colors.border,
        extendedProps: {
          reservation: r,
          propertyName: propertyName,
          sourceRaw: r.source || null, // valeur brute "Airbnb", "Booking.com"...
          source: sourceKey            // clé normalisée "airbnb", "booking"...
        }
      };
    });

  calendar.removeAllEvents();
  calendar.addEventSource(events);
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

    console.log('DEBUG PROPERTIES', JSON.stringify(data.properties, null, 2));
    console.log('DEBUG RESERVATIONS', JSON.stringify(allReservations, null, 2));

    // pour les notifications
    window.LCC_RESERVATIONS = allReservations;

    // Carte "Vue d’ensemble"
    updateOverviewFromReservations(allReservations);

    // Stats + filtres
    updateStats(data);
    renderPropertyFilters(data.properties || []);

    // Onboarding "Bien démarrer"
    updateOnboardingFromData(data);

    // Calendrier FullCalendar
    updateCalendarEvents();

    // Calendrier moderne (vue tableau par logement)
    if (window.renderModernCalendar) {
      try {
        window.renderModernCalendar(allReservations, data.properties || []);
      } catch (e) {
        console.warn('Erreur calendrier moderne', e);
      }
    }

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
// Petit helper pour ne pas planter si les éléments de stats n'existent pas sur cette page
function safeSetText(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = value;
  }
}

function updateStats(data) {
  const reservations = data.reservations || [];

  // on utilise le helper pour éviter les erreurs
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

  // Si tu avais d'autres stats (CA, taux d'occupation, etc.),
  // applique la même logique safeSetText('id', valeur)
}

// ========================================
// ONBOARDING ("Bien démarrer avec Boostinghost")
// ========================================

function updateOnboardingFromData(data) {
  if (!data) data = {};
  const properties = Array.isArray(data.properties) ? data.properties : [];
  const reservations = Array.isArray(data.reservations) ? data.reservations : [];

  // User depuis le localStorage (pour Stripe / messages)
  let user = null;
  try {
    const rawUser = localStorage.getItem('lcc_user');
    user = rawUser ? JSON.parse(rawUser) : null;
  } catch (e) {
    console.warn('Impossible de lire lcc_user pour l’onboarding', e);
  }

    const detection = {
    // Étape 1 : au moins 1 logement créé
    property: properties.length > 0,

    // Étape 2 : au moins un iCal actif
    // (simplifié : s’il y a déjà des réservations OU des propriétés avec count > 0)
    ical: hasIcalConfigured(properties, reservations),

    // Étape 3 : Stripe connecté (on regarde user + data backend)
    stripe: detectStripe(user, data),

    // Étape 4 : messages auto configurés
    messages: detectMessages(user)
  };


  let doneCount = 0;
  let totalCount = 0;

  ['property', 'ical', 'stripe', 'messages'].forEach(stepKey => {
    const stepEl = document.querySelector('.onboarding-step[data-step="' + stepKey + '"]');
    if (!stepEl) return;

    totalCount++;

    let isDone = detection[stepKey];

    // Si on ne sait pas détecter (undefined), on lit l’état actuel dans le DOM
    if (typeof isDone === 'undefined') {
      const statusEl = stepEl.querySelector('.onboarding-step-status');
      if (statusEl) {
        const txt = (statusEl.textContent || '').toLowerCase();
        isDone = txt.indexOf('termin') !== -1; // "Terminé"
      } else {
        isDone = false;
      }
    } else {
      // Sinon on force l’état dans le DOM
      applyOnboardingStepStatus(stepKey, isDone);
    }

    if (isDone) doneCount++;
  });

  const progressEl = document.getElementById('onboardingProgressValue');
  if (progressEl) {
    progressEl.textContent = String(doneCount);
  }
}

// Étape 2 : on considère qu’un iCal est connecté
// dès qu’il y a au moins une réservation ou un "count" > 0 sur un logement
function hasIcalConfigured(properties, reservations) {
  if (Array.isArray(reservations) && reservations.length > 0) return true;
  if (Array.isArray(properties) && properties.some(p => p.count && p.count > 0)) return true;
  return false;
}

// Étape 3 : détection Stripe (best effort)
// - user.stripeConnected === true
// - ou user.stripeAccountId défini
// - ou flag LCC_STRIPE_CONNECTED dans le localStorage
// Étape 3 : détection Stripe (best effort)
// - flag localStorage LCC_STRIPE_CONNECTED
// - ou infos renvoyées par l'API dans "data"
// - ou champs dans lcc_user (stripeConnected / stripeAccountId / stripeAccount)
function detectStripe(user, data) {
  // 1) Override manuel possible
  if (localStorage.getItem('LCC_STRIPE_CONNECTED')) return true;

  // 2) Infos venant du backend (data = réponse /api/reservations)
  if (data) {
    // exemple : { stripeConnected: true }
    if (data.stripeConnected === true) return true;

    // exemple : { stripe: { connected: true } }
    if (data.stripe && data.stripe.connected === true) return true;

    // exemple : { account: { stripeConnected: true } }
    if (data.account && data.account.stripeConnected === true) return true;
  }

  // 3) Infos côté user (localStorage lcc_user)
  if (user) {
    if (typeof user.stripeConnected === 'boolean') {
      return user.stripeConnected;
    }
    if (user.stripeAccountId || user.stripeAccount) {
      return true;
    }
  }

  // 4) On ne sait pas → on laisse l’état HTML (maquette)
  return undefined;
}


// Étape 4 : détection messages automatiques
// - user.autoMessagesConfigured === true
// - ou flag LCC_MESSAGES_CONFIGURED dans le localStorage
function detectMessages(user) {
  if (localStorage.getItem('LCC_MESSAGES_CONFIGURED')) return true;
  if (!user) return undefined;

  if (typeof user.autoMessagesConfigured === 'boolean') {
    return user.autoMessagesConfigured;
  }

  // on ne sait pas → on laisse l’état HTML
  return undefined;
}

// Applique l’état "Terminé / À faire" visuellement pour un step
function applyOnboardingStepStatus(stepKey, isDone) {
  const stepEl = document.querySelector('.onboarding-step[data-step="' + stepKey + '"]');
  if (!stepEl) return;

  const iconEl = stepEl.querySelector('.onboarding-step-icon');
  const statusEl = stepEl.querySelector('.onboarding-step-status');

  if (iconEl) {
    iconEl.classList.remove('done', 'todo');
    iconEl.classList.add(isDone ? 'done' : 'todo');
  }

  if (statusEl) {
    statusEl.classList.remove('done', 'todo');
    statusEl.classList.add(isDone ? 'done' : 'todo');
    statusEl.textContent = isDone ? 'Terminé' : 'À faire';
  }
}


function renderPropertyFilters(properties) {
  const container = document.getElementById('propertyFilters');
  if (!container) return;

  if (!properties.length) {
    container.innerHTML = '<p class="overview-empty">Aucun logement configuré.</p>';
    return;
  }

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

  const badge = document.querySelector(`[data-property-id="${propertyId}"]`);
  if (badge) {
    badge.classList.toggle('active');
  }

  updateCalendarEvents();

  // Le calendrier moderne lit window.activeFilters, que l'on met à jour par référence
}

function clearFilters() {
  activeFilters.clear();

  document
    .querySelectorAll('.property-badge')
    .forEach(badge => badge.classList.remove('active'));

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

// ========================================
// MOBILE MENU (TODO)
// ========================================
// (rien de spécial ici pour l’instant)
