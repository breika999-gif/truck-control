import { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleAccount } from '../../../shared/services/accountManager';
import { saveTachoSession, fetchTachoSummary, TachoSummary } from '../../../shared/services/backendApi';

const HOS_LIMIT_S = 16200; // EU 4.5h = 16 200 s
const DAILY_LIMIT_9H = 32400; // 9h
const DAILY_LIMIT_10H = 36000; // 10h

export function useTacho(
  navigating: boolean, 
  isDrivingRef: React.MutableRefObject<boolean>,
  googleUserRef: React.MutableRefObject<GoogleAccount | null>,
  speak: (text: string) => void
) {
  const [drivingSeconds, setDrivingSeconds] = useState(0);
  const [tachoSummary, setTachoSummary] = useState<TachoSummary | null>(null);
  
  const drivingSecondsRef = useRef(0);
  const sessionStartRef = useRef<string | null>(null);
  const hosIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hosWarningRef = useRef({ 
    w30: false, w10: false, limit: false,
    daily9h: false, daily10h: false, weekly56h: false 
  });
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
          ...hosWarningRef.current,
          w30:   alreadyDriven >= 14400,
          w10:   alreadyDriven >= 15600,
          limit: alreadyDriven >= 16200,
        };
      }
    });
  }, [googleUserRef]);

  // ── HOS timer ──
  useEffect(() => {
    if (!navigating) {
      if (hosIntervalRef.current) clearInterval(hosIntervalRef.current);
      return;
    }
    if (hosIntervalRef.current) clearInterval(hosIntervalRef.current);
    hosIntervalRef.current = setInterval(() => {
      if (isDrivingRef.current && isMountedRef.current) setDrivingSeconds(s => s + 1);
    }, 1000);
    return () => {
      if (hosIntervalRef.current) clearInterval(hosIntervalRef.current);
    };
  }, [navigating, isDrivingRef]);

  // ── Expert EU 561/2006 voice warnings ──
  useEffect(() => {
    if (!navigating || !tachoSummary) return;
    
    // 1. Continuous 4.5h rule
    if (drivingSeconds >= 14400 && !hosWarningRef.current.w30) {
      hosWarningRef.current.w30 = true;
      speak('Колега, 30 минути до пауза.');
    }
    if (drivingSeconds >= 15600 && !hosWarningRef.current.w10) {
      hosWarningRef.current.w10 = true;
      speak('Остават 10 минути каране. Търси паркинг.');
    }
    
    // 2. Daily limits (9h / 10h)
    const dailyTotal = (tachoSummary.daily_driven_s || 0) + (drivingSeconds - (tachoSummary.continuous_driven_s || 0));
    if (dailyTotal >= DAILY_LIMIT_9H && !hosWarningRef.current.daily9h) {
      hosWarningRef.current.daily9h = true;
      const can10h = tachoSummary.daily_limit_h === 10; // Simple check if backend allowed 10h today
      if (can10h) {
        speak('Достигна 9 часа каране. Имаш още 1 час до максимума за днес.');
      } else {
        speak('Достигна лимита от 9 часа. Трябва да направиш почивка.');
      }
    }

    // 3. Weekly 56h limit
    const weeklyTotal = (tachoSummary.weekly_driven_s || 0) + (drivingSeconds - (tachoSummary.continuous_driven_s || 0));
    if (weeklyTotal >= 194400 && !hosWarningRef.current.weekly56h) { // 54h
      hosWarningRef.current.weekly56h = true;
      speak('Внимание, наближаваш 56-часовия седмичен лимит.');
    }

    // 4. Reduced rests check
    if (tachoSummary.reduced_rests_remaining === 0 && !hosWarningRef.current.limit) {
      // If we are at the end of a shift, remind about 11h
      if (dailyTotal > DAILY_LIMIT_9H - 1800) { // 30 min before 9h
         // We don't want to spam, so we use a ref or specific logic
      }
    }

  }, [drivingSeconds, navigating, speak, tachoSummary]);

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
