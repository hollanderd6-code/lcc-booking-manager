'use strict';
// IA — interdit d'engager l'hôte (RDV, présence, objets, lieux inventés). Idempotent, sauvegarde .bak3
// Usage : node outils/patch-ia-engagements.js
const fs = require('fs'), path = require('path');
const f = path.join(__dirname, '../services/groq-ai.js');
let s = fs.readFileSync(f, 'utf8');
if (s.includes('ENGAGER L\'HÔTE')) { console.log('Déjà appliqué.'); process.exit(0); }

const edits = [
  [ "• Info disponible → donne-la complète et exacte.",
    "• Info disponible → donne-la complète et exacte.\n" +
    "• Ne JAMAIS affirmer où se trouve un objet, ni qu'un objet est présent/absent dans le logement, si ce n'est pas écrit ci-dessus.\n\n" +
    "INTERDIT — ENGAGER L'HÔTE\n" +
    "• Tu ne fixes JAMAIS de rendez-vous, de passage, de remise en main propre ni de visite.\n" +
    "• Tu n'annonces JAMAIS la présence de quelqu'un (« je serai présent », « quelqu'un vous attendra », « on vous ouvrira »).\n" +
    "• Tu n'acceptes JAMAIS au nom de l'hôte une demande qui lui demande d'agir (venir, envoyer, garder, réparer, rembourser, accorder une exception) → [ESCALADE].\n" +
    "• Tu ne dis jamais « c'est noté » pour une demande que seul l'hôte peut accepter." ],
  [ "ESCALADE IMMÉDIATE (sans discussion)\n• Problème / équipement cassé / nuisance",
    "ESCALADE IMMÉDIATE (sans discussion)\n" +
    "• Objet oublié / perdu / à récupérer, ou demande de revenir au logement après le départ\n" +
    "• Toute demande de rendez-vous, de passage ou de remise d'objet\n" +
    "• Problème / équipement cassé / nuisance" ],
  [ "HEURE D'ARRIVÉE\n",
    "HEURE D'ARRIVÉE (uniquement pour l'arrivée d'un séjour pas encore commencé — JAMAIS après le départ)\n" ],
];
for (const [a] of edits) if (s.split(a).length !== 2) { console.error('❌ Motif introuvable :\n' + a); process.exit(1); }
fs.writeFileSync(f + '.bak3', s);
for (const [a, b] of edits) s = s.replace(a, b);
fs.writeFileSync(f, s);
console.log('✅ services/groq-ai.js patché (sauvegarde : groq-ai.js.bak3)');
