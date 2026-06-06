import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius } from '../../../shared/constants/theme';
import { useTruckBans, type Ban } from '../hooks/useTruckBans';

const NEON = '#00f7ff';
const NEON_DIM = 'rgba(0,247,255,0.08)';

const FLAG_MAP: Record<string, string> = {
  AT: '🇦🇹', BE: '🇧🇪', BG: '🇧🇬', CH: '🇨🇭', CZ: '🇨🇿',
  DE: '🇩🇪', DK: '🇩🇰', ES: '🇪🇸', FI: '🇫🇮', FR: '🇫🇷',
  GB: '🇬🇧', GR: '🇬🇷', HR: '🇭🇷', HU: '🇭🇺', IT: '🇮🇹',
  LI: '🇱🇮', LU: '🇱🇺', NL: '🇳🇱', NO: '🇳🇴', PL: '🇵🇱',
  PT: '🇵🇹', RO: '🇷🇴', RS: '🇷🇸', SE: '🇸🇪', SI: '🇸🇮',
  SK: '🇸🇰', TR: '🇹🇷', UA: '🇺🇦',
};

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

const TODAY = toISO(new Date());

export default function TruckBansScreen() {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const locale = i18n.language === 'bg' ? 'bg-BG' : i18n.language === 'es' ? 'es-ES' : 'en-US';
  
  const { bans, loading, error, refetch } = useTruckBans(toISO(selectedDate));

  const dates = useMemo(() => {
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() + i);
      return d;
    });
  }, []);

  const renderBan = ({ item }: { item: Ban }) => {
    const code = item.flag.toUpperCase();
    const flag = FLAG_MAP[code] ?? '🏳️';
    const name = t(`countries.${item.country}`, { defaultValue: item.country });
    return (
      <View style={[styles.card, item.alert && styles.cardAlert]}>
        {item.alert && <View style={styles.alertAccent} />}
        <Text style={styles.flag}>{flag}</Text>
        <View style={styles.cardBody}>
          <Text style={styles.countryName} numberOfLines={1}>{name}</Text>
        </View>
        <Text style={styles.timeText} numberOfLines={1}>{item.time}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('bans.title')}</Text>
      </View>

      {/* Date Picker */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.datePicker}
        contentContainerStyle={styles.datePickerContent}
      >
        {dates.map((date, i) => {
          const iso = toISO(date);
          const isSelected = iso === toISO(selectedDate);
          const isToday = iso === TODAY;
          return (
            <TouchableOpacity
              key={i}
              onPress={() => setSelectedDate(date)}
              style={[styles.dateItem, isSelected && styles.dateItemSelected]}
            >
              {isToday && <Text style={styles.todayLabel}>{t('bans.today')}</Text>}
              <Text style={[styles.dateDayName, isSelected && styles.dateTextSelected]}>
                {date.toLocaleDateString(locale, { weekday: 'short' })}
              </Text>
              <Text style={[styles.dateDayNum, isSelected && styles.dateTextSelected]}>
                {String(date.getDate()).padStart(2,'0')}
              </Text>
              <Text style={[styles.dateMonth, isSelected && styles.dateTextSelected]}>
                {date.toLocaleDateString(locale, { month: 'short' })}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Content */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={NEON} />
          <Text style={styles.loadingText}>{t('common.loading')}</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>⚠️ {error}</Text>
          <TouchableOpacity onPress={refetch} style={styles.retryBtn}>
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : bans.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>✅</Text>
          <Text style={styles.emptyText}>{t('bans.empty')}</Text>
        </View>
      ) : (
        <FlatList
          data={bans}
          renderItem={renderBan}
          keyExtractor={(item, i) => `${item.flag}-${i}`}
          contentContainerStyle={styles.list}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: colors.bg },
  header:           { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: 'rgba(0,247,255,0.15)' },
  backBtn:          { padding: spacing.sm, marginRight: spacing.sm },
  backArrow:        { color: NEON, fontSize: 26, fontWeight: 'bold' },
  headerTitle:      { fontSize: 18, fontWeight: '800', color: NEON, letterSpacing: 0.5 },

  datePicker:       { maxHeight: 90, marginTop: spacing.sm },
  datePickerContent:{ paddingHorizontal: spacing.md, gap: spacing.xs },
  dateItem:         { width: 64, paddingVertical: 8, alignItems: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(255,255,255,0.04)', marginRight: 6 },
  dateItemSelected: { borderColor: NEON, backgroundColor: NEON_DIM },
  todayLabel:       { fontSize: 9, fontWeight: '800', color: NEON, letterSpacing: 1, marginBottom: 1 },
  dateDayName:      { fontSize: 11, color: colors.textSecondary, fontWeight: '600' },
  dateDayNum:       { fontSize: 18, fontWeight: '800', color: colors.text },
  dateMonth:        { fontSize: 10, color: colors.textSecondary },
  dateTextSelected: { color: NEON },

  list:             { padding: spacing.md, paddingBottom: 40 },
  card:             { flexDirection: 'row', alignItems: 'center', height: 60, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 12, paddingHorizontal: spacing.md, marginBottom: 6, overflow: 'hidden' },
  cardAlert:        { borderColor: 'rgba(0,247,255,0.3)', backgroundColor: NEON_DIM },
  alertAccent:      { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: NEON, borderTopLeftRadius: 12, borderBottomLeftRadius: 12 },
  flag:             { fontSize: 28, marginRight: spacing.sm, width: 40 },
  cardBody:         { flex: 1, marginRight: spacing.sm },
  countryName:      { fontSize: 15, fontWeight: '700', color: colors.text },
  timeText:         { fontSize: 16, fontWeight: '800', color: NEON, flexShrink: 0 },

  center:           { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  loadingText:      { color: colors.textSecondary, marginTop: spacing.sm },
  errorText:        { color: colors.error, fontSize: 15, textAlign: 'center', marginBottom: spacing.md },
  retryBtn:         { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: NEON },
  retryText:        { color: NEON, fontWeight: '600' },
  emptyIcon:        { fontSize: 48, marginBottom: spacing.sm },
  emptyText:        { color: colors.text, fontSize: 16, textAlign: 'center' },
});
