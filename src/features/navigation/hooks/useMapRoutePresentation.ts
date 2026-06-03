import { useMemo } from 'react';

import type { VehicleProfile } from '../../../shared/types/vehicle';
import type { POICard, TachoSummary } from '../../../shared/services/backendApi';
import type { RestrictionPoint, RouteResult } from '../api/directions';
import type { MapMode } from './useMapUIState';
import type { NavPhase } from './useNavigationState';
import { calculateDriveSegments } from '../utils/driveSegments';
import { HOS_LIMIT_S, haversineMeters } from '../utils/mapUtils';
import {
  MAX_MAP_RESTRICTION_MARKERS,
  extractTrafficSegments,
  isHighSignalMapRestriction,
  isRestrictionCloseToRoute,
  isRestrictionRelevantToProfile,
  restrictionDistanceToRouteM,
  restrictionDisplayRank,
  trafficAlertSeverity,
  truckCappedRouteDurationS,
} from '../utils/mapScreenUtils';
import { useRouteAheadEvents } from './useRouteAheadEvents';
import { selectTruckSituation } from '../utils/truckSituationSelector';

type RouteTrafficAlert = {
  lat?: number;
  lng?: number;
  delay_min?: number;
  delayMin?: number;
  severity?: string;
  label?: string;
  roadName?: string;
};

interface UseMapRoutePresentationArgs {
  currentStep: number;
  distToTurn: number | null;
  drivingSeconds: number;
  lightMode: boolean;
  mapMode: MapMode;
  navigating: boolean;
  navPhase: NavPhase;
  parkingResults: POICard[];
  profile: VehicleProfile | null;
  remainingSeconds: number;
  route: RouteResult | null;
  tachoSummary: TachoSummary | null;
  userCoords: [number, number] | null;
}

export function useMapRoutePresentation({
  currentStep,
  distToTurn,
  drivingSeconds,
  lightMode,
  mapMode,
  navigating,
  navPhase,
  parkingResults,
  profile,
  remainingSeconds,
  route,
  tachoSummary,
  userCoords,
}: UseMapRoutePresentationArgs) {
  const nearestParkingM = useMemo(
    () => parkingResults.length ? Math.min(...parkingResults.map(parking => parking.distance_m)) : null,
    [parkingResults],
  );
  const dominantCongestion = useMemo(() => {
    const congestion = route?.congestion;
    if (!congestion?.length) return null;
    if (congestion.some(value => value === 'severe' || value === 'heavy')) return 'heavy';
    return congestion.some(value => value === 'moderate') ? 'moderate' : 'low';
  }, [route]);
  const routeRestrictionPoints = useMemo<RestrictionPoint[]>(() => {
    const coords = route?.geometry.coordinates ?? [];
    return (route?.restrictions ?? []).filter(
      restriction => isRestrictionRelevantToProfile(restriction, profile) && isRestrictionCloseToRoute(restriction, coords),
    );
  }, [profile, route?.geometry.coordinates, route?.restrictions]);
  const displayRestrictionPoints = useMemo<RestrictionPoint[]>(() => {
    const coords = route?.geometry.coordinates ?? [];
    return routeRestrictionPoints
      .filter(restriction => isHighSignalMapRestriction(restriction, profile))
      .slice()
      .sort((first, second) => {
        const rankDiff = restrictionDisplayRank(first, profile) - restrictionDisplayRank(second, profile);
        return rankDiff || restrictionDistanceToRouteM(first, coords) - restrictionDistanceToRouteM(second, coords);
      })
      .slice(0, MAX_MAP_RESTRICTION_MARKERS);
  }, [profile, route?.geometry.coordinates, routeRestrictionPoints]);
  const routeLineColor = dominantCongestion === 'heavy' ? '#FF3B30'
    : dominantCongestion === 'moderate' ? '#FF9500'
    : '#13BDFF';
  const routeProgressFraction = useMemo(() => {
    if (!navigating || !userCoords || !route?.geometry.coordinates.length || route.distance <= 0) return 0;
    const coords = route.geometry.coordinates;
    let nearestIdx = 0;
    let minDist = Infinity;
    for (let i = 0; i < coords.length; i++) {
      const dx = (coords[i][0] - userCoords[0]) * 111320 * Math.cos(userCoords[1] * Math.PI / 180);
      const dy = (coords[i][1] - userCoords[1]) * 110540;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < minDist) { minDist = distance; nearestIdx = i; }
    }
    let traveled = 0;
    for (let i = 1; i <= nearestIdx; i++) {
      const dx = (coords[i][0] - coords[i - 1][0]) * 111320 * Math.cos(coords[i][1] * Math.PI / 180);
      const dy = (coords[i][1] - coords[i - 1][1]) * 110540;
      traveled += Math.sqrt(dx * dx + dy * dy);
    }
    return Math.min(0.98, traveled / route.distance);
  }, [navigating, route, userCoords]);
  const trafficSegments = useMemo(
    () => extractTrafficSegments(route?.congestionGeoJSON ?? null, route?.distance ?? 0),
    [route?.congestionGeoJSON, route?.distance],
  );
  const trafficAheadAlerts = useMemo(() => {
    if (!userCoords || !route?.traffic_alerts?.length) return null;
    return (route.traffic_alerts as RouteTrafficAlert[])
      .filter(alert => Number.isFinite(alert.lat) && Number.isFinite(alert.lng))
      .map(alert => ({
        distM: haversineMeters(userCoords, [alert.lng as number, alert.lat as number]),
        severity: trafficAlertSeverity(alert.severity),
        delayMin: Math.max(0, Math.round(Number(alert.delay_min ?? alert.delayMin ?? 0))),
        roadName: alert.roadName ?? alert.label ?? '',
      }));
  }, [route?.traffic_alerts, userCoords]);
  const driveSegments = useMemo(
    () => route ? calculateDriveSegments(
      route,
      Math.max(0, HOS_LIMIT_S - drivingSeconds),
      trafficAheadAlerts,
      tachoSummary ? {
        dailyLimitH: tachoSummary.daily_limit_h,
        reducedRestsRemaining: tachoSummary.reduced_rests_remaining,
        dailyDrivenSeconds: (tachoSummary.daily_driven_s ?? 0)
          + Math.max(0, drivingSeconds - (tachoSummary.continuous_driven_s ?? 0)),
      } : null,
    ) : null,
    [drivingSeconds, route, tachoSummary, trafficAheadAlerts],
  );
  const aheadEvents = useRouteAheadEvents({
    steps: route?.steps ?? [],
    currentStepIdx: currentStep,
    distToTurn,
    restrictions: routeRestrictionPoints,
    maxspeeds: route?.maxspeeds,
    traffic_alerts: trafficAheadAlerts,
    userCoords,
    profile,
    remainingTachoSec: navigating ? Math.max(0, HOS_LIMIT_S - drivingSeconds) : undefined,
    totalRouteDistM: route?.distance,
    routeDurationSec: route
      ? truckCappedRouteDurationS(route.distance, remainingSeconds > 0 ? remainingSeconds : route.duration)
      : undefined,
  });
  const truckSituation = useMemo(() => selectTruckSituation(aheadEvents), [aheadEvents]);
  const useNavigationMapStyle = navigating || navPhase === 'NAVIGATING' || navPhase === 'REROUTING';
  const mapStyleURL = mapMode === 'hybrid' ? 'mapbox://styles/mapbox/satellite-streets-v12'
    : useNavigationMapStyle ? (lightMode ? 'mapbox://styles/mapbox/navigation-day-v1' : 'mapbox://styles/mapbox/navigation-night-v1')
    : JSON.stringify({ version: 8, imports: [{ id: 'basemap', url: 'mapbox://styles/mapbox/standard', config: {
      lightPreset: lightMode ? 'day' : 'night',
      showPointOfInterestLabels: false, showTransitLabels: true, showPlaceLabels: true,
      showRoadLabels: true, showTrafficIncidents: true,
    } }] });
  const activeStep = route?.steps?.[currentStep];
  const nextStep = route?.steps?.[currentStep + 1];
  const stepToShow = navigating ? activeStep : null;
  const currentLanes = useMemo(() => {
    const components = stepToShow?.bannerInstructions?.[0]?.sub?.components;
    return Array.isArray(components) ? components.filter(component => component.type === 'lane') : [];
  }, [stepToShow]);

  return {
    aheadEvents,
    currentLanes,
    displayLanes: currentLanes,
    displayRestrictionPoints,
    dominantCongestion,
    driveSegments,
    lanePulseOn: navigating && distToTurn != null && distToTurn < 350 && currentLanes.some(lane => lane.active),
    mapStyleURL,
    nearestParkingM,
    nextStep,
    routeLineColor,
    routeProgressFraction,
    routeRestrictionPoints,
    stepToShow,
    trafficAheadAlerts,
    trafficSegments,
    truckSituation,
  };
}
