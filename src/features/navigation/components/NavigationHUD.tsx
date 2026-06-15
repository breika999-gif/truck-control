import React, { useMemo, memo, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Share,
  Animated,
  Image,
  PanResponder,
  StyleSheet,
} from 'react-native';

const HANDLE_H = 92; // handle + infoRow + destName always visible when collapsed
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import type { EdgeInsets } from 'react-native-safe-area-context';
import { styles } from '../screens/MapScreen.styles';
import { spacing } from '../../../shared/constants/theme';
import { HOS_CONTINUOUS_WARN_10MIN_S } from '../../../shared/constants/hosRules';
import {
  fmtDistance,
  fmtDuration,
} from '../api/directions';
import {
  fmtHOS,
  DEPART_LABELS,
  departLabelText,
  ICON_NO_OVERTAKING,
  type DepartLabel,
} from '../utils/mapUtils';
import type { RouteResult } from '../api/directions';
import type { VehicleProfile } from '../../../shared/types/vehicle';
import { useVehicleStore } from '../../../store/vehicleStore';
import type { BluetoothTachoState } from '../../tacho/hooks/useTachoBluetooth';
import type { POICard } from '../../../shared/services/backendApi';

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
  speedingBg?: Animated.AnimatedInterpolation<string | number> | string;
  proximityAlerts?: { overtaking: any[]; activeHgvNoOvertaking?: boolean };
  bluetoothTacho?: BluetoothTachoState | null;
  urgentParkingResults?: POICard[];
  onUrgentParkingPress?: () => void;
  roadGrade?: number | null;
  nearestParkingM?: number | null;
  hillWarnings?: import('../hooks/useRouteInsights').RouteInsight[];
  onFetchElevation?: () => void;
  onFetchWeather?: () => void;
  onOptimize?: () => void;
  compactOnly?: boolean;
}

const NavigationHUD: React.FC<NavigationHUDProps> = memo(({
  navigating,
  route,
  currentStep: _currentStep,
  distToTurn: _distToTurn,
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
  gpsReady: _gpsReady,
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
  bluetoothTacho,
  urgentParkingResults = [],
  onUrgentParkingPress,
  roadGrade,
  nearestParkingM,
  hillWarnings = [],
  onFetchElevation,
  onFetchWeather,
  onOptimize,
  compactOnly = false,
}) => {
  const { t, i18n } = useTranslation();
  const isLoaded = useVehicleStore(state => state.isLoaded);
  const setIsLoaded = useVehicleStore(state => state.setIsLoaded);
  const routeDistance = route?.distance;
  const activeHgvNoOvertaking = proximityAlerts?.activeHgvNoOvertaking === true;
  const tachoRemainingMin = useMemo(() => {
    const liveRemaining = bluetoothTacho?.liveData?.drivingTimeLeftMin;
    if (Number.isFinite(liveRemaining)) return Math.max(0, Math.round(liveRemaining as number));
    const continuousDrivenS = bluetoothTacho?.data?.continuousDrivenS;
    if (Number.isFinite(continuousDrivenS)) {
      return Math.max(0, Math.round((HOS_LIMIT_S - (continuousDrivenS as number)) / 60));
    }
    return null;
  }, [HOS_LIMIT_S, bluetoothTacho?.data?.continuousDrivenS, bluetoothTacho?.liveData?.drivingTimeLeftMin]);
  const rawTachoActivity = bluetoothTacho?.liveData?.activity ?? bluetoothTacho?.data?.activity;
  const tachoActivityLabel = rawTachoActivity === 'driving'
    ? t('tacho.activityDriving')
    : rawTachoActivity === 'work'
      ? t('tacho.activityWork')
      : rawTachoActivity === 'available'
        ? t('tacho.activityAvailable')
        : rawTachoActivity === 'rest'
          ? t('tacho.activityRest')
          : rawTachoActivity || t('tacho.activityUnknown');
  const tachoRemainingLabel = tachoRemainingMin == null
    ? '--:--'
    : `${Math.floor(tachoRemainingMin / 60)}:${String(tachoRemainingMin % 60).padStart(2, '0')}`;
  const tachoChipState = tachoRemainingMin != null && tachoRemainingMin <= 10
    ? 'critical'
    : tachoRemainingMin != null && tachoRemainingMin <= 30
      ? 'warning'
      : 'ok';
  // ── Bottom-sheet snap logic ────────────────────────────────────────────────
  const panelHeightRef       = useRef(0);
  const translateY           = useRef(new Animated.Value(0)).current;
  const expandedRef          = useRef(false);
  const initializedRef       = useRef(false);
  const collapseTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleCollapseRef  = useRef<() => void>(() => {});

  const snapTo = useCallback((expanded: boolean) => {
    const collapsed = Math.max(0, panelHeightRef.current - HANDLE_H);
    Animated.spring(translateY, {
      toValue:         expanded ? 0 : collapsed,
      useNativeDriver: true,
      damping:         22,
      stiffness:       220,
    }).start();
    expandedRef.current = expanded;
  }, [translateY]);

  // Keep scheduleCollapseRef current so panResponder can call it without stale closure
  useEffect(() => {
    scheduleCollapseRef.current = () => {
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = setTimeout(() => snapTo(false), 4500);
    };
  }, [snapTo]);

  // Auto-collapse 4.5 s after navigation starts; cancel when nav stops
  useEffect(() => {
    if (navigating) {
      scheduleCollapseRef.current();
    }
    return () => {
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
    };
  }, [navigating]);

  // Allow re-init on new route
  useEffect(() => {
    if (routeDistance != null) {
      initializedRef.current = false;
    }
  }, [routeDistance]);

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
        // User manually opened → schedule auto-collapse again
        scheduleCollapseRef.current();
      } else if (gs.vy > 0.3 || gs.dy > 40) {
        snapTo(false);
        if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
      } else {
        snapTo(expandedRef.current);
      }
    },
  })).current;

  const clockLocale = i18n.language === 'bg' ? 'bg-BG' : i18n.language === 'es' ? 'es-ES' : 'en-US';

  const eta = useMemo(() => {
    if (!route) return null;
    const secs = navigating && remainingSeconds > 0 ? remainingSeconds : route.duration;
    const arrival = new Date(Date.now() + secs * 1000);
    return arrival.toLocaleTimeString(clockLocale, { hour: '2-digit', minute: '2-digit' });
  }, [route, navigating, remainingSeconds, clockLocale]);

  const hosWarning = useMemo(() => {
    if (!navigating || !route) return null;
    const remainingSec = remainingSeconds > 0 ? remainingSeconds : route.duration;
    const hosRemainingSec = Math.max(0, HOS_LIMIT_S - drivingSeconds);
    if (hosRemainingSec <= 0) return 'break_required';
    if (remainingSec > hosRemainingSec + 1800) return 'wont_arrive';
    if (remainingSec > hosRemainingSec) return 'tight';
    return null;
  }, [navigating, route, remainingSeconds, HOS_LIMIT_S, drivingSeconds]);

  const hosWarningColor = hosWarning === 'tight' ? '#FF9500' : '#FF3B30';
  const hosWarningLabel =
    hosWarning === 'break_required'
      ? t('hud.breakNow')
      : hosWarning === 'wont_arrive'
      ? t('hud.willNotArrive')
      : t('hud.watchTime');
  const speedCircleAnimatedStyle = useMemo(() => ({ backgroundColor: speedingBg }), [speedingBg]);
  const roadGradeCircleStyle = useMemo(() => ({
    borderColor: (roadGrade ?? 0) > 0 ? '#ff9500' : '#ff3b30',
  }), [roadGrade]);
  const hosWarningBorderStyle = useMemo(() => ({ borderLeftColor: hosWarningColor }), [hosWarningColor]);
  const hosWarningDotStyle = useMemo(() => ({ backgroundColor: hosWarningColor }), [hosWarningColor]);
  const startButtonFlexStyle = useMemo(() => ({ flex: navigating ? 0 : 2 }), [navigating]);

  if (!route && !navigating && speedLimit === null) return null;
  const speedRowStyle = compactOnly
    ? [styles.speedRow, { bottom: 96 + insets.bottom }]
    : [styles.speedRow, { bottom: 224 + insets.bottom, transform: [{ translateY }] }];

  return (
    <>
      {/* ── Bottom-left: HOS badge + speed + limit ── */}
      {(navigating || speedLimit != null) && (
        <Animated.View style={speedRowStyle}>
          <View>
            {!compactOnly && (
              <View style={[
                styles.hosBadge,
                drivingSeconds >= HOS_CONTINUOUS_WARN_10MIN_S && styles.hosBadgeWarn,
                drivingSeconds >= HOS_LIMIT_S && styles.hosBadgeLimit,
              ]}>
                <Text style={styles.hosBadgeLabel}>HOS</Text>
                <Text style={styles.hosBadgeValue}>{fmtHOS(drivingSeconds)}</Text>
              </View>
            )}
            <View style={hudStyles.speedRingWrap}>
              <View style={[
                styles.speedRing,
                speedLimit != null && speed > speedLimit
                  ? styles.speedRingRed
                  : speedLimit != null && speed > speedLimit - 10
                  ? styles.speedRingYellow
                  : styles.speedRingGreen,
              ]}>
                <Text style={[
                  styles.speedValue,
                  speedLimit != null && speed > speedLimit && styles.speedValueOverLimit
                ]}>
                  {speed}
                </Text>
                <Text style={styles.speedUnit}>{t('hud.speedUnit')}</Text>
              </View>
              {activeHgvNoOvertaking && (
                <View style={hudStyles.hgvNoOvertakingBadge} pointerEvents="none">
                  <Image source={ICON_NO_OVERTAKING} style={hudStyles.hgvNoOvertakingImage} />
                </View>
              )}
            </View>
            <TouchableOpacity
              style={[
                hudStyles.loadToggle,
                isLoaded ? hudStyles.loadToggleLoaded : hudStyles.loadToggleEmpty,
              ]}
              activeOpacity={0.82}
              onPress={() => setIsLoaded(!isLoaded)}
            >
              <Text style={hudStyles.loadToggleIcon}>{isLoaded ? '🚛📦' : '🚛'}</Text>
              <Text style={[
                hudStyles.loadToggleText,
                isLoaded ? hudStyles.loadToggleTextLoaded : hudStyles.loadToggleTextEmpty,
              ]}>
                {isLoaded ? '>20t' : 'Empty'}
              </Text>
            </TouchableOpacity>
            {bluetoothTacho?.connected && (
              <View style={[
                hudStyles.tachoLiveChip,
                tachoChipState === 'warning' && hudStyles.tachoLiveChipWarning,
                tachoChipState === 'critical' && hudStyles.tachoLiveChipCritical,
              ]}>
                <Text style={hudStyles.tachoLiveIcon}>🚛</Text>
                <View style={hudStyles.tachoLiveTextWrap}>
                  <Text
                    style={[
                      hudStyles.tachoLiveActivity,
                      tachoChipState === 'warning' && hudStyles.tachoLiveTextWarning,
                      tachoChipState === 'critical' && hudStyles.tachoLiveTextCritical,
                    ]}
                    numberOfLines={1}
                  >
                    {tachoActivityLabel}
                  </Text>
                  <Text
                    style={[
                      hudStyles.tachoLiveTime,
                      tachoChipState === 'warning' && hudStyles.tachoLiveTextWarning,
                      tachoChipState === 'critical' && hudStyles.tachoLiveTextCritical,
                    ]}
                  >
                    {tachoRemainingLabel}
                  </Text>
                </View>
              </View>
            )}
          </View>
          
          {!compactOnly && (
            <View style={styles.signColumn}>
              {speedLimit != null && (
                <Animated.View style={[
                  styles.speedCircle, 
                  speed > speedLimit && styles.speedCircleExceeded,
                  speedCircleAnimatedStyle,
                ]}>
                  <Text style={[styles.speedCircleNum, speed > speedLimit && hudStyles.speedLimitExceededText]}>{speedLimit}</Text>
                </Animated.View>
              )}

              {/* Road Grade Warning (Step D) */}
              {roadGrade != null && Math.abs(roadGrade) > 5 && (
                <View style={[styles.gradeCircle, roadGradeCircleStyle]}>
                  <Text style={styles.gradeEmoji}>{roadGrade > 0 ? '⛰️' : '📉'}</Text>
                  <Text style={styles.gradeVal}>{Math.abs(Math.round(roadGrade))}%</Text>
                </View>
              )}
            </View>
          )}
          {!compactOnly && nearestParkingM != null && (
            <View style={styles.parkingHudChip}>
              <Text style={styles.parkingHudText}>
                🅿️ {nearestParkingM < 1000
                  ? `${Math.round(nearestParkingM)}${t('units.meterShort')}`
                  : `${(nearestParkingM / 1000).toFixed(1)}${t('units.kilometerShort')}`}
              </Text>
            </View>
          )}
          {navigating && urgentParkingResults.length > 0 && (
            <TouchableOpacity
              style={hudStyles.urgentParkingBanner}
              activeOpacity={0.86}
              onPress={onUrgentParkingPress}
            >
              <Text style={hudStyles.urgentParkingText}>
                {t('hud.urgentParkingBanner', {
                  minutes: tachoRemainingMin ?? 20,
                  count: urgentParkingResults.length,
                })}
              </Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      )}

      {/* ManeuverPanel removed — pawan-pk native overlay already shows turn instructions at top */}

      {/* ── Bottom panel (swipeable sheet) ── */}
      {route && !loadingRoute && !compactOnly && (
        <Animated.View
          style={[styles.bottomPanel, { paddingBottom: insets.bottom + spacing.md, transform: [{ translateY }] }]}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (h > 0 && !initializedRef.current) {
              panelHeightRef.current = h;
              initializedRef.current = true;
              // Always start expanded — auto-collapse timer handles the rest
              translateY.setValue(0);
              expandedRef.current = true;
            } else if (h > 0) {
              panelHeightRef.current = h;
            }
          }}
          {...panResponder.panHandlers}
        >
          {/* Drag handle */}
          <View style={styles.sheetHandle} />
          {hosWarning && (
            <View style={[hudStyles.hosWarningBanner, hosWarningBorderStyle]}>
              <View style={[hudStyles.hosWarningDot, hosWarningDotStyle]} />
              <Text style={hudStyles.hosWarningText}>{hosWarningLabel}</Text>
            </View>
          )}
          <View style={styles.infoRow}>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>{t('hud.distance')}</Text>
              <Text style={styles.infoValue}>{fmtDistance(route.distance)}</Text>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>{t('hud.remaining')}</Text>
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
                  <Text style={styles.infoLabel}>{t('hud.arrival')}</Text>
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
                  Share.share({ message: t('hud.shareRoute', { destination: destinationName, url }) });
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
                <Text style={styles.truckDimText}>↕ {profile.height_m} {t('units.meterShort')}</Text>
              </View>
              <View style={styles.truckDimBadge}>
                <Text style={styles.truckDimText}>⚖ {profile.weight_t} {t('units.tonShort')}</Text>
              </View>
              <View style={styles.truckDimBadge}>
                <Text style={styles.truckDimText}>↔ {profile.width_m} {t('units.meterShort')}</Text>
              </View>
              <View style={styles.truckDimBadge}>
                <Text style={styles.truckDimText}>↔ {profile.length_m} {t('units.meterShort')}</Text>
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
                    ? `🔴 ${t('hud.congestionHeavy')}`
                    : dominantCongestion === 'moderate'
                    ? `🟡 ${t('hud.congestionModerate')}`
                    : `🟢 ${t('hud.congestionFree')}`}
                </Text>
              </View>
            </View>
          )}

          {/* Hill Warnings (Steep slopes ahead) */}
          {hillWarnings.length > 0 && (
            <View style={styles.congestionRow}>
              {hillWarnings.map((w, i) => (
                <View key={i} style={[styles.congestionChip, hudStyles.hillWarningChip]}>
                  <Text style={[styles.congestionText, hudStyles.hillWarningText]}>{w.text}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Route elevation profile mini bar chart */}
          {elevProfile.length > 1 && (
            <View style={styles.elevProfileStripHUD}>
              <Text style={styles.elevProfileLabelHUD}>
                ⛰ {t('hud.elevationRange', {
                  min: Math.round(Math.min(...elevProfile)),
                  max: Math.round(Math.max(...elevProfile)),
                })}
              </Text>
              <View style={styles.elevProfileBarsHUD}>
                {(() => {
                  const min = Math.min(...elevProfile);
                  const max = Math.max(...elevProfile);
                  return elevProfile.map((e, i) => {
                    const pct = max > min ? (e - min) / (max - min) : 0.5;
                    return <View key={i} style={[styles.elevBarHUD, { height: Math.max(4, pct * 28) }]} />;
                  });
                })()}
              </View>
            </View>
          )}

          {/* Weather strip along route */}
          {weatherPoints.length > 0 && (
            <View style={styles.weatherStripHUD}>
              {weatherPoints.map((wp, i) => (
                <View key={i} style={styles.weatherChipHUD}>
                  <Text style={styles.weatherPinEmoji}>{wp.emoji}</Text>
                  <Text style={styles.weatherPinTemp}>{wp.temp}°C</Text>
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
                    {departLabelText(label)}
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
                  <Icon name="map-marker-plus" size={14} color="#ff8c00" style={hudStyles.waypointAddIcon} />
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
                if (onOptimize) {
                  onOptimize();
                } else if (optimizeWaypointOrder && userCoords && setWaypoints && navigateTo && destination) {
                  const optimized = optimizeWaypointOrder(userCoords, waypoints);
                  setWaypoints(optimized);
                  navigateTo(destination, destinationName, optimized);
                }
              }}
            >
              <Text style={styles.optimizeBtnText}>⚡ {t('hud.optimizeStops')}</Text>
            </TouchableOpacity>
          )}

          <View style={hudStyles.actionRow}>
            {!navigating && (
              <TouchableOpacity
                style={[styles.startBtn, hudStyles.detailsButton]}
                onPress={() => {
                  if (onFetchElevation) onFetchElevation();
                  if (onFetchWeather) onFetchWeather();
                }}
                activeOpacity={0.8}
              >
                <Text style={[styles.startBtnText, hudStyles.detailsButtonText]}>📊 {t('hud.details')}</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[
                styles.startBtn,
                startButtonFlexStyle,
                navigating ? styles.startBtnActive : !userCoords ? styles.startBtnDisabled : null,
              ]}
              onPress={navigating ? onStop : onStart}
              activeOpacity={0.85}
              disabled={!navigating && !userCoords}
            >
              <Text style={styles.startBtnText}>
                {navigating
                  ? `🛑 ${t('hud.stopNavigation')}`
                  : `🚀 ${t('hud.startDriving')}`}
              </Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}
    </>
  );
});

const hudStyles = StyleSheet.create({
  speedLimitExceededText: {
    color: '#fff',
  },
  speedRingWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hgvNoOvertakingBadge: {
    position: 'absolute',
    right: -38,
    top: -8,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FF2D2D',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 12,
  },
  hgvNoOvertakingImage: {
    width: 58,
    height: 58,
    resizeMode: 'contain',
  },
  loadToggle: {
    alignSelf: 'center',
    minWidth: 76,
    marginTop: 6,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  loadToggleEmpty: {
    backgroundColor: 'rgba(120,130,145,0.16)',
    borderColor: 'rgba(180,190,205,0.42)',
  },
  loadToggleLoaded: {
    backgroundColor: 'rgba(255,149,0,0.18)',
    borderColor: 'rgba(255,149,0,0.75)',
  },
  loadToggleIcon: {
    fontSize: 12,
    lineHeight: 15,
  },
  loadToggleText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  loadToggleTextEmpty: {
    color: 'rgba(225,230,240,0.76)',
  },
  loadToggleTextLoaded: {
    color: '#FFB340',
  },
  tachoLiveChip: {
    alignSelf: 'center',
    marginTop: 6,
    minWidth: 104,
    maxWidth: 132,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    backgroundColor: 'rgba(5,10,18,0.82)',
    paddingHorizontal: 8,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  tachoLiveChipWarning: {
    borderColor: 'rgba(255,209,42,0.82)',
    backgroundColor: 'rgba(255,209,42,0.16)',
  },
  tachoLiveChipCritical: {
    borderColor: 'rgba(255,45,61,0.9)',
    backgroundColor: 'rgba(255,45,61,0.18)',
  },
  tachoLiveIcon: {
    fontSize: 13,
    lineHeight: 16,
  },
  tachoLiveTextWrap: {
    minWidth: 0,
  },
  tachoLiveActivity: {
    maxWidth: 86,
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
    lineHeight: 11,
  },
  tachoLiveTime: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 16,
    letterSpacing: 0.2,
  },
  tachoLiveTextWarning: {
    color: '#FFD12A',
  },
  tachoLiveTextCritical: {
    color: '#FF5A66',
  },
  urgentParkingBanner: {
    maxWidth: 230,
    marginLeft: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,209,42,0.78)',
    backgroundColor: 'rgba(25,18,5,0.92)',
    paddingHorizontal: 10,
    paddingVertical: 7,
    shadowColor: '#FFD12A',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  urgentParkingText: {
    color: '#FFD12A',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 15,
  },
  hillWarningChip: {
    backgroundColor: 'rgba(255,68,68,0.15)',
    borderColor: '#FF9500',
  },
  hillWarningText: {
    color: '#FF9500',
  },
  waypointAddIcon: {
    marginRight: 4,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  detailsButton: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: 'rgba(0,191,255,0.4)',
  },
  detailsButtonText: {
    fontSize: 16,
  },
  hosWarningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(20, 20, 30, 0.92)',
    borderRadius: 8,
    borderLeftWidth: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 4,
  },
  hosWarningDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  hosWarningText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
});

export default NavigationHUD;
