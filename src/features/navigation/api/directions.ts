import type GeoJSON from 'geojson';
import { BACKEND_URL } from '../../../shared/constants/config';

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

export interface BannerComponent {
  type: 'text' | 'lane' | 'icon' | 'exit-number' | 'exit' | 'delimiter';
  text: string;
  active?: boolean;
  directions?: string[];
}

/** Structured lane-guidance and turn instruction from Mapbox banner_instructions. */
export interface BannerInstruction {
  distanceAlongGeometry: number;
  primary: {
    text: string;
    type: string;
    modifier?: string;
    /** Components array вЂ” contains exit-number, text (destinations), icon, delimiter parts */
    components?: BannerComponent[];
  };
  /** Secondary sign вЂ” additional road names / route numbers (e.g. "A1 / E80") */
  secondary?: {
    text: string;
    components?: BannerComponent[];
  };
  /** sub contains lane components вЂ” use sub.components.filter(c => c.type === 'lane') */
  sub?: { components: BannerComponent[] };
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
  bannerInstructions?: BannerInstruction[];
}

export interface RestrictionPoint {
  lat: number;
  lng: number;
  type: 'maxheight' | 'maxweight' | 'maxwidth';
  value: string;       // raw OSM value, e.g. "3.8"
  value_num: number;   // parsed float
}

export interface RouteResult {
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
  distance: number;      // meters total
  duration: number;      // seconds total
  maxspeeds: MaxspeedEntry[];
  /** Per-coordinate congestion level: 'low' | 'moderate' | 'heavy' | 'severe' | 'unknown' */
  congestion: string[];
  steps: RouteStep[];
  /** Pre-built FeatureCollection for congestion-colored line rendering вЂ” never null */
  congestionGeoJSON: GeoJSON.FeatureCollection;
  /** Road restriction signs along the route (maxheight / maxweight / maxwidth) */
  restrictions: RestrictionPoint[];
}

/**
 * Build a congestion-colored FeatureCollection from route coordinates + Mapbox annotation array.
 * Each feature is a 2-point LineString tagged with its congestion level.
 * Used by MapScreen LineLayer to color the route: low=neon, moderate=yellow, heavy/severe=red.
 */
export function buildCongestionGeoJSON(
  coords: [number, number][],
  congestion: string[],
): GeoJSON.FeatureCollection {
  if (congestion.length === 0 || coords.length < 2) {
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { congestion: 'unknown' },
        geometry: { type: 'LineString', coordinates: coords },
      }],
    };
  }
  const features: GeoJSON.Feature[] = [];
  for (let i = 0; i < congestion.length && i + 1 < coords.length; i++) {
    features.push({
      type: 'Feature',
      properties: { congestion: congestion[i] || 'unknown' },
      geometry: { type: 'LineString', coordinates: [coords[i], coords[i + 1]] },
    });
  }
  return { type: 'FeatureCollection', features };
}

export interface TruckDimensions {
  max_height?: number;  // meters (0вЂ“10)
  max_width?: number;   // meters (0вЂ“10)
  max_weight?: number;  // metric tons (0вЂ“100)
  max_length?: number;  // meters вЂ” vehicle length restriction
  exclude?: string;     // 'tunnel' | 'tunnel,motorway' | undefined вЂ” ADR hazmat routing
  avoidUnpaved?: boolean;
  adr_tunnel?: 'none' | 'B' | 'C' | 'D' | 'E';
}

/**
 * Map ADR hazmat class to Mapbox exclude parameter.
 * Classes 1-6: avoid tunnels (flammable/explosive/toxic cargo).
 * Class 7 (radioactive): avoid tunnels AND motorways.
 */
export function adrToExclude(hazmat: string): string | undefined {
  if (['1', '2', '3', '4', '5', '6'].includes(hazmat)) return 'tunnel';
  if (hazmat === '7') return 'tunnel,motorway';
  return undefined;
}

/**
 * Fetch a truck-safe route via the Flask backend в†’ TomTom Routing API.
 * travelMode=truck with full HGV params: height, width, weight, length,
 * axle count, ADR tunnel restriction code.
 * Real-time traffic is included by default in every TomTom response.
 */
export async function fetchRoute(
  origin: [number, number],
  destination: [number, number],
  truck?: TruckDimensions,
  departAt?: string,
  waypoints?: [number, number][],
): Promise<RouteResult | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/routes/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin,
        destination,
        waypoints: waypoints ?? [],
        truck: truck ?? {},
        avoid_unpaved: truck?.avoidUnpaved ?? false,
        adr_tunnel_code: truck?.adr_tunnel ?? 'none',
        depart_at: departAt ?? null,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error) return null;

    const routeCoords: [number, number][] = data.geometry?.coordinates ?? [];

    // Map TomTom steps to RouteStep format
    const steps: RouteStep[] = (data.steps ?? []).map((s: any) => ({
      maneuver:           s.maneuver ?? { instruction: '', type: '', modifier: undefined },
      distance:           s.distance ?? 0,
      duration:           s.duration ?? 0,
      name:               s.name ?? '',
      intersections:      s.intersections ?? [],
      voiceInstructions:  [],
      bannerInstructions: s.bannerInstructions ?? [],
    }));

    return {
      geometry:          data.geometry,
      distance:          data.distance,
      duration:          data.duration,
      maxspeeds:         data.maxspeeds ?? [],
      congestion:        [],
      congestionGeoJSON: data.congestionGeoJSON ?? buildCongestionGeoJSON(routeCoords, []),
      steps,
      restrictions:      data.restrictions ?? [],
    };
  } catch {
    return null;
  }
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

/** Format distance in human-readable Bulgarian (internal helper). */
function fmtDistBg(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} РєРёР»РѕРјРµС‚СЂР°`;
  if (m >= 100)  return `${Math.round(m / 100) * 100} РјРµС‚СЂР°`;
  return `${Math.round(m)} РјРµС‚СЂР°`;
}

/**
 * Generate a Bulgarian turn instruction from RouteStep maneuver data.
 * Used as fallback when Mapbox voiceInstructions are unavailable
 * or when the device TTS engine cannot handle the API-provided text.
 */
export function bgInstruction(step: RouteStep): string {
  const { type, modifier } = step.maneuver;
  const road  = step.name ? ` РїРѕ ${step.name}` : '';
  const ahead = step.distance > 50 ? ` СЃР»РµРґ ${fmtDistBg(step.distance)}` : '';

  switch (type) {
    case 'depart':
      return `РўСЂСЉРіРЅРµС‚Рµ${road}.`;
    case 'arrive':
      return 'РџСЂРёСЃС‚РёРіРЅР°С…С‚Рµ РЅР° РґРµСЃС‚РёРЅР°С†РёСЏС‚Р°.';
    case 'continue':
    case 'new name':
      return `РџСЂРѕРґСЉР»Р¶РµС‚Рµ РЅР°РїСЂР°РІРѕ${road}.`;
    case 'merge':
      return `Р’Р»РµР·С‚Рµ РІ РїРѕС‚РѕРєР°${road}.`;
    case 'on ramp':
      return `РљР°С‡РµС‚Рµ СЃРµ РЅР° РјР°РіРёСЃС‚СЂР°Р»Р°С‚Р°${road}.`;
    case 'off ramp':
      return `РЎР»РµР·С‚Рµ РѕС‚ РјР°РіРёСЃС‚СЂР°Р»Р°С‚Р°${road}.`;
    case 'fork':
      return modifier?.includes('left')
        ? `Р’Р·РµРјРµС‚Рµ Р»РµРІРёСЏ РєР»РѕРЅ${road}.`
        : `Р’Р·РµРјРµС‚Рµ РґРµСЃРЅРёСЏ РєР»РѕРЅ${road}.`;
    case 'end of road':
      return modifier?.includes('left')
        ? `Р’ РєСЂР°СЏ РЅР° РїСЉС‚СЏ Р·Р°РІРёР№С‚Рµ РЅР°Р»СЏРІРѕ${road}.`
        : `Р’ РєСЂР°СЏ РЅР° РїСЉС‚СЏ Р·Р°РІРёР№С‚Рµ РЅР°РґСЏСЃРЅРѕ${road}.`;
    case 'turn':
    case 'ramp': {
      switch (modifier) {
        case 'sharp left':   return `Р—Р°РІРёР№С‚Рµ СЂСЏР·РєРѕ РЅР°Р»СЏРІРѕ${ahead}${road}.`;
        case 'left':         return `Р—Р°РІРёР№С‚Рµ РЅР°Р»СЏРІРѕ${ahead}${road}.`;
        case 'slight left':  return `Р—Р°РІРёР№С‚Рµ Р»РµРєРѕ РЅР°Р»СЏРІРѕ${ahead}${road}.`;
        case 'straight':     return `РџСЂРѕРґСЉР»Р¶РµС‚Рµ РЅР°РїСЂР°РІРѕ${road}.`;
        case 'slight right': return `Р—Р°РІРёР№С‚Рµ Р»РµРєРѕ РЅР°РґСЏСЃРЅРѕ${ahead}${road}.`;
        case 'right':        return `Р—Р°РІРёР№С‚Рµ РЅР°РґСЏСЃРЅРѕ${ahead}${road}.`;
        case 'sharp right':  return `Р—Р°РІРёР№С‚Рµ СЂСЏР·РєРѕ РЅР°РґСЏСЃРЅРѕ${ahead}${road}.`;
        case 'uturn':        return `РќР°РїСЂР°РІРµС‚Рµ РѕР±СЂР°С‚РµРЅ Р·Р°РІРѕР№.`;
        default:             return `Р—Р°РІРёР№С‚Рµ${road}.`;
      }
    }
    case 'roundabout':
    case 'rotary': {
      const exit = (step.maneuver as { exit?: number }).exit;
      return exit
        ? `Р’Р»РµР·С‚Рµ РІ РєСЂСЉРіРѕРІРѕС‚Рѕ Рё РёР·Р»РµР·С‚Рµ РЅР° ${exit}-РёСЏ РёР·С…РѕРґ.`
        : 'Р’Р»РµР·С‚Рµ РІ РєСЂСЉРіРѕРІРѕС‚Рѕ РґРІРёР¶РµРЅРёРµ.';
    }
    default:
      return step.maneuver.instruction || `РџСЂРѕРґСЉР»Р¶РµС‚Рµ${road}.`;
  }
}

/**
 * Nearest-neighbour TSP approximation for waypoint ordering.
 * Reorders intermediate stops to minimize total travel distance from origin.
 * O(nВІ) вЂ” fast enough for в‰¤20 waypoints.
 */
export function optimizeWaypointOrder(
  origin: [number, number],
  waypoints: [number, number][],
): [number, number][] {
  if (waypoints.length <= 1) return waypoints;
  const remaining = [...waypoints];
  const ordered: [number, number][] = [];
  let cur = origin;
  while (remaining.length > 0) {
    let minDist = Infinity;
    let minIdx = 0;
    remaining.forEach((wp, i) => {
      const d = (wp[0] - cur[0]) ** 2 + (wp[1] - cur[1]) ** 2;
      if (d < minDist) { minDist = d; minIdx = i; }
    });
    ordered.push(remaining[minIdx]);
    cur = remaining[minIdx];
    remaining.splice(minIdx, 1);
  }
  return ordered;
}

/** Format distance in human-readable Bulgarian. */
export function fmtDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} Рј`;
  return `${(meters / 1000).toFixed(1)} РєРј`;
}

/** Format duration in human-readable Bulgarian. */
export function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m} РјРёРЅ`;
  return `${h} С‡ ${m} РјРёРЅ`;
}

/** Emoji for maneuver type + modifier. */
export function maneuverEmoji(type: string, modifier?: string): string {
  if (type === 'arrive') return 'рџЋЇ';
  if (type === 'depart') return 'рџљ¦';
  if (type === 'roundabout' || type === 'rotary') return 'рџ”ѓ';
  if (type === 'fork') return modifier?.includes('left') ? 'в†™пёЏ' : 'в†пёЏ';
  if (modifier === 'uturn') return 'рџ”„';
  if (modifier === 'sharp left' || modifier === 'left') return 'в¬…пёЏ';
  if (modifier === 'slight left') return 'в†–пёЏ';
  if (modifier === 'sharp right' || modifier === 'right') return 'вћЎпёЏ';
  if (modifier === 'slight right') return 'в†—пёЏ';
  return 'в¬†пёЏ';
}
