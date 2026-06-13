export type ParkingGrade = 'good' | 'medium' | 'risky';

export function calcParkingScore(p: {
  security?: boolean;
  lighting?: boolean;
  showers?: boolean;
  toilets?: boolean;
  paid?: boolean;
  transparking_id?: string;
  distance_m?: number;
}): { score: number; grade: ParkingGrade } {
  let score = 0;
  if (p.security) score += 30;
  if (p.lighting) score += 15;
  if (p.showers) score += 15;
  if (p.toilets) score += 10;
  if (p.transparking_id) score += 20;
  if (!p.paid) score += 5;
  if (p.distance_m != null && p.distance_m < 500) score += 5;

  const grade: ParkingGrade = score >= 55 ? 'good' : score >= 25 ? 'medium' : 'risky';
  return { score, grade };
}

export const GRADE_COLOR: Record<ParkingGrade, string> = {
  good: '#4cff91',
  medium: '#ffcc00',
  risky: '#ff4444',
};

export const GRADE_LABEL: Record<ParkingGrade, string> = {
  good: 'Добър',
  medium: 'Среден',
  risky: 'Рисков',
};

export type ReachStatus = 'ok' | 'tight' | 'no' | 'unknown';

export function calcParkingReach(
  distanceM: number | undefined,
  remainingDriveMin: number | undefined,
  speedKmh: number | undefined,
): { status: ReachStatus; reserveMin?: number } {
  if (distanceM == null || remainingDriveMin == null) return { status: 'unknown' };
  const avgSpeed = speedKmh && speedKmh > 10 ? speedKmh : 80;
  const neededMin = Math.round((distanceM / 1000) / avgSpeed * 60);
  const reserve = remainingDriveMin - neededMin;

  if (reserve >= 30) return { status: 'ok', reserveMin: reserve };
  if (reserve >= 0) return { status: 'tight', reserveMin: reserve };
  return { status: 'no', reserveMin: reserve };
}

export const REACH_CONFIG: Record<ReachStatus, {
  emoji: string;
  color: string;
  label: (reserveMin?: number) => string;
}> = {
  ok: { emoji: '✅', color: '#4cff91', label: reserveMin => `Стигаш с ${reserveMin} мин резерв` },
  tight: {
    emoji: '⚠️',
    color: '#ffcc00',
    label: reserveMin => reserveMin === 0 ? 'Стигаш на косъм' : `Стигаш с ${reserveMin} мин резерв`,
  },
  no: { emoji: '❌', color: '#ff4444', label: () => 'Няма да стигнеш' },
  unknown: { emoji: '', color: '#888', label: () => '' },
};
