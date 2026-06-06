// cleaning-helpers.js — Extracted from app.html
(function() {
  function showCleaningToast(message, type, duration) {
    var container = document.getElementById('toastContainer');
    if (!container) return;
    var toast = document.createElement('div');
    toast.className = 'toast ' + (type || 'success');
    toast.style.cssText = 'cursor:pointer; max-width:400px;';
    var icons = { success: 'fa-check-circle', info: 'fa-info-circle', error: 'fa-exclamation-circle' };
    var colors = { success: '#059669', info: '#3b82f6', error: '#ef4444' };
    toast.innerHTML = '<i class="fas ' + (icons[type]||icons.success) + '" style="font-size:20px; color:' + (colors[type]||colors.success) + ';"></i>' +
      '<div style="flex:1;"><div style="font-weight:600; font-size:14px;">' + message + '</div></div>' +
      '<button onclick="this.parentElement.remove()" style="background:none; border:none; cursor:pointer; color:#999; font-size:18px;">&times;</button>';
    container.appendChild(toast);
    setTimeout(function() {
      if (toast.parentElement) {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(function() { toast.remove(); }, 300);
      }
    }, duration || 10000);
  }

  function playNotifSound() {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880; osc.type = 'sine'; gain.gain.value = 0.1;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.stop(ctx.currentTime + 0.3);
    } catch(e) {}
  }

  function handleCleaningCompleted(data) {
    console.log('🧹 🔔 Ménage terminé!', data);
    var msg = '🧹 Ménage terminé — ' + (data.propertyName || data.property_name || 'Logement');
    if (data.cleanerName || data.cleaner_name) msg += ' par ' + (data.cleanerName || data.cleaner_name);
    if (data.duration_seconds || data.duration) {
      var dur = data.duration_seconds || data.duration;
      msg += ' (' + Math.round(dur / 60) + ' min)';
    }
    showCleaningToast(msg, 'success', 15000);
    playNotifSound();
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('🧹 Ménage terminé', {
        body: (data.cleanerName || data.cleaner_name || 'Cleaner') + ' — ' + (data.propertyName || data.property_name || ''),
        icon: '/img/icon-192.png'
      });
    }
    if (typeof loadCleaningChecklists === 'function') loadCleaningChecklists();
  }

  // ==========================================
  // Socket.IO
  // ==========================================
  var socketOK = false;

  function initSocket() {
    if (typeof io === 'undefined') return;
    var token = localStorage.getItem('lcc_token');
    if (!token) return;
    var userId;
    try { userId = JSON.parse(atob(token.split('.')[1])).id; } catch(e) { return; }
    if (!userId) return;

    var url = (window.API_URL || '') || window.location.origin;
    console.log('🧹 Socket.IO →', url, 'userId:', userId);

    var s = io(url, { transports: ['polling','websocket'], withCredentials: false, reconnection: true, reconnectionAttempts: 5, timeout: 10000 });

    s.on('connect', function() {
      socketOK = true;
      console.log('🧹 ✅ Socket OK, id:', s.id);
      s.emit('join', 'user_' + userId);
    });
    s.on('cleaning:completed', handleCleaningCompleted);
    s.on('cleaning:validated', function(d) {
      showCleaningToast('✅ Checklist validée', 'success', 5000);
      if (typeof loadCleaningChecklists === 'function') loadCleaningChecklists();
    });
    s.on('calendar:block_added', function(d) {
      console.log('📅 Blocage reçu via socket, rafraîchissement calendrier...');
      if (typeof loadCalendarData === 'function') loadCalendarData();
      else if (typeof refreshCalendar === 'function') refreshCalendar();
      else if (typeof renderCalendar === 'function') renderCalendar();
    });
    s.on('hold_converted', function(d) {
      console.log('✅ Hold converti en réservation, rafraîchissement calendrier...', d);
      if (typeof loadCalendarData === 'function') loadCalendarData();
      else if (typeof refreshCalendar === 'function') refreshCalendar();
    });
    // Flag pour éviter les refreshes en cascade après un déblocage
    window._blockRemovedAt = 0;

    s.on('reservations:updated', function(d) {
      console.log('📅 Réservations mises à jour, rafraîchissement calendrier...', d);
      // Ignorer pendant 2s après un block_removed (le calendrier est déjà à jour)
      if (Date.now() - window._blockRemovedAt < 2000) {
        console.log('📅 reservations:updated ignoré (block_removed récent)');
        return;
      }
      if (typeof loadCalendarData === 'function') loadCalendarData();
      else if (typeof refreshCalendar === 'function') refreshCalendar();
    });
    s.on('calendar:block_removed', function(d) {
      console.log('📅 [socket] calendar:block_removed reçu uid=' + (d&&d.uid));
      // Patch store local si uid fourni (DELETE /api/blocks/:id)
      if (d && d.uid && window.calendarState && Array.isArray(window.calendarState.bookings)) {
        var prevLen = window.calendarState.bookings.length;
        window.calendarState.bookings = window.calendarState.bookings.filter(function(r) {
          return r.uid !== d.uid && String(r.id) !== String(d.uid);
        });
        console.log('📅 [socket] Bookings: ' + prevLen + ' → ' + window.calendarState.bookings.length);
      }
      // Re-render depuis le store patché — AVANT de setter _blockRemovedAt
      // pour que le wrapper ne bloque pas ce render-ci
      if (typeof window.renderModernCalendar === 'function' && window.calendarState) {
        window._blockRemovedAt = 0; // reset temporaire pour autoriser CE render
        window.renderModernCalendar(window.calendarState.bookings || [], window.calendarState.properties || window.LCC_PROPERTIES || []);
      }
      // Setter le flag APRÈS le render pour bloquer les renders suivants (2s)
      window._blockRemovedAt = Date.now();
      // Recharger depuis l'API seulement si l'uid est null (batch unblock)
      if (!d || !d.uid) {
        if (typeof loadCalendarData === 'function') loadCalendarData();
      }
    });
    s.on('reservation_cancelled', function(d) {
      console.log('❌ Réservation annulée via socket, rafraîchissement calendrier...', d);
      // Supprimer immédiatement du store local pour un retour visuel instantané
      if (d && d.uid && window.LCC_RESERVATIONS) {
        window.LCC_RESERVATIONS = window.LCC_RESERVATIONS.filter(function(r) {
          return r.uid !== d.uid && r.id !== d.uid;
        });
        try { localStorage.setItem('LCC_RESERVATIONS', JSON.stringify(window.LCC_RESERVATIONS)); } catch(e) {}
      }
      // Recharger depuis l'API et re-render
      if (typeof window.loadCalendarData === 'function') window.loadCalendarData();
      else if (typeof window.renderCalendar === 'function') window.renderCalendar();
    });
    s.on('calendar_refresh', function(d) {
      console.log('🔄 Rafraîchissement calendrier demandé via socket...');
      if (typeof window.loadCalendarData === 'function') window.loadCalendarData();
      else if (typeof window.renderCalendar === 'function') window.renderCalendar();
    });
    s.on('disconnect', function() { socketOK = false; });
    s.on('connect_error', function(e) { console.log('🧹 Socket err:', e.message); });
  }

  // ==========================================
  // Polling HTTP fallback (toutes les 20s)
  // ==========================================
  var knownIds = {};
  var pollingReady = false;

  function initPolling() {
    var token = localStorage.getItem('lcc_token');
    if (!token) return;
    var url = (window.API_URL || '') + '/api/cleaning/checklists';

    // Chargement initial : mémoriser les IDs existants
    fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        (d.checklists || []).forEach(function(c) { knownIds[c.id] = true; });
        pollingReady = true;
        console.log('🧹 Polling prêt,', Object.keys(knownIds).length, 'checklists connues');
      }).catch(function() {});

    // Vérifier périodiquement
    setInterval(function() {
      if (!pollingReady) return;
      if (socketOK) return; // Socket marche, pas besoin

      var t = localStorage.getItem('lcc_token');
      if (!t) return;

      fetch(url, { headers: { 'Authorization': 'Bearer ' + t } })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          (d.checklists || []).forEach(function(c) {
            if (!knownIds[c.id]) {
              knownIds[c.id] = true;
              handleCleaningCompleted({
                checklistId: c.id,
                propertyName: c.property_name || c.property_id,
                cleanerName: c.cleaner_name,
                duration_seconds: c.duration_seconds
              });
            }
          });
        }).catch(function() {});
    }, 20000);
  }

  // Notifications navigateur
  if ('Notification' in window && Notification.permission === 'default') {
    document.addEventListener('click', function f() { Notification.requestPermission(); document.removeEventListener('click', f); }, { once: true });
  }

  // Démarrage
  window.addEventListener('load', function() {
    setTimeout(function() { initSocket(); initPolling(); }, 800);
  });
})();
