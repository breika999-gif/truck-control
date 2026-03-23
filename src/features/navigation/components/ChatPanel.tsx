import React, { memo } from 'react';
import {
  View,
  ScrollView,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { colors } from '../../../shared/constants/theme';
import { parseBubbleText } from '../utils/mapUtils';
import { styles } from '../screens/MapScreen.styles';
import type { ChatMessage } from '../../../shared/services/backendApi';
import type { EdgeInsets } from 'react-native-safe-area-context';

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
  gptScrollRef: React.RefObject<ScrollView>;
  geminiScrollRef: React.RefObject<ScrollView>;
  googleUser: { email: string } | null;
  insets: EdgeInsets;
  micLoading?: boolean;
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
  insets,
  micLoading,
}) => {
  if (!gptChatOpen && !geminiChatOpen) return null;

  const isOpen = gptChatOpen || geminiChatOpen;
  const history = gptChatOpen ? gptHistory : geminiHistory;
  const loading = gptChatOpen ? gptLoading : geminiLoading;
  const scrollRef = gptChatOpen ? gptScrollRef : geminiScrollRef;
  const placeholder = gptChatOpen
    ? 'Навигация: маршрути, паркинг, горива, камери...'
    : "Питай Gemini или кажи 'отвори YouTube'...";

  return (
    <View style={[styles.chatPanel, { bottom: insets.bottom + 80 + kbHeight }]}>
      <ScrollView
        ref={scrollRef}
        style={styles.chatMessages}
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
        {history.map((msg, i) => (
          <View
            key={i}
            style={[
              styles.chatBubble,
              msg.role === 'user' ? styles.chatBubbleUser : styles.chatBubbleModel,
            ]}
          >
            <Text style={msg.role === 'user' ? styles.chatBubbleText : styles.chatBubbleTextModel}>
              {parseBubbleText(msg.text)}
            </Text>
          </View>
        ))}
        {loading && (
          <ActivityIndicator size="small" color={colors.accent} style={{ marginTop: 8 }} />
        )}
      </ScrollView>
      <View style={styles.chatInputRow}>
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
            <Text style={styles.chatMicText}>{isRecording ? '⏹' : '🎙'}</Text>
          )}
        </TouchableOpacity>
        <TextInput
          style={styles.chatInput}
          value={chatInput}
          onChangeText={setChatInput}
          placeholder={gptChatOpen ? "Съобщение..." : "Питай Gemini..."}
          placeholderTextColor={colors.textMuted}
          onSubmitEditing={handleChat}
          returnKeyType="send"
          editable={!loading}
        />
        <TouchableOpacity
          style={[styles.chatSendBtn, loading && { opacity: 0.4 }]}
          onPress={handleChat}
          disabled={loading}
        >
          <Text style={styles.chatSendText}>➤</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

export default ChatPanel;
