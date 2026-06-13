import { useState, useRef, useCallback, useEffect } from 'react';
import Tts from 'react-native-tts';
import {
  ChatMessage, ChatContext, sendChatMessage, sendGeminiMessage,
  AppIntent, TachoSummary, POICard
} from '../../../shared/services/backendApi';
import { GoogleAccount } from '../../../shared/services/accountManager';
import { VehicleProfile } from '../../../shared/types/vehicle';
import { getDaySummary, getWeeklySummary } from '../../tacho/TachoEventLog';
import { getMemorySummary, addMemory } from '../utils/geminiMemory';
import { getHabitsSummary } from '../utils/driverHabits';
import type { RouteResult } from '../api/directions';
import { HOS_LIMIT_S, parseBubbleText, voiceText } from '../utils/mapUtils';
import type { BluetoothTachoState } from '../../tacho/hooks/useTachoBluetooth';
import { calcWeeklyStatus } from './useTacho';
import i18n from '../../../i18n';

interface ChatProps {
  userCoords: [number, number] | null;
  drivingSeconds: number;
  speed: number;
  profile: VehicleProfile | null;
  tachoSummary: TachoSummary | null;
  bluetoothTacho: BluetoothTachoState | null;
  parkingResults: POICard[];
  route: RouteResult | null;
  destinationName: string | null;
  gptHistory: ChatMessage[];
  setGptHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  geminiHistory: ChatMessage[];
  setGeminiHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  googleUser: GoogleAccount | null;
  voiceMutedRef: React.MutableRefObject<boolean>;
  navigateTo: (dest: [number, number], name: string, waypoints?: [number, number][], autoStart?: boolean) => void;
  addWaypoint: (coord: [number, number], name: string) => void;
  setParkingResults: (res: any[]) => void;
  setParkingSource?: (source: 'gpt' | 'route' | null) => void;
  setFuelResults: (res: any[]) => void;
  setCameraResults: (res: any[]) => void;
  setBusinessResults: (res: any[]) => void;
  setRouteOptions: (opts: any[]) => void;
  setRouteOptDest: (dest: any) => void;
  setRoute: (route: any) => void;
  setDestination: (dest: any) => void;
  setTachographResult: (res: any) => void;
  handleAppIntent: (intent: AppIntent) => void;
  onReachQuestion?: (text: string) => void;
}

const TRUCK_SPEED_CAP_KMH = 90;

function truckCappedRouteDurationMin(route: RouteResult | null): number | undefined {
  if (!route || route.distance <= 0 || route.duration <= 0) return undefined;
  const cappedDurationS = Math.max(
    route.duration,
    (route.distance / 1000 / TRUCK_SPEED_CAP_KMH) * 3600,
  );
  return Math.round(cappedDurationS / 60);
}

function routeDestinationCoords(route: RouteResult | null): [number, number] | undefined {
  const coords = route?.geometry.coordinates;
  return coords?.length ? coords[coords.length - 1] : undefined;
}

function getRemainingDriveMin(
  bluetoothTacho: BluetoothTachoState | null,
  drivingSeconds: number,
): number {
  if (bluetoothTacho?.connected) {
    const liveRemaining = bluetoothTacho.liveData?.drivingTimeLeftMin;
    if (Number.isFinite(liveRemaining)) {
      return Math.max(0, Math.round(liveRemaining as number));
    }
    const continuousDrivenS = bluetoothTacho.data?.continuousDrivenS;
    if (Number.isFinite(continuousDrivenS)) {
      return Math.max(0, Math.round((HOS_LIMIT_S - (continuousDrivenS as number)) / 60));
    }
  }
  return Math.max(0, Math.round((HOS_LIMIT_S - drivingSeconds) / 60));
}

function buildLiveTachoContext(
  bluetoothTacho: BluetoothTachoState | null,
  tachoSummary: TachoSummary | null,
  drivingSeconds: number,
  routeDurationMin?: number,
): Partial<ChatContext> {
  const liveData = bluetoothTacho?.connected ? bluetoothTacho.liveData : null;
  const dailyMin = liveData?.dailyDrivenMin
    ?? (bluetoothTacho?.data?.continuousDrivenS
      ? Math.round(bluetoothTacho.data.continuousDrivenS / 60)
      : null);
  return {
    current_time_iso: new Date().toISOString(),
    eta_iso: routeDurationMin != null
      ? new Date(Date.now() + routeDurationMin * 60_000).toISOString()
      : undefined,
    distance_since_rest_km: dailyMin != null ? Math.round((dailyMin / 60) * 80) : undefined,
    remaining_drive_min: getRemainingDriveMin(bluetoothTacho, drivingSeconds),
    shift_start_iso: tachoSummary?.shift_start_iso,
    reduced_rests_remaining: tachoSummary?.reduced_rests_remaining,
    daily_driving_limit_h: tachoSummary?.daily_limit_h,
    bt_connected: bluetoothTacho?.connected ?? false,
    bt_activity: bluetoothTacho?.data?.activity ?? null,
    bt_live_activity: liveData?.activity ?? null,
    bt_card: bluetoothTacho?.data?.cardInserted ?? null,
    bt_driving_time_left_min: Number.isFinite(liveData?.drivingTimeLeftMin)
      ? Math.max(0, Math.round(liveData?.drivingTimeLeftMin as number))
      : null,
    bt_daily_driven_min: Number.isFinite(liveData?.dailyDrivenMin)
      ? Math.max(0, Math.round(liveData?.dailyDrivenMin as number))
      : null,
    bt_speed_kmh: Number.isFinite(liveData?.speed)
      ? Math.max(0, Math.round(liveData?.speed as number))
      : null,
    weekly_status: tachoSummary ? calcWeeklyStatus(tachoSummary) : undefined,
  };
}

export function useChat({
  userCoords,
  drivingSeconds,
  speed,
  profile,
  tachoSummary,
  bluetoothTacho,
  parkingResults,
  route,
  destinationName,
  gptHistory,
  setGptHistory,
  geminiHistory,
  setGeminiHistory,
  googleUser,
  voiceMutedRef,
  navigateTo,
  addWaypoint,
  setParkingResults,
  setParkingSource,
  setFuelResults,
  setCameraResults,
  setBusinessResults,
  setRouteOptions,
  setRouteOptDest,
  setRoute,
  setDestination,
  setTachographResult,
  handleAppIntent,
  onReachQuestion,
}: ChatProps) {
  
  const [gptLoading, setGptLoading]       = useState(false);
  const [geminiLoading, setGeminiLoading] = useState(false);
  const isMountedRef = useRef(true);
  const shiftSummaryDateRef = useRef<string | null>(null);
  const bluetoothTachoRef = useRef(bluetoothTacho);
  bluetoothTachoRef.current = bluetoothTacho;
  const tachoSummaryRef = useRef(tachoSummary);
  tachoSummaryRef.current = tachoSummary;
  
  useEffect(() => () => { isMountedRef.current = false; }, []);

  // ── Helper to speak ───────────────────────────────────────────────────────
  const speak = useCallback((text: string) => {
    if (!voiceMutedRef.current) { Tts.stop(); try { Tts.speak(text); } catch {} }
  }, [voiceMutedRef]);

  const cleanAssistantText = useCallback((raw: unknown, fallback = i18n.t('voice.done')): string => {
    const parsed = parseBubbleText(String(raw ?? ''));
    return parsed.trim() || fallback;
  }, []);

  const sendShiftSummary = useCallback(async (params: {
    drivenH: number;
    distKm: number;
    remainingWeeklyH: number;
    destination?: string;
  }) => {
    const summaryDate = new Date().toISOString().slice(0, 10);
    if (shiftSummaryDateRef.current === summaryDate) return;
    shiftSummaryDateRef.current = summaryDate;

    const prompt = i18n.t('chat.shiftSummaryPrompt', { data: JSON.stringify(params) });
    const response = await sendGeminiMessage(
      prompt,
      [],
      {},
      googleUser?.email || undefined,
      'system_summary',
    );
    if (!response.ok || !isMountedRef.current) return;

    const replyText = cleanAssistantText(response.reply, '');
    if (replyText) speak(replyText);
  }, [cleanAssistantText, googleUser?.email, speak]);

  // ── Action Processor ──────────────────────────────────────────────────────
  const processAction = useCallback((act: any, newHistory: ChatMessage[], setHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>, response?: any) => {
    const rawDisplayText =
      act.action === 'message'
        ? (act.text ?? '')
        : (act.message || response?.reply || '');
    const displayText = cleanAssistantText(rawDisplayText, voiceText(act));
    
    if (displayText) {
      setHistory([...newHistory, { role: 'model', text: displayText }]);
      speak(displayText);
    } else {
      setHistory([...newHistory, { role: 'model', text: i18n.t('chat.done') }]);
    }

    if (act.action === 'route') {
      if (
        Array.isArray(act.coords) &&
        act.coords.length === 2 &&
        act.coords.every((c: unknown) => typeof c === 'number' && Number.isFinite(c)) &&
        act.destination
      ) {
        navigateTo(act.coords, act.destination, act.waypoints);
      }
    } else if (act.action === 'add_waypoint') {
      if (
        Array.isArray(act.coords) &&
        act.coords.length === 2 &&
        act.coords.every((c: unknown) => typeof c === 'number' && Number.isFinite(c))
      ) {
        addWaypoint(act.coords, act.name ?? '');
      }
    } else if (act.action === 'show_pois') {
      if (act.category === 'truck_stop') {
        setParkingResults((act.cards ?? []).filter((c: any) => c.lat && c.lng).slice(0, 5));
        setParkingSource?.('gpt');
        setFuelResults([]); setCameraResults([]); setBusinessResults([]); setTachographResult(null);
      } else if (act.category === 'fuel') {
        setFuelResults((act.cards ?? []).slice(0, 4));
        setParkingSource?.(null);
        setParkingResults([]); setCameraResults([]); setBusinessResults([]); setTachographResult(null);
      } else if (act.category === 'speed_camera') {
        setCameraResults(act.cards ?? []);
        setParkingSource?.(null);
        setParkingResults([]); setFuelResults([]); setBusinessResults([]);
      } else if (act.category === 'business') {
        setBusinessResults((act.cards ?? []).filter((c: any) => c.lat && c.lng).slice(0, 6));
        setParkingSource?.(null);
        setParkingResults([]); setFuelResults([]); setCameraResults([]); setTachographResult(null);
      }
    } else if (act.action === 'show_routes') {
      if (Array.isArray(act.options) && act.options.length > 0) {
        setRouteOptions(act.options);
        setRouteOptDest({ name: act.destination, coords: act.dest_coords, waypoints: act.waypoints });
        setRoute(null);
        setDestination(null);
      }
    } else if (act.action === 'tachograph') {
      setTachographResult({
        drivenHours:    act.driven_hours,
        remainingHours: act.remaining_hours,
        breakNeeded:    act.break_needed ?? false,
        suggestedStop:  act.suggested_stop,
      });
    } else if (act.action === 'app') {
      handleAppIntent(act.data ?? act);
    }
  }, [navigateTo, addWaypoint, setParkingResults, setParkingSource, setFuelResults, setCameraResults,
      setBusinessResults, setRouteOptions, setRouteOptDest, setRoute, setDestination,
      setTachographResult, handleAppIntent, speak, cleanAssistantText]);

  // ── GPT-4o logic ──────────────────────────────────────────────────────────
  const sendGptText = useCallback(async (text: string) => {
    if (!text || gptLoading) return;
    onReachQuestion?.(text);

    const userMsg: ChatMessage = { role: 'user', text };
    const newHistory = [...gptHistory, userMsg];
    setGptHistory(newHistory);
    setGptLoading(true);

    const routeDurationMin = truckCappedRouteDurationMin(route);
    const destCoords = routeDestinationCoords(route);
    const context: ChatContext = {
      lat:            userCoords?.[1],
      lng:            userCoords?.[0],
      driven_seconds: drivingSeconds,
      speed_kmh:      speed,
      profile:        profile || undefined,
      last_message:   text,
      destination:              destinationName ?? undefined,
      route_distance_km:        route ? Math.round(route.distance / 100) / 10 : undefined,
      route_duration_min:       routeDurationMin,
      dest_lat:                 destCoords?.[1],
      dest_lng:                 destCoords?.[0],
      found_parking:            parkingResults
        .filter(p => p.lat && p.lng)
        .slice(0, 5)
        .map(p => ({
          name: p.name,
          dist_km: p.distance_m != null ? Math.round(p.distance_m / 100) / 10 : undefined,
          paid: p.paid || undefined,
          showers: p.showers || undefined,
          security: p.security || undefined,
        })),
      ...buildLiveTachoContext(bluetoothTachoRef.current, tachoSummaryRef.current, drivingSeconds, routeDurationMin),
    };

    const isGptNav = /карай до|маршрут|паркинг|гориво|навигир|route|navigate|до |в |около /.test(text.toLowerCase());
    const response = await sendChatMessage(text, isGptNav ? [] : gptHistory.slice(-3), context);
    if (!isMountedRef.current) return;

    if (!response.ok) {
      setGptHistory([...newHistory, { role: 'model', text: i18n.t('chat.gptError') }]);
      setGptLoading(false);
      return;
    }

    if (response.action) {
      processAction(response.action, newHistory, setGptHistory, response);
    } else {
      const replyText = cleanAssistantText(response.reply, '');
      if (replyText) {
        setGptHistory([...newHistory, { role: 'model', text: replyText }]);
        speak(replyText);
      }
    }

    setGptLoading(false);
  }, [gptHistory, gptLoading, userCoords, drivingSeconds, speed, profile, route, destinationName, parkingResults, speak, processAction, cleanAssistantText, onReachQuestion, setGptHistory]);

  // ── Gemini logic ──────────────────────────────────────────────────────────
  const sendGeminiText = useCallback(async (text: string, options?: { forceGemini?: boolean }) => {
    if (!text || geminiLoading) return;
    onReachQuestion?.(text);

    const msg = text.toLowerCase();
    const isTacho  = /тахограф|остава|стигам|стигна|докъде|до къде|докаде|до каде|каране|шофиране|до колко|почивка|пауза|смяна|лимит|седмично|driving|drive|reach|remain/.test(msg);
    const isMemory = /обичам|помни|последно|камион|предпочит|навик/.test(msg);
    const isNav    = /карай до|маршрут|паркинг|гориво|навигир|route|navigate/.test(msg);

    if (isNav && !options?.forceGemini) {
      await sendGptText(text);
      return;
    }

    const userMsg: ChatMessage = { role: 'user', text };
    const newHistory = [...geminiHistory, userMsg];
    setGeminiHistory(newHistory);
    setGeminiLoading(true);

    const [tachoLog, tachoWeek, userMemory, driverHabits] = await Promise.all([
      isTacho  ? getDaySummary().catch(() => ({}))        : Promise.resolve({}),
      isTacho  ? getWeeklySummary().catch(() => ({}))     : Promise.resolve({}),
      isMemory ? getMemorySummary().catch(() => [] as string[]) : Promise.resolve([] as string[]),
      isMemory ? getHabitsSummary().catch(() => null)     : Promise.resolve(null),
    ]);

    const routeDurationMin = truckCappedRouteDurationMin(route);
    const destCoords = routeDestinationCoords(route);
    const context: ChatContext = {
      lat:                      userCoords?.[1],
      lng:                      userCoords?.[0],
      driven_seconds:           drivingSeconds,
      speed_kmh:                speed,
      profile:                  profile || undefined,
      destination:              destinationName ?? undefined,
      route_distance_km:        route ? Math.round(route.distance / 100) / 10 : undefined,
      route_duration_min:       routeDurationMin,
      dest_lat:                 destCoords?.[1],
      dest_lng:                 destCoords?.[0],
      ...buildLiveTachoContext(bluetoothTachoRef.current, tachoSummaryRef.current, drivingSeconds, routeDurationMin),
      tacho_log:                Object.keys(tachoLog).length > 0 ? tachoLog : undefined,
      tacho_week:               Object.keys(tachoWeek).length > 0 ? tachoWeek : undefined,
      parking_cards:            parkingResults
        .filter(p => p.lat && p.lng)
        .slice(0, 5)
        .map(p => ({
          name: p.name,
          dist_km: p.distance_m != null ? Math.round(p.distance_m / 100) / 10 : undefined,
          paid: p.paid || undefined,
          showers: p.showers || undefined,
          security: p.security || undefined,
          toilets: (p as any).toilets || undefined,
          transparking_id: p.transparking_id || undefined,
        })),
      user_memory:              userMemory.length > 0 ? userMemory : undefined,
      driver_habits:            driverHabits || undefined,
    };

    const historyDepth = isNav ? 0 : isTacho ? 2 : 3;

    const response = await sendGeminiMessage(
      text,
      historyDepth > 0 ? geminiHistory.slice(-historyDepth) : [],
      context,
      googleUser?.email || undefined
    );
    if (!isMountedRef.current) return;

    if (!response.ok) {
      const errText = response.error
        ? i18n.t('chat.errorPrefix', { error: response.error })
        : i18n.t('chat.geminiError');
      setGeminiHistory([...newHistory, { role: 'model', text: errText }]);
      setGeminiLoading(false);
      return;
    }

    if (response.action && response.action.action !== 'message') {
      processAction(response.action, newHistory, setGeminiHistory, response);
    } else {
      const replyText = cleanAssistantText(
        response.action?.action === 'message'
          ? (response.action.text ?? response.reply ?? '')
          : (response.reply ?? ''),
        '',
      );
      if (replyText) {
        setGeminiHistory([...newHistory, { role: 'model', text: replyText }]);
        speak(replyText);
      }
    }

    // Persist any memory items the backend flagged
    if (response.remember && response.remember.length > 0) {
      for (const item of response.remember) {
        const cat = item.category as 'parking' | 'route' | 'preference' | 'general';
        await addMemory({ text: item.text, category: cat }).catch(() => {/* silent */});
      }
    }

    if (response.app_intent) { handleAppIntent(response.app_intent); }

    setGeminiLoading(false);
  }, [geminiHistory, geminiLoading, userCoords, drivingSeconds, speed, profile,
      parkingResults, route, destinationName, googleUser, handleAppIntent, speak, processAction, cleanAssistantText, onReachQuestion,
      sendGptText, setGeminiHistory]);

  return {
    gptLoading,
    geminiLoading,
    sendGptText,
    sendGeminiText,
    sendShiftSummary,
  };
}
