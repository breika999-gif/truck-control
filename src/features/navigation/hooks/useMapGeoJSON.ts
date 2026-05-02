import { useMemo } from 'react';
import type * as GeoJSON from 'geojson';
import { haversineMeters } from '../utils/mapUtils';
import type { RouteResult } from '../api/directions';

interface UseMapGeoJSONProps {
  route: RouteResult | null;
  navigating: boolean;
  userCoords: [number, number] | null;
  navCongestionGeoJSON: GeoJSON.FeatureCollection | null;
}

export const useMapGeoJSON = ({
  route,
  navigating,
  userCoords,
  navCongestionGeoJSON,
}: UseMapGeoJSONProps) => {
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

  return { exitsGeoJSON, navCongestionVisible };
};
