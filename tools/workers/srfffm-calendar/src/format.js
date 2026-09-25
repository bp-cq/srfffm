/*
 * Localisation, date/time formatting, calendar deep links, HTML sanitising and
 * single-event ICS serialisation. Pure functions, no Worker APIs.
 */

import {
  DAY_MS, basicDate, basicUtc, fromDayNumber, toZoned, tzOffset,
} from './ical.js';

export const STRINGS = {
  de: {
    title: 'Veranstaltungen',
    pageTitle: 'VERANSTALTUNGEN | srf-frankfurt',
    noEvents: 'Derzeit sind keine Veranstaltungen geplant.',
    allDay: 'Ganztägig',
    months: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August',
      'September', 'Oktober', 'November', 'Dezember'],
    weekdays: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
  },
  en: {
    title: 'Services',
    pageTitle: 'SERVICES | srf-frankfurt',
    noEvents: 'There are currently no scheduled events.',
    allDay: 'All day',
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
      'September', 'October', 'November', 'December'],
    monthsShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov',
      'Dec'],
    weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  },
};

/** Normalises a language parameter to 'de' or 'en' (default 'de'). */
export function normalizeLang(lang) {
  return String(lang || '').trim().toLowerCase() === 'en' ? 'en' : 'de';
}

const pad = (n) => String(n).padStart(2, '0');

/* ------------------------------------------------------------------ */
/* Dates and times                                                     */
/* ------------------------------------------------------------------ */

/** ISO 8601 local date-time with offset, e.g. 2026-09-27T10:30:00+02:00. */
export function isoLocal(ms, tz) {
  const p = toZoned(ms, tz);
  const offsetMin = Math.round(tzOffset(ms, tz) / 60000);
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  const offset = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}${offset}`;
}

/** ISO 8601 date (YYYY-MM-DD) for a day number. */
export function isoDate(dn) {
  const { y, m, d } = fromDayNumber(dn);
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** UTC ISO without milliseconds, e.g. 2026-09-27T08:30:00Z. */
function isoUtc(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Clock time: de "19:00", en "7:00 pm". */
export function formatClock(h, mi, lang) {
  if (lang === 'en') return `${h % 12 || 12}:${pad(mi)} ${h < 12 ? 'am' : 'pm'}`;
  return `${pad(h)}:${pad(mi)}`;
}

/** Short date: de "27.09.", en "Sep 27". */
export function formatShortDate({ m, d }, lang) {
  if (lang === 'en') return `${STRINGS.en.monthsShort[m - 1]} ${d}`;
  return `${pad(d)}.${pad(m)}.`;
}

/** Local calendar parts of an occurrence start: all-day uses the date, timed the instant. */
function startParts(occ, tz) {
  if (occ.allDay) return fromDayNumber(occ.startDay);
  const p = toZoned(occ.startMs, tz);
  return { ...p, wd: fromDayNumber(Math.round(Date.UTC(p.y, p.m - 1, p.d) / DAY_MS)).wd };
}

/** Human readable time (range) of an occurrence in the page language. */
export function formatTime(occ, lang, tz) {
  const sep = ' - ';
  if (occ.allDay) {
    if (occ.endDay - occ.startDay <= 1) return STRINGS[lang].allDay;
    return `${formatShortDate(fromDayNumber(occ.startDay), lang)}${sep}${formatShortDate(fromDayNumber(occ.endDay - 1), lang)}`;
  }
  const s = toZoned(occ.startMs, tz);
  const e = toZoned(occ.endMs, tz);
  const startClock = formatClock(s.h, s.mi, lang);
  const endClock = formatClock(e.h, e.mi, lang);
  if (occ.endMs <= occ.startMs) return startClock;
  const sameDay = s.y === e.y && s.m === e.m && s.d === e.d;
  const endsAtMidnight = e.h === 0 && e.mi === 0 && occ.endMs - occ.startMs < DAY_MS;
  if (sameDay || endsAtMidnight) return `${startClock}${sep}${endClock}`;
  const join = lang === 'en' ? ', ' : ' ';
  return `${formatShortDate(s, lang)}${join}${startClock}${sep}${formatShortDate(e, lang)}${join}${endClock}`;
}

/* ------------------------------------------------------------------ */
/* HTML                                                                */
/* ------------------------------------------------------------------ */

const ALLOWED_TAGS = new Set(['br', 'p', 'em', 'i', 'strong', 'b', 'u', 'a', 'ul', 'ol', 'li']);
const BREAK_TAGS = new Set(['div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'tr',
  'table', 'section', 'article', 'header', 'footer', 'address', 'hr', 'dd', 'dt']);
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|template|noscript|textarea|svg|math|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const TOKEN_RE = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ENTITY_RE = /&(?:([a-zA-Z][a-zA-Z0-9]{1,31})|#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6}));/g;
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
};

/** Decodes numeric and the most common named HTML entities. */
export function decodeEntities(text) {
  return text.replace(ENTITY_RE, (m, name, dec, hex) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? m;
    const code = dec ? Number(dec) : parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

/** Escapes stray &, < and > in a text run (existing entities are kept). */
function escapeText(text) {
  return text
    .replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#\d{1,7}|#[xX][0-9a-fA-F]{1,6});)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Escapes a value for use inside a double-quoted attribute. */
function escapeAttr(text) {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Extracts a safe (http, https, mailto) href from a raw attribute string, or null. */
function safeHref(attrs) {
  const match = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs || '');
  if (!match) return null;
  // eslint-disable-next-line no-control-regex
  const href = decodeEntities(match[1] ?? match[2] ?? match[3]).replace(/[\u0000- ]/g, '');
  return /^(?:https?:\/\/|mailto:)/i.test(href) ? href : null;
}

/** Removes leading and trailing <br>s and whitespace. */
function trimBreaks(html) {
  return html.replace(/^(?:\s|&nbsp;|<br>)+/, '').replace(/(?:\s|&nbsp;|<br>)+$/, '');
}

/**
 * Sanitises an (already ICS-unescaped) description into a small HTML subset:
 * br, p, em, i, strong, b, u, a[href], ul, ol, li. Returns "" when empty.
 */
export function sanitizeDescription(raw) {
  if (!raw || !raw.trim()) return '';
  const src = raw.replace(/\r\n?/g, '\n').replace(DROP_WITH_CONTENT, '');
  const out = [];
  const stack = [];
  const pushText = (text) => {
    if (!text) return;
    const top = stack[stack.length - 1];
    if ((top === 'ul' || top === 'ol') && !text.trim()) return;
    out.push(escapeText(text).replace(/\n/g, '<br>'));
  };
  let last = 0;
  [...src.matchAll(TOKEN_RE)].forEach((match) => {
    pushText(src.slice(last, match.index));
    last = match.index + match[0].length;
    const [, slash, rawName, attrs] = match;
    if (!rawName) return;
    const name = rawName.toLowerCase();
    if (!ALLOWED_TAGS.has(name)) {
      if (BREAK_TAGS.has(name) && (slash || name === 'hr')) out.push('<br>');
    } else if (name === 'br') {
      out.push('<br>');
    } else if (slash) {
      const index = stack.lastIndexOf(name);
      if (index >= 0) {
        stack.splice(index).reverse().forEach((tag) => out.push(`</${tag}>`));
      }
    } else if (/\/\s*$/.test(attrs)) {
      // self-closing non-void element: nothing to render
    } else if (name === 'a') {
      const href = safeHref(attrs);
      if (href) {
        out.push(`<a href="${escapeAttr(href)}" rel="noopener">`);
        stack.push('a');
      }
    } else {
      out.push(`<${name}>`);
      stack.push(name);
    }
  });
  pushText(src.slice(last));
  stack.reverse().forEach((tag) => out.push(`</${tag}>`));
  let html = trimBreaks(out.join(''));
  if (!decodeEntities(html.replace(/<[^>]*>/g, '')).trim()) return '';
  if (!/<(?:p|ul|ol)>/.test(html)) html = `<p>${html}</p>`;
  return html;
}

/** Plain-text version of sanitised HTML (tags removed, <br> and block ends become newlines). */
export function htmlToText(html) {
  return decodeEntities(String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li>/gi, '- ')
    .replace(/<\/(?:p|li|ul|ol)>/gi, '\n')
    .replace(/<[^>]*>/g, ''))
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ------------------------------------------------------------------ */
/* Calendar links                                                      */
/* ------------------------------------------------------------------ */

/** Builds a query string, skipping empty values. */
function query(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
}

/** Google, Outlook and Yahoo "add to calendar" links for an occurrence. */
export function calendarLinks(occ, { details = '', tz }) {
  const start = occ.allDay ? basicDate(occ.startDay) : basicUtc(occ.startMs);
  const end = occ.allDay ? basicDate(occ.endDay) : basicUtc(occ.endMs);
  const google = `https://calendar.google.com/calendar/render?${query({
    action: 'TEMPLATE',
    text: occ.title,
    dates: `${start}/${end}`,
    details,
    location: occ.location,
    ctz: tz,
  })}`;
  const outlook = `https://outlook.live.com/calendar/0/deeplink/compose?${query({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: occ.title,
    startdt: occ.allDay ? isoDate(occ.startDay) : isoUtc(occ.startMs),
    enddt: occ.allDay ? isoDate(occ.endDay) : isoUtc(occ.endMs),
    allday: occ.allDay ? 'true' : '',
    body: details,
    location: occ.location,
  })}`;
  const yahoo = `https://calendar.yahoo.com/?${query({
    v: '60',
    title: occ.title,
    st: start,
    et: end,
    dur: occ.allDay ? 'allday' : '',
    desc: details,
    in_loc: occ.location,
  })}`;
  return { google, outlook, yahoo };
}

/* ------------------------------------------------------------------ */
/* Feed entries and single-event ICS                                   */
/* ------------------------------------------------------------------ */

/** Year-month key of an occurrence start in local time (used for monthStart). */
export function monthKey(occ, tz) {
  const p = startParts(occ, tz);
  return `${p.y}-${pad(p.m)}`;
}

/** Formats one occurrence into the public JSON contract (without monthStart). */
export function formatOccurrence(occ, { lang, tz, publicUrl }) {
  const strings = STRINGS[lang];
  const description = sanitizeDescription(occ.description);
  const p = startParts(occ, tz);
  const links = calendarLinks(occ, { details: htmlToText(description), tz });
  return {
    id: occ.id,
    title: occ.title,
    description,
    location: occ.location,
    start: occ.allDay ? isoDate(occ.startDay) : isoLocal(occ.startMs, tz),
    end: occ.allDay ? isoDate(occ.endDay) : isoLocal(occ.endMs, tz),
    allDay: occ.allDay,
    day: pad(p.d),
    month: strings.months[p.m - 1],
    weekday: strings.weekdays[p.wd],
    year: String(p.y),
    time: formatTime(occ, lang, tz),
    monthStart: false,
    google: links.google,
    outlook: links.outlook,
    yahoo: links.yahoo,
    ics: `${publicUrl}/event.ics?id=${encodeURIComponent(occ.id)}`,
  };
}

/** Escapes an ICS TEXT value. */
export function escapeIcsText(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Folds a content line to at most 75 UTF-8 octets per physical line. */
export function foldLine(line) {
  const encoder = new TextEncoder();
  const lines = [];
  let current = '';
  let size = 0;
  Array.from(line).forEach((char) => {
    const bytes = encoder.encode(char).length;
    const limit = lines.length ? 74 : 75;
    if (size + bytes > limit) {
      lines.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += bytes;
  });
  lines.push(current);
  return lines.join('\r\n ');
}

/** Serialises one occurrence as a standalone VCALENDAR (UTC times, or VALUE=DATE). */
export function occurrenceToIcs(occ, { now = Date.now(), calendarName = '' } = {}) {
  const dates = occ.allDay
    ? [`DTSTART;VALUE=DATE:${basicDate(occ.startDay)}`, `DTEND;VALUE=DATE:${basicDate(occ.endDay)}`]
    : [`DTSTART:${basicUtc(occ.startMs)}`, `DTEND:${basicUtc(occ.endMs)}`];
  const description = htmlToText(sanitizeDescription(occ.description));
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//srfffm//srfffm-calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    calendarName ? `X-WR-CALNAME:${escapeIcsText(calendarName)}` : null,
    'BEGIN:VEVENT',
    `UID:${occ.id}`,
    `DTSTAMP:${basicUtc(now)}`,
    ...dates,
    `SUMMARY:${escapeIcsText(occ.title)}`,
    description ? `DESCRIPTION:${escapeIcsText(description)}` : null,
    occ.location ? `LOCATION:${escapeIcsText(occ.location)}` : null,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
