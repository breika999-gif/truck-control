import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import type { RestrictionPoint } from '../api/directions';

interface Props {
  restriction: RestrictionPoint | null;
  vehicleProfile?: { height_m: number; weight_t: number; width_m: number } | null;
}

// type -> { top label, unit }
const SIGN_META: Record<string, { top: string; unit: string }> = {
  maxheight: { top: 'ВИСОЧИНА', unit: 'м' },
  maxweight: { top: 'ТЕГЛО',    unit: 'т' },
  maxwidth:  { top: 'ШИРИНА',   unit: 'м' },
};

function isExceeded(
  restriction: RestrictionPoint | null,
  profile?: { height_m: number; weight_t: number; width_m: number } | null,
): boolean {
  if (!restriction || !profile) return false;
  if (restriction.type === 'maxheight') return profile.height_m > restriction.value_num;
  if (restriction.type === 'maxweight') return profile.weight_t > restriction.value_num;
  if (restriction.type === 'maxwidth') return profile.width_m > restriction.value_num;
  return false;
}

const RestrictionSign: React.FC<Props> = ({ restriction, vehicleProfile }) => {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (restriction) {
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.delay(7000),
        Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]).start();
    } else {
      opacity.setValue(0);
    }
  }, [restriction?.lat, restriction?.lng]);

  if (!restriction) return null;

  const meta = SIGN_META[restriction.type] ?? { top: 'ЛИМИТ', unit: '' };
  const exceeded = isExceeded(restriction, vehicleProfile);
  const accent = exceeded ? '#FF6B00' : '#D0021B';

  return (
    <Animated.View style={[s.wrap, { opacity }]}>
      <View style={[s.sign, { borderColor: accent }]}>
        {/* small type label at top */}
        <Text style={[s.typeLabel, { color: accent }]}>{meta.top}</Text>
        {/* big value */}
        <Text style={s.value}>{restriction.value_num}</Text>
        {/* unit */}
        <Text style={s.unit}>{meta.unit}</Text>
        {exceeded ? <Text style={s.warning}>{'\u26A0'}</Text> : null}
      </View>
      <View style={[s.pin, { backgroundColor: accent }]} />
    </Animated.View>
  );
};

const s = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 80,
    right: 12,
    alignItems: 'center',
    zIndex: 50,
  },
  sign: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#FFFFFF',
    borderWidth: 7,
    borderColor: '#D0021B',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 5,
  },
  typeLabel: {
    fontSize: 8,
    fontWeight: '700',
    color: '#D0021B',
    letterSpacing: 0.5,
    marginBottom: 1,
  },
  value: {
    fontSize: 22,
    fontWeight: '900',
    color: '#1A1A1A',
    lineHeight: 24,
  },
  unit: {
    fontSize: 9,
    fontWeight: '600',
    color: '#555',
    marginTop: 1,
  },
  warning: {
    fontSize: 10,
    color: '#FF6B00',
    marginTop: 1,
    lineHeight: 10,
  },
  pin: {
    width: 3,
    height: 10,
    backgroundColor: '#D0021B',
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
    marginTop: -1,
  },
});

export default RestrictionSign;
