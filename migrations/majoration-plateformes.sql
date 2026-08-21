-- ============================================================
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
