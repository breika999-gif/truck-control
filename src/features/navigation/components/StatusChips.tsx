import React, { memo } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from '../../../shared/constants/theme';
import { styles } from '../screens/MapScreen.styles';

interface StatusChipsProps {
  gpsReady: boolean;
  rerouting: boolean;
  loadingRoute: boolean;
}

const StatusChips: React.FC<StatusChipsProps> = ({ gpsReady, rerouting, loadingRoute }) => {
  const { t } = useTranslation();

  return (
    <>
      {!gpsReady && (
        <View style={styles.gpsChip}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.gpsText}>{t('status.gps')}</Text>
        </View>
      )}
      {rerouting && (
        <View style={styles.reroutingChip}>
          <ActivityIndicator size="small" color={colors.warning} />
          <Text style={styles.reroutingText}>{t('status.rerouting')}</Text>
        </View>
      )}
      {loadingRoute && (
        <View style={styles.loadingChip}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.loadingText}>{t('status.loadingRoute')}</Text>
        </View>
      )}
    </>
  );
};

export default memo(StatusChips);
