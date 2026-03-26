import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import type { RestrictionPoint } from '../api/directions';

interface Props {
  restriction: RestrictionPoint | null;
}

// type → { top label, unit }
const SIGN_META: Record<string, { top: string; unit: string }> = {
  maxheight: { top: 'ВИСОЧИНА', unit: 'м' },
  maxweight: { top: 'ТЕГЛО',    unit: 'т' },
  maxwidth:  { top: 'ШИРИНА',   unit: 'м' },
};

const RestrictionSign: React.FC<Props> = ({ restriction }) => {
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

  return (
    <Animated.View style={[s.wrap, { opacity }]}>
      <View style={s.sign}>
        {/* small type label at top */}
        <Text style={s.typeLabel}>{meta.top}</Text>
        {/* big value */}
        <Text style={s.value}>{restriction.value_num}</Text>
        {/* unit */}
        <Text style={s.unit}>{meta.unit}</Text>
      </View>
      <View style={s.pin} />
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
