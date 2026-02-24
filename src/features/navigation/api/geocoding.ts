import { MAPBOX_PUBLIC_TOKEN } from '../../../shared/constants/config';

export interface GeoPlace {
  id: string;
  place_name: string;
  center: [number, number]; // [lng, lat]
  text: string;
}

/**
 * Forward geocoding with autocomplete using Mapbox Geocoding v5.
 * Docs: https://docs.mapbox.com/api/search/geocoding-v5/
 * Returns up to 5 suggestions ranked by relevance.
 */
export async function searchPlaces(query: string): Promise<GeoPlace[]> {
  if (query.trim().length < 2) return [];
  const q = encodeURIComponent(query.trim());
  const params = new URLSearchParams({
    access_token: MAPBOX_PUBLIC_TOKEN,
    autocomplete: 'true',
    language: 'bg,en',
    limit: '5',
    types: 'address,place,poi,locality,region',
  });
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${q}.json?${params}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.features as GeoPlace[]) ?? [];
}
