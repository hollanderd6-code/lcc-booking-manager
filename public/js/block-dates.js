// block-dates.js — Extracted from app.html
// Script complet pour le blocage de dates
(function() {
  let propertiesLoaded = false;
  
  // Remplir la liste des logements
  function loadPropertiesInBlockModal() {
    const token = localStorage.getItem('lcc_token');
    if (!token) return;
    
    fetch('https://lcc-booking-manager.onrender.com/api/properties', {
      headers: { 'Authorization': 'Bearer ' + token }
    })
    .then(res => res.json())
    .then(data => {
      const select = document.getElementById('blockPropertySelect');
      if (select && data.properties) {
        var opts='<option value="">Sélectionner un logement</option>'+data.properties.map(p=>'<option value="'+p.id+'">'+p.name+'</option>').join('');
        select.innerHTML=opts;
        ['dayPricePropertySelect','dayResaPropertySelect'].forEach(function(sid){var s=document.getElementById(sid);if(s)s.innerHTML=opts;});
        propertiesLoaded = true;
        console.log('✅ Logements chargés dans le select:', data.properties.length);
      }
    })
    .catch(err => console.log('Erreur chargement logements:', err));
  }
  
  // Clic cellule géré directement dans renderMonth via dcell.addEventListener (avec propertyId correct)

  document.addEventListener('DOMContentLoaded', function() {
    loadPropertiesInBlockModal();
  });
  
  window._currentBlockId = null;
  window.openBlockModal = function openBlockModal(date, propertyId, blockId, endDate) {
    const modal = document.getElementById('blockModal');
    if (!modal) return;
    window.hideFab();
    modal.style.display = 'flex';
    window._currentBlockId = blockId || null;
    var dateStr = (date||'').split('T')[0];
    // J+1 pour nouvelle résa/blocage (quand pas de endDate fournie)
    var parts = dateStr.split('-');
    var y=parseInt(parts[0]),mo=parseInt(parts[1])-1,day=parseInt(parts[2]);
    var d1 = new Date(y,mo,day+1);
    var nextDay = d1.getFullYear()+'-'+String(d1.getMonth()+1).padStart(2,'0')+'-'+String(d1.getDate()).padStart(2,'0');
    // Si on clique sur un bloc existant, utiliser ses vraies dates
    var endStr = endDate ? (endDate||'').split('T')[0] : nextDay;
    window._currentBlockEnd = endStr;
    console.log('📅 openBlockModal:', dateStr, '->', endStr, 'blockId:', blockId);
    ['blockStartDate','dayPriceFrom'].forEach(function(id){var e=document.getElementById(id);if(e)e.value=dateStr;});
    ['blockEndDate','dayPriceTo'].forEach(function(id){var e=document.getElementById(id);if(e)e.value=endStr;});
    ['blockPropertySelect','dayPricePropertySelect'].forEach(function(id){var s=document.getElementById(id);if(s&&propertyId)s.value=propertyId;});
    if (blockId) { switchBlockTab('unblock'); } else { switchBlockTab('block'); }
  };

  window._activeBlockTab = 'block';
  function switchBlockTab(tab) {
    window._activeBlockTab = tab;
    ['block','price','resa','unblock'].forEach(function(t){
      var T=t.charAt(0).toUpperCase()+t.slice(1);
      var btn=document.getElementById('tab'+T), con=document.getElementById('tabContent'+T), on=t===tab;
      if(btn){btn.style.background=on?(t==='unblock'?'#DC2626':'#1A7A5E'):'white';btn.style.color=on?'white':'#374151';btn.style.borderColor=on?(t==='unblock'?'#DC2626':'#1A7A5E'):'#e5e7eb';btn.style.display=(t==='unblock'&&!window._currentBlockId)?'none':'flex';}
      if(con)con.style.display=on?'block':'none';
    });
    var icons={block:'fa-lock',price:'fa-tag',resa:'fa-plus',unblock:'fa-lock-open'};
    var labels={block:'Bloquer ces dates',price:'Appliquer le prix',resa:'Créer la réservation',unblock:'Débloquer ces dates'};
    var ic=document.getElementById('blockSaveIcon');if(ic)ic.className='fas '+icons[tab];
    var lb=document.getElementById('blockSaveLabel');if(lb)lb.textContent=labels[tab];
    if(tab==='unblock'){var sb=document.getElementById('blockSaveBtn');if(sb){sb.style.background='#DC2626';}}
    else{var sb2=document.getElementById('blockSaveBtn');if(sb2)sb2.style.background='';}
  }
  window.switchBlockTab=switchBlockTab;

  window._blockSaveInProgress = false;
  window.handleBlockModalSave = async function() {
    if (window._blockSaveInProgress) return;
    window._blockSaveInProgress = true;
    var API2=(typeof API_URL!=='undefined')?API_URL:'https://lcc-booking-manager.onrender.com';
    var token=localStorage.getItem('lcc_token');
    var activeTab = window._activeBlockTab || 'block';
    console.log('🎯 handleBlockModalSave activeTab:', activeTab);
    var btn=document.getElementById('blockSaveBtn');btn.disabled=true;
    try {
      if(activeTab==='block'){
        var bProp=document.getElementById('blockPropertySelect').value;
        var bStart=document.getElementById('blockStartDate').value;
        var bEnd=document.getElementById('blockEndDate').value;
        var bReason=document.getElementById('blockReason').value;
        if(!bProp||!bStart||!bEnd){alert('Veuillez remplir tous les champs');btn.disabled=false;return;}
        var rb=await fetch(API2+'/api/blocks',{method:'POST',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({propertyId:bProp,start:bStart,end:bEnd,reason:bReason||'Blocage manuel'})});
        var db=await rb.json();
        if(db.block||db.message||db.success){
          document.getElementById('blockModal').style.display='none';window.showFab&&window.showFab();
          if(typeof window.loadCalendarData==='function')window.loadCalendarData();
        } else { throw new Error(db.error||'Erreur blocage'); }
        btn.disabled=false;return;
      } else if(activeTab==='unblock'){
        var blockId=window._currentBlockId;
        var bProp2=document.getElementById('blockPropertySelect').value;
        var bFrom=document.getElementById('blockStartDate').value;
        var bTo=window._currentBlockEnd || document.getElementById('blockEndDate').value;
        console.log('🔓 Déblocage uid:', blockId, 'prop:', bProp2, 'dates:', bFrom, '->', bTo);
        // Batch unblock par dates — supprime TOUS les blocs chevauchants (y compris doublons)
        console.log('🔓 Batch unblock:', bProp2, bFrom, bTo);
        var ru2=await fetch(API2+'/api/blocks/batch',{method:'POST',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({property_ids:[bProp2],date_from:bFrom,date_to:bTo,action:'unblock'})});
        var du2=await ru2.json();
        console.log('🔓 Batch result:', du2, 'HTTP status:', ru2.status);
        if(!du2.success) throw new Error(du2.error||'Erreur déblocage');
        document.getElementById('blockModal').style.display='none';window.showFab&&window.showFab();
        window._currentBlockId=null; window._currentBlockEnd=null;
        // Patch local par dates (couvre tous les blocs chevauchants)
        if(Array.isArray(window.LCC_RESERVATIONS)){
          window.LCC_RESERVATIONS = window.LCC_RESERVATIONS.filter(function(r){
            var isBlock = r.source==='BLOCK'||r.platform==='BLOCK'||r.type==='block';
            var overlaps = r.propertyId===bProp2 && r.start < bTo && r.end > bFrom;
            return !(isBlock && overlaps);
          });
          try { localStorage.setItem('LCC_RESERVATIONS', JSON.stringify(window.LCC_RESERVATIONS)); } catch(e){}
        }
        // Patch calendarState.bookings
        var beforeCount = window.calendarState ? (window.calendarState.bookings||[]).length : -1;
        if(window.calendarState && Array.isArray(window.calendarState.bookings)){
          window.calendarState.bookings = window.calendarState.bookings.filter(function(r){
            if(blockId && (r.uid === blockId || String(r.id) === String(blockId))) return false;
            var isBlock = r.source==='BLOCK'||r.platform==='BLOCK'||r.type==='block'||r.platform==='block';
            var overlaps = r.propertyId===bProp2 && r.startDate < bTo && r.endDate > bFrom;
            return !(isBlock && overlaps);
          });
        }
        var afterCount = window.calendarState ? (window.calendarState.bookings||[]).length : -1;
        console.log('🔓 calendarState.bookings avant/après patch:', beforeCount, '->', afterCount, '| _blockRemovedAt:', window._blockRemovedAt, 'âge:', Date.now() - (window._blockRemovedAt||0), 'ms');
        // Re-render IMMÉDIAT sans attendre le socket
        window._blockRemovedAt = 0; // forcer le rendu immédiat
        if(typeof window.renderModernCalendar==='function' && window.calendarState){
          window.renderModernCalendar(window.calendarState.bookings||[], window.calendarState.properties||window.LCC_PROPERTIES||[]);
        }
        if(typeof window.showToast==='function')window.showToast('Blocage supprimé','success');
        // Forcer un refresh complet après 2.5s pour confirmer avec les données fraîches du serveur
        setTimeout(function(){
          window._blockRemovedAt = 0;
          if(typeof window.loadCalendarData==='function') window.loadCalendarData();
        }, 2500);
      } else if(activeTab==='price'){
        var pid3=document.getElementById('dayPricePropertySelect').value;
        var from3=document.getElementById('dayPriceFrom').value;
        var to3=document.getElementById('dayPriceTo').value;
        var price=document.getElementById('dayPriceValue').value;
        if(!pid3||!from3||!to3){alert('Logement et dates requis');btn.disabled=false;return;}
        var r3=await fetch(API2+'/api/pricing/overrides/batch',{method:'POST',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({property_ids:[pid3],date_from:from3,date_to:to3,price:price===''?'':parseFloat(price)})});
        var d3=await r3.json();if(!d3.success)throw new Error(d3.error||'Erreur');
        if(typeof window.loadPricingOverrides==='function')await window.loadPricingOverrides(window.LCC_PROPERTIES||[]);
        if(typeof window.applyPricingRulesToCells==='function')window.applyPricingRulesToCells();
        document.getElementById('blockModal').style.display='none';window.showFab&&window.showFab();
      } else if(activeTab==='resa'){
        // Fermer et ouvrir newReservationModal avec données pré-remplies
        var propId=document.getElementById('blockPropertySelect').value;
        var startD=document.getElementById('blockStartDate').value;
        var endD=document.getElementById('blockEndDate').value;
        document.getElementById('blockModal').style.display='none';window.showFab&&window.showFab();
        // Alimenter LCC_PROPERTIES depuis calendarState si vide
        if((!window.LCC_PROPERTIES||!window.LCC_PROPERTIES.length) && window.calendarState && window.calendarState.properties){
          window.LCC_PROPERTIES = window.calendarState.properties;
        }
        if(typeof openNewReservationModal==='function')openNewReservationModal();
        else{var m=document.getElementById('newReservationModal');if(m)m.style.display='flex';}
        setTimeout(function(){
          // Re-populate nrProperty select si vide
          var nrSel=document.getElementById('nrProperty');
          if(nrSel && (!nrSel.options.length || (nrSel.options.length===1 && !nrSel.options[0].value))){
            var props2=window.LCC_PROPERTIES||window.calendarState&&window.calendarState.properties||[];
            if(props2.length){
              nrSel.innerHTML='<option value="">— Logement —</option>'+props2.map(function(p){return '<option value="'+p.id+'">'+p.name+'</option>';}).join('');
            }
          }
          var s=document.getElementById('nrStartDate');if(s)s.value=startD;
          var e2=document.getElementById('nrEndDate');if(e2)e2.value=endD;
          if(nrSel)nrSel.value=propId;
        },300);
        btn.disabled=false;return;
      }
    }catch(err){alert('Erreur : '+err.message);}
    finally{btn.disabled=false; window._blockSaveInProgress=false;}
  };
  
  // Fermeture du modal
  document.getElementById('blockModalClose')?.addEventListener('click', function() {
    document.getElementById('blockModal').style.display = 'none'; window.showFab();
  });
  document.getElementById('blockModal')?.addEventListener('click', function(e) {
    if (e.target === document.getElementById('blockModal')) { document.getElementById('blockModal').style.display = 'none'; window.showFab(); }
  });
  document.getElementById('blockModalCancel')?.addEventListener('click', function() {
    document.getElementById('blockModal').style.display = 'none'; window.showFab();
  });
})();
