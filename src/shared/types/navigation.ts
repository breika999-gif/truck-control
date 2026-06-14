export interface DispatcherRoutePlan {
  requestId: string;
  destination: [number, number];
  destinationName: string;
  waypoints: [number, number][];
  waypointNames: string[];
}

export type RootStackParamList = {
  Map: {
    dispatcherPlan?: DispatcherRoutePlan;
    initialCenter?: [number, number];
    selectedPOI?: unknown;
  } | undefined;
  VehicleProfile: undefined;
  POIList: undefined;
  Tacho: undefined;
  TruckBans: undefined;
  TruckParking: {
    userCoords?: [number, number];
    url?: string;
    selectedCoords?: [number, number];
    selectedName?: string;
    routeCoords?: [number, number][];
    routeDurationS?: number;
    remainingDriveMin?: number;
  };
  Dispatcher: {
    userCoords?: [number, number];
    remainingDriveSeconds?: number;
  } | undefined;
  OfflineMaps: undefined;
  Licenses: undefined;
};
