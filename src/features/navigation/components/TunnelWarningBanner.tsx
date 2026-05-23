import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { styles } from '../screens/MapScreen.styles';

interface TunnelWarningBannerProps {
  message: string | null;
  visible: boolean;
  topOffset: number;
  onDismiss: () => void;
}

const TunnelWarningBanner: React.FC<TunnelWarningBannerProps> = ({
  message,
  visible,
  topOffset,
  onDismiss,
}) => {
  if (!visible || !message) return null;

  return (
    <View style={[styles.tunnelWarnBanner, { top: topOffset }]}>
      <Text style={[styles.tunnelWarnText, { flex: 1 }]}>{message}</Text>
      <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.tunnelWarnText}>{'  ✕'}</Text>
      </TouchableOpacity>
    </View>
  );
};

export default React.memo(TunnelWarningBanner);
