import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import Mapbox from '@rnmapbox/maps';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { RootStackParamList } from '../../../shared/types/navigation';
import { BACKEND_URL, MAP_CENTER } from '../../../shared/constants/config';
import { colors, radius, spacing, typography } from '../../../shared/constants/theme';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'TruckParking'>;
type TruckParkingRouteProp = RouteProp<RootStackParamList, 'TruckParking'>;

const NEON = '#00bfff';

const TruckParkingScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<TruckParkingRouteProp>();
  const { userCoords } = route.params || {};

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [selectedSpot, setSelectedSpot] = useState<any>(null);
  
  const cameraRef = useRef<Mapbox.Camera>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Initial fetch for the area
    const center = userCoords || [MAP_CENTER.longitude, MAP_CENTER.latitude];
    // Create a dummy bounding box around the center for initial load
    const pad = 0.05;
    const initialBounds = {
      ne: [center[0] + pad, center[1] + pad],
      sw: [center[0] - pad, center[1] - pad]
    };
    fetchParking(initialBounds);
  }, []);

  const fetchParking = async (bounds: any) => {
    setLoading(true);
    try {
      const { sw, ne } = bounds;
      const url = `${BACKEND_URL}/api/parking/bbox?swLat=${sw[1]}&swLng=${sw[0]}&neLat=${ne[1]}&neLng=${ne[0]}`;
      const res = await fetch(url);
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error('Fetch parking error:', err);
    } finally {
      setLoading(false);
    }
  };

  const onRegionDidChange = useCallback(async (event: any) => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    
    debounceTimerRef.current = setTimeout(async () => {
      const bounds = event.properties.visibleBounds;
      if (bounds) {
        // bounds is [[neLng, neLat], [swLng, swLat]]
        const formattedBounds = {
          ne: bounds[0],
          sw: bounds[1]
        };
        fetchParking(formattedBounds);
      }
    }, 400);
  }, []);

  const onSourceLayerPress = useCallback((event: any) => {
    const feature = event.features[0];
    if (feature) {
      setSelectedSpot(feature.properties);
    }
  }, []);

  return (
    <View style={styles.container}>
      <Mapbox.MapView
        style={styles.map}
        styleURL={Mapbox.StyleURL.Dark}
        onRegionDidChange={onRegionDidChange}
        logoEnabled={false}
        attributionEnabled={false}
      >
        <Mapbox.Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: userCoords || [MAP_CENTER.longitude, MAP_CENTER.latitude],
            zoomLevel: 12,
          }}
        />

        {data && (
          <Mapbox.ShapeSource
            id="parking-source"
            shape={data}
            cluster={true}
            onPress={onSourceLayerPress}
          >
            <Mapbox.CircleLayer
              id="parking-pins"
              style={{
                circleColor: NEON,
                circleRadius: 8,
                circleStrokeWidth: 2,
                circleStrokeColor: '#ffffff',
              }}
            />
          </Mapbox.ShapeSource>
        )}
      </Mapbox.MapView>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Icon name="arrow-left" size={24} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Паркинги на живо</Text>
        {loading && <ActivityIndicator size="small" color={NEON} style={{ marginLeft: 8 }} />}
      </View>

      {/* Bottom Sheet */}
      {selectedSpot && (
        <View style={styles.bottomSheet}>
          <View style={styles.sheetHeader}>
            <Icon name="truck-parking" size={24} color={NEON} />
            <Text style={styles.spotName} numberOfLines={1}>
              {selectedSpot.name || 'Паркинг за камиони'}
            </Text>
            <TouchableOpacity onPress={() => setSelectedSpot(null)}>
              <Icon name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.sheetBody}>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => Alert.alert('Добави спирка', selectedSpot.name)}
            >
              <Icon name="map-marker-plus" size={20} color="#0a0a1a" />
              <Text style={styles.actionBtnText}>Добави спирка</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.tpBtn]}
              onPress={() => Linking.openURL(selectedSpot.url)}
            >
              <Icon name="comment-text-multiple" size={20} color="#ffffff" />
              <Text style={[styles.actionBtnText, { color: '#ffffff' }]}>Отзиви</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a1a',
  },
  map: {
    flex: 1,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 60,
    backgroundColor: 'rgba(10, 10, 26, 0.8)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 191, 255, 0.3)',
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    marginLeft: spacing.sm,
  },
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#16213e',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    paddingBottom: 40,
    borderTopWidth: 2,
    borderTopColor: NEON,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  spotName: {
    flex: 1,
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    marginHorizontal: spacing.sm,
  },
  sheetBody: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  actionBtn: {
    flex: 1,
    backgroundColor: NEON,
    height: 48,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  tpBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: '#00ff88',
  },
  actionBtnText: {
    color: '#0a0a1a',
    fontWeight: '800',
    fontSize: 14,
  },
});

export default TruckParkingScreen;
