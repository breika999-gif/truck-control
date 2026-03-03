/**
 * GoogleAccountModal — Android AccountPicker integration.
 *
 * Shows the connected Google account email, or a button to pick an account
 * via the system AccountPicker (no Firebase, no google-services.json).
 *
 * Neon blue theme matches GeminiConnectModal.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { pickGoogleAccount, clearAccount, type GoogleAccount } from '../../../shared/services/accountManager';

// ── constants ──────────────────────────────────────────────────────────────────

const NEON = '#00bfff';

// ── types ──────────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  onClose: () => void;
  currentAccount: GoogleAccount | null;
  onConnected: (email: string) => void;
  onDisconnected: () => void;
}

// ── component ─────────────────────────────────────────────────────────────────

export default function GoogleAccountModal({
  visible,
  onClose,
  currentAccount,
  onConnected,
  onDisconnected,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  useEffect(() => {
    if (!visible) return;
    setLoading(false);
    setError('');
  }, [visible]);

  const handlePickAccount = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const account = await pickGoogleAccount();
      onConnected(account.email);
      onClose();
    } catch (err: unknown) {
      const msg = (err as Error)?.message ?? String(err);
      if (!msg.includes('CANCELLED')) {
        setError('Грешка при избор на акаунт. Опитай отново.');
      }
    } finally {
      setLoading(false);
    }
  }, [onConnected, onClose]);

  const handleDisconnect = useCallback(async () => {
    await clearAccount();
    onDisconnected();
    onClose();
  }, [onDisconnected, onClose]);

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.googleIcon}>G</Text>
            <Text style={styles.title}>Google Акаунт</Text>
          </View>

          {currentAccount ? (
            /* Connected state */
            <>
              <View style={styles.connectedRow}>
                <View style={styles.connectedDot} />
                <Text style={styles.connectedEmail} numberOfLines={1}>
                  {currentAccount.email}
                </Text>
              </View>
              <Text style={styles.subtitle}>
                Звездичките ⭐ се пазят за този акаунт.
              </Text>

              <TouchableOpacity
                style={styles.switchBtn}
                onPress={handlePickAccount}
                disabled={loading}
              >
                {loading
                  ? <ActivityIndicator color={NEON} size="small" />
                  : <Text style={styles.switchBtnText}>🔄 Смени акаунт</Text>
                }
              </TouchableOpacity>

              <TouchableOpacity style={styles.disconnectBtn} onPress={handleDisconnect}>
                <Text style={styles.disconnectBtnText}>🗑 Изключи акаунта</Text>
              </TouchableOpacity>
            </>
          ) : (
            /* Disconnected state */
            <>
              <Text style={styles.subtitle}>
                Свържи Google акаунт за да пазиш любими места ⭐ per-акаунт.
              </Text>

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <TouchableOpacity
                style={[styles.connectBtn, loading && styles.connectBtnDisabled]}
                onPress={handlePickAccount}
                disabled={loading}
              >
                {loading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.connectBtnText}>G  Избери Google акаунт</Text>
                }
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>✕ Затвори</Text>
          </TouchableOpacity>
        </Pressable>
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
    marginBottom: 12,
  },
  googleIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#4285F4',
    textAlign: 'center',
    lineHeight: 32,
    fontSize: 18,
    fontWeight: '900',
    color: '#fff',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.60)',
    lineHeight: 18,
    marginBottom: 18,
  },
  connectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    backgroundColor: 'rgba(0,191,255,0.08)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.3)',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  connectedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4cff91',
    shadowColor: '#4cff91',
    shadowOpacity: 0.9,
    shadowRadius: 4,
  },
  connectedEmail: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
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
    paddingVertical: 13,
    alignItems: 'center',
    shadowColor: NEON,
    shadowOpacity: 0.8,
    shadowRadius: 10,
    elevation: 10,
    marginBottom: 10,
  },
  connectBtnDisabled: { opacity: 0.5 },
  connectBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  switchBtn: {
    backgroundColor: 'rgba(0,191,255,0.10)',
    borderWidth: 1.5,
    borderColor: 'rgba(0,191,255,0.5)',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 8,
  },
  switchBtnText: { color: NEON, fontSize: 13, fontWeight: '700' },
  disconnectBtn: {
    alignItems: 'center',
    paddingVertical: 8,
    marginBottom: 4,
  },
  disconnectBtnText: { color: 'rgba(255,255,255,0.40)', fontSize: 12 },
  closeBtn: { alignItems: 'center', marginTop: 14 },
  closeBtnText: { color: 'rgba(255,255,255,0.35)', fontSize: 13 },
});
