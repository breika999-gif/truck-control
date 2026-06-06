import React from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from '../../../shared/constants/theme';
import { POI_META, TruckPOI } from '../api/poi';
import { styles } from '../screens/MapScreen.styles';

interface POISearchResultsProps {
  poiResults: TruckPOI[];
  loadingPOI: boolean;
  sarMode: boolean;
  searchTop: number;
  onPOIPress: (poi: TruckPOI) => void;
  onClearSAR: () => void;
}

const POISearchResults: React.FC<POISearchResultsProps> = ({
  poiResults,
  loadingPOI,
  sarMode,
  searchTop,
  onPOIPress,
  onClearSAR,
}) => {
  const { t } = useTranslation();

  return (
    <View style={[styles.poiListContainer, { top: searchTop + (sarMode ? 68 : 110) }]}>
      {sarMode && (
        <View style={styles.sarHeaderBadge}>
          <Text style={styles.sarHeaderTxt}>
            {t('parking.alongRoute')}
          </Text>
          <TouchableOpacity
            onPress={onClearSAR}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.sarHeaderTxt, { marginLeft: 8 }]}>✕</Text>
          </TouchableOpacity>
        </View>
      )}
      {loadingPOI && (
        <ActivityIndicator size="small" color={colors.accent} style={styles.poiLoading} />
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.poiListContent}>
        {poiResults.map((poi) => (
          <TouchableOpacity
            key={poi.id}
            style={[styles.poiCard, sarMode && styles.poiCardSAR]}
            onPress={() => onPOIPress(poi)}
          >
            <Text style={styles.poiCardEmoji}>{POI_META[poi.category].emoji}</Text>
            <Text style={styles.poiCardName} numberOfLines={2}>{poi.name}</Text>
            {poi.brand ? (
              <Text style={styles.poiCardBrand} numberOfLines={1}>{poi.brand}</Text>
            ) : null}
            <Text style={styles.poiCardAddr} numberOfLines={1}>{poi.address}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
};

export default React.memo(POISearchResults);
