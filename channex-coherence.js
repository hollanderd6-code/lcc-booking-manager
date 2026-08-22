/* ============================================================
   channex-coherence.js — la vérification qui ferme les trois pièges
   ============================================================
   Un logement peut être « connecté » sans rien synchroniser. Trois causes,
   toutes silencieuses :

     1. ORDRE. La majoration est réglée avant que le canal soit mappé : le
        remappage ne trouve rien, le client mappe ensuite sur le tarif
        standard, et le plan majoré est ignoré pour toujours.
     2. ADRESSE. Deux logements d'un immeuble écrits différemment créent
        deux établissements ; corriger en détachant/rattachant produit le
        cas 3.
     3. DÉTACHEMENT. Le logement change d'établissement, mais ses mappings
        OTA restent accrochés à l'ancien plan tarifaire.

   Un seul mécanisme les couvre : comparer, canal par canal, le plan
   tarifaire mappé au plan que le logement devrait utiliser aujourd'hui.

   ── CE QUE « DEVRAIT UTILISER » VEUT DIRE ────────────────────────
   Pour une plateforme majorée : son plan majoré.
   Sinon : le plan standard du logement.
   Toute autre valeur est une anomalie, de deux sortes :
     - plan_obsolete : le plan mappé est un ancien plan à nous (standard
       alors qu'une majoration existe, ou plan majoré retiré depuis) ;
     - plan_orphelin : le plan mappé n'appartient à aucun de nos logements
       — vestige d'un ancien établissement.
   Les deux se réparent en faisant pointer l'entrée vers le bon plan. Les
   codes OTA (room_type_code, listing_id) ne sont jamais touchés.

   ── OÙ L'APPELER ─────────────────────────────────────────────────
   verifierCoherence(pool, { property_id, user_id })          → diagnostic
   verifierCoherence(pool, { property_id, user_id, reparer: true }) → répare

   Trois moments, dans le flux existant :
     - après addRoomTypeToProperty / connect-property (rattachement) ;
     - à la fermeture de la fenêtre du partenaire ;
     - après un PATCH de majoration.
   Idempotente : relancée, elle ne fait que ce qui manque.
   ============================================================ */

'use strict';

const { channexAPI, logChannex } = require('./channex');

const PLATEFORMES = {
  ABB: ['airbnb', 'abb'],
  BDC: ['bookingcom', 'booking', 'bdc'],
  EXP: ['expedia', 'exp'],
  VRB: ['homeaway', 'vrbo', 'vrb', 'abritel']
};

function codeDuCanal(attrs) {
  const v = String(attrs.channel || attrs.title || '').toLowerCase().replace(/[^a-z.]/g, '');
  for (const code of Object.keys(PLATEFORMES)) {
    if (PLATEFORMES[code].some((c) => v === c || v.indexOf(c) > -1)) return code;
  }
  return null;
}

async function canauxDetailles(channex_property_id) {
  const liste = await channexAPI.get('/channels', {
    params: { 'filter[property_id]': channex_property_id, 'pagination[page_size]': 100 }
  });
  const sommaire = liste.data?.data || [];
  const out = [];
  for (const c of (Array.isArray(sommaire) ? sommaire : [])) {
    let attrs = c.attributes || {};
    try {
      const d = await channexAPI.get(`/channels/${c.id}`);
      attrs = d.data?.data?.attributes || attrs;
    } catch (e) {
      console.warn(`⚠️ [COHERENCE] Canal ${c.id} illisible :`, e.response?.data || e.message);
    }
    out.push({ id: c.id, attrs });
  }
  return out;
}

async function verifierCoherence(pool, { property_id, user_id, reparer = false }) {
  const { rows } = await pool.query(
    `SELECT id, name, internal_name, address,
            channex_property_id, channex_room_type_id, channex_rate_plan_id,
            COALESCE(platform_markups, '{}'::jsonb)          AS markups,
            COALESCE(channex_markup_rate_plans, '{}'::jsonb) AS plans
       FROM properties WHERE id = $1`,
    [property_id]
  );
  const p = rows[0];
  if (!p || !p.channex_property_id || !p.channex_rate_plan_id) {
    return { verifie: false, raison: 'logement_non_connecte' };
  }

  const nom = p.internal_name || p.name;
  const markups = p.markups || {};
  const plansMajores = p.plans || {};

  // Tous nos plans, pour distinguer un plan à nous d'un plan orphelin.
  const { rows: tous } = await pool.query(
    `SELECT channex_rate_plan_id AS rp FROM properties
      WHERE user_id = $1 AND channex_rate_plan_id IS NOT NULL`,
    [user_id]
  );
  const nosPlans = new Set(tous.map((r) => r.rp));
  Object.keys(plansMajores).forEach((c) => nosPlans.add(plansMajores[c]));

  const planAttendu = (code) => {
    const pct = parseFloat(markups[code]);
    return (pct > 0 && plansMajores[code]) ? plansMajores[code] : p.channex_rate_plan_id;
  };

  let canaux;
  try {
    canaux = await canauxDetailles(p.channex_property_id);
  } catch (e) {
    return { verifie: false, raison: 'canaux_illisibles', detail: e.message };
  }

  const anomalies = [];
  const reparations = [];
  const conformes = [];

  for (const canal of canaux) {
    const code = codeDuCanal(canal.attrs);
    if (!code) continue;

    const entrees = Array.isArray(canal.attrs.rate_plans) ? canal.attrs.rate_plans : [];
    if (!entrees.length) {
      anomalies.push({ code, type: 'canal_sans_mapping',
        message: `${nom} n'est pas encore mappé sur ${code}. À faire dans la fenêtre du partenaire.` });
      continue;
    }

    const attendu = planAttendu(code);

    // Déjà conforme ?
    if (entrees.some((e) => e.rate_plan_id === attendu)) { conformes.push({ code, rate_plan_id: attendu }); continue; }

    /* L'entrée de CE logement est celle qui pointe vers l'un de nos plans
       possibles pour lui : son plan standard, ou l'un de ses plans majorés.
       Toute autre entrée appartient à un logement voisin du même
       établissement et doit être renvoyée intacte. */
    const siens = new Set([p.channex_rate_plan_id, ...Object.values(plansMajores)]);
    let entree = entrees.find((e) => siens.has(e.rate_plan_id));
    let type = 'plan_obsolete';

    if (!entree) {
      // Aucun de nos plans : reste-t-il une entrée orpheline, vestige d'un
      // ancien établissement ? Une seule candidate, sinon on ne devine pas.
      const orphelines = entrees.filter((e) => !nosPlans.has(e.rate_plan_id));
      if (orphelines.length === 1) { entree = orphelines[0]; type = 'plan_orphelin'; }
    }

    if (!entree) {
      anomalies.push({ code, type: 'entree_introuvable',
        message: `Sur ${code}, aucune entrée ne correspond à ${nom}. Mapping à faire ou à vérifier à la main.` });
      continue;
    }

    const explication = type === 'plan_orphelin'
      ? `Sur ${code}, ${nom} pointe vers un plan hérité d'un ancien établissement.`
      : parseFloat(markups[code]) > 0
        ? `Sur ${code}, ${nom} lit encore le tarif standard alors qu'une majoration de ${markups[code]} % est réglée.`
        : `Sur ${code}, ${nom} lit un plan majoré alors qu'aucune majoration n'est réglée.`;

    if (!reparer) {
      anomalies.push({ code, type, message: explication,
        plan_actuel: entree.rate_plan_id, plan_attendu: attendu });
      continue;
    }

    const nouvelles = entrees.map((e) =>
      e === entree ? Object.assign({}, e, { rate_plan_id: attendu }) : e
    );

    try {
      await channexAPI.put(`/channels/${canal.id}`, { channel: { rate_plans: nouvelles } });

      /* Channex accepte le PUT puis l'annule quand le mapping traverserait
         deux établissements : l'annonce est déclarée sous l'un, le plan
         appartient à l'autre. La réponse est 200 et rien n'a changé. On
         relît donc pour savoir si la correction a tenu — sans ça, on
         annoncerait une réparation imaginaire et on retenterait sans fin. */
      let tenu = false;
      try {
        const relu = await channexAPI.get(`/channels/${canal.id}`);
        const apres = relu.data?.data?.attributes?.rate_plans || [];
        tenu = apres.some((e) => e.rate_plan_id === attendu);
      } catch (e) { tenu = true; }   // illisible : on ne crie pas au loup

      if (!tenu) {
        console.warn(`⚠️ [COHERENCE] ${nom} · ${code} : Channex a annulé la correction.`);
        anomalies.push({
          code, type: 'refus_silencieux', plan_actuel: entree.rate_plan_id, plan_attendu: attendu,
          message: `Sur ${code}, l'annonce de ${nom} est rattachée à un ancien établissement et ne peut ` +
            `pas être corrigée automatiquement. Dans la fenêtre du partenaire : supprimez sa ligne, ` +
            `enregistrez, puis recréez-la — elle se rattachera au bon établissement.`
        });
        await logChannex(pool, {
          user_id, property_id, channex_property_id: p.channex_property_id,
          event_type: 'coherence_repair',
          direction: 'outbound',
          status: 'error',
          error_message: `refus silencieux ${code} : ${entree.rate_plan_id} → ${attendu}`
        });
        continue;
      }

      reparations.push({ code, type, avant: entree.rate_plan_id, apres: attendu });
      console.log(`✅ [COHERENCE] ${nom} · ${code} : ${type} corrigé → ${attendu}`);
      await logChannex(pool, {
        user_id, property_id, channex_property_id: p.channex_property_id,
        event_type: 'coherence_repair',
        direction: 'outbound',
        payload: { plateforme: code, type, avant: entree.rate_plan_id, apres: attendu }
      });
    } catch (e) {
      const d = e.response?.data || e.message;
      console.error(`❌ [COHERENCE] ${nom} · ${code} réparation refusée :`, d);
      anomalies.push({ code, type, message: explication, echec_reparation: true,
        detail: typeof d === 'string' ? d : JSON.stringify(d) });
    }
  }

  return {
    verifie: true,
    logement: nom,
    sans_adresse: !String(p.address || '').trim(),
    conformes,
    anomalies,
    reparations,
    // Ce qui ne peut PAS être réparé automatiquement : à dire à l'utilisateur.
    action_utilisateur: anomalies
      .filter((a) => a.type === 'canal_sans_mapping' || a.type === 'entree_introuvable'
        || a.type === 'refus_silencieux' || a.echec_reparation)
      .map((a) => a.message)
  };
}

module.exports = { verifierCoherence };
