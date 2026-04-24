import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { WebView } from 'react-native-webview';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { RootStackParamList } from '../../../shared/types/navigation';
import { spacing } from '../../../shared/constants/theme';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'TruckParking'>;
type TruckParkingRouteProp = RouteProp<RootStackParamList, 'TruckParking'>;

const NEON = '#00bfff';

const TruckParkingScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<TruckParkingRouteProp>();
  const { url } = route.params || {};
  const transparkingUrl = url ?? 'https://truckerapps.eu/transparking/en/map/';

  return (
    <SafeAreaView style={styles.container}>
      {/* Header with Back Button */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Icon name="arrow-left" size={28} color="#ffffff" />
        </TouchableOpacity>
        <View style={styles.titleContainer}>
          <Text style={styles.headerTitle}>TransParking Live</Text>
          <Text style={styles.subTitle}>Паркинги в реално време</Text>
        </View>
        <Icon name="truck-parking" size={28} color={NEON} style={styles.headerIcon} />
      </View>

      {/* WebView Container */}
      <View style={styles.webviewContainer}>
        <WebView
          source={{ uri: transparkingUrl }}
          style={styles.webview}
          startInLoadingState={true}
          renderLoading={() => (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={NEON} />
              <Text style={styles.loadingText}>Зареждам картата на TransParking...</Text>
            </View>
          )}
          geolocationEnabled={true}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          userAgent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a1a',
  },
  header: {
    height: 70,
    backgroundColor: '#0a0a1a',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 191, 255, 0.3)',
  },
  backBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 22,
  },
  titleContainer: {
    flex: 1,
    marginLeft: spacing.md,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  subTitle: {
    color: NEON,
    fontSize: 12,
    fontWeight: '500',
    marginTop: -2,
  },
  headerIcon: {
    marginLeft: spacing.sm,
  },
  webviewContainer: {
    flex: 1,
    backgroundColor: '#0a0a1a',
  },
  webview: {
    flex: 1,
    backgroundColor: '#0a0a1a',
  },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0a0a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#ffffff',
    marginTop: spacing.md,
    fontSize: 14,
    fontWeight: '600',
  },
});

export default TruckParkingScreen;
