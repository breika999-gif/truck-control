import { useCallback, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { Alert, Linking, Share } from 'react-native';
import Tts from 'react-native-tts';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import type * as GeoJSON from 'geojson';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { MAP_CENTER } from '../../../shared/constants/config';
import type { GoogleAccount } from '../../../shared/services/accountManager';
import {
  checkTruckRestrictions,
  reportCamera,
  fetchReportedCameras,
  searchNearbyParking,
  startRouteLog,
  completeRouteLog,
  type AppIntent,
  type POICard,
  type RouteOption,
  type TachoSummary,
} from '../../../shared/services/backendApi';
import type { RootStackParamList } from '../../../shared/types/navigation';
import type { VehicleProfile } from '../../../shared/types/vehicle';
import i18n from '../../../i18n';
import type { RouteResult } from '../api/directions';
import type { GeoPlace } from '../api/geocoding';
import type { TruckPOI } from '../api/poi';
import type { FasterRouteOffer } from '../hooks/useFasterRouteCheck';
import type { NavPhase, RouteOptDest } from '../hooks/useNavigationState';
import type { RoutePOI } from '../hooks/useRouteInsights';
import type { AITachoResult } from '../hooks/useChatPanelsState';
import type { MapMode } from '../hooks/useMapUIState';
import { buildGPX } from '../utils/gpxUtils';
import {
  APP_URL_MAP,
  getTransParkingUrl,
  ttsSpeak,
} from '../utils/mapUtils';

type Coords = [number, number];
type Setter<T> = Dispatch<SetStateAction<T>>;
type MapNavProp = NativeStackNavigationProp<RootStackParamList, 'Map'>;
type NavigateTo = (
  dest: Coords,
  name: string,
  waypointsArg?: Coords[],
  autoStart?: boolean,
  optimizeWaypoints?: boolean,
) => Promise<void>;

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
    features: alerts.map((a) => ({
      type: 'Feature' as const,
      properties: { label: a.label ?? i18n.t('route.delayMinutes', { minutes: a.delay_min }), severity: a.severity },
      geometry: { type: 'Point' as const, coordinates: [a.lng, a.lat] },
    })),
  };
}

function routeOptionAnalysisKey(option: RouteOption, profile: VehicleProfile): string {
  const coords = option.geometry.coordinates as Coords[];
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

export interface MapHandlers {
  handleEndOfDay: () => Promise<void>;
  handleChat: () => Promise<void>;
  handleMicStart: () => Promise<void>;
  handleMicStop: () => Promise<void>;
  handleWakeCommand: (cmd: string) => void;
  handleAcceptFasterRoute: () => void;
  handleMapLongPress: (event: any) => void;
  handleDestinationSelect: (place: GeoPlace) => void;
  handleStart: (activeRoute?: RouteResult | null) => void;
  handleStopNav: () => void;
  handleClear: () => void;
  handleOriginChange: (place: GeoPlace | null) => void;
  handleSelectRouteOption: (idx: number) => Promise<void>;
  handleUserMapPan: () => void;
  handleAppIntent: (intent: AppIntent) => void;
  handleSearchAlongRoute: () => void;
  handleTunnelWarningDismiss: () => void;
  handlePOINavigate: (poi: TruckPOI) => void;
  handleBizMarkerPress: (business: POICard) => void;
  handleRouteTimelinePOIPress: (poi: RoutePOI) => void;
  handleRestMarkerPress: (coords: Coords) => Promise<void>;
  handleReportCamera: () => Promise<void>;
  handleExportGPX: () => void;
  handleStartRoute: (_cong: any, _alerts: any) => void;
}

interface UseMapHandlersArgs {
  speak: (text: string) => void;
  handleChatState: (
    sendGptText: (text: string) => Promise<void>,
    sendGeminiText: (text: string) => Promise<void>,
    isGptChatOpen: boolean,
  ) => Promise<void>;
  handleMicStartState: (audioRecorderPlayer: typeof AudioRecorderPlayer) => Promise<void>;
  handleMicStopState: (
    audioRecorderPlayer: typeof AudioRecorderPlayer,
    onChat: () => Promise<void>,
  ) => Promise<void>;
  sendGptText: (text: string) => Promise<void>;
  sendGeminiText: (text: string) => Promise<void>;
  sendShiftSummary: (params: {
    drivenH: number;
    distKm: number;
    remainingWeeklyH: number;
    destination?: string;
  }) => Promise<void>;
  gptChatOpen: boolean;
  wakeWordFlashTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  setWakeWordHeard: Setter<boolean>;
  fasterOffer: FasterRouteOffer | null;
  acceptOffer: () => void;
  setRoute: Setter<RouteResult | null>;
  routeRef: MutableRefObject<RouteResult | null>;
  setNavCongestionGeoJSON: Setter<GeoJSON.FeatureCollection | null>;
  setNavTrafficAlerts: Setter<GeoJSON.FeatureCollection | null>;
  setLongPressCoord: Setter<Coords | null>;
  navigateTo: NavigateTo;
  lastSpokenStepRef: MutableRefObject<number>;
  setCurrentStep: Setter<number>;
  setDistToTurn: Setter<number | null>;
  resetSession: () => void;
  mapMode: MapMode;
  setMapMode: Setter<MapMode>;
  setIsTracking: Setter<boolean>;
  setNavPhase: Setter<NavPhase>;
  voiceMutedRef: MutableRefObject<boolean>;
  saveSession: () => void;
  drivingSeconds: number;
  tachoSummary: TachoSummary | null;
  shouldCenterOnIdleGpsRef: MutableRefObject<boolean>;
  setDestination: (dest: Coords | null) => void;
  setDestinationName: (name: string) => void;
  setMapPitch: Setter<number>;
  setSpeedLimit: Setter<number | null>;
  clearPOI: () => void;
  setParkingResults: Setter<POICard[]>;
  setFuelResults: Setter<POICard[]>;
  setCameraResults: Setter<POICard[]>;
  setReportedCameras: Setter<POICard[]>;
  setBusinessResults: Setter<POICard[]>;
  setReachMarker: Setter<{ coords: Coords; label: string } | null>;
  setRouteOptions: Setter<RouteOption[]>;
  setRouteOptDest: Setter<RouteOptDest | null>;
  setSelectedRouteIdx: Setter<number | null>;
  setRestrictionWarnings: Setter<string[]>;
  setTachographResult: Setter<AITachoResult | null>;
  setWaypoints: Setter<Coords[]>;
  setWaypointNames: Setter<string[]>;
  setCameraAlert: Setter<{ dist: number; name: string } | null>;
  waypointsRef: MutableRefObject<Coords[]>;
  waypointNamesRef: MutableRefObject<string[]>;
  lastRerouteRef: MutableRefObject<number>;
  stopSim: () => void;
  cameraRef: MutableRefObject<any>;
  userCoords: Coords | null;
  customOriginRef: MutableRefObject<Coords | null>;
  customOriginName: string;
  setCustomOriginName: Setter<string>;
  profileRef: MutableRefObject<VehicleProfile | null>;
  routeOptions: RouteOption[];
  restrictionAnalysisCacheRef: MutableRefObject<Map<string, string[]>>;
  setRestrictionChecking: Setter<boolean>;
  navigating: boolean;
  suppressPanUntilRef: MutableRefObject<number>;
  lastMapTouchAtRef: MutableRefObject<number>;
  setAutoRetrackNonce: Setter<number>;
  navigation: MapNavProp;
  selectedParking: POICard | null;
  parkingResults: POICard[];
  poiCategory: import('../api/poi').POICategory | null;
  handleSARSearch: (cat: import('../api/poi').POICategory) => void;
  activeStructureWarningKeyRef: MutableRefObject<string | null>;
  dismissedStructureWarningsRef: MutableRefObject<Map<string, number>>;
  structureWarningDismissMs: number;
  setTunnelWarning: Setter<string | null>;
  fuelResults: POICard[];
  setSelectedFuel: Setter<POICard | null>;
  setSelectedParking: Setter<POICard | null>;
  playCameraAlert: () => void;
  googleUser: GoogleAccount | null;
  route: RouteResult | null;
  destinationNameRef: MutableRefObject<string>;
  destinationRef: MutableRefObject<Coords | null>;
  departAtRef: MutableRefObject<string | null>;
  routeOptDest: RouteOptDest | null;
  selectedRouteIdx: number | null;
}

export function useMapHandlers({
  handleChatState,
  handleMicStartState,
  handleMicStopState,
  sendGptText,
  sendGeminiText,
  sendShiftSummary,
  gptChatOpen,
  wakeWordFlashTimerRef,
  setWakeWordHeard,
  fasterOffer,
  acceptOffer,
  setRoute,
  routeRef,
  setNavCongestionGeoJSON,
  setNavTrafficAlerts,
  setLongPressCoord,
  navigateTo,
  lastSpokenStepRef,
  setCurrentStep,
  setDistToTurn,
  resetSession,
  mapMode,
  setMapMode,
  setIsTracking,
  setNavPhase,
  voiceMutedRef,
  saveSession,
  drivingSeconds,
  tachoSummary,
  shouldCenterOnIdleGpsRef,
  setDestination,
  setDestinationName,
  setMapPitch,
  setSpeedLimit,
  clearPOI,
  setParkingResults,
  setFuelResults,
  setCameraResults,
  setReportedCameras,
  setBusinessResults,
  setReachMarker,
  setRouteOptions,
  setRouteOptDest,
  setSelectedRouteIdx,
  setRestrictionWarnings,
  setTachographResult,
  setWaypoints,
  setWaypointNames,
  setCameraAlert,
  waypointsRef,
  waypointNamesRef,
  lastRerouteRef,
  stopSim,
  cameraRef,
  userCoords,
  customOriginRef,
  customOriginName,
  setCustomOriginName,
  profileRef,
  routeOptions,
  restrictionAnalysisCacheRef,
  setRestrictionChecking,
  navigating,
  suppressPanUntilRef,
  lastMapTouchAtRef,
  setAutoRetrackNonce,
  navigation,
  selectedParking,
  parkingResults,
  poiCategory,
  handleSARSearch,
  activeStructureWarningKeyRef,
  dismissedStructureWarningsRef,
  structureWarningDismissMs,
  setTunnelWarning,
  fuelResults,
  setSelectedFuel,
  setSelectedParking,
  playCameraAlert,
  googleUser,
  route,
  destinationNameRef,
  destinationRef,
  routeOptDest,
  selectedRouteIdx,
}: UseMapHandlersArgs): MapHandlers {
  const routeLogIdRef = useRef<number | null>(null);
  const routeLogStartPendingRef = useRef(false);
  const routeLogCompletionPendingRef = useRef(false);
  const routeLogGenerationRef = useRef(0);

  const completeActiveRouteLog = useCallback(() => {
    const routeId = routeLogIdRef.current;
    if (routeId == null) {
      if (routeLogStartPendingRef.current) {
        routeLogCompletionPendingRef.current = true;
      }
      return;
    }
    routeLogIdRef.current = null;
    routeLogCompletionPendingRef.current = false;
    void completeRouteLog(routeId);
  }, []);

  const beginRouteLog = useCallback((activeRoute: RouteResult | null) => {
    if (!activeRoute) return;
    completeActiveRouteLog();
    const generation = routeLogGenerationRef.current + 1;
    routeLogGenerationRef.current = generation;

    const fallbackCoords = activeRoute.geometry.coordinates as Coords[];
    const origin = customOriginRef.current ?? userCoords ?? fallbackCoords[0];
    const destination = destinationRef.current ?? fallbackCoords[fallbackCoords.length - 1];
    if (!origin || !destination) return;

    routeLogIdRef.current = null;
    routeLogCompletionPendingRef.current = false;
    routeLogStartPendingRef.current = true;
    void startRouteLog({
      userEmail: googleUser?.email,
      originName: customOriginName || i18n.t('route.gpsPosition'),
      destinationName: destinationNameRef.current || i18n.t('common.route'),
      originLat: origin[1],
      originLng: origin[0],
      destLat: destination[1],
      destLng: destination[0],
      waypointsJson: JSON.stringify(waypointsRef.current.map(([lng, lat]) => [lat, lng])),
      distanceM: activeRoute.distance,
      durationS: activeRoute.duration,
    }).then(routeId => {
      routeLogStartPendingRef.current = false;
      if (routeId == null) {
        routeLogCompletionPendingRef.current = false;
        return;
      }
      if (
        routeLogCompletionPendingRef.current
        || generation !== routeLogGenerationRef.current
      ) {
        routeLogCompletionPendingRef.current = false;
        void completeRouteLog(routeId);
        return;
      }
      routeLogIdRef.current = routeId;
    });
  }, [
    completeActiveRouteLog,
    customOriginName,
    customOriginRef,
    destinationNameRef,
    destinationRef,
    googleUser?.email,
    userCoords,
    waypointsRef,
  ]);

  const summarizeShift = useCallback(async () => {
    if (drivingSeconds <= 1800) return;
    await sendShiftSummary({
      drivenH: Math.round(drivingSeconds / 360) / 10,
      distKm: Math.round(((route?.distance ?? 0) / 1000) * 10) / 10,
      remainingWeeklyH: tachoSummary?.weekly_remaining_h ?? 0,
      destination: destinationNameRef.current || undefined,
    });
  }, [destinationNameRef, drivingSeconds, route?.distance, sendShiftSummary, tachoSummary?.weekly_remaining_h]);

  const handleEndOfDay = useCallback(async () => {
    await summarizeShift();
  }, [summarizeShift]);

  const handleChat = useCallback(
    () => handleChatState(sendGptText, sendGeminiText, gptChatOpen),
    [handleChatState, sendGptText, sendGeminiText, gptChatOpen],
  );
  const handleMicStart = useCallback(
    () => handleMicStartState(AudioRecorderPlayer),
    [handleMicStartState],
  );
  const handleMicStop = useCallback(
    () => handleMicStopState(AudioRecorderPlayer, handleChat),
    [handleMicStopState, handleChat],
  );

  const handleWakeCommand = useCallback((cmd: string) => {
    if (!cmd) return;
    setWakeWordHeard(true);
    if (wakeWordFlashTimerRef.current) clearTimeout(wakeWordFlashTimerRef.current);
    wakeWordFlashTimerRef.current = setTimeout(() => {
      wakeWordFlashTimerRef.current = null;
      setWakeWordHeard(false);
    }, 1200);
    sendGeminiText(cmd);
  }, [sendGeminiText, setWakeWordHeard, wakeWordFlashTimerRef]);

  const handleAcceptFasterRoute = useCallback(() => {
    if (!fasterOffer) return;
    routeRef.current = fasterOffer.route;
    setRoute(fasterOffer.route);
    setNavCongestionGeoJSON(fasterOffer.route.congestionGeoJSON ?? null);
    acceptOffer();
  }, [fasterOffer, acceptOffer, routeRef, setRoute, setNavCongestionGeoJSON]);

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
  }, [setLongPressCoord]);

  const handleDestinationSelect = useCallback(
    (place: GeoPlace) => navigateTo(place.center, place.text),
    [navigateTo],
  );

  const handleStart = useCallback((activeRoute?: RouteResult | null) => {
    const routeToStart = activeRoute ?? routeRef.current ?? route;
    if (!routeToStart?.geometry?.coordinates?.length) {
      Alert.alert(i18n.t('alerts.noRouteTitle'), i18n.t('alerts.noRouteMessage'));
      return;
    }

    routeRef.current = routeToStart;
    setRoute(routeToStart);
    beginRouteLog(routeToStart);
    lastSpokenStepRef.current = -1;
    setCurrentStep(0);
    setDistToTurn(null);
    resetSession();
    if (mapMode !== 'vector') setMapMode('vector');
    setIsTracking(true);
    setNavPhase('NAVIGATING');
    if (!voiceMutedRef.current) {
      Tts.stop();
      ttsSpeak(i18n.t('alerts.followRoute'));
    }
  }, [
    beginRouteLog,
    lastSpokenStepRef,
    mapMode,
    resetSession,
    route,
    routeRef,
    setCurrentStep,
    setDistToTurn,
    setIsTracking,
    setMapMode,
    setNavPhase,
    setRoute,
    voiceMutedRef,
  ]);

  const handleStopNav = useCallback(() => {
    completeActiveRouteLog();
    Tts.stop();
    setIsTracking(true);
    setNavPhase('ROUTE_PREVIEW');
    setNavCongestionGeoJSON(null);
    setNavTrafficAlerts(null);
    setMapPitch(0);
    setCurrentStep(0);
    setDistToTurn(null);
    lastRerouteRef.current = 0;
    void summarizeShift();
    saveSession();
  }, [
    completeActiveRouteLog,
    lastRerouteRef,
    saveSession,
    setCurrentStep,
    setDistToTurn,
    setIsTracking,
    setMapPitch,
    setNavCongestionGeoJSON,
    setNavPhase,
    setNavTrafficAlerts,
    summarizeShift,
  ]);

  const handleClear = useCallback(() => {
    completeActiveRouteLog();
    saveSession();
    Tts.stop();
    setIsTracking(true);
    shouldCenterOnIdleGpsRef.current = true;
    lastSpokenStepRef.current = -1;
    setDestination(null);
    setDestinationName('');
    routeRef.current = null;
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
    waypointsRef.current = [];
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
  }, [
    cameraRef,
    clearPOI,
    completeActiveRouteLog,
    lastRerouteRef,
    lastSpokenStepRef,
    resetSession,
    routeRef,
    saveSession,
    setBusinessResults,
    setCameraAlert,
    setCameraResults,
    setCurrentStep,
    setDestination,
    setDestinationName,
    setDistToTurn,
    setFuelResults,
    setIsTracking,
    setLongPressCoord,
    setMapPitch,
    setNavPhase,
    setParkingResults,
    setReachMarker,
    setRestrictionWarnings,
    setRoute,
    setRouteOptDest,
    setRouteOptions,
    setSelectedRouteIdx,
    setSpeedLimit,
    setTachographResult,
    setWaypointNames,
    setWaypoints,
    shouldCenterOnIdleGpsRef,
    stopSim,
    userCoords,
    waypointNamesRef,
    waypointsRef,
  ]);

  const handleOriginChange = useCallback((place: GeoPlace | null) => {
    customOriginRef.current = place?.center ?? null;
    setCustomOriginName(place?.text ?? '');
  }, [customOriginRef, setCustomOriginName]);

  const handleSelectRouteOption = useCallback(async (idx: number) => {
    setSelectedRouteIdx(idx);
    setRestrictionWarnings([]);
    const prof = profileRef.current;
    if (!prof) return;
    const option = routeOptions[idx];
    const coords = option?.geometry.coordinates;
    if (!option || !coords) return;

    const selectedRoute = routeFromOption(option);
    routeRef.current = selectedRoute;
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
  }, [
    profileRef,
    restrictionAnalysisCacheRef,
    routeOptions,
    routeRef,
    setNavCongestionGeoJSON,
    setNavTrafficAlerts,
    setRestrictionChecking,
    setRestrictionWarnings,
    setRoute,
    setSelectedRouteIdx,
  ]);

  const handleUserMapPan = useCallback(() => {
    if (!navigating) return;
    const now = Date.now();
    if (now < suppressPanUntilRef.current) return;
    if (now - lastMapTouchAtRef.current > 1200) return;
    setIsTracking(false);
    setAutoRetrackNonce(n => n + 1);
  }, [
    lastMapTouchAtRef,
    navigating,
    setAutoRetrackNonce,
    setIsTracking,
    suppressPanUntilRef,
  ]);

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

  const handleSearchAlongRoute = () => {
    if (poiCategory) handleSARSearch(poiCategory);
  };

  const handleTunnelWarningDismiss = useCallback(() => {
    const key = activeStructureWarningKeyRef.current;
    if (key) {
      dismissedStructureWarningsRef.current.set(key, Date.now() + structureWarningDismissMs);
    }
    activeStructureWarningKeyRef.current = null;
    setTunnelWarning(null);
  }, [
    activeStructureWarningKeyRef,
    dismissedStructureWarningsRef,
    setTunnelWarning,
    structureWarningDismissMs,
  ]);

  const handlePOINavigate = useCallback((poi: TruckPOI) => {
    clearPOI();
    navigateTo(poi.coordinates, poi.name);
  }, [navigateTo, clearPOI]);

  const handleBizMarkerPress = useCallback((business: POICard) => {
    if (!Number.isFinite(business.lat) || !Number.isFinite(business.lng)) return;
    setBusinessResults([]);
    navigateTo([business.lng, business.lat], business.name || i18n.t('common.place', { defaultValue: 'Place' }));
  }, [navigateTo, setBusinessResults]);

  const handleRouteTimelinePOIPress = useCallback((poi: RoutePOI) => {
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

  const handleRestMarkerPress = useCallback(async (coords: Coords) => {
    try {
      const recommendations = (await searchNearbyParking(coords[1], coords[0], 30000)).slice(0, 5);
      setParkingResults(recommendations);
      setSelectedFuel(null);
      if (recommendations.length === 0) {
        Alert.alert(i18n.t('alerts.breakTitle'), i18n.t('alerts.noTruckParking'));
        return;
      }
      setSelectedParking({
        ...recommendations[0],
        name: `${i18n.t('dispatcher.rest')} · ${recommendations[0].name}`,
      });
    } catch {
      Alert.alert(i18n.t('alerts.breakTitle'), i18n.t('alerts.parkingLoadFailed'));
    }
  }, [setParkingResults, setSelectedFuel, setSelectedParking]);

  const handleReportCamera = useCallback(async () => {
    playCameraAlert();
    if (userCoords) {
      await reportCamera(userCoords[1], userCoords[0], googleUser?.email);
      fetchReportedCameras().then(cams => {
        if (cams.length > 0) setReportedCameras(cams);
      }).catch(() => {});
    }
    Alert.alert(i18n.t('alerts.thanks'), i18n.t('alerts.cameraReported'));
  }, [playCameraAlert, userCoords, googleUser, setReportedCameras]);

  const handleExportGPX = useCallback(() => {
    const coords = route?.geometry?.coordinates as Coords[] | undefined;
    if (!coords?.length) {
      Alert.alert(i18n.t('alerts.noRouteTitle'), i18n.t('alerts.exportRouteFirst'));
      return;
    }
    const dest = destinationNameRef.current || i18n.t('common.route');
    const wps = waypointsRef.current ?? [];
    const wpNames = waypointNamesRef.current ?? [];
    const gpx = buildGPX(coords, dest, wps, wpNames);
    Share.share({ message: gpx, title: `${dest}.gpx` }).catch(() => {});
  }, [route, destinationNameRef, waypointsRef, waypointNamesRef]);

  const handleStartRoute = useCallback((_cong: any, _alerts: any) => {
    const selectedIdx = selectedRouteIdx != null && routeOptions[selectedRouteIdx]
      ? selectedRouteIdx
      : routeOptions.length > 0
        ? 0
        : null;
    const selectedOption = selectedIdx == null ? null : routeOptions[selectedIdx];
    if (selectedOption?.geometry?.coordinates?.length) {
      const selectedRoute = routeFromOption(selectedOption);
      routeRef.current = selectedRoute;
      setRoute(selectedRoute);
      setNavCongestionGeoJSON(selectedRoute.congestionGeoJSON);
      setNavTrafficAlerts(trafficAlertsToGeoJSON(selectedOption.traffic_alerts));
      handleStart(selectedRoute);
    } else if (routeOptDest) {
      navigateTo(routeOptDest.coords, routeOptDest.name, routeOptDest.waypoints, true);
    }
    setRouteOptions([]);
    setSelectedRouteIdx(null);
    setRestrictionWarnings([]);
  }, [handleStart, routeOptDest, routeOptions, selectedRouteIdx, navigateTo, routeRef, setNavCongestionGeoJSON, setNavTrafficAlerts, setRoute,
      setRouteOptions, setSelectedRouteIdx, setRestrictionWarnings]);

  return {
    handleEndOfDay,
    handleChat,
    handleMicStart,
    handleMicStop,
    handleWakeCommand,
    handleAcceptFasterRoute,
    handleMapLongPress,
    handleDestinationSelect,
    handleStart,
    handleStopNav,
    handleClear,
    handleOriginChange,
    handleSelectRouteOption,
    handleUserMapPan,
    handleAppIntent,
    handleSearchAlongRoute,
    handleTunnelWarningDismiss,
    handlePOINavigate,
    handleBizMarkerPress,
    handleRouteTimelinePOIPress,
    handleRestMarkerPress,
    handleReportCamera,
    handleExportGPX,
    handleStartRoute,
  };
}
