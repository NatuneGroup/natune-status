import type { StoredListener } from "./aggregate";

/** A listener drops off the map this long after its last playing heartbeat (2.5 times the 15 minute interval). */
export const TTL_SECONDS = 2250;
/** One playing heartbeat per listener within this window. A normal client sends one per 15 minutes. */
export const RATE_LIMIT_MS = 20_000;
/** Upper bound on live entries read in one summary, so a flood cannot make a single response unbounded. */
export const READ_LIMIT = 10000;

const encoder = new TextEncoder();

/** The server-side secret for keyed listener hashes. Anything shorter than 32 characters counts as unconfigured. */
export function idHashSecret(secret: string | undefined): string | null {
  return secret !== undefined && secret.length >= 32 ? secret : null;
}

/** HMAC-SHA256 of the client identifier. Only this keyed hash is ever stored; a database dump reveals no raw ID. */
export async function keyedListenerHash(listenerId: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(listenerId));
  return Array.from(new Uint8Array(mac), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Records a playing heartbeat in one statement. On a repeated listener the UPDATE runs only when the previous beat is
 * older than the rate-limit window; the returned false then maps to HTTP 429. D1 binds do not accept undefined, so
 * absent fields become empty strings or NULL.
 */
export async function recordPlaying(
  db: D1Database,
  hash: string,
  record: StoredListener,
  nowMs: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO listeners (hash, platform, country, city, latitude, longitude, last_beat_ms, expires_at_ms)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT (hash) DO UPDATE SET
         platform = excluded.platform,
         country = excluded.country,
         city = excluded.city,
         latitude = excluded.latitude,
         longitude = excluded.longitude,
         last_beat_ms = excluded.last_beat_ms,
         expires_at_ms = excluded.expires_at_ms
       WHERE listeners.last_beat_ms <= excluded.last_beat_ms - ?9`,
    )
    .bind(
      hash,
      record.platform ?? "",
      record.country ?? "",
      record.city ?? "",
      record.latitude ?? null,
      record.longitude ?? null,
      nowMs,
      nowMs + TTL_SECONDS * 1000,
      RATE_LIMIT_MS,
    )
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** Removes a listener at once on pause, stop or opt-out, so a quick resume is accepted as a fresh insert. */
export async function recordStopped(db: D1Database, hash: string): Promise<void> {
  await db.prepare("DELETE FROM listeners WHERE hash = ?1").bind(hash).run();
}

/**
 * Deletes rows whose TTL has passed. Called once an hour from the scheduled trigger only; reads never prune
 * because every aggregate filter already excludes expired rows. The DELETE is a full table scan — there is
 * deliberately no expiry index, since each index write would count as a second billed row per heartbeat.
 */
export async function pruneExpired(db: D1Database, nowMs: number): Promise<void> {
  await db.prepare("DELETE FROM listeners WHERE expires_at_ms <= ?1").bind(nowMs).run();
}

interface ListenerRow {
  readonly platform: string;
  readonly country: string;
  readonly city: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
}

/** The live count plus the entries read for the public breakdown, which is capped at READ_LIMIT. */
export interface ActiveRead {
  readonly total: number;
  readonly listeners: StoredListener[];
}

/**
 * Live entries whose TTL has not passed. The total is counted before the cap, so the headline number stays exact even
 * when the breakdown is a sample. Both queries are full table scans; at the expected size (thousands of rows)
 * they stay far under the daily rows-read quota.
 */
export async function readActive(db: D1Database, nowMs: number): Promise<ActiveRead> {
  const countRow = await db
    .prepare("SELECT COUNT(*) AS total FROM listeners WHERE expires_at_ms > ?1")
    .bind(nowMs)
    .first<{ total: number }>();
  const total = countRow?.total ?? 0;
  if (total === 0) return { total: 0, listeners: [] };
  const { results } = await db
    .prepare(
      "SELECT platform, country, city, latitude, longitude FROM listeners " +
        "WHERE expires_at_ms > ?1 ORDER BY expires_at_ms DESC LIMIT ?2",
    )
    .bind(nowMs, READ_LIMIT)
    .all<ListenerRow>();
  const listeners: StoredListener[] = (results ?? []).map((row) => ({
    ...(row.platform ? { platform: row.platform } : {}),
    ...(row.country ? { country: row.country } : {}),
    ...(row.city ? { city: row.city } : {}),
    ...(row.latitude !== null && row.longitude !== null
      ? { latitude: row.latitude, longitude: row.longitude }
      : {}),
  }));
  return { total, listeners };
}
