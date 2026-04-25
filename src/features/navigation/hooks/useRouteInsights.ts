import { useState, useRef, useCallback, useEffect } from 'react';
import type { RouteResult } from '../api/directions';
import { fetchElevationAtPoint, fetchNearbyParking, fetchNearbyFuel } from '../api/tilequery';
import { weatherEmoji, haversineMeters } from '../utils/mapUtils';

export interface RoutePOI {
  type: 'parking' | 'fuel';
  name: string;
  distKm: number;
  lng: number;
  lat: number;
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

export const useRouteInsights = (route: RouteResult | null, userCoords?: [number, number] | null) => {
  const [elevProfile, setElevProfile] = useState<number[]>([]);
  const [weatherPoints, setWeatherPoints] = useState<WeatherPoint[]>([]);
  const [routeAheadPOIs, setRouteAheadPOIs] = useState<RoutePOI[]>([]);
  const [hillWarnings, setHillWarnings] = useState<RouteInsight[]>([]);

  const elevAbortRef = useRef<AbortController | null>(null);
  const weatherAbortRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

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

  const buildRoutePOIScan = useCallback(async (r: RouteResult) => {
    const coords = r.geometry.coordinates;
    if (coords.length < 2) return;

    const cumDist: number[] = [0];
    for (let i = 1; i < coords.length; i++) {
      cumDist.push(cumDist[i - 1] + haversineMeters(coords[i - 1] as [number, number], coords[i] as [number, number]));
    }
    const totalM = cumDist[cumDist.length - 1];

    const fractions = [0.33, 0.66];
    const sampleIdxs = fractions
      .map((f) => {
        const target = f * totalM;
        return cumDist.findIndex((d) => d >= target);
      })
      .filter((i) => i > 0);

    const results: RoutePOI[] = [];
    await Promise.all(
      sampleIdxs.map(async (idx) => {
        const [lng, lat] = coords[idx] as [number, number];
        const distFromStartKm = Math.round(cumDist[idx] / 1000);
        const [parkings, fuels] = await Promise.all([
          fetchNearbyParking(lng, lat, 3000),
          fetchNearbyFuel(lng, lat, 3000),
        ]);
        for (const p of parkings.slice(0, 1)) {
          results.push({ type: 'parking', name: p.name, distKm: distFromStartKm, lng: p.lng, lat: p.lat });
        }
        for (const f of fuels.slice(0, 1)) {
          results.push({ type: 'fuel', name: f.name, distKm: distFromStartKm, lng: f.lng, lat: f.lat });
        }
      }),
    );

    results.sort((a, b) => a.distKm - b.distKm);
    if (isMountedRef.current) setRouteAheadPOIs(results.slice(0, 6));
  }, []);

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
