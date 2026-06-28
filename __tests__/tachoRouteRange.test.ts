import { buildTachoRangeGeoJSON } from '../src/features/navigation/utils/tachoRouteRange';
import { buildDriveMilestonesGeoJSON, calculateDriveSegments } from '../src/features/navigation/utils/driveSegments';
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

  it('builds stable HOS milestone markers without trimming the route line', () => {
    const routeCoords: [number, number][] = [
      [0, 0],
      [1, 0],
    ];
    const route = {
      distance: 100_000,
      duration: 11 * 3600,
      geometry: { type: 'LineString', coordinates: routeCoords },
      steps: [{
        maneuver: { instruction: '', type: 'continue' },
        distance: 100_000,
        duration: 11 * 3600,
        name: '',
        intersections: [],
      }],
    } as unknown as RouteResult;

    const segments = calculateDriveSegments(route, 4.5 * 3600, null, {
      dailyLimitH: 9,
      reducedRestsRemaining: 0,
      dailyDrivenSeconds: 0,
    });
    const geojson = buildDriveMilestonesGeoJSON(route, segments);
    const labels = geojson.features.map(feature => feature.properties?.label);

    expect(labels).toContain('4.5h');
    expect(labels).toContain('REST');
    expect(geojson.features.every(feature => feature.geometry.type === 'Point')).toBe(true);
  });

  it('adds the optional +1h extension marker when the daily limit allows it', () => {
    const routeCoords: [number, number][] = [
      [0, 0],
      [1, 0],
    ];
    const route = {
      distance: 100_000,
      duration: 11 * 3600,
      geometry: { type: 'LineString', coordinates: routeCoords },
      steps: [{
        maneuver: { instruction: '', type: 'continue' },
        distance: 100_000,
        duration: 11 * 3600,
        name: '',
        intersections: [],
      }],
    } as unknown as RouteResult;

    const segments = calculateDriveSegments(route, 4.5 * 3600, null, {
      dailyLimitH: 10,
      reducedRestsRemaining: 0,
      dailyDrivenSeconds: 0,
    });
    const labels = buildDriveMilestonesGeoJSON(route, segments)
      .features
      .map(feature => feature.properties?.label);

    expect(labels).toEqual(expect.arrayContaining(['4.5h', '9h', '+1h']));
  });
});
