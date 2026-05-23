import { useState, useRef, useEffect, useMemo } from 'react';
import { Animated } from 'react-native';
import type { MutableRefObject } from 'react';
import { cumulativeRouteDistances, haversineMeters, nearestRouteMatch, ttsSpeak } from '../utils/mapUtils';
import type { POICard, ProximityAlerts } from '../../../shared/services/backendApi';
import { useSoundAlerts } from './useSoundAlerts';
import type { RouteResult } from '../api/directions';

interface UseDrivingAlertsArgs {
  speed: number;
  speedLimit: number | null;
  navigating: boolean;
  userCoords: [number, number] | null;
  userHeading: number | null;
  route: RouteResult | null;
  cameraResults: POICard[];
  voiceMutedRef: MutableRefObject<boolean>;
  lanePulseOn: boolean;
}

export function useDrivingAlerts({
  speed,
  speedLimit,
  navigating,
  userCoords,
  userHeading,
  route,
  cameraResults,
  voiceMutedRef,
  lanePulseOn,
}: UseDrivingAlertsArgs) {
  const { playSpeedAlert, playCameraAlert } = useSoundAlerts(voiceMutedRef);
  const [cameraAlert, setCameraAlert] = useState<{ dist: number; name: string } | null>(null);
  const [overtakingResults, setOvertakingResults] = useState<ProximityAlerts['overtaking']>([]);
  const [tunnelWarning, setTunnelWarning] = useState<string | null>(null);

  const cameraFlashAnim    = useRef(new Animated.Value(0)).current;
  const speedingFlash      = useRef(new Animated.Value(0)).current;
  const laneGlowAnim       = useRef(new Animated.Value(0)).current;
  const laneGlowLoop       = useRef<Animated.CompositeAnimation | null>(null);
  const lastCameraWarnRef  = useRef<number>(0);
  const lastSpeedAlarmRef  = useRef<number>(0);

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
    if (!voiceMutedRef.current) ttsSpeak(`Надвишихте разрешената скорост. Лимит ${speedLimit} км/ч.`);
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
    setCameraAlert({ dist: Math.max(0, Math.round(nearest.alongRouteM)), name: nearest.name });
    const now = Date.now();
    if (now - lastCameraWarnRef.current >= 10_000) {
      lastCameraWarnRef.current = now;
      playCameraAlert();
      if (!voiceMutedRef.current) ttsSpeak(`Наближавате радар за скорост. ${Math.max(0, Math.round(nearest.alongRouteM))} метра.`);
      Animated.sequence([
        Animated.timing(cameraFlashAnim, { toValue: 1, duration: 180, useNativeDriver: false }),
        Animated.timing(cameraFlashAnim, { toValue: 0, duration: 180, useNativeDriver: false }),
        Animated.timing(cameraFlashAnim, { toValue: 1, duration: 180, useNativeDriver: false }),
        Animated.timing(cameraFlashAnim, { toValue: 0, duration: 350, useNativeDriver: false }),
      ]).start();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userCoords, navigating, route, cameraResults, playCameraAlert, voiceMutedRef, userHeading]);

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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const laneGlowBg = useMemo(() => laneGlowAnim.interpolate({
    inputRange: [0, 1], outputRange: ['rgba(0,191,255,0.22)', 'rgba(0,191,255,0.60)'],
  }), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const laneGlowShadow = useMemo(() => laneGlowAnim.interpolate({
    inputRange: [0, 1], outputRange: [0.55, 1.0],
  }), []);

  const speedingBg      = speed > (speedLimit ?? Infinity) ? '#FF3B30' : 'transparent';
  const proximityAlerts = { overtaking: overtakingResults };

  return {
    cameraAlert,
    setCameraAlert,
    overtakingResults,
    setOvertakingResults,
    tunnelWarning,
    setTunnelWarning,
    cameraFlashAnim,
    speedingFlash,
    laneGlowBg,
    laneGlowShadow,
    speedingBg,
    proximityAlerts,
    playCameraAlert,
  };
}
