/* bh-owners-ios-14.js — Gestion › Propriétaires, parité avec l'app iOS
   (OwnersView.swift, OwnersViewModel.swift, OwnerClientDetailView.swift + feuilles)
   /proprietaires.html            → liste
   /proprietaires.html?client=ID  → fiche client
   Dépend de bh-prop-ios-12.js (BHP.ui). */
(function () {
  'use strict';
  var BHP = window.BHP || {};
  var U = BHP.ui;
  if (!U) { console.error('bh-owners-ios-14 : charger bh-prop-ios-12.js avant.'); return; }
  var esc = U.esc, pick = U.pick, I = U.I, ic = U.ic, pl = U.pl, card = U.card, htmlRow = U.htmlRow, CHEV = U.CHEV;

  var DOCS = [
    { icon: 'signature', label: 'Contrats', href: '/contrats.html', key: 'contracts' },
    { icon: 'doc', label: 'Factures propriétaires', href: '/factures-proprietaires.html', key: 'invoices' },
    { icon: 'docPlain', label: 'Attestation fiscale', href: '/clients.html#attestation' },
    { icon: 'euro', label: 'Débours', href: '/clients.html#debours' }
  ];
  I.signature = I.signature || '<svg class="bhp-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17c3-1 4-9 6-9s-1 9 2 9 2-5 4-5 1 4 3 4 3-2 3-2"/><path d="M3 21h18"/></svg>';
  I.docPlain = I.docPlain || '<svg class="bhp-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
  I.lockCircle = I.lockCircle || '<svg class="bhp-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><rect x="8.5" y="11" width="7" height="5.5" rx="1"/><path d="M10 11V9.5a2 2 0 0 1 4 0V11"/></svg>';
  I.circle = I.circle || '<svg class="bhp-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9.5"/></svg>';

  /* ── Modèle (OwnerClient) ── */
  function normClient(c) {
    c = c || {};
    if (c.client && typeof c.client === 'object') c = c.client;
    var id = String(pick(c, 'id', '_id') || '');
    var orig = pick(c, 'originalId', 'original_id');
    var o = {
      id: id,
      clientType: pick(c, 'clientType', 'client_type') || 'individual',
      firstName: pick(c, 'firstName', 'first_name') || '',
      lastName: pick(c, 'lastName', 'last_name') || '',
      companyName: pick(c, 'companyName', 'company_name') || '',
      email: c.email || '', phone: c.phone || '', siret: c.siret || '', address: c.address || '',
      postalCode: pick(c, 'postalCode', 'postal_code') || '', city: c.city || '',
      rate: U.num(pick(c, 'defaultCommissionRate', 'default_commission_rate')),
      isAgency: U.bool(pick(c, 'isAgencyClient', 'is_agency_client')) === true,
      hasOverride: U.bool(pick(c, 'hasOverride', 'has_override')) === true,
      delegatorUserId: pick(c, 'delegatorUserId', 'delegator_user_id'),
      delegatorName: pick(c, 'delegatorName', 'delegator_name') || null
    };
    o.matchingId = String(orig != null ? orig : id).replace('agency_client_', '');
    o.name = o.companyName || [o.firstName, o.lastName].filter(Boolean).join(' ') || 'Client sans nom';
    o.initials = o.companyName ? o.companyName.charAt(0).toUpperCase() : ((o.firstName.charAt(0) + o.lastName.charAt(0)).toUpperCase() || '?');
    return o;
  }
  function daysSince(iso) { if (!iso) return 0; var d = new Date(String(iso).slice(0, 10) + 'T00:00:00'); if (isNaN(d)) return 0; return Math.max(0, Math.floor((Date.now() - d) / 86400000)); }
  function sentAgo(n) { return n === 0 ? "Envoyé aujourd'hui" : n === 1 ? 'Envoyé il y a 1 jour' : 'Envoyé il y a ' + n + ' jours'; }
  function rateLabel(r) { if (r == null) return '20\u202f%'; return (Math.round(r) === r ? String(r) : r.toFixed(2).replace('.', ',')) + '\u202f%'; }
  function clientBody(d) {
    var t = function (s) { s = String(s || '').trim(); return s || null; };
    var rate = U.num(d.rate);
    var b = { clientType: d.clientType, firstName: t(d.firstName), lastName: t(d.lastName), companyName: t(d.companyName), email: t(d.email), phone: t(d.phone),
      siret: t(d.siret), address: t(d.address), postalCode: t(d.postalCode), city: t(d.city), defaultCommissionRate: rate == null ? 20 : rate };
    // Doublon snake_case : le web lit les deux formes.
    b.client_type = b.clientType; b.first_name = b.firstName; b.last_name = b.lastName; b.company_name = b.companyName;
    b.postal_code = b.postalCode; b.default_commission_rate = b.defaultCommissionRate;
    return b;
  }
  function validDraft(d) { return d.clientType === 'business' ? !!String(d.companyName).trim() : (!!String(d.firstName).trim() && !!String(d.lastName).trim()); }
  function avatar(c, size) { return '<span class="bho-av" style="width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * .36) + 'px">' + esc(c.initials) + '</span>'; }
  function seg(name, val, opts) {
    return '<div class="bhm-seg">' + opts.map(function (o) { return '<button type="button" class="bhm-seg__b' + (val === o[0] ? ' is-on' : '') + '" data-seg="' + name + '" data-v="' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div>';
  }
  function fieldRow(label, k, val, ph, mode) {
    return '<div class="bhp-row bho-field"><span class="bho-field__l">' + esc(label) + '</span><input class="bhp-input bho-field__i" data-f="' + k + '" value="' + esc(val) + '" placeholder="' + esc(ph) + '"' + (mode ? ' inputmode="' + mode + '"' : '') + ' autocomplete="off"></div>';
  }
  function readRow(label, val) { return '<div class="bhp-row bhp-kv"><span class="bhp-kv__l" style="font-size:14.5px">' + esc(label) + '</span><span class="bhp-kv__v" style="font-size:14.5px">' + esc(val || '—') + '</span></div>'; }
  function hint(t) { return '<div class="bho-hint">' + ic('errFill') + '<span>' + esc(t) + '</span></div>'; }
  function identityFields(d) {
    return (d.clientType === 'business'
      ? fieldRow('Raison sociale', 'companyName', d.companyName, 'Obligatoire')
      : fieldRow('Prénom', 'firstName', d.firstName, 'Obligatoire') + fieldRow('Nom', 'lastName', d.lastName, 'Obligatoire'));
  }
  function coordFields(d, withRate) {
    return fieldRow('Email', 'email', d.email, 'Optionnel', 'email') + fieldRow('Téléphone', 'phone', d.phone, 'Optionnel', 'tel')
      + fieldRow('Adresse', 'address', d.address, 'Optionnel') + fieldRow('Code postal', 'postalCode', d.postalCode, 'Optionnel', 'numeric')
      + fieldRow('Ville', 'city', d.city, 'Optionnel') + (withRate ? fieldRow('Commission (%)', 'rate', d.rate, '20 par défaut', 'decimal') : '');
  }
  function mandatoryText(d) { return d.clientType === 'business' ? 'La raison sociale est obligatoire.' : 'Le prénom et le nom sont obligatoires.'; }

  /* ── Feuille : nouveau propriétaire ── */
  function openCreateSheet(onCreated) {
    var d = { clientType: 'individual', firstName: '', lastName: '', companyName: '', email: '', phone: '', siret: '', address: '', postalCode: '', city: '', rate: '' };
    var st = { saving: false, err: null };
    var sh = U.openSheet({ head: { title: '' } });
    function render() {
      sh.locked = st.saving;
      sh.setHead({ title: 'Nouveau propriétaire', left: '<button class="bhp-textbtn" data-act="sheet-close"' + (st.saving ? ' disabled' : '') + '>Annuler</button>', right: st.saving ? U.SPIN : '' });
      var ok = validDraft(d);
      sh.body.innerHTML = '<div class="bhp-stack">' + (st.err ? U.warn(st.err, true) : '')
        + seg('clientType', d.clientType, [['individual', 'Particulier'], ['business', 'Société']])
        + '<div class="bhp-group">' + U.label('Identité') + card(identityFields(d)) + (ok ? '' : hint(mandatoryText(d))) + '</div>'
        + '<div class="bhp-group">' + U.label('Coordonnées et facturation') + card(fieldRow('Email', 'email', d.email, 'Optionnel', 'email') + fieldRow('Téléphone', 'phone', d.phone, 'Optionnel', 'tel')
          + fieldRow('SIRET', 'siret', d.siret, 'Optionnel', 'numeric') + fieldRow('Adresse', 'address', d.address, 'Optionnel') + fieldRow('Code postal', 'postalCode', d.postalCode, 'Optionnel', 'numeric')
          + fieldRow('Ville', 'city', d.city, 'Optionnel') + fieldRow('Commission (%)', 'rate', d.rate, '20 par défaut', 'decimal')) + '</div>'
        + '<button class="bhp-btn bhp-btn--primary" data-act="oc-create"' + (ok && !st.saving ? '' : ' disabled') + '>Créer le propriétaire</button></div>';
    }
    sh.body.addEventListener('input', function (e) {
      var f = e.target.dataset.f; if (!f) return;
      var was = validDraft(d); d[f] = e.target.value;
      if (was !== validDraft(d)) { var pos = e.target.selectionStart; render(); var n = sh.body.querySelector('[data-f="' + f + '"]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) {} } }
    });
    sh.body.addEventListener('click', function (e) {
      var s = e.target.closest('[data-seg]');
      if (s) { d[s.dataset.seg] = s.dataset.v; render(); return; }
      if (!e.target.closest('[data-act="oc-create"]') || !validDraft(d)) return;
      st.saving = true; st.err = null; render();
      var body = clientBody(d); if (!String(d.rate).trim()) { delete body.defaultCommissionRate; delete body.default_commission_rate; }
      U.api('POST', '/api/owner-clients', body).then(function (r) {
        var c = normClient(r.client || r);
        sh.locked = false; sh.close();
        U.alertMsg('Client ajouté', c.name + ' a été ajouté à votre liste de propriétaires.');
        if (onCreated) onCreated(c);
      }).catch(function (er) { st.saving = false; st.err = er.status === 0 ? 'Connexion impossible. Vérifiez votre réseau.' : (er.message || 'Une erreur est survenue. Réessayez.'); render(); });
    });
    render();
  }

  /* ── Feuille : logements associés ── */
  function openAssignSheet(client, allProps, allClients, initial, onSaved) {
    var sel = {}; initial.forEach(function (id) { sel[id] = 1; });
    var saving = false;
    var props = allProps.slice().sort(function (a, b) { return U.dname(a).localeCompare(U.dname(b), 'fr', { numeric: true }); });
    function takenByOther(p) { return p.ownerId && String(p.ownerId) !== client.matchingId; }
    function ownerName(oid) { var c = allClients.filter(function (x) { return x.matchingId === String(oid); })[0]; return c ? c.name : null; }
    var sh = U.openSheet({ head: { title: '' } });
    function render() {
      sh.locked = saving;
      sh.setHead({ title: 'Logements associés', left: '<button class="bhp-textbtn" data-act="sheet-close"' + (saving ? ' disabled' : '') + '>Annuler</button>',
        right: saving ? U.SPIN : '<button class="bhp-textbtn bhp-textbtn--vert" style="font-weight:600" data-act="as-save">Enregistrer</button>' });
      sh.body.innerHTML = '<div class="bhp-stack">' + (!props.length ? '<div class="bhp-state">Aucun logement disponible</div>' : card(props.map(function (p) {
        var on = !!sel[p.id], taken = takenByOther(p), on2 = taken ? ownerName(p.ownerId) : null;
        return '<button class="bhp-row bho-pick" data-pid="' + esc(p.id) + '"><span class="bhp-ic bho-pick__c' + (on ? ' is-on' : '') + '">' + (on ? I.checkFill : I.circle) + '</span><span class="bho-pick__t"><span>' + esc(U.dname(p)) + '</span>'
          + (taken ? '<span class="bho-pick__o">' + (on2 ? 'Propriétaire actuel : ' + esc(on2) : 'Attribué à un autre propriétaire') + '</span>' : '') + '</span></button>';
      }).join(''))) + '</div>';
    }
    function doSave() {
      saving = true; render();
      var cur = {}; initial.forEach(function (id) { cur[id] = 1; });
      var jobs = [];
      Object.keys(sel).forEach(function (id) { if (!cur[id]) jobs.push(U.api('PATCH', '/api/properties/' + encodeURIComponent(id), { ownerId: client.matchingId })); });
      initial.forEach(function (id) { if (!sel[id]) jobs.push(U.api('PATCH', '/api/properties/' + encodeURIComponent(id), { ownerId: null })); });
      Promise.all(jobs).then(function () { sh.locked = false; sh.close(); onSaved(); })
        .catch(function (er) { saving = false; render(); U.alertMsg('Erreur', er.message || 'Une erreur est survenue.'); });
    }
    sh.body.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pid]'); if (!b || saving) return;
      var id = b.dataset.pid; if (sel[id]) delete sel[id]; else sel[id] = 1; render();
    });
    sh.head.addEventListener('click', function (e) {
      if (!e.target.closest('[data-act="as-save"]')) return;
      var added = Object.keys(sel).filter(function (id) { return initial.indexOf(id) < 0; });
      var re = props.filter(function (p) { return added.indexOf(p.id) >= 0 && takenByOther(p); });
      if (!re.length) return doSave();
      U.dialog({ title: 'Réassigner ces logements ?', message: 'Ces logements sont déjà attribués à un autre propriétaire : ' + re.map(U.dname).join(', ') + '. Les réattribuer à ' + client.name + ' retirera leur propriétaire actuel.',
        actions: [{ label: 'Annuler', role: 'cancel', value: false }, { label: 'Confirmer', role: 'destructive', value: true }] }).then(function (ok) { if (ok) doSave(); });
    });
    render();
  }

  /* ════════════════ Page ════════════════ */
  BHP.initOwners = function () {
    var root = document.getElementById('bhpApp');
    var S = { state: 'loading', clients: [], drafts: [], pending: [], props: [], countBy: {}, view: null, detail: null, listScroll: 0 };

    function badgeFor(c) {
      if (S.pending.some(function (k) { return k.clientId === c.matchingId; })) return 'contrat non signé';
      if (S.drafts.some(function (k) { return k.clientId === c.matchingId; })) return 'facture à envoyer';
      return null;
    }
    function loadList() {
      if (S.state !== 'loaded') { S.state = 'loading'; render(); }
      U.api('GET', '/api/owner-clients').then(function (r) {
        S.clients = (r.clients || (Array.isArray(r) ? r : [])).map(normClient);
        return Promise.all([
          U.api('GET', '/api/owner-invoices').catch(function () { return {}; }),
          U.api('GET', '/api/contrats?status=sent').catch(function () { return {}; }),
          U.api('GET', '/api/properties').catch(function () { return {}; })
        ]);
      }).then(function (r) {
        S.drafts = (r[0].invoices || []).filter(function (x) { return x.status === 'draft'; }).map(function (x) { return { clientId: String(pick(x, 'clientId', 'client_id') || '') }; });
        S.pending = (r[1].contracts || r[1].contrats || []).filter(function (x) { return !x.status || x.status === 'sent'; })
          .map(function (x) { return { clientId: pick(x, 'clientId', 'client_id') != null ? String(pick(x, 'clientId', 'client_id')) : null, createdAt: pick(x, 'createdAt', 'created_at') }; });
        S.props = (r[2].properties || []).map(U.normProperty).filter(function (p) { return p.id; });
        S.countBy = {}; S.props.forEach(function (p) { if (p.ownerId) S.countBy[p.ownerId] = (S.countBy[p.ownerId] || 0) + 1; });
        S.state = 'loaded'; render();
      }).catch(function (er) {
        S.state = (er.status === 403 || er.status === 402) ? 'blocked' : 'error'; render();
      });
    }

    /* ── Liste ── */
    function renderList() {
      var kick = S.state === 'loaded' ? pl(S.clients.length, 'client') + ' · ' + pl(S.props.length, 'logement') : '';
      var nav = '<header class="bhp-nav"><div class="bhm-nav__in">' + U.circleBtn('chevL', 'back', 'Gestion')
        + '<div class="bhm-nav__t"><div class="bhp-nav__kicker" style="text-align:left">' + (esc(kick) || '&#160;') + '</div><h1 class="bhm-title">Propriétaires</h1></div>'
        + U.circleBtn('plus', 'new', 'Nouveau propriétaire') + '</div></header>';
      var h = '';
      if (S.state === 'loading') h = '<div class="bhp-state bhp-center"><span class="bhp-spin bhp-spin--lg"></span></div>';
      else if (S.state === 'blocked') h = '<div class="bhm-empty">' + ic('lockCircle') + '<b style="color:#14201B;font-size:17px">Fonctionnalité non incluse</b><span>La gestion des propriétaires n\'est pas incluse dans votre abonnement actuel.</span></div>';
      else if (S.state === 'error') h = '<div class="bhm-empty">' + ic('warnFill') + '<span>Impossible de charger les clients.</span><button class="bhp-glassbtn" data-act="retry">Réessayer</button></div>';
      else {
        if (S.pending.length) {
          var oldest = Math.max.apply(null, S.pending.map(function (p) { return daysSince(p.createdAt); }));
          h += '<div class="bho-alert">' + ic('signature') + '<div><div class="bho-alert__t">' + pl(S.pending.length, 'contrat') + ' en attente de signature</div><div class="bhp-meta">' + esc(sentAgo(oldest)) + '</div></div></div>';
        }
        if (!S.clients.length) h += '<p class="bhp-state" style="padding:20px">Aucun client</p>';
        else h += card(S.clients.map(function (c, i) {
          var n = S.countBy[c.matchingId] || 0, b = badgeFor(c);
          return '<div class="bhp-row bho-cl" data-act="open" data-i="' + i + '">' + avatar(c, 42) + '<div class="bho-cl__t"><div class="bho-cl__n">' + esc(c.name) + '</div><div class="bhp-meta" style="font-size:12.5px">' + pl(n, 'logement') + '</div></div>'
            + (b ? U.pill(b, 'or') : '') + CHEV + '</div>';
        }).join(''));
        var nC = S.pending.length, nI = S.drafts.length;
        h += '<div class="bhp-group">' + U.label('Documents') + card(DOCS.map(function (d) {
          var tr = d.key === 'contracts' && nC ? nC + ' en attente' : d.key === 'invoices' && nI ? pl(nI, 'brouillon') : '';
          return '<a class="bhp-row bho-doc" href="' + d.href + '">' + ic(d.icon) + '<span class="bho-doc__l">' + esc(d.label) + '</span>' + (tr ? '<span class="bhp-meta">' + esc(tr) + '</span>' : '') + CHEV + '</a>';
        }).join('')) + '</div>';
      }
      root.innerHTML = nav + '<div class="bhp-stack">' + h + '</div>';
      document.title = 'Propriétaires — Boostinghost';
    }

    /* ── Fiche client ── */
    function openClient(c, push) {
      S.listScroll = window.scrollY;
      S.detail = { client: c, state: 'loading', editing: false, saving: false, draft: null, assoc: [], all: [], deleting: false };
      S.view = 'client';
      if (push) history.pushState({ bhoClient: c.id }, '', location.pathname + '?client=' + encodeURIComponent(c.id));
      render(); window.scrollTo(0, 0);
      var D = S.detail;
      var pc = c.isAgency ? Promise.resolve(c) : U.api('GET', '/api/owner-clients/' + encodeURIComponent(c.id)).then(function (r) { var n = normClient(r); if (!n.id) n.id = c.id; if (c.isAgency) n.isAgency = true; return n; });
      pc.then(function (cl) { D.client = cl; return loadAssoc(D); }).then(function () { D.state = 'loaded'; if (S.detail === D) render(); })
        .catch(function () { D.state = 'error'; if (S.detail === D) render(); });
    }
    function loadAssoc(D) {
      return U.api('GET', '/api/properties').then(function (r) {
        D.all = (r.properties || []).map(U.normProperty).filter(function (p) { return p.id; });
        D.assoc = D.all.filter(function (p) { return String(p.ownerId || '') === D.client.matchingId; });
      }).catch(function () {});
    }
    function closeClient() {
      if (history.state && history.state.bhoClient) { history.back(); return; }
      history.replaceState(null, '', location.pathname); S.view = null; S.detail = null; render(); window.scrollTo(0, S.listScroll);
    }
    function renderClient() {
      var D = S.detail, c = D.client;
      var left = D.editing ? U.glassBtn('Annuler', 'cd-cancel', { medium: true, disabled: D.saving }) : U.circleBtn('chevL', 'cd-back', 'Propriétaires');
      var right = '';
      if (D.editing) right = U.glassBtn('Enregistrer', 'cd-save', { spin: D.saving, disabled: D.saving || !validDraft(D.draft) });
      else if (D.state === 'loaded') right = U.glassBtn('Modifier', 'cd-edit');
      var h = '';
      if (D.state === 'loading') h = '<div class="bhp-state bhp-center"><span class="bhp-spin bhp-spin--lg"></span></div>';
      else if (D.state === 'error') h = '<div class="bhm-empty">' + ic('warnFill') + '<span>Impossible de charger le client.</span><button class="bhp-glassbtn" data-act="cd-retry">Réessayer</button></div>';
      else if (D.editing) {
        var d = D.draft;
        if (c.isAgency && c.delegatorName) h += '<div class="bhp-banner">' + ic('building') + '<span>Ce propriétaire est géré par ' + esc(c.delegatorName) + '. Vos modifications s\'appliquent uniquement à votre facturation.</span></div>';
        if (!c.isAgency) h += seg('clientType', d.clientType, [['individual', 'Particulier'], ['business', 'Société']]);
        h += '<div class="bhp-group">' + U.label('Identité') + card(identityFields(d) + fieldRow('SIRET', 'siret', d.siret, 'Optionnel', 'numeric')) + (validDraft(d) ? '' : hint(mandatoryText(d))) + '</div>';
        h += '<div class="bhp-group">' + U.label(c.isAgency ? 'Coordonnées' : 'Coordonnées et facturation') + card(coordFields(d, !c.isAgency)) + '</div>';
      } else {
        var biz = c.clientType === 'business';
        if (c.hasOverride) h += '<div class="bho-override">' + ic('pencil') + 'Coordonnées personnalisées</div>';
        h += '<div class="bhp-group">' + U.label('Identité') + card(readRow('Type', biz ? 'Société' : 'Particulier') + (biz ? readRow('Raison sociale', c.companyName) : readRow('Prénom', c.firstName) + readRow('Nom', c.lastName)) + (c.siret ? readRow('SIRET', c.siret) : '')) + '</div>';
        if (c.email || c.phone) h += '<div class="bhp-group">' + U.label('Contact') + card((c.email ? '<a class="bhp-row bhp-kv bho-link" href="mailto:' + esc(c.email) + '"><span class="bhp-kv__l" style="font-size:14.5px">Email</span><span class="bhp-kv__v" style="font-size:14.5px">' + esc(c.email) + '</span></a>' : '')
          + (c.phone ? '<a class="bhp-row bhp-kv bho-link" href="tel:' + esc(c.phone.replace(/[^\d+]/g, '')) + '"><span class="bhp-kv__l" style="font-size:14.5px">Téléphone</span><span class="bhp-kv__v" style="font-size:14.5px">' + esc(c.phone) + '</span></a>' : '')) + '</div>';
        if (c.address || c.postalCode || c.city) h += '<div class="bhp-group">' + U.label('Adresse') + card((c.address ? readRow('Adresse', c.address) : '') + (c.postalCode ? readRow('Code postal', c.postalCode) : '') + (c.city ? readRow('Ville', c.city) : '')) + '</div>';
        h += '<div class="bhp-group">' + U.label('Facturation') + card(readRow('Commission par défaut', rateLabel(c.rate))) + '</div>';
        h += '<div class="bhp-group"><div class="bho-lblrow">' + U.label('Logements associés') + '<button class="bhp-textbtn bhp-textbtn--vert" style="font-size:13.5px;font-weight:500" data-act="cd-assign">Modifier</button></div>'
          + card(!D.assoc.length ? htmlRow('<span class="bhp-empty">Aucun logement associé</span>') : D.assoc.map(function (p) {
            return '<a class="bhp-row bho-prop" href="/property.html?id=' + encodeURIComponent(p.id) + '">' + ic('house') + '<span>' + esc(U.dname(p)) + '</span>' + CHEV + '</a>';
          }).join('')) + '</div>';
        if (!c.isAgency) h += '<button class="bhp-btn bhp-btn--danger" style="font-weight:600" data-act="cd-delete"' + (D.deleting ? ' disabled' : '') + '>' + (D.deleting ? U.SPIN : 'Supprimer ce client') + '</button>';
      }
      root.innerHTML = U.navHTML({ kicker: 'Propriétaire', title: c.name, left: left, right: right }) + '<div class="bhp-stack" data-cd-body>' + h + '</div>';
      document.title = c.name + ' — Propriétaires';
    }
    function draftFrom(c) { return { clientType: c.clientType || 'individual', firstName: c.firstName, lastName: c.lastName, companyName: c.companyName, email: c.email, phone: c.phone, siret: c.siret, address: c.address, postalCode: c.postalCode, city: c.city, rate: c.rate == null ? '' : String(c.rate) }; }
    function readDraft() { var b = root.querySelector('[data-cd-body]'); if (!b || !S.detail || !S.detail.editing) return; b.querySelectorAll('[data-f]').forEach(function (el) { S.detail.draft[el.dataset.f] = el.value; }); }
    function saveClient() {
      var D = S.detail, c = D.client, d = D.draft; if (!validDraft(d)) return;
      D.saving = true; render();
      var p;
      if (c.isAgency) {
        if (D.client.delegatorUserId == null) { D.saving = false; render(); U.alertMsg('Erreur', 'Compte délégant introuvable.'); return; }
        var b = clientBody(d);
        p = U.api('PATCH', '/api/agency/client-override/' + encodeURIComponent(c.delegatorUserId) + '/' + encodeURIComponent(c.matchingId),
          { first_name: b.firstName, last_name: b.lastName, company_name: b.companyName, email: b.email, siret: b.siret, phone: b.phone, address: b.address, postal_code: b.postalCode, city: b.city });
      } else p = U.api('PUT', '/api/owner-clients/' + encodeURIComponent(c.id), clientBody(d));
      p.then(function (r) {
        var n = normClient(r.client || r);
        if (!n.id) n = normClient(Object.assign({}, c._raw || {}, clientBody(d), { id: c.id }));
        if (c.isAgency) { n.isAgency = true; n.delegatorUserId = c.delegatorUserId; n.delegatorName = c.delegatorName; n.hasOverride = true; }
        D.client = n; D.editing = false;
        var i = S.clients.findIndex(function (x) { return x.id === c.id; }); if (i >= 0) S.clients[i] = n;
      }).catch(function (er) { U.alertMsg('Erreur', er.message || 'Une erreur est survenue.'); })
        .then(function () { D.saving = false; render(); });
    }
    function deleteClient() {
      var D = S.detail, n = D.assoc.length;
      U.dialog({ title: 'Supprimer ce client ?', message: n ? 'Ce client gère ' + pl(n, 'logement') + '. Ils ne seront plus associés à aucun propriétaire.' : 'Cette action est définitive.',
        actions: [{ label: 'Annuler', role: 'cancel', value: false }, { label: n ? 'Supprimer quand même' : 'Supprimer', role: 'destructive', value: true }] }).then(function (ok) {
        if (!ok) return;
        D.deleting = true; render();
        U.api('DELETE', '/api/owner-clients/' + encodeURIComponent(D.client.id)).then(function () {
          S.clients = S.clients.filter(function (x) { return x.id !== D.client.id; }); closeClient(); loadList();
        }).catch(function (er) { D.deleting = false; render(); U.alertMsg('Erreur', er.message || 'Erreur lors de la suppression.'); });
      });
    }

    function render() { if (S.view === 'client' && S.detail) renderClient(); else renderList(); }

    root.addEventListener('click', function (e) {
      var s = e.target.closest('[data-seg]');
      if (s && S.detail && S.detail.editing) { readDraft(); S.detail.draft[s.dataset.seg] = s.dataset.v; render(); return; }
      var el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
      var act = el.dataset.act;
      if (act === 'back') { location.href = '/manage.html'; return; }
      if (act === 'retry') return loadList();
      if (act === 'new') return openCreateSheet(function (c) { S.clients.unshift(c); render(); loadList(); });
      if (act === 'open') return openClient(S.clients[+el.dataset.i], true);
      var D = S.detail; if (!D) return;
      if (act === 'cd-back') return closeClient();
      if (act === 'cd-retry') return openClient(D.client, false);
      if (act === 'cd-edit') { D.draft = draftFrom(D.client); D.editing = true; render(); return; }
      if (act === 'cd-cancel') { D.editing = false; D.draft = null; render(); return; }
      if (act === 'cd-save') { readDraft(); return saveClient(); }
      if (act === 'cd-delete') return deleteClient();
      if (act === 'cd-assign') return openAssignSheet(D.client, D.all, S.clients, D.assoc.map(function (p) { return p.id; }), function () { loadAssoc(D).then(function () { render(); loadList(); }); });
    });
    root.addEventListener('input', function (e) {
      if (!S.detail || !S.detail.editing || !e.target.dataset.f) return;
      var was = validDraft(S.detail.draft); S.detail.draft[e.target.dataset.f] = e.target.value;
      if (was !== validDraft(S.detail.draft)) { var f = e.target.dataset.f, pos = e.target.selectionStart; render(); var n = root.querySelector('[data-f="' + f + '"]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) {} } }
    });
    window.addEventListener('popstate', function () {
      var id = new URLSearchParams(location.search).get('client');
      if (!id) { S.view = null; S.detail = null; render(); window.scrollTo(0, S.listScroll); return; }
      var c = S.clients.filter(function (x) { return x.id === id; })[0]; if (c) openClient(c, false);
    });

    var startId = new URLSearchParams(location.search).get('client');
    if (startId) {
      U.api('GET', '/api/owner-clients').then(function (r) {
        S.clients = (r.clients || []).map(normClient);
        var c = S.clients.filter(function (x) { return x.id === startId; })[0];
        if (c) openClient(c, false); else { history.replaceState(null, '', location.pathname); }
        loadList();
      }).catch(loadList);
    } else loadList();
  };
})();
