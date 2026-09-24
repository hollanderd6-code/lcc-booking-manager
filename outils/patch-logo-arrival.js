'use strict';
// Remplace le carré "B" de public/arrival.html par l'icône BH officielle. Idempotent.
// Usage : node outils/patch-logo-arrival.js
const fs = require('fs'), path = require('path');
const f = path.join(__dirname, '../public/arrival.html');
let s = fs.readFileSync(f, 'utf8');
if (s.includes('bh-icon-256.png')) { console.log('Déjà appliqué.'); process.exit(0); }
const a = '<div class="brand-b">B</div>';
if (s.split(a).length !== 2) { console.error('❌ Motif introuvable'); process.exit(1); }
s = s.replace(a, '<img class="brand-b" src="/img/brand/bh-icon-256.png" alt="Boostinghost" width="30" height="30">');
s = s.replace('.brand-b{width:30px;height:30px;border-radius:8px;background:var(--green);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:17px;}',
              '.brand-b{width:30px;height:30px;border-radius:8px;display:block;object-fit:cover;}');
fs.writeFileSync(f, s);
console.log('✅ public/arrival.html : logo BH en place');
