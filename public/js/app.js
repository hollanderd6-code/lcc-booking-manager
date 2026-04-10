// ========================================

// ── Nom d'affichage : nom interne si défini, sinon nom normal
function displayName(property) {
  if (!property) return 'Logement';
  return property.internalName || property.internal_name || property.name || 'Logement';
}

// PLATFORM APP - MODERN BOOKING MANAGER
// ========================================
const API_URL = 'https://lcc-booking-manager.onrender.com';

let allProperties = [];
let calendar = null;
let allReservations = [];
let activeFilters = new Set();

// expose filters for the modern grid calendar
window.activeFilters = activeFilters;

// Colors by source/platform (for both calendars)
const SOURCE_COLORS = {
  airbnb:  { bg: '#FF5A5F', border: '#FF5A5F' },
  booking: { bg: '#003580', border: '#003580' },
  direct:  { bg: '#10B981', border: '#10B981' },
  vrbo:    { bg: '#1569C7', border: '#1569C7' },
  expedia: { bg: '#FFC72C', border: '#FFC72C' },
  abritel: { bg: '#0096D6', border: '#0096D6' },
  block:   { bg: '#6B7280', border: '#6B7280' }
};

function normalizeSourceToKey(raw, otaName) {
  // Channex ota_name codes
  if (otaName) {
    const o = String(otaName).toUpperCase();
    if (o === 'ABB' || o.includes('AIRBNB'))    return 'airbnb';
    if (o === 'BDC' || o.includes('BOOKING'))   return 'booking';
    if (o === 'EXP' || o.includes('EXPEDIA'))   return 'expedia';
    if (o === 'VRBO' || o === 'HOMEAWAY' || o.includes('ABRITEL') || o.includes('VRBO')) return 'vrbo';
    if (o === 'ABRITEL')                  return 'abritel';
  }
  if (!raw) return 'direct';
  const v = String(raw).toLowerCase();
  if (v.includes('airbnb'))  return 'airbnb';
  if (v.includes('booking')) return 'booking';
  if (v.includes('vrbo') || v.includes('abritel') || v.includes('homeaway')) return 'vrbo';
  if (v.includes('expedia')) return 'expedia';
  if (v.includes('block'))   return 'block';
  return 'direct';
}
  }
  if (!raw) return 'direct';
  const v = String(raw).toLowerCase();
  if (v.includes('airbnb'))  return 'airbnb';
  if (v.includes('booking')) return 'booking';
  if (v.includes('vrbo') || v.includes('abritel') || v.includes('homeaway')) return 'vrbo';
  if (v.includes('expedia')) return 'expedia';
  if (v.includes('block'))   return 'block';
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

  // View buttons (mois / semaine / liste) – FullCalendar
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

  // Reservation modal close
  const modalClose = document.getElementById('modalClose');
  if (modalClose) {
    modalClose.addEventListener('click', () => {
      document.getElementById('reservationModal').classList.remove('active');
    });
  }

  // Close reservation modal on backdrop click
  const modal = document.getElementById('reservationModal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('active');
      }
    });
  }

  // ===== Modal blocage calendrier =====
  const blockModalClose = document.getElementById('blockModalClose');
  if (blockModalClose) {
    blockModalClose.addEventListener('click', closeBlockModal);
  }

  const blockModalCancel = document.getElementById('blockModalCancel');
  if (blockModalCancel) {
    blockModalCancel.addEventListener('click', closeBlockModal);
  }

  const blockSaveBtn = document.getElementById('blockSaveBtn');
  if (blockSaveBtn) {
    blockSaveBtn.addEventListener('click', submitBlockForm);
  }

  const blockModal = document.getElementById('blockModal');
  if (blockModal) {
    blockModal.addEventListener('click', (e) => {
      if (e.target === blockModal) {
        closeBlockModal();
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
    locale: 'fr',
    firstDay: 1,
    height: 'auto',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: ''
    },
    buttonText: {
      today: "Aujourd'hui",
      month: 'Mois',
      week: 'Semaine',
      list: 'Liste'
    },
    titleFormat: { month: 'long', year: 'numeric' },
    dayHeaderFormat: { weekday: 'short', day: '2-digit' },

    selectable: true,
    selectMirror: true,
    select: handleCalendarSelect,

    eventDisplay: 'block',
    dayMaxEvents: 4,

    eventClick: function (info) {
      if (info.event.extendedProps && info.event.extendedProps.reservation) {
        showReservationModal(info.event.extendedProps.reservation);
      }
    },

    // classes CSS selon la source (Airbnb / Booking / Direct / Block)
    eventClassNames: function(info) {
      const classes = ['bh-event'];
      const sourceKey = normalizeSourceToKey(
        info.event.extendedProps.source || info.event.extendedProps.sourceRaw,
        info.event.extendedProps.otaName
      );

      if (sourceKey === 'airbnb') classes.push('bh-event-airbnb');
      else if (sourceKey === 'booking') classes.push('bh-event-booking');
      else if (sourceKey === 'block') classes.push('bh-event-block');
      else classes.push('bh-event-direct');

      return classes;
    },

    // contenu HTML de l’event : logement + badge + voyageur / blocage
    eventContent: function(arg) {
      const props = arg.event.extendedProps || {};
      const property = props.propertyName || 'Logement';
      const sourceKey = props.source || normalizeSourceToKey(props.sourceRaw, props.otaName);
      const guest = arg.event.title || '';

      const wrapper = document.createElement('div');
      wrapper.className = 'bh-event-inner';

      let sourceBadge = '';
      if (sourceKey) {
        const letter =
          sourceKey === 'airbnb'  ? 'A' :
          sourceKey === 'booking' ? 'B' :
          sourceKey === 'expedia' ? 'E' :
          sourceKey === 'vrbo'    ? 'V' :
          sourceKey === 'abritel' ? 'Ab' :
          sourceKey === 'block'   ? 'X' :
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

// Gestion de la sélection pour créer un blocage
function handleCalendarSelect(info) {
  // on nettoie la sélection visuelle de FullCalendar
  if (calendar) {
    calendar.unselect();
  }

  const modal = document.getElementById('blockModal');
  if (!modal) return;

  // Pré-remplir les dates
  const startInput = document.getElementById('blockStartDate');
  const endInput = document.getElementById('blockEndDate');

  const startStr = info.startStr.slice(0, 10); // YYYY-MM-DD
  const endStr = info.endStr ? info.endStr.slice(0, 10) : startStr;

  if (startInput) startInput.value = startStr;
  if (endInput) endInput.value = endStr;

  // Remplir la liste des logements
  const select = document.getElementById('blockPropertySelect');
  if (select) {
    select.innerHTML = '';
    (allProperties || []).forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = displayName(p);
      select.appendChild(opt);
    });
  }

  // Motif vide par défaut
  const reasonInput = document.getElementById('blockReason');
  if (reasonInput) {
    reasonInput.value = '';
  }

  modal.classList.add('active');
}

function closeBlockModal() {
  const modal = document.getElementById('blockModal');
  if (modal) {
    modal.classList.remove('active');
  }
}

// 👉 FullCalendar : couleurs basées sur la plateforme de la réservation
function updateCalendarEvents() {
  if (!calendar) return;

  const events = allReservations
    .filter(r => activeFilters.size === 0 || (r.property && activeFilters.has(r.property.id)))
    .map(r => {
      const sourceKey = normalizeSourceToKey(r.source, r.ota_name || r.otaName);
      const colors = SOURCE_COLORS[sourceKey] || SOURCE_COLORS.direct;

      let title;
      if (sourceKey === 'block') {
        title = r.notes || 'Blocage';
      } else {
        title = r.guestName || 'Voyageur';
      }

      const propertyName = displayName(r.property) || 'Logement';

      // Ajouter 6h UTC à la fin pour que la barre déborde sur le jour de départ
      // (symbolise un départ le matin de ce jour) — fonctionne pour 1 nuit comme pour plusieurs
      let displayEnd = r.end;
      if (r.end) {
        // Normaliser en date pure avant d'ajouter les heures, pour éviter les décalages timezone
        const dateStr = r.end.length >= 10 ? r.end.slice(0, 10) : r.end;
        const endDate = new Date(dateStr + 'T00:00:00Z');
        endDate.setUTCHours(6, 0, 0, 0);
        displayEnd = endDate.toISOString();
      }

      return {
        title,
        start: r.start,
        end: displayEnd,
        backgroundColor: colors.bg,
        borderColor: colors.border,
        extendedProps: {
          reservation: r,
          propertyName: propertyName,
          sourceRaw: r.source || null,
          source: sourceKey,
          otaName: r.ota_name || r.otaName || null
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
      todayDepartures.push({ res: r, end });
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
      label: `Arrivée – ${res.propertyName || displayName(res.property) || 'Logement'}`,
      time: start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    });
  });

  currentStays.forEach(({ res }) => {
    items.push({
      type: 'stay',
      label: `Séjour en cours – ${res.propertyName || displayName(res.property) || 'Logement'}`,
      time: ''
    });
  });

  todayDepartures.forEach(({ res, end }) => {
    items.push({
      type: 'departure',
      label: `Départ – ${res.propertyName || displayName(res.property) || 'Logement'}`,
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
    allProperties = data.properties || [];

    console.log('DEBUG PROPERTIES', JSON.stringify(data.properties, null, 2));
    console.log('DEBUG RESERVATIONS', JSON.stringify(allReservations, null, 2));

    // pour les notifications
    window.LCC_RESERVATIONS = allReservations;

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

    // Onboarding (Bien démarrer) + cartes de statut (Airbnb, Booking, Stripe, Messages)
    try {
      const rawUser = localStorage.getItem('lcc_user');
      const user = rawUser ? JSON.parse(rawUser) : null;
      const detection = bhDetectOnboarding(user, data);
      console.log('DEBUG ONBOARDING', detection);
      bhApplyOnboardingDetection(detection);
      bhUpdateStatusCards(detection, data);
    } catch (e) {
      console.warn('Onboarding / status detection error', e);
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
      <span>${displayName(p)}</span>
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

  // Met à jour le calendrier FullCalendar
  updateCalendarEvents();

  // Met à jour aussi le calendrier moderne (vue tableau)
  if (typeof window.renderModernCalendar === 'function') {
    try {
      window.renderModernCalendar(allReservations, allProperties);
    } catch (e) {
      console.warn('Erreur lors de la mise à jour du calendrier moderne (filtres)', e);
    }
  }
}


function clearFilters() {
  activeFilters.clear();

  document
    .querySelectorAll('.property-badge')
    .forEach(badge => badge.classList.remove('active'));

  // Met à jour le calendrier FullCalendar
  updateCalendarEvents();

  // Met à jour aussi le calendrier moderne (vue tableau)
  if (typeof window.renderModernCalendar === 'function') {
    try {
      window.renderModernCalendar(allReservations, allProperties);
    } catch (e) {
      console.warn('Erreur lors de la mise à jour du calendrier moderne (clearFilters)', e);
    }
  }
}

// ========================================
// MODALS
// ========================================

function showReservationModal(reservation) {
  console.log('showReservationModal', reservation); // pour debug

  if (!reservation) return;

  const modal = document.getElementById('reservationModal');
  const modalBody = document.getElementById('modalBody');

  if (!modal || !modalBody) return;

  const propertyName =
    (reservation.property && displayName(reservation.property)) ||
    reservation.propertyName ||
    'Logement';

  const platformRaw =
    reservation.source ||
    reservation.platform ||
    reservation.channel ||
    'Direct';

  const platform = String(platformRaw).toUpperCase();

  const guestName =
    reservation.guestName ||
    reservation.customerName ||
    'Voyageur';

  const notes = reservation.notes || '';

  const start = reservation.start || reservation.checkIn || reservation.startDate;
  const end   = reservation.end   || reservation.checkOut || reservation.endDate;

  const startDate = start ? new Date(start) : null;
  const endDate   = end   ? new Date(end)   : null;

  let nights = reservation.nights;
  if (!nights && startDate && endDate) {
    const diffMs = endDate.getTime() - startDate.getTime();
    nights = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
  }

  // Réservation manuelle ?
  const isManual =
    reservation.type === 'manual' ||
    String(platformRaw).toUpperCase() === 'MANUEL';

  // Contenu très simple pour limiter les erreurs de syntaxe
  let html = '';

  html += '<div class="reservation-modal-body">';
  html +=   '<h3 style="margin-bottom:8px;">' + propertyName + '</h3>';
  html +=   '<p style="margin:0 0 4px 0;font-size:13px;color:var(--text-secondary);">';
  html +=     'Source : ' + platform;
  html +=   '</p>';
  html +=   '<p style="margin:0 0 12px 0;font-size:15px;font-weight:600;">';
  html +=     'Voyageur : ' + guestName;
  html +=   '</p>';

  html +=   '<p style="margin:0 0 4px 0;">Arrivée : ' +
              (startDate ? startDate.toLocaleDateString('fr-FR') : '') +
            '</p>';
  html +=   '<p style="margin:0 0 8px 0;">Départ : ' +
              (endDate ? endDate.toLocaleDateString('fr-FR') : '') +
            '</p>';
  html +=   '<p style="margin:0 0 12px 0;">Nuits : ' + (nights || '') + '</p>';

  if (notes) {
    html += '<p style="margin:0 0 12px 0;white-space:pre-wrap;">';
    html +=   'Notes : ' + notes;
    html += '</p>';
  }

  html +=   '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
  html +=     '<a href="/messages.html" class="btn btn-primary">';
  html +=       '<i class="fas fa-comments"></i>';
  html +=       '<span style="margin-left:6px;">Ouvrir la messagerie</span>';
  html +=     '</a>';

  if (isManual) {
    html +=   '<button type="button" class="btn btn-ghost" id="deleteReservationBtn">';
    html +=     '<i class="fas fa-trash"></i>';
    html +=     '<span style="margin-left:6px;">Supprimer cette réservation</span>';
    html +=   '</button>';
  }

  html +=   '</div>';

  if (!isManual && platform !== 'DIRECT') {
    html += '<p style="margin-top:12px;font-size:12px;color:var(--text-secondary);">';
    html +=   'Cette réservation provient de ' + platform + '. Les modifications se font sur la plateforme.';
    html += '</p>';
  }

  html += '</div>';

  modalBody.innerHTML = html;
  modal.classList.add('active');

  // Gestion du bouton SUPPRIMER (pour les réservations manuelles uniquement)
  if (isManual) {
    const deleteBtn = document.getElementById('deleteReservationBtn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async function () {
        if (!reservation.uid) {
          alert("Impossible de supprimer : identifiant manquant.");
          return;
        }

        if (!confirm("Supprimer définitivement cette réservation manuelle ?")) {
          return;
        }

        try {
          const token = localStorage.getItem('lcc_token');
          const headers = { 'Content-Type': 'application/json' };
          if (token) {
            headers['Authorization'] = 'Bearer ' + token;
          }

          const resp = await fetch(
            API_URL + '/api/reservations/manual/' + encodeURIComponent(reservation.uid),
            { method: 'DELETE', headers }
          );

          if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error || 'Erreur lors de la suppression de la réservation.');
          }

          if (typeof loadReservations === 'function') {
            try {
              await loadReservations();
            } catch (e) {
              console.warn('Erreur lors du rechargement des réservations après suppression', e);
            }
          }

          modal.classList.remove('active');
        } catch (e) {
          console.error('Erreur suppression réservation manuelle', e);
          alert(e.message || 'Erreur lors de la suppression de la réservation.');
        }
      });
    }
  }
}


// Création d’un blocage depuis le modal
async function submitBlockForm() {
  const propertySelect = document.getElementById('blockPropertySelect');
  const startInput = document.getElementById('blockStartDate');
  const endInput = document.getElementById('blockEndDate');
  const reasonInput = document.getElementById('blockReason');

  const propertyId = propertySelect ? propertySelect.value : '';
  const startDate = startInput ? startInput.value : '';
  const endDate = endInput ? endInput.value : '';
  const reason = reasonInput ? reasonInput.value : '';
console.log('🔍 submitBlockForm - propertySelect:', propertySelect);
  console.log('🔍 submitBlockForm - propertyId:', propertyId);
  console.log('🔍 submitBlockForm - startDate:', startDate);
  console.log('🔍 submitBlockForm - endDate:', endDate);
  
  console.log('PropertyId sélectionné:', propertyId);
  if (!propertyId || !startDate || !endDate) {
    showToast('Merci de choisir un logement et des dates', 'error');
    return;
  }

  try {
    showLoading();
    const token = localStorage.getItem('lcc_token');

    const response = await fetch(`${API_URL}/api/blocks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token
      },
      body: JSON.stringify({
        propertyId: propertyId, 
        start: startDate,
        end: endDate,
        reason: reason || 'Blocage manuel'
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'Erreur lors de la création du blocage');
    }

    showToast('Blocage créé', 'success');
    closeBlockModal();

    // Recharge les réservations pour voir le blocage dans le calendrier
    await loadReservations();
  } catch (err) {
    console.error('Erreur création blocage:', err);
    showToast(err.message || 'Erreur lors de la création du blocage', 'error');
  } finally {
    hideLoading();
  }
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
// ONBOARDING ("Bien démarrer avec Boostinghost")
// ========================================

function bhDetectOnboarding(user, data) {
  return {
    property: bhDetectProperty(user, data),
    ical: bhDetectIcal(user, data),
    stripe: bhDetectStripe(user, data),
    messages: bhDetectMessages(user, data)
  };
}

// Étape 1 : au moins un logement
function bhDetectProperty(user, data) {
  if (data && Array.isArray(data.properties) && data.properties.length > 0) {
    return true;
  }

  if (data && Array.isArray(data.reservations)) {
    const hasProp = data.reservations.some(r =>
      r.property || r.propertyId || r.propertyName
    );
    if (hasProp) return true;
  }

  try {
    const stored = JSON.parse(localStorage.getItem('LCC_PROPERTIES') || '[]');
    if (Array.isArray(stored) && stored.length > 0) return true;
  } catch (e) {}

  return false;
}

// Étape 2 : liens iCal
function bhDetectIcal(user, data) {
  // Channex — détecter si au moins un logement est connecté
  if (data && Array.isArray(data.properties)) {
    for (const p of data.properties) {
      if (p && p.channexEnabled === true) return true;
    }
  }
  // Fallback : réservation OTA via Channex
  const res = data && Array.isArray(data.reservations) ? data.reservations : [];
  for (const r of res) {
    if (r && r.source === 'channex') return true;
  }
  return false;
}
// Étape 3 : Stripe
function bhDetectStripe(user, data) {
  // 1) override manuel possible (au cas où)
  try {
    if (localStorage.getItem('LCC_STRIPE_CONNECTED') === '1') return true;
  } catch (e) {}

  // 2) flags explicites possibles dans data (backend)
  if (data) {
    if (data.stripeConnected === true) return true;
    if (data.hasStripe === true) return true;

    if (data.stripe && data.stripe.connected === true) return true;
    if (data.account && data.account.stripeConnected === true) return true;
    if (data.payments && data.payments.stripeConnected === true) return true;
  }

  // 3) flags explicites possibles dans user (localStorage lcc_user)
  if (user) {
    if (user.stripeConnected === true) return true;
    if (user.hasStripe === true) return true;

    if (user.stripe && user.stripe.connected === true) return true;
    if (user.account && user.account.stripeConnected === true) return true;
    if (user.payments && user.payments.stripeConnected === true) return true;
  }

  // 4) Scan générique : si "stripe" apparaît quelque part, on considère que c’est connecté
  try {
    const sData = JSON.stringify(data || {});
    const sUser = JSON.stringify(user || {});
    const all = (sData + ' ' + sUser).toLowerCase();
    if (all.includes('stripe')) {
      return true;
    }
  } catch (e) {
    console.warn('bhDetectStripe stringify error', e);
  }

  // Aucune trace → on considère "À faire"
  return false;
}

// Étape 4 : messages automatiques
function bhDetectMessages(user, data) {
  // On ne met "À faire" que si on a un signal clair de "pas activé".
  // Sinon, on laisse le HTML par défaut (souvent "Terminé" dans ta maquette).

  if (data) {
    if (data.messagesConfigured === true) return true;
    if (data.autoMessages && data.autoMessages.enabled === true) return true;
  }

  if (user) {
    if (user.messagesConfigured === true) return true;
    if (user.autoMessages && user.autoMessages.enabled === true) return true;
  }

  // pas d’info → on ne force rien
  return undefined;
}

// Appliquer la détection sur le bloc "Bien démarrer"
function bhApplyOnboardingDetection(detection) {
  const stepKeys = ['property', 'ical', 'stripe', 'messages'];

  // 1) Appliquer les états seulement quand on a un booléen
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

  // 2) Recalculer X/4 complétées en lisant le DOM
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
// STATUS CARDS (Airbnb / Booking / Stripe / Messages)
// ========================================

function bhDetectAirbnb(data) {
  const res = data && Array.isArray(data.reservations) ? data.reservations : [];
  for (const r of res) {
    if (!r) continue;
    const src = (r.source || r.channel || r.platform || '').toLowerCase();
    if (src.includes('airbnb')) return true;
  }

  // scan très générique des propriétés au cas où il y ait des URL airbnb
  if (data && Array.isArray(data.properties)) {
    for (const p of data.properties) {
      if (!p || typeof p !== 'object') continue;
      for (const key in p) {
        if (!Object.prototype.hasOwnProperty.call(p, key)) continue;
        const v = p[key];
        if (typeof v === 'string' && v.toLowerCase().includes('airbnb')) return true;
      }
    }
  }

  return false;
}

function bhDetectBookingProvider(data) {
  const res = data && Array.isArray(data.reservations) ? data.reservations : [];
  for (const r of res) {
    if (!r) continue;
    const src = (r.source || r.channel || r.platform || '').toLowerCase();
    if (src.includes('booking')) return true;
  }

  if (data && Array.isArray(data.properties)) {
    for (const p of data.properties) {
      if (!p || typeof p !== 'object') continue;
      for (const key in p) {
        if (!Object.prototype.hasOwnProperty.call(p, key)) continue;
        const v = p[key];
        if (typeof v === 'string' && v.toLowerCase().includes('booking.com')) return true;
      }
    }
  }

  return false;
}

function bhUpdateStatusCards(detection, data) {
  // Airbnb
  try {
    const airbnbConnected = bhDetectAirbnb(data);
    const airbnbIcon = document.querySelector('.status-icon-airbnb');
    const airbnbCard = airbnbIcon ? airbnbIcon.closest('.status-card') : null;

    if (airbnbCard) {
      const label = airbnbCard.querySelector('.status-label');
      const text = airbnbCard.querySelector('p');
      const btn = airbnbCard.querySelector('button');

      if (airbnbConnected) {
        if (label) {
          label.textContent = 'Connecté';
          label.classList.remove('status-warning');
          label.classList.add('status-ok');
        }
        if (text) {
          text.textContent = 'Synchronisation Channex active.';
        }
        if (btn) {
          btn.textContent = 'Gérer les connexions';
          btn.classList.remove('btn-secondary');
          btn.classList.add('btn-ghost');
        }
      } else {
        if (label) {
          label.textContent = 'À connecter';
          label.classList.remove('status-ok');
          label.classList.add('status-warning');
        }
        if (text) {
          text.textContent = 'Connectez Airbnb via Channex.';
        }
        if (btn) {
          btn.textContent = 'Connecter via Channex';
          btn.classList.remove('btn-ghost');
          btn.classList.add('btn-secondary');
        }
      }
    }
  } catch (e) {
    console.warn('bhUpdateStatusCards Airbnb error', e);
  }

  // Booking.com
  try {
    const bookingConnected = bhDetectBookingProvider(data);
    const bookingIcon = document.querySelector('.status-icon-booking');
    const bookingCard = bookingIcon ? bookingIcon.closest('.status-card') : null;

    if (bookingCard) {
      const label = bookingCard.querySelector('.status-label');
      const text = bookingCard.querySelector('p');
      const btn = bookingCard.querySelector('button');

      if (bookingConnected) {
        if (label) {
          label.textContent = 'Connecté';
          label.classList.remove('status-warning');
          label.classList.add('status-ok');
        }
        if (text) {
          text.textContent = 'Synchronisation Channex active.';
        }
        if (btn) {
          btn.textContent = 'Gérer les connexions';
          btn.classList.remove('btn-secondary');
          btn.classList.add('btn-ghost');
        }
      } else {
        if (label) {
          label.textContent = 'À connecter';
          label.classList.remove('status-ok');
          label.classList.add('status-warning');
        }
        if (text) {
          text.textContent = 'Connectez Booking.com via Channex.';
        }
        if (btn) {
          btn.textContent = 'Connecter via Channex';
          btn.classList.remove('btn-ghost');
          btn.classList.add('btn-secondary');
        }
      }
    }
  } catch (e) {
    console.warn('bhUpdateStatusCards Booking error', e);
  }

  // Stripe
  try {
    const stripeConnected = detection.stripe === true;
    const stripeIcon = document.querySelector('.status-icon-stripe');
    const stripeCard = stripeIcon ? stripeIcon.closest('.status-card') : null;

    if (stripeCard) {
      const label = stripeCard.querySelector('.status-label');
      const text = stripeCard.querySelector('p');
      const btn = stripeCard.querySelector('button');

      if (stripeConnected) {
        if (label) {
          label.textContent = 'Connecté';
          label.classList.remove('status-warning');
          label.classList.add('status-ok');
        }
        if (text) {
          text.textContent = 'Cautions et paiements sécurisés.';
        }
        if (btn) {
          btn.textContent = 'Voir les cautions';
          btn.classList.remove('btn-secondary');
          btn.classList.add('btn-ghost');
        }
      } else {
        if (label) {
          label.textContent = 'À connecter';
          label.classList.remove('status-ok');
          label.classList.add('status-warning');
        }
        if (text) {
          text.textContent = 'Connectez Stripe pour sécuriser vos paiements.';
        }
        if (btn) {
          btn.textContent = 'Connecter Stripe';
          btn.classList.remove('btn-ghost');
          btn.classList.add('btn-secondary');
        }
      }
    }
  } catch (e) {
    console.warn('bhUpdateStatusCards Stripe error', e);
  }

  // Messages automatiques
  try {
    const messagesState = detection.messages; // true / false / undefined
    const aiIcon = document.querySelector('.status-icon-ai');
    const aiCard = aiIcon ? aiIcon.closest('.status-card') : null;

    if (aiCard && typeof messagesState === 'boolean') {
      const label = aiCard.querySelector('.status-label');
      const text = aiCard.querySelector('p');
      const btn = aiCard.querySelector('button');

      if (messagesState) {
        if (label) {
          label.textContent = 'Actif';
          label.classList.remove('status-warning');
          label.classList.add('status-ok');
        }
        if (text) {
          text.textContent = 'Scénarios IA prêts pour vos voyageurs.';
        }
        if (btn) {
          btn.textContent = 'Configurer';
          btn.classList.add('btn-ghost');
        }
      } else {
        if (label) {
          label.textContent = 'À configurer';
          label.classList.remove('status-ok');
          label.classList.add('status-warning');
        }
        if (text) {
          text.textContent = 'Configurez vos scénarios de messages automatiques.';
        }
        if (btn) {
          btn.textContent = 'Configurer';
        }
      }
    }
  } catch (e) {
    console.warn('bhUpdateStatusCards Messages error', e);
  }
}
