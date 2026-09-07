-- Migration 003 : contenu initial de la page d'aide
-- Idempotente : les INSERT ne s'exécutent que si les tables sont vides.
-- Corrections appliquées :
--   FAQ #5 : « Sous-comptes » → « Équipe & Accès »
--   FAQ #6 : « Finances »     → « Cautions & Paiements »

-- ─────────────────────────────────────────────
-- FAQ
-- ─────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM help_faq) THEN

    INSERT INTO help_faq (display_order, question, answer_html, answer_text, category) VALUES

    (1,
     'Comment synchroniser mon calendrier Airbnb / Booking ?',
     '<p>La synchronisation se fait via <strong>Channex</strong>, notre gestionnaire de channels intégré. Depuis la page <strong>Logements</strong>, cliquez sur <strong>« Connecter Airbnb · Booking · Expedia »</strong> sur le logement concerné. Une fenêtre s''ouvre pour connecter vos comptes OTA directement — les réservations et disponibilités se synchronisent alors en temps réel.</p>',
     'La synchronisation se fait via Channex, notre gestionnaire de channels intégré. Depuis la page Logements, cliquez sur « Connecter Airbnb · Booking · Expedia » sur le logement concerné. Une fenêtre s''ouvre pour connecter vos comptes OTA directement — les réservations et disponibilités se synchronisent alors en temps réel.',
     NULL),

    (2,
     'Comment créer un contrat de séjour et l''envoyer à mon voyageur ?',
     '<p>Depuis le menu <strong>Contrats</strong>, cliquez sur « Nouveau contrat », remplissez les informations du séjour, puis envoyez le lien de signature par e-mail au voyageur. Il peut signer directement depuis son téléphone.</p>',
     'Depuis le menu Contrats, cliquez sur « Nouveau contrat », remplissez les informations du séjour, puis envoyez le lien de signature par e-mail au voyageur. Il peut signer directement depuis son téléphone.',
     NULL),

    (3,
     'Comment envoyer un livret d''accueil à mon voyageur ?',
     '<p>Dans <strong>Livrets d''accueil</strong>, sélectionnez votre logement, personnalisez votre livret, puis copiez le lien public ou envoyez-le directement par e-mail depuis l''application.</p>',
     'Dans Livrets d''accueil, sélectionnez votre logement, personnalisez votre livret, puis copiez le lien public ou envoyez-le directement par e-mail depuis l''application.',
     NULL),

    (4,
     'Comment ajouter une personne de ménage et lui assigner des tâches ?',
     '<p>Dans la section <strong>Ménages</strong>, ajoutez votre cleaner avec son nom et son numéro. Vous pouvez ensuite lui assigner automatiquement les départs de chaque réservation. Si elle a un compte dans l''app, liez-le pour qu''elle reçoive des notifications push.</p>',
     'Dans la section Ménages, ajoutez votre cleaner avec son nom et son numéro. Vous pouvez ensuite lui assigner automatiquement les départs de chaque réservation. Si elle a un compte dans l''app, liez-le pour qu''elle reçoive des notifications push.',
     NULL),

    -- Correction : « Sous-comptes » → « Équipe & Accès »
    (5,
     'Comment créer un sous-compte pour mon équipe ?',
     '<p>Dans <strong>Paramètres du compte</strong>, section « Équipe &amp; Accès », invitez un membre de votre équipe par e-mail. Vous pouvez définir précisément ses permissions (voir les réservations, gérer les ménages, accéder aux finances…).</p>',
     'Dans Paramètres du compte, section « Équipe & Accès », invitez un membre de votre équipe par e-mail. Vous pouvez définir précisément ses permissions (voir les réservations, gérer les ménages, accéder aux finances…).',
     NULL),

    -- Correction : « Finances » → « Cautions & Paiements »
    (6,
     'Comment encaisser une caution et la restituer ?',
     '<p>Dans la section <strong>Cautions &amp; Paiements</strong>, créez une demande de caution pour votre voyageur. Il règle en ligne par carte bancaire. Après le séjour, restituez la caution en un clic ou retenez le montant souhaité si nécessaire.</p>',
     'Dans la section Cautions & Paiements, créez une demande de caution pour votre voyageur. Il règle en ligne par carte bancaire. Après le séjour, restituez la caution en un clic ou retenez le montant souhaité si nécessaire.',
     NULL),

    (7,
     'Comment générer une facture pour un propriétaire ?',
     '<p>Dans <strong>Factures propriétaires</strong>, sélectionnez le logement et la période, puis générez la facture en un clic. Elle est envoyée automatiquement par e-mail au propriétaire au format PDF.</p>',
     'Dans Factures propriétaires, sélectionnez le logement et la période, puis générez la facture en un clic. Elle est envoyée automatiquement par e-mail au propriétaire au format PDF.',
     NULL),

    (8,
     'L''application mobile est-elle disponible sur iOS et Android ?',
     '<p>Oui, Boostinghost est disponible sur <strong>iOS</strong> (App Store) et <strong>Android</strong> (Play Store). Votre équipe peut aussi utiliser l''app dédiée aux prestataires pour recevoir les notifications de ménage en temps réel.</p>',
     'Oui, Boostinghost est disponible sur iOS (App Store) et Android (Play Store). Votre équipe peut aussi utiliser l''app dédiée aux prestataires pour recevoir les notifications de ménage en temps réel.',
     NULL),

    (9,
     'Mon abonnement est-il sans engagement ?',
     '<p>Oui, tous les abonnements Boostinghost sont <strong>sans engagement</strong>. Vous pouvez résilier à tout moment depuis les paramètres de votre compte, sans frais.</p>',
     'Oui, tous les abonnements Boostinghost sont sans engagement. Vous pouvez résilier à tout moment depuis les paramètres de votre compte, sans frais.',
     NULL),

    (10,
     'Je n''arrive pas à me connecter, que faire ?',
     '<p>Vérifiez que vous utilisez bien l''adresse e-mail avec laquelle vous avez créé votre compte. Si vous avez oublié votre mot de passe, utilisez le lien <strong>« Mot de passe oublié »</strong> sur la page de connexion. Si le problème persiste, contactez le support via le chat ci-dessous.</p>',
     'Vérifiez que vous utilisez bien l''adresse e-mail avec laquelle vous avez créé votre compte. Si vous avez oublié votre mot de passe, utilisez le lien « Mot de passe oublié » sur la page de connexion. Si le problème persiste, contactez le support via le chat ci-dessous.',
     NULL);

  END IF;
END $$;


-- ─────────────────────────────────────────────
-- VIDÉOS
-- ─────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM help_videos) THEN

    INSERT INTO help_videos (display_order, youtube_id, title) VALUES
    (1, '073xIs5qnV4', 'Boostinghost : créer votre compte en 2 minutes — Tutoriel complet'),
    (2, 'HWUy3iOA81Y', 'Tutoriel complet : Calendrier, Réservations & KPI'),
    (3, 'L_A5YDiUlWI', 'Créez un livret d''accueil professionnel en 5 minutes'),
    (4, 'CKKQihkb0E8', 'Contrat de location avec signature électronique'),
    (5, '4FFeBhJTUjY', 'Messages automatiques & SMS par logement'),
    (6, 'JsihaZJTI1o', 'Comment ajouter vos logements sur Boostinghost'),
    (7, 'uSAUyaousDY', 'Comment envoyer un lien BHGuest à vos voyageurs ? (et bloquer les dates automatiquement)');

  END IF;
END $$;


-- ─────────────────────────────────────────────
-- GUIDES INTERACTIFS
-- icon         : nom de classe FontAwesome (ex. "far fa-calendar-alt")
-- accent_color : gradient CSS tel que rendu dans la page
-- badge_label  : libellé exact de la pill de droite (nombre d'étapes ou tag textuel)
-- ─────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM help_guides) THEN

    INSERT INTO help_guides (display_order, title, description, page_url, icon, accent_color, time_label, badge_label) VALUES

    (1,
     'Calendrier des réservations',
     '4 vues, recherche, actions rapides, édition groupée et taux d''occupation.',
     'tuto-calendrier-annotator.html',
     'far fa-calendar-alt',
     'linear-gradient(135deg,#0A2C22,#0E3B2E)',
     '5 min', '10 étapes'),

    (2,
     'Messages automatiques',
     'Configurez vos templates, conditions d''envoi et messagerie avec les voyageurs.',
     'tuto-messages-annotator.html',
     'far fa-comment',
     'linear-gradient(135deg,#3b82f6,#6366f1)',
     '5 min', 'Airbnb · Booking · Direct'),

    (3,
     'Connecter Airbnb',
     'Synchronisez votre compte Airbnb, créez le channel et mappez vos annonces.',
     'tuto-connecter-airbnb-annotator.html',
     'fas fa-link',
     'linear-gradient(135deg,#ef4444,#f97316)',
     '3 min', '9 étapes'),

    (4,
     'BHGuest — Réservations directes',
     'Créez des liens de réservation, gérez les holds et les paiements directs.',
     'tuto-bhguest-annotator.html',
     'fas fa-home',
     'linear-gradient(135deg,#8b5cf6,#a78bfa)',
     '4 min', 'Lien · Paiement · Hold');

  END IF;
END $$;
