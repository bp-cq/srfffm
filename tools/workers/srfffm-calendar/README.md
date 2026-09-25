# srfffm-calendar

Cloudflare Worker that reads the public Google Calendar ICS feed of SRF Frankfurt and returns
the upcoming entries as JSON (recurring events expanded, all times in `Europe/Berlin`). AEM
json2html fetches this JSON at preview time and renders it with a Mustache template. A Cron
Trigger (every 15 minutes) detects when the rendered feed changed and then previews and
publishes the events pages in AEM.

No runtime dependencies. Code: `src/ical.js` (parsing, recurrence), `src/format.js`
(localisation, links, HTML sanitising), `src/index.js` (routes, cron).

## Endpoints

| Route | Response |
| --- | --- |
| `GET /events?lang=de\|en` (also `/events.json`) | Feed JSON (default `de`). `cache-control: public, max-age=300`, CORS `*`. 502 `{error}` if the ICS feed fails. |
| `GET /event.ics?id=<id>` | Single-event `text/calendar` download (for Apple Calendar). 404 if unknown. |
| `GET /status` | What the cron stored in KV: `feedHash`, `lastChange`, `lastRun`, plus `configured` flags. No secrets. |
| `OPTIONS *` | CORS preflight, 204. Everything else: 404 JSON. |

## JSON contract (`/events`)

```json
{
  "lang": "de",
  "title": "Veranstaltungen",
  "pageTitle": "VERANSTALTUNGEN | srf-frankfurt",
  "calendar": "SRF-Gruppe Frankfurt Rhein-Main",
  "timeZone": "Europe/Berlin",
  "hasEvents": true,
  "noEvents": "Derzeit sind keine Veranstaltungen geplant.",
  "events": [
    {
      "id": "4tjpr05h3es1aq84ikuijb86jf@google.com_20260927T083000Z",
      "title": "Mahasamadi Lahiri Mahasaya",
      "description": "<p>Sanitised HTML</p>",
      "location": "",
      "start": "2026-09-27T10:30:00+02:00",
      "end": "2026-09-27T12:30:00+02:00",
      "allDay": false,
      "day": "27",
      "month": "September",
      "weekday": "Sonntag",
      "year": "2026",
      "time": "10:30 - 12:30",
      "monthStart": false,
      "google": "https://calendar.google.com/calendar/render?action=TEMPLATE&...",
      "outlook": "https://outlook.live.com/calendar/0/deeplink/compose?...",
      "yahoo": "https://calendar.yahoo.com/?v=60&...",
      "ics": "https://srfffm-calendar.benpeter.workers.dev/event.ics?id=..."
    }
  ]
}
```

- `en`: `title` "Services", `pageTitle` "SERVICES | srf-frankfurt", `noEvents` "There are currently no scheduled events.", `time`
  "10:30 am - 12:30 pm".
- All-day: `start`/`end` are dates (`end` exclusive, as in ICS), `time` is "Ganztägig" / "All day"
  or "10.08. - 05.09." / "Aug 10 - Sep 5" for multi-day entries. Timed entries spanning days:
  "27.09. 10:30 - 28.09. 12:00" / "Sep 27, 10:30 am - Sep 28, 12:00 pm".
- `id` = `${UID}_${original start}` (UTC basic format, or `YYYYMMDD` for all-day). Moved
  instances keep the id of their original slot.
- `monthStart` is true when the month differs from the previous entry (false for the first).
- `description` only contains `br p em i strong b u a[href] ul ol li` (links: http/https/mailto,
  `rel="noopener"`), wrapped in `<p>` if it has no block element; `""` when empty.
- Selection: ends after now, starts within 365 days, sorted by start, max 150, cancelled
  entries excluded.

## Configuration

`wrangler.toml` `[vars]`:

| Var | Value |
| --- | --- |
| `ICS_URL` | Public Google Calendar ICS URL |
| `PUBLIC_URL` | Public base URL of this worker (used for the `ics` links): `https://srfffm-calendar.benpeter.workers.dev`. |
| `AEM_ORG`, `AEM_SITE`, `AEM_REF` | `bp-cq`, `srfffm`, `main` |
| `PAGES` | Comma-separated pages to republish: `/de/services,/en/services` |

The owner must create:

1. KV namespace (stores `feed-hash`, `last-change`, `last-run`):
   `npx wrangler kv namespace create CALENDAR_STATE`, then paste the returned id into
   `[[kv_namespaces]]` in `wrangler.toml` (replace `REPLACE_WITH_KV_NAMESPACE_ID`).
2. Secret `AEM_ADMIN_API_KEY`: `npx wrangler secret put AEM_ADMIN_API_KEY`.

### Creating the AEM admin API key

Authenticated as a site admin (for example with the `x-auth-token` / cookie from
admin.hlx.page login):

```sh
curl -X POST https://admin.hlx.page/config/bp-cq/sites/srfffm/apiKeys.json \
  -H 'content-type: application/json' \
  -H "x-auth-token: $ADMIN_TOKEN" \
  -d '{"description":"srfffm-calendar worker","roles":["publish"]}'
```

The `value` field of the response is the token. Store it with `wrangler secret put`.
The worker sends it as `Authorization: token <value>`.

API keys expire (the response contains `expiration`); create a new key and update the secret
before that date, otherwise the cron runs fail.

## AEM setup (json2html and content overlay)

The events pages `/de/services` and `/en/services` exist only via json2html; there is no
Document Authoring document for them. The intro text above the list is the DA document
`/<lang>/fragments/events-intro`, which the template pulls in as a fragment.

1. json2html config (needs an AEM admin token of a site admin):

   ```sh
   curl -X POST https://json2html.adobeaem.workers.dev/config/bp-cq/srfffm/main \
     -H "Authorization: token $ADMIN_TOKEN" \
     -H 'Content-Type: application/json' \
     -d '[
       {"path": "/de/services", "endpoint": "https://srfffm-calendar.benpeter.workers.dev/events?lang=de", "template": "/templates/events.html"},
       {"path": "/en/services", "endpoint": "https://srfffm-calendar.benpeter.workers.dev/events?lang=en", "template": "/templates/events.html"}
     ]'
   ```

2. Content source overlay (only after step 1: without a json2html config the overlay answers
   every path with HTTP 500, which would break previews of all pages). First check that a
   regular page now gets a 404 from json2html (so previews fall back to Document Authoring) and
   the events page a 200:

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' https://json2html.adobeaem.workers.dev/bp-cq/srfffm/main/de/about     # 404
   curl -s -o /dev/null -w '%{http_code}\n' https://json2html.adobeaem.workers.dev/bp-cq/srfffm/main/de/services  # 200
   ```

   Then:

   ```sh
   curl -X POST https://admin.hlx.page/config/bp-cq/sites/srfffm/content.json \
     -H "x-auth-token: $ADMIN_TOKEN" \
     -H 'Content-Type: application/json' \
     -d '{
       "source": {"type": "markup", "url": "https://content.da.live/bp-cq/srfffm"},
       "overlay": {"type": "markup", "url": "https://json2html.adobeaem.workers.dev/bp-cq/srfffm/main"}
     }'
   ```

3. Preview and publish `/de/services` and `/en/services` once (or wait for the first cron run,
   which publishes them because no feed hash is stored yet).

If the worker URL ever changes, update `PUBLIC_URL` in `wrangler.toml` and the two `endpoint` values.

## Cron behaviour

Every 15 minutes: build the `de` and `en` feeds, SHA-256 over both `events` arrays, compare with
KV `feed-hash`. If unchanged, only `last-run` is written. If changed, for each page:
`POST https://admin.hlx.page/preview/bp-cq/srfffm/main<path>` and, if that succeeded,
`POST .../live/...`. The new hash is stored only if every call returned 2xx, so failures retry
on the next run. A failing ICS fetch or a missing secret/KV binding throws (cron shows failed).
Entries that end also change the hash, so past entries drop off the published pages.

## Develop, test, deploy

```sh
cd tools/workers/srfffm-calendar
node --test test/                    # unit tests (Node 24, no install needed)
npx wrangler dev                     # http://localhost:8787/events?lang=en
npx wrangler dev --test-scheduled    # then trigger the cron:
curl "http://localhost:8787/__scheduled?cron=*/15+*+*+*+*"
npx wrangler deploy
```

For local cron runs put `AEM_ADMIN_API_KEY=...` into `.dev.vars` (git-ignored); without it the
scheduled handler throws by design. Logs (status codes of every admin call): `npx wrangler tail`.
