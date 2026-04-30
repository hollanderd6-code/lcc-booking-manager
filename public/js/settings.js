// ========================================
// CONFIGURATION & STATE
// ========================================
const API_URL = "https://lcc-booking-manager.onrender.com";

// ✅ FIX : Utiliser le bon domaine en natif (iOS/Android) au lieu de capacitor://localhost
function getBaseUrl() {
  if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function') {
    if (window.Capacitor.isNativePlatform()) {
      return 'https://boostinghost.fr';
    }
  }
  return window.location.origin;
}

// BOOSTINGHOST_ICAL_BASE supprimé
let properties = [];
let currentEditingProperty = null;
let ownerClients = [];

// ========================================
// GROUPES DE LOGEMENTS — DB-SYNCED
// Stockage DB (table property_groups), cache local en mémoire
// pour un rendu rapide, migration automatique depuis localStorage.
// ========================================
const GROUPS_KEY = 'bh_property_groups'; // legacy, pour migration uniquement

// Cache en mémoire — rempli depuis l'API au chargement
let _groupsCache = [];
let _groupsLoaded = false;

// Récupère le token d'auth
function _getAuthHeaders(withBody = false) {
  const token = localStorage.getItem('lcc_token') || '';
  const h = {};
  if (token) h['Authorization'] = 'Bearer ' + token;
  if (withBody) h['Content-Type'] = 'application/json';
  return h;
}

// Détecte Capacitor iOS
function _isCapacitor() {
  try {
    return !!(window.Capacitor?.isNativePlatform?.() || window.location.protocol === 'capacitor:' || window.location.protocol === 'ionic:');
  } catch { return false; }
}

// URL absolue en Capacitor, relative en web
const _API_BASE = 'https://lcc-booking-manager.onrender.com';
function _groupsUrl(path) { return _isCapacitor() ? _API_BASE + path : path; }

// Logs persistants pour debug iOS
window._groupsDebugLogs = window._groupsDebugLogs || [];
function _glog(msg) {
  const ts = new Date().toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  window._groupsDebugLogs.push(`[${ts}] ${msg}`);
  console.log('📦 [GROUPS]', msg);
}

// Charger les groupes depuis l'API + migration legacy localStorage si besoin
async function loadGroupsFromAPI() {
  try {
    const url = _groupsUrl('/api/property-groups');
    _glog('GET ' + url + ' (capacitor=' + _isCapacitor() + ')');
    const res = await fetch(url, { headers: _getAuthHeaders() });
    _glog('Réponse: ' + res.status + ' ' + res.statusText);
    if (!res.ok) { _glog('❌ GET failed: ' + res.status); return []; }
    const data = await res.json();
    const groups = Array.isArray(data.groups) ? data.groups : [];
    _glog('✅ ' + groups.length + ' groupe(s) chargés depuis DB');

    if (groups.length === 0) {
      try {
        const legacy = JSON.parse(localStorage.getItem(GROUPS_KEY) || '[]');
        if (Array.isArray(legacy) && legacy.length > 0) {
          _glog('🔄 Migration ' + legacy.length + ' groupe(s) localStorage → DB');
          const importRes = await fetch(_groupsUrl('/api/property-groups/bulk-import'), {
            method: 'POST', headers: _getAuthHeaders(true),
            body: JSON.stringify({ groups: legacy }),
          });
          if (importRes.ok) {
            const importData = await importRes.json();
            if (importData.success) {
              _glog('✅ ' + importData.imported + ' groupe(s) migrés');
              localStorage.setItem(GROUPS_KEY + '_backup', localStorage.getItem(GROUPS_KEY) || '');
              localStorage.removeItem(GROUPS_KEY);
              const reFetch = await fetch(_groupsUrl('/api/property-groups'), { headers: _getAuthHeaders() });
              if (reFetch.ok) {
                const reData = await reFetch.json();
                return Array.isArray(reData.groups) ? reData.groups : [];
              }
            }
          } else { _glog('⚠️ Migration échouée: ' + importRes.status); }
        }
      } catch (err) { _glog('⚠️ Erreur migration legacy: ' + err.message); }
    }
    return groups;
  } catch (err) {
    _glog('❌ ERREUR: ' + err.name + ' — ' + err.message);
    return [];
  }
}

// Charger les groupes une fois et garder en cache
// Si le cache est vide après un premier appel, on autorise un retry
// (utile pour les race conditions au démarrage, ex: Capacitor iOS où auth-fetch
// peut ne pas être totalement prêt lors du tout premier fetch)
async function ensureGroupsLoaded() {
  if (_groupsLoaded && _groupsCache && _groupsCache.length > 0) return _groupsCache;
  _groupsCache = await loadGroupsFromAPI();
  _groupsLoaded = true;
  return _groupsCache;
}

// API publique synchrone — renvoie le cache
function getGroups() {
  return _groupsCache || [];
}

// Filtre actif : null = tous, 'ungrouped' = non groupés, string = id du groupe
let activeFilter = null;

function getPropertyGroupId(propertyId) {
  const group = getGroups().find(g => g.propertyIds && g.propertyIds.includes(propertyId));
  return group ? group.id : null;
}

function applyFilter() {
  const groups = getGroups();
  let filtered;

  if (!activeFilter) {
    filtered = properties;
  } else if (activeFilter === 'ungrouped') {
    const groupedIds = new Set(groups.flatMap(g => g.propertyIds || []));
    filtered = properties.filter(p => !groupedIds.has(p._id || p.id));
  } else {
    const group = groups.find(g => g.id === activeFilter);
    const ids = new Set(group ? (group.propertyIds || []) : []);
    filtered = properties.filter(p => ids.has(p._id || p.id));
  }

  renderPropertiesFiltered(filtered);
}

function renderFilterBar() {
  const bar = document.getElementById('filterBar');
  if (!bar) return;
  const groups = getGroups();
  const groupedIds = new Set(groups.flatMap(g => g.propertyIds || []));
  const hasUngrouped = properties.some(p => !groupedIds.has(p._id || p.id));

  const chips = [
    { id: null, label: `Tous (${properties.length})` },
    ...groups.map(g => ({ id: g.id, label: `${g.name} (${(g.propertyIds||[]).length})` })),
    ...(hasUngrouped ? [{ id: 'ungrouped', label: 'Non groupés' }] : [])
  ];

  bar.innerHTML = chips.map(c => {
    const val = c.id === null ? 'null' : "'" + c.id + "'";
    const active = activeFilter === c.id ? 'active' : '';
    return `<button class="filter-chip ${active}" onclick="setFilter(${val})">${c.label}</button>`;
  }).join('') + `
    <button class="filter-chip filter-chip-groups" onclick="openGroupsModal()">
      <i class="fas fa-layer-group"></i> Gérer les groupes
    </button>
  `;

  // Auto-retry : si le cache des groupes est vide au premier rendu (race condition
  // possible au démarrage de Capacitor où auth-fetch peut ne pas être prêt),
  // on retente un chargement en différé. Une seule fois.
  if (_groupsLoaded && (!_groupsCache || _groupsCache.length === 0) && !_groupsRetried) {
    _groupsRetried = true;
    setTimeout(async () => {
      const fresh = await loadGroupsFromAPI();
      if (fresh && fresh.length > 0) {
        _groupsCache = fresh;
        renderFilterBar();
        applyFilter();
      }
    }, 800);
  }
}
let _groupsRetried = false;

function setFilter(id) {
  activeFilter = id;
  renderFilterBar();
  applyFilter();
}

// ── Modal Gérer les groupes ───────────────────────────────────
function openGroupsModal() {
  const existing = document.getElementById('_groupsModal');
  if (existing) existing.remove();

  const groups = getGroups();
  const modal = document.createElement('div');
  modal.id = '_groupsModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(13,17,23,.55);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;';

  modal.innerHTML = `
    <div style="background:white;border-radius:20px;width:100%;max-width:480px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,.2);">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:center;padding:20px 24px 16px;border-bottom:1px solid #f3f4f6;flex-shrink:0;">
        <div>
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#9CA3AF;margin-bottom:2px;">Organisation</div>
          <h3 style="margin:0;font-family:'Instrument Serif',serif;font-size:20px;font-weight:400;">Groupes de logements</h3>
        </div>
        <button onclick="document.getElementById('_groupsModal').remove()" style="width:36px;height:36px;border-radius:50%;border:none;background:#f3f4f6;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;">×</button>
      </div>
      <!-- Body scrollable -->
      <div style="flex:1;overflow-y:auto;padding:20px 24px;" id="_groupsBody">
        ${renderGroupsBody()}
      </div>
      <!-- Footer : créer un groupe -->
      <div style="padding:16px 24px;border-top:1px solid #f3f4f6;flex-shrink:0;">
        <div style="display:flex;gap:8px;">
          <input id="_newGroupName" type="text" placeholder="Nom du nouveau groupe…"
            style="flex:1;padding:10px 14px;border:1.5px solid #E8E0D0;border-radius:10px;font-size:14px;font-family:'DM Sans',sans-serif;outline:none;"
            onkeydown="if(event.key==='Enter') createGroup()" />
          <button onclick="createGroup()"
            style="padding:10px 18px;background:#1A7A5E;color:white;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;">
            <i class="fas fa-plus"></i> Créer
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

function renderGroupsBody() {
  const groups = getGroups();
  if (groups.length === 0) {
    return '<p style="color:#9CA3AF;font-size:14px;text-align:center;padding:16px 0;">Aucun groupe créé. Ajoutez-en un ci-dessous.</p>';
  }
  return groups.map(g => `
    <div id="_group_${g.id}" style="background:#FAFAF8;border:1px solid #E8E0D0;border-radius:14px;padding:16px;margin-bottom:12px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <i class="fas fa-layer-group" style="color:#1A7A5E;font-size:14px;"></i>
        <input value="${escapeHtml(g.name)}" id="_gname_${g.id}"
          style="flex:1;font-size:15px;font-weight:700;border:none;background:transparent;outline:none;font-family:'DM Sans',sans-serif;color:#0D1117;"
          onblur="renameGroup('${g.id}', this.value)" />
        <button onclick="deleteGroup('${g.id}')"
          style="width:30px;height:30px;border:none;background:#FEF2F2;color:#DC2626;border-radius:8px;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;">
          <i class="fas fa-trash"></i>
        </button>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${properties.map(p => {
          const pid = p._id || p.id;
          const checked = (g.propertyIds || []).includes(pid);
          return `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:6px 8px;border-radius:8px;${checked ? 'background:rgba(26,122,94,.06);' : ''}">
            <input type="checkbox" ${checked ? 'checked' : ''} onchange="togglePropertyInGroup('${g.id}','${pid}',this.checked)"
              style="accent-color:#1A7A5E;width:15px;height:15px;" />
            <span style="font-size:13px;font-weight:${checked ? '600' : '400'};color:#0D1117;">${escapeHtml(p.name || 'Sans nom')}</span>
          </label>`;
        }).join('')}
      </div>
    </div>
  `).join('');
}

function refreshGroupsBody() {
  const body = document.getElementById('_groupsBody');
  if (body) body.innerHTML = renderGroupsBody();
}

async function createGroup() {
  const input = document.getElementById('_newGroupName');
  if (!input) return;
  const name = input.value.trim();
  if (!name) return;
  try {
    const res = await fetch(_groupsUrl('/api/property-groups'), {
      method: 'POST',
      headers: _getAuthHeaders(true),
      body: JSON.stringify({ name, propertyIds: [] }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.success && data.group) {
      _groupsCache.push(data.group);
      input.value = '';
      refreshGroupsBody();
      renderFilterBar();
    }
  } catch (err) {
    console.error('❌ [GROUPS] createGroup failed:', err.message);
    alert('Erreur lors de la création du groupe');
  }
}

async function renameGroup(groupId, newName) {
  if (!newName.trim()) return;
  const g = _groupsCache.find(g => g.id === groupId);
  if (!g) return;
  g.name = newName.trim();
  renderFilterBar(); // feedback immédiat
  try {
    await fetch(_groupsUrl('/api/property-groups/' + encodeURIComponent(groupId)), {
      method: 'PUT',
      headers: _getAuthHeaders(true),
      body: JSON.stringify({ name: g.name }),
    });
  } catch (err) {
    console.error('❌ [GROUPS] renameGroup failed:', err.message);
  }
}

async function deleteGroup(groupId) {
  const before = _groupsCache;
  _groupsCache = _groupsCache.filter(g => g.id !== groupId);
  if (activeFilter === groupId) activeFilter = null;
  refreshGroupsBody();
  renderFilterBar();
  applyFilter();
  try {
    const res = await fetch(_groupsUrl('/api/property-groups/' + encodeURIComponent(groupId)), {
      method: 'DELETE',
      headers: _getAuthHeaders(),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
  } catch (err) {
    console.error('❌ [GROUPS] deleteGroup failed:', err.message);
    // Rollback en cas d'échec
    _groupsCache = before;
    refreshGroupsBody();
    renderFilterBar();
    applyFilter();
    alert('Erreur lors de la suppression — annulée');
  }
}

async function togglePropertyInGroup(groupId, propertyId, add) {
  // Retirer de tous les autres groupes (un logement ne peut être que dans un groupe)
  _groupsCache.forEach(g => {
    if (g.id !== groupId) {
      g.propertyIds = (g.propertyIds || []).filter(id => id !== propertyId);
    }
  });
  const g = _groupsCache.find(g => g.id === groupId);
  if (g) {
    g.propertyIds = g.propertyIds || [];
    if (add && !g.propertyIds.includes(propertyId)) {
      g.propertyIds.push(propertyId);
    } else if (!add) {
      g.propertyIds = g.propertyIds.filter(id => id !== propertyId);
    }
  }
  refreshGroupsBody();
  renderFilterBar();
  applyFilter();

  // Persister tous les groupes modifiés côté serveur
  try {
    if (g) {
      await fetch(_groupsUrl('/api/property-groups/' + encodeURIComponent(groupId)), {
        method: 'PUT',
        headers: _getAuthHeaders(true),
        body: JSON.stringify({ propertyIds: g.propertyIds }),
      });
    }
    // Autres groupes (si le logement a été retiré d'un autre groupe)
    for (const og of _groupsCache) {
      if (og.id !== groupId) {
        await fetch(_groupsUrl('/api/property-groups/' + encodeURIComponent(og.id)), {
          method: 'PUT',
          headers: _getAuthHeaders(true),
          body: JSON.stringify({ propertyIds: og.propertyIds || [] }),
        });
      }
    }
  } catch (err) {
    console.error('❌ [GROUPS] togglePropertyInGroup sync failed:', err.message);
  }
}

// ========================================
// INITIALIZATION
// ========================================
function populateTimeSelects() {
  const times = [''];
  for (let h = 0; h < 24; h++) {
    for (let m of [0, 30]) {
      times.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
    }
  }
  ['propertyArrivalTime','propertyDepartureTime'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = times.map(t =>
      `<option value="${t}"${t === current ? ' selected' : ''}>${t || '-- Choisir --'}</option>`
    ).join('');
  });
}

// ── Tooltips positionnés dynamiquement (évite débordement écran) ──
document.addEventListener('mouseover', function(e) {
  const icon = e.target.closest('.bh-tooltip-icon');
  if (!icon) return;
  const box = icon.parentElement?.querySelector('.bh-tooltip-box');
  if (!box) return;
  const rect = icon.getBoundingClientRect();
  const boxWidth = 160;
  // Positionner juste sous l'icône
  box.style.top = (rect.bottom + 5) + 'px';
  // Aligner à gauche de l'icône, décaler si débordement droit
  let left = rect.left;
  if (left + boxWidth > window.innerWidth - 8) left = window.innerWidth - boxWidth - 8;
  if (left < 8) left = 8;
  box.style.left = left + 'px';
  box.style.right = 'auto';
});

document.addEventListener("DOMContentLoaded", async () => {
  console.log("🔧 Paramètres - Initialisation...");

  populateTimeSelects();
  setupColorPicker();
  setupPhotoPreview();
  // Charger les groupes depuis l'API (avec migration auto localStorage → DB si besoin)
  await ensureGroupsLoaded();
  await loadProperties();
  await loadOwnerClients(); 

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeEditModal();
    }
  });

  const modal = document.getElementById("editPropertyModal");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        closeEditModal();
      }
    });
  }
});

// ========================================
// UI HELPERS
// ========================================
function showLoading() {
  const overlay = document.getElementById("loadingOverlay");
  if (overlay) overlay.classList.add("active");
}

function hideLoading() {
  const overlay = document.getElementById("loadingOverlay");
  if (overlay) overlay.classList.remove("active");
}

function showToast(message, type = "success") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type === "error" ? "error" : "success"}`;

  const icon = document.createElement("i");
  icon.className = type === "error" ? "fas fa-circle-xmark" : "fas fa-circle-check";

  const text = document.createElement("span");
  text.textContent = message;

  toast.appendChild(icon);
  toast.appendChild(text);
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(4px)";
    setTimeout(() => toast.remove(), 200);
  }, 3000);
}

function setupColorPicker() {
  const colorInput = document.getElementById("propertyColor");
  const preview = document.getElementById("colorPreview");
  if (!colorInput || !preview) return;

  const updatePreview = () => {
    preview.textContent = colorInput.value.toUpperCase();
    preview.style.borderColor = colorInput.value;
  };

  colorInput.addEventListener("input", updatePreview);
  updatePreview();
}

function setupPhotoPreview() {
  const input = document.getElementById("propertyPhoto");
  const box = document.getElementById("photoPreviewBox");
  if (!input || !box) return;

  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    if (!file) {
      box.innerHTML =
        '<span class="photo-preview-placeholder"><i class="fas fa-image"></i></span>';
      return;
    }
    const reader = new FileReader();
    reader.onload = function (e) {
      box.innerHTML = "";
      const img = document.createElement("img");
      img.src = e.target.result;
      box.appendChild(img);
    };
    reader.readAsDataURL(file);
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ========================================
// API CALLS
// ========================================
async function loadProperties() {
  showLoading();
  try {
    const token = localStorage.getItem("lcc_token");
    const response = await fetch(`${API_URL}/api/properties`, {
      headers: { Authorization: "Bearer " + token },
    });
    const data = await response.json();
    properties = data.properties || [];
    window.allProperties = properties;
    renderProperties();
  } catch (error) {
    console.error("Erreur lors du chargement des logements:", error);
    showToast("Erreur lors du chargement des logements", "error");
  } finally {
    hideLoading();
  }
}
async function loadOwnerClients() {
  try {
    const token = localStorage.getItem("lcc_token");
    const response = await fetch(`${API_URL}/api/owner-clients`, {
      headers: { Authorization: "Bearer " + token },
    });
    const data = await response.json();
    ownerClients = data.clients || [];
    populateOwnerSelect();
  } catch (error) {
    console.error("Erreur lors du chargement des clients propriétaires:", error);
  }
}

function populateOwnerSelect() {
  const select = document.getElementById("propertyOwnerId");
  if (!select) return;
  
  select.innerHTML = '<option value="">Aucun propriétaire</option>';
  
  ownerClients.forEach(client => {
    const option = document.createElement("option");
    option.value = client.id;
    
    if (client.client_type === 'business') {
      option.textContent = client.company_name || 'Entreprise sans nom';
    } else {
      option.textContent = `${client.first_name || ''} ${client.last_name || ''}`.trim() || 'Client sans nom';
    }
    
    select.appendChild(option);
  });
}
async function saveProperty(event) {
  event.preventDefault();
  showLoading();

  const propertyId = document.getElementById("propertyId").value || null;
  const name = document.getElementById("propertyName").value.trim();
  const internalName = document.getElementById("propertyInternalName")?.value?.trim() || null;
  const color = document.getElementById("propertyColor").value;
  const address = document.getElementById("propertyAddress")?.value?.trim() || null;
  const arrivalTime = document.getElementById("propertyArrivalTime")?.value || null;
  const departureTime = document.getElementById("propertyDepartureTime")?.value || null;
  
  const depositRaw = document.getElementById("propertyDeposit")?.value || 
                     document.getElementById("propertyDepositAmount")?.value;
  const depositAmount = depositRaw && depositRaw.trim() !== ""
    ? parseFloat(depositRaw.replace(",", "."))
    : null;

  // ✅ NOUVEAUX CHAMPS
  const welcomeBookUrl = document.getElementById('propertyWelcomeBookUrl')?.value?.trim() || null;
  const accessCode = document.getElementById('propertyAccessCode')?.value?.trim() || null;
  const wifiName = document.getElementById('propertyWifiName')?.value?.trim() || null;
  const wifiPassword = document.getElementById('propertyWifiPassword')?.value?.trim() || null;
  const accessInstructions = document.getElementById('propertyAccessInstructions')?.value?.trim() || null;


  const basePriceRaw       = document.getElementById('propertyBasePrice')?.value;
  const weekendPriceRaw    = document.getElementById('propertyWeekendPrice')?.value;
  const cleaningFeeRaw     = document.getElementById('propertyCleaningFee')?.value;
  const touristTaxRaw      = document.getElementById('propertyTouristTax')?.value;
  const conciergePctRaw    = document.getElementById('propertyConciergePct')?.value;
  const airbnbCommPctRaw   = document.getElementById('propertyAirbnbCommissionPct')?.value;
  const bookingCommPctRaw  = document.getElementById('propertyBookingCommissionPct')?.value;
  const basePrice    = basePriceRaw    !== undefined && basePriceRaw    !== '' ? parseFloat(basePriceRaw)    : null;
  const weekendPrice = weekendPriceRaw !== undefined && weekendPriceRaw !== '' ? parseFloat(weekendPriceRaw) : null;
  const cleaningFee     = cleaningFeeRaw  !== undefined && cleaningFeeRaw  !== '' ? parseFloat(cleaningFeeRaw)  : null;
  const touristTaxPerNight = touristTaxRaw !== undefined && touristTaxRaw !== '' ? parseFloat(touristTaxRaw) : null;
  const conciergePct    = conciergePctRaw !== undefined && conciergePctRaw !== '' ? parseFloat(conciergePctRaw) : null;
  const airbnbCommPct   = airbnbCommPctRaw !== undefined && airbnbCommPctRaw !== '' ? parseFloat(airbnbCommPctRaw) : 3;
  const bookingCommPct  = bookingCommPctRaw !== undefined && bookingCommPctRaw !== '' ? parseFloat(bookingCommPctRaw) : 15;

  const existingPhotoUrl = document.getElementById("propertyPhotoUrl")?.value || null;
  const photoInput = document.getElementById("propertyPhoto");

  if (!name) {
    hideLoading();
    showToast('Veuillez saisir un nom de logement.', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('name', name);
  formData.append('internalName', internalName || ''); // Toujours envoyer, même vide
  formData.append('color', color);
  formData.append('icalUrls', JSON.stringify(window._currentIcalUrls || []));
  
  if (address) formData.append('address', address);
  if (arrivalTime) formData.append('arrivalTime', arrivalTime);
  if (departureTime) formData.append('departureTime', departureTime);
  if (depositAmount !== null) formData.append('depositAmount', depositAmount);
  if (existingPhotoUrl) formData.append('photoUrl', existingPhotoUrl);

  // ✅ AJOUT DES NOUVEAUX CHAMPS
  if (welcomeBookUrl) formData.append('welcomeBookUrl', welcomeBookUrl);
  if (accessCode) formData.append('accessCode', accessCode);
  if (wifiName) formData.append('wifiName', wifiName);
  if (wifiPassword) formData.append('wifiPassword', wifiPassword);
  if (accessInstructions) formData.append('accessInstructions', accessInstructions);
  if (basePrice    !== null) formData.append('basePrice',    basePrice);
  if (weekendPrice !== null) formData.append('weekendPrice', weekendPrice);
  if (cleaningFee     !== null) formData.append('cleaningFee',     cleaningFee);
  if (touristTaxPerNight !== null) formData.append('touristTaxPerNight', touristTaxPerNight);
  if (conciergePct    !== null) formData.append('conciergePct',         conciergePct);
  formData.append('airbnbCommissionPct',  airbnbCommPct);
  formData.append('bookingCommissionPct', bookingCommPct);

  // Capacité d'accueil
  const maxGuests  = document.getElementById('propertyMaxGuests')?.value;
  const bedrooms   = document.getElementById('propertyBedrooms')?.value;
  const beds       = document.getElementById('propertyBeds')?.value;
  const bathrooms  = document.getElementById('propertyBathrooms')?.value;
  if (maxGuests  !== '' && maxGuests  != null) formData.append('maxGuests',  maxGuests);
  if (bedrooms   !== '' && bedrooms   != null) formData.append('bedrooms',   bedrooms);
  if (beds       !== '' && beds       != null) formData.append('beds',       beds);
  if (bathrooms  !== '' && bathrooms  != null) formData.append('bathrooms',  bathrooms);

  // ===== AJOUT DES NOUVELLES DONNÉES (ÉQUIPEMENTS, RÈGLES, INFOS) =====
  try {
    // Équipements
    const amenities = {
      draps: document.getElementById('amenityDraps')?.checked || false,
      serviettes: document.getElementById('amenityServiettes')?.checked || false,
      cuisine_equipee: document.getElementById('amenityCuisine')?.checked || false,
      lave_linge: document.getElementById('amenityLaveLinge')?.checked || false,
      lave_vaisselle: document.getElementById('amenityLaveVaisselle')?.checked || false,
      television: document.getElementById('amenityTelevision')?.checked || false,
      parking: document.getElementById('amenityParking')?.checked || false,
      climatisation: document.getElementById('amenityClimatisation')?.checked || false,
      custom: _customAmenities || []
    };
    formData.append('amenities', JSON.stringify(amenities));
    
    // Règles
    const houseRules = {
      animaux: document.getElementById('ruleAnimaux')?.checked || false,
      fumeurs: document.getElementById('ruleFumeurs')?.checked || false,
      fetes: document.getElementById('ruleFetes')?.checked || false,
      enfants: document.getElementById('ruleEnfants')?.checked || false,
      custom: _customRules || []
    };
    formData.append('houseRules', JSON.stringify(houseRules));
    
    // Infos pratiques
    const practicalInfo = {
      parking_details: document.getElementById('practicalParking')?.value?.trim() || '',
      trash_day: document.getElementById('practicalTrash')?.value?.trim() || '',
      nearby_shops: document.getElementById('practicalShops')?.value?.trim() || '',
      public_transport: document.getElementById('practicalTransport')?.value?.trim() || ''
    };
    formData.append('practicalInfo', JSON.stringify(practicalInfo));
    
    // Réponses auto
    const autoResponsesEnabled = document.getElementById('autoResponsesEnabled')?.checked || true;
    formData.append('autoResponsesEnabled', autoResponsesEnabled);

    // ✅ RACCOURCIS MESSAGES
    const quickReplies = Array.from(document.querySelectorAll('#quickRepliesList .qr-item'))
      .map(item => {
        const titleEl = item.querySelector('.qr-title');
        const textEl  = item.querySelector('.qr-input');
        const text  = textEl  ? textEl.value.trim()  : '';
        const title = titleEl ? titleEl.value.trim() : '';
        if (!text) return null;
        return { title: title || text.slice(0, 30), text };
      }).filter(Boolean);
    formData.append('quickReplies', JSON.stringify(quickReplies));

    // ✅ QUESTIONS-RÉPONSES PERSONNALISÉES
    formData.append('customAutoResponses', JSON.stringify(_customQR || []));

  } catch (e) {
    console.error('Erreur collecte données étendues:', e);
  }
  // ===== FIN AJOUT NOUVELLES DONNÉES =====

const ownerId = document.getElementById('propertyOwnerId')?.value ?? '';
formData.append('ownerId', ownerId); // Toujours envoyer, même vide (pour effacer)
  if (photoInput && photoInput.files && photoInput.files[0]) {
    formData.append('photo', photoInput.files[0]);
  }

  try {
    const token = localStorage.getItem("lcc_token");
    const method = propertyId ? "PUT" : "POST";
    const url = propertyId
      ? `${API_URL}/api/properties/${propertyId}`
      : `${API_URL}/api/properties`;

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: "Bearer " + token,
      },
      body: formData,
    });

    const result = await response.json();

    if (response.ok) {
      showToast(result.message || "Logement enregistré", "success");
      // ✅ Sauvegarder le cleaner par défaut AVANT de fermer la modale
      const pidVal = document.getElementById('propertyId')?.value;
      if (pidVal && typeof window.saveDefaultCleanerExternal === 'function') {
        await window.saveDefaultCleanerExternal(pidVal);
      }
      closeEditModal();
      await loadProperties();
    } else {
      showToast(
        result.error || "Une erreur est survenue lors de l'enregistrement",
        "error"
      );
    }
  } catch (error) {
    console.error("Erreur saveProperty:", error);
    showToast("Erreur lors de l'enregistrement du logement", "error");
  } finally {
    hideLoading();
  }
}

function deleteProperty(propertyId) {
  // Modale custom — confirm() est bloqué sur mobile/WebView Capacitor
  const existing = document.getElementById('_deletePropertyModal');
  if (existing) existing.remove();

  const prop = properties.find(p => p._id === propertyId || p.id === propertyId);
  const propName = prop ? (prop.internalName || prop.internal_name || prop.name || 'ce logement') : 'ce logement';

  const modal = document.createElement('div');
  modal.id = '_deletePropertyModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(13,17,23,.55);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;';
  modal.innerHTML = `
    <div style="background:white;border-radius:20px;padding:28px;max-width:360px;width:100%;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,.15);">
      <div style="width:52px;height:52px;border-radius:50%;background:#FEF2F2;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;font-size:22px;">🗑️</div>
      <h3 style="font-family:'DM Sans',sans-serif;font-size:16px;font-weight:700;color:#0D1117;margin:0 0 8px;">Supprimer ce logement ?</h3>
      <p style="font-size:13px;color:#7A8695;margin:0 0 20px;"><strong>${propName}</strong> sera définitivement supprimé. Cette action est irréversible.</p>
      <div style="display:flex;gap:10px;">
        <button id="_deletePropertyCancel" style="flex:1;height:44px;border-radius:12px;border:1.5px solid rgba(13,17,23,.15);background:white;color:#374151;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:600;cursor:pointer;">Annuler</button>
        <button id="_deletePropertyConfirm" style="flex:1;height:44px;border-radius:12px;border:none;background:#DC2626;color:white;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:600;cursor:pointer;">Supprimer</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('_deletePropertyCancel').onclick = () => modal.remove();
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  document.getElementById('_deletePropertyConfirm').onclick = async () => {
    modal.remove();
    showLoading();
    try {
      const token = localStorage.getItem("lcc_token");
      const response = await fetch(`${API_URL}/api/properties/${propertyId}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token },
      });
      if (response.ok) {
        showToast("Logement supprimé avec succès", "success");
        await loadProperties();
      } else {
        const data = await response.json();
        showToast(data.error || "Erreur lors de la suppression", "error");
      }
    } catch (error) {
      console.error("Erreur suppression:", error);
      showToast("Erreur lors de la suppression", "error");
    } finally {
      hideLoading();
    }
  };
}

// testIcalUrl et copyIcalUrl supprimés — remplacés par Channex

// ========================================
// MODAL HANDLERS
// ========================================
function resetPropertyForm() {
  currentEditingProperty = null;
  document.getElementById("propertyId").value = "";
  document.getElementById("propertyPhotoUrl").value = "";
  document.getElementById("propertyName").value = "";
  if (document.getElementById("propertyInternalName")) {
    document.getElementById("propertyInternalName").value = "";
  }
  document.getElementById("propertyAddress").value = "";
  document.getElementById("propertyArrivalTime").value = "";
  document.getElementById("propertyDepartureTime").value = "";
  document.getElementById("propertyDeposit").value = "";
  
  // ✅ RESET NOUVEAUX CHAMPS
  if (document.getElementById("propertyWelcomeBookUrl")) {
    document.getElementById("propertyWelcomeBookUrl").value = "";
  }
  if (document.getElementById("propertyAccessCode")) {
    document.getElementById("propertyAccessCode").value = "";
  }
  if (document.getElementById("propertyWifiName")) {
    document.getElementById("propertyWifiName").value = "";
  }
  if (document.getElementById("propertyWifiPassword")) {
    document.getElementById("propertyWifiPassword").value = "";
  }
  if (document.getElementById("propertyAccessInstructions")) {
    document.getElementById("propertyAccessInstructions").value = "";
  }
  if (document.getElementById("propertyOwnerId")) {
  document.getElementById("propertyOwnerId").value = "";
}
  document.getElementById("propertyColor").value = "#E67E50";

  const colorPreview = document.getElementById("colorPreview");
  if (colorPreview) colorPreview.textContent = "#E67E50";

  const photoInput = document.getElementById("propertyPhoto");
  if (photoInput) photoInput.value = "";

  const photoBox = document.getElementById("photoPreviewBox");
  if (photoBox) {
    photoBox.innerHTML =
      '<span class="photo-preview-placeholder"><i class="fas fa-image"></i></span>';
  }

  if (document.getElementById("propertyBasePrice")) {
    document.getElementById("propertyBasePrice").value = "";
  }
  if (document.getElementById("propertyWeekendPrice")) {
    document.getElementById("propertyWeekendPrice").value = "";
  }
  if (document.getElementById("propertyCleaningFee")) {
    document.getElementById("propertyCleaningFee").value = "";
  }
  if (document.getElementById("propertyTouristTax")) {
    document.getElementById("propertyTouristTax").value = "";
  }
  if (document.getElementById("propertyConciergePct")) {
    document.getElementById("propertyConciergePct").value = "";
  }
  if (document.getElementById("propertyAirbnbCommissionPct")) {
    document.getElementById("propertyAirbnbCommissionPct").value = "3";
  }
  if (document.getElementById("propertyBookingCommissionPct")) {
    document.getElementById("propertyBookingCommissionPct").value = "15";
  }
  ['propertyMaxGuests','propertyBedrooms','propertyBeds','propertyBathrooms'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  // Reset règles de tarification
  _pricingRules = [];
  _currentPricingPropertyId = null;
  const rulesList = document.getElementById('pricingRulesList');
  if (rulesList) rulesList.innerHTML = '<div style="font-size:13px;color:#9CA3AF;padding:10px 0;">Aucune règle configurée</div>';
  // Reset custom chips
  _customAmenities = [];
  _customRules = [];
  renderCustomChips('customAmenitiesContainer', [], 'removeCustomAmenity');
  renderCustomChips('customRulesContainer', [], 'removeCustomRule');
  // Reset custom QR
  _customQR = [];
  renderCustomQR();
  const newAmenityInput = document.getElementById('newAmenityInput');
  if (newAmenityInput) newAmenityInput.value = '';
  const newRuleInput = document.getElementById('newRuleInput');
  if (newRuleInput) newRuleInput.value = '';
  const urlList = document.getElementById("urlList");
  if (urlList) urlList.innerHTML = "";

  // ✅ Reset checkboxes équipements
  document.querySelectorAll('.amenity-checkbox').forEach(cb => cb.checked = false);
  // ✅ Reset checkboxes règles
  document.querySelectorAll('.rule-checkbox').forEach(cb => cb.checked = false);
  // ✅ Reset infos pratiques
  ['practicalParking','practicalTrash','practicalShops','practicalTransport'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  // ✅ Reset raccourcis messages
  const qrList = document.getElementById('quickRepliesList');
  if (qrList) qrList.innerHTML = '';
}

function openAddPropertyModal() {
  resetPropertyForm();
  const modal = document.getElementById("editPropertyModal");
  const titleEl = document.getElementById("modalTitle");
  if (titleEl) titleEl.querySelector("span").textContent = "Ajouter un logement";

  if (modal) modal.classList.add("active");
}

function duplicateProperty(propertyId) {
  const property = properties.find(p => p._id === propertyId || p.id === propertyId);
  if (!property) { showToast('Logement introuvable', 'error'); return; }

  // Ouvrir le modal en mode création
  resetPropertyForm();
  const modal = document.getElementById('editPropertyModal');
  const titleEl = document.getElementById('modalTitle');
  if (titleEl) titleEl.querySelector('span').textContent = 'Dupliquer un logement';
  if (modal) modal.classList.add('active');

  // Pré-remplir avec les infos du logement source (sauf nom, iCal, Channex)
  const setVal = (id, val) => { const el = document.getElementById(id); if (el && val != null) el.value = val; };

  // Nom vide — l'utilisateur doit le saisir
  setVal('propertyName', '');
  setVal('propertyInternalName', (property.internalName || property.internal_name || '') + ' (copie)');
  setVal('propertyAddress', property.address || '');

  populateTimeSelects();
  setVal('propertyArrivalTime', property.arrivalTime || '');
  setVal('propertyDepartureTime', property.departureTime || '');
  setVal('propertyDeposit', property.depositAmount != null ? property.depositAmount : '');

  const colorInput = document.getElementById('propertyColor');
  const preview = document.getElementById('colorPreview');
  if (colorInput) colorInput.value = property.color || '#E67E50';
  if (preview) preview.textContent = (property.color || '#E67E50').toUpperCase();

  // Photo
  setVal('propertyPhotoUrl', property.photoUrl || property.photo || '');

  // Infos accès
  setVal('propertyWelcomeBookUrl', property.welcomeBookUrl || '');
  setVal('propertyAccessCode', property.accessCode || '');
  setVal('propertyWifiName', property.wifiName || '');
  setVal('propertyWifiPassword', property.wifiPassword || '');
  setVal('propertyAccessInstructions', property.accessInstructions || '');

  // Prix
  setVal('propertyBasePrice', property.basePrice ?? property.base_price ?? '');
  setVal('propertyWeekendPrice', property.weekendPrice ?? property.weekend_price ?? '');
  setVal('propertyCleaningFee', property.cleaningFee ?? property.cleaning_fee ?? '');
  setVal('propertyTouristTax', property.touristTaxPerNight ?? property.tourist_tax_per_night ?? '');
  setVal('propertyConciergePct', property.conciergePct ?? property.concierge_pct ?? '');
  setVal('propertyAirbnbCommissionPct', property.airbnbCommissionPct ?? property.airbnb_commission_pct ?? '3');
  setVal('propertyBookingCommissionPct', property.bookingCommissionPct ?? property.booking_commission_pct ?? '15');

  // Capacité
  setVal('propertyMaxGuests', property.maxGuests ?? property.max_guests ?? '');
  setVal('propertyBedrooms', property.bedrooms ?? '');
  setVal('propertyBeds', property.beds ?? '');
  setVal('propertyBathrooms', property.bathrooms ?? '');

  // Équipements, règles, infos pratiques
  try {
    const amenities = property.amenities || [];
    if (Array.isArray(amenities)) {
      document.querySelectorAll('.amenity-checkbox').forEach(cb => {
        cb.checked = amenities.includes(cb.value);
      });
    }
  } catch(e) {}
  try {
    const rules = property.house_rules || property.houseRules || [];
    if (Array.isArray(rules)) {
      document.querySelectorAll('.rule-checkbox').forEach(cb => {
        cb.checked = rules.includes(cb.value);
      });
    }
  } catch(e) {}
  try {
    setVal('propertyPracticalInfo', property.practicalInfo || property.practical_info || '');
  } catch(e) {}

  // Infos pratiques
  try {
    const practical = (property.practical_info || property.practicalInfo)
      ? (() => { const v = property.practical_info || property.practicalInfo; return typeof v === 'string' ? JSON.parse(v) : v; })()
      : {};
    if (document.getElementById('practicalParking'))
      document.getElementById('practicalParking').value = practical.parking_details || '';
    if (document.getElementById('practicalTrash'))
      document.getElementById('practicalTrash').value = practical.trash_day || '';
    if (document.getElementById('practicalShops'))
      document.getElementById('practicalShops').value = practical.nearby_shops || '';
    if (document.getElementById('practicalTransport'))
      document.getElementById('practicalTransport').value = practical.public_transport || '';
  } catch(e) {}

  // Raccourcis messages
  try {
    const qrList = document.getElementById('quickRepliesList');
    const qrBtn = document.getElementById('addQuickReplyBtn');
    if (qrList) {
      qrList.innerHTML = '';
      if (qrBtn) qrBtn.style.display = 'flex';
      let replies = property.quick_replies || property.quickReplies || [];
      if (typeof replies === 'string') { try { replies = JSON.parse(replies); } catch(e) { replies = []; } }
      if (Array.isArray(replies)) replies.forEach(t => { if (typeof window.addQuickReplyField === 'function') window.addQuickReplyField(t); });
    }
  } catch(e) {}

  // PAS de connexion iCal ni Channex — le nouveau logement part sans
  showToast('Logement dupliqué — saisissez un nom et enregistrez', 'info');
}

function openEditPropertyModal(propertyId) {
  resetPropertyForm();
  const modal = document.getElementById("editPropertyModal");
  const titleEl = document.getElementById("modalTitle");
  if (titleEl) titleEl.querySelector("span").textContent = "Modifier le logement";

  const property = properties.find((p) => p._id === propertyId || p.id === propertyId);
  if (!property) {
    showToast("Logement introuvable", "error");
    return;
  }

  currentEditingProperty = property;
  document.getElementById("propertyId").value = property._id || property.id || "";
  document.getElementById("propertyName").value = property.name || "";
  if (document.getElementById("propertyInternalName")) {
    document.getElementById("propertyInternalName").value = property.internalName || property.internal_name || "";
  }
  document.getElementById("propertyAddress").value = property.address || "";
  // Populate selects first, then set value
  populateTimeSelects();
  document.getElementById("propertyArrivalTime").value = property.arrivalTime || "";
  document.getElementById("propertyDepartureTime").value = property.departureTime || "";
  document.getElementById("propertyDeposit").value =
    property.depositAmount != null ? property.depositAmount : "";

  const colorInput = document.getElementById("propertyColor");
  const preview = document.getElementById("colorPreview");
  if (colorInput) colorInput.value = property.color || "#E67E50";
  if (preview) preview.textContent = (property.color || "#E67E50").toUpperCase();

  const photoUrl = property.photoUrl || property.photo || null;
  document.getElementById("propertyPhotoUrl").value = photoUrl || "";
  
  // ✅ REMPLIR NOUVEAUX CHAMPS
  if (document.getElementById("propertyWelcomeBookUrl")) {
    document.getElementById("propertyWelcomeBookUrl").value = property.welcomeBookUrl || "";
  }
  if (document.getElementById("propertyAccessCode")) {
    document.getElementById("propertyAccessCode").value = property.accessCode || "";
  }
  if (document.getElementById("propertyWifiName")) {
    document.getElementById("propertyWifiName").value = property.wifiName || "";
  }
  if (document.getElementById("propertyWifiPassword")) {
    document.getElementById("propertyWifiPassword").value = property.wifiPassword || "";
  }
  if (document.getElementById("propertyAccessInstructions")) {
    document.getElementById("propertyAccessInstructions").value = property.accessInstructions || "";
  }
  // ✅ MESSAGE D'ARRIVÉE

  // ✅ PRIX PAR NUIT
  if (document.getElementById("propertyBasePrice")) {
    const bp = property.basePrice ?? property.base_price;
    document.getElementById("propertyBasePrice").value = bp != null ? bp : "";
  }
  if (document.getElementById("propertyWeekendPrice")) {
    const wp = property.weekendPrice ?? property.weekend_price;
    document.getElementById("propertyWeekendPrice").value = wp != null ? wp : "";
  }
  if (document.getElementById("propertyCleaningFee")) {
    const cf = property.cleaningFee ?? property.cleaning_fee;
    document.getElementById("propertyCleaningFee").value = cf != null ? cf : "";
  }
  if (document.getElementById("propertyTouristTax")) {
    const tt = property.touristTaxPerNight ?? property.tourist_tax_per_night;
    document.getElementById("propertyTouristTax").value = tt != null ? tt : "";
  }
  if (document.getElementById("propertyConciergePct")) {
    const cp = property.conciergePct ?? property.concierge_pct;
    document.getElementById("propertyConciergePct").value = cp != null ? cp : "";
  }
  if (document.getElementById("propertyAirbnbCommissionPct")) {
    const ac = property.airbnbCommissionPct ?? property.airbnb_commission_pct;
    document.getElementById("propertyAirbnbCommissionPct").value = ac != null ? ac : "3";
  }
  if (document.getElementById("propertyBookingCommissionPct")) {
    const bc = property.bookingCommissionPct ?? property.booking_commission_pct;
    document.getElementById("propertyBookingCommissionPct").value = bc != null ? bc : "15";
  }

  // Capacité d'accueil
  if (document.getElementById("propertyMaxGuests"))
    document.getElementById("propertyMaxGuests").value = property.maxGuests ?? property.max_guests ?? '';
  if (document.getElementById("propertyBedrooms"))
    document.getElementById("propertyBedrooms").value = property.bedrooms ?? '';
  if (document.getElementById("propertyBeds"))
    document.getElementById("propertyBeds").value = property.beds ?? '';
  if (document.getElementById("propertyBathrooms"))
    document.getElementById("propertyBathrooms").value = property.bathrooms ?? '';

  // ✅ RACCOURCIS MESSAGES
  try {
    var qrList = document.getElementById('quickRepliesList');
    var qrBtn  = document.getElementById('addQuickReplyBtn');
    if (qrList) {
      qrList.innerHTML = '';
      if (qrBtn) qrBtn.style.display = 'flex';
      var replies = property.quick_replies || property.quickReplies || [];
      if (typeof replies === 'string') { try { replies = JSON.parse(replies); } catch(e) { replies = []; } }
      if (Array.isArray(replies)) replies.forEach(function(t) { if (typeof window.addQuickReplyField === 'function') window.addQuickReplyField(t); });

    // Charger les questions-réponses personnalisées
    try {
      const rawQR = property.custom_auto_responses || property.customAutoResponses;
      _customQR = Array.isArray(rawQR) ? rawQR
        : (typeof rawQR === 'string' ? JSON.parse(rawQR) : []);
    } catch(e) { _customQR = []; }
    renderCustomQR();
    }
  } catch(e) { console.warn('Raccourcis:', e); }
  if (document.getElementById("propertyOwnerId")) {
  document.getElementById("propertyOwnerId").value = property.owner_id || "";
}

  // ===== CHARGER LES NOUVELLES DONNÉES (ÉQUIPEMENTS, RÈGLES, INFOS) =====
  try {
    // Équipements
    const amenities = property.amenities
      ? (typeof property.amenities === 'string' ? JSON.parse(property.amenities) : property.amenities)
      : {};
    
    if (document.getElementById('amenityDraps')) 
      document.getElementById('amenityDraps').checked = amenities.draps || false;
    if (document.getElementById('amenityServiettes')) 
      document.getElementById('amenityServiettes').checked = amenities.serviettes || false;
    if (document.getElementById('amenityCuisine')) 
      document.getElementById('amenityCuisine').checked = amenities.cuisine_equipee || false;
    if (document.getElementById('amenityLaveLinge')) 
      document.getElementById('amenityLaveLinge').checked = amenities.lave_linge || false;
    if (document.getElementById('amenityLaveVaisselle')) 
      document.getElementById('amenityLaveVaisselle').checked = amenities.lave_vaisselle || false;
    if (document.getElementById('amenityTelevision')) 
      document.getElementById('amenityTelevision').checked = amenities.television || false;
    if (document.getElementById('amenityParking')) 
      document.getElementById('amenityParking').checked = amenities.parking || false;
    if (document.getElementById('amenityClimatisation')) 
      document.getElementById('amenityClimatisation').checked = amenities.climatisation || false;
    // Custom amenities
    _customAmenities = Array.isArray(amenities.custom) ? [...amenities.custom] : [];
    renderCustomChips('customAmenitiesContainer', _customAmenities, 'removeCustomAmenity');
    
    // Règles
    const rules = (property.house_rules || property.houseRules)
      ? (() => { const v = property.house_rules || property.houseRules; return typeof v === 'string' ? JSON.parse(v) : v; })()
      : {};
    
    if (document.getElementById('ruleAnimaux')) 
      document.getElementById('ruleAnimaux').checked = rules.animaux || false;
    if (document.getElementById('ruleFumeurs')) 
      document.getElementById('ruleFumeurs').checked = rules.fumeurs || false;
    if (document.getElementById('ruleFetes')) 
      document.getElementById('ruleFetes').checked = rules.fetes || false;
    if (document.getElementById('ruleEnfants')) 
      document.getElementById('ruleEnfants').checked = rules.enfants !== undefined ? rules.enfants : false;
    // Custom rules
    _customRules = Array.isArray(rules.custom) ? [...rules.custom] : [];
    renderCustomChips('customRulesContainer', _customRules, 'removeCustomRule');
    
    // Infos pratiques
    const practical = (property.practical_info || property.practicalInfo)
      ? (() => { const v = property.practical_info || property.practicalInfo; return typeof v === 'string' ? JSON.parse(v) : v; })()
      : {};
    
    if (document.getElementById('practicalParking')) 
      document.getElementById('practicalParking').value = practical.parking_details || '';
    if (document.getElementById('practicalTrash')) 
      document.getElementById('practicalTrash').value = practical.trash_day || '';
    if (document.getElementById('practicalShops')) 
      document.getElementById('practicalShops').value = practical.nearby_shops || '';
    if (document.getElementById('practicalTransport')) 
      document.getElementById('practicalTransport').value = practical.public_transport || '';
    
    // Réponses auto
    if (document.getElementById('autoResponsesEnabled')) 
      document.getElementById('autoResponsesEnabled').checked = property.auto_responses_enabled !== undefined ? property.auto_responses_enabled : true;
    
  } catch (e) {
    console.error('Erreur chargement données étendues:', e);
  }
  // ===== FIN CHARGEMENT NOUVELLES DONNÉES =====

  const photoBox = document.getElementById("photoPreviewBox");
  if (photoBox) {
    if (photoUrl) {
      photoBox.innerHTML = "";
      const img = document.createElement("img");
      img.src = photoUrl;
      photoBox.appendChild(img);
    } else {
      photoBox.innerHTML =
        '<span class="photo-preview-placeholder"><i class="fas fa-image"></i></span>';
    }
  }

  // Charger les URLs iCal existantes
  const existingIcal = property.icalUrls || property.ical_urls || [];
  window._currentIcalUrls = Array.isArray(existingIcal) ? existingIcal : [];
  if (typeof renderIcalUrls === 'function') renderIcalUrls();
  if (typeof initIcalExportUrl === 'function') initIcalExportUrl(property._id || property.id);

  // ✅ CHARGER LES RÈGLES DE TARIFICATION
  if (typeof loadPricingRules === 'function') {
    loadPricingRules(property._id || property.id);
  }

  // ✅ CHARGER LES AVIS OTA (Channex)
  if (typeof initReviewsSection === 'function') {
    const pid = property._id || property.id;
    const isConnected = !!(property.channex_enabled || property.channexEnabled) && !!(property.channex_property_id || property.channexPropertyId);
    initReviewsSection(pid, isConnected);
  }

  // ✅ CHARGER LES NOTES VOYAGEURS (depuis DB reservations)
  if (typeof initNotesSection === 'function') {
    initNotesSection(property._id || property.id);
  }

  if (modal) modal.classList.add("active");
}

function closeEditModal() {
  const modal = document.getElementById("editPropertyModal");
  if (modal) modal.classList.remove("active");
}

// addUrlField + buildBoostinghostIcalUrl supprimés — remplacés par Channex

// ========================================
// RENDER PROPERTIES
// ========================================
function renderProperties() {
  const grid = document.getElementById("propertiesGrid");
  const emptyState = document.getElementById("propertiesEmptyState");
  if (!grid || !emptyState) return;

  if (!properties || properties.length === 0) {
    grid.innerHTML = "";
    emptyState.style.display = "block";
    return;
  }

  emptyState.style.display = "none";

  const cardsHtml = properties
    .map((p, idx) => {
      const id = p._id || p.id || "";
      const isFirst = idx === 0;
      const isLast = idx === properties.length - 1;
      const color = p.color || "#059669";
      const name = p.name || "Sans nom";
      const address = p.address || "";
      const arrivalTime = p.arrivalTime || "";
      const departureTime = p.departureTime || "";
      const depositLabel =
        p.depositAmount != null && p.depositAmount !== ""
          ? `Caution ${p.depositAmount} €`
          : "Pas de caution";
      // Nouveaux champs : wifi / accès / livret
      const wifiName = p.wifiName || "";
      const wifiPassword = p.wifiPassword || "";
      const accessCode = p.accessCode || "";
      const hasAccessInfo = accessCode || p.accessInstructions;
      const welcomeBookUrl = p.welcomeBookUrl || "";
      const photoUrl = p.photoUrl || p.photo || null;
      // icalListHtml supprimé — Channex gère la synchronisation OTA

      const addressBadge = address
        ? `<span class="meta-badge"><i class="fas fa-location-dot"></i>${escapeHtml(
            address
          )}</span>`
        : "";

      const timesBadge =
        arrivalTime || departureTime
          ? `<span class="meta-badge">
              <i class="fas fa-clock"></i>
              ${
                arrivalTime
                  ? `Arrivée ${escapeHtml(arrivalTime)}`
                  : "Arrivée -"
              }
              &nbsp;·&nbsp;
              ${
                departureTime
                  ? `Départ ${escapeHtml(departureTime)}`
                  : "Départ -"
              }
            </span>`
          : "";

      const depositBadge = `<span class="meta-badge">
          <i class="fas fa-shield-alt"></i>${depositLabel}
        </span>`;
      const wifiBadge =
        wifiName || wifiPassword
          ? `<span class="meta-badge">
              <i class="fas fa-wifi"></i>
              ${escapeHtml(wifiName || "WiFi")}
              ${
                wifiPassword
                  ? " (" + escapeHtml(wifiPassword) + ")"
                  : ""
              }
            </span>`
          : "";

      const accessBadge = hasAccessInfo
        ? `<span class="meta-badge">
            <i class="fas fa-key"></i>
            ${
              accessCode
                ? "Code " + escapeHtml(accessCode)
                : "Infos accès"
            }
          </span>`
        : "";

      const welcomeBookBadge = welcomeBookUrl
        ? `<a href="${escapeHtml(
            welcomeBookUrl
          )}" target="_blank" class="meta-badge">
            <i class="fas fa-book-open"></i>
            Livret d'accueil
          </a>`
        : "";

      // boostinghostHtml (lien iCal export) supprimé

      const arrivalLabel = arrivalTime ? arrivalTime : '--';
      const departureLabel = departureTime ? departureTime : '--';
      const depositShort = p.depositAmount != null && p.depositAmount !== '' ? p.depositAmount + ' €' : '–';
      const propertyEmoji = photoUrl ? '' : ['🏢','🌲','🏙️','🏡','🏖️','🏔️'][Math.abs(name.charCodeAt(0)) % 6];

      return `
        <div class="property-card" data-id="${escapeHtml(id)}">
          <!-- Image / hero -->
          <div class="property-img" style="cursor:pointer;" onclick="openEditPropertyModal('${escapeHtml(id)}')">
            ${photoUrl
              ? `<img class="property-img-bg" src="${escapeHtml(photoUrl)}" alt="${escapeHtml(name)}" />`
              : `<div class="property-img-placeholder" style="background: linear-gradient(160deg, #e8e0d4 0%, #c8b89a 100%); width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-size:52px;">${propertyEmoji}</div>`
            }
            <div class="property-img-overlay"></div>

            <div class="dnd-handle" title="Maintenir pour réorganiser" onclick="event.stopPropagation()">
              <i class="fas fa-grip-vertical"></i>
            </div>
          </div>
          <!-- Info -->
          <div class="property-info">
            <div class="property-name">${escapeHtml(name)}</div>
            ${address ? `<div class="property-address"><i class="fas fa-location-dot" style="color:#1A7A5E;font-size:11px;"></i> ${escapeHtml(address)}</div>` : ''}
            <!-- Stats -->
            <div class="property-stats">
              <div class="prop-stat">
                <div class="prop-stat-val">${arrivalLabel}</div>
                <div class="prop-stat-label">Arrivée</div>
              </div>
              <div class="prop-stat">
                <div class="prop-stat-val">${departureLabel}</div>
                <div class="prop-stat-label">Départ</div>
              </div>
              <div class="prop-stat">
                <div class="prop-stat-val" style="color:#1A7A5E;">${depositShort}</div>
                <div class="prop-stat-label">Caution</div>
              </div>
            </div>
            <!-- OTA status -->
            ${p.channexEnabled ? `
            <button type="button" class="btn-channex-manage" data-id="${escapeHtml(id)}" data-name="${escapeHtml(name)}" style="width:100%;margin-bottom:4px;padding:6px 10px;background:#e8f5f1;border:1px solid #b8ddd4;border-radius:8px;cursor:pointer;display:flex;align-items:center;gap:6px;text-align:left;">
              <span style="width:7px;height:7px;border-radius:50%;background:#1A7A5E;flex-shrink:0;"></span>
              <span style="font-size:11px;font-weight:600;color:#1A7A5E;flex:1;">Synchronisation OTA active</span>
              <i class="fas fa-cog" style="font-size:11px;color:#1A7A5E;opacity:.7;"></i>
            </button>
            ${p.channexPropertyId ? `
            <div onclick="navigator.clipboard?.writeText('${p.channexPropertyId}').then(()=>showToast('ID copié','success')).catch(()=>{})" style="width:100%;margin-bottom:4px;padding:4px 10px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;display:flex;align-items:center;gap:6px;" title="Cliquer pour copier">
              <i class="fas fa-copy" style="font-size:10px;color:#94a3b8;flex-shrink:0;"></i>
              <span style="font-size:10px;color:#64748b;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${p.channexPropertyId}</span>
            </div>
            <div id="channels-${p.id || id}" style="width:100%;margin-bottom:8px;display:flex;flex-wrap:wrap;gap:4px;min-height:20px;">
              <span style="font-size:10px;color:#94a3b8;font-style:italic;">Chargement...</span>
            </div>
            <button type="button" class="btn-sync-bookings" data-id="${escapeHtml(id)}" title="Importer toutes les réservations Channex" style="width:100%;margin-bottom:8px;padding:4px 10px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:6px;cursor:pointer;display:flex;align-items:center;gap:5px;font-size:10px;color:#64748b;">
              <i class="fas fa-cloud-download-alt" style="font-size:10px;"></i>
              <span>Importer l'historique des réservations</span>
            </button>` : ''}` : `
            <button type="button" class="btn-channex-connect" data-id="${escapeHtml(id)}" data-name="${escapeHtml(name)}" style="width:100%;margin-bottom:8px;padding:7px 12px;background:linear-gradient(135deg,#1A7A5E,#2AAE86);color:white;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
              <i class="fas fa-plug"></i> Connecter mes plateformes
            </button>`}
            <!-- Actions -->
            <div class="property-actions">
              <button type="button" class="btn btn-delete" data-id="${escapeHtml(id)}">Supprimer</button>
              <button type="button" class="btn btn-outline btn-duplicate" data-id="${escapeHtml(id)}" title="Dupliquer ce logement" style="background:#f8fafc;border:1px solid #e2e8f0;color:#374151;"><i class="fas fa-copy" style="margin-right:4px;font-size:11px;"></i>Dupliquer</button>
              <button type="button" class="btn btn-jade btn-edit" data-id="${escapeHtml(id)}">Gérer</button>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  // Add dashed "Ajouter" card at the end
  const addCard = `
    <div class="property-card property-card-add" id="addPropertyBtn" onclick="openAddPropertyModal()">
      <div class="property-card-add-inner">
        <div class="property-card-add-icon">
          <i class="fas fa-plus"></i>
        </div>
        <div class="property-card-add-label">Ajouter un logement</div>
        <div class="property-card-add-sub">Connectez Airbnb, Booking, direct</div>
      </div>
    </div>`;

  grid.innerHTML = cardsHtml + addCard;

  // Update count badge
  const countEl = document.getElementById('propertiesCount');
  if (countEl) countEl.textContent = properties.length + (properties.length > 1 ? ' LOGEMENTS ACTIFS' : ' LOGEMENT ACTIF');

  // Render filter bar
  renderFilterBar();

  grid.querySelectorAll(".btn-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      openEditPropertyModal(id);
    });
  });

  grid.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      deleteProperty(id);
    }, { once: true });
  });

  grid.querySelectorAll(".btn-duplicate").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      duplicateProperty(id);
    }, { once: true });
  });

  // event listeners iCal supprimés — remplacés par Channex

  // ── Boutons Channex ──────────────────────────────────────────
  grid.querySelectorAll(".btn-channex-connect").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const name = btn.getAttribute("data-name");
      openChannexModal(id, name, false);
    });
  });

  grid.querySelectorAll(".btn-channex-manage").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const name = btn.getAttribute("data-name");
      openChannexModal(id, name, true);
    });
  });

  grid.querySelectorAll(".btn-sync-bookings").forEach((btn) => {
    btn.addEventListener("click", () => syncChannexBookings(btn.getAttribute("data-id"), btn));
  });

  // Charger les logos des plateformes connectées
  properties.filter(p => p.channexEnabled && p.channexPropertyId).forEach(p => {
    loadConnectedChannels(p.id, `channels-${p.id}`);
  });
}
// Render a filtered subset of properties (preserves add card)
function renderPropertiesFiltered(filteredProps) {
  const grid = document.getElementById("propertiesGrid");
  if (!grid) return;

  if (!filteredProps || filteredProps.length === 0) {
    const addCard = `<div class="property-card property-card-add" id="addPropertyBtn" onclick="openAddPropertyModal()">
      <div class="property-card-add-inner">
        <div class="property-card-add-icon"><i class="fas fa-plus"></i></div>
        <div class="property-card-add-label">Ajouter un logement</div>
        <div class="property-card-add-sub">Connectez Airbnb, Booking, direct</div>
      </div>
    </div>`;
    grid.innerHTML = `<p style="color:#9CA3AF;font-size:14px;grid-column:1/-1;padding:24px 0;text-align:center;">Aucun logement dans ce groupe.</p>` + addCard;
    return;
  }

  // Re-use the existing renderProperties but with a subset
  const savedProperties = properties;
  const savedFilter = activeFilter;
  // Temporarily override to avoid infinite loop — render cards directly
  const cardsHtml = filteredProps.map((p, idx) => {
    const id = p._id || p.id || "";
    const color = p.color || "#059669";
    const name = p.name || "Sans nom";
    const address = p.address || "";
    const arrivalTime = p.arrivalTime || "";
    const departureTime = p.departureTime || "";
    const arrivalLabel = arrivalTime || '--';
    const departureLabel = departureTime || '--';
    const depositShort = p.depositAmount != null && p.depositAmount !== '' ? p.depositAmount + ' €' : '–';
    const photoUrl = p.photoUrl || p.photo || null;
    const propertyEmoji = photoUrl ? '' : ['🏢','🌲','🏙️','🏡','🏖️','🏔️'][Math.abs(name.charCodeAt(0)) % 6];

    // Group badge
    const groups = getGroups();
    const group = groups.find(g => (g.propertyIds || []).includes(id));
    const groupBadge = group ? `<div style="display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:600;padding:2px 8px;border-radius:999px;background:rgba(26,122,94,.1);color:#1A7A5E;margin-bottom:6px;"><i class="fas fa-layer-group" style="font-size:9px;"></i>${escapeHtml(group.name)}</div>` : '';

    return `
      <div class="property-card" data-id="${escapeHtml(id)}">
        <div class="property-img" style="cursor:pointer;" onclick="openEditPropertyModal('${escapeHtml(id)}')">
          ${photoUrl
            ? `<img class="property-img-bg" src="${escapeHtml(photoUrl)}" alt="${escapeHtml(name)}" />`
            : `<div class="property-img-placeholder" style="background:linear-gradient(160deg,#e8e0d4 0%,#c8b89a 100%);width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:52px;">${propertyEmoji}</div>`
          }
          <div class="property-img-overlay"></div>

          <div class="dnd-handle" title="Maintenir pour réorganiser" onclick="event.stopPropagation()">
            <i class="fas fa-grip-vertical"></i>
          </div>
        </div>
        <div class="property-info">
          ${groupBadge}
          <div class="property-name">${escapeHtml(name)}</div>
          ${address ? `<div class="property-address"><i class="fas fa-location-dot" style="color:#1A7A5E;font-size:11px;"></i> ${escapeHtml(address)}</div>` : ''}
          <div class="property-stats">
            <div class="prop-stat"><div class="prop-stat-val">${arrivalLabel}</div><div class="prop-stat-label">Arrivée</div></div>
            <div class="prop-stat"><div class="prop-stat-val">${departureLabel}</div><div class="prop-stat-label">Départ</div></div>
            <div class="prop-stat"><div class="prop-stat-val" style="color:#1A7A5E;">${depositShort}</div><div class="prop-stat-label">Caution</div></div>
          </div>
          ${p.channexEnabled ? `
          <button type="button" class="btn-channex-manage" data-id="${escapeHtml(id)}" data-name="${escapeHtml(name)}" style="width:100%;margin-bottom:4px;padding:6px 10px;background:#e8f5f1;border:1px solid #b8ddd4;border-radius:8px;cursor:pointer;display:flex;align-items:center;gap:6px;text-align:left;">
            <span style="width:7px;height:7px;border-radius:50%;background:#1A7A5E;flex-shrink:0;"></span>
            <span style="font-size:11px;font-weight:600;color:#1A7A5E;flex:1;">Synchronisation OTA active</span>
            <i class="fas fa-cog" style="font-size:11px;color:#1A7A5E;opacity:.7;"></i>
          </button>
          ${p.channexPropertyId ? `
          <div onclick="navigator.clipboard?.writeText('${p.channexPropertyId}').then(()=>showToast('ID copié','success')).catch(()=>{})" style="width:100%;margin-bottom:4px;padding:4px 10px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;display:flex;align-items:center;gap:6px;" title="Cliquer pour copier">
            <i class="fas fa-copy" style="font-size:10px;color:#94a3b8;flex-shrink:0;"></i>
            <span style="font-size:10px;color:#64748b;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${p.channexPropertyId}</span>
          </div>
          <div id="channels-${p.id || id}" style="width:100%;margin-bottom:8px;display:flex;flex-wrap:wrap;gap:4px;min-height:20px;">
            <span style="font-size:10px;color:#94a3b8;font-style:italic;">Chargement...</span>
          </div>
          <button type="button" class="btn-sync-bookings" data-id="${escapeHtml(id)}" title="Importer toutes les réservations Channex" style="width:100%;margin-bottom:8px;padding:4px 10px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:6px;cursor:pointer;display:flex;align-items:center;gap:5px;font-size:10px;color:#64748b;">
            <i class="fas fa-cloud-download-alt" style="font-size:10px;"></i>
            <span>Importer l'historique des réservations</span>
          </button>` : ''}` : `
          <button type="button" class="btn-channex-connect" data-id="${escapeHtml(id)}" data-name="${escapeHtml(name)}" style="width:100%;margin-bottom:8px;padding:7px 12px;background:linear-gradient(135deg,#1A7A5E,#2AAE86);color:white;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
            <i class="fas fa-plug"></i> Connecter mes plateformes
          </button>`}
          <div class="property-actions">
            <button type="button" class="btn btn-delete" data-id="${escapeHtml(id)}">Supprimer</button>
            <button type="button" class="btn btn-outline btn-duplicate" data-id="${escapeHtml(id)}" title="Dupliquer ce logement" style="background:#f8fafc;border:1px solid #e2e8f0;color:#374151;"><i class="fas fa-copy" style="margin-right:4px;font-size:11px;"></i>Dupliquer</button>
            <button type="button" class="btn btn-jade btn-edit" data-id="${escapeHtml(id)}">Gérer</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  const addCard = `<div class="property-card property-card-add" id="addPropertyBtn" onclick="openAddPropertyModal()">
    <div class="property-card-add-inner">
      <div class="property-card-add-icon"><i class="fas fa-plus"></i></div>
      <div class="property-card-add-label">Ajouter un logement</div>
      <div class="property-card-add-sub">Connectez Airbnb, Booking, direct</div>
    </div>
  </div>`;

  grid.innerHTML = cardsHtml + addCard;

  // Vue liste sur mobile si activée
  const isMobile = window.innerWidth <= 1366;
  if (isMobile && currentView === 'list') {
    grid.classList.add('list-view');
    const listHtml = filteredProps.map(p => renderListItem(p)).join('');
    grid.innerHTML = listHtml;
  } else {
    grid.classList.remove('list-view');
  }

  grid.querySelectorAll(".btn-edit").forEach(btn => {
    btn.addEventListener("click", () => openEditPropertyModal(btn.getAttribute("data-id")));
  });
  grid.querySelectorAll(".btn-delete").forEach(btn => {
    btn.addEventListener("click", () => deleteProperty(btn.getAttribute("data-id")), { once: true });
  });

  grid.querySelectorAll(".btn-duplicate").forEach(btn => {
    btn.addEventListener("click", () => duplicateProperty(btn.getAttribute("data-id")), { once: true });
  });
  grid.querySelectorAll(".btn-channex-connect").forEach(btn => {
    btn.addEventListener("click", () => openChannexModal(btn.getAttribute("data-id"), btn.getAttribute("data-name"), false));
  });
  grid.querySelectorAll(".btn-channex-manage").forEach(btn => {
    btn.addEventListener("click", () => openChannexModal(btn.getAttribute("data-id"), btn.getAttribute("data-name"), true));
  });
  grid.querySelectorAll(".btn-sync-bookings").forEach(btn => {
    btn.addEventListener("click", () => syncChannexBookings(btn.getAttribute("data-id"), btn));
  });

  // Charger les logos des plateformes connectées
  properties.filter(p => p.channexEnabled && p.channexPropertyId).forEach(p => {
    loadConnectedChannels(p.id, `channels-${p.id}`);
  });
}

// ============================================================
// VIEW TOGGLE — GRILLE / LISTE (mobile only)
// ============================================================
let currentView = localStorage.getItem('bh_prop_view') || 'grid';

function setPropertyView(view) {
  currentView = view;
  localStorage.setItem('bh_prop_view', view);
  // Mettre à jour les boutons toggle
  document.getElementById('btnViewGrid')?.classList.toggle('active', view === 'grid');
  document.getElementById('btnViewList')?.classList.toggle('active', view === 'list');
  // Re-render avec la nouvelle vue
  applyFilter();
}

function initViewToggle() {
  const savedView = localStorage.getItem('bh_prop_view') || 'grid';
  currentView = savedView;
  document.getElementById('btnViewGrid')?.classList.toggle('active', savedView === 'grid');
  document.getElementById('btnViewList')?.classList.toggle('active', savedView === 'list');
}

// Génère le HTML d'un item en vue liste
function renderListItem(p) {
  const id = p._id || p.id || '';
  const name = p.name || 'Sans nom';
  const address = p.address || '';
  const photoUrl = p.photoUrl || p.photo || null;
  const propertyEmoji = photoUrl ? '' : ['🏢','🌲','🏙️','🏡','🏖️','🏔️'][Math.abs(name.charCodeAt(0)) % 6];

  // Badges OTA
  let otaBadges = '';
  if (p.channexEnabled) {
    otaBadges = `<span class="ota-chip"><span style="width:7px;height:7px;border-radius:50%;background:#1A7A5E;display:inline-block;"></span> Sync OTA</span>`;
  } else {
    otaBadges = `<span class="ota-chip" style="color:#9CA3AF;border-color:rgba(156,163,175,.3);background:rgba(156,163,175,.07);">Non connecté</span>`;
  }

  return `
    <div class="property-list-item" data-id="${escapeHtml(id)}" onclick="openEditPropertyModal('${escapeHtml(id)}')">
      <div class="dnd-handle-list" title="Glisser pour réorganiser" onclick="event.stopPropagation()">
        <i class="fas fa-grip-vertical"></i>
      </div>
      <div class="property-list-thumb">
        ${photoUrl
          ? `<img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(name)}" />`
          : propertyEmoji
        }
      </div>
      <div class="property-list-info">
        <div class="property-list-name">${escapeHtml(name)}</div>
        ${address ? `<div class="property-list-address"><i class="fas fa-location-dot" style="font-size:9px;margin-right:3px;"></i>${escapeHtml(address)}</div>` : ''}
        <div class="property-list-otas">${otaBadges}</div>
      </div>
      <div class="property-list-actions" onclick="event.stopPropagation()">
        <button class="btn-list-action btn-edit" data-id="${escapeHtml(id)}" title="Gérer">
          <i class="fas fa-cog"></i>
        </button>
      </div>
    </div>
  `;
}

// Gérer le clic sur les boutons de réorganisation
document.addEventListener('click', async function(e) {
  if (e.target.closest('.btn-reorder')) {
    const btn = e.target.closest('.btn-reorder');
    const propertyId = btn.dataset.id;
    const direction = btn.dataset.direction;
    
    try {
      showLoading();
      
      const response = await fetch(`${API_URL}/api/properties/${propertyId}/reorder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction })
      });
      
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const msg = (data && (data.error || data.message)) || 'Erreur serveur';
        // Cas attendu : déjà en première / dernière position → info, pas une erreur bloquante
        if (response.status === 400 && /premi|derni|first|last/i.test(msg)) {
          showToast(msg, 'success'); // toast léger
          return;
        }
        throw new Error(msg);
      }
// Recharger les logements
      await loadProperties();
      
      showToast('Ordre mis à jour !', 'success');
      
    } catch (error) {
      console.error('Erreur réorganisation:', error);
      showToast(error.message || 'Erreur lors de la réorganisation', 'error');
    } finally {
      hideLoading();
    }
  }
});
// Copier le lien de chat
document.addEventListener('click', (e) => {
  if (e.target.closest('.btn-copy-chat-link')) {
    const btn = e.target.closest('.btn-copy-chat-link');
    const link = btn.dataset.link;
    
    navigator.clipboard.writeText(link).then(() => {
      const originalHTML = btn.innerHTML;
      btn.innerHTML = '<i class="fas fa-check"></i> Copié !';
      setTimeout(() => {
        btn.innerHTML = originalHTML;
      }, 2000);
    }).catch(err => {
      console.error('Erreur copie:', err);
      showToast('Erreur lors de la copie', 'error');
    });
  }
});

// Modifier le PIN
document.addEventListener('click', async (e) => {
  if (e.target.closest('.btn-update-pin')) {
    const btn = e.target.closest('.btn-update-pin');
    const propertyId = btn.dataset.propertyId;
    const pinInput = document.querySelector(`.chat-pin-input[data-property-id="${propertyId}"]`);
    const newPin = pinInput.value.trim();
    
    // Validation
    if (!/^\d{4}$/.test(newPin)) {
      showToast('Le code PIN doit être composé de 4 chiffres', 'error');
      return;
    }
    
    try {
      showLoading();
      const token = localStorage.getItem('lcc_token');
      const response = await fetch(`${API_URL}/api/properties/${propertyId}`, {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ chatPin: newPin })
      });
      
      if (!response.ok) {
        throw new Error('Erreur lors de la mise à jour');
      }
      
      showToast('Code PIN mis à jour avec succès', 'success');
      await loadProperties(); // Recharger la liste
      
    } catch (error) {
      console.error('Erreur:', error);
      showToast('Erreur lors de la mise à jour du PIN', 'error');
    } finally {
      hideLoading();
    }
  }
});

// Régénérer le PIN automatiquement
document.addEventListener('click', async (e) => {
  if (e.target.closest('.btn-regenerate-pin')) {
    const btn = e.target.closest('.btn-regenerate-pin');
    const propertyId = btn.dataset.propertyId;
    const newPin = Math.floor(1000 + Math.random() * 9000).toString();
    
    const pinInput = document.querySelector(`.chat-pin-input[data-property-id="${propertyId}"]`);
    pinInput.value = newPin;
    
    // Déclencher la sauvegarde automatique
    const updateBtn = document.querySelector(`.btn-update-pin[data-property-id="${propertyId}"]`);
    updateBtn.click();
  }
});

// Copier le message automatique pour les plateformes
document.addEventListener('click', (e) => {
  if (e.target.closest('.btn-copy-auto-message')) {
    const btn = e.target.closest('.btn-copy-auto-message');
    const link = btn.dataset.link;
    const pin = btn.dataset.pin;
    const propertyName = btn.dataset.propertyName;
    
    const message = `🎉 Bienvenue dans votre logement "${propertyName}" !

Pour toute question ou information durant votre séjour, vous pouvez me contacter directement via notre chat sécurisé :

🔗 Lien : ${link}
🔐 Code PIN : ${pin}

Il vous suffit de cliquer sur le lien, d'entrer le code PIN ainsi que vos dates de réservation et la plateforme utilisée pour accéder au chat.

À très bientôt ! 😊`;
    
    navigator.clipboard.writeText(message).then(() => {
      const originalHTML = btn.innerHTML;
      btn.innerHTML = '<i class="fas fa-check"></i> Message copié !';
      setTimeout(() => {
        btn.innerHTML = originalHTML;
      }, 2000);
      showToast('Message copié ! Vous pouvez le coller sur Airbnb, Booking, etc.', 'success');
    }).catch(err => {
      console.error('Erreur copie:', err);
      showToast('Erreur lors de la copie', 'error');
    });
  }
});

// ============================================================
// 🔗 CHANNEX — Modale de connexion OTA
// ============================================================

// ── Logos des plateformes (réutilisé dans la modal) ──────────
// ─────────────────────────────────────────────────────────────
// Config des plateformes OTA : instructions + code Channex
// ─────────────────────────────────────────────────────────────
const OTA_PLATFORMS = [
  {
    code: 'ABB',
    label: 'Airbnb',
    icon: '<i class="fa-brands fa-airbnb" style="color:#FF5A5F;font-size:18px;"></i>',
    color: '#FF5A5F',
    bg: '#fff8f8',
    border: '#fde8e8',
    instructions: `
      <div style="font-size:13px;color:#374151;line-height:1.6;">
        <p style="margin:0 0 10px;"><strong>Avant de continuer :</strong></p>
        <ol style="margin:0;padding-left:18px;">
          <li>Assurez-vous d'être <strong>connecté à votre compte Airbnb</strong> dans votre navigateur.</li>
          <li>Cliquez sur <strong>Continuer</strong> — vous serez redirigé vers Airbnb pour autoriser la connexion.</li>
          <li>Une fois revenu, sélectionnez votre annonce et associez-la.</li>
        </ol>
      </div>`
  },
  {
    code: 'BDC',
    label: 'Booking.com',
    icon: '<i class="fas fa-building" style="color:#003580;font-size:16px;"></i>',
    color: '#003580',
    bg: '#f0f4fc',
    border: '#d9e4f7',
    instructions: `
      <div style="font-size:13px;color:#374151;line-height:1.6;">
        <p style="margin:0 0 10px;"><strong>Étape préalable dans votre extranet Booking.com :</strong></p>
        <ol style="margin:0;padding-left:18px;">
          <li>Connectez-vous à <strong>l'extranet Booking.com</strong>.</li>
          <li>Allez dans <strong>Compte → Fournisseur de connectivité</strong>.</li>
          <li>Recherchez <strong>"Channex"</strong> et cliquez sur <strong>Accepter</strong>.</li>
          <li>Notez votre <strong>Property ID</strong> (numéro affiché en haut à côté du nom de votre établissement).</li>
        </ol>
        <p style="margin:10px 0 0;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px 10px;font-size:12px;color:#92400e;">
          <i class="fas fa-exclamation-triangle"></i> Faites d'abord ces étapes <strong>avant</strong> de cliquer sur Continuer.
        </p>
      </div>`
  },
  {
    code: 'EXP',
    label: 'Expedia',
    icon: '<i class="fas fa-plane" style="color:#1B5E96;font-size:15px;"></i>',
    color: '#1B5E96',
    bg: '#f0f6fc',
    border: '#d0e4f5',
    instructions: `
      <div style="font-size:13px;color:#374151;line-height:1.6;">
        <p style="margin:0 0 10px;"><strong>Avant de continuer :</strong></p>
        <ol style="margin:0;padding-left:18px;">
          <li>Connectez-vous à <strong>Expedia Partner Central</strong>.</li>
          <li>Allez dans les paramètres de votre propriété et notez votre <strong>Property ID</strong>.</li>
          <li>Cliquez sur Continuer et renseignez cet identifiant dans le formulaire de connexion.</li>
        </ol>
      </div>`
  },
  {
    code: 'VRB',
    label: 'Abritel / VRBO',
    icon: '<i class="fas fa-home" style="color:#1C61A5;font-size:15px;"></i>',
    color: '#1C61A5',
    bg: '#f0f5fb',
    border: '#cfe1f4',
    instructions: `
      <div style="font-size:13px;color:#374151;line-height:1.6;">
        <p style="margin:0 0 10px;"><strong>Avant de continuer :</strong></p>
        <ol style="margin:0;padding-left:18px;">
          <li>Connectez-vous à votre compte <strong>Abritel / VRBO</strong>.</li>
          <li>Votre Property ID est visible dans l'URL de votre annonce.</li>
          <li>Cliquez sur Continuer et renseignez cet identifiant.</li>
        </ol>
      </div>`
  }
];

// ─────────────────────────────────────────────────────────────
// Modal principale : écran 1 = choix + instructions
//                   écran 2 = iframe
// ─────────────────────────────────────────────────────────────

// ── Logos OTA connectés ───────────────────────────────────────
const OTA_LOGOS = {
  airbnb:  { icon: '<i class="fa-brands fa-airbnb" style="color:#FF5A5F;font-size:14px;"></i>', label: 'Airbnb' },
  booking: { icon: '<i class="fas fa-building" style="color:#003580;font-size:13px;"></i>', label: 'Booking.com' },
  expedia: { icon: '<i class="fas fa-plane" style="color:#1B5E96;font-size:13px;"></i>', label: 'Expedia' },
  vrbo:    { icon: '<i class="fas fa-home" style="color:#1C61A5;font-size:13px;"></i>', label: 'Abritel/VRBO' },
};

// ✅ Mapping codes Channex → clés OTA_LOGOS
const CHANNEX_CODE_MAP = {
  'abb': 'airbnb',
  'airbnb': 'airbnb',
  'bdc': 'booking',
  'booking': 'booking',
  'exp': 'expedia',
  'expedia': 'expedia',
  'vrb': 'vrbo',
  'vrbo': 'vrbo',
  'homeaway': 'vrbo',
  'abritel': 'vrbo',
};

async function syncChannexBookings(propertyId, btn) {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size:10px;"></i><span>Importation en cours...</span>';
  btn.style.color = '#1A7A5E';
  btn.style.borderColor = '#1A7A5E';
  try {
    const token = localStorage.getItem('lcc_token');
    const r = await fetch(`${API_URL}/api/channex/sync-bookings/${propertyId}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Erreur serveur');
    const { imported = 0, updated = 0, errors = 0, total = 0 } = d;
    showToast(`✅ ${imported} réservation(s) importée(s), ${updated} mise(s) à jour sur ${total} trouvée(s)`, 'success');
    btn.innerHTML = `<i class="fas fa-check" style="font-size:10px;color:#1A7A5E;"></i><span style="color:#1A7A5E;">Import terminé (${imported} nouvelles)</span>`;
    // Refresh calendrier si dispo
    if (typeof loadReservations === 'function') loadReservations();
  } catch(e) {
    showToast('Erreur import : ' + e.message, 'error');
    btn.innerHTML = original;
    btn.disabled = false;
    btn.style.color = '';
    btn.style.borderColor = '';
  }
}

async function loadConnectedChannels(propertyId, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  try {
    const token = localStorage.getItem('lcc_token');
    const r = await fetch(`${API_URL}/api/channex/connected-channels/${propertyId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const d = await r.json();
    const channels = d.channels || [];
    if (channels.length === 0) {
      el.innerHTML = '<span style="font-size:10px;color:#94a3b8;">Aucune plateforme connectée</span>';
      return;
    }
    el.innerHTML = channels.map(c => {
      const key = CHANNEX_CODE_MAP[c.channel.toLowerCase()] || Object.keys(OTA_LOGOS).find(k => c.channel.toLowerCase().includes(k)) || null;
      const logo = key ? OTA_LOGOS[key] : null;
      const colors = {
        airbnb:  { bg: '#fff1f0', border: '#ffd6d4', color: '#e8484e' },
        booking: { bg: '#f0f4ff', border: '#c7d7f9', color: '#003580' },
        expedia: { bg: '#f0f6ff', border: '#c5daf7', color: '#1B5E96' },
        vrbo:    { bg: '#f0f5ff', border: '#c9dcf7', color: '#1C61A5' },
      };
      const c_style = (key && colors[key]) ? colors[key] : { bg: '#f8fafc', border: '#e2e8f0', color: '#64748b' };
      return `<span title="${c.title}" style="
        display:inline-flex;align-items:center;gap:5px;
        padding:4px 10px 4px 8px;
        background:${c_style.bg};
        border:1px solid ${c_style.border};
        border-radius:20px;
        font-size:11px;font-weight:600;
        color:${c_style.color};
        letter-spacing:0.01em;
        box-shadow:0 1px 3px rgba(0,0,0,0.06);
      ">
        ${logo ? logo.icon : '<i class="fas fa-globe" style="font-size:11px;color:#94a3b8;"></i>'}
        <span>${logo ? logo.label : c.title}</span>
      </span>`;
    }).join('');
  } catch(e) {
    el.innerHTML = '';
  }
}

async function openChannexModal(propertyId, propertyName, isConnected, channelCode = null) {
  const existing = document.getElementById('channexModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'channexModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;';
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);

  // Si pas encore connecté à Channex → proposer le choix du mode
  if (!isConnected) {
    // Charger d'abord les properties existantes de l'user pour savoir si le choix est pertinent
    let existingProperties = [];
    try {
      const token = localStorage.getItem('lcc_token');
      const r = await fetch(`${API_URL}/api/channex/list-user-properties`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const d = await r.json();
      existingProperties = d.properties || [];
    } catch (_) {}

    if (existingProperties.length === 0) {
      // Pas d'établissement existant → connexion directe sans choix
      await _connectAndProceed(modal, propertyId, null);
    } else {
      // Il y a des properties existantes → afficher le choix
      _showPropertyTypeScreen(modal, propertyId, propertyName, existingProperties);
      return;
    }
    if (!modal.isConnected) return; // erreur déjà affichée dans _connectAndProceed
  }

  // Écran 1 : sélection de la plateforme (ou aller direct à l'iframe si channelCode fourni)
  if (channelCode) {
    window._otaSelected = channelCode;
    await _loadChannexIframe(propertyId, modal, channelCode);
  } else {
    _showPlatformPicker(modal, propertyId, propertyName, isConnected);
  }
}

// ── Connexion effective à Channex (avec ou sans rattachement) ──
async function _connectAndProceed(modal, propertyId, existingChannexPropertyId) {
  modal.innerHTML = `<div style="background:#fff;border-radius:20px;padding:40px;text-align:center;">
    <i class="fas fa-spinner fa-spin" style="font-size:28px;color:#1A7A5E;"></i>
    <div style="margin-top:12px;color:#6B7280;font-size:13px;">Activation en cours...</div>
  </div>`;
  try {
    const token = localStorage.getItem('lcc_token');
    const body = { property_id: propertyId };
    if (existingChannexPropertyId) body.channex_property_id = existingChannexPropertyId;
    const r = await fetch(`${API_URL}/api/channex/connect-property`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(body)
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Erreur activation');
    loadProperties().catch(() => {});
  } catch (e) {
    modal.innerHTML = `<div style="background:#fff;border-radius:20px;padding:40px;text-align:center;max-width:400px;">
      <i class="fas fa-exclamation-circle" style="font-size:28px;color:#dc2626;margin-bottom:8px;display:block;"></i>
      <div style="font-size:13px;color:#374151;">${e.message}</div>
      <button onclick="document.getElementById('channexModal').remove()" style="margin-top:16px;padding:8px 20px;border-radius:8px;border:1px solid #e5e7eb;background:#f9fafb;color:#374151;font-size:13px;cursor:pointer;">Fermer</button>
    </div>`;
  }
}

// ── Écran de choix : nouveau logement indépendant ou rattachement ──
function _showPropertyTypeScreen(modal, propertyId, propertyName, existingProperties) {
  const safePropertyName = propertyName.replace(/'/g, "\\'");
  let selectedExistingId = null;

  const render = () => {
    modal.innerHTML = `
      <div style="background:#fff;border-radius:20px;padding:24px;max-width:480px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,.2);">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;">
          <div>
            <div style="font-family:'Instrument Serif',Georgia,serif;font-size:19px;color:#0D1117;">Connexion OTA</div>
            <div style="font-size:12px;color:#6B7280;margin-top:3px;">${propertyName}</div>
          </div>
          <button onclick="document.getElementById('channexModal').remove()" style="background:#f3f4f6;border:none;border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:16px;color:#6B7280;flex-shrink:0;margin-left:12px;">✕</button>
        </div>

        <div style="font-size:13px;color:#374151;margin-bottom:14px;font-weight:500;">
          Sélectionnez le type de connexion pour ce logement :
        </div>
        <div style="background:#FFF8E7;border:1px solid #F59E0B;border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#92400E;">
          <i class="fas fa-lightbulb" style="margin-right:6px;"></i>
          <strong>Dans le doute</strong>, choisissez <strong>Logement indépendant</strong>. Utilisez "Partie d'un immeuble" uniquement si plusieurs appartements partagent le même Hotel ID Booking.com.
        </div>

        <!-- Option 1 : indépendant -->
        <button onclick="_selectPropertyType('new')" style="
          width:100%;display:flex;align-items:flex-start;gap:12px;padding:14px;margin-bottom:8px;
          background:${!selectedExistingId ? '#f0fdf8' : '#f9fafb'};
          border:2px solid ${!selectedExistingId ? '#1A7A5E' : '#e5e7eb'};
          border-radius:12px;cursor:pointer;text-align:left;">
          <i class="fas fa-home" style="color:#1A7A5E;font-size:18px;margin-top:2px;flex-shrink:0;"></i>
          <div>
            <div style="font-size:13px;font-weight:600;color:#111827;">Logement indépendant</div>
            <div style="font-size:12px;color:#6B7280;margin-top:2px;">Créer un nouvel établissement Channex dédié à ce logement</div>
          </div>
          ${!selectedExistingId ? `<i class="fas fa-check-circle" style="margin-left:auto;color:#1A7A5E;font-size:15px;align-self:center;"></i>` : ''}
        </button>

        <!-- Option 2 : rattacher avec champ texte -->
        <button onclick="_selectPropertyType('existing')" style="
          width:100%;display:flex;align-items:flex-start;gap:12px;padding:14px;
          background:${selectedExistingId !== null ? '#f0fdf8' : '#f9fafb'};
          border:2px solid ${selectedExistingId !== null ? '#1A7A5E' : '#e5e7eb'};
          border-radius:12px;cursor:pointer;text-align:left;">
          <i class="fas fa-building" style="color:#1A7A5E;font-size:18px;margin-top:2px;flex-shrink:0;"></i>
          <div style="flex:1;">
            <div style="font-size:13px;font-weight:600;color:#111827;">Partie d'un immeuble / établissement</div>
            <div style="font-size:12px;color:#6B7280;margin-top:2px;">Rattacher à un établissement Channex existant (même Hotel ID Booking)</div>
            ${selectedExistingId !== null ? `
              <div style="margin-top:10px;" onclick="event.stopPropagation()">
                <input id="existingPropertyIdInput" type="text" placeholder="Coller l'ID Channex de l'établissement"
                  value="${selectedExistingId || ''}"
                  oninput="window._existingIdSelected = this.value"
                  style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:12px;color:#111827;background:#fff;box-sizing:border-box;font-family:monospace;"/>
                <div style="font-size:11px;color:#9ca3af;margin-top:4px;">
                  Format : xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx<br>
                  Trouvez cet ID dans Settings → logement déjà connecté → badge "Synchronisation OTA active"
                </div>
              </div>
            ` : ''}
          </div>
          ${selectedExistingId !== null ? `<i class="fas fa-check-circle" style="margin-left:auto;color:#1A7A5E;font-size:15px;align-self:center;flex-shrink:0;"></i>` : ''}
        </button>

        <div style="margin-top:16px;">
          <button id="btnPropertyTypeContinue"
            onclick="_continuePropertyType('${propertyId}','${safePropertyName}')"
            style="width:100%;height:44px;border-radius:10px;border:none;
              background:linear-gradient(135deg,#1A7A5E,#2AAE86);
              color:#fff;font-size:14px;font-weight:600;cursor:pointer;">
            Continuer <i class="fas fa-arrow-right"></i>
          </button>
        </div>
      </div>
    `;
  };

  window._existingIdSelected = null;
  window._propertyTypeMode = 'new';

  window._selectPropertyType = (mode) => {
    window._propertyTypeMode = mode;
    if (mode === 'new') {
      selectedExistingId = null;
      window._existingIdSelected = null;
    } else {
      selectedExistingId = ''; // shows the input
    }
    render();
    if (mode === 'existing') {
      setTimeout(() => document.getElementById('existingPropertyIdInput')?.focus(), 50);
    }
  };

  window._continuePropertyType = async (pid, pname) => {
    const mode = window._propertyTypeMode;
    let channexPropertyId = null;

    if (mode === 'existing') {
      const input = document.getElementById('existingPropertyIdInput');
      channexPropertyId = input ? input.value.trim() : (window._existingIdSelected || null);
      if (!channexPropertyId) {
        showToast("Veuillez coller l'ID Channex de l'établissement", 'warning');
        return;
      }
      // Validation format UUID
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(channexPropertyId)) {
        showToast("Format d'ID invalide — doit être un UUID (ex: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)", 'error');
        return;
      }
    }

    await _connectAndProceed(modal, pid, channexPropertyId || null);
    if (!modal.isConnected) return;

    // Continuer vers la sélection de plateforme
    window._otaPropertyId = pid;
    window._otaPropertyName = pname;
    window._otaIsConnected = true;
    window._otaModal = modal;
    _showPlatformPicker(modal, pid, pname, true);
  };

  render();
}

function _showPlatformPicker(modal, propertyId, propertyName, isConnected) {
  const safePropertyName = propertyName.replace(/'/g, "\\'");
  let selected = null;

  const render = () => {
    const platform = selected ? OTA_PLATFORMS.find(p => p.code === selected) : null;
    modal.innerHTML = `
      <div style="background:#fff;border-radius:20px;padding:24px;max-width:520px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,.2);">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;">
          <div>
            <div style="font-family:'Instrument Serif',Georgia,serif;font-size:19px;color:#0D1117;">Connecter mes plateformes</div>
            <div style="font-size:12px;color:#6B7280;margin-top:3px;">${propertyName}</div>
          </div>
          <button onclick="document.getElementById('channexModal').remove()" style="background:#f3f4f6;border:none;border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:16px;color:#6B7280;flex-shrink:0;margin-left:12px;">✕</button>
        </div>

        <!-- Sélecteur plateformes -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">
          ${OTA_PLATFORMS.map(p => `
            <button onclick="_selectOta('${p.code}')" style="
              display:flex;align-items:center;gap:8px;padding:10px 12px;
              background:${selected === p.code ? p.bg : '#f9fafb'};
              border:2px solid ${selected === p.code ? p.color : '#e5e7eb'};
              border-radius:10px;cursor:pointer;text-align:left;
              transition:all .15s;
            ">
              ${p.icon}
              <span style="font-size:13px;font-weight:600;color:#111827;">${p.label}</span>
              ${selected === p.code ? `<i class="fas fa-check-circle" style="margin-left:auto;color:${p.color};font-size:13px;"></i>` : ''}
            </button>
          `).join('')}
        </div>

        <!-- Instructions contextuelles -->
        <div style="min-height:120px;margin-bottom:16px;">
          ${platform ? `
            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px;">
              ${platform.instructions}
            </div>
          ` : `
            <div style="display:flex;align-items:center;justify-content:center;height:120px;color:#9ca3af;font-size:13px;">
              <span>← Sélectionnez une plateforme pour voir les instructions</span>
            </div>
          `}
        </div>

        <!-- Actions -->
        <div style="display:flex;gap:10px;">
          ${isConnected ? `
          <button onclick="_showOtaActions('${propertyId}',this.closest('[style*=border-radius]').parentNode.querySelector('#channexModal'))" style="flex:1;height:42px;border-radius:10px;border:1px solid #e5e7eb;background:#f9fafb;color:#374151;font-size:13px;font-weight:500;cursor:pointer;">
            <i class="fas fa-cog"></i> Gérer
          </button>` : ''}
          <button id="btnOtaContinue" onclick="_continueToIframe('${propertyId}','${safePropertyName}')"
            ${selected ? '' : 'disabled'}
            style="flex:2;height:42px;border-radius:10px;border:none;
              background:${selected ? 'linear-gradient(135deg,#1A7A5E,#2AAE86)' : '#e5e7eb'};
              color:${selected ? 'white' : '#9ca3af'};font-size:14px;font-weight:600;cursor:${selected ? 'pointer' : 'not-allowed'};">
            Continuer <i class="fas fa-arrow-right"></i>
          </button>
        </div>

        ${isConnected ? `
        <div style="margin-top:10px;text-align:center;">
          <button onclick="channexDisconnect('${propertyId}')" style="background:none;border:none;color:#dc2626;font-size:12px;cursor:pointer;text-decoration:underline;">
            Déconnecter ce logement
          </button>
        </div>` : ''}
      </div>
    `;

    // Réassigner la variable globale pour la sélection
    window._otaSelected = selected;
    window._otaPropertyId = propertyId;
    window._otaPropertyName = propertyName;
    window._otaIsConnected = isConnected;
    window._otaModal = modal;
  };

  window._selectOta = (code) => {
    selected = code;
    window._otaSelected = code;
    render();
  };

  window._continueToIframe = async (pid, pname) => {
    const channelCode = window._otaSelected;
    if (!channelCode) return;
    await _loadChannexIframe(pid, window._otaModal, channelCode);
  };

  render();
}

async function _loadChannexIframe(propertyId, modal, channelCode) {
  modal.innerHTML = `
    <div style="background:#fff;border-radius:20px;padding:24px;max-width:820px;width:100%;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,.2);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-shrink:0;">
        <button onclick="_showPlatformPicker(window._otaModal,'${propertyId}',window._otaPropertyName,window._otaIsConnected)" style="background:#f3f4f6;border:none;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:13px;color:#374151;">
          <i class="fas fa-arrow-left"></i> Retour
        </button>
        <div style="font-size:13px;font-weight:600;color:#374151;">${OTA_PLATFORMS.find(p=>p.code===channelCode)?.label || ''}</div>
        <button onclick="document.getElementById('channexModal').remove()" style="background:#f3f4f6;border:none;border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:16px;color:#6B7280;">✕</button>
      </div>
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:0;">
        <i class="fas fa-spinner fa-spin" style="font-size:24px;color:#1A7A5E;"></i>
        <div style="margin-top:10px;color:#6B7280;font-size:13px;">Chargement...</div>
      </div>
    </div>
  `;

  try {
    const token = localStorage.getItem('lcc_token');
    const res = await fetch(`${API_URL}/api/channex/iframe-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ property_id: propertyId, channel_code: channelCode })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur serveur');

    modal.innerHTML = `
      <div style="background:#fff;border-radius:20px;padding:24px;max-width:820px;width:100%;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,.2);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-shrink:0;">
          <button onclick="_showPlatformPicker(window._otaModal,'${propertyId}',window._otaPropertyName,window._otaIsConnected)" style="background:#f3f4f6;border:none;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:13px;color:#374151;">
            <i class="fas fa-arrow-left"></i> Retour
          </button>
          <div style="font-size:13px;font-weight:600;color:#374151;">${OTA_PLATFORMS.find(p=>p.code===channelCode)?.label || ''}</div>
          <button onclick="_closeChannexIframe(\'${propertyId}\')" style="background:#f3f4f6;border:none;border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:16px;color:#6B7280;">✕</button>
        </div>
        <div style="flex:1;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;min-height:0;">
          <iframe src="${data.iframe_url}" style="width:100%;height:100%;min-height:580px;border:none;display:block;" allow="same-origin"></iframe>
        </div>
      </div>
    `;
  } catch (e) {
    modal.innerHTML = `
      <div style="background:#fff;border-radius:20px;padding:40px;text-align:center;max-width:400px;">
        <i class="fas fa-exclamation-circle" style="font-size:28px;color:#dc2626;margin-bottom:8px;display:block;"></i>
        <div style="font-size:13px;color:#374151;margin-bottom:16px;">${e.message}</div>
        <button onclick="_showPlatformPicker(window._otaModal,'${propertyId}',window._otaPropertyName,window._otaIsConnected)" style="padding:8px 20px;border-radius:8px;border:1px solid #e5e7eb;background:#f9fafb;color:#374151;font-size:13px;cursor:pointer;margin-right:8px;">Retour</button>
        <button onclick="document.getElementById('channexModal').remove()" style="padding:8px 20px;border-radius:8px;border:none;background:#1A7A5E;color:#fff;font-size:13px;cursor:pointer;">Fermer</button>
      </div>
    `;
  }
}

async function _closeChannexIframe(propertyId) {
  const modal = document.getElementById('channexModal');
  if (modal) {
    modal.innerHTML = `
      <div style="background:#fff;border-radius:20px;padding:40px;text-align:center;max-width:420px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,.2);">
        <div style="width:56px;height:56px;background:#f0fdf8;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
          <i class="fas fa-spinner fa-spin" style="font-size:22px;color:#1A7A5E;"></i>
        </div>
        <div style="font-size:15px;font-weight:700;color:#0D1117;margin-bottom:6px;">Finalisation en cours…</div>
        <div id="autoSyncStatus" style="font-size:13px;color:#6B7280;line-height:1.6;">Synchronisation des disponibilités et import des réservations…</div>
      </div>
    `;
  }

  const token = localStorage.getItem('lcc_token');
  const pid = propertyId || window._otaPropertyId;

  const updateStatus = (msg) => {
    const el = document.getElementById('autoSyncStatus');
    if (el) el.innerHTML = msg;
  };

  try {
    // 1. Recharger les propriétés
    await loadProperties().catch(() => {});

    // 2. Push disponibilités (12 mois)
    updateStatus('📅 Envoi des disponibilités aux plateformes…');
    await fetch(`${API_URL}/api/channex/push-availability/${pid}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    }).catch(() => {});

    // 3. Import historique réservations
    updateStatus('📦 Import des réservations existantes…');
    const syncRes = await fetch(`${API_URL}/api/channex/sync-bookings/${pid}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    }).catch(() => null);
    const syncData = syncRes ? await syncRes.json().catch(() => {}) : {};

    // 4. Succès
    if (modal) {
      const imported = syncData?.imported || 0;
      const updated = syncData?.updated || 0;
      modal.innerHTML = `
        <div style="background:#fff;border-radius:20px;padding:40px;text-align:center;max-width:420px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,.2);">
          <div style="width:56px;height:56px;background:#f0fdf8;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
            <i class="fas fa-check" style="font-size:22px;color:#1A7A5E;"></i>
          </div>
          <div style="font-size:16px;font-weight:700;color:#0D1117;margin-bottom:8px;">Plateforme connectée ! 🎉</div>
          <div style="font-size:13px;color:#6B7280;line-height:1.7;margin-bottom:20px;">
            ✅ Disponibilités synchronisées<br>
            ✅ ${imported} réservation(s) importée(s)<br>
            ✅ Calendrier mis à jour
          </div>
          <button onclick="document.getElementById('channexModal').remove();loadProperties();" 
            style="width:100%;height:44px;border-radius:10px;border:none;background:linear-gradient(135deg,#1A7A5E,#2AAE86);color:#fff;font-size:14px;font-weight:600;cursor:pointer;">
            Voir mon calendrier <i class="fas fa-arrow-right"></i>
          </button>
        </div>
      `;
    }
  } catch(e) {
    document.getElementById('channexModal')?.remove();
    showToast('Plateforme connectée. Synchronisation en cours...', 'success');
    await loadProperties().catch(() => {});
  }
}

async function channexDisconnect(propertyId) {
  const confirmed = await bhConfirm(
    'Déconnecter ce logement ?',
    'Les nouvelles réservations OTA ne seront plus reçues automatiquement.',
    'Déconnecter',
    'Annuler',
    'danger'
  );
  if (!confirmed) return;

  try {
    const token = localStorage.getItem('lcc_token');
    const res = await fetch(`${API_URL}/api/channex/disconnect-property`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ property_id: propertyId })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur serveur');

    document.getElementById('channexModal')?.remove();
    showToast('Logement déconnecté de la synchronisation OTA.', 'info');
    await loadProperties();

  } catch (e) {
    showToast('Erreur : ' + e.message, 'error');
  }
}

async function channexSyncAvailability(propertyId) {
  const btn = document.getElementById('btnChannexSync');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Synchronisation...';
  }

  try {
    const token = localStorage.getItem('lcc_token');
    const res = await fetch(`${API_URL}/api/channex/sync-availability/${propertyId}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur serveur');

    showToast(`Disponibilités synchronisées (${data.blocked} dates bloquées)`, 'success');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-sync"></i> Synchroniser les dispos';
    }

  } catch (e) {
    showToast('Erreur : ' + e.message, 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-sync"></i> Synchroniser les dispos';
    }
  }
}

// ============================================
// PRICING RULES — Règles de tarification
// ============================================

const API_PRICING = 'https://lcc-booking-manager.onrender.com';
let _currentPricingPropertyId = null;
let _pricingRules = [];

const RULE_TYPE_LABELS = {
  period:     { icon: 'fa-calendar-alt', label: 'Période' },
  weekday:    { icon: 'fa-clock', label: 'Jours de semaine' },
  min_stay:   { icon: 'fa-moon', label: 'Séjour minimum' },
  long_stay:  { icon: 'fa-percentage', label: 'Réduction séjour long' }
};

const DAYS_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

// Charger les règles pour un logement
async function loadPricingRules(propertyId) {
  _currentPricingPropertyId = propertyId;
  try {
    const token = localStorage.getItem('lcc_token');
    const resp = await fetch(`${API_PRICING}/api/pricing/rules?property_id=${propertyId}`, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!resp.ok) return;
    const data = await resp.json();
    _pricingRules = data.rules || [];
    renderPricingRules();
  } catch(e) {
    console.warn('loadPricingRules:', e.message);
  }
}

// Afficher les règles dans le modal
function renderPricingRules() {
  const container = document.getElementById('pricingRulesList');
  if (!container) return;

  if (!_pricingRules.length) {
    container.innerHTML = '<div style="font-size:13px;color:#9CA3AF;padding:10px 0;">Aucune règle configurée</div>';
    return;
  }

  container.innerHTML = _pricingRules.map(rule => {
    const typeInfo = RULE_TYPE_LABELS[rule.rule_type] || { icon: 'fa-tag', label: rule.rule_type };
    let detail = '';

    if (rule.rule_type === 'period') {
      const fmtDate = d => { if (!d) return ''; const dt = new Date(d); return `${String(dt.getUTCDate()).padStart(2,'0')}/${String(dt.getUTCMonth()+1).padStart(2,'0')}/${String(dt.getUTCFullYear()).slice(-2)}`; };
      detail = `${fmtDate(rule.start_date)} → ${fmtDate(rule.end_date)} · <strong>${rule.price}€/nuit</strong>`;
    } else if (rule.rule_type === 'weekday') {
      const days = (rule.days_of_week || []).map(d => DAYS_LABELS[d]).join(', ');
      detail = `${days} · <strong>${rule.price}€/nuit</strong>`;
    } else if (rule.rule_type === 'min_stay') {
      detail = `Minimum <strong>${rule.min_nights} nuits</strong>`;
    } else if (rule.rule_type === 'long_stay') {
      detail = `<strong>-${rule.discount_pct}%</strong> à partir de ${rule.discount_after_nights} nuits`;
    }

    return `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #E8E0D0;border-radius:10px;margin-bottom:6px;background:${rule.active ? '#fff' : '#F9F9F9'};">
        <div style="width:32px;height:32px;border-radius:8px;background:rgba(26,122,94,.1);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <i class="fas ${typeInfo.icon}" style="color:#1A7A5E;font-size:13px;"></i>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;color:#0D1117;">${rule.name}</div>
          <div style="font-size:12px;color:#6B7280;margin-top:2px;">${detail}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button type="button" onclick="editPricingRule(${rule.id})"
            style="padding:5px 10px;border:1px solid #E5E7EB;border-radius:6px;background:#fff;color:#374151;font-size:12px;cursor:pointer;">
            <i class="fas fa-edit"></i>
          </button>
          <button type="button" onclick="deletePricingRule(${rule.id})"
            style="padding:5px 10px;border:1px solid #fee2e2;border-radius:6px;background:#fff;color:#dc2626;font-size:12px;cursor:pointer;">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Ouvrir le modal de création de règle
function openPricingRuleModal(existingRule = null) {
  // Supprimer un éventuel modal existant
  const existing = document.getElementById('pricingRuleModal');
  if (existing) existing.remove();

  const isEdit = !!existingRule;
  const rule = existingRule || {};

  const modal = document.createElement('div');
  modal.id = 'pricingRuleModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px;';

  modal.innerHTML = `
    <div style="background:#fff;border-radius:20px;width:480px;max-width:calc(100vw - 32px);max-height:90vh;overflow-y:auto;font-family:'DM Sans',sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.2);box-sizing:border-box;">
      <div style="padding:20px 24px;border-bottom:1px solid #F0EBE3;display:flex;align-items:center;justify-content:space-between;">
        <div style="font-size:16px;font-weight:700;color:#0D1117;">${isEdit ? 'Modifier la règle' : 'Nouvelle règle de prix'}</div>
        <button onclick="document.getElementById('pricingRuleModal').remove()"
          style="width:32px;height:32px;border-radius:50%;border:none;background:#f3f4f6;color:#6B7280;cursor:pointer;font-size:16px;">✕</button>
      </div>
      <div style="padding:16px 16px;">

        <!-- Nom -->
        <div style="margin-bottom:14px;">
          <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:6px;text-transform:uppercase;letter-spacing:.4px;">Nom de la règle</label>
          <input id="pr_name" type="text" placeholder="Ex: Juillet-Août, Week-ends été..."
            value="${rule.name || ''}"
            style="width:100%;padding:10px 12px;border:1.5px solid #E8E0D0;border-radius:10px;font-size:14px;box-sizing:border-box;outline:none;" />
        </div>

        <!-- Type -->
        <div style="margin-bottom:14px;">
          <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:6px;text-transform:uppercase;letter-spacing:.4px;">Type de règle</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            ${[
              { val: 'period', icon: 'fa-calendar-alt', label: 'Période' },
              { val: 'weekday', icon: 'fa-clock', label: 'Jours de semaine' },
              { val: 'min_stay', icon: 'fa-moon', label: 'Séjour min.' },
              { val: 'long_stay', icon: 'fa-percentage', label: 'Longue durée' }
            ].map(t => `
              <label style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:12px 8px;border:1.5px solid ${(rule.rule_type || 'period') === t.val ? '#1A7A5E' : '#E8E0D0'};border-radius:12px;cursor:pointer;background:${(rule.rule_type || 'period') === t.val ? 'rgba(26,122,94,.06)' : '#fff'};min-height:68px;position:relative;text-align:center;">
                <input type="radio" name="pr_type" value="${t.val}" ${(rule.rule_type || 'period') === t.val ? 'checked' : ''} onchange="updatePricingRuleForm()" style="position:absolute;opacity:0;width:0;height:0;" />
                <i class="fas ${t.icon}" style="color:${(rule.rule_type || 'period') === t.val ? '#1A7A5E' : '#9CA3AF'};font-size:20px;"></i>
                <span style="font-size:11px;font-weight:600;color:${(rule.rule_type || 'period') === t.val ? '#1A7A5E' : '#374151'};line-height:1.3;">${t.label}</span>
              </label>
            `).join('')}
          </div>
        </div>

        <!-- Champs dynamiques selon le type -->
        <div id="pr_fields"></div>

        <!-- Priorité -->
        <div style="margin-bottom:14px;">
          <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:6px;text-transform:uppercase;letter-spacing:.4px;">Priorité <span style="font-weight:400;text-transform:none;">(plus élevé = appliqué en premier)</span></label>
          <input id="pr_priority" type="number" min="0" max="100" value="${rule.priority || 0}"
            style="width:100%;padding:10px 12px;border:1.5px solid #E8E0D0;border-radius:10px;font-size:14px;box-sizing:border-box;" />
        </div>

        <!-- Actif -->
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;">
          <input id="pr_active" type="checkbox" ${rule.active !== false ? 'checked' : ''} style="width:16px;height:16px;accent-color:#1A7A5E;" />
          <label for="pr_active" style="font-size:13px;color:#374151;cursor:pointer;">Règle active</label>
        </div>

        <div style="display:flex;gap:8px;">
          <button type="button" onclick="document.getElementById('pricingRuleModal').remove()"
            style="flex:1;padding:12px;border:1.5px solid #E5E7EB;border-radius:12px;background:#fff;color:#374151;font-size:14px;cursor:pointer;">
            Annuler
          </button>
          <button type="button" onclick="savePricingRule(${isEdit ? rule.id : 'null'})"
            style="flex:2;padding:12px;background:linear-gradient(135deg,#1A7A5E,#2AAE86);color:white;border:none;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;">
            <i class="fas fa-save"></i> ${isEdit ? 'Modifier' : 'Créer la règle'}
          </button>
        </div>
      </div>
    </div>
  `;

  // Stocker les données existantes pour l'édition
  modal._existingRule = rule;
  document.body.appendChild(modal);

  // Fermer en cliquant l'overlay
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  // Afficher les champs du bon type
  updatePricingRuleForm();
}

function updatePricingRuleForm() {
  const type = document.querySelector('input[name="pr_type"]:checked')?.value || 'period';
  const modal = document.getElementById('pricingRuleModal');
  const rule = modal?._existingRule || {};
  const container = document.getElementById('pr_fields');
  if (!container) return;

  // Mettre à jour le style des boutons radio (chips)
  document.querySelectorAll('input[name="pr_type"]').forEach(r => {
    const label = r.closest('label');
    if (label) {
      const active = r.checked;
      label.style.borderColor = active ? '#1A7A5E' : '#E8E0D0';
      label.style.background = active ? 'rgba(26,122,94,.06)' : '#fff';
      const icon = label.querySelector('i');
      if (icon) icon.style.color = active ? '#1A7A5E' : '#9CA3AF';
      const span = label.querySelector('span');
      if (span) span.style.color = active ? '#1A7A5E' : '#374151';
    }
  });

  if (type === 'period') {
    container.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;width:100%;box-sizing:border-box;overflow:hidden;">
        <div style="min-width:0;">
          <label style="display:block;font-size:11px;font-weight:600;color:#374151;margin-bottom:5px;text-transform:uppercase;letter-spacing:.4px;">Date début</label>
          <input id="pr_start" type="date" value="${rule.start_date || ''}"
            style="width:100%;padding:9px 8px;border:1.5px solid #E8E0D0;border-radius:10px;font-size:13px;box-sizing:border-box;min-width:0;" />
        </div>
        <div style="min-width:0;">
          <label style="display:block;font-size:11px;font-weight:600;color:#374151;margin-bottom:5px;text-transform:uppercase;letter-spacing:.4px;">Date fin</label>
          <input id="pr_end" type="date" value="${rule.end_date || ''}"
            style="width:100%;padding:9px 8px;border:1.5px solid #E8E0D0;border-radius:10px;font-size:13px;box-sizing:border-box;min-width:0;" />
        </div>
      </div>
      <div style="margin-bottom:14px;">
        <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:6px;text-transform:uppercase;letter-spacing:.4px;">Prix par nuit (€)</label>
        <input id="pr_price" type="number" min="0" step="1" placeholder="Ex: 120" value="${rule.price || ''}"
          style="width:100%;padding:10px 12px;border:1.5px solid #E8E0D0;border-radius:10px;font-size:14px;box-sizing:border-box;" />
      </div>
    `;
  } else if (type === 'weekday') {
    const selectedDays = rule.days_of_week || [];
    const days = [
      { val: 1, label: 'Lun' }, { val: 2, label: 'Mar' }, { val: 3, label: 'Mer' },
      { val: 4, label: 'Jeu' }, { val: 5, label: 'Ven' }, { val: 6, label: 'Sam' }, { val: 0, label: 'Dim' }
    ];
    container.innerHTML = `
      <div style="margin-bottom:14px;">
        <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:8px;text-transform:uppercase;letter-spacing:.4px;">Jours concernés</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${days.map(d => `
            <label style="display:flex;align-items:center;gap:4px;padding:7px 12px;border:1.5px solid ${selectedDays.includes(d.val) ? '#1A7A5E' : '#E8E0D0'};border-radius:8px;cursor:pointer;background:${selectedDays.includes(d.val) ? 'rgba(26,122,94,.08)' : '#fff'};font-size:13px;font-weight:500;">
              <input type="checkbox" name="pr_day" value="${d.val}" ${selectedDays.includes(d.val) ? 'checked' : ''}
                onchange="this.closest('label').style.borderColor=this.checked?'#1A7A5E':'#E8E0D0';this.closest('label').style.background=this.checked?'rgba(26,122,94,.08)':'#fff'"
                style="accent-color:#1A7A5E;" />
              ${d.label}
            </label>
          `).join('')}
        </div>
      </div>
      <div style="margin-bottom:14px;">
        <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:6px;text-transform:uppercase;letter-spacing:.4px;">Prix par nuit (€)</label>
        <input id="pr_price" type="number" min="0" step="1" placeholder="Ex: 90" value="${rule.price || ''}"
          style="width:100%;padding:10px 12px;border:1.5px solid #E8E0D0;border-radius:10px;font-size:14px;box-sizing:border-box;" />
      </div>
    `;
  } else if (type === 'min_stay') {
    container.innerHTML = `
      <div style="margin-bottom:14px;">
        <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:6px;text-transform:uppercase;letter-spacing:.4px;">Nombre de nuits minimum</label>
        <input id="pr_min_nights" type="number" min="1" step="1" placeholder="Ex: 3" value="${rule.min_nights || ''}"
          style="width:100%;padding:10px 12px;border:1.5px solid #E8E0D0;border-radius:10px;font-size:14px;box-sizing:border-box;" />
        <small style="display:block;margin-top:4px;font-size:11px;color:#9CA3AF;">Les voyageurs ne pourront pas réserver moins de X nuits</small>
      </div>
    `;
  } else if (type === 'long_stay') {
    container.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;width:100%;box-sizing:border-box;overflow:hidden;">
        <div style="min-width:0;">
          <label style="display:block;font-size:11px;font-weight:600;color:#374151;margin-bottom:5px;text-transform:uppercase;letter-spacing:.4px;">Réduction (%)</label>
          <input id="pr_discount_pct" type="number" min="0" max="100" step="0.5" placeholder="Ex: 10" value="${rule.discount_pct || ''}"
            style="width:100%;padding:9px 8px;border:1.5px solid #E8E0D0;border-radius:10px;font-size:13px;box-sizing:border-box;min-width:0;" />
        </div>
        <div style="min-width:0;">
          <label style="display:block;font-size:11px;font-weight:600;color:#374151;margin-bottom:5px;text-transform:uppercase;letter-spacing:.4px;">À partir de (nuits)</label>
          <input id="pr_discount_nights" type="number" min="1" step="1" placeholder="Ex: 7" value="${rule.discount_after_nights || ''}"
            style="width:100%;padding:9px 8px;border:1.5px solid #E8E0D0;border-radius:10px;font-size:13px;box-sizing:border-box;min-width:0;" />
        </div>
      </div>
    `;
  }
}

function editPricingRule(id) {
  const rule = _pricingRules.find(r => r.id === id);
  if (rule) openPricingRuleModal(rule);
}

function deletePricingRule(id) {
  // Modale custom — confirm() est bloqué sur mobile/WebView
  const existing = document.getElementById('_deleteRuleModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = '_deleteRuleModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(13,17,23,.55);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;';
  modal.innerHTML = `
    <div style="background:white;border-radius:20px;padding:28px;max-width:360px;width:100%;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,.15);">
      <div style="width:52px;height:52px;border-radius:50%;background:#FEF2F2;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;font-size:22px;">🗑️</div>
      <h3 style="font-family:'DM Sans',sans-serif;font-size:16px;font-weight:700;color:#0D1117;margin:0 0 8px;">Supprimer cette règle ?</h3>
      <p style="font-size:13px;color:#7A8695;margin:0 0 20px;">Cette action est irréversible.</p>
      <div style="display:flex;gap:10px;">
        <button id="_deleteRuleCancel" style="flex:1;height:40px;border-radius:12px;border:1.5px solid rgba(13,17,23,.15);background:white;color:#374151;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:600;cursor:pointer;">Annuler</button>
        <button id="_deleteRuleConfirm" style="flex:1;height:40px;border-radius:12px;border:none;background:#DC2626;color:white;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:600;cursor:pointer;">Supprimer</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById('_deleteRuleCancel').onclick = () => modal.remove();
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.getElementById('_deleteRuleConfirm').onclick = async () => {
    modal.remove();
    try {
      const token = localStorage.getItem('lcc_token');
      await fetch(`${API_PRICING}/api/pricing/rules/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + token }
      });
      showToast('Règle supprimée', 'success');
      await loadPricingRules(_currentPricingPropertyId);
    } catch(e) {
      showToast('Erreur lors de la suppression', 'error');
    }
  };
}

async function savePricingRule(ruleId) {
  const type = document.querySelector('input[name="pr_type"]:checked')?.value;
  const name = document.getElementById('pr_name')?.value?.trim();
  const priority = parseInt(document.getElementById('pr_priority')?.value) || 0;
  const active = document.getElementById('pr_active')?.checked ?? true;

  if (!name) { showToast('Donnez un nom à la règle', 'error'); return; }

  const payload = {
    property_id: _currentPricingPropertyId,
    name, rule_type: type, priority, active
  };

  if (type === 'period') {
    payload.start_date = document.getElementById('pr_start')?.value || null;
    payload.end_date   = document.getElementById('pr_end')?.value || null;
    payload.price      = parseFloat(document.getElementById('pr_price')?.value) || null;
  } else if (type === 'weekday') {
    payload.days_of_week = Array.from(document.querySelectorAll('input[name="pr_day"]:checked')).map(c => parseInt(c.value));
    payload.price = parseFloat(document.getElementById('pr_price')?.value) || null;
  } else if (type === 'min_stay') {
    payload.min_nights = parseInt(document.getElementById('pr_min_nights')?.value) || null;
  } else if (type === 'long_stay') {
    payload.discount_pct           = parseFloat(document.getElementById('pr_discount_pct')?.value) || null;
    payload.discount_after_nights  = parseInt(document.getElementById('pr_discount_nights')?.value) || null;
  }

  try {
    const token = localStorage.getItem('lcc_token');
    const method = ruleId ? 'PUT' : 'POST';
    const url = ruleId
      ? `${API_PRICING}/api/pricing/rules/${ruleId}`
      : `${API_PRICING}/api/pricing/rules`;

    const resp = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) throw new Error('Erreur serveur');

    document.getElementById('pricingRuleModal')?.remove();
    showToast(ruleId ? 'Règle modifiée' : 'Règle créée', 'success');
    await loadPricingRules(_currentPricingPropertyId);
  } catch(e) {
    showToast('Erreur lors de la sauvegarde', 'error');
  }
}


// ========================================
// ÉQUIPEMENTS & RÈGLES PERSONNALISÉS
// ========================================
function renderCustomChips(containerId, items, removeCallback) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = items.map((item, i) => `
    <span style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:rgba(26,122,94,.08);border:1.5px solid rgba(26,122,94,.3);border-radius:999px;font-size:13px;font-weight:500;color:#1A7A5E;">
      ${escapeHtml(item)}
      <button type="button" onclick="${removeCallback}(${i})"
        style="background:none;border:none;cursor:pointer;color:#1A7A5E;font-size:14px;line-height:1;padding:0;display:flex;align-items:center;">×</button>
    </span>
  `).join('');
}

let _customAmenities = [];
let _customQR = []; // Questions-réponses personnalisées
let _customRules = [];

window.addCustomAmenity = function() {
  const input = document.getElementById('newAmenityInput');
  if (!input) return;
  const val = input.value.trim();
  if (!val) return;
  _customAmenities.push(val);
  input.value = '';
  renderCustomChips('customAmenitiesContainer', _customAmenities, 'removeCustomAmenity');
};

window.removeCustomAmenity = function(i) {
  _customAmenities.splice(i, 1);
  renderCustomChips('customAmenitiesContainer', _customAmenities, 'removeCustomAmenity');
};

window.addCustomRule = function() {
  const input = document.getElementById('newRuleInput');
  if (!input) return;
  const val = input.value.trim();
  if (!val) return;
  _customRules.push(val);
  input.value = '';
  renderCustomChips('customRulesContainer', _customRules, 'removeCustomRule');
};

window.removeCustomRule = function(i) {
  _customRules.splice(i, 1);
  renderCustomChips('customRulesContainer', _customRules, 'removeCustomRule');
};

async function pushRulesToChannex() {
  if (!_currentPricingPropertyId) return;
  const btn = document.getElementById('btnPushChannex');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Synchronisation...'; }

  try {
    const token = localStorage.getItem('lcc_token');
    const resp = await fetch(`${API_PRICING}/api/pricing/rules/push-channex/${_currentPricingPropertyId}`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Erreur serveur');
    showToast(data.message || 'Prix synchronisés avec Channex ✅', 'success');
  } catch(e) {
    showToast(e.message || 'Erreur de synchronisation', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Synchroniser les prix avec Channex'; }
  }
}

// ============================================================
// QUESTIONS-RÉPONSES PERSONNALISÉES
// ============================================================
function renderCustomQR() {
  const container = document.getElementById('customQRList');
  if (!container) return;
  if (!_customQR.length) {
    container.innerHTML = '<div style="font-size:13px;color:#9CA3AF;padding:8px 0;">Aucune question-réponse configurée</div>';
    return;
  }
  container.innerHTML = _customQR.map((qr, i) => `
    <div class="qr-custom-item" style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <span style="font-size:11px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.05em;">Question ${i+1}</span>
        <button type="button" onclick="removeCustomQR(${i})"
          style="background:#FEF2F2;border:1px solid rgba(220,38,38,.2);color:#DC2626;border-radius:8px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;">
          <i class="fas fa-trash"></i>
        </button>
      </div>
      <div>
        <label style="font-size:11px;color:#6B7280;margin-bottom:4px;display:block;">Mots-clés déclencheurs <span style="color:#9CA3AF;">(séparés par des virgules)</span></label>
        <input type="text" class="form-input" style="font-size:13px;" placeholder="ex: piscine, pool, nager"
          value="${escapeHtml(qr.keywords || '')}"
          onchange="_customQR[${i}].keywords = this.value" />
      </div>
      <div>
        <label style="font-size:11px;color:#6B7280;margin-bottom:4px;display:block;">Réponse automatique</label>
        <textarea class="form-input" style="font-size:13px;min-height:80px;resize:vertical;" placeholder="ex: Oui, le logement dispose d'une piscine privée chauffée !"
          onchange="_customQR[${i}].response = this.value">${escapeHtml(qr.response || '')}</textarea>
      </div>
    </div>
  `).join('');
}

function addCustomQR() {
  _customQR.push({ keywords: '', response: '' });
  renderCustomQR();
  // Scroll vers le dernier élément
  const container = document.getElementById('customQRList');
  if (container) container.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function removeCustomQR(index) {
  _customQR.splice(index, 1);
  renderCustomQR();
}



// ── AVIS OTA — injecté depuis settings.html ──
// ── AVIS OTA ─────────────────────────────────────────────────

async function initReviewsSection(propertyId, isConnected) {
  const section = document.getElementById('reviewsSection');
  if (!section) return;
  if (!isConnected) { section.style.display = 'none'; return; }
  section.style.display = 'block';

  const loading = document.getElementById('reviewsLoading');
  const list    = document.getElementById('reviewsList');
  const empty   = document.getElementById('reviewsEmpty');
  const badge   = document.getElementById('reviewsBadge');

  loading.style.display = 'block';
  list.style.display    = 'none';
  list.innerHTML        = '';
  empty.style.display   = 'none';

  try {
    const token = localStorage.getItem('lcc_token');
    const res   = await fetch('/api/channex/reviews/' + propertyId, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data  = await res.json();

    const reviews = data.reviews || [];
    renderReviewScores(data.scores || {}, reviews);
    loading.style.display = 'none';

    if (reviews.length === 0) { empty.style.display = 'block'; return; }

    const unreplied = reviews.filter(r => {
      const rt = r.reply && typeof r.reply === 'object'
        ? (r.reply.text || r.reply.body || r.reply.content || '')
        : (r.reply || '');
      return rt.trim().length === 0;
    }).length;
    if (unreplied > 0) { badge.textContent = unreplied; badge.style.display = 'inline-block'; }
    else { badge.style.display = 'none'; }

    reviews.forEach(r => list.appendChild(buildReviewCard(r, propertyId)));
    list.style.display = 'flex';

  } catch(e) {
    loading.innerHTML = '<i class="fas fa-exclamation-circle" style="color:#ef4444;margin-right:6px;"></i><span style="font-size:13px;color:#6b7280;">Impossible de charger les avis</span>';
  }
}

function renderReviewScores(scores, reviews) {
  const globalEl = document.getElementById('reviewsGlobalScore');
  const subEl    = document.getElementById('reviewsSubScores');
  const maxEl    = document.getElementById('reviewsScoreMax');

  // Calculer la note globale moyenne sur tous les avis
  const validScores = (reviews || []).map(r => r.score).filter(s => s !== null && s !== undefined);
  if (!validScores.length) { globalEl.textContent = '—'; if (subEl) subEl.innerHTML = ''; return; }

  const avg = validScores.reduce((a, b) => a + b, 0) / validScores.length;
  globalEl.textContent = avg.toFixed(1);
  if (maxEl) maxEl.textContent = '/10';

  // Scores par catégorie
  const keys = Object.keys(scores).filter(k => k !== 'overall');
  if (!keys.length || !subEl) return;

  const labels = { clean:'Propreté', communication:'Communication', checkin:'Arrivée', accuracy:'Exactitude', location:'Emplacement', value:'Rapport qualité/prix', comfort:'Confort', facilities:'Équipements' };
  subEl.innerHTML = keys.map(k => {
    const val = scores[k]?.score || 0;
    const pct = Math.round((val / 10) * 100);
    return '<div class="score-bar-wrap">'
      + '<span class="score-bar-label">' + (labels[k] || k) + '</span>'
      + '<div class="score-bar-track"><div class="score-bar-fill" style="width:' + pct + '%"></div></div>'
      + '<span class="score-bar-value">' + val.toFixed(1) + '</span>'
      + '</div>';
  }).join('');
}

function buildReviewCard(review, propertyId) {
  const div = document.createElement('div');

  const ch  = (review.channel_code || '').toLowerCase();
  const plt = ch.includes('airbnb') ? 'airbnb' : ch.includes('booking') ? 'booking' : ch.includes('expedia') || ch.includes('vrbo') ? 'expedia' : 'other';
  const pLabel = { airbnb:'Airbnb', booking:'Booking.com', expedia:'Expedia', other: review.channel_code || 'Plateforme' }[plt];
  const pIcon  = { airbnb:'fa-brands fa-airbnb', booking:'fas fa-building', expedia:'fas fa-plane', other:'fas fa-globe' }[plt];

  // Reply déjà normalisé côté serveur (string ou null)
  const replyText   = typeof review.reply === 'string' ? review.reply : '';
  const hasRealReply = replyText.trim().length > 0;

  div.className = 'review-card' + (hasRealReply ? '' : ' unreplied');
  div.dataset.reviewId = review.id;

  const initial = (review.reviewer_name || 'V').charAt(0).toUpperCase();
  const dateStr = review.reviewed_at
    ? new Date(review.reviewed_at).toLocaleDateString('fr-FR', {day:'numeric',month:'short',year:'numeric'})
    : '';

  // Note : affichée sur 10 avec couleur selon le score
  const score = review.score !== null && review.score !== undefined ? parseFloat(review.score) : null;
  const scoreColor = score === null ? '#9CA3AF' : score >= 8 ? '#1A7A5E' : score >= 6 ? '#f59e0b' : '#ef4444';
  const scoreHtml = score !== null
    ? '<span style="font-size:18px;font-weight:800;color:' + scoreColor + ';">' + score.toFixed(1) + '</span><span style="font-size:11px;color:#9CA3AF;">/10</span>'
    : '';

  div.innerHTML =
    '<div class="review-header">'
      + '<div class="review-guest">'
        + '<div class="review-avatar">' + initial + '</div>'
        + '<div class="review-meta">'
          + '<span class="review-name">' + (review.reviewer_name || 'Voyageur') + '</span>'
          + '<span class="review-date">' + dateStr + '</span>'
        + '</div>'
      + '</div>'
      + '<div style="display:flex;align-items:center;gap:8px;">'
        + (scoreHtml ? '<div style="display:flex;align-items:baseline;gap:2px;">' + scoreHtml + '</div>' : '')
        + (review.is_hidden ? '<span class="hidden-badge"><i class="fas fa-eye-slash" style="margin-right:3px;"></i>En attente</span>' : '')
        + '<div class="review-platform platform-' + plt + '"><i class="' + pIcon + '" style="font-size:11px;"></i> ' + pLabel + '</div>'
      + '</div>'
    + '</div>'
    + (review.comment ? '<div class="review-text">&ldquo;' + review.comment + '&rdquo;</div>' : '')
    + (hasRealReply ? '<div class="review-reply-existing"><i class="fas fa-reply"></i><span>' + replyText + '</span></div>' : '')
    + '<div class="review-actions">'
      + '<button class="btn-reply-toggle" onclick="toggleReplyForm(\'' + review.id + '\')">'
        + '<i class="fas fa-reply"></i> ' + (hasRealReply ? 'Modifier la réponse' : 'Répondre')
      + '</button>'
      + (!hasRealReply ? '<span style="font-size:11px;color:#f59e0b;font-weight:600;"><i class="fas fa-clock" style="margin-right:3px;"></i>Sans réponse</span>' : '')
    + '</div>'
    + '<div class="review-reply-form" id="replyForm_' + review.id + '">'
      + (review.is_hidden ? '<div style="font-size:11px;color:#92400e;background:#fef3c7;padding:8px 10px;border-radius:7px;margin-bottom:4px;"><i class="fas fa-info-circle" style="margin-right:4px;"></i>Airbnb : votre réponse rendra l\'avis public.</div>' : '')
      + '<textarea class="review-reply-textarea" id="replyText_' + review.id + '" placeholder="Votre réponse au voyageur...">' + replyText + '</textarea>'
      + '<div style="display:flex;gap:8px;justify-content:flex-end;">'
        + '<button class="btn-reply-cancel" onclick="toggleReplyForm(\'' + review.id + '\')">Annuler</button>'
        + '<button class="btn-reply-send" id="replySend_' + review.id + '" onclick="sendReviewReply(\'' + review.id + '\',\'' + propertyId + '\')">'
          + '<i class="fas fa-paper-plane"></i> Envoyer'
        + '</button>'
      + '</div>'
    + '</div>';

  return div;
}

function toggleReplyForm(reviewId) {
  var form = document.getElementById('replyForm_' + reviewId);
  if (!form) return;
  form.classList.toggle('open');
  if (form.classList.contains('open')) {
    var ta = form.querySelector('textarea');
    if (ta) ta.focus();
  }
}

async function sendReviewReply(reviewId, propertyId) {
  var textarea = document.getElementById('replyText_' + reviewId);
  var btn      = document.getElementById('replySend_' + reviewId);
  var text     = textarea ? textarea.value.trim() : '';
  if (!text) { if (textarea) textarea.style.borderColor = '#ef4444'; return; }
  textarea.style.borderColor = '';
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Envoi...';

  try {
    var token = localStorage.getItem('lcc_token');
    var res   = await fetch('/api/channex/reviews/' + reviewId + '/reply', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply: text, property_id: propertyId })
    });
    if (!res.ok) throw new Error();

    var card = document.querySelector('[data-review-id="' + reviewId + '"]');
    if (card) {
      card.classList.remove('unreplied');
      var existing = card.querySelector('.review-reply-existing');
      if (existing) {
        existing.querySelector('span').textContent = text;
      } else {
        var d = document.createElement('div');
        d.className = 'review-reply-existing';
        d.innerHTML = '<i class="fas fa-reply"></i><span>' + text + '</span>';
        card.querySelector('.review-actions').before(d);
      }
      card.querySelector('.btn-reply-toggle').innerHTML = '<i class="fas fa-reply"></i> Modifier la réponse';
      var noReply = card.querySelector('.review-actions span');
      if (noReply) noReply.remove();
    }
    toggleReplyForm(reviewId);

    var unreplied = document.querySelectorAll('.review-card.unreplied').length;
    var badgeEl   = document.getElementById('reviewsBadge');
    if (unreplied > 0) { badgeEl.textContent = unreplied; badgeEl.style.display = 'inline-block'; }
    else { badgeEl.style.display = 'none'; }

  } catch(e) {
    btn.innerHTML = '<i class="fas fa-exclamation-circle"></i> Erreur';
    setTimeout(function() { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Envoyer'; }, 2000);
  }
}

// initReviewsSection est appelé directement depuis openEditPropertyModal (settings.js)

// ============================================================
// 🗓️ SYNCHRONISATION iCAL — Plateformes non connectées à Channex
// ============================================================

const ICAL_PLATFORMS = [
  { id: 'gites_de_france',  name: 'Gîtes de France',   color: '#E8612C', domain: 'gites-de-france.com',  logo: 'https://logo.clearbit.com/gites-de-france.com' },
  { id: 'clevacances',      name: 'Clévacances',        color: '#C8002B', domain: 'clevacances.com',       logo: 'https://logo.clearbit.com/clevacances.com' },
  { id: 'leboncoin',        name: 'Leboncoin',          color: '#F55A00', domain: 'leboncoin.fr',          logo: 'https://logo.clearbit.com/leboncoin.fr' },
  { id: 'amivac',           name: 'Amivac',             color: '#00A6A6', domain: 'amivac.com',            logo: 'https://logo.clearbit.com/amivac.com' },
  { id: 'casamundo',        name: 'Casamundo',          color: '#E30613', domain: 'casamundo.com',         logo: 'https://logo.clearbit.com/casamundo.com' },
  { id: 'housetrip',        name: 'Housetrip',          color: '#FF5A5F', domain: 'housetrip.com',         logo: 'https://logo.clearbit.com/housetrip.com' },
  { id: 'camping_car_park', name: 'Camping-car Park',   color: '#2E7D32', domain: 'campingcarpark.com',    logo: 'https://logo.clearbit.com/campingcarpark.com' },
  { id: 'holidayhome',      name: 'Holidayhome',        color: '#004B8D', domain: 'holidayhome.com',       logo: 'https://logo.clearbit.com/holidayhome.com' }
];

window._currentIcalUrls = window._currentIcalUrls || [];

function getLogoUrl(platform) {
  // Clearbit pour logo haute qualité, fallback Google favicon
  if (platform && platform.logo) return platform.logo;
  if (platform && platform.domain) return `https://www.google.com/s2/favicons?domain=${platform.domain}&sz=32`;
  return '';
}
// Alias pour compat
function getFaviconUrl(domain) {
  return `https://logo.clearbit.com/${domain}`;
}

// Peupler le <select> de plateformes
function initIcalPlatformSelect() {
  const sel = document.getElementById('icalPlatformSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Sélectionner une plateforme —</option>' +
    ICAL_PLATFORMS.map(p =>
      `<option value="${p.id}" data-domain="${p.domain}" data-color="${p.color}" data-logo="${p.logo || ''}">${p.name}</option>`
    ).join('');
}

// Mise à jour du logo quand on change la sélection
function onIcalPlatformChange() {
  const sel = document.getElementById('icalPlatformSelect');
  const favicon = document.getElementById('icalPlatformFavicon');
  if (!sel || !favicon) return;
  const opt = sel.options[sel.selectedIndex];
  const logoUrl = opt?.dataset?.logo;
  const domain = opt?.dataset?.domain;
  if (sel.value && (logoUrl || domain)) {
    favicon.src = logoUrl || getFaviconUrl(domain);
    favicon.style.display = 'block';
    // Fallback si Clearbit échoue
    favicon.onerror = function() { this.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`; this.onerror=null; };
  } else {
    favicon.style.display = 'none';
  }
}

function addIcalUrl() {
  const sel = document.getElementById('icalPlatformSelect');
  const urlInput = document.getElementById('icalNewUrl');
  const url = urlInput?.value?.trim();
  const platformId = sel?.value;

  if (!platformId) { showToast('Sélectionnez une plateforme', 'warning'); return; }
  if (!url || !url.startsWith('http')) { showToast('Entrez un lien iCal valide', 'warning'); return; }
  if (window._currentIcalUrls.some(e => e.url === url)) { showToast('Ce lien est déjà ajouté', 'warning'); return; }

  const platform = ICAL_PLATFORMS.find(p => p.id === platformId);
  window._currentIcalUrls.push({
    platform: platform.id,
    platformName: platform.name,
    color: platform.color,
    domain: platform.domain,
    url
  });

  // Reset
  urlInput.value = '';
  sel.value = '';
  const favicon = document.getElementById('icalPlatformFavicon');
  if (favicon) favicon.style.display = 'none';

  renderIcalUrls();
  showToast('Lien iCal ajouté', 'success');
}

function removeIcalUrl(index) {
  window._currentIcalUrls.splice(index, 1);
  renderIcalUrls();
}

function renderIcalUrls() {
  const list = document.getElementById('icalUrlsList');
  if (!list) return;
  if (!window._currentIcalUrls || window._currentIcalUrls.length === 0) {
    list.innerHTML = '<p style="font-size:13px;color:#9ca3af;padding:4px 0;">Aucune plateforme iCal configurée.</p>';
    return;
  }
  list.innerHTML = window._currentIcalUrls.map((entry, i) => {
    const p = ICAL_PLATFORMS.find(pl => pl.id === entry.platform) || { name: entry.platformName || entry.platform, color: entry.color || '#888', domain: null };
    const logoUrl = p.logo || (p.domain ? `https://logo.clearbit.com/${p.domain}` : '');
    const fallbackUrl = (p.domain || entry.domain) ? `https://www.google.com/s2/favicons?domain=${p.domain||entry.domain}&sz=32` : '';
    return `
      <div class="ical-url-row">
        <div class="ical-plat-badge" style="background:${p.color};">
          ${logoUrl ? `<img src="${logoUrl}" onerror="this.src='${fallbackUrl}';this.onerror=null;" style="width:14px;height:14px;border-radius:2px;object-fit:contain;vertical-align:middle;margin-right:4px;">` : ''}
          ${p.name}
        </div>
        <span class="ical-url-text" title="${entry.url}">${entry.url}</span>
        <button type="button" class="ical-remove-btn" onclick="removeIcalUrl(${i})" title="Supprimer">
          <i class="fas fa-times-circle"></i>
        </button>
      </div>
    `;
  }).join('');
}

// Afficher le lien iCal export du logement courant
function initIcalExportUrl(propertyId) {
  const input = document.getElementById('icalExportUrl');
  if (!input || !propertyId) return;
  input.value = `https://app.boostinghost.fr/ical/property/${propertyId}.ics`;
}

function copyIcalExportUrl() {
  const input = document.getElementById('icalExportUrl');
  if (!input || !input.value || input.value === 'Chargement…') return;
  navigator.clipboard.writeText(input.value).then(() => {
    showToast('Lien copié !', 'success');
  }).catch(() => {
    input.select();
    document.execCommand('copy');
    showToast('Lien copié !', 'success');
  });
}

// Init au chargement
document.addEventListener('DOMContentLoaded', function() {
  initIcalPlatformSelect();
  window._currentIcalUrls = [];
  renderIcalUrls();
});
if (document.readyState !== 'loading') {
  initIcalPlatformSelect();
}

// ============================================================
// 📋 NOTES VOYAGEURS — Section dans l'onglet Avis
// ============================================================

// ── Logos plateformes ─────────────────────────────────────────
const PLATFORM_META = {
  BookingCom: {
    label: 'Booking.com',
    logo:  'https://logo.clearbit.com/booking.com',
    color: '#003580',
    bg:    '#EEF3FB'
  },
  Airbnb: {
    label: 'Airbnb',
    logo:  'https://logo.clearbit.com/airbnb.com',
    color: '#FF5A5F',
    bg:    '#FFF0F0'
  },
  Expedia: {
    label: 'Expedia',
    logo:  'https://logo.clearbit.com/expedia.com',
    color: '#00355F',
    bg:    '#EEF5FB'
  },
  Vrbo: {
    label: 'Vrbo',
    logo:  'https://logo.clearbit.com/vrbo.com',
    color: '#1B5E8F',
    bg:    '#EBF4FC'
  },
  default: {
    label: 'Plateforme',
    logo:  null,
    color: '#6B7280',
    bg:    '#F3F4F6'
  }
};

function getPlatformMeta(platform) {
  if (!platform) return PLATFORM_META.default;
  const key = Object.keys(PLATFORM_META).find(k =>
    k !== 'default' && platform.toLowerCase().includes(k.toLowerCase())
  );
  return key ? PLATFORM_META[key] : { ...PLATFORM_META.default, label: platform };
}

// ── Parser le champ notes Channex ────────────────────────────
function parseReservationNotes(raw) {
  if (!raw) return { comment: null, meta: [] };
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  let comment = null;
  const meta = [];

  lines.forEach(line => {
    const noteMatch    = line.match(/^(?:BOOKING\s+)?NOTE\s*:\s*(.+)/i);
    const mealMatch    = line.match(/^Meal Plan:\s*(.+)/i);
    const smokingMatch = line.match(/^Smoking Preference:\s*(.+)/i);
    const payMatch     = line.match(/^Payment Collect:\s*(.+)/i);
    const commMatch    = line.match(/^OTA Commission:\s*(.+)/i);
    const prepaidMatch = line.match(/\*\*.*PRE[-\s]?PAID.*\*\*/i);

    if (noteMatch)    { comment = noteMatch[1].trim(); return; }
    if (prepaidMatch) meta.push({ icon: '💳', text: 'Pré-payé OTA' });
    if (mealMatch)    meta.push({ icon: '🍽️', text: mealMatch[1].trim() });
    if (smokingMatch) meta.push({ icon: '🚭', text: smokingMatch[1].trim() });
    if (payMatch)     meta.push({ icon: '💰', text: 'Paiement : ' + payMatch[1].trim() });
    if (commMatch)    meta.push({ icon: '📊', text: 'Commission OTA : ' + commMatch[1].trim() + ' €' });
  });

  return { comment, meta };
}

// ── Construire une note card ──────────────────────────────────
function buildNoteCard(reservation) {
  const plt    = getPlatformMeta(reservation.platform);
  const parsed = parseReservationNotes(reservation.notes);

  const guestName = reservation.guest_name ||
    [reservation.guest_first_name, reservation.guest_last_name].filter(Boolean).join(' ') ||
    'Voyageur';

  const initial = guestName.charAt(0).toUpperCase();
  const dateStr = reservation.start_date
    ? new Date(reservation.start_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';

  const card = document.createElement('div');
  card.style.cssText = 'background:#fff;border:1px solid #E8E0D0;border-radius:14px;padding:14px 16px;margin-bottom:10px;font-family:\'DM Sans\',sans-serif;';

  const logoBadge = plt.logo
    ? `<img src="${plt.logo}" onerror="this.style.display='none';this.nextElementSibling.style.display='inline';" style="width:14px;height:14px;object-fit:contain;border-radius:2px;vertical-align:middle;margin-right:4px;"><span style="display:none;">${plt.label}</span>`
    : `<span>${plt.label}</span>`;

  const platformBadge = `<div style="display:inline-flex;align-items:center;background:${plt.bg};color:${plt.color};border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;flex-shrink:0;">${logoBadge}${plt.label}</div>`;

  const commentHtml = parsed.comment
    ? `<div style="font-size:13px;color:#374151;background:#FAFAF8;border-left:3px solid #1A7A5E;border-radius:0 8px 8px 0;padding:8px 12px;margin:10px 0;font-style:italic;">&ldquo;${escapeHtml(parsed.comment)}&rdquo;</div>`
    : '';

  const metaHtml = parsed.meta.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">${parsed.meta.map(m => `<span style="font-size:11px;background:#F3F4F6;border-radius:20px;padding:2px 10px;color:#6B7280;">${m.icon} ${escapeHtml(m.text)}</span>`).join('')}</div>`
    : '';

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="width:34px;height:34px;border-radius:50%;background:#E8F4F0;color:#1A7A5E;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0;">${initial}</div>
        <div>
          <div style="font-size:14px;font-weight:600;color:#0D1117;">${escapeHtml(guestName)}</div>
          ${dateStr ? `<div style="font-size:11px;color:#9CA3AF;margin-top:1px;">${dateStr}</div>` : ''}
        </div>
      </div>
      ${platformBadge}
    </div>
    ${commentHtml}
    ${metaHtml}
  `;
  return card;
}

// ── Init section Notes ────────────────────────────────────────
async function initNotesSection(propertyId) {
  const section = document.getElementById('notesSection');
  if (!section) return;

  section.innerHTML = `<div style="display:flex;align-items:center;gap:8px;padding:12px 0;"><i class="fas fa-spinner fa-spin" style="color:#1A7A5E;"></i><span style="font-size:13px;color:#6B7280;">Chargement des notes…</span></div>`;

  try {
    const token = localStorage.getItem('lcc_token');
    const res   = await fetch('/api/reservations/notes/' + propertyId, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data  = await res.json();
    const notes = data.notes || [];

    if (notes.length === 0) {
      section.innerHTML = `<div style="text-align:center;padding:20px;color:#9CA3AF;font-size:13px;"><i class="fas fa-comment-slash" style="font-size:24px;margin-bottom:8px;display:block;opacity:.4;"></i>Aucune note voyageur pour ce logement</div>`;
      return;
    }

    // Stats par plateforme
    const byPlatform = {};
    notes.forEach(n => { const k = n.platform || 'Autre'; byPlatform[k] = (byPlatform[k] || 0) + 1; });

    const statsHtml = Object.entries(byPlatform).map(([plt, count]) => {
      const meta = getPlatformMeta(plt);
      const logo = meta.logo ? `<img src="${meta.logo}" onerror="this.style.display='none';" style="width:13px;height:13px;object-fit:contain;border-radius:2px;margin-right:4px;vertical-align:middle;">` : '';
      return `<span style="display:inline-flex;align-items:center;background:${meta.bg};color:${meta.color};border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;">${logo}${meta.label} <span style="margin-left:4px;opacity:.7;">${count}</span></span>`;
    }).join('');

    section.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
        <div style="font-size:12px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:.06em;">${notes.length} note${notes.length > 1 ? 's' : ''} reçue${notes.length > 1 ? 's' : ''}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">${statsHtml}</div>
      </div>
      <div id="notesCardsList"></div>
    `;

    const list = document.getElementById('notesCardsList');
    notes.forEach(n => list.appendChild(buildNoteCard(n)));

  } catch(e) {
    section.innerHTML = `<div style="display:flex;align-items:center;gap:8px;padding:12px 0;color:#6B7280;font-size:13px;"><i class="fas fa-exclamation-circle" style="color:#ef4444;"></i> Impossible de charger les notes voyageurs</div>`;
  }
}
/* ============================================================

/* ============================================================
   DRAG & DROP — Réordonnancement des logements
   Support desktop (mouse) + mobile (touch)
   ============================================================ */

(function () {
  const LONG_PRESS_MS = 450;

  const style = document.createElement('style');
  style.textContent = `
    /* ── Handle de drag ── */
    .dnd-handle {
      position: absolute;
      top: 8px;
      left: 8px;
      width: 28px;
      height: 28px;
      background: rgba(13,17,23,.55);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: rgba(255,255,255,.85);
      font-size: 13px;
      cursor: grab;
      z-index: 10;
      transition: background .15s, transform .15s, opacity .15s;
      opacity: 0.75;
      user-select: none;
      -webkit-user-select: none;
      touch-action: none;
    }
    .property-card:hover .dnd-handle {
      opacity: 1;
      background: rgba(13,17,23,.75);
    }
    .dnd-handle:hover {
      background: rgba(26,122,94,.85) !important;
      transform: scale(1.1);
      opacity: 1 !important;
    }
    .dnd-handle:active,
    .dnd-handle.dragging {
      cursor: grabbing !important;
      background: rgba(26,122,94,.95) !important;
      transform: scale(0.95);
    }

    /* ── Carte en cours de déplacement ── */
    .property-card.dnd-ghost {
      opacity: 0.35;
      transform: scale(0.97);
      outline: 2px dashed rgba(26,122,94,.5);
      outline-offset: 2px;
    }

    /* ── Carte cible (drop zone) ── */
    .property-card.dnd-over {
      outline: 2px dashed #1A7A5E;
      outline-offset: 3px;
      background: rgba(26,122,94,.04);
    }

    /* ── Clone flottant (touch) ── */
    .dnd-floating {
      position: fixed !important;
      z-index: 9999 !important;
      pointer-events: none !important;
      opacity: 0.93 !important;
      box-shadow: 0 16px 48px rgba(0,0,0,.28), 0 4px 12px rgba(0,0,0,.12) !important;
      transform: scale(1.04) rotate(1deg) !important;
      transition: none !important;
      border-radius: 16px !important;
      background: #fff;
    }

    /* ── Empêcher la sélection de texte pendant le drag ── */
    .property-card .property-img {
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
    }

    /* ── Toast hint ── */
    #dnd-hint-toast {
      position: fixed;
      bottom: 90px;
      left: 50%;
      transform: translateX(-50%) translateY(20px);
      background: rgba(13,17,23,.82);
      color: #fff;
      font-size: 12px;
      font-family: 'DM Sans', sans-serif;
      padding: 8px 18px;
      border-radius: 999px;
      z-index: 99999;
      pointer-events: none;
      opacity: 0;
      transition: opacity .25s, transform .25s;
      white-space: nowrap;
    }
    #dnd-hint-toast.show {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  `;
  document.head.appendChild(style);

  /* ── Hint toast ── */
  const hintEl = document.createElement('div');
  hintEl.id = 'dnd-hint-toast';
  hintEl.innerHTML = '<i class="fas fa-grip-vertical" style="margin-right:6px;opacity:.7;"></i> Glissez le ⠿ pour réorganiser';
  document.body.appendChild(hintEl);
  function showHint() {
    hintEl.classList.add('show');
    setTimeout(() => hintEl.classList.remove('show'), 2500);
  }

  /* ── État global ── */
  let srcCard = null;
  let floatingEl = null;
  let longPressTimer = null;
  let touchActive = false;
  let offsetX = 0, offsetY = 0;

  /* ── Sauvegarder le nouvel ordre ── */
  async function saveNewOrder() {
    const grid = document.getElementById('propertiesGrid');
    if (!grid) return;

    // Supporte les deux vues : grille (.property-card) et liste (.property-list-item)
    const selector = grid.classList.contains('list-view')
      ? '.property-list-item[data-id]'
      : '.property-card:not(.property-card-add)';

    const newOrder = [...grid.querySelectorAll(selector)]
      .map(c => c.getAttribute('data-id')).filter(Boolean);

    const currentOrder = properties.map(p => p._id || p.id);

    let working = [...currentOrder];
    const calls = [];
    for (let target = 0; target < newOrder.length; target++) {
      const currentPos = working.indexOf(newOrder[target]);
      if (currentPos === target) continue;
      for (let i = currentPos; i > target; i--) {
        calls.push({ id: newOrder[target], direction: 'up' });
        [working[i], working[i - 1]] = [working[i - 1], working[i]];
      }
    }

    if (calls.length === 0) return;

    try {
      for (const call of calls) {
        const token = localStorage.getItem('lcc_token');
        await fetch(`${API_URL}/api/properties/${call.id}/reorder`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token,
          },
          body: JSON.stringify({ direction: call.direction }),
        });
      }
      const reordered = newOrder.map(id => properties.find(p => (p._id || p.id) === id)).filter(Boolean);
      properties.length = 0;
      reordered.forEach(p => properties.push(p));
      showToast('Ordre sauvegardé ✓', 'success');
    } catch (err) {
      console.error('Erreur sauvegarde ordre:', err);
      showToast('Erreur lors de la sauvegarde', 'error');
      await loadProperties();
    }
  }

  /* ── Trouver la carte sous un point (touch) ── */
  function cardAtPoint(x, y) {
    if (floatingEl) floatingEl.style.display = 'none';
    const el = document.elementFromPoint(x, y);
    if (floatingEl) floatingEl.style.display = '';
    if (!el) return null;
    // Supporte grille et liste
    return el.closest('.property-card:not(.property-card-add), .property-list-item[data-id]');
  }

  /* ── Créer le clone flottant (touch) ── */
  function createFloating(card, touchX, touchY) {
    const rect = card.getBoundingClientRect();
    offsetX = touchX - rect.left;
    offsetY = touchY - rect.top;

    floatingEl = card.cloneNode(true);
    floatingEl.classList.add('dnd-floating');
    floatingEl.style.width = rect.width + 'px';
    floatingEl.style.height = rect.height + 'px';
    floatingEl.style.left = (touchX - offsetX) + 'px';
    floatingEl.style.top  = (touchY - offsetY) + 'px';
    document.body.appendChild(floatingEl);
  }

  /* ── Déplacer le clone flottant ── */
  function moveFloating(touchX, touchY) {
    if (!floatingEl) return;
    floatingEl.style.left = (touchX - offsetX) + 'px';
    floatingEl.style.top  = (touchY - offsetY) + 'px';
  }

  /* ── Insérer srcCard autour de targetCard ── */
  function reinsert(targetCard) {
    if (!srcCard || !targetCard || srcCard === targetCard) return;
    const grid = document.getElementById('propertiesGrid');
    const isListView = grid?.classList.contains('list-view');
    const selector = isListView
      ? '.property-list-item[data-id]'
      : '.property-card:not(.property-card-add)';
    const all = [...grid.querySelectorAll(selector)];
    const si = all.indexOf(srcCard);
    const ti = all.indexOf(targetCard);
    if (si < ti) {
      targetCard.parentNode.insertBefore(srcCard, targetCard.nextSibling);
    } else {
      targetCard.parentNode.insertBefore(srcCard, targetCard);
    }
  }

  /* ── Nettoyer après drop ── */
  function endDrag() {
    if (floatingEl) { floatingEl.remove(); floatingEl = null; }
    if (srcCard) { srcCard.classList.remove('dnd-ghost'); }
    document.querySelectorAll('.dnd-over').forEach(c => c.classList.remove('dnd-over'));
    touchActive = false;
    srcCard = null;
  }

  /* ── Init sur les cartes ── */
  function initDragDrop() {
    const grid = document.getElementById('propertiesGrid');
    if (!grid) return;

    const isListView = grid.classList.contains('list-view');

    if (isListView) {
      // ── VUE LISTE : DnD sur .property-list-item via .dnd-handle-list ──
      grid.querySelectorAll('.property-list-item[data-id]').forEach(item => {
        const handle = item.querySelector('.dnd-handle-list');
        if (!handle || handle._dndBound) return;
        handle._dndBound = true;

        // Touch : activation immédiate sur le handle
        handle.addEventListener('touchstart', (e) => {
          e.stopPropagation();
          touchActive = true;
          srcCard = item;
          item.classList.add('dnd-ghost');
          if (navigator.vibrate) navigator.vibrate(40);
          createFloating(item, e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: true });

        handle.addEventListener('touchmove', (e) => {
          if (!touchActive) return;
          e.preventDefault();
          const touch = e.touches[0];
          moveFloating(touch.clientX, touch.clientY);
          const target = cardAtPoint(touch.clientX, touch.clientY);
          document.querySelectorAll('.dnd-over').forEach(c => c.classList.remove('dnd-over'));
          if (target && target !== srcCard) {
            target.classList.add('dnd-over');
            reinsert(target);
          }
        }, { passive: false });

        handle.addEventListener('touchend', async () => {
          if (!touchActive) return;
          endDrag();
          await saveNewOrder();
        });

        handle.addEventListener('touchcancel', () => endDrag());

        // Mouse : drag HTML5 via mousedown sur le handle
        handle.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          item.setAttribute('draggable', 'true');
          item.classList.add('dnd-ghost');
        });
        handle.addEventListener('mouseup', () => item.classList.remove('dnd-ghost'));

        item.addEventListener('dragstart', (e) => {
          srcCard = item;
          e.dataTransfer.effectAllowed = 'move';
        });
        item.addEventListener('dragend', async () => {
          item.setAttribute('draggable', 'false');
          item.classList.remove('dnd-ghost');
          document.querySelectorAll('.dnd-over').forEach(c => c.classList.remove('dnd-over'));
          srcCard = null;
          await saveNewOrder();
        });
        item.addEventListener('dragover', (e) => {
          e.preventDefault();
          if (!srcCard || srcCard === item) return;
          document.querySelectorAll('.dnd-over').forEach(c => c.classList.remove('dnd-over'));
          item.classList.add('dnd-over');
        });
        item.addEventListener('drop', (e) => {
          e.preventDefault();
          reinsert(item);
          item.classList.remove('dnd-over');
        });
      });
      return; // Pas de DnD grille en vue liste
    }

    // ── VUE GRILLE : DnD sur .property-card via .dnd-handle ──
    grid.querySelectorAll('.property-card:not(.property-card-add)').forEach(card => {
      const handle  = card.querySelector('.dnd-handle');
      const imgZone = card.querySelector('.property-img');

      // ── Évite de binder deux fois ──
      if (handle && handle._dndBound) return;
      if (handle) handle._dndBound = true;
      else if (imgZone && imgZone._dndBound) return;
      else if (imgZone) imgZone._dndBound = true;

      // Zone primaire (handle) vs zone fallback (photo entière)
      const primaryZone  = handle  || imgZone;
      const fallbackZone = handle  ? imgZone : null;

      /* ════════════════════════════════
         TOUCH — Handle (activation immédiate)
      ════════════════════════════════ */
      if (primaryZone) {
        primaryZone.addEventListener('touchstart', (e) => {
          const isHandle = !!handle && e.currentTarget === handle;
          if (isHandle) {
            // Handle → activation immédiate, pas de long press
            e.stopPropagation();
            touchActive = true;
            srcCard = card;
            card.classList.add('dnd-ghost');
            handle.classList.add('dragging');
            if (navigator.vibrate) navigator.vibrate(40);
            createFloating(card, e.touches[0].clientX, e.touches[0].clientY);
          } else {
            // Photo → long press comme avant
            longPressTimer = setTimeout(() => {
              touchActive = true;
              srcCard = card;
              card.classList.add('dnd-ghost');
              if (handle) handle.classList.add('dragging');
              if (navigator.vibrate) navigator.vibrate(50);
              createFloating(card, e.touches[0].clientX, e.touches[0].clientY);
            }, LONG_PRESS_MS);
          }
        }, { passive: true });

        primaryZone.addEventListener('touchmove', (e) => {
          if (!touchActive) {
            clearTimeout(longPressTimer);
            return;
          }
          e.preventDefault();
          const touch = e.touches[0];
          moveFloating(touch.clientX, touch.clientY);
          const target = cardAtPoint(touch.clientX, touch.clientY);
          document.querySelectorAll('.dnd-over').forEach(c => c.classList.remove('dnd-over'));
          if (target && target !== srcCard) {
            target.classList.add('dnd-over');
            reinsert(target);
          }
        }, { passive: false });

        primaryZone.addEventListener('touchend', async () => {
          clearTimeout(longPressTimer);
          if (!touchActive) return;
          if (handle) handle.classList.remove('dragging');
          endDrag();
          await saveNewOrder();
        });

        primaryZone.addEventListener('touchcancel', () => {
          clearTimeout(longPressTimer);
          if (handle) handle.classList.remove('dragging');
          endDrag();
        });
      }

      /* ════════════════════════════════
         MOUSE — Handle (drag natif HTML5 immédiat)
      ════════════════════════════════ */
      if (handle) {
        // Sur le handle : drag immédiat au mousedown
        handle.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          card.setAttribute('draggable', 'true');
          card.classList.add('dnd-ghost');
          handle.classList.add('dragging');
        });

        handle.addEventListener('mouseup', () => {
          handle.classList.remove('dragging');
        });
      }

      // Fallback long press sur la photo (si pas de handle ou en complément)
      if (imgZone && imgZone !== primaryZone) {
        imgZone.addEventListener('mousedown', () => {
          longPressTimer = setTimeout(() => {
            card.setAttribute('draggable', 'true');
            card.classList.add('dnd-ghost');
            if (handle) handle.classList.add('dragging');
          }, LONG_PRESS_MS);
        });
        imgZone.addEventListener('mouseup',    () => clearTimeout(longPressTimer));
        imgZone.addEventListener('mouseleave', () => clearTimeout(longPressTimer));
      } else if (imgZone) {
        // Pas de handle séparé — long press sur photo
        imgZone.addEventListener('mousedown', () => {
          longPressTimer = setTimeout(() => {
            card.setAttribute('draggable', 'true');
            card.classList.add('dnd-ghost');
          }, LONG_PRESS_MS);
        });
        imgZone.addEventListener('mouseup',    () => clearTimeout(longPressTimer));
        imgZone.addEventListener('mouseleave', () => clearTimeout(longPressTimer));
      }

      /* ════════════════════════════════
         Drag HTML5 natif (desktop)
      ════════════════════════════════ */
      card.addEventListener('dragstart', (e) => {
        srcCard = card;
        e.dataTransfer.effectAllowed = 'move';
      });

      card.addEventListener('dragend', async () => {
        card.setAttribute('draggable', 'false');
        card.classList.remove('dnd-ghost');
        if (handle) handle.classList.remove('dragging');
        document.querySelectorAll('.dnd-over').forEach(c => c.classList.remove('dnd-over'));
        srcCard = null;
        await saveNewOrder();
      });

      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!srcCard || srcCard === card) return;
        document.querySelectorAll('.dnd-over').forEach(c => c.classList.remove('dnd-over'));
        card.classList.add('dnd-over');
      });

      card.addEventListener('drop', (e) => {
        e.preventDefault();
        reinsert(card);
        card.classList.remove('dnd-over');
      });
    });
  }

  /* ── Observer les re-rendus ── */
  const observer = new MutationObserver(() => initDragDrop());

  document.addEventListener('DOMContentLoaded', () => {
    const grid = document.getElementById('propertiesGrid');
    if (grid) {
      observer.observe(grid, { childList: true });
      initViewToggle();
      initDragDrop();
      setTimeout(showHint, 1500);
    }
  });

})();
