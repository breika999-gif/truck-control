import type * as GeoJSON from 'geojson';
import type { RouteResult } from '../api/directions';
import { gradeMultiplier, type GradeProfile } from './gradeProfile';

const TRUCK_SPEED_CAP_MPS = 90 / 3.6;
const WARNING_WINDOW_S = 30 * 60;

export type TachoRangeStatus = 'safe' | 'warning' | 'over';

export interface TachoRouteTimingInput {
  routeCoords: [number, number][];
  userCoords: [number, number] | null;
  drivingTimeLeftMin: number | null | undefined;
  isLoaded?: boolean;
  route?: RouteResult | null;
  gradeProfile?: GradeProfile | null;
}

interface TimedRoute {
  coords: [number, number][];
  cumulativeM: number[];
  segmentEndTimeS: number[];
  totalDistanceM: number;
  totalTimeS: number;
}

interface RouteProjection {
  coords: [number, number];
  segmentIndex: number;
  distanceAlongRouteM: number;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function distanceMeters(a: [number, number], b: [number, number]): number {
  const midLatRad = ((a[1] + b[1]) / 2) * Math.PI / 180;
  const dx = (b[0] - a[0]) * 111320 * Math.cos(midLatRad);
  const dy = (b[1] - a[1]) * 110540;
  return Math.sqrt(dx * dx + dy * dy);
}

function projectPointOnSegment(
  point: [number, number],
  start: [number, number],
  end: [number, number],
): { coords: [number, number]; ratio: number; distanceM: number; segmentLengthM: number } {
  const midLatRad = ((point[1] + start[1] + end[1]) / 3) * Math.PI / 180;
  const metersPerLng = 111320 * Math.cos(midLatRad);
  const metersPerLat = 110540;
  const px = (point[0] - start[0]) * metersPerLng;
  const py = (point[1] - start[1]) * metersPerLat;
  const sx = 0;
  const sy = 0;
  const ex = (end[0] - start[0]) * metersPerLng;
  const ey = (end[1] - start[1]) * metersPerLat;
  const dx = ex - sx;
  const dy = ey - sy;
  const lenSq = dx * dx + dy * dy;
  const ratio = lenSq > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / lenSq)) : 0;
  const projectedX = sx + dx * ratio;
  const projectedY = sy + dy * ratio;
  const distanceM = Math.sqrt((px - projectedX) ** 2 + (py - projectedY) ** 2);
  const segmentLengthM = Math.sqrt(lenSq);

  return {
    coords: [
      start[0] + (end[0] - start[0]) * ratio,
      start[1] + (end[1] - start[1]) * ratio,
    ],
    ratio,
    distanceM,
    segmentLengthM,
  };
}

function projectPointOnRoute(point: [number, number], coords: [number, number][]): RouteProjection | null {
  if (coords.length < 2) return null;

  let best: RouteProjection | null = null;
  let bestDistanceM = Infinity;
  let distanceBeforeSegmentM = 0;

  for (let index = 0; index < coords.length - 1; index += 1) {
    const projection = projectPointOnSegment(point, coords[index], coords[index + 1]);
    const distanceAlongRouteM = distanceBeforeSegmentM + projection.segmentLengthM * projection.ratio;
    if (projection.distanceM < bestDistanceM) {
      bestDistanceM = projection.distanceM;
      best = {
        coords: projection.coords,
        segmentIndex: index,
        distanceAlongRouteM,
      };
    }
    distanceBeforeSegmentM += projection.segmentLengthM;
  }

  return best;
}

function cumulativeDistances(coords: [number, number][]): number[] {
  const cumulative = [0];
  let total = 0;
  for (let index = 1; index < coords.length; index += 1) {
    total += distanceMeters(coords[index - 1], coords[index]);
    cumulative[index] = total;
  }
  return cumulative;
}

function pointAtDistance(
  coords: [number, number][],
  cumulativeM: number[],
  targetM: number,
): [number, number] {
  if (coords.length === 0) return [0, 0];
  if (coords.length === 1) return coords[0];

  const totalM = cumulativeM[cumulativeM.length - 1] ?? 0;
  const target = Math.max(0, Math.min(totalM, targetM));
  for (let index = 1; index < coords.length; index += 1) {
    const startM = cumulativeM[index - 1] ?? 0;
    const endM = cumulativeM[index] ?? startM;
    if (target <= endM || index === coords.length - 1) {
      const spanM = Math.max(0, endM - startM);
      const t = spanM > 0 ? (target - startM) / spanM : 0;
      const start = coords[index - 1];
      const end = coords[index];
      return [
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t,
      ];
    }
  }
  return coords[coords.length - 1];
}

function sliceByDistance(
  coords: [number, number][],
  cumulativeM: number[],
  startM: number,
  endM: number,
): [number, number][] {
  const totalM = cumulativeM[cumulativeM.length - 1] ?? 0;
  const from = Math.max(0, Math.min(totalM, Math.min(startM, endM)));
  const to = Math.max(0, Math.min(totalM, Math.max(startM, endM)));
  if (coords.length < 2 || to <= from) return [];

  const sliced: [number, number][] = [pointAtDistance(coords, cumulativeM, from)];
  for (let index = 1; index < coords.length - 1; index += 1) {
    const distanceM = cumulativeM[index] ?? 0;
    if (distanceM > from && distanceM < to) {
      sliced.push(coords[index]);
    }
  }
  sliced.push(pointAtDistance(coords, cumulativeM, to));
  return sliced;
}

function averageGradeInRange(
  gradeProfile: GradeProfile | null | undefined,
  startFraction: number,
  endFraction: number,
): number {
  const points = gradeProfile?.points;
  if (!points?.length) return 0;
  const start = clamp(Math.min(startFraction, endFraction));
  const end = clamp(Math.max(startFraction, endFraction));
  const matching = points.filter(point => point.fraction >= start && point.fraction <= end);
  if (!matching.length) return 0;
  return matching.reduce((sum, point) => sum + point.gradePercent, 0) / matching.length;
}

function buildTimedRoute(input: TachoRouteTimingInput): TimedRoute | null {
  const { routeCoords, userCoords, route, gradeProfile, isLoaded = false } = input;
  if (!userCoords || routeCoords.length < 2) return null;

  const userProjection = projectPointOnRoute(userCoords, routeCoords);
  if (!userProjection) return null;

  const aheadCoords: [number, number][] = [
    userProjection.coords,
    ...routeCoords.slice(Math.min(routeCoords.length - 1, userProjection.segmentIndex + 1)),
  ];
  if (aheadCoords.length < 2) return null;

  const fullCumulativeM = cumulativeDistances(routeCoords);
  const aheadCumulativeM = cumulativeDistances(aheadCoords);
  const totalAheadM = aheadCumulativeM[aheadCumulativeM.length - 1] ?? 0;
  if (totalAheadM <= 0) return null;

  const routeDistanceM = Number.isFinite(route?.distance) && (route?.distance ?? 0) > 0
    ? route!.distance
    : (fullCumulativeM[fullCumulativeM.length - 1] ?? totalAheadM);
  const routeDurationS = Number.isFinite(route?.duration) && (route?.duration ?? 0) > 0
    ? route!.duration
    : 0;
  const routeSecondsPerMeter = routeDurationS > 0 && routeDistanceM > 0
    ? routeDurationS / routeDistanceM
    : 0;
  const secondsPerMeter = Math.max(routeSecondsPerMeter, 1 / TRUCK_SPEED_CAP_MPS);

  const segmentEndTimeS = [0];
  let totalTimeS = 0;
  for (let index = 1; index < aheadCoords.length; index += 1) {
    const segmentM = Math.max(0, aheadCumulativeM[index] - aheadCumulativeM[index - 1]);
    const fullStartM = Math.min(routeDistanceM, userProjection.distanceAlongRouteM + aheadCumulativeM[index - 1]);
    const fullEndM = Math.min(routeDistanceM, fullStartM + segmentM);
    const avgGrade = averageGradeInRange(
      gradeProfile,
      routeDistanceM > 0 ? fullStartM / routeDistanceM : 0,
      routeDistanceM > 0 ? fullEndM / routeDistanceM : 0,
    );
    totalTimeS += segmentM * secondsPerMeter * gradeMultiplier(avgGrade, isLoaded);
    segmentEndTimeS[index] = totalTimeS;
  }

  return {
    coords: aheadCoords,
    cumulativeM: aheadCumulativeM,
    segmentEndTimeS,
    totalDistanceM: totalAheadM,
    totalTimeS,
  };
}

function distanceAtTime(timedRoute: TimedRoute, targetS: number): number {
  if (targetS <= 0) return 0;
  if (targetS >= timedRoute.totalTimeS) return timedRoute.totalDistanceM;

  for (let index = 1; index < timedRoute.coords.length; index += 1) {
    const startT = timedRoute.segmentEndTimeS[index - 1] ?? 0;
    const endT = timedRoute.segmentEndTimeS[index] ?? startT;
    if (targetS <= endT || index === timedRoute.coords.length - 1) {
      const spanT = Math.max(0, endT - startT);
      const t = spanT > 0 ? (targetS - startT) / spanT : 0;
      const startM = timedRoute.cumulativeM[index - 1] ?? 0;
      const endM = timedRoute.cumulativeM[index] ?? startM;
      return startM + (endM - startM) * t;
    }
  }
  return timedRoute.totalDistanceM;
}

function lineFeature(
  id: string,
  status: TachoRangeStatus,
  coords: [number, number][],
): GeoJSON.Feature<GeoJSON.LineString> | null {
  if (coords.length < 2) return null;
  return {
    type: 'Feature',
    id,
    properties: { status },
    geometry: { type: 'LineString', coordinates: coords },
  };
}

export function buildTachoRangeGeoJSON(input: TachoRouteTimingInput): GeoJSON.FeatureCollection {
  const remainingMin = Number(input.drivingTimeLeftMin);
  const timedRoute = buildTimedRoute(input);
  if (!timedRoute || !Number.isFinite(remainingMin)) {
    return { type: 'FeatureCollection', features: [] };
  }

  const limitS = Math.max(0, remainingMin * 60);
  const warningStartS = Math.max(0, limitS - WARNING_WINDOW_S);
  const safeEndM = distanceAtTime(timedRoute, warningStartS);
  const limitM = distanceAtTime(timedRoute, limitS);

  const features = [
    lineFeature(
      'tacho-safe',
      'safe',
      sliceByDistance(timedRoute.coords, timedRoute.cumulativeM, 0, safeEndM),
    ),
    lineFeature(
      'tacho-warning',
      'warning',
      sliceByDistance(timedRoute.coords, timedRoute.cumulativeM, safeEndM, limitM),
    ),
    lineFeature(
      'tacho-over',
      'over',
      sliceByDistance(timedRoute.coords, timedRoute.cumulativeM, limitM, timedRoute.totalDistanceM),
    ),
  ].filter((feature): feature is GeoJSON.Feature<GeoJSON.LineString> => feature !== null);

  return { type: 'FeatureCollection', features };
}

export function findTachoLimitPoint(input: TachoRouteTimingInput): {
  coords: [number, number];
  routeSlice: [number, number][];
  distanceM: number;
} | null {
  const remainingMin = Number(input.drivingTimeLeftMin);
  const timedRoute = buildTimedRoute(input);
  if (!timedRoute || !Number.isFinite(remainingMin)) return null;

  const limitM = distanceAtTime(timedRoute, Math.max(0, remainingMin * 60));
  const coords = pointAtDistance(timedRoute.coords, timedRoute.cumulativeM, limitM);
  const routeSlice = sliceByDistance(
    timedRoute.coords,
    timedRoute.cumulativeM,
    Math.max(0, limitM - 12_000),
    Math.min(timedRoute.totalDistanceM, limitM + 18_000),
  );

  return { coords, routeSlice, distanceM: limitM };
}
