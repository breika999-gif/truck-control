import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';

import type { RouteResult } from '../api/directions';
import type { NavPhase } from './useNavigationState';
import { haversineMeters, ttsSpeak } from '../utils/mapUtils';

type Coords = [number, number];

interface UseMapTrackingArgs {
  cameraRef: MutableRefObject<any>;
  destination: Coords | null;
  destinationName: string;
  distToTurn: number | null;
  isMapLoaded: boolean;
  navigateTo: (dest: Coords, name: string, waypoints?: Coords[], autoStart?: boolean) => void;
  navigating: boolean;
  navPhase: NavPhase;
  route: RouteResult | null;
  simulating: boolean;
  speed: number;
  userCoords: Coords | null;
  userHeading: number | null;
  voiceMutedRef: MutableRefObject<boolean>;
  waypoints: Coords[];
}

function distanceToRoute(pos: Coords, route: RouteResult): number {
  const coords = route.geometry.coordinates;
  if (!coords || coords.length < 2) return Infinity;
  let nearestIdx = 0;
  let nearestD = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const distance = haversineMeters(pos, [coords[i][0], coords[i][1]]);
    if (distance < nearestD) { nearestD = distance; nearestIdx = i; }
  }

  let minD = Infinity;
  for (let i = Math.max(0, nearestIdx - 1); i <= Math.min(coords.length - 2, nearestIdx + 30); i++) {
    const [ax, ay] = coords[i];
    const [bx, by] = coords[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((pos[0] - ax) * dx + (pos[1] - ay) * dy) / lenSq));
    minD = Math.min(minD, haversineMeters(pos, [ax + t * dx, ay + t * dy]));
  }
  return minD;
}

function bearingAtNearest(pos: Coords, route: RouteResult): number {
  const coords = route.geometry.coordinates;
  let nearestIdx = 0;
  let nearestD = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const distance = haversineMeters(pos, [coords[i][0], coords[i][1]]);
    if (distance < nearestD) { nearestD = distance; nearestIdx = i; }
  }
  const index = Math.min(nearestIdx, coords.length - 2);
  const first = coords[index];
  const second = coords[index + 1];
  const dLon = (second[0] - first[0]) * Math.PI / 180;
  const lat1 = first[1] * Math.PI / 180;
  const lat2 = second[1] * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function useMapTracking({
  cameraRef,
  destination,
  destinationName,
  distToTurn,
  isMapLoaded,
  navigateTo,
  navigating,
  navPhase,
  route,
  simulating,
  speed,
  userCoords,
  userHeading,
  voiceMutedRef,
  waypoints,
}: UseMapTrackingArgs) {
  const [isTracking, setIsTracking] = useState(true);
  const [autoRetrackNonce, setAutoRetrackNonce] = useState(0);
  const [mapPitch, setMapPitch] = useState(0);
  const shouldCenterOnIdleGpsRef = useRef(true);
  const autoRetrackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressPanUntilRef = useRef(0);
  const lastMapTouchAtRef = useRef(0);
  const offRouteCountRef = useRef(0);
  const lastRerouteTimeRef = useRef(0);

  useEffect(() => {
    if (!isMapLoaded || navigating || !isTracking || !userCoords || !shouldCenterOnIdleGpsRef.current) return;
    cameraRef.current?.animateToRegion({
      latitude: userCoords[1],
      longitude: userCoords[0],
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    }, 800);
    shouldCenterOnIdleGpsRef.current = false;
  }, [cameraRef, isMapLoaded, isTracking, navigating, userCoords]);

  const clearAutoRetrackTimer = useCallback(() => {
    if (!autoRetrackTimerRef.current) return;
    clearTimeout(autoRetrackTimerRef.current);
    autoRetrackTimerRef.current = null;
  }, []);

  useEffect(() => {
    clearAutoRetrackTimer();
    if (!navigating || isTracking) return;
    autoRetrackTimerRef.current = setTimeout(() => {
      autoRetrackTimerRef.current = null;
      suppressPanUntilRef.current = Date.now() + 1500;
      setIsTracking(true);
    }, 10_000);
    return clearAutoRetrackTimer;
  }, [autoRetrackNonce, clearAutoRetrackTimer, isTracking, navigating]);
  useEffect(() => clearAutoRetrackTimer, [clearAutoRetrackTimer]);

  useEffect(() => {
    if (!navigating || !route || !destination || !userCoords) {
      offRouteCountRef.current = 0;
      return;
    }
    if (navPhase === 'REROUTING' || navPhase === 'SEARCHING' || simulating) return;
    const distance = distanceToRoute(userCoords, route);
    if (distance > 80 && userHeading !== null) {
      const diff = Math.abs(((userHeading - bearingAtNearest(userCoords, route)) + 360) % 360);
      if ((diff > 180 ? 360 - diff : diff) > 90) return;
    }
    offRouteCountRef.current = distance > 80 ? offRouteCountRef.current + 1 : 0;
    if (offRouteCountRef.current < 3) return;

    const now = Date.now();
    if (now - lastRerouteTimeRef.current < 45_000) return;
    offRouteCountRef.current = 0;
    lastRerouteTimeRef.current = now;
    if (!voiceMutedRef.current) ttsSpeak('Отклонение! Преизчислявам маршрута.');
    navigateTo(destination, destinationName, waypoints, true);
  }, [destination, destinationName, navigateTo, navigating, navPhase, route, simulating, userCoords, userHeading, voiceMutedRef, waypoints]);

  const puckScale = useMemo(() => {
    if (!navigating) return 0.40;
    if (distToTurn != null && distToTurn < 100) return 0.38;
    if (speed > 80) return 0.48;
    return 0.44;
  }, [distToTurn, navigating, speed]);

  return {
    autoRetrackNonce,
    isTracking,
    lastMapTouchAtRef,
    mapPitch,
    puckScale,
    setAutoRetrackNonce,
    setIsTracking,
    setMapPitch,
    shouldCenterOnIdleGpsRef,
    suppressPanUntilRef,
  };
}
