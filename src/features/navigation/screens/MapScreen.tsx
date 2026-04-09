import React, { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import {
  View,
  TouchableOpacity,
  Text,
  ActivityIndicator,
  ScrollView,
  Alert,
  Image,
  Animated,
  Linking,
} from 'react-native';
import Tts from 'react-native-tts';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';

import { useVoice } from '../hooks/useVoice';
import { useTacho } from '../hooks/useTacho';
import { usePOI } from '../hooks/usePOI';
import { useChat } from '../hooks/useChat';
import { useSessionBootstrap } from '../hooks/useSessionBootstrap';

import type * as GeoJSON from 'geojson';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { colors, radius, spacing, typography } from '../../../shared/constants/theme';
import { MAP_CENTER, BACKEND_URL } from '../../../shared/constants/config';
import { useVehicleStore } from '../../../store/vehicleStore';
import type { VehicleProfile } from '../../../shared/types/vehicle';
import type { RootStackParamList } from '../../../shared/types/navigation';
import SearchBar from '../components/SearchBar';
import SignRenderer, { SIGN_TRIGGER_M } from '../components/SignRenderer';
import ChatPanel from '../components/ChatPanel';
import NavigationHUD from '../components/NavigationHUD';
import RouteOptionsPanel from '../components/RouteOptionsPanel';
import RestrictionSign from '../components/RestrictionSign';
import FuelPanel from '../components/FuelPanel';
import type { RestrictionPoint } from '../api/directions';
import OptionsPanel from '../components/OptionsPanel';
import RouteTimeline from '../components/RouteTimeline';
import FasterRouteBanner from '../components/FasterRouteBanner';
import { useFasterRouteCheck } from '../hooks/useFasterRouteCheck';
import GoogleAccountModal from '../components/GoogleAccountModal';
import type { GeoPlace } from '../api/geocoding';
import {
  fetchRoute,
  adrToExclude,
  optimizeWaypointOrder,
  getSpeedLimitAtPosition,
  getCurrentStepIndex,
  maneuverEmoji,
  bgInstruction,
  fmtDistance,
  fmtDuration,
  type RouteResult,
} from '../api/directions';
import {
  searchNearbyPOI,
  searchAlongRoute,
  POI_META,
  type POICategory,
  type TruckPOI,
} from '../api/poi';
import {
  fetchElevationAtPoint,
  fetchNearbyParking,
  fetchNearbyFuel,
  fetchNearbyRestrictions,
  fetchSpeedLimitAtPoint,
  type ParkingSpot,
} from '../api/tilequery';
import {
  sendChatMessage,
  sendGeminiMessage,
  transcribeAudio,
  starPlace,
  listStarred,
  checkTruckRestrictions,
  saveTachoSession,
  fetchProximityAlerts,
  pingBackend,
  type ChatMessage,
  type ChatContext,
  type SavedPOI,
  type TruckParking,
  type POICard,
  type RouteOption,
  type MapAction,
  type AppIntent,
  type TachoSummary,
  type ProximityAlerts,
  reportCamera,
} from '../../../shared/services/backendApi';
import { getDaySummary, getWeeklySummary } from '../../tacho/TachoEventLog';

type MapNavProp = NativeStackNavigationProp<RootStackParamList, 'Map'>;

const EMPTY_RESTRICTIONS: never[] = [];

import ParkingBubble from '../components/ParkingBubble';
import MapLongPressMenu from '../components/MapLongPressMenu';
import TachoResultCard from '../components/TachoResultCard';
import { styles, NEON, NEON_DIM } from './MapScreen.styles';
import {
  NAV_ARROW, SIGN_CLOSED, SIGN_DANGER0, STAR_ICON,
  ICON_PARKING, ICON_FUEL, ICON_CAMERA, ICON_DESTINATION, ICON_START, ICON_WAYPOINT, ICON_BIZ, ICON_NO_OVERTAKING,
  ARROW_STRAIGHT, ARROW_RIGHT, ARROW_LEFT, ARROW_SLIGHT_RIGHT, ARROW_SLIGHT_LEFT,
  ARROW_SHARP_RIGHT, ARROW_SHARP_LEFT, ARROW_UTURN, ARROW_ROUNDABOUT,
  NAV_PADDING, ZERO_PADDING,
  APP_URL_MAP, HOS_LIMIT_S, POI_CATEGORIES,
  DEPART_LABELS, type DepartLabel, departIso,
  ttsSpeak, parseBubbleText, voiceText,
  fmtHOS, haversineMeters, weatherEmoji, detectCountryCode, openInBrowser, getTransParkingUrl,
  laneDirectionEmoji, StableCamera,
} from '../utils/mapUtils';

import { useMapUIState, type MapMode } from '../hooks/useMapUIState';
import { useNavigationState, type RouteOptDest } from '../hooks/useNavigationState';
import { useRouteInsights } from '../hooks/useRouteInsights';
import { useRouteOrchestrator } from '../hooks/useRouteOrchestrator';
import { useDrivingAlerts } from '../hooks/useDrivingAlerts';
import { useLocationRuntime } from '../hooks/useLocationRuntime';
import { useWakeWord } from '../hooks/useWakeWord';
import { useChatPanelsState, type AITachoResult } from '../hooks/useChatPanelsState';
import { useMapGeoJSON } from '../hooks/useMapGeoJSON';

// AudioRecorderPlayer is exported as a ready-made singleton — use directly

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
    showTraffic, setShowTraffic,
    showIncidents, setShowIncidents,
    showRestrictions, setShowRestrictions,
    showContours, setShowContours,
    showTerrain, setShowTerrain,
    trafficKey, setTrafficKey,
    debugMode, setDebugMode,
    testLanesMode, setTestLanesMode,
    optionsOpen, setOptionsOpen,
    showStarredLayer, setShowStarredLayer,
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
    simulating, setSimulating,
    routeOptions, setRouteOptions,
    routeOptDest, setRouteOptDest,
    selectedRouteIdx, setSelectedRouteIdx,
    departAt, setDepartAt,
    mapPitch, setMapPitch,
    mapZoom, setMapZoom,
    waypoints, setWaypoints,
    waypointNames, setWaypointNames,
    restrictionChecking, setRestrictionChecking,
    restrictionWarnings, setRestrictionWarnings,
    avoidUnpaved, setAvoidUnpaved,
  } = useNavigationState();

  const navigatingRef = useRef(false);
  useEffect(() => { navigatingRef.current = navigating; }, [navigating]);
  const routeRef = useRef<RouteResult | null>(null);
  useEffect(() => { routeRef.current = route; }, [route]);

  const isMountedRef = useRef(true);
  useEffect(() => () => { isMountedRef.current = false; }, []);

  const profileRef         = useRef<VehicleProfile | null>(null);
  const stoppedSinceRef    = useRef<number | null>(null);
  const lastParkingRef     = useRef<number>(0);
  const lastRestrictionRef = useRef<number>(0);
  const orchestratorUserCoordsRef = useRef<[number, number] | null>(null);
  const buildRoutePOIScanRef = useRef<(r: RouteResult) => void>(() => {});
  const setNavCongestionGeoJSONRef = useRef<(geojson: GeoJSON.FeatureCollection | null) => void>(() => {});
  // These must be declared before useRouteOrchestrator / useLocationRuntime to avoid TDZ
  const [navCongestionGeoJSON, setNavCongestionGeoJSON] = useState<GeoJSON.FeatureCollection | null>(null);
  const [navTrafficAlerts, setNavTrafficAlerts]         = useState<GeoJSON.FeatureCollection | null>(null);
  const [autoParking, setAutoParking]   = useState<ParkingSpot[]>([]);
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
    setParkingResults,
    setFuelResults,
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

  // ── States & Refs from useLocationRuntime ──────────────────────────
  const {
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
    avoidUnpavedRef,
    setTunnelWarning: (msg) => setTunnelWarningRef.current(msg),
    setSpeedLimit,
    setCurrentStep,
    setDistToTurn,
    setNavPhase,
    setRoute,
    setNavCongestionGeoJSON,
    setBackendOnline,
    navigating,
  });
  // Sync GPS userCoordsRef → orchestratorUserCoordsRef so navigateTo uses real position
  useLayoutEffect(() => {
    orchestratorUserCoordsRef.current = userCoordsRef.current;
  }, [userCoords]);

  // ── Hooks Integration ──────────────────────────────────────────────

  // 0. Session bootstrap (account, starred POIs, backend health)
  const setTachoSummaryRef = useRef<(summary: TachoSummary) => void>(() => {});

  const {
    backendOnline: _bootstrapOnline,
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
      const prompt =
        `Направи кратко гласово обобщение на работния ден за шофьора. Използвай тези данни: ${JSON.stringify(daySummary)} и седмични: ${JSON.stringify(weeklySummary)}. ` +
        'Формат: "Днес изкара X км, Y часа каране. Следващата ти почивка трябва да е поне Z часа. Можеш да тръгнеш утре след HH:MM." ' +
        'Отговори само с текста за четене, без форматиране.';
      const response = await sendGeminiMessage(prompt, [], {}, 'system');
      if (response.ok) {
        const text = (response.reply ?? '').trim();
        if (text) { ttsSpeak(text); }
      }
    } catch {
      // silent — end-of-day summary is non-critical
    }
  }, []);

  const {
    drivingSeconds, tachoSummary, setTachoSummary, resetSession, saveSession, hosViolations
  } = useTacho(
    navigating, isDrivingRef, googleUserRef, speak, handleEndOfDay,
    (remMin) => {
      ttsSpeak(`Колега, остават ${remMin} минути каране. Търся паркинг...`);
      if (userCoords) {
        fetchNearbyParking(userCoords[1], userCoords[0], 20000)
          .then(results => { if (results.length > 0) setParkingResults(results.slice(0, 5).map(s => ({ ...s, distance_m: s.distance }))); })
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
    isRecording, setIsRecording,
    micLoading, setMicLoading,
    kbHeight, setKbHeight,
    gptScrollRef, geminiScrollRef,
    handleChat: handleChatState,
    handleMicStart: handleMicStartState,
    handleMicStop: handleMicStopState,
  } = useChatPanelsState();

  const {
    gptLoading, geminiLoading, sendGptText, sendGeminiText
  } = useChat({
    userCoords, drivingSeconds, speed, profile, tachoSummary,
    gptHistory, setGptHistory,
    geminiHistory, setGeminiHistory,
    googleUser,
    voiceMutedRef, 
    navigateTo: (d, n, w, a) => navigateTo(d, n, w, a),
    addWaypoint: (c, n) => addWaypoint(c, n),
    setParkingResults, setFuelResults, setCameraResults, setBusinessResults,
    setRouteOptions, setRouteOptDest, setRoute, setDestination,
    setTachographResult,
    handleAppIntent: (intent) => handleAppIntent(intent)
  });

  const handleChat = useCallback(() => handleChatState(sendGptText, sendGeminiText, gptChatOpen), [handleChatState, sendGptText, sendGeminiText, gptChatOpen]);
  const handleMicStart = useCallback(() => handleMicStartState(AudioRecorderPlayer), [handleMicStartState]);
  const handleMicStop = useCallback(() => handleMicStopState(AudioRecorderPlayer, handleChat), [handleMicStopState, handleChat]);

  const chatLoading = gptChatOpen ? gptLoading : geminiLoading;

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
  } = useRouteInsights(route, userCoords);

  useEffect(() => { buildRoutePOIScanRef.current = buildRoutePOIScan; }, [buildRoutePOIScan]);
  useEffect(() => { setNavCongestionGeoJSONRef.current = setNavCongestionGeoJSON; }, [setNavCongestionGeoJSON]);

  // ── Auto-load POIs when route is calculated ──────────────────────
  useEffect(() => {
    if (route && !navigating) {
      handleSARSearch('truck_stop');
      const timer = setTimeout(() => {
        handleSARSearch('gas_station');
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [route, navigating, handleSARSearch]);

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
  const backendPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const lastAlertCheckPos  = useRef<[number, number] | null>(null);
  const offRouteCountRef   = useRef(0);
  const lastRerouteTimeRef = useRef(0); // cooldown — min 45s between reroutes

  // ── Helper: Point-to-polyline distance (meters) ────────────────────
  const getDistToRoute = useCallback((pos: [number, number], routeObj: RouteResult) => {
    const coords = routeObj.geometry.coordinates;
    if (!coords || coords.length < 2) return Infinity;

    // Find nearest point first, then check ±30 segments around it
    let nearestIdx = 0;
    let nearestD = Infinity;
    for (let i = 0; i < coords.length; i++) {
      const d = haversineMeters(pos, [coords[i][0], coords[i][1]]);
      if (d < nearestD) { nearestD = d; nearestIdx = i; }
    }
    const fromIdx = Math.max(0, nearestIdx - 1);
    const maxIdx = Math.min(coords.length - 1, nearestIdx + 30);
    let minD = Infinity;

    for (let i = fromIdx; i < maxIdx; i++) {
      const p1 = coords[i];
      const p2 = coords[i + 1];
      
      const d1 = haversineMeters(pos, [p1[0], p1[1]]);
      const d2 = haversineMeters(pos, [p2[0], p2[1]]);
      const mid: [number, number] = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
      const dMid = haversineMeters(pos, mid);
      
      const dSegment = Math.min(d1, d2, dMid);
      if (dSegment < minD) minD = dSegment;
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
    // Adapter for MapView onLongPress
    const { longitude, latitude } = event.nativeEvent.coordinate;
    setLongPressCoord([longitude, latitude]);
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
    setNavPhase('NAVIGATING');
    if (!voiceMutedRef.current) {
      Tts.stop();
      ttsSpeak('Следвайте маршрута.');
    }
  }, [mapMode, resetSession]);
  handleStartRef.current = handleStart;

  const handleStopNav = useCallback(() => {
    Tts.stop();
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
    cameraRef.current?.animateToRegion({
      latitude: MAP_CENTER.latitude,
      longitude: MAP_CENTER.longitude,
      latitudeDelta: 0.0922,
      longitudeDelta: 0.0421,
    }, 800);
    if (simIntervalRef.current) clearInterval(simIntervalRef.current);
    isSimulatingRef.current = false;
    setSimulating(false);
    simIndexRef.current = 0;
  }, [clearPOI, resetSession]);

  const handleOriginChange = useCallback((place: import('../api/geocoding').GeoPlace | null) => {
    customOriginRef.current = place?.center ?? null;
    setCustomOriginName(place?.text ?? '');
  }, []);

  const handleSelectRouteOption = useCallback(async (idx: number) => {
    setSelectedRouteIdx(idx);
    setRestrictionWarnings([]);
    const prof = profileRef.current;
    if (!prof) return;
    setRestrictionChecking(true);
    try {
      const coords = routeOptions[idx]?.geometry.coordinates;
      const result = await checkTruckRestrictions({
        weight_t:     prof.weight_t,
        height_m:     prof.height_m,
        width_m:      prof.width_m,
        length_m:     prof.length_m,
        hazmat_class: prof.hazmat_class ?? undefined,
      }, coords);
      setRestrictionWarnings(result.warnings);
    } finally {
      setRestrictionChecking(false);
    }
  }, [routeOptions]);

  const startSim = useCallback(() => {
    const coords = routeRef.current?.geometry.coordinates;
    if (!coords || coords.length < 2) return;
    simIndexRef.current = 0;
    isSimulatingRef.current = true;
    setSimulating(true);
    simIntervalRef.current = setInterval(() => {
      if (!isMountedRef.current) { clearInterval(simIntervalRef.current!); return; }
      const idx = simIndexRef.current;
      if (idx >= coords.length) {
        clearInterval(simIntervalRef.current!);
        isSimulatingRef.current = false;
        setSimulating(false);
        return;
      }
      const pos: [number, number] = [coords[idx][0], coords[idx][1]];
      userCoordsRef.current = pos;
      setUserCoords(pos);
      setGpsReady(true);
      setSpeed(80);
      isDrivingRef.current = true;
      simIndexRef.current = idx + 2;
    }, 500);
  }, []);

  const stopSim = useCallback(() => {
    if (simIntervalRef.current) clearInterval(simIntervalRef.current);
    isSimulatingRef.current = false;
    setSimulating(false);
    simIndexRef.current = 0;
  }, []);

  const handleAppIntent = useCallback((intent: AppIntent) => {
    if (intent.url) {
      Linking.openURL(intent.url).catch(() => null);
      return;
    }
    const builder = APP_URL_MAP[intent.app.toLowerCase()];
    const url = builder ? builder(intent.query) : null;
    if (!url) return;
    Linking.openURL(url).catch(() => {
      const q = intent.query ?? intent.app;
      Linking.openURL(`https://www.google.com/search?q=${encodeURIComponent(q)}`).catch(() => null);
    });
  }, []);

  const puckScale = useMemo(() => {
    if (!navigating || distToTurn == null || distToTurn > 300) return 1.0;
    if (distToTurn < 50)  return 2.0;
    if (distToTurn < 150) return 1.5;
    return 1.2;
  }, [navigating, distToTurn]);

  useEffect(() => {
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
  }, [parkingResults, businessResults]);

  const terrainExaggeration = speed > 90 ? 2.0 : speed > 60 ? 1.6 : speed > 30 ? 1.3 : 1.0;

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

  const activeRestriction = useMemo<RestrictionPoint | null>(() => {
    if (!navigating || !userCoords || !route?.restrictions?.length) return null;
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
    for (const r of route.restrictions) {
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
  }, [navigating, userCoords, route?.restrictions, route?.geometry.coordinates]);

  const routeLineColor = dominantCongestion === 'heavy' ? '#FF3B30'
    : dominantCongestion === 'moderate' ? '#FF9500'
    : '#13BDFF';

  // Dynamic width: wider in city (slow speed), thinner on highway
  const dynamicWidth = speed < 45 ? 10 : speed < 80 ? 7 : 5;

  const displayedUserCoords = useMemo((): [number, number] | null => {
    if (!userCoords) return null;
    if (!navigating || !route?.geometry?.coordinates) return userCoords;
    const coords = route.geometry.coordinates;
    let minD = Infinity;
    let closest: [number, number] = userCoords;
    for (let i = 0; i < coords.length; i++) {
      const d = haversineMeters(userCoords, [coords[i][0], coords[i][1]]);
      if (d < minD) { minD = d; closest = [coords[i][0], coords[i][1]]; }
    }
    return minD < 150 ? closest : userCoords;
  }, [userCoords, navigating, route]);

  const searchTop = insets.top + 18;
  const isSearchingAlongRoute = loadingPOI && sarMode;
  const handleSearchAlongRoute = () => { if (poiCategory) handleSARSearch(poiCategory); };

  const currentLanes = useMemo(() => {
    return stepToShow?.bannerInstructions?.[0]?.sub?.components.filter(
      c => c.type === 'lane',
    ) ?? [];
  }, [stepToShow]);

  const MOCK_LANES = useMemo(() => ([
    { type: 'lane' as const, text: '', active: false, directions: ['left'] },
    { type: 'lane' as const, text: '', active: true,  directions: ['straight'] },
    { type: 'lane' as const, text: '', active: true,  directions: ['slight right'] },
    { type: 'lane' as const, text: '', active: false, directions: ['right'] },
  ]), []);

  const displayLanes = testLanesMode ? MOCK_LANES : currentLanes;

  const lanePulseOn = testLanesMode ||
    (navigating && distToTurn != null && distToTurn < 350 && displayLanes.some(l => l.active));

  const {
    cameraAlert, setCameraAlert,
    overtakingResults, setOvertakingResults,
    tunnelWarning, setTunnelWarning,
    cameraFlashAnim,
    laneGlowBg, laneGlowShadow,
    speedingBg,
    proximityAlerts,
    playCameraAlert,
  } = useDrivingAlerts({
    speed, speedLimit, navigating,
    userCoords, cameraResults,
    voiceMutedRef, lanePulseOn,
  });
  useLayoutEffect(() => { setTunnelWarningRef.current = setTunnelWarning; });

  const {
    navCongestionVisible,
  } = useMapGeoJSON({
    parkingResults,
    fuelResults,
    businessResults,
    cameraResults,
    waypoints,
    poiResults,
    weatherPoints,
    route,
    navigating,
    userCoords,
    navCongestionGeoJSON,
    overtakingResults,
    starredPOIs,
  });

  const setWaypoint = (name: string, coords: [number, number]) => addWaypoint(coords, name);

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

  return (
    <View style={styles.container}>
      {!backendOnline && (
        <View style={styles.noInternetBanner} pointerEvents="none">
          <Text style={styles.noInternetText}>⚠️ Сървърът не отговаря — AI функциите са изключени</Text>
        </View>
      )}

      {/* ── Map ── */}
      <MapView
        ref={cameraRef}
        style={styles.map}
        initialRegion={{
          latitude: MAP_CENTER.latitude,
          longitude: MAP_CENTER.longitude,
          latitudeDelta: 5.0,
          longitudeDelta: 5.0,
        }}
        provider={PROVIDER_GOOGLE}
        mapType={mapMode === 'hybrid' ? 'hybrid' : 'standard'}
        showsBuildings={true}
        showsUserLocation={true}
        showsMyLocationButton={false}
        showsCompass={false}
        showsTraffic={showTraffic}
        onMapReady={() => setMapIsLoaded(true)}
        onLongPress={handleMapLongPress}
        onPress={() => {
          if (gptChatOpen) setGptChatOpen(false);
          if (geminiChatOpen) setGeminiChatOpen(false);
          if (longPressCoord) setLongPressCoord(null);
          if (selectedParking) setSelectedParking(null);
        }}
        onPanDrag={() => {
          if (navigating && isTracking) setIsTracking(false);
        }}
      >
        <StableCamera
          cameraRef={cameraRef}
          navigating={navigating}
          mapLoaded={mapIsLoaded}
          speed={speed}
          isTracking={isTracking}
          userCoords={userCoords}
          userHeading={userHeading}
        />

        {/* User / Truck Marker */}
        {displayedUserCoords && (
          <Marker
            coordinate={{ latitude: displayedUserCoords[1], longitude: displayedUserCoords[0] }}
            rotation={userHeading ?? 0}
            flat={navigating}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
          >
            {navigating ? (
              <Image source={NAV_ARROW} style={{ width: 44, height: 44, resizeMode: 'contain' }} />
            ) : (
              <View style={{
                width: 18, height: 16,
                borderRadius: 9,
                backgroundColor: '#13BDFF',
                borderWidth: 2,
                borderColor: '#ffffff',
                shadowColor: '#000',
                shadowOpacity: 0.5,
                shadowRadius: 3,
                elevation: 5,
              }} />
            )}
          </Marker>
        )}

        {/* Route polyline — segmented for traffic coloring (double: halo + main) */}
        {navCongestionVisible && navCongestionVisible.features.map((f: any, idx: number) => {
          const cong = f.properties?.congestion;
          const color =
            cong === 'heavy' || cong === 'severe' ? '#FF3B30' :
            cong === 'moderate' ? '#FF9500' :
            '#13BDFF';
          const haloColor =
            cong === 'heavy' || cong === 'severe' ? 'rgba(255,59,48,0.22)' :
            cong === 'moderate' ? 'rgba(255,149,0,0.22)' :
            'rgba(19,189,255,0.22)';
          const coords = f.geometry.coordinates.map((c: [number, number]) => ({ latitude: c[1], longitude: c[0] }));

          return [
            // Halo (glow shadow)
            <Polyline
              key={`route-halo-${idx}`}
              coordinates={coords}
              strokeColor={haloColor}
              strokeWidth={dynamicWidth + 8}
              lineCap="round"
              lineJoin="round"
              geodesic={true}
            />,
            // Main line
            <Polyline
              key={`route-seg-${idx}`}
              coordinates={coords}
              strokeColor={color}
              strokeWidth={dynamicWidth}
              lineCap="round"
              lineJoin="round"
              geodesic={true}
            />,
          ];
        })}

        {/* Fallback polyline if congestion data is missing */}
        {!navCongestionVisible && route && [
          <Polyline
            key="route-fallback-halo"
            coordinates={route.geometry.coordinates.map(([lng, lat]) => ({ latitude: lat, longitude: lng }))}
            strokeColor="rgba(19,189,255,0.22)"
            strokeWidth={dynamicWidth + 8}
            lineCap="round"
            lineJoin="round"
            geodesic={true}
          />,
          <Polyline
            key="route-fallback-main"
            coordinates={route.geometry.coordinates.map(([lng, lat]) => ({ latitude: lat, longitude: lng }))}
            strokeColor="#13BDFF"
            strokeWidth={dynamicWidth}
            lineCap="round"
            lineJoin="round"
            geodesic={true}
          />,
        ]}

        {/* Alternative routes */}
        {routeOptions.map((opt, idx) => idx !== selectedRouteIdx && (
          <Polyline
            key={`alt-${idx}`}
            coordinates={opt.geometry.coordinates.map(([lng, lat]: [number, number]) => ({ latitude: lat, longitude: lng }))}
            strokeColor="#8B5CF6"
            strokeWidth={4}
            tappable
            onPress={() => handleSelectRouteOption(idx)}
          />
        ))}

        {/* Destination marker */}
        {destination && (
          <Marker
            coordinate={{ latitude: destination[1], longitude: destination[0] }}
            title={destinationName ?? 'Дестинация'}
            pinColor="red"
          />
        )}

        {/* Waypoint markers */}
        {waypoints.map((wp, idx) => (
          <Marker
            key={`wp-${idx}`}
            coordinate={{ latitude: wp[1], longitude: wp[0] }}
            title={waypointNames[idx] ?? `Спирка ${idx + 1}`}
            pinColor="orange"
          />
        ))}

        {/* Parking markers */}
        {parkingResults.map((p, idx) => (
          <Marker
            key={`park-${idx}`}
            coordinate={{ latitude: p.lat, longitude: p.lng }}
            title={p.name}
            onPress={() => setSelectedParking(p)}
            tracksViewChanges={false}
          >
            <View style={{
              width: 44, height: 44,
              backgroundColor: 'rgba(10,12,30,0.95)',
              borderRadius: 22,
              borderWidth: 2,
              borderColor: NEON,
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: NEON,
              shadowOpacity: 0.8,
              shadowRadius: 6,
              elevation: 8,
            }}>
              <Text style={{ fontSize: 22, color: '#fff', fontWeight: 'bold' }}>P</Text>
            </View>
          </Marker>
        ))}

        {/* Fuel markers */}
        {fuelResults.map((f, idx) => (
          <Marker
            key={`fuel-${idx}`}
            coordinate={{ latitude: f.lat, longitude: f.lng }}
            title={f.name}
            onPress={() => setSelectedFuel(f)}
            tracksViewChanges={false}
          >
            <View style={{
              width: 44, height: 44,
              backgroundColor: 'rgba(10,12,30,0.95)',
              borderRadius: 22,
              borderWidth: 2,
              borderColor: '#f59e0b',
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: '#f59e0b',
              shadowOpacity: 0.8,
              shadowRadius: 6,
              elevation: 8,
            }}>
              <Text style={{ fontSize: 22 }}>⛽</Text>
            </View>
          </Marker>
        ))}

        {/* Camera markers */}
        {cameraResults.map((c, idx) => (
          <Marker
            key={`cam-${idx}`}
            coordinate={{ latitude: c.lat, longitude: c.lng }}
            title="Камера"
            tracksViewChanges={false}
          >
            <View style={{
              width: 36, height: 36,
              backgroundColor: 'rgba(30,0,0,0.95)',
              borderRadius: 18,
              borderWidth: 2,
              borderColor: '#ff3b30',
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: '#ff3b30',
              shadowOpacity: 0.8,
              shadowRadius: 6,
              elevation: 8,
            }}>
              <Text style={{ fontSize: 18 }}>📸</Text>
            </View>
          </Marker>
        ))}

        {/* POI search results */}
        {poiResults.map((poi, idx) => (
          <Marker
            key={`poi-${idx}`}
            coordinate={{ latitude: poi.coordinates[1], longitude: poi.coordinates[0] }}
            title={poi.name}
            onPress={() => handlePOINavigate(poi)}
            tracksViewChanges={false}
          >
            <View style={{
              width: 44, height: 44,
              backgroundColor: 'rgba(10,12,30,0.85)',
              borderRadius: 22,
              borderWidth: 2,
              borderColor: NEON,
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: NEON,
              shadowOpacity: 0.8,
              shadowRadius: 6,
              elevation: 8,
            }}>
              <Text style={{ fontSize: 24 }}>{POI_META[poi.category]?.emoji || '📍'}</Text>
            </View>
          </Marker>
        ))}

        {/* Starred POIs */}
        {starredPOIs.map((poi, idx) => (
          <Marker
            key={`star-${idx}`}
            coordinate={{ latitude: poi.lat, longitude: poi.lng }}
            title={poi.name}
          >
            <Image source={STAR_ICON} style={{ width: 24, height: 24 }} />
          </Marker>
        ))}

        {/* Traffic Alerts (Delay bubbles) */}
        {route && route.traffic_alerts && route.traffic_alerts.map((a: any, idx: number) => (
          <Marker
            key={`traffic-alert-${idx}`}
            coordinate={{ latitude: a.lat, longitude: a.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
            onPress={() => {
              setGeminiChatOpen(true);
              setGptChatOpen(false);
              sendGeminiText(`Трафик инцидент: ${a.label}. Дължина: ${a.length_km} км. Кажи ми повече за тази ситуация и как да реагирам като шофьор на камион.`);
            }}
          >
            <View style={{
              backgroundColor: a.severity === 'moderate' ? '#FF9500' : '#FF3B30',
              borderRadius: 10,
              paddingHorizontal: 7,
              paddingVertical: 4,
              borderWidth: 1.5,
              borderColor: '#fff',
              shadowColor: '#000',
              shadowOpacity: 0.4,
              shadowRadius: 3,
              elevation: 4,
            }}>
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{a.label}</Text>
            </View>
          </Marker>
        ))}

      </MapView>

      {/* ── Search bar (hidden during navigation) ── */}
      {!navigating && (
        <View style={[styles.searchContainer, { top: searchTop }]}>
          <SearchBar
            onSelect={handleDestinationSelect}
            onClear={handleClear}
            onOriginChange={handleOriginChange}
          />
          {customOriginName ? (
            <View style={styles.originActiveBadge}>
              <Text style={styles.originActiveTxt}>📍 Начало: {customOriginName}</Text>
            </View>
          ) : null}
        </View>
      )}

      {/* ── Tunnel / bridge restriction warning banner ── */}
      {tunnelWarning && navigating && (
        <View style={[styles.tunnelWarnBanner, { top: insets.top }]}>
          <Text style={styles.tunnelWarnText}>{tunnelWarning}</Text>
        </View>
      )}

      {/* ── Navigation top panel ── */}
      {navigating && stepToShow && (
        <View style={[styles.signWrap, { top: insets.top + spacing.xs }]}>
          {distToTurn != null && distToTurn < SIGN_TRIGGER_M ? (
            <SignRenderer
              step={stepToShow}
              nextStep={nextStep ?? undefined}
              distToTurn={distToTurn}
              lanes={currentLanes}
              banner={stepToShow.bannerInstructions?.[0]}
            />
          ) : (
            <View style={styles.navBanner}>
              <Text style={styles.navArrow}>
                {maneuverEmoji(stepToShow.maneuver.type, stepToShow.maneuver.modifier)}
              </Text>
              <View style={styles.navBannerBody}>
                {distToTurn != null && (
                  <Text style={[styles.navDistText, {
                    fontSize: distToTurn > 20000 ? 28
                            : distToTurn > 10000 ? 24
                            : distToTurn > 5000  ? 22
                            : distToTurn > 2000  ? 20
                            : 18,
                  }]}>
                    {fmtDistance(distToTurn)}
                  </Text>
                )}
                <Text style={styles.navStreet} numberOfLines={1}>
                  {stepToShow.name || stepToShow.maneuver.instruction}
                </Text>
                {nextStep && (
                  <Text style={styles.navNext} numberOfLines={1}>
                    после:{' '}
                    {maneuverEmoji(nextStep.maneuver.type, nextStep.maneuver.modifier)}{' '}
                    {nextStep.name || nextStep.maneuver.instruction}
                  </Text>
                )}
              </View>
            </View>
          )}
        </View>
      )}

      {/* ── Truck lane guidance ── */}
      {(testLanesMode || (navigating && distToTurn != null && distToTurn < 500)) && displayLanes.length > 0 && (
        <View style={styles.laneStrip}>
          <Text style={styles.laneStripLabel}>ЗАПАЗИ ЛЕНТАТА</Text>
          <View style={styles.laneStripCells}>
            {displayLanes.map((lane, i) =>
              lane.active ? (
                <Animated.View
                  key={i}
                  style={[
                    styles.laneSCell,
                    styles.laneSCellActive,
                    { backgroundColor: laneGlowBg, shadowOpacity: laneGlowShadow },
                  ]}
                >
                  <Text style={styles.laneSCellArrowActive}>
                    {laneDirectionEmoji(lane.directions?.[0])}
                  </Text>
                </Animated.View>
              ) : (
                <View key={i} style={styles.laneSCell}>
                  <Text style={styles.laneSCellArrow}>
                    {laneDirectionEmoji(lane.directions?.[0])}
                  </Text>
                </View>
              ),
            )}
          </View>
        </View>
      )}


      {/* ── Route Timeline ── */}
      {navigating && route && routeAheadPOIs.length > 0 && (
        <RouteTimeline
          routeAheadPOIs={routeAheadPOIs}
          totalDistM={route.distance}
          userCoords={userCoords}
          onPOIPress={(poi) => navigateTo([poi.lng, poi.lat], poi.name, undefined, false)}
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
        showTraffic={showTraffic}
        setShowTraffic={setShowTraffic}
        showIncidents={showIncidents}
        setShowIncidents={setShowIncidents}
        showRestrictions={showRestrictions}
        setShowRestrictions={setShowRestrictions}
        showContours={showContours}
        setShowContours={setShowContours}
        avoidUnpaved={avoidUnpaved}
        setAvoidUnpaved={setAvoidUnpaved}
        showStarredLayer={showStarredLayer}
        setShowStarredLayer={setShowStarredLayer}
        navigating={navigating}
        route={route}
        simulating={simulating}
        startSim={startSim}
        stopSim={stopSim}
        debugMode={debugMode}
        setDebugMode={setDebugMode}
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
        onOpenPoiHistory={() => {}}
        backendOnline={backendOnline}
      />

      {/* ── GPS chip ── */}
      {!gpsReady && (
        <View style={styles.gpsChip}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.gpsText}>GPS...</Text>
        </View>
      )}

      {/* ── Re-routing chip ── */}
      {rerouting && (
        <View style={styles.reroutingChip}>
          <ActivityIndicator size="small" color={colors.warning} />
          <Text style={styles.reroutingText}>Рекалкулиране...</Text>
        </View>
      )}

      {/* ── Border Crossings panel ── */}
      {showBorderPanel && borderCrossings.length > 0 && (
        <View style={styles.borderPanel}>
          <View style={styles.borderPanelHeader}>
            <Text style={styles.borderPanelTitle}>🛂 Гранични преходи</Text>
            <TouchableOpacity onPress={() => setShowBorderPanel(false)}>
              <Text style={styles.borderPanelClose}>✕</Text>
            </TouchableOpacity>
          </View>
          {borderCrossings.map((c, i) => (
            <TouchableOpacity
              key={i}
              style={styles.borderRow}
              onPress={() => Linking.openURL(c.url).catch(() => null)}
            >
              <Text style={styles.borderFlag}>{c.flag}</Text>
              <Text style={styles.borderName}>{c.name}</Text>
              <Text style={styles.borderStatus}>{c.status} →</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ── Vehicle badge ── */}
      {profile?.plate && !navigating && (
        <View style={[styles.badge, { top: searchTop + 58 }]}>
          <Text style={styles.badgeText}>{profile.plate}</Text>
        </View>
      )}

      {/* ── Route loading chip ── */}
      {loadingRoute && (
        <View style={styles.loadingChip}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.loadingText}>Изчисляване на маршрут...</Text>
        </View>
      )}

      {/* ── POI / SAR results horizontal scroll ── */}
      {!navigating && (poiResults.length > 0 || loadingPOI) && (!route || sarMode) && (
        <View style={[styles.poiListContainer, { top: searchTop + (sarMode ? 68 : 110) }]}>
          {sarMode && (
            <View style={styles.sarHeaderBadge}>
              <Text style={styles.sarHeaderTxt}>
                🗺️ По маршрут · до 10 мин отклонение
              </Text>
              <TouchableOpacity
                onPress={() => clearPOI()}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[styles.sarHeaderTxt, { marginLeft: 8 }]}>✕</Text>
              </TouchableOpacity>
            </View>
          )}
          {loadingPOI && (
            <ActivityIndicator size="small" color={colors.accent} style={styles.poiLoading} />
          )}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.poiListContent}>
            {poiResults.map((poi) => (
              <TouchableOpacity
                key={poi.id}
                style={[styles.poiCard, sarMode && styles.poiCardSAR]}
                onPress={() => handlePOINavigate(poi)}
              >
                <Text style={styles.poiCardEmoji}>{POI_META[poi.category].emoji}</Text>
                <Text style={styles.poiCardName} numberOfLines={2}>{poi.name}</Text>
                {poi.brand ? (
                  <Text style={styles.poiCardBrand} numberOfLines={1}>{poi.brand}</Text>
                ) : null}
                <Text style={styles.poiCardAddr} numberOfLines={1}>{poi.address}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* ── Parking cards from GPT-4o ── */}
      {parkingResults.length > 0 && (
        <View style={[styles.parkingPanel, { top: searchTop + 58 }]}>
          <View style={styles.parkingPanelHeader}>
            <Text style={styles.parkingPanelTitle}>🅿️ Паркинги за камиони</Text>
            <TouchableOpacity
              onPress={() => setParkingResults([])}
              style={styles.parkingDismissBtn}
            >
              <Text style={styles.parkingDismissTxt}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.parkingListContent}
          >
            {parkingResults.map((p, i) => (
              <View key={i} style={styles.parkingCard}>
                <Text style={styles.parkingCardName} numberOfLines={2}>{p.name}</Text>
                <Text style={styles.parkingCardDist}>{fmtDistance(p.distance_m)}</Text>

                <View style={styles.parkingBadgeRow}>
                  <View style={[styles.parkingBadge, p.paid ? styles.parkingBadgePaid : styles.parkingBadgeFree]}>
                    <Text style={styles.parkingBadgeTxt}>{p.paid ? '💰 Платен' : '🆓 Безплатен'}</Text>
                  </View>
                  {p.showers && (
                    <View style={styles.parkingBadge}><Text style={styles.parkingBadgeTxt}>🚿</Text></View>
                  )}
                  {p.toilets && (
                    <View style={styles.parkingBadge}><Text style={styles.parkingBadgeTxt}>🚽</Text></View>
                  )}
                  {p.wifi && (
                    <View style={styles.parkingBadge}><Text style={styles.parkingBadgeTxt}>📶</Text></View>
                  )}
                  {p.security && (
                    <View style={styles.parkingBadge}><Text style={styles.parkingBadgeTxt}>🔒</Text></View>
                  )}
                  {p.lighting && (
                    <View style={styles.parkingBadge}><Text style={styles.parkingBadgeTxt}>💡</Text></View>
                  )}
                  {p.capacity != null && (
                    <View style={styles.parkingBadge}><Text style={styles.parkingBadgeTxt}>🚛 {p.capacity}</Text></View>
                  )}
                </View>

                {p.opening_hours ? (
                  <Text style={styles.parkingHours} numberOfLines={1}>{p.opening_hours}</Text>
                ) : null}

                <View style={styles.parkingCardActions}>
                  <TouchableOpacity
                    style={styles.parkingGoBtn}
                    activeOpacity={0.8}
                    onPress={() => {
                      setParkingResults([]);
                      setSelectedParking(null);
                      navigateTo([p.lng, p.lat], p.name);
                    }}
                  >
                    <Icon name="navigation-variant" size={12} color="#0a0c1c" />
                    <Text style={styles.parkingGoBtnTxt2}>Маршрут</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.parkingWpBtn}
                    activeOpacity={0.8}
                    onPress={() => {
                      setParkingResults([]);
                      setSelectedParking(null);
                      addWaypoint([p.lng, p.lat], p.name);
                    }}
                  >
                    <Icon name="map-marker-plus" size={12} color={NEON} />
                    <Text style={styles.parkingWpBtnTxt}>+ Спирка</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.parkingWebBtn, p.transparking_id && { borderColor: '#00ff88', backgroundColor: 'rgba(0,255,136,0.1)' }]}
                    activeOpacity={0.8}
                    onPress={async () => {
                      if (p.transparking_id) {
                        const url = await getTransParkingUrl(p.transparking_id);
                        navigation.navigate('TruckParking', { url });
                      } else if (p.website) {
                        openInBrowser(p.website);
                      } else {
                        navigation.navigate('TruckParking', {});
                      }
                    }}
                  >
                    <Icon name={p.transparking_id ? 'comment-text-multiple' : 'open-in-new'} size={12} color={p.transparking_id ? '#00ff88' : NEON} />
                    <Text style={[styles.parkingWebBtnTxt, p.transparking_id && { color: '#00ff88' }]}>
                      {p.transparking_id ? 'TransParking' : 'Инфо'}
                    </Text>
                  </TouchableOpacity>

                  {p.voice_desc && (
                    <TouchableOpacity
                      style={styles.parkingTtsBtn}
                      activeOpacity={0.8}
                      onPress={() => ttsSpeak(p.voice_desc!)}
                    >
                      <Icon name="volume-high" size={13} color="#fff" />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* ── Fuel station cards from GPT-4o ── */}
      {!navigating && fuelResults.length > 0 && (
        <View style={[styles.fuelPanel, { top: searchTop + 58 }]}>
          <View style={styles.parkingPanelHeader}>
            <Text style={styles.fuelPanelTitle}>⛽ Горивни станции</Text>
            <TouchableOpacity
              onPress={() => setFuelResults([])}
              style={styles.parkingDismissBtn}
            >
              <Text style={styles.parkingDismissTxt}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.parkingListContent}
          >
            {fuelResults.map((f, i) => (
              <View key={i} style={styles.fuelCard}>
                <Text style={styles.fuelCardName} numberOfLines={2}>{f.name}</Text>
                {f.brand ? <Text style={styles.fuelCardBrand}>{f.brand}</Text> : null}
                <Text style={styles.fuelCardDist}>{fmtDistance(f.distance_m)}</Text>
                {f.price ? (
                  <View style={styles.fuelBadge}>
                    <Text style={styles.fuelBadgeTxt}>💸 {f.price}</Text>
                  </View>
                ) : null}
                {f.truck_lane ? (
                  <View style={styles.fuelBadgeTruck}>
                    <Text style={styles.fuelBadgeTxt}>🚛 Камионна лента</Text>
                  </View>
                ) : null}
                {f.opening_hours ? (
                  <Text style={styles.fuelHours} numberOfLines={1}>{f.opening_hours}</Text>
                ) : null}
                <View style={styles.fuelCardBtns}>
                  <TouchableOpacity
                    style={[styles.goBtn, styles.goBtnFuel]}
                    activeOpacity={0.75}
                    onPress={() => { setFuelResults([]); if (f.lat && f.lng) navigateTo([f.lng, f.lat], f.name); }}
                  >
                    <Icon name="gas-station" size={14} color="#0a0c1c" />
                    <Text style={styles.goBtnTxt}>Маршрут</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.fuelWpBtn}
                    activeOpacity={0.75}
                    onPress={() => { setFuelResults([]); if (f.lat && f.lng) addWaypoint([f.lng, f.lat], f.name); }}
                  >
                    <Icon name="map-marker-plus" size={14} color={NEON} />
                    <Text style={styles.fuelWpBtnTxt}>+ Спирка</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
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
      {/* ── Business / place results from GPT-4o search ── */}
      {!navigating && businessResults.length > 0 && (
        <View style={[styles.bizPanel, { top: searchTop + 58 }]}>
          <View style={styles.parkingPanelHeader}>
            <Text style={styles.bizPanelTitle}>📍 Намерени места</Text>
            <TouchableOpacity
              onPress={() => setBusinessResults([])}
              style={styles.parkingDismissBtn}
            >
              <Text style={styles.parkingDismissTxt}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.parkingListContent}
          >
            {businessResults.map((b, i) => {
              const doNavigate = () => { setBusinessResults([]); navigateTo([b.lng, b.lat], b.name); };
              const statusMsg =
                b.business_status === 'CLOSED_PERMANENTLY' ? '🔴 Затворено завинаги' :
                b.business_status === 'CLOSED_TEMPORARILY' ? '🟡 Временно затворено' :
                '🟡 Затворено в момента';
              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.bizCard, b.needs_confirm ? styles.bizCardClosed : null]}
                  activeOpacity={0.75}
                  onPress={() => {
                    if (b.needs_confirm) {
                      Alert.alert(
                        '⚠️ Внимание',
                        `${b.name}\n\n${statusMsg}\n\nЧертаем маршрут?`,
                        [
                          { text: 'Отказ', style: 'cancel' },
                          { text: 'Да, продължи', onPress: doNavigate },
                        ],
                      );
                    } else {
                      doNavigate();
                    }
                  }}
                >
                  {b.source === 'google' && (
                    <View style={styles.sourceBadge}>
                      <Text style={styles.sourceBadgeTxt}>Google</Text>
                    </View>
                  )}
                  {b.photo_url ? (
                    <Image source={{ uri: b.photo_url }} style={styles.bizCardPhoto} />
                  ) : null}
                  {b.needs_confirm ? (
                    <View style={styles.bizClosedBadge}>
                      <Text style={styles.bizClosedBadgeTxt}>{statusMsg}</Text>
                    </View>
                  ) : null}
                  <Text style={styles.bizCardName} numberOfLines={2}>{b.name}</Text>
                  {b.distance_m > 0 && (
                    <Text style={styles.bizCardDist}>{fmtDistance(b.distance_m)}</Text>
                  )}
                  {b.info ? (
                    <Text style={styles.bizCardAddr} numberOfLines={2}>{b.info}</Text>
                  ) : null}
                  {b.review_summary ? (
                    <Text style={styles.bizReviewSummary} numberOfLines={3}>{b.review_summary}</Text>
                  ) : null}
                  <Text style={styles.bizGoTxt}>🚀 Маршрут</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
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
          onStart={(cong, alerts) => {
            setNavCongestionGeoJSON(cong ?? null);
            setNavTrafficAlerts(alerts && alerts.length > 0 ? {
              type: 'FeatureCollection',
              features: alerts.map((a: any) => ({
                type: 'Feature' as const,
                properties: { label: a.label ?? `🛑 +${a.delay_min} мин`, severity: a.severity },
                geometry: { type: 'Point' as const, coordinates: [a.lng, a.lat] },
              })),
            } : null);
            if (routeOptDest) {
              navigateTo(routeOptDest.coords, routeOptDest.name, routeOptDest.waypoints, true);
            }
            setRouteOptions([]);
            setSelectedRouteIdx(null);
            setRestrictionWarnings([]);
          }}
        />
      )}

      {/* ── Road restriction sign popup ── */}
      <RestrictionSign restriction={activeRestriction} />


      {/* ── Wake word indicator ── */}
      {navigating && (
        <View style={{
          position: 'absolute', top: insets.top + 8, right: 12,
          flexDirection: 'row', alignItems: 'center',
          backgroundColor: wakeWordHeard ? '#00C853' : 'rgba(0,0,0,0.55)',
          borderRadius: 16, paddingHorizontal: 8, paddingVertical: 4,
          gap: 4,
        }}>
          <Icon name="microphone" size={14} color={wakeWordHeard ? '#fff' : '#4CAF50'} />
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600' }}>
            {wakeWordHeard ? 'Чух те!' : 'Колега...'}
          </Text>
        </View>
      )}

      {/* ── Navigation HUD ── */}
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
        testLanesMode={testLanesMode}
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


      {/* ── Speed Camera HUD ── */}
      {navigating && cameraAlert && (
        <Animated.View style={[
          styles.cameraHUD,
          { bottom: 320 + insets.bottom },
          {
            borderColor: cameraFlashAnim.interpolate({
              inputRange: [0, 1], outputRange: ['#cc0000', '#ff5555'],
            }),
            backgroundColor: cameraFlashAnim.interpolate({
              inputRange: [0, 1], outputRange: ['rgba(100,0,0,0.90)', 'rgba(210,15,15,0.97)'],
            }),
          },
        ]}>
          <Text style={styles.cameraHUDIcon}>📸</Text>
          <View>
            <Text style={styles.cameraHUDDist}>{cameraAlert.dist} м</Text>
            <Text style={styles.cameraHUDLabel}>КАМЕРА</Text>
          </View>
        </Animated.View>
      )}


      {/* ── Tilt controls ── */}
      {!navigating && (
        <View style={[styles.tiltBtnCol, { bottom: insets.bottom + 100 }]}>
          <TouchableOpacity
            style={styles.tiltBtn}
            activeOpacity={0.8}
            onPress={() => {
              const next = Math.min(mapPitch + 15, 60);
              setMapPitch(next);
              cameraRef.current?.animateCamera({ pitch: next });
            }}
          >
            <Icon name="plus" size={20} color={NEON} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.tiltBtn}
            activeOpacity={0.8}
            onPress={() => {
              const next = Math.max(mapPitch - 15, 0);
              setMapPitch(next);
              cameraRef.current?.animateCamera({ pitch: next });
            }}
          >
            <Icon name="minus" size={20} color={NEON} />
          </TouchableOpacity>
        </View>
      )}



      {/* ── Visual Debug Overlay ── */}
      {debugMode && (
        <View style={[styles.debugOverlay, { top: insets.top + 120 }]}>
          <Text style={styles.debugTitle}>▍ DEBUG</Text>
          <Text style={styles.debugRow}>📍 Крачка: {currentStep + 1}</Text>
          <Text style={styles.debugRow}>
            📏 До завой: {distToTurn != null ? `${Math.round(distToTurn)} м` : '—'}
          </Text>
          <Text style={styles.debugRow}>
            🛣️ EU знак: {distToTurn != null && distToTurn < SIGN_TRIGGER_M ? '✅ ВИДИМ' : '⬜ скрит'}
          </Text>
          <Text style={styles.debugRow}>
            🚦 Ленти: {displayLanes.length > 0 ? `${displayLanes.length} (${displayLanes.filter(l => l.active).length} активни)` : '—'}
          </Text>
          <TouchableOpacity
            style={[styles.debugLaneTestBtn, testLanesMode && styles.debugLaneTestBtnOn]}
            onPress={() => setTestLanesMode(v => !v)}
          >
            <Text style={styles.debugLaneTestTxt}>
              {testLanesMode ? '🚦 TEST LANES ON' : '🚦 Test Lanes'}
            </Text>
          </TouchableOpacity>
          <Text style={styles.debugRow}>⚡ Скорост: {speed} км/ч</Text>
          <Text style={styles.debugRow}>🎯 Лимит: {speedLimit ?? '—'} км/ч</Text>
          <Text style={styles.debugRow}>
            {simulating ? '🟢 SIM активен' : '🔴 GPS реален'}
          </Text>
        </View>
      )}

      {/* ── Chat FABs ── */}
      {!route && (
        <>
          <TouchableOpacity
            style={[
              styles.geminiFab,
              { left: spacing.md, bottom: insets.bottom + spacing.xl },
              backendOnline ? styles.geminiFabOnline : styles.geminiFabOffline,
            ]}
            onPress={() => {
              setGeminiChatOpen(v => !v);
              setGptChatOpen(false);
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.geminiFabEmoji}>{geminiChatOpen ? '✕' : '💬'}</Text>
            <View style={[styles.onlineDot, backendOnline ? styles.onlineDotGreen : styles.onlineDotGrey]} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.geminiFab,
              { bottom: insets.bottom + spacing.xl },
              backendOnline ? styles.geminiFabOnline : styles.geminiFabOffline,
            ]}
            onPress={() => {
              setGptChatOpen(v => !v);
              setGeminiChatOpen(false);
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.geminiFabEmoji}>{gptChatOpen ? '✕' : '🤖'}</Text>
            <View style={[styles.onlineDot, backendOnline ? styles.onlineDotGreen : styles.onlineDotGrey]} />
          </TouchableOpacity>
        </>
      )}

      {/* ── Recenter button ── */}
      {navigating && !isTracking && (
        <TouchableOpacity
          style={[
            styles.geminiFab,
            { right: spacing.md, bottom: insets.bottom + 100, backgroundColor: 'rgba(10,12,30,0.92)' },
          ]}
          activeOpacity={0.8}
          onPress={() => {
            setIsTracking(true);
            if (userCoords) {
              cameraRef.current?.animateToRegion({
                latitude: userCoords[1],
                longitude: userCoords[0],
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
              });
            }
          }}
        >
          <Icon name="crosshairs-gps" size={22} color="#fff" />
        </TouchableOpacity>
      )}

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
