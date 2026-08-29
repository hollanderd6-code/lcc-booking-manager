#!/usr/bin/env node
/* ============================================================
   outils/maintenance-marquer-traite.js
   Un ticket de degradation ne pouvait pas etre marque comme traite
   ============================================================
   Cible : public/cleaning.html  (onglet Maintenance)

   ── LE CONSTAT ──────────────────────────────────────────────────
   Sur une degradation constatee, la seule action visible est un bouton
   rouge « Retenir sur la caution ». Rien pour dire « c'est regle ».

   Le moyen existe pourtant : la carte entiere est cliquable et ouvre un
   modal ou un menu deroulant permet de passer le statut a « Resolu ».
   Mais rien ne l'indique — pas de curseur explicite, pas de libelle, pas
   de chevron. Les filtres « A traiter / En cours / Resolus » laissent
   croire a un cycle de vie, sans montrer par ou le faire avancer.

   Le resultat est un desequilibre : l'action financiere irreversible
   tient en un clic et s'affiche en rouge vif, tandis que la sortie
   normale du ticket demande de deviner que la carte s'ouvre.

   ── CE QUE FAIT CE CORRECTIF ────────────────────────────────────
   Ajoute un bouton « Marquer comme traite » a cote de la retenue sur
   caution, sur tout ticket qui n'est ni resolu ni cloture — degradation
   ou simple incident.

   Il envoie exactement le meme corps que le formulaire du modal
   (saveTicket) avec status: 'resolved'. C'est deliberé : la route PATCH
   attend l'objet complet, et n'envoyer que le statut risquerait
   d'effacer le titre, la description ou l'artisan assigne.

   Les deux boutons sont places dans un conteneur flex : sans lui ils se
   collent et debordent sur les petits ecrans.

   En cas d'echec, le bouton reprend son libelle et l'erreur est dite —
   plutot qu'un bouton fige sur lequel on reclique sans effet.

   ── CE QUI N'EST PAS TOUCHE ─────────────────────────────────────
   · Le clic sur la carte continue d'ouvrir le modal complet : c'est la
     ou l'on assigne un artisan ou passe un ticket « En cours ».
   · Le bouton de retenue sur caution : ni son emplacement, ni sa
     couleur, ni son comportement.
   · Aucune route serveur.

   ── UNE RESERVE ─────────────────────────────────────────────────
   « Marquer comme traite » et « Retenir sur la caution » sont
   independants : on peut clore un ticket sans avoir retenu quoi que ce
   soit, et inversement. C'est voulu — tous les degats ne donnent pas
   lieu a retenue. Mais si vous voulez qu'une retenue effectuee marque
   automatiquement le ticket comme traite, c'est un choix de conception a
   prendre ensemble, pas a glisser ici.

   Usage :
     node outils/maintenance-marquer-traite.js --essai
     node outils/maintenance-marquer-traite.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'cleaning.html');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('public/cleaning.html introuvable. Lancez depuis la racine du projet.');
let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('marquerTicketTraite') !== -1) {
  console.log('\n  Le correctif est deja en place — rien a faire.\n');
  process.exit(0);
}

function remplacer(source, avant, apres, quoi) {
  const n = source.split(avant).length - 1;
  if (n !== 1) echec(quoi + ' : ' + n + " occurrence(s) au lieu d'une. cleaning.html a change.");
  return source.split(avant).join(apres);
}

src = remplacer(src, "          const retainBtn = isDamage\n            ? '<button onclick=\"event.stopPropagation();retainOnDeposit(' + t.id + ')\" style=\"margin-top:11px;cursor:pointer;border:none;background:#dc2626;color:#fff;font-weight:700;padding:9px 14px;border-radius:9px;font-size:13px;display:inline-flex;align-items:center;gap:7px;\"><i class=\"fas fa-hand-holding-dollar\"></i> Retenir sur la caution</button>'\n            : '';", "          /* Marquer comme traite : l'action la plus courante n'avait aucun\n             bouton. La carte ouvre bien un modal ou l'on peut changer le\n             statut, mais rien ne l'indique — seul le bouton rouge de retenue\n             sur caution etait visible, c'est-a-dire l'action financiere\n             irreversible. On expose donc la sortie normale a cote d'elle.\n\n             Affiche tant que le ticket n'est ni resolu ni cloture. */\n          const dejaTraite = t.status === 'resolved' || t.status === 'closed';\n          const doneBtn = dejaTraite\n            ? ''\n            : '<button onclick=\"event.stopPropagation();marquerTicketTraite(' + t.id + ', this)\" style=\"margin-top:11px;cursor:pointer;border:1px solid rgba(14,59,46,.25);background:#fff;color:#0E3B2E;font-weight:700;padding:9px 14px;border-radius:9px;font-size:13px;display:inline-flex;align-items:center;gap:7px;\"><i class=\"fas fa-check\"></i> Marquer comme traité</button>';\n\n          const retainBtn = isDamage\n            ? '<button onclick=\"event.stopPropagation();retainOnDeposit(' + t.id + ')\" style=\"margin-top:11px;cursor:pointer;border:none;background:#dc2626;color:#fff;font-weight:700;padding:9px 14px;border-radius:9px;font-size:13px;display:inline-flex;align-items:center;gap:7px;\"><i class=\"fas fa-hand-holding-dollar\"></i> Retenir sur la caution</button>'\n            : '';\n          /* Les deux boutons partagent une ligne : sans conteneur flex, ils se\n             collent et debordent sur les petits ecrans. */\n          const actionsHtml = (doneBtn || retainBtn)\n            ? '<div style=\"display:flex;flex-wrap:wrap;gap:8px;align-items:center;\">' + doneBtn + retainBtn + '</div>'\n            : '';", 'Le bouton de retenue sur caution');
src = remplacer(src, "            + photosHtml\n            + retainBtn\n            + '</div>';", "            + photosHtml\n            + actionsHtml\n            + '</div>';", "L'assemblage de la carte");
src = remplacer(src, "      // ── Retenue sur la caution depuis un incident de dégradation ──", "      /* ── Marquer un ticket comme traite ──────────────────────────────\n         Reprend exactement le corps envoye par saveTicket : la route PATCH\n         attend l'objet complet, et n'envoyer que le statut risquerait\n         d'effacer les autres champs. */\n      window.marquerTicketTraite = async function (id, btn) {\n        const t = (typeof maintTickets !== 'undefined' ? maintTickets : []).find(x => String(x.id) === String(id));\n        if (!t) { alert('Ticket introuvable — rechargez la page.'); return; }\n        const libelle = btn ? btn.innerHTML : '';\n        if (btn) { btn.disabled = true; btn.innerHTML = '<i class=\"fas fa-spinner fa-spin\"></i> …'; }\n        try {\n          const res = await fetch(API_URL + '/api/maintenance/tickets/' + id, {\n            method: 'PATCH',\n            headers: Object.assign({ 'Content-Type': 'application/json' }, _maintHeaders()),\n            body: JSON.stringify({\n              propertyId: t.property_id,\n              title: t.title,\n              description: t.description,\n              priority: t.priority,\n              status: 'resolved',\n              artisanId: t.artisan_id || null\n            })\n          });\n          if (!res.ok) throw new Error('HTTP ' + res.status);\n          await loadMaintTickets();\n        } catch (e) {\n          console.error('[MAINT] marquerTicketTraite', e);\n          alert('Impossible de marquer ce ticket comme traité : ' + e.message);\n          if (btn) { btn.disabled = false; btn.innerHTML = libelle; }\n        }\n      };\n\n      // ── Retenue sur la caution depuis un incident de dégradation ──", 'Le bloc de retenue sur caution');

/* ---- Verifications ---- */
const blocs = src.match(/<script>([\s\S]*?)<\/script>/g) || [];
let bloc = null;
for (const b of blocs) {
  const corps = b.replace(/^<script>/, '').replace(/<\/script>$/, '');
  if (corps.indexOf('marquerTicketTraite') !== -1) bloc = corps;
  try { new Function(corps); }
  catch (e) { echec("Un bloc <script> de cleaning.html n'est plus valide — " + e.message); }
}
if (!bloc) echec('Le bloc contenant la nouvelle fonction est introuvable.');

/* La fonction doit vivre dans le meme bloc que maintTickets et API_URL,
   sinon elle ne les verrait pas — c'est exactement le piege qui a casse
   l'onglet Hosterzz. */
if (bloc.indexOf('async function loadMaintTickets') === -1) {
  echec('La fonction n\'est pas dans le meme bloc que loadMaintTickets : maintTickets serait hors de portee.');
}
if (bloc.indexOf("const API_URL = 'https://lcc-booking-manager.onrender.com'") === -1) {
  echec('API_URL n\'est pas declare dans ce bloc : l\'appel echouerait comme sur l\'onglet Hosterzz.');
}

const controles = [
  ['le bouton', 'Marquer comme traité'],
  ['la fonction', 'window.marquerTicketTraite = async function (id, btn)'],
  ['le conteneur des actions', 'const actionsHtml ='],
  ['son insertion dans la carte', '+ actionsHtml'],
  ['le statut envoye', "status: 'resolved',"],
  ['le rechargement', 'await loadMaintTickets();'],
];
for (const c of controles) {
  if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent du resultat.');
}

/* La retenue sur caution doit rester intacte et toujours rendue. */
if (src.indexOf('retainOnDeposit(') === -1) echec('Le bouton de retenue sur caution a disparu.');
if (src.indexOf('+ doneBtn + retainBtn +') === -1) echec('Les deux boutons ne sont pas assembles.');
/* Le clic sur la carte doit continuer d'ouvrir le modal. */
if (src.indexOf('openTicketModal(') === -1) echec("L'ouverture du modal a ete perdue.");

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('marquerTicketTraite') === -1) {
    echec("L'ajout est absent apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Chaque ticket non resolu porte un bouton « Marquer comme traité »,');
console.log('  a cote de la retenue sur caution.');
console.log('');
console.log('  Ensuite : ⌘⇧R sur la page Menage, onglet Maintenance.');
console.log('');
console.log('  Le ticket doit passer en « Résolu » et quitter le filtre « À traiter ».');
console.log('  Le compteur de l\'onglet doit descendre.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
