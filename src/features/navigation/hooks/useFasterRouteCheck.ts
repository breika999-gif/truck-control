import { useEffect, useRef, useCallback, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { RouteResult } from '../api/directions';
import { fetchRoute, adrToExclude } from '../api/directions';
import type { VehicleProfile } from '../../../shared/types/vehicle';
import type { Coords } from './useRouteOrchestrator';

export interface FasterRouteOffer {
  route: RouteResult;
  saveMin: number;
}

/** Show banner only if saving ≥ 7 minutes */
const MIN_SAVE_SECONDS = 7 * 60;

/** Speed must stay below 50% of limit for this long before we check */
const SLOW_THRESHOLD_MS = 120_000; // 2 minutes

/** After dismissing, snooze for 10 minutes */
const SNOOZE_MS = 10 * 60_000;

/** Periodic check interval during navigation */
const PERIODIC_CHECK_MS = 5 * 60_000; // every 5 minutes

/** Stop checking when estimated remaining distance is below this threshold */
const NEAR_DEST_M = 25_000; // 25 km

interface Args {
  navigating: boolean;
  userCoordsRef: MutableRefObject<Coords | null>;
  destinationRef: MutableRefObject<Coords | null>;
  routeRef: MutableRefObject<RouteResult | null>;
  profileRef: MutableRefObject<VehicleProfile | null>;
  avoidUnpavedRef: MutableRefObject<boolean>;
  waypointsRef: MutableRefObject<Coords[]>;
  remainingSeconds: number;
  speed: number;           // km/h, from GPS
  speedLimit: number | null; // km/h, from route maxspeeds
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
  speed,
  speedLimit,
}: Args) {
  const [offer, setOffer]     = useState<FasterRouteOffer | null>(null);
  const remainingRef          = useRef(remainingSeconds);
  const slowSinceRef          = useRef<number | null>(null);
  const checkingRef           = useRef(false);
  const snoozeUntil           = useRef(0);
  const periodicTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { remainingRef.current = remainingSeconds; }, [remainingSeconds]);

  /** Estimated remaining distance in meters based on route progress */
  const estimateRemainingM = useCallback((): number => {
    const r = routeRef.current;
    if (!r || r.duration <= 0) return Infinity;
    return (remainingRef.current / r.duration) * r.distance;
  }, [routeRef]);

  const check = useCallback(async () => {
    if (checkingRef.current) return;
    if (Date.now() < snoozeUntil.current) return;
    if (estimateRemainingM() <= NEAR_DEST_M) return; // too close to destination
    const origin = userCoordsRef.current;
    const dest   = destinationRef.current;
    if (!origin || !dest || !routeRef.current) return;

    checkingRef.current = true;
    try {
      const prof = profileRef.current;
      const truck = prof
        ? {
            max_height:   prof.height_m,
            max_width:    prof.width_m,
            max_weight:   prof.weight_t,
            max_length:   prof.length_m,
            exclude:      adrToExclude(prof.hazmat_class ?? 'none'),
            avoidUnpaved: avoidUnpavedRef.current,
            adr_tunnel:   prof.adr_tunnel ?? 'none' as const,
          }
        : avoidUnpavedRef.current
          ? { avoidUnpaved: true, adr_tunnel: 'none' as const }
          : undefined;

      const result = await fetchRoute(origin, dest, truck, undefined, waypointsRef.current);
      if (!result) return;

      const saving = remainingRef.current - result.duration;
      if (saving >= MIN_SAVE_SECONDS) {
        setOffer({ route: result, saveMin: Math.round(saving / 60) });
      }
    } catch {
      // silent — don't interrupt navigation
    } finally {
      checkingRef.current = false;
    }
  }, [userCoordsRef, destinationRef, routeRef, profileRef, avoidUnpavedRef, waypointsRef, estimateRemainingM]);

  // Speed-based trigger: if speed < 50% of limit for 120s → check for faster route
  useEffect(() => {
    if (!navigating || speedLimit === null || speedLimit <= 0) {
      slowSinceRef.current = null;
      return;
    }

    const threshold = speedLimit * 0.5;

    if (speed < threshold) {
      if (slowSinceRef.current === null) {
        slowSinceRef.current = Date.now();
      } else if (Date.now() - slowSinceRef.current >= SLOW_THRESHOLD_MS) {
        slowSinceRef.current = null; // reset timer
        check();
      }
    } else {
      // Speed recovered — reset timer
      slowSinceRef.current = null;
    }
  }, [speed, speedLimit, navigating, check]);

  // Periodic 5-minute check — skipped automatically when near destination
  useEffect(() => {
    if (!navigating) return;

    const schedule = () => {
      periodicTimerRef.current = setTimeout(async () => {
        await check();
        schedule(); // reschedule after each check
      }, PERIODIC_CHECK_MS);
    };

    schedule();
    return () => {
      if (periodicTimerRef.current) clearTimeout(periodicTimerRef.current);
    };
  }, [navigating, check]);

  // Reset when navigation stops
  useEffect(() => {
    if (!navigating) {
      setOffer(null);
      slowSinceRef.current = null;
      if (periodicTimerRef.current) clearTimeout(periodicTimerRef.current);
    }
  }, [navigating]);

  const acceptOffer = useCallback(() => setOffer(null), []);

  const dismissOffer = useCallback(() => {
    snoozeUntil.current = Date.now() + SNOOZE_MS;
    setOffer(null);
  }, []);

  return { offer, acceptOffer, dismissOffer };
}
