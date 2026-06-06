import { useState, useRef, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleAccount } from '../../../shared/services/accountManager';
import {
  saveTachoSession,
  fetchTachoSummary,
  logRestStop,
  RestType,
  TachoSummary,
  TachoSessionPayload,
} from '../../../shared/services/backendApi';
import { checkHosViolations, HosViolation } from '../../tacho/TachoEventLog';
import { recordDailyStats } from '../utils/driverHabits';
import { useTachoBluetooth } from '../../tacho/hooks/useTachoBluetooth';
import i18n from '../../../i18n';

const HOS_LIMIT_S = 16200; // EU 4.5h = 16 200 s
const DAILY_LIMIT_9H = 32400; // 9h
const PENDING_TACHO_SESSIONS_KEY = '@truckai/pending_tacho_sessions_v1';

export interface WeeklyStatus {
  drivenH: number;
  remainingH: number;
  canExtendToday: boolean;
  mustRecuperateBy: string;
  recommendedStartTomorrow: string | null;
}

export function calcWeeklyStatus(
  tachoSummary: TachoSummary,
  now = new Date(),
): WeeklyStatus {
  const drivenH = Math.max(0, tachoSummary.weekly_driven_h);
  const remainingH = Math.max(0, tachoSummary.weekly_remaining_h);
  const canExtendToday = tachoSummary.daily_limit_h === 10;
  const weekStartMs = Date.parse(`${tachoSummary.week_start}T00:00:00.000Z`);
  const weekEndMs = Number.isFinite(weekStartMs)
    ? weekStartMs + 7 * 24 * 3600 * 1000
    : now.getTime() + 7 * 24 * 3600 * 1000;
  const mustRecuperateByMs = remainingH < 9
    ? Math.min(weekEndMs, now.getTime() + remainingH * 3600 * 1000)
    : weekEndMs;
  const dailyRestH = tachoSummary.reduced_rests_remaining > 0 ? 9 : 11;

  return {
    drivenH,
    remainingH,
    canExtendToday,
    mustRecuperateBy: new Date(mustRecuperateByMs).toISOString(),
    recommendedStartTomorrow: new Date(now.getTime() + dailyRestH * 3600 * 1000).toISOString(),
  };
}

async function loadPendingTachoSessions(): Promise<TachoSessionPayload[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_TACHO_SESSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as TachoSessionPayload[] : [];
  } catch {
    return [];
  }
}

async function savePendingTachoSessions(queue: TachoSessionPayload[]): Promise<void> {
  if (queue.length === 0) {
    await AsyncStorage.removeItem(PENDING_TACHO_SESSIONS_KEY);
    return;
  }
  await AsyncStorage.setItem(PENDING_TACHO_SESSIONS_KEY, JSON.stringify(queue));
}

function restTypeForDuration(durationMin: number): RestType {
  if (durationMin >= 11 * 60) return 'daily_11h';
  if (durationMin >= 9 * 60) return 'reduced_9h';
  return 'break_45min';
}

export function useTacho(
  navigating: boolean,
  isDrivingRef: React.MutableRefObject<boolean>,
  googleUserRef: React.MutableRefObject<GoogleAccount | null>,
  userCoordsRef: React.MutableRefObject<[number, number] | null>,
  speak: (text: string) => void,
  onEndOfDay?: () => void,
  onApproachingLimit?: (remainingMinutes: number) => void,
) {
  const bluetoothTacho = useTachoBluetooth();
  const [localDrivingSeconds, setDrivingSeconds] = useState(0);
  const [tachoSummary, setTachoSummary] = useState<TachoSummary | null>(null);
  const [hosViolations, setHosViolations] = useState<HosViolation[]>([]);
  const bluetoothData = bluetoothTacho.connected ? bluetoothTacho.data : null;
  const drivingSeconds = bluetoothData?.continuousDrivenS ?? localDrivingSeconds;

  const drivingSecondsRef = useRef(0);
  const sessionStartRef = useRef<string | null>(null);
  const hosIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hosCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endOfDayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const abortControllerRef = useRef<AbortController | null>(null);
  const localBreakLoggedForSessionRef = useRef(false);
  const bleRestStartedAtRef = useRef<string | null>(null);
  const previousBluetoothActivityRef = useRef<'driving' | 'rest' | 'work' | 'available' | null>(null);
  // WTD shift start: timestamp (ms) when the shift began (first activity after rest)
  const shiftStartRef = useRef<number | null>(null);

  // Sync ref
  useEffect(() => { drivingSecondsRef.current = drivingSeconds; }, [drivingSeconds]);
  useEffect(() => () => {
    isMountedRef.current = false;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

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

  const flushPendingSessions = useCallback(async (signal?: AbortSignal) => {
    const pending = await loadPendingTachoSessions();
    if (pending.length === 0) return;

    const failed: TachoSessionPayload[] = [];
    let latestSummary: TachoSummary | null = null;

    for (const payload of pending) {
      if (signal?.aborted) return;
      const summary = await saveTachoSession(payload, signal);
      if (summary?.ok) {
        latestSummary = summary;
      } else {
        failed.push(payload);
      }
    }

    await savePendingTachoSessions(failed);
    if (latestSummary && isMountedRef.current && !signal?.aborted) {
      setTachoSummary(latestSummary);
    }
  }, []);

  useEffect(() => {
    flushPendingSessions().catch(e => console.error('[tacho] flush failed', e));
  }, [flushPendingSessions]);

  const submitRestLog = useCallback((
    restType: RestType,
    durationMin: number,
    startedAt: string,
  ) => {
    const coords = userCoordsRef.current;
    if (!coords || durationMin <= 0) return;
    void logRestStop({
      userEmail: googleUserRef.current?.email,
      lat: coords[1],
      lng: coords[0],
      restType,
      durationMin,
      startedAt,
    });
  }, [googleUserRef, userCoordsRef]);

  useEffect(() => {
    const activity = bluetoothData?.activity ?? null;
    const previousActivity = previousBluetoothActivityRef.current;
    previousBluetoothActivityRef.current = activity;

    if (activity === 'rest' && previousActivity !== 'rest') {
      bleRestStartedAtRef.current = new Date().toISOString();
      return;
    }
    if (previousActivity !== 'rest' || activity === 'rest') return;

    const startedAt = bleRestStartedAtRef.current;
    bleRestStartedAtRef.current = null;
    if (!startedAt) return;
    const durationMin = Math.floor((Date.now() - Date.parse(startedAt)) / 60000);
    if (durationMin >= 45) {
      submitRestLog(restTypeForDuration(durationMin), durationMin, startedAt);
    }
  }, [bluetoothData?.activity, submitRestLog]);

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
      speak(i18n.t('tachoAlerts.thirtyMinutesToBreak'));
    }
    if (drivingSeconds >= 15600 && !hosWarningRef.current.w10) {
      hosWarningRef.current.w10 = true;
      speak(i18n.t('tachoAlerts.tenMinutesSearchParking'));
    }
    
    // 2. Daily limits (9h / 10h)
    const dailyTotal = bluetoothData?.dailyDrivenS ??
      ((tachoSummary.daily_driven_s || 0) + (drivingSeconds - (tachoSummary.continuous_driven_s || 0)));
    if (dailyTotal >= DAILY_LIMIT_9H && !hosWarningRef.current.daily9h) {
      hosWarningRef.current.daily9h = true;
      const can10h = tachoSummary.daily_limit_h === 10;
      if (can10h) {
        speak(i18n.t('tachoAlerts.reachedNineHoursCanExtend'));
      } else {
        speak(i18n.t('tachoAlerts.reachedNineHoursLimit'));
      }
    }

    // 3. Weekly 56h limit
    const weeklyTotal = bluetoothData && Number.isFinite(bluetoothData.weeklyDrivenS)
      ? bluetoothData.weeklyDrivenS
      : ((tachoSummary.weekly_driven_s || 0) + (drivingSeconds - (tachoSummary.continuous_driven_s || 0)));
    if (weeklyTotal >= 194400 && !hosWarningRef.current.weekly56h) {
      hosWarningRef.current.weekly56h = true;
      speak(i18n.t('tachoAlerts.weeklyLimitApproaching'));
    }

    // 4. Reduced rests check
    if (tachoSummary.reduced_rests_remaining === 0 && !hosWarningRef.current.limit) {
      if (dailyTotal > DAILY_LIMIT_9H - 1800) {
        // placeholder — no spam
      }
    }

  }, [bluetoothData, drivingSeconds, navigating, speak, tachoSummary, onApproachingLimit]);

  const resetSession = useCallback(() => {
    setDrivingSeconds(0);
    sessionStartRef.current = new Date().toISOString();
    localBreakLoggedForSessionRef.current = false;
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
    if (!bluetoothData && driven >= HOS_LIMIT_S && !localBreakLoggedForSessionRef.current) {
      localBreakLoggedForSessionRef.current = true;
      submitRestLog('break_45min', 45, new Date().toISOString());
    }
    if (driven >= 60 && sessionStartRef.current) {
      const payload = {
        user_email:     googleUserRef.current?.email,
        driven_seconds: driven,
        start_time:     sessionStartRef.current,
        end_time:       new Date().toISOString(),
      };

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      void saveTachoSession(payload, signal).then(async s => {
        if (signal.aborted) return;
        if (s?.ok) {
          if (isMountedRef.current) setTachoSummary(s);
          await flushPendingSessions(signal);
          return;
        }

        const pending = await loadPendingTachoSessions();
        pending.push(payload);
        await savePendingTachoSessions(pending);
      });
      sessionStartRef.current = null;
    }
  }, [bluetoothData, flushPendingSessions, googleUserRef, submitRestLog]);

  // ── Attach shift_start_iso (raw fact) to tachoSummary ──
  const shiftStartIso = shiftStartRef.current
    ? new Date(shiftStartRef.current).toISOString()
    : undefined;

  const tachoSummaryWithShift: TachoSummary | null = tachoSummary
    ? {
      ...tachoSummary,
      ...(bluetoothData
        ? {
          continuous_driven_s: bluetoothData.continuousDrivenS,
          continuous_remaining_s: Math.max(0, HOS_LIMIT_S - bluetoothData.continuousDrivenS),
          continuous_driven_h: bluetoothData.continuousDrivenS / 3600,
          continuous_remaining_h: Math.max(0, HOS_LIMIT_S - bluetoothData.continuousDrivenS) / 3600,
          daily_driven_s: bluetoothData.dailyDrivenS,
          daily_remaining_s: Math.max(0, tachoSummary.daily_limit_h * 3600 - bluetoothData.dailyDrivenS),
          daily_driven_h: bluetoothData.dailyDrivenS / 3600,
          daily_remaining_h: Math.max(0, tachoSummary.daily_limit_h * 3600 - bluetoothData.dailyDrivenS) / 3600,
          break_needed: bluetoothData.continuousDrivenS >= HOS_LIMIT_S,
        }
        : {}),
      ...(bluetoothData && Number.isFinite(bluetoothData.weeklyDrivenS)
        ? {
          weekly_driven_s: bluetoothData.weeklyDrivenS,
          weekly_remaining_s: Math.max(0, tachoSummary.weekly_limit_h * 3600 - bluetoothData.weeklyDrivenS),
          weekly_driven_h: bluetoothData.weeklyDrivenS / 3600,
          weekly_remaining_h: Math.max(0, tachoSummary.weekly_limit_h * 3600 - bluetoothData.weeklyDrivenS) / 3600,
        }
        : {}),
      shift_start_iso: shiftStartIso,
    }
    : null;

  return {
    drivingSeconds,
    tachoSummary: tachoSummaryWithShift,
    setTachoSummary,
    resetSession,
    saveSession,
    HOS_LIMIT_S,
    hosViolations,
    bluetoothTacho,
  };
}
