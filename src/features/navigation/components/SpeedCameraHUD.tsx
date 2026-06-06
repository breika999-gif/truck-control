import React from 'react';
import { Animated, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { styles } from '../screens/MapScreen.styles';

interface SpeedCameraHUDProps {
  visible: boolean;
  distM: number;
  bottomOffset: number;
  flashAnim: Animated.Value;
}

const SpeedCameraHUD: React.FC<SpeedCameraHUDProps> = ({
  visible,
  distM,
  bottomOffset,
  flashAnim,
}) => {
  const { t } = useTranslation();

  if (!visible) return null;

  const borderColor = flashAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#cc0000', '#ff5555'],
  });
  const bgColor = flashAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(100,0,0,0.90)', 'rgba(210,15,15,0.97)'],
  });

  return (
    <Animated.View style={[
      styles.cameraHUD,
      { bottom: bottomOffset },
      {
        borderColor,
        backgroundColor: bgColor,
      },
    ]}>
      <Text style={styles.cameraHUDIcon}>📸</Text>
      <View>
        <Text style={styles.cameraHUDDist}>{distM} {t('units.meterShort')}</Text>
        <Text style={styles.cameraHUDLabel}>{t('camera.label')}</Text>
      </View>
    </Animated.View>
  );
};

export default React.memo(SpeedCameraHUD);
