import React from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

interface HGVSpeedSignProps {
  speedKmh: number;
  distanceM: number;
  isCurrent?: boolean;
}

function formatDistance(distanceM: number): string {
  if (distanceM < 1000) {
    return `${Math.round(distanceM / 10) * 10} м`;
  }
  return `${(distanceM / 1000).toFixed(1)} км`;
}

const HGVSpeedSign: React.FC<HGVSpeedSignProps> = ({
  speedKmh,
  distanceM,
  isCurrent = false,
}) => {
  const fadeAnim = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim, speedKmh]);

  const animatedStyle = React.useMemo(
    () => ({ opacity: fadeAnim }),
    [fadeAnim],
  );

  return (
    <Animated.View style={[speedStyles.wrap, animatedStyle]}>
      {!isCurrent && (
        <View style={speedStyles.badge}>
          <Text style={speedStyles.badgeText}>{formatDistance(distanceM)}</Text>
        </View>
      )}
      <View style={speedStyles.sign}>
        <Text style={speedStyles.speedText}>{speedKmh}</Text>
      </View>
    </Animated.View>
  );
};

const speedStyles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 80,
    right: 12,
    zIndex: 50,
    alignItems: 'center',
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
  },
  badge: {
    minWidth: 54,
    borderRadius: 999,
    backgroundColor: '#D70F18',
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 4,
    alignItems: 'center',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 14,
  },
  sign: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 7,
    borderColor: '#D70F18',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedText: {
    color: '#050505',
    fontSize: 29,
    fontWeight: '900',
    lineHeight: 34,
  },
});

export default React.memo(HGVSpeedSign);
