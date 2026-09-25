/*
 * srfffm-calendar: Cloudflare Worker that turns the public Google Calendar ICS feed into
 * JSON for AEM json2html, serves single-event ICS files, and (via Cron Trigger) republishes
 * the events pages in AEM when the rendered feed changes.
 */
/* eslint-disable no-console -- logs are the only runtime diagnostics (wrangler tail) */

import { DAY_MS, decodeIcs, expandCalendar } from './ical.js';
import {
  STRINGS, formatOccurrence, monthKey, normalizeLang, occurrenceToIcs,
} from './format.js';

export const TIME_ZONE = 'Europe/Berlin';
export const MAX_EVENTS = 150;
export const LOOKAHEAD_DAYS = 365;
const ADMIN_ORIGIN = 'https://admin.hlx.page';
const LOG_PREFIX = '[srfffm-calendar]';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-max-age': '86400',
};

/** Converts a Date, number or ISO string to epoch milliseconds. */
function toMs(value) {
  if (value === undefined || value === null) return Date.now();
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/** Removes a trailing slash from the public base URL. */
function baseUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

/** Builds the /events JSON document from ICS text. */
export function buildFeed(icsText, { lang = 'de', now, publicUrl = '' } = {}) {
  const language = normalizeLang(lang);
  const nowMs = toMs(now);
  const { name, occurrences } = expandCalendar(icsText, {
    from: nowMs,
    to: nowMs + LOOKAHEAD_DAYS * DAY_MS,
  });
  const options = { lang: language, tz: TIME_ZONE, publicUrl: baseUrl(publicUrl) };
  const selected = occurrences.slice(0, MAX_EVENTS);
  const events = selected.map((occ, index) => {
    const event = formatOccurrence(occ, options);
    event.monthStart = index > 0
      && monthKey(occ, TIME_ZONE) !== monthKey(selected[index - 1], TIME_ZONE);
    return event;
  });
  return {
    lang: language,
    title: STRINGS[language].title,
    pageTitle: STRINGS[language].pageTitle,
    calendar: name,
    timeZone: TIME_ZONE,
    hasEvents: events.length > 0,
    noEvents: STRINGS[language].noEvents,
    events,
  };
}

/** Finds an occurrence by id (searching one year back and the feed window ahead). */
export function findOccurrence(icsText, id, { now } = {}) {
  const nowMs = toMs(now);
  const { name, occurrences } = expandCalendar(icsText, {
    from: nowMs - LOOKAHEAD_DAYS * DAY_MS,
    to: nowMs + (LOOKAHEAD_DAYS + 31) * DAY_MS,
  });
  const occurrence = occurrences.find((occ) => occ.id === id);
  return occurrence ? { occurrence, calendarName: name } : null;
}

/** SHA-256 hex digest of a string. */
export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Hash over the de and en event lists (only data derived from the feed). */
export async function feedHash(icsText, { now, publicUrl }) {
  const de = buildFeed(icsText, { lang: 'de', now, publicUrl });
  const en = buildFeed(icsText, { lang: 'en', now, publicUrl });
  return sha256Hex(JSON.stringify([de.events, en.events]));
}

/** Fetches the ICS feed (edge-cached for 5 minutes); throws on upstream failure. */
export async function fetchIcs(env) {
  const response = await fetch(env.ICS_URL, { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!response.ok) throw new Error(`ICS fetch failed with status ${response.status}`);
  return decodeIcs(await response.arrayBuffer());
}

/** JSON response with CORS headers. */
function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
      ...headers,
    },
  });
}

/** Reads and JSON-parses a KV value, returning null when absent or invalid. */
async function readJson(kv, key) {
  const value = await kv.get(key);
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (e) {
    return value;
  }
}

/** GET /events and /events.json. */
async function handleEvents(url, env, now) {
  let ics;
  try {
    ics = await fetchIcs(env);
  } catch (e) {
    console.error(LOG_PREFIX, e.message);
    return json({ error: 'Calendar feed unavailable' }, 502);
  }
  const feed = buildFeed(ics, {
    lang: url.searchParams.get('lang'), now, publicUrl: env.PUBLIC_URL,
  });
  return json(feed, 200, { 'cache-control': 'public, max-age=300' });
}

/** GET /event.ics?id=... */
async function handleEventIcs(url, env, now) {
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'Missing id parameter' }, 400);
  let ics;
  try {
    ics = await fetchIcs(env);
  } catch (e) {
    console.error(LOG_PREFIX, e.message);
    return json({ error: 'Calendar feed unavailable' }, 502);
  }
  const found = findOccurrence(ics, id, { now });
  if (!found) return json({ error: 'Event not found' }, 404);
  const body = occurrenceToIcs(found.occurrence, { now, calendarName: found.calendarName });
  return new Response(body, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'attachment; filename="event.ics"',
      'cache-control': 'public, max-age=300',
      ...CORS_HEADERS,
    },
  });
}

/** Splits the comma-separated PAGES variable into normalised paths. */
export function parsePages(pages) {
  return String(pages || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p.startsWith('/') ? p : `/${p}`));
}

/** GET /status: state recorded by the cron job (never secrets). */
async function handleStatus(env) {
  const kv = env.CALENDAR_STATE;
  const state = kv
    ? {
      feedHash: await kv.get('feed-hash'),
      lastChange: await readJson(kv, 'last-change'),
      lastRun: await readJson(kv, 'last-run'),
    }
    : { feedHash: null, lastChange: null, lastRun: null };
  return json({
    ...state,
    configured: { kv: Boolean(kv), apiKey: Boolean(env.AEM_ADMIN_API_KEY) },
    pages: parsePages(env.PAGES),
  }, 200, { 'cache-control': 'no-store' });
}

/** Routes an HTTP request. `options.now` makes the clock injectable for tests. */
export async function handleRequest(request, env, { now } = {}) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const nowMs = toMs(now);
  if (request.method === 'GET' || request.method === 'HEAD') {
    try {
      if (path === '/events' || path === '/events.json') return await handleEvents(url, env, nowMs);
      if (path === '/event.ics') return await handleEventIcs(url, env, nowMs);
      if (path === '/status') return await handleStatus(env);
    } catch (e) {
      console.error(LOG_PREFIX, e.stack || e.message);
      return json({ error: 'Internal error' }, 500);
    }
  }
  return json({ error: 'Not found' }, 404);
}

/** POSTs to an AEM admin endpoint; returns the HTTP status (0 on network error). */
async function adminPost(url, apiKey) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `token ${apiKey}` },
    });
    const error = response.headers.get('x-error');
    console.log(LOG_PREFIX, `POST ${url} -> ${response.status}${error ? ` (${error})` : ''}`);
    await response.text().catch(() => '');
    return response.status;
  } catch (e) {
    console.log(LOG_PREFIX, `POST ${url} -> network error: ${e.message}`);
    return 0;
  }
}

const isOk = (status) => status >= 200 && status < 300;

/** Previews then publishes each page sequentially; returns per-path results. */
export async function publishPages(env) {
  const prefix = `${env.AEM_ORG}/${env.AEM_SITE}/${env.AEM_REF}`;
  return parsePages(env.PAGES).reduce(async (previous, path) => {
    const results = await previous;
    const result = { path, preview: await adminPost(`${ADMIN_ORIGIN}/preview/${prefix}${path}`, env.AEM_ADMIN_API_KEY) };
    if (isOk(result.preview)) {
      result.live = await adminPost(`${ADMIN_ORIGIN}/live/${prefix}${path}`, env.AEM_ADMIN_API_KEY);
    }
    return [...results, result];
  }, Promise.resolve([]));
}

/** Cron job: republish the events pages when the rendered feed changed. */
export async function runScheduled(env, { now } = {}) {
  const kv = env.CALENDAR_STATE;
  if (!kv || !env.AEM_ADMIN_API_KEY) {
    const missing = [!kv && 'KV binding CALENDAR_STATE', !env.AEM_ADMIN_API_KEY && 'secret AEM_ADMIN_API_KEY']
      .filter(Boolean).join(' and ');
    console.error(LOG_PREFIX, `Missing ${missing}; cannot run scheduled update.`);
    throw new Error(`Missing ${missing}`);
  }
  const nowMs = toMs(now);
  const at = new Date(nowMs).toISOString();
  let ics;
  try {
    ics = await fetchIcs(env);
  } catch (e) {
    console.error(LOG_PREFIX, e.message);
    await kv.put('last-run', JSON.stringify({ at, result: 'error', error: e.message }));
    throw e;
  }
  const hash = await feedHash(ics, { now: nowMs, publicUrl: baseUrl(env.PUBLIC_URL) });
  const previousHash = await kv.get('feed-hash');
  if (previousHash === hash) {
    console.log(LOG_PREFIX, 'Feed unchanged');
    await kv.put('last-run', JSON.stringify({ at, result: 'unchanged' }));
    return { result: 'unchanged', hash };
  }
  console.log(LOG_PREFIX, `Feed changed (${previousHash || 'none'} -> ${hash}), publishing`);
  const results = await publishPages(env);
  const failed = results.find((r) => !isOk(r.preview) || !isOk(r.live));
  if (failed) {
    const step = isOk(failed.preview) ? 'live' : 'preview';
    const record = {
      at, result: 'error', path: failed.path, step, status: failed[step], results,
    };
    await kv.put('last-run', JSON.stringify(record));
    console.error(LOG_PREFIX, `Publishing failed at ${step} ${failed.path} (${failed[step]}); will retry`);
    return { result: 'error', hash, results };
  }
  await kv.put('feed-hash', hash);
  await kv.put('last-change', JSON.stringify({ at, hash }));
  await kv.put('last-run', JSON.stringify({
    at, result: 'published', hash, results,
  }));
  return { result: 'published', hash, results };
}

export default {
  /** HTTP entry point. */
  fetch(request, env) {
    return handleRequest(request, env);
  },

  /**
   * Cron Trigger entry point. Failures (including failed preview/publish calls, which are
   * retried on the next run) are thrown so Cloudflare marks the run as failed.
   */
  async scheduled(event, env, ctx) {
    const task = runScheduled(env, { now: event.scheduledTime });
    ctx.waitUntil(task);
    const { result, results } = await task;
    if (result === 'error') {
      throw new Error(`Publishing the events pages failed: ${JSON.stringify(results)}`);
    }
  },
};
