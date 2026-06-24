import React from 'react';
import { Dimensions, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { spacing } from '../../../shared/constants/theme';
import { styles } from '../screens/MapScreen.styles';

const FAB_SIZE = 56;

export interface ChatFabDragProps {
  offset: { x: number; y: number };
  panHandlers: object;
  onLongPress: () => void;
  onPressOut: () => void;
}

interface ChatFABsProps {
  visible: boolean;
  backendOnline: boolean;
  geminiChatOpen: boolean;
  gptChatOpen: boolean;
  bottomOffset: number;
  geminiDrag?: ChatFabDragProps;
  gptDrag?: ChatFabDragProps;
  onToggleGemini: () => void;
  onToggleGPT: () => void;
}

const ChatFABs: React.FC<ChatFABsProps> = ({
  visible,
  backendOnline,
  geminiChatOpen,
  gptChatOpen,
  bottomOffset,
  geminiDrag,
  gptDrag,
  onToggleGemini,
  onToggleGPT,
}) => {
  const { t } = useTranslation();

  if (!visible) return null;

  const { width } = Dimensions.get('window');
  const gptBaseLeft = width - FAB_SIZE - spacing.md;

  // Compute positions directly from offset — avoids right+left conflict with transform
  const geminiLeft   = spacing.md + (geminiDrag?.offset.x ?? 0);
  const geminiBottom = bottomOffset - (geminiDrag?.offset.y ?? 0);
  const gptLeft      = gptBaseLeft + (gptDrag?.offset.x ?? 0);
  const gptBottom    = bottomOffset - (gptDrag?.offset.y ?? 0);

  return (
    <>
      <TouchableOpacity
        style={[
          styles.geminiFab,
          { left: geminiLeft, bottom: geminiBottom },
          backendOnline ? styles.geminiFabOnline : styles.geminiFabOffline,
        ]}
        onPress={onToggleGemini}
        onLongPress={geminiDrag?.onLongPress}
        onPressOut={geminiDrag?.onPressOut}
        activeOpacity={0.85}
        delayLongPress={260}
        accessibilityRole="button"
        accessibilityLabel={geminiChatOpen ? t('chat.closeGemini') : t('chat.openGemini')}
        {...(geminiDrag?.panHandlers ?? {})}
      >
        <Icon name={geminiChatOpen ? 'close' : 'message-processing-outline'} size={27} color="#FFFFFF" />
        <View style={[styles.onlineDot, backendOnline ? styles.onlineDotGreen : styles.onlineDotGrey]} />
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.geminiFab,
          { left: gptLeft, bottom: gptBottom },
          backendOnline ? styles.geminiFabOnline : styles.geminiFabOffline,
        ]}
        onPress={onToggleGPT}
        onLongPress={gptDrag?.onLongPress}
        onPressOut={gptDrag?.onPressOut}
        activeOpacity={0.85}
        delayLongPress={260}
        accessibilityRole="button"
        accessibilityLabel={gptChatOpen ? t('chat.closeGpt') : t('chat.openGpt')}
        {...(gptDrag?.panHandlers ?? {})}
      >
        <Icon name={gptChatOpen ? 'close' : 'navigation-variant-outline'} size={27} color="#FFFFFF" />
        <View style={[styles.onlineDot, backendOnline ? styles.onlineDotGreen : styles.onlineDotGrey]} />
      </TouchableOpacity>
    </>
  );
};

export default React.memo(ChatFABs);
