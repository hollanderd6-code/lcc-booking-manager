#!/usr/bin/env node
/* ============================================================
   outils/refonte-17-messages-liste.js
   Lot 17 : la liste des messages
   ============================================================

   ── CE QUI CHANGE ────────────────────────────────────────────────
   La liste prend la forme de votre maquette : nom, logement, plateforme,
   extrait du dernier message, pastille verte pour les non lus. Quatre
   filtres au-dessus — Tous, Non lus, Arrivees du jour, Par logement — et
   le bandeau IA en bas.

   ── « IA A VALIDER » N'Y EST PAS ─────────────────────────────────
   Vous l'avez tranche : cet etat n'existe pas en base et vous ne voulez
   pas le construire maintenant. Le filtre disparait donc de la maquette
   plutot que d'afficher un compteur qui ne compte rien.

   ── « ARRIVEES DU JOUR » VIENT DE LA MEME SOURCE ─────────────────
   Le filtre croise la liste avec /api/aujourdhui/etats — la route des
   lots 6 a 16, celle qui voit vos reservations directes. Un voyageur qui
   arrive aujourd'hui est celui dont la conversation figure dans les
   arrivees du jour. Pas d'heuristique sur les dates : la meme verite que
   l'ecran Aujourd'hui.

   Si la route ne repond pas, le filtre est masque plutot qu'affiche vide.

   ── LE BANDEAU IA DIT UN CHIFFRE VRAI ────────────────────────────
   Nouvelle route en lecture seule :

       GET /api/ia/semaine   ->   { reponses, depuis }

   Elle compte les messages portant is_bot_response sur sept jours, dans
   vos conversations et celles des comptes que vous gerez. C'est la
   colonne que votre auto-response-handler.js remplit a chaque reponse.

   Je n'affiche PAS « 1 escalade » : je n'ai trouve aucune table ni
   colonne qui enregistre une escalade. Le mot existe dans vos pages de
   presentation, pas dans vos donnees. Le bandeau dit donc ce qu'il sait
   et se tait sur le reste.

   ── LA METHODE ───────────────────────────────────────────────────
   Le module construit SA liste et endort #conversationsList, comme
   bh-liste-unifiee l'a fait pour la journee. Il ne se bat pas avec
   chat-owner.js, qui continue de peupler son conteneur masque sans
   gener personne. Un clic appelle openChat(id) — votre fonction, votre
   comportement, y compris la redirection mobile.

   bhAnnulerMessages()   rend l'ancienne liste
   bhVerifMessages()     ce qui est affiche, et d'ou ca vient

   Usage :
     node outils/refonte-17-messages-liste.js --essai
     node outils/refonte-17-messages-liste.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = process.cwd();
const SERVEUR = path.join(RACINE, 'server.js');
const PUBLIC = path.join(RACINE, 'public');
const PAGE = path.join(PUBLIC, 'messages.html');
const MODULE = path.join(PUBLIC, 'js', 'bh-messages-liste.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(SERVEUR)) echec('server.js introuvable. Lancez depuis la racine du projet.');
if (!fs.existsSync(PAGE)) echec('public/messages.html introuvable.');

/* ============================================================
   1. SERVEUR — le chiffre du bandeau
   ============================================================ */

let srv = fs.readFileSync(SERVEUR, 'utf8');
let etatServeur;

if (srv.indexOf("'/api/ia/semaine'") !== -1) {
  etatServeur = 'deja applique';
} else {
  const ANCRE = 'async function runTemplatesCron(triggerTypes) {';
  const n = srv.split(ANCRE).length - 1;
  if (n !== 1) echec("L'ancre runTemplatesCron est presente " + n + ' fois (attendu : 1).');
  if (srv.indexOf('authenticateAny') === -1) echec('authenticateAny introuvable dans server.js.');

  const ROUTE = `// ============================================================
// GET /api/ia/semaine — ce que l'IA a repondu sur sept jours
// ============================================================
// Lecture seule. Compte les messages portant is_bot_response, colonne
// que auto-response-handler.js remplit a chaque reponse automatique.
//
// Aucun compte d'escalade : rien dans le schema n'enregistre une
// escalade. Le bandeau dira donc ce qu'il sait et se taira sur le reste.
app.get('/api/ia/semaine', authenticateAny, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.user_id || req.userId;
    if (!userId) return res.status(401).json({ error: 'non authentifie' });

    const ids = [userId];
    try {
      const del = await pool.query(
        \`SELECT delegator_user_id FROM account_delegations
         WHERE delegate_user_id = $1 AND status = 'accepted'\`,
        [userId]
      );
      del.rows.forEach(r => { if (r.delegator_user_id && !ids.includes(r.delegator_user_id)) ids.push(r.delegator_user_id); });
    } catch (e) {
      // Table absente ou renommee : on compte pour le seul compte.
    }

    let reponses = null;
    try {
      const q = await pool.query(
        \`SELECT COUNT(*)::int AS n
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE c.user_id = ANY($1::text[])
           AND m.is_bot_response = TRUE
           AND m.created_at >= NOW() - INTERVAL '7 days'\`,
        [ids]
      );
      reponses = q.rows[0] ? q.rows[0].n : 0;
    } catch (e) {
      // Colonne absente : null, jamais un zero qui ressemblerait a un fait.
      console.error('[IA/SEMAINE]', e.message);
    }

    res.json({ reponses, jours: 7, comptes: ids.length });
  } catch (e) {
    console.error('❌ [IA/SEMAINE]', e.message);
    res.status(500).json({ error: e.message });
  }
});

`;

  ['INSERT ', 'UPDATE ', 'DELETE ', 'ALTER ', 'DROP ', 'CREATE TABLE'].forEach(function (mot) {
    if (ROUTE.toUpperCase().indexOf(mot) !== -1) echec('Le code ajoute contient « ' + mot.trim() + ' ». Refus.');
  });

  const pos = srv.indexOf(ANCRE);
  srv = srv.slice(0, pos) + ROUTE + srv.slice(pos);

  if (srv.split("app.get('/api/ia/semaine'").length - 1 !== 1) echec('La route serait definie plusieurs fois. Refus.');
  try { new Function(srv); } catch (e) { echec('server.js ne serait plus du JavaScript valide — ' + e.message); }

  etatServeur = 'route /api/ia/semaine ajoutee';
}

/* ============================================================
   2. NAVIGATEUR — le module
   ============================================================ */

const SOURCE = `/* ============================================================
   bh-messages-liste.js — la liste des conversations
   ============================================================
   Construit sa propre liste depuis /api/chat/conversations et endort
   #conversationsList. chat-owner.js continue de peupler son conteneur
   masque : on ne lui dispute pas le DOM, on se place a cote.

   Un clic appelle openChat(id) — sa fonction, son comportement.
   ============================================================ */
(function () {
  'use strict';

  if (window.__bhMessagesListe) return;
  window.__bhMessagesListe = true;

  var ENCRE = '#0D1117';
  var GRIS = '#7A8695';
  var BORD = '#E4E1D8';
  var VERT = '#0E3B2E';

  var mem = [];
  var etat = {
    conversations: [], arriveesJour: null, ia: null,
    filtre: 'tous', logement: '', erreur: '', pose: false
  };

  function jeton() {
    return localStorage.getItem('lcc_token') || localStorage.getItem('token') || '';
  }

  var PLATEFORMES = {
    airbnb: { nom: 'Airbnb', fond: '#FCE7EC', encre: '#B81E4B' },
    abb: { nom: 'Airbnb', fond: '#FCE7EC', encre: '#B81E4B' },
    booking: { nom: 'Booking', fond: '#E3EAF8', encre: '#123E86' },
    bdc: { nom: 'Booking', fond: '#E3EAF8', encre: '#123E86' },
    expedia: { nom: 'Expedia', fond: '#EEF0F6', encre: '#3A4A6B' },
    boostinghost: { nom: 'BHGuest', fond: '#FDEBDC', encre: '#A85413' },
    guest: { nom: 'BHGuest', fond: '#FDEBDC', encre: '#A85413' }
  };

  function plateforme(p) {
    var brut = String(p || '').toLowerCase().replace(/[^a-z]/g, '');
    for (var k in PLATEFORMES) if (brut.indexOf(k) !== -1) return PLATEFORMES[k];
    return brut ? { nom: String(p), fond: '#F0EEE7', encre: '#5A5A54' } : null;
  }

  function nom(c) {
    if (c.guest_display_name && c.guest_display_name !== 'Voyageur') return c.guest_display_name;
    if (c.guest_first_name) return [c.guest_first_name, c.guest_last_name].filter(Boolean).join(' ');
    return (c.guest_name && c.guest_name !== 'null') ? c.guest_name : 'Voyageur';
  }

  function initiales(c) {
    var n = nom(c).trim().split(/\\s+/);
    return ((n[0] || '?')[0] + (n[1] ? n[1][0] : '')).toUpperCase();
  }

  /* Aujourd'hui l'heure, hier « hier », au-dela le jour abrege. Une date
     complete sur une liste qu'on parcourt du pouce ne se lit pas. */
  var JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  function quand(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var maintenant = new Date();
    var jour = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate());
    var jourMsg = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var ecart = Math.round((jour - jourMsg) / 86400000);
    if (ecart <= 0) return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    if (ecart === 1) return 'hier';
    if (ecart < 7) return JOURS[d.getDay()];
    return d.getDate() + '/' + ('0' + (d.getMonth() + 1)).slice(-2);
  }

  function extrait(c) {
    var t = String(c.last_message || '')
      .replace(/\\{[^}]+\\}/g, '')
      .replace(/https?:\\/\\/\\S+/g, 'lien')
      .replace(/\\s+/g, ' ').trim();
    return t.length > 64 ? t.slice(0, 64) + '\\u2026' : t;
  }

  function nonLus(c) { return parseInt(c.unread_count, 10) || 0; }

  function arriveAujourdhui(c) {
    if (!etat.arriveesJour) return false;
    return etat.arriveesJour.indexOf(String(c.id)) !== -1;
  }

  /* ── Le rendu ───────────────────────────────────────────────── */

  function ligne(c, dernier) {
    var a = document.createElement('a');
    a.href = '#';
    a.setAttribute('data-conv', c.id);
    a.style.cssText = 'display:flex;align-items:flex-start;gap:12px;padding:14px 15px'
      + ';text-decoration:none;min-height:44px'
      + (nonLus(c) ? ';background:#FCFAF5' : '')
      + (dernier ? '' : ';border-bottom:1px solid #F0EEE7');
    a.addEventListener('click', function (e) {
      e.preventDefault();
      if (typeof window.openChat === 'function') window.openChat(c.id);
      else location.href = '/chat-mobile.html?id=' + c.id;
    });

    var p = plateforme(c.platform);

    var av = document.createElement('span');
    av.textContent = initiales(c);
    av.style.cssText = 'flex:none;width:42px;height:42px;border-radius:50%;display:inline-flex'
      + ';align-items:center;justify-content:center;font-size:13.5px;font-weight:700'
      + ';background:' + (p ? p.fond : '#EDEAE2') + ';color:' + (p ? p.encre : '#5A5A54');
    a.appendChild(av);

    var m = document.createElement('span');
    m.style.cssText = 'flex:1;min-width:0';

    var h = document.createElement('span');
    h.style.cssText = 'display:flex;align-items:baseline;justify-content:space-between;gap:8px';
    var t = document.createElement('span');
    t.textContent = nom(c);
    t.style.cssText = 'font-size:15.5px;font-weight:' + (nonLus(c) ? '700' : '600')
      + ';color:' + ENCRE + ';letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    h.appendChild(t);
    var q = document.createElement('span');
    q.textContent = quand(c.last_message_time || c.created_at);
    q.style.cssText = 'flex:none;font-size:12px;color:' + (nonLus(c) ? VERT : '#A8A49B')
      + ';font-weight:' + (nonLus(c) ? '600' : '400');
    h.appendChild(q);
    m.appendChild(h);

    var s = document.createElement('span');
    s.textContent = [c.property_name, p ? p.nom : null].filter(Boolean).join(' \\u00b7 ');
    s.style.cssText = 'display:block;font-size:12.5px;color:' + GRIS + ';margin-top:1px'
      + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    m.appendChild(s);

    var e = extrait(c);
    if (e) {
      var x = document.createElement('span');
      x.textContent = e;
      x.style.cssText = 'display:block;font-size:13px;margin-top:4px'
        + ';color:' + (nonLus(c) ? '#3A3A34' : '#9A968D')
        + ';font-weight:' + (nonLus(c) ? '500' : '400')
        + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      m.appendChild(x);
    }
    a.appendChild(m);

    if (nonLus(c)) {
      var pt = document.createElement('span');
      pt.style.cssText = 'flex:none;width:9px;height:9px;border-radius:50%;background:' + VERT + ';margin-top:16px';
      a.appendChild(pt);
    }
    return a;
  }

  function puce(texte, actif, onClic) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = texte;
    b.style.cssText = 'flex:none;font-size:13.5px;font-weight:600;border-radius:999px'
      + ';padding:9px 16px;min-height:38px;cursor:pointer;font-family:inherit'
      + (actif
        ? ';background:' + VERT + ';color:#fff;border:1px solid ' + VERT
        : ';background:#fff;color:' + ENCRE + ';border:1px solid ' + BORD);
    b.addEventListener('click', onClic);
    return b;
  }

  function filtrees() {
    var l = etat.conversations.slice();
    if (etat.filtre === 'non_lus') l = l.filter(function (c) { return nonLus(c) > 0; });
    if (etat.filtre === 'arrivees') l = l.filter(arriveAujourdhui);
    if (etat.logement) l = l.filter(function (c) { return String(c.property_name || '') === etat.logement; });
    return l;
  }

  function logements() {
    var vus = {}, out = [];
    etat.conversations.forEach(function (c) {
      var n = String(c.property_name || '').trim();
      if (n && !vus[n]) { vus[n] = 1; out.push(n); }
    });
    return out.sort();
  }

  function dessiner() {
    var hote = document.getElementById('bhMessagesListe');
    if (!hote) return;
    hote.innerHTML = '';

    var total = etat.conversations.reduce(function (s, c) { return s + nonLus(c); }, 0);
    if (total) {
      var e = document.createElement('div');
      e.textContent = total + ' non lu' + (total > 1 ? 's' : '');
      e.style.cssText = 'font-size:13px;color:' + GRIS + ';padding:0 4px 10px';
      hote.appendChild(e);
    }

    var barre = document.createElement('div');
    barre.style.cssText = 'display:flex;gap:8px;overflow-x:auto;padding:0 4px 14px;-webkit-overflow-scrolling:touch';
    barre.appendChild(puce('Tous', etat.filtre === 'tous' && !etat.logement, function () {
      etat.filtre = 'tous'; etat.logement = ''; dessiner();
    }));
    var nl = etat.conversations.filter(function (c) { return nonLus(c) > 0; }).length;
    if (nl) {
      barre.appendChild(puce('Non lus \\u00b7 ' + nl, etat.filtre === 'non_lus', function () {
        etat.filtre = 'non_lus'; etat.logement = ''; dessiner();
      }));
    }
    /* Le filtre des arrivees n'apparait que si la route a repondu : un
       filtre qui ne peut rien trouver ne doit pas s'afficher. */
    if (etat.arriveesJour) {
      var na = etat.conversations.filter(arriveAujourdhui).length;
      if (na) {
        barre.appendChild(puce('Arrivées du jour \\u00b7 ' + na, etat.filtre === 'arrivees', function () {
          etat.filtre = 'arrivees'; etat.logement = ''; dessiner();
        }));
      }
    }

    var noms = logements();
    if (noms.length > 1) {
      var sel = document.createElement('select');
      sel.style.cssText = 'flex:none;font-size:13.5px;font-weight:600;border-radius:999px'
        + ';padding:9px 14px;min-height:38px;font-family:inherit;cursor:pointer'
        + ';background:' + (etat.logement ? VERT : '#fff')
        + ';color:' + (etat.logement ? '#fff' : ENCRE)
        + ';border:1px solid ' + (etat.logement ? VERT : BORD);
      var o0 = document.createElement('option');
      o0.value = ''; o0.textContent = 'Par logement';
      sel.appendChild(o0);
      noms.forEach(function (n) {
        var o = document.createElement('option');
        o.value = n; o.textContent = n;
        if (n === etat.logement) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', function () {
        etat.logement = sel.value;
        if (etat.logement) etat.filtre = 'tous';
        dessiner();
      });
      barre.appendChild(sel);
    }
    hote.appendChild(barre);

    var l = filtrees();
    var carte = document.createElement('div');
    carte.style.cssText = 'background:#fff;border:1px solid ' + BORD + ';border-radius:16px;overflow:hidden';
    if (!l.length) {
      var v = document.createElement('div');
      v.textContent = etat.filtre === 'non_lus' ? 'Tout est lu.'
        : (etat.logement ? 'Aucune conversation pour ce logement.' : 'Aucune conversation.');
      v.style.cssText = 'padding:26px 16px;text-align:center;font-size:14px;color:' + GRIS;
      carte.appendChild(v);
    } else {
      l.forEach(function (c, i) { carte.appendChild(ligne(c, i === l.length - 1)); });
    }
    hote.appendChild(carte);

    /* Le bandeau ne s'affiche que si le chiffre existe. */
    if (etat.ia && typeof etat.ia.reponses === 'number') {
      var b = document.createElement('div');
      b.style.cssText = 'margin-top:14px;background:' + VERT + ';border-radius:16px;padding:15px 17px';
      var t1 = document.createElement('div');
      t1.textContent = "L'IA répond 24 h/24";
      t1.style.cssText = 'font-size:15px;font-weight:700;color:#fff;letter-spacing:-.01em';
      var t2 = document.createElement('div');
      t2.textContent = etat.ia.reponses + ' réponse' + (etat.ia.reponses > 1 ? 's' : '') + ' ces sept derniers jours';
      t2.style.cssText = 'font-size:13px;color:#BFD3C7;margin-top:2px';
      b.appendChild(t1); b.appendChild(t2);
      hote.appendChild(b);
    }
  }

  /* ── La place, et l'ancienne liste ──────────────────────────── */

  function ancienne() { return document.getElementById('conversationsList'); }

  function poser() {
    if (etat.pose) return true;
    var vieille = ancienne();
    if (!vieille || !vieille.parentElement) { etat.erreur = 'liste d origine introuvable'; return false; }

    var hote = document.createElement('div');
    hote.id = 'bhMessagesListe';
    hote.style.cssText = 'font-family:inherit;padding:4px 12px 24px';
    vieille.parentElement.insertBefore(hote, vieille);

    mem.push({ el: vieille, valeur: vieille.style.getPropertyValue('display'), priorite: vieille.style.getPropertyPriority('display') });
    vieille.style.setProperty('display', 'none', 'important');

    etat.pose = true;
    return true;
  }

  /* ── Les donnees ────────────────────────────────────────────── */

  function charger() {
    var t = jeton();
    if (!t) { etat.erreur = 'aucun jeton en memoire'; return; }
    var entetes = { Authorization: 'Bearer ' + t };

    fetch('/api/chat/conversations', { headers: entetes })
      .then(function (r) { if (!r.ok) throw new Error('conversations (' + r.status + ')'); return r.json(); })
      .then(function (d) {
        var l = d.conversations || [];
        l.sort(function (a, b) {
          return new Date(b.last_message_time || b.created_at || 0)
               - new Date(a.last_message_time || a.created_at || 0);
        });
        etat.conversations = l;
        if (poser()) dessiner();
      })
      .catch(function (e) { etat.erreur = e.message; });

    /* Les arrivees du jour : la meme route que l'ecran Aujourd'hui. */
    fetch('/api/aujourdhui/etats', { headers: entetes })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !Array.isArray(d.arrivees)) return;
        etat.arriveesJour = d.arrivees
          .map(function (a) { return String(a.conversation_id); })
          .filter(Boolean);
        if (etat.pose) dessiner();
      })
      .catch(function () { /* filtre simplement absent */ });

    fetch('/api/ia/semaine', { headers: entetes })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) { etat.ia = d; if (etat.pose) dessiner(); } })
      .catch(function () { /* bandeau simplement absent */ });
  }

  window.bhAnnulerMessages = function () {
    var hote = document.getElementById('bhMessagesListe');
    if (hote) hote.remove();
    for (var i = mem.length - 1; i >= 0; i--) {
      var m = mem[i];
      if (m.valeur) m.el.style.setProperty('display', m.valeur, m.priorite);
      else m.el.style.removeProperty('display');
    }
    var n = mem.length;
    mem = [];
    etat.pose = false;
    console.log('Liste d origine rendue (' + n + ' changement(s)).');
    return n;
  };

  window.bhVerifMessages = function () {
    var res = {
      affichee: !!document.getElementById('bhMessagesListe'),
      conversations: etat.conversations.length,
      non_lues: etat.conversations.filter(function (c) { return nonLus(c) > 0; }).length,
      arrivees_du_jour: etat.arriveesJour ? etat.arriveesJour.length : 'route muette',
      ia_semaine: etat.ia ? etat.ia.reponses : 'route muette',
      filtre: etat.filtre,
      logement: etat.logement || '(tous)',
      ancienne_endormie: !!(ancienne() && getComputedStyle(ancienne()).display === 'none'),
      erreur: etat.erreur
    };
    console.log('── Messages ──');
    console.log(res);
    if (!res.affichee) console.warn('Non affichee : ' + (etat.erreur || 'en attente'));
    console.log('Pour revenir en arriere : bhAnnulerMessages()');
    return res;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(charger, 900); });
  } else {
    setTimeout(charger, 900);
  }
  setTimeout(charger, 3000);
})();
`;

try { new Function(SOURCE); } catch (e) { echec('Le module ne serait pas valide — ' + e.message); }
['bhAnnulerMessages', 'bhVerifMessages', 'arriveAujourdhui', '/api/ia/semaine'].forEach(function (t) {
  if (SOURCE.indexOf(t) === -1) echec('Verification : ' + t + ' absent du module.');
});

/* ============================================================
   3. LA BALISE
   ============================================================ */

const BALISE = '<script src="js/bh-messages-liste.js"></script>';
let html = fs.readFileSync(PAGE, 'utf8');
let etatPage;

if (html.indexOf('bh-messages-liste.js') !== -1) {
  etatPage = 'balise deja presente';
} else {
  const ancre = html.lastIndexOf('</body>');
  if (ancre === -1) echec('</body> introuvable dans messages.html.');
  html = html.slice(0, ancre) + BALISE + '\n' + html.slice(ancre);
  etatPage = 'balise ajoutee avant </body>';
}

/* ============================================================
   Ecriture, tout ou rien
   ============================================================ */

if (!ESSAI) {
  const sauvegarde = SERVEUR + '.avant-ia-semaine';
  if (etatServeur !== 'deja applique' && !fs.existsSync(sauvegarde)) {
    fs.writeFileSync(sauvegarde, fs.readFileSync(SERVEUR));
  }
  fs.writeFileSync(SERVEUR, srv, 'utf8');
  fs.writeFileSync(MODULE, SOURCE, 'utf8');
  fs.writeFileSync(PAGE, html, 'utf8');

  if (fs.readFileSync(SERVEUR, 'utf8').indexOf("app.get('/api/ia/semaine'") === -1) {
    echec("La route n'est pas dans server.js apres ecriture.");
  }
  const relu = fs.readFileSync(MODULE, 'utf8');
  if (relu.indexOf('bhAnnulerMessages') === -1) echec("Le module n'est pas complet apres ecriture.");
  try { new Function(relu); } catch (e) { echec('Module invalide apres ecriture — ' + e.message); }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  server.js                        ' + etatServeur);
console.log('  public/js/bh-messages-liste.js   (' + Math.round(SOURCE.length / 1024) + ' Ko)');
console.log('  messages.html                    ' + etatPage);
if (!ESSAI && etatServeur !== 'deja applique') {
  console.log('  Sauvegarde : server.js.avant-ia-semaine (ne pas commiter)');
}
console.log('\n  La liste est reconstruite et #conversationsList endormi :');
console.log('  chat-owner.js continue de peupler son conteneur masque, on ne');
console.log('  lui dispute pas le DOM. Un clic appelle openChat(id) — votre');
console.log('  fonction, y compris la redirection mobile.');
console.log('\n  « Arrivees du jour » croise /api/aujourdhui/etats : la meme');
console.log('  verite que l\'ecran Aujourd\'hui, vos reservations directes');
console.log('  comprises. Si la route se tait, le filtre ne s\'affiche pas.');
console.log('\n  Le bandeau IA compte les messages is_bot_response sur sept');
console.log('  jours. Pas de « 1 escalade » : rien dans votre schema n\'en');
console.log('  enregistre. Le mot est dans vos pages de presentation, pas');
console.log('  dans vos donnees.');
console.log('\n  A verifier apres deploiement, cache vide : /messages.html');
console.log('    bhVerifMessages()');
console.log('  J\'attends conversations > 0, arrivees_du_jour = 8 aujourd\'hui,');
console.log('  et ia_semaine avec un nombre. « route muette » sur l\'un des');
console.log('  deux me dira lequel regarder.');
console.log('\n  Annulation : bhAnnulerMessages()\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
