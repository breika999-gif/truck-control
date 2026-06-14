import React from 'react';
import * as Sentry from '@sentry/react-native';
import { LogBox, StatusBar, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Mapbox from '@rnmapbox/maps';
import { MAPBOX_PUBLIC_TOKEN } from './src/shared/constants/config';
import { colors } from './src/shared/constants/theme';
import type { RootStackParamList } from './src/shared/types/navigation';
import { useTranslation } from 'react-i18next';
import './src/i18n';

Mapbox.setAccessToken(MAPBOX_PUBLIC_TOKEN);
if (Mapbox.setTelemetryEnabled) Mapbox.setTelemetryEnabled(false);

LogBox.ignoreLogs([
  'SafeAreaView has been deprecated',
  'onRegionIsChanging is deprecated',
]);
import MapScreen from './src/features/navigation/screens/MapScreen';
import VehicleProfileScreen from './src/features/vehicle/screens/VehicleProfileScreen';
import POIListScreen from './src/features/navigation/screens/POIListScreen';
import TachoScreen from './src/features/tacho/screens/TachoScreen';
import TruckBansScreen from './src/features/navigation/screens/TruckBansScreen';
import TruckParkingScreen from './src/features/navigation/screens/TruckParkingScreen';
import DispatcherScreen from './src/features/navigation/screens/DispatcherScreen';
import OfflineRegionsScreen from './src/features/offline/screens/OfflineRegionsScreen';
import { LicensesScreen } from './src/features/legal/screens/LicensesScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

function SentryCrashFallback({ error, onReset }: { error: Error; onReset: () => void }) {
  return (
    <View style={crashStyles.container}>
      <Text style={crashStyles.title}>Нещо се счупи</Text>
      <Text style={crashStyles.subtitle}>Грешката е докладвана автоматично.</Text>
      <Text style={crashStyles.errorMsg}>{error.message}</Text>
      <TouchableOpacity style={crashStyles.button} onPress={onReset}>
        <Text style={crashStyles.buttonText}>Опитай пак</Text>
      </TouchableOpacity>
    </View>
  );
}

const crashStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d0d0d', alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#aaa', marginBottom: 16 },
  errorMsg: { fontSize: 12, color: '#f66', fontFamily: 'monospace', marginBottom: 32, textAlign: 'center' },
  button: { backgroundColor: '#2563eb', paddingHorizontal: 32, paddingVertical: 12, borderRadius: 8 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});

const AppDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.bgSecondary,
    text: colors.text,
    border: colors.border,
    primary: colors.accent,
  },
};

function App() {
  const { t } = useTranslation();

  return (
    <SafeAreaProvider>
    <NavigationContainer theme={AppDarkTheme}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Map" component={MapScreen} />
        <Stack.Screen
          name="VehicleProfile"
          component={VehicleProfileScreen}
          options={{
            presentation: 'modal',
            headerShown: true,
            title: t('app.vehicleProfileTitle'),
            headerStyle: { backgroundColor: colors.bgSecondary },
            headerTintColor: colors.text,
            headerTitleStyle: { fontWeight: '600' },
          }}
        />
        <Stack.Screen
          name="POIList"
          component={POIListScreen}
          options={{
            headerShown: false,
            presentation: 'card',
          }}
        />
        <Stack.Screen
          name="Tacho"
          component={TachoScreen}
          options={{
            headerShown: true,
            title: t('app.tachoTitle'),
            headerStyle: { backgroundColor: colors.bgSecondary },
            headerTintColor: colors.text,
          }}
        />
        <Stack.Screen
          name="TruckBans"
          component={TruckBansScreen}
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="TruckParking"
          component={TruckParkingScreen}
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="Dispatcher"
          component={DispatcherScreen}
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="OfflineMaps"
          component={OfflineRegionsScreen}
          options={{
            presentation: 'modal',
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="Licenses"
          component={LicensesScreen}
          options={{
            presentation: 'modal',
            headerShown: true,
            title: t('app.legalInfoTitle'),
            headerStyle: { backgroundColor: colors.bgSecondary },
            headerTintColor: colors.text,
            headerTitleStyle: { fontWeight: '600' },
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
    </SafeAreaProvider>
  );
}

export default Sentry.withErrorBoundary(App, {
  fallback: ({ error, resetError }) => (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <SentryCrashFallback error={error} onReset={resetError} />
    </SafeAreaProvider>
  ),
});
