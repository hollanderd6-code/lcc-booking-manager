/* bh-docs-ios-17.js — Propriétaires › Débours + Attestation fiscale (DebourView / AttestationView)
   /debours.html       → BHP.initDebours()
   /attestation.html   → BHP.initAttestation()
   Dépend de bh-prop-ios-12.js (BHP.ui). */
(function () {
  'use strict';
  var BHP = window.BHP || {}, U = BHP.ui;
  if (!U) { console.error('bh-docs-ios-17 : charger bh-prop-ios-12.js avant.'); return; }
  var esc = U.esc, pick = U.pick, I = U.I, ic = U.ic, card = U.card, htmlRow = U.htmlRow;
  var nf2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function eur2(v) { return nf2.format(v || 0) + '\u202f€'; }
  function dec(s) { var n = parseFloat(String(s == null ? '' : s).replace(',', '.').replace(/\s/g, '')); return isNaN(n) ? null : n; }
  function dayFr(iso) { if (!iso) return ''; var d = new Date(String(iso).slice(0, 10) + 'T00:00:00'); return isNaN(d) ? String(iso) : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); }
  function todayIso() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function normClient(c) {
    var id = String(pick(c, 'id', '_id') || '');
    var name = pick(c, 'companyName', 'company_name') || [pick(c, 'firstName', 'first_name'), pick(c, 'lastName', 'last_name')].filter(Boolean).join(' ') || 'Client sans nom';
    return { id: id, name: name, email: c.email || '', isAgency: U.bool(pick(c, 'isAgencyClient', 'is_agency_client')) === true || id.indexOf('agency_client_') === 0 };
  }
  function navLarge(kick, title, left, right, below) {
    return '<header class="bhp-nav"><div class="bhm-nav__in">' + left + '<div class="bhm-nav__t"><div class="bhp-nav__kicker" style="text-align:left">' + (esc(kick) || '&#160;') + '</div><h1 class="bhm-title">' + esc(title) + '</h1></div>' + (right || '') + '</div>' + (below || '') + '</header>';
  }
  function blocked(t) { return '<div class="bhm-empty">' + ic('lockCircle') + '<b style="color:#14201B;font-size:17px">Fonctionnalité non incluse</b><span>' + esc(t) + '</span></div>'; }
  function postBlob(url, body) {
    var f = typeof window.authFetch === 'function' ? window.authFetch : fetch;
    return f(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { var m; try { m = JSON.parse(t).error; } catch (e) {} throw new Error(m || 'Erreur lors de la génération.'); });
      return r.blob();
    });
  }
  I.lockCircle = I.lockCircle || '<svg class="bhp-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><rect x="8.5" y="11" width="7" height="5.5" rx="1"/><path d="M10 11V9.5a2 2 0 0 1 4 0V11"/></svg>';
  I.undo = I.undo || '<svg class="bhp-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>';
  I.camera = I.camera || '<svg class="bhp-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';

  /* ════════════════ Débours ════════════════ */
  var DF = [['pending', 'À facturer'], ['billed', 'Facturés'], ['all', 'Tous']];
  function normDebour(d) {
    return { id: String(pick(d, 'id', '_id') || ''), clientId: pick(d, 'clientId', 'client_id') != null ? String(pick(d, 'clientId', 'client_id')) : null,
      description: d.description || '', montant: dec(d.montant) || 0, date: d.date ? String(d.date).slice(0, 10) : null,
      photoUrl: pick(d, 'photoUrl', 'photo_url') || null, status: d.status || 'pending' };
  }
  BHP.initDebours = function () {
    var root = document.getElementById('bhpApp');
    var S = { state: 'loading', list: [], clients: [], filter: 'pending', busy: null };
    function load() {
      if (S.state !== 'loaded') { S.state = 'loading'; render(); }
      Promise.all([U.api('GET', '/api/debours'), U.api('GET', '/api/owner-clients').catch(function () { return {}; })]).then(function (r) {
        S.list = (r[0].debours || []).map(normDebour); S.clients = (r[1].clients || []).map(normClient); S.state = 'loaded';
      }).catch(function (e) { S.state = e.status === 402 ? 'blocked' : e.status === 403 ? 'denied' : 'error'; }).then(render);
    }
    function silent() { return U.api('GET', '/api/debours').then(function (r) { S.list = (r.debours || []).map(normDebour); }).catch(function () {}).then(render); }
    function filtered() { return S.filter === 'all' ? S.list : S.list.filter(function (d) { return d.status === S.filter; }); }
    function count(f) { return f === 'all' ? S.list.length : S.list.filter(function (d) { return d.status === f; }).length; }
    function cname(d) { var c = S.clients.filter(function (x) { return x.id === d.clientId; })[0]; return c ? c.name : '—'; }
    function render() {
      var pend = S.list.filter(function (d) { return d.status === 'pending'; }).reduce(function (s, d) { return s + d.montant; }, 0);
      var kick = S.state === 'loaded' ? (S.list.length === 1 ? '1 débours' : S.list.length + ' débours') + ' · ' + eur2(pend) + ' en attente' : '';
      var chips = S.state === 'loaded' ? '<div class="bhp-chips"><div class="bhp-chips__in">' + DF.map(function (f) { var n = count(f[0]); return '<button class="bhc-chip' + (S.filter === f[0] ? ' is-on' : '') + '" data-act="filter" data-v="' + f[0] + '">' + f[1] + (n && f[0] !== 'all' ? ' <span class="bhf-n">' + n + '</span>' : '') + '</button>'; }).join('') + '</div></div>' : '';
      var h;
      if (S.state === 'loading') h = '<div class="bhp-state bhp-center"><span class="bhp-spin bhp-spin--lg"></span></div>';
      else if (S.state === 'blocked') h = blocked('Les débours ne sont pas inclus dans votre abonnement actuel.');
      else if (S.state === 'denied') h = '<div class="bhm-empty">' + ic('lockCircle') + '<span>Vous n\'avez pas accès aux débours.</span></div>';
      else if (S.state === 'error') h = '<div class="bhm-empty">' + ic('warnFill') + '<span>Impossible de charger les débours.</span><button class="bhp-glassbtn" data-act="retry">Réessayer</button></div>';
      else {
        var f = filtered();
        h = !f.length ? '<div class="bhm-empty"><b style="color:#14201B;font-size:16px">Aucun débours</b><span>' + (S.filter === 'pending' ? 'Rien à refacturer pour le moment.' : 'Aucun débours dans cette liste.') + '</span></div>'
          : card(f.map(function (d) {
            var i = S.list.indexOf(d);
            return '<div class="bhp-row bho-cl" data-act="edit" data-i="' + i + '">'
              + (d.photoUrl ? '<a class="bhd-thumb" href="' + esc(d.photoUrl) + '" target="_blank" rel="noopener" data-stop="1">' + (/\.pdf($|\?)/i.test(d.photoUrl) ? '<span class="bhp-ic">' + I.doc + '</span>' : '<img src="' + esc(d.photoUrl) + '" alt="">') + '</a>' : '<span class="bhd-thumb bhd-thumb--e">' + I.euro + '</span>')
              + '<div class="bho-cl__t"><div class="bho-cl__n" style="font-size:15.5px">' + esc(d.description || '—') + '</div><div class="bhp-meta" style="font-size:12.5px">' + esc([cname(d), d.date && dayFr(d.date)].filter(Boolean).join(' · ')) + '</div></div>'
              + '<div class="bhc-right"><b style="font-size:15px">' + esc(eur2(d.montant)) + '</b>' + U.pill(d.status === 'billed' ? 'facturé' : 'à facturer', d.status === 'billed' ? 'vert' : 'or') + '</div>'
              + '<button class="bhp-dots" data-act="menu" data-i="' + i + '" aria-label="Actions"' + (S.busy === d.id ? ' disabled' : '') + '>' + (S.busy === d.id ? U.SPIN : I.ellipsis) + '</button></div>';
          }).join(''));
      }
      root.innerHTML = navLarge(kick, 'Débours', U.circleBtn('chevL', 'back', 'Propriétaires'), S.state === 'loaded' ? U.circleBtn('plus', 'new', 'Nouveau débours') : '', chips) + '<div class="bhp-stack">' + h + '</div>';
    }
    function toggle(d) {
      S.busy = d.id; render();
      U.api('PATCH', '/api/debours/' + encodeURIComponent(d.id) + '/status', { status: d.status === 'pending' ? 'billed' : 'pending' })
        .catch(function () { return U.api('PUT', '/api/debours/' + encodeURIComponent(d.id) + '/status', { status: d.status === 'pending' ? 'billed' : 'pending' }); })
        .catch(function (e) { U.alertMsg('Erreur', e.message || 'Erreur lors de la mise à jour.'); }).then(function () { S.busy = null; silent(); });
    }
    function del(d) {
      U.confirmMsg('Supprimer ce débours ?', 'Cette action est définitive.', 'Supprimer').then(function (ok) {
        if (!ok) return; S.busy = d.id; render();
        U.api('DELETE', '/api/debours/' + encodeURIComponent(d.id)).catch(function (e) { U.alertMsg('Erreur', e.message || 'Erreur lors de la suppression.'); }).then(function () { S.busy = null; silent(); });
      });
    }
    function openForm(edit) {
      var clients = S.clients.filter(function (c) { return !c.isAgency; });
      var st = { clientId: edit ? edit.clientId || '' : (clients.length === 1 ? clients[0].id : ''), description: edit ? edit.description : '', montant: edit ? String(edit.montant).replace('.', ',') : '', date: edit && edit.date ? edit.date : todayIso(), file: null, preview: edit ? edit.photoUrl : null, saving: false, err: null };
      var sh = U.openSheet({ head: { title: '' } });
      function valid() { return st.clientId && st.description.trim() && dec(st.montant) > 0; }
      function r2() {
        sh.locked = st.saving;
        sh.setHead({ title: edit ? 'Modifier le débours' : 'Nouveau débours', left: '<button class="bhp-textbtn" data-act="sheet-close"' + (st.saving ? ' disabled' : '') + '>Annuler</button>' });
        sh.body.innerHTML = '<div class="bhp-stack">' + (st.err ? U.warn(st.err, true) : '')
          + card(htmlRow('<div class="bhp-lbl">Propriétaire</div><select class="bhp-input bhp-select bhp-select--full" data-f="clientId"><option value="">Choisir…</option>' + clients.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === st.clientId ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select>')
            + htmlRow('<div class="bhp-lbl">Description</div><input class="bhp-input" data-f="description" value="' + esc(st.description) + '" placeholder="Ampoules, produits ménagers…">')
            + '<div class="bhp-row bhp-kv"><span class="bhp-kv__l">Montant TTC</span><span class="bhp-in-wrap"><input class="bhp-input bhp-input--r" data-f="montant" value="' + esc(st.montant) + '" inputmode="decimal" placeholder="0,00"><span class="bhp-unit">€</span></span></div>'
            + '<div class="bhp-row bhp-kv"><span class="bhp-kv__l">Date</span><input type="date" class="bhp-input" style="width:auto" data-f="date" value="' + esc(st.date) + '"></div>')
          + card(htmlRow('<div class="bhp-lbl">Justificatif</div><label class="bhd-up">' + (st.preview ? (/\.pdf($|\?)/i.test(st.preview) || (st.file && st.file.type === 'application/pdf') ? '<span class="bhp-ic" style="font-size:28px">' + I.doc + '</span><span>' + esc(st.file ? st.file.name : 'Justificatif PDF') + '</span>' : '<img src="' + esc(st.preview) + '" alt="">') : '<span class="bhp-ic" style="font-size:22px">' + I.camera + '</span><span>Ajouter une photo ou un PDF</span>')
            + '<input type="file" accept="image/*,application/pdf" data-file hidden></label>'))
          + '<button class="bhp-btn bhp-btn--primary" data-act="d-save"' + (valid() && !st.saving ? '' : ' disabled') + '>' + (st.saving ? '<span class="bhp-spin bhp-spin--w"></span>Enregistrement…' : (edit ? 'Enregistrer' : 'Ajouter le débours')) + '</button></div>';
      }
      sh.body.addEventListener('input', function (e) { var f = e.target.dataset.f; if (!f) return; st[f] = e.target.value; var b = sh.body.querySelector('[data-act="d-save"]'); if (b) b.disabled = !valid() || st.saving; });
      sh.body.addEventListener('change', function (e) {
        if (e.target.dataset.f) { st[e.target.dataset.f] = e.target.value; var b = sh.body.querySelector('[data-act="d-save"]'); if (b) b.disabled = !valid() || st.saving; }
        if (e.target.hasAttribute('data-file') && e.target.files[0]) { st.file = e.target.files[0]; st.preview = st.file.type === 'application/pdf' ? 'x.pdf' : URL.createObjectURL(st.file); r2(); }
      });
      sh.body.addEventListener('click', function (e) {
        if (!e.target.closest('[data-act="d-save"]') || !valid()) return;
        st.saving = true; st.err = null; r2();
        var fd = new FormData();
        fd.append('client_id', st.clientId); fd.append('description', st.description.trim());
        fd.append('montant', String(dec(st.montant).toFixed(2))); fd.append('date', st.date);
        if (st.file) fd.append('photo', st.file, st.file.name);
        U.api(edit ? 'PUT' : 'POST', edit ? '/api/debours/' + encodeURIComponent(edit.id) : '/api/debours', fd)
          .then(function () { sh.locked = false; sh.close(); silent(); })
          .catch(function (er) { st.saving = false; st.err = er.message || 'Erreur lors de l\'enregistrement.'; r2(); });
      });
      r2();
    }
    root.addEventListener('click', function (e) {
      if (e.target.closest('[data-stop]')) return;
      var el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
      var a = el.dataset.act;
      if (a === 'back') { location.href = '/proprietaires.html'; return; }
      if (a === 'retry') return load();
      if (a === 'filter') { S.filter = el.dataset.v; render(); return; }
      if (a === 'new') return openForm(null);
      var d = S.list[+el.dataset.i];
      if (a === 'edit') return openForm(d);
      if (a === 'menu') {
        e.stopPropagation();
        return U.openMenu(el, [
          { label: d.status === 'pending' ? 'Marquer facturé' : 'Remettre à facturer', icon: d.status === 'pending' ? 'checkFill' : 'undo', onClick: function () { toggle(d); } },
          { label: 'Modifier', icon: 'pencil', onClick: function () { openForm(d); } },
          '-', { label: 'Supprimer', icon: 'trash', danger: true, onClick: function () { del(d); } }]);
      }
    });
    load();
  };

  /* ════════════════ Attestation fiscale ════════════════ */
  var SERVICES = ['Entretien de la maison et travaux ménagers', 'Petits travaux de jardinage', 'Travaux de petit bricolage', 'Collecte et livraison de linge repassé',
    'Gardiennage et surveillance temporaire de la résidence', 'Livraison de courses à domicile', 'Assistance administrative à domicile', 'Maintenance et vigilance temporaire de la résidence'];
  var MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

  function signaturePad(canvas, onChange) {
    var ctx = canvas.getContext('2d'), drawing = false, last = null, has = false;
    function size() {
      var r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      var img = has ? canvas.toDataURL() : null;
      canvas.width = r.width * dpr; canvas.height = r.height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 2.4; ctx.strokeStyle = '#14201B';
      if (img) { var im = new Image(); im.onload = function () { ctx.drawImage(im, 0, 0, r.width, r.height); }; im.src = img; }
    }
    function pos(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    canvas.addEventListener('pointerdown', function (e) { e.preventDefault(); canvas.setPointerCapture(e.pointerId); drawing = true; last = pos(e); ctx.beginPath(); ctx.arc(last.x, last.y, 1.1, 0, Math.PI * 2); ctx.fillStyle = '#14201B'; ctx.fill(); });
    canvas.addEventListener('pointermove', function (e) {
      if (!drawing) return; var p = pos(e), mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p;
      if (!has) { has = true; onChange(true); }
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { canvas.addEventListener(ev, function () { drawing = false; }); });
    size();
    return { clear: function () { var r = canvas.getBoundingClientRect(); ctx.clearRect(0, 0, r.width, r.height); has = false; onChange(false); }, has: function () { return has; },
      data: function () {
        var out = document.createElement('canvas'); out.width = canvas.width; out.height = canvas.height;
        var o = out.getContext('2d'); o.fillStyle = '#fff'; o.fillRect(0, 0, out.width, out.height); o.drawImage(canvas, 0, 0); return out.toDataURL('image/png');
      } };
  }

  BHP.signaturePad = signaturePad;

  BHP.initAttestation = function () {
    var root = document.getElementById('bhpApp');
    var y0 = new Date().getFullYear();
    var S = { state: 'loading', clients: [], gen: false, send: false,
      d: { clientId: '', year: y0 - 1, ville: '', date: todayIso(), em: { company: '', address: '', postalCode: '', city: '', siret: '', email: '' },
        lines: [{ label: '', heures: '', taux: '' }], months: [] } };
    function lineTotal(l) { var h = dec(l.heures), t = dec(l.taux); return h != null && t != null ? Math.round(h * t * 100) / 100 : null; }
    function complete(l) { return String(l.label).trim() && dec(l.heures) != null && dec(l.taux) != null; }
    function grand() { return S.d.lines.reduce(function (s, l) { return s + (lineTotal(l) || 0); }, 0); }
    function monthsTotal() { return S.d.months.reduce(function (s, m) { return s + (dec(m.montant) || 0); }, 0); }
    function ready() { return !!S.d.clientId && S.d.lines.some(complete); }
    function dateStr() { var d = new Date(S.d.date + 'T00:00:00'); return isNaN(d) ? S.d.date : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); }
    function body(sig) {
      var d = S.d, f2 = function (n) { return (Math.round(n * 100) / 100).toFixed(2); };
      return { clientId: d.clientId, year: String(d.year), ville: d.ville, dateStr: dateStr(), emitter: d.em,
        lines: d.lines.filter(complete).map(function (l) { return { label: l.label.trim(), heures: String(l.heures).replace(',', '.'), taux: String(l.taux).replace(',', '.'), total: f2(lineTotal(l)) }; }),
        monthlyRows: d.months.map(function (m) { return { mois: m.mois, heures: String(m.heures || '').replace(',', '.'), montant: String(m.montant || '').replace(',', '.') }; }),
        grandTotal: f2(grand()), signatureData: sig || '' };
    }
    function load() {
      Promise.all([U.api('GET', '/api/user/profile'), U.api('GET', '/api/owner-clients')]).then(function (r) {
        var p = r[0].user || r[0].profile || r[0];
        S.d.em = { company: p.company || p.company_name || '', address: p.address || '', postalCode: pick(p, 'postalCode', 'postal_code') || '', city: p.city || '', siret: p.siret || '', email: pick(p, 'invoiceEmail', 'invoice_email') || p.email || '' };
        S.d.ville = p.city || '';
        S.clients = (r[1].clients || []).map(normClient).filter(function (c) { return !c.isAgency; });
        S.state = 'ready';
      }).catch(function (e) { S.state = (e.status === 402 || e.status === 403) ? 'blocked' : 'error'; }).then(render);
    }
    function read() { var b = root.querySelector('[data-at]'); if (!b) return; b.querySelectorAll('[data-k]').forEach(function (el) { var k = el.dataset.k.split('.'); var o = S.d; for (var i = 0; i < k.length - 1; i++) o = o[k[i]]; o[k[k.length - 1]] = el.value; }); }
    function inp(k, v, ph, mode, cls) { return '<input class="bhp-input ' + (cls || '') + '" data-k="' + k + '" value="' + esc(v) + '" placeholder="' + esc(ph || '') + '"' + (mode ? ' inputmode="' + mode + '"' : '') + '>'; }
    function render() {
      var h;
      if (S.state === 'loading') h = '<div class="bhp-state bhp-center"><span class="bhp-spin bhp-spin--lg"></span></div>';
      else if (S.state === 'blocked') h = blocked('L\'attestation fiscale n\'est pas incluse dans votre abonnement actuel.');
      else if (S.state === 'error') h = '<div class="bhm-empty">' + ic('warnFill') + '<span>Impossible de charger les données.</span><button class="bhp-glassbtn" data-act="retry">Réessayer</button></div>';
      else {
        var d = S.d, years = []; for (var y = Math.max(2024, y0); y >= 2024; y--) years.push(y);
        h = '<div class="bhp-group">' + U.label('Bénéficiaire') + card(htmlRow('<select class="bhp-input bhp-select bhp-select--full" data-k="clientId" data-rr="1"><option value="">Choisir un propriétaire…</option>'
          + S.clients.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === d.clientId ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select>')
          + (d.clientId ? (function () { var c = S.clients.filter(function (x) { return x.id === d.clientId; })[0]; return c && c.email ? htmlRow('<span class="bhp-meta">L\'attestation partira à ' + esc(c.email) + '</span>') : ''; })() : ''))
          + (!d.clientId ? '<div class="bho-hint">' + ic('errFill') + '<span>Sélectionnez un bénéficiaire pour continuer.</span></div>' : '') + '</div>';
        h += '<div class="bhp-group">' + U.label('Année et signature') + card('<div class="bhp-row bhp-kv"><span class="bhp-kv__l">Année</span><select class="bhp-input bhp-select" data-k="year">' + years.map(function (y) { return '<option' + (y == d.year ? ' selected' : '') + '>' + y + '</option>'; }).join('') + '</select></div>'
          + '<div class="bhp-row bho-field"><span class="bho-field__l">Fait à</span>' + inp('ville', d.ville, 'Ville', null, 'bho-field__i') + '</div>'
          + '<div class="bhp-row bhp-kv"><span class="bhp-kv__l">Le</span><input type="date" class="bhp-input" style="width:auto" data-k="date" value="' + esc(d.date) + '"></div>') + '</div>';
        h += '<div class="bhp-group">' + U.label('Prestations') + d.lines.map(function (l, i) {
          var t = lineTotal(l);
          return card(htmlRow('<div class="bhp-vstack"><div class="bhp-flexrow"><input class="bhp-input bhp-grow" list="bhaServices" data-k="lines.' + i + '.label" value="' + esc(l.label) + '" placeholder="Service">' + (d.lines.length > 1 ? '<button class="bhp-minus" data-act="del-line" data-i="' + i + '">' + I.minusFill + '</button>' : '') + '</div>'
            + '<div class="bhp-flexrow"><span class="bhp-in-wrap bhp-grow">' + inp('lines.' + i + '.heures', l.heures, 'Heures', 'decimal', 'bhp-grow') + '<span class="bhp-unit">h</span></span><span class="bhp-unit">×</span><span class="bhp-in-wrap bhp-grow">' + inp('lines.' + i + '.taux', l.taux, 'Taux', 'decimal', 'bhp-grow') + '<span class="bhp-unit">€/h</span></span></div>'
            + '<div class="bhp-kv"><span class="bhp-meta">Total</span><b>' + (t != null ? esc(eur2(t)) : '—') + '</b></div></div>'));
        }).join('') + '<button class="bhp-btn bhp-btn--mint" data-act="add-line">' + ic('plus') + 'Ajouter une prestation</button>'
          + (!d.lines.some(complete) ? '<div class="bho-hint">' + ic('errFill') + '<span>' + (d.lines.some(function (l) { return dec(l.heures) != null && dec(l.taux) != null && !String(l.label).trim(); }) ? 'Sélectionnez un service pour cette prestation.' : 'Complétez au moins une prestation.') + '</span></div>' : '')
          + '<datalist id="bhaServices">' + SERVICES.map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist></div>';
        h += '<div class="bhp-card bhf-hero"><div class="bhf-hero__l"><span class="bhp-meta">Montant total ' + esc(d.year) + '</span><b>' + esc(eur2(grand())) + '</b></div></div>';
        h += '<div class="bhp-group">' + U.label('Détail mensuel (facultatif)') + (d.months.length ? card(d.months.map(function (m, i) {
          return '<div class="bhp-row bhp-flexrow"><select class="bhp-input bhp-select" style="max-width:none;flex:1.2" data-k="months.' + i + '.mois">' + MONTHS.map(function (mo) { return '<option' + (mo === m.mois ? ' selected' : '') + '>' + mo + '</option>'; }).join('') + '</select>'
            + inp('months.' + i + '.heures', m.heures, 'h', 'decimal', 'bhp-input--s') + '<span class="bhp-in-wrap">' + inp('months.' + i + '.montant', m.montant, '€', 'decimal', 'bhp-input--s') + '</span><button class="bhp-minus" data-act="del-month" data-i="' + i + '">' + I.minusFill + '</button></div>';
        }).join('')) : '') + '<button class="bhp-btn bhp-btn--ghost" data-act="add-month">' + ic('plus') + 'Ajouter un mois</button>'
          + (d.months.length && monthsTotal() > grand() ? U.warn('Le total mensuel (' + eur2(monthsTotal()) + ') dépasse le montant annuel.') : '') + '</div>';
        var em = d.em;
        h += '<div class="bhp-group">' + U.label('Émetteur') + card(['company:Société', 'address:Adresse', 'postalCode:Code postal', 'city:Ville', 'siret:SIRET', 'email:Email'].map(function (x) {
          var k = x.split(':'); return '<div class="bhp-row bho-field"><span class="bho-field__l">' + k[1] + '</span>' + inp('em.' + k[0], em[k[0]], '', k[0] === 'postalCode' || k[0] === 'siret' ? 'numeric' : null, 'bho-field__i') + '</div>';
        }).join('')) + '</div>';
        h += '<div class="bhp-group"><button class="bhp-btn bhp-btn--ghost" data-act="preview"' + (ready() && !S.gen ? '' : ' disabled') + '>' + (S.gen ? U.SPIN + 'Génération…' : ic('doc') + 'Aperçu PDF') + '</button>'
          + '<button class="bhp-btn bhp-btn--primary" data-act="sign"' + (ready() ? '' : ' disabled') + '>' + ic('pencil') + 'Signer et envoyer</button></div>';
      }
      root.innerHTML = navLarge('Année ' + S.d.year, 'Attestation fiscale', U.circleBtn('chevL', 'back', 'Propriétaires')) + '<div class="bhp-stack" data-at>' + h + '</div>';
    }
    function openSign() {
      var c = S.clients.filter(function (x) { return x.id === S.d.clientId; })[0];
      var sh = U.openSheet({ head: { title: 'Votre signature', left: '<button class="bhp-textbtn bhp-textbtn--vert" data-act="sheet-close">Annuler</button>' } });
      var stamp = new Date().toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
      sh.body.innerHTML = '<div class="bhp-stack"><p class="bhp-note" style="font-size:14px">Signez dans le cadre avec le doigt. Vous pourrez recommencer autant que nécessaire.</p>'
        + '<div class="bha-pad"><canvas></canvas><i class="bha-pad__line"></i><span class="bha-pad__name">' + esc(S.d.em.company || '') + '</span></div>'
        + '<div class="bhp-kv"><button class="bhp-link" data-act="clear">' + ic('undo') + 'Effacer</button><span class="bhp-meta">' + esc(stamp) + '</span></div>'
        + (c && c.email ? '<div class="bhp-banner">' + ic('mail') + '<span>L\'attestation signée partira à ' + esc(c.email) + '.</span></div>' : '')
        + '<button class="bhp-btn bhp-btn--primary" data-act="go" disabled>Signer et envoyer</button></div>';
      var go = sh.body.querySelector('[data-act="go"]');
      var pad = signaturePad(sh.body.querySelector('canvas'), function (has) { go.disabled = !has; });
      sh.body.addEventListener('click', function (e) {
        var el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
        if (el.dataset.act === 'clear') pad.clear();
        if (el.dataset.act === 'go') {
          var sig = pad.data();
          if (sig.indexOf('data:image/png;base64,') !== 0) { U.alertMsg('Erreur', 'Signature invalide. Veuillez signer à nouveau.'); return; }
          go.disabled = true; go.innerHTML = '<span class="bhp-spin bhp-spin--w"></span>Envoi…'; sh.locked = true;
          U.api('POST', '/api/attestation/send', body(sig)).then(function (r) { sh.locked = false; sh.close(); U.alertMsg('Attestation envoyée', (r && r.message) || 'Attestation envoyée.'); })
            .catch(function (er) { sh.locked = false; go.disabled = false; go.textContent = 'Signer et envoyer'; U.alertMsg('Erreur', er.message || 'Erreur lors de l\'envoi.'); });
        }
      });
    }
    root.addEventListener('change', function (e) { if (e.target.dataset && e.target.dataset.k && (e.target.tagName === 'SELECT' || e.target.type === 'date')) { read(); render(); } });
    root.addEventListener('input', function (e) {
      var k = e.target.dataset && e.target.dataset.k; if (!k || e.target.tagName === 'SELECT') return;
      read();
      if (/^lines\./.test(k)) {
        var i = +k.split('.')[1], t = lineTotal(S.d.lines[i]), b = e.target.closest('.bhp-vstack');
        if (b) b.querySelector('.bhp-kv b').textContent = t != null ? eur2(t) : '—';
        var hero = root.querySelector('.bhf-hero b'); if (hero) hero.textContent = eur2(grand());
        var ok = ready(); root.querySelectorAll('[data-act="sign"],[data-act="preview"]').forEach(function (x) { x.disabled = !ok || (x.dataset.act === 'preview' && S.gen); });
      }
    });
    root.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
      var a = el.dataset.act; read();
      if (a === 'back') { location.href = '/proprietaires.html'; return; }
      if (a === 'retry') { S.state = 'loading'; render(); return load(); }
      if (a === 'add-line') { S.d.lines.push({ label: '', heures: '', taux: '' }); render(); return; }
      if (a === 'del-line') { S.d.lines.splice(+el.dataset.i, 1); render(); return; }
      if (a === 'add-month') { var used = S.d.months.map(function (m) { return m.mois; }); S.d.months.push({ mois: MONTHS.filter(function (m) { return used.indexOf(m) < 0; })[0] || MONTHS[0], heures: '', montant: '' }); render(); return; }
      if (a === 'del-month') { S.d.months.splice(+el.dataset.i, 1); render(); return; }
      if (a === 'preview') {
        var w = window.open('', '_blank'); S.gen = true; render();
        postBlob('/api/attestation/generate', body('')).then(function (b) { var u = URL.createObjectURL(b); if (w) w.location = u; else location.href = u; })
          .catch(function (er) { if (w) w.close(); U.alertMsg('Erreur', er.message); }).then(function () { S.gen = false; render(); });
        return;
      }
      if (a === 'sign') return openSign();
    });
    load();
  };
})();
