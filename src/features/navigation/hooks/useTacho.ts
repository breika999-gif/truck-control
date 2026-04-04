import { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleAccount } from '../../../shared/services/accountManager';
import { saveTachoSession, fetchTachoSummary, TachoSummary } from '../../../shared/services/backendApi';
import { checkHosViolations, HosViolation, getDaySummary, getWeeklySummary } from '../../tacho/TachoEventLog';
import { recordDailyStats } from '../utils/driverHabits';

const HOS_LIMIT_S = 16200; // EU 4.5h = 16 200 s
const DAILY_LIMIT_9H = 32400; // 9h
const DAILY_LIMIT_10H = 36000; // 10h

export function useTacho(
  navigating: boolean,
  isDrivingRef: React.MutableRefObject<boolean>,
  googleUserRef: React.MutableRefObject<GoogleAccount | null>,
  speak: (text: string) => void,
  onEndOfDay?: () => void,
  onApproachingLimit?: (remainingMinutes: number) => void,
) {
  const [drivingSeconds, setDrivingSeconds] = useState(0);
  const [tachoSummary, setTachoSummary] = useState<TachoSummary | null>(null);
  const [hosViolations, setHosViolations] = useState<HosViolation[]>([]);

  const drivingSecondsRef = useRef(0);
  const sessionStartRef = useRef<string | null>(null);
  const hosIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hosCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endOfDayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track current activity for end-of-day detection (0=REST,1=AVAIL,2=WORK,3=DRIVING)
  const currentActivityRef = useRef<number>(-1);
  // Track first drive time for driverHabits
  const firstDriveTimeRef = useRef<number | null>(null);
  const lastStopTimeRef = useRef<number | null>(null);
  const hosWarningRef = useRef({
    w30: false, w10: false, limit: false,
    daily9h: false, daily10h: false, weekly56h: false
  });
  const warned20Ref = useRef(false);
  const warned10Ref = useRef(false);
  const isMountedRef = useRef(true);
  // WTD shift start: timestamp (ms) when the shift began (first activity after rest)
  const shiftStartRef = useRef<number | null>(null);

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

  // ── Offline HOS violation check every 60 seconds ──
  useEffect(() => {
    if (hosCheckIntervalRef.current) clearInterval(hosCheckIntervalRef.current);
    hosCheckIntervalRef.current = setInterval(() => {
      if (!isMountedRef.current) return;
      checkHosViolations().then(result => {
        if (isMountedRef.current) setHosViolations(result);
      }).catch(() => {/* silent */});
    }, 60_000);
    return () => {
      if (hosCheckIntervalRef.current) clearInterval(hosCheckIntervalRef.current);
    };
  }, []);

  // ── WTD shift start detection ──
  // Record shift start when driving first begins (drivingSeconds goes from 0 → positive)
  useEffect(() => {
    if (drivingSeconds > 0 && shiftStartRef.current === null) {
      shiftStartRef.current = Date.now();
    }
  }, [drivingSeconds]);

  // ── Track first drive time for driverHabits ──
  useEffect(() => {
    if (drivingSeconds > 0 && firstDriveTimeRef.current === null) {
      firstDriveTimeRef.current = Date.now();
    }
  }, [drivingSeconds]);

  // ── End-of-day detection: start 5-min timer when navigation stops ──
  useEffect(() => {
    if (navigating) {
      // Cancel any pending end-of-day timer while still navigating
      if (endOfDayTimerRef.current) {
        clearTimeout(endOfDayTimerRef.current);
        endOfDayTimerRef.current = null;
      }
      return;
    }

    // Not navigating — if we have driven seconds today, start the end-of-day countdown
    if (drivingSecondsRef.current > 0) {
      if (endOfDayTimerRef.current) clearTimeout(endOfDayTimerRef.current);
      endOfDayTimerRef.current = setTimeout(() => {
        if (!isMountedRef.current) return;
        lastStopTimeRef.current = Date.now();
        // Record daily stats for driver habits
        if (firstDriveTimeRef.current !== null) {
          const today = new Date().toISOString().slice(0, 10);
          const firstDriveHour = new Date(firstDriveTimeRef.current).getHours();
          const lastStopHour = new Date().getHours();
          const totalDrivenMin = Math.round(drivingSecondsRef.current / 60);
          recordDailyStats({ date: today, firstDriveHour, lastStopHour, totalDrivenMin }).catch(() => {/* silent */});
        }
        if (onEndOfDay) onEndOfDay();
      }, 5 * 60 * 1000); // 5 minutes
    }

    return () => {
      if (endOfDayTimerRef.current) {
        clearTimeout(endOfDayTimerRef.current);
        endOfDayTimerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigating]);

  // ── Expert EU 561/2006 voice warnings ──
  useEffect(() => {
    if (!navigating || !tachoSummary) return;
    
    // Remaining driving time in minutes
    const remSeconds = Math.max(0, HOS_LIMIT_S - drivingSeconds);
    const remMinutes = Math.floor(remSeconds / 60);

    // Auto-search and alert at 20 and 10 minutes
    if (remMinutes <= 20 && !warned20Ref.current && drivingSeconds > 0) {
      warned20Ref.current = true;
      if (onApproachingLimit) onApproachingLimit(20);
    }
    if (remMinutes <= 10 && !warned10Ref.current && drivingSeconds > 0) {
      warned10Ref.current = true;
      if (onApproachingLimit) onApproachingLimit(10);
    }

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
      const can10h = tachoSummary.daily_limit_h === 10;
      if (can10h) {
        speak('Достигна 9 часа каране. Имаш още 1 час до максимума за днес.');
      } else {
        speak('Достигна лимита от 9 часа. Трябва да направиш почивка.');
      }
    }

    // 3. Weekly 56h limit
    const weeklyTotal = (tachoSummary.weekly_driven_s || 0) + (drivingSeconds - (tachoSummary.continuous_driven_s || 0));
    if (weeklyTotal >= 194400 && !hosWarningRef.current.weekly56h) {
      hosWarningRef.current.weekly56h = true;
      speak('Внимание, наближаваш 56-часовия седмичен лимит.');
    }

    // 4. Reduced rests check
    if (tachoSummary.reduced_rests_remaining === 0 && !hosWarningRef.current.limit) {
      if (dailyTotal > DAILY_LIMIT_9H - 1800) {
        // placeholder — no spam
      }
    }

  }, [drivingSeconds, navigating, speak, tachoSummary, onApproachingLimit]);

  const resetSession = useCallback(() => {
    setDrivingSeconds(0);
    sessionStartRef.current = new Date().toISOString();
    // Record shift start if not already set
    if (shiftStartRef.current === null) {
      shiftStartRef.current = Date.now();
    }
    hosWarningRef.current = {
      w30: false, w10: false, limit: false,
      daily9h: false, daily10h: false, weekly56h: false
    };
    warned20Ref.current = false;
    warned10Ref.current = false;
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

  // ── Attach shift_start_iso (raw fact) to tachoSummary ──
  const shiftStartIso = shiftStartRef.current
    ? new Date(shiftStartRef.current).toISOString()
    : undefined;

  const tachoSummaryWithShift: TachoSummary | null = tachoSummary
    ? { ...tachoSummary, shift_start_iso: shiftStartIso }
    : null;

  return {
    drivingSeconds,
    tachoSummary: tachoSummaryWithShift,
    setTachoSummary,
    resetSession,
    saveSession,
    HOS_LIMIT_S,
    hosViolations,
  };
}
