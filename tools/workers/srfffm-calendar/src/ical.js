/*
 * ICS parsing and recurrence expansion (RFC 5545 subset used by Google Calendar).
 * Pure functions only: no Worker APIs, so everything here runs in Node tests as well.
 */

export const DEFAULT_TIME_ZONE = 'Europe/Berlin';
export const DAY_MS = 86400000;

const MAX_PERIODS = 50000;
const MAX_OCCURRENCES = 10000;
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const DATE_RE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/;

/* ------------------------------------------------------------------ */
/* Time zone helpers (Intl based, DST correct for any IANA zone)       */
/* ------------------------------------------------------------------ */

const formatters = new Map();

/** Returns true when Intl knows the given IANA time zone. */
export function isValidTimeZone(tz) {
  if (!tz) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch (e) {
    return false;
  }
}

/** Returns a cached numeric formatter for a time zone. */
function formatterFor(tz) {
  if (!formatters.has(tz)) {
    formatters.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }));
  }
  return formatters.get(tz);
}

/** Converts a UTC instant (ms) to wall-clock parts {y, m, d, h, mi, s} in a time zone. */
export function toZoned(ms, tz) {
  const parts = {};
  formatterFor(tz).formatToParts(new Date(ms)).forEach(({ type, value }) => {
    parts[type] = Number(value);
  });
  return {
    y: parts.year,
    m: parts.month,
    d: parts.day,
    h: parts.hour % 24,
    mi: parts.minute,
    s: parts.second,
  };
}

/** Returns the UTC offset (ms) of a time zone at a given instant. */
export function tzOffset(ms, tz) {
  const p = toZoned(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/** Converts wall-clock parts in a time zone to a UTC instant (two-pass offset guess). */
export function zonedToInstant(p, tz) {
  const wall = Date.UTC(p.y, p.m - 1, p.d, p.h || 0, p.mi || 0, p.s || 0);
  const first = wall - tzOffset(wall, tz);
  return wall - tzOffset(first, tz);
}

/** Days since 1970-01-01 for a calendar date. */
export function dayNumber(y, m, d) {
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

/** Calendar date {y, m, d, wd} for a day number (wd: 0 = Sunday). */
export function fromDayNumber(dn) {
  const date = new Date(dn * DAY_MS);
  return {
    y: date.getUTCFullYear(),
    m: date.getUTCMonth() + 1,
    d: date.getUTCDate(),
    wd: date.getUTCDay(),
  };
}

/** Weekday (0 = Sunday) of a day number. */
function weekdayOf(dn) {
  return (((dn + 4) % 7) + 7) % 7;
}

/** Number of days in a month. */
function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Formats a day number as YYYYMMDD. */
export function basicDate(dn) {
  const { y, m, d } = fromDayNumber(dn);
  return `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
}

/** Formats an instant as UTC basic format YYYYMMDDTHHMMSSZ. */
export function basicUtc(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
}

/* ------------------------------------------------------------------ */
/* Lexing                                                              */
/* ------------------------------------------------------------------ */

/** Removes folded line breaks at byte level so multi-byte characters split by a fold survive. */
export function unfoldBytes(bytes) {
  const out = new Uint8Array(bytes.length);
  let j = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    const next = bytes[i + 1];
    if (bytes[i] === 0x0d && next === 0x0a && (bytes[i + 2] === 0x20 || bytes[i + 2] === 0x09)) {
      i += 2;
    } else if (bytes[i] === 0x0a && (next === 0x20 || next === 0x09)) {
      i += 1;
    } else {
      out[j] = bytes[i];
      j += 1;
    }
  }
  return out.subarray(0, j);
}

/** Decodes a fetched ICS body (ArrayBuffer or Uint8Array) to unfolded UTF-8 text. */
export function decodeIcs(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return new TextDecoder('utf-8').decode(unfoldBytes(bytes));
}

/** Unfolds continuation lines (CRLF or LF followed by space/tab) and splits into lines. */
export function unfoldLines(text) {
  return text
    .replace(/\r?\n[ \t]/g, '')
    .split(/\r\n|\n|\r/)
    .filter((line) => line.length > 0);
}

/** Unescapes an ICS TEXT value (\\n \\N \\, \\; \\\\). */
export function unescapeText(value) {
  return String(value || '').replace(/\\([\\;,nN])/g, (m, c) => ((c === 'n' || c === 'N') ? '\n' : c));
}

/** Parses one content line into { name, params, value }, honouring quoted parameter values. */
export function parseLine(line) {
  const segments = [];
  let inQuotes = false;
  let start = 0;
  let colon = -1;
  for (let i = 0; i < line.length && colon < 0; i += 1) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && (c === ';' || c === ':')) {
      segments.push(line.slice(start, i));
      start = i + 1;
      if (c === ':') colon = i;
    }
  }
  if (colon < 0) return null;
  const [rawName, ...rawParams] = segments;
  const params = {};
  rawParams.forEach((param) => {
    const eq = param.indexOf('=');
    if (eq < 0) return;
    let value = param.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    params[param.slice(0, eq).trim().toUpperCase()] = value;
  });
  const name = rawName.trim().toUpperCase().replace(/^.*\./, '');
  return { name, params, value: line.slice(colon + 1) };
}

/** Parses ICS text into a component tree { name, props, children }. */
export function parseComponents(text) {
  const root = { name: 'ROOT', props: [], children: [] };
  const stack = [root];
  unfoldLines(text).forEach((line) => {
    const prop = parseLine(line);
    if (!prop) return;
    const current = stack[stack.length - 1];
    if (prop.name === 'BEGIN') {
      const component = { name: prop.value.trim().toUpperCase(), props: [], children: [] };
      current.children.push(component);
      stack.push(component);
    } else if (prop.name === 'END') {
      const index = stack.map((c) => c.name).lastIndexOf(prop.value.trim().toUpperCase());
      if (index > 0) stack.length = index;
    } else {
      current.props.push(prop);
    }
  });
  return root;
}

/* ------------------------------------------------------------------ */
/* Values                                                              */
/* ------------------------------------------------------------------ */

/**
 * Parses a DATE or DATE-TIME token into a date value:
 * all-day: { allDay: true, dn }; timed: { allDay: false, dn, h, mi, s, tz, ms }.
 */
export function parseDateValue(token, params = {}, defaultTz = DEFAULT_TIME_ZONE) {
  const match = DATE_RE.exec(String(token || '').trim());
  if (!match) return null;
  const [, y, m, d, h, mi, s, z] = match;
  const dn = dayNumber(Number(y), Number(m), Number(d));
  if (h === undefined || (params.VALUE || '').toUpperCase() === 'DATE') {
    return { allDay: true, dn };
  }
  let tz = defaultTz;
  if (z) {
    tz = 'UTC';
  } else if (params.TZID) {
    const candidate = params.TZID.replace(/^\//, '');
    tz = isValidTimeZone(candidate) ? candidate : defaultTz;
  }
  const parts = {
    ...fromDayNumber(dn), h: Number(h), mi: Number(mi), s: Number(s || 0),
  };
  return {
    allDay: false, dn, h: parts.h, mi: parts.mi, s: parts.s, tz, ms: zonedToInstant(parts, tz),
  };
}

/** Parses a DURATION value (e.g. P1D, PT1H30M, -P1W) into milliseconds. */
export function parseDuration(value) {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i
    .exec(String(value || '').trim());
  if (!match) return null;
  const [, sign, w, d, h, m, s] = match.map((v, i) => (i > 1 ? Number(v || 0) : v));
  const ms = ((((w * 7 + d) * 24 + h) * 60 + m) * 60 + s) * 1000;
  return sign === '-' ? -ms : ms;
}

/** Parses an RRULE value into a normalised rule object. */
export function parseRrule(value) {
  const rule = {
    freq: null,
    interval: 1,
    count: null,
    until: null,
    byday: [],
    bymonthday: [],
    bymonth: [],
    bysetpos: [],
    wkst: 1,
  };
  const numbers = (v) => v.split(',').map(Number).filter((n) => Number.isInteger(n) && n !== 0);
  String(value || '').split(';').forEach((part) => {
    const [key, v = ''] = part.split('=');
    switch (key.trim().toUpperCase()) {
      case 'FREQ': rule.freq = v.trim().toUpperCase(); break;
      case 'INTERVAL': rule.interval = Math.max(1, parseInt(v, 10) || 1); break;
      case 'COUNT': rule.count = Math.max(0, parseInt(v, 10) || 0); break;
      case 'UNTIL': rule.until = v.trim(); break;
      case 'BYMONTHDAY': rule.bymonthday = numbers(v); break;
      case 'BYMONTH': rule.bymonth = numbers(v).filter((n) => n >= 1 && n <= 12); break;
      case 'BYSETPOS': rule.bysetpos = numbers(v); break;
      case 'WKST': rule.wkst = Math.max(0, WEEKDAYS.indexOf(v.trim().toUpperCase())); break;
      case 'BYDAY':
        rule.byday = v.split(',').map((item) => {
          const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(item.trim());
          return m ? { n: Number(m[1] || 0), wd: WEEKDAYS.indexOf(m[2].toUpperCase()) } : null;
        }).filter(Boolean);
        break;
      default: break;
    }
  });
  return rule;
}

/* ------------------------------------------------------------------ */
/* Recurrence expansion                                                */
/* ------------------------------------------------------------------ */

/** Returns sorted unique numbers. */
function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a - b);
}

/** Picks the nth (1-based, negative from end) weekday matches inside a day range. */
function weekdaysInRange(first, length, byday) {
  const days = [];
  byday.forEach(({ n, wd }) => {
    const matches = [];
    const offset = (wd - weekdayOf(first) + 7) % 7;
    for (let dn = first + offset; dn < first + length; dn += 7) matches.push(dn);
    if (!n) {
      days.push(...matches);
    } else {
      const hit = matches[n > 0 ? n - 1 : matches.length + n];
      if (hit !== undefined) days.push(hit);
    }
  });
  return days;
}

/** Candidate days inside one month according to BYMONTHDAY / BYDAY, else DTSTART's day. */
function monthCandidates(y, m, rule, startDay) {
  const first = dayNumber(y, m, 1);
  const length = daysInMonth(y, m);
  if (rule.bymonthday.length) {
    const days = rule.bymonthday
      .map((md) => (md > 0 ? md : length + md + 1))
      .filter((md) => md >= 1 && md <= length)
      .map((md) => first + md - 1);
    return rule.byday.length
      ? days.filter((dn) => rule.byday.some(({ wd }) => wd === weekdayOf(dn)))
      : days;
  }
  if (rule.byday.length) return weekdaysInRange(first, length, rule.byday);
  const { d } = fromDayNumber(startDay);
  return d <= length ? [first + d - 1] : [];
}

/** Returns the first day and candidate days of recurrence period k. */
function periodCandidates(rule, startDay, k) {
  const start = fromDayNumber(startDay);
  const matchesMonth = (dn) => !rule.bymonth.length
    || rule.bymonth.includes(fromDayNumber(dn).m);
  if (rule.freq === 'DAILY') {
    const dn = startDay + k * rule.interval;
    const { m, d } = fromDayNumber(dn);
    const len = daysInMonth(fromDayNumber(dn).y, m);
    const ok = matchesMonth(dn)
      && (!rule.bymonthday.length
        || rule.bymonthday.some((md) => (md > 0 ? md : len + md + 1) === d))
      && (!rule.byday.length || rule.byday.some(({ wd }) => wd === weekdayOf(dn)));
    return { first: dn, days: ok ? [dn] : [] };
  }
  if (rule.freq === 'WEEKLY') {
    const weekStart = startDay - ((weekdayOf(startDay) - rule.wkst + 7) % 7);
    const first = weekStart + k * 7 * rule.interval;
    const weekdays = rule.byday.length ? rule.byday.map(({ wd }) => wd) : [start.wd];
    const days = weekdays.map((wd) => first + ((wd - rule.wkst + 7) % 7)).filter(matchesMonth);
    return { first, days };
  }
  if (rule.freq === 'MONTHLY') {
    const index = start.y * 12 + (start.m - 1) + k * rule.interval;
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    const first = dayNumber(y, m, 1);
    if (rule.bymonth.length && !rule.bymonth.includes(m)) return { first, days: [] };
    return { first, days: monthCandidates(y, m, rule, startDay) };
  }
  if (rule.freq === 'YEARLY') {
    const y = start.y + k * rule.interval;
    const first = dayNumber(y, 1, 1);
    let days;
    if (rule.bymonth.length) {
      days = rule.bymonth.flatMap((m) => monthCandidates(y, m, rule, startDay));
    } else if (rule.bymonthday.length) {
      days = Array.from({ length: 12 }, (v, i) => i + 1)
        .flatMap((m) => monthCandidates(y, m, rule, startDay));
    } else if (rule.byday.length) {
      days = weekdaysInRange(first, dayNumber(y + 1, 1, 1) - first, rule.byday);
    } else {
      days = start.d <= daysInMonth(y, start.m) ? [dayNumber(y, start.m, start.d)] : [];
    }
    return { first, days };
  }
  return null;
}

/** Applies BYSETPOS to the sorted candidates of one period. */
function applySetPos(days, bysetpos) {
  if (!bysetpos.length) return days;
  return uniqueSorted(bysetpos
    .map((pos) => days[pos > 0 ? pos - 1 : days.length + pos])
    .filter((dn) => dn !== undefined));
}

/** Builds an occurrence start with DTSTART's wall-clock time on another day. */
function startOnDay(dtstart, dn, calendarTz) {
  if (dtstart.allDay) {
    return { allDay: true, dn, ms: zonedToInstant(fromDayNumber(dn), calendarTz) };
  }
  const parts = {
    ...fromDayNumber(dn), h: dtstart.h, mi: dtstart.mi, s: dtstart.s,
  };
  return { ...dtstart, dn, ms: zonedToInstant(parts, dtstart.tz) };
}

/**
 * Expands an RRULE in the event's wall-clock time. Returns start values (DTSTART first)
 * up to (exclusive) the instant `to`, honouring COUNT and UNTIL.
 */
export function expandRule(dtstart, rule, { to, calendarTz = DEFAULT_TIME_ZONE }) {
  const first = startOnDay(dtstart, dtstart.dn, calendarTz);
  const out = [first];
  if (!rule || !rule.freq || (rule.count !== null && rule.count <= 1)) return out;
  const until = rule.until ? parseDateValue(rule.until, {}, dtstart.tz || calendarTz) : null;
  const toDay = Math.ceil(to / DAY_MS) + 1;
  let count = 1;
  let done = false;
  for (let k = 0; k < MAX_PERIODS && !done; k += 1) {
    const period = periodCandidates(rule, dtstart.dn, k);
    if (!period || period.first > toDay) {
      done = true;
    } else {
      const days = applySetPos(uniqueSorted(period.days), rule.bysetpos);
      for (let i = 0; i < days.length && !done; i += 1) {
        if (days[i] > dtstart.dn) {
          const start = startOnDay(dtstart, days[i], calendarTz);
          if (until && (until.allDay ? start.dn > until.dn : start.ms > until.ms)) {
            done = true;
          } else if (start.ms >= to) {
            done = true;
          } else {
            out.push(start);
            count += 1;
            if ((rule.count !== null && count >= rule.count) || out.length >= MAX_OCCURRENCES) {
              done = true;
            }
          }
        }
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Calendar                                                            */
/* ------------------------------------------------------------------ */

/** Collects all date values of a multi-valued property (EXDATE / RDATE). */
function dateList(props, defaultTz) {
  return props.flatMap((prop) => prop.value.split(',')
    .map((token) => parseDateValue(token.split('/')[0], prop.params, defaultTz))
    .filter(Boolean));
}

/** Parses a VEVENT component into a plain event object. */
export function parseEvent(component, defaultTz = DEFAULT_TIME_ZONE) {
  const get = (name) => component.props.find((p) => p.name === name);
  const all = (name) => component.props.filter((p) => p.name === name);
  const dateProp = (name) => {
    const prop = get(name);
    return prop ? parseDateValue(prop.value, prop.params, defaultTz) : null;
  };
  const text = (name) => (get(name) ? unescapeText(get(name).value) : '');
  const start = dateProp('DTSTART');
  if (!start) return null;
  const end = dateProp('DTEND');
  const duration = get('DURATION') ? parseDuration(get('DURATION').value) : null;
  let durationMs = 0;
  let durationDays = 1;
  if (start.allDay) {
    if (end) {
      durationDays = end.allDay ? end.dn - start.dn : Math.ceil((end.ms - start.ms) / DAY_MS);
    } else if (duration !== null) {
      durationDays = Math.ceil(duration / DAY_MS);
    }
    durationDays = Math.max(1, durationDays);
  } else if (end) {
    const endMs = end.allDay ? zonedToInstant(fromDayNumber(end.dn), start.tz) : end.ms;
    durationMs = Math.max(0, endMs - start.ms);
  } else if (duration !== null) {
    durationMs = Math.max(0, duration);
  }
  const rrule = get('RRULE');
  return {
    uid: (get('UID') ? get('UID').value : '').trim(),
    summary: text('SUMMARY').trim(),
    description: text('DESCRIPTION'),
    location: text('LOCATION').trim(),
    status: (get('STATUS') ? get('STATUS').value : '').trim().toUpperCase(),
    start,
    durationMs,
    durationDays,
    rrule: rrule ? parseRrule(rrule.value) : null,
    exdates: dateList(all('EXDATE'), defaultTz),
    rdates: dateList(all('RDATE'), defaultTz),
    recurrenceId: dateProp('RECURRENCE-ID'),
  };
}

/** Stable occurrence key: YYYYMMDD for all-day, UTC basic date-time otherwise. */
export function occurrenceKey(value) {
  return value.allDay ? basicDate(value.dn) : basicUtc(value.ms);
}

/** Builds an occurrence object from an event and a concrete start. */
function toOccurrence(event, start, id, calendarTz) {
  const base = {
    id,
    uid: event.uid,
    title: event.summary,
    description: event.description,
    location: event.location,
    status: event.status,
    allDay: start.allDay,
  };
  if (start.allDay) {
    const startMs = zonedToInstant(fromDayNumber(start.dn), calendarTz);
    const endDay = start.dn + event.durationDays;
    return {
      ...base,
      startDay: start.dn,
      endDay,
      startMs,
      endMs: zonedToInstant(fromDayNumber(endDay), calendarTz),
    };
  }
  return { ...base, startMs: start.ms, endMs: start.ms + event.durationMs };
}

/** Returns true when an exception date removes the given occurrence start. */
function isExcluded(event, start) {
  return event.exdates.some((ex) => {
    if (ex.allDay || start.allDay) return ex.dn === start.dn;
    return ex.ms === start.ms;
  });
}

/** Parses the calendar header and all VEVENTs. */
export function parseCalendar(text) {
  const root = parseComponents(text);
  const calendar = root.children.find((c) => c.name === 'VCALENDAR') || { props: [], children: [] };
  const header = (name) => {
    const prop = calendar.props.find((p) => p.name === name);
    return prop ? unescapeText(prop.value).trim() : '';
  };
  const declaredTz = header('X-WR-TIMEZONE');
  const timeZone = isValidTimeZone(declaredTz) ? declaredTz : DEFAULT_TIME_ZONE;
  const events = calendar.children
    .filter((c) => c.name === 'VEVENT')
    .map((c) => parseEvent(c, timeZone))
    .filter(Boolean);
  return { name: header('X-WR-CALNAME'), timeZone, events };
}

/** Sort comparator: start, end, then id (deterministic output for hashing). */
function compareOccurrences(a, b) {
  if (a.startMs !== b.startMs) return a.startMs - b.startMs;
  if (a.endMs !== b.endMs) return a.endMs - b.endMs;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/**
 * Expands all events of an ICS calendar into occurrences with end > from and start < to,
 * applying EXDATE, RDATE and RECURRENCE-ID overrides and dropping CANCELLED entries.
 */
export function expandCalendar(text, { from, to }) {
  const { name, timeZone, events } = parseCalendar(text);
  const overrides = new Map();
  events.filter((e) => e.recurrenceId).forEach((e) => {
    overrides.set(`${e.uid}_${occurrenceKey(e.recurrenceId)}`, e);
  });
  const occurrences = new Map();
  events.filter((e) => !e.recurrenceId).forEach((event) => {
    const starts = expandRule(event.start, event.rrule, { to, calendarTz: timeZone });
    const extra = event.rdates
      .filter((rd) => rd.allDay === event.start.allDay)
      .map((rd) => startOnDay(rd.allDay ? event.start : rd, rd.dn, timeZone));
    [...starts, ...extra].forEach((start) => {
      const id = `${event.uid}_${occurrenceKey(start)}`;
      if (overrides.has(id) || occurrences.has(id) || isExcluded(event, start)) return;
      occurrences.set(id, toOccurrence(event, start, id, timeZone));
    });
  });
  overrides.forEach((event, id) => {
    occurrences.set(id, toOccurrence(event, event.start, id, timeZone));
  });
  const list = [...occurrences.values()]
    .filter((o) => o.status !== 'CANCELLED' && o.endMs > from && o.startMs < to)
    .sort(compareOccurrences);
  return { name, timeZone, occurrences: list };
}
