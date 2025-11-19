// ========================================
// CONFIGURATION
// ========================================
const API_URL = "https://lcc-booking-manager.onrender.com";
let properties = [];
let currentEditingProperty = null;

// ========================================
// INITIALISATION
// ========================================
document.addEventListener("DOMContentLoaded", async () => {
  console.log("🔧 Paramètres - Initialisation...");

  setupColorPicker();
  await loadProperties();

  console.log("✅ Paramètres chargés");
});

// ========================================
// CHARGEMENT DES LOGEMENTS
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
  } catch (err) {
    console.error("Erreur chargement propriétés:", err);
    showToast("Erreur lors du chargement des logements", "error");
  } finally {
    hideLoading();
  }
}

// ========================================
// ENREGISTRER LOGEMENT
// ========================================
async function saveProperty(event) {
  event.preventDefault();
  showLoading();

  const token = localStorage.getItem("lcc_token");

  const propertyId = document.getElementById("propertyId").value;
  const name = document.getElementById("propertyName").value;
  const color = document.getElementById("propertyColor").value;

  // Récupérer les URLs
  const urlInputs = document.querySelectorAll(".url-input");
  const icalUrls = Array.from(urlInputs)
    .map((i) => i.value.trim())
    .filter((u) => u.length > 0)
    .map((url) => ({ url })); // 🔥 NORMALISATION FIX

  const propertyData = { name, color, icalUrls };

  try {
    let response;

    if (propertyId) {
      // UPDATE
      response = await fetch(`${API_URL}/api/properties/${propertyId}`, {
        method: "PUT",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(propertyData),
      });
    } else {
      // CREATE
      response = await fetch(`${API_URL}/api/properties`, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(propertyData),
      });
    }

    const result = await response.json();

    if (!response.ok) {
      showToast(result.error || "Erreur lors de l'enregistrement", "error");
      return;
    }

    showToast("Logement enregistré", "success");
    closeEditModal();
    await loadProperties();
  } catch (err) {
    console.error("Erreur sauvegarde propriété:", err);
    showToast("Erreur lors de l'enregistrement", "error");
  } finally {
    hideLoading();
  }
}

// ========================================
// DELETE LOGEMENT
// ========================================
async function deleteProperty(id, name) {
  if (!confirm(`Supprimer le logement "${name}" ?`)) return;

  showLoading();

  try {
    const token = localStorage.getItem("lcc_token");

    const response = await fetch(`${API_URL}/api/properties/${id}`, {
      method: "DELETE",
      headers: {
        Authorization: "Bearer " + token,
      },
    });

    const result = await response.json();

    if (!response.ok) {
      showToast(result.error || "Erreur lors de la suppression", "error");
      return;
    }

    showToast("Logement supprimé", "success");
    loadProperties();
  } catch (err) {
    console.error("Erreur suppression logement:", err);
    showToast("Erreur lors de la suppression", "error");
  } finally {
    hideLoading();
  }
}

// ========================================
// TEST ICAL
// ========================================
async function testIcalUrl(url, button) {
  if (!url || url.length === 0) {
    showToast("Veuillez entrer une URL", "error");
    return;
  }

  const token = localStorage.getItem("lcc_token");

  const original = button.innerHTML;
  button.innerHTML = `<i class="fas fa-spinner fa-spin"></i>`;
  button.disabled = true;

  try {
    const response = await fetch(`${API_URL}/api/properties/test-ical`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
    });

    const result = await response.json();

    const div = document.createElement("div");
    div.className = `test-result ${result.success ? "success" : "error"}`;

    if (result.success) {
      div.innerHTML = `<i class="fas fa-check-circle"></i> ${result.reservationCount} réservation(s) trouvée(s)`;
    } else {
      div.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${result.error}`;
    }

    button.parentElement.appendChild(div);
    setTimeout(() => div.remove(), 5000);
  } catch (err) {
    showToast("Erreur lors du test de l'URL", "error");
  } finally {
    button.innerHTML = original;
    button.disabled = false;
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
        Aucun logement configuré
      </div>`;
    return;
  }

  grid.innerHTML = properties
    .map(
      (p) => `
    <div class="property-card" style="border-left-color:${p.color}">
      <div class="property-header">
        <div>
          <div class="property-name">
            <span class="color-badge" style="background:${p.color}"></span>
            ${p.name}
          </div>
          <div class="property-meta">
            ${p.icalUrls.length} URL iCal
          </div>
        </div>

        <div class="property-actions">
          <button onclick="openEditPropertyModal('${p.id}')" class="btn-icon-action">
            <i class="fas fa-edit"></i>
          </button>

          <button onclick="deleteProperty('${p.id}','${p.name.replace(/'/g, "\\'")}')" class="btn-icon-action btn-delete">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>

      <div class="ical-urls">
        ${p.icalUrls
          .map(
            (u) => `
          <div class="ical-url-item">
            <i class="fas fa-link"></i>
            ${u.url}
          </div>`
          )
          .join("")}
      </div>
    </div>`
    )
    .join("");
}

// ========================================
// MODALS
// ========================================
function openAddPropertyModal() {
  currentEditingProperty = null;

  document.getElementById("modalTitle").textContent = "Ajouter un logement";
  document.getElementById("propertyId").value = "";
  document.getElementById("propertyName").value = "";
  document.getElementById("propertyColor").value = "#E67E50";
  document.getElementById("colorPreview").textContent = "#E67E50";

  const list = document.getElementById("urlList");
  list.innerHTML = "";
  addUrlField();

  document.getElementById("editPropertyModal").classList.add("active");
}

function openEditPropertyModal(id) {
  const property = properties.find((p) => p.id === id);
  if (!property) return;

  currentEditingProperty = property;

  document.getElementById("modalTitle").textContent =
    "Modifier le logement";
  document.getElementById("propertyId").value = property.id;
  document.getElementById("propertyName").value = property.name;
  document.getElementById("propertyColor").value = property.color;
  document.getElementById("colorPreview").textContent = property.color;

  const list = document.getElementById("urlList");
  list.innerHTML = "";

  property.icalUrls.forEach((u) => addUrlField(u.url || u));

  document.getElementById("editPropertyModal").classList.add("active");
}

function closeEditModal() {
  document.getElementById("editPropertyModal").classList.remove("active");
}

// ========================================
// URL FIELD MANAGEMENT
// ========================================
function addUrlField(value = "") {
  const list = document.getElementById("urlList");

  const div = document.createElement("div");
  div.className = "url-input-group";
  div.innerHTML = `
    <input class="url-input" type="url" placeholder="https://www.airbnb.fr/calendar/ical/..." value="${value}">
    <button type="button" class="btn-test-url" onclick="testIcalUrl(this.previousElementSibling.value, this)">
      <i class="fas fa-check"></i>
    </button>
    <button type="button" class="btn-remove-url" onclick="removeUrlField(this)">
      <i class="fas fa-times"></i>
    </button>
  `;

  list.appendChild(div);
}

function removeUrlField(btn) {
  const list = document.getElementById("urlList");

  if (list.children.length <= 1) {
    showToast("Vous devez garder au moins une URL", "error");
    return;
  }

  btn.parentElement.remove();
}

// ========================================
// COLOR PICKER
// ========================================
function setupColorPicker() {
  const picker = document.getElementById("propertyColor");
  const preview = document.getElementById("colorPreview");

  picker.addEventListener("input", (e) => {
    preview.textContent = e.target.value.toUpperCase();
    preview.style.color = e.target.value;
  });
}

// ========================================
// LOADING & TOASTS
// ========================================
function showLoading() {
  const overlay = document.getElementById("loadingOverlay");
  if (overlay) overlay.classList.add("active");
}

function hideLoading() {
  const overlay = document.getElementById("loadingOverlay");
  if (overlay) overlay.classList.remove("active");
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
    toast.style.animation = "slideInRight 0.3s ease reverse";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ========================================
// CLOSE MODAL (BACKDROP + ESC)
// ========================================
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal")) {
    e.target.classList.remove("active");
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document
      .querySelectorAll(".modal.active")
      .forEach((m) => m.classList.remove("active"));
  }
});
