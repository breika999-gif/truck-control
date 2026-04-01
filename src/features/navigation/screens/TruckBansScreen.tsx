import React, { useState, useEffect, useMemo } from 'react';
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
import { colors, spacing, radius } from '../../../shared/constants/theme';
import { BACKEND_URL } from '../../../shared/constants/config';

const NEON = '#00f7ff';
const NEON_DIM = 'rgba(0,247,255,0.08)';

interface Ban {
  flag: string;
  country: string;
  time: string;
  alert: boolean;
  note?: string;
}

const FLAG_MAP: Record<string, string> = {
  AT: '🇦🇹', BE: '🇧🇪', BG: '🇧🇬', CH: '🇨🇭', CZ: '🇨🇿',
  DE: '🇩🇪', DK: '🇩🇰', ES: '🇪🇸', FI: '🇫🇮', FR: '🇫🇷',
  GB: '🇬🇧', GR: '🇬🇷', HR: '🇭🇷', HU: '🇭🇺', IT: '🇮🇹',
  LI: '🇱🇮', LU: '🇱🇺', NL: '🇳🇱', NO: '🇳🇴', PL: '🇵🇱',
  PT: '🇵🇹', RO: '🇷🇴', RS: '🇷🇸', SE: '🇸🇪', SI: '🇸🇮',
  SK: '🇸🇰', TR: '🇹🇷', UA: '🇺🇦',
};

const COUNTRY_BG: Record<string, string> = {
  Austria: 'Австрия', Belgium: 'Белгия', Bulgaria: 'България',
  Switzerland: 'Швейцария', 'Czech Republic': 'Чехия', Germany: 'Германия',
  Denmark: 'Дания', Spain: 'Испания', Finland: 'Финландия', France: 'Франция',
  Croatia: 'Хърватия', Hungary: 'Унгария', Italy: 'Италия',
  Liechtenstein: 'Лихтенщайн', Luxembourg: 'Люксембург', Netherlands: 'Холандия',
  Norway: 'Норвегия', Poland: 'Полша', Portugal: 'Португалия',
  Romania: 'Румъния', Serbia: 'Сърбия', Sweden: 'Швеция',
  Slovenia: 'Словения', Slovakia: 'Словакия', Turkey: 'Турция', Ukraine: 'Украйна',
};

const DAYS_BG = ['Нед', 'Пон', 'Вто', 'Сря', 'Чет', 'Пет', 'Съб'];
const MONTHS_BG = ['Яну', 'Фев', 'Мар', 'Апр', 'Май', 'Юни', 'Юли', 'Авг', 'Сеп', 'Окт', 'Ное', 'Дек'];

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

const TODAY = toISO(new Date());

export default function TruckBansScreen() {
  const navigation = useNavigation();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [bans, setBans] = useState<Ban[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const dates = useMemo(() => {
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() + i);
      return d;
    });
  }, []);

  useEffect(() => { fetchBans(); }, [selectedDate]);

  const fetchBans = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/truck-bans?date=${toISO(selectedDate)}`);
      const data = await res.json();
      if (data.error) setError(data.error);
      else setBans(data.bans || []);
    } catch {
      setError('Грешка при зареждане');
    } finally {
      setLoading(false);
    }
  };

  const renderBan = ({ item }: { item: Ban }) => {
    const code = item.flag.toUpperCase();
    const flag = FLAG_MAP[code] ?? '🏳️';
    const name = COUNTRY_BG[item.country] ?? item.country;
    return (
      <View style={[styles.card, item.alert && styles.cardAlert]}>
        {item.alert && <View style={styles.alertAccent} />}
        <Text style={styles.flag}>{flag}</Text>
        <View style={styles.cardBody}>
          <Text style={styles.countryName}>{name}</Text>
          {item.note ? <Text style={styles.noteText}>{item.note}</Text> : null}
        </View>
        <Text style={styles.timeText}>{item.time}</Text>
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
        <Text style={styles.headerTitle}>🚫 Забрани за движение</Text>
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
              {isToday && <Text style={styles.todayLabel}>ДНЕС</Text>}
              <Text style={[styles.dateDayName, isSelected && styles.dateTextSelected]}>
                {DAYS_BG[date.getDay()]}
              </Text>
              <Text style={[styles.dateDayNum, isSelected && styles.dateTextSelected]}>
                {String(date.getDate()).padStart(2,'0')}
              </Text>
              <Text style={[styles.dateMonth, isSelected && styles.dateTextSelected]}>
                {MONTHS_BG[date.getMonth()]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Content */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={NEON} />
          <Text style={styles.loadingText}>Зареждане...</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>⚠️ {error}</Text>
          <TouchableOpacity onPress={fetchBans} style={styles.retryBtn}>
            <Text style={styles.retryText}>Опитай пак</Text>
          </TouchableOpacity>
        </View>
      ) : bans.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>✅</Text>
          <Text style={styles.emptyText}>Няма забрани за тази дата</Text>
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
  card:             { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 12, padding: spacing.md, marginBottom: spacing.sm, overflow: 'hidden' },
  cardAlert:        { borderColor: 'rgba(0,247,255,0.3)', backgroundColor: NEON_DIM },
  alertAccent:      { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: NEON, borderTopLeftRadius: 12, borderBottomLeftRadius: 12 },
  flag:             { fontSize: 34, marginRight: spacing.md },
  cardBody:         { flex: 1 },
  countryName:      { fontSize: 16, fontWeight: '700', color: colors.text },
  noteText:         { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  timeText:         { fontSize: 18, fontWeight: '800', color: NEON },

  center:           { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  loadingText:      { color: colors.textSecondary, marginTop: spacing.sm },
  errorText:        { color: colors.error, fontSize: 15, textAlign: 'center', marginBottom: spacing.md },
  retryBtn:         { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: NEON },
  retryText:        { color: NEON, fontWeight: '600' },
  emptyIcon:        { fontSize: 48, marginBottom: spacing.sm },
  emptyText:        { color: colors.text, fontSize: 16, textAlign: 'center' },
});
