import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { BACKEND_URL } from '../../../shared/constants/config';
import { colors, spacing, radius, typography } from '../../../shared/constants/theme';

type SavedPOI = {
  id: number;
  name: string;
  lat: number;
  lng: number;
  category?: string | null;
  notes?: string | null;
  starred?: boolean;
  created_at?: string;
};

interface Props {
  visible: boolean;
  onClose: () => void;
  googleUser: { email: string } | null;
  onNavigate: (coords: [number, number], name: string) => void;
}

const POIHistoryModal: React.FC<Props> = ({ visible, onClose, googleUser, onNavigate }) => {
  const [items, setItems] = useState<SavedPOI[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !googleUser?.email) { setItems([]); return; }
    let cancelled = false;
    setLoading(true);
    fetch(`${BACKEND_URL}/api/pois?user_email=${encodeURIComponent(googleUser.email)}`)
      .then(r => r.ok ? r.json() : [])
      .then(d => { if (!cancelled) setItems(Array.isArray(d) ? d : []); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [visible, googleUser?.email]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>

          <View style={s.header}>
            <Text style={s.title}>POI История</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Icon name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={s.center}>
              <ActivityIndicator size="large" color={colors.accent} />
            </View>
          ) : items.length === 0 ? (
            <View style={s.center}>
              <Icon name="map-marker-off" size={40} color={colors.textSecondary} style={{ marginBottom: 12 }} />
              <Text style={s.empty}>Нямате записани точки</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={s.list} keyboardShouldPersistTaps="handled">
              {items.map(poi => (
                <View key={poi.id} style={s.row}>
                  <Icon
                    name={poi.starred ? 'star' : 'star-outline'}
                    size={20}
                    color={poi.starred ? '#FFD700' : colors.textSecondary}
                    style={{ marginRight: 8 }}
                  />
                  <View style={s.meta}>
                    <Text style={s.name} numberOfLines={1}>{poi.name}</Text>
                    {poi.category ? <Text style={s.badge}>{poi.category}</Text> : null}
                  </View>
                  <TouchableOpacity
                    style={s.goBtn}
                    onPress={() => { onNavigate([poi.lng, poi.lat], poi.name); onClose(); }}
                  >
                    <Text style={s.goText}>Навигирай</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}

        </View>
      </View>
    </Modal>
  );
};

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    flex: 1,
    marginTop: spacing.xl * 2,
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  title: {
    ...typography.h3,
    color: colors.text,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    ...typography.body,
    color: colors.textSecondary,
  },
  list: {
    paddingBottom: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  meta: {
    flex: 1,
  },
  name: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    marginBottom: 2,
  },
  badge: {
    alignSelf: 'flex-start',
    color: colors.accent,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    backgroundColor: 'rgba(0,191,255,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  goBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginLeft: 8,
  },
  goText: {
    color: '#0A0C1C',
    fontWeight: '800',
    fontSize: 13,
  },
});

export default POIHistoryModal;
