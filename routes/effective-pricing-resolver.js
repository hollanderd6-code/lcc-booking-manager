'use strict';
/**
 * Effective Price Resolver — P0-A
 *
 * Pure read-only function that resolves the effective price and min-stay for
 * each date in a range by applying the exact same priority hierarchy as
 * getCalendarPricesForRange() in server.js:
 *
 *   manual_override  >  boostprice (applied only)  >  period_rule (priority DESC, first match)
 *   >  weekday_rule (priority DESC, first match)  >  weekend_price  >  base_price  >  none
 *
 * Intentional divergences from triggerChannexRatesSync:
 *   • long_stay discount is NOT applied per date (matches calendar view, not Channex sync)
 *   • external_pricing disables BoostPrice but does not block override/legacy resolution
 *
 * No writes, no Channex calls, no side effects.
 */

const SOURCE = Object.freeze({
  MANUAL_OVERRIDE: 'manual_override',
  BOOSTPRICE:      'boostprice',
  PERIOD_RULE:     'period_rule',
  WEEKDAY_RULE:    'weekday_rule',
  WEEKEND_PRICE:   'weekend_price',
  BASE_PRICE:      'base_price',
  NONE:            'none',
});

// UTC noon avoids DST/timezone shifts when working with 'YYYY-MM-DD' strings
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function utcDow(dateStr) {
  return new Date(dateStr + 'T12:00:00Z').getUTCDay(); // 0=Sun … 6=Sat
}

// Normalise a DATE column from node-postgres (may be Date object or 'YYYY-MM-DD' string)
function fmtDate(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * Mirror of calcMinStay() in server.js.
 * Priority: narrowest date-range span → DOW rule (no date range) → global rule (no date/DOW).
 * scope: 'arrival' | 'through'
 */
function calcMinStay(rules, dateStr, dow, scope) {
  const scoped = rules.filter(r => (r.min_stay_scope || 'through') === scope);

  // 1. Date-range rules — narrowest span wins
  let result = null;
  let minSpan = Infinity;
  for (const rule of scoped) {
    if (rule.min_nights == null || !rule.start_date || !rule.end_date) continue;
    const rs = fmtDate(rule.start_date);
    const re = fmtDate(rule.end_date);
    if (dateStr >= rs && dateStr <= re) {
      const span = new Date(re) - new Date(rs);
      if (span < minSpan) { minSpan = span; result = rule.min_nights; }
    }
  }
  if (result != null) return result;

  // 2. Day-of-week rules (no date range)
  for (const rule of scoped) {
    if (rule.min_nights == null || !rule.days_of_week) continue;
    if (!rule.start_date && !rule.end_date && rule.days_of_week.includes(dow)) return rule.min_nights;
  }

  // 3. Global rules (no date range, no DOW)
  for (const rule of scoped) {
    if (rule.min_nights == null) continue;
    if (!rule.start_date && !rule.end_date && !rule.days_of_week) return rule.min_nights;
  }

  return null;
}

/**
 * Resolve effective price and min-stay for each date in [startDate, endDate).
 *
 * @param {object} pool       - pg Pool (or compatible mock)
 * @param {object} opts
 * @param {string} opts.propertyId
 * @param {string} opts.userId
 * @param {string} opts.startDate  - inclusive 'YYYY-MM-DD'
 * @param {string} opts.endDate    - exclusive 'YYYY-MM-DD'
 *
 * @returns {Promise<Array<{
 *   date:            string,
 *   price:           number|null,
 *   priceValid:      boolean,
 *   minStayArrival:  number,
 *   minStayThrough:  number,
 *   source:          string,
 *   sourceId:        number|null,
 *   locked:          boolean,
 *   breakdown:       object|null,
 *   calculatedAt:    Date|string|null,
 * }>>}
 */
async function resolveEffectivePrices(pool, { propertyId, userId, startDate, endDate }) {
  if (startDate >= endDate) return [];

  // ── 1. Property base config ──────────────────────────────────────────────────
  const propRes = await pool.query(
    `SELECT base_price, weekend_price, external_pricing
     FROM properties WHERE id = $1`,
    [propertyId]
  );
  const prop = propRes.rows[0];
  if (!prop) return [];

  const basePrice    = prop.base_price    != null ? parseFloat(prop.base_price)    : null;
  const weekendPrice = prop.weekend_price != null ? parseFloat(prop.weekend_price) : null;
  const isExternal   = !!prop.external_pricing;

  // ── 2. BoostPrice active? (disabled for external pricing) ───────────────────
  const cfgRes = await pool.query(
    `SELECT is_active FROM pricing_config
     WHERE property_id = $1 AND user_id = $2
     LIMIT 1`,
    [propertyId, userId]
  );
  const bpActive = !isExternal
    && cfgRes.rows.length > 0
    && cfgRes.rows[0].is_active === true;

  // ── 3. Manual overrides ──────────────────────────────────────────────────────
  const ovRes = await pool.query(
    `SELECT TO_CHAR(date,'YYYY-MM-DD') AS date, price, id, updated_at
     FROM pricing_overrides
     WHERE property_id = $1 AND user_id = $2
       AND date >= $3 AND date < $4`,
    [propertyId, userId, startDate, endDate]
  );
  const overridesMap = new Map(ovRes.rows.map(r => [r.date, r]));

  // ── 4. BoostPrice schedule (status='applied' only) ──────────────────────────
  const schedMap = new Map();
  if (bpActive) {
    const schedRes = await pool.query(
      `SELECT TO_CHAR(date,'YYYY-MM-DD') AS date, price, id, updated_at, breakdown
       FROM pricing_schedule
       WHERE property_id = $1
         AND date >= $2 AND date < $3
         AND status = 'applied'`,
      [propertyId, startDate, endDate]
    );
    for (const r of schedRes.rows) schedMap.set(r.date, r);
  }

  // ── 5. Pricing rules (ORDER BY priority DESC → first match wins) ────────────
  const rulesRes = await pool.query(
    `SELECT * FROM pricing_rules
     WHERE property_id = $1 AND user_id = $2 AND active = true
     ORDER BY priority DESC`,
    [propertyId, userId]
  );
  const rules      = rulesRes.rows;
  const periodRules  = rules.filter(r => r.rule_type === 'period');
  const weekdayRules = rules.filter(r => r.rule_type === 'weekday');
  const minStayRules = rules.filter(r => r.rule_type === 'min_stay');

  // ── Per-date resolution ──────────────────────────────────────────────────────
  const result = [];
  let cursor = startDate;

  while (cursor < endDate) {
    const dow = utcDow(cursor);
    const isWeekend = (dow === 5 || dow === 6); // Fri=5, Sat=6

    let price        = null;
    let source       = SOURCE.NONE;
    let sourceId     = null;
    let locked       = false;
    let breakdown    = null;
    let calculatedAt = null;

    // Priority 1: manual override
    const ov = overridesMap.get(cursor);
    if (ov) {
      price        = parseFloat(ov.price);
      source       = SOURCE.MANUAL_OVERRIDE;
      sourceId     = ov.id ?? null;
      locked       = true;
      calculatedAt = ov.updated_at ?? null;
    }

    // Priority 2: BoostPrice applied schedule
    if (source === SOURCE.NONE) {
      const sched = schedMap.get(cursor);
      if (sched) {
        price        = parseFloat(sched.price);
        source       = SOURCE.BOOSTPRICE;
        sourceId     = sched.id ?? null;
        breakdown    = sched.breakdown ?? null;
        calculatedAt = sched.updated_at ?? null;
      }
    }

    // Priority 3: period rule — ORDER BY priority DESC applied at query level,
    // first matching rule wins (NOT narrowest span — intentional, mirrors server.js)
    if (source === SOURCE.NONE) {
      for (const rule of periodRules) {
        if (!rule.start_date || !rule.end_date || rule.price == null) continue;
        const rs = fmtDate(rule.start_date);
        const re = fmtDate(rule.end_date);
        if (cursor >= rs && cursor <= re) {
          price        = parseFloat(rule.price);
          source       = SOURCE.PERIOD_RULE;
          sourceId     = rule.id ?? null;
          calculatedAt = rule.updated_at ?? null;
          break;
        }
      }
    }

    // Priority 4: weekday rule — ORDER BY priority DESC applied at query level,
    // first matching rule wins
    if (source === SOURCE.NONE) {
      for (const rule of weekdayRules) {
        if (!rule.days_of_week || rule.price == null) continue;
        if (rule.days_of_week.includes(dow)) {
          price        = parseFloat(rule.price);
          source       = SOURCE.WEEKDAY_RULE;
          sourceId     = rule.id ?? null;
          calculatedAt = rule.updated_at ?? null;
          break;
        }
      }
    }

    // Priority 5: weekend price
    if (source === SOURCE.NONE && isWeekend && weekendPrice != null) {
      price  = weekendPrice;
      source = SOURCE.WEEKEND_PRICE;
    }

    // Priority 6: base price
    if (source === SOURCE.NONE && basePrice != null) {
      price  = basePrice;
      source = SOURCE.BASE_PRICE;
    }

    // min-stay (independent of price — narrowest-span logic for date ranges)
    const minStayArrival = calcMinStay(minStayRules, cursor, dow, 'arrival') ?? 1;
    const minStayThrough = calcMinStay(minStayRules, cursor, dow, 'through') ?? 1;

    result.push({
      date:           cursor,
      price,
      priceValid:     price != null && price > 0,
      minStayArrival,
      minStayThrough,
      source,
      sourceId,
      locked,
      breakdown,
      calculatedAt,
    });

    cursor = addDays(cursor, 1);
  }

  return result;
}

module.exports = { resolveEffectivePrices, SOURCE, calcMinStay, fmtDate, addDays, utcDow };
