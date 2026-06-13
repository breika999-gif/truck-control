import React from 'react';
import { Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

export type CommandTarget = 'gpt' | 'gemini';

interface Command {
  label: string;
  icon: string;
  target: CommandTarget;
  category: string;
}

interface CapabilitiesSheetProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (label: string, target: CommandTarget) => void;
}

const COMMANDS: Command[] = [
  { label: 'Карай до...', icon: 'navigation', target: 'gpt', category: 'Навигация' },
  { label: 'Избегни магистрала', icon: 'highway', target: 'gpt', category: 'Навигация' },
  { label: 'Рестарт маршрут', icon: 'restart', target: 'gpt', category: 'Навигация' },
  { label: 'Докъде стигам?', icon: 'map-marker-distance', target: 'gpt', category: 'Навигация' },
  { label: 'Намери паркинг', icon: 'parking', target: 'gpt', category: 'Паркинг' },
  { label: 'Паркинг за почивка', icon: 'sleep', target: 'gpt', category: 'Паркинг' },
  { label: 'Паркинг преди града', icon: 'city-variant-outline', target: 'gpt', category: 'Паркинг' },
  { label: 'Намери гориво', icon: 'gas-station', target: 'gpt', category: 'Паркинг' },
  { label: 'Колко имам за каране?', icon: 'timer-outline', target: 'gemini', category: 'Тахограф' },
  { label: 'Кога задължителна пауза?', icon: 'coffee-outline', target: 'gemini', category: 'Тахограф' },
  { label: 'Тази седмица?', icon: 'calendar-week', target: 'gemini', category: 'Тахограф' },
  { label: 'Plan My Breaks', icon: 'map-clock-outline', target: 'gemini', category: 'Тахограф' },
  { label: 'Времето по маршрута', icon: 'weather-partly-cloudy', target: 'gemini', category: 'Маршрут' },
  { label: 'Забрани по пътя', icon: 'cancel', target: 'gemini', category: 'Маршрут' },
  { label: 'Border warnings', icon: 'passport', target: 'gemini', category: 'Маршрут' },
];

const TARGET_COLOR: Record<CommandTarget, string> = {
  gpt: '#00e5ff',
  gemini: '#a78bfa',
};

const CATEGORIES = Array.from(new Set(COMMANDS.map(cmd => cmd.category)));

const CapabilitiesSheet: React.FC<CapabilitiesSheetProps> = ({
  visible,
  onClose,
  onSelect,
}) => (
  <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
    <View style={{
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0,0,0,0.55)',
    }}>
      <View style={{
        maxHeight: '75%',
        backgroundColor: '#0d0f1e',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: 18,
      }}>
        <View style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}>
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
            Какво мога да направя?
          </Text>
          <TouchableOpacity onPress={onClose} style={{ padding: 6 }}>
            <Icon name="close" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          <Text style={{ color: '#9aa0b8', fontSize: 11 }}>● Cyan = GPT навигация</Text>
          <Text style={{ color: '#9aa0b8', fontSize: 11 }}>● Purple = Gemini асистент</Text>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          {CATEGORIES.map(category => (
            <View key={category} style={{ marginBottom: 14 }}>
              <Text style={{
                color: '#8b93a8',
                fontSize: 11,
                fontWeight: '800',
                letterSpacing: 0.7,
                textTransform: 'uppercase',
                marginBottom: 6,
              }}>
                {category}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {COMMANDS.filter(cmd => cmd.category === category).map(cmd => (
                  <TouchableOpacity
                    key={`${cmd.category}-${cmd.label}`}
                    onPress={() => onSelect(cmd.label, cmd.target)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      borderWidth: 1,
                      borderColor: TARGET_COLOR[cmd.target],
                      backgroundColor: `${TARGET_COLOR[cmd.target]}18`,
                      borderRadius: 20,
                      paddingHorizontal: 12,
                      paddingVertical: 7,
                      margin: 4,
                    }}
                  >
                    <Icon name={cmd.icon} size={14} color={TARGET_COLOR[cmd.target]} />
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>
                      {cmd.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  </Modal>
);

export default React.memo(CapabilitiesSheet);
