import React, { memo } from 'react';
import { View, Text } from 'react-native';
import { styles } from '../screens/MapScreen.styles';

interface OfflineBannerProps {
  backendOnline: boolean;
}

const OfflineBanner: React.FC<OfflineBannerProps> = ({ backendOnline }) => {
  if (backendOnline) return null;
  return (
    <View style={styles.noInternetBanner} pointerEvents="none">
      <Text style={styles.noInternetText}>⚠️ Сървърът не отговаря — AI функциите са изключени</Text>
    </View>
  );
};

export default memo(OfflineBanner);
