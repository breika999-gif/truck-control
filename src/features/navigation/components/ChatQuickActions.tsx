import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { colors, spacing } from '../../../shared/constants/theme';

type ChatQuickActionMode = 'gpt' | 'gemini';

interface ChatQuickActionsProps {
  mode: ChatQuickActionMode;
  onSelect: (text: string) => void;
}

const GPT_ACTIONS = [
  'Намери паркинг',
  'Паркинг за почивка',
  'Намери гориво',
  'Избегни магистрала',
  'Рестарт маршрут',
  'Докъде стигам?',
];

const GEMINI_ACTIONS = [
  'Колко имам за каране?',
  'Кога задължителна пауза?',
  'Тази седмица?',
  'Времето по маршрута',
  'Забрани днес?',
];

const ChatQuickActions: React.FC<ChatQuickActionsProps> = ({ mode, onSelect }) => {
  const actions = mode === 'gpt' ? GPT_ACTIONS : GEMINI_ACTIONS;
  const accent = mode === 'gpt' ? '#00e5ff' : '#a78bfa';

  return (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="handled"
      showsHorizontalScrollIndicator={false}
      style={quickStyles.wrap}
      contentContainerStyle={quickStyles.content}
    >
      {actions.map(action => (
        <TouchableOpacity
          key={action}
          activeOpacity={0.82}
          style={[quickStyles.chip, { borderColor: accent }]}
          onPress={() => onSelect(action)}
        >
          <Text style={quickStyles.text}>{action}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
};

const quickStyles = StyleSheet.create({
  wrap: {
    maxHeight: 42,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  content: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 16,
    backgroundColor: '#1e1e2e',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  text: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
});

export default React.memo(ChatQuickActions);
