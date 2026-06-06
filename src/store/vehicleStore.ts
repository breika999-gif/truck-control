import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { VehicleProfile } from '../shared/types/vehicle';

export type AppLanguage = 'en' | 'bg' | 'es';

interface VehicleStore {
  profile: VehicleProfile | null;
  language: AppLanguage;
  isLoaded: boolean;
  setProfile: (p: VehicleProfile) => void;
  clearProfile: () => void;
  setLanguage: (language: AppLanguage) => void;
  setIsLoaded: (v: boolean) => void;
}

export const useVehicleStore = create<VehicleStore>()(
  persist(
    (set) => ({
      profile: null,
      language: 'en',
      isLoaded: false,
      setProfile: (p) => set({ profile: p }),
      clearProfile: () => set({ profile: null }),
      setLanguage: (language) => {
        AsyncStorage.setItem('language', language).catch(() => null);
        set({ language });
      },
      setIsLoaded: (v) => {
        AsyncStorage.setItem('isLoaded', JSON.stringify(v)).catch(() => null);
        set({ isLoaded: v });
      },
    }),
    {
      name: 'vehicle-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
