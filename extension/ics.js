// Minimal iCalendar reader for the calendar preview: VEVENTs with time zones, RRULE (daily, weekly, monthly, yearly),
// EXDATE and RECURRENCE-ID overrides. Enough for Google Calendar's secret iCal feed; not a full RFC 5545 parser.

const DAY = 86400000;
const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const MAX_STEPS = 5000;

const unfold = (text) => text.replace(/\r?\n[ \t]/g, "");
const unescapeText = (value) => value.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
const dayNumber = (y, m, d) => Date.UTC(y, m - 1, d) / DAY;
const weekday = (dn) => (((dn + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function civil(dn) {
  const d = new Date(dn * DAY);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

function parseLine(line) {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return { name: line.toUpperCase(), params: {}, value: "" };
  const [name, ...rawParams] = line.slice(0, colon).split(";");
  const params = Object.fromEntries(rawParams.map((p) => {
    const eq = p.indexOf("=");
    return [p.slice(0, eq).toUpperCase(), p.slice(eq + 1).replace(/^"|"$/g, "")];
  }));
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

// MARK: Time zones

const formatters = new Map();

/** Milliseconds `tz` is ahead of UTC at the instant `utc`. */
function offsetAt(utc, tz) {
  let format = formatters.get(tz);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(tz, format);
  }
  const p = Object.fromEntries(format.formatToParts(new Date(utc)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utc;
}

/** Wall-clock parts in `tz` ("UTC", an IANA zone, or null for local/floating time) → epoch ms. */
function toTime(p, tz) {
  if (tz === "UTC") return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  if (tz) {
    try {
      const wall = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
      const guess = wall - offsetAt(wall, tz);
      return wall - offsetAt(guess, tz); // second pass settles DST transitions
    } catch {
      // Unknown zone name: fall through to local time.
    }
  }
  return new Date(p.y, p.mo - 1, p.d, p.h, p.mi, p.s).getTime();
}

function parseDate(value, params) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!m) return { time: NaN };
  const parts = { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] ?? 0), mi: +(m[5] ?? 0), s: +(m[6] ?? 0) };
  const allDay = !m[4];
  const tz = allDay ? null : m[7] ? "UTC" : params.TZID ?? null;
  return { parts, allDay, tz, time: toTime(parts, tz) };
}

function parseDuration(value) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m) return 0;
  const ms = ((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 24 * 3600 + +(m[4] ?? 0) * 3600 + +(m[5] ?? 0) * 60 + +(m[6] ?? 0)) * 1000;
  return m[1] === "-" ? -ms : ms;
}

function parseRule(value) {
  const r = Object.fromEntries(value.split(";").map((kv) => kv.split("=")));
  return {
    freq: r.FREQ,
    interval: Math.max(1, +(r.INTERVAL || 1)),
    count: r.COUNT ? +r.COUNT : undefined,
    until: r.UNTIL ? parseDate(r.UNTIL, {}).time : undefined,
    byday: r.BYDAY ? r.BYDAY.split(",") : undefined,
    bymonthday: r.BYMONTHDAY ? r.BYMONTHDAY.split(",").map(Number) : undefined,
  };
}

// MARK: Parsing

export function parseICS(text) {
  const events = [];
  let event = null;
  for (const line of unfold(text).split(/\r?\n/)) {
    if (!line) continue;
    const { name, params, value } = parseLine(line);
    if (name === "BEGIN" && value.toUpperCase() === "VEVENT") event = { exdates: [] };
    else if (name === "END" && value.toUpperCase() === "VEVENT") {
      if (event?.start && !Number.isNaN(event.start.time)) events.push(event);
      event = null;
    } else if (event) {
      switch (name) {
        case "UID": event.uid = value; break;
        case "SUMMARY": event.summary = unescapeText(value); break;
        case "LOCATION": event.location = unescapeText(value); break;
        case "STATUS": event.status = value.toUpperCase(); break;
        case "DTSTART": event.start = parseDate(value, params); break;
        case "DTEND": event.end = parseDate(value, params); break;
        case "DURATION": event.duration = parseDuration(value); break;
        case "RRULE": event.rrule = parseRule(value); break;
        case "EXDATE": for (const v of value.split(",")) event.exdates.push(parseDate(v, params).time); break;
        case "RECURRENCE-ID": event.recurrenceId = parseDate(value, params).time; break;
      }
    }
  }
  return events;
}

// MARK: Recurrence

function durationOf(event) {
  if (event.end && !Number.isNaN(event.end.time)) return event.end.time - event.start.time;
  if (event.duration !== undefined) return event.duration;
  return event.start.allDay ? DAY : 0;
}

/** Day numbers a rule step produces, ascending. */
function stepDays(rule, start, k) {
  const p = start.parts;
  const startDn = dayNumber(p.y, p.mo, p.d);
  switch (rule.freq) {
    case "DAILY":
      return [startDn + k * rule.interval];
    case "WEEKLY": {
      const monday = startDn - ((weekday(startDn) + 6) % 7) + k * 7 * rule.interval;
      const codes = rule.byday ?? [WEEKDAYS[weekday(startDn)]];
      return codes.map((c) => (WEEKDAYS.indexOf(c.slice(-2)) + 6) % 7).filter((o) => o >= 0).sort((a, b) => a - b)
        .map((offset) => monday + offset);
    }
    case "MONTHLY": {
      const index = p.y * 12 + (p.mo - 1) + k * rule.interval;
      const y = Math.floor(index / 12);
      const mo = (index % 12) + 1;
      const last = daysInMonth(y, mo);
      let days;
      if (rule.byday) {
        days = rule.byday.flatMap((code) => {
          const m = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(code);
          if (!m) return [];
          const wd = WEEKDAYS.indexOf(m[2]);
          const all = [];
          for (let d = 1; d <= last; d++) if (weekday(dayNumber(y, mo, d)) === wd) all.push(d);
          if (!m[1]) return all;
          const n = +m[1];
          const pick = n > 0 ? all[n - 1] : all[all.length + n];
          return pick ? [pick] : [];
        });
      } else {
        days = (rule.bymonthday ?? [p.d]).map((d) => (d < 0 ? last + d + 1 : d)).filter((d) => d >= 1 && d <= last);
      }
      return [...new Set(days)].sort((a, b) => a - b).map((d) => dayNumber(y, mo, d));
    }
    case "YEARLY": {
      const y = p.y + k * rule.interval;
      return p.d <= daysInMonth(y, p.mo) ? [dayNumber(y, p.mo, p.d)] : [];
    }
    default:
      return k === 0 ? [startDn] : [];
  }
}

/** First step worth generating when only [from, …) matters (COUNT needs every step from the start). */
function firstStep(rule, start, from) {
  if (rule.count !== undefined) return 0;
  const p = start.parts;
  const startDn = dayNumber(p.y, p.mo, p.d);
  const fromDn = Math.floor(from / DAY);
  const period = { DAILY: 1, WEEKLY: 7 }[rule.freq];
  if (period) return Math.max(0, Math.floor((fromDn - startDn) / (period * rule.interval)) - 1);
  const f = civil(fromDn);
  const months = { MONTHLY: (f.y - p.y) * 12 + (f.mo - p.mo), YEARLY: (f.y - p.y) * 12 }[rule.freq] ?? 0;
  const perStep = rule.freq === "YEARLY" ? 12 * rule.interval : rule.interval;
  return Math.max(0, Math.floor(months / perStep) - 1);
}

function expandRule(event, from, to) {
  const rule = event.rrule;
  const start = event.start;
  const p = start.parts;
  const tz = start.allDay ? null : start.tz;
  const startDn = dayNumber(p.y, p.mo, p.d);
  const starts = [];
  let emitted = 0;
  for (let k = firstStep(rule, start, from), steps = 0; steps < MAX_STEPS; k++, steps++) {
    for (const dn of stepDays(rule, start, k)) {
      if (dn < startDn) continue;
      const c = civil(dn);
      const time = toTime({ ...c, h: p.h, mi: p.mi, s: p.s }, tz);
      if (rule.until !== undefined && time > rule.until) return starts;
      if (rule.count !== undefined && emitted >= rule.count) return starts;
      emitted++;
      if (time > to) return starts;
      if (time >= from) starts.push(time);
    }
  }
  return starts;
}

/** Occurrences overlapping [from, to), sorted by start: { start, end, allDay, summary, location }. */
export function occurrences(events, from, to) {
  const moved = new Map(); // uid → original start times replaced by a RECURRENCE-ID event
  for (const e of events) {
    if (e.recurrenceId === undefined) continue;
    if (!moved.has(e.uid)) moved.set(e.uid, new Set());
    moved.get(e.uid).add(e.recurrenceId);
  }
  const out = [];
  for (const e of events) {
    if (e.status === "CANCELLED") continue;
    const duration = durationOf(e);
    const recurring = e.rrule && e.recurrenceId === undefined;
    const starts = recurring ? expandRule(e, from - duration, to) : [e.start.time];
    for (const start of starts) {
      if (recurring && (e.exdates.includes(start) || moved.get(e.uid)?.has(start))) continue;
      const end = start + duration;
      if (end > from && start < to) {
        out.push({ start, end, allDay: Boolean(e.start.allDay), summary: e.summary || "(No title)", location: e.location });
      }
    }
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}
