/* bh-mandat-ios-18.js — Création d'un mandat de gestion (MandatCreationView, 5 étapes)
   /mandat.html               → choix du propriétaire
   /mandat.html?client=ID     → assistant
   Dépend de bh-prop-ios-12.js (BHP.ui) et bh-docs-ios-17.js (BHP.signaturePad). */
(function () {
  'use strict';
  var BHP = window.BHP || {}, U = BHP.ui;
  if (!U) { console.error('bh-mandat-ios-18 : charger bh-prop-ios-12.js avant.'); return; }
  var esc = U.esc, pick = U.pick, I = U.I, ic = U.ic, card = U.card, htmlRow = U.htmlRow, NB = '\u202f';
  I.chevD = I.chevD || '<svg class="bhp-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

  var MISSIONS = [
    ['Annonces & visibilité', ['Prise de photos / vidéos', 'Rédaction & diffusion des annonces', 'Optimisation du calendrier & tarifs', 'Gestion des avis & e-réputation']],
    ['Réservations', ['Traitement des demandes & confirmations', 'Messages pré-arrivée & consignes', 'Coordination channel manager / PMS', 'Collecte des informations voyageurs']],
    ['Accueil & départ', ['Check-in physique', 'Check-in autonome', 'Check-out physique', 'État des lieux entrée / sortie']],
    ['Ménage & linge', ['Ménage de départ', 'Fourniture & blanchisserie du linge', 'Réassort produits d\'accueil', 'Contrôle qualité post-ménage']],
    ['Assistance voyageurs', ['Support téléphonique & messages', 'Gestion des incidents mineurs', 'Traitement des réclamations', 'Coordination artisans / prestataires']],
    ['Maintenance & intendance', ['Visites de contrôle', 'Petite maintenance', 'Interventions urgentes', 'Coordination travaux (sur devis validé)']],
    ['Gestion financière & administrative', ['Perception des loyers pour le compte du propriétaire', 'Perception du dépôt de garantie', 'Reversements périodiques & relevés', 'Encaissement taxe de séjour', 'Fourniture d\'un livret d\'accueil', 'Rédaction du contrat de location voyageurs']]
  ];
  var UNITS = { par_prestation: 'par prestation', par_heure: 'par heure', par_nuit: 'par nuit', par_m2: 'par m²', par_personne: 'par personne', par_km: 'par km' };
  var EXTRAS = [['Ménage', ['par_prestation', 'par_heure', 'par_nuit', 'par_m2']], ['Linge', ['par_prestation', 'par_nuit', 'par_personne']], ['Check-in tardif', ['par_prestation', 'par_heure']],
    ['Maintenance', ['par_prestation', 'par_heure']], ['Déplacement exceptionnel', ['par_prestation', 'par_km']], ['Shooting photo', ['par_prestation']],
    ['Urgence WE / jour férié', ['par_prestation', 'par_heure']], ['Gestion de sinistre', ['par_prestation', 'par_heure']]];
  var OPT = {
    propType: [['', 'Choisir…'], ['appartement', 'Appartement'], ['maison', 'Maison'], ['studio', 'Studio'], ['villa', 'Villa'], ['chambre', 'Chambre'], ['gite', 'Gîte / Chalet'], ['autre', 'Autre']],
    animals: [['non', 'Non admis'], ['oui', 'Admis'], ['conditions', 'Sous conditions']],
    smoking: [['non', 'Interdit'], ['exterieur', 'Extérieur seulement'], ['oui', 'Autorisé']],
    parties: [['non', 'Interdits'], ['conditions', 'Sous conditions'], ['oui', 'Autorisés']],
    commissionBase: [['ht', 'Sur revenus HT'], ['ttc', 'Sur revenus TTC']],
    tva: [['franchise', 'Auto-entrepreneur, sans TVA'], ['ht', 'HT — TVA en sus'], ['ttc', 'TTC toutes taxes comprises']],
    tarifPreavis: [['30', '30 jours'], ['60', '60 jours'], ['90', '90 jours']],
    reversement: [['par_resa', 'À chaque réservation'], ['hebdo', 'Hebdomadaire'], ['mensuel', 'Mensuel'], ['encaissement_direct', 'Encaissement direct par le propriétaire']],
    dureeType: [['indeterminee', 'Indéterminée'], ['determinee', 'Déterminée']],
    dureeMois: [['', 'Choisir…'], ['3', '3 mois'], ['6', '6 mois'], ['12', '12 mois'], ['24', '24 mois']],
    renouvellement: [['tacite', 'Tacite reconduction'], ['expres', 'Renouvellement exprès']],
    preavis: [['0', 'Aucun préavis'], ['15', '15 jours'], ['30', '30 jours'], ['60', '60 jours'], ['90', '90 jours']],
    exclusivite: [['non', 'Sans exclusivité'], ['totale', 'Exclusivité totale'], ['partielle', 'Exclusivité partielle, sur les plateformes']],
    respPlafond: [['oui', 'Oui — limitée aux honoraires perçus'], ['non', 'Non — responsabilité de droit commun']],
    juridiction: [['domicile_defendeur', 'Domicile du défendeur'], ['lieu_bien', 'Lieu du bien'], ['commerce', 'Tribunal de commerce, si 2 sociétés']],
    confidentialite: [['2', '2 ans'], ['5', '5 ans']]
  };
  var REMU = [['commission', '% sur revenus'], ['forfait_mensuel', 'Forfait mensuel'], ['forfait_resa', 'Par réservation'], ['mixte', 'Mixte'], ['carte', 'À la carte']];
  var PREFILL_KEYS = ['remuType', 'commissionRate', 'commissionBase', 'forfaitMensuel', 'forfaitResa', 'mixteRate', 'mixteForfait', 'tva', 'tarifPreavis', 'reversement',
    'dureeType', 'dateDebut', 'dureeMois', 'renouvellement', 'preavis', 'exclusivite', 'respPlafond', 'juridiction', 'confidentialite'];
  function defaults() {
    return { companyName: '', companyEmail: '', companyPhone: '', companySiret: '', companyRep: '', companyAddress: '', companyLogoUrl: '', companyLegal: '', companyFreeTitle: '', companyFreeValue: '',
      ownerFirstName: '', ownerLastName: '', ownerEmail: '', ownerAddress: '', ownerPhone: '', ownerDOB: '', ownerSiren: '',
      propAddress: '', propType: '', propCapacity: '', minStay: '', maxStay: '', animals: 'non', smoking: 'non', parties: 'non', checkinTime: '15:00', checkoutTime: '11:00',
      missions: [], customMissions: [], urgenceLimit: '', extras: {}, customExtras: [],
      remuType: '', commissionRate: '', commissionBase: 'ht', forfaitMensuel: '', forfaitResa: '', mixteRate: '', mixteForfait: '', tva: 'franchise', tarifPreavis: '60', reversement: 'mensuel',
      dureeType: 'indeterminee', dateDebut: '', dureeMois: '', renouvellement: 'tacite', preavis: '30', exclusivite: 'non', respPlafond: 'oui', juridiction: 'lieu_bien', confidentialite: '5', clausesPersonnalisees: [] };
  }
  function lab(list, v) { var o = list.filter(function (x) { return x[0] === v; })[0]; return o ? o[1] : v; }
  function normClient(c) {
    var id = String(pick(c, 'id', '_id') || '');
    return { id: id, firstName: pick(c, 'firstName', 'first_name') || '', lastName: pick(c, 'lastName', 'last_name') || '', companyName: pick(c, 'companyName', 'company_name') || '',
      email: c.email || '', phone: c.phone || '', address: c.address || '', postalCode: pick(c, 'postalCode', 'postal_code') || '', city: c.city || '',
      isAgency: U.bool(pick(c, 'isAgencyClient', 'is_agency_client')) === true || id.indexOf('agency_client_') === 0 };
  }
  function cName(c) { return c.companyName || [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Client sans nom'; }
  function initials(c) { return c.companyName ? c.companyName.charAt(0).toUpperCase() : ((c.firstName.charAt(0) + c.lastName.charAt(0)).toUpperCase() || '?'); }

  BHP.initMandat = function () {
    var root = document.getElementById('bhpApp');
    var clientId = new URLSearchParams(location.search).get('client');
    var S = { phase: clientId ? 'loading' : 'pick', clients: null, client: null, d: defaults(), step: 1, prefill: false, coOpen: false, err: null, sending: false };

    /* ── Choix du propriétaire ── */
    function renderPick() {
      var h;
      if (!S.clients) h = '<div class="bhp-state bhp-center"><span class="bhp-spin bhp-spin--lg"></span></div>';
      else {
        var list = S.clients.filter(function (c) { return !c.isAgency; });
        h = !list.length ? '<p class="bhp-state">Aucun client disponible.</p>' : card(list.map(function (c) {
          return '<a class="bhp-row bho-cl" href="?client=' + encodeURIComponent(c.id) + '" style="text-decoration:none;color:inherit"><span class="bho-av" style="width:42px;height:42px;font-size:15px">' + esc(initials(c)) + '</span><div class="bho-cl__t"><div class="bho-cl__n">' + esc(cName(c)) + '</div>'
            + (c.email ? '<div class="bhp-meta" style="font-size:12.5px">' + esc(c.email) + '</div>' : '') + '</div>' + U.CHEV + '</a>';
        }).join(''));
      }
      root.innerHTML = '<header class="bhp-nav"><div class="bhm-nav__in">' + U.circleBtn('chevL', 'back', 'Contrats') + '<div class="bhm-nav__t"><div class="bhp-nav__kicker" style="text-align:left">Nouveau mandat</div><h1 class="bhm-title">Choisir un propriétaire</h1></div></div></header><div class="bhp-stack">' + h + '</div>';
    }

    /* ── Chargement ── */
    function load() {
      Promise.all([U.api('GET', '/api/user/profile'), U.api('GET', '/api/owner-clients/' + encodeURIComponent(clientId)).catch(function () { return null; }),
        U.api('GET', '/api/mandat/last').catch(function () { return {}; }), U.api('GET', '/api/owner-clients').catch(function () { return {}; })]).then(function (r) {
        var p = r[0].user || r[0].profile || r[0], d = S.d;
        var cl = r[1] ? normClient(r[1].client || r[1]) : null;
        if (!cl || !cl.id) cl = ((r[3].clients || []).map(normClient).filter(function (x) { return x.id === clientId; })[0]) || null;
        if (!cl) throw new Error('Propriétaire introuvable.');
        if (cl.isAgency) throw new Error('Les mandats ne peuvent être créés que pour vos propres clients.');
        S.client = cl;
        d.companyName = p.company || p.company_name || ''; d.companyEmail = p.email || ''; d.companySiret = p.siret || '';
        d.companyRep = [pick(p, 'firstName', 'first_name'), pick(p, 'lastName', 'last_name')].filter(Boolean).join(' ');
        d.companyAddress = [p.address, pick(p, 'postalCode', 'postal_code'), p.city].filter(Boolean).join(' ');
        d.companyLogoUrl = pick(p, 'logoUrl', 'logo_url') || '';
        d.ownerFirstName = cl.firstName; d.ownerLastName = cl.lastName; d.ownerEmail = cl.email; d.ownerPhone = cl.phone;
        d.ownerAddress = [cl.address, cl.postalCode, cl.city].filter(Boolean).join(' ');
        var src = r[2] && r[2].source;
        if (src) { PREFILL_KEYS.forEach(function (k) { if (src[k] != null) d[k] = String(src[k]); }); S.prefill = true; }
        S.phase = 'form';
      }).catch(function (e) { S.phase = 'error'; S.err = e.message || 'Impossible de charger les données.'; }).then(render);
    }

    /* ── Champs ── */
    function f(label, k, ph, mode, type) {
      return '<div class="bhp-row bho-field"><span class="bho-field__l">' + esc(label) + '</span><input class="bhp-input bho-field__i" data-k="' + k + '" value="' + esc(S.d[k]) + '" placeholder="' + esc(ph || '') + '"' + (mode ? ' inputmode="' + mode + '"' : '') + (type ? ' type="' + type + '"' : '') + '></div>';
    }
    function sel(label, k, opts) {
      return '<div class="bhp-row bhp-kv"><span class="bhp-kv__l">' + esc(label) + '</span><select class="bhp-input bhp-select" data-k="' + k + '" data-rr="1">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (S.d[k] === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></div>';
    }
    function chk(on) { return '<span class="bhp-ic bho-pick__c' + (on ? ' is-on' : '') + '">' + (on ? I.checkFill : '<svg class="bhp-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9.5"/></svg>') + '</span>'; }
    function listEdit(key, ph, addLabel) {
      return S.d[key].map(function (v, i) { return htmlRow('<div class="bhp-flexrow"><input class="bhp-input bhp-grow" data-k="' + key + '.' + i + '" value="' + esc(v) + '" placeholder="' + esc(ph) + '"><button class="bhp-minus" data-act="del" data-key="' + key + '" data-i="' + i + '">' + I.minusFill + '</button></div>'); }).join('')
        + '<div class="bhp-row"><button class="bhp-add" data-act="add" data-key="' + key + '">' + ic('plusFill') + '<span>' + esc(addLabel) + '</span></button></div>';
    }

    function step1() {
      var d = S.d, h = '';
      h += '<div class="bhp-group">' + '<button class="bhm-fold" data-act="fold">' + U.label('Conciergerie') + '<span class="bhp-ic bhc-sec__c" style="' + (S.coOpen ? 'transform:rotate(180deg)' : '') + '">' + (I.chevD || '') + '</span></button>'
        + (S.coOpen ? '<div class="bhp-banner">' + ic('info') + '<span>Ces informations viennent de ton profil. <a href="/settings-account.html">Les modifier</a></span></div>'
          + card(f('Société', 'companyName') + f('Représentant', 'companyRep') + f('Email', 'companyEmail', '', 'email') + f('Téléphone', 'companyPhone', 'Optionnel', 'tel') + f('SIRET', 'companySiret', '', 'numeric')
            + f('Adresse', 'companyAddress') + f('Mentions légales', 'companyLegal', 'Optionnel') + f('Champ libre (titre)', 'companyFreeTitle', 'Optionnel') + f('Champ libre (valeur)', 'companyFreeValue', 'Optionnel'))
          : card(htmlRow('<div style="font-size:15px;font-weight:600">' + esc(d.companyName || '—') + '</div><div class="bhp-meta">' + esc([d.companyRep, d.companyEmail].filter(Boolean).join(' · ')) + '</div>'))) + '</div>';
      var miss = !d.ownerFirstName.trim() || !d.ownerLastName.trim() || !d.ownerEmail.trim();
      h += '<div class="bhp-group">' + U.label('Propriétaire') + card(f('Prénom', 'ownerFirstName', 'Obligatoire') + f('Nom', 'ownerLastName', 'Obligatoire') + f('Email', 'ownerEmail', 'Obligatoire', 'email')
        + f('Adresse', 'ownerAddress', 'Optionnel') + f('Téléphone', 'ownerPhone', 'Optionnel', 'tel') + f('Date de naissance', 'ownerDOB', '', null, 'date') + f('SIREN', 'ownerSiren', 'Optionnel', 'numeric'))
        + (miss ? '<div class="bho-hint">' + ic('errFill') + '<span>Le prénom, le nom et l\'email du propriétaire sont obligatoires.</span></div>' : '') + '</div>';
      h += '<div class="bhp-group">' + U.label('Bien') + card(f('Adresse', 'propAddress', 'Adresse du bien') + sel('Type', 'propType', OPT.propType) + f('Capacité (pers.)', 'propCapacity', '', 'numeric')
        + f('Séjour min (nuits)', 'minStay', '', 'numeric') + f('Séjour max (nuits)', 'maxStay', '', 'numeric') + sel('Animaux', 'animals', OPT.animals) + sel('Fumeur', 'smoking', OPT.smoking) + sel('Fêtes', 'parties', OPT.parties)
        + '<div class="bhp-row bhp-kv"><span class="bhp-kv__l">Arrivée</span><input type="time" class="bhp-input bhp-time" data-k="checkinTime" value="' + esc(d.checkinTime) + '"></div>'
        + '<div class="bhp-row bhp-kv"><span class="bhp-kv__l">Départ</span><input type="time" class="bhp-input bhp-time" data-k="checkoutTime" value="' + esc(d.checkoutTime) + '"></div>') + '</div>';
      return h;
    }
    function step2() {
      var d = S.d, h = '';
      MISSIONS.forEach(function (cat) {
        h += '<div class="bhp-group">' + U.label(cat[0]) + card(cat[1].map(function (m) { var on = d.missions.indexOf(m) >= 0; return '<button class="bhp-row bho-pick" data-act="mission" data-v="' + esc(m) + '">' + chk(on) + '<span class="bho-pick__t">' + esc(m) + '</span></button>'; }).join('')) + '</div>';
      });
      h += '<div class="bhp-group">' + U.label('Missions personnalisées') + card(listEdit('customMissions', 'Mission', 'Ajouter une mission')) + '</div>';
      h += '<div class="bhp-group">' + U.label('Interventions urgentes') + card('<div class="bhp-row bhp-kv"><span class="bhp-kv__l">Plafond sans accord</span><span class="bhp-in-wrap"><input class="bhp-input bhp-input--r" data-k="urgenceLimit" value="' + esc(d.urgenceLimit) + '" inputmode="decimal" placeholder="150"><span class="bhp-unit">€ TTC</span></span></div>') + '</div>';
      h += '<div class="bhp-group">' + U.label('Extras facturables') + card(EXTRAS.map(function (x) {
        var e = d.extras[x[0]];
        return '<div class="bhp-row"><button class="bho-pick" data-act="extra" data-v="' + esc(x[0]) + '">' + chk(!!e) + '<span class="bho-pick__t">' + esc(x[0]) + '</span></button>'
          + (e ? '<div class="bhp-flexrow" style="margin-top:8px;padding-left:33px"><span class="bhp-in-wrap"><input class="bhp-input bhp-input--s" data-k="extras.' + esc(x[0]) + '.price" value="' + esc(e.price) + '" inputmode="decimal" placeholder="Prix"><span class="bhp-unit">€</span></span>'
            + '<select class="bhp-input bhp-select" data-k="extras.' + esc(x[0]) + '.unit">' + x[1].map(function (u) { return '<option value="' + u + '"' + (e.unit === u ? ' selected' : '') + '>' + UNITS[u] + '</option>'; }).join('') + '</select></div>' : '') + '</div>';
      }).join('') + d.customExtras.map(function (e, i) {
        return htmlRow('<div class="bhp-flexrow"><input class="bhp-input bhp-grow" data-k="customExtras.' + i + '.label" value="' + esc(e.label) + '" placeholder="Extra"><input class="bhp-input bhp-input--s" data-k="customExtras.' + i + '.price" value="' + esc(e.price) + '" inputmode="decimal" placeholder="€">'
          + '<select class="bhp-input bhp-select" style="max-width:120px" data-k="customExtras.' + i + '.unit">' + ['par_prestation', 'par_heure', 'par_nuit'].map(function (u) { return '<option value="' + u + '"' + (e.unit === u ? ' selected' : '') + '>' + UNITS[u] + '</option>'; }).join('') + '</select>'
          + '<button class="bhp-minus" data-act="del" data-key="customExtras" data-i="' + i + '">' + I.minusFill + '</button></div>');
      }).join('') + '<div class="bhp-row"><button class="bhp-add" data-act="add-extra">' + ic('plusFill') + '<span>Ajouter un extra</span></button></div>') + '</div>';
      return h;
    }
    function step3() {
      var d = S.d, h = '<div class="bhp-group">' + U.label('Type de rémunération') + '<div class="bhm-remu">' + REMU.map(function (r) {
        return '<button class="bhp-card bhm-remu__c' + (d.remuType === r[0] ? ' is-on' : '') + '" data-act="remu" data-v="' + r[0] + '">' + esc(r[1]) + '</button>';
      }).join('') + '</div></div>';
      var dep = '';
      if (d.remuType === 'commission') dep = '<div class="bhp-row bhp-kv"><span class="bhp-kv__l">Taux</span><span class="bhp-in-wrap"><input class="bhp-input bhp-input--s" data-k="commissionRate" value="' + esc(d.commissionRate) + '" inputmode="decimal" placeholder="20"><span class="bhp-unit">%</span></span></div>' + sel('Base de calcul', 'commissionBase', OPT.commissionBase);
      if (d.remuType === 'forfait_mensuel') dep = '<div class="bhp-row bhp-kv"><span class="bhp-kv__l">Forfait</span><span class="bhp-in-wrap"><input class="bhp-input bhp-input--r" data-k="forfaitMensuel" value="' + esc(d.forfaitMensuel) + '" inputmode="decimal" placeholder="200"><span class="bhp-unit">€/mois</span></span></div>';
      if (d.remuType === 'forfait_resa') dep = '<div class="bhp-row bhp-kv"><span class="bhp-kv__l">Forfait</span><span class="bhp-in-wrap"><input class="bhp-input bhp-input--r" data-k="forfaitResa" value="' + esc(d.forfaitResa) + '" inputmode="decimal" placeholder="50"><span class="bhp-unit">€/rés.</span></span></div>';
      if (d.remuType === 'mixte') dep = '<div class="bhp-row bhp-kv"><span class="bhp-kv__l">Taux</span><span class="bhp-in-wrap"><input class="bhp-input bhp-input--s" data-k="mixteRate" value="' + esc(d.mixteRate) + '" inputmode="decimal" placeholder="8"><span class="bhp-unit">%</span></span></div>'
        + '<div class="bhp-row bhp-kv"><span class="bhp-kv__l">Forfait</span><span class="bhp-in-wrap"><input class="bhp-input bhp-input--r" data-k="mixteForfait" value="' + esc(d.mixteForfait) + '" inputmode="decimal" placeholder="100"><span class="bhp-unit">€/mois</span></span></div>';
      if (dep) h += card(dep);
      h += '<div class="bhp-group">' + U.label('Facturation') + card(sel('TVA', 'tva', OPT.tva) + sel('Délai de préavis tarifaire', 'tarifPreavis', OPT.tarifPreavis) + sel('Reversement', 'reversement', OPT.reversement)) + '</div>';
      return h;
    }
    function step4() {
      var d = S.d, h = card(sel('Durée', 'dureeType', OPT.dureeType) + (d.dureeType === 'determinee' ? '<div class="bhp-row bhp-kv"><span class="bhp-kv__l">Date de début</span><input type="date" class="bhp-input" style="width:auto" data-k="dateDebut" value="' + esc(d.dateDebut) + '"></div>' + sel('Durée', 'dureeMois', OPT.dureeMois) + sel('Renouvellement', 'renouvellement', OPT.renouvellement) : ''));
      h += card(sel('Préavis de résiliation', 'preavis', OPT.preavis) + sel('Exclusivité', 'exclusivite', OPT.exclusivite) + sel('Responsabilité plafonnée', 'respPlafond', OPT.respPlafond) + sel('Juridiction', 'juridiction', OPT.juridiction) + sel('Confidentialité', 'confidentialite', OPT.confidentialite));
      h += '<div class="bhp-group">' + U.label('Clauses personnalisées') + card(listEdit('clausesPersonnalisees', 'Clause', 'Ajouter une clause')) + '</div>';
      return h;
    }
    function summary() {
      var d = S.d, com = '—';
      if (d.remuType === 'commission') com = d.commissionRate ? d.commissionRate + NB + '%' : '—';
      else if (d.remuType === 'forfait_mensuel') com = d.forfaitMensuel ? d.forfaitMensuel + NB + '€/mois' : '—';
      else if (d.remuType === 'forfait_resa') com = d.forfaitResa ? d.forfaitResa + NB + '€/rés.' : '—';
      else if (d.remuType === 'mixte') com = d.mixteRate ? d.mixteRate + NB + '% + forfait' : '—';
      else if (d.remuType === 'carte') com = 'À la carte';
      var du = d.dureeType === 'determinee' ? (d.dureeMois ? d.dureeMois + ' mois' : 'Déterminée') : 'Indéterminée';
      var pr = d.preavis === '0' ? 'Aucun' : (d.preavis ? d.preavis + ' jours' : '—');
      return [[com, 'Rémunération', true], [du, 'Durée'], [pr, 'Préavis']];
    }
    function missionsList() { return S.d.missions.concat(S.d.customMissions.map(function (s) { return s.trim(); }).filter(Boolean)); }
    function extrasList() {
      var out = [];
      EXTRAS.forEach(function (x) { var e = S.d.extras[x[0]]; if (!e) return; var p = String(e.price || '').trim(); out.push(p ? x[0] + ' : ' + p + ' € ' + UNITS[e.unit] : x[0]); });
      S.d.customExtras.forEach(function (e) { var l = String(e.label || '').trim(); if (!l) return; var p = String(e.price || '').trim(); out.push(p ? l + ' : ' + p + ' € ' + UNITS[e.unit] : l); });
      return out;
    }
    function step5() {
      var d = S.d, h = '<div class="bhp-card bhc-signer"><span class="bho-av" style="width:52px;height:52px;font-size:19px">' + esc(((d.ownerFirstName || '').charAt(0) + (d.ownerLastName || '').charAt(0)).toUpperCase() || '?') + '</span><div class="bho-cl__t"><div class="bho-cl__n" style="font-size:17px">' + esc([d.ownerFirstName, d.ownerLastName].join(' ')) + '</div><div class="bhp-meta">' + esc([d.propAddress, d.propType && lab(OPT.propType, d.propType)].filter(Boolean).join(' · ') || d.ownerEmail) + '</div></div></div>';
      h += '<div class="bhc-sum">' + summary().map(function (x) { return '<div class="bhp-card bhc-sum__b"><b' + (x[2] ? ' style="color:#0E3B2E"' : '') + '>' + esc(x[0]) + '</b><span>' + esc(x[1]) + '</span></div>'; }).join('') + '</div>';
      var m = missionsList(), ex = extrasList();
      h += card(U.kv('Missions', String(m.length)) + U.kv('Extras facturables', String(ex.length)) + U.kv('TVA', lab(OPT.tva, d.tva)) + U.kv('Reversement', lab(OPT.reversement, d.reversement)) + U.kv('Exclusivité', lab(OPT.exclusivite, d.exclusivite)) + U.kv('Juridiction', lab(OPT.juridiction, d.juridiction)));
      h += '<p class="bhp-note">Un lien de signature partira à ' + esc(d.ownerEmail) + '. Il verra ta signature déjà apposée et signera à son tour.</p>';
      return h;
    }

    function renderForm() {
      var titles = ['Parties et bien', 'Missions', 'Honoraires', 'Conditions', 'Signature'];
      var prog = '<div class="bhm-prog">' + titles.map(function (t, i) { return '<i class="' + (i < S.step ? 'is-on' : '') + '"></i>'; }).join('') + '</div>';
      var nav = '<header class="bhp-nav"><div class="bhm-nav__in">' + U.circleBtn('chevL', S.step > 1 ? 'prev' : 'back', 'Retour') + '<div class="bhm-nav__t"><div class="bhp-nav__kicker" style="text-align:left">Mandat · ' + esc(cName(S.client)) + ' · ' + S.step + '/5</div><h1 class="bhm-title">' + esc(titles[S.step - 1]) + '</h1></div></div><div class="bhm-nav__in2">' + prog + '</div></header>';
      var body = (S.prefill && (S.step === 3 || S.step === 4) ? '<div class="bhp-banner">' + ic('info') + '<span>Honoraires et conditions repris de ton dernier mandat. <button class="bhp-textbtn bhp-textbtn--vert" style="padding:0;font-size:13.5px;text-decoration:underline" data-act="reset">Repartir de zéro</button></span></div>' : '')
        + [step1, step2, step3, step4, step5][S.step - 1]();
      var valid = S.step !== 1 || (S.d.ownerFirstName.trim() && S.d.ownerLastName.trim() && S.d.ownerEmail.trim());
      var bar = '<div class="bhc-bar">' + (S.step < 5 ? '<button class="bhp-btn bhp-btn--primary" data-act="next"' + (valid ? '' : ' disabled') + '>Suivant</button>' : '<button class="bhp-btn bhp-btn--primary" data-act="sign">' + ic('pencil') + 'Signer le mandat</button>') + '</div>';
      root.innerHTML = nav + '<div class="bhp-stack" data-mf>' + body + bar + '</div>';
    }
    function render() {
      if (S.phase === 'pick') return renderPick();
      if (S.phase === 'loading') { root.innerHTML = '<div class="bhp-state bhp-center"><span class="bhp-spin bhp-spin--lg"></span></div>'; return; }
      if (S.phase === 'error') { root.innerHTML = '<header class="bhp-nav"><div class="bhm-nav__in">' + U.circleBtn('chevL', 'back', 'Retour') + '<div class="bhm-nav__t"><h1 class="bhm-title">Mandat</h1></div></div></header><div class="bhm-empty">' + ic('warnFill') + '<span>' + esc(S.err) + '</span></div>'; return; }
      renderForm();
    }
    function read() {
      var b = root.querySelector('[data-mf]'); if (!b) return;
      b.querySelectorAll('[data-k]').forEach(function (el) {
        var k = el.dataset.k.split('.'), o = S.d;
        for (var i = 0; i < k.length - 1; i++) { if (o[k[i]] == null) o[k[i]] = {}; o = o[k[i]]; }
        o[k[k.length - 1]] = el.value;
      });
    }
    function openSign() {
      if (!BHP.signaturePad) { U.alertMsg('Erreur', 'Module de signature manquant.'); return; }
      var d = S.d;
      var sh = U.openSheet({ head: { title: 'Votre signature', left: '<button class="bhp-textbtn bhp-textbtn--vert" data-act="sheet-close">Annuler</button>' } });
      var stamp = new Date().toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
      sh.body.innerHTML = '<div class="bhp-stack"><p class="bhp-note" style="font-size:14px">Signez dans le cadre avec le doigt. Vous pourrez recommencer autant que nécessaire.</p>'
        + '<div class="bha-pad"><canvas></canvas><i class="bha-pad__line"></i><span class="bha-pad__name">' + esc(d.companyRep || d.companyName) + '</span></div>'
        + '<div class="bhp-kv"><button class="bhp-link" data-act="clear">' + ic('undo') + 'Effacer</button><span class="bhp-meta">' + esc(stamp) + '</span></div>'
        + '<div class="bhp-banner">' + ic('mail') + '<span>Un lien de signature partira à ' + esc(d.ownerEmail) + '. ' + esc(d.ownerFirstName || 'Le propriétaire') + ' verra ta signature déjà apposée et signera à son tour.</span></div>'
        + '<button class="bhp-btn bhp-btn--primary" data-act="go" disabled>Signer et envoyer</button></div>';
      var go = sh.body.querySelector('[data-act="go"]');
      var pad = BHP.signaturePad(sh.body.querySelector('canvas'), function (has) { go.disabled = !has; });
      sh.body.addEventListener('click', function (e) {
        var el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
        if (el.dataset.act === 'clear') return pad.clear();
        if (el.dataset.act !== 'go') return;
        var sig = pad.data();
        if (sig.indexOf('data:image/png;base64,') !== 0) { U.alertMsg('Erreur', 'Signature invalide. Veuillez signer à nouveau.'); return; }
        go.disabled = true; go.innerHTML = '<span class="bhp-spin bhp-spin--w"></span>Envoi…'; sh.locked = true;
        var body = { clientId: S.client.id, contractType: 'mandat' };
        Object.keys(d).forEach(function (k) { if (['missions', 'customMissions', 'extras', 'customExtras'].indexOf(k) < 0) body[k] = Array.isArray(d[k]) ? d[k].map(function (s) { return String(s).trim(); }).filter(Boolean) : String(d[k] == null ? '' : d[k]).trim(); });
        body.missions = missionsList(); body.extrasFacturables = extrasList();
        body.signatureData = sig; body.signatureDate = new Date().toISOString();
        U.api('POST', '/api/mandat/send', body).then(function () {
          sh.locked = false; sh.close();
          U.alertMsg('Mandat envoyé', 'Le lien de signature est parti à ' + d.ownerEmail + '.').then(function () { location.href = '/contrats.html'; });
        }).catch(function (er) { sh.locked = false; go.disabled = false; go.textContent = 'Signer et envoyer'; U.alertMsg('Erreur', er.message || 'Erreur réseau.'); });
      });
    }

    root.addEventListener('change', function (e) { if (e.target.dataset && e.target.dataset.rr) { read(); render(); } });
    root.addEventListener('input', function (e) {
      if (S.step !== 1 || !e.target.dataset || !e.target.dataset.k) return;
      read(); var b = root.querySelector('[data-act="next"]'); if (b) b.disabled = !(S.d.ownerFirstName.trim() && S.d.ownerLastName.trim() && S.d.ownerEmail.trim());
    });
    root.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
      var a = el.dataset.act; read();
      if (a === 'back') { if (history.length > 1 && document.referrer.indexOf(location.host) >= 0) history.back(); else location.href = '/contrats.html'; return; }
      if (a === 'prev') { S.step--; render(); window.scrollTo(0, 0); return; }
      if (a === 'next') { S.step++; render(); window.scrollTo(0, 0); return; }
      if (a === 'fold') { S.coOpen = !S.coOpen; render(); return; }
      if (a === 'reset') { var df = defaults(); PREFILL_KEYS.forEach(function (k) { S.d[k] = df[k]; }); S.prefill = false; render(); return; }
      if (a === 'mission') { var v = el.dataset.v, i = S.d.missions.indexOf(v); if (i >= 0) S.d.missions.splice(i, 1); else S.d.missions.push(v); render(); return; }
      if (a === 'extra') { var x = el.dataset.v; if (S.d.extras[x]) delete S.d.extras[x]; else { var def = EXTRAS.filter(function (y) { return y[0] === x; })[0]; S.d.extras[x] = { price: '', unit: def[1][0] }; } render(); return; }
      if (a === 'add-extra') { S.d.customExtras.push({ label: '', price: '', unit: 'par_prestation' }); render(); return; }
      if (a === 'add') { S.d[el.dataset.key].push(''); render(); var ins = root.querySelectorAll('[data-k^="' + el.dataset.key + '."]'); if (ins.length) ins[ins.length - 1].focus(); return; }
      if (a === 'del') { S.d[el.dataset.key].splice(+el.dataset.i, 1); render(); return; }
      if (a === 'remu') { S.d.remuType = el.dataset.v; render(); return; }
      if (a === 'sign') return openSign();
    });

    if (clientId) { render(); load(); }
    else { render(); U.api('GET', '/api/owner-clients').then(function (r) { S.clients = (r.clients || []).map(normClient); }).catch(function () { S.clients = []; }).then(render); }
  };
})();
