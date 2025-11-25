// ============================================
// CALENDRIER MODERNE - VERSION ULTRA-SIMPLE
// S'exécute immédiatement sans attendre state
// ============================================

(function() {
  'use strict';

  console.log('🚀 Initialisation calendrier moderne...');

  // Attendre que le DOM soit prêt
  function init() {
    // Attacher les listeners immédiatement
    attachModalListeners();
    attachBookingClickListeners();
    
    console.log('✅ Calendrier moderne actif (clics sur réservations fonctionnels)');
  }

  function attachModalListeners() {
    // Modal Details
    const closeDetailsBtn = document.getElementById('closeDetailsModal');
    const closeDetailsBtn2 = document.getElementById('closeDetailsBtn');
    const detailsOverlay = document.getElementById('detailsModalOverlay');
    
    if (closeDetailsBtn) closeDetailsBtn.addEventListener('click', closeDetailsModal);
    if (closeDetailsBtn2) closeDetailsBtn2.addEventListener('click', closeDetailsModal);
    if (detailsOverlay) detailsOverlay.addEventListener('click', closeDetailsModal);

    const editBtn = document.getElementById('editBookingBtn');
    if (editBtn) {
      editBtn.addEventListener('click', function() {
        if (window.currentBookingDetails) {
          openEditModal(window.currentBookingDetails);
        }
      });
    }

    const deleteBtn = document.getElementById('deleteBookingBtn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', function() {
        if (window.currentBookingDetails) {
          deleteBooking(window.currentBookingDetails);
        }
      });
    }

    // Modal Edit
    const closeEditBtn = document.getElementById('closeEditModal');
    const cancelEditBtn = document.getElementById('cancelEditBooking');
    const editOverlay = document.getElementById('editModalOverlay');
    
    if (closeEditBtn) closeEditBtn.addEventListener('click', closeEditModal);
    if (cancelEditBtn) cancelEditBtn.addEventListener('click', closeEditModal);
    if (editOverlay) editOverlay.addEventListener('click', closeEditModal);

    const editForm = document.getElementById('editBookingForm');
    if (editForm) editForm.addEventListener('submit', handleEditSubmit);

    // FAB Button
    const fabBtn = document.getElementById('addBookingBtn');
    if (fabBtn) {
      fabBtn.addEventListener('click', openNewBookingModal);
      console.log('✅ Bouton + actif');
    }

    // Modal New Booking
    const closeBookingBtn = document.getElementById('closeModal');
    const cancelBookingBtn = document.getElementById('cancelBooking');
    const bookingOverlay = document.getElementById('modalOverlay');
    
    if (closeBookingBtn) closeBookingBtn.addEventListener('click', closeBookingModal);
    if (cancelBookingBtn) cancelBookingBtn.addEventListener('click', closeBookingModal);
    if (bookingOverlay) bookingOverlay.addEventListener('click', closeBookingModal);

    const bookingForm = document.getElementById('bookingForm');
    if (bookingForm) bookingForm.addEventListener('submit', handleNewBookingSubmit);
  }

  function attachBookingClickListeners() {
    const calendarGrid = document.getElementById('calendarGrid');
    if (!calendarGrid) return;

    calendarGrid.addEventListener('click', function(e) {
      const bookingBlock = e.target.closest('.booking-block');
      if (bookingBlock && bookingBlock.dataset.bookingId) {
        const bookingId = bookingBlock.dataset.bookingId;
        
        // Chercher la réservation dans window.state ou window.BOOKINGS
        const bookings = window.state?.bookings || window.BOOKINGS || [];
        const booking = bookings.find(b => String(b.id) === String(bookingId));
        
        if (booking) {
          showBookingDetails(booking);
        } else {
          console.warn('Réservation non trouvée:', bookingId);
        }
      }
    });
    
    console.log('✅ Clics sur réservations actifs');
  }

  function showBookingDetails(booking) {
    window.currentBookingDetails = booking;
    
    const modal = document.getElementById('reservationDetailsModal');
    const content = document.getElementById('reservationDetailsContent');
    
    if (!modal || !content) return;

    const properties = window.state?.properties || window.PROPERTIES || [];
    const property = properties.find(p => String(p.id) === String(booking.propertyId));
    const propertyName = property ? property.name : 'Logement inconnu';

    const platformColors = {
      'airbnb': '#FF5A5F',
      'booking': '#003580',
      'direct': '#10B981'
    };

    const platformNames = {
      'airbnb': 'Airbnb',
      'booking': 'Booking.com',
      'direct': 'Direct'
    };

    const platform = (booking.source || booking.platform || 'direct').toLowerCase();
    const platformColor = platformColors[platform] || '#10B981';
    const platformName = platformNames[platform] || 'Direct';

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
      </div>` : ''}

      ${booking.guestEmail ? `
      <div class="detail-group">
        <label><i class="fas fa-envelope"></i> Email</label>
        <div class="detail-value">${booking.guestEmail}</div>
      </div>` : ''}

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
      </div>` : ''}

      ${booking.notes ? `
      <div class="detail-group">
        <label><i class="fas fa-sticky-note"></i> Notes</label>
        <div class="detail-value">${booking.notes}</div>
      </div>` : ''}
    `;

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    console.log('✅ Modal ouvert pour:', booking.guestName);
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

    document.getElementById('editBookingId').value = booking.id;
    document.getElementById('editBookingProperty').value = booking.propertyId || '';
    document.getElementById('editCheckIn').value = booking.startDate ? booking.startDate.split('T')[0] : '';
    document.getElementById('editCheckOut').value = booking.endDate ? booking.endDate.split('T')[0] : '';
    document.getElementById('editGuestName').value = booking.guestName || '';
    document.getElementById('editGuestPhone').value = booking.guestPhone || '';
    document.getElementById('editGuestEmail').value = booking.guestEmail || '';
    document.getElementById('editPlatform').value = booking.platform || booking.source || 'direct';
    document.getElementById('editPrice').value = booking.price || '';
    document.getElementById('editNotes').value = booking.notes || '';

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
        closeEditModal();
        showNotification('Réservation modifiée avec succès', 'success');
        setTimeout(() => window.location.reload(), 1000);
      } else {
        throw new Error('Erreur lors de la modification');
      }
    } catch (error) {
      console.error('Erreur:', error);
      showNotification('Erreur lors de la modification', 'error');
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
        closeDetailsModal();
        showNotification('Réservation supprimée avec succès', 'success');
        setTimeout(() => window.location.reload(), 1000);
      } else {
        throw new Error('Erreur lors de la suppression');
      }
    } catch (error) {
      console.error('Erreur:', error);
      showNotification('Erreur lors de la suppression', 'error');
    }
  }

  function openNewBookingModal() {
    const modal = document.getElementById('bookingModal');
    if (!modal) return;

    document.getElementById('bookingForm').reset();
    fillPropertySelect('bookingProperty');

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    console.log('✅ Modal nouvelle réservation ouvert');
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
        closeBookingModal();
        showNotification('Réservation ajoutée avec succès', 'success');
        setTimeout(() => window.location.reload(), 1000);
      } else {
        throw new Error('Erreur lors de l\'ajout');
      }
    } catch (error) {
      console.error('Erreur:', error);
      showNotification('Erreur lors de l\'ajout', 'error');
    }
  }

  function fillPropertySelect(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;

    select.innerHTML = '<option value="">Sélectionner un logement</option>';
    
    const properties = window.state?.properties || window.PROPERTIES || [];
    properties.forEach(p => {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = p.name;
      select.appendChild(option);
    });
  }

  function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
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

  // Initialiser dès que possible
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
