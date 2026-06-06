import React from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { colors, radius, spacing } from '../../../shared/constants/theme';
import { useVoiceDialer } from '../hooks/useVoiceDialer';

interface CallingPanelProps {
  visible: boolean;
  onClose: () => void;
}

const CallingPanel: React.FC<CallingPanelProps> = ({ visible, onClose }) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const {
    isListening,
    isCalling,
    statusText,
    matches,
    startListening,
    stopListening,
    selectMatch,
    cancel,
  } = useVoiceDialer();
  const translateY = React.useRef(new Animated.Value(96)).current;
  const pulse = React.useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    Animated.timing(translateY, {
      toValue: visible ? 0 : 96,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [translateY, visible]);

  React.useEffect(() => {
    if (!isListening) {
      pulse.stopAnimation();
      pulse.setValue(1);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.14, duration: 520, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 520, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [isListening, pulse]);

  const handleClose = React.useCallback(() => {
    cancel();
    onClose();
  }, [cancel, onClose]);

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[styles.panel, { bottom: insets.bottom, transform: [{ translateY }] }]}
    >
      <View style={styles.mainRow}>
        <Animated.View style={{ transform: [{ scale: pulse }] }}>
          <TouchableOpacity
            accessibilityLabel={isListening ? t('calling.stopListening') : t('calling.startVoiceCall')}
            activeOpacity={0.78}
            onPress={isListening ? stopListening : startListening}
            style={[styles.micButton, isListening && styles.micButtonListening]}
          >
            <Text style={styles.micIcon}>{isCalling ? '☎' : '🎤'}</Text>
          </TouchableOpacity>
        </Animated.View>

        <Text numberOfLines={2} style={styles.statusText}>
          {statusText}
        </Text>

        {isCalling && (
          <TouchableOpacity activeOpacity={0.78} onPress={cancel} style={styles.cancelButton}>
            <Text style={styles.cancelButtonText}>{t('calling.hangUp')}</Text>
          </TouchableOpacity>
        )}

        <Pressable accessibilityLabel={t('calling.close')} hitSlop={8} onPress={handleClose} style={styles.closeButton}>
          <Text style={styles.closeText}>×</Text>
        </Pressable>
      </View>

      {matches.length > 1 && (
        <ScrollView
          contentContainerStyle={styles.matchesRow}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {matches.slice(0, 4).map((match, index) => (
            <TouchableOpacity
              activeOpacity={0.78}
              key={match.recordID || `${match.displayName}-${index}`}
              onPress={() => selectMatch(index)}
              style={styles.matchButton}
            >
              <Text numberOfLines={1} style={styles.matchText}>{match.displayName}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  cancelButton: {
    backgroundColor: 'rgba(239,68,68,0.20)',
    borderColor: colors.error,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginRight: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  cancelButtonText: {
    color: colors.error,
    fontSize: 11,
    fontWeight: '800',
  },
  closeButton: {
    alignItems: 'center',
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  closeText: {
    color: colors.textSecondary,
    fontSize: 26,
    lineHeight: 27,
  },
  mainRow: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 56,
    paddingHorizontal: spacing.sm,
  },
  matchButton: {
    backgroundColor: colors.bgCard,
    borderColor: 'rgba(0,191,255,0.45)',
    borderRadius: radius.sm,
    borderWidth: 1,
    justifyContent: 'center',
    maxWidth: 150,
    paddingHorizontal: spacing.sm,
  },
  matchesRow: {
    gap: spacing.sm,
    minHeight: 48,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  matchText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  micButton: {
    alignItems: 'center',
    backgroundColor: colors.bgCard,
    borderColor: colors.accentLight,
    borderRadius: radius.full,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  micButtonListening: {
    backgroundColor: colors.error,
    borderColor: colors.text,
  },
  micIcon: {
    color: colors.text,
    fontSize: 19,
  },
  panel: {
    backgroundColor: 'rgba(10,14,26,0.96)',
    borderColor: colors.border,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    borderTopWidth: 1,
    bottom: 0,
    elevation: 24,
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: 100,
  },
  statusText: {
    color: colors.text,
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    marginHorizontal: spacing.sm,
  },
});

export default React.memo(CallingPanel);
