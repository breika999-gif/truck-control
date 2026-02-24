import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  TextInput,
  FlatList,
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
  Keyboard,
} from 'react-native';
import { colors, spacing, radius, typography } from '../../../shared/constants/theme';
import { searchPlaces, GeoPlace } from '../api/geocoding';

interface Props {
  onSelect: (place: GeoPlace) => void;
  onClear?: () => void;
}

export default function SearchBar({ onSelect, onClear }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoPlace[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback((text: string) => {
    setQuery(text);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (text.trim().length < 2) {
      setResults([]);
      return;
    }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const places = await searchPlaces(text);
        setResults(places);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 350);
  }, []);

  const handleSelect = useCallback(
    (place: GeoPlace) => {
      setQuery(place.text);
      setResults([]);
      Keyboard.dismiss();
      onSelect(place);
    },
    [onSelect],
  );

  const handleClear = useCallback(() => {
    setQuery('');
    setResults([]);
    onClear?.();
  }, [onClear]);

  return (
    <View>
      <View style={styles.inputRow}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.input}
          placeholder="Търси дестинация..."
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={handleChange}
          returnKeyType="search"
          autoCorrect={false}
        />
        {loading && (
          <ActivityIndicator size="small" color={colors.accent} style={styles.spinner} />
        )}
        {!loading && query.length > 0 && (
          <TouchableOpacity onPress={handleClear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.clearIcon}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {results.length > 0 && (
        <FlatList
          style={styles.dropdown}
          data={results}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={false}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.resultItem} onPress={() => handleSelect(item)}>
              <Text style={styles.resultText} numberOfLines={1}>
                {item.text}
              </Text>
              <Text style={styles.resultSubtext} numberOfLines={1}>
                {item.place_name}
              </Text>
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    height: 50,
    elevation: 10,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: spacing.sm,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
  },
  spinner: {
    marginLeft: spacing.sm,
  },
  clearIcon: {
    color: colors.textSecondary,
    fontSize: 15,
    marginLeft: spacing.sm,
  },
  dropdown: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.xs,
    elevation: 10,
  },
  resultItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  resultText: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  resultSubtext: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.md,
  },
});
