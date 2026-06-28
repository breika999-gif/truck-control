import { useEffect, useRef, useState } from 'react';

type Coordinate = [number, number];

interface GPSPoint {
  coords: Coordinate;
  timestamp: number;
  vx: number;
  vy: number;
}

function isFiniteCoord(coords: Coordinate | null): coords is Coordinate {
  return (
    Array.isArray(coords) &&
    coords.length === 2 &&
    Number.isFinite(coords[0]) &&
    Number.isFinite(coords[1])
  );
}

export function useLocationInterpolator(
  rawCoords: Coordinate | null,
  speed: number | null,
  heading: number | null,
): Coordinate | null {
  const lastGPS = useRef<GPSPoint | null>(null);
  const interpolated = useRef<Coordinate | null>(null);
  const [renderCoords, setRenderCoords] = useState<Coordinate | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isFiniteCoord(rawCoords)) {
      lastGPS.current = null;
      interpolated.current = null;
      setRenderCoords(null);
      return;
    }

    const now = Date.now();
    const previous = lastGPS.current;
    const isMoving = speed != null && speed > 0;
    let vx = 0;
    let vy = 0;

    if (previous && isMoving) {
      const dt = Math.max(1, now - previous.timestamp);
      vx = (rawCoords[0] - previous.coords[0]) / dt;
      vy = (rawCoords[1] - previous.coords[1]) / dt;
    }

    lastGPS.current = {
      coords: rawCoords,
      timestamp: now,
      vx,
      vy,
    };
    interpolated.current = rawCoords;
    setRenderCoords(rawCoords);
  }, [rawCoords, speed, heading]);

  useEffect(() => {
    const MIN_DELTA = 0.000005; // ~0.5m — skip setState if barely moved
    const tick = () => {
      if (lastGPS.current) {
        const elapsed = Date.now() - lastGPS.current.timestamp;
        const safeElapsed = Math.min(elapsed, 2000);
        const lng = lastGPS.current.coords[0] + lastGPS.current.vx * safeElapsed;
        const lat = lastGPS.current.coords[1] + lastGPS.current.vy * safeElapsed;
        const prev = interpolated.current;
        if (
          !prev ||
          Math.abs(lng - prev[0]) > MIN_DELTA ||
          Math.abs(lat - prev[1]) > MIN_DELTA
        ) {
          interpolated.current = [lng, lat];
          setRenderCoords(interpolated.current);
        }
      }
    };

    const loop = () => {
      tick();
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return renderCoords;
}
