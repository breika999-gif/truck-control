import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

interface TruckAutoNativeModule {
  updateNavigation(
    navigating: boolean,
    stepInstruction: string,
    distToTurn: number,
    remainingSeconds: number,
    speed: number,
  ): void;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

const nativeModule = NativeModules.TruckAutoModule as TruckAutoNativeModule | undefined;
const eventEmitter = Platform.OS === 'android' && nativeModule
  ? new NativeEventEmitter(NativeModules.TruckAutoModule)
  : null;

export function updateTruckAutoNavigation(params: {
  navigating: boolean;
  stepInstruction: string;
  distToTurn: number | null;
  remainingSeconds: number;
  speed: number;
}): void {
  nativeModule?.updateNavigation(
    params.navigating,
    params.stepInstruction,
    params.distToTurn ?? -1,
    params.remainingSeconds,
    params.speed,
  );
}

export function onTruckAutoStopRequested(listener: () => void): () => void {
  const subscription = eventEmitter?.addListener('TruckAutoStopRequested', listener);
  return () => subscription?.remove();
}
