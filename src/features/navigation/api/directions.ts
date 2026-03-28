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
    /** Components array вЂ" contains exit-number, text (destinations), icon, delimiter parts */
    components?: BannerComponent[];
  };
  /** Secondary sign вЂ" additional road names / route numbers (e.g. "A1 / E80") */
  secondary?: {
    text: string;
    components?: BannerComponent[];
  };
  /** sub contains lane components вЂ" use sub.components.filter(c => c.type === 'lane') */
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
  /** Pre-built FeatureCollection for congestion-colored line rendering вЂ" never null */
  congestionGeoJSON: GeoJSON.FeatureCollection;
  /** Road restriction signs along the route (maxheight / maxweight / maxwidth) */
  restrictions: RestrictionPoint[];
  /** Alternative routes (simplified, no steps) returned alongside primary */
  alternatives?: import('../../../shared/services/backendApi').RouteOption[];
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
  max_height?: number;  // meters (0вЂ"10)
  max_width?: number;   // meters (0вЂ"10)
  max_weight?: number;  // metric tons (0вЂ"100)
  max_length?: number;  // meters вЂ" vehicle length restriction
  exclude?: string;     // 'tunnel' | 'tunnel,motorway' | undefined вЂ" ADR hazmat routing
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
 * Fetch a truck-safe route via the Flask backend в†' TomTom Routing API.
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
      alternatives:      data.alternatives ?? [],
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
  if (m >= 1000) return `${(m / 1000).toFixed(1)} километра`;
  if (m >= 100)  return `${Math.round(m / 100) * 100} метра`;
  return `${Math.round(m)} метра`;
}

/**
 * Generate a Bulgarian turn instruction from RouteStep maneuver data.
 * Used as fallback when Mapbox voiceInstructions are unavailable
 * or when the device TTS engine cannot handle the API-provided text.
 */
export function bgInstruction(step: RouteStep): string {
  const { type, modifier } = step.maneuver;
  const road  = step.name ? ` по ${step.name}` : '';
  const ahead = step.distance > 50 ? ` след ${fmtDistBg(step.distance)}` : '';

  switch (type) {
    case 'depart':
      return `Тръгнете${road}.`;
    case 'arrive':
      return 'Пристигнахте на дестинацията.';
    case 'continue':
    case 'new name':
      return `Продължете направо${road}.`;
    case 'merge':
      return `Влезте в потока${road}.`;
    case 'on ramp':
      return `Качете се на магистралата${road}.`;
    case 'off ramp':
      return `Слезте от магистралата${road}.`;
    case 'fork':
      return modifier?.includes('left')
        ? `Вземете левия клон${road}.`
        : `Вземете десния клон${road}.`;
    case 'end of road':
      return modifier?.includes('left')
        ? `В края на пътя завийте наляво${road}.`
        : `В края на пътя завийте надясно${road}.`;
    case 'turn':
    case 'ramp': {
      switch (modifier) {
        case 'sharp left':   return `Завийте рязко наляво${ahead}${road}.`;
        case 'left':         return `Завийте наляво${ahead}${road}.`;
        case 'slight left':  return `Завийте леко наляво${ahead}${road}.`;
        case 'straight':     return `Продължете направо${road}.`;
        case 'slight right': return `Завийте леко надясно${ahead}${road}.`;
        case 'right':        return `Завийте надясно${ahead}${road}.`;
        case 'sharp right':  return `Завийте рязко надясно${ahead}${road}.`;
        case 'uturn':        return `Направете обратен завой.`;
        default:             return `Завийте${road}.`;
      }
    }
    case 'roundabout':
    case 'rotary': {
      const exit = (step.maneuver as { exit?: number }).exit;
      return exit
        ? `Влезте в кръговото и излезте на ${exit}-ия изход.`
        : 'Влезте в кръговото движение.';
    }
    default:
      return step.maneuver.instruction || `Продължете${road}.`;
  }
}

/**
 * Nearest-neighbour TSP approximation for waypoint ordering.
 * Reorders intermediate stops to minimize total travel distance from origin.
 * O(nВІ) вЂ" fast enough for в‰¤20 waypoints.
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
  if (meters < 1000) return `${Math.round(meters)} м`;
  return `${(meters / 1000).toFixed(1)} км`;
}

/** Format duration in human-readable Bulgarian. */
export function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m} мин`;
  return `${h} ч ${m} мин`;
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
