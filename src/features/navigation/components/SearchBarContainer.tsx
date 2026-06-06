import React, { memo } from 'react';
import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { styles } from '../screens/MapScreen.styles';
import SearchBar from './SearchBar';
import type { GeoPlace } from '../api/geocoding';

interface SearchBarContainerProps {
  navigating: boolean;
  searchTop: number;
  customOriginName: string | null;
  onSelect: (place: GeoPlace) => void;
  onClear: () => void;
  onOriginChange: (place: GeoPlace | null) => void;
}

const SearchBarContainer: React.FC<SearchBarContainerProps> = ({
  navigating,
  searchTop,
  customOriginName,
  onSelect,
  onClear,
  onOriginChange,
}) => {
  const { t } = useTranslation();

  if (navigating) return null;
  return (
    <View style={[styles.searchContainer, { top: searchTop }]}>
      <SearchBar
        onSelect={onSelect}
        onClear={onClear}
        onOriginChange={onOriginChange}
      />
      {customOriginName ? (
        <View style={styles.originActiveBadge}>
          <Text style={styles.originActiveTxt}>📍 {t('search.originActive', { name: customOriginName })}</Text>
        </View>
      ) : null}
    </View>
  );
};

export default memo(SearchBarContainer);
