import React, { memo, useEffect, useRef, useState } from 'react';
import {
  View,
  ScrollView,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Animated,
  Dimensions,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { colors } from '../../../shared/constants/theme';
import { parseBubbleText } from '../utils/mapUtils';
import { styles } from '../screens/MapScreen.styles';
import type { ChatMessage } from '../../../shared/services/backendApi';
import type { EdgeInsets } from 'react-native-safe-area-context';
import BottomSheet from './BottomSheet';

interface ChatPanelProps {
  gptChatOpen: boolean;
  geminiChatOpen: boolean;
  gptHistory: ChatMessage[];
  geminiHistory: ChatMessage[];
  chatInput: string;
  setChatInput: (text: string) => void;
  gptLoading: boolean;
  geminiLoading: boolean;
  handleChat: () => void;
  isRecording: boolean;
  handleMicStart: () => void;
  handleMicStop: () => void;
  kbHeight: number;
  gptScrollRef: React.RefObject<ScrollView | null>;
  geminiScrollRef: React.RefObject<ScrollView | null>;
  googleUser: { email: string } | null;
  insets: EdgeInsets;
  micLoading?: boolean;
  onClose: () => void;
}

const ChatPanel: React.FC<ChatPanelProps> = memo(({
  gptChatOpen,
  geminiChatOpen,
  gptHistory,
  geminiHistory,
  chatInput,
  setChatInput,
  gptLoading,
  geminiLoading,
  handleChat,
  isRecording,
  handleMicStart,
  handleMicStop,
  kbHeight,
  gptScrollRef,
  geminiScrollRef,
  micLoading,
  onClose,
}) => {
  const { t } = useTranslation();
  const isOpen = gptChatOpen || geminiChatOpen;
  const history = gptChatOpen ? gptHistory : geminiHistory;
  const loading = gptChatOpen ? gptLoading : geminiLoading;
  const scrollRef = gptChatOpen ? gptScrollRef : geminiScrollRef;
  const inputRef = useRef<TextInput>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const placeholder = t('chat.placeholder');
  const fallbackKbHeight = inputFocused && kbHeight === 0
    ? Math.round(Dimensions.get('window').height * (Platform.OS === 'android' ? 0.42 : 0.34))
    : 0;
  const effectiveKbHeight = kbHeight > 0 ? kbHeight : fallbackKbHeight;
  const keyboardClearance = effectiveKbHeight > 0 ? (Platform.OS === 'android' ? 76 : 18) : 0;

  // ── Pulsing Mic Animation ──
  const micScale = useRef(new Animated.Value(1)).current;
  const micAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    micAnimRef.current?.stop();
    micAnimRef.current = null;

    if (isRecording) {
      micAnimRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(micScale, {
            toValue: 1.25,
            duration: 450,
            useNativeDriver: true,
          }),
          Animated.timing(micScale, {
            toValue: 1,
            duration: 450,
            useNativeDriver: true,
          }),
        ]),
      );
      micAnimRef.current.start();
    } else {
      micScale.stopAnimation();
      Animated.spring(micScale, {
        toValue: 1,
        useNativeDriver: true,
        friction: 4,
      }).start();
    }
    return () => {
      micAnimRef.current?.stop();
      micAnimRef.current = null;
    };
  }, [isRecording, micScale]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 220);
    return () => clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) setInputFocused(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !inputFocused) return;
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 260);
    return () => clearTimeout(timer);
  }, [effectiveKbHeight, inputFocused, isOpen, scrollRef]);

  return (
    <BottomSheet
      visible={isOpen}
      initialHeight={300}
      snapHeight={400}
      onClose={onClose}
      kbHeight={effectiveKbHeight + keyboardClearance}
    >
      <View style={[styles.chatMessages, { flex: 1 }]}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.chatMessagesContent}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => {
            if (history.length > 0) {
              scrollRef.current?.scrollToEnd({ animated: true });
            }
          }}
        >
          {history.length === 0 && (
            <Text style={styles.chatPlaceholder}>{placeholder}</Text>
          )}
          {history.map((msg, i) => {
            const bubbleText = parseBubbleText(msg.text);
            if (!bubbleText) return null;
            return (
              <View
                key={i}
                style={[
                  styles.chatBubble,
                  msg.role === 'user' ? styles.chatBubbleUser : styles.chatBubbleModel,
                ]}
              >
                <Text style={msg.role === 'user' ? styles.chatBubbleText : styles.chatBubbleTextModel}>
                  {bubbleText}
                </Text>
              </View>
            );
          })}
          {loading && (
            <ActivityIndicator size="small" color={colors.accent} style={{ marginTop: 8 }} />
          )}
        </ScrollView>
      </View>
      <View style={[styles.chatInputRow, { paddingBottom: 12 }]}>
        <Animated.View style={{ transform: [{ scale: micScale }] }}>
          <TouchableOpacity
            style={[
              styles.chatMicBtn,
              isRecording && styles.chatMicBtnRecording,
              (loading || micLoading) && { opacity: 0.4 },
            ]}
            onPressIn={handleMicStart}
            onPressOut={handleMicStop}
            disabled={loading || micLoading}
            activeOpacity={0.75}
          >
            {micLoading ? (
              <ActivityIndicator size="small" color="#ff3b3b" />
            ) : (
              <Icon name={isRecording ? 'stop' : 'microphone-outline'} size={22} color="#FFFFFF" />
            )}
          </TouchableOpacity>
        </Animated.View>
        <TextInput
          ref={inputRef}
          style={styles.chatInput}
          value={chatInput}
          onChangeText={setChatInput}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          placeholder={gptChatOpen ? t('chat.message') : t('chat.gemini')}
          placeholderTextColor={colors.textMuted}
          selectionColor="#00bfff"
          cursorColor="#00bfff"
          onSubmitEditing={handleChat}
          returnKeyType="send"
          editable={!loading}
        />
        <TouchableOpacity
          style={[styles.chatSendBtn, loading && { opacity: 0.4 }]}
          onPress={handleChat}
          disabled={loading}
        >
          <Icon name="send" size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </BottomSheet>
  );
});

export default ChatPanel;
