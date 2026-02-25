import { MAPBOX_PUBLIC_TOKEN } from '../../../shared/constants/config';

export interface GeoPlace {
  id: string;
  place_name: string;
  center: [number, number]; // [lng, lat]
  text: string;
}

/** Suggestion returned by Search Box API v1 /suggest (no coordinates yet). */
export interface SearchSuggestion {
  name: string;
  mapbox_id: string;
  place_formatted?: string;
  full_address?: string;
  feature_type?: string;
}

// ── Session token ─────────────────────────────────────────────────────────────
// Search Box API requires a stable UUID per user session for billing.
// Rotates after each successful /retrieve call (billing boundary reset).

function uuid4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

let _session = uuid4();

// ── Search Box API v1 ─────────────────────────────────────────────────────────

/**
 * Step 1 — suggest.
 * Returns suggestions WITHOUT coordinates (fast, low-latency).
 * Pass an AbortSignal to cancel on timeout or new keystrokes.
 */
export async function suggestPlaces(
  query: string,
  signal?: AbortSignal,
): Promise<SearchSuggestion[]> {
  if (query.trim().length < 2) return [];
  const params = new URLSearchParams({
    q: query.trim(),
    access_token: MAPBOX_PUBLIC_TOKEN,
    session_token: _session,
    language: 'bg,en',
    limit: '6',
    types: 'place,address,poi,street,locality',
  });
  try {
    const res = await fetch(
      `https://api.mapbox.com/search/searchbox/v1/suggest?${params}`,
      { signal },
    );
    if (!res.ok) return [];
    const data = await res.json() as { suggestions?: SearchSuggestion[] };
    return data.suggestions ?? [];
  } catch {
    return [];
  }
}

/**
 * Step 2 — retrieve.
 * Returns a GeoPlace with exact coordinates for the selected suggestion.
 * Rotates the session token after a successful call.
 */
export async function retrievePlace(mapbox_id: string): Promise<GeoPlace | null> {
  const params = new URLSearchParams({
    access_token: MAPBOX_PUBLIC_TOKEN,
    session_token: _session,
  });
  try {
    const res = await fetch(
      `https://api.mapbox.com/search/searchbox/v1/retrieve/${encodeURIComponent(mapbox_id)}?${params}`,
    );
    if (!res.ok) return null;
    const data = await res.json() as {
      features?: {
        geometry: { coordinates: number[] };
        properties: { name?: string; full_address?: string; place_formatted?: string };
      }[];
    };
    const f = data.features?.[0];
    if (!f) return null;
    _session = uuid4(); // rotate after billing boundary
    return {
      id: mapbox_id,
      text: f.properties.name ?? '',
      place_name: f.properties.full_address ?? f.properties.place_formatted ?? '',
      center: [f.geometry.coordinates[0], f.geometry.coordinates[1]],
    };
  } catch {
    return null;
  }
}

// ── Legacy v5 export (kept for type compatibility) ───────────────────────────
// searchPlaces is no longer used by SearchBar but kept so any import doesn't break.

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
  try {
    const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${q}.json?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.features as GeoPlace[]) ?? [];
  } catch {
    return [];
  }
}
