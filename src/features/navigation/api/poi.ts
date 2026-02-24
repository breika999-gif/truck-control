import { MAPBOX_PUBLIC_TOKEN } from '../../../shared/constants/config';

export type POICategory = 'gas_station' | 'parking' | 'rest_area' | 'ev_charging_station';

export interface TruckPOI {
  id: string;
  name: string;
  category: POICategory;
  coordinates: [number, number];
  address: string;
  brand?: string;
}

export const POI_META: Record<POICategory, { emoji: string; label: string }> = {
  gas_station:         { emoji: '⛽', label: 'Горива' },
  parking:             { emoji: '🅿️', label: 'Паркинг' },
  rest_area:           { emoji: '🛏️', label: 'Почивка' },
  ev_charging_station: { emoji: '⚡', label: 'Зареждане' },
};

interface SearchBoxFeature {
  properties: {
    mapbox_id: string;
    name: string;
    name_preferred?: string;
    full_address?: string;
    place_formatted?: string;
    brand?: string[];
  };
  geometry: {
    coordinates: [number, number];
  };
}

/**
 * Mapbox Search Box API v1 — nearby category search.
 * Docs: https://docs.mapbox.com/api/search/search-box/
 */
export async function searchNearbyPOI(
  center: [number, number],
  category: POICategory,
  limit = 6,
): Promise<TruckPOI[]> {
  const params = new URLSearchParams({
    proximity: `${center[0]},${center[1]}`,
    limit: String(limit),
    language: 'bg,en',
    access_token: MAPBOX_PUBLIC_TOKEN,
  });

  const url =
    `https://api.mapbox.com/search/searchbox/v1/category/${category}?${params}`;

  const res = await fetch(url);
  if (!res.ok) return [];

  const data = await res.json();
  const features: SearchBoxFeature[] = data.features ?? [];

  return features.map((f) => ({
    id: f.properties.mapbox_id,
    name: f.properties.name_preferred ?? f.properties.name,
    category,
    coordinates: f.geometry.coordinates,
    address: f.properties.full_address ?? f.properties.place_formatted ?? '',
    brand: f.properties.brand?.[0],
  }));
}
