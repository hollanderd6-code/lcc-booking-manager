#!/usr/bin/env node
/* ============================================================
   outils/menage-onglets-recouverts.js
   Trois panneaux vivaient hors de leur conteneur
   ============================================================
   Cible : public/cleaning.html

   ── LE SYMPTOME ─────────────────────────────────────────────────
   Sur les onglets Maintenance et Hosterzz, le contenu remonte et
   recouvre la barre d'onglets : les libelles sont coupes en deux.
   Sur Equipe, Checklists, Templates et Stats, tout va bien.

   ── LA MESURE ───────────────────────────────────────────────────
   Relevee dans le navigateur :
     · barre d'onglets : 119 -> 167
     · panneau affiche : commence a 158
     · recouvrement    : 9 px
     · position des deux : static, aucune marge negative

   Un element statique ne peut pas commencer avant la fin du precedent.
   La verification a montre pourquoi : le panneau actif n'etait PAS un
   enfant de .page-content, alors que quatre autres l'etaient.

   ── LA CAUSE ────────────────────────────────────────────────────
   Le conteneur .page-content, ouvert ligne 1710, se refermait ligne
   1958 — juste apres le panneau Stats. Les trois derniers panneaux
   etaient ecrits APRES cette fermeture, a la suite des modals :

     ligne 1710  <div class="page-content">
     ligne 1741    panel-team          (dans le conteneur)
     ligne 1825    panel-checklists    (dans le conteneur)
     ligne 1848    panel-templates     (dans le conteneur)
     ligne 1910    panel-stats         (dans le conteneur)
     ligne 1958  </div>                <- fermeture prematuree
     …modals…
     ligne 2023    panel-restock       (HORS du conteneur)
     ligne 2085    panel-maintenance   (HORS du conteneur)
     ligne 2114    panel-hosterzz      (HORS du conteneur)

   Hors du conteneur, ces trois panneaux ignorent son padding de 24 px
   et se placent la ou le flux les met — par-dessus la barre d'onglets.
   D'ou les 9 px, et d'ou le fait que seuls ces trois onglets soient
   touches.

   ── CE QUE FAIT CE CORRECTIF ────────────────────────────────────
   Il deplace les trois panneaux (lignes 2022 a 2127, commentaire
   compris) a l'interieur de .page-content, a la suite des quatre
   premiers. Aucun style n'est touche.

   C'est deliberement le HTML qui est corrige, et non le CSS. La page
   declare .cleaning-tabs HUIT fois et .page-content QUATRE fois, avec
   des !important partout : ajouter une neuvieme regle pour compenser un
   defaut de structure aurait tenu jusqu'a la prochaine surcharge.

   ── VERIFICATIONS INTEGREES ─────────────────────────────────────
   Le script refuse d'ecrire si, apres deplacement :
     · les sept panneaux ne sont pas tous a la meme profondeur ;
     · le nombre de <div> et de </div> a change ;
     · un panneau a disparu.

   ── CE QUI N'EST PAS TOUCHE ─────────────────────────────────────
   Les modals restent ou ils sont, apres le conteneur : leur position
   est fixed, leur place dans le flux n'a aucune importance.

   Usage :
     node outils/menage-onglets-recouverts.js --essai
     node outils/menage-onglets-recouverts.js
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

if (src.indexOf('vivaient APRES la fermeture de') !== -1) {
  console.log('\n  Le correctif est deja en place — rien a faire.\n');
  process.exit(0);
}

const divAvant = (src.match(/<div\b/g) || []).length;
const finAvant = (src.match(/<\/div>/g) || []).length;

const RETRAIT = "\n<!-- ════════ PANEL RÉASSORT ════════ -->\n<div class=\"cleaning-tab-panel\" id=\"panel-restock\">\n  <section class=\"card\">\n    <div class=\"card-header\">\n      <div class=\"card-title\">\n        <i class=\"fas fa-user-tag\"></i>\n        Responsable des achats\n      </div>\n      <button style=\"cursor:pointer;border:none;background:#fff;color:var(--accent,#0E3B2E);border:1px solid var(--border);font-weight:700;padding:8px 14px;border-radius:10px;font-size:13px;white-space:nowrap;flex:0 0 auto;width:auto;\" onclick=\"openResponsibleModal('')\">\n        <i class=\"fas fa-plus\"></i> Par logement\n      </button>\n    </div>\n    <p class=\"text-secondary\" style=\"font-size:13px;margin:-4px 0 12px;\">\n      La personne désignée est prévenue automatiquement (push si collaborateur, sinon email + SMS) dès qu'un agent signale un article à racheter.\n    </p>\n    <div id=\"responsibleDefault\" style=\"display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 13px;border:1px solid var(--border);border-radius:12px;\">\n      <span class=\"text-secondary\">Chargement…</span>\n    </div>\n    <div id=\"responsibleOverrides\" style=\"margin-top:10px;\"></div>\n  </section>\n\n  <section class=\"card\" style=\"margin-top:16px;\">\n    <div class=\"card-header\">\n      <div class=\"card-title\">\n        <i class=\"fas fa-basket-shopping\"></i>\n        Liste de courses\n      </div>\n      <button style=\"cursor:pointer;border:none;background:var(--accent,#0E3B2E);color:#fff;font-weight:700;padding:8px 14px;border-radius:10px;font-size:13px;white-space:nowrap;flex:0 0 auto;width:auto;\" onclick=\"loadRestockAlerts()\">\n        <i class=\"fas fa-sync-alt\"></i> Actualiser\n      </button>\n    </div>\n    <p class=\"text-secondary\" style=\"font-size:13px;margin:-4px 0 14px;\">\n      Articles signalés « à racheter » par les agents lors des ménages, groupés par logement.\n    </p>\n    <div id=\"restockShoppingList\"><p class=\"text-secondary\">Chargement…</p></div>\n  </section>\n\n  <section class=\"card\" style=\"margin-top:16px;\">\n    <div class=\"card-header\">\n      <div class=\"card-title\">\n        <i class=\"fas fa-sliders\"></i>\n        Articles suivis\n      </div>\n      <select id=\"restockCatalogProperty\" class=\"assign-select\" style=\"max-width:200px;font-size:13px;\" onchange=\"loadRestockCatalog()\">\n        <option value=\"\">Liste standard (tous)</option>\n      </select>\n    </div>\n    <p class=\"text-secondary\" style=\"font-size:13px;margin:-4px 0 14px;\">\n      La liste standard s'applique à tous les logements. Sélectionnez un logement pour y ajouter des articles spécifiques.\n    </p>\n    <div id=\"restockCatalogList\"><p class=\"text-secondary\">Chargement…</p></div>\n    <div style=\"display:flex;gap:8px;margin-top:14px;\">\n      <input id=\"restockNewLabel\" type=\"text\" placeholder=\"Nouvel article (ex : Éponges)\" maxlength=\"80\"\n        style=\"flex:1;padding:11px 13px;border:1px solid var(--border,#ddd);border-radius:10px;font-size:14px;font-family:inherit;\"\n        onkeydown=\"if(event.key==='Enter')addRestockItem()\">\n      <button onclick=\"addRestockItem()\" style=\"cursor:pointer;border:none;background:var(--accent,#0E3B2E);color:#fff;font-weight:700;padding:11px 16px;border-radius:10px;font-size:14px;\">\n        <i class=\"fas fa-plus\"></i> Ajouter\n      </button>\n    </div>\n  </section>\n</div>\n\n<!-- ════════ PANEL MAINTENANCE ════════ -->\n<div class=\"cleaning-tab-panel\" id=\"panel-maintenance\">\n  <section class=\"card\">\n    <div class=\"card-header\">\n      <div class=\"card-title\"><i class=\"fas fa-screwdriver-wrench\"></i> Incidents &amp; interventions</div>\n      <button style=\"cursor:pointer;border:none;background:var(--accent,#0E3B2E);color:#fff;font-weight:700;padding:8px 14px;border-radius:10px;font-size:13px;white-space:nowrap;flex:0 0 auto;width:auto;\" onclick=\"openTicketModal()\">\n        <i class=\"fas fa-plus\"></i> Nouveau ticket\n      </button>\n    </div>\n    <div style=\"display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 14px;\" id=\"maintFilters\">\n      <button class=\"maint-filter active\" data-st=\"open\" onclick=\"setMaintFilter('open')\">À traiter</button>\n      <button class=\"maint-filter\" data-st=\"in_progress\" onclick=\"setMaintFilter('in_progress')\">En cours</button>\n      <button class=\"maint-filter\" data-st=\"resolved\" onclick=\"setMaintFilter('resolved')\">Résolus</button>\n      <button class=\"maint-filter\" data-st=\"\" onclick=\"setMaintFilter('')\">Tous</button>\n    </div>\n    <div id=\"maintTicketsList\"><p class=\"text-secondary\">Chargement…</p></div>\n  </section>\n\n  <section class=\"card\" style=\"margin-top:16px;\">\n    <div class=\"card-header\">\n      <div class=\"card-title\"><i class=\"fas fa-address-book\"></i> Carnet d'artisans</div>\n      <button style=\"cursor:pointer;border:none;background:#fff;color:var(--accent,#0E3B2E);border:1px solid var(--border);font-weight:700;padding:8px 14px;border-radius:10px;font-size:13px;white-space:nowrap;flex:0 0 auto;width:auto;\" onclick=\"openArtisanModal()\">\n        <i class=\"fas fa-plus\"></i> Ajouter\n      </button>\n    </div>\n    <div id=\"maintArtisansList\"><p class=\"text-secondary\">Chargement…</p></div>\n  </section>\n</div>\n\n<!-- ===== TAB : HOSTERZZ (automatisation par logement) ===== -->\n<div class=\"cleaning-tab-panel\" id=\"panel-hosterzz\">\n  <section class=\"card\">\n    <div class=\"card-header\">\n      <div class=\"card-title\"><i class=\"fas fa-broom\"></i> Automatisation Hosterzz</div>\n    </div>\n    <div style=\"padding:0 4px 4px;font-size:13px;color:var(--text-secondary);line-height:1.5;margin-bottom:6px;\">\n      Activez la création automatique d'une mission de ménage Hosterzz à chaque nouvelle réservation, logement par logement.\n      Nécessite d'avoir lié votre compte Hosterzz (Paramètres → Intégrations).\n    </div>\n    <div id=\"hzAutoMissionList\" style=\"margin-top:10px;\">\n      <p class=\"text-secondary\">Chargement…</p>\n    </div>\n  </section>\n</div>\n";
const ANCRE = "</section>\n</div>\n\n</div>";
const REMPLACEMENT = "</section>\n</div>\n\n<!-- Reassort, Maintenance et Hosterzz vivaient APRES la fermeture de\n     page-content : hors du conteneur, ils ignoraient ses marges et\n     recouvraient la barre d'onglets de 9 px. Ils sont remis a leur place,\n     a la suite des quatre premiers panneaux. -->\n<!-- ════════ PANEL RÉASSORT ════════ -->\n<div class=\"cleaning-tab-panel\" id=\"panel-restock\">\n  <section class=\"card\">\n    <div class=\"card-header\">\n      <div class=\"card-title\">\n        <i class=\"fas fa-user-tag\"></i>\n        Responsable des achats\n      </div>\n      <button style=\"cursor:pointer;border:none;background:#fff;color:var(--accent,#0E3B2E);border:1px solid var(--border);font-weight:700;padding:8px 14px;border-radius:10px;font-size:13px;white-space:nowrap;flex:0 0 auto;width:auto;\" onclick=\"openResponsibleModal('')\">\n        <i class=\"fas fa-plus\"></i> Par logement\n      </button>\n    </div>\n    <p class=\"text-secondary\" style=\"font-size:13px;margin:-4px 0 12px;\">\n      La personne désignée est prévenue automatiquement (push si collaborateur, sinon email + SMS) dès qu'un agent signale un article à racheter.\n    </p>\n    <div id=\"responsibleDefault\" style=\"display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 13px;border:1px solid var(--border);border-radius:12px;\">\n      <span class=\"text-secondary\">Chargement…</span>\n    </div>\n    <div id=\"responsibleOverrides\" style=\"margin-top:10px;\"></div>\n  </section>\n\n  <section class=\"card\" style=\"margin-top:16px;\">\n    <div class=\"card-header\">\n      <div class=\"card-title\">\n        <i class=\"fas fa-basket-shopping\"></i>\n        Liste de courses\n      </div>\n      <button style=\"cursor:pointer;border:none;background:var(--accent,#0E3B2E);color:#fff;font-weight:700;padding:8px 14px;border-radius:10px;font-size:13px;white-space:nowrap;flex:0 0 auto;width:auto;\" onclick=\"loadRestockAlerts()\">\n        <i class=\"fas fa-sync-alt\"></i> Actualiser\n      </button>\n    </div>\n    <p class=\"text-secondary\" style=\"font-size:13px;margin:-4px 0 14px;\">\n      Articles signalés « à racheter » par les agents lors des ménages, groupés par logement.\n    </p>\n    <div id=\"restockShoppingList\"><p class=\"text-secondary\">Chargement…</p></div>\n  </section>\n\n  <section class=\"card\" style=\"margin-top:16px;\">\n    <div class=\"card-header\">\n      <div class=\"card-title\">\n        <i class=\"fas fa-sliders\"></i>\n        Articles suivis\n      </div>\n      <select id=\"restockCatalogProperty\" class=\"assign-select\" style=\"max-width:200px;font-size:13px;\" onchange=\"loadRestockCatalog()\">\n        <option value=\"\">Liste standard (tous)</option>\n      </select>\n    </div>\n    <p class=\"text-secondary\" style=\"font-size:13px;margin:-4px 0 14px;\">\n      La liste standard s'applique à tous les logements. Sélectionnez un logement pour y ajouter des articles spécifiques.\n    </p>\n    <div id=\"restockCatalogList\"><p class=\"text-secondary\">Chargement…</p></div>\n    <div style=\"display:flex;gap:8px;margin-top:14px;\">\n      <input id=\"restockNewLabel\" type=\"text\" placeholder=\"Nouvel article (ex : Éponges)\" maxlength=\"80\"\n        style=\"flex:1;padding:11px 13px;border:1px solid var(--border,#ddd);border-radius:10px;font-size:14px;font-family:inherit;\"\n        onkeydown=\"if(event.key==='Enter')addRestockItem()\">\n      <button onclick=\"addRestockItem()\" style=\"cursor:pointer;border:none;background:var(--accent,#0E3B2E);color:#fff;font-weight:700;padding:11px 16px;border-radius:10px;font-size:14px;\">\n        <i class=\"fas fa-plus\"></i> Ajouter\n      </button>\n    </div>\n  </section>\n</div>\n\n<!-- ════════ PANEL MAINTENANCE ════════ -->\n<div class=\"cleaning-tab-panel\" id=\"panel-maintenance\">\n  <section class=\"card\">\n    <div class=\"card-header\">\n      <div class=\"card-title\"><i class=\"fas fa-screwdriver-wrench\"></i> Incidents &amp; interventions</div>\n      <button style=\"cursor:pointer;border:none;background:var(--accent,#0E3B2E);color:#fff;font-weight:700;padding:8px 14px;border-radius:10px;font-size:13px;white-space:nowrap;flex:0 0 auto;width:auto;\" onclick=\"openTicketModal()\">\n        <i class=\"fas fa-plus\"></i> Nouveau ticket\n      </button>\n    </div>\n    <div style=\"display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 14px;\" id=\"maintFilters\">\n      <button class=\"maint-filter active\" data-st=\"open\" onclick=\"setMaintFilter('open')\">À traiter</button>\n      <button class=\"maint-filter\" data-st=\"in_progress\" onclick=\"setMaintFilter('in_progress')\">En cours</button>\n      <button class=\"maint-filter\" data-st=\"resolved\" onclick=\"setMaintFilter('resolved')\">Résolus</button>\n      <button class=\"maint-filter\" data-st=\"\" onclick=\"setMaintFilter('')\">Tous</button>\n    </div>\n    <div id=\"maintTicketsList\"><p class=\"text-secondary\">Chargement…</p></div>\n  </section>\n\n  <section class=\"card\" style=\"margin-top:16px;\">\n    <div class=\"card-header\">\n      <div class=\"card-title\"><i class=\"fas fa-address-book\"></i> Carnet d'artisans</div>\n      <button style=\"cursor:pointer;border:none;background:#fff;color:var(--accent,#0E3B2E);border:1px solid var(--border);font-weight:700;padding:8px 14px;border-radius:10px;font-size:13px;white-space:nowrap;flex:0 0 auto;width:auto;\" onclick=\"openArtisanModal()\">\n        <i class=\"fas fa-plus\"></i> Ajouter\n      </button>\n    </div>\n    <div id=\"maintArtisansList\"><p class=\"text-secondary\">Chargement…</p></div>\n  </section>\n</div>\n\n<!-- ===== TAB : HOSTERZZ (automatisation par logement) ===== -->\n<div class=\"cleaning-tab-panel\" id=\"panel-hosterzz\">\n  <section class=\"card\">\n    <div class=\"card-header\">\n      <div class=\"card-title\"><i class=\"fas fa-broom\"></i> Automatisation Hosterzz</div>\n    </div>\n    <div style=\"padding:0 4px 4px;font-size:13px;color:var(--text-secondary);line-height:1.5;margin-bottom:6px;\">\n      Activez la création automatique d'une mission de ménage Hosterzz à chaque nouvelle réservation, logement par logement.\n      Nécessite d'avoir lié votre compte Hosterzz (Paramètres → Intégrations).\n    </div>\n    <div id=\"hzAutoMissionList\" style=\"margin-top:10px;\">\n      <p class=\"text-secondary\">Chargement…</p>\n    </div>\n  </section>\n</div>\n\n</div>";

if (src.split(RETRAIT).length - 1 !== 1) {
  echec("Le bloc des trois panneaux : introuvable ou en double. cleaning.html a change.");
}
if (src.split(ANCRE).length - 1 !== 1) {
  echec("La fermeture de page-content : introuvable ou en double. cleaning.html a change.");
}

src = src.split(RETRAIT).join('\n');
if (src.indexOf('id="panel-restock"') !== -1) echec('Le bloc n\'a pas ete retire.');
src = src.split(ANCRE).join(REMPLACEMENT);

/* ---- Verifications ---- */
const PANNEAUX = ['panel-team','panel-checklists','panel-templates','panel-stats','panel-restock','panel-maintenance','panel-hosterzz'];
for (const id of PANNEAUX) {
  const n = src.split('id="' + id + '"').length - 1;
  if (n !== 1) echec(id + ' apparait ' + n + ' fois au lieu d\'une.');
}

if ((src.match(/<div\b/g) || []).length !== divAvant) echec('Le nombre de <div> a change.');
if ((src.match(/<\/div>/g) || []).length !== finAvant) echec('Le nombre de </div> a change.');

/* Les sept panneaux doivent etre a la meme profondeur dans page-content. */
const lignes = src.split('\n');
const debut = lignes.findIndex(l => l.indexOf('class="page-content"') !== -1);
if (debut === -1) echec('page-content est introuvable.');
let profondeur = 0;
const trouves = {};
let fermeture = -1;
for (let i = debut; i < lignes.length; i++) {
  for (const id of PANNEAUX) {
    if (lignes[i].indexOf('id="' + id + '"') !== -1) trouves[id] = profondeur;
  }
  profondeur += (lignes[i].match(/<div\b/g) || []).length - (lignes[i].match(/<\/div>/g) || []).length;
  if (profondeur <= 0 && i > debut) { fermeture = i + 1; break; }
}
if (Object.keys(trouves).length !== 7) {
  echec('Seuls ' + Object.keys(trouves).length + ' panneaux sur 7 sont dans page-content.');
}
const niveaux = [...new Set(Object.values(trouves))];
if (niveaux.length !== 1) {
  echec('Les panneaux ne sont pas au meme niveau : ' + JSON.stringify(trouves));
}

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('vivaient APRES la fermeture de') === -1) {
    echec("L'ajout est absent apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Les sept panneaux sont dans page-content, au meme niveau');
console.log('  (profondeur ' + niveaux[0] + '), et le conteneur se ferme ligne ' + fermeture + '.');
console.log('  Balises <div> inchangees : ' + divAvant + ' ouvertes, ' + finAvant + ' fermees.');
console.log('');
console.log('  Ensuite : ⌘⇧R sur la page Menage.');
console.log('  Parcourez les sept onglets : la barre doit rester entierement');
console.log('  lisible sur chacun, Maintenance et Hosterzz compris.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
