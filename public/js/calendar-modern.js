// ============================================
// CALENDRIER MODERNE - JAVASCRIPT
// ============================================

(function() {
  'use strict';

  // Configuration
  const CONFIG = {
    API_URL: window.location.origin,
    MONTHS: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 
             'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
    MONTHS_SHORT: ['jan', 'fév', 'mar', 'avr', 'mai', 'jui', 
                   'jul', 'aoû', 'sep', 'oct', 'nov', 'déc'],
    DAYS: ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'],
    DAYS_SHORT: ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'],
    PLATFORMS: {
      airbnb: { name: 'Airbnb', color: '#FF5A5F' },
      booking: { name: 'Booking.com', color: '#003580' },
      direct: { name: 'Direct', color: '#10B981' }
    }
  };

  // État de l'application
  const state = {
    currentView: 'month',
    currentDate: new Date(),
    selectedDate: null,
    properties: [],
    bookings: [],
    loading: false,
    selectedProperty: null,
    selectedBooking: null
  };

  // Éléments DOM
  const elements = {
    viewTabs: null,
    prevPeriodBtn: null,
    nextPeriodBtn: null,
    periodDisplay: null,
    monthSelector: null,
    monthIndicator: null,
    propertyList: null,
    daysHeader: null,
    calendarGrid: null,
    bookingModal: null,
    modalOverlay: null,
    bookingForm: null,
    addBookingBtn: null
  };

  // ============================================
  // INITIALISATION
  // ============================================

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    if (!checkAuth()) return;
    
    initializeElements();
    attachEventListeners();
    loadUserData();
    loadProperties();
    initializeCalendar();
  }

  function checkAuth() {
    // Dans app.html, on est déjà authentifié
    // Pas besoin de vérifier le token localStorage
    return true;
  }

  function initializeElements() {
    elements.viewTabs = document.querySelectorAll('.view-tab');
    elements.prevPeriodBtn = document.getElementById('prevPeriod');
    elements.nextPeriodBtn = document.getElementById('nextPeriod');
    elements.periodDisplay = document.querySelector('.period-display');
    elements.monthSelector = document.getElementById('monthSelector');
    elements.monthIndicator = document.getElementById('currentMonthName');
    elements.propertyList = document.getElementById('propertyList');
    elements.daysHeader = document.getElementById('daysHeader');
    elements.calendarGrid = document.getElementById('calendarGrid');
    elements.bookingModal = document.getElementById('bookingModal');
    elements.modalOverlay = document.getElementById('modalOverlay');
    elements.bookingForm = document.getElementById('bookingForm');
    elements.addBookingBtn = document.getElementById('addBookingBtn');
    
    // Mobile menu elements
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    const sidebar = document.querySelector('.sidebar');
    
    if (mobileMenuBtn && sidebarOverlay && sidebar) {
      mobileMenuBtn.addEventListener('click', () => {
        sidebar.classList.add('active');
        sidebarOverlay.classList.add('active');
      });
      
      sidebarOverlay.addEventListener('click', () => {
        sidebar.classList.remove('active');
        sidebarOverlay.classList.remove('active');
      });
    }
  }

  function attachEventListeners() {
    // View tabs
    elements.viewTabs.forEach(tab => {
      tab.addEventListener('click', () => changeView(tab.dataset.view));
    });

    // Period navigation
    if (elements.prevPeriodBtn) elements.prevPeriodBtn.addEventListener('click', navigatePrevious);
    if (elements.nextPeriodBtn) elements.nextPeriodBtn.addEventListener('click', navigateNext);

    // Month selector
    document.querySelectorAll('.month-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const month = parseInt(btn.dataset.month);
        state.currentDate.setMonth(month);
        updateCalendar();
      });
    });

    // Booking Modal
    if (elements.addBookingBtn) elements.addBookingBtn.addEventListener('click', openBookingModal);
    const closeModal = document.getElementById('closeModal');
    const cancelBooking = document.getElementById('cancelBooking');
    if (closeModal) closeModal.addEventListener('click', closeBookingModal);
    if (cancelBooking) cancelBooking.addEventListener('click', closeBookingModal);
    if (elements.modalOverlay) elements.modalOverlay.addEventListener('click', closeBookingModal);
    if (elements.bookingForm) elements.bookingForm.addEventListener('submit', handleBookingSubmit);

    // Details Modal
    const closeDetailsModalBtn = document.getElementById('closeDetailsModal');
    const closeDetailsBtn = document.getElementById('closeDetailsBtn');
    const detailsModalOverlay = document.getElementById('detailsModalOverlay');
    const editBookingBtn = document.getElementById('editBookingBtn');
    const deleteBookingBtn = document.getElementById('deleteBookingBtn');
    
    if (closeDetailsModalBtn) closeDetailsModalBtn.addEventListener('click', closeDetailsModal);
    if (closeDetailsBtn) closeDetailsBtn.addEventListener('click', closeDetailsModal);
    if (detailsModalOverlay) detailsModalOverlay.addEventListener('click', closeDetailsModal);
    if (editBookingBtn) editBookingBtn.addEventListener('click', openEditBookingModal);
    if (deleteBookingBtn) deleteBookingBtn.addEventListener('click', deleteBooking);

    // Edit Modal
    const closeEditModalBtn = document.getElementById('closeEditModal');
    const cancelEditBooking = document.getElementById('cancelEditBooking');
    const editModalOverlay = document.getElementById('editModalOverlay');
    const editBookingForm = document.getElementById('editBookingForm');
    
    if (closeEditModalBtn) closeEditModalBtn.addEventListener('click', closeEditModal);
    if (cancelEditBooking) cancelEditBooking.addEventListener('click', closeEditModal);
    if (editModalOverlay) editModalOverlay.addEventListener('click', closeEditModal);
    if (editBookingForm) editBookingForm.addEventListener('submit', handleEditBookingSubmit);

    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);
  }

  // ============================================
  // GESTION DES VUES
  // ============================================

  function changeView(view) {
    state.currentView = view;
    
    // Update active tab
    elements.viewTabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.view === view);
    });
    
    // Show/hide month selector for year view
    elements.monthSelector.style.display = view === 'year' ? 'flex' : 'none';
    
    updateCalendar();
  }

  function navigatePrevious() {
    switch (state.currentView) {
      case 'day':
        state.currentDate.setDate(state.currentDate.getDate() - 1);
        break;
      case 'week':
        state.currentDate.setDate(state.currentDate.getDate() - 7);
        break;
      case 'month':
        state.currentDate.setMonth(state.currentDate.getMonth() - 1);
        break;
      case 'year':
        state.currentDate.setFullYear(state.currentDate.getFullYear() - 1);
        break;
    }
    updateCalendar();
  }

  function navigateNext() {
    switch (state.currentView) {
      case 'day':
        state.currentDate.setDate(state.currentDate.getDate() + 1);
        break;
      case 'week':
        state.currentDate.setDate(state.currentDate.getDate() + 7);
        break;
      case 'month':
        state.currentDate.setMonth(state.currentDate.getMonth() + 1);
        break;
      case 'year':
        state.currentDate.setFullYear(state.currentDate.getFullYear() + 1);
        break;
    }
    updateCalendar();
  }

  // ============================================
  // CHARGEMENT DES DONNÉES
  // ============================================

  function loadUserData() {
    const user = JSON.parse(localStorage.getItem('lcc_user') || '{}');
    if (user) {
      document.getElementById('sidebarUserName').textContent = 
        user.firstName ? `${user.firstName} ${user.lastName || ''}` : user.email;
      document.getElementById('sidebarUserCompany').textContent = 
        user.company || 'Mon espace';
      document.getElementById('sidebarUserAvatar').textContent = 
        (user.firstName || user.email || '?')[0].toUpperCase();
    }
  }

  async function loadProperties() {
    try {
      const response = await fetch(`${CONFIG.API_URL}/api/properties`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (response.ok) {
        const data = await response.json();
        // Gérer à la fois le format array et le format {logements: [...]}
        state.properties = Array.isArray(data) ? data : (data.logements || data.properties || []);
        renderPropertyList();
        loadBookings();
      } else {
        console.error('Erreur chargement logements:', response.status);
      }
    } catch (error) {
      console.error('Erreur lors du chargement des logements:', error);
    }
  }

  async function loadBookings() {
    try {
      state.loading = true;
      showLoading();
      
      const response = await fetch(`${CONFIG.API_URL}/api/reservations`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (response.ok) {
        const data = await response.json();
        state.bookings = data.reservations || data || [];
        updateCalendar();
      } else {
        console.error('Erreur chargement réservations:', response.status);
      }
    } catch (error) {
      console.error('Erreur lors du chargement des réservations:', error);
    } finally {
      state.loading = false;
    }
  }

  // ============================================
  // RENDU DU CALENDRIER
  // ============================================

  function initializeCalendar() {
    updatePeriodDisplay();
    updateMonthIndicator();
    updateCalendar();
  }

  function updateCalendar() {
    updatePeriodDisplay();
    updateMonthIndicator();
    
    switch (state.currentView) {
      case 'day':
        renderDayView();
        break;
      case 'week':
        renderWeekView();
        break;
      case 'month':
        renderMonthView();
        break;
      case 'year':
        renderYearView();
        break;
    }
  }

  function updatePeriodDisplay() {
    const year = state.currentDate.getFullYear();
    const month = CONFIG.MONTHS[state.currentDate.getMonth()];
    const day = state.currentDate.getDate();
    
    switch (state.currentView) {
      case 'day':
        elements.periodDisplay.innerHTML = `<span>${day} ${month} ${year}</span>`;
        break;
      case 'week':
        const weekStart = getWeekStart(state.currentDate);
        const weekEnd = getWeekEnd(state.currentDate);
        elements.periodDisplay.innerHTML = `<span>Semaine du ${weekStart.getDate()} au ${weekEnd.getDate()} ${month}</span>`;
        break;
      case 'month':
        elements.periodDisplay.innerHTML = `<span>${month} ${year}</span>`;
        break;
      case 'year':
        elements.periodDisplay.innerHTML = `<span class="period-year">${year}</span>`;
        break;
    }
  }

  function updateMonthIndicator() {
    const month = CONFIG.MONTHS[state.currentDate.getMonth()];
    elements.monthIndicator.textContent = month;
    
    // Update month selector buttons
    document.querySelectorAll('.month-btn').forEach((btn, index) => {
      btn.classList.toggle('active', index === state.currentDate.getMonth());
    });
  }

  function renderPropertyList() {
    elements.propertyList.innerHTML = '';
    
    if (state.properties.length === 0) {
      elements.propertyList.innerHTML = `
        <div class="property-item">
          <span style="color: var(--text-secondary);">Aucun logement</span>
        </div>
      `;
      return;
    }
    
    state.properties.forEach(property => {
      const item = document.createElement('div');
      item.className = 'property-item';
      item.dataset.propertyId = property.id;
      item.textContent = property.name;
      item.addEventListener('click', () => selectProperty(property.id));
      elements.propertyList.appendChild(item);
    });
  }

  // ============================================
  // VUE MENSUELLE
  // ============================================

  function renderMonthView() {
    const year = state.currentDate.getFullYear();
    const month = state.currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    
    // Render days header
    renderDaysHeader(1, daysInMonth);
    
    // Clear grid
    elements.calendarGrid.innerHTML = '';
    
    // Render property rows
    state.properties.forEach(property => {
      const row = document.createElement('div');
      row.className = 'calendar-row';
      row.dataset.propertyId = property.id;
      
      for (let day = 1; day <= daysInMonth; day++) {
        const cell = createCalendarCell(property, year, month, day);
        row.appendChild(cell);
      }
      
      elements.calendarGrid.appendChild(row);
    });
    
    // Add bookings to cells
    renderBookingsInCells();
  }

  function renderDaysHeader(startDay, endDay) {
    elements.daysHeader.innerHTML = '';
    
    const year = state.currentDate.getFullYear();
    const month = state.currentDate.getMonth();
    
    for (let day = startDay; day <= endDay; day++) {
      const date = new Date(year, month, day);
      const dayOfWeek = date.getDay();
      
      const header = document.createElement('div');
      header.className = 'day-header';
      
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        header.classList.add('weekend');
      }
      
      if (isToday(date)) {
        header.classList.add('today');
      }
      
      header.innerHTML = `
        <span class="day-name">${CONFIG.DAYS_SHORT[dayOfWeek]}</span>
        <span class="day-number">${day}</span>
      `;
      
      elements.daysHeader.appendChild(header);
    }
  }

  function createCalendarCell(property, year, month, day) {
    const cell = document.createElement('div');
    cell.className = 'calendar-cell';
    cell.dataset.propertyId = property.id;
    cell.dataset.date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    
    const date = new Date(year, month, day);
    const dayOfWeek = date.getDay();
    
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      cell.classList.add('weekend');
    }
    
    if (isToday(date)) {
      cell.classList.add('today');
    }
    
    // Add click handler for creating bookings
    cell.addEventListener('click', (e) => {
      if (!e.target.classList.contains('booking-block')) {
        openBookingModalWithDate(property.id, cell.dataset.date);
      }
    });
    
    // Add price if available
    const price = getPropertyPrice(property, date);
    if (price) {
      const priceEl = document.createElement('span');
      priceEl.className = 'cell-price';
      priceEl.textContent = `${price}€`;
      cell.appendChild(priceEl);
    }
    
    return cell;
  }

  function renderBookingsInCells() {
    state.bookings.forEach(booking => {
      const startDate = new Date(booking.checkIn);
      const endDate = new Date(booking.checkOut);
      
      // Find all cells for this booking
      const cells = [];
      let currentDate = new Date(startDate);
      
      while (currentDate <= endDate) {
        const dateStr = formatDateForCell(currentDate);
        const cell = document.querySelector(`.calendar-cell[data-property-id="${booking.propertyId}"][data-date="${dateStr}"]`);
        
        if (cell) {
          cells.push(cell);
        }
        
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      // Add booking blocks to cells
      cells.forEach((cell, index) => {
        const block = document.createElement('div');
        block.className = `booking-block ${booking.platform || 'direct'}`;
        block.dataset.bookingId = booking.id;
        
        // Style for first, middle, and last cells
        if (cells.length === 1) {
          block.classList.add('single');
        } else if (index === 0) {
          block.classList.add('start');
        } else if (index === cells.length - 1) {
          block.classList.add('end');
        }
        
        // Only show guest name on first cell
        if (index === 0 || cells.length === 1) {
          block.textContent = booking.guestName || 'Réservation';
        }
        
        // Add click handler
        block.addEventListener('click', (e) => {
          e.stopPropagation();
          showBookingDetails(booking);
        });
        
        cell.appendChild(block);
      });
    });
  }

  // ============================================
  // VUE HEBDOMADAIRE
  // ============================================

  function renderWeekView() {
    const weekStart = getWeekStart(state.currentDate);
    const weekEnd = getWeekEnd(state.currentDate);
    
    // Render days header for the week
    const startDay = weekStart.getDate();
    const endDay = weekEnd.getDate();
    
    renderWeekDaysHeader(weekStart);
    
    // Clear grid
    elements.calendarGrid.innerHTML = '';
    
    // Render property rows for the week
    state.properties.forEach(property => {
      const row = document.createElement('div');
      row.className = 'calendar-row';
      row.dataset.propertyId = property.id;
      
      for (let i = 0; i < 7; i++) {
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + i);
        
        const cell = createCalendarCell(
          property, 
          date.getFullYear(), 
          date.getMonth(), 
          date.getDate()
        );
        row.appendChild(cell);
      }
      
      elements.calendarGrid.appendChild(row);
    });
    
    // Add bookings to cells
    renderBookingsInCells();
  }

  function renderWeekDaysHeader(weekStart) {
    elements.daysHeader.innerHTML = '';
    
    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + i);
      const dayOfWeek = date.getDay();
      
      const header = document.createElement('div');
      header.className = 'day-header';
      
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        header.classList.add('weekend');
      }
      
      if (isToday(date)) {
        header.classList.add('today');
      }
      
      header.innerHTML = `
        <span class="day-name">${CONFIG.DAYS_SHORT[dayOfWeek]}</span>
        <span class="day-number">${date.getDate()}</span>
      `;
      
      elements.daysHeader.appendChild(header);
    }
  }

  // ============================================
  // VUE JOURNALIÈRE
  // ============================================

  function renderDayView() {
    const year = state.currentDate.getFullYear();
    const month = state.currentDate.getMonth();
    const day = state.currentDate.getDate();
    
    // Render single day header
    renderDaysHeader(day, day);
    
    // Clear grid
    elements.calendarGrid.innerHTML = '';
    
    // Render property rows for single day
    state.properties.forEach(property => {
      const row = document.createElement('div');
      row.className = 'calendar-row';
      row.dataset.propertyId = property.id;
      
      const cell = createCalendarCell(property, year, month, day);
      row.appendChild(cell);
      
      elements.calendarGrid.appendChild(row);
    });
    
    // Add bookings to cells
    renderBookingsInCells();
  }

  // ============================================
  // VUE ANNUELLE
  // ============================================

  function renderYearView() {
    elements.daysHeader.innerHTML = '<div class="year-view-header">Vue annuelle</div>';
    elements.calendarGrid.innerHTML = '';
    
    const yearGrid = document.createElement('div');
    yearGrid.className = 'year-grid';
    yearGrid.style.display = 'grid';
    yearGrid.style.gridTemplateColumns = 'repeat(4, 1fr)';
    yearGrid.style.gap = '20px';
    yearGrid.style.padding = '20px';
    
    for (let month = 0; month < 12; month++) {
      const monthCard = createMonthCard(month);
      yearGrid.appendChild(monthCard);
    }
    
    elements.calendarGrid.appendChild(yearGrid);
  }

  function createMonthCard(month) {
    const card = document.createElement('div');
    card.className = 'month-card';
    card.style.background = 'white';
    card.style.borderRadius = 'var(--radius-lg)';
    card.style.padding = '16px';
    card.style.border = '1px solid var(--border-color)';
    card.style.cursor = 'pointer';
    
    const title = document.createElement('h3');
    title.textContent = CONFIG.MONTHS[month];
    title.style.fontSize = '16px';
    title.style.fontWeight = '600';
    title.style.marginBottom = '12px';
    title.style.color = 'var(--text-primary)';
    card.appendChild(title);
    
    // Add booking count
    const bookingCount = getMonthBookingCount(month);
    const count = document.createElement('div');
    count.textContent = `${bookingCount} réservations`;
    count.style.fontSize = '14px';
    count.style.color = 'var(--text-secondary)';
    card.appendChild(count);
    
    // Click to go to month view
    card.addEventListener('click', () => {
      state.currentDate.setMonth(month);
      changeView('month');
    });
    
    return card;
  }

  // ============================================
  // GESTION DES RÉSERVATIONS
  // ============================================

  function openBookingModal() {
    elements.bookingModal.classList.add('open');
    
    // Populate property select
    const propertySelect = document.getElementById('bookingProperty');
    propertySelect.innerHTML = '<option value="">Sélectionner un logement</option>';
    
    state.properties.forEach(property => {
      const option = document.createElement('option');
      option.value = property.id;
      option.textContent = property.name;
      propertySelect.appendChild(option);
    });
  }

  function openBookingModalWithDate(propertyId, date) {
    openBookingModal();
    
    // Pre-fill form
    document.getElementById('bookingProperty').value = propertyId;
    document.getElementById('checkIn').value = date;
    
    // Set check-out to next day by default
    const checkOut = new Date(date);
    checkOut.setDate(checkOut.getDate() + 1);
    document.getElementById('checkOut').value = formatDateForInput(checkOut);
  }

  function closeBookingModal() {
    elements.bookingModal.classList.remove('open');
    elements.bookingForm.reset();
  }

  async function handleBookingSubmit(e) {
    e.preventDefault();
    
    const formData = {
      propertyId: document.getElementById('bookingProperty').value,
      checkIn: document.getElementById('checkIn').value,
      checkOut: document.getElementById('checkOut').value,
      guestName: document.getElementById('guestName').value,
      guestPhone: document.getElementById('guestPhone').value,
      guestEmail: document.getElementById('guestEmail').value,
      platform: document.getElementById('platform').value,
      price: parseFloat(document.getElementById('price').value) || 0,
      notes: document.getElementById('notes').value,
      source: 'manual'
    };
    
    try {
      const response = await fetch(`${CONFIG.API_URL}/api/reservations/manual`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });
      
      if (response.ok) {
        const booking = await response.json();
        state.bookings.push(booking);
        updateCalendar();
        closeBookingModal();
        showNotification('Réservation ajoutée avec succès', 'success');
      } else {
        throw new Error('Erreur lors de l\'ajout de la réservation');
      }
    } catch (error) {
      console.error('Erreur:', error);
      showNotification('Erreur lors de l\'ajout de la réservation', 'error');
    }
  }

  function showBookingDetails(booking) {
    state.selectedBooking = booking;
    const modal = document.getElementById('reservationDetailsModal');
    const content = document.getElementById('reservationDetailsContent');
    
    if (!modal || !content) {
      console.warn('Modal de détails introuvable');
      return;
    }

    const property = state.properties.find(p => p.id === booking.propertyId);
    const checkIn = new Date(booking.checkIn);
    const checkOut = new Date(booking.checkOut);
    
    // Calculate number of nights
    const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
    
    // Get platform info
    const platformInfo = CONFIG.PLATFORMS[booking.platform || 'direct'];
    
    // Build HTML
    let detailsHTML = `
      <div style="display:flex;flex-direction:column;gap:20px;">
        
        <!-- Property Info -->
        <div style="display:flex;align-items:center;gap:12px;padding:16px;border-radius:12px;background:var(--bg-secondary);">
          <div style="width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:${platformInfo.color};color:white;font-size:20px;">
            <i class="fas fa-home"></i>
          </div>
          <div style="flex:1;">
            <div style="font-weight:700;font-size:16px;color:var(--text-primary);">
              ${property ? property.name : 'Logement'}
            </div>
            <div style="font-size:13px;color:var(--text-secondary);margin-top:2px;">
              <i class="fas fa-tag" style="margin-right:4px;"></i>
              ${platformInfo.name}
            </div>
          </div>
        </div>

        <!-- Guest Info -->
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-tertiary);margin-bottom:8px;">
            Informations voyageur
          </div>
          <div style="background:var(--bg-secondary);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:12px;">
            <div style="display:flex;align-items:center;gap:12px;">
              <div style="width:36px;height:36px;border-radius:999px;background:var(--primary-color);color:white;display:flex;align-items:center;justify-content:center;">
                <i class="fas fa-user"></i>
              </div>
              <div>
                <div style="font-weight:600;color:var(--text-primary);">${booking.guestName || 'Nom non renseigné'}</div>
                ${booking.guestEmail ? `<div style="font-size:13px;color:var(--text-secondary);margin-top:2px;"><i class="fas fa-envelope" style="margin-right:4px;"></i>${booking.guestEmail}</div>` : ''}
              </div>
            </div>
            ${booking.guestPhone ? `
              <div style="display:flex;align-items:center;gap:12px;padding-top:8px;border-top:1px solid var(--border-color);">
                <div style="width:36px;height:36px;border-radius:999px;background:var(--success-color);color:white;display:flex;align-items:center;justify-content:center;">
                  <i class="fas fa-phone"></i>
                </div>
                <div>
                  <div style="font-size:12px;color:var(--text-secondary);">Téléphone</div>
                  <div style="font-weight:600;color:var(--text-primary);">${booking.guestPhone}</div>
                </div>
              </div>
            ` : ''}
          </div>
        </div>

        <!-- Dates -->
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-tertiary);margin-bottom:8px;">
            Dates du séjour
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div style="background:var(--bg-secondary);border-radius:12px;padding:16px;">
              <div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px;">
                <i class="fas fa-sign-in-alt" style="margin-right:4px;"></i>
                Arrivée
              </div>
              <div style="font-weight:700;font-size:16px;color:var(--text-primary);">
                ${checkIn.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
              </div>
              <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">
                ${checkIn.toLocaleDateString('fr-FR', { weekday: 'long' })}
              </div>
            </div>
            <div style="background:var(--bg-secondary);border-radius:12px;padding:16px;">
              <div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px;">
                <i class="fas fa-sign-out-alt" style="margin-right:4px;"></i>
                Départ
              </div>
              <div style="font-weight:700;font-size:16px;color:var(--text-primary);">
                ${checkOut.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
              </div>
              <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">
                ${checkOut.toLocaleDateString('fr-FR', { weekday: 'long' })}
              </div>
            </div>
          </div>
          <div style="margin-top:12px;text-align:center;font-size:14px;color:var(--text-secondary);">
            <i class="fas fa-moon" style="margin-right:4px;"></i>
            ${nights} nuit${nights > 1 ? 's' : ''}
          </div>
        </div>

        <!-- Price -->
        ${booking.price ? `
          <div style="background:linear-gradient(135deg, var(--primary-color) 0%, var(--primary-dark) 100%);border-radius:12px;padding:16px;color:white;text-align:center;">
            <div style="font-size:12px;opacity:0.9;margin-bottom:4px;">Prix total</div>
            <div style="font-size:32px;font-weight:800;">${booking.price}€</div>
          </div>
        ` : ''}

        <!-- Notes -->
        ${booking.notes ? `
          <div>
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-tertiary);margin-bottom:8px;">
              Notes
            </div>
            <div style="background:var(--bg-secondary);border-radius:12px;padding:16px;">
              <div style="color:var(--text-primary);line-height:1.6;">${booking.notes}</div>
            </div>
          </div>
        ` : ''}

        <!-- Source Info -->
        ${booking.source ? `
          <div style="font-size:12px;color:var(--text-tertiary);text-align:center;padding:12px;background:var(--bg-secondary);border-radius:8px;">
            <i class="fas fa-info-circle" style="margin-right:4px;"></i>
            Source: ${booking.source === 'ical' ? 'Calendrier iCal' : 'Réservation manuelle'}
          </div>
        ` : ''}
      </div>
    `;

    content.innerHTML = detailsHTML;
    
    // Show/hide edit/delete buttons based on source
    const editBtn = document.getElementById('editBookingBtn');
    const deleteBtn = document.getElementById('deleteBookingBtn');
    
    if (booking.source === 'ical') {
      // Les réservations iCal ne peuvent pas être modifiées/supprimées
      editBtn.style.display = 'none';
      deleteBtn.style.display = 'none';
    } else {
      editBtn.style.display = 'inline-flex';
      deleteBtn.style.display = 'inline-flex';
    }
    
    modal.classList.add('open');
  }

  function openEditBookingModal() {
    if (!state.selectedBooking) return;
    
    const booking = state.selectedBooking;
    const modal = document.getElementById('editBookingModal');
    
    // Pre-fill form
    document.getElementById('editBookingId').value = booking.id;
    document.getElementById('editBookingSource').value = booking.source || 'manual';
    
    // Populate property select
    const propertySelect = document.getElementById('editBookingProperty');
    propertySelect.innerHTML = '<option value="">Sélectionner un logement</option>';
    state.properties.forEach(property => {
      const option = document.createElement('option');
      option.value = property.id;
      option.textContent = property.name;
      option.selected = property.id === booking.propertyId;
      propertySelect.appendChild(option);
    });
    
    // Fill other fields
    document.getElementById('editCheckIn').value = booking.checkIn.split('T')[0];
    document.getElementById('editCheckOut').value = booking.checkOut.split('T')[0];
    document.getElementById('editGuestName').value = booking.guestName || '';
    document.getElementById('editGuestPhone').value = booking.guestPhone || '';
    document.getElementById('editGuestEmail').value = booking.guestEmail || '';
    document.getElementById('editPlatform').value = booking.platform || 'direct';
    document.getElementById('editPrice').value = booking.price || '';
    document.getElementById('editNotes').value = booking.notes || '';
    
    // Close details modal and open edit modal
    closeDetailsModal();
    modal.classList.add('open');
  }

  async function handleEditBookingSubmit(e) {
    e.preventDefault();
    
    const bookingId = document.getElementById('editBookingId').value;
    const formData = {
      id: bookingId,
      propertyId: document.getElementById('editBookingProperty').value,
      checkIn: document.getElementById('editCheckIn').value,
      checkOut: document.getElementById('editCheckOut').value,
      guestName: document.getElementById('editGuestName').value,
      guestPhone: document.getElementById('editGuestPhone').value,
      guestEmail: document.getElementById('editGuestEmail').value,
      platform: document.getElementById('editPlatform').value,
      price: parseFloat(document.getElementById('editPrice').value) || 0,
      notes: document.getElementById('editNotes').value,
      source: document.getElementById('editBookingSource').value
    };
    
    try {
      const response = await fetch(`${CONFIG.API_URL}/api/reservations/manual/${bookingId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });
      
      if (response.ok) {
        const updatedBooking = await response.json();
        
        // Update in state
        const index = state.bookings.findIndex(b => b.id === bookingId);
        if (index !== -1) {
          state.bookings[index] = updatedBooking;
        }
        
        updateCalendar();
        closeEditModal();
        showNotification('Réservation modifiée avec succès', 'success');
      } else {
        throw new Error('Erreur lors de la modification');
      }
    } catch (error) {
      console.error('Erreur:', error);
      showNotification('Erreur lors de la modification de la réservation', 'error');
    }
  }

  async function deleteBooking() {
    if (!state.selectedBooking) return;
    
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette réservation ?')) {
      return;
    }
    
    const booking = state.selectedBooking;
    
    try {
      const response = await fetch(`${CONFIG.API_URL}/api/reservations/manual/${booking.id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        // Remove from state
        state.bookings = state.bookings.filter(b => b.id !== booking.id);
        
        updateCalendar();
        closeDetailsModal();
        showNotification('Réservation supprimée avec succès', 'success');
      } else {
        throw new Error('Erreur lors de la suppression');
      }
    } catch (error) {
      console.error('Erreur:', error);
      showNotification('Erreur lors de la suppression de la réservation', 'error');
    }
  }

  function closeDetailsModal() {
    const modal = document.getElementById('reservationDetailsModal');
    modal.classList.remove('open');
    state.selectedBooking = null;
  }

  function closeEditModal() {
    const modal = document.getElementById('editBookingModal');
    modal.classList.remove('open');
    document.getElementById('editBookingForm').reset();
  }

  // ============================================
  // FONCTIONS UTILITAIRES
  // ============================================

  function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
  }

  function getWeekEnd(date) {
    const weekStart = getWeekStart(date);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    return weekEnd;
  }

  function isToday(date) {
    const today = new Date();
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear();
  }

  function formatDateForCell(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function formatDateForInput(date) {
    return formatDateForCell(date);
  }

  function getPropertyPrice(property, date) {
    // TODO: Implement dynamic pricing
    return property.defaultPrice || 75;
  }

  function getMonthBookingCount(month) {
    const year = state.currentDate.getFullYear();
    return state.bookings.filter(booking => {
      const date = new Date(booking.checkIn);
      return date.getMonth() === month && date.getFullYear() === year;
    }).length;
  }

  function selectProperty(propertyId) {
    // Update selected state
    document.querySelectorAll('.property-item').forEach(item => {
      item.classList.toggle('selected', item.dataset.propertyId === propertyId);
    });
    
    state.selectedProperty = propertyId;
    
    // Highlight property row in calendar
    document.querySelectorAll('.calendar-row').forEach(row => {
      row.style.background = row.dataset.propertyId === propertyId ? 
        'var(--primary-light)' : 'transparent';
    });
  }

  function showLoading() {
    elements.calendarGrid.innerHTML = `
      <div class="calendar-loading">
        <i class="fas fa-spinner fa-spin"></i>
      </div>
    `;
  }

  function showNotification(message, type = 'success') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
      <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
      <span>${message}</span>
    `;
    
    // Add to body
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => notification.classList.add('show'), 10);
    
    // Remove after 3 seconds
    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  function logout() {
    localStorage.removeItem('lcc_token');
    localStorage.removeItem('lcc_user');
    window.location.href = '/login.html';
  }

})();
document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('reservationModal');
  const closeBtn = document.getElementById('modalClose');

  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => modal.classList.remove('active'));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('active');
    });
  }
});
