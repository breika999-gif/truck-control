import { BACKEND_URL, APP_INTERNAL_TOKEN } from '../../../shared/constants/config';
import { getBackendAuthHeaders } from '../../../shared/services/backendApi';

async function _geoAuthHeaders(): Promise<Record<string, string>> {
  try {
    return await getBackendAuthHeaders();
  } catch {
    return APP_INTERNAL_TOKEN ? { 'X-App-Token': APP_INTERNAL_TOKEN } : {};
  }
}

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

export const POI_META: Record<POICategory, { emoji: string; labelKey: string; iconName: string }> = {
  gas_station: { emoji: '⛽', labelKey: 'poiCategories.gas_station', iconName: 'gas-station' },
  parking:     { emoji: '🅿️', labelKey: 'poiCategories.parking',     iconName: 'parking' },
  rest_area:   { emoji: '🛏️', labelKey: 'poiCategories.rest_area',   iconName: 'bed' },
  truck_stop:  { emoji: '🚛', labelKey: 'poiCategories.truck_stop',  iconName: 'truck' },
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
    const authHeaders = await _geoAuthHeaders();
    const res = await fetch(
      `${BACKEND_URL}/api/geocode?${params}`,
      { headers: authHeaders },
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
