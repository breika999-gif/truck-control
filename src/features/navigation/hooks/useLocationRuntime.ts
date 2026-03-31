import { useState, useRef, useEffect, type MutableRefObject } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import Geolocation from 'react-native-geolocation-service';
import { locationManager } from '@rnmapbox/maps';
import {
  fetchNearbyRestrictions,
  fetchSpeedLimitAtPoint,
} from '../api/tilequery';
import {
  fetchRoute,
  adrToExclude,
  getSpeedLimitAtPosition,
  getCurrentStepIndex,
  type RouteResult,
} from '../api/directions';
import { haversineMeters } from '../utils/mapUtils';
import type { VehicleProfile } from '../../../shared/types/vehicle';
import type * as GeoJSON from 'geojson';
import type { NavPhase } from './useNavigationState';

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
  avoidUnpavedRef: MutableRefObject<boolean>;

  setTunnelWarning: (msg: string | null) => void;
  setSpeedLimit: (limit: number | null) => void;
  setCurrentStep: (step: number) => void;
  setDistToTurn: (dist: number | null) => void;
  setNavPhase: (phase: NavPhase) => void;
  setRoute: (route: RouteResult | null) => void;
  setNavCongestionGeoJSON: (geojson: GeoJSON.FeatureCollection | null) => void;
  setBackendOnline?: (online: boolean) => void;
  navigating: boolean;
}

export const useLocationRuntime = ({
  isMountedRef,
  navigatingRef,
  routeRef,
  profileRef,
  destinationRef,
  destinationNameRef,
  waypointsRef,
  lastRerouteRef,
  stoppedSinceRef,
  lastRestrictionRef,
  avoidUnpavedRef,
  setTunnelWarning,
  setSpeedLimit,
  setCurrentStep,
  setDistToTurn,
  setNavPhase,
  setRoute,
  setNavCongestionGeoJSON,
  setBackendOnline,
  navigating,
}: UseLocationRuntimeProps) => {
  const [userCoords, setUserCoords] = useState<[number, number] | null>(null);
  const [userHeading, setUserHeading] = useState<number | null>(null);
  const userCoordsRef = useRef<[number, number] | null>(null);
  const [gpsReady, setGpsReady] = useState(false);
  const [speed, setSpeed] = useState(0);
  const isDrivingRef = useRef(false);

  const isSimulatingRef = useRef(false);
  const simIndexRef = useRef(0);
  const simIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    userCoordsRef.current = userCoords;
  }, [userCoords]);

  // ── Runtime location permission + GPS (react-native-geolocation-service) ──
  useEffect(() => {
    let watchId: number | null = null;

    const startWatch = () => {
      locationManager.start();

      Geolocation.getCurrentPosition(
        (pos) => {
          if (!isMountedRef.current) return;
          const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude];
          userCoordsRef.current = coords;
          setUserCoords(coords);
          setGpsReady(true);
        },
        () => {},
        { enableHighAccuracy: true, timeout: 5000 },
      );

      watchId = Geolocation.watchPosition(
        (pos) => {
          if (!isMountedRef.current) return;
          if (isSimulatingRef.current) return;
          const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude];
          userCoordsRef.current = coords;
          setUserCoords(coords);
          setGpsReady(true);

          const spd = pos.coords.speed ?? -1;
          const kmh = spd > 0 ? spd * 3.6 : 0;
          setSpeed(Math.round(kmh));
          const hdg = pos.coords.heading ?? -1;
          setUserHeading(hdg >= 0 ? hdg : null);
          isDrivingRef.current = kmh > 3;

          const tqNow = Date.now();
          const [tqLng, tqLat] = coords;

          if (kmh >= 2) {
            stoppedSinceRef.current = null;
          }

          const isNav = navigatingRef.current;
          const cur = routeRef.current;
          if (!isNav || !cur) return;

          const profR = profileRef.current;
          const restrictInterval = kmh < 50 ? 45_000 : kmh < 100 ? 30_000 : 20_000;
          if (profR && profR.height_m > 3.5 && tqNow - lastRestrictionRef.current >= restrictInterval) {
            lastRestrictionRef.current = tqNow;
            fetchNearbyRestrictions(tqLng, tqLat, 800).then(r => {
              if (!isMountedRef.current) return;
              if (r.hasTunnel) {
                const dist = r.tunnelDistance > 0 ? ` ${r.tunnelDistance} м` : '';
                setTunnelWarning(`⚠️ Тунел${dist} — провери клиренс!`);
              } else if (r.hasBridge) {
                const dist = r.bridgeDistance > 0 ? ` ${r.bridgeDistance} м` : '';
                setTunnelWarning(`⚠️ Мост${dist} — провери носимост!`);
              } else {
                setTunnelWarning(null);
              }
            });
          }

          setSpeedLimit(
            getSpeedLimitAtPosition(cur.geometry.coordinates, cur.maxspeeds, coords),
          );

          const stepIdx = getCurrentStepIndex(cur.steps, coords);
          setCurrentStep(stepIdx);

          const nextLoc = cur.steps[stepIdx + 1]?.intersections?.[0]?.location;
          setDistToTurn(nextLoc ? haversineMeters(coords, nextLoc) : null);
        },
        () => {},
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
          title: 'Разрешение за местоположение',
          message: 'TruckAI Pro се нуждае от GPS за навигация.',
          buttonPositive: 'Разреши',
          buttonNegative: 'Откажи',
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
      locationManager.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Speed limit via tilequery when no active route ───────────────────────
  const speedLimitFetchRef = useRef<number>(0);
  useEffect(() => {
    if (navigating || !userCoords) return;
    const interval = setInterval(async () => {
      const now = Date.now();
      if (now - speedLimitFetchRef.current < 10_000) return;
      speedLimitFetchRef.current = now;
      const limit = await fetchSpeedLimitAtPoint(userCoords[0], userCoords[1]);
      if (isMountedRef.current) setSpeedLimit(limit);
    }, 10_000);
    return () => clearInterval(interval);
  }, [navigating, userCoords, setSpeedLimit, isMountedRef]);

  return {
    userCoords,
    userCoordsRef,
    setUserCoords,
    userHeading,
    gpsReady,
    setGpsReady,
    speed,
    setSpeed,
    isDrivingRef,
    isSimulatingRef,
    simIndexRef,
    simIntervalRef,
  };
};
