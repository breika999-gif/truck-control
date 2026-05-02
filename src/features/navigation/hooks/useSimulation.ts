import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { RouteResult } from '../api/directions';

type Coord = [number, number];

interface UseSimulationParams {
  route: RouteResult | null;
  setUserCoords: Dispatch<SetStateAction<Coord | null>>;
  setSpeed: Dispatch<SetStateAction<number>>;
  setUserHeading: Dispatch<SetStateAction<number | null>>;
}

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

export const useSimulation = ({
  route,
  setUserCoords,
  setSpeed,
  setUserHeading,
}: UseSimulationParams) => {
  const [simulating, setSimulating] = useState(false);
  const simIndexRef = useRef(0);
  const simIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopSim = useCallback(() => {
    if (simIntervalRef.current) {
      clearInterval(simIntervalRef.current);
      simIntervalRef.current = null;
    }
    simIndexRef.current = 0;
    setSimulating(false);
  }, []);

  const startSim = useCallback(() => {
    const coords = route?.geometry.coordinates;
    if (!coords || coords.length < 2) return;

    stopSim();
    setSimulating(true);

    simIntervalRef.current = setInterval(() => {
      const idx = simIndexRef.current;
      if (idx >= coords.length) {
        stopSim();
        return;
      }

      const pos: Coord = [coords[idx][0], coords[idx][1]];
      const next = coords[Math.min(idx + 1, coords.length - 1)];

      setUserCoords(pos);
      setSpeed(80);
      if (next) setUserHeading(bearingBetween(pos, [next[0], next[1]]));

      simIndexRef.current = idx + 2;
    }, 500);
  }, [route, setSpeed, setUserCoords, setUserHeading, stopSim]);

  useEffect(() => stopSim, [stopSim]);

  return { simulating, startSim, stopSim };
};
