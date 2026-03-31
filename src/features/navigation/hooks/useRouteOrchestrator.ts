import { useRef, useEffect, useCallback, type MutableRefObject } from 'react';
import Mapbox from '@rnmapbox/maps';
import type * as GeoJSON from 'geojson';

import { MAP_CENTER } from '../../../shared/constants/config';
import type { VehicleProfile } from '../../../shared/types/vehicle';
import {
  fetchRoute,
  adrToExclude,
  optimizeWaypointOrder,
  type RouteResult,
} from '../api/directions';
import type { NavPhase } from './useNavigationState';
import { fetchCamerasAlongRoute, fetchPOIsAlongRoute } from '../../../shared/services/backendApi';
import type { POICard } from '../../../shared/services/backendApi';

export type Coords = [number, number];

type UseRouteOrchestratorProps = {
  isMountedRef: MutableRefObject<boolean>;
  navigatingRef: MutableRefObject<boolean>;
  routeRef: MutableRefObject<RouteResult | null>;
  profileRef: MutableRefObject<VehicleProfile | null>;
  userCoordsRef: MutableRefObject<Coords | null>;
  cameraRef: MutableRefObject<Mapbox.Camera | null>;
  profile: VehicleProfile | null;
  destination: Coords | null;
  destinationName: string;
  departAt: string | null;
  avoidUnpaved: boolean;
  waypoints: Coords[];
  waypointNames: string[];
  buildRoutePOIScan: (r: RouteResult) => void;
  setCameraResults: (cameras: POICard[]) => void;
  setParkingResults: (pois: POICard[]) => void;
  setFuelResults: (pois: POICard[]) => void;
  setRoute: (route: RouteResult | null) => void;
  setDestination: (dest: Coords | null) => void;
  setDestinationName: (name: string) => void;
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
  routeRef,
  profileRef,
  userCoordsRef,
  cameraRef,
  profile,
  destination,
  destinationName,
  departAt,
  avoidUnpaved,
  waypoints,
  waypointNames,
  buildRoutePOIScan,
  setCameraResults,
  setParkingResults,
  setFuelResults,
  setRoute,
  setDestination,
  setDestinationName,
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
  const poisFetchedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const isNew = destinationRef.current?.[0] !== destination?.[0] || destinationRef.current?.[1] !== destination?.[1];
    if (isNew) {
      poisFetchedRef.current = false;
    }
    destinationRef.current = destination;
  }, [destination]);
  useEffect(() => { destinationNameRef.current = destinationName; }, [destinationName]);
  useEffect(() => { departAtRef.current = departAt; }, [departAt]);
  useEffect(() => { avoidUnpavedRef.current = avoidUnpaved; }, [avoidUnpaved]);
  useEffect(() => { waypointsRef.current = waypoints; }, [waypoints]);
  useEffect(() => { waypointNamesRef.current = waypointNames; }, [waypointNames]);

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
  const navigateTo = useCallback(async (dest: Coords, name: string, waypointsArg?: Coords[], autoStart = false) => {
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
            avoidUnpaved: avoidUnpavedRef.current,
            adr_tunnel: prof.adr_tunnel ?? 'none',
          }
        : avoidUnpavedRef.current
          ? { avoidUnpaved: true, adr_tunnel: 'none' as const }
          : undefined;

      const result = await fetchRoute(origin, dest, truck, departAtRef.current ?? undefined, waypointsArg);
      if (!isMountedRef.current) return; // unmount guard

      setBackendOnline(!!result);

      setRoute(result);
      // Sync congestion colors for direct navigation (fixes missing traffic colors bug)
      setNavCongestionGeoJSON(result?.congestionGeoJSON ?? null);

      // Show alternatives in RouteOptionsPanel only during ROUTE_PREVIEW (not rerouting)
      if (result?.alternatives?.length && !navigatingRef.current) {
        const primary: import('../../../shared/services/backendApi').RouteOption = {
          label: 'Най-бърз',
          color: '#00BFFF',
          duration: result.duration,
          distance: result.distance,
          traffic: 'low',
          geometry: result.geometry,
          dest_coords: dest,
          congestion_geojson: result.congestionGeoJSON as any,
        };
        setRouteOptions([primary, ...result.alternatives]);
        setRouteOptDest({ name: destinationNameRef.current, coords: dest, waypoints: waypointsArg });
      } else if (!navigatingRef.current) {
        setRouteOptions([]);
      }

      if (result) {
        buildRoutePOIScan(result);
        const routeCoords = result.geometry.coordinates as [number, number][];

        // ── Auto-fetch essentials along route ──
        if (!poisFetchedRef.current) {
          poisFetchedRef.current = true;
          // 1. Cameras (safety) — no signal, must not be aborted by camera pan
          fetchCamerasAlongRoute(routeCoords)
            .then(cameras => { if (isMountedRef.current) setCameraResults(cameras); })
            .catch(() => { poisFetchedRef.current = false; });

          // 2. Truck Parking — no signal
          fetchPOIsAlongRoute(routeCoords, 'truck_stop')
            .then(pois => { if (isMountedRef.current) setParkingResults(pois); })
            .catch(() => { poisFetchedRef.current = false; });

          // 3. Fuel Stations — no signal
          fetchPOIsAlongRoute(routeCoords, 'fuel')
            .then(pois => { if (isMountedRef.current) setFuelResults(pois); })
            .catch(() => { poisFetchedRef.current = false; });
        }

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
          cameraRef.current?.fitBounds(
            [maxLng, maxLat],
            [minLng, minLat],
            [120, 40, 220, 40],
            1000,
          );
        }

        if (autoStart) {
          handleStartRef.current();
        }
      } else {
        if (!navigatingRef.current) cameraRef.current?.flyTo(dest, 800);
      }
    } catch (err) {
      if (!navigatingRef.current) cameraRef.current?.flyTo(dest, 800);
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
    departAtRef,
    waypointsRef,
    waypointNamesRef,
    navStartRef,
    navInitDurationRef,
    lastRerouteRef,
    avoidUnpavedRef,
  };
}
