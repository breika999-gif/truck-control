import React from 'react';
import { Animated, Text, View } from 'react-native';
import { styles } from '../screens/MapScreen.styles';
import LaneArrow from './LaneArrow';

interface LaneGuidanceStripProps {
  visible: boolean;
  lanes: any[];
  glowBg: Animated.AnimatedInterpolation<string>;
  glowShadow: Animated.AnimatedInterpolation<number>;
}

const LaneGuidanceStrip: React.FC<LaneGuidanceStripProps> = ({
  visible,
  lanes,
  glowBg,
  glowShadow,
}) => {
  if (!visible) return null;

  return (
    <View style={styles.laneStrip}>
      <Text style={styles.laneStripLabel}>ЗАПАЗИ ЛЕНТАТА</Text>
      <View style={styles.laneStripCells}>
        {lanes.map((lane, i) =>
          lane.active ? (
            <Animated.View
              key={i}
              style={[
                styles.laneSCell,
                styles.laneSCellActive,
                { backgroundColor: glowBg, shadowOpacity: glowShadow },
              ]}
            >
              <LaneArrow direction={lane.directions?.[0]} active size={26} />
            </Animated.View>
          ) : (
            <View key={i} style={styles.laneSCell}>
              <LaneArrow direction={lane.directions?.[0]} active={false} size={26} />
            </View>
          ),
        )}
      </View>
    </View>
  );
};

export default React.memo(LaneGuidanceStrip);
