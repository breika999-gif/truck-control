import React from 'react';
import { Text, View } from 'react-native';
import { styles } from '../screens/MapScreen.styles';

interface TunnelWarningBannerProps {
  message: string | null;
  visible: boolean;
  topOffset: number;
}

const TunnelWarningBanner: React.FC<TunnelWarningBannerProps> = ({
  message,
  visible,
  topOffset,
}) => {
  if (!visible || !message) return null;

  return (
    <View style={[styles.tunnelWarnBanner, { top: topOffset }]}>
      <Text style={styles.tunnelWarnText}>{message}</Text>
    </View>
  );
};

export default React.memo(TunnelWarningBanner);
