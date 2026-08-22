/* ============================================================
   channex-mapping.js — remapper un canal sur son plan majoré
   ============================================================
   Le maillon qui manquait. Quand une majoration est réglée, pushRates()
   crée un plan tarifaire dédié (« Tarif Airbnb +15% ») et y pousse les
   prix majorés — mais le canal Airbnb continue de lire « Tarif standard ».
   Ce module fait le remappage à la place de l'utilisateur.

   ── CE QU'ON MODIFIE, ET RIEN D'AUTRE ────────────────────────────
   Dans le mapping du canal, une seule valeur change : rate_plan_id,
   notre plan tarifaire. Le code OTA (ota_rate_plan_code, ota_room_type_code)
   reste tel quel — c'est lui qui identifie la chambre chez Booking ou
   Airbnb, et y toucher casserait la connexion. Tout le reste de l'objet
   est renvoyé verbatim.

   ── DEUX GARDE-FOUS ──────────────────────────────────────────────
   1. L'état précédent est enregistré dans properties.channex_mapping_backup
      avant tout envoi. On peut donc revenir en arrière, même des jours après.
   2. Si la forme de l'objet renvoyé par Channex n'est pas celle attendue,
      on n'envoie rien et on journalise la structure reçue. Mieux vaut ne
      rien faire que casser un canal qui fonctionne.

   ── LIMITE ASSUMÉE ───────────────────────────────────────────────
   Le schéma des mappings varie selon l'OTA. Le code cherche les mappings
   par room_type_id, sans supposer de niveau d'imbrication fixe. Si un canal
   sort du cadre, il est laissé intact et signalé dans les logs.
   ============================================================ */

'use strict';

const { channexAPI, logChannex } = require('./channex');

const MIGRATION = `
  ALTER TABLE properties
    ADD COLUMN IF NOT EXISTS channex_mapping_backup JSONB DEFAULT '{}'::jsonb;
`;

let migrationFaite = false;
async function assurerColonne(pool) {
  if (migrationFaite) return;
  try { await pool.query(MIGRATION); migrationFaite = true; } catch (e) {
    console.error('❌ [MAPPING] Migration impossible :', e.message);
  }
}

/* Les codes de canal Channex, par plateforme. Channex nomme ses canaux
   différemment selon les versions d'API : on accepte plusieurs graphies. */
const CANAUX = {
  ABB: ['airbnb', 'abb', 'airbnbofficial'],
  BDC: ['bookingcom', 'booking', 'bdc', 'booking.com'],
  EXP: ['expedia', 'exp'],
  VRB: ['homeaway', 'vrbo', 'vrb', 'abritel']
};

function correspond(code, valeurCanal) {
  const v = String(valeurCanal || '').toLowerCase().replace(/[^a-z.]/g, '');
  return (CANAUX[code] || []).some((c) => v === c || v.indexOf(c) > -1);
}

/* Channex range les mappings d'un canal dans attributes.rate_plans. Chaque
   entrée ressemble à :

     { id: "34e2…",                       // l'entrée de mapping elle-même
       rate_plan_id: "1302f4f0…",         // NOTRE plan tarifaire
       settings: { rate_plan_code: 30969044,   // les codes de l'OTA,
                   room_type_code: 900151902 } }  // à ne jamais toucher

   Il n'y a pas de room_type_id dans ces entrées : la correspondance se fait
   donc sur rate_plan_id, en cherchant celle qui pointe vers notre plan
   standard. C'est cette entrée, et elle seule, qu'on fait pointer vers le
   plan majoré. */
function trouverPlans(attrs) {
  if (Array.isArray(attrs.rate_plans)) return { chemin: 'rate_plans', liste: attrs.rate_plans };
  // Formes historiques, gardées par prudence.
  if (Array.isArray(attrs.mappings)) return { chemin: 'mappings', liste: attrs.mappings };
  if (attrs.settings && Array.isArray(attrs.settings.mappings)) {
    return { chemin: 'settings.mappings', liste: attrs.settings.mappings };
  }
  return null;
}

/* La liste /channels ne porte pas les mappings : il faut lire chaque canal
   individuellement. Un aller-retour de plus, mais c'est la seule source. */
async function listerCanaux(channex_property_id) {
  const res = await channexAPI.get('/channels', {
    params: { 'filter[property_id]': channex_property_id, 'pagination[page_size]': 100 }
  });
  const data = res.data?.data || [];
  const sommaire = Array.isArray(data) ? data : [];

  const complets = [];
  for (const c of sommaire) {
    let attrs = c.attributes || {};
    try {
      const detail = await channexAPI.get(`/channels/${c.id}`);
      attrs = detail.data?.data?.attributes || attrs;
    } catch (e) {
      console.warn(`⚠️ [MAPPING] Détail du canal ${c.id} illisible :`, e.response?.data || e.message);
    }
    complets.push({ id: c.id, attrs });
  }
  return complets;
}

/* ── Diagnostic, sans rien modifier ──────────────────────────────
   À appeler avant d'automatiser quoi que ce soit sur un compte : dit ce
   que Channex renvoie réellement pour ce logement. */
async function inspecterCanaux(pool, { property_id }) {
  const { rows } = await pool.query(
    `SELECT channex_property_id, channex_room_type_id, channex_rate_plan_id,
            COALESCE(platform_markups, '{}'::jsonb)          AS markups,
            COALESCE(channex_markup_rate_plans, '{}'::jsonb) AS plans
       FROM properties WHERE id = $1`,
    [property_id]
  );
  const p = rows[0];
  if (!p || !p.channex_property_id) return { erreur: 'Logement non connecté à Channex' };

  const canaux = await listerCanaux(p.channex_property_id);
  return {
    channex_property_id: p.channex_property_id,
    room_type_id: p.channex_room_type_id,
    plan_standard: p.channex_rate_plan_id,
    plans_majores: p.plans,
    majorations: p.markups,
    canaux: canaux.map((c) => {
      const m = trouverPlans(c.attrs);
      return {
        id: c.id,
        canal: c.attrs.channel || c.attrs.title || null,
        actif: c.attrs.is_active !== false,
        forme_mappings: m ? m.chemin : 'introuvable',
        // Vue lisible : quel plan de chez nous, derrière quels codes OTA.
        mappings: m ? m.liste.map((e) => ({
          entree_id: e.id,
          rate_plan_id: e.rate_plan_id,
          est_notre_plan_standard: e.rate_plan_id === p.channex_rate_plan_id,
          codes_ota: e.settings
            ? { room_type_code: e.settings.room_type_code, rate_plan_code: e.settings.rate_plan_code,
                listing_id: e.settings.listing_id }
            : null
        })) : null,
        cles_attributs: m ? undefined : Object.keys(c.attrs)
      };
    })
  };
}

/* ── Remappage ───────────────────────────────────────────────────
   Pour chaque plateforme majorée, on cherche le canal correspondant et on
   remplace, dans ses mappings de NOTRE room type, le rate_plan_id par
   celui du plan majoré. */
async function remapperPlansMajores(pool, { property_id, user_id }) {
  await assurerColonne(pool);

  const { rows } = await pool.query(
    `SELECT channex_property_id, channex_room_type_id, channex_rate_plan_id,
            COALESCE(platform_markups, '{}'::jsonb)          AS markups,
            COALESCE(channex_markup_rate_plans, '{}'::jsonb) AS plans,
            COALESCE(channex_mapping_backup, '{}'::jsonb)    AS backup
       FROM properties WHERE id = $1`,
    [property_id]
  );

  const p = rows[0];
  if (!p || !p.channex_property_id || !p.channex_room_type_id) return { faits: [], ignores: [] };

  const markups = p.markups || {};
  const plans = p.plans || {};
  const codesMajores = Object.keys(markups).filter((c) => parseFloat(markups[c]) > 0 && plans[c]);
  if (!codesMajores.length) return { faits: [], ignores: [] };

  let canaux;
  try {
    canaux = await listerCanaux(p.channex_property_id);
  } catch (e) {
    console.error('❌ [MAPPING] Lecture des canaux impossible :', e.response?.data || e.message);
    return { faits: [], ignores: [{ raison: 'lecture_canaux', detail: e.message }] };
  }

  const faits = [];
  const ignores = [];
  const backup = Object.assign({}, p.backup || {});

  for (const code of codesMajores) {
    const canal = canaux.find((c) => correspond(code, c.attrs.channel) || correspond(code, c.attrs.title));
    if (!canal) { ignores.push({ code, raison: 'canal_absent' }); continue; }

    const trouve = trouverPlans(canal.attrs);
    if (!trouve) {
      // Forme inattendue : on ne devine pas, on signale.
      console.warn(`⚠️ [MAPPING] ${code} : mappings introuvables, canal laissé intact.`,
        JSON.stringify(Object.keys(canal.attrs)));
      ignores.push({ code, raison: 'forme_inattendue', cles: Object.keys(canal.attrs) });
      continue;
    }

    const cible = plans[code];

    /* L'entrée à modifier est celle qui pointe vers notre plan standard.
       Un même canal sert plusieurs logements : les autres entrées appartiennent
       aux voisins et doivent être renvoyées telles quelles. */
    const concernes = trouve.liste.filter((m) => m && m.rate_plan_id === p.channex_rate_plan_id);
    if (!concernes.length) {
      const deja = trouve.liste.some((m) => m && m.rate_plan_id === cible);
      if (deja) { faits.push({ code, deja: true, rate_plan_id: cible }); continue; }
      ignores.push({ code, raison: 'plan_standard_non_mappe' });
      continue;
    }

    // Sauvegarde avant envoi : de quoi revenir en arrière.
    if (!backup[code]) {
      backup[code] = {
        canal_id: canal.id,
        chemin: trouve.chemin,
        mappings: JSON.parse(JSON.stringify(trouve.liste)),
        date: new Date().toISOString()
      };
    }

    // Seul rate_plan_id change ; les codes OTA de settings restent verbatim.
    const nouvelle = trouve.liste.map((m) =>
      (m && m.rate_plan_id === p.channex_rate_plan_id)
        ? Object.assign({}, m, { rate_plan_id: cible })
        : m
    );

    const corps = trouve.chemin === 'rate_plans'
      ? { channel: { rate_plans: nouvelle } }
      : trouve.chemin === 'mappings'
        ? { channel: { mappings: nouvelle } }
        : { channel: { settings: Object.assign({}, canal.attrs.settings, { mappings: nouvelle }) } };

    try {
      await channexAPI.put(`/channels/${canal.id}`, corps);
      faits.push({ code, rate_plan_id: cible, pct: parseFloat(markups[code]) });
      console.log(`✅ [MAPPING] ${code} remappé sur le plan +${markups[code]}% (${cible})`);
      await logChannex(pool, {
        user_id, property_id, channex_property_id: p.channex_property_id,
        event_type: 'remap_markup_plan',
        direction: 'outbound',
        payload: { plateforme: code, rate_plan_id: cible, majoration_pct: parseFloat(markups[code]) }
      });
    } catch (e) {
      const d = e.response?.data || e.message;
      console.error(`❌ [MAPPING] ${code} remappage échoué :`, d);
      ignores.push({ code, raison: 'envoi_refuse', detail: typeof d === 'string' ? d : JSON.stringify(d) });
      await logChannex(pool, {
        user_id, property_id, channex_property_id: p.channex_property_id,
        event_type: 'remap_markup_plan',
        direction: 'outbound',
        status: 'error',
        error_message: typeof d === 'string' ? d : JSON.stringify(d)
      });
    }
  }

  if (Object.keys(backup).length) {
    await pool.query('UPDATE properties SET channex_mapping_backup = $1 WHERE id = $2',
      [JSON.stringify(backup), property_id]);
  }

  return { faits, ignores };
}

/* ── Retour en arrière ───────────────────────────────────────────
   Restaure les mappings tels qu'ils étaient avant le premier remappage. */
async function restaurerMapping(pool, { property_id, code }) {
  const { rows } = await pool.query(
    `SELECT COALESCE(channex_mapping_backup, '{}'::jsonb) AS backup FROM properties WHERE id = $1`,
    [property_id]
  );
  const backup = (rows[0] && rows[0].backup) || {};
  const b = backup[code];
  if (!b) return { restaure: false, raison: 'aucune_sauvegarde' };

  const corps = b.chemin === 'rate_plans'
    ? { channel: { rate_plans: b.mappings } }
    : b.chemin === 'mappings'
      ? { channel: { mappings: b.mappings } }
      : { channel: { settings: { mappings: b.mappings } } };

  await channexAPI.put(`/channels/${b.canal_id}`, corps);
  console.log(`↩️ [MAPPING] ${code} restauré dans l'état du ${b.date}`);
  return { restaure: true, date: b.date };
}

module.exports = { inspecterCanaux, remapperPlansMajores, restaurerMapping };
