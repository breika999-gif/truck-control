import { useEffect, useRef, useCallback, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { RouteResult } from '../api/directions';
import { fetchRoute, adrToExclude } from '../api/directions';
import type { VehicleProfile } from '../../../shared/types/vehicle';

type Coords = [number, number];

export interface FasterRouteOffer {
  route: RouteResult;
  saveMin: number;
}

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MIN_SAVE_SECONDS  = 120;           // 2 minutes minimum saving
const SNOOZE_MS         = 10 * 60 * 1000; // 10 min snooze after dismiss

interface Args {
  navigating: boolean;
  userCoordsRef: MutableRefObject<Coords | null>;
  destinationRef: MutableRefObject<Coords | null>;
  routeRef: MutableRefObject<RouteResult | null>;
  profileRef: MutableRefObject<VehicleProfile | null>;
  avoidUnpavedRef: MutableRefObject<boolean>;
  waypointsRef: MutableRefObject<Coords[]>;
  remainingSeconds: number;
}

export function useFasterRouteCheck({
  navigating,
  userCoordsRef,
  destinationRef,
  routeRef,
  profileRef,
  avoidUnpavedRef,
  waypointsRef,
  remainingSeconds,
}: Args) {
  const [offer, setOffer] = useState<FasterRouteOffer | null>(null);
  const remainingRef  = useRef(remainingSeconds);
  const snoozeUntil   = useRef(0);
  const intervalRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { remainingRef.current = remainingSeconds; }, [remainingSeconds]);

  const check = useCallback(async () => {
    if (Date.now() < snoozeUntil.current) return;
    const origin = userCoordsRef.current;
    const dest   = destinationRef.current;
    if (!origin || !dest || !routeRef.current) return;

    const prof = profileRef.current;
    const truck = prof
      ? {
          max_height:  prof.height_m,
          max_width:   prof.width_m,
          max_weight:  prof.weight_t,
          max_length:  prof.length_m,
          exclude:     adrToExclude(prof.hazmat_class ?? 'none'),
          avoidUnpaved: avoidUnpavedRef.current,
          adr_tunnel:  prof.adr_tunnel ?? 'none' as const,
        }
      : avoidUnpavedRef.current ? { avoidUnpaved: true, adr_tunnel: 'none' as const } : undefined;

    try {
      const result = await fetchRoute(origin, dest, truck, undefined, waypointsRef.current);
      if (!result) return;

      const currentRemaining = remainingRef.current;
      const saving = currentRemaining - result.duration;
      if (saving >= MIN_SAVE_SECONDS) {
        setOffer({ route: result, saveMin: Math.round(saving / 60) });
      }
    } catch {
      // silent — don't interrupt navigation
    }
  }, [userCoordsRef, destinationRef, routeRef, profileRef, avoidUnpavedRef, waypointsRef]);

  // Start/stop interval based on navigating state
  useEffect(() => {
    if (!navigating) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      setOffer(null);
      return;
    }
    // Run first check after 3 min (let user settle into route first)
    const firstCheck = setTimeout(check, 3 * 60 * 1000);
    intervalRef.current = setInterval(check, CHECK_INTERVAL_MS);
    return () => {
      clearTimeout(firstCheck);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [navigating, check]);

  const acceptOffer = useCallback(() => {
    setOffer(null);
  }, []);

  const dismissOffer = useCallback(() => {
    snoozeUntil.current = Date.now() + SNOOZE_MS;
    setOffer(null);
  }, []);

  return { offer, acceptOffer, dismissOffer };
}
