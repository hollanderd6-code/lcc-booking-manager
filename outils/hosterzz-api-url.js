#!/usr/bin/env node
/* ============================================================
   outils/hosterzz-api-url.js
   Le pont Hosterzz ne parlait plus au serveur
   ============================================================
   Cible : public/cleaning.html

   ── LE SYMPTOME ─────────────────────────────────────────────────
   La carte « Automatisation Hosterzz » affiche « Erreur de chargement. »
   Sur mobile ET sur ordinateur, systematiquement.

   ── CE QUI A ETE ECARTE ─────────────────────────────────────────
   · La route GET /api/hosterzz/auto-mission-settings existe et repond
     200 en application/json avec la liste des logements (verifie).
   · La colonne hz_auto_mission est bien creee au demarrage
     (« Tables pont Hosterzz pretes » figure dans les journaux).
   · Aucune ligne « [hosterzz auto-mission-settings] » dans les journaux
     Render : la route n'a jamais echoue.

   ── LA CAUSE ────────────────────────────────────────────────────
   Le code du pont Hosterzz vit dans un bloc <script> DIFFERENT de celui
   qui declare API_URL. Or cette constante n'est pas globale : depuis la
   console de la page, « typeof API_URL » renvoie 'undefined'.

   La ligne
       fetch(`${API_URL}/api/hosterzz/auto-mission-settings`, …)
   leve donc une ReferenceError avant meme de partir. Le catch l'attrape
   et affiche « Erreur de chargement » — un message qui laissait croire a
   un probleme de reseau ou de serveur.

   L'auteur du bloc avait deja rencontre le probleme pour une autre
   fonction et laisse ce commentaire :
     « formatDateFr vit dans un autre bloc <script> : repli local si
       indisponible. »
   Le repli existe pour formatDateFr. Il manquait pour API_URL.

   TROIS fonctions etaient touchees, pas une :
     · loadHzAutoMissionSettings — les reglages ne se chargent pas
     · toggleHzAutoMission       — les interrupteurs ne s'enregistrent pas
     · submitHzMission           — les missions ne se creent pas
   L'integration Hosterzz de cette page etait entierement inoperante.

   ── CE QUE FAIT CE CORRECTIF ────────────────────────────────────
   1. Declare API_URL dans le bloc Hosterzz, en reprenant window.API_URL
      si l'application la publie un jour. Les quatre appels retrouvent
      leur URL sans qu'aucun ne soit modifie.

   2. Rend l'echec lisible dans loadHzAutoMissionSettings. Le code ne
      testait jamais res.ok et jetait l'erreur reelle : toute panne
      donnait le meme message opaque, sans moyen de reessayer. Chaque cas
      est desormais nomme — session expiree, acces refuse, delai depasse,
      reseau injoignable, reponse illisible, erreur serveur — avec un
      bouton « Reessayer » et le detail technique en console.

      Sans ce second point, la cause serait restee invisible : c'est
      justement l'opacite du message qui a masque une ReferenceError
      pendant tout ce temps.

   ── CE QUI N'EST PAS TOUCHE ─────────────────────────────────────
   · Le rendu des logements et de leurs interrupteurs : repris mot pour mot.
   · toggleHzAutoMission et submitHzMission : leur URL est reparee par la
     declaration, mais leur gestion d'erreur reste celle d'origine. A
     reprendre si le besoin s'en fait sentir.

   Usage :
     node outils/hosterzz-api-url.js --essai
     node outils/hosterzz-api-url.js
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

if (src.indexOf('[HZ auto-mission]') !== -1) {
  console.log('\n  Le correctif est deja en place — rien a faire.\n');
  process.exit(0);
}

const PAIRES = [
  ['la declaration de API_URL', "    // formatDateFr vit dans un autre bloc <script> : repli local si indisponible.\n    function hzDateFr(d) {", "    // formatDateFr vit dans un autre bloc <script> : repli local si indisponible.\n\n    /* API_URL vit lui aussi dans un autre bloc <script> — et lui n'a jamais eu\n       de repli. Resultat : « API_URL is not defined » a chaque appel, attrape\n       par les catch et affiche « Erreur de chargement ». Les trois fonctions\n       qui parlent au serveur etaient donc muettes : loadHzAutoMissionSettings,\n       toggleHzAutoMission et submitHzMission. Verifie en console sur la page :\n       typeof API_URL renvoyait 'undefined'.\n\n       On declare ici la valeur, en reprenant window.API_URL si une autre\n       partie de l'application l'a publiee un jour. */\n    const API_URL = (typeof window.API_URL === 'string' && window.API_URL)\n      || 'https://lcc-booking-manager.onrender.com';\n\n    function hzDateFr(d) {"],
  ['la gestion des erreurs de chargement', "window.loadHzAutoMissionSettings = async function () {\n      const listEl = document.getElementById('hzAutoMissionList');\n      if (!listEl) return;\n      listEl.innerHTML = '<p class=\"text-secondary\">Chargement…</p>';\n      try {\n        const token = localStorage.getItem('lcc_token');\n        const res = await fetch(`${API_URL}/api/hosterzz/auto-mission-settings`, {\n          headers: { Authorization: 'Bearer ' + token }\n        });\n        const data = await res.json();\n        const props = data.properties || [];\n        if (!props.length) {\n          listEl.innerHTML = '<p class=\"text-secondary\">Aucun logement trouvé.</p>';\n          return;\n        }\n        listEl.innerHTML = props.map((p) => `\n          <div style=\"display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border:1px solid var(--border-color);border-radius:12px;margin-bottom:8px;\">\n            <span style=\"font-size:14px;font-weight:600;\">${(p.name || 'Logement').replace(/</g, '&lt;')}</span>\n            <label style=\"position:relative;display:inline-block;width:44px;height:24px;flex-shrink:0;\">\n              <input type=\"checkbox\" data-property-id=\"${p.id}\" ${p.hz_auto_mission ? 'checked' : ''}\n                     onchange=\"toggleHzAutoMission(this)\" style=\"opacity:0;width:0;height:0;\">\n              <span style=\"position:absolute;inset:0;background:${p.hz_auto_mission ? '#0E3B2E' : '#ccc'};border-radius:999px;transition:.2s;cursor:pointer;\"\n                    onclick=\"this.previousElementSibling.click()\"></span>\n              <span style=\"position:absolute;width:18px;height:18px;left:${p.hz_auto_mission ? '23px' : '3px'};top:3px;background:#fff;border-radius:50%;transition:.2s;pointer-events:none;box-shadow:0 1px 3px rgba(0,0,0,.2);\"></span>\n            </label>\n          </div>\n        `).join('');\n      } catch (e) {\n        listEl.innerHTML = '<p class=\"text-secondary\">Erreur de chargement.</p>';\n      }\n    };", "window.loadHzAutoMissionSettings = async function () {\n      const listEl = document.getElementById('hzAutoMissionList');\n      if (!listEl) return;\n      listEl.innerHTML = '<p class=\"text-secondary\">Chargement…</p>';\n\n      /* Toute panne affichait le meme « Erreur de chargement », sans dire\n         laquelle ni permettre de reessayer. On ne savait pas s'il fallait se\n         reconnecter, attendre, ou signaler un bug — et la trace n'existait\n         nulle part. Chaque cas est desormais nomme, et journalise en console. */\n      const echec = (texte, technique) => {\n        if (technique) console.error('[HZ auto-mission]', technique);\n        listEl.innerHTML =\n          '<p class=\"text-secondary\" style=\"margin:0 0 8px;\">' + texte + '</p>' +\n          '<button type=\"button\" class=\"btn btn-sm\" onclick=\"loadHzAutoMissionSettings()\" ' +\n          'style=\"background:#0A2C22;color:#fff;border:none;border-radius:10px;padding:6px 14px;font-size:12px;cursor:pointer;\">' +\n          'Réessayer</button>';\n      };\n\n      const token = localStorage.getItem('lcc_token');\n      if (!token) return echec('Session expirée. Reconnectez-vous.', 'aucun jeton');\n\n      let res;\n      try {\n        /* Le serveur s'endort apres une periode d'inactivite et met jusqu'a\n           une minute a repondre au premier appel. Sans delai explicite, la\n           requete pouvait rester suspendue puis echouer sans explication. */\n        res = await fetch(`${API_URL}/api/hosterzz/auto-mission-settings`, {\n          headers: { Authorization: 'Bearer ' + token },\n          signal: AbortSignal.timeout ? AbortSignal.timeout(60000) : undefined\n        });\n      } catch (e) {\n        return echec(\n          e.name === 'TimeoutError'\n            ? 'Le serveur met trop de temps à répondre. Réessayez dans un instant.'\n            : 'Connexion impossible. Vérifiez votre réseau.',\n          e.message\n        );\n      }\n\n      if (res.status === 401 || res.status === 403) {\n        return echec('Session expirée ou accès refusé. Reconnectez-vous.', 'HTTP ' + res.status);\n      }\n      if (!res.ok) {\n        return echec('Le serveur a refusé la demande (erreur ' + res.status + ').', 'HTTP ' + res.status);\n      }\n\n      let data;\n      try {\n        data = await res.json();\n      } catch (e) {\n        /* Reponse non-JSON : page d'erreur HTML, redirection, proxy… */\n        return echec('Réponse inattendue du serveur.', 'JSON illisible : ' + e.message);\n      }\n\n      const props = data.properties || [];\n      if (!props.length) {\n        listEl.innerHTML = '<p class=\"text-secondary\">Aucun logement trouvé.</p>';\n        return;\n      }\n      listEl.innerHTML = props.map((p) => `\n          <div style=\"display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border:1px solid var(--border-color);border-radius:12px;margin-bottom:8px;\">\n            <span style=\"font-size:14px;font-weight:600;\">${(p.name || 'Logement').replace(/</g, '&lt;')}</span>\n            <label style=\"position:relative;display:inline-block;width:44px;height:24px;flex-shrink:0;\">\n              <input type=\"checkbox\" data-property-id=\"${p.id}\" ${p.hz_auto_mission ? 'checked' : ''}\n                     onchange=\"toggleHzAutoMission(this)\" style=\"opacity:0;width:0;height:0;\">\n              <span style=\"position:absolute;inset:0;background:${p.hz_auto_mission ? '#0E3B2E' : '#ccc'};border-radius:999px;transition:.2s;cursor:pointer;\"\n                    onclick=\"this.previousElementSibling.click()\"></span>\n              <span style=\"position:absolute;width:18px;height:18px;left:${p.hz_auto_mission ? '23px' : '3px'};top:3px;background:#fff;border-radius:50%;transition:.2s;pointer-events:none;box-shadow:0 1px 3px rgba(0,0,0,.2);\"></span>\n            </label>\n          </div>\n        `).join('');\n    };"],
];
for (const [quoi, avant, apres] of PAIRES) {
  const n = src.split(avant).length - 1;
  if (n !== 1) echec(quoi + ' : ' + n + " occurrence(s) au lieu d'une. cleaning.html a change.");
  src = src.split(avant).join(apres);
}

/* ---- Verifications ---- */
const controles = [
  ['la declaration', "const API_URL = (typeof window.API_URL === 'string' && window.API_URL)"],
  ['la valeur de repli', "'https://lcc-booking-manager.onrender.com'"],
  ['le bouton Reessayer', 'onclick="loadHzAutoMissionSettings()"'],
  ['le test de res.ok', 'if (!res.ok) {'],
  ['le cas session expiree', 'Session expirée. Reconnectez-vous.'],
  ['le cas delai depasse', 'met trop de temps à répondre'],
  ['la journalisation', "console.error('[HZ auto-mission]', technique)"],
  ['le rendu des interrupteurs', 'onchange="toggleHzAutoMission(this)"'],
];
for (const c of controles) {
  if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent du resultat.');
}

if (src.indexOf('<p class="text-secondary">Erreur de chargement.</p>') !== -1) {
  echec('Le message generique subsiste.');
}
/* Une seule declaration : deux « const API_URL » au meme niveau seraient une erreur de syntaxe. */
if (src.split('const API_URL =').length - 1 !== 2) {
  echec('Nombre inattendu de declarations de API_URL (2 attendues : celle d\'origine et la nouvelle).');
}
/* Le repli existant pour formatDateFr doit rester. */
if (src.indexOf('function hzDateFr(d) {') === -1) {
  echec('Le repli de formatDateFr a ete perdu.');
}

/* Tous les blocs <script> doivent rester du JavaScript valide. */
const blocs = src.match(/<script>([\s\S]*?)<\/script>/g) || [];
let vu = false;
for (const b of blocs) {
  const corps = b.replace(/^<script>/, '').replace(/<\/script>$/, '');
  if (corps.indexOf('loadHzAutoMissionSettings') !== -1) vu = true;
  try { new Function(corps); }
  catch (e) { echec('Un bloc <script> de cleaning.html n\'est plus valide — ' + e.message); }
}
if (!vu) echec('Le bloc contenant loadHzAutoMissionSettings est introuvable apres modification.');

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('[HZ auto-mission]') === -1) {
    echec("L'ajout est absent apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  API_URL est declare dans le bloc Hosterzz : les trois fonctions');
console.log('  (reglages, interrupteurs, creation de mission) parlent a nouveau');
console.log('  au serveur.');
console.log('  Les pannes de chargement sont nommees, avec un bouton Réessayer.');
console.log('');
console.log('  Ensuite : ⌘⇧R sur la page Menage, onglet Hosterzz.');
console.log('  Attendu : la liste de vos logements avec un interrupteur chacun.');
console.log('');
console.log('  Verification en console : typeof API_URL doit renvoyer \'string\'.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
