import React, { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { View } from 'react-native';
import Mapbox, { CustomLocationProvider, LocationPuck } from '@rnmapbox/maps';
import { useTranslation } from 'react-i18next';

import { useVoice } from '../hooks/useVoice';
import { useTacho } from '../hooks/useTacho';
import { usePOI } from '../hooks/usePOI';
import { useChat } from '../hooks/useChat';
import { useLocationInterpolator } from '../hooks/useLocationInterpolator';
import { useSessionBootstrap } from '../hooks/useSessionBootstrap';

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { MAP_CENTER } from '../../../shared/constants/config';
import { useVehicleStore } from '../../../store/vehicleStore';
import type { RootStackParamList } from '../../../shared/types/navigation';
import MapLayers from '../components/MapLayers';
import MapUIOverlay from '../components/MapUIOverlay';
import { useFasterRouteCheck } from '../hooks/useFasterRouteCheck';
import {
  searchNearbyParking,
  type POICard,
  type TachoSummary,
} from '../../../shared/services/backendApi';
import { styles } from './MapScreen.styles';
import {
  NAV_ARROW, SIGN_CLOSED, SIGN_DANGER0, STAR_ICON,
  ICON_PARKING, ICON_FUEL, ICON_CAMERA, ICON_DESTINATION, ICON_BIZ, ICON_NO_OVERTAKING,
  ICON_RESTRICTION_ADR, ICON_RESTRICTION_AXLE, ICON_RESTRICTION_HAZMAT,
  ICON_RESTRICTION_HEIGHT, ICON_RESTRICTION_LENGTH, ICON_RESTRICTION_NO_TRUCKS,
  ICON_RESTRICTION_WEIGHT, ICON_RESTRICTION_WIDTH,
  type DepartLabel, departIso,
  ttsSpeak,
  StableCamera,
} from '../utils/mapUtils';
import { useMapUIState } from '../hooks/useMapUIState';
import { useNavigationState } from '../hooks/useNavigationState';
import { useRouteInsights } from '../hooks/useRouteInsights';
import { useRouteOrchestrator } from '../hooks/useRouteOrchestrator';
import { useDrivingAlerts } from '../hooks/useDrivingAlerts';
import { STRUCTURE_WARNING_DISMISS_MS, useLocationRuntime } from '../hooks/useLocationRuntime';
import { useSimulation } from '../hooks/useSimulation';
import { useChatPanelsState } from '../hooks/useChatPanelsState';
import { useMapGeoJSON } from '../hooks/useMapGeoJSON';
import { useMapHandlers, type MapHandlers } from './useMapHandlers';
import { useMapBootstrap } from '../hooks/useMapBootstrap';
import { useMapAlerts } from '../hooks/useMapAlerts';
import { useMapTracking } from '../hooks/useMapTracking';
import { useMapRoutePresentation } from '../hooks/useMapRoutePresentation';
import { useAndroidAuto } from '../../androidauto/useAndroidAuto';

type MapNavProp = NativeStackNavigationProp<RootStackParamList, 'Map'>;
type MapRouteProp = RouteProp<RootStackParamList, 'Map'>;
const MAP_IMAGES = {
  'nav-arrow': NAV_ARROW, 'sign-closed': SIGN_CLOSED, 'sign-danger-0': SIGN_DANGER0,
  'star-icon': STAR_ICON, 'parking-icon': ICON_PARKING, 'fuel-icon': ICON_FUEL,
  'camera-icon': ICON_CAMERA, 'biz-icon': ICON_BIZ, 'no-overtaking': ICON_NO_OVERTAKING,
  'dest-flag': ICON_DESTINATION, 'restriction-height': ICON_RESTRICTION_HEIGHT,
  'restriction-width': ICON_RESTRICTION_WIDTH, 'restriction-weight': ICON_RESTRICTION_WEIGHT,
  'restriction-axle': ICON_RESTRICTION_AXLE, 'restriction-length': ICON_RESTRICTION_LENGTH,
  'restriction-hazmat': ICON_RESTRICTION_HAZMAT, 'restriction-adr': ICON_RESTRICTION_ADR,
  'restriction-no-trucks': ICON_RESTRICTION_NO_TRUCKS,
};
const NAV_PUCK_GLOW = '#6D3DFF';
// ── Component ────────────────────────────────────────────────────────

const MapScreen: React.FC = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<MapNavProp>();
  const screenRoute = useRoute<MapRouteProp>();
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
    waypoints, setWaypoints,
    waypointNames, setWaypointNames,
    restrictionChecking, setRestrictionChecking,
    restrictionWarnings, setRestrictionWarnings,
    avoidUnpaved, setAvoidUnpaved,
  } = useNavigationState();

  // POI result states — declared early so useRouteOrchestrator can auto-populate them on route set
  const [parkingResults, setParkingResults]   = useState<POICard[]>([]);
  const [fuelResults, setFuelResults]         = useState<POICard[]>([]);
  const [cameraResults, setCameraResults]     = useState<POICard[]>([]);
  const {
    activeStructureWarningKeyRef, backendOnline, buildRoutePOIScanRef,
    dismissedStructureWarningsRef, drivingSecondsRef, isMountedRef,
    lastRestrictionRef, navCongestionGeoJSON, navigatingRef, navTrafficAlerts,
    orchestratorUserCoordsRef, profileRef, reachMarker, reportedCameras,
    restrictionAnalysisCacheRef, routeRef, setBackendOnline,
    setNavCongestionGeoJSON, setNavCongestionGeoJSONRef, setNavTrafficAlerts,
    setReachMarker, setReportedCameras, setTunnelWarningRef,
    showReachMarkerForText, stoppedSinceRef,
  } = useMapBootstrap({ cameraRef, navigating, profile, route, setLightMode });

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
  useEffect(() => { setReachMarker(null); }, [destinationName, route?.distance, route?.duration, setReachMarker]);
  const simulationActiveRef = useRef(false);

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
    simulationActiveRef,
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
  const interpolatedCoords = useLocationInterpolator(
    navigating ? userCoords : null,
    speed,
    userHeading,
  );
  const displayCoords = navigating && interpolatedCoords
    ? interpolatedCoords
    : userCoords;

  const { simulating, startSim, stopSim } = useSimulation({
    route,
    setUserCoords,
    setSpeed,
    setUserHeading,
    setCurrentStep,
    setDistToTurn,
    setSpeedLimit,
    setRemainingSeconds,
    simulationActiveRef,
  });
  // Sync GPS userCoordsRef → orchestratorUserCoordsRef so navigateTo uses real position
  useLayoutEffect(() => {
    orchestratorUserCoordsRef.current = userCoordsRef.current;
  }, [orchestratorUserCoordsRef, userCoords, userCoordsRef]);

  const handledDispatcherPlanRef = useRef<string | null>(null);
  useEffect(() => {
    const plan = screenRoute.params?.dispatcherPlan;
    if (!plan || handledDispatcherPlanRef.current === plan.requestId) return;
    handledDispatcherPlanRef.current = plan.requestId;
    setWaypoints(plan.waypoints);
    setWaypointNames(plan.waypointNames);
    waypointsRef.current = plan.waypoints;
    waypointNamesRef.current = plan.waypointNames;
    void navigateTo(plan.destination, plan.destinationName, plan.waypoints);
  }, [navigateTo, screenRoute.params?.dispatcherPlan, setWaypointNames, setWaypoints, waypointNamesRef, waypointsRef]);

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

  const mapHandlersRef = useRef<MapHandlers | null>(null);
  const {
    borderCrossings, longPressCoord, onAppIntent, onEndOfDay,
    setBorderCrossings, setLongPressCoord, setShowBorderPanel,
    setWakeWordHeard, showBorderPanel, wakeWordFlashTimerRef, wakeWordHeard,
  } = useMapAlerts({ mapHandlersRef, navigating });

  // 2. Tacho & HOS
  const {
    drivingSeconds, tachoSummary, setTachoSummary, resetSession, saveSession, bluetoothTacho
  } = useTacho(
    navigating, isDrivingRef, googleUserRef, userCoordsRef, speak, onEndOfDay,
    (remMin) => {
      ttsSpeak(t('tachoAlerts.remainingDrivingSearchParking', { minutes: remMin }));
      if (userCoords) {
        searchNearbyParking(userCoords[1], userCoords[0], 20000)
          .then(results => { if (results.length > 0) setParkingResults(results.slice(0, 5)); })
          .catch(() => {});
      }
    }
  );
  useLayoutEffect(() => { drivingSecondsRef.current = drivingSeconds; }, [drivingSeconds, drivingSecondsRef]);
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
    isRecording,
    micLoading,
    kbHeight,
    gptScrollRef, geminiScrollRef,
    handleChat: handleChatState,
    handleMicStart: handleMicStartState,
    handleMicStop: handleMicStopState,
  } = useChatPanelsState();

  const {
    gptLoading, geminiLoading, sendGptText, sendGeminiText, sendShiftSummary
  } = useChat({
    userCoords, drivingSeconds, speed, profile, tachoSummary, bluetoothTacho, parkingResults,
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
    handleAppIntent: onAppIntent,
    onReachQuestion: showReachMarkerForText,
  });

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

  useEffect(() => { buildRoutePOIScanRef.current = buildRoutePOIScan; }, [buildRoutePOIScan, buildRoutePOIScanRef]);
  useEffect(() => { setNavCongestionGeoJSONRef.current = setNavCongestionGeoJSON; }, [setNavCongestionGeoJSON, setNavCongestionGeoJSONRef]);

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

  const [customOriginName, setCustomOriginName] = useState('');
  const [routeControlsVisible, setRouteControlsVisible] = useState(true);
  const mapIsLoaded = mapLoaded;
  const {
    isTracking, lastMapTouchAtRef, mapPitch, puckScale, setAutoRetrackNonce,
    setIsTracking, setMapPitch, shouldCenterOnIdleGpsRef, suppressPanUntilRef,
  } = useMapTracking({
    cameraRef, destination, destinationName, distToTurn, isMapLoaded: mapIsLoaded,
    navigateTo, navigating, navPhase, route, simulating, speed, userCoords,
    userHeading, voiceMutedRef, waypoints,
  });

  useEffect(() => {
    if (!navigating || !route) { setRemainingSeconds(0); return; }
    if (simulating) return;
    navStartRef.current      = Date.now();
    navInitDurationRef.current = route.duration;
    setRemainingSeconds(route.duration);
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - navStartRef.current) / 1000);
      setRemainingSeconds(Math.max(0, navInitDurationRef.current - elapsed));
    }, 30_000);
    return () => clearInterval(interval);
  }, [navigating, navInitDurationRef, navStartRef, route, setRemainingSeconds, simulating]);

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

  useEffect(() => {
    setRouteControlsVisible(true);
  }, [navigating, route?.distance]);

  useEffect(() => {
    if (!navigating || !routeControlsVisible) return;
    const timer = setTimeout(() => setRouteControlsVisible(false), 5000);
    return () => clearTimeout(timer);
  }, [navigating, routeControlsVisible]);

  const searchTop = insets.top + 18;
  const isSearchingAlongRoute = loadingPOI && sarMode;
  const {
    aheadEvents, currentLanes, displayLanes, displayRestrictionPoints,
    dominantCongestion, driveSegments, gradeProfile, lanePulseOn, mapStyleURL, nearestParkingM,
    nextStep, routeLineColor, routeProgressFraction, stepToShow, trafficSegments,
    truckSituation,
  } = useMapRoutePresentation({
    currentStep, distToTurn, drivingSeconds, lightMode, mapMode, navigating, navPhase,
    parkingResults, profile, remainingSeconds, route, tachoSummary, userCoords,
  });

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

  const mapHandlers = useMapHandlers({
    speak,
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
    structureWarningDismissMs: STRUCTURE_WARNING_DISMISS_MS,
    setTunnelWarning,
    fuelResults,
    setSelectedFuel,
    setSelectedParking,
    playCameraAlert,
    googleUser,
    route,
    destinationNameRef,
    destinationRef,
    departAtRef,
    routeOptDest,
    selectedRouteIdx,
  });
  mapHandlersRef.current = mapHandlers;
  const {
    handleChat,
    handleMicStart,
    handleMicStop,
    handleAcceptFasterRoute,
    handleMapLongPress,
    handleDestinationSelect,
    handleStart,
    handleStopNav,
    handleClear,
    handleOriginChange,
    handleSelectRouteOption,
    handleUserMapPan,
    handleSearchAlongRoute,
    handleTunnelWarningDismiss,
    handlePOINavigate,
    handleBizMarkerPress,
    handleRouteTimelinePOIPress,
    handleRestMarkerPress,
    handleReportCamera,
    handleExportGPX,
    handleStartRoute,
  } = mapHandlers;
  handleStartRef.current = handleStart;

  useAndroidAuto({
    navigating,
    stepInstruction: stepToShow?.maneuver?.instruction ?? '',
    distToTurn,
    remainingSeconds,
    speed,
    onStopNavigation: handleStopNav,
  });

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
  }, [avoidUnpaved, destinationNameRef, destinationRef, navigateTo, waypointsRef]);

  const pickDeparture = useCallback((label: DepartLabel) => {
    const iso = departIso(label);
    setDepartLabel(label);
    setDepartAt(iso);
    departAtRef.current = iso;
    const dest = destinationRef.current;
    if (dest) navigateTo(dest, destinationNameRef.current);
  }, [departAtRef, destinationNameRef, destinationRef, navigateTo, setDepartAt, setDepartLabel]);

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
        onTouchStart={() => {
          lastMapTouchAtRef.current = Date.now();
        }}
        onCameraChanged={(state: any) => {
          if (navigating && isTracking && state?.gestures?.isGestureActive) {
            handleUserMapPan();
          }
        }}
        onPress={() => {
          if (navigating) setRouteControlsVisible((visible) => !visible);
          if (gptChatOpen) setGptChatOpen(false);
          if (geminiChatOpen) setGeminiChatOpen(false);
          if (longPressCoord) setLongPressCoord(null);
          if (selectedParking) setSelectedParking(null);
          if (selectedFuel) setSelectedFuel(null);
        }}
      >
        <Mapbox.Images
          images={MAP_IMAGES}
          onImageMissing={(_imageKey) => {
            // mapbox-location-shadow-icon е вграден Mapbox asset — не е грешка
          }}
        />
        {navigating && displayCoords && (
          <CustomLocationProvider
            coordinate={displayCoords}
            heading={userHeading ?? undefined}
          />
        )}
        <StableCamera
          cameraRef={cameraRef}
          navigating={navigating}
          mapLoaded={mapIsLoaded}
          idlePitch={mapPitch}
          speed={speed}
          isTracking={isTracking}
          userCoords={displayCoords}
          distToTurn={distToTurn}
        />

        <Mapbox.UserLocation visible={false} />

        <LocationPuck
          puckBearingEnabled={speed > 3}
          puckBearing="course"
          topImage="nav-arrow"
          bearingImage="nav-arrow"
          scale={puckScale}
          pulsing={{ isEnabled: true, color: NAV_PUCK_GLOW, radius: 58 }}
          visible={navigating || isTracking}
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
          routeProgressFraction={routeProgressFraction}
          driveSegments={driveSegments}
          gradeProfile={gradeProfile}
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
          cameraResults={[...cameraResults, ...reportedCameras]}
          overtakingResults={overtakingResults}
          navCongestionVisible={navCongestionVisible}
          routeOptions={routeOptions}
          selectedRouteIdx={selectedRouteIdx}
          setSelectedParking={setSelectedParking}
          setSelectedFuel={setSelectedFuel}
          onRestMarkerPress={handleRestMarkerPress}
          onBizMarkerPress={handleBizMarkerPress}
          handleSelectRouteOption={handleSelectRouteOption}
          ttsSpeak={ttsSpeak}
          voiceMutedRef={voiceMutedRef}
          restrictionPoints={displayRestrictionPoints}
          poiResults={poiResults}
          handlePOINavigate={handlePOINavigate}
        />

      </Mapbox.MapView>

      <MapUIOverlay {...{
        backendOnline, navigating, driveSegments, searchTop, customOriginName,
        handleDestinationSelect, handleClear, handleOriginChange, tunnelWarning, insets,
        handleTunnelWarningDismiss, stepToShow, nextStep, distToTurn, currentLanes,
        aheadEvents, truckSituation, displayLanes, laneGlowBg, laneGlowShadow,
        route, routeControlsVisible, navPhase, routeAheadPOIs, handleRouteTimelinePOIPress, trafficSegments,
        fasterOffer, handleAcceptFasterRoute, dismissOffer, optionsOpen, setOptionsOpen,
        mapMode, setMapMode, lightMode, setLightMode, voiceMuted, setVoiceMuted,
        mapLayers, toggleLayer, avoidUnpaved, setAvoidUnpaved, simulating, startSim, stopSim,
        poiCategory, handlePOISearch, sarMode, handleSARSearch, googleUser, setShowAccountModal,
        starredPOIs, setBorderCrossings, setShowBorderPanel, isSearchingAlongRoute,
        handleSearchAlongRoute, setMapIsLoaded, userCoords, handleReportCamera, gpsReady,
        rerouting, loadingRoute, showBorderPanel, borderCrossings, profile, poiResults,
        loadingPOI, clearPOI, handlePOINavigate, parkingResults, setParkingResults,
        navigateTo, addWaypoint, setSelectedParking, navigation, fuelResults, setFuelResults,
        tachographResult, tachoSummary, bluetoothTacho, setTachographResult, businessResults,
        setBusinessResults, routeOptions, selectedRouteIdx, routeOptDest, restrictionChecking,
        restrictionWarnings, handleSelectRouteOption, setRouteOptions, setRouteOptDest,
        setSelectedRouteIdx, setRestrictionWarnings, handleStartRoute, drivingSeconds,
        handleExportGPX, selectedParking, selectedFuel, setSelectedFuel, wakeWordHeard,
        currentStep, speed, speedLimit, remainingSeconds, destination, destinationName,
        handleStopNav, handleStart, buildElevProfile, fetchWeatherForRoute, destinationRef,
        destinationNameRef, waypointsRef, dominantCongestion, elevProfile, weatherPoints,
        departLabel, pickDeparture, waypoints, waypointNames, setWaypoints, setWaypointNames,
        speedingBg, proximityAlerts, nearestParkingM, hillWarnings, cameraAlert,
        cameraFlashAnim, mapPitch, setMapPitch, cameraRef, geminiChatOpen, gptChatOpen,
        setGeminiChatOpen, setGptChatOpen, isTracking, setIsTracking, suppressPanUntilRef,
        gptHistory, geminiHistory, chatInput, setChatInput, gptLoading, geminiLoading,
        handleChat, isRecording, handleMicStart, handleMicStop, kbHeight, gptScrollRef,
        geminiScrollRef, micLoading, showAccountModal, setGoogleUser, isMountedRef, setStarredPOIs,
      }} />
    </View>
  );
}

export default MapScreen;
