import React, { memo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import type { EdgeInsets } from 'react-native-safe-area-context';
import { fmtDistance, fmtDuration } from '../api/directions';
import { styles, NEON } from '../screens/MapScreen.styles';
import type { RouteOption } from '../../../shared/services/backendApi';
import { buildRouteExplanation, type ExplanationBullet } from '../utils/routeExplanation';

interface RouteOptionsPanelProps {
  routeOptions: RouteOption[];
  selectedRouteIdx: number | null;
  routeOptDest: { coords: [number, number]; name: string; waypoints?: [number, number][] } | null;
  restrictionChecking: boolean;
  restrictionWarnings: string[];
  insets: EdgeInsets;
  onSelectRoute: (idx: number) => void;
  onDismiss: () => void;
  onStart: (
    congestionGeoJSON: any,
    trafficAlerts: any
  ) => void;
  /** Current driven seconds this HOS session */
  drivingSeconds?: number;
  /** EU HOS continuous driving limit in seconds (default 16200 = 4.5h) */
  hosLimitS?: number;
  /** Called when user taps "Export GPX" */
  onExportGPX?: () => void;
}

/** Returns how many minutes remain before the driver must take a break. */
function remainingTachoMin(drivingSeconds: number, hosLimitS: number): number {
  return Math.max(0, Math.floor((hosLimitS - drivingSeconds) / 60));
}

const TRUCK_SPEED_CAP_KMH = 90;

function truckCappedRouteMin(distanceM: number, durationS: number): number {
  const distanceKm = distanceM / 1000;
  const cappedMin = (distanceKm / TRUCK_SPEED_CAP_KMH) * 60;
  return Math.max(durationS / 60, cappedMin);
}

function truckBreakDistanceKm(distanceM: number, tachoRemMin: number, effectiveRouteMin: number): number {
  if (effectiveRouteMin <= 0) return 0;
  return Math.round((distanceM / 1000) * Math.min(1, tachoRemMin / effectiveRouteMin));
}

function whyBulletTextStyle(bullet: ExplanationBullet) {
  if (bullet.positive) return routePanelStyles.whyBulletPositive;
  if (bullet.icon === '🔴' || bullet.icon === '🚫') return routePanelStyles.whyBulletCritical;
  return routePanelStyles.whyBulletWarning;
}

const RouteOptionsPanel: React.FC<RouteOptionsPanelProps> = ({
  routeOptions,
  selectedRouteIdx,
  routeOptDest: _routeOptDest,
  restrictionChecking,
  restrictionWarnings,
  insets,
  onSelectRoute,
  onDismiss,
  onStart,
  drivingSeconds,
  hosLimitS,
  onExportGPX,
}) => {
  const effectiveSelectedRouteIdx = selectedRouteIdx ?? (routeOptions.length > 0 ? 0 : null);
  const [whyOpen, setWhyOpen] = React.useState(false);
  const selectedOption = effectiveSelectedRouteIdx !== null
    ? routeOptions[effectiveSelectedRouteIdx]
    : undefined;
  const whyBullets = React.useMemo(
    () => selectedOption ? buildRouteExplanation(selectedOption, routeOptions) : [],
    [routeOptions, selectedOption],
  );
  const tachoEnabled = drivingSeconds !== undefined && hosLimitS !== undefined;

  React.useEffect(() => {
    setWhyOpen(false);
  }, [effectiveSelectedRouteIdx]);

  return (
    <View style={[styles.routeOptionsPanel, { bottom: insets.bottom + 16 }]}>
      {/* Liquid Glass top highlight line */}
      <View style={styles.routeOptionsGlassHighlight} />
      <View style={styles.routeOptionsHeader}>
        <Text style={styles.routeOptionsTitle}>🗺️ Изберете маршрут</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {onExportGPX && (
            <TouchableOpacity onPress={onExportGPX} style={styles.parkingDismissBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[styles.parkingDismissTxt, { fontSize: 16 }]}>📤</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={onDismiss}
            style={styles.parkingDismissBtn}
          >
            <Text style={styles.parkingDismissTxt}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Cards row */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.routeOptionsContent}
      >
        {routeOptions.map((opt, i) => {
          const isSelected = effectiveSelectedRouteIdx === i;
          const trafficEmoji =
            opt.traffic === 'heavy' ? '🔴' : opt.traffic === 'moderate' ? '🟡' : opt.traffic === 'low' ? '🟢' : null;
          const minDur = Math.min(...routeOptions.map(o => o.duration));
          const diffMin = Math.round((opt.duration - minDur) / 60);
          const diffBadge = diffMin === 0 ? '⚡ Най-бърз' : `+${diffMin} мин`;

          // "Мога ли да стигна?" per-card tacho check
          const tachoRemMin = tachoEnabled ? remainingTachoMin(drivingSeconds!, hosLimitS!) : null;
          const effectiveRouteMin = truckCappedRouteMin(opt.distance, opt.duration);
          const routeDurMin = Math.ceil(effectiveRouteMin);
          const canMakeIt = tachoRemMin === null || routeDurMin <= tachoRemMin;
          const shortageMin = tachoRemMin !== null ? routeDurMin - tachoRemMin : 0;
          // Distance until forced break, capped to realistic truck speed.
          const breakDistKm = tachoRemMin !== null && !canMakeIt
            ? truckBreakDistanceKm(opt.distance, tachoRemMin, effectiveRouteMin)
            : null;

          return (
            <TouchableOpacity
              key={i}
              style={[
                styles.routeOptionCard,
                { borderColor: opt.color },
                isSelected && styles.routeOptionCardSelected,
              ]}
              activeOpacity={0.8}
              onPress={() => onSelectRoute(i)}
            >
              <View style={[styles.routeOptionDot, { backgroundColor: opt.color }]} />
              {/* Diff badge — "⚡ Най-бърз" or "+20 мин" */}
              <Text style={[
                styles.routeOptionDiff,
                { color: diffMin === 0 ? '#4cff91' : '#ffcc00' },
              ]}>{diffBadge}</Text>
              <Text style={styles.routeOptionLabel} numberOfLines={3}>{opt.label}</Text>
              <Text style={styles.routeOptionDist}>{fmtDistance(opt.distance)}</Text>
              <Text style={styles.routeOptionDur}>{fmtDuration(opt.duration)}</Text>
              {trafficEmoji && (
                <Text style={styles.routeOptionTraffic}>
                  {trafficEmoji} {opt.traffic === 'heavy' ? 'Задръстване' : opt.traffic === 'moderate' ? 'Умерено' : 'Свободно'}
                </Text>
              )}

              {/* Tacho feasibility badge */}
              {tachoRemMin !== null && (
                canMakeIt ? (
                  <Text style={{ fontSize: 10, color: '#4cff91', fontWeight: '700', marginTop: 4 }}>
                    ✅ Стигаш ({tachoRemMin - routeDurMin} мин резерв)
                  </Text>
                ) : (
                  <Text style={{ fontSize: 10, color: '#FF3B30', fontWeight: '700', marginTop: 4 }}>
                    ⏱ Пауза след ~{breakDistKm} км
                  </Text>
                )
              )}

              {!isSelected && <Text style={styles.routeOptionTap}>Натисни →</Text>}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Restrictions + Start button */}
      {effectiveSelectedRouteIdx !== null && (
        <View style={styles.routeSelectedSummary}>
          {selectedOption && (
            <View style={routePanelStyles.whyWrap}>
              <TouchableOpacity
                style={routePanelStyles.whyButton}
                activeOpacity={0.8}
                onPress={() => setWhyOpen(open => !open)}
              >
                <Text style={routePanelStyles.whyButtonText}>
                  ℹ️ Защо този маршрут?
                </Text>
              </TouchableOpacity>

              {whyOpen && (
                <View style={routePanelStyles.whyPanel}>
                  {whyBullets.map((bullet, index) => (
                    <Text
                      key={`${bullet.icon}-${bullet.text}-${index}`}
                      style={[routePanelStyles.whyBulletText, whyBulletTextStyle(bullet)]}
                      numberOfLines={1}
                    >
                      {bullet.icon} {bullet.text}
                    </Text>
                  ))}
                </View>
              )}
            </View>
          )}

          {restrictionChecking && (
            <ActivityIndicator size="small" color={NEON} style={{ alignSelf: 'center' }} />
          )}
          {restrictionWarnings.map((w, i) => (
            <Text key={i} style={styles.routeRestrictionWarn}>{w}</Text>
          ))}

          {/* "Мога ли да стигна?" summary for selected route */}
          {(() => {
            if (!tachoEnabled) return null;
            const selOpt = routeOptions[effectiveSelectedRouteIdx];
            if (!selOpt) return null;
            const tachoRemMin = remainingTachoMin(drivingSeconds!, hosLimitS!);
            const effectiveRouteMin = truckCappedRouteMin(selOpt.distance, selOpt.duration);
            const routeDurMin = Math.ceil(effectiveRouteMin);
            if (routeDurMin <= tachoRemMin) return null; // all good, no warning needed

            const shortageMin = routeDurMin - tachoRemMin;
            const breakDistKm = truckBreakDistanceKm(selOpt.distance, tachoRemMin, effectiveRouteMin);

            return (
              <View style={{
                backgroundColor: 'rgba(255,59,48,0.15)',
                borderRadius: 8,
                padding: 8,
                marginBottom: 4,
                borderLeftWidth: 3,
                borderLeftColor: '#FF3B30',
              }}>
                <Text style={{ color: '#FF3B30', fontWeight: '700', fontSize: 12 }}>
                  ⏱ Не стигаш без пауза
                </Text>
                <Text style={{ color: '#ffccc0', fontSize: 11, marginTop: 2 }}>
                  Остават ти {tachoRemMin} мин, маршрутът е {routeDurMin} мин (+{shortageMin} мин)
                </Text>
                <Text style={{ color: '#ffccc0', fontSize: 11 }}>
                  Задължителна пауза след ~{breakDistKm} км
                </Text>
              </View>
            );
          })()}

          {/* Traffic delay + Start button */}
          {(() => {
            const selOpt = routeOptions[effectiveSelectedRouteIdx];
            const totalDelay = selOpt?.traffic_alerts?.reduce((acc, a) => acc + (a.delay_min || 0), 0) || 0;

            return (
              <View style={{ alignItems: 'center', gap: 4 }}>
                <TouchableOpacity
                  style={styles.routeStartBtn}
                  activeOpacity={0.85}
                  onPress={() => {
                    onStart(selOpt?.congestion_geojson, selOpt?.traffic_alerts);
                  }}
                >
                  <Text style={styles.routeStartBtnTxt}>🚀 Тръгни</Text>
                </TouchableOpacity>

                {totalDelay > 0 && (
                  <Text style={{
                    fontSize: 11,
                    fontWeight: '700',
                    color: totalDelay >= 15 ? '#FF3B30' : '#FF9500',
                    textShadowColor: 'rgba(0,0,0,0.5)',
                    textShadowOffset: { width: 0, height: 1 },
                    textShadowRadius: 2,
                  }}>
                    ⚠️ Трафик +{totalDelay} мин
                  </Text>
                )}
              </View>
            );
          })()}
        </View>
      )}
    </View>
  );
};

const routePanelStyles = StyleSheet.create({
  whyWrap: {
    marginBottom: 6,
  },
  whyButton: {
    alignSelf: 'flex-end',
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  whyButtonText: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 11,
    fontWeight: '800',
  },
  whyPanel: {
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 8,
    padding: 8,
    marginTop: 2,
    gap: 4,
  },
  whyBulletText: {
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 15,
  },
  whyBulletPositive: {
    color: '#4cff91',
  },
  whyBulletWarning: {
    color: '#FF9500',
  },
  whyBulletCritical: {
    color: '#FF3B30',
  },
});

export default memo(RouteOptionsPanel);
