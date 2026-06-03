import { useEffect } from 'react';
import { Platform } from 'react-native';

import {
  onTruckAutoStopRequested,
  updateTruckAutoNavigation,
} from './TruckAutoModule';

interface UseAndroidAutoParams {
  navigating: boolean;
  stepInstruction: string;
  distToTurn: number | null;
  remainingSeconds: number;
  speed: number;
  onStopNavigation?: () => void;
}

export function useAndroidAuto({
  navigating,
  stepInstruction,
  distToTurn,
  remainingSeconds,
  speed,
  onStopNavigation,
}: UseAndroidAutoParams): void {
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    updateTruckAutoNavigation({
      navigating,
      stepInstruction,
      distToTurn,
      remainingSeconds,
      speed,
    });
  }, [distToTurn, navigating, remainingSeconds, speed, stepInstruction]);

  useEffect(() => {
    if (Platform.OS !== 'android' || !onStopNavigation) return;
    return onTruckAutoStopRequested(onStopNavigation);
  }, [onStopNavigation]);
}
