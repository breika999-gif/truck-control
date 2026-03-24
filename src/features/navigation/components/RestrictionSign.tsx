import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import type { RestrictionPoint } from '../api/directions';

interface Props {
  restriction: RestrictionPoint | null;
}

const LABEL: Record<string, string> = {
  maxheight: '↕',
  maxweight: '⚖',
  maxwidth:  '↔',
};

const UNIT: Record<string, string> = {
  maxheight: 'м',
  maxweight: 'т',
  maxwidth:  'м',
};

const RestrictionSign: React.FC<Props> = ({ restriction }) => {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (restriction) {
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.delay(6000),
        Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]).start();
    } else {
      opacity.setValue(0);
    }
  }, [restriction?.lat, restriction?.lng]);

  if (!restriction) return null;

  const icon  = LABEL[restriction.type] ?? '⚠';
  const unit  = UNIT[restriction.type]  ?? '';
  const label = `${icon} ${restriction.value_num}${unit}`;

  return (
    <Animated.View style={[s.wrap, { opacity }]}>
      <View style={s.sign}>
        <Text style={s.label}>{label}</Text>
      </View>
      <View style={s.triangle} />
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
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#FFFFFF',
    borderWidth: 6,
    borderColor: '#D0021B',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1A1A1A',
    textAlign: 'center',
  },
  triangle: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor:  'transparent',
    borderRightColor: 'transparent',
    borderTopColor:   '#D0021B',
    marginTop: -1,
  },
});

export default RestrictionSign;
