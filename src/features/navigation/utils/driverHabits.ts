import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'driver_habits';

interface DailyRecord {
  date: string;           // YYYY-MM-DD
  firstDriveHour: number; // hour of day when first DRIVING (0-23)
  lastStopHour: number;   // hour of day when switched to REST for the night
  totalDrivenMin: number;
  avgSpeedKmh?: number;
}

interface DriverHabits {
  records: DailyRecord[];
  typicalStartHour: number | null;
  typicalStopHour: number | null;
  avgDailyDrivenMin: number | null;
}

export async function recordDailyStats(stats: DailyRecord): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const habits: DriverHabits = raw
      ? (JSON.parse(raw) as DriverHabits)
      : { records: [], typicalStartHour: null, typicalStopHour: null, avgDailyDrivenMin: null };

    // Add or update today's record (immutable pattern)
    const idx = habits.records.findIndex(r => r.date === stats.date);
    const updatedRecords = idx >= 0
      ? habits.records.map((r, i) => (i === idx ? stats : r))
      : [...habits.records, stats];

    // Keep only last 14 days
    const trimmedRecords = updatedRecords.slice(-14);

    // Recompute averages
    let typicalStartHour: number | null = null;
    let typicalStopHour: number | null = null;
    let avgDailyDrivenMin: number | null = null;

    if (trimmedRecords.length >= 3) {
      const starts = trimmedRecords.map(r => r.firstDriveHour).filter(h => h >= 0);
      const stops = trimmedRecords.map(r => r.lastStopHour).filter(h => h >= 0);
      typicalStartHour = Math.round(starts.reduce((a, b) => a + b, 0) / starts.length);
      typicalStopHour = Math.round(stops.reduce((a, b) => a + b, 0) / stops.length);
      avgDailyDrivenMin = Math.round(
        trimmedRecords.reduce((s, r) => s + r.totalDrivenMin, 0) / trimmedRecords.length,
      );
    }

    const updated: DriverHabits = {
      records: trimmedRecords,
      typicalStartHour,
      typicalStopHour,
      avgDailyDrivenMin,
    };

    await AsyncStorage.setItem(KEY, JSON.stringify(updated));
  } catch {
    // silent — habit tracking must not affect driving UI
  }
}

export async function getHabitsSummary(): Promise<object | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const habits: DriverHabits = JSON.parse(raw) as DriverHabits;
    if (habits.records.length < 3) return null; // not enough data yet
    return {
      typical_start: habits.typicalStartHour !== null ? `${habits.typicalStartHour}:00` : null,
      typical_stop: habits.typicalStopHour !== null ? `${habits.typicalStopHour}:00` : null,
      avg_daily_driven_h: habits.avgDailyDrivenMin !== null
        ? Math.round(habits.avgDailyDrivenMin / 6) / 10
        : null,
      data_days: habits.records.length,
    };
  } catch {
    return null;
  }
}
