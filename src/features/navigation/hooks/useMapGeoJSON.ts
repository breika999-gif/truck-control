import { useMemo } from 'react';
import type * as GeoJSON from 'geojson';
import { haversineMeters, nearestRouteMatch } from '../utils/mapUtils';
import type { RouteResult } from '../api/directions';
import type { GradeProfile } from '../utils/gradeProfile';
import { buildTachoRangeGeoJSON as buildTachoRange } from '../utils/tachoRouteRange';

interface UseMapGeoJSONProps {
  route: RouteResult | null;
  navigating: boolean;
  userCoords: [number, number] | null;
  navCongestionGeoJSON: GeoJSON.FeatureCollection | null;
  tachoDrivingTimeLeftMin?: number | null;
  isLoaded?: boolean;
  gradeProfile?: GradeProfile | null;
}

export function buildTachoRangeGeoJSON(
  routeCoords: [number, number][],
  userCoords: [number, number] | null,
  drivingTimeLeftMin: number | null | undefined,
  isLoaded = false,
  route?: RouteResult | null,
  gradeProfile?: GradeProfile | null,
): GeoJSON.FeatureCollection {
  return buildTachoRange({
    routeCoords,
    userCoords,
    drivingTimeLeftMin,
    isLoaded,
    route,
    gradeProfile,
  });
}

export const useMapGeoJSON = ({
  route,
  navigating,
  userCoords,
  navCongestionGeoJSON,
  tachoDrivingTimeLeftMin,
  isLoaded = false,
  gradeProfile,
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
    if (!navigating || !userCoords || !navCongestionGeoJSON || !route) return null;
    
    const routeCoords = route.geometry.coordinates;
    const userMatch = nearestRouteMatch(userCoords, routeCoords);
    const userIdx = userMatch.bestIndex;

    const MAX_LOOKAHEAD_M = 15_000;
    const features: GeoJSON.Feature[] = [];

    for (const f of navCongestionGeoJSON.features) {
      const endIdx = (f.properties?.endIdx as number) ?? 0;
      // Skip if entire segment is behind us
      if (endIdx < userIdx) continue;

      const fGeom = f.geometry as GeoJSON.LineString;
      const fCoords = fGeom.coordinates;
      if (!fCoords?.length) continue;

      // Start of this segment in global route coords
      const startIdx = endIdx - (fCoords.length - 1);

      let visibleCoords = fCoords;

      // If we are currently inside this segment, slice it
      if (userIdx > startIdx && userIdx <= endIdx) {
        const localIdx = userIdx - startIdx;
        // Keep the traffic overlay snapped to route geometry. Prepending raw
        // GPS coordinates can draw a diagonal line when the driver is slightly
        // off-route or the matched index lands ahead of the current segment.
        visibleCoords = fCoords.slice(Math.max(0, localIdx));
      }

      // Optimization: skip if segment starts too far ahead
      const [firstLng, firstLat] = visibleCoords[0] as [number, number];
      if (haversineMeters(userCoords, [firstLng, firstLat]) > MAX_LOOKAHEAD_M) {
        // Since features are in order, we could break here if we were sure.
        // For now, continue to be safe.
        continue;
      }

      features.push({
        ...f,
        geometry: { ...fGeom, coordinates: visibleCoords },
      });
    }

    return { type: 'FeatureCollection', features };
  }, [navigating, userCoords, navCongestionGeoJSON, route]);

  const tachoRangeGeoJSON = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!navigating || !route || !userCoords) {
      return { type: 'FeatureCollection', features: [] };
    }
    return buildTachoRangeGeoJSON(
      route.geometry.coordinates,
      userCoords,
      tachoDrivingTimeLeftMin,
      isLoaded,
      route,
      gradeProfile,
    );
  }, [gradeProfile, isLoaded, navigating, route, tachoDrivingTimeLeftMin, userCoords]);

  return { exitsGeoJSON, navCongestionVisible, tachoRangeGeoJSON };
};
