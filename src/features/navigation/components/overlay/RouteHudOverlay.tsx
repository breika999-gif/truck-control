import React from 'react';

import { optimizeWaypointOrder } from '../../api/directions';
import { HOS_LIMIT_S } from '../../utils/mapUtils';
import NavigationHUD from '../NavigationHUD';
import RouteOptionsPanel from '../RouteOptionsPanel';
import TruckSituationRenderer from '../TruckSituationRenderer';
import WakeWordIndicator from '../WakeWordIndicator';
import type { Loose } from './types';

interface RouteHudOverlayProps {
  routeUiCollapsed: boolean;
  routeOptions: Loose[];
  navPhase: Loose;
  selectedRouteIdx: number | null;
  routeOptDest: Loose;
  restrictionChecking: boolean;
  restrictionWarnings: string[];
  insets: Loose;
  handleSelectRouteOption: Loose;
  setRouteOptions: Loose;
  setRouteOptDest: Loose;
  setSelectedRouteIdx: Loose;
  setRestrictionWarnings: Loose;
  handleStartRoute: Loose;
  drivingSeconds: number;
  handleExportGPX: Loose;
  truckSituation: Loose;
  navigating: boolean;
  wakeWordHeard: boolean;
  route: Loose;
  currentStep: number;
  distToTurn: number | null;
  speed: number;
  speedLimit: number | null;
  remainingSeconds: number;
  destination: [number, number] | null;
  destinationName: string;
  handleStopNav: Loose;
  handleClear: Loose;
  loadingRoute: boolean;
  gpsReady: boolean;
  handleStart: Loose;
  buildElevProfile: Loose;
  fetchWeatherForRoute: Loose;
  destinationRef: React.MutableRefObject<[number, number] | null>;
  destinationNameRef: React.MutableRefObject<string>;
  waypointsRef: React.MutableRefObject<[number, number][]>;
  navigateTo: Loose;
  setParkingResults: Loose;
  setRouteControlsVisible: Loose;
  profile: Loose;
  dominantCongestion: Loose;
  elevProfile: number[];
  weatherPoints: Loose[];
  departLabel: Loose;
  pickDeparture: Loose;
  waypoints: [number, number][];
  waypointNames: string[];
  setWaypoints: Loose;
  setWaypointNames: Loose;
  userCoords: [number, number] | null;
  speedingBg: Loose;
  proximityAlerts: Loose;
  bluetoothTacho: Loose;
  urgentParkingResults: Loose[];
  nearestParkingM: number | null;
  hillWarnings: Loose[];
}

const RouteHudOverlay: React.FC<RouteHudOverlayProps> = ({
  routeUiCollapsed,
  routeOptions,
  navPhase,
  selectedRouteIdx,
  routeOptDest,
  restrictionChecking,
  restrictionWarnings,
  insets,
  handleSelectRouteOption,
  setRouteOptions,
  setRouteOptDest,
  setSelectedRouteIdx,
  setRestrictionWarnings,
  handleStartRoute,
  drivingSeconds,
  handleExportGPX,
  truckSituation,
  navigating,
  wakeWordHeard,
  route,
  currentStep,
  distToTurn,
  speed,
  speedLimit,
  remainingSeconds,
  destination,
  destinationName,
  handleStopNav,
  handleClear,
  loadingRoute,
  gpsReady,
  handleStart,
  buildElevProfile,
  fetchWeatherForRoute,
  destinationRef,
  destinationNameRef,
  waypointsRef,
  navigateTo,
  setParkingResults,
  setRouteControlsVisible,
  profile,
  dominantCongestion,
  elevProfile,
  weatherPoints,
  departLabel,
  pickDeparture,
  waypoints,
  waypointNames,
  setWaypoints,
  setWaypointNames,
  userCoords,
  speedingBg,
  proximityAlerts,
  bluetoothTacho,
  urgentParkingResults,
  nearestParkingM,
  hillWarnings,
}) => (
  <>
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

    {!routeUiCollapsed && navigating && <TruckSituationRenderer situation={truckSituation} />}

    {!routeUiCollapsed && <WakeWordIndicator navigating={navigating} wakeWordHeard={wakeWordHeard} topInset={insets.top} />}

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
  </>
);

export default RouteHudOverlay;
