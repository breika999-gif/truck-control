import React from 'react';
import { Animated, Dimensions, StyleSheet, View } from 'react-native';
import { NAV_PADDING } from '../utils/mapUtils';

const SCREEN_W = Dimensions.get('window').width;

interface Props {
  visible: boolean;
  situationKind: string;
  anyExceeded?: boolean;
}

function arrowColor(kind: string, anyExceeded?: boolean): string {
  if (kind === 'composite_restriction' && anyExceeded) return '#FF3B30';
  if (kind === 'composite_restriction') return '#FF9500';
  if (kind === 'tacho_break') return '#FF9500';
  return '#00BFFF';
}

const NavigationArrow: React.FC<Props> = ({
  visible,
  situationKind,
  anyExceeded = false,
}) => {
  const pulse = React.useRef(new Animated.Value(0)).current;
  const color = arrowColor(situationKind, anyExceeded);

  React.useEffect(() => {
    if (!visible) {
      pulse.setValue(0);
      return undefined;
    }

    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );

    anim.start();
    return () => anim.stop();
  }, [visible, pulse]);

  const ringScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.9],
  });
  const ringOpacity = pulse.interpolate({
    inputRange: [0, 0.3, 1],
    outputRange: [0.4, 0.22, 0],
  });

  const ringStyle = React.useMemo(
    () => [
      styles.ring,
      {
        borderColor: color,
        opacity: ringOpacity,
        transform: [{ scale: ringScale }],
      },
    ],
    [color, ringOpacity, ringScale],
  );
  const triangleStyle = React.useMemo(
    () => [styles.triangle, { borderBottomColor: color }],
    [color],
  );
  const bodyStyle = React.useMemo(
    () => [styles.body, { backgroundColor: color }],
    [color],
  );
  const glowStyle = React.useMemo(
    () => [styles.glow, { backgroundColor: color }],
    [color],
  );

  if (!visible) return null;

  return (
    <View pointerEvents="none" style={styles.wrap}>
      <Animated.View style={ringStyle} />
      <View style={glowStyle} />
      <View style={triangleStyle} />
      <View style={bodyStyle} />
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: SCREEN_W / 2 - 15,
    top: NAV_PADDING.paddingTop - 42,
    width: 30,
    height: 42,
    zIndex: 100,
    elevation: 40,
    alignItems: 'center',
  },
  ring: {
    position: 'absolute',
    left: -7,
    top: 2,
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
  },
  glow: {
    position: 'absolute',
    top: 8,
    width: 30,
    height: 30,
    borderRadius: 15,
    opacity: 0.18,
  },
  triangle: {
    width: 0,
    height: 0,
    borderLeftWidth: 15,
    borderRightWidth: 15,
    borderBottomWidth: 26,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  body: {
    width: 18,
    height: 14,
    borderBottomLeftRadius: 5,
    borderBottomRightRadius: 5,
    marginTop: -1,
  },
});

export default React.memo(NavigationArrow);
