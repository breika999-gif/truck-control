import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { POICard } from '../../../shared/services/backendApi';
import { styles, NEON } from '../screens/MapScreen.styles';
import { fmtDistance, ttsSpeak, openInBrowser, getTransParkingUrl } from '../utils/mapUtils';
import type { RootStackParamList } from '../../../shared/types/navigation';

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

type NavProp = NativeStackNavigationProp<RootStackParamList>;

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
  const navigation = useNavigation<NavProp>();
  const remainAfterTravel = hosLimitS - drivingSeconds - (parking.travel_time ?? 0);
  const [tpLoading, setTpLoading] = useState(false);

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

        {parking.transparking_id ? (
          <TouchableOpacity
            style={[styles.pkWebBtn, { backgroundColor: 'rgba(0,255,136,0.12)', borderColor: '#00ff88', minWidth: 100 }]}
            activeOpacity={0.8}
            disabled={tpLoading}
            onPress={async () => {
              setTpLoading(true);
              const url = await getTransParkingUrl(parking.transparking_id!);
              setTpLoading(false);
              navigation.navigate('TruckParking', { url });
            }}
          >
            {tpLoading
              ? <ActivityIndicator size="small" color="#00ff88" />
              : <>
                  <Icon name="comment-text-multiple" size={13} color="#00ff88" />
                  <Text style={[styles.pkWebBtnTxt, { color: '#00ff88' }]}>TransParking</Text>
                </>
            }
          </TouchableOpacity>
        ) : parking.website ? (
          <TouchableOpacity
            style={styles.pkWebBtn}
            activeOpacity={0.8}
            onPress={() => openInBrowser(parking.website!)}
          >
            <Icon name="open-in-new" size={12} color={NEON} />
            <Text style={styles.pkWebBtnTxt}>Уеб</Text>
          </TouchableOpacity>
        ) : null}

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
