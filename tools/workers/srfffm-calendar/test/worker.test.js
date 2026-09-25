/* eslint-disable import/no-unresolved, no-console -- node:test imports; console is muted */
/* global globalThis */
import {
  afterEach, beforeEach, describe, it,
} from 'node:test';
import assert from 'node:assert/strict';
import worker, { feedHash, handleRequest, runScheduled } from '../src/index.js';
import { FIXTURE, memoryKv } from './helpers.js';

const ICS_URL = 'https://calendar.example.com/basic.ics';
const PUBLIC_URL = 'https://srfffm-calendar.example.workers.dev';
const NOW = new Date('2026-09-25T19:00:00Z');
const originalFetch = globalThis.fetch;
const originalLog = console.log;
const originalError = console.error;

let calls;
let adminStatus;
let icsStatus;

/** Environment as configured in wrangler.toml, with test doubles. */
function makeEnv(overrides = {}) {
  return {
    ICS_URL,
    PUBLIC_URL,
    AEM_ORG: 'bp-cq',
    AEM_SITE: 'srfffm',
    AEM_REF: 'main',
    PAGES: '/de/services,/en/services',
    AEM_ADMIN_API_KEY: 'secret-token',
    CALENDAR_STATE: memoryKv(),
    ...overrides,
  };
}

beforeEach(() => {
  calls = [];
  adminStatus = () => 200;
  icsStatus = 200;
  console.log = () => {};
  console.error = () => {};
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === ICS_URL) {
      return new Response(icsStatus === 200 ? FIXTURE : 'oops', { status: icsStatus });
    }
    return new Response('{}', { status: adminStatus(url) });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.log = originalLog;
  console.error = originalError;
});

const adminCalls = () => calls.filter((c) => c.url.startsWith('https://admin.hlx.page/'));

describe('fetch handler', () => {
  it('returns the English feed as JSON with CORS and caching headers', async () => {
    const res = await handleRequest(new Request('https://w.dev/events?lang=en'), makeEnv(), { now: NOW });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(res.headers.get('cache-control'), 'public, max-age=300');
    const body = await res.json();
    assert.equal(body.lang, 'en');
    assert.equal(body.title, 'Services');
    assert.equal(body.events[0].title, 'Mahasamadi Lahiri Mahasaya');
    assert.equal(body.events[0].time, '10:30 am - 12:30 pm');
    assert.equal(body.events[1].time, '7:00 pm - 9:00 pm');
    assert.equal(calls[0].url, ICS_URL);
    assert.deepEqual(calls[0].init, { cf: { cacheTtl: 300, cacheEverything: true } });
  });

  it('serves /events.json and defaults to German', async () => {
    const res = await handleRequest(new Request('https://w.dev/events.json?lang=xx'), makeEnv(), { now: NOW });
    const body = await res.json();
    assert.equal(body.lang, 'de');
    assert.equal(body.events[0].weekday, 'Sonntag');
  });

  it('returns 502 JSON when the calendar cannot be fetched', async () => {
    icsStatus = 503;
    const res = await handleRequest(new Request('https://w.dev/events'), makeEnv(), { now: NOW });
    assert.equal(res.status, 502);
    assert.ok((await res.json()).error);
  });

  it('serves a single-event ICS for an occurrence id', async () => {
    const id = '4nej8eu6pd88ndckm9vtj3dpcs@google.com_20261028T180000Z';
    const res = await handleRequest(new Request(`https://w.dev/event.ics?id=${encodeURIComponent(id)}`), makeEnv(), { now: NOW });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/calendar; charset=utf-8');
    assert.equal(res.headers.get('content-disposition'), 'attachment; filename="event.ics"');
    const text = await res.text();
    assert.match(text, /^BEGIN:VCALENDAR\r\n/);
    assert.match(text, /\r\nDTSTART:20261028T180000Z\r\nDTEND:20261028T200000Z\r\n/);
    assert.match(text, /\r\nSUMMARY:Meditation\r\n/);
    assert.match(text, new RegExp(`\\r\\nUID:${id}\\r\\n`));
  });

  it('serves all-day events as VALUE=DATE and 404s unknown ids', async () => {
    const env = makeEnv();
    const allDay = await handleRequest(new Request('https://w.dev/event.ics?id=5ktt1so1o1j1ift4h79vgefktq%40google.com_20260810'), env, { now: NOW });
    assert.match(await allDay.text(), /DTSTART;VALUE=DATE:20260810\r\nDTEND;VALUE=DATE:20260906/);
    const missing = await handleRequest(new Request('https://w.dev/event.ics?id=nope'), env, { now: NOW });
    assert.equal(missing.status, 404);
  });

  it('answers CORS preflight, /status and unknown routes', async () => {
    const env = makeEnv({ CALENDAR_STATE: memoryKv({ 'feed-hash': 'abc', 'last-run': '{"at":"x","result":"unchanged"}' }) });
    const preflight = await handleRequest(new Request('https://w.dev/events', { method: 'OPTIONS' }), env);
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
    const status = await (await handleRequest(new Request('https://w.dev/status'), env)).json();
    assert.equal(status.feedHash, 'abc');
    assert.deepEqual(status.lastRun, { at: 'x', result: 'unchanged' });
    assert.equal(status.lastChange, null);
    assert.equal(JSON.stringify(status).includes('secret-token'), false);
    const notFound = await handleRequest(new Request('https://w.dev/nope'), env);
    assert.equal(notFound.status, 404);
    assert.equal(notFound.headers.get('content-type'), 'application/json; charset=utf-8');
    const post = await handleRequest(new Request('https://w.dev/events', { method: 'POST' }), env);
    assert.equal(post.status, 404);
  });
});

describe('scheduled handler', () => {
  it('does not call the admin API when the hash is unchanged', async () => {
    const hash = await feedHash(FIXTURE, { now: NOW.getTime(), publicUrl: PUBLIC_URL });
    const env = makeEnv({ CALENDAR_STATE: memoryKv({ 'feed-hash': hash }) });
    const result = await runScheduled(env, { now: NOW });
    assert.equal(result.result, 'unchanged');
    assert.equal(adminCalls().length, 0);
    assert.deepEqual(JSON.parse(env.CALENDAR_STATE.store.get('last-run')), { at: NOW.toISOString(), result: 'unchanged' });
  });

  it('previews then publishes both pages and stores the new hash', async () => {
    const env = makeEnv({ CALENDAR_STATE: memoryKv({ 'feed-hash': 'old' }) });
    const waits = [];
    await worker.scheduled({ scheduledTime: NOW.getTime(), cron: '*/15 * * * *' }, env, { waitUntil: (p) => waits.push(p) });
    assert.equal(waits.length, 1);
    assert.deepEqual(adminCalls().map((c) => c.url), [
      'https://admin.hlx.page/preview/bp-cq/srfffm/main/de/services',
      'https://admin.hlx.page/live/bp-cq/srfffm/main/de/services',
      'https://admin.hlx.page/preview/bp-cq/srfffm/main/en/services',
      'https://admin.hlx.page/live/bp-cq/srfffm/main/en/services',
    ]);
    adminCalls().forEach(({ init }) => {
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.Authorization, 'token secret-token');
    });
    const { store } = env.CALENDAR_STATE;
    const hash = await feedHash(FIXTURE, { now: NOW.getTime(), publicUrl: PUBLIC_URL });
    assert.equal(store.get('feed-hash'), hash);
    assert.deepEqual(JSON.parse(store.get('last-change')), { at: NOW.toISOString(), hash });
    assert.equal(JSON.parse(store.get('last-run')).result, 'published');
  });

  it('keeps the old hash when a call fails and skips live after a failed preview', async () => {
    adminStatus = (url) => (url.includes('/preview/') && url.endsWith('/en/services') ? 401 : 200);
    const env = makeEnv({ CALENDAR_STATE: memoryKv({ 'feed-hash': 'old' }) });
    const result = await runScheduled(env, { now: NOW });
    assert.equal(result.result, 'error');
    assert.deepEqual(adminCalls().map((c) => c.url.replace('https://admin.hlx.page', '')), [
      '/preview/bp-cq/srfffm/main/de/services',
      '/live/bp-cq/srfffm/main/de/services',
      '/preview/bp-cq/srfffm/main/en/services',
    ]);
    const { store } = env.CALENDAR_STATE;
    assert.equal(store.get('feed-hash'), 'old');
    assert.equal(store.has('last-change'), false);
    const lastRun = JSON.parse(store.get('last-run'));
    assert.equal(lastRun.result, 'error');
    assert.equal(lastRun.status, 401);
    assert.equal(lastRun.step, 'preview');
    assert.equal(lastRun.path, '/en/services');
  });

  it('throws on ICS failure without touching the hash', async () => {
    icsStatus = 500;
    const env = makeEnv({ CALENDAR_STATE: memoryKv({ 'feed-hash': 'old' }) });
    await assert.rejects(runScheduled(env, { now: NOW }), /ICS fetch failed/);
    assert.equal(env.CALENDAR_STATE.store.get('feed-hash'), 'old');
    assert.equal(adminCalls().length, 0);
  });

  it('throws when the API key or KV binding is missing', async () => {
    await assert.rejects(runScheduled(makeEnv({ AEM_ADMIN_API_KEY: undefined }), { now: NOW }), /AEM_ADMIN_API_KEY/);
    await assert.rejects(runScheduled(makeEnv({ CALENDAR_STATE: undefined }), { now: NOW }), /CALENDAR_STATE/);
    assert.equal(calls.length, 0);
  });
});
