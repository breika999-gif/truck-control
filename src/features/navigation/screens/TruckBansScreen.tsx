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
import { colors, spacing, radius, typography } from '../../../shared/constants/theme';
import { BACKEND_URL } from '../../../shared/constants/config';

const NEON = '#00f7ff';

interface Ban {
  flag: string;
  country: string;
  time: string;
  alert: boolean;
}

const FLAG_MAPPING: Record<string, string> = {
  'DE': '🇩🇪', 'BG': '🇧🇬', 'AT': '🇦🇹', 'CH': '🇨🇭', 'FR': '🇫🇷',
  'IT': '🇮🇹', 'RO': '🇷🇴', 'HU': '🇭🇺', 'RS': '🇷🇸', 'HR': '🇭🇷',
  'SI': '🇸🇮', 'SK': '🇸🇰', 'PL': '🇵🇱', 'CZ': '🇨🇿', 'GR': '🇬🇷', 'TR': '🇹🇷'
};

const DAYS_TO_SHOW = 14;

const TruckBansScreen = () => {
  const navigation = useNavigation();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [bans, setBans] = useState<Ban[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const dates = useMemo(() => {
    const arr = [];
    for (let i = 0; i < DAYS_TO_SHOW; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      arr.push(d);
    }
    return arr;
  }, []);

  const formatDateForAPI = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const formatDateForUI = (date: Date) => {
    const days = ['Нед', 'Пон', 'Вто', 'Сря', 'Чет', 'Пет', 'Съб'];
    const months = ['Яну', 'Фев', 'Мар', 'Апр', 'Май', 'Юни', 'Юли', 'Авг', 'Сеп', 'Окт', 'Ное', 'Дек'];
    const dayName = days[date.getDay()];
    const dayNum = String(date.getDate()).padStart(2, '0');
    const monthName = months[date.getMonth()];
    return `${dayName}\n${dayNum} ${monthName}`;
  };

  useEffect(() => {
    fetchBans();
  }, [selectedDate]);

  const fetchBans = async () => {
    setLoading(true);
    setError(null);
    try {
      const dateStr = formatDateForAPI(selectedDate);
      const response = await fetch(`${BACKEND_URL}/api/truck-bans?date=${dateStr}`);
      const data = await response.json();
      if (data.error) {
        setError(data.error);
      } else {
        setBans(data.bans || []);
      }
    } catch (err) {
      setError('Грешка при зареждане');
    } finally {
      setLoading(false);
    }
  };

  const renderBanItem = ({ item }: { item: Ban }) => (
    <View style={styles.card}>
      <View style={styles.cardLeft}>
        <Text style={styles.flag}>{FLAG_MAPPING[item.flag] || item.flag}</Text>
        <View style={styles.countryContainer}>
          <Text style={styles.countryName}>{item.country}</Text>
          {item.alert && <Text style={styles.alertIcon}>⚠️</Text>}
        </View>
      </View>
      <Text style={styles.timeText}>{item.time}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>🚫 Забрани за движение</Text>
      </View>

      <View style={styles.datePickerContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.datePickerContent}>
          {dates.map((date, index) => {
            const isSelected = formatDateForAPI(date) === formatDateForAPI(selectedDate);
            return (
              <TouchableOpacity
                key={index}
                onPress={() => setSelectedDate(date)}
                style={[
                  styles.dateItem,
                  isSelected && styles.dateItemSelected
                ]}
              >
                <Text style={[styles.dateText, isSelected && styles.dateTextSelected]}>
                  {formatDateForUI(date)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={NEON} />
        </View>
      ) : error ? (
        <View style={styles.centerContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={fetchBans} style={styles.retryButton}>
            <Text style={styles.retryText}>Опитай пак</Text>
          </TouchableOpacity>
        </View>
      ) : bans.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text style={styles.emptyText}>Няма забрани за избраната дата ✅</Text>
        </View>
      ) : (
        <FlatList
          data={bans}
          renderItem={renderBanItem}
          keyExtractor={(item, index) => `${item.flag}-${index}`}
          contentContainerStyle={styles.listContent}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 247, 255, 0.1)',
  },
  backButton: {
    padding: spacing.sm,
    marginRight: spacing.sm,
  },
  backButtonText: {
    color: NEON,
    fontSize: 24,
    fontWeight: 'bold',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: NEON,
  },
  datePickerContainer: {
    height: 80,
    marginVertical: spacing.md,
  },
  datePickerContent: {
    paddingHorizontal: spacing.md,
  },
  dateItem: {
    width: 70,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: radius.md,
    marginRight: spacing.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  dateItemSelected: {
    borderColor: NEON,
    backgroundColor: 'rgba(0, 247, 255, 0.1)',
  },
  dateText: {
    color: colors.textSecondary,
    textAlign: 'center',
    fontSize: 14,
  },
  dateTextSelected: {
    color: NEON,
    fontWeight: 'bold',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  listContent: {
    padding: spacing.md,
  },
  card: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 247, 255, 0.05)',
    borderColor: 'rgba(0, 247, 255, 0.2)',
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  flag: {
    fontSize: 32,
    marginRight: spacing.md,
  },
  countryContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  countryName: {
    color: colors.text,
    fontSize: 18,
    fontWeight: 'bold',
    marginRight: spacing.xs,
  },
  alertIcon: {
    fontSize: 18,
  },
  timeText: {
    color: NEON,
    fontSize: 20,
    fontWeight: 'bold',
  },
  emptyText: {
    color: colors.success,
    fontSize: 18,
    textAlign: 'center',
  },
  errorText: {
    color: colors.error,
    fontSize: 16,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  retryButton: {
    padding: spacing.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: radius.sm,
  },
  retryText: {
    color: colors.text,
  },
});

export default TruckBansScreen;
