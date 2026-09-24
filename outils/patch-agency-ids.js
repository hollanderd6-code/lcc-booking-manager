'use strict';
// getAgencyUserIds : actions / éléments précis / requêtes liées à un logement couvrent
// tous les comptes délégants, même sans agency=all. Idempotent, sauvegarde .bak-agency
// Usage : node outils/patch-agency-ids.js
const fs = require('fs'), path = require('path');
const f = path.join(__dirname, '../server.js');
let s = fs.readFileSync(f, 'utf8');
if (s.includes('_porteSurElement')) { console.log('Déjà appliqué.'); process.exit(0); }

const A = `async function getAgencyUserIds(req, userId) {
  if (req.query.agency !== 'all') return [userId];`;
const B = `async function getAgencyUserIds(req, userId) {
  // Sans agency=all, on reste sur son compte pour les LISTES (sélecteur de compte respecté).
  // Mais une action, un élément précis ou une requête liée à un logement doit couvrir
  // tous les comptes qui nous délèguent — sinon l'app, qui n'envoie pas toujours
  // agency=all, échoue (« introuvable ») sur les logements délégués.
  const _q = (req && req.query) || {};
  const _porteSurElement = Boolean(
    (req && req.method && req.method !== 'GET')
    || Object.keys((req && req.params) || {}).length > 0
    || _q.property_id || _q.propertyId || _q.conversation_id
  );
  if (_q.agency !== 'all' && _porteSurElement === false) return [userId];`;

const n = s.split(A).length - 1;
if (n !== 1) { console.error('❌ Motif trouvé ' + n + ' fois — rien modifié.'); process.exit(1); }
fs.writeFileSync(f + '.bak-agency', s);
s = s.replace(A, B);
fs.writeFileSync(f, s);
console.log('✅ getAgencyUserIds patché (sauvegarde server.js.bak-agency)');
