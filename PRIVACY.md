# Natune listener presence — operator privacy note

> TODO before a public release: replace `Natune (TODO: legal operator name)` below with the name and
> contact of whoever runs the deployed service.

Natune's listener map is opt-in. This document is the operator-side companion to the in-app disclosure and
summarises exactly what the service at `natune-status.<account>.workers.dev` handles.

## What clients send

While the feature is on and music is playing, the app POSTs `/api/heartbeat` about every 15 minutes
(random jitter added) and once when playback pauses, stops or the feature is switched off:

```json
{"schema":1,"id":"<32 lowercase hex>","platform":"android|desktop|ios","app":"<version>","state":"playing|stopped"}
```

- The `id` is a random 16-byte value generated fresh on every opt-in. It is not an account, device or
  advertising ID, and it is deleted from the device on opt-out.
- No track, playlist, search, account, location or device fields exist in the protocol — the server
  rejects any extra field.

## What the server stores

For each live listener, a single D1 row holds:

| Field | Source | Retention |
| --- | --- | --- |
| `hash` | HMAC-SHA256(listener id, server secret) | until `expires_at_ms` |
| `platform` | request body | same |
| `country`, `city` | `request.cf` (Cloudflare IP geolocation) | same |
| `latitude`, `longitude` | `request.cf`, rounded to 0.01° (~1 km) | same |
| `last_beat_ms`, `expires_at_ms` | server clock | same |

`expires_at_ms` is 2,250 s (37.5 min) after the last heartbeat; the hourly cron and every aggregate read
delete expired rows. There is no history table.

The server never writes the IP address, the raw listener id, the app version string, the user agent or any
playback data. Rotating `ID_HASH_SECRET` invalidates every stored hash; the map repopulates from the next
heartbeat and nothing is lost because nothing is kept.

## Public output

`GET /api/listeners/active` (and the committed `docs/status.json` snapshot served on GitHub Pages) returns
only the total, per-country counts, and per-city counts for cities with at least 3 listeners at rounded
coordinates. Individuals are never identifiable in the output.

## Platform logs

The service writes no logs of its own. Cloudflare platform logging (Workers Logs, if enabled) and GitHub
Actions logs are separate: Cloudflare may transiently process client IPs at the edge per its own
documentation; review the account's logging settings before launch.

## Abuse posture

Rate limiting is per listener id (one `playing` beat per 20 s). Forged ids can mint synthetic rows within
the same TTL window; if that becomes visible, add a Cloudflare WAF rate-limiting rule on
`POST /api/heartbeat` (the Free plan includes one) rather than storing IPs.
