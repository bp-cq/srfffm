/* eslint-disable import/no-unresolved */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTime, htmlToText, occurrenceToIcs, sanitizeDescription,
} from '../src/format.js';
import { buildFeed } from '../src/index.js';
import { FIXTURE, calendar, vevent } from './helpers.js';

const TZ = 'Europe/Berlin';
const PUBLIC_URL = 'https://srfffm-calendar.example.workers.dev';
const timed = (startIso, endIso) => ({
  allDay: false, startMs: Date.parse(startIso), endMs: Date.parse(endIso),
});

describe('time formatting', () => {
  it('formats German 24h and English 12h ranges', () => {
    const occ = timed('2026-09-30T17:00:00Z', '2026-09-30T19:00:00Z');
    assert.equal(formatTime(occ, 'de', TZ), '19:00 - 21:00');
    assert.equal(formatTime(occ, 'en', TZ), '7:00 pm - 9:00 pm');
    const morning = timed('2026-09-27T08:30:00Z', '2026-09-27T10:30:00Z');
    assert.equal(formatTime(morning, 'en', TZ), '10:30 am - 12:30 pm');
    const toMidnight = timed('2026-12-31T21:00:00Z', '2026-12-31T23:00:00Z');
    assert.equal(formatTime(toMidnight, 'en', TZ), '10:00 pm - 12:00 am');
    assert.equal(formatTime(toMidnight, 'de', TZ), '22:00 - 00:00');
    const overnight = timed('2026-12-31T22:00:00Z', '2027-01-01T00:30:00Z');
    assert.equal(formatTime(overnight, 'en', TZ), 'Dec 31, 11:00 pm - Jan 1, 1:30 am');
  });

  it('formats timed events spanning several days', () => {
    const occ = timed('2026-09-27T08:30:00Z', '2026-09-28T10:00:00Z');
    assert.equal(formatTime(occ, 'de', TZ), '27.09. 10:30 - 28.09. 12:00');
    assert.equal(formatTime(occ, 'en', TZ), 'Sep 27, 10:30 am - Sep 28, 12:00 pm');
  });

  it('formats all-day single and multi-day events', () => {
    const feedDe = buildFeed(FIXTURE, { lang: 'de', now: '2026-08-01T00:00:00Z', publicUrl: PUBLIC_URL });
    const feedEn = buildFeed(FIXTURE, { lang: 'en', now: '2026-08-01T00:00:00Z', publicUrl: PUBLIC_URL });
    const pauseDe = feedDe.events.find((e) => e.title === 'Sommerpause');
    const pauseEn = feedEn.events.find((e) => e.title === 'Sommerpause');
    assert.equal(pauseDe.time, '10.08. - 05.09.');
    assert.equal(pauseEn.time, 'Aug 10 - Sep 5');
    assert.equal(pauseDe.start, '2026-08-10');
    assert.equal(pauseDe.end, '2026-09-06');
    assert.equal(pauseDe.allDay, true);
    assert.equal(pauseDe.id, '5ktt1so1o1j1ift4h79vgefktq@google.com_20260810');
    assert.match(pauseDe.google, /dates=20260810%2F20260906/);
    assert.match(pauseDe.outlook, /allday=true/);
    assert.match(pauseDe.yahoo, /dur=allday/);

    const single = { allDay: true, startDay: 20000, endDay: 20001 };
    assert.equal(formatTime(single, 'de', TZ), 'Ganztägig');
    assert.equal(formatTime(single, 'en', TZ), 'All day');
  });
});

describe('feed', () => {
  const now = new Date('2026-09-25T19:00:00Z');

  it('builds the JSON contract with localized fields and monthStart flags', () => {
    const feed = buildFeed(FIXTURE, { lang: 'de', now, publicUrl: `${PUBLIC_URL}/` });
    assert.equal(feed.lang, 'de');
    assert.equal(feed.title, 'Veranstaltungen');
    assert.equal(feed.calendar, 'SRF-Gruppe Frankfurt Rhein-Main');
    assert.equal(feed.timeZone, 'Europe/Berlin');
    assert.equal(feed.hasEvents, true);
    assert.equal(feed.noEvents, 'Derzeit sind keine Veranstaltungen geplant.');
    const [first, second, third] = feed.events;
    assert.deepEqual(Object.keys(first), ['id', 'title', 'description', 'location', 'start', 'end',
      'allDay', 'day', 'month', 'weekday', 'year', 'time', 'monthStart', 'google', 'outlook', 'yahoo',
      'ics']);
    assert.equal(first.id, '4tjpr05h3es1aq84ikuijb86jf@google.com_20260927T083000Z');
    assert.equal(first.title, 'Mahasamadi Lahiri Mahasaya');
    assert.equal(first.start, '2026-09-27T10:30:00+02:00');
    assert.equal(first.end, '2026-09-27T12:30:00+02:00');
    assert.equal(first.weekday, 'Sonntag');
    assert.equal(first.day, '27');
    assert.equal(first.month, 'September');
    assert.equal(first.year, '2026');
    assert.equal(first.time, '10:30 - 12:30');
    assert.equal(first.ics, `${PUBLIC_URL}/event.ics?id=4tjpr05h3es1aq84ikuijb86jf%40google.com_20260927T083000Z`);
    assert.match(first.google, /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE&text=Mahasamadi%20Lahiri%20Mahasaya&dates=20260927T083000Z%2F20260927T103000Z/);
    assert.match(first.outlook, /startdt=2026-09-27T08%3A30%3A00Z/);
    assert.equal(second.title, 'Meditation');
    assert.equal(second.time, '19:00 - 21:00');
    assert.equal(third.month, 'Oktober');
    assert.equal(third.day, '04');
    assert.deepEqual([first.monthStart, second.monthStart, third.monthStart], [false, false, true]);
    assert.equal(feed.events.filter((e) => e.monthStart).length >= 11, true);
    const oct25 = feed.events.find((e) => e.start.startsWith('2026-10-25'));
    assert.equal(oct25.time, '10:30 - 12:30');
    assert.equal(oct25.start, '2026-10-25T10:30:00+01:00');
  });

  it('selects upcoming occurrences within 365 days, max 150, sorted', () => {
    const feed = buildFeed(FIXTURE, { lang: 'en', now, publicUrl: PUBLIC_URL });
    assert.equal(feed.title, 'Services');
    assert.ok(feed.events.length > 0 && feed.events.length <= 150);
    const starts = feed.events.map((e) => Date.parse(e.start));
    assert.deepEqual([...starts].sort((a, b) => a - b), starts);
    assert.ok(Date.parse(feed.events.at(-1).start) < now.getTime() + 365 * 86400000);
    assert.equal(feed.events[0].weekday, 'Sunday');
    assert.equal(feed.events[0].time, '10:30 am - 12:30 pm');
  });

  it('reports no events and falls back to German for unknown languages', () => {
    const feed = buildFeed(calendar(vevent('UID:p', 'DTSTART:20200101T100000Z', 'SUMMARY:Past')), {
      lang: 'fr', now, publicUrl: PUBLIC_URL,
    });
    assert.equal(feed.lang, 'de');
    assert.equal(feed.hasEvents, false);
    assert.deepEqual(feed.events, []);
    assert.equal(feed.calendar, 'Test Calendar');
  });

  it('keeps the sanitised HTML of fixture descriptions', () => {
    const feed = buildFeed(FIXTURE, { lang: 'de', now: '2026-06-01T00:00:00Z', publicUrl: PUBLIC_URL });
    const retreat = feed.events.find((e) => e.title === 'Tagesretreat');
    assert.ok(retreat.description.startsWith('<ul><li><p>10:30 - 12:30 Uhr Meditation</p></li>'));
    assert.match(retreat.google, /details=-%2010%3A30%20-%2012%3A30%20Uhr%20Meditation%0A/);
  });
});

describe('description sanitising', () => {
  it('removes scripts, keeps allowed tags and strips attributes', () => {
    const html = sanitizeDescription('<script>alert(1)</script><em class="x" onclick="evil()">Hi</em> <span style="color:red">there</span><img src=x onerror=alert(1)>');
    assert.equal(html, '<p><em>Hi</em> there</p>');
  });

  it('keeps safe links only and adds rel=noopener', () => {
    assert.equal(
      sanitizeDescription('<a href="https://srf.org/?a=1&amp;b=2" target="_blank">SRF</a> <a href="javascript:alert(1)">x</a>'),
      '<p><a href="https://srf.org/?a=1&amp;b=2" rel="noopener">SRF</a> x</p>',
    );
    assert.equal(sanitizeDescription('<a href="mailto:info@example.org">Mail</a>'), '<p><a href="mailto:info@example.org" rel="noopener">Mail</a></p>');
  });

  it('converts newlines, escapes stray characters, trims breaks and wraps in <p>', () => {
    assert.equal(sanitizeDescription('\n<br>Line 1\nLine 2 & 3 < 4<br><br>\n'), '<p>Line 1<br>Line 2 &amp; 3 &lt; 4</p>');
    assert.equal(sanitizeDescription('<p>Para</p>'), '<p>Para</p>');
    assert.equal(sanitizeDescription('<b>unclosed'), '<p><b>unclosed</b></p>');
    assert.equal(sanitizeDescription(' '), '');
    assert.equal(sanitizeDescription('<br><br>'), '');
  });

  it('turns stripped block elements into text with breaks', () => {
    assert.equal(
      sanitizeDescription('<h4><span style="font-weight: normal;">Begleitet von der Kirtangruppe</span></h4>'),
      '<p>Begleitet von der Kirtangruppe</p>',
    );
    assert.equal(sanitizeDescription('<div>a</div><div>b</div>'), '<p>a<br>b</p>');
  });

  it('produces plain text for deep links', () => {
    assert.equal(htmlToText('<p>Feier.<br><br><em>Blumen &amp; Spende</em></p>'), 'Feier.\n\nBlumen & Spende');
  });
});

describe('single event ICS', () => {
  it('serialises UTC times, escapes text and folds long lines', () => {
    const ics = occurrenceToIcs({
      id: 'uid@google.com_20260927T083000Z',
      allDay: false,
      startMs: Date.parse('2026-09-27T08:30:00Z'),
      endMs: Date.parse('2026-09-27T10:30:00Z'),
      title: 'Meditation, Lesung; Tee',
      description: `<p>${'Sehr lange Beschreibung '.repeat(6)}</p>`,
      location: 'Frankfurt',
    }, { now: Date.parse('2026-09-25T19:00:00Z') });
    assert.match(ics, /\r\nDTSTART:20260927T083000Z\r\nDTEND:20260927T103000Z\r\n/);
    assert.match(ics, /\r\nSUMMARY:Meditation\\, Lesung\\; Tee\r\n/);
    assert.match(ics, /\r\nLOCATION:Frankfurt\r\n/);
    assert.match(ics, /\r\nUID:uid@google.com_20260927T083000Z\r\n/);
    ics.split('\r\n').forEach((line) => assert.ok(new TextEncoder().encode(line).length <= 75));
  });
});
