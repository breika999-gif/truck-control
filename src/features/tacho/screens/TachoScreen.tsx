import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Dimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTachoBluetooth } from '../hooks/useTachoBluetooth';
import { colors, spacing, radius, typography } from '../../../shared/constants/theme';

const { width } = Dimensions.get('window');

const TachoScreen: React.FC = () => {
  const {
    status,
    statusMsg,
    liveData,
    isConnected,
    startScan,
    disconnect,
  } = useTachoBluetooth();

  const renderStatus = () => {
    let icon = 'bluetooth-off';
    let color = colors.textSecondary;

    if (status === 'scanning') {
      icon = 'bluetooth-audio';
      color = colors.warning;
    } else if (status === 'connecting') {
      icon = 'bluetooth-connect';
      color = colors.accentLight;
    } else if (status === 'connected') {
      icon = 'bluetooth-check';
      color = colors.success;
    } else if (status === 'error') {
      icon = 'bluetooth-off';
      color = colors.error;
    }

    return (
      <View style={styles.statusCard}>
        <Icon name={icon} size={32} color={color} />
        <View style={styles.statusTextContainer}>
          <Text style={styles.statusLabel}>Статус на връзката</Text>
          <Text style={[styles.statusValue, { color }]}>{statusMsg || 'Не е свързан'}</Text>
        </View>
      </View>
    );
  };

  const renderActivity = () => {
    if (!liveData) return null;

    let activityIcon = 'truck-outline';
    let activityColor = colors.textSecondary;

    switch (liveData.activityCode) {
      case 0: // Rest
        activityIcon = 'sleep';
        activityColor = colors.success;
        break;
      case 1: // Availability
        activityIcon = 'clock-outline';
        activityColor = colors.warning;
        break;
      case 2: // Work
        activityIcon = 'hammer';
        activityColor = colors.accentLight;
        break;
      case 3: // Driving
        activityIcon = 'steering';
        activityColor = colors.error;
        break;
    }

    return (
      <View style={styles.activityContainer}>
        <View style={styles.activityHeader}>
          <Icon name={activityIcon} size={48} color={activityColor} />
          <Text style={[styles.activityText, { color: activityColor }]}>
            {liveData.activity}
          </Text>
        </View>

        <View style={styles.speedContainer}>
          <Text style={styles.speedValue}>{liveData.speed}</Text>
          <Text style={styles.speedUnit}>км/ч</Text>
        </View>
      </View>
    );
  };

  const renderProgress = () => {
    if (!liveData) return null;

    const maxDailyMin = 9 * 60; // 9 hours
    const progress = Math.min(liveData.dailyDrivenMin / maxDailyMin, 1);
    
    const formatTime = (min: number) => {
      const h = Math.floor(min / 60);
      const m = min % 60;
      return `${h}ч ${m}мин`;
    };

    return (
      <View style={styles.progressCard}>
        <View style={styles.timeRow}>
          <View style={styles.timeItem}>
            <Text style={styles.timeLabel}>Изкарано днес</Text>
            <Text style={styles.timeValue}>{formatTime(liveData.dailyDrivenMin)}</Text>
          </View>
          <View style={styles.timeItem}>
            <Text style={[styles.timeLabel, { textAlign: 'right' }]}>Оставащо</Text>
            <Text style={[styles.timeValue, { textAlign: 'right', color: colors.warning }]}>
              {formatTime(liveData.drivingTimeLeftMin)}
            </Text>
          </View>
        </View>

        <View style={styles.progressBarBg}>
          <View style={[styles.progressBarFill, { width: `${progress * 100}%` }]} />
        </View>
        
        <View style={styles.limitRow}>
          <Text style={styles.limitText}>0ч</Text>
          <Text style={styles.limitText}>9ч лимит</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Тахограф 📡</Text>
        <Text style={styles.headerSubtitle}>VDO DTCO 4.1 / Smart 2</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {renderStatus()}
        
        {isConnected && renderActivity()}
        {isConnected && renderProgress()}

        {!isConnected ? (
          <TouchableOpacity 
            style={[styles.button, styles.connectButton]} 
            onPress={startScan}
            disabled={status === 'scanning' || status === 'connecting'}
          >
            <Icon name="bluetooth" size={24} color={colors.text} />
            <Text style={styles.buttonText}>Свържи тахограф</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity 
            style={[styles.button, styles.disconnectButton]} 
            onPress={disconnect}
          >
            <Icon name="bluetooth-off" size={24} color={colors.text} />
            <Text style={styles.buttonText}>Прекъсни връзката</Text>
          </TouchableOpacity>
        )}

        <View style={styles.infoBox}>
          <Icon name="information-outline" size={20} color={colors.textMuted} />
          <Text style={styles.infoText}>
            За свързване се уверете, че тахографът е в режим "Pairing" 
            от менюто Settings {'->'} Bluetooth.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    padding: spacing.lg,
    paddingTop: spacing.xl,
    backgroundColor: colors.bgSecondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    ...typography.h2,
    color: colors.text,
  },
  headerSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 4,
  },
  scrollContent: {
    padding: spacing.md,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSecondary,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.md,
  },
  statusTextContainer: {
    marginLeft: spacing.md,
  },
  statusLabel: {
    ...typography.label,
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  statusValue: {
    ...typography.h3,
    marginTop: 2,
  },
  activityContainer: {
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
  },
  activityHeader: {
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  activityText: {
    ...typography.h1,
    marginTop: spacing.sm,
    fontWeight: '800',
  },
  speedContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  speedValue: {
    fontSize: 64,
    fontWeight: '800',
    color: colors.text,
  },
  speedUnit: {
    ...typography.h3,
    color: colors.textSecondary,
    marginLeft: spacing.xs,
  },
  progressCard: {
    backgroundColor: colors.bgSecondary,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.lg,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  timeItem: {
    flex: 1,
  },
  timeLabel: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  timeValue: {
    ...typography.h3,
    color: colors.text,
  },
  progressBarBg: {
    height: 12,
    backgroundColor: colors.border,
    borderRadius: radius.full,
    overflow: 'hidden',
    marginBottom: spacing.xs,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.accent,
  },
  limitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  limitText: {
    ...typography.label,
    color: colors.textMuted,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  connectButton: {
    backgroundColor: colors.accent,
  },
  disconnectButton: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.error,
  },
  buttonText: {
    ...typography.h3,
    color: colors.text,
    marginLeft: spacing.sm,
  },
  infoBox: {
    flexDirection: 'row',
    padding: spacing.md,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    opacity: 0.8,
  },
  infoText: {
    ...typography.caption,
    color: colors.textMuted,
    marginLeft: spacing.sm,
    flex: 1,
  },
});

export default TachoScreen;
