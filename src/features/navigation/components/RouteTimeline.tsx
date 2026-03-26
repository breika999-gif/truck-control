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
  const [barWidth, setBarWidth] = useState(0);

  const handleLayout = (e: LayoutChangeEvent) => {
    setBarWidth(e.nativeEvent.layout.width);
  };

  const totalKm = totalDistM / 1000;

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

  // Progress: how far along the bar we are
  const traveledKm = totalKm - (pins[0]?.remainingKm ?? totalKm);
  const progressPct = Math.min(1, Math.max(0, traveledKm / totalKm));

  return (
    <View style={styles.container}>
      {/* Route line */}
      <View style={styles.lineTrack} onLayout={handleLayout}>
        {/* Traveled portion */}
        <View style={[styles.lineTraveled, { width: `${progressPct * 100}%` }]} />

        {/* POI pins */}
        {barWidth > 0 && pins.map((poi, i) => {
          const pct = poi.distKm / totalKm;
          const left = pct * barWidth - PIN_HALF;
          const isFuel = poi.type === 'fuel';
          return (
            <TouchableOpacity
              key={i}
              style={[styles.pin, isFuel ? styles.pinFuel : styles.pinParking, { left }]}
              onPress={() => onPOIPress(poi)}
              activeOpacity={0.7}
            >
              <Text style={styles.pinIcon}>{isFuel ? '⛽' : 'P'}</Text>
              <View style={styles.labelBubble}>
                <Text style={styles.labelText}>{poi.remainingKm}km</Text>
              </View>
            </TouchableOpacity>
          );
        })}

        {/* Destination flag */}
        {barWidth > 0 && (
          <View style={[styles.destPin, { left: barWidth - PIN_HALF }]}>
            <Text style={styles.destIcon}>🏁</Text>
          </View>
        )}
      </View>

      {/* Total distance label */}
      <Text style={styles.totalLabel}>{Math.round(totalKm)} km</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 310,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 30,
    elevation: 20,
  },
  lineTrack: {
    flex: 1,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 2,
    position: 'relative',
    marginVertical: PIN_SIZE,
  },
  lineTraveled: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: 4,
    backgroundColor: '#00BFFF',
    borderRadius: 2,
  },
  pin: {
    position: 'absolute',
    top: -(PIN_SIZE / 2) - 1,
    width: PIN_SIZE,
    height: PIN_SIZE,
    borderRadius: PIN_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  pinFuel: {
    backgroundColor: '#1A1A2E',
    borderColor: '#FFBC40',
  },
  pinParking: {
    backgroundColor: '#1A1A2E',
    borderColor: '#00BFFF',
  },
  pinIcon: {
    fontSize: 13,
    lineHeight: 14,
  },
  labelBubble: {
    position: 'absolute',
    top: PIN_SIZE + 2,
    backgroundColor: 'rgba(0,0,0,0.75)',
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
  destPin: {
    position: 'absolute',
    top: -(PIN_SIZE / 2) - 1,
    width: PIN_SIZE,
    height: PIN_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  destIcon: {
    fontSize: 18,
  },
  totalLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
    marginLeft: 8,
    fontWeight: '600',
  },
});

export default RouteTimeline;
