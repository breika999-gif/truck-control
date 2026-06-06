import { useState, useRef, useEffect, type MutableRefObject } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import Geolocation from 'react-native-geolocation-service';
import {
  fetchNearbyRestrictions,
  type RoadStructureCandidate,
} from '../api/tilequery';
import {
  getSpeedLimitAtPosition,
  getCurrentStepIndex,
  type RouteResult,
} from '../api/directions';
import { cumulativeRouteDistances, haversineMeters, nearestRouteMatch } from '../utils/mapUtils';
import type { VehicleProfile } from '../../../shared/types/vehicle';
import type * as GeoJSON from 'geojson';
import type { NavPhase } from './useNavigationState';
import i18n from '../../../i18n';

interface UseLocationRuntimeProps {
  isMountedRef: MutableRefObject<boolean>;
  navigatingRef: MutableRefObject<boolean>;
  routeRef: MutableRefObject<RouteResult | null>;
  profileRef: MutableRefObject<VehicleProfile | null>;
  destinationRef: MutableRefObject<[number, number] | null>;
  destinationNameRef: MutableRefObject<string>;
  waypointsRef: MutableRefObject<[number, number][]>;
  lastRerouteRef: MutableRefObject<number>;
  stoppedSinceRef: MutableRefObject<number | null>;
  lastRestrictionRef: MutableRefObject<number>;
  dismissedStructureWarningsRef: MutableRefObject<Map<string, number>>;
  avoidUnpavedRef: MutableRefObject<boolean>;
  simulationActiveRef?: MutableRefObject<boolean>;

  setTunnelWarning: (msg: string | null, key?: string | null) => void;
  setSpeedLimit: (limit: number | null) => void;
  setCurrentStep: (step: number) => void;
  setDistToTurn: (dist: number | null) => void;
  setNavPhase: (phase: NavPhase) => void;
  setRoute: (route: RouteResult | null) => void;
  setNavCongestionGeoJSON: (geojson: GeoJSON.FeatureCollection | null) => void;
  setBackendOnline?: (online: boolean) => void;
  navigating: boolean;
}

const STRUCTURE_QUERY_RADIUS_M = 650;
const STRUCTURE_ROUTE_TOLERANCE_M = 85;
const STRUCTURE_LOOKAHEAD_M = 1500;
const STRUCTURE_BEHIND_TOLERANCE_M = -50;
export const STRUCTURE_WARNING_DISMISS_MS = 15 * 60_000;

type RouteStepWithSpeedLimit = RouteResult['steps'][number] & {
  speedLimitKmh?: unknown;
  speed_limit_kmh?: unknown;
  speedLimit?: unknown;
};

function normalizeSpeedLimitKmh(value: unknown): number | null {
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
}

function getRouteSpeedLimit(
  route: RouteResult,
  stepIdx: number,
  coords: [number, number],
): number | null {
  const step = route.steps[stepIdx] as RouteStepWithSpeedLimit | undefined;
  return (
    normalizeSpeedLimitKmh(step?.speedLimitKmh) ??
    normalizeSpeedLimitKmh(step?.speed_limit_kmh) ??
    normalizeSpeedLimitKmh(step?.speedLimit) ??
    getSpeedLimitAtPosition(route.geometry.coordinates, route.maxspeeds, coords)
  );
}

function hasAdrCargo(profile: VehicleProfile): boolean {
  const hazmat = String(profile.hazmat_class ?? 'none').toLowerCase();
  return hazmat !== '' && hazmat !== 'none' && hazmat !== '0' && hazmat !== 'false';
}

function profileNeedsStructureWarning(
  candidate: RoadStructureCandidate,
  profile: VehicleProfile,
): boolean {
  if (candidate.kind === 'tunnel') {
    return profile.height_m > 3.5 || hasAdrCargo(profile);
  }
  return profile.weight_t >= 3.5;
}

function isWarningDismissed(
  key: string,
  dismissed: Map<string, number>,
  now: number,
): boolean {
  const until = dismissed.get(key);
  if (!until) return false;
  if (until <= now) {
    dismissed.delete(key);
    return false;
  }
  return true;
}

function formatStructureDistance(meters: number): string {
  const rounded = Math.max(0, Math.round(meters / 10) * 10);
  if (rounded >= 1000) {
    return i18n.t('directions.distanceKilometersShort', { kilometers: (rounded / 1000).toFixed(1) });
  }
  return i18n.t('directions.distanceMetersShort', { meters: rounded });
}

function routeMatchForStructure(
  candidate: RoadStructureCandidate,
  routeCoords: [number, number][],
  routeMeters: number[],
  userRouteIndex: number,
) {
  const coords = candidate.coordinates.length
    ? candidate.coordinates
    : [[candidate.lng, candidate.lat] as [number, number]];

  let best: {
    alongRouteM: number;
    lateralRouteM: number;
    routeIndex: number;
    coord: [number, number];
  } | null = null;

  for (const coord of coords) {
    const match = nearestRouteMatch(coord, routeCoords);
    const alongRouteM = routeMeters[match.bestIndex] - routeMeters[userRouteIndex];
    if (
      alongRouteM < STRUCTURE_BEHIND_TOLERANCE_M ||
      alongRouteM > STRUCTURE_LOOKAHEAD_M ||
      match.bestDistance > STRUCTURE_ROUTE_TOLERANCE_M
    ) {
      continue;
    }

    if (
      !best ||
      Math.max(0, alongRouteM) < Math.max(0, best.alongRouteM) ||
      (Math.abs(alongRouteM - best.alongRouteM) < 25 && match.bestDistance < best.lateralRouteM)
    ) {
      best = {
        alongRouteM,
        lateralRouteM: match.bestDistance,
        routeIndex: match.bestIndex,
        coord,
      };
    }
  }

  return best;
}

function chooseRouteStructureWarning(
  candidates: RoadStructureCandidate[],
  route: RouteResult,
  userCoords: [number, number],
  profile: VehicleProfile,
  dismissed: Map<string, number>,
  now: number,
): { message: string; key: string } | null {
  const routeCoords = route.geometry.coordinates;
  if (routeCoords.length < 2) return null;

  const userMatch = nearestRouteMatch(userCoords, routeCoords);
  const routeMeters = cumulativeRouteDistances(routeCoords);

  const nearest = candidates
    .filter(candidate => profileNeedsStructureWarning(candidate, profile))
    .map(candidate => {
      const match = routeMatchForStructure(candidate, routeCoords, routeMeters, userMatch.bestIndex);
      if (!match) return null;
      const key = [
        candidate.kind,
        Math.round(routeMeters[match.routeIndex] / 200),
      ].join(':');
      return { candidate, match, key };
    })
    .filter((item): item is NonNullable<typeof item> => !!item)
    .filter(item => !isWarningDismissed(item.key, dismissed, now))
    .sort((a, b) => (
      Math.max(0, a.match.alongRouteM) - Math.max(0, b.match.alongRouteM) ||
      a.match.lateralRouteM - b.match.lateralRouteM
    ))[0];

  if (!nearest) return null;

  const distance = formatStructureDistance(nearest.match.alongRouteM);
  if (nearest.candidate.kind === 'tunnel') {
    return {
      key: nearest.key,
      message: i18n.t('alerts.structureTunnel', { distance }),
    };
  }

  return {
    key: nearest.key,
    message: i18n.t('alerts.structureBridge', { distance }),
  };
}

export const useLocationRuntime = ({
  isMountedRef,
  navigatingRef,
  routeRef,
  profileRef,
  destinationRef: _destinationRef,
  destinationNameRef: _destinationNameRef,
  waypointsRef: _waypointsRef,
  lastRerouteRef: _lastRerouteRef,
  stoppedSinceRef,
  lastRestrictionRef,
  dismissedStructureWarningsRef,
  avoidUnpavedRef: _avoidUnpavedRef,
  simulationActiveRef,
  setTunnelWarning,
  setSpeedLimit,
  setCurrentStep,
  setDistToTurn,
  setNavPhase: _setNavPhase,
  setRoute: _setRoute,
  setNavCongestionGeoJSON: _setNavCongestionGeoJSON,
  setBackendOnline: _setBackendOnline,
}: UseLocationRuntimeProps) => {
  const [userCoords, setUserCoords] = useState<[number, number] | null>(null);
  const [userHeading, setUserHeading] = useState<number | null>(null);
  const userCoordsRef = useRef<[number, number] | null>(null);
  const [gpsReady, setGpsReady] = useState(false);
  const [speed, setSpeed] = useState(0);
  const isDrivingRef = useRef(false);
  const lastRestrictionCoordsRef = useRef<[number, number] | null>(null);
  const smoothedHeadingRef = useRef<number | null>(null);
  const headingHistoryRef = useRef<number[]>([]);

  useEffect(() => {
    userCoordsRef.current = userCoords;
  }, [userCoords]);

  // ── Runtime location permission + GPS (react-native-geolocation-service) ──
  useEffect(() => {
    let watchId: number | null = null;

    const startWatch = () => {
      Geolocation.getCurrentPosition(
        (pos) => {
          if (!isMountedRef.current || simulationActiveRef?.current) return;
          const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude];
          userCoordsRef.current = coords;
          setUserCoords(coords);
          setGpsReady(true);
        },
        (err) => { console.warn('[GPS] getCurrentPosition failed:', err.code, err.message); },
        { enableHighAccuracy: true, timeout: 5000 },
      );

      watchId = Geolocation.watchPosition(
        (pos) => {
          if (!isMountedRef.current || simulationActiveRef?.current) return;
          const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude];
          userCoordsRef.current = coords;
          setUserCoords(coords);
          setGpsReady(true);

          const spd = pos.coords.speed ?? -1;
          const kmh = spd > 0 ? spd * 3.6 : 0;
          setSpeed(Math.round(kmh));
          const hdg = pos.coords.heading ?? -1;
          if (hdg >= 0) {
            // 1. Outlier detection — use ref (not state) to avoid stale closure
            const prev = smoothedHeadingRef.current;
            let isHeadingValid = true;
            if (prev !== null) {
              const diff = Math.abs(((hdg - prev) + 360) % 360);
              const angleDiff = diff > 180 ? 360 - diff : diff;
              isHeadingValid = angleDiff <= 150;
            }
            if (isHeadingValid) {
              // 2. Circular rolling average (last 4) — handles 0°/360° wrap correctly
              headingHistoryRef.current.push(hdg);
              if (headingHistoryRef.current.length > 4) headingHistoryRef.current.shift();
              const toRad = (d: number) => (d * Math.PI) / 180;
              const sinSum = headingHistoryRef.current.reduce((s, h) => s + Math.sin(toRad(h)), 0);
              const cosSum = headingHistoryRef.current.reduce((s, h) => s + Math.cos(toRad(h)), 0);
              const avg = (Math.atan2(sinSum, cosSum) * 180) / Math.PI;
              const circAvg = Math.round(avg < 0 ? avg + 360 : avg);
              smoothedHeadingRef.current = circAvg;
              setUserHeading(circAvg);
            }
          }
          isDrivingRef.current = kmh > 3;

          const tqNow = Date.now();
          const [tqLng, tqLat] = coords;

          if (kmh >= 2) {
            stoppedSinceRef.current = null;
          }

          const isNav = navigatingRef.current;
          const cur = routeRef.current;
          if (!isNav || !cur) {
            setSpeedLimit(null);
            return;
          }

          const profR = profileRef.current;
          const restrictInterval = kmh < 50 ? 60_000 : kmh < 100 ? 90_000 : 120_000;
          const shouldCheckNearbyRestrictions = !!profR && (
            profR.height_m > 3.5 ||
            profR.weight_t >= 3.5 ||
            (profR.hazmat_class != null && profR.hazmat_class !== 'none')
          );
          if (shouldCheckNearbyRestrictions && tqNow - lastRestrictionRef.current >= restrictInterval) {
            const distMoved = lastRestrictionCoordsRef.current
              ? haversineMeters([tqLng, tqLat], lastRestrictionCoordsRef.current)
              : 999;
            if (distMoved >= 300) {
              lastRestrictionRef.current = tqNow;
              lastRestrictionCoordsRef.current = [tqLng, tqLat];
              fetchNearbyRestrictions(tqLng, tqLat, STRUCTURE_QUERY_RADIUS_M).then(r => {
                if (!isMountedRef.current) return;
                const warning = chooseRouteStructureWarning(
                  r.candidates,
                  cur,
                  coords,
                  profR,
                  dismissedStructureWarningsRef.current,
                  Date.now(),
                );
                setTunnelWarning(warning?.message ?? null, warning?.key ?? null);
              });
            }
          }

          const stepIdx = getCurrentStepIndex(cur.steps, coords);
          setCurrentStep(stepIdx);
          setSpeedLimit(getRouteSpeedLimit(cur, stepIdx, coords));

          const nextLoc = cur.steps[stepIdx + 1]?.intersections?.[0]?.location;
          setDistToTurn(nextLoc ? haversineMeters(coords, nextLoc) : null);
        },
        (err) => { console.warn('[GPS] watchPosition error:', err.code, err.message); },
        {
          enableHighAccuracy: true,
          distanceFilter: 2,
          interval: 1000,
          fastestInterval: 500,
          forceRequestLocation: true,
          showLocationDialog: true,
        },
      );
    };

    if (Platform.OS === 'android') {
      PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: i18n.t('alerts.locationPermissionTitle'),
          message: i18n.t('alerts.locationPermissionMessage'),
          buttonPositive: i18n.t('alerts.allow'),
          buttonNegative: i18n.t('alerts.deny'),
        },
      ).then(status => {
        if (status === PermissionsAndroid.RESULTS.GRANTED) startWatch();
      });
    } else {
      Geolocation.requestAuthorization('whenInUse').then(auth => {
        if (auth === 'granted') startWatch();
      });
    }

    return () => {
      if (watchId !== null) Geolocation.clearWatch(watchId);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    userCoords,
    userCoordsRef,
    setUserCoords,
    userHeading,
    setUserHeading,
    gpsReady,
    setGpsReady,
    speed,
    setSpeed,
    isDrivingRef,
  };
};
