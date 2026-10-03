/* bh-boostprice-ios-20.js — Gestion › BoostPrice (tarification dynamique), style app iOS
   /boostprice.html (?vue=calendrier|reglages|historique|evenements) — dépend de bh-prop-ios-12.js (BHP.ui).
   Mêmes routes que l'ancienne page dynamic-pricing.html. */
(function () {
  'use strict';
  var BHP = window.BHP || {}, U = BHP.ui;
  if (!U) { console.error('bh-boostprice-ios-20 : charger bh-prop-ios-12.js avant.'); return; }
  var esc = U.esc, ic = U.ic, card = U.card, kv = U.kv, CHEV = U.CHEV, I = U.I;
  var DP = '/api/dynamic-pricing';
  var TABS = [['apercu', 'Aperçu'], ['calendrier', 'Calendrier'], ['reglages', 'Réglages'], ['historique', 'Historique'], ['evenements', 'Événements']];

  function money(v, cur) {
    if (v == null || isNaN(v)) return '—';
    try { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: cur || 'EUR', maximumFractionDigits: 0 }).format(v); }
    catch (e) { return Math.round(v) + ' ' + (cur || '€'); }
  }
  function dayFr(iso, o) { var d = new Date(String(iso).slice(0, 10) + 'T00:00:00'); return isNaN(d) ? '—' : d.toLocaleDateString('fr-FR', o || { day: 'numeric', month: 'long' }); }
  function tensionLabel(l) { return ({ high: 'Forte demande', elevated: 'Demande élevée', medium: 'Demande moyenne', low: 'Faible demande', very_low: 'Très faible' })[l] || l || ''; }
  function tensionStyle(l) { return l === 'high' ? 'terra' : l === 'elevated' ? 'or' : l === 'medium' ? 'vert' : 'neutre'; }
  function stratLabel(v) { v = +v; return v <= 15 ? 'Occupation max' : v < 45 ? 'Plutôt occupation' : v <= 55 ? 'Équilibré' : v < 85 ? 'Plutôt revenu' : 'Revenu max'; }
  function f2(x) { return x == null ? '—' : String(Math.round(x * 100) / 100).replace('.', ','); }

  BHP.initBoostPrice = function () {
    var root = document.getElementById('bhpApp');
    var vue = new URLSearchParams(location.search).get('vue');
    var S = {
      tab: TABS.some(function (t) { return t[0] === vue; }) ? vue : 'apercu',
      dash: null, dState: 'loading', pause: null,
      cfgs: [], cState: 'idle', notif: null,
      hist: [], hState: 'idle',
      props: null, calProp: null, cal: null, calState: 'idle', calSel: null,
      events: [], eState: 'idle', zoneProp: null, zone: null
    };

    /* ── Chargements ── */
    function props() {
      if (S.props) return Promise.resolve(S.props);
      return U.api('GET', '/api/properties').then(function (r) {
        S.props = (r.properties || (Array.isArray(r) ? r : [])).map(function (p) {
          return { id: String(p.id), name: p.internal_name || p.internalName || p.name || String(p.id), currency: /^[A-Z]{3}$/.test(p.currency || '') ? p.currency : 'EUR' };
        });
        return S.props;
      });
    }
    function pname(id) { var p = (S.props || []).filter(function (x) { return x.id === String(id); })[0]; return p ? p.name : String(id); }
    function loadDash() {
      U.api('GET', DP + '/pause').then(function (d) { S.pause = d; }).catch(function () { S.pause = null; }).then(render);
      return U.api('GET', DP + '/dashboard').then(function (d) { S.dash = d; S.dState = 'loaded'; })
        .catch(function (e) { S.dState = 'error'; S.dErr = e.message; }).then(render);
    }
    function loadCfg() {
      S.cState = 'loading'; render();
      U.api('GET', DP + '/notifications').then(function (d) { S.notif = d; }).catch(function () { S.notif = { off: true }; }).then(render);
      return Promise.all([props(), U.api('GET', DP + '/config').catch(function () { return { configs: [] }; })]).then(function (r) {
        var ex = r[1].configs || [];
        S.cfgs = r[0].map(function (p) {
          var c = ex.filter(function (x) { return String(x.propertyId) === p.id; })[0];
          return { propertyId: p.id, name: p.name, cur: p.currency, isActive: c ? !!c.isActive : false,
            priceMin: c && c.priceMin != null ? c.priceMin : 40, priceMax: c && c.priceMax != null ? c.priceMax : 200,
            strategy: c && c.strategy != null ? c.strategy : 50, mode: (c && c.mode) || 'manual', saved: !!c };
        });
        S.cState = 'loaded';
      }).catch(function (e) { S.cState = 'error'; S.cErr = e.message; }).then(render);
    }
    function loadHist() {
      S.hState = 'loading'; render();
      return U.api('GET', DP + '/history?limit=30').then(function (d) { S.hist = d.history || []; S.hState = 'loaded'; })
        .catch(function (e) { S.hState = 'error'; S.hErr = e.message; }).then(render);
    }
    function loadCal() {
      if (!S.calProp) return;
      S.calState = 'loading'; S.calSel = null; render();
      return U.api('GET', '/api/pricing/schedule/' + encodeURIComponent(S.calProp) + '?days=60').then(function (d) { S.cal = d; S.calState = 'loaded'; })
        .catch(function (e) { S.calState = 'error'; S.calErr = e.message; }).then(render);
    }
    function initCal() {
      S.calState = 'loading'; render();
      props().then(function (p) { if (!S.calProp && p.length) S.calProp = p[0].id; if (S.calProp) loadCal(); else { S.calState = 'loaded'; S.cal = null; render(); } })
        .catch(function (e) { S.calState = 'error'; S.calErr = e.message; render(); });
    }
    function loadEvents() {
      S.eState = 'loading'; render();
      return props().then(function (p) {
        if (!S.zoneProp && p.length) S.zoneProp = p[0].id;
        if (S.zoneProp) loadZone();
        return U.api('GET', '/api/pricing/events');
      }).then(function (d) { S.events = d.events || []; S.eState = 'loaded'; })
        .catch(function (e) { S.eState = 'error'; S.eErr = e.message; }).then(render);
    }
    function loadZone() {
      S.zone = null;
      U.api('GET', '/api/pricing/calendars/' + encodeURIComponent(S.zoneProp)).then(function (d) { S.zone = d.zone || null; }).catch(function () {}).then(render);
    }
    function ensure() {
      if (S.tab === 'reglages' && S.cState === 'idle') loadCfg();
      if (S.tab === 'historique' && S.hState === 'idle') loadHist();
      if (S.tab === 'calendrier' && S.calState === 'idle') initCal();
      if (S.tab === 'evenements' && S.eState === 'idle') loadEvents();
    }

    /* ── Rendu ── */
    function loading() { return '<div class="bhp-state bhp-center"><span class="bhp-spin bhp-spin--lg"></span></div>'; }
    function err(m) { return '<div class="bhm-empty">' + ic('warnFill') + '<span>' + esc(m || 'Chargement impossible.') + '</span><button class="bhp-glassbtn" data-act="retry">Réessayer</button></div>'; }
    function render() {
      var pend = S.dash && S.dash.pendingCount ? S.dash.pendingCount : 0;
      var kick = pend ? (pend === 1 ? '1 suggestion à valider' : pend + ' suggestions à valider') : 'Tarification dynamique';
      var seg = '<div class="bhm-seg bhb-seg">' + TABS.map(function (t) {
        return '<button class="bhm-seg__b' + (S.tab === t[0] ? ' is-on' : '') + '" data-act="tab" data-v="' + t[0] + '">' + t[1] + (t[0] === 'apercu' && pend ? ' · ' + pend : '') + '</button>';
      }).join('') + '</div>';
      var nav = '<header class="bhp-nav"><div class="bhm-nav__in">' + U.circleBtn('chevL', 'back', 'Gestion') + '<div class="bhm-nav__t"><div class="bhp-nav__kicker" style="text-align:left">' + esc(kick) + '</div><h1 class="bhm-title">BoostPrice</h1></div></div><div class="bhm-nav__in2">' + seg + '</div></header>';
      var body = S.tab === 'apercu' ? apercu() : S.tab === 'calendrier' ? calendrier() : S.tab === 'reglages' ? reglages() : S.tab === 'historique' ? historique() : evenements();
      var y = window.scrollY;
      root.innerHTML = nav + '<div class="bhp-stack bhm-stack">' + body + '</div>';
      window.scrollTo(0, y);
    }

    /* Aperçu */
    function pauseCard() {
      var d = S.pause;
      if (!d || !d.total) return '';
      if (d.en_pause) {
        return '<div class="bhp-card bhb-pause is-off"><div class="bhb-pause__t">' + ic('warnFill') + '<div><b>BoostPrice est en pause' + (d.depuis ? ' depuis le ' + esc(dayFr(d.depuis)) : '') + '</b>'
          + '<span class="bhp-meta">Aucun prix n\'est ajusté sur vos ' + U.pl(d.logements_en_pause || 0, 'logement') + '. Les prix déjà publiés restent en place.</span></div></div>'
          + '<button class="bhm-call" data-act="pause" data-v="0">Reprendre</button></div>';
      }
      return '<div class="bhp-card bhb-pause"><div class="bhb-pause__t">' + ic('checkFill', 'bhb-ok') + '<div><b>Ajustement actif</b><span class="bhp-meta">sur ' + U.pl(d.actifs || 0, 'logement') + '</span></div></div>'
        + '<button class="bhp-glassbtn bhm-reject" style="color:#2C3A33" data-act="pause" data-v="1">Mettre en pause</button></div>';
    }
    function apercu() {
      if (S.dState === 'loading') return loading();
      if (S.dState === 'error') return err(S.dErr);
      var d = S.dash || {}, ps = d.properties || [];
      if (!ps.length) {
        return '<div class="bhm-empty">' + ic('bolt') + '<span><b style="color:#14201B">Aucun logement configuré</b><br>Activez BoostPrice sur vos logements pour recevoir des prix ajustés au marché.</span>'
          + '<button class="bhm-call" data-act="tab" data-v="reglages">Configurer mes logements</button></div>';
      }
      var gains = Object.keys(d.weeklyGainByCurrency || {}).filter(function (k) { return d.weeklyGainByCurrency[k] > 0; })
        .map(function (k) { return '+' + money(d.weeklyGainByCurrency[k], k); }).join(' · ');
      var h = pauseCard();
      h += '<div class="bhb-stats">'
        + '<div class="bhp-card bhb-stat"><span class="bhp-label" style="margin:0">Gain estimé</span><b>' + esc(gains || '—') + '</b><span class="bhp-meta">cette semaine</span></div>'
        + '<div class="bhp-card bhb-stat"><span class="bhp-label" style="margin:0">Logements</span><b>' + ps.length + '</b><span class="bhp-meta">suivis</span></div>'
        + '<div class="bhp-card bhb-stat"><span class="bhp-label" style="margin:0">À valider</span><b' + (d.pendingCount ? ' style="color:#A8452A"' : '') + '>' + (d.pendingCount || 0) + '</b><span class="bhp-meta">suggestions</span></div></div>';
      var high = ps.filter(function (p) { return p.market && p.market.tensionLevel === 'high'; }).length;
      if (high) h += '<div class="bhp-info bhb-hot">' + ic('chart') + '<span><b>Forte demande sur ' + U.pl(high, 'logement') + '.</b> Le marché local est très occupé : c\'est le bon moment pour augmenter vos prix.</span></div>';
      var pend = ps.filter(function (p) { return p.history && p.history.status === 'pending'; });
      var rest = ps.filter(function (p) { return !(p.history && p.history.status === 'pending'); });
      if (pend.length) h += U.label('À valider') + pend.map(propCard).join('');
      if (rest.length) h += U.label(pend.length ? 'Autres logements' : 'Vos logements') + rest.map(propCard).join('');
      var nm = new Date(), dof = nm.getDay(); nm.setDate(nm.getDate() + (dof === 0 ? 1 : 8 - dof));
      h += '<p class="bhp-note bhp-note--c">Prochaine analyse du marché le ' + esc(dayFr(nm.toISOString(), { weekday: 'long', day: 'numeric', month: 'long' })) + ' à 6 h.</p>';
      return h;
    }
    function propCard(p) {
      var i = S.dash.properties.indexOf(p), h = p.history, m = p.market, cur = p.propertyCurrency || 'EUR';
      var pending = h && h.status === 'pending';
      var out = '<div class="bhp-card bhb-prop' + (pending ? ' is-pending' : '') + '">';
      out += '<div class="bhb-prop__top"><div class="bhb-prop__t"><div class="bhm-ac__n">' + esc(p.propertyName) + '</div>' + (p.address ? '<div class="bhp-meta">' + esc(p.address) + '</div>' : '') + '</div>'
        + U.pill(p.mode === 'auto' ? 'Automatique' : 'Manuel', p.mode === 'auto' ? 'vert' : 'neutre') + '</div>';
      if (m) {
        out += '<div class="bhb-market">'
          + '<div><span>Médiane marché</span><b>' + esc(money(m.medianPrice, cur)) + '</b></div>'
          + '<div><span>Fourchette</span><b>' + esc(money(m.priceP25, cur)) + '–' + esc(money(m.priceP75, cur)) + '</b></div>'
          + '<div><span>' + Math.round(m.occupancyRate || 0) + ' % occupé</span>' + U.pill(m.tensionLabel || tensionLabel(m.tensionLevel), tensionStyle(m.tensionLevel)) + '</div>'
          + '<div><span>Comparables</span><b>' + (m.comparableCount || 0) + '</b></div></div>';
      } else {
        out += '<div class="bhp-info">' + ic('info') + '<span>Prix déjà actifs, calculés sur votre tarif de base, votre demande, la saison et les événements. Les données du marché affineront les prix.</span></div>'
          + '<button class="bhp-btn bhp-btn--mint" data-act="analyze" data-pid="' + esc(p.propertyId) + '">' + ic('bolt') + 'Lancer l\'analyse maintenant</button>';
      }
      if (h) {
        var shown = h.priceApplied != null ? h.priceApplied : h.priceCalculated, diff = shown != null && h.priceBefore != null ? Math.round(shown - h.priceBefore) : 0;
        out += '<div class="bhb-price"><div><span>Prix actuel</span><b>' + esc(money(h.priceBefore, cur)) + '</b></div><span class="bhp-ic bhb-arrow">' + I.chevR + '</span>'
          + '<div><span>' + (pending ? 'Suggéré' : h.status === 'applied' ? 'Appliqué' : 'Prix actuel') + '</span><b class="' + (pending ? 'is-or' : 'is-vert') + '">' + esc(money(shown, cur))
          + (diff ? ' <em class="' + (diff > 0 ? 'up' : 'down') + '">' + (diff > 0 ? '+' : '−') + esc(money(Math.abs(diff), cur)) + '</em>' : '') + '</b></div>'
          + '<div class="bhb-price__r"><span>Fourchette</span><b>' + esc(money(p.priceMin, cur)) + '–' + esc(money(p.priceMax, cur)) + '</b></div></div>';
      }
      if (pending) {
        out += '<div class="bhm-vc__acts"><button class="bhm-call" data-act="decide" data-a="apply" data-i="' + i + '">' + ic('check') + 'Appliquer ' + esc(money(h.priceCalculated, cur)) + '</button>'
          + '<button class="bhp-glassbtn bhm-reject" style="color:#2C3A33" data-act="decide" data-a="decline" data-i="' + i + '">Garder ' + esc(money(h.priceBefore, cur)) + '</button>'
          + '<span style="flex:1"></span><button class="bhp-textbtn bhp-textbtn--vert" data-act="algo" data-i="' + i + '" style="font-size:14px">Détail</button></div>';
      } else if (h && h.status === 'applied') {
        out += '<div class="bhb-line">' + U.okLine('Mis à jour sur les plateformes' + (h.appliedAt ? ' · ' + dayFr(h.appliedAt) : '')) + '<span style="flex:1"></span><button class="bhp-textbtn bhp-textbtn--vert" data-act="algo" data-i="' + i + '" style="font-size:14px">Détail du calcul</button></div>';
      } else {
        out += '<div class="bhp-meta" style="font-size:13.5px">Prix aligné sur le marché, aucun ajustement nécessaire.</div>';
      }
      return out + '</div>';
    }

    /* Calendrier */
    function calendrier() {
      var opts = (S.props || []).map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === S.calProp ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('');
      var h = '<div class="bhb-toolbar"><select class="bhp-input bhp-select bhb-sel" data-act-change="calprop">' + opts + '</select>'
        + '<button class="bhp-glassbtn" data-act="recompute"' + (S.calProp ? '' : ' disabled') + '>' + ic('sync') + 'Recalculer</button></div>';
      if (S.calState === 'loading' || S.calState === 'idle') return h + loading();
      if (S.calState === 'error') return h + err(S.calErr);
      if (!S.props || !S.props.length) return h + '<p class="bhp-state">Aucun logement.</p>';
      var d = S.cal || {}, rows = d.nights || [];
      if (d.configured === false) h += '<div class="bhp-info">' + ic('info') + '<span>BoostPrice n\'est pas activé sur ce logement. Activez-le dans Réglages.</span></div>';
      else if (d.isActive === false) h += '<div class="bhp-info">' + ic('info') + '<span>BoostPrice est en pause sur ce logement.</span></div>';
      else h += card('<div class="bhp-row bhp-kv"><span class="bhp-kv__l bhp-kv__l--ink">Mode</span><div class="bhm-seg" style="width:220px"><button class="bhm-seg__b' + (d.mode !== 'auto' ? ' is-on' : '') + '" data-act="calmode" data-v="manual">Suggestions</button><button class="bhm-seg__b' + (d.mode === 'auto' ? ' is-on' : '') + '" data-act="calmode" data-v="auto">Auto</button></div></div>');
      if (!rows.length) return h + '<div class="bhm-empty">' + ic('calendar') + '<span>Aucun planning pour ce logement.<br>Touchez « Recalculer » pour générer les prix.</span></div>';
      var prices = rows.map(function (r) { return +r.price; }), mn = Math.min.apply(null, prices), mx = Math.max.apply(null, prices), span = (mx - mn) || 1;
      var avg = Math.round(prices.reduce(function (a, b) { return a + b; }, 0) / prices.length);
      h += '<div class="bhb-calmeta"><span>' + U.pl(rows.length, 'nuit') + ' · moyenne ' + esc(money(avg)) + ' · ' + esc(money(mn)) + '–' + esc(money(mx)) + '</span>'
        + '<span class="bhb-legend"><i style="background:#E7EFE9"></i>bas<i style="background:#7FB59A"></i>moyen<i style="background:#1A7A5E"></i>élevé</span></div>';
      var DOW = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
      h += '<div class="bhb-cal">' + rows.map(function (r, i) {
        var dt = new Date(r.date + 'T00:00:00'), a = (+r.price - mn) / span;
        var c1 = [231, 239, 233], c2 = [26, 122, 94], m = c1.map(function (v, k) { return Math.round(v + (c2[k] - v) * a); });
        var dark = a > 0.55;
        return '<button class="bhb-night' + (dark ? ' is-dark' : '') + (S.calSel === i ? ' is-sel' : '') + '" data-act="night" data-i="' + i + '" style="background:rgb(' + m.join(',') + ')">'
          + '<span><i class="bhb-dow">' + DOW[dt.getDay()] + ' </i>' + dt.getDate() + '/' + (dt.getMonth() + 1) + '</span><b>' + Math.round(r.price) + ' €</b><span>min ' + (r.min_stay || 1) + ' n</span></button>';
      }).join('') + '</div>';
      return h;
    }
    function openNight(r) {
      var b = r.breakdown || {}, dt = new Date(r.date + 'T00:00:00');
      var sh = U.openSheet({ head: { kicker: 'Pourquoi ce prix', title: dt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }), right: '<button class="bhp-textbtn" data-act="sheet-close">Fermer</button>' } });
      var f = [['Saison', b.season], ['Jour de la semaine', b.dow], ['Délai de réservation', b.lead], ['Rythme des réservations', b.pacing], ['Marché', b.market], ['Événement', b.event], ['Nuit isolée', b.gap]]
        .filter(function (x) { return x[1] != null; });
      var h = '<div class="bhp-card bhf-hero"><div class="bhf-hero__l"><span class="bhp-meta">Prix de la nuit</span><b>' + esc(money(r.price)) + '</b></div>' + U.pill('min ' + U.pl(r.min_stay || 1, 'nuit'), 'neutre') + '</div>';
      if (r.reason) h += '<p class="bhp-note">' + esc(r.reason) + '</p>';
      h += '<div class="bhp-group">' + U.label('Calcul') + card(kv('Prix de base', b.base != null ? money(b.base) : '—') + f.map(function (x) {
        return '<div class="bhp-row bhp-kv"><span class="bhp-kv__l">' + esc(x[0]) + '</span><span class="bhp-kv__v ' + (x[1] > 1.001 ? 'bhb-up' : x[1] < 0.999 ? 'bhb-down' : '') + '">× ' + esc(f2(x[1])) + '</span></div>';
      }).join('')) + '</div>';
      if (b.eventLabel) h += '<div class="bhp-info">' + ic('sparkles') + '<span>' + esc(b.eventLabel) + '</span></div>';
      if (b.clampedToMin || b.clampedToMax) h += U.warn('Prix borné au ' + (b.clampedToMin ? 'minimum' : 'maximum') + ' configuré.');
      sh.body.innerHTML = '<div class="bhp-stack">' + h + '</div>';
    }

    /* Réglages */
    function reglages() {
      if (S.cState === 'loading' || S.cState === 'idle') return loading();
      if (S.cState === 'error') return err(S.cErr);
      if (!S.cfgs.length) return '<p class="bhp-state">Aucun logement trouvé dans votre compte.</p>';
      var act = S.cfgs.filter(function (c) { return c.isActive; }).length, h = '';
      if (S.cfgs.length > 1) {
        var activables = S.cfgs.filter(function (c) { return !c.isActive && c.saved; }).length, aRegler = S.cfgs.filter(function (c) { return !c.isActive && !c.saved; }).length;
        var btn = act === S.cfgs.length ? '<button class="bhp-glassbtn bhm-reject" style="color:#2C3A33" data-act="all" data-v="0">Tout désactiver</button>'
          : activables ? '<button class="bhm-call" data-act="all" data-v="1">Activer ' + U.pl(activables, 'logement') + ' réglé' + (activables > 1 ? 's' : '') + '</button>'
          : act ? '<button class="bhp-glassbtn bhm-reject" style="color:#2C3A33" data-act="all" data-v="0">Tout désactiver</button>' : '';
        h += '<div class="bhp-card bhb-pause"><div class="bhb-pause__t"><div><b>' + act + ' sur ' + S.cfgs.length + ' logements</b><span class="bhp-meta">avec BoostPrice actif'
          + (aRegler && activables ? ' · ' + aRegler + ' sans fourchette enregistrée' : '') + '</span></div></div>' + btn + '</div>';
      }
      h += U.label('Logements') + S.cfgs.map(cfgCard).join('');
      h += U.label('Notifications');
      var n = S.notif;
      if (!n) h += card(U.loadingRow());
      else if (n.off) h += '<p class="bhp-note">Préférences indisponibles pour le moment.</p>';
      else {
        var dis = n.logements === 0;
        h += card([['notifyPush', 'Ajustement automatique', 'Une notification quand un prix est modifié en mode auto.'], ['notifyEmail', 'Récapitulatif hebdomadaire', 'Chaque lundi : les ajustements et le revenu additionnel estimé.'], ['notifyAlert', 'Écart marché supérieur à 20 %', 'Alerte immédiate si le marché dépasse nettement votre prix.']].map(function (x) {
          return '<div class="bhp-row bhp-kv"><div class="bhb-tg"><span class="bhp-kv__l bhp-kv__l--ink">' + esc(x[1]) + '</span><span class="bhp-meta">' + esc(x[2]) + '</span></div>'
            + '<label class="bhp-switch"><input type="checkbox" data-notif="' + x[0] + '"' + (n[x[0]] ? ' checked' : '') + (dis ? ' disabled' : '') + '><span></span></label></div>';
        }).join(''));
        h += '<p class="bhp-note">' + esc(dis ? 'Activez BoostPrice sur au moins un logement pour régler vos notifications.' : 'Ces préférences s\'appliquent à vos ' + U.pl(n.logements, 'logement') + '.') + '</p>';
      }
      h += U.label('Saisonnalité appliquée automatiquement') + card(kv('Week-ends (vendredi et samedi)', '+10 %') + kv('Jours fériés', '+20 %') + kv('Vacances scolaires', '+15 %') + kv('Basse saison (novembre – mars)', '−10 %'));
      h += '<div class="bhp-info">' + ic('shield') + '<span>Chaque semaine, Boostinghost relève les prix des logements comparables à 1,5 km du vôtre. Vos prix ne sortent jamais de la fourchette que vous avez définie. Inclus dans votre abonnement.</span></div>';
      return h;
    }
    function cfgCard(c) {
      var i = S.cfgs.indexOf(c);
      var h = '<div class="bhp-card bhb-cfg' + (c.isActive ? ' is-on' : '') + '"><div class="bhp-row bhp-kv"><div class="bhb-tg"><span class="bhp-kv__l bhp-kv__l--ink" style="font-weight:600">' + esc(c.name) + '</span>'
        + '<span class="bhp-meta"' + (c.isActive ? ' style="color:#1F6B4C"' : '') + '>' + (c.isActive ? 'BoostPrice actif · ' + (c.mode === 'auto' ? 'automatique' : 'manuel') : 'Inactif') + '</span></div>'
        + '<label class="bhp-switch"><input type="checkbox" data-cfg-on="' + i + '"' + (c.isActive ? ' checked' : '') + '><span></span></label></div>';
      if (c.isActive) {
        h += '<div class="bhp-row bhp-kv"><span class="bhp-kv__l">Prix minimum</span><span class="bhp-in-wrap"><input class="bhp-input bhp-input--r" data-cfg="' + i + '" data-f="priceMin" value="' + esc(c.priceMin) + '" inputmode="decimal"><span class="bhp-unit">' + esc(c.cur) + '</span></span></div>'
          + '<div class="bhp-row bhp-kv"><span class="bhp-kv__l">Prix maximum</span><span class="bhp-in-wrap"><input class="bhp-input bhp-input--r" data-cfg="' + i + '" data-f="priceMax" value="' + esc(c.priceMax) + '" inputmode="decimal"><span class="bhp-unit">' + esc(c.cur) + '</span></span></div>'
          + '<div class="bhp-row"><div class="bhb-strat"><span class="bhp-kv__l">Stratégie</span><b data-strat-l="' + i + '">' + esc(stratLabel(c.strategy)) + '</b></div>'
          + '<input type="range" class="bhb-range" min="0" max="100" step="5" value="' + esc(c.strategy) + '" data-cfg="' + i + '" data-f="strategy"><div class="bhb-strat bhp-meta" style="font-size:12px"><span>Remplir</span><span>Équilibré</span><span>Tenir le prix</span></div></div>'
          + '<div class="bhp-row"><div class="bhm-seg"><button class="bhm-seg__b' + (c.mode !== 'auto' ? ' is-on' : '') + '" data-act="cfgmode" data-i="' + i + '" data-v="manual">Manuel · je valide</button><button class="bhm-seg__b' + (c.mode === 'auto' ? ' is-on' : '') + '" data-act="cfgmode" data-i="' + i + '" data-v="auto">Auto · recommandé</button></div></div>'
          + (c.dirty ? '<div class="bhp-row"><button class="bhp-btn bhp-btn--primary" data-act="cfgsave" data-i="' + i + '">Enregistrer</button></div>' : '');
      }
      return h + '</div>';
    }

    /* Historique */
    function historique() {
      if (S.hState === 'loading' || S.hState === 'idle') return loading();
      if (S.hState === 'error') return err(S.hErr);
      if (!S.hist.length) return '<div class="bhm-empty">' + ic('clock') + '<span>Aucun ajustement pour le moment.</span></div>';
      var weeks = {};
      S.hist.forEach(function (x) { (weeks[x.weekStart] = weeks[x.weekStart] || []).push(x); });
      var ST = { applied: ['Appliqué', 'vert'], declined: ['Refusé', 'terra'], pending: ['En attente', 'or'], skipped: ['Stable', 'neutre'], error: ['Erreur', 'terra'] };
      return Object.keys(weeks).sort().reverse().map(function (w) {
        var rows = weeks[w], gain = rows.reduce(function (s, r) { return r.status === 'applied' && r.priceApplied && r.priceBefore ? s + (r.priceApplied - r.priceBefore) : s; }, 0);
        return '<div class="bhm-fold" style="cursor:default"><span class="bhp-label" style="margin:0">Semaine du ' + esc(dayFr(w)) + '</span>' + (gain > 0 ? '<b style="font-size:13px;color:#1F6B4C">+' + esc(money(gain)) + ' estimés</b>' : '') + '</div>'
          + card(rows.map(function (r) {
            var cur = r.propertyCurrency || 'EUR', after = r.priceApplied != null ? r.priceApplied : r.priceCalculated, st = ST[r.status] || [r.status, 'neutre'];
            return '<div class="bhp-row bho-cl"><div class="bho-cl__t"><div class="bho-cl__n">' + esc(r.propertyName) + '</div><div class="bhp-meta">' + esc(r.reason || tensionLabel(r.tensionLevel))
              + ' · ' + Math.round(r.marketOccupancy || 0) + ' % occupé · ' + (r.modeUsed === 'auto' ? 'auto' : 'manuel') + '</div></div>'
              + '<div class="bhc-right"><b style="font-size:15px">' + esc(money(r.priceBefore, cur)) + ' ' + (r.status === 'skipped' ? '=' : '→') + ' ' + esc(money(after, cur)) + '</b>' + U.pill(st[0], st[1]) + '</div></div>';
          }).join(''));
      }).join('');
    }

    /* Événements */
    function evenements() {
      if (S.eState === 'loading' || S.eState === 'idle') return loading();
      if (S.eState === 'error') return err(S.eErr);
      var opts = (S.props || []).map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === S.zoneProp ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('');
      var h = U.label('Zone scolaire') + card('<div class="bhp-row bhp-kv"><span class="bhp-kv__l">Logement</span><select class="bhp-input bhp-select" data-act-change="zoneprop">' + opts + '</select></div>'
        + '<div class="bhp-row bhp-kv"><span class="bhp-kv__l">Zone de vacances</span><div class="bhm-seg" style="width:180px">' + ['A', 'B', 'C'].map(function (z) {
          return '<button class="bhm-seg__b' + (S.zone === z ? ' is-on' : '') + '" data-act="zone" data-v="' + z + '">' + z + '</button>';
        }).join('') + '</div></div>');
      h += '<p class="bhp-note">Les vacances scolaires de cette zone sont appliquées automatiquement aux prix. La zone C correspond à l\'Île-de-France.</p>';
      h += '<div class="bhm-fold" style="cursor:default"><span class="bhp-label" style="margin:0">Mes événements</span><button class="bhp-glassbtn" data-act="ev-new">' + ic('plus') + 'Ajouter</button></div>';
      if (!S.events.length) h += '<p class="bhp-note">Aucun événement. Ajoutez vos salons, concerts ou festivals pour augmenter les prix de ces dates.</p>';
      else h += card(S.events.map(function (e, i) {
        return '<div class="bhp-row bho-cl bhp-row--tap" data-act="ev-edit" data-i="' + i + '"><div class="bho-cl__t"><div class="bho-cl__n">' + esc(e.label) + '</div><div class="bhp-meta">'
          + esc(dayFr(e.date_start)) + ' → ' + esc(dayFr(e.date_end)) + ' · ' + esc(e.property_id ? pname(e.property_id) : 'Tous les logements') + '</div></div>'
          + '<b style="font-size:15px;color:#1F6B4C">× ' + esc(f2(e.multiplier)) + '</b>' + CHEV + '</div>';
      }).join(''));
      return h;
    }
    function openEvent(e) {
      var d = e ? { id: e.id, label: e.label, start: String(e.date_start).slice(0, 10), end: String(e.date_end).slice(0, 10), mult: String(e.multiplier), scope: e.property_id ? String(e.property_id) : '' }
        : { label: '', start: '', end: '', mult: '1.15', scope: '' };
      var sh = U.openSheet({ head: { title: e ? 'Événement' : 'Nouvel événement', left: '<button class="bhp-textbtn bhp-textbtn--vert" data-act="sheet-close">Annuler</button>', right: '<button class="bhp-textbtn bhp-textbtn--vert" style="font-weight:600" data-act="ev-save">Enregistrer</button>' } });
      var opts = '<option value="">Tous les logements</option>' + (S.props || []).map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === d.scope ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('');
      sh.body.innerHTML = '<div class="bhp-stack">' + card('<div class="bhp-row"><input class="bhp-input" data-f="label" value="' + esc(d.label) + '" placeholder="Salon, concert, festival…"></div>'
        + '<div class="bhp-row bhp-kv"><span class="bhp-kv__l">Du</span><input class="bhp-input bhp-input--r" type="date" data-f="start" value="' + esc(d.start) + '" style="width:auto"></div>'
        + '<div class="bhp-row bhp-kv"><span class="bhp-kv__l">Au</span><input class="bhp-input bhp-input--r" type="date" data-f="end" value="' + esc(d.end) + '" style="width:auto"></div>'
        + '<div class="bhp-row bhp-kv"><span class="bhp-kv__l">Multiplicateur</span><span class="bhp-in-wrap"><span class="bhp-unit">×</span><input class="bhp-input bhp-input--s" data-f="mult" value="' + esc(d.mult.replace('.', ',')) + '" inputmode="decimal"></span></div>'
        + '<div class="bhp-row bhp-kv"><span class="bhp-kv__l">Logement</span><select class="bhp-input bhp-select" data-f="scope">' + opts + '</select></div>')
        + '<p class="bhp-note">Par exemple × 1,15 augmente les prix de 15 % sur ces dates.</p>'
        + (e ? '<button class="bhp-btn bhp-btn--danger" data-act="ev-del">Supprimer l\'événement</button>' : '') + '</div>';
      function val(f) { var el = sh.el.querySelector('[data-f="' + f + '"]'); return el ? el.value.trim() : ''; }
      sh.el.addEventListener('click', function (ev) {
        var el = ev.target.closest('[data-act]'); if (!el) return;
        if (el.dataset.act === 'ev-save') {
          var body = { id: d.id, label: val('label'), date_start: val('start'), date_end: val('end'), multiplier: U.num(val('mult')) || 1.15, property_id: val('scope') || null };
          if (!body.label || !body.date_start || !body.date_end) { U.alertMsg('Champs manquants', 'Indiquez un nom et les dates.'); return; }
          if (body.date_end < body.date_start) { U.alertMsg('Dates', 'La date de fin doit suivre la date de début.'); return; }
          sh.locked = true;
          U.api('POST', '/api/pricing/events', body).then(function (r) { if (r && r.error) throw new Error(r.error); sh.locked = false; sh.close(); loadEvents(); })
            .catch(function (er) { sh.locked = false; U.alertMsg('Erreur', er.message); });
        }
        if (el.dataset.act === 'ev-del') {
          U.confirmMsg('Supprimer cet événement ?', e.label, 'Supprimer').then(function (ok) {
            if (!ok) return;
            U.api('DELETE', '/api/pricing/events/' + encodeURIComponent(e.id)).then(function () { sh.close(); loadEvents(); }).catch(function (er) { U.alertMsg('Erreur', er.message); });
          });
        }
      });
    }

    /* Détail du calcul (suggestion) */
    function openAlgo(p) {
      var h = p.history || {}, m = p.market || {}, cur = p.propertyCurrency || 'EUR', occ = m.occupancyRate || 0;
      var fM = occ >= 80 ? 1.22 : occ >= 65 ? 1.15 : occ >= 45 ? 1.02 : occ >= 25 ? 0.92 : 0.82, fS = parseFloat(h.factorSeason) || 1;
      var reco = h.status === 'pending' ? h.priceCalculated : (h.priceApplied != null ? h.priceApplied : h.priceCalculated);
      var sh = U.openSheet({ head: { kicker: 'Détail du calcul', title: p.propertyName, right: '<button class="bhp-textbtn" data-act="sheet-close">Fermer</button>' } });
      sh.body.innerHTML = '<div class="bhp-stack">' + card(kv('Prix médian du marché', money(m.medianPrice, cur))
        + kv('Tension du marché (' + Math.round(occ) + ' % occupé)', '× ' + f2(fM)) + kv('Saisonnalité', '× ' + f2(fS))
        + '<div class="bhp-row bhp-kv"><span class="bhp-kv__l bhp-kv__l--ink" style="font-weight:600">Prix recommandé</span><span class="bhp-kv__v" style="font-size:17px;font-weight:700">' + esc(money(reco, cur)) + '</span></div>')
        + '<p class="bhp-note">Le calcul part du prix médian des logements comparables, puis applique l\'occupation du marché, votre propre occupation et la saison. Le résultat reste dans votre fourchette ' + esc(money(p.priceMin, cur)) + '–' + esc(money(p.priceMax, cur)) + '.</p></div>';
    }

    /* ── Actions ── */
    function decide(p, action, btn) {
      var h = p.history, cur = p.propertyCurrency || 'EUR';
      if (!h || h._historyId == null) { loadDash(); return; }
      btn.disabled = true;
      U.api('POST', DP + '/decision/' + encodeURIComponent(h._historyId), { action: action }).then(function (r) {
        if (action === 'apply') {
          var msg = r.otaSynced ? 'Prix publié sur Airbnb et Booking.' : r.publishStatus === 'partial' ? 'Prix enregistré, synchronisation partielle avec les plateformes.'
            : r.publishStatus === 'error' ? 'Prix enregistré, mais la synchronisation avec les plateformes a échoué.' : 'Prix enregistré dans Boostinghost.';
          U.alertMsg(money(r.priceApplied != null ? r.priceApplied : h.priceCalculated, cur) + ' appliqué', msg);
        }
        loadDash();
      }).catch(function (e) { btn.disabled = false; U.alertMsg('Erreur', e.message); });
    }
    function saveCfg(c, active) {
      var mn = U.num(c.priceMin), mx = U.num(c.priceMax);
      if (active && (mn == null || mx == null || mn >= mx)) { U.alertMsg('Fourchette invalide', 'Le prix minimum doit être inférieur au prix maximum.'); return Promise.resolve(false); }
      var was = c.wasActive;
      return U.api('POST', DP + '/config', { propertyId: c.propertyId, priceMin: mn || 40, priceMax: mx || 200, mode: c.mode || 'manual', strategy: +c.strategy, isActive: active }).then(function () {
        c.isActive = active; c.saved = true; c.dirty = false;
        if (active && !was) U.api('POST', '/api/pricing/analyze-now/' + encodeURIComponent(c.propertyId)).catch(function () {});
        c.wasActive = active; S.dState = 'loading'; loadDash(); render(); return true;
      }).catch(function (e) { U.alertMsg('Erreur', e.message); render(); return false; });
    }

    root.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
      var a = el.dataset.act;
      if (a === 'back') { location.href = '/manage.html'; return; }
      if (a === 'tab') { S.tab = el.dataset.v; history.replaceState(null, '', location.pathname + (S.tab === 'apercu' ? '' : '?vue=' + S.tab)); window.scrollTo(0, 0); render(); ensure(); return; }
      if (a === 'retry') { if (S.tab === 'apercu') { S.dState = 'loading'; render(); loadDash(); } if (S.tab === 'reglages') loadCfg(); if (S.tab === 'historique') loadHist(); if (S.tab === 'calendrier') initCal(); if (S.tab === 'evenements') loadEvents(); return; }
      if (a === 'pause') {
        var on = el.dataset.v === '1';
        (on ? U.confirmMsg('Mettre BoostPrice en pause ?', 'Plus aucun prix ne sera ajusté. Les prix déjà publiés restent en place. Chaque logement retrouvera son réglage à la reprise.', 'Mettre en pause') : Promise.resolve(true)).then(function (ok) {
          if (!ok) return; el.disabled = true;
          U.api('POST', DP + '/pause', { paused: on }).then(loadDash).catch(function (er) { el.disabled = false; U.alertMsg('Erreur', er.message); });
        });
        return;
      }
      if (a === 'analyze') {
        el.disabled = true; el.innerHTML = '<span class="bhp-spin bhp-spin--v"></span>Analyse en cours…';
        U.api('POST', '/api/pricing/analyze-now/' + encodeURIComponent(el.dataset.pid) + '?force=1').then(function () {
          U.alertMsg('Analyse lancée', 'Les données du marché arrivent dans une minute environ.');
          var n = 0, t = setInterval(function () { n++; loadDash(); if (n >= 6) clearInterval(t); }, 30000);
        }).catch(function (er) { el.disabled = false; U.alertMsg('Erreur', er.message); render(); });
        return;
      }
      if (a === 'decide') return decide(S.dash.properties[+el.dataset.i], el.dataset.a, el);
      if (a === 'algo') return openAlgo(S.dash.properties[+el.dataset.i]);
      if (a === 'night') { S.calSel = +el.dataset.i; render(); return openNight(S.cal.nights[S.calSel]); }
      if (a === 'recompute') {
        el.disabled = true;
        U.api('POST', '/api/pricing/recompute/' + encodeURIComponent(S.calProp)).then(function (d) {
          if (d && d.error) throw new Error(d.error);
          U.alertMsg('Prix recalculés', U.pl(d.nights || 0, 'nuit') + (d.status === 'applied' ? ' publiée' + ((d.nights || 0) > 1 ? 's' : '') + ' sur vos plateformes.' : ' calculée' + ((d.nights || 0) > 1 ? 's' : '') + '.'));
          loadCal();
        }).catch(function (er) { el.disabled = false; U.alertMsg('Erreur', er.message); });
        return;
      }
      if (a === 'calmode') {
        var mode = el.dataset.v; if (S.cal && S.cal.mode === mode) return;
        (mode === 'auto' ? U.dialog({ title: 'Passer en mode Auto ?', message: 'Les prix seront mis à jour automatiquement sur vos plateformes (Airbnb, Booking…).', actions: [{ label: 'Annuler', role: 'cancel', value: false }, { label: 'Activer', value: true }] }) : Promise.resolve(true)).then(function (ok) {
          if (!ok) return;
          U.api('PUT', '/api/pricing/mode/' + encodeURIComponent(S.calProp), { mode: mode }).then(function (d) { if (d && d.error) throw new Error(d.error); S.cal.mode = mode; S.cState = 'idle'; render(); })
            .catch(function (er) { U.alertMsg('Erreur', er.message); });
        });
        return;
      }
      if (a === 'all') {
        var activer = el.dataset.v === '1';
        var cibles = S.cfgs.filter(function (c) { return activer ? (!c.isActive && c.saved) : c.isActive; });
        U.dialog({ title: (activer ? 'Activer' : 'Désactiver') + ' BoostPrice sur ' + U.pl(cibles.length, 'logement') + ' ?',
          message: activer ? 'Chacun garde sa fourchette de prix. En mode manuel, rien n\'est publié sans votre accord.' : 'Les prix déjà publiés chez les plateformes restent en place.',
          actions: [{ label: 'Annuler', role: 'cancel', value: false }, { label: activer ? 'Activer' : 'Désactiver', role: activer ? '' : 'destructive', value: true }] }).then(function (ok) {
          if (!ok) return; el.disabled = true;
          cibles.reduce(function (pr, c) { return pr.then(function () { c.wasActive = c.isActive; return saveCfg(c, activer); }); }, Promise.resolve()).then(loadCfg);
        });
        return;
      }
      if (a === 'cfgmode') { var c = S.cfgs[+el.dataset.i]; if (c.mode !== el.dataset.v) { c.mode = el.dataset.v; c.dirty = true; render(); } return; }
      if (a === 'cfgsave') { var c2 = S.cfgs[+el.dataset.i]; c2.wasActive = true; el.disabled = true; saveCfg(c2, true); return; }
      if (a === 'zone') {
        var z = el.dataset.v, prev = S.zone; S.zone = z; render();
        U.api('PUT', '/api/pricing/zone', { propertyId: S.zoneProp, zone: z }).then(function (d) { if (d && d.ok === false) throw new Error(d.error || 'Enregistrement impossible.'); })
          .catch(function (er) { S.zone = prev; render(); U.alertMsg('Erreur', er.message); });
        return;
      }
      if (a === 'ev-new') return openEvent(null);
      if (a === 'ev-edit') return openEvent(S.events[+el.dataset.i]);
    });
    root.addEventListener('change', function (e) {
      var t = e.target;
      if (t.dataset.actChange === 'calprop') { S.calProp = t.value; loadCal(); return; }
      if (t.dataset.actChange === 'zoneprop') { S.zoneProp = t.value; loadZone(); render(); return; }
      if (t.hasAttribute('data-cfg-on')) {
        var c = S.cfgs[+t.dataset.cfgOn]; c.wasActive = c.isActive;
        if (t.checked) { c.isActive = true; c.dirty = !c.saved; render(); if (c.saved) saveCfg(c, true); }
        else saveCfg(c, false);
        return;
      }
      if (t.hasAttribute('data-notif')) {
        var key = t.dataset.notif, v = t.checked; t.disabled = true;
        U.api('PATCH', DP + '/notifications', { key: key, value: v }).then(function () { S.notif[key] = v; })
          .catch(function (er) { t.checked = !v; U.alertMsg('Erreur', er.message); }).then(function () { t.disabled = false; });
      }
    });
    root.addEventListener('input', function (e) {
      var t = e.target; if (!t.hasAttribute('data-cfg')) return;
      var c = S.cfgs[+t.dataset.cfg]; c[t.dataset.f] = t.value;
      if (t.dataset.f === 'strategy') { var l = root.querySelector('[data-strat-l="' + t.dataset.cfg + '"]'); if (l) l.textContent = stratLabel(t.value); }
      // Pas de re-rendu ici (il casserait la saisie et le glissé du curseur) : on ajoute juste le bouton.
      if (!c.dirty) { c.dirty = true; var box = t.closest('.bhb-cfg'); if (box) box.insertAdjacentHTML('beforeend', '<div class="bhp-row"><button class="bhp-btn bhp-btn--primary" data-act="cfgsave" data-i="' + t.dataset.cfg + '">Enregistrer</button></div>'); }
    });

    render(); loadDash(); ensure();
  };
})();
