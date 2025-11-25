// ============================================
// CALENDRIER MODERNE - REMPLISSAGE AUTOMATIQUE
// Attend que state existe puis remplit tout
// ============================================

(function() {
  'use strict';

  console.log('🚀 Chargement calendrier moderne...');

  // Attendre que state ET le calendrier existent
  function waitAndFill() {
    if (typeof window.state === 'undefined' || !window.state.properties) {
      console.log('⏳ Attente de state...');
      setTimeout(waitAndFill, 200);
      return;
    }

    if (!document.getElementById('propertyList') || !document.getElementById('calendarGrid')) {
      console.log('⏳ Attente du DOM...');
      setTimeout(waitAndFill, 200);
      return;
    }

    console.log('✅ State et DOM prêts, initialisation...');
    initCalendar();
  }

  function initCalendar() {
    const props = window.state.properties || [];
    const bookings = window.state.bookings || [];
    
    console.log('📊 Données:', props.length, 'logements,', bookings.length, 'réservations');

    // Remplir la liste des logements
    fillPropertyList();
    
    // Activer les clics
    attachClickListeners();
    
    // Activer le bouton +
    activateFAB();
    
    console.log('✅ Calendrier moderne actif !');
  }

  function fillPropertyList() {
    const container = document.getElementById('propertyList');
    if (!container) return;

    const props = window.state.properties || [];
    
    if (props.length === 0) {
      container.innerHTML = '<div style="padding: 12px; color: #6b7280; text-align: center;">Aucun logement</div>';
      return;
    }

    container.innerHTML = '';
    
    props.forEach(property => {
      const item = document.createElement('div');
      item.className = 'property-item';
      item.dataset.propertyId = property.id;
      item.style.cssText = `
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        cursor: pointer;
        border-radius: 8px;
        margin-bottom: 4px;
        transition: all 0.2s;
      `;
      
      // Compter les réservations
      const bookings = window.state.bookings || [];
      const count = bookings.filter(b => String(b.propertyId) === String(property.id)).length;
      
      item.innerHTML = `
        <div style="width: 32px; height: 32px; border-radius: 8px; background: rgba(16,185,129,0.1); color: #10B981; display: flex; align-items: center; justify-content: center;">
          <i class="fas fa-home"></i>
        </div>
        <span style="flex: 1; font-size: 14px; font-weight: 500;">${property.name}</span>
        ${count > 0 ? `<span style="background: #10B981; color: white; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 12px;">${count}</span>` : ''}
      `;
      
      item.addEventListener('mouseenter', () => {
        item.style.background = 'rgba(16, 185, 129, 0.08)';
      });
      
      item.addEventListener('mouseleave', () => {
        item.style.background = '';
      });
      
      item.addEventListener('click', () => {
        if (typeof selectProperty === 'function') {
          selectProperty(property.id);
        }
      });
      
      container.appendChild(item);
    });
    
    console.log('✅ Liste logements remplie:', props.length, 'logements');
  }

  function attachClickListeners() {
    const grid = document.getElementById('calendarGrid');
    if (!grid) return;

    grid.addEventListener('click', function(e) {
      const bookingBlock = e.target.closest('.booking-block');
      if (bookingBlock && bookingBlock.dataset.bookingId) {
        const bookingId = bookingBlock.dataset.bookingId;
        const bookings = window.state.bookings || [];
        const booking = bookings.find(b => String(b.id) === String(bookingId));
        
        if (booking) {
          console.log('🖱️ Clic sur réservation:', booking.guestName);
          showBookingDetails(booking);
        }
      }
    });
    
    console.log('✅ Clics sur réservations actifs');
  }

  function activateFAB() {
    const fab = document.getElementById('addBookingBtn');
    if (!fab) return;

    fab.addEventListener('click', openNewBookingModal);
    console.log('✅ Bouton + actif');
  }

  function showBookingDetails(booking) {
    window.currentBookingDetails = booking;
    
    const modal = document.getElementById('reservationDetailsModal');
    const content = document.getElementById('reservationDetailsContent');
    
    if (!modal || !content) {
      console.warn('Modal introuvable');
      return;
    }

    const props = window.state.properties || [];
    const property = props.find(p => String(p.id) === String(booking.propertyId));
    const propertyName = property ? property.name : 'Logement inconnu';

    const platformColors = {
      'airbnb': '#FF5A5F',
      'booking': '#003580',
      'direct': '#10B981',
      'expedia': '#FFC72C',
      'vrbo': '#1569C7'
    };

    const platform = (booking.source || booking.platform || 'direct').toLowerCase();
    const platformColor = platformColors[platform] || '#10B981';

    const startDate = new Date(booking.startDate);
    const endDate = new Date(booking.endDate);
    const nights = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));

    content.innerHTML = `
      <div class="detail-group">
        <label><i class="fas fa-user"></i> Client</label>
        <div class="detail-value">${booking.guestName || 'Non renseigné'}</div>
      </div>

      <div class="detail-group">
        <label><i class="fas fa-home"></i> Logement</label>
        <div class="detail-value">${propertyName}</div>
      </div>

      <div class="detail-group">
        <label><i class="fas fa-calendar-check"></i> Arrivée</label>
        <div class="detail-value">${formatDate(startDate)}</div>
      </div>

      <div class="detail-group">
        <label><i class="fas fa-calendar-times"></i> Départ</label>
        <div class="detail-value">${formatDate(endDate)}</div>
      </div>

      <div class="detail-group">
        <label><i class="fas fa-moon"></i> Nuitées</label>
        <div class="detail-value">${nights} nuit${nights > 1 ? 's' : ''}</div>
      </div>

      <div class="detail-group">
        <label><i class="fas fa-tag"></i> Plateforme</label>
        <div class="detail-value">
          <span style="background:${platformColor}; color:white; padding:4px 12px; border-radius:4px; font-size:12px; font-weight:600;">
            ${platform.toUpperCase()}
          </span>
        </div>
      </div>

      ${booking.price ? `
      <div class="detail-group">
        <label><i class="fas fa-euro-sign"></i> Prix</label>
        <div class="detail-value">${booking.price} €</div>
      </div>` : ''}

      ${booking.notes ? `
      <div class="detail-group">
        <label><i class="fas fa-sticky-note"></i> Notes</label>
        <div class="detail-value">${booking.notes}</div>
      </div>` : ''}
    `;

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function openNewBookingModal() {
    const modal = document.getElementById('bookingModal');
    if (!modal) return;

    // Réinitialiser le formulaire
    const form = document.getElementById('bookingForm');
    if (form) form.reset();

    // Remplir le select des logements
    fillPropertySelect('bookingProperty');

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    console.log('✅ Modal nouvelle réservation ouvert');
  }

  function fillPropertySelect(selectId) {
    const select = document.getElementById(selectId);
    if (!select) {
      console.warn('Select introuvable:', selectId);
      return;
    }

    const props = window.state.properties || [];
    
    select.innerHTML = '<option value="">Sélectionner un logement</option>';
    
    props.forEach(p => {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = p.name;
      select.appendChild(option);
    });
    
    console.log('✅ Select rempli:', props.length, 'logements');
  }

  function formatDate(date) {
    if (!date) return '';
    const d = new Date(date);
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return d.toLocaleDateString('fr-FR', options);
  }

  // Démarrer
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitAndFill);
  } else {
    waitAndFill();
  }

})();
