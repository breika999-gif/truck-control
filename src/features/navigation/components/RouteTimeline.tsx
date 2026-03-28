import React, { useState, memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, LayoutChangeEvent } from 'react-native';
import type { RoutePOI } from '../hooks/useRouteInsights';
import { haversineMeters } from '../utils/mapUtils';

interface RouteTimelineProps {
  routeAheadPOIs: RoutePOI[];
  totalDistM: number;
  userCoords: [number, number] | null;
  onPOIPress: (poi: RoutePOI) => void;
}

const PIN_SIZE = 28;
const PIN_HALF = PIN_SIZE / 2;

const RouteTimeline: React.FC<RouteTimelineProps> = memo(({
  routeAheadPOIs,
  totalDistM,
  userCoords,
  onPOIPress,
}) => {
  const [barHeight, setBarHeight] = useState(0);

  const handleLayout = (e: LayoutChangeEvent) => {
    setBarHeight(e.nativeEvent.layout.height);
  };

  const totalKm = totalDistM / 1000;
  if (totalKm <= 0) return null;

  // Filter POIs and calculate live km-remaining from user position
  const pins = routeAheadPOIs
    .map(poi => {
      const remainingKm = userCoords
        ? Math.round(haversineMeters(userCoords, [poi.lng, poi.lat]) / 1000)
        : poi.distKm;
      return { ...poi, remainingKm };
    })
    .filter(p => p.remainingKm > 0 && p.distKm <= totalKm)
    .sort((a, b) => a.distKm - b.distKm);

  // Progress: traveled portion (top = destination, bottom = origin)
  const traveledKm = totalKm - (pins[0]?.remainingKm ?? totalKm);
  const progressPct = Math.min(1, Math.max(0, traveledKm / totalKm));

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

        {/* POI pins positioned along the track */}
        {barHeight > 0 && pins.map((poi, i) => {
          // pct=0 → bottom (origin), pct=1 → top (dest)
          const pct = poi.distKm / totalKm;
          // top = (1 - pct) * barHeight so pct=1 is at top
          const top = (1 - pct) * barHeight - PIN_HALF;
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
    top: '15%',
    bottom: '25%',
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
