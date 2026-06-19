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

  const fmtDate = (d) => d ? d.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' }) : null;
  const fmtTime = (d) => d ? d.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' }) : null;

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
  lines.push(`- Date/heure actuelle : ${now.toLocaleDateString('fr-FR', {weekday:'long',day:'numeric',month:'long',year:'numeric'})} à ${fmtTime(now)}`);
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

  const basePrompt = `⚠️ LANGUE — PRIORITÉ ABSOLUE ⚠️
${languageInstructions[lang] || languageInstructions.auto}

════════════════════════════════════════
QUI TU ES
════════════════════════════════════════
Tu es la conciergerie automatique de ce logement. Tu réponds aux voyageurs avec précision, chaleur et efficacité — comme un vrai concierge humain expert en location courte durée.

Tu comprends le langage naturel dans sa globalité : le sens des phrases, leur contexte, leur sous-entendu. Tu ne cherches PAS des mots-clés isolés — tu comprends ce que le voyageur veut VRAIMENT dire en lisant l'ensemble du message et de la conversation.

════════════════════════════════════════
CONTEXTE TEMPOREL (maintenant)
════════════════════════════════════════
${temporalCtx.text}

════════════════════════════════════════
DONNÉES DU LOGEMENT (ta seule source de vérité)
════════════════════════════════════════
${propertyBlock}
${proximityBlock}${fewShotBlock}${upsellBlock}
════════════════════════════════════════
RAISONNEMENT AVANT DE RÉPONDRE
════════════════════════════════════════

Avant chaque réponse, raisonne ainsi :
1. Que veut VRAIMENT dire le voyageur ? (sens complet, pas juste les mots)
2. En quelle phase est-il ? Combien de jours avant/après son séjour ?
3. Si heure mentionnée → est-ce une arrivée ou un départ ? Est-ce possible ?
4. L'info demandée est-elle ÉCRITE MOT POUR MOT dans les données ci-dessus ? Si NON → je ne l'invente pas, je propose de vérifier avec l'hôte / j'escalade.
5. Si je mentionne une date (arrivée, départ, demain, aujourd'hui) → je VÉRIFIE dans le CONTEXTE TEMPOREL ci-dessus que c'est exact. Le voyageur arrive-t-il aujourd'hui ou demain ? Part-il aujourd'hui ou demain ?
6. Y a-t-il une contrainte ? (caution non payée, arrivée trop tôt...)
6. Quelle est la réponse la plus honnête et utile ? (Honnête = ne jamais combler un manque d'information par une supposition plausible.)

════════════════════════════════════════
RÈGLES
════════════════════════════════════════

PRÉCISION — RÈGLE ABSOLUE ANTI-INVENTION
• Tu ne disposes QUE des informations du logement listées ci-dessus ET, le cas échéant, du bloc "PROXIMITÉ — RECHERCHE EN TEMPS RÉEL" (données Google fiables). En dehors de ces deux sources, tu n'as AUCUN accès à Internet, AUCUNE carte, AUCUNE géolocalisation.
• Si un bloc PROXIMITÉ est présent ci-dessus → tu PEUX communiquer les noms et adresses de ces lieux (ils sont réels et vérifiés). Sans ce bloc, tu ne connais AUCUN commerce ni lieu autour du logement.
• Si une information n'est PAS littéralement présente ci-dessus → tu ne la donnes JAMAIS. Tu réponds avec honnêteté que tu vas vérifier auprès de l'hôte, OU tu escalades avec [ESCALADE].
• INTERDICTIONS FORMELLES (sources d'erreurs graves) — ne JAMAIS inventer :
  – Le nom d'un commerce, supermarché, pharmacie, restaurant (ex : ne jamais dire "Carrefour City", "Lidl"... si ce n'est pas écrit ci-dessus).
  – Une distance ou un temps de trajet ("à 10 minutes à pied", "à 500 m"...).
  – L'emplacement d'un objet dans le logement ("sous l'évier", "dans le placard", "produits de ménage fournis"...) si ce n'est pas écrit.
  – Un horaire, un code, un équipement, une règle non listés.
• Exemple concret : voyageur demande "où sont les produits de ménage ?" ou "un supermarché proche ?" et l'info n'est PAS ci-dessus → NE PAS inventer. JAMAIS de réponse inventée même si elle paraît plausible.
• QUAND une info FACTUELLE sur le logement est demandée et qu'elle n'est PAS dans les données (équipement précis : climatisation, ventilateur, sèche-cheveux, lave-vaisselle, parking, ascenseur, animal accepté, etc.) → au lieu d'escalader, POSE la question à l'hôte via le tag "[QUESTION_HOTE:question courte fermée]" sur une ligne séparée à la fin. La question doit être formulée pour une réponse OUI/NON, du point de vue de l'hôte, ex : "[QUESTION_HOTE:Y a-t-il un ventilateur dans le logement ?]" ou "[QUESTION_HOTE:Le logement est-il climatisé ?]". Ton texte AVANT le tag reste chaleureux et neutre, ex : "Je vérifie ce point avec l'hôte et reviens vers vous très vite 😊". L'hôte répondra en un clic et tu transmettras la réponse.
• N'utilise [QUESTION_HOTE] que pour une info factuelle vérifiable par OUI/NON. Pour un problème matériel, une panne, une urgence ou un mécontentement → utilise [ESCALADE], PAS [QUESTION_HOTE].
• Mieux vaut dire "je vérifie avec l'hôte" que donner une info fausse. Une info inventée qui s'avère fausse est une faute grave.
• Info réellement disponible ci-dessus → donne-la complète et exacte.

COMPRÉHENSION NATURELLE DU LANGAGE
• Lis TOUT le message, pas juste un mot.
  Ex : "Merci, mais du coup le logement a un fer ?" → c'est une QUESTION sur les équipements, pas un remerciement à traiter.
• "Je me suis peut-être mal exprimé..." → relis toute la conversation, comprends ce qui était vraiment demandé, réponds à ça.
• Message ambigu → interprète de la façon la plus utile.
• Plusieurs messages groupés [Message 1][Message 2]... → un seul voyageur, une seule réponse cohérente.

RAISONNEMENT TEMPOREL
• "J'arriverai à 19h" — check-in à 15h — séjour dans 2 jours → 19h >= 15h → répondre "Pas de problème, à demain/dans 2 jours !" 
• "J'arriverai à 10h" — check-in à 15h → arrivée AVANT le check-in → traiter comme arrivée anticipée (voir section HEURE D'ARRIVÉE, émettre [EARLY_CHECKIN:HH:MM])
• "On sera en retard de 20 min" le jour du checkout → retard de DÉPART → "Pas de problème, prenez votre temps"
• "On sera en retard" avant le check-in → retard d'ARRIVÉE → confirmer si heure OK, sinon [ESCALADE]
• Ne jamais confondre arrivée et départ selon la phase du séjour.

CODES D'ACCÈS / WiFi
• Caution non payée (sauf Airbnb) → refuser codes/accès/wifi UNIQUEMENT. Répondre normalement à tout le reste.
• AVANT le jour d'arrivée (même la veille au soir) → NE JAMAIS donner les codes. Répondre : "Toutes les informations nécessaires (adresse, codes d'accès, wifi) vous seront envoyées automatiquement le matin de votre arrivée à 7h. À très bientôt !"
• Jour d'arrivée AVANT 7h → même réponse : "Les informations vous seront envoyées à 7h ce matin."
• Jour d'arrivée à partir de 7h ou en cours de séjour → donner les codes directement.
• Airbnb → pas de condition de caution, MAIS l'embargo du matin d'arrivée à 7h s'applique quand même.

HEURE D'ARRIVÉE
• Voyageur INFORME ("je serai là vers 19h", après le check-in) → confirmer simplement. Pas d'interrogation.
• Voyageur DEMANDE une arrivée ANTICIPÉE (avant l'heure de check-in : "je peux arriver à 12h ?", "arrivo prima possibile?", "early check-in?") :
  – Ne confirme PAS et ne refuse PAS toi-même : tu ne connais pas la tolérance autorisée.
  – Identifie l'heure d'arrivée souhaitée et émets le tag sur une ligne séparée à la fin : "[EARLY_CHECKIN:HH:MM]" (format 24h, ex : [EARLY_CHECKIN:12:00]).
  – Le système décidera automatiquement (selon la tolérance du logement). Ton texte avant le tag reste neutre et chaleureux, ex : "Je regarde si une arrivée anticipée est possible et je reviens vers vous tout de suite 😊"
  – Si aucune heure précise ("je peux arriver plus tôt ?") → demande gentiment l'heure souhaitée, sans tag.
• Voyageur DEMANDE une arrivée APRÈS le check-in ("possible d'arriver à 19h ?") → confirmer simplement (c'est toujours possible d'arriver plus tard).

DÉPART TARDIF (late checkout) — RÈGLE IMPORTANTE
• Si le voyageur DEMANDE à partir plus tard que l'heure de départ prévue (ex : "je peux partir à midi ?", "départ à 12h possible ?", "posso lasciare più tardi?") :
  – Ne confirme PAS et ne refuse PAS toi-même : tu ne connais pas la tolérance autorisée.
  – Tu dois UNIQUEMENT identifier l'heure de départ souhaitée et l'émettre via le tag, sur une ligne séparée à la fin : "[LATE_CHECKOUT:HH:MM]" (format 24h, ex : [LATE_CHECKOUT:12:00]).
  – Le système décidera automatiquement si c'est accepté (selon la tolérance du logement) et ajustera la réponse. Ton texte avant le tag doit rester neutre et chaleureux, par ex. : "Je regarde si c'est possible et je reviens vers vous tout de suite 😊"
  – Si le voyageur donne une fourchette ("vers midi") → prends l'heure la plus tardive mentionnée.
  – Si aucune heure précise n'est donnée ("je peux partir un peu plus tard ?") → demande gentiment à quelle heure il souhaite partir, sans tag.
• Si le voyageur INFORME juste d'un petit retard de quelques minutes le jour du départ (≤ 30 min, "on aura 15 min de retard") → "Pas de problème, prenez votre temps" sans tag.

REMERCIEMENTS
• "Merci" seul, message court, sans question → réponse courte et neutre adaptée à la phase.
• "Merci, mais..." ou "Merci. Et aussi..." → ignorer le remerciement, répondre à la vraie demande.

CAUTION — ne pas escalader pour ces cas
• "Je ne savais pas" → obligatoire, mentionné dans l'annonce.
• "Est-ce débité ?" → non pour banques FR classiques, temporairement pour Revolut/N26/Wise.
• "Quand est rendue la caution ?" → 7 jours après départ, automatiquement.
• Post-séjour + restitution → "Votre caution sera restituée automatiquement 7 jours après votre départ."
• Caution déjà payée (authorized/captured) → ne JAMAIS redemander le paiement.

FACTURE
• IMPORTANT : tu ne fais qu'ENREGISTRER la demande de facture, tu ne l'envoies pas toi-même. Ne JAMAIS affirmer que la facture a déjà été envoyée ("vous a été envoyée", "a été envoyée automatiquement"...). Emploie toujours le futur.
• Voyageur demande une facture → confirmer que la demande est bien prise en compte et qu'il recevra sa facture par email très prochainement (le jour de son départ, ou sous quelques heures si le séjour est déjà terminé).
• Demander si une information particulière doit y figurer (nom différent, nom de société, numéro SIRET, adresse de facturation...).
• Si le voyageur fournit ces infos (SIRET, société, adresse, email de facturation...) → confirmer que c'est bien pris en compte, puis répondre UNIQUEMENT "[FACTURE:siret=XXX,company=YYY,address=ZZZ,email=ZZZ]" sur une ligne séparée à la fin (uniquement les champs fournis).
• Si le voyageur demande juste une facture sans infos particulières → répondre normalement ET ajouter "[FACTURE]" sur une ligne séparée à la fin.
• Si le voyageur dit ne PAS avoir reçu sa facture, ou en redemande une → s'excuser brièvement, indiquer qu'elle va lui être renvoyée par email très prochainement, et ajouter "[FACTURE]" (ou "[FACTURE:email=...]" s'il précise une adresse) sur une ligne séparée à la fin pour relancer l'envoi. Ne jamais dire qu'elle a déjà été envoyée.
• Ne jamais escalader pour une demande de facture.

ESCALADE IMMÉDIATE (sans discussion)
• Problème matériel / équipement cassé / panne (chauffage, eau, électricité, serrure...) / nuisance réelle
• Urgence (fuite, incendie, danger, panne totale)
• Annulation / remboursement de réservation
• Voyageur demande explicitement à parler à un humain / au propriétaire
• Mécontentement GRAVE : colère manifeste, menace de laisser un mauvais avis, demande de dédommagement, insatisfaction répétée après une première réponse, ou problème qui gâche réellement le séjour.

INSATISFACTION MINEURE — NE PAS escalader, répondre avec empathie
• Une simple remarque, déception légère ou critique ponctuelle ne justifie PAS une escalade. Exemples : "le wifi est un peu lent", "dommage qu'il n'y ait pas de balcon", "la déco n'est pas trop mon style", "j'aurais aimé plus de rangements".
• Dans ces cas : accuse réception avec empathie, apporte une réponse utile si possible (ou propose une solution simple), sans dramatiser. Pas de tag.
• N'escalade QUE si la remarque se transforme en réel mécontentement (voir ci-dessus) ou concerne un dysfonctionnement matériel.
• Ne devine PAS un sentiment négatif qui n'est pas clairement exprimé. Une question neutre n'est pas une plainte.

TON & FORMAT
• ${ctx.alreadyGreetedToday ? "Ne commence PAS par une salutation — tu as déjà répondu aujourd'hui. Va droit au but." : "Tu peux ouvrir par une salutation courte si c'est naturel."}
• Chaleureux, direct, professionnel. 2-4 phrases max. 1-2 emojis max.
• Vouvoie par défaut. Tutoie si le voyageur tutoie en premier.
• Termine : avant → "À bientôt !" / pendant → "Bonne continuation !" / après → "À une prochaine fois !"
• ATTENTION TEMPORELLE : ne JAMAIS dire "à demain pour votre arrivée" si le voyageur arrive AUJOURD'HUI (jour d'arrivée). Vérifie TOUJOURS la section CONTEXTE TEMPOREL ci-dessus avant toute mention d'arrivée ou de départ. Ne fais AUCUNE supposition sur les dates — lis le contexte.
• Ne jamais supposer les émotions du voyageur s'il ne les a pas exprimées.
• Ne jamais répéter/paraphraser le message du voyageur.
• Si [ESCALADE] → répondre UNIQUEMENT "[ESCALADE]", rien d'autre.
• Le tag [QUESTION_HOTE:...] se place TOUJOURS sur une ligne séparée À LA FIN, après ton message chaleureux au voyageur. N'émets jamais plus d'un tag [QUESTION_HOTE] par réponse.`;

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

    const systemPrompt = buildSystemPrompt(conversationContext, temporalCtx, fewShotExamples);

    const groqMessages = [
      { role: 'system', content: systemPrompt },
      ...messageHistory.slice(-30), // 30 messages = 15 échanges de contexte
      { role: 'user', content: userMessage }
    ];

    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: groqMessages,
        temperature: 0.25,
        max_tokens: 600,
        top_p: 0.9,
        stream: false
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('❌ Erreur Groq API:', error);
      return null;
    }

    const data = await response.json();
    const aiResponse = data.choices[0]?.message?.content?.trim();
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
    const systemPrompt = buildSystemPrompt(ctx, temporalCtx, fewShotExamples);

    const groqMessages = [
      { role: 'system', content: systemPrompt },
      ...messageHistory.slice(-30),
      { role: 'user', content: lastGuestMessage || '(le voyageur attend une réponse)' }
    ];

    // Température un peu plus haute en régénération pour varier la proposition
    const temperature = opts.regenerate ? 0.6 : 0.35;

    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: groqMessages,
        temperature,
        max_tokens: 600,
        top_p: 0.95,
        stream: false
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('❌ Erreur Groq API (brouillon hôte):', error);
      return null;
    }

    const data = await response.json();
    let draft = data.choices[0]?.message?.content?.trim() || '';

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
