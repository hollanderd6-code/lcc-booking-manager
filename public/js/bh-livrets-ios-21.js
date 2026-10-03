/* bh-livrets-ios-21.js — Gestion › Livrets d'accueil, dans le style des écrans iOS
   /livrets.html                  → liste des livrets (aperçu, partage, QR, dupliquer, supprimer, réordonner)
   /livrets.html?id=<uniqueId>    → éditeur d'un livret existant
   /livrets.html?property=<id>    → livret du logement (créé s'il n'existe pas)
   /livrets.html?nouveau=1        → nouveau livret libre
   Routes : /api/welcome-books (welcomeRoutes.js). Dépend de bh-prop-ios-12.js (BHP.ui). */
(function () {
  'use strict';
  var BHP = window.BHP || {}, U = BHP.ui;
  if (!U) { console.error('bh-livrets-ios-21 : charger bh-prop-ios-12.js avant.'); return; }
  var esc = U.esc, ic = U.ic, card = U.card, I = U.I, CHEV = U.CHEV;
  var WB = '/api/welcome-books';
  var BASE = /^https?:/.test(location.origin) ? location.origin : 'https://www.boostinghost.fr';
  var MAX_MB = 9;
  function publicUrl(uid) { return BASE + '/welcome/' + uid; }
  function relDay(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); }

  /* Photos : même compression que l'ancien éditeur (côté >1600 px ou >1,5 Mo → JPEG 0,82). */
  function compress(file) {
    return new Promise(function (resolve) {
      if (!/^image\//.test(file.type) || (file.size < 1.5 * 1048576 && !/heic|heif/i.test(file.type))) return resolve(file);
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var s = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob(function (b) { resolve(b ? new File([b], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file); }, 'image/jpeg', 0.82);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  BHP.initLivrets = function () {
    var root = document.getElementById('bhpApp');
    var qs = new URLSearchParams(location.search);
    if (qs.get('id') || qs.get('property') || qs.get('nouveau')) return editor(root, qs);
    list(root);
  };

  /* ════════════════ Liste ════════════════ */
  function list(root) {
    var S = { state: 'loading', books: [], reorder: false };
    function load() {
      return U.api('GET', WB + '/user/list').then(function (r) { S.books = r.welcomeBooks || []; S.state = 'loaded'; })
        .catch(function (e) { S.state = 'error'; S.err = e.message; }).then(render);
    }
    function render() {
      var n = S.books.length;
      var nav = '<header class="bhp-nav"><div class="bhm-nav__in">' + U.circleBtn('chevL', 'back', 'Gestion') + '<div class="bhm-nav__t"><div class="bhp-nav__kicker" style="text-align:left">'
        + (S.state === 'loaded' ? U.pl(n, 'livret') : '&#160;') + '</div><h1 class="bhm-title">Livrets d\'accueil</h1></div>'
        + (n > 1 ? '<button class="bhp-glassbtn" data-act="reorder">' + (S.reorder ? 'OK' : 'Ordre') + '</button>' : '') + U.circleBtn('plus', 'new', 'Nouveau livret') + '</div></header>';
      var h;
      if (S.state === 'loading') h = '<div class="bhp-state bhp-center"><span class="bhp-spin bhp-spin--lg"></span></div>';
      else if (S.state === 'error') h = '<div class="bhm-empty">' + ic('warnFill') + '<span>' + esc(S.err) + '</span><button class="bhp-glassbtn" data-act="retry">Réessayer</button></div>';
      else if (!n) h = '<div class="bhm-empty">' + ic('book') + '<span><b style="color:#14201B">Aucun livret pour le moment</b><br>Accès, wifi, règles, adresses du quartier : tout ce que vos voyageurs doivent savoir, dans un lien à partager.</span><button class="bhm-call" data-act="new">' + ic('plus') + 'Créer un livret</button></div>';
      else h = (S.reorder ? '<p class="bhp-note">Utilisez les flèches pour changer l\'ordre des livrets.</p>' : '') + S.books.map(function (b, i) {
        var draft = b.isDraft;
        return '<div class="bhp-card bhl-book">'
          + '<div class="bhl-book__top" data-act="' + (S.reorder ? '' : 'edit') + '" data-i="' + i + '">'
          + '<div class="bhl-cover">' + (b.coverPhoto ? '<img src="' + esc(b.coverPhoto) + '" alt="" loading="lazy">' : I.book) + '</div>'
          + '<div class="bhl-book__t"><div class="bhm-ac__n">' + esc(b.propertyName || 'Livret sans nom') + '</div>'
          + '<div class="bhp-meta">' + (b.updatedAt ? 'Modifié le ' + esc(relDay(b.updatedAt)) : '') + '</div>'
          + '<div>' + U.pill(draft ? 'Brouillon' : 'Publié', draft ? 'or' : 'vert') + '</div></div>'
          + (S.reorder ? '<div class="bhl-move"><button class="bhp-circle" data-act="up" data-i="' + i + '"' + (i ? '' : ' disabled') + ' aria-label="Monter">' + I.chevR + '</button><button class="bhp-circle" data-act="down" data-i="' + i + '"' + (i < n - 1 ? '' : ' disabled') + ' aria-label="Descendre">' + I.chevR + '</button></div>' : CHEV)
          + '</div>'
          + (S.reorder ? '' : '<div class="bhp-livret__acts bhl-acts"><button class="bhp-link" data-act="preview" data-i="' + i + '">' + ic('compass') + 'Aperçu</button>'
            + '<button class="bhp-link" data-act="share" data-i="' + i + '">' + ic('share') + 'Partager</button>'
            + '<button class="bhp-link" data-act="more" data-i="' + i + '">' + ic('ellipsis') + 'Plus</button></div>')
          + '</div>';
      }).join('');
      root.innerHTML = nav + '<div class="bhp-stack bhm-stack">' + h + '</div>';
    }
    function share(b) {
      var u = publicUrl(b.uniqueId);
      var sh = U.openSheet({ head: { kicker: 'Partager', title: b.propertyName || 'Livret', right: '<button class="bhp-textbtn" data-act="sheet-close">Fermer</button>' } });
      sh.body.innerHTML = '<div class="bhp-stack"><div class="bhp-card bhl-qr"><div id="bhlQr"></div><span class="bhp-meta">À imprimer et poser dans le logement</span></div>'
        + card('<div class="bhp-row"><div class="bhp-mono bhl-url">' + esc(u) + '</div></div>')
        + '<button class="bhp-btn bhp-btn--primary" data-act="copy">' + ic('copy') + 'Copier le lien</button>'
        + (navigator.share ? '<button class="bhp-btn bhp-btn--ghost" data-act="native">' + ic('share') + 'Partager…</button>' : '')
        + '<button class="bhp-btn bhp-btn--ghost" data-act="qr-dl">' + ic('photo') + 'Télécharger le QR code</button></div>';
      if (window.QRCode) { try { new window.QRCode(document.getElementById('bhlQr'), { text: u, width: 180, height: 180, colorDark: '#14201B', colorLight: '#ffffff' }); } catch (e) {} }
      sh.body.addEventListener('click', function (e) {
        var el = e.target.closest('[data-act]'); if (!el) return;
        if (el.dataset.act === 'copy') {
          (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(function () { el.innerHTML = ic('checkFill') + 'Lien copié'; }).catch(function () { U.alertMsg('Lien du livret', u); });
        }
        if (el.dataset.act === 'native') navigator.share({ title: 'Livret d\'accueil — ' + (b.propertyName || ''), url: u }).catch(function () {});
        if (el.dataset.act === 'qr-dl') {
          var box = document.getElementById('bhlQr'), cv = box && box.querySelector('canvas'), im = box && box.querySelector('img');
          var src = cv ? cv.toDataURL('image/png') : (im && im.src);
          if (!src) { U.alertMsg('QR code indisponible', 'Copiez le lien à la place.'); return; }
          var a = document.createElement('a'); a.href = src; a.download = 'qr-livret-' + b.uniqueId + '.png'; document.body.appendChild(a); a.click(); a.remove();
        }
      });
    }
    function more(b, anchor) {
      U.openMenu(anchor, [
        { label: 'Modifier', icon: 'pencil', onClick: function () { location.href = '/livrets.html?id=' + encodeURIComponent(b.uniqueId); } },
        { label: 'Dupliquer', icon: 'copy', onClick: function () { dup(b); } },
        '-',
        { label: 'Supprimer', icon: 'trash', danger: true, onClick: function () { del(b); } }
      ]);
    }
    function dup(b) {
      var sh = U.openSheet({ head: { title: 'Dupliquer le livret', left: '<button class="bhp-textbtn bhp-textbtn--vert" data-act="sheet-close">Annuler</button>', right: '<button class="bhp-textbtn bhp-textbtn--vert" style="font-weight:600" data-act="go">Dupliquer</button>' } });
      sh.body.innerHTML = '<div class="bhp-stack"><p class="bhp-note" style="font-size:14px">Tout le contenu et les photos sont copiés. Donnez un nom à la copie.</p>'
        + card('<div class="bhp-row"><input class="bhp-input" data-name value="' + esc((b.propertyName || 'Livret') + ' (copie)') + '"></div>') + '</div>';
      sh.el.addEventListener('click', function (e) {
        if (!e.target.closest('[data-act="go"]')) return;
        var name = sh.body.querySelector('[data-name]').value.trim(); if (!name) return;
        sh.locked = true;
        U.api('POST', WB + '/duplicate/' + encodeURIComponent(b.uniqueId), { newName: name }).then(function () { sh.locked = false; sh.close(); load(); })
          .catch(function (er) { sh.locked = false; U.alertMsg('Erreur', er.message); });
      });
    }
    function del(b) {
      U.confirmMsg('Supprimer ce livret ?', '« ' + (b.propertyName || 'Livret') + ' » et son lien public ne seront plus accessibles. Cette action est définitive.', 'Supprimer').then(function (ok) {
        if (!ok) return;
        U.api('DELETE', WB + '/by-unique/' + encodeURIComponent(b.uniqueId)).then(load).catch(function (e) { U.alertMsg('Erreur', e.message); });
      });
    }
    function move(i, d) {
      var j = i + d; if (j < 0 || j >= S.books.length) return;
      var t = S.books[i]; S.books[i] = S.books[j]; S.books[j] = t; render();
      U.api('POST', WB + '/reorder', { order: S.books.map(function (b) { return b.uniqueId; }) }).catch(function (e) { U.alertMsg('Ordre non enregistré', e.message); });
    }
    root.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]'); if (!el || el.disabled || !el.dataset.act) return;
      var a = el.dataset.act, b = S.books[+el.dataset.i];
      if (a === 'back') { location.href = '/manage.html'; return; }
      if (a === 'new') { location.href = '/livrets.html?nouveau=1'; return; }
      if (a === 'retry') { S.state = 'loading'; render(); load(); return; }
      if (a === 'reorder') { S.reorder = !S.reorder; render(); return; }
      if (a === 'up') return move(+el.dataset.i, -1);
      if (a === 'down') return move(+el.dataset.i, 1);
      if (a === 'edit') { location.href = '/livrets.html?id=' + encodeURIComponent(b.uniqueId); return; }
      if (a === 'preview') { window.open(publicUrl(b.uniqueId), '_blank', 'noopener'); return; }
      if (a === 'share') return share(b);
      if (a === 'more') return more(b, el);
    });
    render(); load();
  }

  /* ════════════════ Éditeur ════════════════ */
  var TEXT = ['propertyName', 'welcomeDescription', 'contactPhone', 'address', 'postalCode', 'city', 'keyboxCode', 'accessInstructions', 'parkingInfo',
    'wifiSSID', 'wifiPassword', 'checkinTime', 'checkoutTime', 'checkoutInstructions', 'equipmentList', 'importantRules', 'transportInfo', 'shopsList',
    'extraNotesAccess', 'extraNotesLogement', 'extraNotesPractical', 'extraNotesAround'];
  var PHOTO_FIELDS = { cover: 'coverPhoto', entrance: 'entrancePhotos', parking: 'parkingPhotos', transportPhotos: 'transportPhotos',
    extraPhotosAccess: 'extraPhotosAccess', extraPhotosLogement: 'extraPhotosLogement', extraPhotosPractical: 'extraPhotosPractical', extraPhotosAround: 'extraPhotosAround' };
  var SECTIONS = [['general', 'Général', 'house'], ['acces', 'Accès', 'key'], ['logement', 'Logement', 'bed'], ['pratique', 'Pratique', 'wifi'], ['alentours', 'Alentours', 'map']];

  function editor(root, qs) {
    var S = { state: 'loading', uid: qs.get('id') || null, propertyId: qs.get('property') || null, sec: 'general', d: null, photos: {}, newFiles: {}, dirty: false, saving: false };
    function blank() { var d = {}; TEXT.forEach(function (k) { d[k] = ''; }); d.rooms = []; d.restaurants = []; d.places = []; return d; }
    function fromData(data) {
      var d = blank(); data = data || {};
      TEXT.forEach(function (k) { if (data[k] != null) d[k] = String(data[k]); });
      ['rooms', 'restaurants', 'places'].forEach(function (k) {
        var v = data[k]; if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = []; } }
        d[k] = Array.isArray(v) ? v.map(function (x) { return Object.assign({}, x); }) : [];
      });
      S.photos = data.photos || {}; S.isDraft = data.isDraft === true;
      return d;
    }
    function load() {
      var p;
      if (S.uid) p = U.api('GET', WB + '/public/' + encodeURIComponent(S.uid)).then(function (r) { S.d = fromData(r.book); });
      else if (S.propertyId) p = U.api('GET', WB + '/by-property/' + encodeURIComponent(S.propertyId)).then(function (r) {
        if (r.exists) { S.uid = r.uniqueId; S.d = fromData(r.data); return; }
        S.d = blank(); S.isNew = true;
        return U.api('GET', '/api/properties/' + encodeURIComponent(S.propertyId)).then(function (pr) {
          var x = pr.property || pr;
          S.d.propertyName = x.internal_name || x.internalName || x.name || '';
          S.d.address = x.address || ''; S.d.city = x.city || ''; S.d.postalCode = x.postal_code || x.postalCode || '';
          S.d.wifiSSID = x.wifi_name || x.wifiName || ''; S.d.wifiPassword = x.wifi_password || x.wifiPassword || '';
          S.d.checkinTime = x.arrival_time || x.arrivalTime || ''; S.d.checkoutTime = x.departure_time || x.departureTime || '';
        }).catch(function () {});
      });
      else { S.d = blank(); S.isNew = true; p = Promise.resolve(); }
      return p.then(function () { S.state = 'loaded'; }).catch(function (e) { S.state = 'error'; S.err = e.status === 404 ? 'Livret introuvable.' : e.message; }).then(render);
    }
    function back() {
      if (!S.dirty) { location.href = '/livrets.html'; return; }
      U.dialog({ title: 'Quitter sans enregistrer ?', message: 'Vos modifications seront perdues.', actions: [{ label: 'Continuer', role: 'cancel', value: false }, { label: 'Quitter', role: 'destructive', value: true }] })
        .then(function (ok) { if (ok) location.href = '/livrets.html'; });
    }

    function field(k, label, o) {
      o = o || {};
      var v = S.d[k] || '';
      if (o.area) return '<div class="bhp-row bhl-f"><label class="bhl-f__l">' + esc(label) + '</label><textarea class="bhp-input bhp-ta" data-k="' + k + '" rows="' + (o.rows || 3) + '" placeholder="' + esc(o.ph || '') + '">' + esc(v) + '</textarea></div>';
      return '<div class="bhp-row bhl-f"><label class="bhl-f__l">' + esc(label) + (o.req ? ' <span class="bhp-req">*</span>' : '') + '</label><input class="bhp-input' + (o.mono ? ' bhp-mono' : '') + '" data-k="' + k + '" value="' + esc(v) + '" placeholder="' + esc(o.ph || '') + '"' + (o.type ? ' type="' + o.type + '"' : '') + '></div>';
    }
    function photoBox(key, label, multi) {
      var cur = S.photos[key], urls = (Array.isArray(cur) ? cur : cur ? [cur] : []).map(function (x) { return typeof x === 'string' ? x : (x && (x.url || x.secure_url)); }).filter(Boolean);
      var nf = S.newFiles[key] || [];
      var thumbs = nf.length ? nf.map(function (f) { return '<span class="bhm-ph bhl-new"><img src="' + esc(f._url) + '" alt=""></span>'; }).join('') : urls.map(function (u) { return '<span class="bhm-ph"><img src="' + esc(u) + '" alt="" loading="lazy"></span>'; }).join('');
      return '<div class="bhp-row bhl-f"><div class="bhl-f__l bhl-phl"><span>' + esc(label) + '</span>'
        + (nf.length ? '<button class="bhp-textbtn" style="font-size:13px" data-act="ph-reset" data-key="' + key + '">Annuler</button>' : '')
        + '<label class="bhp-glassbtn bhl-pick">' + ic('photo') + (urls.length || nf.length ? 'Remplacer' : 'Ajouter') + '<input type="file" accept="image/*"' + (multi ? ' multiple' : '') + ' data-photo="' + key + '" hidden></label></div>'
        + (thumbs ? '<div class="bhm-photos bhm-photos--s">' + thumbs + '</div>' : '<div class="bhp-meta" style="font-size:12.5px">Aucune photo</div>')
        + (nf.length && urls.length ? '<div class="bhp-meta" style="font-size:12px">Les photos actuelles seront remplacées à l\'enregistrement.</div>' : '') + '</div>';
    }
    function listBlock(kind, label, fields, addLabel) {
      var arr = S.d[kind];
      var h = arr.map(function (it, i) {
        return '<div class="bhp-card bhl-item"><div class="bhl-item__h"><span class="bhp-label" style="margin:0">' + esc(label) + ' ' + (i + 1) + '</span><button class="bhp-textbtn" style="font-size:13.5px;color:#A8452A" data-act="rm" data-kind="' + kind + '" data-i="' + i + '">Retirer</button></div>'
          + fields.map(function (f) {
            var v = it[f[0]] || '';
            return f[2] === 'area' ? '<div class="bhp-row bhl-f"><label class="bhl-f__l">' + esc(f[1]) + '</label><textarea class="bhp-input bhp-ta" rows="2" data-list="' + kind + '" data-i="' + i + '" data-f="' + f[0] + '" placeholder="' + esc(f[3] || '') + '">' + esc(v) + '</textarea></div>'
              : '<div class="bhp-row bhl-f"><label class="bhl-f__l">' + esc(f[1]) + '</label><input class="bhp-input" data-list="' + kind + '" data-i="' + i + '" data-f="' + f[0] + '" value="' + esc(v) + '" placeholder="' + esc(f[3] || '') + '"></div>';
          }).join('') + '</div>';
      }).join('');
      return h + '<button class="bhp-btn bhp-btn--ghost" data-act="add" data-kind="' + kind + '">' + ic('plus') + esc(addLabel) + '</button>';
    }
    function section() {
      var s = S.sec;
      if (s === 'general') return U.label('Présentation') + card(field('propertyName', 'Nom du logement', { req: true, ph: 'Ex : Studio Saint-Germain' }) + field('welcomeDescription', 'Mot d\'accueil', { area: true, rows: 4, ph: 'Nous sommes ravis de vous accueillir…' }) + field('contactPhone', 'Téléphone de contact', { req: true, type: 'tel', ph: '06 12 34 56 78' }))
        + U.label('Photo de couverture') + card(photoBox('cover', 'Couverture', false));
      if (s === 'acces') return U.label('Adresse') + card(field('address', 'Adresse', { req: true, ph: 'Numéro et rue' }) + '<div class="bhl-2">' + field('postalCode', 'Code postal', { req: true, ph: '75001' }) + field('city', 'Ville', { req: true, ph: 'Paris' }) + '</div>')
        + U.label('Arrivée') + card(field('keyboxCode', 'Code de la boîte à clés', { mono: true, ph: 'Ex : 8670' }) + field('accessInstructions', 'Instructions d\'accès', { area: true, rows: 4, ph: 'Poussez le portail, la boîte à clés est à gauche…' }) + photoBox('entrance', 'Photos de l\'entrée', true))
        + U.label('Stationnement') + card(field('parkingInfo', 'Parking', { area: true, ph: 'Parking gratuit au 43 rue du Marché…' }) + photoBox('parking', 'Photos du parking', true))
        + U.label('En plus') + card(field('extraNotesAccess', 'Notes', { area: true, ph: 'Toute information utile…' }) + photoBox('extraPhotosAccess', 'Photos', true));
      if (s === 'logement') return U.label('Pièces') + listBlock('rooms', 'Pièce', [['name', 'Nom de la pièce', 'in', 'Ex : Chambre 1'], ['description', 'Description', 'area', 'Lit, rangements…']], 'Ajouter une pièce')
        + U.label('En plus') + card(field('extraNotesLogement', 'Notes', { area: true, ph: 'Toute information utile…' }) + photoBox('extraPhotosLogement', 'Photos', true));
      if (s === 'pratique') return U.label('Wifi') + card(field('wifiSSID', 'Nom du réseau', { ph: 'Nom du réseau' }) + field('wifiPassword', 'Mot de passe', { mono: true, ph: 'Mot de passe' }))
        + U.label('Horaires') + card('<div class="bhl-2">' + field('checkinTime', 'Arrivée', { ph: '15h' }) + field('checkoutTime', 'Départ', { ph: '11h' }) + '</div>' + field('checkoutInstructions', 'Consignes de départ', { area: true, rows: 4, ph: '- Éteindre les lumières\n- Laver la vaisselle' }))
        + U.label('Le logement') + card(field('equipmentList', 'Équipements', { area: true, rows: 4, ph: 'Machine à café\nMicro-ondes\nLave-linge…' }) + field('importantRules', 'Règles importantes', { area: true, rows: 4, ph: 'Non fumeur, pas de fête…' }))
        + U.label('Transports') + card(field('transportInfo', 'Comment venir', { area: true, ph: 'Bus 15 à une minute à pied…' }) + photoBox('transportPhotos', 'Photos', true))
        + U.label('En plus') + card(field('extraNotesPractical', 'Notes', { area: true, ph: 'Toute information utile…' }) + photoBox('extraPhotosPractical', 'Photos', true));
      return U.label('Commerces') + card(field('shopsList', 'Commerces à proximité', { area: true, rows: 4, ph: 'Franprix — 6 rue de Pontoise\nBoulangerie — place du marché' }))
        + U.label('Restaurants') + listBlock('restaurants', 'Restaurant', [['name', 'Nom', 'in', 'Nom du restaurant'], ['address', 'Adresse', 'in', 'Adresse'], ['phone', 'Téléphone', 'in', '01 23 45 67 89'], ['description', 'Pourquoi vous le recommandez', 'area', '']], 'Ajouter un restaurant')
        + U.label('À visiter') + listBlock('places', 'Lieu', [['name', 'Nom', 'in', 'Lieu à visiter'], ['description', 'Infos utiles', 'area', '']], 'Ajouter un lieu')
        + U.label('En plus') + card(field('extraNotesAround', 'Notes', { area: true, ph: 'Toute information utile…' }) + photoBox('extraPhotosAround', 'Photos', true));
    }
    function render() {
      var title = S.state === 'loaded' ? (S.d.propertyName || (S.isNew ? 'Nouveau livret' : 'Livret')) : 'Livret';
      var kick = S.state !== 'loaded' ? '&#160;' : S.isNew ? 'Nouveau livret' : (S.isDraft ? 'Brouillon' : 'Publié');
      var seg = '<div class="bhm-seg bhb-seg">' + SECTIONS.map(function (x) { return '<button class="bhm-seg__b' + (S.sec === x[0] ? ' is-on' : '') + '" data-act="sec" data-v="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>';
      var acts = S.state === 'loaded' ? ((S.uid ? U.circleBtn('compass', 'preview', 'Aperçu') : '') + '<button class="bhm-call" data-act="save"' + (S.saving ? ' disabled' : '') + '>' + (S.saving ? '<span class="bhp-spin bhp-spin--w"></span>' : ic('check')) + 'Enregistrer</button>') : '';
      var nav = '<header class="bhp-nav"><div class="bhm-nav__in">' + U.circleBtn('chevL', 'back', 'Livrets') + '<div class="bhm-nav__t"><div class="bhp-nav__kicker" style="text-align:left">' + kick + '</div><h1 class="bhm-title bhl-title">' + esc(title) + '</h1></div>' + acts + '</div>'
        + (S.state === 'loaded' ? '<div class="bhm-nav__in2">' + seg + '</div>' : '') + '</header>';
      var h;
      if (S.state === 'loading') h = '<div class="bhp-state bhp-center"><span class="bhp-spin bhp-spin--lg"></span></div>';
      else if (S.state === 'error') h = '<div class="bhm-empty">' + ic('warnFill') + '<span>' + esc(S.err) + '</span><button class="bhp-glassbtn" data-act="list">Retour aux livrets</button></div>';
      else {
        var i = SECTIONS.map(function (x) { return x[0]; }).indexOf(S.sec);
        h = section() + '<div class="bhl-steps">' + (i > 0 ? '<button class="bhp-glassbtn" data-act="sec" data-v="' + SECTIONS[i - 1][0] + '">← ' + SECTIONS[i - 1][1] + '</button>' : '<span></span>')
          + (i < SECTIONS.length - 1 ? '<button class="bhp-glassbtn" data-act="sec" data-v="' + SECTIONS[i + 1][0] + '">' + SECTIONS[i + 1][1] + ' →</button>' : '<button class="bhm-call" data-act="save">' + ic('check') + 'Enregistrer le livret</button>') + '</div>';
      }
      root.innerHTML = nav + '<div class="bhp-stack bhm-stack">' + h + '</div>';
    }
    function missing() {
      var req = [['propertyName', 'Nom du logement', 'general'], ['contactPhone', 'Téléphone de contact', 'general'], ['address', 'Adresse', 'acces'], ['postalCode', 'Code postal', 'acces'], ['city', 'Ville', 'acces']];
      return req.filter(function (r) { return !String(S.d[r[0]] || '').trim(); });
    }
    function save() {
      var miss = missing();
      var asDraft = miss.length > 0;
      var go = asDraft ? U.dialog({ title: 'Informations manquantes', message: miss.map(function (m) { return m[1]; }).join(', ') + '. Le livret sera enregistré comme brouillon.', actions: [{ label: 'Compléter', role: 'cancel', value: false }, { label: 'Enregistrer', value: true }] }) : Promise.resolve(true);
      go.then(function (ok) {
        if (!ok) { if (asDraft) { S.sec = miss[0][2]; render(); var el = root.querySelector('[data-k="' + miss[0][0] + '"]'); if (el) el.focus(); } return; }
        var fd = new FormData();
        TEXT.forEach(function (k) { fd.append(k, S.d[k] || ''); });
        fd.append('rooms', JSON.stringify(S.d.rooms.map(function (r) { return { name: r.name || '', description: r.description || '' }; })));
        fd.append('restaurants', JSON.stringify(S.d.restaurants.map(function (r) { return { name: r.name || '', phone: r.phone || '', address: r.address || '', description: r.description || '' }; })));
        fd.append('places', JSON.stringify(S.d.places.map(function (r) { return { name: r.name || '', description: r.description || '' }; })));
        fd.append('isDraft', asDraft ? 'true' : 'false');
        fd.append('lastSection', '4');
        if (S.uid) fd.append('uniqueId', S.uid);
        if (S.propertyId) fd.append('propertyId', S.propertyId);
        S.saving = true; render();
        var keys = Object.keys(S.newFiles);
        Promise.all(keys.map(function (k) { return Promise.all(S.newFiles[k].map(compress)).then(function (fs) { fs.forEach(function (f) { fd.append(PHOTO_FIELDS[k], f, f.name); }); }); }))
          .then(function () { return U.api('POST', WB + '/create', fd); })
          .then(function (r) {
            S.saving = false; S.dirty = false; S.newFiles = {}; S.isNew = false; S.isDraft = asDraft;
            if (r.uniqueId && r.uniqueId !== S.uid) { S.uid = r.uniqueId; history.replaceState(null, '', '/livrets.html?id=' + encodeURIComponent(S.uid)); }
            return U.api('GET', WB + '/public/' + encodeURIComponent(S.uid)).then(function (b) { S.photos = (b.book && b.book.photos) || S.photos; }).catch(function () {}).then(function () {
              render();
              U.dialog({ title: asDraft ? 'Brouillon enregistré' : 'Livret enregistré', message: asDraft ? 'Complétez les informations manquantes pour le publier.' : 'Vos voyageurs voient la nouvelle version dès maintenant.' + (r.urlConflict ? ' Le logement pointe déjà vers un autre lien de livret : vérifiez-le dans la fiche du logement.' : ''),
                actions: [{ label: 'OK', role: 'cancel', value: 0 }, { label: 'Voir le livret', value: 1 }] }).then(function (v) { if (v === 1) window.open(publicUrl(S.uid), '_blank', 'noopener'); });
            });
          })
          .catch(function (e) { S.saving = false; render(); U.alertMsg('Enregistrement impossible', e.message); });
      });
    }

    root.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
      var a = el.dataset.act;
      if (a === 'back') return back();
      if (a === 'list') { location.href = '/livrets.html'; return; }
      if (a === 'sec') { S.sec = el.dataset.v; window.scrollTo(0, 0); render(); return; }
      if (a === 'save') return save();
      if (a === 'preview') { window.open(publicUrl(S.uid), '_blank', 'noopener'); return; }
      if (a === 'add') { S.d[el.dataset.kind].push({}); S.dirty = true; var y = window.scrollY; render(); window.scrollTo(0, y); var ins = root.querySelectorAll('[data-list="' + el.dataset.kind + '"][data-f="name"]'); if (ins.length) ins[ins.length - 1].focus(); return; }
      if (a === 'rm') { S.d[el.dataset.kind].splice(+el.dataset.i, 1); S.dirty = true; var y2 = window.scrollY; render(); window.scrollTo(0, y2); return; }
      if (a === 'ph-reset') { delete S.newFiles[el.dataset.key]; var y3 = window.scrollY; render(); window.scrollTo(0, y3); return; }
    });
    root.addEventListener('input', function (e) {
      var t = e.target;
      if (t.dataset.k) { S.d[t.dataset.k] = t.value; S.dirty = true; if (t.dataset.k === 'propertyName') { var ti = root.querySelector('.bhl-title'); if (ti) ti.textContent = t.value || 'Nouveau livret'; } }
      if (t.dataset.list) { S.d[t.dataset.list][+t.dataset.i][t.dataset.f] = t.value; S.dirty = true; }
    });
    root.addEventListener('change', function (e) {
      var t = e.target; if (!t.dataset.photo) return;
      var files = Array.prototype.slice.call(t.files || []);
      var big = files.filter(function (f) { return f.size > MAX_MB * 1048576 && !/^image\//.test(f.type); });
      if (big.length) { U.alertMsg('Fichier trop lourd', 'Chaque photo doit faire moins de ' + MAX_MB + ' Mo.'); return; }
      if (!files.length) return;
      files.forEach(function (f) { f._url = URL.createObjectURL(f); });
      S.newFiles[t.dataset.photo] = files; S.dirty = true;
      var y = window.scrollY; render(); window.scrollTo(0, y);
    });
    window.addEventListener('beforeunload', function (e) { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });
    render(); load();
  }
})();
