import type GeoJSON from 'geojson';
import { APP_INTERNAL_TOKEN, BACKEND_URL } from '../../../shared/constants/config';
import i18n from '../../../i18n';

const ROUTE_FETCH_TIMEOUT_MS = 90_000;

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
  type: 'text' | 'lane' | 'icon' | 'exit-number' | 'exit' | 'delimiter' | 'guidance-view';
  text: string;
  active?: boolean;
  directions?: string[];
  imageBaseURL?: string;
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
  type: 'maxheight' | 'maxweight' | 'maxwidth' | 'no_trucks' | 'hazmat';
  value: string;       // raw OSM value, e.g. "3.8" or "no"
  value_num: number;   // parsed float
  tag?: string;         // original OSM tag, e.g. maxweight:hgv
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
  /** Real-time traffic delay bubbles (lat, lng, label, severity) */
  traffic_alerts?: any[];
  /** Alternative routes (simplified, no steps) returned alongside primary */
  alternatives?: import('../../../shared/services/backendApi').RouteOption[];
  /** Reordered waypoint indices from TomTom computeBestOrder (null if not optimized) */
  optimizedWaypointOrder?: number[] | null;
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
  let segStart = 0;
  for (let i = 1; i <= congestion.length && i + 1 <= coords.length; i++) {
    const isLast = i === congestion.length || i + 1 === coords.length;
    const changed = !isLast && (congestion[i] || 'unknown') !== (congestion[segStart] || 'unknown');
    if (changed || isLast) {
      features.push({
        type: 'Feature' as const,
        properties: {
          congestion: congestion[segStart] || 'unknown',
          endIdx: i,
        },
        geometry: { type: 'LineString', coordinates: coords.slice(segStart, i + 1) },
      });
      segStart = i;
    }

  }
  return { type: 'FeatureCollection', features };
}

export interface TruckDimensions {
  max_height?: number;  // meters (0вЂ"10)
  max_width?: number;   // meters (0вЂ"10)
  max_weight?: number;  // metric tons (0вЂ"100)
  max_length?: number;  // meters вЂ" vehicle length restriction
  exclude?: string;     // 'tunnel' | 'tunnel,motorway' | undefined вЂ" ADR hazmat routing
  hazmat_class?: string;
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
  signal?: AbortSignal,
  optimizeWaypoints: boolean = false,
  onBackendStatus?: (online: boolean) => void,
): Promise<RouteResult | null> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ROUTE_FETCH_TIMEOUT_MS);

  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeoutId);
      return null;
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/routes/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Token': APP_INTERNAL_TOKEN },
      signal: controller.signal,
      body: JSON.stringify({
        origin,
        destination,
        waypoints: waypoints ?? [],
        truck: truck ?? {},
        include_restrictions: true,
        avoid_unpaved: truck?.avoidUnpaved ?? false,
        adr_tunnel_code: truck?.adr_tunnel ?? 'none',
        depart_at: departAt ?? null,
        optimize: optimizeWaypoints,
      }),
    });
    if (!res.ok) {
      onBackendStatus?.(res.status < 500);
      return null;
    }
    const data = await res.json();
    onBackendStatus?.(true);
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
      geometry:               data.geometry,
      distance:               data.distance,
      duration:               data.duration,
      maxspeeds:              data.maxspeeds ?? [],
      congestion:             [],
      congestionGeoJSON:      data.congestionGeoJSON ?? buildCongestionGeoJSON(routeCoords, []),
      steps,
      restrictions:           data.restrictions ?? [],
      traffic_alerts:         data.traffic_alerts ?? [],
      alternatives:           data.alternatives ?? [],
      optimizedWaypointOrder: data.optimizedWaypointOrder ?? null,
    };
  } catch {
    if (!(signal?.aborted && !timedOut)) {
      onBackendStatus?.(false);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
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

/** Format distance for spoken turn instructions. */
function fmtSpokenDistance(m: number): string {
  if (m >= 1000) {
    return i18n.t('directions.distanceKilometersLong', { kilometers: (m / 1000).toFixed(1) });
  }
  const meters = m >= 100 ? Math.round(m / 100) * 100 : Math.round(m);
  return i18n.t('directions.distanceMetersLong', { meters });
}

/**
 * Generate a localized turn instruction from RouteStep maneuver data.
 * Used as fallback when Mapbox voiceInstructions are unavailable
 * or when the device TTS engine cannot handle the API-provided text.
 */
export function bgInstruction(step: RouteStep): string {
  const { type, modifier } = step.maneuver;
  const cleanRoad = step.name.replace(/<[^>]*>/g, '').trim();
  const road = cleanRoad ? i18n.t('directions.roadPrefix', { road: cleanRoad }) : '';
  const ahead = step.distance > 50
    ? i18n.t('directions.ahead', { distance: fmtSpokenDistance(step.distance) })
    : '';

  switch (type) {
    case 'depart':
      return i18n.t('directions.depart', { road });
    case 'arrive':
      return i18n.t('directions.arrive');
    case 'continue':
    case 'new name':
      return i18n.t('directions.continue', { road });
    case 'merge':
      return i18n.t('directions.merge', { road });
    case 'on ramp':
      return i18n.t('directions.onRamp', { road });
    case 'off ramp':
      return i18n.t('directions.offRamp', { road });
    case 'fork':
      return modifier?.includes('left')
        ? i18n.t('directions.forkLeft', { road })
        : i18n.t('directions.forkRight', { road });
    case 'end of road':
      return modifier?.includes('left')
        ? i18n.t('directions.endLeft', { road })
        : i18n.t('directions.endRight', { road });
    case 'turn':
    case 'ramp': {
      switch (modifier) {
        case 'sharp left':   return i18n.t('directions.sharpLeft', { ahead, road });
        case 'left':         return i18n.t('directions.left', { ahead, road });
        case 'slight left':  return i18n.t('directions.slightLeft', { ahead, road });
        case 'straight':     return i18n.t('directions.straight', { road });
        case 'slight right': return i18n.t('directions.slightRight', { ahead, road });
        case 'right':        return i18n.t('directions.right', { ahead, road });
        case 'sharp right':  return i18n.t('directions.sharpRight', { ahead, road });
        case 'uturn':        return i18n.t('directions.uturn');
        default:             return i18n.t('directions.turnGeneric', { road });
      }
    }
    case 'roundabout':
    case 'rotary': {
      const exit = (step.maneuver as { exit?: number }).exit;
      return exit
        ? i18n.t('directions.roundaboutExit', { exit })
        : i18n.t('directions.roundabout');
    }
    default:
      return step.maneuver.instruction || i18n.t('directions.continueGeneric', { road });
  }
}

/**
 * Nearest-neighbour TSP approximation for waypoint ordering.
 * Reorders intermediate stops to minimize total travel distance from origin.
 * O(n²) — fast enough for ≤20 waypoints.
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

/** Format distance in the active app language. */
export function fmtDistance(meters: number | null | undefined): string {
  if (meters == null) return '';
  if (meters < 1000) {
    return i18n.t('directions.distanceMetersShort', { meters: Math.round(meters) });
  }
  return i18n.t('directions.distanceKilometersShort', { kilometers: (meters / 1000).toFixed(1) });
}

/** Format duration in the active app language. */
export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return i18n.t('directions.durationMinutes', { minutes: m });
  return i18n.t('directions.durationHoursMinutes', { hours: h, minutes: m });
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
