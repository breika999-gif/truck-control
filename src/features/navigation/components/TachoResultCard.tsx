import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { TachoSummary } from '../../../shared/services/backendApi';
import { styles } from '../screens/MapScreen.styles';

interface AITachoResult {
  drivenHours: number;
  remainingHours: number;
  breakNeeded: boolean;
  suggestedStop?: { lat: number; lng: number; name: string };
}

interface TachoResultCardProps {
  result: AITachoResult;
  tachoSummary: TachoSummary | null;
  onClose: () => void;
  onNavigate: (coord: [number, number], name: string) => void;
  topOffset: number;
}

const HOS_CONTINUOUS_LIMIT_S = 16200;

const TachoResultCard: React.FC<TachoResultCardProps> = ({
  result,
  tachoSummary,
  onClose,
  onNavigate,
  topOffset,
}) => {
  const asFiniteNumber = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

  const drivenHours = asFiniteNumber(result.drivenHours) ?? 0;
  const remainingHours = asFiniteNumber(result.remainingHours) ?? 0;
  const remainingSeconds = Math.max(0, remainingHours * 3600);
  const progress = Math.max(0, Math.min(1, remainingSeconds / HOS_CONTINUOUS_LIMIT_S));
  const barColor = remainingSeconds <= 600
    ? '#FF3B30'
    : remainingSeconds <= 1800
    ? '#FF9500'
    : '#34C759';
  const dailyDrivenH = asFiniteNumber(tachoSummary?.daily_driven_h);
  const dailyRemainingH = asFiniteNumber(tachoSummary?.daily_remaining_h);
  const dailyLimitH = asFiniteNumber(tachoSummary?.daily_limit_h);
  const weeklyDrivenH = asFiniteNumber(tachoSummary?.weekly_driven_h);
  const weeklyRemainingH = asFiniteNumber(tachoSummary?.weekly_remaining_h);
  const weeklyLimitH = asFiniteNumber(tachoSummary?.weekly_limit_h);
  const hasDailySummary = dailyDrivenH !== null && dailyRemainingH !== null && dailyLimitH !== null;
  const hasWeeklySummary = weeklyDrivenH !== null && weeklyRemainingH !== null && weeklyLimitH !== null;
  const biweeklyDrivenH = tachoSummary?.biweekly_driven_h;
  const biweeklyRemainingH = tachoSummary?.biweekly_remaining_h;
  const biweeklyLimitH = tachoSummary?.biweekly_limit_h;
  const hasBiweeklySummary =
    Number.isFinite(biweeklyDrivenH) &&
    Number.isFinite(biweeklyRemainingH) &&
    Number.isFinite(biweeklyLimitH);
  const weeklyRegularRests = tachoSummary?.weekly_regular_rests ?? 0;
  const weeklyReducedRests = tachoSummary?.weekly_reduced_rests ?? 0;
  const reducedRestsRemaining = tachoSummary?.reduced_rests_remaining ?? 0;

  return (
    <View style={[styles.tachPanel, { top: topOffset }]}>
      <View style={styles.parkingPanelHeader}>
        <Text style={styles.tachTitle}>🚛 Тахограф</Text>
        <TouchableOpacity onPress={onClose} style={styles.parkingDismissBtn}>
          <Text style={styles.parkingDismissTxt}>✕</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tachCard}>
        {/* Continuous session */}
        <Text style={styles.tachRow}>🕐 Изкарани: {drivenHours.toFixed(1)} ч</Text>
        <Text style={[styles.tachRow, result.breakNeeded && styles.tachWarn]}>
          {result.breakNeeded
            ? '⚠️ Нужна е задължителна 45 мин почивка!'
            : remainingHours < 0.5
            ? `⚠️ Само ${Math.round(remainingHours * 60)} мин до почивка!`
            : `✅ Остават ${remainingHours.toFixed(1)} ч`}
        </Text>
        <View style={{ height: 4, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 2, marginTop: 4 }}>
          <View style={{
            height: 4,
            width: `${progress * 100}%`,
            backgroundColor: barColor,
            borderRadius: 2,
          }} />
        </View>

        {/* Daily / Weekly from persistent DB */}
        {tachoSummary && (
          <>
            <View style={styles.tachDivider} />
            {hasDailySummary && (
              <Text style={styles.tachRow}>
                📅 Дневно: {dailyDrivenH!.toFixed(1)} / {dailyLimitH} ч
                {'  '}
                <Text style={dailyRemainingH! < 1 ? styles.tachWarn : styles.tachOk}>
                  (остават {dailyRemainingH!.toFixed(1)} ч)
                </Text>
              </Text>
            )}
            {hasWeeklySummary && (
              <Text style={styles.tachRow}>
                📆 Седмично: {weeklyDrivenH!.toFixed(1)} / {weeklyLimitH} ч
                {'  '}
                <Text style={weeklyRemainingH! < 4 ? styles.tachWarn : styles.tachOk}>
                  (остават {weeklyRemainingH!.toFixed(1)} ч)
                </Text>
              </Text>
            )}
            {hasBiweeklySummary && (
              <Text style={styles.tachRow}>
                📊 2 седм.: {biweeklyDrivenH!.toFixed(1)} / {biweeklyLimitH} ч
                {'  '}
                <Text style={biweeklyRemainingH! < 5 ? styles.tachWarn : styles.tachOk}>
                  (остават {biweeklyRemainingH!.toFixed(1)} ч)
                </Text>
              </Text>
            )}
            <View style={styles.tachDivider} />
            {/* Weekly daily-rest breakdown */}
            <Text style={styles.tachRow}>🌙 Дневни почивки седмицата:</Text>
            <Text style={styles.tachRow}>
              {'  '}🌕 11ч (пълни): {weeklyRegularRests}
              {'   '}
              <Text style={weeklyReducedRests > 0 ? styles.tachOk : undefined}>
                🌗 9ч (намалени): {weeklyReducedRests}/3
              </Text>
            </Text>
            {reducedRestsRemaining === 0 ? (
              <Text style={styles.tachWarn}>
                ⚠️ Намалените почивки свършиха — следващата трябва да е 11ч!
              </Text>
            ) : (
              <Text style={styles.tachOk}>
                Още {reducedRestsRemaining}x 9ч почивки
              </Text>
            )}
          </>
        )}

        {result.suggestedStop && (
          <TouchableOpacity
            style={styles.tachStopBtn}
            activeOpacity={0.8}
            onPress={() => {
              const s = result.suggestedStop!;
              onClose();
              onNavigate([s.lng, s.lat], s.name);
            }}
          >
            <Text style={styles.tachStopTxt}>🅿️ {result.suggestedStop.name} &gt;</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

export default React.memo(TachoResultCard);
