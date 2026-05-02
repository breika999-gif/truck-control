import {
  detectCountryCode,
  fmtHOS,
  getTruckSpeedLimit,
  haversineMeters,
  laneDirectionEmoji,
} from '../src/features/navigation/utils/mapUtils';

describe('mapUtils pure helpers', () => {
  describe('haversineMeters', () => {
    it('calculates an approximate distance in meters', () => {
      expect(haversineMeters([0, 0], [0, 1])).toBeGreaterThan(111_000);
      expect(haversineMeters([0, 0], [0, 1])).toBeLessThan(111_400);
    });

    it('returns Infinity for null input', () => {
      expect(haversineMeters(null as any, [0, 0])).toBe(Infinity);
      expect(haversineMeters([0, 0], null as any)).toBe(Infinity);
    });

    it('returns Infinity for NaN coordinates', () => {
      expect(haversineMeters([Number.NaN, 0], [0, 0])).toBe(Infinity);
      expect(haversineMeters([0, 0], [0, Number.NaN])).toBe(Infinity);
    });

    it('returns 0 for the same point', () => {
      expect(haversineMeters([23.3, 42.7], [23.3, 42.7])).toBe(0);
    });
  });

  describe('fmtHOS', () => {
    it('formats remaining HOS time', () => {
      expect(fmtHOS(0)).toBe('4:30');
      expect(fmtHOS(8100)).toBe('2:15');
      expect(fmtHOS(16200)).toBe('0:00');
      expect(fmtHOS(18000)).toBe('0:00');
    });
  });

  describe('getTruckSpeedLimit', () => {
    it('returns country and road type truck limits', () => {
      expect(getTruckSpeedLimit('bg', 'motorway')).toBe(100);
      expect(getTruckSpeedLimit('de', 'motorway')).toBe(80);
    });

    it('falls back for unknown country and road type', () => {
      expect(getTruckSpeedLimit('xx', 'motorway')).toBe(80);
      expect(getTruckSpeedLimit('bg', 'unknown')).toBe(50);
    });
  });

  describe('laneDirectionEmoji', () => {
    it('maps lane directions to emoji', () => {
      expect(laneDirectionEmoji('left')).toBe('⬅️');
      expect(laneDirectionEmoji('right')).toBe('➡️');
      expect(laneDirectionEmoji('uturn')).toBe('🔄');
      expect(laneDirectionEmoji(undefined)).toBe('⬆️');
    });
  });

  describe('detectCountryCode', () => {
    it('detects known EU country bounding boxes', () => {
      expect(detectCountryCode(42.7, 23.3)).toBe('bg');
      expect(detectCountryCode(52.5, 13.4)).toBe('de');
    });

    it('returns eu for unknown coordinates', () => {
      expect(detectCountryCode(0, 0)).toBe('eu');
    });
  });
});
