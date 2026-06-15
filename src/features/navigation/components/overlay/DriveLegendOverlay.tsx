import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { BluetoothTachoState } from '../../../tacho/hooks/useTachoBluetooth';
import type { Loose } from './types';

interface DriveLegendOverlayProps {
  routeUiCollapsed: boolean;
  navigating: boolean;
  driveSegments: Loose;
  insets: Loose;
  tachoSummary: Loose;
  bluetoothTacho: BluetoothTachoState;
}

const DriveLegendOverlay: React.FC<DriveLegendOverlayProps> = ({
  routeUiCollapsed,
  navigating,
  driveSegments,
  insets,
  tachoSummary,
  bluetoothTacho,
}) => {
  const { t } = useTranslation();
  const [driveLegendVisible, setDriveLegendVisible] = React.useState(true);

  React.useEffect(() => {
    if (!navigating) setDriveLegendVisible(true);
  }, [navigating]);

  const hasDriveLegend = navigating && driveSegments && driveSegments.gradientStops.length > 0;
  if (routeUiCollapsed || !hasDriveLegend) return null;

  if (!driveLegendVisible) {
    return (
      <Pressable
        accessibilityLabel={t('overlay.showTachoLegend')}
        onPress={() => setDriveLegendVisible(true)}
        style={[styles.driveLegendToggle, { bottom: 360 + insets.bottom }]}
      >
        <Text style={styles.driveLegendToggleText}>HOS</Text>
      </Pressable>
    );
  }

  return (
    <View style={[styles.driveLegend, { bottom: 360 + insets.bottom }]}>
      <Pressable
        accessibilityLabel={t('overlay.hideTachoLegend')}
        hitSlop={8}
        onPress={() => setDriveLegendVisible(false)}
        style={styles.driveLegendClose}
      >
        <Text style={styles.driveLegendCloseText}>×</Text>
      </Pressable>
      <Text style={[styles.driveLegendText, styles.driveLegendCurrent]}>
        {t('overlay.untilBreak')}
      </Text>
      <Text style={[styles.driveLegendText, styles.driveLegendAfterBreak]}>
        {t('overlay.afterBreak')}
      </Text>
      {tachoSummary?.daily_limit_h === 10 && (
        <Text style={[styles.driveLegendText, styles.driveLegendExtended]}>
          {t('overlay.extendedHour')}
        </Text>
      )}
      <Text style={[styles.driveLegendText, styles.driveLegendDailyLimit]}>
        {t('overlay.dailyLimit', { hours: tachoSummary?.daily_limit_h ?? 9 })}
      </Text>
      <Pressable
        accessibilityLabel={bluetoothTacho.connected ? t('overlay.disconnectTacho') : t('overlay.connectTacho')}
        onPress={bluetoothTacho.connected ? bluetoothTacho.disconnect : bluetoothTacho.startScan}
        style={styles.bluetoothTachoButton}
      >
        <View
          style={[
            styles.bluetoothTachoDot,
            bluetoothTacho.connected
              ? styles.bluetoothTachoDotConnected
              : styles.bluetoothTachoDotDisconnected,
          ]}
        />
        <Text style={styles.bluetoothTachoText}>
          {bluetoothTacho.connected ? bluetoothTacho.deviceName ?? t('overlay.tacho') : t('overlay.connectTacho')}
        </Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  driveLegend: {
    position: 'absolute',
    left: 12,
    zIndex: 20,
    elevation: 10,
    backgroundColor: 'rgba(0,8,20,0.88)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    paddingLeft: 8,
    paddingRight: 24,
    paddingVertical: 6,
    gap: 2,
  },
  driveLegendClose: {
    position: 'absolute',
    top: 2,
    right: 3,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  driveLegendCloseText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 18,
  },
  driveLegendToggle: {
    position: 'absolute',
    left: 12,
    zIndex: 20,
    elevation: 10,
    backgroundColor: 'rgba(0,8,20,0.88)',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 7,
    paddingVertical: 5,
  },
  driveLegendToggleText: {
    color: '#9B59B6',
    fontSize: 10,
    fontWeight: '800',
  },
  driveLegendText: {
    fontSize: 11,
    fontWeight: '700',
  },
  driveLegendCurrent: {
    color: '#9B59B6',
  },
  driveLegendAfterBreak: {
    color: '#E67E22',
  },
  driveLegendExtended: {
    color: '#F1C40F',
  },
  driveLegendDailyLimit: {
    color: '#C0392B',
  },
  bluetoothTachoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 3,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.14)',
  },
  bluetoothTachoDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  bluetoothTachoDotConnected: {
    backgroundColor: '#007AFF',
  },
  bluetoothTachoDotDisconnected: {
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  bluetoothTachoText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
});

export default DriveLegendOverlay;
