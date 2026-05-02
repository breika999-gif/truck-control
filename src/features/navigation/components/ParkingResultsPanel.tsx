import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { POICard } from '../../../shared/services/backendApi';
import { fmtDistance } from '../api/directions';
import { NEON, styles } from '../screens/MapScreen.styles';

interface ParkingResultsPanelProps {
  parkingResults: POICard[];
  searchTop: number;
  onDismiss: () => void;
  onNavigate: (coords: [number, number], name: string) => void;
  onAddWaypoint: (coords: [number, number], name: string) => void;
  onClearSelectedParking: () => void;
  onOpenInfo: (parking: POICard) => void | Promise<void>;
  onSpeak: (text: string) => void;
}

const ParkingResultsPanel: React.FC<ParkingResultsPanelProps> = ({
  parkingResults,
  searchTop,
  onDismiss,
  onNavigate,
  onAddWaypoint,
  onClearSelectedParking,
  onOpenInfo,
  onSpeak,
}) => {
  if (parkingResults.length === 0) return null;

  return (
    <View style={[styles.parkingPanel, { top: searchTop + 58 }]}>
      <View style={styles.parkingPanelHeader}>
        <Text style={styles.parkingPanelTitle}>🅿️ Паркинги за камиони</Text>
        <TouchableOpacity onPress={onDismiss} style={styles.parkingDismissBtn}>
          <Text style={styles.parkingDismissTxt}>✕</Text>
        </TouchableOpacity>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.parkingListContent}
      >
        {parkingResults.map((p, i) => (
          <View key={i} style={styles.parkingCard}>
            <Text style={styles.parkingCardName} numberOfLines={2}>{p.name}</Text>
            <Text style={styles.parkingCardDist}>{fmtDistance(p.distance_m)}</Text>

            <View style={styles.parkingBadgeRow}>
              <View style={[styles.parkingBadge, p.paid ? styles.parkingBadgePaid : styles.parkingBadgeFree]}>
                <Text style={styles.parkingBadgeTxt}>{p.paid ? '💰 Платен' : '🆓 Безплатен'}</Text>
              </View>
              {p.showers && (
                <View style={styles.parkingBadge}><Text style={styles.parkingBadgeTxt}>🚿</Text></View>
              )}
              {p.toilets && (
                <View style={styles.parkingBadge}><Text style={styles.parkingBadgeTxt}>🚽</Text></View>
              )}
              {p.wifi && (
                <View style={styles.parkingBadge}><Text style={styles.parkingBadgeTxt}>📶</Text></View>
              )}
              {p.security && (
                <View style={styles.parkingBadge}><Text style={styles.parkingBadgeTxt}>🔒</Text></View>
              )}
              {p.lighting && (
                <View style={styles.parkingBadge}><Text style={styles.parkingBadgeTxt}>💡</Text></View>
              )}
              {p.capacity != null && (
                <View style={styles.parkingBadge}><Text style={styles.parkingBadgeTxt}>🚛 {p.capacity}</Text></View>
              )}
            </View>

            {p.opening_hours ? (
              <Text style={styles.parkingHours} numberOfLines={1}>{p.opening_hours}</Text>
            ) : null}

            <View style={styles.parkingCardActions}>
              <TouchableOpacity
                style={styles.parkingGoBtn}
                activeOpacity={0.8}
                onPress={() => {
                  onDismiss();
                  onClearSelectedParking();
                  onNavigate([p.lng, p.lat], p.name);
                }}
              >
                <Icon name="navigation-variant" size={12} color="#0a0c1c" />
                <Text style={styles.parkingGoBtnTxt2}>Маршрут</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.parkingWpBtn}
                activeOpacity={0.8}
                onPress={() => {
                  onDismiss();
                  onClearSelectedParking();
                  onAddWaypoint([p.lng, p.lat], p.name);
                }}
              >
                <Icon name="map-marker-plus" size={12} color={NEON} />
                <Text style={styles.parkingWpBtnTxt}>+ Спирка</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.parkingWebBtn, p.transparking_id && { borderColor: '#00ff88', backgroundColor: 'rgba(0,255,136,0.1)' }]}
                activeOpacity={0.8}
                onPress={() => { onOpenInfo(p); }}
              >
                <Icon name={p.transparking_id ? 'comment-text-multiple' : 'open-in-new'} size={12} color={p.transparking_id ? '#00ff88' : NEON} />
                <Text style={[styles.parkingWebBtnTxt, p.transparking_id && { color: '#00ff88' }]}>
                  {p.transparking_id ? 'TransParking' : 'Инфо'}
                </Text>
              </TouchableOpacity>

              {p.voice_desc && (
                <TouchableOpacity
                  style={styles.parkingTtsBtn}
                  activeOpacity={0.8}
                  onPress={() => onSpeak(p.voice_desc!)}
                >
                  <Icon name="volume-high" size={13} color="#fff" />
                </TouchableOpacity>
              )}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
};

export default React.memo(ParkingResultsPanel);
