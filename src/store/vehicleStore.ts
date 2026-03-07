import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { VehicleProfile } from '../shared/types/vehicle';

interface VehicleStore {
  profile: VehicleProfile | null;
  setProfile: (p: VehicleProfile) => void;
  clearProfile: () => void;
}

export const useVehicleStore = create<VehicleStore>()(
  persist(
    (set) => ({
      profile: null,
      setProfile: (p) => set({ profile: p }),
      clearProfile: () => set({ profile: null }),
    }),
    {
      name: 'vehicle-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
