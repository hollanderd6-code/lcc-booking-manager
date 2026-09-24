'use strict';

const CC_RE      = /^[A-Z]{2}$/;
const NUMERIC_RE = /^-?[0-9]+(\.[0-9]+)?$/;

function toNum(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = v.trim();
    return NUMERIC_RE.test(t) ? Number(t) : NaN;
  }
  return NaN;
}

function canonToFixed(v, decimals) {
  const rounded = parseFloat(v.toFixed(decimals));
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(decimals);
}

function computeMarketContextKey({ countryCode, latitude, longitude } = {}) {
  if (!countryCode || !CC_RE.test(countryCode)) return null;
  const lat = toNum(latitude);
  const lng = toNum(longitude);
  if (!isFinite(lat) || lat < -90  || lat > 90)   return null;
  if (!isFinite(lng) || lng < -180 || lng > 180)  return null;
  return `${countryCode}:${canonToFixed(lat, 2)}:${canonToFixed(lng, 2)}`;
}

module.exports = { computeMarketContextKey };
