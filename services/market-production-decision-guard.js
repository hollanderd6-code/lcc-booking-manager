'use strict';
/**
 * P1.2-B5-BK-N1 — Production Decision Guard
 *
 * Pure module — no DB, no network, no Channex, no process.env authority.
 *
 * Combines evidence from pipeline modules K/L/M/M10F and returns a single
 * deterministic, fail-closed decision on whether a shadow market candidate
 * may be considered for future production use.
 *
 * DECISIONS (closed set, ordered by severity):
 *   REJECT                    — candidate is structurally invalid or confidence
 *                               is too low; no further evaluation possible
 *   QUARANTINE                — candidate quality looks sound but production
 *                               context is critically anomalous (M5/CRITICAL)
 *   HOLD_FOR_CONFIRMATION     — candidate is promising but meaningful uncertainty
 *                               remains (window, confidence, single-source, etc.)
 *   ELIGIBLE_SHADOW_CANDIDATE — all evidence strongly supports the candidate
 *
 * DESIGN CHOICE — MEDIUM confidence → HOLD_FOR_CONFIRMATION:
 *   MEDIUM means not all sources validated. The candidate needs additional
 *   collection runs before we can declare it shadow-eligible. Rationale: fail
 *   closed is cheaper than an incorrect ELIGIBLE declaration.
 *
 * DESIGN CHOICE — UNKNOWN_WINDOW always → HOLD_FOR_CONFIRMATION:
 *   Without confirmed stay-window comparability, the historical anomaly
 *   assessment (severity) cannot be fully trusted. Even severity=NONE is
 *   uncertain when window is unknown. This is the most conservative reasonable
 *   behaviour; SAME_WINDOW / COMPATIBLE_WINDOW unblock this path.
 *
 * DESIGN CHOICE — LARGE_PRODUCTION_DEVIATION (from actionability) does NOT REJECT:
 *   A strong candidate–production divergence does not mean the candidate is bad.
 *   Production may itself be anomalous (cf. M6: 345.45 vs history 135.50).
 *   Invariant G: circular-reject logic is forbidden. LARGE_PRODUCTION_DEVIATION
 *   alone leads to HOLD or, if M5 quarantine is active, is superseded by QUARANTINE.
 *   All other NOT_ACTIONABLE reasons remain REJECT triggers.
 *
 * SAFE_TO_ACTIVATE_PRODUCTION = 'NO' — ALWAYS.
 * ELIGIBLE_SHADOW_CANDIDATE is the ceiling; it never means "activate production."
 *
 * SAFETY:
 *   DB_WRITES              = 0  always
 *   PRICING_WRITES         = 0  always
 *   CHANNEX_CALLS          = 0  always
 *   NETWORK_CALLS          = 0  pure function
 *   SAFE_TO_ACTIVATE_PRODUCTION = 'NO'  always
 */

// ── Decisions ─────────────────────────────────────────────────────────────────

const DECISIONS = Object.freeze({
  REJECT:                    'REJECT',
  QUARANTINE:                'QUARANTINE',
  HOLD_FOR_CONFIRMATION:     'HOLD_FOR_CONFIRMATION',
  ELIGIBLE_SHADOW_CANDIDATE: 'ELIGIBLE_SHADOW_CANDIDATE',
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function _isoCode(str) {
  return typeof str === 'string' && /^[A-Z]{3}$/.test(str);
}

/**
 * Actionability reasons that indicate a structural defect in the candidate
 * (independent of production signal quality). These → REJECT.
 */
const STRUCTURAL_ACTIONABILITY_REJECTS = new Set([
  'LOW_CONFIDENCE',
  'NO_VALID_SOURCE',
  'INVALID_CANDIDATE_MEDIAN',
  'EXTREME_CROSS_SOURCE_DIVERGENCE',
  'UNKNOWN_MARKET_STATUS',
]);

// marketStatus values that trigger HOLD (single-source, not dual)
const SINGLE_SOURCE_STATUSES = new Set(['AIRBNB_ONLY', 'BOOKING_ONLY']);

// marketStatus values that are definitively failing
const FAILING_MARKET_STATUSES = new Set(['INSUFFICIENT', 'UNSTABLE']);

// ── evaluateMarketProductionCandidate ─────────────────────────────────────────

/**
 * Evaluate a shadow market candidate against all available evidence.
 *
 * Fail-closed: any missing critical input triggers REJECT.
 * Evidence is checked in severity order: REJECT → QUARANTINE → HOLD → ELIGIBLE.
 *
 * @param {object} opts
 *
 * @param {object} opts.candidate
 *   From K/M engine result:
 *   { median, confidence, marketStatus, currency,
 *     sources: { airbnbIncluded, bookingIncluded, airbnbReliability, comparableCount },
 *     collectionEvidence: { snapshotCount, radiusKm, comparableCount, stayWindow, collectedAt } | null }
 *
 * @param {object|null} opts.actionability
 *   From evaluateMarketActionability (L2):
 *   { actionable: boolean, reasons: string[], warnings: string[] }
 *
 * @param {object|null} opts.historicalAssessment
 *   From classifyHistoricalAnomaly (M10F-4):
 *   { severity: string, reasons: string[], warnings: string[],
 *     metrics: { windowCompatStatus, historyCount, historyMedian,
 *                ratioVsHistoryMedian, deltaVsHistoryMedianPct } | null }
 *
 * @param {object|null} opts.productionSanity
 *   From analyzeProductionSignalSanity (L4):
 *   { available: boolean, productionMedian: number|null, vsConsensus: { classification } | null }
 *
 * @param {object|null} opts.quarantine
 *   From evaluateQuarantine (M5):
 *   { quarantined: boolean, level: string, reason: string|null, vsConsensus: string|null }
 *
 * @param {object|null} opts.providerHealth
 *   From getProviderHealth (M4) per provider:
 *   { airbnb: { status: 'HEALTHY'|'UNHEALTHY'|'UNKNOWN' } | null,
 *     booking: { status: 'HEALTHY'|'UNHEALTHY'|'UNKNOWN' } | null }
 *
 * @param {object|null} opts.propertyContext
 *   Optional property context for currency validation: { currency: string|null }
 *
 * @returns {{
 *   decision:                  string,
 *   eligible:                  boolean,
 *   reasons:                   string[],
 *   warnings:                  string[],
 *   evidence:                  object,
 *   SAFE_TO_ACTIVATE_PRODUCTION: 'NO',
 * }}
 */
function evaluateMarketProductionCandidate({
  candidate           = null,
  actionability       = null,
  historicalAssessment = null,
  productionSanity    = null,
  quarantine          = null,
  providerHealth      = null,
  propertyContext     = null,
} = {}) {
  const reasons  = [];
  const warnings = [];

  // ── 1. REJECT — Candidate structural validity ──────────────────────────────

  if (candidate == null) {
    return _decide(DECISIONS.REJECT, ['MISSING_CANDIDATE'], warnings, {
      candidateValid: false,
    });
  }

  if (
    candidate.median == null ||
    !Number.isFinite(candidate.median) ||
    candidate.median <= 0
  ) {
    reasons.push('INVALID_CANDIDATE_MEDIAN');
  }

  if (!_isoCode(candidate.currency)) {
    reasons.push('MISSING_OR_INVALID_CANDIDATE_CURRENCY');
  }

  // Currency mismatch with property
  if (
    propertyContext?.currency != null &&
    _isoCode(propertyContext.currency) &&
    _isoCode(candidate.currency) &&
    candidate.currency !== propertyContext.currency
  ) {
    reasons.push(`CURRENCY_MISMATCH: candidate=${candidate.currency} property=${propertyContext.currency}`);
  }

  // Confidence — REJECT on LOW / INSUFFICIENT / UNKNOWN / null
  const conf = candidate.confidence;
  if (conf === 'LOW' || conf === 'INSUFFICIENT') {
    reasons.push('INSUFFICIENT_CONFIDENCE');
  } else if (conf == null || conf === 'UNKNOWN') {
    reasons.push('UNKNOWN_CONFIDENCE');
  }

  // MarketStatus — REJECT on definitively failing
  if (FAILING_MARKET_STATUSES.has(candidate.marketStatus)) {
    reasons.push(`FAILING_MARKET_STATUS: ${candidate.marketStatus}`);
  }

  if (reasons.length > 0) {
    return _decide(DECISIONS.REJECT, reasons, warnings, _evidence(candidate, historicalAssessment, quarantine, productionSanity, providerHealth, { candidateValid: false }));
  }

  // ── 2. REJECT — Actionability (structural reasons only) ───────────────────

  if (actionability == null) {
    return _decide(DECISIONS.REJECT, ['MISSING_ACTIONABILITY_RESULT'], warnings, _evidence(candidate, historicalAssessment, quarantine, productionSanity, providerHealth, { candidateValid: true, actionable: false }));
  }

  const structuralRejectReasons = (actionability.reasons || []).filter(r =>
    STRUCTURAL_ACTIONABILITY_REJECTS.has(r)
  );
  if (structuralRejectReasons.length > 0) {
    return _decide(
      DECISIONS.REJECT,
      structuralRejectReasons.map(r => `ACTIONABILITY_REJECT: ${r}`),
      [...warnings, ...(actionability.warnings || [])],
      _evidence(candidate, historicalAssessment, quarantine, productionSanity, providerHealth, { candidateValid: true, actionable: false })
    );
  }

  // Propagate actionability warnings (non-structural)
  if (actionability.warnings?.length) {
    warnings.push(...actionability.warnings);
  }

  // ── 3. REJECT — Provider health (used providers only) ────────────────────

  const airbnbUsed   = candidate.sources?.airbnbIncluded === true;
  const bookingUsed  = candidate.sources?.bookingIncluded === true;

  if (airbnbUsed && providerHealth?.airbnb?.status === 'UNHEALTHY') {
    reasons.push('PROVIDER_UNHEALTHY: airbnb');
  }
  if (bookingUsed && providerHealth?.booking?.status === 'UNHEALTHY') {
    reasons.push('PROVIDER_UNHEALTHY: booking');
  }

  if (reasons.length > 0) {
    return _decide(DECISIONS.REJECT, reasons, warnings, _evidence(candidate, historicalAssessment, quarantine, productionSanity, providerHealth, { candidateValid: true, actionable: false }));
  }

  const ev = _evidence(candidate, historicalAssessment, quarantine, productionSanity, providerHealth, { candidateValid: true, actionable: actionability.actionable === true });

  // ── 4. QUARANTINE — Production context critically anomalous ───────────────

  // M5: production quarantine active — carry the reason forward; do NOT discard it
  // because the new consensus looks better. The production situation must be
  // resolved independently before declaring any candidate eligible.
  if (quarantine?.quarantined === true) {
    reasons.push(`PRODUCTION_QUARANTINED: ${quarantine.reason ?? 'quarantine_active'}`);
    return _decide(DECISIONS.QUARANTINE, reasons, warnings, ev);
  }

  // M10F historical anomaly — CRITICAL production deviation vs history
  // This checks the PRODUCTION signal's anomaly status (not the candidate's).
  const historicalSeverity = historicalAssessment?.severity ?? null;
  if (historicalSeverity === 'CRITICAL') {
    reasons.push('HISTORICAL_ANOMALY_CRITICAL');
    return _decide(DECISIONS.QUARANTINE, reasons, warnings, ev);
  }

  // ── 5. HOLD_FOR_CONFIRMATION — Uncertainty signals ────────────────────────

  // Missing historical assessment — fail closed: cannot confirm historical context
  if (historicalAssessment == null) {
    reasons.push('MISSING_HISTORICAL_ASSESSMENT');
  }

  // Historical anomaly HIGH
  if (historicalSeverity === 'HIGH') {
    reasons.push('HISTORICAL_ANOMALY_HIGH');
  }

  // Historical anomaly INCONCLUSIVE (not enough history to classify)
  if (historicalSeverity === 'INCONCLUSIVE') {
    reasons.push('HISTORICAL_ANOMALY_INCONCLUSIVE');
  }

  // UNKNOWN_WINDOW — cannot validate historical comparability (always holds)
  const windowCompat = historicalAssessment?.metrics?.windowCompatStatus ?? null;
  if (windowCompat === 'UNKNOWN_WINDOW') {
    reasons.push('UNKNOWN_STAY_WINDOW_COMPARABILITY');
    warnings.push('window_comparability_unknown: historical anomaly classification uncertain');
  }

  // MEDIUM confidence — needs additional evidence before ELIGIBLE
  if (conf === 'MEDIUM') {
    reasons.push('MEDIUM_CONFIDENCE_REQUIRES_ADDITIONAL_EVIDENCE');
  }

  // Single-source market — not strong enough for ELIGIBLE_SHADOW_CANDIDATE
  if (SINGLE_SOURCE_STATUSES.has(candidate.marketStatus)) {
    reasons.push(`SINGLE_SOURCE_MARKET: ${candidate.marketStatus}`);
  }

  // Caution from quarantine (not full quarantine, but deviation observed)
  if (quarantine?.level === 'CAUTION') {
    reasons.push('PRODUCTION_DEVIATION_CAUTION');
  }

  // LARGE_PRODUCTION_DEVIATION from actionability — contextual, not structural
  // (Invariant G: this is NOT a sign the candidate is bad)
  if (
    actionability.actionable === false &&
    (actionability.reasons || []).includes('LARGE_PRODUCTION_DEVIATION') &&
    reasons.length === 0  // only add if no other HOLD reason yet
  ) {
    reasons.push('LARGE_PRODUCTION_DEVIATION_REQUIRES_CONTEXT_VALIDATION');
    warnings.push('large_production_deviation: production signal may itself be anomalous — see quarantine/historical evidence');
  }

  // No production baseline → informational warning only (not a blocker)
  if (productionSanity == null || productionSanity.available === false) {
    warnings.push('no_production_baseline: candidate evaluated without comparison to live production signal');
  }

  // Collection evidence absent → warning (fail-closed in future production context per N4)
  if (!candidate.collectionEvidence) {
    warnings.push('collection_evidence_absent: stay window, radius, and snapshot provenance undocumented');
  }

  if (reasons.length > 0) {
    return _decide(DECISIONS.HOLD_FOR_CONFIRMATION, reasons, warnings, ev);
  }

  // ── 6. ELIGIBLE_SHADOW_CANDIDATE ─────────────────────────────────────────
  //
  // Requirements (all must hold — enforced by elimination above):
  //   candidate.confidence === 'HIGH'
  //   candidate.marketStatus === 'STABLE_DUAL'  (dual-source, not single)
  //   actionability.actionable === true
  //   historicalSeverity ∈ ['NONE', 'LOW']
  //   windowCompatStatus !== 'UNKNOWN_WINDOW'
  //   quarantine.level === 'NONE'
  //   no UNHEALTHY used providers

  return _decide(DECISIONS.ELIGIBLE_SHADOW_CANDIDATE, [], warnings, ev);
}

// ── Private helpers ───────────────────────────────────────────────────────────

function _decide(decision, reasons, warnings, evidence) {
  return {
    decision,
    eligible: decision === DECISIONS.ELIGIBLE_SHADOW_CANDIDATE,
    reasons:  [...reasons],
    warnings: [...warnings],
    evidence,
    SAFE_TO_ACTIVATE_PRODUCTION: 'NO',
  };
}

function _evidence(candidate, historicalAssessment, quarantine, productionSanity, providerHealth, extra = {}) {
  return {
    candidateMedian:        candidate?.median           ?? null,
    candidateConfidence:    candidate?.confidence       ?? null,
    candidateMarketStatus:  candidate?.marketStatus     ?? null,
    candidateCurrency:      candidate?.currency         ?? null,
    historicalSeverity:     historicalAssessment?.severity ?? null,
    windowCompatStatus:     historicalAssessment?.metrics?.windowCompatStatus ?? null,
    historicalMetrics:      historicalAssessment?.metrics ?? null,
    quarantineLevel:        quarantine?.level           ?? 'NONE',
    quarantineReason:       quarantine?.reason          ?? null,
    productionMedian:       productionSanity?.productionMedian ?? null,
    providerHealthSummary: {
      airbnb:  providerHealth?.airbnb?.status  ?? 'UNKNOWN',
      booking: providerHealth?.booking?.status ?? 'UNKNOWN',
    },
    ...extra,
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  evaluateMarketProductionCandidate,
  DECISIONS,
  STRUCTURAL_ACTIONABILITY_REJECTS,
  SINGLE_SOURCE_STATUSES,
  FAILING_MARKET_STATUSES,
};
