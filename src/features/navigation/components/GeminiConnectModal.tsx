/**
 * GeminiConnectModal — personal Gemini API key setup.
 *
 * Driver enters their Google AI Studio key → backend pings Gemini →
 * shows "Gemini е готов за работа! 😉" → saves key to AsyncStorage.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ActivityIndicator,
  Linking,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { validateGeminiKey } from '../../../shared/services/backendApi';

// ── constants ─────────────────────────────────────────────────────────────────

export const GEMINI_KEY_STORAGE = '@truckai/gemini_api_key';
const NEON = '#00bfff';
const GET_KEY_URL = 'https://ai.google.dev/';

// ── types ─────────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called with the validated key after a successful connection. */
  onConnected: (apiKey: string) => void;
}

type Status = 'idle' | 'validating' | 'success' | 'error';

// ── component ─────────────────────────────────────────────────────────────────

export default function GeminiConnectModal({ visible, onClose, onConnected }: Props) {
  const [apiKey, setApiKey]     = useState('');
  const [masked, setMasked]     = useState(true);
  const [status, setStatus]     = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  // Pre-fill saved key when modal opens
  useEffect(() => {
    if (!visible) return;
    AsyncStorage.getItem(GEMINI_KEY_STORAGE).then(saved => {
      if (saved) setApiKey(saved);
    });
    setStatus('idle');
    setErrorMsg('');
  }, [visible]);

  const handleConnect = useCallback(async () => {
    const key = apiKey.trim();
    if (!key) {
      setErrorMsg('Въведи API ключа си.');
      setStatus('error');
      return;
    }
    setStatus('validating');
    setErrorMsg('');

    const result = await validateGeminiKey(key);

    if (result.ok) {
      await AsyncStorage.setItem(GEMINI_KEY_STORAGE, key);
      setStatus('success');
      // Give user a moment to see success, then close
      setTimeout(() => {
        onConnected(key);
        onClose();
        setStatus('idle');
      }, 1800);
    } else {
      setErrorMsg(result.error ?? 'Невалиден ключ или мрежова грешка.');
      setStatus('error');
    }
  }, [apiKey, onConnected, onClose]);

  const handleDisconnect = useCallback(async () => {
    await AsyncStorage.removeItem(GEMINI_KEY_STORAGE);
    setApiKey('');
    setStatus('idle');
    setErrorMsg('');
  }, []);

  const handleGetKey = useCallback(() => {
    Linking.openURL(GET_KEY_URL);
  }, []);

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.center}
        >
          <Pressable style={styles.card} onPress={() => {}}>
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.emoji}>😉</Text>
              <Text style={styles.title}>Свържи Gemini AI</Text>
            </View>
            <Text style={styles.subtitle}>
              Въведи личния си Google AI Studio ключ за да активираш Gemini гласовия асистент.
            </Text>

            {/* API Key input */}
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={apiKey}
                onChangeText={setApiKey}
                placeholder="AIza..."
                placeholderTextColor="rgba(255,255,255,0.3)"
                secureTextEntry={masked}
                autoCapitalize="none"
                autoCorrect={false}
                editable={status !== 'validating' && status !== 'success'}
              />
              <TouchableOpacity
                style={styles.eyeBtn}
                onPress={() => setMasked(m => !m)}
              >
                <Text style={styles.eyeIcon}>{masked ? '👁' : '🙈'}</Text>
              </TouchableOpacity>
            </View>

            {/* Status feedback */}
            {status === 'validating' && (
              <View style={styles.statusRow}>
                <ActivityIndicator color={NEON} size="small" />
                <Text style={styles.statusText}>Проверяваме ключа…</Text>
              </View>
            )}
            {status === 'success' && (
              <View style={styles.statusRow}>
                <Text style={styles.successText}>✅ Gemini е готов за работа! 😉</Text>
              </View>
            )}
            {status === 'error' && (
              <Text style={styles.errorText}>{errorMsg}</Text>
            )}

            {/* Actions */}
            <TouchableOpacity
              style={[
                styles.connectBtn,
                status === 'success' && styles.connectBtnSuccess,
                status === 'validating' && styles.connectBtnDisabled,
              ]}
              onPress={handleConnect}
              disabled={status === 'validating' || status === 'success'}
            >
              <Text style={styles.connectBtnText}>
                {status === 'success' ? '✅ Свързан' : '⚡ Свържи'}
              </Text>
            </TouchableOpacity>

            {apiKey.trim().length > 0 && status !== 'validating' && (
              <TouchableOpacity style={styles.disconnectBtn} onPress={handleDisconnect}>
                <Text style={styles.disconnectBtnText}>🗑 Изчисти ключа</Text>
              </TouchableOpacity>
            )}

            {/* Help link */}
            <TouchableOpacity style={styles.helpRow} onPress={handleGetKey}>
              <Text style={styles.helpText}>
                Нямаш ключ? Вземи безплатно от{' '}
                <Text style={styles.helpLink}>ai.google.dev</Text>
              </Text>
            </TouchableOpacity>

            {/* Close */}
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeBtnText}>✕ Затвори</Text>
            </TouchableOpacity>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

// ── styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  center: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: 'rgba(0,8,20,0.95)',
    borderRadius: 18,
    borderWidth: 2,
    borderColor: NEON,
    padding: 24,
    shadowColor: NEON,
    shadowOpacity: 0.9,
    shadowRadius: 20,
    elevation: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  emoji: { fontSize: 28 },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.65)',
    lineHeight: 18,
    marginBottom: 18,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(0,191,255,0.4)',
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    paddingVertical: 11,
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
  },
  eyeBtn: { paddingLeft: 8, paddingVertical: 8 },
  eyeIcon: { fontSize: 18 },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  statusText: { color: NEON, fontSize: 13 },
  successText: { color: '#4cff91', fontSize: 14, fontWeight: '700' },
  errorText: {
    color: '#ff6b6b',
    fontSize: 13,
    marginBottom: 10,
    lineHeight: 18,
  },
  connectBtn: {
    backgroundColor: 'rgba(0,191,255,0.18)',
    borderWidth: 2,
    borderColor: NEON,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    shadowColor: NEON,
    shadowOpacity: 0.8,
    shadowRadius: 10,
    elevation: 10,
    marginBottom: 10,
  },
  connectBtnSuccess: {
    borderColor: '#4cff91',
    backgroundColor: 'rgba(76,255,145,0.15)',
    shadowColor: '#4cff91',
  },
  connectBtnDisabled: { opacity: 0.5 },
  connectBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  disconnectBtn: {
    alignItems: 'center',
    paddingVertical: 8,
    marginBottom: 6,
  },
  disconnectBtnText: { color: 'rgba(255,255,255,0.45)', fontSize: 12 },
  helpRow: { alignItems: 'center', marginTop: 8, marginBottom: 4 },
  helpText: { color: 'rgba(255,255,255,0.45)', fontSize: 12 },
  helpLink: { color: NEON, textDecorationLine: 'underline' },
  closeBtn: { alignItems: 'center', marginTop: 14 },
  closeBtnText: { color: 'rgba(255,255,255,0.35)', fontSize: 13 },
});
