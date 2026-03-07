import { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleAccount } from '../../../shared/services/accountManager';
import { saveTachoSession, fetchTachoSummary, TachoSummary } from '../../../shared/services/backendApi';

const HOS_LIMIT_S = 16200; // EU 4.5h = 16 200 s

export function useTacho(
  navigating: boolean, 
  isDrivingRef: React.MutableRefObject<boolean>,
  googleUserRef: React.MutableRefObject<GoogleAccount | null>,
  speak: (text: string) => void // Dependency from useVoice
) {
  const [drivingSeconds, setDrivingSeconds] = useState(0);
  const [tachoSummary, setTachoSummary] = useState<TachoSummary | null>(null);
  
  const drivingSecondsRef = useRef(0);
  const sessionStartRef = useRef<string | null>(null);
  const hosIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hosWarningRef = useRef({ w30: false, w10: false, limit: false });
  const isMountedRef = useRef(true);

  // Sync ref
  useEffect(() => { drivingSecondsRef.current = drivingSeconds; }, [drivingSeconds]);
  useEffect(() => () => { isMountedRef.current = false; }, []);

  // ── Load tacho summary on mount ──────────
  useEffect(() => {
    fetchTachoSummary(googleUserRef.current?.email).then(s => {
      if (!s || !isMountedRef.current) return;
      setTachoSummary(s);
      const alreadyDriven = s.continuous_driven_s ?? 0;
      if (alreadyDriven > 0) {
        setDrivingSeconds(alreadyDriven);
        hosWarningRef.current = {
          w30:   alreadyDriven >= 14400,
          w10:   alreadyDriven >= 15600,
          limit: alreadyDriven >= 16200,
        };
      }
    });
  }, [googleUserRef]); // Re-fetch if user changes, though usually static

  // ── HOS timer: count driving seconds while navigating ────────────────────
  useEffect(() => {
    if (!navigating) {
      if (hosIntervalRef.current) clearInterval(hosIntervalRef.current);
      return;
    }
    // Clear before assigning — prevents interval leak
    if (hosIntervalRef.current) clearInterval(hosIntervalRef.current);
    hosIntervalRef.current = setInterval(() => {
      if (isDrivingRef.current && isMountedRef.current) setDrivingSeconds(s => s + 1);
    }, 1000);
    return () => {
      if (hosIntervalRef.current) clearInterval(hosIntervalRef.current);
    };
  }, [navigating, isDrivingRef]);

  // ── HOS voice warnings ────────────────────────────────────────────────────
  useEffect(() => {
    if (!navigating) return;
    
    if (drivingSeconds >= 14400 && !hosWarningRef.current.w30) {
      hosWarningRef.current.w30 = true;
      speak('Внимание! 30 минути до задължителна почивка.');
    }
    if (drivingSeconds >= 15600 && !hosWarningRef.current.w10) {
      hosWarningRef.current.w10 = true;
      speak('Намерете място за почивка. 10 минути оставащи.');
    }
    if (drivingSeconds >= HOS_LIMIT_S && !hosWarningRef.current.limit) {
      hosWarningRef.current.limit = true;
      speak('Достигнат лимит за шофиране. Спрете за 45-минутна почивка.');
    }
  }, [drivingSeconds, navigating, speak]);

  const resetSession = useCallback(() => {
    setDrivingSeconds(0);
    sessionStartRef.current = new Date().toISOString();
    hosWarningRef.current = { w30: false, w10: false, limit: false };
  }, []);

  const saveSession = useCallback(() => {
    const driven = drivingSecondsRef.current;
    if (driven >= 60 && sessionStartRef.current) {
      const payload = {
        user_email:     googleUserRef.current?.email,
        driven_seconds: driven,
        start_time:     sessionStartRef.current,
        end_time:       new Date().toISOString(),
      };
      saveTachoSession(payload).then(s => {
        if (s && isMountedRef.current) setTachoSummary(s);
      });
      sessionStartRef.current = null;
    }
  }, [googleUserRef]);

  return {
    drivingSeconds,
    tachoSummary,
    setTachoSummary,
    resetSession,
    saveSession,
    HOS_LIMIT_S,
  };
}
