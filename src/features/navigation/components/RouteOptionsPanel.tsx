import React, { memo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import type { EdgeInsets } from 'react-native-safe-area-context';
import { fmtDistance, fmtDuration } from '../api/directions';
import { styles, NEON } from '../screens/MapScreen.styles';
import type { RouteOption } from '../../../shared/services/backendApi';

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
}

const RouteOptionsPanel: React.FC<RouteOptionsPanelProps> = ({
  routeOptions,
  selectedRouteIdx,
  routeOptDest,
  restrictionChecking,
  restrictionWarnings,
  insets,
  onSelectRoute,
  onDismiss,
  onStart,
}) => {
  return (
    <View style={[styles.routeOptionsPanel, { bottom: insets.bottom + 16 }]}>
      {/* Liquid Glass top highlight line */}
      <View style={styles.routeOptionsGlassHighlight} />
      <View style={styles.routeOptionsHeader}>
        <Text style={styles.routeOptionsTitle}>🗺️ Изберете маршрут</Text>
        <TouchableOpacity
          onPress={onDismiss}
          style={styles.parkingDismissBtn}
        >
          <Text style={styles.parkingDismissTxt}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Cards row */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.routeOptionsContent}
      >
        {routeOptions.map((opt, i) => {
          const isSelected = selectedRouteIdx === i;
          const trafficEmoji =
            opt.traffic === 'heavy' ? '🔴' : opt.traffic === 'moderate' ? '🟡' : opt.traffic === 'low' ? '🟢' : null;
          const minDur = Math.min(...routeOptions.map(o => o.duration));
          const diffMin = Math.round((opt.duration - minDur) / 60);
          const diffBadge = diffMin === 0 ? '⚡ Най-бърз' : `+${diffMin} мин`;
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
              {!isSelected && <Text style={styles.routeOptionTap}>Натисни →</Text>}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Restrictions + Start button */}
      {selectedRouteIdx !== null && (
        <View style={styles.routeSelectedSummary}>
          {restrictionChecking && (
            <ActivityIndicator size="small" color={NEON} style={{ alignSelf: 'center' }} />
          )}
          {restrictionWarnings.map((w, i) => (
            <Text key={i} style={styles.routeRestrictionWarn}>{w}</Text>
          ))}
          <TouchableOpacity
            style={styles.routeStartBtn}
            activeOpacity={0.85}
            onPress={() => {
              const selIdx = selectedRouteIdx ?? 0;
              const selOpt = routeOptions[selIdx];
              onStart(selOpt?.congestion_geojson, selOpt?.traffic_alerts);
            }}
          >
            <Text style={styles.routeStartBtnTxt}>🚀 Старт</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

export default memo(RouteOptionsPanel);
