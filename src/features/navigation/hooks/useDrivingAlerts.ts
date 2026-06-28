import { useState, useRef, useEffect, useMemo } from 'react';
import { Animated } from 'react-native';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import {
  cumulativeRouteDistances,
  haversineMeters,
  nearestRouteMatch,
  pointToSegmentDistanceMeters,
  ttsSpeak,
} from '../utils/mapUtils';
import {
  fetchPOIsAlongRoute,
  fetchProximityAlerts,
  type POICard,
  type ProximityAlerts,
} from '../../../shared/services/backendApi';
import { useSoundAlerts } from './useSoundAlerts';
import type { RouteResult } from '../api/directions';
import type { GradeProfile } from '../utils/gradeProfile';
import { findTachoLimitPoint } from '../utils/tachoRouteRange';
import i18n from '../../../i18n';

const PROXIMITY_ALERT_RADIUS_M = 8000;
const PROXIMITY_ALERT_REFRESH_MS = 45_000;
const PROXIMITY_ALERT_MIN_MOVE_M = 500;
const OVERTAKING_ROUTE_TOLERANCE_M = 110;
const OVERTAKING_LOOKAHEAD_M = 2500;
const OVERTAKING_BEHIND_TOLERANCE_M = -60;
// 75 m: geometry buffer (GPS accuracy on route)
// 180 m: point-only OSM fallback — wider to catch sign; reduce to 120 m if false positives on parallel roads
const ACTIVE_HGV_OVERTAKING_GEOMETRY_TOLERANCE_M = 75;
const ACTIVE_HGV_OVERTAKING_POINT_TOLERANCE_M = 180;

interface UseDrivingAlertsArgs {
  speed: number;
  speedLimit: number | null;
  navigating: boolean;
  userCoords: [number, number] | null;
  userHeading: number | null;
  route: RouteResult | null;
  cameraResults: POICard[];
  drivingTimeLeftMin?: number | null;
  isLoaded?: boolean;
  gradeProfile?: GradeProfile | null;
  voiceMutedRef: MutableRefObject<boolean>;
  lanePulseOn: boolean;
}

type OvertakingAlert = ProximityAlerts['overtaking'][number];

function isLngLatCoord(point: unknown): point is [number, number] {
  return (
    Array.isArray(point) &&
    point.length >= 2 &&
    Number.isFinite(point[0]) &&
    Number.isFinite(point[1])
  );
}

function alertGeometryCoords(alert: OvertakingAlert): [number, number][] {
  return (alert.geometry ?? []).filter(isLngLatCoord);
}

function alertAnchorCoords(alert: OvertakingAlert): [number, number] | null {
  if (Number.isFinite(alert.lng) && Number.isFinite(alert.lat)) {
    return [alert.lng, alert.lat];
  }
  return alertGeometryCoords(alert)[0] ?? null;
}

function alertCandidateCoords(alert: OvertakingAlert): [number, number][] {
  const coords = alertGeometryCoords(alert);
  const anchor = alertAnchorCoords(alert);
  if (anchor && !coords.some(coord => coord[0] === anchor[0] && coord[1] === anchor[1])) {
    coords.push(anchor);
  }
  return coords;
}

function distanceToAlertGeometryMeters(alert: OvertakingAlert, point: [number, number]): number {
  const geometry = alertGeometryCoords(alert);
  if (geometry.length >= 2) {
    let best = Infinity;
    for (let i = 1; i < geometry.length; i += 1) {
      best = Math.min(best, pointToSegmentDistanceMeters(point, geometry[i - 1], geometry[i]));
    }
    return best;
  }

  const anchor = alertAnchorCoords(alert);
  return anchor ? haversineMeters(point, anchor) : Infinity;
}

function hasActiveHgvNoOvertaking(alerts: OvertakingAlert[], userCoords: [number, number] | null): boolean {
  if (!userCoords) return false;
  return alerts.some(alert => {
    if (!alert.hgv_only) return false;
    const distanceM = distanceToAlertGeometryMeters(alert, userCoords);
    const toleranceM = alert.geometry && alert.geometry.length >= 2
      ? ACTIVE_HGV_OVERTAKING_GEOMETRY_TOLERANCE_M
      : ACTIVE_HGV_OVERTAKING_POINT_TOLERANCE_M;
    return distanceM <= toleranceM;
  });
}

function isRouteAlertMatch(
  item: {
    alert: OvertakingAlert;
    alongRouteM: number;
    lateralRouteM: number;
    angleDiff: number;
  } | null,
): item is {
  alert: OvertakingAlert;
  alongRouteM: number;
  lateralRouteM: number;
  angleDiff: number;
} {
  return item !== null;
}

function headingDiffDeg(userHeading: number | null, from: [number, number], to: [number, number]): number {
  if (userHeading === null) return 0;
  const bearing = Math.atan2(to[0] - from[0], to[1] - from[1]) * 180 / Math.PI;
  const normalized = (bearing + 360) % 360;
  const diff = Math.abs(userHeading - normalized);
  return diff > 180 ? 360 - diff : diff;
}

function filterOvertakingAlerts(
  alerts: OvertakingAlert[],
  userCoords: [number, number],
  userHeading: number | null,
  routeCoords?: [number, number][],
): OvertakingAlert[] {
  if (!routeCoords || routeCoords.length < 2) {
    return alerts
      .filter(alert => alertCandidateCoords(alert).length > 0)
      .sort((a, b) => (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity))
      .slice(0, 8);
  }

  const userMatch = nearestRouteMatch(userCoords, routeCoords);
  const routeMeters = cumulativeRouteDistances(routeCoords);

  return alerts
    .map(alert => {
      const candidates = alertCandidateCoords(alert)
        .map(coords => {
          const routeMatch = nearestRouteMatch(coords, routeCoords);
          return {
            alongRouteM: routeMeters[routeMatch.bestIndex] - routeMeters[userMatch.bestIndex],
            lateralRouteM: routeMatch.bestDistance,
            angleDiff: headingDiffDeg(userHeading, userCoords, coords),
          };
        })
        .filter(item =>
          item.lateralRouteM <= OVERTAKING_ROUTE_TOLERANCE_M &&
          item.alongRouteM >= OVERTAKING_BEHIND_TOLERANCE_M &&
          item.alongRouteM <= OVERTAKING_LOOKAHEAD_M &&
          (userHeading === null || item.angleDiff < 75)
        );
      const chosen = candidates
        .sort((a, b) => a.alongRouteM - b.alongRouteM || a.lateralRouteM - b.lateralRouteM)[0];
      if (!chosen) return null;
      return {
        alert: {
          ...alert,
          distance_m: Math.max(0, Math.round(chosen.alongRouteM)),
        },
        alongRouteM: chosen.alongRouteM,
        lateralRouteM: chosen.lateralRouteM,
        angleDiff: chosen.angleDiff,
      };
    })
    .filter(isRouteAlertMatch)
    .sort((a, b) => a.alongRouteM - b.alongRouteM || a.lateralRouteM - b.lateralRouteM)
    .slice(0, 8)
    .map(item => item.alert);
}

export function useDrivingAlerts({
  speed,
  speedLimit,
  navigating,
  userCoords,
  userHeading,
  route,
  cameraResults,
  drivingTimeLeftMin,
  isLoaded = false,
  gradeProfile,
  voiceMutedRef,
  lanePulseOn,
}: UseDrivingAlertsArgs) {
  const { playSpeedAlert, playCameraAlert } = useSoundAlerts(voiceMutedRef);
  const [cameraAlert, setCameraAlert] = useState<{ dist: number; name: string; lat: number; lng: number } | null>(null);
  const [overtakingResults, setOvertakingResults] = useState<ProximityAlerts['overtaking']>([]);
  const [urgentParkingResults, setUrgentParkingResults] = useState<POICard[]>([]);
  const [tunnelWarning, setTunnelWarning] = useState<string | null>(null);

  const cameraFlashAnim    = useRef(new Animated.Value(0)).current;
  const speedingFlash      = useRef(new Animated.Value(0)).current;
  const laneGlowAnim       = useRef(new Animated.Value(0)).current;
  const laneGlowLoop       = useRef<Animated.CompositeAnimation | null>(null);
  const lastCameraWarnRef  = useRef<number>(0);
  const lastSpeedAlarmRef  = useRef<number>(0);
  const lastProximityFetchAtRef = useRef(0);
  const lastProximityFetchCoordsRef = useRef<[number, number] | null>(null);
  const proximityRequestSeqRef = useRef(0);
  const urgentParkingAbortRef = useRef<AbortController | null>(null);
  const lastUrgentParkingRouteKeyRef = useRef<string | null>(null);

  // в”Ђв”Ђ Speed limit TTS alarm вЂ” fires once per 30 s when exceeding the limit в”Ђв”Ђ
  useEffect(() => {
    if (!navigating || speedLimit == null || speed <= speedLimit) return;
    const now = Date.now();
    if (now - lastSpeedAlarmRef.current < 30_000) return;
    lastSpeedAlarmRef.current = now;
    playSpeedAlert();
    Animated.sequence([
      Animated.timing(speedingFlash, { toValue: 1, duration: 150, useNativeDriver: false }),
      Animated.timing(speedingFlash, { toValue: 0, duration: 150, useNativeDriver: false }),
      Animated.timing(speedingFlash, { toValue: 1, duration: 150, useNativeDriver: false }),
      Animated.timing(speedingFlash, { toValue: 0, duration: 300, useNativeDriver: false }),
    ]).start();
    if (!voiceMutedRef.current) {
      ttsSpeak(i18n.t('alerts.speedLimitExceeded', { speedLimit }));
    }
    }, [speed, speedLimit, navigating, voiceMutedRef, playSpeedAlert, speedingFlash]);

    // ── Speed camera proximity alert — TTS + flash every 10 s when < 600 m ──
    useEffect(() => {
    const routeCoords = route?.geometry?.coordinates as [number, number][] | undefined;
    if (!navigating || !userCoords || cameraResults.length === 0 || !routeCoords || routeCoords.length < 2) {
      setCameraAlert(null);
      return;
    }

    const userMatch = nearestRouteMatch(userCoords, routeCoords);
    const routeMeters = cumulativeRouteDistances(routeCoords);
    const nearest = cameraResults
      .filter(c => !c.category || c.category === 'speed_camera')
      .filter(c => c.lat && c.lng)
      .map(c => {
        const cameraCoords: [number, number] = [c.lng as number, c.lat as number];
        const routeMatch = nearestRouteMatch(cameraCoords, routeCoords);
        const alongRouteM = routeMeters[routeMatch.bestIndex] - routeMeters[userMatch.bestIndex];
        const dist = haversineMeters(userCoords, cameraCoords);
        let angleDiff = 0;
        if (userHeading !== null) {
          const bearing = Math.atan2(cameraCoords[0] - userCoords[0], cameraCoords[1] - userCoords[1]) * 180 / Math.PI;
          // Normalize bearing to 0-360
          const normBearing = (bearing + 360) % 360;
          angleDiff = Math.abs(userHeading - normBearing);
          if (angleDiff > 180) angleDiff = 360 - angleDiff;
        }
        return { ...c, dist, angleDiff, alongRouteM, lateralRouteM: routeMatch.bestDistance };
      })
      .filter(c =>
        c.lateralRouteM <= 80 &&
        c.alongRouteM >= -40 &&
        c.alongRouteM <= 1500 &&
        (userHeading === null || c.angleDiff < 60)
      )
      .sort((a, b) => a.alongRouteM - b.alongRouteM || a.lateralRouteM - b.lateralRouteM)[0];

    if (!nearest || nearest.alongRouteM >= 900) { setCameraAlert(null); return; }
    setCameraAlert({
      dist: Math.max(0, Math.round(nearest.alongRouteM)),
      name: nearest.name,
      lat: nearest.lat as number,
      lng: nearest.lng as number,
    });
    const now = Date.now();
    if (now - lastCameraWarnRef.current >= 10_000) {
      lastCameraWarnRef.current = now;
      playCameraAlert();
      if (!voiceMutedRef.current) {
        ttsSpeak(i18n.t('alerts.speedCameraAhead', {
          meters: Math.max(0, Math.round(nearest.alongRouteM)),
        }));
      }
      Animated.sequence([
        Animated.timing(cameraFlashAnim, { toValue: 1, duration: 180, useNativeDriver: false }),
        Animated.timing(cameraFlashAnim, { toValue: 0, duration: 180, useNativeDriver: false }),
        Animated.timing(cameraFlashAnim, { toValue: 1, duration: 180, useNativeDriver: false }),
        Animated.timing(cameraFlashAnim, { toValue: 0, duration: 350, useNativeDriver: false }),
      ]).start();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userCoords, navigating, route, cameraResults, playCameraAlert, voiceMutedRef, userHeading]);

  // ── No-overtaking restrictions — fetch near live GPS and filter to route ahead ──
  useEffect(() => {
    if (!navigating || !userCoords) {
      proximityRequestSeqRef.current += 1;
      lastProximityFetchCoordsRef.current = null;
      setOvertakingResults([]);
      return;
    }

    const now = Date.now();
    const lastCoords = lastProximityFetchCoordsRef.current;
    const movedM = lastCoords ? haversineMeters(lastCoords, userCoords) : Infinity;
    if (
      now - lastProximityFetchAtRef.current < PROXIMITY_ALERT_REFRESH_MS &&
      movedM < PROXIMITY_ALERT_MIN_MOVE_M
    ) {
      return;
    }

    lastProximityFetchAtRef.current = now;
    lastProximityFetchCoordsRef.current = userCoords;
    const requestSeq = proximityRequestSeqRef.current + 1;
    proximityRequestSeqRef.current = requestSeq;
    const routeCoords = route?.geometry?.coordinates as [number, number][] | undefined;

    fetchProximityAlerts(userCoords[1], userCoords[0], PROXIMITY_ALERT_RADIUS_M)
      .then(alerts => {
        if (proximityRequestSeqRef.current !== requestSeq) return;
        const overtaking = filterOvertakingAlerts(
          alerts?.overtaking ?? [],
          userCoords,
          userHeading,
          routeCoords,
        );
        setOvertakingResults(overtaking);
      })
      .catch(() => {
        if (proximityRequestSeqRef.current === requestSeq) {
          setOvertakingResults([]);
        }
      });
  }, [navigating, route, userCoords, userHeading]);

  // ── Urgent tacho parking — search around the route point where drive time ends ──
  useEffect(() => {
    const remainingMin = Number(drivingTimeLeftMin);
    if (
      !navigating ||
      !route ||
      !userCoords ||
      !Number.isFinite(remainingMin) ||
      remainingMin <= 0 ||
      remainingMin > 20
    ) {
      urgentParkingAbortRef.current?.abort();
      urgentParkingAbortRef.current = null;
      setUrgentParkingResults([]);
      if (!navigating || remainingMin > 20) {
        lastUrgentParkingRouteKeyRef.current = null;
      }
      return;
    }

    const routeCoords = route.geometry.coordinates as [number, number][];
    if (routeCoords.length < 2) return;

    const first = routeCoords[0];
    const last = routeCoords[routeCoords.length - 1];
    const routeKey = [
      Math.round(route.distance),
      first?.map(v => v.toFixed(4)).join(','),
      last?.map(v => v.toFixed(4)).join(','),
    ].join('|');
    if (lastUrgentParkingRouteKeyRef.current === routeKey) return;

    const limitPoint = findTachoLimitPoint({
      routeCoords,
      userCoords,
      drivingTimeLeftMin: remainingMin,
      isLoaded,
      route,
      gradeProfile,
    });
    const searchCoords = limitPoint?.routeSlice && limitPoint.routeSlice.length >= 2
      ? limitPoint.routeSlice
      : routeCoords;
    if (searchCoords.length < 2) return;

    lastUrgentParkingRouteKeyRef.current = routeKey;
    urgentParkingAbortRef.current?.abort();
    const ctrl = new AbortController();
    urgentParkingAbortRef.current = ctrl;

    fetchPOIsAlongRoute(searchCoords, 'truck_stop', ctrl.signal)
      .then(results => {
        if (ctrl.signal.aborted) return;
        setUrgentParkingResults(results.slice(0, 5));
      })
      .catch(err => {
        if (err instanceof Error && err.name === 'AbortError') return;
        lastUrgentParkingRouteKeyRef.current = null;
        setUrgentParkingResults([]);
      });

    return () => {
      ctrl.abort();
    };
  }, [drivingTimeLeftMin, gradeProfile, isLoaded, navigating, route, userCoords]);

  // в”Ђв”Ђ Lane glow pulse вЂ” starts/stops based on lanePulseOn в”Ђв”Ђ
  useEffect(() => {
    if (lanePulseOn) {
      laneGlowLoop.current?.stop();
      laneGlowLoop.current = Animated.loop(Animated.sequence([
        Animated.timing(laneGlowAnim, { toValue: 1, duration: 550, useNativeDriver: false }),
        Animated.timing(laneGlowAnim, { toValue: 0, duration: 550, useNativeDriver: false }),
      ]));
      laneGlowLoop.current.start();
    } else {
      laneGlowLoop.current?.stop();
      laneGlowAnim.setValue(0);
    }
    return () => { laneGlowLoop.current?.stop(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lanePulseOn]);

  const laneGlowBg = useMemo(() => laneGlowAnim.interpolate({
    inputRange: [0, 1], outputRange: ['rgba(0,191,255,0.22)', 'rgba(0,191,255,0.60)'],
  }), [laneGlowAnim]);
  const laneGlowShadow = useMemo(() => laneGlowAnim.interpolate({
    inputRange: [0, 1], outputRange: [0.55, 1.0],
  }), [laneGlowAnim]);

  const activeHgvNoOvertaking = useMemo(
    () => navigating && hasActiveHgvNoOvertaking(overtakingResults, userCoords),
    [navigating, overtakingResults, userCoords],
  );

  const speedingBg      = speed > (speedLimit ?? Infinity) ? '#FF3B30' : 'transparent';
  const proximityAlerts = { overtaking: overtakingResults, activeHgvNoOvertaking };

  return {
    cameraAlert,
    setCameraAlert: setCameraAlert as Dispatch<SetStateAction<{ dist: number; name: string } | null>>,
    overtakingResults,
    setOvertakingResults,
    urgentParkingResults,
    tunnelWarning,
    setTunnelWarning,
    cameraFlashAnim,
    speedingFlash,
    laneGlowBg,
    laneGlowShadow,
    speedingBg,
    proximityAlerts,
    activeHgvNoOvertaking,
    playCameraAlert,
  };
}
