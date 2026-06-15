import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';

import { colors, spacing } from '../../../shared/constants/theme';
import { useOfflineMaps, type OfflinePack } from '../hooks/useOfflineMaps';

type OfflineRegion = {
  key: string;
  flag: string;
  estimateMb: number;
  bounds: [number, number, number, number];
};

const REGIONS: OfflineRegion[] = [
  { key: 'spain', flag: '🇪🇸', estimateMb: 2100, bounds: [-9.6, 35.8, 4.4, 43.9] },
  { key: 'portugal', flag: '🇵🇹', estimateMb: 850, bounds: [-9.6, 36.8, -6.1, 42.2] },
  { key: 'france', flag: '🇫🇷', estimateMb: 2600, bounds: [-5.3, 41.2, 9.8, 51.2] },
  { key: 'belgium', flag: '🇧🇪', estimateMb: 520, bounds: [2.5, 49.4, 6.5, 51.6] },
  { key: 'netherlands', flag: '🇳🇱', estimateMb: 620, bounds: [3.2, 50.7, 7.3, 53.7] },
  { key: 'luxembourg', flag: '🇱🇺', estimateMb: 180, bounds: [5.6, 49.4, 6.6, 50.2] },
  { key: 'germany', flag: '🇩🇪', estimateMb: 2800, bounds: [5.5, 47.2, 15.3, 55.2] },
  { key: 'switzerland', flag: '🇨🇭', estimateMb: 620, bounds: [5.9, 45.8, 10.6, 47.9] },
  { key: 'austria', flag: '🇦🇹', estimateMb: 900, bounds: [9.4, 46.3, 17.2, 49.1] },
  { key: 'italyNorth', flag: '🇮🇹', estimateMb: 1200, bounds: [6.6, 43.6, 13.8, 47.2] },
  { key: 'czechia', flag: '🇨🇿', estimateMb: 760, bounds: [12.0, 48.5, 18.9, 51.1] },
  { key: 'poland', flag: '🇵🇱', estimateMb: 1900, bounds: [14.0, 49.0, 24.2, 54.9] },
  { key: 'slovakia', flag: '🇸🇰', estimateMb: 520, bounds: [16.8, 47.7, 22.7, 49.7] },
  { key: 'hungary', flag: '🇭🇺', estimateMb: 720, bounds: [16.0, 45.7, 22.9, 48.7] },
  { key: 'slovenia', flag: '🇸🇮', estimateMb: 320, bounds: [13.3, 45.4, 16.7, 46.9] },
  { key: 'croatia', flag: '🇭🇷', estimateMb: 780, bounds: [13.1, 42.2, 19.6, 46.7] },
  { key: 'serbia', flag: '🇷🇸', estimateMb: 700, bounds: [18.8, 42.2, 23.1, 46.3] },
  { key: 'romania', flag: '🇷🇴', estimateMb: 1400, bounds: [20.2, 43.5, 29.9, 48.4] },
  { key: 'bulgaria', flag: '🇧🇬', estimateMb: 800, bounds: [22.3, 41.2, 28.7, 44.3] },
  { key: 'greece', flag: '🇬🇷', estimateMb: 1200, bounds: [19.3, 34.7, 28.4, 41.9] },
  { key: 'turkeyThrace', flag: '🇹🇷', estimateMb: 650, bounds: [26.0, 40.3, 32.2, 42.7] },
];

function formatMb(bytes: number): string {
  return `${Math.max(0, bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatEstimateMb(mb: number): string {
  return `~${mb.toLocaleString('en-US')} MB`;
}

const OfflineRegionsScreen: React.FC = () => {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { packs, downloading, downloadRegion, deleteRegion } = useOfflineMaps();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busyName, setBusyName] = useState<string | null>(null);

  const startDownload = async (name: string, bounds: [number, number, number, number]) => {
    setPickerOpen(false);
    setBusyName(name);
    try {
      await downloadRegion(name, bounds);
    } catch (error) {
      Alert.alert(t('offline.title'), error instanceof Error ? error.message : t('offline.downloadFailed'));
    } finally {
      setBusyName(null);
    }
  };

  const removePack = (pack: OfflinePack) => {
    Alert.alert(t('offline.deleteTitle'), t('offline.deleteMessage', { name: pack.regionName }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          setBusyName(pack.name);
          deleteRegion(pack.name)
            .catch(error => Alert.alert(t('offline.title'), error instanceof Error ? error.message : t('offline.deleteFailed')))
            .finally(() => setBusyName(null));
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconButton}>
          <Icon name="arrow-left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('offline.title')}</Text>
        <TouchableOpacity onPress={() => setPickerOpen(true)} style={styles.iconButton}>
          <Icon name="plus" size={25} color={colors.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.notice}>
        <Icon name="information-outline" size={19} color="#F1C40F" />
        <Text style={styles.noticeText}>{t('offline.notice')}</Text>
      </View>

      <FlatList
        data={packs}
        keyExtractor={pack => pack.name}
        contentContainerStyle={packs.length ? styles.list : styles.emptyList}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="map-marker-off-outline" size={44} color={colors.textMuted} />
            <Text style={styles.emptyText}>{t('offline.empty')}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardTitleRow}>
                <Icon name="map-outline" size={22} color="#00BFFF" />
                <View>
                  <Text style={styles.cardTitle}>{item.regionName}</Text>
                  <Text style={styles.cardMeta}>{formatMb(item.completedBytes)} · zoom {item.minZoom}-{item.maxZoom}</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => removePack(item)} style={styles.deleteButton}>
                <Icon name="delete-outline" size={21} color="#FF5252" />
              </TouchableOpacity>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${item.percentage}%` }]} />
            </View>
            <Text style={styles.progressText}>{Math.round(item.percentage)}% · {item.completedTiles} {t('offline.tiles')}</Text>
          </View>
        )}
      />

      {(downloading || busyName) && (
        <View style={styles.downloading}>
          <ActivityIndicator size="small" color="#00BFFF" />
          <Text style={styles.downloadingText}>{busyName ?? t('offline.downloading')}</Text>
        </View>
      )}

      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('offline.downloadRegion')}</Text>
              <TouchableOpacity onPress={() => setPickerOpen(false)}>
                <Icon name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <Text style={styles.regionHint}>{t('offline.countryHint')}</Text>
            {REGIONS.map(region => {
              const regionName = t(`offline.regions.${region.key}`);
              const displayName = `${region.flag} ${regionName}`;
              return (
              <TouchableOpacity
                key={region.key}
                style={styles.regionRow}
                onPress={() => startDownload(displayName, region.bounds)}
              >
                <Text style={styles.regionFlag}>{region.flag}</Text>
                <View style={styles.regionInfo}>
                  <Text style={styles.regionName}>{regionName}</Text>
                  <Text style={styles.regionSub}>{t('offline.zoomRange')}</Text>
                </View>
                <View style={styles.regionMbBadge}>
                  <Text style={styles.regionMbText}>{formatEstimateMb(region.estimateMb)}</Text>
                </View>
                <Icon name="download-outline" size={21} color="#00BFFF" />
              </TouchableOpacity>
            );})}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { color: colors.text, fontSize: 19, fontWeight: '800' },
  iconButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, margin: spacing.md, padding: spacing.sm, backgroundColor: 'rgba(241,196,15,0.10)', borderRadius: 8, borderWidth: 1, borderColor: 'rgba(241,196,15,0.30)' },
  noticeText: { flex: 1, color: colors.text, fontSize: 12, fontWeight: '600' },
  list: { padding: spacing.md, gap: spacing.sm },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  empty: { alignItems: 'center', gap: spacing.sm },
  emptyText: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
  card: { padding: spacing.md, borderRadius: 8, backgroundColor: colors.bgSecondary, borderWidth: 1, borderColor: colors.border },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  cardMeta: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  deleteButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  progressTrack: { height: 5, marginTop: spacing.md, borderRadius: 3, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.14)' },
  progressFill: { height: 5, borderRadius: 3, backgroundColor: '#00BFFF' },
  progressText: { color: colors.textSecondary, fontSize: 11, marginTop: 5 },
  downloading: { position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.md, flexDirection: 'row', gap: 8, justifyContent: 'center', padding: spacing.sm, borderRadius: 8, backgroundColor: 'rgba(0,8,20,0.94)', borderWidth: 1, borderColor: '#00BFFF' },
  downloadingText: { color: colors.text, fontWeight: '700' },
  modalBackdrop: { flex: 1, justifyContent: 'center', padding: spacing.md, backgroundColor: 'rgba(0,0,0,0.62)' },
  modalCard: { borderRadius: 8, padding: spacing.md, backgroundColor: colors.bgSecondary, borderWidth: 1, borderColor: colors.border },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: spacing.sm },
  modalTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
  regionHint: { color: colors.textMuted, fontSize: 12, fontWeight: '600', marginBottom: spacing.xs },
  regionRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  regionFlag: { fontSize: 27, width: 36, textAlign: 'center' },
  regionInfo: { flex: 1 },
  regionName: { color: colors.text, fontSize: 14, fontWeight: '800' },
  regionSub: { color: colors.textMuted, fontSize: 10, marginTop: 2 },
  regionMbBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: 'rgba(241,196,15,0.12)', borderWidth: 1, borderColor: 'rgba(241,196,15,0.35)' },
  regionMbText: { color: '#F1C40F', fontSize: 11, fontWeight: '800' },
});

export default OfflineRegionsScreen;
