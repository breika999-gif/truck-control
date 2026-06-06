import React, { memo } from 'react';
import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { styles } from '../screens/MapScreen.styles';

interface OfflineBannerProps {
  backendOnline: boolean;
}

const OfflineBanner: React.FC<OfflineBannerProps> = ({ backendOnline }) => {
  const { t } = useTranslation();

  if (backendOnline) return null;
  return (
    <View style={styles.noInternetBanner} pointerEvents="none">
      <Text style={styles.noInternetText}>{t('offlineBanner.message')}</Text>
    </View>
  );
};

export default memo(OfflineBanner);
