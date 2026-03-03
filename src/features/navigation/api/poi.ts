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

// ── Polyline5 encoder ─────────────────────────────────────────────────────────
// Standard Google Polyline Algorithm — required by Mapbox Search Along Route.

function _encodeValue(curr: number, prev: number): string {
  let v = Math.round(curr * 1e5) - Math.round(prev * 1e5);
  v = v < 0 ? ~(v << 1) : v << 1;
  let s = '';
  while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>>= 5; }
  return s + String.fromCharCode(v + 63);
}

/**
 * Encode GeoJSON [lng, lat] pairs to polyline5 string.
 * Mapbox SAR `route` param expects polyline5 with lat first.
 */
function encodePolyline5(coords: [number, number][]): string {
  let out = '', pLat = 0, pLng = 0;
  for (const [lng, lat] of coords) {  // GeoJSON = [lng,lat]; polyline = lat first
    out += _encodeValue(lat, pLat) + _encodeValue(lng, pLng);
    pLat = lat; pLng = lng;
  }
  return out;
}

// ── Proximity search ──────────────────────────────────────────────────────────

/**
 * Mapbox Search Box API v1 — nearby category search by proximity point.
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

// ── Search Along Route (SAR) ──────────────────────────────────────────────────

/**
 * Mapbox Search Box API v1 — Search Along Route (SAR).
 *
 * Finds POIs within `maxDetourMinutes` of estimated driving time off
 * the given route geometry — far superior to radius search because it
 * covers the entire trip, not just the area around the current position.
 *
 * Docs: https://docs.mapbox.com/api/search/search-box/#category-search
 *   sar_type=isochrone  route=<polyline5>  time_deviation=<minutes>
 *
 * @param routeCoords  GeoJSON [lng, lat] array from Mapbox Directions
 * @param category     POI category canonical ID
 * @param maxDetourMinutes  Max minutes detour allowed (default 10)
 * @param limit        Max results (default 8, API max 25)
 */
export async function searchAlongRoute(
  routeCoords: [number, number][],
  category: POICategory,
  maxDetourMinutes = 10,
  limit = 8,
): Promise<TruckPOI[]> {
  if (routeCoords.length < 2) return [];

  // Downsample very long routes to avoid URL length limits (~1000 points max).
  const MAX_PTS = 500;
  const coords =
    routeCoords.length > MAX_PTS
      ? routeCoords.filter((_, i) => i % Math.ceil(routeCoords.length / MAX_PTS) === 0)
      : routeCoords;

  const encoded = encodePolyline5(coords);

  const params = new URLSearchParams({
    sar_type:       'isochrone',
    route:          encoded,
    route_geometry: 'polyline',
    time_deviation: String(maxDetourMinutes),
    limit:          String(limit),
    language:       'bg,en',
    access_token:   MAPBOX_PUBLIC_TOKEN,
  });

  const url =
    `https://api.mapbox.com/search/searchbox/v1/category/${category}?${params}`;

  const res = await fetch(url);
  if (!res.ok) return [];

  const data = await res.json();
  const features: SearchBoxFeature[] = data.features ?? [];

  return features.map((f) => ({
    id:          f.properties.mapbox_id,
    name:        f.properties.name_preferred ?? f.properties.name,
    category,
    coordinates: f.geometry.coordinates,
    address:     f.properties.full_address ?? f.properties.place_formatted ?? '',
    brand:       f.properties.brand?.[0],
  }));
}
