import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { spacing } from '../../../shared/constants/theme';
import { styles } from '../screens/MapScreen.styles';

interface ChatFABsProps {
  visible: boolean;
  backendOnline: boolean;
  geminiChatOpen: boolean;
  gptChatOpen: boolean;
  bottomOffset: number;
  onToggleGemini: () => void;
  onToggleGPT: () => void;
}

const ChatFABs: React.FC<ChatFABsProps> = ({
  visible,
  backendOnline,
  geminiChatOpen,
  gptChatOpen,
  bottomOffset,
  onToggleGemini,
  onToggleGPT,
}) => {
  if (!visible) return null;

  return (
    <>
      <TouchableOpacity
        style={[
          styles.geminiFab,
          { left: spacing.md, bottom: bottomOffset },
          backendOnline ? styles.geminiFabOnline : styles.geminiFabOffline,
        ]}
        onPress={onToggleGemini}
        activeOpacity={0.85}
      >
        <Text style={styles.geminiFabEmoji}>{geminiChatOpen ? '✕' : '💬'}</Text>
        <View style={[styles.onlineDot, backendOnline ? styles.onlineDotGreen : styles.onlineDotGrey]} />
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.geminiFab,
          { bottom: bottomOffset },
          backendOnline ? styles.geminiFabOnline : styles.geminiFabOffline,
        ]}
        onPress={onToggleGPT}
        activeOpacity={0.85}
      >
        <Text style={styles.geminiFabEmoji}>{gptChatOpen ? '✕' : '🤖'}</Text>
        <View style={[styles.onlineDot, backendOnline ? styles.onlineDotGreen : styles.onlineDotGrey]} />
      </TouchableOpacity>
    </>
  );
};

export default React.memo(ChatFABs);
