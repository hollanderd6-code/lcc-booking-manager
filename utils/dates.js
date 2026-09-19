'use strict';
/**
 * Utilitaires DATE-ONLY pour le pipeline Channex / réservations.
 *
 * Invariant métier : toute date de séjour BH est une DATE-ONLY Europe/Paris.
 * PostgreSQL peut retourner soit une string "YYYY-MM-DD" (colonne DATE)
 * soit un objet Date UTC (colonne TIMESTAMPTZ). Les deux cas sont gérés.
 *
 * Règle absolue : .toISOString() ne doit jamais être utilisé sur un Date
 * provenant d'un TIMESTAMPTZ pour en extraire la date métier, car
 * toISOString() retourne la représentation UTC (risque de -1 jour en Paris UTC+2).
 */

/**
 * Normalise une valeur de date en string "YYYY-MM-DD".
 *
 * - string "YYYY-MM-DD"           → slice(0,10) — déjà correcte
 * - string "YYYY-MM-DDT..."       → slice(0,10) — sûr uniquement si la string
 *                                   commence déjà par la date locale (cas Channex API)
 * - Date object (pg TIMESTAMPTZ)  → reconstruction via Europe/Paris pour éviter le
 *                                   biais UTC :
 *                                   2026-09-18T00:00:00+02:00 → pg retourne
 *                                   Date(2026-09-17T22:00:00Z) → toISOString()
 *                                   donnerait "2026-09-17" ← FAUX.
 *                                   toLocaleDateString('fr-CA',{timeZone:'Europe/Paris'})
 *                                   retourne "2026-09-18" ← CORRECT.
 * - null / undefined              → null
 *
 * @param {string|Date|null|undefined} value
 * @returns {string|null} "YYYY-MM-DD" ou null
 */
function normalizeDateOnly(value) {
  if (value === null || value === undefined) return null;

  if (typeof value === 'string') {
    // "2026-09-18" ou "2026-09-18T..."
    // Les dates métier BH sont toujours envoyées par Channex comme "YYYY-MM-DD".
    return value.slice(0, 10);
  }

  if (value instanceof Date) {
    // Reconstruction via Europe/Paris — évite le biais UTC (toISOString non utilisé ici).
    // 'fr-CA' produit systématiquement le format "YYYY-MM-DD" (indépendant des paramètres
    // régionaux du serveur).
    return value.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
  }

  // Fallback inattendu (number, objet non-Date…)
  return String(value).slice(0, 10);
}

/**
 * Retourne les nuits occupées entre startDate (inclusif) et endDate (exclusif).
 *
 * Sémantique : CHECK-IN inclusif, CHECK-OUT exclusif.
 *   "2026-09-18" → "2026-09-20"  ⟹  ["2026-09-18", "2026-09-19"]
 *   jamais le 20.
 *
 * L'itération se fait en UTC pur après normalisation des inputs en "YYYY-MM-DD".
 * - On ajoute "T00:00:00Z" pour forcer un ancrage UTC et éviter toute ambiguïté DST.
 * - +86400000 ms = exactement 1 jour en UTC (les changements d'heure DST n'existent
 *   pas en UTC — pas de risque de nuit dupliquée ou manquante lors des passages DST).
 * - Le timezone du process Node n'influence jamais le résultat.
 *
 * @param {string|Date} startDate  Check-in (inclusif)
 * @param {string|Date} endDate    Check-out (exclusif)
 * @returns {string[]} Tableau de strings "YYYY-MM-DD"
 * @throws {Error} si endDate < startDate (garde contre les boucles infinies)
 */
function getOccupiedNights(startDate, endDate) {
  const startStr = normalizeDateOnly(startDate);
  const endStr   = normalizeDateOnly(endDate);

  if (!startStr || !endStr) return [];

  if (endStr < startStr) {
    throw new Error(`getOccupiedNights: endDate (${endStr}) antérieure à startDate (${startStr})`);
  }
  if (endStr === startStr) return [];

  // Ancrage UTC garanti via le suffixe "T00:00:00Z".
  // L'itération +86400000 ms est sûre en UTC (pas de DST).
  let current = new Date(startStr + 'T00:00:00Z');
  const end   = new Date(endStr   + 'T00:00:00Z');
  const nights = [];

  while (current < end) {
    nights.push(current.toISOString().slice(0, 10));
    current = new Date(current.getTime() + 86400000);
  }

  return nights;
}

module.exports = { normalizeDateOnly, getOccupiedNights };
