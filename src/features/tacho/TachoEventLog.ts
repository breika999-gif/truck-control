import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from '../../i18n';

const STORAGE_KEY = 'tacho_event_log';
const KEEP_DAYS = 20;

export type ActivityCode = 0 | 1 | 2 | 3; // 0=REST,1=AVAIL,2=WORK,3=DRIVING
export const ACTIVITY_LABEL: Record<ActivityCode, string> = {
  0: 'REST', 1: 'AVAILABILITY', 2: 'WORK', 3: 'DRIVING',
};

export interface TachoEvent {
  ts: string;               // ISO timestamp
  activity: ActivityCode;
  drivenMinToday: number;
  leftMin: number;
}

export interface TachoSummarySegment {
  activity: string;
  activity_code: ActivityCode;
  start: string;
  end: string;
  duration_min: number;
}

// ── Load / save helpers ───────────────────────────────────────────────────────

async function loadLog(): Promise<TachoEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TachoEvent[]) : [];
  } catch {
    return [];
  }
}

async function saveLog(events: TachoEvent[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    // silent — storage errors must not affect driving UI
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Track last emitted activity to skip duplicate events */
let _lastActivity: ActivityCode | null = null;

/**
 * Call every time TachoBleService emits an update.
 * Only persists when the activity code actually changes.
 */
export async function logEvent(
  activityCode: ActivityCode,
  leftMin: number,
  drivenMinToday: number,
): Promise<void> {
  if (activityCode === _lastActivity) return;
  _lastActivity = activityCode;
  const events = await loadLog();
  const updated = [...events, { ts: new Date().toISOString(), activity: activityCode, drivenMinToday, leftMin }];
  await saveLog(updated);
}

/** Remove events older than KEEP_DAYS. Call once on hook mount. */
export async function cleanup(): Promise<void> {
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  const events = await loadLog();
  const filtered = events.filter(e => new Date(e.ts).getTime() > cutoff);
  await saveLog(filtered);
}

/** Weekly + biweekly EU HOS summary for Gemini context (last 14 days of log). */
export async function getWeeklySummary(): Promise<object> {
  const events = await loadLog();
  const now = Date.now();
  const weekMs = 7 * 86400000;
  const twoWeekMs = 14 * 86400000;

  // Group by calendar day
  const byDay: Record<string, TachoEvent[]> = {};
  events.forEach(e => {
    const day = e.ts.slice(0, 10);
    if (!byDay[day]) { byDay[day] = []; }
    byDay[day].push(e);
  });

  // For each day compute driven minutes (last event's drivenMinToday)
  const dailyDriven: Record<string, number> = {};
  Object.entries(byDay).forEach(([day, evts]) => {
    dailyDriven[day] = evts[evts.length - 1].drivenMinToday;
  });

  const last7days = Object.entries(dailyDriven)
    .filter(([day]) => now - new Date(day).getTime() < weekMs);
  const last14days = Object.entries(dailyDriven)
    .filter(([day]) => now - new Date(day).getTime() < twoWeekMs);

  const weeklyDrivenMin = last7days.reduce((s, [, m]) => s + m, 0);
  const biweeklyDrivenMin = last14days.reduce((s, [, m]) => s + m, 0);

  return {
    weekly_driven_min:     weeklyDrivenMin,
    weekly_limit_min:      56 * 60,
    weekly_remaining_min:  Math.max(0, 56 * 60 - weeklyDrivenMin),
    biweekly_driven_min:   biweeklyDrivenMin,
    biweekly_limit_min:    90 * 60,
    biweekly_remaining_min: Math.max(0, 90 * 60 - biweeklyDrivenMin),
  };
}

// ── Offline HOS violation checker ────────────────────────────────────────────

export interface HosViolation {
  type: 'continuous_driving' | 'daily_limit' | 'daily_rest';
  message: string;           // Bulgarian message for the driver
  minutesOver?: number;
}

export async function checkHosViolations(): Promise<HosViolation[]> {
  const violations: HosViolation[] = [];
  const events = await loadLog();
  const today = new Date().toDateString();
  const todayEvents = events.filter(e => new Date(e.ts).toDateString() === today);

  if (todayEvents.length === 0) return [];

  // 1. Check continuous driving > 4h30min (270 min) without a full 45min or split 15+30 break
  let continuousDrivingMin = 0;
  let splitStarted = false;
  for (let i = 0; i < todayEvents.length; i++) {
    const e = todayEvents[i];
    const next = todayEvents[i + 1];
    const durationMin = next
      ? Math.round((new Date(next.ts).getTime() - new Date(e.ts).getTime()) / 60000)
      : Math.round((Date.now() - new Date(e.ts).getTime()) / 60000);

    if (e.activity === 3) { // DRIVING
      continuousDrivingMin += durationMin;
    } else if (durationMin >= 45) {
      // Full 45-min break — full reset
      continuousDrivingMin = 0;
      splitStarted = false;
    } else if (durationMin >= 30 && splitStarted) {
      // Second part of split break (15+30) — full reset
      continuousDrivingMin = 0;
      splitStarted = false;
    } else if (durationMin >= 15) {
      // First part of split break — mark started, do NOT reset yet
      splitStarted = true;
    }
  }

  if (continuousDrivingMin > 270) {
    violations.push({
      type: 'continuous_driving',
      message: i18n.t('tacho.continuousBreakNeeded', {
        hours: Math.round(continuousDrivingMin / 60 * 10) / 10,
      }),
      minutesOver: continuousDrivingMin - 270,
    });
  } else if (continuousDrivingMin > 240) {
    violations.push({
      type: 'continuous_driving',
      message: i18n.t('tacho.continuousBreakWarning', {
        minutes: Math.round(270 - continuousDrivingMin),
      }),
    });
  }

  // 2. Check daily driving limit (use last event's leftMin)
  const lastEvent = todayEvents[todayEvents.length - 1];
  if (lastEvent.leftMin !== null && lastEvent.leftMin <= 30) {
    violations.push({
      type: 'daily_limit',
      message: i18n.t('tacho.dailyDrivingLeft', { minutes: lastEvent.leftMin }),
    });
  }

  return violations;
}

/** Compact daily summary for Gemini context — today's events only. */
export async function getDaySummary(): Promise<object> {
  const today = new Date().toDateString();
  const events = (await loadLog()).filter(e => new Date(e.ts).toDateString() === today);

  if (events.length === 0) return {};

  const lastEvent = events[events.length - 1];
  // Ако последната активност е DRIVING (3), добави изминалото време от последния запис до сега
  const lastEventMs = new Date(lastEvent.ts).getTime();
  const elapsedSinceLastMin = lastEvent.activity === 3
    ? Math.round((Date.now() - lastEventMs) / 60_000)
    : 0;
  const drivenTodayMin = lastEvent.drivenMinToday + elapsedSinceLastMin;
  const remainingTodayMin = Math.max(0, (lastEvent.leftMin ?? 0) - elapsedSinceLastMin);

  // Непрекъснато каране от последната пауза ≥15мин
  let continuousMin = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    const next = events[i + 1];
    const durationMin = next
      ? Math.round((new Date(next.ts).getTime() - new Date(e.ts).getTime()) / 60_000)
      : Math.round((Date.now() - new Date(e.ts).getTime()) / 60_000);
    if (e.activity === 3) { // DRIVING
      continuousMin += durationMin;
    } else if (durationMin >= 15) {
      break; // достатъчна пауза — reset
    }
    // пауза < 15мин не ресетва — продължи назад
  }

  const continuousRemainingMin = Math.max(0, 270 - continuousMin); // 4.5ч = 270мин
  const nextBreakInMin = continuousRemainingMin;

  // Краен час на смяната (shift_start + 13ч)
  const firstEvent = events[0];
  const shiftStartMs = new Date(firstEvent.ts).getTime();
  const shiftEndMs = shiftStartMs + 13 * 3600_000;
  const shiftEndAt = new Date(shiftEndMs).toTimeString().slice(0, 5); // "HH:MM"
  const currentTime = new Date().toTimeString().slice(0, 5);

  const segments: TachoSummarySegment[] = events.map((event, index) => {
    const nextEvent = events[index + 1];
    const startMs = new Date(event.ts).getTime();
    const endMs = nextEvent
      ? new Date(nextEvent.ts).getTime()
      : Date.now();
    return {
      activity: ACTIVITY_LABEL[event.activity],
      activity_code: event.activity,
      start: new Date(startMs).toTimeString().slice(0, 5),
      end: new Date(endMs).toTimeString().slice(0, 5),
      duration_min: Math.max(0, Math.round((endMs - startMs) / 60_000)),
    };
  });

  return {
    shift_start:               new Date(shiftStartMs).toTimeString().slice(0, 5),
    shift_start_iso:           new Date(shiftStartMs).toISOString(),
    current_time:              currentTime,
    current_activity:          ACTIVITY_LABEL[lastEvent.activity],
    total_driven_min:          drivenTodayMin,
    remaining_drive_min:       remainingTodayMin,
    driven_today_min:          drivenTodayMin,
    remaining_today_min:       remainingTodayMin,
    continuous_driving_min:    continuousMin,
    continuous_remaining_min:  continuousRemainingMin,
    next_break_in_min:         nextBreakInMin,
    shift_end_at:              shiftEndAt,
    segments,
  };
}
