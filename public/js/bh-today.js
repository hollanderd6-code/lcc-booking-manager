// ============================================================
// ☀️ MODE AUJOURD'HUI — écran plein écran des mouvements du jour
// Ouvert au tap sur la carte « Votre journée » du dashboard.
// Source : window.LCC_RESERVATIONS (déjà en mémoire), zéro endpoint.
// ============================================================
(function () {
  'use strict';

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function dOnly(v) {
    if (!v) return '';
    var s = String(v);
    if (s.length >= 10 && s[4] === '-') return s.slice(0,10);
    var d = new Date(v); if (isNaN(d)) return '';
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function champ(r, keys, def) {
    for (var i=0;i<keys.length;i++){ if (r[keys[i]]) return r[keys[i]]; }
    return def || '';
  }
  function nomLogement(r) {
    if (r.property && typeof r.property === 'object' && r.property.name) return r.property.name;
    return champ(r, ['propertyName','property_name'], typeof r.property==='string'?r.property:'Logement');
  }
  function esc(t){ return String(t==null?'':t).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

  function collecter() {
    var resas = window.LCC_RESERVATIONS || [];
    var t = todayStr();
    var arr = [], dep = [];
    resas.forEach(function (r) {
      if (r.type === 'block' || r.source === 'BLOCK') return;
      var s = dOnly(r.start || r.startDate || r.checkIn);
      var e = dOnly(r.end || r.endDate || r.checkOut);
      var item = {
        nom: champ(r, ['guestName','guest_display_name','customerName'], 'Voyageur'),
        logement: nomLogement(r),
        tel: champ(r, ['guest_phone','guestPhone'], ''),
        plateforme: String(champ(r, ['source','platform','channel'], 'Direct')),
        conv: champ(r, ['conversationId','conversation_id'], ''),
        heure: ''
      };
      if (s === t) arr.push(item);
      if (e === t) dep.push(item);
    });
    return { arr: arr, dep: dep };
  }

  function ligne(it, type) {
    var actions = '';
    if (it.tel) actions += '<a class="bht-act" href="tel:' + esc(it.tel) + '" onclick="event.stopPropagation()"><i class="fas fa-phone"></i></a>';
    actions += '<a class="bht-act" href="/messages.html' + (it.conv ? '?bhconv=' + encodeURIComponent(it.conv) : '') + '" onclick="event.stopPropagation()"><i class="fas fa-comment"></i></a>';
    var badge = type === 'arr'
      ? '<span class="bht-tag arr"><i class="fas fa-arrow-right-to-bracket"></i> Arrivée</span>'
      : '<span class="bht-tag dep"><i class="fas fa-arrow-right-from-bracket"></i> Départ</span>';
    return '<div class="bht-row">'
      + '<div class="bht-main"><div class="bht-nom">' + esc(it.nom) + '</div>'
      + '<div class="bht-sub">' + esc(it.logement) + ' · ' + esc(it.plateforme) + '</div>' + badge + '</div>'
      + '<div class="bht-acts">' + actions + '</div></div>';
  }

  window.bhOpenToday = function () {
    if (document.getElementById('bh-today-screen')) return;
    var data = collecter();
    var d = new Date();
    var dateLbl = d.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' });

    var sc = document.createElement('div');
    sc.id = 'bh-today-screen';
    var arrHtml = data.arr.length ? data.arr.map(function(i){return ligne(i,'arr');}).join('')
      : '<div class="bht-vide">Aucune arrivée aujourd\'hui</div>';
    var depHtml = data.dep.length ? data.dep.map(function(i){return ligne(i,'dep');}).join('')
      : '<div class="bht-vide">Aucun départ aujourd\'hui</div>';

    sc.innerHTML =
      '<div class="bht-head">'
      + '<div><div class="bht-eyebrow">Votre journée</div><h1>' + dateLbl.charAt(0).toUpperCase()+dateLbl.slice(1) + '</h1></div>'
      + '<button class="bht-close" aria-label="Fermer"><i class="fas fa-times"></i></button></div>'
      + '<div class="bht-body">'
      + '<div class="bht-sect"><div class="bht-sect-t"><i class="fas fa-arrow-right-to-bracket"></i> Arrivées <span>' + data.arr.length + '</span></div>' + arrHtml + '</div>'
      + '<div class="bht-sect"><div class="bht-sect-t"><i class="fas fa-arrow-right-from-bracket"></i> Départs <span>' + data.dep.length + '</span></div>' + depHtml + '</div>'
      + '</div>';
    document.body.appendChild(sc);
    requestAnimationFrame(function(){ sc.classList.add('open'); });

    var fermer = function () {
      sc.classList.remove('open');
      setTimeout(function(){ sc.remove(); }, 240);
      document.removeEventListener('keydown', onKey);
    };
    var onKey = function(e){ if (e.key === 'Escape') fermer(); };
    document.addEventListener('keydown', onKey);
    sc.querySelector('.bht-close').addEventListener('click', fermer);
  };

  // Styles
  var st = document.createElement('style');
  st.textContent = [
    '#bh-today-screen{position:fixed;inset:0;z-index:100004;background:#F4F1E9;',
    '  transform:translateY(100%);transition:transform .28s cubic-bezier(.22,1,.36,1);',
    '  display:flex;flex-direction:column;overflow:hidden;}',
    '#bh-today-screen.open{transform:translateY(0);}',
    '.bht-head{display:flex;align-items:flex-start;justify-content:space-between;',
    '  padding:calc(env(safe-area-inset-top,0px) + 20px) 20px 16px;}',
    '.bht-eyebrow{font:700 11px/1 "DM Sans",sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#B7791F;margin-bottom:8px;}',
    '.bht-head h1{font-family:"Instrument Serif",Georgia,serif;font-weight:400;font-size:28px;color:#0D1117;margin:0;}',
    '.bht-close{flex:none;width:40px;height:40px;border-radius:50%;border:1px solid rgba(200,184,154,.5);',
    '  background:#FBF8F3;color:#6B7280;font-size:16px;cursor:pointer;}',
    '.bht-close:active{scale:.92;}',
    '.bht-body{flex:1;overflow-y:auto;padding:4px 16px calc(env(safe-area-inset-bottom,0px) + 24px);-webkit-overflow-scrolling:touch;}',
    '.bht-sect{margin-bottom:22px;}',
    '.bht-sect-t{display:flex;align-items:center;gap:9px;font:700 12px/1 "DM Sans",sans-serif;letter-spacing:.05em;',
    '  text-transform:uppercase;color:#7A8695;padding:6px 6px 12px;}',
    '.bht-sect-t i{color:#1A7A5E;}',
    '.bht-sect-t span{margin-left:auto;background:#EAF3EF;color:#166B52;border-radius:99px;padding:2px 9px;font-size:12px;}',
    '.bht-row{display:flex;align-items:center;gap:12px;background:#fff;border:1px solid rgba(200,184,154,.4);',
    '  border-radius:16px;padding:14px 15px;margin-bottom:10px;box-shadow:0 1px 3px rgba(13,17,23,.04);}',
    '.bht-main{flex:1;min-width:0;}',
    '.bht-nom{font:600 15px "DM Sans",sans-serif;color:#0D1117;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.bht-sub{font:400 12.5px "DM Sans",sans-serif;color:#7A8695;margin:2px 0 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.bht-tag{display:inline-flex;align-items:center;gap:5px;font:600 10.5px "DM Sans",sans-serif;',
    '  padding:3px 9px;border-radius:99px;}',
    '.bht-tag.arr{background:#EAF3EF;color:#166B52;} .bht-tag.dep{background:#FBF3E2;color:#9A6514;}',
    '.bht-acts{display:flex;gap:8px;flex:none;}',
    '.bht-act{width:40px;height:40px;border-radius:12px;border:1px solid rgba(26,122,94,.25);',
    '  background:rgba(26,122,94,.07);color:#166B52;display:flex;align-items:center;justify-content:center;',
    '  font-size:15px;text-decoration:none;}',
    '.bht-act:active{scale:.94;}',
    '.bht-vide{text-align:center;color:#9a958a;font-size:13.5px;padding:20px 0;}'
  ].join('');
  document.head.appendChild(st);

  // Rendre la carte « Votre journée » cliquable
  function brancher() {
    var carte = document.querySelector('.bh2-today');
    if (!carte || carte.__bhToday) return;
    carte.__bhToday = true;
    carte.style.cursor = 'pointer';
    carte.addEventListener('click', function (e) {
      if (e.target.closest('.bh2-op, .bh2-quick, button, a')) return; // les actions internes gardent la priorité
      bhOpenToday();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', brancher);
  else brancher();
  setTimeout(brancher, 1200);
})();
