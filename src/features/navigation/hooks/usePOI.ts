import { useState, useRef, useCallback, useEffect } from 'react';
import { POICategory, TruckPOI, searchNearbyPOI, searchAlongRoute } from '../api/poi';

export function usePOI(
  userCoordsRef: React.MutableRefObject<[number, number] | null>,
  routeRef: React.MutableRefObject<any>, // Typed as any to avoid circular deps for now
  mapCenter: { longitude: number; latitude: number }
) {
  const [poiCategory, setPoiCategory] = useState<POICategory | null>(null);
  const [poiResults, setPoiResults]   = useState<TruckPOI[]>([]);
  const [loadingPOI, setLoadingPOI]   = useState(false);
  const [sarMode, setSarMode]         = useState(false); // true = results are SAR (along route)
  
  // Ref mirrors — avoids stale closures on rapid taps.
  const poiCategoryRef = useRef<POICategory | null>(null);
  const sarModeRef     = useRef(false);
  
  useEffect(() => { poiCategoryRef.current = poiCategory; }, [poiCategory]);
  useEffect(() => { sarModeRef.current     = sarMode;     }, [sarMode]);

  // ── POI search ────────────────────────────────────────────────────────────
  const handlePOISearch = useCallback(async (cat: POICategory) => {
    // Toggle off if same category (and not SAR mode)
    if (!sarModeRef.current && poiCategoryRef.current === cat) {
      setPoiCategory(null);
      setPoiResults([]);
      return;
    }
    setSarMode(false);
    setPoiCategory(cat);
    setPoiResults([]);
    
    const center = userCoordsRef.current ?? [mapCenter.longitude, mapCenter.latitude];
    setLoadingPOI(true);
    try {
      const results = await searchNearbyPOI(center, cat);
      setPoiResults(results);
    } catch (err) {
      console.error('[usePOI] searchNearbyPOI error:', err);
      setPoiResults([]);
    } finally {
      setLoadingPOI(false);
    }
  }, [mapCenter]);

  // ── Search Along Route ────────────────────────────────────────────────────
  const handleSARSearch = useCallback(async (cat: POICategory) => {
    const currentRoute = routeRef.current;
    if (!currentRoute) return;
    
    // Toggle off if same SAR category
    if (sarModeRef.current && poiCategoryRef.current === cat) {
      setSarMode(false);
      setPoiCategory(null);
      setPoiResults([]);
      return;
    }
    setSarMode(true);
    setPoiCategory(cat);
    setPoiResults([]);
    setLoadingPOI(true);
    try {
      const results = await searchAlongRoute(
        currentRoute.geometry.coordinates,
        cat,
        15,   // 15 min max detour
        10,   // up to 10 results
      );
      setPoiResults(results);
    } catch (err) {
      console.error('[usePOI] searchAlongRoute error:', err);
      setPoiResults([]);
    } finally {
      setLoadingPOI(false);
    }
  }, []);

  const clearPOI = useCallback(() => {
    setPoiCategory(null);
    setPoiResults([]);
    setSarMode(false);
  }, []);

  return {
    poiCategory,
    poiResults,
    loadingPOI,
    sarMode,
    handlePOISearch,
    handleSARSearch,
    clearPOI,
  };
}
