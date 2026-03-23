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
// INITIALIZATION
// ========================================
document.addEventListener("DOMContentLoaded", async () => {
  console.log("🔧 Paramètres - Initialisation...");

  setupColorPicker();
  setupPhotoPreview();
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

  const arrivalMessage = document.getElementById('propertyArrivalMessage')?.value?.trim() || null;

  const basePriceRaw    = document.getElementById('propertyBasePrice')?.value;
  const weekendPriceRaw = document.getElementById('propertyWeekendPrice')?.value;
  const basePrice    = basePriceRaw    !== undefined && basePriceRaw    !== '' ? parseFloat(basePriceRaw)    : null;
  const weekendPrice = weekendPriceRaw !== undefined && weekendPriceRaw !== '' ? parseFloat(weekendPriceRaw) : null;

  const existingPhotoUrl = document.getElementById("propertyPhotoUrl")?.value || null;
  const photoInput = document.getElementById("propertyPhoto");

  if (!name) {
    hideLoading();
    showToast('Veuillez saisir un nom de logement.', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('name', name);
  formData.append('color', color);
  formData.append('icalUrls', JSON.stringify([])); // iCal désactivé — Channex gère les OTAs
  
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
  if (arrivalMessage) formData.append('arrivalMessage', arrivalMessage);
  if (basePrice    !== null) formData.append('basePrice',    basePrice);
  if (weekendPrice !== null) formData.append('weekendPrice', weekendPrice);

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
      climatisation: document.getElementById('amenityClimatisation')?.checked || false
    };
    formData.append('amenities', JSON.stringify(amenities));
    
    // Règles
    const houseRules = {
      animaux: document.getElementById('ruleAnimaux')?.checked || false,
      fumeurs: document.getElementById('ruleFumeurs')?.checked || false,
      fetes: document.getElementById('ruleFetes')?.checked || false,
      enfants: document.getElementById('ruleEnfants')?.checked || false
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
    
  } catch (e) {
    console.error('Erreur collecte données étendues:', e);
  }
  // ===== FIN AJOUT NOUVELLES DONNÉES =====

const ownerId = document.getElementById('propertyOwnerId')?.value || null;
if (ownerId) formData.append('ownerId', ownerId);
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

async function deleteProperty(propertyId) {
  if (!confirm("Êtes-vous sûr de vouloir supprimer ce logement ?")) {
    return;
  }

  showLoading();
  try {
    const token = localStorage.getItem("lcc_token");
    const response = await fetch(`${API_URL}/api/properties/${propertyId}`, {
      method: "DELETE",
      headers: {
        Authorization: "Bearer " + token,
      },
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
  // Reset règles de tarification
  _pricingRules = [];
  _currentPricingPropertyId = null;
  const rulesList = document.getElementById('pricingRulesList');
  if (rulesList) rulesList.innerHTML = '<div style="font-size:13px;color:#9CA3AF;padding:10px 0;">Aucune règle configurée</div>';
  const urlList = document.getElementById("urlList");
  if (urlList) urlList.innerHTML = "";
}

function openAddPropertyModal() {
  resetPropertyForm();
  const modal = document.getElementById("editPropertyModal");
  const titleEl = document.getElementById("modalTitle");
  if (titleEl) titleEl.querySelector("span").textContent = "Ajouter un logement";

  // Nouveau logement : pas de chatPin ni de lien à afficher
  const chatLinkSectionEl = document.getElementById('chatLinkSection');
  if (chatLinkSectionEl) chatLinkSectionEl.style.display = 'none';

  if (modal) modal.classList.add("active");
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
  document.getElementById("propertyAddress").value = property.address || "";
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
  if (document.getElementById("propertyArrivalMessage")) {
    document.getElementById("propertyArrivalMessage").value = property.arrivalMessage || property.arrival_message || "";
  }
  // ✅ PRIX PAR NUIT
  if (document.getElementById("propertyBasePrice")) {
    const bp = property.basePrice ?? property.base_price;
    document.getElementById("propertyBasePrice").value = bp != null ? bp : "";
  }
  if (document.getElementById("propertyWeekendPrice")) {
    const wp = property.weekendPrice ?? property.weekend_price;
    document.getElementById("propertyWeekendPrice").value = wp != null ? wp : "";
  }

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

  // populate iCal URLs supprimé — Channex gère les OTAs

  // ===== CHAT LINK SECTION =====
  const pid = property._id || property.id || '';
  const chatPin = property.chatPin || property.chat_pin || '';
  const chatLink = `https://boostinghost.fr/guest?property=${pid}`;

  const chatLinkSection = document.getElementById('chatLinkSection');
  const chatLinkUrl = document.getElementById('chatLinkUrl');
  const chatPinInput = document.getElementById('chatPinInput');
  const chatPinUpdateBtn = document.getElementById('chatPinUpdateBtn');
  const chatPinRegenBtn = document.getElementById('chatPinRegenBtn');
  const chatAutoMsgBtn = document.getElementById('chatAutoMsgBtn');
  const chatCopyLinkBtn = document.getElementById('chatCopyLinkBtn');

  if (chatLinkSection) chatLinkSection.style.display = pid ? '' : 'none';
  if (chatLinkUrl) chatLinkUrl.value = chatLink;
  if (chatPinInput) { chatPinInput.value = chatPin; chatPinInput.dataset.propertyId = pid; }
  if (chatPinUpdateBtn) chatPinUpdateBtn.dataset.propertyId = pid;
  if (chatPinRegenBtn) chatPinRegenBtn.dataset.propertyId = pid;
  if (chatAutoMsgBtn) {
    chatAutoMsgBtn.dataset.link = chatLink;
    chatAutoMsgBtn.dataset.pin = chatPin;
    chatAutoMsgBtn.dataset.propertyName = property.name || '';
  }
  if (chatCopyLinkBtn) chatCopyLinkBtn.dataset.link = chatLink;
  // ===== FIN CHAT LINK =====

  // ✅ CHARGER LES RÈGLES DE TARIFICATION
  if (typeof loadPricingRules === 'function') {
    loadPricingRules(property._id || property.id);
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
const chatPin = p.chatPin || p.chat_pin || 'Non défini';
// ✅ Nouveau format de lien compatible avec les deep links iOS/Android
const chatLink = `https://boostinghost.fr/guest?property=${id}`;
      
      // icalListHtml supprimé — Channex gère la synchronisation OTA
const chatSectionHtml = `
  <div class="chat-link-section" style="margin-top:14px;padding:14px;background:#fff;border:1.5px solid rgba(26,122,94,0.18);border-radius:14px;">

    <!-- Header -->
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
      <div style="width:30px;height:30px;border-radius:8px;background:rgba(26,122,94,0.1);display:flex;align-items:center;justify-content:center;">
        <i class="fas fa-comments" style="color:#1A7A5E;font-size:13px;"></i>
      </div>
      <span style="font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;color:#0d1117;">Lien chat voyageurs</span>
    </div>

    <!-- Lien unique -->
    <div style="margin-bottom:10px;">
      <div style="font-size:11px;font-weight:500;color:rgba(13,17,23,0.45);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px;">
        <i class="fas fa-link" style="margin-right:4px;"></i>Lien unique
      </div>
      <div style="display:flex;align-items:center;gap:6px;background:rgba(26,122,94,0.05);border:1px solid rgba(26,122,94,0.15);border-radius:10px;padding:8px 10px;">
        <input 
          type="text" 
          value="${escapeHtml(chatLink)}" 
          readonly 
          class="chat-link-input"
          onclick="this.select()"
          style="flex:1;border:none;background:transparent;font-family:ui-monospace,monospace;font-size:11px;color:#0d1117;outline:none;min-width:0;cursor:pointer;"
        />
        <button 
          type="button" 
          class="btn-copy-chat-link" 
          data-link="${escapeHtml(chatLink)}"
          style="flex-shrink:0;background:#1A7A5E;color:#fff;border:none;padding:5px 10px;border-radius:7px;cursor:pointer;font-size:11.5px;font-weight:600;display:inline-flex;align-items:center;gap:4px;transition:background .15s;"
          onmouseover="this.style.background='#15624B'" 
          onmouseout="this.style.background='#1A7A5E'"
        >
          <i class="fas fa-copy"></i> Copier
        </button>
      </div>
    </div>

    <!-- Code PIN -->
    <div style="margin-bottom:10px;">
      <div style="font-size:11px;font-weight:500;color:rgba(13,17,23,0.45);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px;">
        <i class="fas fa-key" style="margin-right:4px;"></i>Code PIN voyageur
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <input 
          type="text" 
          value="${escapeHtml(chatPin)}" 
          maxlength="4"
          class="chat-pin-input"
          data-property-id="${escapeHtml(id)}"
          style="width:72px;background:#f9fafb;border:1.5px solid rgba(13,17,23,0.12);padding:7px 10px;border-radius:9px;font-size:18px;font-weight:700;color:#0d1117;text-align:center;font-family:ui-monospace,monospace;outline:none;"
        />
        <button 
          type="button" 
          class="btn-update-pin" 
          data-property-id="${escapeHtml(id)}"
          style="background:#f3f4f6;color:#374151;border:1.5px solid rgba(13,17,23,0.1);padding:7px 11px;border-radius:9px;cursor:pointer;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:4px;transition:all .15s;"
          onmouseover="this.style.background='#e5e7eb'" 
          onmouseout="this.style.background='#f3f4f6'"
        >
          <i class="fas fa-save"></i> Sauvegarder
        </button>
        <button 
          type="button" 
          class="btn-regenerate-pin" 
          data-property-id="${escapeHtml(id)}"
          style="background:#f3f4f6;color:#374151;border:1.5px solid rgba(13,17,23,0.1);padding:7px 10px;border-radius:9px;cursor:pointer;font-size:13px;transition:all .15s;"
          onmouseover="this.style.background='#e5e7eb'" 
          onmouseout="this.style.background='#f3f4f6'"
          title="Générer un nouveau code aléatoire"
        >
          <i class="fas fa-sync-alt"></i>
        </button>
      </div>
    </div>

    <!-- Bouton message automatique -->
    <button 
      type="button" 
      class="btn-copy-auto-message" 
      data-link="${escapeHtml(chatLink)}" 
      data-pin="${escapeHtml(chatPin)}"
      data-property-name="${escapeHtml(name)}"
      style="width:100%;background:rgba(26,122,94,0.07);color:#1A7A5E;border:1.5px solid rgba(26,122,94,0.2);padding:9px 14px;border-radius:10px;cursor:pointer;font-size:12.5px;font-weight:600;font-family:'DM Sans',sans-serif;transition:all .15s;display:flex;align-items:center;justify-content:center;gap:7px;"
      onmouseover="this.style.background='rgba(26,122,94,0.13)'" 
      onmouseout="this.style.background='rgba(26,122,94,0.07)'"
    >
      <i class="fas fa-paper-plane"></i>
      <span>Copier le message à envoyer au voyageur</span>
    </button>

  </div>
`;

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
            <div class="property-img-badge active-badge">● Actif</div>
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
            <!-- Channex status badge -->
            ${p.channexEnabled ? `
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;padding:6px 10px;background:#e8f5f1;border-radius:8px;border:1px solid #b8ddd4;">
              <span style="width:7px;height:7px;border-radius:50%;background:#1A7A5E;flex-shrink:0;"></span>
              <span style="font-size:11px;font-weight:600;color:#1A7A5E;">Synchronisation OTA active</span>
              <button type="button" class="btn-channex-manage" data-id="${escapeHtml(id)}" data-name="${escapeHtml(name)}" data-channex-enabled="true" style="margin-left:auto;font-size:10px;color:#1A7A5E;background:none;border:none;cursor:pointer;text-decoration:underline;padding:0;">Gérer</button>
            </div>` : `
            <button type="button" class="btn-channex-connect" data-id="${escapeHtml(id)}" data-name="${escapeHtml(name)}" style="width:100%;margin-bottom:8px;padding:7px 12px;background:linear-gradient(135deg,#1A7A5E,#2AAE86);color:white;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
              <i class="fas fa-plug"></i> Connecter Airbnb · Booking · Expedia
            </button>`}
            <!-- Actions -->
            <div class="property-actions">
              <button type="button" class="btn btn-delete" data-id="${escapeHtml(id)}">Supprimer</button>
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
    });
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

function openChannexModal(propertyId, propertyName, isConnected) {
  // Supprimer une modale existante
  const existing = document.getElementById('channexModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'channexModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.5);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;';

  modal.innerHTML = `
    <div style="background:#fff;border-radius:20px;padding:28px 24px;max-width:420px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,.2);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
        <div>
          <div style="font-family:'Instrument Serif',Georgia,serif;font-size:20px;color:#0D1117;">Synchronisation OTA</div>
          <div style="font-size:13px;color:#6B7280;margin-top:2px;">${propertyName}</div>
        </div>
        <button onclick="document.getElementById('channexModal').remove()" style="background:#f3f4f6;border:none;border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:16px;color:#6B7280;">✕</button>
      </div>

      <div data-channex-body>
      ${isConnected ? `
        <!-- État : connecté -->
        <div style="background:#e8f5f1;border-radius:12px;padding:16px;margin-bottom:20px;display:flex;align-items:center;gap:12px;">
          <div style="width:10px;height:10px;border-radius:50%;background:#1A7A5E;flex-shrink:0;"></div>
          <div>
            <div style="font-size:13px;font-weight:600;color:#1A7A5E;">Synchronisation active</div>
            <div style="font-size:12px;color:#6B7280;margin-top:2px;">Les réservations OTA arrivent en temps réel</div>
          </div>
        </div>

        <div style="font-size:13px;color:#374151;margin-bottom:16px;">Pour connecter vos plateformes (Airbnb, Booking, Expedia), rendez-vous dans l'onglet <strong>Channels</strong> de votre espace Channex.</div>

        <div style="display:flex;gap:10px;">
          <button onclick="channexSyncAvailability('${propertyId}')" id="btnChannexSync" style="flex:1;height:42px;border-radius:12px;border:1px solid #e5e7eb;background:#f9fafb;color:#374151;font-size:13px;font-weight:500;cursor:pointer;">
            <i class="fas fa-sync"></i> Sync dispos
          </button>
          <button onclick="openChannexIframe('${propertyId}')" style="flex:2;height:42px;border-radius:12px;border:none;background:#1A7A5E;color:white;font-size:14px;font-weight:600;cursor:pointer;">
            <i class="fas fa-plug"></i> Gérer les plateformes
          </button>
        </div>
        <button onclick="channexDisconnect('${propertyId}')" style="width:100%;margin-top:10px;height:38px;border-radius:12px;border:1px solid #fee2e2;background:#fff;color:#dc2626;font-size:13px;font-weight:500;cursor:pointer;">
          Déconnecter ce logement
        </button>
      ` : `
        <!-- État : non connecté -->
        <div style="margin-bottom:20px;">
          <div style="font-size:13px;color:#374151;margin-bottom:16px;">Connectez votre logement aux principales plateformes de réservation pour recevoir les réservations en temps réel.</div>
          
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px;">
            ${['Airbnb','Booking.com','Expedia','VRBO','Agoda'].map(p => `
              <div style="padding:6px 12px;background:#f3f4f6;border-radius:20px;font-size:12px;font-weight:500;color:#374151;">
                ${p}
              </div>
            `).join('')}
            <div style="padding:6px 12px;background:#f3f4f6;border-radius:20px;font-size:12px;color:#6B7280;">+45 autres</div>
          </div>
        </div>

        <div style="display:flex;gap:10px;">
          <button onclick="document.getElementById('channexModal').remove()" style="flex:1;height:42px;border-radius:12px;border:1px solid #e5e7eb;background:#f9fafb;color:#374151;font-size:14px;font-weight:500;cursor:pointer;">Annuler</button>
          <button onclick="channexConnect('${propertyId}')" id="btnChannexConnect" style="flex:2;height:42px;border-radius:12px;border:none;background:linear-gradient(135deg,#1A7A5E,#2AAE86);color:white;font-size:14px;font-weight:600;cursor:pointer;">
            <i class="fas fa-plug"></i> Activer la synchronisation
          </button>
        </div>
      `}
      </div>
    </div>
  `;

  // Fermer en cliquant sur le fond
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });

  document.body.appendChild(modal);
}

async function openChannexIframe(propertyId) {
  // Afficher un loader
  const modal = document.getElementById('channexModal');
  const body = modal?.querySelector('[data-channex-body]');
  if (body) {
    body.innerHTML = '<div style="text-align:center;padding:40px;"><i class="fas fa-spinner fa-spin" style="font-size:32px;color:#1A7A5E;"></i><div style="margin-top:12px;color:#6B7280;font-size:14px;">Chargement des plateformes...</div></div>';
  }

  try {
    const token = localStorage.getItem('lcc_token');
    const res = await fetch(`${API_URL}/api/channex/iframe-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ property_id: propertyId })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur serveur');

    // Remplacer le contenu par l'iFrame
    if (body) {
      body.innerHTML = `
        <div style="font-size:13px;color:#374151;margin-bottom:12px;">
          Connectez vos plateformes directement ci-dessous. Les réservations arriveront automatiquement dans Boostinghost.
        </div>
        <div style="border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
          <iframe 
            src="${data.iframe_url}"
            style="width:100%;height:480px;border:none;display:block;"
            allow="same-origin"
          ></iframe>
        </div>
        <button onclick="document.getElementById('channexModal').remove()" 
          style="width:100%;margin-top:12px;height:42px;border-radius:12px;border:none;background:#1A7A5E;color:white;font-size:14px;font-weight:600;cursor:pointer;">
          Fermer
        </button>
      `;
    }

  } catch (e) {
    console.error('❌ [CHANNEX IFRAME]', e.message);
    if (body) {
      body.innerHTML = `<div style="text-align:center;padding:40px;color:#dc2626;">${e.message}</div>`;
    }
  }
}

async function channexConnect(propertyId) {
  const btn = document.getElementById('btnChannexConnect');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Connexion en cours...';
  }

  try {
    const token = localStorage.getItem('lcc_token');
    const res = await fetch(`${API_URL}/api/channex/connect-property`, {
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
    showToast('Logement connecté ! Les réservations OTA arrivent maintenant en temps réel.', 'success');

    // Recharger les propriétés pour mettre à jour le badge
    await loadProperties();

  } catch (e) {
    console.error('❌ [CHANNEX CONNECT]', e.message);
    showToast('Erreur : ' + e.message, 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-plug"></i> Activer la synchronisation';
    }
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
      detail = `${rule.start_date || ''} → ${rule.end_date || ''} · <strong>${rule.price}€/nuit</strong>`;
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
    <div style="background:#fff;border-radius:20px;width:480px;max-width:100%;max-height:90vh;overflow-y:auto;font-family:'DM Sans',sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.2);">
      <div style="padding:20px 24px;border-bottom:1px solid #F0EBE3;display:flex;align-items:center;justify-content:space-between;">
        <div style="font-size:16px;font-weight:700;color:#0D1117;">${isEdit ? 'Modifier la règle' : 'Nouvelle règle de prix'}</div>
        <button onclick="document.getElementById('pricingRuleModal').remove()"
          style="width:32px;height:32px;border-radius:50%;border:none;background:#f3f4f6;color:#6B7280;cursor:pointer;font-size:16px;">✕</button>
      </div>
      <div style="padding:20px 24px;">

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
              { val: 'min_stay', icon: 'fa-moon', label: 'Séjour minimum' },
              { val: 'long_stay', icon: 'fa-percentage', label: 'Réduction longue durée' }
            ].map(t => `
              <label style="display:flex;align-items:center;gap:8px;padding:10px 12px;border:1.5px solid ${(rule.rule_type || 'period') === t.val ? '#1A7A5E' : '#E8E0D0'};border-radius:10px;cursor:pointer;background:${(rule.rule_type || 'period') === t.val ? 'rgba(26,122,94,.06)' : '#fff'};">
                <input type="radio" name="pr_type" value="${t.val}" ${(rule.rule_type || 'period') === t.val ? 'checked' : ''} onchange="updatePricingRuleForm()" style="accent-color:#1A7A5E;" />
                <i class="fas ${t.icon}" style="color:#1A7A5E;font-size:13px;"></i>
                <span style="font-size:13px;font-weight:500;">${t.label}</span>
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

  // Mettre à jour le style des boutons radio
  document.querySelectorAll('input[name="pr_type"]').forEach(r => {
    const label = r.closest('label');
    if (label) {
      label.style.borderColor = r.checked ? '#1A7A5E' : '#E8E0D0';
      label.style.background = r.checked ? 'rgba(26,122,94,.06)' : '#fff';
    }
  });

  if (type === 'period') {
    container.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
        <div>
          <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:6px;text-transform:uppercase;letter-spacing:.4px;">Date début</label>
          <input id="pr_start" type="date" value="${rule.start_date || ''}"
            style="width:100%;padding:10px 12px;border:1.5px solid #E8E0D0;border-radius:10px;font-size:14px;box-sizing:border-box;" />
        </div>
        <div>
          <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:6px;text-transform:uppercase;letter-spacing:.4px;">Date fin</label>
          <input id="pr_end" type="date" value="${rule.end_date || ''}"
            style="width:100%;padding:10px 12px;border:1.5px solid #E8E0D0;border-radius:10px;font-size:14px;box-sizing:border-box;" />
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
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
        <div>
          <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:6px;text-transform:uppercase;letter-spacing:.4px;">Réduction (%)</label>
          <input id="pr_discount_pct" type="number" min="0" max="100" step="0.5" placeholder="Ex: 10" value="${rule.discount_pct || ''}"
            oninput="updateLongStayPreview()"
            style="width:100%;padding:10px 12px;border:1.5px solid #E8E0D0;border-radius:10px;font-size:14px;box-sizing:border-box;" />
        </div>
        <div>
          <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:6px;text-transform:uppercase;letter-spacing:.4px;">À partir de (nuits)</label>
          <input id="pr_discount_nights" type="number" min="1" step="1" placeholder="Ex: 7" value="${rule.discount_after_nights || ''}"
            oninput="updateLongStayPreview()"
            style="width:100%;padding:10px 12px;border:1.5px solid #E8E0D0;border-radius:10px;font-size:14px;box-sizing:border-box;" />
        </div>
      </div>
      <div id="longStayPreview" style="display:none;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:#15803d;">
        <i class="fas fa-info-circle" style="margin-right:6px;"></i>
        <span id="longStayPreviewText"></span>
      </div>
      <div style="background:#fef3c7;border-radius:10px;padding:10px 14px;font-size:12px;color:#92400e;margin-bottom:14px;">
        <i class="fas fa-exclamation-triangle" style="margin-right:6px;"></i>
        <strong>Note :</strong> La réduction est appliquée sur le prix de base lors du push vers Channex.
        Channex ne gère pas les réductions conditionnelles — le prix réduit est poussé directement pour toutes les dates.
      </div>
    `;
    updateLongStayPreview();
  }
}

function editPricingRule(id) {
  const rule = _pricingRules.find(r => r.id === id);
  if (rule) openPricingRuleModal(rule);
}

function updateLongStayPreview() {
  const pct    = parseFloat(document.getElementById('pr_discount_pct')?.value);
  const nights = parseInt(document.getElementById('pr_discount_nights')?.value);
  const preview = document.getElementById('longStayPreview');
  const previewText = document.getElementById('longStayPreviewText');
  if (!preview || !previewText) return;

  if (!isNaN(pct) && !isNaN(nights) && pct > 0 && nights > 0) {
    // Trouver le prix de base du logement courant
    const props = window.allProperties || [];
    const prop  = props.find(p => String(p.id) === String(_currentPricingPropertyId));
    const base  = prop?.basePrice || prop?.base_price || null;

    let txt = `Réduction de ${pct}% sur les séjours de ${nights} nuits ou plus`;
    if (base) {
      const reduced = Math.round(base * (1 - pct / 100));
      txt += ` · Prix de base ${Math.round(base)}€ → ${reduced}€/nuit`;
    }
    previewText.textContent = txt;
    preview.style.display = 'block';
  } else {
    preview.style.display = 'none';
  }
}

async function deletePricingRule(id) {
  if (!confirm('Supprimer cette règle ?')) return;
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
