import { useMemo } from 'react';
import type * as GeoJSON from 'geojson';
import { haversineMeters } from '../utils/mapUtils';
import type { POICard, SavedPOI } from '../../../shared/services/backendApi';
import type { RouteResult } from '../api/directions';
import type { WeatherPoint } from '../hooks/useRouteInsights';
import type { TruckPOI } from '../api/poi';

interface UseMapGeoJSONProps {
  parkingResults: POICard[];
  fuelResults: POICard[];
  businessResults: POICard[];
  cameraResults: POICard[];
  waypoints: [number, number][];
  poiResults: TruckPOI[];
  weatherPoints: WeatherPoint[];
  route: RouteResult | null;
  navigating: boolean;
  userCoords: [number, number] | null;
  navCongestionGeoJSON: GeoJSON.FeatureCollection | null;
  overtakingResults: any[];
  starredPOIs: SavedPOI[];
}

/**
 * useMapGeoJSON - Optimized for Google Maps.
 * Only calculates traffic congestion segments.
 * Other POIs are now rendered as native Markers in MapScreen.
 */
export const useMapGeoJSON = ({
  userCoords,
  navigating,
  navCongestionGeoJSON,
}: UseMapGeoJSONProps) => {

  const navCongestionVisible = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!navigating || !userCoords || !navCongestionGeoJSON) return null;
    
    // Performance optimization: Only show congestion features within 15km of user
    const MAX_M = 15_000;
    const features = navCongestionGeoJSON.features.filter(f => {
      const coords = (f.geometry as GeoJSON.LineString).coordinates;
      if (!coords?.length) return false;
      const [lng, lat] = coords[0] as [number, number];
      return haversineMeters(userCoords, [lng, lat]) <= MAX_M;
    });
    
    return { type: 'FeatureCollection', features };
  }, [navigating, userCoords, navCongestionGeoJSON]);

  return {
    navCongestionVisible,
  };
};
