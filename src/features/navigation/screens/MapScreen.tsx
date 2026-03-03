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
  Keyboard,
  Alert,
  Image,
  Animated,
  Linking,
} from 'react-native';
import Tts from 'react-native-tts';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import Geolocation from 'react-native-geolocation-service';
import Mapbox, { locationManager, LocationPuck, type CameraPadding } from '@rnmapbox/maps';
import type * as GeoJSON from 'geojson';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { colors, radius, spacing, typography } from '../../../shared/constants/theme';
import { MAPBOX_PUBLIC_TOKEN, MAP_CENTER } from '../../../shared/constants/config';
import { useVehicleStore } from '../../../store/vehicleStore';
import type { VehicleProfile } from '../../../shared/types/vehicle';
import type { RootStackParamList } from '../../../shared/types/navigation';
import SearchBar from '../components/SearchBar';
import SignRenderer, { SIGN_TRIGGER_M } from '../components/SignRenderer';
import GoogleAccountModal from '../components/GoogleAccountModal';
import { loadSavedAccount, type GoogleAccount } from '../../../shared/services/accountManager';
import type { GeoPlace } from '../api/geocoding';
import {
  fetchRoute,
  adrToExclude,
  optimizeWaypointOrder,
  getSpeedLimitAtPosition,
  getCurrentStepIndex,
  maneuverEmoji,
  bgInstruction,
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
  fetchNearbyRestrictions,
  type ParkingSpot,
} from '../api/tilequery';
import {
  sendChatMessage,
  sendGeminiMessage,
  transcribeAudio,
  savePOI,
  starPlace,
  listStarred,
  fetchHealth,
  checkTruckRestrictions,
  saveTachoSession,
  fetchTachoSummary,
  type ChatMessage,
  type ChatContext,
  type SavedPOI,
  type TruckParking,
  type POICard,
  type RouteOption,
  type MapAction,
  type AppIntent,
  type TachoSummary,
} from '../../../shared/services/backendApi';

type MapNavProp = NativeStackNavigationProp<RootStackParamList, 'Map'>;

Mapbox.setAccessToken(MAPBOX_PUBLIC_TOKEN);

// AudioRecorderPlayer is exported as a ready-made singleton — use directly

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

// ── App deep-link URL builders ────────────────────────────────────────────────
const APP_URL_MAP: Record<string, (query?: string) => string> = {
  youtube:    q => q
    ? `intent://www.youtube.com/results?search_query=${encodeURIComponent(q)}#Intent;scheme=https;package=com.google.android.youtube;end`
    : `vnd.youtube://`,
  spotify:    q => q ? `spotify://search/${encodeURIComponent(q)}` : `spotify://`,
  whatsapp:   q => q ? `https://wa.me/?text=${encodeURIComponent(q)}` : `whatsapp://`,
  telegram:   () => `tg://`,
  viber:      () => `viber://`,
  maps:       q => `geo:0,0?q=${encodeURIComponent(q ?? '')}`,
  settings:   () => `intent:#Intent;action=android.settings.SETTINGS;end`,
  phone:      q => q ? `tel:${q.replace(/\D/g, '')}` : `tel://`,
  camera:     () => `intent:#Intent;action=android.media.action.IMAGE_CAPTURE;end`,
  calculator: () => `intent:#Intent;action=android.intent.action.MAIN;package=com.google.android.calculator;end`,
  chrome:     q => q
    ? `intent://${q.replace(/^https?:\/\//, '')}#Intent;scheme=https;package=com.android.chrome;end`
    : `intent://google.com#Intent;scheme=https;package=com.android.chrome;end`,
  facebook:   () => `fb://`,
  instagram:  () => `instagram://`,
};

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
  if (!dir || dir === 'none' || dir === 'straight') return '⬆️';
  if (dir === 'sharp left')  return '⬅️';
  if (dir === 'left')        return '⬅️';
  if (dir === 'slight left') return '↖️';
  if (dir === 'slight right')return '↗️';
  if (dir === 'right')       return '➡️';
  if (dir === 'sharp right') return '➡️';
  if (dir === 'uturn')       return '🔄';
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

/** Convert a raw backend string to clean chat-bubble text.
 *  If the string is a JSON action object, returns a human-readable
 *  Bulgarian summary instead of raw JSON. */
function parseBubbleText(raw: string): string {
  const s = raw.trim();
  if (!s.startsWith('{')) return s;
  try {
    const obj = JSON.parse(s) as Record<string, unknown>;
    // Prefer explicit text fields the backend may include
    const explicit = String(obj.text ?? obj.message ?? obj.reply ?? '').trim();
    if (explicit) return explicit;
    // Generate friendly text from action type
    const dest = String(obj.destination ?? 'дестинацията');
    switch (String(obj.action ?? '')) {
      case 'route':       return `Пътуваме към ${dest}. Приятен път!`;
      case 'show_routes': return `Варианти за маршрут до ${dest}.`;
      case 'show_pois':   return `Търся наблизо…`;
      case 'tachograph':  return 'Проверка на тахографа.';
      default:            return ''; // caller applies voiceText fallback
    }
  } catch {
    return s; // not valid JSON — show as-is
  }
}

/** Build clean, emoji-free TTS confirmation for each GPT action. */
function voiceText(act: MapAction): string {
  switch (act.action) {
    case 'show_pois': {
      const count = act.cards?.length ?? 0;
      const nearest =
        'nearest_m' in act && typeof act.nearest_m === 'number' && act.nearest_m > 0
          ? `, най-близката на ${Math.round(act.nearest_m)} метра`
          : '';
      switch (act.category) {
        case 'truck_stop':   return `Намерих ${count} паркинга за камиони.`;
        case 'fuel':         return `Намерих ${count} горивни станции.`;
        case 'speed_camera': return `Внимание, ${count} камери в района${nearest}.`;
        case 'business':     return `Намерих ${count} места. Показвам на картата.`;
        default:             return `Намерих ${count} резултата.`;
      }
    }
    case 'add_waypoint':
      return `Добавена спирка ${act.name}. Преизчислявам маршрута.`;
    case 'route':
      return `Прокладвам маршрут до ${act.destination}.`;
    case 'show_routes': {
      const count = act.options?.length ?? 0;
      return `Намерих ${count} варианта за ${act.destination}. Избери маршрут.`;
    }
    case 'tachograph': {
      const rem = act.remaining_hours ?? 0;
      if (act.break_needed) return 'Достигнат лимит. Задължителна 45-минутна почивка.';
      if (rem < 0.5)         return `${Math.round(rem * 60)} минути до почивка. Спри скоро.`;
      return `Остават ${rem.toFixed(1)} часа до задължителна почивка.`;
    }
    case 'message':
      return act.text ?? '';
    default:
      return '';
  }
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

/** Open-Meteo WMO weather code → emoji string. */
function weatherEmoji(code: number): string {
  if (code === 0)   return '☀️';
  if (code <= 3)    return '⛅';
  if (code <= 48)   return '🌫️';
  if (code <= 67)   return '🌧️';
  if (code <= 77)   return '🌨️';
  if (code <= 82)   return '🌦️';
  if (code <= 95)   return '⛈️';
  return '🌩️';
}

/**
 * Detect ISO-2 country code from GPS coordinates (EU trucking countries).
 * Used to build the correct truckerapps.eu/transparking/{cc}/map/ URL.
 */
function detectCountryCode(lat: number, lng: number): string {
  if (lat > 41.2 && lat < 44.2 && lng > 22.4 && lng < 28.6) return 'bg';
  if (lat > 43.6 && lat < 48.3 && lng > 20.3 && lng < 30.0) return 'ro';
  if (lat > 49.0 && lat < 54.9 && lng > 14.1 && lng < 24.2) return 'pl';
  if (lat > 47.3 && lat < 55.1 && lng >  6.0 && lng < 15.0) return 'de';
  if (lat > 46.4 && lat < 49.0 && lng >  9.5 && lng < 17.2) return 'at';
  if (lat > 45.7 && lat < 48.6 && lng > 16.1 && lng < 22.9) return 'hu';
  if (lat > 41.3 && lat < 51.1 && lng > -5.2 && lng <  9.6) return 'fr';
  if (lat > 36.6 && lat < 47.1 && lng >  6.6 && lng < 18.6) return 'it';
  if (lat > 35.9 && lat < 43.9 && lng > -9.3 && lng <  4.3) return 'es';
  if (lat > 50.7 && lat < 53.6 && lng >  3.3 && lng <  7.2) return 'nl';
  if (lat > 49.5 && lat < 51.5 && lng >  2.5 && lng <  6.4) return 'be';
  if (lat > 48.5 && lat < 51.1 && lng > 12.1 && lng < 18.9) return 'cz';
  if (lat > 47.7 && lat < 49.6 && lng > 16.8 && lng < 22.6) return 'sk';
  if (lat > 45.3 && lat < 47.0 && lng > 13.4 && lng < 19.8) return 'hr';
  if (lat > 44.0 && lat < 46.9 && lng > 19.3 && lng < 23.0) return 'rs';
  if (lat > 49.0 && lat < 54.0 && lng > 22.0 && lng < 32.7) return 'ua';
  return 'eu';   // fallback — truckerapps shows European map
}

/** Open a URL in the external browser, forcing Chrome on Android if available. */
function openInBrowser(url: string): void {
  if (Platform.OS === 'android') {
    // Try Chrome first so truckerapps.eu app (if installed) doesn't intercept
    Linking.openURL(
      `intent://${url.replace(/^https?:\/\//, '')}#Intent;scheme=https;`
      + `action=android.intent.action.VIEW;`
      + `category=android.intent.category.BROWSABLE;`
      + `package=com.android.chrome;end`,
    ).catch(() => Linking.openURL(url).catch(() => null));
  } else {
    Linking.openURL(url).catch(() => null);
  }
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

  // Map mode: 'vector' = light/dark vector | 'hybrid' = satellite-streets-v12 | 'satellite' = pure satellite-v9
  type MapMode = 'vector' | 'hybrid' | 'satellite';
  const [mapMode, setMapMode] = useState<MapMode>('hybrid');
  const [mapIsLoaded, setMapIsLoaded] = useState(false);
  const [showTraffic, setShowTraffic] = useState(true);
  const [mapPitch, setMapPitch] = useState(0);

  // ── Navigation Simulator ──────────────────────────────────────────────────
  const [simulating, setSimulating] = useState(false);

  // ── Visual Debug Mode ─────────────────────────────────────────────────────
  const [debugMode, setDebugMode] = useState(false);
  // Test-only: inject mock lanes to verify the pulsing animation visually
  const [testLanesMode, setTestLanesMode] = useState(false);

  // ── Speed Camera HUD — nearest camera proximity alert ────────────────────
  const [cameraAlert, setCameraAlert] = useState<{ dist: number; name: string } | null>(null);
  // ── Elevation Profile — sampled altitudes along route ────────────────────
  const [elevProfile, setElevProfile] = useState<number[]>([]);
  // ── Weather Overlay — Open-Meteo current conditions at route points ───────
  const [weatherPoints, setWeatherPoints] = useState<Array<{
    coords: [number, number]; emoji: string; temp: number;
  }>>([]);

  // Light / dark theme — auto-computed from time (6:00–20:00 = day), overridable
  const getIsDay = () => { const h = new Date().getHours(); return h >= 6 && h < 20; };
  const [lightMode, setLightMode] = useState(getIsDay);

  // Real-time traffic: bump key every 30s to remount VectorSource and pull fresh tiles
  const [trafficKey, setTrafficKey] = useState(0);

  // streets-v8 truck overlays (tunnels + lane dividers) and terrain-v2 contour lines
  const [showRestrictions, setShowRestrictions] = useState(false);
  const [showContours, setShowContours]         = useState(false);
  const [showIncidents, setShowIncidents]       = useState(false);

  // Auto-switch every minute; resets mapIsLoaded so the new style URL loads (vector only).
  // Skip reset during active navigation — interrupting followUserLocation causes camera jump.
  useEffect(() => {
    const timer = setInterval(() => {
      const next = getIsDay();
      setLightMode(prev => {
        if (prev !== next && mapMode === 'vector' && !navigatingRef.current) {
          setMapIsLoaded(false);
        }
        return next;
      });
    }, 60_000);
    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapMode]);

  // Traffic data refresh — bump key every 60s to remount VectorSource (not in pure satellite)
  useEffect(() => {
    if (!showTraffic || mapMode === 'satellite') return;
    const timer = setInterval(() => setTrafficKey(k => k + 1), 60_000);
    return () => clearInterval(timer);
  }, [showTraffic, mapMode]);

  // Incidents are rendered via mapbox-traffic-v1 tileset (sourceLayerID="incidents")
  // No fetch needed — Mapbox streams incident tiles directly when the VectorSource is mounted.

  // Auto-enable tunnel/restriction overlay when truck height > 3.5 m (typical bridge clearance)
  useEffect(() => {
    if (profile && profile.height_m > 3.5) setShowRestrictions(true);
  }, [profile]);

  // Auto-enable terrain contours when driving out of city (speed > 60 km/h = highway / rural)
  useEffect(() => {
    if (speed > 60) setShowContours(true);
  }, [speed]);

  // Voice
  const [voiceMuted, setVoiceMuted] = useState(false);
  const voiceMutedRef     = useRef(false);
  const lastSpokenStepRef = useRef(-1);

  // Options pocket menu
  const [optionsOpen, setOptionsOpen] = useState(false);

  // Backend / AI chat
  const [backendOnline, setBackendOnline]       = useState(false);
  const [starredPOIs, setStarredPOIs]           = useState<SavedPOI[]>([]);
  const [showStarredLayer, setShowStarredLayer] = useState(true);

  // Google account (replaces manual Gemini API key)
  const [googleUser, setGoogleUser]           = useState<GoogleAccount | null>(null);
  const [showAccountModal, setShowAccountModal] = useState(false);

  // Dual chat panels — GPT-4o (navigation) + Gemini (free chat + apps)
  const [gptChatOpen, setGptChatOpen]         = useState(false);
  const [geminiChatOpen, setGeminiChatOpen]   = useState(false);
  const [gptHistory, setGptHistory]           = useState<ChatMessage[]>([]);
  const [geminiHistory, setGeminiHistory]     = useState<ChatMessage[]>([]);
  const [gptLoading, setGptLoading]           = useState(false);
  const [geminiLoading, setGeminiLoading]     = useState(false);

  // Shared input / mic state — routed to whichever panel is open
  const [chatInput, setChatInput]             = useState('');
  const chatLoading = gptChatOpen ? gptLoading : geminiLoading;

  // Voice / Whisper input
  const [isRecording, setIsRecording] = useState(false);
  const [micLoading, setMicLoading]   = useState(false);

  // Keyboard height — lifts chat panel above keyboard on Android
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', e => setKbHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKbHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // Multi-stop waypoints
  const [waypoints, setWaypoints]           = useState<[number, number][]>([]);
  const [waypointNames, setWaypointNames]   = useState<string[]>([]);
  // Long-press map popup
  const [longPressCoord, setLongPressCoord] = useState<[number, number] | null>(null);

  // GPT-4o map action results
  const [parkingResults, setParkingResults]   = useState<POICard[]>([]);
  const [selectedParking, setSelectedParking] = useState<POICard | null>(null);
  const [fuelResults, setFuelResults]         = useState<POICard[]>([]);
  const [cameraResults, setCameraResults]     = useState<POICard[]>([]);
  const [businessResults, setBusinessResults] = useState<POICard[]>([]);
  const [routeOptions, setRouteOptions]     = useState<RouteOption[]>([]);
  const [routeOptDest, setRouteOptDest]     = useState<{ name: string; coords: [number, number]; waypoints?: [number, number][] } | null>(null);
  const [selectedRouteIdx, setSelectedRouteIdx]       = useState<number | null>(null);
  const [restrictionWarnings, setRestrictionWarnings] = useState<string[]>([]);
  const [restrictionChecking, setRestrictionChecking] = useState(false);

  // Custom origin (overrides GPS for routing)
  const [customOriginName, setCustomOriginName] = useState<string>('');
  const customOriginRef = useRef<[number, number] | null>(null);
  const [tachographResult, setTachographResult] = useState<{
    drivenHours: number;
    remainingHours: number;
    breakNeeded: boolean;
    suggestedStop?: { lat: number; lng: number; name: string };
  } | null>(null);

  // POI
  const [poiCategory, setPoiCategory] = useState<POICategory | null>(null);
  const [poiResults, setPoiResults]   = useState<TruckPOI[]>([]);
  const [loadingPOI, setLoadingPOI]   = useState(false);
  const [sarMode, setSarMode]         = useState(false); // true = results are SAR (along route)
  // Ref mirrors — avoids stale closures on rapid taps.
  const poiCategoryRef = useRef<POICategory | null>(null);
  const sarModeRef     = useRef(false);
  useEffect(() => { poiCategoryRef.current = poiCategory; }, [poiCategory]);
  useEffect(() => { sarModeRef.current     = sarMode;     }, [sarMode]);

  // HOS (EU Regulation 561/2006) — continuous + daily + weekly tracking
  const [drivingSeconds, setDrivingSeconds] = useState(0);
  const [tachoSummary, setTachoSummary]     = useState<TachoSummary | null>(null);
  const sessionStartRef = useRef<string | null>(null); // ISO start time of current session
  const isDrivingRef   = useRef(false);
  const hosIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hosWarningRef  = useRef({ w30: false, w10: false, limit: false });
  // Guard: prevent setState after unmount (avoids "Can't perform a React state
  // update on an unmounted component" from the HOS setInterval tick).
  const isMountedRef   = useRef(true);
  useEffect(() => () => { isMountedRef.current = false; }, []);

  // ── Tilequery state ────────────────────────────────────────────────────────
  const [elevation, setElevation]       = useState<number | null>(null);
  const [tunnelWarning, setTunnelWarning] = useState<string | null>(null);
  const [autoParking, setAutoParking]   = useState<ParkingSpot[]>([]);

  // Tilequery throttle refs — timestamps of last call per query type
  const lastElevationRef   = useRef<number>(0);
  const lastRestrictionRef = useRef<number>(0);
  const lastParkingRef     = useRef<number>(0);
  // Stopped detection: timestamp when speed first dropped below 2 km/h
  const stoppedSinceRef    = useRef<number | null>(null);

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
          if (isSimulatingRef.current) return; // simulator overrides GPS
          const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude];
          userCoordsRef.current = coords;
          setUserCoords(coords);
          setGpsReady(true);

          const spd = pos.coords.speed ?? -1;
          const kmh = spd > 0 ? spd * 3.6 : 0;
          setSpeed(Math.round(kmh));
          isDrivingRef.current = kmh > 3;

          // ── Tilequery queries (all throttled) ─────────────────────────────
          const tqNow = Date.now();
          const [tqLng, tqLat] = coords;

          // 1. Elevation — update every 15 s
          if (tqNow - lastElevationRef.current >= 15_000) {
            lastElevationRef.current = tqNow;
            fetchElevationAtPoint(tqLng, tqLat).then(ele => {
              if (isMountedRef.current && ele != null) setElevation(ele);
            });
          }

          // 2. Stopped detection → auto-search parking once per stop
          //    Triggers after 20 s stationary, 2-minute cooldown between searches
          if (kmh < 2) {
            if (stoppedSinceRef.current === null) stoppedSinceRef.current = tqNow;
            const stoppedMs = tqNow - stoppedSinceRef.current;
            if (stoppedMs >= 20_000 && tqNow - lastParkingRef.current >= 120_000) {
              lastParkingRef.current = tqNow;
              fetchNearbyParking(tqLng, tqLat, 1000).then(spots => {
                if (isMountedRef.current && spots.length > 0) setAutoParking(spots);
              });
            }
          } else {
            stoppedSinceRef.current = null;
          }
          // ── end Tilequery (pre-nav) ────────────────────────────────────────

          const isNav = navigatingRef.current;
          const cur   = routeRef.current;
          if (!isNav || !cur) return;

          // 3. Restriction check — tunnels/bridges nearby (every 10 s, tall trucks only)
          const profR = profileRef.current;
          if (profR && profR.height_m > 3.5 && tqNow - lastRestrictionRef.current >= 10_000) {
            lastRestrictionRef.current = tqNow;
            fetchNearbyRestrictions(tqLng, tqLat, 400).then(r => {
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
                max_weight: prof.weight_t, max_length: prof.length_m,
                exclude: adrToExclude(prof.hazmat_class ?? 'none') }
            : undefined;

          fetchRoute(coords, dest, truck, undefined, waypointsRef.current)
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

  // ── Load Google account + starred POIs + tacho summary on mount ──────────
  useEffect(() => {
    loadSavedAccount().then(acc => {
      if (!isMountedRef.current) return;
      const email = acc?.email;
      if (acc) {
        setGoogleUser(acc);
        listStarred(email).then(places => {
          if (isMountedRef.current) setStarredPOIs(places);
        });
      }
      // Load today's tacho summary regardless of account
      fetchTachoSummary(email).then(s => {
        if (s && isMountedRef.current) setTachoSummary(s);
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── TTS initialisation — Bulgarian voice with auto-detection ────────────
  useEffect(() => {
    const initTts = async () => {
      try {
        // Try to find an installed Bulgarian voice
        const voices = await Tts.voices();
        const bgVoice = voices?.find(
          (v: { language?: string; id: string }) =>
            v.language?.toLowerCase().startsWith('bg'),
        );
        if (bgVoice) {
          await Tts.setDefaultLanguage(bgVoice.language ?? 'bg-BG');
          await Tts.setDefaultVoice(bgVoice.id);
        } else {
          // Fallback: set locale only — some engines accept 'bg' without a voice match
          await Tts.setDefaultLanguage('bg-BG').catch(() =>
            Tts.setDefaultLanguage('bg').catch(() =>
              Tts.setDefaultLanguage('en-US').catch(() => {}),
            ),
          );
        }
      } catch {
        // Ignore — TTS engine not ready yet
      }
      Tts.setDefaultRate(0.48);
      Tts.setDefaultPitch(1.0);
    };
    initTts();
  }, []);

  // ── Speak turn instruction when step advances ─────────────────────────────
  useEffect(() => {
    if (!navigating || voiceMuted) return;
    if (currentStep === lastSpokenStepRef.current) return;
    lastSpokenStepRef.current = currentStep;
    const step = route?.steps?.[currentStep];
    if (!step) return;
    // Priority: 1) Mapbox maneuver.instruction — already Bulgarian (language:'bg')
    //           2) bgInstruction() — generated Bulgarian fallback
    //           3) voiceInstructions announcement (English fallback for other langs)
    const text =
      step.maneuver.instruction ||
      bgInstruction(step) ||
      step.voiceInstructions?.[0]?.announcement;
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

  // ── Speed camera proximity alert — fires TTS + flash every 10 s when < 600 m ──
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
      if (!voiceMutedRef.current) ttsSpeak(`Внимание! Камера на ${Math.round(nearest.dist)} метра.`);
      Animated.sequence([
        Animated.timing(cameraFlashAnim, { toValue: 1, duration: 180, useNativeDriver: false }),
        Animated.timing(cameraFlashAnim, { toValue: 0, duration: 180, useNativeDriver: false }),
        Animated.timing(cameraFlashAnim, { toValue: 1, duration: 180, useNativeDriver: false }),
        Animated.timing(cameraFlashAnim, { toValue: 0, duration: 350, useNativeDriver: false }),
      ]).start();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userCoords, navigating, cameraResults]);

  // ── Refs — stable values readable inside the GPS callback ────────────────
  // Pattern: state drives render; refs let the stable callback read latest values
  // without re-creating it (re-creation mid-forEach crashes AnimatedNode).

  const navigatingRef      = useRef(false);
  const routeRef           = useRef<RouteResult | null>(null);
  const userCoordsRef      = useRef<[number, number] | null>(null);
  const isSimulatingRef    = useRef(false);
  const simIndexRef        = useRef(0);
  const simIntervalRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const destinationRef     = useRef<[number, number] | null>(null);
  const destinationNameRef = useRef('');
  const profileRef         = useRef<VehicleProfile | null>(null);
  const departAtRef        = useRef<string | null>(null);
  const lastRerouteRef        = useRef<number>(0);
  const waypointsRef          = useRef<[number, number][]>([]);
  const waypointNamesRef      = useRef<string[]>([]);
  const profileRerouteTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cameraFlashAnim       = useRef(new Animated.Value(0)).current;
  const lastCameraWarnRef     = useRef<number>(0);
  const laneGlowAnim          = useRef(new Animated.Value(0)).current;
  const laneGlowLoop          = useRef<Animated.CompositeAnimation | null>(null);
  // Stable refs for callbacks that close over mutable state (avoids stale closure)
  const drivingSecondsRef = useRef(0);
  const googleUserRef     = useRef<typeof googleUser>(null);

  useEffect(() => { navigatingRef.current      = navigating;       }, [navigating]);
  useEffect(() => { routeRef.current           = route;            }, [route]);
  useEffect(() => { userCoordsRef.current      = userCoords;       }, [userCoords]);
  useEffect(() => { destinationRef.current     = destination;      }, [destination]);
  useEffect(() => { destinationNameRef.current = destinationName;  }, [destinationName]);
  useEffect(() => { departAtRef.current        = departAt;         }, [departAt]);
  useEffect(() => { waypointsRef.current       = waypoints;        }, [waypoints]);
  useEffect(() => { waypointNamesRef.current   = waypointNames;    }, [waypointNames]);
  useEffect(() => { drivingSecondsRef.current  = drivingSeconds;   }, [drivingSeconds]);
  useEffect(() => { googleUserRef.current      = googleUser;       }, [googleUser]);

  // Keep profileRef in sync
  useEffect(() => { profileRef.current = profile; }, [profile]);


  // Profile change WHILE navigating → debounced re-route (800 ms).
  // CRITICAL: deps = [profile] only — navigating must NOT be a dep.
  // If navigating were in deps, pressing "Тръгваме" would trigger this effect,
  // fire navigateTo() after 800 ms, and call setNavigating(false) — resetting nav.
  useEffect(() => {
    if (!navigatingRef.current || !destinationRef.current) return;
    if (profileRerouteTimer.current) clearTimeout(profileRerouteTimer.current);
    profileRerouteTimer.current = setTimeout(() => {
      if (navigatingRef.current && destinationRef.current) {
        navigateTo(destinationRef.current, destinationNameRef.current, waypointsRef.current);
      }
    }, 800);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  // ── Shared route-to helper ────────────────────────────────────────────────
  // Single source of truth for fetching a route and fitting the camera.
  // All data read via refs → deps:[] → stable identity across renders.
  // isMountedRef guard prevents setState after component unmounts.

  const navigateTo = useCallback(async (dest: [number, number], name: string, waypoints?: [number, number][]) => {
    setDestination(dest);
    setDestinationName(name);
    setNavigating(false);
    setRoute(null);
    setCurrentStep(0);
    setSpeedLimit(null);
    setDistToTurn(null);

    // Origin priority: custom (manually set) > GPS > fallback centre
    const origin: [number, number] =
      customOriginRef.current ??
      userCoordsRef.current ??
      [MAP_CENTER.longitude, MAP_CENTER.latitude];
    setLoadingRoute(true);
    try {
      const prof = profileRef.current;
      const truck = prof
        ? {
            max_height: prof.height_m,
            max_width: prof.width_m,
            max_weight: prof.weight_t,
            max_length: prof.length_m,
            exclude: adrToExclude(prof.hazmat_class ?? 'none'),
          }
        : undefined;

      const result = await fetchRoute(origin, dest, truck, departAtRef.current ?? undefined, waypoints);
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
    } catch (err) {
      cameraRef.current?.flyTo(dest, 800);
    } finally {
      if (isMountedRef.current) setLoadingRoute(false);
    }
  }, []); // stable — reads everything via refs

  // ── Route elevation profile: sample 8 points from geometry ───────────────
  const buildElevProfile = useCallback(async (r: RouteResult) => {
    const coords = r.geometry.coordinates;
    const step = Math.max(1, Math.floor(coords.length / 8));
    const samples: [number, number][] = [];
    for (let i = 0; i < coords.length; i += step) {
      if (samples.length >= 8) break;
      samples.push([coords[i][0], coords[i][1]]);
    }
    const elevs = await Promise.all(samples.map(([lng, lat]) => fetchElevationAtPoint(lng, lat)));
    if (isMountedRef.current) setElevProfile(elevs.filter((e): e is number => e != null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // stable

  // ── Route weather: Open-Meteo current_weather at 4 sample points ─────────
  const fetchWeatherForRoute = useCallback(async (r: RouteResult) => {
    const coords = r.geometry.coordinates;
    const indices = [0, Math.floor(coords.length / 3), Math.floor(2 * coords.length / 3), coords.length - 1];
    const results = await Promise.all(
      indices.map(async (idx) => {
        const [lng, lat] = coords[idx];
        try {
          const res = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`,
          );
          const data = await res.json() as { current_weather: { weathercode: number; temperature: number } };
          const w = data.current_weather;
          return { coords: [lng, lat] as [number, number], emoji: weatherEmoji(w.weathercode), temp: Math.round(w.temperature) };
        } catch { return null; }
      }),
    );
    if (isMountedRef.current) setWeatherPoints(results.filter((p): p is NonNullable<typeof p> => p != null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // stable

  // Trigger elevation + weather fetch whenever route changes
  useEffect(() => {
    if (!route) { setElevProfile([]); setWeatherPoints([]); return; }
    buildElevProfile(route);
    fetchWeatherForRoute(route);
  }, [route, buildElevProfile, fetchWeatherForRoute]);

  // ── Add intermediate waypoint + re-route ─────────────────────────────────
  // Appends a stop before the final destination and recalculates the route.
  const addWaypoint = useCallback(async (coord: [number, number], name: string) => {
    const appended = [...waypointsRef.current, coord];
    const appendedNames = [...waypointNamesRef.current, name];

    // Auto-optimize order when there are 2+ waypoints (nearest-neighbour TSP)
    const origin: [number, number] = userCoordsRef.current ?? [MAP_CENTER.longitude, MAP_CENTER.latitude];
    const optimized = appended.length >= 2 ? optimizeWaypointOrder(origin, appended) : appended;

    // Sync names to match the optimized order
    const nameMap = new Map(appended.map((wp, i) => [`${wp[0]},${wp[1]}`, appendedNames[i]]));
    const optimizedNames = optimized.map(wp => nameMap.get(`${wp[0]},${wp[1]}`) ?? '');

    setWaypoints(optimized);
    setWaypointNames(optimizedNames);
    // Immediate ref update so re-route picks up the new list even if state
    // hasn't propagated yet (React batching).
    waypointsRef.current     = optimized;
    waypointNamesRef.current = optimizedNames;
    const dest = destinationRef.current;
    if (dest) await navigateTo(dest, destinationNameRef.current, optimized);
  }, [navigateTo]);

  // ── Long-press map handler — shows popup for navigate / add-as-stop ───────
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
    setDrivingSeconds(0);
    sessionStartRef.current = new Date().toISOString();
    hosWarningRef.current = { w30: false, w10: false, limit: false };
    // Set navigating LAST — StableCamera's followUserLocation will activate and
    // smoothly move the camera to the user. Do NOT call flyTo() here: it conflicts
    // with followUserLocation and crashes the native Camera animation node.
    setNavigating(true);
    if (!voiceMutedRef.current) {
      Tts.stop();
      ttsSpeak('Навигацията е стартирана');
    }
  }, []);

  // ── Stop navigation, keep route (Спри навигацията) ────────────────────────
  // Keeps the route so the user can press "Тръгваме!" again without re-searching.
  const handleStopNav = useCallback(() => {
    Tts.stop();
    setNavigating(false);
    setMapPitch(0);
    setCurrentStep(0);
    setDistToTurn(null);
    setRerouting(false);
    hosWarningRef.current = { w30: false, w10: false, limit: false };
    lastRerouteRef.current = 0;
    // Persist session to backend (only if meaningfully long, ≥ 60 s)
    const driven = drivingSecondsRef.current;
    if (driven >= 60 && sessionStartRef.current) {
      const payload = {
        user_email:     googleUserRef.current?.email,
        driven_seconds: driven,
        start_time:     sessionStartRef.current,
        end_time:       new Date().toISOString(),
      };
      saveTachoSession(payload).then(s => {
        if (s && isMountedRef.current) setTachoSummary(s);
      });
      sessionStartRef.current = null;
    }
  }, []);

  // ── Clear route & stop navigation entirely (✕ close button) ───────────────
  const handleClear = useCallback(() => {
    Tts.stop();
    lastSpokenStepRef.current = -1;
    setDestination(null);
    setDestinationName('');
    setRoute(null);
    setNavigating(false);
    setMapPitch(0);
    setCurrentStep(0);
    setSpeedLimit(null);
    setDistToTurn(null);
    setRerouting(false);
    setPoiCategory(null);
    setPoiResults([]);
    setSarMode(false);
    setParkingResults([]);
    setFuelResults([]);
    setCameraResults([]);
    setBusinessResults([]);
    setRouteOptions([]);
    setRouteOptDest(null);
    setSelectedRouteIdx(null);
    setRestrictionWarnings([]);
    setTachographResult(null);
    setDrivingSeconds(0);
    setWaypoints([]);
    setWaypointNames([]);
    setLongPressCoord(null);
    setCameraAlert(null);
    setElevProfile([]);
    setWeatherPoints([]);
    waypointsRef.current     = [];
    waypointNamesRef.current = [];
    hosWarningRef.current = { w30: false, w10: false, limit: false };
    lastRerouteRef.current = 0;
    cameraRef.current?.flyTo([MAP_CENTER.longitude, MAP_CENTER.latitude], 800);
    // Also stop any running simulator
    if (simIntervalRef.current) clearInterval(simIntervalRef.current);
    isSimulatingRef.current = false;
    setSimulating(false);
    simIndexRef.current = 0;
  }, []);

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
      const result = await checkTruckRestrictions({
        weight_t:     prof.weight_t,
        height_m:     prof.height_m,
        width_m:      prof.width_m,
        length_m:     prof.length_m,
        hazmat_class: prof.hazmat_class ?? undefined,
      });
      setRestrictionWarnings(result.warnings);
    } finally {
      setRestrictionChecking(false);
    }
  }, []);

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
    const builder = APP_URL_MAP[intent.app.toLowerCase()];
    const url = builder ? builder(intent.query) : null;
    if (!url) return;
    Linking.openURL(url).catch(() => {
      const q = intent.query ?? intent.app;
      Linking.openURL(`https://www.google.com/search?q=${encodeURIComponent(q)}`).catch(() => null);
    });
  }, []);

  // ── GPT-4o direct chat (navigation brain) ────────────────────────────────
  const sendGptText = useCallback(async (text: string) => {
    if (!text || gptLoading) return;

    const userMsg: ChatMessage = { role: 'user', text };
    const newHistory = [...gptHistory, userMsg];
    setGptHistory(newHistory);
    setChatInput('');
    setGptLoading(true);

    const context: ChatContext = {
      lat:            userCoords?.[1],
      lng:            userCoords?.[0],
      driven_seconds: drivingSeconds,
      speed_kmh:      speed,
    };

    const response = await sendChatMessage(text, gptHistory.slice(-6), context);
    if (!isMountedRef.current) return;

    if (!response.ok) {
      setGptHistory([...newHistory, { role: 'model', text: 'Грешка: GPT-4o не отговаря.' }]);
      setGptLoading(false);
      return;
    }

    const act = response.action;
    if (!act) {
      const replyText = (response.reply ?? '').trim();
      if (replyText) {
        setGptHistory([...newHistory, { role: 'model', text: replyText }]);
        if (!voiceMutedRef.current) { Tts.stop(); ttsSpeak(replyText); }
      }
      setGptLoading(false);
      return;
    }

    const displayText =
      act.action === 'message'
        ? (act.text ?? '')
        : ('message' in act ? (act as { message?: string }).message : undefined) ?? '';

    const cleanText = displayText.trim()
      ? parseBubbleText(displayText)
      : (voiceText(act) || '✓');
    setGptHistory([...newHistory, { role: 'model', text: cleanText }]);
    const ttsMsg = voiceText(act);
    if (ttsMsg && !voiceMutedRef.current) { Tts.stop(); ttsSpeak(ttsMsg); }

    if (act.action === 'route') {
      navigateTo(act.coords, act.destination, act.waypoints);
    }
    if (act.action === 'add_waypoint') {
      addWaypoint(act.coords, act.name);
    }
    if (act.action === 'show_pois') {
      if (act.category === 'truck_stop') {
        setParkingResults(act.cards.filter(c => c.lat && c.lng).slice(0, 5));
        setFuelResults([]); setCameraResults([]); setBusinessResults([]); setTachographResult(null);
      }
      if (act.category === 'fuel') {
        setFuelResults(act.cards.slice(0, 4));
        setParkingResults([]); setCameraResults([]); setBusinessResults([]); setTachographResult(null);
      }
      if (act.category === 'speed_camera') {
        setCameraResults(act.cards);
        setParkingResults([]); setFuelResults([]); setBusinessResults([]);
      }
      if (act.category === 'business') {
        setBusinessResults(act.cards.filter(c => c.lat && c.lng).slice(0, 6));
        setParkingResults([]); setFuelResults([]); setCameraResults([]); setTachographResult(null);
      }
    }
    if (act.action === 'show_routes') {
      setRouteOptions(act.options);
      setRouteOptDest({ name: act.destination, coords: act.dest_coords, waypoints: act.waypoints });
      setRoute(null);
      setDestination(null);
    }
    if (act.action === 'tachograph') {
      setTachographResult({
        drivenHours:    act.driven_hours,
        remainingHours: act.remaining_hours,
        breakNeeded:    act.break_needed ?? false,
        suggestedStop:  act.suggested_stop,
      });
    }

    setGptLoading(false);
  }, [gptHistory, gptLoading, userCoords, drivingSeconds, speed, navigateTo, addWaypoint]);

  // ── Gemini free chat (apps + general knowledge, no navigation) ────────────
  const sendGeminiText = useCallback(async (text: string) => {
    if (!text || geminiLoading) return;

    const userMsg: ChatMessage = { role: 'user', text };
    const newHistory = [...geminiHistory, userMsg];
    setGeminiHistory(newHistory);
    setChatInput('');
    setGeminiLoading(true);

    const context: ChatContext = {
      lat:            userCoords?.[1],
      lng:            userCoords?.[0],
      driven_seconds: drivingSeconds,
      speed_kmh:      speed,
    };

    const response = await sendGeminiMessage(text, geminiHistory.slice(-6), context);
    if (!isMountedRef.current) return;

    if (!response.ok) {
      setGeminiHistory([...newHistory, { role: 'model', text: 'Грешка: Gemini не отговаря.' }]);
      setGeminiLoading(false);
      return;
    }

    const replyText = (response.reply ?? '').trim();
    if (replyText) {
      setGeminiHistory([...newHistory, { role: 'model', text: replyText }]);
      if (!voiceMutedRef.current) { Tts.stop(); ttsSpeak(replyText); }
    }
    if (response.app_intent) { handleAppIntent(response.app_intent); }

    setGeminiLoading(false);
  }, [geminiHistory, geminiLoading, userCoords, drivingSeconds, speed, handleAppIntent]);

  // Unified send — routes to whichever panel is open
  const sendText = useCallback((text: string) => {
    if (gptChatOpen) return sendGptText(text);
    return sendGeminiText(text);
  }, [gptChatOpen, sendGptText, sendGeminiText]);

  const handleChat = useCallback(() => {
    const t = chatInput.trim();
    if (gptChatOpen) sendGptText(t);
    else sendGeminiText(t);
  }, [chatInput, gptChatOpen, sendGptText, sendGeminiText]);

  // ── Whisper voice input (push-to-talk → Whisper API) ────────────────────

  const handleMicStart = useCallback(async () => {
    if (gptLoading || geminiLoading || micLoading || isRecording) return;
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title:          'Микрофон',
        message:        'TruckAI се нуждае от микрофона за гласови команди.',
        buttonPositive: 'Разреши',
        buttonNegative: 'Откажи',
      },
    );
    if (granted !== PermissionsAndroid.RESULTS.GRANTED) return;
    try {
      await AudioRecorderPlayer.startRecorder();
      setIsRecording(true);
    } catch { /* silent fail — mic busy or unavailable */ }
  }, [gptLoading, geminiLoading, micLoading, isRecording]);

  const handleMicStop = useCallback(async () => {
    if (!isRecording) return;
    setIsRecording(false);
    setMicLoading(true);
    try {
      const path = await AudioRecorderPlayer.stopRecorder();
      const transcribed = await transcribeAudio(path);
      if (transcribed) sendText(transcribed);
    } catch { /* silent fail */ } finally {
      setMicLoading(false);
    }
  }, [isRecording, sendText]);

  // ── POI search ────────────────────────────────────────────────────────────

  const handlePOISearch = useCallback(async (cat: POICategory) => {
    // Toggle off if same category (and not SAR mode)
    if (!sarModeRef.current && poiCategoryRef.current === cat) {
      setPoiCategory(null);
      setPoiResults([]);
      return;
    }
    setSarMode(false);
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
  }, []); // stable — reads via refs

  // ── Search Along Route ────────────────────────────────────────────────────
  const handleSARSearch = useCallback(async (cat: POICategory) => {
    const currentRoute = routeRef.current;
    if (!currentRoute) return;
    // Toggle off if same SAR category
    if (sarModeRef.current && poiCategoryRef.current === cat) {
      setSarMode(false);
      setPoiCategory(null);
      setPoiResults([]);
      return;
    }
    setSarMode(true);
    setPoiCategory(cat);
    setPoiResults([]);
    setLoadingPOI(true);
    try {
      const results = await searchAlongRoute(
        currentRoute.geometry.coordinates,
        cat,
        10,   // 10 min max detour
        10,   // up to 10 results
      );
      if (!isMountedRef.current) return;
      setPoiResults(results);
    } catch {
      if (isMountedRef.current) setPoiResults([]);
    } finally {
      if (isMountedRef.current) setLoadingPOI(false);
    }
  }, []); // stable — reads via refs

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
  //   'satellite' → satellite-v9              (pure aerial, no labels)
  //   'hybrid'    → satellite-streets-v12     (aerial + road labels)
  //   'vector'    → Mapbox Standard — built-in 3D landmarks + real lighting presets.
  //                 lightPreset: 'day' | 'night' based on system time.
  //                 showPointOfInterestLabels: true enables 3D landmark icons.
  // Traffic VectorSource overlays work in vector + hybrid modes.
  const mapStyleURL =
    mapMode === 'satellite' ? 'mapbox://styles/mapbox/satellite-v9'          :
    mapMode === 'hybrid'    ? 'mapbox://styles/mapbox/satellite-streets-v12' :
    JSON.stringify({
      version: 8,
      imports: [{
        id: 'basemap',
        url: 'mapbox://styles/mapbox/standard',
        config: {
          lightPreset: lightMode ? 'day' : 'night',
          showPointOfInterestLabels: true,
          showTransitLabels: true,
          showPlaceLabels: true,
          showRoadLabels: true,
          showTrafficIncidents: showIncidents,
        },
      }],
    });

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

  // Debug-only mock lanes — 4 lanes, middle two active (tests pulsing animation)
  const MOCK_LANES = useMemo(() => ([
    { type: 'lane' as const, text: '', active: false, directions: ['left'] },
    { type: 'lane' as const, text: '', active: true,  directions: ['straight'] },
    { type: 'lane' as const, text: '', active: true,  directions: ['slight right'] },
    { type: 'lane' as const, text: '', active: false, directions: ['right'] },
  ]), []);

  // In testLanesMode use mock data so animation can be verified without real navigation
  const displayLanes = testLanesMode ? MOCK_LANES : currentLanes;

  // Stable interpolation nodes for pulsing active-lane glow
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const laneGlowBg     = useMemo(() => laneGlowAnim.interpolate({
    inputRange:  [0, 1],
    outputRange: ['rgba(0,191,255,0.22)', 'rgba(0,191,255,0.60)'],
  }), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const laneGlowShadow = useMemo(() => laneGlowAnim.interpolate({
    inputRange:  [0, 1],
    outputRange: [0.55, 1.0],
  }), []);

  // Pulse active lane when < 350 m from turn — OR in testLanesMode (no nav required)
  const lanePulseOn = testLanesMode ||
    (navigating && distToTurn != null && distToTurn < 350 && displayLanes.some(l => l.active));
  useEffect(() => {
    if (lanePulseOn) {
      laneGlowLoop.current?.stop();
      laneGlowLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(laneGlowAnim, { toValue: 1, duration: 550, useNativeDriver: false }),
          Animated.timing(laneGlowAnim, { toValue: 0, duration: 550, useNativeDriver: false }),
        ]),
      );
      laneGlowLoop.current.start();
    } else {
      laneGlowLoop.current?.stop();
      laneGlowAnim.setValue(0);
    }
    return () => { laneGlowLoop.current?.stop(); };
  // laneGlowAnim is a stable ref — not a dep
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lanePulseOn]);

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

  // Dynamic terrain exaggeration: stronger relief when driving fast (rural / highway)
  const terrainExaggeration = speed > 90 ? 2.0 : speed > 60 ? 1.6 : speed > 30 ? 1.3 : 1.0;

  return (
    <View style={styles.container}>

      {/* ── Map ── */}
      <Mapbox.MapView
        style={styles.map}
        styleURL={mapStyleURL}
        pitchEnabled
        onDidFinishLoadingStyle={() => setMapIsLoaded(true)}
        onLongPress={handleMapLongPress}
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
          topImage="nav-arrow"
          bearingImage="nav-arrow"
          shadowImage="nav-arrow"
          scale={puckScale}
          pulsing={{ isEnabled: true, color: NEON, radius: 30 }}
          visible
        />

        {/* ── 3D Terrain DEM + atmosphere lighting ── */}
        {mapIsLoaded && (
          <Mapbox.RasterDemSource
            id="terrain-dem"
            url="mapbox://mapbox.mapbox-terrain-dem-v1"
            tileSize={512}
            maxZoomLevel={14}
          >
            {/* exaggeration scales with speed: 1.0 city → 1.6 highway → 2.0 open road */}
            <Mapbox.Terrain style={{ exaggeration: terrainExaggeration }} />
          </Mapbox.RasterDemSource>
        )}
        {mapIsLoaded && (
          <Mapbox.SkyLayer
            id="sky"
            style={{
              skyType: 'atmosphere',
              // Sun higher in the sky during day (polar angle 90° = horizon, 0° = zenith)
              skyAtmosphereSun: [0.0, lightMode ? 80.0 : 15.0],
              skyAtmosphereSunIntensity: lightMode ? 15 : 5,
            }}
          />
        )}

        {/* ── Terrain v2: elevation contour lines ──
            mapbox-terrain-v2 contour sourceLayer. index=1 picks every 5th (index)
            contour for thicker emphasis. Rendered before traffic so road data stays
            on top. Only visible in non-satellite, non-navigation mode. */}
        {mapIsLoaded && mapMode === 'vector' && showContours && (
          <Mapbox.VectorSource id="terrain-v2-contours" url="mapbox://mapbox.mapbox-terrain-v2">
            {/* Regular contours — subtle background texture */}
            <Mapbox.LineLayer
              id="contour-lines"
              sourceLayerID="contour"
              minZoomLevel={11}
              style={{
                lineColor: lightMode
                  ? 'rgba(110, 80, 40, 0.28)'
                  : 'rgba(190, 160, 100, 0.22)',
                lineWidth: ['interpolate', ['linear'], ['zoom'], 11, 0.5, 16, 1.0] as unknown as number,
                lineOpacity: 0.70,
              }}
            />
            {/* Index contours — every 5th line, slightly bolder */}
            <Mapbox.LineLayer
              id="contour-index"
              sourceLayerID="contour"
              filter={['==', ['get', 'index'], 1] as unknown as [string, ...unknown[]]}
              minZoomLevel={10}
              style={{
                lineColor: lightMode
                  ? 'rgba(110, 80, 40, 0.52)'
                  : 'rgba(190, 160, 100, 0.42)',
                lineWidth: ['interpolate', ['linear'], ['zoom'], 10, 0.8, 16, 1.6] as unknown as number,
                lineOpacity: 0.85,
              }}
            />
          </Mapbox.VectorSource>
        )}

        {/* ── Real-time traffic overlay (mapbox-traffic-v1, refreshes every 60 s) ──
            Rendered before buildings+route so NEON route lines stay on top.
            key={trafficKey} remounts VectorSource to pull fresh tiles. */}
        {mapIsLoaded && showTraffic && mapMode !== 'satellite' && (
          <Mapbox.VectorSource
            key={`traffic-${trafficKey}`}
            id="traffic-v1"
            url="mapbox://mapbox.mapbox-traffic-v1"
          >
            <Mapbox.LineLayer
              id="traffic-closed"
              sourceLayerID="traffic"
              filter={['any', ['==', ['get', 'congestion'], 'closed'], ['==', ['get', 'congestion'], 'severe']] as unknown as [string, ...unknown[]]}
              style={{ lineColor: '#e74c3c', lineWidth: 4.5, lineOpacity: 0.92, lineCap: 'round' }}
            />
            <Mapbox.LineLayer
              id="traffic-heavy"
              sourceLayerID="traffic"
              filter={['==', ['get', 'congestion'], 'heavy'] as unknown as [string, ...unknown[]]}
              style={{ lineColor: '#ff6b35', lineWidth: 3.5, lineOpacity: 0.88, lineCap: 'round' }}
            />
            <Mapbox.LineLayer
              id="traffic-moderate"
              sourceLayerID="traffic"
              filter={['==', ['get', 'congestion'], 'moderate'] as unknown as [string, ...unknown[]]}
              style={{ lineColor: '#f39c12', lineWidth: 2.5, lineOpacity: 0.82, lineCap: 'round' }}
            />
            <Mapbox.LineLayer
              id="traffic-low"
              sourceLayerID="traffic"
              filter={['==', ['get', 'congestion'], 'low'] as unknown as [string, ...unknown[]]}
              style={{ lineColor: '#2ecc71', lineWidth: 2, lineOpacity: 0.72, lineCap: 'round' }}
            />
          </Mapbox.VectorSource>
        )}

        {/* ── Incidents overlay (mapbox-traffic-v1 tileset, "incidents" layer) ──
            Uses the same VectorSource as traffic but targets the "incidents"
            sourceLayer. Mapbox streams incident tiles automatically.
            Works in all map modes except pure satellite. */}
        {mapIsLoaded && showIncidents && mapMode !== 'satellite' && (
          <Mapbox.VectorSource
            id="incidents-v1"
            url="mapbox://mapbox.mapbox-traffic-v1"
          >
            {/* Incident points — accidents, construction, closures */}
            <Mapbox.CircleLayer
              id="incident-points"
              sourceLayerID="incidents"
              filter={['==', ['geometry-type'], 'Point'] as unknown as [string, ...unknown[]]}
              minZoomLevel={9}
              style={{
                circleRadius: 9,
                circleColor: [
                  'match', ['get', 'class'],
                  'accident',     '#e74c3c',
                  'construction', '#f39c12',
                  'restriction',  '#9b59b6',
                  '#e74c3c',
                ] as unknown as string,
                circleOpacity: 0.92,
                circleStrokeWidth: 2,
                circleStrokeColor: '#ffffff',
              }}
            />
            {/* Incident lines — road closures / construction zones */}
            <Mapbox.LineLayer
              id="incident-lines"
              sourceLayerID="incidents"
              filter={['==', ['geometry-type'], 'LineString'] as unknown as [string, ...unknown[]]}
              style={{
                lineColor: '#e74c3c',
                lineWidth: 4,
                lineOpacity: 0.85,
                lineCap: 'round',
                lineDasharray: [2, 2],
              }}
            />
          </Mapbox.VectorSource>
        )}

        {/* ── Streets-v8: Truck restrictions + lane visualization ──
            Uses mapbox.mapbox-streets-v8 tileset for:
            - Tunnel hazards: dashed orange overlay (trucks must check clearance)
            - Bridge warnings: subtle cyan overlay (weight/clearance check)
            - Toll roads: dashed gold overlay (cost / permit awareness)
            - Lane dividers: dashes on motorway/trunk/primary with 2+ lanes
            Always visible when showRestrictions=true or actively navigating. */}
        {mapIsLoaded && mapMode !== 'satellite' && (showRestrictions || navigating) && (
          <Mapbox.VectorSource id="streets-v8" url="mapbox://mapbox.mapbox-streets-v8">
            {/* Bridge warning — check load capacity and height clearance */}
            <Mapbox.LineLayer
              id="truck-bridge-warning"
              sourceLayerID="road"
              filter={['==', ['get', 'structure'], 'bridge'] as unknown as [string, ...unknown[]]}
              minZoomLevel={10}
              style={{
                lineColor: lightMode ? '#0077aa' : '#00bbee',
                lineWidth: 5,
                lineOpacity: lightMode ? 0.38 : 0.32,
                lineCap: 'round',
              }}
            />
            {/* Tunnel hazard warning — truckers must verify height clearance */}
            <Mapbox.LineLayer
              id="truck-tunnel-warning"
              sourceLayerID="road"
              filter={['==', ['get', 'structure'], 'tunnel'] as unknown as [string, ...unknown[]]}
              minZoomLevel={10}
              style={{
                lineColor: lightMode ? '#e07000' : '#ffaa33',
                lineWidth: 6,
                lineOpacity: lightMode ? 0.62 : 0.52,
                lineDasharray: [2, 2] as unknown as number[],
                lineCap: 'round',
              }}
            />
            {/* Toll road indicator — gold dashes (cost awareness for routes) */}
            <Mapbox.LineLayer
              id="truck-toll-road"
              sourceLayerID="road"
              filter={['==', ['get', 'toll'], 1] as unknown as [string, ...unknown[]]}
              minZoomLevel={8}
              style={{
                lineColor: lightMode ? '#c8a000' : '#ffd700',
                lineWidth: 3,
                lineOpacity: lightMode ? 0.70 : 0.58,
                lineDasharray: [4, 3] as unknown as number[],
              }}
            />
            {/* Multi-lane dividers — dashed lines on wide roads (lanes ≥ 2) */}
            <Mapbox.LineLayer
              id="lane-dividers"
              sourceLayerID="road"
              filter={['all',
                ['>=', ['to-number', ['get', 'lanes']], 2],
                ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]],
              ] as unknown as [string, ...unknown[]]}
              minZoomLevel={13}
              style={{
                lineColor: lightMode
                  ? `rgba(70, 70, 70, ${navigating ? 0.52 : 0.32})`
                  : `rgba(255, 255, 255, ${navigating ? 0.38 : 0.20})`,
                lineWidth: navigating ? 1.2 : 0.7,
                lineDasharray: [6, 6] as unknown as number[],
              }}
            />
          </Mapbox.VectorSource>
        )}

        {/* Route polyline — slot="top" ensures it renders above Standard's 3D buildings/landmarks */}
        {mapIsLoaded && routeShape && (
          <Mapbox.ShapeSource id="route-source" shape={routeShape}>
            <Mapbox.LineLayer
              id="route-casing"
              slot="top"
              style={{ lineColor: '#0a0a1a', lineWidth: 9, lineCap: 'round', lineJoin: 'round' }}
            />
            <Mapbox.LineLayer
              id="route-line"
              slot="top"
              style={{ lineColor: NEON, lineWidth: 5, lineCap: 'round', lineJoin: 'round' }}
            />
          </Mapbox.ShapeSource>
        )}

        {/* ── Starred / Google Favourites layer ─────────────────────────── */}
        {showStarredLayer && starredPOIs.map((poi) => (
          <Mapbox.PointAnnotation
            key={`starred-${poi.id}`}
            id={`starred-${poi.id}`}
            coordinate={[poi.lng, poi.lat]}
            onSelected={() => navigateTo([poi.lng, poi.lat], poi.name)}
          >
            <View style={styles.starPin}>
              <Text style={styles.starPinEmoji}>⭐</Text>
            </View>
          </Mapbox.PointAnnotation>
        ))}

        {/* Destination pin */}
        {destination && (
          <Mapbox.PointAnnotation id="dest-pin" coordinate={destination}>
            <View style={styles.pin}>
              <Text style={styles.pinEmoji}>📍</Text>
            </View>
          </Mapbox.PointAnnotation>
        )}

        {/* Parking pins from GPT-4o — interactive bubbles */}
        {mapIsLoaded && parkingResults.map((p, i) => (
          <Mapbox.PointAnnotation
            key={`park-${i}`}
            id={`park-${i}`}
            coordinate={[p.lng, p.lat]}
            onSelected={() => {
              setSelectedParking(p);
              if (p.voice_desc && !voiceMutedRef.current) {
                ttsSpeak(p.voice_desc);
              }
            }}
          >
            <View style={[
              styles.parkingPin,
              selectedParking?.name === p.name && styles.parkingPinSelected,
            ]}>
              <Icon name="parking" size={20} color="#00bfff" />
            </View>
          </Mapbox.PointAnnotation>
        ))}

        {/* Fuel station pins */}
        {mapIsLoaded && fuelResults.filter(f => f.lat && f.lng).map((f, i) => (
          <Mapbox.PointAnnotation
            key={`fuel-${i}`}
            id={`fuel-${i}`}
            coordinate={[f.lng, f.lat]}
          >
            <View style={styles.fuelPin}>
              <Icon name="gas-station" size={20} color="#f59e0b" />
            </View>
          </Mapbox.PointAnnotation>
        ))}

        {/* Business / place pins from GPT-4o search */}
        {mapIsLoaded && businessResults.map((b, i) => (
          <Mapbox.PointAnnotation
            key={`biz-${i}`}
            id={`biz-${i}`}
            coordinate={[b.lng, b.lat]}
          >
            <View style={styles.bizPin}>
              <Icon name="office-building-marker" size={18} color="#00e5ff" />
            </View>
          </Mapbox.PointAnnotation>
        ))}

        {/* Speed camera pins */}
        {mapIsLoaded && cameraResults.filter(c => c.lat && c.lng).map((c, i) => (
          <Mapbox.PointAnnotation
            key={`cam-${i}`}
            id={`cam-${i}`}
            coordinate={[c.lng, c.lat]}
          >
            <View style={styles.cameraPin}>
              <Text style={styles.cameraPinText}>📷</Text>
              {c.maxspeed ? (
                <Text style={styles.cameraPinSpeed}>{c.maxspeed}</Text>
              ) : null}
            </View>
          </Mapbox.PointAnnotation>
        ))}

        {/* Multiple route options polylines — tappable */}
        {mapIsLoaded && routeOptions.map((opt, i) => {
          const isSelected = selectedRouteIdx === i;
          const dimmed     = selectedRouteIdx !== null && !isSelected;
          return (
            <Mapbox.ShapeSource
              key={`route-opt-${i}`}
              id={`route-opt-src-${i}`}
              shape={{ type: 'Feature', properties: {}, geometry: opt.geometry }}
              onPress={() => handleSelectRouteOption(i)}
            >
              <Mapbox.LineLayer
                id={`route-opt-casing-${i}`}
                style={{ lineColor: '#000', lineWidth: isSelected ? 9 : 7, lineCap: 'round', lineJoin: 'round' }}
              />
              <Mapbox.LineLayer
                id={`route-opt-line-${i}`}
                style={{
                  lineColor:   opt.color,
                  lineWidth:   isSelected ? 6 : 4,
                  lineOpacity: dimmed ? 0.35 : 0.9,
                  lineCap: 'round', lineJoin: 'round',
                }}
              />
            </Mapbox.ShapeSource>
          );
        })}

        {/* Waypoint markers — numbered intermediate stops */}
        {mapIsLoaded && waypoints.map((wp, i) => (
          <Mapbox.PointAnnotation
            key={`wp-${i}`}
            id={`wp-${i}`}
            coordinate={wp}
          >
            <View style={styles.waypointPin}>
              <Icon name="map-marker-plus" size={20} color="#fff" />
              <Text style={styles.waypointPinBadge}>{i + 1}</Text>
            </View>
          </Mapbox.PointAnnotation>
        ))}

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

        {/* ── Weather markers along route (Open-Meteo) ── */}
        {mapIsLoaded && weatherPoints.map((wp, i) => (
          <Mapbox.PointAnnotation
            key={`wx-${i}`}
            id={`wx-${i}`}
            coordinate={wp.coords}
          >
            <View style={styles.weatherPin}>
              <Text style={styles.weatherPinEmoji}>{wp.emoji}</Text>
              <Text style={styles.weatherPinTemp}>{wp.temp}°</Text>
            </View>
          </Mapbox.PointAnnotation>
        ))}

      </Mapbox.MapView>

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
              style={styles.parkingBubbleWebBtn}
              activeOpacity={0.8}
              onPress={() => {
                const cc = detectCountryCode(selectedParking.lat, selectedParking.lng);
                const base = cc === 'eu'
                  ? 'https://truckerapps.eu/transparking/'
                  : `https://truckerapps.eu/transparking/${cc}/map/`;
                openInBrowser(base);
              }}
            >
              <Icon name="web" size={16} color={NEON} />
              <Text style={styles.parkingBubbleWebBtnTxt}>Коментари</Text>
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

      {/* ── Sygic-style lane strip — horizontal bar above nav banner, < 350 m from turn ── */}
      {(testLanesMode || (navigating && distToTurn != null && distToTurn < 350)) && displayLanes.length > 0 && (
        <View style={styles.laneStrip}>
          {displayLanes.map((lane, i) =>
            lane.active ? (
              /* Active lane — neon pulsing glow + 3D scale pop */
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
              /* Inactive lane — static dimmed cell */
              <View key={i} style={styles.laneSCell}>
                <Text style={styles.laneSCellArrow}>
                  {laneDirectionEmoji(lane.directions?.[0])}
                </Text>
              </View>
            ),
          )}
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
            {/* ── Truck profile row ── */}
            <View style={[styles.optionsRow, { justifyContent: 'flex-start' }]}>
              <TouchableOpacity
                style={styles.optionBtn}
                onPress={() => { navigation.navigate('VehicleProfile'); setOptionsOpen(false); }}
              >
                <Text style={styles.mapBtnText}>🚚</Text>
              </TouchableOpacity>
              <Text style={styles.devRowLabel}>ПРОФИЛ</Text>
            </View>
            <View style={styles.optionsDivider} />

            {/* ── Map toggles row ── */}
            <View style={styles.optionsRow}>
              <TouchableOpacity
                style={styles.optionBtn}
                onPress={() => {
                  setMapMode(prev => {
                    const next: MapMode = prev === 'vector' ? 'hybrid' : prev === 'hybrid' ? 'satellite' : 'vector';
                    if (!navigating) setMapIsLoaded(false);
                    return next;
                  });
                }}
              >
                <Text style={styles.mapBtnText}>
                  {mapMode === 'vector' ? '🌍' : mapMode === 'hybrid' ? '🌐' : '🛰️'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.optionBtn, !showTraffic && styles.optionBtnOff]}
                onPress={() => setShowTraffic(v => !v)}
              >
                <Text style={styles.mapBtnText}>🚦</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.optionBtn, !showIncidents && styles.optionBtnOff]}
                onPress={() => setShowIncidents(v => !v)}
              >
                <Text style={styles.mapBtnText}>🚨</Text>
              </TouchableOpacity>
              {/* Light/dark theme toggle — overrides auto day/night detection */}
              <TouchableOpacity
                style={styles.optionBtn}
                onPress={() => { setLightMode(v => !v); if (!navigating) setMapIsLoaded(false); }}
              >
                <Text style={styles.mapBtnText}>{lightMode ? '🌙' : '☀️'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.optionBtn, voiceMuted && styles.optionBtnOff]}
                onPress={() => { setVoiceMuted(v => !v); if (!voiceMuted) Tts.stop(); }}
              >
                <Text style={styles.mapBtnText}>{voiceMuted ? '🔇' : '🔊'}</Text>
              </TouchableOpacity>
            </View>

            {/* ── Truck overlay row: road restrictions + terrain contours ── */}
            {mapMode !== 'satellite' && (
              <View style={styles.optionsRow}>
                {/* 🚧 Streets-v8: tunnel warnings + lane dividers */}
                <TouchableOpacity
                  style={[styles.optionBtn, !showRestrictions && styles.optionBtnOff]}
                  onPress={() => setShowRestrictions(v => !v)}
                >
                  <Text style={styles.mapBtnText}>🚧</Text>
                </TouchableOpacity>
                {/* 🗻 Terrain-v2: elevation contour lines */}
                <TouchableOpacity
                  style={[styles.optionBtn, !showContours && styles.optionBtnOff]}
                  onPress={() => setShowContours(v => !v)}
                >
                  <Text style={styles.mapBtnText}>🗻</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ── Proximity POI row — only when no route ── */}
            {!navigating && !route && (
              <View style={styles.optionsRow}>
                {POI_CATEGORIES.map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.optionBtn, !sarMode && poiCategory === cat && styles.optionBtnActive]}
                    onPress={() => { handlePOISearch(cat); setOptionsOpen(false); }}
                  >
                    <Text style={styles.mapBtnText}>{POI_META[cat].emoji}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* ── Search Along Route row — only when route is loaded ── */}
            {route && (
              <>
                <View style={styles.optionsDivider} />
                <View style={styles.optionsRow}>
                  <Text style={styles.sarRowLabel}>SAR</Text>
                  {POI_CATEGORIES.map((cat) => (
                    <TouchableOpacity
                      key={cat}
                      style={[styles.optionBtn, sarMode && poiCategory === cat && styles.sarBtnActive]}
                      onPress={() => { handleSARSearch(cat); setOptionsOpen(false); }}
                    >
                      <Text style={styles.mapBtnText}>{POI_META[cat].emoji}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {/* ── Starred / Google Favourites layer toggle ── */}
            <View style={styles.optionsDivider} />
            <View style={styles.optionsRow}>
              <TouchableOpacity
                style={[styles.optionBtn, !showStarredLayer && styles.optionBtnOff]}
                onPress={() => setShowStarredLayer(v => !v)}
              >
                <Text style={styles.mapBtnText}>⭐</Text>
              </TouchableOpacity>
              <Text style={styles.devRowLabel}>
                STARRED {starredPOIs.length > 0 ? `(${starredPOIs.length})` : ''}
              </Text>
            </View>

            {/* ── Google акаунт (per-user starred POIs) ── */}
            <View style={styles.optionsDivider} />
            <TouchableOpacity
              style={styles.geminiConnectBtn}
              onPress={() => { setShowAccountModal(true); setOptionsOpen(false); }}
            >
              <Text style={styles.geminiConnectEmoji}>G</Text>
              <Text style={styles.geminiConnectLabel}>
                {googleUser ? googleUser.email : 'Свържи Google акаунт'}
              </Text>
              {googleUser && (
                <View style={styles.geminiDot} />
              )}
            </TouchableOpacity>

            {/* ── Dev tools row — hidden inside ⚙️, only when route loaded ── */}
            {route && (
              <>
                <View style={styles.optionsDivider} />
                <View style={styles.optionsRow}>
                  <TouchableOpacity
                    style={[styles.optionBtn, simulating && styles.simBtnActive]}
                    onPress={() => { simulating ? stopSim() : startSim(); setOptionsOpen(false); }}
                  >
                    <Text style={styles.mapBtnText}>{simulating ? '⏹' : '▶'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.optionBtn, debugMode && styles.simBtnDebug]}
                    onPress={() => setDebugMode(v => !v)}
                  >
                    <Text style={styles.mapBtnText}>🐛</Text>
                  </TouchableOpacity>
                  <Text style={styles.devRowLabel}>DEV</Text>
                </View>
              </>
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
                onPress={() => { setSarMode(false); setPoiCategory(null); setPoiResults([]); }}
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
                    style={styles.parkingWebBtn}
                    activeOpacity={0.8}
                    onPress={() => {
                      const cc = detectCountryCode(p.lat, p.lng);
                      const base = cc === 'eu'
                        ? 'https://truckerapps.eu/transparking/'
                        : `https://truckerapps.eu/transparking/${cc}/map/`;
                      openInBrowser(base);
                    }}
                  >
                    <Icon name="web" size={12} color={NEON} />
                    <Text style={styles.parkingWebBtnTxt}>Web</Text>
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
              <TouchableOpacity
                key={i}
                style={styles.fuelCard}
                activeOpacity={0.75}
                onPress={() => {
                  setFuelResults([]);
                  if (f.lat && f.lng) navigateTo([f.lng, f.lat], f.name);
                }}
              >
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
                <View style={[styles.goBtn, styles.goBtnFuel]}>
                  <Icon name="gas-station" size={14} color="#0a0c1c" />
                  <Text style={styles.goBtnTxt}>Маршрут</Text>
                </View>
              </TouchableOpacity>
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

      {/* ── Route options panel from GPT-4o show_routes ── */}
      {routeOptions.length > 0 && !route && (
        <View style={[styles.routeOptionsPanel, { bottom: insets.bottom + 16 }]}>
          <View style={styles.routeOptionsHeader}>
            <Text style={styles.routeOptionsTitle}>🗺️ Изберете маршрут</Text>
            <TouchableOpacity
              onPress={() => {
                setRouteOptions([]); setRouteOptDest(null);
                setSelectedRouteIdx(null); setRestrictionWarnings([]);
              }}
              style={styles.parkingDismissBtn}
            >
              <Text style={styles.parkingDismissTxt}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Cards row */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.routeOptionsContent}
          >
            {routeOptions.map((opt, i) => {
              const isSelected = selectedRouteIdx === i;
              const trafficEmoji =
                opt.traffic === 'heavy' ? '🔴' : opt.traffic === 'moderate' ? '🟡' : opt.traffic === 'low' ? '🟢' : null;
              return (
                <TouchableOpacity
                  key={i}
                  style={[
                    styles.routeOptionCard,
                    { borderColor: opt.color },
                    isSelected && styles.routeOptionCardSelected,
                  ]}
                  activeOpacity={0.8}
                  onPress={() => handleSelectRouteOption(i)}
                >
                  <View style={[styles.routeOptionDot, { backgroundColor: opt.color }]} />
                  <Text style={styles.routeOptionLabel} numberOfLines={3}>{opt.label}</Text>
                  <Text style={styles.routeOptionDist}>{fmtDistance(opt.distance)}</Text>
                  <Text style={styles.routeOptionDur}>{fmtDuration(opt.duration)}</Text>
                  {trafficEmoji && (
                    <Text style={styles.routeOptionTraffic}>
                      {trafficEmoji} {opt.traffic === 'heavy' ? 'Задръстване' : opt.traffic === 'moderate' ? 'Умерено' : 'Свободно'}
                    </Text>
                  )}
                  {!isSelected && <Text style={styles.routeOptionTap}>Избери →</Text>}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Restrictions + Start button */}
          {selectedRouteIdx !== null && (
            <View style={styles.routeSelectedSummary}>
              {restrictionChecking && (
                <ActivityIndicator size="small" color={NEON} style={{ alignSelf: 'center' }} />
              )}
              {restrictionWarnings.map((w, i) => (
                <Text key={i} style={styles.routeRestrictionWarn}>{w}</Text>
              ))}
              <TouchableOpacity
                style={styles.routeStartBtn}
                activeOpacity={0.85}
                onPress={() => {
                  if (routeOptDest) navigateTo(routeOptDest.coords, routeOptDest.name, routeOptDest.waypoints);
                  setRouteOptions([]);
                  setSelectedRouteIdx(null);
                  setRestrictionWarnings([]);
                }}
              >
                <Text style={styles.routeStartBtnTxt}>🚀 Старт</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* ── Bottom-left: HOS badge + speed + limit — anchored just above elevationChip ── */}
      {navigating && (
        <View style={[styles.speedRow, { bottom: 224 + insets.bottom }]}>
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
            <View style={[
              styles.speedRing,
              speedLimit != null && speed > speedLimit
                ? styles.speedRingRed
                : speedLimit != null && speed > speedLimit - 10
                ? styles.speedRingYellow
                : styles.speedRingGreen,
            ]}>
              <Text style={styles.speedValue}>{speed}</Text>
              <Text style={styles.speedUnit}>км/ч</Text>
            </View>
          </View>
          {speedLimit != null && (
            <View style={[styles.speedCircle, speed > speedLimit && styles.speedCircleExceeded]}>
              <Text style={styles.speedCircleNum}>{speedLimit}</Text>
            </View>
          )}
        </View>
      )}

      {/* ── Elevation chip — real-time altitude from Tilequery terrain-v2 ── */}
      {elevation != null && (
        <View style={[styles.elevationChip, {
          bottom: navigating
            ? 190 + insets.bottom   // above speed row
            : 120 + insets.bottom,  // browse mode
        }]}>
          <Text style={styles.elevationText}>▲ {elevation} м н.в.</Text>
        </View>
      )}

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

          {/* Truck geometry badge — confirms active vehicle constraints used for routing */}
          {navigating && profile && (
            <View style={styles.truckDimRow}>
              <View style={styles.truckDimBadge}>
                <Text style={styles.truckDimText}>↕ {profile.height_m} м</Text>
              </View>
              <View style={styles.truckDimBadge}>
                <Text style={styles.truckDimText}>⚖ {profile.weight_t} т</Text>
              </View>
              <View style={styles.truckDimBadge}>
                <Text style={styles.truckDimText}>↔ {profile.width_m} м</Text>
              </View>
              <View style={styles.truckDimBadge}>
                <Text style={styles.truckDimText}>↔ {profile.length_m} м</Text>
              </View>
              {profile.hazmat_class && profile.hazmat_class !== 'none' && (
                <View style={[styles.truckDimBadge, styles.adrBadge]}>
                  <Text style={styles.truckDimText}>⚠ ADR {profile.hazmat_class}</Text>
                </View>
              )}
            </View>
          )}

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
          {/* ── Route elevation profile mini bar chart ── */}
          {elevProfile.length > 1 && (
            <View style={styles.elevProfileStrip}>
              <Text style={styles.elevProfileLabel}>
                ⛰ {Math.round(Math.min(...elevProfile))}–{Math.round(Math.max(...elevProfile))} м н.в.
              </Text>
              <View style={styles.elevProfileBars}>
                {(() => {
                  const min = Math.min(...elevProfile);
                  const max = Math.max(...elevProfile);
                  return elevProfile.map((e, i) => {
                    const pct = max > min ? (e - min) / (max - min) : 0.5;
                    return <View key={i} style={[styles.elevBar, { height: Math.max(4, pct * 28) }]} />;
                  });
                })()}
              </View>
            </View>
          )}

          {/* ── Weather strip along route ── */}
          {weatherPoints.length > 0 && (
            <View style={styles.weatherStrip}>
              {weatherPoints.map((wp, i) => (
                <View key={i} style={styles.weatherChip}>
                  <Text style={styles.weatherChipEmoji}>{wp.emoji}</Text>
                  <Text style={styles.weatherChipTemp}>{wp.temp}°C</Text>
                </View>
              ))}
            </View>
          )}

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

          {/* Waypoint strip — shows intermediate stops, tap ✕ to remove */}
          {waypoints.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.waypointStrip}
              contentContainerStyle={styles.waypointStripContent}
            >
              {waypointNames.map((name, i) => (
                <View key={i} style={styles.waypointChip}>
                  <Icon name="map-marker-plus" size={14} color="#ff8c00" style={{ marginRight: 4 }} />
                  <Text style={styles.waypointChipText} numberOfLines={1}>
                    {i + 1}. {name}
                  </Text>
                  <TouchableOpacity
                    style={styles.waypointChipRemoveBtn}
                    onPress={() => {
                      const newWps   = waypoints.filter((_, idx) => idx !== i);
                      const newNames = waypointNames.filter((_, idx) => idx !== i);
                      setWaypoints(newWps);
                      setWaypointNames(newNames);
                      waypointsRef.current     = newWps;
                      waypointNamesRef.current = newNames;
                      const dest = destinationRef.current;
                      if (dest) navigateTo(dest, destinationNameRef.current, newWps);
                    }}
                  >
                    <Icon name="close-circle" size={16} color="rgba(255,107,107,0.9)" />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}

          {/* Optimize waypoints — nearest-neighbour TSP reorder */}
          {waypoints.length >= 2 && (
            <TouchableOpacity
              style={styles.optimizeBtn}
              onPress={() => {
                const coords: [number, number] = userCoordsRef.current ?? [MAP_CENTER.longitude, MAP_CENTER.latitude];
                const optimized = optimizeWaypointOrder(coords, waypoints);
                setWaypoints(optimized);
                waypointsRef.current = optimized;
                if (destinationRef.current) {
                  navigateTo(destinationRef.current, destinationNameRef.current, optimized);
                }
              }}
            >
              <Text style={styles.optimizeBtnText}>⚡ Оптимизирай спирките</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[
              styles.startBtn,
              navigating && styles.startBtnActive,
              !navigating && !gpsReady && styles.startBtnDisabled,
            ]}
            onPress={navigating ? handleStopNav : (gpsReady ? handleStart : undefined)}
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

      {/* ── Tilt controls (bottom-right, browse mode only) ── */}
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
            <Text style={styles.tiltBtnTxt}>⛰️</Text>
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
            <Text style={styles.tiltBtnTxt}>🗺️</Text>
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

      {/* ── Gemini FAB (bottom-left) — free chat + apps ── */}
      <TouchableOpacity
        style={[
          styles.geminiLeftFab,
          { bottom: insets.bottom + spacing.xl },
          backendOnline ? styles.geminiFabOnline : styles.geminiFabOffline,
        ]}
        onPress={() => {
          setGeminiChatOpen(v => !v);
          setGptChatOpen(false);
        }}
        activeOpacity={0.85}
      >
        <Text style={styles.geminiFabEmoji}>{geminiChatOpen ? '✕' : '💬'}</Text>
      </TouchableOpacity>

      {/* ── GPT-4o FAB (bottom-right) — navigation ── */}
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
        {/* Online dot */}
        <View style={[styles.onlineDot, backendOnline ? styles.onlineDotGreen : styles.onlineDotGrey]} />
      </TouchableOpacity>

      {/* ── GPT-4o chat panel (navigation) ── */}
      {gptChatOpen && (
        <View style={[styles.chatPanel, { bottom: insets.bottom + 80 + kbHeight }]}>
          <ScrollView
            style={styles.chatMessages}
            contentContainerStyle={styles.chatMessagesContent}
            keyboardShouldPersistTaps="handled"
          >
            {gptHistory.length === 0 && (
              <Text style={styles.chatPlaceholder}>
                Навигация: маршрути, паркинг, горива, камери...
              </Text>
            )}
            {gptHistory.map((msg, i) => (
              <View
                key={i}
                style={[
                  styles.chatBubble,
                  msg.role === 'user' ? styles.chatBubbleUser : styles.chatBubbleModel,
                ]}
              >
                <Text style={styles.chatBubbleText}>{parseBubbleText(msg.text)}</Text>
              </View>
            ))}
            {gptLoading && (
              <ActivityIndicator size="small" color={colors.accent} style={{ marginTop: 8 }} />
            )}
          </ScrollView>
          <View style={styles.chatInputRow}>
            <TouchableOpacity
              style={[
                styles.chatMicBtn,
                isRecording && styles.chatMicBtnRecording,
                (gptLoading || micLoading) && { opacity: 0.4 },
              ]}
              onPressIn={handleMicStart}
              onPressOut={handleMicStop}
              disabled={gptLoading || micLoading}
              activeOpacity={0.75}
            >
              {micLoading
                ? <ActivityIndicator size="small" color="#ff3b3b" />
                : <Text style={styles.chatMicText}>{isRecording ? '⏹' : '🎙'}</Text>
              }
            </TouchableOpacity>
            <TextInput
              style={styles.chatInput}
              value={chatInput}
              onChangeText={setChatInput}
              placeholder="Съобщение..."
              placeholderTextColor={colors.textMuted}
              onSubmitEditing={handleChat}
              returnKeyType="send"
              editable={!gptLoading}
            />
            <TouchableOpacity
              style={[styles.chatSendBtn, gptLoading && { opacity: 0.4 }]}
              onPress={handleChat}
              disabled={gptLoading}
            >
              <Text style={styles.chatSendText}>➤</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Gemini chat panel (free chat + apps) ── */}
      {geminiChatOpen && (
        <View style={[styles.chatPanel, { bottom: insets.bottom + 80 + kbHeight }]}>
          <ScrollView
            style={styles.chatMessages}
            contentContainerStyle={styles.chatMessagesContent}
            keyboardShouldPersistTaps="handled"
          >
            {geminiHistory.length === 0 && (
              <Text style={styles.chatPlaceholder}>
                Питай Gemini или кажи 'отвори YouTube'...
              </Text>
            )}
            {geminiHistory.map((msg, i) => (
              <View
                key={i}
                style={[
                  styles.chatBubble,
                  msg.role === 'user' ? styles.chatBubbleUser : styles.chatBubbleModel,
                ]}
              >
                <Text style={styles.chatBubbleText}>{parseBubbleText(msg.text)}</Text>
              </View>
            ))}
            {geminiLoading && (
              <ActivityIndicator size="small" color={colors.accent} style={{ marginTop: 8 }} />
            )}
          </ScrollView>
          <View style={styles.chatInputRow}>
            <TouchableOpacity
              style={[
                styles.chatMicBtn,
                isRecording && styles.chatMicBtnRecording,
                (geminiLoading || micLoading) && { opacity: 0.4 },
              ]}
              onPressIn={handleMicStart}
              onPressOut={handleMicStop}
              disabled={geminiLoading || micLoading}
              activeOpacity={0.75}
            >
              {micLoading
                ? <ActivityIndicator size="small" color="#ff3b3b" />
                : <Text style={styles.chatMicText}>{isRecording ? '⏹' : '🎙'}</Text>
              }
            </TouchableOpacity>
            <TextInput
              style={styles.chatInput}
              value={chatInput}
              onChangeText={setChatInput}
              placeholder="Питай Gemini..."
              placeholderTextColor={colors.textMuted}
              onSubmitEditing={handleChat}
              returnKeyType="send"
              editable={!geminiLoading}
            />
            <TouchableOpacity
              style={[styles.chatSendBtn, geminiLoading && { opacity: 0.4 }]}
              onPress={handleChat}
              disabled={geminiLoading}
            >
              <Text style={styles.chatSendText}>➤</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

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
    shadowOpacity: 0.95,
    shadowRadius: 8,
  },
  mapBtnOff: { opacity: 0.4 },
  mapBtnText: { fontSize: 20 },

  // Navigation top panel — wrapper handles absolute positioning for both
  // simple banner (>800 m) and the junction sign panel (<800 m)
  signWrap: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    zIndex: 20,
  },
  navBanner: {
    backgroundColor: 'rgba(0,10,30,0.88)',
    borderRadius: 50,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    elevation: 14,
    borderWidth: 2,
    borderColor: NEON,
    shadowColor: NEON,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.90,
    shadowRadius: 10,
  },
  navArrow: { fontSize: 36, marginRight: spacing.md },
  navBannerBody: { flex: 1 },
  navStreet: { fontSize: 18, fontWeight: '700', color: colors.text },
  navNext: { ...typography.caption, color: colors.textSecondary, marginTop: 3 },

  // Lane Assistance — enlarged road-style lane boxes
  laneAssistWrap: { marginTop: 6, alignItems: 'center' },
  laneAssistLabel: {
    fontSize: 9,
    color: 'rgba(0,191,255,0.70)',
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 3,
    textTransform: 'uppercase',
  },
  laneRow: { flexDirection: 'row', gap: 4, alignSelf: 'center' },
  laneBox: {
    width: 36,
    height: 48,
    backgroundColor: 'rgba(10, 15, 30, 0.85)',
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  laneBoxActive: {
    backgroundColor: 'rgba(0,191,255,0.28)',
    borderColor: NEON,
    borderWidth: 2.5,
  },
  laneArrow: { fontSize: 20, opacity: 0.30 },
  laneArrowActive: { opacity: 1 },

  // Sygic-style absolute lane strip — bottom of screen, < 350 m from turn
  laneStrip: {
    position: 'absolute',
    bottom: 210,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 4,
    backgroundColor: 'rgba(0,8,20,0.88)',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: NEON,
    paddingHorizontal: 10,
    paddingVertical: 6,
    shadowColor: NEON,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 10,
    elevation: 18,
    zIndex: 20,
  },
  laneSCell: {
    width: 40,
    height: 52,
    borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  laneSCellActive: {
    // backgroundColor + shadowOpacity are animated via laneGlowBg / laneGlowShadow
    borderColor: NEON,
    borderWidth: 3,
    shadowColor: NEON,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 14,
    elevation: 10,
    transform: [{ scale: 1.10 }],   // 3D "pop out" — active lane appears closer
  },
  laneSCellArrow:       { fontSize: 22, opacity: 0.35 },
  laneSCellArrowActive: { fontSize: 22, opacity: 1 },

  // Truck geometry badge — amber pill showing active routing constraints
  truckDimRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
    justifyContent: 'center',
  },
  truckDimBadge: {
    backgroundColor: 'rgba(255,170,0,0.12)',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.6)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    shadowColor: NEON,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
  },
  truckDimText: { fontSize: 10, color: '#ffaa00', fontWeight: '600' },
  adrBadge: {
    borderColor: '#ff8c00',
    backgroundColor: 'rgba(255,140,0,0.18)',
    shadowColor: '#ff8c00',
    shadowOpacity: 0.8,
    shadowRadius: 6,
  },

  // ── Tilequery UI ────────────────────────────────────────────────────────────

  // Elevation chip — floating, bottom-left
  elevationChip: {
    position: 'absolute',
    left: spacing.md,
    backgroundColor: 'rgba(0,20,40,0.82)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.35)',
    paddingHorizontal: 9,
    paddingVertical: 3,
    zIndex: 15,
  },
  elevationText: { fontSize: 11, color: NEON, fontWeight: '700', letterSpacing: 0.5 },

  // Tunnel / bridge warning banner — full-width amber strip
  tunnelWarnBanner: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 30,
    backgroundColor: 'rgba(220, 100, 0, 0.93)',
    paddingVertical: 7,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  tunnelWarnText: { fontSize: 13, color: '#fff', fontWeight: '700', textAlign: 'center' },

  // Auto-parking toast — card that slides up when stationary
  autoParkToast: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    backgroundColor: 'rgba(0,8,24,0.95)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.25)',
    padding: spacing.sm,
    zIndex: 25,
  },
  autoParkHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  autoParkTitle: { fontSize: 12, color: NEON, fontWeight: '700' },
  autoParkClose: { fontSize: 14, color: colors.textSecondary, paddingHorizontal: 4 },
  autoParkItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  autoParkName: { flex: 1, fontSize: 12, color: colors.text, marginRight: 8 },
  autoParkDist: { fontSize: 11, color: NEON, fontWeight: '600' },

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
  starPin: {
    alignItems: 'center' as const,
    backgroundColor: 'rgba(255,215,0,0.15)',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#ffd700',
    padding: 3,
    shadowColor: '#ffd700',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 8,
  },
  starPinEmoji: { fontSize: 22 },

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
  poiCardSAR: {
    borderColor: '#ff8c00',
    shadowColor: '#ff8c00',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 6,
  },

  // Parking cards panel (from GPT-4o show_parking action)
  parkingPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 19,
    backgroundColor: '#091529',          // тъмно синьо header strip
    paddingBottom: 8,
    borderTopWidth: 1.5,
    borderTopColor: '#1a8fd1',
  },
  parkingPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  parkingPanelTitle: {
    ...typography.label,
    color: '#60c0ff',                    // светло синьо заглавие
    fontWeight: '800',
    fontSize: 13,
  },
  parkingDismissBtn: { padding: 4 },
  parkingDismissTxt: { color: colors.textSecondary, fontSize: 14 },
  parkingListContent: { paddingHorizontal: spacing.sm, paddingBottom: spacing.xs },
  parkingCard: {
    backgroundColor: '#0d1e3d',          // тъмно синьо, плътно
    borderRadius: radius.md,
    padding: spacing.sm,
    marginRight: spacing.sm,
    width: 170,
    borderWidth: 2,
    borderColor: '#1a8fd1',              // синя рамка
    elevation: 12,
    shadowColor: '#1a8fd1',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.70,
    shadowRadius: 8,
  },
  parkingCardName: {
    ...typography.label,
    color: colors.text,
    fontWeight: '700',
    fontSize: 12,
    marginBottom: 3,
  },
  parkingCardDist: {
    ...typography.label,
    color: NEON,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 5,
  },
  parkingBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 3, marginBottom: 5 },
  parkingBadge: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  parkingBadgePaid: { backgroundColor: 'rgba(239,68,68,0.15)' },
  parkingBadgeFree: { backgroundColor: 'rgba(34,197,94,0.15)' },
  parkingBadgeTxt: { color: colors.text, fontSize: 9 },
  parkingHours: {
    ...typography.label,
    color: colors.textMuted,
    fontSize: 9,
    marginBottom: 6,
  },
  parkingPin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,191,255,0.12)',
    borderWidth: 1.5,
    borderColor: NEON,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: NEON,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
  },
  parkingPinText: { fontSize: 16 },

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

  speedCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#fff',
    borderWidth: 5,
    borderColor: '#e00000',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.55,
    shadowRadius: 5,
    elevation: 12,
  },
  speedCircleExceeded: {
    borderColor: '#ff0000',
    backgroundColor: '#fff8f8',
    shadowColor: '#ff0000',
    shadowOpacity: 1,
    shadowRadius: 14,
  },
  speedCircleNum: {
    fontSize: 21,
    fontWeight: '900',
    color: '#111',
    letterSpacing: -0.5,
  },

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

  // Tilt controls column (bottom-right)
  tiltBtnCol: {
    position: 'absolute',
    right: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
    zIndex: 20,
  },
  tiltBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: NEON_DIM,
    borderWidth: 1.5,
    borderColor: NEON,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 10,
    shadowColor: NEON,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 6,
  },
  tiltBtnTxt: { fontSize: 18 },

  // Gemini FAB (bottom-left) — free chat + apps
  geminiLeftFab: {
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

  // GPT-4o FAB (bottom-right) — navigation
  geminiFab: {
    position: 'absolute',
    right: spacing.md,
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
  chatMicBtn: {
    width: 40,
    height: 40,
    borderRadius: 50,
    backgroundColor: 'rgba(255,59,59,0.10)',
    borderWidth: 1.5,
    borderColor: '#ff3b3b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatMicBtnRecording: {
    backgroundColor: 'rgba(255,59,59,0.35)',
    borderColor: '#ff0000',
    shadowColor: '#ff0000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 8,
  },
  chatMicText: { fontSize: 18 },

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

  // ── Fuel cards panel ─────────────────────────────────────────────────────
  fuelPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 19,
  },
  fuelPanelTitle: {
    ...typography.label,
    color: '#00ff88',
    fontWeight: '700',
    fontSize: 12,
  },
  fuelCard: {
    backgroundColor: 'rgba(0,60,20,0.22)',
    borderRadius: radius.md,
    padding: spacing.sm,
    marginRight: spacing.sm,
    width: 165,
    borderWidth: 2,
    borderColor: '#00ff88',
    elevation: 12,
    shadowColor: '#00ff88',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
  },
  fuelCardName: {
    ...typography.label,
    color: colors.text,
    fontWeight: '700',
    fontSize: 12,
    marginBottom: 3,
  },
  fuelCardBrand: {
    ...typography.label,
    color: '#00ff88',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 2,
  },
  fuelCardDist: {
    ...typography.label,
    color: NEON,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 5,
  },
  fuelBadge: {
    backgroundColor: 'rgba(0,255,136,0.12)',
    borderRadius: radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 2,
    marginBottom: 3,
    alignSelf: 'flex-start',
  },
  fuelBadgeTruck: {
    backgroundColor: 'rgba(0,191,255,0.12)',
    borderRadius: radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 2,
    marginBottom: 3,
    alignSelf: 'flex-start',
  },
  fuelBadgeTxt: { color: colors.text, fontSize: 9 },
  fuelHours: { ...typography.label, color: colors.textMuted, fontSize: 9, marginBottom: 4 },
  fuelGoTxt: { color: '#00ff88', fontWeight: '800', fontSize: 12, marginTop: 4 },

  // Fuel pins on map
  fuelPin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(245,158,11,0.12)',
    borderWidth: 1.5,
    borderColor: '#f59e0b',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#f59e0b',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
  },
  fuelPinText: { fontSize: 16 },

  // Speed camera pins on map
  cameraPin: {
    backgroundColor: 'rgba(30,0,0,0.9)',
    borderRadius: radius.sm,
    padding: 4,
    borderWidth: 1.5,
    borderColor: '#ff3b3b',
    alignItems: 'center',
  },
  cameraPinText: { fontSize: 14 },
  cameraPinSpeed: {
    color: '#ff3b3b',
    fontSize: 8,
    fontWeight: '800',
    marginTop: 1,
  },

  // ── Route options panel ───────────────────────────────────────────────────
  routeOptionsPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,8,20,0.94)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderTopWidth: 1.5,
    borderColor: '#00bfff',
    elevation: 20,
    zIndex: 30,
  },
  routeOptionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
  },
  routeOptionsTitle: {
    ...typography.label,
    color: NEON,
    fontWeight: '700',
    fontSize: 13,
  },
  routeOptionsContent: { paddingHorizontal: spacing.sm, gap: spacing.sm },
  routeOptionCard: {
    backgroundColor: 'rgba(10,20,40,0.95)',
    borderRadius: radius.md,
    padding: spacing.md,
    width: 160,
    borderWidth: 2,
    elevation: 8,
  },
  routeOptionDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginBottom: spacing.xs,
  },
  routeOptionLabel: {
    ...typography.label,
    color: colors.text,
    fontWeight: '700',
    fontSize: 12,
    marginBottom: 4,
  },
  routeOptionDist: {
    ...typography.label,
    color: NEON,
    fontSize: 13,
    fontWeight: '800',
  },
  routeOptionDur: {
    ...typography.label,
    color: colors.textSecondary,
    fontSize: 11,
    marginTop: 2,
  },
  routeOptionTap: {
    color: NEON,
    fontSize: 11,
    fontWeight: '700',
    marginTop: spacing.sm,
    textAlign: 'right',
  },
  routeOptionCardSelected: {
    borderWidth: 2.5,
    backgroundColor: 'rgba(0,191,255,0.14)',
    shadowColor: NEON,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.75,
    shadowRadius: 8,
    elevation: 14,
  },
  routeOptionTraffic: {
    fontSize: 10,
    fontWeight: '700',
    color: '#00ff88',
    marginTop: 3,
  },
  routeSelectedSummary: {
    paddingTop: spacing.xs,
    paddingHorizontal: spacing.md,
    gap: 4,
  },
  routeRestrictionWarn: {
    color: '#ffcc00',
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 16,
  },
  routeStartBtn: {
    backgroundColor: NEON_DIM,
    borderWidth: 1.5,
    borderColor: NEON,
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 28,
    alignSelf: 'center',
    marginTop: spacing.xs,
    shadowColor: NEON,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
    elevation: 12,
  },
  routeStartBtnTxt: { color: NEON, fontSize: 15, fontWeight: '800' },

  // Origin active badge — shown below SearchBar when custom origin is set
  originActiveBadge: {
    marginTop: 4,
    backgroundColor: 'rgba(0,191,255,0.12)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.45)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  originActiveTxt: { color: NEON, fontSize: 11, fontWeight: '600' },

  // ── Tachograph card ──────────────────────────────────────────────────────
  tachPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 19,
  },
  tachTitle: {
    ...typography.label,
    color: '#ffcc00',
    fontWeight: '700',
    fontSize: 12,
  },
  tachCard: {
    marginHorizontal: spacing.md,
    marginTop: spacing.xs,
    backgroundColor: 'rgba(30,20,0,0.88)',
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 2,
    borderColor: '#ffcc00',
  },
  tachRow: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
  },
  tachWarn: {
    color: '#ff3b3b',
    fontWeight: '800',
  },
  tachOk: {
    color: '#4cff91',
    fontWeight: '700',
  },
  tachDivider: {
    height: 1,
    backgroundColor: 'rgba(0,191,255,0.2)',
    marginVertical: 6,
  },
  tachStopBtn: {
    marginTop: spacing.xs,
    backgroundColor: 'rgba(255,204,0,0.18)',
    borderRadius: radius.sm,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: '#ffcc00',
    alignSelf: 'flex-start',
  },
  tachStopTxt: {
    color: '#ffcc00',
    fontWeight: '800',
    fontSize: 12,
  },

  // ── Business / place results panel ───────────────────────────────────────
  bizPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 19,
  },
  bizPanelTitle: {
    ...typography.label,
    color: '#00e5ff',
    fontWeight: '700',
    fontSize: 12,
  },
  bizCard: {
    backgroundColor: 'rgba(0,40,60,0.92)',
    borderRadius: radius.md,
    padding: spacing.sm,
    marginRight: spacing.sm,
    width: 175,
    borderWidth: 2,
    borderColor: '#00e5ff',
    elevation: 12,
    shadowColor: '#00e5ff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 8,
  },
  bizCardName: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 3,
  },
  bizCardDist: {
    color: '#00e5ff',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 3,
  },
  bizCardAddr: {
    color: colors.textSecondary,
    fontSize: 10,
    marginBottom: 4,
  },
  bizGoTxt: {
    color: '#00e5ff',
    fontWeight: '800',
    fontSize: 12,
    marginTop: 4,
  },
  bizPin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,229,255,0.1)',
    borderWidth: 1.5,
    borderColor: '#00e5ff',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#00e5ff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 6,
  },
  bizPinText: { fontSize: 18 },
  bizCardPhoto: {
    width: '100%' as const,
    height: 80,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(0,20,40,0.6)',
    marginBottom: 6,
  },
  bizCardClosed: {
    opacity: 0.7,
    borderColor: '#ff6b35',
  },
  bizClosedBadge: {
    backgroundColor: 'rgba(255,107,53,0.18)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginBottom: 4,
  },
  bizClosedBadgeTxt: {
    color: '#ff6b35',
    fontSize: 10,
    fontWeight: '700' as const,
  },
  bizReviewSummary: {
    color: colors.textSecondary,
    fontSize: 10,
    fontStyle: 'italic' as const,
    lineHeight: 14,
    marginTop: 4,
  },

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
    shadowOpacity: 0.85,
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

  // ── SAR (Search Along Route) ────────────────────────────────────────────────
  sarRowLabel: {
    color: NEON,
    fontSize: 10,
    fontWeight: '800' as const,
    letterSpacing: 1.2,
    marginRight: 6,
    alignSelf: 'center',
  },
  sarBtnActive: {
    borderColor: '#ff8c00',
    backgroundColor: 'rgba(255,140,0,0.20)',
    elevation: 8,
    shadowColor: '#ff8c00',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
  },
  sarHeaderBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    alignSelf: 'flex-start' as const,
    backgroundColor: 'rgba(0,8,20,0.90)',
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#ff8c00',
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 6,
    marginLeft: spacing.md,
    elevation: 10,
    shadowColor: '#ff8c00',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 8,
  },
  sarHeaderTxt: {
    color: '#ff8c00',
    fontSize: 11,
    fontWeight: '700' as const,
  },

  // ── Waypoint map pins ─────────────────────────────────────────────────────
  waypointPin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,140,0,0.18)',
    borderWidth: 2,
    borderColor: '#ff8c00',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: '#ff8c00',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 6,
  },
  waypointPinBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#ff8c00',
    borderRadius: 8,
    width: 16,
    height: 16,
    fontSize: 10,
    fontWeight: '800',
    color: '#fff',
    textAlign: 'center',
    lineHeight: 16,
  },

  // ── Long-press popup — Glassmorphism card ────────────────────────────────
  longPressPopup: {
    position: 'absolute',
    bottom: 150,
    alignSelf: 'center',
    // Glassmorphism base
    backgroundColor: 'rgba(6, 12, 35, 0.85)',
    borderRadius: 18,
    padding: 16,
    paddingTop: 12,
    zIndex: 50,
    elevation: 32,
    minWidth: 270,
    // Neon border glow
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.45)',
    // Outer glow
    shadowColor: NEON,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.75,
    shadowRadius: 14,
  },
  longPressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  longPressTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
    letterSpacing: 0.3,
  },
  longPressCoords: {
    color: 'rgba(0,191,255,0.55)',
    fontSize: 10,
    marginBottom: 14,
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  longPressBtns: {
    flexDirection: 'row',
    gap: 10,
  },
  // Navigate button — neon blue glass pill
  longPressBtn: {
    flex: 1,
    backgroundColor: 'rgba(0,191,255,0.18)',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: NEON,
    paddingVertical: 10,
    paddingHorizontal: 12,
    elevation: 4,
    shadowColor: NEON,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
  },
  // Waypoint button — orange glass pill
  longPressBtnWaypoint: {
    backgroundColor: 'rgba(255,140,0,0.18)',
    borderColor: '#ff8c00',
    shadowColor: '#ff8c00',
  },
  longPressBtnStar: {
    backgroundColor: 'rgba(255,215,0,0.18)',
    borderColor: '#ffd700',
    shadowColor: '#ffd700',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 6,
  },
  longPressBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  longPressBtnTxt: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 0.3,
  },
  longPressCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Waypoint strip (bottom panel) ─────────────────────────────────────────
  waypointStrip: {
    maxHeight: 42,
    marginBottom: 10,
  },
  waypointStripContent: {
    paddingHorizontal: 4,
    gap: 8,
    alignItems: 'center',
  },
  waypointChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,140,0,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,140,0,0.5)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 4,
    elevation: 3,
    shadowColor: '#ff8c00',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  waypointChipText: {
    color: '#ffaa44',
    fontSize: 12,
    fontWeight: '600',
    maxWidth: 120,
  },
  waypointChipRemove: {
    color: 'rgba(255,107,107,0.85)',
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 4,
  },
  waypointChipRemoveBtn: {
    marginLeft: 2,
  },
  optimizeBtn: {
    backgroundColor: 'rgba(0,191,255,0.15)',
    borderWidth: 1.5,
    borderColor: NEON,
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 14,
    alignSelf: 'center',
    marginTop: 6,
    shadowColor: NEON,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 8,
    elevation: 6,
  },
  optimizeBtnText: { color: NEON, fontSize: 13, fontWeight: '700' },

  // ── Shared "Go" button for POI cards ─────────────────────────────────────
  goBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: NEON,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 12,
    marginTop: 8,
  },
  goBtnFuel: {
    backgroundColor: '#f59e0b',
  },
  goBtnTxt: {
    color: '#0a0c1c',
    fontWeight: '700',
    fontSize: 12,
  },

  // ── Interactive parking bubble (floating over map) ────────────────────────
  parkingBubble: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    backgroundColor: '#0d1e3d',          // тъмно синьо, напълно плътно
    borderRadius: 14,
    borderWidth: 2.5,
    borderColor: '#1a8fd1',              // синя рамка
    padding: 13,
    shadowColor: '#1a8fd1',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.90,
    shadowRadius: 14,
    elevation: 22,
  },
  parkingBubbleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  parkingBubbleName: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
    marginRight: 8,
  },
  parkingBubbleClose: { padding: 2 },
  parkingBubbleCloseTxt: { color: 'rgba(255,255,255,0.5)', fontSize: 15 },
  parkingBubbleDist: {
    color: NEON,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
  },
  parkingBubbleBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: 10,
  },
  pkBadge: {
    backgroundColor: 'rgba(26,143,209,0.20)',   // синкав badge
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(26,143,209,0.45)',
  },
  pkBadgePaid: { backgroundColor: 'rgba(239,68,68,0.22)', borderColor: 'rgba(239,68,68,0.5)' },
  pkBadgeFree: { backgroundColor: 'rgba(34,197,94,0.22)', borderColor: 'rgba(34,197,94,0.5)' },
  pkBadgeTxt: { color: '#e8f4ff', fontSize: 10, fontWeight: '700' },
  parkingBubbleBtns: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  parkingBubbleNavBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: NEON,
    borderRadius: 8,
    paddingVertical: 8,
  },
  parkingBubbleNavBtnTxt: { color: '#0a0c1c', fontWeight: '800', fontSize: 13 },
  parkingBubbleWebBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,191,255,0.12)',
    borderWidth: 1.5,
    borderColor: NEON,
    borderRadius: 8,
    paddingVertical: 8,
  },
  parkingBubbleWebBtnTxt: { color: NEON, fontWeight: '700', fontSize: 12 },
  parkingBubbleTtsBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Parking card action row ───────────────────────────────────────────────
  parkingCardActions: {
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
    marginTop: 'auto' as any,
  },
  parkingGoBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: NEON,
    borderRadius: 6,
    paddingVertical: 5,
  },
  parkingGoBtnTxt2: { color: '#0a0c1c', fontWeight: '800', fontSize: 10 },
  parkingWebBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,191,255,0.10)',
    borderWidth: 1.5,
    borderColor: NEON,
    borderRadius: 6,
    paddingVertical: 5,
  },
  parkingWebBtnTxt: { color: NEON, fontWeight: '700', fontSize: 10 },
  parkingTtsBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Selected parking pin highlight ───────────────────────────────────────
  parkingPinSelected: {
    backgroundColor: 'rgba(255,59,59,0.25)',
    borderColor: '#ff3b3b',
    borderWidth: 2.5,
    shadowColor: '#ff3b3b',
    shadowOpacity: 0.9,
    shadowRadius: 8,
  },

  // ── Dev tools inside ⚙️ options panel ─────────────────────────────────────
  optionsDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.10)',
    marginVertical: 4,
  },
  devRowLabel: {
    color: 'rgba(255,255,255,0.30)',
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 1.5,
    alignSelf: 'center',
    marginLeft: 4,
  },

  // ── Gemini Connect button in options panel ─────────────────────────────────
  geminiConnectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(0,191,255,0.10)',
    borderWidth: 1.5,
    borderColor: 'rgba(0,191,255,0.45)',
    marginVertical: 2,
    shadowColor: NEON,
    shadowOpacity: 0.55,
    shadowRadius: 6,
  },
  geminiConnectEmoji: { fontSize: 18 },
  geminiConnectLabel: {
    flex: 1,
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  geminiDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4cff91',
    shadowColor: '#4cff91',
    shadowOpacity: 1,
    shadowRadius: 4,
  },
  // kept for state-highlight reuse
  simBtnActive: {
    borderColor: '#ff4444',
    backgroundColor: 'rgba(255,30,30,0.18)',
    shadowColor: '#ff4444',
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },
  simBtnDebug: {
    borderColor: '#ffaa00',
    backgroundColor: 'rgba(255,170,0,0.18)',
    shadowColor: '#ffaa00',
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },

  // ── Visual Debug Overlay ──────────────────────────────────────────────────
  debugOverlay: {
    position: 'absolute',
    left: spacing.md,
    backgroundColor: 'rgba(0,4,12,0.92)',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#ffaa00',
    paddingHorizontal: 10,
    paddingVertical: 8,
    zIndex: 25,
    minWidth: 190,
    shadowColor: '#ffaa00',
    shadowOpacity: 0.7,
    shadowRadius: 8,
    elevation: 20,
  },
  debugTitle: {
    color: '#ffaa00',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginBottom: 5,
  },
  debugRow: { color: '#e0e8ff', fontSize: 11, fontWeight: '600', marginBottom: 2 },
  debugLaneTestBtn: {
    marginTop: 6, paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 8, borderWidth: 1.5, borderColor: 'rgba(0,191,255,0.5)',
    backgroundColor: 'rgba(0,191,255,0.08)',
  },
  debugLaneTestBtnOn: {
    borderColor: NEON,
    backgroundColor: 'rgba(0,191,255,0.30)',
    shadowColor: NEON, shadowOpacity: 0.8, shadowRadius: 6, elevation: 6,
  },
  debugLaneTestTxt: { color: NEON, fontSize: 11, fontWeight: '800' },

  // ── Live Speedometer Ring (replaces speedBox) ─────────────────────────────
  speedRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 5,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,10,25,0.92)',
    elevation: 12,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 10,
    shadowOpacity: 0.85,
  },
  speedRingGreen:  { borderColor: '#00e676', shadowColor: '#00e676' },
  speedRingYellow: { borderColor: '#ffcc00', shadowColor: '#ffcc00' },
  speedRingRed:    { borderColor: '#ff1744', shadowColor: '#ff1744' },

  // ── Speed Camera HUD ──────────────────────────────────────────────────────
  cameraHUD: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: 2.5,
    paddingHorizontal: 16,
    paddingVertical: 10,
    elevation: 22,
    zIndex: 30,
    shadowColor: '#ff0000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.95,
    shadowRadius: 14,
  },
  cameraHUDIcon:  { fontSize: 30 },
  cameraHUDDist:  { fontSize: 22, fontWeight: '900', color: '#fff', letterSpacing: -0.5 },
  cameraHUDLabel: { fontSize: 9,  fontWeight: '800', color: 'rgba(255,180,180,0.85)', letterSpacing: 1.8 },

  // ── Elevation Profile bar chart ───────────────────────────────────────────
  elevProfileStrip: {
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  elevProfileLabel: {
    fontSize: 9,
    color: 'rgba(0,191,255,0.75)',
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: 4,
    textAlign: 'center',
  },
  elevProfileBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: 32,
    paddingHorizontal: 4,
  },
  elevBar: {
    flex: 1,
    borderRadius: 2,
    backgroundColor: 'rgba(0,191,255,0.50)',
    minHeight: 4,
  },

  // ── Weather strip in bottom panel ─────────────────────────────────────────
  weatherStrip: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  weatherChip: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,8,20,0.65)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.30)',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  weatherChipEmoji: { fontSize: 18 },
  weatherChipTemp:  { fontSize: 10, color: NEON, fontWeight: '700', marginTop: 1 },

  // ── Weather markers on map ────────────────────────────────────────────────
  weatherPin: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,8,20,0.82)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.45)',
    paddingHorizontal: 5,
    paddingVertical: 3,
    elevation: 6,
    shadowColor: NEON,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 5,
  },
  weatherPinEmoji: { fontSize: 16 },
  weatherPinTemp:  { fontSize: 9, color: NEON, fontWeight: '700' },
});
