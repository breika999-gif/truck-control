import { useState, useRef, useCallback, useEffect } from 'react';
import type { RouteResult } from '../api/directions';
import { fetchElevationAtPoint } from '../api/tilequery';
import { fetchPOIsAlongRoute, type POICard } from '../../../shared/services/backendApi';
import { weatherEmoji, haversineMeters } from '../utils/mapUtils';

export interface RoutePOI {
  type: 'parking' | 'fuel';
  name: string;
  distKm: number;
  lng: number;
  lat: number;
  distFromUserKm?: number;
}

export interface WeatherPoint {
  coords: [number, number];
  emoji: string;
  temp: number;
}

export interface RouteInsight {
  type: 'hill' | 'weather' | 'traffic';
  text: string;
  distKm: number;
}

type RouteInsightsOptions = {
  navigating?: boolean;
  setParkingResults?: (pois: POICard[]) => void;
  setFuelResults?: (pois: POICard[]) => void;
};

const TIMELINE_POIS_PER_TYPE = 3;

function dedupePOICards(cards: POICard[]): POICard[] {
  const seen = new Set<string>();
  return cards.filter(card => {
    if (!Number.isFinite(card.lat) || !Number.isFinite(card.lng)) return false;
    const key = `${card.name.toLowerCase()}|${card.lat.toFixed(4)}|${card.lng.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function selectNearestTimelinePOIs(pois: RoutePOI[]): RoutePOI[] {
  const selectedCount: Record<RoutePOI['type'], number> = {
    parking: 0,
    fuel: 0,
  };

  return [...pois]
    .sort((a, b) => (a.distFromUserKm ?? a.distKm) - (b.distFromUserKm ?? b.distKm))
    .filter(poi => {
      if (selectedCount[poi.type] >= TIMELINE_POIS_PER_TYPE) return false;
      selectedCount[poi.type] += 1;
      return true;
    });
}

export const useRouteInsights = (
  route: RouteResult | null,
  userCoords?: [number, number] | null,
  options: RouteInsightsOptions = {},
) => {
  const [elevProfile, setElevProfile] = useState<number[]>([]);
  const [weatherPoints, setWeatherPoints] = useState<WeatherPoint[]>([]);
  const [routeAheadPOIs, setRouteAheadPOIs] = useState<RoutePOI[]>([]);
  const [hillWarnings, setHillWarnings] = useState<RouteInsight[]>([]);

  const elevAbortRef = useRef<AbortController | null>(null);
  const weatherAbortRef = useRef<AbortController | null>(null);
  const poiAbortRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  // Refs for POI caching + refresh logic
  const routeForPOIRef = useRef<RouteResult | null>(null);
  const cumDistRef = useRef<number[]>([]);
  const allPOIsRef = useRef<RoutePOI[]>([]);
  const lastFilterCoordRef = useRef<[number, number] | null>(null);
  const userCoordsRef = useRef(userCoords ?? null);
  const navigatingRef = useRef(options.navigating ?? false);
  const setParkingResultsRef = useRef(options.setParkingResults);
  const setFuelResultsRef = useRef(options.setFuelResults);

  useEffect(() => { userCoordsRef.current = userCoords ?? null; }, [userCoords]);
  useEffect(() => { navigatingRef.current = options.navigating ?? false; }, [options.navigating]);
  useEffect(() => { setParkingResultsRef.current = options.setParkingResults; }, [options.setParkingResults]);
  useEffect(() => { setFuelResultsRef.current = options.setFuelResults; }, [options.setFuelResults]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!route) {
      setElevProfile([]);
      setWeatherPoints([]);
      setRouteAheadPOIs([]);
      setHillWarnings([]);
      allPOIsRef.current = [];
      routeForPOIRef.current = null;
      setParkingResultsRef.current?.([]);
      setFuelResultsRef.current?.([]);
    }
  }, [route]);

  const buildElevProfile = useCallback(async (r: RouteResult) => {
    elevAbortRef.current?.abort();
    const ctrl = new AbortController();
    elevAbortRef.current = ctrl;

    const coords = r.geometry.coordinates;
    const step = Math.max(1, Math.floor(coords.length / 8));
    const samples: [number, number][] = [];
    for (let i = 0; i < coords.length; i += step) {
      if (samples.length >= 8) break;
      samples.push([coords[i][0], coords[i][1]]);
    }

    const elevs = await Promise.all(
      samples.map(([lng, lat]) => fetchElevationAtPoint(lng, lat)),
    );

    if (isMountedRef.current && !ctrl.signal.aborted) {
      const validElevs = elevs.filter((e): e is number => e != null);
      setElevProfile(validElevs);

      // ── Task 2: Calculate steep slopes ──
      const warnings: RouteInsight[] = [];
      const sampleDistM: number[] = [0];
      for (let i = 1; i < samples.length; i++) {
        sampleDistM.push(sampleDistM[i-1] + haversineMeters(samples[i-1], samples[i]));
      }

      for (let i = 1; i < validElevs.length; i++) {
        const distM = sampleDistM[i] - sampleDistM[i-1];
        const elevDiff = validElevs[i] - validElevs[i-1];
        if (distM > 0) {
          const grade = (Math.abs(elevDiff) / distM) * 100;
          let distToUserKm = sampleDistM[i-1] / 1000;
          if (userCoords) {
            const userDistM = haversineMeters(userCoords, samples[i-1]);
            distToUserKm = userDistM / 1000;
          }

          if (grade > 5 && distToUserKm <= 10) {
            warnings.push({
              type: 'hill',
              text: `⛰️ Стръмен ${elevDiff < 0 ? 'надолнище' : 'наклон'} след ${Math.round(distToUserKm)} км — намали скоростта и провери ретардера`,
              distKm: Math.round(distToUserKm),
            });
          }
        }
      }
      setHillWarnings(warnings);
    }
  }, [userCoords]);

  const fetchWeatherForRoute = useCallback(async (r: RouteResult) => {
    weatherAbortRef.current?.abort();
    const ctrl = new AbortController();
    weatherAbortRef.current = ctrl;

    const coords = r.geometry.coordinates;
    const [lng, lat] = coords[coords.length - 1];
    try {
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`,
        { signal: ctrl.signal },
      );
      const data = (await res.json()) as {
        current_weather: { weathercode: number; temperature: number };
      };
      const w = data.current_weather;
      if (isMountedRef.current && !ctrl.signal.aborted) {
        setWeatherPoints([
          {
            coords: [lng, lat] as [number, number],
            emoji: weatherEmoji(w.weathercode),
            temp: Math.round(w.temperature),
          },
        ]);
      }
    } catch {
      if (isMountedRef.current && !ctrl.signal.aborted) setWeatherPoints([]);
    }
  }, []);

  const getUserProgressKm = useCallback((uPos: [number, number]) => {
    const coords = routeForPOIRef.current?.geometry.coordinates as [number, number][] | undefined;
    const cumDist = cumDistRef.current;
    if (!coords?.length || !cumDist.length) return 0;

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
  }, []);

  // Filter the cache to the nearest parking and fuel stops ahead — zero network calls.
  const filterAndSetVisible = useCallback((uPos: [number, number]) => {
    const progressKm = getUserProgressKm(uPos);
    const ahead = allPOIsRef.current
      .filter(p => p.distKm > progressKm)
      .map(p => ({
        ...p,
        distFromUserKm: Math.round(p.distKm - progressKm),
      }));
    setRouteAheadPOIs(selectNearestTimelinePOIs(ahead));
  }, [getUserProgressKm]);

  // Fetch ALL POIs for the whole route at once and fill the cache
  const executePOIFetch = useCallback(async (uPos: [number, number] | null) => {
    const r = routeForPOIRef.current;
    if (!r) return;

    poiAbortRef.current?.abort();
    const ctrl = new AbortController();
    poiAbortRef.current = ctrl;

    const coords = r.geometry.coordinates as [number, number][];
    const cumDist = cumDistRef.current;

    const routeDistForPOI = (lng: number, lat: number): number => {
      let minD = Infinity;
      let minI = 0;
      for (let i = 0; i < coords.length; i++) {
        const d = haversineMeters([lng, lat], coords[i] as [number, number]);
        if (d < minD) { minD = d; minI = i; }
      }
      return cumDist[minI] ?? 0;
    };

    try {
      const [truckStops, fuels] = await Promise.all([
        fetchPOIsAlongRoute(coords, 'truck_stop', ctrl.signal),
        fetchPOIsAlongRoute(coords, 'fuel', ctrl.signal),
      ]);

      if (ctrl.signal.aborted || !isMountedRef.current) return;

      setParkingResultsRef.current?.(dedupePOICards(truckStops).slice(0, 8));
      setFuelResultsRef.current?.(dedupePOICards(fuels).slice(0, 8));

      const all: RoutePOI[] = [
        ...truckStops.map(p => ({
          type: 'parking' as const,
          name: p.name || 'Паркинг',
          distKm: Math.max(1, Math.round(routeDistForPOI(p.lng, p.lat) / 1000)),
          lng: p.lng,
          lat: p.lat,
        })),
        ...fuels.map(p => ({
          type: 'fuel' as const,
          name: p.name || 'Гориво',
          distKm: Math.max(1, Math.round(routeDistForPOI(p.lng, p.lat) / 1000)),
          lng: p.lng,
          lat: p.lat,
        })),
      ];

      allPOIsRef.current = all;

      if (uPos) {
        filterAndSetVisible(uPos);
      } else {
        // No user position yet — show the nearest stops from the route start.
        setRouteAheadPOIs(selectNearestTimelinePOIs(all));
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
    }
  }, [filterAndSetVisible]);

  const buildRoutePOIScan = useCallback((r: RouteResult) => {
    routeForPOIRef.current = r;
    allPOIsRef.current = [];
    setRouteAheadPOIs([]);
    setParkingResultsRef.current?.([]);
    setFuelResultsRef.current?.([]);

    const coords = r.geometry.coordinates as [number, number][];
    const cum: number[] = [0];
    for (let i = 1; i < coords.length; i++) {
      cum.push(cum[i - 1] + haversineMeters(coords[i - 1] as [number, number], coords[i] as [number, number]));
    }
    cumDistRef.current = cum;

    const uPos = userCoordsRef.current;
    lastFilterCoordRef.current = uPos;
    void executePOIFetch(uPos); // one fetch for the whole route
  }, [executePOIFetch]);

  // Update visible POIs from cache as driver moves — no network calls
  useEffect(() => {
    if (!userCoords || !routeForPOIRef.current) return;

    const movedM = lastFilterCoordRef.current
      ? haversineMeters(lastFilterCoordRef.current, userCoords)
      : Infinity;

    if (movedM < 2000) return; // update UI every 2km
    lastFilterCoordRef.current = userCoords;

    // POI is "ahead" if it is further along the route than the user
    const progressKm = getUserProgressKm(userCoords);
    const aheadInCache = allPOIsRef.current.filter(
      p => p.distKm > progressKm,
    ).length;

    if (aheadInCache > 0) {
      // Cache still has POIs — just filter, zero network
      filterAndSetVisible(userCoords);
    } else {
      // Cache exhausted — fetch a fresh batch for remaining route
      void executePOIFetch(userCoords);
    }
  }, [userCoords, filterAndSetVisible, executePOIFetch]);

  return {
    elevProfile,
    weatherPoints,
    routeAheadPOIs,
    hillWarnings,
    buildElevProfile,
    fetchWeatherForRoute,
    buildRoutePOIScan,
  };
};
