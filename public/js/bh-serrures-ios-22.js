/* bh-serrures-ios-22.js — Gestion › Serrures connectées (Smart Locks), dans le style des écrans iOS
   /serrures.html (?vue=codes|marques) — mêmes routes que l'ancienne page smart-locks.html (/api/smart-locks).
   Dépend de bh-prop-ios-12.js (BHP.ui). */
(function () {
  'use strict';
  var BHP = window.BHP || {}, U = BHP.ui;
  if (!U) { console.error('bh-serrures-ios-22 : charger bh-prop-ios-12.js avant.'); return; }
  var esc = U.esc, ic = U.ic, card = U.card, kv = U.kv, CHEV = U.CHEV;
  var SL = '/api/smart-locks';
  var TABS = [['serrures', 'Serrures'], ['codes', 'Codes'], ['marques', 'Marques']];
  var TYPE = { padlock: 'Cadenas', keybox: 'Boîte à clés', keypad: 'Clavier' };
  var ST = { active: ['Actif', 'vert'], expired: ['Expiré', 'neutre'], revoked: ['Révoqué', 'terra'] };

  function dShort(d) { var x = new Date(d); return isNaN(x) ? '—' : x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }); }
  function dTime(d) { var x = new Date(d); return isNaN(x) ? '—' : x.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  function localISO(d) { var p = function (n) { return String(n).padStart(2, '0'); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  function batt(b) { return b == null ? '' : '<span class="bhk-bat ' + (b > 50 ? 'is-ok' : b > 20 ? 'is-mid' : 'is-low') + '"><i style="width:' + Math.max(8, Math.min(100, b)) + '%"></i></span>' + b + ' %'; }

  BHP.initSerrures = function () {
    var root = document.getElementById('bhpApp');
    var vue = new URLSearchParams(location.search).get('vue');
    var S = { tab: TABS.some(function (t) { return t[0] === vue; }) ? vue : 'serrures', state: 'loading', locks: [], codes: [], brands: [], status: null, props: [], filter: 'active' };

    function load() {
      return Promise.all([
        U.api('GET', SL + '/status'), U.api('GET', SL + '/'), U.api('GET', SL + '/codes'),
        U.api('GET', SL + '/brands').catch(function () { return { brands: [] }; }),
        U.api('GET', '/api/properties').catch(function () { return { properties: [] }; })
      ]).then(function (r) {
        S.status = r[0]; S.locks = (r[1].locks || []).filter(function (l) { return l.lock_type !== 'bridge'; });
        S.codes = r[2].codes || []; S.brands = r[3].brands || [];
        S.props = (r[4].properties || (Array.isArray(r[4]) ? r[4] : [])).map(function (p) { return { id: String(p.id), name: p.internal_name || p.internalName || p.name || String(p.id) }; });
        S.state = 'loaded';
      }).catch(function (e) { S.state = 'error'; S.err = e.status === 403 ? 'Vous n\'avez pas accès aux serrures connectées.' : e.message; }).then(render);
    }
    function reloadCodes() { return U.api('GET', SL + '/codes').then(function (r) { S.codes = r.codes || []; render(); }).catch(function () {}); }

    function render() {
      var st = S.status && S.status.stats;
      var kick = '&#160;';
      if (st) kick = (st.activeCodes || 0) + ' code' + (st.activeCodes === 1 ? ' actif' : 's actifs') + ' · ' + U.pl(S.locks.length, 'serrure');
      var seg = '<div class="bhm-seg">' + TABS.map(function (t) { return '<button class="bhm-seg__b' + (S.tab === t[0] ? ' is-on' : '') + '" data-act="tab" data-v="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>';
      var right = S.state === 'loaded' && S.status && S.status.connected ? U.circleBtn('sync', 'sync', 'Synchroniser') + U.circleBtn('plus', 'gen', 'Nouveau code') : '';
      var nav = '<header class="bhp-nav"><div class="bhm-nav__in">' + U.circleBtn('chevL', 'back', 'Gestion') + '<div class="bhm-nav__t"><div class="bhp-nav__kicker" style="text-align:left">' + kick + '</div><h1 class="bhm-title">Serrures</h1></div>' + right + '</div><div class="bhm-nav__in2">' + seg + '</div></header>';
      var h;
      if (S.state === 'loading') h = '<div class="bhp-state bhp-center"><span class="bhp-spin bhp-spin--lg"></span></div>';
      else if (S.state === 'error') h = '<div class="bhm-empty">' + ic('warnFill') + '<span>' + esc(S.err) + '</span><button class="bhp-glassbtn" data-act="retry">Réessayer</button></div>';
      else h = S.tab === 'serrures' ? serrures() : S.tab === 'codes' ? codes() : marques();
      root.innerHTML = nav + '<div class="bhp-stack bhm-stack">' + h + '</div>';
    }

    function serrures() {
      if (!S.locks.length) {
        var con = S.status && S.status.connected;
        return '<div class="bhm-empty">' + ic('key') + '<span><b style="color:#14201B">Aucune serrure</b><br>' + (con ? 'Synchronisez pour récupérer les serrures de votre compte.' : 'Connectez d\'abord votre marque (Igloohome, Nuki, TTLock).') + '</span>'
          + (con ? '<button class="bhm-call" data-act="sync">' + ic('sync') + 'Synchroniser</button>' : '<button class="bhm-call" data-act="tab" data-v="marques">Connecter une marque</button>') + '</div>';
      }
      var free = S.locks.filter(function (l) { return !l.assignment; }).length, low = S.locks.filter(function (l) { return l.battery_level != null && l.battery_level <= 20; }).length;
      var h = '';
      if (low) h += U.warn(U.pl(low, 'serrure') + ' avec une batterie faible. Pensez à changer les piles.', true);
      if (free) h += '<div class="bhp-info">' + ic('info') + '<span>' + U.pl(free, 'serrure') + ' non associée' + (free > 1 ? 's' : '') + ' à un logement : aucun code ne sera créé automatiquement pour les réservations.</span></div>';
      return h + card(S.locks.map(function (l, i) {
        return '<div class="bhp-row bho-cl" data-act="lock" data-i="' + i + '"><div class="bhk-ic' + (l.is_online ? ' is-on' : '') + '">' + U.I.key + '</div><div class="bho-cl__t"><div class="bho-cl__n">' + esc(l.lock_name) + '</div>'
          + '<div class="bhp-meta">' + esc((l.brand || '').replace(/^\w/, function (c) { return c.toUpperCase(); })) + ' · ' + esc(TYPE[l.lock_type] || 'Serrure') + '</div>'
          + '<div class="bhp-meta" style="color:' + (l.assignment ? '#1F6B4C' : '#A8452A') + '">' + esc(l.assignment ? l.assignment.property_name : 'Non associée') + '</div></div>'
          + '<div class="bhc-right"><span class="bhp-meta bhk-batl">' + batt(l.battery_level) + '</span></div>' + CHEV + '</div>';
      }).join(''));
    }

    function codes() {
      var list = S.filter === 'all' ? S.codes : S.codes.filter(function (c) { return c.status === S.filter; });
      var n = function (s) { return S.codes.filter(function (c) { return c.status === s; }).length; };
      var chips = '<div class="bhp-chips"><div class="bhp-chips__in">' + [['active', 'Actifs · ' + n('active')], ['expired', 'Expirés · ' + n('expired')], ['revoked', 'Révoqués · ' + n('revoked')], ['all', 'Tous']].map(function (c) {
        return '<button class="bhm-chip' + (S.filter === c[0] ? ' is-on' : '') + '" data-act="filter" data-v="' + c[0] + '">' + c[1] + '</button>';
      }).join('') + '</div></div>';
      if (!list.length) return chips + '<div class="bhm-empty">' + ic('key') + '<span>Aucun code ' + (S.filter === 'active' ? 'actif' : S.filter === 'expired' ? 'expiré' : S.filter === 'revoked' ? 'révoqué' : '') + '.<br>Les codes des réservations sont créés automatiquement pour les logements associés à une serrure.</span>'
        + (S.status && S.status.connected ? '<button class="bhm-call" data-act="gen">' + ic('plus') + 'Nouveau code</button>' : '') + '</div>';
      return chips + card(list.map(codeRow).join(''));
    }
    function codeRow(c) {
      var st = ST[c.status] || [c.status || '—', 'neutre'];
      return '<div class="bhp-row bho-cl" style="cursor:default"><div class="bho-cl__t"><div class="bhk-code' + (c.status === 'active' ? '' : ' is-off') + '">' + esc(c.code) + '</div>'
        + '<div class="bhp-meta">' + esc(c.guest_name || 'Voyageur') + ' · ' + esc(dShort(c.valid_from)) + ' → ' + esc(dShort(c.valid_until)) + '</div>'
        + '<div class="bhp-meta">' + esc([c.property_name, c.lock_name].filter(Boolean).join(' · ') || '—') + (c.reservation_uid ? '' : ' · manuel') + '</div></div>'
        + '<div class="bhc-right">' + U.pill(st[0], st[1]) + (c.status === 'active' ? '<button class="bhp-textbtn" style="font-size:13.5px;color:#A8452A;padding:2px 0" data-act="revoke" data-id="' + esc(c.id) + '">Révoquer</button>' : '') + '</div></div>';
    }

    function marques() {
      if (!S.brands.length) return '<p class="bhp-state">Impossible de charger les marques.</p>';
      var conns = (S.status && S.status.connections) || [];
      return S.brands.map(function (b) {
        var c = conns.filter(function (x) { return x.brand === b.key; })[0], on = c && c.connected;
        return '<div class="bhp-card bhk-brand"><div class="bhk-brand__top"><div class="bhk-ic' + (on ? ' is-on' : '') + '">' + U.I.key + '</div><div class="bho-cl__t"><div class="bhm-ac__n">' + esc(b.label) + '</div>'
          + '<div class="bhp-meta">' + (on ? 'Connecté' + (c.lastSync ? ' · synchronisé le ' + esc(dTime(c.lastSync)) : '') : 'Non connecté') + '</div></div>' + U.pill(on ? 'Connecté' : 'Hors ligne', on ? 'vert' : 'neutre') + '</div>'
          + (on ? '' : '<p class="bhp-note">' + esc(b.helpText || '') + '</p>')
          + '<div class="bhm-vc__acts">' + (on ? '<button class="bhm-call" data-act="sync-brand" data-v="' + esc(b.key) + '">' + ic('sync') + 'Synchroniser</button><button class="bhp-glassbtn bhm-reject" data-act="disconnect" data-v="' + esc(b.key) + '">Déconnecter</button>'
            : '<button class="bhm-call" data-act="connect" data-v="' + esc(b.key) + '">Connecter</button>' + (b.helpUrl ? '<a class="bhp-glassbtn" style="text-decoration:none" href="' + esc(b.helpUrl) + '" target="_blank" rel="noopener">Aide</a>' : '')) + '</div></div>';
      }).join('');
    }

    /* ── Fiche serrure ── */
    function openLock(l) {
      var sh = U.openSheet({ head: { kicker: (l.brand || '') + ' · ' + (TYPE[l.lock_type] || 'Serrure'), title: l.lock_name, right: '<button class="bhp-textbtn" data-act="sheet-close">Fermer</button>' } });
      var st = { battery: l.battery_level, isOnline: l.is_online }, logs = null;
      function draw() {
        var lc = S.codes.filter(function (c) { return String(c.lock_id) === String(l.id); }).sort(function (a, b) { return (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || new Date(a.valid_from) - new Date(b.valid_from); });
        var h = '<div class="bhp-card bhf-hero"><div class="bhf-hero__l"><span class="bhp-meta">Batterie</span><b>' + (st.battery != null ? st.battery + ' %' : '—') + '</b></div>' + U.pill(st.isOnline ? 'En ligne' : 'Hors ligne', st.isOnline ? 'vert' : 'neutre') + '</div>';
        if (st.isOnline && l.lock_type !== 'keypad') h += '<div class="bhm-vc__acts"><button class="bhm-call" style="flex:1;justify-content:center" data-act="unlock">' + ic('key') + 'Déverrouiller</button><button class="bhp-glassbtn" style="flex:1;justify-content:center" data-act="lockit">Verrouiller</button></div>';
        h += '<div class="bhp-group">' + U.label('Logement') + card(l.assignment
          ? '<div class="bhp-row bhp-kv"><span class="bhp-kv__l bhp-kv__l--ink">' + esc(l.assignment.property_name) + '</span><span><button class="bhp-textbtn bhp-textbtn--vert" style="font-size:14px" data-act="assign">Changer</button> <button class="bhp-textbtn" style="font-size:14px;color:#A8452A" data-act="unassign">Dissocier</button></span></div>'
          : '<div class="bhp-row bhp-kv"><span class="bhp-kv__l">Non associée</span><button class="bhp-textbtn bhp-textbtn--vert" style="font-size:14px;font-weight:600" data-act="assign">Associer à un logement</button></div>') + '</div>';
        h += '<div class="bhp-group">' + U.label('Codes · ' + lc.length) + (lc.length ? card(lc.map(codeRow).join('')) : U.emptyCard('Aucun code enregistré.')) + '</div>';
        h += '<button class="bhp-btn bhp-btn--mint" data-act="newcode">' + ic('plus') + 'Ajouter un code</button>';
        h += '<div class="bhp-group">' + U.label('Informations') + card(kv('Marque', l.brand || '—') + (l.model ? kv('Modèle', l.model) : '') + (l.serial_number ? kv('N° de série', l.serial_number) : '') + (st.firmwareVersion ? kv('Firmware', st.firmwareVersion) : '')) + '</div>';
        if (st.isOnline) h += logs == null ? '<button class="bhp-btn bhp-btn--ghost" data-act="activity">' + ic('clock') + 'Voir l\'activité récente</button>'
          : '<div class="bhp-group">' + U.label('Activité récente') + (logs === 'loading' ? card(U.loadingRow()) : !logs.length ? U.emptyCard('Aucune activité récente.')
            : card(logs.slice(0, 20).map(function (g) { return kv(g.eventType || g.type || g.action || '—', dTime(g.createdAt || g.timestamp)); }).join(''))) + '</div>';
        sh.body.innerHTML = '<div class="bhp-stack">' + h + '</div>';
      }
      sh.body.addEventListener('click', function (e) {
        var el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
        var a = el.dataset.act;
        if (a === 'unlock' || a === 'lockit') {
          var act = a === 'unlock' ? 'unlock' : 'lock';
          (act === 'unlock' ? U.dialog({ title: 'Déverrouiller à distance ?', message: l.lock_name + ' va s\'ouvrir maintenant.', actions: [{ label: 'Annuler', role: 'cancel', value: false }, { label: 'Déverrouiller', value: true }] }) : Promise.resolve(true)).then(function (ok) {
            if (!ok) return; el.disabled = true; el.innerHTML = '<span class="bhp-spin' + (act === 'unlock' ? ' bhp-spin--w' : ' bhp-spin--v') + '"></span>';
            U.api('POST', SL + '/lock/' + encodeURIComponent(l.id) + '/' + act, {}).then(function (r) { U.alertMsg(r.success ? (act === 'unlock' ? 'Serrure déverrouillée' : 'Serrure verrouillée') : 'Commande envoyée', r.success ? '' : 'La serrure exécutera la commande dès qu\'elle sera joignable.'); })
              .catch(function (er) { U.alertMsg('Erreur', er.message); }).then(draw);
          });
        }
        if (a === 'assign') return assign(l, draw);
        if (a === 'unassign') {
          U.confirmMsg('Dissocier la serrure ?', 'Plus aucun code ne sera créé automatiquement pour ' + l.assignment.property_name + '.', 'Dissocier').then(function (ok) {
            if (!ok) return;
            U.api('POST', SL + '/unassign', { lockId: l.id }).then(function () { l.assignment = null; draw(); render(); }).catch(function (er) { U.alertMsg('Erreur', er.message); });
          });
        }
        if (a === 'newcode') return gen({ lock: l, after: draw });
        if (a === 'revoke') return revoke(el.dataset.id, draw);
        if (a === 'activity') {
          logs = 'loading'; draw();
          U.api('GET', SL + '/lock/' + encodeURIComponent(l.id) + '/activity').then(function (r) { logs = r.logs || []; }).catch(function () { logs = []; }).then(draw);
        }
      });
      draw();
      U.api('GET', SL + '/lock/' + encodeURIComponent(l.id) + '/status').then(function (r) { st = Object.assign(st, r); draw(); }).catch(function () {});
    }
    function assign(l, after) {
      var sh = U.openSheet({ head: { title: 'Associer à un logement', left: '<button class="bhp-textbtn bhp-textbtn--vert" data-act="sheet-close">Annuler</button>' } });
      sh.body.innerHTML = '<div class="bhp-stack"><p class="bhp-note" style="font-size:14px">Les codes des réservations à venir de ce logement seront créés automatiquement.</p>'
        + card(S.props.map(function (p) { var on = l.assignment && String(l.assignment.property_id) === p.id; return '<div class="bhp-row bho-cl" data-pid="' + esc(p.id) + '"><div class="bho-cl__t"><div class="bho-cl__n">' + esc(p.name) + '</div></div>' + (on ? ic('checkFill', 'bhm-ok') : '') + '</div>'; }).join('')) + '</div>';
      sh.body.addEventListener('click', function (e) {
        var r = e.target.closest('[data-pid]'); if (!r || sh.locked) return;
        sh.locked = true; r.style.opacity = '.5';
        U.api('POST', SL + '/assign', { lockId: l.id, propertyId: r.dataset.pid }).then(function (res) {
          var p = S.props.filter(function (x) { return x.id === r.dataset.pid; })[0];
          l.assignment = { property_id: r.dataset.pid, property_name: p ? p.name : '' };
          sh.locked = false; sh.close(); render(); reloadCodes().then(after);
          if (res.codesGenerated) U.alertMsg('Serrure associée', U.pl(res.codesGenerated, 'code') + ' créé' + (res.codesGenerated > 1 ? 's' : '') + ' pour les réservations à venir.');
        }).catch(function (er) { sh.locked = false; r.style.opacity = ''; U.alertMsg('Erreur', er.message); });
      });
    }
    function revoke(id, after) {
      U.confirmMsg('Révoquer ce code ?', 'Il ne fonctionnera plus sur la serrure.', 'Révoquer').then(function (ok) {
        if (!ok) return;
        U.api('POST', SL + '/codes/revoke', { codeId: id }).then(function () { return reloadCodes(); }).then(function () { if (after) after(); }).catch(function (er) { U.alertMsg('Erreur', er.message); });
      });
    }

    /* ── Nouveau code (manuel ou pour une réservation) ── */
    function gen(o) {
      o = o || {};
      var now = new Date(), start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 15, 0), end = new Date(start.getTime() + 20 * 3600000);
      var d = { pid: o.lock && o.lock.assignment ? String(o.lock.assignment.property_id) : '', resa: '', guest: '', start: localISO(start), end: localISO(end), resas: [] };
      var sh = U.openSheet({ head: { title: 'Nouveau code', left: '<button class="bhp-textbtn bhp-textbtn--vert" data-act="sheet-close">Annuler</button>', right: '<button class="bhp-textbtn bhp-textbtn--vert" style="font-weight:600" data-act="go">Créer</button>' } });
      function draw() {
        var lockOnly = o.lock && !o.lock.assignment;
        var h = card((lockOnly ? kv('Serrure', o.lock.lock_name) : '<div class="bhp-row bhp-kv"><span class="bhp-kv__l">Logement</span><select class="bhp-input bhp-select" data-f="pid"><option value="">Choisir…</option>'
          + S.props.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === d.pid ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></div>')
          + (d.pid && d.resas.length ? '<div class="bhp-row bhp-kv"><span class="bhp-kv__l">Réservation</span><select class="bhp-input bhp-select" data-f="resa"><option value="">Aucune (code manuel)</option>'
            + d.resas.map(function (r, i) { return '<option value="' + i + '"' + (String(i) === d.resa ? ' selected' : '') + '>' + esc((r.guest || 'Voyageur') + ' · ' + dShort(r.start) + ' → ' + dShort(r.end)) + '</option>'; }).join('') + '</select></div>' : '')
          + '<div class="bhp-row"><input class="bhp-input" data-f="guest" value="' + esc(d.guest) + '" placeholder="Nom (voyageur, ménage…)"></div>'
          + '<div class="bhp-row bhp-kv"><span class="bhp-kv__l">Début</span><input class="bhp-input" type="datetime-local" data-f="start" value="' + esc(d.start) + '" style="width:auto"></div>'
          + '<div class="bhp-row bhp-kv"><span class="bhp-kv__l">Fin</span><input class="bhp-input" type="datetime-local" data-f="end" value="' + esc(d.end) + '" style="width:auto"></div>');
        sh.body.innerHTML = '<div class="bhp-stack">' + h + '<p class="bhp-note">Le code est envoyé à la serrure et valable uniquement entre ces deux dates.</p></div>';
      }
      function loadResas() {
        d.resas = []; d.resa = ''; if (!d.pid) { draw(); return; }
        U.api('GET', '/api/reservations').then(function (r) {
          var now2 = new Date();
          d.resas = (r.reservations || []).filter(function (x) { return String(x.propertyId || x.property_id) === d.pid && x.status !== 'cancelled' && new Date(x.endDate || x.end_date) >= now2; })
            .map(function (x) { return { uid: x.uid, guest: x.guestName || x.guest_name || '', start: x.startDate || x.start_date, end: x.endDate || x.end_date }; });
        }).catch(function () {}).then(draw);
      }
      sh.body.addEventListener('change', function (e) {
        var f = e.target.dataset.f; if (!f) return;
        d[f] = e.target.value;
        if (f === 'pid') loadResas();
        if (f === 'resa' && d.resa !== '') { var r = d.resas[+d.resa]; d.guest = r.guest; d.start = localISO(new Date(r.start)); d.end = localISO(new Date(r.end)); draw(); }
      });
      sh.body.addEventListener('input', function (e) { var f = e.target.dataset.f; if (f === 'guest' || f === 'start' || f === 'end') d[f] = e.target.value; });
      sh.el.addEventListener('click', function (e) {
        if (!e.target.closest('[data-act="go"]') || sh.locked) return;
        var lockOnly = o.lock && !o.lock.assignment;
        if ((!lockOnly && !d.pid) || !d.start || !d.end) { U.alertMsg('Champs manquants', 'Choisissez un logement et les dates.'); return; }
        if (new Date(d.end) <= new Date(d.start)) { U.alertMsg('Dates', 'La fin doit suivre le début.'); return; }
        var r = d.resa !== '' ? d.resas[+d.resa] : null;
        sh.locked = true;
        U.api('POST', SL + '/codes/generate', { lockId: o.lock ? o.lock.id : undefined, propertyId: d.pid || null, reservationUid: r ? r.uid : null, guestName: d.guest || (o.lock ? 'Code BH' : ''),
          startDate: new Date(d.start).toISOString(), endDate: new Date(d.end).toISOString() }).then(function (res) {
          sh.locked = false; sh.close();
          U.alertMsg(res.alreadyExists ? 'Code existant' : 'Code créé', (res.code ? 'Code : ' + res.code : '') + (res.brand ? ' (' + res.brand + ')' : ''));
          return reloadCodes().then(function () { if (o.after) o.after(); });
        }).catch(function (er) { sh.locked = false; U.alertMsg('Erreur', er.message); });
      });
      draw(); if (d.pid) loadResas();
    }

    /* ── Marques ── */
    function connect(key) {
      var b = S.brands.filter(function (x) { return x.key === key; })[0]; if (!b) return;
      var sh = U.openSheet({ head: { kicker: 'Connecter', title: b.label, left: '<button class="bhp-textbtn bhp-textbtn--vert" data-act="sheet-close">Annuler</button>', right: '<button class="bhp-textbtn bhp-textbtn--vert" style="font-weight:600" data-act="go">Connecter</button>' } });
      sh.body.innerHTML = '<div class="bhp-stack">' + (b.helpText ? '<p class="bhp-note" style="font-size:14px">' + esc(b.helpText) + '</p>' : '')
        + card((b.connectFields || []).map(function (f) {
          return '<div class="bhp-row bhl-f"><label class="bhl-f__l">' + esc(f.label) + '</label><input class="bhp-input" data-key="' + esc(f.key) + '" type="' + (f.type === 'password' ? 'password' : 'text') + '" value="' + esc(f.default || '') + '" placeholder="' + esc(f.placeholder || '') + '" autocomplete="off"></div>';
        }).join('')) + (b.helpUrl ? '<a class="bhp-btn bhp-btn--ghost" style="text-decoration:none" href="' + esc(b.helpUrl) + '" target="_blank" rel="noopener">' + ic('share') + 'Où trouver ces informations ?</a>' : '') + '</div>';
      sh.el.addEventListener('click', function (e) {
        if (!e.target.closest('[data-act="go"]') || sh.locked) return;
        var cred = {}, miss = false;
        sh.body.querySelectorAll('[data-key]').forEach(function (i) { cred[i.dataset.key] = i.value.trim(); if (!cred[i.dataset.key]) miss = true; });
        if (miss) { U.alertMsg('Champs manquants', 'Remplissez tous les champs.'); return; }
        sh.locked = true;
        U.api('POST', SL + '/connect', { brand: key, credentials: cred }).then(function (r) {
          sh.locked = false; sh.close(); U.alertMsg('Connecté', r.message || (b.label + ' connecté.')); S.state = 'loading'; render(); load();
        }).catch(function (er) { sh.locked = false; U.alertMsg('Connexion impossible', er.message); });
      });
    }
    function sync(brand, el) {
      if (el) { el.disabled = true; }
      U.api('POST', SL + '/sync', brand ? { brand: brand } : {}).then(function (r) {
        U.alertMsg('Synchronisation terminée', U.pl(r.added || 0, 'serrure') + ' ajoutée' + ((r.added || 0) > 1 ? 's' : '') + ', ' + U.pl(r.updated || 0, 'mise', 's') + ' à jour.' + (r.errors && r.errors.length ? ' Erreurs : ' + r.errors.map(function (x) { return x.error || x.message || x; }).join(', ') : ''));
        load();
      }).catch(function (er) { if (el) el.disabled = false; U.alertMsg('Erreur', er.message); });
    }

    root.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
      var a = el.dataset.act;
      if (a === 'back') { location.href = '/manage.html'; return; }
      if (a === 'tab') { S.tab = el.dataset.v; history.replaceState(null, '', location.pathname + (S.tab === 'serrures' ? '' : '?vue=' + S.tab)); render(); return; }
      if (a === 'retry') { S.state = 'loading'; render(); load(); return; }
      if (a === 'filter') { S.filter = el.dataset.v; render(); return; }
      if (a === 'lock') return openLock(S.locks[+el.dataset.i]);
      if (a === 'gen') return gen();
      if (a === 'revoke') return revoke(el.dataset.id);
      if (a === 'sync') return sync(null, el);
      if (a === 'sync-brand') return sync(el.dataset.v, el);
      if (a === 'connect') return connect(el.dataset.v);
      if (a === 'disconnect') {
        U.confirmMsg('Déconnecter cette marque ?', 'Les codes déjà envoyés restent valables sur les serrures.', 'Déconnecter').then(function (ok) {
          if (!ok) return;
          U.api('POST', SL + '/disconnect', { brand: el.dataset.v }).then(load).catch(function (er) { U.alertMsg('Erreur', er.message); });
        });
      }
    });
    render(); load();
  };
})();
