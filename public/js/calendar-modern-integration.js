// ============================================
// INTÉGRATION CALENDRIER MODERNE DANS APP.HTML
// ============================================
// Ce script remplace le calendrier existant et utilise les mêmes données (state.properties, state.bookings)

(function() {
  'use strict';

  // Attendre que le DOM et les données soient chargées
  function initModernCalendar() {
    // Vérifier que state existe (défini dans app.html)
    if (typeof state === 'undefined') {
      console.error('❌ State non défini. Création de state vide...');
      window.state = {
        properties: [],
        bookings: [],
        currentView: 'month',
        currentDate: new Date(),
        selectedPropertyId: null
      };
      
      // Essayer de charger les données depuis les API
      loadDataFromAPI();
      return;
    }

    console.log('✅ State trouvé:', state.properties.length, 'logements');

    // Ajouter les event listeners pour les modals
    attachModalListeners();
    
    // Override de renderPropertyList pour utiliser le style moderne
    if (typeof renderPropertyList !== 'undefined') {
      window.originalRenderPropertyList = renderPropertyList;
      window.renderPropertyList = renderModernPropertyList;
    }
    
    // Ajouter les clics sur les réservations
    attachBookingClickListeners();
    
    console.log('✅ Calendrier moderne initialisé avec', state.properties.length, 'logements');
  }

  function renderModernPropertyList() {
    var wrapper = document.getElementById('propertyList');
    if (!wrapper) return;
    wrapper.innerHTML = '';

    if (!state.properties.length) {
      var div = document.createElement('div');
      div.className = 'property-item empty';
      div.innerHTML = '<i class="fas fa-home" style="opacity:0.3; margin-right:8px;"></i><span>Aucun logement</span>';
      wrapper.appendChild(div);
      return;
    }

    for (var i = 0; i < state.properties.length; i++) {
      var p = state.properties[i];
      var count = 0;
      for (var j = 0; j < state.bookings.length; j++) {
        var b = state.bookings[j];
        if (b.propertyId && String(b.propertyId) === String(p.id)) {
          count++;
        }
      }

      var item = document.createElement('div');
      item.className = 'property-item';
      item.setAttribute('data-property-id', p.id);

      var iconSpan = document.createElement('span');
      iconSpan.className = 'property-icon';
      iconSpan.innerHTML = '<i class="fas fa-home"></i>';

      var nameSpan = document.createElement('span');
      nameSpan.className = 'property-name';
      nameSpan.textContent = p.name;

      item.appendChild(iconSpan);
      item.appendChild(nameSpan);

      if (count > 0) {
        var badge = document.createElement('span');
        badge.className = 'property-count';
        badge.textContent = String(count);
        item.appendChild(badge);
      }

      (function(propertyId) {
        item.addEventListener('click', function() {
          selectProperty(propertyId);
        });
      })(p.id);

      wrapper.appendChild(item);
    }
  }

  function attachModalListeners() {
    // Modal Details
    const detailsModal = document.getElementById('reservationDetailsModal');
    const closeDetailsBtn = document.getElementById('closeDetailsModal');
    const closeDetailsBtn2 = document.getElementById('closeDetailsBtn');
    const detailsOverlay = document.getElementById('detailsModalOverlay');
    
    if (closeDetailsBtn) {
      closeDetailsBtn.addEventListener('click', closeDetailsModal);
    }
    if (closeDetailsBtn2) {
      closeDetailsBtn2.addEventListener('click', closeDetailsModal);
    }
    if (detailsOverlay) {
      detailsOverlay.addEventListener('click', closeDetailsModal);
    }

    // Bouton Edit dans le modal details
    const editBtn = document.getElementById('editBookingBtn');
    if (editBtn) {
      editBtn.addEventListener('click', function() {
        if (window.currentBookingDetails) {
          openEditModal(window.currentBookingDetails);
        }
      });
    }

    // Bouton Delete dans le modal details
    const deleteBtn = document.getElementById('deleteBookingBtn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', function() {
        if (window.currentBookingDetails) {
          deleteBooking(window.currentBookingDetails);
        }
      });
    }

    // Modal Edit
    const editModal = document.getElementById('editBookingModal');
    const closeEditBtn = document.getElementById('closeEditModal');
    const cancelEditBtn = document.getElementById('cancelEditBooking');
    const editOverlay = document.getElementById('editModalOverlay');
    
    if (closeEditBtn) {
      closeEditBtn.addEventListener('click', closeEditModal);
    }
    if (cancelEditBtn) {
      cancelEditBtn.addEventListener('click', closeEditModal);
    }
    if (editOverlay) {
      editOverlay.addEventListener('click', closeEditModal);
    }

    // Form Edit submission
    const editForm = document.getElementById('editBookingForm');
    if (editForm) {
      editForm.addEventListener('submit', handleEditSubmit);
    }

    // FAB Button (+ pour nouvelle réservation)
    const fabBtn = document.getElementById('addBookingBtn');
    if (fabBtn) {
      fabBtn.addEventListener('click', openNewBookingModal);
    }

    // Modal New Booking
    const bookingModal = document.getElementById('bookingModal');
    const closeBookingBtn = document.getElementById('closeModal');
    const cancelBookingBtn = document.getElementById('cancelBooking');
    const bookingOverlay = document.getElementById('modalOverlay');
    
    if (closeBookingBtn) {
      closeBookingBtn.addEventListener('click', closeBookingModal);
    }
    if (cancelBookingBtn) {
      cancelBookingBtn.addEventListener('click', closeBookingModal);
    }
    if (bookingOverlay) {
      bookingOverlay.addEventListener('click', closeBookingModal);
    }

    // Form New Booking submission
    const bookingForm = document.getElementById('bookingForm');
    if (bookingForm) {
      bookingForm.addEventListener('submit', handleNewBookingSubmit);
    }
  }

  function attachBookingClickListeners() {
    // Utiliser la délégation d'événements sur le calendrier
    const calendarGrid = document.getElementById('calendarGrid');
    if (!calendarGrid) return;

    calendarGrid.addEventListener('click', function(e) {
      const bookingBlock = e.target.closest('.booking-block');
      if (bookingBlock && bookingBlock.dataset.bookingId) {
        const bookingId = bookingBlock.dataset.bookingId;
        const booking = state.bookings.find(b => String(b.id) === String(bookingId));
        if (booking) {
          showBookingDetails(booking);
        }
      }
    });
  }

  function showBookingDetails(booking) {
    window.currentBookingDetails = booking;
    
    const modal = document.getElementById('reservationDetailsModal');
    const content = document.getElementById('reservationDetailsContent');
    
    if (!modal || !content) {
      console.warn('Modal de détails introuvable');
      return;
    }

    const property = state.properties.find(p => String(p.id) === String(booking.propertyId));
    const propertyName = property ? property.name : 'Logement inconnu';

    const platformColors = {
      'airbnb': '#FF5A5F',
      'booking': '#003580',
      'expedia': '#FFC72C',
      'direct': '#10B981',
      'vrbo': '#1569C7',
      'hotels': '#D32F2F'
    };

    const platformNames = {
      'airbnb': 'Airbnb',
      'booking': 'Booking.com',
      'expedia': 'Expedia',
      'direct': 'Direct',
      'vrbo': 'VRBO',
      'hotels': 'Hotels.com'
    };

    const platform = booking.source || booking.platform || 'direct';
    const platformColor = platformColors[platform.toLowerCase()] || '#10B981';
    const platformName = platformNames[platform.toLowerCase()] || 'Direct';

    const startDate = new Date(booking.startDate);
    const endDate = new Date(booking.endDate);
    const nights = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));

    content.innerHTML = `
      <div class="detail-group">
        <label><i class="fas fa-user"></i> Client</label>
        <div class="detail-value">${booking.guestName || 'Non renseigné'}</div>
      </div>

      ${booking.guestPhone ? `
      <div class="detail-group">
        <label><i class="fas fa-phone"></i> Téléphone</label>
        <div class="detail-value">${booking.guestPhone}</div>
      </div>
      ` : ''}

      ${booking.guestEmail ? `
      <div class="detail-group">
        <label><i class="fas fa-envelope"></i> Email</label>
        <div class="detail-value">${booking.guestEmail}</div>
      </div>
      ` : ''}

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
          <span class="platform-badge" style="background:${platformColor}; color:white; padding:4px 12px; border-radius:4px; font-size:12px; font-weight:600;">
            ${platformName}
          </span>
        </div>
      </div>

      ${booking.price ? `
      <div class="detail-group">
        <label><i class="fas fa-euro-sign"></i> Prix</label>
        <div class="detail-value">${booking.price} €</div>
      </div>
      ` : ''}

      ${booking.notes ? `
      <div class="detail-group">
        <label><i class="fas fa-sticky-note"></i> Notes</label>
        <div class="detail-value">${booking.notes}</div>
      </div>
      ` : ''}
    `;

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeDetailsModal() {
    const modal = document.getElementById('reservationDetailsModal');
    if (modal) {
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }
  }

  function openEditModal(booking) {
    closeDetailsModal();
    
    const modal = document.getElementById('editBookingModal');
    if (!modal) return;

    // Remplir le formulaire
    document.getElementById('editBookingId').value = booking.id;
    document.getElementById('editBookingSource').value = booking.source || 'manual';
    document.getElementById('editBookingProperty').value = booking.propertyId || '';
    document.getElementById('editCheckIn').value = booking.startDate ? booking.startDate.split('T')[0] : '';
    document.getElementById('editCheckOut').value = booking.endDate ? booking.endDate.split('T')[0] : '';
    document.getElementById('editGuestName').value = booking.guestName || '';
    document.getElementById('editGuestPhone').value = booking.guestPhone || '';
    document.getElementById('editGuestEmail').value = booking.guestEmail || '';
    document.getElementById('editPlatform').value = booking.platform || booking.source || 'direct';
    document.getElementById('editPrice').value = booking.price || '';
    document.getElementById('editNotes').value = booking.notes || '';

    // Remplir le select des logements
    fillPropertySelect('editBookingProperty');

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeEditModal() {
    const modal = document.getElementById('editBookingModal');
    if (modal) {
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }
  }

  async function handleEditSubmit(e) {
    e.preventDefault();

    const bookingId = document.getElementById('editBookingId').value;
    const formData = {
      propertyId: parseInt(document.getElementById('editBookingProperty').value),
      startDate: document.getElementById('editCheckIn').value,
      endDate: document.getElementById('editCheckOut').value,
      guestName: document.getElementById('editGuestName').value,
      guestPhone: document.getElementById('editGuestPhone').value,
      guestEmail: document.getElementById('editGuestEmail').value,
      platform: document.getElementById('editPlatform').value,
      price: parseFloat(document.getElementById('editPrice').value) || 0,
      notes: document.getElementById('editNotes').value,
      source: 'manual'
    };

    try {
      const response = await fetch(`/api/reservations/manual/${bookingId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        const updatedBooking = await response.json();
        
        // Mettre à jour dans state
        const index = state.bookings.findIndex(b => String(b.id) === String(bookingId));
        if (index !== -1) {
          state.bookings[index] = updatedBooking;
        }

        // Rafraîchir le calendrier
        if (typeof renderCalendar === 'function') {
          renderCalendar();
        }
        
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

  async function deleteBooking(booking) {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette réservation ?')) {
      return;
    }

    try {
      const response = await fetch(`/api/reservations/manual/${booking.id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        // Retirer de state
        state.bookings = state.bookings.filter(b => String(b.id) !== String(booking.id));

        // Rafraîchir le calendrier
        if (typeof renderCalendar === 'function') {
          renderCalendar();
        }

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

  function openNewBookingModal() {
    const modal = document.getElementById('bookingModal');
    if (!modal) return;

    // Réinitialiser le formulaire
    document.getElementById('bookingForm').reset();
    
    // Remplir le select des logements
    fillPropertySelect('bookingProperty');

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeBookingModal() {
    const modal = document.getElementById('bookingModal');
    if (modal) {
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }
  }

  async function handleNewBookingSubmit(e) {
    e.preventDefault();

    const formData = {
      propertyId: parseInt(document.getElementById('bookingProperty').value),
      startDate: document.getElementById('checkIn').value,
      endDate: document.getElementById('checkOut').value,
      guestName: document.getElementById('guestName').value,
      guestPhone: document.getElementById('guestPhone').value,
      guestEmail: document.getElementById('guestEmail').value,
      platform: document.getElementById('platform').value,
      price: parseFloat(document.getElementById('price').value) || 0,
      notes: document.getElementById('notes').value,
      source: 'manual'
    };

    try {
      const response = await fetch('/api/reservations/manual', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        const newBooking = await response.json();
        state.bookings.push(newBooking);

        // Rafraîchir le calendrier
        if (typeof renderCalendar === 'function') {
          renderCalendar();
        }

        closeBookingModal();
        showNotification('Réservation ajoutée avec succès', 'success');
      } else {
        throw new Error('Erreur lors de l\'ajout');
      }
    } catch (error) {
      console.error('Erreur:', error);
      showNotification('Erreur lors de l\'ajout de la réservation', 'error');
    }
  }

  function fillPropertySelect(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;

    select.innerHTML = '<option value="">Sélectionner un logement</option>';
    
    state.properties.forEach(p => {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = p.name;
      select.appendChild(option);
    });
  }

  function showNotification(message, type = 'info') {
    // Utiliser le système de notification existant si disponible
    if (typeof window.showNotification === 'function') {
      window.showNotification(message, type);
      return;
    }

    // Sinon, créer une notification simple
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${type === 'success' ? '#10B981' : type === 'error' ? '#ef4444' : '#3b82f6'};
      color: white;
      padding: 16px 24px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 10000;
      animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  function formatDate(date) {
    if (!date) return '';
    const d = new Date(date);
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return d.toLocaleDateString('fr-FR', options);
  }

  async function loadDataFromAPI() {
    console.log('🔄 Chargement des données depuis API...');
    
    try {
      // Charger les logements
      const propsResponse = await fetch('/api/properties', { credentials: 'include' });
      if (propsResponse.ok) {
        const propsData = await propsResponse.json();
        state.properties = Array.isArray(propsData) ? propsData : (propsData.properties || propsData.logements || []);
        console.log('✅ Logements chargés:', state.properties.length);
      }

      // Charger les réservations
      const bookingsResponse = await fetch('/api/reservations', { credentials: 'include' });
      if (bookingsResponse.ok) {
        const bookingsData = await bookingsResponse.json();
        state.bookings = bookingsData.reservations || bookingsData || [];
        console.log('✅ Réservations chargées:', state.bookings.length);
      }

      // Initialiser après chargement
      attachModalListeners();
      if (typeof renderPropertyList === 'function') {
        window.originalRenderPropertyList = renderPropertyList;
        window.renderPropertyList = renderModernPropertyList;
        renderPropertyList();
      }
      attachBookingClickListeners();
      console.log('✅ Calendrier moderne initialisé (mode API)');
      
    } catch (error) {
      console.error('❌ Erreur chargement données:', error);
    }
  }

  // Initialiser quand le DOM est prêt ET que state existe
  function waitForState() {
    if (typeof state !== 'undefined' && state.properties) {
      initModernCalendar();
    } else {
      console.log('⏳ Attente de state...');
      setTimeout(waitForState, 500);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForState);
  } else {
    waitForState();
  }

})();
