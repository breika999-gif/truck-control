import React from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { POICard } from '../../../shared/services/backendApi';
import { fmtDistance } from '../api/directions';
import { NEON, styles } from '../screens/MapScreen.styles';
import {
  calcParkingReach,
  calcParkingScore,
  GRADE_COLOR,
  GRADE_LABEL,
  REACH_CONFIG,
} from '../utils/parkingScore';

interface ParkingResultsPanelProps {
  parkingResults: POICard[];
  searchTop: number;
  onDismiss: () => void;
  onNavigate: (coords: [number, number], name: string) => void;
  onAddWaypoint: (coords: [number, number], name: string) => void;
  onClearSelectedParking: () => void;
  onOpenInfo: (parking: POICard) => void | Promise<void>;
  onSpeak: (text: string) => void;
  onCardTap?: (parking: POICard) => void;
  remainingDriveMin?: number;
  speedKmh?: number;
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
  onCardTap,
  remainingDriveMin,
  speedKmh,
}) => {
  const { t } = useTranslation();
  const [loadingInfoIdx, setLoadingInfoIdx] = React.useState<number | null>(null);
  const [safeOnly, setSafeOnly] = React.useState(false);

  if (parkingResults.length === 0) return null;

  const visibleResults = safeOnly
    ? parkingResults.filter(p =>
        p.security || p.lighting || p.showers || p.toilets || p.transparking_id
      )
    : parkingResults;

  return (
    <View style={[styles.parkingPanel, { top: searchTop + 58 }]}>
      <View style={styles.parkingPanelHeader}>
        <Text style={styles.parkingPanelTitle}>{t('parking.truckParkings')}</Text>
        <TouchableOpacity onPress={onDismiss} style={styles.parkingDismissBtn}>
          <Text style={styles.parkingDismissTxt}>✕</Text>
        </TouchableOpacity>
      </View>
      <View style={{ flexDirection: 'row', paddingHorizontal: 12, paddingBottom: 6, gap: 8 }}>
        <TouchableOpacity
          onPress={() => setSafeOnly(value => !value)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            borderWidth: 1,
            borderColor: safeOnly ? '#4cff91' : 'rgba(255,255,255,0.2)',
            backgroundColor: safeOnly ? 'rgba(76,255,145,0.12)' : 'transparent',
            borderRadius: 14,
            paddingHorizontal: 10,
            paddingVertical: 4,
          }}
        >
          <Text style={{ fontSize: 11, color: safeOnly ? '#4cff91' : '#aaa', fontWeight: '700' }}>
            🔒 За нощувка
          </Text>
        </TouchableOpacity>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.parkingListContent}
      >
        {visibleResults.length === 0 ? (
          <Text style={{ color: '#888', fontSize: 12, padding: 12 }}>
            Няма паркинги с нощувка в текущите резултати
          </Text>
        ) : visibleResults.map((p, i) => {
          const { grade } = calcParkingScore(p);
          const reach = calcParkingReach(p.distance_m, remainingDriveMin, speedKmh);
          const rc = REACH_CONFIG[reach.status];

          return (
            <TouchableOpacity
              key={p.name + String(i)}
              activeOpacity={0.85}
              onPress={() => onCardTap?.(p)}
              style={styles.parkingCard}
            >
              <Text style={styles.parkingCardName} numberOfLines={2}>{p.name}</Text>
              <Text style={styles.parkingCardDist}>{fmtDistance(p.distance_m)}</Text>
              <View style={{
                alignSelf: 'flex-start',
                backgroundColor: `${GRADE_COLOR[grade]}22`,
                borderColor: GRADE_COLOR[grade],
                borderWidth: 1,
                borderRadius: 10,
                paddingHorizontal: 7,
                paddingVertical: 2,
                marginTop: 3,
                marginBottom: 4,
              }}>
                <Text style={{ color: GRADE_COLOR[grade], fontSize: 10, fontWeight: '700' }}>
                  {GRADE_LABEL[grade]}
                </Text>
              </View>
              {reach.status !== 'unknown' && (
                <Text style={{ fontSize: 10, color: rc.color, fontWeight: '600', marginBottom: 4 }}>
                  {rc.emoji} {rc.label(reach.reserveMin)}
                </Text>
              )}

              <View style={styles.parkingBadgeRow}>
                <View style={[styles.parkingBadge, p.paid ? styles.parkingBadgePaid : styles.parkingBadgeFree]}>
                  <Text style={styles.parkingBadgeTxt}>{p.paid ? `💰 ${t('parking.paid')}` : `🆓 ${t('parking.free')}`}</Text>
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
                  <Text style={styles.parkingGoBtnTxt2}>{t('parking.go')}</Text>
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
                  <Text style={styles.parkingWpBtnTxt}>{t('parking.stop')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.parkingWebBtn,
                    p.transparking_id && { borderColor: '#00ff88', backgroundColor: 'rgba(0,255,136,0.1)' },
                    loadingInfoIdx === i && { opacity: 0.5 },
                  ]}
                  activeOpacity={0.8}
                  disabled={loadingInfoIdx === i}
                  onPress={async () => {
                    setLoadingInfoIdx(i);
                    try {
                      await onOpenInfo(p);
                    } finally {
                      setLoadingInfoIdx(null);
                    }
                  }}
                >
                  {loadingInfoIdx === i ? (
                    <ActivityIndicator size={12} color={p.transparking_id ? '#00ff88' : NEON} />
                  ) : (
                    <Icon name={p.transparking_id ? 'comment-text-multiple' : 'open-in-new'} size={12} color={p.transparking_id ? '#00ff88' : NEON} />
                  )}
                  <Text style={[styles.parkingWebBtnTxt, p.transparking_id && { color: '#00ff88' }]}>
                    {p.transparking_id ? 'TransParking' : t('parking.info')}
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
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

export default React.memo(ParkingResultsPanel);
