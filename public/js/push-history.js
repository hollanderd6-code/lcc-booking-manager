// push-history.js — Extracted from app.html
// ═══════════════════════════════════════════
// HISTORIQUE NOTIFICATIONS PUSH
// ═══════════════════════════════════════════

// Bloquer scroll iOS natif derrière le panel
// Scroll iOS natif pour le panel notifications
(function() {
  var _touchStartY = 0;
  var _touchStartedInPanel = false;

  document.addEventListener('touchstart', function(e) {
    var panel = document.getElementById('notificationsPanel');
    _touchStartedInPanel = panel && panel.classList.contains('open') && panel.contains(e.target);
    _touchStartY = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchmove', function(e) {
    var panel = document.getElementById('notificationsPanel');
    if (!panel || !panel.classList.contains('open')) return;

    // Si le touch a commencé EN DEHORS du panel → bloquer scroll page
    if (!_touchStartedInPanel) {
      e.preventDefault();
      return;
    }

    // Si dans le panel : trouver le conteneur scrollable
    var el = e.target;
    var scrollable = null;
    while (el && el !== document.body) {
      if (el.scrollHeight > el.clientHeight + 1) {
        scrollable = el;
        break;
      }
      el = el.parentElement;
    }

    if (!scrollable) {
      // Rien à scroller dans le panel → bloquer
      e.preventDefault();
      return;
    }

    // Empêcher le over-scroll iOS (bounce) qui entraîne la page
    var dy = e.touches[0].clientY - _touchStartY;
    var atTop = scrollable.scrollTop <= 0;
    var atBottom = scrollable.scrollTop + scrollable.clientHeight >= scrollable.scrollHeight - 1;
    if ((atTop && dy > 0) || (atBottom && dy < 0)) {
      e.preventDefault();
    }
  }, { passive: false });
})();

function switchNotifTab(tab) {
  var isActivity = tab === 'activity';
  // Onglets styles
  var tA = document.getElementById('notifTabActivity');
  var tP = document.getElementById('notifTabPush');
  if (tA) { tA.style.color = isActivity ? '#1A7A5E' : '#888'; tA.style.borderBottomColor = isActivity ? '#1A7A5E' : 'transparent'; tA.style.fontWeight = isActivity ? '600' : '500'; }
  if (tP) { tP.style.color = !isActivity ? '#1A7A5E' : '#888'; tP.style.borderBottomColor = !isActivity ? '#1A7A5E' : 'transparent'; tP.style.fontWeight = !isActivity ? '600' : '500'; }
  // Panels
  var pA = document.getElementById('notifPanelActivity');
  var pP = document.getElementById('notifPanelPush');
  if (pA) pA.style.display = isActivity ? '' : 'none';
  if (pP) pP.style.display = !isActivity ? '' : 'none';
  // Charger données
  if (!isActivity) loadPushNotifHistory();
  else if (typeof loadActivityData === 'function') loadActivityData();
}

async function loadPushNotifHistory() {
  var list = document.getElementById('pushNotifList');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;padding:30px;color:#aaa;"><i class="fas fa-spinner fa-spin" style="font-size:20px;"></i></div>';
  try {
    var token = localStorage.getItem('lcc_token');
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var res = await fetch('/api/notifications/history?limit=50', { headers: headers });
    if (!res.ok) {
      list.innerHTML = '<div style="text-align:center;padding:30px;color:#e53e3e;font-size:13px;">Erreur HTTP ' + res.status + '</div>';
      return;
    }
    var data = await res.json();
    var notifs = data.notifications || [];
    if (!notifs.length) {
      list.innerHTML = '<div style="text-align:center;padding:40px 16px;color:#aaa;"><i class="fas fa-bell-slash" style="font-size:28px;margin-bottom:8px;display:block;"></i>Aucune notification reçue</div>';
      return;
    }
    var groups = {};
    notifs.forEach(function(n) {
      var d = new Date(n.created_at);
      var today = new Date(); today.setHours(0,0,0,0);
      var yesterday = new Date(today); yesterday.setDate(today.getDate()-1);
      var nd = new Date(d); nd.setHours(0,0,0,0);
      var key = nd >= today ? "Aujourd'hui" : nd >= yesterday ? 'Hier' : d.toLocaleDateString('fr-FR', {day:'numeric', month:'long'});
      if (!groups[key]) groups[key] = [];
      groups[key].push(n);
    });
    var html = '';
    Object.keys(groups).forEach(function(day) {
      html += '<div class="push-notif-day-label">' + day + '</div>';
      groups[day].forEach(function(n) {
        var t = new Date(n.created_at).toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});
        var icon = n.type === 'message' ? 'fa-comment' : n.type === 'booking' ? 'fa-calendar-check' : 'fa-bell';
        html += '<div class="push-notif-item' + (n.is_read ? '' : ' unread') + '">'
          + '<div class="push-notif-icon"><i class="fas ' + icon + '"></i></div>'
          + '<div style="flex:1;min-width:0;">'
          + '<div class="push-notif-title">' + (n.title || '') + '</div>'
          + (n.body ? '<div class="push-notif-body">' + n.body + '</div>' : '')
          + '<div class="push-notif-time">' + t + '</div>'
          + '</div></div>';
      });
    });
    list.innerHTML = html;
    updateNotifBadge(0);
    fetch('/api/notifications/history/read', { method: 'PATCH', credentials: 'include' });
  } catch(e) {
    list.innerHTML = '<div style="text-align:center;padding:30px;color:#e53e3e;font-size:12px;">Erreur: ' + (e.message || e) + '</div>';
    console.error('loadPushNotifHistory:', e);
  }
}
window.loadPushNotifHistory = loadPushNotifHistory;

async function clearNotifHistory() {
  if (!await bhConfirm("Vider tout l'historique des notifications ?")) return;
  var token = localStorage.getItem('lcc_token');
  var headers = {};
  if (token) headers['Authorization'] = 'Bearer ' + token;
  await fetch('/api/notifications/history', { method: 'DELETE', headers: headers });
  loadPushNotifHistory();
}
window.clearNotifHistory = clearNotifHistory;

window.updateNotifBadge = function updateNotifBadge(count) {
  ['notifHistoryBadge', 'bh-mobile-notif-badge', 'notifTabBadge'].forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    if (count > 0) {
      el.textContent = count > 99 ? '99+' : String(count);
      el.style.display = 'flex';
    } else {
      el.style.display = 'none';
    }
  });
}

window.initNotifBadge = async function initNotifBadge() {
  try {
    var token = localStorage.getItem('lcc_token');
    var headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var res = await fetch('/api/notifications/history?limit=50', { headers: headers });
    if (!res.ok) return;
    var data = await res.json();
    // Priorité : unreadCount si renvoyé par le backend, sinon compter les non lues
    var count = data.unreadCount;
    if (typeof count !== 'number') {
      var notifs = data.notifications || (Array.isArray(data) ? data : []);
      count = notifs.filter(function(n) { return !n.is_read; }).length;
    }
    updateNotifBadge(count);
  } catch(e) {}
}

// Ouvrir panel sur onglet Push
function openNotifPanel() {
  var panel = document.getElementById('notificationsPanel');
  if (!panel) return;
  if (panel.classList.contains('open')) {
    panel.classList.remove('open');
  } else {
    panel.classList.add('open');
    switchNotifTab('push');
  }
}

// Bind boutons - les deux boutons ont déjà onclick="openNotifPanel()" inline
(function() {
  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(initNotifBadge, 800);
  });
})();
