import { useState, useRef, useCallback, useEffect } from 'react';
import { fetchPOIsAlongRoute, type POICard } from '../../../shared/services/backendApi';
import { POICategory, TruckPOI, searchNearbyPOI } from '../api/poi';

const SAR_CATEGORY: Partial<Record<POICategory, 'truck_stop' | 'fuel'>> = {
  gas_station: 'fuel',
  parking: 'truck_stop',
  truck_stop: 'truck_stop',
};

function toTruckPOI(card: POICard, category: POICategory, index: number): TruckPOI {
  return {
    id: card.transparking_id ?? `${category}-${card.lng}-${card.lat}-${index}`,
    name: card.name?.trim() || 'POI',
    category,
    coordinates: [card.lng, card.lat],
    address: card.info ?? card.opening_hours ?? '',
    brand: card.brand,
    detourTime: card.detour_time,
    travelTime: card.travel_time,
  };
}

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
  }, [mapCenter, userCoordsRef]);

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
      const sarCategory = SAR_CATEGORY[cat];
      if (!sarCategory) {
        setPoiResults([]);
        return;
      }
      const results = await fetchPOIsAlongRoute(currentRoute.geometry.coordinates, sarCategory);
      setPoiResults(results.slice(0, 10).map((card, index) => toTruckPOI(card, cat, index)));
    } catch (err) {
      console.error('[usePOI] searchAlongRoute error:', err);
      setPoiResults([]);
    } finally {
      setLoadingPOI(false);
    }
  }, [routeRef]);

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
