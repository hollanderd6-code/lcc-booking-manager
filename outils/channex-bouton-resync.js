#!/usr/bin/env node
/* ============================================================
   outils/channex-bouton-resync.js
   Un bouton « Resynchroniser les plateformes »
   ============================================================
   Cible : public/js/settings.js

   ── POURQUOI ────────────────────────────────────────────────────
   Un logement connecte a Channex peut rester invendable sans que rien
   ne le signale : c'est arrive sur « La longere numero 3 », affichee
   « Tarif ferme » chez Booking pendant des jours. La cause etait que
   la connexion n'envoyait jamais les tarifs (corrige par
   outils/channex-tarifs-connexion.js) — mais pour les logements deja
   connectes, aucun moyen de rattraper depuis l'interface.

   Il a fallu appeler a la main
   POST /api/pricing/rules/push-channex/:id
   depuis la console du navigateur. Reponse : « 500 jours de tarifs
   synchronises ». Un client n'aurait jamais trouve.

   Trois routes de synchronisation existent pourtant sous /api/channex
   (disponibilites, restrictions, revisions) — mais AUCUNE pour les
   tarifs : celle qui fait ce travail est rangee sous /api/pricing, et
   rien n'y mene depuis la fiche d'un logement.

   ── CE QUE FAIT CE CORRECTIF ────────────────────────────────────
   Ajoute, sous « Importer l'historique des reservations », un bouton
   « Resynchroniser les plateformes » qui envoie les deux choses qu'une
   plateforme attend :
     · les disponibilites  (POST /api/channex/sync-availability/:id)
     · les tarifs          (POST /api/pricing/rules/push-channex/:id)

   Et qui DIT ce qui s'est passe : « disponibilites envoyees · 500 jours
   de tarifs envoyes ». Si le serveur renvoie zero jour de tarifs, un
   avertissement invite a verifier le prix de base — c'est la cause la
   plus frequente d'un logement ferme.

   Aucune route serveur nouvelle : on reutilise l'existant. C'est
   volontaire — la route des tarifs exige la permission
   can_manage_pricing, et un sous-compte qui n'a pas le droit de toucher
   aux prix ne doit pas les pousser. Ce cas est traite : les
   disponibilites partent quand meme, et le message le precise au lieu
   d'afficher un echec incomprehensible.

   Le bouton est ajoute aux DEUX rendus de la carte (liste complete et
   liste filtree par groupe), avec leurs deux gestionnaires de clic.

   Usage :
     node outils/channex-bouton-resync.js --essai
     node outils/channex-bouton-resync.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'js', 'settings.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('public/js/settings.js introuvable. Lancez depuis la racine du projet.');
let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('resyncOtaPlateformes') !== -1) {
  console.log('\n  Le bouton est deja en place — rien a faire.\n');
  process.exit(0);
}

function unique(aiguille, quoi) {
  const n = src.split(aiguille).length - 1;
  if (n !== 1) echec(quoi + ' : ' + n + ' occurrence(s) au lieu d\'une. settings.js a change.');
}

/* ── 1. Le bouton, dans les deux rendus de la carte ──
   Les deux blocs sont identiques a l'indentation pres : la liste
   complete est indentee de 12 espaces, la liste filtree de 10. */
const bouton = (ind) => '<button type="button" class="btn-resync-ota" data-id="${escapeHtml(id)}" title="Renvoyer disponibilités et tarifs aux plateformes" style="width:100%;margin-bottom:8px;padding:4px 10px;background:#f0fdf8;border:1px solid #b8ddd4;border-radius:6px;cursor:pointer;display:flex;align-items:center;gap:5px;font-size:10px;color:#0E3B2E;font-weight:600;">\n'
  + ind + '  <i class="fas fa-rotate" style="font-size:10px;"></i>\n'
  + ind + '  <span>Resynchroniser les plateformes</span>\n'
  + ind + '</button>';

const A12 = "<span>Importer l'historique des réservations</span>\n            </button>";
const A10 = "<span>Importer l'historique des réservations</span>\n          </button>";
unique(A12, 'Bouton d\'import (liste complete)');
unique(A10, 'Bouton d\'import (liste filtree)');
src = src.split(A12).join(A12 + '\n            ' + bouton('            '));
src = src.split(A10).join(A10 + '\n          ' + bouton('          '));

/* ── 2. Les gestionnaires de clic, dans les deux rendus ──
   Ils s'ecrivent differemment : « forEach((btn) => » d'un cote,
   « forEach(btn => » de l'autre. */
const H1 = '  grid.querySelectorAll(".btn-sync-bookings").forEach((btn) => {\n'
  + '    btn.addEventListener("click", () => syncChannexBookings(btn.getAttribute("data-id"), btn));\n  });';
const H2 = '  grid.querySelectorAll(".btn-sync-bookings").forEach(btn => {\n'
  + '    btn.addEventListener("click", () => syncChannexBookings(btn.getAttribute("data-id"), btn));\n  });';
unique(H1, 'Gestionnaire de clic (liste complete)');
unique(H2, 'Gestionnaire de clic (liste filtree)');
const ecouteur = (forme) => forme + '\n\n  grid.querySelectorAll(".btn-resync-ota").forEach((btn) => {\n'
  + '    btn.addEventListener("click", () => resyncOtaPlateformes(btn.getAttribute("data-id"), btn));\n  });';
src = src.split(H1).join(ecouteur(H1));
src = src.split(H2).join(ecouteur(H2));

/* ── 3. La fonction ── */
const ANCRE_FN = 'async function loadConnectedChannels(propertyId, containerId) {';
unique(ANCRE_FN, 'Declaration de loadConnectedChannels');
const FONCTION = "/* ── Resynchroniser un logement vers les plateformes ──────────────\n   Renvoie les DEUX choses qu'une plateforme attend : les disponibilites\n   et les tarifs. Jusqu'ici la connexion n'envoyait que les\n   disponibilites — or un plan tarifaire sans prix reste ferme a la vente\n   (Booking affiche « Tarif ferme »), sans que rien ne le signale.\n\n   Deux routes distinctes, car elles existent deja et portent des droits\n   differents : la tarification demande la permission can_manage_pricing.\n   Un compte sans ce droit synchronise donc les disponibilites, et on le\n   lui dit clairement plutot que d'echouer en silence. */\nasync function resyncOtaPlateformes(propertyId, btn) {\n  const original = btn.innerHTML;\n  btn.disabled = true;\n  btn.innerHTML = '<i class=\"fas fa-spinner fa-spin\" style=\"font-size:10px;\"></i><span>Synchronisation...</span>';\n  const token = localStorage.getItem('lcc_token');\n  const appel = async (url) => {\n    const r = await fetch(`${API_URL}${url}`, {\n      method: 'POST',\n      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },\n      body: '{}'\n    });\n    let d = {};\n    try { d = await r.json(); } catch (e) {}\n    return { ok: r.ok, statut: r.status, data: d };\n  };\n\n  try {\n    const dispo = await appel(`/api/channex/sync-availability/${propertyId}`);\n    const tarifs = await appel(`/api/pricing/rules/push-channex/${propertyId}`);\n\n    const bilan = [];\n    bilan.push(dispo.ok ? 'disponibilités envoyées' : 'disponibilités : ' + (dispo.data.error || 'échec'));\n    if (tarifs.ok) {\n      // Le serveur repond « N jours de tarifs + M jours de restrictions ».\n      const n = String(tarifs.data.message || '').match(/^(\\d+)/);\n      bilan.push(n ? n[1] + ' jours de tarifs envoyés' : 'tarifs envoyés');\n      if (n && n[1] === '0') {\n        showToast(\"Aucun tarif à envoyer : vérifiez le prix de base du logement.\", 'warning');\n      }\n    } else if (tarifs.statut === 403) {\n      bilan.push(\"tarifs non envoyés (droit « gestion des prix » requis)\");\n    } else {\n      bilan.push('tarifs : ' + (tarifs.data.error || 'échec'));\n    }\n\n    const toutOk = dispo.ok && tarifs.ok;\n    showToast((toutOk ? '✅ ' : '⚠️ ') + bilan.join(' · '), toutOk ? 'success' : 'warning');\n    btn.innerHTML = toutOk\n      ? '<i class=\"fas fa-check\" style=\"font-size:10px;\"></i><span>Synchronisé</span>'\n      : original;\n    btn.disabled = !toutOk;\n    /* Les plateformes mettent quelques minutes a repercuter : rendre le\n       bouton a son etat initial evite que l'utilisateur croie l'ecran fige. */\n    if (toutOk) setTimeout(() => { btn.innerHTML = original; btn.disabled = false; }, 6000);\n  } catch (e) {\n    showToast('Erreur de synchronisation : ' + e.message, 'error');\n    btn.innerHTML = original;\n    btn.disabled = false;\n  }\n}\n\n";
src = src.split(ANCRE_FN).join(FONCTION + ANCRE_FN);

/* ---- Verifications ---- */
try { new Function(src); }
catch (e) { echec('settings.js n\'est plus du JavaScript valide — ' + e.message); }

if (src.split('class="btn-resync-ota"').length - 1 !== 2) echec('Le bouton n\'a pas ete ajoute aux deux rendus.');
if (src.split('.btn-resync-ota").forEach').length - 1 !== 2) echec('Les deux gestionnaires de clic ne sont pas en place.');
if (src.split('async function resyncOtaPlateformes').length - 1 !== 1) echec('La fonction est absente ou en double.');
for (const [quoi, aiguille] of [
  ['l\'envoi des disponibilites', '/api/channex/sync-availability/'],
  ['l\'envoi des tarifs', '/api/pricing/rules/push-channex/'],
  ['le cas du droit manquant', 'can_manage_pricing'],
  ['l\'avertissement zero tarif', "Aucun tarif à envoyer"],
]) if (src.indexOf(aiguille) === -1) echec('Verification : ' + quoi + ' est absent du resultat.');
/* Le bouton d'import existant ne doit pas avoir bouge. */
if (src.split('class="btn-sync-bookings"').length - 1 !== 2) echec('Le bouton d\'import a ete altere.');

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('resyncOtaPlateformes') === -1) {
    echec('L\'ajout est absent apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Carte du logement : bouton « Resynchroniser les plateformes ».');
console.log('  Il envoie les disponibilites ET les tarifs, puis affiche le bilan.');
console.log('  Present dans les deux rendus (liste complete et liste filtree).');
console.log('');
console.log('  Ensuite : ⌘⇧R sur Boostinghost (settings.js est mis en cache).');
console.log('');
console.log('  Essayez sur un logement connecte : vous devez lire quelque chose comme');
console.log('  « disponibilites envoyees · 500 jours de tarifs envoyes ».');
console.log('  « 0 jours de tarifs » signale un logement sans prix de base.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
