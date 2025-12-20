// ========================================
// CONFIGURATION & STATE
// ========================================
const API_URL = "https://lcc-booking-manager.onrender.com";
const BOOSTINGHOST_ICAL_BASE = window.location.origin;
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
  if (document.getElementById("propertyOwnerId")) {
  document.getElementById("propertyOwnerId").value = property.owner_id || "";
}
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
const chatLink = `${window.location.origin}/chat-guest.html?property=${id}`;
      
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
  <div class="chat-link-section" style="margin-top: 16px; padding: 14px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 14px;">
    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
      <i class="fas fa-comments" style="color: #fff; font-size: 16px;"></i>
      <span style="color: #fff; font-weight: 600; font-size: 14px;">Lien de chat voyageurs</span>
    </div>
    
    <!-- Lien unique -->
    <div class="chat-link-item" style="background: rgba(255,255,255,0.15); padding: 10px 12px; border-radius: 10px; margin-bottom: 8px;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
        <i class="fas fa-link" style="color: #fff; font-size: 12px;"></i>
        <span style="color: #fff; font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">Lien unique</span>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <input 
          type="text" 
          value="${escapeHtml(chatLink)}" 
          readonly 
          class="chat-link-input"
          style="flex: 1; background: rgba(255,255,255,0.9); border: none; padding: 8px 10px; border-radius: 8px; font-size: 12px; color: #374151; font-family: 'Courier New', monospace;"
        />
        <button 
          type="button" 
          class="btn-copy-chat-link" 
          data-link="${escapeHtml(chatLink)}"
          style="background: #fff; color: #059669; border: none; padding: 8px 12px; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s;"
          onmouseover="this.style.background='#f0fdf4'" 
          onmouseout="this.style.background='#fff'"
        >
          <i class="fas fa-copy"></i> Copier
        </button>
      </div>
    </div>
    
    <!-- Code PIN -->
    <div class="chat-pin-item" style="background: rgba(255,255,255,0.15); padding: 10px 12px; border-radius: 10px; margin-bottom: 10px;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
        <i class="fas fa-lock" style="color: #fff; font-size: 12px;"></i>
        <span style="color: #fff; font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">Code PIN (4 chiffres)</span>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <input 
          type="text" 
          value="${escapeHtml(chatPin)}" 
          maxlength="4"
          class="chat-pin-input"
          data-property-id="${escapeHtml(id)}"
          style="width: 80px; background: rgba(255,255,255,0.9); border: none; padding: 8px 12px; border-radius: 8px; font-size: 16px; font-weight: 700; color: #374151; text-align: center; font-family: 'Courier New', monospace;"
        />
        <button 
          type="button" 
          class="btn-update-pin" 
          data-property-id="${escapeHtml(id)}"
          style="background: #fff; color: #059669; border: none; padding: 8px 12px; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s;"
          onmouseover="this.style.background='#f0fdf4'" 
          onmouseout="this.style.background='#fff'"
        >
          <i class="fas fa-save"></i> Modifier
        </button>
        <button 
          type="button" 
          class="btn-regenerate-pin" 
          data-property-id="${escapeHtml(id)}"
          style="background: rgba(255,255,255,0.2); color: #fff; border: 1px solid rgba(255,255,255,0.3); padding: 8px 12px; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s;"
          onmouseover="this.style.background='rgba(255,255,255,0.3)'" 
          onmouseout="this.style.background='rgba(255,255,255,0.2)'"
          title="Générer un nouveau code aléatoire"
        >
          <i class="fas fa-sync-alt"></i>
        </button>
      </div>
    </div>
    
    <!-- Bouton copier message automatique -->
    <button 
      type="button" 
      class="btn-copy-auto-message" 
      data-link="${escapeHtml(chatLink)}" 
      data-pin="${escapeHtml(chatPin)}"
      data-property-name="${escapeHtml(name)}"
      style="width: 100%; background: #fff; color: #059669; border: none; padding: 10px 14px; border-radius: 10px; cursor: pointer; font-size: 13px; font-weight: 600; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px;"
      onmouseover="this.style.background='#f0fdf4'; this.style.transform='translateY(-1px)'" 
      onmouseout="this.style.background='#fff'; this.style.transform='translateY(0)'"
    >
      <i class="fas fa-copy"></i>
      <span>Copier le message automatique</span>
    </button>
  </div>

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

      return `
        <div class="property-card">
          <div class="property-header">
            <div class="property-info">
              <div class="property-name">
                <span class="color-badge" style="background:${color};"></span>
                <span>${escapeHtml(name)}</span>
              </div>
                            <div class="property-meta">
                ${addressBadge}
                ${timesBadge}
                ${depositBadge}
                ${wifiBadge}
                ${accessBadge}
                ${welcomeBookBadge}
              </div>
            </div>
            <div class="property-photo-wrapper">
              ${
                photoUrl
                  ? `<img src="${escapeHtml(photoUrl)}" alt="Photo logement" />`
                  : `<span class="property-photo-placeholder"><i class="fas fa-image"></i></span>`
              }
            </div>
          </div>

          <div class="property-actions">
            <button
              type="button"
              class="btn-icon-action btn-reorder"
              data-id="${escapeHtml(id)}"
              data-direction="up"
              title="Monter"
              style="background:#dbeafe;color:#1e40af;"
            >
              <i class="fas fa-arrow-up"></i>
            </button>
            <button
              type="button"
              class="btn-icon-action btn-reorder"
              data-id="${escapeHtml(id)}"
              data-direction="down"
              title="Descendre"
              style="background:#dbeafe;color:#1e40af;"
            >
              <i class="fas fa-arrow-down"></i>
            </button>
            <button
              type="button"
              class="btn-icon-action btn-edit"
              data-id="${escapeHtml(id)}"
            >
              <i class="fas fa-pen"></i>
            </button>
            <button
              type="button"
              class="btn-icon-action btn-delete"
              data-id="${escapeHtml(id)}"
            >
              <i class="fas fa-trash"></i>
            </button>
          </div>

          <div class="ical-urls">
            ${icalListHtml}
          </div>

          ${boostinghostHtml}
          
          ${chatSectionHtml}
        </div>
      `;
    })
    .join("");

  grid.innerHTML = cardsHtml;

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
