import { APP_INTERNAL_TOKEN, BACKEND_URL } from '../../../shared/constants/config';

export type POICategory = 'gas_station' | 'parking' | 'rest_area' | 'truck_stop';

export interface TruckPOI {
  id: string;
  name: string;
  category: POICategory;
  coordinates: [number, number];
  address: string;
  brand?: string;
  detourTime?: number; // detour time in seconds
  travelTime?: number; // travel time from current location in seconds
}

export const POI_META: Record<POICategory, { emoji: string; label: string; iconName: string }> = {
  gas_station: { emoji: '⛽', label: 'Горива',   iconName: 'gas-station' },
  parking:     { emoji: '🅿️', label: 'Паркинг',  iconName: 'parking' },
  rest_area:   { emoji: '🛏️', label: 'Почивка',  iconName: 'bed' },
  truck_stop:  { emoji: '🚛', label: 'Камион',   iconName: 'truck' },
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
    query,
    limit:     String(limit),
    lat:       String(lat),
    lon:       String(lng),
    radius:    '30000',   // 30 km
    typeahead: 'true',
  });

  try {
    const res = await fetch(
      `${BACKEND_URL}/api/geocode?${params}`,
      { headers: { 'X-App-Token': APP_INTERNAL_TOKEN } },
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
      detourTime:  r.detourTime,
      travelTime:  r.travelTime,
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

  const body = {
    route: {
      points: coords.map(([pLng, pLat]) => ({ lat: pLat, lon: pLng })),
    },
  };

  try {
    const res = await fetch(
      `${BACKEND_URL}/api/poi/search-along-route`,
      {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-App-Token': APP_INTERNAL_TOKEN,
        },
        body: JSON.stringify({
          ...body,
          query,
          maxDetourTime: maxDetourMinutes * 60,
          limit,
        }),
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
      detourTime:  r.detourTime,
      travelTime:  r.travelTime,
    }));
  } catch {
    return [];
  }
}
