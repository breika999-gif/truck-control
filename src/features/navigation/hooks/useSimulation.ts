import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import {
  getCurrentStepIndex,
  getSpeedLimitAtPosition,
  type RouteResult,
} from '../api/directions';
import { cumulativeRouteDistances, haversineMeters } from '../utils/mapUtils';

type Coord = [number, number];

interface UseSimulationParams {
  route: RouteResult | null;
  setUserCoords: Dispatch<SetStateAction<Coord | null>>;
  setSpeed: Dispatch<SetStateAction<number>>;
  setUserHeading: Dispatch<SetStateAction<number | null>>;
  setCurrentStep: Dispatch<SetStateAction<number>>;
  setDistToTurn: Dispatch<SetStateAction<number | null>>;
  setSpeedLimit: Dispatch<SetStateAction<number | null>>;
  setRemainingSeconds: Dispatch<SetStateAction<number>>;
  simulationActiveRef: MutableRefObject<boolean>;
}

const TICK_MS = 500;
const DEFAULT_DEMO_SPEED_KMH = 82;
const DEMO_PROGRESS_MULTIPLIER = 4;

const bearingBetween = (from: Coord, to: Coord) => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const [lon1, lat1] = from.map(toRad) as Coord;
  const [lon2, lat2] = to.map(toRad) as Coord;
  const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);

  return Math.round((toDeg(Math.atan2(y, x)) + 360) % 360);
};

type StepWithSpeedLimit = RouteResult['steps'][number] & {
  speedLimitKmh?: unknown;
  speed_limit_kmh?: unknown;
  speedLimit?: unknown;
};

const normalizeSpeedLimit = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }

  if (typeof value === 'object' && value !== null) {
    const speed = value as { value?: unknown; unit?: unknown; speed?: unknown };
    const raw = typeof speed.value === 'number' ? speed.value : speed.speed;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null;
    const unit = typeof speed.unit === 'string' ? speed.unit.toLowerCase() : 'km/h';
    return unit.includes('mph') ? Math.round(raw * 1.609) : Math.round(raw);
  }

  return null;
};

const speedLimitAt = (
  route: RouteResult,
  stepIdx: number,
  coords: Coord,
): number | null => {
  const step = route.steps[stepIdx] as StepWithSpeedLimit | undefined;
  return (
    normalizeSpeedLimit(step?.speedLimitKmh) ??
    normalizeSpeedLimit(step?.speed_limit_kmh) ??
    normalizeSpeedLimit(step?.speedLimit) ??
    getSpeedLimitAtPosition(route.geometry.coordinates, route.maxspeeds, coords)
  );
};

const pointAtDistance = (
  coords: Coord[],
  cumulative: number[],
  distanceM: number,
  startIndex: number,
): { coord: Coord; segmentIndex: number; next: Coord } => {
  const target = Math.max(0, Math.min(distanceM, cumulative[cumulative.length - 1] ?? 0));
  let segmentIndex = Math.max(0, Math.min(startIndex, coords.length - 2));

  while (segmentIndex < coords.length - 2 && cumulative[segmentIndex + 1] < target) {
    segmentIndex += 1;
  }

  const from = coords[segmentIndex];
  const to = coords[Math.min(segmentIndex + 1, coords.length - 1)];
  const fromM = cumulative[segmentIndex] ?? 0;
  const toM = cumulative[Math.min(segmentIndex + 1, cumulative.length - 1)] ?? fromM;
  const span = Math.max(1, toM - fromM);
  const t = Math.max(0, Math.min(1, (target - fromM) / span));

  return {
    coord: [
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
    ],
    segmentIndex,
    next: to,
  };
};

export const useSimulation = ({
  route,
  setUserCoords,
  setSpeed,
  setUserHeading,
  setCurrentStep,
  setDistToTurn,
  setSpeedLimit,
  setRemainingSeconds,
  simulationActiveRef,
}: UseSimulationParams) => {
  const [simulating, setSimulating] = useState(false);
  const simDistanceRef = useRef(0);
  const simSegmentRef = useRef(0);
  const simIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopSim = useCallback(() => {
    if (simIntervalRef.current) {
      clearInterval(simIntervalRef.current);
      simIntervalRef.current = null;
    }
    simulationActiveRef.current = false;
    simDistanceRef.current = 0;
    simSegmentRef.current = 0;
    setSimulating(false);
    setSpeed(0);
    setUserHeading(null);
  }, [setSpeed, setUserHeading, simulationActiveRef]);

  const startSim = useCallback(() => {
    const activeRoute = route;
    const coords = activeRoute?.geometry.coordinates as Coord[] | undefined;
    if (!activeRoute || !coords || coords.length < 2) return;

    stopSim();
    simulationActiveRef.current = true;
    simDistanceRef.current = 0;
    simSegmentRef.current = 0;
    setSimulating(true);
    setCurrentStep(0);
    setDistToTurn(null);
    setRemainingSeconds(activeRoute.duration);

    const cumulative = cumulativeRouteDistances(coords);
    const totalDistance = cumulative[cumulative.length - 1] || activeRoute.distance || 1;

    const applyFrame = () => {
      const { coord, segmentIndex, next } = pointAtDistance(
        coords,
        cumulative,
        simDistanceRef.current,
        simSegmentRef.current,
      );
      simSegmentRef.current = segmentIndex;

      const stepIdx = getCurrentStepIndex(activeRoute.steps, coord);
      const limit = speedLimitAt(activeRoute, stepIdx, coord);
      const demoSpeed = Math.max(30, Math.min(limit ?? DEFAULT_DEMO_SPEED_KMH, DEFAULT_DEMO_SPEED_KMH));
      const nextLoc = activeRoute.steps[stepIdx + 1]?.intersections?.[0]?.location;
      const progress = Math.max(0, Math.min(1, simDistanceRef.current / totalDistance));

      setUserCoords(coord);
      setSpeed(demoSpeed);
      setUserHeading(bearingBetween(coord, next));
      setCurrentStep(stepIdx);
      setSpeedLimit(limit);
      setDistToTurn(nextLoc ? haversineMeters(coord, nextLoc) : null);
      setRemainingSeconds(Math.max(0, Math.round(activeRoute.duration * (1 - progress))));

      simDistanceRef.current += (demoSpeed * 1000 / 3600) * (TICK_MS / 1000) * DEMO_PROGRESS_MULTIPLIER;
      if (simDistanceRef.current >= totalDistance) {
        stopSim();
        setUserCoords(coords[coords.length - 1]);
        setRemainingSeconds(0);
      }
    };

    applyFrame();

    simIntervalRef.current = setInterval(() => {
      applyFrame();
    }, TICK_MS);
  }, [
    route,
    setCurrentStep,
    setDistToTurn,
    setRemainingSeconds,
    setSpeed,
    setSpeedLimit,
    setUserCoords,
    setUserHeading,
    simulationActiveRef,
    stopSim,
  ]);

  useEffect(() => stopSim, [stopSim]);

  return { simulating, startSim, stopSim };
};
