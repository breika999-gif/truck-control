import { buildTachoRangeGeoJSON } from '../src/features/navigation/utils/tachoRouteRange';
import type { RouteResult } from '../src/features/navigation/api/directions';
import type * as GeoJSON from 'geojson';

describe('tachoRouteRange', () => {
  it('starts the tacho overlay from the route projection instead of raw GPS', () => {
    const routeCoords: [number, number][] = [
      [0, 0],
      [0.1, 0],
      [0.2, 0],
    ];
    const userCoords: [number, number] = [0.05, 0.01];
    const route = {
      distance: 22_000,
      duration: 1_000,
      geometry: { type: 'LineString', coordinates: routeCoords },
      steps: [],
    } as unknown as RouteResult;

    const geojson = buildTachoRangeGeoJSON({
      routeCoords,
      userCoords,
      drivingTimeLeftMin: 5,
      route,
    });
    const firstFeature = geojson.features[0];
    expect(firstFeature).toBeDefined();

    const line = firstFeature.geometry as GeoJSON.LineString;
    const firstCoordinate = line.coordinates[0];
    expect(firstCoordinate[0]).toBeCloseTo(userCoords[0], 5);
    expect(firstCoordinate[1]).toBeCloseTo(0, 5);
    expect(firstCoordinate[1]).not.toBeCloseTo(userCoords[1], 5);
  });
});
