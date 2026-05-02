import React from 'react';
import { TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { spacing } from '../../../shared/constants/theme';
import { styles } from '../screens/MapScreen.styles';

interface RecenterButtonProps {
  visible: boolean;
  bottomOffset: number;
  onPress: () => void;
}

const RecenterButton: React.FC<RecenterButtonProps> = ({
  visible,
  bottomOffset,
  onPress,
}) => {
  if (!visible) return null;

  return (
    <TouchableOpacity
      style={[
        styles.geminiFab,
        { right: spacing.md, bottom: bottomOffset, backgroundColor: 'rgba(10,12,30,0.92)' },
      ]}
      activeOpacity={0.8}
      onPress={onPress}
    >
      <Icon name="crosshairs-gps" size={22} color="#fff" />
    </TouchableOpacity>
  );
};

export default React.memo(RecenterButton);
