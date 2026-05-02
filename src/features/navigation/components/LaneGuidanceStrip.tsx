import React from 'react';
import { Animated, Text, View } from 'react-native';
import { laneDirectionEmoji } from '../utils/mapUtils';
import { styles } from '../screens/MapScreen.styles';

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
              <Text style={styles.laneSCellArrowActive}>
                {laneDirectionEmoji(lane.directions?.[0])}
              </Text>
            </Animated.View>
          ) : (
            <View key={i} style={styles.laneSCell}>
              <Text style={styles.laneSCellArrow}>
                {laneDirectionEmoji(lane.directions?.[0])}
              </Text>
            </View>
          ),
        )}
      </View>
    </View>
  );
};

export default React.memo(LaneGuidanceStrip);
