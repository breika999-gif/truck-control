import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  Image,
  Animated,
  StyleSheet,
} from 'react-native';

import { fmtDistance, type RouteStep } from '../api/directions';

interface ManeuverPanelProps {
  step: RouteStep;
  nextStep: RouteStep | null;
  distToTurn: number;
  bottom: number;
}

function getManeuverIcon(type: string, modifier?: string) {
  if (type === 'roundabout' || type === 'rotary') {
    if (modifier?.includes('left')) {
      return require('../../../shared/assets/tomtom_research/icons/ic_decision_point_arrow_roundaboutleft.png');
    }
    if (modifier?.includes('right')) {
      return require('../../../shared/assets/tomtom_research/icons/ic_decision_point_arrow_roundaboutright.png');
    }
    return require('../../../shared/assets/tomtom_research/icons/ic_decision_point_arrow_roundaboutaround.png');
  }

  if (modifier === 'left') {
    return require('../../../shared/assets/tomtom_research/icons/ic_decision_point_arrow_left.png');
  }
  if (modifier === 'right') {
    return require('../../../shared/assets/tomtom_research/icons/ic_decision_point_arrow_right.png');
  }
  if (modifier === 'slight left') {
    return require('../../../shared/assets/tomtom_research/icons/ic_decision_point_arrow_bear_left.png');
  }
  if (modifier === 'slight right') {
    return require('../../../shared/assets/tomtom_research/icons/ic_decision_point_arrow_bear_right.png');
  }
  if (modifier === 'sharp left') {
    return require('../../../shared/assets/tomtom_research/icons/ic_decision_point_arrow_sharp_left.png');
  }
  if (modifier === 'sharp right') {
    return require('../../../shared/assets/tomtom_research/icons/ic_decision_point_arrow_sharp_right.png');
  }
  if (modifier === 'uturn') {
    return require('../../../shared/assets/tomtom_research/icons/ic_decision_point_arrow_uturn_left.png');
  }

  return require('../../../shared/assets/tomtom_research/icons/ic_decision_point_arrow_straight.png');
}

/** Derive road type from road name for header color + shield */
function getRoadType(name: string): 'motorway' | 'national' | 'street' {
  if (!name) return 'street';
  const upper = name.toUpperCase();
  // European route (E65) or A-road (A1) → motorway
  if (/\b(E\d+|А\d+|A\d+)\b/.test(upper) || upper.includes('АВТОМАГИСТРАЛА') || upper.includes('МАГИСТРАЛА')) {
    return 'motorway';
  }
  // National/regional roads
  if (upper.startsWith('Р') || upper.startsWith('R') || upper.includes('ГЛАВЕН') || upper.includes('NATIONAL')) {
    return 'national';
  }
  return 'street';
}

/** Extract highway shield codes like E65, A1 from road name */
function extractShields(name: string): string[] {
  if (!name) return [];
  const matches = name.match(/\b(E\d+|А\d+|A\d+)\b/g);
  return matches ? [...new Set(matches)] : [];
}

const ROAD_COLORS: Record<'motorway' | 'national' | 'street', string> = {
  motorway: '#3A4149',  // TomTom dark gray for motorways
  national:  '#1A5276', // blue for national roads
  street:    '#1A3A2A', // dark green for streets
};

function progressColor(ratio: number): string {
  if (ratio > 0.5) return '#4CAF50'; // green — far
  if (ratio > 0.2) return '#FF9800'; // orange — approaching
  return '#F44336';                  // red — close
}

const ManeuverPanel: React.FC<ManeuverPanelProps> = ({
  step,
  nextStep,
  distToTurn,
  bottom,
}) => {
  const flashOpacity = useRef(new Animated.Value(1)).current;
  const progressAnim = useRef(new Animated.Value(1)).current;
  const icon = getManeuverIcon(step.maneuver.type, step.maneuver.modifier);
  const nextIcon = nextStep
    ? getManeuverIcon(nextStep.maneuver.type, nextStep.maneuver.modifier)
    : null;

  const roadType = getRoadType(step.name ?? '');
  const shields  = extractShields(step.name ?? '');
  const headerBg = ROAD_COLORS[roadType];

  // Ratio of remaining distance (1 = just started, 0 = at turn)
  const totalDist = step.distance > 0 ? step.distance : 1;
  const ratio = Math.max(0, Math.min(1, distToTurn / totalDist));
  const barColor = progressColor(ratio);

  useEffect(() => {
    flashOpacity.setValue(0);
    Animated.timing(flashOpacity, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [flashOpacity, step.maneuver.instruction]);

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: ratio,
      duration: 400,
      useNativeDriver: false,
    }).start();
  }, [progressAnim, ratio]);

  return (
    <View style={[s.container, { bottom }]}>
      {/* Color-coded header strip: road name + shield badges */}
      <View style={[s.header, { backgroundColor: headerBg }]}>
        {shields.map(code => (
          <View key={code} style={[
            s.shield,
            roadType === 'motorway' ? s.shieldMotorway : s.shieldNational,
          ]}>
            <Text style={s.shieldText}>{code}</Text>
          </View>
        ))}
        <Text style={s.roadName} numberOfLines={1}>
          {step.name || ''}
        </Text>
      </View>

      {/* Distance progress bar */}
      <View style={s.progressTrack}>
        <Animated.View
          style={[
            s.progressFill,
            {
              width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
              backgroundColor: barColor,
            },
          ]}
        />
      </View>

      <View style={s.mainRow}>
        <Animated.Image
          source={icon}
          style={[s.arrow, { opacity: flashOpacity }]}
          resizeMode="contain"
        />
        <View style={s.textCol}>
          <Text style={s.instruction} numberOfLines={2}>
            {step.maneuver.instruction}
          </Text>
          <Text style={s.distance}>{fmtDistance(distToTurn)}</Text>
        </View>
      </View>

      {nextStep ? (
        <>
          <View style={s.divider} />
          <View style={s.nextRow}>
            <Text style={s.thenLabel}>след ▸</Text>
            {nextIcon ? (
              <Image source={nextIcon} style={s.nextArrow} resizeMode="contain" />
            ) : null}
            <Text style={s.nextInstruction} numberOfLines={1}>
              {nextStep.maneuver.instruction}
            </Text>
          </View>
        </>
      ) : null}
    </View>
  );
};

const s = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 12,
    right: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(8,12,24,0.88)',
    overflow: 'hidden',
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 5,
    columnGap: 6,
  },
  roadName: {
    flex: 1,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  shield: {
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minWidth: 28,
    alignItems: 'center',
  },
  shieldMotorway: {
    backgroundColor: '#00A651', // green shield for E-roads
  },
  shieldNational: {
    backgroundColor: '#1A6FBF', // blue shield for A-roads
  },
  shieldText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
  },
  progressTrack: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
  },
  mainRow: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 14,
  },
  arrow: {
    width: 80,
    height: 80,
    tintColor: '#FFFFFF',
  },
  textCol: {
    flex: 1,
  },
  instruction: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  distance: {
    color: '#00BFFF',
    fontSize: 22,
    fontWeight: '900',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginVertical: 6,
  },
  nextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 8,
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  thenLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
  },
  nextArrow: {
    width: 24,
    height: 24,
    tintColor: 'rgba(255,255,255,0.6)',
  },
  nextInstruction: {
    flex: 1,
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
  },
});

export default ManeuverPanel;
