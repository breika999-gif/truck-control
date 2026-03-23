import { useState } from 'react';
import type { RouteResult } from '../api/directions';
import type { RouteOption } from '../../../shared/services/backendApi';
import type { DepartLabel } from '../utils/mapUtils';

export interface RouteOptDest {
  name: string;
  coords: [number, number];
  waypoints?: [number, number][];
}

export const useNavigationState = () => {
  const [navigating, setNavigating]           = useState(false);
  const [route, setRoute]                     = useState<RouteResult | null>(null);
  const [destination, setDestination]         = useState<[number, number] | null>(null);
  const [destinationName, setDestinationName] = useState('');
  const [loadingRoute, setLoadingRoute]       = useState(false);
  const [departLabel, setDepartLabel]         = useState<DepartLabel>('СЕГА');
  const [currentStep, setCurrentStep]         = useState(0);
  const [distToTurn, setDistToTurn]           = useState<number | null>(null);
  const [speedLimit, setSpeedLimit]           = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [rerouting, setRerouting]             = useState(false);
  const [simulating, setSimulating]           = useState(false);
  const [routeOptions, setRouteOptions]       = useState<RouteOption[]>([]);
  const [routeOptDest, setRouteOptDest]       = useState<RouteOptDest | null>(null);
  const [selectedRouteIdx, setSelectedRouteIdx] = useState<number | null>(null);
  const [departAt, setDepartAt]               = useState<string | null>(null);
  const [mapPitch, setMapPitch]               = useState(0);
  const [waypoints, setWaypoints]             = useState<[number, number][]>([]);
  const [waypointNames, setWaypointNames]     = useState<string[]>([]);
  const [restrictionChecking, setRestrictionChecking] = useState(false);
  const [restrictionWarnings, setRestrictionWarnings] = useState<string[]>([]);

  return {
    navigating, setNavigating,
    route, setRoute,
    destination, setDestination,
    destinationName, setDestinationName,
    loadingRoute, setLoadingRoute,
    departLabel, setDepartLabel,
    currentStep, setCurrentStep,
    distToTurn, setDistToTurn,
    speedLimit, setSpeedLimit,
    remainingSeconds, setRemainingSeconds,
    rerouting, setRerouting,
    simulating, setSimulating,
    routeOptions, setRouteOptions,
    routeOptDest, setRouteOptDest,
    selectedRouteIdx, setSelectedRouteIdx,
    departAt, setDepartAt,
    mapPitch, setMapPitch,
    waypoints, setWaypoints,
    waypointNames, setWaypointNames,
    restrictionChecking, setRestrictionChecking,
    restrictionWarnings, setRestrictionWarnings,
  };
};
