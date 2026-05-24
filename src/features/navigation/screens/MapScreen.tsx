import React, { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import {
  View,
  Alert,
  Linking,
  Share,
} from 'react-native';
import { buildGPX } from '../utils/gpxUtils';
import { useRouteAheadEvents } from '../hooks/useRouteAheadEvents';
import { selectTruckSituation } from '../utils/truckSituationSelector';
import TruckSituationRenderer from '../components/TruckSituationRenderer';
import Tts from 'react-native-tts';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import Mapbox, { LocationPuck } from '@rnmapbox/maps';

import { useVoice } from '../hooks/useVoice';
import { useTacho } from '../hooks/useTacho';
import { usePOI } from '../hooks/usePOI';
import { useChat } from '../hooks/useChat';
import { useSessionBootstrap } from '../hooks/useSessionBootstrap';

import type * as GeoJSON from 'geojson';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { spacing } from '../../../shared/constants/theme';
import { MAP_CENTER, BACKEND_URL } from '../../../shared/constants/config';
import { useVehicleStore } from '../../../store/vehicleStore';
import type { VehicleProfile } from '../../../shared/types/vehicle';
import type { RootStackParamList } from '../../../shared/types/navigation';
import ChatPanel from '../components/ChatPanel';
import NavigationHUD from '../components/NavigationHUD';
import NavigationArrow from '../components/NavigationArrow';
import RouteOptionsPanel from '../components/RouteOptionsPanel';
import RestrictionSign from '../components/RestrictionSign';
import FuelPanel from '../components/FuelPanel';
import MapLayers from '../components/MapLayers';
import ParkingResultsPanel from '../components/ParkingResultsPanel';
import FuelResultsPanel from '../components/FuelResultsPanel';
import BusinessResultsPanel from '../components/BusinessResultsPanel';
import POISearchResults from '../components/POISearchResults';
import ChatFABs from '../components/ChatFABs';
import TiltControls from '../components/TiltControls';
import SpeedCameraHUD from '../components/SpeedCameraHUD';
import RecenterButton from '../components/RecenterButton';
import TunnelWarningBanner from '../components/TunnelWarningBanner';
import NavigationTopPanel from '../components/NavigationTopPanel';
import LaneGuidanceStrip from '../components/LaneGuidanceStrip';
import StatusChips from '../components/StatusChips';
import BorderCrossingsPanel from '../components/BorderCrossingsPanel';
import VehicleBadge from '../components/VehicleBadge';
import WakeWordIndicator from '../components/WakeWordIndicator';
import OfflineBanner from '../components/OfflineBanner';
import SearchBarContainer from '../components/SearchBarContainer';
import type { RestrictionPoint } from '../api/directions';
import OptionsPanel from '../components/OptionsPanel';
import RouteTimeline from '../components/RouteTimeline';
import FasterRouteBanner from '../components/FasterRouteBanner';
import { useFasterRouteCheck } from '../hooks/useFasterRouteCheck';
import GoogleAccountModal from '../components/GoogleAccountModal';
import type { GeoPlace } from '../api/geocoding';
import {
  optimizeWaypointOrder,
  type RouteResult,
} from '../api/directions';
import {
  sendGeminiMessage,
  listStarred,
  checkTruckRestrictions,
  pingBackend,
  searchNearbyParking,
  type POICard,
  type RouteOption,
  type AppIntent,
  type TachoSummary,
  reportCamera,
} from '../../../shared/services/backendApi';
import { getDaySummary, getWeeklySummary } from '../../tacho/TachoEventLog';
import ParkingBubble from '../components/ParkingBubble';
import TachoResultCard from '../components/TachoResultCard';
import { styles, NEON } from './MapScreen.styles';
import {
  NAV_ARROW, SIGN_CLOSED, SIGN_DANGER0, STAR_ICON,
  ICON_PARKING, ICON_FUEL, ICON_CAMERA, ICON_DESTINATION, ICON_BIZ, ICON_NO_OVERTAKING,
  APP_URL_MAP, HOS_LIMIT_S, type DepartLabel, departIso,
  ttsSpeak,
  haversineMeters, pointToSegmentDistanceMeters, openInBrowser, getTransParkingUrl,
  StableCamera,
} from '../utils/mapUtils';
import { useMapUIState } from '../hooks/useMapUIState';
import { useNavigationState } from '../hooks/useNavigationState';
import { useRouteInsights } from '../hooks/useRouteInsights';
import { useRouteOrchestrator } from '../hooks/useRouteOrchestrator';
import { useDrivingAlerts } from '../hooks/useDrivingAlerts';
import { STRUCTURE_WARNING_DISMISS_MS, useLocationRuntime } from '../hooks/useLocationRuntime';
import { useSimulation } from '../hooks/useSimulation';
import { useWakeWord } from '../hooks/useWakeWord';
import { useChatPanelsState } from '../hooks/useChatPanelsState';
import { useMapGeoJSON } from '../hooks/useMapGeoJSON';

type MapNavProp = NativeStackNavigationProp<RootStackParamList, 'Map'>;

// AudioRecorderPlayer is exported as a ready-made singleton — use directly

const RESTRICTION_ROUTE_BUFFER_M = 90;
const ACCESS_RESTRICTION_ROUTE_BUFFER_M = 130;
const MAX_MAP_RESTRICTION_MARKERS = 14;
const HGV_LEGAL_THRESHOLD_T = 3.5;

function routeOptionAnalysisKey(option: RouteOption, profile: VehicleProfile): string {
  const coords = option.geometry.coordinates as [number, number][];
  const first = coords[0];
  const mid = coords[Math.floor(coords.length / 2)];
  const last = coords[coords.length - 1];
  const routeKey = [first, mid, last]
    .filter(Boolean)
    .map(([lng, lat]) => `${lng.toFixed(4)},${lat.toFixed(4)}`)
    .join('|');
  return [
    Math.round(option.distance / 1000),
    Math.round(option.duration / 60),
    routeKey,
    profile.weight_t,
    profile.height_m,
    profile.width_m,
    profile.length_m,
    profile.hazmat_class ?? 'none',
  ].join('|');
}

function isRestrictionRelevantToProfile(restriction: RestrictionPoint, profile: VehicleProfile | null): boolean {
  if (!profile) return true;

  const limit = Number(restriction.value_num);
  const hasLimit = Number.isFinite(limit);

  if (restriction.type === 'maxheight') {
    return hasLimit && profile.height_m + 0.2 >= limit;
  }
  if (restriction.type === 'maxwidth') {
    return hasLimit && profile.width_m + 0.05 >= limit;
  }
  if (restriction.type === 'maxweight') {
    return hasLimit && profile.weight_t + 0.05 >= limit;
  }
  if (restriction.type === 'no_trucks') {
    return profile.weight_t >= 3.5 || profile.length_m > 6.0;
  }
  if (restriction.type === 'hazmat') {
    const hazmat = String(profile.hazmat_class ?? 'none').toLowerCase();
    return hazmat !== '' && hazmat !== 'none' && hazmat !== '0' && hazmat !== 'false';
  }
  return true;
}

function restrictionDistanceToRouteM(
  restriction: RestrictionPoint,
  coords: [number, number][],
): number {
  if (coords.length === 0) return Infinity;
  const point: [number, number] = [restriction.lng, restriction.lat];
  if (coords.length === 1) return haversineMeters(point, coords[0]);

  let best = Infinity;
  for (let i = 1; i < coords.length; i += 1) {
    const distance = pointToSegmentDistanceMeters(point, coords[i - 1], coords[i]);
    if (distance < best) best = distance;
  }
  return best;
}

function isRestrictionCloseToRoute(
  restriction: RestrictionPoint,
  coords: [number, number][],
): boolean {
  const bufferM =
    restriction.type === 'no_trucks' || restriction.type === 'hazmat'
      ? ACCESS_RESTRICTION_ROUTE_BUFFER_M
      : RESTRICTION_ROUTE_BUFFER_M;
  return restrictionDistanceToRouteM(restriction, coords) <= bufferM;
}

function isHighSignalMapRestriction(
  restriction: RestrictionPoint,
  profile: VehicleProfile | null,
): boolean {
  if (restriction.type === 'no_trucks' || restriction.type === 'hazmat') return true;
  if (restriction.type === 'maxheight' || restriction.type === 'maxwidth') return true;

  if (restriction.type === 'maxweight') {
    const limit = Number(restriction.value_num);
    if (!Number.isFinite(limit)) return false;
    if (limit <= HGV_LEGAL_THRESHOLD_T) return true;

    const truckWeight = profile?.weight_t;
    return (
      typeof truckWeight === 'number' &&
      Number.isFinite(truckWeight) &&
      truckWeight > limit &&
      limit >= truckWeight - 2
    );
  }

  return true;
}

function restrictionDisplayRank(
  restriction: RestrictionPoint,
  profile: VehicleProfile | null,
): number {
  if (restriction.type === 'no_trucks') return 0;
  if (restriction.type === 'hazmat') return 1;
  if (restriction.type === 'maxheight') return 2;
  if (restriction.type === 'maxwidth') return 3;
  if (restriction.type === 'maxweight') {
    const limit = Number(restriction.value_num);
    if (Number.isFinite(limit) && limit <= HGV_LEGAL_THRESHOLD_T) return 4;
    const truckWeight = profile?.weight_t;
    if (
      typeof truckWeight === 'number' &&
      Number.isFinite(truckWeight) &&
      truckWeight > limit &&
      limit >= truckWeight - 2
    ) {
      return 5;
    }
    return 9;
  }
  return 10;
}

function congestionGeoJSONForOption(option: RouteOption): GeoJSON.FeatureCollection {
  if (option.congestion_geojson?.type === 'FeatureCollection') {
    return option.congestion_geojson as GeoJSON.FeatureCollection;
  }
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { congestion: option.traffic === 'heavy' ? 'heavy' : option.traffic === 'moderate' ? 'moderate' : 'low' },
      geometry: option.geometry,
    }],
  };
}

function routeFromOption(option: RouteOption): RouteResult {
  return {
    geometry: option.geometry,
    distance: option.distance,
    duration: option.duration,
    maxspeeds: (option.maxspeeds ?? []) as RouteResult['maxspeeds'],
    congestion: [],
    congestionGeoJSON: congestionGeoJSONForOption(option),
    steps: (option.steps ?? []) as RouteResult['steps'],
    restrictions: (option.restrictions ?? []) as RouteResult['restrictions'],
    traffic_alerts: option.traffic_alerts ?? [],
    alternatives: [],
    optimizedWaypointOrder: null,
  };
}

function trafficAlertsToGeoJSON(alerts?: RouteOption['traffic_alerts']): GeoJSON.FeatureCollection | null {
  if (!alerts?.length) return null;
  return {
    type: 'FeatureCollection',
    features: alerts.map((a: any) => ({
      type: 'Feature' as const,
      properties: { label: a.label ?? `🛑 +${a.delay_min} мин`, severity: a.severity },
      geometry: { type: 'Point' as const, coordinates: [a.lng, a.lat] },
    })),
  };
}

function extractRequestedDriveMinutes(text: string): number | null {
  const msg = text.toLowerCase();
  let total = 0;

  for (const match of msg.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:ч|час|часа|часове|h|hr|hour|hours)\b/g)) {
    const hours = Number(match[1].replace(',', '.'));
    if (Number.isFinite(hours)) total += Math.round(hours * 60);
  }
  for (const match of msg.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:мин|минута|минути|min|mins|minutes)\b/g)) {
    const mins = Number(match[1].replace(',', '.'));
    if (Number.isFinite(mins)) total += Math.round(mins);
  }

  return total > 0 ? total : null;
}

function isReachQuestion(text: string): boolean {
  const msg = text.toLowerCase();
  return (
    /до\s*къде|докъде|до\s*каде|докаде|къде ще стиг|каде ще стиг|къде мога да стиг|каде мога да стиг|ще стигна|ще стигнем|мога ли да стиг|стигам ли/.test(msg) ||
    /where can i|how far|reach/.test(msg)
  );
}

const TRUCK_SPEED_CAP_KMH = 90;

function truckCappedRouteDurationS(distanceM: number, durationS: number): number {
  return Math.max(durationS, (distanceM / 1000 / TRUCK_SPEED_CAP_KMH) * 3600);
}

function coordinateAtRouteDistance(
  coords: [number, number][],
  targetM: number,
): [number, number] | null {
  if (coords.length === 0) return null;
  if (coords.length === 1 || targetM <= 0) return coords[0];

  let travelled = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const prev = coords[i - 1];
    const next = coords[i];
    const segM = haversineMeters(prev, next);
    if (travelled + segM >= targetM) {
      const t = segM > 0 ? (targetM - travelled) / segM : 0;
      return [
        prev[0] + (next[0] - prev[0]) * t,
        prev[1] + (next[1] - prev[1]) * t,
      ];
    }
    travelled += segM;
  }

  return coords[coords.length - 1];
}

// ── Component ────────────────────────────────────────────────────────

const MapScreen: React.FC = () => {
  const navigation = useNavigation<MapNavProp>();
  const insets = useSafeAreaInsets();
  const { profile } = useVehicleStore();
  const cameraRef = useRef<any>(null);

  // ── States & Refs ──────────────────────────────────────────────────────────
  const {
    mapLoaded, setMapLoaded,
    mapMode, setMapMode,
    lightMode, setLightMode,
    mapLayers,
    toggleLayer,
    trafficKey,
    optionsOpen, setOptionsOpen,
  } = useMapUIState();

  const setMapIsLoaded = setMapLoaded; // alias used throughout JSX

  const {
    navPhase, setNavPhase,
    navigating,
    loadingRoute,
    rerouting,
    route, setRoute,
    departLabel, setDepartLabel,
    currentStep, setCurrentStep,
    distToTurn, setDistToTurn,
    speedLimit, setSpeedLimit,
    remainingSeconds, setRemainingSeconds,
    routeOptions, setRouteOptions,
    routeOptDest, setRouteOptDest,
    selectedRouteIdx, setSelectedRouteIdx,
    departAt, setDepartAt,
    mapPitch, setMapPitch,
    waypoints, setWaypoints,
    waypointNames, setWaypointNames,
    restrictionChecking, setRestrictionChecking,
    restrictionWarnings, setRestrictionWarnings,
    avoidUnpaved, setAvoidUnpaved,
  } = useNavigationState();

  const [reachMarker, setReachMarker] = useState<{ coords: [number, number]; label: string } | null>(null);
  const navigatingRef = useRef(false);
  useEffect(() => { navigatingRef.current = navigating; }, [navigating]);
  const routeRef = useRef<RouteResult | null>(null);
  useEffect(() => { routeRef.current = route; }, [route]);

  const isMountedRef = useRef(true);
  useEffect(() => () => { isMountedRef.current = false; }, []);

  const profileRef         = useRef<VehicleProfile | null>(null);
  const stoppedSinceRef    = useRef<number | null>(null);
  const lastRestrictionRef = useRef<number>(0);
  const activeStructureWarningKeyRef = useRef<string | null>(null);
  const dismissedStructureWarningsRef = useRef<Map<string, number>>(new Map());
  const orchestratorUserCoordsRef = useRef<[number, number] | null>(null);
  const buildRoutePOIScanRef = useRef<(r: RouteResult) => void>(() => {});
  const setNavCongestionGeoJSONRef = useRef<(geojson: GeoJSON.FeatureCollection | null) => void>(() => {});
  const restrictionAnalysisCacheRef = useRef<Map<string, string[]>>(new Map());
  // These must be declared before useRouteOrchestrator / useLocationRuntime to avoid TDZ
  const [navCongestionGeoJSON, setNavCongestionGeoJSON] = useState<GeoJSON.FeatureCollection | null>(null);
  const [navTrafficAlerts, setNavTrafficAlerts]         = useState<GeoJSON.FeatureCollection | null>(null);
  const setTunnelWarningRef = useRef<(msg: string | null) => void>(() => {});
  // POI result states — declared early so useRouteOrchestrator can auto-populate them on route set
  const [parkingResults, setParkingResults]   = useState<POICard[]>([]);
  const [fuelResults, setFuelResults]         = useState<POICard[]>([]);
  const [cameraResults, setCameraResults]     = useState<POICard[]>([]);
  // Declared early — passed to useRouteOrchestrator / useLocationRuntime
  const [backendOnline, setBackendOnline] = useState(true);

  useEffect(() => { profileRef.current         = profile;          }, [profile]);

  const {
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
  } = useRouteOrchestrator({
    isMountedRef,
    navigatingRef,
    routeRef,
    profileRef,
    userCoordsRef: orchestratorUserCoordsRef,
    cameraRef,
    profile,
    departAt,
    avoidUnpaved,
    waypoints,
    waypointNames,
    buildRoutePOIScan: (r) => buildRoutePOIScanRef.current(r),
    setCameraResults,
    setRoute,
    setNavPhase,
    setCurrentStep,
    setSpeedLimit,
    setDistToTurn,
    setNavCongestionGeoJSON: (geojson) => setNavCongestionGeoJSONRef.current(geojson),
    setWaypoints,
    setWaypointNames,
    setRouteOptions,
    setRouteOptDest,
    setBackendOnline,
  });

  const destination = destinationRef.current;
  const destinationName = destinationNameRef.current;
  useEffect(() => { setReachMarker(null); }, [destinationName, route?.distance, route?.duration]);

  // ── States & Refs from useLocationRuntime ──────────────────────────
  const {
    userCoords,
    userCoordsRef,
    setUserCoords,
    userHeading,
    setUserHeading,
    gpsReady,
    speed,
    setSpeed,
    isDrivingRef,
  } = useLocationRuntime({
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
    dismissedStructureWarningsRef,
    avoidUnpavedRef,
    setTunnelWarning: (msg, key) => {
      activeStructureWarningKeyRef.current = msg ? (key ?? null) : null;
      setTunnelWarningRef.current(msg);
    },
    setSpeedLimit,
    setCurrentStep,
    setDistToTurn,
    setNavPhase,
    setRoute,
    setNavCongestionGeoJSON,
    setBackendOnline,
    navigating,
  });

  const { simulating, startSim, stopSim } = useSimulation({
    route,
    setUserCoords,
    setSpeed,
    setUserHeading,
  });
  // Sync GPS userCoordsRef → orchestratorUserCoordsRef so navigateTo uses real position
  useLayoutEffect(() => {
    orchestratorUserCoordsRef.current = userCoordsRef.current;
  }, [userCoords]);

  // ── Hooks Integration ──────────────────────────────────────────────

  // 0. Session bootstrap (account, starred POIs, backend health)
  const setTachoSummaryRef = useRef<(summary: TachoSummary) => void>(() => {});

  const {
    googleUser,
    setGoogleUser,
    googleUserRef,
    showAccountModal,
    setShowAccountModal,
    starredPOIs,
    setStarredPOIs,
  } = useSessionBootstrap({ setTachoSummaryRef });

  const {
    voiceMuted, setVoiceMuted, voiceMutedRef, lastSpokenStepRef, speak
  } = useVoice(navigating, currentStep, route);

  // 2. Tacho & HOS
  const handleEndOfDay = useCallback(async () => {
    try {
      const [daySummary, weeklySummary] = await Promise.all([getDaySummary(), getWeeklySummary()]);
      const ds = daySummary as any;
      const ws = weeklySummary as any;
      const summaryPrompt =
        `Направи кратко гласово обобщение на работния ден. ` +
        `Изкарано днес: ${ds.driven_today_min ?? 0} мин, оставащо: ${ds.remaining_today_min ?? 0} мин, ` +
        `смяната свършва в ${ds.shift_end_at ?? 'н/д'}. ` +
        `Седмично изкарано: ${Math.round((ws.weekly_driven_min ?? 0) / 60 * 10) / 10}ч от 56ч, ` +
        `оставащо: ${Math.round((ws.weekly_remaining_min ?? 0) / 60 * 10) / 10}ч. ` +
        `Говори на български, обърни се 'Колега', бъди кратък (2-3 изречения).`;

      const response = await sendGeminiMessage(summaryPrompt, [], {}, 'system');
      if (response.ok) {
        const text = (response.reply ?? '').trim();
        if (text) { speak(text); }
      }
    } catch {
      // silent — end-of-day summary is non-critical
    }
  }, [speak]);

  const {
    drivingSeconds, tachoSummary, setTachoSummary, resetSession, saveSession
  } = useTacho(
    navigating, isDrivingRef, googleUserRef, speak, handleEndOfDay,
    (remMin) => {
      ttsSpeak(`Колега, остават ${remMin} минути каране. Търся паркинг...`);
      if (userCoords) {
        searchNearbyParking(userCoords[1], userCoords[0], 20000)
          .then(results => { if (results.length > 0) setParkingResults(results.slice(0, 5)); })
          .catch(() => {});
      }
    }
  );
  useLayoutEffect(() => { setTachoSummaryRef.current = setTachoSummary; });

  // 3. POI Search (Nearby & Along Route)
  const {
    poiCategory, poiResults, loadingPOI, sarMode, handlePOISearch, handleSARSearch, clearPOI
  } = usePOI(userCoordsRef, routeRef, MAP_CENTER);

  // 4. AI Chat (GPT-4o + Gemini)
  const showReachMarkerForText = useCallback((text: string) => {
    if (!route || !isReachQuestion(text)) return;

    const requestedMin = extractRequestedDriveMinutes(text)
      ?? Math.max(0, Math.round((HOS_LIMIT_S - drivingSeconds) / 60));
    if (requestedMin <= 0 || route.duration <= 0 || route.distance <= 0) return;

    const truckCappedDurationS = truckCappedRouteDurationS(route.distance, route.duration);
    const targetM = Math.min(route.distance, route.distance * ((requestedMin * 60) / truckCappedDurationS));
    const coords = route.geometry.coordinates as [number, number][];
    const point = coordinateAtRouteDistance(coords, targetM);
    if (!point) return;

    const label = targetM >= route.distance
      ? 'Стигаш'
      : `Дотук ${Math.round(targetM / 1000)}км`;
    setReachMarker({ coords: point, label });
    cameraRef.current?.animateToRegion({
      latitude: point[1],
      longitude: point[0],
      latitudeDelta: 0.35,
      longitudeDelta: 0.35,
    }, 700);
  }, [drivingSeconds, route]);

  const {
    gptHistory, setGptHistory,
    geminiHistory, setGeminiHistory,
    gptChatOpen, setGptChatOpen,
    geminiChatOpen, setGeminiChatOpen,
    chatInput, setChatInput,
    selectedParking, setSelectedParking,
    selectedFuel, setSelectedFuel,
    businessResults, setBusinessResults,
    tachographResult, setTachographResult,
    isRecording,
    micLoading,
    kbHeight,
    gptScrollRef, geminiScrollRef,
    handleChat: handleChatState,
    handleMicStart: handleMicStartState,
    handleMicStop: handleMicStopState,
  } = useChatPanelsState();

  const {
    gptLoading, geminiLoading, sendGptText, sendGeminiText
  } = useChat({
    userCoords, drivingSeconds, speed, profile, tachoSummary, parkingResults,
    route, destinationName,
    gptHistory, setGptHistory,
    geminiHistory, setGeminiHistory,
    googleUser,
    voiceMutedRef, 
    navigateTo: (d, n, w, a) => navigateTo(d, n, w, a),
    addWaypoint: (c, n) => addWaypoint(c, n),
    setParkingResults, setFuelResults, setCameraResults, setBusinessResults,
    setRouteOptions, setRouteOptDest, setRoute, setDestination,
    setTachographResult,
    handleAppIntent: (intent) => handleAppIntent(intent),
    onReachQuestion: showReachMarkerForText,
  });

  const handleChat = useCallback(() => handleChatState(sendGptText, sendGeminiText, gptChatOpen), [handleChatState, sendGptText, sendGeminiText, gptChatOpen]);
  const handleMicStart = useCallback(() => handleMicStartState(AudioRecorderPlayer), [handleMicStartState]);
  const handleMicStop = useCallback(() => handleMicStopState(AudioRecorderPlayer, handleChat), [handleMicStopState, handleChat]);

  // ── Hands-free wake word: "Колега, <команда>" ──────────────────────
  const [wakeWordHeard, setWakeWordHeard] = useState(false); // brief visual flash

  const handleWakeCommand = useCallback((cmd: string) => {
    if (!cmd) return;
    setWakeWordHeard(true);
    setTimeout(() => setWakeWordHeard(false), 1200);
    sendGeminiText(cmd);
  }, [sendGeminiText]);

  useWakeWord({ active: navigating, onCommand: handleWakeCommand });

  // Border crossings
  const [borderCrossings, setBorderCrossings] = useState<Array<{
    name: string; flag: string; status: string; url: string;
  }>>([]);
  const [showBorderPanel, setShowBorderPanel] = useState(false);

  // ── GPS / route / waypoint state ───────────────────────────────────
  const {
    elevProfile,
    weatherPoints,
    routeAheadPOIs,
    hillWarnings,
    buildElevProfile,
    fetchWeatherForRoute,
    buildRoutePOIScan,
  } = useRouteInsights(route, userCoords, { navigating, setParkingResults, setFuelResults });

  useEffect(() => { buildRoutePOIScanRef.current = buildRoutePOIScan; }, [buildRoutePOIScan]);
  useEffect(() => { setNavCongestionGeoJSONRef.current = setNavCongestionGeoJSON; }, [setNavCongestionGeoJSON]);

  // ── Faster route detection ─────────────────────────────────────────
  const { offer: fasterOffer, acceptOffer, dismissOffer } = useFasterRouteCheck({
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
  });

  // Apply the faster route when user accepts
  const handleAcceptFasterRoute = useCallback(() => {
    if (!fasterOffer) return;
    setRoute(fasterOffer.route);
    setNavCongestionGeoJSON(fasterOffer.route.congestionGeoJSON ?? null);
    acceptOffer();
  }, [fasterOffer, acceptOffer, setRoute, setNavCongestionGeoJSON]);

  const [longPressCoord, setLongPressCoord] = useState<[number, number] | null>(null);
  const [customOriginName, setCustomOriginName] = useState('');
  const [isTracking, setIsTracking] = useState(true);
  const [autoRetrackNonce, setAutoRetrackNonce] = useState(0);
  const shouldCenterOnIdleGpsRef = useRef(true);
  const autoRetrackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressPanUntilRef = useRef(0);
  const lastMapTouchAtRef = useRef(0);
  const backendPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const offRouteCountRef   = useRef(0);
  const lastRerouteTimeRef = useRef(0); // cooldown — min 45s between reroutes

  // ── Helper: Point-to-polyline distance (meters) ────────────────────
  const getDistToRoute = useCallback((pos: [number, number], routeObj: RouteResult) => {
    const coords = routeObj.geometry.coordinates;
    if (!coords || coords.length < 2) return Infinity;

    // Step 1: find nearest vertex index
    let nearestIdx = 0;
    let nearestD = Infinity;
    for (let i = 0; i < coords.length; i++) {
      const d = haversineMeters(pos, [coords[i][0], coords[i][1]]);
      if (d < nearestD) { nearestD = d; nearestIdx = i; }
    }

    // Step 2: check ±30 segments with true perpendicular projection
    const fromIdx = Math.max(0, nearestIdx - 1);
    const toIdx   = Math.min(coords.length - 2, nearestIdx + 30);
    let minD = Infinity;

    for (let i = fromIdx; i <= toIdx; i++) {
      const ax = coords[i][0],   ay = coords[i][1];
      const bx = coords[i+1][0], by = coords[i+1][1];
      const px = pos[0],          py = pos[1];

      const dx = bx - ax, dy = by - ay;
      const lenSq = dx * dx + dy * dy;

      // Project P onto segment AB, clamp t to [0,1]
      const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
      const closest: [number, number] = [ax + t * dx, ay + t * dy];

      const d = haversineMeters(pos, closest);
      if (d < minD) minD = d;
    }
    return minD;
  }, []);

  const getBearingAtNearest = useCallback((pos: [number, number], routeObj: RouteResult): number => {
    const coords = routeObj.geometry.coordinates;
    let nearestIdx = 0;
    let nearestD = Infinity;
    for (let i = 0; i < coords.length; i++) {
      const d = haversineMeters(pos, [coords[i][0], coords[i][1]]);
      if (d < nearestD) { nearestD = d; nearestIdx = i; }
    }
    const i = Math.min(nearestIdx, coords.length - 2);
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const dLon = (p2[0] - p1[0]) * Math.PI / 180;
    const lat1 = p1[1] * Math.PI / 180;
    const lat2 = p2[1] * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    const brng = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    return brng;
  }, []);

  // ── Auto-reroute detection ─────────────────────────────────────────
  useEffect(() => {
    if (!navigating || !route || !destination || !userCoords) {
      offRouteCountRef.current = 0;
      return;
    }
    if (navPhase === 'REROUTING' || navPhase === 'SEARCHING') return;
    if (simulating) return; // never reroute during simulation

    const dist = getDistToRoute(userCoords, route);

    if (dist > 80 && userHeading !== null) {
      const routeBearing = getBearingAtNearest(userCoords, route);
      const diff = Math.abs(((userHeading - routeBearing) + 360) % 360);
      const angleDiff = diff > 180 ? 360 - diff : diff;
      if (angleDiff > 90) return;
    }

    if (dist > 80) {
      offRouteCountRef.current += 1;
    } else {
      offRouteCountRef.current = 0;
    }

    if (offRouteCountRef.current >= 3) {
      const now = Date.now();
      if (now - lastRerouteTimeRef.current < 45_000) return;
      offRouteCountRef.current = 0;
      lastRerouteTimeRef.current = now;
      if (!voiceMutedRef.current) { ttsSpeak('Отклонение! Преизчислявам маршрута.'); }
      navigateTo(destination, destinationName, waypoints, true);
    }
  }, [userCoords, userHeading, navigating, route, destination, destinationName, waypoints, navPhase, getDistToRoute, getBearingAtNearest, navigateTo]);

  const mapIsLoaded = mapLoaded;

  useEffect(() => {
    const hour = new Date().getHours();
    const isDay = hour >= 7 && hour < 19;
    setLightMode(isDay);
  }, [setLightMode]);

  useEffect(() => {
    pingBackend();
    const checkBackend = () => {
      fetch(`${BACKEND_URL}/api/health`, { method: 'GET' })
        .then(r => { if (r.ok) setBackendOnline(true); else setBackendOnline(false); })
        .catch(() => setBackendOnline(false));
    };
    checkBackend();
    backendPollRef.current = setInterval(checkBackend, 30_000);
    return () => { if (backendPollRef.current) clearInterval(backendPollRef.current); };
  }, []);

  useEffect(() => {
    if (!navigating || !route) { setRemainingSeconds(0); return; }
    navStartRef.current      = Date.now();
    navInitDurationRef.current = route.duration;
    setRemainingSeconds(route.duration);
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - navStartRef.current) / 1000);
      setRemainingSeconds(Math.max(0, navInitDurationRef.current - elapsed));
    }, 30_000);
    return () => clearInterval(interval);
  }, [navigating, route]);

  const handleMapLongPress = useCallback((event: any) => {
    const coords =
      event?.geometry?.coordinates ??
      event?.nativeEvent?.geometry?.coordinates ??
      event?.nativeEvent?.coordinates ??
      (event?.nativeEvent?.coordinate
        ? [event.nativeEvent.coordinate.longitude, event.nativeEvent.coordinate.latitude]
        : null);

    if (!Array.isArray(coords) || coords.length < 2) return;
    setLongPressCoord([coords[0], coords[1]]);
  }, []);

  const handleDestinationSelect = useCallback(
    (place: GeoPlace) => navigateTo(place.center, place.text),
    [navigateTo],
  );

  const handleStart = useCallback(() => {
    lastSpokenStepRef.current = -1;
    setCurrentStep(0);
    setDistToTurn(null);
    resetSession();
    if (mapMode !== 'vector') setMapMode('vector');

    // Re-enable camera tracking in case user had panned the map before starting.
    setIsTracking(true);
    // Set navigating LAST — StableCamera's followUserLocation will activate and
    // smoothly move the camera to the user. Do NOT call flyTo() here: it conflicts
    // with followUserLocation and crashes the native Camera animation node.
    setNavPhase('NAVIGATING');
    if (!voiceMutedRef.current) {
      Tts.stop();
      ttsSpeak('Следвайте маршрута.');
    }
  }, [mapMode, resetSession]);
  handleStartRef.current = handleStart;

  const handleStopNav = useCallback(() => {
    Tts.stop();
    setIsTracking(true);
    setNavPhase('ROUTE_PREVIEW');
    setNavCongestionGeoJSON(null);
    setNavTrafficAlerts(null);
    setMapPitch(0);
    setCurrentStep(0);
    setDistToTurn(null);
    lastRerouteRef.current = 0;
    saveSession();
  }, [saveSession, setNavPhase]);

  const handleClear = useCallback(() => {
    Tts.stop();
    setIsTracking(true);
    shouldCenterOnIdleGpsRef.current = true;
    lastSpokenStepRef.current = -1;
    setDestination(null);
    setDestinationName('');
    setRoute(null);
    setNavPhase('IDLE');
    setMapPitch(0);
    setCurrentStep(0);
    setSpeedLimit(null);
    setDistToTurn(null);
    clearPOI();
    setParkingResults([]);
    setFuelResults([]);
    setCameraResults([]);
    setBusinessResults([]);
    setReachMarker(null);
    setRouteOptions([]);
    setRouteOptDest(null);
    setSelectedRouteIdx(null);
    setRestrictionWarnings([]);
    setTachographResult(null);
    resetSession();
    setWaypoints([]);
    setWaypointNames([]);
    setLongPressCoord(null);
    setCameraAlert(null);
    waypointsRef.current     = [];
    waypointNamesRef.current = [];
    lastRerouteRef.current = 0;
    stopSim();
    cameraRef.current?.animateToRegion(
      userCoords
        ? {
            latitude: userCoords[1],
            longitude: userCoords[0],
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }
        : {
            latitude: MAP_CENTER.latitude,
            longitude: MAP_CENTER.longitude,
            latitudeDelta: 0.0922,
            longitudeDelta: 0.0421,
          },
      800,
    );
  }, [clearPOI, resetSession, stopSim, userCoords]);

  const handleOriginChange = useCallback((place: import('../api/geocoding').GeoPlace | null) => {
    customOriginRef.current = place?.center ?? null;
    setCustomOriginName(place?.text ?? '');
  }, []);

  const handleSelectRouteOption = useCallback(async (idx: number) => {
    setSelectedRouteIdx(idx);
    setRestrictionWarnings([]);
    const prof = profileRef.current;
    if (!prof) return;
    const option = routeOptions[idx];
    const coords = option?.geometry.coordinates;
    if (!option || !coords) return;

    const selectedRoute = routeFromOption(option);
    setRoute(selectedRoute);
    setNavCongestionGeoJSON(selectedRoute.congestionGeoJSON);
    setNavTrafficAlerts(trafficAlertsToGeoJSON(option.traffic_alerts));

    const cacheKey = routeOptionAnalysisKey(option, prof);
    const cachedWarnings = restrictionAnalysisCacheRef.current.get(cacheKey);
    if (cachedWarnings) {
      setRestrictionWarnings(cachedWarnings);
      return;
    }

    setRestrictionChecking(true);
    try {
      const result = await checkTruckRestrictions({
        weight_t:     prof.weight_t,
        height_m:     prof.height_m,
        width_m:      prof.width_m,
        length_m:     prof.length_m,
        hazmat_class: prof.hazmat_class ?? undefined,
      }, coords);
      restrictionAnalysisCacheRef.current.set(cacheKey, result.warnings);
      setRestrictionWarnings(result.warnings);
    } finally {
      setRestrictionChecking(false);
    }
  }, [routeOptions, setNavCongestionGeoJSON, setNavTrafficAlerts, setRoute]);

  useEffect(() => {
    if (!mapIsLoaded || navigating || !isTracking || !userCoords) return;
    if (!shouldCenterOnIdleGpsRef.current) return;

    cameraRef.current?.animateToRegion({
      latitude: userCoords[1],
      longitude: userCoords[0],
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    }, 800);
    shouldCenterOnIdleGpsRef.current = false;
  }, [isTracking, mapIsLoaded, navigating, userCoords]);

  const clearAutoRetrackTimer = useCallback(() => {
    if (autoRetrackTimerRef.current) {
      clearTimeout(autoRetrackTimerRef.current);
      autoRetrackTimerRef.current = null;
    }
  }, []);

  const handleUserMapPan = useCallback(() => {
    if (!navigating) return;
    const now = Date.now();
    if (now < suppressPanUntilRef.current) return;
    if (now - lastMapTouchAtRef.current > 1200) return;
    setIsTracking(false);
    setAutoRetrackNonce(n => n + 1);
  }, [navigating]);

  useEffect(() => {
    clearAutoRetrackTimer();
    if (!navigating || isTracking) return;

    autoRetrackTimerRef.current = setTimeout(() => {
      autoRetrackTimerRef.current = null;
      suppressPanUntilRef.current = Date.now() + 1500;
      setIsTracking(true);
    }, 10000);

    return clearAutoRetrackTimer;
  }, [autoRetrackNonce, clearAutoRetrackTimer, isTracking, navigating]);

  useEffect(() => clearAutoRetrackTimer, [clearAutoRetrackTimer]);

  const handleAppIntent = useCallback((intent: AppIntent) => {
    if (intent.url) {
      Linking.openURL(intent.url).catch(() => null);
      return;
    }
    if (intent.app.toLowerCase() === 'transparking') {
      const id = intent.transparking_id
        ?? selectedParking?.transparking_id
        ?? parkingResults[0]?.transparking_id;
      if (id) {
        getTransParkingUrl(id).then(url => navigation.navigate('TruckParking', { url }));
      } else {
        navigation.navigate('TruckParking', {});
      }
      return;
    }
    const builder = APP_URL_MAP[intent.app.toLowerCase()];
    const url = builder ? builder(intent.query) : null;
    if (!url) return;
    Linking.openURL(url).catch(() => {
      const q = intent.query ?? intent.app;
      Linking.openURL(`https://www.google.com/search?q=${encodeURIComponent(q)}`).catch(() => null);
    });
  }, [navigation, parkingResults, selectedParking]);

  const puckScale = useMemo(() => {
    if (!navigating || distToTurn == null || distToTurn > 300) return 0.48;
    if (distToTurn < 50)  return 0.7;
    if (distToTurn < 150) return 0.62;
    return 0.56;
  }, [navigating, distToTurn]);
  const showNavArrow = navigating && isTracking;

  useEffect(() => {
    if (navigating) return;
    const results = parkingResults.length > 0 ? parkingResults : businessResults;
    if (results.length === 0 || !cameraRef.current) return;
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    results.forEach(p => {
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
    });
    if (minLng === maxLng && minLat === maxLat) {
      cameraRef.current.animateToRegion({ latitude: minLat, longitude: minLng, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 800);
    } else {
      cameraRef.current.animateToRegion({
        latitude: (minLat + maxLat) / 2,
        longitude: (minLng + maxLng) / 2,
        latitudeDelta: Math.abs(maxLat - minLat) * 1.5,
        longitudeDelta: Math.abs(maxLng - minLng) * 1.5,
      }, 1000);
    }
  }, [parkingResults, businessResults, navigating]);

  const nearestParkingM = useMemo(() => {
    if (!parkingResults.length) return null;
    return Math.min(...parkingResults.map(p => p.distance_m));
  }, [parkingResults]);

  const dominantCongestion = useMemo(() => {
    const c = route?.congestion;
    if (!c?.length) return null;
    if (c.some(v => v === 'severe' || v === 'heavy')) return 'heavy';
    if (c.some(v => v === 'moderate')) return 'moderate';
    return 'low';
  }, [route]);

  const activeStep = route?.steps?.[currentStep];
  const nextStep   = route?.steps?.[currentStep + 1];
  const stepToShow = navigating ? activeStep : null;

  const routeRestrictionPoints = useMemo<RestrictionPoint[]>(() => {
    const coords = route?.geometry.coordinates ?? [];
    return (route?.restrictions ?? []).filter(
      r => isRestrictionRelevantToProfile(r, profile) && isRestrictionCloseToRoute(r, coords),
    );
  }, [profile, route?.geometry.coordinates, route?.restrictions]);

  const displayRestrictionPoints = useMemo<RestrictionPoint[]>(() => {
    const coords = route?.geometry.coordinates ?? [];
    return routeRestrictionPoints
      .filter(r => isHighSignalMapRestriction(r, profile))
      .slice()
      .sort((a, b) => {
        const rankDiff = restrictionDisplayRank(a, profile) - restrictionDisplayRank(b, profile);
        if (rankDiff !== 0) return rankDiff;
        return restrictionDistanceToRouteM(a, coords) - restrictionDistanceToRouteM(b, coords);
      })
      .slice(0, MAX_MAP_RESTRICTION_MARKERS);
  }, [profile, route?.geometry.coordinates, routeRestrictionPoints]);

  const activeRestriction = useMemo<RestrictionPoint | null>(() => {
    if (!navigating || !userCoords || !route || !routeRestrictionPoints.length) return null;
    const coords = route.geometry.coordinates;
    const ALERT_M = 600;
    let userIdx = 0;
    let userMinD = Infinity;
    for (let i = 0; i < coords.length; i++) {
      const d = haversineMeters(userCoords, [coords[i][0], coords[i][1]]);
      if (d < userMinD) { userMinD = d; userIdx = i; }
    }
    let nearest: RestrictionPoint | null = null;
    let nearestDist = Infinity;
    for (const r of routeRestrictionPoints) {
      let rIdx = 0;
      let rMinD = Infinity;
      for (let i = userIdx; i < coords.length; i++) {
        const d = haversineMeters([r.lng, r.lat], [coords[i][0], coords[i][1]]);
        if (d < rMinD) { rMinD = d; rIdx = i; }
      }
      if (rIdx > userIdx) {
        const dist = haversineMeters(userCoords, [r.lng, r.lat]);
        if (dist < ALERT_M && dist < nearestDist) {
          nearestDist = dist;
          nearest = r;
        }
      }
    }
    return nearest;
  }, [navigating, userCoords, route?.geometry.coordinates, routeRestrictionPoints]);

  const routeLineColor = dominantCongestion === 'heavy' ? '#FF3B30'
    : dominantCongestion === 'moderate' ? '#FF9500'
    : '#13BDFF';

  // ── Guidance engine (Garmin SID + SQLite + JCV equivalent) ──────────────
  const aheadEvents = useRouteAheadEvents({
    steps: route?.steps ?? [],
    currentStepIdx: currentStep,
    distToTurn,
    restrictions: routeRestrictionPoints,
    maxspeeds: route?.maxspeeds,
    userCoords,
    profile,
    remainingTachoSec: navigating ? Math.max(0, HOS_LIMIT_S - drivingSeconds) : undefined,
    totalRouteDistM: route?.distance,
    routeDurationSec: route
      ? truckCappedRouteDurationS(route.distance, remainingSeconds > 0 ? remainingSeconds : route.duration)
      : undefined,
  });
  const truckSituation = selectTruckSituation(aheadEvents);

  const useNavigationMapStyle = navigating || navPhase === 'NAVIGATING' || navPhase === 'REROUTING';
  const mapStyleURL: string =
    mapMode === 'hybrid' ? 'mapbox://styles/mapbox/satellite-streets-v12' :
    useNavigationMapStyle ?
      (lightMode ? 'mapbox://styles/mapbox/navigation-day-v1' : 'mapbox://styles/mapbox/navigation-night-v1') :
      JSON.stringify({
        version: 8,
        imports: [{ id: 'basemap', url: 'mapbox://styles/mapbox/standard', config: {
          lightPreset: lightMode ? 'day' : 'night',
          showPointOfInterestLabels: false,
          showTransitLabels: true,
          showPlaceLabels: true,
          showRoadLabels: true,
          showTrafficIncidents: true,
        }}],
      });

  const searchTop = insets.top + 18;
  const isSearchingAlongRoute = loadingPOI && sarMode;
  const handleSearchAlongRoute = () => {
    if (poiCategory) handleSARSearch(poiCategory);
  };

  const currentLanes = useMemo(() => {
    const components = stepToShow?.bannerInstructions?.[0]?.sub?.components;
    return Array.isArray(components)
      ? components.filter(c => c.type === 'lane')
      : [];
  }, [stepToShow]);

  const displayLanes = currentLanes;

  const lanePulseOn =
    navigating && distToTurn != null && distToTurn < 350 && displayLanes.some(l => l.active);

  const {
    cameraAlert, setCameraAlert,
    overtakingResults,
    tunnelWarning, setTunnelWarning,
    cameraFlashAnim,
    laneGlowBg, laneGlowShadow,
    speedingBg,
    proximityAlerts,
    playCameraAlert,
  } = useDrivingAlerts({
    speed, speedLimit, navigating,
    userCoords, userHeading, route, cameraResults,
    voiceMutedRef, lanePulseOn,
  });
  useLayoutEffect(() => { setTunnelWarningRef.current = setTunnelWarning; });
  const handleTunnelWarningDismiss = useCallback(() => {
    const key = activeStructureWarningKeyRef.current;
    if (key) {
      dismissedStructureWarningsRef.current.set(key, Date.now() + STRUCTURE_WARNING_DISMISS_MS);
    }
    activeStructureWarningKeyRef.current = null;
    setTunnelWarning(null);
  }, [setTunnelWarning]);

  // ── GeoJSON for all map layers ────────────────────────────────────────────
  const {
    exitsGeoJSON,
    navCongestionVisible,
  } = useMapGeoJSON({
    route,
    navigating,
    userCoords,
    navCongestionGeoJSON,
  });

  const routeShape = route
    ? ({ type: 'Feature', properties: {}, geometry: route.geometry } as const)
    : null;

  const didInitAvoidUnpavedRef = useRef(false);
  useEffect(() => {
    if (!didInitAvoidUnpavedRef.current) {
      didInitAvoidUnpavedRef.current = true;
      return;
    }
    const dest = destinationRef.current;
    if (dest) navigateTo(dest, destinationNameRef.current, waypointsRef.current);
  }, [avoidUnpaved, navigateTo]);

  const handlePOINavigate = useCallback((poi: import('../api/poi').TruckPOI) => {
    clearPOI();
    navigateTo(poi.coordinates, poi.name);
  }, [navigateTo, clearPOI]);

  const handleBizMarkerPress = useCallback((business: POICard) => {
    if (!Number.isFinite(business.lat) || !Number.isFinite(business.lng)) return;
    setBusinessResults([]);
    navigateTo([business.lng, business.lat], business.name || 'Място');
  }, [navigateTo, setBusinessResults]);

  const handleRouteTimelinePOIPress = useCallback((poi: import('../hooks/useRouteInsights').RoutePOI) => {
    const samePlace = (p: POICard) =>
      Math.abs(p.lng - poi.lng) < 0.00001 &&
      Math.abs(p.lat - poi.lat) < 0.00001;
    if (poi.type === 'fuel') {
      const fuel = fuelResults.find(samePlace) ?? {
        name: poi.name,
        lng: poi.lng,
        lat: poi.lat,
        distance_m: Math.round((poi.distFromUserKm ?? poi.distKm) * 1000),
      };
      setSelectedFuel(fuel);
    } else {
      const parking = parkingResults.find(samePlace) ?? {
        name: poi.name,
        lng: poi.lng,
        lat: poi.lat,
        distance_m: Math.round((poi.distFromUserKm ?? poi.distKm) * 1000),
      };
      setSelectedParking(parking);
    }
  }, [fuelResults, parkingResults, setSelectedFuel, setSelectedParking]);

  const handleReportCamera = useCallback(async () => {
    playCameraAlert();
    if (userCoords) {
      reportCamera(userCoords[1], userCoords[0], googleUser?.email);
    }
    Alert.alert('Благодарим!', 'Камерата е докладвана и ще бъде добавена към картата.');
  }, [playCameraAlert, userCoords, googleUser]);

  const pickDeparture = useCallback((label: DepartLabel) => {
    const iso = departIso(label);
    setDepartLabel(label);
    setDepartAt(iso);
    departAtRef.current = iso;
    const dest = destinationRef.current;
    if (dest) navigateTo(dest, destinationNameRef.current);
  }, [navigateTo]);

  const handleExportGPX = useCallback(() => {
    const coords = route?.geometry?.coordinates as [number, number][] | undefined;
    if (!coords?.length) {
      Alert.alert('Няма маршрут', 'Изберете маршрут, преди да го експортирате.');
      return;
    }
    const dest = destinationNameRef.current || 'Маршрут';
    const wps = waypointsRef.current ?? [];
    const wpNames = waypointNamesRef.current ?? [];
    const gpx = buildGPX(coords, dest, wps, wpNames);
    Share.share({ message: gpx, title: `${dest}.gpx` }).catch(() => {});
  }, [route, destinationNameRef, waypointsRef, waypointNamesRef]);

  const handleStartRoute = useCallback((_cong: any, _alerts: any) => {
    const selectedIdx = selectedRouteIdx ?? (routeOptions.length > 0 ? 0 : null);
    const selectedOption = selectedIdx == null ? null : routeOptions[selectedIdx];
    if (selectedOption?.geometry?.coordinates?.length) {
      const selectedRoute = routeFromOption(selectedOption);
      setRoute(selectedRoute);
      setNavCongestionGeoJSON(selectedRoute.congestionGeoJSON);
      setNavTrafficAlerts(trafficAlertsToGeoJSON(selectedOption.traffic_alerts));
      handleStart();
    } else if (routeOptDest) {
      navigateTo(routeOptDest.coords, routeOptDest.name, routeOptDest.waypoints, true);
    }
    setRouteOptions([]);
    setSelectedRouteIdx(null);
    setRestrictionWarnings([]);
  }, [handleStart, routeOptDest, routeOptions, selectedRouteIdx, navigateTo, setNavCongestionGeoJSON, setNavTrafficAlerts, setRoute,
      setRouteOptions, setSelectedRouteIdx, setRestrictionWarnings]);

  return (
    <View style={styles.container}>
      <OfflineBanner backendOnline={backendOnline} />

      {/* ── Map ── */}
      <Mapbox.MapView
        style={styles.map}
        styleURL={mapStyleURL}
        pitchEnabled
        scaleBarEnabled={false}
        attributionPosition={{ bottom: 8, left: 8 }}
        onDidFinishLoadingStyle={() => setMapIsLoaded(true)}
        onLongPress={handleMapLongPress}
        onTouchStart={() => {
          lastMapTouchAtRef.current = Date.now();
        }}
        onRegionIsChanging={(feature: any) => {
          if (navigating && isTracking && feature?.properties?.isUserInteraction) {
            handleUserMapPan();
          }
        }}
        onPress={() => {
          if (gptChatOpen) setGptChatOpen(false);
          if (geminiChatOpen) setGeminiChatOpen(false);
          if (longPressCoord) setLongPressCoord(null);
          if (selectedParking) setSelectedParking(null);
          if (selectedFuel) setSelectedFuel(null);
        }}
      >
        <Mapbox.Images
          images={{
            'nav-arrow':     NAV_ARROW,
            'sign-closed':   SIGN_CLOSED,
            'sign-danger-0': SIGN_DANGER0,
            'star-icon':     STAR_ICON,
            'parking-icon':  ICON_PARKING,
            'fuel-icon':     ICON_FUEL,
            'camera-icon':   ICON_CAMERA,
            'biz-icon':      ICON_BIZ,
            'no-overtaking': ICON_NO_OVERTAKING,
            'dest-flag':     ICON_DESTINATION,
          }}
          onImageMissing={(imageKey) => {
            console.warn('[Mapbox] missing image in atlas:', imageKey);
          }}
        />
        <StableCamera
          cameraRef={cameraRef}
          navigating={navigating}
          mapLoaded={mapIsLoaded}
          speed={speed}
          isTracking={isTracking}
          userCoords={userCoords}
        />

        <Mapbox.UserLocation visible={false} />

        <LocationPuck
          puckBearingEnabled={speed > 3}
          puckBearing="course"
          topImage="nav-arrow"
          bearingImage="nav-arrow"
          shadowImage="nav-arrow"
          scale={showNavArrow ? (['literal', 0] as const) : puckScale}
          pulsing={{ isEnabled: true, color: NEON, radius: 30 }}
          visible
        />
        <NavigationArrow
          visible={showNavArrow}
          situationKind={truckSituation.kind}
          anyExceeded={
            truckSituation.kind === 'composite_restriction'
              ? truckSituation.anyExceeded
              : false
          }
        />

        <MapLayers
          mapIsLoaded={mapIsLoaded}
          mapMode={mapMode}
          mapLayers={mapLayers}
          navigating={navigating}
          trafficKey={trafficKey}
          lightMode={lightMode}
          route={route}
          routeShape={routeShape}
          congestionGeoJSON={route?.congestionGeoJSON ?? null}
          routeLineColor={routeLineColor}
          exitsGeoJSON={exitsGeoJSON}
          navTrafficAlerts={navTrafficAlerts}
          customOriginRef={customOriginRef}
          userCoords={userCoords}
          destination={destination}
          parkingResults={parkingResults}
          reachMarker={reachMarker}
          fuelResults={fuelResults}
          starredPOIs={starredPOIs}
          businessResults={businessResults}
          cameraResults={cameraResults}
          overtakingResults={overtakingResults}
          navCongestionVisible={navCongestionVisible}
          routeOptions={routeOptions}
          selectedRouteIdx={selectedRouteIdx}
          setSelectedParking={setSelectedParking}
          setSelectedFuel={setSelectedFuel}
          onBizMarkerPress={handleBizMarkerPress}
          handleSelectRouteOption={handleSelectRouteOption}
          ttsSpeak={ttsSpeak}
          voiceMutedRef={voiceMutedRef}
          restrictionPoints={displayRestrictionPoints}
          poiResults={poiResults}
          handlePOINavigate={handlePOINavigate}
        />

      </Mapbox.MapView>

      {/* ── Search bar (hidden during navigation) ── */}
      <SearchBarContainer
        navigating={navigating}
        searchTop={searchTop}
        customOriginName={customOriginName}
        onSelect={handleDestinationSelect}
        onClear={handleClear}
        onOriginChange={handleOriginChange}
      />

      <TunnelWarningBanner
        message={tunnelWarning}
        visible={!!tunnelWarning && navigating}
        topOffset={insets.top}
        onDismiss={handleTunnelWarningDismiss}
      />

      {stepToShow && (
        <NavigationTopPanel
          visible={navigating && !!stepToShow}
          step={stepToShow}
          nextStep={nextStep ?? null}
          distToTurn={distToTurn}
          lanes={currentLanes}
          topOffset={insets.top + spacing.xs}
          aheadEvents={aheadEvents}
          aheadQueue={aheadEvents}
          activeSituationDistanceM={truckSituation.kind !== 'none' ? truckSituation.distanceM : undefined}
        />
      )}

      <LaneGuidanceStrip
        visible={navigating && distToTurn != null && distToTurn < 500 && displayLanes.length > 0}
        lanes={displayLanes}
        glowBg={laneGlowBg}
        glowShadow={laneGlowShadow}
      />


      {/* ── Route Timeline ── */}
      {route && (navigating || navPhase === 'ROUTE_PREVIEW') && (
        <RouteTimeline
          routeAheadPOIs={routeAheadPOIs}
          totalDistM={route.distance}
          onPOIPress={handleRouteTimelinePOIPress}
        />
      )}

      {/* ── Faster route banner ── */}
      <FasterRouteBanner
        offer={fasterOffer}
        onAccept={handleAcceptFasterRoute}
        onDismiss={dismissOffer}
        top={insets.top + 8}
      />

      {/* ── Options Panel ── */}
      <OptionsPanel
        optionsOpen={optionsOpen}
        setOptionsOpen={setOptionsOpen}
        mapMode={mapMode}
        setMapMode={setMapMode}
        lightMode={lightMode}
        setLightMode={setLightMode}
        voiceMuted={voiceMuted}
        setVoiceMuted={setVoiceMuted}
        mapLayers={mapLayers}
        toggleLayer={toggleLayer}
        avoidUnpaved={avoidUnpaved}
        setAvoidUnpaved={setAvoidUnpaved}
        navigating={navigating}
        route={route}
        simulating={simulating}
        startSim={startSim}
        stopSim={stopSim}
        poiCategory={poiCategory}
        handlePOISearch={handlePOISearch}
        sarMode={sarMode}
        handleSARSearch={handleSARSearch}
        googleUser={googleUser}
        setShowAccountModal={setShowAccountModal}
        starredPOIs={starredPOIs}
        setBorderCrossings={setBorderCrossings}
        setShowBorderPanel={setShowBorderPanel}
        searchTop={searchTop}
        isSearchingAlongRoute={isSearchingAlongRoute}
        handleSearchAlongRoute={handleSearchAlongRoute}
        setMapIsLoaded={setMapIsLoaded}
        userCoords={userCoords}
        onReportCamera={handleReportCamera}
        backendOnline={backendOnline}
      />

      <StatusChips gpsReady={gpsReady} rerouting={rerouting} loadingRoute={loadingRoute} />

      <BorderCrossingsPanel
        show={showBorderPanel}
        crossings={borderCrossings}
        onClose={() => setShowBorderPanel(false)}
      />

      <VehicleBadge plate={profile?.plate} navigating={navigating} searchTop={searchTop} />

      {/* ── POI / SAR results horizontal scroll ── */}
      {!navigating && (poiResults.length > 0 || loadingPOI) && (!route || sarMode) && (
        <POISearchResults
          poiResults={poiResults}
          loadingPOI={loadingPOI}
          sarMode={sarMode}
          searchTop={searchTop}
          onPOIPress={handlePOINavigate}
          onClearSAR={() => clearPOI()}
        />
      )}

      {!route && !navigating && (
        <ParkingResultsPanel
          parkingResults={parkingResults}
          searchTop={searchTop}
          onDismiss={() => setParkingResults([])}
          onNavigate={(coords, name) => navigateTo(coords, name)}
          onAddWaypoint={(coords, name) => addWaypoint(coords, name)}
          onClearSelectedParking={() => setSelectedParking(null)}
          onOpenInfo={async (p) => {
            if (p.transparking_id) {
              const url = await getTransParkingUrl(p.transparking_id);
              navigation.navigate('TruckParking', { url });
            } else if (p.website) {
              openInBrowser(p.website);
            } else {
              navigation.navigate('TruckParking', {});
            }
          }}
          onSpeak={(text) => ttsSpeak(text)}
        />
      )}

      {!route && (
        <FuelResultsPanel
          fuelResults={fuelResults}
          navigating={navigating}
          searchTop={searchTop}
          onDismiss={() => setFuelResults([])}
          onNavigate={(coords, name) => navigateTo(coords, name)}
          onAddWaypoint={(coords, name) => addWaypoint(coords, name)}
        />
      )}

      {/* ── Tachograph card from GPT-4o ── */}
      {tachographResult && (
        <TachoResultCard
          result={tachographResult}
          tachoSummary={tachoSummary}
          onClose={() => setTachographResult(null)}
          onNavigate={navigateTo}
          topOffset={searchTop + 58}
        />
      )}
      {!navigating && (
        <BusinessResultsPanel
          businessResults={businessResults}
          searchTop={searchTop}
          onDismiss={() => setBusinessResults([])}
          onNavigate={(coords, name) => navigateTo(coords, name)}
          onAddWaypoint={(coords, name) => addWaypoint(coords, name)}
        />
      )}

      {/* ── Route options panel ── */}
      {routeOptions.length > 0 && navPhase === 'ROUTE_PREVIEW' && (
        <RouteOptionsPanel
          routeOptions={routeOptions}
          selectedRouteIdx={selectedRouteIdx}
          routeOptDest={routeOptDest}
          restrictionChecking={restrictionChecking}
          restrictionWarnings={restrictionWarnings}
          insets={insets}
          onSelectRoute={handleSelectRouteOption}
          onDismiss={() => {
            setRouteOptions([]);
            setRouteOptDest(null);
            setSelectedRouteIdx(null);
            setRestrictionWarnings([]);
          }}
          onStart={handleStartRoute}
          drivingSeconds={drivingSeconds}
          hosLimitS={HOS_LIMIT_S}
          onExportGPX={handleExportGPX}
        />
      )}

      {/* ── Parking bubble ── */}
      {selectedParking && (
        <ParkingBubble
          parking={selectedParking}
          onClose={() => setSelectedParking(null)}
          onNavigate={navigateTo}
          onAddWaypoint={(coord, name) => addWaypoint(coord, name)}
          onClearResults={() => setParkingResults([])}
          drivingSeconds={drivingSeconds}
          hosLimitS={HOS_LIMIT_S}
          topOffset={searchTop}
        />
      )}

      {/* ── Fuel panel ── */}
      {selectedFuel && (
        <FuelPanel
          fuel={selectedFuel}
          onClose={() => setSelectedFuel(null)}
          onAddWaypoint={(coord, name) => addWaypoint(coord, name)}
          topOffset={searchTop}
        />
      )}

      {/* ── Truck Situation Renderer (composite restrictions / tunnel / tacho) ── */}
      {navigating && <TruckSituationRenderer situation={truckSituation} />}


      <WakeWordIndicator navigating={navigating} wakeWordHeard={wakeWordHeard} topInset={insets.top} />

      {/* ── Navigation HUD ── */}
      {!(routeOptions.length > 0 && navPhase === 'ROUTE_PREVIEW') && (
        <NavigationHUD
          navigating={navigating}
          route={route}
          currentStep={currentStep}
          distToTurn={distToTurn}
          speed={speed}
          speedLimit={speedLimit}
          remainingSeconds={remainingSeconds}
          destination={destination}
          destinationName={destinationName}
          onStop={handleStopNav}
          onClose={handleClear}
          drivingSeconds={drivingSeconds}
          insets={insets}
          loadingRoute={loadingRoute}
          gpsReady={gpsReady}
          onStart={handleStart}
          onFetchElevation={() => route && buildElevProfile(route)}
          onFetchWeather={() => route && fetchWeatherForRoute(route)}
          onOptimize={() => {
            const dest = destinationRef.current;
            if (dest) navigateTo(dest, destinationNameRef.current, waypointsRef.current, true, true);
          }}
          profile={profile}
          dominantCongestion={dominantCongestion}
          elevProfile={elevProfile}
          weatherPoints={weatherPoints}
          departLabel={departLabel}
          pickDeparture={pickDeparture}
          waypoints={waypoints}
          waypointNames={waypointNames}
          setWaypoints={setWaypoints}
          setWaypointNames={setWaypointNames}
          optimizeWaypointOrder={optimizeWaypointOrder}
          userCoords={userCoords}
          navigateTo={navigateTo}
          HOS_LIMIT_S={HOS_LIMIT_S}
          speedingBg={speedingBg}
          proximityAlerts={proximityAlerts}
          nearestParkingM={nearestParkingM}
          hillWarnings={hillWarnings}
        />
      )}


      <SpeedCameraHUD
        visible={navigating && !!cameraAlert}
        distM={cameraAlert?.dist ?? 0}
        bottomOffset={320 + insets.bottom}
        flashAnim={cameraFlashAnim}
      />


      <TiltControls
        visible={!navigating}
        mapPitch={mapPitch}
        bottomOffset={insets.bottom + 100}
        onTiltUp={() => {
          const next = Math.min(mapPitch + 15, 60);
          setMapPitch(next);
          cameraRef.current?.animateCamera({ pitch: next });
        }}
        onTiltDown={() => {
          const next = Math.max(mapPitch - 15, 0);
          setMapPitch(next);
          cameraRef.current?.animateCamera({ pitch: next });
        }}
      />

      <ChatFABs
        visible={!navigating}
        backendOnline={backendOnline}
        geminiChatOpen={geminiChatOpen}
        gptChatOpen={gptChatOpen}
        bottomOffset={
          routeOptions.length > 0 && navPhase === 'ROUTE_PREVIEW'
            ? insets.bottom + spacing.xxl
            : insets.bottom + spacing.xl
        }
        onToggleGemini={() => {
          setGeminiChatOpen(v => !v);
          setGptChatOpen(false);
        }}
        onToggleGPT={() => {
          setGptChatOpen(v => !v);
          setGeminiChatOpen(false);
        }}
      />

      <RecenterButton
        visible={navigating && !isTracking}
        bottomOffset={insets.bottom + 100}
        onPress={() => {
          suppressPanUntilRef.current = Date.now() + 1500;
          setIsTracking(true);
        }}
      />

      {/* ── Chat Panels ── */}
      <ChatPanel
        gptChatOpen={gptChatOpen}
        geminiChatOpen={geminiChatOpen}
        gptHistory={gptHistory}
        geminiHistory={geminiHistory}
        chatInput={chatInput}
        setChatInput={setChatInput}
        gptLoading={gptLoading}
        geminiLoading={geminiLoading}
        handleChat={handleChat}
        isRecording={isRecording}
        handleMicStart={handleMicStart}
        handleMicStop={handleMicStop}
        kbHeight={kbHeight}
        gptScrollRef={gptScrollRef}
        geminiScrollRef={geminiScrollRef}
        googleUser={googleUser}
        insets={insets}
        micLoading={micLoading}
        onClose={() => { setGptChatOpen(false); setGeminiChatOpen(false); }}
      />

      {/* ── Google Account Modal ── */}
      <GoogleAccountModal
        visible={showAccountModal}
        onClose={() => setShowAccountModal(false)}
        currentAccount={googleUser}
        onConnected={(email) => {
          setGoogleUser({ email });
          listStarred(email).then(places => {
            if (isMountedRef.current) setStarredPOIs(places);
          });
        }}
        onDisconnected={() => {
          setGoogleUser(null);
          setStarredPOIs([]);
        }}
      />


    </View>
  );
}

export default MapScreen;
