import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ToastAndroid } from 'react-native';

import { BACKEND_URL } from '../../../shared/constants/config';
import type { VehicleProfile } from '../../../shared/types/vehicle';
import type { POICard, TachoSummary } from '../../../shared/services/backendApi';
import type { RestrictionPoint, RouteResult } from '../api/directions';
import type { MapMode } from './useMapUIState';
import type { NavPhase } from './useNavigationState';
import { calculateDriveSegments } from '../utils/driveSegments';
import { useVehicleStore } from '../../../store/vehicleStore';
import {
  buildGradeProfile,
  sampleRouteCoords,
  sampleRouteFractions,
  type GradeProfile,
} from '../utils/gradeProfile';
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

function elevationRouteKey(route: RouteResult | null): string {
  const coords = route?.geometry.coordinates;
  if (!coords?.length) return '';
  const first = coords[0];
  const mid = coords[Math.floor(coords.length / 2)];
  const last = coords[coords.length - 1];
  return [coords.length, route?.distance ?? 0, first, mid, last]
    .map(part => Array.isArray(part) ? `${part[0].toFixed(5)},${part[1].toFixed(5)}` : String(part))
    .join('|');
}

function routeFractionForPoint(coords: [number, number][], point: [number, number]): number {
  if (coords.length < 2) return 0;
  const cumulative = [0];
  let total = 0;
  let nearestIdx = 0;
  let nearestDist = Infinity;

  coords.forEach((coord, index) => {
    const distance = haversineMeters(coord, point);
    if (distance < nearestDist) {
      nearestDist = distance;
      nearestIdx = index;
    }
    if (index > 0) {
      total += haversineMeters(coords[index - 1], coord);
      cumulative[index] = total;
    }
  });

  return total > 0 ? Math.max(0, Math.min(1, cumulative[nearestIdx] / total)) : 0;
}

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
  const isLoaded = useVehicleStore(state => state.isLoaded);
  const [gradeProfile, setGradeProfile] = useState<GradeProfile | null>(null);
  const warnedWeightRestrictionKeyRef = useRef<string | null>(null);
  const routeElevationKey = useMemo(() => elevationRouteKey(route), [route]);

  useEffect(() => {
    const coords = route?.geometry.coordinates;
    if (!coords || coords.length < 2) {
      setGradeProfile(null);
      return;
    }

    const sampledCoords = sampleRouteCoords(coords, 80);
    const sampledFractions = sampleRouteFractions(coords, 80);
    if (sampledCoords.length < 2 || sampledCoords.length !== sampledFractions.length) {
      setGradeProfile(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);

    fetch(`${BACKEND_URL}/api/elevation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coords: sampledCoords }),
      signal: controller.signal,
    })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (cancelled) return;
        const elevations = data?.elevations;
        if (
          Array.isArray(elevations) &&
          elevations.length === sampledCoords.length &&
          elevations.every((value: unknown) => Number.isFinite(Number(value)))
        ) {
          setGradeProfile(buildGradeProfile(sampledCoords, elevations.map(Number), sampledFractions));
        } else {
          setGradeProfile(null);
        }
      })
      .catch(() => {
        if (!cancelled) setGradeProfile(null);
      })
      .finally(() => clearTimeout(timeout));

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [route, routeElevationKey]);

  useEffect(() => {
    warnedWeightRestrictionKeyRef.current = null;
  }, [routeElevationKey]);

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
      gradeProfile,
      isLoaded,
    ) : null,
    [drivingSeconds, gradeProfile, isLoaded, route, tachoSummary, trafficAheadAlerts],
  );
  const weightRestrictionAhead = useMemo(() => {
    const coords = route?.geometry.coordinates ?? [];
    if (!isLoaded || !navigating || coords.length < 2) return null;
    return routeRestrictionPoints.find(restriction => {
      const rawLimit = Number(restriction.value_num);
      const limitT = rawLimit > 1000 ? rawLimit / 1000 : rawLimit;
      if (restriction.type !== 'maxweight' || !Number.isFinite(limitT) || limitT >= 20) return false;
      const restrictionFraction = routeFractionForPoint(coords, [restriction.lng, restriction.lat]);
      return restrictionFraction >= Math.max(0, routeProgressFraction - 0.02);
    }) ?? null;
  }, [isLoaded, navigating, route?.geometry.coordinates, routeProgressFraction, routeRestrictionPoints]);

  useEffect(() => {
    if (!weightRestrictionAhead || !navigating || !isLoaded) return;
    const key = `${weightRestrictionAhead.type}:${weightRestrictionAhead.lng.toFixed(5)},${weightRestrictionAhead.lat.toFixed(5)}:${weightRestrictionAhead.value}`;
    if (warnedWeightRestrictionKeyRef.current === key) return;
    warnedWeightRestrictionKeyRef.current = key;
    if (Platform.OS === 'android') {
      ToastAndroid.show('⚠️ Weight restriction ahead', ToastAndroid.LONG);
    }
  }, [isLoaded, navigating, weightRestrictionAhead]);

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
    gradeProfile,
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
