import React, { memo } from 'react';
import { View, Text, TouchableOpacity, Linking } from 'react-native';
import { useTranslation } from 'react-i18next';
import { styles } from '../screens/MapScreen.styles';

interface BorderCrossing {
  name: string;
  flag: string;
  status: string;
  url: string;
}

interface BorderCrossingsPanelProps {
  show: boolean;
  crossings: BorderCrossing[];
  onClose: () => void;
}

const BorderCrossingsPanel: React.FC<BorderCrossingsPanelProps> = ({ show, crossings, onClose }) => {
  const { t } = useTranslation();

  if (!show || crossings.length === 0) return null;
  return (
    <View style={styles.borderPanel}>
      <View style={styles.borderPanelHeader}>
        <Text style={styles.borderPanelTitle}>🛂 {t('panels.borderCrossings')}</Text>
        <TouchableOpacity onPress={onClose}>
          <Text style={styles.borderPanelClose}>✕</Text>
        </TouchableOpacity>
      </View>
      {crossings.map((c, i) => (
        <TouchableOpacity
          key={i}
          style={styles.borderRow}
          onPress={() => Linking.openURL(c.url).catch(() => null)}
        >
          <Text style={styles.borderFlag}>{c.flag}</Text>
          <Text style={styles.borderName}>{c.name}</Text>
          <Text style={styles.borderStatus}>{c.status} →</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
};

export default memo(BorderCrossingsPanel);
