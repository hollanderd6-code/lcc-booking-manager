'use strict';
// IA — caution : interdit d'inventer montants/dates, escalade sur toute question d'argent
// quand la caution a été encaissée. Idempotent, sauvegarde services/groq-ai.js.bak
// Usage : node outils/patch-ia-caution.js
const fs = require('fs'), path = require('path');
const f = path.join(__dirname, '../services/groq-ai.js');
let s = fs.readFileSync(f, 'utf8');
if (s.includes('CAUTION ENCAISSÉE')) { console.log('Déjà appliqué.'); process.exit(0); }

const edits = [
  // 1. Libellé "captured" : ne plus affirmer que tout le montant a été débité
  [ "captured:   `prélevée (${amt}€ débités)`,",
    "captured:   `CAUTION ENCAISSÉE (tout ou partie de ${amt}€ retenu par l'hôte — montant retenu et remboursement NON CONNUS ici)`,\n      released:   `libérée (empreinte levée, rien n'a été débité)`," ],
  // 2. Règle de précision
  [ "• Réponds UNIQUEMENT avec les infos du logement ci-dessus. Zéro invention.",
    "• Réponds UNIQUEMENT avec les infos du logement ci-dessus. Zéro invention.\n• ARGENT : ne JAMAIS inventer ni calculer un montant, un solde, un remboursement ou une date de virement. Si le chiffre exact n'est pas écrit ci-dessus → [ESCALADE]." ],
  // 3. Escalade caution
  [ "• Caution déjà payée (authorized/captured) → ne JAMAIS redemander le paiement.",
    "• Caution déjà payée (authorized/captured) → ne JAMAIS redemander le paiement.\n\nCAUTION — escalader TOUJOURS\n• Statut CAUTION ENCAISSÉE + toute question sur l'argent (montant reçu, remboursé, retenu, virement partiel, « il manque », « reste », « solde ») → [ESCALADE].\n• Le voyageur dit avoir reçu un montant différent de celui attendu → [ESCALADE].\n• Contestation d'une retenue ou demande de justificatif → [ESCALADE]." ],
];
for (const [a] of edits) if (s.split(a).length !== 2) { console.error('❌ Motif introuvable :\n' + a); process.exit(1); }
fs.writeFileSync(f + '.bak', s);
for (const [a, b] of edits) s = s.replace(a, b);
fs.writeFileSync(f, s);
console.log('✅ services/groq-ai.js patché (sauvegarde : groq-ai.js.bak)');
