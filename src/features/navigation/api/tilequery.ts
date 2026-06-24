/**
 * Mapbox Tilequery API helpers.
 * Docs: https://docs.mapbox.com/api/maps/tilequery/
 *
 * Endpoint: GET /v4/{tileset_id}/tilequery/{lng},{lat}.json
 *   ?radius=  max metres to search (max 100 000)
 *   ?limit=   max features (max 50)
 *   ?layers=  comma-separated source-layer filter
 *   ?geometry= point | linestring | polygon
 *
 * All functions are non-fatal — return null / [] on any error.
 * Callers are responsible for throttling (don't spam the API).
 */

import { BACKEND_URL, MAPBOX_PUBLIC_TOKEN } from '../../../shared/constants/config';
import { getBackendAuthHeaders } from '../../../shared/services/backendApi';

const BASE = 'https://api.mapbox.com/v4';
const TIMEOUT_MS = 5_000;

/** Fetch with a manual abort-signal timeout (compatible with all RN versions). */
async function fetchWithTimeout(url: string): Promise<Response> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(tid);
  }
}

// ── 1. Elevation ─────────────────────────────────────────────────────────────

/**
 * Approximate elevation (metres) at a point using the mapbox-terrain-v2
 * contour layer.  Returns the nearest contour's `ele` value — accurate to the
 * contour interval (~10 m in mountainous areas, ~40 m on flat plains).
 */
export async function fetchElevationAtPoint(
  lng: number,
  lat: number,
): Promise<number | null> {
  try {
    const url =
      `${BASE}/mapbox.mapbox-terrain-v2/tilequery/${lng},${lat}.json` +
      `?layers=contour&limit=1&access_token=${MAPBOX_PUBLIC_TOKEN}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const data = await res.json();
    const ele = data.features?.[0]?.properties?.ele;
    return typeof ele === 'number' ? ele : null;
  } catch {
    return null;
  }
}

// ── 2. Nearby road restrictions (tunnels) ────────────────────────────────────

export interface RestrictionResult {
  hasTunnel: boolean;
  tunnelDistance: number; // metres, 0 if unknown
  hasBridge: boolean;
  bridgeDistance: number;
  candidates: RoadStructureCandidate[];
  rawFeatureCount: number;
}

export interface RoadStructureCandidate {
  kind: 'tunnel' | 'bridge';
  distance: number; // Mapbox tilequery distance from the queried GPS point
  lng: number;
  lat: number;
  coordinates: [number, number][];
  name?: string;
  roadClass?: string;
  structure?: string;
  layer?: string;
  source?: 'mapbox-streets-v8';
}

function isLngLatPair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

function collectLngLatPairs(value: unknown, out: [number, number][] = []): [number, number][] {
  if (isLngLatPair(value)) {
    out.push([value[0], value[1]]);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectLngLatPairs(item, out));
  }
  return out;
}

function nearestCoordinate(
  coords: [number, number][],
  fallback: [number, number],
): [number, number] {
  if (!coords.length) return fallback;
  let nearest = coords[0];
  let best = Infinity;
  for (const coord of coords) {
    const dx = coord[0] - fallback[0];
    const dy = coord[1] - fallback[1];
    const d = dx * dx + dy * dy;
    if (d < best) {
      best = d;
      nearest = coord;
    }
  }
  return nearest;
}

/**
 * Query streets-v8 road layer for tunnels and bridges within radiusM metres.
 * Useful for warning tall/heavy trucks about upcoming clearance restrictions.
 * Tunnel & bridge heights are not in streets-v8, so callers must verify that
 * the feature is actually ahead on the active route before warning the driver.
 */
export async function fetchNearbyRestrictions(
  lng: number,
  lat: number,
  radiusM = 400,
): Promise<RestrictionResult> {
  const none: RestrictionResult = {
    hasTunnel: false, tunnelDistance: 0,
    hasBridge: false, bridgeDistance: 0,
    candidates: [],
    rawFeatureCount: 0,
  };
  try {
    const authHeaders = await getBackendAuthHeaders();
    const params = new URLSearchParams({
      lng: String(lng),
      lat: String(lat),
      radius: String(radiusM),
    });
    const proxied = await fetch(`${BACKEND_URL}/api/tilequery/restrictions?${params}`, {
      headers: authHeaders,
    });
    if (proxied.ok) {
      return await proxied.json() as RestrictionResult;
    }
  } catch {
    // Fall through to direct public Mapbox query as a resilience fallback.
  }

  try {
    const url =
      `${BASE}/mapbox.mapbox-streets-v8/tilequery/${lng},${lat}.json` +
      `?layers=road&radius=${radiusM}&limit=25&geometry=linestring` +
      `&access_token=${MAPBOX_PUBLIC_TOKEN}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return none;
    const data = await res.json();
    const features: any[] = data.features ?? [];

    const candidates: RoadStructureCandidate[] = features
      .filter(f => f.properties?.structure === 'tunnel' || f.properties?.structure === 'bridge')
      .map((f: any) => {
        const coordinates = collectLngLatPairs(f.geometry?.coordinates);
        const nearest = nearestCoordinate(coordinates, [lng, lat]);
        const kind: RoadStructureCandidate['kind'] =
          f.properties?.structure === 'tunnel' ? 'tunnel' : 'bridge';
        return {
          kind,
          distance: Math.round(f.properties?.tilequery?.distance ?? 0),
          lng: nearest[0],
          lat: nearest[1],
          coordinates,
          name: f.properties?.name_bg ?? f.properties?.name,
          roadClass: f.properties?.class,
          structure: f.properties?.structure,
          layer: f.properties?.tilequery?.layer,
          source: 'mapbox-streets-v8' as const,
        };
      })
      .sort((a, b) => a.distance - b.distance);

    const tunnels = candidates.filter(f => f.kind === 'tunnel');
    const bridges = candidates.filter(f => f.kind === 'bridge');

    return {
      hasTunnel:      tunnels.length > 0,
      tunnelDistance: tunnels[0]?.distance ?? 0,
      hasBridge:      bridges.length > 0,
      bridgeDistance: bridges[0]?.distance ?? 0,
      candidates,
      rawFeatureCount: features.length,
    };
  } catch {
    return none;
  }
}
