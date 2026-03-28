import { useState } from 'react';
import type { RouteResult } from '../api/directions';
import type { RouteOption } from '../../../shared/services/backendApi';
import type { DepartLabel } from '../utils/mapUtils';

export type NavPhase =
  | 'IDLE'           // no destination set
  | 'SEARCHING'      // fetching route, not yet navigating
  | 'ROUTE_PREVIEW'  // route ready, user hasn't started yet
  | 'NAVIGATING'     // active turn-by-turn navigation
  | 'REROUTING';     // navigating + fetching a new route after deviation

export interface RouteOptDest {
  name: string;
  coords: [number, number];
  waypoints?: [number, number][];
}

export const useNavigationState = () => {
  const [navPhase, setNavPhase]               = useState<NavPhase>('IDLE');
  const [route, setRoute]                     = useState<RouteResult | null>(null);
  const [destination, setDestination]         = useState<[number, number] | null>(null);
  const [destinationName, setDestinationName] = useState('');
  const [departLabel, setDepartLabel]         = useState<DepartLabel>('СЕГА');
  const [currentStep, setCurrentStep]         = useState(0);
  const [distToTurn, setDistToTurn]           = useState<number | null>(null);
  const [speedLimit, setSpeedLimit]           = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [simulating, setSimulating]           = useState(false);
  const [routeOptions, setRouteOptions]       = useState<RouteOption[]>([]);
  const [routeOptDest, setRouteOptDest]       = useState<RouteOptDest | null>(null);
  const [selectedRouteIdx, setSelectedRouteIdx] = useState<number | null>(null);
  const [departAt, setDepartAt]               = useState<string | null>(null);
  const [mapPitch, setMapPitch]               = useState(0);
  const [mapZoom, setMapZoom]                 = useState(15);
  const [waypoints, setWaypoints]             = useState<[number, number][]>([]);
  const [waypointNames, setWaypointNames]     = useState<string[]>([]);
  const [restrictionChecking, setRestrictionChecking] = useState(false);
  const [restrictionWarnings, setRestrictionWarnings] = useState<string[]>([]);
  const [avoidUnpaved, setAvoidUnpaved]       = useState(false);

  // Derived booleans — single source of truth is navPhase
  const navigating   = navPhase === 'NAVIGATING' || navPhase === 'REROUTING';
  const loadingRoute = navPhase === 'SEARCHING'  || navPhase === 'REROUTING';
  const rerouting    = navPhase === 'REROUTING';

  return {
    navPhase, setNavPhase,
    navigating,
    loadingRoute,
    rerouting,
    route, setRoute,
    destination, setDestination,
    destinationName, setDestinationName,
    departLabel, setDepartLabel,
    currentStep, setCurrentStep,
    distToTurn, setDistToTurn,
    speedLimit, setSpeedLimit,
    remainingSeconds, setRemainingSeconds,
    simulating, setSimulating,
    routeOptions, setRouteOptions,
    routeOptDest, setRouteOptDest,
    selectedRouteIdx, setSelectedRouteIdx,
    departAt, setDepartAt,
    mapPitch, setMapPitch,
    mapZoom, setMapZoom,
    waypoints, setWaypoints,
    waypointNames, setWaypointNames,
    restrictionChecking, setRestrictionChecking,
    restrictionWarnings, setRestrictionWarnings,
    avoidUnpaved, setAvoidUnpaved,
  };
};
