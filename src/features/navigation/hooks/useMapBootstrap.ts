import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { activate, deactivate } from '@thehale/react-native-keep-awake';
import type * as GeoJSON from 'geojson';

import { BACKEND_URL } from '../../../shared/constants/config';
import type { VehicleProfile } from '../../../shared/types/vehicle';
import { fetchReportedCameras, pingBackend, type POICard } from '../../../shared/services/backendApi';
import type { RouteResult } from '../api/directions';
import { HOS_LIMIT_S } from '../utils/mapUtils';
import {
  coordinateAtRouteDistance,
  extractRequestedDriveMinutes,
  isReachQuestion,
  truckCappedRouteDurationS,
} from '../utils/mapScreenUtils';

type CameraRef = MutableRefObject<any>;

interface UseMapBootstrapArgs {
  cameraRef: CameraRef;
  navigating: boolean;
  profile: VehicleProfile | null;
  route: RouteResult | null;
  setLightMode: (isDay: boolean) => void;
}

export function useMapBootstrap({
  cameraRef,
  navigating,
  profile,
  route,
  setLightMode,
}: UseMapBootstrapArgs) {
  const [reachMarker, setReachMarker] = useState<{ coords: [number, number]; label: string } | null>(null);
  const [navCongestionGeoJSON, setNavCongestionGeoJSON] = useState<GeoJSON.FeatureCollection | null>(null);
  const [navTrafficAlerts, setNavTrafficAlerts] = useState<GeoJSON.FeatureCollection | null>(null);
  const [reportedCameras, setReportedCameras] = useState<POICard[]>([]);
  const [backendOnline, setBackendOnline] = useState(true);

  const navigatingRef = useRef(false);
  const routeRef = useRef<RouteResult | null>(null);
  const isMountedRef = useRef(true);
  const profileRef = useRef<VehicleProfile | null>(null);
  const stoppedSinceRef = useRef<number | null>(null);
  const lastRestrictionRef = useRef(0);
  const activeStructureWarningKeyRef = useRef<string | null>(null);
  const dismissedStructureWarningsRef = useRef<Map<string, number>>(new Map());
  const orchestratorUserCoordsRef = useRef<[number, number] | null>(null);
  const buildRoutePOIScanRef = useRef<(nextRoute: RouteResult) => void>(() => {});
  const setNavCongestionGeoJSONRef = useRef<(geojson: GeoJSON.FeatureCollection | null) => void>(() => {});
  const restrictionAnalysisCacheRef = useRef<Map<string, string[]>>(new Map());
  const setTunnelWarningRef = useRef<(msg: string | null) => void>(() => {});
  const drivingSecondsRef = useRef(0);

  useEffect(() => { navigatingRef.current = navigating; }, [navigating]);
  useEffect(() => { routeRef.current = route; }, [route]);
  useEffect(() => { profileRef.current = profile; }, [profile]);
  useEffect(() => () => { isMountedRef.current = false; }, []);

  useEffect(() => {
    if (navigating) activate();
    else deactivate();
    return () => deactivate();
  }, [navigating]);

  useEffect(() => {
    if (!route) return;
    fetchReportedCameras()
      .then(cameras => { if (cameras.length > 0) setReportedCameras(cameras); })
      .catch(() => {});
  }, [route]);

  useEffect(() => {
    const hour = new Date().getHours();
    setLightMode(hour >= 7 && hour < 19);
  }, [setLightMode]);

  useEffect(() => {
    pingBackend();
    const checkBackend = () => {
      fetch(`${BACKEND_URL}/api/health`, { method: 'GET' })
        .then(response => setBackendOnline(response.ok))
        .catch(() => setBackendOnline(false));
    };
    checkBackend();
    const timer = setInterval(checkBackend, 30_000);
    return () => clearInterval(timer);
  }, []);

  const showReachMarkerForText = useCallback((text: string) => {
    if (!route || !isReachQuestion(text)) return;
    const requestedMin = extractRequestedDriveMinutes(text)
      ?? Math.max(0, Math.round((HOS_LIMIT_S - drivingSecondsRef.current) / 60));
    if (requestedMin <= 0 || route.duration <= 0 || route.distance <= 0) return;

    const cappedDurationS = truckCappedRouteDurationS(route.distance, route.duration);
    const targetM = Math.min(route.distance, route.distance * ((requestedMin * 60) / cappedDurationS));
    const point = coordinateAtRouteDistance(route.geometry.coordinates as [number, number][], targetM);
    if (!point) return;
    setReachMarker({ coords: point, label: targetM >= route.distance ? 'Стигаш' : `Дотук ${Math.round(targetM / 1000)}км` });
    cameraRef.current?.animateToRegion({
      latitude: point[1],
      longitude: point[0],
      latitudeDelta: 0.35,
      longitudeDelta: 0.35,
    }, 700);
  }, [cameraRef, route]);

  return {
    activeStructureWarningKeyRef,
    backendOnline,
    buildRoutePOIScanRef,
    dismissedStructureWarningsRef,
    drivingSecondsRef,
    isMountedRef,
    lastRestrictionRef,
    navCongestionGeoJSON,
    navigatingRef,
    navTrafficAlerts,
    orchestratorUserCoordsRef,
    profileRef,
    reachMarker,
    reportedCameras,
    restrictionAnalysisCacheRef,
    routeRef,
    setBackendOnline,
    setNavCongestionGeoJSON,
    setNavCongestionGeoJSONRef,
    setNavTrafficAlerts,
    setReachMarker,
    setReportedCameras,
    setTunnelWarningRef,
    showReachMarkerForText,
    stoppedSinceRef,
  };
}
