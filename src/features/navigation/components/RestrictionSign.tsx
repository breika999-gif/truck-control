import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet, Image } from 'react-native';
import type { RestrictionPoint } from '../api/directions';

interface Props {
  restriction: RestrictionPoint | null;
  vehicleProfile?: { height_m: number; weight_t: number; width_m: number } | null;
}

const ICONS = {
  maxheight: {
    normal: require('../../../../android/app/src/main/res/raw/restriction_height.png'),
    exceed: require('../../../../android/app/src/main/res/raw/restriction_height_exceed.png'),
    unit: 'м',
  },
  maxweight: {
    normal: require('../../../../android/app/src/main/res/raw/restriction_weight.png'),
    exceed: require('../../../../android/app/src/main/res/raw/restriction_weight_exceed.png'),
    unit: 'т',
  },
  maxwidth: {
    normal: require('../../../../android/app/src/main/res/raw/restriction_width.png'),
    exceed: require('../../../../android/app/src/main/res/raw/restriction_width_exceed.png'),
    unit: 'м',
  },
  no_trucks: {
    normal: require('../../../../android/app/src/main/res/raw/restriction_no_trucks.png'),
    exceed: require('../../../../android/app/src/main/res/raw/restriction_no_trucks_violated.png'),
    unit: '',
  },
  adr: {
    normal: require('../../../../android/app/src/main/res/raw/restriction_adr.png'),
    exceed: require('../../../../android/app/src/main/res/raw/restriction_adr_exceed.png'),
    unit: '',
  },
} as const;

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
  }, [opacity, restriction?.lat, restriction?.lng]);

  if (!restriction) return null;

  const exceeded = isExceeded(restriction, vehicleProfile);
  const accent = exceeded ? '#FF6B00' : '#D0021B';
  const iconMeta = ICONS[restriction.type] ?? ICONS.no_trucks;
  const iconSource = exceeded ? iconMeta.exceed : iconMeta.normal;

  return (
    <Animated.View style={[s.wrap, { opacity }]}>
      <View style={[s.sign, { borderColor: accent }]}>
        <Image source={iconSource} style={s.icon} resizeMode="contain" />
        <Text style={s.value}>{restriction.value_num}</Text>
        <Text style={s.unit}>{iconMeta.unit}</Text>
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
  icon: {
    width: 40,
    height: 40,
    marginBottom: -2,
  },
  value: {
    fontSize: 18,
    fontWeight: '900',
    color: '#1A1A1A',
    lineHeight: 20,
    marginTop: -1,
  },
  unit: {
    fontSize: 9,
    fontWeight: '600',
    color: '#555',
    marginTop: 1,
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
