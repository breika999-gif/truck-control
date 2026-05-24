/**
 * LaneArrow — proper vector-style navigation arrow, no emoji, no unicode.
 *
 * Built purely from View primitives (no react-native-svg dependency).
 * Renders a shaft + arrowhead, rotated by direction.
 *
 * States:
 *   active    — neon blue, full opacity
 *   inactive  — dim white, 30% opacity
 *   forbidden — red × overlay (truck banned lane)
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';

export type LaneDirection =
  | 'straight'
  | 'slight left'
  | 'left'
  | 'sharp left'
  | 'slight right'
  | 'right'
  | 'sharp right'
  | 'uturn'
  | 'none';

interface LaneArrowProps {
  direction?: LaneDirection | string;
  active?: boolean;
  forbidden?: boolean;
  size?: number;
  activeColor?: string;
  inactiveColor?: string;
}

/** Rotation (degrees) for each direction, from "pointing up" (straight). */
const DIR_ROTATION: Record<string, number> = {
  straight:      0,
  none:          0,
  'slight right': 30,
  right:          90,
  'sharp right':  145,
  uturn:          180,
  'sharp left':  -145,
  left:          -90,
  'slight left': -30,
};

function getRotation(direction?: string): number {
  if (!direction) return 0;
  return DIR_ROTATION[direction] ?? 0;
}

const LaneArrow: React.FC<LaneArrowProps> = ({
  direction = 'straight',
  active = false,
  forbidden = false,
  size = 28,
  activeColor = '#00BFFF',
  inactiveColor = 'rgba(255,255,255,0.30)',
}) => {
  const rotation = getRotation(direction);
  const color = active ? activeColor : inactiveColor;

  // Proportional dimensions
  const shaftW  = Math.round(size * 0.22);
  const shaftH  = Math.round(size * 0.42);
  const headW   = Math.round(size * 0.62); // full arrowhead width
  const headH   = Math.round(size * 0.42); // arrowhead height

  // U-turn: special shape — use two perpendicular shafts + arrowhead
  if (direction === 'uturn') {
    return (
      <View style={[s.wrap, { width: size, height: size }]}>
        {/* Vertical shaft going up on right side */}
        <View style={[s.uturnShaft, {
          width: shaftW,
          height: Math.round(size * 0.55),
          backgroundColor: color,
          top: Math.round(size * 0.1),
          right: Math.round(size * 0.22),
        }]} />
        {/* Horizontal connecting piece */}
        <View style={[s.uturnShaft, {
          width: Math.round(size * 0.38),
          height: shaftW,
          backgroundColor: color,
          top: Math.round(size * 0.1),
          right: Math.round(size * 0.22),
        }]} />
        {/* Vertical shaft going down on left side */}
        <View style={[s.uturnShaft, {
          width: shaftW,
          height: Math.round(size * 0.5),
          backgroundColor: color,
          top: Math.round(size * 0.1),
          left: Math.round(size * 0.22),
        }]} />
        {/* Arrowhead pointing down on left shaft */}
        <View style={{
          position: 'absolute',
          bottom: Math.round(size * 0.06),
          left: Math.round(size * 0.22) - Math.round((headW - shaftW) / 2),
          width: 0,
          height: 0,
          borderLeftWidth: headW / 2,
          borderRightWidth: headW / 2,
          borderTopWidth: headH * 0.7,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderTopColor: color,
        }} />
        {forbidden && <ForbiddenOverlay size={size} />}
      </View>
    );
  }

  return (
    <View style={[s.wrap, { width: size, height: size }]}>
      <View style={{ transform: [{ rotate: `${rotation}deg` }], alignItems: 'center', justifyContent: 'flex-start', height: size }}>
        {/* Arrowhead triangle (pointing up) */}
        <View style={{
          width: 0,
          height: 0,
          borderLeftWidth: headW / 2,
          borderRightWidth: headW / 2,
          borderBottomWidth: headH,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderBottomColor: color,
          marginTop: Math.round(size * 0.04),
        }} />
        {/* Shaft */}
        <View style={{
          width: shaftW,
          height: shaftH,
          backgroundColor: color,
          borderRadius: shaftW / 2,
          marginTop: -1,
        }} />
      </View>
      {forbidden && <ForbiddenOverlay size={size} />}
    </View>
  );
};

/** Red × cross overlay for truck-banned lanes. */
const ForbiddenOverlay: React.FC<{ size: number }> = ({ size }) => {
  const barW = Math.round(size * 0.78);
  const barH = Math.round(size * 0.14);
  return (
    <View style={[s.forbidWrap, { width: size, height: size }]}>
      <View style={[s.forbidBar, { width: barW, height: barH, transform: [{ rotate: '45deg' }] }]} />
      <View style={[s.forbidBar, { width: barW, height: barH, transform: [{ rotate: '-45deg' }] }]} />
    </View>
  );
};

const s = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  uturnShaft: {
    position: 'absolute',
    borderRadius: 3,
  },
  forbidWrap: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  forbidBar: {
    position: 'absolute',
    backgroundColor: '#FF3B30',
    borderRadius: 3,
    opacity: 0.92,
  },
});

export default React.memo(LaneArrow);
