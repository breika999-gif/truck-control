import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { colors, spacing, radius, typography } from '../../../shared/constants/theme';
import { listStarred, deletePOI, type SavedPOI } from '../../../shared/services/backendApi';
import type { RootStackParamList } from '../../../shared/types/navigation';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'POIList'>;

const POIListScreen = () => {
  const navigation = useNavigation<NavigationProp>();
  const [pois, setPois] = useState<SavedPOI[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPois = async () => {
    setLoading(true);
    try {
      // For now using undefined email as per current app logic where user might not be logged in
      const data = await listStarred();
      setPois(data);
    } catch (error) {
      console.error('Failed to fetch POIs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPois();
  }, []);

  const handleDelete = async (id: number) => {
    Alert.alert(
      'Изтриване',
      'Сигурни ли сте, че искате да изтриете това място?',
      [
        { text: 'Отказ', style: 'cancel' },
        {
          text: 'Изтрий',
          style: 'destructive',
          onPress: async () => {
            const success = await deletePOI(id);
            if (success) {
              setPois((prev) => prev.filter((p) => p.id !== id));
            } else {
              Alert.alert('Грешка', 'Неуспешно изтриване.');
            }
          },
        },
      ]
    );
  };

  const handleSelect = (poi: SavedPOI) => {
    // Navigate back to Map and center on this POI
    // Note: In a real app we'd pass this to MapScreen via a store or params
    navigation.navigate('Map', {
      // @ts-ignore - MapScreen might need to handle these params
      initialCenter: [poi.lng, poi.lat],
      selectedPOI: poi,
    });
  };

  const renderItem = ({ item }: { item: SavedPOI }) => (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.cardContent}
        onPress={() => handleSelect(item)}
      >
        <View style={styles.iconContainer}>
          <Icon name="star" size={24} color={colors.warning} />
        </View>
        <View style={styles.textContainer}>
          <Text style={styles.poiName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.poiAddress} numberOfLines={1}>
            {item.address || `${item.lat.toFixed(4)}, ${item.lng.toFixed(4)}`}
          </Text>
          <Text style={styles.poiDate}>
            {new Date(item.created_at).toLocaleDateString('bg-BG')}
          </Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.deleteButton}
        onPress={() => handleDelete(item.id)}
      >
        <Icon name="trash-can-outline" size={24} color={colors.error} />
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Icon name="chevron-left" size={30} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>История на местата</Text>
        <TouchableOpacity onPress={fetchPois} style={styles.refreshButton}>
          <Icon name="refresh" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : pois.length === 0 ? (
        <View style={styles.center}>
          <Icon name="star-outline" size={64} color={colors.textMuted} />
          <Text style={styles.emptyText}>Нямате запазени места</Text>
        </View>
      ) : (
        <FlatList
          data={pois}
          renderItem={renderItem}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.list}
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
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    padding: spacing.xs,
  },
  headerTitle: {
    ...typography.h3,
    color: colors.text,
  },
  refreshButton: {
    padding: spacing.xs,
  },
  list: {
    padding: spacing.md,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  cardContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
  },
  iconContainer: {
    marginRight: spacing.md,
  },
  textContainer: {
    flex: 1,
  },
  poiName: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  poiAddress: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  poiDate: {
    ...typography.label,
    color: colors.textMuted,
  },
  deleteButton: {
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
});

export default POIListScreen;
