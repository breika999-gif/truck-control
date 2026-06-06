import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { NEON, styles } from '../screens/MapScreen.styles';

interface TiltControlsProps {
  visible: boolean;
  mapPitch: number;
  bottomOffset: number;
  position?: 'bottomRight' | 'middleLeft';
  onTiltUp: () => void;
  onTiltDown: () => void;
}

const TiltControls: React.FC<TiltControlsProps> = ({
  visible,
  bottomOffset,
  position = 'bottomRight',
  onTiltUp,
  onTiltDown,
}) => {
  if (!visible) return null;

  const positionStyle = position === 'middleLeft'
    ? { left: 14, right: undefined, top: '46%' as const, bottom: undefined, transform: [{ translateY: -46 }] }
    : { bottom: bottomOffset };

  return (
    <View style={[styles.tiltBtnCol, positionStyle]}>
      <TouchableOpacity
        style={styles.tiltBtn}
        activeOpacity={0.8}
        onPress={onTiltUp}
      >
        <Icon name="plus" size={20} color={NEON} />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.tiltBtn}
        activeOpacity={0.8}
        onPress={onTiltDown}
      >
        <Icon name="minus" size={20} color={NEON} />
      </TouchableOpacity>
    </View>
  );
};

export default React.memo(TiltControls);
