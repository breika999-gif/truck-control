import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  TouchableOpacity,
  Text,
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  ScrollView,
} from 'react-native';
import Tts from 'react-native-tts';
import Mapbox, { locationManager } from '@rnmapbox/maps';
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

type MapNavProp = NativeStackNavigationProp<RootStackParamList, 'Map'>;

Mapbox.setAccessToken(MAPBOX_PUBLIC_TOKEN);

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
  cameraRef: React.RefObject<Mapbox.Camera | null>;
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
      followZoomLevel={17}
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

  // Map style — satellite-streets by default (fixes VectorSource SoftException
  // by embedding traffic via style URL instead of a separate VectorSource layer)
  const [satellite, setSatellite] = useState(true);
  const [mapIsLoaded, setMapIsLoaded] = useState(false);
  const [showTraffic, setShowTraffic] = useState(true);

  // Voice
  const [voiceMuted, setVoiceMuted] = useState(false);
  const voiceMutedRef     = useRef(false);
  const lastSpokenStepRef = useRef(-1);

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

  // ── Runtime location permission + eager GPS warm-up (Android 6+) ─────────
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      {
        title: 'Разрешение за местоположение',
        message: 'TruckExpoAI се нуждае от GPS за навигация.',
        buttonPositive: 'Разреши',
        buttonNegative: 'Откажи',
      },
    ).then(status => {
      // Pre-warm GPS hardware immediately after permission is granted.
      // locationManager.start() wakes up the location engine before the map
      // renders — gives Google Maps-like fast first fix.
      if (status === PermissionsAndroid.RESULTS.GRANTED) {
        locationManager.start();
      }
    });
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

  const navigatingRef   = useRef(false);
  const routeRef        = useRef<RouteResult | null>(null);
  const userCoordsRef   = useRef<[number, number] | null>(null);
  const destinationRef  = useRef<[number, number] | null>(null);
  const profileRef      = useRef<VehicleProfile | null>(null);
  const lastRerouteRef  = useRef<number>(0);

  useEffect(() => { navigatingRef.current  = navigating;   }, [navigating]);
  useEffect(() => { routeRef.current       = route;        }, [route]);
  useEffect(() => { userCoordsRef.current  = userCoords;   }, [userCoords]);
  useEffect(() => { destinationRef.current = destination;  }, [destination]);
  useEffect(() => { profileRef.current     = profile;      }, [profile]);

  // ── GPS location handler (stable — empty deps, reads via refs) ────────────

  const handleUserLocation = useCallback((loc: Mapbox.Location) => {
    const coords: [number, number] = [loc.coords.longitude, loc.coords.latitude];
    userCoordsRef.current = coords;
    setUserCoords(coords);
    setGpsReady(true);

    const spd = loc.coords.speed ?? -1;
    const kmh = spd > 0 ? spd * 3.6 : 0;
    setSpeed(Math.round(kmh));

    // Update driving state for HOS timer
    isDrivingRef.current = kmh > 3;

    const isNav = navigatingRef.current;
    const cur   = routeRef.current;
    if (!isNav || !cur) return;

    // Speed limit
    setSpeedLimit(
      getSpeedLimitAtPosition(cur.geometry.coordinates, cur.maxspeeds, coords),
    );

    // Current step
    const stepIdx = getCurrentStepIndex(cur.steps, coords);
    setCurrentStep(stepIdx);

    // Distance to next turn — straight line to next step's first intersection
    const nextLoc = cur.steps[stepIdx + 1]?.intersections?.[0]?.location;
    setDistToTurn(nextLoc ? haversineMeters(coords, nextLoc) : null);

    // ── Auto re-route when > 50 m off route (30-second cooldown) ────────────
    const now = Date.now();
    if (now - lastRerouteRef.current < 30_000) return;

    let minDist = Infinity;
    const routeCoords = cur.geometry.coordinates;
    for (let i = 0; i < routeCoords.length; i++) {
      const d = haversineMeters(coords, routeCoords[i] as [number, number]);
      if (d < minDist) minDist = d;
      if (minDist < 50) return; // still on route — early exit
    }

    // Off route — fetch new route from current position
    const dest = destinationRef.current;
    if (!dest) return;

    lastRerouteRef.current = now;
    setRerouting(true);
    const prof = profileRef.current;
    const truck = prof
      ? {
          max_height: prof.height_m,
          max_width: prof.width_m,
          max_weight: prof.weight_t,
          max_length: prof.length_m,
        }
      : undefined;

    fetchRoute(coords, dest, truck)
      .then(result => {
        if (result) {
          routeRef.current = result;
          setRoute(result);
        }
      })
      .catch(() => {/* silent — keep existing route */})
      .finally(() => setRerouting(false));
  }, []); // stable — never recreated

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

      const result = await fetchRoute(origin, dest, truck);
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

  // ETA — clock time of arrival (current time + route duration)
  const eta = useMemo(() => {
    if (!route) return null;
    const arrival = new Date(Date.now() + route.duration * 1000);
    return arrival.toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' });
  }, [route]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>

      {/* ── Map ── */}
      <Mapbox.MapView
        style={styles.map}
        styleURL={mapStyleURL}
        onDidFinishLoadingStyle={() => setMapIsLoaded(true)}
      >
        {/* Always pass followUserMode + followZoomLevel with concrete values.
            Mapbox creates an Animated node for every prop it first receives.
            If a prop appears later its Animated.Value starts as undefined →
            "Animated.timing called on undefined". */}
        <StableCamera cameraRef={cameraRef} navigating={navigating} mapLoaded={mapIsLoaded} />

        {/* androidRenderMode="gps" uses GPS hardware directly for faster fix.
            minDisplacement={0} delivers every position update, no threshold. */}
        <Mapbox.UserLocation
          visible
          onUpdate={handleUserLocation}
          androidRenderMode="gps"
          minDisplacement={0}
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
              style={{ lineColor: colors.accent, lineWidth: 5, lineCap: 'round', lineJoin: 'round' }}
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
          </View>
        </View>
      )}

      {/* ── Right-side button column ── */}
      <View style={[styles.rightBtnCol, { top: searchTop }]}>
        {/* Satellite toggle */}
        <TouchableOpacity
          style={styles.mapBtn}
          onPress={() => {
            setSatellite(v => !v);
            // During active navigation keep mapIsLoaded=true so camera follow
            // is not interrupted. Layers reload via onDidFinishLoadingStyle.
            if (!navigating) setMapIsLoaded(false);
          }}
        >
          <Text style={styles.mapBtnText}>{satellite ? '🌑' : '🛰️'}</Text>
        </TouchableOpacity>

        {/* Traffic toggle — reloads style URL */}
        <TouchableOpacity
          style={[styles.mapBtn, !showTraffic && styles.mapBtnOff]}
          onPress={() => {
            setShowTraffic(v => !v);
            if (!navigating) setMapIsLoaded(false);
          }}
        >
          <Text style={styles.mapBtnText}>🚦</Text>
        </TouchableOpacity>

        {/* Voice mute toggle */}
        <TouchableOpacity
          style={[styles.mapBtn, voiceMuted && styles.mapBtnOff]}
          onPress={() => { setVoiceMuted(v => !v); if (!voiceMuted) Tts.stop(); }}
        >
          <Text style={styles.mapBtnText}>{voiceMuted ? '🔇' : '🔊'}</Text>
        </TouchableOpacity>
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

      {/* ── POI category bar (visible when no active route) ── */}
      {!navigating && !route && (
        <View style={[styles.poiBar, { top: searchTop + 58 }]}>
          {POI_CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat}
              style={[styles.poiCatBtn, poiCategory === cat && styles.poiCatBtnActive]}
              onPress={() => handlePOISearch(cat)}
            >
              <Text style={styles.poiCatEmoji}>{POI_META[cat].emoji}</Text>
              <Text style={styles.poiCatLabel}>{POI_META[cat].label}</Text>
            </TouchableOpacity>
          ))}
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
    right: 60, // keep clear of 44px btn + md margin
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
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
  },
  mapBtnOff: { opacity: 0.4 },
  mapBtnText: { fontSize: 20 },

  // Navigation top panel
  navBanner: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    elevation: 12,
    borderWidth: 1,
    borderColor: colors.border,
    zIndex: 20,
  },
  navArrow: { fontSize: 36, marginRight: spacing.md },
  navBannerBody: { flex: 1 },
  navStreet: { fontSize: 18, fontWeight: '700', color: colors.text },
  navNext: { ...typography.caption, color: colors.textSecondary, marginTop: 3 },

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
    backgroundColor: 'rgba(22,33,62,0.92)',
    borderRadius: radius.sm,
    paddingVertical: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 4,
  },
  poiCatBtnActive: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(79,70,229,0.25)',
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
    backgroundColor: colors.bgSecondary,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    elevation: 16,
    borderTopWidth: 1,
    borderColor: colors.border,
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
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  startBtnActive:   { backgroundColor: colors.error },
  startBtnDisabled: { backgroundColor: colors.bgCard, opacity: 0.6 },
  startBtnText: { ...typography.h3, color: colors.text },

  fab: {
    position: 'absolute',
    right: spacing.md,
    width: 60,
    height: 60,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
  },
  fabEmoji: { fontSize: 26 },
});
