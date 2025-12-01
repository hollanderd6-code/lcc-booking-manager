// ========================================
// CONFIGURATION & STATE
// ========================================
const API_URL = "https://lcc-booking-manager.onrender.com";
let properties = [];
let currentEditingProperty = null;

// ========================================
// INITIALIZATION
// ========================================
document.addEventListener("DOMContentLoaded", async () => {
  console.log("🔧 Paramètres - Initialisation...");

  setupColorPicker();
  setupPhotoPreview();
  setupModalCloseOnEsc();

  await loadProperties();
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
  toast.className = "toast " + (type === "error" ? "toast-error" : "toast-success");

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
    reader.onload = (e) => {
      box.innerHTML = "";
      const img = document.createElement("img");
      img.src = e.target.result;
      box.appendChild(img);
    };
    reader.readAsDataURL(file);
  });
}

function setupModalCloseOnEsc() {
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
}

// ========================================
// API CALLS
// ========================================
async function loadProperties() {
  showLoading();
  try {
    const token = localStorage.getItem("lcc_token");
    const response = await fetch(`${API_URL}/api/properties`, {
      headers: {
        Authorization: "Bearer " + token,
      },
    });
    const data = await response.json();
    properties = Array.isArray(data.properties) ? data.properties : [];
    renderProperties();
  } catch (error) {
    console.error("Erreur lors du chargement des logements:", error);
    showToast("Erreur lors du chargement des logements", "error");
  } finally {
    hideLoading();
  }
}

async function saveProperty(event) {
  event.preventDefault();
  showLoading();

  const propertyId = document.getElementById("propertyId").value || null;
  const name = document.getElementById("propertyName").value.trim();
  const address = document.getElementById("propertyAddress").value.trim();
  const arrivalTime = document.getElementById("propertyArrivalTime").value;
  const departureTime = document.getElementById("propertyDepartureTime").value;

  const depositRaw = document.getElementById("propertyDeposit").value;
  const depositAmount =
    depositRaw && depositRaw.trim() !== ""
      ? parseFloat(depositRaw.replace(",", "."))
      : null;

  const color = document.getElementById("propertyColor").value;
  const existingPhotoUrl = document.getElementById("propertyPhotoUrl").value || null;
  const photoInput = document.getElementById("propertyPhoto");

  // URLs iCal
  const urlGroups = document.querySelectorAll(".url-input-group");
  const icalUrls = Array.from(urlGroups)
    .map((group) => {
      const platformInput = group.querySelector(".platform-input");
      const urlInput = group.querySelector(".url-input");
      const platform = platformInput ? platformInput.value.trim() : "";
      const url = urlInput ? urlInput.value.trim() : "";
      if (!url) return null;
      return {
        platform: platform || "iCal",
        url,
      };
    })
    .filter(Boolean);

  const propertyData = {
    name,
    address,
    arrivalTime,
    departureTime,
    depositAmount,
    color,
    photoUrl: existingPhotoUrl,
    icalUrls,
  };

  try {
    const token = localStorage.getItem("lcc_token");
    const method = propertyId ? "PUT" : "POST";
    const url = propertyId
      ? `${API_URL}/api/properties/${propertyId}`
      : `${API_URL}/api/properties`;

    const formData = new FormData();
    formData.append("data", JSON.stringify(propertyData));

    if (photoInput && photoInput.files && photoInput.files[0]) {
      formData.append("photo", photoInput.files[0]);
    }

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
  if (!propertyId) return;
  const confirmDelete = window.confirm(
    "Voulez-vous vraiment supprimer ce logement ?"
  );
  if (!confirmDelete) return;

  showLoading();
  try {
    const token = localStorage.getItem("lcc_token");
    const response = await fetch(`${API_URL}/api/properties/${propertyId}`, {
      method: "DELETE",
      headers: {
        Authorization: "Bearer " + token,
      },
    });
    const result = await response.json();
    if (response.ok) {
      showToast(result.message || "Logement supprimé", "success");
      await loadProperties();
    } else {
      showToast(
        result.error || "Une erreur est survenue lors de la suppression",
        "error"
      );
    }
  } catch (error) {
    console.error("Erreur suppression:", error);
    showToast("Erreur lors de la suppression", "error");
  } finally {
    hideLoading();
  }
}

async function testIcalUrl(encodedUrl, buttonElement) {
  const url = decodeURIComponent(encodedUrl || "");
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
      showToast(result.error || "Erreur lors du test de l'URL iCal", "error");
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

  const idInput = document.getElementById("propertyId");
  const photoUrlInput = document.getElementById("propertyPhotoUrl");
  const nameInput = document.getElementById("propertyName");
  const addressInput = document.getElementById("propertyAddress");
  const arrInput = document.getElementById("propertyArrivalTime");
  const depInput = document.getElementById("propertyDepartureTime");
  const depositInput = document.getElementById("propertyDeposit");
  const colorInput = document.getElementById("propertyColor");
  const photoInput = document.getElementById("propertyPhoto");
  const colorPreview = document.getElementById("colorPreview");
  const photoBox = document.getElementById("photoPreviewBox");
  const urlList = document.getElementById("urlList");

  if (idInput) idInput.value = "";
  if (photoUrlInput) photoUrlInput.value = "";
  if (nameInput) nameInput.value = "";
  if (addressInput) addressInput.value = "";
  if (arrInput) arrInput.value = "";
  if (depInput) depInput.value = "";
  if (depositInput) depositInput.value = "";
  if (colorInput) colorInput.value = "#E67E50";
  if (colorPreview) colorPreview.textContent = "#E67E50";
  if (photoInput) photoInput.value = "";
  if (photoBox) {
    photoBox.innerHTML =
      '<span class="photo-preview-placeholder"><i class="fas fa-image"></i></span>';
  }
  if (urlList) {
    urlList.innerHTML = "";
    addUrlField(); // on ajoute une ligne vide par défaut
  }
}

function openAddPropertyModal() {
  resetPropertyForm();
  const modal = document.getElementById("editPropertyModal");
  const titleEl = document.getElementById("modalTitle");
  if (titleEl) {
    const span = titleEl.querySelector("span");
    if (span) span.textContent = "Ajouter un logement";
  }
  if (modal) modal.classList.add("active");
}

function openEditPropertyModal(propertyId) {
  resetPropertyForm();
  const modal = document.getElementById("editPropertyModal");
  const titleEl = document.getElementById("modalTitle");
  if (titleEl) {
    const span = titleEl.querySelector("span");
    if (span) span.textContent = "Modifier le logement";
  }

  const property =
    properties.find((p) => p._id === propertyId) ||
    properties.find((p) => p.id === propertyId);

  if (!property) {
    showToast("Logement introuvable", "error");
    return;
  }

  currentEditingProperty = property;

  document.getElementById("propertyId").value =
    property._id || property.id || "";
  document.getElementById("propertyPhotoUrl").value = property.photoUrl || property.photo || "";

  document.getElementById("propertyName").value = property.name || "";
  document.getElementById("propertyAddress").value = property.address || "";
  document.getElementById("propertyArrivalTime").value =
    property.arrivalTime || "";
  document.getElementById("propertyDepartureTime").value =
    property.departureTime || "";
  document.getElementById("propertyDeposit").value =
    property.depositAmount != null ? property.depositAmount : "";

  const colorInput = document.getElementById("propertyColor");
  const colorPreview = document.getElementById("colorPreview");
  const color = property.color || "#E67E50";
  if (colorInput) colorInput.value = color;
  if (colorPreview) colorPreview.textContent = color.toUpperCase();

  // Photo
  const photoBox = document.getElementById("photoPreviewBox");
  const photoUrl = property.photoUrl || property.photo || "";
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

  // URLs iCal
  const urlList = document.getElementById("urlList");
  if (urlList) {
    urlList.innerHTML = "";
    let urls = property.icalUrls || [];
    if (!Array.isArray(urls)) urls = [];
    if (urls.length === 0) {
      addUrlField();
    } else {
      urls.forEach((item) => {
        if (typeof item === "string") {
          addUrlField("iCal", item);
        } else if (item && typeof item === "object") {
          addUrlField(item.platform || "iCal", item.url || "");
        }
      });
    }
  }

  if (modal) modal.classList.add("active");
}

function closeEditModal() {
  const modal = document.getElementById("editPropertyModal");
  if (modal) modal.classList.remove("active");
}

// ========================================
// URL FIELDS HELPERS
// ========================================
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeForJs(str) {
  return String(str)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
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
      value="${escapeHtml(initialPlatform)}"
    />
    <input
      type="text"
      class="url-input"
      placeholder="URL iCal"
      value="${escapeHtml(initialUrl)}"
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

  const html = properties
    .map((p) => {
      const id = p._id || p.id || "";
      const color = p.color || "#059669";
      const name = p.name || "Sans nom";
      const address = p.address || "";
      const arrivalTime = p.arrivalTime || "";
      const departureTime = p.departureTime || "";
      const depositLabel =
        p.depositAmount != null && p.depositAmount !== ""
          ? `Caution ${p.depositAmount} €`
          : "Pas de caution";
      const photoUrl = p.photoUrl || p.photo || "";

      let urls = p.icalUrls || [];
      if (!Array.isArray(urls)) urls = [];

      const icalListHtml =
        urls.length > 0
          ? urls
              .map((item) => {
                if (typeof item === "string") {
                  return { platform: "iCal", url: item };
                }
                return {
                  platform: item.platform || "iCal",
                  url: item.url || "",
                };
              })
              .filter((u) => u.url)
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
              onclick="testIcalUrl('${encodeURIComponent(u.url)}', this)"
            >
              Tester
            </button>
            <button
              type="button"
              class="btn-copy-ical"
              onclick="copyIcalUrl('${escapeForJs(u.url)}')"
            >
              <i class="fas fa-copy"></i>
              Copier
            </button>
          </div>
        `
              )
              .join("")
          : `
        <div style="padding:10px;background:var(--bg-secondary,#f3f4f6);border-radius:10px;font-size:12px;color:var(--text-secondary);display:flex;align-items:center;gap:6px;">
          <i class="fas fa-exclamation-triangle"></i>
          <span>Aucune URL iCal configurée</span>
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
              </div>
            </div>
            <div class="property-photo-wrapper">
              ${
                photoUrl
                  ? `<img src="${escapeHtml(
                      photoUrl
                    )}" alt="Photo logement" />`
                  : `<span class="property-photo-placeholder"><i class="fas fa-image"></i></span>`
              }
            </div>
          </div>

          <div class="property-actions">
            <button
              type="button"
              class="btn-icon-action btn-edit"
              onclick="openEditPropertyModal('${id}')"
            >
              <i class="fas fa-pen"></i>
            </button>
            <button
              type="button"
              class="btn-icon-action btn-delete"
              onclick="deleteProperty('${id}')"
            >
              <i class="fas fa-trash"></i>
            </button>
          </div>

          <div class="ical-urls">
            ${icalListHtml}
          </div>
        </div>
      `;
    })
    .join("");

  grid.innerHTML = html;
}
