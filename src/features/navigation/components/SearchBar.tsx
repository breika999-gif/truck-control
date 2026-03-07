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
import { colors, spacing, typography } from '../../../shared/constants/theme';
import {
  suggestPlaces,
  retrievePlace,
  type GeoPlace,
  type SearchSuggestion,
} from '../api/geocoding';

// Neon blue — matches MapScreen theme
const NEON     = '#00bfff';
const NEON_DIM = 'rgba(0,191,255,0.10)';

// If no API response arrives within this window, abort and hide loading state.
const SEARCH_TIMEOUT_MS = 3_000;
// Debounce delay before firing the suggest request.
const DEBOUNCE_MS = 350;

interface Props {
  onSelect: (place: GeoPlace) => void;
  onClear?: () => void;
  onOriginChange?: (place: GeoPlace | null) => void;
}

export default function SearchBar({ onSelect, onClear, onOriginChange }: Props) {
  const [query, setQuery]           = useState('');
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [loading, setLoading]       = useState(false);
  const [retrieving, setRetrieving] = useState(false);
  // Show origin row only when user is actively searching or has custom origin
  const [destFocused, setDestFocused] = useState(false);

  // Origin search state
  const [originQuery, setOriginQuery]       = useState('');
  const [originSuggestions, setOriginSuggestions] = useState<SearchSuggestion[]>([]);
  const [originLoading, setOriginLoading]   = useState(false);
  const [originLabel, setOriginLabel]       = useState<string | null>(null); // null = GPS
  const [originFocused, setOriginFocused]   = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef    = useRef<AbortController | null>(null);

  const originDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originAbortRef    = useRef<AbortController | null>(null);

  // ── Fully exit search mode ─────────────────────────────────────────────────
  const exitSearch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (timeoutRef.current)  clearTimeout(timeoutRef.current);
    abortRef.current?.abort();
    setQuery('');
    setSuggestions([]);
    setLoading(false);
    setDestFocused(false);
    Keyboard.dismiss();
    onClear?.();
  }, [onClear]);

  // ── Origin search ──────────────────────────────────────────────────────────
  const handleOriginChange = useCallback((text: string) => {
    setOriginQuery(text);
    originAbortRef.current?.abort();
    if (originDebounceRef.current) clearTimeout(originDebounceRef.current);

    if (text.trim().length < 2) { setOriginSuggestions([]); setOriginLoading(false); return; }

    originDebounceRef.current = setTimeout(() => {
      const ctrl = new AbortController();
      originAbortRef.current = ctrl;
      setOriginLoading(true);
      suggestPlaces(text, ctrl.signal).then(results => {
        setOriginSuggestions(results);
        setOriginLoading(false);
      });
    }, DEBOUNCE_MS);
  }, []);

  const handleOriginSelect = useCallback(async (s: SearchSuggestion) => {
    setOriginSuggestions([]);
    setOriginQuery(s.name);
    setOriginFocused(false);
    Keyboard.dismiss();
    const place = await retrievePlace(s.mapbox_id);
    if (place) { setOriginLabel(place.text); onOriginChange?.(place); }
  }, [onOriginChange]);

  const resetOrigin = useCallback(() => {
    setOriginQuery('');
    setOriginLabel(null);
    setOriginSuggestions([]);
    setOriginFocused(false);
    onOriginChange?.(null);
  }, [onOriginChange]);

  // ── Handle text input ──────────────────────────────────────────────────────
  const handleChange = useCallback((text: string) => {
    setQuery(text);

    // Cancel pending work
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (timeoutRef.current)  clearTimeout(timeoutRef.current);
    abortRef.current?.abort();

    if (text.trim().length < 2) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);

      // 3-second auto-exit: abort fetch + hide spinner if API is too slow
      timeoutRef.current = setTimeout(() => {
        ctrl.abort();
        setLoading(false);
        setSuggestions([]);
      }, SEARCH_TIMEOUT_MS);

      suggestPlaces(text, ctrl.signal).then(results => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setSuggestions(results);
        setLoading(false);
      });
    }, DEBOUNCE_MS);
  }, []);

  // ── User selects a suggestion → retrieve exact coordinates ────────────────
  const handleSelect = useCallback(async (s: SearchSuggestion) => {
    setSuggestions([]);
    setQuery(s.name);
    Keyboard.dismiss();
    setRetrieving(true);
    try {
      const place = await retrievePlace(s.mapbox_id);
      if (place) onSelect(place);
    } finally {
      setRetrieving(false);
    }
  }, [onSelect]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    // box-none: the View itself doesn't intercept taps — only its children do.
    // This lets the map remain interactive when the dropdown is NOT showing.
    <View pointerEvents="box-none">

      {/* ── Origin row — shown only when searching or custom origin set ── */}
      {onOriginChange && (destFocused || query.length > 0 || originLabel !== null) && (
        <View pointerEvents="auto">
          <View style={styles.originRow}>
            <Text style={styles.originIcon}>📍</Text>
            {originFocused ? (
              <TextInput
                style={styles.originInput}
                placeholder="Начална точка..."
                placeholderTextColor={colors.textMuted}
                value={originQuery}
                onChangeText={handleOriginChange}
                onBlur={() => { if (!originQuery.trim()) setOriginFocused(false); }}
                autoFocus
                autoCorrect={false}
                returnKeyType="search"
              />
            ) : (
              <TouchableOpacity style={{ flex: 1 }} onPress={() => setOriginFocused(true)}>
                <Text style={styles.originLabel} numberOfLines={1}>
                  {originLabel ?? 'Моето местоположение'}
                </Text>
              </TouchableOpacity>
            )}
            {originLoading && <ActivityIndicator size="small" color={NEON} style={styles.spinner} />}
            {originLabel && (
              <TouchableOpacity onPress={resetOrigin} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.exitIcon}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
          {originSuggestions.length > 0 && (
            <FlatList
              style={styles.dropdown}
              data={originSuggestions}
              keyExtractor={(item) => item.mapbox_id}
              keyboardShouldPersistTaps="handled"
              scrollEnabled
              nestedScrollEnabled
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.resultItem} onPress={() => handleOriginSelect(item)}>
                  <Text style={styles.resultText} numberOfLines={1}>{item.name}</Text>
                  {(item.full_address ?? item.place_formatted) ? (
                    <Text style={styles.resultSubtext} numberOfLines={1}>{item.full_address ?? item.place_formatted}</Text>
                  ) : null}
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          )}
          <View style={styles.originDivider} />
        </View>
      )}

      <View style={styles.inputRow} pointerEvents="auto">
        <Text style={styles.searchIcon}>🔍</Text>

        <TextInput
          style={styles.input}
          placeholder="Търси дестинация..."
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={handleChange}
          onFocus={() => setDestFocused(true)}
          onBlur={() => setDestFocused(false)}
          returnKeyType="search"
          autoCorrect={false}
        />

        {(loading || retrieving) && (
          <ActivityIndicator size="small" color={NEON} style={styles.spinner} />
        )}

        {/* Always-visible X — exits search mode completely */}
        <TouchableOpacity
          style={styles.exitBtn}
          onPress={exitSearch}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.exitIcon}>✕</Text>
        </TouchableOpacity>
      </View>

      {suggestions.length > 0 && (
        <FlatList
          style={styles.dropdown}
          data={suggestions}
          keyExtractor={(item) => item.mapbox_id}
          keyboardShouldPersistTaps="handled"
          scrollEnabled
          nestedScrollEnabled
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.resultItem}
              onPress={() => handleSelect(item)}
            >
              <Text style={styles.resultText} numberOfLines={1}>
                {item.name}
              </Text>
              {(item.full_address ?? item.place_formatted) ? (
                <Text style={styles.resultSubtext} numberOfLines={1}>
                  {item.full_address ?? item.place_formatted}
                </Text>
              ) : null}
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
    backgroundColor: 'rgba(0,8,20,0.92)',
    borderRadius: 50,
    borderWidth: 1.5,
    borderColor: NEON,
    paddingHorizontal: spacing.md,
    height: 50,
    elevation: 12,
    shadowColor: NEON,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.65,
    shadowRadius: 8,
  },
  searchIcon: { fontSize: 16, marginRight: spacing.sm },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
  },
  spinner: { marginLeft: spacing.sm },
  exitBtn: {
    marginLeft: spacing.sm,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: NEON_DIM,
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  exitIcon: { color: NEON, fontSize: 13, fontWeight: '700' as const },

  // Origin row
  originRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: 'rgba(0,8,20,0.92)',
    borderRadius: 50,
    borderWidth: 1.5,
    borderColor: 'rgba(0,191,255,0.45)',
    paddingHorizontal: spacing.md,
    height: 40,
    marginBottom: 6,
    elevation: 8,
  },
  originIcon: { fontSize: 14, marginRight: spacing.sm },
  originLabel: { flex: 1, color: colors.textSecondary, fontSize: 13 },
  originInput: { flex: 1, color: colors.text, fontSize: 13 },
  originDivider: { height: 4 },

  dropdown: {
    backgroundColor: 'rgba(0,8,20,0.95)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: NEON,
    marginTop: spacing.xs,
    elevation: 14,
    maxHeight: 260,
    shadowColor: NEON,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
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
    backgroundColor: 'rgba(0,191,255,0.15)',
    marginHorizontal: spacing.md,
  },
});
