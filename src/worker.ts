import { summarize } from "./lib/aggregate";
import type { StoredListener } from "./lib/aggregate";
import { readGeo } from "./lib/geo";
import { empty, json } from "./lib/http";
import { parseHeartbeat } from "./lib/payload";
import {
  idHashSecret,
  keyedListenerHash,
  pruneExpired,
  readActive,
  recordPlaying,
  recordStopped,
  TTL_SECONDS,
} from "./lib/store";

export interface Env {
  /** D1 database binding from wrangler.toml. */
  readonly LISTENER_DB?: D1Database;
  /** `wrangler secret put ID_HASH_SECRET` — at least 32 characters. */
  readonly ID_HASH_SECRET?: string;
  /** Optional dashboard address reported by GET /. */
  readonly DASHBOARD_URL?: string;
}

/** The incoming request type whose `cf` carries Cloudflare geolocation fields. */
type IncomingRequest = Request<unknown, IncomingRequestCfProperties<unknown>>;


/** The live-map badge mark: Natune record-and-seedling with a green status dot. Served inline so the
 * worker answers favicon requests instead of returning the 404 JSON body. */
const STATUS_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-labelledby="title">
  <title id="title">Natune status icon</title>
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#0B4D2C" />
      <stop offset="1" stop-color="#13894A" />
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#background)" />
  <circle cx="256" cy="280" r="140" fill="#F7F3EA" />
  <g fill="none" stroke="#0B4D2C" stroke-linecap="round" stroke-width="4.5">
    <path d="M192.754 190 A110 110 0 0 0 192.754 370" />
    <path d="M319.246 190 A110 110 0 0 1 319.246 370" />
    <path d="M209.57 210 A84 84 0 0 0 209.57 350" />
    <path d="M302.43 210 A84 84 0 0 1 302.43 350" />
    <path d="M219.41 235 A58 58 0 0 0 219.41 325" />
    <path d="M292.59 235 A58 58 0 0 1 292.59 325" />
  </g>
  <path d="M256 281 L256 226" fill="none" stroke="#0B4D2C" stroke-linecap="round" stroke-width="8" />
  <path
    d="M256 226 C238 222 220 214 204 201 C174 177 158 147 154 116 C186 114 213 122 233 138 C256 157 268 183 267 208 C267 216 263 222 256 226 Z"
    fill="#A8E6A1"
  />
  <path
    d="M256 226 C270 220 284 210 297 197 C321 172 341 143 358 116 C328 111 301 116 279 129 C257 143 244 166 244 190 C244 205 248 218 256 226 Z"
    fill="#6CCB5F"
  />
  <g fill="none" stroke="#0B4D2C" stroke-linecap="round" stroke-width="4">
    <path d="M256 220 C231 200 207 178 176 136" />
    <path d="M256 220 C283 203 313 175 339 136" />
  </g>
  <circle cx="256" cy="280" r="20" fill="#0B4D2C" />
  <!-- Status badge: bright live dot with a cream ring matching the record
       disc, anchored on the bottom-right corner so it reads at 16px. -->
  <circle cx="400" cy="400" r="84" fill="#F7F3EA" />
  <circle cx="400" cy="400" r="60" fill="#22C55E" />
</svg>
`;

export default {
  async fetch(request: IncomingRequest, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    switch (path) {
      case "/api/heartbeat":
        return heartbeat(request, env);
      case "/api/listeners/active":
        return listenersActive(request, env);
      case "/favicon.svg":
      case "/icon.svg":
        return new Response(STATUS_ICON_SVG, {
          headers: {
            "content-type": "image/svg+xml; charset=utf-8",
            "cache-control": "public, max-age=86400",
          },
        });
      case "/favicon.ico":
        // Every current browser follows a 302 for favicon fetches; keeps an ICO encoder out of the worker.
        return new Response(null, { status: 302, headers: { location: "/favicon.svg" } });
      case "/":
      case "":
        return root(request, env);
      default:
        return json({ error: "Not found" }, 404);
    }
  },

  // The hourly cron deletes rows whose TTL passed while no aggregate read ran, so the table never accumulates
  // stale entries. Scheduled invocations count neither against the daily request limit nor D1 billing beyond the
  // few rows they delete.
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    if (env.LISTENER_DB === undefined) return;
    await pruneExpired(env.LISTENER_DB, Date.now());
  },
} satisfies ExportedHandler<Env>;

function root(request: IncomingRequest, env: Env): Response {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "Method not allowed" }, 405, { allow: "GET" });
  }
  return json(
    {
      service: "natune-status",
      description: "Opt-in listener presence API for Natune. No accounts, no history.",
      dashboard: env.DASHBOARD_URL ?? null,
      endpoints: ["POST /api/heartbeat", "GET /api/listeners/active"],
    },
    200,
  );
}

async function heartbeat(request: IncomingRequest, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, { allow: "POST" });
  }

  const secret = idHashSecret(env.ID_HASH_SECRET);
  const db = env.LISTENER_DB;
  if (secret === null || db === undefined) {
    // An unconfigured deployment refuses writes rather than store listeners without a keyed hash.
    return json({ error: "Listener presence is not configured" }, 503);
  }

  const parsed = await parseHeartbeat(request);
  if (!parsed.ok) {
    return json({ error: parsed.error }, parsed.status);
  }
  const beat = parsed.value;
  const hash = await keyedListenerHash(beat.id, secret);

  if (beat.state === "stopped") {
    await recordStopped(db, hash);
    return empty(204);
  }

  // Only the platform and coarse geography from Cloudflare's request metadata are kept. The raw ID, the IP address
  // and the app version are never written to storage.
  const record: StoredListener = { platform: beat.platform, ...readGeo(request.cf) };
  const accepted = await recordPlaying(db, hash, record, Date.now());
  if (!accepted) {
    return json({ error: "Too many heartbeats" }, 429, { "retry-after": "20" });
  }
  return empty(204);
}

async function listenersActive(request: IncomingRequest, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "Method not allowed" }, 405, { allow: "GET" });
  }

  const db = env.LISTENER_DB;
  if (db === undefined) {
    return json({ error: "Listener presence is not configured" }, 503);
  }

  const now = new Date();
  const { total, listeners } = await readActive(db, now.getTime());
  // The aggregate holds no per-listener data, so a short shared-cache lifetime is safe and keeps polling cheap. The
  // permissive CORS header lets the static dashboard read this endpoint directly if a live view is ever wanted.
  return json(summarize(listeners, total, now, TTL_SECONDS), 200, {
    "cache-control": "public, s-maxage=15, stale-while-revalidate=30",
    "access-control-allow-origin": "*",
  });
}
