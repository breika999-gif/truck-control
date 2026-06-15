import type { Dispatch, SetStateAction } from 'react';
import { create } from 'zustand';
import type { RouteResult } from '../features/navigation/api/directions';
import type { RouteOption } from '../shared/services/backendApi';
import type { DepartLabel } from '../features/navigation/utils/mapUtils';

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

type Setter<T> = Dispatch<SetStateAction<T>>;

function resolveAction<T>(current: T, action: SetStateAction<T>): T {
  return typeof action === 'function'
    ? (action as (prev: T) => T)(current)
    : action;
}

function phaseFlags(navPhase: NavPhase) {
  return {
    isNavigating: navPhase === 'NAVIGATING' || navPhase === 'REROUTING',
    loadingRoute: navPhase === 'SEARCHING' || navPhase === 'REROUTING',
    rerouting: navPhase === 'REROUTING',
  };
}

export interface NavigationStore {
  navPhase: NavPhase;
  isNavigating: boolean;
  loadingRoute: boolean;
  rerouting: boolean;
  route: RouteResult | null;
  departLabel: DepartLabel;
  currentStepIndex: number;
  distToTurn: number | null;
  speedLimit: number | null;
  remainingDistance: number;
  remainingSeconds: number;
  routeOptions: RouteOption[];
  routeOptDest: RouteOptDest | null;
  selectedRouteIdx: number | null;
  departAt: string | null;
  mapZoom: number;
  waypoints: [number, number][];
  waypointNames: string[];
  restrictionChecking: boolean;
  restrictionWarnings: string[];
  avoidUnpaved: boolean;
  setNavPhase: Setter<NavPhase>;
  setRoute: Setter<RouteResult | null>;
  setDepartLabel: Setter<DepartLabel>;
  setCurrentStepIndex: Setter<number>;
  setDistToTurn: Setter<number | null>;
  setSpeedLimit: Setter<number | null>;
  setRemainingDistance: Setter<number>;
  setRemainingSeconds: Setter<number>;
  setRouteOptions: Setter<RouteOption[]>;
  setRouteOptDest: Setter<RouteOptDest | null>;
  setSelectedRouteIdx: Setter<number | null>;
  setDepartAt: Setter<string | null>;
  setMapZoom: Setter<number>;
  setWaypoints: Setter<[number, number][]>;
  setWaypointNames: Setter<string[]>;
  setRestrictionChecking: Setter<boolean>;
  setRestrictionWarnings: Setter<string[]>;
  setAvoidUnpaved: Setter<boolean>;
}

const initialPhase: NavPhase = 'IDLE';

export const useNavigationStore = create<NavigationStore>()((set) => ({
  navPhase: initialPhase,
  ...phaseFlags(initialPhase),
  route: null,
  departLabel: 'СЕГА',
  currentStepIndex: 0,
  distToTurn: null,
  speedLimit: null,
  remainingDistance: 0,
  remainingSeconds: 0,
  routeOptions: [],
  routeOptDest: null,
  selectedRouteIdx: null,
  departAt: null,
  mapZoom: 15,
  waypoints: [],
  waypointNames: [],
  restrictionChecking: false,
  restrictionWarnings: [],
  avoidUnpaved: false,
  setNavPhase: (action) => set((state) => {
    const navPhase = resolveAction(state.navPhase, action);
    return { navPhase, ...phaseFlags(navPhase) };
  }),
  setRoute: (action) => set((state) => {
    const route = resolveAction(state.route, action);
    return {
      route,
      remainingDistance: route?.distance ?? 0,
    };
  }),
  setDepartLabel: (action) => set((state) => ({ departLabel: resolveAction(state.departLabel, action) })),
  setCurrentStepIndex: (action) => set((state) => ({ currentStepIndex: resolveAction(state.currentStepIndex, action) })),
  setDistToTurn: (action) => set((state) => ({ distToTurn: resolveAction(state.distToTurn, action) })),
  setSpeedLimit: (action) => set((state) => ({ speedLimit: resolveAction(state.speedLimit, action) })),
  setRemainingDistance: (action) => set((state) => ({ remainingDistance: resolveAction(state.remainingDistance, action) })),
  setRemainingSeconds: (action) => set((state) => ({ remainingSeconds: resolveAction(state.remainingSeconds, action) })),
  setRouteOptions: (action) => set((state) => ({ routeOptions: resolveAction(state.routeOptions, action) })),
  setRouteOptDest: (action) => set((state) => ({ routeOptDest: resolveAction(state.routeOptDest, action) })),
  setSelectedRouteIdx: (action) => set((state) => ({ selectedRouteIdx: resolveAction(state.selectedRouteIdx, action) })),
  setDepartAt: (action) => set((state) => ({ departAt: resolveAction(state.departAt, action) })),
  setMapZoom: (action) => set((state) => ({ mapZoom: resolveAction(state.mapZoom, action) })),
  setWaypoints: (action) => set((state) => ({ waypoints: resolveAction(state.waypoints, action) })),
  setWaypointNames: (action) => set((state) => ({ waypointNames: resolveAction(state.waypointNames, action) })),
  setRestrictionChecking: (action) => set((state) => ({ restrictionChecking: resolveAction(state.restrictionChecking, action) })),
  setRestrictionWarnings: (action) => set((state) => ({ restrictionWarnings: resolveAction(state.restrictionWarnings, action) })),
  setAvoidUnpaved: (action) => set((state) => ({ avoidUnpaved: resolveAction(state.avoidUnpaved, action) })),
}));
