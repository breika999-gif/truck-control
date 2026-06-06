import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { POICard } from '../../../shared/services/backendApi';
import { styles } from '../screens/MapScreen.styles';

interface FuelPanelProps {
  fuel: POICard;
  onClose: () => void;
  onAddWaypoint: (coords: [number, number], name: string) => void;
  topOffset: number;
}

const FuelPanel: React.FC<FuelPanelProps> = ({ fuel, onClose, onAddWaypoint, topOffset }) => {
  const { t } = useTranslation();

  return (
    <View style={[styles.fuelBubble, { top: topOffset }]}>
      {/* Header */}
      <View style={styles.parkingBubbleHeader}>
        <Text style={styles.parkingBubbleName} numberOfLines={2}>
          ⛽ {fuel.brand ? `${fuel.brand} - ` : ''}{fuel.name}
        </Text>
        <TouchableOpacity onPress={onClose} style={styles.parkingBubbleClose}>
          <Text style={styles.parkingBubbleCloseTxt}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Distance */}
      <Text style={styles.parkingBubbleDist}>
        {fuel.distance_m > 0 ? `${(fuel.distance_m / 1000).toFixed(1)} ${t('panels.alongRouteKm')}` : t('panels.nearRoute')}
      </Text>

      {/* Info Row */}
      <View style={styles.parkingBubbleBadgeRow}>
        <View style={styles.fuelBadge}>
          <Text style={styles.fuelBadgeTxt}>
            💰 {fuel.price || t('panels.unknownPrice')}
          </Text>
        </View>
        
        <View style={[styles.fuelBadge, fuel.truck_lane ? { borderColor: '#4cff91' } : {}]}>
          <Text style={[styles.fuelBadgeTxt, fuel.truck_lane ? { color: '#4cff91' } : {}]}>
            {fuel.truck_lane ? `✅ ${t('panels.hasTruckLane')}` : `❌ ${t('panels.noTruckLane')}`}
          </Text>
        </View>

        {fuel.opening_hours && (
          <View style={styles.pkBadge}>
            <Text style={styles.pkBadgeTxt}>🕒 {fuel.opening_hours}</Text>
          </View>
        )}
      </View>

      {/* Actions */}
      <View style={styles.parkingBubbleBtns}>
        <TouchableOpacity
          style={styles.parkingBubbleNavBtn}
          activeOpacity={0.8}
          onPress={() => onAddWaypoint([fuel.lng, fuel.lat], fuel.name)}
        >
          <Icon name="map-marker-plus" size={16} color="#0a0c1c" />
          <Text style={styles.parkingBubbleNavBtnTxt}>{t('panels.addStop')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.parkingBubbleWebBtn}
          activeOpacity={0.8}
          onPress={onClose}
        >
          <Text style={styles.parkingBubbleWebBtnTxt}>{t('common.close')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default React.memo(FuelPanel);
