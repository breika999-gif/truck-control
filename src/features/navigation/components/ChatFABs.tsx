import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
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
        accessibilityRole="button"
        accessibilityLabel={geminiChatOpen ? 'Затвори Gemini асистента' : 'Отвори Gemini асистента'}
      >
        <Icon name={geminiChatOpen ? 'close' : 'message-processing-outline'} size={27} color="#FFFFFF" />
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
        accessibilityRole="button"
        accessibilityLabel={gptChatOpen ? 'Затвори GPT навигатора' : 'Отвори GPT навигатора'}
      >
        <Icon name={gptChatOpen ? 'close' : 'navigation-variant-outline'} size={27} color="#FFFFFF" />
        <View style={[styles.onlineDot, backendOnline ? styles.onlineDotGreen : styles.onlineDotGrey]} />
      </TouchableOpacity>
    </>
  );
};

export default React.memo(ChatFABs);
