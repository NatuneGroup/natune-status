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

export default {
  async fetch(request: IncomingRequest, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    switch (path) {
      case "/api/heartbeat":
        return heartbeat(request, env);
      case "/api/listeners/active":
        return listenersActive(request, env);
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
