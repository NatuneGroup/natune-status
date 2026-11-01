/**
 * Approximate location from Cloudflare's request metadata, read on the server. The client never sends a location, and
 * the IP address itself is never read into storage. Coordinates are rounded to 0.01 degrees, about one kilometre.
 */
export interface Geo {
  readonly country?: string;
  readonly city?: string;
  readonly latitude?: number;
  readonly longitude?: number;
}

/**
 * The subset of `request.cf` this service reads. Declared structurally so the file does not depend on a specific
 * version of @cloudflare/workers-types; every field arrives as a string or is absent.
 */
export interface CfGeoSource {
  readonly country?: string;
  readonly city?: string;
  readonly latitude?: string;
  readonly longitude?: string;
}

const COUNTRY_CODE = /^[A-Z]{2}$/;
const MAX_CITY_LENGTH = 80;

export function readGeo(cf: CfGeoSource | undefined | null): Geo {
  const country = (cf?.country ?? "").trim().toUpperCase();
  const city = cleanCity(cf?.city);
  const latitude = boundedCoordinate(cf?.latitude ?? null, 90);
  const longitude = boundedCoordinate(cf?.longitude ?? null, 180);
  return {
    ...(COUNTRY_CODE.test(country) ? { country } : {}),
    ...(city !== undefined ? { city } : {}),
    ...(latitude !== undefined && longitude !== undefined ? { latitude, longitude } : {}),
  };
}

/** Cloudflare delivers city names already decoded, so only control characters and runaway whitespace are removed. */
function cleanCity(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CITY_LENGTH);
  return cleaned.length > 0 ? cleaned : undefined;
}

function boundedCoordinate(raw: string | null, limit: number): number | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || Math.abs(value) > limit) return undefined;
  return Math.round(value * 100) / 100;
}
