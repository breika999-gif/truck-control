import { TOMTOM_API_KEY, MAP_CENTER } from '../../../shared/constants/config';

export interface GeoPlace {
  id: string;
  place_name: string;
  center: [number, number]; // [lng, lat]
  text: string;
}

export interface SearchSuggestion {
  name: string;
  mapbox_id: string;          // reused as opaque ID — stores TomTom result id
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

  const encoded = encodeURIComponent(query.trim());
  const params = new URLSearchParams({
    key:       TOMTOM_API_KEY,
    language:  'bg-BG',
    limit:     '6',
    typeahead: 'true',
  });

  // Bias toward current position or Bulgaria center
  const [biasLng, biasLat] = proximity ?? [MAP_CENTER.longitude, MAP_CENTER.latitude];
  params.set('lat', String(biasLat));
  params.set('lon', String(biasLng));
  params.set('radius', '500000');   // 500 km — covers Bulgaria + neighbors

  try {
    const res = await fetch(
      `https://api.tomtom.com/search/2/search/${encoded}.json?${params}`,
      { signal },
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
        mapbox_id:       id,
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
 * Step 2 — retrieve exact coordinates for a suggestion.
 * Resolves from _ttCache (populated in suggestPlaces) — no extra network call.
 */
export async function retrievePlace(mapbox_id: string): Promise<GeoPlace | null> {
  const cached = _ttCache.get(mapbox_id);
  if (cached) {
    return {
      id:         mapbox_id,
      text:       cached.name,
      place_name: cached.address,
      center:     [cached.lon, cached.lat],
    };
  }

  // No cache hit and TomTom has no retrieve-by-id endpoint — cannot recover.
  return null;
}

