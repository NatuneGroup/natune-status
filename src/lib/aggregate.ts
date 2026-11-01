/**
 * Builds the public summary from live entries. A country is shown only with at least [COUNTRY_MINIMUM]
 * listeners and a city only with at least [CITY_MINIMUM] listeners carrying coordinates, so a single
 * person's location is never published and no coordinate average is computed over fewer than three
 * sources. Suppressed listeners still count toward the total and, for countries, toward
 * [ActiveSummary.otherCountryListeners].
 */
export const CITY_MINIMUM = 3;
export const COUNTRY_MINIMUM = 3;

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
  /** Listeners in countries below [COUNTRY_MINIMUM]; reported in sum, never per country. */
  readonly otherCountryListeners: number;
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
    // Coordinates are averaged, so a city is published only when at least CITY_MINIMUM listeners
    // contributed a coordinate; one or two located listeners never leak their position.
    if (group.located < CITY_MINIMUM) continue;
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

  let otherCountryListeners = 0;
  const countries: CountryCount[] = [];
  for (const [country, count] of countryCounts) {
    if (count < COUNTRY_MINIMUM) {
      otherCountryListeners += count;
    } else {
      countries.push({ country, count });
    }
  }
  countries.sort((a, b) => b.count - a.count || a.country.localeCompare(b.country));

  return {
    activeListeners: total,
    updatedAt: now.toISOString(),
    ttlSeconds,
    countries,
    otherCountryListeners,
    cities,
    topCity: cities[0] ?? null,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
