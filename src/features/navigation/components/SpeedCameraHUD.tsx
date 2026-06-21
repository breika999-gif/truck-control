import React from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { styles } from '../screens/MapScreen.styles';

interface SpeedCameraHUDProps {
  visible: boolean;
  distM: number;
  bottomOffset: number;
  flashAnim: Animated.Value;
  onZoom?: () => void;
  isZoomed?: boolean;
}

const SpeedCameraHUD: React.FC<SpeedCameraHUDProps> = ({
  visible,
  distM,
  bottomOffset,
  flashAnim,
  onZoom,
  isZoomed,
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
      {onZoom && (
        <TouchableOpacity onPress={onZoom} style={hudStyles.zoomBtn} activeOpacity={0.75}>
          <Text style={hudStyles.zoomBtnText}>{isZoomed ? '⦿' : '🔍'}</Text>
        </TouchableOpacity>
      )}
    </Animated.View>
  );
};

const hudStyles = StyleSheet.create({
  zoomBtn: {
    marginLeft: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomBtnText: { fontSize: 18 },
});

export default React.memo(SpeedCameraHUD);
