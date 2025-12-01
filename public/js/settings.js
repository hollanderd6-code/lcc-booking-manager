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
      <div class="no-properties">
        Aucun logement configuré<br>
        Cliquez sur "Ajouter un logement" pour commencer
      </div>
    `;
    return;
  }

  const baseApi = (typeof API_URL === "string" ? API_URL.replace(/\/$/, "") : "");
  grid.innerHTML = properties.map((property) => {
    const exportUrl = baseApi ? `${baseApi}/ical/property/${property.id}.ics` : `/ical/property/${property.id}.ics`;

    const icalSourcesHtml = property.icalUrls && property.icalUrls.length > 0
      ? property.icalUrls.map((urlData) => 
          `<div>${urlData.source || "URL"} : ${urlData.url}</div>`
        ).join("")
      : `<div>Aucune URL iCal configurée</div>`;

    return `
      <div class="property-card">
        <h3>${property.name}</h3>
        <p>Adresse : ${property.address || "Non spécifiée"}</p>
        <p>Couleur : <span style="color: ${property.color}">${property.color}</span></p>
        <p>Heure d'arrivée : ${property.checkIn || "Non spécifiée"}</p>
        <p>Heure de départ : ${property.checkOut || "Non spécifiée"}</p>
        <p>Caution : ${property.deposit || "0"} €</p>
        <p>${property.reservationCount || 0} réservation(s) • ${(property.icalUrls && property.icalUrls.length) || 0} source(s) iCal importées</p>
        <div class="property-actions">
          <button onclick="openEditPropertyModal('${property.id}')" title="Modifier">Modifier</button>
          <button onclick="deleteProperty('${property.id}', '${(property.name || "").replace(/'/g, "\'")}')" title="Supprimer">Supprimer</button>
        </div>
        <div class="ical-export">
          Lien iCal Boostinghost pour ce logement :
          <a href="#" onclick="copyIcalExportUrl('${exportUrl}')">Copier</a>
        </div>
        <div class="ical-sources">${icalSourcesHtml}</div>
      </div>
    `;
  }).join("");
}
