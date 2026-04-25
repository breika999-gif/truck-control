import React from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from './src/shared/constants/theme';
import type { RootStackParamList } from './src/shared/types/navigation';
import MapScreen from './src/features/navigation/screens/MapScreen';
import VehicleProfileScreen from './src/features/vehicle/screens/VehicleProfileScreen';
import POIListScreen from './src/features/navigation/screens/POIListScreen';
import TachoScreen from './src/features/tacho/screens/TachoScreen';
import TruckBansScreen from './src/features/navigation/screens/TruckBansScreen';
import TruckParkingScreen from './src/features/navigation/screens/TruckParkingScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

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

export default function App() {
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
            title: 'РџСЂРѕС„РёР» РЅР° РєР°РјРёРѕРЅ',
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
            title: 'РўР°С…РѕРіСЂР°С„',
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
      </Stack.Navigator>
    </NavigationContainer>
    </SafeAreaProvider>
  );
}
