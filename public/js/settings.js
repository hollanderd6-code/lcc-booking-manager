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
  await loadProperties();

  console.log("✅ Paramètres initialisés");
});

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
    properties = data.properties || [];
    renderProperties();

    console.log(`📦 ${properties.length} logement(s) chargé(s)`);
  } catch (error) {
    console.error("Erreur chargement logements:", error);
    showToast("Erreur lors du chargement des logements", "error");
  } finally {
    hideLoading();
  }
}

async function saveProperty(event) {
  event.preventDefault();
  showLoading();

  const propertyId = document.getElementById("propertyId").value;
  const name = document.getElementById("propertyName").value;
  const color = document.getElementById("propertyColor").value;

  const urlInputs = document.querySelectorAll(".url-input");
  const icalUrls = Array.from(urlInputs)
    .map((input) => input.value.trim())
    .filter((url) => url.length > 0);

  const propertyData = { name, color, icalUrls };

  try {
    const token = localStorage.getItem("lcc_token");
    let response;

    if (propertyId) {
      response = await fetch(`${API_URL}/api/properties/${propertyId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(propertyData),
      });
    } else {
      response = await fetch(`${API_URL}/api/properties`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(propertyData),
      });
    }

    const result = await response.json();

    if (response.ok) {
      showToast(result.message || "Logement enregistré", "success");
      closeEditModal();
      await loadProperties();
    } else {
      showToast(result.error || "Erreur lors de l'enregistrement", "error");
    }
  } catch (error) {
    console.error("Erreur sauvegarde:", error);
    showToast("Erreur lors de l'enregistrement", "error");
  } finally {
    hideLoading();
  }
}

async function deleteProperty(propertyId, propertyName) {
  if (
    !confirm(
      `Êtes-vous sûr de vouloir supprimer "${propertyName}" ?\n\nToutes les réservations associées seront également supprimées.`
    )
  ) {
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

    const result = await response.json();

    if (response.ok) {
      showToast(result.message || "Logement supprimé", "success");
      await loadProperties();
    } else {
      showToast(result.error || "Erreur lors de la suppression", "error");
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
  buttonElement.innerHTML =
    '<i class="fas fa-spinner fa-spin"></i> Test...';
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

    const resultDiv = document.createElement("div");
    resultDiv.className = `test-result ${
      result.success ? "success" : "error"
    }`;

    if (result.success) {
      resultDiv.innerHTML = `
        <i class="fas fa-check-circle"></i>
        URL valide ! ${result.reservationCount} réservation(s) trouvée(s)
      `;
    } else {
      resultDiv.innerHTML = `
        <i class="fas fa-exclamation-circle"></i>
        ${result.error || "URL invalide"}
      `;
    }

    const parent = buttonElement.parentElement;
    const existingResult = parent.querySelector(".test-result");
    if (existingResult) existingResult.remove();
    parent.appendChild(resultDiv);

    setTimeout(() => resultDiv.remove(), 5000);
  } catch (error) {
    console.error("Erreur test URL:", error);
    showToast("Erreur lors du test de l'URL", "error");
  } finally {
    buttonElement.innerHTML = originalText;
    buttonElement.disabled = false;
  }
}

// ========================================
// UI RENDERING
// ========================================

function renderProperties() {
  const grid = document.getElementById("propertiesGrid");

  if (!properties.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-home"></i>
        <p>Aucun logement configuré</p>
        <p style="font-size: 14px; margin-top: 8px;">Cliquez sur "Ajouter un logement" pour commencer</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = properties
    .map(
      (property) => `
    <div class="property-card" style="border-left-color: ${
      property.color
    }">
      <div class="property-header">
        <div class="property-info">
          <div class="property-name">
            <div class="color-badge" style="background-color: ${
              property.color
            }"></div>
            ${property.name}
          </div>
          <div class="property-meta">
            ${property.reservationCount || 0} réservation(s) • 
            ${property.icalUrls.length} source(s) iCal
          </div>
        </div>
        <div class="property-actions">
          <button class="btn-icon-action btn-edit" 
                  onclick="openEditPropertyModal('${property.id}')"
                  title="Modifier">
            <i class="fas fa-edit"></i>
          </button>
          <button class="btn-icon-action btn-delete" 
                  onclick="deleteProperty('${property.id}', '${property.name.replace(
                    /'/g,
                    "\\'"
                  )}')"
                  title="Supprimer">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
      
      ${
        property.icalUrls.length > 0
          ? `
        <div class="ical-urls">
          ${property.icalUrls
            .map(
              (urlData) => `
            <div class="ical-url-item">
              <i class="fas fa-link"></i>
              <span class="ical-source">${urlData.source || "URL"}</span>
              <span class="ical-url-text" title="${urlData.url}">${urlData.url}</span>
            </div>
          `
            )
            .join("")}
        </div>
      `
          : `
        <div style="padding: 12px; background: var(--bg-secondary); border-radius: var(--radius-sm); text-align: center; color: var(--text-secondary); font-size: 14px;">
          <i class="fas fa-exclamation-triangle"></i>
          Aucune URL iCal configurée
        </div>
      `
      }
    </div>
  `
    )
    .join("");
}

// ========================================
// MODAL MANAGEMENT
// ========================================

function openAddPropertyModal() {
  currentEditingProperty = null;

  document.getElementById("modalTitle").textContent =
    "Ajouter un logement";
  document.getElementById("propertyId").value = "";
  document.getElementById("propertyName").value = "";
  document.getElementById("propertyColor").value = "#E67E50";
  document.getElementById("colorPreview").textContent = "#E67E50";

  const urlList = document.getElementById("urlList");
  urlList.innerHTML = "";
  addUrlField();

  document
    .getElementById("editPropertyModal")
    .classList.add("active");
}

function openEditPropertyModal(propertyId) {
  const property = properties.find((p) => p.id === propertyId);
  if (!property) return;

  currentEditingProperty = property;

  document.getElementById("modalTitle").textContent =
    "Modifier le logement";
  document.getElementById("propertyId").value = property.id;
  document.getElementById("propertyName").value = property.name;
  document.getElementById("propertyColor").value = property.color;
  document.getElementById("colorPreview").textContent = property.color;

  const urlList = document.getElementById("urlList");
  urlList.innerHTML = "";

  (property.icalUrls || []).forEach((urlData) => {
    addUrlField(urlData.url);
  });

  if (!property.icalUrls || property.icalUrls.length === 0) {
    addUrlField();
  }

  document
    .getElementById("editPropertyModal")
    .classList.add("active");
}

function closeEditModal() {
  document
    .getElementById("editPropertyModal")
    .classList.remove("active");
  currentEditingProperty = null;
}

function setupColorPicker() {
  const colorPicker = document.getElementById("propertyColor");
  const colorPreview = document.getElementById("colorPreview");

  colorPicker.addEventListener("input", (e) => {
    colorPreview.textContent = e.target.value.toUpperCase();
    colorPreview.style.color = e.target.value;
  });
}

function addUrlField(value = "") {
  const urlList = document.getElementById("urlList");

  const urlGroup = document.createElement("div");
  urlGroup.className = "url-input-group";
  urlGroup.innerHTML = `
    <input type="url" 
           class="url-input" 
           placeholder="https://www.airbnb.fr/calendar/ical/..." 
           value="${value}">
    <button type="button" 
            class="btn-test-url" 
            onclick="testIcalUrl(this.previousElementSibling.value, this)"
            title="Tester l'URL">
      <i class="fas fa-check"></i> Tester
    </button>
    <button type="button" class="btn-remove-url" onclick="removeUrlField(this)">
      <i class="fas fa-times"></i>
    </button>
  `;

  urlList.appendChild(urlGroup);
}

function removeUrlField(button) {
  const urlGroup = button.parentElement;
  const urlList = document.getElementById("urlList");

  if (urlList.children.length > 1) {
    urlGroup.remove();
  } else {
    showToast("Vous devez avoir au moins un champ URL", "error");
  }
}

// ========================================
// UTILITIES
// ========================================

function showLoading() {
  document
    .getElementById("loadingOverlay")
    .classList.add("active");
}

function hideLoading() {
  document
    .getElementById("loadingOverlay")
    .classList.remove("active");
}

function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const icons = {
    success: "fa-check-circle",
    error: "fa-exclamation-circle",
    info: "fa-info-circle",
  };

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <i class="fas ${icons[type]}"></i>
    <span>${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation =
      "slideInRight 0.3s ease reverse";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Close modal on backdrop click
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal")) {
    e.target.classList.remove("active");
  }
});

// ESC to close modals
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document
      .querySelectorAll(".modal.active")
      .forEach((modal) =>
        modal.classList.remove("active")
      );
  }
});
