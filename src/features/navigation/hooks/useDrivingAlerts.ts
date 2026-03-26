import { useState, useRef, useEffect, useMemo } from 'react';
import { Animated } from 'react-native';
import type { MutableRefObject } from 'react';
import { haversineMeters, ttsSpeak } from '../utils/mapUtils';
import type { POICard, ProximityAlerts } from '../../../shared/services/backendApi';
import { useSoundAlerts } from './useSoundAlerts';

interface UseDrivingAlertsArgs {
  speed: number;
  speedLimit: number | null;
  navigating: boolean;
  userCoords: [number, number] | null;
  cameraResults: POICard[];
  voiceMutedRef: MutableRefObject<boolean>;
  lanePulseOn: boolean;
}

export function useDrivingAlerts({
  speed,
  speedLimit,
  navigating,
  userCoords,
  cameraResults,
  voiceMutedRef,
  lanePulseOn,
}: UseDrivingAlertsArgs) {
  const { playSpeedAlert, playCameraAlert } = useSoundAlerts(voiceMutedRef);
  const [cameraAlert, setCameraAlert] = useState<{ dist: number; name: string } | null>(null);
  const [overtakingResults, setOvertakingResults] = useState<ProximityAlerts['overtaking']>([]);
  const [tunnelWarning, setTunnelWarning] = useState<string | null>(null);

  const cameraFlashAnim    = useRef(new Animated.Value(0)).current;
  const laneGlowAnim       = useRef(new Animated.Value(0)).current;
  const laneGlowLoop       = useRef<Animated.CompositeAnimation | null>(null);
  const lastCameraWarnRef  = useRef<number>(0);
  const lastSpeedAlarmRef  = useRef<number>(0);

  // ── Speed limit TTS alarm — fires once per 30 s when exceeding the limit ──
  useEffect(() => {
    if (!navigating || speedLimit == null || speed <= speedLimit) return;
    const now = Date.now();
    if (now - lastSpeedAlarmRef.current < 30_000) return;
    lastSpeedAlarmRef.current = now;
    playSpeedAlert();
    if (!voiceMutedRef.current) ttsSpeak(`Лимит ${speedLimit} км/ч.`);
  }, [speed, speedLimit, navigating, voiceMutedRef, playSpeedAlert]);

  // ── Speed camera proximity alert — TTS + flash every 10 s when < 600 m ──
  useEffect(() => {
    if (!navigating || !userCoords || cameraResults.length === 0) {
      setCameraAlert(null);
      return;
    }
    const nearest = cameraResults
      .filter(c => c.lat && c.lng)
      .map(c => ({ ...c, dist: haversineMeters(userCoords, [c.lng as number, c.lat as number]) }))
      .sort((a, b) => a.dist - b.dist)[0];
    if (!nearest || nearest.dist >= 600) { setCameraAlert(null); return; }
    setCameraAlert({ dist: Math.round(nearest.dist), name: nearest.name });
    const now = Date.now();
    if (now - lastCameraWarnRef.current >= 10_000) {
      lastCameraWarnRef.current = now;
      playCameraAlert();
      if (!voiceMutedRef.current) ttsSpeak(`Камера на ${Math.round(nearest.dist)} метра.`);
      Animated.sequence([
        Animated.timing(cameraFlashAnim, { toValue: 1, duration: 180, useNativeDriver: false }),
        Animated.timing(cameraFlashAnim, { toValue: 0, duration: 180, useNativeDriver: false }),
        Animated.timing(cameraFlashAnim, { toValue: 1, duration: 180, useNativeDriver: false }),
        Animated.timing(cameraFlashAnim, { toValue: 0, duration: 350, useNativeDriver: false }),
      ]).start();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userCoords, navigating, cameraResults, playCameraAlert, voiceMutedRef]);

  // ── Lane glow pulse — starts/stops based on lanePulseOn ──
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
    laneGlowBg,
    laneGlowShadow,
    speedingBg,
    proximityAlerts,
    playCameraAlert,
  };
}
