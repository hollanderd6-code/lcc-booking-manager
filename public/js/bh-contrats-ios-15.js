/* bh-contrats-ios-15.js — Propriétaires › Contrats, parité avec l'app iOS
   (ContractsView.swift + ContractDetailView.swift)
   /contrats.html          → liste (filtres En attente / Signés / Expirés)
   /contrats.html?id=ID    → détail
   Dépend de bh-prop-ios-12.js (BHP.ui). */
(function () {
  'use strict';
  var BHP = window.BHP || {};
  var U = BHP.ui;
  if (!U) { console.error('bh-contrats-ios-15 : charger bh-prop-ios-12.js avant.'); return; }
  var esc = U.esc, pick = U.pick, I = U.I, ic = U.ic, card = U.card, CHEV = U.CHEV;
  var NB = '\u202f';
  I.signature = I.signature || '<svg class="bhp-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17c3-1 4-9 6-9s-1 9 2 9 2-5 4-5 1 4 3 4 3-2 3-2"/><path d="M3 21h18"/></svg>';
  I.chevD = I.chevD || '<svg class="bhp-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

  var FILTERS = [['sent', 'En attente'], ['signed', 'Signés'], ['expired', 'Expirés']];
  function dayFr(iso) { if (!iso) return ''; var d = new Date(String(iso).length <= 10 ? iso + 'T00:00:00' : iso); return isNaN(d) ? String(iso) : d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).toLowerCase(); }
  function dateMed(s) { if (!s) return ''; var d = new Date(String(s).slice(0, 10) + 'T00:00:00'); return isNaN(d) ? s : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }); }
  function parseCD(v) { if (!v) return {}; if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return {}; } } return v; }
  function snake(k) { return k.replace(/[A-Z]/g, function (m) { return '_' + m.toLowerCase(); }); }
  function getter(o) {
    return function (k) {
      var v = o[k]; if (v == null) v = o[snake(k)];
      if (v == null && /ID/.test(k)) v = o[k.replace('ID', 'Id')];
      if (v == null) return null;
      return v;
    };
  }
  function s(v) { return v == null ? '' : (typeof v === 'string' ? v : (typeof v === 'number' ? String(v) : (Array.isArray(v) ? v : String(v)))); }

  function normContract(c) {
    var cd = parseCD(pick(c, 'contractData', 'contract_data'));
    var g = getter(cd);
    var isMandat = g('contractType') === 'mandat';
    var gf = pick(c, 'guestFirstName', 'guest_first_name'), gl = pick(c, 'guestLastName', 'guest_last_name');
    var fn = isMandat ? g('ownerFirstName') : (gf || g('guestFirstName')), ln = isMandat ? g('ownerLastName') : (gl || g('guestLastName'));
    var name = [fn, ln].filter(Boolean).join(' ') || '—';
    return {
      id: String(pick(c, 'id', '_id') || ''), status: c.status || null,
      createdAt: pick(c, 'createdAt', 'created_at'), guestSignedAt: pick(c, 'guestSignedAt', 'guest_signed_at'),
      signTokenExpiresAt: pick(c, 'signTokenExpiresAt', 'sign_token_expires_at'),
      propertyName: pick(c, 'propertyName', 'property_name') || g('propertyName'),
      isMandat: isMandat, typeLabel: isMandat ? 'Mandat de gestion' : 'Contrat de location',
      name: name, initials: ((fn || '').charAt(0) + (ln || '').charAt(0)).toUpperCase() || '?', cd: cd, g: g
    };
  }
  function pillFor(st) {
    if (st === 'sent') return U.pill('en attente', 'or');
    if (st === 'signed') return U.pill('signé', 'vert');
    if (st === 'expired') return U.pill('expiré', 'terra');
    return U.pill(st || '—', 'neutre');
  }
  function avatar(c, size) { return '<span class="bho-av" style="width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * .36) + 'px">' + esc(c.initials) + '</span>'; }
  function openPdf(id) {
    var w = window.open('', '_blank');
    var f = typeof window.authFetch === 'function' ? window.authFetch : fetch;
    return f('/api/contrats/' + encodeURIComponent(id) + '/pdf').then(function (r) { if (!r.ok) throw new Error('Impossible de charger le PDF.'); return r.blob(); })
      .then(function (b) { var u = URL.createObjectURL(b); if (w) w.location = u; else location.href = u; })
      .catch(function (e) { if (w) w.close(); U.alertMsg('Erreur PDF', e.message); });
  }

  /* ── Libellés (identiques à Step5View) ── */
  var L = {
    propType: { appartement: 'Appartement', maison: 'Maison', studio: 'Studio', villa: 'Villa', chambre: 'Chambre', gite: 'Gîte / Chalet', autre: 'Autre' },
    animals: { non: 'Non admis', oui: 'Admis', conditions: 'Sous conditions' },
    smoking: { non: 'Interdit', exterieur: 'Extérieur seulement', oui: 'Autorisé' },
    parties: { non: 'Interdits', conditions: 'Sous conditions', oui: 'Autorisés' },
    remu: { commission: '% sur revenus', forfait_mensuel: 'Forfait mensuel', forfait_resa: 'Par réservation', mixte: 'Mixte', carte: 'À la carte' },
    base: { ht: 'Sur revenus HT', ttc: 'Sur revenus TTC' },
    tva: { franchise: 'Auto-entrepreneur, sans TVA', ht: 'HT — TVA en sus', ttc: 'TTC toutes taxes comprises' },
    rev: { par_resa: 'À chaque réservation', hebdo: 'Hebdomadaire', mensuel: 'Mensuel', encaissement_direct: 'Encaissement direct par le propriétaire' },
    duree: { indeterminee: 'Indéterminée', determinee: 'Déterminée' },
    renouv: { tacite: 'Tacite reconduction', expres: 'Renouvellement exprès' },
    excl: { non: 'Sans exclusivité', totale: 'Exclusivité totale', partielle: 'Exclusivité partielle, sur les plateformes' },
    resp: { oui: 'Limitée aux honoraires perçus', non: 'Responsabilité de droit commun' },
    jur: { domicile_defendeur: 'Domicile du défendeur', lieu_bien: 'Lieu du bien', commerce: 'Tribunal de commerce, si 2 sociétés' },
    pay: { virement: 'Virement bancaire', cheque: 'Chèque', especes: 'Espèces', carte: 'Carte bancaire' }
  };
  function lab(map, v) { return map[v] || v; }
  function t(v) { return U.fmtTime(v) || v; }

  function row(label, value) { if (value == null || value === '') return ''; return '<div class="bhc-dr"><span>' + esc(label) + '</span><span>' + esc(value) + '</span></div>'; }
  function item(text) { return '<div class="bhc-di">·' + NB + esc(text) + '</div>'; }
  function arr(v) { return Array.isArray(v) ? v.filter(Boolean).map(String) : []; }
  function boolv(v) { return v === true || v === 'true' ? true : (v === false || v === 'false' ? false : null); }

  function sectionsMandat(g) {
    var out = [];
    out.push(['Parties et bien', null,
      row('Propriétaire', [g('ownerFirstName'), g('ownerLastName')].filter(Boolean).join(' ') || '—') + row('Email', g('ownerEmail')) + row('Adresse propriétaire', g('ownerAddress'))
      + row('Adresse du bien', g('propAddress')) + row('Type de bien', g('propType') && lab(L.propType, g('propType'))) + row('Capacité', g('propCapacity') && s(g('propCapacity')) + NB + 'pers.')
      + row('Séjour min', g('minStay') && s(g('minStay')) + NB + 'nuits') + row('Séjour max', g('maxStay') && s(g('maxStay')) + NB + 'nuits')
      + row('Animaux', g('animals') && lab(L.animals, g('animals'))) + row('Fumeur', g('smoking') && lab(L.smoking, g('smoking'))) + row('Fêtes', g('parties') && lab(L.parties, g('parties')))
      + row('Arrivée', g('checkinTime') && t(g('checkinTime'))) + row('Départ', g('checkoutTime') && t(g('checkoutTime')))]);
    var ms = arr(g('missions')), ex = arr(g('extrasFacturables')), urg = s(g('urgenceLimit'));
    out.push(['Missions', ms.length, (!ms.length && !ex.length && !urg) ? '<div class="bhc-none">Aucune mission ni extra.</div>'
      : ms.map(item).join('') + row('Plafond urgence', urg && urg + NB + '€ TTC') + ex.map(item).join('')]);
    var rt = s(g('remuType')), hon;
    if (!rt) hon = '<div class="bhc-none">Aucun type de rémunération.</div>';
    else {
      hon = row('Type', lab(L.remu, rt));
      if (rt === 'commission') hon += row('Taux', g('commissionRate') && s(g('commissionRate')) + NB + '%') + row('Base de calcul', lab(L.base, s(g('commissionBase')) || 'ht'));
      if (rt === 'forfait_mensuel') hon += row('Forfait', g('forfaitMensuel') && s(g('forfaitMensuel')) + NB + '€/mois');
      if (rt === 'forfait_resa') hon += row('Forfait / rés.', g('forfaitResa') && s(g('forfaitResa')) + NB + '€');
      if (rt === 'mixte') hon += row('Taux', g('mixteRate') && s(g('mixteRate')) + NB + '%') + row('Forfait', g('mixteForfait') && s(g('mixteForfait')) + NB + '€/mois');
      hon += row('TVA', g('tva') && lab(L.tva, g('tva'))) + row('Délai préavis', g('tarifPreavis') && s(g('tarifPreavis')) + NB + 'jours') + row('Reversement', g('reversement') && lab(L.rev, g('reversement')));
    }
    out.push(['Honoraires', rt ? null : 0, hon]);
    var dt = s(g('dureeType')), cond = '';
    if (dt) {
      cond += row('Durée', lab(L.duree, dt));
      if (dt === 'determinee') cond += row('Date de début', g('dateDebut') && dateMed(g('dateDebut'))) + row('Durée (mois)', g('dureeMois') && s(g('dureeMois')) + NB + 'mois') + row('Renouvellement', g('renouvellement') && lab(L.renouv, g('renouvellement')));
    }
    var pv = g('preavis');
    if (pv != null) cond += row('Préavis résiliation', s(pv) === '0' ? 'Aucun préavis' : (s(pv) ? s(pv) + NB + 'jours' : '—'));
    cond += row('Exclusivité', g('exclusivite') && lab(L.excl, g('exclusivite'))) + row('Responsabilité', g('respPlafond') && lab(L.resp, g('respPlafond')))
      + row('Juridiction', g('juridiction') && lab(L.jur, g('juridiction'))) + (g('confidentialite') != null ? row('Confidentialité', s(g('confidentialite')) ? s(g('confidentialite')) + NB + 'ans' : '—') : '')
      + arr(g('clausesPersonnalisees')).map(item).join('');
    out.push(['Conditions', null, cond || '<div class="bhc-none">—</div>']);
    return out;
  }
  function sectionsRental(g) {
    var out = [];
    out.push(['Voyageur', null, row('Voyageur', [g('guestFirstName'), g('guestLastName')].filter(Boolean).join(' ')) + row('Nb voyageurs', g('guestCount') && s(g('guestCount')) + NB + 'pers.')
      + row('Email', g('guestEmail')) + row('Téléphone', g('guestPhone')) + row('Adresse', g('guestAddress')) + row('Nationalité', g('guestNationality'))
      + row('Pièce d\'identité', g('guestIDNumber')) + row('Date de naissance', g('guestDOB') && dateMed(g('guestDOB'))) || '<div class="bhc-none">—</div>']);
    out.push(['Bien et propriétaire', null, row('Bien', g('propertyName')) + row('Adresse', g('propertyAddress')) + row('Type', g('propertyType') && lab(L.propType, g('propertyType')))
      + row('Arrivée', g('checkin') && dateMed(g('checkin'))) + row('Départ', g('checkout') && dateMed(g('checkout'))) + row('Heure arrivée', g('checkinTime') && t(g('checkinTime')))
      + row('Heure départ', g('checkoutTime') && t(g('checkoutTime'))) + row('Propriétaire', [g('ownerFirstName'), g('ownerLastName')].filter(Boolean).join(' '))
      + row('Adresse propriétaire', g('ownerAddress')) + row('Email propriétaire', g('ownerEmail')) || '<div class="bhc-none">—</div>']);
    out.push(['Tarifs', null, row('Total séjour', g('totalPrice') && s(g('totalPrice')) + NB + '€') + row('Acompte', g('acompte') && s(g('acompte')) + NB + '€') + row('Date acompte', g('acompteDate') && dateMed(g('acompteDate')))
      + row('Caution', g('deposit') && s(g('deposit')) + NB + '€') + row('Retour caution', g('depositReturnDays') && s(g('depositReturnDays')) + NB + 'jours') + row('Frais ménage', g('cleaningFee') && s(g('cleaningFee')) + NB + '€')
      + row('Paiement', g('paymentMethod') && lab(L.pay, g('paymentMethod'))) + row('Notes', g('priceNotes')) || '<div class="bhc-none">—</div>']);
    var regles = arr(g('regles')), c = '';
    [[1, 'Annulation tranche 1'], [2, 'Annulation tranche 2']].forEach(function (x) { var p = s(g('cancelPct' + x[0])), d = s(g('cancelDays' + x[0])); if (p) c += row(x[1], p + NB + '%' + (d ? ' · ' + d + NB + 'j' : '')); });
    var b1 = boolv(g('inclEDL')), b2 = boolv(g('inclAssurance')), b3 = boolv(g('inclAnnulation')), b4 = boolv(g('inclObligations'));
    if (b1 != null) c += row('État des lieux', b1 ? 'Inclus' : 'Non inclus');
    if (b2 != null) c += row('Assurance', b2 ? 'Incluse' : 'Non incluse');
    if (b3 != null) c += row('Assurance annulation', b3 ? 'Incluse' : 'Non incluse');
    if (b4 != null) c += row('Obligations voyageur', b4 ? 'Oui' : 'Non');
    c += row('Précisions obligations', g('obligationsExtra')) + regles.map(item).join('');
    out.push(['Conditions', regles.length || null, c || '<div class="bhc-none">—</div>']);
    return out;
  }
  function summaries(c) {
    var g = c.g;
    if (c.isMandat) {
      var rt = s(g('remuType')), com = '—';
      if (rt === 'commission') com = s(g('commissionRate')) ? s(g('commissionRate')) + NB + '%' : '—';
      else if (rt === 'forfait_mensuel') com = s(g('forfaitMensuel')) ? s(g('forfaitMensuel')) + NB + '€/mois' : '—';
      else if (rt === 'forfait_resa') com = s(g('forfaitResa')) ? s(g('forfaitResa')) + NB + '€/rés.' : '—';
      else if (rt === 'mixte') com = s(g('mixteRate')) ? s(g('mixteRate')) + NB + '% + forfait' : '—';
      else if (rt === 'carte') com = 'À la carte';
      var du = s(g('dureeType')) === 'determinee' ? (s(g('dureeMois')) ? s(g('dureeMois')) + NB + 'mois' : 'Déterminée') : 'Indéterminée';
      var p = s(g('preavis')), pr = p === '0' ? 'Aucun' : (p ? p + NB + 'jours' : '—');
      return [[com, 'Rémunération', true], [du, 'Durée'], [pr, 'Préavis']];
    }
    var tp = s(g('totalPrice')), ci = s(g('checkin')), co = s(g('checkout')), nights = '—';
    if (ci && co) { var n = Math.round((new Date(co.slice(0, 10)) - new Date(ci.slice(0, 10))) / 86400000); if (n > 0) nights = n === 1 ? '1' + NB + 'nuit' : n + NB + 'nuits'; }
    var dp = s(g('deposit'));
    return [[tp ? tp + NB + '€' : '—', 'Total', true], [nights, 'Durée'], [dp ? dp + NB + '€' : '—', 'Caution']];
  }

  /* ════════════════ Page ════════════════ */
  BHP.initContrats = function () {
    var root = document.getElementById('bhpApp');
    var S = { filter: 'sent', state: 'loading', list: [], total: 0, loadingMore: false, view: null, D: null, listScroll: 0, open: {} };

    function fetchPage(offset) {
      return U.api('GET', '/api/contrats?status=' + S.filter + '&limit=50&offset=' + offset).then(function (r) {
        var arr2 = (r.contracts || r.contrats || []).map(normContract);
        S.list = offset ? S.list.concat(arr2) : arr2;
        S.total = r.total != null ? +r.total : S.list.length;
        S.state = 'loaded';
      });
    }
    function reload() {
      if (S.state !== 'loaded') S.state = 'loading';
      render();
      fetchPage(0).catch(function () { S.state = 'error'; }).then(render);
    }
    function loadMore() {
      if (S.loadingMore || S.list.length >= S.total) return;
      S.loadingMore = true; render();
      fetchPage(S.list.length).catch(function () {}).then(function () { S.loadingMore = false; render(); });
    }

    function renderList() {
      var kick = S.state === 'loaded' ? U.pl(S.total, 'contrat') : '';
      var chips = '<div class="bhp-chips"><div class="bhp-chips__in">' + FILTERS.map(function (f) {
        return '<button class="bhc-chip' + (S.filter === f[0] ? ' is-on' : '') + '" data-act="filter" data-v="' + f[0] + '">' + f[1] + '</button>';
      }).join('') + '</div></div>';
      var nav = '<header class="bhp-nav"><div class="bhm-nav__in">' + U.circleBtn('chevL', 'back', 'Propriétaires')
        + '<div class="bhm-nav__t"><div class="bhp-nav__kicker" style="text-align:left">' + (esc(kick) || '&#160;') + '</div><h1 class="bhm-title">Contrats</h1></div>'
        + U.circleBtn('plus', 'new', 'Nouveau mandat') + '</div>' + chips + '</header>';
      var h = '';
      if (S.state === 'loading') h = '<div class="bhp-state bhp-center"><span class="bhp-spin bhp-spin--lg"></span></div>';
      else if (S.state === 'error') h = '<div class="bhm-empty">' + ic('warnFill') + '<span>Impossible de charger les contrats.</span><button class="bhp-glassbtn" data-act="retry">Réessayer</button></div>';
      else if (!S.list.length) h = '<div class="bhm-empty"><b style="color:#14201B;font-size:16px">Aucun contrat</b><span>Aucun contrat ' + ({ sent: 'en attente', signed: 'signé', expired: 'expiré' })[S.filter] + ' pour le moment.</span></div>';
      else {
        h = card(S.list.map(function (c, i) {
          var ds = (c.status === 'signed' ? (c.guestSignedAt ? 'signé le ' + dayFr(c.guestSignedAt) : '') : (c.createdAt ? 'envoyé le ' + dayFr(c.createdAt) : ''));
          return '<div class="bhp-row bho-cl" data-act="open" data-i="' + i + '">' + avatar(c, 42) + '<div class="bho-cl__t"><div class="bho-cl__n">' + esc(c.name) + '</div><div class="bhp-meta" style="font-size:12.5px">' + esc([c.typeLabel, c.propertyName].filter(Boolean).join(' · ')) + '</div></div>'
            + '<div class="bhc-right">' + pillFor(c.status) + (ds ? '<span class="bhp-meta" style="font-size:12px">' + esc(ds) + '</span>' : '') + '</div>'
            + '<button class="bhp-dots" data-act="menu" data-i="' + i + '" aria-label="Actions">' + I.ellipsis + '</button></div>';
        }).join(''));
        if (S.loadingMore) h += '<div class="bhp-center" style="padding:16px">' + U.SPIN + '</div>';
        else if (S.list.length < S.total) h += '<button class="bhp-btn bhp-btn--ghost" data-act="more">Charger plus</button>';
      }
      root.innerHTML = nav + '<div class="bhp-stack">' + h + '</div>';
      document.title = 'Contrats — Boostinghost';
    }

    function openDetail(id, push) {
      S.listScroll = window.scrollY;
      S.view = 'detail'; S.D = { id: id, state: 'loading', c: null, resend: 'idle', deleting: false }; S.open = {};
      if (push) history.pushState({ bhcId: id }, '', location.pathname + '?id=' + encodeURIComponent(id));
      render(); window.scrollTo(0, 0);
      var D = S.D;
      U.api('GET', '/api/contrats/' + encodeURIComponent(id)).then(function (r) { D.c = normContract(r.contract || r.contrat || r); if (!D.c.id) D.c.id = id; D.state = 'loaded'; })
        .catch(function (e) { D.state = 'error'; D.err = e.message || 'Impossible de charger le contrat.'; }).then(function () { if (S.D === D) render(); });
    }
    function closeDetail() {
      if (history.state && history.state.bhcId) { history.back(); return; }
      history.replaceState(null, '', location.pathname); S.view = null; S.D = null; reload(); window.scrollTo(0, S.listScroll);
    }
    function renderDetail() {
      var D = S.D, c = D.c;
      var kick = c ? ({ sent: 'En attente', signed: 'Signé', expired: 'Expiré' })[c.status] || '' : '';
      var nav = '<header class="bhp-nav"><div class="bhm-nav__in">' + U.circleBtn('chevL', 'd-back', 'Contrats')
        + '<div class="bhm-nav__t"><div class="bhp-nav__kicker" style="text-align:left">' + (esc(kick) || '&#160;') + '</div><h1 class="bhm-title">' + esc(c ? c.typeLabel : 'Contrat') + '</h1></div>'
        + U.circleBtn('doc', 'pdf', 'PDF') + '</div></header>';
      var h = '';
      if (D.state === 'loading') h = '<div class="bhp-state bhp-center"><span class="bhp-spin bhp-spin--lg"></span></div>';
      else if (D.state === 'error') h = '<div class="bhm-empty">' + ic('warnFill') + '<span>' + esc(D.err) + '</span><button class="bhp-glassbtn" data-act="d-retry">Réessayer</button></div>';
      else {
        var g = c.g;
        var sub = c.isMandat ? [g('propAddress'), g('propType') && lab(L.propType, g('propType'))].filter(Boolean).join(' · ') : [g('propertyName'), g('propertyAddress')].filter(Boolean).join(' · ');
        h += '<div class="bhp-card bhc-signer">' + avatar(c, 52) + '<div class="bho-cl__t"><div class="bho-cl__n" style="font-size:17px">' + esc(c.name) + '</div>' + (sub ? '<div class="bhp-meta">' + esc(sub) + '</div>' : '') + '</div></div>';
        h += '<div class="bhc-sum">' + summaries(c).map(function (x) { return '<div class="bhp-card bhc-sum__b"><b' + (x[2] ? ' style="color:#0E3B2E"' : '') + '>' + esc(x[0]) + '</b><span>' + esc(x[1]) + '</span></div>'; }).join('') + '</div>';
        var secs = c.isMandat ? sectionsMandat(g) : sectionsRental(g);
        h += '<div class="bhc-doc"><div class="bhc-doc__t">' + esc(c.typeLabel.toUpperCase()) + '</div>' + secs.map(function (sc, i) {
          var open = !!S.open[i];
          return '<div class="bhc-sec' + (open ? ' is-open' : '') + '"><button class="bhc-sec__h" data-act="sec" data-i="' + i + '"><span>' + esc(sc[0]) + '</span>'
            + (sc[1] != null ? '<span class="bhc-count' + (sc[1] > 0 ? ' is-on' : '') + '">' + sc[1] + '</span>' : '') + '<span class="bhp-ic bhc-sec__c">' + I.chevD + '</span></button>'
            + (open ? '<div class="bhc-sec__b">' + sc[2] + '</div>' : '') + '</div>';
        }).join('') + '</div>';
        var bar = '';
        if (c.status === 'sent' || c.status === 'expired') {
          bar += '<button class="bhp-btn bhp-btn--primary" data-act="resend"' + (D.resend === 'sending' ? ' disabled' : '') + '>' + (D.resend === 'sending' ? 'Envoi…' : 'Renvoyer le lien') + '</button>';
          bar += D.resend === 'done' ? '<p class="bhc-foot" style="color:#0E3B2E">Lien renvoyé</p>'
            : (c.status === 'sent' && c.createdAt ? '<p class="bhc-foot">Envoyé le ' + esc(dayFr(c.createdAt)) + '</p>' : (c.status === 'expired' && c.signTokenExpiresAt ? '<p class="bhc-foot">Lien expiré le ' + esc(dayFr(c.signTokenExpiresAt)) + '</p>' : ''));
        } else if (c.status === 'signed') {
          bar += '<button class="bhp-btn bhp-btn--primary" data-act="pdf">Voir le PDF</button>' + (c.guestSignedAt ? '<p class="bhc-foot">Signé le ' + esc(dayFr(c.guestSignedAt)) + '</p>' : '');
        }
        if (c.status !== 'signed' && !c.guestSignedAt) bar += '<button class="bhc-del" data-act="delete"' + (D.deleting ? ' disabled' : '') + '>' + (D.deleting ? U.SPIN : 'Supprimer le contrat') + '</button>';
        h += '<div class="bhc-bar">' + bar + '</div>';
      }
      root.innerHTML = nav + '<div class="bhp-stack">' + h + '</div>';
      document.title = (c ? c.typeLabel + ' · ' + c.name : 'Contrat') + ' — Boostinghost';
    }

    function resend(id, D) {
      if (D) { D.resend = 'sending'; render(); }
      return U.api('POST', '/api/contrats/' + encodeURIComponent(id) + '/resend-sign', {})
        .then(function () { if (D) D.resend = 'done'; else { U.alertMsg('Lien renvoyé', 'Un nouveau lien de signature a été envoyé.'); reload(); } })
        .catch(function (e) { if (D) D.resend = 'idle'; U.alertMsg('Erreur', e.message || 'Erreur lors du renvoi.'); })
        .then(function () { if (D) render(); });
    }
    function del(id, D) {
      U.confirmMsg('Supprimer ce contrat ?', 'Cette action est définitive. Le contrat et son PDF seront supprimés.', 'Supprimer').then(function (ok) {
        if (!ok) return;
        if (D) { D.deleting = true; render(); }
        U.api('DELETE', '/api/contrats/' + encodeURIComponent(id)).then(function () {
          S.list = S.list.filter(function (x) { return x.id !== id; }); S.total = Math.max(0, S.total - 1);
          if (D) closeDetail(); else render();
        }).catch(function (e) {
          if (D) D.deleting = false;
          if (e.status === 409) { if (D) openDetail(id, false); return; }
          U.alertMsg('Erreur', e.message || 'Impossible de supprimer ce contrat.'); if (D) render();
        });
      });
    }

    function render() { if (S.view === 'detail' && S.D) renderDetail(); else renderList(); }

    root.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
      var a = el.dataset.act;
      if (a === 'back') { location.href = '/proprietaires.html'; return; }
      if (a === 'new') { location.href = '/contrat.html'; return; }
      if (a === 'retry') return reload();
      if (a === 'more') return loadMore();
      if (a === 'filter') { if (S.filter !== el.dataset.v) { S.filter = el.dataset.v; S.state = 'loading'; reload(); } return; }
      if (a === 'menu') {
        e.stopPropagation();
        var c = S.list[+el.dataset.i], items = [{ label: 'Voir le PDF', icon: 'doc', onClick: function () { openPdf(c.id); } }];
        if (c.status !== 'signed') items.push({ label: 'Renvoyer le lien', icon: 'sync', onClick: function () { resend(c.id, null); } }, { label: 'Supprimer', icon: 'trash', danger: true, onClick: function () { del(c.id, null); } });
        return U.openMenu(el, items);
      }
      if (a === 'open') return openDetail(S.list[+el.dataset.i].id, true);
      var D = S.D; if (!D) return;
      if (a === 'd-back') return closeDetail();
      if (a === 'd-retry') return openDetail(D.id, false);
      if (a === 'pdf') return openPdf(D.id);
      if (a === 'sec') { var i = +el.dataset.i; S.open[i] = !S.open[i]; render(); return; }
      if (a === 'resend') return resend(D.id, D);
      if (a === 'delete') return del(D.id, D);
    });
    window.addEventListener('popstate', function () {
      var id = new URLSearchParams(location.search).get('id');
      if (id) openDetail(id, false); else { S.view = null; S.D = null; reload(); window.scrollTo(0, S.listScroll); }
    });
    window.addEventListener('scroll', function () {
      if (S.view || S.state !== 'loaded') return;
      if (window.innerHeight + window.scrollY > document.body.scrollHeight - 300) loadMore();
    }, { passive: true });

    var start = new URLSearchParams(location.search).get('id');
    if (start) openDetail(start, false); else reload();
  };
})();
