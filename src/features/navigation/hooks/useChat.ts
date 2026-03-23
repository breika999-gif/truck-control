import { useState, useRef, useCallback, useEffect } from 'react';
import Tts from 'react-native-tts';
import { 
  ChatMessage, ChatContext, sendChatMessage, sendGeminiMessage,
  AppIntent
} from '../../../shared/services/backendApi';
import { GoogleAccount } from '../../../shared/services/accountManager';
import { VehicleProfile } from '../../../shared/types/vehicle';

interface ChatProps {
  userCoords: [number, number] | null;
  drivingSeconds: number;
  speed: number;
  profile: VehicleProfile | null;
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
    };

    const response = await sendChatMessage(text, gptHistory.slice(-6), context);
    if (!isMountedRef.current) return;

    if (!response.ok) {
      setGptHistory([...newHistory, { role: 'model', text: 'Грешка: GPT-4o не отговаря.' }]);
      setGptLoading(false);
      return;
    }

    const act = response.action;
    if (!act) {
      const replyText = (response.reply ?? '').trim();
      if (replyText) {
        setGptHistory([...newHistory, { role: 'model', text: replyText }]);
        speak(replyText);
      }
      setGptLoading(false);
      return;
    }

    // Process action...
    // (Ideally move action processing to a separate helper or keep here if complex)
    const displayText =
      act.action === 'message'
        ? (act.text ?? '')
        : ('message' in act ? (act as { message?: string }).message : undefined) ?? '';
    
    // Simple bubble text parser could be imported
    const cleanText = displayText; // Simplified for hook extraction
    setGptHistory([...newHistory, { role: 'model', text: cleanText || 'Action executed' }]);
    
    // Action handling
    if (act.action === 'route') {
      navigateTo(act.coords, act.destination, act.waypoints, true);
    } else if (act.action === 'add_waypoint') {
      addWaypoint(act.coords, act.name);
    } else if (act.action === 'show_pois') {
       if (act.category === 'truck_stop') {
        setParkingResults(act.cards.filter(c => c.lat && c.lng).slice(0, 5));
        setFuelResults([]); setCameraResults([]); setBusinessResults([]); setTachographResult(null);
      } else if (act.category === 'fuel') {
        setFuelResults(act.cards.slice(0, 4));
        setParkingResults([]); setCameraResults([]); setBusinessResults([]); setTachographResult(null);
      } else if (act.category === 'speed_camera') {
        setCameraResults(act.cards);
        setParkingResults([]); setFuelResults([]); setBusinessResults([]);
      } else if (act.category === 'business') {
        setBusinessResults(act.cards.filter(c => c.lat && c.lng).slice(0, 6));
        setParkingResults([]); setFuelResults([]); setCameraResults([]); setTachographResult(null);
      }
    } else if (act.action === 'show_routes') {
      setRouteOptions(act.options);
      setRouteOptDest({ name: act.destination, coords: act.dest_coords, waypoints: act.waypoints });
      setRoute(null);
      setDestination(null);
    } else if (act.action === 'tachograph') {
      setTachographResult({
        drivenHours:    act.driven_hours,
        remainingHours: act.remaining_hours,
        breakNeeded:    act.break_needed ?? false,
        suggestedStop:  act.suggested_stop,
      });
    }

    setGptLoading(false);
  }, [gptHistory, gptLoading, userCoords, drivingSeconds, speed, profile, navigateTo, addWaypoint]);

  // ── Gemini logic ──────────────────────────────────────────────────────────
  const sendGeminiText = useCallback(async (text: string) => {
    if (!text || geminiLoading) return;

    const userMsg: ChatMessage = { role: 'user', text };
    const newHistory = [...geminiHistory, userMsg];
    setGeminiHistory(newHistory);
    setGeminiLoading(true);

    const context: ChatContext = {
      lat:            userCoords?.[1],
      lng:            userCoords?.[0],
      driven_seconds: drivingSeconds,
      speed_kmh:      speed,
      profile:        profile || undefined,
    };

    const response = await sendGeminiMessage(
      text,
      geminiHistory.slice(-4),
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

    const replyText = (response.reply ?? '').trim();
    if (replyText) {
      setGeminiHistory([...newHistory, { role: 'model', text: replyText }]);
      speak(replyText);
    }
    if (response.app_intent) { handleAppIntent(response.app_intent); }

    setGeminiLoading(false);
  }, [geminiHistory, geminiLoading, userCoords, drivingSeconds, speed, profile, googleUser, handleAppIntent]);

  return {
    gptLoading,
    geminiLoading,
    sendGptText,
    sendGeminiText
  };
}
