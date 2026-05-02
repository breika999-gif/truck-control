import React, { memo } from 'react';
import { View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface WakeWordIndicatorProps {
  navigating: boolean;
  wakeWordHeard: boolean;
  topInset: number;
}

const WakeWordIndicator: React.FC<WakeWordIndicatorProps> = ({ navigating, wakeWordHeard, topInset }) => {
  if (!navigating) return null;
  return (
    <View style={{
      position: 'absolute', top: topInset + 8, right: 12,
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: wakeWordHeard ? '#00C853' : 'rgba(0,0,0,0.55)',
      borderRadius: 16, paddingHorizontal: 8, paddingVertical: 4,
      gap: 4,
    }}>
      <Icon name="microphone" size={14} color={wakeWordHeard ? '#fff' : '#4CAF50'} />
      <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600' }}>
        {wakeWordHeard ? 'Чух те!' : 'Колега...'}
      </Text>
    </View>
  );
};

export default memo(WakeWordIndicator);
