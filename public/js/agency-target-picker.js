// ============================================
// 🏢 Sélecteur « Pour quel compte ? » (mode agence)
// Remplit un <select> avec le compte de l'utilisateur + les comptes clients
// qu'il gère (délégations acceptées). Si l'utilisateur ne gère aucun compte,
// le groupe est masqué : rien ne change pour un propriétaire seul.
//
// Utilisation :
//   await bhLoadTargetAccounts('memberTargetAccount', 'memberTargetAccountGroup');
// ============================================
(function () {
  let cache = null;

  async function fetchAccounts() {
    if (cache) return cache;
    const token = localStorage.getItem('lcc_token');
    if (!token) return [];
    try {
      const res = await fetch('/api/agency/target-accounts', {
        headers: { Authorization: 'Bearer ' + token }
      });
      const data = await res.json();
      cache = (data && data.success && data.accounts) || [];
      return cache;
    } catch (e) {
      console.warn('[AGENCE] comptes cibles indisponibles:', e.message);
      return [];
    }
  }

  window.bhLoadTargetAccounts = async function (selectId, groupId) {
    const select = document.getElementById(selectId);
    const group = groupId ? document.getElementById(groupId) : null;
    if (!select) return;

    const accounts = await fetchAccounts();

    // Un seul compte = pas de choix à faire : on masque le champ.
    if (accounts.length <= 1) {
      if (group) group.style.display = 'none';
      select.innerHTML = '';
      return;
    }

    // Compte actuellement ouvert en mode agence, s'il y en a un.
    let current = '';
    try {
      const raw = localStorage.getItem('lcc_managed_user');
      if (raw) {
        const parsed = raw.trim().startsWith('{') ? JSON.parse(raw) : { id: raw };
        current = parsed.id || parsed.userId || '';
      }
    } catch (e) { current = ''; }

    select.innerHTML = accounts
      .map(function (a) {
        const sel = a.userId === current || (!current && a.isSelf) ? ' selected' : '';
        return '<option value="' + a.userId + '"' + sel + '>' + a.name + '</option>';
      })
      .join('');

    if (group) group.style.display = '';
  };
})();
