/* eslint-disable import/no-unresolved */
import { readFileSync } from 'node:fs';

/** Full snapshot of the public SRF Frankfurt Google Calendar feed. */
export const FIXTURE = readFileSync(new URL('./fixtures/cal.ics', import.meta.url), 'utf8');

/** Wraps VEVENT blocks into a minimal calendar (CRLF line endings like Google). */
export function calendar(...events) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'X-WR-CALNAME:Test Calendar ',
    'X-WR-TIMEZONE:Europe/Berlin',
    ...events,
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

/** Builds a VEVENT block from content lines. */
export function vevent(...lines) {
  return ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');
}

/** Tiny in-memory stand-in for a Workers KV namespace. */
export function memoryKv(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, String(value));
    },
  };
}
