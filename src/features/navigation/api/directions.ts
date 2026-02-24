import { MAPBOX_PUBLIC_TOKEN } from '../../../shared/constants/config';

export interface MaxspeedEntry {
  speed?: number;
  unit?: 'km/h' | 'mph';
  unknown?: boolean;
  none?: boolean;
}

export interface VoiceInstruction {
  distanceAlongGeometry: number;
  announcement: string;
}

export interface RouteStep {
  maneuver: {
    instruction: string;
    type: string;
    modifier?: string;
  };
  distance: number;  // meters to next step
  duration: number;  // seconds to next step
  name: string;      // road name
  intersections: Array<{ location: [number, number] }>;
  voiceInstructions?: VoiceInstruction[];
}

export interface RouteResult {
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
  distance: number;      // meters total
  duration: number;      // seconds total
  maxspeeds: MaxspeedEntry[];
  steps: RouteStep[];
}

export interface TruckDimensions {
  max_height?: number;  // meters (0–10)
  max_width?: number;   // meters (0–10)
  max_weight?: number;  // metric tons (0–100)
  max_length?: number;  // meters — vehicle length restriction
}

/**
 * Fetch a truck-aware route with turn-by-turn steps and speed limits.
 * Mapbox Directions API v5 — driving-traffic profile.
 * Docs: https://docs.mapbox.com/api/navigation/directions/
 *
 * Truck dimension params filter roads with physical restrictions:
 *   max_height, max_width, max_weight
 *
 * NOTE: No dedicated truck profile exists — driving-traffic is used.
 * NOTE: Overtaking restriction data is not available via Mapbox API.
 */
export async function fetchRoute(
  origin: [number, number],
  destination: [number, number],
  truck?: TruckDimensions,
): Promise<RouteResult | null> {
  const coords = `${origin[0]},${origin[1]};${destination[0]},${destination[1]}`;

  const params = new URLSearchParams({
    access_token: MAPBOX_PUBLIC_TOKEN,
    geometries: 'geojson',
    overview: 'full',
    steps: 'true',
    annotations: 'maxspeed',
    banner_instructions: 'true',
    voice_instructions: 'true',
    language: 'bg',
  });

  if (truck?.max_height != null) params.set('max_height', String(truck.max_height));
  if (truck?.max_width != null)  params.set('max_width',  String(truck.max_width));
  if (truck?.max_weight != null) params.set('max_weight', String(truck.max_weight));
  if (truck?.max_length != null) params.set('max_length', String(truck.max_length));

  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}?${params}`;

  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();

  const r = data.routes?.[0];
  if (!r) return null;

  // Flatten steps from all legs, mapping voice_instructions snake_case → camelCase
  const steps: RouteStep[] = (r.legs ?? []).flatMap(
    (leg: { steps?: any[] }) =>
      (leg.steps ?? []).map((s: any) => ({
        maneuver: s.maneuver,
        distance: s.distance,
        duration: s.duration,
        name: s.name,
        intersections: s.intersections ?? [],
        voiceInstructions: (s.voice_instructions ?? []).map(
          (vi: { distance_along_geometry: number; announcement: string }) => ({
            distanceAlongGeometry: vi.distance_along_geometry,
            announcement: vi.announcement,
          }),
        ),
      })),
  );

  return {
    geometry: r.geometry,
    distance: r.distance,
    duration: r.duration,
    maxspeeds: r.legs?.[0]?.annotation?.maxspeed ?? [],
    steps,
  };
}

/** Current road speed limit at user's position (km/h), or null if unknown. */
export function getSpeedLimitAtPosition(
  routeCoords: [number, number][],
  maxspeeds: MaxspeedEntry[],
  userPos: [number, number],
): number | null {
  if (!maxspeeds.length || !routeCoords.length) return null;

  let minDist = Infinity;
  let minIdx = 0;
  for (let i = 0; i < routeCoords.length; i++) {
    const dx = routeCoords[i][0] - userPos[0];
    const dy = routeCoords[i][1] - userPos[1];
    const d = dx * dx + dy * dy;
    if (d < minDist) { minDist = d; minIdx = i; }
  }

  const idx = Math.min(minIdx, maxspeeds.length - 1);
  const entry = maxspeeds[idx];
  if (!entry || entry.unknown || entry.none || entry.speed == null) return null;

  return entry.unit === 'mph' ? Math.round(entry.speed * 1.609) : entry.speed;
}

/** Index of the current navigation step based on user position. */
export function getCurrentStepIndex(
  steps: RouteStep[],
  userPos: [number, number],
): number {
  let minDist = Infinity;
  let minIdx = 0;
  for (let i = 0; i < steps.length; i++) {
    const loc = steps[i]?.intersections?.[0]?.location;
    if (!loc) continue;
    const dx = loc[0] - userPos[0];
    const dy = loc[1] - userPos[1];
    const d = dx * dx + dy * dy;
    if (d < minDist) { minDist = d; minIdx = i; }
  }
  return minIdx;
}

/** Emoji for maneuver type + modifier. */
export function maneuverEmoji(type: string, modifier?: string): string {
  if (type === 'arrive') return '🎯';
  if (type === 'depart') return '🚦';
  if (type === 'roundabout' || type === 'rotary') return '🔃';
  if (type === 'fork') return modifier?.includes('left') ? '↙️' : '↘️';
  if (modifier === 'uturn') return '🔄';
  if (modifier === 'sharp left' || modifier === 'left') return '⬅️';
  if (modifier === 'slight left') return '↖️';
  if (modifier === 'sharp right' || modifier === 'right') return '➡️';
  if (modifier === 'slight right') return '↗️';
  return '⬆️';
}
