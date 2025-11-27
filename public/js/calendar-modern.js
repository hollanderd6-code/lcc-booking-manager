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
    const token = localStorage.getItem('lcc_token');
    if (!token) {
      window.location.href = '/login.html';
      return false;
    }
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
    elements.prevPeriodBtn.addEventListener('click', navigatePrevious);
    elements.nextPeriodBtn.addEventListener('click', navigateNext);

    // Month selector
    document.querySelectorAll('.month-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const month = parseInt(btn.dataset.month);
        state.currentDate.setMonth(month);
        updateCalendar();
      });
    });

    // Modal
    elements.addBookingBtn.addEventListener('click', openBookingModal);
    document.getElementById('closeModal').addEventListener('click', closeBookingModal);
    document.getElementById('cancelBooking').addEventListener('click', closeBookingModal);
    elements.modalOverlay.addEventListener('click', closeBookingModal);
    elements.bookingForm.addEventListener('submit', handleBookingSubmit);

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', logout);
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
      const token = localStorage.getItem('lcc_token');
      const response = await fetch(`${CONFIG.API_URL}/api/properties`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (response.ok) {
        state.properties = await response.json();
        renderPropertyList();
        loadBookings();
      }
    } catch (error) {
      console.error('Erreur lors du chargement des logements:', error);
    }
  }

  async function loadBookings() {
    try {
      state.loading = true;
      showLoading();

      const token = localStorage.getItem('lcc_token');
      const response = await fetch(`${CONFIG.API_URL}/api/reservations`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        const reservations = Array.isArray(data.reservations) ? data.reservations : [];

        state.bookings = reservations
          .map((r) => {
            const checkIn = r.checkIn || r.start;
            const checkOut = r.checkOut || r.end;
            if (!checkIn || !checkOut) return null;

            const property = r.property || {};
            let platformRaw = r.platform || r.source || '';
            let platform = (platformRaw || '').toString().toLowerCase();
            if (platform.includes('airbnb')) platform = 'airbnb';
            else if (platform.includes('booking')) platform = 'booking';
            else if (platform.includes('vrbo') || platform.includes('abritel') || platform.includes('homeaway')) platform = 'vrbo';
            else if (platform.includes('expedia')) platform = 'expedia';
            else if (platform.includes('block')) platform = 'block';
            else if (!platform) platform = 'direct';

            return {
              id: r.uid || r.id || `${property.id || 'prop'}-${checkIn}-${checkOut}`,
              propertyId: property.id || r.propertyId || null,
              propertyName: property.name || r.propertyName || '',
              propertyColor: property.color || r.propertyColor || '#CBD5E1',
              checkIn,
              checkOut,
              guestName: r.guestName || r.summary || '',
              platform,
              price: r.price || 0,
              type: r.type || (platform === 'block' ? 'block' : 'manual')
            };
          })
          .filter(Boolean);

        updateCalendar();
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

    const propertyId = document.getElementById('bookingProperty').value;
    const checkIn = document.getElementById('checkIn').value;
    const checkOut = document.getElementById('checkOut').value;
    const guestName = document.getElementById('guestName').value;
    const platform = document.getElementById('platform').value;
    const price = parseFloat(document.getElementById('price').value) || 0;

    if (!propertyId || !checkIn || !checkOut) {
      showNotification('Merci de sélectionner un logement et des dates.', 'error');
      return;
    }

    const notes = `Plateforme: ${platform || 'MANUEL'} - Prix: ${price || 0}€`;

    try {
      const token = localStorage.getItem('lcc_token');
      const response = await fetch(`${CONFIG.API_URL}/api/reservations/manual`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          propertyId,
          start: checkIn,
          end: checkOut,
          guestName,
          notes
        })
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        const r = data.reservation || {};
        const property = state.properties.find(p => p.id === propertyId) || {};

        let finalPlatform = (r.platform || platform || 'direct').toString().toLowerCase();

        const booking = {
          id: r.uid || r.id || `manual_${Date.now()}`,
          propertyId: property.id || propertyId,
          propertyName: property.name || '',
          propertyColor: property.color || '#CBD5E1',
          checkIn: r.start || checkIn,
          checkOut: r.end || checkOut,
          guestName: r.guestName || guestName || '',
          platform: finalPlatform,
          price: r.price || price || 0,
          type: r.type || 'manual'
        };

        state.bookings.push(booking);
        updateCalendar();
        closeBookingModal();
        showNotification('Réservation ajoutée avec succès');
      } else {
        console.error('Réponse serveur lors de l’ajout :', data);
        showNotification(data.error || 'Erreur lors de l\'ajout de la réservation', 'error');
      }
    } catch (error) {
      console.error('Erreur:', error);
      showNotification('Erreur lors de l\'ajout de la réservation', 'error');
    }
  }

  function showBookingDetails(booking) {
    // TODO: Implement booking details modal
    console.log('Booking details:', booking);
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
    // TODO: Implement notification system
    console.log(`${type}: ${message}`);
  }

  function logout() {
    localStorage.removeItem('lcc_token');
    localStorage.removeItem('lcc_user');
    window.location.href = '/login.html';
  }

})();
