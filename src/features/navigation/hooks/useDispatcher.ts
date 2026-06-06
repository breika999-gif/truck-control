import { useCallback, useMemo, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { MAP_CENTER } from '../../../shared/constants/config';
import type { DispatcherRoutePlan, RootStackParamList } from '../../../shared/types/navigation';
import { retrievePlace, suggestPlaces, suggestPlacesGoogle } from '../api/geocoding';
import { haversineMeters } from '../utils/mapUtils';
import i18n from '../../../i18n';

export type DispatchStopType = 'pickup' | 'delivery' | 'fuel' | 'rest';

export interface DispatchStop {
  id: string;
  address: string;
  coords: [number, number] | null;
  type: DispatchStopType;
  notes?: string;
  timeWindowStart?: string;
  timeWindowEnd?: string;
}

export interface DispatcherEstimate {
  distanceKm: number;
  durationS: number;
  resolvedStops: number;
  hosWarning: string | null;
}

export interface UseDispatcherReturn {
  stops: DispatchStop[];
  addStop: (stop: Omit<DispatchStop, 'id'>) => void;
  removeStop: (id: string) => void;
  reorderStop: (fromIdx: number, toIdx: number) => void;
  geocodeStop: (id: string, address: string) => Promise<void>;
  optimizeOrder: () => void;
  launchRoute: () => boolean;
  updateStopAddress: (id: string, address: string) => void;
  updateStopNotes: (id: string, notes: string) => void;
  setStopType: (id: string, type: DispatchStopType) => void;
  estimate: DispatcherEstimate;
  geocodingStopId: string | null;
  lastError: string | null;
  canLaunch: boolean;
}

const MAX_STOPS = 6;
const ESTIMATED_TRUCK_SPEED_KMH = 75;

function createStopId(): string {
  return `dispatch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function blankStop(): DispatchStop {
  return {
    id: createStopId(),
    address: '',
    coords: null,
    type: 'delivery',
  };
}

function nearestNeighborOrder(
  origin: [number, number],
  stops: DispatchStop[],
): DispatchStop[] {
  const unresolved = stops.filter(stop => !stop.coords);
  const remaining = stops.filter(stop => !!stop.coords);
  const ordered: DispatchStop[] = [];
  let cursor = origin;

  while (remaining.length > 0) {
    let nearestIdx = 0;
    let nearestM = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const coords = remaining[i].coords;
      if (!coords) continue;
      const distanceM = haversineMeters(cursor, coords);
      if (distanceM < nearestM) {
        nearestIdx = i;
        nearestM = distanceM;
      }
    }
    const [nearest] = remaining.splice(nearestIdx, 1);
    ordered.push(nearest);
    cursor = nearest.coords ?? cursor;
  }

  return [...ordered, ...unresolved];
}

function estimatePlan(
  origin: [number, number],
  stops: DispatchStop[],
  remainingDriveSeconds: number,
): DispatcherEstimate {
  const resolved = stops.filter(stop => !!stop.coords);
  let cursor = origin;
  let distanceKm = 0;
  let breakBeforeStopIdx: number | null = null;

  for (let i = 0; i < resolved.length; i++) {
    const coords = resolved[i].coords;
    if (!coords) continue;
    distanceKm += haversineMeters(cursor, coords) / 1000;
    const durationS = (distanceKm / ESTIMATED_TRUCK_SPEED_KMH) * 3600;
    if (breakBeforeStopIdx == null && durationS > remainingDriveSeconds) {
      breakBeforeStopIdx = i;
    }
    cursor = coords;
  }

  const durationS = Math.round((distanceKm / ESTIMATED_TRUCK_SPEED_KMH) * 3600);
  let hosWarning: string | null = null;
  if (resolved.length > 0 && durationS > remainingDriveSeconds) {
    const routeH = (durationS / 3600).toFixed(1);
    const availableH = (Math.max(0, remainingDriveSeconds) / 3600).toFixed(1);
    const breakText = breakBeforeStopIdx != null && breakBeforeStopIdx > 0
      ? i18n.t('dispatcher.breakAfterStop', { index: breakBeforeStopIdx })
      : i18n.t('dispatcher.breakBeforeLongLeg');
    hosWarning = i18n.t('dispatcher.hosWarning', {
      routeHours: routeH,
      availableHours: availableH,
      breakText,
    });
  }

  return {
    distanceKm: Math.round(distanceKm * 10) / 10,
    durationS,
    resolvedStops: resolved.length,
    hosWarning,
  };
}

export function useDispatcher(
  userCoords: [number, number] | null,
  remainingDriveSeconds: number,
): UseDispatcherReturn {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'Dispatcher'>>();
  const [stops, setStops] = useState<DispatchStop[]>(() => [blankStop()]);
  const [geocodingStopId, setGeocodingStopId] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const origin = useMemo<[number, number]>(
    () => userCoords ?? [MAP_CENTER.longitude, MAP_CENTER.latitude],
    [userCoords],
  );

  const addStop = useCallback((stop: Omit<DispatchStop, 'id'>) => {
    setStops(current => current.length >= MAX_STOPS
      ? current
      : [...current, { ...stop, id: createStopId() }]);
  }, []);

  const removeStop = useCallback((id: string) => {
    setStops(current => current.length === 1
      ? [blankStop()]
      : current.filter(stop => stop.id !== id));
  }, []);

  const reorderStop = useCallback((fromIdx: number, toIdx: number) => {
    setStops(current => {
      if (
        fromIdx < 0 ||
        toIdx < 0 ||
        fromIdx >= current.length ||
        toIdx >= current.length ||
        fromIdx === toIdx
      ) {
        return current;
      }
      const next = [...current];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  }, []);

  const updateStopAddress = useCallback((id: string, address: string) => {
    setStops(current => current.map(stop => stop.id === id
      ? { ...stop, address, coords: stop.address === address ? stop.coords : null }
      : stop));
  }, []);

  const updateStopNotes = useCallback((id: string, notes: string) => {
    setStops(current => current.map(stop => stop.id === id ? { ...stop, notes } : stop));
  }, []);

  const setStopType = useCallback((id: string, type: DispatchStopType) => {
    setStops(current => current.map(stop => stop.id === id ? { ...stop, type } : stop));
  }, []);

  const geocodeStop = useCallback(async (id: string, address: string) => {
    const query = address.trim();
    if (query.length < 2) {
      setLastError(i18n.t('dispatcher.enterAddress'));
      return;
    }

    setGeocodingStopId(id);
    setLastError(null);
    try {
      let suggestions = await suggestPlaces(query, undefined, origin);
      if (suggestions.length === 0) {
        suggestions = await suggestPlacesGoogle(query, undefined, origin);
      }
      const suggestion = suggestions[0];
      if (!suggestion) {
        setLastError(i18n.t('dispatcher.notFound', { query }));
        return;
      }
      const place = await retrievePlace(suggestion.place_id);
      if (!place) {
        setLastError(i18n.t('dispatcher.geocodeFailed', { query }));
        return;
      }
      setStops(current => current.map(stop => stop.id === id
        ? {
            ...stop,
            address: place.place_name || place.text || query,
            coords: place.center,
          }
        : stop));
    } finally {
      setGeocodingStopId(current => current === id ? null : current);
    }
  }, [origin]);

  const optimizeOrder = useCallback(() => {
    setStops(current => nearestNeighborOrder(origin, current));
  }, [origin]);

  const estimate = useMemo(
    () => estimatePlan(origin, stops, remainingDriveSeconds),
    [origin, remainingDriveSeconds, stops],
  );
  const canLaunch = stops.length > 0 && stops.every(stop => !!stop.coords);

  const launchRoute = useCallback(() => {
    const resolved = stops.filter(stop => !!stop.coords);
    if (!canLaunch || resolved.length === 0) return false;

    const finalStop = resolved[resolved.length - 1];
    const waypointStops = resolved.slice(0, -1);
    const plan: DispatcherRoutePlan = {
      requestId: createStopId(),
      destination: finalStop.coords as [number, number],
      destinationName: finalStop.address || i18n.t('dispatcher.lastStop'),
      waypoints: waypointStops.map(stop => stop.coords as [number, number]),
      waypointNames: waypointStops.map(stop => stop.address || i18n.t('dispatcher.stopFallback')),
    };
    navigation.navigate('Map', { dispatcherPlan: plan });
    return true;
  }, [canLaunch, navigation, stops]);

  return {
    stops,
    addStop,
    removeStop,
    reorderStop,
    geocodeStop,
    optimizeOrder,
    launchRoute,
    updateStopAddress,
    updateStopNotes,
    setStopType,
    estimate,
    geocodingStopId,
    lastError,
    canLaunch,
  };
}
