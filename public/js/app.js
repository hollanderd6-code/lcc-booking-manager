// ========================================
// PLATFORM APP - MODERN BOOKING MANAGER
// ========================================

// CONFIG
const API_URL = "https://lcc-booking-manager.onrender.com";

let calendar = null;
let allReservations = [];
let activeFilters = new Set();

// ========================================
// INITIALIZATION
// ========================================
document.addEventListener("DOMContentLoaded", async () => {
  console.log("🚀 Platform initializing...");

  initializeTheme();
  initializeCalendar();
  setupEventListeners();

  await loadReservations();

  console.log("✅ Platform ready");
});

// ========================================
// THEME MANAGEMENT
// ========================================
function initializeTheme() {
  const savedTheme = localStorage.getItem("theme") || "light";
  document.documentElement.setAttribute("data-theme", savedTheme);
  updateThemeIcon(savedTheme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute("data-theme");
  const newTheme = currentTheme === "light" ? "dark" : "light";

  document.documentElement.setAttribute("data-theme", newTheme);
  localStorage.setItem("theme", newTheme);

  updateThemeIcon(newTheme);

  if (calendar) calendar.render();
}

function updateThemeIcon(theme) {
  const icon = document.querySelector("#themeToggle i");
  if (!icon) return;
  icon.className = theme === "light" ? "fas fa-moon" : "fas fa-sun";
}

// ========================================
// EVENT LISTENERS
// ========================================
function setupEventListeners() {
  const themeToggle = document.getElementById("themeToggle");
  if (themeToggle) themeToggle.addEventListener("click", toggleTheme);

  const syncBtn = document.getElementById("syncBtn");
  if (syncBtn) syncBtn.addEventListener("click", syncReservations);

  document.querySelectorAll(".view-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const view = e.currentTarget.dataset.view;
      changeCalendarView(view);

      document.querySelectorAll(".view-btn").forEach((b) =>
        b.classList.remove("active")
      );
      e.currentTarget.classList.add("active");
    });
  });

  const modalClose = document.getElementById("modalClose");
  if (modalClose) {
    modalClose.addEventListener("click", () => {
      document.getElementById("reservationModal").classList.remove("active");
    });
  }

  const modal = document.getElementById("reservationModal");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.classList.remove("active");
    });
  }
}

// ========================================
// CALENDAR
// ========================================
function initializeCalendar() {
  const calendarEl = document.getElementById("calendar");
  if (!calendarEl) return;

  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: "dayGridMonth",
    locale: "fr",
    headerToolbar: {
      left: "prev,next today",
      center: "title",
      right: "",
    },
    height: "auto",
    eventClick(info) {
      showReservationModal(info.event.extendedProps.reservation);
    },
    events: [],
  });

  calendar.render();
}

function changeCalendarView(view) {
  if (!calendar) return;

  const viewMap = {
    month: "dayGridMonth",
    week: "timeGridWeek",
    list: "listMonth",
  };

  calendar.changeView(viewMap[view] || "dayGridMonth");
}

function updateCalendarEvents() {
  if (!calendar) return;

  const events = allReservations
    .filter(
      (r) => activeFilters.size === 0 || activeFilters.has(r.property.id)
    )
    .map((r) => ({
      title: `${r.property.name} - ${r.guestName}`,
      start: r.start,
      end: r.end,
      backgroundColor: r.property.color,
      borderColor: r.property.color,
      extendedProps: { reservation: r },
    }));

  calendar.removeAllEvents();
  calendar.addEventSource(events);
}

// ========================================
// LOAD RESERVATIONS
// ========================================
async function loadReservations() {
  showLoading();

  try {
    const token = localStorage.getItem("lcc_token");

    const response = await fetch(`${API_URL}/api/reservations`, {
      headers: {
        Authorization: "Bearer " + token,
      },
    });

    const data = await response.json();

    allReservations = data.reservations || [];
    window.LCC_RESERVATIONS = allReservations;

    updateOverviewFromReservations(allReservations);
    updateStats(data);
    renderPropertyFilters(data.properties || []);

    updateCalendarEvents();

    console.log(`📦 ${allReservations.length} réservations chargées`);
  } catch (error) {
    console.error("Erreur chargement réservations:", error);
    showToast("Erreur lors du chargement des réservations", "error");
  } finally {
    hideLoading();
  }
}

async function syncReservations() {
  const syncBtn = document.getElementById("syncBtn");
  const icon = syncBtn ? syncBtn.querySelector("i") : null;

  if (icon) icon.classList.add("fa-spin");
  if (syncBtn) syncBtn.disabled = true;

  try {
    const token = localStorage.getItem("lcc_token");

    const response = await fetch(`${API_URL}/api/sync`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
      },
    });

    const data = await response.json();
    console.log("Sync result:", data);

    if (!response.ok) {
      showToast("Erreur lors de la synchronisation", "error");
    } else {
      showToast("Synchronisation réussie", "success");
      await loadReservations();
    }
  } catch (err) {
    showToast("Erreur lors de la synchronisation", "error");
  } finally {
    if (icon) icon.classList.remove("fa-spin");
    if (syncBtn) syncBtn.disabled = false;
  }
}

// ========================================
// UI: STATS, FILTERS, MODAL, ETC.
// ========================================
function updateStats(data) {
  document.getElementById("statTotal").textContent =
    data.reservations.length;

  const now = new Date();
  const upcoming = data.reservations.filter(
    (r) => new Date(r.start) > now
  ).length;
  const current = data.reservations.filter(
    (r) => new Date(r.start) <= now && new Date(r.end) >= now
  ).length;

  document.getElementById("statUpcoming").textContent = upcoming;
  document.getElementById("statCurrent").textContent = current;

  const navBadge = document.getElementById("navTotalReservations");
  if (navBadge) navBadge.textContent = data.reservations.length;
}

function renderPropertyFilters(properties) {
  const container = document.getElementById("propertyFilters");
  if (!container) return;

  container.innerHTML = properties
    .map(
      (p) => `
    <div class="property-badge" 
         style="border-color:${p.color};color:${p.color}"
         data-property-id="${p.id}"
         onclick="togglePropertyFilter('${p.id}')">
      <i class="fas fa-home"></i>
      <span>${p.name}</span>
      <span class="property-count">${p.count || 0}</span>
    </div>`
    )
    .join("");
}

function togglePropertyFilter(propertyId) {
  if (activeFilters.has(propertyId)) activeFilters.delete(propertyId);
  else activeFilters.add(propertyId);

  const badge = document.querySelector(`[data-property-id="${propertyId}"]`);
  if (badge) badge.classList.toggle("active");

  updateCalendarEvents();
}

function clearFilters() {
  activeFilters.clear();
  document
    .querySelectorAll(".property-badge")
    .forEach((b) => b.classList.remove("active"));

  updateCalendarEvents();
}

// ========================================
// MODAL RESERVATION
// ========================================
function showReservationModal(reservation) {
  const modal = document.getElementById("reservationModal");
  const body = document.getElementById("modalBody");

  const checkin = new Date(reservation.start);
  const checkout = new Date(reservation.end);

  body.innerHTML = `
    <div>
      <h2>${reservation.property.name}</h2>
      <p>Voyageur : <strong>${reservation.guestName}</strong></p>
      <p>Arrivée : ${checkin.toLocaleDateString("fr-FR")}</p>
      <p>Départ : ${checkout.toLocaleDateString("fr-FR")}</p>
    </div>
  `;

  modal.classList.add("active");
}

// ========================================
// UTILITIES
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
    <span class="toast-message">${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = "slideInRight 0.3s reverse";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function openDepositsPage() {
  window.location.href = "/deposits.html";
}

function goToMessages() {
  window.location.href = "/messages.html";
}

// ========================================
// MOBILE MENU (TODO)
// ========================================
