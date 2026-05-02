import React, { memo } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { colors } from '../../../shared/constants/theme';
import { styles } from '../screens/MapScreen.styles';

interface StatusChipsProps {
  gpsReady: boolean;
  rerouting: boolean;
  loadingRoute: boolean;
}

const StatusChips: React.FC<StatusChipsProps> = ({ gpsReady, rerouting, loadingRoute }) => (
  <>
    {!gpsReady && (
      <View style={styles.gpsChip}>
        <ActivityIndicator size="small" color={colors.accent} />
        <Text style={styles.gpsText}>GPS...</Text>
      </View>
    )}
    {rerouting && (
      <View style={styles.reroutingChip}>
        <ActivityIndicator size="small" color={colors.warning} />
        <Text style={styles.reroutingText}>Рекалкулиране...</Text>
      </View>
    )}
    {loadingRoute && (
      <View style={styles.loadingChip}>
        <ActivityIndicator size="small" color={colors.accent} />
        <Text style={styles.loadingText}>Изчисляване на маршрут...</Text>
      </View>
    )}
  </>
);

export default memo(StatusChips);
