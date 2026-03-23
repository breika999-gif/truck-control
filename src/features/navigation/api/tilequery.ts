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

import { MAPBOX_PUBLIC_TOKEN } from '../../../shared/constants/config';

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

// ── 2. Nearby truck parking ───────────────────────────────────────────────────

export interface ParkingSpot {
  name: string;
  distance: number; // metres
  lng: number;
  lat: number;
}

/**
 * Search for nearby parking POIs from the streets-v8 poi_label layer.
 * Filters by `category_en` or `maki` containing "parking" or "truck".
 * Returns results sorted by distance, up to 5 entries.
 */
export async function fetchNearbyParking(
  lng: number,
  lat: number,
  radiusM = 1000,
): Promise<ParkingSpot[]> {
  try {
    const url =
      `${BASE}/mapbox.mapbox-streets-v8/tilequery/${lng},${lat}.json` +
      `?layers=poi_label&radius=${radiusM}&limit=20&access_token=${MAPBOX_PUBLIC_TOKEN}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return [];
    const data = await res.json();

    return (data.features ?? [])
      .filter((f: any) => {
        const cat  = String(f.properties?.category_en ?? '').toLowerCase();
        const maki = String(f.properties?.maki ?? '').toLowerCase();
        return (
          cat.includes('parking') ||
          cat.includes('truck')   ||
          maki === 'parking'      ||
          maki === 'parking-garage' ||
          maki === 'truck'
        );
      })
      .map((f: any): ParkingSpot => ({
        name:     f.properties?.name_bg ?? f.properties?.name ?? 'Паркинг',
        distance: Math.round(f.properties?.tilequery?.distance ?? 0),
        lng:      f.geometry?.coordinates?.[0] ?? lng,
        lat:      f.geometry?.coordinates?.[1] ?? lat,
      }))
      .sort((a: ParkingSpot, b: ParkingSpot) => a.distance - b.distance)
      .slice(0, 5);
  } catch {
    return [];
  }
}

// ── 3. Speed limit at point ───────────────────────────────────────────────────

/**
 * Fetch the speed limit (km/h) of the nearest road segment at a given point.
 * Uses mapbox-streets-v8 road layer — returns null if unavailable.
 */
export async function fetchSpeedLimitAtPoint(
  lng: number,
  lat: number,
): Promise<number | null> {
  try {
    const url =
      `${BASE}/mapbox.mapbox-streets-v8/tilequery/${lng},${lat}.json` +
      `?layers=road&radius=25&limit=5&geometry=linestring&access_token=${MAPBOX_PUBLIC_TOKEN}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const data = await res.json();
    for (const f of data.features ?? []) {
      const raw = f.properties?.maxspeed;
      if (typeof raw === 'number' && raw > 0) {
        return f.properties?.maxspeed_unit === 'mph'
          ? Math.round(raw * 1.609)
          : raw;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ── 4. Nearby road restrictions (tunnels) ────────────────────────────────────

export interface RestrictionResult {
  hasTunnel: boolean;
  tunnelDistance: number; // metres, 0 if unknown
  hasBridge: boolean;
  bridgeDistance: number;
}

/**
 * Query streets-v8 road layer for tunnels and bridges within radiusM metres.
 * Useful for warning tall/heavy trucks about upcoming clearance restrictions.
 * Tunnel & bridge heights are not in streets-v8, but proximity is enough to
 * trigger a "check clearance" alert.
 */
export async function fetchNearbyRestrictions(
  lng: number,
  lat: number,
  radiusM = 400,
): Promise<RestrictionResult> {
  const none: RestrictionResult = {
    hasTunnel: false, tunnelDistance: 0,
    hasBridge: false, bridgeDistance: 0,
  };
  try {
    const url =
      `${BASE}/mapbox.mapbox-streets-v8/tilequery/${lng},${lat}.json` +
      `?layers=road&radius=${radiusM}&limit=25&geometry=linestring` +
      `&access_token=${MAPBOX_PUBLIC_TOKEN}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return none;
    const data = await res.json();
    const features: any[] = data.features ?? [];

    const tunnels = features.filter(f => f.properties?.structure === 'tunnel');
    const bridges = features.filter(f => f.properties?.structure === 'bridge');

    return {
      hasTunnel:      tunnels.length > 0,
      tunnelDistance: Math.round(tunnels[0]?.properties?.tilequery?.distance ?? 0),
      hasBridge:      bridges.length > 0,
      bridgeDistance: Math.round(bridges[0]?.properties?.tilequery?.distance ?? 0),
    };
  } catch {
    return none;
  }
}
