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

const BOOSTINGHOST_ICAL_BASE = getBaseUrl();
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

  const arrivalMessage = document.getElementById('propertyArrivalMessage')?.value?.trim() || null;  // ✅ MESSAGE D'ARRIVÉE

  const existingPhotoUrl = document.getElementById("propertyPhotoUrl")?.value || null;
  const photoInput = document.getElementById("propertyPhoto");

  if (!name) {
    hideLoading();
    showToast('Veuillez saisir un nom de logement.', 'error');
    return;
  }

  const urlGroups = document.querySelectorAll(".url-input-group");
  let icalUrls = [];
  
  if (urlGroups.length > 0) {
    icalUrls = Array.from(urlGroups)
      .map((group) => {
        const platformInput = group.querySelector(".platform-input");
        const urlInput = group.querySelector(".url-input");
        const platform = platformInput ? platformInput.value.trim() : "";
        const url = urlInput ? urlInput.value.trim() : "";
        if (!url) return null;
        return { platform: platform || "iCal", url };
      })
      .filter(Boolean);
  } else {
    const urlInputs = document.querySelectorAll('.ical-url-input');
    icalUrls = Array.from(urlInputs)
      .map(input => input.value.trim())
      .filter(Boolean);
  }

  const formData = new FormData();
  formData.append('name', name);
  formData.append('color', color);
  formData.append('icalUrls', JSON.stringify(icalUrls));
  
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
  if (arrivalMessage) formData.append('arrivalMessage', arrivalMessage);  // ✅ MESSAGE D'ARRIVÉE

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

async function testIcalUrl(url, buttonElement) {
  if (!url || url.trim().length === 0) {
    showToast("Veuillez entrer une URL", "error");
    return;
  }

  const originalText = buttonElement.innerHTML;
  buttonElement.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Test...';
  buttonElement.disabled = true;

  try {
    const token = localStorage.getItem("lcc_token");
    const response = await fetch(`${API_URL}/api/properties/test-ical`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ url: url.trim() }),
    });
    const result = await response.json();
    if (response.ok) {
      showToast("URL iCal valide et accessible", "success");
    } else {
      showToast(
        result.error || "Erreur lors du test de l'URL iCal",
        "error"
      );
    }
  } catch (error) {
    console.error("Erreur test iCal:", error);
    showToast("Erreur lors du test de l'URL iCal", "error");
  } finally {
    buttonElement.innerHTML = originalText;
    buttonElement.disabled = false;
  }
}

function copyIcalUrl(url) {
  if (!url) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard
      .writeText(url)
      .then(() => {
        showToast("Lien iCal copié dans le presse-papiers", "success");
      })
      .catch(() => {
        window.prompt("Copiez ce lien iCal :", url);
      });
  } else {
    window.prompt("Copiez ce lien iCal :", url);
  }
}

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

  const urlList = document.getElementById("urlList");
  if (urlList) urlList.innerHTML = "";
}

function openAddPropertyModal() {
  resetPropertyForm();
  const modal = document.getElementById("editPropertyModal");
  const titleEl = document.getElementById("modalTitle");
  if (titleEl) titleEl.querySelector("span").textContent = "Ajouter un logement";
  // ===== CHAT LINK SECTION =====
  const chatLinkSectionEl = document.getElementById('chatLinkSection');
  const chatLinkUrlEl = document.getElementById('chatLinkUrl');
  const chatPinInputEl = document.getElementById('chatPinInput');
  const chatPinUpdateBtn = document.getElementById('chatPinUpdateBtn');
  const chatPinRegenBtn = document.getElementById('chatPinRegenBtn');
  const chatAutoMsgBtn = document.getElementById('chatAutoMsgBtn');
  const chatCopyLinkBtn = document.getElementById('chatCopyLinkBtn');

  const pid = property._id || property.id || '';
  const chatPin = property.chatPin || property.chat_pin || '';
  const chatLink = `https://boostinghost.fr/guest?property=${pid}`;

  if (chatLinkSectionEl) chatLinkSectionEl.style.display = pid ? '' : 'none';
  if (chatLinkUrlEl) chatLinkUrlEl.value = chatLink;
  if (chatPinInputEl) {
    chatPinInputEl.value = chatPin;
    chatPinInputEl.dataset.propertyId = pid;
  }
  if (chatPinUpdateBtn) chatPinUpdateBtn.dataset.propertyId = pid;
  if (chatPinRegenBtn) chatPinRegenBtn.dataset.propertyId = pid;
  if (chatAutoMsgBtn) {
    chatAutoMsgBtn.dataset.link = chatLink;
    chatAutoMsgBtn.dataset.pin = chatPin;
    chatAutoMsgBtn.dataset.propertyName = property.name || '';
  }
  if (chatCopyLinkBtn) chatCopyLinkBtn.dataset.link = chatLink;

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
    document.getElementById("propertyArrivalMessage").value = property.arrivalMessage || "";
  }
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
    const rules = property.house_rules
      ? (typeof property.house_rules === 'string' ? JSON.parse(property.house_rules) : property.house_rules)
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
    const practical = property.practical_info
      ? (typeof property.practical_info === 'string' ? JSON.parse(property.practical_info) : property.practical_info)
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

  let urls = property.icalUrls || [];
  if (!Array.isArray(urls)) urls = [];

  const urlList = document.getElementById("urlList");
  if (urlList) {
    urlList.innerHTML = "";
    if (urls.length > 0) {
      urls.forEach((u) => {
        const platform = typeof u === "string" ? "iCal" : (u.platform || "iCal");
        const url = typeof u === "string" ? u : (u.url || "");
        addUrlField(platform, url);
      });
    } else {
      addUrlField();
    }
  }

  if (modal) modal.classList.add("active");
}

function closeEditModal() {
  const modal = document.getElementById("editPropertyModal");
  if (modal) modal.classList.remove("active");
}

function addUrlField(initialPlatform = "", initialUrl = "") {
  const urlList = document.getElementById("urlList");
  if (!urlList) return;

  const group = document.createElement("div");
  group.className = "url-input-group";
  group.innerHTML = `
    <input
      type="text"
      class="platform-input"
      placeholder="Plateforme (Airbnb, Booking...)"
      value="${initialPlatform ? escapeHtml(initialPlatform) : ""}"
    />
    <input
      type="text"
      class="url-input"
      placeholder="URL iCal"
      value="${initialUrl ? escapeHtml(initialUrl) : ""}"
    />
    <button type="button" class="btn-remove-url" title="Supprimer cette URL">
      <i class="fas fa-times"></i>
    </button>
  `;

  const removeBtn = group.querySelector(".btn-remove-url");
  if (removeBtn) {
    removeBtn.addEventListener("click", () => group.remove());
  }

  urlList.appendChild(group);
}

function buildBoostinghostIcalUrl(property) {
  const id = property._id || property.id;
  if (!id) return null;
  return `${BOOSTINGHOST_ICAL_BASE}/ical/${id}.ics`;
}

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
      
      let urls = p.icalUrls || [];
      if (!Array.isArray(urls)) urls = [];

      const normalizedUrls = urls.map((item) => {
        if (typeof item === "string") {
          return { platform: "iCal", url: item };
        }
        return { platform: item.platform || "iCal", url: item.url || "" };
      }).filter((u) => u.url);

      const icalListHtml =
        normalizedUrls.length > 0
          ? normalizedUrls
              .map(
                (u) => `
          <div class="ical-url-item">
            <div class="ical-source">${escapeHtml(u.platform)}</div>
            <div class="ical-url-text" title="${escapeHtml(u.url)}">
              ${escapeHtml(u.url)}
            </div>
            <button
              type="button"
              class="btn-test-url"
              data-url="${escapeHtml(u.url)}"
            >
              Tester
            </button>
            <button
              type="button"
              class="btn-copy-ical"
              data-url="${escapeHtml(u.url)}"
            >
              <i class="fas fa-copy"></i>
              Copier
            </button>
          </div>
        `
              )
              .join("")
          : `
        <div style="padding: 10px; background: var(--bg-secondary,#f3f4f6); border-radius: 10px; font-size: 12px; color: var(--text-secondary);">
          <i class="fas fa-exclamation-triangle"></i>
          <span style="margin-left:6px;">Aucune URL iCal configurée</span>
        </div>
      `;
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

      const boostinghostUrl = buildBoostinghostIcalUrl(p);
      const boostinghostHtml = boostinghostUrl
        ? `
        <div class="boostinghost-ical">
          <div class="boostinghost-ical-label">
            <i class="fas fa-link"></i>
            <span>Lien iCal Boostinghost</span>
          </div>
          <div class="boostinghost-ical-url" title="${escapeHtml(
            boostinghostUrl
          )}">
            ${escapeHtml(boostinghostUrl)}
          </div>
          <button
            type="button"
            class="btn-copy-boostinghost"
            data-url="${escapeHtml(boostinghostUrl)}"
          >
            <i class="fas fa-copy"></i>
            Copier
          </button>
        </div>
      `
        : "";

      const arrivalLabel = arrivalTime ? arrivalTime : '--';
      const departureLabel = departureTime ? departureTime : '--';
      const depositShort = p.depositAmount != null && p.depositAmount !== '' ? p.depositAmount + ' €' : '–';
      const propertyEmoji = photoUrl ? '' : ['🏢','🌲','🏙️','🏡','🏖️','🏔️'][Math.abs(name.charCodeAt(0)) % 6];

      return `
        <div class="property-card" data-id="${escapeHtml(id)}">
          <!-- Image / hero -->
          <div class="property-img">
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

  grid.querySelectorAll(".btn-test-url").forEach((btn) => {
    btn.addEventListener("click", () => {
      const url = btn.getAttribute("data-url");
      testIcalUrl(url, btn);
    });
  });

  grid.querySelectorAll(".btn-copy-ical").forEach((btn) => {
    btn.addEventListener("click", () => {
      const url = btn.getAttribute("data-url");
      copyIcalUrl(url);
    });
  });

  grid.querySelectorAll(".btn-copy-boostinghost").forEach((btn) => {
    btn.addEventListener("click", () => {
      const url = btn.getAttribute("data-url");
      copyIcalUrl(url);
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
