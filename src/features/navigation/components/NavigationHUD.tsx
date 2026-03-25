import React, { useMemo, memo, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Share,
  ActivityIndicator,
  Animated,
  PanResponder,
} from 'react-native';

const HANDLE_H = 36; // visible handle height when collapsed
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { EdgeInsets } from 'react-native-safe-area-context';
import { styles, NEON } from '../screens/MapScreen.styles';
import { colors, spacing } from '../../../shared/constants/theme';
import {
  fmtDistance,
  fmtDuration,
} from '../api/directions';
import {
  fmtHOS,
  DEPART_LABELS,
  type DepartLabel,
} from '../utils/mapUtils';
import type { RouteResult } from '../api/directions';
import type { VehicleProfile } from '../../../shared/types/vehicle';

interface NavigationHUDProps {
  navigating: boolean;
  route: RouteResult | null;
  currentStep: number;
  distToTurn: number | null;
  speed: number;
  speedLimit: number | null;
  remainingSeconds: number;
  destination: [number, number] | null;
  destinationName: string;
  onStop: () => void;
  onClose: () => void;
  drivingSeconds: number;
  testLanesMode: boolean;
  insets: EdgeInsets;
  loadingRoute?: boolean;
  gpsReady?: boolean;
  onStart?: () => void;
  profile?: VehicleProfile | null;
  dominantCongestion?: string | null;
  elevProfile?: number[];
  weatherPoints?: Array<{ emoji: string; temp: number }>;
  departLabel?: DepartLabel;
  pickDeparture?: (label: DepartLabel) => void;
  waypoints?: [number, number][];
  waypointNames?: string[];
  setWaypoints?: (wps: [number, number][]) => void;
  setWaypointNames?: (names: string[]) => void;
  optimizeWaypointOrder?: (userCoords: [number, number], waypoints: [number, number][]) => [number, number][];
  userCoords?: [number, number] | null;
  navigateTo?: (dest: [number, number], name: string, wps?: [number, number][], autoStart?: boolean) => void;
  HOS_LIMIT_S: number;
  speedingBg?: Animated.AnimatedInterpolation<string | number>;
  proximityAlerts?: { overtaking: any[] };
  roadGrade?: number | null;
  nearestParkingM?: number | null;
}

const NavigationHUD: React.FC<NavigationHUDProps> = memo(({
  navigating,
  route,
  distToTurn,
  speed,
  speedLimit,
  remainingSeconds,
  destination,
  destinationName,
  onStop,
  onClose,
  drivingSeconds,
  insets,
  loadingRoute,
  gpsReady,
  onStart,
  profile,
  dominantCongestion,
  elevProfile = [],
  weatherPoints = [],
  departLabel,
  pickDeparture,
  waypoints = [],
  waypointNames = [],
  setWaypoints,
  setWaypointNames,
  optimizeWaypointOrder,
  userCoords,
  navigateTo,
  HOS_LIMIT_S,
  speedingBg,
  proximityAlerts,
  roadGrade,
  nearestParkingM,
}) => {
  // ── Bottom-sheet snap logic ────────────────────────────────────────────────
  const panelHeightRef = useRef(0);
  const translateY     = useRef(new Animated.Value(0)).current;
  const expandedRef    = useRef(false);
  const initializedRef = useRef(false);

  const snapTo = useCallback((expanded: boolean) => {
    const collapsed = Math.max(0, panelHeightRef.current - HANDLE_H);
    Animated.spring(translateY, {
      toValue:        expanded ? 0 : collapsed,
      useNativeDriver: true,
      damping:         22,
      stiffness:       220,
    }).start();
    expandedRef.current = expanded;
  }, [translateY]);

  // Collapse when a new route appears
  useEffect(() => {
    if (route) {
      initializedRef.current = false; // allow re-collapse on new route
    }
  }, [route?.distance]);

  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gs) =>
      Math.abs(gs.dy) > 8 && Math.abs(gs.dy) > Math.abs(gs.dx),
    onPanResponderMove: (_, gs) => {
      const base = expandedRef.current ? 0 : panelHeightRef.current - HANDLE_H;
      const next = Math.max(0, Math.min(panelHeightRef.current - HANDLE_H, base + gs.dy));
      translateY.setValue(next);
    },
    onPanResponderRelease: (_, gs) => {
      if (gs.vy < -0.3 || gs.dy < -40) {
        snapTo(true);
      } else if (gs.vy > 0.3 || gs.dy > 40) {
        snapTo(false);
      } else {
        snapTo(expandedRef.current);
      }
    },
  })).current;

  const eta = useMemo(() => {
    if (!route) return null;
    const secs = navigating && remainingSeconds > 0 ? remainingSeconds : route.duration;
    const arrival = new Date(Date.now() + secs * 1000);
    return arrival.toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' });
  }, [route, navigating, remainingSeconds]);

  if (!route && !navigating && speedLimit === null) return null;

  return (
    <>
      {/* ── Bottom-left: HOS badge + speed + limit ── */}
      {(navigating || speedLimit != null) && (
        <View style={[styles.speedRow, { bottom: 224 + insets.bottom }]}>
          <View>
            <View style={[
              styles.hosBadge,
              drivingSeconds >= 15600 && styles.hosBadgeWarn,
              drivingSeconds >= HOS_LIMIT_S && styles.hosBadgeLimit,
            ]}>
              <Text style={styles.hosBadgeLabel}>HOS</Text>
              <Text style={styles.hosBadgeValue}>{fmtHOS(drivingSeconds)}</Text>
            </View>
            <View style={[
              styles.speedRing,
              speedLimit != null && speed > speedLimit
                ? styles.speedRingRed
                : speedLimit != null && speed > speedLimit - 10
                ? styles.speedRingYellow
                : styles.speedRingGreen,
            ]}>
              <Text style={styles.speedValue}>{speed}</Text>
              <Text style={styles.speedUnit}>км/ч</Text>
            </View>
          </View>
          
          <View style={styles.signColumn}>
            {speedLimit != null && (
              <Animated.View style={[
                styles.speedCircle, 
                speed > speedLimit && styles.speedCircleExceeded,
                { backgroundColor: speedingBg }
              ]}>
                <Text style={[styles.speedCircleNum, speed > speedLimit && { color: '#fff' }]}>{speedLimit}</Text>
              </Animated.View>
            )}

            {proximityAlerts?.overtaking && proximityAlerts.overtaking.length > 0 && (
              <View style={styles.noOvertakingCircle}>
                <Text style={styles.noOvertakingEmoji}>
                  {proximityAlerts.overtaking[0].hgv_only ? '🚛🚫' : '🚗🚫'}
                </Text>
              </View>
            )}

            {/* Road Grade Warning (Step D) */}
            {roadGrade != null && Math.abs(roadGrade) > 5 && (
              <View style={[styles.gradeCircle, { borderColor: roadGrade > 0 ? '#ff9500' : '#ff3b30' }]}>
                <Text style={styles.gradeEmoji}>{roadGrade > 0 ? '⛰️' : '📉'}</Text>
                <Text style={styles.gradeVal}>{Math.abs(Math.round(roadGrade))}%</Text>
              </View>
            )}
          </View>
          {nearestParkingM != null && (
            <View style={styles.parkingHudChip}>
              <Text style={styles.parkingHudText}>
                🅿️ {nearestParkingM < 1000
                  ? `${Math.round(nearestParkingM)}м`
                  : `${(nearestParkingM / 1000).toFixed(1)}км`}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* ── Bottom-right: distance to next turn ── */}
      {navigating && distToTurn != null && (
        <View style={[styles.distBox, { bottom: 240 + insets.bottom }]}>
          <Text style={styles.distValue}>{fmtDistance(distToTurn)}</Text>
          <Text style={styles.distLabel}>ДО ЗАВОЙ</Text>
        </View>
      )}

      {/* ── Bottom panel (swipeable sheet) ── */}
      {route && !loadingRoute && (
        <Animated.View
          style={[styles.bottomPanel, { paddingBottom: insets.bottom + spacing.md, transform: [{ translateY }] }]}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (h > 0 && !initializedRef.current) {
              panelHeightRef.current = h;
              initializedRef.current = true;
              // Start collapsed — only handle visible
              translateY.setValue(h - HANDLE_H);
              expandedRef.current = false;
            } else if (h > 0) {
              panelHeightRef.current = h;
            }
          }}
          {...panResponder.panHandlers}
        >
          {/* Drag handle */}
          <View style={styles.sheetHandle} />
          <View style={styles.infoRow}>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>РАЗСТОЯНИЕ</Text>
              <Text style={styles.infoValue}>{fmtDistance(route.distance)}</Text>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>ОСТАВАЩО</Text>
              <Text style={styles.infoValue}>
                {navigating && remainingSeconds > 0
                  ? fmtDuration(remainingSeconds)
                  : fmtDuration(route.duration)}
              </Text>
            </View>
            {eta ? (
              <>
                <View style={styles.infoDivider} />
                <View style={styles.infoCell}>
                  <Text style={styles.infoLabel}>⏰ ПРИСТИГАНЕ</Text>
                  <Text style={styles.infoValue}>{eta}</Text>
                </View>
              </>
            ) : null}
            {destination && (
              <TouchableOpacity
                style={styles.shareBtn}
                onPress={() => {
                  const [lng, lat] = destination;
                  const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
                  Share.share({ message: `Маршрут до ${destinationName}: ${url}` });
                }}
              >
                <Text style={styles.shareBtnText}>↗</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          {destinationName ? (
            <Text style={styles.destName} numberOfLines={1}>→ {destinationName}</Text>
          ) : null}

          {/* Truck geometry badge */}
          {navigating && profile && (
            <View style={styles.truckDimRow}>
              <View style={styles.truckDimBadge}>
                <Text style={styles.truckDimText}>↕ {profile.height_m} м</Text>
              </View>
              <View style={styles.truckDimBadge}>
                <Text style={styles.truckDimText}>⚖ {profile.weight_t} т</Text>
              </View>
              <View style={styles.truckDimBadge}>
                <Text style={styles.truckDimText}>↔ {profile.width_m} м</Text>
              </View>
              <View style={styles.truckDimBadge}>
                <Text style={styles.truckDimText}>↔ {profile.length_m} м</Text>
              </View>
              {profile.hazmat_class && profile.hazmat_class !== 'none' && (
                <View style={[styles.truckDimBadge, styles.adrBadge]}>
                  <Text style={styles.truckDimText}>⚠ ADR {profile.hazmat_class}</Text>
                </View>
              )}
            </View>
          )}

          {/* Congestion indicator */}
          {dominantCongestion && (
            <View style={styles.congestionRow}>
              <View style={[
                styles.congestionChip,
                dominantCongestion === 'heavy'    && styles.congestionHeavy,
                dominantCongestion === 'moderate' && styles.congestionModerate,
              ]}>
                <Text style={styles.congestionText}>
                  {dominantCongestion === 'heavy'
                    ? '🔴 Задръствания'
                    : dominantCongestion === 'moderate'
                    ? '🟡 Умерен трафик'
                    : '🟢 Свободно'}
                </Text>
              </View>
            </View>
          )}

          {/* Route elevation profile mini bar chart */}
          {elevProfile.length > 1 && (
            <View style={styles.elevProfileStrip}>
              <Text style={styles.elevProfileLabel}>
                ⛰ {Math.round(Math.min(...elevProfile))}–{Math.round(Math.max(...elevProfile))} м н.в.
              </Text>
              <View style={styles.elevProfileBars}>
                {(() => {
                  const min = Math.min(...elevProfile);
                  const max = Math.max(...elevProfile);
                  return elevProfile.map((e, i) => {
                    const pct = max > min ? (e - min) / (max - min) : 0.5;
                    return <View key={i} style={[styles.elevBar, { height: Math.max(4, pct * 28) }]} />;
                  });
                })()}
              </View>
            </View>
          )}

          {/* Weather strip along route */}
          {weatherPoints.length > 0 && (
            <View style={styles.weatherStrip}>
              {weatherPoints.map((wp, i) => (
                <View key={i} style={styles.weatherChip}>
                  <Text style={styles.weatherChipEmoji}>{wp.emoji}</Text>
                  <Text style={styles.weatherChipTemp}>{wp.temp}°C</Text>
                </View>
              ))}
            </View>
          )}

          {!navigating && (
            <View style={styles.departRow}>
              {DEPART_LABELS.map(label => (
                <TouchableOpacity
                  key={label}
                  style={[styles.departChip, departLabel === label && styles.departChipActive]}
                  onPress={() => pickDeparture && pickDeparture(label)}
                >
                  <Text style={[
                    styles.departChipText,
                    departLabel === label && styles.departChipTextActive,
                  ]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Waypoint strip */}
          {waypoints.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.waypointStrip}
              contentContainerStyle={styles.waypointStripContent}
            >
              {waypointNames.map((name, i) => (
                <View key={i} style={styles.waypointChip}>
                  <Icon name="map-marker-plus" size={14} color="#ff8c00" style={{ marginRight: 4 }} />
                  <Text style={styles.waypointChipText} numberOfLines={1}>
                    {i + 1}. {name}
                  </Text>
                  <TouchableOpacity
                    style={styles.waypointChipRemoveBtn}
                    onPress={() => {
                      if (!setWaypoints || !setWaypointNames || !navigateTo) return;
                      const newWps   = waypoints.filter((_, idx) => idx !== i);
                      const newNames = waypointNames.filter((_, idx) => idx !== i);
                      setWaypoints(newWps);
                      setWaypointNames(newNames);
                      if (destination) navigateTo(destination, destinationName, newWps);
                    }}
                  >
                    <Icon name="close-circle" size={16} color="rgba(255,107,107,0.9)" />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}

          {/* Optimize waypoints */}
          {waypoints.length >= 2 && (
            <TouchableOpacity
              style={styles.optimizeBtn}
              onPress={() => {
                if (!optimizeWaypointOrder || !userCoords || !setWaypoints || !navigateTo || !destination) return;
                const optimized = optimizeWaypointOrder(userCoords, waypoints);
                setWaypoints(optimized);
                navigateTo(destination, destinationName, optimized);
              }}
            >
              <Text style={styles.optimizeBtnText}>⚡ Оптимизирай спирките</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[
              styles.startBtn,
              navigating && styles.startBtnActive,
              !navigating && !gpsReady && styles.startBtnDisabled,
            ]}
            onPress={navigating ? onStop : (gpsReady ? onStart : undefined)}
            activeOpacity={0.85}
          >
            <Text style={styles.startBtnText}>
              {navigating
                ? '🛑 Спри навигацията'
                : gpsReady
                ? '🚀 Тръгваме!'
                : '📡 Изчакване на GPS...'}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      )}
    </>
  );
});

export default NavigationHUD;
