import type { RouteResult, RouteStep } from '../api/directions';
import type * as GeoJSON from 'geojson';
import { gradeMultiplier, type GradeProfile } from './gradeProfile';
import { HOS_CONTINUOUS_DRIVE_LIMIT_S } from '../../../shared/constants/hosRules';

const DRIVE_PERIOD_S = HOS_CONTINUOUS_DRIVE_LIMIT_S;
const TRUCK_SPEED_CAP_KMH = 90;
const TRANSITION_EPSILON = 0.0001;
const REST_MARKER_EPSILON = 0.0001;

const BLUE = '#13D9FF';
const PURPLE = '#7B61FF';
const YELLOW = '#F1C40F';
const RED = '#FF3B30';

export interface DriveSegment {
  fraction: number;
  color: typeof BLUE | typeof PURPLE | typeof YELLOW | typeof RED;
  restPoint?: { coords: [number, number] };
}

export interface DriveSegmentsResult {
  gradientStops: Array<{ fraction: number; color: string }>;
  restPoints: Array<{ coords: [number, number]; restHours: 9 | 11 }>;
}

type DriveMilestoneKind = 'first_period' | 'second_period' | 'extension' | 'rest';

export interface TrafficDelay {
  distM: number;
  delayMin: number;
}

export interface HosConfig {
  dailyLimitH: number;
  reducedRestsRemaining: number;
  dailyDrivenSeconds?: number;
}

function clampFraction(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function stepsForRoute(route: RouteResult): RouteStep[] {
  if (route.steps.length > 0) return route.steps;
  return [{
    maneuver: { instruction: '', type: 'continue' },
    distance: route.distance,
    duration: route.duration,
    name: '',
    intersections: [],
  }];
}

function truckCappedDurationSeconds(distanceM: number, durationS: number): number {
  const speedCapDurationS = (distanceM / 1000 / TRUCK_SPEED_CAP_KMH) * 3600;
  return Math.max(0, durationS, speedCapDurationS);
}

function averageGradeInRange(
  gradeProfile: GradeProfile | null | undefined,
  startFraction: number,
  endFraction: number,
): number {
  const points = gradeProfile?.points;
  if (!points?.length) return 0;
  const start = clampFraction(Math.min(startFraction, endFraction));
  const end = clampFraction(Math.max(startFraction, endFraction));
  const matching = points.filter(point => point.fraction >= start && point.fraction <= end);
  if (!matching.length) return 0;
  return matching.reduce((sum, point) => sum + point.gradePercent, 0) / matching.length;
}

function appendTransition(
  stops: DriveSegmentsResult['gradientStops'],
  fraction: number,
  color: string,
): void {
  const edge = clampFraction(fraction);
  const previous = stops[stops.length - 1];
  if (!previous || previous.color === color) return;

  const beforeEdge = Math.max(previous.fraction, edge - TRANSITION_EPSILON);
  if (beforeEdge > previous.fraction) {
    stops.push({ fraction: beforeEdge, color: previous.color });
  }
  if (edge > stops[stops.length - 1].fraction) {
    stops.push({ fraction: edge, color });
  } else {
    stops[stops.length - 1] = { fraction: edge, color };
  }
}

function coordinateAtFraction(
  coords: [number, number][],
  fraction: number,
): { coords: [number, number] } | null {
  if (coords.length === 0) return null;
  if (coords.length === 1) return { coords: coords[0] };

  const segmentLengths: number[] = [];
  let totalLengthM = 0;
  for (let index = 1; index < coords.length; index += 1) {
    const previous = coords[index - 1];
    const current = coords[index];
    const midLatRad = ((previous[1] + current[1]) / 2) * Math.PI / 180;
    const dx = (current[0] - previous[0]) * 111320 * Math.cos(midLatRad);
    const dy = (current[1] - previous[1]) * 110540;
    const lengthM = Math.sqrt(dx * dx + dy * dy);
    segmentLengths.push(lengthM);
    totalLengthM += lengthM;
  }

  if (totalLengthM <= 0) return { coords: coords[0] };

  const targetLengthM = clampFraction(fraction) * totalLengthM;
  let traversedM = 0;
  for (let index = 0; index < segmentLengths.length; index += 1) {
    const segmentLengthM = segmentLengths[index];
    if (targetLengthM <= traversedM + segmentLengthM || index === segmentLengths.length - 1) {
      const t = segmentLengthM > 0 ? (targetLengthM - traversedM) / segmentLengthM : 0;
      const start = coords[index];
      const end = coords[index + 1];
      return {
        coords: [
          start[0] + (end[0] - start[0]) * t,
          start[1] + (end[1] - start[1]) * t,
        ],
      };
    }
    traversedM += segmentLengthM;
  }

  return { coords: coords[coords.length - 1] };
}

export function calculateDriveSegments(
  route: RouteResult,
  remainingTachoSeconds: number,
  trafficAlerts?: TrafficDelay[] | null,
  hosConfig?: HosConfig | null,
  gradeProfile?: GradeProfile | null,
  isLoaded = false,
): DriveSegmentsResult {
  const totalDistM = route.distance;
  const coords = route.geometry.coordinates;
  if (totalDistM <= 0 || coords.length === 0) {
    return { gradientStops: [], restPoints: [] };
  }

  const gradientStops: DriveSegmentsResult['gradientStops'] = [{ fraction: 0, color: BLUE }];
  const restPoints: DriveSegmentsResult['restPoints'] = [];
  void trafficAlerts;
  const dailyLimitH = Number.isFinite(hosConfig?.dailyLimitH)
    ? Math.max(0, hosConfig?.dailyLimitH ?? 9)
    : 9;
  const dailyLimitS = dailyLimitH * 3600;
  const dailyDrivenS = Number.isFinite(hosConfig?.dailyDrivenSeconds)
    ? Math.max(0, hosConfig?.dailyDrivenSeconds ?? 0)
    : 0;
  let reducedRestsRemaining = Number.isFinite(hosConfig?.reducedRestsRemaining)
    ? Math.max(0, hosConfig?.reducedRestsRemaining ?? 0)
    : 0;
  let currentColor = BLUE;
  const remainingDailyS = Math.max(0, dailyLimitS - dailyDrivenS);
  let bluePeriodS = Math.max(0, Math.min(DRIVE_PERIOD_S, remainingTachoSeconds, remainingDailyS));
  let purplePeriodS = Math.max(0, Math.min(DRIVE_PERIOD_S, remainingDailyS - bluePeriodS));
  let extendedPeriodS = Math.max(0, remainingDailyS - bluePeriodS - purplePeriodS);
  let elapsedCycleS = 0;
  let phase: 'blue' | 'purple' | 'yellow' = 'blue';
  let cumulativeDistM = 0;

  for (const step of stepsForRoute(route)) {
    const stepDistM = Math.max(0, step.distance ?? 0);
    const stepStartM = cumulativeDistM;
    const stepEndM = stepStartM + stepDistM;
    let chunkDistM = stepDistM;
    // TomTom step ETA already includes traffic. The floor prevents a truck
    // period from covering more than 405 km even if upstream ETA is too fast.
    let chunkDurationS = truckCappedDurationSeconds(stepDistM, step.duration ?? 0);
    const avgGrade = averageGradeInRange(
      gradeProfile,
      stepStartM / totalDistM,
      stepEndM / totalDistM,
    );
    chunkDurationS *= gradeMultiplier(avgGrade, isLoaded);
    let stepCursorM = stepStartM;

    while (chunkDurationS > 0) {
      const thresholdS =
        phase === 'blue'
          ? bluePeriodS
          : phase === 'purple'
            ? bluePeriodS + purplePeriodS
            : bluePeriodS + purplePeriodS + extendedPeriodS;
      const untilThresholdS = Math.max(0, thresholdS - elapsedCycleS);

      if (chunkDurationS < untilThresholdS || untilThresholdS === Infinity) {
        elapsedCycleS += chunkDurationS;
        stepCursorM += chunkDistM;
        break;
      }

      const chunkFraction = chunkDurationS > 0 ? untilThresholdS / chunkDurationS : 0;
      stepCursorM += chunkDistM * chunkFraction;
      chunkDistM *= 1 - chunkFraction;
      chunkDurationS -= untilThresholdS;
      elapsedCycleS += untilThresholdS;
      const routeFraction = clampFraction(stepCursorM / totalDistM);

      if (phase === 'blue') {
        currentColor = PURPLE;
        appendTransition(gradientStops, routeFraction, currentColor);
        phase = 'purple';
        continue;
      }

      if (phase === 'purple' && extendedPeriodS > 0) {
        currentColor = YELLOW;
        appendTransition(gradientStops, routeFraction, currentColor);
        phase = 'yellow';
        continue;
      }

      currentColor = RED;
      appendTransition(gradientStops, routeFraction, currentColor);
      const restPoint = coordinateAtFraction(coords, routeFraction);
      if (restPoint) {
        const previousRest = restPoints[restPoints.length - 1];
        if (
          !previousRest ||
          previousRest.coords[0] !== restPoint.coords[0] ||
          previousRest.coords[1] !== restPoint.coords[1]
        ) {
          const restHours = reducedRestsRemaining > 0 ? 9 : 11;
          restPoints.push({ coords: restPoint.coords, restHours });
          if (restHours === 9) reducedRestsRemaining -= 1;
        }
      }

      currentColor = BLUE;
      appendTransition(gradientStops, Math.min(1, routeFraction + REST_MARKER_EPSILON), currentColor);
      bluePeriodS = DRIVE_PERIOD_S;
      purplePeriodS = Math.max(0, Math.min(DRIVE_PERIOD_S, dailyLimitS - bluePeriodS));
      extendedPeriodS = 0;
      elapsedCycleS = 0;
      phase = 'blue';
    }

    cumulativeDistM = stepEndM;
  }

  const lastStop = gradientStops[gradientStops.length - 1];
  if (lastStop.fraction < 1) {
    gradientStops.push({ fraction: 1, color: currentColor });
  }

  return { gradientStops, restPoints };
}

function milestoneForTransition(
  previousColor: string | null,
  nextColor: string,
): { kind: DriveMilestoneKind; label: string; color: string; halo: string } | null {
  if (nextColor === PURPLE) {
    return { kind: 'first_period', label: '4.5h', color: PURPLE, halo: '#13D9FF' };
  }
  if (nextColor === YELLOW) {
    return { kind: 'second_period', label: '9h', color: YELLOW, halo: '#7B61FF' };
  }
  if (nextColor === RED) {
    return previousColor === YELLOW
      ? { kind: 'extension', label: '+1h', color: RED, halo: '#F1C40F' }
      : { kind: 'rest', label: 'REST', color: RED, halo: '#FF9500' };
  }
  return null;
}

export function buildDriveMilestonesGeoJSON(
  route: RouteResult | null,
  driveSegments: DriveSegmentsResult | null | undefined,
): GeoJSON.FeatureCollection {
  const coords = route?.geometry.coordinates ?? [];
  const stops = driveSegments?.gradientStops ?? [];
  if (coords.length < 2 || stops.length < 2) {
    return { type: 'FeatureCollection', features: [] };
  }

  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  let previousDistinctColor: string | null = stops[0]?.color ?? null;
  let lastMilestoneFraction = -Infinity;

  for (let index = 1; index < stops.length; index += 1) {
    const stop = stops[index];
    if (stop.color === previousDistinctColor) continue;

    const milestone = milestoneForTransition(previousDistinctColor, stop.color);
    previousDistinctColor = stop.color;
    if (!milestone) continue;

    const fraction = clampFraction(stop.fraction);
    if (fraction <= 0.001 || fraction >= 0.999) continue;
    if (Math.abs(fraction - lastMilestoneFraction) < 0.002) continue;

    const point = coordinateAtFraction(coords, fraction);
    if (!point) continue;
    lastMilestoneFraction = fraction;

    features.push({
      type: 'Feature',
      id: `drive-milestone-${features.length}`,
      properties: {
        kind: milestone.kind,
        label: milestone.label,
        color: milestone.color,
        halo: milestone.halo,
        fraction,
      },
      geometry: { type: 'Point', coordinates: point.coords },
    });
  }

  return { type: 'FeatureCollection', features };
}
