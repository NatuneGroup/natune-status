# natune-status

Opt-in live "people listening now" backend for Natune: a Cloudflare Worker API backed by D1, plus a static
live map served by GitHub Pages from `docs/`. Replaces the retired Vercel + Upstash deployment
(`natune-listener-presence.vercel.app`).

The app keeps the feature off until the user turns it on, and contacts this service only while it is on and
music is playing.

## Why this stack

| Requirement | How it is met |
| --- | --- |
| Free | Workers Free plan: 100,000 requests/day, 10 ms CPU/request. D1 Free: 5 M rows read/day, 100,000 rows written/day, 5 GB storage. No card required. |
| Not sharing quota with ArchivePool | Quotas are per account. **Current decision:** deploy on the same account as ArchivePool (its usage is small); move to a separate account if either service nears the 100k/day pool. |
| Server-side geo without paid add-ons | `request.cf` provides country, city and lat/lon on every plan; the IP itself is never stored. |
| TTL storage | Every D1 row carries `expires_at_ms`; reads filter on it and an hourly cron deletes expired rows. |
| A few thousand opted-in users | ~50% of free request/write quota at 5,000 users — see "Capacity". |
| GitHub-maintained | The worker lives in this repo; the dashboard is GitHub Pages and refreshes through a scheduled workflow, so map views never hit the Worker. |

> **ToS note.** Cloudflare does not publish a "one account per person" rule, but its terms bar using extra
> accounts to circumvent limits. The same-account deployment is therefore the unambiguous choice: both
> services share the 100k requests/day pool (the numbers below still leave ~50% headroom at 5k users).
> If a separate account is ever wanted, it is the accepted community practice for genuinely different
> services — but not needed while headroom remains.

## What the service does

- `POST /api/heartbeat` accepts one presence payload and keeps that listener for 2,250 seconds (37.5 min).
- `GET /api/listeners/active` returns the live aggregate: total, countries and cities with at least 3
  listeners, the suppressed-countries sum, and the top city. Sends `Access-Control-Allow-Origin: *`
  so the dashboard may read it live.
- `GET /` returns a small JSON service descriptor.
- `docs/` is the public live map; it reads the committed `docs/status.json` snapshot that
  `.github/workflows/snapshot.yml` refreshes every 15 minutes — zero Worker requests per map view.

There are no accounts, no per-listener lookups and no history endpoints.

## Heartbeat contract

Request: `POST /api/heartbeat` with `Content-Type: application/json` and a body of at most 1024 bytes.
Exactly five fields are accepted:

```json
{"schema":1,"id":"0123456789abcdef0123456789abcdef","platform":"android","app":"1.2.3","state":"playing"}
```

| Field | Rule |
| --- | --- |
| `schema` | must be `1` |
| `id` | 32 lowercase hex characters, random per opt-in |
| `platform` | `android`, `desktop` or `ios` |
| `app` | 1 to 32 characters from `0-9 A-Z a-z . _ + -` |
| `state` | `playing` refreshes the listener; `stopped` removes it at once |

Any other field is rejected. The app sends one `playing` heartbeat on start and then every ~15 minutes
(client adds jitter) while playing, plus a `stopped` message on pause, stop or opt-out.

Responses:

| Status | Meaning |
| --- | --- |
| `204` | accepted (for both `playing` and `stopped`) |
| `400` | invalid body or field |
| `405` | wrong HTTP method |
| `413` | body larger than 1024 bytes |
| `415` | content type is not JSON |
| `429` | a second `playing` heartbeat from the same listener within 20 seconds (`Retry-After: 20`) |
| `503` | service not configured (a binding or variable is missing) |

Coarse geography comes from Cloudflare's request metadata (`request.cf.country` / `.city` / `.latitude` /
`.longitude`). The client never sends a location and the server never writes an IP address.

## Aggregate contract

`GET /api/listeners/active` returns JSON such as:

```json
{
  "activeListeners": 12,
  "updatedAt": "2026-10-26T12:00:00.000Z",
  "ttlSeconds": 2250,
  "countries": [{"country": "DE", "count": 5}],
  "otherCountryListeners": 7,
  "cities": [{"city": "Berlin", "country": "DE", "latitude": 52.52, "longitude": 13.41, "count": 4}],
  "topCity": {"city": "Berlin", "country": "DE", "latitude": 52.52, "longitude": 13.41, "count": 4}
}
```

- A country appears only with at least 3 active listeners; suppressed ones are summed into
  `otherCountryListeners`, never broken out per country.
- A city appears only with at least 3 active listeners that carry coordinates (a located group smaller
  than 3 is never averaged into a published point). Smaller groups still count toward the total and
  their country.
- City coordinates are averages of listener coordinates that were rounded to 0.01 degrees.
- `activeListeners` is the full live count. The breakdown reads at most 10,000 live entries.
- `Cache-Control: public, s-maxage=15` permits a short shared cache; the response contains no
  per-listener data.

## Capacity (10 requests/user/day ≈ start + ~15 min beats over ~2 h of listening + stop)

| Opted-in users | API requests/day | % of 100k | D1 rows written/day* | % of 100k | D1 rows read/day† | % of 5M |
| --- | --- | --- | --- | --- | --- | --- |
| 100 | ~1,000 | 1% | ~1,100 | ~1% | ~50k | 1% |
| 1,000 | ~10,000 | 10% | ~11,100 | ~11% | ~400k | 8% |
| 5,000 | ~50,000 | 50% | ~55,500 | ~56% | ~1.9M | 38% |

\* one written row per `playing` upsert (no index, so no index-write overhead), one `DELETE` per
`stopped`, plus the rows deleted by the hourly sweep (~10% of users assumed to vanish without
`stopped`). † heartbeat conflict-probe reads plus two full-table scans per snapshot fetch (~144/day)
and one per hourly sweep; the table has no secondary index — that is deliberate, because each index
write would count as an extra billed row per beat.
Headroom: the 100k requests/day line binds first, at roughly **9–10k daily opted-in users**. Both quotas
reset at 00:00 UTC; on exhaustion the API returns errors until reset (no billing on the free plan).

## Deploy

Prereqs: Node.js ≥ 20, the Cloudflare account that runs ArchivePool Workers (same-account deployment —
see the ToS note), and this repo pushed to GitHub (suggestion: `NatuneGroup/natune-status`, **public**
so Pages and Actions are free).

```bash
npm install
npx wrangler login                                    # against the chosen account
npx wrangler d1 create natune-status                  # copy the printed database_id into wrangler.toml
npx wrangler d1 migrations apply natune-status --remote
openssl rand -base64 48                               # copy the output for the next step
npx wrangler secret put ID_HASH_SECRET
npx wrangler deploy                                   # → https://natune-status.<account>.workers.dev
```

Then:

1. **Check.** `https://natune-status.<account>.workers.dev/api/listeners/active` returns
   `{"activeListeners":0, …}`; `/` returns the service descriptor.
2. **GitHub repo variable.** Settings → Secrets and variables → Actions → Variables:
   `STATUS_API_URL = https://natune-status.<account>.workers.dev` (no trailing slash).
3. **Pages.** Settings → Pages → set **Source: GitHub Actions** (not "Deploy from a branch" — a
   `GITHUB_TOKEN` push never triggers a branch Pages build, so the workflow publishes `docs/` itself
   via `configure-pages` + `deploy-pages`; configure-pages can also enable Pages automatically on the
   first run). The map goes live at `https://<org>.github.io/natune-status/`.
4. **Snapshot.** Run the `Snapshot listener status` workflow once by hand (Actions → workflow → Run).
   It commits `docs/status.json` and, when the file changed, deploys `docs/` to Pages.
5. **App builds.** Build with `ARCHIVETUNE_LISTENER_PRESENCE_URL=https://natune-status.<account>.workers.dev`
   (no trailing slash). Leave it empty to ship with presence inactive.
6. **Before a public release.** Fill in the operator name in `PRIVACY.md`, review Workers Logs settings on
   the account, decide on a custom domain (`workers.dev` needs no paid add-on anyway).
7. **Optional var.** `DASHBOARD_URL` (`npx wrangler secret put` or `[vars]` in wrangler.toml) is only used
   in the `GET /` descriptor.

### Secrets and variables

| Name | Where | Secret | Purpose |
| --- | --- | --- | --- |
| `ID_HASH_SECRET` | Worker secret (`wrangler secret put`) | yes | Key for the listener-ID HMAC. ≥32 random chars (`openssl rand -base64 48`). Rotating it re-keys the map within ~40 min. |
| `LISTENER_DB` | `wrangler.toml` `[[d1_databases]]` | no | D1 binding; needs `database_id` from `d1 create` |
| `DASHBOARD_URL` | var or secret | no | Reported by `GET /` only |
| `STATUS_API_URL` | GitHub repo **variable** | no | Worker origin used by the snapshot workflow |

### Client cadence

**No released client uses presence yet.** The KMP port is unreleased and batch-12 moves it to a 15-minute
heartbeat with jitter; the original ArchiveTune app gains the feature fresh at the same cadence. This
backend only supports that cadence: its TTL is 2,250 s (2.5× the ~15 min interval), so a client beating
every 60 s against this service would work but is not supported, and a 15-min client pointed at the old
Vercel deployment (TTL 150 s) would disappear from the map between beats — keep TTL and cadence paired.

- KMP: `HEARTBEAT_INTERVAL_MS` in `shared-domain/.../presence/ListenerPresencePolicy.kt` is `900_000`
  with per-iteration jitter (e.g. `delay(intervalMs + Random.nextLong(0, 120_000))` in
  `ListenerPresenceController`) so a fleet of apps does not beat in lockstep.
- Server-side the per-listener rate limit stays at one `playing` beat per 20 s — it is an anti-double-post
  guard, not the cadence.
- Contract is otherwise unchanged: same paths, fields and status codes; only the base URL and cadence
  differ from the Vercel deployment.

## Layout

```
src/worker.ts        routes: /api/heartbeat, /api/listeners/active, /, plus the hourly cron
src/lib/payload.ts   request contract: five fields, ≤1 KB
src/lib/geo.ts       request.cf → coarse geo (city cleaning, 0.01° rounding)
src/lib/store.ts     D1: HMAC'd id, conditional upsert rate limit, TTL sweep
src/lib/aggregate.ts public summary (cities hidden below 3 listeners)
src/lib/http.ts      JSON/empty responses
migrations/          D1 schema (listeners table + expiry index)
docs/                GitHub Pages dashboard (map + committed status.json)
.github/workflows/   snapshot.yml — refreshes docs/status.json every 15 min
```

## Development

```bash
npm install
npm run typecheck
npx wrangler dev          # local worker; D1 is emulated locally
npx wrangler d1 migrations apply natune-status --local   # first run only
```

Copy `dev.vars.example` to `.dev.vars` for local secrets. There are no automated tests yet; `typecheck` is
the only gate.

## License

TODO: pick a license before making the repo public (the sibling app code is GPL-3.0).
