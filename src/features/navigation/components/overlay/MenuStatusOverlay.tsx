import React from 'react';

import BorderCrossingsPanel from '../BorderCrossingsPanel';
import OptionsPanel from '../OptionsPanel';
import StatusChips from '../StatusChips';
import VehicleBadge from '../VehicleBadge';
import type { Loose } from './types';

interface MenuStatusOverlayProps {
  routeUiCollapsed: boolean;
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
  navigating: boolean;
  route: Loose;
  simulating: boolean;
  startSim: Loose;
  stopSim: Loose;
  handleStart: Loose;
  poiCategory: Loose;
  handlePOISearch: Loose;
  sarMode: boolean;
  handleSARSearch: Loose;
  googleUser: Loose;
  setShowAccountModal: Loose;
  starredPOIs: Loose[];
  setBorderCrossings: Loose;
  setShowBorderPanel: Loose;
  searchTop: number;
  isSearchingAlongRoute: boolean;
  handleSearchAlongRoute: Loose;
  setMapIsLoaded: Loose;
  userCoords: [number, number] | null;
  drivingSeconds: number;
  remainingDriveMin?: number;
  handleReportCamera: Loose;
  backendOnline: boolean;
  gpsReady: boolean;
  rerouting: boolean;
  loadingRoute: boolean;
  showBorderPanel: boolean;
  borderCrossings: Loose[];
  profile: Loose;
}

const MenuStatusOverlay: React.FC<MenuStatusOverlayProps> = ({
  routeUiCollapsed,
  optionsOpen,
  setOptionsOpen,
  mapMode,
  setMapMode,
  lightMode,
  setLightMode,
  voiceMuted,
  setVoiceMuted,
  mapLayers,
  toggleLayer,
  avoidUnpaved,
  setAvoidUnpaved,
  navigating,
  route,
  simulating,
  startSim,
  stopSim,
  handleStart,
  poiCategory,
  handlePOISearch,
  sarMode,
  handleSARSearch,
  googleUser,
  setShowAccountModal,
  starredPOIs,
  setBorderCrossings,
  setShowBorderPanel,
  searchTop,
  isSearchingAlongRoute,
  handleSearchAlongRoute,
  setMapIsLoaded,
  userCoords,
  drivingSeconds,
  remainingDriveMin,
  handleReportCamera,
  backendOnline,
  gpsReady,
  rerouting,
  loadingRoute,
  showBorderPanel,
  borderCrossings,
  profile,
}) => {
  if (routeUiCollapsed) return null;

  return (
    <>
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
      />

      <StatusChips gpsReady={gpsReady || simulating} rerouting={rerouting} loadingRoute={loadingRoute} />

      <BorderCrossingsPanel
        show={showBorderPanel}
        crossings={borderCrossings}
        onClose={() => setShowBorderPanel(false)}
      />

      <VehicleBadge plate={profile?.plate} navigating={navigating} searchTop={searchTop} />
    </>
  );
};

export default MenuStatusOverlay;
