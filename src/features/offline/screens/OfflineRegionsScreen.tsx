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

import { colors, spacing } from '../../../shared/constants/theme';
import { useOfflineMaps, type OfflinePack } from '../hooks/useOfflineMaps';

const REGIONS: Array<{ name: string; bounds: [number, number, number, number]; note?: string }> = [
  { name: 'България пълна', bounds: [22.3, 41.2, 28.6, 44.2], note: '~800 MB' },
  { name: 'Западна България', bounds: [22.3, 41.8, 24.5, 43.8] },
  { name: 'Румъния', bounds: [22.0, 43.5, 30.0, 48.3] },
  { name: 'Гърция', bounds: [20.0, 35.0, 26.5, 41.8] },
  { name: 'Сърбия', bounds: [18.8, 42.2, 23.0, 46.2] },
  { name: 'Турция (Тракия)', bounds: [26.0, 40.5, 32.0, 42.5] },
];

function formatMb(bytes: number): string {
  return `${Math.max(0, bytes / 1024 / 1024).toFixed(1)} MB`;
}

const OfflineRegionsScreen: React.FC = () => {
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
      Alert.alert('Офлайн карти', error instanceof Error ? error.message : 'Свалянето не можа да стартира.');
    } finally {
      setBusyName(null);
    }
  };

  const removePack = (pack: OfflinePack) => {
    Alert.alert('Изтрий регион', `Да изтрия ли ${pack.regionName}?`, [
      { text: 'Отказ', style: 'cancel' },
      {
        text: 'Изтрий',
        style: 'destructive',
        onPress: () => {
          setBusyName(pack.name);
          deleteRegion(pack.name)
            .catch(error => Alert.alert('Офлайн карти', error instanceof Error ? error.message : 'Регионът не можа да се изтрие.'))
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
        <Text style={styles.title}>Офлайн карти</Text>
        <TouchableOpacity onPress={() => setPickerOpen(true)} style={styles.iconButton}>
          <Icon name="plus" size={25} color={colors.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.notice}>
        <Icon name="information-outline" size={19} color="#F1C40F" />
        <Text style={styles.noticeText}>България пълна = ~800 MB. Ползвай Wi-Fi преди дълъг курс.</Text>
      </View>

      <FlatList
        data={packs}
        keyExtractor={pack => pack.name}
        contentContainerStyle={packs.length ? styles.list : styles.emptyList}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="map-marker-off-outline" size={44} color={colors.textMuted} />
            <Text style={styles.emptyText}>Няма свалени региони</Text>
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
            <Text style={styles.progressText}>{Math.round(item.percentage)}% · {item.completedTiles} тайла</Text>
          </View>
        )}
      />

      {(downloading || busyName) && (
        <View style={styles.downloading}>
          <ActivityIndicator size="small" color="#00BFFF" />
          <Text style={styles.downloadingText}>{busyName ?? 'Сваляне на регион...'}</Text>
        </View>
      )}

      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Свали регион</Text>
              <TouchableOpacity onPress={() => setPickerOpen(false)}>
                <Icon name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            {REGIONS.map(region => (
              <TouchableOpacity
                key={region.name}
                style={styles.regionRow}
                onPress={() => startDownload(region.name, region.bounds)}
              >
                <Icon name="download-outline" size={21} color="#00BFFF" />
                <Text style={styles.regionName}>{region.name}</Text>
                {region.note && <Text style={styles.regionNote}>{region.note}</Text>}
              </TouchableOpacity>
            ))}
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
  regionRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  regionName: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '700' },
  regionNote: { color: '#F1C40F', fontSize: 11, fontWeight: '700' },
});

export default OfflineRegionsScreen;
