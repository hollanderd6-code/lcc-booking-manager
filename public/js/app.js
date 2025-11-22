// ========================================
// PLATFORM APP - MODERN BOOKING MANAGER
// ========================================
const API_URL = 'https://lcc-booking-manager.onrender.com';

let calendar = null;
let allReservations = [];
let activeFilters = new Set();

// expose filters for the modern grid calendar (calendrier moderne)
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

  // Initialize calendar (FullCalendar)
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

  // View buttons (mois / semaine / liste) pour le FullCalendar classique
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
// CALENDAR (FullCalendar)
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
    titleFormat: { month: 'long', year: 'numeric' },
    dayHeaderFormat: { weekday: 'short', day: '2-digit' },

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

// 👉 FullCalendar : couleurs basées sur la plateforme
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

    // Sauvegarde pour d'autres scripts (KPI, notifications, onboarding, etc.)
    try {
      localStorage.setItem('LCC_RESERVATIONS', JSON.stringify(allReservations));
      localStorage.setItem('LCC_PROPERTIES', JSON.stringify(data.properties || []));
    } catch (e) {
      console.warn("Impossible d'enregistrer les données en localStorage", e);
    }

    // pour les notifications & calendrier moderne
    window.LCC_RESERVATIONS = allReservations;
    window.LCC_PROPERTIES = data.properties || [];
    window.LCC_RAW_DATA = data;

    // Carte "Vue d’ensemble"
    updateOverviewFromReservations(allReservations);

    // Stats + filtres
    updateStats(data);
    renderPropertyFilters(data.properties || []);

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

    // Onboarding (Bien démarrer avec Boostinghost)
    updateOnboardingFromData(data);

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
  // le calendrier moderne lit window.activeFilters qui pointe vers le même Set
}

function clearFilters() {
  activeFilters.clear();

  document
    .querySelectorAll('.property-badge')
    .forEach(badge => badge.classList.remove('active'));

  updateCalendarEvents();
}

// ========================================
// ONBOARDING ("Bien démarrer avec Boostinghost")
// ========================================

function updateOnboardingFromData(data) {
  const properties = data && Array.isArray(data.properties) ? data.properties : [];
  const reservations = data && Array.isArray(data.reservations) ? data.reservations : [];

  let user = null;
  try {
    const rawUser = localStorage.getItem('lcc_user');
    user = rawUser ? JSON.parse(rawUser) : null;
  } catch (e) {
    console.warn("Impossible de lire lcc_user pour l'onboarding", e);
  }

  const detection = {
    // Étape 1 : au moins 1 logement créé
    property: properties.length > 0,

    // Étape 2 : liens iCal configurés (ou au moins une réservation déjà remontée)
    ical: hasIcalConfigured(properties, reservations),

    // Étape 3 : Stripe connecté (scan large de tout ce qui contient "stripe")
    stripe: detectStripe(user, data),

    // Étape 4 : messages auto (best effort, sinon on laisse comme dans le HTML)
    messages: detectMessages(user)
  };

  applyOnboardingDetection(detection);
}

function hasIcalConfigured(properties, reservations) {
  // Si on a déjà des réservations, on considère que des iCal sont branchés
  if (reservations && reservations.length > 0) return true;
  if (!properties) return false;

  for (let i = 0; i < properties.length; i++) {
    const p = properties[i] || {};

    if (Array.isArray(p.icals) && p.icals.length) return true;
    if (Array.isArray(p.icalUrls) && p.icalUrls.length) return true;
    if (Array.isArray(p.icalLinks) && p.icalLinks.length) return true;
    if (Array.isArray(p.ical_links) && p.ical_links.length) return true;

    if (typeof p.ical === 'string' && p.ical.trim() !== '') return true;
    if (typeof p.icalAirbnb === 'string' && p.icalAirbnb.trim() !== '') return true;
    if (typeof p.icalBooking === 'string' && p.icalBooking.trim() !== '') return true;
  }

  return false;
}

// Étape 3 : Stripe (scan très large des données pour s'adapter à ton backend)
function detectStripe(user, data) {
  // 1) Override manuel possible
  try {
    if (localStorage.getItem('LCC_STRIPE_CONNECTED') === '1') return true;
  } catch (e) {}

  // 2) Infos backend directes
  if (data) {
    if (data.stripeConnected === true) return true;
    if (data.stripe && data.stripe.connected === true) return true;
    if (data.account && data.account.stripeConnected === true) return true;

    // Scan générique des clés contenant "stripe"
    for (const key in data) {
      if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
      if (!key) continue;
      if (key.toLowerCase().includes('stripe')) {
        const val = data[key];
        if (val === true) return true;
        if (typeof val === 'string' && val.trim() !== '') return true;
        if (val && typeof val === 'object') {
          for (const subKey in val) {
            if (!Object.prototype.hasOwnProperty.call(val, subKey)) continue;
            const subVal = val[subKey];
            const lk = subKey.toLowerCase();
            if ((lk.includes('connected') || lk.includes('enabled') || lk.includes('active')) && subVal === true) {
              return true;
            }
            if (typeof subVal === 'string' && subVal.trim() !== '') return true;
          }
        }
      }
    }
  }

  // 3) Infos dans l'utilisateur stocké en localStorage
  if (user) {
    for (const key in user) {
      if (!Object.prototype.hasOwnProperty.call(user, key)) continue;
      if (!key) continue;
      if (key.toLowerCase().includes('stripe')) {
        const val = user[key];
        if (val === true) return true;
        if (typeof val === 'string' && val.trim() !== '') return true;
        if (val && typeof val === 'object') {
          for (const subKey in val) {
            if (!Object.prototype.hasOwnProperty.call(val, subKey)) continue;
            const subVal = val[subKey];
            const lk = subKey.toLowerCase();
            if ((lk.includes('connected') || lk.includes('enabled') || lk.includes('active')) && subVal === true) {
              return true;
            }
            if (typeof subVal === 'string' && subVal.trim() !== '') return true;
          }
        }
      }
    }
  }

  // 4) Si on ne trouve rien → "À faire"
  return false;
}

function detectMessages(user) {
  // Override manuel possible
  try {
    if (localStorage.getItem('LCC_MESSAGES_CONFIGURED') === '1') return true;
  } catch (e) {}

  if (!user) return undefined;

  for (const key in user) {
    if (!Object.prototype.hasOwnProperty.call(user, key)) continue;
    const lk = key.toLowerCase();
    if (lk.includes('message') || lk.includes('auto') || lk.includes('scenario')) {
      const val = user[key];
      if (val === true) return true;
      if (typeof val === 'string' && val.trim() !== '') return true;
      if (Array.isArray(val) && val.length) return true;
      if (val && typeof val === 'object') {
        for (const subKey in val) {
          if (!Object.prototype.hasOwnProperty.call(val, subKey)) continue;
          const subVal = val[subKey];
          if (subVal === true) return true;
          if (typeof subVal === 'string' && subVal.trim() !== '') return true;
        }
      }
    }
  }

  // On ne sait pas → on laisse l'état du HTML (maquette)
  return undefined;
}

function applyOnboardingDetection(detection) {
  const stepKeys = ['property', 'ical', 'stripe', 'messages'];

  // 1) On applique les états uniquement pour les steps où on a un booléen
  stepKeys.forEach(stepKey => {
    const value = detection[stepKey];

    if (typeof value !== 'boolean') {
      // pas d’info → on laisse le HTML tel quel
      return;
    }

    const stepEl = document.querySelector(`.onboarding-step[data-step="${stepKey}"]`);
    if (!stepEl) return;

    const iconEl = stepEl.querySelector('.onboarding-step-icon');
    const statusEl = stepEl.querySelector('.onboarding-step-status');

    if (value) {
      stepEl.classList.add('done');
      stepEl.classList.remove('todo');
      if (iconEl) {
        iconEl.classList.add('done');
        iconEl.classList.remove('todo');
      }
      if (statusEl) {
        statusEl.textContent = 'Terminé';
        statusEl.classList.add('done');
        statusEl.classList.remove('todo');
      }
    } else {
      stepEl.classList.add('todo');
      stepEl.classList.remove('done');
      if (iconEl) {
        iconEl.classList.add('todo');
        iconEl.classList.remove('done');
      }
      if (statusEl) {
        statusEl.textContent = 'À faire';
        statusEl.classList.add('todo');
        statusEl.classList.remove('done');
      }
    }
  });

  // 2) On recalcule le X/4 en comptant les steps "Terminé" visibles dans le DOM
  let completed = 0;
  document.querySelectorAll('.onboarding-step-status').forEach(statusEl => {
    const txt = (statusEl.textContent || '').toLowerCase();
    if (txt.includes('terminé')) {
      completed++;
    }
  });

  const progressEl = document.getElementById('onboardingProgressValue');
  if (progressEl) {
    progressEl.textContent = String(completed);
  }
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
