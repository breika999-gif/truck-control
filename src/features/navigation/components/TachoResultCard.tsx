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

const TachoResultCard: React.FC<TachoResultCardProps> = ({
  result,
  tachoSummary,
  onClose,
  onNavigate,
  topOffset,
}) => {
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
        <Text style={styles.tachRow}>🕐 Изкарани: {result.drivenHours.toFixed(1)} ч</Text>
        <Text style={[styles.tachRow, result.breakNeeded && styles.tachWarn]}>
          {result.breakNeeded
            ? '⚠️ Нужна е задължителна 45 мин почивка!'
            : result.remainingHours < 0.5
            ? `⚠️ Само ${Math.round(result.remainingHours * 60)} мин до почивка!`
            : `✅ Остават ${result.remainingHours.toFixed(1)} ч`}
        </Text>

        {/* Daily / Weekly from persistent DB */}
        {tachoSummary && (
          <>
            <View style={styles.tachDivider} />
            <Text style={styles.tachRow}>
              📅 Дневно: {tachoSummary.daily_driven_h.toFixed(1)} / {tachoSummary.daily_limit_h} ч
              {'  '}
              <Text style={tachoSummary.daily_remaining_h < 1 ? styles.tachWarn : styles.tachOk}>
                (остават {tachoSummary.daily_remaining_h.toFixed(1)} ч)
              </Text>
            </Text>
            <Text style={styles.tachRow}>
              📆 Седмично: {tachoSummary.weekly_driven_h.toFixed(1)} / {tachoSummary.weekly_limit_h} ч
              {'  '}
              <Text style={tachoSummary.weekly_remaining_h < 4 ? styles.tachWarn : styles.tachOk}>
                (остават {tachoSummary.weekly_remaining_h.toFixed(1)} ч)
              </Text>
            </Text>
            {tachoSummary.biweekly_driven_h !== undefined && (
              <Text style={styles.tachRow}>
                📊 2 седм.: {tachoSummary.biweekly_driven_h.toFixed(1)} / {tachoSummary.biweekly_limit_h} ч
                {'  '}
                <Text style={tachoSummary.biweekly_remaining_h < 5 ? styles.tachWarn : styles.tachOk}>
                  (остават {tachoSummary.biweekly_remaining_h.toFixed(1)} ч)
                </Text>
              </Text>
            )}
            <View style={styles.tachDivider} />
            {/* Weekly daily-rest breakdown */}
            <Text style={styles.tachRow}>🌙 Дневни почивки седмицата:</Text>
            <Text style={styles.tachRow}>
              {'  '}🌕 11ч (пълни): {tachoSummary.weekly_regular_rests}
              {'   '}
              <Text style={tachoSummary.weekly_reduced_rests > 0 ? styles.tachOk : undefined}>
                🌗 9ч (намалени): {tachoSummary.weekly_reduced_rests}/3
              </Text>
            </Text>
            {tachoSummary.reduced_rests_remaining === 0 ? (
              <Text style={styles.tachWarn}>
                ⚠️ Намалените почивки свършиха — следващата трябва да е 11ч!
              </Text>
            ) : (
              <Text style={styles.tachOk}>
                Още {tachoSummary.reduced_rests_remaining}x 9ч почивки
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

export default TachoResultCard;
