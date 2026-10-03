/* bh-factures-ios-16.js — Propriétaires › Factures propriétaires (OwnerInvoicesView + détail)
   /factures-proprio.html        → liste
   /factures-proprio.html?id=ID  → détail
   Dépend de bh-prop-ios-12.js (BHP.ui). */
(function () {
  'use strict';
  var BHP = window.BHP || {}, U = BHP.ui;
  if (!U) { console.error('bh-factures-ios-16 : charger bh-prop-ios-12.js avant.'); return; }
  var esc = U.esc, pick = U.pick, I = U.I, ic = U.ic, card = U.card, htmlRow = U.htmlRow, CHEV = U.CHEV;
  var FILTERS = [['all', 'Toutes'], ['draft', 'Brouillons'], ['invoiced', 'Finalisées'], ['sent', 'Envoyées'], ['paid', 'Payées']];
  var STATUS = { draft: ['Brouillon', 'neutre'], invoiced: ['Finalisée', 'or'], sent: ['Envoyée', 'or'], paid: ['Payée', 'vert'] };

  function dayFr(iso) { if (!iso) return ''; var d = new Date(String(iso).slice(0, 10) + 'T00:00:00'); return isNaN(d) ? String(iso) : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); }
  function money(v) { return v == null ? '—' : U.fmtAmount(v); }
  function norm(x) {
    x = x || {};
    var b = U.bool;
    return {
      id: String(pick(x, 'id', '_id') || ''), number: pick(x, 'invoiceNumber', 'invoice_number') || null, status: x.status || null,
      isCredit: b(pick(x, 'isCreditNote', 'is_credit_note')) === true, originalId: pick(x, 'originalInvoiceId', 'original_invoice_id'),
      clientId: pick(x, 'clientId', 'client_id'), clientName: pick(x, 'clientName', 'client_name'), clientAddress: pick(x, 'clientAddress', 'client_address'),
      clientSiret: pick(x, 'clientSiret', 'client_siret'), clientEmail: pick(x, 'clientEmail', 'client_email'), clientPhone: pick(x, 'clientPhone', 'client_phone'),
      issueDate: pick(x, 'issueDate', 'issue_date'), dueDate: pick(x, 'dueDate', 'due_date'), periodStart: pick(x, 'periodStart', 'period_start'), periodEnd: pick(x, 'periodEnd', 'period_end'),
      subtotal: U.num(pick(x, 'subtotalHt', 'subtotal_ht')), debours: U.num(pick(x, 'deboursTotal', 'debours_total')), discount: U.num(pick(x, 'discountAmount', 'discount_amount')),
      tvaRate: U.num(pick(x, 'tvaRate', 'tva_rate')), tva: U.num(pick(x, 'tvaAmount', 'tva_amount')), total: U.num(pick(x, 'totalTtc', 'total_ttc')),
      payDelay: U.int(pick(x, 'paymentDelay', 'payment_delay')), payMode: pick(x, 'paymentMode', 'payment_mode'), lateRate: U.num(pick(x, 'lateInterestRate', 'late_interest_rate')),
      notes: x.notes || null
    };
  }
  function normItem(it) {
    return { type: pick(it, 'itemType', 'item_type'), desc: it.description || '—', rental: U.num(pick(it, 'rentalAmount', 'rental_amount')), rate: U.num(pick(it, 'commissionRate', 'commission_rate')),
      qty: U.num(it.quantity), unit: U.num(pick(it, 'unitPrice', 'unit_price')), total: U.num(it.total), order: U.int(pick(it, 'orderIndex', 'order_index')) || 0,
      isDebours: U.bool(pick(it, 'isDebours', 'is_debours')) === true };
  }
  function pill(inv) { if (inv.isCredit) return U.pill('Avoir', 'or'); var s = STATUS[inv.status]; return U.pill(s ? s[0] : (inv.status || '—'), s ? s[1] : 'neutre'); }
  var PAY = { virement: 'Virement bancaire', cheque: 'Chèque', especes: 'Espèces', carte: 'Carte bancaire', prelevement: 'Prélèvement' };
  function openPdf(id) {
    var w = U.pdfWindow(), f = typeof window.authFetch === 'function' ? window.authFetch : fetch;
    f('/api/owner-invoices/' + encodeURIComponent(id) + '/pdf', { method: 'POST' }).then(function (r) { if (!r.ok) throw new Error('Impossible de charger le PDF.'); return r.blob(); })
      .then(function (b) { var u = URL.createObjectURL(b); if (w) w.location = u; else location.href = u; })
      .catch(function (e) { if (w) w.close(); U.alertMsg('Erreur PDF', e.message); });
  }

  BHP.initFacturesProprio = function () {
    var root = document.getElementById('bhpApp');
    var S = { filter: 'all', state: 'loading', list: [], view: null, D: null, listScroll: 0 };

    function filtered() {
      var b = S.filter === 'all' ? S.list : S.list.filter(function (x) { return x.status === S.filter; });
      return b.slice().sort(function (a, c) { var l = a.issueDate || '', r = c.issueDate || ''; return l < r ? 1 : l > r ? -1 : 0; });
    }
    function count(f) { return f === 'all' ? S.list.length : S.list.filter(function (x) { return x.status === f; }).length; }
    function reload(silent) {
      if (!silent && S.state !== 'loaded') { S.state = 'loading'; render(); }
      return U.api('GET', '/api/owner-invoices').then(function (r) { S.list = (r.invoices || []).map(norm); S.state = 'loaded'; })
        .catch(function () { if (!silent) S.state = 'error'; }).then(render);
    }

    /* ── Actions (identiques au menu contextuel iOS) ── */
    var CONFIRM = {
      finalize: ['Valider cette facture ?', 'Un numéro définitif sera attribué et la facture ne pourra plus être modifiée.', 'Valider', 'finalize', 'Erreur lors de la validation.'],
      sendDraft: ['Envoyer cette facture ?', 'La facture sera validée et envoyée au client par email.', 'Envoyer', 'send', 'Erreur lors de l\'envoi.'],
      send: ['Envoyer cette facture ?', 'La facture sera envoyée au client par email.', 'Envoyer', 'send', 'Erreur lors de l\'envoi.'],
      del: ['Supprimer ce brouillon ?', 'Cette action est définitive.', 'Supprimer', null, 'Erreur lors de la suppression.'],
      credit: ['Créer un avoir ?', 'Un avoir du même montant sera généré et annulera cette facture.', 'Créer l\'avoir', 'credit-note', 'Erreur lors de la création de l\'avoir.']
    };
    function run(kind, inv, after) {
      function go() {
        var c = CONFIRM[kind] || [null, null, null, 'mark-paid', 'Erreur lors du marquage.'];
        var p = kind === 'del' ? U.api('DELETE', '/api/owner-invoices/' + encodeURIComponent(inv.id))
          : U.api('POST', '/api/owner-invoices/' + encodeURIComponent(inv.id) + '/' + c[3], {});
        if (S.D) { S.D.busy = true; render(); }
        return p.then(function () { return reload(true); }).then(function () { if (after) after(); })
          .catch(function (e) { U.alertMsg('Erreur', e.message || c[4]); })
          .then(function () { if (S.D) { S.D.busy = false; render(); } });
      }
      if (kind === 'paid') return go();
      var c2 = CONFIRM[kind];
      U.dialog({ title: c2[0], message: c2[1], actions: [{ label: 'Annuler', role: 'cancel', value: false }, { label: c2[2], role: kind === 'del' ? 'destructive' : null, value: true }] })
        .then(function (ok) { if (ok) go(); });
    }
    function actionsFor(inv) {
      var a = [];
      if (inv.status === 'draft') a.push(['finalize', 'Valider la facture', 'check']);
      if (inv.status === 'draft' || inv.status === 'invoiced') a.push([inv.status === 'draft' ? 'sendDraft' : 'send', 'Envoyer', 'mail']);
      if (inv.status === 'invoiced' || inv.status === 'sent') a.push(['paid', 'Marquer payée', 'checkFill']);
      if (inv.status === 'draft') a.push(['del', 'Supprimer', 'trash']);
      return a;
    }

    /* ── Liste ── */
    function renderList() {
      var f = filtered();
      var kick = S.state === 'loaded' ? U.pl(f.length, 'facture') : '';
      var chips = '<div class="bhp-chips"><div class="bhp-chips__in">' + FILTERS.map(function (x) {
        var n = count(x[0]);
        return '<button class="bhc-chip' + (S.filter === x[0] ? ' is-on' : '') + '" data-act="filter" data-v="' + x[0] + '">' + x[1] + (n > 0 && x[0] !== 'all' ? ' <span class="bhf-n">' + n + '</span>' : '') + '</button>';
      }).join('') + '</div></div>';
      var nav = '<header class="bhp-nav"><div class="bhm-nav__in">' + U.circleBtn('chevL', 'back', 'Propriétaires')
        + '<div class="bhm-nav__t"><div class="bhp-nav__kicker" style="text-align:left">' + (esc(kick) || '&#160;') + '</div><h1 class="bhm-title">Factures propriétaires</h1></div></div>' + chips + '</header>';
      var h;
      if (S.state === 'loading') h = '<div class="bhp-state bhp-center"><span class="bhp-spin bhp-spin--lg"></span></div>';
      else if (S.state === 'error') h = '<div class="bhm-empty">' + ic('warnFill') + '<span>Impossible de charger les factures.</span><button class="bhp-glassbtn" data-act="retry">Réessayer</button></div>';
      else if (!f.length) h = '<div class="bhm-empty"><b style="color:#14201B;font-size:16px">Aucune facture</b><span>Aucune facture ' + ({ all: '', draft: 'en brouillon', invoiced: 'finalisée', sent: 'envoyée', paid: 'payée' })[S.filter] + ' pour le moment.</span></div>';
      else h = card(f.map(function (inv) {
        var i = S.list.indexOf(inv);
        return '<div class="bhp-row bho-cl" data-act="open" data-i="' + i + '"><div class="bho-cl__t"><div class="bhf-num"><span' + (inv.number ? '' : ' class="bhp-att"') + '>' + esc(inv.number || 'Brouillon') + '</span>' + (inv.isCredit ? '<span class="bhf-avoir">avoir</span>' : '') + '</div>'
          + (inv.clientName ? '<div class="bhp-meta" style="font-size:12.5px">' + esc(inv.clientName) + '</div>' : '') + '</div>'
          + '<div class="bhc-right">' + pill(inv) + '<span class="bhf-amt">' + (inv.total != null ? '<b>' + esc(money(inv.total)) + '</b>' : '') + (inv.issueDate ? '<span class="bhp-meta" style="font-size:12px">' + esc(dayFr(inv.issueDate)) + '</span>' : '') + '</span></div>'
          + (actionsFor(inv).length ? '<button class="bhp-dots" data-act="menu" data-i="' + i + '" aria-label="Actions">' + I.ellipsis + '</button>' : '<span style="width:32px"></span>') + '</div>';
      }).join(''));
      root.innerHTML = nav + '<div class="bhp-stack">' + h + '</div>';
      document.title = 'Factures propriétaires — Boostinghost';
    }

    /* ── Détail ── */
    function openDetail(id, push) {
      S.listScroll = window.scrollY;
      S.view = 'detail'; S.D = { id: id, state: 'loading', inv: null, items: [], props: [], busy: false };
      if (push) history.pushState({ bhfId: id }, '', location.pathname + '?id=' + encodeURIComponent(id));
      render(); window.scrollTo(0, 0);
      loadDetail(S.D);
    }
    function loadDetail(D) {
      return U.api('GET', '/api/owner-invoices/' + encodeURIComponent(D.id)).then(function (r) {
        D.inv = norm(r.invoice || r); if (!D.inv.id) D.inv.id = D.id;
        D.items = (r.items || []).map(normItem).sort(function (a, b) { return a.order - b.order; });
        D.props = (r.properties || []).map(function (p) { return { id: String(p.id || ''), name: p.name || '—', address: p.address || '' }; });
        D.state = 'loaded';
      }).catch(function () { D.state = 'error'; }).then(function () { if (S.D === D) render(); });
    }
    function closeDetail() {
      if (history.state && history.state.bhfId) { history.back(); return; }
      history.replaceState(null, '', location.pathname); S.view = null; S.D = null; render(); window.scrollTo(0, S.listScroll);
    }
    function kv(l, v, cls) { return '<div class="bhp-row bhp-kv"><span class="bhp-kv__l" style="font-size:14.5px">' + esc(l) + '</span><span class="bhp-kv__v ' + (cls || '') + '" style="font-size:14.5px">' + esc(v) + '</span></div>'; }
    function renderDetail() {
      var D = S.D, inv = D.inv;
      var right = D.state === 'loaded' && inv.number ? U.circleBtn('doc', 'pdf', 'PDF') : '';
      var nav = '<header class="bhp-nav"><div class="bhm-nav__in">' + U.circleBtn('chevL', 'd-back', 'Factures')
        + '<div class="bhm-nav__t"><div class="bhp-nav__kicker" style="text-align:left">' + esc(inv ? (inv.isCredit ? 'Avoir' : (STATUS[inv.status] || [inv.status || ''])[0]) : '') + '&#160;</div><h1 class="bhm-title">' + esc(inv ? (inv.number || 'Brouillon') : 'Facture') + '</h1></div>' + right + '</div></header>';
      var h = '';
      if (D.state === 'loading') h = '<div class="bhp-state bhp-center"><span class="bhp-spin bhp-spin--lg"></span></div>';
      else if (D.state === 'error') h = '<div class="bhm-empty">' + ic('warnFill') + '<span>Impossible de charger la facture.</span><button class="bhp-glassbtn" data-act="d-retry">Réessayer</button></div>';
      else {
        h += '<div class="bhp-card bhf-hero"><div class="bhf-hero__l"><span class="bhp-meta">Total TTC</span><b>' + esc(money(inv.total)) + '</b></div>' + pill(inv) + '</div>';
        h += '<div class="bhp-group">' + U.label('Client') + card(htmlRow('<div style="font-size:16px;font-weight:600">' + esc(inv.clientName || '—') + '</div>'
          + (inv.clientAddress ? '<div class="bhp-meta" style="margin-top:3px;white-space:pre-line">' + esc(inv.clientAddress) + '</div>' : ''))
          + (inv.clientSiret ? kv('SIRET', inv.clientSiret) : '') + (inv.clientEmail ? kv('Email', inv.clientEmail) : '') + (inv.clientPhone ? kv('Téléphone', inv.clientPhone) : '')) + '</div>';
        var dates = (inv.issueDate ? kv('Date d\'émission', dayFr(inv.issueDate)) : '') + (inv.dueDate ? kv('Échéance', dayFr(inv.dueDate)) : '')
          + (inv.periodStart || inv.periodEnd ? kv('Période', [dayFr(inv.periodStart), dayFr(inv.periodEnd)].filter(Boolean).join(' → ')) : '');
        if (dates) h += '<div class="bhp-group">' + U.label('Dates') + card(dates) + '</div>';
        if (D.props.length) h += '<div class="bhp-group">' + U.label('Logements') + card(D.props.map(function (p) { return '<div class="bhp-row bho-prop">' + ic('house') + '<span>' + esc(p.name) + '</span></div>'; }).join('')) + '</div>';
        var prest = D.items.filter(function (x) { return !x.isDebours; }), deb = D.items.filter(function (x) { return x.isDebours; });
        function itemRow(x) {
          var sub = [];
          if (x.rental != null && x.rate != null) sub.push(money(x.rental) + ' × ' + (Math.round(x.rate * 100) / 100) + '\u202f%');
          else if (x.qty != null && x.unit != null && x.qty !== 1) sub.push(x.qty + ' × ' + money(x.unit));
          return '<div class="bhp-row bhf-item"><div class="bho-cl__t"><span class="bhf-item__d">' + esc(x.desc) + '</span>' + (sub.length ? '<span class="bhp-meta" style="font-size:12.5px">' + esc(sub.join(' · ')) + '</span>' : '') + '</div><b>' + esc(money(x.total)) + '</b></div>';
        }
        if (prest.length) h += '<div class="bhp-group">' + U.label('Prestations') + card(prest.map(itemRow).join('')) + '</div>';
        if (deb.length) h += '<div class="bhp-group">' + U.label('Débours') + card(deb.map(itemRow).join('')) + '</div>';
        h += '<div class="bhp-group">' + U.label('Totaux') + card(kv('Sous-total HT', money(inv.subtotal)) + (inv.debours ? kv('Débours', money(inv.debours)) : '') + (inv.discount ? kv('Remise', '−' + money(inv.discount)) : '')
          + kv('TVA' + (inv.tvaRate != null ? ' (' + inv.tvaRate + '\u202f%)' : ''), money(inv.tva)) + '<div class="bhp-row bhp-kv"><span class="bhp-kv__l bhp-kv__l--ink" style="font-weight:600">Total TTC</span><span class="bhp-kv__v" style="font-size:16px;font-weight:700">' + esc(money(inv.total)) + '</span></div>') + '</div>';
        var cond = (inv.payDelay != null ? kv('Délai de paiement', U.pl(inv.payDelay, 'jour')) : '') + (inv.payMode ? kv('Mode', PAY[inv.payMode] || inv.payMode) : '') + (inv.lateRate != null ? kv('Intérêts de retard', inv.lateRate + '\u202f%') : '');
        if (cond) h += '<div class="bhp-group">' + U.label('Conditions de paiement') + card(cond) + '</div>';
        if (inv.notes) h += '<div class="bhp-group">' + U.label('Notes') + card(htmlRow('<div class="bhp-txt">' + esc(inv.notes) + '</div>')) + '</div>';
        var acts = actionsFor(inv), bar = '';
        acts.forEach(function (a, i) {
          var cls = a[0] === 'del' ? 'bhp-btn--danger' : (i === 0 ? 'bhp-btn--primary' : 'bhp-btn--mint');
          bar += '<button class="bhp-btn ' + cls + '" data-act="do" data-k="' + a[0] + '"' + (D.busy ? ' disabled' : '') + '>' + (D.busy && i === 0 ? '<span class="bhp-spin bhp-spin--w"></span>' : ic(a[2])) + esc(a[1]) + '</button>';
        });
        if (inv.number && !inv.isCredit && (inv.status === 'invoiced' || inv.status === 'sent' || inv.status === 'paid')) bar += '<button class="bhp-btn bhp-btn--ghost" data-act="do" data-k="credit"' + (D.busy ? ' disabled' : '') + '>' + ic('sync') + 'Créer un avoir</button>';
        if (inv.number) bar += '<button class="bhp-btn bhp-btn--ghost" data-act="pdf">' + ic('doc') + 'Voir le PDF</button>';
        if (bar) h += '<div class="bhp-group">' + bar + '</div>';
      }
      root.innerHTML = nav + '<div class="bhp-stack">' + h + '</div>';
    }

    function render() { if (S.view === 'detail' && S.D) renderDetail(); else renderList(); }

    root.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
      var a = el.dataset.act;
      if (a === 'back') { location.href = '/proprietaires.html'; return; }
      if (a === 'retry') return reload();
      if (a === 'filter') { S.filter = el.dataset.v; render(); return; }
      if (a === 'menu') {
        e.stopPropagation();
        var inv = S.list[+el.dataset.i];
        return U.openMenu(el, actionsFor(inv).map(function (x) { return { label: x[1], icon: x[2], danger: x[0] === 'del', onClick: function () { run(x[0], inv); } }; }));
      }
      if (a === 'open') return openDetail(S.list[+el.dataset.i].id, true);
      var D = S.D; if (!D) return;
      if (a === 'd-back') return closeDetail();
      if (a === 'd-retry') { D.state = 'loading'; render(); return loadDetail(D); }
      if (a === 'pdf') return openPdf(D.id);
      if (a === 'do') { var k = el.dataset.k; return run(k, D.inv, function () { if (k === 'del') closeDetail(); else loadDetail(D); }); }
    });
    window.addEventListener('popstate', function () {
      var id = new URLSearchParams(location.search).get('id');
      if (id) openDetail(id, false); else { S.view = null; S.D = null; render(); window.scrollTo(0, S.listScroll); }
    });
    var start = new URLSearchParams(location.search).get('id');
    reload();
    if (start) openDetail(start, false);
  };
})();
