import { 
  buildCongestionGeoJSON, 
  adrToExclude, 
  getCurrentStepIndex, 
  fmtDistance, 
  fmtDuration 
} from '../src/features/navigation/api/directions';

describe('directions utility functions', () => {
  
  describe('buildCongestionGeoJSON', () => {
    it('should return a FeatureCollection with unknown congestion if inputs are empty', () => {
      const result = buildCongestionGeoJSON([], []);
      expect(result.type).toBe('FeatureCollection');
      expect(result.features[0].properties?.congestion).toBe('unknown');
    });

    it('should create line features for each segment with correct congestion level', () => {
      const coords: [number, number][] = [[0, 0], [1, 1], [2, 2]];
      const congestion = ['low', 'heavy'];
      const result = buildCongestionGeoJSON(coords, congestion);
      
      expect(result.features).toHaveLength(2);
      expect(result.features[0].properties?.congestion).toBe('low');
      expect(result.features[1].properties?.congestion).toBe('heavy');
      expect(result.features[0].geometry.type).toBe('LineString');
    });
  });

  describe('adrToExclude', () => {
    it('should return tunnel for classes 1-6', () => {
      expect(adrToExclude('1')).toBe('tunnel');
      expect(adrToExclude('3')).toBe('tunnel');
      expect(adrToExclude('6')).toBe('tunnel');
    });

    it('should return tunnel,motorway for class 7', () => {
      expect(adrToExclude('7')).toBe('tunnel,motorway');
    });

    it('should return undefined for none or unknown classes', () => {
      expect(adrToExclude('none')).toBeUndefined();
      expect(adrToExclude('9')).toBeUndefined();
    });
  });

  describe('getCurrentStepIndex', () => {
    const mockSteps: any[] = [
      { intersections: [{ location: [0, 0] }] },
      { intersections: [{ location: [10, 10] }] },
      { intersections: [{ location: [20, 20] }] },
    ];

    it('should return the index of the nearest step', () => {
      expect(getCurrentStepIndex(mockSteps, [1, 1])).toBe(0);
      expect(getCurrentStepIndex(mockSteps, [9, 9])).toBe(1);
      expect(getCurrentStepIndex(mockSteps, [21, 21])).toBe(2);
    });
  });

  describe('fmtDistance', () => {
    it('should format meters correctly', () => {
      expect(fmtDistance(500)).toBe('500 Рј');
      expect(fmtDistance(999)).toBe('999 Рј');
    });

    it('should format kilometers correctly', () => {
      expect(fmtDistance(1000)).toBe('1.0 РєРј');
      expect(fmtDistance(1500)).toBe('1.5 РєРј');
      expect(fmtDistance(12345)).toBe('12.3 РєРј');
    });
  });

  describe('fmtDuration', () => {
    it('should format minutes correctly', () => {
      expect(fmtDuration(60)).toBe('1 РјРёРЅ');
      expect(fmtDuration(3540)).toBe('59 РјРёРЅ');
    });

    it('should format hours and minutes correctly', () => {
      expect(fmtDuration(3600)).toBe('1 С‡ 0 РјРёРЅ');
      expect(fmtDuration(3660)).toBe('1 С‡ 1 РјРёРЅ');
      expect(fmtDuration(7320)).toBe('2 С‡ 2 РјРёРЅ');
    });
  });
});
