/* bh-sejours-ios-19.js — Gestion › Séjours (StaysView + DepositDetailSheet + InvoiceDetailSheet)
   /sejours.html (?vue=factures) — dépend de bh-prop-ios-12.js (BHP.ui). */
(function () {
  'use strict';
  var BHP = window.BHP || {}, U = BHP.ui;
  if (!U) { console.error('bh-sejours-ios-19 : charger bh-prop-ios-12.js avant.'); return; }
  var esc = U.esc, pick = U.pick, I = U.I, ic = U.ic, card = U.card, htmlRow = U.htmlRow, CHEV = U.CHEV;
  var DAY = 86400000;

  function day0(s) { if (!s) return null; var d = new Date(String(s).slice(0, 10) + 'T00:00:00'); return isNaN(d) ? null : d; }
  function dayFr(s) { var d = s instanceof Date ? s : day0(s); return d ? d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).toLowerCase() : '—'; }
  function hm(d) { var h = d.getHours(), m = d.getMinutes(); return m ? h + '\u00a0h\u00a0' + String(m).padStart(2, '0') : h + '\u00a0h'; }
  function money(v) { return v == null ? '—' : U.fmtAmount(v); }

  function normDep(r) {
    var dep = r.deposit || {};
    var cents = U.int(pick(dep, 'amountCents', 'amount_cents'));
    if (cents == null) cents = U.int(pick(r, 'amountCents', 'amount_cents'));
    var ae = pick(dep, 'authExpired', 'auth_expired'); if (ae == null) ae = pick(r, 'authExpired', 'auth_expired');
    var o = {
      id: String(pick(r, '_id', 'id') || Math.random()), depositId: String(pick(dep, '_id', 'id') || pick(r, 'depositId', 'deposit_id') || ''),
      guest: pick(r, 'guestName', 'guest_name') || 'Voyageur', property: pick(r, 'propertyName', 'property_name') || '—',
      checkOut: pick(r, 'endDate', 'end_date', 'checkOut', 'check_out'), amount: cents == null ? null : cents / 100, cents: cents,
      status: pick(dep, 'status') || pick(r, 'depositStatus', 'deposit_status') || null,
      releaseDays: U.int(pick(r, 'depositReleaseDays', 'deposit_release_days')), authorizedAt: pick(dep, 'authorizedAt', 'authorized_at') || pick(r, 'authorizedAt', 'authorized_at'),
      checkoutUrl: pick(dep, 'checkoutUrl', 'checkout_url'), createdAt: pick(dep, 'createdAt', 'created_at')
    };
    o.expired = ae != null ? U.bool(ae) === true : o.status === 'auth_expired';
    var co = day0(o.checkOut);
    o.overdueDays = 0; o.overdue = false;
    if (co && o.releaseDays != null) { var dl = new Date(co.getTime() + o.releaseDays * DAY); o.overdue = Date.now() > dl; o.overdueDays = Math.max(0, Math.floor((Date.now() - dl) / DAY)); }
    o.expiry = o.authorizedAt && !isNaN(new Date(o.authorizedAt)) ? new Date(new Date(o.authorizedAt).getTime() + 7 * DAY) : null;
    o.hoursLeft = o.expiry ? Math.floor((o.expiry - Date.now()) / 3600000) : null;
    o.within48 = o.expiry ? (o.expiry - Date.now() > 0 && o.expiry - Date.now() < 48 * 3600000) : false;
    o.canAct = o.status === 'authorized' && !o.expired;
    var today = new Date(); today.setHours(0, 0, 0, 0);
    if (!co) o.depPrefix = 'départ —';
    else if (co >= today) o.depPrefix = 'départ le ' + dayFr(co);
    else {
      var y = new Date(today.getTime() - DAY), part = co.getTime() === y.getTime() ? 'hier' : dayFr(co);
      if (String(o.checkOut).indexOf('T') >= 0) { var dt = new Date(o.checkOut); if (!isNaN(dt)) part += ' ' + hm(dt); }
      o.depPrefix = 'partie ' + part;
    }
    return o;
  }
  function depStatus(o) {
    if (o.expired) return ['Expirée', 'neutre'];
    return ({ authorized: ['Autorisée', 'vert'], captured: ['Retenue', 'terra'], released: ['Restituée', 'vert'] })[o.status] || [o.status || '—', 'neutre'];
  }
  function normInv(x) {
    var n = U.num;
    return { number: pick(x, 'invoiceNumber', 'invoice_number') || null, client: pick(x, 'clientName', 'client_name') || 'Voyageur', email: pick(x, 'clientEmail', 'client_email') || '',
      company: pick(x, 'clientCompany', 'client_company'), siret: pick(x, 'clientSiret', 'client_siret'),
      address: [pick(x, 'clientAddress', 'client_address'), pick(x, 'clientPostalCode', 'client_postal_code'), pick(x, 'clientCity', 'client_city')].filter(Boolean).join(' '),
      nationality: pick(x, 'clientNationality', 'client_nationality'), property: pick(x, 'propertyName', 'property_name') || '—',
      checkin: pick(x, 'checkinDate', 'checkin_date'), checkout: pick(x, 'checkoutDate', 'checkout_date'), nights: U.int(x.nights), platform: x.platform,
      rent: n(pick(x, 'rentAmount', 'rent_amount')), tax: n(pick(x, 'touristTaxAmount', 'tourist_tax_amount')), cleaning: n(pick(x, 'cleaningFee', 'cleaning_fee')),
      vatRate: n(pick(x, 'vatRate', 'vat_rate')), vat: n(pick(x, 'vatAmount', 'vat_amount')), total: n(x.total), createdAt: pick(x, 'createdAt', 'created_at'),
      conversationId: U.int(pick(x, 'conversationId', 'conversation_id')), reservationUid: pick(x, 'reservationUid', 'reservation_uid') };
  }

  BHP.initSejours = function () {
    var root = document.getElementById('bhpApp');
    var S = { tab: new URLSearchParams(location.search).get('vue') === 'factures' ? 'factures' : 'cautions', dState: 'loading', iState: 'loading', deps: [], invs: [], showExpired: false };
    function cats() {
      return {
        toRelease: S.deps.filter(function (d) { return d.status === 'authorized' && !d.expired && d.overdue; }),
        inProgress: S.deps.filter(function (d) { return d.status === 'authorized' && !d.expired && !d.overdue; }),
        expired: S.deps.filter(function (d) { return d.expired; })
      };
    }
    function loadDeps() {
      return U.api('GET', '/api/reservations-with-deposits').then(function (r) { S.deps = (Array.isArray(r) ? r : (r.reservations || [])).map(normDep).filter(function (d) { return d.depositId; }); S.dState = 'loaded'; })
        .catch(function (e) { S.dState = 'error'; S.dErr = e.status === 401 ? 'Session expirée.' : (e.message || 'Chargement impossible.'); }).then(render);
    }
    function loadInvs() {
      return U.api('GET', '/api/invoice/history').then(function (r) { S.invs = (r.invoices || []).map(normInv); S.iState = 'loaded'; })
        .catch(function (e) { S.iState = 'error'; S.iErr = e.message || 'Chargement impossible.'; }).then(render);
    }
    function render() {
      var c = cats(), n = c.toRelease.length;
      var kick = n ? (n === 1 ? '1 à restituer' : n + ' à restituer') : '';
      var seg = '<div class="bhm-seg"><button class="bhm-seg__b' + (S.tab === 'cautions' ? ' is-on' : '') + '" data-act="tab" data-v="cautions">Cautions · ' + (c.toRelease.length + c.inProgress.length) + '</button>'
        + '<button class="bhm-seg__b' + (S.tab === 'factures' ? ' is-on' : '') + '" data-act="tab" data-v="factures">Factures · ' + (S.iState === 'loaded' ? S.invs.filter(function (i) { return i.number; }).length : '—') + '</button></div>';
      var nav = '<header class="bhp-nav"><div class="bhm-nav__in">' + U.circleBtn('chevL', 'back', 'Gestion') + '<div class="bhm-nav__t"><div class="bhp-nav__kicker" style="text-align:left">' + (esc(kick) || '&#160;') + '</div><h1 class="bhm-title">Séjours</h1></div></div><div class="bhm-nav__in2">' + seg + '</div></header>';
      root.innerHTML = nav + '<div class="bhp-stack bhm-stack">' + (S.tab === 'cautions' ? cautions(c) : factures()) + '</div>';
    }
    function loading() { return '<div class="bhp-state bhp-center"><span class="bhp-spin bhp-spin--lg"></span></div>'; }
    function err(m) { return '<div class="bhm-empty">' + ic('warnFill') + '<span>' + esc(m) + '</span><button class="bhp-glassbtn" data-act="retry">Réessayer</button></div>'; }
    function cautions(c) {
      if (S.dState === 'loading') return loading();
      if (S.dState === 'error') return err(S.dErr);
      var act = c.toRelease.concat(c.inProgress), tot = act.reduce(function (s, d) { return s + (d.amount || 0); }, 0);
      var h = '<div class="bhp-card bhf-hero" style="flex-direction:column;align-items:flex-start;gap:6px"><span class="bhp-label" style="margin:0">Empreintes en cours</span><b class="bhs-hero">' + esc(money(tot)) + '</b><span class="bhp-meta">sur ' + U.pl(act.length, 'séjour') + '</span></div>';
      if (c.toRelease.length) {
        h += U.label('À restituer');
        h += c.toRelease.map(function (d) {
          var i = S.deps.indexOf(d), od = d.overdueDays;
          return '<div class="bhm-tight bhs-urgent" data-act="dep" data-i="' + i + '"><span class="bhm-tight__rail" style="background:linear-gradient(180deg,#C4552F,#A8452A)"></span><div class="bhm-ac">'
            + '<div class="bhm-ac__top"><div class="bhm-ac__n bhm-ac__txt">' + esc(d.guest) + '</div><div class="bhm-ac__n">' + esc(money(d.amount)) + '</div></div>'
            + '<div class="bhp-meta">' + esc(d.property + ' · ' + d.depPrefix) + '</div>'
            + '<div style="font-size:13px;font-weight:500;color:#A8452A">À restituer — délai dépassé' + (od === 0 ? '' : od === 1 ? ' de 1 jour' : ' de ' + od + ' jours') + '</div>'
            + (d.expiry && !d.within48 ? '<div class="bhp-meta" style="font-size:12px">expire le ' + esc(dayFr(d.expiry)) + '</div>' : '')
            + (d.within48 && d.hoursLeft != null ? '<div class="bhs-warn">' + ic('warnFill') + 'expire dans ' + d.hoursLeft + ' h — dernière chance de capturer</div>' : '')
            + '<div class="bhm-vc__acts"><button class="bhm-call" data-act="release" data-i="' + i + '">Restituer</button><button class="bhp-glassbtn bhm-reject" style="color:#2C3A33" data-act="capture" data-i="' + i + '">Retenir</button><span style="flex:1"></span><span style="font-size:13px;font-weight:600;color:#2C3A33;align-self:center">Voir la fiche →</span></div></div></div>';
        }).join('');
      }
      if (c.inProgress.length) {
        if (c.toRelease.length) h += U.label('En cours');
        h += card(c.inProgress.map(function (d) {
          var i = S.deps.indexOf(d);
          return '<div class="bhp-row bho-cl" data-act="dep" data-i="' + i + '"><div class="bho-cl__t"><div class="bho-cl__n">' + esc(d.guest) + '</div><div class="bhp-meta">' + esc(d.property + ' · ' + d.depPrefix) + '</div></div>'
            + '<div class="bhc-right"><b style="font-size:16px">' + esc(money(d.amount)) + '</b><span style="font-size:12px;color:' + (d.within48 ? '#A8452A' : '#1F6B4C') + '">' + (d.expiry ? 'expire le ' + esc(dayFr(d.expiry)) : 'empreinte prise') + '</span>'
            + (d.within48 && d.hoursLeft != null ? '<span style="font-size:11.5px;font-weight:500;color:#A8452A">dans ' + d.hoursLeft + ' h</span>' : '') + '</div>' + CHEV + '</div>';
        }).join(''));
      }
      if (c.expired.length) {
        var et = c.expired.reduce(function (s, d) { return s + (d.amount || 0); }, 0);
        h += '<button class="bhm-fold" data-act="expired"><span class="bhp-label" style="margin:0">Empreintes expirées · ' + c.expired.length + '</span><span style="display:flex;gap:8px;align-items:center"><b style="font-size:13px;color:#5E6B63">' + esc(money(et)) + '</b><span class="bhp-ic" style="font-size:12px;color:#5E6B63;transform:rotate(' + (S.showExpired ? '-90' : '90') + 'deg)">' + I.chevR + '</span></span></button>';
        if (S.showExpired) h += card(c.expired.map(function (d) {
          var i = S.deps.indexOf(d);
          return '<div class="bhp-row bho-cl" data-act="dep" data-i="' + i + '"><div class="bho-cl__t"><div class="bho-cl__n">' + esc(d.guest) + '</div><div class="bhp-meta">' + esc(d.property) + '</div></div><b style="font-size:16px;color:#5E6B63">' + esc(money(d.amount)) + '</b>' + CHEV + '</div>';
        }).join(''));
      }
      if (!act.length && !c.expired.length) h += '<p class="bhp-state" style="padding:40px 0">Aucune empreinte active</p>';
      return h;
    }
    function factures() {
      if (S.iState === 'loading') return loading();
      if (S.iState === 'error') return err(S.iErr);
      if (!S.invs.length) return '<p class="bhp-state" style="padding:40px 0">Aucune facture</p>';
      var n = S.invs.filter(function (i) { return i.number; }).length, tot = S.invs.reduce(function (s, i) { return s + (i.total || 0); }, 0);
      return '<div class="bhm-fold" style="cursor:default"><span class="bhp-label" style="margin:0">Historique · ' + U.pl(n, 'facture') + '</span>' + (tot > 0 ? '<b style="font-size:13px;color:#5E6B63">' + esc(money(tot)) + '</b>' : '') + '</div>'
        + card(S.invs.map(function (v, i) {
          return '<div class="bhp-row bho-cl" data-act="inv" data-i="' + i + '"><div class="bho-cl__t"><div class="bho-cl__n">' + esc(v.client) + '</div><div class="bhp-meta">' + esc(v.property) + '</div>'
            + (v.checkin && v.checkout ? '<div class="bhp-meta">du ' + esc(dayFr(v.checkin)) + ' au ' + esc(dayFr(v.checkout)) + '</div>' : '') + '</div>'
            + '<div class="bhc-right">' + (v.total != null ? '<b style="font-size:16px">' + esc(money(v.total)) + '</b>' : '') + '<span class="bhp-meta" style="font-size:12px">' + esc(v.number || '—') + '</span></div>' + CHEV + '</div>';
        }).join(''));
    }

    /* ── Actions caution ── */
    function release(d, sh) {
      U.dialog({ title: 'Restituer la caution ?', message: 'L\'empreinte de ' + money(d.amount) + ' sera libérée sur la carte de ' + d.guest + '.', actions: [{ label: 'Annuler', role: 'cancel', value: false }, { label: 'Restituer', value: true }] }).then(function (ok) {
        if (!ok) return;
        U.api('POST', '/api/deposits/' + encodeURIComponent(d.depositId) + '/release', {}).then(function () { if (sh) { sh.locked = false; sh.close(); } loadDeps(); })
          .catch(function (e) { U.alertMsg('Erreur', e.message); });
      });
    }
    function capture(d, parentSheet) {
      var amt = d.amount != null ? String(d.amount).replace('.', ',') : '';
      var sh = U.openSheet({ head: { title: 'Retenir la caution', left: '<button class="bhp-textbtn bhp-textbtn--vert" data-act="sheet-close">Annuler</button>' } });
      function r2(busy) {
        var v = U.num(amt), ok = v != null && v > 0 && (d.amount == null || v <= d.amount);
        sh.body.innerHTML = '<div class="bhp-stack"><p class="bhp-note" style="font-size:14px">Montant à débiter sur la carte de ' + esc(d.guest) + '. Le reste de l\'empreinte sera libéré.</p>'
          + card('<div class="bhp-row bhp-kv"><span class="bhp-kv__l bhp-kv__l--ink">Montant retenu</span><span class="bhp-in-wrap"><input class="bhp-input bhp-input--r" data-amt value="' + esc(amt) + '" inputmode="decimal"><span class="bhp-unit">€</span></span></div>'
            + htmlRow('<span class="bhp-meta">Empreinte autorisée : ' + esc(money(d.amount)) + '</span>'))
          + (v != null && d.amount != null && v > d.amount ? U.warn('Le montant dépasse l\'empreinte autorisée.', true) : '')
          + '<button class="bhp-btn bhp-btn--danger" style="font-weight:600" data-act="cap-go"' + (ok && !busy ? '' : ' disabled') + '>' + (busy ? U.SPIN : 'Retenir ' + esc(v ? money(v) : '')) + '</button></div>';
      }
      sh.body.addEventListener('input', function (e) { if (!e.target.hasAttribute('data-amt')) return; amt = e.target.value; var pos = e.target.selectionStart; r2(false); var n = sh.body.querySelector('[data-amt]'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) {} });
      sh.body.addEventListener('click', function (e) {
        if (!e.target.closest('[data-act="cap-go"]')) return;
        var v = U.num(amt); if (!v) return;
        sh.locked = true; r2(true);
        U.api('POST', '/api/deposits/' + encodeURIComponent(d.depositId) + '/capture', { amountCents: Math.round(v * 100) }).then(function () {
          sh.locked = false; sh.close(); if (parentSheet) { parentSheet.locked = false; parentSheet.close(); } loadDeps();
        }).catch(function (er) { sh.locked = false; r2(false); U.alertMsg('Erreur', er.message); });
      });
      r2(false);
    }
    function openDep(d) {
      var st = depStatus(d);
      var sh = U.openSheet({ head: { kicker: d.property, title: d.guest, right: '<button class="bhp-textbtn" data-act="sheet-close">Fermer</button>' } });
      var h = '<div class="bhp-card bhf-hero"><div class="bhf-hero__l"><span class="bhp-meta">Caution</span><b>' + esc(money(d.amount)) + '</b></div>' + U.pill(st[0], st[1]) + '</div>';
      h += card(U.kv('Logement', d.property) + U.kv('Départ', d.checkOut ? dayFr(d.checkOut) : '—') + (d.releaseDays != null ? U.kv('Délai de restitution', U.pl(d.releaseDays, 'jour')) : '')
        + (d.authorizedAt ? U.kv('Empreinte prise le', dayFr(d.authorizedAt)) : '') + (d.expiry ? U.kv('Expiration', dayFr(d.expiry)) : ''));
      if (d.overdue && d.canAct) h += U.warn('Délai de restitution dépassé' + (d.overdueDays ? ' de ' + U.pl(d.overdueDays, 'jour') : '') + '. Restitue ou retiens la caution.', true);
      if (d.within48 && d.hoursLeft != null) h += U.warn('L\'empreinte expire dans ' + d.hoursLeft + ' h — dernière chance de la retenir.', true);
      if (d.expired) h += '<div class="bhp-info">' + ic('info') + '<span>L\'empreinte a expiré chez Stripe. Aucune action n\'est possible.</span></div>';
      if (d.checkoutUrl && !d.status) h += '<a class="bhp-btn bhp-btn--ghost" style="text-decoration:none" href="' + esc(d.checkoutUrl) + '" target="_blank" rel="noopener">' + ic('share') + 'Lien de paiement Stripe</a>';
      if (d.canAct) h += '<button class="bhp-btn bhp-btn--primary" data-act="d-release">Restituer la caution</button><button class="bhp-btn bhp-btn--danger" style="font-weight:600" data-act="d-capture">Retenir la caution</button>';
      sh.body.innerHTML = '<div class="bhp-stack">' + h + '</div>';
      sh.body.addEventListener('click', function (e) {
        var el = e.target.closest('[data-act]'); if (!el) return;
        if (el.dataset.act === 'd-release') release(d, sh);
        if (el.dataset.act === 'd-capture') capture(d, sh);
      });
    }

    /* ── Fiche facture ── */
    function openInv(v) {
      var sh = U.openSheet({ head: { kicker: v.number || 'Facture', title: v.client, right: '<button class="bhp-textbtn" data-act="sheet-close">Fermer</button>' } });
      var h = '<div class="bhp-card bhf-hero"><div class="bhf-hero__l"><span class="bhp-meta">Total</span><b>' + esc(money(v.total)) + '</b></div>' + (v.platform ? U.pill(v.platform, 'neutre') : '') + '</div>';
      h += '<div class="bhp-group">' + U.label('Voyageur') + card(htmlRow('<div style="font-size:16px;font-weight:600">' + esc(v.client) + '</div>' + (v.company ? '<div class="bhp-meta">' + esc(v.company) + (v.siret ? ' · SIRET ' + esc(v.siret) : '') + '</div>' : ''))
        + (v.email ? U.kv('Email', v.email) : '') + (v.address ? U.kv('Adresse', v.address) : '') + (v.nationality ? U.kv('Nationalité', v.nationality) : '')) + '</div>';
      h += '<div class="bhp-group">' + U.label('Séjour') + card(U.kv('Logement', v.property) + (v.checkin ? U.kv('Arrivée', dayFr(v.checkin)) : '') + (v.checkout ? U.kv('Départ', dayFr(v.checkout)) : '') + (v.nights ? U.kv('Nuits', String(v.nights)) : '')) + '</div>';
      h += '<div class="bhp-group">' + U.label('Montants') + card((v.rent != null ? U.kv('Hébergement', money(v.rent)) : '') + (v.cleaning ? U.kv('Ménage', money(v.cleaning)) : '') + (v.tax ? U.kv('Taxe de séjour', money(v.tax)) : '')
        + (v.vat ? U.kv('TVA' + (v.vatRate != null ? ' (' + v.vatRate + '\u202f%)' : ''), money(v.vat)) : '') + '<div class="bhp-row bhp-kv"><span class="bhp-kv__l bhp-kv__l--ink" style="font-weight:600">Total</span><span class="bhp-kv__v" style="font-size:16px;font-weight:700">' + esc(money(v.total)) + '</span></div>') + '</div>';
      if (v.number) h += '<button class="bhp-btn bhp-btn--ghost" data-act="i-pdf">' + ic('doc') + 'Télécharger le PDF</button>';
      if (v.number && v.email) h += '<button class="bhp-btn bhp-btn--primary" data-act="i-resend">' + ic('mail') + 'Renvoyer</button>';
      if (v.conversationId || v.reservationUid) h += '<button class="bhp-btn bhp-btn--mint" data-act="i-conv">' + ic('qbubble') + 'Envoyer dans la conversation</button>';
      sh.body.innerHTML = '<div class="bhp-stack">' + h + '</div>';
      sh.body.addEventListener('click', function (e) {
        var el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
        var a = el.dataset.act;
        if (a === 'i-pdf') {
          var w = U.pdfWindow(), f = typeof window.authFetch === 'function' ? window.authFetch : fetch;
          f('/api/invoice/download-by-number/' + encodeURIComponent(v.number)).then(function (r) { if (!r.ok) throw new Error('PDF indisponible.'); return r.blob(); })
            .then(function (b) { var u = URL.createObjectURL(b); if (w) w.location = u; else location.href = u; }).catch(function (er) { if (w) w.close(); U.alertMsg('Erreur', er.message); });
        }
        if (a === 'i-resend') { el.disabled = true; U.api('POST', '/api/invoice/resend', { invoiceNumber: v.number }).then(function () { U.alertMsg('Facture renvoyée', 'La facture a été renvoyée à ' + v.email + '.'); }).catch(function (er) { U.alertMsg('Erreur', er.message); }).then(function () { el.disabled = false; }); }
        if (a === 'i-conv') {
          el.disabled = true;
          U.api('POST', '/api/invoice/send-to-conversation', v.conversationId ? { conversationId: v.conversationId } : { reservationUid: v.reservationUid })
            .then(function () { U.alertMsg('Facture envoyée', 'La facture a été envoyée dans la conversation du voyageur.'); }).catch(function (er) { U.alertMsg('Erreur', er.message); }).then(function () { el.disabled = false; });
        }
      });
    }

    root.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
      var a = el.dataset.act;
      if (a === 'back') { location.href = '/manage.html'; return; }
      if (a === 'tab') { S.tab = el.dataset.v; history.replaceState(null, '', location.pathname + (S.tab === 'factures' ? '?vue=factures' : '')); render(); return; }
      if (a === 'retry') { if (S.tab === 'cautions') { S.dState = 'loading'; render(); loadDeps(); } else { S.iState = 'loading'; render(); loadInvs(); } return; }
      if (a === 'expired') { S.showExpired = !S.showExpired; render(); return; }
      if (a === 'release') { e.stopPropagation(); return release(S.deps[+el.dataset.i]); }
      if (a === 'capture') { e.stopPropagation(); return capture(S.deps[+el.dataset.i]); }
      if (a === 'dep') return openDep(S.deps[+el.dataset.i]);
      if (a === 'inv') return openInv(S.invs[+el.dataset.i]);
    });
    render(); loadDeps(); loadInvs();
  };
})();
