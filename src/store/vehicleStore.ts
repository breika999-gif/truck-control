import { create } from 'zustand';
import { VehicleProfile } from '../shared/types/vehicle';

interface VehicleStore {
  profile: VehicleProfile | null;
  setProfile: (p: VehicleProfile) => void;
  clearProfile: () => void;
}

export const useVehicleStore = create<VehicleStore>((set) => ({
  profile: null,
  setProfile: (p) => set({ profile: p }),
  clearProfile: () => set({ profile: null }),
}));
