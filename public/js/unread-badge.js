// /js/unread-badge.js
// Met à jour le badge "Messages" (id="unreadCount") sur toutes les pages.
// Dépend uniquement du token localStorage (lcc_token).

(function () {
  const API_URL = (typeof window.API_URL !== 'undefined' && window.API_URL)
    ? window.API_URL
    : (window.location.origin);

  function setBadge(count) {
    const el = document.getElementById('unreadCount');
    if (!el) return;

    const n = Number(count || 0);
    el.textContent = String(n);
    // Masquer quand 0
    el.style.display = n > 0 ? 'inline-flex' : 'none';
  }

  async function fetchUnreadCount() {
    const token = localStorage.getItem('lcc_token');
    if (!token) {
      setBadge(0);
      return;
    }

    const resp = await fetch(`${API_URL}/api/chat/unread-count`, {
      headers: { 'Authorization': 'Bearer ' + token }
    });

    if (!resp.ok) {
      // En cas d'erreur auth (token expiré), on évite de spam
      return;
    }

    const data = await resp.json().catch(() => null);
    if (!data) return;

    setBadge(data.unread_count);

    // Si la page a aussi une stat (messages.html)
    const stat = document.getElementById('statUnread');
    if (stat) stat.textContent = String(data.unread_count || 0);
  }

  // Exposer une fonction globale (utile après mark-read)
  window.refreshUnreadBadge = function () {
    return fetchUnreadCount().catch(() => {});
  };

  // Première exécution
  fetchUnreadCount().catch(() => {});

  // Rafraîchit quand on revient sur l'onglet
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) fetchUnreadCount().catch(() => {});
  });

  // Poll léger (au cas où une notif arrive quand on est sur une autre page)
  setInterval(function () {
    if (!document.hidden) fetchUnreadCount().catch(() => {});
  }, 15000);
})();
