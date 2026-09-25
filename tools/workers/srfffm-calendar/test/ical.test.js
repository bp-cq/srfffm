/* eslint-disable import/no-unresolved */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_MS, decodeIcs, expandCalendar, parseCalendar, parseDuration, parseLine, parseRrule,
  unescapeText, unfoldLines, zonedToInstant,
} from '../src/ical.js';
import { FIXTURE, calendar, vevent } from './helpers.js';

const WEEKLY_UID = '4nej8eu6pd88ndckm9vtj3dpcs@google.com';
const BIWEEKLY_UID = '6pmkcj89s680jd2v4fq30shvh1@google.com';
const at = (iso) => Date.parse(iso);
const window = (fromIso, days) => ({ from: at(fromIso), to: at(fromIso) + days * DAY_MS });
const iso = (ms) => new Date(ms).toISOString();

describe('lexing', () => {
  it('unfolds CRLF and LF continuation lines', () => {
    const lines = unfoldLines('DESCRIPTION:Hello\r\n  World\r\nSUMMARY:A\n\tB\nX:1');
    assert.deepEqual(lines, ['DESCRIPTION:Hello World', 'SUMMARY:AB', 'X:1']);
  });

  it('unfolds at byte level so split UTF-8 characters survive', () => {
    const bytes = new TextEncoder().encode('SUMMARY:Grü\r\n ße\r\n');
    const split = Uint8Array.from([...bytes.slice(0, 11), 0x0d, 0x0a, 0x20, ...bytes.slice(11)]);
    assert.ok(decodeIcs(split).startsWith('SUMMARY:Grüße'));
  });

  it('unescapes ICS text', () => {
    assert.equal(unescapeText('a\\, b\\; c\\nd\\Ne\\\\n'), 'a, b; c\nd\ne\\n');
  });

  it('parses parameters including quoted values with colons', () => {
    const prop = parseLine('DTSTART;TZID="Europe/Berlin";X-A="a:b;c":20260927T103000');
    assert.equal(prop.name, 'DTSTART');
    assert.equal(prop.params.TZID, 'Europe/Berlin');
    assert.equal(prop.params['X-A'], 'a:b;c');
    assert.equal(prop.value, '20260927T103000');
  });

  it('parses durations and rules', () => {
    assert.equal(parseDuration('PT1H30M'), 5400000);
    assert.equal(parseDuration('P1W'), 7 * DAY_MS);
    const rule = parseRrule('FREQ=WEEKLY;WKST=SU;INTERVAL=2;BYDAY=SU,-1MO');
    assert.equal(rule.freq, 'WEEKLY');
    assert.equal(rule.interval, 2);
    assert.equal(rule.wkst, 0);
    assert.deepEqual(rule.byday, [{ n: 0, wd: 0 }, { n: -1, wd: 1 }]);
  });

  it('reads the calendar header and ignores VTIMEZONE rules', () => {
    const cal = parseCalendar(FIXTURE);
    assert.equal(cal.name, 'SRF-Gruppe Frankfurt Rhein-Main');
    assert.equal(cal.timeZone, 'Europe/Berlin');
    assert.ok(cal.events.length > 80);
  });
});

describe('time zones', () => {
  it('converts Berlin wall-clock to instants on both sides of DST', () => {
    assert.equal(iso(zonedToInstant({
      y: 2026, m: 10, d: 21, h: 19,
    }, 'Europe/Berlin')), '2026-10-21T17:00:00.000Z');
    assert.equal(iso(zonedToInstant({
      y: 2026, m: 10, d: 28, h: 19,
    }, 'Europe/Berlin')), '2026-10-28T18:00:00.000Z');
    assert.equal(iso(zonedToInstant({
      y: 2026, m: 3, d: 29, h: 12,
    }, 'Europe/Berlin')), '2026-03-29T10:00:00.000Z');
  });
});

describe('fixture expansion', () => {
  it('keeps the weekly Wednesday series at 19:00 Berlin across the October DST change', () => {
    const { occurrences } = expandCalendar(FIXTURE, window('2026-10-15T00:00:00Z', 20));
    const wednesdays = occurrences.filter((o) => o.uid === WEEKLY_UID).map((o) => iso(o.startMs));
    assert.deepEqual(wednesdays, ['2026-10-21T17:00:00.000Z', '2026-10-28T18:00:00.000Z']);
    const ids = occurrences.filter((o) => o.uid === WEEKLY_UID).map((o) => o.id);
    assert.deepEqual(ids, [`${WEEKLY_UID}_20261021T170000Z`, `${WEEKLY_UID}_20261028T180000Z`]);
  });

  it('expands the INTERVAL=2;WKST=SU Sunday series every other week at 10:30', () => {
    const { occurrences } = expandCalendar(FIXTURE, window('2026-09-26T00:00:00Z', 60));
    const sundays = occurrences.filter((o) => o.uid === BIWEEKLY_UID).map((o) => iso(o.startMs));
    assert.deepEqual(sundays, [
      '2026-10-04T08:30:00.000Z',
      '2026-10-18T08:30:00.000Z',
      '2026-11-01T09:30:00.000Z',
      '2026-11-15T09:30:00.000Z',
    ]);
  });

  it('removes EXDATE occurrences', () => {
    const { occurrences } = expandCalendar(FIXTURE, window('2026-08-20T00:00:00Z', 21));
    const starts = occurrences.map((o) => o.id);
    assert.ok(!starts.includes(`${WEEKLY_UID}_20260826T170000Z`));
    assert.ok(!starts.includes(`${WEEKLY_UID}_20260902T170000Z`));
    assert.ok(!starts.includes(`${BIWEEKLY_UID}_20260823T083000Z`));
    assert.ok(starts.includes(`${WEEKLY_UID}_20260909T170000Z`));
  });

  it('replaces an occurrence with its RECURRENCE-ID override (moved time, new title)', () => {
    const { occurrences } = expandCalendar(FIXTURE, window('2024-07-16T00:00:00Z', 2));
    const series = occurrences.filter((o) => o.uid === WEEKLY_UID);
    assert.equal(series.length, 1);
    assert.equal(series[0].id, `${WEEKLY_UID}_20240717T170000Z`);
    assert.equal(iso(series[0].startMs), '2024-07-17T15:00:00.000Z');
    assert.equal(iso(series[0].endMs), '2024-07-17T18:00:00.000Z');
    assert.equal(series[0].title, 'Meditation mit Bro. Chidananda (Live Stream)');
  });
});

describe('synthetic rules', () => {
  const expandIds = (lines, fromIso, days) => expandCalendar(
    calendar(vevent('UID:x', ...lines)),
    window(fromIso, days),
  ).occurrences.map((o) => o.id.replace('x_', ''));

  it('excludes cancelled events and cancelled occurrences', () => {
    const ics = calendar(
      vevent(...[
        'UID:a', 'DTSTART;TZID=Europe/Berlin:20261007T190000', 'DURATION:PT2H',
        'RRULE:FREQ=WEEKLY;COUNT=3', 'SUMMARY:Series',
      ]),
      vevent(...[
        'UID:a', 'RECURRENCE-ID;TZID=Europe/Berlin:20261014T190000',
        'DTSTART;TZID=Europe/Berlin:20261014T190000', 'STATUS:CANCELLED', 'SUMMARY:Series',
      ]),
      vevent('UID:b', 'DTSTART:20261010T100000Z', 'STATUS:CANCELLED', 'SUMMARY:Gone'),
    );
    const { occurrences } = expandCalendar(ics, window('2026-10-01T00:00:00Z', 60));
    assert.deepEqual(occurrences.map((o) => o.id), ['a_20261007T170000Z', 'a_20261021T170000Z']);
  });

  it('supports MONTHLY with ordinal BYDAY and COUNT', () => {
    assert.deepEqual(
      expandIds(['DTSTART;TZID=Europe/Berlin:20260104T103000', 'RRULE:FREQ=MONTHLY;BYDAY=1SU,-1SU;COUNT=4'], '2026-01-01T00:00:00Z', 365),
      ['20260104T093000Z', '20260125T093000Z', '20260201T093000Z', '20260222T093000Z'],
    );
  });

  it('supports MONTHLY with negative BYMONTHDAY and UNTIL', () => {
    assert.deepEqual(
      expandIds(['DTSTART;VALUE=DATE:20260131', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=-1;UNTIL=20260430'], '2026-01-01T00:00:00Z', 365),
      ['20260131', '20260228', '20260331', '20260430'],
    );
  });

  it('supports YEARLY with BYMONTH and ordinal BYDAY', () => {
    assert.deepEqual(
      expandIds(['DTSTART;TZID=Europe/Berlin:20261025T100000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU'], '2026-01-01T00:00:00Z', 800),
      ['20261025T090000Z', '20271031T090000Z'],
    );
  });

  it('supports DAILY with INTERVAL and UTC UNTIL, EXDATE lists and RDATE', () => {
    assert.deepEqual(
      expandIds([
        'DTSTART;TZID=Europe/Berlin:20261001T080000',
        'RRULE:FREQ=DAILY;INTERVAL=2;UNTIL=20261009T060000Z',
        'EXDATE;TZID=Europe/Berlin:20261003T080000,20261005T080000',
        'RDATE;TZID=Europe/Berlin:20261020T080000',
      ], '2026-09-01T00:00:00Z', 60),
      ['20261001T060000Z', '20261007T060000Z', '20261009T060000Z', '20261020T060000Z'],
    );
  });

  it('treats floating times as Europe/Berlin and uses DURATION', () => {
    const { occurrences } = expandCalendar(
      calendar(vevent('UID:f', 'DTSTART:20261201T180000', 'DURATION:PT90M')),
      window('2026-11-01T00:00:00Z', 60),
    );
    assert.equal(iso(occurrences[0].startMs), '2026-12-01T17:00:00.000Z');
    assert.equal(iso(occurrences[0].endMs), '2026-12-01T18:30:00.000Z');
  });

  it('stops runaway rules without matches', () => {
    const ids = expandIds(['DTSTART;VALUE=DATE:20260101', 'RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30'], '2026-01-01T00:00:00Z', 365);
    assert.deepEqual(ids, ['20260101']); // DTSTART always counts as the first occurrence
  });
});
