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

const ManeuverPanel: React.FC<ManeuverPanelProps> = ({
  step,
  nextStep,
  distToTurn,
  bottom,
}) => {
  const flashOpacity = useRef(new Animated.Value(1)).current;
  const icon = getManeuverIcon(step.maneuver.type, step.maneuver.modifier);
  const nextIcon = nextStep
    ? getManeuverIcon(nextStep.maneuver.type, nextStep.maneuver.modifier)
    : null;

  useEffect(() => {
    flashOpacity.setValue(0);
    Animated.timing(flashOpacity, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [flashOpacity, step.maneuver.instruction]);

  return (
    <View style={[s.container, { bottom }]}>
      <View style={s.mainRow}>
        <Animated.Image
          source={icon}
          style={[s.arrow, { opacity: flashOpacity }]}
          resizeMode="contain"
        />
        <Text style={s.instruction} numberOfLines={2}>
          {step.maneuver.instruction}
        </Text>
        <Text style={s.distance}>{fmtDistance(distToTurn)}</Text>
      </View>

      {nextStep ? (
        <>
          <View style={s.divider} />
          <View style={s.nextRow}>
            <Text style={s.thenLabel}>then ▸</Text>
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
    paddingHorizontal: 14,
    paddingVertical: 10,
    elevation: 8,
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 12,
  },
  arrow: {
    width: 56,
    height: 56,
    tintColor: '#FFFFFF',
  },
  instruction: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  distance: {
    color: '#00BFFF',
    fontSize: 20,
    fontWeight: '900',
    minWidth: 64,
    textAlign: 'right',
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
