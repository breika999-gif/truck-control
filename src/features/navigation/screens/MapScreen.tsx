import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  TouchableOpacity,
  Text,
  TextInput,
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  ScrollView,
  KeyboardAvoidingView,
} from 'react-native';
import Tts from 'react-native-tts';
import Geolocation from 'react-native-geolocation-service';
import Mapbox, { locationManager, LocationPuck, type CameraPadding } from '@rnmapbox/maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { colors, radius, spacing, typography } from '../../../shared/constants/theme';
import { MAPBOX_PUBLIC_TOKEN, MAP_CENTER } from '../../../shared/constants/config';
import { useVehicleStore } from '../../../store/vehicleStore';
import type { VehicleProfile } from '../../../shared/types/vehicle';
import type { RootStackParamList } from '../../../shared/types/navigation';
import SearchBar from '../components/SearchBar';
import type { GeoPlace } from '../api/geocoding';
import {
  fetchRoute,
  getSpeedLimitAtPosition,
  getCurrentStepIndex,
  maneuverEmoji,
  type RouteResult,
} from '../api/directions';
import {
  searchNearbyPOI,
  POI_META,
  type POICategory,
  type TruckPOI,
} from '../api/poi';
import {
  sendChatMessage,
  savePOI,
  fetchHealth,
  type ChatMessage,
  type ChatContext,
} from '../../../shared/services/backendApi';

type MapNavProp = NativeStackNavigationProp<RootStackParamList, 'Map'>;

Mapbox.setAccessToken(MAPBOX_PUBLIC_TOKEN);

// ── Neon Blue theme ──────────────────────────────────────────────────────────
const NEON       = '#00bfff';          // neon blue
const NEON_DIM   = 'rgba(0,191,255,0.10)'; // very light tinted bg

// Navigation arrow PNG — middle rotating layer for LocationPuck bearingImage.
// Must be registered inside <Mapbox.Images> so the map atlas gets the asset.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const NAV_ARROW = require('../../../shared/assets/nav_arrow.png') as number;

// Typed padding constants — avoids "partial CameraPadding" TypeScript error.
// Always pass all four fields; some native builds crash on partial/undefined.
const NAV_PADDING: CameraPadding  = { paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 280 };
const ZERO_PADDING: CameraPadding = { paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0 };

const HOS_LIMIT_S = 16200; // EU 4.5 h = 16 200 s
const POI_CATEGORIES: POICategory[] = [
  'gas_station',
  'parking',
  'rest_area',
  'ev_charging_station',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDistance(meters: number): string {
  return meters < 1000
    ? `${Math.round(meters)} м`
    : `${(meters / 1000).toFixed(1)} км`;
}

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h === 0 ? `${m} мин` : `${h} ч ${m} мин`;
}

/** ISO 8601 timestamp N minutes from now. */
function addMinutes(m: number): string {
  return new Date(Date.now() + m * 60_000).toISOString();
}
/** ISO 8601 timestamp for tomorrow at 08:00 local time. */
function tomorrowAt8(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return d.toISOString();
}
/** Emoji arrow for a lane direction string from Mapbox banner_instructions. */
function laneDirectionEmoji(dir?: string): string {
  if (!dir) return '⬆️';
  if (dir === 'left' || dir === 'sharp left') return '⬅️';
  if (dir === 'right' || dir === 'sharp right') return '➡️';
  if (dir === 'slight left') return '↖️';
  if (dir === 'slight right') return '↗️';
  if (dir === 'uturn') return '🔄';
  return '⬆️';
}

const DEPART_LABELS = ['СЕГА', '+1 ч', '+2 ч', 'Утре 08:00'] as const;
type DepartLabel = (typeof DEPART_LABELS)[number];
function departIso(label: DepartLabel): string | null {
  if (label === '+1 ч')         return addMinutes(60);
  if (label === '+2 ч')         return addMinutes(120);
  if (label === 'Утре 08:00')   return tomorrowAt8();
  return null; // 'СЕГА'
}

/** Safe TTS speak — swallows errors when TTS engine is not ready. */
function ttsSpeak(text: string): void {
  try { Tts.speak(text); } catch { /* TTS engine not initialised */ }
}

/** Remaining HOS time formatted as H:MM */
function fmtHOS(drivenSeconds: number): string {
  const rem = Math.max(0, HOS_LIMIT_S - drivenSeconds);
  const h = Math.floor(rem / 3600);
  const m = Math.floor((rem % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** Straight-line distance between two [lng, lat] points in metres (Haversine). */
function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const x =
    sinLat * sinLat +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * sinLon * sinLon;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// ── StableCamera — re-renders ONLY when navigating OR mapLoaded changes ──────
// AnimatedNode.js guard: Mapbox creates Animated nodes for followUserLocation,
// followUserMode, followZoomLevel on first render. If followUserLocation flips
// true before the style is fully loaded (mapLoaded=false), Mapbox tries to
// start animation on an uninitialised Animated.Value → crash in AnimatedNode.js.
// Fix: gate followUserLocation on BOTH navigating AND mapLoaded.

interface StableCameraProps {
  cameraRef: React.RefObject<Mapbox.Camera>;
  navigating: boolean;
  mapLoaded: boolean;
}

const StableCamera = React.memo(
  ({ cameraRef, navigating, mapLoaded }: StableCameraProps) => (
    <Mapbox.Camera
      ref={cameraRef}
      defaultSettings={{
        centerCoordinate: [MAP_CENTER.longitude, MAP_CENTER.latitude],
        zoomLevel: MAP_CENTER.zoomLevel,
      }}
      // Guard: only activate follow animation after style is fully loaded.
      // Prevents "startAnimation called on uninitialised Animated.Value" crash.
      followUserLocation={navigating && mapLoaded}
      followUserMode={Mapbox.UserTrackingMode.FollowWithCourse}
      // Zoom 17 during navigation; no opinion when browsing (followUserLocation=false)
      followZoomLevel={17}
      // 60° pitch during navigation = 3D "driver's seat" perspective.
      // 0° when browsing = flat overhead view.
      followPitch={navigating ? 60 : 0}
      // Push the location puck toward the bottom third of the screen so
      // ~70% of the visible road is ahead of the truck — more look-ahead.
      // NAV_PADDING / ZERO_PADDING are fully-typed CameraPadding constants —
      // avoids "partial CameraPadding" TS error and native crash on undefined.
      followPadding={navigating ? NAV_PADDING : ZERO_PADDING}
    />
  ),
  (prev, next) =>
    prev.navigating === next.navigating && prev.mapLoaded === next.mapLoaded,
);

// ── Component ────────────────────────────────────────────────────────────────

export default function MapScreen() {
  const navigation = useNavigation<MapNavProp>();
  const profile = useVehicleStore((s) => s.profile);
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<Mapbox.Camera>(null);

  // GPS
  const [userCoords, setUserCoords] = useState<[number, number] | null>(null);
  const [gpsReady, setGpsReady] = useState(false);
  const [speed, setSpeed] = useState(0);

  // Route
  const [destination, setDestination] = useState<[number, number] | null>(null);
  const [destinationName, setDestinationName] = useState('');
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [loadingRoute, setLoadingRoute] = useState(false);

  // Navigation mode
  const [navigating, setNavigating] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [speedLimit, setSpeedLimit] = useState<number | null>(null);
  const [distToTurn, setDistToTurn] = useState<number | null>(null);
  const [rerouting, setRerouting] = useState(false);

  // Departure time planning
  const [departLabel, setDepartLabel] = useState<DepartLabel>('СЕГА');
  const [departAt, setDepartAt]       = useState<string | null>(null);

  // Map style — satellite-streets by default (fixes VectorSource SoftException
  // by embedding traffic via style URL instead of a separate VectorSource layer)
  const [satellite, setSatellite] = useState(true);
  const [mapIsLoaded, setMapIsLoaded] = useState(false);
  const [showTraffic, setShowTraffic] = useState(true);

  // Voice
  const [voiceMuted, setVoiceMuted] = useState(false);
  const voiceMutedRef     = useRef(false);
  const lastSpokenStepRef = useRef(-1);

  // Options pocket menu
  const [optionsOpen, setOptionsOpen] = useState(false);

  // Backend / Gemini chat
  const [backendOnline, setBackendOnline] = useState(false);
  const [chatOpen, setChatOpen]           = useState(false);
  const [chatInput, setChatInput]         = useState('');
  const [chatHistory, setChatHistory]     = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading]     = useState(false);

  // POI
  const [poiCategory, setPoiCategory] = useState<POICategory | null>(null);
  const [poiResults, setPoiResults]   = useState<TruckPOI[]>([]);
  const [loadingPOI, setLoadingPOI]   = useState(false);
  // Ref mirror — lets handlePOISearch read the current category without closing
  // over state (stale closure on rapid double-tap).
  const poiCategoryRef = useRef<POICategory | null>(null);
  useEffect(() => { poiCategoryRef.current = poiCategory; }, [poiCategory]);

  // HOS (EU 4.5 h driving limit — Regulation 561/2006)
  const [drivingSeconds, setDrivingSeconds] = useState(0);
  const isDrivingRef   = useRef(false);
  const hosIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hosWarningRef  = useRef({ w30: false, w10: false, limit: false });
  // Guard: prevent setState after unmount (avoids "Can't perform a React state
  // update on an unmounted component" from the HOS setInterval tick).
  const isMountedRef   = useRef(true);
  useEffect(() => () => { isMountedRef.current = false; }, []);

  useEffect(() => { voiceMutedRef.current = voiceMuted; }, [voiceMuted]);

  // ── Runtime location permission + GPS (react-native-geolocation-service) ──
  // Uses Google Fused Location Provider on Android for faster first fix and
  // better accuracy than the default RN location. locationManager.start()
  // keeps the Mapbox LocationPuck updated via the native SDK.
  useEffect(() => {
    let watchId: number | null = null;

    const startWatch = () => {
      locationManager.start(); // warm Mapbox location engine for LocationPuck

      watchId = Geolocation.watchPosition(
        (pos) => {
          if (!isMountedRef.current) return;
          const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude];
          userCoordsRef.current = coords;
          setUserCoords(coords);
          setGpsReady(true);

          const spd = pos.coords.speed ?? -1;
          const kmh = spd > 0 ? spd * 3.6 : 0;
          setSpeed(Math.round(kmh));
          isDrivingRef.current = kmh > 3;

          const isNav = navigatingRef.current;
          const cur   = routeRef.current;
          if (!isNav || !cur) return;

          setSpeedLimit(
            getSpeedLimitAtPosition(cur.geometry.coordinates, cur.maxspeeds, coords),
          );

          const stepIdx = getCurrentStepIndex(cur.steps, coords);
          setCurrentStep(stepIdx);

          const nextLoc = cur.steps[stepIdx + 1]?.intersections?.[0]?.location;
          setDistToTurn(nextLoc ? haversineMeters(coords, nextLoc) : null);

          // ── Auto re-route when > 50 m off route (30-second cooldown) ──────
          const now = Date.now();
          if (now - lastRerouteRef.current < 30_000) return;

          let minDist = Infinity;
          const routeCoords = cur.geometry.coordinates;
          for (let i = 0; i < routeCoords.length; i++) {
            const d = haversineMeters(coords, routeCoords[i] as [number, number]);
            if (d < minDist) minDist = d;
            if (minDist < 50) return;
          }

          const dest = destinationRef.current;
          if (!dest) return;

          lastRerouteRef.current = now;
          setRerouting(true);
          const prof = profileRef.current;
          const truck = prof
            ? { max_height: prof.height_m, max_width: prof.width_m,
                max_weight: prof.weight_t, max_length: prof.length_m }
            : undefined;

          fetchRoute(coords, dest, truck)
            .then(result => {
              if (result) { routeRef.current = result; setRoute(result); }
            })
            .catch(() => {})
            .finally(() => { if (isMountedRef.current) setRerouting(false); });
        },
        () => { /* silently ignore errors — GPS may be unavailable indoors */ },
        {
          enableHighAccuracy: true,
          distanceFilter: 2,        // update every 2 m of movement
          interval: 1000,           // Android: check every 1 s
          fastestInterval: 500,     // Android: max rate
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
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // stable — all logic reads via refs

  // ── Flask backend health check — poll every 30 s ────────────────────────
  useEffect(() => {
    const check = () =>
      fetchHealth().then(h => {
        if (isMountedRef.current) setBackendOnline(h?.status === 'ok');
      });
    check();
    const interval = setInterval(check, 30_000);
    return () => clearInterval(interval);
  }, []);

  // ── TTS initialisation ───────────────────────────────────────────────────
  useEffect(() => {
    Tts.setDefaultLanguage('bg-BG').catch(() =>
      Tts.setDefaultLanguage('en-US').catch(() => {}),
    );
    Tts.setDefaultRate(0.45);
    Tts.setDefaultPitch(1.0);
  }, []);

  // ── Speak turn instruction when step advances ─────────────────────────────
  useEffect(() => {
    if (!navigating || voiceMuted) return;
    if (currentStep === lastSpokenStepRef.current) return;
    lastSpokenStepRef.current = currentStep;
    const step = route?.steps?.[currentStep];
    // Prefer Mapbox voice_instructions for natural phrasing
    const text =
      step?.voiceInstructions?.[0]?.announcement ||
      step?.maneuver?.instruction ||
      step?.name;
    if (text) {
      Tts.stop();
      ttsSpeak(text);
    }
  }, [currentStep, navigating, voiceMuted, route]);

  // ── HOS timer: count driving seconds while navigating ────────────────────
  useEffect(() => {
    if (!navigating) {
      if (hosIntervalRef.current) clearInterval(hosIntervalRef.current);
      return;
    }
    // Clear before assigning — prevents interval leak when navigating toggles
    // true → false → true rapidly (e.g. double-tap on Start button).
    if (hosIntervalRef.current) clearInterval(hosIntervalRef.current);
    hosIntervalRef.current = setInterval(() => {
      if (isDrivingRef.current && isMountedRef.current) setDrivingSeconds(s => s + 1);
    }, 1000);
    return () => {
      if (hosIntervalRef.current) clearInterval(hosIntervalRef.current);
    };
  }, [navigating]);

  // ── HOS voice warnings ────────────────────────────────────────────────────
  useEffect(() => {
    if (!navigating || voiceMuted) return;
    if (drivingSeconds >= 14400 && !hosWarningRef.current.w30) {
      hosWarningRef.current.w30 = true;
      ttsSpeak('Внимание! 30 минути до задължителна почивка.');
    }
    if (drivingSeconds >= 15600 && !hosWarningRef.current.w10) {
      hosWarningRef.current.w10 = true;
      ttsSpeak('Намерете място за почивка. 10 минути оставащи.');
    }
    if (drivingSeconds >= HOS_LIMIT_S && !hosWarningRef.current.limit) {
      hosWarningRef.current.limit = true;
      ttsSpeak('Достигнат лимит за шофиране. Спрете за 45-минутна почивка.');
    }
  }, [drivingSeconds, navigating, voiceMuted]);

  // ── Refs — stable values readable inside the GPS callback ────────────────
  // Pattern: state drives render; refs let the stable callback read latest values
  // without re-creating it (re-creation mid-forEach crashes AnimatedNode).

  const navigatingRef      = useRef(false);
  const routeRef           = useRef<RouteResult | null>(null);
  const userCoordsRef      = useRef<[number, number] | null>(null);
  const destinationRef     = useRef<[number, number] | null>(null);
  const destinationNameRef = useRef('');
  const profileRef         = useRef<VehicleProfile | null>(null);
  const departAtRef        = useRef<string | null>(null);
  const lastRerouteRef     = useRef<number>(0);

  useEffect(() => { navigatingRef.current      = navigating;       }, [navigating]);
  useEffect(() => { routeRef.current           = route;            }, [route]);
  useEffect(() => { userCoordsRef.current      = userCoords;       }, [userCoords]);
  useEffect(() => { destinationRef.current     = destination;      }, [destination]);
  useEffect(() => { destinationNameRef.current = destinationName;  }, [destinationName]);
  useEffect(() => { profileRef.current         = profile;          }, [profile]);
  useEffect(() => { departAtRef.current        = departAt;         }, [departAt]);

  // ── Shared route-to helper ────────────────────────────────────────────────
  // Single source of truth for fetching a route and fitting the camera.
  // All data read via refs → deps:[] → stable identity across renders.
  // isMountedRef guard prevents setState after component unmounts.

  const navigateTo = useCallback(async (dest: [number, number], name: string) => {
    setDestination(dest);
    setDestinationName(name);
    setNavigating(false);
    setRoute(null);
    setCurrentStep(0);
    setSpeedLimit(null);
    setDistToTurn(null);

    // Unified GPS origin: always read from ref (never stale, never re-creates callback)
    const origin: [number, number] = userCoordsRef.current ?? [
      MAP_CENTER.longitude,
      MAP_CENTER.latitude,
    ];

    setLoadingRoute(true);
    try {
      const prof = profileRef.current;
      const truck = prof
        ? {
            max_height: prof.height_m,
            max_width: prof.width_m,
            max_weight: prof.weight_t,
            max_length: prof.length_m,
          }
        : undefined;

      const result = await fetchRoute(origin, dest, truck, departAtRef.current ?? undefined);
      if (!isMountedRef.current) return; // unmount guard

      setRoute(result);

      if (result) {
        const coords = result.geometry.coordinates;
        let minLng = coords[0][0], maxLng = coords[0][0];
        let minLat = coords[0][1], maxLat = coords[0][1];
        for (let i = 1; i < coords.length; i++) {
          if (coords[i][0] < minLng) minLng = coords[i][0];
          if (coords[i][0] > maxLng) maxLng = coords[i][0];
          if (coords[i][1] < minLat) minLat = coords[i][1];
          if (coords[i][1] > maxLat) maxLat = coords[i][1];
        }
        cameraRef.current?.fitBounds(
          [maxLng, maxLat],
          [minLng, minLat],
          [120, 40, 220, 40],
          1000,
        );
      } else {
        cameraRef.current?.flyTo(dest, 800);
      }
    } catch {
      cameraRef.current?.flyTo(dest, 800);
    } finally {
      if (isMountedRef.current) setLoadingRoute(false);
    }
  }, []); // stable — reads everything via refs

  // ── Destination selection (from SearchBar) ────────────────────────────────

  const handleDestinationSelect = useCallback(
    (place: GeoPlace) => navigateTo(place.center, place.text),
    [navigateTo],
  );

  // ── Start navigation ──────────────────────────────────────────────────────

  const handleStart = useCallback(() => {
    lastSpokenStepRef.current = -1; // allow first step to be spoken
    setNavigating(true);
    setCurrentStep(0);
    setDistToTurn(null);
    // Reset HOS for this trip
    setDrivingSeconds(0);
    hosWarningRef.current = { w30: false, w10: false, limit: false };
    // Fly to user position immediately for close-up view
    const uc = userCoordsRef.current;
    if (uc) cameraRef.current?.flyTo(uc, 600);
    if (!voiceMutedRef.current) {
      Tts.stop();
      ttsSpeak('Навигацията е стартирана');
    }
  }, []);

  // ── Clear route & stop navigation ─────────────────────────────────────────

  const handleClear = useCallback(() => {
    Tts.stop();
    lastSpokenStepRef.current = -1;
    setDestination(null);
    setDestinationName('');
    setRoute(null);
    setNavigating(false);
    setCurrentStep(0);
    setSpeedLimit(null);
    setDistToTurn(null);
    setRerouting(false);
    setPoiCategory(null);
    setPoiResults([]);
    setDrivingSeconds(0);
    hosWarningRef.current = { w30: false, w10: false, limit: false };
    lastRerouteRef.current = 0;
    cameraRef.current?.flyTo([MAP_CENTER.longitude, MAP_CENTER.latitude], 800);
  }, []);

  // ── AI chat (GPT-4o) ──────────────────────────────────────────────────────
  // Sends the user message to Flask → GPT-4o and appends the reply.
  // chatHistory + driver context are passed so the model has full context.

  const handleChat = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || chatLoading) return;

    const userMsg: ChatMessage = { role: 'user', text };
    const newHistory = [...chatHistory, userMsg];
    setChatHistory(newHistory);
    setChatInput('');
    setChatLoading(true);

    const context: ChatContext = {
      lat:            userCoords?.[1],
      lng:            userCoords?.[0],
      driven_seconds: drivingSeconds,
      speed_kmh:      speed,
    };

    const response = await sendChatMessage(text, chatHistory, context);
    if (!isMountedRef.current) return;

    if (response.ok && response.reply) {
      setChatHistory([...newHistory, { role: 'model', text: response.reply }]);
      if (!voiceMutedRef.current) {
        Tts.stop();
        ttsSpeak(response.reply);
      }
      // Auto-navigate when GPT-4o returns a navigate action
      if (response.action?.type === 'navigate') {
        navigateTo(response.action.coords, response.action.destination);
      }
    } else {
      setChatHistory([
        ...newHistory,
        { role: 'model', text: 'Грешка: GPT-4o не отговаря.' },
      ]);
    }
    setChatLoading(false);
  }, [chatInput, chatHistory, chatLoading, userCoords, drivingSeconds, speed, navigateTo]);

  // ── POI search ────────────────────────────────────────────────────────────

  const handlePOISearch = useCallback(async (cat: POICategory) => {
    // Read via ref — avoids stale closure on rapid double-tap
    if (poiCategoryRef.current === cat) {
      setPoiCategory(null);
      setPoiResults([]);
      return;
    }
    setPoiCategory(cat);
    setPoiResults([]);
    const center = userCoordsRef.current ??
      ([MAP_CENTER.longitude, MAP_CENTER.latitude] as [number, number]);
    setLoadingPOI(true);
    try {
      const results = await searchNearbyPOI(center, cat);
      if (!isMountedRef.current) return;
      setPoiResults(results);
    } catch {
      if (isMountedRef.current) setPoiResults([]);
    } finally {
      if (isMountedRef.current) setLoadingPOI(false);
    }
  }, []); // stable — reads category via poiCategoryRef

  // ── Navigate to POI ───────────────────────────────────────────────────────

  const handlePOINavigate = useCallback((poi: TruckPOI) => {
    setPoiCategory(null);
    setPoiResults([]);
    navigateTo(poi.coordinates, poi.name);
  }, [navigateTo]);

  // ── Departure time picker ─────────────────────────────────────────────────
  // Updates departAt + re-fetches route (if destination is already set).
  // departAtRef is updated synchronously BEFORE navigateTo so the callback
  // reads the fresh value without stale-closure issues.

  const pickDeparture = useCallback((label: DepartLabel) => {
    const iso = departIso(label);
    setDepartLabel(label);
    setDepartAt(iso);
    departAtRef.current = iso; // sync update — navigateTo reads via ref
    const dest = destinationRef.current;
    if (dest) navigateTo(dest, destinationNameRef.current);
  }, [navigateTo]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const routeShape = route
    ? ({ type: 'Feature', properties: {}, geometry: route.geometry } as const)
    : null;

  const activeStep = route?.steps?.[currentStep];
  const nextStep   = route?.steps?.[currentStep + 1];
  const stepToShow = navigating ? activeStep : null;

  // Style URL strategy:
  //   satellite=true  → satellite-streets (traffic embedded, no SoftException)
  //   satellite=false + traffic=true  → traffic-night (dedicated traffic style)
  //   satellite=false + traffic=false → Dark
  const mapStyleURL = satellite
    ? 'mapbox://styles/mapbox/satellite-streets-v12'
    : showTraffic
      ? 'mapbox://styles/mapbox/traffic-night-v2'
      : Mapbox.StyleURL.Dark;

  const searchTop = insets.top + spacing.sm;

  // Dominant congestion across the route ('low' | 'moderate' | 'heavy' | null)
  const dominantCongestion = useMemo(() => {
    const c = route?.congestion;
    if (!c?.length) return null;
    if (c.some(v => v === 'severe' || v === 'heavy')) return 'heavy';
    if (c.some(v => v === 'moderate')) return 'moderate';
    return 'low';
  }, [route]);

  // Lane guidance from banner_instructions of the current step
  const currentLanes = useMemo(() => {
    return stepToShow?.bannerInstructions?.[0]?.sub?.components.filter(
      c => c.type === 'lane',
    ) ?? [];
  }, [stepToShow]);

  // ETA — clock time of arrival (current time + route duration)
  const eta = useMemo(() => {
    if (!route) return null;
    const arrival = new Date(Date.now() + route.duration * 1000);
    return arrival.toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' });
  }, [route]);

  // Puck scale: arrow grows when approaching a turn (≤300 m) so the driver
  // can clearly see the heading. Uses a plain number — Value<number> accepts
  // both static numbers and Mapbox expressions.
  const puckScale = useMemo(() => {
    if (!navigating || distToTurn == null || distToTurn > 300) return 1.0;
    if (distToTurn < 50)  return 2.0;
    if (distToTurn < 150) return 1.5;
    return 1.2;
  }, [navigating, distToTurn]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>

      {/* ── Map ── */}
      <Mapbox.MapView
        style={styles.map}
        styleURL={mapStyleURL}
        onDidFinishLoadingStyle={() => setMapIsLoaded(true)}
      >
        {/* Register nav-arrow PNG for LocationPuck bearingImage (middle rotating layer).
            Must be inside MapView so the image is added to the native map atlas. */}
        <Mapbox.Images images={{ 'nav-arrow': NAV_ARROW }} />

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
          bearingImage="nav-arrow"
          scale={puckScale}
          pulsing={{ isEnabled: true, color: NEON, radius: 30 }}
          visible
        />

        {/* Route polyline — only after style loaded */}
        {mapIsLoaded && routeShape && (
          <Mapbox.ShapeSource id="route-source" shape={routeShape}>
            <Mapbox.LineLayer
              id="route-casing"
              style={{ lineColor: '#0a0a1a', lineWidth: 9, lineCap: 'round', lineJoin: 'round' }}
            />
            <Mapbox.LineLayer
              id="route-line"
              style={{ lineColor: NEON, lineWidth: 5, lineCap: 'round', lineJoin: 'round' }}
            />
          </Mapbox.ShapeSource>
        )}

        {/* Destination pin */}
        {destination && (
          <Mapbox.PointAnnotation id="dest-pin" coordinate={destination}>
            <View style={styles.pin}>
              <Text style={styles.pinEmoji}>📍</Text>
            </View>
          </Mapbox.PointAnnotation>
        )}

        {/* POI markers */}
        {mapIsLoaded && poiResults.map((poi) => (
          <Mapbox.PointAnnotation
            key={poi.id}
            id={`poi-${poi.id}`}
            coordinate={poi.coordinates}
            onSelected={() => handlePOINavigate(poi)}
          >
            <View style={styles.poiMarker}>
              <Text style={styles.poiMarkerEmoji}>
                {POI_META[poi.category].emoji}
              </Text>
            </View>
          </Mapbox.PointAnnotation>
        ))}
      </Mapbox.MapView>

      {/* ── Search bar (hidden during navigation) ── */}
      {!navigating && (
        <View style={[styles.searchContainer, { top: searchTop }]}>
          <SearchBar onSelect={handleDestinationSelect} onClear={handleClear} />
        </View>
      )}

      {/* ── Navigation top panel: arrow + street name ── */}
      {navigating && stepToShow && (
        <View style={[styles.navBanner, { top: insets.top + spacing.xs }]}>
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
            {/* Lane guidance — show active/inactive lane arrows from banner_instructions */}
            {currentLanes.length > 0 && (
              <View style={styles.laneRow}>
                {currentLanes.map((lane, i) => (
                  <Text
                    key={i}
                    style={[styles.laneArrow, lane.active && styles.laneArrowActive]}
                  >
                    {laneDirectionEmoji(lane.directions?.[0])}
                  </Text>
                ))}
              </View>
            )}
          </View>
        </View>
      )}

      {/* ── Options pocket menu — single ⚙️ button; expands to controls panel ── */}
      <View style={[styles.optionsContainer, { top: searchTop }]}>
        <TouchableOpacity
          style={styles.mapBtn}
          onPress={() => setOptionsOpen(v => !v)}
        >
          <Text style={styles.mapBtnText}>{optionsOpen ? '✕' : '⚙️'}</Text>
        </TouchableOpacity>

        {optionsOpen && (
          <View style={styles.optionsPanel}>
            {/* ── Map toggles row ── */}
            <View style={styles.optionsRow}>
              <TouchableOpacity
                style={styles.optionBtn}
                onPress={() => { setSatellite(v => !v); if (!navigating) setMapIsLoaded(false); }}
              >
                <Text style={styles.mapBtnText}>{satellite ? '🌑' : '🛰️'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.optionBtn, !showTraffic && styles.optionBtnOff]}
                onPress={() => { setShowTraffic(v => !v); if (!navigating) setMapIsLoaded(false); }}
              >
                <Text style={styles.mapBtnText}>🚦</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.optionBtn, voiceMuted && styles.optionBtnOff]}
                onPress={() => { setVoiceMuted(v => !v); if (!voiceMuted) Tts.stop(); }}
              >
                <Text style={styles.mapBtnText}>{voiceMuted ? '🔇' : '🔊'}</Text>
              </TouchableOpacity>
            </View>

            {/* ── POI category row ── */}
            {!navigating && !route && (
              <View style={styles.optionsRow}>
                {POI_CATEGORIES.map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.optionBtn, poiCategory === cat && styles.optionBtnActive]}
                    onPress={() => { handlePOISearch(cat); setOptionsOpen(false); }}
                  >
                    <Text style={styles.mapBtnText}>{POI_META[cat].emoji}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}
      </View>

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

      {/* ── POI results horizontal scroll ── */}
      {!navigating && !route && (poiResults.length > 0 || loadingPOI) && (
        <View style={[styles.poiListContainer, { top: searchTop + 110 }]}>
          {loadingPOI && (
            <ActivityIndicator size="small" color={colors.accent} style={styles.poiLoading} />
          )}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.poiListContent}>
            {poiResults.map((poi) => (
              <TouchableOpacity
                key={poi.id}
                style={styles.poiCard}
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

      {/* ── Bottom-left: HOS badge + speed + limit ── */}
      {navigating && (
        <View style={[styles.speedRow, { bottom: 240 + insets.bottom }]}>
          <View>
            {/* HOS countdown badge */}
            <View style={[
              styles.hosBadge,
              drivingSeconds >= 15600 && styles.hosBadgeWarn,
              drivingSeconds >= HOS_LIMIT_S && styles.hosBadgeLimit,
            ]}>
              <Text style={styles.hosBadgeLabel}>HOS</Text>
              <Text style={styles.hosBadgeValue}>{fmtHOS(drivingSeconds)}</Text>
            </View>
            <View style={styles.speedBox}>
              <Text style={styles.speedValue}>{speed}</Text>
              <Text style={styles.speedUnit}>км/ч</Text>
            </View>
          </View>
          {speedLimit != null && (
            <View style={[styles.speedLimitBox, speed > speedLimit && styles.speedLimitExceeded]}>
              <Text style={styles.speedLimitLabel}>LIMIT</Text>
              <Text style={styles.speedLimitValue}>{speedLimit}</Text>
            </View>
          )}
        </View>
      )}

      {/* ── Bottom-right: distance to next turn ── */}
      {navigating && distToTurn != null && (
        <View style={[styles.distBox, { bottom: 240 + insets.bottom }]}>
          <Text style={styles.distValue}>{fmtDistance(distToTurn)}</Text>
          <Text style={styles.distLabel}>ДО ЗАВОЙ</Text>
        </View>
      )}

      {/* ── Bottom panel ── */}
      {route && !loadingRoute && (
        <View style={[styles.bottomPanel, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.infoRow}>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>РАЗСТОЯНИЕ</Text>
              <Text style={styles.infoValue}>{fmtDistance(route.distance)}</Text>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>ПРИСТИГАНЕ</Text>
              <Text style={styles.infoValue}>{fmtDuration(route.duration)}</Text>
            </View>
            {eta ? (
              <>
                <View style={styles.infoDivider} />
                <View style={styles.infoCell}>
                  <Text style={styles.infoLabel}>⏰ ПРИСТИГАНЕ</Text>
                  <Text style={styles.infoValue}>{eta}</Text>
                </View>
              </>
            ) : null}
            <TouchableOpacity style={styles.closeBtn} onPress={handleClear}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          {destinationName ? (
            <Text style={styles.destName} numberOfLines={1}>→ {destinationName}</Text>
          ) : null}

          {/* Congestion indicator */}
          {dominantCongestion && (
            <View style={styles.congestionRow}>
              <View style={[
                styles.congestionChip,
                dominantCongestion === 'heavy'    && styles.congestionHeavy,
                dominantCongestion === 'moderate' && styles.congestionModerate,
              ]}>
                <Text style={styles.congestionText}>
                  {dominantCongestion === 'heavy'
                    ? '🔴 Задръствания'
                    : dominantCongestion === 'moderate'
                    ? '🟡 Умерен трафик'
                    : '🟢 Свободно'}
                </Text>
              </View>
            </View>
          )}

          {/* Departure time chips — re-fetches route with depart_at for traffic prediction */}
          {!navigating && (
            <View style={styles.departRow}>
              {DEPART_LABELS.map(label => (
                <TouchableOpacity
                  key={label}
                  style={[styles.departChip, departLabel === label && styles.departChipActive]}
                  onPress={() => pickDeparture(label)}
                >
                  <Text style={[
                    styles.departChipText,
                    departLabel === label && styles.departChipTextActive,
                  ]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <TouchableOpacity
            style={[
              styles.startBtn,
              navigating && styles.startBtnActive,
              !navigating && !gpsReady && styles.startBtnDisabled,
            ]}
            onPress={navigating ? handleClear : (gpsReady ? handleStart : undefined)}
            activeOpacity={0.85}
          >
            <Text style={styles.startBtnText}>
              {navigating
                ? '🛑 Спри навигацията'
                : gpsReady
                ? '🚀 Тръгваме!'
                : '📡 Изчакване на GPS...'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── FAB: vehicle profile ── */}
      {!route && !loadingRoute && (
        <TouchableOpacity
          style={[styles.fab, { bottom: insets.bottom + spacing.xl }]}
          onPress={() => navigation.navigate('VehicleProfile')}
          activeOpacity={0.85}
        >
          <Text style={styles.fabEmoji}>🚚</Text>
        </TouchableOpacity>
      )}

      {/* ── Gemini FAB (bottom-left) ── */}
      <TouchableOpacity
        style={[
          styles.geminiFab,
          { bottom: insets.bottom + spacing.xl },
          backendOnline ? styles.geminiFabOnline : styles.geminiFabOffline,
        ]}
        onPress={() => setChatOpen(v => !v)}
        activeOpacity={0.85}
      >
        <Text style={styles.geminiFabEmoji}>{chatOpen ? '✕' : '🤖'}</Text>
        {/* Online dot */}
        <View style={[styles.onlineDot, backendOnline ? styles.onlineDotGreen : styles.onlineDotGrey]} />
      </TouchableOpacity>

      {/* ── Gemini chat panel ── */}
      {chatOpen && (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={[styles.chatPanel, { bottom: insets.bottom + 80 }]}
        >
          {/* Messages */}
          <ScrollView
            style={styles.chatMessages}
            contentContainerStyle={styles.chatMessagesContent}
            keyboardShouldPersistTaps="handled"
          >
            {chatHistory.length === 0 && (
              <Text style={styles.chatPlaceholder}>
                Питай TruckAI за маршрути, паркинг, камери...
              </Text>
            )}
            {chatHistory.map((msg, i) => (
              <View
                key={i}
                style={[
                  styles.chatBubble,
                  msg.role === 'user' ? styles.chatBubbleUser : styles.chatBubbleModel,
                ]}
              >
                <Text style={styles.chatBubbleText}>{msg.text}</Text>
              </View>
            ))}
            {chatLoading && (
              <ActivityIndicator size="small" color={colors.accent} style={{ marginTop: 8 }} />
            )}
          </ScrollView>

          {/* Input row */}
          <View style={styles.chatInputRow}>
            <TextInput
              style={styles.chatInput}
              value={chatInput}
              onChangeText={setChatInput}
              placeholder="Съобщение..."
              placeholderTextColor={colors.textMuted}
              onSubmitEditing={handleChat}
              returnKeyType="send"
              editable={!chatLoading}
            />
            <TouchableOpacity
              style={[styles.chatSendBtn, chatLoading && { opacity: 0.4 }]}
              onPress={handleChat}
              disabled={chatLoading}
            >
              <Text style={styles.chatSendText}>➤</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  map: { flex: 1 },

  searchContainer: {
    position: 'absolute',
    left: spacing.md,
    right: 68, // keep clear of 44px Options btn + spacing.md
    zIndex: 20,
  },

  // Right button column (satellite / traffic / voice)
  rightBtnCol: {
    position: 'absolute',
    right: spacing.md,
    gap: spacing.xs,
    zIndex: 20,
  },
  mapBtn: {
    width: 44,
    height: 44,
    borderRadius: 50,
    backgroundColor: NEON_DIM,
    borderWidth: 1.5,
    borderColor: NEON,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 12,
    shadowColor: NEON,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },
  mapBtnOff: { opacity: 0.4 },
  mapBtnText: { fontSize: 20 },

  // Navigation top panel
  navBanner: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    backgroundColor: 'rgba(0,10,30,0.88)',
    borderRadius: 50,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    elevation: 14,
    borderWidth: 1.5,
    borderColor: NEON,
    zIndex: 20,
    shadowColor: NEON,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 10,
  },
  navArrow: { fontSize: 36, marginRight: spacing.md },
  navBannerBody: { flex: 1 },
  navStreet: { fontSize: 18, fontWeight: '700', color: colors.text },
  navNext: { ...typography.caption, color: colors.textSecondary, marginTop: 3 },

  // Lane guidance arrows
  laneRow: { flexDirection: 'row', marginTop: 5, gap: 4 },
  laneArrow: { fontSize: 18, opacity: 0.3 },
  laneArrowActive: { opacity: 1 },

  // GPS chip
  gpsChip: {
    position: 'absolute',
    top: 100,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(22,33,62,0.9)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    zIndex: 15,
  },
  gpsText: { ...typography.label, color: colors.textSecondary },

  // Re-routing chip
  reroutingChip: {
    position: 'absolute',
    top: 100,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(40,30,10,0.95)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.warning,
    zIndex: 25,
    elevation: 10,
  },
  reroutingText: { ...typography.label, color: colors.warning },

  // Vehicle badge
  badge: {
    position: 'absolute',
    left: spacing.md,
    backgroundColor: 'rgba(26,26,46,0.88)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.accent,
    zIndex: 15,
  },
  badgeText: { ...typography.label, color: colors.text, fontWeight: '700' },

  pin: { alignItems: 'center' },
  pinEmoji: { fontSize: 30 },

  loadingChip: {
    position: 'absolute',
    bottom: 160,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(22,33,62,0.95)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    elevation: 8,
  },
  loadingText: { ...typography.caption, color: colors.textSecondary },

  // POI markers on map
  poiMarker: {
    backgroundColor: 'rgba(15,15,30,0.85)',
    borderRadius: radius.full,
    padding: 4,
    borderWidth: 1,
    borderColor: colors.accentLight,
  },
  poiMarkerEmoji: { fontSize: 18 },

  // POI category bar
  poiBar: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    gap: spacing.xs,
    zIndex: 18,
  },
  poiCatBtn: {
    flex: 1,
    backgroundColor: NEON_DIM,
    borderRadius: 50,
    paddingVertical: 6,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: NEON,
    elevation: 8,
    shadowColor: NEON,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
  },
  poiCatBtnActive: {
    borderColor: NEON,
    backgroundColor: 'rgba(0,191,255,0.2)',
    shadowColor: NEON,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 12,
  },
  poiCatEmoji: { fontSize: 18 },
  poiCatLabel: { ...typography.label, color: colors.textSecondary, fontSize: 9, marginTop: 1 },

  // POI results list
  poiListContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 18,
  },
  poiListContent: { paddingHorizontal: spacing.sm },
  poiLoading: { alignSelf: 'center', marginBottom: spacing.xs },
  poiCard: {
    backgroundColor: 'rgba(22,33,62,0.95)',
    borderRadius: radius.md,
    padding: spacing.sm,
    marginRight: spacing.sm,
    width: 120,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 6,
  },
  poiCardEmoji: { fontSize: 22, marginBottom: 2 },
  poiCardName: { ...typography.label, color: colors.text, fontWeight: '700', fontSize: 11 },
  poiCardBrand: { ...typography.label, color: colors.accent, fontSize: 10, marginTop: 1 },
  poiCardAddr: { ...typography.label, color: colors.textMuted, fontSize: 9, marginTop: 2 },

  // HOS badge
  hosBadge: {
    backgroundColor: 'rgba(15,15,30,0.92)',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 4,
  },
  hosBadgeWarn:  { borderColor: colors.warning },
  hosBadgeLimit: { borderColor: colors.error },
  hosBadgeLabel: { ...typography.label, color: colors.textMuted, fontSize: 8 },
  hosBadgeValue: { fontSize: 14, fontWeight: '700', color: colors.text },

  // Bottom-left: speed
  speedRow: {
    position: 'absolute',
    left: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    zIndex: 15,
  },
  speedBox: {
    backgroundColor: 'rgba(15,15,30,0.92)',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    minWidth: 72,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 6,
  },
  speedValue: { fontSize: 32, fontWeight: '800', color: colors.text },
  speedUnit:  { ...typography.label, color: colors.textSecondary },

  speedLimitBox: {
    backgroundColor: 'rgba(15,15,30,0.92)',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    minWidth: 60,
    borderWidth: 2,
    borderColor: colors.warning,
    elevation: 6,
  },
  speedLimitExceeded: { borderColor: colors.error },
  speedLimitLabel: { ...typography.label, color: colors.warning, fontSize: 9 },
  speedLimitValue: { fontSize: 22, fontWeight: '800', color: colors.warning },

  // Bottom-right: distance to turn
  distBox: {
    position: 'absolute',
    right: spacing.md,
    backgroundColor: 'rgba(15,15,30,0.92)',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    minWidth: 80,
    borderWidth: 1,
    borderColor: colors.accentLight,
    elevation: 6,
    zIndex: 15,
  },
  distValue: { fontSize: 20, fontWeight: '800', color: colors.accentLight },
  distLabel: { ...typography.label, color: colors.textSecondary, fontSize: 9 },

  // Bottom panel
  bottomPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,8,20,0.94)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    elevation: 16,
    borderTopWidth: 1.5,
    borderColor: NEON,
    shadowColor: NEON,
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  infoCell: { flex: 1, alignItems: 'center' },
  infoLabel: { ...typography.label, color: colors.textMuted, marginBottom: 2 },
  infoValue: { fontSize: 18, fontWeight: '700', color: colors.text },
  infoDivider: {
    width: 1, height: 36,
    backgroundColor: colors.border,
    marginHorizontal: spacing.xs,
  },
  closeBtn: { position: 'absolute', right: 0, top: 0, padding: spacing.sm },
  closeBtnText: { color: colors.textSecondary, fontSize: 16 },
  destName: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  startBtn: {
    backgroundColor: NEON_DIM,
    borderRadius: 50,
    borderWidth: 1.5,
    borderColor: NEON,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.xs,
    elevation: 12,
    shadowColor: NEON,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 10,
  },
  startBtnActive:   { backgroundColor: 'rgba(239,68,68,0.15)', borderColor: colors.error, shadowColor: colors.error },
  startBtnDisabled: { backgroundColor: 'rgba(22,33,62,0.5)', borderColor: colors.border, opacity: 0.6 },
  startBtnText: { ...typography.h3, color: colors.text },

  // Congestion chip
  congestionRow: { paddingHorizontal: spacing.xs, marginBottom: spacing.xs },
  congestionChip: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0,160,0,0.15)',
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(0,160,0,0.4)',
  },
  congestionHeavy:   { backgroundColor: 'rgba(200,0,0,0.15)',   borderColor: 'rgba(200,0,0,0.4)' },
  congestionModerate:{ backgroundColor: 'rgba(200,140,0,0.15)', borderColor: 'rgba(200,140,0,0.4)' },
  congestionText: { ...typography.label, color: colors.text, fontSize: 11 },

  // Departure time chips
  departRow: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  departChip: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 50,
    backgroundColor: 'rgba(0,20,40,0.7)',
    borderWidth: 1.5,
    borderColor: 'rgba(0,191,255,0.3)',
    alignItems: 'center',
  },
  departChipActive: {
    backgroundColor: NEON_DIM,
    borderColor: NEON,
    shadowColor: NEON,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 5,
    elevation: 6,
  },
  departChipText:       { ...typography.label, color: colors.textSecondary, fontSize: 10 },
  departChipTextActive: { ...typography.label, color: colors.accent, fontWeight: '700', fontSize: 10 },

  fab: {
    position: 'absolute',
    right: spacing.md,
    width: 60,
    height: 60,
    borderRadius: 50,
    backgroundColor: NEON_DIM,
    borderWidth: 1.5,
    borderColor: NEON,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 14,
    shadowColor: NEON,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 10,
  },
  fabEmoji: { fontSize: 26 },

  // Gemini chat FAB (bottom-left)
  geminiFab: {
    position: 'absolute',
    left: spacing.md,
    width: 56,
    height: 56,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    borderWidth: 1.5,
  },
  geminiFabOnline:  { backgroundColor: NEON_DIM, borderColor: NEON, shadowColor: NEON, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.85, shadowRadius: 8 },
  geminiFabOffline: { backgroundColor: 'rgba(22,33,62,0.92)', borderColor: colors.border },
  geminiFabEmoji: { fontSize: 24 },

  // Online indicator dot
  onlineDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.bg,
  },
  onlineDotGreen: { backgroundColor: '#22c55e' },
  onlineDotGrey:  { backgroundColor: colors.textMuted },

  // Chat panel
  chatPanel: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    maxHeight: 360,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 20,
    overflow: 'hidden',
    zIndex: 50,
  },
  chatMessages: {
    flex: 1,
    maxHeight: 280,
  },
  chatMessagesContent: {
    padding: spacing.sm,
    gap: spacing.xs,
  },
  chatPlaceholder: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  chatBubble: {
    maxWidth: '85%',
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    marginBottom: 4,
  },
  chatBubbleUser:  {
    alignSelf: 'flex-end',
    backgroundColor: colors.accent,
  },
  chatBubbleModel: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(50,50,80,0.95)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  chatBubbleText: { ...typography.caption, color: colors.text, fontSize: 13 },

  // Input row
  chatInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  chatInput: {
    flex: 1,
    height: 40,
    backgroundColor: 'rgba(15,15,30,0.8)',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    color: colors.text,
    ...typography.caption,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chatSendBtn: {
    width: 40,
    height: 40,
    borderRadius: 50,
    backgroundColor: NEON_DIM,
    borderWidth: 1.5,
    borderColor: NEON,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: NEON,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.75,
    shadowRadius: 6,
  },
  chatSendText: { color: colors.text, fontSize: 16 },

  // ── Options pocket menu ──────────────────────────────────────────────────
  optionsContainer: {
    position: 'absolute',
    right: spacing.md,
    zIndex: 20,
    alignItems: 'flex-end',
  },
  optionsPanel: {
    marginTop: spacing.xs,
    backgroundColor: 'rgba(0,8,20,0.93)',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: NEON,
    padding: spacing.xs,
    gap: spacing.xs,
    elevation: 18,
    shadowColor: NEON,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.65,
    shadowRadius: 10,
  },
  optionsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  optionBtn: {
    width: 44,
    height: 44,
    borderRadius: 50,
    backgroundColor: NEON_DIM,
    borderWidth: 1.5,
    borderColor: 'rgba(0,191,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionBtnOff: { opacity: 0.3 },
  optionBtnActive: {
    borderColor: NEON,
    backgroundColor: 'rgba(0,191,255,0.22)',
    elevation: 8,
    shadowColor: NEON,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
  },
});
