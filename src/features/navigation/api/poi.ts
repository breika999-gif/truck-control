import { TOMTOM_API_KEY } from '../../../shared/constants/config';

export type POICategory = 'gas_station' | 'parking' | 'rest_area' | 'truck_stop';

export interface TruckPOI {
  id: string;
  name: string;
  category: POICategory;
  coordinates: [number, number];
  address: string;
  brand?: string;
}

export const POI_META: Record<POICategory, { emoji: string; label: string }> = {
  gas_station: { emoji: '⛽', label: 'Горива' },
  parking:     { emoji: '🅿️', label: 'Паркинг' },
  rest_area:   { emoji: '🛏️', label: 'Почивка' },
  truck_stop:  { emoji: '🚛', label: 'Камион' },
};

// TomTom search query per category
const TT_QUERY: Record<POICategory, string> = {
  gas_station: 'petrol station',
  parking:     'truck parking',
  rest_area:   'rest area',
  truck_stop:  'truck stop',
};

// ── Proximity search via TomTom Fuzzy Search ─────────────────────────────────

/**
 * TomTom Fuzzy Search — nearby category search by proximity point.
 * Docs: https://developer.tomtom.com/search-api/documentation/search-service/fuzzy-search
 */
export async function searchNearbyPOI(
  center: [number, number],
  category: POICategory,
  limit = 6,
): Promise<TruckPOI[]> {
  const [lng, lat] = center;
  const query = TT_QUERY[category];
  const params = new URLSearchParams({
    key:       TOMTOM_API_KEY,
    language:  'bg-BG',
    limit:     String(limit),
    lat:       String(lat),
    lon:       String(lng),
    radius:    '30000',   // 30 km
    typeahead: 'true',
  });

  try {
    const res = await fetch(
      `https://api.tomtom.com/search/2/search/${encodeURIComponent(query)}.json?${params}`,
    );
    if (!res.ok) return [];
    const data = await res.json();

    return (data.results ?? []).map((r: any) => ({
      id:          r.id ?? String(Math.random()),
      name:        (r.poi?.name ?? r.address?.freeformAddress ?? '').trim(),
      category,
      coordinates: [r.position.lon, r.position.lat] as [number, number],
      address:     r.address?.freeformAddress ?? '',
      brand:       r.poi?.brands?.[0]?.name,
    }));
  } catch {
    return [];
  }
}

// ── Search Along Route via TomTom ─────────────────────────────────────────────

/**
 * TomTom Along Route Search — finds POIs within maxDetourMinutes of the route.
 * vehicleType=Truck ensures only truck-accessible stops are returned.
 * Docs: https://developer.tomtom.com/search-api/documentation/search-service/along-route-search
 */
export async function searchAlongRoute(
  routeCoords: [number, number][],
  category: POICategory,
  maxDetourMinutes = 10,
  limit = 8,
): Promise<TruckPOI[]> {
  if (routeCoords.length < 2) return [];

  // Downsample — TomTom accepts up to ~400 points comfortably
  const MAX_PTS = 200;
  const coords =
    routeCoords.length > MAX_PTS
      ? routeCoords.filter((_, i) => i % Math.ceil(routeCoords.length / MAX_PTS) === 0)
      : routeCoords;

  const query  = TT_QUERY[category];
  const params = new URLSearchParams({
    key:           TOMTOM_API_KEY,
    maxDetourTime: String(maxDetourMinutes * 60),
    limit:         String(limit),
    vehicleType:   'Truck',
    language:      'bg-BG',
    spreadingMode: 'auto',
  });

  const body = {
    route: {
      points: coords.map(([pLng, pLat]) => ({ lat: pLat, lon: pLng })),
    },
  };

  try {
    const res = await fetch(
      `https://api.tomtom.com/search/2/alongRouteSearch/${encodeURIComponent(query)}.json?${params}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      },
    );
    if (!res.ok) return [];
    const data = await res.json();

    return (data.results ?? []).map((r: any) => ({
      id:          r.id ?? String(Math.random()),
      name:        (r.poi?.name ?? r.address?.freeformAddress ?? '').trim(),
      category,
      coordinates: [r.position.lon, r.position.lat] as [number, number],
      address:     r.address?.freeformAddress ?? '',
      brand:       r.poi?.brands?.[0]?.name,
    }));
  } catch {
    return [];
  }
}
