import React, { memo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Share,
  ScrollView,
  Modal,
  SafeAreaView,
  StyleSheet,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../../shared/types/navigation';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Tts from 'react-native-tts';
import { getDaySummary } from '../../tacho/TachoEventLog';
import { POI_META, type POICategory } from '../api/poi';
import { POI_CATEGORIES } from '../utils/mapUtils';
import type { RouteResult } from '../api/directions';
import type { GoogleAccount } from '../../../shared/services/accountManager';
import type { MapMode, MapLayersConfig } from '../hooks/useMapUIState';
import { styles as mapStyles, NEON } from '../screens/MapScreen.styles';

const LOGO = require('../../../shared/assets/TruckExpoAi.png');

interface OptionsPanelProps {
  optionsOpen: boolean;
  setOptionsOpen: (open: boolean | ((v: boolean) => boolean)) => void;
  mapMode: MapMode;
  setMapMode: (mode: MapMode | ((v: MapMode) => MapMode)) => void;
  lightMode: boolean;
  setLightMode: (light: boolean | ((v: boolean) => boolean)) => void;
  voiceMuted: boolean;
  setVoiceMuted: (muted: boolean | ((v: boolean) => boolean)) => void;
  mapLayers: MapLayersConfig;
  toggleLayer: (layer: keyof MapLayersConfig) => void;
  avoidUnpaved: boolean;
  setAvoidUnpaved: (value: boolean | ((v: boolean) => boolean)) => void;
  navigating: boolean;
  route: RouteResult | null;
  simulating: boolean;
  startSim: () => void;
  stopSim: () => void;
  poiCategory: POICategory | null;
  handlePOISearch: (cat: POICategory) => void;
  sarMode: boolean;
  handleSARSearch: (cat: POICategory) => void;
  googleUser: GoogleAccount | null;
  setShowAccountModal: (show: boolean) => void;
  starredPOIs: any[];
  setBorderCrossings: (crossings: any[]) => void;
  setShowBorderPanel: (show: boolean) => void;
  searchTop: number;
  isSearchingAlongRoute?: boolean;
  handleSearchAlongRoute: () => void;
  setMapIsLoaded: (loaded: boolean) => void;
  userCoords: [number, number] | null;
  onReportCamera: () => void;
  backendOnline: boolean;
}

const ICON_SIZE = 26;
const C_ACT = '#00BFFF';
const C_OFF = '#4A5568';

// A single large list row (TomTom style)
const Row = ({
  icon,
  label,
  onPress,
  iconColor = '#FFFFFF',
  iconBg = 'rgba(0,191,255,0.15)',
  active = false,
  rightEl,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  iconColor?: string;
  iconBg?: string;
  active?: boolean;
  rightEl?: React.ReactNode;
}) => (
  <TouchableOpacity style={[s.row, active && s.rowActive]} onPress={onPress} activeOpacity={0.7}>
    <View style={[s.iconCircle, { backgroundColor: iconBg }]}>
      <Icon name={icon} size={ICON_SIZE} color={iconColor} />
    </View>
    <Text style={s.rowLabel}>{label}</Text>
    {rightEl ?? <Icon name="chevron-right" size={20} color="rgba(255,255,255,0.25)" />}
  </TouchableOpacity>
);

// Section header
const SectionHeader = ({ title }: { title: string }) => (
  <Text style={s.sectionHeader}>{title}</Text>
);

const Divider = () => <View style={s.divider} />;

type LegacySummarySegment = {
  activity?: string;
  start?: string;
  end?: string;
  duration_min?: number | string;
};

type LegacySummaryData = {
  shift_start?: string;
  current_time?: string;
  total_driven_min?: number | null;
  remaining_drive_min?: number | null;
  segments?: LegacySummarySegment[];
  driven_today_min?: number | null;
  remaining_today_min?: number | null;
};

const OptionsPanel: React.FC<OptionsPanelProps> = memo(({
  optionsOpen,
  setOptionsOpen,
  mapMode,
  setMapMode,
  lightMode,
  setLightMode,
  voiceMuted,
  setVoiceMuted,
  mapLayers,
  toggleLayer,
  avoidUnpaved,
  setAvoidUnpaved,
  navigating,
  route,
  simulating,
  startSim,
  stopSim,
  poiCategory,
  handlePOISearch,
  sarMode,
  handleSARSearch,
  googleUser,
  setShowAccountModal,
  setBorderCrossings,
  setShowBorderPanel,
  searchTop,
  isSearchingAlongRoute,
  handleSearchAlongRoute,
  setMapIsLoaded,
  userCoords,
  onReportCamera,
  backendOnline: _backendOnline,
}) => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  
  const [summaryOpen, setSummaryOpen] = React.useState(false);
  const [summaryData, setSummaryData] = React.useState<LegacySummaryData | null>(null);

  const close = () => setOptionsOpen(false);

  const formatMin = (min: number | null) => {
    if (min === null) return '--:--';
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return `${h}:${m < 10 ? '0' : ''}${m}`;
  };

  const openSummary = async () => {
    const data = await getDaySummary() as LegacySummaryData;
    setSummaryData(data);
    setSummaryOpen(true);
  };

  const mapModeLabel = mapMode === 'vector' ? 'Векторна карта' : 'Хибридна карта';
  const mapModeIcon = mapMode === 'vector' ? 'earth' : 'layers';
  const summarySegments = Array.isArray(summaryData?.segments) ? summaryData.segments : [];
  const summaryShiftStart = summaryData?.shift_start ?? '--:--';
  const summaryCurrentTime = summaryData?.current_time ?? new Date().toTimeString().slice(0, 5);
  const summaryDrivenMin = summaryData?.total_driven_min ?? summaryData?.driven_today_min ?? null;
  const summaryRemainingMin = summaryData?.remaining_drive_min ?? summaryData?.remaining_today_min ?? null;

  return (
    <>
      {/* Toggle button on map */}
      <View style={[mapStyles.optionsContainer, { top: searchTop }]}>
        <TouchableOpacity
          style={mapStyles.mapBtn}
          onPress={() => setOptionsOpen(v => !v)}
        >
          <Icon name={optionsOpen ? 'close' : 'tune-variant'} size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* Full-screen TomTom-style drawer */}
      <Modal
        visible={optionsOpen}
        animationType="slide"
        transparent
        onRequestClose={close}
      >
        <View style={s.backdrop}>
          <View style={s.drawer}>
            {/* Header */}
            <View style={s.header}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Image source={LOGO} style={{ width: 32, height: 32, borderRadius: 6 }} resizeMode="contain" />
                <Text style={s.headerTitle}>Меню</Text>
              </View>
              <TouchableOpacity onPress={close} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Icon name="close" size={26} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={s.scroll}
              contentContainerStyle={s.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              {/* ПРОФИЛ */}
              <SectionHeader title="КАМИОН" />
              <Row
                icon="clipboard-text-outline"
                label="Данни шофиране"
                onPress={() => { openSummary(); }}
                iconBg="rgba(255,255,255,0.1)"
                iconColor="#FFFFFF"
              />
              <Row
                icon="truck"
                label="Профил на камиона"
                onPress={() => { navigation.navigate('VehicleProfile'); close(); }}
                iconBg="rgba(0,191,255,0.2)"
                iconColor={C_ACT}
              />
              <Row
                icon="bluetooth"
                label="Свържи тахограф"
                onPress={() => { navigation.navigate('Tacho'); close(); }}
                iconBg="rgba(76,175,80,0.15)"
                iconColor="#4CAF50"
              />

              {/* КАРТА */}
              <Divider />
              <SectionHeader title="КАРТА" />
              <Row
                icon={mapModeIcon}
                label={mapModeLabel}
                onPress={() => {
                  setMapMode(prev => {
                    const next: MapMode = prev === 'vector' ? 'hybrid' : 'vector';
                    if (!navigating) setMapIsLoaded(false);
                    return next;
                  });
                  close();
                }}
                iconColor={C_ACT}
                iconBg="rgba(0,191,255,0.15)"
              />
              <Row
                icon={lightMode ? 'weather-night' : 'weather-sunny'}
                label={lightMode ? 'Нощен режим' : 'Дневен режим'}
                onPress={() => { setLightMode(v => !v); if (!navigating) setMapIsLoaded(false); close(); }}
                iconColor={lightMode ? '#A78BFA' : '#FCD34D'}
                iconBg={lightMode ? 'rgba(167,139,250,0.15)' : 'rgba(252,211,77,0.15)'}
              />
              {/* ТРАФИК */}
              <Divider />
              <SectionHeader title="ТРАФИК" />
              <Row
                icon="traffic-light"
                label="Трафик на картата"
                onPress={() => toggleLayer('traffic')}
                iconColor={mapLayers.traffic ? '#FFFFFF' : C_OFF}
                active={mapLayers.traffic}
                rightEl={
                  <View style={[s.toggle, mapLayers.traffic && s.toggleOn]}>
                    <Text style={s.toggleTxt}>{mapLayers.traffic ? 'ВКЛ' : 'ИЗК'}</Text>
                  </View>
                }
              />

              {/* КАМИОН */}
              <Divider />
              <SectionHeader title="ОГРАНИЧЕНИЯ" />
              <Row
                icon="road-variant"
                label="Само асфалт"
                onPress={() => setAvoidUnpaved(v => !v)}
                iconColor={avoidUnpaved ? C_ACT : C_OFF}
                active={avoidUnpaved}
                rightEl={
                  <View style={[s.toggle, avoidUnpaved && s.toggleOn]}>
                    <Text style={s.toggleTxt}>{avoidUnpaved ? 'ВКЛ' : 'ИЗК'}</Text>
                  </View>
                }
              />
              <Row
                icon="star"
                label="Любими места"
                onPress={() => toggleLayer('starred')}
                iconColor={mapLayers.starred ? '#FFD700' : C_OFF}
                active={mapLayers.starred}
                rightEl={
                  <View style={[s.toggle, mapLayers.starred && s.toggleOn]}>
                    <Text style={s.toggleTxt}>{mapLayers.starred ? 'ВКЛ' : 'ИЗК'}</Text>
                  </View>
                }
              />

              {/* НАВИГАЦИЯ */}
              <Divider />
              <SectionHeader title="НАВИГАЦИЯ" />
              <Row
                icon={voiceMuted ? 'volume-off' : 'volume-high'}
                label={voiceMuted ? 'Гласови указания: ИЗК' : 'Гласови указания: ВКЛ'}
                onPress={() => { setVoiceMuted(v => !v); if (!voiceMuted) Tts.stop(); }}
                iconColor={voiceMuted ? C_OFF : '#FFFFFF'}
                rightEl={
                  <View style={[s.toggle, !voiceMuted && s.toggleOn]}>
                    <Text style={s.toggleTxt}>{voiceMuted ? 'ИЗК' : 'ВКЛ'}</Text>
                  </View>
                }
              />
              <Row
                icon="passport"
                label="Гранични пунктове"
                onPress={() => {
                  close();
                  setBorderCrossings([
                    { name: 'Капитан Андреево', flag: 'BG-TR', status: 'Виж на живо', url: 'https://granici.mvr.bg/' },
                    { name: 'Кулата', flag: 'BG-GR', status: 'Виж на живо', url: 'https://granici.mvr.bg/' },
                    { name: 'Дунав мост 2', flag: 'BG-RO', status: 'Виж на живо', url: 'https://granici.mvr.bg/' },
                    { name: 'Дунав мост 1', flag: 'BG-RO', status: 'Виж на живо', url: 'https://granici.mvr.bg/' },
                    { name: 'Малко Търново', flag: 'BG-TR', status: 'Виж на живо', url: 'https://granici.mvr.bg/' },
                    { name: 'Гюешево', flag: 'BG-MK', status: 'Виж на живо', url: 'https://granici.mvr.bg/' },
                  ]);
                  setShowBorderPanel(true);
                }}
                iconColor="#FFFFFF"
              />
              <Row
                icon="parking"
                label="Паркинги на живо"
                onPress={() => {
                  navigation.navigate('TruckParking', { userCoords: userCoords || undefined });
                  close();
                }}
                iconColor="#4FC3F7"
                iconBg="rgba(79,195,247,0.15)"
              />
              <Row
                icon="truck-remove"
                label="Забрани за каране 🚫"
                onPress={() => {
                  navigation.navigate('TruckBans');
                  close();
                }}
                iconColor="#FF5252"
                iconBg="rgba(255,82,82,0.15)"
              />

              {/* POI / SAR */}
              {!navigating && !route && (
                <>
                  <Divider />
                  <SectionHeader title="НАБЛИЗО" />
                  {POI_CATEGORIES.filter(c => c !== 'rest_area').map(cat => (
                    <Row
                      key={cat}
                      icon={POI_META[cat].iconName ?? 'map-marker'}
                      label={POI_META[cat].label ?? cat}
                      onPress={() => { handlePOISearch(cat); close(); }}
                      iconColor={!sarMode && poiCategory === cat ? C_ACT : '#FFFFFF'}
                      active={!sarMode && poiCategory === cat}
                    />
                  ))}
                </>
              )}

              {route && (
                <>
                  <Divider />
                  <SectionHeader title="ПО МАРШРУТА (SAR)" />
                  {POI_CATEGORIES.filter(c => c !== 'rest_area').map(cat => (
                    <Row
                      key={cat}
                      icon={POI_META[cat].iconName ?? 'map-marker'}
                      label={POI_META[cat].label ?? cat}
                      onPress={() => { handleSARSearch(cat); close(); }}
                      iconColor={sarMode && poiCategory === cat ? C_ACT : '#FFFFFF'}
                      active={sarMode && poiCategory === cat}
                    />
                  ))}
                </>
              )}

              {navigating && (
                <>
                  <Divider />
                  <SectionHeader title="ПО ПЪТЯ" />
                  <Row
                    icon={isSearchingAlongRoute ? 'timer-sand' : 'map-search'}
                    label="Търси по маршрута"
                    onPress={() => { close(); handleSearchAlongRoute(); }}
                    iconColor="#FFFFFF"
                  />
                </>
              )}

              {/* АКАУНТ */}
              <Divider />
              <SectionHeader title="АКАУНТ & AI" />
              <Row
                icon="google"
                label={googleUser ? googleUser.email : 'Google акаунт'}
                onPress={() => { setShowAccountModal(true); close(); }}
                iconColor="#EA4335"
                iconBg="rgba(234,67,53,0.12)"
              />
              {userCoords && (
                <Row
                  icon="map-marker-radius"
                  label="Сподели позиция"
                  onPress={() => {
                    close();
                    Share.share({
                      message: `Моята позиция (TruckAI): https://www.google.com/maps/?q=${userCoords[1]},${userCoords[0]}`,
                    });
                  }}
                  iconColor={C_ACT}
                />
              )}

              {/* DEV */}
              {__DEV__ && route && (
                <>
                  <Divider />
                  <SectionHeader title="DEV" />
                  <Row
                    icon={simulating ? 'stop' : 'play'}
                    label={simulating ? 'Спри симулация' : 'Симулация'}
                    onPress={() => { simulating ? stopSim() : startSim(); close(); }}
                    iconColor={simulating ? '#FF4444' : '#4CAF50'}
                    iconBg={simulating ? 'rgba(255,68,68,0.15)' : 'rgba(76,175,80,0.15)'}
                  />
                </>
              )}

              {/* ДОКЛАДВАЙ КАМЕРА */}
              <Divider />
              <TouchableOpacity style={s.reportBtn} onPress={() => { onReportCamera(); close(); }} activeOpacity={0.8}>
                <Icon name="speed-camera" size={22} color="#FFFFFF" />
                <Text style={s.reportBtnTxt}>ДОКЛАДВАЙ КАМЕРА</Text>
              </TouchableOpacity>

              <View style={{ height: 24 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Driving Report Modal */}
      <Modal
        visible={summaryOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSummaryOpen(false)}
      >
        <View style={s.backdrop}>
          <SafeAreaView style={s.summaryDrawer}>
            <View style={s.header}>
              <Text style={s.headerTitle}>Отчет за деня</Text>
              <TouchableOpacity onPress={() => setSummaryOpen(false)}>
                <Icon name="close" size={26} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <View style={s.summaryBody}>
              {summaryData ? (
                <>
                  <View style={s.summaryHero}>
                    <View style={s.summaryHeroItem}>
                      <Text style={s.summaryHeroLabel}>НАЧАЛО</Text>
                      <Text style={s.summaryHeroVal}>{summaryShiftStart}</Text>
                    </View>
                    <View style={s.summaryHeroItem}>
                      <Text style={s.summaryHeroLabel}>ТЕКУЩО</Text>
                      <Text style={s.summaryHeroVal}>{summaryCurrentTime}</Text>
                    </View>
                  </View>

                  <View style={s.summaryStats}>
                    <View style={s.summaryStatBox}>
                      <Text style={s.summaryStatLabel}>ШОФИРАНЕ</Text>
                      <Text style={[s.summaryStatVal, { color: '#4CAF50' }]}>{formatMin(summaryDrivenMin)}</Text>
                    </View>
                    <View style={s.summaryStatBox}>
                      <Text style={s.summaryStatLabel}>ОСТАВАЩО</Text>
                      <Text style={[s.summaryStatVal, { color: NEON }]}>{formatMin(summaryRemainingMin)}</Text>
                    </View>
                  </View>

                  <Text style={s.tableHeader}>СЕГМЕНТИ</Text>
                  <ScrollView style={s.tableScroll}>
                    <View style={s.tableRowHead}>
                      <Text style={[s.tableCell, { flex: 2 }]}>АКТИВНОСТ</Text>
                      <Text style={s.tableCell}>ОТ</Text>
                      <Text style={s.tableCell}>ДО</Text>
                      <Text style={[s.tableCell, { textAlign: 'right' }]}>МИН</Text>
                    </View>
                    {summarySegments.length > 0 ? summarySegments.map((seg, i) => (
                      <View key={i} style={s.tableRow}>
                        <Text style={[s.tableCell, { flex: 2, fontWeight: '700', color: seg.activity === 'DRIVING' ? '#4CAF50' : '#fff' }]}>
                          {seg.activity ?? '--'}
                        </Text>
                        <Text style={s.tableCell}>{seg.start ?? '--:--'}</Text>
                        <Text style={s.tableCell}>{seg.end ?? '--:--'}</Text>
                        <Text style={[s.tableCell, { textAlign: 'right', fontWeight: 'bold' }]}>{seg.duration_min ?? '--'}</Text>
                      </View>
                    )) : (
                      <View style={s.tableRow}>
                        <Text style={[s.tableCell, { flex: 4, textAlign: 'center', color: 'rgba(255,255,255,0.6)' }]}>
                          Няма детайли за сегментите за днешния ден.
                        </Text>
                      </View>
                    )}
                  </ScrollView>
                </>
              ) : (
                <ActivityIndicator size="large" color={NEON} style={{ marginTop: 40 }} />
              )}
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
});

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  drawer: {
    backgroundColor: '#0A0E1A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: '85%',
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 8 },
  sectionHeader: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginTop: 16,
    marginBottom: 4,
    marginLeft: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 4,
    gap: 16,
    borderRadius: 14,
  },
  rowActive: {
    backgroundColor: 'rgba(0,191,255,0.07)',
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  toggle: {
    backgroundColor: 'rgba(220, 38, 38, 0.25)', // Reddish when OFF
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    minWidth: 44,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(220, 38, 38, 0.4)',
  },
  toggleOn: {
    backgroundColor: 'rgba(0,191,255,0.25)',
    borderColor: 'rgba(0,191,255,0.5)',
  },
  toggleTxt: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginVertical: 4,
    marginHorizontal: 4,
  },
  reportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#C0021A',
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 8,
  },
  reportBtnTxt: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  summaryDrawer: {
    backgroundColor: '#0A0E1A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: '75%',
    width: '100%',
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  summaryBody: { padding: 20, flex: 1 },
  summaryHero: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
  summaryHeroItem: { alignItems: 'center', flex: 1 },
  summaryHeroLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: '800', marginBottom: 4 },
  summaryHeroVal: { color: '#fff', fontSize: 28, fontWeight: '900', fontVariant: ['tabular-nums'] },
  summaryStats: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  summaryStatBox: { flex: 1, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 16, padding: 16, alignItems: 'center' },
  summaryStatLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: '800', marginBottom: 4 },
  summaryStatVal: { fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'] },
  tableHeader: { color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: '800', marginBottom: 12 },
  tableScroll: { flex: 1 },
  tableRowHead: { flexDirection: 'row', paddingBottom: 8, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  tableRow: { flexDirection: 'row', paddingVertical: 12, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  tableCell: { color: 'rgba(255,255,255,0.7)', fontSize: 13, flex: 1 },
});

export default OptionsPanel;
