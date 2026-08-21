#!/usr/bin/env node
/* ============================================================
   Majoration de prix par plateforme
   ============================================================
   Cible : channex.js  (+ une migration SQL a passer)

   ── LE BLOCAGE QU'IL FALLAIT LEVER ───────────────────────────────
   addRoomTypeToProperty() ne cree qu'UN plan tarifaire par logement :
   « Tarif standard ». pushRates() envoie vers ce plan unique. Or dans
   Channex un plan porte UN prix, lu par TOUS les canaux qui lui sont
   mappes. Avec un seul plan, Airbnb et Booking voient forcement le
   meme prix : aucune majoration par plateforme n'etait possible, quel
   que soit le code ajoute.

   ── LA SOLUTION RETENUE : UN PLAN PAR PLATEFORME MAJOREE ─────────
   Pour chaque plateforme dont la majoration est > 0, on cree un plan
   tarifaire dedie, intitule « Tarif Airbnb +5% », et on y pousse le
   prix du calendrier multiplie.

   L'alternative etait d'utiliser les plans DERIVES de Channex, ou le
   partenaire calcule lui-meme la majoration. Plus elegant, mais elle
   exige des noms de champs d'API que je ne connais pas de memoire :
   du code ecrit dessus echouerait silencieusement a la creation du
   plan. Les plans manuels ne dependent que d'endpoints deja utilises
   et eprouves dans ce fichier.

   Le cout est faible : /restrictions accepte les 500 jours en UN
   appel batche. Trois plateformes majorees = 3 appels au lieu de 1.

   ── CE QUI RESTE INTOUCHABLE ─────────────────────────────────────
   La majoration n'est JAMAIS ecrite dans base_price. Le prix du
   calendrier reste la reference unique ; la majoration s'applique a la
   sortie, au moment du push. Sinon le moteur de tarification dynamique
   majorerait une majoration, et plus personne ne saurait quel chiffre
   est le vrai.

   ── DEUX CHOSES A FAIRE APRES ────────────────────────────────────
   1. La migration SQL (le script l'ecrit dans migrations/).
   2. Dans la fenetre du partenaire, mapper chaque canal sur SON plan :
      Airbnb sur « Tarif Airbnb +5% » et non sur « Tarif standard ».
      Sans ce mapping, le plan majore existe et n'est lu par personne.
      Le titre porte le pourcentage exactement pour rendre ce geste
      evident.

   Usage :
     node outils/majoration-plateformes.js --essai
     node outils/majoration-plateformes.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const RACINE = process.cwd();
const CIBLE = path.join(RACINE, 'channex.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

if (!fs.existsSync(CIBLE)) {
  console.error('\n  \u2717 channex.js introuvable. Lancez depuis la racine du depot.\n');
  process.exit(1);
}

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('assurerPlansMajores') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* ── 1. La fonction, posee juste avant pushRates ─────────────────── */
const A1 = `// ── 2b. Pousser les prix vers Channex ────────────────────────
async function pushRates(pool, { property_id, channex_property_id, channex_rate_plan_id, rates }) {`;

const N1 = `// ── 2b-bis. Plans tarifaires majorés, un par plateforme ──────
// Channex : un plan tarifaire = un prix, lu par tous les canaux qui lui sont
// mappés. Pour vendre plus cher sur Airbnb que sur Booking, il faut donc un
// plan par plateforme majorée — un seul plan ne peut pas porter deux prix.
const LIBELLE_PLATEFORME = {
  ABB: 'Airbnb',
  BDC: 'Booking.com',
  EXP: 'Expedia',
  VRB: 'Abritel-VRBO'
};

async function assurerPlansMajores(pool, property_id) {
  const { rows } = await pool.query(
    \`SELECT channex_property_id, channex_room_type_id,
            COALESCE(platform_markups, '{}'::jsonb)          AS markups,
            COALESCE(channex_markup_rate_plans, '{}'::jsonb) AS plans
       FROM properties WHERE id = $1\`,
    [property_id]
  );

  const p = rows[0];
  if (!p || !p.channex_property_id || !p.channex_room_type_id) return [];

  const markups = p.markups || {};
  const plans = Object.assign({}, p.plans || {});
  const actifs = [];
  let modifie = false;

  for (const code of Object.keys(LIBELLE_PLATEFORME)) {
    const pct = parseFloat(markups[code]);
    if (!pct || !(pct > 0)) continue;   // 0, absent ou négatif : pas de plan dédié

    if (!plans[code]) {
      // Le titre porte le pourcentage : dans l'interface du partenaire, on doit
      // pouvoir mapper le bon canal sur le bon plan sans avoir à deviner.
      const res = await channexAPI.post('/rate_plans', {
        rate_plan: {
          property_id: p.channex_property_id,
          room_type_id: p.channex_room_type_id,
          title: 'Tarif ' + LIBELLE_PLATEFORME[code] + ' +' + pct + '%',
          sell_mode: 'per_room',
          rate_mode: 'manual',
          currency: 'EUR',
          options: [{ occupancy: 2, is_primary: true, rate: 0 }]
        }
      });
      plans[code] = res.data.data.attributes.id;
      modifie = true;
      console.log(\`✅ [CHANNEX] Plan majoré créé : \${LIBELLE_PLATEFORME[code]} +\${pct}% (\${plans[code]})\`);
    }

    actifs.push({ code: code, pct: pct, rate_plan_id: plans[code] });
  }

  if (modifie) {
    await pool.query(
      'UPDATE properties SET channex_markup_rate_plans = $1 WHERE id = $2',
      [JSON.stringify(plans), property_id]
    );
  }

  return actifs;
}

// ── 2b. Pousser les prix vers Channex ────────────────────────
async function pushRates(pool, { property_id, channex_property_id, channex_rate_plan_id, rates }) {`;

/* ── 2. Le push des plans majorés, après le push principal ───────── */
const A2 = `    // ✅ Channex utilise /restrictions pour pousser rates ET restrictions
    await channexAPI.post('/restrictions', { values });
`;

const N2 = `    // ✅ Channex utilise /restrictions pour pousser rates ET restrictions
    await channexAPI.post('/restrictions', { values });

    // ── Plans majorés par plateforme ─────────────────────────────
    // La majoration s'applique ICI, à la sortie. Elle n'est jamais écrite dans
    // base_price : le prix du calendrier reste la référence unique, sinon le
    // moteur de tarification dynamique majorerait une majoration.
    //
    // Un échec sur un plan majoré ne doit PAS faire échouer le push principal,
    // qui vient de réussir : chaque plan est tenté séparément et l'erreur est
    // journalisée sans être relancée.
    let plansMajores = [];
    try {
      plansMajores = await assurerPlansMajores(pool, property_id);
    } catch (eM) {
      console.warn('⚠️ [CHANNEX] Plans majorés indisponibles (non bloquant):',
        eM.response?.data || eM.message);
    }

    for (const m of plansMajores) {
      const majores = rates.map(r => ({
        property_id: channex_property_id,
        rate_plan_id: m.rate_plan_id,
        date: r.date,
        rate: Math.round(parseFloat(r.price) * (1 + m.pct / 100) * 100)
      }));
      try {
        await channexAPI.post('/restrictions', { values: majores });
        console.log(\`✅ [CHANNEX] Tarifs +\${m.pct}% poussés vers \${m.code} (\${majores.length} jours)\`);
        await logChannex(pool, {
          property_id, channex_property_id,
          event_type: 'push_rates_markup',
          direction: 'outbound',
          payload: { plateforme: m.code, majoration_pct: m.pct, rates_count: majores.length }
        });
      } catch (eP) {
        const d = eP.response?.data || eP.message;
        console.error(\`❌ [CHANNEX] Push +\${m.pct}% \${m.code} échoué:\`, d);
        await logChannex(pool, {
          property_id, channex_property_id,
          event_type: 'push_rates_markup',
          direction: 'outbound',
          status: 'error',
          error_message: typeof d === 'string' ? d : JSON.stringify(d)
        });
      }
    }
`;

/* ── 3. Export ───────────────────────────────────────────────────── */
const A3 = `  pushRates,
  pushRestrictions,`;
const N3 = `  pushRates,
  assurerPlansMajores,
  pushRestrictions,`;

const edits = [
  ['fonction assurerPlansMajores', A1, N1],
  ['push des plans majores', A2, N2],
  ['export', A3, N3]
];

for (const [nom, ancien] of edits) {
  const n = src.split(ancien).length - 1;
  if (n !== 1) {
    console.error('\n  \u2717 ' + nom + ' : ' + n + ' occurrence(s), 1 attendue.');
    console.error('    channex.js a change. Rien n\'a ete ecrit.\n');
    process.exit(1);
  }
}
for (const [, ancien, nouveau] of edits) src = src.split(ancien).join(nouveau);

try {
  new Function(src);
} catch (e) {
  console.error('\n  \u2717 Le resultat n\'est pas du JavaScript valide : ' + e.message);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

/* ── La migration ────────────────────────────────────────────────── */
const SQL = `-- ============================================================
-- Majoration de prix par plateforme
-- ============================================================
-- platform_markups           : ce que l'utilisateur choisit.
--                              { "ABB": 5, "BDC": 10 }  → +5% Airbnb, +10% Booking
--                              Absent ou 0 = pas de majoration, le canal lit
--                              « Tarif standard ».
--
-- channex_markup_rate_plans  : ce que le systeme a cree en face.
--                              { "ABB": "uuid-du-plan" }
--                              Rempli automatiquement au premier push ; ne pas
--                              editer a la main.
--
-- Deux colonnes distinctes, et non une seule : l'intention de l'utilisateur ne
-- doit pas etre melangee avec l'etat technique cote partenaire. On peut changer
-- un pourcentage sans toucher au plan, et recreer un plan sans perdre le choix.
--
-- JSONB plutot que quatre colonnes par plateforme : ajouter une plateforme ne
-- demandera pas de migration.
-- ============================================================

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS platform_markups          JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS channex_markup_rate_plans JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN properties.platform_markups IS
  'Majoration en % par code plateforme (ABB, BDC, EXP, VRB). Appliquee a la sortie, jamais a base_price.';
COMMENT ON COLUMN properties.channex_markup_rate_plans IS
  'Plan tarifaire cree chez le partenaire pour chaque plateforme majoree. Rempli automatiquement.';
`;

const dossierMig = path.join(RACINE, 'migrations');
const fichierMig = path.join(dossierMig, 'majoration-plateformes.sql');

if (!ESSAI) {
  if (!fs.existsSync(dossierMig)) fs.mkdirSync(dossierMig, { recursive: true });
  fs.writeFileSync(fichierMig, SQL, 'utf8');
  fs.writeFileSync(CIBLE, src, 'utf8');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  channex.js : assurerPlansMajores() + push des plans majores.');
console.log('  migrations/majoration-plateformes.sql : 2 colonnes JSONB.');
console.log('\n  Syntaxe verifiee : channex.js reste du JavaScript valide.');
console.log('\n  ETAPE 1 — passer la migration');
console.log('    psql "$DATABASE_URL" -f migrations/majoration-plateformes.sql');
console.log('\n  ETAPE 2 — tester sans interface, sur un logement');
console.log('    UPDATE properties SET platform_markups = \'{"ABB": 5}\'::jsonb');
console.log('      WHERE id = \'<id-du-logement>\';');
console.log('    Puis relancez une synchro des prix. Les logs doivent montrer');
console.log('    « Plan majoré créé : Airbnb +5% » puis « Tarifs +5% poussés ».');
console.log('\n  ETAPE 3 — mapper le canal sur son plan');
console.log('    Dans la fenetre du partenaire, onglet Mapping : Airbnb doit');
console.log('    pointer sur « Tarif Airbnb +5% », pas sur « Tarif standard ».');
console.log('    Sans ce mapping, le plan majore existe et personne ne le lit.');
console.log('\n  RESTE A FAIRE — l\'interface');
console.log('    Les champs dans la fiche du logement, a cote des commissions');
console.log('    Airbnb / Booking qui existent deja. Le serveur est pret : un');
console.log('    UPDATE de platform_markups suffit a activer la majoration.');
if (ESSAI) console.log('\n  Relancez sans --essai pour appliquer.');
console.log('');
