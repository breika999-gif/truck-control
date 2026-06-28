import React from 'react';

import { spacing } from '../../../../shared/constants/theme';
import FasterRouteBanner from '../FasterRouteBanner';
import LaneGuidanceStrip from '../LaneGuidanceStrip';
import NavigationTopPanel from '../NavigationTopPanel';
import RouteTimeline from '../RouteTimeline';
import SearchBarContainer from '../SearchBarContainer';
import TunnelWarningBanner from '../TunnelWarningBanner';
import type { Loose } from './types';

interface SearchGuidanceOverlayProps {
  routeUiCollapsed: boolean;
  navigating: boolean;
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
  navPhase: Loose;
  routeAheadPOIs: Loose[];
  handleRouteTimelinePOIPress: Loose;
  trafficSegments: Loose[];
  driveSegments: Loose;
  fasterOffer: Loose;
  handleAcceptFasterRoute: Loose;
  dismissOffer: Loose;
}

const SearchGuidanceOverlay: React.FC<SearchGuidanceOverlayProps> = ({
  routeUiCollapsed,
  navigating,
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
  navPhase,
  routeAheadPOIs,
  handleRouteTimelinePOIPress,
  trafficSegments,
  driveSegments,
  fasterOffer,
  handleAcceptFasterRoute,
  dismissOffer,
}) => (
  <>
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

    {!routeUiCollapsed && route && (navigating || navPhase === 'ROUTE_PREVIEW') && (
      <RouteTimeline
        routeAheadPOIs={routeAheadPOIs}
        totalDistM={route.distance}
        onPOIPress={handleRouteTimelinePOIPress}
        trafficSegments={trafficSegments}
        driveSegments={driveSegments}
      />
    )}

    <FasterRouteBanner
      offer={routeUiCollapsed ? null : fasterOffer}
      onAccept={handleAcceptFasterRoute}
      onDismiss={dismissOffer}
      top={insets.top + 8}
    />
  </>
);

export default SearchGuidanceOverlay;
