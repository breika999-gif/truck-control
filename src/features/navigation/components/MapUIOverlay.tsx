import React, { memo, type MutableRefObject } from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Tts from 'react-native-tts';

import { spacing } from '../../../shared/constants/theme';
import { isTablet, uiScale } from '../../../shared/utils/screen';
import { listStarred } from '../../../shared/services/backendApi';
import { optimizeWaypointOrder } from '../api/directions';
import type { BluetoothTachoState } from '../../tacho/hooks/useTachoBluetooth';
import {
  HOS_LIMIT_S,
  getTransParkingUrl,
  openInBrowser,
  ttsSpeak,
} from '../utils/mapUtils';
import BorderCrossingsPanel from './BorderCrossingsPanel';
import BusinessResultsPanel from './BusinessResultsPanel';
import CallingPanel from '../../calling/components/CallingPanel';
import ChatFABs from './ChatFABs';
import ChatPanel from './ChatPanel';
import FasterRouteBanner from './FasterRouteBanner';
import FuelPanel from './FuelPanel';
import FuelResultsPanel from './FuelResultsPanel';
import GoogleAccountModal from './GoogleAccountModal';
import LaneGuidanceStrip from './LaneGuidanceStrip';
import NavigationHUD from './NavigationHUD';
import NavigationTopPanel from './NavigationTopPanel';
import OfflineBanner from './OfflineBanner';
import OptionsPanel from './OptionsPanel';
import ParkingBubble from './ParkingBubble';
import ParkingResultsPanel from './ParkingResultsPanel';
import POISearchResults from './POISearchResults';
import RecenterButton from './RecenterButton';
import RouteOptionsPanel from './RouteOptionsPanel';
import RouteTimeline from './RouteTimeline';
import SearchBarContainer from './SearchBarContainer';
import SpeedCameraHUD from './SpeedCameraHUD';
import StatusChips from './StatusChips';
import TachoResultCard from './TachoResultCard';
import TiltControls from './TiltControls';
import TruckSituationRenderer from './TruckSituationRenderer';
import TunnelWarningBanner from './TunnelWarningBanner';
import VehicleBadge from './VehicleBadge';
import WakeWordIndicator from './WakeWordIndicator';

type Loose = any;

export interface MapUIOverlayProps {
  backendOnline: boolean;
  navigating: boolean;
  driveSegments: Loose;
  searchTop: number;
  customOriginName: string;
  handleDestinationSelect: Loose;
  handleClear: Loose;
  handleOriginChange: Loose;
  tunnelWarning: string | null;
  insets: Loose;
  handleTunnelWarningDismiss: Loose;
  stepToShow: Loose;
  nextStep: Loose;
  distToTurn: number | null;
  currentLanes: Loose[];
  aheadEvents: Loose[];
  truckSituation: Loose;
  displayLanes: Loose[];
  laneGlowBg: Loose;
  laneGlowShadow: Loose;
  route: Loose;
  routeControlsVisible: boolean;
  setRouteControlsVisible: Loose;
  navPhase: Loose;
  routeAheadPOIs: Loose[];
  handleRouteTimelinePOIPress: Loose;
  trafficSegments: Loose[];
  fasterOffer: Loose;
  handleAcceptFasterRoute: Loose;
  dismissOffer: Loose;
  optionsOpen: boolean;
  setOptionsOpen: Loose;
  mapMode: Loose;
  setMapMode: Loose;
  lightMode: boolean;
  setLightMode: Loose;
  voiceMuted: boolean;
  setVoiceMuted: Loose;
  mapLayers: Loose;
  toggleLayer: Loose;
  avoidUnpaved: boolean;
  setAvoidUnpaved: Loose;
  simulating: boolean;
  startSim: Loose;
  stopSim: Loose;
  poiCategory: Loose;
  handlePOISearch: Loose;
  sarMode: boolean;
  handleSARSearch: Loose;
  googleUser: Loose;
  setShowAccountModal: Loose;
  starredPOIs: Loose[];
  setBorderCrossings: Loose;
  setShowBorderPanel: Loose;
  isSearchingAlongRoute: boolean;
  handleSearchAlongRoute: Loose;
  setMapIsLoaded: Loose;
  userCoords: [number, number] | null;
  handleReportCamera: Loose;
  gpsReady: boolean;
  rerouting: boolean;
  loadingRoute: boolean;
  showBorderPanel: boolean;
  borderCrossings: Loose[];
  profile: Loose;
  poiResults: Loose[];
  loadingPOI: boolean;
  clearPOI: Loose;
  handlePOINavigate: Loose;
  parkingResults: Loose[];
  parkingSource?: 'gpt' | 'route' | null;
  setParkingResults: Loose;
  setParkingSource: Loose;
  remainingDriveMin?: number;
  speedKmh?: number;
  urgentParkingResults: Loose[];
  navigateTo: Loose;
  addWaypoint: Loose;
  setSelectedParking: Loose;
  navigation: Loose;
  fuelResults: Loose[];
  setFuelResults: Loose;
  tachographResult: Loose;
  tachoSummary: Loose;
  bluetoothTacho: BluetoothTachoState;
  setTachographResult: Loose;
  businessResults: Loose[];
  setBusinessResults: Loose;
  routeOptions: Loose[];
  selectedRouteIdx: number | null;
  routeOptDest: Loose;
  restrictionChecking: boolean;
  restrictionWarnings: string[];
  handleSelectRouteOption: Loose;
  setRouteOptions: Loose;
  setRouteOptDest: Loose;
  setSelectedRouteIdx: Loose;
  setRestrictionWarnings: Loose;
  handleStartRoute: Loose;
  drivingSeconds: number;
  handleExportGPX: Loose;
  selectedParking: Loose;
  selectedFuel: Loose;
  setSelectedFuel: Loose;
  wakeWordHeard: boolean;
  currentStep: number;
  speed: number;
  speedLimit: number | null;
  remainingSeconds: number;
  destination: [number, number] | null;
  destinationName: string;
  handleStopNav: Loose;
  handleStart: Loose;
  buildElevProfile: Loose;
  fetchWeatherForRoute: Loose;
  destinationRef: MutableRefObject<[number, number] | null>;
  destinationNameRef: MutableRefObject<string>;
  waypointsRef: MutableRefObject<[number, number][]>;
  dominantCongestion: Loose;
  elevProfile: number[];
  weatherPoints: Loose[];
  departLabel: Loose;
  pickDeparture: Loose;
  waypoints: [number, number][];
  waypointNames: string[];
  setWaypoints: Loose;
  setWaypointNames: Loose;
  speedingBg: Loose;
  proximityAlerts: Loose;
  nearestParkingM: number | null;
  hillWarnings: Loose[];
  cameraAlert: Loose;
  cameraFlashAnim: Loose;
  mapPitch: number;
  setMapPitch: Loose;
  cameraRef: MutableRefObject<any>;
  geminiChatOpen: boolean;
  gptChatOpen: boolean;
  setGeminiChatOpen: Loose;
  setGptChatOpen: Loose;
  isTracking: boolean;
  setIsTracking: Loose;
  suppressPanUntilRef: MutableRefObject<number>;
  gptHistory: Loose[];
  geminiHistory: Loose[];
  chatInput: string;
  setChatInput: Loose;
  gptLoading: boolean;
  geminiLoading: boolean;
  handleChat: Loose;
  handleTargetedQuickAction: Loose;
  isRecording: boolean;
  handleMicStart: Loose;
  handleMicStop: Loose;
  kbHeight: number;
  gptScrollRef: Loose;
  geminiScrollRef: Loose;
  micLoading: boolean;
  showAccountModal: boolean;
  setGoogleUser: Loose;
  isMountedRef: MutableRefObject<boolean>;
  setStarredPOIs: Loose;
}

const MapUIOverlay: React.FC<MapUIOverlayProps> = memo(({
  backendOnline,
  navigating,
  driveSegments,
  searchTop,
  customOriginName,
  handleDestinationSelect,
  handleClear,
  handleOriginChange,
  tunnelWarning,
  insets,
  handleTunnelWarningDismiss,
  stepToShow,
  nextStep,
  distToTurn,
  currentLanes,
  aheadEvents,
  truckSituation,
  displayLanes,
  laneGlowBg,
  laneGlowShadow,
  route,
  routeControlsVisible,
  setRouteControlsVisible,
  navPhase,
  routeAheadPOIs,
  handleRouteTimelinePOIPress,
  trafficSegments,
  fasterOffer,
  handleAcceptFasterRoute,
  dismissOffer,
  optionsOpen,
  setOptionsOpen,
  mapMode,
  setMapMode,
  lightMode,
  setLightMode,
  voiceMuted,
  setVoiceMuted,
  mapLayers, toggleLayer, avoidUnpaved, setAvoidUnpaved, simulating, startSim, stopSim,
  poiCategory, handlePOISearch, sarMode, handleSARSearch, googleUser, setShowAccountModal,
  starredPOIs,
  setBorderCrossings,
  setShowBorderPanel,
  isSearchingAlongRoute,
  handleSearchAlongRoute,
  setMapIsLoaded,
  userCoords,
  handleReportCamera,
  gpsReady,
  rerouting,
  loadingRoute,
  showBorderPanel,
  borderCrossings,
  profile,
  poiResults,
  loadingPOI,
  clearPOI,
  handlePOINavigate,
  parkingResults,
  parkingSource,
  setParkingResults,
  setParkingSource,
  remainingDriveMin,
  speedKmh,
  urgentParkingResults,
  navigateTo,
  addWaypoint,
  setSelectedParking,
  navigation,
  fuelResults,
  setFuelResults,
  tachographResult,
  tachoSummary,
  bluetoothTacho,
  setTachographResult,
  businessResults,
  setBusinessResults,
  routeOptions,
  selectedRouteIdx,
  routeOptDest,
  restrictionChecking,
  restrictionWarnings,
  handleSelectRouteOption,
  setRouteOptions,
  setRouteOptDest,
  setSelectedRouteIdx,
  setRestrictionWarnings,
  handleStartRoute,
  drivingSeconds,
  handleExportGPX,
  selectedParking,
  selectedFuel,
  setSelectedFuel,
  wakeWordHeard,
  currentStep,
  speed,
  speedLimit,
  remainingSeconds,
  destination,
  destinationName,
  handleStopNav,
  handleStart,
  buildElevProfile,
  fetchWeatherForRoute,
  destinationRef,
  destinationNameRef,
  waypointsRef,
  dominantCongestion,
  elevProfile,
  weatherPoints,
  departLabel, pickDeparture, waypoints, waypointNames, setWaypoints, setWaypointNames,
  speedingBg, proximityAlerts, nearestParkingM, hillWarnings, cameraAlert,
  cameraFlashAnim, mapPitch, setMapPitch, cameraRef, geminiChatOpen, gptChatOpen,
  setGeminiChatOpen, setGptChatOpen, isTracking, setIsTracking, suppressPanUntilRef,
  gptHistory, geminiHistory, chatInput, setChatInput, gptLoading, geminiLoading,
  handleChat, handleTargetedQuickAction, isRecording, handleMicStart, handleMicStop, kbHeight, gptScrollRef,
  geminiScrollRef, micLoading, showAccountModal, setGoogleUser, isMountedRef, setStarredPOIs,
}) => {
  const { t } = useTranslation();
  const [callingOpen, setCallingOpen] = React.useState(false);
  const [driveLegendVisible, setDriveLegendVisible] = React.useState(true);
  const tabletFabOffset = isTablet ? 20 * uiScale : 0;
  const truckParkingRouteCoords = React.useMemo(() => {
    const coords = route?.geometry?.coordinates;
    if (!coords || coords.length < 2) return undefined;
    const max = 220;
    if (coords.length <= max) return coords;
    const step = Math.ceil(coords.length / max);
    const sampled = coords.filter((_: [number, number], i: number) => i % step === 0);
    const last = coords[coords.length - 1];
    return sampled[sampled.length - 1] === last ? sampled : [...sampled, last];
  }, [route]);

  React.useEffect(() => {
    if (!navigating) setDriveLegendVisible(true);
  }, [navigating]);

  const hasDriveLegend = navigating && driveSegments && driveSegments.gradientStops.length > 0;
  const routeUiCollapsed = navigating && !routeControlsVisible;

  return (
    <>
    <OfflineBanner backendOnline={backendOnline} />

    {!routeUiCollapsed && hasDriveLegend && driveLegendVisible && (
      <View
        style={[overlayStyles.driveLegend, { bottom: 360 + insets.bottom }]}
      >
        <Pressable
          accessibilityLabel={t('overlay.hideTachoLegend')}
          hitSlop={8}
          onPress={() => setDriveLegendVisible(false)}
          style={overlayStyles.driveLegendClose}
        >
          <Text style={overlayStyles.driveLegendCloseText}>×</Text>
        </Pressable>
        <Text style={[overlayStyles.driveLegendText, overlayStyles.driveLegendCurrent]}>
          {t('overlay.untilBreak')}
        </Text>
        <Text style={[overlayStyles.driveLegendText, overlayStyles.driveLegendAfterBreak]}>
          {t('overlay.afterBreak')}
        </Text>
        {tachoSummary?.daily_limit_h === 10 && (
          <Text style={[overlayStyles.driveLegendText, overlayStyles.driveLegendExtended]}>
            {t('overlay.extendedHour')}
          </Text>
        )}
        <Text style={[overlayStyles.driveLegendText, overlayStyles.driveLegendDailyLimit]}>
          {t('overlay.dailyLimit', { hours: tachoSummary?.daily_limit_h ?? 9 })}
        </Text>
        <Pressable
          accessibilityLabel={bluetoothTacho.connected ? t('overlay.disconnectTacho') : t('overlay.connectTacho')}
          onPress={bluetoothTacho.connected ? bluetoothTacho.disconnect : bluetoothTacho.startScan}
          style={overlayStyles.bluetoothTachoButton}
        >
          <View
            style={[
              overlayStyles.bluetoothTachoDot,
              bluetoothTacho.connected
                ? overlayStyles.bluetoothTachoDotConnected
                : overlayStyles.bluetoothTachoDotDisconnected,
            ]}
          />
          <Text style={overlayStyles.bluetoothTachoText}>
            {bluetoothTacho.connected ? bluetoothTacho.deviceName ?? t('overlay.tacho') : t('overlay.connectTacho')}
          </Text>
        </Pressable>
      </View>
    )}

    {!routeUiCollapsed && hasDriveLegend && !driveLegendVisible && (
      <Pressable
        accessibilityLabel={t('overlay.showTachoLegend')}
        onPress={() => setDriveLegendVisible(true)}
        style={[overlayStyles.driveLegendToggle, { bottom: 360 + insets.bottom }]}
      >
        <Text style={overlayStyles.driveLegendToggleText}>HOS</Text>
      </Pressable>
    )}

    {/* ── Search bar (hidden during navigation) ── */}
    {!routeUiCollapsed && (
      <SearchBarContainer
        navigating={navigating}
        searchTop={searchTop}
        customOriginName={customOriginName}
        onSelect={handleDestinationSelect}
        onClear={handleClear}
        onOriginChange={handleOriginChange}
      />
    )}

    <TunnelWarningBanner
      message={tunnelWarning}
      visible={!routeUiCollapsed && !!tunnelWarning && navigating}
      topOffset={insets.top}
      onDismiss={handleTunnelWarningDismiss}
    />

    {!routeUiCollapsed && stepToShow && (
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
      visible={!routeUiCollapsed && navigating && distToTurn != null && distToTurn < 500 && displayLanes.length > 0}
      lanes={displayLanes}
      glowBg={laneGlowBg}
      glowShadow={laneGlowShadow}
    />

    {/* ── Route Timeline ── */}
    {!routeUiCollapsed && route && (navigating || navPhase === 'ROUTE_PREVIEW') && (
      <RouteTimeline
        routeAheadPOIs={routeAheadPOIs}
        totalDistM={route.distance}
        onPOIPress={handleRouteTimelinePOIPress}
        trafficSegments={trafficSegments}
      />
    )}

    {/* ── Faster route banner ── */}
    <FasterRouteBanner
      offer={routeUiCollapsed ? null : fasterOffer}
      onAccept={handleAcceptFasterRoute}
      onDismiss={dismissOffer}
      top={insets.top + 8}
    />

    {/* ── Options Panel ── */}
    {!routeUiCollapsed && <OptionsPanel
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
      handleStart={handleStart}
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
      drivingSeconds={drivingSeconds}
      remainingDriveMin={remainingDriveMin}
      onReportCamera={handleReportCamera}
      backendOnline={backendOnline}
    />}

    {!routeUiCollapsed && <StatusChips gpsReady={gpsReady || simulating} rerouting={rerouting} loadingRoute={loadingRoute} />}

    {!routeUiCollapsed && <BorderCrossingsPanel
      show={showBorderPanel}
      crossings={borderCrossings}
      onClose={() => setShowBorderPanel(false)}
    />}

    {!routeUiCollapsed && <VehicleBadge plate={profile?.plate} navigating={navigating} searchTop={searchTop} />}

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

    {(parkingSource === 'gpt' || (!route && !navigating)) && (
      <ParkingResultsPanel
        parkingResults={parkingResults}
        searchTop={searchTop}
        onDismiss={() => { setParkingResults([]); setParkingSource(null); }}
        onNavigate={(coords, name) => navigateTo(coords, name)}
        onAddWaypoint={(coords, name) => addWaypoint(coords, name)}
        onClearSelectedParking={() => setSelectedParking(null)}
        onCardTap={(p) => setSelectedParking(p)}
        remainingDriveMin={remainingDriveMin}
        speedKmh={speedKmh}
        onOpenInfo={async (p) => {
          const selectedCoords = p.lng != null && p.lat != null
            ? [p.lng, p.lat] as [number, number]
            : undefined;
          if (p.transparking_id) {
            const url = await getTransParkingUrl(p.transparking_id);
            navigation.navigate('TruckParking', {
              url,
              userCoords: userCoords || undefined,
              selectedCoords,
              selectedName: p.name,
              routeCoords: truckParkingRouteCoords,
              routeDurationS: route?.duration,
              remainingDriveMin,
            });
          } else if (p.website) {
            openInBrowser(p.website);
          } else {
            navigation.navigate('TruckParking', {
              userCoords: userCoords || undefined,
              selectedCoords,
              selectedName: p.name,
              routeCoords: truckParkingRouteCoords,
              routeDurationS: route?.duration,
              remainingDriveMin,
            });
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
    {!routeUiCollapsed && tachographResult && (
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
    {!routeUiCollapsed && selectedParking && (
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
    {!routeUiCollapsed && selectedFuel && (
      <FuelPanel
        fuel={selectedFuel}
        onClose={() => setSelectedFuel(null)}
        onAddWaypoint={(coord, name) => addWaypoint(coord, name)}
        topOffset={searchTop}
      />
    )}

    {/* ── Truck Situation Renderer (composite restrictions / tunnel / tacho) ── */}
    {!routeUiCollapsed && navigating && <TruckSituationRenderer situation={truckSituation} />}

    {!routeUiCollapsed && <WakeWordIndicator navigating={navigating} wakeWordHeard={wakeWordHeard} topInset={insets.top} />}

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
        bluetoothTacho={bluetoothTacho}
        urgentParkingResults={urgentParkingResults}
        onUrgentParkingPress={() => {
          if (urgentParkingResults.length > 0) {
            setParkingResults(urgentParkingResults);
            setRouteControlsVisible(true);
          }
        }}
        nearestParkingM={nearestParkingM}
        hillWarnings={hillWarnings}
        compactOnly={routeUiCollapsed}
      />
    )}

    <SpeedCameraHUD
      visible={!routeUiCollapsed && navigating && !!cameraAlert}
      distM={cameraAlert?.dist ?? 0}
      bottomOffset={320 + insets.bottom}
      flashAnim={cameraFlashAnim}
    />

    <TiltControls
      visible={!navigating}
      mapPitch={mapPitch}
      bottomOffset={insets.bottom + 100}
      position="middleLeft"
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
      visible={!navigating && !(routeOptions.length > 0 && navPhase === 'ROUTE_PREVIEW')}
      backendOnline={backendOnline}
      geminiChatOpen={geminiChatOpen}
      gptChatOpen={gptChatOpen}
      bottomOffset={
        routeOptions.length > 0 && navPhase === 'ROUTE_PREVIEW'
          ? insets.bottom + spacing.xxl + tabletFabOffset
          : insets.bottom + spacing.xl + tabletFabOffset
      }
      onToggleGemini={() => {
        setGeminiChatOpen((v: boolean) => !v);
        setGptChatOpen(false);
      }}
      onToggleGPT={() => {
        setGptChatOpen((v: boolean) => !v);
        setGeminiChatOpen(false);
      }}
    />

    <RecenterButton
      visible={!routeUiCollapsed && navigating && !isTracking}
      bottomOffset={insets.bottom + 100}
      onPress={() => {
        suppressPanUntilRef.current = Date.now() + 1500;
        setIsTracking(true);
      }}
    />

    {/* ── Mute бутон ── */}
    {!routeUiCollapsed && <TouchableOpacity
      onPress={() => { setVoiceMuted((v: boolean) => !v); if (!voiceMuted) Tts.stop(); }}
      style={{
        position: 'absolute',
        left: 14,
        bottom: insets.bottom + 214 + tabletFabOffset,
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: voiceMuted ? 'rgba(255,80,80,0.85)' : 'rgba(0,0,0,0.6)',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      activeOpacity={0.75}
    >
      <Text style={{ fontSize: 20 }}>{voiceMuted ? '🔇' : '🔊'}</Text>
    </TouchableOpacity>}

    {/* ── Hands-free calling FAB ── */}
    {!routeUiCollapsed && <TouchableOpacity
      onPress={() => setCallingOpen((open: boolean) => !open)}
      style={{
        position: 'absolute',
        left: 14,
        bottom: insets.bottom + 160 + tabletFabOffset,
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: callingOpen ? 'rgba(76,175,80,0.85)' : 'rgba(0,0,0,0.6)',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      activeOpacity={0.75}
    >
      <Text style={{ fontSize: 20 }}>📞</Text>
    </TouchableOpacity>}

    {/* ── Докладвай камера FAB — само при активен маршут ── */}
    {!routeUiCollapsed && route && (
      <TouchableOpacity
        onPress={handleReportCamera}
        style={{
          position: 'absolute',
          right: 14,
          bottom: insets.bottom + 214 + tabletFabOffset,
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: 'rgba(192,2,26,0.85)',
          alignItems: 'center',
          justifyContent: 'center',
          elevation: 5,
        }}
        activeOpacity={0.75}
      >
        <Text style={{ fontSize: 20 }}>📷</Text>
      </TouchableOpacity>
    )}

    {/* ── Chat Panels ── */}
    {!routeUiCollapsed && <ChatPanel
      gptChatOpen={gptChatOpen}
      geminiChatOpen={geminiChatOpen}
      gptHistory={gptHistory}
      geminiHistory={geminiHistory}
      chatInput={chatInput}
      setChatInput={setChatInput}
      gptLoading={gptLoading}
      geminiLoading={geminiLoading}
      handleChat={handleChat}
      onTargetedQuickAction={handleTargetedQuickAction}
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
    />}

    {/* ── Google Account Modal ── */}
    {!routeUiCollapsed && <GoogleAccountModal
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
    />}
    {!routeUiCollapsed && <CallingPanel visible={callingOpen} onClose={() => setCallingOpen(false)} />}
    </>
  );
});

const overlayStyles = StyleSheet.create({
  driveLegend: {
    position: 'absolute',
    left: 12,
    zIndex: 20,
    elevation: 10,
    backgroundColor: 'rgba(0,8,20,0.88)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    paddingLeft: 8,
    paddingRight: 24,
    paddingVertical: 6,
    gap: 2,
  },
  driveLegendClose: {
    position: 'absolute',
    top: 2,
    right: 3,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  driveLegendCloseText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 18,
  },
  driveLegendToggle: {
    position: 'absolute',
    left: 12,
    zIndex: 20,
    elevation: 10,
    backgroundColor: 'rgba(0,8,20,0.88)',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 7,
    paddingVertical: 5,
  },
  driveLegendToggleText: {
    color: '#9B59B6',
    fontSize: 10,
    fontWeight: '800',
  },
  driveLegendText: {
    fontSize: 11,
    fontWeight: '700',
  },
  driveLegendCurrent: {
    color: '#9B59B6',
  },
  driveLegendAfterBreak: {
    color: '#E67E22',
  },
  driveLegendExtended: {
    color: '#F1C40F',
  },
  driveLegendDailyLimit: {
    color: '#C0392B',
  },
  bluetoothTachoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 3,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.14)',
  },
  bluetoothTachoDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  bluetoothTachoDotConnected: {
    backgroundColor: '#007AFF',
  },
  bluetoothTachoDotDisconnected: {
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  bluetoothTachoText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
});

export default MapUIOverlay;
