// ============================================
// 🚀 GROQ AI — Moteur de réponse intelligent
// Architecture : Groq-first, contexte temporel, few-shot learning
// ============================================

const fetch = require('node-fetch');

const GROQ_API_KEY = process.env.GROQ_API_KEY || null;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// ─────────────────────────────────────────────
// Formateurs de données du livret
// ─────────────────────────────────────────────

function formatRestaurants(restaurants) {
  if (!Array.isArray(restaurants) || restaurants.length === 0) return null;
  return restaurants.filter(r => r.name).map(r => {
    let line = `• ${r.name}`;
    if (r.address) line += ` — ${r.address}`;
    if (r.phone) line += ` (${r.phone})`;
    if (r.description) line += ` : ${r.description}`;
    return line;
  }).join('\n');
}

function formatPlaces(places) {
  if (!Array.isArray(places) || places.length === 0) return null;
  return places.filter(p => p.name).map(p => {
    let line = `• ${p.name}`;
    if (p.description) line += ` : ${p.description}`;
    return line;
  }).join('\n');
}

function formatRooms(rooms) {
  if (!Array.isArray(rooms) || rooms.length === 0) return null;
  return rooms.filter(r => r.name).map(r => {
    let line = `• ${r.name}`;
    if (r.description) line += ` : ${r.description}`;
    return line;
  }).join('\n');
}

// ─────────────────────────────────────────────
// Calcul du contexte temporel précis
// ─────────────────────────────────────────────

function buildTemporalContext(ctx) {
  const now = new Date();
  const checkin  = ctx.checkinDt  ? new Date(ctx.checkinDt)  : null;
  const checkout = ctx.checkoutDt ? new Date(ctx.checkoutDt) : null;

  // ⚠️ timeZone explicite : sans ça, le serveur (Render = UTC) donne l'heure UTC à l'IA,
  // qui résout alors les heures relatives ("dans 30 min") contre une horloge décalée.
  const TZ = 'Europe/Paris';
  const fmtDate = (d) => d ? d.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', timeZone: TZ }) : null;
  const fmtTime = (d) => d ? d.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', timeZone: TZ }) : null;

  let phase = 'before';
  let daysUntilCheckin = null;
  let hoursUntilCheckin = null;
  let daysAfterCheckout = null;
  let isCheckinDay = false;
  let isCheckoutDay = false;

  if (checkin && checkout) {
    const today = new Date(); today.setHours(0,0,0,0);
    const checkinDay  = new Date(checkin);  checkinDay.setHours(0,0,0,0);
    const checkoutDay = new Date(checkout); checkoutDay.setHours(0,0,0,0);
    isCheckinDay  = today.getTime() === checkinDay.getTime();
    isCheckoutDay = today.getTime() === checkoutDay.getTime();

    if (now >= checkout && !isCheckoutDay) {
      phase = 'after';
      daysAfterCheckout = Math.floor((now - checkout) / (1000*60*60*24));
    } else if (now >= checkin || isCheckoutDay) {
      phase = 'during';
    } else {
      phase = 'before';
      daysUntilCheckin  = Math.ceil((checkin - now) / (1000*60*60*24));
      hoursUntilCheckin = Math.round((checkin - now) / (1000*60*60));
    }
  }

  const lines = [];
  lines.push(`- Date/heure actuelle : ${now.toLocaleDateString('fr-FR', {weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:TZ})} à ${fmtTime(now)}`);
  if (checkin)  lines.push(`- Date d'arrivée prévue : ${fmtDate(checkin)} (check-in à partir de ${ctx.arrivalTime || '15h00'})`);
  if (checkout) lines.push(`- Date de départ prévue : ${fmtDate(checkout)} (check-out avant ${ctx.departureTime || '11h00'})`);

  if (phase === 'before') {
    if (isCheckinDay) {
      lines.push(`- Phase : JOUR J D'ARRIVÉE — le voyageur arrive AUJOURD'HUI. Traiter ses messages comme s'il était sur le point d'arriver.`);
    } else if (daysUntilCheckin === 1) {
      lines.push(`- Phase : AVANT ARRIVÉE — arrivée DEMAIN. ${hoursUntilCheckin}h environ avant le check-in.`);
    } else {
      lines.push(`- Phase : AVANT ARRIVÉE — dans ${daysUntilCheckin} jours.`);
    }
  } else if (phase === 'during') {
    if (isCheckinDay && isCheckoutDay) {
      lines.push(`- Phase : EN COURS DE SÉJOUR — JOUR D'ARRIVÉE ET DE DÉPART (séjour d'une nuit). Le voyageur arrive AUJOURD'HUI et part DEMAIN. Ne pas dire "à demain pour votre arrivée" — l'arrivée c'est AUJOURD'HUI.`);
    } else if (isCheckinDay) {
      lines.push(`- Phase : EN COURS DE SÉJOUR — c'est le JOUR D'ARRIVÉE. Le voyageur arrive AUJOURD'HUI (pas demain). Le départ est le ${fmtDate(checkout)}.`);
    } else if (isCheckoutDay) {
      lines.push(`- Phase : EN COURS DE SÉJOUR — JOUR DE DÉPART aujourd'hui. Les messages de retard concernent le DÉPART, pas l'arrivée.`);
    } else {
      lines.push(`- Phase : EN COURS DE SÉJOUR.`);
    }
  } else {
    lines.push(`- Phase : APRÈS DÉPART — séjour terminé il y a ${daysAfterCheckout || '?'} jour(s).`);
  }

  return { text: lines.join('\n'), phase, isCheckinDay, isCheckoutDay, daysUntilCheckin };
}

// ─────────────────────────────────────────────
// Résolution FIABLE d'une heure relative ("dans 30 min", "dans 1h30"…)
// Le calcul est fait ICI (heure de Paris), pas par le LLM — les modèles se
// trompent souvent sur l'arithmétique horaire. Renvoie { matched, timeLabel } ou null.
// ─────────────────────────────────────────────
const _WORD_NUM = { 'quarante-cinq':45,'quarante':40,'cinquante':50,'trente':30,'vingt':20,'quinze':15,'douze':12,'onze':11,'dix':10,'neuf':9,'huit':8,'sept':7,'cinq':5,'quatre':4,'trois':3,'deux':2,'une':1,'un':1 };
function _numFr(s) {
  if (s == null) return null;
  s = String(s).trim().toLowerCase();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return _WORD_NUM[s] != null ? _WORD_NUM[s] : null;
}
function resolveRelativeTime(text, now) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  const numPat = '(\\d{1,3}|' + Object.keys(_WORD_NUM).join('|') + ')';
  let addMin = null, matched = null, m;

  // "dans 1h30", "dans 1 h 30"
  m = t.match(/\b(?:dans|in)\s+(\d{1,2})\s*h(?:eures?)?\s*(\d{1,2})\b/);
  if (m) { addMin = parseInt(m[1],10)*60 + parseInt(m[2],10); matched = m[0]; }

  // "dans une demi-heure", "dans 1/2 heure"
  if (addMin == null) {
    m = t.match(/\b(?:dans|in)\s+(?:une\s+)?demi[-\s]?heure\b/) || t.match(/\bdans\s+1\/2\s*h(?:eure)?\b/);
    if (m) { addMin = 30; matched = m[0]; }
  }
  // "dans X heure(s)" / "in X hour(s)" / "dans Xh"
  if (addMin == null) {
    m = t.match(new RegExp('\\b(?:dans|in)\\s+' + numPat + '\\s*(?:h\\b|heures?\\b|hours?\\b|hr\\b)'));
    if (m) { const n = _numFr(m[1]); if (n != null) { addMin = n*60; matched = m[0]; } }
  }
  // "dans X minute(s)" / "in X min"
  if (addMin == null) {
    m = t.match(new RegExp('\\b(?:dans|in)\\s+' + numPat + '\\s*(?:min\\b|mins?\\b|minutes?\\b|mn\\b)'));
    if (m) { const n = _numFr(m[1]); if (n != null) { addMin = n; matched = m[0]; } }
  }

  if (addMin == null || addMin <= 0 || addMin > 24*60) return null;
  const target = new Date(now.getTime() + addMin*60*1000);
  const timeLabel = target
    .toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', timeZone:'Europe/Paris' })
    .replace(':', 'h');
  return { matched: String(matched).trim(), timeLabel, addMin };
}

// ─────────────────────────────────────────────
// Construction du prompt système
// ─────────────────────────────────────────────

function buildSystemPrompt(ctx, temporalCtx, fewShotExamples) {
  const lang = ctx.language || 'auto';
  const languageInstructions = {
    fr:   'Tu DOIS répondre en FRANÇAIS, quelle que soit la langue du contexte ci-dessous.',
    en:   'You MUST reply in ENGLISH only. The property data below is in French for reference — never use French in your reply.',
    es:   'DEBES responder ÚNICAMENTE en ESPAÑOL.',
    de:   'Du MUSST auf DEUTSCH antworten.',
    it:   'DEVI rispondere SOLO in ITALIANO.',
    pt:   'DEVES responder APENAS em PORTUGUÊS.',
    nl:   'Je MOET ALLEEN in het NEDERLANDS antwoorden.',
    auto: 'CRITIQUE : Détecte la langue du message du voyageur et réponds UNIQUEMENT dans cette langue. Les données du logement ci-dessous sont en français à titre de référence uniquement.',
  };

  // ── Bloc données logement ──────────────────
  const sections = [];

  const basicInfo = [];
  if (ctx.propertyName)       basicInfo.push(`- Nom : ${ctx.propertyName}`);
  if (ctx.address)            basicInfo.push(`- Adresse complète : ${ctx.address}`);
  if (ctx.welcomeDescription) basicInfo.push(`- Présentation : ${ctx.welcomeDescription}`);
  if (ctx.contactPhone)       basicInfo.push(`- Téléphone contact : ${ctx.contactPhone}`);
  if (basicInfo.length) sections.push(`LOGEMENT :\n${basicInfo.join('\n')}`);

  const stayInfo = [];
  if (ctx.arrivalTime)         stayInfo.push(`- Check-in à partir de : ${ctx.arrivalTime}`);
  if (ctx.departureTime)       stayInfo.push(`- Check-out avant : ${ctx.departureTime}`);
  if (ctx.checkoutInstructions) stayInfo.push(`- Instructions de départ : ${ctx.checkoutInstructions}`);
  if (ctx.wifiName)            stayInfo.push(`- Réseau WiFi : ${ctx.wifiName}`);
  if (ctx.wifiPassword)        stayInfo.push(`- Mot de passe WiFi : ${ctx.wifiPassword}`);
  if (stayInfo.length) sections.push(`SÉJOUR :\n${stayInfo.join('\n')}`);

  const accessInfo = [];
  if (ctx.accessCode)         accessInfo.push(`- Code d'accès / boîte à clés : ${ctx.accessCode}`);
  if (ctx.accessInstructions) accessInfo.push(`- Instructions d'accès : ${ctx.accessInstructions}`);
  if (ctx.parkingInfo)        accessInfo.push(`- Parking : ${ctx.parkingInfo}`);
  if (ctx.extraNotesAccess)   accessInfo.push(`- Notes accès : ${ctx.extraNotesAccess}`);
  if (accessInfo.length) sections.push(`ACCÈS :\n${accessInfo.join('\n')}`);

  const homeInfo = [];
  const roomsFmt = formatRooms(ctx.rooms);
  if (roomsFmt)               homeInfo.push(`- Pièces :\n${roomsFmt}`);
  if (ctx.equipmentList)      homeInfo.push(`- Équipements disponibles : ${ctx.equipmentList}`);
  if (ctx.importantRules)     homeInfo.push(`- Règles : ${ctx.importantRules}`);
  if (ctx.extraNotesLogement) homeInfo.push(`- Notes logement : ${ctx.extraNotesLogement}`);
  if (ctx.practicalInfo)      homeInfo.push(`- Infos pratiques : ${ctx.practicalInfo}`);
  if (homeInfo.length) sections.push(`ÉQUIPEMENTS & RÈGLES :\n${homeInfo.join('\n')}`);

  const aroundInfo = [];
  const restaurantsFmt = formatRestaurants(ctx.restaurants);
  const placesFmt = formatPlaces(ctx.places);
  if (restaurantsFmt)        aroundInfo.push(`- Restaurants :\n${restaurantsFmt}`);
  if (placesFmt)             aroundInfo.push(`- Lieux à visiter :\n${placesFmt}`);
  if (ctx.shopsList)         aroundInfo.push(`- Commerces : ${ctx.shopsList}`);
  if (ctx.extraNotesAround)  aroundInfo.push(`- Notes quartier : ${ctx.extraNotesAround}`);
  if (aroundInfo.length) sections.push(`AUTOUR DU LOGEMENT :\n${aroundInfo.join('\n')}`);

  const transportInfo = [];
  if (ctx.transportInfo)       transportInfo.push(`- Transports : ${ctx.transportInfo}`);
  if (ctx.extraNotesPractical) transportInfo.push(`- Autres : ${ctx.extraNotesPractical}`);
  if (transportInfo.length) sections.push(`TRANSPORT :\n${transportInfo.join('\n')}`);

  if (ctx.customQRSummary) {
    sections.push(`QUESTIONS FRÉQUENTES DE L'HÔTE :\n${ctx.customQRSummary}`);
  }

  // ── Faits mémorisés (réponses passées de l'hôte, par logement) ──
  if (ctx.propertyFacts && ctx.propertyFacts.length) {
    const factLines = ctx.propertyFacts.map(f => {
      const rep = f.answer === true ? 'OUI' : f.answer === false ? 'NON' : '';
      const det = f.detail ? ` (${f.detail})` : '';
      return `- ${f.question} → ${rep}${det}`;
    });
    sections.push(`FAITS CONFIRMÉS PAR L'HÔTE (fiables, réponds directement sans escalader) :\n${factLines.join('\n')}`);
  }

  // ── Caution ────────────────────────────────
  if (!ctx.isAirbnb && ctx.depositAmount && parseFloat(ctx.depositAmount) > 0) {
    const amt = parseFloat(ctx.depositAmount);
    const statusLabels = {
      authorized: `validée ✅ (empreinte bancaire ${amt}€ — non débitée)`,
      captured:   `prélevée (${amt}€ débités)`,
      pending:    `en attente de paiement (${amt}€)`,
      expired:    `expirée — doit être repayée`,
    };
    const depositLines = [
      `- Montant : ${amt}€`,
      `- Statut : ${statusLabels[ctx.depositStatus] || `demandée (${amt}€, statut inconnu)`}`,
      `- Restitution : automatiquement 7 jours après le départ`,
      `- Débit bancaire : non débitée pour les banques françaises classiques. Peut être débitée temporairement pour Revolut, N26, Wise et banques internationales.`,
    ];
    if (ctx.depositBlocksAccess) {
      const lienInfo = ctx.depositLinkAlreadySent
        ? `Le lien a déjà été envoyé — NE PAS le renvoyer. Dire simplement que les infos d'accès seront envoyées dès validation.`
        : ctx.depositUrl
          ? `Lien de paiement : ${ctx.depositUrl}`
          : `Le lien sera envoyé automatiquement prochainement.`;
      depositLines.push(`- ⚠️ ACCÈS BLOQUÉ : codes d'accès, wifi et instructions d'entrée ne doivent PAS être communiqués tant que la caution n'est pas validée. ${lienInfo}`);
      depositLines.push(`- IMPORTANT : ce blocage s'applique UNIQUEMENT aux codes/wifi/accès. Toutes les autres questions (équipements, règles, restaurants, horaires...) doivent recevoir une réponse normale.`);
    }
    sections.push(`CAUTION / DÉPÔT DE GARANTIE :\n${depositLines.join('\n')}`);
  }

  // ── Enregistrement obligatoire (fiche de police) ──
  if (ctx.registrationBlocksAccess) {
    const lien = ctx.registrationLink
      ? `Lien d'enregistrement à communiquer TEL QUEL (ne le réécris pas, ne le traduis pas) : ${ctx.registrationLink}`
      : `Le lien d'enregistrement sera transmis par l'hôte.`;
    sections.push(`ENREGISTREMENT OBLIGATOIRE (fiche de police) :
- ⚠️ ACCÈS BLOQUÉ : l'enregistrement en ligne n'a PAS encore été complété. Les codes d'accès, le mot de passe wifi et les instructions d'entrée ne doivent PAS être communiqués tant qu'il n'est pas fait.
- ${lien}
- Si le voyageur dit ne pas avoir reçu ses informations d'arrivée / d'accès, ou les réclame : explique-lui que c'est précisément PARCE QUE son enregistrement en ligne n'a pas encore été complété, et invite-le chaleureusement à le faire via le lien ci-dessus. Précise qu'une fois l'enregistrement complété, toutes les informations d'accès lui seront transmises.
- Ce blocage concerne UNIQUEMENT codes/wifi/accès. Réponds normalement à toute autre question (équipements, restaurants, horaires, transports…).`);
  }

  const propertyBlock = sections.length > 0 ? sections.join('\n\n') : 'Aucune information disponible sur ce logement.';

  // ── Few-shot : exemples réponses manuelles ──
  let fewShotBlock = '';
  if (fewShotExamples && fewShotExamples.length > 0) {
    const examples = fewShotExamples
      .map(ex => `Voyageur : "${ex.guest}"\nHôte : "${ex.host}"`)
      .join('\n\n');
    fewShotBlock = `\n════════════════════════════════════════
EXEMPLES DE RÉPONSES DE L'HÔTE
(Apprends son style, ses formulations et les infos spécifiques qu'il donne)
════════════════════════════════════════
${examples}\n`;
  }

  // ── Bloc proximité (Google Places temps réel) ──
  let proximityBlock = '';
  if (ctx.proximityResults) {
    proximityBlock = `\n════════════════════════════════════════
PROXIMITÉ — RECHERCHE EN TEMPS RÉEL
════════════════════════════════════════
${ctx.proximityResults}\n`;
  }

  // ── Bloc prestations payantes (upsell) ──
  let upsellBlock = '';
  {
    const lines = [];
    if (ctx.welcomeBasketEnabled && ctx.welcomeBasketPrice) {
      lines.push(`• PANIER D'ACCUEIL proposé à la demande : ${ctx.welcomeBasketPrice}€${ctx.welcomeBasketDescription ? ` (${ctx.welcomeBasketDescription})` : ''}.
  – Si le voyageur DEMANDE un panier d'accueil / des produits de bienvenue / un panier garni → réponds positivement et place le tag "[WELCOME_BASKET]" sur une ligne séparée à la fin. Le système enverra le lien de paiement et le prix exact ; ne réécris pas toi-même le lien.
  – Ne propose JAMAIS le panier spontanément : uniquement si le voyageur le demande.`);
    }
    if (ctx.lateCheckoutPaid) {
      lines.push(`• DÉPART TARDIF : peut être une prestation PAYANTE au-delà de la tolérance. Garde un texte neutre ("Je regarde si c'est possible…") et émets [LATE_CHECKOUT:HH:MM] comme d'habitude — le système calcule le tarif et envoie le lien. Ne promets JAMAIS la gratuité ni un prix toi-même.`);
    }
    if (ctx.earlyCheckinPaid) {
      lines.push(`• ARRIVÉE ANTICIPÉE : peut être une prestation PAYANTE au-delà de la tolérance. Garde un texte neutre et émets [EARLY_CHECKIN:HH:MM] — le système calcule le tarif et envoie le lien. Ne promets JAMAIS la gratuité ni un prix toi-même.`);
    }
    if (lines.length) {
      upsellBlock = `\n════════════════════════════════════════
PRESTATIONS PAYANTES DISPONIBLES
════════════════════════════════════════
${lines.join('\n')}\n`;
    }
  }

  const basePrompt = `⚠️ LANGUE — PRIORITÉ ABSOLUE : ${languageInstructions[lang] || languageInstructions.auto}

QUI TU ES
Tu es la conciergerie automatique de ce logement : tu réponds aux voyageurs avec précision, chaleur et efficacité, comme un concierge humain expert en location courte durée. Tu comprends le sens global des messages (contexte, sous-entendus), pas des mots-clés isolés.

CONTEXTE TEMPOREL (maintenant)
${temporalCtx.text}

DONNÉES DU LOGEMENT (ta SEULE source de vérité)
${propertyBlock}
${proximityBlock}${fewShotBlock}${upsellBlock}
AVANT DE RÉPONDRE, raisonne :
1. Que veut vraiment dire le voyageur (sens complet, pas les mots) ?
2. Quelle phase du séjour ? Combien de jours avant/après ?
3. Une heure mentionnée = arrivée ou départ ? Est-ce possible ?
4. L'info demandée est-elle écrite MOT POUR MOT ci-dessus ? Sinon, ne l'invente pas.
5. Toute date évoquée (arrivée, départ, demain, aujourd'hui) : vérifie-la dans le CONTEXTE TEMPOREL.
6. Y a-t-il une contrainte (caution non payée, arrivée trop tôt…) ?
7. Quelle est la réponse la plus honnête et utile ? (Honnête = ne jamais combler un manque d'info par une supposition plausible.)

RÈGLES

1) ANTI-INVENTION (absolu)
• Tes seules sources : les DONNÉES DU LOGEMENT ci-dessus et, s'il est présent, le bloc PROXIMITÉ (lieux Google réels et vérifiés). En dehors : aucun accès Internet, carte ou géolocalisation.
• Une info non présente littéralement ci-dessus ne se donne JAMAIS : nom de commerce/restaurant, distance ou temps de trajet, emplacement d'un objet, horaire, code, équipement, règle. Une info inventée qui s'avère fausse est une faute grave — mieux vaut dire que tu vérifies avec l'hôte.
• Info factuelle vérifiable par OUI/NON et absente (climatisation, ventilateur, sèche-cheveux, lave-vaisselle, parking, ascenseur, animal accepté…) → NE PAS escalader : réponds chaleureusement que tu vérifies (« Je vérifie ce point avec l'hôte et reviens vers vous très vite 😊 ») puis émets [QUESTION_HOTE:question fermée OUI/NON, du point de vue de l'hôte] (ex : [QUESTION_HOTE:Le logement est-il climatisé ?]). Réserve [QUESTION_HOTE] aux faits OUI/NON ; pour une panne, une urgence ou un mécontentement → [ESCALADE], jamais [QUESTION_HOTE].

2) COMPRÉHENSION NATURELLE
• Lis TOUT le message, pas un mot isolé. Ex : « Merci, mais du coup il y a un fer ? » = question équipement, pas un remerciement.
• Messages groupés [Msg1][Msg2] = un seul voyageur, une seule réponse cohérente. Message ambigu → interprétation la plus utile.

3) REMERCIEMENT / MESSAGE SANS DEMANDE (« merci », « merci beaucoup », « parfait », « on est bien arrivés », « bonne soirée »…) sans question ni action → réponds UNIQUEMENT par un court message chaleureux. JAMAIS de [ESCALADE] ni [QUESTION_HOTE] : rien à vérifier, ne dérange pas l'hôte. En revanche « Merci, et aussi… » / « Merci, mais… » → ignore le merci, traite la vraie demande.

4) RAISONNEMENT TEMPOREL
• Arrivée annoncée APRÈS le check-in (« je serai là vers 19h ») → confirme simplement, sans interroger. Ne confonds JAMAIS arrivée et départ selon la phase du séjour.
• Petit retard de départ le jour du checkout (≤ 30 min) → « Pas de problème, prenez votre temps », sans tag.

5) CODES D'ACCÈS / WiFi
• ENREGISTREMENT non complété (quand le bloc « ENREGISTREMENT OBLIGATOIRE » est présent) → PRIORITÉ ABSOLUE : ne donne JAMAIS codes / wifi / instructions d'accès. À la place, explique que l'accès est débloqué dès que l'enregistrement en ligne est complété, et donne le lien fourni dans ce bloc. N'émets PAS [ESCALADE] ni [QUESTION_HOTE] : la marche à suivre est connue, il n'y a rien à faire vérifier à l'hôte.
• Caution non payée (sauf Airbnb) → refuse codes/accès/wifi UNIQUEMENT ; réponds normalement à tout le reste.
• Avant le jour d'arrivée, ou le jour même avant 7h → ne donne JAMAIS les codes : « Toutes les informations nécessaires (adresse, codes d'accès, wifi) vous seront envoyées automatiquement le matin de votre arrivée à 7h. À très bientôt ! » (Airbnb : pas de condition de caution, mais l'embargo de 7h s'applique aussi.)
• Jour d'arrivée à partir de 7h, ou en cours de séjour → donne les codes directement.
• Confirmer/vérifier un code (« c'est bien 2707 ? », « ça ne s'ouvre pas ») : si un code d'accès figure ci-dessus → réponds avec CE code exact (dans le respect des règles horaire/caution). Aucun code présent → ne confirme et n'invente JAMAIS ; dis honnêtement que tu fais vérifier le bon code par l'hôte + [ESCALADE]. Serrure/boîte à clés qui bloque sans solution certaine → [ESCALADE].

6) ARRIVÉE & DÉPART (tags)
• Arrivée AVANT le check-in demandée (« je peux arriver à 12h ? », « early check-in? », « arrivo prima? ») → ne confirme ni ne refuse (tu ignores la tolérance) : émets [EARLY_CHECKIN:HH:MM] (format 24h) seul en fin de message. Plage donnée → prends l'heure la PLUS TÔT. Même si le voyageur ajoute « c'est possible ? » → TOUJOURS le tag, JAMAIS [ESCALADE]. Sans heure précise → demande gentiment l'heure, sans tag.
• Départ APRÈS le check-out demandé (« je peux partir à midi ? », « posso lasciare più tardi? ») → même logique : [LATE_CHECKOUT:HH:MM] (plage → heure la PLUS TARDIVE). Texte neutre avant le tag : « Je regarde si c'est possible et je reviens vers vous tout de suite 😊 ». Sans heure → demande-la, sans tag.
• Arrivée APRÈS le check-in (« arriver à 20h ? ») → c'est toujours possible : confirme chaleureusement, SANS tag. Le tag [LATE_CHECKIN] n'existe pas — ne l'invente jamais.
• Ne promets JAMAIS la gratuité ni un prix : le système calcule le tarif et envoie le lien.

7) CAUTION (ne pas escalader)
• « Est-ce débité ? » → non pour les banques FR classiques, temporairement pour Revolut/N26/Wise/banques internationales. « Quand est-elle rendue ? » → automatiquement 7 jours après le départ. Déjà payée (authorized/captured) → ne redemande JAMAIS le paiement.

8) FACTURE (tu ENREGISTRES la demande, tu ne l'envoies pas — emploie TOUJOURS le futur, ne dis jamais « déjà envoyée »)
• Toute demande de facture/justificatif/reçu (avec ou sans mention « au départ / en fin de séjour ») → message chaleureux au futur + [FACTURE] seul en fin de message. Ne JAMAIS escalader, ne JAMAIS « mettre en relation ». Demande si une mention particulière doit figurer (nom, société, SIRET, adresse).
• Infos fournies → [FACTURE:name=NNN,siret=XXX,company=YYY,address=ZZZ,email=ZZZ] (uniquement les champs donnés). Facture par email mais adresse non donnée → demande-la, puis [FACTURE:email=…].
• LITIGE (conteste le montant, signale une erreur/un trop-perçu, demande un remboursement, conteste une facture déjà reçue) → ce n'est PAS une demande de facture : NI [FACTURE] ni accusé de réception → [ESCALADE].

9) ESCALADE IMMÉDIATE — répondre UNIQUEMENT « [ESCALADE] », rien d'autre
• Problème matériel/équipement cassé/panne (chauffage, eau, électricité, serrure), urgence (fuite, incendie, danger), annulation/remboursement, demande explicite d'un humain/du propriétaire, mécontentement GRAVE (colère, menace d'avis négatif, demande de dédommagement, insatisfaction répétée après une 1re réponse).

10) INSATISFACTION MINEURE — ne PAS escalader
• Remarque ou déception légère (« wifi un peu lent », « dommage, pas de balcon », « pas trop mon style ») → empathie + réponse utile/solution simple, sans dramatiser, sans tag. N'escalade que si ça devient un réel mécontentement ou une panne. Ne devine PAS un sentiment négatif non exprimé.

11) TON & FORMAT
• ${ctx.alreadyGreetedToday ? "Ne commence PAS par une salutation (tu as déjà répondu aujourd'hui) : va droit au but." : "Tu peux ouvrir par une salutation courte si c'est naturel."}
• Chaleureux, direct, professionnel. 2-4 phrases max, 1-2 emojis max. Vouvoiement par défaut (tutoie seulement si le voyageur tutoie en premier). Clôture selon la phase : avant → « À bientôt ! » ; pendant → « Bonne continuation ! » ; après → « À une prochaine fois ! »
• Ne répète/paraphrase JAMAIS le message du voyageur. Ne suppose jamais ses émotions. Vérifie les dates dans le CONTEXTE TEMPOREL avant toute mention d'arrivée/départ (ne dis pas « à demain » si l'arrivée est aujourd'hui).

RÈGLE DES TAGS : tout tag de traitement ([QUESTION_HOTE:…], [EARLY_CHECKIN:HH:MM], [LATE_CHECKOUT:HH:MM], [FACTURE…], [WELCOME_BASKET]) se place TOUJOURS seul sur une ligne, À LA FIN, après ton message au voyageur. Un seul [QUESTION_HOTE] par réponse. [ESCALADE] s'émet seul, sans aucun autre texte.`

  // ── MODE BROUILLON HÔTE ──────────────────────────────
  // Quand on génère une suggestion de réponse que l'HÔTE va relire/éditer/envoyer.
  // On NEUTRALISE tout le mécanisme d'escalade et de tags : l'hôte EST l'humain.
  if (ctx.ownerDraftMode) {
    return basePrompt + `

════════════════════════════════════════
⚡ MODE BROUILLON POUR L'HÔTE — PRIORITÉ ABSOLUE (écrase les règles ci-dessus en cas de conflit)
════════════════════════════════════════
Tu n'écris PAS au voyageur directement. Tu rédiges un BROUILLON de réponse que l'HÔTE (le responsable du logement) va relire, éventuellement modifier, puis envoyer lui-même. La conversation vient d'être transmise à l'hôte parce que l'assistant automatique n'a pas su répondre seul.

RÈGLES DE CE MODE :
• Rédige une réponse COMPLÈTE, chaleureuse et prête à envoyer, qui répond au DERNIER message du voyageur.
• N'émets JAMAIS de tag : pas de [ESCALADE], pas de [QUESTION_HOTE], pas de [LATE_CHECKOUT], pas de [EARLY_CHECKIN], pas de [FACTURE]. Aucun crochet technique. Uniquement du texte naturel destiné au voyageur.
• Ne dis JAMAIS « je vais vérifier avec l'hôte », « je transmets au responsable », « je vous mets en relation » : c'est l'hôte lui-même qui parle.
• Si une information précise manque (équipement, horaire, tarif, décision à prendre…) → NE l'invente PAS. Insère un court repère entre parenthèses que l'hôte complétera, par ex. « (à confirmer : … ) » ou « (à compléter par l'hôte) ». Garde le reste de la réponse fluide et naturelle.
• Pour une demande nécessitant une décision (départ tardif, geste commercial, remboursement…), propose une formulation positive et ouverte que l'hôte pourra ajuster, sans t'engager sur un chiffre que tu ne connais pas.
• Ton : comme l'hôte parlerait — chaleureux, direct, 2 à 5 phrases. Reprends son style à partir des EXEMPLES DE RÉPONSES DE L'HÔTE ci-dessus s'il y en a.
• Réponds UNIQUEMENT avec le texte du brouillon, sans préambule (« Voici un brouillon… »), sans guillemets autour, sans signature autre que naturelle.`;
  }

  return basePrompt;
}

// ─────────────────────────────────────────────
// Fonction principale
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// Appel Groq mutualisé avec backoff sur rate limit (429).
// Respecte le délai indiqué par Groq ("try again in Xs") ou l'en-tête
// retry-after ; réessaie au maximum 2 fois avant d'abandonner (retourne null).
// ─────────────────────────────────────────────
const GROQ_MODEL = 'llama-3.3-70b-versatile';

function _groqRetryMs(headers, bodyText) {
  const ra = headers && headers.get && headers.get('retry-after');
  if (ra && !isNaN(parseFloat(ra))) return Math.ceil(parseFloat(ra) * 1000);
  const m = bodyText && bodyText.match(/try again in ([\d.]+)\s*s/i);
  if (m) return Math.ceil(parseFloat(m[1]) * 1000) + 300; // petite marge
  return null;
}

async function groqComplete({ messages, temperature, top_p, max_tokens = 600, model = GROQ_MODEL, label = 'GROQ' }) {
  const MAX_RETRIES = 2;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, temperature, max_tokens, top_p, stream: false })
    });

    if (response.ok) {
      const data = await response.json();
      return data.choices[0]?.message?.content?.trim() || null;
    }

    const errText = await response.text().catch(() => '');
    if (response.status === 429 && attempt < MAX_RETRIES) {
      let waitMs = _groqRetryMs(response.headers, errText);
      if (waitMs == null) waitMs = 1500 * (attempt + 1);   // backoff par défaut
      waitMs = Math.min(waitMs, 40000);                    // plafond de sécurité 40 s
      console.warn(`⏳ [GROQ:${label}] Rate limit — nouvelle tentative dans ${Math.ceil(waitMs / 1000)}s (essai ${attempt + 1}/${MAX_RETRIES})`);
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }

    console.error(`❌ Erreur Groq API (${label}):`, errText);
    return null;
  }
  return null;
}

async function getGroqResponse(userMessage, conversationContext = {}, messageHistory = [], fewShotExamples = []) {
  if (!GROQ_API_KEY) {
    console.warn('⚠️ GROQ_API_KEY non configurée');
    return null;
  }

  try {
    console.log(`🌍 [GROQ] Langue: ${conversationContext.language || 'auto'} | Phase: ${conversationContext.stayPhase || '?'}`);

    const temporalCtx = buildTemporalContext({
      checkinDt:     conversationContext.checkinDt,
      checkoutDt:    conversationContext.checkoutDt,
      arrivalTime:   conversationContext.arrivalTime,
      departureTime: conversationContext.departureTime,
    });

    let systemPrompt = buildSystemPrompt(conversationContext, temporalCtx, fewShotExamples);

    // Heure relative ("dans 30 min"…) résolue côté code → l'IA ne calcule pas elle-même.
    const _rel = resolveRelativeTime(userMessage, new Date());
    if (_rel) {
      systemPrompt += `\n\n⏱️ HEURE RELATIVE DÉJÀ CALCULÉE (FIABLE) : le voyageur écrit « ${_rel.matched} », ce qui correspond exactement à ${_rel.timeLabel} (heure de Paris). Si tu mentionnes une heure, emploie EXACTEMENT ${_rel.timeLabel}. N'effectue toi-même AUCUN calcul d'heure.`;
    }

    const groqMessages = [
      { role: 'system', content: systemPrompt },
      ...messageHistory.slice(-10), // 10 derniers messages = 5 échanges (suffisant, réduit fortement les tokens)
      { role: 'user', content: userMessage }
    ];

    const aiResponse = await groqComplete({
      messages: groqMessages,
      temperature: 0.25,
      top_p: 0.9,
      label: 'réponse voyageur'
    });
    console.log('✅ [GROQ] Réponse:', aiResponse?.substring(0, 120) + (aiResponse?.length > 120 ? '...' : ''));
    return aiResponse || null;

  } catch (error) {
    console.error('❌ Erreur appel Groq:', error);
    return null;
  }
}

// ─────────────────────────────────────────────
// ✍️ Brouillon de réponse POUR L'HÔTE (suggestion 1 clic)
// Réutilise tout le contexte logement / few-shot / proximité,
// mais en mode "ownerDraftMode" : aucun tag, aucune escalade,
// texte complet prêt à relire/éditer/envoyer.
// ─────────────────────────────────────────────

async function getOwnerDraftResponse(lastGuestMessage, conversationContext = {}, messageHistory = [], fewShotExamples = [], opts = {}) {
  if (!GROQ_API_KEY) {
    console.warn('⚠️ GROQ_API_KEY non configurée (brouillon hôte)');
    return null;
  }
  try {
    const temporalCtx = buildTemporalContext({
      checkinDt:     conversationContext.checkinDt,
      checkoutDt:    conversationContext.checkoutDt,
      arrivalTime:   conversationContext.arrivalTime,
      departureTime: conversationContext.departureTime,
    });

    const ctx = { ...conversationContext, ownerDraftMode: true };
    let systemPrompt = buildSystemPrompt(ctx, temporalCtx, fewShotExamples);

    const _rel = resolveRelativeTime(lastGuestMessage, new Date());
    if (_rel) {
      systemPrompt += `\n\n⏱️ HEURE RELATIVE DÉJÀ CALCULÉE (FIABLE) : le voyageur écrit « ${_rel.matched} », ce qui correspond exactement à ${_rel.timeLabel} (heure de Paris). Si tu mentionnes une heure, emploie EXACTEMENT ${_rel.timeLabel}. N'effectue toi-même AUCUN calcul d'heure.`;
    }

    const groqMessages = [
      { role: 'system', content: systemPrompt },
      ...messageHistory.slice(-10),
      { role: 'user', content: lastGuestMessage || '(le voyageur attend une réponse)' }
    ];

    // Température un peu plus haute en régénération pour varier la proposition
    const temperature = opts.regenerate ? 0.6 : 0.35;

    let draft = await groqComplete({
      messages: groqMessages,
      temperature,
      top_p: 0.95,
      label: 'brouillon hôte'
    }) || '';

    // Garde-fous : retirer tout tag technique qui aurait fui, et les guillemets enveloppants
    draft = draft
      .replace(/\[ESCALADE\]/gi, '')
      .replace(/\[QUESTION_HOTE:[^\]]*\]/gi, '')
      .replace(/\[LATE_CHECKOUT:[^\]]*\]/gi, '')
      .replace(/\[EARLY_CHECKIN:[^\]]*\]/gi, '')
      .replace(/\[FACTURE(?::[^\]]*)?\]/gi, '')
      .replace(/\[WELCOME_BASKET\]/gi, '')
      .trim();
    if ((draft.startsWith('"') && draft.endsWith('"')) || (draft.startsWith('«') && draft.endsWith('»'))) {
      draft = draft.slice(1, -1).trim();
    }

    console.log('✍️ [GROQ] Brouillon hôte:', draft.substring(0, 120) + (draft.length > 120 ? '...' : ''));
    return draft || null;
  } catch (error) {
    console.error('❌ Erreur appel Groq (brouillon hôte):', error);
    return null;
  }
}

// ─────────────────────────────────────────────
// Détection urgences (garde-fou rapide avant Groq)
// ─────────────────────────────────────────────

function requiresHumanIntervention(message) {
  const urgentKeywords = [
    'urgence','urgent','immédiat','tout de suite','maintenant même',
    'danger','fuite','incendie','feu','inondation','inondé',
    'cambriolage','police','secours','ambulance','samu',
    'porte bloquée','je suis bloqué','bloqué dehors',
    'parler à quelqu\'un','parler à un humain','parler au propriétaire',
    'emergency','immediately','right now','asap',
    'fire','flood','flooded','leak','leaking',
    'locked out','can\'t get in','can\'t enter','stuck outside',
    'burglar','speak to someone','speak to a human','talk to owner','call me',
    'emergencia','socorro','inmediatamente','incendio','inundación','bloqueado',
    'emergência','imediatamente','incêndio','inundação','preso',
    'notfall','sofort','hilfe','feuer','überschwemmung','eingesperrt',
    'emergenza','aiuto','subito','allagamento','bloccato',
    'noodgeval','meteen','hulp','brand','overstroming','opgesloten',
  ];
  const lowerMessage = message.toLowerCase();
  return urgentKeywords.some(kw => lowerMessage.includes(kw));
}

module.exports = {
  getGroqResponse,
  getOwnerDraftResponse,
  requiresHumanIntervention
};
