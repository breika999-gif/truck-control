import { APP_INTERNAL_TOKEN, MAP_CENTER, BACKEND_URL } from '../../../shared/constants/config';
import { getBackendAuthHeaders } from '../../../shared/services/backendApi';

export interface GeoPlace {
  id: string;
  place_name: string;
  center: [number, number]; // [lng, lat]
  text: string;
}

export interface SearchSuggestion {
  name: string;
  place_id: string;          // opaque ID — stores TomTom/Google result id
  place_formatted?: string;
  full_address?: string;
  feature_type?: string;
}

// ── In-memory cache: TomTom result id → coordinates + display text ───────────
// Populated during suggestPlaces so retrievePlace can resolve without extra call.
const _ttCache = new Map<string, { lat: number; lon: number; name: string; address: string }>();

// ── TomTom Fuzzy Search ───────────────────────────────────────────────────────

/**
 * Step 1 — suggest via TomTom Fuzzy Search.
 * Returns suggestions with coordinates already cached in _ttCache.
 * Biased toward Bulgaria by default; uses user position when available.
 */
export async function suggestPlaces(
  query: string,
  signal?: AbortSignal,
  proximity?: [number, number],  // [lng, lat]
): Promise<SearchSuggestion[]> {
  if (query.trim().length < 2) return [];

  const params = new URLSearchParams({
    query:     query.trim(),
    limit:     '6',
    typeahead: 'true',
  });

  // Bias toward current position if available (no radius limit — worldwide search)
  if (proximity) {
    params.set('lat', String(proximity[1]));
    params.set('lon', String(proximity[0]));
  }

  try {
    const res = await fetch(
      `${BACKEND_URL}/api/geocode?${params}`,
      { signal, headers: { 'X-App-Token': APP_INTERNAL_TOKEN } },
    );
    if (!res.ok) return [];
    const data = await res.json();

    return (data.results ?? []).map((r: any) => {
      const id      = r.id ?? String(Math.random());
      const name    = (r.poi?.name ?? r.address?.freeformAddress ?? '').trim();
      const address = r.address?.freeformAddress ?? '';
      // Cache coordinates for retrievePlace
      if (r.position?.lat != null) {
        _ttCache.set(id, { lat: r.position.lat, lon: r.position.lon, name, address });
      }
      return {
        name,
        place_id:        id,
        place_formatted: address,
        full_address:    address,
        feature_type:    r.type,
      } as SearchSuggestion;
    });
  } catch {
    return [];
  }
}

/**
 * Google Places fallback — called only when TomTom returns 0 results.
 * Results are tagged with source='google' so the UI can show a subtle badge.
 */
export async function suggestPlacesGoogle(
  query: string,
  signal?: AbortSignal,
  proximity?: [number, number],
): Promise<SearchSuggestion[]> {
  if (query.trim().length < 2) return [];

  const [lng, lat] = proximity ?? [MAP_CENTER.longitude, MAP_CENTER.latitude];
  const params = new URLSearchParams({ q: query.trim(), lat: String(lat), lng: String(lng) });

  try {
    const authHeaders = await getBackendAuthHeaders();
    const res = await fetch(`${BACKEND_URL}/api/places/search?${params}`, {
      signal,
      headers: authHeaders,
    });
    if (!res.ok) return [];
    const data = await res.json();

    return (data.results ?? []).map((r: any) => {
      const id = `google_${r.lat}_${r.lng}_${encodeURIComponent((r.name ?? '').slice(0, 20))}`;
      // Cache for retrievePlace
      _ttCache.set(id, { lat: r.lat, lon: r.lng, name: r.name ?? '', address: r.address ?? '' });
      return {
        name:            r.name ?? '',
        place_id:        id,
        place_formatted: r.address,
        full_address:    r.address,
        feature_type:    'google',
      } as SearchSuggestion;
    });
  } catch {
    return [];
  }
}


/**
 * Step 2 — retrieve exact coordinates for a suggestion.
 * Primary: resolves from _ttCache (populated in suggestPlaces).
 * Fallback A: Google IDs encode lat/lng in the id string — parsed directly.
 * Fallback B: TomTom entity details API call.
 */
export async function retrievePlace(place_id: string): Promise<GeoPlace | null> {
  const cached = _ttCache.get(place_id);
  if (cached) {
    return {
      id:         place_id,
      text:       cached.name,
      place_name: cached.address,
      center:     [cached.lon, cached.lat],
    };
  }

  // Fallback A: Google IDs are formatted as "google_{lat}_{lng}_{random}"
  if (place_id.startsWith('google_')) {
    const parts = place_id.split('_');
    const lat = parseFloat(parts[1]);
    const lon = parseFloat(parts[2]);
    if (!isNaN(lat) && !isNaN(lon)) {
      return { id: place_id, text: '', place_name: '', center: [lon, lat] };
    }
  }

  // Fallback B: TomTom entity details by ID
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/geocode/place?entity_id=${encodeURIComponent(place_id)}`,
      { headers: { 'X-App-Token': APP_INTERNAL_TOKEN } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const r = data.results?.[0];
    if (!r?.position) return null;
    const name    = (r.poi?.name ?? r.address?.freeformAddress ?? '').trim();
    const address = r.address?.freeformAddress ?? '';
    _ttCache.set(place_id, { lat: r.position.lat, lon: r.position.lon, name, address });
    return {
      id:         place_id,
      text:       name,
      place_name: address,
      center:     [r.position.lon, r.position.lat],
    };
  } catch {
    return null;
  }
}

