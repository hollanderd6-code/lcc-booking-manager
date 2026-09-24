'use strict';
// /api/invoice/create : propriétaire résolu via la réservation (puis nom / nom interne),
// nom + adresse du logement complétés. Idempotent, sauvegarde server.js.bak-inv
// Usage : node outils/patch-facture-proprietaire.js
const fs = require('fs'), path = require('path');
const f = path.join(__dirname, '../server.js');
let s = fs.readFileSync(f, 'utf8');
const start = s.indexOf("app.post('/api/invoice/create',");
const end = s.indexOf("app.post('/api/invoice/send-link'", start);
if (start < 0 || end < 0) { console.error('❌ Route introuvable'); process.exit(1); }
let r = s.slice(start, end);

if (!r.includes('_resaProp')) {
  const edits = [
    [ `      propertyName,\n      propertyAddress,\n      checkinDate,`,
      `      propertyName: _rawPropertyName,\n      propertyAddress: _rawPropertyAddress,\n      checkinDate,` ],
    [ `    const reservationUid  = rawReservationUid  || null;`,
      `    let propertyName    = _rawPropertyName    || '';\n    let propertyAddress = _rawPropertyAddress || '';\n    const reservationUid  = rawReservationUid  || null;` ],
    [ `      const propResult = await pool.query(
        \`SELECT id, user_id, owner_id FROM properties
         WHERE name = $1 AND user_id = ANY($2::text[])
         ORDER BY (owner_id IS NOT NULL) DESC LIMIT 1\`,
        [propertyName, candidateIds]
      );`,
      `      // 1) Par la réservation (fiable) ; 2) par nom OU nom interne (repli)
      let propResult = { rows: [] };
      if (reservationUid) {
        propResult = await pool.query(
          \`SELECT p.id, p.user_id, p.owner_id, p.name, p.internal_name, p.address AS _resaProp
             FROM reservations r JOIN properties p ON p.id = r.property_id
            WHERE r.uid = $1 AND p.user_id = ANY($2::text[]) LIMIT 1\`,
          [reservationUid, candidateIds]
        );
      }
      if (!propResult.rows[0] && propertyName) {
        propResult = await pool.query(
          \`SELECT id, user_id, owner_id, name, internal_name, address AS _resaProp FROM properties
            WHERE (name = $1 OR internal_name = $1) AND user_id = ANY($2::text[])
            ORDER BY (owner_id IS NOT NULL) DESC LIMIT 1\`,
          [propertyName, candidateIds]
        );
      }
      if (propResult.rows[0]) {
        const _p = propResult.rows[0];
        if (!propertyName)    propertyName    = (_p.internal_name && _p.internal_name.trim()) || _p.name || '';
        if (!propertyAddress) propertyAddress = _p._resaProp || '';
      } else {
        console.warn(\`⚠️ [INVOICE] Logement introuvable (resa=\${reservationUid}, nom="\${propertyName}") → émetteur = compte connecté\`);
      }` ],
  ];
  for (const [a] of edits) if (r.split(a).length !== 2) { console.error('❌ Motif introuvable :\n' + a.slice(0, 120)); process.exit(1); }
  fs.writeFileSync(f + '.bak-inv', s);
  for (const [a, b] of edits) r = r.replace(a, b);
  s = s.slice(0, start) + r + s.slice(end);
  fs.writeFileSync(f, s);
  console.log('✅ /api/invoice/create : propriétaire résolu via la réservation (sauvegarde .bak-inv)');
} else console.log('Déjà appliqué.');

// Contrôle point 4 : sous quel compte la facture est-elle enregistrée ?
console.log('\n──── Enregistrements de la facture (à me renvoyer) ────');
r.split('\n').forEach((l, i, a) => {
  if (/INSERT INTO (invoice_download_tokens|owner_invoices|invoices)/.test(l))
    console.log(a.slice(i, i + 5).join('\n') + '\n   …');
});
