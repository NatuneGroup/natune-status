/**
 * The heartbeat contract. Only these five fields are accepted, and every other field is rejected, so a client cannot
 * smuggle track, account or location data into the service.
 */
export const SCHEMA_VERSION = 1;
export const MAX_BODY_BYTES = 1024;
export const PLATFORMS = ["android", "desktop", "ios"] as const;

export type Platform = (typeof PLATFORMS)[number];
export type HeartbeatState = "playing" | "stopped";

export interface Heartbeat {
  readonly id: string;
  readonly platform: Platform;
  readonly app: string;
  readonly state: HeartbeatState;
}

export type ParseResult =
  | { readonly ok: true; readonly value: Heartbeat }
  | { readonly ok: false; readonly status: 400 | 413 | 415; readonly error: string };

const ALLOWED_FIELDS: ReadonlySet<string> = new Set(["schema", "id", "platform", "app", "state"]);
const LISTENER_ID = /^[a-f0-9]{32}$/;
const APP_VERSION = /^[0-9A-Za-z._+-]{1,32}$/;

function reject(status: 400 | 413 | 415, error: string): ParseResult {
  return { ok: false, status, error };
}

export async function parseHeartbeat(request: Request): Promise<ParseResult> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return reject(415, "Expected application/json");
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return reject(413, "Body too large");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return reject(413, "Body too large");
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return reject(400, "Invalid JSON");
  }
  return validateHeartbeat(body);
}

export function validateHeartbeat(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return reject(400, "Body must be a JSON object");
  }
  const record = body as Record<string, unknown>;
  for (const field of Object.keys(record)) {
    if (!ALLOWED_FIELDS.has(field)) return reject(400, "Unknown field");
  }
  if (record.schema !== SCHEMA_VERSION) return reject(400, "Unsupported schema");

  const { id, platform, app, state } = record;
  if (typeof id !== "string" || !LISTENER_ID.test(id)) return reject(400, "Invalid id");
  if (typeof platform !== "string" || !(PLATFORMS as readonly string[]).includes(platform)) {
    return reject(400, "Invalid platform");
  }
  if (typeof app !== "string" || !APP_VERSION.test(app)) return reject(400, "Invalid app version");
  if (state !== "playing" && state !== "stopped") return reject(400, "Invalid state");

  return {
    ok: true,
    value: { id, platform: platform as Platform, app, state: state as HeartbeatState },
  };
}
