'use strict';
// bh-calendar-v3.js — iOS CalendarView parity
// Translates CalendarView.swift / TimelineView.swift to web.
// Reads allReservations + allProperties from reservations.html globals.
// Loads /api/pricing/calendar for pricing + booked/blocked data.

(function () {

  // ── Design tokens (mirrors CalBarLayout.swift) ──────────────────
  const COL_W      = 64;  // px per day column
  const ROW_H      = 64;  // px per property row
  const LABEL_W    = 88;  // px fixed label column
  const DAY_HDR_H  = 44;  // px day header height
  const BAR_H      = 44;  // px reservation bar height
  const BAR_R      = 11;  // px bar corner radius
  const PRICE_SZ   = 11;  // px price label font-size
  const SW_LABEL_W = 76;  // px week view label width

  // ── Platform colours (matches Color.platform() in iOS) ──────────
  const PLATFORM_COLORS = {
    airbnb:  '#E00B41',
    booking: '#003580',
    direct:  '#0E3B2E',
    abritel: '#C2410C',
    guest:   '#6D28D9',
    other:   '#6B7280',
  };
  const BHGUEST_COLOR   = '#C05555';
  const BLOCK_COLOR_RAW = 'rgba(100,110,105,0.45)';

  // ── State ────────────────────────────────────────────────────────
  let calTab         = 'mensuel';   // 'jour' | 'semaine' | 'mensuel' | 'revenus'
  let calDisplayMode = 'allLines';  // 'allLines' | 'single:<id>'
  let calSelectedMonth; // Date (UTC, 1st of month)
  let calSelectedDay;   // Date (UTC)
  let calendarData   = null;   // /api/pricing/calendar response
  let calLoading     = false;
  let calViewActive  = false;  // which view (liste vs calendrier) is shown
  let highlightRow   = null;   // propertyId
  let highlightCol   = null;   // day offset (0-based)

  // ── UTC calendar helpers ─────────────────────────────────────────
  function utcDate(y, m, d) { return new Date(Date.UTC(y, m, d)); }
  function dayKey(d) {
    return d.toISOString().slice(0, 10);
  }
  function todayUTC() {
    const n = new Date();
    return utcDate(n.getFullYear(), n.getMonth(), n.getDate());
  }
  function firstOfMonth(d) { return utcDate(d.getUTCFullYear(), d.getUTCMonth(), 1); }
  function daysInMonth(d) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  }
  function addMonths(d, n) {
    return utcDate(d.getUTCFullYear(), d.getUTCMonth() + n, 1);
  }
  function addDays(d, n) {
    return utcDate(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n);
  }
  function isSunday(d) { return d.getUTCDay() === 0; }
  function isWeekend(d) { const w = d.getUTCDay(); return w === 0 || w === 6; }
  function isToday(d) { return dayKey(d) === dayKey(todayUTC()); }
  function fmtMonthTitle(d) {
    return d.toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' })
            .replace(/^\w/, c => c.toUpperCase());
  }
  function fmtWeekLetter(d) {
    return d.toLocaleDateString('fr-FR', { weekday: 'narrow', timeZone: 'UTC' }).toUpperCase();
  }
  function fmtDayNum(d) {
    return String(d.getUTCDate());
  }
  function fmtFullDay(d) {
    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  }
  // Monday of week containing d
  function weekMonday(d) {
    const day = d.getUTCDay();             // 0=Sun
    const offset = (day + 6) % 7;         // Mon=0
    return addDays(d, -offset);
  }
  function weekDays(anchor) {
    const mon = weekMonday(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  }

  // ── Platform helpers ─────────────────────────────────────────────
  function normPlatform(r) {
    const p = ((r.platform || r.source || '').toLowerCase());
    if (p.includes('airbnb'))  return 'airbnb';
    if (p.includes('booking')) return 'booking';
    if (p.includes('abritel') || p.includes('vrbo')) return 'abritel';
    if (p === 'guest' || p === 'guest_app' || p.includes('bhguest') || p.includes('boostinghost')) return 'guest';
    if (p === 'direct' || p === 'manuel' || p === 'manual' || !p) return 'direct';
    return 'other';
  }
  function platformColor(r) {
    if (isBhGuest(r)) return BHGUEST_COLOR;
    return PLATFORM_COLORS[normPlatform(r)] || PLATFORM_COLORS.other;
  }
  function platformInitial(r) {
    const p = normPlatform(r);
    return { airbnb:'A', booking:'B', direct:'D', abritel:'Av', guest:'b', other:'?' }[p] || '?';
  }
  function isBhGuest(r) {
    return (r.uid||'').startsWith('BHGUEST_') ||
           normPlatform(r) === 'guest';
  }

  // ── Visible properties ───────────────────────────────────────────
  function visibleProperties() {
    const all = window.allProperties || [];
    if (calDisplayMode === 'allLines') return all;
    const id = calDisplayMode.replace('single:', '');
    return all.filter(p => String(p.id) === id);
  }

  // ── Calendar data API ────────────────────────────────────────────
  async function loadCalendarData(monthDate) {
    const from = dayKey(firstOfMonth(monthDate));
    const toD  = addMonths(monthDate, 1);
    const to   = dayKey(toD);
    const token = localStorage.getItem('lcc_token') || '';
    const url   = `/api/pricing/calendar?from=${from}&to=${to}&agency=all`;
    try {
      const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
      if (!res.ok) return null;
      return await res.json();
    } catch (_) { return null; }
  }

  async function loadReportingData(monthDate) {
    const y = monthDate.getUTCFullYear();
    const m = monthDate.getUTCMonth() + 1;
    const token = localStorage.getItem('lcc_token') || '';
    const propId = calDisplayMode.startsWith('single:')
      ? '&propertyId=' + calDisplayMode.replace('single:', '')
      : '';
    const url = `/api/reporting?year=${y}&month=${m}&agency=all${propId}`;
    try {
      const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
      if (!res.ok) return null;
      return await res.json();
    } catch (_) { return null; }
  }

  // ── Lane layout (overlapping reservations) ───────────────────────
  // Mirrors ReservationLaneLayout.compute() in iOS
  function computeLanes(reservations) {
    // Sort by start, then by end desc (longest first)
    const sorted = [...reservations].sort((a, b) => {
      const sa = a.start || a.startDate || '';
      const sb = b.start || b.startDate || '';
      if (sa !== sb) return sa < sb ? -1 : 1;
      const ea = a.end || a.endDate || '';
      const eb = b.end || b.endDate || '';
      return eb < ea ? -1 : 1;
    });

    const lanes = {};   // id → { laneIndex, laneCount }
    const slots = [];   // array of { end, laneIndex }

    sorted.forEach(r => {
      const id = r.uid || r.id || (r.start + r.guestName);
      const rStart = (r.start || r.startDate || '').slice(0, 10);
      const rEnd   = (r.end   || r.endDate   || '').slice(0, 10);

      // Find first free slot
      let lane = -1;
      for (let i = 0; i < slots.length; i++) {
        if (slots[i].end <= rStart) { lane = i; slots[i].end = rEnd; break; }
      }
      if (lane === -1) { lane = slots.length; slots.push({ end: rEnd, laneIndex: lane }); }
      lanes[id] = { laneIndex: lane, laneCount: 0 };
    });

    const maxLane = slots.length;
    Object.values(lanes).forEach(l => { l.laneCount = maxLane || 1; });
    return lanes;
  }

  // ── Lane vertical geometry ───────────────────────────────────────
  function laneVertical(laneIndex, laneCount) {
    if (laneCount <= 1) return { top: (ROW_H - BAR_H) / 2, h: BAR_H };
    const pad = 4, gap = 2;
    const h = (ROW_H - 2 * pad - (laneCount - 1) * gap) / laneCount;
    const top = pad + laneIndex * (h + gap);
    return { top, h };
  }

  // ── Compact price formatter ──────────────────────────────────────
  function fmtPriceCompact(price, currency) {
    const cur = currency || 'EUR';
    if (price >= 1000) {
      return (price / 1000).toFixed(1).replace('.0', '') + 'k' + currencySymbol(cur);
    }
    return Math.round(price) + currencySymbol(cur);
  }
  function currencySymbol(c) {
    const map = { EUR:'€', USD:'$', GBP:'£', ILS:'₪' };
    return map[c] || c;
  }

  // ── Reservation bar geometry for monthly view ────────────────────
  function barGeometryMensuel(r, firstDay, totalDays, lane, laneCount) {
    const startStr = (r.start || r.startDate || '').slice(0, 10);
    const endStr   = (r.end   || r.endDate   || '').slice(0, 10);
    if (!startStr || !endStr) return null;

    const startDate = new Date(startStr + 'T00:00:00Z');
    const endDate   = new Date(endStr   + 'T00:00:00Z');
    const diffStart = (startDate - firstDay) / 86400000;
    const diffEnd   = (endDate   - firstDay) / 86400000;

    const leftX  = Math.max(0,          (diffStart + 0.5) * COL_W);
    const rightX = Math.min(totalDays * COL_W, (diffEnd + 0.5) * COL_W);
    const w = rightX - leftX;
    if (w <= 0.5) return null;

    const { top, h } = laneVertical(lane, laneCount);
    return { left: leftX, width: w, top, height: h };
  }

  // ── Bar geometry for weekly view ──────────────────────────────────
  function barGeometrySemaine(r, days, cellWidth) {
    const startStr = (r.start || r.startDate || '').slice(0, 10);
    const endStr   = (r.end   || r.endDate   || '').slice(0, 10);
    if (!startStr || !endStr) return null;

    const weekStart = days[0];
    const weekEnd   = addDays(days[6], 1);
    const startDate = new Date(startStr + 'T00:00:00Z');
    const endDate   = new Date(endStr   + 'T00:00:00Z');

    if (endDate <= weekStart || startDate >= weekEnd) return null;

    const clampStart = startDate < weekStart ? weekStart : startDate;
    const clampEnd   = endDate   > weekEnd   ? weekEnd   : endDate;

    const diffStart = (clampStart - weekStart) / 86400000;
    const diffEnd   = (clampEnd   - weekStart) / 86400000;

    const totalW = days.length * cellWidth;
    const leftX  = Math.max(0,      (diffStart + 0.5) * cellWidth);
    const rightX = Math.min(totalW, (diffEnd   + 0.5) * cellWidth);
    const w = rightX - leftX;
    if (w <= 0.5) return null;

    const top = (ROW_H - BAR_H) / 2;
    return { left: leftX, width: w, top, height: BAR_H };
  }

  // ── Render a single reservation bar ─────────────────────────────
  function makeBarEl(r, geo, onClickFn) {
    const isBlock = r.type === 'block' || r.isBlock;
    if (isBlock) {
      const el = document.createElement('div');
      el.className = 'cal-bar-block';
      el.style.left   = geo.left   + 'px';
      el.style.width  = geo.width  + 'px';
      el.style.top    = geo.top    + 'px';
      el.style.height = geo.height + 'px';
      el.style.position = 'absolute';
      el.addEventListener('click', (e) => { e.stopPropagation(); onClickFn(r); });
      return el;
    }

    const el = document.createElement('div');
    el.className = 'cal-bar';
    el.style.left       = geo.left   + 'px';
    el.style.width      = geo.width  + 'px';
    el.style.top        = geo.top    + 'px';
    el.style.height     = geo.height + 'px';
    el.style.background = platformColor(r);
    if (isBhGuest(r) && (r.isPending || r.status === 'hold')) {
      el.style.opacity = '0.5';
    }

    if (geo.width > 20) {
      const lbl = document.createElement('div');
      lbl.className = 'cal-bar-label';

      // Platform chip
      if (isBhGuest(r)) {
        const chip = document.createElement('div');
        chip.className = 'cal-bhguest-chip';
        chip.textContent = 'b';
        lbl.appendChild(chip);
      } else if (geo.width > 36) {
        const chip = document.createElement('div');
        chip.className = 'cal-plt-chip';
        chip.textContent = platformInitial(r);
        lbl.appendChild(chip);
      }

      if (geo.width > 52 && (r.guestName || r.guest_name)) {
        const name = document.createElement('span');
        name.className = 'cal-bar-guest';
        name.textContent = r.guestName || r.guest_name;
        lbl.appendChild(name);
      }

      el.appendChild(lbl);
    }

    el.addEventListener('click', (e) => { e.stopPropagation(); onClickFn(r); });
    return el;
  }

  // ── Build reservation list from combined data ──────────────────
  function buildReservationsForProperty(propId, includeBlocks) {
    const all = window.allReservations || [];
    const res = all.filter(r => {
      const rProp = String(r.propertyId || r.property_id || r.property?.id || '');
      return rProp === String(propId) && (includeBlocks || r.type !== 'block');
    });

    // Also include entries from calendarData.booked + blocked
    const propData = calendarData?.properties?.[String(propId)];
    if (propData) {
      (propData.booked || []).forEach(entry => {
        const uid = entry.uid || entry.start + entry.end;
        if (!res.find(r => r.uid === uid)) {
          res.push({
            uid,
            propertyId: String(propId),
            start:      entry.start,
            end:        entry.end,
            startDate:  entry.start,
            endDate:    entry.end,
            guestName:  entry.guest,
            platform:   entry.platform,
            type:       'reservation',
          });
        }
      });
      if (includeBlocks) {
        (propData.blocked || []).forEach(entry => {
          const uid = entry.uid || 'blk-' + entry.start;
          if (!res.find(r => r.uid === uid)) {
            res.push({
              uid,
              propertyId: String(propId),
              start:      entry.start,
              end:        entry.end || addDays(new Date(entry.start + 'T00:00:00Z'), 1).toISOString().slice(0, 10),
              startDate:  entry.start,
              endDate:    entry.end,
              type:       'block',
              isBlock:    true,
            });
          }
        });
      }
    }
    return res;
  }

  // ── Check if a date is occupied ─────────────────────────────────
  function isOccupied(reservations, date) {
    const dk = dayKey(date);
    return reservations.some(r => {
      if (r.type === 'block' || r.isBlock) return false;
      const s = (r.start || r.startDate || '').slice(0, 10);
      const e = (r.end   || r.endDate   || '').slice(0, 10);
      return s <= dk && dk < e;
    });
  }

  // ── MENSUEL: render ─────────────────────────────────────────────
  function renderMensuel() {
    const dom = document.getElementById('calMensuel');
    if (!dom) return;

    const props   = visibleProperties();
    const month   = calSelectedMonth;
    const nDays   = daysInMonth(month);
    const firstD  = firstOfMonth(month);
    const totalW  = nDays * COL_W;
    const today   = todayUTC();
    const todayOff = (today - firstD) / 86400000;

    // ── Outer layout ────────────────────────────────────────────
    dom.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'cal-tl-wrap';

    // ── Label column ─────────────────────────────────────────────
    const labelCol = document.createElement('div');
    labelCol.className = 'cal-label-col';
    labelCol.id = 'calLabelCol';

    const lSpacer = document.createElement('div');
    lSpacer.className = 'cal-label-spacer';
    labelCol.appendChild(lSpacer);

    props.forEach(prop => {
      const lbl = document.createElement('div');
      lbl.className = 'cal-prop-label';
      lbl.textContent = prop.internal_name || prop.internalName || prop.name || 'Logement';
      lbl.dataset.propId = String(prop.id);
      lbl.addEventListener('click', () => {
        const pid = String(prop.id);
        highlightRow = highlightRow === pid ? null : pid;
        document.querySelectorAll('.cal-prop-label').forEach(el => {
          el.classList.toggle('hl-row', el.dataset.propId === highlightRow);
        });
        document.querySelectorAll('.cal-tl-row').forEach(el => {
          el.classList.toggle('hl-row', el.dataset.propId === highlightRow);
        });
      });
      labelCol.appendChild(lbl);
    });
    wrap.appendChild(labelCol);

    // ── Scrollable area ──────────────────────────────────────────
    const scrollArea = document.createElement('div');
    scrollArea.className = 'cal-scroll-area';
    scrollArea.id = 'calScrollArea';

    const inner = document.createElement('div');
    inner.className = 'cal-tl-inner';
    inner.style.width = totalW + 'px';

    // Day header row
    const hdrRow = document.createElement('div');
    hdrRow.className = 'cal-day-hdr-row';

    for (let offset = 0; offset < nDays; offset++) {
      const date = addDays(firstD, offset);
      const hdr = document.createElement('div');
      hdr.className = 'cal-day-hdr' +
        (isSunday(date) ? ' sunday' : '') +
        (isToday(date)  ? ' today'  : '');
      hdr.dataset.offset = offset;

      const letter = document.createElement('div');
      letter.className = 'cal-day-hdr-letter';
      letter.textContent = fmtWeekLetter(date);

      const num = document.createElement('div');
      num.className = 'cal-day-hdr-num';
      num.textContent = fmtDayNum(date);

      hdr.appendChild(letter);
      hdr.appendChild(num);

      const bar = document.createElement('div');
      bar.className = isToday(date) ? 'cal-day-hdr-today-bar' : 'cal-day-hdr-sep-bar';
      hdr.appendChild(bar);

      hdr.addEventListener('click', () => {
        const off = Number(hdr.dataset.offset);
        highlightCol = highlightCol === off ? null : off;
        document.querySelectorAll('.cal-day-hdr').forEach(el => {
          el.classList.toggle('hl-col', Number(el.dataset.offset) === highlightCol);
        });
        document.querySelectorAll('.cal-day-cell').forEach(el => {
          el.classList.toggle('hl-col', Number(el.dataset.offset) === highlightCol);
        });
      });

      hdrRow.appendChild(hdr);
    }
    inner.appendChild(hdrRow);

    // Property rows
    props.forEach(prop => {
      const propId   = String(prop.id);
      const propKey  = prop.channex_property_id || propId;
      const propData = calendarData?.properties?.[propId] ||
                       calendarData?.properties?.[propKey] || null;
      const reservations = buildReservationsForProperty(propId, true);
      const lanes = computeLanes(reservations);

      const row = document.createElement('div');
      row.className = 'cal-tl-row';
      row.dataset.propId = propId;

      // Background cells
      const cellsLayer = document.createElement('div');
      cellsLayer.style.cssText = 'display:flex;position:absolute;inset:0;';

      for (let offset = 0; offset < nDays; offset++) {
        const date   = addDays(firstD, offset);
        const dk     = dayKey(date);
        const wkend  = isWeekend(date);
        const sun    = isSunday(date);

        // Determine occupancy for price display
        const resOnDay = reservations.filter(r => {
          if (r.type === 'block' || r.isBlock) return false;
          const s = (r.start || r.startDate || '').slice(0, 10);
          const e = (r.end   || r.endDate   || '').slice(0, 10);
          return s <= dk && dk < e;
        });
        const isCheckin  = reservations.some(r => (r.start || r.startDate || '').slice(0, 10) === dk && !r.isBlock);
        const isCheckout = reservations.some(r => (r.end   || r.endDate   || '').slice(0, 10) === dk && !r.isBlock);
        const isMidStay  = resOnDay.length > 0 && !isCheckin;
        const showPrice  = !isMidStay && !(isCheckin && isCheckout);

        const cell = document.createElement('div');
        cell.className = 'cal-day-cell' +
          (wkend ? ' weekend' : '') +
          (sun   ? ' sunday'  : '');
        cell.dataset.offset = offset;
        cell.dataset.dk     = dk;

        // Price label
        if (showPrice && propData) {
          const price = propData.prices?.[dk] ||
            (wkend ? propData.weekendPrice : null) ||
            propData.basePrice;
          if (price != null && price > 0) {
            const priceLbl = document.createElement('div');
            priceLbl.className = 'cal-price-lbl' +
              (isCheckout && !isCheckin ? ' checkout' : isCheckin ? ' checkin' : '');
            priceLbl.textContent = fmtPriceCompact(price, propData.currency);
            cell.appendChild(priceLbl);
          }
        }

        // BoostPrice bolt
        if (propData && !resOnDay.length && !isCheckin && !isCheckout) {
          const bpState = boostPriceState(propData, dk);
          if (bpState !== 'none') {
            const badge = document.createElement('div');
            badge.className = 'cal-bp-badge ' + bpState;
            badge.textContent = '⚡';
            cell.appendChild(badge);
          }
        }

        // Tap free cell → day-cell action (future: open action sheet)
        cell.addEventListener('click', () => {
          if (!resOnDay.length && !isCheckin) {
            // Navigate Jour view to this date
            calSelectedDay = date;
            switchCalTab('jour');
          }
        });

        cellsLayer.appendChild(cell);
      }
      row.appendChild(cellsLayer);

      // Reservation bars layer
      const barsLayer = document.createElement('div');
      barsLayer.className = 'cal-bars-layer';

      reservations.forEach(r => {
        const rid = r.uid || r.id || (r.start + (r.guestName||''));
        const lane = lanes[rid] || { laneIndex: 0, laneCount: 1 };
        const geo  = barGeometryMensuel(r, firstD, nDays, lane.laneIndex, lane.laneCount);
        if (!geo) return;
        const bar = makeBarEl(r, geo, (res) => {
          if (typeof window.openDetail === 'function') window.openDetail(res);
        });
        barsLayer.appendChild(bar);
      });

      row.appendChild(barsLayer);
      inner.appendChild(row);
    });

    scrollArea.appendChild(inner);
    wrap.appendChild(scrollArea);
    dom.appendChild(wrap);

    // Scroll to today
    if (todayOff >= 0 && todayOff < nDays) {
      setTimeout(() => {
        const scroll = document.getElementById('calScrollArea');
        if (!scroll) return;
        const targetX = Math.max(0, todayOff * COL_W - scroll.clientWidth / 2 + COL_W / 2);
        scroll.scrollLeft = targetX;
      }, 30);
    }
  }

  // ── BoostPrice state helper ──────────────────────────────────────
  function boostPriceState(propData, dk) {
    if (!propData?.boostpriceEnabled) return 'none';
    const source = propData?.sources?.[dk];
    if (source === 'boostprice') return 'effective';
    const bp = propData?.bpSchedule?.[dk];
    if (bp?.status === 'pending' && source !== 'manual_override') return 'pending';
    return 'none';
  }

  // ── JOUR: render ─────────────────────────────────────────────────
  function renderJour() {
    const dom = document.getElementById('calJour');
    if (!dom) return;

    const month = calSelectedMonth;
    const nDays = daysInMonth(month);
    const firstD = firstOfMonth(month);

    dom.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'cal-jour-wrap';

    // Date strip
    const strip = document.createElement('div');
    strip.className = 'cal-jour-date-strip';
    strip.id = 'calJourStrip';

    for (let i = 0; i < nDays; i++) {
      const d = addDays(firstD, i);
      const dk = dayKey(d);
      const isSelected = dayKey(calSelectedDay) === dk;
      const isT = isToday(d);

      const chip = document.createElement('button');
      chip.className = 'cal-jour-chip' +
        (isSelected ? ' selected' : '') +
        (!isSelected && isT ? ' today-unsel' : '');
      chip.dataset.dk = dk;

      const letter = document.createElement('div');
      letter.className = 'cal-jc-letter';
      letter.textContent = fmtWeekLetter(d);

      const num = document.createElement('div');
      num.className = 'cal-jc-num';
      num.textContent = fmtDayNum(d);

      chip.appendChild(letter);
      chip.appendChild(num);
      chip.addEventListener('click', () => {
        calSelectedDay = d;
        renderJourContent();
        // Update chip selection
        document.querySelectorAll('#calJourStrip .cal-jour-chip').forEach(c => {
          c.classList.toggle('selected', c.dataset.dk === dk);
          if (!c.classList.contains('selected') && dayKey(d) === dayKey(todayUTC())) {
            c.classList.add('today-unsel');
          }
        });
      });

      strip.appendChild(chip);
    }
    wrap.appendChild(strip);

    // Content area
    const content = document.createElement('div');
    content.className = 'cal-jour-content';
    content.id = 'calJourContent';
    wrap.appendChild(content);

    dom.appendChild(wrap);
    renderJourContent();

    // Scroll to selected
    setTimeout(() => {
      const sel = strip.querySelector('.cal-jour-chip.selected');
      if (sel) sel.scrollIntoView({ inline: 'center', behavior: 'smooth' });
    }, 30);
  }

  function renderJourContent() {
    const content = document.getElementById('calJourContent');
    if (!content) return;
    const d  = calSelectedDay;
    const dk = dayKey(d);
    const props = visibleProperties();

    let arrivees = [], departs = [], sejours = [];

    props.forEach(prop => {
      const propId = String(prop.id);
      const ress = buildReservationsForProperty(propId, false);
      ress.forEach(r => {
        const s = (r.start || r.startDate || '').slice(0, 10);
        const e = (r.end   || r.endDate   || '').slice(0, 10);
        if (s === dk) arrivees.push({ prop, r });
        else if (e === dk) departs.push({ prop, r });
        else if (s < dk && dk < e) sejours.push({ prop, r });
      });
    });

    content.innerHTML = '';

    function makeSection(title, items) {
      if (!items.length) return;
      const h = document.createElement('div');
      h.className = 'cal-jour-section-title';
      h.textContent = title;
      content.appendChild(h);
      items.forEach(({ prop, r }) => {
        const card = document.createElement('div');
        card.className = 'cal-jour-card';
        const propName = prop.internal_name || prop.internalName || prop.name || '';
        card.innerHTML = `
          <div class="cal-jour-card-prop">${propName}</div>
          <div class="cal-jour-card-guest">${r.guestName || r.guest_name || 'Voyageur'}</div>
          <div class="cal-jour-card-meta">${(r.start||r.startDate||'').slice(0,10)} → ${(r.end||r.endDate||'').slice(0,10)}</div>
        `;
        card.addEventListener('click', () => {
          if (typeof window.openDetail === 'function') window.openDetail(r);
        });
        content.appendChild(card);
      });
    }

    makeSection('Arrivées', arrivees);
    makeSection('Séjours en cours', sejours);
    makeSection('Départs', departs);

    if (!arrivees.length && !sejours.length && !departs.length) {
      const empty = document.createElement('div');
      empty.className = 'cal-jour-empty';
      empty.textContent = 'Aucun séjour ce jour.';
      content.appendChild(empty);
    }
  }

  // ── SEMAINE: render ──────────────────────────────────────────────
  function renderSemaine() {
    const dom = document.getElementById('calSemaine');
    if (!dom) return;

    const days  = weekDays(calSelectedDay);
    const props = visibleProperties();

    dom.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'cal-sem-wrap';

    const grid = document.createElement('div');
    grid.className = 'cal-sem-grid';

    // Label column
    const labelCol = document.createElement('div');
    labelCol.className = 'cal-sem-label-col';

    const spacer = document.createElement('div');
    spacer.className = 'cal-sem-label-spacer';
    labelCol.appendChild(spacer);

    props.forEach(prop => {
      const lbl = document.createElement('div');
      lbl.className = 'cal-sem-prop-label';
      lbl.textContent = prop.internal_name || prop.internalName || prop.name || 'Logement';
      labelCol.appendChild(lbl);
    });

    grid.appendChild(labelCol);

    // Body (header + rows)
    const body = document.createElement('div');
    body.className = 'cal-sem-body';

    const hdrRow = document.createElement('div');
    hdrRow.className = 'cal-sem-hdr-row';

    days.forEach(day => {
      const isT = isToday(day);
      const hdr = document.createElement('div');
      hdr.className = 'cal-sem-day-hdr' + (isT ? ' today' : '');

      const letter = document.createElement('div');
      letter.className = 'cal-day-hdr-letter';
      letter.textContent = fmtWeekLetter(day);

      const num = document.createElement('div');
      num.className = 'cal-day-hdr-num';
      num.textContent = fmtDayNum(day);

      hdr.appendChild(letter);
      hdr.appendChild(num);
      hdrRow.appendChild(hdr);
    });
    body.appendChild(hdrRow);

    // Property rows
    const rowsWrap = document.createElement('div');
    rowsWrap.className = 'cal-sem-rows';

    props.forEach(prop => {
      const propId  = String(prop.id);
      const ress    = buildReservationsForProperty(propId, true);
      const lanes   = computeLanes(ress);

      const row = document.createElement('div');
      row.className = 'cal-sem-row';

      // Background cells
      days.forEach(day => {
        const wkend = isWeekend(day);
        const cell = document.createElement('div');
        cell.className = 'cal-sem-cell' + (wkend ? ' weekend' : '');
        row.appendChild(cell);
      });

      // Bars layer — use relative positioning within row
      const barsLayer = document.createElement('div');
      barsLayer.className = 'cal-sem-bars';

      // Compute cell width based on number of visible days
      const cellW = Math.max(1, (document.getElementById('calSemaine')?.offsetWidth || 700) - SW_LABEL_W) / days.length;

      ress.forEach(r => {
        const geo = barGeometrySemaine(r, days, cellW);
        if (!geo) return;
        const bar = document.createElement('div');
        const isBlock = r.type === 'block' || r.isBlock;
        if (isBlock) {
          bar.className = 'cal-bar-block';
          bar.style.cssText = `position:absolute;left:${geo.left}px;width:${geo.width}px;top:${geo.top}px;height:${geo.height}px;`;
        } else {
          bar.className = 'cal-sem-bar';
          bar.style.cssText = `left:${geo.left}px;width:${geo.width}px;top:${geo.top}px;height:${geo.height}px;background:${platformColor(r)};`;
          if (geo.width > 36 && (r.guestName || r.guest_name)) {
            bar.innerHTML = `<div class="cal-bar-label"><span class="cal-bar-guest">${r.guestName || r.guest_name}</span></div>`;
          }
        }
        bar.addEventListener('click', (e) => {
          e.stopPropagation();
          if (typeof window.openDetail === 'function') window.openDetail(r);
        });
        barsLayer.appendChild(bar);
      });

      row.appendChild(barsLayer);
      rowsWrap.appendChild(row);
    });

    body.appendChild(rowsWrap);
    grid.appendChild(body);
    wrap.appendChild(grid);
    dom.appendChild(wrap);
  }

  // ── REVENUS: render ──────────────────────────────────────────────
  async function renderRevenus() {
    const dom = document.getElementById('calRevenus');
    if (!dom) return;

    dom.innerHTML = '<div class="cal-spinner-wrap"><div class="cal-spinner"></div></div>';

    const data = await loadReportingData(calSelectedMonth);

    const month = calSelectedMonth;
    const title = fmtMonthTitle(month) + ' ' + month.getUTCFullYear();

    dom.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'cal-rev-wrap';

    wrap.innerHTML = `<div class="cal-rev-header">${title}</div>
      <div class="cal-rev-subtitle">Résumé des revenus du mois</div>`;

    if (!data) {
      wrap.innerHTML += `<div class="cal-jour-empty">Impossible de charger les revenus.</div>`;
      dom.appendChild(wrap);
      return;
    }

    // KPIs
    const summary = data.summary || data;
    const totalRev = summary.total_revenue || summary.totalRevenue || 0;
    const totalNights = summary.total_nights || summary.totalNights || 0;
    const occupancyRate = summary.occupancy_rate || summary.occupancyRate || 0;

    if (totalRev || totalNights) {
      const kpiRow = document.createElement('div');
      kpiRow.className = 'cal-rev-kpi-row';
      kpiRow.innerHTML = `
        <div class="cal-rev-kpi">
          <div class="cal-rev-kpi-label">Revenus</div>
          <div class="cal-rev-kpi-value">${fmtPriceCompact(totalRev, 'EUR')}</div>
        </div>
        <div class="cal-rev-kpi">
          <div class="cal-rev-kpi-label">Nuits</div>
          <div class="cal-rev-kpi-value">${totalNights}</div>
        </div>
        <div class="cal-rev-kpi">
          <div class="cal-rev-kpi-label">Taux d'occ.</div>
          <div class="cal-rev-kpi-value">${Math.round(occupancyRate)}%</div>
        </div>
      `;
      wrap.appendChild(kpiRow);
    }

    // Per-property table
    const byProp = data.properties || data.byProperty || [];
    if (byProp.length) {
      const tableWrap = document.createElement('div');
      tableWrap.className = 'cal-rev-table-wrap';
      let rows = byProp.map(p => {
        const name = p.name || p.propertyName || 'Logement';
        const rev  = p.revenue || p.totalRevenue || 0;
        const nights = p.nights || p.totalNights || 0;
        const occ  = p.occupancy_rate || p.occupancyRate || 0;
        const cur  = p.currency || 'EUR';
        return `<tr>
          <td class="cal-rev-td-prop">${name}</td>
          <td style="text-align:center;">${nights}</td>
          <td style="text-align:center;">${Math.round(occ)}%</td>
          <td class="cal-rev-td-money">${fmtPriceCompact(rev, cur)}</td>
        </tr>`;
      }).join('');

      tableWrap.innerHTML = `<table class="cal-rev-table">
        <thead><tr>
          <th>Logement</th>
          <th style="text-align:center;">Nuits</th>
          <th style="text-align:center;">Occupation</th>
          <th style="text-align:right;">Revenu</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
      wrap.appendChild(tableWrap);
    } else {
      wrap.innerHTML += `<div class="cal-jour-empty">Aucune donnée disponible pour ce mois.</div>`;
    }

    dom.appendChild(wrap);
  }

  // ── Tab switcher ─────────────────────────────────────────────────
  function switchCalTab(tab) {
    calTab = tab;

    // Update segmented buttons
    document.querySelectorAll('.cal-seg-pill').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // Show correct pane
    document.querySelectorAll('.cal-tab-pane').forEach(pane => {
      const active = pane.id === 'cal' + tab.charAt(0).toUpperCase() + tab.slice(1);
      pane.classList.toggle('active', active);
    });

    // Update nav chevrons: week vs month nav
    updateNavChevrons();

    // Render the active tab
    renderActiveTab();
  }

  async function renderActiveTab() {
    switch (calTab) {
      case 'mensuel':
        if (calLoading) return;
        if (!calendarData) {
          calLoading = true;
          showMensuelLoading();
          calendarData = await loadCalendarData(calSelectedMonth);
          calLoading = false;
        }
        renderMensuel();
        break;
      case 'jour':
        renderJour();
        break;
      case 'semaine':
        if (!calendarData) {
          calLoading = true;
          calendarData = await loadCalendarData(calSelectedMonth);
          calLoading = false;
        }
        renderSemaine();
        break;
      case 'revenus':
        renderRevenus();
        break;
    }
  }

  function showMensuelLoading() {
    const dom = document.getElementById('calMensuel');
    if (dom) {
      dom.innerHTML = '<div class="cal-spinner-wrap"><div class="cal-spinner"></div></div>';
    }
  }

  // ── Month/Week navigation ────────────────────────────────────────
  function updateNavChevrons() {
    // The chevrons always navigate month (or week in semaine tab)
    // Nothing structural changes — just visual label could update
  }

  function calNavigatePrev() {
    if (calTab === 'semaine') {
      calSelectedDay = addDays(calSelectedDay, -7);
      const newMK = dayKey(firstOfMonth(calSelectedDay)).slice(0, 7);
      const curMK = dayKey(calSelectedMonth).slice(0, 7);
      if (newMK !== curMK) {
        calSelectedMonth = firstOfMonth(calSelectedDay);
        calendarData = null;
      }
    } else {
      calSelectedMonth = addMonths(calSelectedMonth, -1);
      calendarData = null;
    }
    updateMonthTitle();
    renderActiveTab();
  }

  function calNavigateNext() {
    if (calTab === 'semaine') {
      calSelectedDay = addDays(calSelectedDay, 7);
      const newMK = dayKey(firstOfMonth(calSelectedDay)).slice(0, 7);
      const curMK = dayKey(calSelectedMonth).slice(0, 7);
      if (newMK !== curMK) {
        calSelectedMonth = firstOfMonth(calSelectedDay);
        calendarData = null;
      }
    } else {
      calSelectedMonth = addMonths(calSelectedMonth, 1);
      calendarData = null;
    }
    updateMonthTitle();
    renderActiveTab();
  }

  function updateMonthTitle() {
    const el = document.getElementById('calMonthTitle');
    if (el) el.textContent = fmtMonthTitle(calSelectedMonth);
  }

  // ── View toggle (Liste / Calendrier) ────────────────────────────
  function showCalendar(show) {
    calViewActive = show;

    const calView  = document.getElementById('calendarView');
    const listView = document.getElementById('listView');

    if (calView)  calView.classList.toggle('cal-active', show);
    if (listView) listView.style.display = show ? 'none' : '';

    // Update toggle buttons
    document.querySelectorAll('.cal-view-toggle-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === (show ? 'calendrier' : 'liste'));
    });

    if (show && !calendarData && !calLoading) {
      renderActiveTab();
    }
  }

  // ── Property dropdown ─────────────────────────────────────────────
  function updateSuperTitle() {
    const el = document.getElementById('calSuperTitle');
    if (!el) return;
    if (calDisplayMode === 'allLines') {
      el.textContent = 'Tous les logements';
    } else {
      const id = calDisplayMode.replace('single:', '');
      const prop = (window.allProperties || []).find(p => String(p.id) === id);
      el.textContent = prop ? (prop.internal_name || prop.internalName || prop.name) : 'Logement';
    }
  }

  function buildPropertyDropdown() {
    const dd = document.getElementById('calPropDropdown');
    if (!dd) return;

    dd.innerHTML = '';
    const all = document.createElement('div');
    all.className = 'cal-prop-dropdown-item' + (calDisplayMode === 'allLines' ? ' selected' : '');
    all.innerHTML = '<i class="fas fa-check"></i><span>Tous les logements</span>';
    all.addEventListener('click', () => {
      calDisplayMode = 'allLines';
      updateSuperTitle();
      dd.classList.remove('open');
      document.getElementById('calSuperTitle')?.classList.remove('open');
      calendarData = null;
      renderActiveTab();
    });
    dd.appendChild(all);

    (window.allProperties || []).forEach(prop => {
      const item = document.createElement('div');
      const id = String(prop.id);
      const isSelected = calDisplayMode === 'single:' + id;
      item.className = 'cal-prop-dropdown-item' + (isSelected ? ' selected' : '');
      const name = prop.internal_name || prop.internalName || prop.name || 'Logement';
      item.innerHTML = `<i class="fas fa-check"></i><span>${name}</span>`;
      item.addEventListener('click', () => {
        calDisplayMode = 'single:' + id;
        updateSuperTitle();
        dd.classList.remove('open');
        document.getElementById('calSuperTitle')?.classList.remove('open');
        calendarData = null;
        renderActiveTab();
      });
      dd.appendChild(item);
    });
  }

  // ── Init ──────────────────────────────────────────────────────────
  function init() {
    const today = todayUTC();
    calSelectedMonth = firstOfMonth(today);
    calSelectedDay   = today;

    // Wire toggle buttons
    document.querySelectorAll('.cal-view-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        showCalendar(btn.dataset.mode === 'calendrier');
      });
    });

    // Wire segmented tabs
    document.querySelectorAll('.cal-seg-pill').forEach(btn => {
      btn.addEventListener('click', () => switchCalTab(btn.dataset.tab));
    });

    // Wire prev/next
    document.getElementById('calPrevBtn')?.addEventListener('click', calNavigatePrev);
    document.getElementById('calNextBtn')?.addEventListener('click', calNavigateNext);

    // Wire supertitle property dropdown
    const superTitle = document.getElementById('calSuperTitle');
    const dropdown   = document.getElementById('calPropDropdown');
    if (superTitle && dropdown) {
      superTitle.addEventListener('click', (e) => {
        e.stopPropagation();
        buildPropertyDropdown();
        dropdown.classList.toggle('open');
        superTitle.classList.toggle('open');
      });
      document.addEventListener('click', () => {
        dropdown.classList.remove('open');
        superTitle?.classList.remove('open');
      });
    }

    // Update initial title
    updateMonthTitle();

    // When allProperties loads, update supertitle
    // (called again from reservations.html after loadData completes)
  }

  // Expose public API for reservations.html to call after data loads
  window.bhCalV3 = {
    init,
    renderActiveTab,
    buildPropertyDropdown,
    updateSuperTitle,
    showCalendar,
  };

})();
