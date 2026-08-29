#!/usr/bin/env node
/* ============================================================
   outils/etat-logement-vendable.js
   Dire si un logement est reellement ouvert a la vente
   ============================================================
   Cibles : server.js
            public/js/bh-ota-connect.js

   ── LE CONSTAT ──────────────────────────────────────────────────
   « Connecte » ne veut pas dire « vendable ». Un logement peut etre
   relie a Booking.com et rester ferme a la reservation — c'est arrive
   sur La longere n° 3, et il a fallu trois jours et une commande tapee
   dans la console pour comprendre que les tarifs n'etaient jamais
   partis.

   Le meme angle mort s'est repete toute la semaine :
     · disponibilites poussees, tarifs jamais envoyes ;
     · compte Stripe du proprietaire inacheve, cautions rejetees ;
     · logement sans prix de base, donc invendable par construction.

   A chaque fois, l'information EXISTAIT en base. Elle n'etait affichee
   nulle part.

   ── CE QUE FAIT CE CORRECTIF ────────────────────────────────────
   1. Une route GET /api/properties/:id/sante qui repond a une seule
      question — ce logement est-il vendable — et, sinon, pourquoi :

        · l'annonce est-elle reliee (property + room type Channex) ;
        · le calendrier est-il parti (dernier push_availability reussi
          dans channex_logs — la seule preuve qu'un envoi a abouti) ;
        · les tarifs sont-ils partis (push_rates reussi ET prix de base
          renseigne : les deux sont necessaires) ;
        · le lien de caution peut-il etre cree (compte Stripe reellement
          en etat d'encaisser).

   2. Un bloc en tete de l'ecran de connexion qui affiche ces points,
      avec le bouton qui repare a cote. Quand tout va bien, une seule
      ligne verte : « Ce logement est ouvert a la vente. »

   3. Un envoi « calendrier + tarifs » en un geste. La sequence existante
      importait les reservations et poussait les disponibilites, mais
      jamais les tarifs — d'ou des logements connectes et fermes.

   ── POURQUOI CETTE FORME ────────────────────────────────────────
   Le produit ne demande plus a l'utilisateur de verifier que ca a
   marche : il verifie et il le dit. C'est le principe de la maquette
   « Connexion des plateformes », etat 2d.

   ── PRUDENCE ────────────────────────────────────────────────────
   · La verification Stripe n'est faite que si compteStripeUtilisable
     existe (correctif outils/stripe-repli-compte-inactif.js). Sinon le
     point est passe, pas invente.
   · Une erreur de lecture ne fait jamais conclure a un probleme : dans
     le doute, le point est considere comme bon. Un faux negatif ferait
     paniquer pour rien.
   · Aucun ecran existant n'est retire : le bloc s'ajoute au-dessus.

   Usage :
     node outils/etat-logement-vendable.js --essai
     node outils/etat-logement-vendable.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const SRV = path.join(process.cwd(), 'server.js');
const OTA = path.join(process.cwd(), 'public', 'js', 'bh-ota-connect.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

for (const f of [SRV, OTA]) {
  if (!fs.existsSync(f)) echec(f + ' introuvable. Lancez depuis la racine du projet.');
}
let srv = fs.readFileSync(SRV, 'utf8');
let ota = fs.readFileSync(OTA, 'utf8');

if (srv.indexOf("/api/properties/:property_id/sante") !== -1) {
  console.log('\n  Le correctif est deja en place — rien a faire.\n');
  process.exit(0);
}

function remplacer(source, avant, apres, quoi) {
  const n = source.split(avant).length - 1;
  if (n !== 1) echec(quoi + ' : ' + n + " occurrence(s) au lieu d'une. Le fichier a change.");
  return source.split(avant).join(apres);
}

const ROUTE = "\n// ── État réel d'un logement : est-il vendable, et sinon pourquoi ? ──\n// Chaque point correspond a une panne rencontree en production et restee\n// muette : disponibilites jamais poussees, tarifs absents (« Tarif ferme »\n// chez Booking), compte Stripe du proprietaire inutilisable. L'information\n// existait deja en base — elle n'etait affichee nulle part.\napp.get('/api/properties/:property_id/sante', authenticateAny, async (req, res) => {\n  try {\n    const { property_id } = req.params;\n    const agencyIds = await getAgencyUserIds(req, req.user.id);\n    const pr = await pool.query(\n      `SELECT id, name, base_price, deposit_amount, channex_enabled, channex_property_id,\n              channex_room_type_id, channex_rate_plan_id\n         FROM properties WHERE id = $1 AND user_id = ANY($2::text[])`,\n      [property_id, agencyIds]\n    );\n    const p = pr.rows[0];\n    if (!p) return res.status(404).json({ error: 'Logement introuvable' });\n\n    // Dernier evenement d'un type donne. Le journal channex_logs est la\n    // seule preuve qu'un envoi a REELLEMENT abouti.\n    const dernier = async (types) => {\n      const r = await pool.query(\n        `SELECT event_type, status, created_at FROM channex_logs\n            WHERE property_id = $1 AND event_type = ANY($2::text[])\n            ORDER BY created_at DESC LIMIT 1`,\n        [property_id, types]\n      ).catch(() => ({ rows: [] }));\n      return r.rows[0] || null;\n    };\n\n    const points = [];\n    const relie = !!(p.channex_enabled && p.channex_property_id && p.channex_room_type_id);\n    points.push({ cle: 'relie', ok: relie, titre: \"L'annonce est reliée\",\n      details: relie ? null : \"Ce logement n'est connecté à aucune plateforme.\" });\n\n    if (relie) {\n      const dispo = await dernier(['push_availability']);\n      const okDispo = !!(dispo && dispo.status === 'success');\n      points.push({ cle: 'calendrier', ok: okDispo,\n        titre: okDispo ? 'Calendrier envoyé' : 'Calendrier jamais envoyé',\n        quand: dispo ? dispo.created_at : null,\n        details: okDispo ? null : 'Vos dates ne sont pas parties : le logement reste fermé à la réservation.',\n        action: okDispo ? null : 'envoyer' });\n\n      // Un plan tarifaire sans prix de base ne peut rien envoyer : les deux\n      // conditions sont necessaires, et le message differe.\n      const prix = Number(p.base_price || 0) > 0;\n      const tarifs = await dernier(['push_rates', 'push_restrictions']);\n      const okTarifs = prix && !!(tarifs && tarifs.status === 'success');\n      points.push({ cle: 'tarifs', ok: okTarifs,\n        titre: okTarifs ? 'Tarifs envoyés' : (prix ? 'Aucun tarif envoyé' : 'Aucun prix de base'),\n        quand: tarifs ? tarifs.created_at : null,\n        details: okTarifs ? null : (prix\n          ? 'Les plateformes affichent « Tarif fermé » : le logement est visible mais personne ne peut réserver.'\n          : 'Sans prix de base, aucun tarif ne peut partir — le logement restera fermé à la vente.'),\n        action: okTarifs ? null : (prix ? 'envoyer' : 'prix') });\n    }\n\n    if (Number(p.deposit_amount || 0) > 0) {\n      let cautionOk = true, pourquoi = null;\n      try {\n        const cible = await getStripeForProperty(pool, property_id, req.user.id);\n        if (cible.stripeAccountId && typeof compteStripeUtilisable === 'function') {\n          cautionOk = await compteStripeUtilisable(cible.stripeAccountId);\n          if (!cautionOk) pourquoi = \"Le compte Stripe rattaché ne peut pas encaisser : son inscription n'est pas terminée.\";\n        }\n      } catch (e) { cautionOk = true; }   // dans le doute, on n'accuse pas\n      points.push({ cle: 'caution', ok: cautionOk,\n        titre: cautionOk ? 'Le lien de caution fonctionne' : 'Le lien de caution ne peut pas être créé',\n        details: pourquoi, action: cautionOk ? null : 'stripe' });\n    }\n\n    const aRegler = points.filter((x) => !x.ok).length;\n    res.json({ property_id, nom: p.name, relie, vendable: relie && aRegler === 0, a_regler: aRegler, points });\n  } catch (e) {\n    console.error('[sante]', e.message);\n    res.status(500).json({ error: 'Vérification impossible' });\n  }\n});\n";
const SANTE_FN = "\n  /* ── L'etat reel du logement, avant la liste des plateformes ──────────\n     « Connecte » ne veut pas dire « vendable ». Un logement peut etre relie\n     a Booking et rester ferme a la reservation faute de tarifs envoyes —\n     c'est arrive, et rien ne le disait. Ce bloc affiche ce que le serveur\n     constate, avec l'action qui repare a cote. */\n  function renduSante(d) {\n    if (!d || !d.points || !d.points.length) return '';\n    if (d.vendable) {\n      return '<div style=\"background:' + V.vertPale + ';border:1px solid ' + V.vertFilet + ';border-radius:12px;' +\n        'padding:13px 15px;display:flex;align-items:center;gap:11px;\">' +\n        '<span style=\"color:' + V.vertClair + ';font-size:14px;flex:none;\">\\u2713</span>' +\n        '<span style=\"font-size:13px;color:' + V.vert + ';line-height:1.5;\">' +\n        '<strong style=\"font-weight:600;\">Ce logement est ouvert a la vente.</strong> ' +\n        'Calendrier et tarifs sont partis vers vos plateformes.</span></div>';\n    }\n\n    var lignes = d.points.map(function (pt) {\n      var couleur = pt.ok ? '#2E8B62' : V.or;\n      var quand = pt.quand\n        ? '<span style=\"display:block;font-size:11.5px;color:' + V.t4 + ';margin-top:2px;\">' +\n          esc(new Date(pt.quand).toLocaleDateString('fr-FR', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })) + '</span>'\n        : '';\n      var bouton = '';\n      if (!pt.ok && pt.action) {\n        var libelle = pt.action === 'prix' ? 'Fixer mon prix'\n          : pt.action === 'stripe' ? 'Verifier le compte'\n          : 'Envoyer maintenant';\n        bouton = '<button type=\"button\" onclick=\"window._bhSante(\\'' + pt.action + '\\')\" ' +\n          'style=\"border:1px solid ' + V.orFilet + ';background:#fff;color:' + V.or + ';font-family:' + V.sans + ';' +\n          'font-size:12.5px;font-weight:600;padding:7px 12px;border-radius:8px;cursor:pointer;white-space:nowrap;flex:none;\">' +\n          libelle + '</button>';\n      }\n      return '<div style=\"display:flex;align-items:flex-start;gap:11px;padding:11px 0;border-bottom:1px solid ' + V.ligne2 + ';\">' +\n        '<span style=\"color:' + couleur + ';font-size:13px;flex:none;margin-top:2px;\">' + (pt.ok ? '\\u2713' : '\\u2715') + '</span>' +\n        '<span style=\"flex:1;\">' +\n        '<span style=\"display:block;font-size:13.5px;font-weight:' + (pt.ok ? '400' : '600') + ';color:' + V.encre + ';\">' + esc(pt.titre) + '</span>' +\n        (pt.details ? '<span style=\"display:block;font-size:12.5px;color:' + V.or + ';margin-top:3px;line-height:1.5;\">' + esc(pt.details) + '</span>' : '') +\n        quand + '</span>' + bouton + '</div>';\n    }).join('');\n\n    return '<div style=\"background:#fff;border:1px solid ' + V.orFilet + ';border-radius:12px;overflow:hidden;\">' +\n      '<div style=\"padding:13px 15px 4px;\">' +\n      '<span style=\"font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:' + V.or + ';\">' +\n      (d.a_regler > 1 ? d.a_regler + ' choses a regler' : 'Une chose a regler') + '</span></div>' +\n      '<div style=\"padding:0 15px 6px;\">' + lignes + '</div></div>';\n  }\n\n  /* Les actions de reparation. « Envoyer » couvre calendrier et tarifs :\n     les deux partent ensemble, et l'utilisateur n'a pas a savoir lequel\n     manquait. */\n  window._bhSante = async function (action) {\n    if (action === 'prix') {\n      document.getElementById('channexModal')?.remove();\n      if (typeof openEditPropertyModal === 'function') openEditPropertyModal(window._bhSantePid);\n      return;\n    }\n    if (action === 'stripe') { window.location.href = '/settings-account.html'; return; }\n    if (typeof window._bhEnvoyerTout === 'function') window._bhEnvoyerTout();\n  };\n";
const ENVOYER = "    /* Calendrier ET tarifs. La sequence _bhEnvoyer ci-dessous importe les\n       reservations puis pousse les disponibilites, mais jamais les tarifs :\n       or un logement sans tarif reste ferme a la vente, ce que rien\n       n'indiquait. */\n    window._bhEnvoyerTout = async function () {\n      modal.innerHTML = carte(430,\n        '<div style=\"padding:38px 30px;text-align:center;\">' +\n        '<div style=\"width:22px;height:22px;margin:0 auto;border:2px solid ' + V.ligne +\n        ';border-top-color:' + V.vert + ';border-radius:50%;animation:bhspin .8s linear infinite;\"></div>' +\n        '<div style=\"margin-top:16px;font-size:14px;color:' + V.encre + ';\">Envoi du calendrier et des tarifs\\u2026</div>' +\n        '<div style=\"margin-top:6px;font-size:12.5px;color:' + V.t3 + ';\">Ne fermez pas cette fen\\u00eatre.</div></div>');\n      var appel = function (url) {\n        return fetch(API_URL + url, {\n          method: 'POST',\n          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },\n          body: '{}'\n        }).then(function (r) { return { ok: r.ok, statut: r.status }; })\n          .catch(function () { return { ok: false, statut: 0 }; });\n      };\n      var dispo = await appel('/api/channex/push-availability/' + pid);\n      var tarifs = await appel('/api/pricing/rules/push-channex/' + pid);\n      var bilan = [];\n      bilan.push(dispo.ok ? 'calendrier envoy\\u00e9' : 'calendrier : \\u00e9chec');\n      bilan.push(tarifs.ok ? 'tarifs envoy\\u00e9s'\n        : (tarifs.statut === 403 ? 'tarifs non envoy\\u00e9s (droit \\u00ab gestion des prix \\u00bb requis)' : 'tarifs : \\u00e9chec'));\n      var toutOk = dispo.ok && tarifs.ok;\n      modal.innerHTML = carte(470,\n        entete(null, toutOk ? 'C\\'est parti' : 'Envoi incomplet', esc(pname)) +\n        '<div style=\"padding:20px 24px;font-size:14px;color:' + V.t2 + ';line-height:1.65;\">' +\n        esc(bilan.join(' \\u00b7 ')) +\n        (toutOk ? '<span style=\"display:block;margin-top:10px;\">Comptez quelques minutes avant que les plateformes ouvrent les dates.</span>' : '') +\n        '</div>' +\n        pied('', btnPlein('Revoir l\\'\\u00e9tat', 'window._bhRevoirSante()')));\n      window._bhRevoirSante = function () { ecranPlateformes(modal, pid, pname); };\n      if (typeof loadProperties === 'function') loadProperties().catch(function () {});\n    };\n";
const FETCH = "    /* L'etat reel avant la liste : « connecte » ne veut pas dire « vendable ». */\n    window._bhSantePid = pid;\n    var blocSante = '';\n    try {\n      var rSante = await fetch(API_URL + '/api/properties/' + pid + '/sante',\n        { headers: { Authorization: 'Bearer ' + token() } });\n      if (rSante.ok) blocSante = renduSante(await rSante.json());\n    } catch (eSante) {}\n";

const A_ROUTE = "app.get('/api/channex/connected-channels/:property_id', authenticateToken, async (req, res) => {";
const A_FN = "  /* ── écran 1 : les plateformes de CE logement ───────────────────────────── */\n  async function ecranPlateformes(modal, pid, pname) {";
const A_FETCH = "    var voisin = voisinConnecte(pid);\n    var lignes = PLATEFORMES.map(function (p) {";
const A_HTML = "      '<div style=\"padding:18px 24px;display:flex;flex-direction:column;gap:12px;\">' + noteAdresse + noteRegroupement + noteImmeuble + lignes + '</div>' +";
const A_ENV = "    window._bhEnvoyer = async function () {";

srv = remplacer(srv, A_ROUTE, ROUTE + A_ROUTE, 'La route connected-channels (point d\'insertion)');
ota = remplacer(ota, A_FN, SANTE_FN + A_FN, 'La declaration de ecranPlateformes');
ota = remplacer(ota, A_FETCH, FETCH + A_FETCH, 'La construction de la liste des plateformes');
ota = remplacer(ota, A_HTML, "      '<div style=\"padding:18px 24px;display:flex;flex-direction:column;gap:12px;\">' + blocSante + noteAdresse + noteRegroupement + noteImmeuble + lignes + '</div>' +", 'Le corps de la modale');
ota = remplacer(ota, A_ENV, ENVOYER + A_ENV, 'La sequence d\'envoi');

/* ---- Verifications ---- */
try { new Function(srv); }
catch (e) { echec("server.js n'est plus du JavaScript valide — " + e.message); }
try { new Function(ota); }
catch (e) { echec("bh-ota-connect.js n'est plus du JavaScript valide — " + e.message); }

const controles = [
  ['la route', "app.get('/api/properties/:property_id/sante'", srv],
  ['la lecture du journal Channex', 'FROM channex_logs', srv],
  ['le point tarifs', "cle: 'tarifs'", srv],
  ['le point caution', "cle: 'caution'", srv],
  ['le rendu', 'function renduSante(d)', ota],
  ['son appel', 'blocSante = renduSante(await rSante.json())', ota],
  ['son insertion', "' + blocSante + noteAdresse", ota],
  ['l\'envoi complet', 'window._bhEnvoyerTout = async function', ota],
  ['les tarifs dans l\'envoi', '/api/pricing/rules/push-channex/', ota],
];
for (const [quoi, aiguille, ou] of controles) {
  if (ou.indexOf(aiguille) === -1) echec('Verification : ' + quoi + ' est absent du resultat.');
}

/* La route ne doit pas ecrire. */
if (/\b(INSERT|UPDATE|DELETE)\b/.test(ROUTE)) echec('La route de verification contient une ecriture.');
/* L'ecran d'origine doit rester entier. */
if (ota.indexOf('window._bhEnvoyer = async function') === -1) echec("La sequence d'envoi d'origine a disparu.");
if (ota.indexOf('noteAdresse + noteRegroupement + noteImmeuble + lignes') === -1) echec('Le corps de la modale a ete altere.');

if (!ESSAI) {
  fs.writeFileSync(SRV, srv, 'utf8');
  fs.writeFileSync(OTA, ota, 'utf8');
  if (fs.readFileSync(SRV, 'utf8').indexOf('/api/properties/:property_id/sante') === -1) {
    echec("L'ajout est absent apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Route GET /api/properties/:id/sante — lecture seule.');
console.log('  Ecran de connexion : l\'etat reel du logement s\'affiche en tete,');
console.log('  avec le bouton qui repare a cote de chaque point bloquant.');
console.log('  Nouvel envoi groupe : calendrier ET tarifs.');
console.log('');
console.log('  Redemarrez le serveur, puis \u2318\u21e7R.');
console.log('  Ouvrez « Connecter mes plateformes » sur La longere n\u00b0 3 :');
console.log('  vous devez lire son etat avant toute autre chose.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
