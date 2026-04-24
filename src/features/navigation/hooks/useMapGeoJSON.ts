import { useMemo } from 'react';
import type * as GeoJSON from 'geojson';
import { POI_META } from '../api/poi';
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

export const useMapGeoJSON = ({
  parkingResults,
  fuelResults,
  businessResults,
  cameraResults,
  waypoints,
  poiResults,
  weatherPoints,
  route,
  navigating,
  userCoords,
  navCongestionGeoJSON,
  overtakingResults,
  starredPOIs,
}: UseMapGeoJSONProps) => {
  const parkingGeoJSON = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: parkingResults
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.lat && p.lng)
      .map(({ p, i }) => ({
        type: 'Feature' as const,
        id: i,
        geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
        properties: { index: i, name: p.name },
      })),
  }), [parkingResults]);

  const fuelGeoJSON = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: fuelResults.filter(f => f.lat && f.lng).map((f, i) => ({
      type: 'Feature' as const,
      id: i,
      geometry: { type: 'Point' as const, coordinates: [f.lng, f.lat] },
      properties: {},
    })),
  }), [fuelResults]);

  const businessGeoJSON = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: businessResults.map((b, i) => ({
      type: 'Feature' as const,
      id: i,
      geometry: { type: 'Point' as const, coordinates: [b.lng, b.lat] },
      properties: {},
    })),
  }), [businessResults]);

  const cameraGeoJSON = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: cameraResults.filter(c => c.lat && c.lng).map((c, i) => ({
      type: 'Feature' as const,
      id: i,
      geometry: { type: 'Point' as const, coordinates: [c.lng, c.lat] },
      properties: { maxspeed: c.maxspeed ? String(c.maxspeed) : '' },
    })),
  }), [cameraResults]);

  const waypointsGeoJSON = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: waypoints.map((coords, i) => ({
      type: 'Feature' as const,
      id: i,
      geometry: { type: 'Point' as const, coordinates: coords },
      properties: { label: String(i + 1) },
    })),
  }), [waypoints]);

  const poiResultsGeoJSON = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: poiResults.map((poi, i) => ({
      type: 'Feature' as const,
      id: i,
      geometry: { type: 'Point' as const, coordinates: poi.coordinates },
      properties: { index: i, emoji: POI_META[poi.category].emoji, poiId: poi.id },
    })),
  }), [poiResults]);

  const weatherGeoJSON = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: weatherPoints.map((wp, i) => ({
      type: 'Feature' as const,
      id: i,
      geometry: { type: 'Point' as const, coordinates: wp.coords },
      properties: { label: `${wp.emoji}\n${wp.temp}°` },
    })),
  }), [weatherPoints]);

  const exitsGeoJSON = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!route) return { type: 'FeatureCollection', features: [] };
    const features: GeoJSON.Feature[] = [];
    route.steps.forEach((step, i) => {
      const type = step.maneuver.type;
      if (type !== 'off ramp' && type !== 'exit motorway') return;
      const loc = step.intersections?.[0]?.location;
      if (!loc) return;
      const banner = step.bannerInstructions?.[0];
      const exitNum = banner?.primary?.components?.find(c => c.type === 'exit-number')?.text ?? null;
      const destName = banner?.primary?.components?.find(c => c.type === 'text')?.text
        ?? step.name
        ?? '';
      features.push({
        type: 'Feature' as const,
        id: i,
        geometry: { type: 'Point' as const, coordinates: loc },
        properties: {
          exitNum: exitNum ?? '',
          label: exitNum ? `⬡${exitNum}` : '⬡',
          dest: destName,
        },
      });
    });
    return { type: 'FeatureCollection', features };
  }, [route]);

  const navCongestionVisible = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!navigating || !userCoords || !navCongestionGeoJSON) return null;
    const MAX_M = 15_000;
    const features = navCongestionGeoJSON.features.filter(f => {
      const coords = (f.geometry as GeoJSON.LineString).coordinates;
      if (!coords?.length) return false;
      const [lng, lat] = coords[0] as [number, number];
      return haversineMeters(userCoords, [lng, lat]) <= MAX_M;
    });
    return { type: 'FeatureCollection', features };
  }, [navigating, userCoords, navCongestionGeoJSON]);

  const overtakingGeoJSON = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: overtakingResults.map((r, i) => ({
      type: 'Feature' as const,
      id: i,
      geometry: { type: 'Point' as const, coordinates: [r.lng, r.lat] },
      properties: { ...r },
    })),
  }), [overtakingResults]);

  const starGeoJSON = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: starredPOIs.map((p, i) => ({
      type: 'Feature' as const,
      id: i,
      geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
      properties: { name: p.name },
    })),
  }), [starredPOIs]);

  return {
    parkingGeoJSON,
    fuelGeoJSON,
    businessGeoJSON,
    cameraGeoJSON,
    waypointsGeoJSON,
    poiResultsGeoJSON,
    weatherGeoJSON,
    exitsGeoJSON,
    navCongestionVisible,
    overtakingGeoJSON,
    starGeoJSON,
  };
};
