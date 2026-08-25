#!/usr/bin/env node
/* ============================================================
   outils/agence-conversations.js
   Les conversations, ouvertes aux comptes gérés
   ============================================================
   Cibles : routes/chat_routes.js
            server.js

   ── TROIS DEFAUTS, TROIS EFFETS ──────────────────────────────────

   1. POST /api/chat/create-for-reservation
      La conversation est creee sous « req.user.id ». En mode agence,
      elle appartient donc a l'AGENCE, alors que le logement est au
      client. Le voyageur recoit bien son lien, mais la conversation
      n'apparait jamais dans la messagerie du proprietaire — et les
      declencheurs de templates, qui lisent sous « conv.user_id »,
      travaillent sur le mauvais compte.

   2. POST /api/chat/toggle-ai/:conversationId
      Le controle « WHERE id = $1 AND user_id = $2 » echoue : le
      gestionnaire recoit « Conversation non trouvée » sur une
      conversation bien reelle. L'IA ne se coupe pas.

   3. POST /api/host/conversations/:id/send
      Meme controle, meme echec : « Accès refusé » a l'envoi d'un
      message. C'est le plus visible des trois — un gestionnaire ne peut
      pas repondre a un voyageur.

   ── LA CORRECTION ────────────────────────────────────────────────
   Un resolveur par nature d'objet :

     compteDuLogement(pool, req, propertyId)
       pour la creation : la conversation naitra sous le proprietaire du
       logement, celui que les declencheurs interrogeront.

     accesConversation(pool, req, convId)
       pour les deux autres : la conversation est accessible si elle est
       a l'utilisateur, ou a un compte qu'il gere.

   Dans les deux cas, la delegation est verifiee en base contre
   « account_delegations ». Elargir sans verifier ouvrirait les
   conversations de toute la plateforme : la correction serait pire que
   le defaut.

   ── UN DETAIL QUI COMPTE ─────────────────────────────────────────
   A l'envoi, le nom de l'expediteur reste celui de la personne
   connectee — pas celui du proprietaire. Le voyageur voit qui lui
   ecrit ; substituer le nom du client serait un mensonge, et le
   gestionnaire ne pourrait plus etre identifie dans l'historique.

   Usage :
     node outils/agence-conversations.js --essai
     node outils/agence-conversations.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const CHAT = path.join(process.cwd(), 'routes', 'chat_routes.js');
const SERVER = path.join(process.cwd(), 'server.js');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

for (const f of [CHAT, SERVER]) {
  if (!fs.existsSync(f)) echec(f + ' introuvable. Lancez depuis la racine du depot.');
}

let chat = fs.readFileSync(CHAT, 'utf8');
let srv = fs.readFileSync(SERVER, 'utf8');

if (chat.indexOf('accesConversation') !== -1 || srv.indexOf('accesConversation') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

const AIDE = `
/* Sous quel compte agir, en mode agence ? « req.user.id » est l'agence, alors
   que le logement et la conversation sont au client. Une conversation creee
   sous l'agence n'apparait jamais dans la messagerie du proprietaire, et les
   declencheurs de templates — qui lisent sous « conv.user_id » — travaillent
   sur le mauvais compte.

   La delegation est verifiee en base : elargir sans verifier ouvrirait les
   conversations de toute la plateforme. */
async function _gere(pool, moi, proprio) {
  if (proprio === moi) return true;
  const { rows } = await pool.query(
    \`SELECT 1 FROM account_delegations
       WHERE delegate_user_id = $1 AND delegator_user_id = $2 AND status = 'accepted'\`,
    [moi, proprio]
  );
  return rows.length > 0;
}

async function compteDuLogement(pool, req, propertyId) {
  const moi = req.user && (req.user.id || req.user.userId);
  if (!propertyId) return { userId: moi };
  const { rows } = await pool.query('SELECT user_id FROM properties WHERE id = $1', [propertyId]);
  if (!rows.length) return { erreur: 'Logement introuvable', code: 404 };
  if (!(await _gere(pool, moi, rows[0].user_id))) {
    return { erreur: 'Ce logement ne fait pas partie des comptes que vous gérez', code: 403 };
  }
  return { userId: rows[0].user_id };
}

async function accesConversation(pool, req, convId) {
  const moi = req.user && (req.user.id || req.user.userId);
  const { rows } = await pool.query('SELECT user_id FROM conversations WHERE id = $1', [convId]);
  if (!rows.length) return { erreur: 'Conversation non trouvée', code: 404 };
  if (!(await _gere(pool, moi, rows[0].user_id))) {
    return { erreur: 'Accès refusé', code: 403 };
  }
  return { userId: rows[0].user_id };
}
`;

/* ════════ chat_routes.js ════════ */
const EDITS_CHAT = [
  ['creation : identifiant du proprietaire',
`    try {
      const userId = req.user.id;
      const { property_id, reservation_start_date, reservation_end_date, platform, guest_name, guest_email } = req.body;

      if (!property_id || !reservation_start_date) {
        return res.status(400).json({ error: 'property_id et reservation_start_date requis' });
      }`,
`    try {
      const { property_id, reservation_start_date, reservation_end_date, platform, guest_name, guest_email } = req.body;

      if (!property_id || !reservation_start_date) {
        return res.status(400).json({ error: 'property_id et reservation_start_date requis' });
      }

      /* La conversation naitra sous le proprietaire du logement : c'est ce
         compte que les declencheurs de templates interrogeront. */
      const _c = await compteDuLogement(pool, req, property_id);
      if (_c.erreur) return res.status(_c.code).json({ error: _c.erreur });
      const userId = _c.userId;`],

  ['toggle-ai : acces elargi',
`      const { conversationId } = req.params;
      const userId = req.user.id;
      // Vérifier que la conversation appartient à l'utilisateur
      const conv = await pool.query('SELECT id, ai_disabled FROM conversations WHERE id = $1 AND user_id = $2', [conversationId, userId]);
      if (!conv.rows.length) return res.status(404).json({ error: 'Conversation non trouvée' });`,
`      const { conversationId } = req.params;
      /* Le controle « AND user_id = $2 » echouait en mode agence : le
         gestionnaire recevait « Conversation non trouvée » sur une
         conversation bien reelle, et l'IA ne se coupait pas. */
      const _a = await accesConversation(pool, req, conversationId);
      if (_a.erreur) return res.status(_a.code).json({ error: _a.erreur });
      const conv = await pool.query('SELECT id, ai_disabled FROM conversations WHERE id = $1', [conversationId]);
      if (!conv.rows.length) return res.status(404).json({ error: 'Conversation non trouvée' });`],
];

const m = chat.match(/module\.exports\s*=\s*(?:function|\()[^{]*\{/);
if (!m) echec('chat_routes.js : point d\'insertion introuvable.');

for (const [nom, ancien] of EDITS_CHAT) {
  const n = chat.split(ancien).length - 1;
  if (n !== 1) echec('chat_routes.js \u00b7 ' + nom + ' : ' + n + ' occurrence(s), 1 attendue.');
}
for (const [, ancien, nouveau] of EDITS_CHAT) chat = chat.split(ancien).join(nouveau);
chat = chat.replace(m[0], m[0] + AIDE);

/* ════════ server.js ════════ */
const A_SRV = `    const convCheck = await pool.query(
      'SELECT c.*, p.name AS property_name FROM conversations c LEFT JOIN properties p ON p.id = c.property_id WHERE c.id = $1 AND c.user_id = $2',
      [convId, req.user.id]
    );
    if (!convCheck.rows[0]) return res.status(403).json({ error: 'Accès refusé' });`;

const N_SRV = `    /* « AND c.user_id = $2 » refusait l'envoi a un gestionnaire d'agence :
       impossible de repondre a un voyageur sur un logement gere. */
    const _a = await accesConversation(pool, req, convId);
    if (_a.erreur) return res.status(_a.code).json({ error: _a.erreur });
    const convCheck = await pool.query(
      'SELECT c.*, p.name AS property_name FROM conversations c LEFT JOIN properties p ON p.id = c.property_id WHERE c.id = $1',
      [convId]
    );
    if (!convCheck.rows[0]) return res.status(404).json({ error: 'Conversation non trouvée' });`;

if (srv.split(A_SRV).length - 1 !== 1) echec('server.js : controle d\'acces de /send introuvable.');
srv = srv.split(A_SRV).join(N_SRV);

/* L'aide, posee avant la premiere route qui l'utilise. */
const ANCRE = `app.post('/api/host/conversations/:id/send', authenticateToken, async (req, res) => {`;
if (srv.split(ANCRE).length - 1 !== 1) echec('server.js : ancre de la route /send introuvable.');
srv = srv.split(ANCRE).join(AIDE + '\n' + ANCRE);

for (const [nom, s] of [['chat_routes.js', chat], ['server.js', srv]]) {
  try { new Function(s); }
  catch (e) { echec(nom + ' : JavaScript invalide — ' + e.message); }
}

if (!ESSAI) {
  fs.writeFileSync(CHAT, chat, 'utf8');
  fs.writeFileSync(SERVER, srv, 'utf8');
  for (const [nom, f] of [['chat_routes.js', CHAT], ['server.js', SERVER]]) {
    if (fs.readFileSync(f, 'utf8').indexOf('accesConversation') === -1) {
      echec(nom + ' : la correction n\'est pas dans le fichier apres ecriture.');
    }
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  chat_routes.js \u00b7 creation sous le proprietaire, toggle-ai elargi');
console.log('  server.js      \u00b7 envoi de message autorise aux comptes geres\n');
console.log('  Le nom de l\'expediteur reste celui de la personne connectee :');
console.log('  le voyageur voit qui lui ecrit, et l\'historique reste lisible.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
