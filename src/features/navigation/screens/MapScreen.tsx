import React, { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import {
  View,
  TouchableOpacity,
  Text,
  TextInput,
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  ScrollView,
  Keyboard,
  Alert,
  Image,
  Animated,
  Linking,
  Share,
} from 'react-native';
import Tts from 'react-native-tts';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import Geolocation from 'react-native-geolocation-service';
import Mapbox, { locationManager, LocationPuck } from '@rnmapbox/maps';

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
import { MAP_CENTER } from '../../../shared/constants/config';
import { useVehicleStore } from '../../../store/vehicleStore';
import type { VehicleProfile } from '../../../shared/types/vehicle';
import type { RootStackParamList } from '../../../shared/types/navigation';
import SearchBar from '../components/SearchBar';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
} from '../../../shared/services/backendApi';

type MapNavProp = NativeStackNavigationProp<RootStackParamList, 'Map'>;

const EMPTY_RESTRICTIONS: never[] = [];

import MapLayers from '../components/MapLayers';
import { styles, NEON, NEON_DIM } from './MapScreen.styles';
import {
  NAV_ARROW, SIGN_CLOSED, SIGN_DANGER0, STAR_ICON,
  ICON_PARKING, ICON_FUEL, ICON_CAMERA, ICON_BIZ, ICON_NO_OVERTAKING,
  NAV_PADDING, ZERO_PADDING,
  APP_URL_MAP, HOS_LIMIT_S, POI_CATEGORIES,
  DEPART_LABELS, type DepartLabel, departIso,
  ttsSpeak, parseBubbleText, voiceText,
  fmtHOS, haversineMeters, weatherEmoji, detectCountryCode, openInBrowser,
  laneDirectionEmoji, StableCamera,
} from '../utils/mapUtils';

import { useMapUIState, type MapMode } from '../hooks/useMapUIState';
import { useNavigationState, type RouteOptDest } from '../hooks/useNavigationState';
import { useRouteInsights } from '../hooks/useRouteInsights';
import { useRouteOrchestrator } from '../hooks/useRouteOrchestrator';
import { useDrivingAlerts } from '../hooks/useDrivingAlerts';
import { useLocationRuntime } from '../hooks/useLocationRuntime';
import { useWakeWord } from '../hooks/useWakeWord';

// AudioRecorderPlayer is exported as a ready-made singleton — use directly

// ── Component ────────────────────────────────────────────────────────────────

const MapScreen: React.FC = () => {
  const navigation = useNavigation<MapNavProp>();
  const insets = useSafeAreaInsets();
  const { profile } = useVehicleStore();
  const cameraRef = useRef<Mapbox.Camera>(null);

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
    destination, setDestination,
    destinationName, setDestinationName,
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

  useEffect(() => { profileRef.current         = profile;          }, [profile]);

  const {
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
  } = useRouteOrchestrator({
    isMountedRef,
    navigatingRef,
    routeRef,
    profileRef,
    userCoordsRef: orchestratorUserCoordsRef,
    cameraRef,
    profile,
    destination,
    destinationName,
    departAt,
    avoidUnpaved,
    waypoints,
    waypointNames,
    buildRoutePOIScan: (r) => buildRoutePOIScanRef.current(r),
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
    setNavCongestionGeoJSON: (geojson) => setNavCongestionGeoJSONRef.current(geojson),
    setWaypoints,
    setWaypointNames,
    setRouteOptions,
    setRouteOptDest,
  });

  // ── States & Refs from useLocationRuntime ──────────────────────────────────
  const {
    userCoords,
    userCoordsRef,
    setUserCoords,
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
    lastParkingRef,
    lastRestrictionRef,
    setAutoParking,
    setTunnelWarning: (msg) => setTunnelWarningRef.current(msg),
    setSpeedLimit,
    setCurrentStep,
    setDistToTurn,
    setNavPhase,
    setRoute,
    setNavCongestionGeoJSON,
    navigating,
  });
  // Sync GPS userCoordsRef → orchestratorUserCoordsRef so navigateTo uses real position
  useLayoutEffect(() => {
    orchestratorUserCoordsRef.current = userCoordsRef.current;
  }, [userCoords]);

  // ── Hooks Integration ──────────────────────────────────────────────────────

  // 0. Session bootstrap (account, starred POIs, backend health)
  const setTachoSummaryRef = useRef<(summary: TachoSummary) => void>(() => {});

  const {
    backendOnline,
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
  const {
    drivingSeconds, tachoSummary, setTachoSummary, resetSession, saveSession
  } = useTacho(navigating, isDrivingRef, googleUserRef, speak);
  useLayoutEffect(() => { setTachoSummaryRef.current = setTachoSummary; });

  // 3. POI Search (Nearby & Along Route)
  const {
    poiCategory, poiResults, loadingPOI, sarMode, handlePOISearch, handleSARSearch, clearPOI
  } = usePOI(userCoordsRef, routeRef, MAP_CENTER);

  // 4. AI Chat (GPT-4o + Gemini)
  const [gptHistory, setGptHistory]           = useState<ChatMessage[]>([]);
  const [geminiHistory, setGeminiHistory]     = useState<ChatMessage[]>([]);
  const [gptChatOpen, setGptChatOpen]         = useState(false);
  const [geminiChatOpen, setGeminiChatOpen]   = useState(false);
  const [chatInput, setChatInput]             = useState('');

  // Results from AI actions (parkingResults/fuelResults/cameraResults declared above useRouteOrchestrator)
  const [selectedParking, setSelectedParking] = useState<POICard | null>(null);
  const [selectedFuel, setSelectedFuel]       = useState<POICard | null>(null);
  const [businessResults, setBusinessResults] = useState<POICard[]>([]);
  interface AITachoResult {
    drivenHours: number;
    remainingHours: number;
    breakNeeded: boolean;
    suggestedStop?: { lat: number; lng: number; name: string };
  }
  const [tachographResult, setTachographResult] = useState<AITachoResult | null>(null);

  const {
    gptLoading, geminiLoading, sendGptText, sendGeminiText
  } = useChat({
    userCoords, drivingSeconds, speed, profile,
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

  const chatLoading = gptChatOpen ? gptLoading : geminiLoading;

  // ── Hands-free wake word: "Колега, <команда>" ─────────────────────────────
  // Активен само при навигация — пести батерия при browse mode.
  // Пауза автоматично докато TTS говори за да не чуе себе си.
  const [wakeWordHeard, setWakeWordHeard] = useState(false); // brief visual flash

  const handleWakeCommand = useCallback((cmd: string) => {
    if (!cmd) return;
    setWakeWordHeard(true);
    setTimeout(() => setWakeWordHeard(false), 1200);
    sendGeminiText(cmd);
  }, [sendGeminiText]);

  useWakeWord({ active: navigating, onCommand: handleWakeCommand });

  const handleChat = useCallback(async () => {
    const text = chatInput.trim();
    if (!text) return;
    setChatInput('');
    Keyboard.dismiss();
    if (gptChatOpen) {
      await sendGptText(text);
    } else {
      await sendGeminiText(text);
    }
  }, [chatInput, gptChatOpen, sendGptText, sendGeminiText]);

  // ── Voice / Microphone Handling ──
  const [isRecording, setIsRecording] = useState(false);
  const [micLoading, setMicLoading]   = useState(false);
  const audioRecorderPlayer = AudioRecorderPlayer; // singleton — not constructable

  const handleMicStart = useCallback(async () => {
    try {
      if (Platform.OS === 'android') {
        const grants = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
          PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
        ]);
        if (grants['android.permission.RECORD_AUDIO'] !== PermissionsAndroid.RESULTS.GRANTED) return;
      }
      setIsRecording(true);
      await audioRecorderPlayer.startRecorder();
      audioRecorderPlayer.addRecordBackListener(() => {});
    } catch (err) {
      console.error('[MicStart] error:', err);
    }
  }, [audioRecorderPlayer]);

  const handleMicStop = useCallback(async () => {
    if (!isRecording) return;
    setIsRecording(false);
    setMicLoading(true);
    try {
      const uri = await audioRecorderPlayer.stopRecorder();
      audioRecorderPlayer.removeRecordBackListener();

      const { transcribeAudio } = await import('../../../shared/services/backendApi');
      const text = await transcribeAudio(uri);

      if (text) {
        setChatInput(text);
        setTimeout(() => handleChat(), 200);
      }
    } catch (err) {
      console.error('[MicStop] transcription error:', err);
    } finally {
      setMicLoading(false);
    }
  }, [isRecording, audioRecorderPlayer, handleChat]);

  // ── Keyboard height ──
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', e => setKbHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKbHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const gptScrollRef    = useRef<ScrollView>(null);
  const geminiScrollRef = useRef<ScrollView>(null);

  // Border crossings
  const [borderCrossings, setBorderCrossings] = useState<Array<{
    name: string; flag: string; status: string; url: string;
  }>>([]);
  const [showBorderPanel, setShowBorderPanel] = useState(false);

  // ── GPS / route / waypoint state ───────────────────────────────────────────
  const {
    elevProfile,
    weatherPoints,
    routeAheadPOIs,
    buildElevProfile,
    fetchWeatherForRoute,
    buildRoutePOIScan,
  } = useRouteInsights(route);

  useEffect(() => { buildRoutePOIScanRef.current = buildRoutePOIScan; }, [buildRoutePOIScan]);
  useEffect(() => { setNavCongestionGeoJSONRef.current = setNavCongestionGeoJSON; }, [setNavCongestionGeoJSON]);

  // ── Faster route detection ────────────────────────────────────────────────
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

  const lastAlertCheckPos  = useRef<[number, number] | null>(null);

  // Convenience alias — JSX uses mapIsLoaded for readability
  const mapIsLoaded = mapLoaded;

  // ── Auto Day/Night Theme based on hour ────────────────────────────────────
  useEffect(() => {
    const hour = new Date().getHours();
    const isDay = hour >= 7 && hour < 19;
    console.log(`[MapScreen] Auto-theme: ${isDay ? 'Day' : 'Night'} mode (hour: ${hour})`);
    setLightMode(isDay);
  }, [setLightMode]);

  // ── Load Google account + starred POIs + tacho summary on mount ──────────

  // ── HOS timer & warnings handled by useTacho hook ────────────────────────

  // ── Live ETA countdown — resets when route changes (reroute refreshes duration) ──
  useEffect(() => {
    if (!navigating || !route) { setRemainingSeconds(0); return; }
    navStartRef.current      = Date.now();
    navInitDurationRef.current = route.duration;
    setRemainingSeconds(route.duration);
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - navStartRef.current) / 1000);
      setRemainingSeconds(Math.max(0, navInitDurationRef.current - elapsed));
    }, 30_000); // 30s instead of 10s
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigating, route]);
  const handleMapLongPress = useCallback((event: GeoJSON.Feature) => {
    if (event.geometry.type !== 'Point') return;
    const [lng, lat] = (event.geometry as GeoJSON.Point).coordinates as [number, number];
    setLongPressCoord([lng, lat]);
  }, []);

  // ── Destination selection (from SearchBar) ────────────────────────────────

  const handleDestinationSelect = useCallback(
    (place: GeoPlace) => navigateTo(place.center, place.text),
    [navigateTo],
  );

  // ── Start navigation ──────────────────────────────────────────────────────

  const handleStart = useCallback(() => {
    lastSpokenStepRef.current = -1; // allow first step to be spoken
    setCurrentStep(0);
    setDistToTurn(null);
    // Reset continuous HOS counter; record session start time
    resetSession();

    // Data Saver: automatically switch to vector mode when starting navigation
    // to avoid heavy satellite/hybrid tiles on mobile data.
    if (mapMode !== 'vector') setMapMode('vector');

    // Set navigating LAST — StableCamera's followUserLocation will activate and
    // smoothly move the camera to the user. Do NOT call flyTo() here: it conflicts
    // with followUserLocation and crashes the native Camera animation node.
    setNavPhase('NAVIGATING');
    if (!voiceMutedRef.current) {
      Tts.stop();
      ttsSpeak('Навигацията е стартирана');
    }
  }, [mapMode, resetSession]);
  handleStartRef.current = handleStart; // keep ref fresh each render

  // ── Stop navigation, keep route (Спри навигацията) ────────────────────────
  // Keeps the route so the user can press "Тръгваме!" again without re-searching.
  const handleStopNav = useCallback(() => {
    Tts.stop();
    setNavPhase('ROUTE_PREVIEW');
    setNavCongestionGeoJSON(null);
    setNavTrafficAlerts(null);
    setMapPitch(0);
    setCurrentStep(0);
    setDistToTurn(null);
    lastRerouteRef.current = 0;
    saveSession(); // persist to backend if session ≥ 60 s
  }, [saveSession, setNavPhase]);

  // ── Clear route & stop navigation entirely (✕ close button) ───────────────
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
    resetSession(); // resets drivingSeconds + HOS warnings
    setWaypoints([]);
    setWaypointNames([]);
    setLongPressCoord(null);
    setCameraAlert(null);
    waypointsRef.current     = [];
    waypointNamesRef.current = [];
    lastRerouteRef.current = 0;
    cameraRef.current?.flyTo([MAP_CENTER.longitude, MAP_CENTER.latitude], 800);
    // Also stop any running simulator
    if (simIntervalRef.current) clearInterval(simIntervalRef.current);
    isSimulatingRef.current = false;
    setSimulating(false);
    simIndexRef.current = 0;
  }, [clearPOI, resetSession]);

  // ── Custom origin handler ─────────────────────────────────────────────────
  const handleOriginChange = useCallback((place: import('../api/geocoding').GeoPlace | null) => {
    customOriginRef.current = place?.center ?? null;
    setCustomOriginName(place?.text ?? '');
  }, []);

  // ── Route option selection + restrictions check ───────────────────────────
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

  // ── Navigation Simulator ───────────────────────────────────────────────────
  // Moves the user position along route.geometry.coordinates at ~80 km/h.
  const startSim = useCallback(() => {
    const coords = routeRef.current?.geometry.coordinates;
    if (!coords || coords.length < 2) return;
    simIndexRef.current = 0;
    isSimulatingRef.current = true;
    setSimulating(true);
    // ~80 km/h: route coords are ~20 m apart on average; 1 tick = 500ms = 40 m/s ≈ 144 km/h
    // Skip every 2 coords to land near 80 km/h
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
      simIndexRef.current = idx + 2; // advance 2 coords per 500ms ≈ 80 km/h
    }, 500);
  }, []);

  const stopSim = useCallback(() => {
    if (simIntervalRef.current) clearInterval(simIntervalRef.current);
    isSimulatingRef.current = false;
    setSimulating(false);
    simIndexRef.current = 0;
  }, []);

  // ── App deep-link handler ──────────────────────────────────────────────────
  const handleAppIntent = useCallback((intent: AppIntent) => {
    // 1. Direct URL priority (e.g. from Gemini TransParking intent)
    if (intent.url) {
      Linking.openURL(intent.url).catch(() => null);
      return;
    }

    // 2. Named app logic via APP_URL_MAP
    const builder = APP_URL_MAP[intent.app.toLowerCase()];
    const url = builder ? builder(intent.query) : null;
    if (!url) return;
    Linking.openURL(url).catch(() => {
      const q = intent.query ?? intent.app;
      Linking.openURL(`https://www.google.com/search?q=${encodeURIComponent(q)}`).catch(() => null);
    });
  }, []);

  // Puck scale: arrow grows when approaching a turn (≤300 m) so the driver
  // can clearly see the heading. Uses a plain number — Value<number> accepts
  // both static numbers and Mapbox expressions.
  const puckScale = useMemo(() => {
    if (!navigating || distToTurn == null || distToTurn > 300) return 1.0;
    if (distToTurn < 50)  return 2.0;
    if (distToTurn < 150) return 1.5;
    return 1.2;
  }, [navigating, distToTurn]);

  // ── Auto-fit map to POI results (from AI chat) ───────────────────────────
  useEffect(() => {
    const results = parkingResults.length > 0 ? parkingResults : businessResults;
    if (results.length === 0 || !cameraRef.current) return;

    // Build bounding box
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    results.forEach(p => {
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
    });

    if (minLng === maxLng && minLat === maxLat) {
      cameraRef.current.flyTo([minLng, minLat], 14);
    } else {
      cameraRef.current.fitBounds(
        [maxLng, maxLat],
        [minLng, minLat],
        [100, 50, 250, 50], // top, right, bottom, left padding
        1000,
      );
    }
  }, [parkingResults, businessResults]);

  // ── Render ────────────────────────────────────────────────────────────────

  // Dynamic terrain exaggeration: stronger relief when driving fast (rural / highway)
  const terrainExaggeration = speed > 90 ? 2.0 : speed > 60 ? 1.6 : speed > 30 ? 1.3 : 1.0;

  // Nearest truck parking distance — shown in HUD during navigation
  const nearestParkingM = useMemo(() => {
    if (!parkingResults.length) return null;
    return Math.min(...parkingResults.map(p => p.distance_m));
  }, [parkingResults]);

  // ── GeoJSON for POI SymbolLayers (replaces PointAnnotation — much lighter) ──
  const parkingGeoJSON = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: parkingResults.map((p, i) => ({
      type: 'Feature' as const,
      id: i,
      geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
      properties: { index: i, name: p.name },
    })),
  }), [parkingResults]);

  const fuelGeoJSON = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: fuelResults.filter(f => f.lat && f.lng).map((f, i) => ({
      type: 'Feature' as const,
      id: i,
      geometry: { type: 'Point' as const, coordinates: [f.lng, f.lat] },
      properties: {},
    })),
  }), [fuelResults]);

  const businessGeoJSON = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: businessResults.map((b, i) => ({
      type: 'Feature' as const,
      id: i,
      geometry: { type: 'Point' as const, coordinates: [b.lng, b.lat] },
      properties: {},
    })),
  }), [businessResults]);

  const cameraGeoJSON = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: cameraResults.filter(c => c.lat && c.lng).map((c, i) => ({
      type: 'Feature' as const,
      id: i,
      geometry: { type: 'Point' as const, coordinates: [c.lng, c.lat] },
      properties: { maxspeed: c.maxspeed ? String(c.maxspeed) : '' },
    })),
  }), [cameraResults]);

  // ── GeoJSON for SymbolLayers replacing PointAnnotation (GEMINI.md rule) ──
  const waypointsGeoJSON = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: waypoints.map((coords, i) => ({
      type: 'Feature' as const,
      id: i,
      geometry: { type: 'Point' as const, coordinates: coords },
      properties: { label: String(i + 1) },
    })),
  }), [waypoints]);

  const poiResultsGeoJSON = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: poiResults.map((poi, i) => ({
      type: 'Feature' as const,
      id: i,
      geometry: { type: 'Point' as const, coordinates: poi.coordinates },
      properties: { emoji: POI_META[poi.category].emoji, poiId: poi.id },
    })),
  }), [poiResults]);

  const weatherGeoJSON = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: weatherPoints.map((wp, i) => ({
      type: 'Feature' as const,
      id: i,
      geometry: { type: 'Point' as const, coordinates: wp.coords },
      properties: { label: `${wp.emoji}\n${wp.temp}°` },
    })),
  }), [weatherPoints]);

  // ── Highway exit markers — placed on map at off-ramp positions (Google Maps style) ──
  const exitsGeoJSON = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!route) return { type: 'FeatureCollection', features: [] };
    const features: GeoJSON.Feature[] = [];
    route.steps.forEach((step, i) => {
      const type = step.maneuver.type;
      if (type !== 'off ramp' && type !== 'exit motorway') return;
      const loc = step.intersections?.[0]?.location;
      if (!loc) return;
      const banner = step.bannerInstructions?.[0];
      // Extract exit number from banner components
      const exitNum = banner?.primary?.components?.find(c => c.type === 'exit-number')?.text ?? null;
      // Primary destination name
      const destName = banner?.primary?.components?.find(c => c.type === 'text')?.text
        ?? step.name
        ?? '';
      features.push({
        type: 'Feature' as const,
        id: i,
        geometry: { type: 'Point' as const, coordinates: loc },
        properties: {
          exitNum: exitNum ?? '',
          label: exitNum ? `⬡${exitNum}` : '⬡',
          dest: destName,
        },
      });
    });
    return { type: 'FeatureCollection', features };
  }, [route]);

  // ── Derived / computed values ─────────────────────────────────────────────

  const routeShape = route
    ? ({ type: 'Feature', properties: {}, geometry: route.geometry } as const)
    : null;

  // ── Congestion overlay: only show 15 km ahead during navigation ─────────────
  const navCongestionVisible = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!navigating || !userCoords || !navCongestionGeoJSON) return null;
    const MAX_M = 15_000;
    const features = navCongestionGeoJSON.features.filter(f => {
      const coords = (f.geometry as GeoJSON.LineString).coordinates;
      if (!coords?.length) return false;
      const [lng, lat] = coords[0] as [number, number];
      return haversineMeters(userCoords, [lng, lat]) <= MAX_M;
    });
    return { type: 'FeatureCollection', features };
  }, [navigating, userCoords, navCongestionGeoJSON]);

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

  // ── Nearest upcoming restriction sign (within 600m, strictly ahead on route) ──
  const activeRestriction = useMemo<RestrictionPoint | null>(() => {
    if (!navigating || !userCoords || !route?.restrictions?.length) return null;
    const coords = route.geometry.coordinates;
    const ALERT_M = 600;

    // Find user's closest index along route
    let userIdx = 0;
    let userMinD = Infinity;
    for (let i = 0; i < coords.length; i++) {
      const d = haversineMeters(userCoords, [coords[i][0], coords[i][1]]);
      if (d < userMinD) { userMinD = d; userIdx = i; }
    }

    let nearest: RestrictionPoint | null = null;
    let nearestDist = Infinity;
    for (const r of route.restrictions) {
      // Find restriction's closest index along route
      let rIdx = 0;
      let rMinD = Infinity;
      for (let i = userIdx; i < coords.length; i++) {
        const d = haversineMeters([r.lng, r.lat], [coords[i][0], coords[i][1]]);
        if (d < rMinD) { rMinD = d; rIdx = i; }
      }
      // Only show if restriction is ahead (index > user) and within 600m
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
    : '#0A84FF';

  const mapStyleURL: string =
    mapMode === 'satellite' ? 'mapbox://styles/mapbox/satellite-v9'          :
    mapMode === 'hybrid'    ? 'mapbox://styles/mapbox/satellite-streets-v12' :
    JSON.stringify({
      version: 8,
      imports: [{ id: 'basemap', url: 'mapbox://styles/mapbox/standard', config: {
        lightPreset: lightMode ? 'day' : 'night',
        showPointOfInterestLabels: true,
        showTransitLabels: true,
        showPlaceLabels: true,
        showRoadLabels: true,
        showTrafficIncidents: showIncidents,
      }}],
    });

  const searchTop = insets.top + 18;
  const isSearchingAlongRoute = loadingPOI && sarMode;
  const handleSearchAlongRoute = () => { if (poiCategory) handleSARSearch(poiCategory); };

  const currentLanes = useMemo(() => {
    return stepToShow?.bannerInstructions?.[0]?.sub?.components.filter(
      c => c.type === 'lane',
    ) ?? [];
  }, [stepToShow]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const overtakingGeoJSON = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: overtakingResults.map((r, i) => ({
      type: 'Feature' as const,
      id: i,
      geometry: { type: 'Point' as const, coordinates: [r.lng, r.lat] },
      properties: { ...r },
    })),
  }), [overtakingResults]);

  const starGeoJSON = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: starredPOIs.map((p, i) => ({
      type: 'Feature' as const,
      id: i,
      geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
      properties: { name: p.name },
    })),
  }), [starredPOIs]);

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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handlePOINavigate = useCallback((poi: import('../api/poi').TruckPOI) => {
    clearPOI();
    navigateTo(poi.coordinates, poi.name);
  }, [navigateTo, clearPOI]);

  const handleReportCamera = useCallback(() => {
    playCameraAlert();
    Alert.alert('Благодарим!', 'Камерата е докладвана.');
  }, [playCameraAlert]);

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

      {/* ── Map ── */}
      <Mapbox.MapView
        style={styles.map}
        styleURL={mapStyleURL}
        pitchEnabled
        scaleBarEnabled={false}
        attributionPosition={{ bottom: 8, left: 8 }}
        onDidFinishLoadingStyle={() => setMapIsLoaded(true)}
        onLongPress={handleMapLongPress}
        onPress={() => {
          if (gptChatOpen) setGptChatOpen(false);
          if (geminiChatOpen) setGeminiChatOpen(false);
          if (longPressCoord) setLongPressCoord(null);
          if (selectedParking) setSelectedParking(null);
        }}
      >
        {/* nav-arrow + road sign images pre-loaded into the Mapbox atlas.
            Must be inside MapView. onImageMissing fires if a layer references
            an image that was not registered — helps debugging. */}
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
          }}
          onImageMissing={(imageKey) => {
            console.warn('[Mapbox] missing image in atlas:', imageKey);
          }}
        />

        {/* Always pass followUserMode + followZoomLevel with concrete values.
            Mapbox creates an Animated node for every prop it first receives.
            If a prop appears later its Animated.Value starts as undefined →
            "Animated.timing called on undefined". */}
        <StableCamera cameraRef={cameraRef} navigating={navigating} mapLoaded={mapIsLoaded} />

        {/* UserLocation: GPS data only — no visual puck (LocationPuck handles rendering).
            minDisplacement={0} delivers every position update without threshold filtering.
            visible={false} suppresses the deprecated built-in puck marker. */}
        {/* UserLocation: keeps Mapbox location engine warm for LocationPuck */}
        <Mapbox.UserLocation visible={false} />

        {/* LocationPuck — Neon Blue glowing arrow (Mapbox v10.2.10).
            bearingImage="nav-arrow" — custom PNG for the middle rotating layer;
              without this prop the puck renders as a static dot (no rotation).
            pulsing.color=NEON      — neon-blue sonar ring around the puck.
            pulsing.radius=30       — fixed 30 dp radius (clean ring vs accuracy blob). */}
        <LocationPuck
          puckBearingEnabled
          puckBearing="course"
          topImage="nav-arrow"
          bearingImage="nav-arrow"
          shadowImage="nav-arrow"
          scale={puckScale}
          pulsing={{ isEnabled: true, color: NEON, radius: 30 }}
          visible
        />

        <MapLayers
          mapIsLoaded={mapIsLoaded}
          mapMode={mapMode}
          showTraffic={showTraffic}
          showIncidents={showIncidents}
          showRestrictions={showRestrictions}
          showStarredLayer={showStarredLayer}
          navigating={navigating}
          trafficKey={trafficKey}
          lightMode={lightMode}
          route={route}
          routeShape={routeShape}
          routeLineColor={routeLineColor}
          exitsGeoJSON={exitsGeoJSON}
          navTrafficAlerts={navTrafficAlerts}
          starGeoJSON={starGeoJSON}
          starredPOIs={starredPOIs}
          customOriginRef={customOriginRef}
          userCoords={userCoords}
          destination={destination}
          parkingResults={parkingResults}
          fuelResults={fuelResults}
          businessResults={businessResults}
          businessGeoJSON={businessGeoJSON}
          cameraResults={cameraResults}
          cameraGeoJSON={cameraGeoJSON}
          overtakingResults={overtakingResults}
          overtakingGeoJSON={overtakingGeoJSON}
          navCongestionVisible={navCongestionVisible}
          routeOptions={routeOptions}
          selectedRouteIdx={selectedRouteIdx}
          navigateTo={navigateTo}
          setSelectedParking={setSelectedParking}
          setSelectedFuel={setSelectedFuel}
          handleSelectRouteOption={handleSelectRouteOption}
          ttsSpeak={ttsSpeak}
          voiceMutedRef={voiceMutedRef}
          restrictionPoints={route?.restrictions ?? EMPTY_RESTRICTIONS}
        />

      </Mapbox.MapView>

      {/* ── Floating fuel station detail bubble ── */}
      {selectedFuel && (
        <FuelPanel
          fuel={selectedFuel}
          onClose={() => setSelectedFuel(null)}
          topOffset={insets.top + 68}
          onAddWaypoint={(coords, name) => {
            setSelectedFuel(null);
            setFuelResults([]);
            addWaypoint(coords, name);
          }}
        />
      )}

      {/* ── Floating parking detail bubble (appears when map pin is tapped) ── */}
      {selectedParking && (
        <View style={[styles.parkingBubble, { top: insets.top + 68 }]}>
          {/* Header row */}
          <View style={styles.parkingBubbleHeader}>
            <Text style={styles.parkingBubbleName} numberOfLines={2}>
              🅿️ {selectedParking.name}
            </Text>
            <TouchableOpacity
              onPress={() => setSelectedParking(null)}
              style={styles.parkingBubbleClose}
            >
              <Text style={styles.parkingBubbleCloseTxt}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Distance + hours */}
          <Text style={styles.parkingBubbleDist}>
            {fmtDistance(selectedParking.distance_m)}
            {selectedParking.opening_hours ? `  ·  ${selectedParking.opening_hours}` : ''}
          </Text>

          {/* Amenity badge row */}
          <View style={styles.parkingBubbleBadgeRow}>
            <View style={[styles.pkBadge, selectedParking.paid ? styles.pkBadgePaid : styles.pkBadgeFree]}>
              <Text style={styles.pkBadgeTxt}>{selectedParking.paid ? '💰 Платен' : '🆓 Безплатен'}</Text>
            </View>
            {selectedParking.showers && (
              <View style={styles.pkBadge}><Text style={styles.pkBadgeTxt}>🚿</Text></View>
            )}
            {selectedParking.toilets && (
              <View style={styles.pkBadge}><Text style={styles.pkBadgeTxt}>🚽</Text></View>
            )}
            {selectedParking.wifi && (
              <View style={styles.pkBadge}><Text style={styles.pkBadgeTxt}>📶 WiFi</Text></View>
            )}
            {selectedParking.security && (
              <View style={styles.pkBadge}><Text style={styles.pkBadgeTxt}>🔒 Охрана</Text></View>
            )}
            {selectedParking.lighting && (
              <View style={styles.pkBadge}><Text style={styles.pkBadgeTxt}>🔦 Осветен</Text></View>
            )}
            {selectedParking.capacity != null && (
              <View style={styles.pkBadge}>
                <Text style={styles.pkBadgeTxt}>🚛 {selectedParking.capacity}</Text>
              </View>
            )}
          </View>

          {/* Action buttons */}
          <View style={styles.parkingBubbleBtns}>
            <TouchableOpacity
              style={styles.parkingBubbleNavBtn}
              activeOpacity={0.8}
              onPress={() => {
                const p = selectedParking;
                setSelectedParking(null);
                setParkingResults([]);
                navigateTo([p.lng, p.lat], p.name);
              }}
            >
              <Icon name="navigation-variant" size={16} color="#0a0c1c" />
              <Text style={styles.parkingBubbleNavBtnTxt}>Навигация</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.parkingBubbleWpBtn}
              activeOpacity={0.8}
              onPress={() => {
                const p = selectedParking;
                setSelectedParking(null);
                setParkingResults([]);
                addWaypoint([p.lng, p.lat], p.name);
              }}
            >
              <Icon name="map-marker-plus" size={16} color={NEON} />
              <Text style={styles.parkingBubbleWpBtnTxt}>+ Спирка</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.parkingBubbleWebBtn}
              activeOpacity={0.8}
              onPress={() => {
                if (selectedParking.website) {
                  openInBrowser(selectedParking.website);
                } else {
                  const cc = detectCountryCode(selectedParking.lat, selectedParking.lng);
                  const base = cc === 'eu'
                    ? 'https://truckerapps.eu/transparking/'
                    : `https://truckerapps.eu/transparking/${cc}/map/`;
                  openInBrowser(base);
                }
              }}
            >
              <Icon name="open-in-new" size={16} color={NEON} />
              <Text style={styles.parkingBubbleWebBtnTxt}>Инфо</Text>
            </TouchableOpacity>

            {selectedParking.voice_desc && (
              <TouchableOpacity
                style={styles.parkingBubbleTtsBtn}
                activeOpacity={0.8}
                onPress={() => ttsSpeak(selectedParking.voice_desc!)}
              >
                <Icon name="volume-high" size={16} color="#fff" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* ── Long-press popup — glassmorphism card with icon buttons ── */}
      {longPressCoord && (
        <View style={styles.longPressPopup}>
          {/* Header row */}
          <View style={styles.longPressHeader}>
            <Icon name="map-marker" size={18} color="#00bfff" />
            <Text style={styles.longPressTitle}> Задържана точка</Text>
            <TouchableOpacity
              style={styles.longPressCloseBtn}
              activeOpacity={0.7}
              onPress={() => setLongPressCoord(null)}
            >
              <Icon name="close" size={18} color="rgba(255,255,255,0.6)" />
            </TouchableOpacity>
          </View>
          <Text style={styles.longPressCoords}>
            {longPressCoord[1].toFixed(5)}, {longPressCoord[0].toFixed(5)}
          </Text>

          {/* Action buttons */}
          <View style={styles.longPressBtns}>
            {/* Navigate button */}
            <TouchableOpacity
              style={styles.longPressBtn}
              activeOpacity={0.75}
              onPress={() => {
                const coord = longPressCoord;
                setLongPressCoord(null);
                navigateTo(coord, `${coord[1].toFixed(4)}, ${coord[0].toFixed(4)}`);
              }}
            >
              <View style={styles.longPressBtnInner}>
                <Icon name="navigation" size={20} color="#0a0c1c" />
                <Text style={styles.longPressBtnTxt}>Упътване</Text>
              </View>
            </TouchableOpacity>

            {/* Add as waypoint — only when route exists */}
            {destination && (
              <TouchableOpacity
                style={[styles.longPressBtn, styles.longPressBtnWaypoint]}
                activeOpacity={0.75}
                onPress={() => {
                  const coord = longPressCoord;
                  setLongPressCoord(null);
                  addWaypoint(coord, `Спирка ${waypointsRef.current.length + 1}`);
                }}
              >
                <View style={styles.longPressBtnInner}>
                  <Icon name="map-marker-plus" size={20} color="#0a0c1c" />
                  <Text style={styles.longPressBtnTxt}>Добави спирка</Text>
                </View>
              </TouchableOpacity>
            )}

            {/* ⭐ Star — save as Google Favourite */}
            <TouchableOpacity
              style={[styles.longPressBtn, styles.longPressBtnStar]}
              activeOpacity={0.75}
              onPress={async () => {
                const coord = longPressCoord!;
                setLongPressCoord(null);
                const name = `⭐ ${coord[1].toFixed(4)}, ${coord[0].toFixed(4)}`;
                const saved = await starPlace(name, coord[1], coord[0], undefined, googleUser?.email);
                if (saved) setStarredPOIs(prev => [...prev, saved]);
              }}
            >
              <View style={styles.longPressBtnInner}>
                <Text style={{ fontSize: 18 }}>⭐</Text>
                <Text style={styles.longPressBtnTxt}>Запази</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>
      )}

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
            /* Junction Sign — EU-style sign + split lane view within 800 m */
            <SignRenderer
              step={stepToShow}
              nextStep={nextStep ?? undefined}
              distToTurn={distToTurn}
              lanes={currentLanes}
              banner={stepToShow.bannerInstructions?.[0]}
            />
          ) : (
            /* Simple nav banner — outside 800 m range */
            <View style={styles.navBanner}>
              <Text style={styles.navArrow}>
                {maneuverEmoji(stepToShow.maneuver.type, stepToShow.maneuver.modifier)}
              </Text>
              <View style={styles.navBannerBody}>
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

      {/* ── Truck lane guidance — shows from 500 m, neon strip with label ── */}
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


      {/* ── Route Timeline (parking + fuel pins along route) ── */}
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

      {/* ── Options Panel (Settings, Toggles, POIs) ── */}
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
        navigation={navigation}
        setBorderCrossings={setBorderCrossings}
        setShowBorderPanel={setShowBorderPanel}
        searchTop={searchTop}
        isSearchingAlongRoute={isSearchingAlongRoute}
        handleSearchAlongRoute={handleSearchAlongRoute}
        setMapIsLoaded={setMapIsLoaded}
        userCoords={userCoords}
        onReportCamera={handleReportCamera}
        onOpenPoiHistory={() => {/* POIHistoryModal not yet integrated */}}
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
          {/* SAR badge */}
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
      {!navigating && parkingResults.length > 0 && (
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

                {/* Amenity badges */}
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
                    <View style={styles.parkingBadge}><Text style={styles.parkingBadgeTxt}>🔦</Text></View>
                  )}
                  {p.capacity != null && (
                    <View style={styles.parkingBadge}><Text style={styles.parkingBadgeTxt}>🚛 {p.capacity}</Text></View>
                  )}
                </View>

                {p.opening_hours ? (
                  <Text style={styles.parkingHours} numberOfLines={1}>{p.opening_hours}</Text>
                ) : null}

                {/* Action row: Navigate + Web + TTS */}
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
                    style={styles.parkingWebBtn}
                    activeOpacity={0.8}
                    onPress={() => {
                      if (p.website) {
                        openInBrowser(p.website);
                      } else {
                        const cc = detectCountryCode(p.lat, p.lng);
                        const base = cc === 'eu'
                          ? 'https://truckerapps.eu/transparking/'
                          : `https://truckerapps.eu/transparking/${cc}/map/`;
                        openInBrowser(base);
                      }
                    }}
                  >
                    <Icon name="open-in-new" size={12} color={NEON} />
                    <Text style={styles.parkingWebBtnTxt}>Инфо</Text>
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
                    <Text style={styles.fuelBadgeTxt}>💶 {f.price}</Text>
                  </View>
                ) : null}
                {f.truck_lane ? (
                  <View style={styles.fuelBadgeTruck}>
                    <Text style={styles.fuelBadgeTxt}>🚚 Камионна лента</Text>
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
        <View style={[styles.tachPanel, { top: searchTop + 58 }]}>
          <View style={styles.parkingPanelHeader}>
            <Text style={styles.tachTitle}>⏱️ Тахограф</Text>
            <TouchableOpacity
              onPress={() => setTachographResult(null)}
              style={styles.parkingDismissBtn}
            >
              <Text style={styles.parkingDismissTxt}>✕</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.tachCard}>
            {/* Continuous session */}
            <Text style={styles.tachRow}>🚛 Непрекъснато: {tachographResult.drivenHours.toFixed(1)} ч</Text>
            <Text style={[styles.tachRow, tachographResult.breakNeeded && styles.tachWarn]}>
              {tachographResult.breakNeeded
                ? '🛑 СТОП — задължителна 45 мин почивка!'
                : tachographResult.remainingHours < 0.5
                ? `⚠️ Само ${Math.round(tachographResult.remainingHours * 60)} мин до почивка!`
                : `✅ Остават ${tachographResult.remainingHours.toFixed(1)} ч`}
            </Text>
            {/* Daily / Weekly from persistent DB */}
            {tachoSummary && (
              <>
                <View style={styles.tachDivider} />
                <Text style={styles.tachRow}>
                  📅 Днес: {tachoSummary.daily_driven_h.toFixed(1)} / {tachoSummary.daily_limit_h} ч
                  {'  '}
                  <Text style={tachoSummary.daily_remaining_h < 1 ? styles.tachWarn : styles.tachOk}>
                    (остават {tachoSummary.daily_remaining_h.toFixed(1)} ч)
                  </Text>
                </Text>
                <Text style={styles.tachRow}>
                  📆 Седмично: {tachoSummary.weekly_driven_h.toFixed(1)} / {tachoSummary.weekly_limit_h} ч
                  {'  '}
                  <Text style={tachoSummary.weekly_remaining_h < 4 ? styles.tachWarn : styles.tachOk}>
                    (остават {tachoSummary.weekly_remaining_h.toFixed(1)} ч)
                  </Text>
                </Text>
                {tachoSummary.biweekly_driven_h !== undefined && (
                  <Text style={styles.tachRow}>
                    📅📅 2 седм.: {tachoSummary.biweekly_driven_h.toFixed(1)} / {tachoSummary.biweekly_limit_h} ч
                    {'  '}
                    <Text style={tachoSummary.biweekly_remaining_h < 5 ? styles.tachWarn : styles.tachOk}>
                      (остават {tachoSummary.biweekly_remaining_h.toFixed(1)} ч)
                    </Text>
                  </Text>
                )}
                <View style={styles.tachDivider} />
                {/* Weekly daily-rest breakdown */}
                <Text style={styles.tachRow}>
                  🛏️ Почивки тази седмица:
                </Text>
                <Text style={styles.tachRow}>
                  {'  '}✅ 11ч (редовни): {tachoSummary.weekly_regular_rests}
                  {'   '}
                  <Text style={tachoSummary.weekly_reduced_rests > 0 ? styles.tachOk : undefined}>
                    🟡 9ч (намалени): {tachoSummary.weekly_reduced_rests}/3
                  </Text>
                </Text>
                {tachoSummary.reduced_rests_remaining === 0 ? (
                  <Text style={styles.tachWarn}>
                    ⚠️ Изчерпани намалени почивки — следващата трябва да е 11ч!
                  </Text>
                ) : (
                  <Text style={styles.tachOk}>
                    Можеш още {tachoSummary.reduced_rests_remaining}x 9ч почивка
                  </Text>
                )}
              </>
            )}
            {tachographResult.suggestedStop && (
              <TouchableOpacity
                style={styles.tachStopBtn}
                activeOpacity={0.8}
                onPress={() => {
                  const s = tachographResult.suggestedStop!;
                  setTachographResult(null);
                  navigateTo([s.lng, s.lat], s.name);
                }}
              >
                <Text style={styles.tachStopTxt}>🅿️ {tachographResult.suggestedStop.name} →</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
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

      {/* ── Route options panel — shown at ROUTE_PREVIEW ── */}
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


      {/* ── Wake word indicator: green mic dot when navigating (hands-free active) ── */}
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

      {/* ── Bottom-left: HOS badge + speed + limit — anchored just above elevationChip ── */}
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
      />


      {/* ── Speed Camera HUD — visible when < 600 m from a camera ── */}
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
          <Text style={styles.cameraHUDIcon}>📷</Text>
          <View>
            <Text style={styles.cameraHUDDist}>{cameraAlert.dist} м</Text>
            <Text style={styles.cameraHUDLabel}>КАМЕРА</Text>
          </View>
        </Animated.View>
      )}

      {/* ── Auto-parking toast — appears after 20 s stationary, shows closest spots ── */}
      {autoParking.length > 0 && (
        <View style={[styles.autoParkToast, { bottom: insets.bottom + 210 }]}>
          <View style={styles.autoParkHeader}>
            <Text style={styles.autoParkTitle}>🅿️ Паркинги наблизо</Text>
            <TouchableOpacity onPress={() => setAutoParking([])}>
              <Text style={styles.autoParkClose}>✕</Text>
            </TouchableOpacity>
          </View>
          {autoParking.slice(0, 3).map((p, i) => (
            <TouchableOpacity
              key={i}
              style={styles.autoParkItem}
              onPress={() => { setAutoParking([]); navigateTo([p.lng, p.lat], p.name); }}
            >
              <Text style={styles.autoParkName} numberOfLines={1}>{p.name}</Text>
              <Text style={styles.autoParkDist}>{fmtDistance(p.distance)} →</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ── Tilt controls (3D pitch) ── */}
      {!navigating && (
        <View style={[styles.tiltBtnCol, { bottom: insets.bottom + 100 }]}>
          <TouchableOpacity
            style={styles.tiltBtn}
            activeOpacity={0.8}
            onPress={() => {
              const next = Math.min(mapPitch + 15, 60);
              setMapPitch(next);
              cameraRef.current?.setCamera({ pitch: next, animationDuration: 400 });
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
              cameraRef.current?.setCamera({ pitch: next, animationDuration: 400 });
            }}
          >
            <Icon name="minus" size={20} color={NEON} />
          </TouchableOpacity>
        </View>
      )}



      {/* ── Visual Debug Overlay ── */}
      {debugMode && (
        <View style={[styles.debugOverlay, { top: insets.top + 120 }]}>
          <Text style={styles.debugTitle}>▌ DEBUG</Text>
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

      {/* ── Chat FABs — hidden when route active ── */}
      {!route && (
        <>
          {/* Gemini Chat FAB (bottom-left) */}
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

          {/* GPT-4o FAB (bottom-right) */}
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

      {/* ── Chat Panels (GPT + Gemini) ── */}
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
