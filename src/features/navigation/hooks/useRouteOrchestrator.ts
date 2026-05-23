import { useRef, useEffect, useCallback, type MutableRefObject } from 'react';

import type * as GeoJSON from 'geojson';

import { MAP_CENTER } from '../../../shared/constants/config';
import type { VehicleProfile } from '../../../shared/types/vehicle';
import {
  fetchRoute,
  adrToExclude,
  optimizeWaypointOrder,
  type RouteResult,
} from '../api/directions';
import { haversineMeters } from '../utils/mapUtils';
import type { NavPhase } from './useNavigationState';
import { fetchCamerasAlongRoute } from '../../../shared/services/backendApi';
import type { POICard, RouteOption } from '../../../shared/services/backendApi';

export type Coords = [number, number];
type RouteCameraSignature = { key: string; checkpoints: Coords[] };

const CAMERA_FETCH_DEBOUNCE_MS = 1200;
const CAMERA_FETCH_PREVIEW_DEBOUNCE_MS = 350;
const CAMERA_REFRESH_TOLERANCE_M = 120;
const MAX_CAMERA_CACHE_ROUTES = 8;

function routeCheckpointIndices(length: number): number[] {
  if (length <= 1) return [0];
  const fractions = [0, 0.2, 0.4, 0.6, 0.8, 1];
  const seen = new Set<number>();
  return fractions
    .map(f => Math.min(length - 1, Math.max(0, Math.round((length - 1) * f))))
    .filter(idx => {
      if (seen.has(idx)) return false;
      seen.add(idx);
      return true;
    });
}

function buildRouteCameraSignature(coords: Coords[]): RouteCameraSignature {
  const checkpoints = routeCheckpointIndices(coords.length).map(idx => coords[idx]);
  const key = checkpoints
    .map(([lng, lat]) => `${lng.toFixed(4)},${lat.toFixed(4)}`)
    .join('|');
  return { key, checkpoints };
}

function routeOptionSignature(option: RouteOption): string {
  const coords = option.geometry.coordinates as Coords[];
  if (!coords.length) return `${Math.round(option.distance)}|${Math.round(option.duration)}`;
  const first = coords[0];
  const mid = coords[Math.floor(coords.length / 2)];
  const last = coords[coords.length - 1];
  const checkpoints = [first, mid, last]
    .map(([lng, lat]) => `${lng.toFixed(3)},${lat.toFixed(3)}`)
    .join('|');
  return `${Math.round(option.distance / 1000)}|${Math.round(option.duration / 60)}|${checkpoints}`;
}

function nearestPointDistanceMeters(point: Coords, coords: Coords[]): number {
  let nearest = Infinity;
  for (const coord of coords) {
    const d = haversineMeters(point, coord);
    if (d < nearest) nearest = d;
  }
  return nearest;
}

function routesAreVisuallySame(a: RouteOption, b: RouteOption): boolean {
  const aCoords = a.geometry.coordinates as Coords[];
  const bCoords = b.geometry.coordinates as Coords[];
  if (aCoords.length < 2 || bCoords.length < 2) return false;

  const sampleCount = Math.min(10, aCoords.length);
  let total = 0;
  let max = 0;
  for (let i = 0; i < sampleCount; i++) {
    const idx = Math.round((i / Math.max(1, sampleCount - 1)) * (aCoords.length - 1));
    const d = nearestPointDistanceMeters(aCoords[idx], bCoords);
    total += d;
    max = Math.max(max, d);
  }
  return total / sampleCount < 80 && max < 220;
}

function sameRouteOption(a: RouteOption, b: RouteOption): boolean {
  if (routeOptionSignature(a) === routeOptionSignature(b)) return true;
  return routesAreVisuallySame(a, b) && routesAreVisuallySame(b, a);
}

function hasSubstantialRouteChange(
  prev: RouteCameraSignature | null,
  next: RouteCameraSignature,
): boolean {
  if (!prev) return true;
  if (prev.key === next.key) return false;
  if (prev.checkpoints.length !== next.checkpoints.length) return true;

  return next.checkpoints.some((coord, idx) => haversineMeters(coord, prev.checkpoints[idx]) > CAMERA_REFRESH_TOLERANCE_M);
}

type UseRouteOrchestratorProps = {
  isMountedRef: MutableRefObject<boolean>;
  navigatingRef: MutableRefObject<boolean>;
  routeRef: MutableRefObject<RouteResult | null>;
  profileRef: MutableRefObject<VehicleProfile | null>;
  userCoordsRef: MutableRefObject<Coords | null>;
  cameraRef: MutableRefObject<any>;
  profile: VehicleProfile | null;
  departAt: string | null;
  avoidUnpaved: boolean;
  waypoints: Coords[];
  waypointNames: string[];
  buildRoutePOIScan: (r: RouteResult) => void;
  setCameraResults: (cameras: POICard[]) => void;
  setRoute: (route: RouteResult | null) => void;
  setNavPhase: (phase: NavPhase) => void;
  setCurrentStep: (step: number) => void;
  setSpeedLimit: (limit: number | null) => void;
  setDistToTurn: (dist: number | null) => void;
  setNavCongestionGeoJSON: (geojson: GeoJSON.FeatureCollection | null) => void;
  setWaypoints: (waypoints: Coords[]) => void;
  setWaypointNames: (names: string[]) => void;
  setRouteOptions: (opts: import('../../../shared/services/backendApi').RouteOption[]) => void;
  setRouteOptDest: (dest: import('../hooks/useNavigationState').RouteOptDest | null) => void;
  setBackendOnline: (online: boolean) => void;
};

export function useRouteOrchestrator({
  isMountedRef,
  navigatingRef,
  profileRef,
  userCoordsRef,
  cameraRef,
  profile,
  departAt,
  avoidUnpaved,
  waypoints,
  waypointNames,
  buildRoutePOIScan,
  setCameraResults,
  setRoute,
  setNavPhase,
  setCurrentStep,
  setSpeedLimit,
  setDistToTurn,
  setNavCongestionGeoJSON,
  setWaypoints,
  setWaypointNames,
  setRouteOptions,
  setRouteOptDest,
  setBackendOnline,
}: UseRouteOrchestratorProps) {
  const customOriginRef = useRef<Coords | null>(null);
  const handleStartRef = useRef<() => void>(() => {});
  const destinationRef = useRef<Coords | null>(null);
  const destinationNameRef = useRef('');
  const departAtRef = useRef<string | null>(null);
  const avoidUnpavedRef = useRef(false);
  const waypointsRef = useRef<Coords[]>([]);
  const waypointNamesRef = useRef<string[]>([]);
  const lastRerouteRef = useRef<number>(0);
  const profileRerouteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navStartRef = useRef<number>(0);
  const navInitDurationRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const cameraFetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cameraAbortControllerRef = useRef<AbortController | null>(null);
  const cameraCacheRef = useRef<Map<string, POICard[]>>(new Map());
  const lastCameraSignatureRef = useRef<RouteCameraSignature | null>(null);
  const refreshRouteCamerasRef = useRef<(routeCoords: Coords[]) => void>(() => {});

  const setDestination = useCallback((dest: Coords | null) => {
    destinationRef.current = dest;
  }, []);

  const setDestinationName = useCallback((name: string) => {
    destinationNameRef.current = name;
  }, []);

  useEffect(() => { departAtRef.current = departAt; }, [departAt]);
  useEffect(() => { avoidUnpavedRef.current = avoidUnpaved; }, [avoidUnpaved]);
  useEffect(() => { waypointsRef.current = waypoints; }, [waypoints]);
  useEffect(() => { waypointNamesRef.current = waypointNames; }, [waypointNames]);
  useEffect(() => () => {
    if (profileRerouteTimer.current) clearTimeout(profileRerouteTimer.current);
    if (cameraFetchTimerRef.current) clearTimeout(cameraFetchTimerRef.current);
    cameraAbortControllerRef.current?.abort();
  }, []);

  const rememberCameraCache = useCallback((key: string, cameras: POICard[]) => {
    const cache = cameraCacheRef.current;
    cache.delete(key);
    cache.set(key, cameras);
    while (cache.size > MAX_CAMERA_CACHE_ROUTES) {
      const oldestKey = cache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      cache.delete(oldestKey);
    }
  }, []);

  const refreshRouteCameras = useCallback((routeCoords: Coords[]) => {
    if (!routeCoords.length) return;

    const nextSignature = buildRouteCameraSignature(routeCoords);
    if (!hasSubstantialRouteChange(lastCameraSignatureRef.current, nextSignature)) {
      return;
    }
    lastCameraSignatureRef.current = nextSignature;

    if (cameraFetchTimerRef.current) clearTimeout(cameraFetchTimerRef.current);
    cameraAbortControllerRef.current?.abort();

    const cached = cameraCacheRef.current.get(nextSignature.key);
    if (cached) {
      setCameraResults(cached);
      return;
    }

    cameraFetchTimerRef.current = setTimeout(() => {
      const controller = new AbortController();
      cameraAbortControllerRef.current = controller;

      fetchCamerasAlongRoute(routeCoords, controller.signal)
        .then(cameras => {
          if (!isMountedRef.current) return;
          rememberCameraCache(nextSignature.key, cameras);
          setCameraResults(cameras);
        })
        .catch(err => {
          if (err instanceof Error && err.name === 'AbortError') return;
        })
        .finally(() => {
          if (cameraAbortControllerRef.current === controller) {
            cameraAbortControllerRef.current = null;
          }
        });
    }, navigatingRef.current ? CAMERA_FETCH_DEBOUNCE_MS : CAMERA_FETCH_PREVIEW_DEBOUNCE_MS);
  }, [isMountedRef, navigatingRef, rememberCameraCache, setCameraResults]);
  useEffect(() => {
    refreshRouteCamerasRef.current = refreshRouteCameras;
  }, [refreshRouteCameras]);

  // Profile change WHILE navigating → debounced re-route (800 ms).
  // CRITICAL: deps = [profile] only — navigating must NOT be a dep.
  // If navigating were in deps, pressing "Тръгваме" would trigger this effect,
  // fire navigateTo() after 800 ms, which would set navPhase to REROUTING — correct behaviour.
  useEffect(() => {
    if (!navigatingRef.current || !destinationRef.current) return;
    if (profileRerouteTimer.current) clearTimeout(profileRerouteTimer.current);
    profileRerouteTimer.current = setTimeout(() => {
      if (navigatingRef.current && destinationRef.current) {
        navigateTo(destinationRef.current, destinationNameRef.current, waypointsRef.current);
      }
    }, 800);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  // Shared route-to helper
  // Single source of truth for fetching a route and fitting the camera.
  // All data read via refs → deps:[] → stable identity across renders.
  // isMountedRef guard prevents setState after component unmounts.
  const navigateTo = useCallback(async (
    dest: Coords,
    name: string,
    waypointsArg?: Coords[],
    autoStart = false,
    optimizeWaypoints = false,
  ) => {
    // Cancel previous POI fetches if any
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const { signal } = abortControllerRef.current;

    setDestination(dest);
    setDestinationName(name);
    setRoute(null);
    setCurrentStep(0);
    setSpeedLimit(null);
    setDistToTurn(null);

    // NAVIGATING → REROUTING; otherwise → SEARCHING
    setNavPhase(navigatingRef.current ? 'REROUTING' : 'SEARCHING');

    // Origin priority: custom (manually set) > GPS > fallback centre
    const origin: Coords =
      customOriginRef.current ??
      userCoordsRef.current ??
      [MAP_CENTER.longitude, MAP_CENTER.latitude];
    try {
      const prof = profileRef.current;
      const truck = prof
        ? {
            max_height: prof.height_m,
            max_width: prof.width_m,
            max_weight: prof.weight_t,
            max_length: prof.length_m,
            exclude: adrToExclude(prof.hazmat_class ?? 'none'),
            hazmat_class: prof.hazmat_class ?? 'none',
            avoidUnpaved: avoidUnpavedRef.current,
            adr_tunnel: prof.adr_tunnel ?? 'none',
          }
        : avoidUnpavedRef.current
          ? { avoidUnpaved: true, adr_tunnel: 'none' as const }
          : undefined;

      const result = await fetchRoute(
        origin,
        dest,
        truck,
        departAtRef.current ?? undefined,
        waypointsArg,
        signal,
        optimizeWaypoints,
      );
      if (!isMountedRef.current) return; // unmount guard

      setBackendOnline(!!result);

      // Apply TomTom's optimal waypoint order if requested
      if (optimizeWaypoints && result?.optimizedWaypointOrder && waypointsArg) {
        const order = result.optimizedWaypointOrder;
        const reorderedWps = order.map(i => waypointsArg[i]).filter(Boolean) as Coords[];
        const names = waypointNamesRef.current;
        const reorderedNames = order.map(i => names[i] ?? '');
        setWaypoints(reorderedWps);
        setWaypointNames(reorderedNames);
        waypointsRef.current = reorderedWps;
      }

      setRoute(result);
      // Sync congestion colors for direct navigation (fixes missing traffic colors bug)
      setNavCongestionGeoJSON(result?.congestionGeoJSON ?? null);

      // Show RouteOptionsPanel during preview even when the backend returns only the primary route.
      if (result && !navigatingRef.current) {
        const primary: RouteOption = {
          label: 'Най-бърз',
          color: '#13BDFF',
          duration: result.duration,
          distance: result.distance,
          traffic: 'low',
          geometry: result.geometry,
          dest_coords: dest,
          steps: result.steps,
          maxspeeds: result.maxspeeds,
          restrictions: result.restrictions,
          traffic_alerts: result.traffic_alerts,
          congestion_geojson: result.congestionGeoJSON as any,
        };
        const alternatives = (result.alternatives ?? [])
          .filter(opt => !sameRouteOption(primary, opt));
        setRouteOptions([primary, ...alternatives]);
        setRouteOptDest({ name: destinationNameRef.current, coords: dest, waypoints: waypointsArg });
      } else if (!navigatingRef.current) {
        setRouteOptions([]);
      }

      if (result) {
        buildRoutePOIScan(result);
        const routeCoords = result.geometry.coordinates as [number, number][];

        // Safety POIs track meaningful route changes only.
        refreshRouteCamerasRef.current(routeCoords);

        const coords = result.geometry.coordinates;
        let minLng = coords[0][0], maxLng = coords[0][0];
        let minLat = coords[0][1], maxLat = coords[0][1];
        for (let i = 1; i < coords.length; i++) {
          if (coords[i][0] < minLng) minLng = coords[i][0];
          if (coords[i][0] > maxLng) maxLng = coords[i][0];
          if (coords[i][1] < minLat) minLat = coords[i][1];
          if (coords[i][1] > maxLat) maxLat = coords[i][1];
        }

        // Only fit bounds if we are NOT navigating.
        // During navigation, the StableCamera followUserLocation takes over.
        if (!navigatingRef.current && !autoStart) {
          cameraRef.current?.fitToCoordinates(
            [{ latitude: minLat, longitude: minLng }, { latitude: maxLat, longitude: maxLng }],
            { edgePadding: { top: 120, right: 40, bottom: 220, left: 40 }, animated: true },
          );
        }

        if (autoStart) {
          handleStartRef.current();
        }
      } else {
        if (!navigatingRef.current) cameraRef.current?.animateToRegion({ latitude: dest[1], longitude: dest[0], latitudeDelta: 0.05, longitudeDelta: 0.05 }, 800);
      }
    } catch {
      setBackendOnline(false);
      if (!navigatingRef.current) cameraRef.current?.animateToRegion({ latitude: dest[1], longitude: dest[0], latitudeDelta: 0.05, longitudeDelta: 0.05 }, 800);
    } finally {
      // REROUTING → NAVIGATING; SEARCHING → ROUTE_PREVIEW
      if (isMountedRef.current) {
        setNavPhase((navigatingRef.current || autoStart) ? 'NAVIGATING' : 'ROUTE_PREVIEW');
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // stable — reads everything via refs; handleStart accessed via handleStartRef

  // Add intermediate waypoint + re-route
  // Appends a stop before the final destination and recalculates the route.
  const addWaypoint = useCallback(async (coord: Coords, name: string) => {
    const appended = [...waypointsRef.current, coord];
    const appendedNames = [...waypointNamesRef.current, name];

    // Auto-optimize order when there are 2+ waypoints (nearest-neighbour TSP)
    const origin: Coords = userCoordsRef.current ?? [MAP_CENTER.longitude, MAP_CENTER.latitude];
    const optimized = appended.length >= 2 ? optimizeWaypointOrder(origin, appended) : appended;

    // Sync names to match the optimized order
    const nameMap = new Map(appended.map((wp, i) => [`${wp[0]},${wp[1]}`, appendedNames[i]]));
    const optimizedNames = optimized.map(wp => nameMap.get(`${wp[0]},${wp[1]}`) ?? '');

    setWaypoints(optimized);
    setWaypointNames(optimizedNames);
    // Immediate ref update so re-route picks up the new list even if state
    // hasn't propagated yet (React batching).
    waypointsRef.current = optimized;
    waypointNamesRef.current = optimizedNames;
    const dest = destinationRef.current;
    if (dest) await navigateTo(dest, destinationNameRef.current, optimized);
  }, [navigateTo, setWaypointNames, setWaypoints, userCoordsRef]);

  return {
    navigateTo,
    addWaypoint,
    handleStartRef,
    customOriginRef,
    destinationRef,
    destinationNameRef,
    setDestination,
    setDestinationName,
    departAtRef,
    waypointsRef,
    waypointNamesRef,
    navStartRef,
    navInitDurationRef,
    lastRerouteRef,
    avoidUnpavedRef,
  };
}
