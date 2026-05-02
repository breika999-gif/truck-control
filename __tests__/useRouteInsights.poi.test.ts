import { haversineMeters } from '../src/features/navigation/utils/mapUtils';
import type { RoutePOI } from '../src/features/navigation/hooks/useRouteInsights';

function getUserProgressKm(
  uPos: [number, number],
  coords: [number, number][],
  cumDist: number[],
): number {
  if (!coords.length || !cumDist.length) return 0;

  let nearestIdx = 0;
  let nearestDistM = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const distM = haversineMeters(uPos, coords[i]);
    if (distM < nearestDistM) {
      nearestDistM = distM;
      nearestIdx = i;
    }
  }

  return (cumDist[nearestIdx] ?? 0) / 1000;
}

function filterAheadPOIs(
  allPOIs: RoutePOI[],
  progressKm: number,
): RoutePOI[] {
  return allPOIs
    .filter(p => p.distKm > progressKm)
    .sort((a, b) => a.distKm - b.distKm)
    .map(p => ({
      ...p,
      distFromUserKm: Math.round(p.distKm - progressKm),
    }))
    .slice(0, 4);
}

const coords: [number, number][] = [
  [25.0, 42.0],
  [25.0, 42.1],
  [25.0, 42.2],
  [25.0, 42.3],
];

const cumDist = [0, 11100, 22200, 33300];

const pois: RoutePOI[] = [
  { type: 'parking', name: 'P1', distKm: 5, lat: 42.05, lng: 25.0 },
  { type: 'fuel', name: 'F1', distKm: 15, lat: 42.15, lng: 25.0 },
  { type: 'parking', name: 'P2', distKm: 25, lat: 42.25, lng: 25.0 },
  { type: 'parking', name: 'P3', distKm: 30, lat: 42.28, lng: 25.0 },
  { type: 'fuel', name: 'F2', distKm: 32, lat: 42.30, lng: 25.0 },
];

describe('useRouteInsights POI route-progress helpers', () => {
  describe('getUserProgressKm', () => {
    it('returns approximately 0 km when the user is at route start', () => {
      expect(getUserProgressKm(coords[0], coords, cumDist)).toBeCloseTo(0, 3);
    });

    it('returns approximately half the total distance at the route midpoint', () => {
      expect(getUserProgressKm(coords[2], coords, cumDist)).toBeCloseTo(22.2, 1);
    });

    it('returns approximately the total distance at the route end', () => {
      expect(getUserProgressKm(coords[3], coords, cumDist)).toBeCloseTo(33.3, 1);
    });

    it('returns the nearest route coord cumulative distance when user is off-route', () => {
      const offRouteNearSecondCoord: [number, number] = [25.0006, 42.1];
      expect(getUserProgressKm(offRouteNearSecondCoord, coords, cumDist)).toBeCloseTo(11.1, 1);
    });

    it('returns 0 for empty coords or cumulative distance arrays', () => {
      expect(getUserProgressKm(coords[0], [], cumDist)).toBe(0);
      expect(getUserProgressKm(coords[0], coords, [])).toBe(0);
    });
  });

  describe('filterAheadPOIs', () => {
    it('only includes POIs ahead of the user progress', () => {
      expect(filterAheadPOIs(pois, 20).map(p => p.name)).toEqual(['P2', 'P3', 'F2']);
    });

    it('sorts by route order instead of input order', () => {
      const shuffled = [pois[3], pois[1], pois[4], pois[2]];
      expect(filterAheadPOIs(shuffled, 10).map(p => p.name)).toEqual(['F1', 'P2', 'P3', 'F2']);
    });

    it('returns a maximum of 4 visible POIs', () => {
      expect(filterAheadPOIs(pois, 0)).toHaveLength(4);
    });

    it('sets distFromUserKm as rounded remaining route distance', () => {
      const result = filterAheadPOIs(pois, 14.6);
      expect(result[0]).toMatchObject({ name: 'F1', distFromUserKm: 0 });
      expect(result[1]).toMatchObject({ name: 'P2', distFromUserKm: 10 });
    });

    it('returns an empty array after the user has passed all POIs', () => {
      expect(filterAheadPOIs(pois, 40)).toEqual([]);
    });

    it('preserves order for two POIs at the same route distance', () => {
      const sameDist: RoutePOI[] = [
        { type: 'parking', name: 'First same km', distKm: 12, lat: 42.1, lng: 25.0 },
        { type: 'fuel', name: 'Second same km', distKm: 12, lat: 42.1, lng: 25.0 },
        { type: 'parking', name: 'Later', distKm: 15, lat: 42.15, lng: 25.0 },
      ];
      expect(filterAheadPOIs(sameDist, 10).map(p => p.name)).toEqual([
        'First same km',
        'Second same km',
        'Later',
      ]);
    });

    it('excludes a POI exactly at the user progress', () => {
      expect(filterAheadPOIs(pois, 15).map(p => p.name)).not.toContain('F1');
    });

    it('includes a POI 0.4 km ahead even when rounded distance is 0', () => {
      const nearAhead: RoutePOI[] = [
        { type: 'parking', name: 'Near ahead', distKm: 10.4, lat: 42.1, lng: 25.0 },
      ];
      expect(filterAheadPOIs(nearAhead, 10)).toEqual([
        expect.objectContaining({ name: 'Near ahead', distFromUserKm: 0 }),
      ]);
    });
  });
});
