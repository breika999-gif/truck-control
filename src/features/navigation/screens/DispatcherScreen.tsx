import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import type { RootStackParamList } from '../../../shared/types/navigation';
import { HOS_LIMIT_S } from '../utils/mapUtils';
import {
  type DispatchStopType,
  useDispatcher,
} from '../hooks/useDispatcher';

type DispatcherNavigation = NativeStackNavigationProp<RootStackParamList, 'Dispatcher'>;
type DispatcherRoute = RouteProp<RootStackParamList, 'Dispatcher'>;

const NEON = '#00BFFF';
const GREEN = '#34C759';
const ORANGE = '#FF9500';
const MAX_STOPS = 6;

const STOP_TYPES: Array<{ type: DispatchStopType; icon: string; label: string }> = [
  { type: 'pickup', icon: 'package-variant-closed-plus', label: 'Товарене' },
  { type: 'delivery', icon: 'package-variant-closed-check', label: 'Доставка' },
  { type: 'fuel', icon: 'gas-station', label: 'Гориво' },
  { type: 'rest', icon: 'bed', label: 'Почивка' },
];

function formatDuration(seconds: number): string {
  const totalMin = Math.round(seconds / 60);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  return hours > 0 ? `${hours}ч ${minutes}мин` : `${minutes}мин`;
}

const DispatcherScreen: React.FC = () => {
  const navigation = useNavigation<DispatcherNavigation>();
  const route = useRoute<DispatcherRoute>();
  const remainingDriveSeconds = route.params?.remainingDriveSeconds ?? HOS_LIMIT_S;
  const {
    stops,
    addStop,
    removeStop,
    reorderStop,
    geocodeStop,
    optimizeOrder,
    launchRoute,
    updateStopAddress,
    updateStopNotes,
    setStopType,
    estimate,
    geocodingStopId,
    lastError,
    canLaunch,
  } = useDispatcher(route.params?.userCoords ?? null, remainingDriveSeconds);

  const handleAddStop = useCallback(() => {
    if (stops.length >= MAX_STOPS) return;
    addStop({ address: '', coords: null, type: 'delivery' });
  }, [addStop, stops.length]);

  const handleLaunch = useCallback(() => {
    if (!canLaunch) {
      Alert.alert('Липсват адреси', 'Локализирай всяка спирка преди да пуснеш маршрута.');
      return;
    }
    if (estimate.hosWarning) {
      Alert.alert(
        'Тахограф · нужна почивка',
        `${estimate.hosWarning}\n\nТочната сметка ще се покаже след TomTom маршрута.`,
        [
          { text: 'Назад', style: 'cancel' },
          { text: 'Покажи маршрута', onPress: launchRoute },
        ],
      );
      return;
    }
    launchRoute();
  }, [canLaunch, estimate.hosWarning, launchRoute]);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <TouchableOpacity
            accessibilityLabel="Назад"
            style={styles.headerButton}
            onPress={() => navigation.goBack()}
          >
            <Icon name="arrow-left" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>Диспечер</Text>
            <Text style={styles.subtitle}>Multi-stop планиране</Text>
          </View>
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>{stops.length}/{MAX_STOPS}</Text>
          </View>
        </View>

        <View style={styles.summary}>
          <View>
            <Text style={styles.summaryLabel}>ОЦЕНКА</Text>
            <Text style={styles.summaryValue}>
              ~{estimate.distanceKm.toFixed(1)} км · {formatDuration(estimate.durationS)}
            </Text>
          </View>
          <View style={styles.summaryRight}>
            <Text style={styles.summaryLabel}>ТАХО ОСТАВА</Text>
            <Text style={[styles.summaryValue, estimate.hosWarning ? styles.warningText : styles.successText]}>
              {formatDuration(remainingDriveSeconds)}
            </Text>
          </View>
        </View>

        {estimate.hosWarning && (
          <View style={styles.warningBox}>
            <Icon name="alert-outline" size={20} color={ORANGE} />
            <Text style={styles.warningCopy}>{estimate.hosWarning}</Text>
          </View>
        )}

        {lastError && (
          <View style={styles.errorBox}>
            <Icon name="map-marker-alert-outline" size={18} color="#FF5252" />
            <Text style={styles.errorCopy}>{lastError}</Text>
          </View>
        )}

        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {stops.map((stop, index) => {
            const isGeocoding = geocodingStopId === stop.id;
            return (
              <View key={stop.id} style={styles.stopCard}>
                <View style={styles.stopCardHeader}>
                  <View style={styles.stopNumber}>
                    <Text style={styles.stopNumberText}>{index + 1}</Text>
                  </View>
                  <Text style={styles.stopTitle}>Спирка {index + 1}</Text>
                  <View style={styles.reorderButtons}>
                    <TouchableOpacity
                      accessibilityLabel="Премести нагоре"
                      disabled={index === 0}
                      style={[styles.iconButton, index === 0 && styles.iconButtonDisabled]}
                      onPress={() => reorderStop(index, index - 1)}
                    >
                      <Icon name="chevron-up" size={20} color="#FFFFFF" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      accessibilityLabel="Премести надолу"
                      disabled={index === stops.length - 1}
                      style={[styles.iconButton, index === stops.length - 1 && styles.iconButtonDisabled]}
                      onPress={() => reorderStop(index, index + 1)}
                    >
                      <Icon name="chevron-down" size={20} color="#FFFFFF" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      accessibilityLabel="Изтрий спирката"
                      style={[styles.iconButton, styles.deleteButton]}
                      onPress={() => removeStop(stop.id)}
                    >
                      <Icon name="trash-can-outline" size={18} color="#FF5252" />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.typeRow}>
                  {STOP_TYPES.map(option => {
                    const active = option.type === stop.type;
                    return (
                      <TouchableOpacity
                        key={option.type}
                        accessibilityLabel={option.label}
                        style={[styles.typeButton, active && styles.typeButtonActive]}
                        onPress={() => setStopType(stop.id, option.type)}
                      >
                        <Icon name={option.icon} size={18} color={active ? '#FFFFFF' : 'rgba(255,255,255,0.55)'} />
                        <Text style={[styles.typeLabel, active && styles.typeLabelActive]}>
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={styles.addressRow}>
                  <TextInput
                    value={stop.address}
                    onChangeText={text => updateStopAddress(stop.id, text)}
                    placeholder="Адрес, фирма или склад"
                    placeholderTextColor="rgba(255,255,255,0.35)"
                    style={styles.addressInput}
                  />
                  <TouchableOpacity
                    accessibilityLabel="Локализирай адреса"
                    style={styles.geocodeButton}
                    disabled={isGeocoding}
                    onPress={() => geocodeStop(stop.id, stop.address)}
                  >
                    {isGeocoding
                      ? <ActivityIndicator size="small" color="#FFFFFF" />
                      : <Icon name="map-search-outline" size={21} color="#FFFFFF" />}
                  </TouchableOpacity>
                </View>

                <View style={styles.statusRow}>
                  <Icon
                    name={stop.coords ? 'check-circle-outline' : 'map-marker-question-outline'}
                    size={15}
                    color={stop.coords ? GREEN : ORANGE}
                  />
                  <Text style={[styles.statusText, stop.coords ? styles.successText : styles.warningText]}>
                    {stop.coords ? 'Локализирано' : 'Натисни иконата за локализиране'}
                  </Text>
                </View>

                <TextInput
                  value={stop.notes ?? ''}
                  onChangeText={text => updateStopNotes(stop.id, text)}
                  placeholder="Бележка за шофьора (по желание)"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  style={styles.notesInput}
                />
              </View>
            );
          })}

          <TouchableOpacity
            style={[styles.addButton, stops.length >= MAX_STOPS && styles.buttonDisabled]}
            disabled={stops.length >= MAX_STOPS}
            onPress={handleAddStop}
          >
            <Icon name="plus" size={20} color={NEON} />
            <Text style={styles.addButtonText}>Добави спирка</Text>
          </TouchableOpacity>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity style={styles.optimizeButton} onPress={optimizeOrder}>
            <Icon name="source-branch" size={20} color={NEON} />
            <Text style={styles.optimizeButtonText}>Оптимизирай реда</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.launchButton, !canLaunch && styles.buttonDisabled]}
            disabled={!canLaunch}
            onPress={handleLaunch}
          >
            <Icon name="navigation-variant" size={20} color="#08111D" />
            <Text style={styles.launchButtonText}>Покажи маршрута</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: '#08111D' },
  header: {
    height: 72,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  headerButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  headerCopy: { flex: 1, marginLeft: 12 },
  title: { color: '#FFFFFF', fontSize: 20, fontWeight: '800' },
  subtitle: { color: NEON, fontSize: 12, fontWeight: '600', marginTop: 2 },
  headerBadge: {
    minWidth: 42,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(0,191,255,0.14)',
    alignItems: 'center',
  },
  headerBadgeText: { color: NEON, fontSize: 13, fontWeight: '800' },
  summary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.035)',
  },
  summaryRight: { alignItems: 'flex-end' },
  summaryLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: '800' },
  summaryValue: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', marginTop: 3 },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 14,
    marginTop: 10,
    padding: 10,
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: ORANGE,
    backgroundColor: 'rgba(255,149,0,0.12)',
  },
  warningCopy: { flex: 1, color: '#FFFFFF', fontSize: 12, fontWeight: '700', lineHeight: 17 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 14,
    marginTop: 10,
    padding: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(255,82,82,0.12)',
  },
  errorCopy: { flex: 1, color: '#FF8A80', fontSize: 12, fontWeight: '700' },
  list: { flex: 1 },
  listContent: { padding: 14, paddingBottom: 18, gap: 10 },
  stopCard: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.045)',
  },
  stopCardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  stopNumber: {
    width: 25,
    height: 25,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: 'rgba(0,191,255,0.2)',
  },
  stopNumberText: { color: NEON, fontSize: 12, fontWeight: '900' },
  stopTitle: { flex: 1, marginLeft: 8, color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  reorderButtons: { flexDirection: 'row', gap: 4 },
  iconButton: {
    width: 29,
    height: 29,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  iconButtonDisabled: { opacity: 0.25 },
  deleteButton: { backgroundColor: 'rgba(255,82,82,0.08)' },
  typeRow: { flexDirection: 'row', gap: 5, marginBottom: 9 },
  typeButton: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  typeButtonActive: {
    borderColor: 'rgba(0,191,255,0.75)',
    backgroundColor: 'rgba(0,191,255,0.16)',
  },
  typeLabel: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 9,
    fontWeight: '700',
    marginTop: 3,
  },
  typeLabelActive: { color: '#FFFFFF' },
  addressRow: { flexDirection: 'row', gap: 6 },
  addressInput: {
    flex: 1,
    minHeight: 42,
    paddingHorizontal: 10,
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.3)',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  geocodeButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    backgroundColor: '#087CA7',
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  statusText: { fontSize: 11, fontWeight: '700' },
  successText: { color: GREEN },
  warningText: { color: ORANGE },
  notesInput: {
    minHeight: 36,
    marginTop: 8,
    paddingHorizontal: 9,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.14)',
  },
  addButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.45)',
    backgroundColor: 'rgba(0,191,255,0.08)',
  },
  addButtonText: { color: NEON, fontSize: 14, fontWeight: '800' },
  footer: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#08111D',
  },
  optimizeButton: {
    minHeight: 48,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.55)',
  },
  optimizeButtonText: { color: NEON, fontSize: 13, fontWeight: '800' },
  launchButton: {
    minHeight: 48,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 8,
    backgroundColor: NEON,
  },
  launchButtonText: { color: '#08111D', fontSize: 13, fontWeight: '900' },
  buttonDisabled: { opacity: 0.35 },
});

export default DispatcherScreen;

