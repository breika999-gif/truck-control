import React from 'react';
import { View, Text, TouchableOpacity, Linking } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { POICard } from '../../../shared/services/backendApi';
import { styles, NEON } from '../screens/MapScreen.styles';
import { fmtDistance, ttsSpeak, detectCountryCode, openInBrowser } from '../utils/mapUtils';

interface ParkingBubbleProps {
  parking: POICard;
  onClose: () => void;
  onNavigate: (coord: [number, number], name: string) => void;
  onAddWaypoint: (coord: [number, number], name: string) => void;
  onClearResults: () => void;
  drivingSeconds: number;
  hosLimitS: number;
  topOffset: number;
}

const ParkingBubble: React.FC<ParkingBubbleProps> = ({
  parking,
  onClose,
  onNavigate,
  onAddWaypoint,
  onClearResults,
  drivingSeconds,
  hosLimitS,
  topOffset,
}) => {
  const remainAfterTravel = hosLimitS - drivingSeconds - (parking.travel_time ?? 0);

  return (
    <View style={[styles.parkingBubble, { top: topOffset }]}>
      {/* Header row */}
      <View style={styles.parkingBubbleHeader}>
        <Text style={styles.parkingBubbleName} numberOfLines={2}>
          🅿️ {parking.name}
        </Text>
        <TouchableOpacity onPress={onClose} style={styles.parkingBubbleClose}>
          <Text style={styles.parkingBubbleCloseTxt}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Distance + travel time badge */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
        <Text style={styles.parkingBubbleDist}>
          {fmtDistance(parking.distance_m)}
          {parking.opening_hours ? `  ·  ${parking.opening_hours}` : ''}
        </Text>
        {parking.travel_time && (
          <View style={[
            styles.pkBadge,
            { marginLeft: 8, backgroundColor: 'rgba(0,0,0,0.3)' },
            remainAfterTravel < 900 && { borderColor: '#FFC107', borderWidth: 1 },
            remainAfterTravel < 0   && { borderColor: '#F44336', borderWidth: 1 },
          ]}>
            <Text style={[styles.pkBadgeTxt, { fontSize: 11 }]}>
              🕐 {Math.round(parking.travel_time / 60)} мин
            </Text>
          </View>
        )}
      </View>

      {/* Tacho reachability */}
      {parking.travel_time && (
        <Text style={[
          { fontSize: 12, marginBottom: 8, fontWeight: '600' },
          remainAfterTravel > 900 ? { color: '#4CAF50' } :
          remainAfterTravel > 0   ? { color: '#FFC107' } :
                                    { color: '#F44336' },
        ]}>
          {remainAfterTravel > 0
            ? `Остават: ${Math.round(remainAfterTravel / 60)} мин`
            : `Закъснение: превишаваш с ${Math.round(-remainAfterTravel / 60)} мин!`}
        </Text>
      )}

      {/* Amenity badges */}
      <View style={styles.parkingBubbleBadgeRow}>
        <View style={[styles.pkBadge, parking.paid ? styles.pkBadgePaid : styles.pkBadgeFree]}>
          <Text style={styles.pkBadgeTxt}>{parking.paid ? '💳 Платен' : '✅ Безплатен'}</Text>
        </View>
        {parking.showers  && <View style={styles.pkBadge}><Text style={styles.pkBadgeTxt}>🚿</Text></View>}
        {parking.toilets  && <View style={styles.pkBadge}><Text style={styles.pkBadgeTxt}>🚽</Text></View>}
        {parking.wifi     && <View style={styles.pkBadge}><Text style={styles.pkBadgeTxt}>📶 WiFi</Text></View>}
        {parking.security && <View style={styles.pkBadge}><Text style={styles.pkBadgeTxt}>🔒 Охрана</Text></View>}
        {parking.lighting && <View style={styles.pkBadge}><Text style={styles.pkBadgeTxt}>💡 Осветен</Text></View>}
        {parking.capacity != null && (
          <View style={styles.pkBadge}>
            <Text style={styles.pkBadgeTxt}>🚛 {parking.capacity}</Text>
          </View>
        )}
      </View>

      {/* Action buttons */}
      <View style={styles.parkingBubbleBtns}>
        <TouchableOpacity
          style={styles.parkingBubbleNavBtn}
          activeOpacity={0.8}
          onPress={() => { onClose(); onClearResults(); onNavigate([parking.lng, parking.lat], parking.name); }}
        >
          <Icon name="navigation-variant" size={16} color="#0a0c1c" />
          <Text style={styles.parkingBubbleNavBtnTxt}>Навигация</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.parkingBubbleWpBtn}
          activeOpacity={0.8}
          onPress={() => { onClose(); onClearResults(); onAddWaypoint([parking.lng, parking.lat], parking.name); }}
        >
          <Icon name="map-marker-plus" size={16} color={NEON} />
          <Text style={styles.parkingBubbleWpBtnTxt}>+ Спирка</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.parkingBubbleWebBtn}
          activeOpacity={0.8}
          onPress={() => {
            if (parking.website) {
              openInBrowser(parking.website);
            } else {
              const cc = detectCountryCode(parking.lat, parking.lng);
              const base = cc === 'eu'
                ? 'https://truckerapps.eu/transparking/'
                : `https://truckerapps.eu/transparking/${cc}/map/`;
              openInBrowser(base);
            }
          }}
        >
          <Icon name="open-in-new" size={16} color={NEON} />
          <Text style={styles.parkingBubbleWebBtnTxt}>Уеб</Text>
        </TouchableOpacity>

        {parking.transparking_url && (
          <TouchableOpacity
            style={[styles.parkingBubbleWebBtn, { backgroundColor: 'rgba(0,255,136,0.12)', borderColor: '#00ff88' }]}
            activeOpacity={0.8}
            onPress={() => Linking.openURL(parking.transparking_url!)}
          >
            <Icon name="comment-text-multiple" size={16} color="#00ff88" />
            <Text style={[styles.parkingBubbleWebBtnTxt, { color: '#00ff88' }]}>Отзиви</Text>
          </TouchableOpacity>
        )}

        {parking.voice_desc && (
          <TouchableOpacity
            style={styles.parkingBubbleTtsBtn}
            activeOpacity={0.8}
            onPress={() => ttsSpeak(parking.voice_desc!)}
          >
            <Icon name="volume-high" size={16} color="#fff" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

export default ParkingBubble;
