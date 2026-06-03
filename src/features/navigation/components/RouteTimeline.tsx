import React, { useState, memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, LayoutChangeEvent } from 'react-native';
import type { RoutePOI } from '../hooks/useRouteInsights';

type TrafficSegment = {
  startFraction: number;
  endFraction: number;
  level: 'low' | 'moderate' | 'heavy';
};

interface RouteTimelineProps {
  routeAheadPOIs: RoutePOI[];
  totalDistM: number;
  onPOIPress: (poi: RoutePOI) => void;
  trafficSegments?: TrafficSegment[];
}

const PIN_SIZE = 28;
const PIN_HALF = PIN_SIZE / 2;
const PIN_TOP_PAD = 10;

function logScale(km: number, maxKm: number): number {
  if (maxKm <= 0) return 0;
  // log1p(x) = ln(1+x), gives 0 at x=0 and grows slower as x increases
  return Math.min(1, Math.log1p(km) / Math.log1p(maxKm));
}

const RouteTimeline: React.FC<RouteTimelineProps> = memo(({
  routeAheadPOIs,
  totalDistM,
  onPOIPress,
  trafficSegments,
}) => {
  const [barHeight, setBarHeight] = useState(0);

  const handleLayout = (e: LayoutChangeEvent) => {
    setBarHeight(e.nativeEvent.layout.height);
  };

  const totalKm = totalDistM / 1000;
  if (totalKm <= 0) return null;

  // routeAheadPOIs is already filtered by route progress in useRouteInsights.
  const pins = routeAheadPOIs
    .map(poi => {
      const remainingKm = poi.distFromUserKm ?? poi.distKm;
      return { ...poi, remainingKm };
    })
    .filter(p => p.distKm > 0 && p.distKm <= totalKm && p.remainingKm >= 0)
    .sort((a, b) => a.remainingKm - b.remainingKm);

  const farthestVisibleKm = Math.max(1, ...pins.map(p => p.remainingKm));

  // Use nearest upcoming POI to infer route progress for the vertical track.
  const progressPct = (() => {
    if (pins.length === 0) return 0;
    const nearest = pins[0];
    const progressPct = logScale(
      nearest.distKm - nearest.remainingKm,
      farthestVisibleKm
    );
    return Math.min(1, Math.max(0, progressPct));
  })();

  return (
    <View style={styles.container}>
      {/* Destination flag at top */}
      <Text style={styles.finishFlag}>🏁</Text>

      {/* Vertical track */}
      <View style={styles.lineTrack} onLayout={handleLayout}>
        {/* Vertical line */}
        <View style={styles.verticalLine} />

        {/* Traveled portion — grows from bottom */}
        <View style={[styles.lineTraveled, { height: `${progressPct * 100}%` }]} />

        {barHeight > 0 && (trafficSegments ?? []).map((seg, i) => {
          const topFraction = 1 - seg.endFraction;
          const heightFraction = seg.endFraction - seg.startFraction;
          const color = seg.level === 'heavy' ? '#FF3B30' : '#FF9500';
          return (
            <View
              key={`traffic-${i}`}
              style={{
                position: 'absolute',
                top: topFraction * barHeight,
                left: 6,
                width: 3,
                height: Math.max(4, heightFraction * barHeight),
                backgroundColor: color,
                borderRadius: 2,
                opacity: 0.85,
              }}
            />
          );
        })}

        {/* POI pins positioned along the track */}
        {barHeight > 0 && pins.map((poi, i) => {
          // The route can be thousands of km, so the side rail shows the next
          // visible stops, not the full-route scale. This keeps nearby fuel and
          // parking readable instead of pinned under the bottom HUD.
          const pct = pins.length === 1
            ? 0.5
            : logScale(poi.remainingKm, farthestVisibleKm);
          const usableHeight = Math.max(0, barHeight - PIN_SIZE - PIN_TOP_PAD * 2);
          const top = PIN_TOP_PAD + (1 - pct) * usableHeight;
          const isFuel = poi.type === 'fuel';
          return (
            <TouchableOpacity
              key={i}
              style={[styles.pin, isFuel ? styles.pinFuel : styles.pinParking, { top }]}
              onPress={() => onPOIPress(poi)}
              activeOpacity={0.7}
            >
              <Text style={styles.pinIcon}>{isFuel ? '⛽' : 'P'}</Text>
              {/* Label to the left */}
              <View style={styles.labelBubble}>
                <Text style={styles.labelText}>{poi.remainingKm}km</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Total distance label at bottom */}
      <Text style={styles.totalLabel}>{Math.round(totalKm)}{'\n'}km</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 15,
    top: '20%',
    bottom: '30%',
    width: 40,
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.30)',
    borderRadius: 20,
    paddingVertical: 10,
    zIndex: 30,
    elevation: 20,
  },
  finishFlag: {
    fontSize: 16,
    zIndex: 3,
  },
  lineTrack: {
    flex: 1,
    width: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 2,
    position: 'relative',
    marginHorizontal: PIN_HALF,
    marginVertical: 4,
  },
  verticalLine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 2,
  },
  lineTraveled: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#00D1FF',
    borderRadius: 2,
  },
  pin: {
    position: 'absolute',
    left: -(PIN_SIZE / 2) - 2,
    width: PIN_SIZE,
    height: PIN_SIZE,
    borderRadius: PIN_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    zIndex: 2,
  },
  pinFuel: {
    backgroundColor: '#1A1A2E',
    borderColor: '#FF9500',
  },
  pinParking: {
    backgroundColor: '#1A1A2E',
    borderColor: '#00BFFF',
  },
  pinIcon: {
    fontSize: 12,
    lineHeight: 14,
  },
  labelBubble: {
    position: 'absolute',
    right: PIN_SIZE + 4,
    backgroundColor: 'rgba(0,0,0,0.80)',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    minWidth: 36,
    alignItems: 'center',
  },
  labelText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
  },
  totalLabel: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 9,
    fontWeight: '600',
    textAlign: 'center',
  },
});

export default RouteTimeline;
