'use strict';
// Patche server.js : capture/libération de caution accessibles à toute agence qui gère le logement,
// quel que soit le contexte envoyé par l'app (agency=all ou non). Idempotent, sauvegarde .bak-dep
// Usage : node outils/patch-cautions-agence.js
const fs = require('fs'), path = require('path');
const f = path.join(__dirname, '../server.js');
let s = fs.readFileSync(f, 'utf8');
if (s.includes('_idsGeres')) { console.log('Déjà appliqué.'); process.exit(0); }

const A = `    const deposit = await pool.query(
      'SELECT * FROM deposits WHERE id = $1 AND user_id = ANY($2::text[])',
      [depositId, await getAgencyUserIds(req, userId)]
    );`;
const B = `    // Toute agence qui gère le logement peut agir, quel que soit le contexte envoyé par l'app.
    // Le Stripe utilisé reste celui de la caution (deposits.user_id) — voir captureDeposit/releaseDeposit.
    const _idsGeres = await getAgencyUserIds({ query: { agency: 'all' }, headers: {}, user: req.user }, userId);
    const deposit = await pool.query(
      \`SELECT d.* FROM deposits d
         LEFT JOIN properties p ON p.id::text = d.property_id::text
        WHERE d.id = $1 AND (d.user_id = ANY($2::text[]) OR p.user_id = ANY($2::text[]))\`,
      [depositId, _idsGeres]
    );`;
const n = s.split(A).length - 1;
if (n !== 2) { console.error('❌ Motif attendu 2 fois (capture + release), trouvé ' + n + ' — rien modifié.'); process.exit(1); }
fs.writeFileSync(f + '.bak-dep', s);
s = s.split(A).join(B);
fs.writeFileSync(f, s);
console.log('✅ server.js : capture/libération ouvertes aux agences du logement (2 routes, sauvegarde .bak-dep)');
