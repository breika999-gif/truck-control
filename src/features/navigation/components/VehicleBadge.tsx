import React, { memo } from 'react';
import { View, Text } from 'react-native';
import { styles } from '../screens/MapScreen.styles';

interface VehicleBadgeProps {
  plate: string | null | undefined;
  navigating: boolean;
  searchTop: number;
}

const VehicleBadge: React.FC<VehicleBadgeProps> = ({ plate, navigating, searchTop }) => {
  if (!plate || navigating) return null;
  return (
    <View style={[styles.badge, { top: searchTop + 58 }]}>
      <Text style={styles.badgeText}>{plate}</Text>
    </View>
  );
};

export default memo(VehicleBadge);
