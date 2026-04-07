import { useState, useRef, useCallback, useEffect } from 'react';
import Tts from 'react-native-tts';
import {
  ChatMessage, ChatContext, sendChatMessage, sendGeminiMessage,
  AppIntent, TachoSummary
} from '../../../shared/services/backendApi';
import { GoogleAccount } from '../../../shared/services/accountManager';
import { VehicleProfile } from '../../../shared/types/vehicle';
import { getDaySummary, getWeeklySummary } from '../../tacho/TachoEventLog';
import { getMemorySummary, addMemory } from '../utils/geminiMemory';
import { getHabitsSummary } from '../utils/driverHabits';

interface ChatProps {
  userCoords: [number, number] | null;
  drivingSeconds: number;
  speed: number;
  profile: VehicleProfile | null;
  tachoSummary: TachoSummary | null;
  gptHistory: ChatMessage[];
  setGptHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  geminiHistory: ChatMessage[];
  setGeminiHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  googleUser: GoogleAccount | null;
  voiceMutedRef: React.MutableRefObject<boolean>;
  navigateTo: (dest: [number, number], name: string, waypoints?: [number, number][], autoStart?: boolean) => void;
  addWaypoint: (coord: [number, number], name: string) => void;
  setParkingResults: (res: any[]) => void;
  setFuelResults: (res: any[]) => void;
  setCameraResults: (res: any[]) => void;
  setBusinessResults: (res: any[]) => void;
  setRouteOptions: (opts: any[]) => void;
  setRouteOptDest: (dest: any) => void;
  setRoute: (route: any) => void;
  setDestination: (dest: any) => void;
  setTachographResult: (res: any) => void;
  handleAppIntent: (intent: AppIntent) => void;
}

export function useChat({
  userCoords,
  drivingSeconds,
  speed,
  profile,
  tachoSummary,
  gptHistory,
  setGptHistory,
  geminiHistory,
  setGeminiHistory,
  googleUser,
  voiceMutedRef,
  navigateTo,
  addWaypoint,
  setParkingResults,
  setFuelResults,
  setCameraResults,
  setBusinessResults,
  setRouteOptions,
  setRouteOptDest,
  setRoute,
  setDestination,
  setTachographResult,
  handleAppIntent
}: ChatProps) {
  
  const [gptLoading, setGptLoading]       = useState(false);
  const [geminiLoading, setGeminiLoading] = useState(false);
  const isMountedRef = useRef(true);
  
  useEffect(() => () => { isMountedRef.current = false; }, []);

  // ── Helper to speak ───────────────────────────────────────────────────────
  const speak = useCallback((text: string) => {
    if (!voiceMutedRef.current) { Tts.stop(); try { Tts.speak(text); } catch {} }
  }, []);

  // ── Action Processor ──────────────────────────────────────────────────────
  const processAction = useCallback((act: any, newHistory: ChatMessage[], setHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>, response?: any) => {
    const displayText =
      act.action === 'message'
        ? (act.text ?? '')
        : (act.message || response?.reply || '');
    
    if (displayText) {
      setHistory([...newHistory, { role: 'model', text: displayText }]);
      speak(displayText);
    } else {
      setHistory([...newHistory, { role: 'model', text: 'Заявката е изпълнена.' }]);
    }

    if (act.action === 'route') {
      if (Array.isArray(act.coords) && act.coords.length === 2 && act.destination) {
        navigateTo(act.coords, act.destination, act.waypoints, true);
      }
    } else if (act.action === 'add_waypoint') {
      if (Array.isArray(act.coords) && act.coords.length === 2) {
        addWaypoint(act.coords, act.name ?? '');
      }
    } else if (act.action === 'show_pois') {
      if (act.category === 'truck_stop') {
        setParkingResults((act.cards ?? []).filter((c: any) => c.lat && c.lng).slice(0, 5));
        setFuelResults([]); setCameraResults([]); setBusinessResults([]); setTachographResult(null);
      } else if (act.category === 'fuel') {
        setFuelResults((act.cards ?? []).slice(0, 4));
        setParkingResults([]); setCameraResults([]); setBusinessResults([]); setTachographResult(null);
      } else if (act.category === 'speed_camera') {
        setCameraResults(act.cards ?? []);
        setParkingResults([]); setFuelResults([]); setBusinessResults([]);
      } else if (act.category === 'business') {
        setBusinessResults((act.cards ?? []).filter((c: any) => c.lat && c.lng).slice(0, 6));
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
  }, [navigateTo, addWaypoint, setParkingResults, setFuelResults, setCameraResults,
      setBusinessResults, setRouteOptions, setRouteOptDest, setRoute, setDestination,
      setTachographResult, handleAppIntent, speak]);

  // ── GPT-4o logic ──────────────────────────────────────────────────────────
  const sendGptText = useCallback(async (text: string) => {
    if (!text || gptLoading) return;

    const userMsg: ChatMessage = { role: 'user', text };
    const newHistory = [...gptHistory, userMsg];
    setGptHistory(newHistory);
    setGptLoading(true);

    const context: ChatContext = {
      lat:            userCoords?.[1],
      lng:            userCoords?.[0],
      driven_seconds: drivingSeconds,
      speed_kmh:      speed,
      profile:        profile || undefined,
      last_message:   text,
    };

    const response = await sendChatMessage(text, gptHistory.slice(-6), context);
    if (!isMountedRef.current) return;

    if (!response.ok) {
      setGptHistory([...newHistory, { role: 'model', text: 'Грешка: GPT-4o не отговаря.' }]);
      setGptLoading(false);
      return;
    }

    if (response.action) {
      processAction(response.action, newHistory, setGptHistory, response);
    } else {
      const replyText = (response.reply ?? '').trim();
      if (replyText) {
        setGptHistory([...newHistory, { role: 'model', text: replyText }]);
        speak(replyText);
      }
    }

    setGptLoading(false);
  }, [gptHistory, gptLoading, userCoords, drivingSeconds, speed, profile, speak, processAction]);

  // ── Gemini logic ──────────────────────────────────────────────────────────
  const sendGeminiText = useCallback(async (text: string) => {
    if (!text || geminiLoading) return;

    const userMsg: ChatMessage = { role: 'user', text };
    const newHistory = [...geminiHistory, userMsg];
    setGeminiHistory(newHistory);
    setGeminiLoading(true);

    const [tachoLog, tachoWeek, userMemory, driverHabits] = await Promise.all([
      getDaySummary().catch(() => ({})),
      getWeeklySummary().catch(() => ({})),
      getMemorySummary().catch(() => [] as string[]),
      getHabitsSummary().catch(() => null),
    ]);

    const context: ChatContext = {
      lat:                      userCoords?.[1],
      lng:                      userCoords?.[0],
      driven_seconds:           drivingSeconds,
      speed_kmh:                speed,
      profile:                  profile || undefined,
      shift_start_iso:          tachoSummary?.shift_start_iso,
      reduced_rests_remaining:  tachoSummary?.reduced_rests_remaining,
      daily_driving_limit_h:    tachoSummary?.daily_limit_h,
      tacho_log:                tachoLog,
      tacho_week:               tachoWeek,
      user_memory:              userMemory,
      driver_habits:            driverHabits,
    };

    const response = await sendGeminiMessage(
      text,
      geminiHistory.slice(-6),
      context,
      googleUser?.email || undefined
    );
    if (!isMountedRef.current) return;

    if (!response.ok) {
      const errText = response.error ? `Грешка: ${response.error}` : 'Грешка: Gemini не отговаря.';
      setGeminiHistory([...newHistory, { role: 'model', text: errText }]);
      setGeminiLoading(false);
      return;
    }

    if (response.action && response.action.action !== 'message') {
      processAction(response.action, newHistory, setGeminiHistory, response);
    } else {
      const replyText = (
        response.action?.action === 'message'
          ? (response.action.text ?? response.reply ?? '')
          : (response.reply ?? '')
      ).trim();
      if (replyText) {
        setGeminiHistory([...newHistory, { role: 'model', text: replyText }]);
        speak(replyText);
      }
    }

    // Persist any memory items the backend flagged
    if (response.remember && response.remember.length > 0) {
      for (const item of response.remember) {
        const cat = item.category as 'parking' | 'route' | 'preference' | 'general';
        addMemory({ text: item.text, category: cat }).catch(() => {/* silent */});
      }
    }

    if (response.app_intent) { handleAppIntent(response.app_intent); }

    setGeminiLoading(false);
  }, [geminiHistory, geminiLoading, userCoords, drivingSeconds, speed, profile, tachoSummary,
      googleUser, handleAppIntent, speak, processAction]);

  return {
    gptLoading,
    geminiLoading,
    sendGptText,
    sendGeminiText
  };
}
