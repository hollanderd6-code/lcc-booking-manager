/* bh-paiement-ios-24.js — Gestion › Lien de paiement, dans le style des écrans iOS
   /paiement.html — crée un lien Stripe « pour n'importe qui » (dépannage, prestation
   ponctuelle…), sans passer par une conversation. POST /api/upsell/manual (mode volant).
   Le compte qui encaisse : propriétaire choisi (s'il a Stripe) › propriétaire du logement ›
   compte du logement / compte choisi › compte Boostinghost. En mode « tous les comptes »,
   le compte est obligatoire (le serveur répond ACCOUNT_REQUIRED sinon).
   Dépend de bh-prop-ios-12.js (BHP.ui). */
(function () {
  'use strict';
  var BHP = window.BHP || {}, U = BHP.ui;
  if (!U) { console.error('bh-paiement-ios-24 : charger bh-prop-ios-12.js avant.'); return; }
  var esc = U.esc, ic = U.ic, card = U.card, htmlRow = U.htmlRow;

  var KINDS = [
    ['custom', 'Autre prestation'],
    ['late_checkout', 'Départ tardif'],
    ['early_checkin', 'Arrivée anticipée'],
    ['welcome_basket', "Panier d'accueil"]
  ];

  BHP.initPaiement = function () {
    var root = document.getElementById('bhpApp');
    var S = {
      state: 'loading', err: '',
      accounts: [], owners: [], properties: [], mustChoose: false,
      kind: 'custom', label: '', amount: '', account: '', property: '', owner: '', email: '', phone: '',
      busy: false, formErr: '', result: null
    };

    function load() {
      S.state = 'loading'; render();
      U.api('GET', '/api/upsell/targets').then(function (r) {
        S.accounts = r.accounts || []; S.owners = r.owners || []; S.properties = r.properties || [];
        S.mustChoose = !!r.mustChooseAccount;
        // Un seul compte visible : c'est lui qui encaisse, inutile de demander
        if (!S.mustChoose && S.accounts.length) S.account = S.accounts[0].id;
        S.state = 'loaded';
      }).catch(function (e) { S.state = 'error'; S.err = e.message || 'Chargement impossible.'; }).then(render);
    }

    function byId(list, id) { return list.filter(function (x) { return String(x.id) === String(id); })[0] || null; }
    function accountId() {
      var p = byId(S.properties, S.property);
      return p ? p.accountId : S.account;
    }
    /** Qui recevra l'argent — même ordre de priorité que le serveur. */
    function payee() {
      var owner = byId(S.owners, S.owner);
      var p = byId(S.properties, S.property);
      if (!owner && p && p.ownerId) owner = byId(S.owners, p.ownerId);
      if (owner && owner.stripeConnected) return { name: owner.name, ok: true };
      var acc = byId(S.accounts, accountId());
      if (acc && acc.stripeConnected) return { name: acc.name, ok: true };
      if (!acc && S.mustChoose) return null;
      return { name: 'compte Boostinghost', ok: false };
    }

    function render() {
      var nav = '<header class="bhp-nav"><div class="bhm-nav__in">' + U.circleBtn('chevL', 'back', 'Gestion')
        + '<div class="bhm-nav__t"><div class="bhp-nav__kicker" style="text-align:left">Encaissement direct</div><h1 class="bhm-title">Lien de paiement</h1></div></div></header>';
      var h;
      if (S.state === 'loading') h = '<div class="bhp-state bhp-center"><span class="bhp-spin bhp-spin--lg"></span></div>';
      else if (S.state === 'error') h = '<div class="bhm-empty">' + ic('warnFill') + '<span>' + esc(S.err) + '</span><button class="bhp-glassbtn" data-act="retry">Réessayer</button></div>';
      else if (S.result) h = resultView();
      else h = formView();
      root.innerHTML = nav + '<div class="bhp-stack bhm-stack">' + h + '</div>';
    }

    function formView() {
      var h = '<div class="bhp-info">' + ic('info') + '<span>Créez un lien de paiement pour n\'importe qui — un dépannage, une prestation ponctuelle — sans passer par une conversation. Envoyez-le par e-mail ou copiez-le.</span></div>';

      // Prestation
      var seg = '<div class="bhm-seg bhpay-seg">' + KINDS.map(function (k) {
        return '<button class="bhm-seg__b' + (S.kind === k[0] ? ' is-on' : '') + '" data-act="kind" data-v="' + k[0] + '">' + esc(k[1]) + '</button>';
      }).join('') + '</div>';
      var custom = S.kind === 'custom';
      h += U.label('Prestation') + card(
        htmlRow(seg)
        + htmlRow('<div class="bhp-lbl">' + (custom ? 'Intitulé<span class="bhp-req">obligatoire</span>' : 'Précision (optionnel)') + '</div>'
          + '<input class="bhp-input" data-f="label" maxlength="120" value="' + esc(S.label) + '" placeholder="' + (custom ? 'Dépannage plomberie, ménage supplémentaire…' : (S.kind === 'welcome_basket' ? 'Panier gourmand' : '14h00')) + '">')
        + htmlRow('<div class="bhp-lbl">Montant<span class="bhp-req">obligatoire</span></div>'
          + '<div class="bhp-in-wrap" style="width:100%"><input class="bhp-input" data-f="amount" inputmode="decimal" value="' + esc(S.amount) + '" placeholder="50"><span class="bhp-unit">€</span></div>')
      );

      // Encaissement
      var accId = accountId();
      var rows = '';
      if (S.mustChoose) {
        var lockedByProp = !!S.property;
        rows += htmlRow('<div class="bhp-lbl">Compte<span class="bhp-req">obligatoire</span></div>'
          + '<select class="bhp-input bhp-select bhp-select--full" data-f="account"' + (lockedByProp ? ' disabled' : '') + '>'
          + '<option value="">— Choisir le compte —</option>'
          + S.accounts.map(function (a) { return '<option value="' + esc(a.id) + '"' + (String(accId) === String(a.id) ? ' selected' : '') + '>' + esc(a.name + (a.isMe ? ' (vous)' : '')) + '</option>'; }).join('')
          + '</select>' + (lockedByProp ? '<div class="bhp-meta" style="margin-top:6px">Défini par le logement choisi.</div>' : ''));
      }
      var props = S.properties.filter(function (p) { return !S.mustChoose || !S.account || S.property || String(p.accountId) === String(S.account); });
      rows += htmlRow('<div class="bhp-lbl">Logement (optionnel)</div>'
        + '<select class="bhp-input bhp-select bhp-select--full" data-f="property"><option value="">Aucun</option>'
        + props.map(function (p) { return '<option value="' + esc(p.id) + '"' + (String(S.property) === String(p.id) ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('')
        + '</select>');
      var owners = S.owners.filter(function (o) { return !accId || String(o.accountId) === String(accId); });
      if (owners.length) {
        rows += htmlRow('<div class="bhp-lbl">Propriétaire (optionnel)</div>'
          + '<select class="bhp-input bhp-select bhp-select--full" data-f="owner"><option value="">' + (S.property ? 'Celui du logement' : 'Aucun') + '</option>'
          + owners.map(function (o) { return '<option value="' + esc(o.id) + '"' + (String(S.owner) === String(o.id) ? ' selected' : '') + '>' + esc(o.name + (o.stripeConnected ? '' : ' — sans Stripe')) + '</option>'; }).join('')
          + '</select>');
      }
      var who = payee();
      rows += htmlRow('<div class="bhpay-payee">' + ic(who && who.ok ? 'checkFill' : 'info') + '<span>'
        + (who ? (who.ok ? 'Paiement versé sur le Stripe de <b>' + esc(who.name) + '</b>.' : 'Pas de Stripe connecté : paiement encaissé sur le <b>compte Boostinghost</b>.') : 'Choisissez le compte qui encaisse le paiement.')
        + '</span></div>');
      h += U.label('Encaissement') + card(rows);

      // Client
      h += U.label('Client (optionnel)') + card(
        htmlRow('<div class="bhp-lbl">E-mail — le lien lui est envoyé</div><input class="bhp-input" data-f="email" type="email" inputmode="email" autocapitalize="off" value="' + esc(S.email) + '" placeholder="client@email.com">')
        + htmlRow('<div class="bhp-lbl">Téléphone</div><input class="bhp-input" data-f="phone" type="tel" inputmode="tel" value="' + esc(S.phone) + '" placeholder="+33 6 00 00 00 00">')
      );

      if (S.formErr) h += U.warn(S.formErr, true);
      h += '<button class="bhp-btn bhp-btn--primary" data-act="create"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? U.SPIN + ' Création…' : 'Créer le lien de paiement') + '</button>';
      return h;
    }

    function resultView() {
      var r = S.result;
      var sent = r.sentEmail ? '<div class="bhp-row">' + U.okLine('Lien envoyé par e-mail.') + '</div>' : '';
      return '<div class="bhpay-done">' + ic('checkFill') + '<div><b>Lien créé</b><span>' + esc(r.summary) + '</span></div></div>'
        + card('<div class="bhp-row"><div class="bhp-lbl">Lien de paiement</div><div class="bhpay-url">' + esc(r.url) + '</div></div>' + sent)
        + '<button class="bhp-btn bhp-btn--primary" data-act="copy">' + ic('copy') + '<span data-copy-lbl>Copier le lien</span></button>'
        + (navigator.share ? '<button class="bhp-btn bhp-btn--mint" data-act="share">' + ic('share') + 'Partager</button>' : '')
        + '<button class="bhp-btn bhp-btn--ghost" data-act="again">Créer un autre lien</button>';
    }

    function readField(el) {
      var f = el.getAttribute('data-f');
      if (!f) return false;
      if (f === 'property') {
        S.property = el.value;
        var p = byId(S.properties, S.property);
        if (p) { S.account = p.accountId; if (S.owner && byId(S.owners, S.owner) && byId(S.owners, S.owner).accountId !== p.accountId) S.owner = ''; }
        return true;
      }
      if (f === 'account') { S.account = el.value; S.owner = ''; return true; }
      if (f === 'owner') { S.owner = el.value; return true; }
      S[f] = el.value; // champs texte : pas de re-rendu (garder le focus)
      return false;
    }

    function create() {
      S.formErr = '';
      var amount = parseFloat(String(S.amount).replace(',', '.'));
      var label = (S.label || '').trim();
      if (S.kind === 'custom' && !label) S.formErr = 'Indiquez l\'intitulé de la prestation.';
      else if (!(amount >= 0.5)) S.formErr = 'Montant invalide (minimum 0,50 €).';
      else if (S.mustChoose && !accountId()) S.formErr = 'Choisissez le compte qui encaisse le paiement.';
      if (S.formErr) { render(); return; }

      var body = { kind: S.kind, amountEuros: amount, reqLabel: label };
      if (S.property) body.propertyId = S.property; else if (accountId()) body.accountUserId = accountId();
      if (S.owner) body.ownerClientId = S.owner;
      if (S.email.trim()) body.email = S.email.trim();
      if (S.phone.trim()) body.phone = S.phone.trim();

      S.busy = true; render();
      U.api('POST', '/api/upsell/manual', body).then(function (d) {
        if (!d || !d.success || !d.url) throw new Error((d && d.error) || 'Création du lien impossible.');
        var kindLbl = S.kind === 'custom' ? label : (KINDS.filter(function (k) { return k[0] === S.kind; })[0][1] + (label ? ' (' + label + ')' : ''));
        var who = payee();
        S.result = {
          url: d.url, sentEmail: !!d.sentEmail,
          summary: kindLbl + ' · ' + U.fmtAmount(amount) + (who && who.ok ? ' · versé à ' + who.name : '')
        };
      }).catch(function (e) {
        S.formErr = e.message || 'Création du lien impossible.';
      }).then(function () { S.busy = false; render(); });
    }

    root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var a = b.getAttribute('data-act');
      if (a === 'back') { location.href = document.body.getAttribute('data-back-href') || '/manage.html'; }
      else if (a === 'retry') load();
      else if (a === 'kind') { S.kind = b.getAttribute('data-v'); S.formErr = ''; render(); }
      else if (a === 'create') create();
      else if (a === 'copy') {
        var url = S.result && S.result.url;
        var done = function () { var l = root.querySelector('[data-copy-lbl]'); if (l) l.textContent = 'Lien copié ✓'; };
        if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, function () { window.prompt('Copiez le lien :', url); });
        else window.prompt('Copiez le lien :', url);
      }
      else if (a === 'share') { if (navigator.share) navigator.share({ url: S.result.url, title: 'Lien de paiement' }).catch(function () {}); }
      else if (a === 'again') { S.result = null; S.label = ''; S.amount = ''; S.email = ''; S.phone = ''; render(); }
    });
    root.addEventListener('change', function (e) { if (readField(e.target)) render(); });
    root.addEventListener('input', function (e) {
      var f = e.target.getAttribute && e.target.getAttribute('data-f');
      if (f && f !== 'property' && f !== 'account' && f !== 'owner') S[f] = e.target.value;
    });

    load();
  };
})();
