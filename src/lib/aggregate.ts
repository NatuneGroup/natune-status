/**
 * Builds the public summary from live entries. A city is shown only with at least [CITY_MINIMUM] listeners, so a
 * single person's location is never published. Listeners below that floor still count toward the total and their
 * country.
 */
export const CITY_MINIMUM = 3;

export interface StoredListener {
  readonly platform?: string;
  readonly country?: string;
  readonly city?: string;
  readonly latitude?: number;
  readonly longitude?: number;
}

export interface CountryCount {
  readonly country: string;
  readonly count: number;
}

export interface CityCount {
  readonly city: string;
  readonly country: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly count: number;
}

export interface ActiveSummary {
  readonly activeListeners: number;
  readonly updatedAt: string;
  readonly ttlSeconds: number;
  readonly countries: CountryCount[];
  readonly cities: CityCount[];
  readonly topCity: CityCount | null;
}

interface CityGroup {
  readonly city: string;
  readonly country: string;
  count: number;
  latitudeSum: number;
  longitudeSum: number;
  located: number;
}

export function summarize(
  listeners: readonly StoredListener[],
  total: number,
  now: Date,
  ttlSeconds: number,
): ActiveSummary {
  const countryCounts = new Map<string, number>();
  const cityGroups = new Map<string, CityGroup>();

  for (const listener of listeners) {
    const country = listener.country;
    if (country) countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);

    const city = listener.city;
    if (!country || !city) continue;
    const key = `${country}\n${city}`;
    const group: CityGroup = cityGroups.get(key) ?? {
      city,
      country,
      count: 0,
      latitudeSum: 0,
      longitudeSum: 0,
      located: 0,
    };
    group.count += 1;
    if (listener.latitude !== undefined && listener.longitude !== undefined) {
      group.latitudeSum += listener.latitude;
      group.longitudeSum += listener.longitude;
      group.located += 1;
    }
    cityGroups.set(key, group);
  }

  const cities: CityCount[] = [];
  for (const group of cityGroups.values()) {
    if (group.count < CITY_MINIMUM || group.located === 0) continue;
    cities.push({
      city: group.city,
      country: group.country,
      latitude: round2(group.latitudeSum / group.located),
      longitude: round2(group.longitudeSum / group.located),
      count: group.count,
    });
  }
  cities.sort(
    (a, b) => b.count - a.count || a.country.localeCompare(b.country) || a.city.localeCompare(b.city),
  );

  const countries: CountryCount[] = [...countryCounts]
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country));

  return {
    activeListeners: total,
    updatedAt: now.toISOString(),
    ttlSeconds,
    countries,
    cities,
    topCity: cities[0] ?? null,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
