#!/usr/bin/env node
/* ============================================================
   outils/gain-boostprice-honnete.js
   Le chiffre le plus visible disait plus qu'il ne savait
   ============================================================
   Cibles : public/dynamic-pricing.html
            routes/dynamic-pricing-routes.js

   ── CE QUE LE CHIFFRE EST VRAIMENT ───────────────────────────────
   Cote serveur, weeklyGain se calcule ainsi :

       weeklyGain += price_applied - price_before

   pour chaque logement ajuste cette semaine. C'est donc une somme
   d'ecarts de prix a la nuit, sur des logements differents.

   Ce n'est pas un revenu :
     — il ne tient pas compte du nombre de nuits reellement reservees ;
     — il additionne des prix de logements distincts ;
     — un logement vide compte autant qu'un logement complet.

   L'appeler « Revenu additionnel estime » promet de l'argent encaisse.
   C'est le chiffre sur lequel on juge l'outil : s'il est dementi par le
   releve bancaire, tout le reste devient suspect.

   ── CE QUI EST FAIT ──────────────────────────────────────────────
   1. Le libelle devient « Hausse de prix appliquee », qui decrit
      exactement l'operation.
   2. Une infobulle donne la methode en une phrase, et dit ce que le
      chiffre n'est pas.
   3. Le meme intitule est corrige dans l'email hebdomadaire, qui
      portait la meme promesse.

   Le calcul lui-meme n'est pas touche : il est juste, c'est son nom qui
   etait faux. Le convertir en revenu demanderait de croiser avec les
   nuits reservees — un autre chantier.

   Usage :
     node outils/gain-boostprice-honnete.js --essai
     node outils/gain-boostprice-honnete.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const PAGE  = path.join(process.cwd(), 'public', 'dynamic-pricing.html');
const ROUTE = path.join(process.cwd(), 'routes', 'dynamic-pricing-routes.js');

for (const f of [PAGE, ROUTE]) {
  if (!fs.existsSync(f)) {
    console.error('\n  \u2717 ' + f + ' introuvable. Lancez depuis la racine.\n');
    process.exit(1);
  }
}

let page  = fs.readFileSync(PAGE, 'utf8');
let route = fs.readFileSync(ROUTE, 'utf8');

if (page.indexOf('gain-methode') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* ── 1. Le libelle et son infobulle ───────────────────────────────── */
const A1 = `        <div class="summary-stat">
          <div class="val green" id="stat-gain">—</div>
          <div class="lbl">Revenu additionnel estimé</div>
        </div>`;

const N1 = `        <div class="summary-stat">
          <div class="val green" id="stat-gain">—</div>
          <div class="lbl">
            Hausse de prix appliquée
            <span class="gain-methode" tabindex="0"
                  aria-label="Somme des hausses de prix à la nuit appliquées cette semaine. Ce n'est pas un revenu encaissé : il dépend des nuits réellement réservées.">
              <i class="fas fa-circle-question"></i>
              <span class="gain-methode-box">Somme des hausses de prix à la nuit appliquées cette semaine,
                tous logements confondus.<br><br>Ce n'est pas un revenu encaissé : il dépend des nuits
                réellement réservées.</span>
            </span>
          </div>
        </div>`;

/* ── 2. Le style de l'infobulle, pose apres celui de .lbl ─────────── */
const A2 = `.summary-stat .lbl { font-size: 11px; color: var(--muted); margin-top: 2px; }`;

const N2 = `.summary-stat .lbl { font-size: 11px; color: var(--muted); margin-top: 2px; }
/* Infobulle de methode : un chiffre mis en avant doit pouvoir dire d'ou il vient. */
.gain-methode { position: relative; display: inline-block; margin-left: 3px; cursor: help; outline: none; }
.gain-methode i { font-size: 10px; opacity: .55; }
.gain-methode-box {
  position: absolute; bottom: calc(100% + 7px); left: 50%; transform: translateX(-50%);
  width: 230px; background: #20221F; color: #fff; font-size: 11.5px; line-height: 1.5;
  text-align: left; padding: 10px 12px; border-radius: 9px; z-index: 30;
  opacity: 0; visibility: hidden; transition: opacity .15s;
  box-shadow: 0 8px 24px rgba(32,34,31,.28); font-weight: 400;
}
.gain-methode:hover .gain-methode-box,
.gain-methode:focus .gain-methode-box { opacity: 1; visibility: visible; }
@media (max-width: 640px) {
  /* Sur petit ecran, l'infobulle centree deborderait : on l'ancre a gauche. */
  .gain-methode-box { left: 0; transform: none; width: min(230px, 70vw); }
}`;

/* ── 3. L'email hebdomadaire portait la meme promesse ──────────────── */
const A3 = `          💰 Revenu additionnel estimé cette semaine : &lt;span style="color:#10b981;"&gt;+\${Math.round(totalDelta)}€&lt;/span&gt; vs tarif fixe`;
const A3b = `          💰 Revenu additionnel estimé cette semaine : <span style="color:#10b981;">+\${Math.round(totalDelta)}€</span> vs tarif fixe`;
const N3 = `          💰 Hausse de prix appliquée cette semaine : <span style="color:#10b981;">+\${Math.round(totalDelta)}€</span> par nuit, tous logements confondus`;

const editsPage = [['libelle du gain', A1, N1], ['style de l\'infobulle', A2, N2]];

for (const [nom, ancien] of editsPage) {
  const n = page.split(ancien).length - 1;
  if (n !== 1) {
    console.error('\n  \u2717 ' + nom + ' : ' + n + ' occurrence(s), 1 attendue.');
    console.error('    Le fichier a change. Rien n\'a ete ecrit.\n');
    process.exit(1);
  }
}
for (const [, ancien, nouveau] of editsPage) page = page.split(ancien).join(nouveau);

let emailCorrige = false;
if (route.split(A3b).length - 1 === 1) {
  route = route.split(A3b).join(N3);
  emailCorrige = true;
} else if (route.split(A3).length - 1 === 1) {
  route = route.split(A3).join(N3);
  emailCorrige = true;
}

if (!ESSAI) {
  fs.writeFileSync(PAGE, page, 'utf8');
  if (emailCorrige) fs.writeFileSync(ROUTE, route, 'utf8');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  Libelle : « Hausse de prix appliquee », avec sa methode en infobulle.');
console.log(emailCorrige
  ? '  Email hebdomadaire : meme correction.'
  : '  Email hebdomadaire : formulation non trouvee, a corriger a la main.');
console.log('\n  Le calcul n\'a pas change — il etait juste, c\'est son nom qui promettait trop.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
