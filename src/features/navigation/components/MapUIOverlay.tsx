import React, { memo } from 'react';

import OfflineBanner from './OfflineBanner';
import ChatAccountOverlay from './overlay/ChatAccountOverlay';
import DriveLegendOverlay from './overlay/DriveLegendOverlay';
import MapControlsOverlay from './overlay/MapControlsOverlay';
import MenuStatusOverlay from './overlay/MenuStatusOverlay';
import ResultsOverlay from './overlay/ResultsOverlay';
import RouteHudOverlay from './overlay/RouteHudOverlay';
import SearchGuidanceOverlay from './overlay/SearchGuidanceOverlay';
import type { MapUIOverlayProps } from './overlay/types';

export type { MapUIOverlayProps } from './overlay/types';
export { default as ChatAccountOverlay } from './overlay/ChatAccountOverlay';
export { default as DriveLegendOverlay } from './overlay/DriveLegendOverlay';
export { default as MapControlsOverlay } from './overlay/MapControlsOverlay';
export { default as MenuStatusOverlay } from './overlay/MenuStatusOverlay';
export { default as ResultsOverlay } from './overlay/ResultsOverlay';
export { default as RouteHudOverlay } from './overlay/RouteHudOverlay';
export { default as SearchGuidanceOverlay } from './overlay/SearchGuidanceOverlay';

const MapUIOverlay: React.FC<MapUIOverlayProps> = memo((props) => {
  const routeUiCollapsed = props.navigating && !props.routeControlsVisible;

  return (
    <>
      <OfflineBanner backendOnline={props.backendOnline} />

      <DriveLegendOverlay
        routeUiCollapsed={routeUiCollapsed}
        navigating={props.navigating}
        driveSegments={props.driveSegments}
        insets={props.insets}
        tachoSummary={props.tachoSummary}
        bluetoothTacho={props.bluetoothTacho}
      />

      <SearchGuidanceOverlay
        routeUiCollapsed={routeUiCollapsed}
        navigating={props.navigating}
        searchTop={props.searchTop}
        customOriginName={props.customOriginName}
        handleDestinationSelect={props.handleDestinationSelect}
        handleClear={props.handleClear}
        handleOriginChange={props.handleOriginChange}
        tunnelWarning={props.tunnelWarning}
        insets={props.insets}
        handleTunnelWarningDismiss={props.handleTunnelWarningDismiss}
        stepToShow={props.stepToShow}
        nextStep={props.nextStep}
        distToTurn={props.distToTurn}
        currentLanes={props.currentLanes}
        aheadEvents={props.aheadEvents}
        truckSituation={props.truckSituation}
        displayLanes={props.displayLanes}
        laneGlowBg={props.laneGlowBg}
        laneGlowShadow={props.laneGlowShadow}
        route={props.route}
        navPhase={props.navPhase}
        routeAheadPOIs={props.routeAheadPOIs}
        handleRouteTimelinePOIPress={props.handleRouteTimelinePOIPress}
        trafficSegments={props.trafficSegments}
        driveSegments={props.driveSegments}
        fasterOffer={props.fasterOffer}
        handleAcceptFasterRoute={props.handleAcceptFasterRoute}
        dismissOffer={props.dismissOffer}
      />

      <MenuStatusOverlay
        routeUiCollapsed={routeUiCollapsed}
        optionsOpen={props.optionsOpen}
        setOptionsOpen={props.setOptionsOpen}
        mapMode={props.mapMode}
        setMapMode={props.setMapMode}
        lightMode={props.lightMode}
        setLightMode={props.setLightMode}
        voiceMuted={props.voiceMuted}
        setVoiceMuted={props.setVoiceMuted}
        mapLayers={props.mapLayers}
        toggleLayer={props.toggleLayer}
        avoidUnpaved={props.avoidUnpaved}
        setAvoidUnpaved={props.setAvoidUnpaved}
        navigating={props.navigating}
        route={props.route}
        simulating={props.simulating}
        startSim={props.startSim}
        stopSim={props.stopSim}
        handleStart={props.handleStart}
        poiCategory={props.poiCategory}
        handlePOISearch={props.handlePOISearch}
        sarMode={props.sarMode}
        handleSARSearch={props.handleSARSearch}
        googleUser={props.googleUser}
        setShowAccountModal={props.setShowAccountModal}
        starredPOIs={props.starredPOIs}
        setBorderCrossings={props.setBorderCrossings}
        setShowBorderPanel={props.setShowBorderPanel}
        searchTop={props.searchTop}
        isSearchingAlongRoute={props.isSearchingAlongRoute}
        handleSearchAlongRoute={props.handleSearchAlongRoute}
        setMapIsLoaded={props.setMapIsLoaded}
        userCoords={props.userCoords}
        drivingSeconds={props.drivingSeconds}
        remainingDriveMin={props.remainingDriveMin}
        handleReportCamera={props.handleReportCamera}
        backendOnline={props.backendOnline}
        gpsReady={props.gpsReady}
        rerouting={props.rerouting}
        loadingRoute={props.loadingRoute}
        showBorderPanel={props.showBorderPanel}
        borderCrossings={props.borderCrossings}
        profile={props.profile}
      />

      <ResultsOverlay
        routeUiCollapsed={routeUiCollapsed}
        navigating={props.navigating}
        route={props.route}
        sarMode={props.sarMode}
        poiResults={props.poiResults}
        loadingPOI={props.loadingPOI}
        searchTop={props.searchTop}
        handlePOINavigate={props.handlePOINavigate}
        clearPOI={props.clearPOI}
        parkingResults={props.parkingResults}
        parkingSource={props.parkingSource}
        setParkingResults={props.setParkingResults}
        setParkingSource={props.setParkingSource}
        navigateTo={props.navigateTo}
        addWaypoint={props.addWaypoint}
        setSelectedParking={props.setSelectedParking}
        remainingDriveMin={props.remainingDriveMin}
        speedKmh={props.speedKmh}
        navigation={props.navigation}
        userCoords={props.userCoords}
        fuelResults={props.fuelResults}
        setFuelResults={props.setFuelResults}
        tachographResult={props.tachographResult}
        tachoSummary={props.tachoSummary}
        setTachographResult={props.setTachographResult}
        businessResults={props.businessResults}
        setBusinessResults={props.setBusinessResults}
        selectedParking={props.selectedParking}
        selectedFuel={props.selectedFuel}
        setSelectedFuel={props.setSelectedFuel}
        drivingSeconds={props.drivingSeconds}
      />

      <RouteHudOverlay
        routeUiCollapsed={routeUiCollapsed}
        routeOptions={props.routeOptions}
        navPhase={props.navPhase}
        selectedRouteIdx={props.selectedRouteIdx}
        routeOptDest={props.routeOptDest}
        restrictionChecking={props.restrictionChecking}
        restrictionWarnings={props.restrictionWarnings}
        insets={props.insets}
        handleSelectRouteOption={props.handleSelectRouteOption}
        setRouteOptions={props.setRouteOptions}
        setRouteOptDest={props.setRouteOptDest}
        setSelectedRouteIdx={props.setSelectedRouteIdx}
        setRestrictionWarnings={props.setRestrictionWarnings}
        handleStartRoute={props.handleStartRoute}
        drivingSeconds={props.drivingSeconds}
        handleExportGPX={props.handleExportGPX}
        truckSituation={props.truckSituation}
        navigating={props.navigating}
        wakeWordHeard={props.wakeWordHeard}
        route={props.route}
        currentStep={props.currentStep}
        distToTurn={props.distToTurn}
        speed={props.speed}
        speedLimit={props.speedLimit}
        remainingSeconds={props.remainingSeconds}
        destination={props.destination}
        destinationName={props.destinationName}
        handleStopNav={props.handleStopNav}
        handleClear={props.handleClear}
        loadingRoute={props.loadingRoute}
        gpsReady={props.gpsReady}
        handleStart={props.handleStart}
        buildElevProfile={props.buildElevProfile}
        fetchWeatherForRoute={props.fetchWeatherForRoute}
        destinationRef={props.destinationRef}
        destinationNameRef={props.destinationNameRef}
        waypointsRef={props.waypointsRef}
        navigateTo={props.navigateTo}
        setParkingResults={props.setParkingResults}
        setRouteControlsVisible={props.setRouteControlsVisible}
        profile={props.profile}
        dominantCongestion={props.dominantCongestion}
        elevProfile={props.elevProfile}
        weatherPoints={props.weatherPoints}
        departLabel={props.departLabel}
        pickDeparture={props.pickDeparture}
        waypoints={props.waypoints}
        waypointNames={props.waypointNames}
        setWaypoints={props.setWaypoints}
        setWaypointNames={props.setWaypointNames}
        userCoords={props.userCoords}
        speedingBg={props.speedingBg}
        proximityAlerts={props.proximityAlerts}
        bluetoothTacho={props.bluetoothTacho}
        urgentParkingResults={props.urgentParkingResults}
        nearestParkingM={props.nearestParkingM}
        hillWarnings={props.hillWarnings}
      />

      <MapControlsOverlay
        routeUiCollapsed={routeUiCollapsed}
        navigating={props.navigating}
        route={props.route}
        routeOptions={props.routeOptions}
        navPhase={props.navPhase}
        insets={props.insets}
        mapPitch={props.mapPitch}
        setMapPitch={props.setMapPitch}
        cameraRef={props.cameraRef}
        geminiChatOpen={props.geminiChatOpen}
        gptChatOpen={props.gptChatOpen}
        setGeminiChatOpen={props.setGeminiChatOpen}
        setGptChatOpen={props.setGptChatOpen}
        backendOnline={props.backendOnline}
        isTracking={props.isTracking}
        setIsTracking={props.setIsTracking}
        suppressPanUntilRef={props.suppressPanUntilRef}
        voiceMuted={props.voiceMuted}
        setVoiceMuted={props.setVoiceMuted}
        handleReportCamera={props.handleReportCamera}
        cameraAlert={props.cameraAlert}
        cameraFlashAnim={props.cameraFlashAnim}
      />

      <ChatAccountOverlay
        routeUiCollapsed={routeUiCollapsed}
        gptChatOpen={props.gptChatOpen}
        geminiChatOpen={props.geminiChatOpen}
        gptHistory={props.gptHistory}
        geminiHistory={props.geminiHistory}
        chatInput={props.chatInput}
        setChatInput={props.setChatInput}
        gptLoading={props.gptLoading}
        geminiLoading={props.geminiLoading}
        handleChat={props.handleChat}
        handleTargetedQuickAction={props.handleTargetedQuickAction}
        isRecording={props.isRecording}
        handleMicStart={props.handleMicStart}
        handleMicStop={props.handleMicStop}
        kbHeight={props.kbHeight}
        gptScrollRef={props.gptScrollRef}
        geminiScrollRef={props.geminiScrollRef}
        googleUser={props.googleUser}
        insets={props.insets}
        micLoading={props.micLoading}
        setGptChatOpen={props.setGptChatOpen}
        setGeminiChatOpen={props.setGeminiChatOpen}
        showAccountModal={props.showAccountModal}
        setShowAccountModal={props.setShowAccountModal}
        setGoogleUser={props.setGoogleUser}
        isMountedRef={props.isMountedRef}
        setStarredPOIs={props.setStarredPOIs}
      />
    </>
  );
});

export default MapUIOverlay;
