import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import MapboxNavigation from '@pawan-pk/react-native-mapbox-navigation';

const ORIGIN = { latitude: 42.6977, longitude: 23.3219 }; // Sofia, Bulgaria
const DESTINATION = { latitude: 42.1354, longitude: 24.7453 }; // Plovdiv, Bulgaria

export default function App() {
  const [navigating, setNavigating] = useState(false);
  const [arrived, setArrived] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  if (navigating) {
    return (
      <View style={styles.full}>
        <StatusBar barStyle="dark-content" />
        <MapboxNavigation
          startOrigin={ORIGIN}
          destination={DESTINATION}
          style={styles.full}
          language="bg"
          distanceUnit="metric"
          showCancelButton={true}
          onLocationChange={({ latitude, longitude }) => {
            // position updates during navigation
            console.log('Location:', latitude, longitude);
          }}
          onRouteProgressChange={({ distanceRemaining, durationRemaining }) => {
            setInfo(
              `${(distanceRemaining / 1000).toFixed(1)} km · ${Math.round(durationRemaining / 60)} min`,
            );
          }}
          onArrive={() => {
            setNavigating(false);
            setArrived(true);
          }}
          onCancelNavigation={() => setNavigating(false)}
          onError={(event) => {
            // Android native sends { error: "..." }, iOS sends { message: "..." }
            const msg = (event as any).error ?? event.message ?? JSON.stringify(event);
            console.error('Navigation error:', msg);
            // Only stop navigation for fatal errors, not permission warnings
            if (msg && !msg.includes('Notification permission')) {
              setNavigating(false);
            }
          }}
        />
        {info && (
          <View style={styles.infoBar}>
            <Text style={styles.infoText}>{info}</Text>
          </View>
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.home}>
      <StatusBar barStyle="light-content" />
      <Text style={styles.title}>TruckExpoAI</Text>
      <Text style={styles.subtitle}>
        {arrived ? '✓ Пристигнахте!' : 'Демо маршрут: София → Пловдив'}
      </Text>
      <TouchableOpacity
        style={styles.button}
        onPress={() => {
          setArrived(false);
          setInfo(null);
          setNavigating(true);
        }}
      >
        <Text style={styles.buttonText}>
          {arrived ? 'Нов маршрут' : 'Тръгваме!'}
        </Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  full: {
    flex: 1,
  },
  home: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 16,
    color: '#aaaacc',
  },
  button: {
    marginTop: 24,
    backgroundColor: '#4f46e5',
    paddingHorizontal: 40,
    paddingVertical: 16,
    borderRadius: 12,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
  },
  infoBar: {
    position: 'absolute',
    bottom: 32,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  infoText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '500',
  },
});
