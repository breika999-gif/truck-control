import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { POICard } from '../../../shared/services/backendApi';
import { fmtDistance } from '../api/directions';
import { NEON, styles } from '../screens/MapScreen.styles';

interface FuelResultsPanelProps {
  fuelResults: POICard[];
  navigating: boolean;
  searchTop: number;
  onDismiss: () => void;
  onNavigate: (coords: [number, number], name: string) => void;
  onAddWaypoint: (coords: [number, number], name: string) => void;
}

const FuelResultsPanel: React.FC<FuelResultsPanelProps> = ({
  fuelResults,
  navigating,
  searchTop,
  onDismiss,
  onNavigate,
  onAddWaypoint,
}) => {
  const { t } = useTranslation();

  if (navigating || fuelResults.length === 0) return null;

  return (
    <View style={[styles.fuelPanel, { top: searchTop + 58 }]}>
      <View style={styles.parkingPanelHeader}>
        <Text style={styles.fuelPanelTitle}>⛽ {t('panels.fuelStations')}</Text>
        <TouchableOpacity onPress={onDismiss} style={styles.parkingDismissBtn}>
          <Text style={styles.parkingDismissTxt}>✕</Text>
        </TouchableOpacity>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.parkingListContent}
      >
        {fuelResults.map((f, i) => (
          <View key={i} style={styles.fuelCard}>
            <Text style={styles.fuelCardName} numberOfLines={2}>{f.name}</Text>
            {f.brand ? <Text style={styles.fuelCardBrand}>{f.brand}</Text> : null}
            <Text style={styles.fuelCardDist}>{fmtDistance(f.distance_m)}</Text>
            {f.price ? (
              <View style={styles.fuelBadge}>
                <Text style={styles.fuelBadgeTxt}>💸 {f.price}</Text>
              </View>
            ) : null}
            {f.truck_lane ? (
              <View style={styles.fuelBadgeTruck}>
                <Text style={styles.fuelBadgeTxt}>🚛 {t('panels.truckLane')}</Text>
              </View>
            ) : null}
            {f.opening_hours ? (
              <Text style={styles.fuelHours} numberOfLines={1}>{f.opening_hours}</Text>
            ) : null}
            <View style={styles.fuelCardBtns}>
              <TouchableOpacity
                style={[styles.goBtn, styles.goBtnFuel]}
                activeOpacity={0.75}
                onPress={() => {
                  onDismiss();
                  if (f.lat && f.lng) onNavigate([f.lng, f.lat], f.name);
                }}
              >
                <Icon name="gas-station" size={14} color="#0a0c1c" />
                <Text style={styles.goBtnTxt}>{t('common.route')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.fuelWpBtn}
                activeOpacity={0.75}
                onPress={() => {
                  onDismiss();
                  if (f.lat && f.lng) onAddWaypoint([f.lng, f.lat], f.name);
                }}
              >
                <Icon name="map-marker-plus" size={14} color={NEON} />
                <Text style={styles.fuelWpBtnTxt}>{t('parking.stop')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
};

export default React.memo(FuelResultsPanel);
