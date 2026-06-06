// cleaning-reorder.js — Extracted from app.html
// ═══════════════════════════════════════════════════════
// RÉORGANISATION DES LOGEMENTS SUR LE CALENDRIER
// ═══════════════════════════════════════════════════════

const STORAGE_KEY = 'LCC_PROPERTY_ORDER';

// ── Charger l'ordre depuis la DB au démarrage ──
(async function loadOrderFromDB() {
  try {
    const token = localStorage.getItem('lcc_token');
    if (!token) return;
    const res = await fetch((window.API_URL || '') + '/api/properties/reorder-bulk', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data.order) && data.order.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data.order));
      console.log('✅ Ordre logements restauré depuis DB');
    }
  } catch(e) { /* ignore */ }
})();

// Récupère l\'ordre sauvegardé [id, id, id, ...]
function getSavedOrder() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
  catch(e) { return null; }
}

// Applique l\'ordre sauvegardé à un tableau de propriétés
function applyPropertyOrder(props) {
  const order = getSavedOrder();
  if (!order || !order.length) return props;
  const ordered = [];
  // D\'abord les props dans l\'ordre sauvegardé
  order.forEach(id => {
    const p = props.find(x => String(x.id) === String(id));
    if (p) ordered.push(p);
  });
  // Puis les nouvelles props pas encore dans l\'ordre (ajoutées après)
  props.forEach(p => {
    if (!ordered.find(x => String(x.id) === String(p.id))) ordered.push(p);
  });
  return ordered;
}

// Intercepte renderModernCalendar pour injecter l'ordre AVANT le rendu.
// Important performance : on ne re-render plus la grille après coup et on ne déplace plus le DOM
// pendant/après le scroll. Ça évite les saccades sur mobile.
(function() {
  const _orig = window.renderModernCalendar;
  if (typeof _orig !== 'function') return;

  window.renderModernCalendar = function(reservations, properties) {
    const orderedProperties = Array.isArray(properties)
      ? applyPropertyOrder(properties)
      : properties;

    return _orig.call(this, reservations, orderedProperties);
  };
})();

// Réapplique l\'ordre sauvegardé aux DOM rows du calendrier + property list
let _reapplying = false;
function reapplyOrderToDOM() {
  if (_reapplying) return;
  const order = getSavedOrder();
  if (!order || !order.length) return;

  const grid = document.getElementById('calendarGrid');
  const list = document.getElementById('propertyList');
  if (!grid || !list) return;

  _reapplying = true;
  // Déconnecter l'observer pour éviter la boucle infinie pendant le tri
  if (typeof _reorderObserver !== 'undefined' && _reorderObserver) _reorderObserver.disconnect();

  // Réordonner les rows du calendrier
  const rows = Array.from(grid.querySelectorAll('.calendar-row[data-property-id]'));
  if (rows.length > 0) {
    const ordered = [];
    order.forEach(id => {
      const r = rows.find(x => x.getAttribute('data-property-id') === String(id));
      if (r) ordered.push(r);
    });
    rows.forEach(r => { if (!ordered.includes(r)) ordered.push(r); });
    ordered.forEach(r => grid.appendChild(r));
  }

  // Réordonner la liste des logements
  const items = Array.from(list.querySelectorAll('.property-item[data-property-id]'));
  if (items.length > 0) {
    const ordered = [];
    order.forEach(id => {
      const item = items.find(x => x.getAttribute('data-property-id') === String(id));
      if (item) ordered.push(item);
    });
    items.forEach(item => { if (!ordered.includes(item)) ordered.push(item); });
    ordered.forEach(item => list.appendChild(item));
  }

  _reapplying = false;

  // Reconnecter l'observer après le tri
  if (typeof _reorderObserver !== 'undefined' && _reorderObserver) {
    const grid2 = document.getElementById('calendarGrid');
    const list2 = document.getElementById('propertyList');
    if (grid2) _reorderObserver.observe(grid2, { childList: true });
    if (list2) _reorderObserver.observe(list2, { childList: true });
  }
}

// ── MODAL ──────────────────────────────────────────────

function openReorderModal() {
  const reorderList = document.getElementById('reorderList');
  if (!reorderList) return;

  // Source: calendarState.properties ou DOM fallback
  var props = [];
  if (window.calendarState && window.calendarState.properties && window.calendarState.properties.length) {
    props = window.calendarState.properties;
  } else {
    const domList = document.getElementById('propertyList');
    if (domList) {
      Array.from(domList.querySelectorAll('.property-item[data-property-id]')).forEach(function(item) {
        props.push({ id: item.getAttribute('data-property-id'), name: (item.querySelector('.property-name') || item).textContent.trim() });
      });
    }
  }

  reorderList.innerHTML = '';
  const isMobile = window.innerWidth < 768 || ('ontouchstart' in window);
  props.forEach(function(prop) {
    const row = document.createElement('div');
    row.setAttribute('data-id', String(prop.id));
    if (!isMobile) row.setAttribute('draggable', 'true');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 12px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;' + (!isMobile ? 'cursor:grab;' : '') + 'user-select:none;transition:all .15s;';
    row.innerHTML = '<i class="fas fa-grip-vertical" style="color:' + (isMobile ? '#d1d5db' : '#9CA3AF') + ';font-size:14px;flex-shrink:0;"></i>'
      + '<span style="flex:1;font-size:14px;font-weight:600;color:#111827;">' + (prop.name || String(prop.id)) + '</span>'
      + '<div style="display:flex;gap:6px;">'
      + '<button ontouchstart="" onclick="moveReorderItem(this.closest(\'[data-id]\'),-1)" style="width:44px;height:44px;background:white;border:1.5px solid #e5e7eb;border-radius:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#374151;font-size:18px;-webkit-tap-highlight-color:transparent;touch-action:manipulation;"><i class="fas fa-chevron-up"></i></button>'
      + '<button ontouchstart="" onclick="moveReorderItem(this.closest(\'[data-id]\'),1)" style="width:44px;height:44px;background:white;border:1.5px solid #e5e7eb;border-radius:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#374151;font-size:18px;-webkit-tap-highlight-color:transparent;touch-action:manipulation;"><i class="fas fa-chevron-down"></i></button>'
      + '</div>';
    if (!isMobile) {
      row.addEventListener('dragstart', onDragStart);
      row.addEventListener('dragover', onDragOver);
      row.addEventListener('drop', onDrop);
      row.addEventListener('dragend', onDragEnd);
    }
    row.addEventListener('mouseenter', function(){ this.style.background='#f3f4f6'; this.style.borderColor='#1A7A5E'; });
    row.addEventListener('mouseleave', function(){ this.style.background='#f9fafb'; this.style.borderColor='#e5e7eb'; });
    reorderList.appendChild(row);
  });

  const modal = document.getElementById('reorderModal');
  modal.style.display = 'flex';
  // Bloquer le scroll du body (iOS)
  document.body.style.overflow = 'hidden';
  document.body.style.position = 'fixed';
  document.body.style.width = '100%';
}

function closeReorderModal() {
  document.getElementById('reorderModal').style.display = 'none';
  // Restaurer le scroll du body
  document.body.style.overflow = '';
  document.body.style.position = '';
  document.body.style.width = '';
}

// Touch drag for mobile reorder
function addTouchDrag(row) {
  var startY = 0, startX = 0, startIdx = 0, dragging = false, dragActivated = false, list = null;
  var DRAG_THRESHOLD = 8; // pixels avant d'activer le drag (évite de bloquer le scroll)

  row.addEventListener('touchstart', function(e) {
    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
    e.stopPropagation();
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    list = row.parentElement;
    var items = Array.from(list.children);
    startIdx = items.indexOf(row);
    dragging = true;
    dragActivated = false;
  }, { passive: true });

  row.addEventListener('touchmove', function(e) {
    if (!dragging) return;
    var y = e.touches[0].clientY;
    var x = e.touches[0].clientX;
    var dy = y - startY;
    var dx = x - startX;

    // Activer le drag seulement si mouvement vertical > seuil ET plus vertical qu'horizontal
    if (!dragActivated) {
      if (Math.abs(dy) > DRAG_THRESHOLD && Math.abs(dy) > Math.abs(dx)) {
        dragActivated = true;
        row.style.opacity = '0.5';
        row.style.boxShadow = '0 4px 12px rgba(0,0,0,.2)';
      } else {
        // Pas encore de drag : laisser le scroll natif fonctionner
        return;
      }
    }

    // Drag activé : bloquer le scroll et déplacer l'item
    e.preventDefault();
    var items = Array.from(list.children);
    var rowH = row.offsetHeight + 6;
    var moveSteps = Math.round(dy / rowH);
    var curIdx = items.indexOf(row);
    var targetIdx = Math.max(0, Math.min(items.length - 1, startIdx + moveSteps));
    if (targetIdx !== curIdx) {
      if (targetIdx > curIdx) list.insertBefore(items[targetIdx], row);
      else list.insertBefore(row, items[targetIdx]);
    }
  }, { passive: false });

  row.addEventListener('touchend', function(e) {
    if (!dragging) return;
    dragging = false;
    dragActivated = false;
    row.style.opacity = '1';
    row.style.boxShadow = '';
  }, { passive: true });
}

function moveReorderItem(el, dir) {
  const list = el.parentElement;
  if (!list) return;
  const items = Array.from(list.children);
  const idx = items.indexOf(el);
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= items.length) return;
  if (dir === -1) list.insertBefore(el, items[newIdx]);
  else list.insertBefore(items[newIdx], el);
}

function savePropertyOrder() {
  const reorderList = document.getElementById('reorderList');
  const items = Array.from(reorderList.querySelectorAll('[data-id]'));
  const order = items.map(x => x.getAttribute('data-id'));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(order));

  // ── Sauvegarder en DB pour persistance entre mises à jour ──
  const token = localStorage.getItem('lcc_token');
  if (token) {
    fetch((window.API_URL || '') + '/api/properties/reorder-bulk', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ order })
    }).then(r => {
      if (!r.ok) console.warn('⚠️ Sauvegarde ordre DB échouée:', r.status);
      else console.log('✅ Ordre logements sauvegardé en DB');
    }).catch(e => console.warn('⚠️ Erreur sauvegarde ordre:', e.message));
  }

  closeReorderModal();

  // Réappliquer l'ordre sur calendarState.properties et re-render
  if (window.calendarState && window.calendarState.properties && window.calendarState.properties.length) {
    var props = window.calendarState.properties;
    var ordered = [];
    order.forEach(function(id) {
      var p = props.find(function(x){ return String(x.id)===String(id); });
      if (p) ordered.push(p);
    });
    props.forEach(function(p) {
      if (!ordered.find(function(x){ return String(x.id)===String(p.id); })) ordered.push(p);
    });
    window.calendarState.properties = ordered;
    if (typeof window.__bhCalendarRender === 'function') window.__bhCalendarRender();
    else if (window.__bhCalendarState && typeof window.render === 'function') window.render();
  } else {
    _reapplying = false;
    reapplyOrderToDOM();
  }

  // Toast de confirmation
  var toast = document.createElement('div');
  toast.textContent = '✓ Ordre des logements sauvegardé';
  toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#1A7A5E;color:white;padding:10px 20px;border-radius:12px;font-size:13px;font-weight:600;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,.2);transition:opacity .4s;';
  document.body.appendChild(toast);
  setTimeout(function(){ toast.style.opacity='0'; setTimeout(function(){ toast.remove(); }, 400); }, 2000);
}

function resetPropertyOrder() {
  localStorage.removeItem(STORAGE_KEY);
  closeReorderModal();
  // Recharge le calendrier pour remettre l\'ordre d\'origine
  if (typeof window.loadData === 'function') window.loadData();
  else window.location.reload();
}

// ── DRAG & DROP ────────────────────────────────────────
let _dragSrc = null;

function onDragStart(e) {
  _dragSrc = this;
  this.style.opacity = '.5';
  e.dataTransfer.effectAllowed = 'move';
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  this.style.borderColor = '#1A7A5E';
  return false;
}

function onDrop(e) {
  e.stopPropagation();
  if (_dragSrc !== this) {
    const list = this.parentElement;
    const items = Array.from(list.children);
    const srcIdx = items.indexOf(_dragSrc);
    const tgtIdx = items.indexOf(this);
    if (srcIdx < tgtIdx) list.insertBefore(_dragSrc, this.nextSibling);
    else list.insertBefore(_dragSrc, this);
  }
  return false;
}

function onDragEnd() {
  this.style.opacity = '1';
  document.querySelectorAll('#reorderList [data-id]').forEach(function(el) {
    el.style.borderColor = 'var(--border-color,#e5e7eb)';
  });
  _dragSrc = null;
}

// Close on backdrop click
document.getElementById('reorderModal').addEventListener('click', function(e) {
  if (e.target === this) closeReorderModal();
});

// Bloquer le scroll de l'arrière-plan iOS sur le modal
document.getElementById('reorderModal').addEventListener('touchmove', function(e) {
  e.stopPropagation();
}, { passive: true });

// Permettre le scroll dans la liste uniquement
document.getElementById('reorderList').addEventListener('touchmove', function(e) {
  e.stopPropagation();
}, { passive: true });

// L'ordre est appliqué avant le rendu via renderModernCalendar.
// On évite les setTimeout(reapplyOrderToDOM) automatiques qui pouvaient provoquer un lag pendant le swipe.
