import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

interface TachoShieldProps {
  visible: boolean;
  remainingMin: number | null;
  activity: string;
  onDismiss: () => void;
}

function formatRemaining(remainingMin: number | null): string {
  if (remainingMin == null || !Number.isFinite(remainingMin)) return '--:--';
  const safeMin = Math.max(0, Math.round(remainingMin));
  const hours = Math.floor(safeMin / 60);
  const minutes = safeMin % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

const TachoShield: React.FC<TachoShieldProps> = ({
  visible,
  remainingMin,
  activity,
  onDismiss,
}) => {
  const { t } = useTranslation();
  if (!visible) return null;

  return (
    <Pressable style={shieldStyles.overlay} onPress={onDismiss}>
      <View style={shieldStyles.card}>
        <Text style={shieldStyles.eyebrow}>{t('tachoShield.eyebrow')}</Text>
        <Text style={shieldStyles.time}>{formatRemaining(remainingMin)}</Text>
        <Text style={shieldStyles.activity}>{activity}</Text>
        <Text style={shieldStyles.tapHint}>{t('tachoShield.tapToDismiss')}</Text>
      </View>
    </Pressable>
  );
};

const shieldStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    color: 'rgba(255,255,255,0.56)',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 2.4,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  time: {
    color: '#FFFFFF',
    fontSize: 96,
    fontWeight: '900',
    letterSpacing: -4,
    lineHeight: 108,
  },
  activity: {
    color: '#FFD12A',
    fontSize: 24,
    fontWeight: '900',
    marginTop: 6,
    textAlign: 'center',
  },
  tapHint: {
    color: 'rgba(255,255,255,0.48)',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 28,
  },
});

export default React.memo(TachoShield);
