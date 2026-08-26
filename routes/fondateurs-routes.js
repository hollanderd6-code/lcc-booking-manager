// ============================================================
// PROGRAMME FONDATEURS — page de candidature + API
// ============================================================
// Exposition :
//   setupFondateursRoutes(app, pool, sendEmailViaBrevo)
//
// Routes :
//   GET  /f/:slug                      → page de candidature (noindex)
//   GET  /api/fondateurs/places        → places prises / restantes
//   POST /api/fondateurs/candidature   → enregistre une candidature
//
// La page n'est liée depuis nulle part : seul le lien distribué y donne accès.
// Un slug par canal permet de savoir d'où viennent les candidatures.
// ============================================================

'use strict';

const path = require('path');
const fs = require('fs');

// ── Configuration ────────────────────────────────────────────

const PLACES = 10;

// Date de clôture des candidatures (format ISO). Après cette date, la page
// affiche « candidatures closes » et l'API refuse les envois.
const CLOTURE = '2026-09-13';


const ADMIN_EMAIL = process.env.FONDATEURS_EMAIL
  || process.env.ADMIN_EMAIL
  || 'contact@boostinghost.fr';

// Ajoute une ligne par groupe Facebook / canal de diffusion.
// La clé est le slug de l'URL, la valeur est l'étiquette stockée en base.
const CANAUX = {
  'prog-fond-2026'   : 'Lien direct',
  'gr-conciergeries' : 'FB · Conciergeries',
  'gr-loueurs-idf'   : 'FB · Loueurs IDF',
  'gr-airbnb-hosts'  : 'FB · Hôtes Airbnb',
  'hosterzz'         : 'Hosterzz',
  'mail'             : 'Prospection email'
};

// ── Helpers ──────────────────────────────────────────────────

function segmentDe(logements) {
  if (logements === '1 à 2' || logements === '3 à 5') return 'PARTICULIER';
  if (logements === '6 à 15') return 'PETITE CONCIERGERIE';
  if (logements === '16 à 40' || logements === 'Plus de 40') return 'GROSSE CONCIERGERIE';
  return 'À QUALIFIER';
}

function quotaDe(segment) {
  return { 'PARTICULIER': 3, 'PETITE CONCIERGERIE': 5, 'GROSSE CONCIERGERIE': 2 }[segment] || 0;
}

function propre(v, max) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max || 500);
}

// Clôture à 23h59 (heure de Paris ≈ UTC+2 en septembre)
function estClos() {
  return Date.now() > new Date(CLOTURE + 'T21:59:59Z').getTime();
}

function clotureEnFrancais() {
  return new Date(CLOTURE + 'T12:00:00Z').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris'
  });
}

function ilYA(date) {
  const min = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
  if (min < 2) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.floor(h / 24);
  return j === 1 ? 'hier' : `il y a ${j} jours`;
}

function libelleSegment(segment) {
  return {
    'PARTICULIER': 'Un propriétaire',
    'PETITE CONCIERGERIE': 'Une petite conciergerie',
    'GROSSE CONCIERGERIE': 'Une structure établie'
  }[segment] || 'Un gestionnaire';
}

// Limite simple par IP : 3 candidatures par heure
const tentatives = new Map();
function tropDeTentatives(ip) {
  const maintenant = Date.now();
  const fenetre = 60 * 60 * 1000;
  const liste = (tentatives.get(ip) || []).filter(t => maintenant - t < fenetre);
  if (liste.length >= 3) return true;
  liste.push(maintenant);
  tentatives.set(ip, liste);
  if (tentatives.size > 5000) tentatives.clear();
  return false;
}

async function initTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS founder_applications (
      id              SERIAL PRIMARY KEY,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      nom             TEXT NOT NULL,
      email           TEXT NOT NULL UNIQUE,
      telephone       TEXT NOT NULL,
      structure       TEXT,
      ville           TEXT NOT NULL,
      logements       TEXT NOT NULL,
      segment         TEXT NOT NULL,
      gestion         TEXT,
      intervenants    TEXT,
      plateformes     TEXT,
      outil_actuel    TEXT,
      perte_temps     TEXT,
      logiciel_manque TEXT,
      demarrage       TEXT,
      canal           TEXT,
      ip              TEXT,
      statut          TEXT DEFAULT 'nouveau',
      notes           TEXT
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_founder_apps_statut ON founder_applications(statut)`);
  console.log('✅ Table founder_applications prête');
}

// ── Setup ────────────────────────────────────────────────────

function setupFondateursRoutes(app, pool, sendEmailViaBrevo) {

  initTable(pool).catch(e => console.error('❌ founder_applications :', e.message));

  const pageePath = path.join(__dirname, '..', 'views', 'fondateurs.html');
  let pageCache = null;

  function lirePage() {
    if (!pageCache || process.env.NODE_ENV !== 'production') {
      pageCache = fs.readFileSync(pageePath, 'utf8');
    }
    return pageCache;
  }

  // ── Page de candidature ────────────────────────────────────
  app.get('/f/:slug', (req, res) => {
    const slug = String(req.params.slug || '').toLowerCase();
    const canal = CANAUX[slug];
    if (!canal) return res.status(404).send('Page introuvable');

    res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.type('html').send(
      lirePage().replace('<body>', `<body data-canal="${canal.replace(/"/g, '')}">`)
    );
  });

  // ── Compteur de places, d'activité et de clôture ───────────
  app.get('/api/fondateurs/places', async (req, res) => {
    const base = {
      total: PLACES, prises: 0, restantes: PLACES,
      candidatures: null, derniere: null,
      cloture: clotureEnFrancais(), close: estClos()
    };
    try {
      const r = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE statut = 'accepte')::int AS acceptes,
          COUNT(*)::int AS total
        FROM founder_applications
      `);
      const acceptes = r.rows[0].acceptes;
      base.prises = acceptes;
      base.restantes = Math.max(0, PLACES - acceptes);

      // Nombre réel de candidatures reçues
      base.candidatures = r.rows[0].total;

      // Dernière candidature, anonymisée (moins de 7 jours)
      const d = await pool.query(`
        SELECT segment, created_at FROM founder_applications
        WHERE created_at > NOW() - INTERVAL '7 days'
        ORDER BY created_at DESC LIMIT 1
      `);
      if (d.rows.length) {
        base.derniere = {
          libelle: libelleSegment(d.rows[0].segment),
          quand: ilYA(d.rows[0].created_at)
        };
      }
      res.json(base);
    } catch (e) {
      res.json(base);
    }
  });

  // ── Réception d'une candidature ────────────────────────────
  app.post('/api/fondateurs/candidature', async (req, res) => {
    try {
      const b = req.body || {};

      // Piège à robots : le champ "site" doit rester vide
      if (b.site) return res.json({ ok: true });

      if (estClos()) {
        return res.status(410).json({ error: 'Les candidatures sont closes depuis le ' + clotureEnFrancais() + '.' });
      }

      const ip = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
      if (tropDeTentatives(ip)) {
        return res.status(429).json({ error: 'Trop de tentatives, réessayez plus tard.' });
      }

      const nom = propre(b.nom, 120);
      const email = propre(b.email, 160);
      const telephone = propre(b.telephone, 40);
      const ville = propre(b.ville, 120);
      const logements = propre(b.logements, 40);

      if (!nom || !email || !telephone || !ville || !logements) {
        return res.status(400).json({ error: 'Champs obligatoires manquants.' });
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return res.status(400).json({ error: 'Adresse email invalide.' });
      }

      const segment = segmentDe(logements);
      const plateformes = Array.isArray(b.plateformes) ? b.plateformes.join(', ') : propre(b.plateformes, 300);

      const ins = await pool.query(`
        INSERT INTO founder_applications
          (nom, email, telephone, structure, ville, logements, segment, gestion,
           intervenants, plateformes, outil_actuel, perte_temps, logiciel_manque,
           demarrage, canal, ip)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        ON CONFLICT (email) DO NOTHING
        RETURNING id
      `, [
        nom, email.toLowerCase(), telephone, propre(b.structure, 160), ville,
        logements, segment, propre(b.gestion, 80), propre(b.intervenants, 80),
        plateformes, propre(b.outil_actuel, 120), propre(b.perte_temps, 1500),
        propre(b.logiciel_manque, 1500), propre(b.demarrage, 60),
        propre(b.canal, 80) || 'direct', ip
      ]);

      if (!ins.rows.length) {
        return res.status(409).json({ error: 'deja_candidate' });
      }

      // ── Notification interne ────────────────────────────────
      const dejaSegment = await pool.query(
        `SELECT COUNT(*)::int AS n FROM founder_applications WHERE segment = $1 AND statut = 'accepte'`,
        [segment]
      );

      const corps = [
        `Segment : ${segment} (${dejaSegment.rows[0].n}/${quotaDe(segment)} places prises)`,
        `Canal   : ${propre(b.canal, 80) || 'direct'}`,
        ``,
        `${nom}${b.structure ? ' — ' + b.structure : ''}`,
        `${email} · ${telephone} · ${ville}`,
        ``,
        `Logements    : ${logements}`,
        `Gère         : ${b.gestion || '—'}`,
        `Intervenants : ${b.intervenants || '—'}`,
        `Plateformes  : ${plateformes || '—'}`,
        `Outil actuel : ${b.outil_actuel || '—'}`,
        `Démarrage    : ${b.demarrage || '—'}`,
        ``,
        `── Ce qui lui fait perdre du temps ──`,
        b.perte_temps || '—',
        ``,
        `── Ce qui lui manque dans son outil ──`,
        b.logiciel_manque || '—',
        ``,
        `───────────────`,
        `Répondre sous 72 h, refus compris.`
      ].join('\n');

      try {
        await sendEmailViaBrevo({
          to: ADMIN_EMAIL,
          subject: `[Fondateurs] ${nom} — ${segment}`,
          text: corps
        });
      } catch (e) {
        console.error('⚠️ Notification Fondateurs non envoyée :', e.message);
      }

      // ── Accusé de réception au candidat ─────────────────────
      try {
        await sendEmailViaBrevo({
          to: email,
          subject: 'Votre candidature au programme Fondateurs',
          text: [
            `Bonjour ${nom.split(' ')[0]},`,
            ``,
            `J'ai bien reçu votre candidature au programme Fondateurs de Boostinghost.`,
            ``,
            `Je lis chaque réponse moi-même. Vous aurez ma réponse sous 72 heures,`,
            `que votre candidature soit retenue ou non — et si elle ne l'est pas,`,
            `je vous dirai pourquoi.`,
            ``,
            `À très vite,`,
            `Charles`,
            `Boostinghost`
          ].join('\n')
        });
      } catch (e) {
        console.error('⚠️ Accusé de réception non envoyé :', e.message);
      }

      res.json({ ok: true, id: ins.rows[0].id });

    } catch (e) {
      console.error('❌ POST /api/fondateurs/candidature :', e);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  console.log('✅ Routes Fondateurs montées — slugs :', Object.keys(CANAUX).map(s => '/f/' + s).join(' '));
}

module.exports = { setupFondateursRoutes };
